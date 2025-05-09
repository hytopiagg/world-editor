import React, {
    useImperativeHandle
} from "react";
import { MIN_UNDO_STATES } from "../Constants";
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
    const handleUndo = async () => {
        try {
            console.log("=== UNDO OPERATION STARTED ===");

            const undoneChanges = await undo();
            console.log("undoneChanges", undoneChanges);
            if (undoneChanges) {
                console.log(
                    "Undo operation successful, selectively updating..."
                );

                console.log("undoneChanges", undoneChanges);

                const isTerrainChange = undoneChanges.terrain && (Object.keys(undoneChanges.terrain.added || {}).length > 0 || Object.keys(undoneChanges.terrain.removed || {}).length > 0);
                const isEnvironmentChange = undoneChanges.environment && (Object.keys(undoneChanges.environment.added || {}).length > 0 || Object.keys(undoneChanges.environment.removed || {}).length > 0);
                const changeData = isTerrainChange ?
                    {
                        store: STORES.TERRAIN,
                        added: undoneChanges.terrain.added,
                        removed: undoneChanges.terrain.removed,
                        builderRef: terrainBuilderRef,
                    } : isEnvironmentChange ?
                        {
                            store: STORES.ENVIRONMENT,
                            added: undoneChanges.environment.added,
                            removed: undoneChanges.environment.removed,
                            builderRef: environmentBuilderRef,
                        } : null;


                if (changeData) {
                    const added = {};
                    const removed = {};

                    if (changeData.added) {
                        console.log("changeData.added", changeData.added);
                        Object.keys(changeData.added).forEach(
                            (key) => {
                                removed[key] =
                                    changeData.added[key];
                            }
                        );
                        console.log(
                            `Will remove ${Object.keys(removed).length
                            } blocks from the ${changeData.store}`
                        );

                        if (Object.keys(removed).length > 0) {
                            try {

                                const db =
                                    await DatabaseManager.getDBConnection();
                                const tx = db.transaction(
                                    changeData.store,
                                    "readwrite"
                                );
                                console.log("tx - removed", tx);
                                const store = tx.objectStore(changeData.store);
                                console.log("store - removed", store);
                                await Promise.all(
                                    Object.keys(removed).map((key) => {
                                        console.log("deleting", key);
                                        const deleteRequest = store.delete(
                                            `${key}`
                                        );
                                        return new Promise(
                                            (resolve, reject) => {
                                                deleteRequest.onsuccess =
                                                    resolve;
                                                deleteRequest.onerror = reject;
                                            }
                                        );
                                    })
                                );

                                await new Promise((resolve, reject) => {
                                    tx.oncomplete = resolve;
                                    tx.onerror = reject;
                                });
                                console.log(
                                    `Successfully deleted ${Object.keys(removed).length
                                    } blocks directly from DB`
                                );
                            } catch (dbError) {
                                console.error(
                                    "Error updating database during block removal:",
                                    dbError
                                );
                                alert(
                                    `Error during undo operation: Failed to update database for block removal. Details: ${dbError.message}`
                                );
                                return;
                            }
                        }
                    }

                    if (changeData.removed) {
                        console.log("changeData.removed", changeData.removed);
                        Object.entries(changeData.removed).forEach(
                            ([key, value]) => {
                                added[key] = value;
                            }
                        );
                        console.log(
                            `Will add back ${Object.keys(added).length
                            } blocks to the ${changeData.store}`
                        );

                        if (Object.keys(added).length > 0) {
                            try {

                                const db =
                                    await DatabaseManager.getDBConnection();
                                const tx = db.transaction(
                                    changeData.store,
                                    "readwrite"
                                );
                                console.log("tx - added", tx);

                                console.log("changeData", changeData);

                                const store = tx.objectStore(changeData.store);
                                console.log("store - added", store);

                                await Promise.all(
                                    Object.entries(added).map(
                                        ([key, value]) => {
                                            console.log("adding", key, value);
                                            const putRequest = store.put(
                                                value,
                                                key
                                            );
                                            return new Promise(
                                                (resolve, reject) => {
                                                    putRequest.onsuccess =
                                                        resolve;
                                                    putRequest.onerror = reject;
                                                }
                                            );
                                        }
                                    )
                                );

                                await new Promise((resolve, reject) => {
                                    tx.oncomplete = resolve;
                                    tx.onerror = reject;
                                });

                                console.log("tx - added - oncomplete", tx.oncomplete);
                                console.log("tx - added - onerror", tx.onerror);
                                console.log(
                                    `Successfully added ${Object.keys(added).length} blocks directly to DB`
                                );
                            } catch (dbError) {
                                console.error(
                                    "Error updating database during block addition:",
                                    dbError
                                );
                                alert(
                                    `Error during undo operation: Failed to update database for block addition. Details: ${dbError.message}`
                                );
                                return;
                            }
                        }
                    }
                    console.log(
                        `Selectively updating terrain: ${Object.keys(added).length
                        } additions, ${Object.keys(removed).length
                        } removals`
                    );

                    console.log("changeData", changeData);
                    console.log("terrainBuilderRef", terrainBuilderRef.current);
                    console.log("environmentBuilderRef", environmentBuilderRef.current);
                    console.log("added", added);
                    console.log("removed", removed);

                    try {
                        if (changeData.store === STORES.TERRAIN) {
                            if (
                                terrainBuilderRef.current.updateTerrainForUndoRedo
                            ) {
                                terrainBuilderRef.current.updateTerrainForUndoRedo(
                                    added,
                                    removed,
                                    "undo"
                                );
                                console.log(
                                    "Terrain updated successfully with optimized method"
                                );

                                const addedBlocksCount =
                                    Object.keys(added).length;
                                const removedBlocksCount =
                                    Object.keys(removed).length;
                                if (
                                    addedBlocksCount > 0 ||
                                    removedBlocksCount > 0
                                ) {
                                    console.log(
                                        "Forcing immediate visibility update to ensure changes are visible"
                                    );
                                    if (
                                        terrainBuilderRef.current
                                            .updateVisibleChunks
                                    ) {
                                        terrainBuilderRef.current.updateVisibleChunks();
                                    }
                                }
                            } else if (
                                terrainBuilderRef.current.updateTerrainBlocks
                            ) {
                                terrainBuilderRef.current.updateTerrainBlocks(
                                    added,
                                    removed
                                );
                                console.log(
                                    "Terrain updated successfully with standard method"
                                );
                            } else {
                                console.warn(
                                    "No update terrain function available, falling back to refreshTerrainFromDB"
                                );
                                await terrainBuilderRef.current.refreshTerrainFromDB();
                            }
                        }

                        if (changeData.store === STORES.ENVIRONMENT) {
                            if (environmentBuilderRef?.current?.updateEnvironmentForUndoRedo) {
                                console.log("Updating environment for undo redo");
                                console.log("added", added);
                                console.log("removed", removed);
                                environmentBuilderRef.current.updateEnvironmentForUndoRedo(added, removed, "undo");
                            } else {
                                console.warn(
                                    "No update environment function available, falling back to refreshEnvironmentFromDB"
                                );
                            }

                            if (environmentBuilderRef?.current?.refreshEnvironment) {
                                console.log("Refreshing environment from DB...");
                                try {
                                    await environmentBuilderRef.current.refreshEnvironment();
                                    console.log("Environment refreshed successfully");
                                } catch (refreshError) {
                                    console.error(
                                        "Error refreshing environment:",
                                        refreshError
                                    );
                                    alert(
                                        `Error during undo operation: Failed to refresh environment. Details: ${refreshError.message}`
                                    );
                                }
                            } else {
                                console.warn(
                                    "Unable to refresh environment - refreshEnvironmentFromDB not available"
                                );
                            }
                        }
                    } catch (updateError) {
                        console.error("Error updating terrain:", updateError);
                        alert(
                            `Error during undo operation: Failed to update terrain visualization. Details: ${updateError.message}`
                        );
                        await terrainBuilderRef.current.refreshTerrainFromDB();
                        await environmentBuilderRef.current.refreshEnvironment();
                    }
                } else {
                    console.log(
                        "No changes to apply"
                    );
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
    const handleRedo = async () => {
        try {
            console.log("=== REDO OPERATION STARTED ===");

            const redoneChanges = await redo();
            if (redoneChanges) {
                console.log(
                    "Redo operation successful, selectively updating terrain..."
                );

                const isTerrainChange = redoneChanges.terrain && (Object.keys(redoneChanges.terrain.added || {}).length > 0 || Object.keys(redoneChanges.terrain.removed || {}).length > 0);
                const isEnvironmentChange = redoneChanges.environment && (Object.keys(redoneChanges.environment.added || {}).length > 0 || Object.keys(redoneChanges.environment.removed || {}).length > 0);
                const changeData = isTerrainChange ?
                    {
                        store: STORES.TERRAIN,
                        added: redoneChanges.terrain.added,
                        removed: redoneChanges.terrain.removed,
                        builderRef: terrainBuilderRef,
                    } : isEnvironmentChange ?
                        {
                            store: STORES.ENVIRONMENT,
                            added: redoneChanges.environment.added,
                            removed: redoneChanges.environment.removed,
                            builderRef: environmentBuilderRef,
                        } : null;
                if (changeData) {
                    const added = {};
                    const removed = {};


                    if (changeData.removed) {
                        Object.entries(changeData.removed).forEach(
                            ([key, value]) => {
                                added[key] = value;
                            }
                        );
                        console.log(
                            `[Redo] Will ADD ${Object.keys(added).length
                            } blocks (originally removed)`
                        );

                        if (Object.keys(added).length > 0) {
                            try {

                                const db =
                                    await DatabaseManager.getDBConnection();
                                const tx = db.transaction(
                                    changeData.store,
                                    "readwrite"
                                );
                                const store = tx.objectStore(changeData.store);

                                await Promise.all(
                                    Object.entries(added).map(
                                        ([key, value]) => {
                                            const putRequest = store.put(
                                                value,
                                                key
                                            );
                                            return new Promise(
                                                (resolve, reject) => {
                                                    putRequest.onsuccess =
                                                        resolve;
                                                    putRequest.onerror = reject;
                                                }
                                            );
                                        }
                                    )
                                );

                                await new Promise((resolve, reject) => {
                                    tx.oncomplete = resolve;
                                    tx.onerror = reject;
                                });
                                console.log(
                                    `[Redo DB] Successfully ADDED ${Object.keys(added).length
                                    } blocks directly to DB`
                                );
                            } catch (dbError) {
                                console.error(
                                    "Error updating database during block addition:",
                                    dbError
                                );
                                alert(
                                    `Error during redo operation: Failed to update database for block addition. Details: ${dbError.message}`
                                );
                                return;
                            }
                        }
                    }


                    if (changeData.added) {
                        Object.keys(changeData.added).forEach(
                            (key) => {

                                removed[key] =
                                    changeData.added[key];
                            }
                        );
                        console.log(
                            `[Redo] Will REMOVE ${Object.keys(removed).length
                            } blocks (originally added)`
                        );

                        if (Object.keys(removed).length > 0) {
                            try {

                                const db =
                                    await DatabaseManager.getDBConnection();
                                const tx = db.transaction(
                                    changeData.store,
                                    "readwrite"
                                );
                                const store = tx.objectStore(changeData.store);

                                await Promise.all(
                                    Object.keys(removed).map((key) => {
                                        const deleteRequest = store.delete(
                                            `${key}`
                                        );
                                        return new Promise(
                                            (resolve, reject) => {
                                                deleteRequest.onsuccess =
                                                    resolve;
                                                deleteRequest.onerror = reject;
                                            }
                                        );
                                    })
                                );

                                await new Promise((resolve, reject) => {
                                    tx.oncomplete = resolve;
                                    tx.onerror = reject;
                                });
                                console.log(
                                    `[Redo DB] Successfully DELETED ${Object.keys(removed).length
                                    } blocks directly from DB`
                                );
                            } catch (dbError) {
                                console.error(
                                    "Error updating database during block removal:",
                                    dbError
                                );
                                alert(
                                    `Error during redo operation: Failed to update database for block removal. Details: ${dbError.message}`
                                );
                                return;
                            }
                        }
                    }
                    console.log(
                        `Selectively updating terrain: ${Object.keys(added).length
                        } additions, ${Object.keys(removed).length
                        } removals`
                    );

                    try {
                        console.log("changeData", changeData);
                        console.log("terrainBuilderRef", terrainBuilderRef.current);
                        console.log("environmentBuilderRef", environmentBuilderRef.current);
                        console.log("added", added);
                        console.log("removed", removed);

                        if (changeData.store === STORES.TERRAIN) {
                            if (
                                terrainBuilderRef.current.updateTerrainForUndoRedo
                            ) {
                                terrainBuilderRef.current.updateTerrainForUndoRedo(
                                    added,
                                    removed,
                                    "redo"
                                );
                                console.log(
                                    "Terrain updated successfully with optimized method"
                                );

                                const addedBlocksCount =
                                    Object.keys(added).length;
                                const removedBlocksCount =
                                    Object.keys(removed).length;
                                if (
                                    addedBlocksCount > 0 ||
                                    removedBlocksCount > 0
                                ) {
                                    console.log(
                                        "Forcing immediate visibility update to ensure changes are visible"
                                    );
                                    if (
                                        terrainBuilderRef.current
                                            .updateVisibleChunks
                                    ) {
                                        console.log("Updating visible chunks");
                                        terrainBuilderRef.current.updateVisibleChunks();
                                    }
                                }
                            } else if (
                                terrainBuilderRef.current.updateTerrainBlocks
                            ) {
                                terrainBuilderRef.current.updateTerrainBlocks(
                                    added,
                                    removed
                                );
                                console.log(
                                    "Terrain updated successfully with standard method"
                                );
                            } else {
                                console.warn(
                                    "No update terrain function available, falling back to refreshTerrainFromDB"
                                );
                                await terrainBuilderRef.current.refreshTerrainFromDB();
                            }

                        } else if (changeData.store === STORES.ENVIRONMENT) {
                            if (environmentBuilderRef?.current?.updateEnvironmentForUndoRedo) {
                                environmentBuilderRef.current.updateEnvironmentForUndoRedo(added, removed, "redo");
                            } else {
                                console.warn("No update environment function available, falling back to refreshEnvironmentFromDB");
                            }

                            if (environmentBuilderRef?.current?.refreshEnvironment) {
                                console.log("Refreshing environment from DB...");
                                try {
                                    await environmentBuilderRef.current.refreshEnvironment();
                                    console.log("Environment refreshed successfully");
                                } catch (refreshError) {
                                    console.error(
                                        "Error refreshing environment:",
                                        refreshError
                                    );
                                    alert(
                                        `Error during undo operation: Failed to refresh environment. Details: ${refreshError.message}`
                                    );
                                }
                            } else {
                                console.warn(
                                    "Unable to refresh environment - refreshEnvironmentFromDB not available"
                                );
                            }
                        }
                    } catch (updateError) {
                        console.error("Error updating terrain:", updateError);
                        alert(
                            `Error during redo operation: Failed to update terrain visualization. Details: ${updateError.message}`
                        );
                        await terrainBuilderRef.current.refreshTerrainFromDB();
                        await environmentBuilderRef.current.refreshEnvironment();
                    }
                } else {
                    console.log(
                        "No changes to apply"
                    );
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
            console.log("=== SAVING UNDO STATE ===");


            const hasTerrain =
                changes.terrain &&
                (Object.keys(changes.terrain.added || {}).length > 0 ||
                    Object.keys(changes.terrain.removed || {}).length > 0);
            const hasEnvironment =
                changes.environment &&
                (changes.environment.added?.length > 0 ||
                    changes.environment.removed?.length > 0);
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
