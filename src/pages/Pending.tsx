import { useAuth } from '@/lib/auth';
import { Clock, LogOut } from 'lucide-react';

export default function Pending() {
  const { profile, user, signOut } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl p-8 text-center shadow-2xl">
        <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4"><Clock className="w-7 h-7 text-amber-600" /></div>
        <h1 className="text-xl font-bold text-slate-900">Waiting for approval</h1>
        <p className="text-sm text-slate-600 mt-2">Your account <b>{profile?.email || user?.email}</b> is created, but the owner has not given you access yet. Please ask the owner to approve you under <b>Users &amp; Rights</b>, then press the button below.</p>
        <button onClick={() => window.location.reload()} className="mt-5 w-full px-4 py-3 rounded-lg bg-amber-500 text-slate-900 font-medium hover:bg-amber-400">I have been approved, check again</button>
        <button onClick={signOut} className="mt-3 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800"><LogOut className="w-4 h-4" /> Sign out</button>
      </div>
    </div>
  );
}
