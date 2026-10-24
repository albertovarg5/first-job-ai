import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { EmptyState, ProgressBar, ProgressRing } from '../components/ui.jsx';
import MissionItem from '../components/MissionItem.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { resumeChecklist, resumeCompleteness } from '../lib/resume.js';
import { isSubmitted, upcomingInterviews } from '../lib/applications.js';
import { dailyMissions } from '../lib/missions.js';
import { focusMessage } from '../lib/profileOptions.js';
import { firstName, formatDateTime, greetingFor, timeAgo, toDateKey } from '../lib/utils.js';

const ACTIVITY_ICONS = {
  resume: 'resume',
  application: 'tracker',
  interview: 'interview',
  translation: 'translator',
  mission: 'missions',
  profile: 'user',
  settings: 'settings',
};

export default function Dashboard() {
  const { data, actions } = useAppData();
  const toast = useToast();
  const { profile, resume, applications, interviewSessions, translations, missions, activity } = data;

  const completeness = resumeCompleteness(resume);
  const nextResumeStep = resumeChecklist(resume).find((i) => !i.done);
  const submitted = applications.filter(isSubmitted).length;
  const active = applications.filter((a) => !['rejected', 'offer'].includes(a.status)).length;
  const interviews = upcomingInterviews(applications);
  const completedSessions = interviewSessions.filter((s) => s.completedAt).length;
  const answered = interviewSessions.reduce((n, s) => n + s.items.filter((i) => i.answer?.trim()).length, 0);

  const todayKey = toDateKey();
  const todays = dailyMissions(todayKey, {
    resumeCompleteness: completeness,
    applicationCount: applications.length,
    practiceCount: answered,
  });
  const doneToday = missions.completed[todayKey] || [];

  const milestones = [
    { label: 'Set up your profile', done: Boolean(profile), to: '/settings' },
    { label: 'Get your resume to 70% complete', done: completeness >= 70, to: '/resume' },
    { label: 'Translate an experience into resume language', done: translations.length > 0, to: '/translator' },
    { label: 'Track your first application', done: applications.length > 0, to: '/tracker' },
    { label: 'Answer an interview practice question', done: answered > 0, to: '/interview' },
    { label: 'Submit an application', done: submitted > 0, to: '/tracker' },
  ];
  const progress = Math.round((milestones.filter((m) => m.done).length / milestones.length) * 100);

  const setMission = (mission, done) => {
    actions.setMissionDone(mission.id, done, todayKey);
    if (done) {
      actions.logActivity('mission', `Completed mission: ${mission.title}`);
      toast.success('Mission complete.');
    }
  };

  return (
    <div className="dashboard">
      <header className="dash-hello">
        <div>
          <h1>
            {greetingFor()}, {firstName(profile.name)}
          </h1>
          <p className="page-description">{focusMessage(profile)}</p>
        </div>
        <div className="page-actions">
          <Link to="/tracker?new=1" className="btn btn-secondary">
            <Icon name="plus" size={16} /> Add application
          </Link>
          <Link to="/resume" className="btn btn-primary">
            <Icon name="resume" size={16} /> Open resume
          </Link>
        </div>
      </header>

      <section className="stat-strip panel" aria-label="Your numbers">
        <Link to="/tracker" className="stat">
          <span className="stat-value">{submitted}</span>
          <span className="stat-label">Applications submitted</span>
        </Link>
        <Link to="/tracker" className="stat">
          <span className="stat-value">{active}</span>
          <span className="stat-label">Active in your tracker</span>
        </Link>
        <Link to="/tracker" className="stat">
          <span className="stat-value">{interviews.length}</span>
          <span className="stat-label">Upcoming interviews</span>
        </Link>
        <Link to="/interview" className="stat">
          <span className="stat-value">{answered}</span>
          <span className="stat-label">Practice answers written</span>
        </Link>
      </section>

      <div className="dash-grid">
        <div className="dash-col">
          <section className="panel">
            <div className="panel-header">
              <h2>Career progress</h2>
              <span className="subtle">{milestones.filter((m) => m.done).length} of {milestones.length} milestones</span>
            </div>
            <div className="panel-body progress-block">
              <ProgressRing value={progress} size={104}>
                <strong className="ring-number">{progress}%</strong>
              </ProgressRing>
              <ul className="milestones">
                {milestones.map((m) => (
                  <li key={m.label} className={m.done ? 'done' : ''}>
                    <span className="milestone-check">{m.done && <Icon name="check" size={12} strokeWidth={2.6} />}</span>
                    {m.done ? <span>{m.label}</span> : <Link to={m.to}>{m.label}</Link>}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Resume</h2>
              <Link to="/resume" className="btn btn-ghost btn-sm">
                Edit resume
              </Link>
            </div>
            <div className="panel-body">
              <div className="resume-meter">
                <div className="resume-meter-top">
                  <strong>{completeness}% complete</strong>
                  <span className="subtle">{resume.updatedAt ? `Updated ${timeAgo(resume.updatedAt)}` : 'Not started'}</span>
                </div>
                <ProgressBar value={completeness} label="Resume completeness" tone={completeness < 40 ? 'warn' : 'accent'} />
              </div>
              {nextResumeStep ? (
                <p className="next-step">
                  <Icon name="flag" size={15} />
                  <span>
                    Next: <Link to={`/resume?section=${nextResumeStep.section}`}>{nextResumeStep.label}</Link>
                  </span>
                </p>
              ) : (
                <p className="next-step">
                  <Icon name="check" size={15} />
                  <span>
                    Your resume has all the basics. <Link to="/resume?tab=tailor">Tailor it to a job post</Link>.
                  </span>
                </p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Upcoming interviews</h2>
              <Link to="/interview" className="btn btn-ghost btn-sm">
                Practice
              </Link>
            </div>
            {interviews.length ? (
              <ul className="row-list">
                {interviews.slice(0, 4).map((a) => (
                  <li key={a.id}>
                    <span className="date-chip">
                      <Icon name="calendar" size={15} />
                    </span>
                    <div className="row-main">
                      <strong>{a.title}</strong>
                      <span className="subtle">{a.company}</span>
                    </div>
                    <div className="row-side">
                      <span className={`badge ${a.inDays <= 2 ? 'badge-warn' : ''}`}>
                        {a.inDays === 0 ? 'Today' : a.inDays === 1 ? 'Tomorrow' : `In ${a.inDays} days`}
                      </span>
                      <span className="subtle">{formatDateTime(a.interviewDate)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="calendar" title="No interviews scheduled">
                When you get an interview, set its date in the Job Tracker and it will show up here.
              </EmptyState>
            )}
          </section>
        </div>

        <div className="dash-col">
          <section className="panel">
            <div className="panel-header">
              <h2>Today’s missions</h2>
              <span className="subtle">
                {todays.filter((m) => doneToday.includes(m.id)).length} of {todays.length} done
              </span>
            </div>
            <ul className="mission-list compact">
              {todays.map((m) => (
                <MissionItem key={m.id} mission={m} done={doneToday.includes(m.id)} onToggle={setMission} compact />
              ))}
            </ul>
            <div className="panel-foot">
              <Link to="/missions">See your mission history</Link>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Quick actions</h2>
            </div>
            <div className="quick-actions">
              <Link to="/translator" className="quick">
                <Icon name="translator" />
                <span>Translate an experience</span>
              </Link>
              <Link to="/interview" className="quick">
                <Icon name="interview" />
                <span>Practice interview questions</span>
              </Link>
              <Link to="/resume?tab=tailor" className="quick">
                <Icon name="search" />
                <span>Compare resume to a job</span>
              </Link>
              <Link to="/resume?tab=preview" className="quick">
                <Icon name="download" />
                <span>Preview & download PDF</span>
              </Link>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Recent activity</h2>
            </div>
            {activity.length ? (
              <ul className="activity">
                {activity.slice(0, 7).map((a) => (
                  <li key={a.id}>
                    <span className="activity-icon">
                      <Icon name={ACTIVITY_ICONS[a.type] || 'info'} size={14} />
                    </span>
                    <span className="activity-text">{a.text}</span>
                    <span className="subtle nowrap">{timeAgo(a.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="history" title="Nothing yet">
                Your saves, applications and practice sessions will appear here.
              </EmptyState>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
