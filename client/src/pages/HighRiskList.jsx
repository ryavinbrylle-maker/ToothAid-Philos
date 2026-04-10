import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import NavBar from '../components/NavBar';
import PageHeader from '../components/PageHeader';
import { PatientNameBlock } from '../components/PatientNameBlock';
import { getHighRiskVisits } from '../db/indexedDB';

const HighRiskList = () => {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      const data = await getHighRiskVisits();
      // Only show High priority (tier 1); Routine (tier 2) is not shown
      const urgentOnly = data.filter(v => v.tier === 1);
      setVisits(urgentOnly);
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

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Loading...</div>
        <NavBar />
      </div>
    );
  }

  const getTierColor = (tier) => (tier === 1 ? 'var(--color-accent)' : 'var(--color-primary)');

  const getTierBadgeStyle = (tier) => {
    const color = getTierColor(tier);
    return {
      display: 'inline-block',
      padding: '4px 8px',
      borderRadius: '20px',
      fontSize: '11px',
      fontWeight: 'bold',
      color: '#fff',
      backgroundColor: color,
      marginRight: '8px',
      textTransform: 'uppercase'
    };
  };

  return (
    <div className="container">
<PageHeader title="Priority cases" subtitle="High priority cases" icon="alert" />

      {visits.length === 0 ? (
        <div className="empty-state">
          <p>No visits found</p>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: '24px' }}>
            <h2 style={{ fontSize: '18px', color: 'var(--color-accent)', marginBottom: '12px', fontWeight: 'bold' }}>
              High priority ({visits.length})
            </h2>
            {visits.map(visit => (
              <Link key={visit.visitId} to={`/children/${visit.childId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="card" style={{ cursor: 'pointer', marginBottom: '12px', borderLeft: '4px solid var(--color-accent)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {visit.child ? (
                        <PatientNameBlock child={visit.child} nameTag="h3" />
                      ) : (
                        <PatientNameBlock name="Unknown Child" nameTag="h3" />
                      )}
                    </div>
                    <span style={{ ...getTierBadgeStyle(1), alignSelf: 'flex-start' }}>High priority</span>
                  </div>
                  <p style={{ color: 'var(--color-muted)', fontSize: '14px', marginBottom: '8px' }}>
                    {formatDate(visit.date)}
                    {visit.createdBy && (
                      <span style={{ marginLeft: '8px', fontSize: '12px' }}>
                        • by {visit.createdBy}
                      </span>
                    )}
                  </p>
                  <div style={{ marginBottom: '8px' }}>
                    {visit.painFlag && <span className="flag-badge pain">Pain</span>}
                    {visit.swellingFlag && <span className="flag-badge swelling">Swelling</span>}
                  </div>
                  {(visit.decayedTeeth !== null || visit.missingTeeth !== null || visit.filledTeeth !== null) && (
                    <p style={{ fontSize: '13px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                      Decayed: {visit.decayedTeeth !== null ? visit.decayedTeeth : 'N/A'} •
                      Missing: {visit.missingTeeth !== null ? visit.missingTeeth : 'N/A'} •
                      Filled: {visit.filledTeeth !== null ? visit.filledTeeth : 'N/A'}
                    </p>
                  )}
                  {visit.notes && (
                    <p style={{ marginTop: '8px', fontSize: '14px', color: 'var(--color-muted)' }}>
                      {visit.notes}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <NavBar />
    </div>
  );
};

export default HighRiskList;
