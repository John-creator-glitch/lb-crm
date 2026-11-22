import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { envOk } from '@/lib/supabase';
import './index.css';

// open the connection to the database while the page is still loading (saves a round-trip on slow mobile networks)
try {
  const u = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (u) { const l = document.createElement('link'); l.rel = 'preconnect'; l.href = new URL(u).origin; l.crossOrigin = ''; document.head.appendChild(l); }
} catch { /* optional */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {envOk ? <App /> : (
      <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 560, margin: '12vh auto', padding: 24, lineHeight: 1.6 }}>
        <h1 style={{ fontSize: 22 }}>Setup missing: database keys not found</h1>
        <p>This app needs two settings before it can start.</p>
        <p><b>On your computer:</b> in the project folder make a file named <code>.env</code> (copy <code>.env.example</code>) and fill in <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (Supabase, Project Settings, API). Then stop and run <code>npm run dev</code> again.</p>
        <p><b>On Vercel:</b> Project, Settings, Environment Variables: add the same two, then Redeploy.</p>
      </div>
    )}
  </StrictMode>
);

// Installable app on phones (works only on the live https site, not in `npm run dev`)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* app works without it */ }); });
}
