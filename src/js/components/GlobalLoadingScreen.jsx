import React, { useState, useEffect } from 'react';
import { loadingManager } from '../LoadingManager';
import hytopiaLogo from "../../images/hytopia_logo_white.png";
import { version } from '../Constants';
import '../../css/GlobalLoadingScreen.css';

const GlobalLoadingScreen = () => {
  const [loadingState, setLoadingState] = useState({
    isLoading: false,
    message: '',
    progress: null
  });

  useEffect(() => {
    // Subscribe to loading manager updates
    const unsubscribe = loadingManager.addListener(setLoadingState);
    
    // Cleanup subscription when component unmounts
    return () => unsubscribe();
  }, []);

  if (!loadingState.isLoading) {
    return null;
  }

  return (
    <div className="global-loading-screen">
      <div className="loading-content">
        <img src={hytopiaLogo} alt="Hytopia Logo" className="loading-logo" />
        
        <div className="loading-spinner"></div>
        
        <div className="loading-text">
          <i>{loadingState.message || 'Loading...'}</i>
        </div>
        
        {loadingState.progress !== null && (
          <div className="loading-progress">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${loadingState.progress}%` }}
              ></div>
            </div>
            <div className="progress-text">{loadingState.progress}%</div>
          </div>
        )}
        
        <div className="version-text">HYTOPIA Map Builder v{version}</div>
      </div>
    </div>
  );
};

export default GlobalLoadingScreen; 