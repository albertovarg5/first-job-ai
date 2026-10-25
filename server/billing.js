// Premium subscriptions with Stripe Checkout and Stripe Billing.
//
// Security model:
// - Card details never touch this server: payment happens on Stripe-hosted
//   Checkout, and changes/cancellation in the Stripe customer portal.
// - The browser only says "monthly" or "yearly". The server picks the Price
//   ID from the environment and the user from the session cookie.
// - A user's plan changes only after the server has read the subscription
//   from Stripe: in a webhook with a verified signature, or right after
//   checkout by retrieving the Checkout Session with the secret key. A
//   redirect to the success page alone never grants Premium.
// - Webhooks are idempotent (processed event ids are stored) and safe when
//   they arrive out of order: every event triggers a fresh read of the
//   subscription from Stripe instead of trusting the event's copy.
//
// Routes (mounted at /api/billing):
//   GET  /status    -> { configured, testMode, prices, aiLimits, signedIn, plan, subscription, canManage }
//   POST /checkout  { interval: 'month' | 'year' } -> { url }   (Stripe Checkout)
//   POST /portal    -> { url }                                  (Stripe customer portal)
//   POST /sync      { sessionId } -> status                     (after returning from Checkout)
//   POST /webhook   Stripe events (signature checked, no cookie)

import Stripe from 'stripe';
import { createBillingStore, isOpenStatus, subscriptionFields } from './billingStore.js';
import { planLimits } from './plans.js';
import { HttpError, RateLimiter, envFlag, isProduction, pathOf, rateLimited, readJson, readRaw, send } from './http.js';

const PRICE_RE = /^price_[A-Za-z0-9]+$/;
const SESSION_RE = /^cs_(test|live)_[A-Za-z0-9]+$/;
const CHECKOUT_HOST = 'checkout.stripe.com';
const PORTAL_HOST = 'billing.stripe.com';
const PRICE_CACHE_MS = 60 * 60 * 1000;

// Events that can change a subscription. Everything else is acknowledged and ignored.
export const HANDLED_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.trial_will_end',
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
];
// Money sent back to the customer. A full refund of the latest payment, or a
// chargeback, ends Premium (see handleMoneyBack).
export const MONEY_BACK_EVENTS = ['charge.refunded', 'charge.dispute.created'];

const idOf = (v) => (typeof v === 'string' ? v : v?.id || null);

export function billingConfig(env = {}) {
  const secretKey = String(env.STRIPE_SECRET_KEY || '').trim();
  const webhookSecret = String(env.STRIPE_WEBHOOK_SECRET || '').trim();
  const month = String(env.STRIPE_PRICE_MONTHLY || '').trim();
  const year = String(env.STRIPE_PRICE_YEARLY || '').trim();
  const extra = String(env.STRIPE_EXTRA_PREMIUM_PRICES || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => PRICE_RE.test(s));
  const prices = { month: PRICE_RE.test(month) ? month : null, year: PRICE_RE.test(year) ? year : null };
  // Safety lock: a live key only takes real payments once STRIPE_ALLOW_LIVE=true
  // is set as well, so pasting the wrong key can't start charging people.
  const live = /^(sk|rk)_live_/.test(secretKey);
  const liveBlocked = live && !envFlag(env.STRIPE_ALLOW_LIVE, false);
  return {
    secretKey,
    webhookSecret,
    prices,
    // Prices that grant Premium. Keep old ids in STRIPE_EXTRA_PREMIUM_PRICES when you replace a price.
    premiumPrices: new Set([prices.month, prices.year, ...extra].filter(Boolean)),
    configured: Boolean(secretKey && webhookSecret && prices.month && !liveBlocked),
    testMode: secretKey.startsWith('sk_test_') || secretKey.startsWith('rk_test_'),
    live,
    liveBlocked,
  };
}

// The public address Stripe sends people back to. Never taken from request
// headers in production.
function appBase(env, req) {
  const appUrl = String(env.APP_URL || '').trim().replace(/\/$/, '');
  if (appUrl) return appUrl;
  if (isProduction(env)) return null;
  const origin = req.headers?.origin;
  return origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : 'http://localhost:5173';
}

function hostedUrl(url, host) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === host ? u.toString() : null;
  } catch {
    return null;
  }
}

export function createBilling({ db, env = {}, requireUser, stripe, log = console, now = () => new Date() }) {
  const config = billingConfig(env);
  const store = createBillingStore(db, config.secretKey ? config.live : null);
  const limiter = new RateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });
  let client = stripe || null;
  const stripeClient = () => {
    if (!client) client = new Stripe(config.secretKey, { maxNetworkRetries: 2, timeout: 20000 });
    return client;
  };
  const priceCache = new Map(); // interval -> { at, value }

  function requireConfigured() {
    if (!config.configured) throw new HttpError(503, 'Premium isn’t available on this server yet.', 'billing_unavailable');
  }

  function limit(user) {
    const r = limiter.take(`billing:${user.id}`);
    if (!r.ok) throw Object.assign(new HttpError(429, 'Too many billing requests. Please wait a few minutes.', 'rate_limited'), { retryAfter: r.retryAfter });
  }

  // Display price straight from Stripe, so the amount shown always matches what Checkout charges.
  async function priceInfo(interval) {
    const id = config.prices[interval];
    if (!id) return null;
    const cached = priceCache.get(interval);
    if (cached && Date.now() - cached.at < PRICE_CACHE_MS) return cached.value;
    let value = null;
    try {
      const p = await stripeClient().prices.retrieve(id);
      if (p.livemode !== undefined && p.livemode !== config.live) {
        log.warn?.(`[billing] STRIPE_PRICE_${interval === 'month' ? 'MONTHLY' : 'YEARLY'} is a ${p.livemode ? 'live' : 'test'}-mode price but the key is ${config.live ? 'live' : 'test'}. Use prices from the same mode as STRIPE_SECRET_KEY.`);
      } else if (p.active && p.type === 'recurring' && p.recurring?.interval === interval && Number.isInteger(p.unit_amount)) {
        value = { amount: p.unit_amount, currency: p.currency };
      } else {
        log.warn?.(`[billing] Price for "${interval}" is not an active ${interval}ly recurring price. Check STRIPE_PRICE_${interval === 'month' ? 'MONTHLY' : 'YEARLY'}.`);
      }
    } catch (err) {
      log.warn?.(`[billing] Could not load the ${interval}ly price from Stripe: ${err.message}`);
    }
    priceCache.set(interval, { at: Date.now(), value });
    return value;
  }

  async function statusFor(user) {
    const rows = await store.subscriptionsOf(user.id);
    const latest = rows.find((r) => isOpenStatus(r.status)) || rows[0] || null;
    return {
      plan: await store.planOf(user.id, now()),
      canManage: Boolean(await store.customerOf(user.id)),
      subscription: latest && {
        status: latest.status,
        interval: latest.interval,
        currentPeriodEnd: latest.current_period_end,
        cancelAtPeriodEnd: Boolean(latest.cancel_at_period_end) || Boolean(latest.cancel_at && !latest.ended_at),
        cancelAt: latest.cancel_at,
        endedAt: latest.ended_at,
      },
    };
  }

  // Reads one subscription from Stripe and stores its current state.
  async function syncSubscription(subscriptionId, event = null) {
    const sub = await stripeClient().subscriptions.retrieve(subscriptionId);
    const customerId = idOf(sub.customer);
    const userId = await store.userOfCustomer(customerId);
    if (!userId) {
      // Not created through this app (e.g. made by hand in the Dashboard). Nothing to grant.
      log.warn?.(`[billing] Ignoring subscription ${sub.id}: its customer is not linked to an account.`);
      if (event) await store.markEvent(event);
      return null;
    }
    await store.saveSubscription({ subscriptionId: sub.id, userId, customerId, fields: subscriptionFields(sub, config.premiumPrices), event, now: now() });
    return userId;
  }

  function subscriptionIdFrom(event) {
    const obj = event.data?.object || {};
    if (event.type.startsWith('customer.subscription.')) return idOf(obj);
    if (event.type.startsWith('checkout.session.')) return obj.mode === 'subscription' ? idOf(obj.subscription) : null;
    if (event.type.startsWith('invoice.')) return idOf(obj.parent?.subscription_details?.subscription) || idOf(obj.subscription);
    return null;
  }

  // Refunds and chargebacks. The charge is read again from Stripe, then its
  // invoice and subscription. A full refund of the subscription's latest
  // payment, or any dispute, cancels the subscription at once, which ends
  // Premium and stops future charges. Partial refunds (goodwill credits) and
  // refunds of older payments change nothing.
  async function handleMoneyBack(event) {
    const obj = event.data?.object || {};
    const dispute = event.type === 'charge.dispute.created';
    const chargeId = dispute ? idOf(obj.charge) : idOf(obj);
    const charge = chargeId ? await stripeClient().charges.retrieve(chargeId) : null;
    const paymentIntent = idOf(charge?.payment_intent);
    if (!charge || !paymentIntent || (!dispute && !charge.refunded)) return await store.markEvent(event);

    const payments = await stripeClient().invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: paymentIntent }, limit: 1, expand: ['data.invoice'] });
    const invoice = payments.data?.[0]?.invoice;
    const subscriptionId = idOf(invoice?.parent?.subscription_details?.subscription);
    if (!subscriptionId) return await store.markEvent(event);

    const sub = await stripeClient().subscriptions.retrieve(subscriptionId);
    const ends = dispute || idOf(sub.latest_invoice) === idOf(invoice);
    if (ends && isOpenStatus(sub.status) && (await store.userOfCustomer(idOf(sub.customer)))) {
      await stripeClient().subscriptions.cancel(sub.id);
      log.warn?.(`[billing] Canceled ${sub.id} after ${dispute ? 'a dispute' : 'a full refund'} (${event.id}).`);
    }
    return syncSubscription(subscriptionId, event);
  }

  async function handleWebhook(req, res) {
    if (!config.webhookSecret || !config.secretKey) return send(res, 503, { error: 'Billing is not configured.', code: 'billing_unavailable' });
    const signature = req.headers?.['stripe-signature'];
    if (!signature) return send(res, 400, { error: 'Missing Stripe signature.', code: 'invalid_signature' });
    const raw = await readRaw(req);
    let event;
    try {
      event = stripeClient().webhooks.constructEvent(raw, signature, config.webhookSecret);
    } catch {
      log.warn?.('[billing] Rejected a webhook with an invalid signature.');
      return send(res, 400, { error: 'Invalid signature.', code: 'invalid_signature' });
    }
    if (await store.eventSeen(event.id)) return send(res, 200, { received: true, duplicate: true });
    // A test-mode endpoint secret next to a live key (or the reverse). Acknowledged so Stripe stops retrying.
    if (typeof event.livemode === 'boolean' && event.livemode !== config.live) {
      log.warn?.(`[billing] Ignored ${event.livemode ? 'live' : 'test'}-mode event ${event.id}: STRIPE_SECRET_KEY is ${config.live ? 'live' : 'test'}. Use the webhook secret of an endpoint in the same mode.`);
      return send(res, 200, { received: true, ignored: true });
    }
    try {
      const subscriptionId = HANDLED_EVENTS.includes(event.type) ? subscriptionIdFrom(event) : null;
      if (MONEY_BACK_EVENTS.includes(event.type)) await handleMoneyBack(event);
      else if (subscriptionId) await syncSubscription(subscriptionId, event);
      else await store.markEvent(event);
      return send(res, 200, { received: true });
    } catch (err) {
      // Only ids and the error message are logged, never the payload. Stripe retries on 5xx.
      log.error?.(`[billing] Could not process ${event.type} ${event.id}: ${err.message}`);
      return send(res, 500, { error: 'Webhook processing failed.', code: 'server_error' });
    }
  }

  async function customerFor(user) {
    const existing = await store.customerOf(user.id);
    if (existing) return existing;
    const customer = await stripeClient().customers.create(
      { email: user.email, metadata: { user_id: user.id } },
      { idempotencyKey: `fja-customer-${user.id}${config.live ? '-live' : ''}` },
    );
    return store.linkCustomer(user.id, customer.id);
  }

  const routes = {
    'GET /status': async (req, res) => {
      const prices = config.configured ? { month: await priceInfo('month'), year: await priceInfo('year') } : { month: null, year: null };
      let user = null;
      try {
        user = await requireUser(req);
      } catch {
        /* guests only see whether Premium exists */
      }
      return send(res, 200, {
        configured: config.configured,
        testMode: config.configured && config.testMode,
        prices,
        aiLimits: planLimits(env),
        signedIn: Boolean(user),
        ...(user ? await statusFor(user) : { plan: null, canManage: false, subscription: null }),
      });
    },

    'POST /checkout': async (req, res) => {
      const user = await requireUser(req);
      limit(user);
      requireConfigured();
      const body = await readJson(req, 1000);
      const interval = body.interval === 'year' ? 'year' : body.interval === 'month' ? 'month' : null;
      if (!interval) throw new HttpError(400, 'Choose monthly or yearly billing.', 'invalid_input');
      const price = config.prices[interval];
      if (!price) throw new HttpError(400, 'Yearly billing isn’t available.', 'invalid_input');
      // Only charge a price Stripe confirms is an active recurring price for this interval.
      if (!(await priceInfo(interval))) {
        throw new HttpError(503, `The ${interval === 'year' ? 'yearly' : 'monthly'} price isn’t set up correctly in Stripe, so checkout is paused. Please try again later.`, 'billing_unavailable');
      }
      // One subscription per user: anything still open must be managed in the portal instead.
      if ((await store.subscriptionsOf(user.id)).some((r) => isOpenStatus(r.status)) || (await store.planOf(user.id, now())) === 'premium') {
        throw new HttpError(409, 'You already have a subscription. Use “Manage subscription” to change or cancel it.', 'already_subscribed');
      }
      const base = appBase(env, req);
      if (!base) throw new HttpError(503, 'Premium needs APP_URL to be set on the server.', 'billing_unavailable');

      const stripeApi = stripeClient();
      const customer = await customerFor(user);
      // Close any other open checkout so two tabs can't create two subscriptions.
      const open = await stripeApi.checkout.sessions.list({ customer, status: 'open', limit: 10 });
      for (const s of open.data || []) await stripeApi.checkout.sessions.expire(s.id);

      const session = await stripeApi.checkout.sessions.create({
        mode: 'subscription',
        customer,
        client_reference_id: user.id,
        line_items: [{ price, quantity: 1 }],
        success_url: `${base}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/billing/cancel`,
        metadata: { user_id: user.id },
        subscription_data: { metadata: { user_id: user.id } },
      });
      const url = hostedUrl(session.url, CHECKOUT_HOST);
      if (!url) throw new HttpError(502, 'Stripe returned an unexpected checkout address.', 'billing_error');
      return send(res, 200, { url });
    },

    'POST /portal': async (req, res) => {
      const user = await requireUser(req);
      limit(user);
      requireConfigured();
      const customer = await store.customerOf(user.id);
      if (!customer) throw new HttpError(404, 'You don’t have a subscription to manage yet.', 'no_billing_account');
      const base = appBase(env, req);
      if (!base) throw new HttpError(503, 'Billing needs APP_URL to be set on the server.', 'billing_unavailable');
      let session;
      try {
        session = await stripeClient().billingPortal.sessions.create({ customer, return_url: `${base}/settings?billing=updated` });
      } catch (err) {
        // Stripe refuses until the portal settings were saved once in the Dashboard (per mode).
        if (err.type === 'StripeInvalidRequestError' && /configuration/i.test(err.message || '')) {
          log.error?.('[billing] The Stripe customer portal is not set up. Save it in Stripe: Settings → Billing → Customer portal.');
          throw new HttpError(503, 'Subscription management isn’t set up yet. Please try again later or contact support.', 'billing_unavailable');
        }
        throw err;
      }
      const url = hostedUrl(session.url, PORTAL_HOST);
      if (!url) throw new HttpError(502, 'Stripe returned an unexpected billing address.', 'billing_error');
      return send(res, 200, { url });
    },

    // Called by the success page. Reads the Checkout Session from Stripe with
    // the secret key, checks it belongs to this user, then syncs the
    // subscription. The webhook does the same thing independently.
    'POST /sync': async (req, res) => {
      const user = await requireUser(req);
      limit(user);
      requireConfigured();
      const body = await readJson(req, 1000);
      const sessionId = String(body.sessionId || '');
      if (!SESSION_RE.test(sessionId)) throw new HttpError(400, 'Invalid checkout session.', 'invalid_input');
      let session;
      try {
        session = await stripeClient().checkout.sessions.retrieve(sessionId);
      } catch (err) {
        if (err.code === 'resource_missing') throw new HttpError(404, 'That checkout session wasn’t found.', 'not_found');
        throw err; // Stripe outage or bad key: reported as a payment service problem.
      }
      const customer = await store.customerOf(user.id);
      if (session.client_reference_id !== user.id || !customer || idOf(session.customer) !== customer) {
        throw new HttpError(403, 'That checkout session belongs to another account.', 'forbidden');
      }
      const subscriptionId = session.mode === 'subscription' && session.status === 'complete' ? idOf(session.subscription) : null;
      if (subscriptionId) await syncSubscription(subscriptionId);
      return send(res, 200, { ...(await statusFor(user)), checkoutComplete: Boolean(subscriptionId) });
    },
  };

  async function handler(req, res, next) {
    const path = pathOf(req);
    try {
      if (req.method === 'POST' && path === '/webhook') return await handleWebhook(req, res);
      const route = routes[`${req.method} ${path}`];
      if (!route) return typeof next === 'function' ? next() : send(res, 404, { error: 'Not found' });
      return await route(req, res);
    } catch (err) {
      if (err.code === 'rate_limited') return rateLimited(res, err.retryAfter, err.message);
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, code: err.code });
      // Stripe errors carry a type and message but never card numbers.
      log.error?.(`[billing] ${req.method} ${path} failed: ${err.type || err.name}: ${err.message}`);
      return send(res, 502, { error: 'The payment service had a problem. Please try again in a moment.', code: 'billing_error' });
    }
  }

  // Before an account is deleted, cancel anything that could still charge it.
  // If that fails the account is kept, so nobody is billed for a deleted account.
  async function cancelAllFor(userId) {
    const open = (await store.subscriptionsOf(userId)).filter((r) => isOpenStatus(r.status));
    if (!open.length) return;
    if (!config.secretKey) {
      throw new HttpError(409, 'Your subscription couldn’t be canceled automatically. Cancel it under “Manage subscription” first, then delete your account.', 'subscription_active');
    }
    for (const row of open) {
      try {
        await stripeClient().subscriptions.cancel(row.stripe_subscription_id);
      } catch (err) {
        if (err.code !== 'resource_missing') {
          log.error?.(`[billing] Could not cancel ${row.stripe_subscription_id}: ${err.message}`);
          throw new HttpError(502, 'We couldn’t cancel your subscription, so your account wasn’t deleted. Please try again.', 'billing_error');
        }
      }
    }
  }

  return { handler, planOf: store.planOf, cancelAllFor, config };
}
