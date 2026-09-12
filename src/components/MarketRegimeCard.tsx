import { Activity, ShieldAlert, TrendingUp, TrendingDown, Gauge } from 'lucide-react';
import { useApp } from '../context/AppContext';

const labels: Record<string,string> = {
  STRONG_BULL:'Güçlü Yükseliş', BULL:'Yükseliş', SIDEWAYS:'Yatay', HIGH_VOLATILITY:'Yüksek Volatilite', BEAR:'Düşüş', PANIC:'Panik'
};

export default function MarketRegimeCard(){
  const { marketRegime } = useApp();
  if(!marketRegime) return null;
  const bad=['BEAR','PANIC','HIGH_VOLATILITY'].includes(marketRegime.label);
  return <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
    <div className="flex items-center justify-between gap-4 mb-4">
      <div>
        <div className="flex items-center gap-2 text-zinc-100 font-medium"><Activity size={18} className="text-blue-400"/> Market Regime Engine</div>
        <p className="text-xs text-zinc-500 mt-1">BTC/ETH trendi + ilk 50 coin piyasa genişliği + volatilite</p>
      </div>
      <span className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${bad?'bg-rose-500/10 text-rose-300 border-rose-500/20':'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'}`}>{labels[marketRegime.label]||marketRegime.label}</span>
    </div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
      <div className="bg-zinc-950/60 rounded-lg p-3 border border-zinc-800"><span className="text-zinc-500 text-xs flex items-center gap-1"><Gauge size={13}/> Rejim riski</span><div className="text-zinc-100 font-semibold mt-1">{marketRegime.risk}/100</div></div>
      <div className="bg-zinc-950/60 rounded-lg p-3 border border-zinc-800"><span className="text-zinc-500 text-xs flex items-center gap-1"><TrendingUp size={13}/> Pozitif genişlik</span><div className="text-zinc-100 font-semibold mt-1">%{marketRegime.breadth}</div></div>
      <div className="bg-zinc-950/60 rounded-lg p-3 border border-zinc-800"><span className="text-zinc-500 text-xs flex items-center gap-1"><TrendingDown size={13}/> Ort. 24s</span><div className="text-zinc-100 font-semibold mt-1">{marketRegime.avgChange24h>0?'+':''}{marketRegime.avgChange24h}%</div></div>
      <div className="bg-zinc-950/60 rounded-lg p-3 border border-zinc-800"><span className="text-zinc-500 text-xs flex items-center gap-1"><ShieldAlert size={13}/> Volatilite</span><div className="text-zinc-100 font-semibold mt-1">{marketRegime.volatility}</div></div>
    </div>
  </div>
}
