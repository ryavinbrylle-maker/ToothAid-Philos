import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import NavBar from '../components/NavBar';
import PageHeader from '../components/PageHeader';
import { addToOutbox, getAllClinicDays, getAppointmentsByClinicDay, syncPush, upsertClinicDay } from '../db/indexedDB';
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

  const monthLabel = useMemo(() => {
    const d = new Date(viewYear, viewMonth, 1);
    return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  }, [viewYear, viewMonth]);

  const grid = useMemo(() => buildWeekdayMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  const reloadQuotas = async () => {
    const days = await getAllClinicDays();
    setDailyQuotas(days);
  };

  useEffect(() => {
    reloadQuotas()
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
    const onFocus = () => reloadQuotas().catch(() => {});
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

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
          const used = appts.filter((a) => a.status !== 'CANCELLED');
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

      <NavBar />
    </div>
  );
}

