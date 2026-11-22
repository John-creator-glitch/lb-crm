#!/bin/sh
# Builds supabase/setup_complete.sql = every migration in order, for a brand new Supabase project.
cd "$(dirname "$0")"
OUT=supabase/setup_complete.sql
{
  echo "-- Liaqat Brothers: COMPLETE database setup for a NEW Supabase project."
  echo "-- Run this ONE file in Supabase > SQL Editor > New query > Run. Safe to run again."
  echo "-- Then open the app, register your own account FIRST: it becomes the Owner automatically."
  echo
  for f in $(ls supabase/migrations/*.sql | sort); do
    echo "-- ===================================================================="
    echo "-- $(basename $f)"
    echo "-- ===================================================================="
    cat "$f"; echo; echo
  done
} > "$OUT"
echo "wrote $OUT"
