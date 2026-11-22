# Security review (19 Nov 2026) — findings re-checked against this build

Source: external review "Liaqat Brothers app: security test report" (72 attack cases on a private PostgreSQL with Supabase-style roles + code review).
Not covered by that review or by us: your live Supabase project and its auth service, Vercel/Namecheap settings, social engineering. Not a certified penetration test.

Every finding was **re-tested on this final build** (the review's own fix file `1_RUN_THIS_NOW_security_fix.sql` was not available to us, so equivalent fixes are in the normal migration chain). Tests: `supabase/tests/M9_security_tests.sql`.

| # | Sev | Finding | State in this build | Where |
|---|---|---|---|---|
| 1 | CRITICAL | A signed-in user, even "waiting for approval", sets own role=admin, active=true | **Not exploitable here**: since M1 the table grants UPDATE only on `full_name`; attack returns "permission denied". Tests S1–S1g (pending user, staff, manager; self and colleagues; insert) all refused | M1 migration; regression tests M9 |
| 2 | HIGH | Public-key holder calls `lb_log_change()` and forges audit/status rows | **Not exploitable here**: function not executable by anon or signed-in users; status history has no write grant. **Plus** new: signed-out visitors can now execute NO function in `public` at all (tests S3–S4b) | M1; M9 migration §3 |
| 3 | LOW | Two elevated trigger functions without fixed search_path | **Fixed**: `set_updated_at`, `snapshot_fee_rule_revision` (test S5: every SECURITY DEFINER function has a fixed search_path) | M9 migration §2 |
| 4 | LOW | CSV formula injection (`=HYPERLINK(...)` as a client name) | **Fixed**: cells starting with `= + - @ tab CR` get a leading apostrophe; real numbers and phone numbers unchanged (7 unit checks) | `src/lib/csv.ts`, `tests/csv.test.ts` |
| 5 | LOW | No security headers | **Fixed**: `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Permissions-Policy`. Script-level CSP deliberately left out (print windows use inline scripts; needs browser testing first) | `vercel.json` |
| 6 | MEDIUM (decision) | Staff can change money of an APPROVED quotation through the API | **Fixed, using the recommended rule**: after approval, totals, government/service parts, client and every fee line can only be changed by Manager/Owner (tests S6–S6f: staff refused on all four routes; staff may still edit draft/pending; manager may correct). The decision is yours to reverse: drop the two triggers `quotations_amount_guard_trg`, `quotation_lines_amount_guard_trg` | M9 migration §1 |
| 7 | INFO | Staff read colleagues' emails; branding readable by any signed-in user | By design, unchanged | – |

## Held up in the review and still verified here
All tables under row-level security; signed-out visitors read nothing; pending users read nothing; Staff cannot read finance/reports/audit log or edit rates/payments/users; DROP/TRUNCATE refused; no secret keys in the app; print windows escape user text; service worker does not cache database traffic.

## Remaining recommendations (not code)
1. In Supabase > Authentication: decide whether public sign-up stays open; keep email confirmation on; set a strong password policy; consider MFA for the Owner account.
2. Make sure the service-role key exists only in Supabase/Vercel server settings, never in the browser env (`VITE_*` variables are public).
3. After adding any new SQL function in future, repeat the `REVOKE EXECUTE … FROM PUBLIC, anon` step (M9 §3 shows how) and add its test.
4. Re-run `M9_security_tests.sql` on staging before every release.
