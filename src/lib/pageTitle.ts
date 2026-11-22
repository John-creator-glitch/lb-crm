import { useEffect } from 'react';
const BASE = 'Liaqat Brothers CRM';
/** Sets the browser tab title (also used by screen readers and browser history). */
export function usePageTitle(title: string | undefined | null) {
  useEffect(() => {
    document.title = title ? `${title} · ${BASE}` : BASE;
  }, [title]);
}
