import { useState } from "react";
import { BrainCircuit, Settings2, LogOut } from "lucide-react";
import { useApp } from "../context/AppContext";
import { supabase } from "../lib/supabase";
import SettingsModal from "./SettingsModal";

export default function Header() {
  const { state } = useApp();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <>
      <header className="border-b border-zinc-800 bg-zinc-950/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          
          <div className="flex items-center gap-2 text-zinc-100 font-medium text-lg">
            <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center border border-zinc-700">
              <BrainCircuit size={18} className="text-blue-400" />
            </div>
            Kripto AI <span className="text-zinc-500 font-light">Asistan</span>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                SANAL 100 USDT • {state.automationMode === 'MANUAL' ? 'Manuel' : state.automationMode === 'SEMI_AUTO' ? 'Yarı Otomatik' : 'Tam Otomatik'}
              </span>
              {state.safeMode && <span className="text-xs px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300">GÜVENLİ MOD</span>}
            </div>            
            <div className="w-px h-6 bg-zinc-800"></div>

            <button onClick={()=>supabase.auth.signOut()} title="Çıkış" className="p-2 text-zinc-400 hover:text-rose-300 hover:bg-zinc-800 rounded-lg transition-colors"><LogOut size={19}/></button>
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors"
            >
              <Settings2 size={20} />
            </button>
          </div>
        </div>
      </header>
      
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </>
  );
}
