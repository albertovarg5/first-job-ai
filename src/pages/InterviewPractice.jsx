import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import FeedbackView from '../components/FeedbackView.jsx';
import JobPicker from '../components/jobs/JobPicker.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { EmptyState, Field, ModeNotice, PageHeader, ProgressBar, Segmented, Spinner } from '../components/ui.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { INTERVIEW_TYPES, buildQuestionSet } from '../lib/questionBank.js';
import { checkAnswer } from '../lib/answerChecklist.js';
import { callAi } from '../lib/ai.js';
import { createId, formatDateTime, wordCount } from '../lib/utils.js';

const CATEGORY_LABEL = { general: 'General', behavioral: 'Behavioral', technical: 'Role-specific' };
const CATEGORY_TIP = {
  general: 'Keep it focused: 3–5 sentences that connect your background to this role.',
  behavioral: 'Use STAR: the Situation, your Task, the Actions you took, and the Result.',
  technical: 'Explain your thinking step by step and mention a real example if you have one.',
};

const QUESTION_SOURCE = {
  ai: 'AI-generated question based on the job you entered',
  job: 'Based on a skill named in the job description',
  library: 'Sample question from the built-in library',
};

function Setup({ onStart, defaultTitle, defaultJob, busy }) {
  const { aiActive } = useAppData();
  const [jobTitle, setJobTitle] = useState(defaultJob?.title || defaultTitle || '');
  const [jobDescription, setJobDescription] = useState(defaultJob?.description || '');
  // The tracked application this practice is for, so its workflow step can be marked done.
  const [applicationId, setApplicationId] = useState(defaultJob?.id || null);
  const [type, setType] = useState('mixed');
  const [count, setCount] = useState(5);
  const [useAi, setUseAi] = useState(true);
  const [error, setError] = useState('');

  const start = (e) => {
    e.preventDefault();
    if (!jobTitle.trim()) {
      setError('Enter the job title you’re preparing for.');
      return;
    }
    onStart({ jobTitle: jobTitle.trim(), type, count, jobDescription: jobDescription.trim(), useAi: aiActive && useAi, applicationId });
  };

  return (
    <form className="panel panel-pad setup" onSubmit={start} noValidate>
      <h2>Start a practice session</h2>
      <div className="form-stack">
        <Field label="Job title" id="iv-title" required error={error} hint="Role-specific questions are picked based on this title.">
          <input
            id="iv-title"
            className="input"
            value={jobTitle}
            onChange={(e) => {
              setJobTitle(e.target.value);
              setError('');
            }}
            placeholder="e.g. Marketing intern"
          />
        </Field>
        <JobPicker
          id="iv-pick"
          label="Practice for a saved or tracked job (optional)"
          onPick={(job) => {
            setJobTitle(job.title);
            setJobDescription(job.description);
            setApplicationId(job.applicationId || null);
            setError('');
          }}
        />
        <Field
          label="Job description (optional)"
          id="iv-desc"
          hint="Paste the posting to get questions about the skills it asks for."
        >
          <textarea id="iv-desc" className="textarea" rows={4} maxLength={12000} value={jobDescription} onChange={(e) => setJobDescription(e.target.value)} />
        </Field>
        {aiActive && (
          <label className="checkbox">
            <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
            Generate questions with AI from the job title{jobDescription.trim() ? ' and description' : ''}
          </label>
        )}
        <Field label="Interview type">
          <div className="choice-grid" role="radiogroup" aria-label="Interview type">
            {INTERVIEW_TYPES.map((t) => (
              <button type="button" role="radio" aria-checked={type === t.value} key={t.value} className={`choice ${type === t.value ? 'selected' : ''}`} onClick={() => setType(t.value)}>
                <strong>{t.label}</strong>
                <span>{t.hint}</span>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Number of questions">
          <Segmented
            label="Number of questions"
            value={String(count)}
            onChange={(v) => setCount(Number(v))}
            options={[
              { value: '3', label: '3 questions' },
              { value: '5', label: '5 questions' },
              { value: '8', label: '8 questions' },
            ]}
          />
        </Field>
        <div>
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? <Spinner /> : <Icon name="play" size={15} />} {busy ? 'Preparing questions…' : 'Start practicing'}
          </button>
        </div>
      </div>
    </form>
  );
}

function Session({ session, onUpdate, onFinish, onExit }) {
  const { aiActive, aiStatus } = useAppData();
  const toast = useToast();
  const [index, setIndex] = useState(() => {
    const firstOpen = session.items.findIndex((i) => !i.feedback);
    return firstOpen === -1 ? session.items.length - 1 : firstOpen;
  });
  const [loading, setLoading] = useState(false);
  const item = session.items[index];
  const [draft, setDraft] = useState(item.answer || '');
  const isLast = index === session.items.length - 1;

  const goTo = (i) => {
    setIndex(i);
    setDraft(session.items[i].answer || '');
  };

  const saveItem = (patch) => {
    const items = session.items.map((it, i) => (i === index ? { ...it, ...patch } : it));
    onUpdate({ ...session, items });
  };

  const getFeedback = async () => {
    if (wordCount(draft) < 5) {
      toast.info('Write at least a sentence or two before asking for feedback.');
      return;
    }
    setLoading(true);
    let feedback;
    if (aiActive) {
      try {
        const res = await callAi('feedback', {
          question: item.question,
          answer: draft,
          jobTitle: session.jobTitle,
          category: item.category,
        });
        feedback = { mode: 'ai', model: aiStatus.model, ...res };
      } catch (err) {
        feedback = { ...checkAnswer({ question: item.question, answer: draft, category: item.category }), fallbackReason: err.message };
      }
    } else {
      feedback = checkAnswer({ question: item.question, answer: draft, category: item.category });
    }
    setLoading(false);
    saveItem({ answer: draft, feedback, answeredAt: new Date().toISOString() });
  };

  const next = () => {
    if (draft !== (item.answer || '')) saveItem({ answer: draft });
    if (isLast) onFinish();
    else goTo(index + 1);
  };

  const answeredCount = session.items.filter((i) => i.feedback).length;

  return (
    <div className="session">
      <div className="session-top">
        <div>
          <span className="subtle">
            {INTERVIEW_TYPES.find((t) => t.value === session.type)?.label} interview for {session.jobTitle}
          </span>
          <div className="session-progress">
            <ProgressBar value={(answeredCount / session.items.length) * 100} label="Session progress" />
            <span className="subtle nowrap">
              {answeredCount} of {session.items.length} answered
            </span>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onExit}>
          Save and exit
        </button>
      </div>

      <div className="q-dots" aria-label="Questions">
        {session.items.map((it, i) => (
          <button
            key={i}
            className={`q-dot ${i === index ? 'current' : ''} ${it.feedback ? 'answered' : ''}`}
            onClick={() => goTo(i)}
            aria-label={`Question ${i + 1}${it.feedback ? ', answered' : ''}`}
            aria-current={i === index}
          >
            {i + 1}
          </button>
        ))}
      </div>

      <section className="panel question-card">
        <div className="question-meta">
          <span className="badge">{CATEGORY_LABEL[item.category]}</span>
          <span className="subtle">{QUESTION_SOURCE[item.source] || QUESTION_SOURCE.library}</span>
        </div>
        <h2 className="question-text">{item.question}</h2>
        <p className="question-tip">
          <Icon name="info" size={15} /> {CATEGORY_TIP[item.category]}
        </p>
        <Field label="Your answer" id="iv-answer" hint={`${wordCount(draft)} words. Write it the way you'd say it out loud.`}>
          <textarea id="iv-answer" className="textarea answer-box" rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </Field>
        <div className="row-actions">
          <button className="btn btn-primary" onClick={getFeedback} disabled={loading}>
            {loading ? <Spinner /> : <Icon name={aiActive ? 'spark' : 'check'} size={15} />}
            {loading ? 'Reviewing your answer…' : item.feedback ? 'Get feedback again' : 'Get feedback'}
          </button>
          <button className="btn btn-secondary" onClick={next}>
            {isLast ? 'Finish session' : item.feedback ? 'Next question' : 'Skip for now'}
          </button>
        </div>
        {item.feedback && (
          <div className="question-feedback">
            <FeedbackView feedback={item.feedback} />
          </div>
        )}
      </section>
    </div>
  );
}

function SessionReview({ session, onDelete, onResume }) {
  const [open, setOpen] = useState(false);
  const answered = session.items.filter((i) => i.answer?.trim());
  return (
    <div className={`history-item ${open ? 'open' : ''}`}>
      <div className="history-head">
        <button className="entry-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name="chevronRight" size={16} className="entry-chevron" />
          <span>
            <strong>{session.jobTitle}</strong>
            <small className="meta-row">
              <span>{INTERVIEW_TYPES.find((t) => t.value === session.type)?.label}</span>
              <span>{formatDateTime(session.startedAt)}</span>
              <span>
                {answered.length} of {session.items.length} answered
              </span>
            </small>
          </span>
        </button>
        <div className="entry-tools">
          {!session.completedAt && (
            <button className="btn btn-secondary btn-sm" onClick={() => onResume(session)}>
              Continue
            </button>
          )}
          {session.completedAt && <span className="badge badge-accent">Completed</span>}
          <button className="icon-btn danger" onClick={() => onDelete(session)} aria-label="Delete session">
            <Icon name="trash" size={15} />
          </button>
        </div>
      </div>
      {open && (
        <div className="history-body">
          {session.items.map((it, i) => (
            <div className="history-q" key={i}>
              <p className="history-question">
                <span className="subtle">Q{i + 1}.</span> {it.question}
              </p>
              {it.answer?.trim() ? <blockquote>{it.answer}</blockquote> : <p className="subtle">Not answered.</p>}
              {it.feedback && <FeedbackView feedback={it.feedback} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function InterviewPractice() {
  const { data, actions, aiActive, aiStatus } = useAppData();
  const toast = useToast();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') === 'history' ? 'history' : 'practice');
  // ?job=<application id> prepares a session for that tracked job.
  const linkedJob = data.applications.find((a) => a.id === params.get('job'));
  const [activeId, setActiveId] = useState(null);
  const [summaryId, setSummaryId] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [preparing, setPreparing] = useState(false);

  const sessions = data.interviewSessions;
  const active = sessions.find((s) => s.id === activeId);
  const summary = sessions.find((s) => s.id === summaryId);

  const start = async ({ jobTitle, type, count, jobDescription, useAi, applicationId }) => {
    let questions = null;
    if (useAi) {
      setPreparing(true);
      try {
        const res = await callAi('questions', { jobTitle, jobDescription, type, count: String(count) });
        questions = res.questions.slice(0, count).map((q) => ({ question: q.question.trim(), category: q.category, source: 'ai' }));
      } catch (err) {
        toast.error(`AI questions are unavailable (${err.message}). Using the built-in library instead.`);
      } finally {
        setPreparing(false);
      }
    }
    if (!questions?.length) questions = buildQuestionSet({ jobTitle, type, count, jobDescription }).questions;
    const session = {
      id: createId('iv'),
      jobTitle,
      applicationId: applicationId || null,
      type,
      startedAt: new Date().toISOString(),
      completedAt: null,
      items: questions.map((q) => ({ source: 'library', ...q, answer: '', feedback: null })),
    };
    actions.saveInterviewSession(session);
    setActiveId(session.id);
    setSummaryId(null);
  };

  const finish = () => {
    const s = sessions.find((x) => x.id === activeId);
    if (!s) return;
    const answered = s.items.filter((i) => i.answer?.trim()).length;
    actions.saveInterviewSession({ ...s, completedAt: new Date().toISOString() });
    actions.logActivity('interview', `Practiced ${answered} interview question${answered === 1 ? '' : 's'} for ${s.jobTitle}`);
    toast.success('Practice session saved.');
    setActiveId(null);
    setSummaryId(s.id);
  };

  const exit = () => {
    setActiveId(null);
    toast.info('Session saved. Continue it anytime from History.');
  };

  return (
    <div className="interview-page">
      <PageHeader
        title="Interview Practice"
        description="Answer common interview questions in writing, get feedback, and review your answers before the real thing."
        actions={
          !active && (
            <Segmented
              label="Interview practice views"
              value={tab}
              onChange={(v) => {
                setTab(v);
                setSummaryId(null);
              }}
              options={[
                { value: 'practice', label: 'Practice', icon: 'play' },
                { value: 'history', label: `History (${sessions.length})`, icon: 'history' },
              ]}
            />
          )
        }
      />

      {active ? (
        <Session key={active.id} session={active} onUpdate={actions.saveInterviewSession} onFinish={finish} onExit={exit} />
      ) : tab === 'practice' ? (
        summary ? (
          <section className="panel panel-pad session-summary">
            <div className="summary-icon">
              <Icon name="check" size={22} strokeWidth={2.2} />
            </div>
            <h2>Session complete</h2>
            <p className="muted">
              You answered {summary.items.filter((i) => i.answer?.trim()).length} of {summary.items.length} questions for {summary.jobTitle}. Read your feedback in History, then try the questions again out loud.
            </p>
            <div className="row-actions center">
              <button className="btn btn-primary" onClick={() => setSummaryId(null)}>
                Practice again
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setSummaryId(null);
                  setTab('history');
                }}
              >
                Review answers
              </button>
            </div>
          </section>
        ) : (
          <div className="interview-setup">
            <ModeNotice
              aiActive={aiActive}
              aiStatus={aiStatus}
              basicText="Questions come from a built-in library, plus questions about skills named in a job description you paste. Feedback is an automated checklist (length, STAR structure, specifics) — useful, but not personalized like a coach or AI."
            />
            <Setup onStart={start} defaultTitle={data.profile?.targetRole} defaultJob={linkedJob} busy={preparing} />
          </div>
        )
      ) : sessions.length ? (
        <div className="history-list">
          {sessions.map((s) => (
            <SessionReview
              key={s.id}
              session={s}
              onDelete={setDeleting}
              onResume={(x) => {
                setActiveId(x.id);
                setTab('practice');
              }}
            />
          ))}
        </div>
      ) : (
        <div className="panel">
          <EmptyState
            icon="interview"
            title="No practice sessions yet"
            action={
              <button className="btn btn-primary" onClick={() => setTab('practice')}>
                Start practicing
              </button>
            }
          >
            Your answers and feedback are saved here so you can review them before an interview.
          </EmptyState>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this practice session?"
        message="Your answers and feedback for this session will be removed."
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          actions.deleteInterviewSession(deleting.id);
          toast.success('Practice session deleted.');
          setDeleting(null);
        }}
      />
    </div>
  );
}
