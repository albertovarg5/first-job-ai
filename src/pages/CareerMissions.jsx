import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import MissionItem from '../components/MissionItem.jsx';
import { PageHeader, ProgressBar, Segmented } from '../components/ui.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { AREA_LABELS, MISSIONS, dailyMissions, missionStats } from '../lib/missions.js';
import { resumeCompleteness } from '../lib/resume.js';
import { formatDate, parseDateKey, toDateKey } from '../lib/utils.js';

export default function CareerMissions() {
  const { data, actions } = useAppData();
  const toast = useToast();
  const [area, setArea] = useState('all');
  const todayKey = toDateKey();
  const completed = data.missions.completed;
  const doneToday = completed[todayKey] || [];

  const answered = data.interviewSessions.reduce((n, s) => n + s.items.filter((i) => i.answer?.trim()).length, 0);
  const todays = dailyMissions(todayKey, {
    resumeCompleteness: resumeCompleteness(data.resume),
    applicationCount: data.applications.length,
    practiceCount: answered,
  });
  const todayIds = new Set(todays.map((m) => m.id));
  const extras = MISSIONS.filter((m) => !todayIds.has(m.id) && (area === 'all' || m.area === area));
  const stats = missionStats(completed);
  const todayDoneCount = todays.filter((m) => doneToday.includes(m.id)).length;

  const toggle = (mission, done) => {
    actions.setMissionDone(mission.id, done, todayKey);
    if (done) {
      actions.logActivity('mission', `Completed mission: ${mission.title}`);
      const allDone = todays.every((m) => m.id === mission.id || doneToday.includes(m.id));
      toast.success(todayIds.has(mission.id) && allDone ? 'All of today’s missions are done. Nice work.' : 'Mission complete.');
    }
  };

  const history = Object.entries(completed)
    .filter(([, ids]) => ids.length)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 10);

  const maxDay = Math.max(1, ...stats.last14.map((d) => d.count));
  const stageProgress = stats.nextStageAt ? (stats.total / stats.nextStageAt) * 100 : 100;

  return (
    <div className="missions-page">
      <PageHeader
        title="Career Missions"
        description="Three small, practical tasks each day. A little progress every day adds up faster than one big push."
      />

      <section className="stat-strip panel" aria-label="Mission progress">
        <div className="stat">
          <span className="stat-value">
            {todayDoneCount}/{todays.length}
          </span>
          <span className="stat-label">Done today</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.streak}</span>
          <span className="stat-label">Day streak</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.total}</span>
          <span className="stat-label">Missions completed</span>
        </div>
        <div className="stat stat-wide">
          <span className="stat-stage">{stats.stage}</span>
          <ProgressBar value={stageProgress} label="Progress to next stage" />
          <span className="stat-label">{stats.nextStageAt ? `${stats.nextStageAt - stats.total} more to the next stage` : 'You’ve built a steady routine'}</span>
        </div>
      </section>

      <div className="missions-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Today</h2>
              <p className="subtle">{formatDate(todayKey, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
            </div>
            <span className={`badge ${todayDoneCount === todays.length ? 'badge-accent' : ''}`}>
              {todayDoneCount === todays.length ? 'All done' : `${todays.length - todayDoneCount} left`}
            </span>
          </div>
          <ul className="mission-list">
            {todays.map((m) => (
              <MissionItem key={m.id} mission={m} done={doneToday.includes(m.id)} onToggle={toggle} />
            ))}
          </ul>
          <p className="panel-foot subtle">New missions arrive each day, picked around what you still need to do.</p>
        </section>

        <aside className="panel panel-pad">
          <h2 className="mb-12">Last 14 days</h2>
          <div className="day-bars" role="img" aria-label={`Missions completed per day over the last 14 days, ${stats.activeDays} active days in total`}>
            {stats.last14.map((d) => (
              <div className="day-bar" key={d.key} title={`${formatDate(d.key, { month: 'short', day: 'numeric' })}: ${d.count}`}>
                <span className={`day-fill ${d.count ? 'on' : ''}`} style={{ height: `${Math.max(8, (d.count / maxDay) * 100)}%` }} />
                <small>{parseDateKey(d.key).toLocaleDateString(undefined, { weekday: 'narrow' })}</small>
              </div>
            ))}
          </div>
          <h3 className="mt-20 mb-8">Recent</h3>
          {history.length ? (
            <ul className="history-days">
              {history.map(([day, ids]) => (
                <li key={day}>
                  <span className="subtle">{day === todayKey ? 'Today' : formatDate(day, { month: 'short', day: 'numeric' })}</span>
                  <span>{ids.map((id) => MISSIONS.find((m) => m.id === id)?.title || id).join(', ')}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Complete a mission and it will show up here.</p>
          )}
        </aside>
      </div>

      <section className="panel extra-missions">
        <div className="panel-header wrap">
          <div>
            <h2>More missions</h2>
            <p className="subtle">Have extra time? Pick anything here — it counts toward today.</p>
          </div>
          <Segmented
            label="Filter missions by area"
            value={area}
            onChange={setArea}
            options={[{ value: 'all', label: 'All' }, ...Object.entries(AREA_LABELS).map(([value, label]) => ({ value, label }))]}
          />
        </div>
        <ul className="mission-list">
          {extras.map((m) => (
            <MissionItem key={m.id} mission={m} done={doneToday.includes(m.id)} onToggle={toggle} />
          ))}
        </ul>
      </section>
      <p className="subtle page-foot">
        <Icon name="info" size={13} /> Missions are self-reported: check one off when you’ve done it.
      </p>
    </div>
  );
}
