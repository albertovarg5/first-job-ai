import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../Icon.jsx';
import { Modal } from '../Modal.jsx';
import { useAppData } from '../../context/AppDataContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { employmentTypeLabel, experienceNote, findApplicationForJob, formatSalary, jobLocation } from '../../lib/jobs.js';
import { formatDate, timeAgo } from '../../lib/utils.js';

export function postedText(job) {
  if (job.postedAt) return `Posted ${timeAgo(job.postedAt)}`;
  if (job.postedLabel) return `Posted ${job.postedLabel}`;
  return 'Posting date not listed';
}

// Save / track buttons shared by the card and the detail dialog.
function useJobActions(job) {
  const { data, actions } = useAppData();
  const toast = useToast();
  const saved = data.savedJobs.some((s) => s.id === job.id);
  const tracked = findApplicationForJob(data.applications, job);

  const toggleSave = () => {
    if (saved) {
      actions.unsaveJob(job.id);
      toast.info('Removed from saved jobs.');
    } else {
      actions.saveJob(job);
      actions.logActivity('application', `Saved ${job.title} at ${job.employer}`);
      toast.success('Job saved.');
    }
  };

  const track = () => {
    const { created } = actions.trackJob(job);
    if (created) {
      actions.logActivity('application', `Added ${job.title} at ${job.employer} to your tracker`);
      toast.success(`${job.employer} added to your tracker as Interested.`);
    } else {
      toast.info('This job is already in your tracker.');
    }
  };

  return { saved, tracked, toggleSave, track };
}

function JobActions({ job, onClose }) {
  const { saved, tracked, toggleSave, track } = useJobActions(job);
  return (
    <div className="job-actions">
      <button className={`btn btn-sm ${saved ? 'btn-secondary' : 'btn-ghost'}`} onClick={toggleSave} aria-pressed={saved}>
        <Icon name={saved ? 'bookmarkFilled' : 'bookmark'} size={15} /> {saved ? 'Saved' : 'Save'}
      </button>
      {tracked ? (
        <Link to="/tracker" className="btn btn-sm btn-ghost" onClick={onClose}>
          <Icon name="check" size={15} /> In tracker
        </Link>
      ) : (
        <button className="btn btn-sm btn-ghost" onClick={track}>
          <Icon name="plus" size={15} /> Track
        </button>
      )}
      {job.applyLink ? (
        <a className="btn btn-sm btn-primary" href={job.applyLink} target="_blank" rel="noopener noreferrer">
          View listing <Icon name="external" size={14} />
          <span className="sr-only"> (opens the original posting in a new tab)</span>
        </a>
      ) : (
        <span className="subtle">No link provided</span>
      )}
    </div>
  );
}

export function JobMeta({ job }) {
  const salary = formatSalary(job.salary);
  const exp = experienceNote(job);
  return (
    <ul className="job-meta">
      <li>
        <Icon name="pin" size={14} /> {jobLocation(job)}
      </li>
      {job.employmentTypes.length > 0 && (
        <li>
          <Icon name="briefcase" size={14} /> {job.employmentTypes.map(employmentTypeLabel).join(', ')}
        </li>
      )}
      {salary && (
        <li>
          <Icon name="money" size={14} /> {salary}
        </li>
      )}
      <li>
        <Icon name="clock" size={14} /> {postedText(job)}
      </li>
      {exp && (
        <li>
          <Icon name="info" size={14} /> {exp}
        </li>
      )}
    </ul>
  );
}

export function JobDetail({ job, open, onClose, children }) {
  if (!job) return null;
  const highlights = Object.entries(job.highlights || {}).filter(([, list]) => list.length);
  return (
    <Modal open={open} title={job.title} onClose={onClose} size="lg" footer={<JobActions job={job} onClose={onClose} />}>
      <div className="job-detail">
        <p className="job-employer">
          <strong>{job.employer}</strong>
          {job.publisher && <span className="subtle"> · Listed on {job.publisher}</span>}
        </p>
        <JobMeta job={job} />
        {children}
        <p className="job-source-note">
          <Icon name="info" size={14} /> This listing comes from JSearch, which collects public job postings. It may have been filled or removed since it
          was posted{job.expiresAt ? ` (the listing gives an end date of ${formatDate(job.expiresAt)})` : ''}. Check the original posting before applying.
        </p>
        {highlights.map(([title, list]) => (
          <section key={title} className="job-highlight">
            <h3>{title}</h3>
            <ul>
              {list.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
        <section className="job-highlight">
          <h3>Full description</h3>
          <div className="job-description">{job.description || 'The listing did not include a description.'}</div>
        </section>
      </div>
    </Modal>
  );
}

export default function JobCard({ job, extra }) {
  const [open, setOpen] = useState(false);
  const preview = (job.description || '').replace(/\s+/g, ' ').slice(0, 220);
  return (
    <article className="job-card panel">
      <div className="job-card-top">
        <span className="company-mark" aria-hidden="true">
          {(job.employer || '?').charAt(0).toUpperCase()}
        </span>
        <div className="job-card-head">
          <h3>
            <button className="link-btn" onClick={() => setOpen(true)}>
              {job.title}
            </button>
          </h3>
          <p className="subtle">
            {job.employer}
            {job.publisher ? ` · via ${job.publisher}` : ''}
          </p>
        </div>
      </div>
      <JobMeta job={job} />
      {extra}
      {preview && (
        <p className="job-preview">
          {preview}
          {job.description.length > 220 ? '…' : ''}
        </p>
      )}
      <div className="job-card-foot">
        <button className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
          <Icon name="eye" size={15} /> Details
        </button>
        <JobActions job={job} />
      </div>
      <JobDetail job={job} open={open} onClose={() => setOpen(false)}>
        {extra}
      </JobDetail>
    </article>
  );
}
