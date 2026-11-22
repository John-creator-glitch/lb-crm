import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { passwordProblem } from '@/lib/password';
import { Loader2, Lock } from 'lucide-react';

/** Shown (a) after the person opened the reset link from their e-mail, (b) when the owner gave them a temporary password. */
export default function SetPassword({ forced }: { forced: boolean }) {
  const { setNewPassword, signOut, profile } = useAuth();
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const p = passwordProblem(pw, pw2); if (p) { setErr(p); return; }
    setBusy(true); const r = await setNewPassword(pw); setBusy(false);
    if (r.error) setErr(r.error);
  }
  const input = 'w-full pl-10 pr-3 py-2.5 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50';
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4">
      <form onSubmit={submit} className="w-full max-w-md bg-white/5 rounded-2xl border border-white/10 p-8 shadow-2xl space-y-4">
        <h1 className="text-xl font-bold text-white">Choose your new password</h1>
        <p className="text-sm text-slate-400">{forced ? `${profile?.full_name || 'Hello'}, the owner gave you a temporary password. Choose your own now. Only you should know it.` : 'Type a new password for your account.'}</p>
        {(['New password', 'Type it again'] as const).map((label, i) => (
          <div key={label}>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">{label}</label>
            <div className="relative"><Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input type="password" autoComplete="new-password" required value={i === 0 ? pw : pw2} onChange={e => (i === 0 ? setPw(e.target.value) : setPw2(e.target.value))} className={input} /></div>
          </div>
        ))}
        <p className="text-xs text-slate-500">At least 8 characters, with letters and a number.</p>
        {err && <div className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{err}</div>}
        <button type="submit" disabled={busy} className="w-full py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 font-semibold rounded-lg disabled:opacity-60 flex items-center justify-center gap-2">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save new password
        </button>
        <button type="button" onClick={() => void signOut()} className="w-full text-center text-xs text-slate-400 hover:text-amber-400">Sign out</button>
      </form>
    </div>
  );
}
