import { useState, useEffect } from 'react';
import {
  CHILD_SCHOOL_PRESETS,
  CHILD_SCHOOL_UI_OTHER,
  CHILD_SCHOOL_GROUPS
} from '../constants/childSchools';
import EditableChipList from '../components/EditableChipList';
import { Link, useNavigate } from 'react-router-dom';
import NavBar from '../components/NavBar';
import PageHeader from '../components/PageHeader';
import DateInput from '../components/DateInput';
import { PatientNameBlock } from '../components/PatientNameBlock';
import { upsertChild, addToOutbox, checkDuplicates, performSync, getAllChildren } from '../db/indexedDB';
import { getAgeFromDOB } from '../utils/age';
import { notifyError, notifySuccess } from '../utils/notify';
import { generateUniquePatientId, isValidPatientId, normalizePatientIdInput } from '../utils/patientId';

const MEDICAL_ALLERGY_PRESETS = ['None known', 'Penicillin', 'Shellfish', 'Latex'];
const MEDICAL_HISTORY_PRESETS = ['G6PD', 'Hospitalization', 'Blue Baby', 'Asthma'];
const GRADE_OPTIONS = ['Kindergarten', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Graduated', 'Teacher'];

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

const RegisterNewChild = ({ token }) => {
  const navigate = useNavigate();
  const [schoolIsOtherMode, setSchoolIsOtherMode] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    dob: '',
    age: '',
    sex: '',
    school: '',
    grade: '',
    class: '',
    guardianName: '',
    relationship: '',
    guardianPhone: '',
    messenger: '',
    address: '',
    priority: 'P2',
    notes: '',
    patientId: '',
    medicalCondition: {
      allergy: '',
      spedCategory: '',
      spedOtherDetail: '',
      medicalHistory: '',
      behaviourFrankl: '',
      otherNotes: ''
    }
  });
  const [duplicates, setDuplicates] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isTeacher = formData.grade === 'Teacher';

  // Check for duplicates
  useEffect(() => {
    const checkDups = async () => {
      const hasName = (formData.firstName || formData.lastName || '').trim();
      if (hasName && formData.school && (formData.dob || formData.age)) {
        const ageFromDob = formData.dob ? getAgeFromDOB(formData.dob) : null;
        const fullName = [formData.firstName, formData.lastName].filter(Boolean).join(' ').trim();
        const childData = {
          ...formData,
          fullName,
          dob: formData.dob || null,
          age: formData.dob ? ageFromDob : (formData.age ? parseInt(formData.age) : null)
        };
        const dups = await checkDuplicates(childData);
        setDuplicates(dups);
      } else {
        setDuplicates([]);
      }
    };
    checkDups();
  }, [formData.firstName, formData.lastName, formData.school, formData.dob, formData.age]);

  const handleChange = (e) => {
    const { name, value, type } = e.target;
    if (name === 'patientId') {
      setFormData((prev) => ({ ...prev, patientId: normalizePatientIdInput(value) }));
      return;
    }
    const next = (type === 'text' || type === 'textarea') && name !== 'notes' ? String(value).toUpperCase() : value;
    setFormData((prev) => ({ ...prev, [name]: next }));
  };

  const handleMedicalChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      medicalCondition: { ...prev.medicalCondition, [field]: value }
    }));
  };

  const handleGeneratePatientId = async () => {
    try {
      const all = await getAllChildren();
      const used = new Set(
        all.map((c) => (c.patientId || '').trim()).filter((p) => /^\d{6}$/.test(p))
      );
      setFormData((prev) => ({ ...prev, patientId: generateUniquePatientId(used) }));
    } catch (err) {
      notifyError(err?.message || 'Could not generate Patient ID');
    }
  };

  const handleSchoolSelectChange = (e) => {
    const v = e.target.value;
    if (v === CHILD_SCHOOL_UI_OTHER) {
      setSchoolIsOtherMode(true);
      setFormData((prev) => ({ ...prev, school: '' }));
    } else if (v) {
      setSchoolIsOtherMode(false);
      setFormData((prev) => ({ ...prev, school: v }));
    } else {
      setSchoolIsOtherMode(false);
      setFormData((prev) => ({ ...prev, school: '' }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const schoolTrim = (formData.school || '').trim();
      if (!schoolTrim) {
        notifyError('School is required.');
        setSaving(false);
        return;
      }

      const patientIdTrim = (formData.patientId || '').trim();
      if (!isValidPatientId(patientIdTrim)) {
        notifyError('Patient ID must be exactly 6 digits.');
        setSaving(false);
        return;
      }
      const existingChildren = await getAllChildren();
      if (
        existingChildren.some((c) => (c.patientId || '').trim() === patientIdTrim)
      ) {
        notifyError('Patient ID already in use. Choose another or generate.');
        setSaving(false);
        return;
      }

      const childId = `child-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const username = localStorage.getItem('username') || 'unknown';
      const firstName = (formData.firstName || '').trim();
      const lastName = (formData.lastName || '').trim();
      const fullName = [firstName, lastName].filter(Boolean).join(' ');
      const isTeacherRecord = formData.grade === 'Teacher';
      const childData = {
        childId,
        fullName,
        firstName: firstName || null,
        lastName: lastName || null,
        dob: formData.dob || null,
        age: formData.dob ? null : (formData.age ? parseInt(formData.age) : null),
        sex: formData.sex,
        patientId: patientIdTrim,
        school: schoolTrim,
        grade: formData.grade.trim() || null,
        class: formData.class.trim() || null,
        barangay: '',
        guardianName: isTeacherRecord ? null : (formData.guardianName.trim() || null),
        relationship: isTeacherRecord ? null : (formData.relationship.trim() || null),
        guardianPhone: formData.guardianPhone.trim() || null,
        messenger: formData.messenger.trim() || null,
        address: formData.address.trim() || null,
        priority: formData.priority || 'P2',
        notes: formData.notes.trim() || null,
        createdBy: username,
        updatedBy: username,
        createdAt: now,
        updatedAt: now
      };

      const rawMc = formData.medicalCondition || {};
      const bf =
        rawMc.behaviourFrankl !== '' && rawMc.behaviourFrankl != null
          ? parseInt(String(rawMc.behaviourFrankl), 10)
          : null;
      const sped = String(rawMc.spedCategory || '').trim().toLowerCase();
      childData.medicalCondition = {
        allergy: (rawMc.allergy || '').trim() || null,
        spedCategory: ['deaf', 'autism', 'others'].includes(sped) ? sped : null,
        spedOtherDetail: (rawMc.spedOtherDetail || '').trim() || null,
        medicalHistory: (rawMc.medicalHistory || '').trim() || null,
        behaviourFrankl: Number.isFinite(bf) && bf >= 1 && bf <= 4 ? bf : null,
        otherNotes: (rawMc.otherNotes || '').trim() || null
      };

      await upsertChild(childData);
      await addToOutbox('UPSERT_CHILD', childId, childData);

      if (navigator.onLine && token) {
        try {
          await performSync(token);
        } catch (syncError) {
          console.error('Sync failed, but child saved locally:', syncError);
        }
      }

      notifySuccess('Patient registered.');
      navigate(`/children/${childId}`);
    } catch (err) {
      setError(err.message);
      notifyError(err?.message || 'Failed to register patient');
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (date) => {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const year = d.getFullYear();
    return `${month}/${day}/${year}`;
  };

  return (
    <div className="container">
      <PageHeader title="Register New Patient" subtitle="Add a new patient to the system" icon="children" />

      <div style={{ marginBottom: '16px' }}>
        <Link
          to="/children"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            color: 'var(--color-primary)',
            textDecoration: 'none',
            fontSize: '15px',
            fontWeight: '500'
          }}
        >
          ← Back to Patients
        </Link>
      </div>

      {duplicates.length > 0 && (
        <div className="alert alert-warning">
          <strong>⚠️ Possible Duplicate Detected:</strong>
          <ul style={{ marginTop: '8px', marginLeft: '20px' }}>
            {duplicates.map(dup => (
              <li key={dup.childId} style={{ marginBottom: '10px' }}>
                <PatientNameBlock child={dup} nameTag="div" />
                <div style={{ fontSize: '13px', color: 'var(--color-muted)', marginTop: '4px' }}>
                  {dup.school}
                  {dup.dob && ` · DOB ${formatDate(dup.dob)}`}
                  {(getAgeFromDOB(dup.dob) != null || dup.age != null) &&
                    ` · Age ${getAgeFromDOB(dup.dob) ?? dup.age} years`}
                </div>
              </li>
            ))}
          </ul>
          <p style={{ marginTop: '8px' }}>Please verify this is not a duplicate before proceeding.</p>
        </div>
      )}

      {error && <div className="alert alert-danger">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="card">
          <section style={formSectionStyle}>
            <h3 style={formSectionTitleStyle}>Basics</h3>
          <div className="form-group">
            <label>First Name *</label>
            <input
              type="text"
              name="firstName"
              value={formData.firstName}
              onChange={handleChange}
              required
            />
          </div>
          <div className="form-group">
            <label>Last Name *</label>
            <input
              type="text"
              name="lastName"
              value={formData.lastName}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group">
            <label>Patient ID * (6 digits)</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch', flexWrap: 'wrap' }}>
              <input
                type="text"
                inputMode="numeric"
                name="patientId"
                autoComplete="off"
                value={formData.patientId}
                onChange={handleChange}
                placeholder="000000"
                maxLength={6}
                required
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
              Enter a unique 6-digit ID or tap Generate to pick one not already in use.
            </p>
          </div>

          <div className="form-group">
            <label>Date of Birth (optional)</label>
            <DateInput
              name="dob"
              value={formData.dob}
              onChange={handleChange}
              placeholder="Select date"
              showTodayButton={false}
              yearEnd={new Date().getFullYear()}
              yearStart={new Date().getFullYear() - 50}
            />
          </div>

          {formData.dob ? (
            <div className="form-group">
              <label>Age (from Date of Birth)</label>
              <p style={{ margin: 0, color: '#555' }}>
                {getAgeFromDOB(formData.dob) != null ? `${getAgeFromDOB(formData.dob)} years` : '—'}
              </p>
            </div>
          ) : (
            <div className="form-group">
              <label>Age (if Date of Birth unknown)</label>
              <input
                type="number"
                name="age"
                value={formData.age}
                onChange={handleChange}
                min="0"
              />
            </div>
          )}

          <div className="form-group">
            <label>Gender *</label>
            <select name="sex" value={formData.sex} onChange={handleChange} required>
              <option value="" disabled>Select Gender</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
            </select>
          </div>

          <div className="form-group">
            <label>School *</label>
            <select
              value={
                CHILD_SCHOOL_PRESETS.includes(String(formData.school || '').trim())
                  ? String(formData.school || '').trim()
                  : schoolIsOtherMode
                    ? CHILD_SCHOOL_UI_OTHER
                    : ''
              }
              onChange={handleSchoolSelectChange}
              required
            >
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
                value={formData.school}
                onChange={handleChange}
                placeholder="School name"
                required
                style={{ marginTop: '10px' }}
              />
            ) : null}
          </div>

          <div className="form-group">
            <label>Grade</label>
            <select name="grade" value={formData.grade} onChange={handleChange}>
              <option value="" disabled>Select grade</option>
              {GRADE_OPTIONS.map((grade) => (
                <option key={grade} value={grade}>{grade}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Class</label>
            <input
              type="text"
              name="class"
              value={formData.class}
              onChange={handleChange}
              placeholder="e.g. A"
            />
          </div>
          </section>

          <section style={formSectionStyle}>
            <h3 style={formSectionTitleStyle}>Contact</h3>
            {!isTeacher && (
              <>
                <div className="form-group">
                  <label>Guardian Name</label>
                  <input
                    type="text"
                    name="guardianName"
                    value={formData.guardianName}
                    onChange={handleChange}
                  />
                </div>
                <div className="form-group">
                  <label>Relationship</label>
                  <input
                    type="text"
                    name="relationship"
                    value={formData.relationship}
                    onChange={handleChange}
                    placeholder="e.g. Mother"
                  />
                </div>
              </>
            )}
            <div className="form-group">
              <label>{isTeacher ? 'Phone' : 'Phone'}</label>
              <input
                type="tel"
                name="guardianPhone"
                value={formData.guardianPhone}
                onChange={handleChange}
                placeholder="09123456789"
              />
            </div>

            <div className="form-group">
              <label>Messenger</label>
              <input
                type="text"
                name="messenger"
                value={formData.messenger}
                onChange={handleChange}
                placeholder="Optional"
              />
            </div>

            <div className="form-group">
              <label>Address</label>
              <textarea
                name="address"
                value={formData.address}
                onChange={handleChange}
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
                value={formData.medicalCondition?.allergy ?? ''}
                onChange={(e) => handleMedicalChange('allergy', e.target.value)}
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
                    const cur = (formData.medicalCondition?.allergy ?? '').trim();
                    handleMedicalChange('allergy', cur ? `${cur}, ${name}` : name);
                  }}
                />
              </div>
            </div>
            <div className="form-group">
              <label>Medical History</label>
              <textarea
                rows={2}
                value={formData.medicalCondition?.medicalHistory ?? ''}
                onChange={(e) => handleMedicalChange('medicalHistory', e.target.value)}
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
                    const cur = (formData.medicalCondition?.medicalHistory ?? '').trim();
                    handleMedicalChange('medicalHistory', cur ? `${cur}\n${name}` : name);
                  }}
                />
              </div>
            </div>
            <div className="form-group">
              <label>Behavior (Frankl scale)</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => handleMedicalChange('behaviourFrankl', String(n))}
                    style={{
                      flex: '1 1 64px',
                      padding: '10px 8px',
                      borderRadius: 10,
                      border:
                        String(formData.medicalCondition?.behaviourFrankl) === String(n)
                          ? '2px solid #2563eb'
                          : '1px solid #e5e7eb',
                      background:
                        String(formData.medicalCondition?.behaviourFrankl) === String(n) ? '#eff6ff' : '#fff',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    {n}
                  </button>
                ))}
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flex: '1 1 80px' }}
                  onClick={() => handleMedicalChange('behaviourFrankl', '')}
                >
                  Clear
                </button>
              </div>
            </div>
          </section>

          <div className="form-group">
            <label>Notes (optional)</label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows="3"
              placeholder="Any notes about this patient..."
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Register Patient'}
          </button>
        </div>
      </form>

      <NavBar />
    </div>
  );
};

export default RegisterNewChild;
