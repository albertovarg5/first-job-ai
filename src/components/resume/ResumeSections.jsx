import { useState } from 'react';
import Icon from '../Icon.jsx';
import { EmptyState, Field, Spinner, TagInput } from '../ui.jsx';
import { ConfirmDialog } from '../Modal.jsx';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { callAi } from '../../lib/ai.js';
import { basicSummary } from '../../lib/careerText.js';
import BulletsEditor from './BulletsEditor.jsx';
import { SECTION_TEMPLATES, resumeToText } from '../../lib/resume.js';
import { findSkills } from '../../lib/jobMatch.js';
import { createId, isValidEmail } from '../../lib/utils.js';

export function ContactSection({ resume, onChange }) {
  const c = resume.contact;
  const set = (key) => (e) => onChange({ ...resume, contact: { ...c, [key]: e.target.value } });
  const emailError = !isValidEmail(c.email) ? 'This email doesn’t look complete.' : null;
  return (
    <div className="form-grid">
      <Field label="Full name" id="r-name" required className="span-2">
        <input id="r-name" className="input" value={c.fullName} onChange={set('fullName')} autoComplete="name" />
      </Field>
      <Field label="Email" id="r-email" error={emailError}>
        <input id="r-email" type="email" className="input" value={c.email} onChange={set('email')} autoComplete="email" />
      </Field>
      <Field label="Phone" id="r-phone">
        <input id="r-phone" className="input" value={c.phone} onChange={set('phone')} autoComplete="tel" />
      </Field>
      <Field label="City, State" id="r-loc" hint="A city is enough — no street address needed.">
        <input id="r-loc" className="input" value={c.location} onChange={set('location')} />
      </Field>
      <Field label="LinkedIn" id="r-li" hint="Optional, e.g. linkedin.com/in/yourname">
        <input id="r-li" className="input" value={c.linkedin} onChange={set('linkedin')} />
      </Field>
      <Field label="Portfolio or website" id="r-web" hint="Optional — GitHub, Behance, personal site." className="span-2">
        <input id="r-web" className="input" value={c.website} onChange={set('website')} />
      </Field>
    </div>
  );
}

export function SummarySection({ resume, onChange, targetRole }) {
  const { aiActive } = useAppData();
  const toast = useToast();
  const [drafting, setDrafting] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [draftMode, setDraftMode] = useState(null);
  const length = resume.summary.trim().length;
  const hasMaterial = resumeToText({ ...resume, summary: '' }, { includeContact: false }).trim().length > 20;

  const draft = async () => {
    setConfirmReplace(false);
    setDrafting(true);
    let summary = '';
    let mode = 'basic';
    if (aiActive) {
      try {
        const res = await callAi('summary', { resumeText: resumeToText({ ...resume, summary: '' }, { includeContact: false }), targetRole });
        summary = res.summary.trim();
        mode = 'ai';
      } catch (err) {
        toast.error(`AI is unavailable (${err.message}). Using a Basic-mode draft.`);
      }
    }
    if (!summary) summary = basicSummary(resume, targetRole || '');
    setDrafting(false);
    if (!summary) {
      toast.info('Add education, experience or skills first so there is something to summarize.');
      return;
    }
    setDraftMode(mode);
    onChange({ ...resume, summary });
  };

  return (
    <div className="form-stack">
      <div className="row-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={drafting || !hasMaterial}
          onClick={() => (resume.summary.trim() ? setConfirmReplace(true) : draft())}
          title={hasMaterial ? undefined : 'Fill in other sections first'}
        >
          {drafting ? <Spinner /> : <Icon name={aiActive ? 'spark' : 'edit'} size={14} />} Draft from my resume
        </button>
        {draftMode && (
          <span className="subtle">
            {draftMode === 'ai' ? 'AI draft — check every word is true.' : 'Basic-mode draft built from your entries — edit it to sound like you.'}
          </span>
        )}
      </div>
      <ConfirmDialog
        open={confirmReplace}
        title="Replace your summary?"
        message="A new draft will replace the summary you have now."
        confirmLabel="Replace"
        danger={false}
        onCancel={() => setConfirmReplace(false)}
        onConfirm={draft}
      />
      <Field
        label="Professional summary"
        id="r-summary"
        hint={`2–3 sentences: who you are, what you’re good at, and the role you want${targetRole ? ` (for example, ${targetRole})` : ''}. ${length} characters.`}
      >
        <textarea
          id="r-summary"
          className="textarea"
          rows={5}
          value={resume.summary}
          onChange={(e) => onChange({ ...resume, summary: e.target.value })}
          placeholder="Business administration student with retail experience and strong customer service skills, seeking a marketing internship where I can apply my social media and writing experience."
        />
      </Field>
    </div>
  );
}

const LIST_CONFIG = {
  education: {
    noun: 'education',
    addLabel: 'Add education',
    empty: 'Add your school, even if you haven’t graduated yet. Use your expected graduation date.',
    title: (i) => i.school || 'New education',
    sub: (i) => [i.degree, i.field].filter(Boolean).join(', '),
    fields: [
      { key: 'school', label: 'School', required: true, span: 2 },
      { key: 'degree', label: 'Degree', placeholder: 'B.S., B.A., Associate, Certificate…' },
      { key: 'field', label: 'Field of study', placeholder: 'Computer Science' },
      { key: 'start', label: 'Start', placeholder: 'Sep 2023' },
      { key: 'end', label: 'End (or expected)', placeholder: 'Expected May 2027' },
      { key: 'details', label: 'Highlights', type: 'textarea', span: 2, hint: 'Optional, one per line: GPA (if 3.0+), relevant courses, honors.' },
    ],
  },
  experience: {
    noun: 'job',
    addLabel: 'Add job',
    empty: 'Part-time, summer, family business and freelance work all count.',
    title: (i) => i.role || 'New job',
    sub: (i) => i.org,
    category: 'job',
    fields: [
      { key: 'role', label: 'Job title', required: true },
      { key: 'org', label: 'Company or organization' },
      { key: 'location', label: 'Location' },
      { key: 'start', label: 'Start', placeholder: 'Jun 2024' },
      { key: 'end', label: 'End', placeholder: 'Present' },
      { key: 'bullets', type: 'bullets', span: 2 },
    ],
  },
  projects: {
    noun: 'project',
    addLabel: 'Add project',
    empty: 'Class projects, personal projects, hackathons and club projects show real skills.',
    title: (i) => i.name || 'New project',
    sub: (i) => i.role,
    category: 'school',
    fields: [
      { key: 'name', label: 'Project name', required: true },
      { key: 'role', label: 'Context or your role', placeholder: 'Team project, CS 210' },
      { key: 'start', label: 'Start', placeholder: 'Jan 2025' },
      { key: 'end', label: 'End', placeholder: 'Mar 2025' },
      { key: 'link', label: 'Link', placeholder: 'github.com/you/project', span: 2 },
      { key: 'bullets', type: 'bullets', span: 2 },
    ],
  },
  volunteering: {
    noun: 'volunteer role',
    addLabel: 'Add volunteer role',
    empty: 'Volunteering shows initiative and real responsibilities.',
    title: (i) => i.role || 'New volunteer role',
    sub: (i) => i.org,
    category: 'volunteer',
    fields: [
      { key: 'role', label: 'Role', required: true, placeholder: 'Volunteer, Event lead…' },
      { key: 'org', label: 'Organization' },
      { key: 'location', label: 'Location' },
      { key: 'start', label: 'Start' },
      { key: 'end', label: 'End' },
      { key: 'bullets', type: 'bullets', span: 2 },
    ],
  },
  achievements: {
    noun: 'achievement',
    addLabel: 'Add achievement',
    empty: 'Awards, scholarships, certifications, competitions or honors.',
    title: (i) => i.title || 'New achievement',
    sub: (i) => i.date,
    fields: [
      { key: 'title', label: 'Achievement', required: true, placeholder: 'Dean’s List' },
      { key: 'date', label: 'Date', placeholder: '2025' },
      { key: 'description', label: 'Description', type: 'textarea', span: 2, hint: 'Optional — one short sentence.' },
    ],
  },
};

export function ListSection({ type, resume, onChange }) {
  const config = LIST_CONFIG[type];
  const items = resume[type] || [];
  const [openId, setOpenId] = useState(items[0]?.id || null);
  const [confirmId, setConfirmId] = useState(null);

  const setItems = (next) => onChange({ ...resume, [type]: next });
  const updateItem = (id, key, value) => setItems(items.map((i) => (i.id === id ? { ...i, [key]: value } : i)));
  const add = () => {
    const item = { id: createId(type.slice(0, 3)), ...SECTION_TEMPLATES[type] };
    setItems([...items, item]);
    setOpenId(item.id);
  };
  const move = (index, dir) => {
    const next = [...items];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
  };

  return (
    <div className="list-section">
      {items.length === 0 && (
        <EmptyState icon="plus" title={`No ${config.noun} added yet`}>
          {config.empty}
        </EmptyState>
      )}
      {items.map((item, index) => {
        const open = openId === item.id;
        return (
          <div className={`entry-card ${open ? 'open' : ''}`} key={item.id}>
            <div className="entry-head">
              <button type="button" className="entry-toggle" onClick={() => setOpenId(open ? null : item.id)} aria-expanded={open}>
                <Icon name="chevronRight" size={16} className="entry-chevron" />
                <span>
                  <strong>{config.title(item)}</strong>
                  {config.sub(item) && <small>{config.sub(item)}</small>}
                </span>
              </button>
              <div className="entry-tools">
                <button type="button" className="icon-btn" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up">
                  <Icon name="chevronRight" size={15} className="rot-up" />
                </button>
                <button type="button" className="icon-btn" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label="Move down">
                  <Icon name="chevronRight" size={15} className="rot-down" />
                </button>
                <button type="button" className="icon-btn danger" onClick={() => setConfirmId(item.id)} aria-label={`Delete ${config.title(item)}`}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </div>
            {open && (
              <div className="entry-body form-grid">
                {config.fields.map((f) => {
                  const fid = `${item.id}-${f.key}`;
                  if (f.type === 'bullets') {
                    return (
                      <div className="span-2" key={f.key}>
                        <BulletsEditor id={fid} value={item.bullets} category={config.category} onChange={(v) => updateItem(item.id, 'bullets', v)} />
                      </div>
                    );
                  }
                  return (
                    <Field key={f.key} label={f.label} id={fid} required={f.required} hint={f.hint} className={f.span === 2 ? 'span-2' : ''}>
                      {f.type === 'textarea' ? (
                        <textarea id={fid} className="textarea" rows={3} value={item[f.key] || ''} onChange={(e) => updateItem(item.id, f.key, e.target.value)} />
                      ) : (
                        <input id={fid} className="input" value={item[f.key] || ''} placeholder={f.placeholder} onChange={(e) => updateItem(item.id, f.key, e.target.value)} />
                      )}
                    </Field>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <button type="button" className="btn btn-secondary add-entry" onClick={add}>
        <Icon name="plus" size={16} /> {config.addLabel}
      </button>
      <ConfirmDialog
        open={Boolean(confirmId)}
        title={`Delete this ${config.noun}?`}
        message="This removes it from your resume. You can’t undo this."
        onCancel={() => setConfirmId(null)}
        onConfirm={() => {
          setItems(items.filter((i) => i.id !== confirmId));
          setConfirmId(null);
        }}
      />
    </div>
  );
}

export function SkillsSection({ resume, onChange }) {
  const listed = new Set(resume.skills.map((s) => s.toLowerCase()));
  // Skills mentioned in the user's own bullets that aren't listed yet.
  const found = findSkills(resumeToText({ ...resume, skills: [] })).filter((s) => !listed.has(s.toLowerCase()));
  return (
    <div className="form-stack">
      <Field label="Skills" id="r-skills" hint="Press Enter or comma after each skill. List skills you could talk about in an interview.">
        <TagInput id="r-skills" value={resume.skills} onChange={(skills) => onChange({ ...resume, skills })} placeholder="e.g. Excel, Customer service, Python" />
      </Field>
      {found.length > 0 && (
        <div className="panel-flat">
          <p className="small">
            <strong>Mentioned in your resume but not listed:</strong> click to add.
          </p>
          <div className="chip-row">
            {found.map((s) => (
              <button type="button" className="chip-btn" key={s} onClick={() => onChange({ ...resume, skills: [...resume.skills, s] })}>
                <Icon name="plus" size={12} /> {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const SECTIONS = [
  { id: 'contact', label: 'Contact' },
  { id: 'summary', label: 'Summary' },
  { id: 'education', label: 'Education' },
  { id: 'experience', label: 'Experience' },
  { id: 'projects', label: 'Projects' },
  { id: 'volunteering', label: 'Volunteering' },
  { id: 'skills', label: 'Skills' },
  { id: 'achievements', label: 'Achievements' },
];

export function sectionHasContent(resume, id) {
  if (id === 'contact') return Boolean(resume.contact.fullName && resume.contact.email);
  if (id === 'summary') return resume.summary.trim().length >= 40;
  if (id === 'skills') return resume.skills.length >= 5;
  return (resume[id] || []).length > 0;
}
