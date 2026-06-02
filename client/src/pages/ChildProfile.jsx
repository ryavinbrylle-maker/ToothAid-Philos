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
  getAppointmentsByChild,
  upsertChild, 
  deleteChild, 
  deleteVisit, 
  addToOutbox, 
  performSync 
} from '../db/indexedDB';
import { countMissedAppointments } from '../utils/appointmentStatus';
import { getAgeFromDOB } from '../utils/age';
import { formatChildDisplayName } from '../utils/displayName';
import { notifyError, notifySuccess } from '../utils/notify';
import {
  CHILD_SCHOOL_PRESETS,
  CHILD_SCHOOL_UI_OTHER,
  CHILD_SCHOOL_GROUPS
} from '../constants/childSchools';
import { API_BASE_URL } from '../config';
import { PARENT_FORM_FIELD_DEFS, PARENT_FORM_FIELD_GROUPS } from '../constants/parentFormFields';
import EditableChipList from '../components/EditableChipList';
import { getFollowUpTimingLabel, visitRequiresFollowUp } from '../utils/followUpTiming';
import { TREATMENT_OPTIONS } from '../utils/treatmentTypes';

const MEDICAL_ALLERGY_PRESETS = ['None known', 'Penicillin', 'Shellfish', 'Latex'];
const MEDICAL_HISTORY_PRESETS = ['G6PD', 'Hospitalization', 'Blue Baby', 'Asthma'];
const CONSENT_PROCEDURE_OPTIONS = TREATMENT_OPTIONS.map((option) => option.label);
const GRADE_OPTIONS = ['Kindergarten', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Graduated', 'Teacher'];
const GENDER_OPTIONS = [
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
  { value: 'Other', label: 'Other' }
];

const formSectionStyle = {
  border: '1px solid #e5e7eb',
  borderRadius: 14,
  padding: 16,
  marginBottom: 16,
  background: '#fff'
};

const formSectionTitleStyle = {
  margin: '0 0 14px',
  fontSize: '17px',
  fontWeight: 800,
  color: '#111827'
};
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

const BEHAVIOUR_BADGE_COLORS = {
  1: { bg: '#fee2e2', color: '#991b1b', border: '#fecaca' },
  2: { bg: '#ffedd5', color: '#9a3412', border: '#fed7aa' },
  3: { bg: '#fef9c3', color: '#854d0e', border: '#fde68a' },
  4: { bg: '#dcfce7', color: '#166534', border: '#bbf7d0' }
};

const BehaviourBadge = ({ value }) => {
  const n = Number(value);
  const style = BEHAVIOUR_BADGE_COLORS[n];
  if (!style) return null;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: 999,
        border: `1px solid ${style.border}`,
        background: style.bg,
        color: style.color,
        fontSize: 12,
        fontWeight: 800,
        lineHeight: 1.4
      }}
    >
      F{n}
    </span>
  );
};

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
      {(chiefText || visit.behaviourFrankl != null) && (
        <p style={{ margin: '0 0 10px', fontSize: '14px', lineHeight: 1.45, color: '#374151' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong>Chief complaint: </strong>
            <BehaviourBadge value={visit.behaviourFrankl} />
          </span>{' '}
          <span style={{ color: '#4b5563', fontWeight: 400 }}>{chiefText || '—'}</span>
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
  const [missedAppointmentCount, setMissedAppointmentCount] = useState(0);
  const [activeFollowUpLabel, setActiveFollowUpLabel] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Edit child state
  const [isEditingChild, setIsEditingChild] = useState(false);
  const [childFormData, setChildFormData] = useState({});
  const [savingChild, setSavingChild] = useState(false);

  // Consent editor
  const [showConsentEditor, setShowConsentEditor] = useState(false);
  const [consentGeneralDate, setConsentGeneralDate] = useState(''); // yyyy-mm-dd
  const [consentSpecific, setConsentSpecific] = useState([]); // [{ procedure, date }]
  const [consentSpecificDate, setConsentSpecificDate] = useState('');
  
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
  /** True when school is not a preset, including empty field after picking Others. */
  const [schoolIsOtherMode, setSchoolIsOtherMode] = useState(false);
  const [showSendFormModal, setShowSendFormModal] = useState(false);
  const [sendFormFields, setSendFormFields] = useState(() =>
    Object.fromEntries(PARENT_FORM_FIELD_DEFS.map((f) => [f.id, true]))
  );
  const [generatedFormUrl, setGeneratedFormUrl] = useState('');
  const [generatedFormCopied, setGeneratedFormCopied] = useState(false);
  const [generatingFormUrl, setGeneratingFormUrl] = useState(false);

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
    const [visitsData, appointments] = await Promise.all([
      getVisitsByChild(childId),
      getAppointmentsByChild(childId)
    ]);

    setChild(childData);
    setMissedAppointmentCount(countMissedAppointments(appointments));
    const sortedVisits = visitsData.sort((a, b) => {
        const atA = a?.createdAt ? new Date(a.createdAt).getTime() : NaN;
        const atB = b?.createdAt ? new Date(b.createdAt).getTime() : NaN;
        if (Number.isFinite(atA) && Number.isFinite(atB) && atA !== atB) return atB - atA;
        if (Number.isFinite(atA) && !Number.isFinite(atB)) return -1;
        if (!Number.isFinite(atA) && Number.isFinite(atB)) return 1;
        const dA = a?.date ? new Date(a.date).getTime() : NaN;
        const dB = b?.date ? new Date(b.date).getTime() : NaN;
        if (Number.isFinite(dA) && Number.isFinite(dB) && dA !== dB) return dB - dA;
        return String(b?.visitId || '').localeCompare(String(a?.visitId || ''));
      });
    setVisits(sortedVisits);
    const latestFollowUpVisit = sortedVisits.find((v) => visitRequiresFollowUp(v));
    setActiveFollowUpLabel(
      latestFollowUpVisit ? getFollowUpTimingLabel(latestFollowUpVisit.followUpPriority) : null
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

  const emptyMedicalForm = () => ({
    allergy: '',
    spedCategory: '',
    spedOtherDetail: '',
    medicalHistory: '',
    weight: '',
    otherNotes: ''
  });

  const openConsentEditor = () => {
    const general = formatDateForInput(child?.consentGeneralReceivedAt);
    const specific = Array.isArray(child?.consentSpecific) ? child.consentSpecific : [];
    setConsentGeneralDate(general);
    setConsentSpecificDate(formatDateForInput(specific.find((e) => e?.date)?.date) || '');
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

  const specificConsentActiveMap = Object.fromEntries(
    (consentSpecific || [])
      .map((row) => String(row?.procedure || '').trim())
      .filter(Boolean)
      .map((procedure) => [procedure, true])
  );

  const toggleSpecificConsentProcedure = (procedure) => {
    const label = String(procedure || '').trim();
    if (!label) return;
    setConsentSpecific((prev) => {
      const exists = prev.some((row) => String(row?.procedure || '').trim() === label);
      if (exists) return prev.filter((row) => String(row?.procedure || '').trim() !== label);
      return [...prev, { procedure: label, date: consentSpecificDate || '' }];
    });
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
          .filter(e => (e.procedure || '').trim())
          .map(e => ({
            procedure: (e.procedure || '').trim(),
            date: consentSpecificDate ? new Date(consentSpecificDate).toISOString() : null
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
    const mc =
      child.medicalCondition != null && typeof child.medicalCondition === 'object' && !Array.isArray(child.medicalCondition)
        ? child.medicalCondition
        : {};
    setChildFormData({
      firstName,
      lastName,
      dob: formatDateForInput(child.dob),
      age: child.age || '',
      sex: child.sex || '',
      school: child.school || '',
      grade: child.grade || '',
      class: child.class || '',
      guardianName: child.guardianName || '',
      relationship: child.relationship || '',
      guardianPhone: child.guardianPhone || '',
      messenger: child.messenger || '',
      address: child.address || '',
      patientId: child.patientId || '',
      priority: child.priority || 'P2',
      notes: child.notes || '',
      medicalCondition: {
        allergy: mc.allergy != null ? String(mc.allergy) : '',
        spedCategory: mc.spedCategory != null ? String(mc.spedCategory) : '',
        spedOtherDetail: mc.spedOtherDetail != null ? String(mc.spedOtherDetail) : '',
        medicalHistory: mc.medicalHistory != null ? String(mc.medicalHistory) : '',
        weight: mc.weight != null ? String(mc.weight) : '',
        otherNotes: mc.otherNotes != null ? String(mc.otherNotes) : ''
      }
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
    setChildFormData((prev) => ({ ...prev, [name]: next }));
  };

  const handleMedicalFormChange = (field, value) => {
    setChildFormData((prev) => ({
      ...prev,
      medicalCondition: { ...(prev.medicalCondition || emptyMedicalForm()), [field]: value }
    }));
  };

  const createParentFormLink = async () => {
    const fields = Object.fromEntries(
      PARENT_FORM_FIELD_DEFS.map((f) => [f.id, Boolean(sendFormFields[f.id])])
    );
    if (!Object.values(fields).some(Boolean)) {
      notifyError('Select at least one field.');
      return;
    }
    setGeneratingFormUrl(true);
    setGeneratedFormUrl('');
    setGeneratedFormCopied(false);
    try {
      const res = await fetch(`${API_BASE_URL}/parent-form`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ childId, fields })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notifyError(data.error || 'Could not create link.');
        return;
      }
      const url = `${window.location.origin}/parent-form/${data.token}`;
      setGeneratedFormUrl(url);
      notifySuccess('Link created. Copy and send it to the guardian.');
    } catch (e) {
      notifyError('Could not create link. Are you online?');
    } finally {
      setGeneratingFormUrl(false);
    }
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
      if (!childFormData.sex) {
        notifyError('Gender is required.');
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
      const isTeacherRecord = childFormData.grade === 'Teacher';
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
        barangay: '',
        guardianName: isTeacherRecord ? null : ((childFormData.guardianName || '').trim() || null),
        relationship: isTeacherRecord ? null : ((childFormData.relationship || '').trim() || null),
        guardianPhone: childFormData.guardianPhone.trim() || null,
        messenger: (childFormData.messenger || '').trim() || null,
        address: (childFormData.address || '').trim() || null,
        priority: childFormData.priority || 'P2',
        notes: childFormData.notes.trim() || null,
        updatedBy: username,
        updatedAt: now
      };

      const rawMc = childFormData.medicalCondition || {};
      const sped = String(rawMc.spedCategory || '').trim().toLowerCase();
      updatedChild.medicalCondition = {
        allergy: (rawMc.allergy || '').trim() || null,
        spedCategory: ['deaf', 'autism', 'others'].includes(sped) ? sped : null,
        spedOtherDetail: (rawMc.spedOtherDetail || '').trim() || null,
        medicalHistory: (rawMc.medicalHistory || '').trim() || null,
        weight: (rawMc.weight || '').trim() || null,
        otherNotes: (rawMc.otherNotes || '').trim() || null
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
        <div className="empty-state">Patient not found</div>
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
        subtitle={`${child.school}${child.grade ? ` · ${child.grade}` : ''}`}
        icon="profile"
      />

      {error && <div className="alert alert-danger">{error}</div>}

      {/* ===== CHILD INFORMATION CARD ===== */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', margin: 0 }}>Patient Information</h2>
          {!isEditingChild && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => {
                  setShowSendFormModal(true);
                  setGeneratedFormUrl('');
                  setGeneratedFormCopied(false);
                }}
                style={{
                  padding: '8px 16px',
                  fontSize: '14px',
                  background: '#ecfdf5',
                  color: '#047857',
                  border: '1px solid #6ee7b7',
                  borderRadius: '20px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                Send a form
              </button>
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
            <section style={formSectionStyle}>
              <h3 style={formSectionTitleStyle}>Basics</h3>
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
                />
              </div>
            )}

            <div className="form-group">
              <label>Gender *</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {GENDER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setChildFormData((prev) => ({ ...prev, sex: opt.value }))}
                    style={{
                      flex: '1 1 96px',
                      padding: '10px 8px',
                      borderRadius: 10,
                      border: childFormData.sex === opt.value ? '2px solid #2563eb' : '1px solid #e5e7eb',
                      background: childFormData.sex === opt.value ? '#eff6ff' : '#fff',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>School *</label>
              <select value={schoolSelectDisplayValue} onChange={handleSchoolSelectChange} required>
                <option value="" disabled>
                  Select school
                </option>
                {CHILD_SCHOOL_GROUPS.map((g) => (
                  <optgroup key={g.district} label={g.district}>
                    {g.schools.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value={CHILD_SCHOOL_UI_OTHER}>Other (specify)</option>
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
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {GRADE_OPTIONS.map((grade) => (
                  <button
                    key={grade}
                    type="button"
                    onClick={() => setChildFormData((prev) => ({ ...prev, grade }))}
                    style={{
                      flex: '1 1 110px',
                      padding: '10px 8px',
                      borderRadius: 10,
                      border: childFormData.grade === grade ? '2px solid #2563eb' : '1px solid #e5e7eb',
                      background: childFormData.grade === grade ? '#eff6ff' : '#fff',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    {grade}
                  </button>
                ))}
              </div>
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
            </section>

            <section style={formSectionStyle}>
              <h3 style={formSectionTitleStyle}>Contact</h3>
              {childFormData.grade !== 'Teacher' && (
                <>
                  <div className="form-group">
                    <label>Guardian Name</label>
                    <input
                      type="text"
                      name="guardianName"
                      value={childFormData.guardianName || ''}
                      onChange={handleChildFormChange}
                    />
                  </div>
                  <div className="form-group">
                    <label>Relationship</label>
                    <input
                      type="text"
                      name="relationship"
                      value={childFormData.relationship || ''}
                      onChange={handleChildFormChange}
                      placeholder="e.g. Mother"
                    />
                  </div>
                </>
              )}
              <div className="form-group">
                <label>Phone</label>
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
                <label>Address</label>
                <textarea
                  name="address"
                  value={childFormData.address || ''}
                  onChange={handleChildFormChange}
                  rows={2}
                />
              </div>
            </section>

            <section style={formSectionStyle}>
              <h3 style={formSectionTitleStyle}>Medical</h3>
              <div className="form-group">
                <label>Allergy</label>
                <textarea
                  rows={2}
                  value={childFormData.medicalCondition?.allergy ?? ''}
                  onChange={(e) => handleMedicalFormChange('allergy', e.target.value)}
                  placeholder="Food or drug allergies, or “None”."
                />
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: 6 }}>
                    Quick phrases (tap to insert; long-press to edit shortcuts)
                  </div>
                  <EditableChipList
                    storageKey="toothaid_presets_medical_allergy"
                    defaultList={MEDICAL_ALLERGY_PRESETS}
                    mode="apply"
                    onApply={(name) => {
                      const cur = (childFormData.medicalCondition?.allergy ?? '').trim();
                      handleMedicalFormChange('allergy', cur ? `${cur}, ${name}` : name);
                    }}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Medical History</label>
                <textarea
                  rows={2}
                  value={childFormData.medicalCondition?.medicalHistory ?? ''}
                  onChange={(e) => handleMedicalFormChange('medicalHistory', e.target.value)}
                />
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: 6 }}>
                    Quick phrases (tap to append line; long-press to edit shortcuts)
                  </div>
                  <EditableChipList
                    storageKey="toothaid_presets_medical_history"
                    defaultList={MEDICAL_HISTORY_PRESETS}
                    mode="apply"
                    onApply={(name) => {
                      const cur = (childFormData.medicalCondition?.medicalHistory ?? '').trim();
                      handleMedicalFormChange('medicalHistory', cur ? `${cur}\n${name}` : name);
                    }}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Weight</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={childFormData.medicalCondition?.weight ?? ''}
                    onChange={(e) => handleMedicalFormChange('weight', e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <span style={{ color: 'var(--color-muted)', fontWeight: 700 }}>klbs</span>
                </div>
              </div>
            </section>

            <div className="form-group">
              <label>Notes (optional)</label>
              <textarea
                name="notes"
                value={childFormData.notes}
                onChange={handleChildFormChange}
                rows="3"
                placeholder="Any notes about this patient..."
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
            <div style={{ marginBottom: '10px' }}>
              <PatientNameBlock child={child} nameTag="h3" />
            </div>
            <p style={{ fontSize: '14px', color: 'var(--color-muted)', margin: '0 0 4px' }}>
              {child.school} • {child.grade || '—'} • {child.class || '—'}
            </p>
            <p style={{ fontSize: '14px', color: 'var(--color-muted)', margin: '0 0 4px' }}>
              <strong style={{ color: '#374151' }}>Missed appointments:</strong> {missedAppointmentCount}
            </p>
            <p style={{ fontSize: '14px', color: 'var(--color-muted)', margin: '0 0 12px' }}>
              <strong style={{ color: '#374151' }}>Follow-up timing:</strong>{' '}
              {activeFollowUpLabel || '—'}
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
                <p><strong>Gender:</strong> {child.sex}</p>
                {child.dob && <p><strong>Date of Birth:</strong> {formatDate(child.dob)}</p>}
                {(getAgeFromDOB(child.dob) != null || child.age != null) && (
                  <p><strong>Age:</strong> {getAgeFromDOB(child.dob) ?? child.age} years</p>
                )}
                <p><strong>School:</strong> {child.school}</p>
                {child.grade && <p><strong>Grade:</strong> {child.grade}</p>}
                {child.class && <p><strong>Class:</strong> {child.class}</p>}
                {child.grade !== 'Teacher' && child.guardianName && <p><strong>Guardian Name:</strong> {child.guardianName}</p>}
                {child.grade !== 'Teacher' && child.relationship && <p><strong>Relationship:</strong> {child.relationship}</p>}
                {child.guardianPhone && <p><strong>Phone:</strong> {child.guardianPhone}</p>}
                {child.messenger && (
                  <p>
                    <strong>Messenger:</strong>{' '}
                    <span style={{ wordBreak: 'break-word' }}>{child.messenger}</span>
                  </p>
                )}
                {child.address && (
                  <p><strong>Address:</strong>{' '}<span style={{ whiteSpace: 'pre-wrap', color: '#555' }}>{child.address}</span></p>
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
              <div className="form-group">
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-muted)', marginBottom: '6px' }}>Date</label>
                <input
                  type="date"
                  value={consentSpecificDate}
                  onChange={(e) => setConsentSpecificDate(e.target.value)}
                />
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginBottom: 6 }}>
                Procedure (select one or more; long-press to edit shortcuts)
              </div>
              <EditableChipList
                storageKey="toothaid_presets_consent_procedures"
                defaultList={CONSENT_PROCEDURE_OPTIONS}
                mode="toggle"
                activeMap={specificConsentActiveMap}
                onToggle={toggleSpecificConsentProcedure}
              />
              {consentSpecific.length > 0 ? (
                <div style={{ fontSize: '12px', color: '#4b5563', marginTop: 10 }}>
                  Selected: {consentSpecific.map((row) => row.procedure).join(', ')}
                </div>
              ) : null}
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
            <h3 style={{ color: 'var(--color-accent)', marginBottom: '16px', fontSize: '18px' }}>Delete Patient?</h3>
            <p style={{ marginBottom: '8px', fontSize: '16px' }}>
              Are you sure you want to delete <strong>{formatChildDisplayName(child)}</strong>?
            </p>
            <p style={{ marginBottom: '16px', color: 'var(--color-accent)', fontSize: '16px' }}>
              This will also delete all {visits.length} visit record(s) for this patient. This action cannot be undone.
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

      {!isEditingChild ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: '18px', margin: '0 0 12px' }}>Condition</h2>

          <div
            style={{
              border: '2px solid #22c55e',
              borderRadius: 12,
              padding: 14,
              marginBottom: 16,
              background: 'rgba(34, 197, 94, 0.04)'
            }}
          >
            <h3 style={{ margin: '0 0 10px', fontSize: '15px', color: '#14532d' }}>Medical condition</h3>
            {(() => {
              const mc =
                child?.medicalCondition != null &&
                typeof child.medicalCondition === 'object' &&
                !Array.isArray(child.medicalCondition)
                  ? child.medicalCondition
                  : {};
              return (
                <div style={{ fontSize: '14px', color: '#374151', lineHeight: 1.5 }}>
                  <p style={{ margin: '4px 0' }}>
                    <strong>Allergy:</strong>{' '}
                    {mc.allergy != null && String(mc.allergy).trim() !== '' ? mc.allergy : '—'}
                  </p>
                  <p style={{ margin: '4px 0' }}>
                    <strong>Medical History:</strong>{' '}
                    <span style={{ whiteSpace: 'pre-wrap' }}>
                      {mc.medicalHistory != null && String(mc.medicalHistory).trim() !== '' ? mc.medicalHistory : '—'}
                    </span>
                  </p>
                  <p style={{ margin: '4px 0' }}>
                    <strong>Weight:</strong>{' '}
                    {mc.weight != null && String(mc.weight).trim() !== '' ? `${mc.weight} klbs` : '—'}
                  </p>
                </div>
              );
            })()}
          </div>

          <div style={{ marginBottom: 14 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '15px', color: '#374151' }}>Tooth map (current)</h3>
            <VisitToothMap toothStates={child?.toothStates} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '15px', color: '#374151' }}>DMFT (latest visit)</h3>
            {visits.length > 0 ? (
              (() => {
                const lv = visits[0];
                const D = lv.decayedTeeth;
                const M = lv.missingTeeth;
                const F = lv.filledTeeth;
                const dNum = D != null && D !== '' ? Number(D) : null;
                const mNum = M != null && M !== '' ? Number(M) : null;
                const fNum = F != null && F !== '' ? Number(F) : null;
                const hasAny = dNum != null || mNum != null || fNum != null;
                const total =
                  hasAny ? (Number(dNum ?? 0) + Number(mNum ?? 0) + Number(fNum ?? 0)).toString() : '—';
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: '14px' }}>
                    <div>
                      <span style={{ color: '#6b7280' }}>D (decayed):</span> {dNum != null ? dNum : '—'}
                    </div>
                    <div>
                      <span style={{ color: '#6b7280' }}>M (missing):</span> {mNum != null ? mNum : '—'}
                    </div>
                    <div>
                      <span style={{ color: '#6b7280' }}>F (filled):</span> {fNum != null ? fNum : '—'}
                    </div>
                    <div>
                      <span style={{ color: '#6b7280' }}>Total DMFT:</span> {total}
                    </div>
                  </div>
                );
              })()
            ) : (
              <p style={{ margin: 0, color: '#6b7280', fontSize: '14px' }}>
                No visits yet — DMFT appears after the first visit.
              </p>
            )}
          </div>

        </div>
      ) : null}

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

      {showSendFormModal && (
        <div
          style={{
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
            padding: 16
          }}
        >
          <div className="card" style={{ maxWidth: 520, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ marginTop: 0 }}>Send a form to parents</h3>
            <p style={{ fontSize: '14px', color: '#4b5563', lineHeight: 1.45 }}>
              Choose which fields appear on the public page. The link expires after one submission or after 24 hours.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
              {PARENT_FORM_FIELD_GROUPS.map((group) => (
                <section
                  key={group.id}
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: 12,
                    padding: 12,
                    background: '#f9fafb'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      marginBottom: 8
                    }}
                  >
                    <h4 style={{ margin: 0, fontSize: 15 }}>{group.title}</h4>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        const allSelected = group.fields.every((f) => sendFormFields[f.id]);
                        setSendFormFields((prev) => ({
                          ...prev,
                          ...Object.fromEntries(group.fields.map((f) => [f.id, !allSelected]))
                        }));
                      }}
                    >
                      {group.fields.every((f) => sendFormFields[f.id]) ? 'Clear' : 'Select all'}
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                    {group.fields.map((f) => (
                      <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '14px' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(sendFormFields[f.id])}
                          onChange={(e) =>
                            setSendFormFields((prev) => ({ ...prev, [f.id]: e.target.checked }))
                          }
                        />
                        {f.label}
                      </label>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', marginBottom: 10 }}
              disabled={generatingFormUrl}
              onClick={() => void createParentFormLink()}
            >
              {generatingFormUrl ? 'Creating…' : 'Generate link'}
            </button>
            {generatedFormUrl ? (
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: '13px', color: '#6b7280', marginBottom: 6 }}>URL</label>
                <input readOnly value={generatedFormUrl} style={{ width: '100%', fontSize: '13px' }} />
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ width: '100%', marginTop: 8 }}
                  onClick={async () => {
                    await navigator.clipboard.writeText(generatedFormUrl);
                    setGeneratedFormCopied(true);
                    window.setTimeout(() => setGeneratedFormCopied(false), 1800);
                  }}
                >
                  {generatedFormCopied ? 'Copied!' : 'Copy to clipboard'}
                </button>
              </div>
            ) : null}
            <button type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={() => setShowSendFormModal(false)}>
              Close
            </button>
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
