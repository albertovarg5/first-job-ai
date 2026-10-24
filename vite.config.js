import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createApi } from './server/api.js';
import { checkConfig, reportConfig } from './server/config.js';

// Adds the /api routes (AI, job search, accounts, saved data) to the local
// Vite server. loadEnv(..., '') reads ALL variables from .env into this Node
// process only. Vite only exposes variables that start with VITE_ to the
// browser, so API keys stay on the server side and are never bundled.
function apiPlugin(env) {
  let api;
  const handler = (req, res, next) => {
    api ??= createApi(env);
    return api(req, res, next);
  };
  return {
    name: 'first-job-ai-api',
    configureServer(server) {
      reportConfig(env);
      server.middlewares.use('/api', handler);
    },
    configurePreviewServer(server) {
      reportConfig(env);
      server.middlewares.use('/api', handler);
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Refuse to build a bundle while a secret is named VITE_* (it could end up in the browser).
  if (command === 'build') {
    const { errors } = checkConfig(env);
    if (errors.length) throw new Error(errors.join('\n'));
  }
  return {
    plugins: [react(), apiPlugin(env)],
    server: { port: 5173, open: true },
  };
});
