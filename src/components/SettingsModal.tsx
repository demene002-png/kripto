import { useEffect, useMemo, useState } from 'react';
import { Settings2, X, Info, Shield, Octagon, PlayCircle, Database, RotateCcw, Wifi } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { resetPaper100 } from '../lib/cloudData';

export default function SettingsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { state, marketData, setDailyTarget, setPositionSizePercent, setRiskSettings } = useApp();
  const [marketLatency, setMarketLatency] = useState<number | null>(null);
  const [marketOk, setMarketOk] = useState(false);

  const refreshMarketStatus = async () => {
    const started = performance.now();
    try {
      const r = await fetch('https://api.binance.com/api/v3/time', { cache: 'no-store' });
      setMarketOk(r.ok);
      setMarketLatency(Math.round(performance.now() - started));
    } catch {
      setMarketOk(false);
      setMarketLatency(null);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    void refreshMarketStatus();
  }, [isOpen]);

  const openPositions = state.portfolio.length;
  const protectedPositions = useMemo(
    () => state.portfolio.filter(p => Number(p.stopLoss || 0) > 0).length,
    [state.portfolio]
  );

  if (!isOpen) return null;

  const setProfile = (profile: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE' | 'CUSTOM') => {
    const presets = {
      CONSERVATIVE: { riskPerTradePercent: 0.35, maxDailyLossPercent: 1.25, maxOpenRiskPercent: 1, maxPositions: 2 },
      BALANCED: { riskPerTradePercent: 0.5, maxDailyLossPercent: 2, maxOpenRiskPercent: 1.75, maxPositions: 3 },
      AGGRESSIVE: { riskPerTradePercent: 0.85, maxDailyLossPercent: 3, maxOpenRiskPercent: 3, maxPositions: 5 },
      CUSTOM: {}
    } as const;
    setRiskSettings({ riskProfile: profile, ...presets[profile] });
  };

  const reset = async () => {
    if (!confirm('Sanal portföy, işlem geçmişi ve sinyaller silinip bakiye 100 USDT olarak sıfırlansın mı?')) return;
    try {
      await resetPaper100();
      window.location.reload();
    } catch (e: any) {
      alert(e?.message || 'Sıfırlama başarısız.');
    }
  };

  const newEntriesAllowed = !state.safeMode;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 md:p-4">
      <div className="bg-zinc-900 border border-zinc-800 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] overflow-y-auto">
        <div className="p-5 border-b border-zinc-800 flex justify-between items-center sticky top-0 bg-zinc-900 z-10">
          <h2 className="text-lg font-medium flex items-center gap-2"><Settings2 size={18}/>Sanal 100 USDT • Risk • Test Ayarları</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-800"><X size={20}/></button>
        </div>

        <div className="p-6 space-y-7">
          <section>
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4 flex items-center gap-2"><Shield size={15}/>Risk Profili</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                ['CONSERVATIVE','Muhafazakâr'],
                ['BALANCED','Dengeli'],
                ['AGGRESSIVE','Agresif'],
                ['CUSTOM','Özel']
              ].map(([v,l]) => (
                <button key={v} onClick={() => setProfile(v as any)} className={`p-3 rounded-lg border text-sm ${state.riskProfile===v?'border-emerald-500 bg-emerald-500/10 text-emerald-400':'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'}`}>{l}</button>
              ))}
            </div>

            <div className="grid md:grid-cols-2 gap-4 mt-5">
              <Range label="İşlem başına azami hesap riski" value={state.riskPerTradePercent} min={0.1} max={2} step={0.05} suffix="%" disabled={state.riskProfile!=='CUSTOM'} onChange={v=>setRiskSettings({riskPerTradePercent:v})}/>
              <Range label="Günlük maksimum zarar" value={state.maxDailyLossPercent} min={0.5} max={8} step={0.25} suffix="%" disabled={state.riskProfile!=='CUSTOM'} onChange={v=>setRiskSettings({maxDailyLossPercent:v})}/>
              <Range label="Toplam açık risk limiti" value={state.maxOpenRiskPercent} min={0.5} max={8} step={0.25} suffix="%" disabled={state.riskProfile!=='CUSTOM'} onChange={v=>setRiskSettings({maxOpenRiskPercent:v})}/>
              <Range label="Maksimum açık pozisyon" value={state.maxPositions} min={1} max={8} step={1} suffix="" disabled={state.riskProfile!=='CUSTOM'} onChange={v=>setRiskSettings({maxPositions:v})}/>
            </div>
          </section>

          <div className="h-px bg-zinc-800"/>

          <section>
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">Sanal Sermaye ve Pozisyon Boyutlandırma</h3>
            <div className="space-y-5">
              <Range label="Pozisyon başına maksimum sermaye oranı" value={state.positionSizePercent} min={5} max={50} step={5} suffix="%" onChange={setPositionSizePercent}/>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-xs">
                <InfoBox label="İşlem başına risk" value={`%${state.riskPerTradePercent.toFixed(2)}`}/>
                <InfoBox label="Pozisyon sermaye üst sınırı" value={`%${state.positionSizePercent}`}/>
                <InfoBox label="Maksimum toplam açık risk" value={`%${state.maxOpenRiskPercent.toFixed(2)}`}/>
                <InfoBox label="Maksimum açık pozisyon" value={String(state.maxPositions)}/>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-xs text-zinc-300">
                💡 100 USDT sanal hesapta %{state.positionSizePercent} pozisyon limiti, tek pozisyonda en fazla <b>{(100*state.positionSizePercent/100).toFixed(0)} USDT</b> sermaye kullanılabileceği anlamına gelir. Gerçek sanal işlem tutarı risk kuralları nedeniyle daha düşük olabilir.
              </div>

              <Range label="Günlük hedef bölgesi" value={state.dailyTargetPercent} min={1} max={10} step={0.5} suffix="%" onChange={setDailyTarget}/>
              <p className="text-xs text-zinc-500">Günlük hedef zorunlu işlem hedefi değildir. Sistem yalnız uygun fırsat oluştuğunda işlem açmalıdır; hedefe yaklaşınca yeni işlemlerde daha seçici olunması amaçlanır.</p>
            </div>
          </section>

          <div className="h-px bg-zinc-800"/>

          <section className="space-y-4">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2"><Octagon size={14}/>Çalıştırma Güvenliği</h3>

            <div>
              <div className="text-xs text-zinc-500 mb-2">Ortam</div>
              <div className="p-3 rounded-lg border border-emerald-500 bg-emerald-500/10 text-emerald-300 text-sm">YALNIZ SANAL • 100 USDT sanal bakiye • Binance canlı genel piyasa verisi</div>
            </div>

            <div>
              <div className="text-xs text-zinc-500 mb-2">Otomasyon</div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['MANUAL','Manuel'],
                  ['SEMI_AUTO','Yarı Otomatik'],
                  ['FULL_AUTO','Tam Otomatik']
                ].map(([v,l]) => (
                  <button key={v} onClick={()=>setRiskSettings({automationMode:v as any, autoPilot:v==='FULL_AUTO'})} className={`p-3 rounded-lg border text-xs ${state.automationMode===v?'border-emerald-500 bg-emerald-500/10 text-emerald-300':'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'}`}>{l}</button>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded-lg p-3">
              <span className="text-sm text-zinc-300">GÜVENLİ MOD — yeni sanal alışları engelle</span>
              <input type="checkbox" checked={state.safeMode} onChange={e=>setRiskSettings({safeMode:e.target.checked})} className="accent-amber-500"/>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <button onClick={()=>setRiskSettings({safeMode:true})} className="p-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-sm flex justify-center gap-2"><Octagon size={16}/>ACİL DURDUR</button>
              <button onClick={()=>setRiskSettings({safeMode:false})} className="p-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 text-sm flex justify-center gap-2"><PlayCircle size={16}/>Kilidi Aç</button>
            </div>

            <div className={`rounded-lg p-3 border text-xs ${newEntriesAllowed?'border-emerald-500/20 bg-emerald-500/10 text-emerald-300':'border-amber-500/20 bg-amber-500/10 text-amber-300'}`}>Yeni sanal işlem: {newEntriesAllowed?'İZİNLİ':'KİLİTLİ'} • Gerçek emir: KAPALI</div>

            <div className="grid md:grid-cols-2 gap-2">
              <div className="rounded-lg p-3 border border-emerald-500/20 bg-emerald-500/10 text-xs text-emerald-300">Mutabakat: UYUMLU • Açık pozisyon {openPositions}</div>
              <div className="rounded-lg p-3 border border-zinc-700 bg-zinc-950 text-xs text-zinc-300">Koruma: {openPositions===0?'POZİSYON YOK':`${protectedPositions}/${openPositions} stop tanımlı`} • Borsa üzerinde koruyucu emir: HAYIR</div>
            </div>

            <div className="rounded-lg p-3 border border-zinc-800 bg-zinc-950 text-xs text-zinc-400 flex items-center gap-2"><Wifi size={14}/>Piyasa verisi: {marketOk && marketData.length>0?'UYGUN':'KONTROL GEREKİYOR'} • Gecikme {marketLatency==null?'-':`${marketLatency} ms`} • İzlenen piyasa {marketData.length}</div>
            <p className="text-xs text-zinc-500">Bu sürüm Binance'a hiçbir gerçek alış/satış emri göndermez. Fiyatlar Binance Global genel Spot verisinden alınır; tüm işlemler Supabase'deki 100 USDT sanal portföy üzerinde gerçekleşir.</p>
          </section>

          <div className="h-px bg-zinc-800"/>

          <section>
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2"><Database size={14}/>Binance ve Supabase Bağlantısı</h3>
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 flex gap-3">
              <Info size={16} className="text-blue-400 shrink-0"/>
              <p className="text-xs text-blue-300/80">Piyasa verisi Binance Global genel Spot verisinden gelir. Kullanıcı, 100 USDT sanal hesap, ayarlar, pozisyonlar ve sinyaller Supabase'de tutulur. Gerçek Binance emir anahtarı bu test sürümünde kullanılmaz.</p>
            </div>
            <button onClick={reset} className="mt-3 w-full p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-sm flex items-center justify-center gap-2"><RotateCcw size={16}/>100 USDT Sanal Testini Sıfırla</button>
          </section>
        </div>
      </div>
    </div>
  );
}

function Range({label,value,min,max,step,suffix,onChange,disabled=false}:{label:string;value:number;min:number;max:number;step:number;suffix:string;onChange:(v:number)=>void;disabled?:boolean}){
  return <div className={disabled?'opacity-60':''}><div className="flex justify-between text-sm mb-2"><span className="text-zinc-300">{label}</span><b className="text-emerald-400">{value}{suffix}</b></div><input disabled={disabled} type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))} className="w-full accent-emerald-500"/></div>;
}

function InfoBox({label,value}:{label:string;value:string}){
  return <div><div className="text-zinc-500 leading-tight">{label}</div><div className="text-emerald-400 font-semibold mt-1">{value}</div></div>;
}
