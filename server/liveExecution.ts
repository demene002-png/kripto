import crypto from 'crypto';
import { getDb } from './db';
import { buildRiskPlan } from './risk';
import { getUsdtMarket } from './market';
import { getLiveReadiness } from './livePreflight';
import { engageKillSwitch, getExecutionSafety } from './safety';
import { getLiveAssetFree, getLiveUsdtBalance, getLiveSymbolRules, placeLiveMarketBuy, placeLiveMarketSell, placeLiveProtectiveStop, cancelLiveOrder, getLiveOrder } from './binanceLive';

const armedUntil=new Map<number,number>();
const ARM_TTL_MS=10*60_000;
const ARM_PHRASE=process.env.LIVE_ARM_PHRASE||'CANLI SPOT 10 DAKIKA';

function avgFill(order:any){
  const qty=Number(order.executedQty||0), quote=Number(order.cummulativeQuoteQty||0);
  return qty>0&&quote>0?quote/qty:0;
}
function netBaseQty(order:any,baseAsset:string){
  let qty=Number(order.executedQty||0);
  for(const f of Array.isArray(order.fills)?order.fills:[]){
    if(String(f.commissionAsset||'')===baseAsset) qty-=Number(f.commission||0);
  }
  return Math.max(0,qty);
}
export function liveArmingStatus(userId:number){
  const until=armedUntil.get(userId)||0;return {armed:until>Date.now(),armedUntil:until,remainingSeconds:Math.max(0,Math.floor((until-Date.now())/1000))};
}
export async function armLiveSession(userId:number,phrase:string){
  if(process.env.ENABLE_LIVE_MANUAL_TRADING!=='true') throw new Error('Sunucuda ENABLE_LIVE_MANUAL_TRADING=true değil.');
  if(phrase!==ARM_PHRASE) throw new Error('Canlı arming doğrulama ifadesi eşleşmedi.');
  const readiness=await getLiveReadiness(userId);
  if(!readiness.readyForV11Review) throw new Error('V10 readiness gate tamamlanmadı.');
  const safety=await getExecutionSafety(userId);
  if(safety.safeMode||safety.runtimeKillSwitch) throw new Error('SAFE MODE / KILL SWITCH aktif.');
  if(safety.automationMode==='FULL_AUTO') throw new Error('LIVE FULL_AUTO V11 içinde yasak.');
  const until=Date.now()+ARM_TTL_MS;armedUntil.set(userId,until);
  return {armed:true,armedUntil:until,remainingSeconds:ARM_TTL_MS/1000};
}
export function disarmLiveSession(userId:number){armedUntil.delete(userId);return {armed:false,armedUntil:0,remainingSeconds:0};}
function assertArmed(userId:number){const s=liveArmingStatus(userId);if(!s.armed)throw new Error('Canlı işlem oturumu ARM edilmemiş veya süresi dolmuş.');return s;}

async function liveContext(userId:number){
  const db=await getDb();
  const rows=await db.all("SELECT quantity,average_entry,stop_loss FROM live_positions WHERE user_id=? AND status='OPEN'",[userId]);
  const usdt=await getLiveUsdtBalance();
  const managedValue=rows.reduce((s:number,p:any)=>s+Number(p.quantity||0)*Number(p.average_entry||0),0);
  const openRisk=rows.reduce((s:number,p:any)=>s+Math.max(0,(Number(p.average_entry||0)-Number(p.stop_loss||0))*Number(p.quantity||0)),0);
  const realized=(await db.get("SELECT COALESCE(SUM(realized_pnl),0) pnl FROM live_trade_history WHERE user_id=? AND created_at>=?",[userId,new Date().setHours(0,0,0,0)]))?.pnl||0;
  const equity=Math.max(1,usdt+managedValue);
  return {rows,usdt,managedValue,openRisk,realizedPnl:Number(realized),dailyPct:Number(realized)/equity*100,equity};
}

export async function executeControlledLiveBuy(userId:number,symbol:string,requestedSpend:number,origin:string){
  assertArmed(userId);
  const readiness=await getLiveReadiness(userId);
  if(!readiness.readyForV11Review) throw new Error('Live readiness gate artık geçerli değil.');
  const safety=await getExecutionSafety(userId);
  if(safety.automationMode==='FULL_AUTO') throw new Error('LIVE FULL_AUTO yasak.');
  if(safety.automationMode==='MANUAL'&&origin!=='MANUAL') throw new Error('LIVE MANUAL mod yalnızca kullanıcı işlemi kabul eder.');
  if(safety.automationMode==='SEMI_AUTO'&&!['MANUAL','SIGNAL_APPROVAL'].includes(origin)) throw new Error('LIVE SEMI_AUTO explicit onay ister.');
  const db=await getDb();
  const existing=await db.get("SELECT 1 FROM live_positions WHERE user_id=? AND symbol=? AND status='OPEN'",[userId,symbol]);
  if(existing) throw new Error('Bu sembolde yönetilen canlı pozisyon zaten açık.');

  const ctx=await liveContext(userId);
  const plan:any=await buildRiskPlan(userId,symbol,{equityApprox:ctx.equity,openPositions:ctx.rows.length,openRisk:ctx.openRisk,dailyPct:ctx.dailyPct,realizedPnl:ctx.realizedPnl});
  if(!plan.allowed) throw new Error(`Risk Manager engelledi: ${plan.blocks.join(' ')}`);
  const cap=Math.min(Number(readiness.liveCapitalCapUsd||0),Number(readiness.hardCapUsd||0));
  const remainingCap=Math.max(0,cap-ctx.managedValue);
  const spend=Math.min(requestedSpend>0?requestedSpend:plan.execution.suggestedSpend,plan.execution.suggestedSpend,ctx.usdt,remainingCap);
  if(spend<10) throw new Error('Canlı sermaye tavanı/bakiye/risk planı işlem için yetersiz.');

  const rules=await getLiveSymbolRules(symbol);
  const buyId=`kaiL${Date.now()}${crypto.randomBytes(3).toString('hex')}`.slice(0,36);
  const buy=await placeLiveMarketBuy(symbol,spend,buyId);
  const avg=avgFill(buy), qty=netBaseQty(buy,rules.baseAsset);
  if(String(buy.status)!=='FILLED'||avg<=0||qty<=0){
    engageKillSwitch('Canlı BUY beklenen FILLED durumuna ulaşmadı.');
    throw new Error(`Canlı BUY güvenli şekilde tamamlanmadı: ${buy.status}`);
  }

  let stop:any=null;
  try{
    const stopId=`kaiS${Date.now()}${crypto.randomBytes(3).toString('hex')}`.slice(0,36);
    stop=await placeLiveProtectiveStop(symbol,qty,Number(plan.execution.stopLoss),stopId);
    const riskAmount=Math.max(0,(avg-Number(plan.execution.stopLoss))*qty);
    await db.run(`INSERT INTO live_positions
      (user_id,symbol,base_asset,quantity,average_entry,stop_loss,stop_order_id,risk_amount,opened_at,last_reconciled_at,status)
      VALUES (?,?,?,?,?,?,?,?,?,?, 'OPEN')`,
      [userId,symbol,rules.baseAsset,qty,avg,Number(plan.execution.stopLoss),String(stop.orderId||''),riskAmount,Date.now(),Date.now()]);
    await db.run('INSERT INTO execution_audit (id,user_id,environment,automation_mode,symbol,side,requested_value,exchange_order_id,status,response_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [crypto.randomUUID(),userId,'LIVE',safety.automationMode,symbol,'BUY',spend,String(buy.orderId||''),String(buy.status||''),JSON.stringify({buy,protectiveStop:stop}),Date.now()]);
    return {buy,protectiveStop:stop,position:{symbol,quantity:qty,averageEntry:avg,stopLoss:Number(plan.execution.stopLoss)},capitalCap:cap};
  }catch(e:any){
    engageKillSwitch('Canlı alış sonrası exchange-native STOP_LOSS kurulamadı.');
    try{
      const free=await getLiveAssetFree(rules.baseAsset);
      const sellQty=Math.min(qty,free);
      if(sellQty>0){
        const m=await getUsdtMarket(symbol);
        await placeLiveMarketSell(symbol,sellQty,m.bidPrice||m.price,`kaiE${Date.now()}`.slice(0,36));
      }
    }catch(closeErr:any){
      await db.run('INSERT INTO system_health_log (id,component,severity,message,created_at) VALUES (?,?,?,?,?)',
        [crypto.randomUUID(),'LIVE_PROTECTION','CRITICAL',`STOP kurulamadı ve acil kapama da başarısız: ${e.message} | ${closeErr.message}`,Date.now()]);
    }
    throw new Error(`Canlı pozisyon koruması kurulamadı; acil geri-kapama denendi. ${e.message}`);
  }
}

export async function reconcileLivePosition(userId:number,symbol:string){
  const db=await getDb();const p=await db.get("SELECT * FROM live_positions WHERE user_id=? AND symbol=? AND status='OPEN'",[userId,symbol]);
  if(!p)return {ok:true,status:'NO_MANAGED_POSITION',symbol};
  const stop=await getLiveOrder(symbol,String(p.stop_order_id));
  if(String(stop.status)==='FILLED'){
    const exit=Number(stop.stopPrice||p.stop_loss),pnl=(exit-Number(p.average_entry))*Number(p.quantity);
    await db.run("UPDATE live_positions SET status='CLOSED',quantity=0,last_reconciled_at=? WHERE user_id=? AND symbol=?",[Date.now(),userId,symbol]);
    await db.run('INSERT INTO live_trade_history (id,user_id,symbol,side,quantity,price,realized_pnl,reason,exchange_order_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [crypto.randomUUID(),userId,symbol,'SELL',Number(p.quantity),exit,pnl,'EXCHANGE_STOP',String(p.stop_order_id),Date.now()]);
    return {ok:true,status:'STOP_FILLED',symbol};
  }
  if(!['NEW','PARTIALLY_FILLED'].includes(String(stop.status))) return {ok:false,status:String(stop.status),symbol,reason:'Protective stop beklenmeyen durumda.'};
  await db.run('UPDATE live_positions SET last_reconciled_at=? WHERE user_id=? AND symbol=?',[Date.now(),userId,symbol]);
  return {ok:true,status:'PROTECTED',symbol,stopOrderId:p.stop_order_id,stopStatus:stop.status};
}

export async function reconcileAllLivePositions(userId:number){
  const db=await getDb();const rows=await db.all("SELECT symbol FROM live_positions WHERE user_id=? AND status='OPEN'",[userId]);const results=[];
  for(const r of rows){try{results.push(await reconcileLivePosition(userId,String(r.symbol)))}catch(e:any){results.push({ok:false,symbol:r.symbol,reason:e.message})}}
  const ok=results.every((x:any)=>x.ok);if(!ok)engageKillSwitch('Canlı protective-order reconciliation hatası.');
  return {ok,count:results.length,results,checkedAt:Date.now()};
}

export async function closeControlledLivePosition(userId:number,symbol:string,origin:string){
  if(!['MANUAL','SIGNAL_APPROVAL'].includes(origin)) throw new Error('Canlı pozisyon kapama explicit kullanıcı/onay kaynağı gerektirir.');
  const db=await getDb();const p=await db.get("SELECT * FROM live_positions WHERE user_id=? AND symbol=? AND status='OPEN'",[userId,symbol]);
  if(!p)throw new Error('Yönetilen açık canlı pozisyon yok.');
  const rec=await reconcileLivePosition(userId,symbol);
  if(rec.status==='STOP_FILLED')return {alreadyClosed:true,reason:'EXCHANGE_STOP'};
  if(!rec.ok)throw new Error(`Reconciliation başarısız: ${rec.reason}`);
  await cancelLiveOrder(symbol,String(p.stop_order_id));
  const free=await getLiveAssetFree(String(p.base_asset));const qty=Math.min(Number(p.quantity),free);
  if(qty<=0)throw new Error('Stop iptal sonrası satılabilir yönetilen miktar bulunamadı.');
  const m=await getUsdtMarket(symbol);
  const sell=await placeLiveMarketSell(symbol,qty,m.bidPrice||m.price,`kaiC${Date.now()}`.slice(0,36));
  const exit=avgFill(sell)||Number(m.bidPrice||m.price);const sold=Number(sell.executedQty||qty);const pnl=(exit-Number(p.average_entry))*sold;
  await db.run("UPDATE live_positions SET status='CLOSED',quantity=0,last_reconciled_at=? WHERE user_id=? AND symbol=?",[Date.now(),userId,symbol]);
  await db.run('INSERT INTO live_trade_history (id,user_id,symbol,side,quantity,price,realized_pnl,reason,exchange_order_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [crypto.randomUUID(),userId,symbol,'SELL',sold,exit,pnl,'MANUAL_CLOSE',String(sell.orderId||''),Date.now()]);
  await db.run('INSERT INTO execution_audit (id,user_id,environment,automation_mode,symbol,side,requested_value,exchange_order_id,status,response_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [crypto.randomUUID(),userId,'LIVE','CONTROLLED',symbol,'SELL',sold,String(sell.orderId||''),String(sell.status||''),JSON.stringify(sell),Date.now()]);
  return {sell,sold,exit,realizedPnl:pnl};
}
