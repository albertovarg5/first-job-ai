import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Logo } from '../components/AppLayout.jsx';
import { Field, Spinner } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { loadData } from '../lib/storage.js';
import { isValidEmail } from '../lib/utils.js';

function AuthShell({ title, subtitle, children, footer }) {
  const auth = useAuth();
  return (
    <div className="onboarding auth-page">
      <header className="onboarding-top auth-top">
        <Logo />
        <Link to="/" className="subtle">
          Back to home
        </Link>
      </header>
      <main className="onboarding-card panel auth-card">
        <h1>{title}</h1>
        {subtitle && <p className="muted onboarding-sub">{subtitle}</p>}
        {!auth.serverAvailable && auth.status === 'ready' ? (
          <div className="alert alert-warn">
            <Icon name="alert" size={16} /> Accounts need the First Job AI server, which isn’t reachable right now. You can keep using the app as a guest — your data stays
            in this browser.
          </div>
        ) : (
          children
        )}
      </main>
      {footer && <p className="auth-footer subtle">{footer}</p>}
    </div>
  );
}

function PasswordInput({ id, value, onChange, autoComplete, show }) {
  return <input id={id} type={show ? 'text' : 'password'} className="input" value={value} onChange={onChange} autoComplete={autoComplete} maxLength={200} />;
}

const emailError = (email) => (!email.trim() ? 'Enter your email address.' : !isValidEmail(email.trim()) ? 'Enter a valid email address.' : null);

export function SignIn() {
  const auth = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  if (auth.user) return <Navigate to="/dashboard" replace />;

  const submit = async (e) => {
    e.preventDefault();
    const errs = { email: emailError(form.email), password: form.password ? null : 'Enter your password.' };
    setErrors(errs);
    if (errs.email || errs.password) return;
    setBusy(true);
    try {
      await auth.signIn(form.email.trim(), form.password);
      toast.success('Signed in.');
      navigate(location.state?.from || '/dashboard', { replace: true });
    } catch (err) {
      setErrors({ form: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle="Your resume, applications and saved jobs follow you to any device."
      footer={
        <>
          New here? <Link to="/signup">Create an account</Link> · or <Link to="/onboarding">continue without one</Link>
        </>
      }
    >
      <form className="form-stack" onSubmit={submit} noValidate>
        {errors.form && (
          <div className="alert alert-error" role="alert">
            <Icon name="alert" size={16} /> {errors.form}
          </div>
        )}
        <Field label="Email" id="si-email" error={errors.email}>
          <input id="si-email" type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" maxLength={254} />
        </Field>
        <Field label="Password" id="si-password" error={errors.password}>
          <PasswordInput id="si-password" value={form.password} show={show} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="current-password" />
        </Field>
        <div className="auth-row">
          <label className="checkbox">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show password
          </label>
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy && <Spinner />} Sign in
        </button>
      </form>
    </AuthShell>
  );
}

export function SignUp() {
  const auth = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [hasLocal] = useState(() => Boolean(loadData().profile));
  const [form, setForm] = useState({ email: '', password: '', confirm: '', importLocal: true });
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  if (auth.user) return <Navigate to="/dashboard" replace />;

  const submit = async (e) => {
    e.preventDefault();
    const errs = {
      email: emailError(form.email),
      password: form.password.length < 8 ? 'Use at least 8 characters.' : null,
      confirm: form.confirm !== form.password ? 'The passwords don’t match.' : null,
    };
    setErrors(errs);
    if (errs.email || errs.password || errs.confirm) return;
    setBusy(true);
    try {
      await auth.signUp(form.email.trim(), form.password, { importLocal: hasLocal && form.importLocal });
      toast.success('Account created. You’re signed in.');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      if (err.code === 'weak_password') setErrors({ password: err.message });
      else if (err.code === 'invalid_email') setErrors({ email: err.message });
      else setErrors({ form: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Free. Keeps your job search saved and private to you, on any device."
      footer={
        <>
          Already have an account? <Link to="/signin">Sign in</Link>
        </>
      }
    >
      <form className="form-stack" onSubmit={submit} noValidate>
        {errors.form && (
          <div className="alert alert-error" role="alert">
            <Icon name="alert" size={16} /> {errors.form}
            {/already exists/.test(errors.form) && (
              <>
                {' '}
                <Link to="/signin">Sign in</Link>
              </>
            )}
          </div>
        )}
        <Field label="Email" id="su-email" error={errors.email}>
          <input id="su-email" type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" maxLength={254} />
        </Field>
        <Field label="Password" id="su-password" error={errors.password} hint="At least 8 characters. A short phrase is easy to remember and hard to guess.">
          <PasswordInput id="su-password" value={form.password} show={show} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
        </Field>
        <Field label="Confirm password" id="su-confirm" error={errors.confirm}>
          <PasswordInput id="su-confirm" value={form.confirm} show={show} onChange={(e) => setForm({ ...form, confirm: e.target.value })} autoComplete="new-password" />
        </Field>
        <label className="checkbox">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show password
        </label>
        {hasLocal && (
          <label className="checkbox import-check">
            <input type="checkbox" checked={form.importLocal} onChange={(e) => setForm({ ...form, importLocal: e.target.checked })} />
            Copy the profile, resume and applications saved in this browser into my new account
          </label>
        )}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy && <Spinner />} Create account
        </button>
        <p className="subtle">Your data is stored on this app’s server and is only visible when you’re signed in. You can delete your account anytime in Settings.</p>
      </form>
    </AuthShell>
  );
}

export function ForgotPassword() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const err = emailError(email);
    setError(err || '');
    if (err) return;
    setBusy(true);
    try {
      const res = await auth.forgotPassword(email.trim());
      setMessage(res.message);
    } catch (ex) {
      setError(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email you signed up with and we’ll send you a link to choose a new password."
      footer={<Link to="/signin">Back to sign in</Link>}
    >
      {auth.passwordReset === 'unavailable' ? (
        <div className="alert alert-warn">
          <Icon name="alert" size={16} /> Password reset by email isn’t set up on this server yet. Contact the person who runs this site.
        </div>
      ) : message ? (
        <div className="alert alert-success" role="status">
          <Icon name="check" size={16} /> {message}
        </div>
      ) : (
        <form className="form-stack" onSubmit={submit} noValidate>
          <Field label="Email" id="fp-email" error={error}>
            <input id="fp-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} />
          </Field>
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
            {busy && <Spinner />} Send reset link
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPassword() {
  const auth = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const errs = {
      password: form.password.length < 8 ? 'Use at least 8 characters.' : null,
      confirm: form.confirm !== form.password ? 'The passwords don’t match.' : null,
    };
    setErrors(errs);
    if (errs.password || errs.confirm) return;
    setBusy(true);
    try {
      await auth.resetPassword(token, form.password);
      toast.success('Password changed. You’re signed in.');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setErrors(err.code === 'weak_password' ? { password: err.message } : { form: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Choose a new password" footer={<Link to="/signin">Back to sign in</Link>}>
      {!token ? (
        <div className="alert alert-error">
          <Icon name="alert" size={16} /> This link is missing its reset code. Open the link from your email again, or <Link to="/forgot-password">ask for a new one</Link>.
        </div>
      ) : (
        <form className="form-stack" onSubmit={submit} noValidate>
          {errors.form && (
            <div className="alert alert-error" role="alert">
              <Icon name="alert" size={16} /> {errors.form} <Link to="/forgot-password">Get a new link</Link>
            </div>
          )}
          <Field label="New password" id="rp-password" error={errors.password} hint="At least 8 characters.">
            <PasswordInput id="rp-password" value={form.password} show={show} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password" id="rp-confirm" error={errors.confirm}>
            <PasswordInput id="rp-confirm" value={form.confirm} show={show} onChange={(e) => setForm({ ...form, confirm: e.target.value })} autoComplete="new-password" />
          </Field>
          <label className="checkbox">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show password
          </label>
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
            {busy && <Spinner />} Save new password
          </button>
        </form>
      )}
    </AuthShell>
  );
}
