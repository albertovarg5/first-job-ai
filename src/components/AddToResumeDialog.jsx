import { useState } from 'react';
import { Modal } from './Modal.jsx';
import { Field } from './ui.jsx';
import { SECTION_TEMPLATES } from '../lib/resume.js';
import { createId } from '../lib/utils.js';

const TARGETS = {
  experience: { label: 'Experience', titleKey: 'role', titleLabel: 'Job title', orgKey: 'org', orgLabel: 'Company' },
  projects: { label: 'Projects', titleKey: 'name', titleLabel: 'Project name', orgKey: 'role', orgLabel: 'Context (e.g. class or team)' },
  volunteering: { label: 'Volunteering', titleKey: 'role', titleLabel: 'Role', orgKey: 'org', orgLabel: 'Organization' },
};

const DEFAULT_SECTION = {
  school: 'projects',
  team: 'projects',
  personal: 'projects',
  volunteer: 'volunteering',
  leadership: 'volunteering',
  job: 'experience',
  other: 'experience',
};

// Lets the user append translated bullets to an existing resume entry or a new one.
export default function AddToResumeDialog({ open, bullets, category, resume, onSave, onClose }) {
  const [section, setSection] = useState(DEFAULT_SECTION[category] || 'experience');
  const entries = resume[section] || [];
  const [target, setTarget] = useState(entries[0]?.id || 'new');
  const [title, setTitle] = useState('');
  const [org, setOrg] = useState('');
  const [error, setError] = useState('');
  const cfg = TARGETS[section];

  const changeSection = (value) => {
    setSection(value);
    setTarget((resume[value] || [])[0]?.id || 'new');
    setError('');
  };

  const save = (e) => {
    e.preventDefault();
    const text = bullets.join('\n');
    let next;
    if (target === 'new') {
      if (!title.trim()) {
        setError(`Enter a ${cfg.titleLabel.toLowerCase()} for the new entry.`);
        return;
      }
      const item = { id: createId(section.slice(0, 3)), ...SECTION_TEMPLATES[section], [cfg.titleKey]: title.trim(), [cfg.orgKey]: org.trim(), bullets: text };
      next = { ...resume, [section]: [...entries, item] };
    } else {
      next = {
        ...resume,
        [section]: entries.map((it) => (it.id === target ? { ...it, bullets: [it.bullets, text].filter((x) => x && x.trim()).join('\n') } : it)),
      };
    }
    onSave(next, cfg.label);
  };

  return (
    <Modal
      open={open}
      title="Add to your resume"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="add-to-resume" className="btn btn-primary">
            Add {bullets.length} bullet{bullets.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <form id="add-to-resume" className="form-stack" onSubmit={save} noValidate>
        <Field label="Resume section" id="atr-section">
          <select id="atr-section" className="select" value={section} onChange={(e) => changeSection(e.target.value)}>
            {Object.entries(TARGETS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Add to" id="atr-target">
          <select id="atr-target" className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
            {entries.map((it) => (
              <option key={it.id} value={it.id}>
                {it[cfg.titleKey] || 'Untitled entry'}
                {it[cfg.orgKey] ? ` — ${it[cfg.orgKey]}` : ''}
              </option>
            ))}
            <option value="new">+ New {cfg.label.toLowerCase()} entry</option>
          </select>
        </Field>
        {target === 'new' && (
          <div className="form-grid">
            <Field label={cfg.titleLabel} id="atr-title" required error={error}>
              <input
                id="atr-title"
                className="input"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setError('');
                }}
              />
            </Field>
            <Field label={cfg.orgLabel} id="atr-org">
              <input id="atr-org" className="input" value={org} onChange={(e) => setOrg(e.target.value)} />
            </Field>
          </div>
        )}
        <div className="panel-flat">
          <p className="small">
            <strong>Bullets to add</strong>
          </p>
          <ul className="small-list">
            {bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      </form>
    </Modal>
  );
}
