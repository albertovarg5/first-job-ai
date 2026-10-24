import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Icon from '../components/Icon.jsx';
import JobCard from '../components/jobs/JobCard.jsx';
import { ConfirmDialog } from '../components/Modal.jsx';
import { EmptyState, Field, PageHeader, Segmented, Spinner } from '../components/ui.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  COUNTRY_OPTIONS,
  DATE_POSTED_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  EXPERIENCE_OPTIONS,
  emptySearch,
  fetchJobsStatus,
  searchJobs,
  validateSearch,
} from '../lib/jobs.js';
import { timeAgo } from '../lib/utils.js';

// The last search is kept for this browser tab so coming back to the page
// doesn't spend another API request.
const SESSION_KEY = 'first-job-ai:last-job-search';

function loadLastSearch() {
  try {
    return JSON.parse(window.sessionStorage.getItem(SESSION_KEY)) || null;
  } catch {
    return null;
  }
}

function saveLastSearch(value) {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
  } catch {
    /* optional */
  }
}

export function SetupNotice({ status }) {
  if (status?.unreachable) {
    return (
      <div className="alert alert-warn">
        <Icon name="alert" size={16} /> The app server could not be reached, so job search is unavailable. Make sure the app is running with{' '}
        <code>npm run dev</code> (or <code>npm start</code> in production).
      </div>
    );
  }
  return (
    <section className="panel panel-pad setup-steps">
      <h2>Connect real job listings</h2>
      <p className="muted small">
        Job search uses the <strong>JSearch API by OpenWeb Ninja</strong>, which collects public postings from job boards and company sites. It isn’t set up
        on this server yet, so no listings are shown — the app never shows made-up jobs.
      </p>
      <ol>
        <li>
          Create a free account at <code>app.openwebninja.com</code> and subscribe to the <strong>JSearch</strong> API (the free plan works).
        </li>
        <li>
          Copy your <strong>API key</strong> from the OpenWeb Ninja dashboard. (A key from the JSearch API on <code>rapidapi.com</code> works too.)
        </li>
        <li>
          In the project folder, open <code>.env</code> (copy <code>.env.example</code> if you don’t have one) and set <code>JSEARCH_API_KEY=</code> to your key.
          Optional: set <code>JSEARCH_MONTHLY_LIMIT</code> to your plan’s monthly request allowance.
        </li>
        <li>
          Restart the app (<kbd>Ctrl</kbd> + <kbd>C</kbd>, then <code>npm run dev</code>).
        </li>
      </ol>
    </section>
  );
}

function SearchForm({ initial, onSearch, busy, defaultCountry }) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [showFilters, setShowFilters] = useState(false);

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const toggleType = (value) =>
    set('employmentTypes', form.employmentTypes.includes(value) ? form.employmentTypes.filter((t) => t !== value) : [...form.employmentTypes, value]);

  const submit = (e) => {
    e.preventDefault();
    const errs = validateSearch(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    onSearch({ ...form, query: form.query.trim(), location: form.location.trim() });
  };

  const activeFilters = [form.remote, form.employmentTypes.length, form.datePosted !== 'all', form.experience, form.country].filter(Boolean).length;

  return (
    <form className="panel panel-pad job-search-form" onSubmit={submit} noValidate role="search">
      <div className="job-search-row">
        <Field label="Job title or keywords" id="js-query" required error={errors.query}>
          <input
            id="js-query"
            className="input"
            value={form.query}
            maxLength={200}
            onChange={(e) => set('query', e.target.value)}
            placeholder="e.g. marketing intern, junior data analyst"
          />
        </Field>
        <Field label="Location" id="js-location" error={errors.location} hint="City, state or region. Leave blank for anywhere.">
          <input id="js-location" className="input" value={form.location} maxLength={100} onChange={(e) => set('location', e.target.value)} placeholder="e.g. Austin, TX" />
        </Field>
        <div className="job-search-submit">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <Spinner label="Searching" /> : <Icon name="search" size={16} />} Search jobs
          </button>
        </div>
      </div>

      <button type="button" className="btn btn-ghost btn-sm filters-toggle" onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}>
        <Icon name={showFilters ? 'chevronDown' : 'chevronRight'} size={14} /> Filters{activeFilters ? ` (${activeFilters})` : ''}
      </button>

      {showFilters && (
        <div className="job-filters">
          <fieldset className="field">
            <legend>Job type</legend>
            <div className="chip-row">
              {EMPLOYMENT_TYPE_OPTIONS.map((o) => (
                <label key={o.value} className={`chip ${form.employmentTypes.includes(o.value) ? 'selected' : ''}`}>
                  <input type="checkbox" checked={form.employmentTypes.includes(o.value)} onChange={() => toggleType(o.value)} />
                  {o.label}
                </label>
              ))}
              <label className={`chip ${form.remote ? 'selected' : ''}`}>
                <input type="checkbox" checked={form.remote} onChange={(e) => set('remote', e.target.checked)} />
                Remote only
              </label>
            </div>
          </fieldset>
          <Field label="Date posted" id="js-date">
            <select id="js-date" className="select" value={form.datePosted} onChange={(e) => set('datePosted', e.target.value)}>
              {DATE_POSTED_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Experience" id="js-exp">
            <select id="js-exp" className="select" value={form.experience} onChange={(e) => set('experience', e.target.value)}>
              {EXPERIENCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Country" id="js-country">
            <select id="js-country" className="select" value={form.country} onChange={(e) => set('country', e.target.value)}>
              <option value="">Default ({COUNTRY_OPTIONS.find((c) => c.value === defaultCountry)?.label || 'United States'})</option>
              {COUNTRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
    </form>
  );
}

function ResultsError({ error, onRetry }) {
  const canRetry = !['invalid_key', 'not_configured', 'local_limit', 'invalid_input', 'auth_required'].includes(error.code);
  return (
    <div className="panel">
      <EmptyState
        icon="alert"
        title={error.code === 'rate_limited' || error.code === 'local_limit' ? 'Search limit reached' : 'The search didn’t work'}
        action={
          canRetry && (
            <button className="btn btn-secondary" onClick={onRetry}>
              <Icon name="refresh" size={15} /> Try again
            </button>
          )
        }
      >
        {error.message}
        {error.code === 'auth_required' && (
          <>
            {' '}
            <Link to="/signin">Sign in</Link>
          </>
        )}
      </EmptyState>
    </div>
  );
}

function SavedJobs() {
  const { data, actions } = useAppData();
  const toast = useToast();
  const [removing, setRemoving] = useState(null);
  if (!data.savedJobs.length) {
    return (
      <div className="panel">
        <EmptyState icon="bookmark" title="No saved jobs yet">
          Save listings from your search results to compare them later, write cover letters, or add them to your tracker.
        </EmptyState>
      </div>
    );
  }
  return (
    <>
      <div className="job-list">
        {data.savedJobs.map((s) => (
          <div key={s.id} className="saved-job">
            <JobCard job={s.job} />
            <div className="saved-job-foot">
              <span className="subtle">Saved {timeAgo(s.savedAt)} · details are a snapshot from when you saved it</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setRemoving(s)}>
                <Icon name="trash" size={14} /> Remove
              </button>
            </div>
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove this saved job?"
        message={removing ? `${removing.job.title} at ${removing.job.employer} will be removed from your saved jobs. Your tracker is not affected.` : ''}
        confirmLabel="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          actions.unsaveJob(removing.id);
          toast.success('Saved job removed.');
          setRemoving(null);
        }}
      />
    </>
  );
}

export default function JobSearch() {
  const { data } = useAppData();
  const auth = useAuth();
  const locked = auth.requireAuthForApis && !auth.user;
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'saved' ? 'saved' : 'search';
  const [status, setStatus] = useState(null);
  const [last] = useState(loadLastSearch);
  const [search, setSearch] = useState(last?.search || null);
  const [results, setResults] = useState(last?.results || null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [moreError, setMoreError] = useState('');

  useEffect(() => {
    fetchJobsStatus().then(setStatus);
  }, []);

  const run = async (s) => {
    setSearch(s);
    setLoading(true);
    setError(null);
    setMoreError('');
    try {
      const res = await searchJobs(s, 1);
      const next = { jobs: res.jobs, page: res.page, hasMore: res.hasMore, cursor: res.cursor || '', at: new Date().toISOString() };
      setResults(next);
      saveLastSearch({ search: s, results: next });
    } catch (err) {
      setResults(null);
      setError({ message: err.message, code: err.code });
      if (err.code === 'not_configured') setStatus((st) => ({ ...st, configured: false }));
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    setLoadingMore(true);
    setMoreError('');
    try {
      const res = await searchJobs(search, results.page + 1, results.cursor);
      const ids = new Set(results.jobs.map((j) => j.id));
      const next = {
        ...results,
        jobs: [...results.jobs, ...res.jobs.filter((j) => !ids.has(j.id))],
        page: res.page,
        hasMore: res.hasMore,
        cursor: res.cursor || '',
      };
      setResults(next);
      saveLastSearch({ search, results: next });
    } catch (err) {
      setMoreError(err.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const configured = status?.configured;

  return (
    <div className="job-search-page">
      <PageHeader
        title="Job Search"
        description="Search real, current job listings. Save the ones you like and add them to your tracker."
        actions={
          <Segmented
            label="Job search views"
            value={tab}
            onChange={(v) => setParams(v === 'saved' ? { tab: 'saved' } : {}, { replace: true })}
            options={[
              { value: 'search', label: 'Search', icon: 'search' },
              { value: 'saved', label: `Saved (${data.savedJobs.length})`, icon: 'bookmark' },
            ]}
          />
        }
      />

      {tab === 'saved' ? (
        <SavedJobs />
      ) : status === null ? (
        <div className="panel panel-pad center-row">
          <Spinner /> <span className="muted">Checking job search…</span>
        </div>
      ) : !configured ? (
        <SetupNotice status={status} />
      ) : locked ? (
        <div className="panel">
          <EmptyState
            icon="lock"
            title="Sign in to search jobs"
            action={
              <Link to="/signin" className="btn btn-primary" state={{ from: '/jobs' }}>
                Sign in
              </Link>
            }
          >
            Job search uses a paid API, so on this site it’s available to signed-in users. Accounts are free.
          </EmptyState>
        </div>
      ) : (
        <>
          <SearchForm initial={search || emptySearch(data.profile)} onSearch={run} busy={loading} defaultCountry={status.country} />
          {status.monthlyLimit && (
            <p className="subtle usage-note">
              {status.usedThisMonth} of {status.monthlyLimit} searches used this month. Repeating a recent search doesn’t use another request.
            </p>
          )}
          <div aria-live="polite" aria-busy={loading}>
            {loading ? (
              <div className="panel panel-pad center-row">
                <Spinner label="Searching" /> <span className="muted">Searching job listings…</span>
              </div>
            ) : error ? (
              <ResultsError error={error} onRetry={() => run(search)} />
            ) : results ? (
              results.jobs.length === 0 ? (
                <div className="panel">
                  <EmptyState icon="search" title="No jobs found">
                    Try broader keywords (for example “marketing” instead of “junior social media marketing intern”), remove some filters, or search a nearby
                    city.
                  </EmptyState>
                </div>
              ) : (
                <>
                  <p className="subtle results-count">
                    Showing {results.jobs.length} listing{results.jobs.length === 1 ? '' : 's'} for “{search.query}”
                    {search.location ? ` in ${search.location}` : ''}. Listings come from JSearch and may have closed — always check the original posting.
                  </p>
                  <div className="job-list">
                    {results.jobs.map((job) => (
                      <JobCard key={job.id} job={job} />
                    ))}
                  </div>
                  <div className="load-more">
                    {moreError && (
                      <p className="field-error" role="alert">
                        {moreError}
                      </p>
                    )}
                    {results.hasMore ? (
                      <button className="btn btn-secondary" onClick={loadMore} disabled={loadingMore}>
                        {loadingMore ? <Spinner /> : null} {loadingMore ? 'Loading…' : moreError ? 'Try again' : 'Load more jobs'}
                      </button>
                    ) : (
                      <p className="subtle">That’s all the results for this search.</p>
                    )}
                  </div>
                </>
              )
            ) : (
              <div className="panel">
                <EmptyState icon="briefcase" title="Search for your first job">
                  Start with your target role{data.profile?.targetRole ? ` (${data.profile.targetRole})` : ''} and a city, or turn on “Remote only” in Filters.
                </EmptyState>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
