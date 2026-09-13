import { useState } from 'react';
import { FlaskConical, Play, ShieldCheck } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { supabase } from '../lib/supabase';

type Result=any;
const fmt=(n:number,d=2)=>Number(n||0).toLocaleString('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d});

export default function ProfessionalLabCard(){
  const [symbol,setSymbol]=useState('BTCUSDT');
  const [interval,setInterval]=useState('1h');
  const [days,setDays]=useState(30);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [r,setR]=useState<Result|null>(null);
  async function run(){
    setLoading(true);setError('');
    try{
      const res=await fetch('/api/pro-lab',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol,interval,days})});
      const j=await res.json();if(!res.ok)throw new Error(j.error||'Profesyonel test çalıştırılamadı.');setR(j);
      try{const {data:{user}}=await supabase.auth.getUser();if(user)await supabase.from('professional_backtest_runs').insert({user_id:user.id,symbol:j.symbol,interval:j.interval,days:j.days,candle_count:j.candleCount,net_return_pct:j.backtest.netReturnPct,benchmark_pct:j.backtest.benchmarkPct,win_rate:j.backtest.winRate,profit_factor:j.backtest.profitFactor,max_drawdown_pct:j.backtest.maxDrawdownPct,sharpe:j.backtest.sharpe,trades:j.backtest.trades,validation_return_pct:j.walkForward.dogrulama.netReturnPct,validation_profit_factor:j.walkForward.dogrulama.profitFactor,best_parameters:j.optimizasyon?.[0]?.parametreler||j.parametreler});}catch(e){console.warn('Profesyonel test sonucu Supabase geçmişine yazılamadı',e)}
    }catch(e:any){setError(e?.message||'Test hatası');}finally{setLoading(false)}
  }
  const b=r?.backtest,w=r?.walkForward?.dogrulama;
  return <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
    <div className="flex items-center gap-2 text-lg font-medium"><FlaskConical size={18} className="text-violet-400"/>Profesyonel Strateji Laboratuvarı</div>
    <div className="text-xs text-zinc-500 mt-1 mb-4">Ücretsiz Binance geçmiş verisiyle backtest, ileri yürüyen doğrulama, parametre optimizasyonu, komisyon/kayma simülasyonu ve strateji katkı analizi.</div>
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
      <input value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())} className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm" placeholder="BTCUSDT"/>
      <select value={interval} onChange={e=>setInterval(e.target.value)} className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"><option value="5m">5 dakika</option><option value="15m">15 dakika</option><option value="1h">1 saat</option><option value="4h">4 saat</option></select>
      <select value={days} onChange={e=>setDays(Number(e.target.value))} className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"><option value={7}>7 gün</option><option value={30}>30 gün</option><option value={90}>90 gün</option><option value={180}>180 gün</option></select>
      <button onClick={run} disabled={loading} className="rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 px-3 py-2 text-sm font-medium flex items-center justify-center gap-2"><Play size={15}/>{loading?'Test çalışıyor…':'Testi Çalıştır'}</button>
    </div>
    {error&&<div className="text-sm text-rose-400 mb-4">{error}</div>}
    {r&&<>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
        <M l="Net getiri" v={`${b.netReturnPct>=0?'+':''}%${fmt(b.netReturnPct)}`} tone={b.netReturnPct>=0?'g':'r'}/><M l="Kazanma oranı" v={`%${fmt(b.winRate)}`}/><M l="Kâr faktörü" v={fmt(b.profitFactor)}/><M l="Maks. düşüş" v={`%${fmt(b.maxDrawdownPct)}`} tone="r"/><M l="Sharpe" v={fmt(b.sharpe)}/><M l="İşlem" v={String(b.trades)}/>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="border border-zinc-800 rounded-lg p-3"><div className="text-sm font-medium mb-2">Sermaye Eğrisi</div><div className="h-48"><ResponsiveContainer width="100%" height="100%"><LineChart data={b.equity}><XAxis dataKey="t" hide/><YAxis domain={['auto','auto']} width={38}/><Tooltip labelFormatter={(x)=>new Date(Number(x)).toLocaleString('tr-TR')} formatter={(v:any)=>[`$${fmt(Number(v),2)}`,'Sermaye']}/><Line type="monotone" dataKey="v" dot={false} stroke="currentColor"/></LineChart></ResponsiveContainer></div></div>
        <div className="border border-zinc-800 rounded-lg p-3"><div className="flex items-center gap-2 text-sm font-medium mb-3"><ShieldCheck size={15} className="text-emerald-400"/>İleri Yürüyen Doğrulama</div><div className="grid grid-cols-2 gap-3 text-xs"><K l="Eğitim getirisi" v={`%${fmt(r.walkForward.egitim.netReturnPct)}`}/><K l="Görülmemiş veri" v={`%${fmt(w.netReturnPct)}`}/><K l="Görülmemiş PF" v={fmt(w.profitFactor)}/><K l="Görülmemiş düşüş" v={`%${fmt(w.maxDrawdownPct)}`}/><K l="BTC al-tut" v={`%${fmt(b.benchmarkPct)}`}/><K l="Toplam komisyon" v={`$${fmt(b.fees,3)}`}/></div></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-zinc-800 rounded-lg p-3"><div className="text-sm font-medium mb-2">En İyi Parametre Adayları</div><div className="space-y-2">{r.optimizasyon.slice(0,3).map((x:any,i:number)=><div key={i} className="text-xs bg-zinc-950 rounded p-2"><b>#{i+1}</b> · Skor ≥ {x.parametreler.minScore} · Oy ≥ {x.parametreler.minVotes} · ATR stop ×{x.parametreler.atrStopMult} · R/R {x.parametreler.rr} <span className="text-zinc-500">→ net %{fmt(x.sonuc.netReturnPct)}, DD %{fmt(x.sonuc.maxDrawdownPct)}</span></div>)}</div></div>
        <div className="border border-zinc-800 rounded-lg p-3"><div className="text-sm font-medium mb-2">Strateji Katkısı</div><div className="space-y-2">{b.strategyAttribution.map((x:any)=><div key={x.name} className="flex justify-between text-xs"><span>{turkce(x.name)} · {x.count} işlem</span><span className={x.pnl>=0?'text-emerald-400':'text-rose-400'}>{x.pnl>=0?'+':''}${fmt(x.pnl,3)}</span></div>)}{!b.strategyAttribution.length&&<div className="text-xs text-zinc-500">Yeterli işlem oluşmadı.</div>}</div></div>
      </div>
      <div className="text-[11px] text-zinc-500 mt-4">{r.not} Ortalama MAE %{fmt(b.avgMaePct,3)}, ortalama MFE %{fmt(b.avgMfePct,3)}. Optimizasyon sonucu doğrudan canlı ayara uygulanmaz; önce görülmemiş veri ve PAPER doğrulaması gerekir.</div>
    </>}
  </div>
}
function M({l,v,tone}:{l:string;v:string;tone?:'g'|'r'}){return <div className="bg-zinc-800/30 rounded-lg p-3"><div className="text-[11px] text-zinc-500">{l}</div><div className={`font-medium mt-1 ${tone==='g'?'text-emerald-400':tone==='r'?'text-rose-400':''}`}>{v}</div></div>}
function K({l,v}:{l:string;v:string}){return <div><div className="text-zinc-500">{l}</div><div className="font-medium mt-0.5">{v}</div></div>}
function turkce(s:string){return ({TREND:'Trend',MOMENTUM:'Momentum',KIRILIM:'Kırılım',HACIM:'Hacim',ORTALAMAYA_DONUS:'Ortalamaya dönüş',GERI_CEKILME:'Geri çekilme'} as Record<string,string>)[s]||s}
