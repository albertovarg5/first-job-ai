// Subscription plans and the monthly AI allowance that comes with each one.
//
// A user's plan comes only from their Stripe subscription as stored by the
// verified webhook (see server/billingStore.js, planOf). Accounts without an
// active subscription are on "free".
//
// Limits can be changed without code changes:
//   AI_FREE_MONTHLY_LIMIT     (default 20)
//   AI_PREMIUM_MONTHLY_LIMIT  (default 200)

export const PLANS = {
  free: { id: 'free', label: 'Free', aiMonthly: 20 },
  premium: { id: 'premium', label: 'Premium', aiMonthly: 200 },
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
export function createAiQuota(db, env = {}, { now = () => new Date(), planOf } = {}) {
  const limits = planLimits(env);
  async function usage(userId) {
    const current = await planOf?.(userId, now());
    const plan = PLANS[current] ? current : 'free';
    const period = currentPeriod(now());
    const row = await db.one('SELECT count FROM ai_usage WHERE user_id = $1 AND period = $2', [userId, period]);
    return {
      plan,
      planLabel: PLANS[plan].label,
      used: row?.count || 0,
      limit: limits[plan],
      resetsOn: nextResetDate(now()),
    };
  }

  // Returns { ok: true, period } or { ok: false, usage }. The UPDATE is atomic,
  // so parallel requests can never go over the limit.
  async function reserve(userId) {
    const u = await usage(userId);
    const period = currentPeriod(now());
    await db.run('INSERT INTO ai_usage (user_id, period, count) VALUES ($1, $2, 0) ON CONFLICT (user_id, period) DO NOTHING', [userId, period]);
    if ((await db.run('UPDATE ai_usage SET count = count + 1 WHERE user_id = $1 AND period = $2 AND count < $3', [userId, period, u.limit])) === 1) return { ok: true, period };
    return { ok: false, usage: u };
  }

  function refund(userId, period) {
    return db.run('UPDATE ai_usage SET count = count - 1 WHERE user_id = $1 AND period = $2 AND count > 0', [userId, period]);
  }

  return { usage, reserve, refund };
}

// upgrade: true only when Premium can really be bought on this server.
export function limitReachedMessage(u, { upgrade = false, premiumLimit } = {}) {
  const base = `You’ve used all ${u.limit} AI requests included in the ${u.planLabel} plan this month. They reset on ${u.resetsOn}. The Basic-mode tools still work in the meantime.`;
  return upgrade && u.plan === 'free' ? `${base} Premium includes ${premiumLimit} AI requests a month (Settings → Plan).` : base;
}
