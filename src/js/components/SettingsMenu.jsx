import React, { useState, useEffect } from 'react';
import './SettingsMenu.css';

/**
 * Settings Menu Component
 * 
 * Provides UI controls for various performance and rendering settings.
 */
const SettingsMenu = ({ terrainBuilder, environmentBuilder }) => {
  // States for toggles
  const [isOpen, setIsOpen] = useState(false);
  const [useWorkers, setUseWorkers] = useState(true);
  const [greedyMeshing, setGreedyMeshing] = useState(false);
  const [spatialHashing, setSpatialHashing] = useState(true);
  
  // Initialize from terrain builder settings if available
  useEffect(() => {
    if (terrainBuilder) {
      try {
        // Try to get current settings
        if (terrainBuilder.getGreedyMeshingEnabled) {
          setGreedyMeshing(terrainBuilder.getGreedyMeshingEnabled());
        }
        
        if (terrainBuilder.isSpatialHashRayCastingEnabled) {
          setSpatialHashing(terrainBuilder.isSpatialHashRayCastingEnabled());
        }
      } catch (error) {
        console.error('Error initializing settings:', error);
      }
    }
  }, [terrainBuilder]);
  
  // Toggle menu open/closed
  const toggleMenu = () => {
    setIsOpen(!isOpen);
  };
  
  // Toggle worker-based mesh generation
  const toggleWorkers = () => {
    const newValue = !useWorkers;
    setUseWorkers(newValue);
    
    if (terrainBuilder && terrainBuilder.toggleWorkerUsage) {
      terrainBuilder.toggleWorkerUsage(newValue);
    }
  };
  
  // Toggle greedy meshing
  const toggleGreedyMeshing = () => {
    const newValue = !greedyMeshing;
    setGreedyMeshing(newValue);
    
    if (terrainBuilder && terrainBuilder.toggleGreedyMeshing) {
      terrainBuilder.toggleGreedyMeshing(newValue);
    }
  };
  
  // Toggle spatial hashing for raycasting
  const toggleSpatialHashing = () => {
    const newValue = !spatialHashing;
    setSpatialHashing(newValue);
    
    if (terrainBuilder && terrainBuilder.toggleSpatialHashRayCasting) {
      terrainBuilder.toggleSpatialHashRayCasting(newValue);
    }
  };
  
  return (
    <div className={`settings-menu ${isOpen ? 'open' : 'closed'}`}>
      <button className="settings-toggle" onClick={toggleMenu}>
        {isOpen ? '✕' : '⚙️'}
      </button>
      
      {isOpen && (
        <div className="settings-panel">
          <h3>Performance Settings</h3>
          
          <div className="setting-item">
            <label>
              <input 
                type="checkbox" 
                checked={useWorkers} 
                onChange={toggleWorkers}
              />
              Worker-based Mesh Generation
            </label>
            <div className="setting-description">
              Offloads mesh generation to background threads.
              Prevents stuttering but may be slower on some devices.
            </div>
          </div>
          
          <div className="setting-item">
            <label>
              <input 
                type="checkbox" 
                checked={greedyMeshing} 
                onChange={toggleGreedyMeshing}
              />
              Greedy Meshing
            </label>
            <div className="setting-description">
              Merges adjacent faces with the same texture.
              Reduces polygon count significantly.
            </div>
          </div>
          
          <div className="setting-item">
            <label>
              <input 
                type="checkbox" 
                checked={spatialHashing} 
                onChange={toggleSpatialHashing}
              />
              Spatial Hashing for Raycasts
            </label>
            <div className="setting-description">
              Uses spatial partitioning to accelerate block selection.
              Greatly improves performance with large worlds.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsMenu; 