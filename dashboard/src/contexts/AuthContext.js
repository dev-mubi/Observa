import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('sentinel_token'));
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('sentinel_token'));
  
  // FIX: Initialize loading to true if we are in the middle of a callback (have 'code')
  // This prevents ProtectedRoute from redirecting to /login before we exchange the token
  const hasAuthCode = !!new URLSearchParams(window.location.search).get('code');
  const [isLoading, setIsLoading] = useState(hasAuthCode);
  
  const [error, setError] = useState(null);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

  useEffect(() => {
    // 1. Check for Auth Code (redirect from Sentinel)
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code) {
      // Clear code from URL to prevent loop/re-use
      window.history.replaceState({}, document.title, window.location.pathname);
      exchangeCodeForToken(code);
    } 
    // 2. Or check for existing token
    else if (token) {
      verifyToken(token);
    }
  }, []);

  const exchangeCodeForToken = async (code) => {
    setIsLoading(true);
    try {
      const response = await axios.post(`${API_URL}/api/auth/exchange`, { code });
      if (response.data.success) {
        handleLoginSuccess(response.data);
      } else {
        setError(response.data.message || "Failed to exchange token");
        setIsLoading(false);
      }
    } catch (err) {
      console.error("Exchange error:", err);
      setError("Authentication failed during token exchange.");
      setIsLoading(false);
    }
  };

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
      // 1. Get Auth URL from Web Endpoint
      const { data } = await axios.get(`${API_URL}/login-web`);
      
      if (data.success) {
        // 2. Full Page Redirect (Standard Web OAuth)
        window.location.href = data.authUrl;
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
