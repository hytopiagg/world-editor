import React, { useState, useEffect } from 'react';
import { MinecraftToHytopiaConverter } from '../../utils/MinecraftToHytopiaConverter';

const ImportStep = ({ worldData, selectedRegion, blockMappings, onComplete }) => {
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  
  // Count stats for display
  const blockTypeCount = Object.keys(blockMappings).length;
  const mappedBlockTypes = Object.values(blockMappings).filter(m => m.action !== 'skip').length;
  const skippedBlockTypes = blockTypeCount - mappedBlockTypes;
  
  // Calculate potential block count in the selected region
  const regionWidth = selectedRegion ? (selectedRegion.maxX - selectedRegion.minX + 1) : 0;
  const regionHeight = selectedRegion ? (selectedRegion.maxY - selectedRegion.minY + 1) : 0;
  const regionDepth = selectedRegion ? (selectedRegion.maxZ - selectedRegion.minZ + 1) : 0;
  const potentialBlockCount = regionWidth * regionHeight * regionDepth;
  
  useEffect(() => {
    // Auto-start the import when this step is shown
    handleStartImport();
  }, []);
  
  const handleStartImport = async () => {
    if (importing) return;
    
    setImporting(true);
    setProgress(0);
    setError(null);
    
    try {
      // Create converter
      const converter = new MinecraftToHytopiaConverter(worldData, selectedRegion, blockMappings);
      
      // Set up progress tracking
      converter.setProgressCallback((progressValue) => {
        setProgress(progressValue);
      });
      
      // Start conversion
      const conversionResult = await converter.convert();
      
      // Process result
      setResult({
        success: true,
        hytopiaMap: conversionResult.hytopiaMap,
        stats: conversionResult.stats
      });
      
      // Notify parent component
      onComplete({
        success: true,
        hytopiaMap: conversionResult.hytopiaMap,
        stats: conversionResult.stats || {
          processedBlocks: 0,
          skippedBlocks: 0,
          uniqueBlockTypes: []
        }
      });
    } catch (err) {
      console.error('Conversion error:', err);
      setError(err.message || 'An unknown error occurred during conversion');
      
      // Notify parent of failure
      onComplete({
        success: false,
        error: err.message
      });
    } finally {
      setImporting(false);
    }
  };
  
  return (
    <div className="import-step">
      <h3>Import Minecraft Map</h3>
      
      <div className="import-summary">
        <p>Selected region: {regionWidth}×{regionHeight}×{regionDepth} blocks</p>
        <p>Block types to import: {mappedBlockTypes} (out of {blockTypeCount})</p>
        <p>Estimated blocks to process: {potentialBlockCount.toLocaleString()}</p>
      </div>
      
      {importing && (
        <div className="import-progress">
          <p>Converting Minecraft map to HYTOPIA format...</p>
          <div className="progress-bar">
            <div className="progress-bar-inner" style={{ width: `${progress}%` }}></div>
          </div>
          <p>{progress}% complete</p>
          <p className="hint-text">This may take a few moments for large maps...</p>
        </div>
      )}
      
      {result && (
        <div className="import-result">
          <div className="success-message">
            <h4>Conversion Complete!</h4>
            <p>Successfully converted {result.stats && result.stats.processedBlocks ? result.stats.processedBlocks.toLocaleString() : 0} blocks.</p>
          </div>
          
          <div className="stats-container">
            <h4>Import Statistics</h4>
            <div className="stats-item">
              <span className="stats-label">Blocks imported:</span>
              <span>{result.stats && result.stats.processedBlocks ? result.stats.processedBlocks.toLocaleString() : 0}</span>
            </div>
            <div className="stats-item">
              <span className="stats-label">Blocks skipped:</span>
              <span>{result.stats && result.stats.skippedBlocks ? result.stats.skippedBlocks.toLocaleString() : 0}</span>
            </div>
            <div className="stats-item">
              <span className="stats-label">Unique block types:</span>
              <span>{result.stats && result.stats.uniqueBlockTypes ? result.stats.uniqueBlockTypes.length : 0}</span>
            </div>
            {result.stats && result.stats.originalCenter && (
              <div className="stats-item">
                <span className="stats-label">Original center point:</span>
                <span>({result.stats.originalCenter.x}, {result.stats.originalCenter.y}, {result.stats.originalCenter.z})</span>
              </div>
            )}
          </div>
          
          <div className="world-bounds-info">
            <h4>Map Placement in World</h4>
            <p>The map has been centered at (0,0) on the X-Z plane with the bottom at Y=0.</p>
            {result.stats && result.stats.worldBounds && (
              <div className="bounds-diagram">
                <p>Map now extends from ({result.stats.worldBounds.minX}, {result.stats.worldBounds.minY}, {result.stats.worldBounds.minZ}) to ({result.stats.worldBounds.maxX}, {result.stats.worldBounds.maxY}, {result.stats.worldBounds.maxZ})</p>
                <div className="bounds-visual">
                  <div className="bounds-box" style={{
                    width: '100%',
                    height: '100px',
                    position: 'relative',
                    border: '1px solid #999',
                    marginTop: '10px'
                  }}>
                    <div className="origin-marker" style={{
                      position: 'absolute',
                      left: '50%',
                      bottom: '0',
                      width: '10px',
                      height: '10px',
                      background: 'red',
                      borderRadius: '50%',
                      transform: 'translate(-50%, 50%)'
                    }}></div>
                    <div className="origin-label" style={{
                      position: 'absolute',
                      left: '50%',
                      bottom: '-20px',
                      transform: 'translateX(-50%)',
                      fontSize: '12px',
                      fontWeight: 'bold'
                    }}>
                      (0,0,0)
                    </div>
                  </div>
                </div>
              </div>
            )}
            <p>Click "Complete Import" to add these blocks to your HYTOPIA world.</p>
          </div>
        </div>
      )}
      
      {error && (
        <div className="error-message">
          <h4>Import Failed</h4>
          <p>{error}</p>
          <button className="secondary-button" onClick={handleStartImport}>
            Try Again
          </button>
        </div>
      )}
    </div>
  );
};

export default ImportStep; 