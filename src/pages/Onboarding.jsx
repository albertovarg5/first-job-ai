import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Logo } from '../components/AppLayout.jsx';
import { Field } from '../components/ui.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { SITUATIONS, EXPERIENCE_LEVELS, GOALS } from '../lib/profileOptions.js';
import { isValidEmail } from '../lib/utils.js';

const STEP_TITLES = ['About you', 'Your experience', 'Your goals'];

export default function Onboarding() {
  const { data, actions } = useAppData();
  const toast = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({
    name: '',
    email: '',
    situation: '',
    experienceLevel: '',
    targetRole: '',
    location: '',
    goals: [],
  });

  if (data.profile) return <Navigate to="/dashboard" replace />;

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const validate = () => {
    const e = {};
    if (step === 0) {
      if (!form.name.trim()) e.name = 'Enter your name so we can personalize your dashboard.';
      if (!isValidEmail(form.email)) e.email = 'That email doesn’t look right. Check for typos or leave it blank.';
      if (!form.situation) e.situation = 'Choose the option that fits you best.';
    }
    if (step === 1) {
      if (!form.experienceLevel) e.experienceLevel = 'Choose your experience level.';
    }
    if (step === 2) {
      if (!form.targetRole.trim()) e.targetRole = 'Enter a job title, even a rough one like “marketing intern”.';
      if (!form.goals.length) e.goals = 'Pick at least one goal.';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = (event) => {
    event.preventDefault();
    if (!validate()) return;
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    actions.saveProfile({ ...form, name: form.name.trim(), targetRole: form.targetRole.trim() });
    actions.logActivity('profile', 'Set up your First Job AI profile');
    toast.success(`Welcome, ${form.name.trim().split(' ')[0]}! Your dashboard is ready.`);
    navigate('/dashboard');
  };

  const toggleGoal = (value) =>
    set('goals', form.goals.includes(value) ? form.goals.filter((g) => g !== value) : [...form.goals, value]);

  return (
    <div className="onboarding">
      <header className="onboarding-top">
        <Logo />
        <span className="subtle">
          Step {step + 1} of 3
        </span>
      </header>

      <form className="onboarding-card panel" onSubmit={next} noValidate>
        <div className="onboarding-progress" aria-hidden="true">
          {STEP_TITLES.map((t, i) => (
            <span key={t} className={i <= step ? 'on' : ''} />
          ))}
        </div>
        <h1>{['Let’s set up your career profile', 'What experience do you have so far?', 'What are you aiming for?'][step]}</h1>
        <p className="muted onboarding-sub">
          {[
            'This takes about a minute. You can change everything later in Settings.',
            'There’s no wrong answer. Everyone starts somewhere, and the app adapts to you.',
            'Your goals shape your dashboard, daily missions and interview questions.',
          ][step]}
        </p>

        {step === 0 && (
          <div className="form-stack">
            <div className="form-grid">
              <Field label="Your name" id="ob-name" required error={errors.name}>
                <input id="ob-name" className="input" value={form.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" />
              </Field>
              <Field label="Email" id="ob-email" hint="Optional — used to prefill your resume." error={errors.email}>
                <input id="ob-email" type="email" className="input" value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" />
              </Field>
            </div>
            <Field label="Which describes you best?" required error={errors.situation}>
              <div className="choice-grid" role="radiogroup" aria-label="Which describes you best?">
                {SITUATIONS.map((s) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={form.situation === s.value}
                    key={s.value}
                    className={`choice ${form.situation === s.value ? 'selected' : ''}`}
                    onClick={() => set('situation', s.value)}
                  >
                    <strong>{s.label}</strong>
                    <span>{s.hint}</span>
                  </button>
                ))}
              </div>
            </Field>
          </div>
        )}

        {step === 1 && (
          <Field label="Experience level" required error={errors.experienceLevel}>
            <div className="choice-grid wide" role="radiogroup" aria-label="Experience level">
              {EXPERIENCE_LEVELS.map((s) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={form.experienceLevel === s.value}
                  key={s.value}
                  className={`choice ${form.experienceLevel === s.value ? 'selected' : ''}`}
                  onClick={() => set('experienceLevel', s.value)}
                >
                  <strong>{s.label}</strong>
                  <span>{s.hint}</span>
                </button>
              ))}
            </div>
          </Field>
        )}

        {step === 2 && (
          <div className="form-stack">
            <div className="form-grid">
              <Field label="Target job title" id="ob-role" required error={errors.targetRole} hint="For example: Software engineering intern, Marketing assistant">
                <input id="ob-role" className="input" value={form.targetRole} onChange={(e) => set('targetRole', e.target.value)} />
              </Field>
              <Field label="Preferred location" id="ob-loc" hint="Optional — a city or “Remote”.">
                <input id="ob-loc" className="input" value={form.location} onChange={(e) => set('location', e.target.value)} />
              </Field>
            </div>
            <Field label="Goals" required error={errors.goals} hint="Choose all that apply.">
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
        )}

        <div className="onboarding-actions">
          {step > 0 ? (
            <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}>
              <Icon name="chevronLeft" size={16} /> Back
            </button>
          ) : (
            <span />
          )}
          <button type="submit" className="btn btn-primary">
            {step < 2 ? 'Continue' : 'Create my dashboard'}
          </button>
        </div>
      </form>
    </div>
  );
}
