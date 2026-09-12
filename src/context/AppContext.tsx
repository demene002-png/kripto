import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { AppState, CoinData, TradeSignal, MarketRegime, NewsIntelligence } from '../types';
import { fetchTopUsdtMarkets, fetchSpotTicker } from '../lib/binancePublic';
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

  const settingsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSettingsRef = useRef<Partial<AppState>>({});
  const settingsDirtyUntilRef = useRef(0);
  const settingsMutationVersionRef = useRef(0);

  const fetchPortfolio=useCallback(async()=>{
    try{
      const d=await loadPaperState();
      const preserveLocalSettings=Date.now()<settingsDirtyUntilRef.current;
      setState(s=>({
        ...s,
        balance:Number(d.account.balance||0),
        portfolio:d.portfolio,
        ...(preserveLocalSettings?{}:mapSettingsToState(d.settings))
      }));
      setSignals(d.signals);
    }catch(e){console.error('Supabase portföy eşitleme hatası',e)}finally{setIsSyncing(false)}
  },[]);

  const flushPendingSettings=useCallback(async()=>{
    const payload=pendingSettingsRef.current;
    pendingSettingsRef.current={};
    if(Object.keys(payload).length===0)return;
    const version=settingsMutationVersionRef.current;
    try{
      await saveSettings(payload);
      if(version===settingsMutationVersionRef.current){
        settingsDirtyUntilRef.current=Date.now()+1000;
      }
    }catch(e){
      console.error('Supabase ayar kaydetme hatası',e);
      if(version===settingsMutationVersionRef.current){
        settingsDirtyUntilRef.current=0;
        await fetchPortfolio();
      }
    }
  },[fetchPortfolio]);

  const updateSettings=(values:Partial<AppState>)=>{
    // Optimistic functional update prevents stale closures from restoring older slider values.
    setState(prev=>({...prev,...values}));
    pendingSettingsRef.current={...pendingSettingsRef.current,...values};
    settingsMutationVersionRef.current+=1;
    // Keep background polling from restoring older DB values while a write is pending/in flight.
    settingsDirtyUntilRef.current=Date.now()+5000;
    if(settingsSaveTimerRef.current)clearTimeout(settingsSaveTimerRef.current);
    settingsSaveTimerRef.current=setTimeout(()=>{void flushPendingSettings()},350);
  };
  const fetchMarketData=async()=>{
    setIsRefreshingMarket(true);
    try{
      const top=await fetchTopUsdtMarkets(50);
      // Açık pozisyonlar (ör. filtreye sonradan alınmış bir stablecoin) tarama evreninden
      // çıkarılmış olsa bile fiyatları ve manuel satış yolu canlı kalmalıdır.
      const topPairs=new Set(top.map(x=>x.pair||`${x.symbol}USDT`));
      const missingPairs=state.portfolio
        .map(p=>p.symbol.endsWith('USDT')?p.symbol:`${p.symbol}USDT`)
        .filter(pair=>!topPairs.has(pair));
      const extras=(await Promise.all(missingPairs.map(async pair=>{
        try{return await fetchSpotTicker(pair)}catch(e){console.warn(`${pair} açık pozisyon fiyatı alınamadı`,e);return null}
      }))).filter(Boolean) as CoinData[];
      setMarketData([...top,...extras]);
    }catch(e){console.error('Binance genel piyasa verisi hatası',e)}finally{setIsRefreshingMarket(false)}
  };

  const forceSignalCheck=async(symbol:string)=>{
    const coin=marketData.find(c=>c.symbol===symbol);if(!coin)return;
    // Bulut geçişinin bu aşamasında gerçek strateji motoru taklit edilmez.
    // Yalnız manuel inceleme kaydı oluşturulur; otomatik analiz bulut arka plan fonksiyonuna taşınacaktır.
    const analysis=`Bulut geçişi: ${symbol}/USDT canlı Binance fiyatı ${coin.price}. Strateji, piyasa rejimi ve haber motoru bulut arka plan fonksiyonuna taşınana kadar otomatik AL kararı üretilmez.`;
    try{await insertSignal({symbol,price:coin.price,opportunity:0,analysis,status:'REJECTED',source:'cloud-phase1-manual-review'});await fetchPortfolio()}catch(e){console.error(e)};
  };

  useEffect(()=>{
    fetchPortfolio();
    const i=setInterval(fetchPortfolio,10000);
    return()=>{
      clearInterval(i);
      if(settingsSaveTimerRef.current){
        clearTimeout(settingsSaveTimerRef.current);
        settingsSaveTimerRef.current=null;
      }
      if(Object.keys(pendingSettingsRef.current).length){void flushPendingSettings()}
    };
  },[fetchPortfolio,flushPendingSettings]);
  useEffect(()=>{fetchMarketData();const i=setInterval(fetchMarketData,15000);return()=>clearInterval(i)},[]);

  const executeManualTrade=async(type:'BUY'|'SELL',symbol:string,amountUSD:number)=>{
    const pair=symbol.endsWith('USDT')?symbol:`${symbol}USDT`;
    const base=pair.slice(0,-4);
    let coin=marketData.find(c=>c.pair===pair || c.symbol===base || c.symbol===symbol);
    try{
      // Manual SELL must work even if the asset is excluded from the scanner (stablecoin etc.).
      // Fetch a fresh public quote directly when it is missing from the scanner universe.
      if(!coin) coin=await fetchSpotTicker(pair);
      if(type==='BUY'){
        if(state.safeMode) throw new Error('Güvenli mod aktif. Yeni sanal alışlar kilitli.');
        if(state.portfolio.length>=state.maxPositions && !state.portfolio.some(p=>p.symbol===symbol)) throw new Error('Maksimum açık pozisyon sayısına ulaşıldı.');
        const cap=state.balance*((state.positionSizePercent||25)/100);
        const spend=Math.min(Math.max(0,amountUSD),cap,state.balance);
        if(spend<1)throw new Error('Sanal alış tutarı çok düşük.');
        await paperBuy(symbol,coin.askPrice||coin.price,spend);
      }else await paperSellAll(symbol,coin.bidPrice||coin.price);
      await fetchPortfolio(); closeTradeModal();
    }catch(e:any){alert(turkishError(e?.message)||'Sanal işlem başarısız.');}
  };
  const approveSignal=async(id:string,investmentAmount:number)=>{const s=signals.find(x=>x.id===id);if(s?.type==='BUY')await executeManualTrade('BUY',s.symbol,investmentAmount)};
  const rejectSignal=async(id:string)=>{setSignals(prev=>prev.map(s=>s.id===id?{...s,status:'REJECTED'}:s))};
  const openTradeModal=(symbol:string)=>{const pair=symbol.endsWith('USDT')?symbol:`${symbol}USDT`;const base=pair.slice(0,-4);const coin=marketData.find(c=>c.pair===pair||c.symbol===base||c.symbol===symbol);if(coin)setTradingModal({isOpen:true,coin})};
  const closeTradeModal=()=>setTradingModal({isOpen:false,coin:null});
  const closePosition=async(symbol:string)=>executeManualTrade('SELL',symbol,0);
  const toggleFavorite=(symbol:string)=>setState(s=>({...s,favorites:s.favorites.includes(symbol)?s.favorites.filter(f=>f!==symbol):[...s.favorites,symbol]}));

  return <AppContext.Provider value={{state,marketData,signals,toggleAutoPilot:()=>updateSettings({autoPilot:!state.autoPilot,automationMode:!state.autoPilot?'FULL_AUTO':'MANUAL'}),setDailyTarget:v=>updateSettings({dailyTargetPercent:v}),setAutoPilotAmount:v=>updateSettings({autoPilotAmount:v}),setPositionSizePercent:v=>updateSettings({positionSizePercent:v}),setAutoPilotBudget:v=>updateSettings({autoPilotBudget:v}),setRiskSettings:updateSettings,toggleFavorite,approveSignal,rejectSignal,executeManualTrade,closePosition,openTradeModal,closeTradeModal,tradingModal,fetchMarketData,forceSignalCheck,isRefreshingMarket,isSyncing,marketRegime,newsIntelligence}}>{children}</AppContext.Provider>;
}

function turkishError(message?:string){
  const m=String(message||'');
  const pairs:[RegExp,string][]=[
    [/Authentication required/i,'Oturum açmanız gerekiyor.'],
    [/Invalid price\/spend/i,'Fiyat veya işlem tutarı geçersiz.'],
    [/Paper account\/settings missing/i,'Sanal hesap veya ayarlar bulunamadı.'],
    [/SAFE MODE active/i,'Güvenli mod aktif. Yeni sanal alışlar kilitli.'],
    [/PAPER100 RPC only supports PAPER/i,'Bu işlem yalnız sanal test ortamında kullanılabilir.'],
    [/Maximum position count reached/i,'Maksimum açık pozisyon sayısına ulaşıldı.'],
    [/Position size cap exceeded/i,'Pozisyon sermaye üst sınırı aşıldı.'],
    [/Insufficient paper balance/i,'Sanal USDT bakiyesi yetersiz.'],
    [/Invalid price/i,'Fiyat geçersiz.'],
    [/Open paper position not found/i,'Açık sanal pozisyon bulunamadı.']
  ];
  for(const [re,tr] of pairs) if(re.test(m)) return tr;
  return m;
}
export const useApp=()=>{const c=useContext(AppContext);if(!c)throw new Error('Uygulama bağlamı sağlayıcısı bulunamadı');return c};
