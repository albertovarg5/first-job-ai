// Stripe billing: checkout, portal, webhooks and Premium entitlement.
// Stripe's API is replaced by an in-memory fake, but webhook signatures are
// created and checked with the real Stripe SDK, so signature verification is
// tested for real. No network calls, no real keys, no charges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import Stripe from 'stripe';
import { createApi } from '../server/api.js';
import { billingConfig } from '../server/billing.js';
import { grantsPremium, subscriptionFields } from '../server/billingStore.js';
import { checkConfig } from '../server/config.js';
import { clientIp, httpsRedirect, proxySettings } from '../server/http.js';
import { MIGRATIONS, openDatabase } from '../server/db.js';
import { call, jsonResponse, withFetch } from './helpers.js';

const WEBHOOK_SECRET = 'whsec_test_secret';
const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  STRIPE_PRICE_MONTHLY: 'price_month',
  STRIPE_PRICE_YEARLY: 'price_year',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  AI_FREE_MONTHLY_LIMIT: '2',
  AI_PREMIUM_MONTHLY_LIMIT: '4',
};
const DAY = 86400000;
const realStripe = new Stripe('sk_test_signature_only');
const cookieFrom = (res) => String(res.headers['set-cookie'] || '').split(';')[0];
const notFound = () => Object.assign(new Error('No such object'), { code: 'resource_missing', type: 'StripeInvalidRequestError' });

// In-memory stand-in for the parts of the Stripe API the app uses.
function fakeStripe() {
  const state = { customers: [], subs: new Map(), sessions: new Map(), charges: new Map(), invoicePayments: new Map(), expired: [], canceled: [], retrieves: 0, failCancel: false, checkoutUrl: null };
  return {
    state,
    webhooks: realStripe.webhooks,
    charges: {
      async retrieve(id) {
        if (!state.charges.has(id)) throw notFound();
        return structuredClone(state.charges.get(id));
      },
    },
    // payment_intent id -> the invoice it paid (expanded, as the app requests).
    invoicePayments: {
      async list({ payment }) {
        const invoice = state.invoicePayments.get(payment.payment_intent);
        return { data: invoice ? [{ id: `inpay_${invoice.id}`, invoice: structuredClone(invoice) }] : [] };
      },
    },
    customers: {
      async create(params, opts) {
        const c = { id: `cus_${state.customers.length + 1}`, ...params };
        state.customers.push({ params, opts, id: c.id });
        return c;
      },
    },
    prices: {
      async retrieve(id) {
        const year = id === 'price_year';
        return { id, livemode: state.livePrices?.includes(id) || false, active: !state.inactivePrices?.includes(id), type: 'recurring', recurring: { interval: year ? 'year' : 'month' }, unit_amount: year ? 9900 : 999, currency: 'usd' };
      },
    },
    checkout: {
      sessions: {
        async list({ customer, status }) {
          return { data: [...state.sessions.values()].filter((s) => s.customer === customer && s.status === status) };
        },
        async expire(id) {
          state.sessions.get(id).status = 'expired';
          state.expired.push(id);
        },
        async create(params) {
          const id = `cs_test_${state.sessions.size + 1}`;
          const s = { id, object: 'checkout.session', url: state.checkoutUrl || `https://checkout.stripe.com/c/pay/${id}`, status: 'open', subscription: null, ...params };
          state.sessions.set(id, s);
          return s;
        },
        async retrieve(id) {
          if (!state.sessions.has(id)) throw notFound();
          return structuredClone(state.sessions.get(id));
        },
      },
    },
    billingPortal: {
      sessions: {
        async create(p) {
          if (state.portalUnconfigured) {
            throw Object.assign(new Error('No configuration provided and your test mode default configuration has not been created.'), { type: 'StripeInvalidRequestError' });
          }
          state.portalSessions = [...(state.portalSessions || []), p];
          return { url: 'https://billing.stripe.com/p/session/test_123', ...p };
        },
      },
    },
    subscriptions: {
      async retrieve(id) {
        state.retrieves += 1;
        if (!state.subs.has(id)) throw notFound();
        return structuredClone(state.subs.get(id));
      },
      async cancel(id) {
        if (state.failCancel) throw Object.assign(new Error('Stripe is down'), { type: 'StripeAPIError' });
        state.canceled.push(id);
        state.subs.get(id).status = 'canceled';
        return state.subs.get(id);
      },
    },
  };
}

// A Stripe Subscription object as the current API returns it (period end on the item).
function subscription({ id = 'sub_1', customer = 'cus_1', price = 'price_month', status = 'active', periodEnd, cancelAtPeriodEnd = false }) {
  return {
    id,
    object: 'subscription',
    customer,
    status,
    cancel_at_period_end: cancelAtPeriodEnd,
    cancel_at: cancelAtPeriodEnd ? periodEnd : null,
    canceled_at: null,
    ended_at: status === 'canceled' ? Math.floor(Date.now() / 1000) : null,
    items: { data: [{ price: { id: price, recurring: { interval: price === 'price_year' ? 'year' : 'month' } }, current_period_end: periodEnd }] },
  };
}

async function setup(envOverrides = {}) {
  const db = await openDatabase(':memory:');
  const stripe = fakeStripe();
  const logs = [];
  const log = { info: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)) };
  const clock = { now: Date.now() };
  const api = createApi({ ...ENV, ...envOverrides }, { db, stripe, log, now: () => new Date(clock.now) });
  let ip = 0;
  const signUp = async (email) => {
    ip += 1;
    const res = await call(api, 'POST', '/auth/signup', { email, password: `${email} long passphrase` }, { ip: `10.1.0.${ip}` });
    return { cookie: cookieFrom(res), id: res.body.user.id };
  };
  const as = (user) => ({ headers: { cookie: user.cookie } });
  const status = async (user) => (await call(api, 'GET', '/billing/status', undefined, user ? as(user) : {})).body;
  const webhook = (event, { secret = WEBHOOK_SECRET, signature, payload } = {}) => {
    const body = payload ?? JSON.stringify(event);
    const header = signature ?? realStripe.webhooks.generateTestHeaderString({ payload: body, secret });
    return call(api, 'POST', '/billing/webhook', body, { headers: { 'stripe-signature': header } });
  };
  // Completes a checkout the way Stripe would: a subscription now exists for the customer.
  const pay = async (user, { price = 'price_month', subId = `sub_${user.id.slice(0, 6)}`, status: subStatus = 'active' } = {}) => {
    const res = await call(api, 'POST', '/billing/checkout', { interval: price === 'price_year' ? 'year' : 'month' }, as(user));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const sessionId = res.body.url.split('/').pop();
    const session = stripe.state.sessions.get(sessionId);
    stripe.state.subs.set(subId, subscription({ id: subId, customer: session.customer, price, status: subStatus, periodEnd: Math.floor((clock.now + 30 * DAY) / 1000) }));
    Object.assign(session, { status: 'complete', subscription: subId });
    return { sessionId, subId, session };
  };
  const event = (type, object, id = `evt_${Math.random().toString(36).slice(2)}`) => ({ id, object: 'event', type, created: Math.floor(clock.now / 1000), data: { object } });
  return { api, db, stripe, logs, clock, signUp, as, status, webhook, pay, event };
}

// ---------- Configuration ----------

test('billing config: needs a secret key, webhook secret and a real monthly Price ID', () => {
  assert.equal(billingConfig({}).configured, false);
  assert.equal(billingConfig(ENV).configured, true);
  assert.equal(billingConfig(ENV).testMode, true);
  assert.equal(billingConfig({ ...ENV, STRIPE_PRICE_MONTHLY: 'prod_123' }).configured, false, 'a product id is not a price id');
  assert.equal(billingConfig({ ...ENV, STRIPE_WEBHOOK_SECRET: '' }).configured, false);
  assert.equal(billingConfig({ ...ENV, STRIPE_PRICE_YEARLY: '' }).prices.year, null, 'yearly is optional');
  assert.deepEqual([...billingConfig({ ...ENV, STRIPE_EXTRA_PREMIUM_PRICES: 'price_old, nope' }).premiumPrices], ['price_month', 'price_year', 'price_old']);
});

test('live mode safety lock: a live key takes no payments until STRIPE_ALLOW_LIVE=true', () => {
  const live = { ...ENV, STRIPE_SECRET_KEY: 'sk_live_fake' };
  assert.equal(billingConfig(live).configured, false);
  assert.equal(billingConfig(live).liveBlocked, true);
  assert.equal(billingConfig({ ...live, STRIPE_ALLOW_LIVE: 'false' }).configured, false);
  assert.equal(billingConfig({ ...live, STRIPE_ALLOW_LIVE: 'true' }).configured, true);
  assert.equal(billingConfig({ ...live, STRIPE_ALLOW_LIVE: 'true' }).testMode, false);
  assert.equal(billingConfig(ENV).liveBlocked, false, 'test keys need no unlock');

  const locked = checkConfig({ ...live, NODE_ENV: 'production', APP_URL: 'https://app.example.com' });
  assert.equal(locked.features.billing, 'locked (live key without STRIPE_ALLOW_LIVE)');
  assert.ok(locked.warnings.some((w) => w.includes('STRIPE_ALLOW_LIVE')));
  const on = checkConfig({ ...live, STRIPE_ALLOW_LIVE: 'true', NODE_ENV: 'production', APP_URL: 'https://app.example.com' });
  assert.equal(on.features.billing, 'LIVE');
  assert.deepEqual(on.errors, []);
  const plainHttp = checkConfig({ ...live, STRIPE_ALLOW_LIVE: 'true', NODE_ENV: 'production', APP_URL: 'http://app.example.com' });
  assert.ok(plainHttp.errors.some((e) => e.includes('https://')), 'live payments refuse to start without HTTPS');
});

test('https: production requests that arrived over http are redirected to APP_URL', () => {
  const env = { NODE_ENV: 'production', APP_URL: 'https://app.example.com/' };
  const req = (proto, url = '/settings?x=1', host = 'evil.example') => ({ url, headers: { 'x-forwarded-proto': proto, host } });
  assert.equal(httpsRedirect(req('http'), env), 'https://app.example.com/settings?x=1', 'never uses the Host header');
  assert.equal(httpsRedirect(req('http, https'), env), 'https://app.example.com/settings?x=1');
  assert.equal(httpsRedirect(req('https'), env), null);
  assert.equal(httpsRedirect(req(undefined), env), null, 'no proxy header: nothing to decide on');
  assert.equal(httpsRedirect(req('http'), { ...env, NODE_ENV: 'development' }), null);
  assert.equal(httpsRedirect(req('http'), { ...env, COOKIE_SECURE: 'false' }), null);
  assert.equal(httpsRedirect(req('http'), { ...env, APP_URL: 'http://app.example.com' }), null);
});

test('checkout: invalid price configuration turns Premium off instead of charging the wrong price', async () => {
  const { api, signUp, as, status } = await setup({ STRIPE_PRICE_MONTHLY: 'prod_wrong' });
  const user = await signUp('a@example.com');
  const res = await call(api, 'POST', '/billing/checkout', { interval: 'month' }, as(user));
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'billing_unavailable');
  assert.equal((await status(user)).configured, false);
});

// ---------- Checkout ----------

test('checkout: requires sign-in, and the server picks the price and the customer', async () => {
  const { api, stripe, signUp, as } = await setup();
  assert.equal((await call(api, 'POST', '/billing/checkout', { interval: 'month' })).status, 401);

  const user = await signUp('buyer@example.com');
  assert.equal((await call(api, 'POST', '/billing/checkout', { interval: 'weekly' }, as(user))).status, 400);

  // The browser can't choose the price, user or plan.
  const res = await call(api, 'POST', '/billing/checkout', { interval: 'month', price: 'price_cheap', userId: 'someone-else', plan: 'premium' }, as(user));
  assert.equal(res.status, 200);
  assert.match(res.body.url, /^https:\/\/checkout\.stripe\.com\//);
  const [session] = stripe.state.sessions.values();
  assert.deepEqual(session.line_items, [{ price: 'price_month', quantity: 1 }]);
  assert.equal(session.mode, 'subscription');
  assert.equal(session.client_reference_id, user.id);
  assert.equal(session.customer, 'cus_1');
  assert.match(session.success_url, /\/billing\/success\?session_id=\{CHECKOUT_SESSION_ID\}$/);
  assert.match(session.cancel_url, /\/billing\/cancel$/);
  assert.equal(stripe.state.customers[0].params.metadata.user_id, user.id);
  assert.equal(stripe.state.customers[0].opts.idempotencyKey, `fja-customer-${user.id}`);

  // A second click (or tab) reuses the customer and closes the first checkout.
  const yearly = await call(api, 'POST', '/billing/checkout', { interval: 'year' }, as(user));
  assert.equal(yearly.status, 200);
  assert.equal(stripe.state.customers.length, 1, 'one Stripe customer per user');
  assert.deepEqual(stripe.state.expired, [session.id]);
  assert.equal([...stripe.state.sessions.values()][1].line_items[0].price, 'price_year');
});

test('checkout: a price that isn’t an active recurring price in Stripe is never charged', async () => {
  const { api, stripe, signUp, as } = await setup();
  stripe.state.inactivePrices = ['price_year'];
  const user = await signUp('archived@example.com');
  const res = await call(api, 'POST', '/billing/checkout', { interval: 'year' }, as(user));
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'billing_unavailable');
  assert.match(res.body.error, /yearly price isn’t set up correctly/);
  assert.equal(stripe.state.sessions.size, 0, 'no checkout session was created');
  assert.equal((await call(api, 'POST', '/billing/checkout', { interval: 'month' }, as(user))).status, 200, 'monthly still works');
});

test('checkout: a price from the other Stripe mode (test vs live) is never charged', async () => {
  const { api, stripe, signUp, as, logs } = await setup();
  stripe.state.livePrices = ['price_month']; // a live price configured next to a test key
  const user = await signUp('mixed@example.com');
  const res = await call(api, 'POST', '/billing/checkout', { interval: 'month' }, as(user));
  assert.equal(res.status, 503);
  assert.equal(stripe.state.sessions.size, 0);
  assert.ok(logs.some((l) => l.includes('live-mode price but the key is test')));
});

test('client IP: a header set by the proxy wins over a forgeable X-Forwarded-For', () => {
  const req = { headers: { 'x-forwarded-for': '6.6.6.6, 1.2.3.4', 'cf-connecting-ip': '9.9.9.9' }, socket: { remoteAddress: '10.0.0.1' } };
  assert.equal(clientIp(req, proxySettings({})), '10.0.0.1', 'headers ignored by default');
  assert.equal(clientIp(req, proxySettings({ TRUST_PROXY: 'true' })), '6.6.6.6');
  assert.equal(clientIp(req, proxySettings({ TRUST_PROXY: 'true', CLIENT_IP_HEADER: 'CF-Connecting-IP' })), '9.9.9.9');
  assert.equal(clientIp({ ...req, headers: {} }, proxySettings({ CLIENT_IP_HEADER: 'cf-connecting-ip' })), '10.0.0.1', 'falls back when the header is missing');
  assert.equal(proxySettings({ CLIENT_IP_HEADER: 'bad header!' }).header, '');
});

test('production config: the database must be on persistent storage', () => {
  const prod = { NODE_ENV: 'production', APP_URL: 'https://app.example.com' };
  assert.ok(checkConfig(prod).warnings.some((w) => w.includes('DATABASE_PATH is not an absolute path')));
  assert.ok(checkConfig({ ...prod, DATABASE_PATH: 'data/x.db' }).warnings.some((w) => w.includes('DATABASE_PATH')));
  assert.ok(!checkConfig({ ...prod, DATABASE_PATH: '/var/data/first-job-ai.db' }).warnings.some((w) => w.includes('DATABASE_PATH')));
});

test('portal: needs sign-in and the user’s own Stripe customer, and explains a missing portal setup', async () => {
  const { api, stripe, signUp, pay, webhook, event, as, logs } = await setup();
  assert.equal((await call(api, 'POST', '/billing/portal', {})).status, 401);
  const stranger = await signUp('nobody@example.com');
  const none = await call(api, 'POST', '/billing/portal', {}, as(stranger));
  assert.equal(none.status, 404);
  assert.equal(none.body.code, 'no_billing_account');

  const user = await signUp('portal@example.com');
  const { session } = await pay(user);
  await webhook(event('checkout.session.completed', session));
  const ok = await call(api, 'POST', '/billing/portal', {}, as(user));
  assert.equal(ok.status, 200);
  assert.match(ok.body.url, /^https:\/\/billing\.stripe\.com\//);
  assert.equal(stripe.state.portalSessions.at(-1).customer, session.customer, 'opens the portal for this user’s customer only');

  stripe.state.portalUnconfigured = true;
  const missing = await call(api, 'POST', '/billing/portal', {}, as(user));
  assert.equal(missing.status, 503);
  assert.match(missing.body.error, /Subscription management isn’t set up yet/);
  assert.ok(logs.some((l) => l.includes('Customer portal')), 'the server log says what to set up in Stripe');
});

test('checkout: refuses to send users anywhere but Stripe Checkout', async () => {
  const { api, stripe, signUp, as } = await setup();
  stripe.state.checkoutUrl = 'https://evil.example/pay';
  const user = await signUp('c@example.com');
  const res = await call(api, 'POST', '/billing/checkout', { interval: 'month' }, as(user));
  assert.equal(res.status, 502);
  assert.equal(res.body.url, undefined);
});

// ---------- Webhooks ----------

test('webhook: unsigned, wrongly signed and tampered requests are rejected and change nothing', async () => {
  const { stripe, signUp, pay, webhook, event, status } = await setup();
  const user = await signUp('w@example.com');
  const { session } = await pay(user);
  const evt = event('checkout.session.completed', session);

  assert.equal((await webhook(evt, { signature: '' })).status, 400);
  assert.equal((await webhook(evt, { secret: 'whsec_attacker' })).status, 400);
  const good = JSON.stringify(evt);
  const header = realStripe.webhooks.generateTestHeaderString({ payload: good, secret: WEBHOOK_SECRET });
  assert.equal((await webhook(evt, { signature: header, payload: good.replace('complete', 'COMPLETE') })).status, 400, 'body changed after signing');
  assert.equal(stripe.state.retrieves, 0, 'nothing was looked up for a rejected event');
  assert.equal((await status(user)).plan, 'free');
});

test('webhook: successful subscription grants Premium once, duplicates are ignored', async () => {
  const { stripe, signUp, pay, webhook, event, status, logs } = await setup();
  const user = await signUp('happy@example.com');
  const { session } = await pay(user);
  assert.equal((await status(user)).plan, 'free', 'the redirect alone grants nothing');

  const evt = event('checkout.session.completed', session, 'evt_once');
  const first = await webhook(evt);
  assert.equal(first.status, 200);
  const s = await status(user);
  assert.equal(s.plan, 'premium');
  assert.equal(s.subscription.status, 'active');
  assert.equal(s.subscription.interval, 'month');
  assert.equal(s.canManage, true);

  const retrieves = stripe.state.retrieves;
  const again = await webhook(evt);
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(stripe.state.retrieves, retrieves, 'a duplicate is not processed again');
  assert.ok(!logs.join('\n').includes(session.success_url), 'event payloads are never logged');
});

test('webhook: out-of-order events use the current state from Stripe', async () => {
  const { stripe, signUp, pay, webhook, event, status } = await setup();
  const user = await signUp('order@example.com');
  const { subId } = await pay(user);
  // An old "incomplete" event arrives after the subscription is already active.
  const stale = { ...stripe.state.subs.get(subId), status: 'incomplete' };
  assert.equal((await webhook(event('customer.subscription.created', stale))).status, 200);
  assert.equal((await status(user)).plan, 'premium');
  assert.equal((await status(user)).subscription.status, 'active');
});

test('webhook: failed payment keeps Premium during Stripe retries, then ends it', async () => {
  const { stripe, clock, signUp, pay, webhook, event, status } = await setup();
  const user = await signUp('late@example.com');
  const { subId, session } = await pay(user);
  await webhook(event('checkout.session.completed', session));

  stripe.state.subs.get(subId).status = 'past_due';
  const invoice = { id: 'in_1', object: 'invoice', parent: { type: 'subscription_details', subscription_details: { subscription: subId } } };
  assert.equal((await webhook(event('invoice.payment_failed', invoice))).status, 200);
  let s = await status(user);
  assert.equal(s.subscription.status, 'past_due');
  assert.equal(s.plan, 'premium', 'short grace while Stripe retries the card');

  clock.now += 15 * DAY;
  assert.equal((await status(user)).plan, 'free', 'not past the past-due grace period');

  // Stripe gives up and marks it unpaid.
  stripe.state.subs.get(subId).status = 'unpaid';
  await webhook(event('customer.subscription.updated', stripe.state.subs.get(subId)));
  s = await status(user);
  assert.equal(s.plan, 'free');
  assert.equal(s.subscription.status, 'unpaid');
});

test('webhook: cancellation keeps Premium until the period ends, then removes it', async () => {
  const { api, stripe, clock, signUp, pay, webhook, event, status, as } = await setup();
  const user = await signUp('bye@example.com');
  const { subId, session } = await pay(user);
  await webhook(event('checkout.session.completed', session));

  // Canceled in the customer portal: active until the end of the period.
  Object.assign(stripe.state.subs.get(subId), { cancel_at_period_end: true });
  await webhook(event('customer.subscription.updated', stripe.state.subs.get(subId)));
  let s = await status(user);
  assert.equal(s.plan, 'premium');
  assert.equal(s.subscription.cancelAtPeriodEnd, true);

  // The period ends; Stripe deletes the subscription.
  clock.now += 31 * DAY;
  Object.assign(stripe.state.subs.get(subId), { status: 'canceled', ended_at: Math.floor(clock.now / 1000) });
  await webhook(event('customer.subscription.deleted', stripe.state.subs.get(subId)));
  s = await status(user);
  assert.equal(s.plan, 'free');
  assert.equal(s.subscription.status, 'canceled');

  // They can subscribe again later.
  assert.equal((await call(api, 'POST', '/billing/checkout', { interval: 'month' }, as(user))).status, 200);
});

test('refunds: a full refund of the latest payment ends Premium; partial or older refunds don’t', async () => {
  const { stripe, signUp, pay, webhook, event, status } = await setup();
  const user = await signUp('refund@example.com');
  const { subId, session } = await pay(user);
  await webhook(event('checkout.session.completed', session));
  const sub = stripe.state.subs.get(subId);
  sub.latest_invoice = 'in_2';
  stripe.state.invoicePayments.set('pi_old', { id: 'in_1', parent: { subscription_details: { subscription: subId } } });
  stripe.state.invoicePayments.set('pi_new', { id: 'in_2', parent: { subscription_details: { subscription: subId } } });
  const charge = (id, pi, refunded) => {
    const c = { id, object: 'charge', payment_intent: pi, refunded, amount: 999, amount_refunded: refunded ? 999 : 300 };
    stripe.state.charges.set(id, c);
    return c;
  };

  // Partial refund (a goodwill credit): still Premium.
  assert.equal((await webhook(event('charge.refunded', charge('ch_partial', 'pi_new', false)))).status, 200);
  assert.equal((await status(user)).plan, 'premium');
  // Full refund of an older month: the current paid period stands.
  assert.equal((await webhook(event('charge.refunded', charge('ch_old', 'pi_old', true)))).status, 200);
  assert.equal((await status(user)).plan, 'premium');
  assert.deepEqual(stripe.state.canceled, []);

  // The event's copy is not trusted: the charge is read again from Stripe.
  charge('ch_new', 'pi_new', false);
  await webhook(event('charge.refunded', { id: 'ch_new', object: 'charge', refunded: true }));
  assert.equal((await status(user)).plan, 'premium', 'Stripe says it is not refunded');

  // Full refund of the latest payment: canceled in Stripe, back to Free.
  charge('ch_new', 'pi_new', true);
  assert.equal((await webhook(event('charge.refunded', stripe.state.charges.get('ch_new')))).status, 200);
  assert.deepEqual(stripe.state.canceled, [subId]);
  const s = await status(user);
  assert.equal(s.plan, 'free');
  assert.equal(s.subscription.status, 'canceled');

  // Stripe retries the event: nothing is canceled twice.
  await webhook(event('charge.refunded', stripe.state.charges.get('ch_new')));
  assert.deepEqual(stripe.state.canceled, [subId]);
});

test('disputes: a chargeback cancels the subscription and ends Premium', async () => {
  const { stripe, signUp, pay, webhook, event, status } = await setup();
  const user = await signUp('dispute@example.com');
  const { subId, session } = await pay(user);
  await webhook(event('checkout.session.completed', session));
  stripe.state.subs.get(subId).latest_invoice = 'in_9';
  stripe.state.invoicePayments.set('pi_1', { id: 'in_1', parent: { subscription_details: { subscription: subId } } });
  stripe.state.charges.set('ch_1', { id: 'ch_1', object: 'charge', payment_intent: 'pi_1', refunded: false });

  const res = await webhook(event('charge.dispute.created', { id: 'dp_1', object: 'dispute', charge: 'ch_1', payment_intent: 'pi_1' }));
  assert.equal(res.status, 200);
  assert.deepEqual(stripe.state.canceled, [subId], 'even when the disputed payment is not the latest');
  assert.equal((await status(user)).plan, 'free');
});

test('refunds of payments that aren’t app subscriptions are acknowledged and ignored', async () => {
  const { stripe, signUp, pay, webhook, event, status } = await setup();
  const user = await signUp('other@example.com');
  const { session } = await pay(user);
  await webhook(event('checkout.session.completed', session));
  stripe.state.charges.set('ch_x', { id: 'ch_x', object: 'charge', payment_intent: 'pi_none', refunded: true });
  assert.equal((await webhook(event('charge.refunded', stripe.state.charges.get('ch_x')))).status, 200);
  assert.deepEqual(stripe.state.canceled, []);
  assert.equal((await status(user)).plan, 'premium');
});

test('expired subscription: Premium ends even if a webhook was missed', async () => {
  const { clock, signUp, pay, webhook, event, status } = await setup();
  const user = await signUp('missed@example.com');
  const { session } = await pay(user);
  await webhook(event('checkout.session.completed', session));
  assert.equal((await status(user)).plan, 'premium');
  clock.now += 32 * DAY; // 30-day period + 2 days: still in the safety grace
  assert.equal((await status(user)).plan, 'premium');
  clock.now += 2 * DAY; // more than 3 days past the paid period, no renewal seen
  assert.equal((await status(user)).plan, 'free');
});

test('checkout: someone with a subscription can’t accidentally buy a second one', async () => {
  const { api, signUp, pay, webhook, event, as } = await setup();
  const user = await signUp('twice@example.com');
  const { session } = await pay(user);
  await webhook(event('checkout.session.completed', session));
  const res = await call(api, 'POST', '/billing/checkout', { interval: 'year' }, as(user));
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'already_subscribed');
});

test('success page sync: verified with Stripe, only for your own session, never from the redirect alone', async () => {
  const { api, stripe, signUp, pay, as, status } = await setup();
  const alice = await signUp('alice@example.com');
  const bob = await signUp('bob@example.com');

  // Bob opens checkout but never pays: syncing grants nothing.
  const open = await call(api, 'POST', '/billing/checkout', { interval: 'month' }, as(bob));
  const openId = open.body.url.split('/').pop();
  const notPaid = await call(api, 'POST', '/billing/sync', { sessionId: openId }, as(bob));
  assert.equal(notPaid.status, 200);
  assert.equal(notPaid.body.checkoutComplete, false);
  assert.equal(notPaid.body.plan, 'free');

  const { sessionId } = await pay(alice);
  // Bob can't claim Alice's checkout.
  const stolen = await call(api, 'POST', '/billing/sync', { sessionId }, as(bob));
  assert.equal(stolen.status, 403);
  assert.equal((await status(bob)).plan, 'free');
  assert.equal((await call(api, 'POST', '/billing/sync', { sessionId: 'cs_test_doesnotexist' }, as(bob))).status, 404);
  assert.equal((await call(api, 'POST', '/billing/sync', { sessionId: '../etc' }, as(bob))).status, 400);

  // Alice's own sync activates Premium right away (the webhook would too).
  const mine = await call(api, 'POST', '/billing/sync', { sessionId }, as(alice));
  assert.equal(mine.status, 200);
  assert.equal(mine.body.plan, 'premium');
  assert.equal(stripe.state.retrieves, 1);
});

test('users can’t see or manage another user’s billing, or grant themselves Premium', async () => {
  const { api, signUp, pay, webhook, event, as, status } = await setup();
  const alice = await signUp('owner@example.com');
  const bob = await signUp('intruder@example.com');
  const { session } = await pay(alice);
  await webhook(event('checkout.session.completed', session));

  const bobStatus = await status(bob);
  assert.equal(bobStatus.plan, 'free');
  assert.equal(bobStatus.subscription, null);
  assert.equal(bobStatus.canManage, false);
  assert.equal((await call(api, 'POST', '/billing/portal', {}, as(bob))).status, 404, 'no portal for someone else’s customer');
  assert.equal((await call(api, 'POST', '/billing/portal', {})).status, 401);
  assert.match((await call(api, 'POST', '/billing/portal', {}, as(alice))).body.url, /^https:\/\/billing\.stripe\.com\//);

  // Writing "premium" into saved data, or calling made-up routes, does nothing.
  await call(api, 'PUT', '/data', { baseRevision: 0, data: { plan: 'premium', subscription: { status: 'active' } } }, as(bob));
  assert.equal((await call(api, 'POST', '/billing/activate', { plan: 'premium' }, as(bob))).status, 404);
  assert.equal((await call(api, 'POST', '/billing/status', { plan: 'premium' }, as(bob))).status, 404);
  assert.equal((await status(bob)).plan, 'free');
  assert.equal((await call(api, 'GET', '/usage', undefined, as(bob))).body.ai.plan, 'free');
});

test('a subscription whose customer isn’t linked to an account grants nothing', async () => {
  const { stripe, signUp, webhook, event, status } = await setup();
  const user = await signUp('nobody@example.com');
  stripe.state.subs.set('sub_foreign', subscription({ id: 'sub_foreign', customer: 'cus_made_in_dashboard', periodEnd: Math.floor(Date.now() / 1000) + 9999 }));
  const res = await webhook(event('customer.subscription.created', stripe.state.subs.get('sub_foreign')));
  assert.equal(res.status, 200);
  assert.equal((await status(user)).plan, 'free');
});

test('a Stripe outage during a webhook returns 500 so Stripe retries, and the event is not marked done', async () => {
  const { stripe, signUp, pay, webhook, event, status } = await setup();
  const user = await signUp('retry@example.com');
  const { session, subId } = await pay(user);
  const saved = stripe.state.subs.get(subId);
  stripe.state.subs.delete(subId); // retrieve now fails
  const evt = event('checkout.session.completed', session, 'evt_retry');
  assert.equal((await webhook(evt)).status, 500);
  stripe.state.subs.set(subId, saved);
  const retry = await webhook(evt);
  assert.equal(retry.status, 200);
  assert.notEqual(retry.body.duplicate, true);
  assert.equal((await status(user)).plan, 'premium');
});

// ---------- AI limits per plan ----------

test('AI limits: Free and Premium allowances are enforced on the server', async () => {
  const { api, signUp, pay, webhook, event, as } = await setup();
  const free = await signUp('free@example.com');
  const premium = await signUp('premium@example.com');
  const { session } = await pay(premium);
  await webhook(event('checkout.session.completed', session));
  const ai = (user) => call(api, 'POST', '/ai/summary', { resumeText: 'Cashier for two years', targetRole: 'Office assistant' }, as(user));
  const reply = () => jsonResponse({ content: [{ type: 'text', text: JSON.stringify({ summary: 'Business student with two years of cashier experience seeking office work.' }) }], stop_reason: 'end_turn' });

  await withFetch(reply, async () => {
    for (let i = 0; i < 2; i += 1) assert.equal((await ai(free)).status, 200);
    const blocked = await ai(free);
    assert.equal(blocked.status, 403);
    assert.match(blocked.body.error, /Premium includes 4 AI requests a month/);
    for (let i = 0; i < 4; i += 1) assert.equal((await ai(premium)).status, 200);
    const premiumBlocked = await ai(premium);
    assert.equal(premiumBlocked.status, 403);
    assert.doesNotMatch(premiumBlocked.body.error, /Premium includes/);
  });
  const usage = (await call(api, 'GET', '/usage', undefined, as(premium))).body.ai;
  assert.deepEqual({ plan: usage.plan, used: usage.used, limit: usage.limit }, { plan: 'premium', used: 4, limit: 4 });
});

// ---------- Account deletion ----------

test('deleting an account cancels its subscription first, and keeps the account if that fails', async () => {
  const { api, stripe, signUp, pay, webhook, event, as } = await setup();
  const user = await signUp('leaving@example.com');
  const { session, subId } = await pay(user);
  await webhook(event('checkout.session.completed', session));

  stripe.state.failCancel = true;
  const failed = await call(api, 'POST', '/auth/delete-account', { password: 'leaving@example.com long passphrase' }, as(user));
  assert.equal(failed.status, 502);
  assert.equal((await call(api, 'GET', '/auth/me', undefined, as(user))).body.user.email, 'leaving@example.com', 'account kept');

  stripe.state.failCancel = false;
  const ok = await call(api, 'POST', '/auth/delete-account', { password: 'leaving@example.com long passphrase' }, as(user));
  assert.equal(ok.status, 200);
  assert.deepEqual(stripe.state.canceled, [subId]);
});

// ---------- Entitlement rules and data safety ----------

test('entitlement rules: only Premium prices with a valid status, within the paid period', () => {
  const now = new Date('2026-10-24T00:00:00Z');
  const row = { plan: 'premium', status: 'active', current_period_end: '2026-11-20T00:00:00Z', past_due_since: null };
  assert.equal(grantsPremium(row, now), true);
  for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) assert.equal(grantsPremium({ ...row, status }, now), false, status);
  assert.equal(grantsPremium({ ...row, plan: 'free' }, now), false, 'unknown price');
  assert.equal(grantsPremium({ ...row, current_period_end: '2026-10-01T00:00:00Z' }, now), false);

  const fields = subscriptionFields(subscription({ price: 'price_unknown', periodEnd: 1790000000 }), new Set(['price_month']));
  assert.equal(fields.plan, 'free');
  assert.equal(fields.currentPeriodEnd, new Date(1790000000 * 1000).toISOString());
});

test('upgrading the database keeps existing accounts, resumes, saved jobs and applications', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fja-billing-'));
  const file = join(dir, 'old.db');
  try {
    // A database as it was before billing existed (schema version 2).
    const old = new DatabaseSync(file);
    old.exec('CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (2);');
    old.exec(MIGRATIONS[0]);
    old.exec(MIGRATIONS[1]);
    old.prepare("INSERT INTO users (id, email, password_hash, created_at, password_changed_at) VALUES ('u1', 'kept@example.com', 'h', 'now', 'now')").run();
    const data = { resume: { summary: 'Kept' }, savedJobs: [{ id: 'j1', job: { title: 'Analyst' } }], applications: [{ id: 'a1', title: 'Analyst', status: 'applied' }] };
    old.prepare("INSERT INTO user_data (user_id, data, revision, updated_at) VALUES ('u1', ?, 7, 'now')").run(JSON.stringify(data));
    old.close();

    const db = await openDatabase(file);
    assert.equal(db.prepare('SELECT version FROM schema_version').get().version, MIGRATIONS.length);
    assert.equal(db.prepare('SELECT email FROM users').get().email, 'kept@example.com');
    const row = db.prepare('SELECT data, revision FROM user_data').get();
    assert.deepEqual(JSON.parse(row.data), data);
    assert.equal(row.revision, 7);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM subscriptions').get().n, 0);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
