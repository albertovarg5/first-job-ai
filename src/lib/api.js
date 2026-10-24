// fetch() wrapper for our own /api routes. Sends cookies (for accounts),
// always uses JSON, and turns server errors into readable Error objects
// carrying the HTTP status and the server's error code.

export class ApiError extends Error {
  constructor(message, { status = 0, code = '', data = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export async function apiFetch(url, { method = 'GET', body, networkError, keepalive } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      keepalive,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(networkError || 'Could not reach the app server. Check your connection and that the app is running.', { code: 'network' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error || `The request failed (status ${res.status}).`, { status: res.status, code: data.code || '', data });
  }
  return data;
}
