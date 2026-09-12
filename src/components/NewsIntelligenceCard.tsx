import { Newspaper, ShieldAlert, CalendarClock, Radio, CheckCircle2 } from 'lucide-react';
import { useApp } from '../context/AppContext';

const styles:Record<string,string>={NORMAL:'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',INFO:'bg-blue-500/10 text-blue-300 border-blue-500/20',CAUTION:'bg-amber-500/10 text-amber-300 border-amber-500/20',HIGH_RISK:'bg-orange-500/10 text-orange-300 border-orange-500/20',VETO:'bg-rose-500/10 text-rose-300 border-rose-500/20'};
const levelTr:Record<string,string>={NORMAL:'NORMAL',INFO:'BİLGİ',CAUTION:'DİKKAT',HIGH_RISK:'YÜKSEK RİSK',VETO:'VETO'};

export default function NewsIntelligenceCard(){
  const {newsIntelligence:n}=useApp();
  if(!n) return null;
  const providers=[n.providers.cryptopanic,n.providers.coinmarketcal,n.providers.genericNews,n.providers.macroConfig].filter(Boolean).length;
  return <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
    <div className="flex items-start justify-between gap-4 mb-4">
      <div><div className="flex items-center gap-2 text-zinc-100 font-medium"><Newspaper size={18} className="text-violet-400"/> Haber ve Olay Analizi</div><p className="text-xs text-zinc-500 mt-1">Haber tek başına AL kararı üretmez; doğrulanmış kritik negatif olaylar VETO uygulayabilir.</p></div>
      <span className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${styles[n.level]||styles.INFO}`}>{levelTr[n.level]||n.level}</span>
    </div>
    <div className="text-sm text-zinc-300 bg-zinc-950/60 border border-zinc-800 rounded-lg p-3 mb-4 flex gap-2"><ShieldAlert size={16} className="mt-0.5 shrink-0"/><span>{n.reason}</span></div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
      <Metric icon={<Radio size={13}/>} label="Duygu eğilimi" value={`${n.score.sentiment>0?'+':''}${n.score.sentiment}`}/>
      <Metric icon={<ShieldAlert size={13}/>} label="Risk etkisi" value={`+${n.score.riskAdjustment}`}/>
      <Metric icon={<CalendarClock size={13}/>} label="Yaklaşan olay" value={String(n.upcomingEvents.length)}/>
      <Metric icon={<CheckCircle2 size={13}/>} label="Aktif sağlayıcı" value={`${providers}/4`}/>
    </div>
    {n.news.length>0?<div className="space-y-2">{n.news.slice(0,3).map(x=><div key={x.id} className="flex items-start justify-between gap-3 text-xs border-t border-zinc-800 pt-2"><div><div className="text-zinc-300">{x.title}</div><div className="text-zinc-600 mt-1">{x.source} • güven {x.reliability}/100 • {x.category}{x.confirmations>1?` • ${x.confirmations} teyit`:''}</div></div><span className={x.sentiment<0?'text-rose-400':'text-emerald-400'}>{x.sentiment>0?'+':''}{x.sentiment}</span></div>)}</div>:<div className="text-xs text-zinc-500">Canlı haber sağlayıcısı henüz yapılandırılmadı veya güncel kayıt yok. Sistem bu durumda haber skoru uydurmaz.</div>}
    {n.providers.errors?.length>0&&<div className="mt-3 text-xs text-amber-400/80">Sağlayıcı uyarısı: {n.providers.errors[0]}</div>}
  </div>
}
function Metric({icon,label,value}:{icon:any;label:string;value:string}){return <div className="bg-zinc-950/60 rounded-lg p-3 border border-zinc-800"><span className="text-zinc-500 text-xs flex items-center gap-1">{icon}{label}</span><div className="text-zinc-100 font-semibold mt-1">{value}</div></div>}
