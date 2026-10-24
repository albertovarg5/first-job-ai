import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import ApplicationForm from '../components/ApplicationForm.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { EmptyState, PageHeader, Segmented } from '../components/ui.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { STATUSES, countByStatus, filterApplications, statusLabel } from '../lib/applications.js';
import { formatDate, formatDateTime, toDateKey } from '../lib/utils.js';

function StatusSelect({ app, onChange }) {
  return (
    <select
      className={`select select-sm status-select status-${app.status}`}
      value={app.status}
      onChange={(e) => onChange(app, e.target.value)}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Status for ${app.title} at ${app.company}`}
    >
      {STATUSES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );
}

export default function JobTracker() {
  const { data, actions } = useAppData();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('updated');
  const [view, setView] = useState(() => {
    try {
      return window.localStorage.getItem('first-job-ai:tracker-view') || 'list';
    } catch {
      return 'list';
    }
  });
  const [editing, setEditing] = useState(null); // null | {} (new) | app
  const [deleting, setDeleting] = useState(null);

  const apps = data.applications;
  const counts = countByStatus(apps);
  const visible = filterApplications(apps, { query, status, sort });

  // Open the "Add application" dialog when arriving from ?new=1.
  useEffect(() => {
    if (params.get('new') === '1') {
      setEditing({});
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const changeView = (v) => {
    setView(v);
    try {
      window.localStorage.setItem('first-job-ai:tracker-view', v);
    } catch {
      /* view preference is optional */
    }
  };

  const save = (record) => {
    if (record.id) {
      const before = apps.find((a) => a.id === record.id);
      actions.updateApplication(record.id, record);
      if (before && before.status !== record.status) {
        actions.logActivity('application', `Moved ${record.title} at ${record.company} to ${statusLabel(record.status)}`);
      }
      toast.success('Application updated.');
    } else {
      actions.addApplication(record);
      actions.logActivity('application', `Added ${record.title} at ${record.company} to your tracker`);
      toast.success(`${record.company} added to your tracker.`);
    }
    setEditing(null);
  };

  const changeStatus = (app, next) => {
    const patch = { status: next };
    if (next === 'applied' && !app.dateApplied) patch.dateApplied = toDateKey();
    actions.updateApplication(app.id, patch);
    actions.logActivity('application', `Moved ${app.title} at ${app.company} to ${statusLabel(next)}`);
    toast.success(`Status changed to ${statusLabel(next)}.`);
  };

  const confirmDelete = () => {
    actions.deleteApplication(deleting.id);
    actions.logActivity('application', `Deleted ${deleting.title} at ${deleting.company}`);
    toast.success('Application deleted.');
    setDeleting(null);
  };

  const filtersActive = query.trim() || status !== 'all';

  return (
    <div className="tracker-page">
      <PageHeader
        title="Job Tracker"
        description="Every job you’re considering, in one place. Update statuses as you hear back."
        actions={
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            <Icon name="plus" size={16} /> Add application
          </button>
        }
      />

      {apps.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon="tracker"
            title="Track your first application"
            action={
              <button className="btn btn-primary" onClick={() => setEditing({})}>
                <Icon name="plus" size={16} /> Add application
              </button>
            }
          >
            Add jobs you’re interested in — even before you apply. Save the link and description so you can tailor your resume to each one.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="status-filter" role="tablist" aria-label="Filter by status">
            <button role="tab" aria-selected={status === 'all'} className={`status-tab ${status === 'all' ? 'active' : ''}`} onClick={() => setStatus('all')}>
              All <span>{apps.length}</span>
            </button>
            {STATUSES.map((s) => (
              <button
                key={s.value}
                role="tab"
                aria-selected={status === s.value}
                className={`status-tab status-${s.value} ${status === s.value ? 'active' : ''}`}
                onClick={() => setStatus(status === s.value ? 'all' : s.value)}
              >
                <i className="dot" />
                {s.label} <span>{counts[s.value]}</span>
              </button>
            ))}
          </div>

          <div className="tracker-toolbar">
            <div className="search-box">
              <Icon name="search" size={16} />
              <input
                className="input"
                type="search"
                placeholder="Search company, title, notes…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search applications"
              />
            </div>
            <select className="select sort-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort applications">
              <option value="updated">Recently updated</option>
              <option value="applied">Date applied</option>
              <option value="interview">Interview date</option>
              <option value="company">Company A–Z</option>
            </select>
            <Segmented
              label="Layout"
              value={view}
              onChange={changeView}
              options={[
                { value: 'list', label: 'List', icon: 'list' },
                { value: 'board', label: 'Board', icon: 'board' },
              ]}
            />
          </div>

          {visible.length === 0 ? (
            <div className="panel">
              <EmptyState
                icon="search"
                title="No applications match"
                action={
                  filtersActive && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        setQuery('');
                        setStatus('all');
                      }}
                    >
                      Clear filters
                    </button>
                  )
                }
              >
                Try a different search or status filter.
              </EmptyState>
            </div>
          ) : view === 'list' ? (
            <div className="panel app-table" role="table" aria-label="Applications">
              <div className="app-row app-row-head" role="row">
                <span role="columnheader">Role</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Applied</span>
                <span role="columnheader">Interview</span>
                <span role="columnheader" className="sr-only">
                  Actions
                </span>
              </div>
              {visible.map((a) => (
                <div className="app-row" role="row" key={a.id}>
                  <button className="app-main" role="cell" onClick={() => setEditing(a)}>
                    <span className="company-mark" aria-hidden="true">
                      {(a.company || '?').charAt(0).toUpperCase()}
                    </span>
                    <span className="app-text">
                      <strong>{a.title}</strong>
                      <span className="subtle">
                        {a.company}
                        {a.location ? `, ${a.location}` : ''}
                      </span>
                    </span>
                  </button>
                  <span role="cell" className="app-status">
                    <StatusSelect app={a} onChange={changeStatus} />
                  </span>
                  <span role="cell" className="app-date">
                    <small className="cell-label">Applied</small>
                    {a.dateApplied ? formatDate(a.dateApplied) : <span className="subtle">—</span>}
                  </span>
                  <span role="cell" className="app-date">
                    <small className="cell-label">Interview</small>
                    {a.interviewDate ? formatDateTime(a.interviewDate) : <span className="subtle">—</span>}
                  </span>
                  <span role="cell" className="app-actions">
                    {a.link && (
                      <a className="icon-btn" href={a.link} target="_blank" rel="noreferrer" aria-label={`Open job posting for ${a.title}`}>
                        <Icon name="external" size={16} />
                      </a>
                    )}
                    <button className="icon-btn" onClick={() => setEditing(a)} aria-label={`Edit ${a.title} at ${a.company}`}>
                      <Icon name="edit" size={16} />
                    </button>
                    <button className="icon-btn danger" onClick={() => setDeleting(a)} aria-label={`Delete ${a.title} at ${a.company}`}>
                      <Icon name="trash" size={16} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="board">
              {STATUSES.filter((s) => status === 'all' || s.value === status).map((s) => {
                const col = visible.filter((a) => a.status === s.value);
                return (
                  <section className="board-col" key={s.value} aria-label={s.label}>
                    <header className={`board-col-head status-${s.value}`}>
                      <i className="dot" />
                      <span>{s.label}</span>
                      <small>{col.length}</small>
                    </header>
                    <div className="board-cards">
                      {col.map((a) => (
                        <article className="board-card" key={a.id}>
                          <button className="board-card-main" onClick={() => setEditing(a)}>
                            <strong>{a.title}</strong>
                            <span className="subtle">{a.company}</span>
                            {a.interviewDate && (
                              <span className="board-meta">
                                <Icon name="calendar" size={13} /> {formatDateTime(a.interviewDate)}
                              </span>
                            )}
                          </button>
                          <div className="board-card-foot">
                            <StatusSelect app={a} onChange={changeStatus} />
                            <button className="icon-btn danger" onClick={() => setDeleting(a)} aria-label={`Delete ${a.title} at ${a.company}`}>
                              <Icon name="trash" size={15} />
                            </button>
                          </div>
                        </article>
                      ))}
                      {col.length === 0 && <p className="board-empty">None</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
          <p className="subtle tracker-foot">
            Tip: open an application and paste its description, then use <Link to="/resume?tab=tailor">Tailor to a job</Link> to compare it with your resume.
          </p>
        </>
      )}

      {editing && (
        <ApplicationForm key={editing.id || 'new'} open initial={editing.id ? editing : null} onSave={save} onClose={() => setEditing(null)} />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this application?"
        message={deleting ? `${deleting.title} at ${deleting.company} will be removed from your tracker. You can’t undo this.` : ''}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
