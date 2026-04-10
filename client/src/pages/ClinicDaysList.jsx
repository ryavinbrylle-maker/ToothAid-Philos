import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import NavBar from '../components/NavBar';
import PageHeader from '../components/PageHeader';
import { getAllClinicDays, getAppointmentCountForClinicDay } from '../db/indexedDB';

const ClinicDaysList = () => {
  const [clinicDays, setClinicDays] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      const days = await getAllClinicDays();
      // Load appointment counts for each clinic day
      const daysWithCounts = await Promise.all(
        days.map(async (day) => {
          const scheduledCount = await getAppointmentCountForClinicDay(day.clinicDayId, 'SCHEDULED');
          const attendedCount = await getAppointmentCountForClinicDay(day.clinicDayId, 'ATTENDED');
          return { ...day, scheduledCount, attendedCount };
        })
      );
      setClinicDays(daysWithCounts);
      setLoading(false);
    };
    
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  const formatDate = (date) => {
    if (!date) return 'N/A';
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'N/A';
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const year = d.getFullYear();
    return `${month}/${day}/${year}`;
  };

  const getDateStatus = (date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const clinicDate = new Date(date);
    clinicDate.setHours(0, 0, 0, 0);
    
    if (clinicDate < today) return 'past';
    if (clinicDate.getTime() === today.getTime()) return 'today';
    return 'upcoming';
  };

  if (loading) {
    return (
      <div className="container" style={{ overflowX: 'hidden' }}>
        <div className="loading">Loading...</div>
        <NavBar />
      </div>
    );
  }

  return (
    <div className="container" style={{ overflowX: 'hidden' }}>
<PageHeader title="Schedule" subtitle="Manage clinic schedule" icon="clinic" />

      <Link to="/create-clinic-day" className="btn btn-primary" style={{ marginBottom: '16px', display: 'block', textAlign: 'center' }}>
        + Create New Clinic Day
      </Link>

      {clinicDays.length === 0 ? (
        <div className="empty-state">
          <p>No clinic days scheduled</p>
        </div>
      ) : (
        <div>
          {clinicDays.map(day => {
            const status = getDateStatus(day.date);
            const statusColor =
              status === 'past'
                ? '#6B7280'
                : status === 'today'
                  ? 'var(--color-primary)'
                  : 'var(--color-success)';
            
            return (
              <Link key={day.clinicDayId} to={`/schedule/${day.clinicDayId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="card" style={{ cursor: 'pointer', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <h3 style={{ marginBottom: '4px' }}>
                      {day.school}
                    </h3>
                    <span style={{
                      padding: '4px 8px',
                      borderRadius: '20px',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      color: '#fff',
                      backgroundColor: statusColor
                    }}>
                      {status === 'past' ? 'Past' : status === 'today' ? 'Today' : 'Upcoming'}
                    </span>
                  </div>
                  <p style={{ color: '#666', fontSize: '14px', marginBottom: '8px' }}>
                    {formatDate(day.date)}
                  </p>
                  <p style={{ color: '#666', fontSize: '14px', marginBottom: '4px' }}>
                    Capacity: {day.capacity}
                    {day.amCapacity !== null && day.pmCapacity !== null && (
                      <span> (AM: {day.amCapacity}, PM: {day.pmCapacity})</span>
                    )}
                  </p>
                  <p style={{ color: '#666', fontSize: '14px', marginBottom: '4px' }}>
                    Scheduled: {day.scheduledCount || 0} • Attended: {day.attendedCount || 0}
                  </p>
                  {day.notes && (
                    <p style={{ marginTop: '8px', fontSize: '14px', color: '#666', fontStyle: 'italic' }}>
                      {day.notes}
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <NavBar />
    </div>
  );
};

export default ClinicDaysList;
