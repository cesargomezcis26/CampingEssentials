const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    const filename = path.resolve(root, `.${new URL(req.url, 'http://localhost').pathname}`);
    if (!filename.startsWith(`${root}${path.sep}`)) { res.writeHead(403).end(); return; }
    fs.readFile(filename, (error, data) => {
      if (error) { res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.CHROMIUM_EXECUTABLE || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  const owner = '11111111-1111-4111-8111-111111111111';
  const tripId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const jwt = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated', aud: 'authenticated', email: 'owner@example.invalid' })).toString('base64url'),
    'test-signature'
  ].join('.');
  const user = { id: owner, aud: 'authenticated', role: 'authenticated', email: 'owner@example.invalid', email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() };
  let claims = [{ item_key: 'tents', user_id: owner, display_name: '<img src=x onerror=alert(1)>', claimed_at: new Date().toISOString() }];
  let holdClaims = false;
  let releaseClaims;
  let claimsRequested;
  let claimsRequestSeen = new Promise(resolve => { claimsRequested = resolve; });

  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fjjnmksglgepvxvhxpoc.supabase.co/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    let body = {};
    try { body = req.postDataJSON() || {}; } catch { /* GET and DELETE requests have no JSON body. */ }
    let data;
    let status = 200;

    if (url.pathname === '/auth/v1/otp') data = {};
    else if (url.pathname === '/auth/v1/verify') data = { access_token: jwt, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
    else if (url.pathname === '/auth/v1/logout') data = {};
    else if (url.pathname === '/rest/v1/campwell_trips') {
      data = req.headers().accept?.includes('object')
        ? { id: tripId, name: 'Test camp', owner_id: owner, created_at: new Date().toISOString() }
        : [{ id: tripId, name: 'Test camp', owner_id: owner, created_at: new Date().toISOString() }];
    } else if (url.pathname === '/rest/v1/campwell_claims') {
      if (req.method() === 'GET') {
        if (holdClaims) { claimsRequested(); await new Promise(resolve => { releaseClaims = resolve; }); }
        data = claims;
      } else if (req.method() === 'POST') {
        const claim = { item_key: body.item_key, user_id: body.user_id, display_name: body.display_name, claimed_at: new Date().toISOString() };
        claims.push(claim);
        data = claim;
      } else if (req.method() === 'DELETE') {
        const itemKey = new URLSearchParams(url.search).get('item_key')?.replace('eq.', '');
        const deleted = claims.filter(claim => claim.item_key === itemKey);
        claims = claims.filter(claim => claim.item_key !== itemKey);
        data = deleted.map(claim => ({ item_key: claim.item_key }));
      }
    } else if (url.pathname === '/rest/v1/campwell_invitations') {
      data = null;
      status = 201;
    } else throw new Error(`Unexpected request ${req.method()} ${url.pathname}`);
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.route('**/supabase-config.js', route => route.fulfill({ contentType: 'text/javascript', body: "window.CAMPWELL_SUPABASE={url:'https://fjjnmksglgepvxvhxpoc.supabase.co',publishableKey:'sb_publishable_test'}" }));
  await page.route('**/vendor/supabase.js', route => route.fulfill({ contentType: 'text/javascript', body: `${fs.readFileSync(path.join(root, 'vendor/supabase.js'), 'utf8')};{const create=window.supabase.createClient;window.supabase={...window.supabase,createClient:(...args)=>{const client=create(...args);window.__testClient=client;return client;}}}` }));

  await page.goto(`${base}/planning.html`);
  assert.equal(await page.evaluate(() => typeof window.Motion?.animate), 'function');
  assert(await page.evaluate(() => document.getAnimations().length > 0));
  assert.equal(await page.locator('select').count(), 0);
  assert(await page.locator('#planner-login').isVisible());

  await page.evaluate(() => {
    window.__securityViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.__securityViolations.push(event.effectiveDirective));
    const script = document.createElement('script'); script.textContent = 'window.__inlineExecuted=true'; document.head.append(script);
    const remote = document.createElement('script'); remote.src = 'https://attacker.invalid/test.js'; document.head.append(remote);
    const button = document.createElement('button'); button.setAttribute('onclick', 'window.__handlerExecuted=true'); document.body.append(button); button.click(); button.remove();
  });
  await page.waitForFunction(() => window.__securityViolations.length >= 3);
  assert.equal(await page.evaluate(() => Boolean(window.__inlineExecuted || window.__handlerExecuted)), false);

  await page.locator('#signin-email').fill('owner@example.invalid');
  await page.locator('#email-form button').click();
  await page.locator('#signin-code').fill('123456');
  await page.locator('#code-form button').click();
  await page.locator('#claim-board').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#board-title').textContent(), 'Test camp');
  assert.equal(await page.locator('#claimed-items .claim-item').count(), 1);
  assert.equal(await page.locator('#needed-items .claim-item').count(), 23);
  for (const itemKey of ['napkins', 'sodas', 'desserts']) {
    assert.equal(await page.locator(`[data-item-key="${itemKey}"]`).count(), 1);
  }
  assert.equal(await page.locator('#claimed-items img').count(), 0);
  assert((await page.locator('#claimed-items .claim-item p').textContent()).includes('<img src=x'));

  await page.locator('#display-name').fill('Cesar');
  await page.locator('[data-item-key="grill"] button').click();
  await page.waitForFunction(() => document.querySelector('#claimed-count').textContent === '2');
  assert.equal(claims.find(claim => claim.item_key === 'grill').display_name, 'Cesar');
  assert.equal(await page.evaluate(() => localStorage.getItem('starcamp-display-name')), 'Cesar');

  await page.locator('[data-item-key="grill"] button').click();
  await page.waitForFunction(() => document.querySelector('#claimed-count').textContent === '1');
  assert.equal(claims.some(claim => claim.item_key === 'grill'), false);

  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const result = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      navigationVisible: [...document.querySelectorAll('nav a')].every(link => link.getBoundingClientRect().height >= 44)
    }));
    assert.equal(result.overflow, false, `planning page overflow at ${width}px`);
    assert.equal(result.navigationVisible, true, `navigation hidden at ${width}px`);
  }

  await page.locator('#change-trip').click();
  holdClaims = true;
  await page.locator('#trip-list button').click();
  await claimsRequestSeen;
  await page.evaluate(() => window.__testClient.auth.signOut({ scope: 'local' }));
  await page.locator('#planner-login').waitFor({ state: 'visible' });
  holdClaims = false;
  releaseClaims();
  await page.waitForTimeout(50);
  assert.equal(await page.locator('#claim-board').isVisible(), false);
  assert.equal(await page.locator('#board-title').textContent(), '');
  assert.equal(await page.locator('#claimed-items .claim-item').count(), 0);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.includes('auth-token'))), false);

  await page.route('**/storage/v1/object/public/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/vYQAAAAASUVORK5CYII=', 'base64') }));
  for (const file of ['index.html', 'campsites.html', 'planning.html']) {
    await page.goto(`${base}/${file}`);
    assert((await page.title()).includes('Starcamp'));
    assert(await page.locator('meta[http-equiv="Content-Security-Policy"]').count());
    assert.equal(await page.locator('meta[name="referrer"]').getAttribute('content'), 'no-referrer');
    if (file === 'index.html') {
      assert((await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).includes("media-src 'self' https://fjjnmksglgepvxvhxpoc.supabase.co"));
      assert.equal(await page.locator('.hero-video').count(), 0);
      assert(await page.locator('.hero-fallback').isVisible());
    }
  }
  await page.route('**/hero-video-config.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: "window.STARCAMP_HERO_VIDEO={src:'https://fjjnmksglgepvxvhxpoc.supabase.co/storage/v1/object/public/campsitePictures/Campsite_Videos/test.mp4'}"
  }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  assert.equal(await page.locator('.hero-video').count(), 0);
  assert.deepEqual(pageErrors, []);
  console.log('PASS: login gate, automatic trip opening, no dropdowns, safe claim rendering, claim/release flow, Motion CSP/reduced-motion behavior, sign-out race protection, and responsive layout.');

  await browser.close();
  await new Promise(resolve => server.close(resolve));
})().catch(error => { console.error(error); process.exit(1); });
