import React, { useImperativeHandle } from 'react';
import { DatabaseManager, STORES } from './DatabaseManager';
import { MIN_UNDO_STATES, UNDO_THRESHOLD } from './Constants';

function UndoRedoManager({ terrainBuilderRef, environmentBuilderRef, children }, ref) {
  // Check database initialization on component mount
  React.useEffect(() => {
    const checkDatabase = async () => {
      try {
        console.log("UndoRedoManager: Checking database initialization...");
        const db = await DatabaseManager.getDBConnection();
        if (!db) {
          console.error("UndoRedoManager: Database not initialized!");
          return;
        }
        
        // Check if undo states store exists
        const undoStates = await DatabaseManager.getData(STORES.UNDO, 'states') || [];
        console.log(`UndoRedoManager: Database is initialized. Found ${undoStates.length} existing undo states`);
        
        // Initialize empty undo states array if not exists
        if (!undoStates) {
          console.log("UndoRedoManager: Creating empty undo states array");
          await DatabaseManager.saveData(STORES.UNDO, 'states', []);
        }
      } catch (error) {
        console.error("UndoRedoManager: Error checking database:", error);
      }
    };
    
    checkDatabase();
  }, []);

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
      
      // For terrain, we'll update the selective changes in handleUndo to improve performance
      
      // For environment, we still need to load and update it fully
      let newEnvironment = [];
      
      if (currentUndo.environment) {
        const currentEnv = await DatabaseManager.getData(STORES.ENVIRONMENT, 'current') || [];
        newEnvironment = [...currentEnv];
        
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

      console.log("Saving updated state to database...");

      // Save updated state, update undo/redo
      try {
        await Promise.all([
          // For terrain, we'll handle individual block updates directly in handleUndo
          // to avoid loading the entire terrain data
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

      // For environment, we still need to load and update it fully
      let newEnvironment = [];
      
      if (currentRedo.environment) {
        const currentEnv = await DatabaseManager.getData(STORES.ENVIRONMENT, 'current') || [];
        newEnvironment = [...currentEnv];

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
        // We'll handle terrain updates in handleRedo
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
        
        // Process terrain changes
        if (undoneChanges.terrain && terrainBuilderRef?.current) {
          const addedBlocks = {};
          const removedBlocks = {};
          
          // Removed blocks (were added in the original operation)
          if (undoneChanges.terrain.added) {
            Object.keys(undoneChanges.terrain.added).forEach(posKey => {
              removedBlocks[posKey] = undoneChanges.terrain.added[posKey];
            });
            
            console.log(`Will remove ${Object.keys(removedBlocks).length} blocks from the terrain`);
            
            // Update database directly for removed blocks (batch delete)
            if (Object.keys(removedBlocks).length > 0) {
              try {
                // Get a transaction and update the database directly
                const db = await DatabaseManager.getDBConnection();
                const tx = db.transaction(STORES.TERRAIN, 'readwrite');
                const store = tx.objectStore(STORES.TERRAIN);
                
                // Delete keys from storage
                await Promise.all(Object.keys(removedBlocks).map(key => {
                  const deleteRequest = store.delete(`${key}`);
                  return new Promise((resolve, reject) => {
                    deleteRequest.onsuccess = resolve;
                    deleteRequest.onerror = reject;
                  });
                }));
                
                // Complete the transaction
                await new Promise((resolve, reject) => {
                  tx.oncomplete = resolve;
                  tx.onerror = reject;
                });
                
                console.log(`Successfully deleted ${Object.keys(removedBlocks).length} blocks directly from DB`);
              } catch (dbError) {
                console.error("Error updating database during block removal:", dbError);
                alert(`Error during undo operation: Failed to update database for block removal. Details: ${dbError.message}`);
                return;
              }
            }
          }
          
          // Added blocks (were removed in the original operation)
          if (undoneChanges.terrain.removed) {
            Object.entries(undoneChanges.terrain.removed).forEach(([posKey, blockId]) => {
              addedBlocks[posKey] = blockId;
            });
            
            console.log(`Will add back ${Object.keys(addedBlocks).length} blocks to the terrain`);
            
            // Update database directly for added blocks (batch put)
            if (Object.keys(addedBlocks).length > 0) {
              try {
                // Get a transaction and update the database directly
                const db = await DatabaseManager.getDBConnection();
                const tx = db.transaction(STORES.TERRAIN, 'readwrite');
                const store = tx.objectStore(STORES.TERRAIN);
                
                // Add blocks to storage
                await Promise.all(Object.entries(addedBlocks).map(([key, value]) => {
                  const putRequest = store.put(value, key);
                  return new Promise((resolve, reject) => {
                    putRequest.onsuccess = resolve;
                    putRequest.onerror = reject;
                  });
                }));
                
                // Complete the transaction
                await new Promise((resolve, reject) => {
                  tx.oncomplete = resolve;
                  tx.onerror = reject;
                });
                
                console.log(`Successfully added ${Object.keys(addedBlocks).length} blocks directly to DB`);
              } catch (dbError) {
                console.error("Error updating database during block addition:", dbError);
                alert(`Error during undo operation: Failed to update database for block addition. Details: ${dbError.message}`);
                return;
              }
            }
          }
          
          console.log(`Selectively updating terrain: ${Object.keys(addedBlocks).length} additions, ${Object.keys(removedBlocks).length} removals`);
          
          // Update terrain directly using optimized function for undo/redo
          try {
            if (terrainBuilderRef.current.updateTerrainForUndoRedo) {
              terrainBuilderRef.current.updateTerrainForUndoRedo(addedBlocks, removedBlocks, "undo");
              console.log("Terrain updated successfully with optimized method");
              
              // Verify that the terrain update worked properly
              const addedBlocksCount = Object.keys(addedBlocks).length;
              const removedBlocksCount = Object.keys(removedBlocks).length;
              
              if (addedBlocksCount > 0 || removedBlocksCount > 0) {
                console.log("Forcing immediate visibility update to ensure changes are visible");
                if (terrainBuilderRef.current.updateVisibleChunks) {
                  terrainBuilderRef.current.updateVisibleChunks();
                }
              }
            } else if (terrainBuilderRef.current.updateTerrainBlocks) {
              terrainBuilderRef.current.updateTerrainBlocks(addedBlocks, removedBlocks);
              console.log("Terrain updated successfully with standard method");
            } else {
              console.warn("No update terrain function available, falling back to refreshTerrainFromDB");
              await terrainBuilderRef.current.refreshTerrainFromDB();
            }
          } catch (updateError) {
            console.error("Error updating terrain:", updateError);
            alert(`Error during undo operation: Failed to update terrain visualization. Details: ${updateError.message}`);
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
            alert(`Error during undo operation: Failed to refresh environment. Details: ${refreshError.message}`);
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
      alert(`Undo operation failed: ${error.message}`);
      
      // Try to recover
      try {
        if (terrainBuilderRef?.current?.refreshTerrainFromDB) {
          console.log("Attempting to recover by refreshing terrain from DB");
          await terrainBuilderRef.current.refreshTerrainFromDB();
        }
      } catch (recoveryError) {
        console.error("Recovery attempt failed:", recoveryError);
      }
    }
  };

  const handleRedo = async () => {
    try {
      console.log("=== REDO OPERATION STARTED ===");
      // Previous check was too restrictive - simplify it
      const redoneChanges = await redo();
      
      if (redoneChanges) {
        console.log("Redo operation successful, selectively updating terrain...");
        
        // Process terrain changes
        if (redoneChanges.terrain && terrainBuilderRef?.current) {
          const addedBlocks = {};
          const removedBlocks = {};
          
          // Re-add blocks that were originally added
          if (redoneChanges.terrain.added) {
            Object.entries(redoneChanges.terrain.added).forEach(([posKey, blockId]) => {
              addedBlocks[posKey] = blockId;
            });
            
            console.log(`Will add ${Object.keys(addedBlocks).length} blocks to the terrain`);
            
            // Update database directly for added blocks (batch put)
            if (Object.keys(addedBlocks).length > 0) {
              try {
                // Get a transaction and update the database directly
                const db = await DatabaseManager.getDBConnection();
                const tx = db.transaction(STORES.TERRAIN, 'readwrite');
                const store = tx.objectStore(STORES.TERRAIN);
                
                // Add blocks to storage
                await Promise.all(Object.entries(addedBlocks).map(([key, value]) => {
                  const putRequest = store.put(value, key);
                  return new Promise((resolve, reject) => {
                    putRequest.onsuccess = resolve;
                    putRequest.onerror = reject;
                  });
                }));
                
                // Complete the transaction
                await new Promise((resolve, reject) => {
                  tx.oncomplete = resolve;
                  tx.onerror = reject;
                });
                
                console.log(`Successfully added ${Object.keys(addedBlocks).length} blocks directly to DB`);
              } catch (dbError) {
                console.error("Error updating database during block addition:", dbError);
                alert(`Error during redo operation: Failed to update database for block addition. Details: ${dbError.message}`);
                return;
              }
            }
          }
          
          // Re-remove blocks that were originally removed
          if (redoneChanges.terrain.removed) {
            Object.keys(redoneChanges.terrain.removed).forEach(posKey => {
              removedBlocks[posKey] = redoneChanges.terrain.removed[posKey];
            });
            
            console.log(`Will remove ${Object.keys(removedBlocks).length} blocks from the terrain`);
            
            // Update database directly for removed blocks (batch delete)
            if (Object.keys(removedBlocks).length > 0) {
              try {
                // Get a transaction and update the database directly
                const db = await DatabaseManager.getDBConnection();
                const tx = db.transaction(STORES.TERRAIN, 'readwrite');
                const store = tx.objectStore(STORES.TERRAIN);
                
                // Delete keys from storage
                await Promise.all(Object.keys(removedBlocks).map(key => {
                  const deleteRequest = store.delete(`${key}`);
                  return new Promise((resolve, reject) => {
                    deleteRequest.onsuccess = resolve;
                    deleteRequest.onerror = reject;
                  });
                }));
                
                // Complete the transaction
                await new Promise((resolve, reject) => {
                  tx.oncomplete = resolve;
                  tx.onerror = reject;
                });
                
                console.log(`Successfully deleted ${Object.keys(removedBlocks).length} blocks directly from DB`);
              } catch (dbError) {
                console.error("Error updating database during block removal:", dbError);
                alert(`Error during redo operation: Failed to update database for block removal. Details: ${dbError.message}`);
                return;
              }
            }
          }
          
          console.log(`Selectively updating terrain: ${Object.keys(addedBlocks).length} additions, ${Object.keys(removedBlocks).length} removals`);
          
          // Update terrain directly using optimized function for undo/redo
          try {
            if (terrainBuilderRef.current.updateTerrainForUndoRedo) {
              terrainBuilderRef.current.updateTerrainForUndoRedo(addedBlocks, removedBlocks, "redo");
              console.log("Terrain updated successfully with optimized method");
              
              // Verify that the terrain update worked properly
              const addedBlocksCount = Object.keys(addedBlocks).length;
              const removedBlocksCount = Object.keys(removedBlocks).length;
              
              if (addedBlocksCount > 0 || removedBlocksCount > 0) {
                console.log("Forcing immediate visibility update to ensure changes are visible");
                if (terrainBuilderRef.current.updateVisibleChunks) {
                  terrainBuilderRef.current.updateVisibleChunks();
                }
              }
            } else if (terrainBuilderRef.current.updateTerrainBlocks) {
              terrainBuilderRef.current.updateTerrainBlocks(addedBlocks, removedBlocks);
              console.log("Terrain updated successfully with standard method");
            } else {
              console.warn("No update terrain function available, falling back to refreshTerrainFromDB");
              await terrainBuilderRef.current.refreshTerrainFromDB();
            }
          } catch (updateError) {
            console.error("Error updating terrain:", updateError);
            alert(`Error during redo operation: Failed to update terrain visualization. Details: ${updateError.message}`);
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
            alert(`Error during redo operation: Failed to refresh environment. Details: ${refreshError.message}`);
          }
        }
        
        console.log("=== REDO OPERATION COMPLETED ===");
      } else {
        console.log("Redo operation did not return any changes");
      }
    } catch (error) {
      console.error("=== REDO OPERATION FAILED ===");
      console.error("Error during redo operation:", error);
      alert(`Redo operation failed: ${error.message}`);
      
      // Try to recover
      try {
        if (terrainBuilderRef?.current?.refreshTerrainFromDB) {
          console.log("Attempting to recover by refreshing terrain from DB");
          await terrainBuilderRef.current.refreshTerrainFromDB();
        }
      } catch (recoveryError) {
        console.error("Recovery attempt failed:", recoveryError);
      }
    }
  };

  const saveUndo = async (changes) => {
    try {
      console.log("=== SAVING UNDO STATE ===");
      console.log("Changes to save:", JSON.stringify(changes, null, 2));
      
      // Log where the saveUndo call is coming from
      console.log("Call stack:", new Error().stack);
      
      // Validation check - only save if there are actual changes
      const hasTerrain = changes.terrain && 
        (Object.keys(changes.terrain.added || {}).length > 0 || 
         Object.keys(changes.terrain.removed || {}).length > 0);
      
      const hasEnvironment = changes.environment && 
        (changes.environment.added?.length > 0 || 
         changes.environment.removed?.length > 0);
      
      console.log("Has terrain changes:", hasTerrain, 
                 "Added blocks:", changes.terrain ? Object.keys(changes.terrain.added || {}).length : 0,
                 "Removed blocks:", changes.terrain ? Object.keys(changes.terrain.removed || {}).length : 0);
      console.log("Has environment changes:", hasEnvironment);
      
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
          console.log(`Undo state saved successfully. New stack length: ${newUndoStates.length}`);
          
          // Double-check that states were actually saved
          const verifyStates = await DatabaseManager.getData(STORES.UNDO, 'states') || [];
          console.log(`Verified undo states after save: ${verifyStates.length}`);
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
