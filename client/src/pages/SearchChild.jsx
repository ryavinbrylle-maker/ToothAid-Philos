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
import { API_BASE_URL } from '../config';
import { PARENT_FORM_ALL_FIELD_MAP } from '../constants/parentFormFields';
import {
  buildLatestFollowUpByChild,
  FOLLOW_UP_SORT_RANK_NONE,
  followUpSortRank,
  formatFollowUpDueAt,
  getFollowUpDueCountdownLabel
} from '../utils/followUpTiming';

const SearchChild = ({ token }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]); // raw children list after search
  const [loading, setLoading] = useState(false);
  const [filterSchool, setFilterSchool] = useState('');
  const [filterGrade, setFilterGrade] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [sortMode, setSortMode] = useState('FOLLOW_UP'); // NAME | RECENT_VISIT | FOLLOW_UP
  const [recentVisitByChild, setRecentVisitByChild] = useState({}); // { [childId]: isoDate }
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [parentFormName, setParentFormName] = useState('');
  const [parentFormUrl, setParentFormUrl] = useState('');
  const [parentFormCopied, setParentFormCopied] = useState(false);
  const [creatingParentForm, setCreatingParentForm] = useState(false);
  /** Latest visit follow-up timing per child (requiresFollowUp visits only). */
  const [followUpByChild, setFollowUpByChild] = useState(new Map());

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
      setFollowUpByChild(buildLatestFollowUpByChild(visits));
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
    const followUpRank = (childId) => {
      const fu = followUpByChild.get(childId);
      if (!fu?.timing) return FOLLOW_UP_SORT_RANK_NONE;
      return followUpSortRank(fu.timing, fu.followUpDays);
    };
    const sorted = [...q].sort((a, b) => {
      if (sortMode === 'RECENT_VISIT') {
        const ta = recentVisitByChild[a.childId] ? new Date(recentVisitByChild[a.childId]).getTime() : -Infinity;
        const tb = recentVisitByChild[b.childId] ? new Date(recentVisitByChild[b.childId]).getTime() : -Infinity;
        if (tb !== ta) return tb - ta;
      } else if (sortMode === 'FOLLOW_UP') {
        const ra = followUpRank(a.childId);
        const rb = followUpRank(b.childId);
        if (ra !== rb) return ra - rb;
      }
      return formatChildDisplayName(a).localeCompare(formatChildDisplayName(b), undefined, { sensitivity: 'base' });
    });
    return sorted;
  }, [results, filterSchool, filterGrade, filterClass, sortMode, recentVisitByChild, followUpByChild]);

  const createNewPatientParentForm = async () => {
    const name = parentFormName.trim();
    if (!name) return;
    setCreatingParentForm(true);
    setParentFormUrl('');
    setParentFormCopied(false);
    try {
      const res = await fetch(`${API_BASE_URL}/parent-form`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          mode: 'create',
          patientName: name,
          fields: PARENT_FORM_ALL_FIELD_MAP
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setParentFormUrl(`Error: ${data.error || 'Could not create link'}`);
        return;
      }
      setParentFormUrl(`${window.location.origin}/parent-form/${data.token}`);
    } catch (err) {
      setParentFormUrl('Error: Could not create link. Check your connection.');
    } finally {
      setCreatingParentForm(false);
    }
  };

  return (
    <div className="container">
<PageHeader title="Patients" subtitle="Search or register patients" icon="children" />

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
            <option value="RECENT_VISIT">By recent visit</option>
            <option value="FOLLOW_UP">By priority</option>
            <option value="NAME">By name</option>
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
            onClick={() => {
              setFilterSchool('');
              setFilterGrade('');
              setFilterClass('');
            }}
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
          {filtered.map((child) => {
            const fu = followUpByChild.get(child.childId);
            const followUpDueLabel = fu?.dueAt ? formatFollowUpDueAt(fu.dueAt) : null;
            const followUpCountdown = fu?.dueAt ? getFollowUpDueCountdownLabel(fu.dueAt) : null;
            return (
            <Link key={child.childId} to={`/children/${child.childId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card" style={{ cursor: 'pointer', marginBottom: '8px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: '10px',
                    marginBottom: '8px'
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <PatientNameBlock child={child} nameTag="h3" />
                  </div>
                  {followUpCountdown ? (
                    <div
                      style={{
                        flexShrink: 0,
                        fontSize: '12px',
                        fontWeight: 700,
                        lineHeight: 1.3,
                        textAlign: 'right',
                        color:
                          followUpCountdown === 'Due today'
                            ? '#b45309'
                            : followUpCountdown.includes('overdue')
                              ? '#b91c1c'
                              : '#4b5563',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {followUpCountdown}
                    </div>
                  ) : null}
                </div>
                <p style={{ color: '#666', fontSize: '14px', marginBottom: '4px' }}>
                  {child.school} • {child.grade || '—'} • {child.class || '—'}
                </p>
                {followUpDueLabel ? (
                  <p style={{ color: '#6b7280', fontSize: '13px', margin: 0 }}>
                    {followUpDueLabel}
                  </p>
                ) : null}
              </div>
            </Link>
            );
          })}
        </div>
      )}

      {!loading && query.trim().length >= 2 && results.length === 0 && (
        <div className="empty-state">
          <p>No patients found matching "{query}"</p>
        </div>
      )}

      {!loading && query.trim().length === 0 && results.length === 0 && (
        <div className="empty-state">
          <p>No patients registered yet</p>
        </div>
      )}

      {addMenuOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16
          }}
          onClick={() => setAddMenuOpen(false)}
        >
          <div
            className="card"
            style={{ width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Add Patient</h3>
            <p style={{ marginTop: 0, color: 'var(--color-muted)', fontSize: 14 }}>
              Choose how you want to add this patient.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', marginBottom: 10 }}
              onClick={() => navigate('/children/register')}
            >
              Direct Registration
            </button>

            <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, marginTop: 12 }}>
              <h4 style={{ margin: '0 0 8px' }}>Send a form to parents</h4>
              <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--color-muted)' }}>
                Enter the patient name first. The generated form asks parents to fill all other fields.
              </p>
              <div className="form-group">
                <label>Patient Name</label>
                <input
                  type="text"
                  value={parentFormName}
                  onChange={(e) => setParentFormName(e.target.value)}
                  placeholder="First and last name"
                />
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ width: '100%', marginBottom: 10 }}
                disabled={creatingParentForm || !parentFormName.trim()}
                onClick={() => void createNewPatientParentForm()}
              >
                {creatingParentForm ? 'Creating…' : 'Generate link'}
              </button>
              {parentFormUrl ? (
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: 'var(--color-muted)', marginBottom: 6 }}>URL</label>
                  <input readOnly value={parentFormUrl} style={{ width: '100%', fontSize: 13 }} />
                  {!parentFormUrl.startsWith('Error:') ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ width: '100%', marginTop: 8 }}
                      onClick={async () => {
                        await navigator.clipboard.writeText(parentFormUrl);
                        setParentFormCopied(true);
                        window.setTimeout(() => setParentFormCopied(false), 1800);
                      }}
                    >
                      {parentFormCopied ? 'Copied!' : 'Copy to clipboard'}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <button type="button" className="btn btn-secondary" style={{ width: '100%', marginTop: 12 }} onClick={() => setAddMenuOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* Floating "+" */}
      <button
        type="button"
        onClick={() => {
          setParentFormName('');
          setParentFormUrl('');
          setParentFormCopied(false);
          setAddMenuOpen(true);
        }}
        aria-label="Register new patient"
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
