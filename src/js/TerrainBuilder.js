import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import React, {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import * as THREE from "three";
import { cameraManager } from "./Camera";
import { DatabaseManager, STORES } from "./DatabaseManager";
import { playPlaceSound } from "./Sound";
// Replace old texture atlas and chunk imports with new ones
import BlockTextureAtlas from "./blocks/BlockTextureAtlas";
import {
    clearChunks,
    getChunkSystem,
    updateTerrainBlocks as importedUpdateTerrainBlocks,
    initChunkSystem,
    processChunkRenderQueue,
    rebuildTextureAtlas,
    updateChunkSystemCamera,
    updateTerrainChunks,
} from "./chunks/TerrainBuilderIntegration";
import { meshesNeedsRefresh } from "./constants/performance";
import { loadingManager } from "./LoadingManager";

import {
    CHUNK_SIZE,
    getViewDistance,
    MAX_SELECTION_DISTANCE,
    THRESHOLD_FOR_PLACING,
} from "./constants/terrain";

// Import tools
import {
    GroundTool,
    PipeTool,
    SchematicPlacementTool,
    ToolManager,
    WallTool,
} from "./tools";
import SeedGeneratorTool from "./tools/SeedGeneratorTool"; // Add SeedGeneratorTool import

// Import chunk utility functions
import BlockMaterial from "./blocks/BlockMaterial"; // Add this import
import BlockTypeRegistry from "./blocks/BlockTypeRegistry";
import { processCustomBlock } from "./managers/BlockTypesManager";
import { SpatialGridManager } from "./managers/SpatialGridManager";

// Function to optimize rendering performance
function optimizeRenderer(gl) {
    // Optimize THREE.js renderer
    if (gl) {
        // Disable shadow auto update
        gl.shadowMap.autoUpdate = false;
        gl.shadowMap.needsUpdate = true;

        // Optimize for static scenes
        gl.sortObjects = true;

        // Don't change physically correct lights (keep default)
        // Don't set output encoding (keep default)

        // Set power preference to high-performance
        if (gl.getContextAttributes) {
            const contextAttributes = gl.getContextAttributes();
            if (contextAttributes) {
                contextAttributes.powerPreference = "high-performance";
            }
        }
    }
}

function TerrainBuilder(
    {
        onSceneReady,
        previewPositionToAppJS,
        currentBlockType,
        undoRedoManager,
        mode,
        setDebugInfo,
        sendTotalBlocks,
        axisLockEnabled,
        gridSize,
        cameraReset,
        cameraAngle,
        placementSize,
        setPageIsLoaded,
        customBlocks,
        environmentBuilderRef,
        isInputDisabled,
    },
    ref
) {
    // Spatial hash tracking
    const spatialHashUpdateQueuedRef = useRef(false);
    const spatialHashLastUpdateRef = useRef(0);
    const disableSpatialHashUpdatesRef = useRef(false); // Flag to completely disable spatial hash updates
    const deferSpatialHashUpdatesRef = useRef(false); // Flag to defer spatial hash updates during loading
    const pendingSpatialHashUpdatesRef = useRef({ added: [], removed: [] }); // Store deferred updates
    const firstLoadCompletedRef = useRef(false); // Flag to track if the first load is complete

    // Camera ref for frustum culling
    const cameraRef = useRef(null);

    // Define chunk size constant for spatial calculations
    const lastSaveTimeRef = useRef(Date.now()); // Initialize with current time to prevent immediate save on load
    const pendingChangesRef = useRef({
        terrain: {
            added: {},
            removed: {},
        },
        environment: {
            added: [],
            removed: [],
        },
    });
    const initialSaveCompleteRef = useRef(false);
    const autoSaveIntervalRef = useRef(null);
    const AUTO_SAVE_INTERVAL = 300000; // Auto-save every 5 minutes (300,000 ms)
    const isAutoSaveEnabledRef = useRef(true); // Default to enabled, but can be toggled
    const gridSizeRef = useRef(gridSize); // Add a ref to maintain grid size state

    // Setup auto-save only if enabled
    useEffect(() => {
        const setupAutoSave = () => {
            // Clear any existing interval first
            if (autoSaveIntervalRef.current) {
                clearInterval(autoSaveIntervalRef.current);
                autoSaveIntervalRef.current = null;
            }

            // Only set up the interval if auto-save is enabled
            if (isAutoSaveEnabledRef.current) {
                autoSaveIntervalRef.current = setInterval(() => {
                    // Only save if there are pending changes
                    if (
                        Object.keys(pendingChangesRef.current.terrain.added)
                            .length > 0 ||
                        Object.keys(pendingChangesRef.current.terrain.removed)
                            .length > 0
                    ) {
                        efficientTerrainSave();
                    }
                }, AUTO_SAVE_INTERVAL);
            }
        };

        // Initial setup
        setupAutoSave();

        // Cleanup on unmount
        return () => {
            if (autoSaveIntervalRef.current) {
                clearInterval(autoSaveIntervalRef.current);
            }
        };
    }, []); // Empty dependency array means this runs once on mount

    // Also save when user navigates away
    useEffect(() => {
        // Variable to track if a reload was just prevented (Cancel was clicked)
        let reloadJustPrevented = false;
        // Store the URL to detect actual navigation vs reload attempts
        const currentUrl = window.location.href;

        const handleBeforeUnload = (event) => {
            // Skip save if database is being cleared
            if (window.IS_DATABASE_CLEARING) {
                return;
            }

            // Skip if pendingChangesRef or its current property is null/undefined
            if (!pendingChangesRef || !pendingChangesRef.current) {
                return;
            }

            // Ensure we have properly structured changes before checking
            const hasTerrainChanges =
                pendingChangesRef.current.terrain &&
                (Object.keys(pendingChangesRef.current.terrain.added || {})
                    .length > 0 ||
                    Object.keys(pendingChangesRef.current.terrain.removed || {})
                        .length > 0);

            // If we have pending changes, save immediately and show warning
            if (hasTerrainChanges) {
                localStorage.setItem("reload_attempted", "true");

                // Standard way to show a confirmation dialog when closing the page
                // This works across modern browsers
                reloadJustPrevented = true;
                event.preventDefault();
                event.returnValue =
                    "You have unsaved changes. Are you sure you want to leave?";
                return event.returnValue;
            }
        };

        // This handler runs when the user navigates back/forward or after the beforeunload dialog
        const handlePopState = (event) => {
            // Check if this is after a cancel action from beforeunload
            if (reloadJustPrevented) {
                event.preventDefault();

                // Reset the flag
                reloadJustPrevented = false;

                // Restore the history state to prevent the reload
                window.history.pushState(null, document.title, currentUrl);
                return false;
            }
        };

        // Function to handle when the page is shown after being hidden
        // This can happen when user clicks Cancel on the reload prompt
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                // Check if we were in the middle of a reload attempt
                const reloadAttempted =
                    localStorage.getItem("reload_attempted") === "true";
                if (reloadAttempted) {
                    localStorage.removeItem("reload_attempted");
                    if (reloadJustPrevented) {
                        reloadJustPrevented = false;
                        // Restore history state
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

        // Set initial history state
        window.history.pushState(null, document.title, currentUrl);

        // Clear any stale reload flags
        localStorage.removeItem("reload_attempted");

        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);
            window.removeEventListener("popstate", handlePopState);
            document.removeEventListener(
                "visibilitychange",
                handleVisibilityChange
            );
        };
    }, []);

    // Track changes for incremental saves
    const trackTerrainChanges = (added = {}, removed = {}) => {
        // Skip if the database is being cleared
        if (window.IS_DATABASE_CLEARING) {
            return;
        }

        // Initialize the changes object if it doesn't exist
        if (!pendingChangesRef.current) {
            pendingChangesRef.current = {
                terrain: {
                    added: {},
                    removed: {},
                },
                environment: {
                    added: [],
                    removed: [],
                },
            };
        }

        // Ensure terrain object exists
        if (!pendingChangesRef.current.terrain) {
            pendingChangesRef.current.terrain = {
                added: {},
                removed: {},
            };
        }

        // Ensure environment object exists
        if (!pendingChangesRef.current.environment) {
            pendingChangesRef.current.environment = {
                added: [],
                removed: [],
            };
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

    // Helper function to properly reset pendingChangesRef
    const resetPendingChanges = () => {
        pendingChangesRef.current = {
            terrain: {
                added: {},
                removed: {},
            },
            environment: {
                added: [],
                removed: [],
            },
        };
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

    // Initialize the incremental terrain save system
    useEffect(() => {
        // Reset initial save flag to ensure we save a baseline
        initialSaveCompleteRef.current = false;
        // Clear pending changes
        pendingChangesRef.current = { added: {}, removed: {} };
        // Set the last save time to now to prevent immediate saving on startup
        lastSaveTimeRef.current = Date.now();

        // Attempt to load and validate terrain data
        const validateTerrain = async () => {
            try {
                const terrain = await DatabaseManager.getData(
                    STORES.TERRAIN,
                    "current"
                );
                if (terrain && Object.keys(terrain).length > 0) {
                    initialSaveCompleteRef.current = true;
                }
            } catch (err) {
                console.error("Error validating terrain data:", err);
            }
        };

        validateTerrain();
    }, []);

    // Initialize refs for environment, terrain, etc.

    // State and Refs
    // We no longer need this since we're getting scene from useThree
    // const [scene, setScene] = useState(null);
    const spatialGridManagerRef = useRef(
        new SpatialGridManager(loadingManager)
    );
    const orbitControlsRef = useRef(null);
    const frustumRef = useRef(new THREE.Frustum());
    const meshesInitializedRef = useRef(false);
    const cameraMoving = useRef(false);
    const useSpatialHashRef = useRef(true);
    const totalBlocksRef = useRef(0);

    // Scene setup
    const {
        scene,
        camera: threeCamera,
        raycaster: threeRaycaster,
        pointer,
        gl,
    } = useThree();

    // Keep a reference to the current camera that can be accessed from outside the component
    const currentCameraRef = useRef(null);

    // Update the camera reference whenever it changes
    useEffect(() => {
        if (threeCamera) {
            currentCameraRef.current = threeCamera;
            cameraRef.current = threeCamera; // Also update our camera ref for frustum culling
        }
    }, [threeCamera]);

    // Function to update chunk system with current camera and process render queue
    const updateChunkSystemWithCamera = () => {
        // Only log occasionally to avoid console spam
        const shouldLog = false; //Date.now() % 2000 < 50; // Log roughly every 2 seconds for ~50ms window

        if (!currentCameraRef.current) {
            console.error(
                "[updateChunkSystemWithCamera] Camera reference not available"
            );
            return false;
        }

        const camera = currentCameraRef.current;
        const chunkSystem = getChunkSystem();
        if (!chunkSystem) {
            console.error(
                "[updateChunkSystemWithCamera] Chunk system not available"
            );
            return false;
        }

        // Ensure camera matrices are up to date
        camera.updateMatrixWorld(true);
        camera.updateProjectionMatrix();

        // Update the camera in the chunk system
        updateChunkSystemCamera(camera);

        // Make sure view distance settings are correct
        const { getViewDistance } = require("./constants/terrain");
        const currentViewDistance = getViewDistance();

        // Ensure view distance is set and view distance culling is enabled
        chunkSystem.setViewDistance(currentViewDistance);
        chunkSystem.setViewDistanceEnabled(true);

        // Process chunks with updated camera reference
        processChunkRenderQueue();

        // Update the frustum for visibility calculations
        const projScreenMatrix = new THREE.Matrix4();
        projScreenMatrix.multiplyMatrices(
            camera.projectionMatrix,
            camera.matrixWorldInverse
        );
        const frustum = new THREE.Frustum();
        frustum.setFromProjectionMatrix(projScreenMatrix);
        frustumRef.current = frustum;

        return true;
    };

    // Add a debug function to force refresh all chunks
    const forceRefreshAllChunks = () => {
        const camera = currentCameraRef.current;
        if (!camera) {
            console.error("[Debug] No camera reference available");
            return;
        }

        const chunkSystem = getChunkSystem();
        if (!chunkSystem) {
            console.error("[Debug] No chunk system available");
            return;
        }

        // Ensure view distance settings are correct
        const { getViewDistance } = require("./constants/terrain");
        const currentViewDistance = getViewDistance();

        // Ensure camera matrices are up to date
        camera.updateMatrixWorld(true);
        camera.updateProjectionMatrix();

        // Update the frustum for visibility calculations
        const projScreenMatrix = new THREE.Matrix4();
        projScreenMatrix.multiplyMatrices(
            camera.projectionMatrix,
            camera.matrixWorldInverse
        );
        const frustum = new THREE.Frustum();
        frustum.setFromProjectionMatrix(projScreenMatrix);
        frustumRef.current = frustum;

        // Explicitly update view distance and enable culling
        chunkSystem.setViewDistance(currentViewDistance);
        chunkSystem.setViewDistanceEnabled(true);

        // Set camera in chunk system
        updateChunkSystemCamera(camera);

        // Process render queue multiple times to ensure updates are applied
        processChunkRenderQueue();
        setTimeout(() => processChunkRenderQueue(), 50);
        setTimeout(() => processChunkRenderQueue(), 100);

        return true;
    };

    // Add a new ref to track changes during placement
    const placementChangesRef = useRef({
        terrain: { added: {}, removed: {} },
        environment: { added: [], removed: [] },
    });
    const instancedMeshRef = useRef({});
    const placementStartPosition = useRef(null);
    const shadowPlaneRef = useRef();
    const directionalLightRef = useRef();
    const terrainRef = useRef({});
    const gridRef = useRef();
    const placementInitialPositionRef = useRef(null); // Add ref for initial placement position

    // Animation tracking
    const mouseMoveAnimationRef = useRef(null);

    // Refs needed for real-time updates that functions depend on
    const isPlacingRef = useRef(false);
    const currentPlacingYRef = useRef(0);
    const previewPositionRef = useRef(new THREE.Vector3());
    const rawPlacementAnchorRef = useRef(new THREE.Vector3());
    const lockedAxisRef = useRef(null);
    const selectionDistanceRef = useRef(MAX_SELECTION_DISTANCE / 2);
    const axisLockEnabledRef = useRef(axisLockEnabled);
    const currentBlockTypeRef = useRef(currentBlockType);
    const isFirstBlockRef = useRef(true);
    const modeRef = useRef(mode);
    const placementSizeRef = useRef(placementSize);
    const previewIsGroundPlaneRef = useRef(false);
    const placedBlockCountRef = useRef(0); // Track number of blocks placed during a mouse down/up cycle
    const lastDeletionTimeRef = useRef(0); // Add this ref to track the last deletion time
    const lastPlacementTimeRef = useRef(0); // Add this ref to track the last placement time

    // state for preview position to force re-render of preview cube when it changes
    const [previewPosition, setPreviewPosition] = useState(new THREE.Vector3());

    // Replace lastPlacedBlockRef with a Set to track all recently placed blocks
    const recentlyPlacedBlocksRef = useRef(new Set());

    /// references for
    const canvasRectRef = useRef(null);
    const tempVectorRef = useRef(new THREE.Vector3());

    // Add Tool Manager ref
    const toolManagerRef = useRef(null);

    // Initialize placement refs
    const mouseDownTimestampRef = useRef(0);
    const blockPlacementTimeoutRef = useRef(null);

    //* TERRAIN UPDATE FUNCTIONS *//
    //* TERRAIN UPDATE FUNCTIONS *//
    //* TERRAIN UPDATE FUNCTIONS *//
    //* TERRAIN UPDATE FUNCTIONS *//

    /**
     * Build or update the terrain mesh from the terrain data
     * @param {Object} options - Options for terrain update
     * @param {boolean} options.deferMeshBuilding - Whether to defer mesh building for distant chunks
     * @param {number} options.priorityDistance - Distance within which chunks get immediate meshes
     * @param {number} options.deferredBuildDelay - Delay in ms before building deferred chunks
     * @param {Object} options.blocks - Blocks to use (if not provided, uses terrainRef.current)
     */
    const buildUpdateTerrain = async (options = {}) => {
        console.time("buildUpdateTerrain");

        // Use provided blocks or terrainRef.current
        const useProvidedBlocks =
            options.blocks && Object.keys(options.blocks).length > 0;

        if (!useProvidedBlocks && !terrainRef.current) {
            console.error(
                "Terrain reference is not initialized and no blocks provided"
            );
            console.timeEnd("buildUpdateTerrain");
            return;
        }

        try {
            // Get terrain blocks from options or reference
            const terrainBlocks = useProvidedBlocks
                ? options.blocks
                : { ...terrainRef.current };

            // Check if terrain is empty
            if (Object.keys(terrainBlocks).length === 0) {
                console.timeEnd("buildUpdateTerrain");
                return;
            }

            // Configure chunk loading with provided options
            const deferMeshBuilding = options.deferMeshBuilding !== false;

            // Configure chunk loading behavior
            configureChunkLoading({
                deferMeshBuilding: deferMeshBuilding,
                priorityDistance: options.priorityDistance,
                deferredBuildDelay: options.deferredBuildDelay,
            });

            // If using provided blocks that aren't in terrainRef yet (like during initial load)
            // Only load directly into ChunkSystem without adding to terrainRef to prevent duplicates
            if (useProvidedBlocks) {
                // Use the chunk-based terrain system for better performance
                if (getChunkSystem() && updateTerrainChunks) {
                    console.time("updateTerrainChunks");
                    updateTerrainChunks(terrainBlocks, deferMeshBuilding);
                    console.timeEnd("updateTerrainChunks");

                    // If they aren't already in terrainRef, add them gradually for future operations
                    if (Object.keys(terrainRef.current).length === 0) {
                        // Add the blocks to terrainRef in small batches to avoid blocking the UI
                        const blockEntries = Object.entries(terrainBlocks);
                        const BATCH_SIZE = 10000;
                        const totalBatches = Math.ceil(
                            blockEntries.length / BATCH_SIZE
                        );

                        // Start adding blocks in background
                        const processBlockBatch = (startIdx, batchNum) => {
                            const endIdx = Math.min(
                                startIdx + BATCH_SIZE,
                                blockEntries.length
                            );
                            const batch = blockEntries.slice(startIdx, endIdx);

                            // Add blocks from this batch
                            batch.forEach(([posKey, blockId]) => {
                                terrainRef.current[posKey] = blockId;
                                // Also add to pendingChanges
                                pendingChangesRef.current.added[posKey] =
                                    blockId;
                            });

                            // Schedule next batch if there are more
                            if (endIdx < blockEntries.length) {
                                setTimeout(() => {
                                    processBlockBatch(endIdx, batchNum + 1);
                                }, 50); // 50ms delay to avoid blocking UI
                            }
                        };

                        // Start background processing after a short delay
                        setTimeout(() => {
                            processBlockBatch(0, 0);
                        }, 1000);
                    }
                } else {
                    console.warn(
                        "Chunk system or updateTerrainChunks not available"
                    );
                }
            } else {
                // Normal operation with terrainRef
                if (getChunkSystem() && updateTerrainChunks) {
                    console.time("updateTerrainChunks");
                    updateTerrainChunks(terrainBlocks, deferMeshBuilding);
                    console.timeEnd("updateTerrainChunks");
                } else {
                    console.warn(
                        "Chunk system or updateTerrainChunks not available"
                    );
                }
            }

            // Ensure we process the queue to show initial chunks
            if (processChunkRenderQueue) {
                processChunkRenderQueue();
            }

            console.timeEnd("buildUpdateTerrain");
        } catch (error) {
            console.error("Error building terrain:", error);
            console.timeEnd("buildUpdateTerrain");
        }
    };

    // Ultra-optimized direct block update path for drag operations
    const fastUpdateBlock = (position, blockId) => {
        // Early validation
        if (!position) return;

        // Convert to integer positions and get position key
        const x = Math.round(position[0] || position.x);
        const y = Math.round(position[1] || position.y);
        const z = Math.round(position[2] || position.z);
        const posKey = `${x},${y},${z}`;

        // Skip if no change
        if (terrainRef.current[posKey] === blockId) return;

        // For removal (blockId = 0), use a different approach
        if (blockId === 0) {
            // Skip if block doesn't exist
            if (!terrainRef.current[posKey]) return;

            // Save the original block ID for undo
            const originalBlockId = terrainRef.current[posKey];

            // Add to database tracking changes
            const removedBlocks = { [posKey]: originalBlockId };
            trackTerrainChanges({}, removedBlocks);

            // IMPORTANT: Track for undo/redo
            placementChangesRef.current.terrain.removed[posKey] =
                originalBlockId;

            // Remove from terrain
            delete terrainRef.current[posKey];
        } else {
            // Add to database tracking changes
            const addedBlocks = { [posKey]: blockId };
            trackTerrainChanges(addedBlocks, {});

            // IMPORTANT: Track for undo/redo
            placementChangesRef.current.terrain.added[posKey] = blockId;

            // Add to terrain
            terrainRef.current[posKey] = blockId;
        }

        // Update block count
        totalBlocksRef.current = Object.keys(terrainRef.current).length;

        // Direct call to chunk system for fastest performance
        if (getChunkSystem()) {
            getChunkSystem().updateBlocks(
                [
                    {
                        position: position,
                        id: blockId,
                    },
                ],
                []
            );
        }

        // Explicitly update the spatial hash for collisions
        // Format the block for updateSpatialHashForBlocks
        const blockArray = [
            {
                id: blockId,
                position: [x, y, z],
            },
        ];

        // Call with force option to ensure immediate update
        if (blockId === 0) {
            // For removal
            updateSpatialHashForBlocks([], blockArray, { force: true });
        } else {
            // For addition
            updateSpatialHashForBlocks(blockArray, [], { force: true });
        }

        // We'll update debug info and total blocks count later in bulk
    };

    /// Placement and Modification Functions ///

    // Handle pointer/mouse down
    const handleMouseDown = (e) => {
        // Check if a tool is active
        const isToolActive =
            toolManagerRef.current && toolManagerRef.current.getActiveTool();
        if (isToolActive) {
            // Get the raycast intersection to determine mouse position in 3D space
            const intersection = getRaycastIntersection();
            if (intersection) {
                // Create a synthetic mouse event with normal information
                const mouseEvent = {
                    ...e,
                    normal: intersection.normal,
                };
                // Forward to tool manager
                toolManagerRef.current.handleMouseDown(
                    mouseEvent,
                    intersection.point,
                    e.button
                );
                return;
            }
        }

        // Otherwise use default behavior for block placement
        if (e.button === 0) {
            // Only set isPlacingRef.current to true if no tool is active
            // (This check is redundant now, but kept for clarity)
            if (!isToolActive) {
                isPlacingRef.current = true;

                // Get the SNAPPED preview position for Y-lock
                const initialBlockIntersection = getRaycastIntersection();
                if (initialBlockIntersection) {
                    currentPlacingYRef.current = previewPositionRef.current.y; // Use current preview Y
                }

                // Get the RAW GROUND intersection for the initial anchor
                const groundPlane = new THREE.Plane(
                    new THREE.Vector3(0, 1, 0),
                    0
                ); // Plane at y=0
                const groundPoint = new THREE.Vector3();
                threeRaycaster.ray.intersectPlane(groundPlane, groundPoint);

                if (groundPoint) {
                    rawPlacementAnchorRef.current.copy(groundPoint);
                } else {
                    console.warn(
                        "Initial ground plane raycast failed on mousedown. Cannot set raw placement anchor."
                    );
                }

                isFirstBlockRef.current = true;

                recentlyPlacedBlocksRef.current.clear();
                placedBlockCountRef.current = 0;

                // Reset the placement changes tracker
                placementChangesRef.current = {
                    terrain: { added: {}, removed: {} },
                    environment: { added: [], removed: [] },
                };

                // Handle initial placement
                updatePreviewPosition();
                // Force an immediate block placement on mouse down
                if (isFirstBlockRef.current) {
                    handleBlockPlacement();
                }
                playPlaceSound(); // Play sound on initial click
            }
        }
    };

    const handleBlockPlacement = () => {
        // Safety check: Don't do anything if a tool is active - this avoids interfering with tool functionality
        if (toolManagerRef.current && toolManagerRef.current.getActiveTool()) {
            return;
        }

        if (!modeRef.current || !isPlacingRef.current) return;

        if (currentBlockTypeRef.current?.isEnvironment) {
            if (isFirstBlockRef.current) {
                // Call the environment builder to place the object
                if (
                    environmentBuilderRef.current &&
                    typeof environmentBuilderRef.current
                        .placeEnvironmentModel === "function"
                ) {
                    try {
                        // Pass the current mode to placeEnvironmentModel
                        const result =
                            environmentBuilderRef.current.placeEnvironmentModel(
                                modeRef.current
                            );

                        if (modeRef.current === "add" && result?.length > 0) {
                            // Track added environment objects in the placementChangesRef for undo/redo support
                            if (placementChangesRef.current) {
                                placementChangesRef.current.environment.added =
                                    [
                                        ...placementChangesRef.current
                                            .environment.added,
                                        ...result,
                                    ];
                            }
                        }
                    } catch (error) {
                        console.error(
                            "Error handling environment object:",
                            error
                        );
                    }
                } else {
                    console.error(
                        "Environment builder reference or placeEnvironmentModel function not available"
                    );
                }
            }
        } else {
            // Standard block placement
            if (modeRef.current === "add") {
                // Get current time for placement delay
                const now = performance.now();

                // Get all positions to place blocks at based on placement size
                const positions = getPlacementPositions(
                    previewPositionRef.current,
                    placementSizeRef.current
                );

                // Create new blocks
                const addedBlocks = {};
                let blockWasPlaced = false; // Flag to track if any block was actually placed

                // Check each position
                positions.forEach((pos) => {
                    const blockKey = `${pos.x},${pos.y},${pos.z}`;

                    // Don't place if block exists at this position and we're in add mode
                    if (!terrainRef.current[blockKey]) {
                        addedBlocks[blockKey] = currentBlockTypeRef.current.id;
                        terrainRef.current[blockKey] =
                            currentBlockTypeRef.current.id;

                        // Track this block to avoid removing it if we drag through
                        recentlyPlacedBlocksRef.current.add(blockKey);

                        // IMPORTANT: Track for undo/redo
                        placementChangesRef.current.terrain.added[blockKey] =
                            currentBlockTypeRef.current.id;
                        blockWasPlaced = true;
                    }
                });

                // Only update if blocks were actually placed
                if (blockWasPlaced) {
                    importedUpdateTerrainBlocks(addedBlocks, {});
                    trackTerrainChanges(addedBlocks, {}); // <<< Add this line

                    // Explicitly update the spatial hash for collisions with force option
                    const addedBlocksArray = Object.entries(addedBlocks).map(
                        ([posKey, blockId]) => {
                            const [x, y, z] = posKey.split(",").map(Number);
                            return {
                                id: blockId,
                                position: [x, y, z],
                            };
                        }
                    );

                    // Force immediate update of spatial hash for collision detection
                    if (addedBlocksArray.length > 0) {
                        updateSpatialHashForBlocks(addedBlocksArray, [], {
                            force: true,
                        });
                    }

                    // Increment the placed block counter
                    placedBlockCountRef.current +=
                        Object.keys(addedBlocks).length;

                    // Update the last placement time only if a block was placed
                    lastPlacementTimeRef.current = now;
                }
            } else if (modeRef.current === "remove") {
                // Removal logic

                // Get current time
                const now = performance.now();

                // Check if enough time has passed since the last deletion
                if (now - lastDeletionTimeRef.current < 50) {
                    // 50ms delay
                    return; // Exit if the delay hasn't passed
                }

                // Get all positions to remove blocks at based on placement size
                const positions = getPlacementPositions(
                    previewPositionRef.current,
                    placementSizeRef.current
                );

                // Track removed blocks
                const removedBlocks = {};
                let blockWasRemoved = false; // Flag to track if any block was actually removed in this call

                // Check each position
                positions.forEach((pos) => {
                    const blockKey = `${pos.x},${pos.y},${pos.z}`;

                    // Only remove if block exists at this position
                    if (terrainRef.current[blockKey]) {
                        removedBlocks[blockKey] = terrainRef.current[blockKey];
                        delete terrainRef.current[blockKey];

                        // IMPORTANT: Track for undo/redo
                        placementChangesRef.current.terrain.removed[blockKey] =
                            removedBlocks[blockKey];
                        blockWasRemoved = true;
                    }
                });

                // Only proceed if blocks were actually removed
                if (blockWasRemoved) {
                    importedUpdateTerrainBlocks({}, removedBlocks);
                    trackTerrainChanges({}, removedBlocks); // <<< Add this line

                    // Explicitly update the spatial hash for collisions with force option
                    const removedBlocksArray = Object.entries(
                        removedBlocks
                    ).map(([posKey, blockId]) => {
                        const [x, y, z] = posKey.split(",").map(Number);
                        return {
                            id: 0, // Use 0 for removed blocks
                            position: [x, y, z],
                        };
                    });

                    // Force immediate update of spatial hash for collision detection
                    if (removedBlocksArray.length > 0) {
                        updateSpatialHashForBlocks([], removedBlocksArray, {
                            force: true,
                        });
                    }

                    // Increment the placed block counter (even for removals)
                    placedBlockCountRef.current +=
                        Object.keys(removedBlocks).length;

                    // Update the last deletion time *only if* a block was removed
                    lastDeletionTimeRef.current = now;
                }
            }

            // Set flag to avoid placing at the same position again
            isFirstBlockRef.current = false;
        }
    };

    /// Raycast and Grid Intersection Functions ///
    /// Raycast and Grid Intersection Functions ///
    /// Raycast and Grid Intersection Functions ///
    /// Raycast and Grid Intersection Functions ///

    const getRaycastIntersection = () => {
        // Skip raycasting completely if scene is not ready
        if (!scene || !threeCamera || !threeRaycaster) return null;

        // Use the raw pointer coordinates directly from THREE.js
        const normalizedMouse = pointer.clone();

        // Setup raycaster with the normalized coordinates
        threeRaycaster.setFromCamera(normalizedMouse, threeCamera);

        // First, check for block collisions using optimized ray casting
        let intersection = null;

        // Safety check - ensure spatialGridManagerRef.current is initialized
        if (
            useSpatialHashRef.current &&
            spatialGridManagerRef.current &&
            spatialGridManagerRef.current.size > 0
        ) {
            // Use the optimized raycast method which now handles both block and ground plane detection
            intersection = getOptimizedRaycastIntersection(true); // Always prioritize blocks
        } else {
            // Fallback to simple ground plane detection if spatial hash is not available
            const rayOrigin = threeRaycaster.ray.origin;
            const rayDirection = threeRaycaster.ray.direction;

            // Calculate intersection with the ground plane
            const target = new THREE.Vector3();
            const intersectionDistance = rayOrigin.y / -rayDirection.y;

            // Only consider intersections in front of the camera and within selection distance
            if (
                intersectionDistance > 0 &&
                intersectionDistance < selectionDistanceRef.current
            ) {
                // Calculate the intersection point
                target
                    .copy(rayOrigin)
                    .addScaledVector(rayDirection, intersectionDistance);

                // Check if this point is within our valid grid area
                const gridSizeHalf = gridSizeRef.current / 2;
                if (
                    Math.abs(target.x) <= gridSizeHalf &&
                    Math.abs(target.z) <= gridSizeHalf
                ) {
                    // This is a hit against the ground plane within the valid build area
                    intersection = {
                        point: target.clone(),
                        normal: new THREE.Vector3(0, 1, 0), // Normal is up for ground plane
                        block: {
                            x: Math.floor(target.x),
                            y: 0,
                            z: Math.floor(target.z),
                        },
                        blockId: null, // No block here - it's the ground
                        distance: intersectionDistance,
                        isGroundPlane: true,
                    };
                }
            }
        }

        return intersection;
    };

    // Throttle mouse move updates using requestAnimationFrame
    const updatePreviewPosition = () => {
        // Skip if already being processed in this animation frame
        if (updatePreviewPosition.isProcessing) {
            return;
        }

        updatePreviewPosition.isProcessing = true;

        // Cache the canvas rect calculation
        if (!canvasRectRef.current) {
            canvasRectRef.current = gl.domElement.getBoundingClientRect();
        }

        // Get intersection for preview
        const blockIntersection = getRaycastIntersection();

        // *** Get RAW ground intersection point for threshold checking ***
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Plane at y=0
        const currentGroundPoint = new THREE.Vector3();
        // Ensure raycaster is updated (already done in getRaycastIntersection, but good practice)
        const normalizedMouse = pointer.clone();
        threeRaycaster.setFromCamera(normalizedMouse, threeCamera);
        const hitGround = threeRaycaster.ray.intersectPlane(
            groundPlane,
            currentGroundPoint
        );

        // If we have a valid intersection and mouse position:
        if (blockIntersection && blockIntersection.point) {
            // Check if a tool is active - this is important to prevent default block placement when tools are active
            const isToolActive =
                toolManagerRef.current &&
                toolManagerRef.current.getActiveTool();

            // Delegate mouse move to tool if active
            // Store the calculated SNAPPED position before applying constraints
            const potentialNewPosition = tempVectorRef.current.clone();

            // Delegate mouse move to tool if active (using blockIntersection)
            if (isToolActive) {
                const activeTool = toolManagerRef.current.getActiveTool();
                // Only call the tool's handleMouseMove if it has this method
                if (typeof activeTool.handleMouseMove === "function") {
                    // Create a synthetic mouse event using the current pointer coordinates and canvas position
                    const canvasRect = gl.domElement.getBoundingClientRect();
                    const mouseEvent = {
                        // Calculate client coordinates based on normalized pointer and canvas rect
                        clientX:
                            ((pointer.x + 1) / 2) * canvasRect.width +
                            canvasRect.left,
                        clientY:
                            ((1 - pointer.y) / 2) * canvasRect.height +
                            canvasRect.top,
                        // Add normal information from blockIntersection for proper tool positioning
                        normal: blockIntersection.normal,
                    };

                    // Call the tool's handleMouseMove
                    activeTool.handleMouseMove(
                        mouseEvent,
                        blockIntersection.point
                    );
                }
            }

            // Calculate the SNAPPED potential new position (based on blockIntersection)
            potentialNewPosition.copy(blockIntersection.point);

            // If in delete/remove mode, select the actual block, not the face
            if (modeRef.current === "delete" || modeRef.current === "remove") {
                // For delete/remove mode, use the block coordinates directly
                if (blockIntersection.block) {
                    potentialNewPosition.x = blockIntersection.block.x;
                    potentialNewPosition.y = blockIntersection.block.y;
                    potentialNewPosition.z = blockIntersection.block.z;
                } else {
                    // If no block property, use the old method as fallback
                    potentialNewPosition.x = Math.round(
                        potentialNewPosition.x -
                            blockIntersection.normal.x * 0.5
                    );
                    potentialNewPosition.y = Math.round(
                        potentialNewPosition.y -
                            blockIntersection.normal.y * 0.5
                    );
                    potentialNewPosition.z = Math.round(
                        potentialNewPosition.z -
                            blockIntersection.normal.z * 0.5
                    );
                }
            } else {
                // For add mode, calculate placement position precisely based on the face that was hit
                // First, get the block coordinates where we hit
                const hitBlock = blockIntersection.block || {
                    x: Math.floor(blockIntersection.point.x),
                    y: Math.floor(blockIntersection.point.y),
                    z: Math.floor(blockIntersection.point.z),
                };

                // Use the face information if available for more precise placement
                if (blockIntersection.face && blockIntersection.normal) {
                    // Position the new block adjacent to the face that was hit
                    // By adding the normal vector, we place the block directly against the hit face
                    potentialNewPosition.x =
                        hitBlock.x + blockIntersection.normal.x;
                    potentialNewPosition.y =
                        hitBlock.y + blockIntersection.normal.y;
                    potentialNewPosition.z =
                        hitBlock.z + blockIntersection.normal.z;

                    // Ensure we have integer coordinates for block placement
                    potentialNewPosition.x = Math.round(potentialNewPosition.x);
                    potentialNewPosition.y = Math.round(potentialNewPosition.y);
                    potentialNewPosition.z = Math.round(potentialNewPosition.z);

                    // Log face detection for debugging
                } else {
                    // Fallback to the old method if face information is not available
                    potentialNewPosition.add(
                        blockIntersection.normal.clone().multiplyScalar(0.5)
                    );
                    potentialNewPosition.x = Math.round(potentialNewPosition.x);
                    potentialNewPosition.y = Math.round(potentialNewPosition.y);
                    potentialNewPosition.z = Math.round(potentialNewPosition.z);
                }

                // Handle y-coordinate special case if this is a ground plane hit
                if (
                    blockIntersection.isGroundPlane &&
                    modeRef.current === "add"
                ) {
                    potentialNewPosition.y = 0; // Position at y=0 when placing on ground plane
                }

                // Apply axis lock if enabled
                if (axisLockEnabledRef.current) {
                    // Keep only movement along the selected axis
                    const originalPos = previewPositionRef.current.clone();
                    const axisLock = lockedAxisRef.current;

                    if (axisLock === "x") {
                        potentialNewPosition.y = originalPos.y;
                        potentialNewPosition.z = originalPos.z;
                    } else if (axisLock === "y") {
                        potentialNewPosition.x = originalPos.x;
                        potentialNewPosition.z = originalPos.z;
                    } else if (axisLock === "z") {
                        potentialNewPosition.x = originalPos.x;
                        potentialNewPosition.y = originalPos.y;
                    }
                }
            }

            // --- Start: Placement Constraints Logic (Using Raw Ground Intersection) ---
            let shouldUpdatePreview = true;
            let thresholdMet = false; // Flag to track if raw ground threshold was met

            if (isPlacingRef.current && !isToolActive) {
                // Use the RAW GROUND intersection point for distance check
                if (hitGround && rawPlacementAnchorRef.current) {
                    const groundDistanceMoved = currentGroundPoint.distanceTo(
                        rawPlacementAnchorRef.current
                    );

                    // Check if this is the first block placement after mouse down
                    if (isFirstBlockRef.current) {
                        // For the first block, bypass the threshold check and always place
                        shouldUpdatePreview = true;
                        thresholdMet = true; // Mark that we're forcing the placement
                        // Lock the Y-coordinate of the SNAPPED position
                        potentialNewPosition.y = currentPlacingYRef.current;
                    } else {
                        // After first block, apply normal threshold logic
                        // Optional: Log ground distance check
                        if (groundDistanceMoved < THRESHOLD_FOR_PLACING) {
                            // Raw ground projection hasn't moved enough since last placement trigger.
                            shouldUpdatePreview = false;
                        } else {
                            // Raw ground distance threshold met: Allow preview update and placement.
                            shouldUpdatePreview = true;
                            thresholdMet = true; // Mark that we passed the raw ground check
                            // Lock the Y-coordinate of the SNAPPED position
                            potentialNewPosition.y = currentPlacingYRef.current;
                            // Ground anchor update happens *after* successful preview update below
                        }
                    }
                } else {
                    // Cannot perform check if anchor or current ground point is missing
                    shouldUpdatePreview = false;
                    console.warn(
                        "Missing raw ground anchor or ground intersection point for threshold check."
                    );
                }
            }

            // --- End: Placement Constraints Logic (Using Raw Ground Intersection) ---

            // CRITICAL: Update the SNAPPED preview position only if allowed
            if (
                shouldUpdatePreview &&
                previewPositionRef &&
                previewPositionRef.current
            ) {
                previewPositionRef.current.copy(potentialNewPosition); // Update internal ref with SNAPPED pos
                setPreviewPosition(potentialNewPosition.clone()); // Update React state for preview rendering
                if (previewPositionToAppJS) {
                    previewPositionToAppJS(potentialNewPosition.clone());
                }

                // *** NEW: Update the RAW GROUND anchor point IF the raw threshold was met ***
                if (
                    isPlacingRef.current &&
                    !isToolActive &&
                    thresholdMet &&
                    hitGround
                ) {
                    rawPlacementAnchorRef.current.copy(currentGroundPoint); // Reset the raw ground anchor
                }
            }

            // Only call handleBlockPlacement if placing, NOT using a tool, and allowed to update preview (threshold met)
            if (isPlacingRef.current && !isToolActive && shouldUpdatePreview) {
                handleBlockPlacement();
            }
        }

        // Reset processing flag at the end of the frame
        updatePreviewPosition.isProcessing = false;
    };

    // Initialize the flag
    updatePreviewPosition.isProcessing = false;

    // Move undo state saving to handlePointerUp
    const handleMouseUp = (e) => {
        // Performance tracking
        const t0 = performance.now();

        // Check if a tool is active and forward the event
        const isToolActive =
            toolManagerRef.current && toolManagerRef.current.getActiveTool();
        if (isToolActive) {
            const intersection = getRaycastIntersection();
            if (intersection) {
                // Create a synthetic mouse event with normal information
                const mouseEvent = {
                    ...e,
                    normal: intersection.normal,
                };
                // Forward to tool manager with button parameter
                toolManagerRef.current.handleMouseUp(
                    mouseEvent,
                    intersection.point,
                    e.button
                );
                // **** ADDED: Explicitly return AFTER tool handles the event ****
                return;
            }
        }

        // --- Only run the following default logic if NO tool was active ---

        // Only process if we were actually placing blocks (default placement)
        if (isPlacingRef.current) {
            // Stop placing blocks
            isPlacingRef.current = false;

            // Only update the spatial grid if blocks were placed
            if (placedBlockCountRef.current > 0) {
                // Update only the newly placed blocks instead of rebuilding entire grid
                if (spatialGridManagerRef.current) {
                    // Use the recently placed blocks array directly
                    const addedBlocks = Array.from(
                        recentlyPlacedBlocksRef.current
                    ).map((posKey) => {
                        return [posKey, terrainRef.current[posKey]];
                    });

                    // Update spatial grid with just these blocks
                    spatialGridManagerRef.current.updateBlocks(addedBlocks, []);
                }

                // Save changes to undo stack if there are any changes
                if (
                    placementChangesRef.current &&
                    (Object.keys(
                        placementChangesRef.current.terrain.added || {}
                    ).length > 0 ||
                        Object.keys(
                            placementChangesRef.current.terrain.removed || {}
                        ).length > 0 ||
                        (placementChangesRef.current.environment.added || [])
                            .length > 0 ||
                        (placementChangesRef.current.environment.removed || [])
                            .length > 0)
                ) {
                    // Try direct undoRedoManager.current access
                    if (undoRedoManager?.current?.saveUndo) {
                        undoRedoManager.current.saveUndo(
                            placementChangesRef.current
                        );
                    }
                    // Final fallback - check if we can access it another way
                    else {
                        console.warn(
                            "No direct access to saveUndo function, trying fallbacks"
                        );
                        // Try to use any available reference as last resort
                        const tempRef = ref?.current;
                        if (
                            tempRef &&
                            tempRef.undoRedoManager &&
                            tempRef.undoRedoManager.current &&
                            tempRef.undoRedoManager.current.saveUndo
                        ) {
                            tempRef.undoRedoManager.current.saveUndo(
                                placementChangesRef.current
                            );
                        } else {
                            console.error(
                                "Could not find a way to save undo state, changes won't be tracked for undo/redo"
                            );
                        }
                    }
                }
                // Reset the block counter
                placedBlockCountRef.current = 0;
            }
            // Clear recently placed blocks
            recentlyPlacedBlocksRef.current.clear();
        }
    };

    const getPlacementPositions = (centerPos, placementSize) => {
        const positions = [];

        // Always include center position
        positions.push({ ...centerPos });

        switch (placementSize) {
            default:
            case "single":
                break;
        }

        return positions;
    };

    const getCurrentTerrainData = () => {
        return terrainRef.current;
    };

    const determineLockedAxis = (currentPos) => {
        if (!placementStartPosition.current || !axisLockEnabledRef.current)
            return null;

        const xDiff = Math.abs(currentPos.x - placementStartPosition.current.x);
        const zDiff = Math.abs(currentPos.z - placementStartPosition.current.z);

        // Only lock axis if we've moved enough to determine direction
        // and one axis has significantly more movement than the other
        if (Math.max(xDiff, zDiff) > THRESHOLD_FOR_PLACING) {
            // Require one axis to have at least 50% more movement than the other
            if (xDiff > zDiff * 1.5) {
                return "x";
            } else if (zDiff > xDiff * 1.5) {
                return "z";
            }
        }
        return null;
    };

    const updateTerrainFromToolBar = (terrainData) => {
        // Show initial loading screen with clear message
        loadingManager.showLoading("Starting Minecraft map import...", 0);

        // Set terrain data immediately
        terrainRef.current = terrainData;

        // Calculate grid size from terrain dimensions
        if (terrainData && Object.keys(terrainData).length > 0) {
            const totalBlocks = Object.keys(terrainData).length;
            loadingManager.updateLoading(
                `Processing ${totalBlocks.toLocaleString()} blocks...`,
                5
            );

            // Find the min/max coordinates
            let minX = Infinity,
                minZ = Infinity;
            let maxX = -Infinity,
                maxZ = -Infinity;

            Object.keys(terrainData).forEach((key) => {
                const [x, y, z] = key.split(",").map(Number);
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minZ = Math.min(minZ, z);
                maxZ = Math.max(maxZ, z);
            });

            // Calculate width and length (adding a small margin)
            const width = maxX - minX + 10;
            const length = maxZ - minZ + 10;

            // Use the larger dimension for the grid size (rounded up to nearest multiple of 16)
            const gridSize = Math.ceil(Math.max(width, length) / 16) * 16;

            // Update the grid size
            updateGridSize(gridSize);
        }

        // Update loading screen to show database saving progress
        loadingManager.updateLoading(
            "Saving imported terrain to database...",
            15
        );

        // For imports, we'll save to database immediately and not mark as unsaved
        if (terrainData) {
            // First save to database
            DatabaseManager.saveData(STORES.TERRAIN, "current", terrainData)
                .then(() => {
                    // Clear any pending changes to prevent unsaved changes warning
                    pendingChangesRef.current = {
                        terrain: { added: {}, removed: {} },
                        environment: { added: [], removed: [] },
                    };

                    // Update loading screen after database save is complete
                    loadingManager.updateLoading(
                        "Building terrain from imported blocks...",
                        30
                    );

                    // Configure for bulk loading for better performance
                    configureChunkLoading({
                        deferMeshBuilding: true,
                        priorityDistance: 48,
                        deferredBuildDelay: 5000,
                    });

                    // Set bulk loading mode to optimize for large terrain loads
                    if (getChunkSystem()) {
                        getChunkSystem().setBulkLoadingMode(true, 48);
                    }

                    // Build the terrain with the provided blocks
                    buildUpdateTerrain({
                        blocks: terrainData,
                        deferMeshBuilding: true,
                    });

                    // Update loading screen to show spatial hash initialization
                    loadingManager.updateLoading(
                        "Initializing spatial hash grid...",
                        60
                    );

                    // Create a sequence of operations with proper loading screen updates
                    setTimeout(async () => {
                        try {
                            // Initialize spatial hash (all blocks, not just visible ones)
                            loadingManager.updateLoading(
                                "Building spatial hash index...",
                                70
                            );
                            await initializeSpatialHash(true, false);

                            // Update total block count
                            totalBlocksRef.current = Object.keys(
                                terrainRef.current
                            ).length;
                            if (sendTotalBlocks) {
                                sendTotalBlocks(totalBlocksRef.current);
                            }

                            // Update loading screen for final rendering
                            loadingManager.updateLoading(
                                "Building terrain meshes...",
                                85
                            );

                            // Process render queue to update visible chunks
                            processChunkRenderQueue();

                            // Final update before hiding
                            loadingManager.updateLoading(
                                "Map import complete, preparing view...",
                                95
                            );

                            // Add a small delay to ensure the UI updates before hiding the loading screen
                            setTimeout(() => {
                                // Hide loading screen
                                loadingManager.hideLoading();
                                // Update debug info
                                updateDebugInfo();
                            }, 500);
                        } catch (error) {
                            console.error("Error during map import:", error);
                            loadingManager.hideLoading();
                        }
                    }, 500);
                })
                .catch((error) => {
                    console.error("Error saving imported terrain:", error);
                    loadingManager.hideLoading();
                });
        } else {
            // No terrain data provided, just hide loading screen
            loadingManager.hideLoading();
        }
    };

    // Update
    const updateGridSize = (newGridSize) => {
        if (gridRef.current) {
            // If newGridSize is provided, use it and update localStorage
            // Otherwise, get grid size from localStorage
            let gridSizeToUse;

            if (newGridSize) {
                gridSizeToUse = newGridSize;
                // Update localStorage with the new value
                localStorage.setItem("gridSize", gridSizeToUse.toString());
            } else {
                gridSizeToUse =
                    parseInt(localStorage.getItem("gridSize"), 10) || 200; // Default to 200
            }

            // Update the gridSizeRef to maintain current grid size value
            gridSizeRef.current = gridSizeToUse;

            if (gridRef.current.geometry) {
                gridRef.current.geometry.dispose();
                gridRef.current.geometry = new THREE.GridHelper(
                    gridSizeToUse,
                    gridSizeToUse,
                    0x5c5c5c,
                    0xeafaea
                ).geometry;
                gridRef.current.material.opacity = 0.1;
                gridRef.current.position.set(0.5, -0.5, 0.5);
            }

            if (shadowPlaneRef.current.geometry) {
                shadowPlaneRef.current.geometry.dispose();
                shadowPlaneRef.current.geometry = new THREE.PlaneGeometry(
                    gridSizeToUse,
                    gridSizeToUse
                );
                shadowPlaneRef.current.position.set(0.5, -0.5, 0.5);
            }
        }
    };

    const updateDebugInfo = () => {
        setDebugInfo({
            preview: previewPositionRef.current,
            totalBlocks: totalBlocksRef.current,
            isGroundPlane: previewIsGroundPlaneRef.current,
        });

        // Send total blocks to App component
        if (sendTotalBlocks) {
            sendTotalBlocks(totalBlocksRef.current);
        }
    };

    // Clear the terrain
    const clearMap = () => {
        // Set database clearing flag to prevent other operations during clear
        window.IS_DATABASE_CLEARING = true;

        try {
            // Remove all blocks from the terrain object
            terrainRef.current = {};
            totalBlocksRef.current = 0;

            // Send total blocks count to parent component
            if (sendTotalBlocks) {
                sendTotalBlocks(0);
            }

            // Clear all chunks from the system
            clearChunks();

            // Clear spatial grid for raycasting
            if (spatialGridManagerRef.current) {
                spatialGridManagerRef.current.clear();
                firstLoadCompletedRef.current = false; // Reset spatial hash init flag
            }

            // Clear environment objects
            if (environmentBuilderRef?.current?.clearEnvironments) {
                environmentBuilderRef.current.clearEnvironments(); // Should also handle its own DB persistence
            }

            // Reset placement state
            isPlacingRef.current = false;
            recentlyPlacedBlocksRef.current = new Set();

            // IMPORTANT: Clear pending changes *before* clearing the database
            resetPendingChanges(); // Reset all pending changes first

            // Clear undo/redo stacks in the database
            const clearUndoRedo = async () => {
                try {
                    await DatabaseManager.saveData(STORES.UNDO, "states", []);
                    await DatabaseManager.saveData(STORES.REDO, "states", []);
                    // Optionally, reset in-memory state if the manager holds it
                    if (undoRedoManager?.current?.clearHistory) {
                        undoRedoManager.current.clearHistory();
                    }
                } catch (error) {
                    console.error("Failed to clear undo/redo history:", error);
                    // Don't stop the whole clear process for this
                }
            };
            clearUndoRedo(); // Call async clear

            // Update debug info
            updateDebugInfo();

            // Clear the entire TERRAIN object store in the database
            DatabaseManager.clearStore(STORES.TERRAIN)
                .then(() => {
                    // Reset pending changes again just in case something happened between the last reset and now
                    resetPendingChanges();
                    lastSaveTimeRef.current = Date.now(); // Update last save time
                })
                .catch((error) => {
                    console.error("Error clearing terrain store:", error);
                    // Handle error appropriately, maybe alert user
                });
        } catch (error) {
            console.error("Error during clearMap operation:", error);
            // Handle error (e.g., show alert)
        } finally {
            // Ensure the flag is always reset
            window.IS_DATABASE_CLEARING = false;
        }
    };

    // Function to initialize spatial hash once after map is loaded
    const initializeSpatialHash = async (
        forceUpdate = false,
        visibleOnly = false
    ) => {
        if (!forceUpdate && firstLoadCompletedRef.current) {
            return Promise.resolve();
        }

        if (!spatialGridManagerRef.current) {
            console.error(
                "Cannot initialize spatial hash: manager not initialized"
            );
            return Promise.resolve();
        }

        // If using visible only mode, filter blocks to those in visible chunks
        if (visibleOnly && terrainRef.current) {
            const chunkSystem = getChunkSystem();

            if (chunkSystem && chunkSystem._scene.camera) {
                const camera = chunkSystem._scene.camera;
                const cameraPos = camera.position;
                const viewDistance = getViewDistance() || 64;

                // Create a reduced set of blocks for the spatial hash
                const visibleBlocks = {};
                let totalBlocks = 0;
                let visibleBlockCount = 0;

                // Helper to get chunk origin from position
                const getChunkOrigin = (pos) => {
                    const [x, y, z] = pos.split(",").map(Number);
                    const chunkSize = CHUNK_SIZE;
                    return {
                        x: Math.floor(x / chunkSize) * chunkSize,
                        y: Math.floor(y / chunkSize) * chunkSize,
                        z: Math.floor(z / chunkSize) * chunkSize,
                    };
                };

                // Iterate through all blocks
                Object.entries(terrainRef.current).forEach(
                    ([posKey, blockId]) => {
                        totalBlocks++;

                        // Get the chunk origin for this block
                        const origin = getChunkOrigin(posKey);

                        // Calculate distance from chunk center to camera
                        const distance = Math.sqrt(
                            Math.pow(
                                origin.x + CHUNK_SIZE / 2 - cameraPos.x,
                                2
                            ) +
                                Math.pow(
                                    origin.y + CHUNK_SIZE / 2 - cameraPos.y,
                                    2
                                ) +
                                Math.pow(
                                    origin.z + CHUNK_SIZE / 2 - cameraPos.z,
                                    2
                                )
                        );

                        // Only include blocks in visible chunks
                        if (distance <= viewDistance) {
                            visibleBlocks[posKey] = blockId;
                            visibleBlockCount++;
                        }
                    }
                );

                // Update with filtered blocks
                spatialGridManagerRef.current.updateFromTerrain(visibleBlocks);

                // Schedule a full update later
                setTimeout(() => {
                    if (spatialGridManagerRef.current) {
                        spatialGridManagerRef.current.updateFromTerrain(
                            terrainRef.current
                        );
                    }
                }, 10000); // 10 seconds later

                return Promise.resolve();
            }
        }

        try {
            await spatialGridManagerRef.current.updateFromTerrain(
                terrainRef.current
            );
        } catch (error) {
            console.error("Error initializing spatial hash:", error);
        }

        // Mark first load as completed
        firstLoadCompletedRef.current = true;

        return Promise.resolve();
    };

    // Update mousemove effect to use requestAnimationFrame
    useEffect(() => {
        const handleMouseMove = () => {
            // Cancel any existing animation frame
            if (mouseMoveAnimationRef.current) {
                cancelAnimationFrame(mouseMoveAnimationRef.current);
            }
            // Request new animation frame
            mouseMoveAnimationRef.current = requestAnimationFrame(
                updatePreviewPosition
            );
        };

        window.addEventListener("mousemove", handleMouseMove);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            // Clean up animation on unmount
            if (mouseMoveAnimationRef.current) {
                cancelAnimationFrame(mouseMoveAnimationRef.current);
                mouseMoveAnimationRef.current = null;
            }
        };
    }, []);

    // Define camera reset effects and axis lock effects
    useEffect(() => {
        if (cameraReset) {
            cameraManager.resetCamera();
        }
    }, [cameraReset]);

    useEffect(() => {
        cameraManager.handleSliderChange(cameraAngle);
    }, [cameraAngle]);

    useEffect(() => {
        axisLockEnabledRef.current = axisLockEnabled;
    }, [axisLockEnabled]);

    // effect to update grid size
    useEffect(() => {
        updateGridSize(gridSize);
    }, [gridSize]);

    // Add this effect to disable frustum culling
    useEffect(() => {
        // Disable frustum culling on camera
        if (threeCamera) {
            threeCamera.frustumCulled = false;
        }

        // Disable frustum culling on all scene objects
        if (scene) {
            scene.traverse((object) => {
                if (object.isMesh || object.isInstancedMesh) {
                    object.frustumCulled = false;
                }
            });
        }
    }, [threeCamera, scene]);

    // Initialize instanced meshes and load terrain from IndexedDB
    useEffect(() => {
        let mounted = true;

        function initialize() {
            // Initialize camera manager with camera and controls
            if (threeCamera && orbitControlsRef.current) {
                cameraManager.initialize(threeCamera, orbitControlsRef.current);

                // Add direct change event listener for camera movement
                // This ensures view distance culling updates when using orbit controls
                orbitControlsRef.current.addEventListener("change", () => {
                    // Trigger camera movement handling
                    handleCameraMove();
                });
            }

            // Load skybox
            const loader = new THREE.CubeTextureLoader();
            loader.setPath("./assets/skyboxes/partly-cloudy/");
            const textureCube = loader.load([
                "+x.png",
                "-x.png",
                "+y.png",
                "-y.png",
                "+z.png",
                "-z.png",
            ]);
            if (scene) {
                scene.background = textureCube;
            }

            // Initialize the new chunk system instead of the texture atlas
            if (scene) {
                // Initialize the chunk system with the scene and view distance
                initChunkSystem(scene, {
                    viewDistance: getViewDistance(),
                    viewDistanceEnabled: true,
                }).catch((error) => {
                    console.error("Error initializing chunk system:", error);
                });
            }

            meshesInitializedRef.current = true;

            // Load custom blocks from IndexedDB
            DatabaseManager.getData(STORES.CUSTOM_BLOCKS, "blocks")
                .then((customBlocksData) => {
                    if (customBlocksData && customBlocksData.length > 0) {
                        /// loop through all the custom blocks and process them
                        for (const block of customBlocksData) {
                            processCustomBlock(block);
                        }

                        // Notify the app that custom blocks were loaded
                        window.dispatchEvent(
                            new CustomEvent("custom-blocks-loaded", {
                                detail: { blocks: customBlocksData },
                            })
                        );
                    }

                    // Load terrain from IndexedDB
                    return DatabaseManager.getData(STORES.TERRAIN, "current");
                })
                .then((savedTerrain) => {
                    if (!mounted) return;

                    if (savedTerrain) {
                        terrainRef.current = savedTerrain;

                        totalBlocksRef.current = Object.keys(
                            terrainRef.current
                        ).length;

                        // Don't mark loaded terrain as having unsaved changes
                        pendingChangesRef.current = { added: {}, removed: {} };

                        // Show a loading message while we preload all textures
                        loadingManager.showLoading(
                            "Preloading textures for all blocks..."
                        );

                        // Preload textures for all block types actually used in the terrain
                        setTimeout(async () => {
                            try {
                                // Create a set of unique block IDs used in the terrain
                                const usedBlockIds = new Set();
                                Object.values(terrainRef.current).forEach(
                                    (blockId) => {
                                        usedBlockIds.add(parseInt(blockId));
                                    }
                                );

                                // Mark each used block type as essential to ensure its textures are loaded
                                usedBlockIds.forEach((blockId) => {
                                    if (
                                        BlockTypeRegistry &&
                                        BlockTypeRegistry.instance
                                    ) {
                                        BlockTypeRegistry.instance.markBlockTypeAsEssential(
                                            blockId
                                        );
                                    }
                                });

                                // Force a reload of ALL block textures, not just the ones in the terrain
                                // This ensures a complete texture atlas
                                if (
                                    BlockTypeRegistry &&
                                    BlockTypeRegistry.instance
                                ) {
                                    await BlockTypeRegistry.instance.preload();
                                }

                                // Now force a complete texture atlas rebuild to ensure all textures are available
                                await rebuildTextureAtlas();

                                // Update the chunk system with the loaded terrain only AFTER textures are loaded
                                updateTerrainChunks(terrainRef.current, true); // Set true to only load visible chunks

                                // Process chunks to ensure everything is visible
                                processChunkRenderQueue();

                                // Store all terrain data in a separate reference for incremental loading
                                // This will be used to load additional chunks as the camera moves
                                window.fullTerrainDataRef = terrainRef.current;

                                // Add a new "pendingChunksToLoad" state to track chunks that need loading
                                window.pendingChunksToLoad = new Set();

                                // Hide loading screen
                                loadingManager.hideLoading();

                                // Set page as loaded
                                setPageIsLoaded(true);
                            } catch (error) {
                                console.error(
                                    "Error preloading textures:",
                                    error
                                );
                                console.warn(
                                    "[Load] Error during texture preload, proceeding with terrain update."
                                ); // <<< Add log
                                updateTerrainChunks(terrainRef.current);
                                loadingManager.hideLoading();
                                setPageIsLoaded(true);
                            }
                        }, 100);
                    } else {
                        terrainRef.current = {};
                        totalBlocksRef.current = 0;
                    }

                    setPageIsLoaded(true);
                })
                .catch((error) => {
                    console.error(
                        "Error loading terrain or custom blocks:",
                        error
                    );
                    meshesInitializedRef.current = true;
                    setPageIsLoaded(true);
                });
        }

        // Initialize the tool manager with all the properties tools might need
        const terrainBuilderProps = {
            scene,
            terrainRef: terrainRef,
            currentBlockTypeRef: currentBlockTypeRef,
            previewPositionRef: previewPositionRef,
            terrainBuilderRef: ref, // Add a reference to this component
            undoRedoManager: undoRedoManager, // Pass undoRedoManager directly without wrapping
            placementChangesRef: placementChangesRef, // Add placement changes ref for tracking undo/redo
            isPlacingRef: isPlacingRef, // Add placing state ref
            modeRef, // Add mode reference for add/remove functionality
            getPlacementPositions, // Share position calculation utility
            importedUpdateTerrainBlocks, // Direct access to optimized terrain update function
            updateSpatialHashForBlocks, // Direct access to spatial hash update function
            updateTerrainForUndoRedo, // <<< Add this function explicitly
            totalBlocksRef, // Provide access to the total block count ref
            sendTotalBlocks, // Provide the function to update the total block count in the UI
            // Add the activateTool function so tools can switch context
            activateTool: (toolName, activationData) =>
                toolManagerRef.current?.activateTool(toolName, activationData),
            // Add any other properties tools might need
        };

        toolManagerRef.current = new ToolManager(terrainBuilderProps);

        // Register tools
        const wallTool = new WallTool(terrainBuilderProps);
        toolManagerRef.current.registerTool("wall", wallTool);

        // Register the new GroundTool
        const groundTool = new GroundTool(terrainBuilderProps);
        toolManagerRef.current.registerTool("ground", groundTool);

        // Register the new PipeTool
        const pipeTool = new PipeTool(terrainBuilderProps);
        toolManagerRef.current.registerTool("pipe", pipeTool);

        // Register the new SeedGeneratorTool
        const seedGeneratorTool = new SeedGeneratorTool(terrainBuilderProps);
        toolManagerRef.current.registerTool("seed", seedGeneratorTool);

        // Register the new SchematicPlacementTool
        const schematicPlacementTool = new SchematicPlacementTool(
            terrainBuilderProps
        );
        toolManagerRef.current.registerTool(
            "schematic",
            schematicPlacementTool
        );

        initialize();

        // Add at the end of the initialize() function, right before the final closing bracket
        // Also register a keydown event listener to detect WASD movement
        window.addEventListener("keydown", (event) => {
            // For WASD/arrow keys movement, also trigger chunk loading

            if (!event.key) return;
            const key = event.key.toLowerCase();
            if (
                [
                    "w",
                    "a",
                    "s",
                    "d",
                    "arrowup",
                    "arrowleft",
                    "arrowdown",
                    "arrowright",
                ].includes(key)
            ) {
                // Throttle calls during continuous movement
                if (
                    !window.lastKeyMoveTime ||
                    Date.now() - window.lastKeyMoveTime > 200
                ) {
                    handleCameraMove();
                    window.lastKeyMoveTime = Date.now();
                }
            }
        });

        // Set up periodic check for chunks to load, even if camera isn't moving
        // This ensures chunks eventually load even without camera movement
        window.chunkLoadCheckInterval = setInterval(() => {
            if (
                window.fullTerrainDataRef &&
                terrainRef.current &&
                Object.keys(window.fullTerrainDataRef).length >
                    Object.keys(terrainRef.current).length
            ) {
                loadNewChunksInViewDistance();
            } else if (
                window.fullTerrainDataRef &&
                terrainRef.current &&
                Object.keys(window.fullTerrainDataRef).length ===
                    Object.keys(terrainRef.current).length
            ) {
                // All chunks loaded, clear the interval
                clearInterval(window.chunkLoadCheckInterval);
            }
        }, 3000); // Check every 3 seconds

        // Return cleanup function
        return () => {
            mounted = false;

            // Clean up any chunk-related timers
            if (window.chunkLoadCheckInterval) {
                clearInterval(window.chunkLoadCheckInterval);
                window.chunkLoadCheckInterval = null;
            }
        };
    }, [threeCamera, scene]);

    // Add effect to update tools with undoRedoManager when it becomes available - at the top level of the component
    useEffect(() => {
        if (undoRedoManager?.current && toolManagerRef.current) {
            try {
                Object.values(toolManagerRef.current.tools).forEach((tool) => {
                    if (tool) {
                        // Pass the undoRedoManager ref to each tool
                        tool.undoRedoManager = undoRedoManager;
                        const toolGotManager =
                            tool.undoRedoManager === undoRedoManager;
                    }
                });
            } catch (error) {
                console.error(
                    "TerrainBuilder: Error updating tools with undoRedoManager:",
                    error
                );
            }
        } else {
            if (!undoRedoManager?.current) {
                console.warn(
                    "TerrainBuilder: undoRedoManager.current is not available yet"
                );
            }
            if (!toolManagerRef.current) {
                console.warn(
                    "TerrainBuilder: toolManagerRef.current is not available yet"
                );
            }
        }
    }, [undoRedoManager?.current]);

    // Cleanup effect that cleans up meshes when component unmounts
    useEffect(() => {
        // Capture the current value of the ref when the effect runs
        const currentInstancedMeshes = instancedMeshRef.current;

        return () => {
            // Cleanup meshes when component unmounts, using the captured value
            if (currentInstancedMeshes) {
                Object.values(currentInstancedMeshes).forEach((mesh) => {
                    if (mesh) {
                        scene.remove(mesh);
                        if (mesh.geometry) mesh.geometry.dispose();
                        if (Array.isArray(mesh.material)) {
                            mesh.material.forEach((m) => m?.dispose());
                        } else if (mesh.material) {
                            mesh.material.dispose();
                        }
                    }
                });
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scene]); // Can't include safeRemoveFromScene due to function order

    // effect to refresh meshes when the meshesNeedsRefresh flag is true
    useEffect(() => {
        if (meshesNeedsRefresh.value) {
            buildUpdateTerrain();
            meshesNeedsRefresh.value = false;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [meshesNeedsRefresh.value]); // Use meshesNeedsRefresh.value in the dependency array

    // effect to update current block type reference when the prop changes
    useEffect(() => {
        currentBlockTypeRef.current = currentBlockType;
    }, [currentBlockType]);

    // Add this effect to update the mode ref when the prop changes
    useEffect(() => {
        modeRef.current = mode;
    }, [mode]);

    // Add this effect to update the ref when placementSize changes
    useEffect(() => {
        placementSizeRef.current = placementSize;
    }, [placementSize]);

    // Add this effect to listen for texture atlas updates
    useEffect(() => {
        if (!scene || !gl) return;

        const handleTextureAtlasUpdate = (event) => {
            // Force update all materials
            scene.traverse((object) => {
                if (object.isMesh && object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach((mat) => {
                            if (mat.map) mat.needsUpdate = true;
                        });
                    } else if (object.material.map) {
                        object.material.needsUpdate = true;
                    }
                }
            });

            // Force a render
            gl.render(scene, threeCamera);

            // Update chunk visibility to force mesh updates
            if (getChunkSystem()) {
                getChunkSystem().forceUpdateChunkVisibility(); // Changed from forceUpdateAllChunkVisibility
                // Also force processing the render queue
                getChunkSystem().processRenderQueue(true);
            }

            // Make sure total block count is updated in the performance metrics
            totalBlocksRef.current = Object.keys(terrainRef.current).length;
            if (sendTotalBlocks) {
                sendTotalBlocks(totalBlocksRef.current);
            }

            // Update debug info
            updateDebugInfo();
        };

        // Add event listener
        window.addEventListener(
            "textureAtlasUpdated",
            handleTextureAtlasUpdate
        );

        // Cleanup function
        return () => {
            window.removeEventListener(
                "textureAtlasUpdated",
                handleTextureAtlasUpdate
            );
        };
    }, [scene, gl, threeCamera]);

    /*
	/// build update terrain when the terrain state changes
	useEffect(() => {
		buildUpdateTerrain();
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [terrainRef.current]); // terrainRef.current is a mutable object, react-hooks/exhaustive-deps warning is expected
*/
    /// onSceneReady send the scene to App.js via a setter
    useEffect(() => {
        if (scene && onSceneReady) {
            onSceneReady(scene);
        }
    }, [scene, onSceneReady]);

    // Function to manually save the terrain (can be called from parent or UI)
    const saveTerrainManually = () => {
        return efficientTerrainSave();
    };

    // Helper function to enable/disable auto-save
    const setAutoSaveEnabled = (enabled) => {
        isAutoSaveEnabledRef.current = enabled;

        // Clear existing interval
        if (autoSaveIntervalRef.current) {
            clearInterval(autoSaveIntervalRef.current);
            autoSaveIntervalRef.current = null;
        }

        // Re-establish interval if enabled
        if (enabled) {
            autoSaveIntervalRef.current = setInterval(() => {
                // Only save if there are pending changes and not in the middle of an operation
                if (
                    !isPlacingRef.current &&
                    (Object.keys(pendingChangesRef.current.terrain.added)
                        .length > 0 ||
                        Object.keys(pendingChangesRef.current.terrain.removed)
                            .length > 0)
                ) {
                    efficientTerrainSave();
                }
            }, AUTO_SAVE_INTERVAL);

            // Save immediately if there are pending changes and not in the middle of an operation
            if (
                !isPlacingRef.current &&
                (Object.keys(pendingChangesRef.current.terrain.added).length >
                    0 ||
                    Object.keys(pendingChangesRef.current.terrain.removed)
                        .length > 0)
            ) {
                efficientTerrainSave();
            }
        }

        return enabled;
    };

    // Expose buildUpdateTerrain and clearMap via ref
    useImperativeHandle(ref, () => ({
        buildUpdateTerrain,
        updateTerrainFromToolBar,
        getCurrentTerrainData,
        clearMap,
        // Keeping these for compatibility, but they now just pass through to ChunkSystem
        saveTerrainManually, // Add manual save function
        updateTerrainBlocks, // Expose for selective updates in undo/redo
        updateTerrainForUndoRedo, // Optimized version specifically for undo/redo operations
        updateSpatialHashForBlocks, // Expose for external spatial hash updates
        fastUpdateBlock, // Ultra-optimized function for drag operations
        updateDebugInfo, // Expose debug info updates for tools
        forceChunkUpdate, // Direct chunk updating for tools
        forceRefreshAllChunks, // Force refresh of all chunks
        updateGridSize, // Expose for updating grid size when importing maps

        // Tool management
        activateTool: (toolName, activationData) => {
            // <<< Add activationData here
            if (!toolManagerRef.current) {
                console.error(
                    "Cannot activate tool: tool manager not initialized"
                );
                return false;
            }
            // Pass both arguments to the internal ToolManager function
            return toolManagerRef.current.activateTool(
                toolName,
                activationData
            );
        },

        // Expose toolManagerRef for direct access (but only as read-only)
        get toolManagerRef() {
            return { current: toolManagerRef.current };
        },

        // Performance optimization APIs
        setDeferredChunkMeshing,

        // API for managing deferred spatial hash updates
        deferSpatialHashUpdates: (defer) => {
            deferSpatialHashUpdatesRef.current = defer;
            // If we're turning off deferred updates, apply any pending updates
            if (
                !defer &&
                pendingSpatialHashUpdatesRef.current &&
                pendingSpatialHashUpdatesRef.current.added.length +
                    pendingSpatialHashUpdatesRef.current.removed.length >
                    0
            ) {
                return applyDeferredSpatialHashUpdates();
            }
            return Promise.resolve();
        },
        applyDeferredSpatialHashUpdates,
        isPendingSpatialHashUpdates: () =>
            pendingSpatialHashUpdatesRef.current &&
            pendingSpatialHashUpdatesRef.current.added.length +
                pendingSpatialHashUpdatesRef.current.removed.length >
                0,

        // Methods for view distance handling
        setViewDistance: (distance) => {
            // Import setViewDistance from terrain constants
            const { setViewDistance } = require("./constants/terrain");

            // Update the global view distance
            setViewDistance(distance);

            // Update the chunk system
            const chunkSystem = getChunkSystem();
            if (chunkSystem) {
                chunkSystem.setViewDistance(distance);
            }

            forceRefreshAllChunks();

            return true;
        },

        getViewDistance: () => {
            // Import getViewDistance from terrain constants
            const { getViewDistance } = require("./constants/terrain");
            return getViewDistance();
        },

        // Configure the auto-save interval (in milliseconds)
        setAutoSaveInterval: (intervalMs) => {
            // Clear existing interval
            if (autoSaveIntervalRef.current) {
                clearInterval(autoSaveIntervalRef.current);
            }

            // Set new interval if a valid duration provided
            if (intervalMs && intervalMs > 0) {
                autoSaveIntervalRef.current = setInterval(() => {
                    // Only save if there are pending changes and not in the middle of an operation
                    if (
                        !isPlacingRef.current &&
                        (Object.keys(pendingChangesRef.current.terrain.added)
                            .length > 0 ||
                            Object.keys(
                                pendingChangesRef.current.terrain.removed
                            ).length > 0)
                    ) {
                        efficientTerrainSave();
                    }
                }, intervalMs);
                return true;
            } else {
                // Disable auto-save
                autoSaveIntervalRef.current = null;
                return false;
            }
        },

        // Toggle auto-save on/off
        toggleAutoSave: (enabled) => {
            return setAutoSaveEnabled(enabled);
        },

        // Get current auto-save status
        isAutoSaveEnabled: () => {
            return isAutoSaveEnabledRef.current;
        },

        // Expose placement status for other components (like UndoRedoManager)
        isPlacing: () => {
            return isPlacingRef.current;
        },

        /**
         * Force a DB reload of terrain and then rebuild it
         */
        async refreshTerrainFromDB() {
            // Always show loading screen for terrain refresh
            loadingManager.showLoading("Loading terrain data...", 0);

            return new Promise(async (resolve) => {
                try {
                    // Get blocks directly
                    loadingManager.updateLoading(
                        "Retrieving blocks from database...",
                        10
                    );
                    const blocks = await DatabaseManager.getData(
                        STORES.TERRAIN,
                        "current"
                    );
                    if (!blocks || Object.keys(blocks).length === 0) {
                        loadingManager.hideLoading();
                        resolve(false);
                        return;
                    }

                    const blockCount = Object.keys(blocks).length;
                    loadingManager.updateLoading(
                        `Processing ${blockCount} blocks...`,
                        30
                    );

                    // Update our terrain reference
                    terrainRef.current = {};
                    Object.entries(blocks).forEach(([posKey, blockId]) => {
                        terrainRef.current[posKey] = blockId;
                    });

                    // Clear existing chunks
                    loadingManager.updateLoading(
                        "Clearing existing terrain chunks...",
                        50
                    );
                    if (getChunkSystem()) {
                        getChunkSystem().reset();
                    }

                    // Add all blocks to chunk system
                    const chunkSystem = getChunkSystem();
                    if (chunkSystem) {
                        loadingManager.updateLoading(
                            `Building terrain with ${blockCount} blocks...`,
                            60
                        );
                        chunkSystem.updateFromTerrainData(blocks);

                        // Process all chunks immediately
                        loadingManager.updateLoading(
                            "Processing terrain chunks...",
                            70
                        );
                        await loadAllChunks();
                    }

                    // Initialize spatial hash
                    loadingManager.updateLoading(
                        "Building spatial hash for collision detection...",
                        90
                    );
                    await initializeSpatialHash(true, false);

                    loadingManager.updateLoading(
                        "Terrain refresh complete!",
                        100
                    );
                    // Allow a brief moment to see completion message
                    setTimeout(() => {
                        loadingManager.hideLoading();
                    }, 300);

                    resolve(true);
                } catch (error) {
                    console.error("Error in refreshTerrainFromDB:", error);
                    loadingManager.hideLoading();
                    resolve(false);
                }
            });
        },
        // Add a new public method to force a complete rebuild of the spatial hash grid
        // This method can be called by tools  when they need to ensure
        // the spatial hash is completely up to date after operation
        forceRebuildSpatialHash: (options = {}) => {
            // Skip if spatial grid manager isn't available
            if (!spatialGridManagerRef.current) {
                console.warn(
                    "TerrainBuilder: Cannot rebuild spatial hash - spatial grid manager not available"
                );
                return Promise.resolve();
            }

            // Force disable any throttling or deferral
            disableSpatialHashUpdatesRef.current = false;
            deferSpatialHashUpdatesRef.current = false;

            try {
                // First, clear the spatial hash grid completely
                spatialGridManagerRef.current.clear();

                // Use getCurrentTerrainData instead of terrainRef.current directly
                // This gets the full terrain data including any recent changes
                const terrainData = getCurrentTerrainData();

                if (!terrainData || Object.keys(terrainData).length === 0) {
                    console.warn(
                        "TerrainBuilder: No terrain data available for spatial hash rebuild"
                    );
                    return Promise.resolve();
                }

                const totalBlocks = Object.keys(terrainData).length;

                // Show loading screen if requested and there are many blocks
                const showLoading =
                    options.showLoadingScreen || totalBlocks > 100000;
                if (showLoading) {
                    loadingManager.showLoading(
                        "Rebuilding spatial hash grid..."
                    );
                }

                // Organize blocks by chunks to process more efficiently
                const blocksByChunk = {};

                // Process terrain data to organize blocks by chunk
                for (const [posKey, blockId] of Object.entries(terrainData)) {
                    // Skip air blocks (id = 0) and invalid blocks
                    if (
                        blockId === 0 ||
                        blockId === undefined ||
                        blockId === null
                    )
                        continue;

                    // Parse the position
                    const [x, y, z] = posKey.split(",").map(Number);

                    // Get chunk key (we use chunk coordinates like x>>4,z>>4)
                    const chunkX = Math.floor(x / 16);
                    const chunkZ = Math.floor(z / 16);
                    const chunkKey = `${chunkX},${chunkZ}`;

                    // Initialize chunk array if needed
                    if (!blocksByChunk[chunkKey]) {
                        blocksByChunk[chunkKey] = [];
                    }

                    // Add to chunk's blocks array with proper format for spatial hash
                    blocksByChunk[chunkKey].push({
                        id: blockId,
                        position: [x, y, z],
                    });
                }

                const chunkKeys = Object.keys(blocksByChunk);

                if (chunkKeys.length === 0) {
                    console.warn(
                        "TerrainBuilder: No valid chunks found for spatial hash rebuild"
                    );
                    if (showLoading) loadingManager.hideLoading();
                    return Promise.resolve();
                }

                // Process chunks in batches to avoid UI freezes
                const MAX_CHUNKS_PER_BATCH = 10;
                const totalBatches = Math.ceil(
                    chunkKeys.length / MAX_CHUNKS_PER_BATCH
                );

                // Function to process a batch of chunks
                const processBatch = (batchIndex) => {
                    return new Promise((resolve) => {
                        // Get batch of chunk keys
                        const startIdx = batchIndex * MAX_CHUNKS_PER_BATCH;
                        const endIdx = Math.min(
                            startIdx + MAX_CHUNKS_PER_BATCH,
                            chunkKeys.length
                        );
                        const batchChunks = chunkKeys.slice(startIdx, endIdx);

                        // Collect all blocks from this batch
                        const batchBlocks = [];
                        batchChunks.forEach((chunkKey) => {
                            batchBlocks.push(...blocksByChunk[chunkKey]);
                        });

                        // Skip if no blocks in this batch
                        if (batchBlocks.length === 0) {
                            resolve();
                            return;
                        }

                        // Update progress if showing loading screen
                        if (showLoading) {
                            const progress = Math.round(
                                (batchIndex / totalBatches) * 100
                            );
                            loadingManager.updateLoading(
                                `Processing batch ${
                                    batchIndex + 1
                                }/${totalBatches}`,
                                progress
                            );
                        }

                        // Update spatial hash with this batch of blocks
                        spatialGridManagerRef.current.updateBlocks(
                            batchBlocks,
                            [], // No blocks to remove
                            {
                                force: true,
                                silent: false,
                                skipIfBusy: false,
                            }
                        );

                        // Use setTimeout to avoid UI freezes between batches
                        setTimeout(() => resolve(), 0);
                    });
                };

                // Process all batches sequentially
                return new Promise(async (resolve) => {
                    for (let i = 0; i < totalBatches; i++) {
                        await processBatch(i);
                    }

                    // Force mesh updates only for affected chunks to avoid unnecessary work
                    if (
                        typeof forceChunkUpdate === "function" &&
                        chunkKeys.length > 0
                    ) {
                        forceChunkUpdate(chunkKeys, { skipNeighbors: true });
                    }
                    // Fall back to refreshing all chunks if needed
                    else if (typeof forceRefreshAllChunks === "function") {
                        forceRefreshAllChunks();
                    }

                    // Hide loading screen if it was shown
                    if (showLoading) {
                        loadingManager.hideLoading();
                    }

                    resolve();
                });
            } catch (err) {
                console.error(
                    "TerrainBuilder: Error rebuilding spatial hash grid",
                    err
                );
                if (options.showLoadingScreen) {
                    loadingManager.hideLoading();
                }
                return Promise.reject(err);
            }
        },
    })); // This is the correct syntax with just one closing parenthesis

    // Add resize listener to update canvasRect
    useEffect(() => {
        const handleResize = () => {
            canvasRectRef.current = null; // Force recalculation on next update
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    // Add key event handlers to delegate to tools
    const handleKeyDown = (event) => {
        // Forward event to active tool
        if (toolManagerRef.current && toolManagerRef.current.getActiveTool()) {
            toolManagerRef.current.handleKeyDown(event);
        }
    };

    const handleKeyUp = (event) => {
        if (toolManagerRef.current && toolManagerRef.current.getActiveTool()) {
            toolManagerRef.current.handleKeyUp(event);
        }
    };

    // Update useEffect to add key event listeners
    useEffect(() => {
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, []);

    // Add mouse button tracking for fail-safe detection
    useEffect(() => {
        // Initialize the window.mouseButtons property to track mouse state
        window.mouseButtons = 0;

        // Add global event listeners to track mouse button state
        const updateMouseButtonsDown = (e) => {
            window.mouseButtons |= 1 << e.button;
        };

        const updateMouseButtonsUp = (e) => {
            window.mouseButtons &= ~(1 << e.button);
        };

        // Add listeners to document to catch events even when outside the canvas
        document.addEventListener("mousedown", updateMouseButtonsDown);
        document.addEventListener("mouseup", updateMouseButtonsUp);
        document.addEventListener("mouseleave", updateMouseButtonsUp); // Handle case when mouse leaves window

        return () => {
            document.removeEventListener("mousedown", updateMouseButtonsDown);
            document.removeEventListener("mouseup", updateMouseButtonsUp);
            document.removeEventListener("mouseleave", updateMouseButtonsUp);
        };
    }, []);

    // Add cleanup for tool manager when component unmounts
    useEffect(() => {
        return () => {
            if (toolManagerRef.current) {
                toolManagerRef.current.dispose();
                toolManagerRef.current = null;
            }
        };
    }, []);

    // update the terrain blocks for added and removed blocks
    const updateTerrainBlocks = (addedBlocks, removedBlocks, options = {}) => {
        if (!addedBlocks && !removedBlocks) return;

        // Validate input
        addedBlocks = addedBlocks || {};
        removedBlocks = removedBlocks || {};

        // Skip if no blocks to update
        if (
            Object.keys(addedBlocks).length === 0 &&
            Object.keys(removedBlocks).length === 0
        )
            return;

        console.time("updateTerrainBlocks");

        // Track changes for undo/redo
        trackTerrainChanges(addedBlocks, removedBlocks);

        // Handle custom blocks with data URIs - check all blocks, not just those with 'custom' source
        // This makes sure any block that might be custom is handled properly
        Object.entries(addedBlocks).forEach(([posKey, blockId]) => {
            // Check if this is a custom block ID (numeric)
            if (!isNaN(parseInt(blockId))) {
                // Search strategy 1: Check customBlocks prop for texture data
                let dataUri = null;

                if (customBlocks && customBlocks[blockId]) {
                    dataUri = customBlocks[blockId].dataUri;
                }

                // Search strategy 2: Check localStorage even if not in customBlocks
                if (!dataUri && typeof localStorage !== "undefined") {
                    // Try multiple localStorage keys to find any stored texture
                    const storageKeys = [
                        `block-texture-${blockId}`,
                        `custom-block-${blockId}`,
                        `datauri-${blockId}`,
                    ];

                    for (const key of storageKeys) {
                        const storedUri = localStorage.getItem(key);
                        if (storedUri && storedUri.startsWith("data:image/")) {
                            dataUri = storedUri;
                            break;
                        }
                    }
                }

                // If we found a data URI from any source, apply it
                if (dataUri && dataUri.startsWith("data:image/")) {
                    // Ensure it's stored in localStorage for persistence
                    localStorage.setItem(`block-texture-${blockId}`, dataUri);

                    // Use the imported BlockTextureAtlas directly
                    if (BlockTextureAtlas && BlockTextureAtlas.instance) {
                        BlockTextureAtlas.instance
                            .applyDataUriToAllFaces(blockId, dataUri)
                            .catch((err) =>
                                console.error(
                                    `Error applying data URI to block ${blockId}:`,
                                    err
                                )
                            );
                    }
                }
            }
        });

        // Save changes to undo stack immediately, unless explicitly skipped
        if (
            !options.skipUndoSave &&
            pendingChangesRef.current &&
            (Object.keys(pendingChangesRef.current.terrain.added || {}).length >
                0 ||
                Object.keys(pendingChangesRef.current.terrain.removed || {})
                    .length > 0)
        ) {
            if (undoRedoManager?.current?.saveUndo) {
                undoRedoManager.current.saveUndo(pendingChangesRef.current);
            }
        }

        // Update the terrain data structure
        Object.entries(addedBlocks).forEach(([posKey, blockId]) => {
            terrainRef.current[posKey] = blockId;
        });

        Object.entries(removedBlocks).forEach(([posKey]) => {
            delete terrainRef.current[posKey];
        });

        // Update total block count
        totalBlocksRef.current = Object.keys(terrainRef.current).length;

        // Send total blocks count back to parent component
        if (sendTotalBlocks) {
            sendTotalBlocks(totalBlocksRef.current);
        }

        // Update debug info
        updateDebugInfo();

        // Delegate to the optimized imported function for chunk updates
        importedUpdateTerrainBlocks(addedBlocks, removedBlocks);

        // Only update spatial hash if not explicitly skipped
        if (!options.skipSpatialHash) {
            // Convert blocks to the format expected by updateSpatialHashForBlocks
            const addedBlocksArray = Object.entries(addedBlocks).map(
                ([posKey, blockId]) => {
                    const [x, y, z] = posKey.split(",").map(Number);
                    return {
                        id: blockId,
                        position: [x, y, z],
                    };
                }
            );

            const removedBlocksArray = Object.entries(removedBlocks).map(
                ([posKey]) => {
                    const [x, y, z] = posKey.split(",").map(Number);
                    return {
                        id: 0, // Use 0 for removed blocks
                        position: [x, y, z],
                    };
                }
            );

            // Update the spatial hash for collisions with force option
            updateSpatialHashForBlocks(addedBlocksArray, removedBlocksArray, {
                force: true,
            });
        }

        console.timeEnd("updateTerrainBlocks");
    };

    // Special optimized version for undo/redo operations
    const updateTerrainForUndoRedo = (
        addedBlocks,
        removedBlocks,
        source = "undo/redo"
    ) => {
        console.time(`updateTerrainForUndoRedo-${source}`);
        trackTerrainChanges(addedBlocks, removedBlocks); // <<< Add this line

        // Validate input
        addedBlocks = addedBlocks || {};
        removedBlocks = removedBlocks || {};

        // Skip if no blocks to update
        if (
            Object.keys(addedBlocks).length === 0 &&
            Object.keys(removedBlocks).length === 0
        ) {
            console.timeEnd(`updateTerrainForUndoRedo-${source}`);
            return;
        }

        // Handle custom blocks with data URIs - check all blocks
        Object.entries(addedBlocks).forEach(([posKey, blockId]) => {
            // Check if this is a custom block ID (numeric)
            if (!isNaN(parseInt(blockId))) {
                // Search strategy 1: Check customBlocks prop for texture data
                let dataUri = null;

                if (customBlocks && customBlocks[blockId]) {
                    dataUri = customBlocks[blockId].dataUri;
                }

                // Search strategy 2: Check localStorage even if not in customBlocks
                if (!dataUri && typeof localStorage !== "undefined") {
                    // Try multiple localStorage keys to find any stored texture
                    const storageKeys = [
                        `block-texture-${blockId}`,
                        `custom-block-${blockId}`,
                        `datauri-${blockId}`,
                    ];

                    for (const key of storageKeys) {
                        const storedUri = localStorage.getItem(key);
                        if (storedUri && storedUri.startsWith("data:image/")) {
                            dataUri = storedUri;
                            break;
                        }
                    }
                }

                // If we found a data URI from any source, apply it
                if (dataUri && dataUri.startsWith("data:image/")) {
                    // Ensure it's stored in localStorage for persistence
                    localStorage.setItem(`block-texture-${blockId}`, dataUri);

                    // Use the imported BlockTextureAtlas directly
                    if (BlockTextureAtlas && BlockTextureAtlas.instance) {
                        BlockTextureAtlas.instance
                            .applyDataUriToAllFaces(blockId, dataUri)
                            .catch((err) =>
                                console.error(
                                    `Error applying data URI to block ${blockId}:`,
                                    err
                                )
                            );
                    }
                }
            }
        });

        // Update the terrain data structure
        Object.entries(addedBlocks).forEach(([posKey, blockId]) => {
            terrainRef.current[posKey] = blockId;
        });

        Object.entries(removedBlocks).forEach(([posKey]) => {
            delete terrainRef.current[posKey];
        });

        // Update total block count
        totalBlocksRef.current = Object.keys(terrainRef.current).length;

        // Send updated total blocks count back to parent component
        if (sendTotalBlocks) {
            sendTotalBlocks(totalBlocksRef.current);
        }

        // Update debug info
        updateDebugInfo();

        // Delegate to the optimized imported function for chunk updates
        importedUpdateTerrainBlocks(addedBlocks, removedBlocks);

        // Update spatial hash
        const addedBlocksArray = Object.entries(addedBlocks).map(
            ([posKey, blockId]) => {
                const [x, y, z] = posKey.split(",").map(Number);
                return {
                    id: blockId,
                    position: [x, y, z],
                };
            }
        );

        const removedBlocksArray = Object.entries(removedBlocks).map(
            ([posKey]) => {
                const [x, y, z] = posKey.split(",").map(Number);
                return {
                    id: 0, // Use 0 for removed blocks
                    position: [x, y, z],
                };
            }
        );

        // Update the spatial hash for collisions with force option
        updateSpatialHashForBlocks(addedBlocksArray, removedBlocksArray, {
            force: true,
        });

        console.timeEnd(`updateTerrainForUndoRedo-${source}`);
    };

    // Function to update which chunks are visible based on camera position and frustum
    // REMOVED: This function is no longer needed since we're using the new ChunkSystem
    // Replaced all calls with direct calls to processChunkRenderQueue()
    // const updateVisibleChunks = () => { ... };

    // Call this in buildUpdateTerrain after updating terrainRef

    // Optimized ray intersection using spatial hash
    const getOptimizedRaycastIntersection = (prioritizeBlocks = true) => {
        // Safety checks
        if (!scene || !threeCamera || !threeRaycaster) return null;

        // Use the raw pointer coordinates directly from THREE.js
        const normalizedMouse = pointer.clone();

        // Setup raycaster with the normalized coordinates
        threeRaycaster.setFromCamera(normalizedMouse, threeCamera);

        // First, check for block collisions using optimized ray casting
        let intersection = null;

        // Safety check - ensure spatialGridManagerRef.current is initialized
        if (
            useSpatialHashRef.current &&
            spatialGridManagerRef.current &&
            spatialGridManagerRef.current.size > 0
        ) {
            // Prepare raycast options
            const raycastOptions = {
                maxDistance: selectionDistanceRef.current,
                prioritizeBlocks,
                gridSize: gridSizeRef.current,
                recentlyPlacedBlocks: recentlyPlacedBlocksRef.current,
                isPlacing: isPlacingRef.current,
                mode: modeRef.current,
                debug: true, // Enable debug logging for this call
            };

            // Perform raycast against spatial hash grid
            const gridResult = spatialGridManagerRef.current.raycast(
                threeRaycaster,
                threeCamera,
                raycastOptions
            );

            intersection = gridResult;
        } else {
            // Fallback to simple ground plane detection if spatial hash is not available
            const rayOrigin = threeRaycaster.ray.origin;
            const rayDirection = threeRaycaster.ray.direction;

            // Calculate intersection with the ground plane
            const target = new THREE.Vector3();
            const intersectionDistance = rayOrigin.y / -rayDirection.y;

            // Only consider intersections in front of the camera and within selection distance
            if (
                intersectionDistance > 0 &&
                intersectionDistance < selectionDistanceRef.current
            ) {
                // Calculate the intersection point
                target
                    .copy(rayOrigin)
                    .addScaledVector(rayDirection, intersectionDistance);

                // Check if this point is within our valid grid area
                const gridSizeHalf = gridSizeRef.current / 2;
                if (
                    Math.abs(target.x) <= gridSizeHalf &&
                    Math.abs(target.z) <= gridSizeHalf
                ) {
                    // This is a hit against the ground plane within the valid build area
                    intersection = {
                        point: target.clone(),
                        normal: new THREE.Vector3(0, 1, 0), // Normal is up for ground plane
                        block: {
                            x: Math.floor(target.x),
                            y: 0,
                            z: Math.floor(target.z),
                        },
                        blockId: null, // No block here - it's the ground
                        distance: intersectionDistance,
                        isGroundPlane: true,
                    };
                }
            }
        }

        return intersection;
    };

    // Add mouse event listeners to the canvas
    useEffect(() => {
        const canvas = gl.domElement;
        if (!canvas) return;

        // Define wrapper functions to potentially adapt event format if needed
        // Although in this case, handleMouseDown/Up seem compatible
        const handleCanvasMouseDown = (event) => {
            handleMouseDown(event);
        };
        const handleCanvasMouseUp = (event) => {
            handleMouseUp(event);
        };

        canvas.addEventListener("mousedown", handleCanvasMouseDown);
        canvas.addEventListener("mouseup", handleCanvasMouseUp);

        // Cleanup function to remove listeners
        return () => {
            canvas.removeEventListener("mousedown", handleCanvasMouseDown);
            canvas.removeEventListener("mouseup", handleCanvasMouseUp);
        };
    }, [gl, handleMouseDown, handleMouseUp]); // Add dependencies

    // Add these variables to track camera movement outside the animate function
    const lastCameraPosition = new THREE.Vector3();
    const lastCameraRotation = new THREE.Euler();
    //const cameraMovementTimeout = { current: null };
    //	const chunkUpdateThrottle = { current: 0 };

    // Update the usages of these optimizations
    useEffect(() => {
        // Apply renderer optimizations
        optimizeRenderer(gl);

        // Initialize camera manager with camera and controls
        cameraManager.initialize(threeCamera, orbitControlsRef.current);

        // Set up a consistent update loop
        let frameId;
        let lastTime = 0;
        let frameCount = 0;

        const animate = (time) => {
            frameId = requestAnimationFrame(animate);

            // Update liquid material time uniform for wave animation
            if (BlockMaterial.instance.liquidMaterial) {
                // Use time (milliseconds) divided by 1000 for seconds, adjust multiplier for speed
                BlockMaterial.instance.liquidMaterial.uniforms.time.value =
                    (time / 1000) * 0.5;
            }

            // Calculate delta time for smooth updates
            //const delta = time - lastTime;
            lastTime = time;

            // Add fail-safe check for mouse state
            // If mouse button is up but we're still placing, it means we missed the mouseup event
            if (isPlacingRef.current && frameCount % 30 === 0) {
                // Check if primary mouse button is not pressed
                if (!window.mouseButtons || !(window.mouseButtons & 1)) {
                    // Mouse is up but we're still in placing mode - likely missed the event during lag
                    console.warn(
                        "Detected mouse button up while still in placing mode - fixing state"
                    );
                    // Simulate a mouse up event to fix the state
                    handleMouseUp({ button: 0 });
                }
            }

            // Only run heavy operations every few frames to reduce lag
            frameCount++;
            //const shouldRunHeavyOperations = frameCount % 2 === 0; // Reduced from 3 to 2 for more frequent updates

            // Check for valid camera
            if (!threeCamera) {
                console.warn("[Animation] Three camera is null or undefined");
                return;
            }

            // Check the currentCameraRef to ensure it's properly set
            if (!currentCameraRef.current) {
                console.warn("[Animation] Current camera reference is not set");
                currentCameraRef.current = threeCamera;
            }

            // Detect camera movement (cheaper comparison)
            const posX = threeCamera.position.x;
            const posY = threeCamera.position.y;
            const posZ = threeCamera.position.z;

            const rotX = threeCamera.rotation.x;
            const rotY = threeCamera.rotation.y;
            const rotZ = threeCamera.rotation.z;

            const positionChanged =
                Math.abs(posX - lastCameraPosition.x) > 0.01 ||
                Math.abs(posY - lastCameraPosition.y) > 0.01 ||
                Math.abs(posZ - lastCameraPosition.z) > 0.01;

            const rotationChanged =
                Math.abs(rotX - lastCameraRotation.x) > 0.01 ||
                Math.abs(rotY - lastCameraRotation.y) > 0.01 ||
                Math.abs(rotZ - lastCameraRotation.z) > 0.01;

            const isCameraMoving = positionChanged || rotationChanged;

            cameraMoving.current = isCameraMoving;

            // Update stored values (cheaper than .copy())
            lastCameraPosition.x = posX;
            lastCameraPosition.y = posY;
            lastCameraPosition.z = posZ;

            lastCameraRotation.x = rotX;
            lastCameraRotation.y = rotY;
            lastCameraRotation.z = rotZ;

            // Update chunk system with the current camera and process render queue
            // Always do this regardless of movement

            if (frameCount % 5 === 0) {
                // Every ~0.1 second at 60fps
                updateChunkSystemWithCamera();
            }

            if (frameCount % 60 === 0) {
                // Every ~1 second at 60fps
                // Use direct force update instead of the older refresh method
                const {
                    forceUpdateChunkVisibility,
                } = require("./chunks/TerrainBuilderIntegration");
                forceUpdateChunkVisibility();
            }
        };

        // Start the animation loop
        frameId = requestAnimationFrame(animate);

        // Clean up animation frame on component unmount
        return () => {
            cancelAnimationFrame(frameId);
        };
    }, [gl]);

    // Handle camera movement to pause chunk processing during navigation
    const handleCameraMove = () => {
        if (!threeCamera) return;

        // Update the camera in the chunk system for culling
        updateChunkSystemCamera(threeCamera);

        // Check if we need to load additional chunks from the full terrain data
        loadNewChunksInViewDistance();

        // Process the chunk render queue to update visibility
        processChunkRenderQueue();
    };

    // Handle camera movement for instant processing of chunks as they come into view
    const loadNewChunksInViewDistance = () => {
        // Skip if no camera or chunk system
        const chunkSystem = getChunkSystem();
        if (!chunkSystem || !threeCamera) {
            return;
        }

        // All chunks are already loaded, just process the render queue
        // to update visibility for chunks that are now in view
        processChunkRenderQueue();
    };

    // Initialize the last update time
    handleCameraMove.lastUpdateTime = 0;

    // Add this function to efficiently update the spatial hash for a batch of blocks
    const updateSpatialHashForBlocks = (
        addedBlocks = [],
        removedBlocks = [],
        options = {}
    ) => {
        // Skip if disabled globally
        if (disableSpatialHashUpdatesRef.current) {
            return;
        }

        // Safety check - ensure spatialGridManagerRef.current is initialized
        if (!spatialGridManagerRef.current) {
            return;
        }

        // Ensure both arrays are valid
        const validAddedBlocks = Array.isArray(addedBlocks) ? addedBlocks : [];
        const validRemovedBlocks = Array.isArray(removedBlocks)
            ? removedBlocks
            : [];

        // Skip if both arrays are empty
        if (validAddedBlocks.length === 0 && validRemovedBlocks.length === 0) {
            return;
        }

        // If we're currently in bulk loading mode, just collect updates for later processing
        if (deferSpatialHashUpdatesRef.current && !options.force) {
            // Collect updates to apply later
            pendingSpatialHashUpdatesRef.current.added.push(
                ...validAddedBlocks
            );
            pendingSpatialHashUpdatesRef.current.removed.push(
                ...validRemovedBlocks
            );
            return;
        }

        // Skip if too many blocks - will be handled by periodic updates instead
        // But always process if force option is set
        if (
            !options.force &&
            (validAddedBlocks.length > 100 || validRemovedBlocks.length > 100)
        ) {
            return;
        }

        // Very aggressive throttling to avoid performance impact
        const now = performance.now();
        if (now - spatialHashLastUpdateRef.current < 1000 && !options.force) {
            // Wait at least 1 second between updates
            // For small numbers of blocks (1-10), queue for later update
            if (
                validAddedBlocks.length + validRemovedBlocks.length <= 10 &&
                !spatialHashUpdateQueuedRef.current
            ) {
                spatialHashUpdateQueuedRef.current = true;

                // Use longer delay
                setTimeout(() => {
                    // Only update if not processing something else
                    if (
                        spatialGridManagerRef.current &&
                        !spatialGridManagerRef.current.isProcessing
                    ) {
                        try {
                            // Filter blocks to only those in or near the frustum
                            const camera = cameraRef.current;

                            if (camera && !options.force) {
                                // Update the frustum cache
                                spatialGridManagerRef.current.updateFrustumCache(
                                    camera,
                                    getViewDistance()
                                );

                                // Filter added blocks to those in frustum
                                const filteredAddedBlocks =
                                    validAddedBlocks.filter((block) => {
                                        if (!block || typeof block !== "object")
                                            return false;

                                        // Handle different possible formats
                                        let x, y, z;
                                        if (Array.isArray(block.position)) {
                                            [x, y, z] = block.position;
                                        } else if (
                                            block.x !== undefined &&
                                            block.y !== undefined &&
                                            block.z !== undefined
                                        ) {
                                            x = block.x;
                                            y = block.y;
                                            z = block.z;
                                        } else if (typeof block === "string") {
                                            [x, y, z] = block
                                                .split(",")
                                                .map(Number);
                                        } else {
                                            return false;
                                        }

                                        const chunkX = Math.floor(
                                            x / CHUNK_SIZE
                                        );
                                        const chunkY = Math.floor(
                                            y / CHUNK_SIZE
                                        );
                                        const chunkZ = Math.floor(
                                            z / CHUNK_SIZE
                                        );
                                        const chunkKey = `${chunkX},${chunkY},${chunkZ}`;

                                        return spatialGridManagerRef.current.chunksInFrustum.has(
                                            chunkKey
                                        );
                                    });

                                // Filter removed blocks to those in frustum
                                const filteredRemovedBlocks =
                                    validRemovedBlocks.filter((block) => {
                                        if (!block) return false;

                                        // Handle different possible formats
                                        let x, y, z;
                                        if (
                                            typeof block === "object" &&
                                            Array.isArray(block.position)
                                        ) {
                                            [x, y, z] = block.position;
                                        } else if (
                                            typeof block === "object" &&
                                            block.x !== undefined &&
                                            block.y !== undefined &&
                                            block.z !== undefined
                                        ) {
                                            x = block.x;
                                            y = block.y;
                                            z = block.z;
                                        } else if (typeof block === "string") {
                                            [x, y, z] = block
                                                .split(",")
                                                .map(Number);
                                        } else {
                                            return false;
                                        }

                                        const chunkX = Math.floor(
                                            x / CHUNK_SIZE
                                        );
                                        const chunkY = Math.floor(
                                            y / CHUNK_SIZE
                                        );
                                        const chunkZ = Math.floor(
                                            z / CHUNK_SIZE
                                        );
                                        const chunkKey = `${chunkX},${chunkY},${chunkZ}`;

                                        return spatialGridManagerRef.current.chunksInFrustum.has(
                                            chunkKey
                                        );
                                    });

                                // Only update if there are blocks to process
                                if (
                                    filteredAddedBlocks.length > 0 ||
                                    filteredRemovedBlocks.length > 0
                                ) {
                                    spatialGridManagerRef.current.updateBlocks(
                                        filteredAddedBlocks,
                                        filteredRemovedBlocks,
                                        {
                                            showLoadingScreen: false,
                                            silent: true,
                                            skipIfBusy: true,
                                        }
                                    );
                                }
                            } else {
                                // Use regular update if no camera or forced
                                spatialGridManagerRef.current.updateBlocks(
                                    validAddedBlocks,
                                    validRemovedBlocks,
                                    {
                                        showLoadingScreen: false,
                                        silent: true,
                                        skipIfBusy: true,
                                    }
                                );
                            }
                        } catch (e) {
                            // Silence errors
                            console.error("Error updating spatial hash:", e);
                        }
                    }

                    // Reset flag - but with delay to prevent rapid sequential updates
                    setTimeout(() => {
                        spatialHashUpdateQueuedRef.current = false;
                    }, 1000);
                }, 1000);
            }
            return;
        }

        // Update timestamp first to prevent overlapping calls
        spatialHashLastUpdateRef.current = now;

        // Skip update if camera is moving and not forced
        if (cameraMoving.current && !options.force) {
            return;
        }

        // Use a try/catch to handle any potential errors
        try {
            // For forced updates or large batches, use regular update
            if (
                options.force ||
                validAddedBlocks.length > 1000 ||
                validRemovedBlocks.length > 1000
            ) {
                spatialGridManagerRef.current.updateBlocks(
                    validAddedBlocks,
                    validRemovedBlocks,
                    {
                        showLoadingScreen: options.force ? true : false,
                        silent: options.force ? false : true,
                        skipIfBusy: options.force ? false : true,
                    }
                );
                return;
            }

            // For smaller updates, filter to frustum
            const camera = cameraRef.current;

            if (camera) {
                // Update the frustum cache
                spatialGridManagerRef.current.updateFrustumCache(
                    camera,
                    getViewDistance()
                );

                // Filter added blocks to those in frustum
                const filteredAddedBlocks = validAddedBlocks.filter((block) => {
                    if (!block || typeof block !== "object") return false;

                    // Handle different possible formats
                    let x, y, z;
                    if (Array.isArray(block.position)) {
                        [x, y, z] = block.position;
                    } else if (
                        block.x !== undefined &&
                        block.y !== undefined &&
                        block.z !== undefined
                    ) {
                        x = block.x;
                        y = block.y;
                        z = block.z;
                    } else if (typeof block === "string") {
                        [x, y, z] = block.split(",").map(Number);
                    } else {
                        return false;
                    }

                    const chunkX = Math.floor(x / CHUNK_SIZE);
                    const chunkY = Math.floor(y / CHUNK_SIZE);
                    const chunkZ = Math.floor(z / CHUNK_SIZE);
                    const chunkKey = `${chunkX},${chunkY},${chunkZ}`;

                    return spatialGridManagerRef.current.chunksInFrustum.has(
                        chunkKey
                    );
                });

                // Filter removed blocks to those in frustum
                const filteredRemovedBlocks = validRemovedBlocks.filter(
                    (block) => {
                        if (!block) return false;

                        // Handle different possible formats
                        let x, y, z;
                        if (
                            typeof block === "object" &&
                            Array.isArray(block.position)
                        ) {
                            [x, y, z] = block.position;
                        } else if (
                            typeof block === "object" &&
                            block.x !== undefined &&
                            block.y !== undefined &&
                            block.z !== undefined
                        ) {
                            x = block.x;
                            y = block.y;
                            z = block.z;
                        } else if (typeof block === "string") {
                            [x, y, z] = block.split(",").map(Number);
                        } else {
                            return false;
                        }

                        const chunkX = Math.floor(x / CHUNK_SIZE);
                        const chunkY = Math.floor(y / CHUNK_SIZE);
                        const chunkZ = Math.floor(z / CHUNK_SIZE);
                        const chunkKey = `${chunkX},${chunkY},${chunkZ}`;

                        return spatialGridManagerRef.current.chunksInFrustum.has(
                            chunkKey
                        );
                    }
                );

                // Only update if there are blocks to process
                if (
                    filteredAddedBlocks.length > 0 ||
                    filteredRemovedBlocks.length > 0
                ) {
                    spatialGridManagerRef.current.updateBlocks(
                        filteredAddedBlocks,
                        filteredRemovedBlocks,
                        {
                            showLoadingScreen: false,
                            silent: true,
                            skipIfBusy: true,
                        }
                    );
                }
            } else {
                // Fallback to regular update if no camera
                spatialGridManagerRef.current.updateBlocks(
                    validAddedBlocks,
                    validRemovedBlocks,
                    {
                        showLoadingScreen: options.force ? true : false,
                        silent: options.force ? false : true,
                        skipIfBusy: options.force ? false : true,
                    }
                );
            }
        } catch (e) {
            // Silence any errors
            console.error("Error updating spatial hash:", e);
        }
    };

    // Add a new function to apply deferred spatial hash updates
    const applyDeferredSpatialHashUpdates = async () => {
        // If there are no pending updates, just return
        if (
            pendingSpatialHashUpdatesRef.current.added.length === 0 &&
            pendingSpatialHashUpdatesRef.current.removed.length === 0
        ) {
            return;
        }

        const added = [...pendingSpatialHashUpdatesRef.current.added];
        const removed = [...pendingSpatialHashUpdatesRef.current.removed];

        // Clear the pending updates first to avoid potential duplicates
        pendingSpatialHashUpdatesRef.current = { added: [], removed: [] };

        // Process all spatial hash updates in one go
        return updateSpatialHashForBlocks(added, removed, { force: true });
    };

    // Add an effect to update CameraManager when isInputDisabled changes
    useEffect(() => {
        cameraManager.setInputDisabled(isInputDisabled);
    }, [isInputDisabled]);

    // Main return statement
    return (
        <>
            <OrbitControls
                ref={orbitControlsRef}
                enablePan={true}
                enableZoom={false}
                enableRotate={true}
                mouseButtons={{
                    MIDDLE: THREE.MOUSE.PAN,
                    RIGHT: THREE.MOUSE.ROTATE,
                }}
                onChange={handleCameraMove}
                enabled={!isInputDisabled} // Keep this for OrbitControls mouse input
            />

            {/* Shadow directional light */}
            <directionalLight
                ref={directionalLightRef}
                position={[10, 20, 10]}
                intensity={2}
                color={0xffffff}
                castShadow={true}
                shadow-mapSize-width={2048}
                shadow-mapSize-height={2048}
                shadow-camera-far={1000}
                shadow-camera-near={10}
                shadow-camera-left={-100}
                shadow-camera-right={100}
                shadow-camera-top={100}
                shadow-camera-bottom={-100}
                shadow-bias={0.00005}
                shadow-normalBias={0.1}
            />

            {/* Non shadow directional light */}
            <directionalLight
                position={[10, 20, 10]}
                intensity={1}
                color={0xffffff}
                castShadow={false}
            />

            {/* Ambient light */}
            <ambientLight intensity={0.8} />

            {/* mesh of invisible plane to receive shadows, and grid helper to display grid */}
            <mesh
                ref={shadowPlaneRef}
                position={[0.5, -0.51, 0.5]}
                rotation={[-Math.PI / 2, 0, 0]}
                transparent={true}
                receiveShadow={true}
                castShadow={false}
                frustumCulled={false}
            >
                <planeGeometry args={[gridSize, gridSize]} />
                <meshPhongMaterial transparent opacity={0} />
            </mesh>
            <gridHelper position={[0.5, -0.5, 0.5]} ref={gridRef} />

            {previewPosition &&
                (modeRef.current === "add" || modeRef.current === "remove") && (
                    <group>
                        {getPlacementPositions(
                            previewPosition,
                            placementSizeRef.current
                        ).map((pos, index) => (
                            <group key={index} position={[pos.x, pos.y, pos.z]}>
                                <mesh renderOrder={2}>
                                    <boxGeometry args={[1.02, 1.02, 1.02]} />
                                    <meshPhongMaterial
                                        color={
                                            modeRef.current === "add"
                                                ? "green"
                                                : "red"
                                        }
                                        opacity={0.4}
                                        transparent={true}
                                        depthWrite={false}
                                        depthTest={true}
                                        alphaTest={0.1}
                                    />
                                </mesh>
                                <lineSegments renderOrder={3}>
                                    <edgesGeometry
                                        args={[new THREE.BoxGeometry(1, 1, 1)]}
                                    />
                                    <lineBasicMaterial
                                        color="darkgreen"
                                        linewidth={2}
                                    />
                                </lineSegments>
                            </group>
                        ))}
                    </group>
                )}
        </>
    );
}

// Convert to forwardRef
export default forwardRef(TerrainBuilder);

// Export block types and related functions
export {
    blockTypes,
    getBlockTypes,
    getCustomBlocks,
    processCustomBlock,
} from "./managers/BlockTypesManager";
// Add a method to explicitly set deferred chunk meshing mode
const setDeferredChunkMeshing = (defer) => {
    const chunkSystem = getChunkSystem();
    if (!chunkSystem) {
        console.error(
            "Cannot set deferred chunk meshing: chunk system not available"
        );
        return false;
    }

    // If enabling, use a more conservative priority distance to ensure at least some content is visible
    // Calculate a reasonable priority distance based on view distance
    let priorityDistance = Math.min(32, getViewDistance() / 2);

    // Make sure it's not too small to prevent blank screens
    priorityDistance = Math.max(24, priorityDistance);

    // When disabling, force all chunks to be visible
    if (!defer) {
        // Force process any deferred chunks
        chunkSystem.forceUpdateChunkVisibility(false);
    }

    chunkSystem.setBulkLoadingMode(defer, priorityDistance);

    return true;
};

/**
 * Force an update for specific chunks by key
 * @param {Array<String>} chunkKeys - Array of chunk keys to update, e.g. ["32,48,0", "16,48,0"]
 * @param {Object} options - Options for the update
 * @param {Boolean} options.skipNeighbors - If true, skip neighbor chunk updates (faster but less accurate at boundaries)
 */
const forceChunkUpdate = (chunkKeys, options = {}) => {
    const chunkSystem = getChunkSystem();
    if (!chunkSystem || chunkKeys.length === 0) {
        return;
    }

    // Pass the chunk keys to the chunk system for direct update
    chunkSystem.forceUpdateChunks(chunkKeys, options);
};

/**
 * Force update a chunk by its origin
 * @param {Array} chunkOrigin - Array with the chunk's origin coordinates [x, y, z]
 * @param {Object} options - Options for the update
 * @param {Boolean} options.skipNeighbors - If true, skip neighbor chunk updates for faster processing
 */
const forceChunkUpdateByOrigin = (chunkOrigin, options = {}) => {
    const chunkSystem = getChunkSystem();
    if (!chunkSystem) {
        console.warn("forceChunkUpdateByOrigin: No chunk system available");
        return;
    }

    const skipNeighbors = options.skipNeighbors === true;
    const chunkId = `${chunkOrigin[0]},${chunkOrigin[1]},${chunkOrigin[2]}`;
    chunkSystem.forceUpdateChunks([chunkId], { skipNeighbors });
};

/**
 * Configure chunk loading behavior
 * @param {Object} options Configuration options
 * @param {boolean} options.deferMeshBuilding Whether to defer mesh building for distant chunks
 * @param {number} options.priorityDistance Distance within which chunks get immediate meshes
 * @param {number} options.deferredBuildDelay Delay in ms before building deferred chunks
 */
const configureChunkLoading = (options = {}) => {
    const chunkSystem = getChunkSystem();
    if (!chunkSystem) {
        console.warn(
            "Cannot configure chunk loading: chunk system not available"
        );
        return false;
    }

    // Extract options with defaults
    const deferMeshBuilding = options.deferMeshBuilding !== false;
    const priorityDistance =
        options.priorityDistance || Math.max(32, getViewDistance() * 0.33);

    // Enable bulk loading mode if deferred mesh building is enabled
    if (deferMeshBuilding) {
        // Enable bulk loading mode - only chunks within priorityDistance of camera get immediate meshes
        chunkSystem.setBulkLoadingMode(true, priorityDistance);
    } else {
        // Disable bulk loading mode if deferred mesh building is disabled
        chunkSystem.setBulkLoadingMode(false);
    }

    return true;
};

// Fix the exports to only include module-level functions
export {
    configureChunkLoading,
    forceChunkUpdate,
    forceChunkUpdateByOrigin,
    loadAllChunks,
    setDeferredChunkMeshing,
};

// Utility function to force loading of all chunks at once
const loadAllChunks = async () => {
    const chunkSystem = getChunkSystem();
    if (!chunkSystem) {
        console.warn("No chunk system available for loading chunks");
        return;
    }

    // Get scene and camera
    const scene = chunkSystem._scene;
    const camera = scene?.camera;

    if (!camera) {
        console.warn("No camera available for prioritizing chunks");
        return;
    }

    // Get camera position
    const cameraPos = camera.position;

    // Get all chunk IDs that exist in the system
    const chunkIds = Array.from(chunkSystem._chunkManager._chunks.keys());

    // Calculate distances from camera for each chunk
    const chunksWithDistances = chunkIds.map((chunkId) => {
        const [x, y, z] = chunkId.split(",").map(Number);

        // Use the imported CHUNK_SIZE constant
        const chunkCenterX = x + CHUNK_SIZE / 2;
        const chunkCenterY = y + CHUNK_SIZE / 2;
        const chunkCenterZ = z + CHUNK_SIZE / 2;

        const distance = Math.sqrt(
            Math.pow(chunkCenterX - cameraPos.x, 2) +
                Math.pow(chunkCenterY - cameraPos.y, 2) +
                Math.pow(chunkCenterZ - cameraPos.z, 2)
        );

        return { chunkId, distance };
    });

    // Sort chunks by distance to camera (closest first)
    chunksWithDistances.sort((a, b) => a.distance - b.distance);

    // Process chunks in batches from closest to farthest
    const BATCH_SIZE = 50;

    // Process all chunks in distance-sorted batches
    for (let i = 0; i < chunksWithDistances.length; i += BATCH_SIZE) {
        const batch = chunksWithDistances.slice(i, i + BATCH_SIZE);

        // Queue this batch for rendering with high priority
        for (const { chunkId, distance } of batch) {
            const chunk = chunkSystem._chunkManager._chunks.get(chunkId);
            if (chunk) {
                // Queue the chunk for rendering with high priority
                chunkSystem._chunkManager.queueChunkForRender(chunkId, {
                    forceMesh: true, // Force immediate mesh building
                    priority: true, // High priority
                });
            }
        }

        // Process the render queue to build these chunks immediately
        chunkSystem.processRenderQueue(true); // true = prioritize by camera distance

        // Allow a short delay for UI updates between batches
        if (i + BATCH_SIZE < chunksWithDistances.length) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }

    // Final render queue processing to catch any remaining chunks
    chunkSystem.processRenderQueue(true);

    return true;
};
