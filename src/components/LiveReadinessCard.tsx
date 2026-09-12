import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, Siren, RefreshCw, KeyRound, LockKeyhole, UnlockKeyhole } from 'lucide-react';
import { useApp } from '../context/AppContext';

type Check={id:string;label:string;pass:boolean;critical:boolean};
type Readiness={
  liveTradingEnabled:boolean;
  api:any;
  liveCapitalCapUsd:number;
  hardCapUsd:number;
  attestations:Record<string,boolean>;
  checks:Check[];
  score:{criticalPassed:number;criticalTotal:number;optionalPassed:number;optionalTotal:number};
  readyForV11Review:boolean;
  verdict:string;
  note:string;
};

export default function LiveReadinessCard(){
  const { state, setRiskSettings }=useApp();
  const [data,setData]=useState<Readiness|null>(null);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [liveStatus,setLiveStatus]=useState<any>(null);
  const [armPhrase,setArmPhrase]=useState('');
  const load=async()=>{try{setError('');const [r,lr]=await Promise.all([fetch('/api/live-readiness'),fetch('/api/live/status')]);const d=await r.json();if(!r.ok)throw new Error(d.error||'Readiness alınamadı');setData(d);if(lr.ok)setLiveStatus(await lr.json());}catch(e:any){setError(e.message)}};
  useEffect(()=>{load()},[state.liveCapitalCapUsd,state.liveApiPermissionAttested,state.emergencyDrillAttested,state.testnetReviewAttested,state.newsRetestAttested]);
  const drill=async()=>{setBusy('drill');try{const r=await fetch('/api/live-readiness/emergency-drill',{method:'POST'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Drill başarısız');setRiskSettings({emergencyDrillAttested:true,safeMode:true});await load();}catch(e:any){setError(e.message)}finally{setBusy('')}};
  const arm=async()=>{setBusy('arm');try{const r=await fetch('/api/live/arm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phrase:armPhrase})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Arm başarısız');setArmPhrase('');await load();}catch(e:any){setError(e.message)}finally{setBusy('')}};
  const disarm=async()=>{setBusy('disarm');try{await fetch('/api/live/disarm',{method:'POST'});await load();}finally{setBusy('')}};
  if(!data) return <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 text-sm text-zinc-500">V11 Controlled Live yükleniyor…</div>;
  const passPct=Math.round(data.score.criticalPassed/Math.max(1,data.score.criticalTotal)*100);
  return <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
      <div><div className="flex items-center gap-2 text-zinc-100 font-medium">{data.readyForV11Review?<ShieldCheck size={18} className="text-emerald-400"/>:<ShieldAlert size={18} className="text-amber-400"/>} V11 Controlled Live Gate</div><p className="text-xs text-zinc-500 mt-1">Canlı Spot yalnız MANUAL / SEMI_AUTO, readiness + explicit 10 dakikalık arming ile.</p></div>
      <button onClick={load} className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs flex items-center gap-2"><RefreshCw size={14}/> Yenile</button>
    </div>
    {error&&<div className="mb-3 p-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-xs text-rose-300">{error}</div>}
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-xs">
      <Metric label="Kritik Kontrol" value={`${data.score.criticalPassed}/${data.score.criticalTotal}`}/>
      <Metric label="Hazırlık" value={`%${passPct}`}/>
      <Metric label="Canlı Emir" value={data.liveTradingEnabled?'ENV AÇIK':'ENV KAPALI'}/>
      <Metric label="Readiness" value={data.readyForV11Review?'HAZIR':'HAZIR DEĞİL'}/>
    </div>
    <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-4 mb-4">
      <div className="flex items-center gap-2 text-sm text-zinc-200 mb-3"><KeyRound size={16}/> Canlı API Preflight</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <Metric label="API Tanımlı" value={data.api?.configured?'EVET':'HAYIR'}/>
        <Metric label="Withdrawal" value={data.api?.checks?.withdrawalsDisabled?'KAPALI':'DOĞRULANMADI'}/>
        <Metric label="Spot Trading" value={data.api?.checks?.spotTrading?'AÇIK':'DOĞRULANMADI'}/>
        <Metric label="IP Restriction" value={data.api?.checks?.ipRestricted?'AKTİF':'AKTİF DEĞİL'}/>
      </div>
      <p className="text-xs text-zinc-500 mt-3">{data.api?.reason}</p>
    </div>
    <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-4 mb-4">
      <div className="text-sm text-zinc-200 mb-3">Canlı Sermaye Tavanı</div>
      <div className="flex items-center gap-3">
        <input type="number" min={0} max={data.hardCapUsd} step={10} value={state.liveCapitalCapUsd} onChange={e=>setRiskSettings({liveCapitalCapUsd:Number(e.target.value)})} className="w-40 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm"/>
        <span className="text-xs text-zinc-500">USDT • Sistem üst sınırı ${data.hardCapUsd}</span>
      </div>
      <p className="text-xs text-zinc-500 mt-2">0 değeri canlı sermayeyi kilitli tutar. Bu alan gerçek emirleri açmaz; sadece V11 öncesi tavanı tanımlar.</p>
    </div>
    <div className="grid md:grid-cols-2 gap-3 mb-4">
      {data.checks.map(c=><div key={c.id} className={`rounded-lg border p-3 text-xs ${c.pass?'border-emerald-500/20 bg-emerald-500/5 text-emerald-300':'border-zinc-800 bg-zinc-950 text-zinc-400'}`}><div className="flex justify-between gap-2"><span>{c.label}</span><b>{c.pass?'PASS':'WAIT'}</b></div><div className="text-[10px] text-zinc-600 mt-1">{c.critical?'Kritik':'Opsiyonel / önerilen'}</div></div>)}
    </div>
    <div className={`rounded-lg border p-4 mb-4 ${liveStatus?.arming?.armed?'border-red-500/30 bg-red-500/5':'border-zinc-800 bg-zinc-950/60'}`}>
      <div className="flex items-center gap-2 text-sm text-zinc-200 mb-3">{liveStatus?.arming?.armed?<UnlockKeyhole size={16} className="text-red-400"/>:<LockKeyhole size={16}/>} Canlı İşlem Arming</div>
      <div className="text-xs text-zinc-500 mb-3">{liveStatus?.arming?.armed?`ARMED • kalan yaklaşık ${liveStatus.arming.remainingSeconds}s`:'DISARMED • canlı emir gönderilemez'}</div>
      {!liveStatus?.arming?.armed?<div className="flex flex-col md:flex-row gap-2"><input value={armPhrase} onChange={e=>setArmPhrase(e.target.value)} placeholder="CANLI SPOT 10 DAKIKA" className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs"/><button onClick={arm} disabled={!!busy||!data.readyForV11Review} className="px-4 py-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs disabled:opacity-40">10 dk ARM</button></div>:<button onClick={disarm} disabled={!!busy} className="px-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs">Hemen DISARM</button>}
      <p className="text-[11px] text-zinc-600 mt-3">Arming parola değildir; yanlışlıkla canlı emir gönderilmesini önleyen kısa süreli ikinci kapıdır. LIVE FULL_AUTO yoktur.</p>
    </div>
    <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-4 mb-4">
      <div className="text-sm text-zinc-200 mb-3">Manuel Gözden Geçirme Onayları</div>
      <div className="grid md:grid-cols-2 gap-2">
        <Toggle label="API izinleri gözden geçirildi" checked={state.liveApiPermissionAttested} onChange={v=>setRiskSettings({liveApiPermissionAttested:v})}/>
        <Toggle label="Testnet performans/reconciliation incelendi" checked={state.testnetReviewAttested} onChange={v=>setRiskSettings({testnetReviewAttested:v})}/>
        <Toggle label="News A/B maliyet-fayda retest incelendi" checked={state.newsRetestAttested} onChange={v=>setRiskSettings({newsRetestAttested:v})}/>
        <Toggle label="Emergency exit drill tamamlandı" checked={state.emergencyDrillAttested} onChange={v=>setRiskSettings({emergencyDrillAttested:v})}/>
      </div>
    </div>
    <button onClick={drill} disabled={!!busy} className="w-full rounded-lg p-3 border border-red-500/30 bg-red-500/10 text-red-300 text-sm flex items-center justify-center gap-2"><Siren size={16}/>{busy?'Drill çalışıyor…':'Emergency Exit Drill Çalıştır'}</button>
    <p className="text-xs text-zinc-500 mt-3">{data.note}</p>
  </div>;
}
function Toggle({label,checked,onChange}:{label:string;checked:boolean;onChange:(v:boolean)=>void}){return <label className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-300"><span>{label}</span><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} className="accent-emerald-500"/></label>}
function Metric({label,value}:{label:string;value:string}){return <div className="bg-zinc-950/60 rounded-lg p-2 border border-zinc-800/70"><div className="text-zinc-500">{label}</div><div className="font-medium text-zinc-200 mt-1 break-words">{value}</div></div>}
