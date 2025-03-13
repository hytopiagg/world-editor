import React, { useState, useEffect } from 'react';
import { MinecraftToHytopiaConverter } from '../../utils/MinecraftToHytopiaConverter';
import { processCustomBlock, getCustomBlocks } from '../../TerrainBuilder';

const ImportStep = ({ worldData, blockMappings, onImportComplete }) => {
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  
  // Get selectedRegion from worldData
  const selectedRegion = worldData?.selectedRegion;
  
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
      // Process any custom textures first (in parallel for efficiency)
      const customMappings = Object.entries(blockMappings)
        .filter(([_, mapping]) => mapping.action === 'custom')
        .map(([blockType, mapping]) => ({
          blockType,
          name: mapping.name || formatBlockName(blockType),
          textureUri: mapping.customTexture,
          customTextureId: mapping.customTextureId
        }));
      
      if (customMappings.length > 0) {
        console.log("Processing custom textures:", customMappings);
        
        // Process custom textures in parallel for better performance
        await Promise.all(customMappings.map(async (mapping) => {
          // Only process if it has a texture URI
          if (mapping.textureUri) {
            // Check if this custom texture already exists
            const existingCustomBlocks = getCustomBlocks();
            const existingBlock = existingCustomBlocks.find(block => 
              block.id === mapping.customTextureId
            );
            
            if (!existingBlock) {
              console.log(`Processing custom texture for ${mapping.blockType}`);
              // Process the custom block to ensure it exists
              await processCustomBlock({
                id: mapping.customTextureId,
                name: mapping.name,
                textureUri: mapping.textureUri,
                isCustom: true
              });
            } else {
              console.log(`Custom texture already exists for ${mapping.blockType}`);
            }
          }
        }));
      }
      
      // Create converter with optimized settings
      const converter = new MinecraftToHytopiaConverter(
        worldData,
        worldData.selectedRegion,
        blockMappings
      );
      
      // Set progress callback
      converter.setProgressCallback((percent) => {
        // Only update UI when progress changes significantly
        if (percent - progress >= 2 || percent === 100) {
          setProgress(percent);
        }
      });
      
      // Display a console time log for performance monitoring
      console.time('Minecraft map conversion');
      
      // Start conversion
      const conversionResult = await converter.convert();
      
      console.timeEnd('Minecraft map conversion');
      
      // Set result
      setResult(conversionResult);
      
      // Call onImportComplete with result
      onImportComplete(conversionResult);
    } catch (err) {
      console.error("Import error:", err);
      setError(err.message || "An error occurred during import");
      setResult({
        success: false,
        error: err.message || "An error occurred during import"
      });
      onImportComplete({
        success: false,
        error: err.message || "An error occurred during import"
      });
    } finally {
      setImporting(false);
    }
  };
  
  // Helper function to format block names
  const formatBlockName = (mcBlockName) => {
    return mcBlockName
      .replace('minecraft:', '')
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };
  
  return (
    <div className="import-step">
      <h3>Import Minecraft Map</h3>
      
      {/* Progress indicator - now at the top */}
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
      
      <div className="import-summary">
        <p>Selected region: {regionWidth}×{regionHeight}×{regionDepth} blocks</p>
        <p>Block types to import: {mappedBlockTypes} (out of {blockTypeCount})</p>
        <p>Estimated blocks to process: {potentialBlockCount.toLocaleString()}</p>
      </div>
      
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