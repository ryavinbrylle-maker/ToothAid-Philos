import { useMemo, useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import NavBar from '../components/NavBar';
import PageHeader from '../components/PageHeader';
import { PatientNameBlock } from '../components/PatientNameBlock';
import { searchChildren, getAllChildren, getAllVisits } from '../db/indexedDB';
import { formatChildDisplayName } from '../utils/displayName';
import {
  CHILD_SCHOOL_PRESETS,
  CHILD_SCHOOL_FILTER_OTHERS,
  isPresetChildSchool
} from '../constants/childSchools';

const SearchChild = ({ token }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]); // raw children list after search
  const [loading, setLoading] = useState(false);
  const [filterSchool, setFilterSchool] = useState('');
  const [filterGrade, setFilterGrade] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [sortMode, setSortMode] = useState('PRIORITY'); // PRIORITY | RECENT_VISIT
  const [recentVisitByChild, setRecentVisitByChild] = useState({}); // { [childId]: isoDate }

  // Load all children on mount
  useEffect(() => {
    loadAllChildren();
  }, []);

  const loadAllChildren = async () => {
    setLoading(true);
    const all = await getAllChildren();
    setResults(all);
    // Precompute recent visit per child (used for sorting)
    try {
      const visits = await getAllVisits();
      const map = {};
      for (const v of visits) {
        if (!v?.childId || !v?.date) continue;
        const t = new Date(v.date).getTime();
        if (!Number.isFinite(t)) continue;
        const prev = map[v.childId] ? new Date(map[v.childId]).getTime() : -Infinity;
        if (t > prev) map[v.childId] = new Date(t).toISOString();
      }
      setRecentVisitByChild(map);
    } catch {
      // ignore
    }
    setLoading(false);
  };

  // Filter results when query changes
  useEffect(() => {
    if (query.trim().length >= 2) {
      setLoading(true);
      searchChildren(query).then(found => {
        setResults(found);
        setLoading(false);
      });
    } else if (query.trim().length === 0) {
      loadAllChildren();
    }
  }, [query]);

  const grades = useMemo(() => {
    const s = new Set(results.map(c => (c.grade || '').trim()).filter(Boolean));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [results]);
  const classes = useMemo(() => {
    const s = new Set(results.map(c => (c.class || '').trim()).filter(Boolean));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [results]);

  const priorityRank = (p) => {
    const v = String(p || '').toUpperCase().trim();
    if (v === 'P0') return 0;
    if (v === 'P1') return 1;
    if (v === 'P2') return 2;
    if (v === 'P3') return 3;
    return 9;
  };

  const priorityMeta = (p) => {
    const v = String(p || 'P2').toUpperCase().trim();
    if (v === 'P0') return { label: 'P0', color: '#EF4444', bg: 'rgba(239,68,68,0.12)' };
    if (v === 'P1') return { label: 'P1', color: '#F97316', bg: 'rgba(249,115,22,0.12)' };
    if (v === 'P2') return { label: 'P2', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' };
    if (v === 'P3') return { label: 'P3', color: '#10B981', bg: 'rgba(16,185,129,0.12)' };
    return { label: v || '—', color: '#6B7280', bg: 'rgba(107,114,128,0.12)' };
  };

  const filtered = useMemo(() => {
    const q = results.filter((c) => {
      if (filterSchool === CHILD_SCHOOL_FILTER_OTHERS) {
        const s = String(c.school || '').trim();
        if (!s || isPresetChildSchool(s)) return false;
      } else if (filterSchool && (c.school || '') !== filterSchool) return false;
      if (filterGrade && (c.grade || '') !== filterGrade) return false;
      if (filterClass && (c.class || '') !== filterClass) return false;
      return true;
    });
    const sorted = [...q].sort((a, b) => {
      if (sortMode === 'RECENT_VISIT') {
        const ta = recentVisitByChild[a.childId] ? new Date(recentVisitByChild[a.childId]).getTime() : -Infinity;
        const tb = recentVisitByChild[b.childId] ? new Date(recentVisitByChild[b.childId]).getTime() : -Infinity;
        if (tb !== ta) return tb - ta;
      } else {
        const ra = priorityRank(a.priority);
        const rb = priorityRank(b.priority);
        if (ra !== rb) return ra - rb;
      }
      return formatChildDisplayName(a).localeCompare(formatChildDisplayName(b), undefined, { sensitivity: 'base' });
    });
    return sorted;
  }, [results, filterSchool, filterGrade, filterClass, sortMode, recentVisitByChild]);

  return (
    <div className="container">
<PageHeader title="Children" subtitle="Search or register children" icon="children" />

      {/* Search Input - Apple Style */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        background: '#f2f2f7',
        borderRadius: '12px',
        padding: '0 12px',
        marginBottom: '16px'
      }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="#8e8e93" strokeWidth="2" style={{ width: '18px', height: '18px', flexShrink: 0 }}>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          placeholder="Search by name / patient ID / school / grade / class..."
          value={query}
          onChange={(e) => setQuery(e.target.value.toUpperCase())}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            padding: '12px 10px',
            fontSize: '16px',
            color: '#1c1c1e'
          }}
        />
      </div>

      {/* Sort (own row) + filters (one row) */}
      <div className="card" style={{ marginBottom: '12px' }}>
        <div className="children-sort-row">
          <label className="children-toolbar-label" htmlFor="children-sort">
            Sort
          </label>
          <select
            id="children-sort"
            className="children-toolbar-select"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value)}
          >
            <option value="PRIORITY">By priority</option>
            <option value="RECENT_VISIT">By recent visit</option>
          </select>
        </div>

        <div className="children-filters-row">
          <div>
            <label className="children-toolbar-label" htmlFor="children-filter-school">
              School
            </label>
            <select
              id="children-filter-school"
              className="children-toolbar-select"
              value={filterSchool}
              onChange={(e) => setFilterSchool(e.target.value)}
            >
              <option value="">All schools</option>
              {CHILD_SCHOOL_PRESETS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              <option value={CHILD_SCHOOL_FILTER_OTHERS}>Others (custom)</option>
            </select>
          </div>
          <div>
            <label className="children-toolbar-label" htmlFor="children-filter-grade">
              Grade
            </label>
            <select
              id="children-filter-grade"
              className="children-toolbar-select"
              value={filterGrade}
              onChange={(e) => setFilterGrade(e.target.value)}
            >
              <option value="">All grades</option>
              {grades.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="children-toolbar-label" htmlFor="children-filter-class">
              Class
            </label>
            <select
              id="children-filter-class"
              className="children-toolbar-select"
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
            >
              <option value="">All classes</option>
              {classes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {(filterSchool || filterGrade || filterClass) && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => { setFilterSchool(''); setFilterGrade(''); setFilterClass(''); }}
            style={{ marginTop: '12px', width: '100%' }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Search Results */}
      {loading && <div className="loading">Searching...</div>}

      {!loading && filtered.length > 0 && (
        <div style={{ paddingBottom: '78px' }}>
          {filtered.map((child) => (
            <Link key={child.childId} to={`/children/${child.childId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card" style={{ cursor: 'pointer', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', marginBottom: '8px' }}>
                  <PatientNameBlock child={child} nameTag="h3" />
                  <div
                    className="badge-pill"
                    style={{
                      background: priorityMeta(child.priority).bg,
                      color: priorityMeta(child.priority).color,
                      fontSize: '12px',
                      alignSelf: 'flex-start'
                    }}
                  >
                    {priorityMeta(child.priority).label}
                  </div>
                </div>
                <p style={{ color: '#666', fontSize: '14px', marginBottom: '4px' }}>
                  {child.school} • {child.grade || '—'} • {child.class || '—'}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {!loading && query.trim().length >= 2 && results.length === 0 && (
        <div className="empty-state">
          <p>No children found matching "{query}"</p>
        </div>
      )}

      {!loading && query.trim().length === 0 && results.length === 0 && (
        <div className="empty-state">
          <p>No children registered yet</p>
        </div>
      )}

      {/* Floating "+" */}
      <button
        type="button"
        onClick={() => navigate('/children/register')}
        aria-label="Register new child"
        style={{
          position: 'fixed',
          right: '16px',
          bottom: '88px',
          width: '52px',
          height: '52px',
          borderRadius: '999px',
          border: 'none',
          background: 'var(--color-primary)',
          color: 'white',
          fontSize: '28px',
          lineHeight: '52px',
          textAlign: 'center',
          boxShadow: '0 10px 25px rgba(0,0,0,0.18)',
          cursor: 'pointer'
        }}
      >
        +
      </button>

      <NavBar />
    </div>
  );
};

export default SearchChild;
