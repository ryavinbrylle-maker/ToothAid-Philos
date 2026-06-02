import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import NavBar from '../components/NavBar';
import PageHeader from '../components/PageHeader';
import AppointmentProcedureField from '../components/AppointmentProcedureField';
import PatientContactModal from '../components/PatientContactModal';
import { formatChildDisplayName } from '../utils/displayName';
import { resolveProcedureTypeForSave } from '../constants/appointmentProcedures';
import {
  addToOutbox,
  getAllClinicDays,
  getAppointmentsByClinicDay,
  getAppointmentsByStatus,
  getChild,
  searchChildren,
  syncPush,
  upsertAppointment,
  upsertClinicDay
} from '../db/indexedDB';
import { isActiveBookedSlot } from '../utils/appointmentStatus';
import { toYmd } from '../utils/dates';
import { notifyError, notifySuccess } from '../utils/notify';

/** Mon–Fri only, 5 columns per row (weekends omitted from the grid). */
function buildWeekdayMonthGrid(year, monthIndex) {
  const last = new Date(year, monthIndex + 1, 0).getDate();
  const chunks = [];
  let row = [];

  const flushRow = () => {
    while (row.length < 5) row.push(null);
    chunks.push(row);
    row = [];
  };

  for (let day = 1; day <= last; day++) {
    const cell = new Date(year, monthIndex, day);
    const dow = cell.getDay();
    if (dow === 0 || dow === 6) continue;

    if (dow === 1 && row.length > 0) flushRow();

    if (row.length === 0 && dow !== 1) {
      for (let i = 0; i < dow - 1; i++) row.push(null);
    }
    row.push(cell);
    if (dow === 5) flushRow();
  }
  if (row.length) flushRow();
  return chunks.flat();
}

const WEEKDAYS = [
  { id: 'MON', label: 'Mon', dow: 1 },
  { id: 'TUE', label: 'Tue', dow: 2 },
  { id: 'WED', label: 'Wed', dow: 3 },
  { id: 'THU', label: 'Thu', dow: 4 },
  { id: 'FRI', label: 'Fri', dow: 5 }
];

export default function Schedule({ token }) {
  const location = useLocation();
  const navigate = useNavigate();

  const todayKey = useMemo(() => toYmd(new Date()), []);
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [loading, setLoading] = useState(true);
  const [dailyQuotas, setDailyQuotas] = useState([]); // stored in clinicDays table, one per dateKey ideally
  const [quotaByDate, setQuotaByDate] = useState({}); // { [dateKey]: { location, amTotal, pmTotal, amRemaining, pmRemaining } }

  // Batch update modal
  const [showBatch, setShowBatch] = useState(false);
  const [batchWeekdays, setBatchWeekdays] = useState(() => new Set(['MON']));
  const [batchLocation, setBatchLocation] = useState('BOCTOL');
  const [batchAm, setBatchAm] = useState('3');
  const [batchPm, setBatchPm] = useState('3');
  const [batchSaving, setBatchSaving] = useState(false);
  const [waitingList, setWaitingList] = useState([]);
  const [showAddWaitlist, setShowAddWaitlist] = useState(false);
  const [waitlistSaving, setWaitlistSaving] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [pickedChildId, setPickedChildId] = useState('');
  const [pickedChild, setPickedChild] = useState(null);
  const [pickedProcedureSelect, setPickedProcedureSelect] = useState('Extraction');
  const [pickedProcedureCustom, setPickedProcedureCustom] = useState('');
  const [pickedRequestedVia, setPickedRequestedVia] = useState('SMS');
  const [pickedNote, setPickedNote] = useState('');
  const [scheduleNowModal, setScheduleNowModal] = useState(null); // null | appointment
  const [scheduleNowDate, setScheduleNowDate] = useState(todayKey);
  const [scheduleNowWindow, setScheduleNowWindow] = useState('AM');
  const [contactModal, setContactModal] = useState(null); // null | { child, appointment }

  const monthLabel = useMemo(() => {
    const d = new Date(viewYear, viewMonth, 1);
    return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  }, [viewYear, viewMonth]);

  const grid = useMemo(() => buildWeekdayMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  const reloadQuotas = async () => {
    const days = await getAllClinicDays();
    setDailyQuotas(days);
  };

  const reloadWaitingList = async () => {
    const pending = await getAppointmentsByStatus('TO_BE_SCHEDULED');
    const withChildren = await Promise.all(
      pending.map(async (appointment) => ({ appointment, child: await getChild(appointment.childId) }))
    );
    withChildren.sort((a, b) => new Date(a.appointment.createdAt || 0) - new Date(b.appointment.createdAt || 0));
    setWaitingList(withChildren);
  };

  useEffect(() => {
    Promise.all([reloadQuotas(), reloadWaitingList()])
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
    const onFocus = () => Promise.all([reloadQuotas(), reloadWaitingList()]).catch(() => {});
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  useEffect(() => {
    const q = searchQ.trim();
    if (!showAddWaitlist || q.length < 1) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    searchChildren(q)
      .then((found) => {
        if (!cancelled) setSearchResults(found.slice(0, 25));
      })
      .catch(() => {
        if (!cancelled) setSearchResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [searchQ, showAddWaitlist]);

  /** Open month from Home reminder “Pick week on calendar” (YYYY-MM-DD). */
  useEffect(() => {
    const anchor = location.state?.openMonthForDate;
    if (!anchor || typeof anchor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return;
    const [y, m, d] = anchor.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (Number.isNaN(dt.getTime())) return;
    setViewYear(dt.getFullYear());
    setViewMonth(dt.getMonth());
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.state?.openMonthForDate, navigate, location.pathname]);

  // Compute month quotas (remaining) from quota records + appointments
  useEffect(() => {
    const run = async () => {
      const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;
      const byKey = new Map();
      for (const q of dailyQuotas) {
        const dateKey = toYmd(q.date);
        if (!dateKey || !dateKey.startsWith(monthPrefix)) continue;
        // Prefer stable id if present; otherwise latest createdAt
        const prev = byKey.get(dateKey);
        if (!prev) byKey.set(dateKey, q);
        else {
          const prevT = new Date(prev.createdAt || 0).getTime();
          const nextT = new Date(q.createdAt || 0).getTime();
          if (nextT >= prevT) byKey.set(dateKey, q);
        }
      }

      const entries = await Promise.all(
        Array.from(byKey.entries()).map(async ([dateKey, q]) => {
          const amTotal = Number(q.amCapacity) || 0;
          const pmTotal = Number(q.pmCapacity) || 0;
          const location = q.school || '';
          // Daily quota exists even if 0/0, but month UI hides those.
          const dayId = `clinicday-${dateKey}`;
          const appts = await getAppointmentsByClinicDay(dayId);
          const used = appts.filter(isActiveBookedSlot);
          const amUsed = used.filter((a) => a.timeWindow === 'AM').length;
          const pmUsed = used.filter((a) => a.timeWindow === 'PM').length;
          return [
            dateKey,
            {
              location,
              amTotal,
              pmTotal,
              amRemaining: Math.max(0, amTotal - amUsed),
              pmRemaining: Math.max(0, pmTotal - pmUsed)
            }
          ];
        })
      );
      setQuotaByDate(Object.fromEntries(entries));
    };
    run().catch(() => setQuotaByDate({}));
  }, [dailyQuotas, viewYear, viewMonth]);

  const upsertDailyQuota = async ({ dateKey, location, am, pm }) => {
    const username = localStorage.getItem('username') || 'unknown';
    const nowIso = new Date().toISOString();
    const clinicDayId = `clinicday-${dateKey}`;
    const amN = Math.max(0, Number(am) || 0);
    const pmN = Math.max(0, Number(pm) || 0);
    const payload = {
      clinicDayId,
      date: dateKey, // store as YYYY-MM-DD (UTC+8 calendar key)
      school: location,
      capacity: amN + pmN,
      amCapacity: amN,
      pmCapacity: pmN,
      notes: null,
      createdBy: username,
      createdAt: nowIso
    };
    await upsertClinicDay(payload);
    await addToOutbox('UPSERT_CLINIC_DAY', clinicDayId, payload);
  };

  const applyBatch = async () => {
    setBatchSaving(true);
    try {
      const monthStart = new Date(viewYear, viewMonth, 1);
      const monthEnd = new Date(viewYear, viewMonth + 1, 0);
      monthStart.setHours(0, 0, 0, 0);
      monthEnd.setHours(0, 0, 0, 0);

      const selectedDow = new Set(
        WEEKDAYS.filter((w) => batchWeekdays.has(w.id)).map((w) => w.dow)
      );
      let updated = 0;
      for (let d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
        if (!selectedDow.has(d.getDay())) continue;
        const dateKey = toYmd(new Date(d));
        await upsertDailyQuota({ dateKey, location: batchLocation, am: batchAm, pm: batchPm });
        updated += 1;
      }

      // Push only: immediate pull can bulkPut server rows that still omit AM/PM and wipe the batch.
      if (navigator.onLine && token) {
        try {
          await syncPush(token);
        } catch {}
      }

      await reloadQuotas();
      notifySuccess(`Updated ${updated} day(s).`);
      setShowBatch(false);
    } catch (e) {
      notifyError(e?.message || 'Batch update failed');
    } finally {
      setBatchSaving(false);
    }
  };

  const resetAddWaitlistForm = () => {
    setSearchQ('');
    setSearchResults([]);
    setPickedChildId('');
    setPickedChild(null);
    setPickedProcedureSelect('Extraction');
    setPickedProcedureCustom('');
    setPickedRequestedVia('SMS');
    setPickedNote('');
  };

  const openAddWaitlistModal = () => {
    resetAddWaitlistForm();
    setShowAddWaitlist(true);
  };

  const addToWaitingList = async () => {
    if (!pickedChildId) return;
    setWaitlistSaving(true);
    try {
      const existing = await getAppointmentsByStatus('TO_BE_SCHEDULED');
      const dup = existing.some((a) => a.childId === pickedChildId);
      if (dup) {
        notifyError('Patient is already on the waiting list.');
        return;
      }
      const username = localStorage.getItem('username') || 'unknown';
      const nowIso = new Date().toISOString();
      const appointmentId = `appointment-${crypto.randomUUID()}`;
      const payload = {
        appointmentId,
        childId: pickedChildId,
        clinicDayId: 'UNASSIGNED',
        timeWindow: 'FULL',
        slotNumber: null,
        reason: 'FOLLOW_UP',
        status: 'TO_BE_SCHEDULED',
        procedureType: resolveProcedureTypeForSave(pickedProcedureSelect, pickedProcedureCustom),
        note: pickedNote.trim() || null,
        metadata: {
          waitlistRequestedVia: pickedRequestedVia
        },
        order: null,
        createdBy: username,
        createdAt: nowIso
      };
      await upsertAppointment(payload);
      await addToOutbox('UPSERT_APPOINTMENT', appointmentId, payload);
      if (navigator.onLine && token) {
        try {
          await syncPush(token);
        } catch {}
      }
      await reloadWaitingList();
      setShowAddWaitlist(false);
      resetAddWaitlistForm();
      notifySuccess('Added to waiting list.');
    } catch (e) {
      notifyError(e?.message || 'Failed to add to waiting list');
    } finally {
      setWaitlistSaving(false);
    }
  };

  const openScheduleNow = (appointment) => {
    setScheduleNowModal(appointment);
    setScheduleNowDate(todayKey);
    setScheduleNowWindow('AM');
  };

  const scheduleFromWaitingList = async () => {
    if (!scheduleNowModal || !/^\d{4}-\d{2}-\d{2}$/.test(scheduleNowDate)) return;
    setWaitlistSaving(true);
    try {
      const targetDayId = `clinicday-${scheduleNowDate}`;
      const allDays = await getAllClinicDays();
      const day = allDays
        .filter((d) => toYmd(d.date) === scheduleNowDate)
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
      if (!day) {
        notifyError('Set quota for the selected day first.');
        return;
      }
      const amTotal = Math.max(0, Number(day.amCapacity) || 0);
      const pmTotal = Math.max(0, Number(day.pmCapacity) || 0);
      const dayAppts = await getAppointmentsByClinicDay(targetDayId);
      const active = dayAppts.filter(isActiveBookedSlot);
      const amUsed = active.filter((a) => a.timeWindow === 'AM').length;
      const pmUsed = active.filter((a) => a.timeWindow === 'PM').length;
      const rem = scheduleNowWindow === 'AM' ? amTotal - amUsed : pmTotal - pmUsed;
      if (rem <= 0) {
        notifyError('Selected slot is full. Update quota or pick another day/window.');
        return;
      }
      const dup = active.some((a) => a.childId === scheduleNowModal.childId && a.timeWindow === scheduleNowWindow);
      if (dup) {
        notifyError('Patient is already scheduled in that time window.');
        return;
      }
      const order =
        scheduleNowWindow === 'AM'
          ? active.filter((a) => a.timeWindow === 'AM').length
          : active.filter((a) => a.timeWindow === 'PM').length;
      const updated = {
        ...scheduleNowModal,
        clinicDayId: targetDayId,
        timeWindow: scheduleNowWindow,
        status: 'SCHEDULED',
        order
      };
      await upsertAppointment(updated);
      await addToOutbox('UPSERT_APPOINTMENT', updated.appointmentId, updated);
      if (navigator.onLine && token) {
        try {
          await syncPush(token);
        } catch {}
      }
      await Promise.all([reloadWaitingList(), reloadQuotas()]);
      setScheduleNowModal(null);
      notifySuccess('Appointment scheduled.');
    } catch (e) {
      notifyError(e?.message || 'Failed to schedule appointment');
    } finally {
      setWaitlistSaving(false);
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

  return (
    <div className="container" style={{ overflowX: 'hidden' }}>
      <PageHeader title="Schedule" subtitle="Monthly calendar" icon="clinic" />

      <button
        type="button"
        className="btn btn-secondary"
        style={{ width: '100%', marginBottom: '12px' }}
        onClick={() => setShowBatch(true)}
      >
        Batch update (weekly)
      </button>

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
          <div style={{ fontWeight: 800 }}>{monthLabel}</div>
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px', fontSize: '11px', color: 'var(--color-muted)', marginBottom: '6px' }}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => (
            <div key={d} style={{ textAlign: 'center' }}>{d}</div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
          {grid.map((cell, idx) => {
            if (!cell) return <div key={idx} />;
            const dateKey = toYmd(cell);
            const isPast = dateKey < todayKey;
            const q = quotaByDate[dateKey];
            const amTotal = q?.amTotal ?? 0;
            const pmTotal = q?.pmTotal ?? 0;
            const shouldShow = amTotal > 0 || pmTotal > 0;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => navigate(`/schedule/${dateKey}`)}
                style={{
                  padding: '10px 6px',
                  borderRadius: '10px',
                  border: '1px solid #e5e5ea',
                  background: isPast ? '#f2f2f7' : '#fff',
                  opacity: isPast ? 0.55 : 1,
                  cursor: 'pointer',
                  textAlign: 'left',
                  minHeight: '56px'
                }}
              >
                <div style={{ fontWeight: 800, fontSize: '12px' }}>{cell.getDate()}</div>
                {shouldShow && (
                  <div style={{ marginTop: '4px', fontSize: '10px', color: 'var(--color-muted)' }}>
                    <div>AM {q?.amRemaining ?? '—'}/{amTotal}</div>
                    <div>PM {q?.pmRemaining ?? '—'}/{pmTotal}</div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', gap: '8px' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 800 }}>Waiting list (To be scheduled)</div>
            <div style={{ fontSize: '12px', color: 'var(--color-muted)' }}>{waitingList.length} patient(s)</div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={openAddWaitlistModal}>
            Add to waiting list
          </button>
        </div>
        {waitingList.length === 0 ? (
          <div style={{ color: 'var(--color-muted)' }}>No patients in waiting list.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {waitingList.map(({ appointment, child }) => (
              <div
                key={appointment.appointmentId}
                style={{
                  border: '1px solid #e5e5ea',
                  borderRadius: '12px',
                  padding: '10px 12px',
                  background: '#fafafa',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '10px'
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{child?.fullName || 'Unknown patient'}</div>
                  <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginTop: '4px' }}>
                    {appointment.procedureType || 'Extraction'}
                    {appointment.note ? ` · ${appointment.note}` : ''}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginTop: '4px' }}>
                    Requested via: {appointment?.metadata?.waitlistRequestedVia || '—'}
                    {' · '}
                    Added: {appointment.createdAt ? new Date(appointment.createdAt).toLocaleDateString() : '—'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setContactModal({ child: child || null, appointment })}
                    disabled={waitlistSaving}
                  >
                    Contact
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => openScheduleNow(appointment)}
                    disabled={waitlistSaving}
                  >
                    Schedule now
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showBatch && (
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
          <div className="card" style={{ maxWidth: '520px', width: '100%' }}>
            <h3 style={{ marginTop: 0, marginBottom: '12px' }}>Batch update (weekly)</h3>

            <div className="card" style={{ background: '#fff' }}>
              <div style={{ fontWeight: 800, marginBottom: '10px' }}>Weekdays</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {WEEKDAYS.map((w) => {
                  const active = batchWeekdays.has(w.id);
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => {
                        setBatchWeekdays((prev) => {
                          const next = new Set(prev);
                          if (next.has(w.id)) next.delete(w.id);
                          else next.add(w.id);
                          return next;
                        });
                      }}
                      className={`chip-toggle${active ? ' chip-toggle--active' : ''}`}
                    >
                      {w.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Location</label>
                <select value={batchLocation} onChange={(e) => setBatchLocation(e.target.value)}>
                  <option value="BOCTOL">BOCTOL</option>
                  <option value="CENTRAL">CENTRAL</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>AM quota</label>
                <input type="number" min="0" value={batchAm} onChange={(e) => setBatchAm(e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>PM quota</label>
                <input type="number" min="0" value={batchPm} onChange={(e) => setBatchPm(e.target.value)} />
              </div>
              <div style={{ display: 'flex', alignItems: 'end' }}>
                <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={applyBatch} disabled={batchSaving || batchWeekdays.size === 0}>
                  {batchSaving ? 'Applying...' : 'Apply to this month'}
                </button>
              </div>
            </div>

            <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: '10px' }} onClick={() => setShowBatch(false)} disabled={batchSaving}>
              Close
            </button>
          </div>
        </div>
      )}

      {showAddWaitlist && (
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
          <div className="card" style={{ maxWidth: '520px', width: '100%' }}>
            <h3 style={{ marginTop: 0, marginBottom: '12px' }}>Add to waiting list</h3>
            <div className="form-group">
              <label>Search by name or patient ID</label>
              <input
                value={searchQ}
                onChange={(e) => {
                  setSearchQ(e.target.value);
                  setPickedChildId('');
                  setPickedChild(null);
                }}
                placeholder="Name or ID…"
                autoComplete="off"
                inputMode="search"
                autoFocus
              />
              {!pickedChild && searchQ.trim().length >= 1 && searchResults.length === 0 && (
                <p style={{ margin: '8px 0 0', fontSize: '13px', color: 'var(--color-muted)' }}>No matches.</p>
              )}
              {!pickedChild && searchResults.length > 0 && (
                <div
                  role="listbox"
                  aria-label="Search results"
                  style={{
                    marginTop: '10px',
                    maxHeight: '240px',
                    overflowY: 'auto',
                    border: '1px solid #e5e5ea',
                    borderRadius: 'var(--radius-card)',
                    background: '#fafafa'
                  }}
                >
                  {searchResults.map((c, idx) => {
                    const isLast = idx === searchResults.length - 1;
                    return (
                      <button
                        key={c.childId}
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => {
                          setPickedChildId(c.childId);
                          setPickedChild(c);
                        }}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '10px 12px',
                          border: 'none',
                          borderBottom: isLast ? 'none' : '1px solid #eee',
                          background: 'transparent',
                          cursor: 'pointer'
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{c.fullName || 'Unknown patient'}</div>
                        <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginTop: '4px' }}>
                          {c.patientId || '—'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {pickedChild && (
              <div
                style={{
                  marginBottom: '12px',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-card)',
                  border: '1px solid #93c5fd',
                  background: '#eff6ff'
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#1d4ed8', marginBottom: '4px' }}>
                  Selected
                </div>
                <div style={{ fontWeight: 700 }}>{pickedChild.fullName || 'Unknown patient'}</div>
                <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginTop: '4px' }}>
                  {pickedChild.patientId || '—'}
                </div>
              </div>
            )}

            <AppointmentProcedureField
              selectValue={pickedProcedureSelect}
              customValue={pickedProcedureCustom}
              onSelectChange={setPickedProcedureSelect}
              onCustomChange={setPickedProcedureCustom}
              disabled={waitlistSaving}
            />

            <div className="form-group" style={{ marginBottom: '10px' }}>
              <label>Requested via</label>
              <select
                value={pickedRequestedVia}
                onChange={(e) => setPickedRequestedVia(e.target.value)}
                disabled={waitlistSaving}
              >
                <option value="SMS">SMS</option>
                <option value="MESSENGER">Messenger</option>
              </select>
            </div>

            <div className="form-group" style={{ marginTop: '10px' }}>
              <label>Note</label>
              <textarea value={pickedNote} onChange={(e) => setPickedNote(e.target.value)} rows={3} placeholder="Optional note..." />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAddWaitlist(false)} disabled={waitlistSaving}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={addToWaitingList} disabled={waitlistSaving || !pickedChildId}>
                {waitlistSaving ? 'Saving…' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {scheduleNowModal && (
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
          <div className="card" style={{ maxWidth: '520px', width: '100%' }}>
            <h3 style={{ marginTop: 0, marginBottom: '12px' }}>Schedule from waiting list</h3>
            <div className="form-group" style={{ marginBottom: '10px' }}>
              <label>Date</label>
              <input type="date" value={scheduleNowDate} onChange={(e) => setScheduleNowDate(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: '10px' }}>
              <label>AM / PM</label>
              <select value={scheduleNowWindow} onChange={(e) => setScheduleNowWindow(e.target.value)}>
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={() => setScheduleNowModal(null)}
                disabled={waitlistSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={scheduleFromWaitingList}
                disabled={waitlistSaving}
              >
                {waitlistSaving ? 'Saving…' : 'Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {contactModal && (
        <PatientContactModal
          child={contactModal.child}
          onClose={() => setContactModal(null)}
          showMessageComposer={false}
          getSmsBody={(c) => {
            const name = formatChildDisplayName(c);
            return `Hello, regarding ${name}: this is about scheduling an extraction appointment. Please reply with your available dates. Thank you.`;
          }}
        />
      )}

      <NavBar />
    </div>
  );
}

