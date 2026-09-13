import { useEffect, useState } from 'react';
import { Activity, ShieldAlert, TrendingUp, TrendingDown, Gauge, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';

const labels:Record<string,string>={
  GUCLU_BOGA:'Güçlü Boğa',ZAYIF_BOGA:'Zayıf Boğa',YATAY:'Yatay',YUKSEK_VOLATILITE:'Yüksek Oynaklık',AYI:'Ayı',PANIK:'Panik',TOPARLANMA:'Toparlanma',DAGITIM:'Dağıtım',
  STRONG_BULL:'Güçlü Boğa',BULL:'Boğa',SIDEWAYS:'Yatay',HIGH_VOLATILITY:'Yüksek Oynaklık',BEAR:'Ayı',PANIC:'Panik'
};
export default function MarketRegimeCard(){
  const [r,setR]=useState<any>(null);const [loading,setLoading]=useState(false);
  const load=async()=>{setLoading(true);try{const {data:{user}}=await supabase.auth.getUser();if(!user)return;const {data}=await supabase.from('autopilot_scan_runs').select('market_regime,market_risk,market_breadth,market_avg_change,market_volatility,completed_at').eq('user_id',user.id).order('started_at',{ascending:false}).limit(1);setR(data?.[0]||null)}finally{setLoading(false)}};
  useEffect(()=>{void load();const i=setInterval(()=>void load(),15000);return()=>clearInterval(i)},[]);
  if(!r)return null;
  const bad=['AYI','PANIK','YUKSEK_VOLATILITE','DAGITIM','BEAR','PANIC','HIGH_VOLATILITY'].includes(r.market_regime);
  return <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
    <div className="flex items-center justify-between gap-4 mb-4"><div><div className="flex items-center gap-2 text-zinc-100 font-medium"><Activity size={18} className="text-blue-400"/>Piyasa Rejim Motoru 2.0</div><p className="text-xs text-zinc-500 mt-1">BTC yönü + ilk 50 coin piyasa genişliği + oynaklık. Ayı, panik, dağıtım ve aşırı oynaklıkta yeni otomatik spot alış kapatılır.</p></div><div className="flex items-center gap-2"><span className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${bad?'bg-rose-500/10 text-rose-300 border-rose-500/20':'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'}`}>{labels[r.market_regime]||r.market_regime}</span><button onClick={load} className="p-2 rounded-lg bg-zinc-800"><RefreshCw size={14} className={loading?'animate-spin':''}/></button></div></div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm"><Box icon={<Gauge size={13}/>} l="Rejim riski" v={`${Number(r.market_risk||0).toFixed(0)}/100`}/><Box icon={<TrendingUp size={13}/>} l="Pozitif genişlik" v={`%${Number(r.market_breadth||0).toFixed(1)}`}/><Box icon={<TrendingDown size={13}/>} l="Ort. 24 saat" v={`${Number(r.market_avg_change||0)>=0?'+':''}${Number(r.market_avg_change||0).toFixed(2)}%`}/><Box icon={<ShieldAlert size={13}/>} l="Oynaklık" v={Number(r.market_volatility||0).toFixed(2)}/></div>
  </div>
}
function Box({icon,l,v}:{icon:any;l:string;v:string}){return <div className="bg-zinc-950/60 rounded-lg p-3 border border-zinc-800"><span className="text-zinc-500 text-xs flex items-center gap-1">{icon}{l}</span><div className="text-zinc-100 font-semibold mt-1">{v}</div></div>}
