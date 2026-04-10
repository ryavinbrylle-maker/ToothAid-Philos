import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import NavBar from '../components/NavBar';
import PageHeader from '../components/PageHeader';
import { PatientNameBlock } from '../components/PatientNameBlock';
import { addToOutbox, addVisit, getChild, getVisit, performSync, updateVisit, upsertChild } from '../db/indexedDB';
import { notifyError, notifySuccess } from '../utils/notify';
import { toYmd, ymdToIsoUtc8 } from '../utils/dates';
import {
  CONDITIONS,
  permanentTeeth,
  primaryTeeth,
  PERMANENT_SET,
  PRIMARY_SET,
  isDarkHex,
  getPersistedToothCondition
} from '../utils/toothChart';

const PRESET_SYMPTOMS = ['Pain', 'Swelling', 'Bleeding', 'Sensitivity'];

const SYMPTOM_DAY_DEFAULT = 1;
const clampSymptomDays = (v) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return SYMPTOM_DAY_DEFAULT;
  return Math.min(365, Math.max(1, n));
};

const COMMON_TREATMENTS = ['Cleaning', 'Fluoride', 'Sealant', 'Filling', 'Extraction'];
const COMMON_MEDS = ['Amoxicillin', 'Ibuprofen', 'Paracetamol', 'Chlorhexidine', 'Metronidazole'];

const newExamination = () => ({
  id: crypto.randomUUID(),
  toothNumber: null,
  mapExpanded: true,
  condition: 'sound',
  note: '',
  treatments: [],
  treatmentInput: ''
});

const countConditions = (toothRecords) => {
  const records = toothRecords && typeof toothRecords === 'object' ? Object.values(toothRecords) : [];
  let decayed = 0;
  let missing = 0;
  let filled = 0;
  for (const r of records) {
    if (!r || typeof r !== 'object') continue;
    if (r.condition === 'decayed') decayed += 1;
    if (r.condition === 'missing') missing += 1;
    if (r.condition === 'filled') filled += 1;
  }
  return { decayed, missing, filled };
};

const buildToothRecords = (examinations) => {
  const toothRecords = {};
  for (const ex of examinations) {
    if (!ex.toothNumber) continue;
    toothRecords[ex.toothNumber] = {
      condition: ex.condition,
      note: ex.note || ''
    };
  }
  return toothRecords;
};

const examinationFromServerRow = (ex) => ({
  id: crypto.randomUUID(),
  toothNumber: ex.toothNumber ?? null,
  mapExpanded: !ex.toothNumber,
  condition: ex.condition || 'sound',
  note: ex.note != null ? String(ex.note) : '',
  treatments: Array.isArray(ex.treatments) ? [...ex.treatments] : [],
  treatmentInput: ''
});

const visitToExaminations = (visit) => {
  const exams = visit.toothExaminations;
  if (Array.isArray(exams) && exams.length > 0) {
    const rows = exams.filter((ex) => ex && typeof ex === 'object').map(examinationFromServerRow);
    if (rows.length > 0) return rows;
  }
  const recs = visit.toothRecords;
  if (recs && typeof recs === 'object' && !Array.isArray(recs) && Object.keys(recs).length > 0) {
    return Object.keys(recs)
      .sort()
      .map((toothNumber) =>
        examinationFromServerRow({
          toothNumber,
          condition: recs[toothNumber]?.condition,
          note: recs[toothNumber]?.note,
          treatments: []
        })
      );
  }
  return null;
};

const visitToSymptoms = (visit) => {
  const sym = visit.symptoms;
  if (sym && typeof sym === 'object' && Object.keys(sym).length > 0) {
    return Object.fromEntries(Object.entries(sym).map(([k, v]) => [k, clampSymptomDays(v)]));
  }
  const s = {};
  if (visit.painFlag) s.Pain = SYMPTOM_DAY_DEFAULT;
  if (visit.swellingFlag) s.Swelling = SYMPTOM_DAY_DEFAULT;
  return s;
};

const inferDentitionFromVisit = (visit) => {
  if (visit.dentition === 'PRIMARY' || visit.dentition === 'PERMANENT') return visit.dentition;
  const nums = [];
  const exams = visit.toothExaminations;
  if (Array.isArray(exams)) {
    for (const ex of exams) {
      if (ex?.toothNumber) nums.push(ex.toothNumber);
    }
  }
  const recs = visit.toothRecords;
  if (recs && typeof recs === 'object' && !Array.isArray(recs)) {
    nums.push(...Object.keys(recs));
  }
  for (const t of nums) {
    if (PRIMARY_SET.has(t)) return 'PRIMARY';
    if (PERMANENT_SET.has(t)) return 'PERMANENT';
  }
  return 'PERMANENT';
};

/** Same normalization as profile history, shaped for form state. */
const normalizeMedicationsForForm = (raw) => {
  if (raw == null) return [];
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return [];
    try {
      const p = JSON.parse(t);
      if (Array.isArray(p)) return normalizeMedicationsForForm(p);
    } catch (_) {
      return [{ name: t, dosage: '', frequencyPerDay: '', days: '' }];
    }
  }
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (item == null) return null;
        if (typeof item === 'string') {
          const n = item.trim();
          return n
            ? { name: n, dosage: '', frequencyPerDay: '', days: '' }
            : null;
        }
        if (typeof item === 'object') {
          return {
            name: item.name != null ? String(item.name) : '',
            dosage: item.dosage != null ? String(item.dosage) : '',
            frequencyPerDay:
              item.frequencyPerDay != null ? String(item.frequencyPerDay) : '',
            days: item.days != null ? String(item.days) : ''
          };
        }
        return null;
      })
      .filter((m) => m && (m.name || '').trim() !== '');
  }
  return [];
};

export default function AddVisit({ token }) {
  const { childId, visitId: editVisitIdParam } = useParams();
  const navigate = useNavigate();
  const isEditMode = Boolean(editVisitIdParam);
  const [child, setChild] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [visitLoadError, setVisitLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [date, setDate] = useState(() => toYmd(new Date()));

  const [symptoms, setSymptoms] = useState({});
  const [customSymptomOpen, setCustomSymptomOpen] = useState(false);
  const [customSymptomDraft, setCustomSymptomDraft] = useState('');

  const [chiefComplaint, setChiefComplaint] = useState('');

  const [visitNotes, setVisitNotes] = useState('');

  const [dentition, setDentition] = useState('PERMANENT');
  const [examinations, setExaminations] = useState(() => [newExamination()]);

  const [medications, setMedications] = useState([]);
  const [medDraft, setMedDraft] = useState({
    name: '',
    dosage: '',
    frequencyPerDay: '',
    days: ''
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setInitializing(true);
      setVisitLoadError('');
      setError('');
      const c = await getChild(childId);
      if (cancelled) return;
      if (!c) {
        setChild(null);
        setInitializing(false);
        setVisitLoadError('Patient not found.');
        return;
      }
      setChild(c);

      if (!editVisitIdParam) {
        setDate(toYmd(new Date()));
        setSymptoms({});
        setChiefComplaint('');
        setVisitNotes('');
        setDentition('PERMANENT');
        setExaminations([newExamination()]);
        setMedications([]);
        setMedDraft({ name: '', dosage: '', frequencyPerDay: '', days: '' });
        setInitializing(false);
        return;
      }

      const v = await getVisit(editVisitIdParam);
      if (cancelled) return;
      if (!v || v.childId !== childId) {
        setVisitLoadError('Visit not found.');
        setInitializing(false);
        return;
      }

      setDate(toYmd(v.date));
      setSymptoms(visitToSymptoms(v));
      setChiefComplaint(v.chiefComplaint != null ? String(v.chiefComplaint) : '');
      setVisitNotes(v.notes != null ? String(v.notes) : '');
      setDentition(inferDentitionFromVisit(v));
      const ex = visitToExaminations(v);
      setExaminations(ex && ex.length > 0 ? ex : [newExamination()]);
      setMedications(normalizeMedicationsForForm(v.medications));
      setMedDraft({ name: '', dosage: '', frequencyPerDay: '', days: '' });
      setInitializing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [childId, editVisitIdParam]);

  const toothGrid = useMemo(() => (dentition === 'PERMANENT' ? permanentTeeth : primaryTeeth), [dentition]);

  const customSymptomKeys = Object.keys(symptoms).filter((k) => !PRESET_SYMPTOMS.includes(k));

  const updateExam = (id, patch) => {
    setExaminations((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const setDentitionSafe = (next) => {
    if (next === dentition) return;
    const ok = window.confirm('Switching dentition will clear tooth examinations. Continue?');
    if (!ok) return;
    setDentition(next);
    setExaminations([newExamination()]);
  };

  const toggleSymptom = (name) => {
    setSymptoms((prev) => {
      const next = { ...prev };
      if (next[name] != null) delete next[name];
      else next[name] = SYMPTOM_DAY_DEFAULT;
      return next;
    });
  };

  const addCustomSymptom = () => {
    const raw = customSymptomDraft.trim();
    if (!raw) return;
    const name = raw.slice(0, 120);
    setSymptoms((prev) => {
      if (prev[name] != null) return prev;
      return { ...prev, [name]: SYMPTOM_DAY_DEFAULT };
    });
    setCustomSymptomDraft('');
    setCustomSymptomOpen(false);
  };

  const toggleExamTreatment = (examId, t) => {
    setExaminations((prev) =>
      prev.map((e) => {
        if (e.id !== examId) return e;
        const has = e.treatments.includes(t);
        return {
          ...e,
          treatments: has ? e.treatments.filter((x) => x !== t) : [...e.treatments, t]
        };
      })
    );
  };

  const addExamTreatmentManual = (examId) => {
    setExaminations((prev) =>
      prev.map((e) => {
        if (e.id !== examId) return e;
        const v = e.treatmentInput.trim();
        if (!v) return e;
        if (e.treatments.includes(v)) return { ...e, treatmentInput: '' };
        return { ...e, treatments: [...e.treatments, v], treatmentInput: '' };
      })
    );
  };

  const addAnotherExamination = () => {
    setExaminations((prev) => [...prev, newExamination()]);
  };

  const removeExamination = (id) => {
    setExaminations((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((e) => e.id !== id);
    });
  };

  const applyQuickMed = (name) => {
    setMedDraft((d) => ({ ...d, name }));
  };

  const addMedicationFromDraft = () => {
    const name = medDraft.name.trim();
    if (!name) {
      notifyError('Enter a medication name first.');
      return;
    }
    setMedications((prev) => [
      ...prev,
      {
        name,
        dosage: medDraft.dosage.trim() || null,
        frequencyPerDay: medDraft.frequencyPerDay.trim() || null,
        days: medDraft.days.trim() || null
      }
    ]);
    setMedDraft({ name: '', dosage: '', frequencyPerDay: '', days: '' });
  };

  const removeMedicationAt = (idx) => {
    setMedications((prev) => prev.filter((_, i) => i !== idx));
  };

  const submit = async () => {
    setError('');
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const username = localStorage.getItem('username') || 'unknown';

      const toothRecords = buildToothRecords(examinations);
      const counts = countConditions(toothRecords);
      const symptomsForSave = Object.fromEntries(
        Object.entries(symptoms).map(([k, v]) => [k, clampSymptomDays(v)])
      );
      const painFlag = symptomsForSave.Pain != null;
      const swellingFlag = symptomsForSave.Swelling != null;

      const allTreatments = [...new Set(examinations.flatMap((e) => e.treatments))];

      const toothExaminations = examinations.map((e) => ({
        toothNumber: e.toothNumber,
        condition: e.condition,
        note: e.note.trim() || null,
        treatments: e.treatments
      }));

      const medicationsListed = medications.map((m) => ({
        name: m.name,
        dosage: m.dosage,
        frequencyPerDay: m.frequencyPerDay,
        days: m.days
      }));
      const draftMedName = medDraft.name.trim();
      const medicationsForSave = [...medicationsListed];
      if (draftMedName) {
        const draftRow = {
          name: draftMedName,
          dosage: medDraft.dosage.trim() || null,
          frequencyPerDay: medDraft.frequencyPerDay.trim() || null,
          days: medDraft.days.trim() || null
        };
        const alreadyHave = medicationsListed.some(
          (m) =>
            (m.name || '').trim() === draftRow.name &&
            (m.dosage || '') === (draftRow.dosage || '') &&
            (m.frequencyPerDay || '') === (draftRow.frequencyPerDay || '') &&
            (m.days || '') === (draftRow.days || '')
        );
        if (!alreadyHave) medicationsForSave.push(draftRow);
      }

      const dateIso = ymdToIsoUtc8(date) || new Date(date).toISOString();
      const notesForSave = visitNotes.trim() || null;

      let visitData;
      if (isEditMode) {
        const existing = await getVisit(editVisitIdParam);
        if (!existing || existing.childId !== childId) {
          throw new Error('Visit not found');
        }
        visitData = {
          ...existing,
          visitId: existing.visitId,
          childId,
          date: dateIso,
          painFlag,
          swellingFlag,
          decayedTeeth: counts.decayed,
          missingTeeth: counts.missing,
          filledTeeth: counts.filled,
          chiefComplaint: chiefComplaint.trim() || null,
          symptoms: symptomsForSave,
          dentition,
          toothRecords,
          toothExaminations,
          treatments: allTreatments,
          treatmentTypes: [],
          medications: medicationsForSave,
          notes: notesForSave,
          createdBy: existing.createdBy || username,
          createdAt: existing.createdAt || now,
          updatedBy: username,
          updatedAt: now
        };
        await updateVisit(visitData);
        await addToOutbox('UPDATE_VISIT', visitData.visitId, visitData);
      } else {
        const visitId = `visit-${crypto.randomUUID()}`;
        visitData = {
          visitId,
          childId,
          date: dateIso,
          painFlag,
          swellingFlag,
          decayedTeeth: counts.decayed,
          missingTeeth: counts.missing,
          filledTeeth: counts.filled,
          chiefComplaint: chiefComplaint.trim() || null,
          symptoms: symptomsForSave,
          dentition,
          toothRecords,
          toothExaminations,
          treatments: allTreatments,
          treatmentTypes: [],
          medications: medicationsForSave,
          notes: notesForSave,
          createdBy: username,
          createdAt: now
        };
        await addVisit(visitData);
        await addToOutbox('ADD_VISIT', visitId, visitData);
      }

      const latestChild = await getChild(childId);
      if (latestChild && Object.keys(toothRecords).length > 0) {
        const prevTooth =
          latestChild.toothStates != null && typeof latestChild.toothStates === 'object'
            ? { ...latestChild.toothStates }
            : {};
        for (const [t, rec] of Object.entries(toothRecords)) {
          prevTooth[t] = { condition: rec.condition, updatedAt: now };
        }
        const childPatch = {
          ...latestChild,
          toothStates: prevTooth,
          updatedBy: username,
          updatedAt: now
        };
        await upsertChild(childPatch);
        await addToOutbox('UPSERT_CHILD', childId, childPatch);
      }

      if (navigator.onLine && token) {
        try {
          await performSync(token);
        } catch (syncError) {
          console.error('Sync failed, but visit saved locally:', syncError);
        }
      }

      notifySuccess(isEditMode ? 'Visit updated.' : 'Visit saved.');
      navigate(`/children/${childId}`, { state: { refreshVisits: true } });
    } catch (e) {
      setError(e.message || 'Failed to save visit');
      notifyError(e?.message || 'Failed to save visit');
    } finally {
      setSaving(false);
    }
  };

  if (visitLoadError) {
    return (
      <div className="container">
        <PageHeader
          title={isEditMode ? 'Edit Visit' : 'Visit Entry'}
          subtitle={child ? <PatientNameBlock child={child} /> : ''}
          icon="visit"
        />
        <div className="alert alert-danger" style={{ marginBottom: '12px' }}>
          {visitLoadError}
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => navigate(`/children/${childId}`)}>
          Back to profile
        </button>
        <NavBar />
      </div>
    );
  }

  if (!child || initializing) {
    return (
      <div className="container">
        <div className="loading">Loading...</div>
        <NavBar />
      </div>
    );
  }

  return (
    <div className="container" style={{ overflowX: 'hidden' }}>
      <PageHeader
        title={isEditMode ? 'Edit Visit' : 'Visit Entry'}
        subtitle={<PatientNameBlock child={child} />}
        icon="visit"
      />
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card" style={{ marginBottom: '12px' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>Date</label>
          <input className="form-control" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: '12px' }}>
        <h3 style={{ marginTop: 0, marginBottom: '10px' }}>Chief complaint</h3>

        <div className="form-group">
          <label>Symptoms (tap to toggle; duration = days)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px', alignItems: 'center' }}>
            {PRESET_SYMPTOMS.map((s) => {
              const active = symptoms[s] != null;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSymptom(s)}
                  className={`chip-toggle${active ? ' chip-toggle--active' : ''}`}
                >
                  {s}
                </button>
              );
            })}
            {customSymptomKeys.map((s) => {
              const active = symptoms[s] != null;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSymptom(s)}
                  className={`chip-toggle${active ? ' chip-toggle--active' : ''}`}
                >
                  {s}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setCustomSymptomOpen((v) => !v);
                setCustomSymptomDraft('');
              }}
              title="Add custom symptom"
              aria-label="Add custom symptom"
              className="chip-toggle chip-toggle--add"
            >
              +
            </button>
          </div>

          {customSymptomOpen && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
              <input
                type="text"
                className="form-control"
                value={customSymptomDraft}
                onChange={(e) => setCustomSymptomDraft(e.target.value)}
                placeholder="Custom symptom…"
                style={{ flex: '1 1 200px', minWidth: '160px', width: 'auto' }}
              />
              <button type="button" className="btn btn-primary btn-sm" onClick={addCustomSymptom}>
                Add
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setCustomSymptomOpen(false);
                  setCustomSymptomDraft('');
                }}
              >
                Cancel
              </button>
            </div>
          )}

          {Object.keys(symptoms).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {Object.entries(symptoms).map(([name, days]) => {
                const d = clampSymptomDays(days);
                return (
                  <div
                    key={name}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 120px',
                      gap: '10px',
                      alignItems: 'center'
                    }}
                  >
                    <div style={{ fontWeight: 650 }}>{name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <label style={{ fontSize: '12px', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>Days</label>
                      <input
                        type="number"
                        className="form-control"
                        min={1}
                        max={365}
                        value={d}
                        onChange={(e) =>
                          setSymptoms((prev) => ({ ...prev, [name]: clampSymptomDays(e.target.value) }))
                        }
                        style={{ minHeight: 44 }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>Chief complaint (free text)</label>
          <textarea
            className="form-control"
            value={chiefComplaint}
            onChange={(e) => setChiefComplaint(e.target.value)}
            rows={2}
            placeholder="Free text..."
          />
        </div>
      </div>

      <div className="card" style={{ marginBottom: '12px' }}>
        <h3 style={{ marginTop: 0, marginBottom: '10px' }}>Tooth examination</h3>

        {examinations.map((exam, examIdx) => {
          const otherUsed = new Set(
            examinations.filter((e) => e.id !== exam.id && e.toothNumber).map((e) => e.toothNumber)
          );
          return (
            <div
              key={exam.id}
              style={{
                marginTop: examIdx === 0 ? 0 : 16,
                paddingTop: examIdx === 0 ? 0 : 16,
                borderTop: examIdx === 0 ? 'none' : '1px solid #e5e5ea'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontWeight: 800 }}>Examination {examIdx + 1}</div>
                {examinations.length > 1 && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeExamination(exam.id)}>
                    Remove
                  </button>
                )}
              </div>

              {!exam.toothNumber || exam.mapExpanded ? (
                <div className="form-group">
                  <label>Select</label>
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setDentitionSafe('PERMANENT')}
                        className={`chip-toggle${dentition === 'PERMANENT' ? ' chip-toggle--active' : ''}`}
                        style={{ flex: 1 }}
                      >
                        Permanent
                      </button>
                      <button
                        type="button"
                        onClick={() => setDentitionSafe('PRIMARY')}
                        className={`chip-toggle${dentition === 'PRIMARY' ? ' chip-toggle--active' : ''}`}
                        style={{ flex: 1 }}
                      >
                        Primary
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px' }}>
                    {toothGrid.map((row, idx) => (
                      <div
                        key={idx}
                        style={{ display: 'grid', gridTemplateColumns: `repeat(${row.length}, 1fr)`, gap: '6px' }}
                      >
                        {row.map((tooth) => {
                          const usedHere = otherUsed.has(tooth);
                          const isSel = exam.toothNumber === tooth;
                          const persistedId = getPersistedToothCondition(child?.toothStates, tooth);
                          const condMeta =
                            CONDITIONS.find((c) => c.id === persistedId) || CONDITIONS[0];
                          const showStatusLabel = !usedHere && condMeta.id !== 'sound';
                          const bg = usedHere ? '#d1d5db' : condMeta.color;
                          const fg = usedHere ? '#6b7280' : isDarkHex(condMeta.color) ? '#fff' : '#111827';
                          return (
                            <button
                              key={tooth}
                              type="button"
                              disabled={usedHere}
                              onClick={() => {
                                if (usedHere) return;
                                if (exam.toothNumber === tooth) {
                                  updateExam(exam.id, { mapExpanded: false });
                                  return;
                                }
                                const persisted = getPersistedToothCondition(child?.toothStates, tooth);
                                updateExam(exam.id, {
                                  toothNumber: tooth,
                                  mapExpanded: false,
                                  condition: persisted,
                                  note: '',
                                  treatments: [],
                                  treatmentInput: ''
                                });
                              }}
                              style={{
                                padding: '8px 4px 6px',
                                borderRadius: '10px',
                                border: isSel ? '3px solid #111827' : '1px solid #e5e5ea',
                                boxSizing: 'border-box',
                                background: bg,
                                color: fg,
                                fontWeight: 800,
                                cursor: usedHere ? 'not-allowed' : 'pointer',
                                opacity: usedHere ? 0.55 : 1,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '2px',
                                minHeight: '52px',
                                lineHeight: 1.1
                              }}
                              title={
                                usedHere
                                  ? 'Already selected in another examination'
                                  : showStatusLabel
                                    ? `${tooth} · ${condMeta.label}`
                                    : `${tooth}`
                              }
                            >
                              <span style={{ fontSize: '0.95rem' }}>{tooth}</span>
                              <span
                                style={{
                                  fontSize: '0.62rem',
                                  fontWeight: 650,
                                  opacity: usedHere ? 0.85 : 0.92,
                                  textAlign: 'center',
                                  maxWidth: '100%',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {showStatusLabel ? condMeta.label : '\u00A0'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => updateExam(exam.id, { mapExpanded: true })}
                  className="chip-toggle"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    marginBottom: '12px',
                    fontWeight: 700
                  }}
                >
                  Tooth {exam.toothNumber} · Tap to change
                </button>
              )}

              {exam.toothNumber && !exam.mapExpanded && (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                    {CONDITIONS.map((c) => {
                      const active = exam.condition === c.id;
                      const fg = isDarkHex(c.color) ? '#fff' : '#111827';
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => updateExam(exam.id, { condition: c.id })}
                          className={active ? 'chip-toggle chip-toggle--active' : 'chip-toggle'}
                          style={
                            active
                              ? {
                                  background: c.color,
                                  color: fg,
                                  borderColor: c.color,
                                  fontWeight: 650
                                }
                              : undefined
                          }
                        >
                          {c.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="form-group">
                    <label>Tooth note (optional)</label>
                    <input
                      type="text"
                      className="form-control"
                      value={exam.note}
                      onChange={(e) => updateExam(exam.id, { note: e.target.value })}
                      placeholder="Optional..."
                    />
                  </div>

                  <div style={{ marginTop: '12px' }}>
                    <div style={{ fontWeight: 700, marginBottom: '8px' }}>Treatment</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                      {COMMON_TREATMENTS.map((t) => {
                        const active = exam.treatments.includes(t);
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => toggleExamTreatment(exam.id, t)}
                            className={`chip-toggle${active ? ' chip-toggle--active' : ''}`}
                          >
                            {t}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', alignItems: 'stretch' }}>
                      <input
                        type="text"
                        className="form-control"
                        value={exam.treatmentInput}
                        onChange={(e) => updateExam(exam.id, { treatmentInput: e.target.value })}
                        placeholder="Add treatment…"
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => addExamTreatmentManual(exam.id)}
                      >
                        Add
                      </button>
                    </div>
                    {exam.treatments.length > 0 && (
                      <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {exam.treatments.map((t) => (
                          <button
                            key={t}
                            type="button"
                            className="chip-toggle chip-toggle--active"
                            onClick={() => toggleExamTreatment(exam.id, t)}
                          >
                            {t} ×
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}

        <button
          type="button"
          className="btn btn-secondary"
          style={{ width: '100%', marginTop: '14px' }}
          onClick={addAnotherExamination}
        >
          Add another tooth examination
        </button>
      </div>

      <div className="card" style={{ marginBottom: '12px' }}>
        <h3 style={{ marginTop: 0, marginBottom: '10px' }}>Medication</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
          {COMMON_MEDS.map((m) => (
            <button key={m} type="button" className="chip-toggle" onClick={() => applyQuickMed(m)}>
              {m}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Medication name</label>
            <input
              type="text"
              className="form-control"
              value={medDraft.name}
              onChange={(e) => setMedDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Tap a quick option above or type a name…"
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Dosage</label>
              <input
                type="text"
                className="form-control"
                value={medDraft.dosage}
                onChange={(e) => setMedDraft((d) => ({ ...d, dosage: e.target.value }))}
                placeholder="e.g. 250mg"
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Times per day</label>
              <input
                type="text"
                className="form-control"
                value={medDraft.frequencyPerDay}
                onChange={(e) => setMedDraft((d) => ({ ...d, frequencyPerDay: e.target.value }))}
                placeholder="e.g. 2"
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Days</label>
              <input
                type="text"
                className="form-control"
                value={medDraft.days}
                onChange={(e) => setMedDraft((d) => ({ ...d, days: e.target.value }))}
                placeholder="e.g. 7"
              />
            </div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={addMedicationFromDraft}>
            Add medication
          </button>
        </div>

        {medications.length > 0 && (
          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {medications.map((m, idx) => (
              <div key={idx} style={{ padding: '8px 12px', border: '1px solid #e5e5ea', borderRadius: 'var(--radius-card)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                  <div>
                    <div style={{ fontWeight: 750 }}>{m.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginTop: '2px' }}>
                      {m.dosage ? `Dosage: ${m.dosage}` : 'Dosage: —'} ·{' '}
                      {m.frequencyPerDay ? `Times/day: ${m.frequencyPerDay}` : 'Times/day: —'} ·{' '}
                      {m.days ? `Days: ${m.days}` : 'Days: —'}
                    </div>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeMedicationAt(idx)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: '12px' }}>
        <h3 style={{ marginTop: 0, marginBottom: '10px' }}>Notes</h3>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>Visit notes (optional)</label>
          <textarea
            className="form-control"
            value={visitNotes}
            onChange={(e) => setVisitNotes(e.target.value)}
            rows={3}
            placeholder="General notes for this visit…"
          />
        </div>
      </div>

      <button type="button" className="btn btn-primary btn-block" disabled={saving} onClick={submit}>
        {saving ? 'Saving...' : isEditMode ? 'Save changes' : 'Save Visit'}
      </button>

      <NavBar />
    </div>
  );
}
