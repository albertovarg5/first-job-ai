// Subscription plans and the monthly AI allowance that comes with each one.
//
// There are no payments yet. Every account is on "free". When billing is
// added (for example Stripe Checkout + a webhook), the webhook only needs to
// set users.plan to "premium" or back to "free"; everything else here
// already reads the plan from the database.
//
// Limits can be changed without code changes:
//   AI_FREE_MONTHLY_LIMIT     (default 30)
//   AI_PREMIUM_MONTHLY_LIMIT  (default 300)

export const PLANS = {
  free: { id: 'free', label: 'Free', aiMonthly: 30 },
  premium: { id: 'premium', label: 'Premium', aiMonthly: 300 },
};

function limitFrom(value, fallback) {
  const n = Number(String(value ?? '').trim());
  return String(value ?? '').trim() !== '' && Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function planLimits(env = {}) {
  return {
    free: limitFrom(env.AI_FREE_MONTHLY_LIMIT, PLANS.free.aiMonthly),
    premium: limitFrom(env.AI_PREMIUM_MONTHLY_LIMIT, PLANS.premium.aiMonthly),
  };
}

// Usage resets on the 1st of each month (UTC).
export const currentPeriod = (now = new Date()) => now.toISOString().slice(0, 7);

export function nextResetDate(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

// Counts AI requests per signed-in user and month. A request reserves one
// unit before it runs and is refunded if it fails, so users are only charged
// against their allowance for answers they actually received.
export function createAiQuota(db, env = {}, { now = () => new Date() } = {}) {
  const limits = planLimits(env);
  const q = {
    plan: db.prepare('SELECT plan FROM users WHERE id = ?'),
    ensure: db.prepare('INSERT INTO ai_usage (user_id, period, count) VALUES (?, ?, 0) ON CONFLICT(user_id, period) DO NOTHING'),
    take: db.prepare('UPDATE ai_usage SET count = count + 1 WHERE user_id = ? AND period = ? AND count < ?'),
    refund: db.prepare('UPDATE ai_usage SET count = count - 1 WHERE user_id = ? AND period = ? AND count > 0'),
    used: db.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND period = ?'),
  };

  function usage(userId) {
    const stored = q.plan.get(userId)?.plan;
    const plan = PLANS[stored] ? stored : 'free';
    const period = currentPeriod(now());
    return {
      plan,
      planLabel: PLANS[plan].label,
      used: q.used.get(userId, period)?.count || 0,
      limit: limits[plan],
      resetsOn: nextResetDate(now()),
    };
  }

  // Returns { ok: true, period } or { ok: false, usage }.
  function reserve(userId) {
    const u = usage(userId);
    const period = currentPeriod(now());
    q.ensure.run(userId, period);
    if (q.take.run(userId, period, u.limit).changes === 1) return { ok: true, period };
    return { ok: false, usage: u };
  }

  function refund(userId, period) {
    q.refund.run(userId, period);
  }

  return { usage, reserve, refund };
}

export function limitReachedMessage(u) {
  return `You’ve used all ${u.limit} AI requests included in the ${u.planLabel} plan this month. They reset on ${u.resetsOn}. The Basic-mode tools still work in the meantime.`;
}
