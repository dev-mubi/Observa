import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';
import { useAuth } from '../contexts/AuthContext';
import './LivePlayer.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';

const LivePlayer = () => {
  const { user } = useAuth();
  const [image, setImage] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Only connect if we have a user
    if (!user?.email) return;

    const socket = io(SOCKET_URL);

    socket.on('connect', () => {
      console.log('Connected to Signaling Server');
      setIsConnected(true);
      // Join my private security room
      socket.emit('join-room', user.email);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from Signaling Server');
      setIsConnected(false);
    });

    socket.on('live-frame', (base64Image) => {
      setImage(base64Image);
    });

    return () => {
      socket.disconnect();
    };
  }, [user]); // Re-connect if user changes

  return (
    <div className={`live-player-container ${!isConnected ? 'offline' : ''}`}>
      {image ? (
        <img 
            src={`data:image/jpeg;base64,${image}`} 
            alt="Live Stream" 
            className="live-stream-image"
        />
      ) : (
        <div className="no-signal">
            <div className="signal-icon">
                <div className="signal-bar"></div>
                <div className="signal-bar"></div>
                <div className="signal-bar"></div>
            </div>
            <p>{isConnected ? "Waiting for Camera..." : "Connecting to Server..."}</p>
        </div>
      )}

      {/* Overlay Info */}
      <div className="camera-overlay">
        <div className="cam-name">CAM-01 (Monitor)</div>
        <div className={`status-badge ${isConnected ? 'live' : 'offline'}`}>
            <span className="pulsing-dot"></span>
            {isConnected ? "LIVE" : "OFFLINE"}
        </div>
      </div>
    </div>
  );
};

export default LivePlayer;
