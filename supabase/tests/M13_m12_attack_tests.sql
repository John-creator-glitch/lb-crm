\set ON_ERROR_STOP off
BEGIN;
SET client_min_messages = warning;
INSERT INTO auth.users (id,email,role,aud) VALUES
 ('00000000-0000-0000-0000-0000000013a1','o@t.invalid','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000013a2','m@t.invalid','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000013a3','s@t.invalid','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000013a4','p@t.invalid','authenticated','authenticated');
UPDATE profiles SET role='admin',active=true WHERE id='00000000-0000-0000-0000-0000000013a1';
UPDATE profiles SET role='manager',active=true WHERE id='00000000-0000-0000-0000-0000000013a2';
UPDATE profiles SET role='staff',active=true WHERE id='00000000-0000-0000-0000-0000000013a3';
UPDATE profiles SET role='staff',active=false WHERE id='00000000-0000-0000-0000-0000000013a4';
INSERT INTO clients (id,name,phone,created_by) VALUES ('00000000-0000-0000-0000-0000000013c1','Victim','0300','00000000-0000-0000-0000-0000000013a2'),('00000000-0000-0000-0000-0000000013c2','Other','0301','00000000-0000-0000-0000-0000000013a2');
INSERT INTO leads (id,name,phone,notes,created_by) VALUES ('00000000-0000-0000-0000-0000000013b1','L1','0300','secret note','00000000-0000-0000-0000-0000000013a2');
CREATE OR REPLACE FUNCTION pg_temp.atk(u text, stmt text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE n bigint; BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN u='anon' THEN '' ELSE '{"sub":"00000000-0000-0000-0000-0000000013'||u||'","role":"authenticated"}' END, true);
  EXECUTE 'RESET ROLE'; IF u='anon' THEN EXECUTE 'SET LOCAL ROLE anon'; ELSE EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
  BEGIN EXECUTE stmt; GET DIAGNOSTICS n = ROW_COUNT; RAISE EXCEPTION USING ERRCODE='P0099', MESSAGE='rb';
  EXCEPTION WHEN OTHERS THEN IF SQLSTATE='P0099' THEN RESET ROLE; PERFORM set_config('request.jwt.claims','',true); RETURN 'SUCCEEDED rows='||n; END IF; RESET ROLE; PERFORM set_config('request.jwt.claims','',true); RETURN 'BLOCKED: '||left(SQLERRM,70); END;
END $f$;
\o /dev/null
CREATE TEMP TABLE r(n text, v boolean);
\o
INSERT INTO r SELECT 'M13-X1 mgr inserts expense pre-voided w/ fake voided_by', pg_temp.atk('a2', $$INSERT INTO expenses(category,amount,voided_at,voided_by,void_reason) VALUES ('rent',500,now(),'00000000-0000-0000-0000-0000000013a1','x')$$) LIKE 'SUCCEEDED%';
INSERT INTO r SELECT 'M13-X2 mgr backdates expense created_at', pg_temp.atk('a2', $$INSERT INTO expenses(category,amount,created_at) VALUES ('rent',500,now()-interval '300 days')$$) LIKE 'SUCCEEDED%';
INSERT INTO r SELECT 'M13-X3 mgr expense_date infinity', pg_temp.atk('a2', $$INSERT INTO expenses(category,amount,expense_date) VALUES ('rent',5,'infinity')$$) LIKE 'BLOCKED%';
INSERT INTO r SELECT 'M13-X4 staff backdates crm_activity created_at', pg_temp.atk('a3', $$INSERT INTO crm_activities(lead_id,note,created_at) VALUES ('00000000-0000-0000-0000-0000000013b1','called',now()-interval '90 days')$$) LIKE 'SUCCEEDED%';
INSERT INTO r SELECT 'M13-X5 staff spoofs activity created_by', pg_temp.atk('a3', $$INSERT INTO crm_activities(lead_id,note,created_by) VALUES ('00000000-0000-0000-0000-0000000013b1','called','00000000-0000-0000-0000-0000000013a1')$$) LIKE 'SUCCEEDED%';
INSERT INTO r SELECT 'M13-X6 staff next_follow_up=infinity on lead', pg_temp.atk('a3', $$UPDATE leads SET next_follow_up='infinity'$$) LIKE 'BLOCKED%';
INSERT INTO r SELECT 'M13-X7 staff rewrites lead created_at/by', pg_temp.atk('a3', $$UPDATE leads SET created_at=now()-interval '400 days', created_by='00000000-0000-0000-0000-0000000013a1'$$) LIKE 'SUCCEEDED%';
INSERT INTO r SELECT 'M13-X8 pending (inactive) user reads leads', pg_temp.atk('a4', $$SELECT * FROM leads$$) LIKE 'SUCCEEDED%';
INSERT INTO r SELECT 'M13-X9 pending user inserts lead', pg_temp.atk('a4', $$INSERT INTO leads(name) VALUES ('x')$$) LIKE 'BLOCKED%';
INSERT INTO r SELECT 'M13-X10 staff doc row pointing to other client folder', pg_temp.atk('a3', $$INSERT INTO client_documents(client_id,file_name,storage_path,mime_type,size_bytes) VALUES ('00000000-0000-0000-0000-0000000013c1','a.pdf','00000000-0000-0000-0000-0000000013c2/a.pdf','application/pdf',10)$$) LIKE 'BLOCKED%';
INSERT INTO r SELECT 'M13-X11 staff doc row with ../ in path', pg_temp.atk('a3', $$INSERT INTO client_documents(client_id,file_name,storage_path,mime_type,size_bytes) VALUES ('00000000-0000-0000-0000-0000000013c1','a.pdf','00000000-0000-0000-0000-0000000013c1/../x.pdf','application/pdf',10)$$) LIKE 'BLOCKED%';
INSERT INTO r SELECT 'M13-X12 staff doc mime text/html', pg_temp.atk('a3', $$INSERT INTO client_documents(client_id,file_name,storage_path,mime_type,size_bytes) VALUES ('00000000-0000-0000-0000-0000000013c1','a.html','00000000-0000-0000-0000-0000000013c1/a.html','text/html',10)$$) LIKE 'BLOCKED%';
INSERT INTO r SELECT 'M13-X13 staff doc file_name with <script>', pg_temp.atk('a3', $$INSERT INTO client_documents(client_id,file_name,storage_path,mime_type,size_bytes) VALUES ('00000000-0000-0000-0000-0000000013c1','<img src=x onerror=alert(1)>.pdf','00000000-0000-0000-0000-0000000013c1/a.pdf','application/pdf',10)$$) LIKE 'SUCCEEDED%';
INSERT INTO r SELECT 'M13-X14 staff edits message template', pg_temp.atk('a3', $$UPDATE message_templates SET body='pay to 0300-EVIL'$$) LIKE 'SUCCEEDED%';
INSERT INTO r SELECT 'M13-X15 mgr edits message template', pg_temp.atk('a2', $$UPDATE message_templates SET body='pay to 0300-EVIL'$$) LIKE 'SUCCEEDED%';
INSERT INTO r SELECT 'M13-X16 staff reads audit_logs', pg_temp.atk('a3', $$SELECT * FROM audit_logs$$) LIKE 'SUCCEEDED%';
INSERT INTO r SELECT 'M13-X17 staff void_expense', pg_temp.atk('a3', $$SELECT void_expense(gen_random_uuid(),'x')$$) LIKE 'BLOCKED%';
INSERT INTO r SELECT 'M13-X18 staff expense_summary', pg_temp.atk('a3', $$SELECT expense_summary(lb_today()-30,lb_today())$$) LIKE 'BLOCKED%';
INSERT INTO r SELECT 'M13-X19 anon crm_kpis', pg_temp.atk('anon', $$SELECT crm_kpis(lb_today()-30,lb_today())$$) LIKE 'BLOCKED%';
INSERT INTO r SELECT 'M13-X20 pending user convert_lead', pg_temp.atk('a4', $$SELECT convert_lead_to_client('00000000-0000-0000-0000-0000000013b1')$$) LIKE 'BLOCKED%';
INSERT INTO r SELECT 'M13-X21 staff convert_lead (twice same client)', pg_temp.atk('a3', $$SELECT convert_lead_to_client('00000000-0000-0000-0000-0000000013b1')$$) LIKE 'SUCCEEDED%';
INSERT INTO r SELECT 'M13-X22 staff deletes lead', pg_temp.atk('a3', $$DELETE FROM leads$$) LIKE 'SUCCEEDED%';
INSERT INTO r SELECT 'M13-X23 staff deletes client_documents', pg_temp.atk('a3', $$DELETE FROM client_documents$$) LIKE 'SUCCEEDED%';
INSERT INTO r SELECT 'M13-X24 staff sets vehicles.token_tax_due=infinity', pg_temp.atk('a3', $$UPDATE vehicles SET token_tax_due='infinity'$$) LIKE 'SUCCEEDED%';
INSERT INTO r SELECT 'M13-X25 staff lead name 120+ / notes 2001', pg_temp.atk('a3', $$INSERT INTO leads(name,notes) VALUES ('x', repeat('a',2001))$$) LIKE 'BLOCKED%';
INSERT INTO r SELECT 'M13-X26 anon select/insert leads', pg_temp.atk('anon', $$SELECT * FROM leads$$) LIKE 'BLOCKED%';
INSERT INTO r SELECT 'M13-X27 staff insert expense', pg_temp.atk('a3', $$INSERT INTO expenses(category,amount) VALUES ('rent',1)$$) LIKE 'BLOCKED%';
INSERT INTO r SELECT 'M13-X28 staff TRUNCATE leads', pg_temp.atk('a3', $$TRUNCATE leads$$) LIKE 'BLOCKED%';
INSERT INTO r SELECT 'M13-X29 lead status won without reason / lost without reason', pg_temp.atk('a3', $$UPDATE leads SET status='lost'$$) LIKE 'BLOCKED%';
INSERT INTO r SELECT 'M13-X30 mgr expense amount 99999999.99 (cap 1e8)', pg_temp.atk('a2', $$INSERT INTO expenses(category,amount) VALUES ('other',99999999.99)$$) LIKE 'SUCCEEDED%';
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000013a2","role":"authenticated"}',true); SET LOCAL ROLE authenticated;
  INSERT INTO expenses(id,category,amount,voided_at,voided_by,void_reason,created_at) VALUES ('00000000-0000-0000-0000-0000000013e1','rent',5,now(),'00000000-0000-0000-0000-0000000013a1','x',now()-interval '300 days');
  PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000013a3","role":"authenticated"}',true);
  INSERT INTO crm_activities(id,lead_id,note,created_by,created_at) VALUES ('00000000-0000-0000-0000-0000000013d1','00000000-0000-0000-0000-0000000013b1','n','00000000-0000-0000-0000-0000000013a1',now()-interval '90 days');
  UPDATE leads SET created_by='00000000-0000-0000-0000-0000000013a3', created_at=now()-interval '400 days';
  RESET ROLE; PERFORM set_config('request.jwt.claims','',true);
  INSERT INTO r SELECT 'M13-S1 forged expense is stored live, stamped now, no fake voider', voided_at IS NULL AND voided_by IS NULL AND created_at > now()-interval '1 day' FROM expenses WHERE id='00000000-0000-0000-0000-0000000013e1';
  INSERT INTO r SELECT 'M13-S2 activity time and author cannot be forged', created_by='00000000-0000-0000-0000-0000000013a3' AND created_at > now()-interval '1 day' FROM crm_activities WHERE id='00000000-0000-0000-0000-0000000013d1';
  INSERT INTO r SELECT 'M13-S3 lead creation time/author cannot be rewritten', created_by='00000000-0000-0000-0000-0000000013a2' AND created_at > now()-interval '1 day' FROM leads WHERE id='00000000-0000-0000-0000-0000000013b1';
END $$;
-- values neutralised by triggers: stored result must be clean
SELECT set_config('request.jwt.claims','',true);
SELECT (CASE WHEN v THEN 'PASS ' ELSE 'FAIL ' END)||n FROM r ORDER BY n;
ROLLBACK;
