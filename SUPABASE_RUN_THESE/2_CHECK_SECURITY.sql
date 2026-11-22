-- 2) CHECK: run after step 1. Every result must be as written in the comment, otherwise tell me.
-- a) must return NO ROWS (nobody signed-in can change roles; visitors have no table rights)
select grantee, table_name, privilege_type from information_schema.role_table_grants
 where table_schema='public' and ((grantee='anon') or (table_name='profiles' and grantee='authenticated' and privilege_type in ('INSERT','DELETE','UPDATE')));
-- b) must return exactly:  full_name   (the only column a user may edit on their own profile)
select column_name from information_schema.column_privileges
 where table_schema='public' and table_name='profiles' and grantee='authenticated' and privilege_type='UPDATE';
-- c) must return 2 rows (the functions used by password reset exist)
select proname from pg_proc where pronamespace='public'::regnamespace and proname in ('lb_mark_password_reset','clear_must_change_password');
-- d) must return 1 row (profile protection trigger)
select tgname from pg_trigger where tgrelid='public.profiles'::regclass and tgname='profiles_protect';
