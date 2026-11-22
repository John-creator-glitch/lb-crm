-- M14: staff cannot see the business's money; owner password reset flag cannot be faked. Everything is rolled back.
BEGIN; SET client_min_messages = warning;
INSERT INTO auth.users (id,email,role,aud,encrypted_password) VALUES
 ('00000000-0000-0000-0000-0000000017a1','o@t.invalid','authenticated','authenticated','h0'),
 ('00000000-0000-0000-0000-0000000017a2','m@t.invalid','authenticated','authenticated','h0'),
 ('00000000-0000-0000-0000-0000000017a3','s1@t.invalid','authenticated','authenticated','h0'),
 ('00000000-0000-0000-0000-0000000017a5','s2@t.invalid','authenticated','authenticated','h0');
UPDATE profiles SET role='admin',active=true WHERE id='00000000-0000-0000-0000-0000000017a1';
UPDATE profiles SET role='manager',active=true WHERE id='00000000-0000-0000-0000-0000000017a2';
UPDATE profiles SET role='staff',active=true WHERE id IN ('00000000-0000-0000-0000-0000000017a3','00000000-0000-0000-0000-0000000017a5');
INSERT INTO clients(id,name,phone,created_by,assigned_to) VALUES
 ('00000000-0000-0000-0000-0000000017c1','Mine','0300','00000000-0000-0000-0000-0000000017a2','00000000-0000-0000-0000-0000000017a3'),
 ('00000000-0000-0000-0000-0000000017c2','Other','0301','00000000-0000-0000-0000-0000000017a2','00000000-0000-0000-0000-0000000017a5');
INSERT INTO quotations(id,quotation_number,client_id,transaction_type,status,subtotal_govt,grand_total,created_by) VALUES
 ('00000000-0000-0000-0000-0000000017d1','QA','00000000-0000-0000-0000-0000000017c1','transfer','approved',1000,1000,'00000000-0000-0000-0000-0000000017a2'),
 ('00000000-0000-0000-0000-0000000017d2','QB','00000000-0000-0000-0000-0000000017c2','transfer','approved',9000,9000,'00000000-0000-0000-0000-0000000017a2');
INSERT INTO payments(quotation_id,amount,payment_method,payment_date,created_by) VALUES
 ('00000000-0000-0000-0000-0000000017d1',400,'cash',lb_today(),'00000000-0000-0000-0000-0000000017a2'),
 ('00000000-0000-0000-0000-0000000017d2',5000,'cash',lb_today(),'00000000-0000-0000-0000-0000000017a2');
INSERT INTO client_payments(client_id,amount,payment_method,payment_date,created_by) VALUES
 ('00000000-0000-0000-0000-0000000017c1',100,'cash',lb_today(),'00000000-0000-0000-0000-0000000017a2'),
 ('00000000-0000-0000-0000-0000000017c2',700,'cash',lb_today(),'00000000-0000-0000-0000-0000000017a2');
INSERT INTO expenses(category,amount,created_by) VALUES ('rent',777,'00000000-0000-0000-0000-0000000017a2');
INSERT INTO password_resets(user_id,temp_hash) VALUES ('00000000-0000-0000-0000-0000000017a3','h0');
UPDATE profiles SET must_change_password=true WHERE id='00000000-0000-0000-0000-0000000017a3';

CREATE TEMP TABLE r(n text, ok boolean);
GRANT ALL ON r TO PUBLIC;
CREATE FUNCTION pg_temp.as_(u text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  RESET ROLE; PERFORM set_config('request.jwt.claims', CASE WHEN u='anon' THEN '' ELSE '{"sub":"00000000-0000-0000-0000-0000000017'||u||'","role":"authenticated"}' END, true);
  IF u='anon' THEN SET LOCAL ROLE anon; ELSE SET LOCAL ROLE authenticated; END IF; END $$;
CREATE FUNCTION pg_temp.cnt(q text) RETURNS bigint LANGUAGE plpgsql AS $$ DECLARE n bigint; BEGIN EXECUTE 'SELECT count(*) FROM ('||q||') x' INTO n; RETURN n; END $$;
CREATE FUNCTION pg_temp.blocked(q text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE q; EXCEPTION WHEN OTHERS THEN RETURN true; END; RETURN false; END $$;

SELECT pg_temp.as_('a3');
INSERT INTO r SELECT 'M14-1 staff sees only payments of own customers (1 of 2)', pg_temp.cnt('SELECT 1 FROM payments') = 1;
INSERT INTO r SELECT 'M14-2 staff sees only own customers on-account payments (1 of 2)', pg_temp.cnt('SELECT 1 FROM client_payments') = 1;
INSERT INTO r SELECT 'M14-3 staff sees no expenses', pg_temp.cnt('SELECT 1 FROM expenses') = 0;
INSERT INTO r SELECT 'M14-4 staff cannot read the temp-password fingerprints', pg_temp.blocked('SELECT * FROM password_resets');
INSERT INTO r SELECT 'M14-5 staff cannot call lb_mark_password_reset', pg_temp.blocked($q$SELECT lb_mark_password_reset('00000000-0000-0000-0000-0000000017a5','00000000-0000-0000-0000-0000000017a3')$q$);
INSERT INTO r SELECT 'M14-6 staff cannot switch the must-change flag off directly', pg_temp.blocked($q$UPDATE profiles SET must_change_password=false WHERE id='00000000-0000-0000-0000-0000000017a3'$q$);
INSERT INTO r SELECT 'M14-7 staff cannot flag someone else to change password', pg_temp.blocked($q$UPDATE profiles SET must_change_password=true WHERE id='00000000-0000-0000-0000-0000000017a5'$q$);
INSERT INTO r SELECT 'M14-8 clear_must_change_password does NOT clear while the password is still the temporary one', (SELECT clear_must_change_password()) = false;
SELECT pg_temp.as_('a2');
INSERT INTO r SELECT 'M14-9 manager sees all payments (2)', pg_temp.cnt('SELECT 1 FROM payments') = 2;
INSERT INTO r SELECT 'M14-10 manager sees all on-account payments (2)', pg_temp.cnt('SELECT 1 FROM client_payments') = 2;
SELECT pg_temp.as_('a1');
INSERT INTO r SELECT 'M14-11 owner sees all payments (2) and expenses (1)', pg_temp.cnt('SELECT 1 FROM payments') = 2 AND pg_temp.cnt('SELECT 1 FROM expenses') = 1;
SELECT pg_temp.as_('anon');
INSERT INTO r SELECT 'M14-12 anon cannot read payments / profiles / call the reset functions', pg_temp.blocked('SELECT 1 FROM payments') AND pg_temp.blocked('SELECT 1 FROM profiles') AND pg_temp.blocked('SELECT clear_must_change_password()') AND pg_temp.blocked($q$SELECT lb_mark_password_reset('00000000-0000-0000-0000-0000000017a5',NULL)$q$);
RESET ROLE; SELECT set_config('request.jwt.claims','',true);
-- the person really changes their password (encrypted_password differs from the temporary one) -> flag can be cleared
UPDATE auth.users SET encrypted_password='new-own-hash' WHERE id='00000000-0000-0000-0000-0000000017a3';
SELECT pg_temp.as_('a3');
INSERT INTO r SELECT 'M14-13 after the password really changed the flag clears', (SELECT clear_must_change_password()) = true;
RESET ROLE; SELECT set_config('request.jwt.claims','',true);
INSERT INTO r SELECT 'M14-14 flag is off and the fingerprint row is gone', NOT (SELECT must_change_password FROM profiles WHERE id='00000000-0000-0000-0000-0000000017a3') AND NOT EXISTS (SELECT 1 FROM password_resets WHERE user_id='00000000-0000-0000-0000-0000000017a3');
SELECT (CASE WHEN ok THEN 'PASS ' ELSE 'FAIL ' END)||n FROM r ORDER BY n;
ROLLBACK;
