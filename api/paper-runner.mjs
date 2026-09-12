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
  'https://api2.binance.com',
  'https://api3.binance.com',
];

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

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
        headers: { 'User-Agent': 'kripto-paper100-cloud-runner/1.3.3' },
        signal: AbortSignal.timeout(12_000),
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
    `/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=60`,
    (value) => Array.isArray(value) && value.length >= 50 && Array.isArray(value[0]),
    `${symbol} ${interval} mum verisi`,
  );

  return data.map((x) => ({
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
  const atr = klines.slice(-14).reduce((sum, x) => sum + (x.h - x.l), 0) / 14 / last * 100;
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

  return {
    opp: Math.round(clamp(opportunity, 0, 100)),
    risk: Math.round(clamp(risk, 0, 100)),
    conf: Math.round(clamp(confidence, 0, 100)),
    atr,
  };
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

  const { data: claim, error: claimError } = await sb.rpc('claim_paper_runner');
  if (claimError) return res.status(500).json({ error: claimError.message });
  if (!claim?.claimed) return res.status(200).json({ ok: true, skipped: true, reason: 'RUNNER_BUSY' });

  try {
    const { tickers, base: binanceBase } = await get24hTickers();

    const all = tickers
      .filter((x) => typeof x?.symbol === 'string')
      .filter((x) => x.symbol.endsWith('USDT'))
      .filter((x) => !/(UP|DOWN|BULL|BEAR)USDT$/.test(x.symbol))
      .filter((x) => !['USDCUSDT', 'FDUSDUSDT', 'TUSDUSDT', 'DAIUSDT'].includes(x.symbol))
      .filter((x) => Number.isFinite(Number(x.quoteVolume)) && Number.isFinite(Number(x.lastPrice)))
      .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
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
    const regime = btcChange < -5 ? 'PANIK' : averageChange < -2 ? 'AYI' : averageChange > 2 ? 'BOGA' : 'YATAY';
    const marketRisk = regime === 'PANIK' ? 95 : regime === 'AYI' ? 70 : regime === 'BOGA' ? 25 : 45;

    const { data: settings, error: settingsError } = await sb
      .from('trading_settings')
      .select('*')
      .eq('cloud_runner_enabled', true)
      .eq('execution_mode', 'PAPER');

    if (settingsError) throw settingsError;

    const cursor = Number(claim.cursor || 0) % all.length;
    let batch = all.slice(cursor, cursor + 10);
    if (batch.length < 10) batch = [...batch, ...all.slice(0, 10 - batch.length)];
    const nextCursor = (cursor + 10) % all.length;

    // Acik PAPER100 pozisyonlarinin stop / TP / trailing yonetimi.
    const { data: positions, error: positionsError } = await sb.from('paper_positions').select('*');
    if (positionsError) throw positionsError;

    for (const position of positions || []) {
      const price = priceMap.get(position.symbol);
      if (!price) continue;

      const highest = Math.max(Number(position.highest_price || position.average_entry), price);
      let stop = Number(position.stop_loss || 0);

      if (price >= Number(position.trailing_activation || Infinity)) {
        stop = Math.max(
          stop,
          highest * (1 - Number(position.trailing_distance_percent || 1) / 100),
          Number(position.average_entry) * 1.001,
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
          stop_loss: Number(position.average_entry) * 1.001,
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
    const { data: openShadow, error: shadowError } = await sb
      .from('shadow_signals')
      .select('*')
      .eq('status', 'OPEN')
      .lte('resolve_at', new Date().toISOString());

    if (shadowError) throw shadowError;

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

      const { data: runRow, error: runError } = await sb
        .from('autopilot_scan_runs')
        .insert(run)
        .select()
        .single();

      if (runError) throw runError;

      let best = null;
      const resultRows = [];

      for (const ticker of batch) {
        try {
          const [scalpKlines, dayKlines, swingKlines] = await Promise.all([
            getKlines(ticker.symbol, '15m'),
            getKlines(ticker.symbol, '1h'),
            getKlines(ticker.symbol, '4h'),
          ]);

          const scores = [score(scalpKlines), score(dayKlines), score(swingKlines)];
          const names = ['SCALP', 'GUNLUK', 'SWING'];
          const bestIndex = scores.map((x) => x.opp).indexOf(Math.max(...scores.map((x) => x.opp)));
          const q = scores[bestIndex];

          const allowed = q.opp >= Number(st.paper_candidate_opportunity)
            && q.risk <= Number(st.paper_max_risk)
            && q.conf >= Number(st.paper_min_confidence)
            && regime !== 'PANIK'
            && !st.safe_mode;

          const finalAction = allowed ? 'BUY_CANDIDATE' : 'NO_TRADE';
          const consensusCount = scores.filter((x) => x.opp >= 65).length;

          resultRows.push({
            run_id: runRow.id,
            user_id: st.user_id,
            symbol: ticker.symbol,
            opportunity: q.opp,
            risk: q.risk,
            confidence: q.conf,
            required_opportunity: st.paper_candidate_opportunity,
            max_allowed_risk: st.paper_max_risk,
            required_confidence: st.paper_min_confidence,
            primary_strategy: names[bestIndex],
            consensus_count: consensusCount,
            market_regime: regime,
            news_level: 'NORMAL',
            veto_active: regime === 'PANIK',
            risk_manager_allowed: allowed,
            blocks: allowed ? [] : [regime === 'PANIK' ? 'PANIK piyasa rejimi' : 'Esikler karsilanmadi'],
            final_action: finalAction,
          });

          const { data: existing } = await sb
            .from('shadow_signals')
            .select('id')
            .eq('user_id', st.user_id)
            .eq('symbol', ticker.symbol)
            .eq('status', 'OPEN')
            .maybeSingle();

          if (!existing) {
            await sb.from('shadow_signals').insert({
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
              primary_strategy: names[bestIndex],
              market_regime: regime,
              consensus_count: consensusCount,
              veto_active: regime === 'PANIK',
              news_level: 'NORMAL',
              news_reason: 'Ucretli haber saglayicisi yapilandirilmadi',
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
              strategy: names[bestIndex],
              rank: q.opp - q.risk / 2,
            };
          }
        } catch (error) {
          // Bir coin hata verirse tum tarama durmasin; diagnostics'te gorunsun.
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
            blocks: [`Piyasa verisi alinamadi: ${error?.message || String(error)}`],
            final_action: 'NO_TRADE',
          });
        }
      }

      if (resultRows.length) await sb.from('autopilot_scan_results').insert(resultRows);

      let executed = 0;
      if (st.automation_mode === 'FULL_AUTO' && !st.safe_mode && best) {
        const [{ data: account }, { data: userPositions }] = await Promise.all([
          sb.from('paper_accounts').select('*').eq('user_id', st.user_id).single(),
          sb.from('paper_positions').select('*').eq('user_id', st.user_id),
        ]);

        const currentPositions = userPositions || [];
        const hasSymbol = currentPositions.some((p) => p.symbol === best.symbol);

        if (currentPositions.length < Number(st.max_positions) && !hasSymbol) {
          const equity = Number(account.balance) + currentPositions.reduce(
            (sum, p) => sum + (priceMap.get(p.symbol) || Number(p.average_entry)) * Number(p.quantity),
            0,
          );
          const stopPct = clamp(best.q.atr * 1.4 / 100, 0.012, 0.05);
          const riskBudget = equity * (Number(st.risk_per_trade_percent) / 100);
          const spend = Math.min(
            riskBudget / stopPct,
            equity * (Number(st.position_size_percent) / 100),
            Number(account.balance),
          );

          if (spend >= 2) {
            const price = best.price;
            const stop = price * (1 - stopPct);
            const { error: buyError } = await sb.rpc('paper_buy_for_user', {
              p_user_id: st.user_id,
              p_symbol: best.symbol,
              p_price: price,
              p_spend: spend,
              p_stop: stop,
              p_tp1: price * (1 + stopPct * 1.5),
              p_tp2: price * (1 + stopPct * 2.5),
              p_trail_activation: price * (1 + stopPct * 1.8),
              p_trail_pct: Math.max(0.6, stopPct * 100 * 0.55),
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
                analysis: 'Otomatik sanal islem acildi.',
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

    await sb.rpc('advance_paper_runner', { p_cursor: nextCursor });

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
