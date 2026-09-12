import React, { createContext, useContext, useState, useEffect } from 'react';
import { AppState, CoinData, TradeSignal, MarketRegime, NewsIntelligence } from '../types';

interface AppContextType {
  state: AppState; marketData: CoinData[]; signals: TradeSignal[];
  toggleAutoPilot: () => void; setDailyTarget: (target: number) => void; setAutoPilotAmount: (amount: number) => void; setPositionSizePercent: (percent: number) => void; setAutoPilotBudget: (amount: number) => void; setRiskSettings: (values: Partial<AppState>) => void;
  toggleFavorite: (symbol: string) => void; approveSignal: (id: string, investmentAmount: number) => void; rejectSignal: (id: string) => void;
  executeManualTrade: (type: 'BUY' | 'SELL', symbol: string, amountUSD: number) => Promise<void>; closePosition: (symbol: string) => Promise<void>;
  openTradeModal: (symbol: string) => void; closeTradeModal: () => void; tradingModal: { isOpen: boolean; coin: CoinData | null };
  fetchMarketData: () => void; forceSignalCheck: (symbol: string) => void; isRefreshingMarket: boolean; isSyncing: boolean; marketRegime: MarketRegime | null; newsIntelligence: NewsIntelligence | null;
}

const defaultState: AppState = { balance: 100, portfolio: [], favorites: [], autoPilot: false, autoPilotAmount: 25, autoPilotBudget: 100, dailyTargetPercent: 3, positionSizePercent: 25, riskProfile:'BALANCED', riskPerTradePercent:0.5, maxDailyLossPercent:2, maxOpenRiskPercent:1.75, maxPositions:3, executionMode:'PAPER', automationMode:'MANUAL', safeMode:false, liveCapitalCapUsd:0, liveApiPermissionAttested:false, emergencyDrillAttested:false, testnetReviewAttested:false, newsRetestAttested:false };
const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(defaultState);
  const [marketData, setMarketData] = useState<CoinData[]>([]);
  const [signals, setSignals] = useState<TradeSignal[]>([]);
  const [marketRegime, setMarketRegime] = useState<MarketRegime | null>(null);
  const [newsIntelligence, setNewsIntelligence] = useState<NewsIntelligence | null>(null);
  const [isRefreshingMarket, setIsRefreshingMarket] = useState(false);
  const [isSyncing, setIsSyncing] = useState(true);
  const [tradingModal, setTradingModal] = useState<{isOpen: boolean, coin: CoinData | null}>({isOpen:false, coin:null});

  const fetchPortfolio = async () => {
    try {
      const res = await fetch('/api/portfolio'); if (res.status === 401) return;
      const data = await res.json();
      setState(s => ({...s, balance:data.balance||0, portfolio:data.portfolio||[], autoPilot:data.settings?.autoPilot===1, autoPilotAmount:data.settings?.autoPilotAmount||25, autoPilotBudget:data.settings?.autoPilotBudget||1000, dailyTargetPercent:data.settings?.dailyTargetPercent||3, positionSizePercent:Number(data.settings?.positionSizePercent??25), riskProfile:data.settings?.riskProfile||'BALANCED', riskPerTradePercent:data.settings?.riskPerTradePercent||0.5, maxDailyLossPercent:data.settings?.maxDailyLossPercent||2, maxOpenRiskPercent:data.settings?.maxOpenRiskPercent||1.75, maxPositions:data.settings?.maxPositions||3, executionMode:'PAPER', automationMode:data.settings?.automationMode||'MANUAL', safeMode:data.settings?.safeMode===1, liveCapitalCapUsd:Number(data.settings?.liveCapitalCapUsd||0), liveApiPermissionAttested:data.settings?.liveApiPermissionAttested===1, emergencyDrillAttested:data.settings?.emergencyDrillAttested===1, testnetReviewAttested:data.settings?.testnetReviewAttested===1, newsRetestAttested:data.settings?.newsRetestAttested===1}));
      setSignals(data.signals || []);
    } catch (e) { console.error('Failed to fetch portfolio', e); } finally { setIsSyncing(false); }
  };

  const updateSettings = async (newSettings: Partial<AppState>) => {
    const updated = {...state, ...newSettings}; setState(updated);
    try {
      const r=await fetch('/api/settings', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(updated)});
      if(!r.ok){const d=await r.json().catch(()=>({}));console.error(d.error||'Failed to update settings');await fetchPortfolio();}
    } catch { console.error('Failed to update settings'); await fetchPortfolio(); }
  };

  const fetchMarketData = async () => {
    setIsRefreshingMarket(true);
    try { const res = await fetch('/api/market?limit=50'); const data = await res.json(); if (Array.isArray(data)) setMarketData(data); }
    catch (e) { console.error('Market data error', e); }
    finally { setIsRefreshingMarket(false); }
  };

  const forceSignalCheck = async (symbol: string) => {
    const coin = marketData.find(c => c.symbol === symbol); if (!coin) return;
    setIsRefreshingMarket(true);
    try {
      const res = await fetch('/api/analyze', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({symbol})});
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Analiz başarısız');
      const isCandidate = result.action === 'BUY_CANDIDATE';
      const e=result.engines||{};
      await fetch('/api/signals', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({symbol, type:'BUY', price:coin.price, aiScore:result.opportunity, analysis:`Opportunity ${result.opportunity}/100 • Risk ${result.risk}/100 • Confidence ${result.confidence}/100
Birincil: ${result.primaryStrategy || '-'} • Teyit: ${result.consensusCount ?? 0}/3 • Rejim: ${result.regime?.label || '-'}
Scalp ${e.SCALP?.score ?? '-'} (${e.SCALP?.verdict ?? '-'}) • Day ${e.DAY?.score ?? '-'} (${e.DAY?.verdict ?? '-'}) • Swing ${e.SWING?.score ?? '-'} (${e.SWING?.verdict ?? '-'})
Haber: ${result.news?.level || '-'} • VETO: ${result.veto?.active ? 'AKTİF' : 'YOK'} • Karar: ${isCandidate ? 'BUY CANDIDATE' : 'NO TRADE'}
${result.analysis}`, status:isCandidate?'PENDING':'REJECTED', source:result.source})});
      await fetchPortfolio();
    } catch (e) { console.error('Signal check error', e); }
    finally { setIsRefreshingMarket(false); }
  };

  useEffect(() => { fetchPortfolio(); const i=setInterval(fetchPortfolio,5000); return()=>clearInterval(i); }, []);
  useEffect(() => { fetchMarketData(); const i=setInterval(fetchMarketData,10000); return()=>clearInterval(i); }, []);
  useEffect(() => { const fetchRegime=async()=>{ try{ const r=await fetch('/api/regime'); if(r.ok) setMarketRegime(await r.json()); }catch{} }; fetchRegime(); const i=setInterval(fetchRegime,30000); return()=>clearInterval(i); }, []);
  useEffect(() => { const fetchNews=async()=>{ try{ const r=await fetch('/api/news'); if(r.ok) setNewsIntelligence(await r.json()); }catch{} }; fetchNews(); const i=setInterval(fetchNews,60000); return()=>clearInterval(i); }, []);

  const toggleFavorite = (symbol:string) => setState(s=>({...s,favorites:s.favorites.includes(symbol)?s.favorites.filter(f=>f!==symbol):[...s.favorites,symbol]}));
  const approveSignal = async (id:string, investmentAmount:number) => {
    const signal=signals.find(s=>s.id===id); if(!signal || signal.type!=='BUY') return;
    const res=await fetch('/api/trades/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'BUY',symbol:signal.symbol,marginUSD:investmentAmount,origin:'SIGNAL_APPROVAL'})});
    if(!res.ok){const d=await res.json(); alert(d.error||'İşlem başarısız'); return;} await fetchPortfolio();
  };
  const rejectSignal = (id:string) => setSignals(prev=>prev.map(s=>s.id===id?{...s,status:'REJECTED'}:s));
  const openTradeModal = (symbol:string) => { const coin=marketData.find(c=>c.symbol===symbol); if(coin)setTradingModal({isOpen:true,coin}); };
  const closeTradeModal = () => setTradingModal({isOpen:false,coin:null});
  const executeManualTrade = async (type:'BUY'|'SELL',symbol:string,amountUSD:number) => {
    const res=await fetch('/api/trades/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,symbol,marginUSD:amountUSD,origin:'MANUAL'})});
    if(!res.ok){const d=await res.json(); alert(d.error||'İşlem başarısız'); return;} await fetchPortfolio(); closeTradeModal();
  };
  const closePosition = async (symbol:string) => executeManualTrade('SELL',symbol,0);

  return <AppContext.Provider value={{state,marketData,signals,toggleAutoPilot:()=>updateSettings({autoPilot:!state.autoPilot}),setDailyTarget:(v)=>updateSettings({dailyTargetPercent:v}),setAutoPilotAmount:(v)=>updateSettings({autoPilotAmount:v}),setPositionSizePercent:(v)=>updateSettings({positionSizePercent:v}),setAutoPilotBudget:(v)=>updateSettings({autoPilotBudget:v}),setRiskSettings:(v)=>updateSettings(v),toggleFavorite,approveSignal,rejectSignal,executeManualTrade,closePosition,openTradeModal,closeTradeModal,tradingModal,fetchMarketData,forceSignalCheck,isRefreshingMarket,isSyncing,marketRegime,newsIntelligence}}>{children}</AppContext.Provider>;
}

export const useApp=()=>{const c=useContext(AppContext); if(!c)throw new Error('useApp must be used within AppProvider'); return c;};
