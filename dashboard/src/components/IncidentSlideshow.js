import React, { useState } from 'react';
import './IncidentSlideshow.css';

const IncidentSlideshow = ({ events }) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!events || events.length === 0) return null;

  const currentEvent = events[currentIndex];

  const nextSlide = (e) => {
    e.stopPropagation(); // Prevent card collapse
    setCurrentIndex((prev) => (prev + 1) % events.length);
  };

  const prevSlide = (e) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev - 1 + events.length) % events.length);
  };

  return (
    <div className="slideshow-container">
      <div className="slide-viewer">
        <img 
          src={currentEvent.image_url} 
          alt={`Event ${currentIndex + 1}`} 
          className="slide-image"
        />
        
        {/* Navigation Overlays */}
        <button className="nav-btn prev" onClick={prevSlide}>&#10094;</button>
        <button className="nav-btn next" onClick={nextSlide}>&#10095;</button>

        {/* Info Overlay */}
        <div className="slide-info">
          <span className="slide-counter">{currentIndex + 1} / {events.length}</span>
          <span className="slide-time">
            {new Date(currentEvent.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>
      </div>
      
      {/* Timeline Strip */}
      <div className="timeline-strip">
        {events.map((ev, idx) => (
          <div 
            key={ev.id} 
            className={`timeline-dot ${idx === currentIndex ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setCurrentIndex(idx); }}
            title={new Date(ev.timestamp).toLocaleTimeString()}
          />
        ))}
      </div>
    </div>
  );
};

export default IncidentSlideshow;
