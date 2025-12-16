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
  const [expandedId, setExpandedId] = useState(null);

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
        setIncidents(response.data.events);
      }
    } catch (error) {
      console.error("Failed to fetch history:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  if (loading) return <div className="history-loading">Loading History...</div>;

  return (
    <div className="history-grid">
      {incidents.length === 0 ? (
        <p className="empty-state">No recorded incidents yet.</p>
      ) : (
        incidents.map((incident) => (
          <div 
            key={incident.id} 
            className={`incident-card ${expandedId === incident.id ? 'expanded' : ''}`}
            onClick={() => toggleExpand(incident.id)}
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
               {incident.security_events?.[0] && (
                 <img 
                   src={incident.security_events[0].image_url} 
                   alt="Incident Cover" 
                   className="cover-image"
                 />
               )}
            </div>

            {expandedId === incident.id && (
              <div className="incident-details" onClick={(e) => e.stopPropagation()}>
                <IncidentSlideshow events={incident.security_events} />
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
};

export default HistoryGrid;
