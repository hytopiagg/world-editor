import React, { useState, useEffect } from 'react';

const RegionSelector = ({ worldData, onRegionSelected, initialRegion }) => {
  const [bounds, setBounds] = useState({
    minX: 0, minY: 0, minZ: 0,
    maxX: 0, maxY: 0, maxZ: 0
  });
  const [isValid, setIsValid] = useState(false);

  // Initialize bounds from worldData or initialRegion
  useEffect(() => {
    if (initialRegion) {
      setBounds(initialRegion);
    } else if (worldData && worldData.bounds) {
      setBounds({
        minX: worldData.bounds.minX,
        minY: worldData.bounds.minY,
        minZ: worldData.bounds.minZ,
        maxX: worldData.bounds.maxX,
        maxY: worldData.bounds.maxY,
        maxZ: worldData.bounds.maxZ
      });
    }
  }, [worldData, initialRegion]);

  // Calculate dimensions and block count
  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  const depth = bounds.maxZ - bounds.minZ + 1;
  const blockCount = width * height * depth;

  // Update validity whenever dimensions change
  useEffect(() => {
    setIsValid(width > 0 && height > 0 && depth > 0);
  }, [width, height, depth]);

  // When bounds change and they're valid, notify the parent component
  useEffect(() => {
    if (isValid) {
      onRegionSelected(bounds);
    }
  }, [bounds, isValid, onRegionSelected]);

  const handleInputChange = (key, value) => {
    const numValue = parseInt(value, 10);
    if (!isNaN(numValue)) {
      setBounds(prev => ({ ...prev, [key]: numValue }));
    }
  };

  // Function to select the entire world
  const selectEntireWorld = () => {
    if (worldData && worldData.bounds) {
      setBounds({
        minX: worldData.bounds.minX,
        minY: worldData.bounds.minY,
        minZ: worldData.bounds.minZ,
        maxX: worldData.bounds.maxX,
        maxY: worldData.bounds.maxY,
        maxZ: worldData.bounds.maxZ
      });
    }
  };

  // Function to select a reasonable region size if the world is too large
  const selectReasonableSize = () => {
    if (worldData && worldData.bounds) {
      // Start from the center of the world
      const centerX = Math.floor((worldData.bounds.minX + worldData.bounds.maxX) / 2);
      const centerZ = Math.floor((worldData.bounds.minZ + worldData.bounds.maxZ) / 2);
      
      // Set a reasonable size (e.g., 64x64x64)
      const size = 32;
      
      setBounds({
        minX: centerX - size,
        minY: worldData.bounds.minY,
        minZ: centerZ - size,
        maxX: centerX + size,
        maxY: Math.min(worldData.bounds.minY + 64, worldData.bounds.maxY),
        maxZ: centerZ + size
      });
    }
  };

  return (
    <div className="region-selector">
      <h3>Select Region to Import</h3>
      <p>Define the boundaries of the area you want to import. This allows you to crop out just the part of the map you need.</p>

      <div className="region-selector-actions">
        <button className="secondary-button" onClick={selectEntireWorld}>
          Select Entire World
        </button>
        <button className="secondary-button" onClick={selectReasonableSize}>
          Select 64×64 Region
        </button>
      </div>

      <div className="bounds-controls">
        <div className="bound-control">
          <label>Min X:</label>
          <input
            type="number"
            value={bounds.minX}
            onChange={(e) => handleInputChange('minX', e.target.value)}
          />
        </div>
        <div className="bound-control">
          <label>Min Y:</label>
          <input
            type="number"
            value={bounds.minY}
            onChange={(e) => handleInputChange('minY', e.target.value)}
          />
        </div>
        <div className="bound-control">
          <label>Min Z:</label>
          <input
            type="number"
            value={bounds.minZ}
            onChange={(e) => handleInputChange('minZ', e.target.value)}
          />
        </div>
        <div className="bound-control">
          <label>Max X:</label>
          <input
            type="number"
            value={bounds.maxX}
            onChange={(e) => handleInputChange('maxX', e.target.value)}
          />
        </div>
        <div className="bound-control">
          <label>Max Y:</label>
          <input
            type="number"
            value={bounds.maxY}
            onChange={(e) => handleInputChange('maxY', e.target.value)}
          />
        </div>
        <div className="bound-control">
          <label>Max Z:</label>
          <input
            type="number"
            value={bounds.maxZ}
            onChange={(e) => handleInputChange('maxZ', e.target.value)}
          />
        </div>
      </div>

      {!isValid && (
        <div className="error-message">
          <p>Invalid region: All dimensions must be positive</p>
        </div>
      )}

      <div className="region-stats">
        <p>Region dimensions: {width} × {height} × {depth} blocks</p>
        <p>Total blocks in region: {blockCount.toLocaleString()}</p>
        {blockCount > 100000 && (
          <p className="warning-message">
            Warning: Large regions may impact performance. Consider selecting a smaller area.
          </p>
        )}
      </div>
    </div>
  );
};

export default RegionSelector; 