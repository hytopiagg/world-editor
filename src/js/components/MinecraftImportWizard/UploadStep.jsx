import React, { useState, useRef, useCallback } from 'react';
import { FaCloudUploadAlt, FaCog } from 'react-icons/fa';

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
  const fileInputRef = useRef(null);
  const workerRef = useRef(null);
  
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
        } else if (type === 'worldParsed') {
          setUploading(false);
          setProgress(100);
          setProgressMessage('World loading complete!');
          onWorldLoaded(data);
        } else if (type === 'error') {
          setUploading(false);
          setProgress(0);
          setError(error || 'An unknown error occurred');
        } else if (type === 'memoryUpdate') {
          setMemoryUsage(data);
        }
      };
      
      // Start processing
      const arrayBuffer = await file.arrayBuffer();
      workerRef.current.postMessage({
        type: 'parseWorld',
        data: { 
          zipFile: arrayBuffer,
          options: options // Pass optimization options to the worker
        }
      });
    } catch (e) {
      setUploading(false);
      setProgress(0);
      setError('Error processing file: ' + e.message);
    }
  }, [onWorldLoaded, options]);
  
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
  
  return (
    <div className="upload-step">
      <h3>Upload Your Minecraft World</h3>
      <p>Select a Minecraft Java Edition world ZIP file from version 1.21.x or newer.</p>
      
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
              
              {options.limitRegions && (
                <div className="sub-option">
                  <label>Max regions to load:</label>
                  <select 
                    value={options.maxRegions}
                    onChange={(e) => handleOptionChange('maxRegions', parseInt(e.target.value))}
                  >
                    <option value={9}>9 (3×3 area)</option>
                    <option value={25}>25 (5×5 area)</option>
                    <option value={49}>49 (7×7 area)</option>
                    <option value={100}>100 (10×10 area)</option>
                  </select>
                </div>
              )}
            </div>
            
            <div className="option-row y-bounds-option">
              <label>Vertical bounds (Y level):</label>
              <p className="y-bounds-note">Restricting Y levels significantly reduces memory usage</p>
              <div className="input-group">
                <div>
                  <label>Min: <span className="range-limit">(-64 to 319)</span></label>
                  <input 
                    type="number" 
                    value={options.minY}
                    min="-64" max="319"
                    onChange={(e) => handleOptionChange('minY', parseInt(e.target.value))}
                  />
                </div>
                <div>
                  <label>Max: <span className="range-limit">(-63 to 320)</span></label>
                  <input 
                    type="number" 
                    value={options.maxY}
                    min="-63" max="320"
                    onChange={(e) => handleOptionChange('maxY', parseInt(e.target.value))}
                  />
                </div>
              </div>
            </div>
            
            <div className="option-row coordinates-option">
              <label>
                <input 
                  type="checkbox" 
                  checked={options.filterByCoordinates}
                  onChange={(e) => handleOptionChange('filterByCoordinates', e.target.checked)}
                />
                Filter by X/Z coordinates (pre-filtering)
              </label>
              {options.filterByCoordinates && (
                <div className="coordinates-inputs">
                  <p className="coordinates-note">Only loads blocks within these coordinate ranges. Default ±150 range significantly reduces memory usage.</p>
                  <div className="coordinate-group">
                    <div className="coordinate-axis">
                      <label>X Range:</label>
                      <div className="input-group">
                        <div>
                          <label>Min: <span className="range-limit">(World limit: -30,000,000)</span></label>
                          <input 
                            type="number" 
                            value={options.minX}
                            onChange={(e) => handleOptionChange('minX', parseInt(e.target.value))}
                          />
                        </div>
                        <div>
                          <label>Max: <span className="range-limit">(World limit: 30,000,000)</span></label>
                          <input 
                            type="number" 
                            value={options.maxX}
                            onChange={(e) => handleOptionChange('maxX', parseInt(e.target.value))}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="coordinate-axis">
                      <label>Z Range:</label>
                      <div className="input-group">
                        <div>
                          <label>Min: <span className="range-limit">(World limit: -30,000,000)</span></label>
                          <input 
                            type="number" 
                            value={options.minZ}
                            onChange={(e) => handleOptionChange('minZ', parseInt(e.target.value))}
                          />
                        </div>
                        <div>
                          <label>Max: <span className="range-limit">(World limit: 30,000,000)</span></label>
                          <input 
                            type="number" 
                            value={options.maxZ}
                            onChange={(e) => handleOptionChange('maxZ', parseInt(e.target.value))}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            <div className="option-row">
              <label>Chunk sampling (higher values = fewer chunks):</label>
              <select 
                value={options.chunkSamplingFactor}
                onChange={(e) => handleOptionChange('chunkSamplingFactor', parseInt(e.target.value))}
              >
                <option value={1}>1 (Full resolution)</option>
                <option value={2}>2 (Half resolution)</option>
                <option value={4}>4 (Quarter resolution)</option>
              </select>
            </div>
            
            <div className="option-row">
              <label>Maximum blocks to load:</label>
              <select 
                value={options.maxBlocks}
                onChange={(e) => handleOptionChange('maxBlocks', parseInt(e.target.value))}
              >
                <option value={0}>No limit</option>
                <option value={1000000}>1,000,000</option>
                <option value={2000000}>2,000,000</option>
                <option value={3000000}>3,000,000</option>
                <option value={4000000}>4,000,000</option>
                <option value={5000000}>5,000,000</option>
                <option value={6000000}>6,000,000</option>
                <option value={7000000}>7,000,000 (recommended)</option>
                <option value={8000000}>8,000,000</option>
                <option value={9000000}>9,000,000</option>
                <option value={10000000}>10,000,000</option>
                <option value={20000000}>20,000,000</option>
                <option value={50000000}>50,000,000</option>
              </select>
              <p className="block-limit-note">7 million provides the best balance between detail and performance</p>
            </div>
            
            <div className="option-row">
              <label>Memory limit (MB):</label>
              <input 
                type="number" 
                min="500" 
                max="4000" 
                value={options.memoryLimit}
                onChange={(e) => handleOptionChange('memoryLimit', parseInt(e.target.value))}
              />
            </div>
            
            <button 
              className="reset-button"
              onClick={() => setOptions({ ...DEFAULT_OPTIONS })}
            >
              Reset to Defaults
            </button>
          </div>
        )}
      </div>
      
      <div className="upload-instructions">
        <h4>How to export your Minecraft world:</h4>
        <ol>
          <li>Find your Minecraft saves folder: <code>%APPDATA%\.minecraft\saves\</code> on Windows</li>
          <li>Right-click on your world folder and select "Send to" → "Compressed (zipped) folder"</li>
          <li>Upload the resulting ZIP file here</li>
        </ol>
        <p className="note">Note: Your ZIP should contain the world's files, including a region folder with .mca files</p>
        
        <h4>Common Issues:</h4>
        <ul className="issue-list">
          <li>Make sure you're zipping the world folder itself, not just its contents</li>
          <li>Some world downloaders may create incompatible formats</li>
          <li>Very large worlds may take longer to process or cause memory issues</li>
          <li>If you're having memory problems, try the advanced options to limit world size</li>
        </ul>
      </div>
      
      {error && (
        <div className="error-message">
          <p>{error}</p>
          <p>Make sure your ZIP file contains a valid Minecraft world structure with a region folder and .mca files.</p>
          <p>For very large worlds, try using the advanced options to limit memory usage.</p>
        </div>
      )}
    </div>
  );
};

export default UploadStep; 