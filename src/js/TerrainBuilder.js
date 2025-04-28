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
import BlockTextureAtlas from "./blocks/BlockTextureAtlas";
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
import { DatabaseManager, STORES } from "./DatabaseManager";
import { loadingManager } from "./LoadingManager";
import { playPlaceSound } from "./Sound";
import {
    CHUNK_SIZE,
    getViewDistance,
    MAX_SELECTION_DISTANCE,
    THRESHOLD_FOR_PLACING,
} from "./constants/terrain";
import {
    GroundTool,
    PipeTool,
    SchematicPlacementTool,
    ToolManager,
    WallTool,
} from "./tools";
import SeedGeneratorTool from "./tools/SeedGeneratorTool"; // Add SeedGeneratorTool import
import BlockMaterial from "./blocks/BlockMaterial"; // Add this import
import BlockTypeRegistry from "./blocks/BlockTypeRegistry";
import { processCustomBlock } from "./managers/BlockTypesManager";
import { SpatialGridManager } from "./managers/SpatialGridManager";
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
    const spatialHashUpdateQueuedRef = useRef(false);
    const spatialHashLastUpdateRef = useRef(0);
    const disableSpatialHashUpdatesRef = useRef(false); // Flag to completely disable spatial hash updates
    const deferSpatialHashUpdatesRef = useRef(false); // Flag to defer spatial hash updates during loading
    const pendingSpatialHashUpdatesRef = useRef({ added: [], removed: [] }); // Store deferred updates
    const firstLoadCompletedRef = useRef(false); // Flag to track if the first load is complete
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
    const initialSaveCompleteRef = useRef(false);
    const autoSaveIntervalRef = useRef(null);
    const AUTO_SAVE_INTERVAL = 300000; // Auto-save every 5 minutes (300,000 ms)
    const isAutoSaveEnabledRef = useRef(true); // Default to enabled, but can be toggled
    const gridSizeRef = useRef(gridSize); // Add a ref to maintain grid size state
    useEffect(() => {
        const setupAutoSave = () => {
            if (autoSaveIntervalRef.current) {
                clearInterval(autoSaveIntervalRef.current);
                autoSaveIntervalRef.current = null;
            }
            if (isAutoSaveEnabledRef.current) {
                autoSaveIntervalRef.current = setInterval(() => {
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
            if (window.IS_DATABASE_CLEARING) {
                return;
            }
            if (!pendingChangesRef || !pendingChangesRef.current) {
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
    }, []);
    const trackTerrainChanges = (added = {}, removed = {}) => {
        if (window.IS_DATABASE_CLEARING) {
            return;
        }
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
        if (!pendingChangesRef.current.terrain) {
            pendingChangesRef.current.terrain = {
                added: {},
                removed: {},
            };
        }
        if (!pendingChangesRef.current.environment) {
            pendingChangesRef.current.environment = {
                added: [],
                removed: [],
            };
        }
        const safeAdded = added || {};
        const safeRemoved = removed || {};
        Object.entries(safeAdded).forEach(([key, value]) => {
            if (pendingChangesRef.current?.terrain?.added) {
                pendingChangesRef.current.terrain.added[key] = value;
            }
            if (
                pendingChangesRef.current?.terrain?.removed &&
                pendingChangesRef.current.terrain.removed[key]
            ) {
                delete pendingChangesRef.current.terrain.removed[key];
            }
        });
        Object.entries(safeRemoved).forEach(([key, value]) => {
            if (
                pendingChangesRef.current?.terrain?.added &&
                pendingChangesRef.current.terrain.added[key]
            ) {
                delete pendingChangesRef.current.terrain.added[key];
            } else if (pendingChangesRef.current?.terrain?.removed) {
                pendingChangesRef.current.terrain.removed[key] = value;
            }
        });
    };
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
    const efficientTerrainSave = async () => {
        if (window.IS_DATABASE_CLEARING) {
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
        resetPendingChanges();
        try {
            const db = await DatabaseManager.getDBConnection();
            const tx = db.transaction(STORES.TERRAIN, "readwrite");
            const store = tx.objectStore(STORES.TERRAIN);
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
            await new Promise((resolve, reject) => {
                tx.oncomplete = resolve;
                tx.onerror = reject;
            });
            lastSaveTimeRef.current = Date.now(); // Update last save time
            return true;
        } catch (error) {
            console.error("Error during efficient terrain save:", error);
            pendingChangesRef.current.terrain = changesToSave;
            return false;
        }
    };
    useEffect(() => {
        initialSaveCompleteRef.current = false;
        pendingChangesRef.current = { added: {}, removed: {} };
        lastSaveTimeRef.current = Date.now();
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
    const spatialGridManagerRef = useRef(
        new SpatialGridManager(loadingManager)
    );
    const orbitControlsRef = useRef(null);
    const frustumRef = useRef(new THREE.Frustum());
    const meshesInitializedRef = useRef(false);
    const cameraMoving = useRef(false);
    const useSpatialHashRef = useRef(true);
    const totalBlocksRef = useRef(0);
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
    const [previewPosition, setPreviewPosition] = useState(new THREE.Vector3());
    const recentlyPlacedBlocksRef = useRef(new Set());
    const canvasRectRef = useRef(null);
    const tempVectorRef = useRef(new THREE.Vector3());
    const toolManagerRef = useRef(null);
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
                    console.time("updateTerrainChunks");
                    updateTerrainChunks(terrainBlocks, deferMeshBuilding);
                    console.timeEnd("updateTerrainChunks");
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
                                pendingChangesRef.current.added[posKey] =
                                    blockId;
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
                    console.time("updateTerrainChunks");
                    updateTerrainChunks(terrainBlocks, deferMeshBuilding);
                    console.timeEnd("updateTerrainChunks");
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
    const handleMouseDown = (e) => {
        const isToolActive =
            toolManagerRef.current && toolManagerRef.current.getActiveTool();
        if (isToolActive) {
            const intersection = getRaycastIntersection();
            if (intersection) {
                const mouseEvent = {
                    ...e,
                    normal: intersection.normal,
                };
                toolManagerRef.current.handleMouseDown(
                    mouseEvent,
                    intersection.point,
                    e.button
                );
                return;
            }
        }
        if (e.button === 0) {
            if (!isToolActive) {
                isPlacingRef.current = true;
                const initialBlockIntersection = getRaycastIntersection();
                if (initialBlockIntersection) {
                    currentPlacingYRef.current = previewPositionRef.current.y; // Use current preview Y
                }
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
                placementChangesRef.current = {
                    terrain: { added: {}, removed: {} },
                    environment: { added: [], removed: [] },
                };
                updatePreviewPosition();
                if (isFirstBlockRef.current) {
                    handleBlockPlacement();
                }
                playPlaceSound(); // Play sound on initial click
            }
        }
    };
    const handleBlockPlacement = () => {
        if (toolManagerRef.current && toolManagerRef.current.getActiveTool()) {
            return;
        }
        if (!modeRef.current || !isPlacingRef.current) return;
        if (currentBlockTypeRef.current?.isEnvironment) {
            if (isFirstBlockRef.current) {
                if (
                    environmentBuilderRef.current &&
                    typeof environmentBuilderRef.current
                        .placeEnvironmentModel === "function"
                ) {
                    try {
                        const result =
                            environmentBuilderRef.current.placeEnvironmentModel(
                                modeRef.current
                            );
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
            if (modeRef.current === "add") {
                const now = performance.now();
                const positions = getPlacementPositions(
                    previewPositionRef.current,
                    placementSizeRef.current
                );
                const addedBlocks = {};
                let blockWasPlaced = false; // Flag to track if any block was actually placed
                positions.forEach((pos) => {
                    const blockKey = `${pos.x},${pos.y},${pos.z}`;
                    if (!terrainRef.current[blockKey]) {
                        addedBlocks[blockKey] = currentBlockTypeRef.current.id;
                        terrainRef.current[blockKey] =
                            currentBlockTypeRef.current.id;
                        recentlyPlacedBlocksRef.current.add(blockKey);
                        placementChangesRef.current.terrain.added[blockKey] =
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
            } else if (modeRef.current === "remove") {
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
                    if (terrainRef.current[blockKey]) {
                        removedBlocks[blockKey] = terrainRef.current[blockKey];
                        delete terrainRef.current[blockKey];
                        placementChangesRef.current.terrain.removed[blockKey] =
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
    const getRaycastIntersection = () => {
        if (!scene || !threeCamera || !threeRaycaster) return null;
        const normalizedMouse = pointer.clone();
        threeRaycaster.setFromCamera(normalizedMouse, threeCamera);
        let intersection = null;
        if (
            useSpatialHashRef.current &&
            spatialGridManagerRef.current &&
            spatialGridManagerRef.current.size > 0
        ) {
            intersection = getOptimizedRaycastIntersection(true); // Always prioritize blocks
        } else {
            const rayOrigin = threeRaycaster.ray.origin;
            const rayDirection = threeRaycaster.ray.direction;
            const target = new THREE.Vector3();
            const intersectionDistance = rayOrigin.y / -rayDirection.y;
            if (
                intersectionDistance > 0 &&
                intersectionDistance < selectionDistanceRef.current
            ) {
                target
                    .copy(rayOrigin)
                    .addScaledVector(rayDirection, intersectionDistance);
                const gridSizeHalf = gridSizeRef.current / 2;
                if (
                    Math.abs(target.x) <= gridSizeHalf &&
                    Math.abs(target.z) <= gridSizeHalf
                ) {
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
    const updatePreviewPosition = () => {
        if (updatePreviewPosition.isProcessing) {
            return;
        }
        updatePreviewPosition.isProcessing = true;
        if (!canvasRectRef.current) {
            canvasRectRef.current = gl.domElement.getBoundingClientRect();
        }
        const blockIntersection = getRaycastIntersection();
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Plane at y=0
        const currentGroundPoint = new THREE.Vector3();
        const normalizedMouse = pointer.clone();
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
            if (modeRef.current === "delete" || modeRef.current === "remove") {
                if (blockIntersection.block) {
                    potentialNewPosition.x = blockIntersection.block.x;
                    potentialNewPosition.y = blockIntersection.block.y;
                    potentialNewPosition.z = blockIntersection.block.z;
                } else {
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
                    potentialNewPosition.x = Math.round(potentialNewPosition.x);
                    potentialNewPosition.y = Math.round(potentialNewPosition.y);
                    potentialNewPosition.z = Math.round(potentialNewPosition.z);
                } else {
                    potentialNewPosition.add(
                        blockIntersection.normal.clone().multiplyScalar(0.5)
                    );
                    potentialNewPosition.x = Math.round(potentialNewPosition.x);
                    potentialNewPosition.y = Math.round(potentialNewPosition.y);
                    potentialNewPosition.z = Math.round(potentialNewPosition.z);
                }
                if (
                    blockIntersection.isGroundPlane &&
                    modeRef.current === "add"
                ) {
                    potentialNewPosition.y = 0; // Position at y=0 when placing on ground plane
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
                handleBlockPlacement();
            }
        }
        updatePreviewPosition.isProcessing = false;
    };
    updatePreviewPosition.isProcessing = false;
    const handleMouseUp = (e) => {
        const isToolActive =
            toolManagerRef.current && toolManagerRef.current.getActiveTool();
        if (isToolActive) {
            const intersection = getRaycastIntersection();
            if (intersection) {
                const mouseEvent = {
                    ...e,
                    normal: intersection.normal,
                };
                toolManagerRef.current.handleMouseUp(
                    mouseEvent,
                    intersection.point,
                    e.button
                );
                return;
            }
        }
        if (isPlacingRef.current) {
            isPlacingRef.current = false;
            if (placedBlockCountRef.current > 0) {
                if (spatialGridManagerRef.current) {
                    const addedBlocks = Array.from(
                        recentlyPlacedBlocksRef.current
                    ).map((posKey) => {
                        return [posKey, terrainRef.current[posKey]];
                    });
                    spatialGridManagerRef.current.updateBlocks(addedBlocks, []);
                }
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
                    if (undoRedoManager?.current?.saveUndo) {
                        undoRedoManager.current.saveUndo(
                            placementChangesRef.current
                        );
                    } else {
                        console.warn(
                            "No direct access to saveUndo function, trying fallbacks"
                        );
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
                placedBlockCountRef.current = 0;
            }
            recentlyPlacedBlocksRef.current.clear();
        }
    };
    const getPlacementPositions = (centerPos, placementSize) => {
        const positions = [];
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
    const updateTerrainFromToolBar = (terrainData) => {
        loadingManager.showLoading("Starting Minecraft map import...", 0);
        terrainRef.current = terrainData;
        if (terrainData && Object.keys(terrainData).length > 0) {
            const totalBlocks = Object.keys(terrainData).length;
            loadingManager.updateLoading(
                `Processing ${totalBlocks.toLocaleString()} blocks...`,
                5
            );
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
            const width = maxX - minX + 10;
            const length = maxZ - minZ + 10;
            const gridSize = Math.ceil(Math.max(width, length) / 16) * 16;
            updateGridSize(gridSize);
        }
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
                            if (sendTotalBlocks) {
                                sendTotalBlocks(totalBlocksRef.current);
                            }
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
            loadingManager.hideLoading();
        }
    };
    const updateGridSize = (newGridSize) => {
        if (gridRef.current) {
            let gridSizeToUse;
            if (newGridSize) {
                gridSizeToUse = newGridSize;
                localStorage.setItem("gridSize", gridSizeToUse.toString());
            } else {
                gridSizeToUse =
                    parseInt(localStorage.getItem("gridSize"), 10) || 200; // Default to 200
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
    const updateDebugInfo = () => {
        setDebugInfo({
            preview: previewPositionRef.current,
            totalBlocks: totalBlocksRef.current,
            isGroundPlane: previewIsGroundPlaneRef.current,
        });
        if (sendTotalBlocks) {
            sendTotalBlocks(totalBlocksRef.current);
        }
    };
    const clearMap = () => {
        window.IS_DATABASE_CLEARING = true;
        try {
            terrainRef.current = {};
            totalBlocksRef.current = 0;
            if (sendTotalBlocks) {
                sendTotalBlocks(0);
            }
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
                    await DatabaseManager.saveData(STORES.UNDO, "states", []);
                    await DatabaseManager.saveData(STORES.REDO, "states", []);
                    if (undoRedoManager?.current?.clearHistory) {
                        undoRedoManager.current.clearHistory();
                    }
                } catch (error) {
                    console.error("Failed to clear undo/redo history:", error);
                }
            };
            clearUndoRedo(); // Call async clear
            updateDebugInfo();
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
            window.IS_DATABASE_CLEARING = false;
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
        updateGridSize(gridSize);
    }, [gridSize]);
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
                    return DatabaseManager.getData(STORES.TERRAIN, "current");
                })
                .then((savedTerrain) => {
                    if (!mounted) return;
                    if (savedTerrain) {
                        terrainRef.current = savedTerrain;
                        totalBlocksRef.current = Object.keys(
                            terrainRef.current
                        ).length;
                        pendingChangesRef.current = { added: {}, removed: {} };
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
                                updateTerrainChunks(terrainRef.current, true); // Set true to only load visible chunks
                                processChunkRenderQueue();
                                window.fullTerrainDataRef = terrainRef.current;
                                window.pendingChunksToLoad = new Set();
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
            activateTool: (toolName, activationData) =>
                toolManagerRef.current?.activateTool(toolName, activationData),
        };
        toolManagerRef.current = new ToolManager(terrainBuilderProps);
        const wallTool = new WallTool(terrainBuilderProps);
        toolManagerRef.current.registerTool("wall", wallTool);
        const groundTool = new GroundTool(terrainBuilderProps);
        toolManagerRef.current.registerTool("ground", groundTool);
        const pipeTool = new PipeTool(terrainBuilderProps);
        toolManagerRef.current.registerTool("pipe", pipeTool);
        const seedGeneratorTool = new SeedGeneratorTool(terrainBuilderProps);
        toolManagerRef.current.registerTool("seed", seedGeneratorTool);
        const schematicPlacementTool = new SchematicPlacementTool(
            terrainBuilderProps
        );
        toolManagerRef.current.registerTool(
            "schematic",
            schematicPlacementTool
        );
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
            if (sendTotalBlocks) {
                sendTotalBlocks(totalBlocksRef.current);
            }
            updateDebugInfo();
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
                    (Object.keys(pendingChangesRef.current.terrain.added)
                        .length > 0 ||
                        Object.keys(pendingChangesRef.current.terrain.removed)
                            .length > 0)
                ) {
                    efficientTerrainSave();
                }
            }, AUTO_SAVE_INTERVAL);
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
    useImperativeHandle(ref, () => ({
        buildUpdateTerrain,
        updateTerrainFromToolBar,
        getCurrentTerrainData,
        clearMap,
        saveTerrainManually, // Add manual save function
        updateTerrainBlocks, // Expose for selective updates in undo/redo
        updateTerrainForUndoRedo, // Optimized version specifically for undo/redo operations
        updateSpatialHashForBlocks, // Expose for external spatial hash updates
        fastUpdateBlock, // Ultra-optimized function for drag operations
        updateDebugInfo, // Expose debug info updates for tools
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
        setDeferredChunkMeshing,
        deferSpatialHashUpdates: (defer) => {
            deferSpatialHashUpdatesRef.current = defer;
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
        window.mouseButtons = 0;
        const updateMouseButtonsDown = (e) => {
            window.mouseButtons |= 1 << e.button;
        };
        const updateMouseButtonsUp = (e) => {
            window.mouseButtons &= ~(1 << e.button);
        };
        document.addEventListener("mousedown", updateMouseButtonsDown);
        document.addEventListener("mouseup", updateMouseButtonsUp);
        document.addEventListener("mouseleave", updateMouseButtonsUp); // Handle case when mouse leaves window
        return () => {
            document.removeEventListener("mousedown", updateMouseButtonsDown);
            document.removeEventListener("mouseup", updateMouseButtonsUp);
            document.removeEventListener("mouseleave", updateMouseButtonsUp);
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
    const updateTerrainBlocks = (addedBlocks, removedBlocks, options = {}) => {
        if (!addedBlocks && !removedBlocks) return;
        addedBlocks = addedBlocks || {};
        removedBlocks = removedBlocks || {};
        if (
            Object.keys(addedBlocks).length === 0 &&
            Object.keys(removedBlocks).length === 0
        )
            return;
        console.time("updateTerrainBlocks");
        trackTerrainChanges(addedBlocks, removedBlocks);
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
        if (sendTotalBlocks) {
            sendTotalBlocks(totalBlocksRef.current);
        }
        updateDebugInfo();
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
        console.timeEnd("updateTerrainBlocks");
    };
    const updateTerrainForUndoRedo = (
        addedBlocks,
        removedBlocks,
        source = "undo/redo"
    ) => {
        console.time(`updateTerrainForUndoRedo-${source}`);
        trackTerrainChanges(addedBlocks, removedBlocks); // <<< Add this line
        addedBlocks = addedBlocks || {};
        removedBlocks = removedBlocks || {};
        if (
            Object.keys(addedBlocks).length === 0 &&
            Object.keys(removedBlocks).length === 0
        ) {
            console.timeEnd(`updateTerrainForUndoRedo-${source}`);
            return;
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
        Object.entries(addedBlocks).forEach(([posKey, blockId]) => {
            terrainRef.current[posKey] = blockId;
        });
        Object.entries(removedBlocks).forEach(([posKey]) => {
            delete terrainRef.current[posKey];
        });
        totalBlocksRef.current = Object.keys(terrainRef.current).length;
        if (sendTotalBlocks) {
            sendTotalBlocks(totalBlocksRef.current);
        }
        updateDebugInfo();
        importedUpdateTerrainBlocks(addedBlocks, removedBlocks);
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
        console.timeEnd(`updateTerrainForUndoRedo-${source}`);
    };
    const getOptimizedRaycastIntersection = (prioritizeBlocks = true) => {
        if (!scene || !threeCamera || !threeRaycaster) return null;
        const normalizedMouse = pointer.clone();
        threeRaycaster.setFromCamera(normalizedMouse, threeCamera);
        let intersection = null;
        if (
            useSpatialHashRef.current &&
            spatialGridManagerRef.current &&
            spatialGridManagerRef.current.size > 0
        ) {
            const raycastOptions = {
                maxDistance: selectionDistanceRef.current,
                prioritizeBlocks,
                gridSize: gridSizeRef.current,
                recentlyPlacedBlocks: recentlyPlacedBlocksRef.current,
                isPlacing: isPlacingRef.current,
                mode: modeRef.current,
                debug: true, // Enable debug logging for this call
            };
            const gridResult = spatialGridManagerRef.current.raycast(
                threeRaycaster,
                threeCamera,
                raycastOptions
            );
            intersection = gridResult;
        } else {
            const rayOrigin = threeRaycaster.ray.origin;
            const rayDirection = threeRaycaster.ray.direction;
            const target = new THREE.Vector3();
            const intersectionDistance = rayOrigin.y / -rayDirection.y;
            if (
                intersectionDistance > 0 &&
                intersectionDistance < selectionDistanceRef.current
            ) {
                target
                    .copy(rayOrigin)
                    .addScaledVector(rayDirection, intersectionDistance);
                const gridSizeHalf = gridSizeRef.current / 2;
                if (
                    Math.abs(target.x) <= gridSizeHalf &&
                    Math.abs(target.z) <= gridSizeHalf
                ) {
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
    useEffect(() => {
        const canvas = gl.domElement;
        if (!canvas) return;
        const handleCanvasMouseDown = (event) => {
            handleMouseDown(event);
        };
        const handleCanvasMouseUp = (event) => {
            handleMouseUp(event);
        };
        canvas.addEventListener("mousedown", handleCanvasMouseDown);
        canvas.addEventListener("mouseup", handleCanvasMouseUp);
        return () => {
            canvas.removeEventListener("mousedown", handleCanvasMouseDown);
            canvas.removeEventListener("mouseup", handleCanvasMouseUp);
        };
    }, [gl, handleMouseDown, handleMouseUp]); // Add dependencies
    const lastCameraPosition = new THREE.Vector3();
    const lastCameraRotation = new THREE.Euler();
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
            frameCount++;
            if (!threeCamera) {
                console.warn("[Animation] Three camera is null or undefined");
                return;
            }
            if (!currentCameraRef.current) {
                console.warn("[Animation] Current camera reference is not set");
                currentCameraRef.current = threeCamera;
            }
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
            lastCameraPosition.x = posX;
            lastCameraPosition.y = posY;
            lastCameraPosition.z = posZ;
            lastCameraRotation.x = rotX;
            lastCameraRotation.y = rotY;
            lastCameraRotation.z = rotZ;
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
    const updateSpatialHashForBlocks = (
        addedBlocks = [],
        removedBlocks = [],
        options = {}
    ) => {
        if (disableSpatialHashUpdatesRef.current) {
            return;
        }
        if (!spatialGridManagerRef.current) {
            return;
        }
        const validAddedBlocks = Array.isArray(addedBlocks) ? addedBlocks : [];
        const validRemovedBlocks = Array.isArray(removedBlocks)
            ? removedBlocks
            : [];
        if (validAddedBlocks.length === 0 && validRemovedBlocks.length === 0) {
            return;
        }
        if (deferSpatialHashUpdatesRef.current && !options.force) {
            pendingSpatialHashUpdatesRef.current.added.push(
                ...validAddedBlocks
            );
            pendingSpatialHashUpdatesRef.current.removed.push(
                ...validRemovedBlocks
            );
            return;
        }
        if (
            !options.force &&
            (validAddedBlocks.length > 100 || validRemovedBlocks.length > 100)
        ) {
            return;
        }
        const now = performance.now();
        if (now - spatialHashLastUpdateRef.current < 1000 && !options.force) {
            if (
                validAddedBlocks.length + validRemovedBlocks.length <= 10 &&
                !spatialHashUpdateQueuedRef.current
            ) {
                spatialHashUpdateQueuedRef.current = true;
                setTimeout(() => {
                    if (
                        spatialGridManagerRef.current &&
                        !spatialGridManagerRef.current.isProcessing
                    ) {
                        try {
                            const camera = cameraRef.current;
                            if (camera && !options.force) {
                                spatialGridManagerRef.current.updateFrustumCache(
                                    camera,
                                    getViewDistance()
                                );
                                const filteredAddedBlocks =
                                    validAddedBlocks.filter((block) => {
                                        if (!block || typeof block !== "object")
                                            return false;
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
                                const filteredRemovedBlocks =
                                    validRemovedBlocks.filter((block) => {
                                        if (!block) return false;
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
                            console.error("Error updating spatial hash:", e);
                        }
                    }
                    setTimeout(() => {
                        spatialHashUpdateQueuedRef.current = false;
                    }, 1000);
                }, 1000);
            }
            return;
        }
        spatialHashLastUpdateRef.current = now;
        if (cameraMoving.current && !options.force) {
            return;
        }
        try {
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
            const camera = cameraRef.current;
            if (camera) {
                spatialGridManagerRef.current.updateFrustumCache(
                    camera,
                    getViewDistance()
                );
                const filteredAddedBlocks = validAddedBlocks.filter((block) => {
                    if (!block || typeof block !== "object") return false;
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
                const filteredRemovedBlocks = validRemovedBlocks.filter(
                    (block) => {
                        if (!block) return false;
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
            console.error("Error updating spatial hash:", e);
        }
    };
    const applyDeferredSpatialHashUpdates = async () => {
        if (
            pendingSpatialHashUpdatesRef.current.added.length === 0 &&
            pendingSpatialHashUpdatesRef.current.removed.length === 0
        ) {
            return;
        }
        const added = [...pendingSpatialHashUpdatesRef.current.added];
        const removed = [...pendingSpatialHashUpdatesRef.current.removed];
        pendingSpatialHashUpdatesRef.current = { added: [], removed: [] };
        return updateSpatialHashForBlocks(added, removed, { force: true });
    };
    useEffect(() => {
        cameraManager.setInputDisabled(isInputDisabled);
    }, [isInputDisabled]);
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
const setDeferredChunkMeshing = (defer) => {
    const chunkSystem = getChunkSystem();
    if (!chunkSystem) {
        console.error(
            "Cannot set deferred chunk meshing: chunk system not available"
        );
        return false;
    }
    let priorityDistance = Math.min(32, getViewDistance() / 2);
    priorityDistance = Math.max(24, priorityDistance);
    if (!defer) {
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
    const deferMeshBuilding = options.deferMeshBuilding !== false;
    const priorityDistance =
        options.priorityDistance || Math.max(32, getViewDistance() * 0.33);
    if (deferMeshBuilding) {
        chunkSystem.setBulkLoadingMode(true, priorityDistance);
    } else {
        chunkSystem.setBulkLoadingMode(false);
    }
    return true;
};
export {
    configureChunkLoading,
    forceChunkUpdate,
    forceChunkUpdateByOrigin,
    loadAllChunks,
    setDeferredChunkMeshing,
};
const loadAllChunks = async () => {
    const chunkSystem = getChunkSystem();
    if (!chunkSystem) {
        console.warn("No chunk system available for loading chunks");
        return;
    }
    const scene = chunkSystem._scene;
    const camera = scene?.camera;
    if (!camera) {
        console.warn("No camera available for prioritizing chunks");
        return;
    }
    const cameraPos = camera.position;
    const chunkIds = Array.from(chunkSystem._chunkManager._chunks.keys());
    const chunksWithDistances = chunkIds.map((chunkId) => {
        const [x, y, z] = chunkId.split(",").map(Number);
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
    chunksWithDistances.sort((a, b) => a.distance - b.distance);
    const BATCH_SIZE = 50;
    for (let i = 0; i < chunksWithDistances.length; i += BATCH_SIZE) {
        const batch = chunksWithDistances.slice(i, i + BATCH_SIZE);
        for (const { chunkId, distance } of batch) {
            const chunk = chunkSystem._chunkManager._chunks.get(chunkId);
            if (chunk) {
                chunkSystem._chunkManager.queueChunkForRender(chunkId, {
                    forceMesh: true, // Force immediate mesh building
                    priority: true, // High priority
                });
            }
        }
        chunkSystem.processRenderQueue(true); // true = prioritize by camera distance
        if (i + BATCH_SIZE < chunksWithDistances.length) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }
    chunkSystem.processRenderQueue(true);
    return true;
};
