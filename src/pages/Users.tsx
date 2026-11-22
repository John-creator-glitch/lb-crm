import { useEffect, useState } from 'react';
import { supabase, type Profile } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { PageHeader, Card, Spinner, Button, Badge, EmptyState } from '@/components/ui';
import { ROLES, RIGHTS_MATRIX, roleLabel, type Role } from '@/lib/permissions';
import { formatDate } from '@/lib/format';
import { Users as UsersIcon, Check, X, ShieldCheck, UserPlus, AlertTriangle, KeyRound, Mail, Copy } from 'lucide-react';
import { generateTempPassword, passwordProblem } from '@/lib/password';
import { friendlyError } from '@/lib/errors';

export default function UsersPage() {
  const { profile, user } = useAuth();
  const [rows, setRows] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [choice, setChoice] = useState<Record<string, Role>>({});
  const [reset, setReset] = useState<{ user: Profile; pw: string; done: string } | null>(null);

  async function load() {
    const { data } = await supabase.from('profiles').select('id, full_name, role, created_at, active, email, must_change_password').order('created_at', { ascending: true });
    setRows((data ?? []) as Profile[]); setLoading(false);
  }
  useEffect(() => { load(); }, []);

  if (profile?.role !== 'admin') return <><PageHeader title="Users & Rights" /><Card className="p-8"><EmptyState icon={AlertTriangle} title="Owner access required" subtitle="Only the owner can manage users." /></Card></>;
  if (loading) return <Spinner label="Loading users..." />;

  async function setAccess(u: Profile, role: Role, active: boolean, done: string) {
    setBusy(u.id); setErr(''); setMsg('');
    const { error } = await supabase.rpc('set_user_access', { target: u.id, new_role: role, new_active: active });
    setBusy('');
    if (error) { setErr(error.message.includes('set_user_access') ? 'The users migration has not been run yet. Run supabase/migrations/20261108180000_roles_and_rights.sql in Supabase.' : friendlyError(error)); return; }
    setMsg(`${u.full_name || u.email || 'User'}: ${done}`);
    await load();
  }

  async function sendResetEmail(u: Profile) {
    if (!u.email) { setErr('This person has no e-mail on file.'); return; }
    if (!window.confirm(`Send a password-reset e-mail to ${u.email}? They choose their own new password from the link.`)) return;
    setBusy(u.id); setErr(''); setMsg('');
    const { error } = await supabase.auth.resetPasswordForEmail(u.email, { redirectTo: window.location.origin });
    setBusy('');
    if (error) setErr(/rate|too many|seconds/i.test(error.message) ? 'Please wait a minute before sending another e-mail.' : friendlyError(error));
    else setMsg(`Reset e-mail sent to ${u.email}.`);
  }
  async function setTempPassword() {
    if (!reset) return;
    const bad = passwordProblem(reset.pw); if (bad) { setErr(bad); return; }
    setBusy(reset.user.id); setErr('');
    const { data, error } = await supabase.functions.invoke('admin-set-password', { body: { user_id: reset.user.id, password: reset.pw } });
    setBusy('');
    if (error || (data as { error?: string } | null)?.error) {
      const m = (data as { error?: string } | null)?.error || error?.message || '';
      setErr(/not found|Failed to send|FunctionsFetchError|404/i.test(m) ? 'The reset service is not installed yet. Follow docs/PASSWORD_RESET_SETUP.md (one command), or use "Send reset e-mail".' : m);
      return;
    }
    setReset({ ...reset, done: reset.pw }); await load();
  }

  const pending = rows.filter(r => r.active === false);
  const active = rows.filter(r => r.active !== false);
  const label = (u: Profile) => u.full_name || u.email || 'Unnamed user';

  return (
    <>
      <PageHeader title="Users & Rights" subtitle={`${active.length} active · ${pending.length} waiting for approval`} />
      {msg && <p className="text-sm text-emerald-700 mb-3">{msg}</p>}
      {err && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{err}</div>}

      <Card className="p-4 mb-4 bg-slate-50">
        <div className="flex gap-3">
          <UserPlus className="w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-slate-600">
            <p className="font-medium text-slate-800">How to add a person</p>
            <p className="mt-1">Ask them to open the app link, choose <b>Register</b> and make their own account. They see "waiting for approval" and appear below. You choose their role and press Approve. Nobody can see any data before you approve them.</p>
            <p className="mt-1 text-xs text-slate-500">You can also add them in Supabase under Authentication, Users, Add user. They still wait for your approval here.</p>
          </div>
        </div>
      </Card>

      {pending.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-slate-800 mb-2">Waiting for approval</h2>
          <Card className="divide-y divide-slate-100 mb-5 border-amber-200">
            {pending.map(u => (
              <div key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-900">{label(u)}</p><p className="text-xs text-slate-500">{u.email} · registered {formatDate(u.created_at)}</p></div>
                <select className="text-sm border border-slate-300 rounded-lg px-2 py-2 bg-white" value={choice[u.id] ?? 'staff'} onChange={e => setChoice({ ...choice, [u.id]: e.target.value as Role })} aria-label="Role">
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <Button size="sm" disabled={busy === u.id} onClick={() => setAccess(u, choice[u.id] ?? 'staff', true, 'approved')}><Check className="w-4 h-4" /> Approve</Button>
              </div>
            ))}
          </Card>
        </>
      )}

      <h2 className="text-sm font-semibold text-slate-800 mb-2">People with access</h2>
      <Card className="divide-y divide-slate-100 mb-5">
        {active.map(u => {
          const me = u.id === user?.id;
          return (
            <div key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">{label(u)} {me && <Badge className="bg-slate-100 text-slate-600 ml-1">You</Badge>}</p>
                <p className="text-xs text-slate-500">{u.email} · since {formatDate(u.created_at)}</p>
              </div>
              {me ? <Badge className="bg-amber-100 text-amber-800">{roleLabel(u.role)}</Badge> : (
                <>
                  <select className="text-sm border border-slate-300 rounded-lg px-2 py-2 bg-white" value={u.role} disabled={busy === u.id}
                    onChange={e => setAccess(u, e.target.value as Role, true, `is now ${roleLabel(e.target.value)}`)} aria-label="Role">
                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <Button size="sm" variant="secondary" disabled={busy === u.id || u.role === 'admin'} onClick={() => { setErr(''); setMsg(''); setReset({ user: u, pw: generateTempPassword(), done: '' }); }}><KeyRound className="w-4 h-4" /> Set password</Button>
                  <Button size="sm" variant="secondary" disabled={busy === u.id} onClick={() => void sendResetEmail(u)}><Mail className="w-4 h-4" /> Reset e-mail</Button>
                  <Button size="sm" variant="secondary" disabled={busy === u.id} onClick={() => { if (window.confirm(`Switch off ${label(u)}? They can no longer open the app. Their records stay.`)) setAccess(u, u.role as Role, false, 'switched off'); }}><X className="w-4 h-4" /> Switch off</Button>
                </>
              )}
            </div>
          );
        })}
      </Card>

      {reset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
          <Card className="w-full max-w-md p-5 bg-white">
            <h3 className="text-base font-semibold text-slate-900">Set a temporary password for {label(reset.user)}</h3>
            {!reset.done ? (
              <>
                <p className="text-sm text-slate-600 mt-2">Tell it to them in person or by phone. At their next sign-in they must choose their own password, so you will not know it afterwards. This action is written to the audit log.</p>
                <input className="mt-3 w-full border border-slate-300 rounded-lg px-3 py-2 font-mono text-base" value={reset.pw} onChange={e => setReset({ ...reset, pw: e.target.value })} aria-label="Temporary password" />
                <div className="flex gap-2 mt-2"><Button size="sm" variant="secondary" onClick={() => setReset({ ...reset, pw: generateTempPassword() })}>New random one</Button></div>
                {err && <p className="text-sm text-rose-700 mt-2">{err}</p>}
                <div className="flex justify-end gap-2 mt-4"><Button variant="secondary" onClick={() => { setReset(null); setErr(''); }}>Cancel</Button><Button disabled={busy === reset.user.id} onClick={() => void setTempPassword()}>Set password</Button></div>
              </>
            ) : (
              <>
                <p className="text-sm text-emerald-700 mt-2">Done. Give this password to {label(reset.user)} now. It is shown only once.</p>
                <div className="mt-3 flex items-center gap-2"><code className="flex-1 border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 font-mono text-lg tracking-wide">{reset.done}</code>
                  <Button size="sm" variant="secondary" onClick={() => { try { void navigator.clipboard.writeText(reset.done); } catch { /* ignore */ } }}><Copy className="w-4 h-4" /> Copy</Button></div>
                <div className="flex justify-end mt-4"><Button onClick={() => { setMsg(`Temporary password set for ${label(reset.user)}. They will choose their own at the next sign-in.`); setReset(null); }}>Close</Button></div>
              </>
            )}
          </Card>
        </div>
      )}

      <h2 className="text-sm font-semibold text-slate-800 mb-2">Who can do what</h2>
      <Card className="overflow-x-auto mb-4">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="text-left font-medium px-4 py-2">Right</th>{ROLES.slice().reverse().map(r => <th key={r.value} className="font-medium px-3 py-2 text-center">{r.label}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {RIGHTS_MATRIX.map(r => (
              <tr key={r.what}>
                <td className="px-4 py-2 text-slate-700">{r.what}</td>
                {([r.staff, r.manager, r.admin] as boolean[]).map((ok, i) => <td key={i} className="px-3 py-2 text-center">{ok ? <Check className="w-4 h-4 text-emerald-600 inline" /> : <span className="text-slate-300">—</span>}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="flex gap-2 text-xs text-slate-500 mb-6"><ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" /><span>These rules are enforced by the database itself, so they hold even if someone tries to bypass the screen. Switched-off people are listed under "Waiting for approval" and can be approved again.</span></div>
      <UsersIcon className="hidden" />
    </>
  );
}
