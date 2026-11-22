# Liaqat Brothers CRM v7 — Production release & rollback checklist

Use this once, in order. Tick each box. **Nothing here is done for you: it needs the owner and the person with Supabase / Vercel access.**

## 0. Before the maintenance window (a day before)
- [ ] Staging has run the whole checklist below with the SAME files as production (zip `LBCalculator-v7-M8`).
- [ ] The staging UAT (docs/M8_UAT_QA_report.md, section "People tests") is signed.
- [ ] Choose the window: after closing time (Pakistan), no one entering data. Tell staff: "System will be closed from __ to __".
- [ ] Note the current live version: Vercel > Deployments > the live one (keep it, it is the frontend rollback), and the date.
- [ ] Confirm who can: open Supabase SQL editor, open Vercel, restore a backup.

## 1. Backup (must finish and be checked BEFORE any change)
- [ ] Supabase > Database > Backups: take / confirm a fresh backup (or `supabase db dump`). Note its time: ________
- [ ] In the app: Clients page > Backup (or Settings) > download the JSON backup (second copy, separate from Supabase). Save it on two devices.
- [ ] Run the restore drill on a COPY: `sh scripts/backup_restore_drill.sh` (SRC = production dump, DST = a new empty Supabase project/branch). Must print `PASS restore is identical`. **Do not continue if it does not.**
- [ ] Write down 3 control numbers from production: number of clients ____, number of quotations ____, total outstanding (Reports > Outstanding) ____.

## 2. Database migrations (Supabase > SQL Editor, one file at a time, as the project owner)
Order (each is safe to run twice). Files dated 20261105…20261108 (original schema, rates, roles) and the M1 file are already live (M0/M1 done); run only the files below that are not yet applied. On a brand-new project run `supabase/setup_complete.sql` instead (all files in one):
1. `20261109090000_m1_integrity_permissions.sql`
2. `20261117090000_m2_client_360_vehicles.sql`
3. `20261118090000_m3_quotation_case_workflow.sql`
4. `20261119090000_m4_payments_ledger.sql`
5. `20261120090000_m5_reminders_notifications.sql`
6. `20261121090000_m6_dashboard_reports.sql`
7. `20261122090000_m8_performance.sql` (changes how access rules are written and speeds up reports; same meaning)
8. `20261123090000_m9_security_hardening.sql` (locks amounts of approved quotations to Manager/Owner; no signed-out visitor can run any function; fixed search_path)
- [ ] After each file: "Success", no red error. If a file errors, STOP and go to section 6.
- [ ] Run the test files on STAGING only (never production): `supabase/tests/M1…M8_e2e_role_tests.sql` and `M9_security_tests.sql` (the 25 attack cases from the security review). Every line PASS.
- [ ] Production data check: the 3 control numbers from step 1 are unchanged (migrations must not change them).
- Optional, once: schedule `process_due_reminders()` with pg_cron (line is in the M5 migration) so reminders fire when nobody has the app open.

## 3. Frontend
- [ ] Vercel env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` are set (unchanged).
- [ ] Deploy the new build. Open the live URL in a private window; hard-refresh once on each staff phone/computer.

## 4. Smoke test on production (10 minutes, owner present)
- [ ] Owner login; Dashboard loads; Reports opens; Settings visible.
- [ ] Staff login: no Reports/Settings/Audit; Dashboard shows no money totals; staff cannot change the amounts of an APPROVED quotation (manager can).
- [ ] Response headers: DevTools > Network > the page > Headers show `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`.
- [ ] Supabase > Authentication: sign-up / email-confirmation policy as you intend (new people stay "waiting for approval" until the owner activates them).
- [ ] Search a known client by phone: found. Open Client 360: ledger balance equals the control number for that client.
- [ ] Create a TEST quotation (client "ZZ Test"), approve, create case, record Rs 1 payment, reverse it with a reason, then archive the test client. (Only the owner reverses/archives.)
- [ ] Reports > finance check line shows "OK" (not MISMATCH).
- [ ] Download a quotation PDF; WhatsApp link opens.
- [ ] The 3 control numbers: unchanged apart from the test records.

## 5. Go-live
- [ ] Tell staff the system is open; give them docs/STAFF_QUICK_START.md.
- [ ] Owner watches the first day using docs/POST_LAUNCH_MONITORING.md.

## 6. Rollback / recovery plan
| Problem | Action |
|---|---|
| Screen broken or wrong after frontend deploy, database fine | Vercel > Deployments > previous deployment > **Promote to production**. Takes a minute, no data lost. The old frontend still works with the new database (all migrations only ADD). |
| A migration errored half-way | Each migration runs in one transaction in the SQL editor: a failed run changes nothing. Fix the cause, or stop and ask the developer. Do not run later files. |
| Migration ran but a report/number looks wrong | Do NOT edit data. Compare with the control numbers. Roll the frontend back (above), keep the database, send the developer the screen + time. Functions can be put back with CREATE OR REPLACE from the previous migration file. |
| Data damaged or lost | Stop staff entry. Restore the step-1 backup into a NEW project/branch, run `backup_restore_drill.sh` style comparison, then either switch the app to it (change the two Vercel env vars) or copy back only the damaged tables. Work done since the backup time must be re-entered; this is why the window is after closing time. |
| Security concern (a staff member sees money / settings) | Owner: Users & Rights > set that user inactive immediately; then contact the developer. |

Recovery targets to agree with the owner: data loss at most since the last backup (daily on Supabase paid plans; the free plan has NO automatic backups, so take the manual backup in step 1 and weekly after); time to switch back to the previous frontend: about 5 minutes; time to restore a database: depends on size, rehearsed on staging in step 1.
