import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import * as THREE from "three";
import BlockMaterial from "./blocks/BlockMaterial"; // Add this import
import BlockTextureAtlas from "./blocks/BlockTextureAtlas";
import BlockTypeRegistry from "./blocks/BlockTypeRegistry";
import { cameraManager } from "./Camera";
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
import {
    CHUNK_SIZE,
    getViewDistance,
    THRESHOLD_FOR_PLACING,
} from "./constants/terrain";
import { processCustomBlock } from "./managers/BlockTypesManager";
import { cameraMovementTracker } from "./managers/CameraMovementTracker";
import { DatabaseManager, STORES } from "./managers/DatabaseManager";
import { loadingManager } from "./managers/LoadingManager";
import {
    cleanupMouseButtonTracking,
    initializeMouseButtonTracking,
} from "./managers/MouseButtonManager";
import { SpatialGridManager } from "./managers/SpatialGridManager";
import { spatialHashUpdateManager } from "./managers/SpatialHashUpdateManager";
import TerrainUndoRedoManager from "./managers/TerrainUndoRedoManager";
import { playPlaceSound } from "./Sound";
import {
    GroundTool,
    SchematicPlacementTool,
    SelectionTool,
    TerrainTool,
    ReplaceTool,
    ToolManager,
    WallTool,
} from "./tools";
import {
    configureChunkLoading,
    forceChunkUpdate,
    loadAllChunks,
    setDeferredChunkMeshing,
} from "./utils/ChunkUtils"; // <<< Add this import
import {
    handleTerrainMouseDown,
    handleTerrainMouseUp,
} from "./utils/TerrainMouseUtils";
import { getTerrainRaycastIntersection } from "./utils/TerrainRaycastUtils";

function optimizeRenderer(gl) {
    if (gl) {
        gl.shadowMap.autoUpdate = false;
        gl.shadowMap.needsUpdate = true;
        gl.sortObjects = true;
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
        axisLockEnabled,
        gridSize,
        cameraReset,
        cameraAngle,
        placementSize,
        setPageIsLoaded,
        customBlocks,
        environmentBuilderRef,
        isInputDisabled,
        snapToGrid,
    },
    ref
) {
    const spatialGridManagerRef = useRef(
        new SpatialGridManager(loadingManager)
    );
    const orbitControlsRef = useRef(null);
    const frustumRef = useRef(new THREE.Frustum());
    const meshesInitializedRef = useRef(false);
    const useSpatialHashRef = useRef(true);
    const totalBlocksRef = useRef(0);
    const cameraRef = useRef(null);
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
    const firstLoadCompletedRef = useRef(false); // Flag to track if the first load is complete
    const initialSaveCompleteRef = useRef(false);
    const autoSaveIntervalRef = useRef(null);
    const AUTO_SAVE_INTERVAL = 300000; // Auto-save every 5 minutes (300,000 ms)
    const isAutoSaveEnabledRef = useRef(true); // Default to enabled, but can be toggled
    const gridSizeRef = useRef(gridSize); // Add a ref to maintain grid size state
    const placementSizeRef = useRef(placementSize);
    const snapToGridRef = useRef(snapToGrid !== false);
    const originalPixelRatioRef = useRef(null);

    useEffect(() => {
        snapToGridRef.current = snapToGrid !== false;
    }, [snapToGrid]);

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
    }, []); // Empty dependency array means this runs once on mount

    useEffect(() => {
        let reloadJustPrevented = false;

        const currentUrl = window.location.href;

        const handleBeforeUnload = (event) => {
            if (localStorage.getItem("IS_DATABASE_CLEARING")) {
                console.log(
                    "Database is being cleared, skipping unsaved changes check"
                );
                return;
            }

            if (!pendingChangesRef || !pendingChangesRef.current) {
                console.log("No pending changes ref available");
                return;
            }

            const hasTerrainChanges =
                pendingChangesRef.current.terrain &&
                (Object.keys(pendingChangesRef.current.terrain.added || {})
                    .length > 0 ||
                    Object.keys(pendingChangesRef.current.terrain.removed || {})
                        .length > 0);

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
                console.log("Detected popstate after reload prevention");
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
                    console.log(
                        "Page became visible again after reload attempt"
                    );

                    localStorage.removeItem("reload_attempted");

                    if (reloadJustPrevented) {
                        reloadJustPrevented = false;
                        console.log(
                            "User canceled reload, restoring history state"
                        );

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
    }, []);

    const efficientTerrainSave = async () => {
        console.log("efficientTerrainSave");
        console.log("pendingChangesRef", pendingChangesRef.current);
        if (localStorage.getItem("IS_DATABASE_CLEARING")) {
            return false;
        }

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

        const changesToSave = { ...pendingChangesRef.current.terrain };
        console.log("changesToSave", changesToSave);

        resetPendingChanges();

        try {
            const db = await DatabaseManager.getDBConnection();

            // Number of operations (delete/put) to execute per IndexedDB transaction.
            // Keeping this value reasonable avoids hitting engine limits and keeps the UI responsive.
            const CHUNK_SIZE = 100000;

            // Utility helper to run a batch of operations inside its own transaction
            const processChunk = (items, handler) => {
                return new Promise((resolve, reject) => {
                    const tx = db.transaction(STORES.TERRAIN, "readwrite");
                    const store = tx.objectStore(STORES.TERRAIN);
                    items.forEach((item) => handler(store, item));
                    tx.oncomplete = resolve;
                    tx.onerror = reject;
                });
            };

            // --- Handle removals in manageable chunks ---
            if (
                changesToSave.removed &&
                Object.keys(changesToSave.removed).length > 0
            ) {
                const removeKeys = Object.keys(changesToSave.removed);
                for (let i = 0; i < removeKeys.length; i += CHUNK_SIZE) {
                    const slice = removeKeys.slice(i, i + CHUNK_SIZE);
                    await processChunk(slice, (store, key) =>
                        store.delete(key)
                    );
                }
                console.log(`Deleted ${removeKeys.length} blocks from DB`);
            }

            // --- Handle additions / updates in manageable chunks ---
            if (
                changesToSave.added &&
                Object.keys(changesToSave.added).length > 0
            ) {
                const addEntries = Object.entries(changesToSave.added);
                for (let i = 0; i < addEntries.length; i += CHUNK_SIZE) {
                    const slice = addEntries.slice(i, i + CHUNK_SIZE);
                    await processChunk(slice, (store, [key, value]) =>
                        store.put(value, key)
                    );
                }
                console.log(`Added/updated ${addEntries.length} blocks in DB`);
            }

            // All chunk transactions awaited above have completed at this point.
            lastSaveTimeRef.current = Date.now(); // Update last save time
            return true;
        } catch (error) {
            console.error("Error during efficient terrain save:", error);

            pendingChangesRef.current.terrain = changesToSave;
            return false;
        }
    };

    useEffect(() => {
        console.log("Initializing incremental terrain save system");

        initialSaveCompleteRef.current = false;

        pendingChangesRef.current = { added: {}, removed: {} };

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

    const {
        scene,
        camera: threeCamera,
        raycaster: threeRaycaster,
        pointer,
        gl,
    } = useThree();
    const currentCameraRef = useRef(null);
    useEffect(() => {
        if (threeCamera) {
            currentCameraRef.current = threeCamera;
            cameraRef.current = threeCamera; // Also update our camera ref for frustum culling
        }
    }, [threeCamera]);
    const updateChunkSystemWithCamera = () => {
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
        camera.updateMatrixWorld(true);
        camera.updateProjectionMatrix();
        updateChunkSystemCamera(camera);
        const { getViewDistance } = require("./constants/terrain");
        const currentViewDistance = getViewDistance();
        chunkSystem.setViewDistance(currentViewDistance);
        chunkSystem.setViewDistanceEnabled(true);
        processChunkRenderQueue();
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
        const { getViewDistance } = require("./constants/terrain");
        const currentViewDistance = getViewDistance();
        camera.updateMatrixWorld(true);
        camera.updateProjectionMatrix();
        const projScreenMatrix = new THREE.Matrix4();
        projScreenMatrix.multiplyMatrices(
            camera.projectionMatrix,
            camera.matrixWorldInverse
        );
        const frustum = new THREE.Frustum();
        frustum.setFromProjectionMatrix(projScreenMatrix);
        frustumRef.current = frustum;
        chunkSystem.setViewDistance(currentViewDistance);
        chunkSystem.setViewDistanceEnabled(true);
        updateChunkSystemCamera(camera);
        processChunkRenderQueue();
        setTimeout(() => processChunkRenderQueue(), 50);
        setTimeout(() => processChunkRenderQueue(), 100);
        return true;
    };
    const placementChangesRef = useRef({
        terrain: { added: {}, removed: {} },
        environment: { added: [], removed: [] },
    });
    const instancedMeshRef = useRef({});
    const shadowPlaneRef = useRef();
    const directionalLightRef = useRef();
    const terrainRef = useRef({});
    const gridRef = useRef();
    const mouseMoveAnimationRef = useRef(null);
    const isPlacingRef = useRef(false);
    const currentPlacingYRef = useRef(0);
    const previewPositionRef = useRef(new THREE.Vector3());
    const rawPlacementAnchorRef = useRef(new THREE.Vector3());
    const lockedAxisRef = useRef(null);
    const selectionDistanceRef = useRef(256);
    const axisLockEnabledRef = useRef(axisLockEnabled);
    const currentBlockTypeRef = useRef(currentBlockType);
    const isFirstBlockRef = useRef(true);
    const modeRef = useRef(mode);
    const placedBlockCountRef = useRef(0); // Track number of blocks placed during a mouse down/up cycle
    const placedEnvironmentCountRef = useRef(0); // Track number of Environment objects placed during a mouse down/up cycle
    const lastDeletionTimeRef = useRef(0); // Add this ref to track the last deletion time
    const lastPlacementTimeRef = useRef(0); // Add this ref to track the last placement time
    const [previewPosition, setPreviewPosition] = useState(new THREE.Vector3());
    const recentlyPlacedBlocksRef = useRef(new Set());
    const canvasRectRef = useRef(null);
    const tempVectorRef = useRef(new THREE.Vector3());
    const toolManagerRef = useRef(null);
    const disableSpatialHashUpdatesRef = useRef(false);
    const deferSpatialHashUpdatesRef = useRef(false);
    const updateSpatialHashForBlocks = (
        addedBlocks = [],
        removedBlocks = [],
        options = {}
    ) => {
        return spatialHashUpdateManager.updateSpatialHashForBlocks(
            spatialGridManagerRef.current,
            addedBlocks,
            removedBlocks,
            options
        );
    };
    const terrainUndoRedoManager = new TerrainUndoRedoManager({
        terrainRef,
        totalBlocksRef,
        importedUpdateTerrainBlocks,
        updateSpatialHashForBlocks,
        customBlocks,
        BlockTextureAtlas,
        undoRedoManager,
    });
    const updateTerrainForUndoRedo =
        terrainUndoRedoManager.updateTerrainForUndoRedo.bind(
            terrainUndoRedoManager
        );
    const trackTerrainChanges = terrainUndoRedoManager.trackTerrainChanges.bind(
        terrainUndoRedoManager
    );
    const resetPendingChanges = terrainUndoRedoManager.resetPendingChanges.bind(
        terrainUndoRedoManager
    );
    const buildUpdateTerrain = async (options = {}) => {
        console.time("buildUpdateTerrain");
        const useProvidedBlocks =
            options.blocks && Object.keys(options.blocks).length > 0;
        if (!useProvidedBlocks && !terrainRef.current) {
            console.error(
                "Terrain reference is not initialized and no blocks provided"
            );
            console.timeEnd("buildUpdateTerrain");
            return;
        }
        if (!pendingChangesRef.current) {
            console.log("initializing pendingChangesRef");
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
        try {
            const terrainBlocks = useProvidedBlocks
                ? options.blocks
                : { ...terrainRef.current };
            if (Object.keys(terrainBlocks).length === 0) {
                console.timeEnd("buildUpdateTerrain");
                return;
            }
            const deferMeshBuilding = options.deferMeshBuilding !== false;
            configureChunkLoading({
                deferMeshBuilding: deferMeshBuilding,
                priorityDistance: options.priorityDistance,
                deferredBuildDelay: options.deferredBuildDelay,
            });
            if (useProvidedBlocks) {
                if (getChunkSystem() && updateTerrainChunks) {
                    console.log("buildUpdateTerrain - updateTerrainChunks");
                    updateTerrainChunks(terrainBlocks, deferMeshBuilding);
                    if (Object.keys(terrainRef.current).length === 0) {
                        const blockEntries = Object.entries(terrainBlocks);
                        const BATCH_SIZE = 10000;
                        const processBlockBatch = (startIdx, batchNum) => {
                            const endIdx = Math.min(
                                startIdx + BATCH_SIZE,
                                blockEntries.length
                            );
                            const batch = blockEntries.slice(startIdx, endIdx);
                            batch.forEach(([posKey, blockId]) => {
                                terrainRef.current[posKey] = blockId;
                                pendingChangesRef.current.terrain.added[
                                    posKey
                                ] = blockId;
                            });
                            if (endIdx < blockEntries.length) {
                                setTimeout(() => {
                                    processBlockBatch(endIdx, batchNum + 1);
                                }, 50); // 50ms delay to avoid blocking UI
                            }
                        };
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
                if (getChunkSystem() && updateTerrainChunks) {
                    updateTerrainChunks(terrainBlocks, deferMeshBuilding);
                } else {
                    console.warn(
                        "Chunk system or updateTerrainChunks not available"
                    );
                }
            }
            if (processChunkRenderQueue) {
                processChunkRenderQueue();
            }
            console.timeEnd("buildUpdateTerrain");
        } catch (error) {
            console.error("Error building terrain:", error);
            console.timeEnd("buildUpdateTerrain");
        }
    };
    const fastUpdateBlock = (position, blockId) => {
        if (!position) return;
        const x = Math.round(position[0] || position.x);
        const y = Math.round(position[1] || position.y);
        const z = Math.round(position[2] || position.z);
        const posKey = `${x},${y},${z}`;
        if (terrainRef.current[posKey] === blockId) return;
        if (blockId === 0) {
            if (!terrainRef.current[posKey]) return;
            const originalBlockId = terrainRef.current[posKey];
            const removedBlocks = { [posKey]: originalBlockId };
            trackTerrainChanges({}, removedBlocks);
            placementChangesRef.current.terrain.removed[posKey] =
                originalBlockId;
            delete terrainRef.current[posKey];
        } else {
            const addedBlocks = { [posKey]: blockId };
            trackTerrainChanges(addedBlocks, {});
            placementChangesRef.current.terrain.added[posKey] = blockId;
            terrainRef.current[posKey] = blockId;
        }
        totalBlocksRef.current = Object.keys(terrainRef.current).length;
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
        const blockArray = [
            {
                id: blockId,
                position: [x, y, z],
            },
        ];
        if (blockId === 0) {
            updateSpatialHashForBlocks([], blockArray, { force: true });
        } else {
            updateSpatialHashForBlocks(blockArray, [], { force: true });
        }
    };
    const handleMouseDown = useCallback(
        (e) => {
            console.log("handleMouseDown");

            // Pointer-lock handling: first click should engage lock rather than place
            if (
                !cameraManager.isPointerUnlockedMode &&
                !cameraManager.isPointerLocked
            ) {
                const canvasEl = gl && gl.domElement;
                if (canvasEl && canvasEl.requestPointerLock) {
                    try {
                        const lockResult = canvasEl.requestPointerLock();
                        const handleRelock = () => {
                            if (document.pointerLockElement === canvasEl) {
                                document.removeEventListener(
                                    "pointerlockchange",
                                    handleRelock
                                );
                            }
                        };
                        document.addEventListener(
                            "pointerlockchange",
                            handleRelock,
                            { once: true }
                        );

                        if (
                            lockResult &&
                            typeof lockResult.catch === "function"
                        ) {
                            lockResult.catch((err) => {
                                console.warn(
                                    "[TerrainBuilder] Pointer lock request was rejected:",
                                    err
                                );
                                document.removeEventListener(
                                    "pointerlockchange",
                                    handleRelock
                                );
                            });
                        }
                    } catch (err) {
                        console.warn(
                            "[TerrainBuilder] Pointer lock request threw an error:",
                            err
                        );
                    }
                }
                return;
            }

            if (
                !cameraManager.isPointerUnlockedMode &&
                cameraManager.isPointerLocked
            ) {
                if (e.button === 0) {
                    modeRef.current = "add";
                } else if (e.button === 2) {
                    modeRef.current = "remove";
                }
            }

            // Low-res sculpting: temporarily drop pixel ratio
            if (
                !isPlacingRef.current &&
                gl &&
                typeof gl.getPixelRatio === "function"
            ) {
                const lowResEnabled = window.lowResDragEnabled === true;
                if (lowResEnabled) {
                    try {
                        originalPixelRatioRef.current = gl.getPixelRatio();
                        gl.setPixelRatio(
                            Math.max(0.3, originalPixelRatioRef.current * 0.5)
                        );
                    } catch (_) {}
                }
            }

            handleTerrainMouseDown(
                e,
                toolManagerRef,
                isPlacingRef,
                placedBlockCountRef,
                placedEnvironmentCountRef,
                recentlyPlacedBlocksRef,
                placementChangesRef,
                getRaycastIntersection,
                currentPlacingYRef,
                previewPositionRef,
                rawPlacementAnchorRef,
                isFirstBlockRef,
                updatePreviewPosition,
                handleBlockPlacement,
                playPlaceSound,
                threeRaycaster,
                cameraManager,
                currentBlockTypeRef
            );
        },
        [threeRaycaster.ray, gl, cameraManager]
    );
    const handleBlockPlacement = () => {
        console.log("********handleBlockPlacement********");
        console.log("currentBlockTypeRef.current", currentBlockTypeRef.current);

        if (!currentBlockTypeRef.current) {
            console.log("currentBlockTypeRef.current is undefined");
            return;
        }

        if (toolManagerRef.current && toolManagerRef.current.getActiveTool()) {
            return;
        }
        if (!modeRef.current || !isPlacingRef.current) return;
        if (
            currentBlockTypeRef.current?.isEnvironment &&
            placedEnvironmentCountRef.current < 1
        ) {
            console.log(
                "currentBlockTypeRef.current?.isEnvironment && placedEnvironmentCountRef.current < 1"
            );
            if (isFirstBlockRef.current) {
                console.log("isFirstBlockRef.current");
                if (
                    environmentBuilderRef.current &&
                    typeof environmentBuilderRef.current
                        .placeEnvironmentModel === "function"
                ) {
                    try {
                        console.log("handleBlockPlacement - ENVIRONMENT");
                        const result =
                            environmentBuilderRef.current.placeEnvironmentModel(
                                modeRef.current,
                                true
                            );
                        if (result?.length > 0) {
                            placedEnvironmentCountRef.current += result.length;
                        }
                        if (modeRef.current === "add" && result?.length > 0) {
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
            if (
                modeRef.current === "add" &&
                !currentBlockTypeRef?.current?.isEnvironment
            ) {
                console.log("handleBlockPlacement - ADD");
                const now = performance.now();
                const positions = getPlacementPositions(
                    previewPositionRef.current,
                    placementSizeRef.current
                );
                const addedBlocks = {};
                let blockWasPlaced = false; // Flag to track if any block was actually placed
                positions.forEach((pos) => {
                    const blockKey = `${pos.x},${pos.y},${pos.z}`;
                    const hasInstance =
                        environmentBuilderRef.current.hasInstanceAtPosition(
                            pos
                        );
                    if (!terrainRef.current[blockKey] && !hasInstance) {
                        addedBlocks[blockKey] = currentBlockTypeRef.current.id;

                        if (!currentBlockTypeRef.current.isEnvironment) {
                            terrainRef.current[blockKey] =
                                currentBlockTypeRef.current.id;
                        }
                        // remove it from the removed array
                        if (
                            placementChangesRef.current.terrain.removed[
                                blockKey
                            ]
                        ) {
                            delete placementChangesRef.current.terrain.removed[
                                blockKey
                            ];
                        }
                        if (
                            pendingChangesRef.current.terrain.removed[blockKey]
                        ) {
                            delete pendingChangesRef.current.terrain.removed[
                                blockKey
                            ];
                        }

                        recentlyPlacedBlocksRef.current.add(blockKey);
                        placementChangesRef.current.terrain.added[blockKey] =
                            currentBlockTypeRef.current.id;
                        pendingChangesRef.current.terrain.added[blockKey] =
                            currentBlockTypeRef.current.id;
                        blockWasPlaced = true;
                    }
                });
                if (blockWasPlaced) {
                    importedUpdateTerrainBlocks(addedBlocks, {});
                    trackTerrainChanges(addedBlocks, {}); // <<< Add this line
                    const addedBlocksArray = Object.entries(addedBlocks).map(
                        ([posKey, blockId]) => {
                            const [x, y, z] = posKey.split(",").map(Number);
                            return {
                                id: blockId,
                                position: [x, y, z],
                            };
                        }
                    );
                    if (addedBlocksArray.length > 0) {
                        updateSpatialHashForBlocks(addedBlocksArray, [], {
                            force: true,
                        });
                    }
                    placedBlockCountRef.current +=
                        Object.keys(addedBlocks).length;
                    lastPlacementTimeRef.current = now;
                }
            } else if (
                modeRef.current === "remove" &&
                !currentBlockTypeRef?.current?.isEnvironment
            ) {
                const now = performance.now();
                if (now - lastDeletionTimeRef.current < 50) {
                    return; // Exit if the delay hasn't passed
                }
                const positions = getPlacementPositions(
                    previewPositionRef.current,
                    placementSizeRef.current
                );
                const removedBlocks = {};
                let blockWasRemoved = false; // Flag to track if any block was actually removed in this call
                positions.forEach((pos) => {
                    const blockKey = `${pos.x},${pos.y},${pos.z}`;

                    // remove it from the added array
                    if (placementChangesRef.current.terrain.added[blockKey]) {
                        delete placementChangesRef.current.terrain.added[
                            blockKey
                        ];
                    }
                    if (pendingChangesRef.current.terrain.added[blockKey]) {
                        delete pendingChangesRef.current.terrain.added[
                            blockKey
                        ];
                    }

                    if (terrainRef.current[blockKey]) {
                        removedBlocks[blockKey] = terrainRef.current[blockKey];
                        delete terrainRef.current[blockKey];
                        placementChangesRef.current.terrain.removed[blockKey] =
                            removedBlocks[blockKey];
                        pendingChangesRef.current.terrain.removed[blockKey] =
                            removedBlocks[blockKey];
                        blockWasRemoved = true;
                    }
                });
                if (blockWasRemoved) {
                    importedUpdateTerrainBlocks({}, removedBlocks);
                    trackTerrainChanges({}, removedBlocks); // <<< Add this line
                    const removedBlocksArray = Object.entries(
                        removedBlocks
                    ).map(([posKey, blockId]) => {
                        const [x, y, z] = posKey.split(",").map(Number);
                        return {
                            id: 0, // Use 0 for removed blocks
                            position: [x, y, z],
                        };
                    });
                    if (removedBlocksArray.length > 0) {
                        updateSpatialHashForBlocks([], removedBlocksArray, {
                            force: true,
                        });
                    }
                    placedBlockCountRef.current +=
                        Object.keys(removedBlocks).length;
                    lastDeletionTimeRef.current = now;
                }
            }
            isFirstBlockRef.current = false;
        }
    };
    const getRaycastIntersection = useCallback(() => {
        const ptr =
            !cameraManager.isPointerUnlockedMode &&
            cameraManager.isPointerLocked
                ? new THREE.Vector2(0, 0)
                : pointer.clone();
        return getTerrainRaycastIntersection(
            scene,
            threeCamera,
            threeRaycaster,
            ptr,
            useSpatialHashRef,
            spatialGridManagerRef,
            gridSizeRef,
            selectionDistanceRef,
            recentlyPlacedBlocksRef,
            isPlacingRef,
            modeRef
        );
    }, [pointer, scene, threeCamera, threeRaycaster, cameraManager]);
    const updatePreviewPosition = () => {
        if (updatePreviewPosition.isProcessing) {
            return;
        }
        updatePreviewPosition.isProcessing = true;
        if (!canvasRectRef.current) {
            canvasRectRef.current = gl.domElement.getBoundingClientRect();
        }
        const blockIntersection = getRaycastIntersection();

        // Anchor-Y correction: keep drag locked on original Y layer
        const anchorY = currentPlacingYRef.current;
        if (
            isPlacingRef.current &&
            !isFirstBlockRef.current &&
            blockIntersection &&
            blockIntersection.point &&
            Math.floor(blockIntersection.point.y) !== anchorY
        ) {
            const anchorPlane = new THREE.Plane(
                new THREE.Vector3(0, 1, 0),
                -anchorY
            );
            const anchorPt = new THREE.Vector3();
            threeRaycaster.ray.intersectPlane(anchorPlane, anchorPt);
            blockIntersection.point.copy(anchorPt);
            blockIntersection.normal.set(0, 1, 0);
            blockIntersection.isGroundPlane = true;
            blockIntersection.block = {
                x: Math.floor(anchorPt.x),
                y: anchorY,
                z: Math.floor(anchorPt.z),
            };
            blockIntersection.blockId = null;
        }

        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Plane at y=0
        const currentGroundPoint = new THREE.Vector3();
        const normalizedMouse =
            !cameraManager.isPointerUnlockedMode &&
            cameraManager.isPointerLocked
                ? new THREE.Vector2(0, 0)
                : pointer.clone();
        threeRaycaster.setFromCamera(normalizedMouse, threeCamera);
        const hitGround = threeRaycaster.ray.intersectPlane(
            groundPlane,
            currentGroundPoint
        );
        if (blockIntersection && blockIntersection.point) {
            const isToolActive =
                toolManagerRef.current &&
                toolManagerRef.current.getActiveTool();
            const potentialNewPosition = tempVectorRef.current.clone();
            if (isToolActive) {
                const activeTool = toolManagerRef.current.getActiveTool();
                if (typeof activeTool.handleMouseMove === "function") {
                    const canvasRect = gl.domElement.getBoundingClientRect();
                    const mouseEvent = {
                        clientX:
                            ((pointer.x + 1) / 2) * canvasRect.width +
                            canvasRect.left,
                        clientY:
                            ((1 - pointer.y) / 2) * canvasRect.height +
                            canvasRect.top,
                        normal: blockIntersection.normal,
                    };
                    activeTool.handleMouseMove(
                        mouseEvent,
                        blockIntersection.point
                    );
                }
            }
            potentialNewPosition.copy(blockIntersection.point);

            const hitBlock = blockIntersection.block || {
                x: Math.floor(blockIntersection.point.x),
                y: Math.floor(blockIntersection.point.y),
                z: Math.floor(blockIntersection.point.z),
            };
            if (blockIntersection.face && blockIntersection.normal) {
                potentialNewPosition.x =
                    hitBlock.x + blockIntersection.normal.x;
                potentialNewPosition.y =
                    hitBlock.y + blockIntersection.normal.y;
                potentialNewPosition.z =
                    hitBlock.z + blockIntersection.normal.z;
                if (
                    snapToGridRef.current ||
                    !currentBlockTypeRef.current?.isEnvironment
                ) {
                    potentialNewPosition.x = Math.round(potentialNewPosition.x);
                    potentialNewPosition.y = Math.round(potentialNewPosition.y);
                    potentialNewPosition.z = Math.round(potentialNewPosition.z);
                }
            } else {
                potentialNewPosition.add(
                    blockIntersection.normal.clone().multiplyScalar(0.5)
                );
                if (
                    snapToGridRef.current ||
                    !currentBlockTypeRef.current?.isEnvironment
                ) {
                    potentialNewPosition.x = Math.round(potentialNewPosition.x);
                    potentialNewPosition.y = Math.round(potentialNewPosition.y);
                    potentialNewPosition.z = Math.round(potentialNewPosition.z);
                }
            }

            // Override snapping for environment models when grid snapping is disabled and no block hit (ground plane)
            if (
                !snapToGridRef.current &&
                currentBlockTypeRef.current?.isEnvironment &&
                blockIntersection.isGroundPlane &&
                hitGround
            ) {
                potentialNewPosition.copy(currentGroundPoint);
            }

            // When unsnapped for environment, keep precise X/Z from intersection but snap Y to nearest block level
            if (
                !snapToGridRef.current &&
                currentBlockTypeRef.current?.isEnvironment &&
                blockIntersection &&
                !blockIntersection.isGroundPlane
            ) {
                potentialNewPosition.x = blockIntersection.point.x;
                potentialNewPosition.z = blockIntersection.point.z;
                potentialNewPosition.y = Math.round(potentialNewPosition.y);
            }

            if (blockIntersection.isGroundPlane) {
                potentialNewPosition.y = 0; // Position at y=0 when placing on ground plane
            } else {
                if (modeRef.current === "remove") {
                    if (blockIntersection.normal.y === 1) {
                        potentialNewPosition.y = potentialNewPosition.y - 1;
                    } else if (blockIntersection.normal.y === -1) {
                        potentialNewPosition.y = potentialNewPosition.y + 1;
                    } else if (blockIntersection.normal.x === 1) {
                        potentialNewPosition.x = potentialNewPosition.x - 1;
                    } else if (blockIntersection.normal.x === -1) {
                        potentialNewPosition.x = potentialNewPosition.x + 1;
                    } else if (blockIntersection.normal.z === 1) {
                        potentialNewPosition.z = potentialNewPosition.z - 1;
                    } else if (blockIntersection.normal.z === -1) {
                        potentialNewPosition.z = potentialNewPosition.z + 1;
                    }
                }
            }

            if (axisLockEnabledRef.current) {
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

            let shouldUpdatePreview = true;
            let thresholdMet = false; // Flag to track if raw ground threshold was met
            if (isPlacingRef.current && !isToolActive) {
                if (hitGround && rawPlacementAnchorRef.current) {
                    const groundDistanceMoved = currentGroundPoint.distanceTo(
                        rawPlacementAnchorRef.current
                    );
                    if (isFirstBlockRef.current) {
                        shouldUpdatePreview = true;
                        thresholdMet = true; // Mark that we're forcing the placement

                        currentPlacingYRef.current = potentialNewPosition.y; // Update the Y-lock position based on initial hit
                        potentialNewPosition.y = currentPlacingYRef.current;
                    } else {
                        if (groundDistanceMoved < THRESHOLD_FOR_PLACING) {
                            shouldUpdatePreview = false;
                        } else {
                            shouldUpdatePreview = true;
                            thresholdMet = true; // Mark that we passed the raw ground check

                            potentialNewPosition.y = currentPlacingYRef.current;
                        }
                    }
                } else {
                    shouldUpdatePreview = false;
                    console.warn(
                        "Missing raw ground anchor or ground intersection point for threshold check."
                    );
                }
            }
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
                if (
                    isPlacingRef.current &&
                    !isToolActive &&
                    thresholdMet &&
                    hitGround
                ) {
                    rawPlacementAnchorRef.current.copy(currentGroundPoint); // Reset the raw ground anchor
                }
            }
            if (isPlacingRef.current && !isToolActive && shouldUpdatePreview) {
                console.log("updatePreviewPosition - handleBlockPlacement");
                handleBlockPlacement();
            }
        }
        updatePreviewPosition.isProcessing = false;
    };
    const handleMouseUp = useCallback(
        (e) => {
            handleTerrainMouseUp(
                e,
                toolManagerRef,
                isPlacingRef,
                placedBlockCountRef,
                placedEnvironmentCountRef,
                recentlyPlacedBlocksRef,
                terrainRef,
                spatialGridManagerRef,
                undoRedoManager,
                placementChangesRef,
                ref,
                getRaycastIntersection
            );

            // Restore pixel ratio after drag if it was lowered
            if (
                !isPlacingRef.current &&
                originalPixelRatioRef.current &&
                gl &&
                typeof gl.setPixelRatio === "function"
            ) {
                try {
                    gl.setPixelRatio(originalPixelRatioRef.current);
                    originalPixelRatioRef.current = null;
                } catch (_) {}
            }
        },
        [getRaycastIntersection, undoRedoManager, ref]
    );
    const getPlacementPositions = (centerPos, placementSize) => {
        const positions = [];

        const addPos = (dx, dz) => {
            positions.push({
                x: centerPos.x + dx,
                y: centerPos.y,
                z: centerPos.z + dz,
            });
        };

        const square = (radius) => {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    addPos(dx, dz);
                }
            }
        };

        const diamond = (radius) => {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    if (Math.abs(dx) + Math.abs(dz) <= radius) {
                        addPos(dx, dz);
                    }
                }
            }
        };

        switch (placementSize) {
            case "3x3":
                square(1);
                break;
            case "5x5":
                square(2);
                break;
            case "3x3diamond":
                diamond(1);
                break;
            case "5x5diamond":
                diamond(2);
                break;
            case "single":
            default:
                addPos(0, 0);
                break;
        }

        return positions;
    };
    const getCurrentTerrainData = () => {
        return terrainRef.current;
    };
    const updateTerrainFromToolBar = (terrainData) => {
        loadingManager.showLoading("Starting Minecraft map import...", 0);
        terrainRef.current = terrainData;
        loadingManager.updateLoading(
            "Saving imported terrain to database...",
            15
        );
        if (terrainData) {
            DatabaseManager.saveData(STORES.TERRAIN, "current", terrainData)
                .then(() => {
                    pendingChangesRef.current = {
                        terrain: { added: {}, removed: {} },
                        environment: { added: [], removed: [] },
                    };
                    loadingManager.updateLoading(
                        "Building terrain from imported blocks...",
                        30
                    );
                    configureChunkLoading({
                        deferMeshBuilding: true,
                        priorityDistance: 48,
                        deferredBuildDelay: 5000,
                    });
                    if (getChunkSystem()) {
                        getChunkSystem().setBulkLoadingMode(true, 48);
                    }
                    buildUpdateTerrain({
                        blocks: terrainData,
                        deferMeshBuilding: true,
                    });
                    loadingManager.updateLoading(
                        "Initializing spatial hash grid...",
                        60
                    );
                    setTimeout(async () => {
                        try {
                            loadingManager.updateLoading(
                                "Building spatial hash index...",
                                70
                            );
                            await initializeSpatialHash(true, false);
                            totalBlocksRef.current = Object.keys(
                                terrainRef.current
                            ).length;
                            loadingManager.updateLoading(
                                "Building terrain meshes...",
                                85
                            );
                            processChunkRenderQueue();
                            loadingManager.updateLoading(
                                "Map import complete, preparing view...",
                                95
                            );
                            setTimeout(() => {
                                loadingManager.hideLoading();
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
            loadingManager.hideLoading();
        }
    };
    const updateGridSize = async (newGridSize) => {
        if (gridRef.current) {
            let gridSizeToUse;
            if (newGridSize) {
                gridSizeToUse = newGridSize;
            } else {
                gridSizeToUse = 5000; // Default to 5000 if no grid size is provided
            }
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

    const clearMap = async () => {
        try {
            await terrainUndoRedoManager.clearUndoRedoHistory();
            localStorage.setItem("IS_DATABASE_CLEARING", "true");
            try {
                terrainRef.current = {};
                totalBlocksRef.current = 0;
                clearChunks();
                if (spatialGridManagerRef.current) {
                    spatialGridManagerRef.current.clear();
                    firstLoadCompletedRef.current = false; // Reset spatial hash init flag
                }
                if (environmentBuilderRef?.current?.clearEnvironments) {
                    environmentBuilderRef.current.clearEnvironments(); // Should also handle its own DB persistence
                }
                isPlacingRef.current = false;
                recentlyPlacedBlocksRef.current = new Set();
                resetPendingChanges(); // Reset all pending changes first
                const clearUndoRedo = async () => {
                    try {
                        await DatabaseManager.saveData(
                            STORES.UNDO,
                            "states",
                            []
                        );
                        await DatabaseManager.saveData(
                            STORES.REDO,
                            "states",
                            []
                        );
                        if (undoRedoManager?.current?.clearHistory) {
                            undoRedoManager.current.clearHistory();
                        }
                    } catch (error) {
                        console.error(
                            "Failed to clear undo/redo history:",
                            error
                        );
                    }
                };
                clearUndoRedo(); // Call async clear
                DatabaseManager.clearStore(STORES.TERRAIN)
                    .then(() => {
                        resetPendingChanges();
                        lastSaveTimeRef.current = Date.now(); // Update last save time
                    })
                    .catch((error) => {
                        console.error("Error clearing terrain store:", error);
                    });
            } catch (error) {
                console.error("Error during clearMap operation:", error);
            } finally {
                localStorage.removeItem("IS_DATABASE_CLEARING");
            }
        } catch (error) {
            console.error("Failed to clear map:", error);
        }
    };
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
        if (visibleOnly && terrainRef.current) {
            const chunkSystem = getChunkSystem();
            if (chunkSystem && chunkSystem._scene.camera) {
                const camera = chunkSystem._scene.camera;
                const cameraPos = camera.position;
                const viewDistance = getViewDistance() || 64;
                const visibleBlocks = {};
                const getChunkOrigin = (pos) => {
                    const [x, y, z] = pos.split(",").map(Number);
                    const chunkSize = CHUNK_SIZE;
                    return {
                        x: Math.floor(x / chunkSize) * chunkSize,
                        y: Math.floor(y / chunkSize) * chunkSize,
                        z: Math.floor(z / chunkSize) * chunkSize,
                    };
                };
                Object.entries(terrainRef.current).forEach(
                    ([posKey, blockId]) => {
                        const origin = getChunkOrigin(posKey);
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
                        if (distance <= viewDistance) {
                            visibleBlocks[posKey] = blockId;
                        }
                    }
                );
                spatialGridManagerRef.current.updateFromTerrain(visibleBlocks);
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
        firstLoadCompletedRef.current = true;
        return Promise.resolve();
    };
    useEffect(() => {
        const handleMouseMove = () => {
            if (mouseMoveAnimationRef.current) {
                cancelAnimationFrame(mouseMoveAnimationRef.current);
            }
            mouseMoveAnimationRef.current = requestAnimationFrame(
                updatePreviewPosition
            );
        };
        window.addEventListener("mousemove", handleMouseMove);
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            if (mouseMoveAnimationRef.current) {
                cancelAnimationFrame(mouseMoveAnimationRef.current);
                mouseMoveAnimationRef.current = null;
            }
        };
    }, []);
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
    useEffect(() => {
        if (threeCamera) {
            threeCamera.frustumCulled = false;
        }
        if (scene) {
            scene.traverse((object) => {
                if (object.isMesh || object.isInstancedMesh) {
                    object.frustumCulled = false;
                }
            });
        }
    }, [threeCamera, scene]);
    useEffect(() => {
        let mounted = true;
        function initialize() {
            if (threeCamera && orbitControlsRef.current) {
                cameraManager.initialize(threeCamera, orbitControlsRef.current);
                orbitControlsRef.current.addEventListener("change", () => {
                    handleCameraMove();
                });
            }
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
            if (scene) {
                initChunkSystem(scene, {
                    viewDistance: getViewDistance(),
                    viewDistanceEnabled: true,
                }).catch((error) => {
                    console.error("Error initializing chunk system:", error);
                });
            }
            meshesInitializedRef.current = true;
            DatabaseManager.getData(STORES.CUSTOM_BLOCKS, "blocks")
                .then((customBlocksData) => {
                    if (customBlocksData && customBlocksData.length > 0) {
                        for (const block of customBlocksData) {
                            processCustomBlock(block);
                        }
                        window.dispatchEvent(
                            new CustomEvent("custom-blocks-loaded", {
                                detail: { blocks: customBlocksData },
                            })
                        );
                    }
                    console.log("Loading terrain...");
                    return DatabaseManager.getData(STORES.TERRAIN, "current");
                })
                .then((savedTerrain) => {
                    if (!mounted) return;
                    if (savedTerrain) {
                        terrainRef.current = savedTerrain;
                        totalBlocksRef.current = Object.keys(
                            terrainRef.current
                        ).length;
                        pendingChangesRef.current = {
                            terrain: { added: {}, removed: {} },
                            environment: { added: [], removed: [] },
                        };
                        loadingManager.showLoading(
                            "Preloading textures for all blocks..."
                        );
                        setTimeout(async () => {
                            try {
                                const usedBlockIds = new Set();
                                Object.values(terrainRef.current).forEach(
                                    (blockId) => {
                                        usedBlockIds.add(parseInt(blockId));
                                    }
                                );
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
                                if (
                                    BlockTypeRegistry &&
                                    BlockTypeRegistry.instance
                                ) {
                                    await BlockTypeRegistry.instance.preload();
                                }
                                await rebuildTextureAtlas();
                                updateTerrainChunks(
                                    terrainRef.current,
                                    true,
                                    environmentBuilderRef
                                );
                                processChunkRenderQueue();
                                window.fullTerrainDataRef = terrainRef.current;
                                loadingManager.hideLoading();
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
                    loadingManager.hideLoading();
                    setPageIsLoaded(true);
                })
                .catch((error) => {
                    console.error(
                        "Error loading terrain or custom blocks:",
                        error
                    );
                    meshesInitializedRef.current = true;
                    loadingManager.hideLoading();
                    setPageIsLoaded(true);
                });
        }

        const terrainBuilderProps = {
            scene,
            terrainRef: terrainRef,
            currentBlockTypeRef: currentBlockTypeRef,
            previewPositionRef: previewPositionRef,
            terrainBuilderRef: ref, // Add a reference to this component
            environmentBuilderRef: environmentBuilderRef,
            undoRedoManager: undoRedoManager, // Pass undoRedoManager directly without wrapping
            placementChangesRef: placementChangesRef, // Add placement changes ref for tracking undo/redo
            isPlacingRef: isPlacingRef, // Add placing state ref
            modeRef, // Add mode reference for add/remove functionality
            getPlacementPositions, // Share position calculation utility
            importedUpdateTerrainBlocks, // Direct access to optimized terrain update function
            updateSpatialHashForBlocks, // Direct access to spatial hash update function
            updateTerrainForUndoRedo, // <<< Add this function explicitly
            updateTerrainBlocks, // Add the updateTerrainBlocks function for terrain modifications
            totalBlocksRef, // Provide access to the total block count ref
            activateTool: (toolName, activationData) =>
                toolManagerRef.current?.activateTool(toolName, activationData),
            pendingChangesRef,
        };
        toolManagerRef.current = new ToolManager(terrainBuilderProps);
        const wallTool = new WallTool(terrainBuilderProps);
        toolManagerRef.current.registerTool("wall", wallTool);
        const groundTool = new GroundTool(terrainBuilderProps);
        toolManagerRef.current.registerTool("ground", groundTool);
        const schematicPlacementTool = new SchematicPlacementTool(
            terrainBuilderProps
        );
        toolManagerRef.current.registerTool(
            "schematic",
            schematicPlacementTool
        );
        const selectionTool = new SelectionTool(terrainBuilderProps);
        toolManagerRef.current.registerTool("selection", selectionTool);

        const terrainTool = new TerrainTool(terrainBuilderProps);
        toolManagerRef.current.registerTool("terrain", terrainTool);

        // Register replace tool
        const replaceTool = new ReplaceTool(terrainBuilderProps);
        toolManagerRef.current.registerTool("replace", replaceTool);

        initialize();
        window.addEventListener("keydown", (event) => {
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
                if (
                    !window.lastKeyMoveTime ||
                    Date.now() - window.lastKeyMoveTime > 200
                ) {
                    handleCameraMove();
                    window.lastKeyMoveTime = Date.now();
                }
            }
        });
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
                clearInterval(window.chunkLoadCheckInterval);
            }
        }, 3000); // Check every 3 seconds
        return () => {
            mounted = false;
            if (window.chunkLoadCheckInterval) {
                clearInterval(window.chunkLoadCheckInterval);
                window.chunkLoadCheckInterval = null;
            }
        };
    }, [threeCamera, scene]);
    useEffect(() => {
        if (undoRedoManager?.current && toolManagerRef.current) {
            try {
                Object.values(toolManagerRef.current.tools).forEach((tool) => {
                    if (tool) {
                        tool.undoRedoManager = undoRedoManager;
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
    useEffect(() => {
        const currentInstancedMeshes = instancedMeshRef.current;
        return () => {
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
    }, [scene]); // Can't include safeRemoveFromScene due to function order
    useEffect(() => {
        if (meshesNeedsRefresh.value) {
            buildUpdateTerrain();
            meshesNeedsRefresh.value = false;
        }
    }, [meshesNeedsRefresh.value]); // Use meshesNeedsRefresh.value in the dependency array
    useEffect(() => {
        currentBlockTypeRef.current = currentBlockType;
    }, [currentBlockType]);
    useEffect(() => {
        modeRef.current = mode;
    }, [mode]);
    useEffect(() => {
        placementSizeRef.current = placementSize;
    }, [placementSize]);
    useEffect(() => {
        if (!scene || !gl) return;
        const handleTextureAtlasUpdate = (event) => {
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
            gl.render(scene, threeCamera);
            if (getChunkSystem()) {
                getChunkSystem().forceUpdateChunkVisibility(); // Changed from forceUpdateAllChunkVisibility
                getChunkSystem().processRenderQueue(true);
            }
            totalBlocksRef.current = Object.keys(terrainRef.current).length;
        };
        window.addEventListener(
            "textureAtlasUpdated",
            handleTextureAtlasUpdate
        );
        return () => {
            window.removeEventListener(
                "textureAtlasUpdated",
                handleTextureAtlasUpdate
            );
        };
    }, [scene, gl, threeCamera]);
    useEffect(() => {
        if (scene && onSceneReady) {
            onSceneReady(scene);
        }
    }, [scene, onSceneReady]);
    const saveTerrainManually = () => {
        // Ensure any buffered edits are flushed before saving
        try {
            if (toolManagerRef.current?.tools?.["terrain"]?.flushPending) {
                toolManagerRef.current.tools["terrain"].flushPending();
            }
        } catch (_) {}
        return efficientTerrainSave();
    };
    const setAutoSaveEnabled = (enabled) => {
        isAutoSaveEnabledRef.current = enabled;
        if (autoSaveIntervalRef.current) {
            clearInterval(autoSaveIntervalRef.current);
            autoSaveIntervalRef.current = null;
        }
        if (enabled) {
            autoSaveIntervalRef.current = setInterval(() => {
                if (
                    !isPlacingRef.current &&
                    pendingChangesRef.current?.terrain &&
                    (Object.keys(pendingChangesRef.current.terrain.added || {})
                        .length > 0 ||
                        Object.keys(
                            pendingChangesRef.current.terrain.removed || {}
                        ).length > 0)
                ) {
                    efficientTerrainSave();
                }
            }, AUTO_SAVE_INTERVAL);
            if (
                !isPlacingRef.current &&
                pendingChangesRef.current?.terrain &&
                (Object.keys(pendingChangesRef.current.terrain.added || {})
                    .length > 0 ||
                    Object.keys(pendingChangesRef.current.terrain.removed || {})
                        .length > 0)
            ) {
                efficientTerrainSave();
            }
        }
        return enabled;
    };
    useImperativeHandle(ref, () => ({
        buildUpdateTerrain,
        updateTerrainFromToolBar,
        getCurrentTerrainData,
        clearMap,
        saveTerrainManually, // Add manual save function
        updateTerrainBlocks, // Expose for selective updates in undo/redo
        updateTerrainForUndoRedo, // Optimized version specifically for undo/redo operations
        syncEnvironmentChangesToPending, // Expose for syncing environment changes to pending ref
        updateSpatialHashForBlocks, // Expose for external spatial hash updates
        fastUpdateBlock, // Ultra-optimized function for drag operations
        forceChunkUpdate, // Direct chunk updating for tools
        forceRefreshAllChunks, // Force refresh of all chunks
        updateGridSize, // Expose for updating grid size when importing maps
        activateTool: (toolName, activationData) => {
            if (!toolManagerRef.current) {
                console.error(
                    "Cannot activate tool: tool manager not initialized"
                );
                return false;
            }
            return toolManagerRef.current.activateTool(
                toolName,
                activationData
            );
        },
        get toolManagerRef() {
            return { current: toolManagerRef.current };
        },
        get previewPositionRef() {
            return previewPositionRef.current;
        },
        get totalBlocksRef() {
            return totalBlocksRef.current;
        },
        setDeferredChunkMeshing,
        deferSpatialHashUpdates: (defer) => {
            return spatialHashUpdateManager.setDeferSpatialHashUpdates(defer);
        },
        applyDeferredSpatialHashUpdates,
        isPendingSpatialHashUpdates: () => {
            return spatialHashUpdateManager.isPendingSpatialHashUpdates();
        },
        setViewDistance: (distance) => {
            const { setViewDistance } = require("./constants/terrain");
            setViewDistance(distance);
            const chunkSystem = getChunkSystem();
            if (chunkSystem) {
                chunkSystem.setViewDistance(distance);
            }
            forceRefreshAllChunks();
            return true;
        },

        getSelectionDistance: () => {
            return selectionDistanceRef.current;
        },
        getViewDistance: () => {
            const { getViewDistance } = require("./constants/terrain");
            return getViewDistance();
        },
        setAutoSaveInterval: (intervalMs) => {
            if (autoSaveIntervalRef.current) {
                clearInterval(autoSaveIntervalRef.current);
            }
            if (intervalMs && intervalMs > 0) {
                autoSaveIntervalRef.current = setInterval(() => {
                    if (
                        !isPlacingRef.current &&
                        pendingChangesRef.current?.terrain &&
                        (Object.keys(
                            pendingChangesRef.current.terrain.added || {}
                        ).length > 0 ||
                            Object.keys(
                                pendingChangesRef.current.terrain.removed || {}
                            ).length > 0)
                    ) {
                        efficientTerrainSave();
                    }
                }, intervalMs);
                return true;
            } else {
                autoSaveIntervalRef.current = null;
                return false;
            }
        },
        toggleAutoSave: (enabled) => {
            return setAutoSaveEnabled(enabled);
        },
        isAutoSaveEnabled: () => {
            return isAutoSaveEnabledRef.current;
        },
        isPlacing: () => {
            return isPlacingRef.current;
        },
        /**
         * Force a DB reload of terrain and then rebuild it
         */
        async refreshTerrainFromDB() {
            loadingManager.showLoading("Loading terrain data...", 0);
            return new Promise(async (resolve) => {
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
                        loadingManager.hideLoading();
                        resolve(false);
                        return;
                    }
                    const blockCount = Object.keys(blocks).length;
                    loadingManager.updateLoading(
                        `Processing ${blockCount} blocks...`,
                        30
                    );
                    terrainRef.current = {};
                    Object.entries(blocks).forEach(([posKey, blockId]) => {
                        terrainRef.current[posKey] = blockId;
                    });
                    loadingManager.updateLoading(
                        "Clearing existing terrain chunks...",
                        50
                    );
                    if (getChunkSystem()) {
                        getChunkSystem().reset();
                    }
                    const chunkSystem = getChunkSystem();
                    if (chunkSystem) {
                        loadingManager.updateLoading(
                            `Building terrain with ${blockCount} blocks...`,
                            60
                        );
                        console.log(
                            "blocks from - refreshTerrainFromDB",
                            blocks
                        );
                        chunkSystem.updateFromTerrainData(blocks);
                        loadingManager.updateLoading(
                            "Processing terrain chunks...",
                            70
                        );
                        await loadAllChunks();
                    }
                    loadingManager.updateLoading(
                        "Building spatial hash for collision detection...",
                        90
                    );
                    await initializeSpatialHash(true, false);
                    loadingManager.updateLoading(
                        "Terrain refresh complete!",
                        100
                    );
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
        forceRebuildSpatialHash: (options = {}) => {
            console.log("forceRebuildSpatialHash - terrain builder");
            if (!spatialGridManagerRef.current) {
                console.warn(
                    "TerrainBuilder: Cannot rebuild spatial hash - spatial grid manager not available"
                );
                return Promise.resolve();
            }
            disableSpatialHashUpdatesRef.current = false;
            deferSpatialHashUpdatesRef.current = false;
            try {
                spatialGridManagerRef.current.clear();
                const terrainData = getCurrentTerrainData();
                if (!terrainData || Object.keys(terrainData).length === 0) {
                    console.warn(
                        "TerrainBuilder: No terrain data available for spatial hash rebuild"
                    );
                    return Promise.resolve();
                }
                const totalBlocks = Object.keys(terrainData).length;
                const showLoading =
                    options.showLoadingScreen || totalBlocks > 100000;
                if (showLoading) {
                    loadingManager.showLoading(
                        "Rebuilding spatial hash grid..."
                    );
                }
                const blocksByChunk = {};
                for (const [posKey, blockId] of Object.entries(terrainData)) {
                    if (
                        blockId === 0 ||
                        blockId === undefined ||
                        blockId === null
                    )
                        continue;
                    const [x, y, z] = posKey.split(",").map(Number);
                    const chunkX = Math.floor(x / 16);
                    const chunkZ = Math.floor(z / 16);
                    const chunkKey = `${chunkX},${chunkZ}`;
                    if (!blocksByChunk[chunkKey]) {
                        blocksByChunk[chunkKey] = [];
                    }
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
                const MAX_CHUNKS_PER_BATCH = 10;
                const totalBatches = Math.ceil(
                    chunkKeys.length / MAX_CHUNKS_PER_BATCH
                );
                const processBatch = (batchIndex) => {
                    return new Promise((resolve) => {
                        const startIdx = batchIndex * MAX_CHUNKS_PER_BATCH;
                        const endIdx = Math.min(
                            startIdx + MAX_CHUNKS_PER_BATCH,
                            chunkKeys.length
                        );
                        const batchChunks = chunkKeys.slice(startIdx, endIdx);
                        const batchBlocks = [];
                        batchChunks.forEach((chunkKey) => {
                            batchBlocks.push(...blocksByChunk[chunkKey]);
                        });
                        if (batchBlocks.length === 0) {
                            resolve();
                            return;
                        }
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
                        spatialGridManagerRef.current.updateBlocks(
                            batchBlocks,
                            [], // No blocks to remove
                            {
                                force: true,
                                silent: false,
                                skipIfBusy: false,
                            }
                        );

                        environmentBuilderRef.current.forceRebuildSpatialHash();

                        setTimeout(() => resolve(), 0);
                    });
                };
                return new Promise(async (resolve) => {
                    for (let i = 0; i < totalBatches; i++) {
                        await processBatch(i);
                    }
                    if (
                        typeof forceChunkUpdate === "function" &&
                        chunkKeys.length > 0
                    ) {
                        forceChunkUpdate(chunkKeys, { skipNeighbors: true });
                    } else if (typeof forceRefreshAllChunks === "function") {
                        forceRefreshAllChunks();
                    }
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

    useEffect(() => {
        const handleResize = () => {
            canvasRectRef.current = null; // Force recalculation on next update
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);
    const handleKeyDown = (event) => {
        if (toolManagerRef.current && toolManagerRef.current.getActiveTool()) {
            toolManagerRef.current.handleKeyDown(event);
        }
    };
    const handleKeyUp = (event) => {
        if (toolManagerRef.current && toolManagerRef.current.getActiveTool()) {
            toolManagerRef.current.handleKeyUp(event);
        }
    };
    useEffect(() => {
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, []);
    useEffect(() => {
        initializeMouseButtonTracking();
        return () => {
            cleanupMouseButtonTracking();
        };
    }, []);
    useEffect(() => {
        return () => {
            if (toolManagerRef.current) {
                toolManagerRef.current.dispose();
                toolManagerRef.current = null;
            }
        };
    }, []);
    const syncEnvironmentChangesToPending = (
        addedEnvironment = [],
        removedEnvironment = []
    ) => {
        if (!pendingChangesRef.current) {
            pendingChangesRef.current = {
                terrain: { added: {}, removed: {} },
                environment: { added: [], removed: [] },
            };
        }

        // Process added environment objects: add to "added" list and remove from "removed" if present
        addedEnvironment.forEach((envObj) => {
            // Remove from removed list if it exists there (by instanceId and modelUrl)
            pendingChangesRef.current.environment.removed =
                pendingChangesRef.current.environment.removed.filter(
                    (removedObj) =>
                        !(
                            removedObj.instanceId === envObj.instanceId &&
                            removedObj.modelUrl === envObj.modelUrl
                        )
                );

            // Add to added list (avoid duplicates by instanceId and modelUrl)
            const existingIndex =
                pendingChangesRef.current.environment.added.findIndex(
                    (addedObj) =>
                        addedObj.instanceId === envObj.instanceId &&
                        addedObj.modelUrl === envObj.modelUrl
                );
            if (existingIndex === -1) {
                pendingChangesRef.current.environment.added.push(envObj);
            } else {
                // Update existing entry
                pendingChangesRef.current.environment.added[existingIndex] =
                    envObj;
            }
        });

        // Process removed environment objects: if it was newly added in this session, drop it from "added"; otherwise record in "removed"
        removedEnvironment.forEach((envObj) => {
            // Check if this object was added in this session
            const addedIndex =
                pendingChangesRef.current.environment.added.findIndex(
                    (addedObj) =>
                        addedObj.instanceId === envObj.instanceId &&
                        addedObj.modelUrl === envObj.modelUrl
                );

            if (addedIndex !== -1) {
                // Remove from added list since it was added in this session
                pendingChangesRef.current.environment.added.splice(
                    addedIndex,
                    1
                );
            } else {
                // Add to removed list (avoid duplicates)
                const existingIndex =
                    pendingChangesRef.current.environment.removed.findIndex(
                        (removedObj) =>
                            removedObj.instanceId === envObj.instanceId &&
                            removedObj.modelUrl === envObj.modelUrl
                    );
                if (existingIndex === -1) {
                    pendingChangesRef.current.environment.removed.push(envObj);
                }
            }
        });
    };

    const updateTerrainBlocks = (addedBlocks, removedBlocks, options = {}) => {
        if (!addedBlocks && !removedBlocks) return;
        // Ensure objects
        addedBlocks = addedBlocks || {};
        removedBlocks = removedBlocks || {};

        // === Replacement-aware filter ===
        // If a key exists in both addedBlocks and removedBlocks it means the block is being
        // swapped (replaced) – NOT removed.  In that case we should keep the value from
        // addedBlocks and ignore the corresponding entry in removedBlocks so that we do not
        // delete the block we just re-added.
        const replacementKeys = Object.keys(addedBlocks).filter(
            (k) => k in removedBlocks
        );
        if (replacementKeys.length > 0) {
            removedBlocks = { ...removedBlocks }; // shallow clone to avoid mutating caller refs
            replacementKeys.forEach((k) => delete removedBlocks[k]);
        }
        // === End replacement-aware filter ===

        if (
            Object.keys(addedBlocks).length === 0 &&
            Object.keys(removedBlocks).length === 0
        )
            return;

        // Re-order trackTerrainChanges call so it uses the filtered sets
        trackTerrainChanges(addedBlocks, removedBlocks);

        if (options?.syncPendingChanges) {
            // Synchronise TerrainBuilder-level pendingChangesRef so that manual/auto-save picks up changes
            if (!pendingChangesRef.current) {
                pendingChangesRef.current = {
                    terrain: { added: {}, removed: {} },
                    environment: { added: [], removed: [] },
                };
            }

            // Process added blocks: add to "added" list and remove from "removed" if present
            Object.entries(addedBlocks).forEach(([key, val]) => {
                if (pendingChangesRef.current.terrain.removed[key]) {
                    delete pendingChangesRef.current.terrain.removed[key];
                }
                pendingChangesRef.current.terrain.added[key] = val;
            });

            // Process removed blocks: if it was newly added in this session, drop it from "added"; otherwise record in "removed"
            Object.entries(removedBlocks).forEach(([key, val]) => {
                if (pendingChangesRef.current.terrain.added[key]) {
                    delete pendingChangesRef.current.terrain.added[key];
                } else {
                    pendingChangesRef.current.terrain.removed[key] = val;
                }
            });
        }
        Object.entries(addedBlocks).forEach(([posKey, blockId]) => {
            if (!isNaN(parseInt(blockId))) {
                let dataUri = null;
                if (customBlocks && customBlocks[blockId]) {
                    dataUri = customBlocks[blockId].dataUri;
                }
                if (!dataUri && typeof localStorage !== "undefined") {
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
                if (dataUri && dataUri.startsWith("data:image/")) {
                    localStorage.setItem(`block-texture-${blockId}`, dataUri);
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
        Object.entries(addedBlocks).forEach(([posKey, blockId]) => {
            terrainRef.current[posKey] = blockId;
        });

        Object.entries(removedBlocks).forEach(([posKey]) => {
            delete terrainRef.current[posKey];
        });
        totalBlocksRef.current = Object.keys(terrainRef.current).length;
        importedUpdateTerrainBlocks(addedBlocks, removedBlocks);
        if (!options.skipSpatialHash) {
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
            updateSpatialHashForBlocks(addedBlocksArray, removedBlocksArray, {
                force: true,
            });
        }
    };
    const applyDeferredSpatialHashUpdates = async () => {
        return spatialHashUpdateManager.applyDeferredSpatialHashUpdates(
            spatialGridManagerRef.current
        );
    };
    useEffect(() => {
        cameraManager.setInputDisabled(isInputDisabled);
    }, [isInputDisabled]);
    const handleCameraMove = () => {
        if (!threeCamera) return;
        updateChunkSystemCamera(threeCamera);
        loadNewChunksInViewDistance();
        processChunkRenderQueue();
    };
    const loadNewChunksInViewDistance = () => {
        const chunkSystem = getChunkSystem();
        if (!chunkSystem || !threeCamera) {
            return;
        }
        processChunkRenderQueue();
    };
    handleCameraMove.lastUpdateTime = 0;

    useEffect(() => {
        const canvas = gl.domElement;
        if (!canvas) return;
        const handleCanvasMouseDown = (event) => {
            handleMouseDown(event);
        };
        const handleCanvasMouseUp = (event) => {
            handleMouseUp(event);
        };
        const handleContextMenu = (event) => {
            if (
                !cameraManager.isPointerUnlockedMode &&
                cameraManager.isPointerLocked
            ) {
                event.preventDefault();
            }
        };
        canvas.addEventListener("mousedown", handleCanvasMouseDown);
        canvas.addEventListener("mouseup", handleCanvasMouseUp);
        canvas.addEventListener("contextmenu", handleContextMenu);
        return () => {
            canvas.removeEventListener("mousedown", handleCanvasMouseDown);
            canvas.removeEventListener("mouseup", handleCanvasMouseUp);
            canvas.removeEventListener("contextmenu", handleContextMenu);
        };
    }, [gl, handleMouseDown, handleMouseUp, cameraManager]); // Add dependencies
    useEffect(() => {
        optimizeRenderer(gl);
        cameraManager.initialize(threeCamera, orbitControlsRef.current);
        let frameId;
        let frameCount = 0;
        const animate = (time) => {
            frameId = requestAnimationFrame(animate);
            if (BlockMaterial.instance.liquidMaterial) {
                BlockMaterial.instance.liquidMaterial.uniforms.time.value =
                    (time / 1000) * 0.5;
            }
            if (isPlacingRef.current && frameCount % 30 === 0) {
                if (!window.mouseButtons || !(window.mouseButtons & 1)) {
                    console.warn(
                        "Detected mouse button up while still in placing mode - fixing state"
                    );
                    handleMouseUp({ button: 0 });
                }
            }
            if (isPlacingRef.current) {
                updatePreviewPosition();
            }
            frameCount++;
            if (!threeCamera) {
                console.warn("[Animation] Three camera is null or undefined");
                return;
            }
            if (!currentCameraRef.current) {
                console.warn("[Animation] Current camera reference is not set");
                currentCameraRef.current = threeCamera;
            }
            cameraMovementTracker.updateCameraMovement(threeCamera);
            if (frameCount % 5 === 0) {
                updateChunkSystemWithCamera();
            }
            if (frameCount % 60 === 0) {
                const {
                    forceUpdateChunkVisibility,
                } = require("./chunks/TerrainBuilderIntegration");
                forceUpdateChunkVisibility();
            }
        };
        frameId = requestAnimationFrame(animate);
        return () => {
            cancelAnimationFrame(frameId);
        };
    }, [gl]);

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
export default forwardRef(TerrainBuilder);
export {
    blockTypes,
    getBlockTypes,
    getCustomBlocks,
    processCustomBlock,
} from "./managers/BlockTypesManager";
