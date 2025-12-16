import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import LivePlayer from '../components/LivePlayer';
import HistoryGrid from '../components/HistoryGrid';
import '../App.css';

const DashboardPage = () => {
  const { user, logout } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);

  return (
    <div className="dashboard-container">
      {/* 1. Header (Navbar) */}
      <header className="dashboard-header">
        <div className="header-brand">
            <div className="header-logo-icon">O</div>
            <span>OBSERVA</span>
        </div>
        
        {/* Desktop Menu */}
        <div className="user-menu">
          <span>{user?.email}</span>
          <button onClick={logout} className="logout-btn">Sign Out</button>
        </div>

        {/* Hamburger Button (Mobile Only) */}
        <button className="hamburger-btn" onClick={() => setIsMenuOpen(!isMenuOpen)}>
           <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
           </svg>
        </button>
      </header>
      
      {/* Mobile Navigation Dropdown */}
      {isMenuOpen && (
        <div className="mobile-nav-overlay">
           <div style={{fontWeight: 600, color: '#0f172a'}}>{user?.email}</div>
           <button onClick={logout} className="logout-btn" style={{textAlign: 'center', width: '100%'}}>Sign Out</button>
        </div>
      )}

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
