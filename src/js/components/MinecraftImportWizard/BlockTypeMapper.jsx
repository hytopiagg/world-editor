import React, { useState, useEffect, useRef } from 'react';
import { suggestMapping, getHytopiaBlocks } from '../../utils/minecraft/BlockMapper';
import { getCustomBlocks, processCustomBlock } from '../../TerrainBuilder';

// Add CSS for the custom texture library
const customTextureLibraryStyles = `
  .custom-texture-library {
    margin: 20px 0;
    padding: 15px;
    background-color: #222;
    border-radius: 4px;
  }
  
  .custom-texture-library h4 {
    margin-top: 0;
    margin-bottom: 10px;
    color: #2196f3;
  }
  
  .texture-library-container {
    margin-top: 15px;
  }
  
  .texture-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 15px;
    margin-top: 10px;
  }
  
  .texture-item {
    background-color: #333;
    border-radius: 4px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    transition: transform 0.2s, box-shadow 0.2s;
  }
  
  .texture-item:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
  }
  
  .texture-thumbnail {
    width: 64px;
    height: 64px;
    object-fit: contain;
    margin: 10px;
    image-rendering: pixelated;
  }
  
  .texture-name {
    width: 100%;
    padding: 8px;
    background-color: #444;
    color: white;
    text-align: center;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .texture-drop-area {
    background-color: #333;
    border: 2px dashed #666;
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 120px;
    cursor: pointer;
    transition: background-color 0.2s, border-color 0.2s;
  }
  
  .texture-drop-area:hover, .texture-drop-area.drag-over {
    background-color: #444;
    border-color: #2196f3;
  }
  
  .drop-icon {
    font-size: 32px;
    color: #666;
    margin-bottom: 5px;
  }
  
  .drop-text {
    color: #ccc;
    font-size: 14px;
  }
  
  .custom-texture-selector {
    display: flex;
    align-items: center;
  }
  
  .custom-texture-selector select {
    flex: 1;
    margin-right: 10px;
  }
  
  .texture-preview {
    display: flex;
    align-items: center;
  }
  
  .block-thumbnail {
    width: 32px;
    height: 32px;
    object-fit: contain;
    image-rendering: pixelated;
    background-color: #333;
    border: 1px solid #444;
  }
  
  .no-textures-message {
    color: #ff9800;
    font-style: italic;
  }
`;

const BlockTypeMapper = ({ worldData, onMappingsUpdated, initialMappings }) => {
  const [mappings, setMappings] = useState({});
  const [availableHytopiaBlocks, setAvailableHytopiaBlocks] = useState([]);
  const [customTextureFiles, setCustomTextureFiles] = useState({});
  const [autoMapped, setAutoMapped] = useState(false);
  const [customTextures, setCustomTextures] = useState([]);
  const fileInputRef = useRef(null);
  const dropAreaRef = useRef(null);
  
  // Get selectedRegion from worldData
  const selectedRegion = worldData?.selectedRegion;
  
  // Initialize available HYTOPIA blocks and custom textures
  useEffect(() => {
    // Get the built-in block types
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
    
    return () => {
      window.removeEventListener('custom-blocks-loaded', handleCustomBlocksLoaded);
      window.removeEventListener('custom-blocks-updated', handleCustomBlocksUpdated);
    };
  }, []);
  
  // Initialize mappings from worldData or initial mappings
  useEffect(() => {
    if (initialMappings && Object.keys(initialMappings).length > 0) {
      console.log("Using initial mappings:", initialMappings);
      
      // Make sure custom textures are loaded before setting mappings
      const customMappings = Object.entries(initialMappings)
        .filter(([_, mapping]) => mapping.action === 'custom')
        .map(([blockType, mapping]) => ({
          blockType,
          customTextureId: mapping.customTextureId,
          customTexture: mapping.customTexture
        }));
      
      if (customMappings.length > 0) {
        console.log("Found custom mappings:", customMappings);
        
        // Ensure custom textures are available
        const availableCustomTextureIds = customTextures.map(texture => texture.id);
        
        // Check if all custom texture IDs are available
        const missingCustomTextureIds = customMappings
          .filter(mapping => !availableCustomTextureIds.includes(mapping.customTextureId))
          .map(mapping => mapping.customTextureId);
        
        if (missingCustomTextureIds.length > 0) {
          console.warn("Some custom textures are missing:", missingCustomTextureIds);
        }
      }
      
      setMappings(initialMappings);
      return;
    }
    
    if (worldData && worldData.blockTypes && worldData.blockTypes.length > 0) {
      const newMappings = {};
      
      // Generate suggested mappings for each Minecraft block type
      worldData.blockTypes.forEach(blockType => {
        const suggestion = suggestMapping(blockType);
        newMappings[blockType] = {
          action: suggestion.action,
          targetBlockId: suggestion.id,
          name: formatBlockName(blockType)
        };
      });
      
      setMappings(newMappings);
      onMappingsUpdated(newMappings);
      
      // Auto-map on initialization to prevent getting stuck
      setAutoMapped(true);
    }
  }, [worldData, initialMappings, onMappingsUpdated, customTextures]);
  
  // Set up drag and drop handlers
  useEffect(() => {
    const dropArea = dropAreaRef.current;
    if (!dropArea) return;
    
    const handleDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropArea.classList.add('drag-over');
    };
    
    const handleDragLeave = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropArea.classList.remove('drag-over');
    };
    
    const handleDrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropArea.classList.remove('drag-over');
      
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleCustomTextureUpload(Array.from(e.dataTransfer.files));
      }
    };
    
    dropArea.addEventListener('dragover', handleDragOver);
    dropArea.addEventListener('dragleave', handleDragLeave);
    dropArea.addEventListener('drop', handleDrop);
    
    return () => {
      dropArea.removeEventListener('dragover', handleDragOver);
      dropArea.removeEventListener('dragleave', handleDragLeave);
      dropArea.removeEventListener('drop', handleDrop);
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
    
    // Process each file
    files.forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        
        reader.onload = (e) => {
          const textureUri = e.target.result;
          
          // Create a custom block with this texture
          const blockName = file.name.split('.')[0] || `Custom ${customTextures.length + 1}`;
          
          console.log(`Processing custom texture: ${blockName}`);
          
          // Process the custom block
          processCustomBlock({
            name: blockName,
            textureUri: textureUri
          });
          
          // Wait for the custom block to be processed
          setTimeout(() => {
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
          }, 300);
        };
        
        reader.readAsDataURL(file);
      } else {
        console.warn(`File ${file.name} is not an image and will be skipped.`);
      }
    });
  };
  
  const handleBrowseClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      console.log("Files selected via browse:", e.target.files);
      handleCustomTextureUpload(Array.from(e.target.files));
      e.target.value = ''; // Reset input to allow selecting the same file again
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
        <p>Drag and drop image files here to add custom textures, or click Browse to select files.</p>
        
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
            >
              <div className="drop-icon">+</div>
              <div className="drop-text">Add Texture</div>
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