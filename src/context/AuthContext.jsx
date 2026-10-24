import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api.js';
import { loadData } from '../lib/storage.js';

const AuthContext = createContext(null);

// Who is signed in. Without an account the app runs in guest mode and keeps
// data in this browser only (the original behaviour).
export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, passwordReset: 'unavailable', serverAvailable: true, requireAuthForApis: false });

  const refresh = useCallback(async () => {
    try {
      const [res, config] = await Promise.all([apiFetch('/api/auth/me'), apiFetch('/api/config').catch(() => ({}))]);
      setState({
        status: 'ready',
        user: res.user,
        passwordReset: res.passwordReset,
        serverAvailable: true,
        requireAuthForApis: Boolean(config.requireAuthForApis),
      });
      return res.user;
    } catch {
      // No server (e.g. static hosting): accounts are unavailable, guest mode works.
      setState({ status: 'ready', user: null, passwordReset: 'unavailable', serverAvailable: false, requireAuthForApis: false });
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signedIn = useCallback((user) => setState((s) => ({ ...s, status: 'ready', user })), []);

  const actions = useMemo(
    () => ({
      refresh,
      async signIn(email, password) {
        const res = await apiFetch('/api/auth/signin', { method: 'POST', body: { email, password } });
        signedIn(res.user);
        return res.user;
      },
      // importLocal copies this browser's guest data into the new account.
      async signUp(email, password, { importLocal = false } = {}) {
        const res = await apiFetch('/api/auth/signup', { method: 'POST', body: { email, password } });
        if (importLocal) {
          try {
            await apiFetch('/api/data', { method: 'PUT', body: { data: loadData(), baseRevision: 0 } });
          } catch {
            /* The account still works; the user can copy data later from Settings. */
          }
        }
        signedIn(res.user);
        return res.user;
      },
      async signOut() {
        try {
          await apiFetch('/api/auth/signout', { method: 'POST', body: {} });
        } finally {
          try {
            window.sessionStorage.clear();
          } catch {
            /* optional */
          }
          setState((s) => ({ ...s, user: null }));
        }
      },
      // Used when the server says the session expired.
      signedOut() {
        setState((s) => ({ ...s, user: null }));
      },
      forgotPassword(email) {
        return apiFetch('/api/auth/forgot', { method: 'POST', body: { email } });
      },
      async resetPassword(token, password) {
        const res = await apiFetch('/api/auth/reset', { method: 'POST', body: { token, password } });
        signedIn(res.user);
        return res.user;
      },
      changePassword(currentPassword, newPassword) {
        return apiFetch('/api/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
      },
      async deleteAccount(password) {
        await apiFetch('/api/auth/delete-account', { method: 'POST', body: { password } });
        setState((s) => ({ ...s, user: null }));
      },
    }),
    [refresh, signedIn],
  );

  const value = useMemo(() => ({ ...state, ...actions }), [state, actions]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
