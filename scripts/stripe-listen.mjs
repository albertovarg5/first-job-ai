// Forwards Stripe TEST-mode webhooks to the local app: npm run stripe:listen
//
// Uses STRIPE_SECRET_KEY from .env, so events come from the same Stripe
// account as the app's key, even if the Stripe CLI is logged in to another
// account. Checks that STRIPE_WEBHOOK_SECRET matches this listener. Never
// prints keys. Options: --port 3000 (default 5173, the "npm run dev" port).
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { HANDLED_EVENTS, MONEY_BACK_EVENTS } from '../server/billing.js';

if (!existsSync('.env')) {
  console.error('No .env file found. Run this from the project folder after creating .env.');
  process.exit(1);
}
process.loadEnvFile('.env');
const key = String(process.env.STRIPE_SECRET_KEY || '').trim();
if (!/^(sk|rk)_test_/.test(key)) {
  console.error('STRIPE_SECRET_KEY in .env must be a TEST key (sk_test_...). This listener is for local testing only.');
  process.exit(1);
}
const portArg = process.argv.indexOf('--port');
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 5173;
const forwardTo = `localhost:${port}/api/billing/webhook`;
const env = { ...process.env, STRIPE_API_KEY: key };

let secret = '';
try {
  secret = execFileSync('stripe', ['listen', '--print-secret'], { env, encoding: 'utf8' }).trim();
} catch {
  console.error('Could not run the Stripe CLI. Install it (https://docs.stripe.com/stripe-cli) and try again.');
  process.exit(1);
}
const configured = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
if (secret && configured !== secret) {
  console.warn('\n*** STRIPE_WEBHOOK_SECRET in .env does not match this listener. ***');
  console.warn('Copy the whsec_... value printed below into STRIPE_WEBHOOK_SECRET in .env,');
  console.warn('save the file, then restart "npm run dev". Webhooks will be rejected until then.\n');
} else {
  console.log('STRIPE_WEBHOOK_SECRET in .env matches this listener.');
}
console.log(`Forwarding test-mode events to http://${forwardTo} (Ctrl + C to stop)\n`);

const events = [...HANDLED_EVENTS, ...MONEY_BACK_EVENTS].join(',');
const child = spawn('stripe', ['listen', '--events', events, '--forward-to', forwardTo], { env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
