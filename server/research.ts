import crypto from 'crypto';
import { getDb } from './db';
import { getKlines, getTopUsdtMarkets, getUsdtMarket } from './market';
import { scoreTimeframe } from './analysis';
import { buildStrategyDecision, StrategyName, STRATEGY_TIMEFRAMES } from './strategy';
import { combinedThresholds } from './tradingConfig';

type Candle={time:number;open:number;high:number;low:number;close:number;volume:number};
function clamp(v:number,min=0,max=100){return Math.max(min,Math.min(max,v));}
function avg(xs:number[]){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;}
function std(xs:number[]){const m=avg(xs);return xs.length?Math.sqrt(avg(xs.map(x=>(x-m)**2))):0;}
function maxDrawdown(curve:number[]){let peak=curve[0]||1, mdd=0; for(const x of curve){peak=Math.max(peak,x); if(peak>0)mdd=Math.max(mdd,(peak-x)/peak);} return mdd*100;}
function percentile(xs:number[],p:number){if(!xs.length)return 0; const a=[...xs].sort((a,b)=>a-b); const i=Math.min(a.length-1,Math.max(0,Math.floor((a.length-1)*p))); return a[i];}

export async function recordShadowSignal(userId:number,symbol:string, decision?:any){
  const cleanSymbol=symbol.toUpperCase();
  const db=await getDb();
  const horizonMin=Math.max(1,Math.min(24*60,Number(process.env.SHADOW_HORIZON_MINUTES||1)));

  // One independent observation per symbol at a time.
  const openExisting = await db.get(
    "SELECT id FROM shadow_signals WHERE user_id = ? AND symbol = ? AND status = 'OPEN' LIMIT 1",
    [userId, cleanSymbol]
  );
  if (openExisting) return { skipped:true, reason:'OPEN_SHADOW_EXISTS', symbol:cleanSymbol };

  // After resolution, wait at least one horizon before creating the next observation.
  const lastCreated = await db.get(
    "SELECT created_at FROM shadow_signals WHERE user_id = ? AND symbol = ? ORDER BY created_at DESC LIMIT 1",
    [userId, cleanSymbol]
  );
  if (lastCreated && (Date.now() - Number(lastCreated.created_at)) < horizonMin * 60_000) {
    return { skipped:true, reason:'SHADOW_COOLDOWN', symbol:cleanSymbol };
  }

  const d=decision || await buildStrategyDecision(cleanSymbol);
  const entry=Number(d.coin?.askPrice||d.coin?.price||0);
  if(!entry) return null;
  const n=d.news?.score||{};
  const opp0=Math.round(clamp(Number(d.opportunity||0)-Number(n.opportunityAdjustment||0)));
  const risk0=Math.round(clamp(Number(d.risk||0)-Number(n.riskAdjustment||0)));
  const conf0=Math.round(clamp(Number(d.confidence||0)-Number(n.confidenceAdjustment||0)));
  const baseVeto=!!d.baseAnalysis?.veto?.active;
  const th=combinedThresholds();
  const withoutNews=!baseVeto && Number(d.consensusCount||0)>0 && opp0>=th.opportunity && risk0<=th.maxRisk && conf0>=th.confidence ? 'BUY_CANDIDATE':'NO_TRADE';
  const newsCost=Math.max(0,Number(process.env.NEWS_COST_PER_ANALYSIS_USD||0));
  const aiCost=Math.max(0,Number(process.env.AI_COST_PER_ANALYSIS_USD||0));
  const id=crypto.randomUUID(); const now=Date.now();
  await db.run(`INSERT INTO shadow_signals
    (id,user_id,symbol,created_at,entry_price,opportunity_with_news,risk_with_news,confidence_with_news,decision_with_news,
     opportunity_without_news,risk_without_news,confidence_without_news,decision_without_news,news_level,news_reason,
     news_cost_usd,ai_cost_usd,horizon_minutes,resolve_at,status,primary_strategy,market_regime,consensus_count,veto_active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,userId,cleanSymbol,now,entry,d.opportunity,d.risk,d.confidence,d.action,opp0,risk0,conf0,withoutNews,d.news?.level||'NORMAL',d.news?.reason||'',newsCost,aiCost,horizonMin,now+horizonMin*60_000,'OPEN',d.primaryStrategy||'UNKNOWN',d.regime?.label||'UNKNOWN',Number(d.consensusCount||0),d.veto?.active?1:0]);
  return {id,symbol:cleanSymbol,withNews:d.action,withoutNews,resolveAt:now+horizonMin*60_000};
}

export async function runShadowScan(userId:number,limit=10){
  const { getTopUsdtMarkets } = await import('./market');
  const markets=await getTopUsdtMarkets(Math.max(1,Math.min(50,limit)));
  const rows:any[]=[];
  for(const m of markets){
    try{const d=await buildStrategyDecision(m.symbol); rows.push({decision:d,shadow:await recordShadowSignal(userId,m.symbol,d)});}catch(e:any){rows.push({symbol:m.symbol,error:e.message});}
  }
  return {scanned:markets.length,rows,generatedAt:Date.now()};
}

async function resolveOne(row:any, candlesCache?: Map<string, any[]>){
  const db=await getDb();
  let exitPrice=0;
  try{
    let candles: any[] = [];
    if (candlesCache && candlesCache.has(String(row.symbol))) {
      candles = candlesCache.get(String(row.symbol))!;
    } else {
      candles = await getKlines(String(row.symbol),'1m',500);
      if (candlesCache) candlesCache.set(String(row.symbol), candles);
    }
    const target=Number(row.resolve_at);
    const c=candles.find(x=>Number(x.time)>=target) || candles.at(-1);
    if(c) exitPrice=Number(c.close);
  }catch{}
  if(!exitPrice){
    const m=await getUsdtMarket(String(row.symbol)); exitPrice=m.bidPrice||m.price;
  }
  if(!exitPrice) return null;
  const ret=(exitPrice/Number(row.entry_price)-1)*100;
  const withFlag=row.decision_with_news==='BUY_CANDIDATE'?1:0;
  const withoutFlag=row.decision_without_news==='BUY_CANDIDATE'?1:0;
  const contributionPct=(withFlag-withoutFlag)*ret;
  const notional=Math.max(1,Number(process.env.SHADOW_NOTIONAL_USD||100));
  const contributionUsd=contributionPct/100*notional-Number(row.news_cost_usd||0)-Number(row.ai_cost_usd||0);
  await db.run(`UPDATE shadow_signals SET exit_price=?, return_pct=?, news_contribution_pct=?, news_contribution_usd=?, resolved_at=?, status='RESOLVED' WHERE id=?`,
    [exitPrice,ret,contributionPct,contributionUsd,Date.now(),row.id]);
  return {id:row.id,returnPct:ret,newsContributionUsd:contributionUsd};
}

export async function resolveMatureShadowSignals(userId?:number){
  const db=await getDb();
  // Test mode: normalize lingering open signals to the 1-minute shadow horizon
  try {
    await db.run("UPDATE shadow_signals SET horizon_minutes = 1, resolve_at = created_at + 60000 WHERE status = 'OPEN' AND resolve_at > created_at + 60000");
  } catch {}

  const params:any[]=[Date.now()]; let sql=`SELECT * FROM shadow_signals WHERE status='OPEN' AND resolve_at<=?`;
  if(userId){sql+=' AND user_id=?'; params.push(userId);} sql+=' ORDER BY resolve_at ASC LIMIT 100';
  const rows=await db.all(sql,params); const out=[];
  const candlesCache = new Map<string, any[]>();
  for(const r of rows){try{const x=await resolveOne(r, candlesCache); if(x) out.push(x);}catch{}}
  return {attempted:rows.length,resolved:out.length,items:out};
}

function monteCarlo(returns:number[],runs=1000,start=10000){
  if(!returns.length) return {runs:0};
  const finals:number[]=[], drawdowns:number[]=[];
  for(let r=0;r<runs;r++){
    let eq=start; const curve=[eq];
    for(let i=0;i<returns.length;i++){
      const ret=returns[Math.floor(Math.random()*returns.length)];
      eq*=1+ret/100; curve.push(eq);
    }
    finals.push(eq); drawdowns.push(maxDrawdown(curve));
  }
  return {
    runs,
    finalEquityP05:Number(percentile(finals,.05).toFixed(2)),
    finalEquityMedian:Number(percentile(finals,.5).toFixed(2)),
    finalEquityP95:Number(percentile(finals,.95).toFixed(2)),
    drawdownP50:Number(percentile(drawdowns,.5).toFixed(2)),
    drawdownP95:Number(percentile(drawdowns,.95).toFixed(2)),
    lossProbabilityPct:Number((finals.filter(x=>x<start).length/finals.length*100).toFixed(2))
  };
}


function summarizeReturns(rets:number[]){
  if(!rets.length) return {trades:0,winRatePct:0,avgTradePct:0,netReturnPct:0,profitFactor:0,maxDrawdownPct:0,sharpeLike:0};
  let eq=10000; const curve=[eq]; for(const r of rets){eq*=1+r/100;curve.push(eq);}
  const wins=rets.filter(x=>x>0), losses=rets.filter(x=>x<=0);
  const gp=wins.reduce((a,b)=>a+b,0), gl=Math.abs(losses.reduce((a,b)=>a+b,0));
  const m=avg(rets), s=std(rets);
  return {
    trades:rets.length,
    winRatePct:Number((wins.length/rets.length*100).toFixed(2)),
    avgTradePct:Number(m.toFixed(3)),
    netReturnPct:Number(((eq/10000-1)*100).toFixed(2)),
    profitFactor:Number((gl?gp/gl:(gp?99:0)).toFixed(2)),
    maxDrawdownPct:Number(maxDrawdown(curve).toFixed(2)),
    sharpeLike:Number((s?m/s*Math.sqrt(rets.length):0).toFixed(2))
  };
}

function walkForwardSummary(trades:any[]){
  if(trades.length<12) return {status:'INSUFFICIENT_SAMPLE',train:{},test:{},stabilityScore:0,robust:false,verdict:'INSUFFICIENT_SAMPLE',note:'En az 12 trade gerekli.'};
  const split=Math.max(6,Math.floor(trades.length*.6));
  const train=trades.slice(0,split), test=trades.slice(split);
  const a=summarizeReturns(train.map(x=>Number(x.netPct||0)));
  const b=summarizeReturns(test.map(x=>Number(x.netPct||0)));
  const sameSign=Math.sign(a.avgTradePct)===Math.sign(b.avgTradePct);
  const ratio=Math.abs(a.avgTradePct)>1e-9?Math.min(1,Math.abs(b.avgTradePct/a.avgTradePct)):0;
  const ddPenalty=b.maxDrawdownPct>Math.max(5,a.maxDrawdownPct*1.75)?25:0;
  const stability=Math.max(0,Math.min(100,(sameSign?55:10)+ratio*35-ddPenalty+(b.profitFactor>=1?10:0)));
  const robust=Boolean(test.length>=6 && b.avgTradePct>0 && b.profitFactor>=1 && stability>=60);
  return {
    status:test.length>=6?'READY':'INSUFFICIENT_TEST_SAMPLE',
    splitPct:'60/40 chronological',
    train:a,test:b,stabilityScore:Number(stability.toFixed(1)),
    robust,
    verdict: test.length < 6 ? 'INSUFFICIENT_SAMPLE' : robust ? 'ROBUST' : 'OVERFITTED',
    note:'Out-of-sample bölüm kronolojik son %40; optimizasyon yapılmadan aynı kurallar uygulanır.'
  };
}

export type MultiBacktestProgress = {
  active: boolean;
  stepText: string;
  currentCoinIndex: number;
  totalCoins: number;
  currentCoin: string;
  currentStrategy: string;
  currentInterval: string;
  percent: number;
  error?: string;
  updatedAt: number;
};

let backtestProgress: MultiBacktestProgress = {
  active: false,
  stepText: 'Hazır',
  currentCoinIndex: 0,
  totalCoins: 10,
  currentCoin: '',
  currentStrategy: '',
  currentInterval: '',
  percent: 0,
  updatedAt: Date.now()
};

export function getBacktestProgress(): MultiBacktestProgress {
  return backtestProgress;
}

function simulateStrategyOnCandles(
  candles: Candle[],
  strategy: StrategyName,
  interval: string,
  symbol: string,
  spreadPercent: number,
  feeRate: number,
  slippagePct: number
) {
  if (candles.length < 80) return [];
  const roundTripFeePct = feeRate * 200; // e.g. 0.001 * 200 = 0.20%
  const slippageRate = slippagePct / 100;
  const halfSpread = (spreadPercent || 0.05) / 200;

  const minScore = strategy === 'SCALP' ? 82 : strategy === 'DAY' ? 80 : 78;
  const minConfidence = strategy === 'SCALP' ? 76 : strategy === 'DAY' ? 72 : 70;
  const maxRisk = strategy === 'SCALP' ? 40 : strategy === 'DAY' ? 45 : 48;
  const maxHoldBars = strategy === 'SCALP' ? 12 : strategy === 'DAY' ? 24 : 36;
  const spreadPenaltyMultiplier = strategy === 'SCALP' ? 700 : strategy === 'DAY' ? 350 : 160;

  const trades: any[] = [];
  let i = 60;

  while (i < candles.length - 2) {
    const frame = candles.slice(Math.max(0, i - 80), i + 1);
    const s: any = scoreTimeframe(frame);

    const spreadPenalty = (spreadPercent || 0.05) * spreadPenaltyMultiplier;
    const atrPenalty = strategy === 'SCALP' ? Math.max(0, s.atrPct - 1.6) * 8 : strategy === 'DAY' ? Math.max(0, s.atrPct - 3) * 5 : Math.max(0, s.atrPct - 5) * 3;
    const score = clamp(s.trend * 0.35 + s.momentum * 0.28 + s.volume * 0.18 + clamp(s.adx) * 0.10 + Math.max(0, 100 - s.atrPct * 10) * 0.09 - spreadPenalty - atrPenalty);
    const confidence = clamp((s.trend + s.momentum + s.volume + clamp(s.adx)) / 4 + (s.trend > 55 ? 5 : 0) - Math.max(0, 50 - s.trend) * 0.3);
    const risk = clamp(Math.max(0, s.atrPct - 1.2) * 8 + Math.max(0, 55 - s.trend) * 0.55 + Math.max(0, 52 - s.momentum) * 0.35 + (strategy === 'SCALP' ? spreadPenalty * 0.4 : spreadPenalty * 0.2));

    if (score >= minScore && confidence >= minConfidence && risk <= maxRisk) {
      // LOOK-AHEAD BIAS STRICTLY FORBIDDEN:
      // Signal generated on close of bar i.
      // Entry is simulated strictly on next bar (i + 1) at open price.
      const nextBar = candles[i + 1];
      if (!nextBar) break;

      const rawEntry = nextBar.open;
      const entryPrice = rawEntry * (1 + halfSpread + slippageRate);

      const stopDistancePct = strategy === 'SCALP'
        ? clamp(Math.max(0.8, s.atrPct * 1.4), 0.8, 3.5)
        : strategy === 'DAY'
        ? clamp(Math.max(1.0, s.atrPct * 1.6), 1.0, 5.0)
        : clamp(Math.max(1.5, s.atrPct * 1.8), 1.5, 6.0);

      const stopPrice = entryPrice * (1 - stopDistancePct / 100);
      const tp1Price = entryPrice * (1 + stopDistancePct * 1.25 / 100);
      const tp2Price = entryPrice * (1 + stopDistancePct * 2.25 / 100);

      let tp1Hit = false;
      let realizedReturnWeighted = 0;
      let remainingUnits = 1.0;
      let exitBar = Math.min(candles.length - 1, i + 1 + maxHoldBars);
      let exitReason = 'TIME';
      let finalExitPrice = entryPrice;

      for (let j = i + 1; j <= exitBar; j++) {
        const c = candles[j];

        // INTRABAR CONFLICT:
        // If both stop and TP1 are touched in the same candle:
        // Conservative assumption: STOP LOSS OCCURRED FIRST!
        if (c.low <= stopPrice && c.high >= tp1Price) {
          finalExitPrice = stopPrice * (1 - slippageRate);
          realizedReturnWeighted += remainingUnits * ((finalExitPrice - entryPrice) / entryPrice);
          remainingUnits = 0;
          exitReason = 'STOP';
          exitBar = j;
          break;
        }

        if (c.low <= stopPrice) {
          finalExitPrice = stopPrice * (1 - slippageRate);
          realizedReturnWeighted += remainingUnits * ((finalExitPrice - entryPrice) / entryPrice);
          remainingUnits = 0;
          exitReason = 'STOP';
          exitBar = j;
          break;
        }

        if (!tp1Hit && c.high >= tp1Price) {
          const fillTp1 = tp1Price * (1 - slippageRate);
          realizedReturnWeighted += 0.25 * ((fillTp1 - entryPrice) / entryPrice);
          remainingUnits = 0.75;
          tp1Hit = true;
        }

        if (tp1Hit && c.high >= tp2Price) {
          finalExitPrice = tp2Price * (1 - slippageRate);
          realizedReturnWeighted += remainingUnits * ((finalExitPrice - entryPrice) / entryPrice);
          remainingUnits = 0;
          exitReason = 'TP2';
          exitBar = j;
          break;
        }

        if (tp1Hit && c.low <= entryPrice) {
          finalExitPrice = entryPrice * (1 - slippageRate);
          realizedReturnWeighted += remainingUnits * ((finalExitPrice - entryPrice) / entryPrice);
          remainingUnits = 0;
          exitReason = 'BREAKEVEN';
          exitBar = j;
          break;
        }
      }

      if (remainingUnits > 0) {
        finalExitPrice = candles[exitBar].close * (1 - halfSpread - slippageRate);
        realizedReturnWeighted += remainingUnits * ((finalExitPrice - entryPrice) / entryPrice);
        remainingUnits = 0;
      }

      const grossPct = realizedReturnWeighted * 100;
      const netPct = grossPct - roundTripFeePct;

      trades.push({
        symbol,
        strategy,
        interval,
        entryTime: nextBar.time,
        exitTime: candles[exitBar].time,
        entryPrice: Number(entryPrice.toFixed(6)),
        exitPrice: Number(finalExitPrice.toFixed(6)),
        netPct: Number(netPct.toFixed(4)),
        grossPct: Number(grossPct.toFixed(4)),
        costPct: Number((roundTripFeePct + slippagePct * 2).toFixed(4)),
        reason: exitReason,
        score: Math.round(score),
        risk: Math.round(risk),
        confidence: Math.round(confidence)
      });

      i = exitBar + 1;
    } else {
      i += 1;
    }
  }

  return trades;
}

export async function runMultiBacktest(userId: number) {
  try {
    backtestProgress = {
      active: true,
      stepText: 'Likit Spot USDT parite evreni taranıyor…',
      currentCoinIndex: 0,
      totalCoins: 10,
      currentCoin: '',
      currentStrategy: '',
      currentInterval: '',
      percent: 5,
      updatedAt: Date.now()
    };

    const markets = await getTopUsdtMarkets(10);
    if (!markets || markets.length === 0) {
      throw new Error('Dinamik spot USDT pariteleri alınamadı.');
    }
    const top10 = markets.slice(0, 10);
    const feeRate = Math.max(0, Number(process.env.PAPER_FEE_RATE || 0.001));
    const slippagePct = Math.max(0.01, Number(process.env.BACKTEST_SLIPPAGE_PCT || 0.08));

    // Cache candles for the needed intervals: 5m, 15m, 1h, 4h, 1d
    const intervals = ['5m', '15m', '1h', '4h', '1d'];
    const candleCache = new Map<string, Candle[]>();

    const totalSteps = top10.length * 9; // 9 combinations per coin: 3 scalp, 3 day, 3 swing
    let stepCount = 0;
    const allTrades: any[] = [];

    for (let cIdx = 0; cIdx < top10.length; cIdx++) {
      const coin = top10[cIdx];
      const coinSymbol = coin.symbol.toUpperCase();

      // Pre-fetch all 5 intervals for this coin
      for (const tf of intervals) {
        const cacheKey = `${coinSymbol}_${tf}`;
        if (!candleCache.has(cacheKey)) {
          try {
            const klines = (await getKlines(coinSymbol, tf, 350)) as Candle[];
            candleCache.set(cacheKey, klines || []);
          } catch {
            candleCache.set(cacheKey, []);
          }
          // gentle gap to respect public Binance API
          await new Promise(r => setTimeout(r, 45));
        }
      }

      // Strategies defined as requested:
      // SCALP: 5m, 15m, 1h
      // DAY: 15m, 1h, 4h
      // SWING: 1h, 4h, 1d
      const strategyRuns: { strategy: StrategyName; tfs: string[] }[] = [
        { strategy: 'SCALP', tfs: ['5m', '15m', '1h'] },
        { strategy: 'DAY',   tfs: ['15m', '1h', '4h'] },
        { strategy: 'SWING', tfs: ['1h', '4h', '1d'] }
      ];

      for (const run of strategyRuns) {
        for (const tf of run.tfs) {
          stepCount++;
          const pct = Math.min(95, Math.round((stepCount / totalSteps) * 90) + 5);
          backtestProgress = {
            active: true,
            stepText: `${run.strategy} / ${coinSymbol} / ${tf} (${cIdx + 1}/${top10.length} coin)`,
            currentCoinIndex: cIdx + 1,
            totalCoins: top10.length,
            currentCoin: coinSymbol,
            currentStrategy: run.strategy,
            currentInterval: tf,
            percent: pct,
            updatedAt: Date.now()
          };

          const candles = candleCache.get(`${coinSymbol}_${tf}`) || [];
          if (candles.length >= 80) {
            const trades = simulateStrategyOnCandles(
              candles,
              run.strategy,
              tf,
              coinSymbol,
              coin.spreadPercent || 0.05,
              feeRate,
              slippagePct
            );
            allTrades.push(...trades);
          }
        }
      }
    }

    // Sort all trades chronologically by entryTime
    allTrades.sort((a, b) => a.entryTime - b.entryTime);

    // Attribution calculations
    const strategyAttribution: Record<string, any> = {};
    for (const strat of ['SCALP', 'DAY', 'SWING']) {
      const sTrades = allTrades.filter(t => t.strategy === strat);
      strategyAttribution[strat] = summarizeReturns(sTrades.map(t => t.netPct));
    }

    const coinAttribution: Record<string, any> = {};
    for (const coin of top10) {
      const cTrades = allTrades.filter(t => t.symbol === coin.symbol);
      coinAttribution[coin.symbol] = summarizeReturns(cTrades.map(t => t.netPct));
    }

    const timeframeAttribution: Record<string, any> = {};
    for (const tf of intervals) {
      const tfTrades = allTrades.filter(t => t.interval === tf);
      timeframeAttribution[tf] = summarizeReturns(tfTrades.map(t => t.netPct));
    }

    // Overall summary metrics
    const overallReturns = allTrades.map(t => t.netPct);
    const overall = summarizeReturns(overallReturns);
    let eq = 10000;
    for (const r of overallReturns) {
      eq *= (1 + r / 100);
    }
    const netPnlUsd = Number((eq - 10000).toFixed(2));
    const totalCostPct = Number((allTrades.reduce((s, t) => s + (t.costPct || 0), 0) / Math.max(1, allTrades.length) * allTrades.length).toFixed(2));

    const walkForward = walkForwardSummary(allTrades);
    const mc = monteCarlo(overallReturns, Math.min(2000, Math.max(500, allTrades.length * 20)), 10000);

    const metrics = {
      testedCoins: top10.length,
      coinsList: top10.map(c => c.symbol),
      trades: overall.trades,
      winRatePct: overall.winRatePct,
      netReturnPct: overall.netReturnPct,
      netPnlUsd,
      profitFactor: overall.profitFactor,
      maxDrawdownPct: overall.maxDrawdownPct,
      avgTradePct: overall.avgTradePct,
      sharpeLike: overall.sharpeLike,
      totalCostPct,
      startEquity: 10000,
      finalEquity: Number(eq.toFixed(2)),
      strategyAttribution,
      coinAttribution,
      timeframeAttribution,
      walkForward,
      note: 'Çoklu Piyasa Backtest: En likit 10 USDT Spot paritesi, 3 strateji (SCALP, DAY, SWING), 5 zaman dilimi (5m, 15m, 1h, 4h, 1d). Fees & slippage dahil NET sonuçlar.'
    };

    const id = crypto.randomUUID();
    const db = await getDb();
    await db.run(
      'INSERT INTO backtest_runs (id,user_id,symbol,interval,created_at,metrics_json,monte_carlo_json,trades_json) VALUES (?,?,?,?,?,?,?,?)',
      [
        id,
        userId,
        'MULTI (10 COIN)',
        'SCALP/DAY/SWING',
        Date.now(),
        JSON.stringify(metrics),
        JSON.stringify(mc),
        JSON.stringify(allTrades.slice(-250))
      ]
    );

    backtestProgress = {
      active: false,
      stepText: 'Tamamlandı',
      currentCoinIndex: 10,
      totalCoins: 10,
      currentCoin: '',
      currentStrategy: '',
      currentInterval: '',
      percent: 100,
      updatedAt: Date.now()
    };

    return {
      id,
      symbol: 'MULTI (10 COIN)',
      interval: 'SCALP/DAY/SWING',
      metrics,
      monteCarlo: mc,
      trades: allTrades.slice(-100)
    };
  } catch (err: any) {
    backtestProgress = {
      active: false,
      stepText: 'Hata',
      currentCoinIndex: 0,
      totalCoins: 10,
      currentCoin: '',
      currentStrategy: '',
      currentInterval: '',
      percent: 0,
      error: err.message,
      updatedAt: Date.now()
    };
    throw err;
  }
}

export async function runBacktest(userId:number,symbol:string,interval='1h'){
  const allowed=new Set(['5m','15m','1h','4h','1d']); if(!allowed.has(interval)) interval='1h';
  const cleanSymbol = symbol.toUpperCase();
  const candles=(await getKlines(cleanSymbol,interval,500)) as Candle[];
  if(candles.length<80) throw new Error('Backtest için yeterli mum bulunamadı.');
  const feeRate=Math.max(0,Number(process.env.PAPER_FEE_RATE||0.001));
  const slippagePct=Math.max(0.01,Number(process.env.BACKTEST_SLIPPAGE_PCT||0.08));

  // Use SCALP for 5m/15m, DAY for 1h, SWING for 4h/1d
  const strat: StrategyName = (interval === '5m' || interval === '15m') ? 'SCALP' : interval === '1h' ? 'DAY' : 'SWING';
  const trades = simulateStrategyOnCandles(candles, strat, interval, cleanSymbol, 0.05, feeRate, slippagePct);

  const rets = trades.map(t => t.netPct);
  const overall = summarizeReturns(rets);
  let eq = 10000; for (const r of rets) { eq *= (1 + r / 100); }
  const totalCostPct = Number((trades.reduce((s, t) => s + (t.costPct || 0), 0)).toFixed(2));

  const metrics = {
    ...overall,
    startEquity: 10000,
    finalEquity: Number(eq.toFixed(2)),
    netPnlUsd: Number((eq - 10000).toFixed(2)),
    totalCostPct,
    testedCoins: 1,
    coinsList: [cleanSymbol],
    strategyAttribution: { [strat]: overall },
    coinAttribution: { [cleanSymbol]: overall },
    timeframeAttribution: { [interval]: overall },
    note: `Tekil ${cleanSymbol} ${interval} ${strat} backtest; Look-ahead bias yok, fee + slippage dahil net.`
  };

  const mc = monteCarlo(rets, Math.min(2000, Math.max(500, trades.length * 20)), 10000);
  const walkForward = walkForwardSummary(trades);

  const db = await getDb(); const id = crypto.randomUUID();
  await db.run(
    'INSERT INTO backtest_runs (id,user_id,symbol,interval,created_at,metrics_json,monte_carlo_json,trades_json) VALUES (?,?,?,?,?,?,?,?)',
    [id, userId, cleanSymbol, interval, Date.now(), JSON.stringify({ ...metrics, walkForward }), JSON.stringify(mc), JSON.stringify(trades.slice(-250))]
  );
  return { id, symbol: cleanSymbol, interval, metrics: { ...metrics, walkForward }, monteCarlo: mc, trades: trades.slice(-100) };
}

export async function getResearchAnalytics(userId:number){
  await resolveMatureShadowSignals(userId);
  const db=await getDb();
  const rows=await db.all(`SELECT * FROM shadow_signals WHERE user_id=? AND status='RESOLVED' AND horizon_minutes>=1 ORDER BY resolved_at DESC LIMIT 2000`,[userId]);
  const legacyResolvedSignals=Number((await db.get(`SELECT COUNT(*) c FROM shadow_signals WHERE user_id=? AND status='RESOLVED' AND horizon_minutes<1`,[userId]))?.c||0);
  const costs=rows.reduce((s:any,r:any)=>({news:s.news+Number(r.news_cost_usd||0),ai:s.ai+Number(r.ai_cost_usd||0)}),{news:0,ai:0});
  const diff=rows.filter((r:any)=>r.decision_with_news!==r.decision_without_news);
  const savedLoss=diff.filter((r:any)=>r.decision_with_news==='NO_TRADE'&&Number(r.return_pct)<0).reduce((s:number,r:any)=>s+Math.abs(Number(r.return_pct)),0);
  const missedProfit=diff.filter((r:any)=>r.decision_with_news==='NO_TRADE'&&Number(r.return_pct)>0).reduce((s:number,r:any)=>s+Number(r.return_pct),0);
  const addedGood=diff.filter((r:any)=>r.decision_with_news==='BUY_CANDIDATE'&&Number(r.return_pct)>0).reduce((s:number,r:any)=>s+Number(r.return_pct),0);
  const addedBad=diff.filter((r:any)=>r.decision_with_news==='BUY_CANDIDATE'&&Number(r.return_pct)<0).reduce((s:number,r:any)=>s+Math.abs(Number(r.return_pct)),0);
  const contributionUsd=rows.reduce((s:number,r:any)=>s+Number(r.news_contribution_usd||0),0);
  const buckets:any={};
  for(const r of rows){const o=Number(r.opportunity_with_news||0);const k=o>=90?'90-100':o>=80?'80-89':o>=70?'70-79':'<70'; (buckets[k]??=[]).push(Number(r.return_pct||0));}
  const bucketStats=Object.fromEntries(Object.entries(buckets).map(([k,v]:any)=>[k,{count:v.length,avgReturnPct:Number(avg(v).toFixed(3)),winRatePct:Number((v.filter((x:number)=>x>0).length/v.length*100).toFixed(1))}]));
  const latestBacktests=await db.all('SELECT id,symbol,interval,created_at,metrics_json,monte_carlo_json FROM backtest_runs WHERE user_id=? ORDER BY created_at DESC LIMIT 10',[userId]);

  const paperTrades=await db.all("SELECT type,realized_pnl,timestamp FROM trade_history WHERE user_id=? AND type LIKE 'SELL:%' ORDER BY timestamp ASC",[userId]);
  const testnetTrades=await db.all('SELECT side,realized_pnl,created_at FROM testnet_trade_history WHERE user_id=? ORDER BY created_at ASC',[userId]);
  function envStats(rows:any[]){
    const exits=rows.filter((r:any)=>Number(r.realized_pnl||0)!==0);
    const pnls=exits.map((r:any)=>Number(r.realized_pnl||0));
    const wins=pnls.filter((x:number)=>x>0), losses=pnls.filter((x:number)=>x<0);
    const grossProfit=wins.reduce((a:number,b:number)=>a+b,0), grossLoss=Math.abs(losses.reduce((a:number,b:number)=>a+b,0));
    return {closedTrades:exits.length,realizedPnlUsd:Number(pnls.reduce((a:number,b:number)=>a+b,0).toFixed(4)),winRatePct:Number((exits.length?wins.length/exits.length*100:0).toFixed(1)),profitFactor:Number((grossLoss?grossProfit/grossLoss:(grossProfit?99:0)).toFixed(2))};
  }
  const strategyGroups:any={}, regimeGroups:any={};
  for(const r of rows){
    const ret=Number(r.return_pct||0);
    const sk=String(r.primary_strategy||'UNKNOWN'), rg=String(r.market_regime||'UNKNOWN');
    (strategyGroups[sk]??=[]).push(ret); (regimeGroups[rg]??=[]).push(ret);
  }
  const groupStats=(g:any)=>Object.fromEntries(Object.entries(g).map(([k,v]:any)=>[k,{count:v.length,avgReturnPct:Number(avg(v).toFixed(3)),winRatePct:Number((v.filter((x:number)=>x>0).length/v.length*100).toFixed(1))}]));
  const robustBacktests=latestBacktests.map((x:any)=>{const m=JSON.parse(x.metrics_json||'{}');return {symbol:x.symbol,interval:x.interval,trades:m.trades||0,netReturnPct:m.netReturnPct||0,walkForward:m.walkForward||null};});
  const walkForwardReady=robustBacktests.filter((x:any)=>x.walkForward?.status==='READY');
  const walkForwardPass=walkForwardReady.filter((x:any)=>x.walkForward?.robust).length;
  const testReadiness={
    shadowSampleReady:rows.length>=50,
    newsRetestReady:rows.length>=50,
    walkForwardRuns:walkForwardReady.length,
    walkForwardRobustRuns:walkForwardPass,
    testnetClosedTrades:envStats(testnetTrades).closedTrades,
    paperClosedTrades:envStats(paperTrades).closedTrades,
    verdict: rows.length<50?'COLLECT_MORE_SHADOW':walkForwardReady.length<3?'RUN_MORE_WALK_FORWARD':envStats(testnetTrades).closedTrades<20?'COLLECT_MORE_TESTNET':'REVIEW_FOR_V10'
  };
  return {
    resolvedSignals:rows.length, legacyResolvedSignals, openSignals:Number((await db.get("SELECT COUNT(*) c FROM shadow_signals WHERE user_id=? AND status='OPEN'",[userId]))?.c||0),
    scoreBuckets:bucketStats,
    strategyAttribution:groupStats(strategyGroups),
    regimeAttribution:groupStats(regimeGroups),
    environmentComparison:{paper:envStats(paperTrades),testnet:envStats(testnetTrades)},
    testReadiness,
    newsRetest:{
      differingDecisions:diff.length,savedLossPct:Number(savedLoss.toFixed(3)),missedProfitPct:Number(missedProfit.toFixed(3)),addedGoodPct:Number(addedGood.toFixed(3)),addedBadPct:Number(addedBad.toFixed(3)),
      newsCostUsd:Number(costs.news.toFixed(4)),aiCostUsd:Number(costs.ai.toFixed(4)),netContributionUsd:Number(contributionUsd.toFixed(4)),
      verdict: rows.length<50?'INSUFFICIENT_SAMPLE':contributionUsd>0?'KEEP':contributionUsd<0?'REVIEW_OR_DISABLE':'NEUTRAL'
    },
    latestBacktests:latestBacktests.map((x:any)=>({...x,metrics:JSON.parse(x.metrics_json||'{}'),monteCarlo:JSON.parse(x.monte_carlo_json||'{}'),metrics_json:undefined,monte_carlo_json:undefined})),
    mandatoryTestChecklist:[
      'CryptoPanic / News Engine A-B retest: haber açık vs haber etkisi nötr karşılaştırılacak.',
      'API + AI maliyeti, engellenen zarar ve kaçırılan kâr birlikte değerlendirilecek.',
      'En az 50 geçerli (>=1 dk test ufku) çözülmüş gölge sinyali olmadan haber sağlayıcısı hakkında kalıcı karar verilmeyecek.',
      'Backtest tek başına yeterli kabul edilmeyecek; dry-run/shadow ve Monte Carlo birlikte incelenecek.',
      'Walk-forward / out-of-sample sonucu en az birkaç sembol-zaman diliminde pozitif ve tutarlı olmadan eşikler canlı sermaye için onaylanmayacak.',
      'Paper ve Testnet sonuçları ayrı izlenecek; Testnet gerçekleşmiş performans Paper ile çelişiyorsa neden bulunmadan ilerlenmeyecek.'
    ],
    generatedAt:Date.now()
  };
}
