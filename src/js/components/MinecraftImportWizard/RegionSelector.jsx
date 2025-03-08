import React, { useState, useEffect, useRef } from 'react';
import { 
  MAX_IMPORT_SIZE_X, 
  MAX_IMPORT_SIZE_Y, 
  MAX_IMPORT_SIZE_Z,
  DEFAULT_IMPORT_SIZE 
} from '../../Constants';

const RegionSelector = ({ worldData, onRegionSelected, initialRegion }) => {
  const [bounds, setBounds] = useState({
    minX: 0, minY: 0, minZ: 0,
    maxX: 0, maxY: 0, maxZ: 0
  });
  const [offsets, setOffsets] = useState({
    x: 0,
    z: 0
  });
  const [isValid, setIsValid] = useState(false);
  // Add ref to track previous bounds to avoid infinite loops
  const prevBoundsRef = useRef(null);
  const prevOffsetsRef = useRef(null);

  // Initialize bounds from worldData or initialRegion
  useEffect(() => {
    if (initialRegion) {
      setBounds(initialRegion);
    } else if (worldData && worldData.bounds) {
      // Select a reasonable size or the entire world if it's small enough
      if (
        worldData.bounds.maxX - worldData.bounds.minX + 1 <= MAX_IMPORT_SIZE_X &&
        worldData.bounds.maxY - worldData.bounds.minY + 1 <= MAX_IMPORT_SIZE_Y &&
        worldData.bounds.maxZ - worldData.bounds.minZ + 1 <= MAX_IMPORT_SIZE_Z
      ) {
        // The entire world fits within our limits
        selectEntireWorld();
      } else {
        // World is too large, select a centered region of reasonable size
        selectReasonableSize();
      }
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

  // When bounds or offsets change and they're valid, apply size limits and notify parent
  useEffect(() => {
    if (!isValid) return;
    
    // Apply size limits
    const trimmedBounds = {
      minX: bounds.minX,
      minY: bounds.minY,
      minZ: bounds.minZ,
      maxX: Math.min(bounds.maxX, bounds.minX + MAX_IMPORT_SIZE_X - 1),
      maxY: Math.min(bounds.maxY, bounds.minY + MAX_IMPORT_SIZE_Y - 1),
      maxZ: Math.min(bounds.maxZ, bounds.minZ + MAX_IMPORT_SIZE_Z - 1)
    };
    
    // Check if bounds or offsets have actually changed to avoid infinite loop
    const prevBounds = prevBoundsRef.current;
    const prevOffsets = prevOffsetsRef.current || { x: 0, z: 0 };
    
    const boundsChanged = !prevBounds || 
      prevBounds.minX !== trimmedBounds.minX ||
      prevBounds.minY !== trimmedBounds.minY ||
      prevBounds.minZ !== trimmedBounds.minZ ||
      prevBounds.maxX !== trimmedBounds.maxX ||
      prevBounds.maxY !== trimmedBounds.maxY ||
      prevBounds.maxZ !== trimmedBounds.maxZ;
    
    const offsetsChanged = prevOffsets.x !== offsets.x || prevOffsets.z !== offsets.z;
    
    if (boundsChanged || offsetsChanged) {
      // Update the previous bounds and offsets reference
      prevBoundsRef.current = { ...trimmedBounds };
      prevOffsetsRef.current = { ...offsets };
      
      // Call the callback with the trimmed bounds and offsets
      onRegionSelected({
        ...trimmedBounds,
        offsetX: offsets.x,
        offsetZ: offsets.z
      });
    }
  }, [bounds.minX, bounds.minY, bounds.minZ, bounds.maxX, bounds.maxY, bounds.maxZ, offsets.x, offsets.z, isValid]);

  const handleInputChange = (key, value) => {
    // Check if the value is empty or just a minus sign (allow typing negative numbers)
    if (value === '' || value === '-') {
      return;
    }
    
    const numValue = parseInt(value, 10);
    if (isNaN(numValue)) {
      return; // Don't update if not a valid number
    }
    
    let newBounds = { ...bounds };
    
    // Handle bounds input
    if (['minX', 'minY', 'minZ', 'maxX', 'maxY', 'maxZ'].includes(key)) {
      newBounds[key] = numValue;
      
      // Ensure min is always less than or equal to max
      if (key.startsWith('min') && numValue > newBounds[`max${key.slice(3)}`]) {
        newBounds[`max${key.slice(3)}`] = numValue;
      } else if (key.startsWith('max') && numValue < newBounds[`min${key.slice(3)}`]) {
        newBounds[`min${key.slice(3)}`] = numValue;
      }
      
      // Enforce size limits
      const axis = key.slice(-1);
      const minKey = `min${axis}`;
      const maxKey = `max${axis}`;
      const maxSize = axis === 'X' ? MAX_IMPORT_SIZE_X : (axis === 'Y' ? MAX_IMPORT_SIZE_Y : MAX_IMPORT_SIZE_Z);
      
      if (newBounds[maxKey] - newBounds[minKey] + 1 > maxSize) {
        if (key.startsWith('max')) {
          newBounds[maxKey] = newBounds[minKey] + maxSize - 1;
        } else {
          newBounds[minKey] = newBounds[maxKey] - maxSize + 1;
        }
      }
      
      setBounds(newBounds);
    }
  };
  
  const handleOffsetChange = (axis, value) => {
    // Check if the value is empty or just a minus sign (allow typing negative numbers)
    if (value === '' || value === '-') {
      return;
    }
    
    const numValue = parseInt(value, 10);
    if (isNaN(numValue)) {
      return; // Don't update if not a valid number
    }
    
    setOffsets(prev => ({
      ...prev,
      [axis]: numValue
    }));
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

  // Function to select a reasonable region size
  const selectReasonableSize = () => {
    if (worldData && worldData.bounds) {
      // Start from the center of the world
      const centerX = Math.floor((worldData.bounds.minX + worldData.bounds.maxX) / 2);
      const centerZ = Math.floor((worldData.bounds.minZ + worldData.bounds.maxZ) / 2);
      
      // Set a reasonable size
      const size = DEFAULT_IMPORT_SIZE;
      
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
  
  // Calculate final world bounds with offsets
  const finalWorldBounds = {
    minX: -Math.floor(width/2) + offsets.x, 
    maxX: width - Math.floor(width/2) - 1 + offsets.x,
    minY: 0,
    maxY: height - 1,
    minZ: -Math.floor(depth/2) + offsets.z,
    maxZ: depth - Math.floor(depth/2) - 1 + offsets.z
  };

  return (
    <div className="region-selector">
      <h3>Select Region to Import</h3>
      <p>Define the boundaries of the area you want to import. Maximum size: {MAX_IMPORT_SIZE_X}×{MAX_IMPORT_SIZE_Y}×{MAX_IMPORT_SIZE_Z} blocks.</p>

      <div className="region-selector-actions">
        <button className="secondary-button" onClick={selectEntireWorld}>
          Select Entire World
        </button>
        <button className="secondary-button" onClick={selectReasonableSize}>
          Select Default Region
        </button>
      </div>

      <div className="bounds-controls">
        <div className="bound-control">
          <label>Min X:</label>
          <input
            type="number"
            value={bounds.minX}
            onChange={(e) => handleInputChange('minX', e.target.value)}
            onBlur={(e) => {
              // Ensure the field has a valid number when focus is lost
              if (e.target.value === '' || e.target.value === '-') {
                handleInputChange('minX', '0');
              }
            }}
          />
        </div>
        <div className="bound-control">
          <label>Min Y:</label>
          <input
            type="number"
            value={bounds.minY}
            onChange={(e) => handleInputChange('minY', e.target.value)}
            onBlur={(e) => {
              if (e.target.value === '' || e.target.value === '-') {
                handleInputChange('minY', '0');
              }
            }}
          />
        </div>
        <div className="bound-control">
          <label>Min Z:</label>
          <input
            type="number"
            value={bounds.minZ}
            onChange={(e) => handleInputChange('minZ', e.target.value)}
            onBlur={(e) => {
              if (e.target.value === '' || e.target.value === '-') {
                handleInputChange('minZ', '0');
              }
            }}
          />
        </div>
        <div className="bound-control">
          <label>Max X:</label>
          <input
            type="number"
            value={bounds.maxX}
            onChange={(e) => handleInputChange('maxX', e.target.value)}
            onBlur={(e) => {
              if (e.target.value === '' || e.target.value === '-') {
                handleInputChange('maxX', '0');
              }
            }}
          />
        </div>
        <div className="bound-control">
          <label>Max Y:</label>
          <input
            type="number"
            value={bounds.maxY}
            onChange={(e) => handleInputChange('maxY', e.target.value)}
            onBlur={(e) => {
              if (e.target.value === '' || e.target.value === '-') {
                handleInputChange('maxY', '0');
              }
            }}
          />
        </div>
        <div className="bound-control">
          <label>Max Z:</label>
          <input
            type="number"
            value={bounds.maxZ}
            onChange={(e) => handleInputChange('maxZ', e.target.value)}
            onBlur={(e) => {
              if (e.target.value === '' || e.target.value === '-') {
                handleInputChange('maxZ', '0');
              }
            }}
          />
        </div>
      </div>
      
      <div className="offset-controls">
        <h4>Additional XZ Offset</h4>
        <p>Apply an offset to the final position. This affects which blocks are included in the import.</p>
        <div className="offset-inputs">
          <div className="bound-control">
            <label>X Offset:</label>
            <input
              type="number"
              value={offsets.x}
              onChange={(e) => handleOffsetChange('x', e.target.value)}
              onBlur={(e) => {
                if (e.target.value === '' || e.target.value === '-') {
                  handleOffsetChange('x', '0');
                }
              }}
            />
          </div>
          <div className="bound-control">
            <label>Z Offset:</label>
            <input
              type="number"
              value={offsets.z}
              onChange={(e) => handleOffsetChange('z', e.target.value)}
              onBlur={(e) => {
                if (e.target.value === '' || e.target.value === '-') {
                  handleOffsetChange('z', '0');
                }
              }}
            />
          </div>
        </div>
        <p className="hint-text">Note: Offset applies before trimming, so it affects which blocks are included in the import.</p>
      </div>

      {!isValid && (
        <div className="error-message">
          <p>Invalid region: All dimensions must be positive</p>
        </div>
      )}

      <div className="region-stats">
        <p>Region dimensions: {width} × {height} × {depth} blocks</p>
        <p>Total blocks in region: {blockCount.toLocaleString()}</p>
        {blockCount > 1000000 && (
          <p className="warning-message">
            Warning: Large regions may impact performance. Consider selecting a smaller area.
          </p>
        )}
        {(width > MAX_IMPORT_SIZE_X || height > MAX_IMPORT_SIZE_Y || depth > MAX_IMPORT_SIZE_Z) && (
          <p className="warning-message">
            Warning: Selected region exceeds maximum dimensions. It will be trimmed to {MAX_IMPORT_SIZE_X}×{MAX_IMPORT_SIZE_Y}×{MAX_IMPORT_SIZE_Z}.
          </p>
        )}
        <div className="centering-info">
          <h4>Coordinate Transformation</h4>
          <p>The selected region will be transformed when imported:</p>
          <ul>
            <li>Region is centered with origin at ({offsets.x},{offsets.z})</li>
            <li>Bottom of region (Y={bounds.minY}) ➔ Y=0</li>
            <li>Blocks outside import bounds after applying offset will be excluded</li>
          </ul>
          <p>Original center: ({Math.floor(bounds.minX + width/2)}, {Math.floor(bounds.minY + height/2)}, {Math.floor(bounds.minZ + depth/2)})</p>
          <p>After import, map will extend from ({finalWorldBounds.minX}, {finalWorldBounds.minY}, {finalWorldBounds.minZ}) to ({finalWorldBounds.maxX}, {finalWorldBounds.maxY}, {finalWorldBounds.maxZ})</p>
        </div>
      </div>
    </div>
  );
};

export default RegionSelector; 