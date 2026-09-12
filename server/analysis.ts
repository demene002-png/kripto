import { getKlines, getTopUsdtMarkets, MarketCoin } from './market';

type Candle = { time:number; open:number; high:number; low:number; close:number; volume:number };

export type RegimeLabel = 'STRONG_BULL'|'BULL'|'SIDEWAYS'|'HIGH_VOLATILITY'|'BEAR'|'PANIC';

function clamp(v:number,min=0,max=100){ return Math.max(min,Math.min(max,v)); }
function avg(xs:number[]){ return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0; }
function std(xs:number[]){ const m=avg(xs); return xs.length ? Math.sqrt(avg(xs.map(x=>(x-m)**2))) : 0; }
function pct(a:number,b:number){ return b ? ((a/b)-1)*100 : 0; }
function ema(values:number[], period:number){
  if(!values.length) return 0;
  const k=2/(period+1); let out=values[0];
  for(let i=1;i<values.length;i++) out=values[i]*k+out*(1-k);
  return out;
}
function rsi(values:number[], period=14){
  if(values.length<=period) return 50;
  let gains=0,losses=0;
  for(let i=values.length-period;i<values.length;i++){
    const d=values[i]-values[i-1]; if(d>=0) gains+=d; else losses-=d;
  }
  const ag=gains/period, al=losses/period; if(al===0) return 100;
  return 100-(100/(1+ag/al));
}
function atr(c:Candle[], period=14){
  if(c.length<2) return 0;
  const tr:number[]=[];
  for(let i=1;i<c.length;i++) tr.push(Math.max(c[i].high-c[i].low, Math.abs(c[i].high-c[i-1].close), Math.abs(c[i].low-c[i-1].close)));
  return avg(tr.slice(-period));
}
function adxApprox(c:Candle[], period=14){
  if(c.length<=period+1) return 20;
  let plus=0, minus=0, tr=0;
  for(let i=c.length-period;i<c.length;i++){
    const up=c[i].high-c[i-1].high, down=c[i-1].low-c[i].low;
    plus += up>down && up>0 ? up : 0;
    minus += down>up && down>0 ? down : 0;
    tr += Math.max(c[i].high-c[i].low, Math.abs(c[i].high-c[i-1].close), Math.abs(c[i].low-c[i-1].close));
  }
  if(!tr) return 20;
  const p=100*plus/tr, m=100*minus/tr; return (p+m) ? 100*Math.abs(p-m)/(p+m) : 20;
}

export function scoreTimeframe(c:Candle[]){
  const closes=c.map(x=>x.close), vols=c.map(x=>x.volume);
  const last=closes.at(-1)||0, e20=ema(closes.slice(-80),20), e50=ema(closes.slice(-120),50);
  const trend=clamp(50 + pct(e20,e50)*8 + pct(last,e20)*6);
  const mom=clamp(50 + pct(last, closes.at(-6)||last)*5 + (rsi(closes)-50)*0.8);
  const recentVol=avg(vols.slice(-5)), baseVol=avg(vols.slice(-30,-5));
  const volume=clamp(baseVol ? 50 + ((recentVol/baseVol)-1)*30 : 50);
  const a=atr(c,14), atrPct=last ? a/last*100 : 0;
  const returns=closes.slice(-25).map((x,i,arr)=>i?((x/arr[i-1])-1)*100:0).slice(1);
  const volPct=std(returns);
  const adx=adxApprox(c,14);
  return { trend, momentum:mom, volume, rsi:rsi(closes), atrPct, volatility:volPct, adx, last, ema20:e20, ema50:e50 };
}

let regimeCache: { expiresAt:number; value: Awaited<ReturnType<typeof computeMarketRegime>> } | null = null;

async function computeMarketRegime(){
  const [btc1h,btc4h,btc1d,eth4h,markets]=await Promise.all([
    getKlines('BTC','1h',120), getKlines('BTC','4h',120), getKlines('BTC','1d',120), getKlines('ETH','4h',120), getTopUsdtMarkets(50)
  ]) as [Candle[],Candle[],Candle[],Candle[],MarketCoin[]];
  const b1=scoreTimeframe(btc1h), b4=scoreTimeframe(btc4h), bd=scoreTimeframe(btc1d), e4=scoreTimeframe(eth4h);
  const breadth=markets.length ? markets.filter(m=>m.change24h>0).length/markets.length*100 : 50;
  const avgChange=avg(markets.map(m=>m.change24h));
  const trendComposite=b1.trend*.15+b4.trend*.35+bd.trend*.35+e4.trend*.15;
  const volatilityComposite=Math.max(b1.volatility,b4.volatility,bd.volatility*.6);
  let label:RegimeLabel='SIDEWAYS';
  if(avgChange < -7 || (trendComposite<25 && volatilityComposite>2.5)) label='PANIC';
  else if(volatilityComposite>3.5) label='HIGH_VOLATILITY';
  else if(trendComposite>=72 && breadth>=60) label='STRONG_BULL';
  else if(trendComposite>=58 && breadth>=52) label='BULL';
  else if(trendComposite<=35 && breadth<=42) label='BEAR';
  const risk=clamp((50-trendComposite)*.45 + Math.max(0,50-breadth)*.35 + volatilityComposite*8 + Math.max(0,-avgChange)*2);
  return { label, risk:Math.round(risk), breadth:Math.round(breadth), avgChange24h:Number(avgChange.toFixed(2)), trendScore:Math.round(trendComposite), volatility:Number(volatilityComposite.toFixed(2)), btc:{oneHour:b1,fourHour:b4,oneDay:bd}, eth:{fourHour:e4} };
}

export async function buildMarketRegime(){
  if(regimeCache && regimeCache.expiresAt>Date.now()) return regimeCache.value;
  const value=await computeMarketRegime();
  regimeCache={expiresAt:Date.now()+20_000,value};
  return value;
}

export async function buildV2Analysis(symbol:string){
  const upper=symbol.toUpperCase();
  const [markets,c15,c1h,c4h,c1d,regime]=await Promise.all([
    getTopUsdtMarkets(100), getKlines(upper,'15m',120), getKlines(upper,'1h',120), getKlines(upper,'4h',120), getKlines(upper,'1d',120), buildMarketRegime()
  ]) as [MarketCoin[],Candle[],Candle[],Candle[],Candle[],Awaited<ReturnType<typeof buildMarketRegime>>];
  const coin=markets.find(m=>m.symbol===upper); if(!coin) throw new Error('Coin aktif Binance Spot/USDT havuzunda bulunamadı.');
  const t15=scoreTimeframe(c15), t1=scoreTimeframe(c1h), t4=scoreTimeframe(c4h), td=scoreTimeframe(c1d);
  const trendScore=t15.trend*.10+t1.trend*.25+t4.trend*.40+td.trend*.25;
  const momentumScore=t15.momentum*.20+t1.momentum*.35+t4.momentum*.30+td.momentum*.15;
  const volumeScore=t15.volume*.30+t1.volume*.35+t4.volume*.25+td.volume*.10;
  const spreadScore=clamp(100-coin.spreadPercent*450);
  const regimeScore=clamp(100-regime.risk);
  const volatility24h=coin.low24h>0?((coin.high24h-coin.low24h)/coin.low24h)*100:0;
  const volatilityQuality=clamp(85-Math.max(0,volatility24h-6)*5-Math.max(0,t1.atrPct-2)*8);
  const rsiQuality=avg([t15.rsi,t1.rsi,t4.rsi].map(x=>x>=45&&x<=68?88:x<30?60:x>80?18:55));
  const opportunity=Math.round(clamp(trendScore*.22+momentumScore*.17+volumeScore*.15+spreadScore*.10+regimeScore*.16+volatilityQuality*.08+rsiQuality*.12));
  const multiTfDisagreement=std([t15.trend,t1.trend,t4.trend,td.trend]);
  const risk=Math.round(clamp(regime.risk*.32 + volatility24h*3 + coin.spreadPercent*500 + multiTfDisagreement*.35 + Math.max(0,Math.abs(coin.change24h)-10)*2));
  const confidence=Math.round(clamp(100 - multiTfDisagreement*.55 - std([trendScore,momentumScore,volumeScore])*.35 + Math.min(10,Math.min(t1.adx,t4.adx)/5)));
  const veto=regime.label==='PANIC' ? {active:true, reason:'Piyasa rejimi PANIC; yeni spot alımları geçici olarak veto edildi.'} : {active:false, reason:''};
  const action=!veto.active && opportunity>=80 && risk<=45 && confidence>=70 ? 'BUY_CANDIDATE' : 'NO_TRADE';
  return {
    coin, opportunity, risk, confidence, action, veto, regime,
    timeframes:{'15m':t15,'1h':t1,'4h':t4,'1d':td},
    metrics:{trendScore:Math.round(trendScore),momentumScore:Math.round(momentumScore),volumeScore:Math.round(volumeScore),spreadScore:Math.round(spreadScore),volatilityQuality:Math.round(volatilityQuality),rsiQuality:Math.round(rsiQuality),multiTfDisagreement:Number(multiTfDisagreement.toFixed(2)),volatility24h:Number(volatility24h.toFixed(2))}
  };
}
