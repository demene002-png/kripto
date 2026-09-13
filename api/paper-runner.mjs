import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

// Vercel'in bulunduğu bolgede api.binance.com zaman zaman 451 / hata JSON'u
// dondurebilir. Market-data-only endpoint'i once deneyip resmi public API
// hostlarini yedek olarak kullaniyoruz.
const BINANCE_BASES = [
  'https://data-api.binance.vision',
  'https://api.binance.com',
  'https://api1.binance.com',
];


// USDT is the quote/cash asset. BNB remains a normal tradable asset.
// All known stablecoin/fiat-pegged base assets are excluded from auto-scan and auto-buy.
const EXCLUDED_STABLE_BASES = new Set([
  'USDT','USDC','FDUSD','TUSD','USDP','DAI','BUSD','USD1','U','USDE','USDS','PYUSD','GUSD','USDD','FRAX','LUSD','USD0','USTC',
  'RLUSD','AEUR','EURI','XUSD','AUSD','BFUSD','USDX','EUR','TRY','BRL','GBP','AUD'
]);
function baseAsset(symbol) { return symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol; }
function eligibleSpotSymbol(symbol) {
  if (!symbol.endsWith('USDT')) return false;
  const base = baseAsset(symbol);
  if (EXCLUDED_STABLE_BASES.has(base)) return false;
  if (/(UP|DOWN|BULL|BEAR)$/.test(base)) return false;
  return true;
}

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// v1.3.9 kalite kapilari: otomatik PAPER islemleri daha secici.
const AUTO_MIN_OPPORTUNITY = 80;
const SHADOW_MIN_OPPORTUNITY = 75;
const AUTO_MIN_CONFIDENCE = 70;
const AUTO_MAX_RISK = 55;
const AUTO_MIN_CONSENSUS = 2;
const STOP_COOLDOWN_MINUTES = 60;
const MANUAL_COOLDOWN_MINUTES = 30;

async function retry(label, fn, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const value = await fn();
      if (value?.error) throw value.error;
      return value;
    } catch (error) {
      last = error;
      if (i < attempts - 1) await sleep(250 * (i + 1));
    }
  }
  throw new Error(`${label}: ${last?.message || String(last)}`);
}


const ema = (values, period) => {
  let value = values[0];
  const k = 2 / (period + 1);
  for (const x of values) value = x * k + value * (1 - k);
  return value;
};

const rsi = (values) => {
  let gain = 0;
  let loss = 0;
  for (let i = values.length - 14; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    if (delta > 0) gain += delta;
    else loss -= delta;
  }
  return loss ? 100 - (100 / (1 + gain / loss)) : 70;
};

async function fetchBinanceJson(path, validator, label) {
  const errors = [];

  for (const base of BINANCE_BASES) {
    try {
      const response = await fetch(`${base}${path}`, {
        headers: { 'User-Agent': 'kripto-paper100-cloud-runner/1.4.0' },
        signal: AbortSignal.timeout(4_000),
      });

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`JSON degil: ${text.slice(0, 120)}`);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${data?.msg || text.slice(0, 120)}`);
      }

      if (validator && !validator(data)) {
        throw new Error(`Beklenmeyen veri tipi: ${JSON.stringify(data).slice(0, 180)}`);
      }

      return { data, base };
    } catch (error) {
      errors.push(`${base}: ${error?.message || String(error)}`);
    }
  }

  throw new Error(`${label} alinamadi. ${errors.join(' | ')}`);
}

async function get24hTickers() {
  const { data, base } = await fetchBinanceJson(
    '/api/v3/ticker/24hr',
    Array.isArray,
    'Binance 24 saatlik piyasa verisi',
  );
  return { tickers: data, base };
}

async function getKlines(symbol, interval) {
  const { data } = await fetchBinanceJson(
    `/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=61`,
    (value) => Array.isArray(value) && value.length >= 50 && Array.isArray(value[0]),
    `${symbol} ${interval} mum verisi`,
  );

  // Binance son mumu halen acik/incomplete dondurebilir. Sinyal ve hacim teyidi
  // yalniz kapanmis mumlardan hesaplanir.
  return data.slice(0, -1).map((x) => ({
    c: Number(x[4]),
    h: Number(x[2]),
    l: Number(x[3]),
    v: Number(x[5]),
  }));
}

function score(klines) {
  const closes = klines.map((x) => x.c);
  const last = closes.at(-1);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);
  const R = rsi(closes);
  const momentum = (last / closes.at(-6) - 1) * 100;
  const atrWindow = klines.slice(-15);
  let trSum = 0;
  for (let i = 1; i < atrWindow.length; i += 1) {
    const x = atrWindow[i];
    const prevClose = atrWindow[i - 1].c;
    trSum += Math.max(x.h - x.l, Math.abs(x.h - prevClose), Math.abs(x.l - prevClose));
  }
  const atr = (trSum / Math.max(1, atrWindow.length - 1)) / last * 100;
  const averageVolume = klines.slice(-21, -1).reduce((sum, x) => sum + x.v, 0) / 20 || 1;
  const volumeRatio = klines.at(-1).v / averageVolume;

  let opportunity = 50
    + (e9 > e21 ? 10 : -8)
    + (e21 > e50 ? 10 : -8)
    + clamp(momentum * 3, -12, 12)
    + (R > 48 && R < 68 ? 8 : R > 75 ? -8 : 0)
    + clamp((volumeRatio - 1) * 8, -5, 8);

  let risk = 28
    + atr * 6
    + (R > 75 ? 12 : 0)
    + (e9 < e21 ? 8 : 0);

  let confidence = 58
    + (e9 > e21 && e21 > e50 ? 14 : 0)
    + (volumeRatio > 1.1 ? 8 : 0)
    - Math.min(12, atr * 2);

  const recentHigh = Math.max(...klines.slice(-10).map((x) => x.h));
  const pullbackPct = recentHigh > 0 ? (recentHigh - last) / recentHigh * 100 : 0;
  const distanceFromEma9Pct = e9 > 0 ? (last / e9 - 1) * 100 : 0;
  const trendAligned = e9 > e21 && e21 > e50;
  const entryTimingOk = trendAligned
    && R >= 50 && R <= 68
    && volumeRatio >= 0.90
    && distanceFromEma9Pct >= -1.25
    && distanceFromEma9Pct <= 1.80
    && pullbackPct <= 3.0;

  return {
    opp: Math.round(clamp(opportunity, 0, 100)),
    risk: Math.round(clamp(risk, 0, 100)),
    conf: Math.round(clamp(confidence, 0, 100)),
    atr,
    rsi: R,
    volumeRatio,
    pullbackPct,
    distanceFromEma9Pct,
    trendAligned,
    entryTimingOk,
  };
}


function strategyEnsemble(scores) {
  const best = scores.reduce((a,b)=>a.opp>=b.opp?a:b);
  const votes = {
    TREND: scores.filter(x=>x.trendAligned).length >= 2,
    MOMENTUM: scores.filter(x=>x.rsi>=52 && x.rsi<=70 && x.opp>=70).length >= 2,
    HACIM: scores.filter(x=>x.volumeRatio>=1.05).length >= 2,
    KIRILIM: best.trendAligned && best.pullbackPct <= 0.8 && best.volumeRatio >= 1.10,
    GERI_CEKILME: best.trendAligned && best.rsi>=45 && best.rsi<=62 && best.distanceFromEma9Pct>=-0.9 && best.distanceFromEma9Pct<=0.9,
    ORTALAMAYA_DONUS: best.rsi < 40 && best.distanceFromEma9Pct < -1.0,
  };
  const positive = Object.entries(votes).filter(([,v])=>v).map(([k])=>k);
  const priority=['TREND','MOMENTUM','KIRILIM','HACIM','GERI_CEKILME','ORTALAMAYA_DONUS'];
  const primary = priority.find(x=>votes[x]) || 'KARMA';
  return { votes, positive, count: positive.length, primary };
}
function returnsFromKlines(rows, n=50){
  const c=rows.slice(-(n+1)).map(x=>x.c); const r=[];
  for(let i=1;i<c.length;i++) if(c[i-1]>0) r.push(c[i]/c[i-1]-1);
  return r;
}
function correlation(a,b){
  const n=Math.min(a.length,b.length); if(n<10)return 0;
  const x=a.slice(-n), y=b.slice(-n); const mx=x.reduce((s,v)=>s+v,0)/n, my=y.reduce((s,v)=>s+v,0)/n;
  let num=0,dx=0,dy=0; for(let i=0;i<n;i++){const xa=x[i]-mx,ya=y[i]-my;num+=xa*ya;dx+=xa*xa;dy+=ya*ya;}
  return dx&&dy?num/Math.sqrt(dx*dy):0;
}
function executionSlippageBps(quoteVolume, atrPct){
  const liquidityPenalty = quoteVolume >= 100_000_000 ? 0 : quoteVolume >= 25_000_000 ? 2 : quoteVolume >= 5_000_000 ? 5 : 10;
  return clamp(2 + liquidityPenalty + Math.max(0, atrPct-2)*0.8, 2, 18);
}

async function logHealth(sb, component, severity, message, metadata = null) {
  try {
    await sb.from('system_health_log').insert({
      component,
      severity,
      message,
      metadata,
    });
  } catch {
    // Loglama ana islemi bozmamali.
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Yalnizca POST desteklenir.' });
  }

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(500).json({ error: 'Supabase sunucu ayarlari eksik.' });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: claim } = await retry('Runner kilidi alinamadi', () => sb.rpc('claim_paper_runner'));
  if (!claim?.claimed) return res.status(200).json({ ok: true, skipped: true, reason: 'RUNNER_BUSY' });

  try {
    const { tickers, base: binanceBase } = await get24hTickers();

    const all = tickers
      .filter((x) => typeof x?.symbol === 'string')
      .filter((x) => eligibleSpotSymbol(x.symbol))
      .filter((x) => Number.isFinite(Number(x.quoteVolume)) && Number.isFinite(Number(x.lastPrice)))
      .filter((x) => Number(x.quoteVolume) >= 5_000_000)
      .filter((x) => Math.abs(Number(x.priceChangePercent || 0)) <= 30)
      .map((x) => ({
        ...x,
        _quality: Math.log10(Math.max(1, Number(x.quoteVolume))) * 10 - Math.abs(Number(x.priceChangePercent || 0)) * 0.45,
      }))
      .sort((a, b) => Number(b._quality) - Number(a._quality))
      .slice(0, 50);

    if (all.length < 10) {
      throw new Error(`Binance evreni yetersiz: ${all.length} uygun USDT paritesi.`);
    }

    const priceMap = new Map(
      tickers
        .filter((x) => typeof x?.symbol === 'string' && Number.isFinite(Number(x.lastPrice)))
        .map((x) => [x.symbol, Number(x.lastPrice)]),
    );

    const changes = all.map((x) => Number(x.priceChangePercent || 0));
    const breadth = (changes.filter((x) => x > 0).length / all.length) * 100;
    const averageChange = changes.reduce((a, b) => a + b, 0) / changes.length;
    const btcChange = Number(tickers.find((x) => x.symbol === 'BTCUSDT')?.priceChangePercent || 0);
    const avgAbsChange = changes.reduce((a,b)=>a+Math.abs(b),0) / changes.length;
    let regime = 'YATAY';
    if (btcChange < -5 || (breadth < 20 && averageChange < -3)) regime = 'PANIK';
    else if (avgAbsChange > 7) regime = 'YUKSEK_VOLATILITE';
    else if (averageChange < -2.2 && breadth < 35) regime = 'AYI';
    else if (averageChange > 3 && breadth > 70) regime = 'GUCLU_BOGA';
    else if (averageChange > 1 && breadth > 55) regime = 'ZAYIF_BOGA';
    else if (btcChange > 0 && averageChange > 0 && breadth > 50) regime = 'TOPARLANMA';
    else if (btcChange > 1 && breadth < 45) regime = 'DAGITIM';
    const marketRisk = regime === 'PANIK' ? 95 : regime === 'YUKSEK_VOLATILITE' ? 80 : regime === 'AYI' ? 72 : regime === 'DAGITIM' ? 68 : regime === 'GUCLU_BOGA' ? 22 : regime === 'ZAYIF_BOGA' ? 30 : regime === 'TOPARLANMA' ? 38 : 45;

    const { data: settings } = await retry('Ayarlar okunamadi', () => sb
      .from('trading_settings')
      .select('*')
      .eq('cloud_runner_enabled', true)
      .eq('execution_mode', 'PAPER')); 

    const cursor = Number(claim.cursor || 0) % all.length;
    let batch = all.slice(cursor, cursor + 5);
    if (batch.length < 5) batch = [...batch, ...all.slice(0, 5 - batch.length)];
    const nextCursor = (cursor + 5) % all.length;

    // Acik PAPER100 pozisyonlarinin stop / TP / trailing yonetimi.
    const { data: positions } = await retry('Acik pozisyonlar okunamadi', () => sb.from('paper_positions').select('*')); 

    for (const position of positions || []) {
      const price = priceMap.get(position.symbol);
      if (!price) continue;

      const highest = Math.max(Number(position.highest_price || position.average_entry), price);
      let stop = Number(position.stop_loss || 0);

      if (price >= Number(position.trailing_activation || Infinity)) {
        stop = Math.max(
          stop,
          highest * (1 - Number(position.trailing_distance_percent || 1) / 100),
          Number(position.average_entry) * 1.0022,
        );
      }

      await sb.from('paper_positions').update({ highest_price: highest, stop_loss: stop }).eq('id', position.id);

      if (stop && price <= stop) {
        await sb.rpc('paper_sell_fraction_for_user', {
          p_user_id: position.user_id,
          p_symbol: position.symbol,
          p_price: price,
          p_fraction: 1,
          p_reason: price < Number(position.average_entry) ? 'ZARAR_DURDUR' : 'IZ_SUREN_STOP',
        });
        continue;
      }

      if (!position.tp1_hit && position.take_profit_1 && price >= Number(position.take_profit_1)) {
        await sb.rpc('paper_sell_fraction_for_user', {
          p_user_id: position.user_id,
          p_symbol: position.symbol,
          p_price: price,
          p_fraction: 0.25,
          p_reason: 'KAR_AL_1',
        });
        await sb.from('paper_positions').update({
          tp1_hit: true,
          stop_loss: Number(position.average_entry) * 1.0022,
        }).eq('id', position.id);
      } else if (!position.tp2_hit && position.take_profit_2 && price >= Number(position.take_profit_2)) {
        await sb.rpc('paper_sell_fraction_for_user', {
          p_user_id: position.user_id,
          p_symbol: position.symbol,
          p_price: price,
          p_fraction: 0.33,
          p_reason: 'KAR_AL_2',
        });
        await sb.from('paper_positions').update({ tp2_hit: true }).eq('id', position.id);
      }
    }

    // 1 dakikasi dolan golge sinyallerini coz.
    const { data: openShadow } = await retry('Golge sinyalleri okunamadi', () => sb
      .from('shadow_signals')
      .select('*')
      .eq('status', 'OPEN')
      .lte('resolve_at', new Date().toISOString()));

    for (const shadow of openShadow || []) {
      const price = priceMap.get(shadow.symbol);
      if (!price) continue;
      const returnPct = (price / Number(shadow.entry_price) - 1) * 100;
      const decisionChanged = shadow.decision_with_news !== shadow.decision_without_news;
      let newsContribution = 0;

      if (decisionChanged) {
        if (shadow.decision_with_news === 'NO_TRADE' && shadow.decision_without_news === 'BUY_CANDIDATE') {
          newsContribution = -returnPct;
        } else if (shadow.decision_with_news === 'BUY_CANDIDATE') {
          newsContribution = returnPct;
        }
      }

      await sb.from('shadow_signals').update({
        exit_price: price,
        return_pct: returnPct,
        news_contribution_pct: newsContribution,
        news_contribution_usd: newsContribution * 0.25,
        resolved_at: new Date().toISOString(),
        status: 'RESOLVED',
      }).eq('id', shadow.id);
    }

    for (const st of settings || []) {
      const run = {
        user_id: st.user_id,
        universe_size: all.length,
        scanned_count: 0,
        candidate_count: 0,
        risk_allowed_count: 0,
        executed_count: 0,
        blocked_count: 0,
        scan_cursor: cursor,
        status: 'RUNNING',
        market_regime: regime,
        market_risk: marketRisk,
        market_breadth: breadth,
        market_avg_change: averageChange,
        market_volatility: Math.abs(averageChange),
      };

      const { data: runRow } = await retry('Tarama kaydi acilamadi', () => sb
        .from('autopilot_scan_runs')
        .insert(run)
        .select()
        .single());

      let best = null;
      const resultRows = [];
      const newShadowRows = [];

      const { data: openForUser } = await retry('Acik golge listesi okunamadi', () => sb
        .from('shadow_signals')
        .select('symbol')
        .eq('user_id', st.user_id)
        .eq('status', 'OPEN'));
      const openShadowSymbols = new Set((openForUser || []).map((x) => x.symbol));

      // Bes coinlik partinin tum mum isteklerini paralel yap. Boylece Vercel fonksiyonu
      // uzun sure acik kalmaz; tek bir coin hatasi digerlerini durdurmaz.
      const marketJobs = await Promise.allSettled(batch.map(async (ticker) => {
        const [scalpKlines, dayKlines, swingKlines] = await Promise.all([
          getKlines(ticker.symbol, '15m'),
          getKlines(ticker.symbol, '1h'),
          getKlines(ticker.symbol, '4h'),
        ]);
        return { ticker, scalpKlines, dayKlines, swingKlines };
      }));

      for (let jobIndex = 0; jobIndex < marketJobs.length; jobIndex += 1) {
        const job = marketJobs[jobIndex];
        const ticker = batch[jobIndex];
        if (job.status === 'rejected') {
          resultRows.push({
            run_id: runRow.id,
            user_id: st.user_id,
            symbol: ticker.symbol,
            primary_strategy: 'VERI_HATASI',
            consensus_count: 0,
            market_regime: regime,
            news_level: 'NORMAL',
            veto_active: false,
            risk_manager_allowed: false,
            blocks: [`Piyasa verisi alinamadi: ${job.reason?.message || String(job.reason)}`],
            final_action: 'NO_TRADE',
          });
          continue;
        }

        try {
          const { scalpKlines, dayKlines, swingKlines } = job.value;
          const scores = [score(scalpKlines), score(dayKlines), score(swingKlines)];
          const names = ['SCALP', 'GUNLUK', 'SWING'];
          const bestIndex = scores.map((x) => x.opp).indexOf(Math.max(...scores.map((x) => x.opp)));
          const q = scores[bestIndex];
          const ensemble = strategyEnsemble(scores);

          const consensusCount = scores.filter((x) => x.opp >= SHADOW_MIN_OPPORTUNITY).length;
          const trendConsensusCount = scores.filter((x) => x.trendAligned).length;
          const configuredOpportunity = Math.max(AUTO_MIN_OPPORTUNITY, Number(st.paper_candidate_opportunity || 0));
          const configuredRisk = Math.min(AUTO_MAX_RISK, Number(st.paper_max_risk || AUTO_MAX_RISK));
          const configuredConfidence = Math.max(AUTO_MIN_CONFIDENCE, Number(st.paper_min_confidence || 0));

          const qualityGate = q.opp >= configuredOpportunity
            && q.risk <= configuredRisk
            && q.conf >= configuredConfidence
            && consensusCount >= AUTO_MIN_CONSENSUS
            && trendConsensusCount >= AUTO_MIN_CONSENSUS
            && ensemble.count >= 4
            && q.entryTimingOk;
          const regimeGate = ['GUCLU_BOGA','ZAYIF_BOGA','YATAY','TOPARLANMA'].includes(regime);
          const allowed = qualityGate && regimeGate && !st.safe_mode;

          // 75-79 puan arasi sadece golge testinde izlenir. 80+ bile olsa giris
          // teyidi, zaman dilimi mutabakati ve rejim kapisini gecmeden alis yapilmaz.
          const finalAction = allowed ? 'BUY_CANDIDATE' : 'NO_TRADE';

          resultRows.push({
            run_id: runRow.id,
            user_id: st.user_id,
            symbol: ticker.symbol,
            opportunity: q.opp,
            risk: q.risk,
            confidence: q.conf,
            required_opportunity: configuredOpportunity,
            max_allowed_risk: configuredRisk,
            required_confidence: configuredConfidence,
            primary_strategy: ensemble.primary,
            consensus_count: consensusCount,
            market_regime: regime,
            news_level: 'NORMAL',
            veto_active: regime === 'PANIK' || regime === 'AYI',
            risk_manager_allowed: allowed,
            blocks: allowed ? [] : [
              ...(q.opp >= SHADOW_MIN_OPPORTUNITY && q.opp < configuredOpportunity ? [`${q.opp} puan: yalniz Golge Testi, otomatik alis yok`] : q.opp < SHADOW_MIN_OPPORTUNITY ? [`Firsat puani ${q.opp}/${SHADOW_MIN_OPPORTUNITY} golge kalite tabaninin altinda`] : []),
              ...(q.risk > configuredRisk ? [`Risk puani ${q.risk}/${configuredRisk} ustunde`] : []),
              ...(q.conf < configuredConfidence ? [`Guven puani ${q.conf}/${configuredConfidence} altinda`] : []),
              ...(consensusCount < AUTO_MIN_CONSENSUS ? ['En az 2 zaman diliminde 75+ mutabakat yok'] : []),
              ...(trendConsensusCount < AUTO_MIN_CONSENSUS ? ['En az 2 zaman diliminde trend hizasi yok'] : []),
              ...(ensemble.count < 4 ? [`Strateji topluluğu yetersiz: ${ensemble.count}/6 olumlu oy (${ensemble.positive.join(', ') || 'oy yok'})`] : []),
              ...(!q.entryTimingOk ? [`Giris teyidi yok (RSI ${q.rsi.toFixed(1)}, hacim x${q.volumeRatio.toFixed(2)}, EMA9 uzaklik %${q.distanceFromEma9Pct.toFixed(2)})`] : []),
              ...(!regimeGate ? [`${regime} piyasa rejiminde yeni spot alis kapali`] : []),
              ...(st.safe_mode ? ['Guvenli Mod acik'] : []),
            ],
            final_action: finalAction,
          });

          if (!openShadowSymbols.has(ticker.symbol)) {
            openShadowSymbols.add(ticker.symbol);
            newShadowRows.push({
              user_id: st.user_id,
              symbol: ticker.symbol,
              entry_price: Number(ticker.lastPrice),
              opportunity_with_news: q.opp,
              risk_with_news: q.risk,
              confidence_with_news: q.conf,
              decision_with_news: finalAction,
              opportunity_without_news: q.opp,
              risk_without_news: q.risk,
              confidence_without_news: q.conf,
              decision_without_news: finalAction,
              primary_strategy: ensemble.primary,
              market_regime: regime,
              consensus_count: consensusCount,
              veto_active: regime === 'PANIK',
              news_level: 'NORMAL',
              news_reason: `Haber saglayicisi yok | RSI ${q.rsi.toFixed(1)} | hacim x${q.volumeRatio.toFixed(2)} | EMA9 uzaklik %${q.distanceFromEma9Pct.toFixed(2)}`, 
              horizon_minutes: 1,
              resolve_at: new Date(Date.now() + 60_000).toISOString(),
              status: 'OPEN',
            });
          }

          if (allowed && (!best || q.opp - q.risk / 2 > best.rank)) {
            best = {
              symbol: ticker.symbol,
              price: Number(ticker.lastPrice),
              q,
              strategy: ensemble.primary,
              ensemble,
              dayKlines,
              quoteVolume: Number(ticker.quoteVolume || 0),
              rank: q.opp - q.risk / 2 + ensemble.count * 2,
            };
          }
        } catch (error) {
          resultRows.push({
            run_id: runRow.id,
            user_id: st.user_id,
            symbol: ticker.symbol,
            primary_strategy: 'HESAP_HATASI',
            consensus_count: 0,
            market_regime: regime,
            news_level: 'NORMAL',
            veto_active: false,
            risk_manager_allowed: false,
            blocks: [`Analiz hatasi: ${error?.message || String(error)}`],
            final_action: 'NO_TRADE',
          });
        }
      }

      if (newShadowRows.length) {
        await retry('Yeni golge sinyalleri yazilamadi', () => sb.from('shadow_signals').insert(newShadowRows));
      }

      if (resultRows.length) await retry('Tarama sonuclari yazilamadi', () => sb.from('autopilot_scan_results').insert(resultRows));

      let executed = 0;
      if (st.automation_mode === 'FULL_AUTO' && !st.safe_mode && best) {
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        const cooldownStart = new Date(Date.now() - STOP_COOLDOWN_MINUTES * 60_000).toISOString();
        const pairHistoryStart = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
        const [{ data: account }, { data: userPositions }, { data: todaySells }, { data: recentSells }, { data: pairSells }] = await Promise.all([
          sb.from('paper_accounts').select('*').eq('user_id', st.user_id).single(),
          sb.from('paper_positions').select('*').eq('user_id', st.user_id),
          sb.from('trade_history').select('realized_pnl,created_at').eq('user_id', st.user_id).eq('side', 'SELL').gte('created_at', dayStart.toISOString()),
          sb.from('trade_history').select('symbol,reason,realized_pnl,created_at').eq('user_id', st.user_id).eq('side', 'SELL').gte('created_at', cooldownStart).order('created_at', { ascending: false }).limit(20),
          sb.from('trade_history').select('symbol,realized_pnl,created_at').eq('user_id', st.user_id).eq('side', 'SELL').eq('symbol', best.symbol).gte('created_at', pairHistoryStart).order('created_at', { ascending: false }).limit(5),
        ]);

        const currentPositions = userPositions || [];
        const hasSymbol = currentPositions.some((p) => p.symbol === best.symbol);
        const realizedToday = (todaySells || []).reduce((sum, t) => sum + Number(t.realized_pnl || 0), 0);
        const dailyLossLimit = Number(account.starting_balance || 100) * (Number(st.max_daily_loss_percent || 2) / 100);
        const dailyLossBlocked = realizedToday <= -dailyLossLimit;

        const symbolRecentSell = (recentSells || []).find((t) => t.symbol === best.symbol);
        let cooldownBlocked = false;
        if (symbolRecentSell) {
          const ageMin = (Date.now() - new Date(symbolRecentSell.created_at).getTime()) / 60_000;
          const required = ['ZARAR_DURDUR', 'IZ_SUREN_STOP'].includes(symbolRecentSell.reason) ? STOP_COOLDOWN_MINUTES : MANUAL_COOLDOWN_MINUTES;
          cooldownBlocked = ageMin < required;
        }

        const lastThree = (recentSells || []).slice(0, 3);
        const lossStreakBlocked = lastThree.length === 3 && lastThree.every((t) => Number(t.realized_pnl || 0) < 0)
          && (Date.now() - new Date(lastThree[0].created_at).getTime()) < 60 * 60_000;

        const pairLossLocked = (pairSells || []).length >= 3 && (pairSells || []).reduce((sum,t)=>sum+Number(t.realized_pnl||0),0) < 0;
        const equityBefore = Number(account.balance) + currentPositions.reduce((sum,p)=>sum+(priceMap.get(p.symbol)||Number(p.average_entry))*Number(p.quantity),0);
        const drawdownPct = Number(account.starting_balance || 100) > 0 ? (Number(account.starting_balance || 100) - equityBefore) / Number(account.starting_balance || 100) * 100 : 0;
        const maxDrawdownBlocked = drawdownPct >= 5;

        let correlationMultiplier = 1;
        let maxCorrelation = 0;
        if (currentPositions.length) {
          const candidateReturns = returnsFromKlines(best.dayKlines);
          const corrJobs = await Promise.allSettled(currentPositions.slice(0,3).map(async p => ({symbol:p.symbol, rows:await getKlines(p.symbol,'1h')})));
          for (const job of corrJobs) if (job.status === 'fulfilled') maxCorrelation = Math.max(maxCorrelation, correlation(candidateReturns, returnsFromKlines(job.value.rows)));
          if (maxCorrelation >= 0.92) correlationMultiplier = 0;
          else if (maxCorrelation >= 0.82) correlationMultiplier = 0.60;
        }

        if (currentPositions.length < Number(st.max_positions) && !hasSymbol && !dailyLossBlocked && !cooldownBlocked && !lossStreakBlocked && !pairLossLocked && !maxDrawdownBlocked && correlationMultiplier > 0) {
          const equity = Number(account.balance) + currentPositions.reduce(
            (sum, p) => sum + (priceMap.get(p.symbol) || Number(p.average_entry)) * Number(p.quantity),
            0,
          );
          // ATR tabanli, komisyonu ezmeyecek kadar genis stop.
          const stopPct = clamp(best.q.atr * 1.6 / 100, 0.015, 0.045);
          const rawRiskBudget = equity * (Number(st.risk_per_trade_percent) / 100);
          const currentOpenRisk = currentPositions.reduce((sum, p) => sum + Number(p.risk_amount || 0), 0);
          const maxOpenRiskUsd = equity * (Number(st.max_open_risk_percent || 1.75) / 100);
          const remainingOpenRisk = Math.max(0, maxOpenRiskUsd - currentOpenRisk);
          const riskBudget = Math.min(rawRiskBudget, remainingOpenRisk);
          const qualitySizeMultiplier = (best.q.opp >= 90 ? 1 : best.q.opp >= 85 ? 0.75 : 0.50) * correlationMultiplier;
          const spend = Math.min(
            (riskBudget / stopPct) * qualitySizeMultiplier,
            equity * (Number(st.position_size_percent) / 100) * qualitySizeMultiplier,
            Number(account.balance),
          );

          // TP1 komisyon sonrasi en az ~1.4R hedefler; stop da ATR ile uyumludur.
          const estimatedNetRisk = stopPct + 0.002;
          const estimatedNetReward1 = stopPct * 1.8 - 0.002;
          const feeAwareRR = estimatedNetReward1 / Math.max(0.0001, estimatedNetRisk);

          if (spend >= 2 && riskBudget > 0 && feeAwareRR >= 1.30) {
            const slippageBps = executionSlippageBps(best.quoteVolume, best.q.atr);
            const price = best.price * (1 + slippageBps / 10_000);
            const stop = price * (1 - stopPct);
            const { error: buyError } = await sb.rpc('paper_buy_for_user', {
              p_user_id: st.user_id,
              p_symbol: best.symbol,
              p_price: price,
              p_spend: spend,
              p_stop: stop,
              p_tp1: price * (1 + stopPct * 1.8),
              p_tp2: price * (1 + stopPct * 3.0),
              p_trail_activation: price * (1 + stopPct * 2.1),
              p_trail_pct: Math.max(0.7, stopPct * 100 * 0.60),
              p_strategy: best.strategy,
              p_regime: regime,
              p_opp: best.q.opp,
              p_risk: best.q.risk,
              p_conf: best.q.conf,
            });

            if (!buyError) {
              executed = 1;
              await sb.from('signals').insert({
                user_id: st.user_id,
                symbol: best.symbol,
                signal_type: 'BUY',
                price,
                opportunity: best.q.opp,
                risk: best.q.risk,
                confidence: best.q.conf,
                primary_strategy: best.strategy,
                market_regime: regime,
                status: 'EXECUTED',
                source: 'cloud-auto-runner',
                analysis: `Otomatik sanal işlem açıldı. Kalite ${best.q.opp}/100, strateji oyları ${best.ensemble.count}/6 (${best.ensemble.positive.join(', ')}), korelasyon ${maxCorrelation.toFixed(2)}, boyut x${qualitySizeMultiplier.toFixed(2)}, tahmini net R/R ${feeAwareRR.toFixed(2)}, simüle kayma ${slippageBps.toFixed(1)} bp.`,
              });
            }
          }
        }
      }

      await sb.from('autopilot_scan_runs').update({
        scanned_count: resultRows.length,
        candidate_count: resultRows.filter((x) => x.final_action === 'BUY_CANDIDATE').length,
        risk_allowed_count: resultRows.filter((x) => x.risk_manager_allowed).length,
        executed_count: executed,
        blocked_count: resultRows.filter((x) => !x.risk_manager_allowed).length,
        completed_at: new Date().toISOString(),
        status: 'COMPLETED',
      }).eq('id', runRow.id);

      await sb.from('trading_settings').update({
        runner_last_seen_at: new Date().toISOString(),
      }).eq('user_id', st.user_id);
    }

    await retry('Runner imleci ilerletilemedi', () => sb.rpc('advance_paper_runner', { p_cursor: nextCursor }));

    return res.status(200).json({
      ok: true,
      users: settings?.length || 0,
      scanned: batch.length,
      regime,
      binanceBase,
    });
  } catch (error) {
    const message = error?.message || String(error);
    console.error('PAPER100 runner hatasi:', message);
    await logHealth(sb, 'PAPER100_RUNNER', 'ERROR', message, {
      at: new Date().toISOString(),
    });
    return res.status(500).json({ error: message });
  }
}
