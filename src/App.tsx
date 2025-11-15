import { defaultTheme, Provider } from "@adobe/react-spectrum";
import { Canvas } from "@react-three/fiber";
import { saveAs } from "file-saver";
import JSZip from "jszip";
import { useCallback, useEffect, useRef, useState } from "react";
import { Vector3 } from 'three';
import "./css/App.css";
import { cameraManager } from "./js/Camera";
import { IS_UNDER_CONSTRUCTION, version } from "./js/Constants";
import EnvironmentBuilder, { environmentModels } from "./js/EnvironmentBuilder";
import TerrainBuilder from "./js/TerrainBuilder";
import { BlockToolOptions } from "./js/components/BlockToolOptions";
import BlockToolsSidebar, {
    refreshBlockTools,
} from "./js/components/BlockToolsSidebar";
import GlobalLoadingScreen from "./js/components/GlobalLoadingScreen";
import QuickTips from './js/components/QuickTips';
import TextureGenerationModal from "./js/components/TextureGenerationModal";
import SelectionDimensionsTip from "./js/components/SelectionDimensionsTip";
import ToolBar from "./js/components/ToolBar";
import UnderConstruction from "./js/components/UnderConstruction";
import ProjectHome from "./js/components/ProjectHome";
import {
    blockTypes,
    getCustomBlocks,
    processCustomBlock,
    removeCustomBlock,
    updateCustomBlockName,
} from "./js/managers/BlockTypesManager";
import { DatabaseManager, STORES } from "./js/managers/DatabaseManager";
import { loadingManager } from "./js/managers/LoadingManager";
import UndoRedoManager from "./js/managers/UndoRedoManager";
import PhysicsManager from './js/physics/PhysicsManager';
import { detectGPU, getOptimalContextAttributes } from "./js/utils/GPUDetection";
import { updateChunkSystemCamera, processChunkRenderQueue, getChunkSystem } from "./js/chunks/TerrainBuilderIntegration";
import { createPlaceholderBlob, dataURLtoBlob } from "./js/utils/blobUtils";
import { isElectronRuntime } from './js/utils/env';
import { getHytopiaBlocks } from "./js/utils/minecraft/BlockMapper";

function App() {
    // Project state
    // Always start at Project Home; don't auto-open last project
    const [projectId, setProjectId] = useState<string | null>(null);
    useEffect(() => {
        console.log('[App] projectId effect', { projectId });
        if (projectId) {
            console.log('[App] setCurrentProjectId', { projectId });
            DatabaseManager.setCurrentProjectId(projectId);
        }
    }, [projectId]);
    const handleSwitchProject = async () => {
        try {
            const shouldSave = window.confirm("Switch projects? Save current project before switching?");
            if (shouldSave) {
                try {
                    if (terrainBuilderRef.current) {
                        await terrainBuilderRef.current.saveTerrainManually();
                        const url = await generateWorldThumbnail();
                        if (url) {
                            const pid = DatabaseManager.getCurrentProjectId();
                            await DatabaseManager.saveProjectThumbnail(pid, url);
                        }
                    }
                    if (environmentBuilderRef.current) {
                        await environmentBuilderRef.current.updateLocalStorage();
                    }
                } catch (_) { }
            }
        } finally {
            try { localStorage.removeItem("CURRENT_PROJECT_ID"); } catch (_) { }
            setProjectId(null);
            // Ensure DB manager does not keep stale project context
            try { DatabaseManager.setCurrentProjectId(null as any); } catch (_) { }
        }
    };
    const undoRedoManagerRef = useRef(null);
    const [currentBlockType, setCurrentBlockType] = useState(blockTypes[0]);
    const [mode, setMode] = useState("add");
    const [axisLockEnabled, setAxisLockEnabled] = useState(false);
    const [cameraReset, setCameraReset] = useState(false);
    const [placementSize, setPlacementSize] = useState("single");
    const [activeTab, setActiveTab] = useState("blocks");
    const [pageIsLoaded, setPageIsLoaded] = useState(false);
    const [scene, setScene] = useState(null);
    const [totalEnvironmentObjects, setTotalEnvironmentObjects] = useState(0);
    const [currentPreviewPosition, setCurrentPreviewPosition] = useState(null);
    const environmentBuilderRef = useRef(null);
    const terrainBuilderRef = useRef(null);
    const [placementSettings, setPlacementSettings] = useState({
        randomScale: false,
        randomRotation: false,
        minScale: 0.5,
        maxScale: 1.5,
        minRotation: 0,
        maxRotation: 360,
        scale: 1.0,
        rotation: 0,
        snapToGrid: true,
    });
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'complete'>('idle');
    const [isTextureModalOpen, setIsTextureModalOpen] = useState(false);
    const [isAIComponentsActive, setIsAIComponentsActive] = useState(false);
    const [showBlockSidebar, setShowBlockSidebar] = useState(true);
    const [showOptionsPanel, setShowOptionsPanel] = useState(true);
    const [showToolbar, setShowToolbar] = useState(true);
    const [isCompactMode, setIsCompactMode] = useState(true);
    const [showCrosshair, setShowCrosshair] = useState(cameraManager.isPointerLocked);
    const [cameraPosition, setCameraPosition] = useState(null);
    const [playerModeEnabled, setPlayerModeEnabled] = useState(false);
    const physicsRef = useRef<PhysicsManager | null>(null);
    const cameraAngle = 0;
    const gridSize = 5000;

    // Initialize GPU detection and optimized context attributes
    const gpuInfo = detectGPU();
    const contextAttributes = getOptimalContextAttributes(gpuInfo);

    useEffect(() => {
        if (terrainBuilderRef.current) {
            terrainBuilderRef.current.updateGridSize(gridSize);
        }
    }, [gridSize, terrainBuilderRef.current?.updateGridSize]);

    // Capture a thumbnail from a reset camera angle, then restore camera
    const generateWorldThumbnail = async (): Promise<string | null> => {
        try {
            const container = document.querySelector('.canvas-container') as HTMLElement | null;
            const canvas: any = (container && container.querySelector('canvas')) || null;
            if (!canvas || typeof canvas.toDataURL !== 'function') return null;
            const prev = cameraManager.getCameraState?.() || null;
            let prevJson: string | null = null;
            try { prevJson = prev ? JSON.stringify(prev) : null; } catch (_) { prevJson = null; }
            // Hide preview/highlight UI while capturing
            let oldPreviewVisible: boolean | undefined;
            try {
                const tb = terrainBuilderRef.current;
                if (tb && tb.previewPositionRef !== undefined) {
                    oldPreviewVisible = (window as any).__WE_PREVIEW_VISIBLE__;
                    (window as any).__WE_PREVIEW_VISIBLE__ = false;
                }
            } catch (_) { }
            try { cameraManager.resetCamera?.(); } catch (_) { }
            try {
                updateChunkSystemCamera((cameraManager as any).camera);
                console.info('[Thumb] Camera reset + bound for thumbnail', { hasContainer: !!container, foundCanvas: !!canvas });
            } catch (e) { console.warn('[Thumb] Failed to bind camera', e); }
            try { if (getChunkSystem()) { processChunkRenderQueue(); } } catch (e) { console.warn('[Thumb] Failed to process render queue', e); }
            await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
            const url = canvas.toDataURL('image/jpeg', 0.9);
            if (prevJson) {
                try {
                    localStorage.setItem('cameraState', prevJson);
                    cameraManager.loadSavedState?.();
                    cameraManager.saveState?.();
                } catch (_) { }
            }
            // Restore preview visibility
            try { (window as any).__WE_PREVIEW_VISIBLE__ = oldPreviewVisible; } catch (_) { }
            return url;
        } catch (_) { return null; }
    };

    // Load and apply saved skybox when page is loaded (one time only)
    useEffect(() => {
        if (!projectId || !pageIsLoaded) return;

        const loadSavedSkybox = async () => {
            // Add a small delay to ensure terrain builder is ready
            await new Promise(resolve => setTimeout(resolve, 1000));

            if (terrainBuilderRef.current?.changeSkybox) {
                try {
                    const savedSkybox = await DatabaseManager.getData(STORES.SETTINGS, `project:${DatabaseManager.getCurrentProjectId()}:selectedSkybox`);
                    if (typeof savedSkybox === 'string') {
                        console.log("Applying saved skybox on app startup:", savedSkybox);
                        terrainBuilderRef.current.changeSkybox(savedSkybox);
                    }
                    // Also apply saved lighting settings (ambient and directional)
                    try {
                        type LightSettings = { color?: string; intensity?: number };
                        const amb = (await DatabaseManager.getData(STORES.SETTINGS, `project:${DatabaseManager.getCurrentProjectId()}:ambientLight`)) as LightSettings | null;
                        if (amb && (typeof amb.color === 'string' || typeof amb.intensity === 'number') && terrainBuilderRef.current?.setAmbientLight) {
                            terrainBuilderRef.current.setAmbientLight({
                                color: typeof amb.color === 'string' ? amb.color : undefined,
                                intensity: typeof amb.intensity === 'number' ? amb.intensity : undefined,
                            });
                        }
                    } catch (e) {
                        // noop
                    }
                    try {
                        type LightSettings = { color?: string; intensity?: number };
                        const dir = (await DatabaseManager.getData(STORES.SETTINGS, `project:${DatabaseManager.getCurrentProjectId()}:directionalLight`)) as LightSettings | null;
                        if (dir && (typeof dir.color === 'string' || typeof dir.intensity === 'number') && terrainBuilderRef.current?.setDirectionalLight) {
                            terrainBuilderRef.current.setDirectionalLight({
                                color: typeof dir.color === 'string' ? dir.color : undefined,
                                intensity: typeof dir.intensity === 'number' ? dir.intensity : undefined,
                            });
                        }
                    } catch (e) {
                        // noop
                    }
                } catch (error) {
                    console.error("Error loading saved skybox:", error);
                }
            }
        };

        loadSavedSkybox();
    }, [pageIsLoaded, projectId]); // re-apply per-project

    useEffect(() => {
        if (!projectId) return; // Only load these once a project is open
        const loadAppSettings = async () => {
            try {
                const savedCompactMode = await DatabaseManager.getData(STORES.SETTINGS, "compactMode");
                if (savedCompactMode === false) {
                    setIsCompactMode(false);
                }

                const savedPointerLockMode = await DatabaseManager.getData(STORES.SETTINGS, "pointerLockMode");
                if (typeof savedPointerLockMode === "boolean") {
                    cameraManager.isPointerUnlockedMode = savedPointerLockMode;
                }

                const savedSensitivity = await DatabaseManager.getData(STORES.SETTINGS, "cameraSensitivity");
                if (typeof savedSensitivity === "number") {
                    cameraManager.setPointerSensitivity(savedSensitivity);
                }
            } catch (error) {
                console.error("Error loading app settings:", error);
            }

            const savedBlockId = localStorage.getItem("selectedBlock");
            if (savedBlockId) {
                const blockId = parseInt(savedBlockId);
                if (blockId < 200) {
                    const block = [...blockTypes, ...getCustomBlocks()].find(
                        (b) => b.id === blockId
                    );
                    if (block) {
                        setCurrentBlockType(block);
                        setActiveTab("blocks");
                    }
                } else {
                    if (environmentModels && environmentModels.length > 0) {
                        const envModel = environmentModels.find(
                            (m) => m.id === blockId
                        );
                        if (envModel) {
                            setCurrentBlockType({
                                ...envModel,
                                isEnvironment: true,
                            });
                            setActiveTab("models");
                        }
                    }
                }
            }
        };

        if (!pageIsLoaded && projectId) {
            loadingManager.showLoading();
        }

        if (pageIsLoaded) {
            loadAppSettings();
        }
    }, [pageIsLoaded, projectId]);

    // When switching projects or returning Home, reset flags/state and clear any global player-mode leftovers
    useEffect(() => {
        if (!projectId) {
            try { loadingManager.forceHideAll(); } catch (_) { }
            setPageIsLoaded(false);
            // Drop refs so new Canvas mounts cleanly next time
            try { (terrainBuilderRef as any).current = null; } catch (_) { }
            try { (environmentBuilderRef as any).current = null; } catch (_) { }
            // Clear physics/player globals when leaving project
            try { delete (window as any).__WE_PHYSICS__; } catch (_) { }
        } else {
            setPageIsLoaded(false);
            // Also clear tool/undo state to prevent stale bindings
            try { (undoRedoManagerRef as any).current = null; } catch (_) { }
            // Ensure orbit controls are enabled on entry; clear player-mode globals
            try {
                delete (window as any).__WE_PHYSICS__;
                delete (window as any).__WE_PLAYER_MESH__;
                delete (window as any).__WE_PLAYER_MIXER__;
                delete (window as any).__WE_PLAYER_ANIMS__;
                (window as any).__WE_CAM_KEYS__ = { left: false, right: false, up: false, down: false };
                cameraManager.setInputDisabled(false);
            } catch (_) { }
        }
    }, [projectId]);

    useEffect(() => {
        const handleKeyDown = async (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();

                setSaveStatus('saving');

                try {
                    if (terrainBuilderRef.current) {
                        await terrainBuilderRef.current.saveTerrainManually();
                        const url = await generateWorldThumbnail();
                        if (url) {
                            const pid = DatabaseManager.getCurrentProjectId();
                            await DatabaseManager.saveProjectThumbnail(pid, url);
                        }
                    }

                    if (environmentBuilderRef.current) {
                        await environmentBuilderRef.current.updateLocalStorage();
                    }
                } finally {
                    setSaveStatus('complete');
                    setTimeout(() => setSaveStatus('idle'), 2000);
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    useEffect(() => {
        const disableTabbing = (e) => {
            if (e.key === "Tab") {
                e.preventDefault();
            }
        };

        window.addEventListener("keydown", disableTabbing);

        return () => {
            window.removeEventListener("keydown", disableTabbing);
        };
    }, []);

    useEffect(() => {
        console.log("App: undoRedoManagerRef initialized");

        return () => {
            console.log(
                "App: component unmounting, undoRedoManagerRef:",
                undoRedoManagerRef.current
            );
        };
    }, []);

    useEffect(() => {
        if (undoRedoManagerRef.current) {
            console.log("App: undoRedoManagerRef.current updated:", {
                exists: !!undoRedoManagerRef.current,
                hasCurrentProp:
                    undoRedoManagerRef.current &&
                    "current" in undoRedoManagerRef.current,
                hasSaveUndo:
                    undoRedoManagerRef.current &&
                    typeof undoRedoManagerRef.current.saveUndo === "function",
                saveUndoType:
                    undoRedoManagerRef.current &&
                    typeof undoRedoManagerRef.current.saveUndo,
            });
        }
    }, [undoRedoManagerRef.current]);

    useEffect(() => {
        if (!projectId) return; // Only initialize when a project is open
        DatabaseManager.saveData(STORES.UNDO, "states", []);
        DatabaseManager.saveData(STORES.REDO, "states", []);
    }, [projectId]);

    useEffect(() => {
        // Poll pointer lock state to update crosshair visibility
        const crosshairInterval = setInterval(() => {
            setShowCrosshair(cameraManager.isPointerLocked);
        }, 100);
        return () => clearInterval(crosshairInterval);
    }, []);

    useEffect(() => {
        const shouldDefocus = (el: HTMLElement | null) => {
            if (!el) return false;
            const tag = el.tagName;
            if (tag === "BUTTON") return true;
            if (tag === "INPUT") {
                const input = el as HTMLInputElement;
                return input.type === "range" || input.type === "checkbox";
            }
            return false;
        };

        const defocusHandler = (e: Event) => {
            const target = e.target as HTMLElement | null;
            if (shouldDefocus(target)) {
                // Use a micro-delay so default click behaviour executes first
                setTimeout(() => target?.blur(), 0);
            }
        };

        window.addEventListener("click", defocusHandler, true);
        window.addEventListener("focusin", defocusHandler, true);

        return () => {
            window.removeEventListener("click", defocusHandler, true);
            window.removeEventListener("focusin", defocusHandler, true);
        };
    }, []);

    // Removed: TerrainBuilder ref call to setCurrentBlockType (not an imperative handle)
    // useEffect(() => {
    //     if (terrainBuilderRef.current)
    //         terrainBuilderRef.current.setCurrentBlockType(currentBlockType);
    // }, [currentBlockType]);

    // Initialize physics manager lazy when toggled on
    const ensurePhysics = () => {
        if (!physicsRef.current) {
            physicsRef.current = new PhysicsManager({ gravity: { x: 0, y: -32, z: 0 }, tickRate: 60 });
        }
        return physicsRef.current!;
    };

    useEffect(() => {
        if (!playerModeEnabled) {
            return;
        }
        const stateObj = (window as any).__WE_INPUT_STATE__ || { state: {} };
        (window as any).__WE_INPUT_STATE__ = stateObj;
        const allowed: Record<string, boolean> = { w: true, a: true, s: true, d: true, sp: true, sh: true, c: true };
        const mapKey = (e: KeyboardEvent): string | null => {
            const k = e.key.toLowerCase();
            if (k === ' ') return 'sp';
            if (k === 'shift') return 'sh';
            if (k === 'w' || k === 'a' || k === 's' || k === 'd' || k === 'c') return k;
            return null;
        };
        const onKeyDown = (e: KeyboardEvent) => {
            const k = mapKey(e);
            if (!k || !allowed[k]) return;
            stateObj.state[k] = true;
        };
        const onKeyUp = (e: KeyboardEvent) => {
            const k = mapKey(e);
            if (!k || !allowed[k]) return;
            stateObj.state[k] = false;
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, [playerModeEnabled]);

    const togglePlayerMode = () => {
        const next = !playerModeEnabled;
        setPlayerModeEnabled(next);
        try {
            cameraManager.setInputDisabled(next);
        } catch (_) { }
        if (next) {
            const physics = ensurePhysics();
            (window as any).__WE_PHYSICS__ = physics;
            (window as any).__WE_INPUT_STATE__ = (window as any).__WE_INPUT_STATE__ || { state: {} };
            // Initialize player-mode camera globals so first entry works without an arrow key press
            (window as any).__WE_CAM_KEYS__ = (window as any).__WE_CAM_KEYS__ || { left: false, right: false, up: false, down: false };
            (window as any).__WE_CAM_OFFSET_RADIUS__ = (window as any).__WE_CAM_OFFSET_RADIUS__ ?? 8.0;
            (window as any).__WE_CAM_OFFSET_HEIGHT__ = (window as any).__WE_CAM_OFFSET_HEIGHT__ ?? 3.0;
            // Let TerrainBuilder compute yaw from camera on first animate tick; provide fallback here
            (window as any).__WE_CAM_OFFSET_YAW__ = (window as any).__WE_CAM_OFFSET_YAW__ ?? (cameraManager.camera?.rotation?.y || 0);
            // No pointer lock
            physics.ready().then(() => {
                physics.addFlatGround(4000, -0.5);
                const pos = cameraPosition ?? { x: 0, y: 10, z: 0 } as any;
                physics.createOrResetPlayer(new Vector3(pos.x ?? 0, pos.y ?? 10, pos.z ?? 0));
            });
        } else {
            try { delete (window as any).__WE_PHYSICS__; } catch (_) { }
            // Despawn player glTF
            try {
                const scene: any = (window as any).__WE_SCENE__;
                const mesh: any = (window as any).__WE_PLAYER_MESH__;
                if (scene && mesh) { scene.remove(mesh); }
                (window as any).__WE_PLAYER_MESH__ = undefined;
                (window as any).__WE_PLAYER_MIXER__ = undefined;
                (window as any).__WE_PLAYER_ANIMS__ = undefined;
                (window as any).__WE_PLAYER_ACTIVE__ = undefined;
            } catch (_) { }
            // No pointer lock exit
        }
    };

    const handleToggleCompactMode = async () => {
        const newCompactValue = !isCompactMode;
        setIsCompactMode(newCompactValue);
        try {
            await DatabaseManager.saveData(STORES.SETTINGS, "compactMode", newCompactValue);
            console.log("Compact mode setting saved:", newCompactValue);
        } catch (error) {
            console.error("Error saving compact mode setting:", error);
        }
    };

    const LoadingScreen = () => (
        <div className="loading-screen">
            <img
                src={"assets/img/hytopia_logo_white.png"}
                alt="Hytopia Logo"
                className="loading-logo"
            />
            <div className="loading-spinner"></div>
            <div className="loading-text">
                <i>Loading...</i>
            </div>
            <div className="version-text">HYTOPIA Map Builder v{version}</div>
        </div>
    );

    const handleTextureReady = async (faceTextures, textureName) => {
        console.log(
            "Texture ready:",
            textureName,
            "Face Count:",
            Object.keys(faceTextures).length
        );
        try {
            const faceMap = {
                top: "+y",
                bottom: "-y",
                left: "-x",
                right: "+x",
                front: "+z",
                back: "-z",
            };

            const newBlockData = {
                name:
                    textureName
                        .replace(/[^a-zA-Z0-9_\-\s]/g, "")
                        .replace(/\s+/g, "_") || "custom_texture",
                textureUri: faceTextures.all || faceTextures.top || null,
                sideTextures: {},
                isCustom: true,
                isMultiTexture: false,
            };

            let hasSpecificFaces = false;
            for (const face in faceTextures) {
                if (face !== "all" && faceTextures[face] && faceMap[face]) {
                    const coordinateKey = faceMap[face];
                    newBlockData.sideTextures[coordinateKey] =
                        faceTextures[face];
                    hasSpecificFaces = true;
                }
            }

            if (!hasSpecificFaces && faceTextures.all) {
                newBlockData.sideTextures["+y"] = faceTextures.all;
            } else if (
                hasSpecificFaces &&
                !newBlockData.sideTextures["+y"] &&
                newBlockData.textureUri
            ) {
                newBlockData.sideTextures["+y"] = newBlockData.textureUri;
            }

            newBlockData.isMultiTexture = hasSpecificFaces;

            if (!newBlockData.textureUri && hasSpecificFaces) {
                newBlockData.textureUri = newBlockData.sideTextures["+y"];
            }

            console.log("Processing block data:", newBlockData);

            await processCustomBlock(newBlockData);
            console.log("Custom block processed:", newBlockData.name);

            try {
                const updatedCustomBlocks = getCustomBlocks();
                await DatabaseManager.saveData(
                    STORES.CUSTOM_BLOCKS,
                    "blocks",
                    updatedCustomBlocks
                );
                console.log(
                    "[App] Saved updated custom blocks to DB after texture generation."
                );
            } catch (dbError) {
                console.error(
                    "[App] Error saving custom blocks after texture generation:",
                    dbError
                );
            }

            refreshBlockTools();
        } catch (error) {
            console.error("Error processing generated texture:", error);
        }
    };

    const handleGetAvailableBlocks = useCallback(() => {
        try {
            return getHytopiaBlocks();
        } catch (error) {
            console.error("Error getting Hytopia blocks:", error);
            return [];
        }
    }, []);

    const handleGetAvailableEntities = useCallback(() => {
        try {
            return environmentModels.map(model => ({
                name: model.name,
                displayName: model.name
                    .split("-")
                    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
                    .join(" "),
                modelUrl: model.modelUrl
            }));
        } catch (error) {
            console.error("Error getting available entities:", error);
            return [];
        }
    }, []);

    const handleLoadAISchematic = useCallback((schematic) => {
        console.log("App: Loading AI schematic and activating tool", schematic);
        terrainBuilderRef.current?.activateTool("schematic", schematic);
    }, []);

    const handleUpdateBlockName = async (blockId: number, newName: string) => {
        console.log(`App: Updating block ${blockId} name to ${newName}`);
        try {
            const success = await updateCustomBlockName(blockId, newName);
            if (!success) {
                throw new Error("BlockTypesManager failed to update name.");
            }
            const updatedBlocks = getCustomBlocks();
            await DatabaseManager.saveData(STORES.CUSTOM_BLOCKS, 'blocks', updatedBlocks);

            if (currentBlockType?.id === blockId) {
                setCurrentBlockType(prev => ({ ...prev, name: newName }));
            }
            refreshBlockTools();
            console.log(`App: Block ${blockId} renamed successfully.`);
        } catch (error) {
            console.error("App: Error updating block name:", error);
            alert(`Failed to rename block: ${error.message || "Unknown error"}`);
            throw error;
        }
    };

    const handleDownloadBlock = async (blockType: any) => {
        if (!blockType) return;
        console.log("App: Downloading block:", blockType.name);
        const zip = new JSZip();
        const faceKeys = ["+x", "-x", "+y", "-y", "+z", "-z"];
        const textures = blockType.sideTextures || {};
        const mainTexture = blockType.textureUri;
        let hasError = false;

        for (const key of faceKeys) {
            const dataUrl = textures[key] || mainTexture;
            let blob: Blob | null = null;

            if (dataUrl && dataUrl.startsWith('data:image')) {
                blob = dataURLtoBlob(dataUrl);
            } else if (dataUrl && (dataUrl.startsWith('./') || dataUrl.startsWith('/'))) {
                try {
                    const response = await fetch(dataUrl);
                    if (response.ok) {
                        blob = await response.blob();
                    } else {
                        console.warn(`Failed to fetch texture ${key} from path ${dataUrl}, status: ${response.status}`);
                    }
                } catch (fetchError) {
                    console.error(`Error fetching texture from ${dataUrl}:`, fetchError);
                }
            }

            if (!blob) {
                console.warn(`Missing texture ${key} for ${blockType.name}, using placeholder.`);
                try {
                    blob = await createPlaceholderBlob();
                    if (!blob) {
                        console.error(`Placeholder failed for ${key}, skipping.`);
                        hasError = true; continue;
                    }
                } catch (placeholderError) {
                    console.error(`Error creating placeholder for ${key}:`, placeholderError);
                    hasError = true; continue;
                }
            }
            const fileName = `${key}.png`;
            zip.file(fileName, blob);
        }
        if (hasError) alert("Warning: Some textures missing/invalid; placeholders used or skipped. Check console.");
        try {
            const zipBlob = await zip.generateAsync({ type: "blob" });
            saveAs(zipBlob, `${blockType.name}.zip`);
            console.log(`App: Downloaded ${blockType.name}.zip`);
        } catch (err) {
            console.error("App: Error saving zip:", err);
            alert("Failed to save zip. See console.");
        }
    };

    const handleDeleteBlock = async (blockType: any) => {
        if (!blockType || !blockType.isCustom) return;
        const confirmMessage = `Deleting "${blockType.name}" (ID: ${blockType.id}) cannot be undone. Instances of this block in the world will be lost. Are you sure?`;
        if (window.confirm(confirmMessage)) {
            console.log("App: Deleting block:", blockType.name);
            try {
                removeCustomBlock(blockType.id);
                const updatedBlocks = getCustomBlocks();
                await DatabaseManager.saveData(STORES.CUSTOM_BLOCKS, 'blocks', updatedBlocks);
                console.log("App: Updated custom blocks in DB after deletion.");
                const errorId = 0;
                const currentTerrain = await DatabaseManager.getData(STORES.TERRAIN, "current") || {};
                let blocksReplaced = 0;
                const newTerrain = Object.entries(currentTerrain).reduce((acc, [pos, id]) => {
                    if (id === blockType.id) {
                        acc[pos] = errorId; blocksReplaced++;
                    } else {
                        acc[pos] = id;
                    }
                    return acc;
                }, {});
                if (blocksReplaced > 0) {
                    console.log(`App: Replacing ${blocksReplaced} instances of deleted block ${blockType.id} with ID ${errorId}.`);
                    await DatabaseManager.saveData(STORES.TERRAIN, "current", newTerrain);
                    terrainBuilderRef.current?.buildUpdateTerrain();
                    console.log("App: Triggered terrain update.");
                } else {
                    console.log("App: No instances found.");
                }
                refreshBlockTools();
                if (currentBlockType?.id === blockType.id) {
                    console.log("App: Resetting selected block type.");
                    setCurrentBlockType(blockTypes[0]);
                    setActiveTab('blocks');
                    localStorage.setItem("selectedBlock", blockTypes[0].id.toString());
                }
                console.log(`App: Block ${blockType.name} deleted.`);
            } catch (error) {
                console.error("App: Error deleting block:", error);
                alert(`Failed to delete block: ${error.message}`);
            }
        }
    };

    return (
        <Provider theme={defaultTheme}>
            <div className="App">
                {!projectId && (
                    <ProjectHome onOpen={(id) => { try { DatabaseManager.setCurrentProjectId(id); } catch (_) { } setProjectId(id); }} />
                )}
                {IS_UNDER_CONSTRUCTION && <UnderConstruction />}

                {projectId && !pageIsLoaded && <LoadingScreen />}

                <GlobalLoadingScreen />

                {/* Live selection dimensions tip */}
                <SelectionDimensionsTip />

                {/* Show QuickTips only on web (not Electron) and after initial load */}
                {!isElectronRuntime() && pageIsLoaded && <QuickTips />}

                {projectId && (
                    <UndoRedoManager
                        ref={undoRedoManagerRef}
                        terrainBuilderRef={terrainBuilderRef}
                        environmentBuilderRef={environmentBuilderRef}
                    />
                )}

                {projectId && showBlockSidebar && (
                    <BlockToolsSidebar
                        isCompactMode={isCompactMode}
                        onOpenTextureModal={() => setIsTextureModalOpen(true)}
                        terrainBuilderRef={terrainBuilderRef}
                        activeTab={activeTab}
                        onLoadSchematicFromHistory={handleLoadAISchematic}
                        setActiveTab={setActiveTab}
                        setCurrentBlockType={setCurrentBlockType}
                        environmentBuilder={environmentBuilderRef.current}
                        onPlacementSettingsChange={setPlacementSettings}
                        setPlacementSize={setPlacementSize}
                    />
                )}

                {projectId && showOptionsPanel && (
                    <BlockToolOptions
                        totalEnvironmentObjects={totalEnvironmentObjects}
                        terrainBuilderRef={terrainBuilderRef}
                        onResetCamera={() => setCameraReset(prev => !prev)}
                        onToggleSidebar={() => setShowBlockSidebar(prev => !prev)}
                        onToggleOptions={() => setShowOptionsPanel(prev => !prev)}
                        onToggleToolbar={() => setShowToolbar(prev => !prev)}
                        activeTab={activeTab}
                        selectedBlock={currentBlockType}
                        onUpdateBlockName={handleUpdateBlockName}
                        onDownloadBlock={handleDownloadBlock}
                        onDeleteBlock={handleDeleteBlock}
                        placementSettings={placementSettings}
                        onPlacementSettingsChange={setPlacementSettings}
                        isCompactMode={isCompactMode}
                        onToggleCompactMode={handleToggleCompactMode}
                        showAIComponents={isAIComponentsActive}
                        getAvailableBlocks={handleGetAvailableBlocks}
                        getAvailableEntities={handleGetAvailableEntities}
                        loadAISchematic={handleLoadAISchematic}
                    />
                )}

                {projectId && (
                    <TextureGenerationModal
                        isOpen={isTextureModalOpen}
                        onClose={() => setIsTextureModalOpen(false)}
                        onTextureReady={handleTextureReady}
                    />
                )}

                {projectId && <div className="vignette-gradient"></div>}

                {projectId && saveStatus !== 'idle' && (
                    <div
                        style={{
                            position: "fixed",
                            bottom: "80px",
                            left: "50%",
                            transform: "translateX(-50%)",
                            backgroundColor: "rgba(0, 0, 0, 0.8)",
                            color: "white",
                            padding: "8px 16px",
                            borderRadius: "4px",
                            zIndex: 9999,
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            boxShadow: "0 2px 10px rgba(0, 0, 0, 0.3)",
                            fontFamily: "Arial, sans-serif",
                            fontSize: "14px",
                            fontWeight: "bold",
                            pointerEvents: "none",
                        }}
                    >
                        {saveStatus === 'saving' ? (
                            <>
                                <div
                                    style={{
                                        width: "16px",
                                        height: "16px",
                                        borderRadius: "50%",
                                        border: "3px solid rgba(255, 255, 255, 0.3)",
                                        borderTopColor: "white",
                                        animation: "spin 1s linear infinite",
                                    }}
                                />
                                Saving...
                            </>
                        ) : (
                            <>
                                <div
                                    style={{
                                        width: "16px",
                                        height: "16px",
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}
                                >
                                    ✓
                                </div>
                                Save complete!
                            </>
                        )}
                    </div>
                )}

                {projectId && (
                    <Canvas
                        key={projectId}
                        shadows
                        className="canvas-container"
                        gl={contextAttributes}
                        camera={{ fov: 75, near: 0.1, far: 1000 }}
                    >
                        <TerrainBuilder
                            key={`tb-${projectId}`}
                            isInputDisabled={isTextureModalOpen}
                            ref={terrainBuilderRef}
                            currentBlockType={currentBlockType}
                            setCurrentBlockType={setCurrentBlockType}
                            mode={mode}
                            axisLockEnabled={axisLockEnabled}
                            placementSize={placementSize}
                            cameraReset={cameraReset}
                            cameraAngle={cameraAngle}
                            setPageIsLoaded={setPageIsLoaded}
                            onSceneReady={(sceneObject) => { console.log('[App] onSceneReady'); setScene(sceneObject); }}
                            gridSize={gridSize}
                            environmentBuilderRef={environmentBuilderRef}
                            previewPositionToAppJS={setCurrentPreviewPosition}
                            undoRedoManager={undoRedoManagerRef}
                            customBlocks={getCustomBlocks()}
                            snapToGrid={placementSettings.snapToGrid}
                            onCameraPositionChange={setCameraPosition}
                        />
                        <EnvironmentBuilder
                            key={`eb-${projectId}`}
                            ref={environmentBuilderRef}
                            scene={scene}
                            projectId={projectId}
                            currentBlockType={currentBlockType}
                            onTotalObjectsChange={setTotalEnvironmentObjects}
                            placementSize={placementSize}
                            previewPositionFromAppJS={currentPreviewPosition}
                            placementSettings={placementSettings}
                            onPlacementSettingsChange={setPlacementSettings}
                            undoRedoManager={undoRedoManagerRef}
                            terrainBuilderRef={terrainBuilderRef}
                            cameraPosition={cameraPosition}
                        />
                    </Canvas>
                )}

                {/* Desktop app CTA removed in favor of QuickTips when on web */}

                {projectId && showToolbar && (
                    <ToolBar
                        terrainBuilderRef={terrainBuilderRef}
                        environmentBuilderRef={environmentBuilderRef}
                        mode={mode}
                        handleModeChange={setMode}
                        axisLockEnabled={axisLockEnabled}
                        setAxisLockEnabled={setAxisLockEnabled}
                        placementSize={placementSize}
                        setPlacementSize={setPlacementSize}
                        undoRedoManager={undoRedoManagerRef}
                        currentBlockType={currentBlockType}
                        onOpenTextureModal={() => setIsTextureModalOpen(true)}
                        toggleAIComponents={() => setIsAIComponentsActive((v) => !v)}
                        isAIComponentsActive={isAIComponentsActive}
                        setIsSaving={setSaveStatus}
                        activeTab={activeTab}
                        playerModeEnabled={playerModeEnabled}
                        onTogglePlayerMode={togglePlayerMode}
                        onSwitchProject={handleSwitchProject}
                    />
                )}

                {/* Crosshair visible while pointer is locked */}
                {projectId && showCrosshair && !cameraManager.isPointerUnlockedMode && (
                    <div
                        style={{
                            position: "fixed",
                            top: "50%",
                            left: "50%",
                            transform: "translate(-50%, -50%)",
                            width: "20px",
                            height: "20px",
                            pointerEvents: "none",
                            zIndex: 10000,
                        }}
                    >
                        <div
                            style={{
                                position: "absolute",
                                left: "50%",
                                top: "0",
                                width: "2px",
                                height: "100%",
                                background: "#ffffff",
                                transform: "translateX(-50%)",
                            }}
                        />
                        <div
                            style={{
                                position: "absolute",
                                top: "50%",
                                left: "0",
                                width: "100%",
                                height: "2px",
                                background: "#ffffff",
                                transform: "translateY(-50%)",
                            }}
                        />
                    </div>
                )}

                {/* <button
                    className="toolbar-button"
                    onClick={async () => await DatabaseManager.clearDatabase()}
                    title="Clear Database"
                    style={{
                        position: "absolute",
                        bottom: "10px",
                        left: "10px",
                    }}
                >
                    <FaDatabase />
                </button> */}
            </div>
        </Provider>
    );
}

export default App;
