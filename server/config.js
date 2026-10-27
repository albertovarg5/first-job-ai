// Checks the server settings (.env or the host's environment) at startup and
// explains anything that is missing or wrong. Every API is optional, so most
// problems are warnings: the app still starts and the feature explains itself
// in the UI. Only settings that are unsafe in production are errors.

import { COUNTRIES, PROVIDERS, resolveProvider } from './jobsHandler.js';
import { allowedOrigins, envFlag, isProduction } from './http.js';
import { billingConfig } from './billing.js';

const SECRET_NAMES = ['DATABASE_URL', 'ANTHROPIC_API_KEY', 'JSEARCH_API_KEY', 'RAPIDAPI_KEY', 'RESEND_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
const blank = (v) => v === undefined || v === null || String(v).trim() === '';

// Returns { errors: string[], warnings: string[], features: { ai, jobs, email } }.
export function checkConfig(env = {}) {
  const errors = [];
  const warnings = [];
  const production = isProduction(env);

  // Secrets must never be exposed to the browser bundle.
  for (const name of Object.keys(env)) {
    if (!name.startsWith('VITE_')) continue;
    const bare = name.slice(5);
    if (SECRET_NAMES.includes(bare) || /KEY|SECRET|TOKEN|PASSWORD/i.test(bare)) {
      errors.push(`${name} looks like a secret. Variables starting with VITE_ are sent to the browser. Rename it to ${bare} (without VITE_).`);
    }
  }

  // AI (Anthropic)
  const anthropicKey = String(env.ANTHROPIC_API_KEY || '').trim();
  if (!anthropicKey) warnings.push('ANTHROPIC_API_KEY is not set: AI features run in Basic mode (no AI).');
  else if (!anthropicKey.startsWith('sk-ant-')) warnings.push('ANTHROPIC_API_KEY does not start with "sk-ant-". Check that you copied the whole key from console.anthropic.com.');
  if (!blank(env.AI_MODEL) && !/^[a-z0-9][a-z0-9.@:_-]{2,100}$/i.test(String(env.AI_MODEL).trim())) {
    warnings.push(`AI_MODEL "${env.AI_MODEL}" does not look like a model id (for example claude-sonnet-5-5). Leave it blank to use the default.`);
  }

  // Job search (JSearch)
  const jobsKey = String(env.JSEARCH_API_KEY || env.RAPIDAPI_KEY || '').trim();
  if (!jobsKey) warnings.push('JSEARCH_API_KEY is not set: Job Search shows setup instructions instead of listings.');
  if (!blank(env.JSEARCH_PROVIDER) && !PROVIDERS[String(env.JSEARCH_PROVIDER).trim().toLowerCase()]) {
    warnings.push(`JSEARCH_PROVIDER "${env.JSEARCH_PROVIDER}" is not recognized. Use "openwebninja" or "rapidapi", or leave it blank to detect it from the key.`);
  }
  if (!blank(env.JSEARCH_MONTHLY_LIMIT) && !(Number.isInteger(Number(env.JSEARCH_MONTHLY_LIMIT)) && Number(env.JSEARCH_MONTHLY_LIMIT) > 0)) {
    warnings.push(`JSEARCH_MONTHLY_LIMIT "${env.JSEARCH_MONTHLY_LIMIT}" is not a whole number above 0, so no monthly limit is applied.`);
  }
  if (!blank(env.JSEARCH_COUNTRY) && !COUNTRIES.includes(String(env.JSEARCH_COUNTRY).trim().toLowerCase())) {
    warnings.push(`JSEARCH_COUNTRY "${env.JSEARCH_COUNTRY}" is not supported, so "us" is used. Supported: ${COUNTRIES.join(', ')}.`);
  }

  // Premium subscriptions (Stripe)
  const billing = billingConfig(env);
  const stripeKey = billing.secretKey;
  const anyStripe = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_MONTHLY', 'STRIPE_PRICE_YEARLY'].some((k) => !blank(env[k]));
  if (stripeKey && !/^(sk|rk)_(test|live)_/.test(stripeKey)) {
    warnings.push('STRIPE_SECRET_KEY should start with sk_test_ (test mode) or sk_live_ (live mode). The publishable key (pk_...) is not needed.');
  }
  if (stripeKey && /^(sk|rk)_live_/.test(stripeKey) && !production) {
    warnings.push('STRIPE_SECRET_KEY is a LIVE key on a development server. Use your sk_test_ key while developing so no real cards are charged.');
  }
  if (stripeKey && billing.testMode && production) {
    warnings.push('STRIPE_SECRET_KEY is a test key in production: checkout works, but nobody is really charged.');
  }
  if (!blank(env.STRIPE_WEBHOOK_SECRET) && !String(env.STRIPE_WEBHOOK_SECRET).trim().startsWith('whsec_')) {
    warnings.push('STRIPE_WEBHOOK_SECRET should start with whsec_ (the endpoint’s signing secret, not an API key).');
  }
  for (const [name, interval] of [['STRIPE_PRICE_MONTHLY', 'month'], ['STRIPE_PRICE_YEARLY', 'year']]) {
    if (!blank(env[name]) && !billing.prices[interval]) warnings.push(`${name} should be a Price ID that starts with price_ (not a product ID prod_...).`);
  }
  if (billing.liveBlocked) {
    warnings.push('STRIPE_SECRET_KEY is a LIVE key, but STRIPE_ALLOW_LIVE is not "true", so Premium checkout is off (safety lock). Set STRIPE_ALLOW_LIVE=true only when you are ready to take real payments.');
  } else if ((anyStripe || production) && !billing.configured) {
    // Name exactly what is missing (or invalid), so the log says what to set.
    const missing = [['STRIPE_SECRET_KEY', stripeKey], ['STRIPE_WEBHOOK_SECRET', billing.webhookSecret], ['STRIPE_PRICE_MONTHLY', billing.prices.month]].filter(([, v]) => !v).map(([k]) => k);
    warnings.push(`Premium billing is off until these are set: ${missing.join(', ')}.`);
  }
  // Real payments need a real HTTPS address for Stripe to send customers back to.
  if (billing.configured && billing.live && production && !blank(env.APP_URL) && !/^https:\/\//.test(String(env.APP_URL).trim())) {
    errors.push('Live Stripe payments need APP_URL to start with https://. Set it to the public https:// address of the site.');
  }
  if (billing.configured && production && blank(env.APP_URL)) {
    warnings.push('APP_URL is not set: Stripe Checkout can’t send people back to the site, so Premium checkout is turned off.');
  }

  for (const entry of allowedOrigins(env).invalid) {
    warnings.push(`ALLOWED_ORIGINS entry "${entry}" is ignored: use an exact https:// address with no path or wildcard, e.g. https://my-app-git-main-me.vercel.app`);
  }

  // Password-reset email (Resend)
  const hasResendKey = !blank(env.RESEND_API_KEY);
  const hasFrom = !blank(env.EMAIL_FROM);
  if (hasResendKey !== hasFrom) {
    warnings.push(`Password-reset email needs both RESEND_API_KEY and EMAIL_FROM; only ${hasResendKey ? 'RESEND_API_KEY' : 'EMAIL_FROM'} is set, so email is off.`);
  }
  if (hasResendKey && !String(env.RESEND_API_KEY).trim().startsWith('re_')) {
    warnings.push('RESEND_API_KEY does not start with "re_". Check that you copied the whole key from resend.com.');
  }
  if (hasFrom && !/@[^\s@>]+\.[^\s@>]+>?\s*$/.test(String(env.EMAIL_FROM).trim())) {
    warnings.push(`EMAIL_FROM "${env.EMAIL_FROM}" is not an email address. Use for example: First Job AI <no-reply@yourdomain.com>`);
  }
  if (production) {
    if (blank(env.APP_URL)) warnings.push('APP_URL is not set: password reset is turned off in production. Set it to the public https:// address of the site.');
    else if (!/^https:\/\//.test(String(env.APP_URL).trim())) warnings.push('APP_URL should start with https:// in production.');
    if (!hasResendKey || !hasFrom) warnings.push('RESEND_API_KEY / EMAIL_FROM are not both set: password reset is turned off in production.');
    if ((!hasResendKey || !hasFrom || blank(env.APP_URL)) && envFlag(env.EMAIL_VERIFICATION, true)) {
      warnings.push('New accounts confirm their email first (EMAIL_VERIFICATION), which needs RESEND_API_KEY, EMAIL_FROM and APP_URL: until they are set, sign-up is turned off. Existing accounts can still sign in.');
    }
    // Accounts and subscriptions must live in a real database: the app's own disk is erased on every deploy.
    // On a host (Railway sets RAILWAY_PROJECT_ID) that is fatal; `npm start` on your own computer may use the local database.
    if (blank(env.DATABASE_URL)) {
      const msg = 'DATABASE_URL is not set, so the local development database (data/pglite) is used. On a server the app needs PostgreSQL (on Railway: reference the Postgres service’s DATABASE_URL).';
      (blank(env.RAILWAY_PROJECT_ID) ? warnings : errors).push(msg);
    } else if (!/^postgres(ql)?:\/\//i.test(String(env.DATABASE_URL).trim())) {
      errors.push('DATABASE_URL must start with postgresql:// (copy it from the Postgres service’s Variables tab).');
    }
  }

  return {
    errors,
    warnings,
    features: {
      ai: Boolean(anthropicKey),
      jobs: jobsKey ? PROVIDERS[resolveProvider(env)].label : false,
      email: hasResendKey && hasFrom,
      billing: billing.configured ? (billing.testMode ? 'test mode' : 'LIVE') : billing.liveBlocked ? 'locked (live key without STRIPE_ALLOW_LIVE)' : false,
    },
  };
}

// Prints a short summary at startup. Returns the check result.
export function reportConfig(env = {}, log = console) {
  const result = checkConfig(env);
  const on = (v) => (v ? 'on' : 'off');
  log.info?.(
    `[First Job AI] AI: ${on(result.features.ai)} · Job search: ${result.features.jobs ? `on (${result.features.jobs})` : 'off'} · Reset email: ${on(result.features.email)} · Premium billing: ${result.features.billing || 'off'}`,
  );
  for (const w of result.warnings) log.warn?.(`[config] ${w}`);
  for (const e of result.errors) log.error?.(`[config] ERROR: ${e}`);
  return result;
}
