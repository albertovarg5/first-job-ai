import { useAppData } from '../../context/AppDataContext.jsx';
import { Field } from '../ui.jsx';

// Jobs the user already has details for: saved search results and tracker
// entries with a pasted description.
export function useKnownJobs() {
  const { data } = useAppData();
  const fromSaved = data.savedJobs.map((s) => ({
    key: `saved:${s.id}`,
    group: 'Saved jobs',
    title: s.job.title,
    company: s.job.employer,
    description: s.job.description || '',
    sourceJobId: s.id,
  }));
  const savedIds = new Set(data.savedJobs.map((s) => s.id));
  const fromTracker = data.applications
    .filter((a) => (a.description || '').trim().length > 40 && !(a.sourceJobId && savedIds.has(a.sourceJobId)))
    .map((a) => ({ key: `app:${a.id}`, group: 'Job tracker', title: a.title, company: a.company, description: a.description, applicationId: a.id }));
  return [...fromSaved, ...fromTracker];
}

export default function JobPicker({ id, onPick, label = 'Use a saved or tracked job' }) {
  const jobs = useKnownJobs();
  if (!jobs.length) return null;
  const groups = [...new Set(jobs.map((j) => j.group))];
  return (
    <Field label={label} id={id}>
      <select
        id={id}
        className="select"
        defaultValue=""
        onChange={(e) => {
          const job = jobs.find((j) => j.key === e.target.value);
          if (job) onPick(job);
        }}
      >
        <option value="" disabled>
          Choose a job…
        </option>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {jobs
              .filter((j) => j.group === g)
              .map((j) => (
                <option key={j.key} value={j.key}>
                  {j.title} — {j.company}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </Field>
  );
}
