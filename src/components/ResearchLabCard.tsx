import { useEffect, useState, useRef } from 'react';
import { FlaskConical, Play, RefreshCw, ShieldCheck, TriangleAlert, BarChart3, Layers, Coins, Clock, CheckCircle2, XCircle } from 'lucide-react';

type Analytics = {
  resolvedSignals: number;
  openSignals: number;
  scoreBuckets: Record<string, { count: number; avgReturnPct: number; winRatePct: number }>;
  strategyAttribution: Record<string, { count: number; avgReturnPct: number; winRatePct: number }>;
  regimeAttribution: Record<string, { count: number; avgReturnPct: number; winRatePct: number }>;
  environmentComparison: {
    paper: { closedTrades: number; realizedPnlUsd: number; winRatePct: number; profitFactor: number };
    testnet: { closedTrades: number; realizedPnlUsd: number; winRatePct: number; profitFactor: number };
  };
  testReadiness: {
    shadowSampleReady: boolean;
    newsRetestReady: boolean;
    walkForwardRuns: number;
    walkForwardRobustRuns: number;
    testnetClosedTrades: number;
    paperClosedTrades: number;
    verdict: string;
  };
  newsRetest: {
    differingDecisions: number;
    savedLossPct: number;
    missedProfitPct: number;
    addedGoodPct: number;
    addedBadPct: number;
    newsCostUsd: number;
    aiCostUsd: number;
    netContributionUsd: number;
    verdict: string;
  };
  latestBacktests: Array<any>;
  mandatoryTestChecklist: string[];
};

type ProgressState = {
  active: boolean;
  stepText: string;
  currentCoinIndex: number;
  totalCoins: number;
  currentCoin: string;
  currentStrategy: string;
  currentInterval: string;
  percent: number;
  error?: string;
};

export default function ResearchLabCard() {
  const [data, setData] = useState<Analytics | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [attributionTab, setAttributionTab] = useState<'strategy' | 'coin' | 'timeframe' | 'walkforward'>('strategy');

  const progressIntervalRef = useRef<any>(null);

  const load = () =>
    fetch('/api/research/analytics')
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || d.detail);
        setData(d);
      })
      .catch(e => setError(e.message));

  useEffect(() => {
    load();
    return () => {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, []);

  const shadow = async () => {
    setBusy('shadow');
    setError('');
    try {
      const r = await fetch('/api/research/shadow/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 5 })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const resolveShadow = async () => {
    setBusy('resolve');
    setError('');
    try {
      const r = await fetch('/api/research/shadow/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const startMultiBacktest = async () => {
    setBusy('backtest');
    setError('');
    setProgress({
      active: true,
      stepText: 'Çoklu Backtest başlatılıyor…',
      currentCoinIndex: 0,
      totalCoins: 10,
      currentCoin: '',
      currentStrategy: '',
      currentInterval: '',
      percent: 3
    });

    // Start polling progress every 500ms
    progressIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/research/backtest/progress');
        if (res.ok) {
          const p = await res.json();
          setProgress(p);
          if (!p.active && p.percent >= 100) {
            clearInterval(progressIntervalRef.current);
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 500);

    try {
      const r = await fetch('/api/research/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'MULTI' })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      setProgress(null);
      setBusy('');
    }
  };

  if (!data) return <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 text-sm text-zinc-500">V9 Validation Lab yükleniyor…</div>;

  const n = data.newsRetest;
  const enough = data.resolvedSignals >= 50;
  const latestRun = data.latestBacktests && data.latestBacktests[0];
  const m = latestRun?.metrics || {};
  const isMultiRun = latestRun?.symbol?.includes('MULTI') || (m.testedCoins && m.testedCoins > 1);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 text-zinc-100 font-medium">
            <FlaskConical size={18} className="text-violet-400" /> V9 Validation Lab
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Çoklu Piyasa Backtest • 10 Likit Spot Coin • SCALP/DAY/SWING • Fees & Slippage Dahil Net Getiri
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={resolveShadow}
            disabled={!!busy}
            title="Vadesi (1 dk) dolmuş bekleyen shadow sinyallerini çözümle ve istatistikleri güncelle"
            className="px-3 py-2 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 flex items-center gap-2 text-zinc-200 transition-colors"
          >
            <CheckCircle2 size={14} className={busy === 'resolve' ? 'animate-spin text-emerald-400' : 'text-emerald-400'} />
            Shadow Çözümle (1 dk)
          </button>
          <button
            onClick={shadow}
            disabled={!!busy}
            className="px-3 py-2 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 flex items-center gap-2 text-zinc-200 transition-colors"
          >
            <Play size={14} /> 5 Coin Shadow Tara
          </button>
          <button
            onClick={startMultiBacktest}
            disabled={!!busy}
            className="px-3 py-2 text-xs rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 flex items-center gap-2 font-medium text-white shadow-sm shadow-violet-900/30 transition-colors"
          >
            <RefreshCw size={14} className={busy === 'backtest' ? 'animate-spin' : ''} />
            Çoklu Backtest Başlat
          </button>
        </div>
      </div>

      {/* Live Backtest Progress Tracker */}
      {busy === 'backtest' && progress && (
        <div className="mb-4 bg-violet-950/40 border border-violet-800/40 rounded-lg p-3.5 animate-pulse">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-medium text-violet-200 flex items-center gap-2">
              <RefreshCw size={12} className="animate-spin text-violet-400" />
              {progress.stepText || 'Backtest çalışıyor…'}
            </span>
            <span className="text-violet-400 font-mono font-semibold">{progress.percent || 10}%</span>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-violet-500 h-full transition-all duration-300 rounded-full"
              style={{ width: `${Math.max(5, progress.percent || 10)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-zinc-400 mt-2">
            <span>
              Coin: <strong className="text-zinc-200">{progress.currentCoin || '…'}</strong> ({progress.currentCoinIndex || 0}/{progress.totalCoins || 10})
            </span>
            <span>
              Strateji: <strong className="text-zinc-200">{progress.currentStrategy || '…'}</strong> • Zaman Dilimi: <strong className="text-zinc-200">{progress.currentInterval || '…'}</strong>
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
          {error}
        </div>
      )}

      {/* Top Overview Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
        <Metric label="Çözülmüş Shadow" value={String(data.resolvedSignals)} />
        <Metric label="Bekleyen Shadow" value={String(data.openSignals)} />
        <Metric label="Haber Kararı Değiştirdi" value={String(n.differingDecisions)} />
        <Metric label="Net Haber Katkısı" value={`${n.netContributionUsd >= 0 ? '+' : ''}$${n.netContributionUsd.toFixed(2)}`} />
      </div>

      {/* CryptoPanic Retest Box */}
      <div className={`rounded-lg border p-4 mb-4 ${enough ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-amber-500/20 bg-amber-500/5'}`}>
        <div className="flex items-center gap-2 text-sm font-medium">
          {enough ? <ShieldCheck size={17} className="text-emerald-400" /> : <TriangleAlert size={17} className="text-amber-400" />}
          CryptoPanic / Haber Motoru Retest
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
          <Metric label="Engellenen Zarar" value={`${n.savedLossPct.toFixed(2)} puan`} />
          <Metric label="Kaçırılan Kâr" value={`${n.missedProfitPct.toFixed(2)} puan`} />
          <Metric label="News + AI Maliyeti" value={`$${(n.newsCostUsd + n.aiCostUsd).toFixed(2)}`} />
          <Metric label="Karar" value={n.verdict} />
        </div>
        {!enough && (
          <p className="text-xs text-amber-300 mt-3">
            Kalıcı karar vermiyoruz: en az 50 çözülmüş shadow sinyali gerekli. Bu kontrol test aşamasında özellikle tekrar incelenecek.
          </p>
        )}
      </div>

      {/* Paper vs Testnet Performance */}
      <div className="grid md:grid-cols-2 gap-3 mb-4">
        <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-4">
          <div className="text-xs text-zinc-500 mb-2 font-medium">PAPER gerçekleşmiş performans</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Metric label="Kapalı İşlem" value={String(data.environmentComparison.paper.closedTrades)} />
            <Metric label="Realized P&L" value={`${data.environmentComparison.paper.realizedPnlUsd >= 0 ? '+' : ''}$${data.environmentComparison.paper.realizedPnlUsd.toFixed(2)}`} />
            <Metric label="Win Rate" value={`%${data.environmentComparison.paper.winRatePct}`} />
            <Metric label="Profit Factor" value={String(data.environmentComparison.paper.profitFactor)} />
          </div>
        </div>
        <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-4">
          <div className="text-xs text-zinc-500 mb-2 font-medium">TESTNET gerçekleşmiş performans</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Metric label="Kapalı İşlem" value={String(data.environmentComparison.testnet.closedTrades)} />
            <Metric label="Realized P&L" value={`${data.environmentComparison.testnet.realizedPnlUsd >= 0 ? '+' : ''}$${data.environmentComparison.testnet.realizedPnlUsd.toFixed(2)}`} />
            <Metric label="Win Rate" value={`%${data.environmentComparison.testnet.winRatePct}`} />
            <Metric label="Profit Factor" value={String(data.environmentComparison.testnet.profitFactor)} />
          </div>
        </div>
      </div>

      {/* V9 Test Readiness */}
      <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-4 mb-4">
        <div className="text-xs text-zinc-500 mb-2 font-medium">V9 Test Readiness & Gatekeeper</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <Metric label="Walk-Forward Run" value={`${data.testReadiness.walkForwardRobustRuns}/${data.testReadiness.walkForwardRuns} robust`} />
          <Metric label="Shadow Sample" value={data.testReadiness.shadowSampleReady ? 'HAZIR' : 'EKSİK'} />
          <Metric label="Testnet Closed" value={String(data.testReadiness.testnetClosedTrades)} />
          <Metric label="Sonraki Kapı" value={data.testReadiness.verdict} />
        </div>
      </div>

      {/* Multi-Market Backtest Section */}
      {latestRun && (
        <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-4 mb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-3 mb-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <BarChart3 size={16} className="text-violet-400" />
                {isMultiRun ? 'Çoklu Piyasa Backtest Sonucu' : `Backtest Sonucu • ${latestRun.symbol}/${latestRun.interval}`}
              </div>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                {m.note || 'Deterministik strateji motoru, 10 Spot parite, no look-ahead bias, fees + slippage dahil net sonuçlar.'}
              </p>
            </div>
            <div className="text-right text-[11px] text-zinc-500">
              {new Date(latestRun.created_at).toLocaleString('tr-TR')}
            </div>
          </div>

          {/* Aggregated Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 text-xs mb-4">
            <Metric label="Test Edilen Coin" value={`${m.testedCoins || 1} Coin`} />
            <Metric label="Toplam İşlem" value={String(m.trades || 0)} />
            <Metric label="Win Rate" value={`%${m.winRatePct || 0}`} />
            <Metric
              label="Net Getiri"
              value={`${(m.netReturnPct || 0) >= 0 ? '+' : ''}%${m.netReturnPct || 0}`}
            />
            <Metric
              label="Net P&L (10k Base)"
              value={`${(m.netPnlUsd || 0) >= 0 ? '+' : ''}$${(m.netPnlUsd || 0).toLocaleString('en-US')}`}
            />
            <Metric label="Profit Factor" value={String(m.profitFactor || 0)} />
            <Metric label="Max Drawdown" value={`%${m.maxDrawdownPct || 0}`} />
            <Metric label="Average Trade" value={`%${m.avgTradePct || 0}`} />
            <Metric label="Sharpe-like" value={String(m.sharpeLike || 0)} />
            <Metric label="Toplam Maliyet (Fee+Slip)" value={`%${m.totalCostPct || 0}`} />
          </div>

          {/* Attribution Tabs */}
          <div className="flex items-center gap-1.5 border-b border-zinc-800 pb-2 mb-3 overflow-x-auto text-xs">
            <button
              onClick={() => setAttributionTab('strategy')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${
                attributionTab === 'strategy'
                  ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30 font-medium'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Layers size={13} /> Strateji Attribution
            </button>
            <button
              onClick={() => setAttributionTab('coin')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${
                attributionTab === 'coin'
                  ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30 font-medium'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Coins size={13} /> Coin Attribution ({m.testedCoins || Object.keys(m.coinAttribution || {}).length})
            </button>
            <button
              onClick={() => setAttributionTab('timeframe')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${
                attributionTab === 'timeframe'
                  ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30 font-medium'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Clock size={13} /> Timeframe Attribution
            </button>
            <button
              onClick={() => setAttributionTab('walkforward')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${
                attributionTab === 'walkforward'
                  ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30 font-medium'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <ShieldCheck size={13} /> Walk-Forward / OOS
            </button>
          </div>

          {/* Strategy Attribution Content */}
          {attributionTab === 'strategy' && (
            <div className="grid sm:grid-cols-3 gap-3">
              {['SCALP', 'DAY', 'SWING'].map(name => {
                const s = m.strategyAttribution?.[name] || { trades: 0, winRatePct: 0, netReturnPct: 0, profitFactor: 0, maxDrawdownPct: 0, avgTradePct: 0 };
                return (
                  <div key={name} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-xs text-zinc-200">{name}</span>
                      <span className="text-[11px] text-zinc-500">{s.trades} işlem</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <div className="text-[10px] text-zinc-500">Win Rate</div>
                        <div className="font-medium text-zinc-300">%{s.winRatePct}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-zinc-500">Net Getiri</div>
                        <div className={`font-medium ${s.netReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {s.netReturnPct >= 0 ? '+' : ''}%{s.netReturnPct}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-zinc-500">Profit Factor</div>
                        <div className="font-medium text-zinc-300">{s.profitFactor}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-zinc-500">Max DD</div>
                        <div className="font-medium text-zinc-400">%{s.maxDrawdownPct}</div>
                      </div>
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-2 border-t border-zinc-800/60 pt-1.5 flex justify-between">
                      <span>Avg Trade:</span>
                      <span className={s.avgTradePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {s.avgTradePct >= 0 ? '+' : ''}%{s.avgTradePct}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Coin Attribution Content */}
          {attributionTab === 'coin' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
              {Object.entries(m.coinAttribution || {}).map(([sym, c]: [string, any]) => (
                <div key={sym} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-xs text-zinc-100">{sym}</span>
                    <span className="text-[10px] text-zinc-500">{c.trades} işl.</span>
                  </div>
                  <div className="space-y-1 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Net:</span>
                      <span className={`font-semibold ${c.netReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {c.netReturnPct >= 0 ? '+' : ''}%{c.netReturnPct}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">WR:</span>
                      <span className="text-zinc-300">%{c.winRatePct}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">PF:</span>
                      <span className="text-zinc-300">{c.profitFactor}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Timeframe Attribution Content */}
          {attributionTab === 'timeframe' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
              {['5m', '15m', '1h', '4h', '1d'].map(tf => {
                const t = m.timeframeAttribution?.[tf] || { trades: 0, winRatePct: 0, netReturnPct: 0, profitFactor: 0, avgTradePct: 0 };
                return (
                  <div key={tf} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-xs text-violet-300">{tf}</span>
                      <span className="text-[10px] text-zinc-500">{t.trades} işlem</span>
                    </div>
                    <div className="space-y-1 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Net Getiri:</span>
                        <span className={`font-semibold ${t.netReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {t.netReturnPct >= 0 ? '+' : ''}%{t.netReturnPct}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Win Rate:</span>
                        <span className="text-zinc-300">%{t.winRatePct}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">PF:</span>
                        <span className="text-zinc-300">{t.profitFactor}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Walk-Forward / Out-of-Sample Content */}
          {attributionTab === 'walkforward' && m.walkForward && (
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-zinc-900/40 p-2.5 rounded-lg border border-zinc-800 text-xs">
                <div className="flex items-center gap-2">
                  {m.walkForward.robust ? (
                    <CheckCircle2 size={16} className="text-emerald-400" />
                  ) : (
                    <XCircle size={16} className="text-amber-400" />
                  )}
                  <span>
                    Walk-Forward Karar:{' '}
                    <strong className={m.walkForward.robust ? 'text-emerald-400' : 'text-amber-400'}>
                      {m.walkForward.verdict || (m.walkForward.robust ? 'ROBUST' : 'OVERFITTED')}
                    </strong>
                  </span>
                </div>
                <div className="text-zinc-400">
                  Stabilite Skoru:{' '}
                  <strong className="text-zinc-200">{m.walkForward.stabilityScore || 0}/100</strong>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3 text-xs">
                {/* In-Sample Train */}
                <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
                  <div className="text-zinc-400 font-semibold mb-2 flex items-center justify-between">
                    <span>In-Sample (Eğitim %60)</span>
                    <span className="text-[10px] text-zinc-500">Kronolojik İlk Bölüm</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <Metric label="İşlem Sayısı" value={String(m.walkForward.train?.trades || 0)} />
                    <Metric label="Win Rate" value={`%${m.walkForward.train?.winRatePct || 0}`} />
                    <Metric
                      label="Net Getiri"
                      value={`${(m.walkForward.train?.netReturnPct || 0) >= 0 ? '+' : ''}%${m.walkForward.train?.netReturnPct || 0}`}
                    />
                    <Metric label="Profit Factor" value={String(m.walkForward.train?.profitFactor || 0)} />
                  </div>
                </div>

                {/* Out-of-Sample Test */}
                <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 ring-1 ring-violet-500/20">
                  <div className="text-violet-300 font-semibold mb-2 flex items-center justify-between">
                    <span>Out-of-Sample (Test %40)</span>
                    <span className="text-[10px] text-violet-400/80">Görülmemiş Veri</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <Metric label="İşlem Sayısı" value={String(m.walkForward.test?.trades || 0)} />
                    <Metric label="Win Rate" value={`%${m.walkForward.test?.winRatePct || 0}`} />
                    <Metric
                      label="Net Getiri"
                      value={`${(m.walkForward.test?.netReturnPct || 0) >= 0 ? '+' : ''}%${m.walkForward.test?.netReturnPct || 0}`}
                    />
                    <Metric label="Profit Factor" value={String(m.walkForward.test?.profitFactor || 0)} />
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-zinc-400 bg-zinc-900/40 p-2.5 rounded-lg border border-zinc-800/80">
                <span className="font-semibold text-zinc-300">Out-of-sample kuralı:</span> Model optimizasyonu yapılmadan, kronolojik son %40 veri üzerinde test edilmiştir. Yalnızca in-sample'da iyi olup out-of-sample'da negatif getiri veya PF &lt; 1.0 üreten sistemler <strong>ROBUST</strong> kabul edilmez.
              </div>
            </div>
          )}

          {/* Monte Carlo Risk Breakdown */}
          {latestRun.monteCarlo && (
            <div className="mt-3 pt-3 border-t border-zinc-800/70 text-[11px] text-zinc-400 flex flex-wrap items-center justify-between gap-2">
              <span className="text-zinc-500 font-medium">Monte Carlo Dağılımı (500 Simülasyon):</span>
              <div className="flex flex-wrap gap-3 font-mono text-zinc-300">
                <span>Medyan Bakiye: ${latestRun.monteCarlo.finalEquityMedian?.toLocaleString()}</span>
                <span>P5 (Kötü Senaryo): ${latestRun.monteCarlo.finalEquityP05?.toLocaleString()}</span>
                <span>P95 (İyi Senaryo): ${latestRun.monteCarlo.finalEquityP95?.toLocaleString()}</span>
                <span className={latestRun.monteCarlo.lossProbabilityPct > 25 ? 'text-amber-400' : 'text-emerald-400'}>
                  Zarar Olasılığı: %{latestRun.monteCarlo.lossProbabilityPct}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mandatory Test Checklist */}
      <div className="text-xs text-zinc-500 mt-2">
        <div className="font-medium text-zinc-300 mb-2">Zorunlu Test Kontrol Listesi</div>
        {data.mandatoryTestChecklist.map((x, i) => (
          <div key={i} className="mb-1">
            • {x}
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-950/60 rounded-lg p-2 border border-zinc-800/70">
      <div className="text-zinc-500 text-[11px] truncate">{label}</div>
      <div className="font-medium text-zinc-200 mt-0.5 break-words">{value}</div>
    </div>
  );
}
