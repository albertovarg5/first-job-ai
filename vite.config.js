import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createAiHandler } from './server/aiHandler.js';

// Adds the /api/ai routes to the local Vite server.
// loadEnv(..., '') reads ALL variables from .env into this Node process only.
// Vite only exposes variables that start with VITE_ to the browser, so
// ANTHROPIC_API_KEY stays on your computer's server side and is never bundled.
function aiApiPlugin(env) {
  const handler = createAiHandler(env);
  return {
    name: 'first-job-ai-api',
    configureServer(server) {
      server.middlewares.use('/api/ai', handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/ai', handler);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), aiApiPlugin(env)],
    server: { port: 5173, open: true },
  };
});
