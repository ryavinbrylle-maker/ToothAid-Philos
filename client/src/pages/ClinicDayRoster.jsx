import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import NavBar from '../components/NavBar';
import PageHeader from '../components/PageHeader';
import { PatientNameBlock } from '../components/PatientNameBlock';
import { 
  getClinicDay, 
  getAppointmentsByClinicDay,
  getChild,
  upsertAppointment,
  upsertClinicDay,
  deleteClinicDay,
  addToOutbox,
  performSync
} from '../db/indexedDB';

const ClinicDayRoster = ({ token }) => {
  const { clinicDayId } = useParams();
  const navigate = useNavigate();
  const [clinicDay, setClinicDay] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [appointmentsWithChildren, setAppointmentsWithChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editDate, setEditDate] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      const day = await getClinicDay(clinicDayId);
      if (!day) {
        navigate('/schedule');
        return;
      }
      setClinicDay(day);

      const rosterAppointments = await getAppointmentsByClinicDay(clinicDayId);
      setAppointments(rosterAppointments);

      // Load child data for each appointment
      const appointmentsData = await Promise.all(
        rosterAppointments.map(async (appt) => {
          const child = await getChild(appt.childId);
          return { appointment: appt, child };
        })
      );
      setAppointmentsWithChildren(appointmentsData);
      setLoading(false);
    };
    
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [clinicDayId, navigate]);

  const handleStatusChange = async (appointmentId, newStatus) => {
    setSaving(true);
    try {
      const appointment = appointments.find(a => a.appointmentId === appointmentId);
      if (!appointment) return;

      const updatedAppointment = {
        ...appointment,
        status: newStatus
      };

      await upsertAppointment(updatedAppointment);
      await addToOutbox('UPSERT_APPOINTMENT', appointmentId, updatedAppointment);

      // Reload appointments
      const updatedAppointments = await getAppointmentsByClinicDay(clinicDayId);
      setAppointments(updatedAppointments);
      const updatedData = await Promise.all(
        updatedAppointments.map(async (appt) => {
          const child = await getChild(appt.childId);
          return { appointment: appt, child };
        })
      );
      setAppointmentsWithChildren(updatedData);

      // Try to sync if online
      if (navigator.onLine && token) {
        try {
          await performSync(token);
        } catch (syncError) {
          console.error('Sync error:', syncError);
        }
      }
    } catch (error) {
      console.error('Error updating status:', error);
      alert('Failed to update status');
    } finally {
      setSaving(false);
    }
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

  const handleEditClinicDay = () => {
    setEditDate(formatDateForInput(clinicDay.date));
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editDate) {
      alert('Please select a date');
      return;
    }

    setSaving(true);
    try {
      const updatedClinicDay = {
        ...clinicDay,
        date: new Date(editDate)
      };

      await upsertClinicDay(updatedClinicDay);
      await addToOutbox('UPSERT_CLINIC_DAY', clinicDayId, updatedClinicDay);
      
      setClinicDay(updatedClinicDay);
      setShowEditModal(false);

      // Try to sync if online
      if (navigator.onLine && token) {
        try {
          await performSync(token);
        } catch (syncError) {
          console.error('Sync error:', syncError);
        }
      }
    } catch (error) {
      console.error('Error updating clinic day:', error);
      alert('Failed to update clinic day');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClinicDay = async () => {
    setSaving(true);
    try {
      await deleteClinicDay(clinicDayId);
      await addToOutbox('DELETE_CLINIC_DAY', clinicDayId, { clinicDayId });

      // Try to sync if online
      if (navigator.onLine && token) {
        try {
          await performSync(token);
        } catch (syncError) {
          console.error('Sync error:', syncError);
        }
      }

      navigate('/clinic-days');
    } catch (error) {
      console.error('Error deleting clinic day:', error);
      alert('Failed to delete clinic day');
      setSaving(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'ATTENDED': return 'var(--color-success)';
      case 'MISSED': return 'var(--color-accent)';
      case 'RESCHEDULED': return 'var(--color-warning)';
      case 'CANCELLED': return '#6B7280';
      default: return 'var(--color-primary)';
    }
  };

  const getStatusCounts = () => {
    const counts = {
      SCHEDULED: 0,
      ATTENDED: 0,
      MISSED: 0,
      RESCHEDULED: 0,
      CANCELLED: 0
    };
    appointments.forEach(a => {
      counts[a.status] = (counts[a.status] || 0) + 1;
    });
    return counts;
  };

  if (loading || !clinicDay) {
    return (
      <div className="container">
        <div className="loading">Loading...</div>
        <NavBar />
      </div>
    );
  }

  const statusCounts = getStatusCounts();
  const hasAmPmCapacity = clinicDay.amCapacity !== null && clinicDay.pmCapacity !== null;
  const amCount = appointments.filter(a => a.timeWindow === 'AM').length;
  const pmCount = appointments.filter(a => a.timeWindow === 'PM').length;

  return (
    <div className="container">
<PageHeader title="Clinic Day Roster" subtitle={`${clinicDay.school} • ${formatDate(clinicDay.date)}`} icon="roster" />
      
      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button
          onClick={handleEditClinicDay}
          style={{ 
            padding: '8px 20px', 
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
          onClick={() => setShowDeleteConfirm(true)}
          style={{ 
            padding: '8px 20px', 
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

      {/* Roster Capacity Summary */}
      {hasAmPmCapacity && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <h3 style={{ marginBottom: '12px' }}>Roster Capacity</h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span>AM Slots:</span>
            <span style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--color-primary)' }}>
              {amCount} / {clinicDay.amCapacity}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>PM Slots:</span>
            <span style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--color-primary)' }}>
              {pmCount} / {clinicDay.pmCapacity}
            </span>
          </div>
        </div>
      )}

      {/* Status Summary */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <h3 style={{ marginBottom: '12px' }}>Status Summary</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '8px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--color-primary)' }}>
              {statusCounts.SCHEDULED}
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>Scheduled</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--color-success)' }}>
              {statusCounts.ATTENDED}
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>Attended</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--color-accent)' }}>
              {statusCounts.MISSED}
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>Missed</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--color-warning)' }}>
              {statusCounts.RESCHEDULED}
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>Rescheduled</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#6B7280' }}>
              {statusCounts.CANCELLED}
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>Cancelled</div>
          </div>
        </div>
      </div>

      {/* Appointments List */}
      {appointmentsWithChildren.length === 0 ? (
        <div className="empty-state">
          <p>No appointments scheduled</p>
        </div>
      ) : (
        <div>
          {appointmentsWithChildren.map(({ appointment, child }) => (
            <div key={appointment.appointmentId} className="card" style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {child?.childId ? (
                    <Link
                      to={`/children/${child.childId}/visit-entry`}
                      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
                    >
                      <PatientNameBlock child={child} />
                    </Link>
                  ) : (
                    <PatientNameBlock child={child} name="Unknown" />
                  )}
                  <p style={{ color: '#666', fontSize: '14px', marginBottom: '4px', marginTop: '8px' }}>
                    {appointment.timeWindow === 'AM' ? 'AM slot' : 
                     appointment.timeWindow === 'PM' ? 'PM slot' : 
                     'Full day'} • {appointment.reason.replace('_', ' ')}
                  </p>
                  {child && (
                    <p style={{ color: '#666', fontSize: '13px', margin: 0 }}>
                      {child.grade || 'No grade'} • {child.barangay}
                    </p>
                  )}
                  {child?.guardianPhone && (
                    <p style={{ color: 'var(--color-primary)', fontSize: '13px', margin: '4px 0 0 0' }}>
                      <a href={`tel:${child.guardianPhone}`} style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
                        {child.guardianPhone}
                      </a>
                    </p>
                  )}
                </div>
                <span style={{
                  padding: '4px 8px',
                  borderRadius: '20px',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  color: '#fff',
                  backgroundColor: getStatusColor(appointment.status)
                }}>
                  {appointment.status}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  className="btn"
                  onClick={() => handleStatusChange(appointment.appointmentId, 'ATTENDED')}
                  disabled={saving || appointment.status === 'ATTENDED'}
                  style={{
                    backgroundColor: appointment.status === 'ATTENDED' ? 'var(--color-success)' : '#E5E7EB',
                    color: appointment.status === 'ATTENDED' ? '#fff' : 'var(--color-text)',
                    flex: 1,
                    minWidth: '80px'
                  }}
                >
                  Attended
                </button>
                <button
                  className="btn"
                  onClick={() => handleStatusChange(appointment.appointmentId, 'MISSED')}
                  disabled={saving || appointment.status === 'MISSED'}
                  style={{
                    backgroundColor: appointment.status === 'MISSED' ? 'var(--color-accent)' : '#E5E7EB',
                    color: appointment.status === 'MISSED' ? '#fff' : 'var(--color-text)',
                    flex: 1,
                    minWidth: '80px'
                  }}
                >
                  Missed
                </button>
                <button
                  className="btn"
                  onClick={() => handleStatusChange(appointment.appointmentId, 'RESCHEDULED')}
                  disabled={saving || appointment.status === 'RESCHEDULED'}
                  style={{
                    backgroundColor: appointment.status === 'RESCHEDULED' ? 'var(--color-warning)' : '#E5E7EB',
                    color: appointment.status === 'RESCHEDULED' ? '#111827' : 'var(--color-text)',
                    flex: 1,
                    minWidth: '100px'
                  }}
                >
                  Rescheduled
                </button>
                <button
                  className="btn"
                  onClick={() => handleStatusChange(appointment.appointmentId, 'CANCELLED')}
                  disabled={saving || appointment.status === 'CANCELLED'}
                  style={{
                    backgroundColor: appointment.status === 'CANCELLED' ? '#6B7280' : '#E5E7EB',
                    color: appointment.status === 'CANCELLED' ? '#fff' : 'var(--color-text)',
                    flex: 1,
                    minWidth: '80px'
                  }}
                >
                  Cancelled
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: '24px', marginBottom: '16px' }}>
        <button
          className="btn btn-secondary"
          onClick={() => navigate(`/clinic-days/${clinicDayId}/build-roster`)}
          style={{ width: '100%', marginBottom: '8px' }}
        >
          Edit Roster
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => navigate('/schedule')}
          style={{ width: '100%' }}
        >
          Back to Schedule
        </button>
      </div>

      {/* Edit Modal */}
      {showEditModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '16px'
        }}>
          <div style={{
            backgroundColor: '#fff',
            borderRadius: '12px',
            padding: '24px',
            width: '100%',
            maxWidth: '400px'
          }}>
            <h2 style={{ marginBottom: '16px' }}>Edit Clinic Day</h2>
            
            <div className="form-group">
              <label>Date</label>
              <input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                className="form-input"
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setShowEditModal(false)}
                style={{ flex: 1 }}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveEdit}
                style={{ flex: 1 }}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '16px'
        }}>
          <div style={{
            backgroundColor: '#fff',
            borderRadius: '12px',
            padding: '24px',
            width: '100%',
            maxWidth: '400px'
          }}>
            <h2 style={{ marginBottom: '16px', color: 'var(--color-accent)' }}>Delete Clinic Day?</h2>
            
            <p style={{ marginBottom: '8px' }}>
              Are you sure you want to delete this clinic day?
            </p>
            <p style={{ color: '#666', fontSize: '14px', marginBottom: '16px' }}>
              <strong>{clinicDay.school}</strong><br />
              {formatDate(clinicDay.date)}<br />
              {appointments.length} appointment(s) will also be deleted.
            </p>

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setShowDeleteConfirm(false)}
                style={{ flex: 1 }}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="btn"
                onClick={handleDeleteClinicDay}
                style={{ 
                  flex: 1, 
                  backgroundColor: 'var(--color-accent)', 
                  color: '#fff' 
                }}
                disabled={saving}
              >
                {saving ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <NavBar />
    </div>
  );
};

export default ClinicDayRoster;
