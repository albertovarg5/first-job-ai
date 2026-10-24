// Browser side of Premium billing. The browser never sees Stripe keys or
// prices it could change: it only asks our server for "monthly" or "yearly"
// and is sent to Stripe-hosted pages. Whether someone is Premium always comes
// from the server (/api/billing/status), never from this file.
import { ApiError, apiFetch } from './api.js';

export const fetchBillingStatus = () => apiFetch('/api/billing/status');

// Only follow links to Stripe's own pages.
export function stripeUrl(url, host) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === host ? u.toString() : null;
  } catch {
    return null;
  }
}

// Leaves the app for a Stripe page. Replaceable in tests, where there is no real navigation.
export const browser = { open: (url) => window.location.assign(url) };

function go(url, host) {
  const safe = stripeUrl(url, host);
  if (!safe) throw new ApiError('The payment page address looked wrong, so it wasn’t opened. Please try again.', { code: 'billing_error' });
  browser.open(safe);
}

export async function startCheckout(interval) {
  const res = await apiFetch('/api/billing/checkout', { method: 'POST', body: { interval } });
  go(res.url, 'checkout.stripe.com');
}

export async function openBillingPortal() {
  const res = await apiFetch('/api/billing/portal', { method: 'POST', body: {} });
  go(res.url, 'billing.stripe.com');
}

export const syncCheckout = (sessionId) => apiFetch('/api/billing/sync', { method: 'POST', body: { sessionId } });

export function formatPrice(price, interval) {
  if (!price) return '';
  let amount;
  try {
    amount = new Intl.NumberFormat(undefined, { style: 'currency', currency: price.currency.toUpperCase() }).format(price.amount / 100);
  } catch {
    amount = `${(price.amount / 100).toFixed(2)} ${price.currency.toUpperCase()}`;
  }
  return `${amount} / ${interval === 'year' ? 'year' : 'month'}`;
}

// Subscriptions that still exist in Stripe (mirrors server/billingStore.js).
const OPEN_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete']);
export const hasOpenSubscription = (billing) => Boolean(billing?.subscription && OPEN_STATUSES.has(billing.subscription.status));

// Whole-percent saving of the yearly price over twelve monthly payments, or 0.
export function yearlySaving(prices) {
  const { month, year } = prices || {};
  if (!month?.amount || !year?.amount || month.currency !== year.currency) return 0;
  return Math.max(0, Math.floor(100 - (year.amount / (month.amount * 12)) * 100));
}

const STATUS_TEXT = {
  active: 'Active',
  trialing: 'Trial',
  past_due: 'Payment failed: Stripe is retrying',
  unpaid: 'Unpaid',
  canceled: 'Canceled',
  incomplete: 'Waiting for payment',
  incomplete_expired: 'Checkout not completed',
  paused: 'Paused',
};
export const subscriptionStatusText = (status) => STATUS_TEXT[status] || status;
