import React, { useState, useEffect, useRef } from 'react';
import '../../css/DebugInfo.css';

const DebugInfo = ({ debugInfo, totalBlocks, totalEnvironmentObjects, terrainBuilderRef }) => {
  const [instancingEnabled, setInstancingEnabled] = useState(true);
  const [greedyMeshingEnabled, setGreedyMeshingEnabled] = useState(true);
  const [selectionDistance, setSelectionDistance] = useState(64); // Default to 64
  const [mipmappingEnabled, setMipmappingEnabled] = useState(true); // Default to true
  const [mipmapQuality, setMipmapQuality] = useState('high'); // Default to high
  const [anisotropyLevel, setAnisotropyLevel] = useState(16); // Default to 16
  const [fps, setFps] = useState(0);
  const [frameTime, setFrameTime] = useState(0);
  const [maxFrameTime, setMaxFrameTime] = useState(0);
  const [showPerformanceDetails, setShowPerformanceDetails] = useState(false);
  const framesRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const previousFrameTimeRef = useRef(performance.now());
  
  // Initialize state from TerrainBuilder on mount
  useEffect(() => {
    if (terrainBuilderRef && terrainBuilderRef.current) {
      setInstancingEnabled(terrainBuilderRef.current.getInstancingEnabled());
      
      if (terrainBuilderRef.current.getGreedyMeshingEnabled) {
        setGreedyMeshingEnabled(terrainBuilderRef.current.getGreedyMeshingEnabled());
      }
      
      // Initialize selection distance if available
      if (terrainBuilderRef.current.getSelectionDistance) {
        setSelectionDistance(terrainBuilderRef.current.getSelectionDistance());
      }
      
      // Initialize mipmapping settings if available
      if (terrainBuilderRef.current.getMipmappingEnabled) {
        setMipmappingEnabled(terrainBuilderRef.current.getMipmappingEnabled());
      }
      
      if (terrainBuilderRef.current.getMipmapQuality) {
        setMipmapQuality(terrainBuilderRef.current.getMipmapQuality());
      }
      
      if (terrainBuilderRef.current.getAnisotropyLevel) {
        setAnisotropyLevel(terrainBuilderRef.current.getAnisotropyLevel());
      }
    }
  }, [terrainBuilderRef]);
  
  // FPS and frame time counter
  useEffect(() => {
    let frameId;
    
    const measureFps = () => {
      const now = performance.now();
      
      // Calculate frame time (time since last frame)
      const currentFrameTime = now - previousFrameTimeRef.current;
      previousFrameTimeRef.current = now;
      
      // Update frame time display (smoothed)
      setFrameTime(prev => 0.9 * prev + 0.1 * currentFrameTime);
      
      // Update max frame time (for spike detection)
      if (currentFrameTime > maxFrameTime && currentFrameTime < 1000) { // Ignore > 1s spikes (probably tab switching)
        setMaxFrameTime(currentFrameTime);
      }
      
      // Update FPS counter
      framesRef.current++;
      const elapsed = now - lastTimeRef.current;
      
      if (elapsed >= 1000) {
        // Update FPS every second
        setFps(Math.round((framesRef.current * 1000) / elapsed));
        framesRef.current = 0;
        lastTimeRef.current = now;
      }
      
      frameId = requestAnimationFrame(measureFps);
    };
    
    frameId = requestAnimationFrame(measureFps);
    
    // Set up a timer to reset max frame time every 5 seconds
    const maxTimeResetInterval = setInterval(() => {
      setMaxFrameTime(0);
    }, 5000);
    
    return () => {
      cancelAnimationFrame(frameId);
      clearInterval(maxTimeResetInterval);
    };
  }, [maxFrameTime]);

  const handleInstancingToggle = (e) => {
    const newValue = e.target.checked;
    setInstancingEnabled(newValue);
    
    if (terrainBuilderRef && terrainBuilderRef.current) {
      terrainBuilderRef.current.toggleInstancing(newValue);
    }
  };

  const handleGreedyMeshingToggle = (e) => {
    const newValue = e.target.checked;
    setGreedyMeshingEnabled(newValue);
    
    if (terrainBuilderRef && terrainBuilderRef.current) {
      terrainBuilderRef.current.toggleGreedyMeshing(newValue);
    }
  };
  
  const handleSelectionDistanceChange = (e) => {
    const newValue = parseInt(e.target.value);
    setSelectionDistance(newValue);
    
    if (terrainBuilderRef && terrainBuilderRef.current && terrainBuilderRef.current.setSelectionDistance) {
      terrainBuilderRef.current.setSelectionDistance(newValue);
    }
  };
  
  const togglePerformanceDetails = () => {
    setShowPerformanceDetails(!showPerformanceDetails);
  };
  
  const resetMaxFrameTime = () => {
    setMaxFrameTime(0);
  };

  const handleMipmappingToggle = (e) => {
    const newValue = e.target.checked;
    setMipmappingEnabled(newValue);
    
    if (terrainBuilderRef && terrainBuilderRef.current && terrainBuilderRef.current.toggleMipmapping) {
      terrainBuilderRef.current.toggleMipmapping(newValue);
    }
  };
  
  const handleMipmapQualityChange = (e) => {
    const newValue = e.target.value;
    setMipmapQuality(newValue);
    
    if (terrainBuilderRef && terrainBuilderRef.current && terrainBuilderRef.current.setMipmapQuality) {
      terrainBuilderRef.current.setMipmapQuality(newValue);
    }
  };
  
  const handleAnisotropyChange = (e) => {
    const newValue = parseInt(e.target.value);
    setAnisotropyLevel(newValue);
    
    if (terrainBuilderRef && terrainBuilderRef.current && terrainBuilderRef.current.setAnisotropyLevel) {
      terrainBuilderRef.current.setAnisotropyLevel(newValue);
    }
  };

  return (
    <div className="debug-info">
      <div className="debug-row">
        <span className="debug-label">FPS:</span>
        <span className="debug-value">
          <b className={fps < 30 ? "fps-low" : fps < 50 ? "fps-medium" : "fps-high"}>
            {fps}
          </b>
        </span>
      </div>
      
      <div className="debug-row">
        <span className="debug-label">Frame Time:</span>
        <span className="debug-value">
          <b className={frameTime > 33 ? "fps-low" : frameTime > 20 ? "fps-medium" : "fps-high"}>
            {frameTime.toFixed(1)}ms
          </b>
        </span>
      </div>
      
      <div className="debug-row">
        <span className="debug-label">Max Frame:</span>
        <span className="debug-value">
          <b className={maxFrameTime > 100 ? "fps-low" : maxFrameTime > 50 ? "fps-medium" : "fps-high"}>
            {maxFrameTime.toFixed(1)}ms
          </b>
          <button className="small-button" onClick={resetMaxFrameTime} title="Reset max frame time">R</button>
        </span>
      </div>
      
      <div className="single-line"></div>
      <div className="debug-row">
        <span className="debug-label">Preview Position:</span>
        <span className="debug-value">
          x: <b>{(debugInfo?.preview?.x || 0).toFixed(1)}</b><br></br>
          y: <b>{(debugInfo?.preview?.y || 0).toFixed(1)}</b><br></br>
          z: <b>{(debugInfo?.preview?.z || 0).toFixed(1)}</b>
        </span> 
      </div>
      <div className="single-line"></div>
      <div className="debug-row">
        <span className="debug-label">Total Blocks:</span>
        <span className="debug-value">
          <b>{totalBlocks || 0}</b>
        </span>
      </div>
      <div className="single-line"></div>
      <div className="debug-row">
        <span className="debug-label">Total Env. Objects:</span>
        <span className="debug-value">
          <b>{totalEnvironmentObjects}</b>
        </span>
      </div>
      
      <div className="single-line"></div>
      <div className="debug-row performance-settings">
        <span className="debug-label" onClick={togglePerformanceDetails} style={{cursor: 'pointer'}}>
          Performance {showPerformanceDetails ? '▼' : '►'}
        </span>
        
        {showPerformanceDetails && (
          <div className="performance-toggles">
            <div className="performance-toggle">
              <label>
                <input
                  type="checkbox"
                  checked={instancingEnabled}
                  onChange={handleInstancingToggle}
                />
                Use instancing
              </label>
              <div className="toggle-description">
                More efficient rendering for repeated blocks. Improves FPS but may cause visual glitches on some GPUs.
              </div>
            </div>
            
            <div className="performance-toggle">
              <label>
                <input
                  type="checkbox"
                  checked={greedyMeshingEnabled}
                  onChange={handleGreedyMeshingToggle}
                />
                Use greedy meshing
              </label>
              <div className="toggle-description">
                Combines adjacent blocks of the same type. Significantly improves performance for large flat areas.
              </div>
            </div>
            
            {/* Mipmapping controls */}
            <div className="performance-toggle">
              <label>
                <input
                  type="checkbox"
                  checked={mipmappingEnabled}
                  onChange={handleMipmappingToggle}
                />
                Enable mipmapping
              </label>
              <div className="toggle-description">
                Improves texture quality at different distances. May reduce pixelation but can slightly blur textures.
              </div>
            </div>
            
            {mipmappingEnabled && (
              <>
                <div className="performance-toggle">
                  <label>
                    Mipmap quality:
                    <select value={mipmapQuality} onChange={handleMipmapQualityChange}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </label>
                  <div className="toggle-description">
                    Higher quality looks better at angles but uses more GPU memory.
                  </div>
                </div>
                
                <div className="performance-toggle">
                  <label>
                    Anisotropic filtering:
                    <select value={anisotropyLevel} onChange={handleAnisotropyChange}>
                      <option value="1">Disabled</option>
                      <option value="2">2x</option>
                      <option value="4">4x</option>
                      <option value="8">8x</option>
                      <option value="16">16x</option>
                    </select>
                  </label>
                  <div className="toggle-description">
                    Improves texture clarity at steep angles. Higher values use more GPU resources.
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DebugInfo;
