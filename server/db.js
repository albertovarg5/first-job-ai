// PostgreSQL database.
//
//   DATABASE_URL=postgresql://...  a real PostgreSQL server (production, e.g. Railway)
//   not set                        PGlite: the same PostgreSQL, embedded, stored in
//                                  data/pglite (local development and tests only)
//
// Migrations run automatically and only ever add tables/columns. Every query
// goes through db.one / db.all / db.run with $1, $2... parameters.

export const MIGRATIONS = [
  // Accounts, sessions, saved data, AI usage, Stripe billing. Same tables and
  // columns as the earlier SQLite database, so `npm run db:import` copies it 1:1.
  // users.plan is no longer read (the plan comes from `subscriptions`); kept so imports are lossless.
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE,
     password_hash TEXT NOT NULL,
     created_at TEXT NOT NULL,
     password_changed_at TEXT NOT NULL,
     plan TEXT NOT NULL DEFAULT 'free'
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE password_resets (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at TEXT NOT NULL,
     used_at TEXT
   );
   CREATE TABLE user_data (
     user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     data TEXT NOT NULL,
     revision INTEGER NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE api_usage (
     period TEXT NOT NULL,
     service TEXT NOT NULL,
     count INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (period, service)
   );
   CREATE TABLE ai_usage (
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     period TEXT NOT NULL,
     count INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, period)
   );
   -- Only Stripe ids and subscription state: never card numbers or other payment details.
   -- livemode: 1 = live, 0 = test, so test data never grants Premium under a live key.
   CREATE TABLE billing_customers (
     user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     stripe_customer_id TEXT NOT NULL UNIQUE,
     created_at TEXT NOT NULL,
     livemode INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE subscriptions (
     stripe_subscription_id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     stripe_customer_id TEXT NOT NULL,
     price_id TEXT,
     interval TEXT,
     plan TEXT NOT NULL,
     status TEXT NOT NULL,
     current_period_end TEXT,
     cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
     cancel_at TEXT,
     canceled_at TEXT,
     ended_at TEXT,
     past_due_since TEXT,
     updated_at TEXT NOT NULL,
     livemode INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX subscriptions_user ON subscriptions(user_id);
   CREATE TABLE stripe_events (
     id TEXT PRIMARY KEY,
     type TEXT NOT NULL,
     processed_at TEXT NOT NULL
   );`,
  // Rate limits shared by every server instance and kept across restarts (window_start in ms),
  // session inactivity, browsers that signed in successfully before, and sign-ups waiting
  // for their email to be confirmed (the account is only created once it is).
  `CREATE TABLE rate_limits (
     key TEXT PRIMARY KEY,
     window_start BIGINT NOT NULL,
     count INTEGER NOT NULL
   );
   ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
   -- Sessions open at upgrade time count as used now, so nobody is signed out by the deploy.
   UPDATE sessions SET last_seen_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
   CREATE TABLE trusted_devices (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at TEXT NOT NULL
   );
   CREATE INDEX trusted_devices_user ON trusted_devices(user_id);
   CREATE TABLE email_verifications (
     token_hash TEXT PRIMARY KEY,
     email TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     expires_at TEXT NOT NULL
   );
   CREATE INDEX email_verifications_email ON email_verifications(email);`,
];

// The tables in an order that respects foreign keys (used by import and backup).
export const TABLES = ['users', 'sessions', 'password_resets', 'user_data', 'api_usage', 'ai_usage', 'billing_customers', 'subscriptions', 'stripe_events'];

export const isPostgresUrl = (target) => /^postgres(ql)?:\/\//i.test(String(target || ''));

// For logs: host and database name only, never the password.
export function describeTarget(target) {
  if (!isPostgresUrl(target)) return `local development database (PGlite) in ${target}`;
  try {
    const u = new URL(target);
    return `PostgreSQL at ${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return 'PostgreSQL (DATABASE_URL could not be parsed)';
  }
}

// For script output: removes the address and its password from an error message.
export function maskSecrets(message, target) {
  let out = String(message);
  const t = String(target || '');
  if (t) out = out.replaceAll(t, '<DATABASE_URL>');
  try {
    const { password } = new URL(t);
    if (password) {
      out = out.replaceAll(password, '***');
      out = out.replaceAll(decodeURIComponent(password), '***'); // May throw on a malformed %-escape: the raw form is already masked.
    }
  } catch {
    /* not a URL */
  }
  return out;
}

// q(sql, params) -> { rows, rowCount } for both pg and PGlite.
function wrap(q, extra) {
  return {
    one: async (sql, params) => (await q(sql, params)).rows[0] ?? null,
    all: async (sql, params) => (await q(sql, params)).rows,
    run: async (sql, params) => (await q(sql, params)).rowCount ?? 0,
    ...extra,
  };
}

// target: a postgres:// URL, a PGlite folder, or ':memory:' (tests).
// migrate: false for scripts that must not change the schema (they check it themselves).
export async function openDatabase(target = 'data/pglite', { migrate: runMigrations = true } = {}) {
  let db;
  if (isPostgresUrl(target)) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: target, max: 10, connectionTimeoutMillis: 10000 });
    pool.on('error', (err) => console.error('[db] Idle connection error:', err.message));
    db = wrap((sql, params) => pool.query(sql, params), {
      kind: 'postgres',
      exec: (sql) => pool.query(sql),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn(wrap((sql, params) => client.query(sql, params), { exec: (sql) => client.query(sql) }));
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    });
  } else {
    // Dev/test only: PGlite is a devDependency and is never loaded when DATABASE_URL is set.
    const { PGlite } = await import('@electric-sql/pglite');
    const unlock = target === ':memory:' ? () => {} : await lockFolder(target);
    let lite;
    try {
      lite = new PGlite(target === ':memory:' ? undefined : target);
      await lite.waitReady;
    } catch (err) {
      unlock();
      throw err;
    }
    db = wrap((sql, params) => lite.query(sql, params), {
      kind: 'pglite',
      exec: (sql) => lite.exec(sql),
      tx: (fn) => lite.transaction((t) => fn(wrap((sql, params) => t.query(sql, params), { exec: (sql) => t.exec(sql) }))),
      close: () => lite.close().finally(unlock),
    });
  }
  if (runMigrations) await migrate(db);
  return db;
}

// PGlite has no lock of its own: two processes on one folder would corrupt it.
// A lock file with the owner's process id stops the second one; a lock left
// by a process that no longer runs is taken over.
async function lockFolder(dir) {
  const { mkdirSync, openSync, writeSync, closeSync, readFileSync, rmSync } = await import('node:fs');
  mkdirSync(dir, { recursive: true });
  const file = `${dir}.lock`;
  for (let attempt = 0; ; attempt++) {
    try {
      const fd = openSync(file, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST' || attempt > 0) throw err;
      const pid = Number(readFileSync(file, 'utf8'));
      let alive = false;
      try {
        alive = pid > 0 && pid !== process.pid && process.kill(pid, 0);
      } catch (e) {
        alive = e.code === 'EPERM'; // exists, owned by someone else
      }
      if (alive) {
        throw new Error(`The local database in ${dir} is already open in another program (process ${pid}). Stop the other "npm run dev" / "npm start" first, or set DATABASE_URL. If nothing else is running, delete ${file}.`);
      }
      rmSync(file, { force: true });
    }
  }
  const unlock = () => rmSync(file, { force: true });
  process.once('exit', unlock);
  return unlock;
}

async function migrate(db) {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  // One migration per transaction. The advisory lock keeps two app instances
  // starting at once (e.g. during a deploy) from running the same migration.
  for (;;) {
    const done = await db.tx(async (t) => {
      await t.one('SELECT pg_advisory_xact_lock(4242)');
      const row = await t.one('SELECT version FROM schema_version');
      if (!row) await t.run('INSERT INTO schema_version (version) VALUES (0)');
      const version = row?.version ?? 0;
      if (version >= MIGRATIONS.length) return true;
      await t.exec(MIGRATIONS[version]);
      await t.run('UPDATE schema_version SET version = $1', [version + 1]);
      return false;
    });
    if (done) return;
  }
}

// Usage counter for external APIs (e.g. JSearch monthly limit).
export function dbUsageStore(db) {
  return {
    count: async (period, service) => (await db.one('SELECT count FROM api_usage WHERE period = $1 AND service = $2', [period, service]))?.count || 0,
    increment: (period, service) =>
      db.run('INSERT INTO api_usage (period, service, count) VALUES ($1, $2, 1) ON CONFLICT (period, service) DO UPDATE SET count = api_usage.count + 1', [period, service]),
  };
}
