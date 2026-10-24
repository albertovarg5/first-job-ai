import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { Field, PageHeader, Spinner } from '../components/ui.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { EXPERIENCE_LEVELS, GOALS, SITUATIONS } from '../lib/profileOptions.js';
import { isValidEmail, toDateKey } from '../lib/utils.js';

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
  const { data, actions, aiStatus, refreshAiStatus } = useAppData();
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
              Connected to <strong>{aiStatus.model}</strong> through your local server. Your API key stays in the <code>.env</code> file on your computer.
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
              Use AI for translations, interview feedback and resume suggestions
            </label>
            <p className="subtle">When AI is on, the text you submit to those features is sent to the AI provider to generate a response.</p>
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

function DataSettings() {
  const { data, actions } = useAppData();
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
          <p className="subtle">Everything is stored in this browser only. Back it up before clearing your browser data or switching computers.</p>
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
            <p className="subtle">Replaces the data currently in this browser.</p>
          </div>
          <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={15} /> Restore backup
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importData} />
        </div>
        <div className="data-row danger-zone">
          <div>
            <strong>Delete all data</strong>
            <p className="subtle">Erases everything and returns to the start. This can’t be undone.</p>
          </div>
          <button className="btn btn-danger-ghost" onClick={() => setConfirmReset(true)}>
            <Icon name="trash" size={15} /> Delete all data
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmReset}
        title="Delete all of your data?"
        message="Your profile, resume, applications, practice sessions, translations and mission history will be permanently erased from this browser."
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
        <ProfileForm key={data.profile?.createdAt || 'profile'} />
        <AiSettings />
        <DataSettings />
      </div>
    </div>
  );
}
