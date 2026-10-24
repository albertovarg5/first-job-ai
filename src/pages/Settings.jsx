import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { ConfirmDialog, Modal } from '../components/Modal.jsx';
import { Field, PageHeader, ProgressBar, Spinner } from '../components/ui.jsx';
import { apiFetch } from '../lib/api.js';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { loadData } from '../lib/storage.js';
import { EXPERIENCE_LEVELS, GOALS, SITUATIONS } from '../lib/profileOptions.js';
import { formatDate, isValidEmail, toDateKey } from '../lib/utils.js';

function ProfileForm() {
  const { data, actions } = useAppData();
  const toast = useToast();
  const [form, setForm] = useState(() => ({ goals: [], location: '', email: '', ...data.profile }));
  const [errors, setErrors] = useState({});

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const save = (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.name?.trim()) errs.name = 'Enter your name.';
    if (!form.targetRole?.trim()) errs.targetRole = 'Enter a target job title.';
    if (!isValidEmail(form.email)) errs.email = 'That email doesn’t look right.';
    if (!form.goals.length) errs.goals = 'Pick at least one goal.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    actions.saveProfile({ ...form, name: form.name.trim(), targetRole: form.targetRole.trim() });
    actions.logActivity('settings', 'Updated your profile');
    toast.success('Profile saved.');
  };

  const toggleGoal = (value) => {
    setForm((f) => ({ ...f, goals: f.goals.includes(value) ? f.goals.filter((g) => g !== value) : [...f.goals, value] }));
    setErrors((er) => ({ ...er, goals: undefined }));
  };

  return (
    <form className="panel" onSubmit={save} noValidate>
      <div className="panel-header">
        <div>
          <h2>Profile</h2>
          <p className="subtle">Used to personalize your dashboard, missions and interview questions.</p>
        </div>
      </div>
      <div className="panel-body form-grid">
        <Field label="Name" id="s-name" required error={errors.name}>
          <input id="s-name" className="input" value={form.name || ''} onChange={set('name')} />
        </Field>
        <Field label="Email" id="s-email" error={errors.email}>
          <input id="s-email" type="email" className="input" value={form.email || ''} onChange={set('email')} />
        </Field>
        <Field label="Target job title" id="s-role" required error={errors.targetRole}>
          <input id="s-role" className="input" value={form.targetRole || ''} onChange={set('targetRole')} />
        </Field>
        <Field label="Preferred location" id="s-loc">
          <input id="s-loc" className="input" value={form.location || ''} onChange={set('location')} />
        </Field>
        <Field label="Situation" id="s-sit">
          <select id="s-sit" className="select" value={form.situation || ''} onChange={set('situation')}>
            {SITUATIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Experience level" id="s-exp">
          <select id="s-exp" className="select" value={form.experienceLevel || ''} onChange={set('experienceLevel')}>
            {EXPERIENCE_LEVELS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Goals" error={errors.goals} className="span-2">
          <div className="goal-list">
            {GOALS.map((g) => (
              <label key={g.value} className={`goal ${form.goals.includes(g.value) ? 'selected' : ''}`}>
                <input type="checkbox" checked={form.goals.includes(g.value)} onChange={() => toggleGoal(g.value)} />
                <span className="goal-check">
                  <Icon name="check" size={13} strokeWidth={2.4} />
                </span>
                {g.label}
              </label>
            ))}
          </div>
        </Field>
      </div>
      <div className="panel-foot right">
        <button type="submit" className="btn btn-primary">
          Save profile
        </button>
      </div>
    </form>
  );
}

function AiSettings() {
  const { data, actions, aiStatus, aiLocked, refreshAiStatus } = useAppData();
  const toast = useToast();
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    const s = await refreshAiStatus();
    setChecking(false);
    if (s.connected) toast.success(`AI is connected (${s.model}).`);
    else toast.info('AI is not connected. The app is using Basic mode.');
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>AI connection</h2>
          <p className="subtle">AI is optional. Every feature works in Basic mode without it.</p>
        </div>
        <span className={`badge ${aiStatus.connected ? 'badge-accent' : ''}`}>
          <span className={`dot ${aiStatus.connected ? 'dot-on' : ''}`} />
          {!aiStatus.checked ? 'Checking…' : aiStatus.connected ? 'Connected' : 'Not connected'}
        </span>
      </div>
      <div className="panel-body form-stack">
        {aiStatus.error && (
          <div className="alert alert-warn">
            <Icon name="alert" size={16} /> {aiStatus.error} Until it’s fixed, the app uses Basic mode.
          </div>
        )}
        {!aiStatus.checked ? (
          <p className="muted small">Checking your AI connection…</p>
        ) : aiStatus.connected ? (
          <>
            <p className="muted small">
              Connected to <strong>{aiStatus.model}</strong> through the app’s server. The API key stays on the server and is never sent to your browser.
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={data.settings.aiEnabled}
                onChange={(e) => {
                  actions.updateSettings({ aiEnabled: e.target.checked });
                  toast.success(e.target.checked ? 'AI turned on.' : 'AI turned off. Using Basic mode.');
                }}
              />
              Use AI for translations, resume summaries, cover letters, interview questions and feedback, and skills analysis
            </label>
            <p className="subtle">
              When AI is on, the text you submit to those features (for example your resume content and a job description) is sent to the AI provider, Anthropic, to
              generate a response. Your name, email and phone number are left out.
            </p>
            {aiLocked && (
              <div className="alert alert-warn">
                <Icon name="lock" size={16} /> On this server, AI features are available after you <Link to="/signin">sign in</Link>.
              </div>
            )}
          </>
        ) : (
          <div className="setup-steps">
            <p className="muted small">To connect AI, do this once on your computer:</p>
            <ol>
              <li>
                In the project folder, copy <code>.env.example</code> and name the copy <code>.env</code>.
              </li>
              <li>
                Open <code>.env</code> and paste your Anthropic API key after <code>ANTHROPIC_API_KEY=</code>.
              </li>
              <li>
                Stop the app in the terminal (<kbd>Ctrl</kbd> + <kbd>C</kbd>) and start it again with <code>npm run dev</code>.
              </li>
            </ol>
            <p className="subtle">The README has step-by-step instructions, including where to get a key.</p>
          </div>
        )}
        <div>
          <button className="btn btn-secondary btn-sm" onClick={check} disabled={checking}>
            {checking ? <Spinner /> : <Icon name="refresh" size={14} />} Check connection
          </button>
        </div>
      </div>
    </section>
  );
}

// Plan and AI allowance from the server. There is no upgrade button on
// purpose: payments are not set up yet.
function PlanUsage() {
  const [usage, setUsage] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/usage')
      .then((res) => !cancelled && setUsage(res.ai))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="data-row">
      <div>
        <strong>Plan: {usage ? usage.planLabel : '…'}</strong>
        <p className="subtle">
          {failed
            ? 'Your AI usage couldn’t be loaded right now.'
            : usage
              ? `${usage.used} of ${usage.limit} AI requests used this month. Resets on ${formatDate(usage.resetsOn)}. Basic-mode tools are always unlimited.`
              : 'Loading your AI usage…'}
        </p>
      </div>
      {usage && <ProgressBar value={usage.limit ? Math.min(100, (usage.used / usage.limit) * 100) : 100} label="AI requests used this month" tone={usage.used >= usage.limit ? 'warn' : 'accent'} />}
    </div>
  );
}

function AccountSettings() {
  const auth = useAuth();
  const { actions } = useAppData();
  const toast = useToast();
  const navigate = useNavigate();
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwErrors, setPwErrors] = useState({});
  const [pwBusy, setPwBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePw, setDeletePw] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [confirmImport, setConfirmImport] = useState(false);
  const [hasGuestData] = useState(() => Boolean(loadData().profile));

  if (!auth.user) {
    return (
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Account</h2>
            <p className="subtle">You’re using First Job AI as a guest. Your data is saved in this browser only.</p>
          </div>
          <span className="badge">Guest</span>
        </div>
        <div className="panel-body">
          {auth.serverAvailable ? (
            <div className="row-actions">
              <Link to="/signup" className="btn btn-primary">
                Create a free account
              </Link>
              <Link to="/signin" className="btn btn-secondary">
                Sign in
              </Link>
            </div>
          ) : (
            <p className="muted small">Accounts need the First Job AI server, which isn’t reachable from this page.</p>
          )}
          <p className="subtle mt-8">
            With an account, your data is saved on the server and you can sign in from any device. When you create one, you can copy this browser’s data into it.
          </p>
        </div>
      </section>
    );
  }

  const changePassword = async (e) => {
    e.preventDefault();
    const errs = {
      current: pw.current ? null : 'Enter your current password.',
      next: pw.next.length < 8 ? 'Use at least 8 characters.' : null,
      confirm: pw.confirm !== pw.next ? 'The passwords don’t match.' : null,
    };
    setPwErrors(errs);
    if (errs.current || errs.next || errs.confirm) return;
    setPwBusy(true);
    try {
      await auth.changePassword(pw.current, pw.next);
      setPw({ current: '', next: '', confirm: '' });
      toast.success('Password changed. Other devices were signed out.');
    } catch (err) {
      setPwErrors(err.code === 'weak_password' ? { next: err.message } : { current: err.message });
    } finally {
      setPwBusy(false);
    }
  };

  const signOut = async () => {
    await auth.signOut();
    toast.success('Signed out.');
    navigate('/');
  };

  const deleteAccount = async () => {
    if (!deletePw) {
      setDeleteError('Enter your password to confirm.');
      return;
    }
    setDeleteBusy(true);
    try {
      await auth.deleteAccount(deletePw);
      toast.success('Your account and its data were deleted.');
      navigate('/');
    } catch (err) {
      setDeleteError(err.message);
      setDeleteBusy(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Account</h2>
          <p className="subtle">
            Signed in as <strong>{auth.user.email}</strong>
            {auth.user.createdAt ? ` · member since ${formatDate(auth.user.createdAt)}` : ''}. Your data is saved to your account.
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={signOut}>
          <Icon name="logout" size={14} /> Sign out
        </button>
      </div>
      <div className="panel-body data-actions">
        <PlanUsage />
        <form className="data-row account-password" onSubmit={changePassword} noValidate>
          <div>
            <strong>Change password</strong>
            <p className="subtle">Signs you out on your other devices.</p>
          </div>
          <div className="form-stack account-password-fields">
            <Field label="Current password" id="ac-current" error={pwErrors.current}>
              <input id="ac-current" type="password" className="input" autoComplete="current-password" maxLength={200} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </Field>
            <Field label="New password" id="ac-new" error={pwErrors.next}>
              <input id="ac-new" type="password" className="input" autoComplete="new-password" maxLength={200} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </Field>
            <Field label="Confirm new password" id="ac-confirm" error={pwErrors.confirm}>
              <input id="ac-confirm" type="password" className="input" autoComplete="new-password" maxLength={200} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </Field>
            <div>
              <button type="submit" className="btn btn-secondary" disabled={pwBusy}>
                {pwBusy && <Spinner />} Change password
              </button>
            </div>
          </div>
        </form>
        {hasGuestData && (
          <div className="data-row">
            <div>
              <strong>Copy guest data from this browser</strong>
              <p className="subtle">Replaces your account’s data with what you saved here before signing in.</p>
            </div>
            <button className="btn btn-secondary" onClick={() => setConfirmImport(true)}>
              <Icon name="upload" size={15} /> Copy into account
            </button>
          </div>
        )}
        <div className="data-row danger-zone">
          <div>
            <strong>Delete account</strong>
            <p className="subtle">Permanently deletes your account and everything saved in it. Guest data in this browser is not affected.</p>
          </div>
          <button className="btn btn-danger-ghost" onClick={() => setDeleteOpen(true)}>
            <Icon name="trash" size={15} /> Delete account
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmImport}
        title="Replace your account’s data?"
        message="Your account’s current profile, resume, applications and other data will be replaced by the guest data saved in this browser."
        confirmLabel="Replace"
        onCancel={() => setConfirmImport(false)}
        onConfirm={() => {
          actions.importGuestData();
          setConfirmImport(false);
          toast.success('Guest data copied into your account.');
        }}
      />
      <Modal
        open={deleteOpen}
        title="Delete your account?"
        size="sm"
        onClose={() => setDeleteOpen(false)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={deleteAccount} disabled={deleteBusy}>
              {deleteBusy && <Spinner />} Delete account
            </button>
          </>
        }
      >
        <div className="form-stack">
          <p className="muted">This permanently deletes your account, resume, applications, saved jobs, cover letters and practice history. It can’t be undone.</p>
          <Field label="Enter your password to confirm" id="ac-delete" error={deleteError}>
            <input
              id="ac-delete"
              type="password"
              className="input"
              autoComplete="current-password"
              value={deletePw}
              onChange={(e) => {
                setDeletePw(e.target.value);
                setDeleteError('');
              }}
            />
          </Field>
        </div>
      </Modal>
    </section>
  );
}

function DataSettings() {
  const { data, actions, mode } = useAppData();
  const inAccount = mode === 'account';
  const toast = useToast();
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `first-job-ai-backup-${toDateKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success('Backup downloaded.');
  };

  const importData = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object' || !('resume' in parsed) || !('applications' in parsed)) {
        throw new Error('This file is not a First Job AI backup.');
      }
      actions.importData(parsed);
      toast.success('Backup restored.');
    } catch (err) {
      toast.error(err instanceof SyntaxError ? 'That file isn’t valid JSON.' : err.message);
    }
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Your data</h2>
          <p className="subtle">
            {inAccount
              ? 'Your data is saved to your account. You can still download a copy for your records.'
              : 'As a guest, everything is stored in this browser only. Back it up before clearing your browser data or switching computers.'}
          </p>
        </div>
      </div>
      <div className="panel-body data-actions">
        <div className="data-row">
          <div>
            <strong>Download a backup</strong>
            <p className="subtle">A JSON file with your profile, resume, applications, practice and missions.</p>
          </div>
          <button className="btn btn-secondary" onClick={exportData}>
            <Icon name="download" size={15} /> Download backup
          </button>
        </div>
        <div className="data-row">
          <div>
            <strong>Restore from a backup</strong>
            <p className="subtle">{inAccount ? 'Replaces the data in your account.' : 'Replaces the data currently in this browser.'}</p>
          </div>
          <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={15} /> Restore backup
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importData} />
        </div>
        <div className="data-row danger-zone">
          <div>
            <strong>Delete all data</strong>
            <p className="subtle">
              {inAccount ? 'Erases everything saved in your account but keeps the account itself.' : 'Erases everything and returns to the start.'} This can’t be
              undone.
            </p>
          </div>
          <button className="btn btn-danger-ghost" onClick={() => setConfirmReset(true)}>
            <Icon name="trash" size={15} /> Delete all data
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmReset}
        title="Delete all of your data?"
        message={`Your profile, resume, applications, saved jobs, cover letters, practice sessions, translations and mission history will be permanently erased from ${inAccount ? 'your account' : 'this browser'}.`}
        confirmLabel="Delete everything"
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          actions.resetAll();
          navigate('/');
          toast.success('All data deleted.');
        }}
      />
    </section>
  );
}

export default function Settings() {
  const { data, saveError } = useAppData();
  return (
    <div className="settings-page">
      <PageHeader title="Settings" description="Edit your profile, connect AI and manage your saved data." />
      {saveError && (
        <div className="alert alert-error mb-16">
          <Icon name="alert" size={16} /> Your browser is blocking storage, so changes may not be saved. Check that cookies and site data are allowed.
        </div>
      )}
      <div className="settings-stack">
        <AccountSettings />
        <ProfileForm key={data.profile?.createdAt || 'profile'} />
        <AiSettings />
        <DataSettings />
      </div>
    </div>
  );
}
