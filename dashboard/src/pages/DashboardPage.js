import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import LivePlayer from '../components/LivePlayer';
import HistoryGrid from '../components/HistoryGrid';
import '../App.css';

const DashboardPage = () => {
  const { user, logout } = useAuth();

  return (
    <div className="dashboard-container">
      {/* 1. Header (Navbar) */}
      <header className="dashboard-header">
        <div className="header-brand">
            <div className="header-logo-icon">O</div>
            <span>OBSERVA</span>
        </div>
        <div className="user-menu">
          <span>{user?.email}</span>
          <button onClick={logout} className="logout-btn">Sign Out</button>
        </div>
      </header>

      {/* 2. Main Content (Grid) */}
      <main className="dashboard-content">
        
        {/* Left Column: Live Video + History */}
        <div className="video-section">
          
          {/* A. Live Player Card */}
          <div className="card">
            <div className="card-header">
              <h2>Live Monitor</h2>
              <div className="live-badge">
                <span className="dot"></span> LIVE
              </div>
            </div>
            <div className="video-wrapper">
               <LivePlayer />
            </div>
          </div>

          {/* C. Recent History (Moved here for better flow) */}
          <div className="history-section">
            <h3>Recent Incidents</h3>
             <HistoryGrid />
          </div>
        
        </div>

      </main>
    </div>
  );
};

export default DashboardPage;
