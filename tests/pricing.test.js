// Pricing page, upgrade banner and checkout return pages, rendered for real
// with React in a simulated browser (jsdom). JSX is compiled by Vite. Only
// fetch() and the final jump to Stripe are replaced, so these tests check what
// a user sees and which server endpoints the buttons call.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173/pricing', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true, writable: true });
}
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let vite, React, act, createRoot, MemoryRouter, Routes, Route, Pricing, UpgradeBanner, BillingSuccess, BillingCancel, billingLib;

before(async () => {
  vite = await createServer({
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    esbuild: { jsx: 'automatic' },
  });
  React = await import('react');
  ({ act } = React);
  ({ createRoot } = await import('react-dom/client'));
  ({ MemoryRouter, Routes, Route } = await import('react-router-dom'));
  ({ default: Pricing, UpgradeBanner } = await vite.ssrLoadModule('/src/pages/Pricing.jsx'));
  ({ BillingSuccess, BillingCancel } = await vite.ssrLoadModule('/src/pages/Billing.jsx'));
  billingLib = await vite.ssrLoadModule('/src/lib/billing.js');
});

after(async () => {
  await vite?.close();
  dom.window.close();
});

const PRICES = { month: { amount: 999, currency: 'usd' }, year: { amount: 7900, currency: 'usd' } };
const status = (over = {}) => ({
  configured: true,
  testMode: true,
  prices: PRICES,
  aiLimits: { free: 20, premium: 200 },
  signedIn: true,
  plan: 'free',
  canManage: false,
  subscription: null,
  ...over,
});

// Fake server: routes maps "METHOD /path" to a response body or (body) => [status, body].
function fakeServer(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method, url, body });
    const handler = routes[`${method} ${url}`];
    if (!handler) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    const [code, data] = typeof handler === 'function' ? handler(body) : [200, handler];
    return new Response(JSON.stringify(data), { status: code, headers: { 'content-type': 'application/json' } });
  };
  return calls;
}

// Renders a page and returns helpers to query and click it.
async function render(element, { path = '/pricing' } = {}) {
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  const root = createRoot(container);
  const opened = [];
  billingLib.browser.open = (url) => opened.push(url);
  await act(async () => {
    root.render(React.createElement(MemoryRouter, { initialEntries: [path] }, element));
  });
  await settle();
  const text = () => container.textContent.replace(/\s+/g, ' ');
  const button = (re) => [...container.querySelectorAll('button, a')].find((b) => re.test(b.textContent));
  const click = async (el) => {
    await act(async () => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    await settle();
  };
  return { container, text, button, click, opened, unmount: () => act(async () => root.unmount()) };
}

const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)));
const page = () => React.createElement(Pricing);

test('pricing page: a signed-in Free user sees both plans, real prices and a Subscribe button', async () => {
  fakeServer({ 'GET /api/billing/status': status() });
  const view = await render(page());
  const t = view.text();
  assert.match(t, /Free/);
  assert.match(t, /\$0/);
  assert.match(t, /Premium/);
  assert.match(t, /\$9\.99 \/ month/);
  assert.match(t, /20 AI requests a month/);
  assert.match(t, /200 AI requests a month instead of 20/);
  assert.match(t, /Your current plan/);
  assert.match(t, /Test mode: no real charges/);
  const subscribe = view.button(/Subscribe monthly/);
  assert.ok(subscribe, 'the Subscribe button is visible to a Free user with no subscription');
  assert.equal(subscribe.disabled, false);
  await view.unmount();
});

test('pricing page: monthly/yearly selection changes the price, and Subscribe calls checkout and opens Stripe', async () => {
  const calls = fakeServer({
    'GET /api/billing/status': status(),
    'POST /api/billing/checkout': () => [200, { url: 'https://checkout.stripe.com/c/pay/cs_test_123' }],
  });
  const view = await render(page());
  await view.click(view.button(/Yearly/));
  assert.match(view.text(), /\$79\.00 \/ year/);
  assert.match(view.text(), /save 34%/);
  await view.click(view.button(/Subscribe yearly/));
  const checkout = calls.find((c) => c.url === '/api/billing/checkout');
  assert.deepEqual(checkout, { method: 'POST', url: '/api/billing/checkout', body: { interval: 'year' } }, 'only the interval is sent, never a price');
  assert.deepEqual(view.opened, ['https://checkout.stripe.com/c/pay/cs_test_123']);
  assert.match(view.text(), /Opening secure checkout/);

  await view.unmount();
  const monthly = fakeServer({ 'GET /api/billing/status': status(), 'POST /api/billing/checkout': () => [200, { url: 'https://checkout.stripe.com/c/pay/cs_test_9' }] });
  const again = await render(page());
  await again.click(again.button(/Subscribe monthly/));
  assert.deepEqual(monthly.at(-1).body, { interval: 'month' });
  await again.unmount();
});

test('pricing page: checkout errors are shown and the button works again', async () => {
  fakeServer({
    'GET /api/billing/status': status(),
    'POST /api/billing/checkout': () => [503, { error: 'The monthly price isn’t set up correctly in Stripe, so checkout is paused.', code: 'billing_unavailable' }],
  });
  const view = await render(page());
  await view.click(view.button(/Subscribe monthly/));
  const alert = view.container.querySelector('[role="alert"]');
  assert.match(alert.textContent, /monthly price isn’t set up correctly/);
  assert.equal(view.button(/Subscribe monthly/).disabled, false);
  assert.deepEqual(view.opened, [], 'nothing was opened');
  await view.unmount();
});

test('pricing page: a checkout address that isn’t Stripe is never opened', async () => {
  fakeServer({ 'GET /api/billing/status': status(), 'POST /api/billing/checkout': () => [200, { url: 'https://evil.example/pay' }] });
  const view = await render(page());
  await view.click(view.button(/Subscribe monthly/));
  assert.deepEqual(view.opened, []);
  assert.match(view.container.querySelector('[role="alert"]').textContent, /payment page address looked wrong/);
  await view.unmount();
});

test('pricing page: guests are asked to sign in instead of subscribing', async () => {
  const calls = fakeServer({ 'GET /api/billing/status': status({ signedIn: false, plan: null }) });
  const view = await render(page());
  assert.ok(view.button(/Sign in to subscribe/));
  assert.equal(view.button(/Subscribe monthly/), undefined);
  assert.ok(!calls.some((c) => c.url === '/api/billing/checkout'));
  await view.unmount();
});

test('pricing page: when payments aren’t configured, the plans still show with an explanation', async () => {
  fakeServer({ 'GET /api/billing/status': status({ configured: false, testMode: false, prices: { month: null, year: null } }) });
  const view = await render(page());
  assert.match(view.text(), /Premium/);
  assert.match(view.text(), /Payments aren’t set up on this server yet/);
  assert.equal(view.button(/^Subscribe$/).disabled, true);
  await view.unmount();
});

test('pricing page: Premium users see their plan and can open the billing portal', async () => {
  const calls = fakeServer({
    'GET /api/billing/status': status({ plan: 'premium', canManage: true, subscription: { status: 'active', interval: 'month' } }),
    'POST /api/billing/portal': () => [200, { url: 'https://billing.stripe.com/p/session/test_1' }],
  });
  const view = await render(page());
  assert.match(view.text(), /You’re on Premium/);
  assert.equal(view.button(/Subscribe/), undefined, 'no second subscription');
  await view.click(view.button(/Manage subscription/));
  assert.ok(calls.some((c) => c.method === 'POST' && c.url === '/api/billing/portal'));
  assert.deepEqual(view.opened, ['https://billing.stripe.com/p/session/test_1']);
  await view.unmount();
});

test('pricing page: a failed status request shows the error and a retry button', async () => {
  fakeServer({ 'GET /api/billing/status': () => [500, { error: 'Server unavailable' }] });
  const view = await render(page());
  assert.match(view.text(), /Plans couldn’t be loaded \(Server unavailable\)/);
  assert.ok(view.button(/Try again/));
  await view.unmount();
});

test('dashboard banner: shown to signed-in Free users, hidden for Premium', async () => {
  fakeServer({ 'GET /api/billing/status': status() });
  let view = await render(React.createElement(UpgradeBanner));
  assert.match(view.text(), /200 AI requests a month instead of 20/);
  assert.equal(view.button(/Upgrade to Premium/).getAttribute('href'), '/pricing');
  await view.unmount();

  fakeServer({ 'GET /api/billing/status': status({ plan: 'premium', subscription: { status: 'active' } }) });
  view = await render(React.createElement(UpgradeBanner));
  assert.equal(view.text(), '');
  await view.unmount();
});

test('success page: Premium is shown only after the server confirms it with Stripe', async () => {
  const calls = fakeServer({ 'POST /api/billing/sync': (body) => [200, { ...status({ plan: 'premium' }), checkoutComplete: true, got: body }] });
  const routes = React.createElement(Routes, null, React.createElement(Route, { path: '/billing/success', element: React.createElement(BillingSuccess) }));
  const view = await render(routes, { path: '/billing/success?session_id=cs_test_abc' });
  assert.deepEqual(calls[0], { method: 'POST', url: '/api/billing/sync', body: { sessionId: 'cs_test_abc' } });
  assert.match(view.text(), /Welcome to Premium/);
  await view.unmount();

  fakeServer({ 'POST /api/billing/sync': () => [403, { error: 'That checkout session belongs to another account.', code: 'forbidden' }] });
  const denied = await render(routes, { path: '/billing/success?session_id=cs_test_other' });
  assert.match(denied.text(), /We couldn’t confirm your payment here/);
  assert.match(denied.text(), /belongs to another account/);
  assert.doesNotMatch(denied.text(), /Welcome to Premium/);
  await denied.unmount();
});

test('cancel page: says nothing was charged and links back to the plans', async () => {
  fakeServer({});
  const view = await render(React.createElement(BillingCancel));
  assert.match(view.text(), /You weren’t charged/);
  assert.equal(view.button(/Back to plans/).getAttribute('href'), '/pricing');
  await view.unmount();
});
