import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();

  // If strictly loading (initial check), maybe show a spinner
  // For now, we rely on the fact that 'isAuthenticated' is set from localStorage initially
  
  if (!isAuthenticated && !isLoading) {
    return <Navigate to="/login" />;
  }

  return children;
};

export default ProtectedRoute;
