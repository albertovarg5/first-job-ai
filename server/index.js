// Production server: serves the built app from dist/ and every /api route.
//
//   npm run build
//   npm start
//
// Environment variables are read from the real environment (set them in your
// hosting provider's dashboard). For local testing, a .env file is loaded too.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './api.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distDir = join(root, 'dist');

// Minimal .env loader for local use. Real environment variables win.
function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadDotEnv(join(root, '.env'));
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const target = normalize(join(distDir, urlPath));
  // Block path traversal outside dist/.
  const inside = target === distDir || target.startsWith(distDir + sep);
  let file = inside ? target : null;
  try {
    if (file && (await stat(file)).isDirectory()) file = join(file, 'index.html');
    if (file) await stat(file);
  } catch {
    file = null;
  }
  const isAsset = urlPath.startsWith('/assets/');
  if (!file) {
    if (isAsset || extname(urlPath)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.end('Not found');
    }
    file = join(distDir, 'index.html'); // Single-page app: let React Router handle the path.
  }
  const body = await readFile(file);
  res.statusCode = 200;
  res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', isAsset ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.end(body);
}

if (!existsSync(join(distDir, 'index.html'))) {
  console.error('dist/ is missing. Run "npm run build" first.');
  process.exit(1);
}

const api = createApi(process.env);
const port = Number(process.env.PORT) || 3000;

const server = createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  }
  try {
    const path = (req.url || '/').split('?')[0];
    if (path === '/api' || path.startsWith('/api/')) {
      req.url = req.url.slice(4) || '/';
      return await api(req, res);
    }
    if (path === '/healthz') {
      res.setHeader('Content-Type', 'text/plain');
      return res.end('ok');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      return res.end();
    }
    return await serveStatic(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
    res.end('Something went wrong.');
  }
});

try {
  await api.ready(); // Open the database (and run migrations) before accepting traffic.
} catch (err) {
  console.error('Could not open the database:', err.message);
  process.exit(1);
}

server.listen(port, () => {
  console.log(`First Job AI is running at http://localhost:${port}`);
});
