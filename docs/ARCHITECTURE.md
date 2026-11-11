# Architecture

```
Browser ──► Vercel (React + Vite, static)
               │  /api/* and /healthz are proxied (vercel.json)
               ▼
            Railway (Node.js server)  ──► PostgreSQL
               │
               ├─► JSearch (job listings)
               ├─► Anthropic (optional AI)
               └─► Stripe (payments, disabled for Sprint 1)
```

## Layers

| Layer | Where | Job |
| --- | --- | --- |
| Pages / components | `src/pages`, `src/components` | What the user sees. No business rules. |
| Context | `src/context` | Shared state (signed-in user, saved data, toasts). |
| Plain logic | `src/lib` | Resume, tracker, missions, PDF... pure functions, easy to unit test. |
| HTTP handlers | `server/*Handler.js`, `server/api.js` | Validate input, call the store, return JSON or a clear error. |
| Stores | `server/billingStore.js`, `server/db.js` | The only code that reads/writes the database. |

## Design pattern: Repository (store) + factory with dependency injection

**Repository.** `server/billingStore.js` hides every SQL query about subscriptions behind
small functions (`createBillingStore(db)`). The rest of the server never writes SQL for
billing, and the store never talks to Stripe. Business rules such as `grantsPremium(row)`
are separate pure functions.

**Factory + dependency injection.** Handlers are built by functions that receive what they
need instead of importing it: `createDataHandler({ db, requireUser })`,
`createBillingStore(db)`, `createApi(env, options)`.

**Why it fits:** tests pass in a throwaway in-memory database (PGlite) or fake `fetch`, so
tests never touch production, Stripe, JSearch or Anthropic. Changing the database or an
external service only changes one file.

A second, frontend pattern is **Provider/Context** (`AuthContext`, `AppDataContext`,
`ToastContext`).

## Error handling

- Handlers validate input and return JSON errors with an HTTP status (400, 401, 403, 409, 429, 502...).
- Upstream failures (bad API key, rate limit, timeout, no credit) are mapped to plain-English messages.
- The frontend shows errors as toasts or banners (`ApiError` in `src/lib`) and never fakes data.
