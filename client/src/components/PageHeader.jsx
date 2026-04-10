import { useLocation, useNavigate } from 'react-router-dom';

const ROOT_PATHS = new Set(['/', '/children', '/schedule', '/reports', '/sync']);

/** Logical parent route (not browser history) — avoids A→B→A loops. */
const getParentPath = (pathname) => {
  if (typeof pathname !== 'string' || pathname.length === 0) return '/';
  const clean = pathname.split('?')[0].split('#')[0];
  if (clean === '/' || !clean.startsWith('/')) return '/';

  // Edit visit: /children/:id/visit-entry/:visitId → profile, not "visit-entry"
  const visitEntryEdit = clean.match(/^\/children\/([^/]+)\/visit-entry\/[^/]+$/);
  if (visitEntryEdit) return `/children/${visitEntryEdit[1]}`;

  const parts = clean.split('/').filter(Boolean);
  if (parts.length <= 1) return '/';
  return `/${parts.slice(0, -1).join('/')}`;
};

const PageHeader = ({ title, secondaryTitle, subtitle, icon, showBack, backTo }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location?.pathname || '/';
  const shouldShowBack = showBack ?? !ROOT_PATHS.has(pathname);

  // Outline icon components matching NavBar icons
  const icons = {
    children: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: '48px', height: '48px' }}>
        <circle cx="9" cy="7" r="3" />
        <path d="M9 12c-3.5 0-6 1.5-6 3v2h12v-2c0-1.5-2.5-3-6-3z" />
        <circle cx="17" cy="7" r="2.5" />
        <path d="M17 11c1.5 0 4 .8 4 2v2h-4" />
      </svg>
    ),
    visit: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: '48px', height: '48px' }}>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M9 7h6" />
        <path d="M9 11h6" />
        <path d="M9 15h4" />
      </svg>
    ),
    reports: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: '48px', height: '48px' }}>
        <path d="M3 3v18h18" />
        <path d="M7 16v-4" strokeLinecap="round" />
        <path d="M11 16v-7" strokeLinecap="round" />
        <path d="M15 16v-5" strokeLinecap="round" />
        <path d="M19 16v-9" strokeLinecap="round" />
      </svg>
    ),
    sync: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: '48px', height: '48px' }}>
        <path d="M4 12c0-4.4 3.6-8 8-8 2.8 0 5.2 1.4 6.6 3.5" />
        <path d="M20 12c0 4.4-3.6 8-8 8-2.8 0-5.2-1.4-6.6-3.5" />
        <path d="M16 4l3 3.5-3.5 3" />
        <path d="M8 20l-3-3.5 3.5-3" />
      </svg>
    ),
    clinic: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: '48px', height: '48px' }}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 10h18" />
        <path d="M8 2v4" />
        <path d="M16 2v4" />
        <rect x="6" y="13" width="4" height="4" rx="0.5" />
      </svg>
    ),
    profile: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: '48px', height: '48px' }}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
      </svg>
    ),
    alert: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: '48px', height: '48px' }}>
        <path d="M12 3L2 21h20L12 3z" />
        <path d="M12 9v4" strokeLinecap="round" />
        <circle cx="12" cy="17" r="0.5" fill="currentColor" />
      </svg>
    ),
    roster: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: '48px', height: '48px' }}>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M9 7h6" />
        <path d="M9 11h6" />
        <path d="M9 15h6" />
        <circle cx="12" cy="5" r="1.5" />
      </svg>
    ),
    tooth: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: '48px', height: '48px' }}>
        <path d="M12 2C9.5 2 7 3 6 5C5 7 5 9 5.5 11C6 13 6.5 15 7 17C7.5 19 8 21 9 22C9.5 22.5 10.5 22.5 11 21C11.5 19.5 12 18 12 18C12 18 12.5 19.5 13 21C13.5 22.5 14.5 22.5 15 22C16 21 16.5 19 17 17C17.5 15 18 13 18.5 11C19 9 19 7 18 5C17 3 14.5 2 12 2Z"/>
      </svg>
    ),
    today: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: '48px', height: '48px' }}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 10h18" />
        <path d="M8 2v4" />
        <path d="M16 2v4" />
      </svg>
    )
  };

  const selectedIcon = icons[icon] || icons.tooth;

  const backBtn = (
    <button
      type="button"
      onClick={() => {
        const target =
          typeof backTo === 'string' && backTo.trim() !== '' ? backTo.trim() : getParentPath(pathname);
        navigate(target);
      }}
      aria-label="Back"
      title="Back"
      style={{
        flexShrink: 0,
        width: '36px',
        height: '36px',
        borderRadius: 'var(--radius-pill)',
        border: '1px solid rgba(255, 255, 255, 0.35)',
        background: 'rgba(255, 255, 255, 0.14)',
        color: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        backdropFilter: 'blur(8px)'
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
        <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );

  return (
    <div style={{
      background: '#0D9488',
      padding: '12px 14px',
      marginBottom: '10px',
      marginLeft: 'calc(-1 * var(--page-pad-x))',
      marginRight: 'calc(-1 * var(--page-pad-x))',
      marginTop: 'calc(-1 * var(--page-pad-y))',
      position: 'relative',
      overflow: 'hidden',
      minHeight: 0
    }}>
      {/* Background decorative icon */}
      <div style={{
        position: 'absolute',
        right: '12px',
        top: '50%',
        transform: 'translateY(-50%)',
        color: 'rgba(255, 255, 255, 0.2)',
        pointerEvents: 'none'
      }}>
        {selectedIcon}
      </div>

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: shouldShowBack ? '10px' : 0
        }}
      >
        {shouldShowBack ? backBtn : null}
        <div style={{ flex: 1, minWidth: 0, paddingRight: '64px' }}>
          <h1 style={{
            color: 'white',
            fontSize: '20px',
            fontWeight: '700',
            margin: '0 0 2px 0',
            lineHeight: 1.25,
            textShadow: '0 1px 2px rgba(0,0,0,0.1)'
          }}>
            {title}
          </h1>
          {secondaryTitle != null && secondaryTitle !== false && (
            <div
              style={{
                color: 'rgba(255, 255, 255, 0.96)',
                fontSize: '15px',
                fontWeight: 700,
                margin: '0 0 6px 0',
                letterSpacing: '0.06em',
                lineHeight: 1.3,
                textShadow: '0 1px 2px rgba(0,0,0,0.08)'
              }}
            >
              {secondaryTitle}
            </div>
          )}
          {subtitle && (
            <p style={{
              color: 'rgba(255, 255, 255, 0.85)',
              fontSize: '13px',
              margin: 0,
              fontWeight: '400',
              lineHeight: 1.35
            }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default PageHeader;
