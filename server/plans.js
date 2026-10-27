// Subscription plans and the monthly AI allowance that comes with each one.
//
// A user's plan comes only from their Stripe subscription as stored by the
// verified webhook (see server/billingStore.js, planOf). Accounts without an
// active subscription are on "free".
//
// Limits can be changed without code changes:
//   AI_FREE_MONTHLY_LIMIT     (default 20)
//   AI_PREMIUM_MONTHLY_LIMIT  (default 200)
//   AI_NEW_ACCOUNT_DAILY_TOTAL (default 300, 0 = no cap) Free accounts younger than
//                             NEW_ACCOUNT_DAYS together, per UTC day. Throwaway accounts
//                             can only use this pool, never established users' requests.
//   AI_FREE_DAILY_TOTAL       (default 3000, 0 = no cap) all Free accounts together per
//                             UTC day: a last backstop for the AI bill.
// Premium is never limited by either pool.

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

// Accounts younger than this use the new-account daily pool (see createAiQuota).
export const NEW_ACCOUNT_DAYS = 7;

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
  // [api_usage service name, daily cap, applies to this account?]
  const pools = [
    ['ai_new', limitFrom(env.AI_NEW_ACCOUNT_DAILY_TOTAL, 300), (createdAt, t) => Date.parse(createdAt) > t.getTime() - NEW_ACCOUNT_DAYS * 86400000],
    ['ai_free', limitFrom(env.AI_FREE_DAILY_TOTAL, 3000), () => true],
  ].filter(([, cap]) => cap > 0);
  const takePool = (day, service, cap) =>
    db.run(
      'INSERT INTO api_usage (period, service, count) VALUES ($1, $2, 1) ON CONFLICT (period, service) DO UPDATE SET count = api_usage.count + 1 WHERE api_usage.count < $3',
      [day, service, cap],
    );
  const givePool = (day, service) => db.run('UPDATE api_usage SET count = count - 1 WHERE period = $1 AND service = $2 AND count > 0', [day, service]);

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

  // Returns { ok: true, period, day, pools } or { ok: false, usage, busy?, retryAfter? }
  // (busy: 'new' or 'free', the daily pool that is used up). Every count is a single
  // atomic UPDATE, so parallel requests can never go over a limit.
  async function reserve(userId) {
    const u = await usage(userId);
    const t = now();
    const period = currentPeriod(t);
    await db.run('INSERT INTO ai_usage (user_id, period, count) VALUES ($1, $2, 0) ON CONFLICT (user_id, period) DO NOTHING', [userId, period]);
    if ((await db.run('UPDATE ai_usage SET count = count + 1 WHERE user_id = $1 AND period = $2 AND count < $3', [userId, period, u.limit])) !== 1) return { ok: false, usage: u };
    const reservation = { ok: true, period, day: t.toISOString().slice(0, 10), pools: [] };
    if (u.plan !== 'free') return reservation;
    const createdAt = (await db.one('SELECT created_at FROM users WHERE id = $1', [userId]))?.created_at;
    for (const [service, cap, applies] of pools) {
      if (!applies(createdAt, t)) continue;
      if ((await takePool(reservation.day, service, cap)) === 1) {
        reservation.pools.push(service);
        continue;
      }
      await refund(userId, reservation);
      const retryAfter = Math.ceil((Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1) - t.getTime()) / 1000);
      return { ok: false, usage: u, busy: service === 'ai_new' ? 'new' : 'free', retryAfter };
    }
    return reservation;
  }

  // Gives back everything a reservation took (the AI call failed or a pool was full).
  async function refund(userId, { period, day, pools: taken = [] }) {
    await db.run('UPDATE ai_usage SET count = count - 1 WHERE user_id = $1 AND period = $2 AND count > 0', [userId, period]);
    for (const service of taken) await givePool(day, service);
  }

  return { usage, reserve, refund };
}

// upgrade: true only when Premium can really be bought on this server.
export function limitReachedMessage(u, { upgrade = false, premiumLimit } = {}) {
  const base = `You’ve used all ${u.limit} AI requests included in the ${u.planLabel} plan this month. They reset on ${u.resetsOn}. The Basic-mode tools still work in the meantime.`;
  return upgrade && u.plan === 'free' ? `${base} Premium includes ${premiumLimit} AI requests a month (Settings → Plan).` : base;
}
