import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { Spinner } from './ui.jsx';
import { toDateKey } from '../lib/utils.js';

export const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/jobs', label: 'Job Search', icon: 'search' },
  { to: '/tracker', label: 'Job Tracker', icon: 'tracker' },
  { to: '/resume', label: 'Resume Builder', icon: 'resume' },
  { to: '/cover-letters', label: 'Cover Letters', icon: 'letter' },
  { to: '/interview', label: 'Interview Practice', icon: 'interview' },
  { to: '/assistant', label: 'Career Assistant', icon: 'compass' },
  { to: '/translator', label: 'Experience Translator', icon: 'translator' },
  { to: '/missions', label: 'Career Missions', icon: 'missions' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

export function Logo({ to = '/' }) {
  return (
    <Link to={to} className="logo" aria-label="First Job AI home">
      <span className="logo-mark">
        <Icon name="logo" size={16} strokeWidth={2.2} />
      </span>
      <span className="logo-text">First Job AI</span>
    </Link>
  );
}

function SyncStatus() {
  const { mode, sync } = useAppData();
  const auth = useAuth();
  if (mode === 'account') {
    const label = { saving: 'Saving…', saved: 'Saved to your account', error: 'Not saved', conflict: 'Not saved', loading: 'Loading…' }[sync.state] || 'Signed in';
    return (
      <span className={`sync-pill ${sync.state === 'error' || sync.state === 'conflict' ? 'sync-bad' : ''}`} title={auth.user.email}>
        <Icon name={sync.state === 'error' || sync.state === 'conflict' ? 'alert' : 'check'} size={13} /> {label}
      </span>
    );
  }
  if (!auth.serverAvailable) return null;
  return (
    <Link to="/signup" className="sync-pill" title="Your data is saved in this browser only">
      <Icon name="lock" size={13} /> Guest · Save to an account
    </Link>
  );
}

// Shown when saving to the account failed or another tab saved first.
function SyncBanner() {
  const { mode, sync, syncActions } = useAppData();
  if (mode !== 'account') return null;
  if (sync.state === 'conflict') {
    return (
      <div className="alert alert-warn sync-banner" role="alert">
        <Icon name="alert" size={16} />
        <span>Your data was changed in another tab or on another device, so your latest changes here weren’t saved.</span>
        <span className="sync-banner-actions">
          <button className="btn btn-secondary btn-sm" onClick={syncActions.loadLatest}>
            Load the latest version
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => syncActions.keepMine(sync.serverRevision)}>
            Keep this version
          </button>
        </span>
      </div>
    );
  }
  if (sync.state === 'error') {
    return (
      <div className="alert alert-error sync-banner" role="alert">
        <Icon name="alert" size={16} />
        <span>Your latest changes couldn’t be saved: {sync.message}</span>
        <span className="sync-banner-actions">
          <button className="btn btn-secondary btn-sm" onClick={syncActions.retry}>
            Try again
          </button>
        </span>
      </div>
    );
  }
  return null;
}

export function LoadingScreen({ message = 'Loading your data…', error, onRetry }) {
  return (
    <div className="loading-screen" role="status">
      <Logo />
      {error ? (
        <>
          <p className="muted">{error}</p>
          {onRetry && (
            <button className="btn btn-primary" onClick={onRetry}>
              Try again
            </button>
          )}
        </>
      ) : (
        <p className="muted center-row">
          <Spinner /> {message}
        </p>
      )}
    </div>
  );
}

function Sidebar({ open, onNavigate }) {
  const { data, aiActive, aiStatus } = useAppData();
  const todayDone = (data.missions.completed[toDateKey()] || []).length;
  const name = data.profile?.name || 'You';

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
      <div className="sidebar-top">
        <Logo to="/dashboard" />
      </div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} onClick={onNavigate} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Icon name={item.icon} size={18} />
            <span>{item.label}</span>
            {item.to === '/missions' && todayDone < 3 && <span className="nav-count">{3 - todayDone}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <SyncStatus />
        <Link to="/settings" className="ai-pill" onClick={onNavigate} title="AI status">
          <span className={`dot ${aiActive ? 'dot-on' : ''}`} />
          {!aiStatus.checked ? 'Checking AI…' : aiActive ? 'AI connected' : 'Basic mode'}
        </Link>
        <Link to="/settings" className="profile-chip" onClick={onNavigate}>
          <span className="avatar">{name.charAt(0).toUpperCase()}</span>
          <span className="profile-chip-text">
            <strong>{name}</strong>
            <small>{data.profile?.targetRole || 'Set your target role'}</small>
          </span>
        </Link>
      </div>
    </aside>
  );
}

export default function AppLayout() {
  const { data, dataReady, sync, syncActions } = useAppData();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo?.(0, 0);
  }, [location.pathname]);

  if (sync.state === 'loadError') return <LoadingScreen error={`We couldn’t load your data: ${sync.message}`} onRetry={syncActions.loadLatest} />;
  if (!dataReady) return <LoadingScreen />;
  if (!data.profile) return <Navigate to="/onboarding" replace />;

  const current = NAV_ITEMS.find((n) => location.pathname.startsWith(n.to));

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="mobile-bar">
        <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
          <Icon name="menu" size={20} />
        </button>
        <span className="mobile-title">{current?.label || 'First Job AI'}</span>
        <span style={{ width: 36 }} />
      </header>
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      {menuOpen && <div className="sidebar-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
      <main id="main" className="main">
        <div className="main-inner">
          <SyncBanner />
          <Outlet />
        </div>
      </main>
    </div>
  );
}
