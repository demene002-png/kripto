import React, { createContext, useContext, useState, useEffect } from 'react';
import { AppState, CoinData, TradeSignal, MarketRegime, NewsIntelligence } from '../types';
import { fetchTopUsdtMarkets } from '../lib/binancePublic';
import { loadPaperState, mapSettingsToState, saveSettings, insertSignal, paperBuy, paperSellAll } from '../lib/cloudData';

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
  const [marketRegime] = useState<MarketRegime | null>(null);
  const [newsIntelligence] = useState<NewsIntelligence | null>(null);
  const [isRefreshingMarket, setIsRefreshingMarket] = useState(false);
  const [isSyncing, setIsSyncing] = useState(true);
  const [tradingModal, setTradingModal] = useState<{isOpen: boolean, coin: CoinData | null}>({isOpen:false,coin:null});

  const fetchPortfolio=async()=>{try{const d=await loadPaperState();setState(s=>({...s,balance:Number(d.account.balance||0),portfolio:d.portfolio,...mapSettingsToState(d.settings)}));setSignals(d.signals);}catch(e){console.error('Supabase portfolio sync failed',e)}finally{setIsSyncing(false)}};
  const updateSettings=async(values:Partial<AppState>)=>{const before=state;const updated={...state,...values};setState(updated);try{await saveSettings(values);await fetchPortfolio()}catch(e){console.error('Supabase settings update failed',e);setState(before)}};
  const fetchMarketData=async()=>{setIsRefreshingMarket(true);try{setMarketData(await fetchTopUsdtMarkets(50))}catch(e){console.error('Binance public market data error',e)}finally{setIsRefreshingMarket(false)}};

  const forceSignalCheck=async(symbol:string)=>{
    const coin=marketData.find(c=>c.symbol===symbol);if(!coin)return;
    // Cloud phase 1 deliberately does not fake the production Strategy Manager.
    // Record a manual-review signal only; scanner/analysis moves to Supabase Edge Functions next.
    const analysis=`Cloud geçişi: ${symbol}/USDT canlı Binance fiyatı ${coin.price}. Strategy/Regime/News motoru Supabase Edge Function'a taşınana kadar otomatik BUY kararı üretilmez.`;
    try{await insertSignal({symbol,price:coin.price,opportunity:0,analysis,status:'REJECTED',source:'cloud-phase1-manual-review'});await fetchPortfolio()}catch(e){console.error(e)};
  };

  useEffect(()=>{fetchPortfolio();const i=setInterval(fetchPortfolio,10000);return()=>clearInterval(i)},[]);
  useEffect(()=>{fetchMarketData();const i=setInterval(fetchMarketData,15000);return()=>clearInterval(i)},[]);

  const executeManualTrade=async(type:'BUY'|'SELL',symbol:string,amountUSD:number)=>{
    const coin=marketData.find(c=>c.symbol===symbol);if(!coin)throw new Error('Güncel Binance fiyatı yok');
    try{
      if(type==='BUY'){
        const cap=state.balance*((state.positionSizePercent||25)/100);
        const spend=Math.min(Math.max(0,amountUSD),cap,state.balance);
        if(spend<1)throw new Error('Paper alış tutarı çok düşük.');
        await paperBuy(symbol,coin.askPrice||coin.price,spend);
      }else await paperSellAll(symbol,coin.bidPrice||coin.price);
      await fetchPortfolio(); closeTradeModal();
    }catch(e:any){alert(e?.message||'Paper işlem başarısız');}
  };
  const approveSignal=async(id:string,investmentAmount:number)=>{const s=signals.find(x=>x.id===id);if(s?.type==='BUY')await executeManualTrade('BUY',s.symbol,investmentAmount)};
  const rejectSignal=async(id:string)=>{setSignals(prev=>prev.map(s=>s.id===id?{...s,status:'REJECTED'}:s))};
  const openTradeModal=(symbol:string)=>{const coin=marketData.find(c=>c.symbol===symbol);if(coin)setTradingModal({isOpen:true,coin})};
  const closeTradeModal=()=>setTradingModal({isOpen:false,coin:null});
  const closePosition=async(symbol:string)=>executeManualTrade('SELL',symbol,0);
  const toggleFavorite=(symbol:string)=>setState(s=>({...s,favorites:s.favorites.includes(symbol)?s.favorites.filter(f=>f!==symbol):[...s.favorites,symbol]}));

  return <AppContext.Provider value={{state,marketData,signals,toggleAutoPilot:()=>updateSettings({autoPilot:!state.autoPilot,automationMode:!state.autoPilot?'FULL_AUTO':'MANUAL'}),setDailyTarget:v=>updateSettings({dailyTargetPercent:v}),setAutoPilotAmount:v=>updateSettings({autoPilotAmount:v}),setPositionSizePercent:v=>updateSettings({positionSizePercent:v}),setAutoPilotBudget:v=>updateSettings({autoPilotBudget:v}),setRiskSettings:updateSettings,toggleFavorite,approveSignal,rejectSignal,executeManualTrade,closePosition,openTradeModal,closeTradeModal,tradingModal,fetchMarketData,forceSignalCheck,isRefreshingMarket,isSyncing,marketRegime,newsIntelligence}}>{children}</AppContext.Provider>;
}
export const useApp=()=>{const c=useContext(AppContext);if(!c)throw new Error('useApp must be used within AppProvider');return c};
