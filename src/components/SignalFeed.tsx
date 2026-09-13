import { BrainCircuit, Check, X, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useApp } from "../context/AppContext";
import { formatCurrency, cn } from "../lib/utils";

export default function SignalFeed() {
  const { signals, approveSignal, rejectSignal, state } = useApp();
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});

  const handleAmountChange = (id: string, value: string) => {
    setCustomAmounts(prev => ({ ...prev, [id]: value }));
  };

  const handleApprove = (id: string) => {
    const amount = Number(customAmounts[id]) || Math.min(state.balance, state.balance*((state.positionSizePercent||25)/100));
    if (amount <= 0) return;
    approveSignal(id, amount);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="p-5 border-b border-zinc-800 bg-zinc-900 flex justify-between items-start">
        <div>
          <h2 className="text-lg font-medium text-zinc-100 flex items-center gap-2">
            <BrainCircuit size={18} className="text-blue-400" />
            Analiz Sinyalleri
          </h2>
          <p className="text-sm text-zinc-400 mt-1">
            {state.autoPilot 
              ? "Güvenli sanal mod: otomatik gerçek emir kapalı." 
              : "Analizleri inceleyip kendiniz karar verin."}
          </p>
        </div>
        <span className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 text-xs font-medium rounded-lg border border-emerald-500/20">Binance Spot • Sanal Test</span>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {state.autoPilot && (
          <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-start gap-3">
            <AlertTriangle size={18} className="text-blue-400 mt-0.5 shrink-0" />
            <div>
              <h4 className="text-sm font-medium text-blue-400">Otomatik Pilot Devrede</h4>
              <p className="text-xs text-blue-400/80 mt-1 leading-relaxed">
                Günlük hedef bölgesi %{state.dailyTargetPercent}. Sistem 80 altı fırsatlarda otomatik alım yapmaz; 75-79 arası yalnız Gölge Testi'nde izlenir. Ayı/Panik rejiminde yeni spot alışı açılmaz.
              </p>
            </div>
          </div>
        )}

        {signals.length === 0 && !state.autoPilot && (
          <div className="text-center py-10">
            <BrainCircuit size={32} className="mx-auto text-zinc-700 mb-3" />
            <p className="text-sm text-zinc-500">Şu an yeni bir sinyal yok.<br/>Bir coini piyasa tablosundan inceleyerek sinyal oluşturabilirsiniz.</p>
          </div>
        )}

        {signals.map((signal) => (
          <div 
            key={signal.id} 
            className={cn(
              "p-4 rounded-xl border transition-all",
              signal.status === 'PENDING' ? "bg-zinc-800/40 border-zinc-700" : "bg-zinc-900/20 border-zinc-800/50 opacity-60"
            )}
          >
            <div className="flex justify-between items-start mb-3">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "px-2 py-0.5 rounded text-xs font-bold",
                  signal.type === 'BUY' 
                    ? "bg-emerald-500/20 text-emerald-400" 
                    : "bg-rose-500/20 text-rose-400"
                )}>
                  {signal.type==='BUY'?'AL':'SAT'}
                </span>
                <span className="font-medium text-zinc-200">{signal.symbol}</span>
                <span className="text-xs text-zinc-500">@ {formatCurrency(signal.price)}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-xs text-zinc-400">Fırsat Puanı</span>
                <span className={cn(
                  "font-bold text-sm",
                  signal.aiScore >= 80 ? "text-emerald-400" : "text-yellow-400"
                )}>
                  {signal.aiScore}/100
                </span>
              </div>
            </div>
            
            <p className={`text-sm mb-4 leading-relaxed p-3 rounded-lg border ${
              signal.source === 'rules'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-200/90' 
                : 'bg-zinc-950/50 border-zinc-800/50 text-zinc-400'
            }`}>
              {signal.source === 'rules' && (
                <span className="block text-amber-500 font-medium mb-1 text-xs uppercase tracking-wider">
                  KURAL TABANLI ANALİZ
                </span>
              )}
              "{signal.analysis}"
            </p>

            {signal.status === 'PENDING' && !state.autoPilot ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500 whitespace-nowrap">Yatırım (USDT):</span>
                  <input
                    type="number"
                    value={customAmounts[signal.id] !== undefined ? customAmounts[signal.id] : String(Math.min(state.balance, state.balance*((state.positionSizePercent||25)/100)).toFixed(2))}
                    onChange={(e) => handleAmountChange(signal.id, e.target.value)}
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-md px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/50 transition-colors"
                  />
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleApprove(signal.id)}
                    className="flex-1 flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Check size={16} /> Onayla ve Al
                  </button>
                  <button 
                    onClick={() => rejectSignal(signal.id)}
                    className="flex-1 flex items-center justify-center gap-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    <X size={16} /> Yoksay
                  </button>
                </div>
              </div>
            ) : signal.status === 'EXECUTED' ? (
              <div className="mt-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <div className="text-center pb-2 text-xs font-medium uppercase tracking-wider text-emerald-500 border-b border-emerald-500/10 mb-2">
                  <Check size={14} className="inline mr-1 mb-0.5" /> İşlem Gerçekleşti
                </div>
                {signal.targetPrice && signal.projectedProfit && signal.investmentAmount && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="text-zinc-400">Yatırım: <span className="text-zinc-200 font-medium">${signal.investmentAmount}</span></div>
                    <div className="text-zinc-400">Alış: <span className="text-zinc-200 font-medium">${formatCurrency(signal.price)}</span></div>
                    <div className="text-zinc-400">Hedef Satış: <span className="text-blue-400 font-medium">${formatCurrency(signal.targetPrice)}</span></div>
                    <div className="text-zinc-400">Tahmini Kâr: <span className="text-emerald-400 font-medium">+${formatCurrency(signal.projectedProfit)}</span></div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                İşlem Reddedildi
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
