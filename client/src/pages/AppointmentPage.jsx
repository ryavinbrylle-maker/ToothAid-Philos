import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import NavBar from '../components/NavBar';
import PageHeader from '../components/PageHeader';
import {
  addToOutbox,
  getAppointment,
  getAllClinicDays,
  getAppointmentsByClinicDay,
  getChild,
  performSync,
  upsertAppointment,
  upsertClinicDay
} from '../db/indexedDB';
import { PatientNameBlock } from '../components/PatientNameBlock';
import AppointmentProcedureField from '../components/AppointmentProcedureField';
import { resolveProcedureTypeForSave } from '../constants/appointmentProcedures';
import { notifyError, notifySuccess } from '../utils/notify';
import { isActiveBookedSlot } from '../utils/appointmentStatus';
import { toYmd } from '../utils/dates';

const ymd = (d) => {
  if (typeof d === 'string') {
    // Accept both 'YYYY-MM-DD' and ISO strings like 'YYYY-MM-DDTHH:mm:ss.sssZ'
    if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  }
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  dt.setHours(0, 0, 0, 0);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const startOfMonth = (year, monthIndex) => new Date(year, monthIndex, 1);
const endOfMonth = (year, monthIndex) => new Date(year, monthIndex + 1, 0);

function buildMonthGrid(year, monthIndex) {
  const start = startOfMonth(year, monthIndex);
  const end = endOfMonth(year, monthIndex);
  const startWeekday = (start.getDay() + 6) % 7; // Monday=0
  const totalDays = end.getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let day = 1; day <= totalDays; day++) cells.push(new Date(year, monthIndex, day));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function AppointmentPage({ token }) {
  const { childId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [child, setChild] = useState(null);
  const [loading, setLoading] = useState(true);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-11
  const [selectedDate, setSelectedDate] = useState(toYmd(today));
  const [timeWindow, setTimeWindow] = useState('AM');
  const [procedureSelect, setProcedureSelect] = useState('');
  const [procedureCustom, setProcedureCustom] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /** In-app confirm when quota is full (some WebViews block window.confirm). */
  const [quotaFullDialog, setQuotaFullDialog] = useState(null); // null | { cd, timeWindow }
  const rescheduleFromAppointmentId = location.state?.rescheduleFromAppointmentId || null;

  const [clinicDays, setClinicDays] = useState([]);
  const [dayInfo, setDayInfo] = useState(null); // { clinicDay, amRemaining, pmRemaining }

  useEffect(() => {
    const load = async () => {
      const c = await getChild(childId);
      setChild(c);
      const days = await getAllClinicDays();
      setClinicDays(days);
      setLoading(false);
    };
    load().catch((e) => {
      console.error(e);
      setLoading(false);
    });
  }, [childId]);

  const clinicDayByDate = useMemo(() => {
    const map = new Map();
    for (const d of clinicDays) {
      const k = toYmd(d.date);
      if (k) map.set(k, d);
    }
    return map;
  }, [clinicDays]);

  useEffect(() => {
    const loadDay = async () => {
      const cd = clinicDayByDate.get(selectedDate) || null;
      if (!cd) {
        setDayInfo(null);
        return;
      }
      const appts = await getAppointmentsByClinicDay(cd.clinicDayId);
      const used = appts.filter(isActiveBookedSlot);
      const amUsed = used.filter((a) => a.timeWindow === 'AM').length;
      const pmUsed = used.filter((a) => a.timeWindow === 'PM').length;
      const amTotal = cd.amCapacity ?? null;
      const pmTotal = cd.pmCapacity ?? null;
      setDayInfo({
        clinicDay: cd,
        amRemaining: amTotal != null ? Math.max(0, amTotal - amUsed) : null,
        pmRemaining: pmTotal != null ? Math.max(0, pmTotal - pmUsed) : null
      });
    };
    loadDay().catch(() => setDayInfo(null));
  }, [selectedDate, clinicDayByDate]);

  const grid = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  const monthLabel = useMemo(() => {
    const d = new Date(viewYear, viewMonth, 1);
    return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  }, [viewYear, viewMonth]);

  const executeSaveWithCd = async (cd) => {
    setSaving(true);
    try {
      const appointmentId = `appointment-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const username = localStorage.getItem('username') || 'unknown';
      const appointmentData = {
        appointmentId,
        childId,
        clinicDayId: cd.clinicDayId,
        timeWindow,
        slotNumber: null,
        reason: 'FOLLOW_UP',
        status: 'SCHEDULED',
        rescheduledFromAppointmentId: rescheduleFromAppointmentId,
        procedureType: resolveProcedureTypeForSave(procedureSelect, procedureCustom),
        note: note.trim() || null,
        createdBy: username,
        createdAt: now
      };

      await upsertAppointment(appointmentData);
      await addToOutbox('UPSERT_APPOINTMENT', appointmentId, appointmentData);

      if (rescheduleFromAppointmentId) {
        const nowIso = new Date().toISOString();
        const previous = await getAppointment(rescheduleFromAppointmentId);
        if (previous) {
          const previousUpdated = {
            ...previous,
            status: 'RESCHEDULED',
            statusChangedAt: nowIso,
            statusChangedBy: username,
            statusReason: 'rescheduled-to-new-appointment',
            rescheduledToAppointmentId: appointmentId,
            followUpNeeded: false,
            followUpDueAt: null
          };
          await upsertAppointment(previousUpdated);
          await addToOutbox('UPSERT_APPOINTMENT', rescheduleFromAppointmentId, previousUpdated);
        }
      }

      if (navigator.onLine && token) {
        try {
          await performSync(token);
        } catch (syncError) {
          console.error('Sync failed:', syncError);
        }
      }

      notifySuccess('Appointment saved.');
      const returnTo = location.state?.returnTo;
      if (typeof returnTo === 'string' && returnTo) {
        navigate(returnTo);
      } else {
        navigate(`/children/${childId}`);
      }
    } catch (e) {
      const msg = e?.message || 'Failed to save appointment';
      setError(msg);
      notifyError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    setError('');
    let cd = clinicDayByDate.get(selectedDate);
    // If no quota exists for selected date, auto-create one and continue.
    if (!cd) {
      try {
        const username = localStorage.getItem('username') || 'unknown';
        const nowIso = new Date().toISOString();
        const clinicDayId = `clinicday-${selectedDate}`;
        const payload = {
          clinicDayId,
          date: selectedDate,
          school: 'BOCTOL',
          capacity: 6,
          amCapacity: 3,
          pmCapacity: 3,
          notes: null,
          createdBy: username,
          createdAt: nowIso
        };
        await upsertClinicDay(payload);
        await addToOutbox('UPSERT_CLINIC_DAY', clinicDayId, payload);
        cd = payload;
        // Also refresh in-memory map for remaining calculations
        setClinicDays((prev) => [...prev, payload]);
      } catch (e) {
        const msg = e?.message || 'Failed to create quota for selected date';
        setError(msg);
        notifyError(msg);
        return;
      }
    }

    const appts = await getAppointmentsByClinicDay(cd.clinicDayId);
    const used = appts.filter(isActiveBookedSlot);
    const amUsed = used.filter((a) => a.timeWindow === 'AM').length;
    const pmUsed = used.filter((a) => a.timeWindow === 'PM').length;
    const amCap = cd.amCapacity != null ? Number(cd.amCapacity) : null;
    const pmCap = cd.pmCapacity != null ? Number(cd.pmCapacity) : null;
    const amRem = amCap != null ? Math.max(0, amCap - amUsed) : null;
    const pmRem = pmCap != null ? Math.max(0, pmCap - pmUsed) : null;

    const isFull =
      (timeWindow === 'AM' && amRem !== null && amRem <= 0) ||
      (timeWindow === 'PM' && pmRem !== null && pmRem <= 0);

    if (isFull) {
      setQuotaFullDialog({ cd, timeWindow });
      return;
    }

    await executeSaveWithCd(cd);
  };

  const confirmQuotaFull = async () => {
    if (!quotaFullDialog) return;
    const { cd: cd0, timeWindow: tw } = quotaFullDialog;
    setQuotaFullDialog(null);
    let cd = cd0;
    try {
      const username = localStorage.getItem('username') || 'unknown';
      const nowIso = new Date().toISOString();
      const nextAm = tw === 'AM' ? (Number(cd.amCapacity) || 0) + 1 : (Number(cd.amCapacity) || 0);
      const nextPm = tw === 'PM' ? (Number(cd.pmCapacity) || 0) + 1 : (Number(cd.pmCapacity) || 0);
      const quotaPayload = {
        ...cd,
        clinicDayId: cd.clinicDayId,
        date: selectedDate,
        capacity: nextAm + nextPm,
        amCapacity: nextAm,
        pmCapacity: nextPm,
        createdBy: cd.createdBy || username,
        createdAt: cd.createdAt || nowIso
      };
      await upsertClinicDay(quotaPayload);
      await addToOutbox('UPSERT_CLINIC_DAY', quotaPayload.clinicDayId, quotaPayload);
      cd = quotaPayload;
      setClinicDays((prev) => prev.map((d) => (d.clinicDayId === quotaPayload.clinicDayId ? quotaPayload : d)));
    } catch (e) {
      const msg = e?.message || 'Failed to update quota';
      setError(msg);
      notifyError(msg);
      return;
    }
    await executeSaveWithCd(cd);
  };

  const cancelQuotaFull = () => setQuotaFullDialog(null);

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

  return (
    <div className="container" style={{ overflowX: 'hidden' }}>
      <PageHeader
        title="Appointment"
        subtitle={<PatientNameBlock child={child} />}
        icon="clinic"
      />
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card" style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              const prev = new Date(viewYear, viewMonth - 1, 1);
              setViewYear(prev.getFullYear());
              setViewMonth(prev.getMonth());
            }}
          >
            ‹
          </button>
          <div style={{ fontWeight: 700 }}>{monthLabel}</div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              const next = new Date(viewYear, viewMonth + 1, 1);
              setViewYear(next.getFullYear());
              setViewMonth(next.getMonth());
            }}
          >
            ›
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px', fontSize: '11px', color: 'var(--color-muted)', marginBottom: '6px' }}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} style={{ textAlign: 'center' }}>{d}</div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px' }}>
          {grid.map((cell, idx) => {
            if (!cell) return <div key={idx} />;
            const key = toYmd(cell);
            const cd = clinicDayByDate.get(key);
            const isSelected = key === selectedDate;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => setSelectedDate(key)}
                style={{
                  padding: '10px 6px',
                  borderRadius: '10px',
                  border: isSelected ? '2px solid var(--color-primary)' : '1px solid #e5e5ea',
                  background: cd ? (isSelected ? 'var(--color-primary-soft)' : '#fff') : '#f2f2f7',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '12px', color: '#111827' }}>{cell.getDate()}</div>
                {cd && (
                  <div style={{ marginTop: '4px', fontSize: '10px', color: 'var(--color-muted)' }}>
                    AM {cd.amCapacity ?? '—'} / PM {cd.pmCapacity ?? '—'}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: '8px' }}>Selected: {selectedDate}</div>
        {dayInfo ? (
          <div style={{ fontSize: '13px', color: 'var(--color-muted)', marginBottom: '12px' }}>
            AM remaining: {dayInfo.amRemaining ?? '—'} · PM remaining: {dayInfo.pmRemaining ?? '—'}
          </div>
        ) : (
          <div style={{ fontSize: '13px', color: 'var(--color-muted)', marginBottom: '12px' }}>
            No clinic schedule on this date.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>AM / PM</label>
            <select value={timeWindow} onChange={(e) => setTimeWindow(e.target.value)}>
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </div>
          <AppointmentProcedureField
            selectValue={procedureSelect}
            customValue={procedureCustom}
            onSelectChange={setProcedureSelect}
            onCustomChange={setProcedureCustom}
            disabled={saving}
          />
        </div>

        <div className="form-group" style={{ marginTop: '10px' }}>
          <label>Note</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Optional note..." />
        </div>

        <button type="button" className="btn btn-primary btn-block" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Appointment'}
        </button>
      </div>

      {quotaFullDialog && (
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
            zIndex: 2000,
            padding: '16px'
          }}
        >
          <div className="card" style={{ maxWidth: '420px', width: '100%' }}>
            <h3 style={{ marginTop: 0, marginBottom: '12px' }}>No Quota Available</h3>
            <p style={{ margin: '0 0 16px', lineHeight: 1.5, color: 'var(--color-muted)' }}>
              This time slot is full. Continue to add?
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={cancelQuotaFull} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => confirmQuotaFull()} disabled={saving}>
                {saving ? 'Saving…' : 'Continue'}
              </button>
            </div>
          </div>
        </div>
      )}

      <NavBar />
    </div>
  );
}

