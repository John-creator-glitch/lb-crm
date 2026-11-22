import { useState } from 'react';
import DbStatus from '@/components/DbStatus';
import { useAuth } from '@/lib/auth';
import { Loader2, Lock, Mail, User as UserIcon } from 'lucide-react';

export default function Login() {
  const { signIn, signUp, requestPasswordReset } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    if (mode === 'forgot') {
      const r = await requestPasswordReset(email);
      setBusy(false);
      if (r.error) setError(r.error); else setSent(true);
      return;
    }
    const result =
      mode === 'signin'
        ? await signIn(email, password)
        : await signUp(email, password, fullName);
    setBusy(false);
    if (result.error) setError(result.error);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Liaqat Brothers" className="w-28 h-28 mx-auto mb-4 rounded-full shadow-lg shadow-black/30" />
          <h1 className="text-2xl font-bold text-white tracking-tight">Liaqat Brothers</h1>
          <p className="text-slate-400 text-sm mt-1">
            Excise Vehicle Fee Calculator &amp; Quotation System
          </p>
        </div>

        <div className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-8 shadow-2xl">
          <div className="flex gap-1 p-1 bg-slate-800/50 rounded-lg mb-6">
            <button
              type="button"
              onClick={() => { setMode('signin'); setError(null); }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition ${
                mode === 'signin' ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup'); setError(null); }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition ${
                mode === 'signup' ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-white'
              }`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Full Name</label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    required
                    className="w-full pl-10 pr-3 py-2.5 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition"
                    placeholder="Your full name"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="w-full pl-10 pr-3 py-2.5 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition"
                  placeholder="you@liaqatbrothers.com"
                />
              </div>
            </div>

            {mode !== 'forgot' && <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full pl-10 pr-3 py-2.5 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition"
                  placeholder="••••••••"
                />
              </div>
            </div>}

            {mode === 'signup' && <p className="text-xs text-slate-400">After you register, the owner has to approve your account before you can use the system.</p>}

            {error && (
              <div className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 font-semibold rounded-lg hover:from-amber-400 hover:to-amber-500 transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === 'signin' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send reset link'}
            </button>
            {mode === 'signin' && <button type="button" onClick={() => { setMode('forgot'); setError(null); setSent(false); }} className="w-full text-center text-xs text-slate-400 hover:text-amber-400">Forgot password?</button>}
            {mode === 'forgot' && <button type="button" onClick={() => { setMode('signin'); setError(null); setSent(false); }} className="w-full text-center text-xs text-slate-400 hover:text-amber-400">Back to sign in</button>}
            {mode === 'forgot' && sent && <div className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">If this e-mail has an account, a reset link is on its way. Open it on this device and choose a new password. Still stuck? Ask the owner to reset it for you.</div>}
          </form>

          <p className="text-xs text-slate-500 text-center mt-6">
            Authorized personnel only. All actions are logged.
          </p>
        </div>
        <details className="mt-4 text-slate-300"><summary className="text-xs cursor-pointer text-center text-slate-400">Cannot sign in? Check database connection</summary><DbStatus /></details>
      </div>
    </div>
  );
}
