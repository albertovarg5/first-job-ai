import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { useAppData } from '../context/AppDataContext.jsx';
import { toDateKey } from '../lib/utils.js';

export const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/jobs', label: 'Job Search', icon: 'search' },
  { to: '/tracker', label: 'Job Tracker', icon: 'tracker' },
  { to: '/resume', label: 'Resume Builder', icon: 'resume' },
  { to: '/interview', label: 'Interview Practice', icon: 'interview' },
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
  const { data } = useAppData();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo?.(0, 0);
  }, [location.pathname]);

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
          <Outlet />
        </div>
      </main>
    </div>
  );
}
