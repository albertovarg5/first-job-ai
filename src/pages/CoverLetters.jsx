import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import JobPicker from '../components/jobs/JobPicker.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { EmptyState, Field, ModeNotice, PageHeader, Spinner } from '../components/ui.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { callAi } from '../lib/ai.js';
import { basicCoverLetter, fillName, placeholderCount } from '../lib/careerText.js';
import { buildLetterPdf, downloadBytes, letterFileName } from '../lib/letterPdf.js';
import { isResumeEmpty, resumeToText } from '../lib/resume.js';
import { timeAgo, wordCount } from '../lib/utils.js';

const TONES = [
  { value: 'professional', label: 'Professional' },
  { value: 'warm', label: 'Warm and friendly' },
  { value: 'concise', label: 'Short and direct' },
];

const blankLetter = () => ({ id: null, jobTitle: '', company: '', jobDescription: '', notes: '', tone: 'professional', text: '', gaps: [], mode: null });

function LetterEditor({ initial, onSaved, onDeleted }) {
  const { data, actions, aiActive, aiStatus } = useAppData();
  const toast = useToast();
  const [form, setForm] = useState(() => ({ ...blankLetter(), ...initial }));
  const [errors, setErrors] = useState({});
  const [generating, setGenerating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const resume = data.resume;
  const name = resume.contact?.fullName || data.profile?.name || '';

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const validate = () => {
    const e = {};
    if (!form.jobTitle.trim()) e.jobTitle = 'Enter the job title.';
    if (!form.company.trim()) e.company = 'Enter the company name.';
    if (form.jobDescription.trim().length < 80) e.jobDescription = 'Paste the job description (at least a few sentences) so the letter can be relevant.';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const generate = async () => {
    setConfirmRegenerate(false);
    if (!validate()) return;
    setGenerating(true);
    let result;
    if (aiActive) {
      try {
        const res = await callAi('coverLetter', {
          resumeText: resumeToText(resume, { includeContact: false }),
          jobTitle: form.jobTitle,
          company: form.company,
          jobDescription: form.jobDescription,
          notes: form.notes,
          tone: form.tone,
        });
        result = { text: fillName(res.letter.trim(), name), gaps: (res.gaps || []).map(String).slice(0, 10), mode: 'ai' };
      } catch (err) {
        toast.error(`AI is unavailable (${err.message}). A Basic-mode draft was created instead.`);
      }
    }
    if (!result) {
      const basic = basicCoverLetter({ resume, name, jobTitle: form.jobTitle, company: form.company, jobDescription: form.jobDescription, notes: form.notes });
      result = { text: basic.letter, gaps: basic.gaps, mode: 'basic' };
    }
    setGenerating(false);
    setForm((f) => ({ ...f, ...result }));
  };

  const save = () => {
    if (!form.text.trim()) return;
    const record = actions.saveCoverLetter({ ...form });
    if (!form.id) actions.logActivity('resume', `Wrote a cover letter for ${form.jobTitle} at ${form.company}`);
    setForm((f) => ({ ...f, id: record.id, createdAt: record.createdAt }));
    toast.success('Cover letter saved.');
    onSaved?.(record);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(form.text);
      toast.success('Copied to clipboard.');
    } catch {
      toast.error('Your browser blocked copying. Select the text and copy it manually.');
    }
  };

  const download = () => {
    downloadBytes(buildLetterPdf({ letter: form.text, contact: resume.contact }), letterFileName(resume.contact, form.company));
    toast.success('PDF downloaded.');
  };

  const placeholders = placeholderCount(form.text);

  return (
    <div className="letter-editor">
      <section className="panel panel-pad form-stack">
        <h2>{form.id ? 'Edit cover letter' : 'New cover letter'}</h2>
        <JobPicker
          id="cl-pick"
          onPick={(job) => {
            setForm((f) => ({ ...f, jobTitle: job.title, company: job.company, jobDescription: job.description, sourceJobId: job.sourceJobId, applicationId: job.applicationId }));
            setErrors({});
          }}
        />
        <div className="form-grid">
          <Field label="Job title" id="cl-title" required error={errors.jobTitle}>
            <input id="cl-title" className="input" value={form.jobTitle} maxLength={200} onChange={(e) => set('jobTitle', e.target.value)} />
          </Field>
          <Field label="Company" id="cl-company" required error={errors.company}>
            <input id="cl-company" className="input" value={form.company} maxLength={200} onChange={(e) => set('company', e.target.value)} />
          </Field>
          <Field label="Job description" id="cl-desc" required error={errors.jobDescription} className="span-2">
            <textarea id="cl-desc" className="textarea" rows={6} maxLength={12000} value={form.jobDescription} onChange={(e) => set('jobDescription', e.target.value)} />
          </Field>
          <Field
            label="Why this job? (optional)"
            id="cl-notes"
            className="span-2"
            hint="In your own words: what interests you about this company or role. This is the most personal part of a letter."
          >
            <textarea id="cl-notes" className="textarea" rows={3} maxLength={2000} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
          {aiActive && (
            <Field label="Tone" id="cl-tone">
              <select id="cl-tone" className="select" value={form.tone} onChange={(e) => set('tone', e.target.value)}>
                {TONES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        {isResumeEmpty(resume) && (
          <div className="alert alert-warn">
            <Icon name="alert" size={16} /> Your resume is empty, so the letter can only include placeholders. <Link to="/resume">Add your experience first</Link>.
          </div>
        )}
        <div className="row-actions">
          <button className="btn btn-primary" onClick={() => (form.text.trim() ? setConfirmRegenerate(true) : generate())} disabled={generating}>
            {generating ? <Spinner /> : <Icon name={aiActive ? 'spark' : 'edit'} size={15} />}
            {generating ? 'Writing…' : form.text ? 'Write a new draft' : 'Write draft'}
          </button>
        </div>
      </section>

      {form.text && (
        <section className="panel panel-pad form-stack">
          <div className="letter-head">
            <h2>Your letter</h2>
            <span className={`badge ${form.mode === 'ai' ? 'badge-accent' : ''}`}>
              {form.mode === 'ai' ? (
                <>
                  <Icon name="spark" size={12} /> AI draft
                </>
              ) : form.mode === 'basic' ? (
                'Basic mode — template, no AI'
              ) : (
                'Edited'
              )}
            </span>
          </div>
          {placeholders > 0 && (
            <div className="alert alert-warn">
              <Icon name="alert" size={16} /> Fill in {placeholders} [bracketed] part{placeholders === 1 ? '' : 's'} before sending.
            </div>
          )}
          {form.gaps?.length > 0 && (
            <div className="match-box check">
              <strong>The posting mentions things your resume doesn’t show</strong>
              <span>The letter does not claim these. If you really have any of them, add them to your resume and write a new draft.</span>
              <div className="chip-row">
                {form.gaps.map((g) => (
                  <span key={g} className="chip chip-missing">
                    {g}
                  </span>
                ))}
              </div>
            </div>
          )}
          <Field label="Letter" id="cl-text" hint={`${wordCount(form.text)} words. Edit freely — most good letters are 250–400 words.`}>
            <textarea id="cl-text" className="textarea letter-text" rows={18} value={form.text} onChange={(e) => set('text', e.target.value)} />
          </Field>
          <p className="subtle">Read it carefully before sending. Make sure every sentence is true and sounds like you.</p>
          <div className="row-actions">
            <button className="btn btn-primary" onClick={save}>
              <Icon name="check" size={15} /> Save
            </button>
            <button className="btn btn-secondary" onClick={copy}>
              <Icon name="copy" size={15} /> Copy
            </button>
            <button className="btn btn-secondary" onClick={download}>
              <Icon name="download" size={15} /> Download PDF
            </button>
            {form.id && (
              <button className="btn btn-danger-ghost" onClick={() => setConfirmDelete(true)}>
                <Icon name="trash" size={15} /> Delete
              </button>
            )}
          </div>
        </section>
      )}

      {!form.text && <ModeNotice aiActive={aiActive} aiStatus={aiStatus} basicText="Drafts are built from a template using only your resume, the posting and your notes, with [brackets] where you need to add details." />}

      <ConfirmDialog
        open={confirmRegenerate}
        title="Replace the current letter?"
        message="Writing a new draft replaces the text in the editor, including your edits. Save first if you want to keep this version."
        confirmLabel="Write new draft"
        danger={false}
        onCancel={() => setConfirmRegenerate(false)}
        onConfirm={generate}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this cover letter?"
        message="This saved letter will be permanently removed."
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          actions.deleteCoverLetter(form.id);
          toast.success('Cover letter deleted.');
          setConfirmDelete(false);
          onDeleted?.();
        }}
      />
    </div>
  );
}

export default function CoverLetters() {
  const { data } = useAppData();
  const [params] = useSearchParams();
  const letters = data.coverLetters;
  // ?letter=<id> opens a saved letter; ?job=<application id> starts one for that job.
  const [editing, setEditing] = useState(() => {
    const letter = letters.find((l) => l.id === params.get('letter'));
    if (letter) return letter;
    const app = data.applications.find((a) => a.id === params.get('job'));
    return app ? { jobTitle: app.title, company: app.company, jobDescription: app.description || '', applicationId: app.id } : null;
  }); // null = list, {} = new, letter

  return (
    <div className="cover-letters-page">
      <PageHeader
        title="Cover Letters"
        description="Write a tailored, honest cover letter from your resume and the job posting."
        actions={
          editing ? (
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>
              <Icon name="chevronLeft" size={15} /> All letters
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <Icon name="plus" size={16} /> New cover letter
            </button>
          )
        }
      />
      {editing ? (
        <LetterEditor key={editing.id || 'new'} initial={editing} onSaved={(r) => setEditing(r)} onDeleted={() => setEditing(null)} />
      ) : letters.length ? (
        <div className="library-grid">
          {letters.map((l) => (
            <button key={l.id} className="panel library-item letter-card" onClick={() => setEditing(l)}>
              <div className="library-head">
                <strong>{l.jobTitle}</strong>
                <span className="subtle">{timeAgo(l.updatedAt)}</span>
              </div>
              <span className="muted small">{l.company}</span>
              <p className="letter-snippet">{l.text.slice(0, 160)}…</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="panel">
          <EmptyState
            icon="letter"
            title="No cover letters yet"
            action={
              <button className="btn btn-primary" onClick={() => setEditing({})}>
                <Icon name="plus" size={16} /> Write your first letter
              </button>
            }
          >
            Pick a saved job or paste a posting. The letter only uses experience from your resume and what you tell it.
          </EmptyState>
        </div>
      )}
    </div>
  );
}
