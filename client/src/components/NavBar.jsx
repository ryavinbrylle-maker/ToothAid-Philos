import { Link, useLocation } from 'react-router-dom';

const NavBar = () => {
  const location = useLocation();

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    if (path === '/children') return location.pathname.startsWith('/children');
    if (path === '/schedule') return location.pathname.startsWith('/schedule');
    if (path === '/reports') return location.pathname.startsWith('/reports');
    return location.pathname.startsWith(path);
  };

  return (
    <nav className="nav-bar">
      <Link to="/" className={`nav-item ${isActive('/') ? 'active' : ''}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 10h18" />
          <path d="M8 2v4" />
          <path d="M16 2v4" />
        </svg>
        <span>Today</span>
      </Link>
      <Link to="/children" className={`nav-item ${isActive('/children') ? 'active' : ''}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="9" cy="7" r="3" />
          <path d="M9 12c-3.5 0-6 1.5-6 3v2h12v-2c0-1.5-2.5-3-6-3z" />
          <circle cx="17" cy="7" r="2.5" />
          <path d="M17 11c1.5 0 4 .8 4 2v2h-4" />
        </svg>
        <span>Children</span>
      </Link>
      <Link to="/schedule" className={`nav-item ${isActive('/schedule') ? 'active' : ''}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 10h18" />
          <path d="M8 2v4" />
          <path d="M16 2v4" />
          <rect x="6" y="13" width="4" height="4" rx="0.5" />
        </svg>
        <span>Schedule</span>
      </Link>
      <Link to="/reports" className={`nav-item ${isActive('/reports') ? 'active' : ''}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 3v18h18" />
          <path d="M7 16v-4" strokeLinecap="round" />
          <path d="M11 16v-7" strokeLinecap="round" />
          <path d="M15 16v-5" strokeLinecap="round" />
          <path d="M19 16v-9" strokeLinecap="round" />
        </svg>
        <span>Reports</span>
      </Link>
    </nav>
  );
};

export default NavBar;
