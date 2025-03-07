import React, { useState, useEffect } from 'react';
import { suggestMapping, getHytopiaBlocks } from '../../utils/minecraft/BlockMapper';

const BlockTypeMapper = ({ worldData, selectedRegion, onMappingsUpdated, initialMappings }) => {
  const [mappings, setMappings] = useState({});
  const [availableHytopiaBlocks, setAvailableHytopiaBlocks] = useState([]);
  const [customTextureFiles, setCustomTextureFiles] = useState({});
  const [autoMapped, setAutoMapped] = useState(false);
  
  // Initialize available HYTOPIA blocks
  useEffect(() => {
    // Get the built-in block types
    const blocks = getHytopiaBlocks();
    setAvailableHytopiaBlocks(blocks);
  }, []);
  
  // Initialize mappings from worldData or initial mappings
  useEffect(() => {
    if (initialMappings && Object.keys(initialMappings).length > 0) {
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
  }, [worldData, initialMappings, onMappingsUpdated]);
  
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
  
  const handleFileUpload = (blockType, file) => {
    // Create a URL for the uploaded file
    const textureUrl = URL.createObjectURL(file);
    
    setCustomTextureFiles(prev => ({
      ...prev,
      [blockType]: { file, url: textureUrl }
    }));
    
    setMappings(prev => {
      const updated = {
        ...prev,
        [blockType]: {
          ...prev[blockType],
          customTexture: textureUrl,
          action: 'custom'
        }
      };
      
      onMappingsUpdated(updated);
      return updated;
    });
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
      </div>
      
      <div className="mapping-stats">
        <p>{mappedCount} blocks mapped to HYTOPIA blocks</p>
        <p>{customCount} blocks using custom textures</p>
        <p>{skippedCount} blocks will be skipped</p>
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
                    <div className="custom-texture-uploader">
                      {mapping.customTexture ? (
                        <div className="texture-preview">
                          <img
                            src={mapping.customTexture}
                            alt={`Texture for ${mapping.name}`}
                            className="block-thumbnail"
                          />
                          <label className="upload-button">
                            Change
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: 'none' }}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleFileUpload(blockType, file);
                              }}
                            />
                          </label>
                        </div>
                      ) : (
                        <label className="upload-button">
                          Upload Texture
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display: 'none' }}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleFileUpload(blockType, file);
                            }}
                          />
                        </label>
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