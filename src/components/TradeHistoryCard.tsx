import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import { loadTradeHistory } from '../lib/cloudData';
import { formatAssetPrice, formatPnl } from '../lib/utils';
import type { TradeHistoryItem } from '../types';
import { useApp } from '../context/AppContext';

const REASONS:Record<string,string>={
  AUTO_PAPER:'Otomatik sanal alış',
  MANUAL_PAPER:'Manuel sanal alış',
  MANUAL_CLOSE:'Manuel kapatma',
  ZARAR_DURDUR:'Zarar durdur',
  IZ_SUREN_STOP:'İz süren stop',
  KAR_AL_1:'Kâr al 1',
  KAR_AL_2:'Kâr al 2',
};
function reasonLabel(v:string){return REASONS[v]||v||'-'}
function shownSymbol(v:string){return v.endsWith('USDT')?v:`${v}USDT`}

export default function TradeHistoryCard(){
  const {state}=useApp();
  const [rows,setRows]=useState<TradeHistoryItem[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const load=useCallback(async()=>{setLoading(true);try{setRows(await loadTradeHistory(200));setError('')}catch(e:any){setError(e?.message||'İşlem geçmişi okunamadı.')}finally{setLoading(false)}},[]);
  useEffect(()=>{void load();const i=setInterval(()=>void load(),10000);return()=>clearInterval(i)},[load]);
  const sells=useMemo(()=>rows.filter(x=>x.side==='SELL'),[rows]);
  const wins=sells.filter(x=>x.realizedPnl>0).length;
  const losses=sells.filter(x=>x.realizedPnl<0).length;

  return <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
    <div className="flex items-center justify-between mb-4"><div><div className="flex items-center gap-2 text-lg font-medium"><History size={18} className="text-sky-400"/>İşlem Geçmişi ve Performans</div><div className="text-xs text-zinc-500 mt-1">Alış, satış, kapanış nedeni, komisyon ve net K/Z kayıtları Supabase'den okunur.</div></div><button onClick={()=>void load()} disabled={loading} className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"><RefreshCw size={15} className={loading?'animate-spin':''}/></button></div>
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4"><Metric label="Başlangıç" value={formatPnl(state.startingBalance)}/><Metric label="Gerçekleşmiş Net K/Z" value={`${state.realizedPnl>=0?'+':''}${formatPnl(state.realizedPnl)}`} tone={state.realizedPnl>=0?'good':'bad'}/><Metric label="Toplam Komisyon" value={formatPnl(state.totalFees)}/><Metric label="Kârlı Kapanış" value={String(wins)} tone="good"/><Metric label="Zararlı Kapanış" value={String(losses)} tone="bad"/></div>
    <div className="text-[11px] text-zinc-500 border border-zinc-800 rounded-lg px-3 py-2 mb-4">PAPER100 komisyon simülasyonu: alışta %0,10, satışta %0,10. Satış satırlarındaki “Net K/Z” her iki tarafın komisyonunu da içerir. “Zarar durdur”, “Kâr al”, “İz süren stop” ve “Manuel kapatma” nedenleri ayrı gösterilir.</div>
    {error&&<div className="text-sm text-rose-400 mb-3">{error}</div>}
    <div className="overflow-x-auto max-h-[420px] overflow-y-auto"><table className="w-full text-xs"><thead className="sticky top-0 bg-zinc-950"><tr className="text-zinc-500"><th className="text-left py-2">Tarih</th><th className="text-left">Varlık</th><th className="text-left">İşlem</th><th className="text-right">Fiyat</th><th className="text-right">Miktar</th><th className="text-right">Komisyon</th><th className="text-right">Net K/Z</th><th className="text-right">Net %</th><th className="text-left pl-3">Neden</th></tr></thead><tbody>{rows.map(r=><tr key={r.id} className="border-t border-zinc-800/60"><td className="py-2 text-zinc-400 whitespace-nowrap">{new Date(r.createdAt).toLocaleString('tr-TR')}</td><td className="font-medium">{shownSymbol(r.symbol)}</td><td className={r.side==='BUY'?'text-sky-400':'text-amber-300'}>{r.side==='BUY'?'AL':'SAT'}</td><td className="text-right">{formatAssetPrice(r.price)}</td><td className="text-right">{r.quantity.toLocaleString('tr-TR',{maximumFractionDigits:6})}</td><td className="text-right">{formatPnl(r.feeUsdt)}</td><td className={`text-right ${r.side==='SELL'?(r.realizedPnl>=0?'text-emerald-400':'text-rose-400'):'text-zinc-500'}`}>{r.side==='SELL'?`${r.realizedPnl>=0?'+':''}${formatPnl(r.realizedPnl)}`:'-'}</td><td className={`text-right ${r.side==='SELL'?(Number(r.netReturnPct||0)>=0?'text-emerald-400':'text-rose-400'):'text-zinc-500'}`}>{r.side==='SELL'?`${Number(r.netReturnPct||0)>=0?'+':''}${Number(r.netReturnPct||0).toFixed(3)}%`:'-'}</td><td className="pl-3 text-zinc-300">{reasonLabel(r.reason)}</td></tr>)}{rows.length===0&&!loading&&<tr><td colSpan={9} className="text-center py-8 text-zinc-500">Henüz işlem kaydı yok.</td></tr>}</tbody></table></div>
  </div>
}
function Metric({label,value,tone}:{label:string;value:string;tone?:'good'|'bad'}){return <div className="bg-zinc-800/30 rounded-lg p-3"><div className="text-[11px] text-zinc-500">{label}</div><div className={`font-medium mt-1 ${tone==='good'?'text-emerald-400':tone==='bad'?'text-rose-400':''}`}>{value}</div></div>}
