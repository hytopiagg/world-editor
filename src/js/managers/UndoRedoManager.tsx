import React, {
    useImperativeHandle
} from "react";
import { DatabaseManager, STORES } from "./DatabaseManager";
import { UndoRedoState } from "../types/DatabaseTypes";
function UndoRedoManager(
    { terrainBuilderRef, environmentBuilderRef },
    ref: any
) {

    const [isInitialized, setIsInitialized] = React.useState(false);

    React.useEffect(() => {
        const checkDatabase = async () => {
            try {
                console.log(
                    "UndoRedoManager: Checking database initialization..."
                );
                const db = await DatabaseManager.getDBConnection();
                if (!db) {
                    console.error("UndoRedoManager: Database not initialized!");
                    return;
                }

                const undoStates =
                    (await DatabaseManager.getData(STORES.UNDO, "states")) ||
                    [];

                if (!undoStates) {
                    console.log(
                        "UndoRedoManager: Creating empty undo states array"
                    );
                    await DatabaseManager.saveData(STORES.UNDO, "states", []);
                }

                setIsInitialized(true);
            } catch (error) {
                console.error(
                    "UndoRedoManager: Error checking database:",
                    error
                );
            }
        };
        checkDatabase();
    }, []);
    useImperativeHandle(
        ref,
        () => ({
            saveUndo: async (changes) => {
                if (!isInitialized) {
                    console.warn(
                        "UndoRedoManager: Not initialized yet, ignoring saveUndo call"
                    );
                    return;
                }
                return saveUndo(changes);
            },
            undo: async () => {
                if (!isInitialized) {
                    console.warn(
                        "UndoRedoManager: Not initialized yet, ignoring undo call"
                    );
                    return;
                }
                return undo();
            },
            redo: async () => {
                if (!isInitialized) {
                    console.warn(
                        "UndoRedoManager: Not initialized yet, ignoring redo call"
                    );
                    return;
                }
                return redo();
            },
            handleUndo: async () => {
                if (!isInitialized) {
                    console.warn(
                        "UndoRedoManager: Not initialized yet, ignoring handleUndo call"
                    );
                    return;
                }
                return handleUndo();
            },
            handleRedo: async () => {
                if (!isInitialized) {
                    console.warn(
                        "UndoRedoManager: Not initialized yet, ignoring handleRedo call"
                    );
                    return;
                }
                return handleRedo();
            },
        }),
        [isInitialized]
    );
    const applyStates = async (states, initialTerrain, initialEnvironment) => {
        let newTerrain = { ...initialTerrain };
        let newEnvironment = [...initialEnvironment];
        for (const state of states) {

            if (state.terrain) {

                Object.keys(state.terrain.removed || {}).forEach((key) => {
                    delete newTerrain[key];
                });

                Object.entries(state.terrain.added || {}).forEach(
                    ([key, value]) => {
                        newTerrain[key] = value;
                    }
                );
            }

            if (state.environment?.added || state.environment?.removed) {

                newEnvironment = newEnvironment.filter(
                    (obj) =>
                        !(state.environment.removed || []).some(
                            (removed) =>
                                removed.modelUrl === obj.modelUrl &&
                                Math.abs(removed.position.x - obj.position.x) <
                                0.001 &&
                                Math.abs(removed.position.y - obj.position.y) <
                                0.001 &&
                                Math.abs(removed.position.z - obj.position.z) <
                                0.001
                        )
                );

                if (Array.isArray(state.environment.added)) {
                    newEnvironment.push(...state.environment.added);
                }
            }
        }
        return { newTerrain, newEnvironment };
    };

    const undo = async () => {
        try {
            const undoStates =
                (await DatabaseManager.getData(STORES.UNDO, "states")) as {
                    terrain: {
                        added: any[];
                        removed: any[];
                    };
                    environment: {
                        added: any[];
                        removed: any[];
                    };
                }[] || [];
            if (undoStates.length === 0) {
                return null;
            }
            const [currentUndo, ...remainingUndo] = undoStates;
            const redoStates =
                (await DatabaseManager.getData(STORES.REDO, "states")) as UndoRedoState[] || [];

            const redoChanges = {
                terrain: currentUndo.terrain
                    ? {
                        added: currentUndo.terrain.removed,
                        removed: currentUndo.terrain.added,
                    }
                    : null,
                environment: currentUndo.environment
                    ? {
                        added: currentUndo.environment.removed,
                        removed: currentUndo.environment.added,
                    }
                    : null,
            };

            console.log("Saving updated state to database...");

            try {
                await Promise.all([
                    DatabaseManager.saveData(
                        STORES.UNDO,
                        "states",
                        remainingUndo
                    ),
                    DatabaseManager.saveData(STORES.REDO, "states", [
                        redoChanges,
                        ...redoStates,
                    ]),
                ]);
                console.log("Database updated successfully");
            } catch (dbError) {
                console.error(
                    "Error while updating database during undo:",
                    dbError
                );
                throw dbError;
            }
            console.log("Undo operation completed successfully");
            return currentUndo;
        } catch (error) {
            console.error("Error during undo:", error);
            return null;
        }
    };
    const redo = async () => {
        try {
            const redoStates =
                (await DatabaseManager.getData(STORES.REDO, "states")) as UndoRedoState[] || [];
            if (redoStates.length === 0) {
                return null;
            }
            const [currentRedo, ...remainingRedo] = redoStates;
            const undoStates =
                (await DatabaseManager.getData(STORES.UNDO, "states")) as UndoRedoState[] || [];

            const undoChanges = {
                terrain: currentRedo.terrain
                    ? {
                        added: currentRedo.terrain.removed,
                        removed: currentRedo.terrain.added,
                    }
                    : null,
                environment: currentRedo.environment
                    ? {
                        added: currentRedo.environment.removed,
                        removed: currentRedo.environment.added,
                    }
                    : null,
            };
            await Promise.all([
                DatabaseManager.saveData(STORES.REDO, "states", remainingRedo),
                DatabaseManager.saveData(STORES.UNDO, "states", [
                    undoChanges,
                    ...undoStates,
                ]),
            ]);
            return currentRedo;
        } catch (error) {
            console.error("Error during redo:", error);
            return null;
        }
    };
    // Helper function to process terrain changes during undo
    const processTerrainUndo = async (changeData) => {
        const added = {};
        const removed = {};

        if (changeData.added) {
            console.log("terrain changeData.added", changeData.added);
            Object.keys(changeData.added).forEach(
                (key) => {
                    removed[key] = changeData.added[key];
                }
            );
            console.log(
                `Will remove ${Object.keys(removed).length} blocks from terrain`
            );

            if (Object.keys(removed).length > 0) {
                try {
                    const db = await DatabaseManager.getDBConnection();
                    const tx = db.transaction(changeData.store, "readwrite");
                    const store = tx.objectStore(changeData.store);
                    await Promise.all(
                        Object.keys(removed).map((key) => {
                            console.log("deleting", key);
                            const deleteRequest = store.delete(`${key}`);
                            return new Promise((resolve, reject) => {
                                deleteRequest.onsuccess = resolve;
                                deleteRequest.onerror = reject;
                            });
                        })
                    );

                    await new Promise((resolve, reject) => {
                        tx.oncomplete = resolve;
                        tx.onerror = reject;
                    });
                    console.log(
                        `Successfully deleted ${Object.keys(removed).length} blocks directly from DB`
                    );
                } catch (dbError) {
                    console.error("Error updating database during block removal:", dbError);
                    alert(
                        `Error during undo operation: Failed to update database for block removal. Details: ${dbError.message}`
                    );
                    return;
                }
            }
        }

        if (changeData.removed) {
            console.log("terrain changeData.removed", changeData.removed);
            Object.entries(changeData.removed).forEach(([key, value]) => {
                added[key] = value;
            });
            console.log(
                `Will add back ${Object.keys(added).length} blocks to terrain`
            );

            if (Object.keys(added).length > 0) {
                try {
                    const db = await DatabaseManager.getDBConnection();
                    const tx = db.transaction(changeData.store, "readwrite");
                    const store = tx.objectStore(changeData.store);

                    await Promise.all(
                        Object.entries(added).map(([key, value]) => {
                            console.log("adding", key, value);
                            const putRequest = store.put(value, key);
                            return new Promise((resolve, reject) => {
                                putRequest.onsuccess = resolve;
                                putRequest.onerror = reject;
                            });
                        })
                    );

                    await new Promise((resolve, reject) => {
                        tx.oncomplete = resolve;
                        tx.onerror = reject;
                    });
                    console.log(
                        `Successfully added ${Object.keys(added).length} blocks directly to DB`
                    );
                } catch (dbError) {
                    console.error("Error updating database during block addition:", dbError);
                    alert(
                        `Error during undo operation: Failed to update database for block addition. Details: ${dbError.message}`
                    );
                    return;
                }
            }
        }

        // Update terrain builder
        try {
            if (terrainBuilderRef.current.updateTerrainBlocks) {
                terrainBuilderRef.current.updateTerrainBlocks(
                    added,
                    removed,
                    { syncPendingChanges: true, skipUndoSave: true }
                );
                console.log(
                    "Terrain updated successfully with standard method, and pending changes are synced."
                );

                const addedBlocksCount = Object.keys(added).length;
                const removedBlocksCount = Object.keys(removed).length;
                if (addedBlocksCount > 0 || removedBlocksCount > 0) {
                    console.log(
                        "Forcing immediate visibility update to ensure changes are visible"
                    );
                    if (terrainBuilderRef.current.forceRefreshAllChunks) {
                        terrainBuilderRef.current.forceRefreshAllChunks();
                    }
                }
            } else {
                console.warn(
                    "No update terrain function available, falling back to refreshTerrainFromDB"
                );
                await terrainBuilderRef.current.refreshTerrainFromDB();
            }
        } catch (updateError) {
            console.error("Error updating terrain:", updateError);
            alert(
                `Error during undo operation: Failed to update terrain visualization. Details: ${updateError.message}`
            );
            await terrainBuilderRef.current.refreshTerrainFromDB();
        }
    };

    // Helper function to process environment changes during undo
    const processEnvironmentUndo = async (changeData) => {
        const added = changeData.removed || []; // What was removed needs to be added back
        const removed = changeData.added || []; // What was added needs to be removed

        console.log("environment added (restore):", added);
        console.log("environment removed (undo):", removed);
        console.log("undo changeData.added:", changeData.added);
        console.log("undo changeData.removed:", changeData.removed);

        try {
            if (environmentBuilderRef?.current?.updateEnvironmentForUndoRedo) {
                console.log("Updating environment for undo redo");
                environmentBuilderRef.current.updateEnvironmentForUndoRedo(added, removed, "undo");
            } else {
                console.warn(
                    "No update environment function available, falling back to refreshEnvironmentFromDB"
                );
            }

            // Sync environment changes to TerrainBuilder's pendingChangesRef
            if (terrainBuilderRef?.current?.syncEnvironmentChangesToPending) {
                console.log("Syncing environment changes to TerrainBuilder pending ref for undo");
                console.log("Calling syncEnvironmentChangesToPending with added:", added, "removed:", removed);
                terrainBuilderRef.current.syncEnvironmentChangesToPending(added, removed);
            } else {
                console.warn("syncEnvironmentChangesToPending not available on terrainBuilderRef");
            }

            if (environmentBuilderRef?.current?.refreshEnvironment) {
                console.log("Refreshing environment from DB...");
                try {
                    await environmentBuilderRef.current.refreshEnvironment();
                    console.log("Environment refreshed successfully");
                } catch (refreshError) {
                    console.error("Error refreshing environment:", refreshError);
                    alert(
                        `Error during undo operation: Failed to refresh environment. Details: ${refreshError.message}`
                    );
                }
            } else {
                console.warn(
                    "Unable to refresh environment - refreshEnvironmentFromDB not available"
                );
            }
        } catch (updateError) {
            console.error("Error updating environment:", updateError);
            alert(
                `Error during undo operation: Failed to update environment visualization. Details: ${updateError.message}`
            );
            await environmentBuilderRef.current.refreshEnvironment();
        }
    };

    const handleUndo = async () => {
        try {
            console.log("=== UNDO OPERATION STARTED ===");

            const undoneChanges = await undo();
            console.log("[UndoRedoManager] undoneChanges:", undoneChanges);
            if (undoneChanges) {
                console.log(
                    "[UndoRedoManager] Undo operation successful, selectively updating..."
                );

                console.log("[UndoRedoManager] undoneChanges details:", undoneChanges);

                const isTerrainChange = undoneChanges.terrain && (Object.keys(undoneChanges.terrain.added || {}).length > 0 || Object.keys(undoneChanges.terrain.removed || {}).length > 0);
                const isEnvironmentChange = undoneChanges.environment && ((undoneChanges.environment.added || []).length > 0 || (undoneChanges.environment.removed || []).length > 0);

                console.log("[UndoRedoManager] isTerrainChange:", isTerrainChange);
                console.log("[UndoRedoManager] isEnvironmentChange:", isEnvironmentChange);
                if (undoneChanges.environment) {
                    console.log("[UndoRedoManager] environment.added length:", (undoneChanges.environment.added || []).length);
                    console.log("[UndoRedoManager] environment.removed length:", (undoneChanges.environment.removed || []).length);
                }

                // Process terrain changes if they exist
                if (isTerrainChange) {
                    console.log("[UndoRedoManager] Processing terrain changes for undo");
                    const terrainChangeData = {
                        store: STORES.TERRAIN,
                        added: undoneChanges.terrain.added,
                        removed: undoneChanges.terrain.removed,
                        builderRef: terrainBuilderRef,
                    };
                    await processTerrainUndo(terrainChangeData);
                }

                // Process environment changes if they exist  
                if (isEnvironmentChange) {
                    console.log("[UndoRedoManager] Processing environment changes for undo");
                    const environmentChangeData = {
                        store: STORES.ENVIRONMENT,
                        added: undoneChanges.environment.added,
                        removed: undoneChanges.environment.removed,
                        builderRef: environmentBuilderRef,
                    };
                    await processEnvironmentUndo(environmentChangeData);
                }

                if (!isTerrainChange && !isEnvironmentChange) {
                    console.log("No changes to apply");
                }

                console.log("=== UNDO OPERATION COMPLETED ===");
            } else {
                console.log("Undo operation did not return any changes");
            }
        } catch (error) {
            console.error("=== UNDO OPERATION FAILED ===");
            console.error("Error during undo operation:", error);
            alert(`Undo operation failed: ${error.message}`);

            try {
                if (terrainBuilderRef?.current?.refreshTerrainFromDB) {
                    console.log(
                        "Attempting to recover by refreshing terrain from DB"
                    );
                    await terrainBuilderRef.current.refreshTerrainFromDB();
                }
            } catch (recoveryError) {
                console.error("Recovery attempt failed:", recoveryError);
            }
        }
    };
    // Helper function to process terrain changes during redo
    const processTerrainRedo = async (changeData) => {
        const added = {};
        const removed = {};

        console.log("[Redo] changeData:", changeData);
        console.log("[Redo] changeData.added:", changeData.added);
        console.log("[Redo] changeData.removed:", changeData.removed);

        // For redo: We need to reverse the changeData because it contains the "undo" of the original action
        // changeData.removed contains what was originally added (and we want to re-add it)
        if (changeData.removed) {
            Object.entries(changeData.removed).forEach(([key, value]) => {
                added[key] = value;
            });
            console.log(
                `[Redo] Will ADD ${Object.keys(added).length} blocks (originally added, now in removed)`
            );

            if (Object.keys(added).length > 0) {
                try {
                    const db = await DatabaseManager.getDBConnection();
                    const tx = db.transaction(changeData.store, "readwrite");
                    const store = tx.objectStore(changeData.store);

                    await Promise.all(
                        Object.entries(added).map(([key, value]) => {
                            const putRequest = store.put(value, key);
                            return new Promise((resolve, reject) => {
                                putRequest.onsuccess = resolve;
                                putRequest.onerror = reject;
                            });
                        })
                    );

                    await new Promise((resolve, reject) => {
                        tx.oncomplete = resolve;
                        tx.onerror = reject;
                    });
                    console.log(
                        `[Redo DB] Successfully ADDED ${Object.keys(added).length} blocks directly to DB`
                    );
                } catch (dbError) {
                    console.error("Error updating database during block addition:", dbError);
                    alert(
                        `Error during redo operation: Failed to update database for block addition. Details: ${dbError.message}`
                    );
                    return;
                }
            }
        }

        // changeData.added contains what was originally removed (and we want to re-remove it)
        if (changeData.added) {
            Object.keys(changeData.added).forEach((key) => {
                removed[key] = changeData.added[key];
            });
            console.log(
                `[Redo] Will REMOVE ${Object.keys(removed).length} blocks (originally removed, now in added)`
            );

            if (Object.keys(removed).length > 0) {
                try {
                    const db = await DatabaseManager.getDBConnection();
                    const tx = db.transaction(changeData.store, "readwrite");
                    const store = tx.objectStore(changeData.store);

                    await Promise.all(
                        Object.keys(removed).map((key) => {
                            const deleteRequest = store.delete(`${key}`);
                            return new Promise((resolve, reject) => {
                                deleteRequest.onsuccess = resolve;
                                deleteRequest.onerror = reject;
                            });
                        })
                    );

                    await new Promise((resolve, reject) => {
                        tx.oncomplete = resolve;
                        tx.onerror = reject;
                    });
                    console.log(
                        `[Redo DB] Successfully DELETED ${Object.keys(removed).length} blocks directly from DB`
                    );
                } catch (dbError) {
                    console.error("Error updating database during block removal:", dbError);
                    alert(
                        `Error during redo operation: Failed to update database for block removal. Details: ${dbError.message}`
                    );
                    return;
                }
            }
        }

        // Update terrain builder
        try {
            if (terrainBuilderRef.current.updateTerrainBlocks) {
                terrainBuilderRef.current.updateTerrainBlocks(
                    added,
                    removed,
                    { syncPendingChanges: true, skipUndoSave: true }
                );
                console.log(
                    "Terrain updated successfully with standard method, and pending changes are synced."
                );

                const addedBlocksCount = Object.keys(added).length;
                const removedBlocksCount = Object.keys(removed).length;
                if (addedBlocksCount > 0 || removedBlocksCount > 0) {
                    console.log(
                        "Forcing immediate visibility update to ensure changes are visible"
                    );
                    if (terrainBuilderRef.current.forceRefreshAllChunks) {
                        terrainBuilderRef.current.forceRefreshAllChunks();
                    }
                }
            } else {
                console.warn(
                    "No update terrain function available, falling back to refreshTerrainFromDB"
                );
                await terrainBuilderRef.current.refreshTerrainFromDB();
            }
        } catch (updateError) {
            console.error("Error updating terrain:", updateError);
            alert(
                `Error during redo operation: Failed to update terrain visualization. Details: ${updateError.message}`
            );
            await terrainBuilderRef.current.refreshTerrainFromDB();
        }
    };

    // Helper function to process environment changes during redo
    const processEnvironmentRedo = async (changeData) => {
        // For redo: We need to reverse the changeData because it contains the "undo" of the original action
        // changeData.removed contains what was originally added (and we want to re-add it)
        // changeData.added contains what was originally removed (and we want to re-remove it)
        const added = changeData.removed || []; // What was originally added (now in removed) should be re-added
        const removed = changeData.added || []; // What was originally removed (now in added) should be re-removed

        console.log("environment added (redo):", added);
        console.log("environment removed (redo):", removed);
        console.log("redo changeData.added:", changeData.added);
        console.log("redo changeData.removed:", changeData.removed);

        try {
            if (environmentBuilderRef?.current?.updateEnvironmentForUndoRedo) {
                environmentBuilderRef.current.updateEnvironmentForUndoRedo(added, removed, "redo");
            } else {
                console.warn("No update environment function available, falling back to refreshEnvironmentFromDB");
            }

            // Sync environment changes to TerrainBuilder's pendingChangesRef
            if (terrainBuilderRef?.current?.syncEnvironmentChangesToPending) {
                console.log("Syncing environment changes to TerrainBuilder pending ref for redo");
                console.log("Calling syncEnvironmentChangesToPending with added:", added, "removed:", removed);
                terrainBuilderRef.current.syncEnvironmentChangesToPending(added, removed);
            } else {
                console.warn("syncEnvironmentChangesToPending not available on terrainBuilderRef");
            }

            if (environmentBuilderRef?.current?.refreshEnvironment) {
                console.log("Refreshing environment from DB...");
                try {
                    await environmentBuilderRef.current.refreshEnvironment();
                    console.log("Environment refreshed successfully");
                } catch (refreshError) {
                    console.error("Error refreshing environment:", refreshError);
                    alert(
                        `Error during redo operation: Failed to refresh environment. Details: ${refreshError.message}`
                    );
                }
            } else {
                console.warn(
                    "Unable to refresh environment - refreshEnvironmentFromDB not available"
                );
            }
        } catch (updateError) {
            console.error("Error updating environment:", updateError);
            alert(
                `Error during redo operation: Failed to update environment visualization. Details: ${updateError.message}`
            );
            await environmentBuilderRef.current.refreshEnvironment();
        }
    };

    const handleRedo = async () => {
        try {
            console.log("=== REDO OPERATION STARTED ===");

            const redoneChanges = await redo();
            if (redoneChanges) {
                console.log(
                    "Redo operation successful, selectively updating..."
                );

                const isTerrainChange = redoneChanges.terrain && (Object.keys(redoneChanges.terrain.added || {}).length > 0 || Object.keys(redoneChanges.terrain.removed || {}).length > 0);
                const isEnvironmentChange = redoneChanges.environment && ((redoneChanges.environment.added || []).length > 0 || (redoneChanges.environment.removed || []).length > 0);

                console.log("[UndoRedoManager] redo isTerrainChange:", isTerrainChange);
                console.log("[UndoRedoManager] redo isEnvironmentChange:", isEnvironmentChange);

                // Process terrain changes if they exist
                if (isTerrainChange) {
                    console.log("[UndoRedoManager] Processing terrain changes for redo");
                    const terrainChangeData = {
                        store: STORES.TERRAIN,
                        added: redoneChanges.terrain.added,
                        removed: redoneChanges.terrain.removed,
                        builderRef: terrainBuilderRef,
                    };
                    await processTerrainRedo(terrainChangeData);
                }

                // Process environment changes if they exist  
                if (isEnvironmentChange) {
                    console.log("[UndoRedoManager] Processing environment changes for redo");
                    const environmentChangeData = {
                        store: STORES.ENVIRONMENT,
                        added: redoneChanges.environment.added,
                        removed: redoneChanges.environment.removed,
                        builderRef: environmentBuilderRef,
                    };
                    await processEnvironmentRedo(environmentChangeData);
                }

                if (!isTerrainChange && !isEnvironmentChange) {
                    console.log("No changes to apply");
                }

                console.log("=== REDO OPERATION COMPLETED ===");
            } else {
                console.log("Redo operation did not return any changes");
            }
        } catch (error) {
            console.error("=== REDO OPERATION FAILED ===");
            console.error("Error during redo operation:", error);
            alert(`Redo operation failed: ${error.message}`);

            try {
                if (terrainBuilderRef?.current?.refreshTerrainFromDB) {
                    console.log(
                        "Attempting to recover by refreshing terrain from DB"
                    );
                    await terrainBuilderRef.current.refreshTerrainFromDB();
                }
            } catch (recoveryError) {
                console.error("Recovery attempt failed:", recoveryError);
            }
        }
    };
    const saveUndo = async (changes) => {
        try {
            console.log("[UndoRedoManager] === SAVING UNDO STATE ===");
            console.log("[UndoRedoManager] changes:", changes);

            const hasTerrain =
                changes.terrain &&
                (Object.keys(changes.terrain.added || {}).length > 0 ||
                    Object.keys(changes.terrain.removed || {}).length > 0);
            const hasEnvironment =
                changes.environment &&
                (changes.environment.added?.length > 0 ||
                    changes.environment.removed?.length > 0);

            console.log("[UndoRedoManager] hasTerrain:", hasTerrain);
            console.log("[UndoRedoManager] hasEnvironment:", hasEnvironment);
            if (changes.environment) {
                console.log("[UndoRedoManager] environment.added:", changes.environment.added);
                console.log("[UndoRedoManager] environment.removed:", changes.environment.removed);
            }
            if (!hasTerrain && !hasEnvironment) {
                console.warn(
                    "No actual changes to save in undo state, skipping"
                );
                return;
            }

            const undoStates =
                (await DatabaseManager.getData(STORES.UNDO, "states")) as UndoRedoState[] || [];

            const newUndoStates = [changes, ...undoStates];


            console.log(`Saving new undo state and clearing redo stack...`);
            try {
                await Promise.all([
                    DatabaseManager.saveData(
                        STORES.UNDO,
                        "states",
                        newUndoStates
                    ),
                    DatabaseManager.saveData(STORES.REDO, "states", []),
                ]);
            } catch (saveError) {
                console.error(
                    "Error saving undo state to database:",
                    saveError
                );
                throw saveError;
            }
            console.log("=== UNDO STATE SAVED ===");
        } catch (error) {
            console.error("Error saving undo state:", error);
        }
    };

    React.useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.ctrlKey || event.metaKey) {
                if (event.key === "z") {
                    event.preventDefault();
                    if (event.shiftKey) {
                        handleRedo();
                    } else {
                        handleUndo();
                    }
                } else if (event.key === "y") {
                    event.preventDefault();
                    handleRedo();
                }
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    });
    return <></>;
}
export default React.forwardRef(UndoRedoManager);
