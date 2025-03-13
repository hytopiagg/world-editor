import React, { useState, useEffect, useRef } from 'react';
import { suggestMapping, getHytopiaBlocks } from '../../utils/minecraft/BlockMapper';
import { getCustomBlocks, processCustomBlock } from '../../TerrainBuilder';
import { loadingManager } from '../../LoadingManager';

// Add CSS for the custom texture library
const customTextureLibraryStyles = `
  .custom-texture-library {
    margin: 15px 0;
    padding: 15px;
    background-color: #2a2a2a;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
  
  .custom-texture-library h4 {
    margin-top: 0;
    margin-bottom: 10px;
    color: #4a90e2;
    font-size: 16px;
  }
  
  .texture-instructions {
    color: #ccc;
    margin-bottom: 12px;
    line-height: 1.4;
    font-size: 13px;
  }
  
  .texture-instructions strong {
    color: #4a90e2;
  }
  
  .texture-library-container {
    margin-top: 10px;
  }
  
  .texture-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));
    gap: 10px;
  }
  
  .texture-item {
    background-color: #333;
    border-radius: 4px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    aspect-ratio: 1/1;
  }
  
  .texture-item:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
  }
  
  .texture-thumbnail {
    width: 100%;
    height: 70%;
    object-fit: cover;
  }
  
  .texture-name {
    padding: 4px;
    font-size: 10px;
    text-align: center;
    color: #ddd;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    height: 30%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .texture-drop-area {
    background-color: #333;
    border: 2px dashed #555;
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 10px;
    cursor: pointer;
    transition: all 0.2s ease;
    aspect-ratio: 1/1;
  }
  
  .texture-drop-area:hover, .texture-drop-area.drag-over {
    background-color: #3a3a3a;
    border-color: #4a90e2;
  }
  
  .drop-icon {
    font-size: 20px;
    color: #4a90e2;
    margin-bottom: 4px;
  }
  
  .drop-text {
    color: #fff;
    font-size: 12px;
    margin-bottom: 2px;
  }
  
  .drop-subtext {
    color: #999;
    font-size: 10px;
  }
  
  .no-textures-message {
    color: #999;
    font-style: italic;
    padding: 4px 0;
  }
`;

const BlockTypeMapper = ({ worldData, onMappingsUpdated, initialMappings }) => {
  //console.log('[TIMING] BlockTypeMapper: Component function called');
  
  const [isInitializing, setIsInitializing] = useState(true);
  const [mappings, setMappings] = useState({});
  const [availableHytopiaBlocks, setAvailableHytopiaBlocks] = useState([]);
  const [customTextureFiles, setCustomTextureFiles] = useState({});
  const [autoMapped, setAutoMapped] = useState(false);
  const [customTextures, setCustomTextures] = useState([]);
  const fileInputRef = useRef(null);
  const dropAreaRef = useRef(null);
  const initRunRef = useRef(false);
  const cleanupRef = useRef(null);
  
  // Get selectedRegion from worldData
  const selectedRegion = worldData?.selectedRegion;
  
  // Initialize mappings from worldData or initial mappings
  useEffect(() => {
    // Make sure any existing loading screens are hidden first
    loadingManager.forceHideAll();
    
    // Removed loading screen popup - no need for overlay when we have UI indicators
    // We'll rely on the UI's own loading indicators instead
    
    // Prevent duplicate initialization
    if (initRunRef.current) return;
    initRunRef.current = true;
    
    //console.log('[TIMING] BlockTypeMapper: Second useEffect (mappings) started');
    
    const initializeMappings = async () => {
      try {
        setIsInitializing(true);
        
        // First initialize available blocks and custom textures
        const blocks = getHytopiaBlocks();
        setAvailableHytopiaBlocks(blocks);
        
        // Get custom blocks for their textures
        const customBlocks = getCustomBlocks();
        setCustomTextures(customBlocks.map(block => ({
          id: block.id,
          name: block.name,
          textureUri: block.textureUri
        })));
        
        // Set up event listener for custom blocks loaded
        const handleCustomBlocksLoaded = (event) => {
          const loadedBlocks = event.detail.blocks;
          setCustomTextures(loadedBlocks.map(block => ({
            id: block.id,
            name: block.name,
            textureUri: block.textureUri
          })));
        };
        
        // Set up event listener for custom blocks updated
        const handleCustomBlocksUpdated = (event) => {
          console.log("Custom blocks updated event received:", event.detail);
          const updatedBlocks = event.detail.blocks;
          setCustomTextures(updatedBlocks.map(block => ({
            id: block.id,
            name: block.name,
            textureUri: block.textureUri
          })));
        };
        
        window.addEventListener('custom-blocks-loaded', handleCustomBlocksLoaded);
        window.addEventListener('custom-blocks-updated', handleCustomBlocksUpdated);
        
        // Make sure to remove the event listeners when component unmounts
        const cleanup = () => {
          window.removeEventListener('custom-blocks-loaded', handleCustomBlocksLoaded);
          window.removeEventListener('custom-blocks-updated', handleCustomBlocksUpdated);
        };
        
        // Store cleanup function in ref so we can access it in the useEffect cleanup
        cleanupRef.current = cleanup;
        
        loadingManager.updateLoading('Processing block types...', 30);
        
        // Allow UI to update before starting the heavy work
        await new Promise(resolve => setTimeout(resolve, 50));
        
        if (initialMappings && Object.keys(initialMappings).length > 0) {
          console.log('[TIMING] BlockTypeMapper: Using initial mappings', Object.keys(initialMappings).length);
          setMappings(initialMappings);
        } else if (worldData && worldData.blockTypes && worldData.blockTypes.length > 0) {
          console.log('[TIMING] BlockTypeMapper: Processing worldData block types, count:', worldData.blockTypes.length);
          
          const newMappings = {};
          const blockTypes = worldData.blockTypes;
          const totalBlockTypes = blockTypes.length;
          
          // Process in batches to avoid UI freezing
          const BATCH_SIZE = 20;
          let processedTypes = 0;
          
          for (let i = 0; i < totalBlockTypes; i += BATCH_SIZE) {
            const batchEnd = Math.min(i + BATCH_SIZE, totalBlockTypes);
            
            // Process this batch
            for (let j = i; j < batchEnd; j++) {
              const blockType = blockTypes[j];
              const suggestion = suggestMapping(blockType);
              newMappings[blockType] = {
                action: suggestion.action,
                targetBlockId: suggestion.id,
                name: formatBlockName(blockType)
              };
              processedTypes++;
            }
            
            // Update loading progress
            const progress = Math.floor(30 + (processedTypes / totalBlockTypes) * 60);
            loadingManager.updateLoading(`Mapping block types: ${processedTypes}/${totalBlockTypes}`, progress);
            
            // Allow UI to update between batches
            if (i + BATCH_SIZE < totalBlockTypes) {
              await new Promise(resolve => setTimeout(resolve, 0));
            }
          }
          
          // Set mappings and notify parent
          setMappings(newMappings);
          onMappingsUpdated(newMappings);
          
          // Auto-map on initialization to prevent getting stuck
          setAutoMapped(true);
        }
        
        // Update loading status before finishing
        loadingManager.updateLoading('Finalizing block mapping interface...', 95);
        
        // Allow UI to finish updating
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error('Error initializing block mappings:', error);
      } finally {
        // Don't show overlay loading screen - UI already has its own indicators
        setIsInitializing(false);
      }
    };
    
    // Start initialization
    initializeMappings();
    
    // Return cleanup function
    return () => {
      // Call the cleanup function if it exists
      if (cleanupRef.current) {
        cleanupRef.current();
      }
      
      // Still make sure loading screen is hidden when component unmounts, just in case
      loadingManager.forceHideAll();
    };
  }, [worldData, initialMappings, onMappingsUpdated]);
  
  // Set up drag and drop handlers
  useEffect(() => {
    // Note: We're now using inline event handlers on the drop area element
    // This is a more reliable approach than adding event listeners here
    // The inline handlers are added directly to the JSX element
    
    // We'll keep this useEffect for any additional setup or cleanup needed
    return () => {
      // Any cleanup if needed
    };
  }, []);
  
  const formatBlockName = (mcBlockName) => {
    // Convert "minecraft:stone" to "Stone"
    return mcBlockName
      .replace('minecraft:', '')
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };
  
  const handleActionChange = (blockType, action) => {
    setMappings(prev => {
      const updated = {
        ...prev,
        [blockType]: {
          ...prev[blockType],
          action
        }
      };
      
      // If switching to map, set a default target
      if (action === 'map' && !updated[blockType].targetBlockId && availableHytopiaBlocks.length > 0) {
        updated[blockType].targetBlockId = availableHytopiaBlocks[0].id;
      }
      
      // If switching to custom and we have custom textures, set the first one
      if (action === 'custom' && customTextures.length > 0 && !updated[blockType].customTexture) {
        updated[blockType].customTexture = customTextures[0].textureUri;
        updated[blockType].customTextureId = customTextures[0].id;
      }
      
      onMappingsUpdated(updated);
      return updated;
    });
  };
  
  const handleTargetBlockChange = (blockType, targetBlockId) => {
    setMappings(prev => {
      const updated = {
        ...prev,
        [blockType]: {
          ...prev[blockType],
          targetBlockId: parseInt(targetBlockId, 10)
        }
      };
      
      onMappingsUpdated(updated);
      return updated;
    });
  };
  
  const handleCustomTextureChange = (blockType, textureId) => {
    const selectedTexture = customTextures.find(texture => texture.id === parseInt(textureId, 10));
    
    if (!selectedTexture) return;
    
    console.log("Selected texture:", selectedTexture);
    
    setMappings(prev => {
      const updated = {
        ...prev,
        [blockType]: {
          ...prev[blockType],
          customTexture: selectedTexture.textureUri,
          customTextureId: selectedTexture.id,
          action: 'custom' // Ensure action is set to custom
        }
      };
      
      console.log("Updated mapping:", updated[blockType]);
      
      onMappingsUpdated(updated);
      return updated;
    });
  };
  
  const handleFileUpload = (blockType, file) => {
    // Create a URL for the uploaded file
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const textureUri = e.target.result;
      
      // Create a custom block with this texture
      const blockName = `Custom ${customTextures.length + 1}`;
      
      // Process the custom block
      processCustomBlock({
        name: blockName,
        textureUri: textureUri
      });
      
      // The custom-blocks-loaded event will update our customTextures state
      
      // Update the mapping for this block type
      setTimeout(() => {
        // Get the latest custom blocks
        const latestCustomBlocks = getCustomBlocks();
        const newBlock = latestCustomBlocks[latestCustomBlocks.length - 1];
        
        if (newBlock) {
          setMappings(prev => {
            const updated = {
              ...prev,
              [blockType]: {
                ...prev[blockType],
                customTexture: newBlock.textureUri,
                customTextureId: newBlock.id,
                action: 'custom'
              }
            };
            
            onMappingsUpdated(updated);
            return updated;
          });
        }
      }, 100);
    };
    
    reader.readAsDataURL(file);
  };
  
  const handleCustomTextureUpload = (files) => {
    console.log("Processing uploaded files:", files);
    
    if (!files || files.length === 0) {
      console.warn("No files provided to handleCustomTextureUpload");
      return;
    }
    
    // Process each file
    files.forEach(file => {
      if (file.type.startsWith('image/')) {
        console.log(`Processing image file: ${file.name} (${file.type}, ${file.size} bytes)`);
        
        const reader = new FileReader();
        
        reader.onload = (e) => {
          const textureUri = e.target.result;
          
          // Create a custom block with this texture
          const blockName = file.name.split('.')[0] || `Custom ${customTextures.length + 1}`;
          
          console.log(`Processing custom texture: ${blockName}`);
          
          try {
            // Process the custom block
            processCustomBlock({
              name: blockName,
              textureUri: textureUri
            });
            
            // Wait for the custom block to be processed
            setTimeout(() => {
              try {
                // Get the latest custom blocks
                const latestCustomBlocks = getCustomBlocks();
                
                console.log("Updated custom blocks:", latestCustomBlocks);
                
                // Update our custom textures state
                setCustomTextures(latestCustomBlocks.map(block => ({
                  id: block.id,
                  name: block.name,
                  textureUri: block.textureUri
                })));
                
                // Dispatch a custom event to notify that custom blocks have been updated
                const event = new CustomEvent('custom-blocks-updated', { 
                  detail: { blocks: latestCustomBlocks } 
                });
                window.dispatchEvent(event);
              } catch (error) {
                console.error("Error updating custom textures:", error);
              }
            }, 300);
          } catch (error) {
            console.error("Error processing custom block:", error);
          }
        };
        
        reader.onerror = (error) => {
          console.error(`Error reading file ${file.name}:`, error);
        };
        
        reader.readAsDataURL(file);
      } else {
        console.warn(`File ${file.name} is not an image (type: ${file.type}) and will be skipped.`);
      }
    });
  };
  
  const handleBrowseClick = () => {
    if (fileInputRef.current) {
      console.log("Browse button clicked, opening file dialog");
      fileInputRef.current.click();
    } else {
      console.error("File input reference is not available");
    }
  };

  const handleFileInputChange = (e) => {
    console.log("File input change event triggered");
    
    if (!e.target) {
      console.error("Event target is null");
      return;
    }
    
    if (e.target.files && e.target.files.length > 0) {
      console.log(`Files selected via browse: ${e.target.files.length} files`);
      
      try {
        const filesArray = Array.from(e.target.files);
        console.log("Files converted to array:", filesArray.map(f => f.name));
        handleCustomTextureUpload(filesArray);
      } catch (error) {
        console.error("Error processing selected files:", error);
      }
      
      // Reset input to allow selecting the same file again
      e.target.value = '';
    } else {
      console.log("No files selected or file selection canceled");
    }
  };
  
  const handleAutoMapAll = () => {
    // Create a new mapping object with all blocks mapped to best-guess HYTOPIA blocks
    const autoMappings = { ...mappings };
    
    Object.keys(autoMappings).forEach(blockType => {
      const suggestion = suggestMapping(blockType);
      autoMappings[blockType] = {
        ...autoMappings[blockType],
        action: suggestion.action,
        targetBlockId: suggestion.id
      };
    });
    
    setMappings(autoMappings);
    onMappingsUpdated(autoMappings);
    setAutoMapped(true);
  };
  
  // New function to map all unmapped/skipped blocks to defaults
  const handleMapUnmapped = () => {
    // Create a copy of the existing mappings
    const updatedMappings = { ...mappings };
    let changesCount = 0;
    
    // Process each block in the mappings
    Object.keys(updatedMappings).forEach(blockType => {
      // Only process blocks that are currently set to skip
      if (updatedMappings[blockType].action === 'skip') {
        // Try to get a suggestion first
        const suggestion = suggestMapping(blockType);
        
        // For blocks that are still set to skip (no obvious match),
        // force map them to a default block (grass - ID 7)
        updatedMappings[blockType] = {
          ...updatedMappings[blockType],
          action: 'map',
          targetBlockId: suggestion.action === 'map' ? suggestion.id : 7
        };
        
        changesCount++;
      }
    });
    
    // Update state with new mappings
    setMappings(updatedMappings);
    onMappingsUpdated(updatedMappings);
    console.log(`Applied default mappings to ${changesCount} previously unmapped blocks`);
  };
  
  const countBlocks = (action) => {
    return Object.values(mappings).filter(m => m.action === action).length;
  };
  
  // Generate stats about the mapping
  const mappedCount = countBlocks('map');
  const customCount = countBlocks('custom');
  const skippedCount = countBlocks('skip');
  const totalCount = Object.keys(mappings).length;
  
  // Add a loading indicator
  if (isInitializing) {
    // Let the global loading screen handle the loading state
    // We keep this check to prevent rendering the rest of the component during initialization
    return <div className="block-mapping-loader">Initializing block mappings...</div>;
  }
  
  return (
    <div className="block-mapping">
      {/* Add style tag for custom texture library */}
      <style>{customTextureLibraryStyles}</style>
      
      <h3>Map Block Types</h3>
      <p>
        Choose how to handle each Minecraft block type when importing to HYTOPIA.
        You can map to an existing HYTOPIA block, provide a custom texture, or skip the block entirely.
      </p>
      
      <div className="auto-map-container">
        <button 
          className="primary-button" 
          onClick={handleAutoMapAll}
          disabled={autoMapped}
        >
          {autoMapped ? "Auto-Mapped" : "Auto-Map All Blocks"}
        </button>
        <p>Click to automatically map all Minecraft blocks to the closest HYTOPIA equivalent</p>
        
        <button 
          className="secondary-button map-unmapped-button" 
          onClick={handleMapUnmapped}
          disabled={skippedCount === 0}
        >
          Map Unmapped Blocks ({skippedCount})
        </button>
        <p>Assign default blocks to any currently unmapped blocks, making a best guess based on block names</p>
      </div>
      
      <div className="mapping-stats">
        <p>{mappedCount} blocks mapped to HYTOPIA blocks</p>
        <p>{customCount} blocks using custom textures</p>
        <p>{skippedCount} blocks will be skipped</p>
      </div>
      
      {/* Custom Texture Library */}
      <div className="custom-texture-library">
        <h4>Custom Texture Library</h4>
        <p className="texture-instructions">
          Add your own textures to use for Minecraft blocks. 
          <strong> Drag and drop image files</strong> here or click the "Add Texture" box to browse.
        </p>
        
        <div className="texture-library-container">
          <div className="texture-grid">
            {customTextures.map(texture => (
              <div key={texture.id} className="texture-item">
                <img 
                  src={texture.textureUri} 
                  alt={texture.name} 
                  className="texture-thumbnail"
                />
                <div className="texture-name">{texture.name}</div>
              </div>
            ))}
            
            <div 
              ref={dropAreaRef}
              className="texture-drop-area"
              onClick={handleBrowseClick}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.classList.add('drag-over');
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.classList.remove('drag-over');
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.classList.remove('drag-over');
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  handleCustomTextureUpload(Array.from(e.dataTransfer.files));
                }
              }}
            >
              <div className="drop-icon">+</div>
              <div className="drop-text">Add Texture</div>
              <div className="drop-subtext">Drag & drop or click to browse</div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={handleFileInputChange}
              />
            </div>
          </div>
        </div>
      </div>
      
      <div className="block-mapping-table-container">
        <table className="block-mapping-table">
          <thead>
            <tr>
              <th>Minecraft Block</th>
              <th>Action</th>
              <th>HYTOPIA Block / Custom Texture</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(mappings).map(([blockType, mapping]) => (
              <tr key={blockType}>
                <td>{mapping.name || formatBlockName(blockType)}</td>
                <td>
                  <select
                    value={mapping.action}
                    onChange={(e) => handleActionChange(blockType, e.target.value)}
                  >
                    <option value="map">Map to HYTOPIA Block</option>
                    <option value="custom">Use Custom Texture</option>
                    <option value="skip">Skip</option>
                  </select>
                </td>
                <td>
                  {mapping.action === 'map' && (
                    <select
                      value={mapping.targetBlockId || ''}
                      onChange={(e) => handleTargetBlockChange(blockType, e.target.value)}
                    >
                      {availableHytopiaBlocks.map(block => (
                        <option key={block.id} value={block.id}>
                          {block.name}
                        </option>
                      ))}
                    </select>
                  )}
                  
                  {mapping.action === 'custom' && (
                    <div className="custom-texture-selector">
                      {customTextures.length > 0 ? (
                        <select
                          value={mapping.customTextureId || ''}
                          onChange={(e) => handleCustomTextureChange(blockType, e.target.value)}
                        >
                          {customTextures.map(texture => (
                            <option key={texture.id} value={texture.id}>
                              {texture.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="no-textures-message">
                          No custom textures available. Add some above.
                        </div>
                      )}
                      
                      {mapping.customTexture && (
                        <div className="texture-preview">
                          <img
                            src={mapping.customTexture}
                            alt={`Texture for ${mapping.name}`}
                            className="block-thumbnail"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default BlockTypeMapper; 