import { useEffect, useState } from "react";
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { AppProvider } from "./context/AppContext";
import Header from "./components/Header";
import MarketTable from "./components/MarketTable";
import SignalFeed from "./components/SignalFeed";
import PortfolioOverview from "./components/PortfolioOverview";
import TradeHistoryCard from "./components/TradeHistoryCard";
import MarketRegimeCard from "./components/MarketRegimeCard";
import NewsIntelligenceCard from "./components/NewsIntelligenceCard";
import ResearchLabCard from "./components/ResearchLabCard";
import AutoScannerCard from "./components/AutoScannerCard";
import TradeModal from "./components/TradeModal";
import Login from "./components/Login";

export default function App() {
  const [session,setSession]=useState<Session|null|undefined>(undefined);
  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>setSession(data.session));
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>setSession(next));
    return()=>subscription.unsubscribe();
  },[]);
  if(session===undefined) return <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-400">Supabase oturumu kontrol ediliyor…</div>;
  if(!session) return <Login/>;
  return <AppProvider>
    <div className="min-h-screen bg-zinc-950 flex flex-col"><Header/><main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6"><div className="lg:col-span-2 flex flex-col gap-6"><PortfolioOverview/><TradeHistoryCard/><MarketRegimeCard/><NewsIntelligenceCard/><ResearchLabCard/><AutoScannerCard/><MarketTable/></div><div className="lg:col-span-1 h-[calc(100vh-8rem)] sticky top-24"><SignalFeed/></div></main></div><TradeModal/>
  </AppProvider>;
}
