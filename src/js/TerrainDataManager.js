import { useEffect, useRef } from "react";
import { DatabaseManager, STORES } from "./DatabaseManager";
import { loadingManager } from "./LoadingManager";

// Constants
const AUTO_SAVE_INTERVAL = 300000; // Auto-save every 5 minutes (300,000 ms)

export function useTerrainDataManager(props = {}) {
    const {
        sendTotalBlocks,
        undoRedoManager, // Pass necessary refs if needed
        buildUpdateTerrain, // Pass necessary functions
        setPageIsLoaded, // Pass necessary functions
        updateDebugInfo, // Pass necessary functions
    } = props;

    // Data State Refs
    const terrainRef = useRef({});
    const totalBlocksRef = useRef(0);
    const pendingChangesRef = useRef({
        terrain: { added: {}, removed: {} },
        environment: { added: [], removed: [] },
    });
    const lastSaveTimeRef = useRef(Date.now());
    const initialSaveCompleteRef = useRef(false);
    const autoSaveIntervalRef = useRef(null);
    const isAutoSaveEnabledRef = useRef(true);
    const gridSizeRef = useRef(props.gridSize || 200); // Initialize with prop or default

    // Helper function to properly reset pendingChangesRef
    const resetPendingChanges = () => {
        pendingChangesRef.current = {
            terrain: { added: {}, removed: {} },
            environment: { added: [], removed: [] },
        };
    };

    // Track changes for incremental saves
    const trackTerrainChanges = (added = {}, removed = {}) => {
        // Skip if the database is being cleared
        if (window.IS_DATABASE_CLEARING) {
            console.log("Database is being cleared, skipping tracking changes");
            return;
        }

        // Initialize the changes object if it doesn't exist
        if (!pendingChangesRef.current) {
            resetPendingChanges();
        }

        // Ensure terrain object exists
        if (!pendingChangesRef.current.terrain) {
            pendingChangesRef.current.terrain = { added: {}, removed: {} };
        }

        // Ensure environment object exists
        if (!pendingChangesRef.current.environment) {
            pendingChangesRef.current.environment = { added: [], removed: [] };
        }

        // Safely handle potentially null or undefined values
        const safeAdded = added || {};
        const safeRemoved = removed || {};

        // Track added blocks
        Object.entries(safeAdded).forEach(([key, value]) => {
            if (pendingChangesRef.current?.terrain?.added) {
                pendingChangesRef.current.terrain.added[key] = value;
            }
            // If this position was previously in the removed list, remove it
            if (
                pendingChangesRef.current?.terrain?.removed &&
                pendingChangesRef.current.terrain.removed[key]
            ) {
                delete pendingChangesRef.current.terrain.removed[key];
            }
        });

        // Track removed blocks
        Object.entries(safeRemoved).forEach(([key, value]) => {
            // If this position was previously in the added list, just remove it
            if (
                pendingChangesRef.current?.terrain?.added &&
                pendingChangesRef.current.terrain.added[key]
            ) {
                delete pendingChangesRef.current.terrain.added[key];
            } else if (pendingChangesRef.current?.terrain?.removed) {
                // Otherwise track it as removed
                pendingChangesRef.current.terrain.removed[key] = value;
            }
        });
    };

    // Function to efficiently save terrain data
    const efficientTerrainSave = async () => {
        // Make it async
        // Skip if database is being cleared
        if (window.IS_DATABASE_CLEARING) {
            return false;
        }

        // Skip if no changes to save
        if (
            !pendingChangesRef.current ||
            !pendingChangesRef.current.terrain ||
            (Object.keys(pendingChangesRef.current.terrain.added || {})
                .length === 0 &&
                Object.keys(pendingChangesRef.current.terrain.removed || {})
                    .length === 0)
        ) {
            return true;
        }

        // Capture the changes to save
        const changesToSave = { ...pendingChangesRef.current.terrain };

        // Reset pending changes immediately *before* starting the async save
        resetPendingChanges();

        try {
            const db = await DatabaseManager.getDBConnection();
            const tx = db.transaction(STORES.TERRAIN, "readwrite");
            const store = tx.objectStore(STORES.TERRAIN);

            // Apply removals
            if (
                changesToSave.removed &&
                Object.keys(changesToSave.removed).length > 0
            ) {
                await Promise.all(
                    Object.keys(changesToSave.removed).map((key) => {
                        const deleteRequest = store.delete(`${key}`);
                        return new Promise((resolve, reject) => {
                            deleteRequest.onsuccess = resolve;
                            deleteRequest.onerror = reject;
                        });
                    })
                );
                console.log(
                    `Deleted ${
                        Object.keys(changesToSave.removed).length
                    } blocks from DB`
                );
            }

            // Apply additions/updates
            if (
                changesToSave.added &&
                Object.keys(changesToSave.added).length > 0
            ) {
                await Promise.all(
                    Object.entries(changesToSave.added).map(([key, value]) => {
                        const putRequest = store.put(value, key);
                        return new Promise((resolve, reject) => {
                            putRequest.onsuccess = resolve;
                            putRequest.onerror = reject;
                        });
                    })
                );
            }

            // Complete the transaction
            await new Promise((resolve, reject) => {
                tx.oncomplete = resolve;
                tx.onerror = reject;
            });
            lastSaveTimeRef.current = Date.now(); // Update last save time
            return true;
        } catch (error) {
            console.error("Error during efficient terrain save:", error);
            // IMPORTANT: Restore pending changes if save failed
            pendingChangesRef.current.terrain = changesToSave;
            return false;
        }
    };

    // Function to manually save the terrain
    const saveTerrainManually = () => {
        console.log("Manual save requested...");
        return efficientTerrainSave();
    };

    // Load initial terrain from DB
    const loadInitialTerrain = async () => {
        console.log("[Load] Attempting to load terrain from IndexedDB...");
        try {
            const savedTerrain = await DatabaseManager.getData(
                STORES.TERRAIN,
                "current"
            );
            console.log(
                "[Load] Terrain data retrieved from DB:",
                savedTerrain
                    ? `(${Object.keys(savedTerrain).length} blocks)`
                    : "null"
            );

            if (savedTerrain) {
                terrainRef.current = savedTerrain;
                console.log(
                    "[Load] Terrain loaded from IndexedDB into terrainRef.current"
                );
                totalBlocksRef.current = Object.keys(terrainRef.current).length;
                resetPendingChanges(); // Don't mark loaded terrain as unsaved
                console.log(
                    "Loaded terrain marked as saved - no unsaved changes"
                );
                return true; // Indicate terrain was loaded
            } else {
                console.log("[Load] No terrain found in IndexedDB");
                terrainRef.current = {};
                totalBlocksRef.current = 0;
                console.log("[Load] Initialized terrainRef.current as empty.");
                return false; // Indicate no terrain was loaded
            }
        } catch (error) {
            console.error("Error loading initial terrain:", error);
            terrainRef.current = {};
            totalBlocksRef.current = 0;
            return false;
        } finally {
            setPageIsLoaded(true); // Ensure page is marked loaded regardless
        }
    };

    // Setup auto-save only if enabled
    useEffect(() => {
        const setupAutoSave = () => {
            if (autoSaveIntervalRef.current) {
                clearInterval(autoSaveIntervalRef.current);
                autoSaveIntervalRef.current = null;
            }
            if (isAutoSaveEnabledRef.current) {
                console.log(
                    `Auto-save enabled with interval: ${
                        AUTO_SAVE_INTERVAL / 1000
                    } seconds`
                );
                autoSaveIntervalRef.current = setInterval(() => {
                    if (
                        pendingChangesRef.current?.terrain &&
                        (Object.keys(
                            pendingChangesRef.current.terrain.added || {}
                        ).length > 0 ||
                            Object.keys(
                                pendingChangesRef.current.terrain.removed || {}
                            ).length > 0)
                    ) {
                        console.log("Auto-saving terrain...");
                        efficientTerrainSave();
                    }
                }, AUTO_SAVE_INTERVAL);
            } else {
                console.log("Auto-save is disabled");
            }
        };
        setupAutoSave();
        return () => {
            if (autoSaveIntervalRef.current) {
                clearInterval(autoSaveIntervalRef.current);
            }
        };
    }, [isAutoSaveEnabledRef.current]); // Re-run if auto-save enabled status changes

    // Handle saving on page unload/navigation
    useEffect(() => {
        let reloadJustPrevented = false;
        const currentUrl = window.location.href;

        const handleBeforeUnload = (event) => {
            if (window.IS_DATABASE_CLEARING) return;
            if (!pendingChangesRef.current?.terrain) return;

            const hasTerrainChanges =
                Object.keys(pendingChangesRef.current.terrain.added || {})
                    .length > 0 ||
                Object.keys(pendingChangesRef.current.terrain.removed || {})
                    .length > 0;

            if (hasTerrainChanges) {
                localStorage.setItem("reload_attempted", "true");
                reloadJustPrevented = true;
                event.preventDefault();
                event.returnValue =
                    "You have unsaved changes. Are you sure you want to leave?";
                return event.returnValue;
            }
        };

        const handlePopState = (event) => {
            if (reloadJustPrevented) {
                event.preventDefault();
                reloadJustPrevented = false;
                window.history.pushState(null, document.title, currentUrl);
                return false;
            }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                const reloadAttempted =
                    localStorage.getItem("reload_attempted") === "true";
                if (reloadAttempted) {
                    localStorage.removeItem("reload_attempted");
                    if (reloadJustPrevented) {
                        reloadJustPrevented = false;
                        window.history.pushState(
                            null,
                            document.title,
                            currentUrl
                        );
                    }
                }
            }
        };

        window.addEventListener("beforeunload", handleBeforeUnload);
        window.addEventListener("popstate", handlePopState);
        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.history.pushState(null, document.title, currentUrl);
        localStorage.removeItem("reload_attempted");

        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);
            window.removeEventListener("popstate", handlePopState);
            document.removeEventListener(
                "visibilitychange",
                handleVisibilityChange
            );
        };
    }, []); // Runs once on mount

    // Initialize the incremental terrain save system validation
    useEffect(() => {
        console.log("Initializing incremental terrain save system");
        initialSaveCompleteRef.current = false;
        resetPendingChanges();
        lastSaveTimeRef.current = Date.now();
        console.log(
            "Last save time initialized to:",
            new Date(lastSaveTimeRef.current).toLocaleTimeString()
        );

        const validateTerrain = async () => {
            try {
                const terrain = await DatabaseManager.getData(
                    STORES.TERRAIN,
                    "current"
                );
                if (terrain && Object.keys(terrain).length > 0) {
                    console.log(
                        `Loaded existing terrain with ${
                            Object.keys(terrain).length
                        } blocks`
                    );
                    initialSaveCompleteRef.current = true;
                } else {
                    console.log(
                        "No existing terrain found, will create baseline on first save"
                    );
                }
            } catch (err) {
                console.error("Error validating terrain data:", err);
            }
        };
        validateTerrain();
    }, []);

    // Helper function to enable/disable auto-save
    const setAutoSaveEnabled = (enabled) => {
        console.log(`Auto-save being ${enabled ? "enabled" : "disabled"}`);
        isAutoSaveEnabledRef.current = enabled;
        // The useEffect hook will handle restarting the interval
        return enabled;
    };

    // Configure the auto-save interval (in milliseconds)
    const setAutoSaveInterval = (intervalMs) => {
        console.log(`Setting auto-save interval to ${intervalMs}ms`);
        if (autoSaveIntervalRef.current) {
            clearInterval(autoSaveIntervalRef.current);
        }
        if (intervalMs && intervalMs > 0) {
            autoSaveIntervalRef.current = setInterval(() => {
                if (
                    !props.isPlacingRef?.current && // Check placing state from props
                    pendingChangesRef.current?.terrain &&
                    (Object.keys(pendingChangesRef.current.terrain.added || {})
                        .length > 0 ||
                        Object.keys(
                            pendingChangesRef.current.terrain.removed || {}
                        ).length > 0)
                ) {
                    console.log(
                        `Auto-saving terrain (interval: ${intervalMs}ms)...`
                    );
                    efficientTerrainSave();
                }
            }, intervalMs);
            return true;
        } else {
            autoSaveIntervalRef.current = null; // Disable auto-save
            return false;
        }
    };

    // Update terrainRef based on toolbar import
    const updateTerrainFromToolBar = async (terrainData) => {
        loadingManager.showLoading("Starting Minecraft map import...", 0);
        terrainRef.current = terrainData || {}; // Ensure terrainRef is an object

        let newGridSize = gridSizeRef.current; // Keep current if no terrain data

        if (terrainData && Object.keys(terrainData).length > 0) {
            const totalBlocks = Object.keys(terrainData).length;
            console.log(
                `Importing Minecraft map with ${totalBlocks.toLocaleString()} blocks...`
            );
            loadingManager.updateLoading(
                `Processing ${totalBlocks.toLocaleString()} blocks...`,
                5
            );

            let minX = Infinity,
                minZ = Infinity;
            let maxX = -Infinity,
                maxZ = -Infinity;

            Object.keys(terrainData).forEach((key) => {
                const [x, , z] = key.split(",").map(Number); // Only need x, z for grid size
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minZ = Math.min(minZ, z);
                maxZ = Math.max(maxZ, z);
            });

            const width = maxX - minX + 10;
            const length = maxZ - minZ + 10;
            newGridSize = Math.ceil(Math.max(width, length) / 16) * 16;
            console.log(
                `Map dimensions: ${width}x${length}, updating grid size to ${newGridSize}`
            );
            // Update grid size ref - the visual update will happen in TerrainBuilder's useEffect
            gridSizeRef.current = newGridSize;
            props.onGridSizeUpdate?.(newGridSize); // Notify TerrainBuilder if needed
        }

        loadingManager.updateLoading(
            "Saving imported terrain to database...",
            15
        );

        if (terrainData) {
            console.log("Importing map and saving to database");
            try {
                await DatabaseManager.saveData(
                    STORES.TERRAIN,
                    "current",
                    terrainData
                );
                console.log("Imported terrain saved to database successfully");
                resetPendingChanges(); // Clear pending changes after successful import save

                loadingManager.updateLoading(
                    "Building terrain from imported blocks...",
                    30
                );

                // Trigger build update (needs buildUpdateTerrain function)
                if (buildUpdateTerrain) {
                    await buildUpdateTerrain({
                        blocks: terrainData,
                        deferMeshBuilding: true,
                    });
                } else {
                    console.error(
                        "buildUpdateTerrain function not available in TerrainDataManager"
                    );
                }

                loadingManager.updateLoading(
                    "Initializing spatial hash grid...",
                    60
                );

                // Sequence of operations
                setTimeout(async () => {
                    try {
                        // Needs initializeSpatialHash function
                        // loadingManager.updateLoading("Building spatial hash index...", 70);
                        // await initializeSpatialHash(true, false);

                        totalBlocksRef.current = Object.keys(
                            terrainRef.current
                        ).length;
                        sendTotalBlocks?.(totalBlocksRef.current);

                        loadingManager.updateLoading(
                            "Building terrain meshes...",
                            85
                        );
                        // Needs processChunkRenderQueue function
                        // processChunkRenderQueue?.();

                        loadingManager.updateLoading(
                            "Map import complete, preparing view...",
                            95
                        );
                        setTimeout(() => {
                            loadingManager.hideLoading();
                            updateDebugInfo?.(); // Needs updateDebugInfo
                            console.log("Minecraft map import complete!");
                        }, 500);
                    } catch (error) {
                        console.error(
                            "Error during map import sequence:",
                            error
                        );
                        loadingManager.hideLoading();
                    }
                }, 500);
            } catch (error) {
                console.error("Error saving imported terrain:", error);
                loadingManager.hideLoading();
            }
        } else {
            loadingManager.hideLoading();
        }
        return newGridSize; // Return the calculated grid size
    };

    // Clear the terrain
    const clearMap = async () => {
        console.log("Clearing map...");
        window.IS_DATABASE_CLEARING = true;
        try {
            terrainRef.current = {};
            totalBlocksRef.current = 0;
            sendTotalBlocks?.(0);

            // Needs clearChunks function
            // console.log("Clearing chunks from the chunk system...");
            // clearChunks?.();

            // Clear spatial grid (Needs SpatialGridManager instance/ref)
            // if (spatialGridManagerRef.current) {
            //     console.log("Clearing spatial grid manager...");
            //     spatialGridManagerRef.current.clear();
            // }

            // Clear environment objects (Needs EnvironmentBuilder ref)
            // if (environmentBuilderRef?.current?.clearEnvironments) {
            //     console.log("Clearing environment objects...");
            //     environmentBuilderRef.current.clearEnvironments();
            // }

            resetPendingChanges(); // Reset pending changes before DB clear

            // Clear undo/redo (Needs UndoRedoManager ref)
            console.log("Clearing undo/redo history in DB...");
            try {
                await DatabaseManager.saveData(STORES.UNDO, "states", []);
                await DatabaseManager.saveData(STORES.REDO, "states", []);
                console.log("Undo/redo history cleared in DB");
                if (undoRedoManager?.current?.clearHistory) {
                    undoRedoManager.current.clearHistory();
                    console.log("In-memory undo/redo history cleared");
                }
            } catch (error) {
                console.error("Failed to clear undo/redo history:", error);
            }

            updateDebugInfo?.(); // Needs updateDebugInfo

            console.log("Clearing the terrain object store in database...");
            await DatabaseManager.clearStore(STORES.TERRAIN);
            console.log("Terrain object store cleared successfully.");
            resetPendingChanges(); // Reset again just in case
            lastSaveTimeRef.current = Date.now();

            console.log("Map clear initiated successfully.");
        } catch (error) {
            console.error("Error during clearMap operation:", error);
        } finally {
            window.IS_DATABASE_CLEARING = false;
            console.log("Database clearing flag reset.");
        }
    };

    // Getter for current terrain data
    const getCurrentTerrainData = () => {
        return terrainRef.current;
    };

    // Refresh terrain from DB
    const refreshTerrainFromDB = async () => {
        console.log("=== REFRESHING TERRAIN FROM DATABASE ===");
        loadingManager.showLoading("Loading terrain data...", 0);
        try {
            loadingManager.updateLoading(
                "Retrieving blocks from database...",
                10
            );
            const blocks = await DatabaseManager.getData(
                STORES.TERRAIN,
                "current"
            );
            if (!blocks || Object.keys(blocks).length === 0) {
                console.log("No blocks found in database");
                loadingManager.hideLoading();
                return false;
            }

            const blockCount = Object.keys(blocks).length;
            console.log(`Loaded ${blockCount} blocks from database`);
            loadingManager.updateLoading(
                `Processing ${blockCount} blocks...`,
                30
            );

            // Update terrain reference
            terrainRef.current = {};
            Object.entries(blocks).forEach(([posKey, blockId]) => {
                terrainRef.current[posKey] = blockId;
            });
            totalBlocksRef.current = blockCount; // Update total blocks count

            loadingManager.updateLoading("Terrain refresh complete!", 100);
            setTimeout(() => {
                loadingManager.hideLoading();
                sendTotalBlocks?.(totalBlocksRef.current); // Update UI
                updateDebugInfo?.(); // Update debug info if function provided
            }, 300);
            return true;
        } catch (error) {
            console.error("Error in refreshTerrainFromDB:", error);
            loadingManager.hideLoading();
            return false;
        }
    };

    // Return state and functions
    return {
        terrainRef,
        totalBlocksRef,
        pendingChangesRef,
        isAutoSaveEnabledRef,
        gridSizeRef, // Expose grid size ref

        // Functions
        loadInitialTerrain,
        trackTerrainChanges,
        efficientTerrainSave,
        saveTerrainManually,
        resetPendingChanges,
        setAutoSaveEnabled,
        setAutoSaveInterval,
        updateTerrainFromToolBar,
        clearMap,
        getCurrentTerrainData,
        refreshTerrainFromDB,

        // Status getters
        isAutoSaveEnabled: () => isAutoSaveEnabledRef.current,
    };
}
