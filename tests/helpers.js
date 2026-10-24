// Calls a connect-style handler with a fake request/response (no network).
export function call(handler, method, url, body, { headers = {}, ip = '127.0.0.1' } = {}) {
  return new Promise((resolve) => {
    const listeners = {};
    const req = {
      method,
      url,
      headers: { host: 'localhost:5173', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      socket: { remoteAddress: ip },
      on(ev, fn) {
        listeners[ev] = fn;
        // Emit the body once the reader is listening for the end of it.
        if (ev === 'end') {
          setImmediate(() => {
            if (body !== undefined) listeners.data?.(typeof body === 'string' ? body : JSON.stringify(body));
            fn();
          });
        }
      },
    };
    const res = {
      statusCode: 200,
      headers: {},
      headersSent: false,
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      getHeader(k) {
        return this.headers[k.toLowerCase()];
      },
      end(text) {
        let parsed = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          /* not JSON */
        }
        resolve({ status: this.statusCode, body: parsed, headers: this.headers });
      },
    };
    Promise.resolve(handler(req, res, () => resolve({ status: 'next' }))).catch((err) => resolve({ status: 'threw', error: err }));
  });
}

// Replaces global fetch for the duration of fn.
export async function withFetch(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

export const jsonResponse = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
