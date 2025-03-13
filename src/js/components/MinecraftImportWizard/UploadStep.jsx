import React, { useState, useRef, useCallback, useEffect } from 'react';
import { FaCloudUploadAlt, FaCog, FaMapMarkedAlt, FaCheck, FaTimes } from 'react-icons/fa';
import WorldMapSelector from './WorldMapSelector';
import FrontViewSelector from './FrontViewSelector';
import { loadingManager } from '../../LoadingManager';

// Create Web Worker
const createWorker = () => {
  return new Worker(new URL('../../workers/minecraftParserWorker.js', import.meta.url));
};

// Default optimization options
const DEFAULT_OPTIONS = {
  // Filter out transparent blocks
  excludeTransparentBlocks: true,
  // Filter out water blocks (default is false - include water)
  excludeWaterBlocks: false,
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

// Add this global storage object for chunks
const globalWorldDataStorage = {
  currentBlocksData: null,
  chunkedBlocksData: {},
  receivedChunks: 0,
  totalChunks: 0
};

// Export the function to get the global blocks data
export const getCurrentBlocksData = () => globalWorldDataStorage.currentBlocksData;

const UploadStep = ({ onWorldLoaded, onAdvanceStep, onStateChange }) => {
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
  
  // Add state for tracking chunk progress
  const [chunkProgress, setChunkProgress] = useState({ received: 0, total: 0 });
  
  const fileInputRef = useRef(null);
  const workerRef = useRef(null);
  const zipDataRef = useRef(null); // Store the zip data for later use
  
  // Notify parent of initial state
  useEffect(() => {
    if (onStateChange) {
      onStateChange({ uploading, showSizeSelector });
    }
  }, [onStateChange, uploading, showSizeSelector]); // Run when these values change
  
  // Reset state when we go back to this step
  useEffect(() => {
    // If we had world data before but don't now, we're going back to start over
    if (!worldData) {
      // Reset all state
      setUploadingWithNotify(false);
      setError(null);
      setProgress(0);
      setProgressMessage('');
      setShowAdvanced(false);
      setOptions({ ...DEFAULT_OPTIONS });
      setMemoryUsage(null);
      setFilterStats(null);
      setWorldSizeInfo(null);
      setShowSizeSelectorWithNotify(false);
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
  useEffect(() => {
    // When component unmounts, make sure any loading screens are hidden
    return () => {
      loadingManager.forceHideAll();
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
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
    
    setUploadingWithNotify(true);
    setError(null);
    setProgress(0);
    setProgressMessage('Starting upload...');
    setMemoryUsage(null);
    setWorldSizeInfo(null);
    setShowSizeSelectorWithNotify(false);
    
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
          setUploadingWithNotify(false);
          setProgress(100);
          setProgressMessage('World scan complete!');
          setWorldSizeInfo(data);
          setShowSizeSelectorWithNotify(true);
          
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
        } else if (type === 'blockChunk') {
          // Receive a chunk of blocks
          console.log(`[CHUNKS] Received chunk ${data.chunkId} of ${data.totalChunks} (${Object.keys(data.blocks).length} blocks)`);
          
          // Store the chunk in our global storage
          globalWorldDataStorage.chunkedBlocksData[data.chunkId] = data.blocks;
          globalWorldDataStorage.receivedChunks = data.chunkId;
          globalWorldDataStorage.totalChunks = data.totalChunks;
          
          // Update chunk progress state for UI
          setChunkProgress({
            received: data.chunkId,
            total: data.totalChunks
          });
          
          // Update progress message with chunk information
          const percentComplete = Math.floor((data.chunkId / data.totalChunks) * 100);
          setProgressMessage(`Processing block data: ${percentComplete}% (Chunk ${data.chunkId}/${data.totalChunks})`);
        } else if (type === 'worldParsed') {
          // All chunks received, now combine them
          console.log('[TIMING] UploadStep: worldParsed event received, all chunks complete');
          setUploadingWithNotify(false);
          setProgress(100);
          setProgressMessage('World loading complete! Click Next to continue.');
          setShowSizeSelectorWithNotify(false); // Hide region selector after parsing
          
          // Combine all chunks into one blocks object
          console.log('[CHUNKS] Combining all chunks into one blocks object');
          // Don't show a new loading screen, just update the progress message
          setProgressMessage('Combining block data chunks...');
          
          const combinedBlocks = {};
          
          // Process in smaller batches to avoid UI freeze
          const processChunks = async () => {
            try {
              const totalChunks = globalWorldDataStorage.totalChunks;
              let processedChunks = 0;
              
              // Create a lightweight world data object that indicates loading is in progress
              const initialWorldData = {
                ...data,
                blocksCount: 0,
                blocks: null,
                loading: true // Add this flag to indicate loading state
              };
              
              // Set initial world data to indicate loading
              setWorldData(initialWorldData);
              
              // DO NOT call onWorldLoaded here with the initial data
              // We'll only call it after chunks are fully combined
              
              // Process chunks in batches of 5 for better performance
              const BATCH_SIZE = 5;
              for (let i = 1; i <= totalChunks; i += BATCH_SIZE) {
                // Process a batch of chunks
                const batchEnd = Math.min(i + BATCH_SIZE - 1, totalChunks);
                
                for (let j = i; j <= batchEnd; j++) {
                  const chunkBlocks = globalWorldDataStorage.chunkedBlocksData[j];
                  if (chunkBlocks) {
                    // Process this chunk's blocks
                    Object.assign(combinedBlocks, chunkBlocks);
                    processedChunks++;
                  } else {
                    console.warn(`Missing chunk ${j}`);
                  }
                }
                
                // Update loading progress after each batch
                const progress = Math.floor((processedChunks / totalChunks) * 80);
                // Just update the existing loading screen, don't create a new one
                loadingManager.updateLoading(`Combining chunks: ${processedChunks}/${totalChunks}`, progress);
                
                // Allow UI to update between batches
                await new Promise(resolve => setTimeout(resolve, 0));
              }
              
              // Store the combined data
              console.log(`[CHUNKS] Combined ${Object.keys(combinedBlocks).length} blocks from ${totalChunks} chunks`);
              globalWorldDataStorage.currentBlocksData = combinedBlocks;
              
              // Clear the chunked data to free memory
              globalWorldDataStorage.chunkedBlocksData = {};
              
              // Ensure we have valid bounds
              if (!selectedBounds) {
                console.warn("No bounds selected, using defaults from world size info");
                const worldBounds = data.bounds || {
                  minX: -150, maxX: 150, minY: 10, maxY: 100, minZ: -150, maxZ: 150
                };
                
                setSelectedBounds(worldBounds);
              }
              
              // Use bounds with null protection
              const bounds = selectedBounds || data.bounds || {
                minX: -150, maxX: 150, minY: 10, maxY: 100, minZ: -150, maxZ: 150
              };
              
              // Create the final world data object without the loading flag
              const worldDataWithRegion = {
                ...data,
                blocksCount: Object.keys(combinedBlocks).length,
                blocks: null, // Don't include the blocks in React state
                loading: false, // Set loading to false now that processing is complete
                selectedRegion: {
                  ...bounds,
                  width: (bounds.maxX - bounds.minX + 1) || 300,
                  height: (bounds.maxY - bounds.minY + 1) || 90,
                  depth: (bounds.maxZ - bounds.minZ + 1) || 300
                }
              };
              
              // Update local state
              setWorldData(worldDataWithRegion);
              
              // IMPORTANT: Just update the existing loading screen
              loadingManager.updateLoading('Preparing block mapping...', 90);
              
              // Wait a moment to ensure all data is ready before transitioning
              await new Promise(resolve => setTimeout(resolve, 500));
              
              // Now hide the loading screen
              loadingManager.hideLoading();
              
              // Only NOW call onWorldLoaded to transition to the next step
              // This happens after the "[CHUNKS] Combined X blocks from Y chunks" log message
              console.log('[TIMING] UploadStep: About to call onWorldLoaded with complete worldData');
              onWorldLoaded(worldDataWithRegion);
              
              // Set progress to 100% to show completion
              setProgress(100);
              setProgressMessage('World loading complete! Click Next to continue.');
              
            } catch (error) {
              console.error("Error processing chunks:", error);
              loadingManager.hideLoading(); // Make sure loading screen is hidden on error
              setError('Error combining block data: ' + error.message);
            }
          };
          
          // Start processing chunks
          processChunks();
        } else if (type === 'error') {
          setUploadingWithNotify(false);
          setProgress(0);
          setError(error || 'An unknown error occurred');
          loadingManager.hideLoading();
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
      setUploadingWithNotify(false);
      setProgress(0);
      setError('Error processing file: ' + e.message);
    }
  }, [onWorldLoaded, onAdvanceStep]);
  
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
    
    setUploadingWithNotify(true);
    setProgress(0);
    setProgressMessage('Starting world parsing with selected bounds...');
    setShowSizeSelectorWithNotify(false);
    
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
    setShowSizeSelectorWithNotify(false);
    zipDataRef.current = null;
  };
  
  // Update selected bounds
  const handleBoundsChange = (bounds) => {
    console.log('handleBoundsChange called with:', bounds);
    console.log('Current selectedBounds:', selectedBounds);
    
    // Create a new bounds object that preserves all properties
    const newBounds = {
      ...selectedBounds,
      ...bounds
    };
    
    console.log('New bounds to be set:', newBounds);
    
    // Remove the square constraint - allow rectangular selections
    // No need to enforce equal X and Z dimensions
    
    setSelectedBounds(newBounds);
  };
  
  // Add chunk progress to the UI if needed
  const renderUploadProgress = () => {
    return (
      <div className="upload-progress">
        <div className="progress-status">
          <h3>{progressMessage}</h3>
          <p className="progress-description">
            {progress < 100 
              ? "Please wait while we process your Minecraft world. This may take a few minutes depending on the size."
              : "Processing complete! Preparing to advance to the next step..."}
          </p>
          
          {/* Add version compatibility warning */}
          {worldData && worldData.worldVersion && worldData.worldVersion < 3953 && progress === 100 && (
            <div className="version-warning-message">
              <p><strong>Warning:</strong> This world is from an older version of Minecraft (Data Version {worldData.worldVersion}).</p>
              <p>For best results, please update your world to Minecraft 1.21 (Data Version 3953) before importing.</p>
              <p>Importing older worlds may result in missing blocks or other compatibility issues.</p>
              <p>You cannot proceed with the import until you update your world to Minecraft 1.21.</p>
            </div>
          )}
        </div>
        
        <div className="progress-bar">
          <div 
            className="progress-bar-inner" 
            style={{ width: `${progress}%` }}
          ></div>
        </div>
        
        <div className="progress-details">
          {chunkProgress.total > 0 && (
            <div className="chunk-progress">
              <p><strong>Data Chunks:</strong> {chunkProgress.received} of {chunkProgress.total} received ({Math.round((chunkProgress.received / chunkProgress.total) * 100)}%)</p>
            </div>
          )}
          
          {memoryUsage && (
            <div className="memory-usage">
              <p><strong>Memory Usage:</strong> {Math.round(memoryUsage.used / (1024 * 1024))} MB / {Math.round(memoryUsage.limit / (1024 * 1024))} MB</p>
              <div className="memory-bar">
                <div 
                  className="memory-bar-inner" 
                  style={{ 
                    width: `${(memoryUsage.used / memoryUsage.limit) * 100}%`,
                    backgroundColor: memoryUsage.used > memoryUsage.limit * 0.8 ? '#ff9800' : undefined
                  }}
                ></div>
              </div>
              {memoryUsage.used > memoryUsage.limit * 0.8 && (
                <p className="memory-tip">Memory usage is high - try reducing the region size or filtering more blocks.</p>
              )}
            </div>
          )}
          
          {filterStats && (
            <div className="filter-stats">
              <p><strong>Overall Progress:</strong> {Math.round(progress)}% complete</p>
              {filterStats.totalSkipped > 0 && (
                <p className="filter-tip">Optimized by removing {filterStats.totalSkipped.toLocaleString()} blocks ({Math.round(filterStats.totalSkipped / (filterStats.totalBlocks || 1) * 100)}% of total)</p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };
  
  // Create a custom setter for uploading that also notifies the parent
  const setUploadingWithNotify = (value) => {
    setUploading(value);
    // Notify parent component of state change
    if (onStateChange) {
      onStateChange({ uploading: value, showSizeSelector });
    }
  };
  
  // Create a custom setter for showSizeSelector that also notifies the parent
  const setShowSizeSelectorWithNotify = (value) => {
    setShowSizeSelector(value);
    // Notify parent component of state change
    if (onStateChange) {
      onStateChange({ uploading, showSizeSelector: value });
    }
  };
  
  return (
    <div className="upload-step">
      {/* Only show the main header and description in the initial state (not uploading, not showing selector, no world data) */}
      {(!uploading && !showSizeSelector && !worldData) && (
        <>
          <h2>Upload Minecraft World</h2>
          <p className="step-description">
            Import a Minecraft world by uploading a ZIP file of your world folder.
            You'll be able to select which region to import in the next step.
          </p>
        </>
      )}
      
      {/* Show region selection header when in region selection mode */}
      {showSizeSelector && worldSizeInfo && !uploading && (
        <h2 className="section-header">Select Region to Import</h2>
      )}
      
      {/* Show processing header when uploading/parsing */}
      {uploading && (
        <h2 className="section-header">Processing Minecraft World</h2>
      )}
      
      {/* Show success header when world data is loaded but not in selection mode */}
      {worldData && !uploading && !showSizeSelector && (
        <h2 className="section-header">World Processing Complete</h2>
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
      
      {/* Compatibility information - only show in initial state */}
      {(!uploading && !showSizeSelector && !worldData) && (
        <div className="compatibility-info">
          <h3>Compatibility Information</h3>
          <p><strong>Supported Versions:</strong> Minecraft Java Edition 1.21.x or newer</p>
          <p><strong>Maximum Import Size:</strong> 500 x 500 blocks (X/Z dimensions)</p>
          <p><strong>Maximum Block Limit:</strong> {options.maxBlocks.toLocaleString()} blocks (can be adjusted in advanced options)</p>
          
          <div className="export-instructions">
            <h4>How to Export Your Minecraft World:</h4>
            <ol>
              <li>Open Minecraft Java Edition and select the world you want to export</li>
              <li>Click "Edit" then "Export" to create a backup of your world</li>
              <li>Locate the exported ZIP file (usually in your "saves" folder)</li>
              <li>Upload the ZIP file using the drag & drop area above</li>
            </ol>
            <p className="note">Note: For large worlds, consider using the advanced options to limit the region size or reduce memory usage.</p>
          </div>
        </div>
      )}
      
      {/* Show the world size selector if we have scanned the world */}
      {showSizeSelector && worldSizeInfo && (
        <>
          <div className="world-stats">
            <p><strong>World Name:</strong> {worldSizeInfo.worldFolder || 'Unknown'}</p>
            <p><strong>Size:</strong> {worldSizeInfo.size.width} x {worldSizeInfo.size.height} x {worldSizeInfo.size.depth} blocks</p>
            <p><strong>Regions:</strong> {worldSizeInfo.size.regionCount} ({worldSizeInfo.size.regionWidth}x{worldSizeInfo.size.regionDepth})</p>
            <p><strong>Estimated Size:</strong> {worldSizeInfo.size.approximateSizeMB} MB</p>
            <p><strong>Maximum Import Size:</strong> 500 x 500 blocks (X/Z dimensions)</p>
            
            {/* Add world version information */}
            {worldSizeInfo.worldVersion && (
              <p>
                <strong>Minecraft Data Version:</strong> {worldSizeInfo.worldVersion}
                {worldSizeInfo.worldVersion === 3953 && (
                  <span className="version-compatible"> (Minecraft 1.21)</span>
                )}
                {worldSizeInfo.worldVersion > 3953 && (
                  <span className="version-compatible"> (Newer than Minecraft 1.21)</span>
                )}
                {worldSizeInfo.worldVersion < 3953 && (
                  <span className="version-older"> (Older than Minecraft 1.21 - Needs updating)</span>
                )}
              </p>
            )}
            
            {worldSizeInfo.size.width * worldSizeInfo.size.depth > 5000 * 5000 && (
              <div className="warning-box">
                <p><strong>Warning:</strong> This is a very large world. Importing the entire map may cause performance issues.</p>
                <p>It's recommended to select a smaller region to import.</p>
              </div>
            )}
            
            {/* Add version compatibility warning */}
            {worldSizeInfo.worldVersion && worldSizeInfo.worldVersion < 3953 && (
              <div className="version-warning-box">
                <p><strong>Warning:</strong> This world is from an older version of Minecraft (Data Version {worldSizeInfo.worldVersion}).</p>
                <p>Please update your world to Minecraft 1.21 (Data Version 3953) before importing.</p>
              </div>
            )}
          </div>
          
          <div className="world-map-container">
            <h3>Select Region to Import</h3>
            
            <div className="selectors-container">
              <FrontViewSelector
                bounds={worldSizeInfo.bounds}
                selectedBounds={selectedBounds}
                onBoundsChange={handleBoundsChange}
              />
              <WorldMapSelector 
                bounds={worldSizeInfo.bounds}
                onBoundsChange={handleBoundsChange}
                selectedBounds={selectedBounds}
                regionCoords={worldSizeInfo.regionCoords}
              />
            </div>
            
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
              
              {selectedBounds && 
               (selectedBounds.maxX - selectedBounds.minX + 1) * (selectedBounds.maxZ - selectedBounds.minZ + 1) > 500 * 500 && (
                <div className="warning-box">
                  <p><strong>Warning:</strong> The selected area exceeds the recommended maximum size of 500 x 500 blocks.</p>
                  <p>This may cause performance issues or fail to import. Consider selecting a smaller area.</p>
                </div>
              )}
            </div>
            
            {/* Advanced options */}
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
                      Skip transparent blocks (air, glass)
                    </label>
                  </div>
                  
                  <div className="option-row">
                    <label>
                      <input 
                        type="checkbox" 
                        checked={options.excludeWaterBlocks}
                        onChange={(e) => handleOptionChange('excludeWaterBlocks', e.target.checked)}
                      />
                      Skip water blocks
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
            
            <div className="bounds-actions">
              <button 
                className="import-button"
                onClick={handleStartParsing}
                disabled={worldSizeInfo?.worldVersion && worldSizeInfo.worldVersion < 3953}
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
        </>
      )}
      
      {/* Show the progress if we're uploading/parsing */}
      {uploading && (
        renderUploadProgress()
      )}
      
      {/* Show success message if parsing is complete */}
      {worldData && !uploading && !showSizeSelector && (
        <div className="success-message">
          <div className="success-icon">✓</div>
          <h3>World Parsing Complete!</h3>
          <p>Your selected region has been processed successfully.</p>
          <p className="next-step-info">Advancing to block mapping step...</p>
          
          {worldData.blocksCount && (
            <div className="import-summary">
              <p><strong>Imported Blocks:</strong> {worldData.blocksCount.toLocaleString()} blocks</p>
              <p><strong>Selected Area:</strong> {worldData.selectedRegion.width} x {worldData.selectedRegion.height} x {worldData.selectedRegion.depth} blocks</p>
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
        
        .step-description {
          margin-bottom: 20px;
          color: #aaa;
          font-size: 16px;
          line-height: 1.5;
        }
        
        /* Section header styles */
        .section-header {
          color: #4a90e2;
          font-size: 24px;
          margin-top: 0;
          margin-bottom: 20px;
          padding-bottom: 10px;
          border-bottom: 2px solid #4a90e2;
          text-align: center;
        }
        
        /* Compatibility information styles */
        .compatibility-info {
          background-color: #2a2a2a;
          border-radius: 12px;
          padding: 20px;
          margin: 20px 0;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        }
        
        .compatibility-info h3 {
          color: #4a90e2;
          margin-top: 0;
          margin-bottom: 15px;
          border-bottom: 1px solid #444;
          padding-bottom: 10px;
        }
        
        .compatibility-info p {
          margin: 10px 0;
          line-height: 1.5;
        }
        
        .export-instructions {
          margin-top: 20px;
          padding-top: 15px;
          border-top: 1px solid #444;
        }
        
        .export-instructions h4 {
          color: #4a90e2;
          margin-top: 0;
          margin-bottom: 15px;
        }
        
        .export-instructions ol {
          padding-left: 25px;
          margin-bottom: 15px;
        }
        
        .export-instructions li {
          margin-bottom: 8px;
          line-height: 1.5;
        }
        
        .export-instructions .note {
          font-style: italic;
          color: #aaa;
          font-size: 14px;
          padding: 10px;
          background-color: rgba(255, 204, 0, 0.1);
          border-left: 3px solid #ffcc00;
          margin-top: 15px;
        }
        
        /* World stats styles */
        .world-stats {
          background-color: #2a2a2a;
          border-radius: 8px;
          padding: 15px;
          margin-bottom: 20px;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        }
        
        .world-stats p {
          margin: 8px 0;
        }
        
        .warning-box {
          margin-top: 15px;
          padding: 12px;
          background-color: rgba(255, 152, 0, 0.1);
          border: 1px solid #ff9800;
          border-radius: 8px;
          color: #ff9800;
        }
        
        .warning-box p {
          margin: 5px 0;
        }
        
        .version-compatible {
          color: #4caf50;
          font-weight: bold;
          margin-left: 5px;
        }
        
        .version-older {
          color: #f44336;
          font-weight: bold;
          margin-left: 5px;
        }
        
        .version-warning-box {
          margin-top: 15px;
          padding: 15px;
          background-color: rgba(244, 67, 54, 0.1);
          border: 2px solid #f44336;
          border-radius: 8px;
          color: #fff;
        }
        
        .version-warning-box p {
          margin: 5px 0;
        }
        
        .version-warning-box strong {
          color: #f44336;
        }
        
        .upload-area {
          border: 2px dashed #4a90e2;
          border-radius: 12px;
          padding: 50px;
          text-align: center;
          cursor: pointer;
          margin: 30px 0;
          background-color: rgba(74, 144, 226, 0.1);
          transition: all 0.3s ease;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        }
        
        .upload-area:hover {
          background-color: rgba(74, 144, 226, 0.2);
          transform: translateY(-2px);
          box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
        }
        
        .upload-icon {
          font-size: 60px;
          color: #4a90e2;
          margin-bottom: 20px;
          filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
        }
        
        .upload-progress {
          margin: 20px 0;
          padding: 20px;
          border-radius: 12px;
          background-color: #2a2a2a;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        }
        
        .progress-status {
          margin-bottom: 15px;
        }
        
        .progress-description {
          color: #aaa;
          font-size: 14px;
          line-height: 1.5;
        }
        
        .progress-bar {
          height: 20px;
          background-color: #444;
          border-radius: 10px;
          margin: 15px 0;
          overflow: hidden;
          box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.2);
        }
        
        .progress-bar-inner {
          height: 100%;
          background: linear-gradient(90deg, #3a7bd5, #4a90e2);
          transition: width 0.3s ease;
          box-shadow: 0 0 5px rgba(74, 144, 226, 0.5);
        }
        
        .progress-details {
          margin-top: 15px;
          padding-top: 15px;
          border-top: 1px solid #444;
        }
        
        .chunk-progress {
          margin-bottom: 15px;
        }
        
        .chunk-progress p {
          margin: 0;
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
          box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.2);
        }
        
        .memory-bar-inner {
          height: 100%;
          background: linear-gradient(90deg, #4a90e2, #3a7bd5);
          transition: width 0.3s ease, background-color 0.3s ease;
        }
        
        .memory-tip {
          font-size: 12px;
          color: #aaa;
          font-style: italic;
        }
        
        .filter-stats {
          margin-top: 15px;
          padding: 15px;
          border-top: 1px solid #444;
          background-color: #2a2a2a;
          border-radius: 8px;
        }
        
        .filter-stats p {
          margin: 10px 0;
          font-size: 16px;
        }
        
        .filter-stats p strong {
          color: #4a90e2;
        }
        
        .filter-tip {
          font-size: 13px;
          color: #aaa;
          margin-top: 8px !important;
        }
        
        .success-message {
          margin: 40px 0;
          padding: 30px;
          background-color: rgba(76, 175, 80, 0.15);
          border: 1px solid #4caf50;
          border-radius: 12px;
          text-align: center;
          animation: fadeIn 0.5s ease-in-out;
          box-shadow: 0 4px 12px rgba(76, 175, 80, 0.2);
        }
        
        .success-icon {
          font-size: 60px;
          color: #4caf50;
          margin-bottom: 20px;
          filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
        }
        
        .next-step-info {
          color: #aaa;
          font-style: italic;
          margin-top: 15px;
        }
        
        .import-summary {
          margin-top: 20px;
          padding: 15px;
          background-color: rgba(76, 175, 80, 0.1);
          border-radius: 8px;
          text-align: left;
          display: inline-block;
        }
        
        .import-summary p {
          margin: 5px 0;
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .error-message {
          background-color: rgba(255, 99, 71, 0.2);
          border: 1px solid tomato;
          border-radius: 8px;
          padding: 15px 20px;
          margin: 15px 0;
          color: tomato;
          box-shadow: 0 4px 8px rgba(255, 99, 71, 0.2);
        }
        
        .advanced-options {
          margin-top: 25px;
          border-top: 1px solid #444;
          padding-top: 20px;
        }
        
        .advanced-button {
          background: #333;
          color: #e0e0e0;
          border: none;
          padding: 10px 18px;
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 10px;
          transition: all 0.2s ease;
          font-weight: 500;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        
        .advanced-button:hover {
          background: #444;
          transform: translateY(-1px);
          box-shadow: 0 3px 6px rgba(0, 0, 0, 0.3);
        }
        
        .options-panel {
          margin-top: 15px;
          padding: 20px;
          background-color: #2a2a2a;
          border-radius: 8px;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        }
        
        .optimization-warning {
          color: #ffcc00;
          margin-bottom: 15px;
          font-weight: 500;
        }
        
        .option-row {
          margin-bottom: 15px;
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
          margin-bottom: 20px;
        }
        
        input[type="number"], select {
          background-color: #333;
          border: 1px solid #555;
          color: #e0e0e0;
          padding: 8px 12px;
          border-radius: 6px;
          margin-top: 8px;
          width: 100%;
          transition: all 0.2s ease;
          box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        
        input[type="number"]:focus, select:focus {
          border-color: #4a90e2;
          outline: none;
          box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.3);
        }
        
        .input-note {
          display: block;
          font-size: 12px;
          color: #aaa;
          margin-top: 5px;
        }
        
        /* World map container styles */
        .world-map-container {
          margin-top: 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          background-color: #2a2a2a;
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        }
        
        .bounds-inputs {
          display: flex;
          flex-direction: column;
          gap: 15px;
          margin-top: 20px;
          padding: 20px;
          background-color: #333;
          border-radius: 8px;
          width: 100%;
        }
        
        .bounds-group {
          margin-bottom: 10px;
        }
        
        .bounds-input-row {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 8px;
        }
        
        .bounds-input-row span {
          color: #aaa;
        }
        
        .bounds-input-row input {
          flex: 1;
          min-width: 0;
        }
        
        .selection-size-info {
          margin-top: 20px;
          padding: 15px;
          background-color: #333;
          border-radius: 8px;
          border-left: 4px solid #4a90e2;
          width: 100%;
        }
        
        .bounds-actions {
          display: flex;
          gap: 15px;
          margin-top: 25px;
          justify-content: center;
        }
        
        .import-button, .cancel-button {
          padding: 12px 24px;
          border-radius: 8px;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 10px;
          transition: all 0.2s ease;
          border: none;
          cursor: pointer;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        }
        
        .import-button {
          background-color: #4a90e2;
          color: white;
        }
        
        .import-button:hover {
          background-color: #3a7bd5;
          transform: translateY(-2px);
          box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
        }
        
        .import-button:disabled {
          background-color: #666;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }
        
        .import-button:disabled:hover {
          background-color: #666;
          transform: none;
          box-shadow: none;
        }
        
        .cancel-button {
          background-color: #444;
          color: #e0e0e0;
        }
        
        .cancel-button:hover {
          background-color: #555;
          transform: translateY(-2px);
          box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
        }
        
        /* Responsive adjustments */
        @media (max-width: 768px) {
          .option-grid {
            flex-direction: column;
          }
          
          .bounds-actions {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
};

export default UploadStep; 