// Read-only launch check: npm run check:production
//
// Run it where the production environment variables are set: inside the
// Railway service (`railway ssh`, then `npm run check:production`). It never
// changes anything in Stripe or the database, and never prints secret values.
// Exit code 1 means something must be fixed.
//
// Checks: server settings, the database, HTTPS, the Anthropic key,
// and the Stripe account, prices, webhook endpoint and customer portal for
// the mode of STRIPE_SECRET_KEY (test or live).
import { existsSync } from 'node:fs';
import Stripe from 'stripe';
import { billingConfig } from '../server/billing.js';
import { checkConfig } from '../server/config.js';
import { describeTarget, isPostgresUrl, openDatabase } from '../server/db.js';

if (existsSync('.env') && process.env.NODE_ENV !== 'production') process.loadEnvFile('.env');
const env = process.env;
let failures = 0;
let warnings = 0;
const ok = (msg) => console.log(`  ✔ ${msg}`);
const warn = (msg) => (warnings++, console.log(`  ⚠ ${msg}`));
const fail = (msg) => (failures++, console.log(`  ✖ ${msg}`));
const section = (title) => console.log(`\n${title}`);

// Events the app needs. All of these must be enabled on the webhook endpoint.
const REQUIRED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'charge.refunded',
  'charge.dispute.created',
];
const EXPECTED = { month: 999, year: 7900 }; // $9.99 / month, $79 / year (cents)

// ---------- Server settings ----------
section('Server settings');
const config = checkConfig(env);
if (env.NODE_ENV === 'production') ok('NODE_ENV is production');
else fail('NODE_ENV is not "production"');
for (const e of config.errors) fail(e);
for (const w of config.warnings) warn(w);
const appUrl = String(env.APP_URL || '').trim().replace(/\/$/, '');
if (/^https:\/\/[^/]+$/.test(appUrl)) ok(`APP_URL is ${appUrl}`);
else fail('APP_URL must be the public https:// address, without a path (e.g. https://firstjob.example.com)');

// ---------- Database ----------
section('Database (PostgreSQL)');
const dbUrl = String(env.DATABASE_URL || '').trim();
if (isPostgresUrl(dbUrl)) {
  try {
    const db = await openDatabase(dbUrl);
    const users = (await db.one('SELECT COUNT(*)::int AS n FROM users')).n;
    const version = (await db.one('SELECT version FROM schema_version')).version;
    ok(`Connected to ${describeTarget(dbUrl)} (schema version ${version}, ${users} account(s))`);
    await db.close();
  } catch (err) {
    fail(`Couldn’t connect to ${describeTarget(dbUrl)}: ${err.message}`);
  }
} else {
  fail('DATABASE_URL must be the postgresql:// address of the production database');
}

// ---------- HTTPS ----------
section('HTTPS');
if (appUrl.startsWith('https://')) {
  try {
    const res = await fetch(`${appUrl}/healthz`, { signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    if (res.ok && text.trim() === 'ok') ok(`${appUrl}/healthz answers "ok" over HTTPS`);
    else fail(`${appUrl}/healthz answered ${res.status}`);
    if (res.headers.get('strict-transport-security')) ok('HSTS header is sent');
    else warn('No Strict-Transport-Security header on the public address');
  } catch (err) {
    fail(`Couldn’t reach ${appUrl}/healthz over HTTPS (${err.cause?.code || err.message}). Check the domain, DNS and certificate.`);
  }
  try {
    const res = await fetch(`${appUrl.replace('https://', 'http://')}/`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const to = res.headers.get('location') || '';
    if (res.status >= 300 && res.status < 400 && to.startsWith('https://')) ok(`http:// redirects to https:// (${res.status})`);
    else warn(`http:// answered ${res.status} without redirecting to https://`);
  } catch (err) {
    warn(`Couldn’t test the http:// redirect (${err.cause?.code || err.message})`);
  }
}

// ---------- AI ----------
section('AI (Anthropic)');
const anthropicKey = String(env.ANTHROPIC_API_KEY || '').trim();
const model = String(env.AI_MODEL || 'claude-sonnet-5-5').trim();
if (!anthropicKey) {
  warn('ANTHROPIC_API_KEY is not set: AI tools run in Basic mode.');
} else {
  try {
    // Looking up the model is free and proves the key works and can use it.
    const res = await fetch(`https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`, {
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) ok(`The Anthropic key works and can use ${model}`);
    else if (res.status === 401) fail('ANTHROPIC_API_KEY was rejected (invalid or revoked key)');
    else if (res.status === 404) fail(`The model "${model}" isn’t available to this key. Check AI_MODEL.`);
    else warn(`Anthropic answered ${res.status} for the model check`);
    warn('This can’t check your Anthropic credit balance or spend limit: check console.anthropic.com → Billing.');
  } catch (err) {
    warn(`Couldn’t reach the Anthropic API (${err.message})`);
  }
}

// ---------- Stripe ----------
section('Stripe');
const billing = billingConfig(env);
if (!billing.secretKey) {
  warn('STRIPE_SECRET_KEY is not set: Premium is off.');
} else {
  const mode = billing.live ? 'LIVE' : 'TEST';
  console.log(`  Mode of STRIPE_SECRET_KEY: ${mode}`);
  if (!billing.live) warn('This is a TEST key: customers can’t pay real money. Use the live key for launch.');
  if (billing.live && !billing.liveBlocked) ok('STRIPE_ALLOW_LIVE=true: real payments are switched on');
  if (billing.liveBlocked) console.log('  • STRIPE_ALLOW_LIVE is not true: real payments stay locked (expected until this check passes).');
  if (String(env.STRIPE_WEBHOOK_SECRET || '').trim().startsWith('whsec_')) ok('STRIPE_WEBHOOK_SECRET is set');
  else fail('STRIPE_WEBHOOK_SECRET must be the whsec_... signing secret of the webhook endpoint');

  const stripe = new Stripe(billing.secretKey, { timeout: 20000 });
  try {
    const account = await stripe.accounts.retrieve();
    console.log(`  Account: ${account.id}${account.business_profile?.name ? ` (${account.business_profile.name})` : ''}`);
    if (billing.live) {
      if (account.details_submitted) ok('Account details are submitted');
      else fail('Stripe account activation isn’t finished (Dashboard → Activate payments)');
      if (account.charges_enabled) ok('Charges are enabled');
      else fail('Charges aren’t enabled on this Stripe account yet');
      if (account.payouts_enabled) ok('Payouts are enabled (bank account connected)');
      else fail('Payouts aren’t enabled: add and verify a bank account in Stripe');
      if (account.business_profile?.support_email) ok('A customer support email is set');
      else warn('No customer support email in Stripe (Settings → Business → Public details)');
      if (account.settings?.payments?.statement_descriptor) ok(`Card statement name: ${account.settings.payments.statement_descriptor}`);
    }
  } catch (err) {
    fail(`Stripe rejected the key (${err.message})`);
  }

  // Prices
  for (const [interval, name] of [['month', 'STRIPE_PRICE_MONTHLY'], ['year', 'STRIPE_PRICE_YEARLY']]) {
    const id = billing.prices[interval];
    if (!id) {
      (interval === 'month' ? fail : warn)(`${name} is not set to a price_... ID`);
      continue;
    }
    try {
      const p = await stripe.prices.retrieve(id);
      const amount = `${(p.unit_amount / 100).toFixed(2)} ${p.currency.toUpperCase()}`;
      if (p.livemode !== billing.live) fail(`${name} is a ${p.livemode ? 'live' : 'test'}-mode price, but the key is ${mode.toLowerCase()}`);
      else if (!p.active) fail(`${name} (${id}) is archived in Stripe`);
      else if (p.type !== 'recurring' || p.recurring?.interval !== interval) fail(`${name} isn’t a ${interval}ly recurring price`);
      else if ((p.recurring.interval_count ?? 1) !== 1 || p.recurring.usage_type === 'metered') fail(`${name} must be billed every 1 ${interval} at a fixed amount (checkout refuses it)`);
      else ok(`${name}: ${amount} every ${interval}`);
      if (p.unit_amount !== EXPECTED[interval]) warn(`${name} is ${amount}; the planned price is ${(EXPECTED[interval] / 100).toFixed(2)} USD`);
    } catch (err) {
      fail(`${name} (${id}) wasn’t found with this key${err.code === 'resource_missing' ? ' (a price from the other mode or another account?)' : `: ${err.message}`}`);
    }
  }

  // Webhook endpoint
  if (appUrl) {
    // Either through the site's address, or straight to the backend (Railway sets RAILWAY_PUBLIC_DOMAIN).
    const targets = [appUrl, env.RAILWAY_PUBLIC_DOMAIN && `https://${env.RAILWAY_PUBLIC_DOMAIN}`].filter(Boolean).map((u) => `${u}/api/billing/webhook`);
    try {
      const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
      const ep = endpoints.data.find((e) => targets.includes(e.url.replace(/\/$/, '')));
      if (!ep) {
        fail(`No ${mode.toLowerCase()}-mode webhook endpoint for ${targets.join(' or ')} (Developers → Webhooks → Add endpoint)`);
      } else {
        ok(`Webhook endpoint ${ep.url} exists`);
        if (ep.status === 'enabled') ok('Webhook endpoint is enabled');
        else fail('Webhook endpoint is disabled');
        const all = ep.enabled_events.includes('*');
        const missing = all ? [] : REQUIRED_EVENTS.filter((e) => !ep.enabled_events.includes(e));
        if (missing.length) fail(`Webhook endpoint is missing events: ${missing.join(', ')}`);
        else ok('Webhook endpoint sends every required event');
        console.log('  • The signing secret itself can’t be read back from Stripe. After launch, a failed signature shows as "Rejected a webhook with an invalid signature" in the server log.');
      }
      const others = endpoints.data.filter((e) => !targets.includes(e.url.replace(/\/$/, '')));
      if (others.length) warn(`Other webhook endpoints on this account also receive events: ${others.map((e) => e.url).join(', ')}`);
    } catch (err) {
      fail(`Couldn’t list webhook endpoints (${err.message})`);
    }
  }

  // Customer portal
  try {
    const configs = await stripe.billingPortal.configurations.list({ limit: 10, is_default: true });
    const portal = configs.data[0];
    if (!portal) {
      fail('The customer portal isn’t saved in this mode (Settings → Billing → Customer portal → Save)');
    } else {
      const f = portal.features;
      if (f.payment_method_update.enabled) ok('Portal: customers can update their card');
      else fail('Portal: turn on "Update payment methods"');
      if (f.subscription_cancel.enabled) ok(`Portal: customers can cancel (${f.subscription_cancel.mode === 'at_period_end' ? 'at the end of the period' : 'immediately'})`);
      else fail('Portal: turn on "Cancel subscriptions"');
      const portalPrices = (f.subscription_update.products || []).flatMap((p) => p.prices);
      const wanted = [billing.prices.month, billing.prices.year].filter(Boolean);
      if (f.subscription_update.enabled && wanted.every((id) => portalPrices.includes(id))) ok('Portal: customers can switch between monthly and yearly');
      else warn('Portal: "Switch plans" isn’t on for both Premium prices (customers can still cancel and resubscribe)');
      if (portal.business_profile?.privacy_policy_url && portal.business_profile?.terms_of_service_url) ok('Portal: terms and privacy links are set');
      else warn('Portal: add your terms of service and privacy policy links');
    }
  } catch (err) {
    fail(`Couldn’t read the customer portal settings (${err.message})`);
  }
}

// ---------- Summary ----------
console.log(`\n${failures ? `✖ ${failures} problem(s) must be fixed` : '✔ No blocking problems'}${warnings ? `, ⚠ ${warnings} warning(s) to review` : ''}.`);
if (!failures && billing.live) {
  console.log(billing.liveBlocked ? 'READY: you can set STRIPE_ALLOW_LIVE=true and redeploy.' : 'Live payments are on.');
}
process.exit(failures ? 1 : 0);
