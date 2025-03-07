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
        stats: conversionResult.stats
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
            <p>Successfully converted {result.stats.processedBlocks.toLocaleString()} blocks.</p>
          </div>
          
          <div className="stats-container">
            <h4>Import Statistics</h4>
            <div className="stats-item">
              <span className="stats-label">Blocks imported:</span>
              <span>{result.stats.processedBlocks.toLocaleString()}</span>
            </div>
            <div className="stats-item">
              <span className="stats-label">Blocks skipped:</span>
              <span>{result.stats.skippedBlocks.toLocaleString()}</span>
            </div>
            <div className="stats-item">
              <span className="stats-label">Unique block types:</span>
              <span>{result.stats.uniqueBlockTypes.length}</span>
            </div>
          </div>
          
          <p>Click "Complete Import" to add these blocks to your HYTOPIA world.</p>
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