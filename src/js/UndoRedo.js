import React, { useImperativeHandle } from 'react';
import { DatabaseManager, STORES } from './DatabaseManager';
import { MIN_UNDO_STATES, UNDO_THRESHOLD } from './Constants';

function UndoRedoManager({ terrainBuilderRef, environmentBuilderRef, children }, ref) {
  useImperativeHandle(ref, () => ({
    saveUndo,
    undo,
    redo,
    handleUndo,
    handleRedo
  }));

  const applyStates = async (states, initialTerrain, initialEnvironment) => {
    let newTerrain = { ...initialTerrain };
    let newEnvironment = [...initialEnvironment];

    for (const state of states) {
      // Apply terrain changes
      if (state.terrain) {
        // Remove blocks
        Object.keys(state.terrain.removed || {}).forEach(key => {
          delete newTerrain[key];
        });

        // Add blocks
        Object.entries(state.terrain.added || {}).forEach(([key, value]) => {
          newTerrain[key] = value;
        });
      }

      // Apply environment changes
      if (state.environment?.added || state.environment?.removed) {
        // Remove any objects listed in "removed". Use ±0.001 to match positions.
        newEnvironment = newEnvironment.filter(obj =>
          !(state.environment.removed || []).some(removed =>
            removed.modelUrl === obj.modelUrl &&
            Math.abs(removed.position.x - obj.position.x) < 0.001 &&
            Math.abs(removed.position.y - obj.position.y) < 0.001 &&
            Math.abs(removed.position.z - obj.position.z) < 0.001
          )
        );

        // Add any objects listed in "added"
        if (Array.isArray(state.environment.added)) {
          newEnvironment.push(...state.environment.added);
        }
      }
    }

    return { newTerrain, newEnvironment };
  };

  const commitOldStates = async (undoStates) => {
    try {
      // Keep the most recent MIN_UNDO_STATES
      const statesToKeep = undoStates.slice(0, MIN_UNDO_STATES);
      const statesToCommit = undoStates.slice(MIN_UNDO_STATES);

      // Apply all states in reverse order (oldest → newest)
      const reversedStatesToCommit = [...statesToCommit].reverse();

      // Get current terrain and environment
      const currentTerrain = await DatabaseManager.getData(STORES.TERRAIN, 'current') || {};
      const currentEnv = await DatabaseManager.getData(STORES.ENVIRONMENT, 'current') || [];

      // Apply all states that need to be committed
      const { newTerrain, newEnvironment } = await applyStates(
        reversedStatesToCommit,
        currentTerrain,
        currentEnv
      );

      // Save final state and the trimmed undo stack
      await Promise.all([
        DatabaseManager.saveData(STORES.TERRAIN, 'current', newTerrain),
        DatabaseManager.saveData(STORES.ENVIRONMENT, 'current', newEnvironment),
        DatabaseManager.saveData(STORES.UNDO, 'states', statesToKeep),
        DatabaseManager.saveData(STORES.REDO, 'states', [])
      ]);

      return { newTerrain, newEnvironment };
    } catch (error) {
      console.error('Error committing old states:', error);
      throw error;
    }
  };

  const undo = async () => {
    try {
      console.log("Starting undo operation...");
      const undoStates = await DatabaseManager.getData(STORES.UNDO, 'states') || [];
      console.log(`Found ${undoStates.length} undo states`);
      
      if (undoStates.length === 0) {
        console.log("No undo states available");
        return null;
      }

      const [currentUndo, ...remainingUndo] = undoStates;
      console.log("Undo state:", currentUndo);
      const redoStates = await DatabaseManager.getData(STORES.REDO, 'states') || [];

      // Get current terrain and environment
      const currentTerrain = await DatabaseManager.getData(STORES.TERRAIN, 'current') || {};
      const currentEnv = await DatabaseManager.getData(STORES.ENVIRONMENT, 'current') || [];
      console.log(`Current terrain has ${Object.keys(currentTerrain).length} blocks`);

      // Apply undo changes
      let newTerrain = { ...currentTerrain };
      let newEnvironment = [...currentEnv];

      if (currentUndo.terrain) {
        // Remove added blocks
        if (currentUndo.terrain.added) {
          const addedKeys = Object.keys(currentUndo.terrain.added);
          console.log(`Removing ${addedKeys.length} added blocks`);
          addedKeys.forEach(key => {
            delete newTerrain[key];
          });
        }
        
        // Restore removed blocks
        if (currentUndo.terrain.removed) {
          const removedEntries = Object.entries(currentUndo.terrain.removed);
          console.log(`Restoring ${removedEntries.length} removed blocks`);
          removedEntries.forEach(([key, value]) => {
            newTerrain[key] = value;
          });
        }
      }

      if (currentUndo.environment) {
        // Remove any objects that were originally "added" — with ±0.001
        const originalEnvCount = newEnvironment.length;
        if (currentUndo.environment.added && currentUndo.environment.added.length > 0) {
          console.log(`Removing ${currentUndo.environment.added.length} added environment objects`);
          newEnvironment = newEnvironment.filter(obj =>
            !(currentUndo.environment.added || []).some(added =>
              added.modelUrl === obj.modelUrl &&
              Math.abs(added.position.x - obj.position.x) < 0.001 &&
              Math.abs(added.position.y - obj.position.y) < 0.001 &&
              Math.abs(added.position.z - obj.position.z) < 0.001
            )
          );
          console.log(`Environment objects went from ${originalEnvCount} to ${newEnvironment.length}`);
        }
        
        // Restore removed objects
        if (Array.isArray(currentUndo.environment.removed) && currentUndo.environment.removed.length > 0) {
          console.log(`Restoring ${currentUndo.environment.removed.length} removed environment objects`);
          newEnvironment.push(...currentUndo.environment.removed);
        }
      }

      // Prepare redo state
      const redoChanges = {
        terrain: currentUndo.terrain
          ? {
              added: currentUndo.terrain.added,
              removed: currentUndo.terrain.removed
            }
          : null,
        environment: currentUndo.environment
          ? {
              added: currentUndo.environment.added,
              removed: currentUndo.environment.removed
            }
          : null
      };
      
      console.log(`Updated terrain has ${Object.keys(newTerrain).length} blocks`);
      console.log("Saving updated state to database...");

      // Save updated state, update undo/redo
      try {
        await Promise.all([
          DatabaseManager.saveData(STORES.TERRAIN, 'current', newTerrain),
          DatabaseManager.saveData(STORES.ENVIRONMENT, 'current', newEnvironment),
          DatabaseManager.saveData(STORES.UNDO, 'states', remainingUndo),
          DatabaseManager.saveData(STORES.REDO, 'states', [redoChanges, ...redoStates])
        ]);
        console.log("Database updated successfully");
      } catch (dbError) {
        console.error("Error while updating database during undo:", dbError);
        throw dbError;
      }

      console.log("Undo operation completed successfully");
      return currentUndo;
    } catch (error) {
      console.error('Error during undo:', error);
      return null;
    }
  };

  const redo = async () => {
    try {
      const redoStates = await DatabaseManager.getData(STORES.REDO, 'states') || [];
      if (redoStates.length === 0) {
        return null;
      }

      const [currentRedo, ...remainingRedo] = redoStates;
      const undoStates = await DatabaseManager.getData(STORES.UNDO, 'states') || [];

      // Get current terrain and environment
      const currentTerrain = await DatabaseManager.getData(STORES.TERRAIN, 'current') || {};
      const currentEnv = await DatabaseManager.getData(STORES.ENVIRONMENT, 'current') || [];

      // Apply redo changes
      let newTerrain = { ...currentTerrain };
      let newEnvironment = [...currentEnv];

      if (currentRedo.terrain) {
        // Re-add blocks that were originally added
        Object.entries(currentRedo.terrain.added || {}).forEach(([key, value]) => {
          newTerrain[key] = value;
        });
        // Remove blocks that were originally removed
        Object.keys(currentRedo.terrain.removed || {}).forEach(key => {
          delete newTerrain[key];
        });
      }

      if (currentRedo.environment) {

        // Remove any objects that were originally removed — with ±0.001
        if (currentRedo.environment.removed?.length > 0) {
          newEnvironment = newEnvironment.filter(obj =>
            !currentRedo.environment.removed.some(removedObj =>
              removedObj.modelUrl === obj.modelUrl &&
              Math.abs(removedObj.position.x - obj.position.x) < 0.001 &&
              Math.abs(removedObj.position.y - obj.position.y) < 0.001 &&
              Math.abs(removedObj.position.z - obj.position.z) < 0.001
            )
          );
        }

        // Then add objects that were originally added
        if (currentRedo.environment.added?.length > 0) {
          newEnvironment = [...newEnvironment, ...currentRedo.environment.added];
        }
      }

      // Prepare undo state for the re-applied changes
      const undoChanges = {
        terrain: currentRedo.terrain
          ? {
              added: currentRedo.terrain.removed,
              removed: currentRedo.terrain.added
            }
          : null,
        environment: currentRedo.environment
          ? {
              added: currentRedo.environment.removed,
              removed: currentRedo.environment.added
            }
          : null
      };

      await Promise.all([
        DatabaseManager.saveData(STORES.TERRAIN, 'current', newTerrain),
        DatabaseManager.saveData(STORES.ENVIRONMENT, 'current', newEnvironment),
        DatabaseManager.saveData(STORES.REDO, 'states', remainingRedo),
        DatabaseManager.saveData(STORES.UNDO, 'states', [undoChanges, ...undoStates])
      ]);

      return currentRedo;
    } catch (error) {
      console.error('Error during redo:', error);
      return null;
    }
  };

  const handleUndo = async () => {
    try {
      console.log("=== UNDO OPERATION STARTED ===");
      // Previous check was too restrictive - simplify it
      const undoneChanges = await undo();
      
      if (undoneChanges) {
        console.log("Undo operation successful, selectively updating terrain...");
        
        // Get current terrain from database
        const currentTerrain = await DatabaseManager.getData(STORES.TERRAIN, 'current') || {};
        console.log(`Current terrain has ${Object.keys(currentTerrain).length} blocks`);
        
        // Process terrain changes
        if (undoneChanges.terrain && terrainBuilderRef?.current) {
          const addedBlocks = {};
          const removedBlocks = {};
          
          // Removed blocks (were added in the original operation)
          if (undoneChanges.terrain.added) {
            Object.keys(undoneChanges.terrain.added).forEach(posKey => {
              removedBlocks[posKey] = undoneChanges.terrain.added[posKey];
            });
          }
          
          // Added blocks (were removed in the original operation)
          if (undoneChanges.terrain.removed) {
            Object.entries(undoneChanges.terrain.removed).forEach(([posKey, blockId]) => {
              addedBlocks[posKey] = blockId;
            });
          }
          
          console.log(`Selectively updating terrain: ${Object.keys(addedBlocks).length} additions, ${Object.keys(removedBlocks).length} removals`);
          
          // Update terrain directly using optimized function for undo/redo
          if (terrainBuilderRef.current.updateTerrainForUndoRedo) {
            terrainBuilderRef.current.updateTerrainForUndoRedo(addedBlocks, removedBlocks, "undo");
            console.log("Terrain updated successfully with optimized method");
          } else if (terrainBuilderRef.current.updateTerrainBlocks) {
            terrainBuilderRef.current.updateTerrainBlocks(addedBlocks, removedBlocks);
            console.log("Terrain updated successfully with standard method");
          } else {
            console.warn("No update terrain function available, falling back to refreshTerrainFromDB");
            await terrainBuilderRef.current.refreshTerrainFromDB();
          }
        } else {
          console.log("No terrain changes to apply or terrain builder not available");
        }
        
        // Environment changes still use refreshFromDB
        if (environmentBuilderRef?.current?.refreshEnvironmentFromDB) {
          console.log("Refreshing environment from DB...");
          try {
            await environmentBuilderRef.current.refreshEnvironmentFromDB();
            console.log("Environment refreshed successfully");
          } catch (refreshError) {
            console.error("Error refreshing environment:", refreshError);
          }
        } else {
          console.warn("Unable to refresh environment - refreshEnvironmentFromDB not available");
        }
        
        console.log("=== UNDO OPERATION COMPLETED ===");
      } else {
        console.log("Undo operation did not return any changes");
      }
    } catch (error) {
      console.error("=== UNDO OPERATION FAILED ===");
      console.error("Error during undo operation:", error);
    }
  };

  const handleRedo = async () => {
    try {
      console.log("=== REDO OPERATION STARTED ===");
      // Previous check was too restrictive - simplify it
      const redoneChanges = await redo();
      
      if (redoneChanges) {
        console.log("Redo operation successful, selectively updating terrain...");
        
        // Get current terrain from database
        const currentTerrain = await DatabaseManager.getData(STORES.TERRAIN, 'current') || {};
        console.log(`Current terrain has ${Object.keys(currentTerrain).length} blocks`);
        
        // Process terrain changes
        if (redoneChanges.terrain && terrainBuilderRef?.current) {
          const addedBlocks = {};
          const removedBlocks = {};
          
          // Re-add blocks that were originally added
          if (redoneChanges.terrain.added) {
            Object.entries(redoneChanges.terrain.added).forEach(([posKey, blockId]) => {
              addedBlocks[posKey] = blockId;
            });
          }
          
          // Remove blocks that were originally removed
          if (redoneChanges.terrain.removed) {
            Object.entries(redoneChanges.terrain.removed).forEach(([posKey, blockId]) => {
              removedBlocks[posKey] = blockId;
            });
          }
          
          console.log(`Selectively updating terrain: ${Object.keys(addedBlocks).length} additions, ${Object.keys(removedBlocks).length} removals`);
          
          // Update terrain directly using optimized function for undo/redo
          if (terrainBuilderRef.current.updateTerrainForUndoRedo) {
            terrainBuilderRef.current.updateTerrainForUndoRedo(addedBlocks, removedBlocks, "redo");
            console.log("Terrain updated successfully with optimized method");
          } else if (terrainBuilderRef.current.updateTerrainBlocks) {
            terrainBuilderRef.current.updateTerrainBlocks(addedBlocks, removedBlocks);
            console.log("Terrain updated successfully with standard method");
          } else {
            console.warn("No update terrain function available, falling back to refreshTerrainFromDB");
            await terrainBuilderRef.current.refreshTerrainFromDB();
          }
        } else {
          console.log("No terrain changes to apply or terrain builder not available");
        }
        
        // Environment changes still use refreshFromDB
        if (environmentBuilderRef?.current?.refreshEnvironmentFromDB) {
          console.log("Refreshing environment from DB...");
          try {
            await environmentBuilderRef.current.refreshEnvironmentFromDB();
            console.log("Environment refreshed successfully");
          } catch (refreshError) {
            console.error("Error refreshing environment:", refreshError);
          }
        }
        
        console.log("=== REDO OPERATION COMPLETED ===");
      } else {
        console.log("Redo operation did not return any changes");
      }
    } catch (error) {
      console.error("=== REDO OPERATION FAILED ===");
      console.error("Error during redo operation:", error);
    }
  };

  const saveUndo = async (changes) => {
    try {
      console.log("=== SAVING UNDO STATE ===");
      console.log("Changes to save:", changes);
      
      // Validation check - only save if there are actual changes
      const hasTerrain = changes.terrain && 
        (Object.keys(changes.terrain.added || {}).length > 0 || 
         Object.keys(changes.terrain.removed || {}).length > 0);
      
      const hasEnvironment = changes.environment && 
        (changes.environment.added?.length > 0 || 
         changes.environment.removed?.length > 0);
      
      if (!hasTerrain && !hasEnvironment) {
        console.warn("No actual changes to save in undo state, skipping");
        return;
      }
      
      // Get existing undo states
      const undoStates = await DatabaseManager.getData(STORES.UNDO, 'states') || [];
      console.log(`Found ${undoStates.length} existing undo states`);

      // Add new changes to undo stack (front)
      const newUndoStates = [changes, ...undoStates];
      console.log(`New undo stack will have ${newUndoStates.length} states`);

      // If we exceed threshold, commit older states
      if (newUndoStates.length > UNDO_THRESHOLD) {
        console.log(`Undo states exceed threshold (${UNDO_THRESHOLD}), committing older states...`);
        await commitOldStates(newUndoStates);
      } else {
        // Otherwise just save the new state
        console.log(`Saving new undo state and clearing redo stack...`);
        try {
          await Promise.all([
            DatabaseManager.saveData(STORES.UNDO, 'states', newUndoStates),
            DatabaseManager.saveData(STORES.REDO, 'states', [])
          ]);
          console.log(`Undo state saved successfully`);
        } catch (saveError) {
          console.error("Error saving undo state to database:", saveError);
          throw saveError;
        }
      }
      console.log("=== UNDO STATE SAVED ===");
    } catch (error) {
      console.error('Error saving undo state:', error);
    }
  };

  // Keyboard shortcuts for Ctrl+Z / Ctrl+Y
  React.useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.ctrlKey || event.metaKey) {
        if (event.key === 'z') {
          event.preventDefault();
          if (event.shiftKey) {
            handleRedo();
          } else {
            handleUndo();
          }
        } else if (event.key === 'y') {
          event.preventDefault();
          handleRedo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <>
      {children}
    </>
  );
}

export default React.forwardRef(UndoRedoManager);
