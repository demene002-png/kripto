import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { formatCurrency, formatAssetPrice, formatPnl } from '../lib/utils';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { Wallet } from 'lucide-react';

const COLORS=['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#6366f1'];
function shownSymbol(symbol:string){ return symbol.endsWith('USDT') ? symbol : `${symbol}USDT`; }

export default function PortfolioOverview(){
  const {state,marketData,closePosition}=useApp();
  const [lastPriceUpdate,setLastPriceUpdate]=useState<Date|null>(null);
  const [closingSymbol,setClosingSymbol]=useState<string|null>(null);
  useEffect(()=>{ if(marketData.length) setLastPriceUpdate(new Date()); },[marketData]);

  const rows=useMemo(()=>state.portfolio.map(item=>{
    const normalized=item.symbol.endsWith('USDT')?item.symbol.slice(0,-4):item.symbol;
    const m=marketData.find(x=>x.symbol===normalized || x.pair===item.symbol);
    const price=m?.price||item.averageBuyPrice;
    const cost=item.amount*item.averageBuyPrice;
    const value=item.amount*price;
    const pnl=value-cost;
    return {...item,currentPrice:price,currentValue:value,cost,pnl,pnlPct:cost>0?pnl/cost*100:0};
  }).filter(x=>x.amount>0),[state.portfolio,marketData]);

  const invested=rows.reduce((s,x)=>s+x.cost,0);
  const current=rows.reduce((s,x)=>s+x.currentValue,0);
  const unrealized=rows.reduce((s,x)=>s+x.pnl,0);
  const total=state.balance+current;
  const chart=[{name:'Nakit (USDT)',value:state.balance},...rows.map(x=>({name:shownSymbol(x.symbol),value:x.currentValue}))].filter(x=>x.value>0);
  const handleClose=async(symbol:string)=>{
    if(closingSymbol)return;
    setClosingSymbol(symbol);
    try{await closePosition(symbol)}finally{setClosingSymbol(null)}
  };

  return <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
    <div className="flex items-center justify-between gap-2 mb-6"><div className="flex items-center gap-2 text-lg font-medium"><Wallet size={18} className="text-emerald-400"/>Spot Portföy Özeti</div><div className="text-[11px] text-zinc-500">Fiyat güncelleme: {lastPriceUpdate?lastPriceUpdate.toLocaleTimeString('tr-TR'):'-'}</div></div>
    <div className="grid md:grid-cols-2 gap-8"><div className="space-y-4"><div className="p-4 bg-zinc-800/30 rounded-xl"><div className="text-sm text-zinc-500">Toplam Varlık (Sanal)</div><div className="text-3xl font-bold">{formatCurrency(total)}</div></div><div className="grid grid-cols-3 gap-4"><div className="p-4 bg-zinc-800/30 rounded-xl"><div className="text-xs text-zinc-500">USDT Bakiye</div><div className="text-lg">{formatCurrency(state.balance)}</div></div><div className="p-4 bg-zinc-800/30 rounded-xl"><div className="text-xs text-zinc-500">Maliyet</div><div className="text-lg">{formatCurrency(invested)}</div></div><div className="p-4 bg-zinc-800/30 rounded-xl"><div className="text-xs text-zinc-500">Gerçekleşmemiş K/Z</div><div className={`text-lg ${unrealized>=0?'text-emerald-400':'text-rose-400'}`}>{unrealized>=0?'+':''}{formatPnl(unrealized)}</div></div></div></div>
    <div className="flex items-center"><div className="h-40 w-40"><ResponsiveContainer><PieChart><Pie data={chart} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" stroke="none">{chart.map((_,i)=><Cell key={i} fill={i===0?'#27272a':COLORS[(i-1)%COLORS.length]}/>)}</Pie><RechartsTooltip formatter={(v:number)=>formatCurrency(v)}/></PieChart></ResponsiveContainer></div><div className="pl-6 space-y-2 text-sm">{chart.slice(0,6).map((x,i)=><div key={x.name} className="flex gap-2"><span style={{color:i===0?'#71717a':COLORS[(i-1)%COLORS.length]}}>●</span><span>{x.name}</span><span className="text-zinc-500">{total>0?(x.value/total*100).toFixed(1):'0.0'}%</span></div>)}</div></div></div>
    <div className="mt-6 border-t border-zinc-800 pt-5"><h4 className="text-sm font-medium mb-4">Açık Spot Pozisyonlar</h4>{rows.length===0?<div className="text-center py-6 text-sm text-zinc-500">Açık pozisyon yok.</div>:<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-zinc-500"><th className="text-left py-2">Varlık</th><th className="text-right">Miktar</th><th className="text-right">Ort. Alış</th><th className="text-right">Güncel</th><th className="text-right">Değer</th><th className="text-right">K/Z</th><th className="text-right">Stop / TP</th><th></th></tr></thead><tbody>{rows.map(x=><tr key={x.symbol} className="border-t border-zinc-800/50"><td className="py-3 font-medium">{shownSymbol(x.symbol)}</td><td className="text-right">{x.amount.toLocaleString('tr-TR',{maximumFractionDigits:6})}</td><td className="text-right">{formatAssetPrice(x.averageBuyPrice)}</td><td className="text-right">{formatAssetPrice(x.currentPrice)}</td><td className="text-right">{formatPnl(x.currentValue)}</td><td className={`text-right ${x.pnl>=0?'text-emerald-400':'text-rose-400'}`}>{x.pnl>=0?'+':''}{formatPnl(x.pnl)} ({x.pnlPct>=0?'+':''}{x.pnlPct.toFixed(4)}%)</td><td className="text-right text-xs text-zinc-400"><div>Stop {x.stopLoss?formatAssetPrice(x.stopLoss):'-'}</div><div>KA1 {x.takeProfit1?formatAssetPrice(x.takeProfit1):'-'}</div></td><td className="text-right"><button disabled={closingSymbol===x.symbol} onClick={()=>handleClose(x.symbol)} className="px-2.5 py-1.5 bg-zinc-800 hover:bg-rose-500/20 rounded disabled:opacity-50">{closingSymbol===x.symbol?'Satılıyor…':'Sat'}</button></td></tr>)}</tbody></table></div>}</div>
  </div>;
}
