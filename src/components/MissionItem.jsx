import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { AREA_LABELS } from '../lib/missions.js';

export default function MissionItem({ mission, done, onToggle, compact = false }) {
  return (
    <li className={`mission ${done ? 'done' : ''}`}>
      <button
        type="button"
        className="mission-check"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark "${mission.title}" as not done` : `Mark "${mission.title}" as done`}
        onClick={() => onToggle(mission, !done)}
      >
        {done && <Icon name="check" size={13} strokeWidth={2.6} />}
      </button>
      <div className="mission-body">
        <strong>{mission.title}</strong>
        {!compact && <p>{mission.description}</p>}
        <span className="mission-meta">
          <span>{AREA_LABELS[mission.area]}</span>
          <span>
            <Icon name="clock" size={12} /> {mission.minutes} min
          </span>
        </span>
      </div>
      {mission.to && !done && (
        <Link to={mission.to} className="btn btn-ghost btn-sm mission-go">
          Start
        </Link>
      )}
    </li>
  );
}
