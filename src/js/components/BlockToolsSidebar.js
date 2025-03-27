import React, { useState, useEffect } from "react";
import BlockButton from "./BlockButton";
import EnvironmentButton from "./EnvironmentButton";
import { DatabaseManager, STORES } from '../DatabaseManager';
import { environmentModels } from '../EnvironmentBuilder';
import { blockTypes, processCustomBlock, batchProcessCustomBlocks, getCustomBlocks, removeCustomBlock, getBlockTypes } from '../managers/BlockTypesManager';
import "../../css/BlockToolsSidebar.css";

const SCALE_MIN = 0.1;
const SCALE_MAX = 5.0;
const ROTATION_MIN = 0;
const ROTATION_MAX = 360;

let selectedBlockID = 0;

export const refreshBlockTools = () => {
  const event = new CustomEvent('refreshBlockTools');
  window.dispatchEvent(event);
};

// Expose the function globally so it can be called from other components
if (typeof window !== 'undefined') {
  window.refreshBlockTools = refreshBlockTools;
}

const BlockToolsSidebar = ({
  activeTab,
  terrainBuilderRef,
  setActiveTab,
  setCurrentBlockType,
  environmentBuilder,
  onPlacementSettingsChange,
}) => {
  const [settings, setSettings] = useState({
    randomScale: false,
    randomRotation: false,
    minScale: 0.5,
    maxScale: 1.5,
    minRotation: 0,
    maxRotation: 360,
    scale: 1.0,
    rotation: 0
  });

  const [customBlocks, setCustomBlocks] = useState([]);

  useEffect(() => {
    const handleRefresh = () => {
      console.log("Handling refresh event in BlockToolsSidebar");
      try {
        const customBlocksData = getCustomBlocks();
        console.log("Custom blocks loaded:", customBlocksData);
        setCustomBlocks(customBlocksData);
      } catch (error) {
        console.error("Error refreshing custom blocks:", error);
      }
    };
    
    // Handle custom blocks updated event from Minecraft importer
    const handleCustomBlocksUpdated = (event) => {
      console.log("Custom blocks updated from Minecraft importer:", event.detail?.blocks);
      handleRefresh();
    };
    
    // Initial load
    handleRefresh();
    
    // Listen for all relevant events
    window.addEventListener('refreshBlockTools', handleRefresh);
    window.addEventListener('custom-blocks-loaded', handleRefresh);
    window.addEventListener('custom-blocks-updated', handleCustomBlocksUpdated);
    window.addEventListener('textureAtlasUpdated', handleRefresh);
    
    return () => {
      window.removeEventListener('refreshBlockTools', handleRefresh);
      window.removeEventListener('custom-blocks-loaded', handleRefresh);
      window.removeEventListener('custom-blocks-updated', handleCustomBlocksUpdated);
      window.removeEventListener('textureAtlasUpdated', handleRefresh);
    };
  }, []);

  const updateSettings = (updates) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    // Pass settings up to parent
    onPlacementSettingsChange?.(newSettings);
  };

  const handleDragStart = (blockId) => {
    console.log("Drag started with block:", blockId);
  };

    // Update the tab switching logic
  const handleTabChange = (newTab) => {
    // Reset current block type to default block when switching to blocks tab
    if (newTab === "blocks") {
        setCurrentBlockType(blockTypes[0]);
    }
    else if (newTab === "environment") {
      setCurrentBlockType(environmentModels[0]);
    }
    setActiveTab(newTab);
  };


  const handleDeleteCustomBlock = async (blockType) => {
    const confirmMessage = `Deleting "${blockType.name}" will replace any instances of this block with an error texture. Are you sure you want to proceed?`;
    
    if (window.confirm(confirmMessage)) {
      // Just pass the ID of the block to remove
      removeCustomBlock(blockType.id);
      
      try {
        // Update terrain to replace deleted block instances with error blocks
        const currentTerrain = await DatabaseManager.getData(STORES.TERRAIN, 'current') || {};
        const newTerrain = { ...currentTerrain };
        
        // Create an error block to replace deleted blocks
        const errorBlock = {
          id: 999, // Special ID for error blocks
          name: `missing_${blockType.name}`,
          textureUri: './assets/blocks/error.png',
          hasMissingTexture: true,
          originalId: blockType.id // Store the original ID for potential future recovery
        };
        
        // Replace all instances of the deleted block with the error block
        Object.entries(newTerrain).forEach(([position, block]) => {
          if (block.id === blockType.id) {
            newTerrain[position] = errorBlock;
          }
        });
        
        await DatabaseManager.saveData(STORES.TERRAIN, 'current', newTerrain);
        terrainBuilderRef.current.buildUpdateTerrain();
      } catch (error) {
        console.error('Error updating database after block deletion:', error);
      }
    }
  };

  const handleDeleteEnvironmentModel = async (modelId) => {
    if (window.confirm('Are you sure you want to delete this custom model?')) {
      try {
        const existingModels = await DatabaseManager.getData(STORES.CUSTOM_MODELS, 'models') || [];
        const modelToDelete = environmentModels.find(model => model.id === modelId);
        
        if (!modelToDelete) return;

        // Find and remove the model from environmentModels array
        const modelIndex = environmentModels.findIndex(model => model.id === modelId);
        if (modelIndex !== -1) {
          environmentModels.splice(modelIndex, 1);
        }

        // Remove from custom models database
        const updatedModels = existingModels.filter(model => model.name !== modelToDelete.name);
        await DatabaseManager.saveData(STORES.CUSTOM_MODELS, 'models', updatedModels);

        // Remove all instances of this model from the environment
        const currentEnvironment = await DatabaseManager.getData(STORES.ENVIRONMENT, 'current') || [];
        const updatedEnvironment = currentEnvironment.filter(obj => obj.name !== modelToDelete.name);

        // Save the updated environment
        await DatabaseManager.saveData(STORES.ENVIRONMENT, 'current', updatedEnvironment);
        
        // Refresh the environment builder to reflect changes
        if (environmentBuilder && environmentBuilder.current) {
          await environmentBuilder.current.refreshEnvironmentFromDB();
        }
      } catch (error) {
        console.error('Error deleting environment model:', error);
      }
    }
  };

  const handleEnvironmentSelect = (envType) => {
    console.log("Environment selected:", envType);
    setCurrentBlockType({
      ...envType,
      isEnvironment: true
    });
    selectedBlockID = envType.id;
  };

  const handleBlockSelect = (blockType) => {
    // Set the current block type
    setCurrentBlockType({
      ...blockType,
      isEnvironment: false
    });
    selectedBlockID = blockType.id;
  };


  const handleCustomAssetDropUpload = async (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove("drag-over");
    const files = Array.from(e.dataTransfer.files);
    
    /// process blocks first
    if (activeTab === "blocks") {
      const imageFiles = files.filter(file => file.type.startsWith("image/"));
      
      /// if there are any image files, process them
      if (imageFiles.length > 0) {
        // Use different approach based on number of files
        if (imageFiles.length > 1) {
          // For multiple files, use batch processing for better performance
          try {
            // Read all files first
            const blockPromises = imageFiles.map(file => {
              return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => {
                  const blockName = file.name.replace(/\.[^/.]+$/, ""); // Remove file extension
                  
                  resolve({
                    name: blockName,
                    textureUri: reader.result
                  });
                };
                reader.readAsDataURL(file);
              });
            });
            
            // Wait for all files to be read
            const blocks = await Promise.all(blockPromises);
            
            // Process all blocks in a batch
            await batchProcessCustomBlocks(blocks);
            
            // Save custom blocks to database after batch processing
            const updatedCustomBlocks = getCustomBlocks();
            await DatabaseManager.saveData(STORES.CUSTOM_BLOCKS, 'blocks', updatedCustomBlocks);
            
            // Refresh the block tools once after batch processing
            refreshBlockTools();
          } catch (error) {
            console.error("Error in batch processing custom blocks:", error);
          }
        } else {
          // For single file, use the original approach
          const filePromises = imageFiles.map(file => {
            return new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => {
                const blockName = file.name.replace(/\.[^/.]+$/, ""); // Remove file extension
                const block = {
                  name: blockName,
                  textureUri: reader.result
                };
                
                // Process the block
                processCustomBlock(block);
                resolve();
              };
              reader.readAsDataURL(file);
            });
          });

          // Wait for the file to be processed
          await Promise.all(filePromises);
          
          // Save the custom blocks to the database
          try {
            const updatedCustomBlocks = getCustomBlocks();
            await DatabaseManager.saveData(STORES.CUSTOM_BLOCKS, 'blocks', updatedCustomBlocks);
          } catch (error) {
            console.error("Error saving custom blocks to database:", error);
          }
          
          // Refresh the block tools to show the new blocks
          refreshBlockTools();
        }
      }
    }
    /// process environment objects next
    else if (activeTab === "environment") {
      const gltfFiles = files.filter(file => file.name.endsWith('.gltf'));

      if (gltfFiles.length > 0) {
        for (const file of gltfFiles) {
          const fileName = file.name.replace(/\.[^/.]+$/, "");
          
          if (environmentModels.some(model => model.name.toLowerCase() === fileName.toLowerCase())) {
            alert(`A model named "${fileName}" already exists. Please rename the file and try again.`);
            continue;
          }

          const reader = new FileReader();
          reader.onload = async () => {
            try {
              const existingModels = await DatabaseManager.getData(STORES.CUSTOM_MODELS, 'models') || [];
              const modelData = {
                name: fileName,
                data: reader.result,
                timestamp: Date.now()
              };

              const updatedModels = [...existingModels, modelData];
              await DatabaseManager.saveData(STORES.CUSTOM_MODELS, 'models', updatedModels);

              const blob = new Blob([reader.result], { type: 'model/gltf+json' });
              const fileUrl = URL.createObjectURL(blob);
              
              const newEnvironmentModel = {
                id: Math.max(...environmentModels.filter(model => model.isCustom).map(model => model.id), 199) + 1,
                name: fileName,
                modelUrl: fileUrl,
                isEnvironment: true,
                isCustom: true,
                animations: ['idle']
              };
              
              environmentModels.push(newEnvironmentModel);
              
              if (environmentBuilder) {
                await environmentBuilder.current.addCustomModel(newEnvironmentModel);
              }
            } catch (error) {
              console.error(`Error processing model ${fileName}:`, error);
            }
          };
          reader.readAsArrayBuffer(file);
        }
      }
    }
  };

  return (
    <div className="block-tools-container">
      <div className="dead-space"></div>
      <div className="block-tools-sidebar">
        <div className="tab-button-wrapper">
          <button
            className={`tab-button-left ${activeTab === "blocks" ? "active" : ""}`}
            onClick={() => handleTabChange("blocks")}
          >
            Blocks
          </button>
          <button
            className={`tab-button-right ${activeTab === "environment" ? "active" : ""}`}
            onClick={() => handleTabChange("environment")}
          >
            Environment
          </button>
        </div>
        <div className="block-buttons-grid">
          {activeTab === "blocks" ? (
            <>
              <div className="block-tools-section-label">
                Default Blocks (ID: 1-99)
              </div>
              {blockTypes.filter(block => block.id < 100).map((blockType) => (
                <BlockButton
                  key={blockType.id}
                  blockType={blockType}
                  isSelected={selectedBlockID === blockType.id}
                  onSelect={(block) => {
                    handleBlockSelect(block);
                    localStorage.setItem("selectedBlock", block.id);
                  }}
                  onDelete={handleDeleteCustomBlock}
                  handleDragStart={handleDragStart}
                />
              ))}
              <div className="block-tools-section-label">
                Custom Blocks (ID: 100-199)
              </div>
              {customBlocks.filter(block => block.id >= 100 && block.id < 200).map((blockType) => (
                <BlockButton
                  key={blockType.id}
                  blockType={blockType}
                  isSelected={selectedBlockID === blockType.id}
                  onSelect={(block) => {
                    handleBlockSelect(block);
                    localStorage.setItem("selectedBlock", block.id);
                  }}
                  onDelete={handleDeleteCustomBlock}
                  handleDragStart={handleDragStart}
                  needsTexture={blockType.needsTexture}
                />
              ))}
            </>
          ) : (
            <div className="environment-button-wrapper">
              <div style={{ width: "100%", borderBottom: "2px solid #ccc", fontSize: "12px", textAlign: "left" }}>
                Default Environment Objects (ID: 200-299)
              </div>
              {environmentModels.filter(envType => !envType.isCustom).map((envType) => (
                <EnvironmentButton
                  key={envType.id}
                  envType={envType}
                  isSelected={selectedBlockID === envType.id}
                  onSelect={(envType) => {
                    handleEnvironmentSelect(envType);
                    localStorage.setItem("selectedBlock", envType.id);
                  }}
                  onDelete={handleDeleteEnvironmentModel}
                />

              ))}
              <div style={{ width: "100%", borderBottom: "2px solid #ccc", fontSize: "12px", textAlign: "left", marginTop: "10px" }}>
                Custom Environment Objects (ID: 300+)
              </div>
              {environmentModels.filter(envType => envType.isCustom).map((envType) => (
                <EnvironmentButton
                  key={envType.id}
                  envType={envType}
                  isSelected={selectedBlockID === envType.id}
                  onSelect={(envType) => {
                    handleEnvironmentSelect(envType);
                    localStorage.setItem("selectedBlock", envType.id);
                  }}
                  onDelete={handleDeleteEnvironmentModel}
                />
              ))}
            </div>
          )}
        </div>

        {activeTab === "environment" && (
          <div className="placement-tools">
            <div className="placement-tools-grid">
              <div className="placement-tool full-width">
                <div className="randomize-header">
                  <input 
                    type="checkbox" 
                    id="randomScale"
                    className="placement-checkbox"
                    checked={settings.randomScale}
                    onChange={(e) => updateSettings({ randomScale: e.target.checked })}
                  />
                  <label htmlFor="randomScale">Randomize Scale</label>
                </div>
                <div className="min-max-inputs">
                  <div className="min-max-input">
                    <label>Range: </label>
                    <input 
                      type="number"
                      className="slider-value-input"
                      value={settings.minScale}
                      min={SCALE_MIN}
                      max={SCALE_MAX}
                      step="0.1"
                      disabled={!settings.randomScale}
                      onChange={(e) => updateSettings({ minScale: Number(e.target.value) })}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (value < SCALE_MIN || value > SCALE_MAX) {
                          alert(`Please enter a value between ${SCALE_MIN} and ${SCALE_MAX}!`);
                          updateSettings({ minScale: 0.5 });
                        }
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="min-max-input">
                    <label>-</label>
                    <input 
                      type="number"
                      className="slider-value-input"
                      value={settings.maxScale}
                      min={SCALE_MIN}
                      max={SCALE_MAX}
                      step="0.1"
                      disabled={!settings.randomScale}
                      onChange={(e) => updateSettings({ maxScale: Number(e.target.value) })}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (value < SCALE_MIN || value > SCALE_MAX) {
                          alert(`Please enter a value between ${SCALE_MIN} and ${SCALE_MAX}!`);
                          updateSettings({ maxScale: 1.5 });
                        }
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>
              </div>

              <div className="placement-tool full-width">
                <div className="randomize-header">
                  <input 
                    type="checkbox" 
                    id="randomRotation"
                    className="placement-checkbox"
                    checked={settings.randomRotation}
                    onChange={(e) => updateSettings({ randomRotation: e.target.checked })}
                  />
                  <label htmlFor="randomRotation">Randomize Rotation</label>
                </div>
                <div className="min-max-inputs">
                  <div className="min-max-input">
                    <label>Range: </label>
                    <input 
                      type="number"
                      className="slider-value-input"
                      value={settings.minRotation}
                      min={ROTATION_MIN}
                      max={ROTATION_MAX}
                      step="15"
                      disabled={!settings.randomRotation}
                      onChange={(e) => updateSettings({ minRotation: Number(e.target.value) })}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (value < ROTATION_MIN || value > ROTATION_MAX) {
                          alert(`Please enter a value between ${ROTATION_MIN} and ${ROTATION_MAX}!`);
                          updateSettings({ minRotation: 0 });
                        }
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="min-max-input">
                    <label>-</label>
                    <input 
                      type="number"
                      className="slider-value-input"
                      value={settings.maxRotation}
                      min={ROTATION_MIN}
                      max={ROTATION_MAX}
                      step="15"
                      disabled={!settings.randomRotation}
                      onChange={(e) => updateSettings({ maxRotation: Number(e.target.value) })}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (value < ROTATION_MIN || value > ROTATION_MAX) {
                          alert(`Please enter a value between ${ROTATION_MIN} and ${ROTATION_MAX}!`);
                          updateSettings({ maxRotation: 360 });
                        }
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>
              </div>

              <div className="placement-tool-slider">
                <div className="slider-header">
                  <label htmlFor="placementScale">Object Scale</label>
                  <input 
                    type="number"
                    className="slider-value-input"
                    value={settings.scale}
                    min={SCALE_MIN}
                    max={SCALE_MAX}
                    step="0.1"
                    disabled={settings.randomScale}
                    onChange={(e) => updateSettings({ scale: Number(e.target.value) })}
                    onBlur={(e) => {
                      const value = Number(e.target.value);
                      if (value < SCALE_MIN || value > SCALE_MAX) {
                        alert(`Please enter a value between ${SCALE_MIN} and ${SCALE_MAX}!`);
                        updateSettings({ scale: 1.0 });
                      }
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
                <input 
                  type="range" 
                  id="placementScale"
                  min={SCALE_MIN}
                  max={SCALE_MAX}
                  step="0.1"
                  value={settings.scale}
                  className="placement-slider"
                  onChange={(e) => updateSettings({ scale: Number(e.target.value) })}
                  disabled={settings.randomScale}
                />
              </div>

              <div className="placement-tool-slider">
                <div className="slider-header">
                  <label htmlFor="placementRotation">Rotation</label>
                  <input 
                    type="number"
                    className="slider-value-input"
                    value={settings.rotation}
                    min={ROTATION_MIN}
                    max={ROTATION_MAX}
                    step="15"
                    disabled={settings.randomRotation}
                    onChange={(e) => updateSettings({ rotation: Number(e.target.value) })}
                    onBlur={(e) => {
                      const value = Number(e.target.value);
                      if (value < ROTATION_MIN || value > ROTATION_MAX) {
                        alert(`Please enter a value between ${ROTATION_MIN} and ${ROTATION_MAX}!`);
                        updateSettings({ rotation: 0 });
                      }
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                  <span className="degree-symbol">°</span>
                </div>
                <input 
                  type="range" 
                  id="placementRotation"
                  min={ROTATION_MIN}
                  max={ROTATION_MAX}
                  step="15"
                  value={settings.rotation}
                  className="placement-slider"
                  onChange={(e) => updateSettings({ rotation: Number(e.target.value) })}
                  disabled={settings.randomRotation}
                />
              </div>
            </div>
          </div>
        )}

        <div className="texture-drop-zone"
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.classList.add("drag-over");
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove("drag-over");
          }}
          onDrop={handleCustomAssetDropUpload}
        >
          <div className="drop-zone-content">
            <div className="drop-zone-icons">
              <img className="upload-icon" src="./assets/ui/icons/upload-icon.png" />
            </div>
            <div className="drop-zone-text">
              {activeTab === "blocks" 
                ? "Drag textures here to add new blocks or fix missing textures"
                : "Drag .gltf models here to add new environment objects"}
            </div>
          </div>
        </div>
      </div>
      <div className="dead-space"></div>
    </div>
  );
};

export default BlockToolsSidebar;
