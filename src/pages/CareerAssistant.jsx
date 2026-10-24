import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import JobCard from '../components/jobs/JobCard.jsx';
import { EmptyState, Field, ModeNotice, PageHeader, ProgressBar, Spinner, TagInput } from '../components/ui.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { SetupNotice } from './JobSearch.jsx';
import { callAi } from '../lib/ai.js';
import { EMPLOYMENT_TYPE_OPTIONS, fetchJobsStatus, searchJobs } from '../lib/jobs.js';
import { preferredTypesFromProfile, rankJobs } from '../lib/recommend.js';
import { isResumeEmpty, resumeToText } from '../lib/resume.js';
import { findTransferableSkills, improvementSuggestions, verifyAiSkills } from '../lib/transferable.js';

function MatchBox({ result }) {
  return (
    <div className="match-stack">
      <div className="match-score">
        <span className="subtle">Keyword match (estimate)</span>
        <ProgressBar value={result.score} label="Keyword match estimate" tone={result.score < 30 ? 'warn' : 'accent'} />
        <strong>{result.score}%</strong>
      </div>
      {result.reasons.length > 0 && (
        <div className="match-box">
          <strong>Why it may fit</strong>
          <ul>
            {result.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {result.checks.length > 0 && (
        <div className="match-box check">
          <strong>Check before applying</strong>
          <ul>
            {result.checks.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Preferences() {
  const { data, actions } = useAppData();
  const toast = useToast();
  const p = data.profile;
  const [form, setForm] = useState(() => ({
    targetRole: p.targetRole || '',
    location: p.location || '',
    interests: p.interests || [],
    preferredTypes: preferredTypesFromProfile(p),
    remoteOnly: Boolean(p.remoteOnly),
  }));
  const [error, setError] = useState('');

  const save = (e) => {
    e.preventDefault();
    if (!form.targetRole.trim()) {
      setError('Enter a target job title.');
      return;
    }
    actions.saveProfile({ ...form, targetRole: form.targetRole.trim(), location: form.location.trim() });
    toast.success('Preferences saved.');
  };

  const toggleType = (v) =>
    setForm((f) => ({ ...f, preferredTypes: f.preferredTypes.includes(v) ? f.preferredTypes.filter((t) => t !== v) : [...f.preferredTypes, v] }));

  return (
    <form className="panel panel-pad form-stack" onSubmit={save} noValidate>
      <h2>What you’re looking for</h2>
      <div className="form-grid">
        <Field label="Target job title" id="ca-role" required error={error}>
          <input
            id="ca-role"
            className="input"
            value={form.targetRole}
            maxLength={120}
            onChange={(e) => {
              setForm({ ...form, targetRole: e.target.value });
              setError('');
            }}
          />
        </Field>
        <Field label="Preferred location" id="ca-loc">
          <input id="ca-loc" className="input" value={form.location} maxLength={100} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </Field>
        <Field label="Interests" id="ca-int" className="span-2" hint="Industries or topics you care about, e.g. sustainability, gaming, healthcare. Press Enter after each.">
          <TagInput id="ca-int" value={form.interests} onChange={(interests) => setForm({ ...form, interests: interests.slice(0, 12) })} />
        </Field>
        <fieldset className="field span-2 plain-fieldset">
          <legend>Job types</legend>
          <div className="chip-row">
            {EMPLOYMENT_TYPE_OPTIONS.map((o) => (
              <label key={o.value} className={`chip ${form.preferredTypes.includes(o.value) ? 'selected' : ''}`}>
                <input type="checkbox" checked={form.preferredTypes.includes(o.value)} onChange={() => toggleType(o.value)} />
                {o.label}
              </label>
            ))}
            <label className={`chip ${form.remoteOnly ? 'selected' : ''}`}>
              <input type="checkbox" checked={form.remoteOnly} onChange={(e) => setForm({ ...form, remoteOnly: e.target.checked })} />
              Remote only
            </label>
          </div>
        </fieldset>
      </div>
      <div>
        <button type="submit" className="btn btn-secondary">
          Save preferences
        </button>
      </div>
    </form>
  );
}

function Recommendations() {
  const { data } = useAppData();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [jobs, setJobs] = useState(null);
  const profile = data.profile;

  useEffect(() => {
    fetchJobsStatus().then(setStatus);
  }, []);

  const rankedSaved = useMemo(() => rankJobs(data.savedJobs.map((s) => s.job), { resume: data.resume, profile }), [data.savedJobs, data.resume, profile]);
  const ranked = useMemo(() => (jobs ? rankJobs(jobs, { resume: data.resume, profile }) : null), [jobs, data.resume, profile]);

  const find = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await searchJobs({
        query: profile.targetRole,
        location: profile.location || '',
        remote: Boolean(profile.remoteOnly),
        employmentTypes: preferredTypesFromProfile(profile),
        datePosted: 'month',
      });
      setJobs(res.jobs);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="assistant-section">
      <div className="section-title-row">
        <h2>Recommended jobs</h2>
        {status?.configured && (
          <button className="btn btn-primary" onClick={find} disabled={loading || !profile.targetRole}>
            {loading ? <Spinner /> : <Icon name="search" size={15} />} {jobs ? 'Search again' : `Find ${profile.targetRole || ''} jobs`}
          </button>
        )}
      </div>
      <p className="muted small mb-16">
        These are suggestions ranked by how many words and skills overlap between your resume, your preferences and each posting. They are not a judgment of
        whether you qualify — read each listing yourself.
      </p>
      {isResumeEmpty(data.resume) && (
        <div className="alert alert-warn mb-16">
          <Icon name="alert" size={16} /> Your resume is empty, so matching can only use your target role. <Link to="/resume">Build your resume</Link> for better
          suggestions.
        </div>
      )}
      {status && !status.configured && <SetupNotice status={status} />}
      {error && <div className="alert alert-error mb-16"><Icon name="alert" size={16} /> {error}</div>}
      {loading && (
        <div className="panel panel-pad center-row">
          <Spinner /> <span className="muted">Searching and ranking listings…</span>
        </div>
      )}
      {ranked && !loading && (
        ranked.length ? (
          <div className="job-list">
            {ranked.slice(0, 10).map((r) => (
              <JobCard key={r.job.id} job={r.job} extra={<MatchBox result={r} />} />
            ))}
          </div>
        ) : (
          <div className="panel">
            <EmptyState icon="search" title="No listings found">
              Try a broader target role or remove the location in your preferences.
            </EmptyState>
          </div>
        )
      )}
      {!ranked && rankedSaved.length > 0 && (
        <>
          <h3 className="sub-title">Your saved jobs, best match first</h3>
          <div className="job-list">
            {rankedSaved.slice(0, 10).map((r) => (
              <JobCard key={r.job.id} job={r.job} extra={<MatchBox result={r} />} />
            ))}
          </div>
        </>
      )}
      {!ranked && !rankedSaved.length && status?.configured && !loading && (
        <div className="panel">
          <EmptyState icon="compass" title="Find jobs that fit you">
            We’ll search current listings for your target role and explain which ones overlap with your resume.
          </EmptyState>
        </div>
      )}
    </section>
  );
}

function SkillsAnalysis() {
  const { data, aiActive, aiStatus } = useAppData();
  const toast = useToast();
  const resume = data.resume;
  const skills = useMemo(() => findTransferableSkills(resume), [resume]);
  const { field, suggestions } = useMemo(() => improvementSuggestions(resume, data.profile.targetRole), [resume, data.profile.targetRole]);
  const [ai, setAi] = useState(null);
  const [loading, setLoading] = useState(false);

  const analyze = async () => {
    setLoading(true);
    try {
      const text = resumeToText(resume, { includeContact: false });
      const res = await callAi('skills', { resumeText: text, targetRole: data.profile.targetRole });
      const { verified, dropped } = verifyAiSkills(res.skills, text);
      setAi({ skills: verified, dropped, suggestions: (res.suggestions || []).filter((s) => s?.title).slice(0, 6) });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (isResumeEmpty(resume)) {
    return (
      <section className="assistant-section">
        <h2>Your transferable skills</h2>
        <div className="panel">
          <EmptyState icon="resume" title="Add some experience first" action={<Link to="/resume" className="btn btn-primary">Open Resume Builder</Link>}>
            Add classes, projects, volunteering or part-time jobs to your resume. We’ll point out the skills they show — using your own words as evidence.
          </EmptyState>
        </div>
      </section>
    );
  }

  return (
    <section className="assistant-section">
      <div className="section-title-row">
        <h2>Your transferable skills</h2>
        {aiActive && (
          <button className="btn btn-secondary" onClick={analyze} disabled={loading}>
            {loading ? <Spinner /> : <Icon name="spark" size={15} />} {ai ? 'Analyze again with AI' : 'Deeper analysis with AI'}
          </button>
        )}
      </div>
      <ModeNotice
        aiActive={aiActive}
        aiStatus={aiStatus}
        basicText="Skills are found by matching common action words in your resume. Each one shows the line that supports it, so you can check it."
      />
      <div className="skills-grid">
        {skills.length ? (
          skills.map((s) => (
            <article key={s.name} className="panel skill-card">
              <h3>{s.name}</h3>
              <p className="subtle">{s.why}</p>
              <ul>
                {s.evidence.map((e) => (
                  <li key={e.source + e.text}>
                    “{e.text}” <span className="subtle">— {e.source}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))
        ) : (
          <div className="panel panel-pad">
            <p className="muted">No common transferable skills were recognized yet. Add bullet points describing what you did in each experience.</p>
          </div>
        )}
      </div>

      {ai && (
        <div className="panel panel-pad form-stack ai-skills">
          <span className="badge badge-accent">
            <Icon name="spark" size={12} /> AI analysis
          </span>
          {ai.skills.length > 0 && (
            <ul className="evidence-list">
              {ai.skills.map((s) => (
                <li key={s.name}>
                  <strong>{s.name}</strong> — “{s.evidence}”
                </li>
              ))}
            </ul>
          )}
          {ai.dropped > 0 && (
            <p className="subtle">
              {ai.dropped} suggested skill{ai.dropped === 1 ? ' was' : 's were'} hidden because the AI couldn’t quote your resume to support {ai.dropped === 1 ? 'it' : 'them'}.
            </p>
          )}
          {ai.suggestions.length > 0 && (
            <>
              <h3>AI suggestions to strengthen your qualifications</h3>
              <ul className="evidence-list">
                {ai.suggestions.map((s) => (
                  <li key={s.title}>
                    <strong>{s.title}</strong>
                    {s.detail ? ` — ${s.detail}` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <h3 className="sub-title">Ways to strengthen your qualifications</h3>
      <p className="muted small mb-16">
        General suggestions for {field === 'general' ? 'entry-level roles' : `${field} roles`} that skip skills you already list. For a specific job, use{' '}
        <Link to="/resume?tab=tailor">Tailor to a job</Link>.
      </p>
      {suggestions.length ? (
        <ul className="suggestion-list">
          {suggestions.map((s) => (
            <li key={s.skill} className="panel">
              <strong>{s.skill}</strong>
              <span>{s.how}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Your resume already lists the skills we usually suggest for this field. Nice work.</p>
      )}
    </section>
  );
}

export default function CareerAssistant() {
  return (
    <div className="assistant-page">
      <PageHeader title="Career Assistant" description="Job suggestions based on your resume and preferences, plus the skills your experience already shows." />
      <div className="assistant-stack">
        <Preferences />
        <Recommendations />
        <SkillsAnalysis />
      </div>
    </div>
  );
}
