import { useApp } from '../context/AppContext';
import { Settings2, X, Key, Info, Shield, Octagon, PlayCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function SettingsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { state, setDailyTarget, setPositionSizePercent, setAutoPilotBudget, setRiskSettings } = useApp();
  const [execStatus,setExecStatus]=useState<any>(null);
  const [reconcile,setReconcile]=useState<any>(null);
  const [protection,setProtection]=useState<any>(null);
  const refreshStatus=async()=>{
    try{
      const [r,rr,pr]=await Promise.all([fetch('/api/execution/status'),fetch('/api/execution/reconcile'),fetch('/api/execution/protection')]);
      if(r.ok)setExecStatus(await r.json());
      if(rr.ok)setReconcile(await rr.json());
      if(pr.ok)setProtection(await pr.json());
    }catch{}
  };
  useEffect(()=>{if(isOpen)refreshStatus()},[isOpen,state.executionMode,state.automationMode,state.safeMode]);
  if (!isOpen) return null;
  const setProfile=(profile:any)=>{
    const presets:any={CONSERVATIVE:{riskPerTradePercent:.35,maxDailyLossPercent:1.25,maxOpenRiskPercent:1,maxPositions:2},BALANCED:{riskPerTradePercent:.5,maxDailyLossPercent:2,maxOpenRiskPercent:1.75,maxPositions:3},AGGRESSIVE:{riskPerTradePercent:.85,maxDailyLossPercent:3,maxOpenRiskPercent:3,maxPositions:5}};
    setRiskSettings({riskProfile:profile,...(presets[profile]||{})});
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"><div className="bg-zinc-900 border border-zinc-800 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
    <div className="p-5 border-b border-zinc-800 flex justify-between items-center"><h2 className="text-lg font-medium flex items-center gap-2"><Settings2 size={18}/>V11 Paper100 • Risk • Sanal Test</h2><button onClick={onClose}><X size={20}/></button></div>
    <div className="p-6 space-y-7">
      <section><h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4 flex items-center gap-2"><Shield size={15}/>Risk Profili</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">{[['CONSERVATIVE','Muhafazakâr'],['BALANCED','Dengeli'],['AGGRESSIVE','Agresif'],['CUSTOM','Özel']].map(([v,l])=><button key={v} onClick={()=>setProfile(v)} className={`p-3 rounded-lg border text-sm ${state.riskProfile===v?'border-emerald-500 bg-emerald-500/10 text-emerald-400':'border-zinc-800 bg-zinc-950 text-zinc-400'}`}>{l}</button>)}</div>
        <div className="grid md:grid-cols-2 gap-4 mt-5">
          <Range label="İşlem başına azami hesap riski" value={state.riskPerTradePercent} min={0.1} max={2} step={0.05} suffix="%" disabled={state.riskProfile!=='CUSTOM'} onChange={v=>setRiskSettings({riskPerTradePercent:v})}/>
          <Range label="Günlük maksimum zarar" value={state.maxDailyLossPercent} min={0.5} max={8} step={0.25} suffix="%" disabled={state.riskProfile!=='CUSTOM'} onChange={v=>setRiskSettings({maxDailyLossPercent:v})}/>
          <Range label="Toplam açık risk limiti" value={state.maxOpenRiskPercent} min={0.5} max={8} step={0.25} suffix="%" disabled={state.riskProfile!=='CUSTOM'} onChange={v=>setRiskSettings({maxOpenRiskPercent:v})}/>
          <Range label="Maksimum açık pozisyon" value={state.maxPositions} min={1} max={8} step={1} suffix="" disabled={state.riskProfile!=='CUSTOM'} onChange={v=>setRiskSettings({maxPositions:v})}/>
        </div>
      </section>
      <div className="h-px bg-zinc-800"/>
      <section><h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">Paper / Sermaye ve Pozisyon Boyutlandırma</h3><div className="space-y-5">
        <Range label="Pozisyon başına maksimum sermaye oranı" value={state.positionSizePercent ?? 25} min={5} max={50} step={5} suffix="%" onChange={setPositionSizePercent}/>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-zinc-950 p-3 rounded-xl border border-zinc-800 text-xs">
          <div><div className="text-zinc-500">İşlem başına risk</div><div className="font-semibold text-emerald-400 mt-0.5">%{state.riskPerTradePercent?.toFixed(2) ?? '0.50'}</div></div>
          <div><div className="text-zinc-500">Pozisyon sermaye üst sınırı</div><div className="font-semibold text-emerald-400 mt-0.5">%{state.positionSizePercent ?? 25}</div></div>
          <div><div className="text-zinc-500">Maksimum toplam açık risk</div><div className="font-semibold text-emerald-400 mt-0.5">%{state.maxOpenRiskPercent?.toFixed(2) ?? '1.75'}</div></div>
          <div><div className="text-zinc-500">Maksimum açık pozisyon</div><div className="font-semibold text-emerald-400 mt-0.5">{state.maxPositions ?? 3}</div></div>
        </div>
        <div className="p-3 bg-zinc-950/80 border border-zinc-800 rounded-lg text-xs text-zinc-400 leading-relaxed">
          💡 <span className="text-zinc-300 font-medium">100 USDT hesapta %{state.positionSizePercent ?? 25} pozisyon limiti</span>, işlem başına maksimum <span className="text-emerald-400 font-semibold">{(100 * (state.positionSizePercent ?? 25) / 100).toFixed(0)} USDT</span> anlamına gelir. Gerçek işlem tutarı Risk Manager tarafından daha düşük hesaplanabilir.
        </div>
        <Range label="Günlük hedef bölgesi" value={state.dailyTargetPercent} min={1} max={10} step={0.5} suffix="%" onChange={setDailyTarget}/>
        <p className="text-xs text-zinc-500">V11 kâr hedefini zorunlu işlem hedefi olarak kullanmaz. +%2'de eşik yükselir, +%3'te koruma modu, +%5'te yeni işlemler için çok yüksek kalite aranır.</p>
      </div></section>
      <div className="h-px bg-zinc-800"/>
      <section className="space-y-4"><h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2"><Octagon size={14}/>V11 Çalıştırma Güvenliği</h3>
        <div><div className="text-xs text-zinc-500 mb-2">Ortam</div><div className="p-3 rounded-lg border border-emerald-500 bg-emerald-500/10 text-emerald-300 text-sm">PAPER ONLY • 100 USDT sanal bakiye • Binance canlı public veri</div></div>
        <div><div className="text-xs text-zinc-500 mb-2">Otomasyon</div><div className="grid grid-cols-3 gap-2">{[['MANUAL','Manuel'],['SEMI_AUTO','Yarı Otomatik'],['FULL_AUTO','Tam Otomatik']].map(([v,l])=>{const disabled=state.executionMode==='LIVE'&&v==='FULL_AUTO';return <button key={v} disabled={disabled} onClick={()=>setRiskSettings({automationMode:v as any})} className={`p-3 rounded-lg border text-xs disabled:opacity-30 disabled:cursor-not-allowed ${state.automationMode===v?'border-emerald-500 bg-emerald-500/10 text-emerald-300':'border-zinc-800 bg-zinc-950 text-zinc-400'}`}>{l}</button>})}</div></div>
        <label className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded-lg p-3"><span className="text-sm text-zinc-300">SAFE MODE — yeni alışları engelle</span><input type="checkbox" checked={state.safeMode} onChange={e=>setRiskSettings({safeMode:e.target.checked})} className="accent-amber-500"/></label>
        <div className="grid grid-cols-2 gap-2"><button onClick={async()=>{await fetch('/api/execution/kill',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'UI acil durdurma'})});refreshStatus()}} className="p-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-sm flex justify-center gap-2"><Octagon size={16}/>KILL SWITCH</button><button onClick={async()=>{await fetch('/api/execution/release',{method:'POST'});refreshStatus()}} className="p-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 text-sm flex justify-center gap-2"><PlayCircle size={16}/>Kilidi Aç</button></div>
        <div className={`rounded-lg p-3 border text-xs ${execStatus?.newEntriesAllowed?'border-emerald-500/20 bg-emerald-500/10 text-emerald-300':'border-amber-500/20 bg-amber-500/10 text-amber-300'}`}>Yeni işlem: {execStatus?.newEntriesAllowed?'İZİNLİ':'KİLİTLİ'} • Testnet: {execStatus?.testnet?.connected?'BAĞLI':'BAĞLI DEĞİL'}{execStatus?.reasons?.length?` • ${execStatus.reasons.join(' ')}`:''}</div>
        <div className="grid md:grid-cols-2 gap-2">
          <div className={`rounded-lg p-3 border text-xs ${reconcile?.ok?'border-emerald-500/20 bg-emerald-500/10 text-emerald-300':'border-zinc-700 bg-zinc-950 text-zinc-400'}`}>Reconciliation: {reconcile?.ok?'UYUMLU':reconcile?'KONTROL GEREKİYOR':'VERİ YOK'} • Pozisyon {reconcile?.count ?? 0}</div>
          <div className={`rounded-lg p-3 border text-xs ${protection?.ok?'border-emerald-500/20 bg-emerald-500/10 text-emerald-300':'border-zinc-700 bg-zinc-950 text-zinc-400'}`}>Protection: {protection?.ok?'DOĞRULANDI':protection?'EKSİK / POZİSYON YOK':'VERİ YOK'} • Exchange-native: HAYIR</div>
        </div>
        <div className="rounded-lg p-3 border border-zinc-800 bg-zinc-950 text-xs text-zinc-400">Market data: {execStatus?.marketHealth?.ok?'OK':'SORUN'} • Gecikme {execStatus?.marketHealth?.latencyMs ?? '-'} ms</div>
        <p className="text-xs text-zinc-500">Bu paket Binance'a hiçbir alış/satış emri göndermez. Fiyatlar ve piyasa verileri Binance Global public Spot API'den canlı gelir; tüm işlemler yalnızca yerel 100 USDT sanal Paper portföyünde gerçekleşir.</p>
      </section>
      <div className="h-px bg-zinc-800"/>
      <section><h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2"><Key size={14}/>Binance Entegrasyonu</h3><div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 flex gap-3"><Info size={16} className="text-blue-400 shrink-0"/><p className="text-xs text-blue-300/80">Piyasa verisi Binance Global public Spot'tan gelir. Bu Paper100 test paketinde Binance API anahtarı gerekmez; özel emir API'leri kullanılmaz.</p></div><button onClick={async()=>{if(!confirm('Paper portföyü, işlem geçmişi ve sinyaller silinip bakiye 100 USDT olarak sıfırlansın mı?'))return; const r=await fetch('/api/paper/reset',{method:'POST'}); if(r.ok) window.location.reload();}} className="mt-3 w-full p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-sm">100 USDT Testi Sıfırla</button></section>
    </div>
  </div></div>;
}

function Range({label,value,min,max,step,suffix,onChange,disabled=false}:{label:string;value:number;min:number;max:number;step:number;suffix:string;onChange:(v:number)=>void;disabled?:boolean}){
  return <div className={disabled?'opacity-60':''}><div className="flex justify-between text-sm mb-2"><span className="text-zinc-300">{label}</span><b className="text-emerald-400">{value}{suffix}</b></div><input disabled={disabled} type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))} className="w-full accent-emerald-500"/></div>;
}
