// Sign-up with email confirmation, rendered for real with React in a simulated
// browser (jsdom), like tests/pricing.test.js. Only fetch() is replaced.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173/signup', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true, writable: true });
}
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let vite, React, act, createRoot, MemoryRouter, Routes, Route, AuthProvider, ToastProvider, SignUp, VerifyEmail;

before(async () => {
  vite = await createServer({ configFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, esbuild: { jsx: 'automatic' } });
  React = await import('react');
  ({ act } = React);
  ({ createRoot } = await import('react-dom/client'));
  ({ MemoryRouter, Routes, Route } = await import('react-router-dom'));
  ({ AuthProvider } = await vite.ssrLoadModule('/src/context/AuthContext.jsx'));
  ({ ToastProvider } = await vite.ssrLoadModule('/src/context/ToastContext.jsx'));
  ({ SignUp, VerifyEmail } = await vite.ssrLoadModule('/src/pages/Auth.jsx'));
});

after(async () => {
  await vite?.close();
  dom.window.close();
});

function fakeServer(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method, url, body });
    const handler = routes[`${method} ${url}`];
    const [code, data] = !handler ? [404, { error: 'Not found' }] : typeof handler === 'function' ? handler(body) : [200, handler];
    return new Response(JSON.stringify(data), { status: code, headers: { 'content-type': 'application/json' } });
  };
  return calls;
}

const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)));

async function render(path) {
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  const root = createRoot(container);
  const h = React.createElement;
  await act(async () => {
    root.render(
      h(MemoryRouter, { initialEntries: [path] }, h(ToastProvider, null, h(AuthProvider, null, h(Routes, null,
        h(Route, { path: '/signup', element: h(SignUp) }),
        h(Route, { path: '/verify-email', element: h(VerifyEmail) }),
        h(Route, { path: '/dashboard', element: h('p', null, 'DASHBOARD') }),
      )))),
    );
  });
  await settle();
  const type = async (id, value) => {
    const el = container.querySelector(`#${id}`);
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(el, value);
    await act(async () => el.dispatchEvent(new dom.window.Event('input', { bubbles: true })));
  };
  const submit = async () => {
    await act(async () => container.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    await settle();
  };
  return { text: () => container.textContent.replace(/\s+/g, ' '), type, submit, unmount: () => act(async () => root.unmount()) };
}

const ME = { 'GET /api/auth/me': { user: null, passwordReset: 'email' }, 'GET /api/config': { requireAuthForApis: true } };

test('sign-up with email confirmation: "check your email", never signed in before the link is opened', async () => {
  const calls = fakeServer({ ...ME, 'POST /api/auth/signup': () => [202, { ok: true, verify: true, message: 'Almost done: check your email.' }] });
  const view = await render('/signup');
  await view.type('su-email', 'new@example.com');
  await view.type('su-password', 'a long pass phrase');
  await view.type('su-confirm', 'a long pass phrase');
  await view.submit();
  assert.match(view.text(), /Check your email/);
  assert.match(view.text(), /Almost done: check your email\./);
  assert.ok(!/DASHBOARD/.test(view.text()));
  assert.ok(!calls.some((c) => c.url === '/api/data'), 'nothing is saved to an account that does not exist yet');
  await view.unmount();
});

test('confirmation link: asks for the password, then signs in; a bad link explains what to do', async () => {
  const calls = fakeServer({
    ...ME,
    'POST /api/auth/verify': (body) =>
      body.password === 'a long pass phrase'
        ? [201, { user: { id: 'u1', email: 'new@example.com' } }]
        : [400, { error: 'That isn’t the password you chose when you signed up.', code: 'invalid_credentials' }],
  });
  const view = await render('/verify-email?token=tok123');
  await view.type('ve-password', 'wrong guess here');
  await view.submit();
  assert.match(view.text(), /isn’t the password you chose/);
  await view.type('ve-password', 'a long pass phrase');
  await view.submit();
  assert.deepEqual(calls.filter((c) => c.url === '/api/auth/verify').at(-1).body, { token: 'tok123', password: 'a long pass phrase' });
  assert.match(view.text(), /DASHBOARD/);
  await view.unmount();

  fakeServer({ ...ME, 'POST /api/auth/verify': () => [400, { error: 'This link is invalid or has expired. Sign up again to get a new one.', code: 'invalid_token' }] });
  const expired = await render('/verify-email?token=old');
  await expired.type('ve-password', 'a long pass phrase');
  await expired.submit();
  assert.match(expired.text(), /invalid or has expired.*Sign up again/);
  await expired.unmount();
});
