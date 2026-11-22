import { pkToday } from './time';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { DEFAULT_PUNJAB_RATES, pickRateSet, type PunjabRates, type RateSetRow } from './punjabRates';
import { DEFAULT_ICT_RATES, pickIctRateSet, type IctRates, type IctRateSetRow } from './ictRates';

export interface LoadedRates { rates: PunjabRates; source: 'database' | 'built-in'; problems: string[]; loading: boolean; }

/** Loads the Punjab rate set in force today. Never throws: on any problem the built-in defaults are used and the reason is reported. */
export async function loadPunjabRates(onDate = pkToday()): Promise<Omit<LoadedRates, 'loading'>> {
  try {
    const { data, error } = await supabase.from('punjab_rate_sets').select('*').eq('status', 'active');
    if (error) return { rates: DEFAULT_PUNJAB_RATES, source: 'built-in', problems: [] }; // table not created yet: defaults are fine
    const r = pickRateSet((data as RateSetRow[]) ?? [], onDate);
    return { rates: r.rates, source: r.source, problems: r.problems };
  } catch {
    return { rates: DEFAULT_PUNJAB_RATES, source: 'built-in', problems: [] };
  }
}

export function usePunjabRates(): LoadedRates {
  const [state, setState] = useState<LoadedRates>({ rates: DEFAULT_PUNJAB_RATES, source: 'built-in', problems: [], loading: true });
  useEffect(() => { let on = true; loadPunjabRates().then(r => on && setState({ ...r, loading: false })); return () => { on = false; }; }, []);
  return state;
}

export interface LoadedIctRates { rates: IctRates; source: 'database' | 'built-in'; problems: string[]; loading: boolean; }

/** Loads the Islamabad rate set in force today. Never throws: on any problem the built-in defaults are used and the reason is reported. */
export async function loadIctRates(onDate = pkToday()): Promise<Omit<LoadedIctRates, 'loading'>> {
  try {
    const { data, error } = await supabase.from('ict_rate_sets').select('*').eq('status', 'active');
    if (error) return { rates: DEFAULT_ICT_RATES, source: 'built-in', problems: [] }; // table not created yet: defaults are fine
    const r = pickIctRateSet((data as IctRateSetRow[]) ?? [], onDate);
    return { rates: r.rates, source: r.source, problems: r.problems };
  } catch {
    return { rates: DEFAULT_ICT_RATES, source: 'built-in', problems: [] };
  }
}

export function useIctRates(): LoadedIctRates {
  const [state, setState] = useState<LoadedIctRates>({ rates: DEFAULT_ICT_RATES, source: 'built-in', problems: [], loading: true });
  useEffect(() => { let on = true; loadIctRates().then(r => on && setState({ ...r, loading: false })); return () => { on = false; }; }, []);
  return state;
}
