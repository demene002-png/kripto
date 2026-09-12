import { buildStrategyDecision } from './strategy';
import { getDb } from './db';
import { getTopUsdtMarkets } from './market';

export type RiskProfile = 'CONSERVATIVE'|'BALANCED'|'AGGRESSIVE'|'CUSTOM';

const PROFILE_DEFAULTS: Record<Exclude<RiskProfile,'CUSTOM'>, {riskPerTradePercent:number;maxDailyLossPercent:number;maxOpenRiskPercent:number;maxPositions:number}> = {
  CONSERVATIVE: { riskPerTradePercent: 0.35, maxDailyLossPercent: 1.25, maxOpenRiskPercent: 1.0, maxPositions: 2 },
  BALANCED: { riskPerTradePercent: 0.5, maxDailyLossPercent: 2.0, maxOpenRiskPercent: 1.75, maxPositions: 3 },
  AGGRESSIVE: { riskPerTradePercent: 0.85, maxDailyLossPercent: 3.0, maxOpenRiskPercent: 3.0, maxPositions: 5 }
};

function clamp(v:number,min:number,max:number){ return Math.max(min,Math.min(max,v)); }

export async function getRiskSettings(userId:number){
  const db=await getDb();
  const s=await db.get('SELECT * FROM settings WHERE user_id = ?', [userId]);
  const profile=(s?.riskProfile || 'BALANCED') as RiskProfile;
  const dailyTargetPercent=clamp(Number(s?.dailyTargetPercent||3),0.5,25);
  const positionSizePercent=clamp(Number(s?.positionSizePercent ?? 25),5,50);
  if(profile !== 'CUSTOM') return { profile, dailyTargetPercent, positionSizePercent, ...PROFILE_DEFAULTS[profile as Exclude<RiskProfile,'CUSTOM'>] };
  return {
    profile,
    dailyTargetPercent,
    positionSizePercent,
    riskPerTradePercent: clamp(Number(s?.riskPerTradePercent || 0.5),0.1,2),
    maxDailyLossPercent: clamp(Number(s?.maxDailyLossPercent || 2),0.5,8),
    maxOpenRiskPercent: clamp(Number(s?.maxOpenRiskPercent || 1.75),0.5,8),
    maxPositions: Math.round(clamp(Number(s?.maxPositions || 3),1,8))
  };
}

export async function getDailyRiskState(userId:number){
  const db=await getDb();
  const now=new Date();
  const start=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
  const user=await db.get('SELECT balance FROM users WHERE id = ?', [userId]);
  const positions=await db.all('SELECT * FROM portfolio_positions WHERE user_id = ?', [userId]);
  const realized=await db.get('SELECT COALESCE(SUM(realized_pnl),0) AS pnl FROM trade_history WHERE user_id = ? AND timestamp >= ?', [userId,start]);
  const base=Math.max(1, Number(user?.balance||0)+positions.reduce((s:number,p:any)=>s+Number(p.amount||0)*Number(p.averageBuyPrice||0),0));
  const dailyPct=Number(realized?.pnl||0)/base*100;
  const openRisk=positions.reduce((s:number,p:any)=>s+Number(p.riskAmount||0),0);
  const openRiskPct=openRisk/base*100;
  return { realizedPnl:Number(realized?.pnl||0), dailyPct, openRisk, openRiskPct, equityApprox:base, openPositions:positions.length };
}

export async function buildRiskPlan(userId:number,symbol:string, overrides?:{equityApprox?:number;openPositions?:number;openRisk?:number;dailyPct?:number;realizedPnl?:number}){
  const [analysis,markets,settings,daily]=await Promise.all([
    buildStrategyDecision(symbol), getTopUsdtMarkets(100), getRiskSettings(userId), getDailyRiskState(userId)
  ]);
  const dailyEffective={
    ...daily,
    equityApprox: overrides?.equityApprox ?? daily.equityApprox,
    openPositions: overrides?.openPositions ?? daily.openPositions,
    openRisk: overrides?.openRisk ?? daily.openRisk,
    dailyPct: overrides?.dailyPct ?? daily.dailyPct,
    realizedPnl: overrides?.realizedPnl ?? daily.realizedPnl
  };
  dailyEffective.openRiskPct = dailyEffective.equityApprox>0 ? dailyEffective.openRisk/dailyEffective.equityApprox*100 : 0;
  const coin=markets.find(m=>m.symbol===symbol.toUpperCase());
  if(!coin) throw new Error('Piyasa verisi bulunamadı.');
  const price=coin.askPrice || coin.price;
  const atrPct=Math.max(0.25, Number(analysis.timeframes?.['1h']?.atrPct || 0.8));
  const structureBuffer=Math.max(atrPct*1.6, analysis.regime.label==='HIGH_VOLATILITY'?2.2:1.0);
  const stopDistancePct=clamp(structureBuffer,0.8,6.0);
  const stopLoss=price*(1-stopDistancePct/100);
  const oneR=price-stopLoss;
  const takeProfit1=price+oneR*1.25;
  const takeProfit2=price+oneR*2.25;
  const trailingActivation=price+oneR*1.5;
  const trailingDistancePct=clamp(Math.max(atrPct*1.25,0.7),0.6,4.0);

  const riskBudget=dailyEffective.equityApprox*(settings.riskPerTradePercent/100);
  const rawPosition=riskBudget/(stopDistancePct/100);
  const positionCap=Math.max(0, dailyEffective.equityApprox * ((settings.positionSizePercent || 25) / 100));
  const remainingRiskBudgetPct=Math.max(0, settings.maxOpenRiskPercent - dailyEffective.openRiskPct);
  const remainingRiskBudgetUsd=dailyEffective.equityApprox * (remainingRiskBudgetPct / 100);
  const maxByOpenRisk=remainingRiskBudgetUsd > 0 ? (remainingRiskBudgetUsd / (stopDistancePct / 100)) : 0;
  const suggestedSpend=Math.min(rawPosition, positionCap, maxByOpenRisk);

  const feeRate=Number(process.env.PAPER_FEE_RATE || 0.001);
  const spreadPct=Math.max(0,coin.spreadPercent||0);
  const slippagePct=clamp(spreadPct*0.5 + atrPct*0.06,0.02,0.35);
  const roundTripCostPct=feeRate*200 + spreadPct + slippagePct*2;
  const grossTargetPct=((takeProfit1/price)-1)*100;
  const netTargetPct=grossTargetPct-roundTripCostPct;

  const target=settings.dailyTargetPercent;
  const cautionAt=Math.max(0.5,target-1);
  const lockdownAt=target+2;
  const profitProtectionLevel = dailyEffective.dailyPct >= lockdownAt ? 'LOCKDOWN' : dailyEffective.dailyPct >= target ? 'TARGET_REACHED' : dailyEffective.dailyPct >= cautionAt ? 'CAUTION' : 'NORMAL';
  const qualityThreshold = profitProtectionLevel==='LOCKDOWN'?92:profitProtectionLevel==='TARGET_REACHED'?88:profitProtectionLevel==='CAUTION'?84:80;
  const blocks:string[]=[];
  if(analysis.veto.active) blocks.push(analysis.veto.reason);
  if(analysis.opportunity<qualityThreshold) blocks.push(`Opportunity ${analysis.opportunity}; gerekli eşik ${qualityThreshold}.`);
  if(analysis.risk>45) blocks.push(`Risk skoru ${analysis.risk}/100 ile yüksek.`);
  if(analysis.confidence<70) blocks.push(`Confidence ${analysis.confidence}/100 ile yetersiz.`);
  if(dailyEffective.openPositions>=settings.maxPositions) blocks.push(`Maksimum ${settings.maxPositions} açık pozisyon sınırı dolu.`);
  if(dailyEffective.openRiskPct>=settings.maxOpenRiskPercent) blocks.push(`Toplam açık risk limiti %${settings.maxOpenRiskPercent.toFixed(2)} dolu.`);
  if(dailyEffective.dailyPct<=-settings.maxDailyLossPercent) blocks.push(`Günlük maksimum zarar limiti -%${settings.maxDailyLossPercent.toFixed(2)} aşıldı.`);
  if(netTargetPct<0.35) blocks.push(`Komisyon/spread/slippage sonrası net hedef çok düşük (%${netTargetPct.toFixed(2)}).`);
  if(suggestedSpend<10) blocks.push('Risk bazlı pozisyon tutarı minimum işlem eşiğinin altında.');

  return {
    allowed: blocks.length===0,
    blocks,
    profile:settings.profile,
    settings,
    daily:{...dailyEffective, profitProtectionLevel, qualityThreshold},
    analysis:{opportunity:analysis.opportunity,risk:analysis.risk,confidence:analysis.confidence,regime:analysis.regime.label,veto:analysis.veto,primaryStrategy:analysis.primaryStrategy,consensusCount:analysis.consensusCount,engines:analysis.engines,news:analysis.news},
    execution:{
      entry:Number(price.toFixed(10)),
      suggestedSpend:Number(suggestedSpend.toFixed(2)),
      riskBudget:Number(riskBudget.toFixed(2)),
      stopLoss:Number(stopLoss.toFixed(10)),
      stopDistancePct:Number(stopDistancePct.toFixed(2)),
      takeProfit1:Number(takeProfit1.toFixed(10)),
      takeProfit2:Number(takeProfit2.toFixed(10)),
      trailingActivation:Number(trailingActivation.toFixed(10)),
      trailingDistancePct:Number(trailingDistancePct.toFixed(2)),
      spreadPct:Number(spreadPct.toFixed(4)),
      slippagePct:Number(slippagePct.toFixed(4)),
      roundTripCostPct:Number(roundTripCostPct.toFixed(4)),
      estimatedNetTp1Pct:Number(netTargetPct.toFixed(2)),
      riskRewardTp1:Number((1.25).toFixed(2)),
      riskRewardTp2:Number((2.25).toFixed(2))
    }
  };
}
