import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../Icon.jsx';
import { Field, ModeNotice, ProgressRing, Spinner } from '../ui.jsx';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { analyzeJobMatch } from '../../lib/jobMatch.js';
import { resumeToText } from '../../lib/resume.js';
import { callAi } from '../../lib/ai.js';

export default function TailorPanel({ resume }) {
  const { data, aiActive, aiStatus, actions } = useAppData();
  const toast = useToast();
  const [jobText, setJobText] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [aiTips, setAiTips] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  const savedPostings = data.applications.filter((a) => (a.description || '').trim().length > 40);

  const analyze = () => {
    if (jobText.trim().length < 80) {
      setError('Paste the full job description (at least a few sentences) so there is enough to compare.');
      return;
    }
    setError('');
    setAiTips(null);
    setResult(analyzeJobMatch(resume, jobText));
    actions.logActivity('resume', 'Compared your resume with a job description');
  };

  const getAiTips = async () => {
    setAiLoading(true);
    try {
      const res = await callAi('tailor', { resumeText: resumeToText(resume, { includeContact: false }), jobDescription: jobText });
      setAiTips(res.suggestions);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="tailor">
      <section className="panel panel-pad tailor-input">
        <h2>Compare your resume with a job</h2>
        <p className="muted small">See which skills from the posting your resume already shows, what is missing, and what to improve.</p>
        {savedPostings.length > 0 && (
          <Field label="Use a job from your tracker" id="tailor-pick">
            <select
              id="tailor-pick"
              className="select"
              defaultValue=""
              onChange={(e) => {
                const app = savedPostings.find((a) => a.id === e.target.value);
                if (app) setJobText(app.description);
              }}
            >
              <option value="" disabled>
                Choose a saved job…
              </option>
              {savedPostings.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title} — {a.company}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Job description" id="tailor-jd" error={error}>
          <textarea
            id="tailor-jd"
            className="textarea"
            rows={10}
            value={jobText}
            onChange={(e) => setJobText(e.target.value)}
            placeholder="Paste the full job posting here, including responsibilities and requirements."
          />
        </Field>
        <div className="row-actions">
          <button type="button" className="btn btn-primary" onClick={analyze}>
            <Icon name="search" size={16} /> Compare
          </button>
          {jobText && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setJobText('');
                setResult(null);
                setAiTips(null);
              }}
            >
              Clear
            </button>
          )}
        </div>
      </section>

      {result && (
        <section className="tailor-results" aria-live="polite">
          <div className="panel panel-pad match-summary">
            <ProgressRing value={result.score} size={92}>
              <strong className="ring-number">{result.jobSkills.length ? `${result.score}%` : '—'}</strong>
            </ProgressRing>
            <div>
              <h3>Skill match</h3>
              <p className="muted small">
                {result.jobSkills.length
                  ? `Your resume shows ${result.matched.length} of the ${result.jobSkills.length} skills recognized in this posting.`
                  : 'No common skills were recognized in this posting.'}{' '}
                Resume completeness: {result.completeness}%.
              </p>
              <p className="subtle">Keyword-based comparison — no AI. It looks for skill names, so it can miss synonyms.</p>
            </div>
          </div>

          <div className="match-columns">
            <div className="panel panel-pad">
              <h3 className="with-icon">
                <Icon name="check" size={16} /> Relevant skills you show
              </h3>
              {result.matched.length ? (
                <div className="chip-row">
                  {result.matched.map((s) => (
                    <span className="chip chip-match" key={s}>
                      {s}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="muted small">None of the recognized skills appear in your resume yet.</p>
              )}
            </div>
            <div className="panel panel-pad">
              <h3 className="with-icon">
                <Icon name="alert" size={16} /> In the posting, not in your resume
              </h3>
              {result.missing.length ? (
                <div className="chip-row">
                  {result.missing.map((s) => (
                    <span className="chip chip-missing" key={s}>
                      {s}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="muted small">Nothing missing from the recognized skills.</p>
              )}
              <p className="subtle mt-8">Add these only if you really have them.</p>
            </div>
          </div>

          {result.qualifications.length > 0 && (
            <div className="panel panel-pad">
              <h3>Qualifications to check</h3>
              <ul className="qual-list">
                {result.qualifications.map((q) => (
                  <li key={q.label}>
                    <strong>“{q.label}”</strong>
                    <span className="muted small">{q.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="panel panel-pad">
            <h3>Suggestions</h3>
            <ul className="tip-list">
              {result.suggestions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <div className="ai-block">
              {aiActive ? (
                aiTips ? (
                  <div className="suggestion">
                    <div className="suggestion-head">
                      <span className="badge badge-accent">AI suggestions</span>
                      <span className="subtle">Generated by {aiStatus.model}. Review before acting on them.</span>
                    </div>
                    <ul>
                      {aiTips.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <button type="button" className="btn btn-secondary" onClick={getAiTips} disabled={aiLoading}>
                    {aiLoading ? <Spinner /> : <Icon name="spark" size={15} />}
                    {aiLoading ? 'Asking AI…' : 'Get personalized AI suggestions'}
                  </button>
                )
              ) : (
                <ModeNotice aiActive={false} basicText="These suggestions come from the keyword comparison above." />
              )}
            </div>
          </div>
          <p className="subtle">
            Ready to edit? <Link to="/resume?section=skills">Update your skills</Link> or <Link to="/resume?section=experience">your experience bullets</Link>.
          </p>
        </section>
      )}
    </div>
  );
}
