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
    const [hasUndo, setHasUndo] = React.useState(false);
    const [hasRedo, setHasRedo] = React.useState(false);

    React.useEffect(() => {
        const checkDatabase = async () => {
            try {
                const db = await DatabaseManager.getDBConnection();
                if (!db) {
                    console.error("UndoRedoManager: Database not initialized!");
                    return;
                }

                const undoStates =
                    (await DatabaseManager.getData(STORES.UNDO, "states")) ||
                    [];

                if (!undoStates) {
                    await DatabaseManager.saveData(STORES.UNDO, "states", []);
                }

                // Initialize flags
                try {
                    const redoStates =
                        (await DatabaseManager.getData(STORES.REDO, "states")) || [];
                    setHasUndo(Array.isArray(undoStates) && undoStates.length > 0);
                    setHasRedo(Array.isArray(redoStates) && redoStates.length > 0);
                } catch (_) {
                    setHasUndo(Array.isArray(undoStates) && undoStates.length > 0);
                    setHasRedo(false);
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
            canUndo: () => {
                if (!isInitialized) return false;
                return hasUndo;
            },
            canRedo: () => {
                if (!isInitialized) return false;
                return hasRedo;
            },
        })
    );


    const undo = async () => {
        try {
            const undoStates =
                (await DatabaseManager.getData(STORES.UNDO, "states")) as any[] || [];
            if (undoStates.length === 0) {
                return null;
            }
            const [currentUndo, ...remainingUndo] = undoStates;
            const redoStates =
                (await DatabaseManager.getData(STORES.REDO, "states")) as UndoRedoState[] || [];

            const redoChanges: any = {
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
            // Reverse rotation changes for redo
            if (currentUndo.rotations) {
                redoChanges.rotations = {
                    added: currentUndo.rotations.removed || {},
                    removed: currentUndo.rotations.added || {},
                };
            }
            // Reverse shape changes for redo
            if (currentUndo.shapes) {
                redoChanges.shapes = {
                    added: currentUndo.shapes.removed || {},
                    removed: currentUndo.shapes.added || {},
                };
            }


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
            } catch (dbError) {
                console.error(
                    "Error while updating database during undo:",
                    dbError
                );
                throw dbError;
            }
            // Update flags
            try {
                setHasUndo(remainingUndo.length > 0);
                setHasRedo(true);
            } catch (_) { }
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

            const undoChanges: any = {
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
            // Reverse rotation changes for undo
            if (currentRedo.rotations) {
                undoChanges.rotations = {
                    added: currentRedo.rotations.removed || {},
                    removed: currentRedo.rotations.added || {},
                };
            }
            // Reverse shape changes for undo
            if (currentRedo.shapes) {
                undoChanges.shapes = {
                    added: currentRedo.shapes.removed || {},
                    removed: currentRedo.shapes.added || {},
                };
            }
            await Promise.all([
                DatabaseManager.saveData(STORES.REDO, "states", remainingRedo),
                DatabaseManager.saveData(STORES.UNDO, "states", [
                    undoChanges,
                    ...undoStates,
                ]),
            ]);
            // Update flags
            try {
                setHasUndo(true);
                setHasRedo(remainingRedo.length > 0);
            } catch (_) { }
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
            Object.keys(changeData.added).forEach(
                (key) => {
                    removed[key] = changeData.added[key];
                }
            );
        }

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
            } catch (dbError) {
                console.error("Error updating database during block removal:", dbError);
                alert(
                    `Error during undo operation: Failed to update database for block removal. Details: ${dbError.message}`
                );
                return;
            }
        }

        if (changeData.removed) {
            Object.entries(changeData.removed).forEach(([key, value]) => {
                added[key] = value;
            });
        }

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
            } catch (dbError) {
                console.error("Error updating database during block addition:", dbError);
                alert(
                    `Error during undo operation: Failed to update database for block addition. Details: ${dbError.message}`
                );
                return;
            }
        }

        // Build rotation data for undo: restore removed rotations, clear added rotations
        const rotationData = changeData.rotations ? {
            // Rotations that were originally removed → need to be restored (added back)
            added: changeData.rotations.removed || {},
            // Rotations that were originally added → handled implicitly by block removal
            removed: changeData.rotations.added || {},
        } : undefined;

        // Build shape data for undo: restore removed shapes, clear added shapes
        const shapeData = changeData.shapes ? {
            added: changeData.shapes.removed || {},
            removed: changeData.shapes.added || {},
        } : undefined;

        // Update terrain builder
        try {
            if (terrainBuilderRef.current.updateTerrainBlocks) {
                terrainBuilderRef.current.updateTerrainBlocks(
                    added,
                    removed,
                    { syncPendingChanges: true, skipUndoSave: true, rotationData, shapeData }
                );

                const addedBlocksCount = Object.keys(added).length;
                const removedBlocksCount = Object.keys(removed).length;
                if (addedBlocksCount > 0 || removedBlocksCount > 0) {
                    // Forcing immediate visibility update to ensure changes are visible
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


        try {
            if (environmentBuilderRef?.current?.updateEnvironmentForUndoRedo) {
                environmentBuilderRef.current.updateEnvironmentForUndoRedo(added, removed, "undo");
            } else {
                console.warn(
                    "No update environment function available, falling back to refreshEnvironmentFromDB"
                );
            }

            // Sync environment changes to TerrainBuilder's pendingChangesRef
            if (terrainBuilderRef?.current?.syncEnvironmentChangesToPending) {
                terrainBuilderRef.current.syncEnvironmentChangesToPending(added, removed);
            } else {
                console.warn("syncEnvironmentChangesToPending not available on terrainBuilderRef");
            }

            if (environmentBuilderRef?.current?.refreshEnvironment) {
                try {
                    await environmentBuilderRef.current.refreshEnvironment();
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

            const undoneChanges = await undo();
            if (undoneChanges) {
                const isTerrainChange = undoneChanges.terrain && (Object.keys(undoneChanges.terrain.added || {}).length > 0 || Object.keys(undoneChanges.terrain.removed || {}).length > 0);
                const isEnvironmentChange = undoneChanges.environment && ((undoneChanges.environment.added || []).length > 0 || (undoneChanges.environment.removed || []).length > 0);

                if (undoneChanges.environment) {
                }

                // Process terrain changes if they exist
                if (isTerrainChange) {
                    const terrainChangeData = {
                        store: STORES.TERRAIN,
                        added: undoneChanges.terrain.added,
                        removed: undoneChanges.terrain.removed,
                        builderRef: terrainBuilderRef,
                        rotations: undoneChanges.rotations || null,
                        shapes: undoneChanges.shapes || null,
                    };
                    await processTerrainUndo(terrainChangeData);
                }

                // Process environment changes if they exist  
                if (isEnvironmentChange) {
                    const environmentChangeData = {
                        store: STORES.ENVIRONMENT,
                        added: undoneChanges.environment.added,
                        removed: undoneChanges.environment.removed,
                        builderRef: environmentBuilderRef,
                    };
                    await processEnvironmentUndo(environmentChangeData);
                }

                if (!isTerrainChange && !isEnvironmentChange) {
                }

                // Dispatch event to notify that undo operation completed
                window.dispatchEvent(new CustomEvent("undo-complete"));
            } else {
            }
        } catch (error) {
            console.error("=== UNDO OPERATION FAILED ===");
            console.error("Error during undo operation:", error);
            alert(`Undo operation failed: ${error.message}`);

            try {
                if (terrainBuilderRef?.current?.refreshTerrainFromDB) {
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


        // For redo: We need to reverse the changeData because it contains the "undo" of the original action
        // changeData.removed contains what was originally added (and we want to re-add it)
        if (changeData.removed) {
            Object.entries(changeData.removed).forEach(([key, value]) => {
                added[key] = value;
            });

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
                } catch (dbError) {
                    console.error("Error updating database during block removal:", dbError);
                    alert(
                        `Error during redo operation: Failed to update database for block removal. Details: ${dbError.message}`
                    );
                    return;
                }
            }
        }

        // Build rotation data for redo
        // For redo, changeData is the redo state (which was the reversed undo state)
        // changeData.removed = blocks to re-add, changeData.added = blocks to re-remove
        // Rotation data flows through directly from the stored state
        const rotationData = changeData.rotations ? {
            added: changeData.rotations.removed || {},
            removed: changeData.rotations.added || {},
        } : undefined;

        // Build shape data for redo
        const shapeData = changeData.shapes ? {
            added: changeData.shapes.removed || {},
            removed: changeData.shapes.added || {},
        } : undefined;

        // Update terrain builder
        try {
            if (terrainBuilderRef.current.updateTerrainBlocks) {
                terrainBuilderRef.current.updateTerrainBlocks(
                    added,
                    removed,
                    { syncPendingChanges: true, skipUndoSave: true, rotationData, shapeData }
                );

                const addedBlocksCount = Object.keys(added).length;
                const removedBlocksCount = Object.keys(removed).length;
                if (addedBlocksCount > 0 || removedBlocksCount > 0) {
                    // Forcing immediate visibility update to ensure changes are visible
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


        try {
            if (environmentBuilderRef?.current?.updateEnvironmentForUndoRedo) {
                environmentBuilderRef.current.updateEnvironmentForUndoRedo(added, removed, "redo");
            } else {
                console.warn("No update environment function available, falling back to refreshEnvironmentFromDB");
            }

            // Sync environment changes to TerrainBuilder's pendingChangesRef
            if (terrainBuilderRef?.current?.syncEnvironmentChangesToPending) {
                terrainBuilderRef.current.syncEnvironmentChangesToPending(added, removed);
            } else {
                console.warn("syncEnvironmentChangesToPending not available on terrainBuilderRef");
            }

            if (environmentBuilderRef?.current?.refreshEnvironment) {
                try {
                    await environmentBuilderRef.current.refreshEnvironment();
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

            const redoneChanges = await redo();
            if (redoneChanges) {
                const isTerrainChange = redoneChanges.terrain && (Object.keys(redoneChanges.terrain.added || {}).length > 0 || Object.keys(redoneChanges.terrain.removed || {}).length > 0);
                const isEnvironmentChange = redoneChanges.environment && ((redoneChanges.environment.added || []).length > 0 || (redoneChanges.environment.removed || []).length > 0);


                // Process terrain changes if they exist
                if (isTerrainChange) {
                    const terrainChangeData = {
                        store: STORES.TERRAIN,
                        added: redoneChanges.terrain.added,
                        removed: redoneChanges.terrain.removed,
                        builderRef: terrainBuilderRef,
                        rotations: redoneChanges.rotations || null,
                        shapes: redoneChanges.shapes || null,
                    };
                    await processTerrainRedo(terrainChangeData);
                }

                // Process environment changes if they exist
                if (isEnvironmentChange) {
                    const environmentChangeData = {
                        store: STORES.ENVIRONMENT,
                        added: redoneChanges.environment.added,
                        removed: redoneChanges.environment.removed,
                        builderRef: environmentBuilderRef,
                    };
                    await processEnvironmentRedo(environmentChangeData);
                }

                if (!isTerrainChange && !isEnvironmentChange) {
                }

                // Dispatch event to notify that redo operation completed
                window.dispatchEvent(new CustomEvent("redo-complete"));
            } else {
            }
        } catch (error) {
            console.error("=== REDO OPERATION FAILED ===");
            console.error("Error during redo operation:", error);
            alert(`Redo operation failed: ${error.message}`);

            try {
                if (terrainBuilderRef?.current?.refreshTerrainFromDB) {
                    await terrainBuilderRef.current.refreshTerrainFromDB();
                }
            } catch (recoveryError) {
                console.error("Recovery attempt failed:", recoveryError);
            }
        }
    };
    const saveUndo = async (changes) => {
        try {

            const hasTerrain =
                changes.terrain &&
                (Object.keys(changes.terrain.added || {}).length > 0 ||
                    Object.keys(changes.terrain.removed || {}).length > 0);
            const hasEnvironment =
                changes.environment &&
                (changes.environment.added?.length > 0 ||
                    changes.environment.removed?.length > 0);

            if (changes.environment) {
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
            // Update flags
            setHasUndo(true);
            setHasRedo(false);
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
