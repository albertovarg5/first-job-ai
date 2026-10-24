// Browser-side helper for the local AI routes. The browser never sees the
// API key; it only calls /api/ai/* on the local server (see server/aiHandler.js).

export async function fetchAiStatus() {
  try {
    const res = await fetch('/api/ai/status');
    if (!res.ok) return { connected: false, model: null, error: null };
    return await res.json();
  } catch {
    return { connected: false, model: null, error: null };
  }
}

export async function callAi(task, payload) {
  let res;
  try {
    res = await fetch(`/api/ai/${task}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('Could not reach the local AI server. Make sure the app is running with "npm run dev".');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'The AI request failed.');
  return data;
}
