# Post-launch monitoring checklist & backlog (first 30 days)

## Every day (owner or manager, 5 minutes)
- [ ] Reports: the check line "start + billed − collected = end" says **OK** (not MISMATCH).
- [ ] Audit Log (owner): look for unexpected deletes, reversals or role changes.
- [ ] Reminders: overdue count is not growing; notification bell works for each staff member.
- [ ] Ask staff: "Did anything not save, or show a confusing message?" Write every answer below.

## Weekly
- [ ] Take a manual backup (Backup panel in Settings / Clients) and a Supabase backup; keep the last 4.
- [ ] Run the restore drill on a scratch copy once in the first month, then monthly.
- [ ] Supabase dashboard: Database > Reports / Logs — slow queries (> 2 s), API errors, storage and row counts.
- [ ] Vercel: deployment errors; Analytics if enabled.
- [ ] Outstanding ageing (Reports): compare 5 random clients with their paper/Excel ledgers.

## Warning signs and what to do
| Sign | Likely cause | Action |
|---|---|---|
| "Your session has expired" often | Browser kept open for days | Sign in again; if constant, tell developer |
| A list looks short | Filter active / archived hidden | Clear filters; the Clients page shows "archived" and "inactive" toggles |
| Page slow (> 5 s) with thousands of records | Data volume | Note the screen and the time; see backlog item B1 |
| Reminders do not fire when office is closed | pg_cron not scheduled | Schedule `process_due_reminders()` (M5 migration) |
| Two clients with the same phone | Duplicate entry | Use the duplicate warning; merge is manual by design |

## Severity rules
- **Critical** (money wrong, data lost, staff see owner-only data): stop, rollback per checklist, call the developer now.
- **High** (a daily task cannot be completed): same day.
- **Medium/Low** (wording, layout, convenience): collect in the backlog below, review weekly.

## Defect log (fill in)
| Date | Who | Screen | What happened | Severity | Fixed on |
|---|---|---|---|---|---|

## Prioritised backlog (known, from this build)
| # | Item | Why |
|---|---|---|
| B1 | True server-side paging and search for Clients/Quotations/Receipts | Screens now load all rows in pages of 1,000 and filter in the browser; fine to roughly 10,000 clients / 50,000 quotations (hard stop at 50,000 rows per list), slower after |
| B2 | Real-staff usability findings (from the walkthrough) | Not testable by the developer alone |
| B3 | Provider for WhatsApp/SMS reminders (docs/M5_provider_plan.md) | Reminders are in-app only |
| B4 | Split "collected" into government / service | Cannot be derived from payments today |
| B5 | Decide whether "Pending" quotations count as billed | One-line change; current default is v6 behaviour (counted) |
| B6 | Automatic nightly backup copy outside Supabase | Free plan has none |
| B7 | Full WCAG audit with a tool | Basics only were done in M7 |
