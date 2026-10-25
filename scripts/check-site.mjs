// Read-only check of the public site: npm run check:site -- https://YOUR-SITE
//
// Run it from your own computer with the address Vercel shows under
// Project → Settings → Domains. It needs no secrets, creates no accounts and
// signs nobody in. Exit code 1 means something must be fixed.
//
// Checks: the page is this app with the headers from vercel.json, http://
// redirects to https://, /healthz and /api reach the Railway backend, the
// backend accepts this site's requests, cookies are Secure/HttpOnly, requests from
// other sites are refused, and Google Safe Browsing's status for the host.

const arg = process.argv[2] || '';
let site;
try {
  site = new URL(arg);
  if (site.protocol !== 'https:' || site.pathname !== '/') throw new Error();
} catch {
  console.error('Usage: npm run check:site -- https://your-site.example (the https:// address only, no path)');
  process.exit(1);
}
const base = site.origin;
let failures = 0;
const ok = (msg) => console.log(`  ✔ ${msg}`);
const warn = (msg) => console.log(`  ⚠ ${msg}`);
const fail = (msg) => (failures++, console.log(`  ✖ ${msg}`));
const section = (title) => console.log(`\n${title}`);
const get = (path, init = {}) => fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(20000), ...init });
const viaRailway = (res) => res.headers.has('x-railway-request-id') || /railway/i.test(res.headers.get('server') || '');
// A JSON POST as the browser on this site would send it.
const post = (path, body, origin = base) =>
  get(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });

async function step(title, fn) {
  section(title);
  try {
    await fn();
  } catch (err) {
    fail(`Couldn’t complete this check (${err.cause?.code || err.message})`);
  }
}

console.log(`Checking ${base}`);

await step('Frontend (Vercel)', async () => {
  const res = await get('/');
  const html = await res.text();
  if (res.status !== 200) return fail(`/ answered ${res.status}${res.headers.get('location') ? ` (redirect to ${res.headers.get('location')})` : ''}`);
  if (/<title>First Job AI — Get hired for your first job<\/title>/.test(html)) ok('The page is the First Job AI app from this repository');
  else fail(`The page title is "${html.match(/<title>(.*?)<\/title>/)?.[1] || 'missing'}": this is NOT this app. Check the domain in Vercel.`);
  if (/vercel/i.test(res.headers.get('server') || '')) ok('Served by Vercel');
  else warn(`Server header is "${res.headers.get('server') || 'none'}", not Vercel`);
  if ((res.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'")) ok('Security headers from vercel.json are live');
  else fail('No Content-Security-Policy from vercel.json: the deployment is not built from the latest stripe-billing commit');
  const route = await get('/dashboard');
  if (route.status === 200 && /<div id="root">/.test(await route.text())) ok('App routes like /dashboard load the app (single-page rewrite works)');
  else fail(`/dashboard answered ${route.status}`);
});

await step('HTTPS', async () => {
  const res = await fetch(`http://${site.host}/`, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  const to = res.headers.get('location') || '';
  if (res.status >= 300 && res.status < 400 && to.startsWith(`https://${site.host}`)) ok(`http:// redirects to https:// (${res.status})`);
  else fail(`http:// answered ${res.status}${to ? ` → ${to}` : ''} instead of redirecting to https://${site.host}`);
  // fetch() only connects if the certificate is valid for this host.
  ok('The TLS certificate is valid for this host');
});

await step('Backend forwarding (Railway)', async () => {
  const health = await get('/healthz');
  const text = (await health.text()).trim();
  if (health.status === 200 && text === 'ok') ok('/healthz answers "ok" through this domain (backend and database are up)');
  else if (/<html/i.test(text)) fail('/healthz returned the app page: the /healthz rewrite in vercel.json is not deployed');
  else fail(`/healthz answered ${health.status}: ${text.slice(0, 80)}`);
  if (viaRailway(health)) ok('The answer came from Railway');
  const me = await get('/api/auth/me');
  const body = await me.json().catch(() => null);
  if (me.status === 200 && body && 'user' in body) ok('/api/* reaches the backend (GET /api/auth/me answered as a guest)');
  else fail(`/api/auth/me answered ${me.status}${body ? '' : ' without JSON (the /api rewrite is not deployed?)'}`);
  if (body?.passwordReset === 'email') ok('Password-reset email is set up');
  else if (body) warn(`Password reset is "${body.passwordReset}" (needs RESEND_API_KEY, EMAIL_FROM and APP_URL on Railway)`);
});

await step('Request protection', async () => {
  // An empty sign-in: 400 means the backend accepts this site as the origin
  // (via APP_URL or its own host name). It can't prove APP_URL by itself:
  // compare APP_URL in Railway's Variables tab with this address too.
  const same = await post('/api/auth/signin', {});
  if (same.status === 400) ok(`The backend accepts sign-in requests from ${base}`);
  else if (same.status === 403) fail(`The backend refused a request from ${base}: set APP_URL on Railway to exactly ${base} (no trailing slash), then redeploy`);
  else fail(`Sign-in check answered ${same.status}`);
  console.log(`  • Also check by eye: Railway → backend → Variables → APP_URL must be exactly ${base}`);
  const cross = await post('/api/auth/signin', {}, 'https://other-site.example');
  if (cross.status === 403) ok('Requests from other websites are refused');
  else fail(`A request from another website answered ${cross.status} instead of 403`);
});

await step('Cookies', async () => {
  // Signing out without a session only clears the (absent) cookie, so the flags can be read safely.
  const res = await post('/api/auth/signout', {});
  const cookie = res.headers.get('set-cookie') || '';
  if (!cookie) return fail(`Sign-out answered ${res.status} without a cookie`);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax']) {
    if (cookie.includes(flag)) ok(`Session cookie is ${flag}`);
    else fail(`Session cookie is missing ${flag}${flag === 'Secure' ? ' (is NODE_ENV=production on Railway, and COOKIE_SECURE not "false"?)' : ''}`);
  }
});

await step('Google Safe Browsing', async () => {
  // The same lookup the Transparency Report page makes. Unofficial: use it as a hint and confirm on the page.
  const res = await fetch(`https://transparencyreport.google.com/transparencyreport/api/v3/safebrowsing/status?site=${site.host}`, { signal: AbortSignal.timeout(20000) });
  const status = JSON.parse((await res.text()).replace(/^\)\]\}'/, ''))?.[0]?.[1];
  const meaning = { 1: 'no unsafe content found', 2: 'UNSAFE: Google lists this site as dangerous', 3: 'UNSAFE: some pages are listed as dangerous', 4: 'check a specific URL (too general to rate)', 6: 'no data available (not listed)' }[status];
  if (status === 2 || status === 3) fail(meaning);
  else console.log(`  • Status ${status}: ${meaning || 'unknown code'}`);
  console.log(`  • Confirm at https://transparencyreport.google.com/safe-browsing/search?url=${site.host}`);
});

console.log(`\n${failures ? `✖ ${failures} problem(s) must be fixed.` : '✔ All checks passed.'}`);
process.exit(failures ? 1 : 0);
