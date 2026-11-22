// UI smoke test: loads the built app against a MOCKED Supabase (no real database), at phone and desktop width,
// opens every main screen and fails on a crash, console error or horizontal scroll. Run: node scripts/smoke_ui.cjs
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const URL_ = 'http://127.0.0.1:4173', SB = 'http://127.0.0.1:54321';
const routes = ['dashboard','calculator','quotations','clients','cases','vehicles','tasks','reminders','inventory','receipts','reports','hpa','transfers','form-f','settings','audit','users'];
(async () => {
  const srv = spawn('npx', ['vite', 'preview', '--port', '4173', '--host', '127.0.0.1'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 3000));
  const browser = await chromium.launch(); let fails = 0;
  for (const [name, vp] of [['phone', { width: 390, height: 800 }], ['desktop', { width: 1366, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport: vp, hasTouch: name === 'phone' });
    const uid = '00000000-0000-0000-0000-000000000001';
    const session = { access_token: 'x.y.z', refresh_token: 'r', token_type: 'bearer', expires_in: 99999, expires_at: Math.floor(Date.now() / 1000) + 99999, user: { id: uid, email: 'owner@test', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' } };
    await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch {} }, ['sb-127-auth-token', JSON.stringify(session)]);
    await ctx.route(SB + '/**', async route => {
      const u = route.request().url(); const h = route.request().headers();
      const single = /object/.test(h['accept'] || '');
      if (u.includes('/rest/v1/profiles')) return route.fulfill({ json: single ? { id: uid, full_name: 'Test Owner', role: 'admin', status: 'active', email: 'owner@test' } : [{ id: uid, full_name: 'Test Owner', role: 'admin', status: 'active' }], headers: { 'content-range': '0-0/1' } });
      if (u.includes('/auth/v1/user')) return route.fulfill({ json: session.user });
      if (u.includes('/rest/v1/rpc/')) return route.fulfill({ json: [] });
      return route.fulfill({ json: single ? null : [], headers: { 'content-range': '*/0' } });
    });
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
    for (const r of routes) {
      errs.length = 0;
      await page.goto('about:blank'); await page.goto(`${URL_}/#${r}`); await page.waitForTimeout(900);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      const title = await page.title(); const expected = r === 'form-f' ? 'Form F' : null; const hasMain = await page.locator('main#main').count();
      const bad = errs.length || overflow || !hasMain;
      console.log(`${bad ? 'FAIL' : 'PASS'} ${name} #${r} title="${title}"${overflow ? ' HORIZONTAL-SCROLL' : ''}${!hasMain ? ' NO-MAIN' : ''} ${errs.join(' | ')}`);
      if (bad) fails++;
    }
    await ctx.close();
  }
  await browser.close(); srv.kill(); process.exit(fails ? 1 : 0);
})();
