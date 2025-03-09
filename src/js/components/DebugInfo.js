import React, { useState, useEffect, useRef } from 'react';
import '../../css/DebugInfo.css';

const DebugInfo = ({ debugInfo, totalBlocks, totalEnvironmentObjects, terrainBuilderRef }) => {
  const [instancingEnabled, setInstancingEnabled] = useState(true);
  const [greedyMeshingEnabled, setGreedyMeshingEnabled] = useState(true);
  const [fps, setFps] = useState(0);
  const framesRef = useRef(0);
  const lastTimeRef = useRef(performance.now());

  // Initialize state from TerrainBuilder on mount
  useEffect(() => {
    if (terrainBuilderRef && terrainBuilderRef.current) {
      setInstancingEnabled(terrainBuilderRef.current.getInstancingEnabled());
      
      if (terrainBuilderRef.current.getGreedyMeshingEnabled) {
        setGreedyMeshingEnabled(terrainBuilderRef.current.getGreedyMeshingEnabled());
      }
    }
  }, [terrainBuilderRef]);
  
  // FPS counter
  useEffect(() => {
    let frameId;
    
    const measureFps = () => {
      framesRef.current++;
      const now = performance.now();
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
    
    return () => {
      cancelAnimationFrame(frameId);
    };
  }, []);

  const handleInstancingToggle = (e) => {
    const newValue = e.target.checked;
    setInstancingEnabled(newValue);
    
    if (terrainBuilderRef && terrainBuilderRef.current) {
      terrainBuilderRef.current.toggleInstancing(newValue);
      // Rebuilding all chunks would be expensive, so we'll let the user 
      // trigger rebuilds naturally through interactions
    }
  };

  const handleGreedyMeshingToggle = (e) => {
    const newValue = e.target.checked;
    setGreedyMeshingEnabled(newValue);
    
    if (terrainBuilderRef && terrainBuilderRef.current) {
      terrainBuilderRef.current.toggleGreedyMeshing(newValue);
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
        <span className="debug-label">Performance:</span>
        <div className="debug-value performance-toggles">
          <label className="toggle-label">
            <input 
              type="checkbox" 
              checked={instancingEnabled} 
              onChange={handleInstancingToggle}
            />
            Instanced Rendering
          </label>
          <label className="toggle-label">
            <input 
              type="checkbox" 
              checked={greedyMeshingEnabled} 
              onChange={handleGreedyMeshingToggle}
            />
            Greedy Meshing
          </label>
        </div>
      </div>
    </div>
  );
};

export default DebugInfo;
