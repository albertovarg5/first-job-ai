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

// live: true/false for the mode of the current Stripe key; only rows from that
// mode are read. null (no key set) reads both, so paying customers keep
// Premium if the key is ever missing.
export function createBillingStore(db, live = null) {
  const mode = live === null ? null : live ? 1 : 0;
  const SUBSCRIPTIONS_OF = 'SELECT * FROM subscriptions WHERE user_id = $1 AND livemode = COALESCE($2, livemode) ORDER BY updated_at DESC';
  const customerOf = async (userId) =>
    (await db.one('SELECT stripe_customer_id FROM billing_customers WHERE user_id = $1 AND livemode = COALESCE($2, livemode)', [userId, mode]))?.stripe_customer_id || null;
  const markEvent = (t, event, now = new Date()) =>
    t.run('INSERT INTO stripe_events (id, type, processed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [event.id, event.type, now.toISOString()]);

  return {
    customerOf,
    userOfCustomer: async (customerId) => (await db.one('SELECT user_id FROM billing_customers WHERE stripe_customer_id = $1', [customerId]))?.user_id || null,
    async linkCustomer(userId, customerId) {
      // A customer from the other mode is replaced; one from this mode is kept (two tabs racing).
      await db.run(
        `INSERT INTO billing_customers (user_id, stripe_customer_id, created_at, livemode) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = excluded.stripe_customer_id, created_at = excluded.created_at, livemode = excluded.livemode
         WHERE billing_customers.livemode != excluded.livemode`,
        [userId, customerId, new Date().toISOString(), mode ?? 0],
      );
      return customerOf(userId);
    },
    subscriptionsOf: (userId) => db.all(SUBSCRIPTIONS_OF, [userId, mode]),
    eventSeen: async (id) => Boolean(await db.one('SELECT 1 FROM stripe_events WHERE id = $1', [id])),

    // Saves the latest state of one subscription and, when given, marks the
    // webhook event as processed in the same transaction.
    saveSubscription({ subscriptionId, userId, customerId, fields, event, now = new Date() }) {
      return db.tx(async (t) => {
        if (subscriptionId) {
          const existing = await t.one('SELECT * FROM subscriptions WHERE stripe_subscription_id = $1 FOR UPDATE', [subscriptionId]);
          if (existing && existing.user_id !== userId) throw new Error(`Subscription ${subscriptionId} belongs to another user`);
          const pastDueSince = fields.status === 'past_due' ? existing?.past_due_since || now.toISOString() : null;
          await t.run(
            `INSERT INTO subscriptions
               (stripe_subscription_id, user_id, stripe_customer_id, price_id, interval, plan, status, current_period_end,
                cancel_at_period_end, cancel_at, canceled_at, ended_at, past_due_since, updated_at, livemode)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
             ON CONFLICT (stripe_subscription_id) DO UPDATE SET
               price_id = excluded.price_id, interval = excluded.interval, plan = excluded.plan, status = excluded.status,
               current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
               cancel_at = excluded.cancel_at, canceled_at = excluded.canceled_at, ended_at = excluded.ended_at,
               past_due_since = excluded.past_due_since, updated_at = excluded.updated_at`,
            [
              subscriptionId, userId, customerId, fields.priceId, fields.interval, fields.plan, fields.status, fields.currentPeriodEnd,
              fields.cancelAtPeriodEnd, fields.cancelAt, fields.canceledAt, fields.endedAt, pastDueSince, now.toISOString(), mode ?? 0,
            ],
          );
        }
        if (event) await markEvent(t, event, now);
      });
    },

    markEvent: (event) => markEvent(db, event),

    // The plan a user has right now: 'premium' or 'free'.
    async planOf(userId, now = new Date()) {
      return (await db.all(SUBSCRIPTIONS_OF, [userId, mode])).some((row) => grantsPremium(row, now)) ? 'premium' : 'free';
    },
  };
}
