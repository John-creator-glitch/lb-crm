// Edge Function: the OWNER sets a temporary password for a staff member / manager who is locked out.
// Deploy:  supabase functions deploy admin-set-password      (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically)
// The service-role key lives ONLY here on the server. The browser never sees it.
// Rules enforced here (not in the browser): caller must be a signed-in, ACTIVE owner; target must exist; an owner cannot be reset by this function;
// the target must pick a new password at the next sign-in (profiles.must_change_password); every reset is written to the audit log.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Letters and digits that cannot be confused when read aloud or typed (no 0/O, 1/l/I).
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function tempPassword(len = 12): string {
  const buf = new Uint32Array(len); crypto.getRandomValues(buf);
  const c = Array.from(buf, n => ALPHABET[n % ALPHABET.length]);
  const L = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', D = '23456789';
  c[0] = L[buf[0] % L.length]; // always one letter and one digit
  c[1] = D[buf[1] % D.length];
  return c.join('');
}
function problem(pw: string): string | null {
  if (pw.length < 8) return 'The password must be at least 8 characters.';
  if (pw.length > 72) return 'The password is too long (72 characters at most).';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use letters and at least one number.';
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json(401, { error: 'Sign in first.' });

  // 1) who is calling? (verified by Supabase Auth, not trusted from the request body)
  const asCaller = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u, error: uErr } = await asCaller.auth.getUser();
  if (uErr || !u?.user) return json(401, { error: 'Your session has expired. Sign in again.' });
  const callerId = u.user.id;

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  // 2) must be an active owner
  const { data: me } = await admin.from('profiles').select('role, active').eq('id', callerId).maybeSingle();
  if (!me || me.role !== 'admin' || me.active !== true) return json(403, { error: 'Only the owner can reset passwords.' });

  // 3) input
  let body: { user_id?: string; password?: string } = {};
  try { body = await req.json(); } catch { return json(400, { error: 'Bad request.' }); }
  const target = String(body.user_id ?? '');
  if (!/^[0-9a-fA-F-]{36}$/.test(target)) return json(400, { error: 'Choose a user.' });
  if (target === callerId) return json(400, { error: 'Change your own password from the sign-in page ("Forgot password").' });
  const pw = body.password ? String(body.password) : tempPassword();
  const bad = problem(pw);
  if (bad) return json(400, { error: bad });

  // 4) the target must exist and must not be an owner
  const { data: t } = await admin.from('profiles').select('id, role, full_name, email').eq('id', target).maybeSingle();
  if (!t) return json(404, { error: 'User not found.' });
  if (t.role === 'admin') return json(403, { error: 'An owner account cannot be reset from here.' });

  // 5) set it
  const { error: setErr } = await admin.auth.admin.updateUserById(target, { password: pw });
  if (setErr) return json(500, { error: 'Could not set the password: ' + setErr.message });
  const { error: markErr } = await admin.rpc('lb_mark_password_reset', { p_target: target, p_by: callerId });
  if (markErr) return json(500, { error: 'The password was set, but the "must change" flag failed: ' + markErr.message });

  // 6) audit trail (never contains the password)
  await admin.from('audit_logs').insert({ user_id: callerId, action: 'password_reset', entity_type: 'profile', entity_id: target, details: { target_name: t.full_name, target_email: t.email, by: 'owner' } });

  return json(200, { ok: true, password: pw, generated: !body.password });
});
