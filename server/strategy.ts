import { buildV2Analysis, scoreTimeframe } from './analysis';
import { getKlines } from './market';
import { buildNewsIntelligence } from './news';
import { engineThresholds, combinedThresholds, PAPER100_TEST_MODE } from './tradingConfig';

export type StrategyName = 'SCALP'|'DAY'|'SWING';
export type EngineVerdict = 'BUY_CANDIDATE'|'WATCH'|'NO_TRADE';

export type Tf = ReturnType<typeof scoreTimeframe>;

function clamp(v:number,min=0,max=100){ return Math.max(min,Math.min(max,v)); }
function avg(xs:number[]){ return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0; }
function std(xs:number[]){ const m=avg(xs); return xs.length ? Math.sqrt(avg(xs.map(x=>(x-m)**2))) : 0; }

export const REGIME_BIAS: Record<StrategyName, Record<string, number>> = {
  SCALP: { STRONG_BULL:4, BULL:5, SIDEWAYS:8, HIGH_VOLATILITY:-10, BEAR:-12, PANIC:-50 },
  DAY:   { STRONG_BULL:10, BULL:8, SIDEWAYS:0, HIGH_VOLATILITY:-6, BEAR:-14, PANIC:-50 },
  SWING: { STRONG_BULL:12, BULL:10, SIDEWAYS:-6, HIGH_VOLATILITY:-10, BEAR:-18, PANIC:-50 }
};

export const STRATEGY_TIMEFRAMES: Record<StrategyName, string[]> = {
  SCALP: ['5m', '15m', '1h'],
  DAY:   ['15m', '1h', '4h'],
  SWING: ['1h', '4h', '1d']
};

export const STRATEGY_WEIGHTS: Record<StrategyName, Record<string, number>> = {
  SCALP: {'5m':.34,'15m':.36,'1h':.22,'4h':.08},
  DAY:   {'15m':.18,'1h':.40,'4h':.32,'1d':.10},
  SWING: {'1h':.10,'4h':.42,'1d':.48}
};

export function evaluateStrategyEngine(
  name:StrategyName,
  frames:Record<string,Tf>,
  weights:Record<string,number>,
  base:{ opportunity:number; risk:number; confidence:number; regime?:any; spreadPercent?:number }
){
  return engine(name, frames, weights, {
    opportunity: base.opportunity,
    risk: base.risk,
    confidence: base.confidence,
    regime: base.regime || { label: 'SIDEWAYS' },
    spreadPercent: base.spreadPercent || 0.05
  });
}

function engine(
  name:StrategyName,
  frames:Record<string,Tf>,
  weights:Record<string,number>,
  base:{ opportunity:number; risk:number; confidence:number; regime:any; spreadPercent:number }
){
  const entries=Object.entries(weights);
  const trend=entries.reduce((s,[k,w])=>s+frames[k].trend*w,0);
  const momentum=entries.reduce((s,[k,w])=>s+frames[k].momentum*w,0);
  const volume=entries.reduce((s,[k,w])=>s+frames[k].volume*w,0);
  const adx=entries.reduce((s,[k,w])=>s+frames[k].adx*w,0);
  const atr=entries.reduce((s,[k,w])=>s+frames[k].atrPct*w,0);
  const frameTrends=entries.map(([k])=>frames[k].trend);
  const alignment=clamp(100-std(frameTrends)*2.1);
  const spreadPenalty=name==='SCALP' ? base.spreadPercent*700 : name==='DAY' ? base.spreadPercent*350 : base.spreadPercent*160;
  const atrPenalty=name==='SCALP' ? Math.max(0,atr-1.6)*8 : name==='DAY' ? Math.max(0,atr-3)*5 : Math.max(0,atr-5)*3;
  const regimeBias=REGIME_BIAS[name][base.regime.label] ?? 0;

  let score = trend*.31 + momentum*.24 + volume*.18 + clamp(adx)*.09 + alignment*.10 + base.opportunity*.08;
  score = clamp(score + regimeBias - spreadPenalty - atrPenalty);
  let confidence = clamp(base.confidence*.42 + alignment*.38 + clamp(adx)*.20 - Math.max(0,base.risk-35)*.25);
  const risk = clamp(base.risk + Math.max(0,55-alignment)*.35 + Math.max(0,atr-2)*2 + (name==='SCALP'?spreadPenalty*.55:spreadPenalty*.25));

  const { minScore, minConfidence, maxRisk } = engineThresholds(name);
  const regimeBlocked=base.regime.label==='PANIC' || (name==='SWING' && base.regime.label==='BEAR');
  const eligible=!regimeBlocked && score>=minScore && confidence>=minConfidence && risk<=maxRisk;
  const watch=!regimeBlocked && !eligible && score>=minScore-8 && confidence>=minConfidence-10 && risk<=maxRisk+10;
  const verdict:EngineVerdict=eligible?'BUY_CANDIDATE':watch?'WATCH':'NO_TRADE';

  return {
    name, score:Math.round(score), risk:Math.round(risk), confidence:Math.round(confidence), alignment:Math.round(alignment), verdict,
    metrics:{trend:Math.round(trend),momentum:Math.round(momentum),volume:Math.round(volume),adx:Math.round(adx),atrPct:Number(atr.toFixed(2)),regimeBias,spreadPenalty:Number(spreadPenalty.toFixed(2))},
    thresholds:{minScore,minConfidence,maxRisk},
    reason: regimeBlocked ? `Piyasa rejimi ${base.regime.label}; ${name} yeni spot alımı bloke.` : eligible ? 'Motorun skor/risk/confidence eşikleri sağlandı.' : watch ? 'Sınırda fırsat; teyit bekleniyor.' : 'Motor eşikleri sağlanmadı.'
  };
}

export async function buildStrategyDecision(symbol:string){
  const upper=symbol.toUpperCase();
  const [base,c5,news]=await Promise.all([buildV2Analysis(upper),getKlines(upper,'5m',160),buildNewsIntelligence(upper)]) as [Awaited<ReturnType<typeof buildV2Analysis>>, any[], Awaited<ReturnType<typeof buildNewsIntelligence>>];
  const frames:Record<string,Tf>={
    '5m':scoreTimeframe(c5),
    '15m':base.timeframes['15m'],
    '1h':base.timeframes['1h'],
    '4h':base.timeframes['4h'],
    '1d':base.timeframes['1d']
  };
  const common={opportunity:base.opportunity,risk:base.risk,confidence:base.confidence,regime:base.regime,spreadPercent:base.coin.spreadPercent};
  const scalp=engine('SCALP',frames,{'5m':.34,'15m':.36,'1h':.22,'4h':.08},common);
  const day=engine('DAY',frames,{'15m':.18,'1h':.40,'4h':.32,'1d':.10},common);
  const swing=engine('SWING',frames,{'1h':.10,'4h':.42,'1d':.48},common);
  const engines=[scalp,day,swing];
  const eligible=engines.filter(e=>e.verdict==='BUY_CANDIDATE');
  const watch=engines.filter(e=>e.verdict==='WATCH');
  const ranked=[...engines].sort((a,b)=>(b.score-b.risk*.35+b.confidence*.25)-(a.score-a.risk*.35+a.confidence*.25));
  const primary=ranked[0];
  const consensusCount=eligible.length;
  const agreementBonus=consensusCount>=3?8:consensusCount===2?5:consensusCount===1?1:0;
  const conflictPenalty=eligible.length>0 && engines.some(e=>e.score<60)?8:0;
  const opportunity=Math.round(clamp(avg([base.opportunity,primary.score]) + agreementBonus - conflictPenalty + news.score.opportunityAdjustment));
  const risk=Math.round(clamp(avg([base.risk,primary.risk]) - (consensusCount>=2?3:0) + conflictPenalty + news.score.riskAdjustment));
  const confidence=Math.round(clamp(avg([base.confidence,primary.confidence]) + agreementBonus - conflictPenalty + news.score.confidenceAdjustment));
  const veto=base.veto.active ? base.veto : news.veto.active ? news.veto : {active:false,reason:''};
  const combined=combinedThresholds();
  const action=!veto.active && consensusCount>0 && opportunity>=combined.opportunity && risk<=combined.maxRisk && confidence>=combined.confidence ? 'BUY_CANDIDATE' : 'NO_TRADE';
  return {
    symbol:upper,
    action,
    opportunity,risk,confidence,
    primaryStrategy: primary.name,
    consensusCount,
    watchCount:watch.length,
    conflictPenalty,
    veto,
    regime:base.regime,
    coin:base.coin,
    engines:{SCALP:scalp,DAY:day,SWING:swing},
    timeframes:frames,
    baseAnalysis:base,
    news,
    thresholds:{...combined,mode:PAPER100_TEST_MODE?'PAPER100_TEST':'PRODUCTION'},
    summary: action==='BUY_CANDIDATE'
      ? `${primary.name} birincil motor; ${consensusCount}/3 motor BUY_CANDIDATE. Haber seviyesi ${news.level}. Birleşik karar uygun.`
      : `${primary.name} en güçlü motor; BUY teyidi ${consensusCount}/3. Haber seviyesi ${news.level}. NO TRADE.`
  };
}
