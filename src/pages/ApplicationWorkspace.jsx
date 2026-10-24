import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import ApplicationForm from '../components/ApplicationForm.jsx';
import { EmptyState, ModeNotice, ProgressBar, Spinner } from '../components/ui.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { callAi } from '../lib/ai.js';
import { STATUSES, statusLabel } from '../lib/applications.js';
import { isResumeEmpty, resumeToText } from '../lib/resume.js';
import { formatDate, formatDateTime, isValidUrl, timeAgo, toDateKey } from '../lib/utils.js';
import { applicationSteps, basicAnalysis, hasDescription, nextStep, stepProgress, verifyAnalysis } from '../lib/workflow.js';

function RequirementList({ title, items, resumeEmpty }) {
  if (!items.length) return null;
  return (
    <div className="ws-req">
      <h4>{title}</h4>
      <ul className="checklist">
        {items.map((r) => (
          <li key={r.requirement} className={r.shown ? 'pass' : 'fail'}>
            <span className="check-icon" aria-hidden="true">
              <Icon name={r.shown ? 'check' : 'alert'} size={12} />
            </span>
            <span>
              <strong>{r.requirement}</strong>
              <span className="muted small ws-evidence">
                {r.evidence ? `Your resume: “${r.evidence}”` : r.shown ? 'Named on your resume.' : resumeEmpty ? 'Add your resume to check this.' : 'Not shown on your resume. Add it only if you really have it.'}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Analysis({ app }) {
  const { data, actions, aiActive, aiStatus } = useAppData();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const resume = data.resume;
  const resumeEmpty = isResumeEmpty(resume);
  const a = app.analysis;

  const run = async () => {
    setLoading(true);
    let analysis = null;
    if (aiActive) {
      try {
        const resumeText = resumeEmpty ? '' : resumeToText(resume, { includeContact: false });
        const res = await callAi('analyze', { jobTitle: app.title, company: app.company, jobDescription: app.description, resumeText });
        analysis = { ...verifyAnalysis(res, resumeText), mode: 'ai', model: aiStatus.model };
      } catch (err) {
        toast.error(`AI analysis is unavailable (${err.message}). A keyword analysis was made instead.`);
      }
    }
    if (!analysis) analysis = { ...basicAnalysis(resume, app.description), mode: 'basic' };
    actions.updateApplication(app.id, { analysis: { ...analysis, resumeIncluded: !resumeEmpty, at: new Date().toISOString() } });
    actions.logActivity('resume', `Analyzed the requirements for ${app.title} at ${app.company}`);
    setLoading(false);
  };

  if (!hasDescription(app)) {
    return (
      <EmptyState icon="search" title="Nothing to analyze yet">
        Add the full job description above first. First Job AI only analyzes postings it has actually seen.
      </EmptyState>
    );
  }

  return (
    <>
      {!a && (
        <>
          <p className="muted small">
            Find out what this job really requires
            {resumeEmpty ? '. Your resume is empty, so the analysis will only cover the job.' : ' and which requirements your resume already shows.'}
          </p>
          <ModeNotice aiActive={aiActive} aiStatus={aiStatus} basicText="Basic mode finds common skills and requirement lines (degree, years, licenses) with keyword matching." />
        </>
      )}
      {a && (
        <div className="ws-analysis">
          <p className="subtle">
            {a.mode === 'ai' ? `AI analysis by ${a.model || 'Claude'}` : 'Keyword analysis (Basic mode)'} · {timeAgo(a.at)}
            {!a.resumeIncluded && ' · made without a resume'}
            {a.mode === 'ai' && '. Check it against the posting before relying on it.'}
          </p>
          {a.summary && <p>{a.summary}</p>}
          <RequirementList title="Required" items={a.mustHave} resumeEmpty={!a.resumeIncluded} />
          <RequirementList title="Nice to have" items={a.niceToHave} resumeEmpty={!a.resumeIncluded} />
          {a.responsibilities.length > 0 && (
            <div className="ws-req">
              <h4>What you would do</h4>
              <ul className="tip-list">
                {a.responsibilities.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {a.keywords.length > 0 && (
            <div className="ws-req">
              <h4>Keywords to use where they are true for you</h4>
              <div className="chip-row">
                {a.keywords.map((k) => (
                  <span className="chip" key={k}>
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}
          {a.questionsToAsk.length > 0 && (
            <div className="ws-req">
              <h4>Questions you could ask the interviewer</h4>
              <ul className="tip-list">
                {a.questionsToAsk.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          )}
          {!a.mustHave.length && !a.niceToHave.length && !a.keywords.length && (
            <p className="muted small">No clear requirements were found. Check that the full posting, including the requirements section, is saved above.</p>
          )}
        </div>
      )}
      <div className="row-actions">
        <button className={`btn ${a ? 'btn-secondary' : 'btn-primary'}`} onClick={run} disabled={loading}>
          {loading ? <Spinner /> : <Icon name={aiActive ? 'spark' : 'search'} size={15} />}
          {loading ? 'Analyzing…' : a ? 'Analyze again' : 'Analyze requirements'}
        </button>
      </div>
    </>
  );
}

export default function ApplicationWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, actions, dataReady } = useAppData();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const app = data.applications.find((a) => a.id === id);

  if (!app) {
    return (
      <div className="panel">
        <EmptyState
          icon="tracker"
          title={!dataReady ? 'Loading…' : 'Application not found'}
          action={
            <Link to="/tracker" className="btn btn-secondary">
              Back to tracker
            </Link>
          }
        >
          {!dataReady ? 'Your data is still loading.' : 'It may have been deleted, or it belongs to another account.'}
        </EmptyState>
      </div>
    );
  }

  const steps = applicationSteps(app, data);
  const next = nextStep(app, data);
  const progress = stepProgress(app, data);
  const letters = data.coverLetters.filter((l) => l.applicationId === app.id);
  const sessions = data.interviewSessions.filter((s) => s.applicationId === app.id);

  const changeStatus = (status) => {
    const patch = { status };
    if (status === 'applied' && !app.dateApplied) patch.dateApplied = toDateKey();
    actions.updateApplication(app.id, patch);
    actions.logActivity('application', `Moved ${app.title} at ${app.company} to ${statusLabel(status)}`);
    toast.success(`Status changed to ${statusLabel(status)}.`);
  };

  const goTo = (step) => {
    if (step.id === 'apply') {
      if (app.link && isValidUrl(app.link)) window.open(app.link, '_blank', 'noopener,noreferrer');
      document.getElementById('ws-status')?.focus();
      return;
    }
    if (step.id === 'details') {
      setEditing(true);
      return;
    }
    const hash = step.to.split('#')[1];
    if (hash && step.to.startsWith('/tracker/')) document.getElementById(`ws-${hash}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else navigate(step.to);
  };

  const save = (record) => {
    actions.updateApplication(app.id, record);
    if (record.status !== app.status) actions.logActivity('application', `Moved ${record.title} at ${record.company} to ${statusLabel(record.status)}`);
    toast.success('Application updated.');
    setEditing(false);
  };

  return (
    <div className="workspace">
      <Link to="/tracker" className="link-btn ws-back">
        <Icon name="chevronLeft" size={15} /> All applications
      </Link>

      <header className="ws-head">
        <span className="company-mark ws-mark" aria-hidden="true">
          {(app.company || '?').charAt(0).toUpperCase()}
        </span>
        <div className="ws-title">
          <h1>{app.title}</h1>
          <p className="muted">
            {app.company}
            {app.location ? ` · ${app.location}` : ''}
            {app.dateApplied ? ` · Applied ${formatDate(app.dateApplied)}` : ''}
          </p>
        </div>
        <div className="ws-head-actions">
          <select id="ws-status" className={`select status-select status-${app.status}`} value={app.status} onChange={(e) => changeStatus(e.target.value)} aria-label="Application status">
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {app.link && isValidUrl(app.link) && (
            <a className="btn btn-secondary" href={app.link} target="_blank" rel="noopener noreferrer">
              <Icon name="external" size={15} /> Posting
            </a>
          )}
          <button className="btn btn-secondary" onClick={() => setEditing(true)}>
            <Icon name="edit" size={15} /> Edit
          </button>
        </div>
      </header>

      <section className="panel panel-pad ws-next" aria-label="Next step">
        <div className="ws-progress">
          <span className="subtle">
            {progress.done} of {progress.total} steps done
          </span>
          <ProgressBar value={progress.percent} label="Application progress" />
        </div>
        {next ? (
          <div className="ws-next-body">
            <div>
              <span className="badge badge-accent">Next step</span>
              <h2>{next.label}</h2>
              <p className="muted small">{next.hint}</p>
            </div>
            <button className="btn btn-primary" onClick={() => goTo(next)}>
              {next.id === 'apply' && app.link ? 'Open posting' : 'Start'} <Icon name="chevronRight" size={15} />
            </button>
          </div>
        ) : (
          <p className="ws-next-body muted">
            {app.status === 'rejected'
              ? 'This application is closed. Note what you learned, then use it for the next one.'
              : app.status === 'offer'
                ? 'Congratulations on the offer! Every step is done.'
                : 'Every step is done. Keep the status up to date as you hear back.'}
          </p>
        )}
      </section>

      <div className="ws-grid">
        <div className="ws-main">
          <section className="panel panel-pad" id="ws-analysis">
            <h2 className="with-icon">
              <Icon name="search" size={17} /> Job requirements
            </h2>
            <Analysis app={app} />
          </section>

          <section className="panel panel-pad" id="ws-details">
            <div className="section-title-row">
              <h2>Job description</h2>
              <button className="link-btn" onClick={() => setEditing(true)}>
                {hasDescription(app) ? 'Edit' : 'Add description'}
              </button>
            </div>
            {hasDescription(app) ? (
              <p className="job-description ws-description">{app.description}</p>
            ) : (
              <p className="muted small">No description saved yet. Copy the full posting from the job site and paste it here, so the analysis, resume tailoring, cover letter and interview questions can be based on it.</p>
            )}
            {app.notes && (
              <>
                <h4 className="mt-20">Your notes</h4>
                <p className="ws-description">{app.notes}</p>
              </>
            )}
          </section>
        </div>

        <aside className="ws-side">
          <section className="panel panel-pad">
            <h2>Steps</h2>
            <ol className="ws-steps">
              {steps.map((s, i) => (
                <li key={s.id} className={s.done ? 'done' : next?.id === s.id ? 'current' : ''}>
                  <span className="step-num" aria-hidden="true">
                    {s.done ? <Icon name="check" size={12} /> : i + 1}
                  </span>
                  <button className="link-btn" onClick={() => goTo(s)}>
                    {s.label}
                  </button>
                  <span className="sr-only">{s.done ? '(done)' : '(not done)'}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="panel panel-pad">
            <h2>For this job</h2>
            <ul className="ws-links">
              <li>
                <Icon name="letter" size={15} />
                {letters.length ? (
                  <Link to={`/cover-letters?letter=${encodeURIComponent(letters[0].id)}`}>
                    {letters.length} cover letter{letters.length === 1 ? '' : 's'}
                  </Link>
                ) : (
                  <span className="muted">No cover letter yet</span>
                )}
              </li>
              <li>
                <Icon name="interview" size={15} />
                {sessions.length ? (
                  <Link to="/interview?tab=history">
                    {sessions.length} practice session{sessions.length === 1 ? '' : 's'}
                  </Link>
                ) : (
                  <span className="muted">No interview practice yet</span>
                )}
              </li>
              {app.interviewDate && (
                <li>
                  <Icon name="calendar" size={15} /> Interview {formatDateTime(app.interviewDate)}
                </li>
              )}
            </ul>
          </section>

          {app.statusHistory?.length > 0 && (
            <section className="panel panel-pad">
              <h2>History</h2>
              <ul className="ws-history">
                {[...app.statusHistory].reverse().map((h) => (
                  <li key={`${h.status}-${h.at}`}>
                    <i className={`dot status-${h.status}`} aria-hidden="true" />
                    <span>{statusLabel(h.status)}</span>
                    <span className="subtle">{formatDate(h.at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>

      {editing && <ApplicationForm open initial={app} onSave={save} onClose={() => setEditing(false)} />}
    </div>
  );
}
