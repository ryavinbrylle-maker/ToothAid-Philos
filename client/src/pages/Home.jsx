import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import NavBar from '../components/NavBar';
import PatientContactModal from '../components/PatientContactModal';
import { PatientNameBlock } from '../components/PatientNameBlock';
import {
  addToOutbox,
  getAllClinicDays,
  getAppointmentsByClinicDay,
  getChild,
  getLastSyncAt,
  getManualVisits,
  getMeta,
  getOutboxOps,
  performSync,
  setMeta,
  upsertAppointment
} from '../db/indexedDB';
import { countMissedAppointments, getSupersededAppointmentIds, isAppointmentHiddenAsSuperseded } from '../utils/appointmentStatus';
import { buildAppointmentScheduleMessage } from '../utils/appointmentMessages';
import { formatChildDisplayName } from '../utils/displayName';
import { toYmd } from '../utils/dates';
import {
  buildLatestFollowUpByChild,
  computeFollowUpDueAt,
  followUpSortRank,
  getFollowUpTimingLabel,
  isUrgentFollowUpTiming,
  normalizeFollowUpTiming,
  visitRequiresFollowUp
} from '../utils/followUpTiming';

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

const MAX_REMINDER_ROWS = 10;
const SEND_REMINDER_DAYS = 14;

/** Appointment statuses shown on Today's AM/PM roster (not a shrinking waiting list). */
const TODAY_BOARD_STATUSES = new Set(['SCHEDULED', 'ATTENDED', 'CANCELLED', 'RESCHEDULED']);

const appointmentStatusToQueueStatus = (apptStatus) => {
  if (apptStatus === 'SCHEDULED') return 'WAITING';
  if (apptStatus === 'ATTENDED' || apptStatus === 'CANCELLED' || apptStatus === 'RESCHEDULED') return apptStatus;
  return 'WAITING';
};

const TERMINAL_QUEUE_STATUSES = new Set(['ATTENDED', 'CANCELLED', 'RESCHEDULED']);

/** Prefer appointment status over stale meta WAITING; keep in-flight meta when appt still SCHEDULED. */
const mergeQueueStatus = (metaStatus, apptStatus) => {
  const appt = apptStatus || 'WAITING';
  const meta = metaStatus || 'WAITING';
  if (TERMINAL_QUEUE_STATUSES.has(appt)) return appt;
  if (TERMINAL_QUEUE_STATUSES.has(meta)) return meta;
  return appt;
};

/** Latest appointment row status per child (creation order tie-break). */
const latestQueueStatusByChild = (apptList) => {
  const sorted = sortAppointmentsByCreated(apptList);
  const map = new Map();
  for (const a of sorted) {
    if (!a?.childId) continue;
    map.set(a.childId, appointmentStatusToQueueStatus(a.status));
  }
  return map;
};

const scheduleStatusRank = (status) => {
  if (status === 'MISSED') return 0;
  if (status === 'CANCELLED') return 1;
  return 2;
};

const followUpTimingSortValue = (appt) => followUpSortRank(appt?.followUpTiming, appt?.followUpDays);

/** One row per child across missed/cancelled appointments and visit-flagged follow-ups. */
const compareUnifiedScheduleCandidates = (a, b) => {
  const pa = followUpTimingSortValue(a.appt);
  const pb = followUpTimingSortValue(b.appt);
  if (pa !== pb) return pa - pb;
  return compareScheduleRows(a, b);
};

const addDaysToYmd = (ymd, days) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
};

const compareScheduleRows = (a, b) => {
  const sa = scheduleStatusRank(a.appt.status);
  const sb = scheduleStatusRank(b.appt.status);
  if (sa !== sb) return sa - sb;
  const dueA = a.appt.followUpDueAt ? new Date(a.appt.followUpDueAt).getTime() : Infinity;
  const dueB = b.appt.followUpDueAt ? new Date(b.appt.followUpDueAt).getTime() : Infinity;
  if (dueA !== dueB) return dueA - dueB;
  return new Date(a.appt.createdAt || 0) - new Date(b.appt.createdAt || 0);
};

const compareSendReminderRows = (a, b) => {
  if (a.dateKey !== b.dateKey) return String(a.dateKey).localeCompare(String(b.dateKey));
  const twA = a.appt.timeWindow === 'PM' ? 1 : 0;
  const twB = b.appt.timeWindow === 'PM' ? 1 : 0;
  if (twA !== twB) return twA - twB;
  return new Date(a.appt.createdAt || 0) - new Date(b.appt.createdAt || 0);
};

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
 * Rebuild AM/PM roster: keep prior order + statuses for children still on today's board,
 * then fill empty slots from appointment order. Caller must pass existing meta read
 * AFTER async appointment loads to avoid overwriting in-flight status updates.
 */
const mergeQueueWindow = (boardForWindow, prevItems, maxN) => {
  const schedIds = uniqueChildOrderFromSched(boardForWindow);
  const allowed = new Set(schedIds);
  const apptStatusByChild = latestQueueStatusByChild(boardForWindow);
  const statusById = new Map();
  const ordered = [];

  if (prevItems && Array.isArray(prevItems)) {
    for (const it of prevItems) {
      if (!it?.childId || !allowed.has(it.childId)) continue;
      if (ordered.includes(it.childId)) continue;
      ordered.push(it.childId);
      statusById.set(it.childId, mergeQueueStatus(it.status, apptStatusByChild.get(it.childId)));
    }
  }

  for (const id of schedIds) {
    if (ordered.length >= maxN) break;
    if (!ordered.includes(id)) ordered.push(id);
  }

  return ordered.slice(0, maxN).map((childId) => ({
    childId,
    status: mergeQueueStatus(statusById.get(childId), apptStatusByChild.get(childId))
  }));
};

const Home = ({ setToken }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState({ AM: [], PM: [] }); // [{ childId, status }]
  const [slotQuota, setSlotQuota] = useState({ AM: 0, PM: 0 });
  const [expandedKey, setExpandedKey] = useState(null); // `${timeWindow}:${childId}`
  /** @type {{ [childId: string]: { name: string, patientId: string } }} */
  const [queueChildById, setQueueChildById] = useState({});
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingOps, setPendingOps] = useState(0);
  const [lastSyncAt, setLastSyncAtState] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null); // string
  /** null | { child, intent?, dateKey?, location?, timeWindow?, note? } */
  const [todayContactModal, setTodayContactModal] = useState(null);
  const [reminderSendRows, setReminderSendRows] = useState([]);
  const [followUpScheduleRows, setFollowUpScheduleRows] = useState([]);
  const [remindersPanelOpen, setRemindersPanelOpen] = useState(false);
  const [visitRemindersOpen, setVisitRemindersOpen] = useState(false);

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
        setSlotQuota({ AM: 0, PM: 0 });
        await setMeta(metaKey, empty);
        setLoading(false);
        return;
      }

      const stableDayId = `clinicday-${todayKey}`;
      const stable = todayClinicDays.find((d) => d.clinicDayId === stableDayId) || null;
      const todayClinicDay =
        stable ||
        todayClinicDays.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] ||
        null;
      const amMax = Math.max(0, Number(todayClinicDay?.amCapacity) || 0);
      const pmMax = Math.max(0, Number(todayClinicDay?.pmCapacity) || 0);

      const apptsArrays = await Promise.all(todayClinicDays.map((d) => getAppointmentsByClinicDay(d.clinicDayId)));
      const appts = apptsArrays.flat();
      const boardAppts = appts.filter((a) => TODAY_BOARD_STATUSES.has(a.status));
      const boardAm = boardAppts.filter((a) => a.timeWindow === 'AM');
      const boardPm = boardAppts.filter((a) => a.timeWindow === 'PM');

      // Read saved order + statuses only AFTER async work so we never clobber Attended/etc. with stale meta.
      const existing = await getMeta(metaKey);
      const existingQueue =
        existing && typeof existing === 'object' && Array.isArray(existing.AM) && Array.isArray(existing.PM)
          ? existing
          : null;

      const nextQueue = {
        AM: mergeQueueWindow(boardAm, existingQueue?.AM, amMax),
        PM: mergeQueueWindow(boardPm, existingQueue?.PM, pmMax)
      };

      setSlotQuota({ AM: amMax, PM: pmMax });
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

  useEffect(() => {
    const loadReminderDashboard = async () => {
      const allDays = await getAllClinicDays();
      if (!allDays?.length) {
        setFollowUpScheduleRows([]);
        setReminderSendRows([]);
        return;
      }
      const dayById = new Map(allDays.map((d) => [d.clinicDayId, d]));
      const apptArrays = await Promise.all(allDays.map((d) => getAppointmentsByClinicDay(d.clinicDayId)));
      const flat = apptArrays.flat();
      const supersededIds = getSupersededAppointmentIds(flat);
      const windowEnd = addDaysToYmd(todayKey, SEND_REMINDER_DAYS);

      const enrich = (appt) => {
        const cd = dayById.get(appt.clinicDayId);
        const dateKey = cd ? toYmd(cd.date) : '';
        const location = cd?.school || '—';
        return { appt, dateKey, location };
      };

      const manualVisits = await getManualVisits();
      const followUpByChild = buildLatestFollowUpByChild(manualVisits);

      const scheduleRaw = flat
        .filter(
          (a) =>
            a?.childId &&
            (a.status === 'MISSED' || a.status === 'CANCELLED') &&
            !isAppointmentHiddenAsSuperseded(a, supersededIds)
        )
        .map(enrich)
        .filter((row) => followUpByChild.has(row.appt.childId));

      const apptsByChild = new Map();
      for (const a of flat) {
        if (!a?.childId) continue;
        if (!apptsByChild.has(a.childId)) apptsByChild.set(a.childId, []);
        apptsByChild.get(a.childId).push(a);
      }

      const scheduleRawWithTiming = scheduleRaw.map((row) => {
        const fu = followUpByChild.get(row.appt.childId);
        const timing = fu?.timing ?? normalizeFollowUpTiming(null);
        return {
          ...row,
          appt: {
            ...row.appt,
            followUpTiming: timing,
            followUpDueAt: fu?.dueAt ?? null
          }
        };
      });

      const visitFollowUpRows = await Promise.all(
        manualVisits.filter(visitRequiresFollowUp).map(async (v) => {
          const child = await getChild(v.childId);
          const dateKey = toYmd(v.date);
          const timing = normalizeFollowUpTiming(v.followUpPriority);
          const ts = v.updatedAt || v.createdAt || new Date(0).toISOString();
          return {
            appt: {
              appointmentId: `visit-followup-${v.visitId}`,
              childId: v.childId,
              status: 'VISIT_FOLLOWUP',
              followUpTiming: timing,
              followUpDays: v.followUpDays ?? null,
              createdAt: ts,
              followUpDueAt:
                v.followUpDueAt != null && String(v.followUpDueAt).trim() !== ''
                  ? new Date(v.followUpDueAt).toISOString()
                  : computeFollowUpDueAt(v.date, timing, v.followUpDays),
              note: v.notes != null ? String(v.notes) : null,
              timeWindow: 'AM'
            },
            dateKey,
            location: child?.school || '—',
            visitSource: true,
            visitId: v.visitId
          };
        })
      );

      const scheduleCandidates = [...scheduleRawWithTiming, ...visitFollowUpRows];

      const sendRaw = flat
        .filter((a) => {
          if (!a?.childId || a.status !== 'SCHEDULED') return false;
          const cd = dayById.get(a.clinicDayId);
          const dk = cd ? toYmd(cd.date) : '';
          if (!dk || dk < todayKey || dk > windowEnd) return false;
          return true;
        })
        .map(enrich);

      const pickPerChild = (rows, cmp) => {
        const byChild = new Map();
        for (const row of rows) {
          const id = row.appt.childId;
          const cur = byChild.get(id);
          if (!cur || cmp(row, cur) < 0) byChild.set(id, row);
        }
        return [...byChild.values()].sort(cmp);
      };

      const pickedPerChild = pickPerChild(scheduleCandidates, compareUnifiedScheduleCandidates);
      const followUpPicked = [...pickedPerChild].sort(compareScheduleRows).slice(0, MAX_REMINDER_ROWS);
      const sendPicked = pickPerChild(sendRaw, compareSendReminderRows).slice(0, MAX_REMINDER_ROWS);

      const hydrate = async (rows) =>
        Promise.all(
          rows.map(async (row) => {
            const child = await getChild(row.appt.childId);
            const isVisit = Boolean(row.visitSource);
            const timing = normalizeFollowUpTiming(row.appt.followUpTiming);
            const childAppts = apptsByChild.get(row.appt.childId) || [];
            const missedCount = countMissedAppointments(childAppts);
            return {
              key: isVisit ? `vf:${row.visitId}` : row.appt.appointmentId,
              fromAppointmentId: isVisit ? null : row.appt.appointmentId,
              visitSource: isVisit,
              visitId: isVisit ? row.visitId : null,
              childId: row.appt.childId,
              child: child || null,
              childName: formatChildDisplayName(child) || 'Unknown',
              patientId: child?.patientId != null ? String(child.patientId).trim() : '',
              status: row.appt.status,
              statusDisplay: isVisit ? 'Visit follow-up' : row.appt.status,
              followUpTiming: timing,
              followUpDays: row.appt.followUpDays ?? null,
              followUpLabel: getFollowUpTimingLabel(timing, row.appt.followUpDays),
              missedCount,
              dateKey: row.dateKey,
              location: row.location,
              timeWindow: row.appt.timeWindow === 'PM' ? 'PM' : 'AM',
              procedureType: row.appt.procedureType,
              note: row.appt.note
            };
          })
        );

      const [followUpH, sendH] = await Promise.all([hydrate(followUpPicked), hydrate(sendPicked)]);
      setFollowUpScheduleRows(followUpH);
      setReminderSendRows(sendH);
    };

    const safe = () => {
      loadReminderDashboard().catch((e) => {
        console.error('Reminder dashboard load failed:', e);
        setFollowUpScheduleRows([]);
        setReminderSendRows([]);
      });
    };
    safe();
    const onFocus = () => safe();
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

  const findTodayAppointment = async (timeWindow, childId) => {
    const allClinicDays = await getAllClinicDays();
    const todayClinicDays = allClinicDays.filter((d) => toYmd(d.date) === todayKey);
    if (todayClinicDays.length === 0) return null;
    const apptsArrays = await Promise.all(todayClinicDays.map((d) => getAppointmentsByClinicDay(d.clinicDayId)));
    const appts = apptsArrays.flat();
    const matching = appts
      .filter((a) => a.childId === childId && a.timeWindow === timeWindow)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return matching.find((a) => a.status === 'SCHEDULED') || matching[0] || null;
  };

  const getTodayAppointmentContext = async (timeWindow, childId) => {
    const appt = await findTodayAppointment(timeWindow, childId);
    if (!appt) return { appointment: { timeWindow }, location: null };
    const allClinicDays = await getAllClinicDays();
    const clinicDay = allClinicDays.find((d) => d.clinicDayId === appt.clinicDayId);
    return {
      appointment: appt,
      location: clinicDay?.school || null
    };
  };

  const persistAppointmentStatus = async (timeWindow, childId, status, reason) => {
    const target = await findTodayAppointment(timeWindow, childId);
    if (!target) return false;
    const username = localStorage.getItem('username') || 'unknown';
    const nowIso = new Date().toISOString();
    const followUpStatuses = new Set(['CANCELLED', 'RESCHEDULED']);
    const needsFollowUp = followUpStatuses.has(status);
    const dueAtIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const nextFollowUps = Array.isArray(target.followUps) ? [...target.followUps] : [];
    const nextContactLogs = Array.isArray(target.contactLogs) ? [...target.contactLogs] : [];
    if (needsFollowUp) {
      nextFollowUps.push({
        reminderId: `reminder-${crypto.randomUUID()}`,
        type: 'REMINDER',
        reason: reason || status,
        dueAt: dueAtIso,
        createdAt: nowIso,
        createdBy: username,
        completedAt: null,
        completedBy: null
      });
      nextContactLogs.push({
        contactId: `contact-${crypto.randomUUID()}`,
        channel: 'SMS',
        direction: 'OUTBOUND',
        outcome: 'PENDING',
        note: `Auto-created from ${status} action on Today queue`,
        createdAt: nowIso,
        createdBy: username
      });
    }
    const updated = {
      ...target,
      status,
      statusChangedAt: nowIso,
      statusChangedBy: username,
      statusReason: reason || null,
      order: status === 'SCHEDULED' ? target.order : null,
      followUpNeeded: needsFollowUp,
      followUpDueAt: needsFollowUp ? dueAtIso : null,
      followUps: needsFollowUp ? nextFollowUps : target.followUps || [],
      contactLogs: needsFollowUp ? nextContactLogs : target.contactLogs || []
    };
    await upsertAppointment(updated);
    await addToOutbox('UPSERT_APPOINTMENT', updated.appointmentId, updated);
    if (navigator.onLine) {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          await performSync(token);
        } catch (_) {}
      }
    }
    return true;
  };

  const updateStatus = async (timeWindow, childId, status) => {
    const persisted = await persistAppointmentStatus(timeWindow, childId, status, 'updated-from-today-queue');
    if (!persisted) return;
    const localStatus = status === 'SCHEDULED' ? 'WAITING' : status;
    const next = { AM: [...queue.AM], PM: [...queue.PM] };
    next[timeWindow] = next[timeWindow].map((item) =>
      item.childId === childId ? { ...item, status: localStatus } : item
    );
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
          <div style={{ fontSize: '13px', color: 'var(--color-muted)' }}>Today's appointments ({todayKey})</div>
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
            className="btn btn-danger"
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

      <div className="card" style={{ marginBottom: '12px' }}>
        <button
          type="button"
          onClick={() => setRemindersPanelOpen((o) => !o)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: 0,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            textAlign: 'left',
            font: 'inherit'
          }}
          aria-expanded={remindersPanelOpen}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '16px', fontWeight: 800 }}>Reminders & follow-ups</div>
            <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginTop: '2px' }}>
              Follow-ups: {followUpScheduleRows.length} · Visit reminders: {reminderSendRows.length}
            </div>
          </div>
          <span style={{ fontSize: '14px', color: 'var(--color-muted)', flexShrink: 0 }} aria-hidden>
            {remindersPanelOpen ? '▲' : '▼'}
          </span>
        </button>

        {remindersPanelOpen && (
          <>
            <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid #e5e5ea' }}>
              <div style={{ fontSize: '15px', fontWeight: 800, marginBottom: '4px' }}>Schedule follow-ups</div>
              <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginBottom: '10px' }}>
                Based on visit follow-up timing (7 / 14 days or whenever). Missed slots show a missed count only — not
                emergency priority. Book a new slot; rescheduling links a previous appointment when applicable.
              </div>
              {followUpScheduleRows.length === 0 ? (
                <div style={{ color: 'var(--color-muted)', fontSize: '14px' }}>
                  No follow-ups needed, or all are already linked to a new booking.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {followUpScheduleRows.map((row) => {
                    const urgent = isUrgentFollowUpTiming(row.followUpTiming, row.followUpDays);
                    const statusLine = [
                      row.statusDisplay,
                      !row.visitSource && row.missedCount > 0
                        ? `${row.missedCount} missed`
                        : null
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <div
                        key={row.key}
                        style={{
                          border: urgent ? '1px solid #fecaca' : '1px solid #e5e5ea',
                          borderRadius: '12px',
                          padding: '10px 12px',
                          background: urgent ? '#fff7f7' : '#fafafa'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                          <PatientNameBlock name={row.childName} patientId={row.patientId || undefined} />
                          <div
                            style={{
                              fontSize: '12px',
                              fontWeight: urgent ? 700 : 400,
                              color: urgent ? '#b45309' : 'var(--color-muted)',
                              textAlign: 'right'
                            }}
                          >
                            {statusLine}
                          </div>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginTop: '4px' }}>
                          Follow-up: {row.followUpLabel}
                          {row.dateKey
                            ? row.visitSource
                              ? ` · Visit ${row.dateKey} · ${row.location}`
                              : ` · Was ${row.dateKey} (${row.timeWindow}) · ${row.location}`
                            : ''}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() =>
                              setTodayContactModal({
                                child: row.child,
                                intent: 'schedule',
                                dateKey: row.dateKey,
                                location: row.location,
                                timeWindow: row.timeWindow,
                                note: row.note
                              })
                            }
                          >
                            Contact
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() =>
                              navigate(`/children/${row.childId}/appointment`, {
                                state: {
                                  returnTo: '/',
                                  ...(row.fromAppointmentId
                                    ? { rescheduleFromAppointmentId: row.fromAppointmentId }
                                    : {})
                                }
                              })
                            }
                          >
                            Schedule
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #e5e5ea' }}>
              <button
                type="button"
                onClick={() => setVisitRemindersOpen((o) => !o)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  padding: 0,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  font: 'inherit'
                }}
                aria-expanded={visitRemindersOpen}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '15px', fontWeight: 800 }}>Visit reminders</div>
                  <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginTop: '2px' }}>
                    {reminderSendRows.length} in the next {SEND_REMINDER_DAYS} days — SMS or copy a reminder
                  </div>
                </div>
                <span style={{ fontSize: '14px', color: 'var(--color-muted)', flexShrink: 0 }} aria-hidden>
                  {visitRemindersOpen ? '▲' : '▼'}
                </span>
              </button>

              {visitRemindersOpen && (
                <div style={{ marginTop: '12px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-block"
                    style={{ marginBottom: '10px' }}
                    onClick={() => navigate('/schedule', { state: { openMonthForDate: todayKey } })}
                  >
                    Pick week on calendar
                  </button>
                  {reminderSendRows.length === 0 ? (
                    <div style={{ color: 'var(--color-muted)', fontSize: '14px' }}>
                      No upcoming scheduled visits in this window.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {reminderSendRows.map((row) => (
                        <div
                          key={row.key}
                          style={{
                            border: '1px solid #e5e5ea',
                            borderRadius: '12px',
                            padding: '10px 12px',
                            background: '#fafafa'
                          }}
                        >
                          <PatientNameBlock name={row.childName} patientId={row.patientId || undefined} />
                          <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginTop: '4px' }}>
                            {row.dateKey} ({row.timeWindow}) · {row.location}
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() =>
                                setTodayContactModal({
                                  child: row.child,
                                  intent: 'send_reminder',
                                  dateKey: row.dateKey,
                                  location: row.location,
                                  timeWindow: row.timeWindow,
                                  procedureType: row.procedureType,
                                  note: row.note
                                })
                              }
                            >
                              Contact / copy
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={() => row.dateKey && navigate(`/schedule/${row.dateKey}`)}
                              disabled={!row.dateKey}
                            >
                              Open day
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
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
              <div style={{ fontSize: '12px', color: 'var(--color-muted)' }}>{items.length} / {slotQuota[tw]}</div>
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
                            void Promise.all([
                              getChild(item.childId),
                              getTodayAppointmentContext(tw, item.childId)
                            ]).then(([c, apptCtx]) =>
                              setTodayContactModal({
                                child: c ?? null,
                                intent: 'send_reminder',
                                dateKey: todayKey,
                                location: apptCtx.location,
                                timeWindow: apptCtx.appointment?.timeWindow === 'PM' ? 'PM' : 'AM',
                                procedureType: apptCtx.appointment?.procedureType,
                                note: null
                              })
                            );
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
                                await updateStatus(tw, item.childId, 'SCHEDULED');
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
                                  await updateStatus(tw, item.childId, 'SCHEDULED');
                                } else {
                                  const target = await findTodayAppointment(tw, item.childId);
                                  if (!target) return;
                                  const ok = await persistAppointmentStatus(
                                    tw,
                                    item.childId,
                                    'RESCHEDULED',
                                    'rescheduled-from-today-queue'
                                  );
                                  if (!ok) return;
                                  navigate(`/children/${item.childId}/appointment`, {
                                    state: { returnTo: '/', rescheduleFromAppointmentId: target.appointmentId }
                                  });
                                }
                              }}
                            >
                              {isRescheduled ? 'Undo Reschedule' : 'Rescheduled'}
                            </button>
                            <button
                              className="btn"
                              type="button"
                              onClick={async () => {
                                await updateStatus(tw, item.childId, isCancelled ? 'SCHEDULED' : 'CANCELLED');
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
          getSmsBody={(c) => {
            const ctx = todayContactModal;
            const name = formatChildDisplayName(c);
            if (ctx.intent === 'schedule') {
              return `Hello, regarding ${name}: we need to schedule a dental appointment. Please reply or call when you're available. Thank you.`;
            }
            if (ctx.intent === 'send_reminder' && ctx.dateKey) {
              return buildAppointmentScheduleMessage({
                child: c,
                appointment: {
                  timeWindow: ctx.timeWindow,
                  procedureType: ctx.procedureType
                },
                date: ctx.dateKey,
                location: ctx.location
              });
            }
            return `Regarding ${name} — Today ${todayKey}.`;
          }}
        />
      )}

      <NavBar />
    </div>
  );
};

export default Home;

