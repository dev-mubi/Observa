import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('sentinel_token'));
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('sentinel_token'));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

  useEffect(() => {
    // If we have a token, verify it on mount
    if (token) {
      verifyToken(token);
    }
  }, []);

  const verifyToken = async (existingToken) => {
    try {
      const response = await axios.post(`${API_URL}/verify-token`, { accessToken: existingToken });
      if (response.data.valid) {
        setIsAuthenticated(true);
        setUser(response.data.user);
      } else {
        logout();
      }
    } catch (err) {
      logout();
    }
  };

  const login = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // 1. Get Auth URL and Session ID
      const { data } = await axios.get(`${API_URL}/login`);
      
      if (data.success) {
        // 2. Open Sentinel Login in new window
        window.open(data.authUrl, '_blank', 'width=500,height=600');
        
        // 3. Start Polling
        pollTokenStatus(data.sessionId);
      } else {
        setError('Failed to initiate login');
        setIsLoading(false);
      }
    } catch (err) {
      setError(err.message || 'Login failed');
      setIsLoading(false);
    }
  };

  const pollTokenStatus = (sessionId) => {
    const interval = setInterval(async () => {
      try {
        const { data } = await axios.get(`${API_URL}/token-status/${sessionId}`);
        
        if (data.status === 'success') {
          clearInterval(interval);
          handleLoginSuccess(data);
        } else if (data.status === 'error' || data.status === 'expired') {
          clearInterval(interval);
          setError(data.message);
          setIsLoading(false);
        }
        // If 'pending', continue polling
      } catch (err) {
        clearInterval(interval);
        setError('Polling failed');
        setIsLoading(false);
      }
    }, 2000); // Poll every 2 seconds

    // Safety timeout after 5 minutes
    setTimeout(() => {
      clearInterval(interval);
      if (isLoading) {
        setIsLoading(false);
        setError('Login timed out');
      }
    }, 5 * 60 * 1000);
  };

  const handleLoginSuccess = (data) => {
    const { accessToken, user } = data;
    localStorage.setItem('sentinel_token', accessToken);
    setToken(accessToken);
    setUser(user);
    setIsAuthenticated(true);
    setIsLoading(false);
  };

  const logout = () => {
    localStorage.removeItem('sentinel_token');
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ user, token, isAuthenticated, isLoading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
