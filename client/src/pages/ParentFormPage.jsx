import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import { PARENT_FORM_FIELD_GROUPS } from '../constants/parentFormFields';

const GRADE_OPTIONS = [
  '',
  'Kindergarten',
  'Grade 1',
  'Grade 2',
  'Grade 3',
  'Grade 4',
  'Grade 5',
  'Grade 6',
  'Graduated',
  'Teacher'
];

const GENDER_OPTIONS = [
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
  { value: 'Other', label: 'Other' }
];

const MEDICAL_ALLERGY_PRESETS = ['None known', 'Penicillin', 'Shellfish', 'Latex'];
const MEDICAL_HISTORY_PRESETS = ['G6PD', 'Hospitalization', 'Blue Baby', 'Asthma'];

const inputStyle = {
  width: '100%',
  padding: 10,
  borderRadius: 10,
  border: '1px solid #e5e7eb',
  fontSize: 15,
  boxSizing: 'border-box'
};

const sectionStyle = {
  border: '1px solid #e5e7eb',
  borderRadius: 14,
  padding: 14,
  marginBottom: 16,
  background: '#fff'
};

const quickInputButtonStyle = {
  border: '1px solid #d1d5db',
  background: '#f9fafb',
  borderRadius: 999,
  padding: '7px 10px',
  fontSize: 13,
  fontWeight: 650,
  cursor: 'pointer',
  color: '#374151'
};

export default function ParentFormPage() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState(null);
  const [form, setForm] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const fieldsMap = meta?.fields && typeof meta.fields === 'object' ? meta.fields : {};

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE_URL}/parent-form/${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || data.ok === false) {
          setError(data.error || 'This link is not valid.');
          setMeta(null);
          return;
        }
        setMeta(data);
        setForm({ ...(data.initial || {}) });
      } catch (e) {
        if (!cancelled) setError('Could not load the form. Check your connection.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const enabledKeys = useMemo(() => Object.keys(fieldsMap).filter((k) => fieldsMap[k]), [fieldsMap]);

  const setField = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  const appendField = (name, value, separator = '\n') => {
    setForm((prev) => {
      const cur = String(prev[name] || '').trim();
      return { ...prev, [name]: cur ? `${cur}${separator}${value}` : value };
    });
  };

  const quickInputs = (field, values, separator) => (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
        Quick Input
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {values.map((value) => (
          <button
            key={value}
            type="button"
            style={quickInputButtonStyle}
            onClick={() => appendField(field, value, separator)}
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  );

  const renderField = (fieldId) => {
    switch (fieldId) {
      case 'sex':
        return (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Gender</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {GENDER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setField('sex', opt.value)}
                  style={{
                    flex: '1 1 96px',
                    padding: '10px 8px',
                    borderRadius: 10,
                    border: form.sex === opt.value ? '2px solid #2563eb' : '1px solid #e5e7eb',
                    background: form.sex === opt.value ? '#eff6ff' : '#fff',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        );
      case 'dob':
        return (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Date of Birth</label>
            <input type="date" value={form.dob ?? ''} onChange={(e) => setField('dob', e.target.value)} style={inputStyle} />
          </div>
        );
      case 'age':
        return (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Age (if Date of Birth unknown)</label>
            <input
              type="number"
              min="0"
              value={form.age ?? ''}
              onChange={(e) => setField('age', e.target.value)}
              style={inputStyle}
              disabled={Boolean(form.dob)}
            />
          </div>
        );
      case 'school':
        return (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>School</label>
            <input type="text" value={form.school ?? ''} onChange={(e) => setField('school', e.target.value)} style={inputStyle} />
          </div>
        );
      case 'grade':
        return (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Grade</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {GRADE_OPTIONS.filter(Boolean).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setField('grade', g)}
                  style={{
                    flex: '1 1 110px',
                    padding: '10px 8px',
                    borderRadius: 10,
                    border: form.grade === g ? '2px solid #2563eb' : '1px solid #e5e7eb',
                    background: form.grade === g ? '#eff6ff' : '#fff',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        );
      case 'class':
        return (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Class</label>
            <input type="text" value={form.class ?? ''} onChange={(e) => setField('class', e.target.value)} style={inputStyle} />
          </div>
        );
      case 'notes':
        return (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Notes</label>
            <textarea value={form.notes ?? ''} onChange={(e) => setField('notes', e.target.value)} rows={3} style={inputStyle} />
          </div>
        );
      case 'guardianName':
        return (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Guardian Name</label>
            <input type="text" value={form.guardianName ?? ''} onChange={(e) => setField('guardianName', e.target.value)} style={inputStyle} />
          </div>
        );
      case 'relationship':
        return (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Relationship</label>
            <input type="text" value={form.relationship ?? ''} onChange={(e) => setField('relationship', e.target.value)} style={inputStyle} placeholder="e.g. Mother" />
          </div>
        );
      case 'guardianPhone':
        return (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Phone</label>
            <input type="tel" value={form.guardianPhone ?? ''} onChange={(e) => setField('guardianPhone', e.target.value)} style={inputStyle} />
          </div>
        );
      case 'messenger':
        return (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Messenger</label>
            <input type="text" value={form.messenger ?? ''} onChange={(e) => setField('messenger', e.target.value)} style={inputStyle} />
          </div>
        );
      case 'address':
        return (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Address</label>
            <textarea value={form.address ?? ''} onChange={(e) => setField('address', e.target.value)} rows={2} style={inputStyle} />
          </div>
        );
      case 'allergy':
        return (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Allergy</label>
            <textarea
              value={form.allergy ?? ''}
              onChange={(e) => setField('allergy', e.target.value)}
              rows={2}
              style={inputStyle}
              placeholder="List known allergies, or write None."
            />
            {quickInputs('allergy', MEDICAL_ALLERGY_PRESETS, ', ')}
          </div>
        );
      case 'medicalHistory':
        return (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Medical History</label>
            <textarea value={form.medicalHistory ?? ''} onChange={(e) => setField('medicalHistory', e.target.value)} rows={3} style={inputStyle} />
            {quickInputs('medicalHistory', MEDICAL_HISTORY_PRESETS, '\n')}
          </div>
        );
      default:
        return null;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/parent-form/${encodeURIComponent(token)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        setError(data.error || 'Submission failed.');
        return;
      }
      setDone(true);
    } catch (err) {
      setError('Submission failed. Check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <p style={{ color: '#6b7280' }}>Loading…</p>
      </div>
    );
  }

  if (error && !meta) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: '20px', marginBottom: 12 }}>Form unavailable</h1>
          <p style={{ color: '#4b5563', lineHeight: 1.5 }}>{error}</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: '20px', marginBottom: 12 }}>Thank you</h1>
          <p style={{ color: '#4b5563', lineHeight: 1.5 }}>Your responses have been saved. This link is now closed.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', padding: '24px 16px 48px' }}>
      <div
        style={{
          maxWidth: 520,
          margin: '0 auto',
          background: '#fff',
          borderRadius: 16,
          padding: 24,
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)'
        }}
      >
        <h1 style={{ fontSize: '22px', margin: '0 0 8px', color: '#111827' }}>
          {meta?.mode === 'create' ? 'Patient registration' : 'Information update'}
        </h1>
        <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: 15 }}>
          Patient: <strong style={{ color: '#111827' }}>{meta?.childName || 'Patient'}</strong>
        </p>

        {error ? (
          <div
            style={{
              marginBottom: 16,
              padding: 12,
              borderRadius: 10,
              background: 'rgba(239,68,68,0.1)',
              color: '#b91c1c',
              fontSize: 14
            }}
          >
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit}>
          {PARENT_FORM_FIELD_GROUPS.map((group) => {
            const enabledFields = group.fields.filter((field) => fieldsMap[field.id]);
            if (enabledFields.length === 0) return null;
            return (
              <section key={group.id} style={sectionStyle}>
                <h2 style={{ margin: '0 0 12px', fontSize: 17, color: '#111827' }}>{group.title}</h2>
                {enabledFields.map((field) => (
                  <div key={field.id}>{renderField(field.id)}</div>
                ))}
              </section>
            );
          })}

          {enabledKeys.length === 0 ? (
            <p style={{ color: '#6b7280' }}>No fields were enabled for this form.</p>
          ) : (
            <button
              type="submit"
              disabled={submitting}
              style={{
                width: '100%',
                marginTop: 8,
                padding: 14,
                borderRadius: 12,
                border: 'none',
                background: '#2563eb',
                color: '#fff',
                fontWeight: 700,
                fontSize: 16,
                cursor: submitting ? 'wait' : 'pointer'
              }}
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
