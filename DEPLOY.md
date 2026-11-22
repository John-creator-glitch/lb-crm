# Final deploy: online + mobile (Liaqat Brothers)

Aap ka Supabase project pehle se bana hua hai (aur `admin-set-password` function deploy ho chuki hai). Is liye naya project banane ki zaroorat nahi.

## 1. Database tayar karein (Supabase, SQL Editor, ek dafa)
Is tarteeb se, har file poori copy karke **Run**:
1. `supabase/migrations/20261127090000_m13_pentest_hardening.sql`  (CRITICAL security fix: lazmi)
2. `supabase/migrations/20261128090000_m14_admin_password_reset.sql`  (password reset + staff ko paise nazar na aayen)
   (ya in dono ki jagah poori `supabase/setup_complete.sql` ek dafa; dobara run karna mehfooz hai.)
3. Check (SQL Editor): yeh query **0 rows** deni chahiye
   `select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='profiles' and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE');`

## 2. Dummy / test data saaf karna
1. App mein **Settings, Backup** se backup download karein (agar kuch kaam ka ho).
2. `supabase/maintenance/CLEAN_TEST_DATA.sql` SQL Editor mein poori run karein. Pehli dafa yeh **kuch delete nahi karti**, sirf gintii dikhati hai.
3. Ginti theek lage to file mein `confirm text := 'NO'` ko `'YES'` karke dobara run karein.
4. Supabase, **Storage, lb-documents**: sab files select karke Delete.
Rehta hai: aap ka owner account aur sab log, Settings & Branding, fee rules, Punjab/Islamabad rates, message templates. Jata hai: clients, vehicles, quotations, payments, cases, transfers, leads, expenses, tasks, reminders, audit log.

## 3. Supabase settings (Authentication)
* **URL Configuration:** Site URL = aap ka Vercel link (jaise `https://liaqat-brothers.vercel.app`). Redirect URLs mein wohi link, aur testing ke liye `http://localhost:5173`.
* **Sign In / Providers, Email:** Minimum password length = 8.
* **Emails, SMTP Settings:** roz ke istemal ke liye apna SMTP lagayen (free plan bohat kam emails bhejta hai).
* Agar sirf aap apne staff ko khud add karte hain: **Allow new users to sign up** band kar dein aur log Users page / Authentication, Add user se banayen. (Register wala tareeqa chalu rakhna ho to owner approval phir bhi zaroori rehta hai.)
* Owner account ke liye MFA (2-step) on karein.

## 4. Code online (Vercel)
1. GitHub par **private** repository banayen, is folder ko upload karein (`.env`, `node_modules`, `dist` nahi jate; `.gitignore` rok deta hai).
2. vercel.com, **Add New, Project**, repository import. Framework **Vite**, Build `npm run build`, Output `dist`.
3. **Environment Variables:** `VITE_SUPABASE_URL` aur `VITE_SUPABASE_ANON_KEY` (Supabase, Project Settings, API se; **sirf anon key**, service_role key kabhi nahi).
4. **Deploy.** Mila hua link step 3 ke Site URL mein daalen.
5. Update dene ke liye bas naya code GitHub par push karein.

## 5. Mobile par
* Link phone ke browser mein kholen. Android Chrome: menu, **Install app / Add to Home screen**. iPhone Safari: Share, **Add to Home Screen**. Icon ban jata hai aur app full screen khulti hai.
* Pehli dafa thora internet chahiye; baad mein app ka dhancha jaldi khulta hai (data hamesha live aata hai).

## 6. Tez chalane ke liye (aap ke control mein)
* Supabase project ka **region** Singapore ya Mumbai ho (Lahore ke qareeb). Agar kisi door region (jaise US) mein hai to har click slow lagega; project banate waqt hi region chuna jata hai, baad mein badalna mushkil hai.
* `localhost:5173` (npm run dev) hamesha live site se slow hota hai. Asli speed Vercel wale link par dekhein.

## 7. Hifazat
* Hafte mein ek dafa backup (Settings, Backup) Google Drive/USB mein rakhein.
* Owner ka access kho jaye to SQL Editor: `UPDATE public.profiles SET role = 'admin', active = true WHERE email = 'aap@ki-email.com';` (yeh sirf SQL Editor se chalti hai, app se nahi).
* Supabase free plan 7 din bina istemal ke project pause kar deta hai; roz istemal mein masla nahi.
* Password bhool jaye to: staff "Forgot password?" se, ya owner Users page se "Set password". Dekhein `docs/PASSWORD_RESET_SETUP.md`.
