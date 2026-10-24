import { useState } from 'react';
import { Modal } from './Modal.jsx';
import { Field } from './ui.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { STATUSES, emptyApplication, statusLabel, validateApplication } from '../lib/applications.js';
import { formatDateTime, toDateKey } from '../lib/utils.js';

const EARLY = new Set(['interested', 'applying', 'applied']);

export default function ApplicationForm({ open, initial, onSave, onClose }) {
  const { data } = useAppData();
  const [form, setForm] = useState(() => ({ ...emptyApplication(), ...(initial || {}) }));
  const [errors, setErrors] = useState({});
  const isEdit = Boolean(initial?.id);

  const set = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const submit = (e) => {
    e.preventDefault();
    const errs = validateApplication(form, data.applications);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const record = { ...form, company: form.company.trim(), title: form.title.trim() };
    // Sensible automatic updates the user would otherwise forget.
    if (record.status === 'applied' && !record.dateApplied) record.dateApplied = toDateKey();
    if (record.interviewDate && EARLY.has(record.status) && record.interviewDate !== initial?.interviewDate) record.status = 'interview';
    onSave(record);
  };

  return (
    <Modal
      open={open}
      title={isEdit ? 'Edit application' : 'Add application'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="application-form" className="btn btn-primary">
            {isEdit ? 'Save changes' : 'Add application'}
          </button>
        </>
      }
    >
      <form id="application-form" className="form-grid" onSubmit={submit} noValidate>
        <Field label="Company" id="app-company" required error={errors.company}>
          <input id="app-company" className="input" value={form.company} onChange={set('company')} />
        </Field>
        <Field label="Job title" id="app-title" required error={errors.title}>
          <input id="app-title" className="input" value={form.title} onChange={set('title')} />
        </Field>
        <Field label="Status" id="app-status">
          <select id="app-status" className="select" value={form.status} onChange={set('status')}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Location" id="app-location" hint="City, hybrid or remote.">
          <input id="app-location" className="input" value={form.location} onChange={set('location')} />
        </Field>
        <Field label="Date applied" id="app-date" error={errors.dateApplied} hint="Filled in automatically when you mark it Applied.">
          <input id="app-date" type="date" className="input" value={form.dateApplied} max={toDateKey()} onChange={set('dateApplied')} />
        </Field>
        <Field label="Interview date and time" id="app-interview" hint="Setting this moves the status to Interview.">
          <input id="app-interview" type="datetime-local" className="input" value={form.interviewDate} onChange={set('interviewDate')} />
        </Field>
        <Field label="Job posting link" id="app-link" error={errors.link} className="span-2">
          <input id="app-link" type="url" className="input" placeholder="https://" value={form.link} onChange={set('link')} />
        </Field>
        <Field label="Job description" id="app-desc" className="span-2" hint="Paste the posting so you can compare it with your resume later.">
          <textarea id="app-desc" className="textarea" rows={5} value={form.description} onChange={set('description')} />
        </Field>
        <Field label="Notes" id="app-notes" className="span-2" hint="Contacts, follow-up dates, what you learned about the company.">
          <textarea id="app-notes" className="textarea" rows={3} maxLength={5000} value={form.notes} onChange={set('notes')} />
        </Field>
        {isEdit && (initial.statusHistory?.length > 0 || initial.source === 'jsearch') && (
          <div className="span-2 status-history">
            <h3>History</h3>
            <ul>
              {initial.source === 'jsearch' && <li>Added from Job Search</li>}
              {(initial.statusHistory || []).map((h) => (
                <li key={`${h.status}-${h.at}`}>
                  <span className={`status status-${h.status}`}>
                    <span>{statusLabel(h.status)}</span>
                  </span>{' '}
                  <span className="subtle">{formatDateTime(h.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </Modal>
  );
}
