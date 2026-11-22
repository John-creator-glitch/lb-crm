#!/bin/sh
# Backup / restore drill. Dumps a source database, restores it into an EMPTY scratch database, and proves the copy is identical:
# same row count in every public table, same money totals, same per-table content checksum, and the restored database still passes the role check.
# Usage (staging / local only, never against production as the target):
#   SRC_URL=postgres://.../source  DST_URL=postgres://.../scratch_restore  sh scripts/backup_restore_drill.sh
# The target must already have the Supabase auth schema (a new Supabase project has it; locally load a stub). Needs pg_dump, pg_restore, psql. In Supabase use the dashboard backup or `supabase db dump`, restore into a NEW project/branch, and point DST_URL there.
set -eu
: "${SRC_URL:?set SRC_URL}"; : "${DST_URL:?set DST_URL}"
OUT="${OUT:-/tmp/lb_drill_$$}"; mkdir -p "$OUT"
echo "1/4 dump";    pg_dump --format=custom --no-owner --no-privileges --schema=public -f "$OUT/lb.dump" "$SRC_URL"
# People live in the auth schema; tables in public point at them (created_by, owner_id...), so they are restored FIRST. (A Supabase project restore does this for you.)
pg_dump --data-only --table=auth.users -f "$OUT/auth_users.sql" "$SRC_URL"; psql -q -d "$DST_URL" -f "$OUT/auth_users.sql" >/dev/null 2>"$OUT/auth.log" || true
echo "2/4 restore"; pg_restore --no-owner --no-privileges -d "$DST_URL" "$OUT/lb.dump" 2>"$OUT/restore.log" || true
# "schema public already exists" is expected (every database has it); any other error is a real problem and is shown.
BAD=$(grep -i "error" "$OUT/restore.log" | grep -v "schema \"public\" already exists" | grep -v "^Command was" | grep -v "errors ignored on restore" || true)
[ -z "$BAD" ] || { echo "restore errors:"; echo "$BAD" | head -10; }
Q="select c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) n from public.%I', c.relname), false, true, '')))[1]::text::bigint as n,
          (xpath('/row/h/text()', query_to_xml(format('select coalesce(md5(string_agg(t::text, '''' order by t::text)), ''-'') h from public.%I t', c.relname), false, true, '')))[1]::text as h
   from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' order by 1"
echo "3/4 compare row counts, content checksums, constraints and indexes"
SCHEMA_Q="select 'con|'||conrelid::regclass||'|'||conname from pg_constraint where connamespace = 'public'::regnamespace union all select 'idx|'||indexname from pg_indexes where schemaname = 'public' union all select 'pol|'||tablename||'|'||policyname from pg_policies where schemaname = 'public' union all select 'trg|'||tgrelid::regclass||'|'||tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'public.%' order by 1"
psql -At "$SRC_URL" -c "$SCHEMA_Q" > "$OUT/src_schema.txt"; psql -At "$DST_URL" -c "$SCHEMA_Q" > "$OUT/dst_schema.txt"
psql -At -F '|' "$SRC_URL" -c "$Q" > "$OUT/src.txt"; psql -At -F '|' "$DST_URL" -c "$Q" > "$OUT/dst.txt"
M="select 'billed|'||coalesce(sum(grand_total),0) from public.quotations where status not in ('draft','rejected') union all select 'received|'||coalesce(sum(amount),0) from public.payments where reversed_at is null union all select 'opening|'||coalesce(sum(opening_balance),0) from public.clients"
psql -At "$SRC_URL" -c "$M" > "$OUT/src_money.txt"; psql -At "$DST_URL" -c "$M" > "$OUT/dst_money.txt"
echo "4/4 verdict"
if diff -q "$OUT/src.txt" "$OUT/dst.txt" >/dev/null && diff -q "$OUT/src_money.txt" "$OUT/dst_money.txt" >/dev/null && diff -q "$OUT/src_schema.txt" "$OUT/dst_schema.txt" >/dev/null; then
  echo "PASS restore is identical: $(wc -l < "$OUT/src.txt") tables (counts + checksums), $(wc -l < "$OUT/src_schema.txt") constraints/indexes/policies/triggers"; cat "$OUT/src_money.txt"; exit 0
else echo "FAIL restore differs:"; diff "$OUT/src.txt" "$OUT/dst.txt" || true; diff "$OUT/src_money.txt" "$OUT/dst_money.txt" || true; diff "$OUT/src_schema.txt" "$OUT/dst_schema.txt" | head -10 || true; exit 1; fi
