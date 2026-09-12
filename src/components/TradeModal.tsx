import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { formatCurrency, cn } from '../lib/utils';
import { X, TrendingUp, TrendingDown, Activity, ShieldCheck, ShieldAlert } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';

export default function TradeModal() {
  const { tradingModal, closeTradeModal, executeManualTrade, state } = useApp();
  const [tradeType, setTradeType] = useState<'BUY'|'SELL'>('BUY');
  const [amountUSD,setAmountUSD]=useState('100');
  const [chartData,setChartData]=useState<any[]>([]);
  const [riskPlan,setRiskPlan]=useState<any>(null);
  const [riskLoading,setRiskLoading]=useState(false);
  const coin=tradingModal.coin;
  useEffect(()=>{ if(!coin)return; fetch(`/api/market/${coin.symbol}/klines?interval=1h&limit=48`).then(r=>r.json()).then(d=>Array.isArray(d)&&setChartData(d.map((x:any)=>({time:new Date(x.time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),price:x.close})))).catch(()=>{}); },[coin?.symbol]);
  useEffect(()=>{
    if(!coin||tradeType!=='BUY') return;
    setRiskLoading(true);
    fetch(`/api/risk/plan/${coin.symbol}`).then(async r=>{
      const d=await r.json();
      if(!r.ok) throw new Error(d.error);
      setRiskPlan(d);
      if(d.execution?.suggestedSpend) {
        const equity = Number(d.daily?.equityApprox || state.balance || 100);
        const positionCap = equity * ((state.positionSizePercent || 25) / 100);
        const maxSpend = Math.round(Math.min(d.execution.suggestedSpend, positionCap, state.balance || 100));
        setAmountUSD(String(Math.max(5, maxSpend)));
      }
    }).catch(()=>setRiskPlan(null)).finally(()=>setRiskLoading(false));
  },[coin?.symbol,tradeType,state.positionSizePercent,state.balance]);
  if(!tradingModal.isOpen||!coin)return null;
  const isPositive=coin.change24h>=0; const amount=Number(amountUSD)||0;
  const handleTrade=()=>{ if(tradeType==='BUY'&&amount<=0)return; executeManualTrade(tradeType,coin.symbol,amount); };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"><div className="bg-zinc-950 border border-zinc-800 w-full max-w-5xl rounded-2xl overflow-hidden flex flex-col md:flex-row max-h-[95vh]">
    <div className="flex-1 border-b md:border-b-0 md:border-r border-zinc-800 overflow-y-auto"><div className="p-6 border-b border-zinc-800 flex justify-between"><div><h2 className="text-xl font-bold text-zinc-100">{coin.symbol}/USDT</h2><span className="text-sm text-zinc-500">Binance Spot • gerçek piyasa verisi</span></div><div className="text-right"><div className="text-2xl font-bold">{formatCurrency(coin.price)}</div><div className={cn('text-sm',isPositive?'text-emerald-400':'text-rose-400')}>{isPositive?<TrendingUp size={16} className="inline"/>:<TrendingDown size={16} className="inline"/>} {coin.change24h.toFixed(2)}%</div></div></div>
    <div className="p-6 min-h-[300px]"><h3 className="text-sm text-zinc-400 flex gap-2 mb-4"><Activity size={16}/>48 Saatlik Gerçek Mum Kapanışları</h3><div className="h-56"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData}><XAxis dataKey="time" hide/><YAxis domain={['auto','auto']} hide/><Tooltip formatter={(v:number)=>[formatCurrency(v),'Fiyat']}/><Area type="monotone" dataKey="price" stroke="#10b981" fillOpacity={0.12} fill="#10b981"/></AreaChart></ResponsiveContainer></div></div>
    {tradeType==='BUY'&&<div className="px-6 pb-6">{riskLoading?<div className="text-sm text-zinc-500">Risk planı hesaplanıyor…</div>:riskPlan?<div className={`border rounded-xl p-4 ${riskPlan.allowed?'border-emerald-500/30 bg-emerald-500/5':'border-rose-500/30 bg-rose-500/5'}`}><div className="flex items-center gap-2 font-medium mb-3">{riskPlan.allowed?<ShieldCheck className="text-emerald-400" size={18}/>:<ShieldAlert className="text-rose-400" size={18}/>} Risk Manager: {riskPlan.allowed?'İşlem Uygun':'İşlem Engelli'}</div><div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs"><Metric label="Önerilen Tutar" value={`${riskPlan.execution.suggestedSpend} USDT`}/><Metric label="Stop" value={`${riskPlan.execution.stopDistancePct}%`}/><Metric label="TP1 R/R" value={`1:${riskPlan.execution.riskRewardTp1}`}/><Metric label="TP2 R/R" value={`1:${riskPlan.execution.riskRewardTp2}`}/><Metric label="Tahmini Maliyet" value={`${riskPlan.execution.roundTripCostPct}%`}/><Metric label="Net TP1" value={`${riskPlan.execution.estimatedNetTp1Pct}%`}/><Metric label="Günlük Durum" value={riskPlan.daily.profitProtectionLevel}/><Metric label="Profil" value={riskPlan.profile}/><Metric label="Birincil Strateji" value={riskPlan.analysis?.primaryStrategy || '-'}/><Metric label="Strateji Teyidi" value={`${riskPlan.analysis?.consensusCount ?? 0}/3`}/><Metric label="Haber Seviyesi" value={riskPlan.analysis?.news?.level || '-'}/><Metric label="Haber Risk Etkisi" value={`+${riskPlan.analysis?.news?.score?.riskAdjustment ?? 0}`}/></div>{!riskPlan.allowed&&<div className="mt-3 text-xs text-rose-300 space-y-1">{riskPlan.blocks.map((x:string,i:number)=><div key={i}>• {x}</div>)}</div>}</div>:null}</div>}
    </div>
    <div className="w-full md:w-96 bg-zinc-900/50 overflow-y-auto"><div className="p-4 border-b border-zinc-800 flex justify-between"><h3 className="font-medium">V6 Haber Filtresi + Çoklu Strateji</h3><button onClick={closeTradeModal}><X size={18}/></button></div><div className="p-6 space-y-5">
      <div className="flex rounded-lg bg-zinc-950 p-1 border border-zinc-800"><button onClick={()=>setTradeType('BUY')} className={cn('flex-1 py-2 rounded-md',tradeType==='BUY'?'bg-emerald-500/20 text-emerald-400':'text-zinc-500')}>AL</button><button onClick={()=>setTradeType('SELL')} className={cn('flex-1 py-2 rounded-md',tradeType==='SELL'?'bg-rose-500/20 text-rose-400':'text-zinc-500')}>POZİSYONU SAT</button></div>
      {tradeType==='BUY'&&<div><label className="text-xs text-zinc-400">Tutar (USDT) • Bakiye {formatCurrency(state.balance)}</label><input type="number" value={amountUSD} onChange={e=>setAmountUSD(e.target.value)} className="mt-2 w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3"/><p className="text-xs text-zinc-500 mt-2">Girilen tutar Risk Manager önerisinin üzerindeyse sunucu otomatik olarak önerilen maksimuma düşürür.</p></div>}
      <div className="text-xs text-zinc-500 bg-zinc-950 border border-zinc-800 p-3 rounded-lg">Stop, TP1/TP2 ve trailing V6 paper motoru tarafından otomatik yönetilir. Scalp / Gün İçi / Swing Strategy Manager risk planına dahildir. Gerçek para emri hâlâ kapalıdır.</div>
    </div><div className="p-6 border-t border-zinc-800"><button disabled={tradeType==='BUY' && !!riskPlan && !riskPlan.allowed} onClick={handleTrade} className={cn('w-full py-4 rounded-xl font-bold disabled:opacity-40',tradeType==='BUY'?'bg-emerald-500':'bg-rose-500')}>{tradeType==='BUY'?'Risk Yönetimli Spot Alış':'Açık Pozisyonu Sat'}</button></div></div>
  </div></div>;
}

function Metric({label,value}:{label:string;value:string}){return <div className="bg-zinc-950/60 rounded-lg p-2"><div className="text-zinc-500">{label}</div><div className="font-medium text-zinc-200 mt-1">{value}</div></div>}
