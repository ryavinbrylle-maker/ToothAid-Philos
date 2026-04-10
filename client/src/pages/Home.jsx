import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import NavBar from '../components/NavBar';
import PatientContactModal from '../components/PatientContactModal';
import { PatientNameBlock } from '../components/PatientNameBlock';
import { getAllClinicDays, getAppointmentsByClinicDay, getChild, getLastSyncAt, getMeta, getOutboxOps, performSync, setMeta } from '../db/indexedDB';
import { formatChildDisplayName } from '../utils/displayName';
import { toYmd } from '../utils/dates';

const sortAppointmentsByCreated = (arr) =>
  [...(arr || [])].sort((a, b) => {
    const ta = new Date(a.createdAt || 0).getTime();
    const tb = new Date(b.createdAt || 0).getTime();
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return String(a.appointmentId || '').localeCompare(String(b.appointmentId || ''));
  });

/** One entry per childId, stable order from sorted appointments. */
const uniqueChildOrderFromSched = (schedList) => {
  const sorted = sortAppointmentsByCreated(schedList);
  const seen = new Set();
  const out = [];
  for (const a of sorted) {
    if (!a?.childId || seen.has(a.childId)) continue;
    seen.add(a.childId);
    out.push(a.childId);
  }
  return out;
};

const MAX_SLOT = 3;

const todayRowIconBtn = {
  padding: '8px 10px',
  borderRadius: 'var(--radius-pill)',
  border: '1px solid #e5e5ea',
  background: '#f9fafb',
  color: '#374151',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  flexShrink: 0,
  lineHeight: 0
};

const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

/**
 * Rebuild AM/PM slots: keep prior order + statuses for children still scheduled,
 * then fill empty slots from schedule order. Caller must pass existing meta read
 * AFTER async appointment loads to avoid overwriting in-flight status updates.
 */
const mergeQueueWindow = (scheduledForWindow, prevItems, maxN) => {
  const schedIds = uniqueChildOrderFromSched(scheduledForWindow);
  const allowed = new Set(schedIds);
  const statusById = new Map();
  const ordered = [];

  if (prevItems && Array.isArray(prevItems)) {
    for (const it of prevItems) {
      if (!it?.childId || !allowed.has(it.childId)) continue;
      if (ordered.includes(it.childId)) continue;
      ordered.push(it.childId);
      statusById.set(it.childId, it.status || 'WAITING');
    }
  }

  for (const id of schedIds) {
    if (ordered.length >= maxN) break;
    if (!ordered.includes(id)) ordered.push(id);
  }

  return ordered.slice(0, maxN).map((childId) => ({
    childId,
    status: statusById.get(childId) || 'WAITING'
  }));
};

const Home = ({ setToken }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState({ AM: [], PM: [] }); // [{ childId, status }]
  const [expandedKey, setExpandedKey] = useState(null); // `${timeWindow}:${childId}`
  /** @type {{ [childId: string]: { name: string, patientId: string } }} */
  const [queueChildById, setQueueChildById] = useState({});
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingOps, setPendingOps] = useState(0);
  const [lastSyncAt, setLastSyncAtState] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null); // string
  /** null | { child: object | null } */
  const [todayContactModal, setTodayContactModal] = useState(null);

  const todayKey = useMemo(() => {
    return toYmd(new Date());
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const loadStatus = async () => {
      const ops = await getOutboxOps();
      const last = await getLastSyncAt();
      setPendingOps(Array.isArray(ops) ? ops.length : 0);
      setLastSyncAtState(last || null);
    };
    loadStatus().catch(() => {});
    const interval = setInterval(() => loadStatus().catch(() => {}), 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const loadQueue = async () => {
      const metaKey = `todayQueue:${todayKey}`;

      const allClinicDays = await getAllClinicDays();
      const todayClinicDays = allClinicDays.filter((d) => toYmd(d.date) === todayKey);

      if (!todayClinicDays || todayClinicDays.length === 0) {
        const empty = { AM: [], PM: [] };
        setQueue(empty);
        await setMeta(metaKey, empty);
        setLoading(false);
        return;
      }

      const apptsArrays = await Promise.all(todayClinicDays.map((d) => getAppointmentsByClinicDay(d.clinicDayId)));
      const appts = apptsArrays.flat();
      const scheduled = appts.filter((a) => a.status === 'SCHEDULED');
      const schedAm = scheduled.filter((a) => a.timeWindow === 'AM');
      const schedPm = scheduled.filter((a) => a.timeWindow === 'PM');

      // Read saved order + statuses only AFTER async work so we never clobber Attended/etc. with stale meta.
      const existing = await getMeta(metaKey);
      const existingQueue =
        existing && typeof existing === 'object' && Array.isArray(existing.AM) && Array.isArray(existing.PM)
          ? existing
          : null;

      const nextQueue = {
        AM: mergeQueueWindow(schedAm, existingQueue?.AM, MAX_SLOT),
        PM: mergeQueueWindow(schedPm, existingQueue?.PM, MAX_SLOT)
      };

      setQueue(nextQueue);
      await setMeta(metaKey, nextQueue);
      setLoading(false);
    };

    const safeLoad = () =>
      loadQueue().catch((e) => {
        console.error('Error loading Today queue:', e);
        setLoading(false);
      });

    safeLoad();

    // Refresh when returning to the app/tab so same-day new appointments show up.
    const onFocus = () => safeLoad();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [todayKey]);

  // (kept) original error handler removed; handled in safeLoad above
  /*
    loadQueue().catch((e) => {
      console.error('Error loading Today queue:', e);
      setLoading(false);
    });
  */

  useEffect(() => {
    const hydrate = async () => {
      const ids = [...queue.AM, ...queue.PM].map((i) => i.childId).filter(Boolean);
      const unique = Array.from(new Set(ids));
      const entries = await Promise.all(
        unique.map(async (id) => {
          const child = await getChild(id);
          const pid = child?.patientId != null ? String(child.patientId).trim() : '';
          return [
            id,
            {
              name: formatChildDisplayName(child) || 'Unknown',
              patientId: pid
            }
          ];
        })
      );
      setQueueChildById(Object.fromEntries(entries));
    };
    hydrate().catch(() => {});
  }, [queue.AM, queue.PM]);

  const persistQueue = async (next) => {
    const metaKey = `todayQueue:${todayKey}`;
    setQueue(next);
    await setMeta(metaKey, next);
  };

  const updateStatus = async (timeWindow, childId, status) => {
    const next = { AM: [...queue.AM], PM: [...queue.PM] };
    next[timeWindow] = next[timeWindow].map((item) => (item.childId === childId ? { ...item, status } : item));
    await persistQueue(next);
    setExpandedKey(null);
  };

  const moveQueueItem = async (timeWindow, idx, delta) => {
    const toIdx = idx + delta;
    if (toIdx < 0) return;
    const metaKey = `todayQueue:${todayKey}`;
    let snapshot = null;
    setQueue((prev) => {
      const arr = prev[timeWindow];
      if (toIdx >= arr.length) return prev;
      const next = { AM: [...prev.AM], PM: [...prev.PM] };
      const row = next[timeWindow];
      const [removed] = row.splice(idx, 1);
      row.splice(toIdx, 0, removed);
      snapshot = next;
      return next;
    });
    if (snapshot) await setMeta(metaKey, snapshot);
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
    <div className="container">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div>
          <div style={{ fontSize: '22px', fontWeight: 700, marginBottom: '2px' }}>Today</div>
          <div style={{ fontSize: '13px', color: 'var(--color-muted)' }}>Waiting list ({todayKey})</div>
        </div>
        <button
          onClick={() => {
            localStorage.removeItem('token');
            localStorage.removeItem('username');
            setToken(null);
            navigate('/login');
          }}
          className="btn btn-secondary"
          style={{ padding: '8px 12px' }}
        >
          Logout
        </button>
      </div>

      {/* Data status + Sync */}
      <div className="card" style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: isOnline ? 'var(--color-success)' : '#6B7280' }} />
              <div style={{ fontWeight: 800, fontSize: '14px' }}>{isOnline ? 'Online' : 'Offline'}</div>
              <div style={{ fontSize: '12px', color: 'var(--color-muted)' }}>
                Pending: {pendingOps}
              </div>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-muted)' }}>
              Last sync: {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : '—'}
            </div>
            {syncMsg && (
              <div style={{ fontSize: '12px', color: 'var(--color-muted)' }}>
                {syncMsg}
              </div>
            )}
          </div>

          <button
            type="button"
            className="btn btn-primary"
            disabled={!isOnline || syncing}
            onClick={async () => {
              const token = localStorage.getItem('token');
              if (!token) {
                setSyncMsg('Not logged in');
                return;
              }
              setSyncing(true);
              setSyncMsg(null);
              try {
                const result = await performSync(token);
                if (result?.success) {
                  setSyncMsg(result.message || 'Sync completed');
                } else {
                  setSyncMsg(`Sync failed: ${result?.error || 'unknown error'}`);
                }
              } catch (e) {
                setSyncMsg(`Sync failed: ${e?.message || 'unknown error'}`);
              } finally {
                setSyncing(false);
              }
            }}
            style={{ padding: '10px 14px', minWidth: '96px' }}
          >
            {syncing ? 'Syncing…' : 'Sync'}
          </button>
        </div>
      </div>

      {(['AM', 'PM']).map((tw) => {
        const items = queue[tw] || [];
        return (
          <div key={tw} className="card" style={{ marginBottom: '12px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '10px',
                gap: '8px',
                flexWrap: 'wrap'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '16px', fontWeight: 700 }}>{tw}</div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: '13px', padding: '6px 12px' }}
                  onClick={() =>
                    navigate(`/schedule/${todayKey}`, {
                      state: { openAddAppointment: true, timeWindow: tw }
                    })
                  }
                >
                  Add appointment
                </button>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-muted)' }}>{items.length} / 3</div>
            </div>

            {items.length === 0 ? (
              <div style={{ color: 'var(--color-muted)', fontSize: '14px' }}>No patients</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {items.map((item, idx) => {
                  const key = `${tw}:${item.childId}`;
                  const isExpanded = expandedKey === key;
                  const isWaiting = item.status === 'WAITING';
                  const isCancelled = item.status === 'CANCELLED';
                  const isRescheduled = item.status === 'RESCHEDULED';
                  const isAttended = item.status === 'ATTENDED';
                  const isGrey = item.status !== 'WAITING';
                  const row = queueChildById[item.childId];
                  const rowName = row?.name ?? '…';
                  const rowPatientId = row?.patientId ?? '';
                  return (
                    <div key={key} style={{ opacity: isGrey ? 0.45 : 1 }}>
                      <div
                        style={{
                          display: 'flex',
                          gap: '6px',
                          alignItems: 'stretch'
                        }}
                      >
                        <div
                          style={{
                            flexShrink: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                            justifyContent: 'center'
                          }}
                        >
                          <button
                            type="button"
                            aria-label="Move up"
                            title="Move up"
                            disabled={idx === 0}
                            onClick={() => void moveQueueItem(tw, idx, -1)}
                            style={{
                              minWidth: '40px',
                              minHeight: '36px',
                              padding: 0,
                              borderRadius: 'var(--radius-pill)',
                              border: '1px solid #e5e5ea',
                              background: idx === 0 ? '#f3f4f6' : '#f9fafb',
                              color: '#374151',
                              fontSize: '16px',
                              lineHeight: 1,
                              cursor: idx === 0 ? 'not-allowed' : 'pointer',
                              opacity: idx === 0 ? 0.45 : 1
                            }}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label="Move down"
                            title="Move down"
                            disabled={idx >= items.length - 1}
                            onClick={() => void moveQueueItem(tw, idx, 1)}
                            style={{
                              minWidth: '40px',
                              minHeight: '36px',
                              padding: 0,
                              borderRadius: 'var(--radius-pill)',
                              border: '1px solid #e5e5ea',
                              background: idx >= items.length - 1 ? '#f3f4f6' : '#f9fafb',
                              color: '#374151',
                              fontSize: '16px',
                              lineHeight: 1,
                              cursor: idx >= items.length - 1 ? 'not-allowed' : 'pointer',
                              opacity: idx >= items.length - 1 ? 0.45 : 1
                            }}
                          >
                            ↓
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => setExpandedKey((prev) => (prev === key ? null : key))}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            textAlign: 'left',
                            padding: '10px 12px',
                            borderRadius: 'var(--radius-card)',
                            border: '1px solid #e5e5ea',
                            background: '#fff',
                            cursor: 'pointer',
                            font: 'inherit'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                            <PatientNameBlock name={rowName} patientId={rowPatientId || undefined} />
                            <div style={{ fontSize: '12px', color: 'var(--color-muted)', flexShrink: 0, alignSelf: 'flex-start' }}>
                              {item.status}
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          aria-label="Contact"
                          title="Contact"
                          style={{ ...todayRowIconBtn, alignSelf: 'stretch' }}
                          onClick={() => {
                            void getChild(item.childId).then((c) => setTodayContactModal({ child: c ?? null }));
                          }}
                        >
                          <PhoneIcon />
                        </button>
                      </div>

                      {isExpanded &&
                        (isAttended ? (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
                            <button
                              className="btn btn-primary"
                              type="button"
                              onClick={() => navigate(`/children/${item.childId}`)}
                            >
                              Open profile
                            </button>
                            <button
                              className="btn btn-secondary"
                              type="button"
                              onClick={async () => {
                                await updateStatus(tw, item.childId, 'WAITING');
                              }}
                            >
                              Undo attended
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '8px' }}>
                            <button
                              className="btn btn-primary"
                              type="button"
                              onClick={async () => {
                                await updateStatus(tw, item.childId, 'ATTENDED');
                                navigate(`/children/${item.childId}`);
                              }}
                            >
                              Attended
                            </button>
                            <button
                              className="btn btn-secondary"
                              type="button"
                              onClick={async () => {
                                if (isRescheduled) {
                                  await updateStatus(tw, item.childId, 'WAITING');
                                } else {
                                  await updateStatus(tw, item.childId, 'RESCHEDULED');
                                  navigate(`/children/${item.childId}/appointment`, { state: { returnTo: '/' } });
                                }
                              }}
                            >
                              {isRescheduled ? 'Undo Reschedule' : 'Rescheduled'}
                            </button>
                            <button
                              className="btn"
                              type="button"
                              onClick={async () => {
                                await updateStatus(tw, item.childId, isCancelled ? 'WAITING' : 'CANCELLED');
                              }}
                              style={{ background: '#e5e7eb' }}
                            >
                              {isCancelled ? 'Undo Cancel' : 'Cancelled'}
                            </button>
                          </div>
                        ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {todayContactModal && (
        <PatientContactModal
          child={todayContactModal.child}
          onClose={() => setTodayContactModal(null)}
          getSmsBody={(c) => `Regarding ${formatChildDisplayName(c)} — Today ${todayKey}.`}
        />
      )}

      <NavBar />
    </div>
  );
};

export default Home;

