import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import NavBar from '../components/NavBar';
import PageHeader from '../components/PageHeader';
import PatientContactModal from '../components/PatientContactModal';
import { PatientNameBlock } from '../components/PatientNameBlock';
import {
  addToOutbox,
  deleteAppointment,
  getAllClinicDays,
  getAppointmentsByClinicDay,
  getChild,
  performSync,
  searchChildren,
  upsertAppointment,
  upsertClinicDay
} from '../db/indexedDB';
import { formatChildDisplayName } from '../utils/displayName';
import { notifyError, notifySuccess } from '../utils/notify';
import { toYmd } from '../utils/dates';

const byOrder = (a, b) => {
  const oa = a.order != null ? Number(a.order) : Infinity;
  const ob = b.order != null ? Number(b.order) : Infinity;
  if (oa !== ob) return oa - ob;
  return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
};

const rowIconBtn = {
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

const EditIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

export default function ScheduleDay({ token }) {
  const { date } = useParams(); // YYYY-MM-DD
  const navigate = useNavigate();
  const routeLocation = useLocation();

  const dateKey = useMemo(() => (typeof date === 'string' ? date : ''), [date]);
  const dayId = useMemo(() => `clinicday-${dateKey}`, [dateKey]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // quota + location (stored in clinicDays table, but treated as daily quota record)
  const [location, setLocation] = useState('BOCTOL');
  const [amQuota, setAmQuota] = useState('0');
  const [pmQuota, setPmQuota] = useState('0');

  // appointments (linked by clinicDayId === dayId)
  const [appointments, setAppointments] = useState([]);
  const [appointmentsWithChildren, setAppointmentsWithChildren] = useState([]);

  // add appointment UI
  const [showAdd, setShowAdd] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [pickedChildId, setPickedChildId] = useState('');
  /** Full child row chosen from search (for display + Add). */
  const [pickedChild, setPickedChild] = useState(null);
  const [pickedWindow, setPickedWindow] = useState('AM');
  const [pickedPriority, setPickedPriority] = useState('P2');
  const [pickedNote, setPickedNote] = useState('');
  /** In-app confirm when quota is full (some WebViews block window.confirm). */
  const [quotaOverflowModal, setQuotaOverflowModal] = useState(null); // null | { amU, pmU }
  const [duplicateApptModal, setDuplicateApptModal] = useState(false);

  /** null | appointment row being edited */
  const [editModalAppt, setEditModalAppt] = useState(null);
  const [editForm, setEditForm] = useState({
    timeWindow: 'AM',
    priority: 'P2',
    note: '',
    status: 'SCHEDULED'
  });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  /** Contact info popup: { child } */
  const [contactModal, setContactModal] = useState(null);

  const load = async () => {
    // Load quota record for this dateKey (prefer stable dayId)
    const all = await getAllClinicDays();
    const matches = all.filter((d) => toYmd(d.date) === dateKey);
    const stable = matches.find((d) => d.clinicDayId === dayId) || null;
    const latest =
      stable || matches.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null;

    if (latest) {
      setLocation(latest.school || 'BOCTOL');
      setAmQuota(String(latest.amCapacity ?? 0));
      setPmQuota(String(latest.pmCapacity ?? 0));
    } else {
      setLocation('BOCTOL');
      setAmQuota('0');
      setPmQuota('0');
    }

    const appts = await getAppointmentsByClinicDay(dayId);
    setAppointments(appts);
    const withChildren = await Promise.all(
      appts.map(async (a) => ({ appointment: a, child: await getChild(a.childId) }))
    );
    setAppointmentsWithChildren(withChildren);
  };

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      setLoading(false);
      return;
    }
    load()
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey, dayId]);

  const resetAddAppointmentForm = () => {
    setSearchQ('');
    setSearchResults([]);
    setPickedChildId('');
    setPickedChild(null);
    setPickedNote('');
  };

  const openAddAppointmentModal = () => {
    setEditModalAppt(null);
    setShowDeleteConfirm(false);
    resetAddAppointmentForm();
    setShowAdd(true);
  };

  /** From Today: preselect AM/PM and open add form */
  useEffect(() => {
    if (loading) return;
    const st = routeLocation.state;
    if (!st?.openAddAppointment) return;
    const tw = st.timeWindow;
    if (tw === 'AM' || tw === 'PM') setPickedWindow(tw);
    resetAddAppointmentForm();
    setShowAdd(true);
    navigate(`/schedule/${dateKey}`, { replace: true, state: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, routeLocation.state, dateKey, navigate]);

  useEffect(() => {
    const q = searchQ.trim();
    if (q.length < 1) {
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
  }, [searchQ]);

  const amTotal = Math.max(0, Number(amQuota) || 0);
  const pmTotal = Math.max(0, Number(pmQuota) || 0);
  const used = appointments.filter((a) => a.status !== 'CANCELLED');
  const amUsed = used.filter((a) => a.timeWindow === 'AM').length;
  const pmUsed = used.filter((a) => a.timeWindow === 'PM').length;
  const amRemaining = Math.max(0, amTotal - amUsed);
  const pmRemaining = Math.max(0, pmTotal - pmUsed);

  const saveQuota = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
    setSaving(true);
    try {
      const username = localStorage.getItem('username') || 'unknown';
      const nowIso = new Date().toISOString();
      const payload = {
        clinicDayId: dayId,
        date: dateKey,
        school: location,
        capacity: amTotal + pmTotal,
        amCapacity: amTotal,
        pmCapacity: pmTotal,
        notes: null,
        createdBy: username,
        createdAt: nowIso
      };
      await upsertClinicDay(payload);
      await addToOutbox('UPSERT_CLINIC_DAY', dayId, payload);
      if (navigator.onLine && token) {
        try {
          await performSync(token);
        } catch {}
      }
      notifySuccess('Saved quota.');
    } catch (e) {
      notifyError(e?.message || 'Failed to save quota');
    } finally {
      setSaving(false);
    }
  };

  const runAddAppointment = async (nextAmTotal, nextPmTotal, amU, pmU) => {
    setSaving(true);
    try {
      const apptsFresh = await getAppointmentsByClinicDay(dayId);
      const dup = apptsFresh.some(
        (a) =>
          a.childId === pickedChildId &&
          a.timeWindow === pickedWindow &&
          a.status !== 'CANCELLED'
      );
      if (dup) {
        setDuplicateApptModal(true);
        return;
      }

      const username = localStorage.getItem('username') || 'unknown';
      const nowIso = new Date().toISOString();
      const quotaPayload = {
        clinicDayId: dayId,
        date: dateKey,
        school: location,
        capacity: nextAmTotal + nextPmTotal,
        amCapacity: nextAmTotal,
        pmCapacity: nextPmTotal,
        notes: null,
        createdBy: username,
        createdAt: nowIso
      };
      await upsertClinicDay(quotaPayload);
      await addToOutbox('UPSERT_CLINIC_DAY', dayId, quotaPayload);

      const appointmentId = `appointment-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const order = pickedWindow === 'AM' ? amU : pmU;
      const appointmentData = {
        appointmentId,
        childId: pickedChildId,
        clinicDayId: dayId,
        timeWindow: pickedWindow,
        slotNumber: null,
        reason: 'FOLLOW_UP',
        status: 'SCHEDULED',
        priority: pickedPriority,
        note: pickedNote.trim() || null,
        order,
        createdBy: username,
        createdAt: now
      };

      await upsertAppointment(appointmentData);
      await addToOutbox('UPSERT_APPOINTMENT', appointmentId, appointmentData);

      const nextAppts = [...appointments, appointmentData];
      setAppointments(nextAppts);
      const child = await getChild(pickedChildId);
      setAppointmentsWithChildren([...appointmentsWithChildren, { appointment: appointmentData, child }]);

      if (navigator.onLine && token) {
        try {
          await performSync(token);
        } catch {}
      }

      setShowAdd(false);
      setSearchQ('');
      setSearchResults([]);
      setPickedChildId('');
      setPickedChild(null);
      setPickedNote('');
      notifySuccess('Appointment saved.');
    } catch (e) {
      notifyError(e?.message || 'Failed to save appointment');
    } finally {
      setSaving(false);
    }
  };

  const addAppointment = async () => {
    if (!pickedChildId) return;
    const apptsFresh = await getAppointmentsByClinicDay(dayId);
    const used = apptsFresh.filter((a) => a.status !== 'CANCELLED');
    if (used.some((a) => a.childId === pickedChildId && a.timeWindow === pickedWindow)) {
      setDuplicateApptModal(true);
      return;
    }
    const amU = used.filter((a) => a.timeWindow === 'AM').length;
    const pmU = used.filter((a) => a.timeWindow === 'PM').length;
    const amRem = Math.max(0, amTotal - amU);
    const pmRem = Math.max(0, pmTotal - pmU);
    const isFull = (pickedWindow === 'AM' && amRem <= 0) || (pickedWindow === 'PM' && pmRem <= 0);
    if (isFull) {
      setQuotaOverflowModal({ amU, pmU });
      return;
    }
    await runAddAppointment(amTotal, pmTotal, amU, pmU);
  };

  const confirmQuotaOverflow = async () => {
    if (!quotaOverflowModal) return;
    const { amU, pmU } = quotaOverflowModal;
    setQuotaOverflowModal(null);
    const nextAm = pickedWindow === 'AM' ? amTotal + 1 : amTotal;
    const nextPm = pickedWindow === 'PM' ? pmTotal + 1 : pmTotal;
    if (pickedWindow === 'AM') setAmQuota(String(nextAm));
    if (pickedWindow === 'PM') setPmQuota(String(nextPm));
    await runAddAppointment(nextAm, nextPm, amU, pmU);
  };

  const cancelQuotaOverflow = () => setQuotaOverflowModal(null);

  const renumberScheduledInWindow = async (clinicDayId, tw) => {
    const fresh = await getAppointmentsByClinicDay(clinicDayId);
    const sched = fresh.filter((a) => a.timeWindow === tw && a.status === 'SCHEDULED').slice().sort(byOrder);
    for (let i = 0; i < sched.length; i++) {
      if (Number(sched[i].order) === i) continue;
      const u = { ...sched[i], order: i };
      await upsertAppointment(u);
      await addToOutbox('UPSERT_APPOINTMENT', u.appointmentId, u);
    }
  };

  const openEditAppointment = (appt) => {
    setShowAdd(false);
    setShowDeleteConfirm(false);
    setEditModalAppt(appt);
    setEditForm({
      timeWindow: appt.timeWindow === 'PM' ? 'PM' : 'AM',
      priority: appt.priority || 'P2',
      note: appt.note != null ? String(appt.note) : '',
      status: appt.status || 'SCHEDULED'
    });
  };

  const closeEditAppointment = () => {
    setEditModalAppt(null);
    setShowDeleteConfirm(false);
  };

  const saveEditedAppointment = async () => {
    if (!editModalAppt) return;
    const base = editModalAppt;
    setSaving(true);
    try {
      const fresh = await getAppointmentsByClinicDay(dayId);
      const tw = editForm.timeWindow === 'PM' ? 'PM' : 'AM';

      if (editForm.status !== 'CANCELLED') {
        const dup = fresh.some(
          (a) =>
            a.appointmentId !== base.appointmentId &&
            a.childId === base.childId &&
            a.timeWindow === tw &&
            a.status !== 'CANCELLED'
        );
        if (dup) {
          setDuplicateApptModal(true);
          return;
        }
      }

      let orderVal = base.order;
      if (editForm.status === 'SCHEDULED') {
        const oldTw = base.timeWindow === 'PM' ? 'PM' : 'AM';
        if (tw !== oldTw || base.status !== 'SCHEDULED') {
          const cnt = fresh.filter(
            (a) =>
              a.appointmentId !== base.appointmentId &&
              a.timeWindow === tw &&
              a.status === 'SCHEDULED'
          ).length;
          orderVal = cnt;
        }
      } else {
        orderVal = null;
      }

      const updated = {
        ...base,
        timeWindow: tw,
        priority: editForm.priority,
        note: editForm.note.trim() || null,
        status: editForm.status,
        order: orderVal
      };

      await upsertAppointment(updated);
      await addToOutbox('UPSERT_APPOINTMENT', updated.appointmentId, updated);

      const windows = new Set([base.timeWindow === 'PM' ? 'PM' : 'AM', tw]);
      for (const w of windows) {
        await renumberScheduledInWindow(dayId, w);
      }

      await load();
      if (navigator.onLine && token) {
        try {
          await performSync(token);
        } catch {}
      }
      notifySuccess('Appointment updated.');
      closeEditAppointment();
    } catch (e) {
      notifyError(e?.message || 'Failed to update appointment');
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteAppointment = async () => {
    if (!editModalAppt) return;
    const apptId = editModalAppt.appointmentId;
    const tw = editModalAppt.timeWindow === 'PM' ? 'PM' : 'AM';
    setSaving(true);
    try {
      await deleteAppointment(apptId);
      await addToOutbox('DELETE_APPOINTMENT', apptId, { appointmentId: apptId });
      await renumberScheduledInWindow(dayId, tw);
      await load();
      if (navigator.onLine && token) {
        try {
          await performSync(token);
        } catch {}
      }
      notifySuccess('Appointment deleted.');
      closeEditAppointment();
    } catch (e) {
      notifyError(e?.message || 'Failed to delete appointment');
    } finally {
      setSaving(false);
    }
  };

  const amList = useMemo(() => appointments.filter((a) => a.timeWindow === 'AM').slice().sort(byOrder), [appointments]);
  const pmList = useMemo(() => appointments.filter((a) => a.timeWindow === 'PM').slice().sort(byOrder), [appointments]);

  const moveAppointmentInWindow = async (tw, sortedScheduledIndex, delta) => {
    const sched = appointments
      .filter((a) => a.timeWindow === tw && a.status === 'SCHEDULED')
      .slice()
      .sort(byOrder);
    const toIdx = sortedScheduledIndex + delta;
    if (toIdx < 0 || toIdx >= sched.length) return;
    const reordered = [...sched];
    const [removed] = reordered.splice(sortedScheduledIndex, 1);
    reordered.splice(toIdx, 0, removed);

    setSaving(true);
    try {
      for (let i = 0; i < reordered.length; i++) {
        const appt = reordered[i];
        if (Number(appt.order) === i) continue;
        const updated = { ...appt, order: i };
        await upsertAppointment(updated);
        await addToOutbox('UPSERT_APPOINTMENT', updated.appointmentId, updated);
      }
      await load();
      if (navigator.onLine && token) {
        try {
          await performSync(token);
        } catch {}
      }
      notifySuccess('Order updated.');
    } catch (e) {
      notifyError(e?.message || 'Failed to reorder');
    } finally {
      setSaving(false);
    }
  };

  const renderList = (label, list, remaining, tw) => {
    const scheduled = list.filter((a) => a.status === 'SCHEDULED').slice().sort(byOrder);
    const others = list.filter((a) => a.status !== 'SCHEDULED').slice().sort(byOrder);

    const rowInner = (appt, opts) => {
      const { showReorder, schedIdx } = opts || {};
      const child = appointmentsWithChildren.find((x) => x.appointment.appointmentId === appt.appointmentId)?.child;
      return (
        <div
          key={appt.appointmentId}
          style={{
            display: 'flex',
            gap: '6px',
            alignItems: 'stretch'
          }}
        >
          {showReorder && schedIdx != null ? (
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
                disabled={saving || schedIdx === 0}
                onClick={() => void moveAppointmentInWindow(tw, schedIdx, -1)}
                style={{
                  minWidth: '40px',
                  minHeight: '36px',
                  padding: 0,
                  borderRadius: 'var(--radius-pill)',
                  border: '1px solid #e5e5ea',
                  background: schedIdx === 0 ? '#f3f4f6' : '#f9fafb',
                  color: '#374151',
                  fontSize: '16px',
                  lineHeight: 1,
                  cursor: schedIdx === 0 || saving ? 'not-allowed' : 'pointer',
                  opacity: schedIdx === 0 ? 0.45 : 1
                }}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="Move down"
                title="Move down"
                disabled={saving || schedIdx >= scheduled.length - 1}
                onClick={() => void moveAppointmentInWindow(tw, schedIdx, 1)}
                style={{
                  minWidth: '40px',
                  minHeight: '36px',
                  padding: 0,
                  borderRadius: 'var(--radius-pill)',
                  border: '1px solid #e5e5ea',
                  background: schedIdx >= scheduled.length - 1 ? '#f3f4f6' : '#f9fafb',
                  color: '#374151',
                  fontSize: '16px',
                  lineHeight: 1,
                  cursor: schedIdx >= scheduled.length - 1 || saving ? 'not-allowed' : 'pointer',
                  opacity: schedIdx >= scheduled.length - 1 ? 0.45 : 1
                }}
              >
                ↓
              </button>
            </div>
          ) : null}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'stretch',
              gap: '8px'
            }}
          >
            <button
              type="button"
              onClick={() => openEditAppointment(appt)}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '10px 12px',
                borderRadius: 'var(--radius-card)',
                border: '1px solid #e5e5ea',
                background: '#fff',
                opacity: appt.status !== 'SCHEDULED' ? 0.75 : 1,
                cursor: 'pointer',
                textAlign: 'left',
                font: 'inherit'
              }}
            >
              <PatientNameBlock child={child} name={child ? undefined : 'Unknown'} />
              <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginTop: '6px' }}>
                {appt.status} · {appt.priority || 'P2'} · {appt.note || '—'}
              </div>
            </button>
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: '6px',
                flexShrink: 0,
                alignSelf: 'stretch'
              }}
            >
              <button
                type="button"
                aria-label="Contact"
                title="Contact"
                style={rowIconBtn}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContactModal({ child: child || null });
                }}
              >
                <PhoneIcon />
              </button>
              <button
                type="button"
                aria-label="Edit appointment"
                title="Edit"
                style={rowIconBtn}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openEditAppointment(appt);
                }}
              >
                <EditIcon />
              </button>
            </div>
          </div>
        </div>
      );
    };

    return (
      <div className="card" style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div style={{ fontSize: '16px', fontWeight: 800 }}>{label}</div>
          <div style={{ fontSize: '12px', color: 'var(--color-muted)' }}>Remaining: {remaining}</div>
        </div>
        {list.length === 0 ? (
          <div style={{ color: 'var(--color-muted)' }}>No appointments</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {scheduled.map((appt, schedIdx) => rowInner(appt, { showReorder: true, schedIdx }))}
            {others.map((appt) => rowInner(appt, { showReorder: false }))}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Loading...</div>
        <NavBar />
      </div>
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return (
      <div className="container">
        <div className="empty-state">Invalid date</div>
        <NavBar />
      </div>
    );
  }

  return (
    <div className="container" style={{ overflowX: 'hidden' }}>
      <PageHeader title="Schedule Day" subtitle={dateKey} icon="roster" />

      <div className="card" style={{ marginBottom: '12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Location</label>
            <select value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="BOCTOL">BOCTOL</option>
              <option value="CENTRAL">CENTRAL</option>
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>AM quota</label>
            <input type="number" min="0" value={amQuota} onChange={(e) => setAmQuota(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>PM quota</label>
            <input type="number" min="0" value={pmQuota} onChange={(e) => setPmQuota(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={saveQuota} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <button
        type="button"
        className="btn btn-secondary"
        style={{ width: '100%', marginBottom: '12px' }}
        onClick={openAddAppointmentModal}
      >
        Add appointment
      </button>

      {renderList('AM', amList, amRemaining, 'AM')}
      {renderList('PM', pmList, pmRemaining, 'PM')}

      {showAdd && (
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
            <h3 style={{ marginTop: 0, marginBottom: '12px' }}>Add appointment</h3>

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
              {!pickedChild && searchQ.trim().length === 0 && (
                <p style={{ margin: '8px 0 0', fontSize: '13px', color: 'var(--color-muted)' }}>
                  Start typing to see matching children.
                </p>
              )}
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
                          cursor: 'pointer',
                          display: 'block'
                        }}
                      >
                        <PatientNameBlock child={c} nameTag="div" />
                        <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginTop: '4px' }}>
                          {c.school || '—'}
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
                  background: '#eff6ff',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: '10px'
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#1d4ed8', marginBottom: '4px' }}>
                    Selected
                  </div>
                  <PatientNameBlock child={pickedChild} nameTag="div" />
                  <div style={{ fontSize: '12px', color: 'var(--color-muted)', marginTop: '4px' }}>
                    {pickedChild.school || '—'}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ flexShrink: 0 }}
                  onClick={() => {
                    setPickedChildId('');
                    setPickedChild(null);
                  }}
                >
                  Clear
                </button>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>AM / PM</label>
                <select value={pickedWindow} onChange={(e) => setPickedWindow(e.target.value)}>
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Priority</label>
                <select value={pickedPriority} onChange={(e) => setPickedPriority(e.target.value)}>
                  <option value="P0">P0</option>
                  <option value="P1">P1</option>
                  <option value="P2">P2</option>
                  <option value="P3">P3</option>
                </select>
              </div>
            </div>

            <div className="form-group" style={{ marginTop: '10px' }}>
              <label>Note</label>
              <textarea value={pickedNote} onChange={(e) => setPickedNote(e.target.value)} rows={3} placeholder="Optional note..." />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAdd(false)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={addAppointment} disabled={saving || !pickedChildId}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {editModalAppt && (
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
            zIndex: 1050,
            padding: '16px'
          }}
        >
          <div className="card" style={{ maxWidth: '520px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ marginTop: 0, marginBottom: '12px' }}>Edit appointment</h3>
            <div style={{ marginBottom: '12px' }}>
              <PatientNameBlock
                child={
                  appointmentsWithChildren.find((x) => x.appointment.appointmentId === editModalAppt.appointmentId)?.child
                }
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>AM / PM</label>
                <select
                  value={editForm.timeWindow}
                  onChange={(e) => setEditForm((f) => ({ ...f, timeWindow: e.target.value }))}
                  disabled={saving}
                >
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Priority</label>
                <select
                  value={editForm.priority}
                  onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value }))}
                  disabled={saving}
                >
                  <option value="P0">P0</option>
                  <option value="P1">P1</option>
                  <option value="P2">P2</option>
                  <option value="P3">P3</option>
                </select>
              </div>
            </div>

            <div className="form-group" style={{ marginTop: '10px' }}>
              <label>Status</label>
              <select
                value={editForm.status}
                onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                disabled={saving}
              >
                <option value="SCHEDULED">SCHEDULED</option>
                <option value="ATTENDED">ATTENDED</option>
                <option value="MISSED">MISSED</option>
                <option value="RESCHEDULED">RESCHEDULED</option>
                <option value="CANCELLED">CANCELLED</option>
              </select>
            </div>

            <div className="form-group" style={{ marginTop: '10px' }}>
              <label>Note</label>
              <textarea
                value={editForm.note}
                onChange={(e) => setEditForm((f) => ({ ...f, note: e.target.value }))}
                rows={3}
                placeholder="Optional note..."
                disabled={saving}
              />
            </div>

            {showDeleteConfirm ? (
              <div
                style={{
                  marginTop: '12px',
                  padding: '12px',
                  borderRadius: '12px',
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.35)'
                }}
              >
                <p style={{ margin: '0 0 10px', fontWeight: 650 }}>Delete this appointment permanently?</p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ flex: 1 }}
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={saving}
                  >
                    No
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ flex: 1, background: '#dc2626', borderColor: '#dc2626' }}
                    onClick={() => void confirmDeleteAppointment()}
                    disabled={saving}
                  >
                    {saving ? '…' : 'Yes, delete'}
                  </button>
                </div>
              </div>
            ) : null}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '14px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={closeEditAppointment} disabled={saving}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => void saveEditedAppointment()} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
              {!showDeleteConfirm ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ width: '100%', color: '#b91c1c', borderColor: '#fecaca' }}
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={saving}
                >
                  Delete appointment
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {contactModal && (
        <PatientContactModal
          child={contactModal.child}
          onClose={() => setContactModal(null)}
          getSmsBody={(c) => `Regarding ${formatChildDisplayName(c)} — appointment ${dateKey}.`}
        />
      )}

      {duplicateApptModal && (
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
            <h3 style={{ marginTop: 0, marginBottom: '12px' }}>Already in this slot</h3>
            <p style={{ margin: '0 0 16px', lineHeight: 1.5, color: 'var(--color-muted)' }}>
              This patient already has an appointment in the selected time window. A duplicate cannot be added.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => setDuplicateApptModal(false)}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {quotaOverflowModal && (
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
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={cancelQuotaOverflow} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => confirmQuotaOverflow()} disabled={saving}>
                {saving ? 'Saving…' : 'Continue'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: '10px' }}>
        <button type="button" className="btn btn-secondary btn-block" onClick={() => navigate('/schedule', { state: { refresh: true } })}>
          Back to month
        </button>
      </div>

      <NavBar />
    </div>
  );
}

