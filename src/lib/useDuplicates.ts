import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { NO_DUPLICATES, worthChecking, type DuplicateResult } from '@/lib/duplicates';

export interface DupInput { phone?: string | null; cnic?: string | null; registration?: string | null; chassis?: string | null; excludeClient?: string | null; excludeVehicle?: string | null }

/** Asks the database (find_duplicates) while the user types, after a short pause. Never blocks anything: it only returns what to warn about. */
export function useDuplicates(input: DupInput): { result: DuplicateResult; checking: boolean; unavailable: boolean } {
  const [result, setResult] = useState<DuplicateResult>(NO_DUPLICATES);
  const [checking, setChecking] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const key = JSON.stringify([input.phone, input.cnic, input.registration, input.chassis, input.excludeClient, input.excludeVehicle]);

  useEffect(() => {
    if (!worthChecking(input)) { setResult(NO_DUPLICATES); setChecking(false); return; }
    let cancelled = false;
    setChecking(true);
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('find_duplicates', {
        p_phone: input.phone || null, p_cnic: input.cnic || null, p_registration: input.registration || null, p_chassis: input.chassis || null,
        p_exclude_client: input.excludeClient || null, p_exclude_vehicle: input.excludeVehicle || null,
      });
      if (cancelled) return;
      setChecking(false);
      if (error || !data) { setUnavailable(true); setResult(NO_DUPLICATES); return; } // migration not run yet: no warning, nothing blocked
      setUnavailable(false);
      setResult(data as DuplicateResult);
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { result, checking, unavailable };
}

/** "Warn, then let the person decide": the first Save with duplicates present only asks for confirmation; the next Save goes through.
 *  The confirmation is forgotten as soon as the list of duplicates changes (the person edited the phone, for example). */
export function useDupAck(result: DuplicateResult): { needsConfirm: boolean; confirm: () => void } {
  const key = JSON.stringify(result);
  const [acked, setAcked] = useState('');
  const has = result.clients.length > 0 || result.vehicles.length > 0;
  return { needsConfirm: has && acked !== key, confirm: () => setAcked(key) };
}
