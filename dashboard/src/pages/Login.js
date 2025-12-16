import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import '../App.css'; // We'll put styles here

const Login = () => {
  const { login, isAuthenticated, isLoading, error } = useAuth();

  if (isAuthenticated) {
    return <Navigate to="/" />;
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="logo-section">
          <h1>
            <span style={{ fontSize: '1.2em' }}>◎</span> Observa
          </h1>
        </div>
        
        <p className="description">
          Sign in to access your real-time security dashboard and view event history.
        </p>

        {error && <div className="error-message">{error}</div>}

        <button 
          className="sentinel-btn" 
          onClick={login} 
          disabled={isLoading}
        >
          {isLoading ? (
            <span className="loader"></span> 
          ) : (
            <>
              <span className="icon">🛡️</span>
              Login with Sentinel
            </>
          )}
        </button>

        <div className="secure-badge">
          <small>Secured by Sentinel OAuth</small>
        </div>
      </div>
    </div>
  );
};

export default Login;
