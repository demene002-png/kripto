import crypto from 'crypto';
import { getDb } from './db';
import { buildRiskPlan } from './risk';
import { getUsdtMarket } from './market';
import { getTestnetAssetFree, getTestnetSymbolRules, normalizeTestnetMarketSell, placeTestnetMarketBuy, placeTestnetMarketSell, getTestnetUsdtBalance } from './binanceTestnet';

function fillAverage(order:any){
  const qty=Number(order.executedQty||0), quote=Number(order.cummulativeQuoteQty||0);
  if(qty>0&&quote>0) return quote/qty;
  const fills=Array.isArray(order.fills)?order.fills:[];
  const fq=fills.reduce((s:number,f:any)=>s+Number(f.qty||0),0);
  const fv=fills.reduce((s:number,f:any)=>s+Number(f.qty||0)*Number(f.price||0),0);
  return fq>0?fv/fq:0;
}

async function getTestnetDailyState(userId:number){
  const db=await getDb();
  const now=new Date(), start=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
  const row=await db.get('SELECT COALESCE(SUM(realized_pnl),0) pnl FROM testnet_trade_history WHERE user_id=? AND created_at>=?',[userId,start]);
  return {realizedPnl:Number(row?.pnl||0)};
}

export async function executeManagedTestnetBuy(userId:number,symbol:string,requestedSpend:number,automationMode:string){
  const db=await getDb();
  const existing=await db.get("SELECT * FROM testnet_positions WHERE user_id=? AND symbol=? AND status='OPEN'",[userId,symbol]);
  if(existing) throw new Error('Bu sembolde bot tarafından yönetilen Testnet pozisyon zaten açık.');
  const rows=await db.all("SELECT quantity,average_entry,stop_loss FROM testnet_positions WHERE user_id=? AND status='OPEN'",[userId]);
  const usdt=await getTestnetUsdtBalance();
  const managedValue=rows.reduce((s:number,p:any)=>s+Number(p.quantity||0)*Number(p.average_entry||0),0);
  const managedRisk=rows.reduce((s:number,p:any)=>s+Math.max(0,(Number(p.average_entry||0)-Number(p.stop_loss||0))*Number(p.quantity||0)),0);
  const day=await getTestnetDailyState(userId);
  const equity=Math.max(1,usdt+managedValue);
  const dailyPct=day.realizedPnl/equity*100;
  const plan:any=await buildRiskPlan(userId,symbol,{equityApprox:equity,openPositions:rows.length,openRisk:managedRisk,dailyPct,realizedPnl:day.realizedPnl});
  if(!plan.allowed) throw new Error(`Risk Manager işlemi engelledi: ${plan.blocks.join(' ')}`);
  const spend=Math.min(requestedSpend>0?requestedSpend:plan.execution.suggestedSpend,plan.execution.suggestedSpend,usdt);
  if(spend<=0) throw new Error('Risk planı geçerli pozisyon büyüklüğü üretemedi.');
  const clientOrderId=`kai_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`.slice(0,36);
  const order=await placeTestnetMarketBuy(symbol,spend,clientOrderId);
  const qty=Number(order.executedQty||0), avg=fillAverage(order);
  if(String(order.status)!=='FILLED'||qty<=0||avg<=0) throw new Error(`Testnet BUY beklenen şekilde FILLED olmadı: ${order.status}`);
  const rules=await getTestnetSymbolRules(symbol);
  const stop=Number(plan.execution.stopLoss||avg*0.98);
  const tp1=Number(plan.execution.takeProfit1||avg*1.025);
  const tp2=Number(plan.execution.takeProfit2||avg*1.05);
  const activation=Number(plan.execution.trailingActivation||avg*1.03);
  const trail=Number(plan.execution.trailingDistancePct||1);
  const riskAmount=Math.max(0,(avg-stop)*qty);
  await db.run(`INSERT INTO testnet_positions
    (user_id,symbol,base_asset,quantity,average_entry,stop_loss,take_profit1,take_profit2,trailing_activation,trailing_distance_pct,highest_price,risk_amount,last_reconciled_at,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'OPEN')`,
    [userId,symbol,rules.baseAsset,qty,avg,stop,tp1,tp2,activation,trail,avg,riskAmount,Date.now()]);
  await db.run('INSERT INTO execution_audit (id,user_id,environment,automation_mode,symbol,side,requested_value,exchange_order_id,status,response_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [crypto.randomUUID(),userId,'TESTNET',automationMode,symbol,'BUY',spend,String(order.orderId||''),String(order.status||''),JSON.stringify(order),Date.now()]);
  return {order,position:{symbol,quantity:qty,averageEntry:avg,stopLoss:stop,takeProfit1:tp1,takeProfit2:tp2}};
}

export async function reconcileTestnetPosition(userId:number,symbol:string){
  const db=await getDb();
  const p=await db.get("SELECT * FROM testnet_positions WHERE user_id=? AND symbol=? AND status='OPEN'",[userId,symbol]);
  if(!p) return {ok:true,status:'NO_MANAGED_POSITION',symbol};
  const free=await getTestnetAssetFree(String(p.base_asset));
  const managed=Number(p.quantity||0);
  const tolerance=Math.max(1e-10,managed*0.002);
  const ok=free+tolerance>=managed;
  await db.run('UPDATE testnet_positions SET last_reconciled_at=? WHERE user_id=? AND symbol=?',[Date.now(),userId,symbol]);
  return {ok,symbol,baseAsset:p.base_asset,managedQuantity:managed,exchangeFree:free,difference:free-managed,lastReconciledAt:Date.now(),reason:ok?'Exchange bakiyesi yönetilen miktarı karşılıyor.':'Exchange serbest bakiyesi yönetilen miktardan düşük.'};
}

export async function reconcileAllTestnetPositions(userId:number){
  const db=await getDb();
  const rows=await db.all("SELECT symbol FROM testnet_positions WHERE user_id=? AND status='OPEN'",[userId]);
  const results=[];
  for(const r of rows){
    try{results.push(await reconcileTestnetPosition(userId,String(r.symbol)));}
    catch(e:any){results.push({ok:false,symbol:String(r.symbol),reason:e.message});}
  }
  return {ok:results.every((r:any)=>r.ok),count:results.length,results,checkedAt:Date.now()};
}

export async function sellManagedTestnetPosition(userId:number,symbol:string,reason='MANUAL_CLOSE',fraction=1){
  const db=await getDb();
  const p=await db.get("SELECT * FROM testnet_positions WHERE user_id=? AND symbol=? AND status='OPEN'",[userId,symbol]);
  if(!p) throw new Error('Bot tarafından yönetilen açık Testnet pozisyon yok.');
  const rec=await reconcileTestnetPosition(userId,symbol);
  if(!rec.ok) throw new Error(`Reconciliation başarısız: ${rec.reason}`);
  const market=await getUsdtMarket(symbol);
  const requested=Number(p.quantity)*Math.max(0.000001,Math.min(1,fraction));
  const n=await normalizeTestnetMarketSell(symbol,requested,market.bidPrice||market.price);
  const clientOrderId=`kai_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`.slice(0,36);
  const order=await placeTestnetMarketSell(symbol,n.quantity,market.bidPrice||market.price,clientOrderId);
  if(String(order.status)!=='FILLED') throw new Error(`Testnet SELL FILLED olmadı: ${order.status}`);
  const sold=Number(order.executedQty||n.quantity), remaining=Math.max(0,Number(p.quantity)-sold);
  if(remaining<=Math.max(n.rules.marketMinQty/2,1e-12)) await db.run("UPDATE testnet_positions SET quantity=0,status='CLOSED',last_reconciled_at=? WHERE user_id=? AND symbol=?",[Date.now(),userId,symbol]);
  else await db.run('UPDATE testnet_positions SET quantity=?,last_reconciled_at=? WHERE user_id=? AND symbol=?',[remaining,Date.now(),userId,symbol]);
  const exitAvg=fillAverage(order)||Number(market.bidPrice||market.price);
  const realizedPnl=(exitAvg-Number(p.average_entry))*sold;
  await db.run('INSERT INTO execution_audit (id,user_id,environment,automation_mode,symbol,side,requested_value,exchange_order_id,status,response_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [crypto.randomUUID(),userId,'TESTNET','MANAGED',symbol,`SELL:${reason}`,sold,String(order.orderId||''),String(order.status||''),JSON.stringify(order),Date.now()]);
  await db.run('INSERT INTO testnet_trade_history (id,user_id,symbol,side,quantity,price,realized_pnl,reason,exchange_order_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [crypto.randomUUID(),userId,symbol,'SELL',sold,exitAvg,realizedPnl,reason,String(order.orderId||''),Date.now()]);
  return {order,sold,remaining,reason,realizedPnl,exitAvg};
}

export async function validateTestnetProtection(userId:number){
  const db=await getDb();
  const rows=await db.all("SELECT * FROM testnet_positions WHERE user_id=? AND status='OPEN'",[userId]);
  const now=Date.now();
  const checks=rows.map((p:any)=>{
    const fieldsValid=Number(p.stop_loss)>0&&Number(p.take_profit1)>Number(p.average_entry)&&Number(p.take_profit2)>Number(p.take_profit1)&&Number(p.trailing_distance_pct)>0;
    const reconcileFresh=Number(p.last_reconciled_at||0)>0&&(now-Number(p.last_reconciled_at))<120_000;
    return {symbol:p.symbol,fieldsValid,reconcileFresh,protected:fieldsValid&&reconcileFresh,note:'V8 protection is app-managed, not exchange-native OCO.'};
  });
  return {ok:checks.every((x:any)=>x.protected),exchangeNative:false,checks};
}

export async function manageTestnetPositionTick(userId:number,symbol:string,currentPrice:number){
  const db=await getDb();
  const p=await db.get("SELECT * FROM testnet_positions WHERE user_id=? AND symbol=? AND status='OPEN'",[userId,symbol]);
  if(!p) return null;
  const highest=Math.max(Number(p.highest_price||p.average_entry),currentPrice);
  let stop=Number(p.stop_loss||0);
  if(currentPrice>=Number(p.trailing_activation||Infinity)){
    stop=Math.max(stop,highest*(1-Number(p.trailing_distance_pct||1)/100),Number(p.average_entry)*1.001);
  }
  if(highest!==Number(p.highest_price)||stop!==Number(p.stop_loss)) await db.run('UPDATE testnet_positions SET highest_price=?,stop_loss=? WHERE user_id=? AND symbol=?',[highest,stop,userId,symbol]);
  if(stop>0&&currentPrice<=stop) return sellManagedTestnetPosition(userId,symbol,currentPrice<Number(p.average_entry)?'STOP_LOSS':'TRAILING_STOP',1);
  if(!p.tp1_hit&&currentPrice>=Number(p.take_profit1||Infinity)){
    const r=await sellManagedTestnetPosition(userId,symbol,'TP1',0.25);
    await db.run('UPDATE testnet_positions SET tp1_hit=1,stop_loss=MAX(stop_loss,average_entry*1.001) WHERE user_id=? AND symbol=?',[userId,symbol]);
    return r;
  }
  if(!p.tp2_hit&&currentPrice>=Number(p.take_profit2||Infinity)){
    const fresh=await db.get("SELECT * FROM testnet_positions WHERE user_id=? AND symbol=? AND status='OPEN'",[userId,symbol]);
    if(!fresh)return null;
    const fraction=Math.min(1,(Number(fresh.quantity)/3)/Number(fresh.quantity));
    const r=await sellManagedTestnetPosition(userId,symbol,'TP2',fraction);
    await db.run('UPDATE testnet_positions SET tp2_hit=1 WHERE user_id=? AND symbol=?',[userId,symbol]);
    return r;
  }
  return null;
}
