import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
    } catch (err:any) {
      setError(err?.message || 'Giriş başarısız');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-2xl">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex items-center justify-center mb-4"><span className="text-3xl text-blue-500">⚡</span></div>
          <h1 className="text-2xl font-bold text-white">Kripto Simülatörü</h1>
          <p className="text-zinc-500 text-sm mt-1">Supabase hesabınızla giriş yapın</p>
        </div>
        {error && <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm rounded-lg p-3 mb-6 text-center">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><label className="block text-xs font-medium text-zinc-400 mb-1.5">E-posta</label><input type="email" required value={email} onChange={e=>setEmail(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:outline-none"/></div>
          <div><label className="block text-xs font-medium text-zinc-400 mb-1.5">Şifre</label><input type="password" required value={password} onChange={e=>setPassword(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:outline-none"/></div>
          <button disabled={busy} type="submit" className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg py-3 mt-2">{busy?'Giriş yapılıyor…':'Giriş Yap'}</button>
        </form>
      </div>
    </div>
  );
}
