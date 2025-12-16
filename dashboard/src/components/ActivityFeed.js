import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';
import './ActivityFeed.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';

const ActivityFeed = () => {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    const socket = io(SOCKET_URL);

    // Join room for real-time events
    if (user?.email) {
      socket.emit('join-room', user.email);
    }

    socket.on('connect', () => {
      console.log('Activity Feed connected');
    });

    socket.on('new-event', (newEvent) => {
      setEvents((prev) => [newEvent, ...prev].slice(0, 50)); // Keep last 50
    });

    return () => socket.disconnect();
  }, []);

  return (
    <div className="card activity-card">
      <div className="card-header">
        <h2>Activity Log</h2>
        <span className="count-badge">{events.length}</span>
      </div>
      <div className="feed-list">
        {events.length === 0 ? (
          <div className="empty-feed">
            <p>No recent activity detected.</p>
            <small>Monitoring started...</small>
          </div>
        ) : (
          events.map((ev, index) => (
            <div key={ev.id || index} className="feed-item fade-in">
              <div className="feed-icon">
                 {/* Simple icon based on type (Person/Motion) - defaulting to user icon */}
                 <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                 </svg>
              </div>
              <div className="feed-content">
                <div className="feed-title">
                  <strong>Person Detected</strong>
                  <span className="feed-time">
                    {new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
                <div className="feed-meta">Camera 01 &bull; {ev.confidence ? `${Math.round(ev.confidence * 100)}% Match` : 'Motion'}</div>
              </div>
              {/* Optional Thumbnail on hover or distinct view */}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ActivityFeed;
