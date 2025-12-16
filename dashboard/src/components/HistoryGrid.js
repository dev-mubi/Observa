import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import IncidentSlideshow from './IncidentSlideshow';
import './HistoryGrid.css';

const API_URL = (process.env.REACT_APP_API_URL || 'http://localhost:5000') + '/api';

const HistoryGrid = () => {
  const { user } = useAuth();
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIncident, setSelectedIncident] = useState(null); // Modal State

  useEffect(() => {
    fetchHistory();
  }, [user]);

  const fetchHistory = async () => {
    try {
      if (!user?.email) return;
      
      const response = await axios.get(`${API_URL}/events`, {
        params: { user_email: user.email }
      });
      
      if (response.data.success) {
        setIncidents(response.data.incidents || []);
      }
    } catch (error) {
       // Silent fail or simple console error - user doesn't need alerts in prod
       console.error("History fetch error:", error.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="history-loading">Loading History...</div>;

  return (
    <>
      <div className="history-grid">
        {incidents.length === 0 ? (
          <p className="empty-state">No recorded incidents yet.</p>
        ) : (
          incidents.map((incident) => (
            <div 
              key={incident.id} 
              className="incident-card"
              onClick={() => setSelectedIncident(incident)}
            >
              <div className="incident-header">
                <div className="incident-time">
                  <span className="time-badge">
                    {new Date(incident.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="date-badge">
                    {new Date(incident.start_time).toLocaleDateString()}
                  </span>
                </div>
                <div className="incident-info">
                  <h3>{incident.total_events} Detections</h3>
                  <span className={`status ${incident.status}`}>{incident.status}</span>
                </div>
              </div>

              <div className="incident-preview">
                 {/* Show first image as cover */}
                 {incident.events?.[0] && (
                   <img 
                     src={incident.events[0].image_url} 
                     alt="Incident Cover" 
                     className="cover-image"
                   />
                 )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* MODAL VIEW */}
      {selectedIncident && (
        <div className="modal-overlay" onClick={() => setSelectedIncident(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Incident Details</h3>
              <button className="close-btn" onClick={() => setSelectedIncident(null)}>&times;</button>
            </div>
            <div className="modal-body">
               <div className="incident-meta-details" style={{marginBottom: '1rem', color: '#64748b'}}>
                  {new Date(selectedIncident.start_time).toLocaleString()} • {selectedIncident.total_events} Events
               </div>
               <IncidentSlideshow events={selectedIncident.events} />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default HistoryGrid;
