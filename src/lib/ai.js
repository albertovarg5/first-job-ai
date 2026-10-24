// Browser-side helper for the AI routes. The browser never sees the API key;
// it only calls /api/ai/* on our own server (see server/aiHandler.js).
import { apiFetch } from './api.js';

export async function fetchAiStatus() {
  try {
    return await apiFetch('/api/ai/status');
  } catch {
    return { connected: false, model: null, error: null };
  }
}

export async function callAi(task, payload) {
  return apiFetch(`/api/ai/${task}`, {
    method: 'POST',
    body: payload,
    networkError: 'Could not reach the app server for AI. Make sure the app is running.',
  });
}
