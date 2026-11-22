import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { DEFAULT_SETTINGS, type BusinessSettings } from './brand';

export { DEFAULT_SETTINGS, type BusinessSettings } from './brand';

const KEY = 'business';
let cache: BusinessSettings | null = null;
export const getCachedSettings = () => cache ?? DEFAULT_SETTINGS;

const merge = (v: Partial<BusinessSettings> | null | undefined): BusinessSettings => {
  const s = { ...DEFAULT_SETTINGS, ...(v ?? {}) } as BusinessSettings;
  if (!s.logo_data_url) s.logo_data_url = DEFAULT_SETTINGS.logo_data_url; // saved row with no logo -> keep the bundled Liaqat Brothers logo
  if (!Array.isArray(s.service_presets)) s.service_presets = DEFAULT_SETTINGS.service_presets;
  // old default name is now "Service Charges" at Rs 5,000
  s.service_presets = s.service_presets.map(p => (p.label === 'Agency Service Charges' ? { label: 'Service Charges', amount: 5000 } : p));
  if (!Array.isArray(s.field_presets) || s.field_presets.length === 0) s.field_presets = DEFAULT_SETTINGS.field_presets;
  return s;
};

/** Never throws. If the table is missing or unreachable the defaults are used. */
export async function loadSettings(force = false): Promise<BusinessSettings> {
  if (cache && !force) return cache;
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', KEY).maybeSingle();
    cache = merge(data?.value as Partial<BusinessSettings> | undefined);
  } catch { cache = merge(null); }
  return cache;
}

export async function saveSettings(s: BusinessSettings): Promise<string | null> {
  const { error } = await supabase.from('app_settings').upsert({ key: KEY, value: s, updated_at: new Date().toISOString() });
  if (error) return error.message;
  cache = s;
  window.dispatchEvent(new Event('lb-settings'));
  return null;
}

export function useSettings(): BusinessSettings {
  const [s, setS] = useState<BusinessSettings>(cache ?? DEFAULT_SETTINGS);
  useEffect(() => {
    let on = true;
    loadSettings().then(v => on && setS(v));
    const h = () => cache && on && setS(cache);
    window.addEventListener('lb-settings', h);
    return () => { on = false; window.removeEventListener('lb-settings', h); };
  }, []);
  return s;
}

/** Shrinks an uploaded logo to at most 480px and returns a PNG data URL (keeps the settings row small). */
export async function logoToDataUrl(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}
