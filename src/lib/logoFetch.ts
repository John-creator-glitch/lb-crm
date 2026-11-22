import { logoToDataUrl } from './settings';

// Pulls the official logo from https://liaqatbrothers.com/ in the user's own browser and returns it as a data URL (so it can be stored and printed on PDFs).
// 1) direct download (works if the website allows it)  2) the same public image through the images.weserv.nl image proxy (adds the CORS header the website lacks).
// Only the public logo address is sent to the proxy.
const SITE = 'https://liaqatbrothers.com';
export const LOGO_CANDIDATES = [
  `${SITE}/wp-content/uploads/2026/03/cropped-LIAQAT-BROTERS-UPDATED-LOGO-scaled-2.png`,        // full-size header logo
  `${SITE}/wp-content/uploads/2026/03/cropped-LIAQAT-BROTERS-UPDATED-LOGO-scaled-2-72x71.png`,  // header logo as shown on the site (small)
  `${SITE}/wp-content/uploads/2026/02/cropped-cropped-LIAQAT-BROTERS-LOGO-scaled-1-270x270.png`, // site icon
];

async function download(url: string): Promise<Blob | null> {
  const attempts = [url, `https://images.weserv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ''))}&output=png`];
  for (const u of attempts) {
    try {
      const r = await fetch(u, { mode: 'cors', cache: 'no-store' });
      if (!r.ok) continue;
      const b = await r.blob();
      if (b.type.startsWith('image/') && b.size > 500) return b;
    } catch { /* try next */ }
  }
  return null;
}

/** Returns the largest logo that could be downloaded, or null. */
export async function fetchWebsiteLogo(): Promise<string | null> {
  let best: { url: string; px: number } | null = null;
  for (const u of LOGO_CANDIDATES) {
    const blob = await download(u);
    if (!blob) continue;
    try {
      const bmp = await createImageBitmap(blob);
      const px = Math.max(bmp.width, bmp.height);
      if (!best || px > best.px) best = { url: await logoToDataUrl(blob), px };
      if (px >= 300) break; // good enough
    } catch { /* not a readable image */ }
  }
  return best?.url ?? null;
}
