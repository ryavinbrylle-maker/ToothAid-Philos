import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import NavBar from '../components/NavBar';
import PageHeader from '../components/PageHeader';
import PatientContactModal from '../components/PatientContactModal';
import { PatientNameBlock } from '../components/PatientNameBlock';
import DateInput from '../components/DateInput';
import { 
  getChild,
  getAllChildren,
  getVisitsByChild, 
  upsertChild, 
  deleteChild, 
  deleteVisit, 
  addToOutbox, 
  performSync 
} from '../db/indexedDB';
import { getAgeFromDOB } from '../utils/age';
import { formatChildDisplayName } from '../utils/displayName';
import { notifyError, notifySuccess } from '../utils/notify';
import {
  CHILD_SCHOOL_PRESETS,
  CHILD_SCHOOL_UI_OTHER
} from '../constants/childSchools';
import { generateUniquePatientId, isValidPatientId, normalizePatientIdInput } from '../utils/patientId';
import {
  CONDITIONS,
  permanentTeeth,
  primaryTeeth,
  PERMANENT_SET,
  PRIMARY_SET,
  isDarkHex,
  getPersistedToothCondition,
  buildVisitTeethRows
} from '../utils/toothChart';

const formatMedicationLine = (m) => {
  if (!m || typeof m !== 'object') return '';
  const parts = [
    m.name || '',
    m.dosage || null,
    m.frequencyPerDay != null && String(m.frequencyPerDay).trim() !== '' ? `${m.frequencyPerDay}×/day` : null,
    m.days != null && String(m.days).trim() !== '' ? `${m.days}d` : null
  ].filter(Boolean);
  return parts.join(' · ');
};

/** Accept medications saved as array, JSON string, or single object. */
const normalizeMedicationsFromVisit = (visit) => {
  const raw = visit?.medications;
  if (raw == null) return [];
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return [];
    try {
      const p = JSON.parse(t);
      if (Array.isArray(p)) return normalizeMedicationsFromVisit({ medications: p });
    } catch (_) {
      return [{ name: t }];
    }
  }
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (item == null) return null;
        if (typeof item === 'string') {
          const n = item.trim();
          return n ? { name: n } : null;
        }
        if (typeof item === 'object') return item;
        return null;
      })
      .filter(Boolean);
  }
  if (typeof raw === 'object') {
    const vals = Object.values(raw);
    if (vals.length && vals.every((v) => v && typeof v === 'object')) return vals;
  }
  return [];
};

/** Single visit card body: per-tooth tiles (same palette as tooth map) + meds + notes */
const VisitHistoryEntryDetail = ({ visit }) => {
  const teethRows = buildVisitTeethRows(visit);
  const medications = normalizeMedicationsFromVisit(visit);

  const legacyTreatments =
    visit.treatmentTypes && visit.treatmentTypes.length > 0
      ? visit.treatmentTypes
      : Array.isArray(visit.treatments)
        ? visit.treatments.filter((t) => t != null && String(t).trim() !== '')
        : [];

  const chiefText =
    visit.chiefComplaint != null && String(visit.chiefComplaint).trim() !== ''
      ? String(visit.chiefComplaint).trim()
      : '';
  const hasTeethOrLegacy = teethRows.length > 0 || legacyTreatments.length > 0;
  const visitNotesText =
    visit.notes != null && String(visit.notes).trim() !== '' ? String(visit.notes).trim() : '';

  return (
    <div style={{ marginTop: '10px' }}>
      {chiefText && (
        <p style={{ margin: '0 0 10px', fontSize: '14px', lineHeight: 1.45, color: '#374151' }}>
          <strong>Chief complaint: </strong>
          <span style={{ color: '#4b5563', fontWeight: 400 }}>{chiefText}</span>
        </p>
      )}
      {teethRows.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {teethRows.map((row) => {
            const condMeta = CONDITIONS.find((c) => c.id === row.conditionId) || CONDITIONS[0];
            const showStatusLabel = condMeta.id !== 'sound';
            const fg = isDarkHex(condMeta.color) ? '#fff' : '#111827';
            return (
              <div
                key={row.tooth}
                style={{
                  display: 'flex',
                  gap: '12px',
                  alignItems: 'flex-start',
                  padding: '10px 12px',
                  background: '#f9fafb',
                  borderRadius: '12px',
                  border: '1px solid #e5e5ea'
                }}
              >
                <div
                  title={showStatusLabel ? `${row.tooth} · ${condMeta.label}` : row.tooth}
                  style={{
                    flexShrink: 0,
                    width: '52px',
                    padding: '8px 4px 6px',
                    borderRadius: '10px',
                    border: '1px solid #e5e5ea',
                    boxSizing: 'border-box',
                    background: condMeta.color,
                    color: fg,
                    fontWeight: 800,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '2px',
                    minHeight: '52px',
                    lineHeight: 1.1,
                    textAlign: 'center'
                  }}
                >
                  <span style={{ fontSize: '0.95rem' }}>{row.tooth}</span>
                  <span
                    style={{
                      fontSize: '0.62rem',
                      fontWeight: 650,
                      opacity: 0.92,
                      maxWidth: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {showStatusLabel ? condMeta.label : '\u00A0'}
                  </span>
                </div>
                <div style={{ flex: 1, minWidth: 0, fontSize: '14px', lineHeight: 1.45 }}>
                  {row.treatments.length > 0 && (
                    <div style={{ marginBottom: row.note ? '6px' : 0 }}>
                      <span style={{ fontWeight: 700, color: '#374151' }}>Treatment: </span>
                      <span>{row.treatments.join(', ')}</span>
                    </div>
                  )}
                  {row.note && (
                    <div>
                      <span style={{ fontWeight: 700, color: '#374151' }}>Notes: </span>
                      <span style={{ color: '#4b5563' }}>{row.note}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {legacyTreatments.length > 0 && (
            <p style={{ marginTop: '8px', fontSize: '14px' }}>
              <strong>Treatments: </strong>
              {legacyTreatments.join(', ')}
            </p>
          )}
        </>
      )}

      {medications.length > 0 && (
        <div style={{ marginTop: chiefText || hasTeethOrLegacy ? '14px' : 0 }}>
          <div style={{ fontWeight: 750, fontSize: '14px', color: '#374151', marginBottom: '6px' }}>Medication</div>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '14px', lineHeight: 1.5, color: '#4b5563' }}>
            {medications.map((m, idx) => (
              <li key={idx}>{formatMedicationLine(m) || '—'}</li>
            ))}
          </ul>
        </div>
      )}

      {visitNotesText && (
        <div
          style={{
            marginTop:
              chiefText || hasTeethOrLegacy || medications.length > 0 ? '14px' : '8px',
            fontSize: '14px',
            lineHeight: 1.45,
            color: '#4b5563'
          }}
        >
          <div style={{ fontWeight: 750, color: '#374151', marginBottom: '4px' }}>Visit notes</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{visitNotesText}</div>
        </div>
      )}
    </div>
  );
};

/** 当前患者牙况：只读 `toothStates`，与单条就诊记录无关。 */
const VisitToothMap = ({ toothStates }) => {
  const ts = toothStates != null && typeof toothStates === 'object' && !Array.isArray(toothStates) ? toothStates : {};
  const keys = Object.keys(ts).map(String);

  const hasPermanentData = keys.some((t) => PERMANENT_SET.has(t));
  const hasPrimaryData = keys.some((t) => PRIMARY_SET.has(t));
  if (!hasPermanentData && !hasPrimaryData) return null;

  const showPermanent = hasPermanentData;
  const showPrimary = hasPrimaryData;

  const ToothGrid = ({ rows }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px' }}>
      {rows.map((row, idx) => (
        <div
          key={idx}
          style={{ display: 'grid', gridTemplateColumns: `repeat(${row.length}, 1fr)`, gap: '6px' }}
        >
          {row.map((tooth) => {
            const conditionId = getPersistedToothCondition(ts, tooth);
            const condMeta = CONDITIONS.find((c) => c.id === conditionId) || CONDITIONS[0];
            const showStatusLabel = condMeta.id !== 'sound';
            const bg = condMeta.color;
            const fg = isDarkHex(condMeta.color) ? '#fff' : '#111827';
            return (
              <div
                key={tooth}
                title={showStatusLabel ? `${tooth} · ${condMeta.label}` : tooth}
                style={{
                  padding: '8px 4px 6px',
                  borderRadius: '10px',
                  border: '1px solid #e5e5ea',
                  boxSizing: 'border-box',
                  background: bg,
                  color: fg,
                  fontWeight: 800,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '2px',
                  minHeight: '52px',
                  lineHeight: 1.1
                }}
              >
                <span style={{ fontSize: '0.95rem' }}>{tooth}</span>
                <span
                  style={{
                    fontSize: '0.62rem',
                    fontWeight: 650,
                    opacity: 0.92,
                    textAlign: 'center',
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {showStatusLabel ? condMeta.label : '\u00A0'}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ marginTop: '10px', marginBottom: '10px' }}>
      {showPermanent && (
        <div>
          <div style={{ fontSize: '12px', fontWeight: 750, color: '#374151', marginBottom: '6px' }}>Permanent</div>
          <ToothGrid rows={permanentTeeth} />
        </div>
      )}
      {showPermanent && showPrimary && <div style={{ height: 1, background: '#e5e5ea', margin: '10px 0' }} />}
      {showPrimary && (
        <div>
          <div style={{ fontSize: '12px', fontWeight: 750, color: '#374151', marginBottom: '6px' }}>Primary</div>
          <ToothGrid rows={primaryTeeth} />
        </div>
      )}
    </div>
  );
};

const ChildProfile = ({ token }) => {
  const { childId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [child, setChild] = useState(null);
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Edit child state
  const [isEditingChild, setIsEditingChild] = useState(false);
  const [childFormData, setChildFormData] = useState({});
  const [savingChild, setSavingChild] = useState(false);

  // Consent editor
  const [showConsentEditor, setShowConsentEditor] = useState(false);
  const [consentGeneralDate, setConsentGeneralDate] = useState(''); // yyyy-mm-dd
  const [consentSpecific, setConsentSpecific] = useState([]); // [{ procedure, date }]
  
  // Delete child confirmation
  const [showDeleteChildConfirm, setShowDeleteChildConfirm] = useState(false);
  const [deletingChild, setDeletingChild] = useState(false);
  
  // Delete visit confirmation
  const [deleteVisitId, setDeleteVisitId] = useState(null);
  const [deletingVisit, setDeletingVisit] = useState(false);
  
  // Error state
  const [error, setError] = useState('');

  // Child info: collapse detailed fields in view mode
  const [childDetailsOpen, setChildDetailsOpen] = useState(false);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  /** True when school is custom (not BES/JCES), including empty field after picking Others. */
  const [schoolIsOtherMode, setSchoolIsOtherMode] = useState(false);

  // Refetch when childId changes or when navigating back to this profile (e.g. from Add Visit)
  useEffect(() => {
    loadData();
  }, [childId, location.pathname]);

  // When we navigated here after adding a visit, refresh and clear the state
  useEffect(() => {
    if (location.state?.refreshVisits) {
      loadData();
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state?.refreshVisits]);

  // Refetch when user returns to this tab so latest visits always show
  useEffect(() => {
    const onFocus = () => {
      if (location.pathname === `/children/${childId}`) loadData();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [childId, location.pathname]);

  const loadData = async () => {
    const childData = await getChild(childId);
    const visitsData = await getVisitsByChild(childId);
    
    setChild(childData);
    // Sort by submit time (createdAt) descending; fall back to date for legacy rows.
    setVisits(
      visitsData.sort((a, b) => {
        const atA = a?.createdAt ? new Date(a.createdAt).getTime() : NaN;
        const atB = b?.createdAt ? new Date(b.createdAt).getTime() : NaN;
        if (Number.isFinite(atA) && Number.isFinite(atB) && atA !== atB) return atB - atA;
        if (Number.isFinite(atA) && !Number.isFinite(atB)) return -1;
        if (!Number.isFinite(atA) && Number.isFinite(atB)) return 1;
        const dA = a?.date ? new Date(a.date).getTime() : NaN;
        const dB = b?.date ? new Date(b.date).getTime() : NaN;
        if (Number.isFinite(dA) && Number.isFinite(dB) && dA !== dB) return dB - dA;
        return String(b?.visitId || '').localeCompare(String(a?.visitId || ''));
      })
    );
    setLoading(false);
  };

  const formatDate = (date) => {
    if (!date) return 'N/A';
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'N/A';
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const year = d.getFullYear();
    return `${month}/${day}/${year}`;
  };

  const formatDateForInput = (date) => {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
  };

  const priorityMeta = (p) => {
    const v = String(p || 'P2').toUpperCase();
    if (v === 'P0') return { label: 'P0', color: '#EF4444', bg: 'rgba(239,68,68,0.12)' };
    if (v === 'P1') return { label: 'P1', color: '#F97316', bg: 'rgba(249,115,22,0.12)' };
    if (v === 'P2') return { label: 'P2', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' };
    if (v === 'P3') return { label: 'P3', color: '#10B981', bg: 'rgba(16,185,129,0.12)' };
    return { label: v, color: '#6B7280', bg: 'rgba(107,114,128,0.12)' };
  };

  const openConsentEditor = () => {
    const general = formatDateForInput(child?.consentGeneralReceivedAt);
    const specific = Array.isArray(child?.consentSpecific) ? child.consentSpecific : [];
    setConsentGeneralDate(general);
    setConsentSpecific(
      specific
        .filter(e => e && typeof e === 'object')
        .map(e => ({
          procedure: e.procedure || '',
          date: formatDateForInput(e.date) || ''
        }))
    );
    setShowConsentEditor(true);
  };

  const saveConsent = async () => {
    setSavingChild(true);
    setError('');
    try {
      const username = localStorage.getItem('username') || 'unknown';
      const now = new Date().toISOString();
      const updatedChild = {
        ...child,
        consentGeneralReceivedAt: consentGeneralDate ? new Date(consentGeneralDate).toISOString() : null,
        consentSpecific: (consentSpecific || [])
          .filter(e => (e.procedure || '').trim() || (e.date || '').trim())
          .map(e => ({
            procedure: (e.procedure || '').trim(),
            date: e.date ? new Date(e.date).toISOString() : null
          })),
        updatedBy: username,
        updatedAt: now
      };

      await upsertChild(updatedChild);
      await addToOutbox('UPSERT_CHILD', childId, updatedChild);

      if (navigator.onLine && token) {
        try {
          await performSync(token);
        } catch (syncError) {
          console.error('Sync failed:', syncError);
        }
      }

      setChild(updatedChild);
      setShowConsentEditor(false);
      notifySuccess('Consent saved.');
    } catch (err) {
      setError(err.message);
      notifyError(err?.message || 'Failed to save consent');
    } finally {
      setSavingChild(false);
    }
  };

  // ===== CHILD EDIT HANDLERS =====
  const startEditingChild = () => {
    const fn = (child.firstName != null && child.firstName !== '') ? child.firstName : '';
    const ln = (child.lastName != null && child.lastName !== '') ? child.lastName : '';
    const parts = (child.fullName || '').trim().split(/\s+/);
    const firstName = fn || (parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '');
    const lastName = ln || (parts.length > 1 ? parts.pop() : '');
    const rawSchool = String(child.school || '').trim();
    setSchoolIsOtherMode(rawSchool.length > 0 && !CHILD_SCHOOL_PRESETS.includes(rawSchool));
    setChildFormData({
      firstName,
      lastName,
      dob: formatDateForInput(child.dob),
      age: child.age || '',
      sex: child.sex || '',
      school: child.school || '',
      grade: child.grade || '',
      class: child.class || '',
      barangay: child.barangay || '',
      guardianPhone: child.guardianPhone || '',
      messenger: child.messenger || '',
      patientId: child.patientId || '',
      priority: child.priority || 'P2',
      notes: child.notes || ''
    });
    setIsEditingChild(true);
    setError('');
  };

  const handleChildFormChange = (e) => {
    const { name, value, type } = e.target;
    if (name === 'patientId') {
      setChildFormData((prev) => ({ ...prev, patientId: normalizePatientIdInput(value) }));
      return;
    }
    const next =
      (type === 'text' || type === 'textarea') && name !== 'notes'
        ? String(value).toUpperCase()
        : value;
    setChildFormData(prev => ({ ...prev, [name]: next }));
  };

  const handleGeneratePatientId = async () => {
    try {
      const all = await getAllChildren();
      const used = new Set(
        all
          .filter((c) => c.childId !== childId)
          .map((c) => (c.patientId || '').trim())
          .filter((p) => /^\d{6}$/.test(p))
      );
      setChildFormData((prev) => ({ ...prev, patientId: generateUniquePatientId(used) }));
    } catch (err) {
      notifyError(err?.message || 'Could not generate Patient ID');
    }
  };

  const handleSchoolSelectChange = (e) => {
    const v = e.target.value;
    if (v === CHILD_SCHOOL_UI_OTHER) {
      setSchoolIsOtherMode(true);
      setChildFormData((prev) => ({ ...prev, school: '' }));
    } else if (v) {
      setSchoolIsOtherMode(false);
      setChildFormData((prev) => ({ ...prev, school: v }));
    } else {
      setSchoolIsOtherMode(false);
      setChildFormData((prev) => ({ ...prev, school: '' }));
    }
  };

  const handleSaveChild = async (e) => {
    e.preventDefault();
    setError('');
    setSavingChild(true);

    try {
      const schoolTrim = (childFormData.school || '').trim();
      if (!schoolTrim) {
        notifyError('School is required.');
        setSavingChild(false);
        return;
      }

      const pidRaw = (childFormData.patientId || '').trim();
      let patientIdOut = null;
      if (pidRaw !== '') {
        if (!isValidPatientId(pidRaw)) {
          notifyError('Patient ID must be exactly 6 digits.');
          setSavingChild(false);
          return;
        }
        const allKids = await getAllChildren();
        if (
          allKids.some(
            (c) => c.childId !== childId && (c.patientId || '').trim() === pidRaw
          )
        ) {
          notifyError('Patient ID already in use.');
          setSavingChild(false);
          return;
        }
        patientIdOut = pidRaw;
      }

      const username = localStorage.getItem('username') || 'unknown';
      const now = new Date().toISOString();
      
      // When DOB is set, store age as null so age is always computed from DOB (updates over time)
      const firstName = (childFormData.firstName || '').trim();
      const lastName = (childFormData.lastName || '').trim();
      const fullName = [firstName, lastName].filter(Boolean).join(' ');
      const updatedChild = {
        ...child,
        fullName,
        firstName: firstName || null,
        lastName: lastName || null,
        dob: childFormData.dob || null,
        age: childFormData.dob ? null : (childFormData.age ? parseInt(childFormData.age) : null),
        sex: childFormData.sex,
        patientId: patientIdOut,
        school: schoolTrim,
        grade: childFormData.grade.trim() || null,
        class: (childFormData.class || '').trim() || null,
        barangay: childFormData.barangay.trim(),
        guardianPhone: childFormData.guardianPhone.trim() || null,
        messenger: (childFormData.messenger || '').trim() || null,
        priority: childFormData.priority || 'P2',
        notes: childFormData.notes.trim() || null,
        updatedBy: username,
        updatedAt: now
      };

      await upsertChild(updatedChild);
      await addToOutbox('UPSERT_CHILD', childId, updatedChild);

      // Try to sync if online
      if (navigator.onLine && token) {
        try {
          await performSync(token);
        } catch (syncError) {
          console.error('Sync failed:', syncError);
        }
      }

      setChild(updatedChild);
      setIsEditingChild(false);
      notifySuccess('Patient updated.');
    } catch (err) {
      setError(err.message);
      notifyError(err?.message || 'Failed to update patient');
    } finally {
      setSavingChild(false);
    }
  };

  // ===== CHILD DELETE HANDLERS =====
  const handleDeleteChild = async () => {
    setDeletingChild(true);
    setError('');

    try {
      await deleteChild(childId);
      await addToOutbox('DELETE_CHILD', childId, { childId });

      // Try to sync if online
      if (navigator.onLine && token) {
        try {
          await performSync(token);
        } catch (syncError) {
          console.error('Sync failed:', syncError);
        }
      }

      navigate('/children');
    } catch (err) {
      setError(err.message);
      setDeletingChild(false);
    }
  };

  // ===== VISIT DELETE HANDLERS =====
  const handleDeleteVisit = async () => {
    setDeletingVisit(true);
    setError('');

    try {
      await deleteVisit(deleteVisitId);
      await addToOutbox('DELETE_VISIT', deleteVisitId, { visitId: deleteVisitId });

      // Try to sync if online
      if (navigator.onLine && token) {
        try {
          await performSync(token);
        } catch (syncError) {
          console.error('Sync failed:', syncError);
        }
      }

      await loadData();
      setDeleteVisitId(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingVisit(false);
    }
  };

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Loading...</div>
        <NavBar />
      </div>
    );
  }

  if (!child) {
    return (
      <div className="container">
        <div className="empty-state">Child not found</div>
        <NavBar />
      </div>
    );
  }

  const schoolTrimForSelect = String(childFormData.school || '').trim();
  const schoolSelectDisplayValue = CHILD_SCHOOL_PRESETS.includes(schoolTrimForSelect)
    ? schoolTrimForSelect
    : schoolIsOtherMode
      ? CHILD_SCHOOL_UI_OTHER
      : '';

  return (
    <div className="container">
      <PageHeader
        title={formatChildDisplayName(child)}
        secondaryTitle={child.patientId ? `ID ${child.patientId}` : 'ID —'}
        subtitle={`${child.school} • ${child.barangay}`}
        icon="profile"
      />

      {error && <div className="alert alert-danger">{error}</div>}

      {/* ===== CHILD INFORMATION CARD ===== */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', margin: 0 }}>Child Information</h2>
          {!isEditingChild && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setContactModalOpen(true)}
                style={{
                  padding: '8px 16px',
                  fontSize: '14px',
                  background: '#eff6ff',
                  color: '#2563eb',
                  border: '1px solid #93c5fd',
                  borderRadius: '20px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                Contact
              </button>
              <button 
                onClick={startEditingChild} 
                style={{ 
                  padding: '8px 16px', 
                  fontSize: '14px',
                  background: '#f3f4f6',
                  color: '#6b7280',
                  border: '1px solid #d1d5db',
                  borderRadius: '20px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                Edit
              </button>
              <button 
                onClick={() => setShowDeleteChildConfirm(true)} 
                style={{ 
                  padding: '8px 16px', 
                  fontSize: '14px',
                  background: 'rgba(249, 115, 22, 0.15)',
                  color: '#f97316',
                  border: '1px solid #f97316',
                  borderRadius: '20px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>

        {isEditingChild ? (
          <form onSubmit={handleSaveChild}>
            <div className="form-group">
              <label>First Name *</label>
              <input
                type="text"
                name="firstName"
                value={childFormData.firstName}
                onChange={handleChildFormChange}
                required
              />
            </div>
            <div className="form-group">
              <label>Last Name *</label>
              <input
                type="text"
                name="lastName"
                value={childFormData.lastName}
                onChange={handleChildFormChange}
                required
              />
            </div>

            <div className="form-group">
              <label>Patient ID (6 digits)</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  inputMode="numeric"
                  name="patientId"
                  autoComplete="off"
                  value={childFormData.patientId}
                  onChange={handleChildFormChange}
                  placeholder="000000 (optional for legacy)"
                  maxLength={6}
                  style={{ flex: '1 1 140px', minWidth: 0 }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void handleGeneratePatientId()}
                  style={{ flexShrink: 0 }}
                >
                  Generate
                </button>
              </div>
              <p style={{ margin: '8px 0 0', fontSize: '12px', color: 'var(--color-muted)' }}>
                Leave blank only if this record has no ID yet; must be unique when set.
              </p>
            </div>

            <div className="form-group">
              <label>Date of Birth</label>
              <DateInput
                name="dob"
                value={childFormData.dob}
                onChange={handleChildFormChange}
                placeholder="Select date"
                showTodayButton={false}
                yearEnd={new Date().getFullYear()}
                yearStart={new Date().getFullYear() - 50}
              />
            </div>

            {childFormData.dob ? (
              <div className="form-group">
                <label>Age (from Date of Birth)</label>
                <p style={{ margin: 0, color: '#555' }}>
                  {getAgeFromDOB(childFormData.dob) != null ? `${getAgeFromDOB(childFormData.dob)} years` : '—'}
                </p>
              </div>
            ) : (
              <div className="form-group">
                <label>Age (if Date of Birth unknown)</label>
                <input
                  type="number"
                  name="age"
                  value={childFormData.age}
                  onChange={handleChildFormChange}
                  min="0"
                  max="18"
                />
              </div>
            )}

            <div className="form-group">
              <label>Sex *</label>
              <select name="sex" value={childFormData.sex} onChange={handleChildFormChange} required>
                <option value="" disabled>Select Sex</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            </div>

            <div className="form-group">
              <label>School *</label>
              <select value={schoolSelectDisplayValue} onChange={handleSchoolSelectChange} required>
                <option value="" disabled>
                  Select school
                </option>
                {CHILD_SCHOOL_PRESETS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
                <option value={CHILD_SCHOOL_UI_OTHER}>Others</option>
              </select>
              {schoolIsOtherMode ? (
                <input
                  type="text"
                  name="school"
                  value={childFormData.school}
                  onChange={handleChildFormChange}
                  placeholder="School name"
                  required
                  style={{ marginTop: '10px' }}
                />
              ) : null}
            </div>

            <div className="form-group">
              <label>Grade</label>
              <select name="grade" value={childFormData.grade} onChange={handleChildFormChange}>
                <option value="">Select Grade</option>
                <option value="Kindergarten">Kindergarten</option>
                <option value="1st Grade">1st Grade</option>
                <option value="2nd Grade">2nd Grade</option>
                <option value="3rd Grade">3rd Grade</option>
                <option value="4th Grade">4th Grade</option>
                <option value="5th Grade">5th Grade</option>
                <option value="6th Grade">6th Grade</option>
                <option value="SPED Kinder/Prep">SPED Kinder/Prep</option>
                <option value="SPED I">SPED I</option>
                <option value="SPED II">SPED II</option>
                <option value="SPED III">SPED III</option>
                <option value="SPED IV">SPED IV</option>
                <option value="SPED V">SPED V</option>
                <option value="SPED VI">SPED VI</option>
              </select>
            </div>

            <div className="form-group">
              <label>Class</label>
              <input
                type="text"
                name="class"
                value={childFormData.class}
                onChange={handleChildFormChange}
              />
            </div>

            <div className="form-group">
              <label>Barangay *</label>
              <input
                type="text"
                name="barangay"
                value={childFormData.barangay}
                onChange={handleChildFormChange}
                required
              />
            </div>

            <div className="form-group">
              <label>Guardian Phone</label>
              <input
                type="tel"
                name="guardianPhone"
                value={childFormData.guardianPhone}
                onChange={handleChildFormChange}
                placeholder="09123456789"
              />
            </div>

            <div className="form-group">
              <label>Messenger</label>
              <input
                type="text"
                name="messenger"
                value={childFormData.messenger}
                onChange={handleChildFormChange}
              />
            </div>

            <div className="form-group">
              <label>Priority</label>
              <select name="priority" value={childFormData.priority} onChange={handleChildFormChange}>
                <option value="P0">P0</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
              </select>
            </div>

            <div className="form-group">
              <label>Notes (optional)</label>
              <textarea
                name="notes"
                value={childFormData.notes}
                onChange={handleChildFormChange}
                rows="3"
                placeholder="Any notes about this child..."
              />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                type="submit" 
                className="btn btn-primary"
                disabled={savingChild}
                style={{ flex: 1 }}
              >
                {savingChild ? 'Saving...' : 'Save Changes'}
              </button>
              <button 
                type="button" 
                className="btn btn-secondary"
                onClick={() => {
                  setSchoolIsOtherMode(false);
                  setIsEditingChild(false);
                }}
                style={{ flex: 1 }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', marginBottom: '10px' }}>
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
            <p style={{ fontSize: '14px', color: 'var(--color-muted)', margin: '0 0 12px' }}>
              {child.school} • {child.grade || '—'} • {child.class || '—'}
            </p>
            <button
              type="button"
              onClick={() => setChildDetailsOpen((v) => !v)}
              aria-expanded={childDetailsOpen}
              style={{
                width: '100%',
                padding: '12px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#f2f2f7',
                border: '1px solid #e5e5ea',
                borderRadius: '10px',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '14px',
                color: '#111827',
                marginBottom: childDetailsOpen ? '12px' : 0
              }}
            >
              <span>Details</span>
              <span aria-hidden style={{ fontSize: '12px', color: 'var(--color-muted)' }}>{childDetailsOpen ? '▾' : '▸'}</span>
            </button>
            {childDetailsOpen && (
              <div>
                <div style={{ marginBottom: '14px' }}>
                  <PatientNameBlock child={child} nameTag="div" />
                </div>
                <p><strong>Sex:</strong> {child.sex}</p>
                {child.dob && <p><strong>Date of Birth:</strong> {formatDate(child.dob)}</p>}
                {(getAgeFromDOB(child.dob) != null || child.age != null) && (
                  <p><strong>Age:</strong> {getAgeFromDOB(child.dob) ?? child.age} years</p>
                )}
                <p><strong>School:</strong> {child.school}</p>
                {child.grade && <p><strong>Grade:</strong> {child.grade}</p>}
                {child.class && <p><strong>Class:</strong> {child.class}</p>}
                <p><strong>Barangay:</strong> {child.barangay}</p>
                {child.guardianPhone && <p><strong>Guardian Phone:</strong> {child.guardianPhone}</p>}
                {child.messenger && (
                  <p>
                    <strong>Messenger:</strong>{' '}
                    <span style={{ wordBreak: 'break-word' }}>{child.messenger}</span>
                  </p>
                )}
                {child.notes && (
                  <p><strong>Notes:</strong>{' '}<span style={{ whiteSpace: 'pre-wrap', color: '#555' }}>{child.notes}</span></p>
                )}
                {child.createdBy && (
                  <p style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #eee', fontSize: '12px', color: '#666' }}>
                    <strong>Registered by:</strong> {child.createdBy}
                    {child.updatedBy && child.updatedBy !== child.createdBy && (
                      <span> • <strong>Last updated by:</strong> {child.updatedBy}</span>
                    )}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {/* Consent: always visible, directly under child info (not inside collapsible Details) */}
        <div
          style={{
            marginTop: '20px',
            paddingTop: '16px',
            borderTop: '1px solid #e5e5ea'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h2 style={{ fontSize: '18px', margin: 0 }}>Consent Status</h2>
            <button type="button" className="btn btn-secondary" onClick={openConsentEditor}>
              Edit
            </button>
          </div>

          <div style={{ fontSize: '14px', color: '#111827' }}>
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>General consent received</div>
              <div style={{ color: 'var(--color-muted)' }}>
                {child?.consentGeneralReceivedAt ? formatDate(child.consentGeneralReceivedAt) : '—'}
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 700, marginBottom: '6px' }}>Specific consent</div>
              {Array.isArray(child?.consentSpecific) && child.consentSpecific.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {child.consentSpecific.map((e, idx) => (
                    <div key={idx} style={{ padding: '10px 12px', border: '1px solid #e5e5ea', borderRadius: '12px' }}>
                      <div style={{ fontWeight: 650 }}>{e?.procedure || '—'}</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginTop: '2px' }}>
                        {e?.date ? formatDate(e.date) : '—'}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: 'var(--color-muted)' }}>—</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ===== CONSENT EDITOR MODAL ===== */}
      {showConsentEditor && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '16px'
        }}>
          <div className="card" style={{ maxWidth: '560px', width: '100%' }}>
            <h3 style={{ marginTop: 0, marginBottom: '12px' }}>Edit Consent</h3>

            <div className="form-group">
              <label>General consent received (date)</label>
              <input
                type="date"
                value={consentGeneralDate}
                onChange={(e) => setConsentGeneralDate(e.target.value)}
              />
            </div>

            <div style={{ marginTop: '12px' }}>
              <div style={{ fontWeight: 700, marginBottom: '8px' }}>Specific consent</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {consentSpecific.map((row, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 80px', gap: '8px', alignItems: 'end' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-muted)', marginBottom: '6px' }}>Procedure</label>
                      <input
                        type="text"
                        value={row.procedure}
                        onChange={(e) => {
                          const next = [...consentSpecific];
                          next[idx] = { ...next[idx], procedure: e.target.value };
                          setConsentSpecific(next);
                        }}
                        placeholder="e.g. Extraction"
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-muted)', marginBottom: '6px' }}>Date</label>
                      <input
                        type="date"
                        value={row.date}
                        onChange={(e) => {
                          const next = [...consentSpecific];
                          next[idx] = { ...next[idx], date: e.target.value };
                          setConsentSpecific(next);
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn"
                      style={{ background: '#e5e7eb' }}
                      onClick={() => setConsentSpecific(consentSpecific.filter((_, i) => i !== idx))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginTop: '12px', width: '100%' }}
                onClick={() => setConsentSpecific([...consentSpecific, { procedure: '', date: '' }])}
              >
                + Add specific consent
              </button>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={() => setShowConsentEditor(false)}
                disabled={savingChild}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={saveConsent}
                disabled={savingChild}
              >
                {savingChild ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== DELETE CHILD CONFIRMATION MODAL ===== */}
      {showDeleteChildConfirm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div className="card" style={{ maxWidth: '400px', width: '100%' }}>
            <h3 style={{ color: 'var(--color-accent)', marginBottom: '16px', fontSize: '18px' }}>Delete Child?</h3>
            <p style={{ marginBottom: '8px', fontSize: '16px' }}>
              Are you sure you want to delete <strong>{formatChildDisplayName(child)}</strong>?
            </p>
            <p style={{ marginBottom: '16px', color: 'var(--color-accent)', fontSize: '16px' }}>
              This will also delete all {visits.length} visit record(s) for this child. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                onClick={handleDeleteChild}
                disabled={deletingChild}
                style={{ 
                  flex: 1,
                  padding: '12px',
                  fontSize: '16px',
                  background: 'var(--color-accent)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 'var(--radius-btn)',
                  cursor: 'pointer',
                  fontWeight: '600'
                }}
              >
                {deletingChild ? 'Deleting...' : 'Yes, Delete'}
              </button>
              <button 
                onClick={() => setShowDeleteChildConfirm(false)}
                className="btn btn-secondary"
                style={{ flex: 1, fontSize: '16px' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== VISIT HISTORY CARD ===== */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '8px', flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '18px', margin: 0 }}>Visit History</h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate(`/children/${childId}/appointment`, { state: { returnTo: `/children/${childId}` } })}
            >
              Appointment
            </button>
            <Link to={`/children/${childId}/visit-entry`} className="btn btn-primary">
              Add Visit
            </Link>
          </div>
        </div>

        <VisitToothMap toothStates={child?.toothStates} />

        {visits.length === 0 ? (
          <div className="empty-state">
            <p>No visits recorded yet</p>
          </div>
        ) : (
          <div className="timeline">
            {visits.map(visit => (
              <div key={visit.visitId} className="timeline-item" style={{ position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div className="timeline-date">
                    {formatDate(visit.date)}
                    {visit.createdBy && (
                      <span style={{ marginLeft: '8px', fontSize: '11px', color: '#666' }}>
                        by {visit.createdBy}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <Link
                      to={`/children/${childId}/visit-entry/${visit.visitId}`}
                      style={{ 
                        padding: '4px 10px', 
                        fontSize: '11px',
                        background: '#f3f4f6',
                        border: '1px solid #d1d5db',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        color: '#6b7280',
                        fontWeight: '500',
                        textDecoration: 'none',
                        display: 'inline-block'
                      }}
                    >
                      Edit
                    </Link>
                    <button 
                      type="button"
                      onClick={() => setDeleteVisitId(visit.visitId)}
                      style={{ 
                        padding: '4px 10px', 
                        fontSize: '11px',
                        background: 'rgba(249, 115, 22, 0.15)',
                        border: '1px solid #f97316',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        color: '#f97316',
                        fontWeight: '500'
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                
                {(visit.painFlag || visit.swellingFlag) && (
                  <div style={{ marginTop: '8px' }}>
                    {visit.painFlag && <span className="flag-badge pain">Pain</span>}
                    {visit.swellingFlag && <span className="flag-badge swelling">Swelling</span>}
                  </div>
                )}

                <VisitHistoryEntryDetail visit={visit} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== DELETE VISIT CONFIRMATION MODAL ===== */}
      {deleteVisitId && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div className="card" style={{ maxWidth: '400px', width: '100%' }}>
            <h3 style={{ color: 'var(--color-accent)', marginBottom: '16px', fontSize: '18px' }}>Delete Visit?</h3>
            <p style={{ marginBottom: '16px', fontSize: '16px' }}>
              Are you sure you want to delete this visit record? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                onClick={handleDeleteVisit}
                disabled={deletingVisit}
                style={{ 
                  flex: 1,
                  padding: '12px',
                  fontSize: '16px',
                  background: 'var(--color-accent)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 'var(--radius-btn)',
                  cursor: 'pointer',
                  fontWeight: '600'
                }}
              >
                {deletingVisit ? 'Deleting...' : 'Yes, Delete'}
              </button>
              <button 
                onClick={() => setDeleteVisitId(null)}
                className="btn btn-secondary"
                style={{ flex: 1, fontSize: '16px' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {contactModalOpen && (
        <PatientContactModal
          child={child}
          onClose={() => setContactModalOpen(false)}
          getSmsBody={(c) => `Regarding ${formatChildDisplayName(c)}.`}
        />
      )}

      <NavBar />
    </div>
  );
};

export default ChildProfile;
