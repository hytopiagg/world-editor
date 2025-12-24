import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import React, {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
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
    resetChunkSystem,
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
import {
    processCustomBlock,
    createLightVariant,
    getCustomBlocks,
    loadAndApplyBlockOverrides,
} from "./managers/BlockTypesManager";
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
    StaircaseTool,
    SchematicPlacementTool,
    SelectionTool,
    TerrainTool,
    ReplaceTool,
    ToolManager,
    WallTool,
} from "./tools";
import ZoneTool from "./tools/ZoneTool";
import { zoneManager } from "./managers/ZoneManager";
import {
    configureChunkLoading,
    forceChunkUpdate,
    loadAllChunks,
    setDeferredChunkMeshing,
} from "./utils/ChunkUtils"; // <<< Add this import
import {
    detectGPU,
    applyGPUOptimizedSettings,
    logGPUInfo,
    getRecommendedSettings,
} from "./utils/GPUDetection";
import {
    handleTerrainMouseDown,
    handleTerrainMouseUp,
} from "./utils/TerrainMouseUtils";
import { getTerrainRaycastIntersection } from "./utils/TerrainRaycastUtils";

// Extend Window interface for custom properties
declare global {
    interface Window {
        __WE_CAM_OFFSET__?: THREE.Vector3;
        __WE_FACE_YAW__?: number;
        __WE_TP_YAW__?: number;
        __WE_PLAYER_MIXER__?: THREE.AnimationMixer;
        __WE_INPUT_STATE__?: { state?: any };
        __WE_PLAYER_ANIMS__?: Record<string, THREE.AnimationAction>;
        __WE_PHYSICS__?: {
            getPlayerHalfHeight?: () => number;
            getPlayerPosition?: () => THREE.Vector3;
            step?: (dt: number, state: any, yaw: number) => void;
            setIsSolidQuery?: (fn: (x: number, y: number, z: number) => boolean) => void;
        };
        __WE_IS_SOLID__?: (x: number, y: number, z: number) => boolean;
        __WE_SOLID_BOUND__?: boolean;
        __WE_LAST_POS__?: THREE.Vector3 | { x: number; y: number; z: number };
        __WE_AIRBORNE__?: boolean;
        __WE_AIRBORNE_SEQ__?: number;
        __WE_AIRBORNE_SINCE__?: number;
        __WE_LAST_LANDED_SEQ__?: number;
        __WE_LANDING_UNTIL__?: number;
        __WE_LANDING_ACTION__?: THREE.AnimationAction;
        __WE_PLAYER_ACTIVE_TAG__?: string;
        __WE_PLAYER_ACTIVE__?: THREE.AnimationAction;
        __WE_PLAYER_ACTIVE_UPPER__?: THREE.AnimationAction;
        __WE_PLAYER_ACTIVE_LOWER__?: THREE.AnimationAction;
        electronAPI?: {
            onWindowClose: (callback: () => void) => void;
            respondToCloseRequest: (canClose: boolean) => void;
            removeAllListeners: (channel: string) => void;
        };
        __WE_PLAYER_MESH__?: THREE.Object3D;
        __WE_PLAYER_MESH_LOADING__?: boolean;
        __WE_DEBUG_JUMP__?: boolean;
        __WE_PM_PLANE_TOP_Y__?: number;
        __WE_PREVIEW_VISIBLE__?: boolean;
        __WE_CAM_KEYS__?: { left?: boolean; right?: boolean; up?: boolean; down?: boolean };
        __WE_CAM_TARGET_RADIUS__?: number;
        __WE_CAM_OFFSET_YAW__?: number;
        __WE_CAM_OFFSET_RADIUS__?: number;
        __WE_CAM_OFFSET_HEIGHT__?: number;
        __WE_WORLD_Y_OFFSET__?: number;
        __WE_WORLD_X_OFFSET__?: number;
        __WE_WORLD_Z_OFFSET__?: number;
        __WE_LAST_PHYSICS_TS__?: number;
        BlockTypeRegistry?: any;
        fullTerrainDataRef?: Record<string, number>;
        chunkLoadCheckInterval?: NodeJS.Timeout;
        lastKeyMoveTime?: number;
        lowResDragEnabled?: boolean;
        variantCache?: Map<string, any>;
        pendingVariantKeys?: Set<string>;
        refreshBlockTools?: () => void;
        __variantCache?: Map<string, any>;
        __pendingVariantKeys?: Set<string>;
        __WE_SCENE__?: THREE.Scene;
        __WE_CAM_DRAG_RMB__?: boolean;
        __WE_CAM_DRAG_LAST_X__?: number;
        __WE_CAM_DRAG_LAST_Y__?: number;
        __WE_CAM_WHEEL_SENS__?: number;
        __WE_CAM_LIMIT_PAD__?: number;
        mouseButtons?: any;
    }
}

// Type definitions
interface TerrainBuilderProps {
    onSceneReady?: (scene: THREE.Scene) => void;
    previewPositionToAppJS?: (position: THREE.Vector3) => void;
    currentBlockType?: any;
    setCurrentBlockType?: (blockType: any) => void;
    undoRedoManager?: React.MutableRefObject<any>;
    mode?: string;
    axisLockEnabled?: boolean;
    gridSize?: number;
    cameraReset?: boolean;
    cameraAngle?: number;
    placementSize?: string;
    setPageIsLoaded?: (loaded: boolean) => void;
    customBlocks?: any[];
    environmentBuilderRef?: React.MutableRefObject<any>;
    isInputDisabled?: boolean;
    snapToGrid?: boolean;
    onCameraPositionChange?: (position: THREE.Vector3) => void;
}

interface TerrainBuilderRef {
    buildUpdateTerrain: (options?: any) => Promise<void>;
    updateTerrainFromToolBar: (terrainData: Record<string, number>) => void;
    getCurrentTerrainData: () => Record<string, number>;
    clearMap: () => Promise<void>;
    saveTerrainManually: () => void;
    updateTerrainBlocks: (addedBlocks?: Record<string, number>, removedBlocks?: Record<string, number>, options?: any) => Promise<void>;
    updateTerrainForUndoRedo: (addedBlocks?: Record<string, number>, removedBlocks?: Record<string, number>, options?: any) => Promise<void>;
    syncEnvironmentChangesToPending: (addedEnvironment?: any[], removedEnvironment?: any[]) => void;
    updateSpatialHashForBlocks: (addedBlocks?: any[], removedBlocks?: any[], options?: any) => void;
    fastUpdateBlock: (position: THREE.Vector3 | [number, number, number] | { x: number; y: number; z: number }, blockId: number) => void;
    forceChunkUpdate: (chunkKeys?: string[], options?: any) => void;
    forceRefreshAllChunks: () => boolean;
    updateGridSize: (newGridSize?: number) => Promise<void>;
    changeSkybox: (skyboxName: string) => void;
    setAmbientLight: (opts?: { color?: string | number; intensity?: number }) => boolean;
    getAmbientLight: () => { color: string; intensity: number } | null;
    /** @deprecated SDK-compatible lighting removes directional lights. Has no effect. */
    setDirectionalLight: (opts?: { color?: string | number; intensity?: number }) => boolean;
    /** @deprecated SDK-compatible lighting removes directional lights. Returns null. */
    getDirectionalLight: () => { color: string; intensity: number } | null;
    activateTool: (toolName: string, activationData?: any) => boolean;
    toolManagerRef: { current: any };
    previewPositionRef: THREE.Vector3;
    cameraRef: THREE.Camera | null;
    totalBlocksRef: number;
    setDeferredChunkMeshing: (defer: boolean) => void;
    deferSpatialHashUpdates: (defer: boolean) => void;
    applyDeferredSpatialHashUpdates: () => void;
    isPendingSpatialHashUpdates: () => boolean;
    setViewDistance: (distance: number) => boolean;
    getSelectionDistance: () => number;
    getViewDistance: () => number;
    setAutoSaveInterval: (intervalMs: number) => boolean;
    toggleAutoSave: (enabled: boolean) => boolean;
    isAutoSaveEnabled: () => boolean;
    isPlacing: () => boolean;
    refreshTerrainFromDB: () => Promise<boolean>;
    forceRebuildSpatialHash: (options?: { showLoadingScreen?: boolean }) => Promise<void>;
    setGridVisible: (visible: boolean) => void;
    setGridY: (baseY: number) => void;
    getGridY: () => number;
}

function optimizeRenderer(gl: THREE.WebGLRenderer | null) {
    if (gl) {
        // Detect GPU and apply optimized settings automatically
        const gpuInfo = detectGPU();
        const settings = applyGPUOptimizedSettings(gl, gpuInfo);

        // Log GPU info for debugging
        logGPUInfo();

        // Shadow map optimizations
        gl.shadowMap.autoUpdate = false;
        gl.shadowMap.needsUpdate = true;

        // Enable object sorting for better transparency rendering
        gl.sortObjects = true;

        // Apply GPU-specific shadow map size to directional lights
        // This will be picked up by lights that check renderer settings
        (gl as any).userData = (gl as any).userData || {};
        (gl as any).userData.recommendedShadowMapSize = settings.shadowMapSize;

        // Note: powerPreference must be set at context creation time, not here
        // It's now properly configured in the Canvas component gl prop

    }
}
const TerrainBuilder = forwardRef<TerrainBuilderRef, TerrainBuilderProps>(
    (
        {
            onSceneReady,
            previewPositionToAppJS,
            currentBlockType,
            setCurrentBlockType,
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
            onCameraPositionChange,
        },
        ref
    ) => {
        const spatialGridManagerRef = useRef(
            new SpatialGridManager(loadingManager)
        );
        const orbitControlsRef = useRef(null);
        const ambientRef = useRef(null);
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
        const baseGridYRef = useRef(0); // Base grid Y position (default 0, will be offset by -0.5)
        const [baseGridY, setBaseGridYState] = useState(0); // State for JSX reactivity

        // GPU-optimized settings state
        const [shadowMapSize, setShadowMapSize] = useState(2048);

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

            // Check for unsaved changes
            const hasUnsavedChanges = () => {
                if (localStorage.getItem("IS_DATABASE_CLEARING")) {
                    return false;
                }

                if (!pendingChangesRef || !pendingChangesRef.current) {
                    return false;
                }

                return (
                    pendingChangesRef.current.terrain &&
                    (Object.keys(pendingChangesRef.current.terrain.added || {})
                        .length > 0 ||
                        Object.keys(pendingChangesRef.current.terrain.removed || {})
                            .length > 0)
                );
            };

            // Handle window close request from Electron main process
            const handleWindowCloseRequest = async () => {
                if (hasUnsavedChanges()) {
                    const shouldClose = window.confirm(
                        "You have unsaved changes. Are you sure you want to close?"
                    );
                    
                    if (window.electronAPI) {
                        window.electronAPI.respondToCloseRequest(shouldClose);
                    }
                } else {
                    // No unsaved changes, allow close
                    if (window.electronAPI) {
                        window.electronAPI.respondToCloseRequest(true);
                    }
                }
            };

            // Fallback beforeunload for browser (non-Electron) or as backup
            // Note: In Electron, window closing is handled via IPC above, but beforeunload
            // may still fire for reloads/navigation. The IPC handler takes precedence for closing.
            const handleBeforeUnload = (event) => {
                if (window.electronAPI) {
                    // In Electron, window close is handled by IPC, but we still check for
                    // unsaved changes to prevent accidental reloads/navigation
                    if (hasUnsavedChanges()) {
                        event.preventDefault();
                        event.returnValue =
                            "You have unsaved changes. Are you sure you want to leave?";
                        return event.returnValue;
                    }
                    return;
                }

                // Browser fallback - use standard beforeunload
                if (hasUnsavedChanges()) {
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

            // Set up Electron IPC listener if available
            if (window.electronAPI) {
                window.electronAPI.onWindowClose(handleWindowCloseRequest);
            }

            window.addEventListener("beforeunload", handleBeforeUnload);
            window.addEventListener("popstate", handlePopState);
            document.addEventListener("visibilitychange", handleVisibilityChange);

            window.history.pushState(null, document.title, currentUrl);
            localStorage.removeItem("reload_attempted");

            return () => {
                if (window.electronAPI) {
                    window.electronAPI.removeAllListeners("window-close-request");
                }
                window.removeEventListener("beforeunload", handleBeforeUnload);
                window.removeEventListener("popstate", handlePopState);
                document.removeEventListener(
                    "visibilitychange",
                    handleVisibilityChange
                );
            };
        }, []);

        const efficientTerrainSave = async () => {
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

            resetPendingChanges();

            try {
                const db = await DatabaseManager.getDBConnection();
                const projectId =
                    DatabaseManager.getCurrentProjectId &&
                    DatabaseManager.getCurrentProjectId();

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
                        await processChunk(slice, (store, key) => {
                            const composedKey = DatabaseManager.composeKey
                                ? DatabaseManager.composeKey(String(key), projectId)
                                : key;
                            store.delete(composedKey);
                        });
                    }
                }

                // --- Handle additions / updates in manageable chunks ---
                if (
                    changesToSave.added &&
                    Object.keys(changesToSave.added).length > 0
                ) {
                    const addEntries = Object.entries(changesToSave.added);
                    for (let i = 0; i < addEntries.length; i += CHUNK_SIZE) {
                        const slice = addEntries.slice(i, i + CHUNK_SIZE);
                        await processChunk(slice, (store, [key, value]) => {
                            const composedKey = DatabaseManager.composeKey
                                ? DatabaseManager.composeKey(String(key), projectId)
                                : key;
                            store.put(value, composedKey);
                        });
                    }
                }

                // All chunk transactions awaited above have completed at this point.
                lastSaveTimeRef.current = Date.now(); // Update last save time
                return true;
            } catch (error) {
                pendingChangesRef.current.terrain = changesToSave;
                return false;
            }
        };

        useEffect(() => {

            initialSaveCompleteRef.current = false;

            pendingChangesRef.current = {
                terrain: { added: {}, removed: {} },
                environment: { added: [], removed: [] },
            };

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
                    // Error validating terrain data
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
                return false;
            }
            const camera = currentCameraRef.current;
            const chunkSystem = getChunkSystem();
            if (!chunkSystem) {
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

        // Periodically sync ambient light into block materials so emissive comparisons work in shader
        useEffect(() => {
            const id = setInterval(() => {
                const amb = ambientRef?.current;
                if (amb && BlockMaterial.instance) {
                    try {
                        BlockMaterial.instance.updateAmbient(
                            amb.color,
                            amb.intensity
                        );
                    } catch (e) { }
                }
            }, 100);
            return () => clearInterval(id);
        }, []);
        const forceRefreshAllChunks = () => {
            const camera = currentCameraRef.current;
            if (!camera) {
                return;
            }
            const chunkSystem = getChunkSystem();
            if (!chunkSystem) {
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
        const shadowPlaneRef = useRef<THREE.Mesh>(null);
        // SDK-compatible: directional lights removed, face-based shading baked into vertex colors
        const terrainRef = useRef<Record<string, number>>({});
        const gridRef = useRef<THREE.GridHelper>(null);
        const mouseMoveAnimationRef = useRef(null);
        const isPlacingRef = useRef(false);
        const mouseButtonDownRef = useRef<number | null>(null); // Track which mouse button is held down (0 = left, 2 = right)
        const lastDragPlacementTimeRef = useRef(0);
        const DRAG_PLACEMENT_INTERVAL = 50; // ms between placements during drag
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
        const [shouldHidePreviewBlock, setShouldHidePreviewBlock] = useState(false);
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
        } as any);
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
        const buildUpdateTerrain = async (options: {
            blocks?: Record<string, number>;
            deferMeshBuilding?: boolean;
            priorityDistance?: number;
            deferredBuildDelay?: number;
        } = {}) => {
            const useProvidedBlocks =
                options.blocks && Object.keys(options.blocks).length > 0;
            if (!useProvidedBlocks && !terrainRef.current) {
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
                        updateTerrainChunks(terrainBlocks, deferMeshBuilding);
                        if (Object.keys(terrainRef.current).length === 0) {
                            const blockEntries = Object.entries(terrainBlocks);
                            const BATCH_SIZE = 10000;
                            const processBlockBatch = (startIdx: number, batchNum: number) => {
                                const endIdx = Math.min(
                                    startIdx + BATCH_SIZE,
                                    blockEntries.length
                                );
                                const batch = blockEntries.slice(startIdx, endIdx);
                                batch.forEach(([posKey, blockId]) => {
                                    terrainRef.current[posKey] = blockId as number;
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
                    }
                } else {
                    if (getChunkSystem() && updateTerrainChunks) {
                        updateTerrainChunks(terrainBlocks, deferMeshBuilding);
                    }
                }
                if (processChunkRenderQueue) {
                    processChunkRenderQueue();
                }
            } catch (error) {
                // Error building terrain
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
                
                // Dispatch event for recently used blocks tracking
                if (typeof window !== "undefined" && blockId && typeof blockId === "number" && blockId > 0) {
                    console.log("[RecentlyUsed] fastUpdateBlock: Dispatching blocksPlaced event with blockId:", blockId);
                    window.dispatchEvent(new CustomEvent("blocksPlaced", {
                        detail: { blockIds: [blockId] }
                    }));
                }
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
                // Set mode based on mouse button
                // Left-click respects the toolbar mode selection
                // Right-click is only for camera rotation (right-click + drag)
                if (e.button === 0) {
                    // Respect the toolbar mode for left-click - don't override it
                    mouseButtonDownRef.current = 0;
                } else if (e.button === 2) {
                    // Right-click is only for camera rotation - don't toggle delete mode
                    // The only way to toggle delete mode is via the bottom toolbar
                    return;
                }

                // Low-res sculpting: temporarily drop pixel ratio
                // Only reduce if low-res drag is enabled AND we're about to start placing
                if (gl && typeof gl.getPixelRatio === "function") {
                    const lowResEnabled = window.lowResDragEnabled === true;
                    if (lowResEnabled && !originalPixelRatioRef.current) {
                        try {
                            const currentRatio = gl.getPixelRatio();
                            // Only reduce if we haven't already reduced it
                            // Store original ratio before reducing
                            originalPixelRatioRef.current = currentRatio;
                            gl.setPixelRatio(Math.max(0.3, currentRatio * 0.5));
                        } catch (err) {
                            // Failed to reduce pixel ratio
                        }
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
        const handleBlockPlacement = async () => {


            if (!currentBlockTypeRef.current) {
                return;
            }

            const blockType = currentBlockTypeRef.current;

            // Ensure textures are loaded before placement
            try {
                if (BlockTypeRegistry && BlockTypeRegistry.instance) {
                    const blockTypeInstance =
                        BlockTypeRegistry.instance.getBlockType(blockType.id);
                    if (blockTypeInstance) {
                        // Check if textures are loaded, if not, load them immediately
                        const needsPreload =
                            blockTypeInstance.needsTexturePreload?.();
                        if (needsPreload) {
                            await BlockTypeRegistry.instance.preloadBlockTypeTextures(
                                blockType.id
                            );
                        }
                    }
                }
            } catch (error) {
                // Continue with placement anyway - error texture will be used
            }

            if (toolManagerRef.current && toolManagerRef.current.getActiveTool()) {
                return;
            }
            if (!modeRef.current || !isPlacingRef.current) return;
            if (
                currentBlockTypeRef.current?.isEnvironment &&
                placedEnvironmentCountRef.current < 1
            ) {

                if (isFirstBlockRef.current) {
                    if (
                        environmentBuilderRef.current &&
                        typeof environmentBuilderRef.current
                            .placeEnvironmentModel === "function"
                    ) {
                        try {
                            const result =
                                await environmentBuilderRef.current.placeEnvironmentModel(
                                    modeRef.current,
                                    true
                                );

                            if (result?.length > 0) {
                                const oldCount = placedEnvironmentCountRef.current;
                                placedEnvironmentCountRef.current += result.length;
                                // Set isFirstBlockRef to false after successful model placement to prevent drag placement
                                isFirstBlockRef.current = false;
                            }

                            if (modeRef.current === "add" && result?.length > 0) {
                                if (placementChangesRef.current) {
                                    const oldAdded =
                                        placementChangesRef.current.environment
                                            .added.length;
                                    placementChangesRef.current.environment.added =
                                        [
                                            ...placementChangesRef.current
                                                .environment.added,
                                            ...result,
                                        ];
                                }
                            }
                        } catch (error) {
                            // Error handling environment object
                        }
                    }
                }
            } else {
                if (
                    modeRef.current === "add" &&
                    !currentBlockTypeRef?.current?.isEnvironment
                ) {
                    const now = performance.now();
                    // Auto create/select emissive variant that matches current registry light level
                    try {
                        const selected = currentBlockTypeRef.current;
                        const baseId =
                            typeof selected?.variantOfId === "number"
                                ? selected.variantOfId
                                : selected?.id;
                        const baseName =
                            selected?.variantOfName || selected?.name || "";
                        const type =
                            BlockTypeRegistry.instance.getBlockType(baseId);
                        const desiredLevel =
                            type && typeof type.lightLevel === "number"
                                ? type.lightLevel
                                : 0;
                        const selectedIsCustom =
                            selected?.id >= 1000 &&
                            typeof selected?.lightLevel === "number";
                        const selectedMatches =
                            selectedIsCustom &&
                            selected.lightLevel === desiredLevel;
                        if (desiredLevel > 0 && !selectedMatches) {
                            const key = `${baseId}:${desiredLevel}`;
                            // Try local cache
                            let variant =
                                (window.__variantCache &&
                                    window.__variantCache.get &&
                                    window.__variantCache.get(key)) ||
                                null;
                            if (!variant) {
                                // Try from custom blocks by metadata
                                const allCustom = getCustomBlocks() || [];
                                variant =
                                    allCustom.find(
                                        (b) =>
                                            (b.isVariant &&
                                                b.variantOfId === baseId &&
                                                b.variantLightLevel ===
                                                desiredLevel) ||
                                            (b.name === baseName &&
                                                typeof b.lightLevel === "number" &&
                                                b.lightLevel === desiredLevel)
                                    ) || null;
                            }
                            if (!variant) {
                                // Prevent duplicate concurrent creations
                                window.__pendingVariantKeys =
                                    window.__pendingVariantKeys || new Set();
                                if (!window.__pendingVariantKeys.has(key)) {
                                    window.__pendingVariantKeys.add(key);
                                    try {
                                        variant = await createLightVariant(
                                            baseId,
                                            desiredLevel
                                        );
                                    } finally {
                                        window.__pendingVariantKeys.delete(key);
                                    }
                                }
                            }
                            if (variant) {
                                currentBlockTypeRef.current = {
                                    ...variant,
                                    isEnvironment: false,
                                };
                                // Also update sidebar selection immediately for visual feedback
                                try {
                                    if (typeof setCurrentBlockType === "function") {
                                        setCurrentBlockType({
                                            ...variant,
                                            isEnvironment: false,
                                        });
                                    }
                                    // Mirror full click-selection behavior
                                    try {
                                        if (window && window.localStorage) {
                                            window.localStorage.setItem(
                                                "selectedBlock",
                                                String(variant.id)
                                            );
                                        }
                                    } catch (_) { }
                                    try {
                                        // Update the sidebar's selectedBlockID immediately
                                        if (
                                            window &&
                                            window.dispatchEvent &&
                                            typeof window.refreshBlockTools ===
                                            "function"
                                        ) {
                                            window.refreshBlockTools();
                                        } else if (window && window.dispatchEvent) {
                                            window.dispatchEvent(
                                                new Event("refreshBlockTools")
                                            );
                                        }
                                    } catch (_) { }
                                } catch (_) { }
                                // Cache it globally for session
                                try {
                                    window.__variantCache =
                                        window.__variantCache || new Map();
                                    window.__variantCache.set(
                                        `${baseId}:${desiredLevel}`,
                                        variant
                                    );
                                } catch (_) { }
                            }
                        }
                    } catch (e) {
                        // Auto variant selection failed
                    }
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
                        
                        // Dispatch event for recently used blocks tracking
                        if (Object.keys(addedBlocks).length > 0 && typeof window !== "undefined") {
                            const uniqueBlockIds = Array.from(new Set(Object.values(addedBlocks).filter(
                                (id) => id && typeof id === "number" && id > 0
                            )));
                            if (uniqueBlockIds.length > 0) {
                                console.log("[RecentlyUsed] handleBlockPlacement: Dispatching blocksPlaced event with blockIds:", uniqueBlockIds);
                                window.dispatchEvent(new CustomEvent("blocksPlaced", {
                                    detail: { blockIds: uniqueBlockIds }
                                }));
                            }
                        }
                        
                        const addedBlocksArray = Object.entries(addedBlocks).map(
                            ([posKey, blockId]) => {
                                const [x, y, z] = posKey.split(",").map(Number);
                                // Ensure coordinates are integers to avoid chunk bounds errors
                                return {
                                    id: blockId,
                                    position: [Math.round(x), Math.round(y), Math.round(z)],
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
                            // Ensure coordinates are integers to avoid chunk bounds errors
                            return {
                                id: 0, // Use 0 for removed blocks
                                position: [Math.round(x), Math.round(y), Math.round(z)],
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
            // Use center of screen for raycasting in crosshair mode, mouse position in rotate mode
            const ptr = cameraManager.isPointerUnlockedMode
                ? pointer.clone()
                : new THREE.Vector2(0, 0);
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
                modeRef,
                baseGridYRef
            );
        }, [pointer, scene, threeCamera, threeRaycaster, cameraManager]);
        const updatePreviewPosition = (() => {
            const fn = () => {
                if ((fn as any).isProcessing) {
                    return;
                }
                (fn as any).isProcessing = true;
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

                const groundY = baseGridYRef.current - 0.5; // Use baseGridY - 0.5 offset
                const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY); // Plane at baseGridY - 0.5
                const currentGroundPoint = new THREE.Vector3();
                // Use center of screen for raycasting in crosshair mode, mouse position in rotate mode
                const normalizedMouse = cameraManager.isPointerUnlockedMode
                    ? pointer.clone()
                    : new THREE.Vector2(0, 0);
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

                    // Handle ground plane placement first - blocks should be placed ABOVE the grid
                    if (blockIntersection.isGroundPlane) {
                        // Grid is at baseGridY - 0.5, blocks should be placed at baseGridY (above the grid)
                        // Use baseGridYRef directly to avoid floating point precision issues
                        const blockY = baseGridYRef.current;
                        potentialNewPosition.y = blockY;
                        
                        // Set hitBlock Y to the block position above the grid
                        const hitBlock = blockIntersection.block || {
                            x: Math.floor(blockIntersection.point.x),
                            y: blockY,
                            z: Math.floor(blockIntersection.point.z),
                        };
                        hitBlock.y = blockY;
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
                    }

                    // Override snapping for environment models when grid snapping is disabled and no block hit (ground plane)
                    if (
                        !snapToGridRef.current &&
                        currentBlockTypeRef.current?.isEnvironment &&
                        blockIntersection.isGroundPlane &&
                        hitGround
                    ) {
                        potentialNewPosition.copy(currentGroundPoint);
                        // Still ensure Y is above the grid
                        potentialNewPosition.y = Math.ceil(baseGridYRef.current - 0.5);
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

                    // Handle remove mode adjustments
                    if (modeRef.current === "remove" && !blockIntersection.isGroundPlane) {
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
                        // Don't place models during drag - only blocks
                        // Models should be placed one at a time on click, not during drag
                        if (!currentBlockTypeRef.current?.isEnvironment) {
                            handleBlockPlacement();
                        }
                    }

                    // Continuous placement/removal during drag (for both add and remove modes)
                    if (
                        isPlacingRef.current &&
                        !isToolActive &&
                        mouseButtonDownRef.current !== null &&
                        (mouseButtonDownRef.current === 0 || mouseButtonDownRef.current === 2)
                    ) {
                        const now = performance.now();
                        // Throttle continuous placement during drag
                        if (now - lastDragPlacementTimeRef.current >= DRAG_PLACEMENT_INTERVAL) {
                            // Only place blocks, not models, during drag
                            if (!currentBlockTypeRef.current?.isEnvironment) {
                                handleBlockPlacement();
                            }
                            lastDragPlacementTimeRef.current = now;
                        }
                    }
                }
                (fn as any).isProcessing = false;
            };
            return fn;
        })();
        const handleMouseUp = useCallback(
            (e) => {
                // Clear mouse button tracking
                if (e.button === 0 || e.button === 2) {
                    mouseButtonDownRef.current = null;
                }

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
                // Always restore if we have a stored original ratio, regardless of isPlacing state
                if (
                    originalPixelRatioRef.current &&
                    gl &&
                    typeof gl.setPixelRatio === "function"
                ) {
                    try {
                        const currentRatio = gl.getPixelRatio();
                        const originalRatio = originalPixelRatioRef.current;
                        gl.setPixelRatio(originalRatio);
                        originalPixelRatioRef.current = null;
                    } catch (err) {
                        // Clear the ref even if restoration failed to prevent stuck state
                        originalPixelRatioRef.current = null;
                    }
                }
            },
            [getRaycastIntersection, undoRedoManager, ref]
        );
        const getPlacementPositions = (centerPos, placementSize) => {
            const positions = [];

            const addPos = (dx, dz) => {
                positions.push({
                    x: Math.round(centerPos.x + dx),
                    y: Math.round(centerPos.y), // Ensure Y is an integer
                    z: Math.round(centerPos.z + dz),
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
            loadingManager.showLoading("Updating terrain...", 0);
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
                                loadingManager.hideLoading();
                            }
                        }, 500);
                    })
                    .catch((error) => {
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
                    const yPosition = baseGridYRef.current - 0.5; // Apply -0.5 offset
                    gridRef.current.position.set(0.5, yPosition, 0.5);
                }
                if (shadowPlaneRef.current.geometry) {
                    shadowPlaneRef.current.geometry.dispose();
                    shadowPlaneRef.current.geometry = new THREE.PlaneGeometry(
                        gridSizeToUse,
                        gridSizeToUse
                    );
                    const yPosition = baseGridYRef.current - 0.5; // Apply -0.5 offset
                    shadowPlaneRef.current.position.set(0.5, yPosition, 0.5);
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
                            // Failed to clear undo/redo history
                        }
                    };
                    clearUndoRedo(); // Call async clear
                    if (DatabaseManager.deleteAllByPrefix) {
                        DatabaseManager.deleteAllByPrefix(STORES.TERRAIN)
                            .then(() => {
                                resetPendingChanges();
                                lastSaveTimeRef.current = Date.now();
                            })
                            .catch((error) => {
                                // Error clearing terrain keys for project
                            });
                    } else {
                        DatabaseManager.clearStore(STORES.TERRAIN)
                            .then(() => {
                                resetPendingChanges();
                                lastSaveTimeRef.current = Date.now();
                            })
                            .catch((error) => {
                                // Error clearing terrain store
                            });
                    }
                } catch (error) {
                    // Error during clearMap operation
                } finally {
                    localStorage.removeItem("IS_DATABASE_CLEARING");
                }
            } catch (error) {
                // Failed to clear map
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
                return Promise.resolve();
            }
            if (visibleOnly && terrainRef.current) {
                const chunkSystem = getChunkSystem();
                if (chunkSystem && (chunkSystem._scene as any).camera) {
                    const camera = (chunkSystem._scene as any).camera;
                    const cameraPos = camera.position;
                    const viewDistance = getViewDistance() || 64;
                    const visibleBlocks = {};
                    const getChunkOrigin = (pos: string) => {
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
                // Error initializing spatial hash
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
                try {
                    scene.traverse((object) => {
                        if ((object as any).isMesh || (object as any).isInstancedMesh) {
                            object.frustumCulled = false;
                        }
                    });
                } catch (_) { }
            }
        }, [threeCamera, scene]);
        useEffect(() => {
            let mounted = true;
            async function initialize() {
                if (threeCamera && orbitControlsRef.current) {
                    cameraManager.initialize(threeCamera, orbitControlsRef.current);
                    orbitControlsRef.current.addEventListener("change", () => {
                        handleCameraMove();
                    });
                    try {
                        // Try restore persisted state; fallback to reset
                        const saved =
                            window?.localStorage?.getItem?.("cameraState");
                        if (saved) {
                            try {
                                cameraManager.loadSavedState();
                            } catch (_) {
                                cameraManager.resetCamera?.();
                            }
                        } else {
                            cameraManager.resetCamera?.();
                        }
                    } catch (_) {
                        cameraManager.resetCamera?.();
                    }
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
                    try {
                        await initChunkSystem(scene, {
                            viewDistance: getViewDistance(),
                            viewDistanceEnabled: true,
                        });
                    } catch (error) {
                        // Error initializing chunk system
                    }
                    try {
                        updateChunkSystemCamera(threeCamera);
                        const cs = getChunkSystem();
                    } catch (e) {
                        // Failed to bind camera to chunk system
                    }
                }
                meshesInitializedRef.current = true;
                
                // Load base grid Y position from settings
                try {
                    const savedBaseGridY = await DatabaseManager.getData(STORES.SETTINGS, "baseGridY");
                    if (typeof savedBaseGridY === "number") {
                        baseGridYRef.current = savedBaseGridY;
                        setBaseGridYState(savedBaseGridY);
                        const yPosition = savedBaseGridY - 0.5;
                        if (gridRef.current) {
                            gridRef.current.position.y = yPosition;
                        }
                        if (shadowPlaneRef.current) {
                            shadowPlaneRef.current.position.y = yPosition;
                        }
                    }
                } catch (error) {
                    // Error loading base grid Y, use default (0)
                }
                
                // Load and apply saved overrides for built-in blocks (e.g., isLiquid)
                try {
                    await loadAndApplyBlockOverrides();
                } catch (error) {
                    console.warn("Error loading block overrides:", error);
                }
                
                await DatabaseManager.getData(STORES.CUSTOM_BLOCKS, "blocks")
                    .then(async (customBlocksData: any) => {
                        if (customBlocksData && Array.isArray(customBlocksData) && customBlocksData.length > 0) {
                            // Process custom blocks - textures will be loaded lazily
                            for (const block of customBlocksData) {
                                await processCustomBlock(block);
                            }
                            window.dispatchEvent(
                                new CustomEvent("custom-blocks-loaded", {
                                    detail: { blocks: customBlocksData },
                                })
                            );
                        }
                        return DatabaseManager.getData(STORES.TERRAIN, "current");
                    })
                    .then((savedTerrain: any) => {
                        if (!mounted) return;
                        const terrainBlockCount = savedTerrain
                            ? Object.keys(savedTerrain).length
                            : 0;
                        if (savedTerrain) {
                            terrainRef.current = savedTerrain as Record<string, number>;
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
                                    const usedBlockIds = new Set<number>();
                                    Object.values(terrainRef.current).forEach(
                                        (blockId) => {
                                            usedBlockIds.add(typeof blockId === 'number' ? blockId : parseInt(String(blockId)));
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

                                    // Only preload textures if there are blocks in the terrain
                                    // For empty worlds, skip preload entirely (saves ~18 seconds)
                                    const terrainBlockCount = Object.keys(
                                        terrainRef.current
                                    ).length;
                                    if (
                                        BlockTypeRegistry &&
                                        BlockTypeRegistry.instance &&
                                        terrainBlockCount > 0
                                    ) {
                                        // Only preload essential block types (those actually used)
                                        await BlockTypeRegistry.instance.preload({
                                            onlyEssential: true,
                                        });
                                    }
                                    await rebuildTextureAtlas();
                                    if (!getChunkSystem()) {
                                        setTimeout(() => {
                                            try {
                                                updateTerrainChunks(
                                                    terrainRef.current,
                                                    true,
                                                    environmentBuilderRef
                                                );
                                                try {
                                                    updateChunkSystemCamera(
                                                        threeCamera
                                                    );
                                                } catch (_) { }
                                                processChunkRenderQueue();
                                            } catch (_) { }
                                        }, 100);
                                    } else {
                                        updateTerrainChunks(
                                            terrainRef.current,
                                            true,
                                            environmentBuilderRef
                                        );
                                        try {
                                            updateChunkSystemCamera(threeCamera);
                                        } catch (_) { }
                                        processChunkRenderQueue();
                                    }
                                    window.fullTerrainDataRef = terrainRef.current;
                                    loadingManager.hideLoading();
                                    setPageIsLoaded(true);
                                    // Dispatch event for recently used blocks scanning
                                    if (typeof window !== "undefined") {
                                        window.dispatchEvent(new CustomEvent("terrainLoaded"));
                                    }
                                } catch (error) {
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
                        // Dispatch event for recently used blocks scanning
                        if (typeof window !== "undefined") {
                            window.dispatchEvent(new CustomEvent("terrainLoaded"));
                        }
                    })
                    .catch((error) => {
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
                threeRaycaster: threeRaycaster, // Add raycaster for entity detection
                threeCamera: threeCamera, // Add camera for entity detection
                pointer: pointer, // Add pointer for entity detection
                gl: gl, // Add renderer for gizmo controls
                totalBlocksRef, // Provide access to the total block count ref
                activateTool: (toolName, activationData) =>
                    toolManagerRef.current?.activateTool(toolName, activationData),
                pendingChangesRef,
                baseGridYRef, // Add base grid Y reference for terrain tools
            };
            toolManagerRef.current = new ToolManager(terrainBuilderProps);
            const wallTool = new WallTool(terrainBuilderProps);
            toolManagerRef.current.registerTool("wall", wallTool);
            const groundTool = new GroundTool(terrainBuilderProps);
            toolManagerRef.current.registerTool("ground", groundTool);
            const staircaseTool = new StaircaseTool(terrainBuilderProps);
            toolManagerRef.current.registerTool("staircase", staircaseTool);
            const schematicPlacementTool = new SchematicPlacementTool(
                terrainBuilderProps
            );
            toolManagerRef.current.registerTool(
                "schematic",
                schematicPlacementTool
            );
            const selectionTool = new SelectionTool(terrainBuilderProps);
            toolManagerRef.current.registerTool("selection", selectionTool);

            // Listen for entity selection/hover changes to update preview visibility
            const handleEntityStateChange = () => {
                const activeTool = toolManagerRef.current?.getActiveTool?.();
                const shouldHide =
                    activeTool?.name === "selection" &&
                    activeTool?.shouldHidePreviewBlock?.();
                setShouldHidePreviewBlock(shouldHide || false);
            };
            window.addEventListener("entity-selected", handleEntityStateChange);
            window.addEventListener("entity-deselected", handleEntityStateChange);
            window.addEventListener(
                "entity-hover-changed",
                handleEntityStateChange
            );

            // Also check periodically when SelectionTool is active
            const checkPreviewVisibility = () => {
                const activeTool = toolManagerRef.current?.getActiveTool?.();
                if (activeTool?.name === "selection") {
                    const shouldHide = activeTool?.shouldHidePreviewBlock?.();
                    setShouldHidePreviewBlock(shouldHide || false);
                } else {
                    setShouldHidePreviewBlock(false);
                }
            };
            const previewCheckInterval = setInterval(checkPreviewVisibility, 100);

            const terrainTool = new TerrainTool(terrainBuilderProps);
            toolManagerRef.current.registerTool("terrain", terrainTool);

            // Register replace tool
            const replaceTool = new ReplaceTool(terrainBuilderProps);
            toolManagerRef.current.registerTool("replace", replaceTool);

            // Register zone tool
            const zoneTool = new ZoneTool(terrainBuilderProps);
            toolManagerRef.current.registerTool("zone", zoneTool);

            // Initialize zone manager with scene
            zoneManager.initialize(scene);

            initialize();
            const onKeyDownOnce = (event) => {
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
            };
            window.addEventListener("keydown", onKeyDownOnce);
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
                if (previewCheckInterval) {
                    clearInterval(previewCheckInterval);
                }
                try {
                    window.removeEventListener("keydown", onKeyDownOnce);
                    window.removeEventListener(
                        "entity-selected",
                        handleEntityStateChange
                    );
                    window.removeEventListener(
                        "entity-deselected",
                        handleEntityStateChange
                    );
                    window.removeEventListener(
                        "entity-hover-changed",
                        handleEntityStateChange
                    );
                } catch (_) { }
                // Explicitly clear large references to help next mount
                try {
                    terrainRef.current = {};
                } catch (_) { }
                try {
                    if (getChunkSystem()) {
                        getChunkSystem().reset?.();
                    }
                } catch (_) { }
                try {
                    spatialGridManagerRef.current?.clear?.();
                } catch (_) { }
                try {
                    resetChunkSystem();
                } catch (_) { }
            };
        }, [threeCamera, scene]);
        useEffect(() => {
            if (undoRedoManager?.current && toolManagerRef.current) {
                try {
                    Object.values(toolManagerRef.current.tools).forEach((tool: any) => {
                        if (tool) {
                            tool.undoRedoManager = undoRedoManager;
                        }
                    });
                } catch (error) {
                    // Error updating tools with undoRedoManager
                }
            }
        }, [undoRedoManager?.current]);
        useEffect(() => {
            const currentInstancedMeshes = instancedMeshRef.current;
            return () => {
                if (currentInstancedMeshes) {
                    Object.values(currentInstancedMeshes).forEach((mesh: any) => {
                        if (mesh) {
                            scene.remove(mesh);
                            if (mesh.geometry) mesh.geometry.dispose();
                            if (Array.isArray(mesh.material)) {
                                mesh.material.forEach((m: any) => m?.dispose());
                            } else if (mesh.material) {
                                mesh.material.dispose();
                            }
                        }
                    });
                }
            };
        }, [scene]); // Can't include safeRemoveFromScene due to function order
        useEffect(() => {
            if ((meshesNeedsRefresh as any).value) {
                buildUpdateTerrain();
                (meshesNeedsRefresh as any).value = false;
            }
        }, [(meshesNeedsRefresh as any).value]); // Use meshesNeedsRefresh.value in the dependency array
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
            const handleTextureAtlasUpdate = (event: any) => {
                scene.traverse((object) => {
                    const obj = object as any;
                    if (obj.isMesh && obj.material) {
                        if (Array.isArray(obj.material)) {
                            obj.material.forEach((mat: any) => {
                                if (mat.map) mat.needsUpdate = true;
                            });
                        } else if (obj.material.map) {
                            obj.material.needsUpdate = true;
                        }
                    }
                });
                gl.render(scene, threeCamera);
                if (getChunkSystem()) {
                    getChunkSystem().forceUpdateChunkVisibility(); // Changed from forceUpdateAllChunkVisibility
                    (getChunkSystem() as any).processRenderQueue(true);
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
            } catch (_) { }
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
            changeSkybox: (skyboxName) => {
                if (scene && gl) {
                    const FADE_DURATION = 300; // 300ms fade duration
                    const originalBackground = scene.background;
                    let fadeStartTime = Date.now();
                    let newSkyboxLoaded = false;
                    let newTextureCube = null;

                    // Preload the new skybox
                    const loader = new THREE.CubeTextureLoader();
                    loader.setPath(`./assets/skyboxes/${skyboxName}/`);

                    const fadeOverlay = new THREE.Mesh(
                        new THREE.SphereGeometry(500, 32, 16),
                        new THREE.MeshBasicMaterial({
                            color: 0x000000,
                            transparent: true,
                            opacity: 0,
                            side: THREE.BackSide,
                        })
                    );
                    scene.add(fadeOverlay);

                    // Load new skybox
                    newTextureCube = loader.load(
                        [
                            "+x.png",
                            "-x.png",
                            "+y.png",
                            "-y.png",
                            "+z.png",
                            "-z.png",
                        ],
                        () => {
                            newSkyboxLoaded = true;
                        }
                    );

                    // Fade animation
                    const fadeAnimation = () => {
                        const elapsed = Date.now() - fadeStartTime;
                        const progress = Math.min(elapsed / FADE_DURATION, 1);

                        if (progress < 0.5) {
                            // Fade out phase (first half)
                            const fadeOutProgress = progress * 2; // 0 to 1
                            fadeOverlay.material.opacity = fadeOutProgress * 0.8;
                        } else if (newSkyboxLoaded) {
                            // Fade in phase (second half) - only start if new skybox is loaded
                            if (scene.background !== newTextureCube) {
                                scene.background = newTextureCube;
                            }
                            const fadeInProgress = (progress - 0.5) * 2; // 0 to 1
                            fadeOverlay.material.opacity =
                                0.8 * (1 - fadeInProgress);
                        }

                        if (progress < 1 || !newSkyboxLoaded) {
                            requestAnimationFrame(fadeAnimation);
                        } else {
                            // Animation complete, cleanup
                            scene.remove(fadeOverlay);
                            fadeOverlay.geometry.dispose();
                            fadeOverlay.material.dispose();
                        }
                    };

                    fadeAnimation();
                }
            },
            /**
             * Update ambient light color and/or intensity
             */
            setAmbientLight: (opts = {}) => {
                const amb = ambientRef?.current;
                if (!amb) return false;
                if (opts.color !== undefined) {
                    try {
                        amb.color.set(opts.color);
                    } catch (_) { }
                }
                if (opts.intensity !== undefined) {
                    amb.intensity = opts.intensity;
                }
                return true;
            },
            /**
             * Read current ambient light settings
             */
            getAmbientLight: () => {
                const amb = ambientRef?.current;
                if (!amb) return null;
                return {
                    color: `#${amb.color.getHexString()}`,
                    intensity: amb.intensity,
                };
            },
            /**
             * Update directional light color and/or intensity
             * @deprecated SDK-compatible lighting removes directional lights.
             * Face-based shading is now baked into vertex colors.
             * This method is kept for API compatibility but has no effect.
             */
            setDirectionalLight: (opts = {}) => {
                // SDK-compatible: directional lights are removed
                // Face-based shading provides simple directional depth in shaders
                console.warn('setDirectionalLight() is deprecated. SDK-compatible lighting uses face-based shading baked into vertex colors.');
                return false;
            },
            /**
             * Read current directional light settings
             * @deprecated SDK-compatible lighting removes directional lights.
             * Returns null since no directional light exists.
             */
            getDirectionalLight: () => {
                // SDK-compatible: directional lights are removed
                return null;
            },
            activateTool: (toolName, activationData) => {
                if (!toolManagerRef.current) {
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
            get cameraRef() {
                return cameraRef.current;
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
                        loadingManager.hideLoading();
                        resolve(false);
                    }
                });
            },
            forceRebuildSpatialHash: (options = {}) => {
                if (!spatialGridManagerRef.current) {
                    return Promise.resolve();
                }
                disableSpatialHashUpdatesRef.current = false;
                deferSpatialHashUpdatesRef.current = false;
                try {
                    spatialGridManagerRef.current.clear();
                    const terrainData = getCurrentTerrainData();
                    if (!terrainData || Object.keys(terrainData).length === 0) {
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
                        if (showLoading) loadingManager.hideLoading();
                        return Promise.resolve();
                    }
                    const MAX_CHUNKS_PER_BATCH = 10;
                    const totalBatches = Math.ceil(
                        chunkKeys.length / MAX_CHUNKS_PER_BATCH
                    );
                    const processBatch = (batchIndex: number) => {
                        return new Promise<void>((resolve) => {
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
                                resolve(undefined);
                                return;
                            }
                            if (showLoading) {
                                const progress = Math.round(
                                    (batchIndex / totalBatches) * 100
                                );
                                loadingManager.updateLoading(
                                    `Processing batch ${batchIndex + 1
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

                            setTimeout(() => resolve(undefined), 0);
                        });
                    };
                    return new Promise<void>(async (resolve) => {
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
                    if (options.showLoadingScreen) {
                        loadingManager.hideLoading();
                    }
                    return Promise.reject(err);
                }
            },
            setGridVisible,
            setGridY,
            getGridY,
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

        const updateTerrainBlocks = async (
            addedBlocks?: Record<string, number>,
            removedBlocks?: Record<string, number>,
            options: {
                skipTexturePreload?: boolean;
                syncPendingChanges?: boolean;
                skipUndoSave?: boolean;
                skipSpatialHash?: boolean;
            } = {}
        ) => {

            if (!addedBlocks && !removedBlocks) {
                return;
            }
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
            ) {
                return;
            }

            // Extract unique block IDs and ensure textures are loaded before updating terrain
            const uniqueBlockIds = new Set();
            Object.values(addedBlocks).forEach((blockId) => {
                if (blockId && typeof blockId === "number" && blockId > 0) {
                    uniqueBlockIds.add(blockId);
                }
            });


            // Preload textures for all blocks that will be placed
            if (uniqueBlockIds.size > 0 && !options.skipTexturePreload) {
                try {
                    const blockTypeRegistry = window.BlockTypeRegistry;
                    if (blockTypeRegistry && blockTypeRegistry.instance) {
                        const preloadPromises = Array.from(uniqueBlockIds).map(
                            async (blockId) => {
                                try {
                                    const blockType =
                                        blockTypeRegistry.instance.getBlockType(
                                            blockId
                                        );
                                    if (
                                        blockType &&
                                        blockType.needsTexturePreload?.()
                                    ) {
                                        await blockTypeRegistry.instance.preloadBlockTypeTextures(
                                            blockId
                                        );
                                    }
                                } catch (error) {
                                    // Failed to ensure textures for block
                                }
                            }
                        );
                        await Promise.allSettled(preloadPromises);
                    }
                } catch (error) {
                    // Continue with update even if preloading fails
                }
            }

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
                const blockIdNum = typeof blockId === 'number' ? blockId : parseInt(String(blockId));
                if (!isNaN(blockIdNum)) {
                    let dataUri = null;
                    if (customBlocks && customBlocks[blockIdNum]) {
                        dataUri = customBlocks[blockIdNum].dataUri;
                    }
                    if (!dataUri && typeof localStorage !== "undefined") {
                        const storageKeys = [
                            `block-texture-${blockIdNum}`,
                            `custom-block-${blockIdNum}`,
                            `datauri-${blockIdNum}`,
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
                        localStorage.setItem(`block-texture-${blockIdNum}`, dataUri);
                        if (BlockTextureAtlas && BlockTextureAtlas.instance) {
                            BlockTextureAtlas.instance
                                .applyDataUriToAllFaces(String(blockIdNum), dataUri)
                                .catch((err) => {
                                    // Error applying data URI to block
                                });
                        }
                    }
                }
            });
            
            // Dispatch event for recently used blocks tracking when blocks are added
            if (Object.keys(addedBlocks).length > 0 && typeof window !== "undefined") {
                const uniqueBlockIds = Array.from(new Set(Object.values(addedBlocks).filter(
                    (id) => id && typeof id === "number" && id > 0
                )));
                if (uniqueBlockIds.length > 0) {
                    console.log("[RecentlyUsed] Dispatching blocksPlaced event with blockIds:", uniqueBlockIds);
                    window.dispatchEvent(new CustomEvent("blocksPlaced", {
                        detail: { blockIds: uniqueBlockIds }
                    }));
                }
            }
            
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
                terrainRef.current[posKey] = typeof blockId === 'number' ? blockId : parseInt(String(blockId));
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
                        // Ensure coordinates are integers to avoid chunk bounds errors
                        return {
                            id: blockId,
                            position: [Math.round(x), Math.round(y), Math.round(z)],
                        };
                    }
                );
                const removedBlocksArray = Object.entries(removedBlocks).map(
                    ([posKey]) => {
                        const [x, y, z] = posKey.split(",").map(Number);
                        // Ensure coordinates are integers to avoid chunk bounds errors
                        return {
                            id: 0, // Use 0 for removed blocks
                            position: [Math.round(x), Math.round(y), Math.round(z)],
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
                // Prevent context menu in crosshair mode
                event.preventDefault();
            };
            // Global mouseup handler to catch mouse release outside canvas
            const handleGlobalMouseUp = (event) => {
                if (event.button === 0 || event.button === 2) {
                    mouseButtonDownRef.current = null;
                }
            };
            canvas.addEventListener("mousedown", handleCanvasMouseDown);
            canvas.addEventListener("mouseup", handleCanvasMouseUp);
            canvas.addEventListener("contextmenu", handleContextMenu);
            window.addEventListener("mouseup", handleGlobalMouseUp);
            return () => {
                canvas.removeEventListener("mousedown", handleCanvasMouseDown);
                canvas.removeEventListener("mouseup", handleCanvasMouseUp);
                canvas.removeEventListener("contextmenu", handleContextMenu);
                window.removeEventListener("mouseup", handleGlobalMouseUp);
            };
        }, [gl, handleMouseDown, handleMouseUp, cameraManager]); // Add dependencies

        // Update OrbitControls mouse buttons when crosshair mode changes
        useEffect(() => {
            const updateMouseButtons = () => {
                if (orbitControlsRef.current) {
                    // When crosshair mode is ON: LEFT rotates, RIGHT rotates
                    // When crosshair mode is OFF: LEFT does nothing, RIGHT rotates
                    const mouseButtons: any = {
                        MIDDLE: THREE.MOUSE.PAN,
                        RIGHT: THREE.MOUSE.ROTATE,
                    };

                    if (!cameraManager.isPointerUnlockedMode) {
                        // Crosshair mode ON: enable left-click rotation
                        mouseButtons.LEFT = THREE.MOUSE.ROTATE;
                    } else {
                        // Crosshair mode OFF: disable left-click (set to null to disable)
                        mouseButtons.LEFT = null;
                    }

                    orbitControlsRef.current.mouseButtons = mouseButtons;
                }
            };

            updateMouseButtons();

            // Listen for mode changes
            const handleModeChange = () => {
                updateMouseButtons();
            };
            window.addEventListener("pointerLockModeChanged", handleModeChange);

            return () => {
                window.removeEventListener("pointerLockModeChanged", handleModeChange);
            };
        }, []);

        useEffect(() => {
            optimizeRenderer(gl);
            try {
                window.__WE_SCENE__ = scene;
                // Initialize camera control globals so first entry to player mode works without key presses
                window.__WE_CAM_KEYS__ = window.__WE_CAM_KEYS__ || {
                    left: false,
                    right: false,
                    up: false,
                    down: false,
                };
                window.__WE_CAM_OFFSET_RADIUS__ =
                    window.__WE_CAM_OFFSET_RADIUS__ ?? 8.0;
                window.__WE_CAM_OFFSET_HEIGHT__ =
                    window.__WE_CAM_OFFSET_HEIGHT__ ?? 3.0;
                window.__WE_CAM_OFFSET_YAW__ =
                    window.__WE_CAM_OFFSET_YAW__ ?? threeCamera.rotation.y;
            } catch (_) { }

            // Allow adjusting third-person camera offset with arrow keys while in Player Mode
            const onArrowKeyDown = (e) => {
                try {
                    if (!window.__WE_PHYSICS__) return; // only in player mode
                    // Ignore when typing in inputs
                    if (
                        e.target &&
                        (e.target.tagName === "INPUT" ||
                            e.target.tagName === "TEXTAREA" ||
                            e.target.isContentEditable)
                    )
                        return;
                    const key = e.key;
                    window.__WE_CAM_OFFSET_YAW__ =
                        window.__WE_CAM_OFFSET_YAW__ ??
                        (window.__WE_TP_YAW__ || threeCamera.rotation.y);
                    window.__WE_CAM_OFFSET_RADIUS__ =
                        window.__WE_CAM_OFFSET_RADIUS__ ?? 8.0;
                    window.__WE_CAM_OFFSET_HEIGHT__ =
                        window.__WE_CAM_OFFSET_HEIGHT__ ?? 3.0;
                    // We only mark intent flags here; actual movement occurs each frame for smoothness.
                    if (key === "ArrowLeft") {
                        window.__WE_CAM_KEYS__ = window.__WE_CAM_KEYS__ || {};
                        // Swapped: Left arrow now behaves like previous Right
                        window.__WE_CAM_KEYS__.right = true;
                        e.preventDefault();
                    }
                    if (key === "ArrowRight") {
                        // Swapped: Right arrow now behaves like previous Left
                        window.__WE_CAM_KEYS__.left = true;
                        e.preventDefault();
                    }
                    if (key === "ArrowUp") {
                        window.__WE_CAM_KEYS__.up = true;
                        e.preventDefault();
                    }
                    if (key === "ArrowDown") {
                        window.__WE_CAM_KEYS__.down = true;
                        e.preventDefault();
                    }
                } catch (_) { }
            };
            const onArrowKeyUp = (e) => {
                if (!window.__WE_PHYSICS__) return;
                if (!window.__WE_CAM_KEYS__) return;
                if (e.key === "ArrowLeft") window.__WE_CAM_KEYS__.right = false; // swapped
                if (e.key === "ArrowRight") window.__WE_CAM_KEYS__.left = false; // swapped
                if (e.key === "ArrowUp") window.__WE_CAM_KEYS__.up = false;
                if (e.key === "ArrowDown") window.__WE_CAM_KEYS__.down = false;
            };
            const onMouseDownRMB = (e) => {
                if (!window.__WE_PHYSICS__) return;
                if (e.button === 2) {
                    window.__WE_CAM_DRAG_RMB__ = true;
                    window.__WE_CAM_DRAG_LAST_X__ = e.clientX;
                    window.__WE_CAM_DRAG_LAST_Y__ = e.clientY;
                    e.preventDefault();
                    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                    if (e.stopPropagation) e.stopPropagation();
                }
            };
            const onMouseUpRMB = (e) => {
                if (e.button === 2) window.__WE_CAM_DRAG_RMB__ = false;
            };
            const onMouseMoveRMB = (e) => {
                if (!window.__WE_PHYSICS__ || !window.__WE_CAM_DRAG_RMB__) return;
                const dx =
                    e.movementX ||
                    e.clientX - (window.__WE_CAM_DRAG_LAST_X__ || e.clientX) ||
                    0;
                const dy =
                    e.movementY ||
                    e.clientY - (window.__WE_CAM_DRAG_LAST_Y__ || e.clientY) ||
                    0;
                window.__WE_CAM_DRAG_LAST_X__ = e.clientX;
                window.__WE_CAM_DRAG_LAST_Y__ = e.clientY;
                const sensitivity = 0.004;
                window.__WE_CAM_OFFSET_YAW__ =
                    (window.__WE_CAM_OFFSET_YAW__ ?? threeCamera.rotation.y) -
                    dx * sensitivity;
                // Adjust vertical height with Y drag (drag up increases height)
                const heightSensitivity = 0.02; // world units per pixel
                window.__WE_CAM_OFFSET_HEIGHT__ = Math.min(
                    20.0,
                    Math.max(
                        0.5,
                        (window.__WE_CAM_OFFSET_HEIGHT__ ?? 3.0) -
                        dy * heightSensitivity
                    )
                );
                // Recompute offset immediately
                const r = window.__WE_CAM_OFFSET_RADIUS__ ?? 8.0;
                const h = window.__WE_CAM_OFFSET_HEIGHT__ ?? 3.0;
                const yaw = window.__WE_CAM_OFFSET_YAW__ ?? threeCamera.rotation.y;
                window.__WE_CAM_OFFSET__ = new THREE.Vector3(
                    r * Math.sin(yaw),
                    h,
                    r * Math.cos(yaw)
                );
                e.preventDefault();
                if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                if (e.stopPropagation) e.stopPropagation();
            };
            const onContextMenu = (e) => {
                if (window.__WE_PHYSICS__) {
                    e.preventDefault();
                    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                    if (e.stopPropagation) e.stopPropagation();
                }
            };
            const onWheelZoom = (e) => {
                if (!window.__WE_PHYSICS__) return;
                // Normalize wheel delta across devices and apply gentle sensitivity
                const sensitivity = window.__WE_CAM_WHEEL_SENS__ ?? 0.005;
                const deltaScale =
                    e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 800 : 1;
                const delta = e.deltaY * deltaScale;
                const dir = Math.sign(delta);
                const MIN_R = 2.5;
                const MAX_R = 20.0;
                const LIMIT_PAD = window.__WE_CAM_LIMIT_PAD__ ?? 0.2; // prevent scrolling when within this of a limit
                const current =
                    window.__WE_CAM_TARGET_RADIUS__ ??
                    window.__WE_CAM_OFFSET_RADIUS__ ??
                    8.0;
                // Block further scrolling if already at/near the limits in the same direction
                if (
                    (current <= MIN_R + LIMIT_PAD && dir < 0) ||
                    (current >= MAX_R - LIMIT_PAD && dir > 0)
                ) {
                    e.preventDefault();
                    return;
                }
                const next = current + delta * sensitivity;
                window.__WE_CAM_TARGET_RADIUS__ = Math.min(
                    MAX_R,
                    Math.max(MIN_R, next)
                );
                e.preventDefault();
                if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                if (e.stopPropagation) e.stopPropagation();
            };
            window.addEventListener("keydown", onArrowKeyDown);
            window.addEventListener("keyup", onArrowKeyUp);
            window.addEventListener("mousedown", onMouseDownRMB);
            window.addEventListener("mouseup", onMouseUpRMB);
            window.addEventListener("mousemove", onMouseMoveRMB);
            window.addEventListener("wheel", onWheelZoom, { passive: false });
            window.addEventListener("contextmenu", onContextMenu, {
                capture: true,
            });
            // No pointer lock: derive yaw from current camera rotation when Player Mode is active

            cameraManager.initialize(threeCamera, orbitControlsRef.current);
            let frameId;
            let frameCount = 0;
            const animate = (time) => {
                frameId = requestAnimationFrame(animate);
                if (BlockMaterial.instance.liquidMaterial) {
                    BlockMaterial.instance.updateLiquidTime((time / 1000) * 0.5);
                }
                if (isPlacingRef.current && frameCount % 30 === 0) {
                    if (!window.mouseButtons || !(window.mouseButtons & 1)) {
                        handleMouseUp({ button: 0 });
                    }
                }

                // Safety check: Restore pixel ratio if we're not placing but still have a stored original ratio
                // This catches edge cases where mouse up didn't fire properly
                if (
                    !isPlacingRef.current &&
                    originalPixelRatioRef.current &&
                    gl &&
                    typeof gl.setPixelRatio === "function" &&
                    frameCount % 60 === 0
                ) {
                    try {
                        const currentRatio = gl.getPixelRatio();
                        const originalRatio = originalPixelRatioRef.current;
                        // Only restore if current ratio is significantly lower than original (indicating it was reduced)
                        if (currentRatio < originalRatio * 0.8) {
                            gl.setPixelRatio(originalRatio);
                            originalPixelRatioRef.current = null;
                        }
                    } catch (err) {
                        // Clear the ref even if restoration failed to prevent stuck state
                        originalPixelRatioRef.current = null;
                    }
                }
                if (isPlacingRef.current) {
                    updatePreviewPosition();
                }
                frameCount++;
                if (!threeCamera) {
                    return;
                }
                if (!currentCameraRef.current) {
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

                // Update camera position for environment culling
                if (frameCount % 10 === 0 && onCameraPositionChange) {
                    onCameraPositionChange(threeCamera.position.clone());
                }

                // Update TransformControls if SelectionTool has an active gizmo
                if (toolManagerRef.current) {
                    const activeTool = toolManagerRef.current.getActiveTool();
                    if (
                        activeTool?.name === "selection" &&
                        activeTool?.transformControls
                    ) {
                        // TransformControls handles its own rendering and updates automatically
                        // No manual update() call needed - it updates based on camera and mouse events
                    }
                }

                // Step player physics if available
                try {
                    const physics = window.__WE_PHYSICS__;
                    const inputMgr = window.__WE_INPUT_STATE__;
                    if (physics && inputMgr) {
                        const now = performance.now();
                        const dt =
                            (window.__WE_LAST_PHYSICS_TS__
                                ? now - window.__WE_LAST_PHYSICS_TS__
                                : 16.6) / 1000;
                        // Clamp delta for stable, frame-rate independent smoothing
                        const dtClamped = Math.min(0.1, Math.max(0, dt));
                        window.__WE_LAST_PHYSICS_TS__ = now;

                        // Maintain third-person yaw accumulator
                        if (window.__WE_TP_YAW__ === undefined) {
                            window.__WE_TP_YAW__ = threeCamera.rotation.y;
                        }
                        // Update yaw from mouse movement when pointer is locked, else keep it steady
                        // (We store last yaw elsewhere and nudge it using the change in camera yaw only when orbit controls are disabled)
                        if (
                            orbitControlsRef.current &&
                            !orbitControlsRef.current.enableRotate
                        ) {
                            window.__WE_TP_YAW__ = threeCamera.rotation.y;
                        }

                        // Derive movement yaw. If we already have a player position, face away from camera.
                        const prePos = physics.getPlayerPosition?.();
                        if (threeCamera && prePos) {
                            const dirX = prePos.x - threeCamera.position.x;
                            const dirZ = prePos.z - threeCamera.position.z;
                            // Face movement direction (toward where we will move): camera-forward projected
                            window.__WE_TP_YAW__ = Math.atan2(dirX, dirZ);
                        }
                        // Provide PhysicsManager with a solid query backed by spatial hash and environment colliders
                        // Always set up the solid query when physics is active to ensure it's set even if physics manager was recreated
                        try {
                            const solidFn = (x, y, z) => {
                                try {
                                    // Blocks via spatial grid
                                    const sgm = spatialGridManagerRef.current;
                                    if (
                                        sgm &&
                                        sgm.hasBlock(
                                            Math.floor(x),
                                            Math.floor(y),
                                            Math.floor(z)
                                        )
                                    )
                                        return true;
                                    // Environment entities with colliders: approximate by checking an occupancy flag in spatial hash
                                    // We already write env objects into spatial hash using updateSpatialHashForBlocks with model add/remove.
                                    // So sgm.hasBlock covers them too when addCollider is enabled.
                                } catch (_) { }
                                return false;
                            };
                            physics.setIsSolidQuery(solidFn);
                            // Also expose to window for fallback path inside physics
                            window.__WE_IS_SOLID__ = solidFn;
                            window.__WE_SOLID_BOUND__ = true;
                        } catch (_) { }

                        physics.step(
                            dt,
                            inputMgr.state || {},
                            (window.__WE_TP_YAW__ || 0) + Math.PI
                        );

                        const p = physics.getPlayerPosition?.();
                        if (p && threeCamera) {
                            // Ensure player mesh is loaded once
                            if (
                                !window.__WE_PLAYER_MESH__ &&
                                !window.__WE_PLAYER_MESH_LOADING__
                            ) {
                                window.__WE_PLAYER_MESH_LOADING__ = true;
                                const loader = new GLTFLoader();
                                loader.load(
                                    "./assets/models/players/player.gltf",
                                    (gltf) => {
                                        const obj = gltf.scene || gltf.scenes?.[0];
                                        if (obj) {
                                            obj.traverse((child: any) => {
                                                if (child.isMesh) {
                                                    child.castShadow = true;
                                                    child.receiveShadow = true;
                                                }
                                            });
                                            scene && scene.add(obj);
                                            window.__WE_PLAYER_MESH__ = obj;

                                            // Setup basic animation state
                                            if (
                                                gltf.animations &&
                                                gltf.animations.length
                                            ) {
                                                const mixer =
                                                    new THREE.AnimationMixer(obj);
                                                window.__WE_PLAYER_MIXER__ = mixer;
                                                const clips = gltf.animations;
                                                const findClip = (names) =>
                                                    clips.find((c) =>
                                                        names.some((n) =>
                                                            c.name
                                                                .toLowerCase()
                                                                .includes(n)
                                                        )
                                                    );
                                                const actions = {};
                                                const tags = [
                                                    "idle",
                                                    "walk",
                                                    "run",
                                                ];
                                                for (const tag of tags) {
                                                    const single = findClip(
                                                        tag === "run"
                                                            ? ["run", "sprint"]
                                                            : [tag]
                                                    );
                                                    const upper = findClip(
                                                        tag === "run"
                                                            ? [
                                                                "run-upper",
                                                                "run_upper",
                                                                "sprint-upper",
                                                                "sprint_upper",
                                                            ]
                                                            : [
                                                                `${tag}-upper`,
                                                                `${tag}_upper`,
                                                            ]
                                                    );
                                                    const lower = findClip(
                                                        tag === "run"
                                                            ? [
                                                                "run-lower",
                                                                "run_lower",
                                                                "sprint-lower",
                                                                "sprint_lower",
                                                            ]
                                                            : [
                                                                `${tag}-lower`,
                                                                `${tag}_lower`,
                                                            ]
                                                    );
                                                    if (single)
                                                        actions[tag] =
                                                            mixer.clipAction(
                                                                single
                                                            );
                                                    if (upper)
                                                        actions[`${tag}-upper`] =
                                                            mixer.clipAction(upper);
                                                    if (lower)
                                                        actions[`${tag}-lower`] =
                                                            mixer.clipAction(lower);
                                                }
                                                // Jump-related animations (oneshots/loops)
                                                const jumpUpper = findClip([
                                                    "jump-upper",
                                                    "jump_upper",
                                                ]);
                                                const jumpLower = findClip([
                                                    "jump-lower",
                                                    "jump_lower",
                                                ]);
                                                if (jumpUpper)
                                                    actions["jump-upper"] =
                                                        mixer.clipAction(jumpUpper);
                                                if (jumpLower)
                                                    actions["jump-lower"] =
                                                        mixer.clipAction(jumpLower);
                                                const jumpLoop = findClip([
                                                    "jump-loop",
                                                    "jump_loop",
                                                ]);
                                                if (jumpLoop)
                                                    actions["jump-loop"] =
                                                        mixer.clipAction(jumpLoop);
                                                const jumpSingle = findClip([
                                                    "jump",
                                                ]);
                                                if (jumpSingle)
                                                    actions["jump"] =
                                                        mixer.clipAction(
                                                            jumpSingle
                                                        );
                                                const landLight = findClip([
                                                    "jump-post-light",
                                                ]);
                                                const landHeavy = findClip([
                                                    "jump-post-heavy",
                                                ]);
                                                if (landLight)
                                                    actions["land-light"] =
                                                        mixer.clipAction(landLight);
                                                if (landHeavy)
                                                    actions["land-heavy"] =
                                                        mixer.clipAction(landHeavy);
                                                window.__WE_PLAYER_ANIMS__ =
                                                    actions;
                                                const start =
                                                    actions["idle-upper"] &&
                                                        actions["idle-lower"]
                                                        ? undefined
                                                        : (actions as any).idle ||
                                                        (actions as any).walk ||
                                                        (actions as any).run;
                                                if (start) {
                                                    start
                                                        .reset()
                                                        .fadeIn(0.2)
                                                        .play();
                                                    window.__WE_PLAYER_ACTIVE__ =
                                                        start;
                                                }
                                            }
                                        }
                                        window.__WE_PLAYER_MESH_LOADING__ = false;
                                    },
                                    undefined,
                                    () => {
                                        window.__WE_PLAYER_MESH_LOADING__ = false;
                                    }
                                );
                            }

                            // Update player mesh transform and facing
                            if (window.__WE_PLAYER_MESH__) {
                                const m = window.__WE_PLAYER_MESH__;
                                const last = window.__WE_LAST_POS__ || {
                                    x: p.x,
                                    y: p.y,
                                    z: p.z,
                                };
                                // position lerp
                                const halfH =
                                    window.__WE_PHYSICS__ &&
                                        window.__WE_PHYSICS__.getPlayerHalfHeight
                                        ? window.__WE_PHYSICS__.getPlayerHalfHeight()
                                        : 0.75;
                                const worldYOffset =
                                    window.__WE_WORLD_Y_OFFSET__ !== undefined
                                        ? window.__WE_WORLD_Y_OFFSET__
                                        : 0.5; // editor-wide +0.5 shift compensation
                                const worldXOffset =
                                    window.__WE_WORLD_X_OFFSET__ !== undefined
                                        ? window.__WE_WORLD_X_OFFSET__
                                        : -0.5; // editor-wide +0.5 shift compensation
                                const worldZOffset =
                                    window.__WE_WORLD_Z_OFFSET__ !== undefined
                                        ? window.__WE_WORLD_Z_OFFSET__
                                        : -0.5; // editor-wide +0.5 shift compensation
                                const cur = new THREE.Vector3(
                                    p.x + worldXOffset,
                                    p.y - halfH - worldYOffset,
                                    p.z + worldZOffset
                                );
                                // Frame-rate independent smoothing for visual player mesh
                                const meshAlpha = 1 - Math.exp(-30 * dtClamped);
                                m.position.lerp(cur, meshAlpha);
                                // compute facing from velocity when moving
                                const dx = p.x - last.x;
                                const dz = p.z - last.z;
                                const speed2 = dx * dx + dz * dz;
                                if (speed2 > 1e-6) {
                                    const faceYaw = Math.atan2(dx, dz) + Math.PI; // flip to face movement correctly
                                    window.__WE_FACE_YAW__ = faceYaw;
                                }
                                const yawToUse =
                                    window.__WE_FACE_YAW__ !== undefined
                                        ? window.__WE_FACE_YAW__
                                        : window.__WE_TP_YAW__ || 0;
                                m.rotation.y = yawToUse;
                            }

                            // Apply smooth camera offset adjustments from input each frame
                            if (
                                window.__WE_CAM_KEYS__ ||
                                window.__WE_CAM_TARGET_RADIUS__ !== undefined
                            ) {
                                const yawStep = 1.6 * dt; // radians per second
                                const radiusStep = 6.0 * dt; // units per second
                                const heightStep = 6.0 * dt; // units per second
                                window.__WE_CAM_OFFSET_YAW__ =
                                    window.__WE_CAM_OFFSET_YAW__ ??
                                    (window.__WE_TP_YAW__ ||
                                        threeCamera.rotation.y);
                                window.__WE_CAM_OFFSET_RADIUS__ =
                                    window.__WE_CAM_OFFSET_RADIUS__ ?? 8.0;
                                window.__WE_CAM_OFFSET_HEIGHT__ =
                                    window.__WE_CAM_OFFSET_HEIGHT__ ?? 3.0;
                                if (window.__WE_CAM_KEYS__.left)
                                    window.__WE_CAM_OFFSET_YAW__ -= yawStep;
                                if (window.__WE_CAM_KEYS__.right)
                                    window.__WE_CAM_OFFSET_YAW__ += yawStep;
                                // Up/Down arrows move camera vertically instead of zooming
                                if (window.__WE_CAM_KEYS__.up)
                                    window.__WE_CAM_OFFSET_HEIGHT__ = Math.min(
                                        20.0,
                                        window.__WE_CAM_OFFSET_HEIGHT__ + heightStep
                                    );
                                if (window.__WE_CAM_KEYS__.down)
                                    window.__WE_CAM_OFFSET_HEIGHT__ = Math.max(
                                        0.5,
                                        window.__WE_CAM_OFFSET_HEIGHT__ - heightStep
                                    );
                                // Smoothly approach target radius from wheel input
                                if (window.__WE_CAM_TARGET_RADIUS__ !== undefined) {
                                    const target = window.__WE_CAM_TARGET_RADIUS__;
                                    const cur = window.__WE_CAM_OFFSET_RADIUS__;
                                    const diff = target - cur;
                                    if (Math.abs(diff) < 1e-3) {
                                        window.__WE_CAM_OFFSET_RADIUS__ = target;
                                        window.__WE_CAM_TARGET_RADIUS__ = undefined;
                                    } else {
                                        const lerp = 1 - Math.pow(0.001, dt); // slower, smoother
                                        window.__WE_CAM_OFFSET_RADIUS__ =
                                            cur + diff * lerp;
                                    }
                                    // Clamp hard limits
                                    const MIN_R = 2.5;
                                    const MAX_R = 20.0;
                                    window.__WE_CAM_OFFSET_RADIUS__ = Math.min(
                                        MAX_R,
                                        Math.max(
                                            MIN_R,
                                            window.__WE_CAM_OFFSET_RADIUS__
                                        )
                                    );
                                }
                                const r = window.__WE_CAM_OFFSET_RADIUS__;
                                const h = window.__WE_CAM_OFFSET_HEIGHT__;
                                const yaw = window.__WE_CAM_OFFSET_YAW__;
                                window.__WE_CAM_OFFSET__ = new THREE.Vector3(
                                    r * Math.sin(yaw),
                                    h,
                                    r * Math.cos(yaw)
                                );
                            }

                            // Third-person camera follow
                            // Camera follow using persistent offset (keeps perfect sync with player movement)
                            // Always focus the camera on the player mesh centerline, compensating for global editor offsets
                            const camHalfH =
                                window.__WE_PHYSICS__ &&
                                    window.__WE_PHYSICS__.getPlayerHalfHeight
                                    ? window.__WE_PHYSICS__.getPlayerHalfHeight()
                                    : 0.75;
                            const camWorldYOffset =
                                window.__WE_WORLD_Y_OFFSET__ !== undefined
                                    ? window.__WE_WORLD_Y_OFFSET__
                                    : 0.5;
                            const camWorldXOffset =
                                window.__WE_WORLD_X_OFFSET__ !== undefined
                                    ? window.__WE_WORLD_X_OFFSET__
                                    : -0.5;
                            const camWorldZOffset =
                                window.__WE_WORLD_Z_OFFSET__ !== undefined
                                    ? window.__WE_WORLD_Z_OFFSET__
                                    : -0.5;
                            // Prefer smoothed player mesh position as base to avoid camera jitter from discrete physics steps
                            let playerMeshBase;
                            if (window.__WE_PLAYER_MESH__) {
                                playerMeshBase =
                                    window.__WE_PLAYER_MESH__.position.clone();
                            } else {
                                playerMeshBase = new THREE.Vector3(
                                    p.x + camWorldXOffset,
                                    p.y - camHalfH - camWorldYOffset,
                                    p.z + camWorldZOffset
                                );
                            }
                            const aimYOffset = Math.max(
                                0.6,
                                Math.min(1.25, camHalfH * 0.66)
                            );
                            const target = playerMeshBase
                                .clone()
                                .add(new THREE.Vector3(0, aimYOffset, 0));
                            if (!window.__WE_CAM_OFFSET__) {
                                const baseYaw =
                                    window.__WE_FACE_YAW__ !== undefined
                                        ? window.__WE_FACE_YAW__
                                        : window.__WE_TP_YAW__ ||
                                        threeCamera.rotation.y;
                                const radius = 8.0;
                                const height = 3.0;
                                // Offset starts behind and above the player relative to yaw
                                window.__WE_CAM_OFFSET__ = new THREE.Vector3(
                                    radius * Math.sin(baseYaw),
                                    height,
                                    radius * Math.cos(baseYaw)
                                );
                            }
                            const desired = target
                                .clone()
                                .add(window.__WE_CAM_OFFSET__);
                            // Frame-rate independent smoothing for camera follow
                            const camAlpha = 1 - Math.exp(-25 * dtClamped);
                            threeCamera.position.lerp(desired, camAlpha);
                            // Smooth orientation as well to reduce visible shaking from discrete target updates
                            {
                                const currentQuat = threeCamera.quaternion.clone();
                                threeCamera.lookAt(target);
                                const desiredQuat = threeCamera.quaternion.clone();
                                threeCamera.quaternion.copy(currentQuat);
                                threeCamera.quaternion.slerp(desiredQuat, camAlpha);
                            }
                            if (
                                orbitControlsRef.current &&
                                orbitControlsRef.current.target
                            ) {
                                // Keep target aligned for when player mode ends, but avoid controls.update() to prevent damping shifts
                                orbitControlsRef.current.target.copy(target);
                            }

                            // Advance animation mixer and pick state based on key state (no restart on every tick)
                            if (window.__WE_PLAYER_MIXER__) {
                                const mixer = window.__WE_PLAYER_MIXER__;
                                mixer.update(dt);
                                const state =
                                    (window.__WE_INPUT_STATE__ &&
                                        window.__WE_INPUT_STATE__.state) ||
                                    {};
                                const moving = !!(
                                    state.w ||
                                    state.a ||
                                    state.s ||
                                    state.d
                                );
                                const running = moving && !!state.sh;
                                const actions = window.__WE_PLAYER_ANIMS__ || {};
                                // Grounded / airborne detection for jump animations
                                const halfH =
                                    window.__WE_PHYSICS__ &&
                                        window.__WE_PHYSICS__.getPlayerHalfHeight
                                        ? window.__WE_PHYSICS__.getPlayerHalfHeight()
                                        : 0.75;
                                const bottomY = p.y - halfH;
                                const isSolidFn =
                                    (window.__WE_IS_SOLID__ &&
                                        typeof window.__WE_IS_SOLID__ ===
                                        "function" &&
                                        window.__WE_IS_SOLID__) ||
                                    null;
                                const bx = Math.floor(p.x);
                                const by = Math.floor(bottomY - 0.01);
                                const bz = Math.floor(p.z);
                                const hasVoxelBelow = isSolidFn
                                    ? isSolidFn(bx, by, bz)
                                    : false;
                                const nearFlatPlane =
                                    Math.abs(bottomY - 0.0) <= 0.08;
                                const groundedNow =
                                    (hasVoxelBelow && bottomY <= by + 1 + 0.08) ||
                                    nearFlatPlane;
                                const lastPos = window.__WE_LAST_POS__ || p;
                                const vy = p.y - lastPos.y;
                                const wasAirborne = !!window.__WE_AIRBORNE__;
                                let airborneNow = wasAirborne;
                                let playedLanding = false;
                                const nowTs = performance.now();
                                // Start airborne if leaving ground with upward velocity or space pressed
                                if (!groundedNow && (state.sp || vy > 0.02)) {
                                    if (!wasAirborne) {
                                        window.__WE_AIRBORNE_SEQ__ =
                                            (window.__WE_AIRBORNE_SEQ__ || 0) + 1;
                                        window.__WE_AIRBORNE_SINCE__ = nowTs;
                                    }
                                    airborneNow = true;
                                }
                                // End airborne on ground contact
                                if (groundedNow && wasAirborne) {
                                    airborneNow = false;
                                    const seq = window.__WE_AIRBORNE_SEQ__ || 0;
                                    const lastLandedSeq =
                                        window.__WE_LAST_LANDED_SEQ__ || 0;
                                    const airborneMs = Math.max(
                                        0,
                                        nowTs -
                                        (window.__WE_AIRBORNE_SINCE__ || nowTs)
                                    );
                                    const speedMag = Math.abs(vy);
                                    // Only play landing once per airborne sequence, with sensible thresholds
                                    if (
                                        seq !== lastLandedSeq &&
                                        airborneMs > 200 &&
                                        speedMag > 0.35
                                    ) {
                                        const landingAction =
                                            speedMag > 0.6
                                                ? actions["land-heavy"]
                                                : actions["land-light"];
                                        if (landingAction) {
                                            // Configure landing as oneshot and clamp at end
                                            landingAction.setLoop(
                                                THREE.LoopOnce,
                                                0
                                            );
                                            landingAction.clampWhenFinished = true;
                                            landingAction
                                                .reset()
                                                .fadeIn(0.05)
                                                .play();
                                            playedLanding = true;
                                            window.__WE_LAST_LANDED_SEQ__ = seq;
                                            // Suppress idle/walk/run blending while landing plays
                                            try {
                                                const dur =
                                                    landingAction.getClip()
                                                        .duration || 0.35;
                                                window.__WE_LANDING_UNTIL__ =
                                                    performance.now() + dur * 1000;
                                                window.__WE_LANDING_ACTION__ =
                                                    landingAction;
                                            } catch { }
                                        }
                                    } else if (seq !== lastLandedSeq) {
                                        // Consume landing sequence even if thresholds not met to avoid repeated handling
                                        window.__WE_LAST_LANDED_SEQ__ = seq;
                                    }
                                }
                                window.__WE_AIRBORNE__ = airborneNow;

                                // Debug logs: enable with window.__WE_DEBUG_JUMP__ = true (only on transitions/landing)

                                // Choose tag with jump priority
                                let tag = "idle";
                                if (airborneNow) {
                                    tag = "jump";
                                } else if (moving) {
                                    tag = running ? "run" : "walk";
                                }
                                // If a landing oneshot is currently active, defer any new state changes to let it finish
                                const landingUntil =
                                    window.__WE_LANDING_UNTIL__ || 0;
                                const nowTs2 = performance.now();
                                const landingActive = nowTs2 < landingUntil;
                                let landingJustEnded = false;
                                if (!landingActive && window.__WE_LANDING_UNTIL__) {
                                    // window just expired; clear and force retag to resume base loop
                                    window.__WE_LANDING_UNTIL__ = 0;
                                    try {
                                        if (window.__WE_LANDING_ACTION__) {
                                            window.__WE_LANDING_ACTION__.fadeOut(
                                                0.08
                                            );
                                            window.__WE_LANDING_ACTION__.stop();
                                        }
                                    } catch (_) { }
                                    window.__WE_LANDING_ACTION__ = undefined;
                                    landingJustEnded = true;
                                    window.__WE_PLAYER_ACTIVE_TAG__ = undefined;
                                }
                                if (
                                    !landingActive &&
                                    (window.__WE_PLAYER_ACTIVE_TAG__ !== tag ||
                                        landingJustEnded)
                                ) {
                                    // Fade out any current
                                    if (window.__WE_PLAYER_ACTIVE__)
                                        window.__WE_PLAYER_ACTIVE__.fadeOut(0.1);
                                    if (window.__WE_PLAYER_ACTIVE_UPPER__)
                                        window.__WE_PLAYER_ACTIVE_UPPER__.fadeOut(
                                            0.1
                                        );
                                    if (window.__WE_PLAYER_ACTIVE_LOWER__)
                                        window.__WE_PLAYER_ACTIVE_LOWER__.fadeOut(
                                            0.1
                                        );
                                    // Start new
                                    if (tag === "jump") {
                                        // Prefer upper/lower jump, then jump-loop, then jump
                                        const u =
                                            actions["jump-upper"] ||
                                            actions["jump_upper"];
                                        const l =
                                            actions["jump-lower"] ||
                                            actions["jump_lower"];
                                        if (u && l) {
                                            window.__WE_PLAYER_ACTIVE_UPPER__ = u
                                                .reset()
                                                .fadeIn(0.05)
                                                .play();
                                            window.__WE_PLAYER_ACTIVE_LOWER__ = l
                                                .reset()
                                                .fadeIn(0.05)
                                                .play();
                                            window.__WE_PLAYER_ACTIVE__ = undefined;
                                        } else if (actions["jump-loop"]) {
                                            window.__WE_PLAYER_ACTIVE__ = actions[
                                                "jump-loop"
                                            ]
                                                .reset()
                                                .fadeIn(0.05)
                                                .play();
                                            window.__WE_PLAYER_ACTIVE_UPPER__ =
                                                undefined;
                                            window.__WE_PLAYER_ACTIVE_LOWER__ =
                                                undefined;
                                        } else if (actions["jump"]) {
                                            window.__WE_PLAYER_ACTIVE__ = actions[
                                                "jump"
                                            ]
                                                .reset()
                                                .fadeIn(0.05)
                                                .play();
                                            window.__WE_PLAYER_ACTIVE_UPPER__ =
                                                undefined;
                                            window.__WE_PLAYER_ACTIVE_LOWER__ =
                                                undefined;
                                        }
                                    } else {
                                        // Choose explicit clips by tag: run, walk, or idle
                                        let upper = undefined;
                                        let lower = undefined;
                                        let single = undefined;
                                        if (tag === "run") {
                                            upper =
                                                actions["run-upper"] ||
                                                actions["run_upper"] ||
                                                actions["sprint-upper"] ||
                                                actions["sprint_upper"];
                                            lower =
                                                actions["run-lower"] ||
                                                actions["run_lower"] ||
                                                actions["sprint-lower"] ||
                                                actions["sprint_lower"];
                                            single =
                                                actions["run"] || actions["sprint"];
                                        } else if (tag === "walk") {
                                            upper =
                                                actions["walk-upper"] ||
                                                actions["walk_upper"];
                                            lower =
                                                actions["walk-lower"] ||
                                                actions["walk_lower"];
                                            single = actions["walk"];
                                        } else {
                                            // idle
                                            upper =
                                                actions["idle-upper"] ||
                                                actions["idle_upper"];
                                            lower =
                                                actions["idle-lower"] ||
                                                actions["idle_lower"];
                                            single = actions["idle"];
                                        }
                                        if (upper && lower) {
                                            window.__WE_PLAYER_ACTIVE_UPPER__ =
                                                upper.reset().fadeIn(0.1).play();
                                            window.__WE_PLAYER_ACTIVE_LOWER__ =
                                                lower.reset().fadeIn(0.1).play();
                                            window.__WE_PLAYER_ACTIVE__ = undefined;
                                        } else {
                                            if (single) {
                                                window.__WE_PLAYER_ACTIVE__ = single
                                                    .reset()
                                                    .fadeIn(0.1)
                                                    .play();
                                            }
                                            window.__WE_PLAYER_ACTIVE_UPPER__ =
                                                undefined;
                                            window.__WE_PLAYER_ACTIVE_LOWER__ =
                                                undefined;
                                        }
                                    }
                                    window.__WE_PLAYER_ACTIVE_TAG__ = tag;
                                }
                                // Update last pos for facing calc
                                window.__WE_LAST_POS__ = { x: p.x, y: p.y, z: p.z };
                            }

                            // Lock editor orbit rotation while in player mode
                            if (orbitControlsRef.current) {
                                orbitControlsRef.current.enableRotate = false;
                                orbitControlsRef.current.enablePan = false;
                                orbitControlsRef.current.enableZoom = false;
                            }
                        }
                    } else {
                        // Re-enable orbit controls and despawn player mesh when leaving player mode
                        if (orbitControlsRef.current) {
                            orbitControlsRef.current.enableRotate = true;
                            orbitControlsRef.current.enablePan = true;
                            orbitControlsRef.current.enableZoom = false; // project default
                        }
                        if (window.__WE_PLAYER_MESH__) {
                            try {
                                scene && scene.remove(window.__WE_PLAYER_MESH__);
                            } catch (_) { }
                            window.__WE_PLAYER_MESH__ = undefined;
                        }
                    }
                } catch (_) { }
            };
            frameId = requestAnimationFrame(animate);
            return () => {
                cancelAnimationFrame(frameId);
                window.removeEventListener("keydown", onArrowKeyDown);
                window.removeEventListener("keyup", onArrowKeyUp);
                window.removeEventListener("mousedown", onMouseDownRMB);
                window.removeEventListener("mouseup", onMouseUpRMB);
                window.removeEventListener("mousemove", onMouseMoveRMB);
                window.removeEventListener("wheel", onWheelZoom);
                window.removeEventListener("contextmenu", onContextMenu, true);

                // Safety: Restore pixel ratio on cleanup if it was lowered
                if (
                    originalPixelRatioRef.current &&
                    gl &&
                    typeof gl.setPixelRatio === "function"
                ) {
                    try {
                        gl.setPixelRatio(originalPixelRatioRef.current);
                        originalPixelRatioRef.current = null;
                    } catch (err) {
                        // Failed to restore pixel ratio on cleanup
                    }
                }
            };
        }, [gl]);

        function setGridVisible(visible: boolean) {
            if (gridRef.current) {
                (gridRef.current as any).visible = visible;
            }
        }

        function setGridY(baseY: number) {
            baseGridYRef.current = baseY;
            setBaseGridYState(baseY); // Update state for JSX reactivity
            const yPosition = baseY - 0.5; // Apply -0.5 offset
            if (gridRef.current) {
                gridRef.current.position.y = yPosition;
            }
            if (shadowPlaneRef.current) {
                shadowPlaneRef.current.position.y = yPosition;
            }
        }

        function getGridY(): number {
            return baseGridYRef.current;
        }

        // Initialize GPU-optimized settings on mount
        useEffect(() => {
            const gpuInfo = detectGPU();
            const settings = getRecommendedSettings(gpuInfo);

            // Apply GPU-specific optimizations
            switch (gpuInfo.estimatedPerformanceClass) {
                case "low":
                    settings.shadowMapSize = 1024;
                    settings.viewDistance = 4;
                    settings.pixelRatio = Math.min(window.devicePixelRatio, 1.5);
                    settings.antialias = false;
                    settings.maxEnvironmentObjects = 500;
                    break;
                case "high":
                    settings.shadowMapSize = 4096;
                    settings.viewDistance = 12;
                    settings.maxEnvironmentObjects = 2000;
                    break;
            }

            setShadowMapSize(settings.shadowMapSize);

            // Set view distance based on GPU capability
            if (settings.viewDistance) {
                try {
                    const { setViewDistance } = require("./constants/terrain");
                    setViewDistance(settings.viewDistance * 8); // Convert chunks to blocks
                } catch (error) {
                    // Could not set view distance
                }
            }

        }, []);

        return (
            <>
                <OrbitControls
                    ref={orbitControlsRef}
                    enablePan={true}
                    enableZoom={false}
                    enableRotate={true}
                    mouseButtons={{
                        LEFT: !cameraManager.isPointerUnlockedMode ? THREE.MOUSE.ROTATE : null,
                        MIDDLE: THREE.MOUSE.PAN,
                        RIGHT: THREE.MOUSE.ROTATE,
                    }}
                    onChange={handleCameraMove}
                    enabled={!isInputDisabled} // Keep this for OrbitControls mouse input
                />
                {/* 
                  SDK-compatible lighting: Three.js lights are removed.
                  - MeshBasicMaterial doesn't respond to Three.js lighting system
                  - All lighting is applied manually in shaders via BlockMaterial
                  - Ambient light color/intensity are stored in BlockMaterial.ambientLight
                  - Block light levels from emissive blocks are passed as vertex attributes
                  - Face-based shading is baked into vertex colors
                  
                  We keep a dummy ambient light for API compatibility and shadow plane lighting.
                */}
                {/* @ts-expect-error - React Three Fiber JSX elements */}
                <ambientLight ref={ambientRef} intensity={1} />
                {/* mesh of invisible plane to receive shadows, and grid helper to display grid */}
                {/* @ts-expect-error - React Three Fiber JSX elements */}
                <mesh
                    ref={shadowPlaneRef}
                    position={[0.5, baseGridY - 0.5, 0.5]}
                    rotation={[-Math.PI / 2, 0, 0]}
                    transparent={true}
                    receiveShadow={true}
                    castShadow={false}
                    frustumCulled={false}
                >
                    {/* @ts-expect-error - React Three Fiber JSX elements */}
                    <planeGeometry args={[gridSize, gridSize]} />
                    {/* @ts-expect-error - React Three Fiber JSX elements */}
                    <meshPhongMaterial transparent opacity={0} />
                    {/* @ts-ignore - React Three Fiber JSX closing tag */}
                </mesh>
                {/* @ts-expect-error - React Three Fiber JSX elements */}
                <gridHelper position={[0.5, baseGridY - 0.5, 0.5]} ref={gridRef} />
                {window.__WE_PREVIEW_VISIBLE__ !== false &&
                    previewPosition &&
                    (modeRef.current === "add" || modeRef.current === "remove") &&
                    !shouldHidePreviewBlock && (
                        /* @ts-expect-error - React Three Fiber JSX elements */
                        <group>
                            {getPlacementPositions(
                                previewPosition,
                                placementSizeRef.current
                            ).map((pos, index) => (
                                /* @ts-expect-error - React Three Fiber JSX elements */
                                <group key={index} position={[pos.x, pos.y, pos.z]}>
                                    {/* @ts-expect-error - React Three Fiber JSX elements */}
                                    <mesh renderOrder={2}>
                                        {/* @ts-expect-error - React Three Fiber JSX elements */}
                                        <boxGeometry args={[1.02, 1.02, 1.02]} />
                                        {/* @ts-expect-error - React Three Fiber JSX elements */}
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
                                        {/* @ts-ignore - React Three Fiber JSX closing tag */}
                                    </mesh>
                                    {/* @ts-expect-error - React Three Fiber JSX elements */}
                                    <lineSegments renderOrder={3}>
                                        {/* @ts-expect-error - React Three Fiber JSX elements */}
                                        <edgesGeometry
                                            args={[new THREE.BoxGeometry(1, 1, 1)]}
                                        />
                                        {/* @ts-expect-error - React Three Fiber JSX elements */}
                                        <lineBasicMaterial
                                            color="darkgreen"
                                            linewidth={2}
                                        />
                                        {/* @ts-ignore - React Three Fiber JSX closing tag */}
                                    </lineSegments>
                                    {/* @ts-ignore - React Three Fiber JSX closing tag */}
                                </group>
                            ))}
                            {/* @ts-ignore - React Three Fiber JSX closing tag */}
                        </group>
                    )}
            </>
        );
    }
);

export default TerrainBuilder;
export {
    blockTypes,
    getBlockTypes,
    getCustomBlocks,
    processCustomBlock,
} from "./managers/BlockTypesManager";
