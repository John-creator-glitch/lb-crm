# Password reset: setup (10 minutes, once)

Two ways exist. Both are in the app after this update.

1. **Staff forgot the password** -> sign-in page -> "Forgot password?" -> e-mail link -> they choose a new one. (needs step A)
2. **Owner sets a temporary password** -> Users & Rights -> "Set password" next to the person (or "Reset e-mail"). The person must choose their own password at the next sign-in. The owner never knows the final password. Every reset is in the Audit Log. (needs steps A and B)

## A. Supabase settings (dashboard)
Authentication -> URL Configuration:
* **Site URL** = your live app address (for example https://your-app.vercel.app)
* **Redirect URLs** = the same address (add it twice if you also use a preview address)
Without this the e-mail link goes to localhost and "Forgot password" looks broken.
Authentication -> Emails: check the "Reset Password" template is on. The free plan sends only a few e-mails per hour; for daily use set up your own SMTP (Authentication -> SMTP Settings).
Authentication -> Providers -> Email: set **Minimum password length** to 8.

## B. The "Set password" button (owner reset) needs one small server function
1. Run the database migration `20261128090000_m14_admin_password_reset.sql` (or the whole `setup_complete.sql`; it is safe to run again).
2. Install the Supabase CLI once, then in the project folder:
   `supabase login`
   `supabase link --project-ref <your project ref>`
   `supabase functions deploy admin-set-password`
   Supabase fills in the keys by itself. The powerful service key stays on Supabase's server and is never in the browser.
3. Open the app as owner -> Users & Rights -> "Set password" -> give the shown password to the person.

If you skip step B, "Set password" shows "The reset service is not installed yet" and "Reset e-mail" still works.

## What the code guarantees
* Only an **active owner** can call the function; this is checked on the server from the signed-in session, not from anything the browser sends.
* An owner account cannot be reset by it, and you cannot use it on yourself.
* The temporary password is never stored or logged. The audit log records who reset whom, and when.
* The person is stopped on a "choose your new password" screen until the password really changed (the database compares the stored password fingerprint, so pressing a button is not enough).
* Staff cannot read or fake any of this (tests M14-4 to M14-8).

## Money visibility (changed in the same update)
Staff now see only the payments and receipts of **their own customers** (assigned to them or created by them) and what they entered themselves. They never see: expenses, profit, reports, the dashboard money tiles, the Receipts running total, or other staff's customers' payments. Owner and Manager see everything. Enforced in the database (tests M14-1 to M14-3, M14-9 to M14-11), not only in the screens.
