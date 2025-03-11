import React, { useState, useRef, useCallback, useEffect } from 'react';
import { FaCloudUploadAlt, FaCog, FaMapMarkedAlt, FaCheck, FaTimes } from 'react-icons/fa';
import WorldMapSelector from './WorldMapSelector';

// Create Web Worker
const createWorker = () => {
  return new Worker(new URL('../../workers/minecraftParserWorker.js', import.meta.url));
};

// Default optimization options
const DEFAULT_OPTIONS = {
  // Filter out transparent blocks
  excludeTransparentBlocks: true,
  // Only load central regions if too many
  limitRegions: true,
  // Max number of regions to load
  maxRegions: 25,
  // Memory limit in MB before stopping
  memoryLimit: 1000,
  // Vertical bounds
  minY: 10,
  maxY: 100,
  // Horizontal bounds (X/Z coordinates)
  filterByCoordinates: true,
  minX: -150,
  maxX: 150,
  minZ: -150,
  maxZ: 150,
  // Chunk sampling factor (1 = all chunks, 2 = every other chunk)
  chunkSamplingFactor: 1,
  // Maximum number of blocks to load (0 = unlimited)
  maxBlocks: 7000000
};

const UploadStep = ({ onWorldLoaded }) => {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [options, setOptions] = useState({ ...DEFAULT_OPTIONS });
  const [memoryUsage, setMemoryUsage] = useState(null);
  const [filterStats, setFilterStats] = useState(null);
  
  // State for world size scanning
  const [worldSizeInfo, setWorldSizeInfo] = useState(null);
  const [showSizeSelector, setShowSizeSelector] = useState(false);
  const [selectedBounds, setSelectedBounds] = useState(null);
  const [worldData, setWorldData] = useState(null); // Add state for worldData
  
  const fileInputRef = useRef(null);
  const workerRef = useRef(null);
  const zipDataRef = useRef(null); // Store the zip data for later use
  
  // Reset state when we go back to this step
  useEffect(() => {
    // If we had world data before but don't now, we're going back to start over
    if (!worldData) {
      // Reset all state
      setUploading(false);
      setError(null);
      setProgress(0);
      setProgressMessage('');
      setShowAdvanced(false);
      setOptions({ ...DEFAULT_OPTIONS });
      setMemoryUsage(null);
      setFilterStats(null);
      setWorldSizeInfo(null);
      setShowSizeSelector(false);
      setSelectedBounds(null);
      
      // Clean up any worker
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      
      // Clean up any stored zip data
      zipDataRef.current = null;
    }
  }, [worldData]);
  
  // Clean up worker on unmount
  React.useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);
  
  const handleOptionChange = (key, value) => {
    setOptions(prev => ({
      ...prev,
      [key]: typeof value === 'number' ? Number(value) : value
    }));
  };
  
  const handleFileSelect = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    // Validate file type and size
    if (!file.name.endsWith('.zip')) {
      setError('Please upload a Minecraft world as a ZIP file. The file should have a .zip extension.');
      return;
    }
    
    if (file.size > 100 * 1024 * 1024) {
      setError('The world file is too large (>100MB). For better performance, consider selecting a smaller world or exporting a specific region.');
      return;
    }
    
    setUploading(true);
    setError(null);
    setProgress(0);
    setProgressMessage('Starting upload...');
    setMemoryUsage(null);
    setWorldSizeInfo(null);
    setShowSizeSelector(false);
    
    try {
      // Initialize web worker
      if (workerRef.current) {
        workerRef.current.terminate();
      }
      
      workerRef.current = createWorker();
      
      // Set up message handler
      workerRef.current.onmessage = (e) => {
        const { type, data, error } = e.data;
        
        if (type === 'progress') {
          setProgress(data.progress);
          setProgressMessage(data.message || '');
          if (data.memoryUsage) {
            setMemoryUsage(data.memoryUsage);
          }
          if (data.skippedChunks) {
            setFilterStats(data.skippedChunks);
          }
        } else if (type === 'worldSizeScanned') {
          // First phase complete - got world size info
          setUploading(false);
          setProgress(100);
          setProgressMessage('World scan complete!');
          setWorldSizeInfo(data);
          setShowSizeSelector(true);
          
          // Set initial selected bounds with 300x300 XZ area centered around the origin
          // and Y range from 10 to 100
          if (data && data.bounds) {
            const centerX = Math.floor(((data.bounds.minX || 0) + (data.bounds.maxX || 0)) / 2);
            const centerZ = Math.floor(((data.bounds.minZ || 0) + (data.bounds.maxZ || 0)) / 2);
            
            setSelectedBounds({
              minX: centerX - 150, // 300/2 = 150
              maxX: centerX + 149, // 300/2 = 150 (minus 1 to account for inclusive bounds)
              minY: 10,
              maxY: 100,
              minZ: centerZ - 150,
              maxZ: centerZ + 149
            });
          } else {
            // Fallback if bounds data is missing
            console.warn("World size data missing bounds, using defaults");
            setSelectedBounds({
              minX: -150,
              maxX: 149,
              minY: 10,
              maxY: 100,
              minZ: -150,
              maxZ: 149
            });
          }
        } else if (type === 'worldParsed') {
          // Second phase complete - got full world data
          setUploading(false);
          setProgress(100);
          setProgressMessage('World loading complete!');
          setShowSizeSelector(false); // Hide region selector after parsing
          
          // Ensure we have valid bounds
          if (!selectedBounds) {
            console.warn("No bounds selected, using defaults from world size info");
            // Set default bounds if none were selected
            const worldBounds = data.bounds || {
              minX: -150, maxX: 150, minY: 10, maxY: 100, minZ: -150, maxZ: 150
            };
            
            setSelectedBounds(worldBounds);
          }
          
          // Use bounds with null protection
          const bounds = selectedBounds || data.bounds || {
            minX: -150, maxX: 150, minY: 10, maxY: 100, minZ: -150, maxZ: 150
          };
          
          // Save the selected bounds in the world data to use instead of the separate region selection step
          const worldDataWithRegion = {
            ...data,
            // Add selected region info with safe calculations
            selectedRegion: {
              ...bounds,
              width: (bounds.maxX - bounds.minX + 1) || 300,
              height: (bounds.maxY - bounds.minY + 1) || 90,
              depth: (bounds.maxZ - bounds.minZ + 1) || 300
            }
          };
          
          // Update local state
          setWorldData(worldDataWithRegion);
          
          // Auto-progress to the next step
          onWorldLoaded(worldDataWithRegion);
        } else if (type === 'error') {
          setUploading(false);
          setProgress(0);
          setError(error || 'An unknown error occurred');
        } else if (type === 'memoryUpdate') {
          setMemoryUsage(data);
        }
      };
      
      // Start the first phase - scan world size
      const arrayBuffer = await file.arrayBuffer();
      zipDataRef.current = arrayBuffer; // Store for later use
      
      // First, scan the world size
      workerRef.current.postMessage({
        type: 'scanWorldSize',
        data: { 
          zipFile: arrayBuffer
        }
      });
    } catch (e) {
      setUploading(false);
      setProgress(0);
      setError('Error processing file: ' + e.message);
    }
  }, [onWorldLoaded]);
  
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);
  
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = e.dataTransfer?.files;
    if (files?.length > 0) {
      // Create a synthetic event object with the files
      handleFileSelect({ target: { files } });
    }
  }, [handleFileSelect]);
  
  const handleBrowseClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);
  
  // Handle the user selecting bounds and proceeding to parsing
  const handleStartParsing = () => {
    if (!zipDataRef.current || !selectedBounds) return;
    
    setUploading(true);
    setProgress(0);
    setProgressMessage('Starting world parsing with selected bounds...');
    setShowSizeSelector(false);
    
    // Update options with selected bounds
    const updatedOptions = {
      ...options,
      filterByCoordinates: true,
      minX: selectedBounds.minX,
      maxX: selectedBounds.maxX,
      minY: selectedBounds.minY,
      maxY: selectedBounds.maxY,
      minZ: selectedBounds.minZ,
      maxZ: selectedBounds.maxZ
    };
    
    // Start the second phase - parse world with selected bounds
    workerRef.current.postMessage({
      type: 'parseWorld',
      data: { 
        zipFile: zipDataRef.current,
        options: updatedOptions
      }
    });
  };
  
  // Handle the user canceling the import after seeing the size
  const handleCancelImport = () => {
    setWorldSizeInfo(null);
    setShowSizeSelector(false);
    zipDataRef.current = null;
  };
  
  // Update selected bounds
  const handleBoundsChange = (bounds) => {
    setSelectedBounds(bounds);
  };
  
  return (
    <div className="upload-step">
      <h3>Upload Your Minecraft World</h3>
      <p>Select a Minecraft Java Edition world ZIP file from version 1.21.x or newer.</p>
      
      {/* Show the world size info and selector if we have it */}
      {showSizeSelector && worldSizeInfo && (
        <div className="world-size-selector">
          <h4>World Size Information</h4>
          <div className="world-info-panel">
            <div className="world-stats">
              <p><strong>World Name:</strong> {worldSizeInfo.worldFolder || 'Unknown'}</p>
              <p><strong>Size:</strong> {worldSizeInfo.size.width} x {worldSizeInfo.size.height} x {worldSizeInfo.size.depth} blocks</p>
              <p><strong>Regions:</strong> {worldSizeInfo.size.regionCount} ({worldSizeInfo.size.regionWidth}x{worldSizeInfo.size.regionDepth})</p>
              <p><strong>Estimated Size:</strong> {worldSizeInfo.size.approximateSizeMB} MB</p>
              
              {worldSizeInfo.size.width * worldSizeInfo.size.depth > 5000 * 5000 && (
                <div className="warning-box">
                  <p><strong>Warning:</strong> This is a very large world. Importing the entire map may cause performance issues.</p>
                  <p>It's recommended to select a smaller region to import.</p>
                </div>
              )}
            </div>
            
            <div className="bounds-selector">
              <h5>Select Region to Import</h5>
              
              {/* Map selector component */}
              <WorldMapSelector 
                worldBounds={{
                  minX: worldSizeInfo.bounds.minX,
                  maxX: worldSizeInfo.bounds.maxX,
                  minZ: worldSizeInfo.bounds.minZ,
                  maxZ: worldSizeInfo.bounds.maxZ
                }}
                selectedBounds={selectedBounds}
                onBoundsChange={handleBoundsChange}
                regionCoords={worldSizeInfo.regionCoords}
              />
              
              <div className="bounds-inputs">
                <div className="bounds-group">
                  <label>X Bounds (Min: {worldSizeInfo.bounds.minX}, Max: {worldSizeInfo.bounds.maxX}):</label>
                  <div className="bounds-input-row">
                    <input 
                      type="number" 
                      value={selectedBounds?.minX || 0}
                      onChange={(e) => setSelectedBounds({...selectedBounds, minX: parseInt(e.target.value)})}
                    />
                    <span>to</span>
                    <input 
                      type="number" 
                      value={selectedBounds?.maxX || 0}
                      onChange={(e) => setSelectedBounds({...selectedBounds, maxX: parseInt(e.target.value)})}
                    />
                  </div>
                </div>
                
                <div className="bounds-group">
                  <label>Y Bounds (Min: {worldSizeInfo.bounds.minY}, Max: {worldSizeInfo.bounds.maxY}):</label>
                  <div className="bounds-input-row">
                    <input 
                      type="number" 
                      value={selectedBounds?.minY || 0}
                      onChange={(e) => setSelectedBounds({...selectedBounds, minY: parseInt(e.target.value)})}
                    />
                    <span>to</span>
                    <input 
                      type="number" 
                      value={selectedBounds?.maxY || 0}
                      onChange={(e) => setSelectedBounds({...selectedBounds, maxY: parseInt(e.target.value)})}
                    />
                  </div>
                </div>
                
                <div className="bounds-group">
                  <label>Z Bounds (Min: {worldSizeInfo.bounds.minZ}, Max: {worldSizeInfo.bounds.maxZ}):</label>
                  <div className="bounds-input-row">
                    <input 
                      type="number" 
                      value={selectedBounds?.minZ || 0}
                      onChange={(e) => setSelectedBounds({...selectedBounds, minZ: parseInt(e.target.value)})}
                    />
                    <span>to</span>
                    <input 
                      type="number" 
                      value={selectedBounds?.maxZ || 0}
                      onChange={(e) => setSelectedBounds({...selectedBounds, maxZ: parseInt(e.target.value)})}
                    />
                  </div>
                </div>
              </div>
              
              <div className="selection-size-info">
                <p>
                  <strong>Selected Size:</strong> {
                    selectedBounds ? 
                    `${selectedBounds.maxX - selectedBounds.minX + 1} x ${selectedBounds.maxY - selectedBounds.minY + 1} x ${selectedBounds.maxZ - selectedBounds.minZ + 1} blocks` : 
                    'N/A'
                  }
                </p>
                {selectedBounds && (
                  <p>
                    <strong>Estimated Block Count:</strong> {
                      Math.round((selectedBounds.maxX - selectedBounds.minX + 1) * 
                      (selectedBounds.maxY - selectedBounds.minY + 1) * 
                      (selectedBounds.maxZ - selectedBounds.minZ + 1) * 0.3).toLocaleString()
                    } blocks (assuming 30% filled)
                  </p>
                )}
              </div>
              
              <div className="bounds-actions">
                <button 
                  className="import-button"
                  onClick={handleStartParsing}
                >
                  <FaCheck /> Import Selected Region
                </button>
                
                <button 
                  className="cancel-button"
                  onClick={handleCancelImport}
                >
                  <FaTimes /> Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Show the progress if we're uploading/parsing */}
      {uploading && (
        <div className="upload-progress">
          <p>{progressMessage || 'Processing your world...'}</p>
          <div className="progress-bar">
            <div className="progress-bar-inner" style={{ width: `${progress}%` }}></div>
          </div>
          <p>{progress}% complete</p>
          
          {memoryUsage && (
            <div className="memory-usage">
              <div className="memory-bar">
                <div 
                  className="memory-bar-inner" 
                  style={{ 
                    width: `${Math.min(100, (memoryUsage.used / memoryUsage.limit) * 100)}%`,
                    backgroundColor: memoryUsage.used > memoryUsage.limit * 0.8 ? '#ff6b6b' : '#4a90e2'
                  }}
                ></div>
              </div>
              <p>Memory: {memoryUsage.used.toFixed(0)} MB / {memoryUsage.limit} MB</p>
              <p className="memory-tip">Tip: Reduce Y-range or increase chunk sampling to use less memory</p>
            </div>
          )}
          
          {filterStats && (
            <div className="filter-stats">
              <h4>Filtering Stats:</h4>
              <ul>
                <li>Chunks skipped by Y-range: <strong>{filterStats.yBounds}</strong></li>
                <li>Chunks skipped by X/Z-range: <strong>{filterStats.xzBounds}</strong></li>
                <li>Regions skipped completely: <strong>{filterStats.regionBounds}</strong></li>
              </ul>
              <p className="filter-tip">Effective filtering significantly reduces memory usage</p>
            </div>
          )}
        </div>
      )}
      
      {/* Show success message if parsing is complete */}
      {worldData && !uploading && !showSizeSelector && (
        <div className="success-message">
          <div className="success-icon">✓</div>
          <h3>World Parsing Complete!</h3>
          <p>Your selected region has been processed successfully.</p>
          <p>Advancing to block mapping...</p>
        </div>
      )}
      
      {/* Only show the drag & drop area when we're at the initial state (no processing and no selector shown) */}
      {(!uploading && !showSizeSelector && !worldData) && (
        <div 
          className="upload-area"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={handleBrowseClick}
        >
          <input 
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".zip"
            onChange={handleFileSelect}
          />
          
          <FaCloudUploadAlt className="upload-icon" />
          <h3>Drag & Drop or Click to Browse</h3>
          <p>Upload a Minecraft world as a ZIP file</p>
        </div>
      )}
      
      {error && (
        <div className="error-message">
          <p>{error}</p>
        </div>
      )}
      
      {/* Only show advanced options in the initial state */}
      {(!showSizeSelector && !uploading && !worldData) && (
        <div className="advanced-options">
          <button 
            className="advanced-button" 
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <FaCog /> {showAdvanced ? "Hide" : "Show"} Advanced Options
          </button>
          
          {showAdvanced && (
            <div className="options-panel">
              <h4>Memory Optimization Settings</h4>
              <p className="optimization-warning">
                For larger worlds, adjust these settings to reduce memory usage
              </p>
              
              <div className="option-row">
                <label>
                  <input 
                    type="checkbox" 
                    checked={options.excludeTransparentBlocks}
                    onChange={(e) => handleOptionChange('excludeTransparentBlocks', e.target.checked)}
                  />
                  Skip transparent blocks (air, glass, water)
                </label>
              </div>
              
              <div className="option-row">
                <label>
                  <input 
                    type="checkbox" 
                    checked={options.limitRegions}
                    onChange={(e) => handleOptionChange('limitRegions', e.target.checked)}
                  />
                  Limit regions (load only central area)
                </label>
              </div>
              
              <div className="option-grid">
                <div className="option-col">
                  <label>
                    Max regions to load:
                    <input 
                      type="number" 
                      min="1" 
                      max="100"
                      value={options.maxRegions}
                      onChange={(e) => handleOptionChange('maxRegions', e.target.value)}
                      disabled={!options.limitRegions}
                    />
                  </label>
                  
                  <label>
                    Chunk sampling factor:
                    <select
                      value={options.chunkSamplingFactor}
                      onChange={(e) => handleOptionChange('chunkSamplingFactor', e.target.value)}
                    >
                      <option value="1">Load all chunks (1:1)</option>
                      <option value="2">Load every other chunk (1:2)</option>
                      <option value="4">Load every 4th chunk (1:4)</option>
                      <option value="8">Load every 8th chunk (1:8)</option>
                    </select>
                  </label>
                </div>
                
                <div className="option-col">
                  <label>
                    Memory limit (MB):
                    <input 
                      type="number" 
                      min="100" 
                      max="4000"
                      value={options.memoryLimit}
                      onChange={(e) => handleOptionChange('memoryLimit', e.target.value)}
                    />
                  </label>
                  
                  <label>
                    Max blocks (millions):
                    <input 
                      type="number" 
                      min="0" 
                      max="20"
                      step="0.5"
                      value={options.maxBlocks / 1000000}
                      onChange={(e) => handleOptionChange('maxBlocks', Number(e.target.value) * 1000000)}
                    />
                    <span className="input-note">0 = unlimited</span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      
      <style jsx>{`
        .upload-step {
          padding: 20px;
          max-width: 800px;
          margin: 0 auto;
          color: #e0e0e0;
        }
        
        .upload-area {
          border: 2px dashed #4a90e2;
          border-radius: 8px;
          padding: 40px;
          text-align: center;
          cursor: pointer;
          margin: 20px 0;
          background-color: rgba(74, 144, 226, 0.1);
          transition: background-color 0.2s;
        }
        
        .upload-area:hover {
          background-color: rgba(74, 144, 226, 0.2);
        }
        
        .upload-icon {
          font-size: 50px;
          color: #4a90e2;
          margin-bottom: 20px;
        }
        
        .upload-progress {
          margin: 20px 0;
          padding: 15px;
          border-radius: 8px;
          background-color: #2a2a2a;
        }
        
        .progress-bar {
          height: 20px;
          background-color: #444;
          border-radius: 10px;
          margin: 10px 0;
          overflow: hidden;
        }
        
        .progress-bar-inner {
          height: 100%;
          background-color: #4a90e2;
          transition: width 0.3s ease;
        }
        
        .memory-usage {
          margin-top: 15px;
          padding-top: 15px;
          border-top: 1px solid #444;
        }
        
        .memory-bar {
          height: 15px;
          background-color: #444;
          border-radius: 8px;
          margin: 10px 0;
          overflow: hidden;
        }
        
        .memory-bar-inner {
          height: 100%;
          background-color: #4a90e2;
          transition: width 0.3s ease, background-color 0.3s ease;
        }
        
        .memory-tip {
          font-size: 12px;
          color: #aaa;
          font-style: italic;
        }
        
        .filter-stats {
          margin-top: 15px;
          padding-top: 15px;
          border-top: 1px solid #444;
        }
        
        .filter-stats ul {
          margin: 10px 0;
          padding-left: 20px;
        }
        
        .filter-tip {
          font-size: 12px;
          color: #aaa;
          font-style: italic;
        }
        
        .success-message {
          margin: 40px 0;
          padding: 30px;
          background-color: rgba(76, 175, 80, 0.15);
          border: 1px solid #4caf50;
          border-radius: 8px;
          text-align: center;
          animation: fadeIn 0.5s ease-in-out;
        }
        
        .success-icon {
          font-size: 60px;
          color: #4caf50;
          margin-bottom: 20px;
        }
        
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        .error-message {
          background-color: rgba(255, 99, 71, 0.2);
          border: 1px solid tomato;
          border-radius: 4px;
          padding: 10px 15px;
          margin: 15px 0;
          color: tomato;
        }
        
        .advanced-options {
          margin-top: 20px;
        }
        
        .advanced-button {
          background: #333;
          color: #e0e0e0;
          border: none;
          padding: 8px 15px;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: background-color 0.2s;
        }
        
        .advanced-button:hover {
          background: #444;
        }
        
        .options-panel {
          margin-top: 15px;
          padding: 15px;
          background-color: #2a2a2a;
          border-radius: 4px;
        }
        
        .optimization-warning {
          color: #ffcc00;
          margin-bottom: 15px;
          font-size: 14px;
        }
        
        .option-row {
          margin-bottom: 10px;
        }
        
        .option-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 20px;
          margin-top: 15px;
        }
        
        .option-col {
          flex: 1;
          min-width: 200px;
        }
        
        .option-col label {
          display: block;
          margin-bottom: 15px;
        }
        
        input[type="number"], select {
          background-color: #333;
          border: 1px solid #555;
          color: #e0e0e0;
          padding: 5px 10px;
          border-radius: 4px;
          margin-top: 5px;
          width: 100%;
        }
        
        .input-note {
          display: block;
          font-size: 12px;
          color: #aaa;
          margin-top: 3px;
        }
        
        /* World size selector styles */
        .world-size-selector {
          margin: 20px 0;
          padding: 20px;
          background-color: #2a2a2a;
          border-radius: 8px;
        }
        
        .world-info-panel {
          display: flex;
          flex-wrap: wrap;
          gap: 20px;
          margin-top: 15px;
        }
        
        .world-stats {
          flex: 1;
          min-width: 200px;
        }
        
        .warning-box {
          margin-top: 15px;
          padding: 10px;
          background-color: rgba(255, 152, 0, 0.1);
          border: 1px solid #ff9800;
          border-radius: 4px;
          color: #ff9800;
        }
        
        .bounds-selector {
          flex: 2;
          min-width: 300px;
        }
        
        .bounds-inputs {
          display: flex;
          flex-wrap: wrap;
          gap: 15px;
          margin-top: 15px;
        }
        
        .bounds-group {
          flex: 1;
          min-width: 200px;
        }
        
        .bounds-input-row {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 5px;
        }
        
        .bounds-input-row input {
          flex: 1;
          padding: 8px;
          background-color: #333;
          border: 1px solid #555;
          color: #e0e0e0;
          border-radius: 4px;
        }
        
        .selection-size-info {
          margin-top: 20px;
          padding: 10px;
          background-color: #333;
          border-radius: 4px;
        }
        
        .bounds-actions {
          margin-top: 20px;
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        
        .bounds-actions button {
          padding: 10px 15px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: background-color 0.2s;
        }
        
        .import-button {
          background-color: #4caf50;
          color: white;
        }
        
        .import-button:hover {
          background-color: #388e3c;
        }
        
        .cancel-button {
          background-color: #f44336;
          color: white;
        }
        
        .cancel-button:hover {
          background-color: #d32f2f;
        }
      `}</style>
    </div>
  );
};

export default UploadStep; 