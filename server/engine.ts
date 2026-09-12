import { getDb } from './db';
import { buildRiskPlan } from './risk';

const PAPER_FEE_RATE = Number(process.env.PAPER_FEE_RATE || 0.001);

export async function executeSpotBuy(userId:number,symbol:string,requestedSpend:number,currentPrice:number, useRiskPlan=true){
  if(!Number.isFinite(currentPrice)||currentPrice<=0) throw new Error('Geçersiz piyasa fiyatı.');
  const db=await getDb();
  const existing=await db.get('SELECT * FROM portfolio_positions WHERE user_id = ? AND symbol = ?', [userId,symbol]);
  if(existing) throw new Error('V3 managed mode aynı coinde ek alıma izin vermiyor. Önce mevcut pozisyonu kapatın.');
  const user=await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
  if(!user) throw new Error('Kullanıcı bulunamadı.');

  let plan:any=null;
  let spend=requestedSpend;
  if(useRiskPlan){
    plan=await buildRiskPlan(userId,symbol);
    if(!plan.allowed) throw new Error(`Risk Manager işlemi engelledi: ${plan.blocks.join(' ')}`);
    const settings=await db.get('SELECT positionSizePercent FROM settings WHERE user_id = ?',[userId]);
    const positionSizePercent=Math.max(5,Math.min(50,Number(settings?.positionSizePercent||25)));
    const equityApprox=Number(plan.daily?.equityApprox || user.balance);
    const positionCap=equityApprox * (positionSizePercent / 100);
    const availableBalance=Math.max(0, Number(user.balance) / (1 + PAPER_FEE_RATE));
    const calculatedSpend=Math.min(plan.execution.suggestedSpend, positionCap, availableBalance);
    spend = requestedSpend>0 ? Math.min(requestedSpend, calculatedSpend) : calculatedSpend;
  }
  if(!Number.isFinite(spend)||spend<=0) throw new Error('Geçersiz işlem tutarı.');
  const fee=spend*PAPER_FEE_RATE, totalDebit=spend+fee;
  if(user.balance<totalDebit) throw new Error('Yetersiz USDT bakiyesi.');
  const amountBought=spend/currentPrice;

  const stopLoss=plan?.execution.stopLoss ?? currentPrice*0.98;
  const takeProfit1=plan?.execution.takeProfit1 ?? currentPrice*1.025;
  const takeProfit2=plan?.execution.takeProfit2 ?? currentPrice*1.05;
  const trailingActivation=plan?.execution.trailingActivation ?? currentPrice*1.03;
  const trailingDistancePct=plan?.execution.trailingDistancePct ?? 1.0;
  const riskAmount=(currentPrice-stopLoss)*amountBought;

  await db.run('BEGIN TRANSACTION');
  try{
    await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [totalDebit,userId]);
    await db.run(`INSERT INTO portfolio_positions
      (user_id,symbol,amount,averageBuyPrice,type,margin,leverage,stopLoss,takeProfit1,takeProfit2,trailingActivation,trailingDistancePct,highestPrice,riskAmount,tp1Hit,tp2Hit,managed)
      VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?,?,0,0,1)`,
      [userId,symbol,amountBought,currentPrice,'LONG',spend,stopLoss,takeProfit1,takeProfit2,trailingActivation,trailingDistancePct,currentPrice,riskAmount]);
    await db.run('INSERT INTO trade_history (user_id,symbol,type,price,amount,margin,leverage,realized_pnl,timestamp) VALUES (?,?,?,?,?,?,1,?,?)',
      [userId,symbol,'BUY',currentPrice,amountBought,spend,-fee,Date.now()]);
    await db.run('COMMIT');
    return {success:true,amountBought,fee,spend,plan};
  }catch(err){ await db.run('ROLLBACK'); throw err; }
}

export async function sellSpotAmount(userId:number,symbol:string,currentPrice:number,amountToSell?:number,reason='MANUAL'){
  const db=await getDb();
  const existing=await db.get('SELECT * FROM portfolio_positions WHERE user_id = ? AND symbol = ?', [userId,symbol]);
  if(!existing) throw new Error('Bu varlıkta açık spot pozisyon bulunamadı.');
  const amount=Math.min(Number(amountToSell||existing.amount),Number(existing.amount));
  if(!Number.isFinite(amount)||amount<=0) throw new Error('Geçersiz satış miktarı.');
  const gross=amount*currentPrice, fee=gross*PAPER_FEE_RATE, net=gross-fee;
  const cost=amount*Number(existing.averageBuyPrice), pnl=net-cost;
  const remaining=Number(existing.amount)-amount;

  await db.run('BEGIN TRANSACTION');
  try{
    if(remaining<=1e-12) await db.run('DELETE FROM portfolio_positions WHERE id = ?', [existing.id]);
    else {
      const remainingRisk=Math.max(0,(Number(existing.averageBuyPrice)-Number(existing.stopLoss||existing.averageBuyPrice))*remaining);
      await db.run('UPDATE portfolio_positions SET amount = ?, margin = ?, riskAmount = ? WHERE id = ?', [remaining,remaining*Number(existing.averageBuyPrice),remainingRisk,existing.id]);
    }
    await db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [net,userId]);
    await db.run('INSERT INTO trade_history (user_id,symbol,type,price,amount,margin,leverage,realized_pnl,timestamp) VALUES (?,?,?,?,?,?,1,?,?)',
      [userId,symbol,`SELL:${reason}`,currentPrice,amount,cost,pnl,Date.now()]);
    await db.run('COMMIT');
    return {success:true,pnl,fee,amountSold:amount,remaining,reason};
  }catch(err){ await db.run('ROLLBACK'); throw err; }
}

export async function closeSpotPosition(userId:number,symbol:string,currentPrice:number){
  return sellSpotAmount(userId,symbol,currentPrice,undefined,'MANUAL_CLOSE');
}

export async function managePositionTick(userId:number,symbol:string,currentPrice:number){
  const db=await getDb();
  const p=await db.get('SELECT * FROM portfolio_positions WHERE user_id = ? AND symbol = ?', [userId,symbol]);
  if(!p || !p.managed) return null;
  const highest=Math.max(Number(p.highestPrice||p.averageBuyPrice),currentPrice);
  let stop=Number(p.stopLoss||0);
  const activation=Number(p.trailingActivation||Infinity), trailPct=Number(p.trailingDistancePct||1);
  if(currentPrice>=activation){
    const trailingStop=highest*(1-trailPct/100);
    stop=Math.max(stop,trailingStop,Number(p.averageBuyPrice)*1.001);
  }
  if(highest!==Number(p.highestPrice||0) || stop!==Number(p.stopLoss||0)) await db.run('UPDATE portfolio_positions SET highestPrice = ?, stopLoss = ? WHERE id = ?', [highest,stop,p.id]);

  if(stop>0 && currentPrice<=stop) return await sellSpotAmount(userId,symbol,currentPrice,undefined,currentPrice<Number(p.averageBuyPrice)?'STOP_LOSS':'TRAILING_STOP');
  if(!p.tp1Hit && Number(p.takeProfit1||0)>0 && currentPrice>=Number(p.takeProfit1)){
    const result=await sellSpotAmount(userId,symbol,currentPrice,Number(p.amount)*0.25,'TP1');
    await db.run('UPDATE portfolio_positions SET tp1Hit = 1, stopLoss = MAX(stopLoss, averageBuyPrice * 1.001) WHERE user_id = ? AND symbol = ?', [userId,symbol]);
    return result;
  }
  if(!p.tp2Hit && Number(p.takeProfit2||0)>0 && currentPrice>=Number(p.takeProfit2)){
    const fresh=await db.get('SELECT * FROM portfolio_positions WHERE user_id = ? AND symbol = ?', [userId,symbol]);
    if(!fresh) return null;
    const result=await sellSpotAmount(userId,symbol,currentPrice,Number(fresh.amount)/3,'TP2');
    await db.run('UPDATE portfolio_positions SET tp2Hit = 1 WHERE user_id = ? AND symbol = ?', [userId,symbol]);
    return result;
  }
  return null;
}
