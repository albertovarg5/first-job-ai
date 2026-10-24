// Database side of billing: Stripe customer links, a copy of each Stripe
// subscription's state, processed webhook events, and the rule that turns
// those into a plan. Nothing here talks to Stripe, and no route lets a user
// write to these tables directly: only server/billing.js does, after it has
// verified the data with Stripe.

// Statuses that can give Premium. Everything else (canceled, unpaid,
// incomplete, incomplete_expired, paused) means Free.
const PREMIUM_STATUSES = new Set(['active', 'trialing', 'past_due']);
// Subscriptions that still exist in Stripe and could bill the user again.
const OPEN_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete']);

// If a webhook is ever missed, Premium still ends this long after the paid period.
export const PERIOD_GRACE_MS = 3 * 86400000;
// How long Premium continues while Stripe retries a failed payment.
export const PAST_DUE_GRACE_MS = 14 * 86400000;

const iso = (seconds) => (Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null);

export function isOpenStatus(status) {
  return OPEN_STATUSES.has(status);
}

// Does this stored subscription give Premium right now?
export function grantsPremium(row, now = new Date()) {
  if (!row || row.plan !== 'premium' || !PREMIUM_STATUSES.has(row.status)) return false;
  const t = now.getTime();
  if (row.current_period_end && Date.parse(row.current_period_end) + PERIOD_GRACE_MS < t) return false;
  if (row.status === 'past_due' && row.past_due_since && Date.parse(row.past_due_since) + PAST_DUE_GRACE_MS < t) return false;
  return true;
}

// Turns a Stripe Subscription object into the fields we keep. The period end
// lives on the subscription items in current Stripe API versions; the
// subscription-level field is only a fallback for older objects.
export function subscriptionFields(sub, premiumPrices) {
  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id || null;
  const ends = (sub.items?.data || []).map((i) => i.current_period_end).filter(Number.isFinite);
  const periodEnd = ends.length ? Math.max(...ends) : sub.current_period_end;
  return {
    priceId,
    interval: item?.price?.recurring?.interval || null,
    plan: priceId && premiumPrices.has(priceId) ? 'premium' : 'free',
    status: String(sub.status || 'incomplete'),
    currentPeriodEnd: iso(periodEnd),
    cancelAtPeriodEnd: sub.cancel_at_period_end ? 1 : 0,
    cancelAt: iso(sub.cancel_at),
    canceledAt: iso(sub.canceled_at),
    endedAt: iso(sub.ended_at),
  };
}

export function createBillingStore(db) {
  const q = {
    customerOf: db.prepare('SELECT stripe_customer_id FROM billing_customers WHERE user_id = ?'),
    userOfCustomer: db.prepare('SELECT user_id FROM billing_customers WHERE stripe_customer_id = ?'),
    insertCustomer: db.prepare('INSERT INTO billing_customers (user_id, stripe_customer_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'),
    subscription: db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id = ?'),
    subscriptionsOf: db.prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY updated_at DESC'),
    upsert: db.prepare(`INSERT INTO subscriptions
        (stripe_subscription_id, user_id, stripe_customer_id, price_id, interval, plan, status, current_period_end,
         cancel_at_period_end, cancel_at, canceled_at, ended_at, past_due_since, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(stripe_subscription_id) DO UPDATE SET
        price_id = excluded.price_id, interval = excluded.interval, plan = excluded.plan, status = excluded.status,
        current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
        cancel_at = excluded.cancel_at, canceled_at = excluded.canceled_at, ended_at = excluded.ended_at,
        past_due_since = excluded.past_due_since, updated_at = excluded.updated_at`),
    eventSeen: db.prepare('SELECT 1 FROM stripe_events WHERE id = ?'),
    markEvent: db.prepare('INSERT INTO stripe_events (id, type, processed_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'),
  };

  return {
    customerOf: (userId) => q.customerOf.get(userId)?.stripe_customer_id || null,
    userOfCustomer: (customerId) => q.userOfCustomer.get(customerId)?.user_id || null,
    linkCustomer(userId, customerId) {
      q.insertCustomer.run(userId, customerId, new Date().toISOString());
      return q.customerOf.get(userId)?.stripe_customer_id || null;
    },
    subscriptionsOf: (userId) => q.subscriptionsOf.all(userId),
    eventSeen: (id) => Boolean(q.eventSeen.get(id)),

    // Saves the latest state of one subscription and, when given, marks the
    // webhook event as processed in the same transaction.
    saveSubscription({ subscriptionId, userId, customerId, fields, event, now = new Date() }) {
      db.exec('BEGIN');
      try {
        if (subscriptionId) {
          const existing = q.subscription.get(subscriptionId);
          if (existing && existing.user_id !== userId) throw new Error(`Subscription ${subscriptionId} belongs to another user`);
          const pastDueSince = fields.status === 'past_due' ? existing?.past_due_since || now.toISOString() : null;
          q.upsert.run(
            subscriptionId, userId, customerId, fields.priceId, fields.interval, fields.plan, fields.status, fields.currentPeriodEnd,
            fields.cancelAtPeriodEnd, fields.cancelAt, fields.canceledAt, fields.endedAt, pastDueSince, now.toISOString(),
          );
        }
        if (event) q.markEvent.run(event.id, event.type, now.toISOString());
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    markEvent: (event) => q.markEvent.run(event.id, event.type, new Date().toISOString()),

    // The plan a user has right now: 'premium' or 'free'.
    planOf(userId, now = new Date()) {
      return q.subscriptionsOf.all(userId).some((row) => grantsPremium(row, now)) ? 'premium' : 'free';
    },
  };
}
