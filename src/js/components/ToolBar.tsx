import { useEffect, useMemo, useRef, useState } from "react";
import {
    FaCamera,
    FaCloud,
    FaCubes,
    FaDrawPolygon,
    FaExchangeAlt,
    FaMinus,
    FaMountain,
    FaMousePointer,
    FaPlus,
    FaRedo,
    FaRobot,
    FaSave,
    FaSquare,
    FaThLarge,
    FaTrash,
    FaUndo,
    FaWrench,
    FaHome,
    FaArrowUp,
    FaBorderAll
} from "react-icons/fa";
import pako from "pako";
import "../../css/ToolBar.css";
import { DISABLE_ASSET_PACK_IMPORT_EXPORT } from "../Constants";
import { exportMapFile, importMap, ExportOptions, defaultExportOptions } from "../ImportExport";
import ModalContainer from "./ModalContainer";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";
import Tooltip from "./Tooltip";
import { getBlockTypes } from "../managers/BlockTypesManager";
import "../../css/AxiomBlockRemapper.css";
import { AxiomBlockRemapper } from "./AxiomBlockRemapper.jsx";
import { getRotationLabel } from "../blocks/BlockRotations";
import { NBTParser } from "../utils/minecraft/NBTParser";
import {
    suggestMapping,
    DEFAULT_BLOCK_MAPPINGS,
} from "../utils/minecraft/BlockMapper";

// Enum to track which submenu is currently open
enum SubMenuType {
    NONE = 'none',
    PLACEMENT = 'placement',
    SWAP = 'swap',
    AI = 'ai',
    UTILS = 'utils',
    IMPORT_EXPORT = 'import_export'
}

const ToolBar = ({
    terrainBuilderRef,
    mode,
    handleModeChange,
    axisLockEnabled,
    setAxisLockEnabled,
    placementSize,
    setPlacementSize,
    undoRedoManager,
    currentBlockType,
    environmentBuilderRef,
    setIsSaving,
    onOpenTextureModal,
    toggleAIComponents,
    isAIComponentsActive,
    activeTab,
    playerModeEnabled,
    onTogglePlayerMode,
    onSwitchProject,
    onTakeScreenshot,
}: any) => {
    const [showDimensionsModal, setShowDimensionsModal] = useState(false);
    // Replace individual submenu state variables with a single enum-based state
    const [activeSubmenu, setActiveSubmenu] = useState<SubMenuType>(SubMenuType.NONE);
    const [dimensions, setDimensions] = useState({
        width: 1,
        length: 1,
        height: 1,
    });
    const [showBorderModal, setShowBorderModal] = useState(false);
    const [borderDimensions, setBorderDimensions] = useState({
        width: 1,
        length: 1,
        height: 1,
    });
    const [showTerrainModal, setShowTerrainModal] = useState(false);
    const [terrainSettings, setTerrainSettings] = useState({
        width: 32,
        length: 32,
        height: 16,
        scale: 1,
        roughness: 85,
        clearMap: false,
    });

    const [canUndo, setCanUndo] = useState(true);
    const [canRedo, setCanRedo] = useState(false);

    const [activeTool, setActiveTool] = useState(null);

    const [waitingForMouseCycle, setWaitingForMouseCycle] = useState(false);

    // Axiom Blueprint converter state
    const [showBlockRemapper, setShowBlockRemapper] = useState(false);
    const [pendingBpImport, setPendingBpImport] = useState<any>(null);
    const [unmappedBlocks, setUnmappedBlocks] = useState<string[]>([]);
    const [blockCounts, setBlockCounts] = useState<Record<string, number>>({});
    const bpFileInputRef = useRef<HTMLInputElement>(null);

    const [showGlobalRemapModal, setShowGlobalRemapModal] = useState(false);
    const [usedBlockCounts, setUsedBlockCounts] = useState<Record<number, number>>({});
    const [globalRemapTargets, setGlobalRemapTargets] = useState<Record<number, number | null>>({});
    const [openSelectorFor, setOpenSelectorFor] = useState<number | null>(null);
    const [remapSearchTerms, setRemapSearchTerms] = useState<Record<number, string>>({});

    // Tab state for the remap modal
    const [remapTab, setRemapTab] = useState<'blocks' | 'entities'>('blocks');

    // Entity remap state
    const [usedEntityCounts, setUsedEntityCounts] = useState<Record<string, number>>({});
    const [entityRemapTargets, setEntityRemapTargets] = useState<Record<string, string | null>>({});
    const [openEntitySelectorFor, setOpenEntitySelectorFor] = useState<string | null>(null);
    const [entitySearchTerms, setEntitySearchTerms] = useState<Record<string, string>>({});

    // Breakdown by shape toggle state
    const [breakdownByShape, setBreakdownByShape] = useState(false);
    const [breakdownRemapTargets, setBreakdownRemapTargets] = useState<Record<string, number | null>>({});

    // Precomputed rotation/shape info for the current terrain
    const [blockRotationInfo, setBlockRotationInfo] = useState<Record<number, Set<number>>>({});
    const [blockShapeInfo, setBlockShapeInfo] = useState<Record<number, Set<string>>>({});

    // Precomputed combo data: unique (blockId, rotation, shape) combinations with counts
    const [blockComboData, setBlockComboData] = useState<Array<{
        blockId: number;
        rotation: number;
        shape: string;
        count: number;
        comboKey: string;
    }>>([]);

    // Remove Hidden Blocks modal state
    const [showRemoveHiddenModal, setShowRemoveHiddenModal] = useState(false);
    const [removeHiddenOptions, setRemoveHiddenOptions] = useState({
        includeLiquids: false,
        preserveNextToTransparent: false,
        preserveNextToLiquids: false,
    });

    // Export options modal state
    const [showExportModal, setShowExportModal] = useState(false);
    const [exportOptions, setExportOptions] = useState<ExportOptions>({
        ...defaultExportOptions
    });

    const availableBlocks = useMemo(() => {
        try {
            return getBlockTypes() || [];
        } catch (_) {
            return [] as any[];
        }
    }, []);
    let startPos = {
        x: 0,
        y: 0,
        z: 0,
    };

    // Helper for picking a representative texture for a block
    const pickBlockTexture = (block: any) => {
        if (!block) return "./assets/blocks/error.png";
        const st = (block.sideTextures || {}) as Record<string, string>;
        const candidates = [
            st["+y"],
            st["-y"],
            st["+x"],
            st["-x"],
            st["+z"],
            st["-z"],
            (block as any).textureUri,
        ].filter(Boolean) as string[];
        return candidates.length > 0 ? candidates[0] : "./assets/blocks/error.png";
    };

    const openGlobalRemap = () => {
        try {
            // --- Block data ---
            const data = terrainBuilderRef?.current?.getCurrentTerrainData?.();
            const counts: Record<number, number> = {};
            if (data) {
                Object.values(data).forEach((id: any) => {
                    if (typeof id === "number") {
                        counts[id] = (counts[id] || 0) + 1;
                    }
                });
            }
            const initialTargets: Record<number, number | null> = {};
            Object.keys(counts).forEach((idStr) => {
                const id = parseInt(idStr);
                initialTargets[id] = id;
            });
            setUsedBlockCounts(counts);
            setGlobalRemapTargets(initialTargets);
            setOpenSelectorFor(null);
            setRemapSearchTerms({});

            // --- Rotation/shape info per block type ---
            const rotInfo: Record<number, Set<number>> = {};
            const shpInfo: Record<number, Set<string>> = {};
            if (data) {
                const rotData = terrainBuilderRef?.current?.getCurrentRotationData?.() || {};
                const shpData = terrainBuilderRef?.current?.getCurrentShapeData?.() || {};
                for (const [posKey, id] of Object.entries(data as Record<string, number>)) {
                    const blockId = id as number;
                    if (!rotInfo[blockId]) rotInfo[blockId] = new Set();
                    if (!shpInfo[blockId]) shpInfo[blockId] = new Set();
                    const rot = rotData[posKey] || 0;
                    const shp = shpData[posKey] || 'cube';
                    rotInfo[blockId].add(rot);
                    shpInfo[blockId].add(shp);
                }
            }
            setBlockRotationInfo(rotInfo);
            setBlockShapeInfo(shpInfo);
            setBreakdownByShape(false);
            setBreakdownRemapTargets({});

            // Compute combo data: unique (blockId, rotation, shape) combinations with counts
            const comboCounts: Record<string, { blockId: number; rotation: number; shape: string; count: number }> = {};
            if (data) {
                const rotData2 = terrainBuilderRef?.current?.getCurrentRotationData?.() || {};
                const shpData2 = terrainBuilderRef?.current?.getCurrentShapeData?.() || {};
                for (const [posKey, id] of Object.entries(data as Record<string, number>)) {
                    const blockId = id as number;
                    const rot = rotData2[posKey] || 0;
                    const shp = shpData2[posKey] || 'cube';
                    const key = `${blockId}:${rot}:${shp}`;
                    if (!comboCounts[key]) {
                        comboCounts[key] = { blockId, rotation: rot, shape: shp, count: 0 };
                    }
                    comboCounts[key].count++;
                }
            }
            const comboArray = Object.entries(comboCounts).map(([comboKey, data]) => ({
                ...data,
                comboKey,
            }));
            comboArray.sort((a, b) => b.count - a.count);
            setBlockComboData(comboArray);

            // --- Entity data ---
            const entityCounts: Record<string, number> = {};
            try {
                const allEntities = environmentBuilderRef?.current?.getAllEnvironmentObjects?.() || [];
                for (const ent of allEntities) {
                    if (ent.modelUrl) {
                        entityCounts[ent.modelUrl] = (entityCounts[ent.modelUrl] || 0) + 1;
                    }
                }
            } catch (_) { }
            const initialEntityTargets: Record<string, string | null> = {};
            Object.keys(entityCounts).forEach((url) => {
                initialEntityTargets[url] = url;
            });
            setUsedEntityCounts(entityCounts);
            setEntityRemapTargets(initialEntityTargets);
            setOpenEntitySelectorFor(null);
            setEntitySearchTerms({});

            // --- Reset tab ---
            setRemapTab('blocks');
            setShowGlobalRemapModal(true);
            setActiveSubmenu(SubMenuType.NONE);
        } catch (e) {
            console.error("Error preparing global remap modal:", e);
            alert("Failed to prepare global remap. Check console for details.");
        }
    };

    const getFilteredBlocksFor = (srcId: number) => {
        const term = (remapSearchTerms[srcId] || "").toLowerCase();
        const base = (availableBlocks as any[]).filter((b: any) => !b.isVariant);
        if (!term) return base;
        return base.filter((b: any) => (b.name || "").toLowerCase().includes(term));
    };

    // Helper: display-friendly name from modelUrl
    const entityDisplayName = (modelUrl: string) => {
        try {
            const parts = modelUrl.split('/');
            const filename = parts[parts.length - 1];
            return filename.replace(/\.(gltf|glb)$/i, '').replace(/[-_]/g, ' ');
        } catch (_) {
            return modelUrl;
        }
    };

    // Helper: resolve entity thumbnail path (same logic as EntityBrowser/EnvironmentButton)
    const resolveEntityThumbnail = (thumbnailUrl: string | null | undefined): string | null => {
        if (!thumbnailUrl) return null;
        if (thumbnailUrl.startsWith("http") || thumbnailUrl.startsWith("https") || thumbnailUrl.startsWith("blob:")) return thumbnailUrl;
        if (thumbnailUrl.startsWith("assets/")) {
            const cleanPath = thumbnailUrl.replace(/^\/+/, "");
            return `${process.env.PUBLIC_URL || ""}/${cleanPath}`.replace(/\/+/g, "/").replace(/^\/\//, "/");
        }
        return thumbnailUrl;
    };

    // Helper: look up thumbnail for a modelUrl from available models
    const getEntityThumbnailForUrl = (modelUrl: string): string | null => {
        const models = getAvailableEntityModels();
        const match = models.find((m: any) => m.modelUrl === modelUrl);
        return resolveEntityThumbnail(match?.thumbnailUrl);
    };

    // Helper: get all available entity models for the entity selector
    const getAvailableEntityModels = () => {
        try {
            return environmentBuilderRef?.current?.getAllAvailableModels?.() || [];
        } catch (_) {
            return [];
        }
    };

    // Helper: filter entity models by search term
    const getFilteredEntitiesFor = (srcUrl: string) => {
        const term = (entitySearchTerms[srcUrl] || "").toLowerCase();
        const models = getAvailableEntityModels();
        if (!term) return models;
        return models.filter((m: any) => {
            const name = (m.displayName || m.name || entityDisplayName(m.modelUrl) || "").toLowerCase();
            return name.includes(term);
        });
    };

    // Helper: get shape display name
    const getShapeDisplayName = (shape: string) => {
        const names: Record<string, string> = {
            'cube': 'Cube',
            'half_slab': 'Half Slab',
            'wedge_45': 'Wedge 45\u00B0',
            'stairs_2': '2-Step Stairs',
            'stairs_3': '3-Step Stairs',
            'quarter': 'Quarter',
            'fence_post': 'Fence Post',
            'cross': 'Cross',
            'fence_1h': 'Fence 1H',
            'fence_2h': 'Fence 2H',
            'outer_corner_stairs_2': 'Outer Corner Stairs 2',
            'outer_corner_stairs_3': 'Outer Corner Stairs 3',
        };
        return names[shape] || shape;
    };

    // Helper: get filtered blocks for breakdown selector
    const getFilteredBlocksForCombo = (comboKey: string) => {
        const term = (remapSearchTerms[comboKey as any] || "").toLowerCase();
        const base = (availableBlocks as any[]).filter((b: any) => !b.isVariant);
        if (!term) return base;
        return base.filter((b: any) => (b.name || "").toLowerCase().includes(term));
    };

    // Helper function to toggle submenus - closes current if same, opens new one if different
    const toggleSubmenu = (submenuType: SubMenuType) => {
        if (activeSubmenu === submenuType) {
            setActiveSubmenu(SubMenuType.NONE);
        } else {
            setActiveSubmenu(submenuType);
        }
    };

    const handleGenerateBlocks = () => {
        if (currentBlockType.id > 199) {
            alert(
                "Not Compatible with Environment Objects... \n\nPlease select a block and try again!"
            );
            return;
        }
        const { width, length, height } = dimensions;

        if (width <= 0 || length <= 0 || height <= 0) {
            alert("Dimensions must be greater than 0");
            return;
        }
        console.log("Generating blocks with dimensions:", {
            width,
            length,
            height,
        });
        console.log("Current block type:", currentBlockType);

        const terrainData = terrainBuilderRef.current.getCurrentTerrainData();
        console.log(
            "Initial terrain data count:",
            Object.keys(terrainData).length
        );

        let blocksAdded = 0;
        startPos = {
            x: -width / 2,
            y: 0,
            z: -length / 2,
        };
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                for (let z = 0; z < length; z++) {
                    const position = {
                        x: startPos.x + x,
                        y: startPos.y + y,
                        z: startPos.z + z,
                    };

                    const key = `${position.x},${position.y},${position.z}`;
                    terrainData[key] = currentBlockType.id;
                    blocksAdded++;
                }
            }
        }
        console.log(`Added ${blocksAdded} blocks to terrain data`);
        console.log(
            "Final terrain data count:",
            Object.keys(terrainData).length
        );

        if (terrainBuilderRef.current) {
            terrainBuilderRef.current.updateTerrainFromToolBar(terrainData);
        } else {
            console.error("terrainBuilderRef.current is null or undefined");
        }
        setShowDimensionsModal(false);
    };
    const handleGenerateBorder = () => {
        if (currentBlockType.id > 199) {
            alert(
                "Not Compatible with Environment Objects... \n\nPlease select a block and try again!"
            );
            return;
        }
        const { width, length, height } = borderDimensions;

        if (width <= 0 || length <= 0 || height <= 0) {
            alert("Border dimensions must be greater than 0");
            return;
        }
        startPos = {
            x: -width / 2,
            y: 0,
            z: -length / 2,
        };

        const terrainData = terrainBuilderRef.current.getCurrentTerrainData();

        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                for (let z = 0; z < length; z++) {
                    if (
                        x === 0 ||
                        x === width - 1 ||
                        z === 0 ||
                        z === length - 1
                    ) {
                        const position = {
                            x: startPos.x + x,
                            y: startPos.y + y,
                            z: startPos.z + z,
                        };
                        const key = `${position.x},${position.y},${position.z}`;
                        terrainData[key] = currentBlockType.id;
                    }
                }
            }
        }

        if (terrainBuilderRef.current) {
            terrainBuilderRef.current.updateTerrainFromToolBar(terrainData);
        }
        setShowBorderModal(false);
    };
    const handleClearMap = () => {
        if (activeTool) {
            terrainBuilderRef.current?.activateTool(null);
            setActiveTool(null);
        }

        if (
            window.confirm(
                "Are you sure you want to clear the map? This cannot be undone."
            )
        ) {
            // Reset lighting to defaults in scene and remove persisted values
            try {
                const tb = terrainBuilderRef?.current;
                tb?.setAmbientLight?.({ color: "#ffffff", intensity: 0.25 });
                tb?.setDirectionalLight?.({ color: "#ffffff", intensity: 2 });
            } catch (_) { }
            try {
                const pidKey = (k: string) => `project:${DatabaseManager.getCurrentProjectId()}:${k}`;
                DatabaseManager.deleteData(STORES.SETTINGS, pidKey("ambientLight"));
                DatabaseManager.deleteData(STORES.SETTINGS, pidKey("directionalLight"));
            } catch (_) { }
            // Notify UI sections to sync their local state with reset values (without re-saving to DB)
            try {
                window.dispatchEvent(
                    new CustomEvent("lighting-reset", {
                        detail: {
                            ambient: { color: "#ffffff", intensity: 0.25 },
                            directional: { color: "#ffffff", intensity: 2 },
                        },
                    })
                );
            } catch (_) { }
            terrainBuilderRef.current?.clearMap();
        }
    };
    const generatePerlinNoiseAsync = (width, length, options) => {
        return new Promise((resolve, reject) => {
            try {
                const worker = new Worker(new URL("../workers/perlinNoiseWorker.js", import.meta.url), { type: "module" });
                worker.onmessage = (e) => {
                    resolve(e.data);
                    worker.terminate();
                };
                worker.onerror = (err) => {
                    reject(err);
                    worker.terminate();
                };
                worker.postMessage({ width, length, options });
            } catch (err) {
                reject(err);
            }
        });
    };

    const generateTerrain = async () => {
        if (currentBlockType.id > 199) {
            alert(
                "Not Compatible with Environment Objects... \n\nPlease select a block and try again!"
            );
            return;
        }

        setShowTerrainModal(false); // close modal early to avoid blocking

        let terrainData = terrainSettings.clearMap
            ? {}
            : terrainBuilderRef.current.getCurrentTerrainData();
        const { width, length, height, roughness } = terrainSettings;

        let baseNoiseMap;
        try {
            baseNoiseMap = await generatePerlinNoiseAsync(width, length, {
                octaveCount: 4,
                amplitude: 1,
                persistence: 0.5,
                scale: 0.1,
            });
        } catch (err) {
            console.error("Perlin worker failed, falling back to sync", err);
            // fallback sync import to prevent crash
            const { generatePerlinNoise } = await import("perlin-noise");
            baseNoiseMap = generatePerlinNoise(width, length, {
                octaveCount: 4,
                amplitude: 1,
                persistence: 0.5,
                scale: 0.1,
            });
        }

        const startX = -Math.floor(width / 2);
        const startZ = -Math.floor(length / 2);

        const smoothingFactor = roughness / 30; // Now 70 = smoothest (2.33), 100 = roughest (3.33)

        for (let x = 0; x < width; x++) {
            for (let z = 0; z < length; z++) {
                const baseNoiseValue = baseNoiseMap[z * width + x];

                let finalNoiseValue;
                if (smoothingFactor > 3.0) {
                    finalNoiseValue = Math.pow(baseNoiseValue, 0.6);
                } else if (smoothingFactor > 2.7) {
                    finalNoiseValue = Math.pow(baseNoiseValue, 0.8);
                } else if (smoothingFactor > 2.5) {
                    finalNoiseValue = baseNoiseValue;
                } else {
                    let neighborSum = 0;
                    let neighborCount = 0;

                    const radius = Math.floor(15 - smoothingFactor * 4);
                    for (
                        let nx = Math.max(0, x - radius);
                        nx <= Math.min(width - 1, x + radius);
                        nx++
                    ) {
                        for (
                            let nz = Math.max(0, z - radius);
                            nz <= Math.min(length - 1, z + radius);
                            nz++
                        ) {
                            const dist = Math.sqrt(
                                Math.pow(nx - x, 2) + Math.pow(nz - z, 2)
                            );
                            if (dist <= radius) {
                                const weight = 1 - dist / radius;
                                neighborSum +=
                                    baseNoiseMap[nz * width + nx] * weight;
                                neighborCount += weight;
                            }
                        }
                    }

                    finalNoiseValue = neighborSum / neighborCount;
                }

                const terrainHeight = Math.max(
                    1,
                    Math.floor(1 + finalNoiseValue * (height - 1))
                );

                for (let y = 0; y < terrainHeight; y++) {
                    const worldX = startX + x;
                    const worldZ = startZ + z;
                    const key = `${worldX},${y},${worldZ}`;

                    terrainData[key] = currentBlockType.id;
                }
            }
        }
        console.log(
            `Generated terrain: ${width}x${length} with height range 1-${height}, roughness: ${roughness}`
        );

        if (terrainBuilderRef.current) {
            terrainBuilderRef.current.updateTerrainFromToolBar(terrainData);
        }
    };
    const handleExportMap = () => {
        // Show export options modal
        setShowExportModal(true);
    };

    const handleConfirmExport = async () => {
        setShowExportModal(false);
        try {
            await exportMapFile(terrainBuilderRef, environmentBuilderRef, exportOptions);
        } catch (error) {
            console.error("Error exporting map:", error);
            alert("Error exporting map. Please try again.");
        }
    };

    /**
     * Helper to check if a block type is transparent (has any transparent face)
     */
    const isBlockTransparent = (blockId: number): boolean => {
        try {
            const blockTypeRegistry = (window as any).BlockTypeRegistry;
            if (!blockTypeRegistry?.instance) return false;
            const blockType = blockTypeRegistry.instance.getBlockType(blockId);
            if (!blockType) return false;
            // Check if any face is transparent
            const faces = ['top', 'bottom', 'left', 'right', 'front', 'back'];
            for (const face of faces) {
                if (blockType.isFaceTransparent?.(face)) return true;
            }
            return false;
        } catch {
            return false;
        }
    };

    /**
     * Helper to check if a block type is liquid
     */
    const isBlockLiquid = (blockId: number): boolean => {
        try {
            const blockTypeRegistry = (window as any).BlockTypeRegistry;
            if (!blockTypeRegistry?.instance) return false;
            const blockType = blockTypeRegistry.instance.getBlockType(blockId);
            return blockType?.isLiquid ?? false;
        } catch {
            return false;
        }
    };

    const handleRemoveHiddenBlocks = (options: {
        includeLiquids: boolean;
        preserveNextToTransparent: boolean;
        preserveNextToLiquids: boolean;
    }) => {
        if (!terrainBuilderRef?.current?.getCurrentTerrainData) {
            console.error("TerrainBuilder reference not available for removing hidden blocks");
            return;
        }

        const terrainData = terrainBuilderRef.current.getCurrentTerrainData();
        if (!terrainData) return;

        const originalCount = Object.keys(terrainData).length;
        const removedBlocks: Record<string, number> = {};

        for (const key in terrainData) {
            const blockId = terrainData[key];

            // Check if this block is a liquid
            const blockIsLiquid = isBlockLiquid(blockId);

            // If includeLiquids is false and this block is liquid, skip it (don't remove)
            if (!options.includeLiquids && blockIsLiquid) {
                continue;
            }

            const [xStr, yStr, zStr] = key.split(",");
            const x = parseInt(xStr);
            const y = parseInt(yStr);
            const z = parseInt(zStr);

            const neighborKeys = [
                `${x + 1},${y},${z}`,
                `${x - 1},${y},${z}`,
                `${x},${y + 1},${z}`,
                `${x},${y - 1},${z}`,
                `${x},${y},${z + 1}`,
                `${x},${y},${z - 1}`,
            ];

            let isHidden = true;
            let touchesTransparent = false;
            let touchesLiquid = false;

            for (const nKey of neighborKeys) {
                if (!(nKey in terrainData)) {
                    // No neighbor at this position - block is exposed
                    isHidden = false;
                    break;
                }

                const neighborId = terrainData[nKey];

                // Check neighbor properties for preservation options
                if (options.preserveNextToTransparent && isBlockTransparent(neighborId)) {
                    touchesTransparent = true;
                }
                if (options.preserveNextToLiquids && isBlockLiquid(neighborId)) {
                    touchesLiquid = true;
                }
            }

            // If block touches transparent/liquid and user wants to preserve those, skip
            if (touchesTransparent || touchesLiquid) {
                continue;
            }

            if (isHidden) {
                removedBlocks[key] = terrainData[key];
            }
        }

        const removedCount = Object.keys(removedBlocks).length;

        if (removedCount === 0) {
            alert("No hidden blocks found to remove with the current options.");
            return;
        }

        try {
            terrainBuilderRef.current.updateTerrainBlocks({}, removedBlocks, { syncPendingChanges: true });
            alert(
                `Hidden Blocks Removed!\nOriginal Blocks: ${originalCount}\nBlocks Removed: ${removedCount}\nRemaining Blocks: ${originalCount - removedCount}`
            );
        } catch (error) {
            console.error("Error removing hidden blocks:", error);
            alert("An error occurred while removing hidden blocks. Check console for details.");
        }
    };

    useEffect(() => {
        const update = () => {
            const manager = undoRedoManager?.current;
            setCanUndo(!!manager?.canUndo?.());
            setCanRedo(!!manager?.canRedo?.());
        };
        // Run once immediately, then on interval
        update();
        const interval = setInterval(update, 500);
        return () => clearInterval(interval);
    }, [undoRedoManager]);

    const onMapFileSelected = (event) => {
        console.log("Map file selected:", event.target.files[0]);
        if (event.target.files && event.target.files[0]) {
            importMap(
                event.target.files[0],
                terrainBuilderRef,
                environmentBuilderRef
            )
                .then(() => {
                    event.target.value = "";
                    console.log("Reset file input after successful import");
                    // Close the submenu now that the import flow is complete
                    setActiveSubmenu(SubMenuType.NONE);
                })
                .catch((error) => {
                    event.target.value = "";
                    console.error("Error during import:", error);
                    // Ensure submenu is closed even if the import fails
                    setActiveSubmenu(SubMenuType.NONE);
                });
        }
    };

    const handleModalOverlayClick = (e, setModalVisibility) => {
        if (e.target.className === "modal-overlay") {
            setModalVisibility(false);
        }
    };

    const handleToolToggle = (toolName) => {
        if (activeTool === toolName) {
            terrainBuilderRef.current?.activateTool(null);
            setActiveTool(null);
        } else {
            const success = terrainBuilderRef.current?.activateTool(toolName);
            if (success) {
                setActiveTool(toolName);

                if (toolName === "wall" && undoRedoManager) {
                    console.log(
                        "ToolBar: Ensuring WallTool has undoRedoManager reference"
                    );

                    const wallTool =
                        terrainBuilderRef.current?.toolManagerRef?.current
                            ?.tools?.["wall"];
                    if (wallTool) {
                        wallTool.undoRedoManager = undoRedoManager;
                        console.log(
                            "ToolBar: Updated WallTool undoRedoManager reference",
                            undoRedoManager && "current" in undoRedoManager
                                ? "(is ref)"
                                : "(is direct)"
                        );
                    }
                }
            }
        }
    };

    const handleModeChangeWithToolReset = (newMode) => {
        if (activeTool) {
            terrainBuilderRef.current?.activateTool(null);
            setActiveTool(null);
        }

        handleModeChange(newMode);
    };

    // Listen for tool change events from ToolManager instead of polling
    useEffect(() => {
        const manager = terrainBuilderRef?.current?.toolManagerRef?.current;
        if (!manager || typeof manager.addToolChangeListener !== "function") return;

        const listener = (toolName) => {
            setActiveTool(toolName || null);
        };

        manager.addToolChangeListener(listener);

        return () => {
            if (typeof manager.removeToolChangeListener === "function") {
                manager.removeToolChangeListener(listener);
            }
        };
    }, [terrainBuilderRef]);

    // Listen for tab change events dispatched from BlockToolsSidebar and pointer lock state changes
    useEffect(() => {
        const handleTabChangeReset = () => {
            setActiveTool(null);
            setActiveSubmenu(SubMenuType.NONE); // Reset submenu on tab change
        };
        window.addEventListener("blockToolsTabChanged", handleTabChangeReset);
        window.addEventListener("pointerLockModeChanged", handleTabChangeReset);
        return () => {
            window.removeEventListener("blockToolsTabChanged", handleTabChangeReset);
            window.removeEventListener("pointerLockModeChanged", handleTabChangeReset);
        };
    }, []);

    // Axiom Blueprint converter functions
    const DEBUG_BP_IMPORT = true;

    const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });

    const parseNbtBrowser = async (arrayBuffer: ArrayBuffer | Uint8Array) => {
        if (arrayBuffer instanceof Uint8Array) {
            return NBTParser.parse(arrayBuffer);
        }
        if (arrayBuffer instanceof ArrayBuffer) {
            return NBTParser.parse(new Uint8Array(arrayBuffer));
        }
        if (arrayBuffer && (arrayBuffer as any).buffer instanceof ArrayBuffer) {
            return NBTParser.parse(new Uint8Array((arrayBuffer as any).buffer));
        }
        return NBTParser.parse(arrayBuffer);
    };

    const decodeLongPairToBigInt = (pair: [number, number]) => {
        const hi = BigInt((pair[0] >>> 0) >>> 0);
        const lo = BigInt((pair[1] >>> 0) >>> 0);
        return (hi << 32n) | lo;
    };

    const decodePaletteIndices = (longPairs: any[], paletteLen: number, totalBlocks: number) => {
        const longs =
            longPairs &&
                longPairs.length > 0 &&
                typeof longPairs[0] === "bigint"
                ? longPairs
                : (longPairs || []).map(decodeLongPairToBigInt);

        const bitsPerBlock = Math.max(
            4,
            Math.ceil(Math.log2(Math.max(1, paletteLen)))
        );
        const valuesPerLong = Math.max(1, Math.floor(64 / bitsPerBlock));
        const mask = (1n << BigInt(bitsPerBlock)) - 1n;

        const out = new Array(totalBlocks);
        for (let i = 0; i < totalBlocks; i++) {
            const longIndex = Math.floor(i / valuesPerLong);
            const indexWithinLong = i % valuesPerLong;
            const startBit = BigInt(indexWithinLong * bitsPerBlock);
            const word = longs[longIndex] ?? 0n;
            out[i] = Number((word >> startBit) & mask);
        }
        return out;
    };

    const sectionIndexToLocalXYZ = (index: number) => {
        const x = index & 15;
        const z = (index >> 4) & 15;
        const y = (index >> 8) & 15;
        return { x, y, z };
    };

    const parseAxiomBpInBrowser = async (file: File) => {
        const ab = await readFileAsArrayBuffer(file);
        const bytes = new Uint8Array(ab);
        const dv = new DataView(bytes.buffer);
        let offset = 0;
        // Magic
        if (
            !(
                bytes[0] === 0x0a &&
                bytes[1] === 0xe5 &&
                bytes[2] === 0xbb &&
                bytes[3] === 0x36
            )
        ) {
            throw new Error("Invalid .bp magic");
        }
        offset += 4;
        // metadata
        const metaLen = dv.getUint32(offset);
        offset += 4;
        const metaBuf = bytes.subarray(offset, offset + metaLen);
        offset += metaLen;
        const metadata = await parseNbtBrowser(metaBuf);
        // preview
        const previewLen = dv.getUint32(offset);
        offset += 4;
        const previewBuf = bytes.subarray(offset, offset + previewLen);
        offset += previewLen;
        // structure (gzip NBT)
        const structLen = dv.getUint32(offset);
        offset += 4;
        const structCompressed = bytes.subarray(offset, offset + structLen);
        let structure;
        try {
            const structInflated = pako.ungzip(structCompressed);
            structure = await parseNbtBrowser(structInflated);
        } catch (e) {
            structure = await parseNbtBrowser(structCompressed);
        }
        return { metadata, previewBuf, structure };
    };

    const loadSavedMappings = () => {
        try {
            const raw = localStorage.getItem("axiomBlockMappings");
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (_) {
            return {};
        }
    };

    const convertStructureToTerrainMap = (structure: any, customMappings: Record<string, any> = {}) => {
        const getVal = (v: any) => (v && v.value !== undefined ? v.value : v);
        let regions: any[] = [];
        if (Array.isArray(structure.BlockRegion)) {
            regions = structure.BlockRegion;
        } else if (
            structure.BlockRegion &&
            structure.BlockRegion.value &&
            structure.BlockRegion.value.value
        ) {
            regions = structure.BlockRegion.value.value;
        }
        const terrain: Record<string, number> = {};
        const entities: any[] = [];
        for (let idx = 0; idx < regions.length; idx++) {
            const region = regions[idx];
            const baseX = getVal(region.X) * 16;
            const baseY = getVal(region.Y) * 16;
            const baseZ = getVal(region.Z) * 16;
            const bs = getVal(region.BlockStates);
            if (!bs) continue;
            let data = getVal(bs.data) || [];
            let palette = getVal(bs.palette) || [];
            if (palette && palette.value && palette.value.value) {
                palette = palette.value.value;
            }
            if (!palette.length) continue;
            const totalBlocks = 16 * 16 * 16;
            const indices = decodePaletteIndices(
                data,
                palette.length,
                totalBlocks
            );
            for (let i = 0; i < totalBlocks; i++) {
                const pIdx = indices[i];
                const entry = palette[pIdx];
                if (!entry) continue;
                const nameVal = getVal(entry.Name);
                if (!nameVal || typeof nameVal !== "string") continue;
                const mcName = nameVal;
                const mapping =
                    customMappings[mcName] || suggestMapping(mcName);
                if (!mapping || mapping.action === "skip") continue;

                if (mapping.action === "entity") {
                    const { x: lx, y: ly, z: lz } = sectionIndexToLocalXYZ(i);
                    const x = baseX + lx;
                    const y = baseY + ly;
                    const z = baseZ + lz;
                    const entityName = mapping.entityName;
                    entities.push({
                        entityName,
                        position: [x, y, z],
                        rotation: [0, 0, 0],
                    });
                    continue;
                }

                const blockId = parseInt(
                    mapping.id || mapping.targetBlockId || mapping?.id,
                    10
                );
                if (!blockId) continue;

                const { x: lx, y: ly, z: lz } = sectionIndexToLocalXYZ(i);
                const x = baseX + lx;
                const y = baseY + ly;
                const z = baseZ + lz;
                terrain[`${x},${y},${z}`] = blockId;
            }
        }
        return { terrain, entities };
    };

    const terrainToRelativeSchematic = (terrainMap: Record<string, number>) => {
        const keys = Object.keys(terrainMap);
        if (keys.length === 0) return { blocks: {}, entities: [] };
        let minX = Infinity,
            minY = Infinity,
            minZ = Infinity;
        for (const k of keys) {
            const [x, y, z] = k.split(",").map(Number);
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
        }
        const relBlocks: Record<string, number> = {};
        for (const [k, id] of Object.entries(terrainMap)) {
            const [x, y, z] = k.split(",").map(Number);
            const rx = x - minX;
            const ry = y - minY;
            const rz = z - minZ;
            relBlocks[`${rx},${ry},${rz}`] = id;
        }
        return {
            blocks: relBlocks,
            entities: [],
            min: { x: minX, y: minY, z: minZ },
        };
    };

    const extractUnmappedBlocks = (structure: any) => {
        const getVal = (v: any) => (v && v.value !== undefined ? v.value : v);
        let regions: any[] = [];
        if (Array.isArray(structure.BlockRegion)) {
            regions = structure.BlockRegion;
        } else if (
            structure.BlockRegion &&
            structure.BlockRegion.value &&
            structure.BlockRegion.value.value
        ) {
            regions = structure.BlockRegion.value.value;
        }

        const blockCounts: Record<string, number> = {};
        const unmappedBlocks = new Set<string>();

        for (const region of regions) {
            const bs = getVal(region.BlockStates);
            if (!bs) continue;

            let palette = getVal(bs.palette) || [];
            if (palette && palette.value && palette.value.value) {
                palette = palette.value.value;
            }

            let data = getVal(bs.data) || [];
            const totalBlocks = 16 * 16 * 16;
            const indices = decodePaletteIndices(
                data,
                palette.length,
                totalBlocks
            );

            for (let i = 0; i < totalBlocks; i++) {
                const pIdx = indices[i];
                const entry = palette[pIdx];
                if (!entry) continue;

                const nameVal = getVal(entry.Name);
                if (!nameVal || typeof nameVal !== "string") continue;

                const mcName = nameVal;
                blockCounts[mcName] = (blockCounts[mcName] || 0) + 1;

                if (!DEFAULT_BLOCK_MAPPINGS[mcName]) {
                    const suggested = suggestMapping(mcName);
                    if (!suggested || suggested.action === "skip") {
                        unmappedBlocks.add(mcName);
                    }
                }
            }
        }

        return {
            unmappedBlocks: Array.from(unmappedBlocks),
            blockCounts,
        };
    };

    const handleBlockMappingConfirm = (customMappings: Record<string, any>) => {
        if (!pendingBpImport) return;

        const { metadata, structure, file } = pendingBpImport;
        const saved = loadSavedMappings();
        const mergedMappings = { ...saved, ...customMappings };
        const { terrain, entities } = convertStructureToTerrainMap(
            structure,
            mergedMappings
        );
        const schematic = terrainToRelativeSchematic(terrain);
        if (entities && entities.length) {
            schematic.entities = entities.map((e: any) => ({
                entityName: e.entityName,
                position: [
                    e.position[0] - schematic.min.x,
                    e.position[1] - schematic.min.y,
                    e.position[2] - schematic.min.z,
                ],
                rotation: e.rotation,
            }));
        }

        const nameTag =
            metadata && metadata.Name && (metadata.Name.value || metadata.Name);
        const name =
            typeof nameTag === "string" && nameTag.trim()
                ? nameTag
                : file.name.replace(/\.bp$/i, "");

        // Activate schematic tool with the imported blueprint
        try {
            if (terrainBuilderRef?.current?.activateTool) {
                terrainBuilderRef.current.activateTool("schematic", schematic);
            }
        } catch (_) { }

        // Clean up
        setShowBlockRemapper(false);
        setPendingBpImport(null);
        setUnmappedBlocks([]);
        setBlockCounts({});
    };

    const handleBlockMappingCancel = () => {
        setShowBlockRemapper(false);
        setPendingBpImport(null);
        setUnmappedBlocks([]);
        setBlockCounts({});
        if (bpFileInputRef.current) {
            bpFileInputRef.current.value = "";
        }
    };

    const handleBpFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        const bp = files.find((f) => f.name.toLowerCase().endsWith(".bp"));
        try {
            if (bp) {
                const { metadata, structure } = await parseAxiomBpInBrowser(bp);

                // Check for unmapped blocks
                const { unmappedBlocks, blockCounts } =
                    extractUnmappedBlocks(structure);
                // Apply saved mappings to reduce remap workload
                const saved = loadSavedMappings();
                const remainingUnmapped = unmappedBlocks.filter((name) => {
                    const m = saved[name];
                    if (!m) return true;
                    if (m.action === "map" && (m.id || m.targetBlockId))
                        return false;
                    if (
                        m.action === "entity" &&
                        (m.entityName || m.targetEntityName)
                    )
                        return false;
                    return true;
                });

                // Always show remapper UI, even if all blocks are auto-mapped
                setPendingBpImport({ metadata, structure, file: bp });
                setUnmappedBlocks(remainingUnmapped);
                setBlockCounts(blockCounts);
                setShowBlockRemapper(true);
            }
        } catch (err) {
            console.error("Import failed:", err);
            alert("Failed to import file. See console for details.");
        } finally {
            e.target.value = "";
        }
    };

    return (
        <>
            <div className="controls-container">
                {/*     background-color: rgba(13, 13, 13, 0.7);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px); */}
                <div className="control-group bg-[#0d0d0d]/70 backdrop-filter backdrop-blur-lg rounded-l-xl pl-2">
                    <div className="control-button-wrapper">
                        <Tooltip text="Add blocks">
                            <button
                                onClick={() =>
                                    handleModeChangeWithToolReset("add")
                                }
                                className={`control-button ${mode === "add" ? "selected" : ""
                                    }`}
                            >
                                <FaPlus className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                            </button>
                        </Tooltip>
                        <Tooltip text="Remove Hidden Blocks">
                            <button
                                onClick={() =>
                                    handleModeChangeWithToolReset("remove")
                                }
                                className={`control-button ${mode === "remove" ? "selected" : ""
                                    }`}
                            >
                                <FaMinus className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                            </button>
                        </Tooltip>
                        {/* <Tooltip
                            text={
                                axisLockEnabled
                                    ? "Disable axis lock"
                                    : "Enable axis lock (Not currently working)"
                            }
                        >
                            <button
                                onClick={() =>
                                    setAxisLockEnabled(!axisLockEnabled)
                                }
                                className={`control-button ${axisLockEnabled ? "selected" : ""}`}
                            >
                                {axisLockEnabled ? <FaLock /> : <FaLockOpen />}
                            </button>
                        </Tooltip> */}
                        <Tooltip text="Undo (Ctrl+Z)">
                            <button
                                onClick={() =>
                                    undoRedoManager?.current?.handleUndo()
                                }
                                className={`control-button ${!canUndo ? "disabled" : ""}`}
                                disabled={!canUndo}
                            >
                                <FaUndo className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                            </button>
                        </Tooltip>
                        <Tooltip text="Redo (Ctrl+Y)">
                            <button
                                onClick={() =>
                                    undoRedoManager?.current?.handleRedo()
                                }
                                className={`control-button ${!canRedo ? "disabled" : ""}`}
                                disabled={!canRedo}
                            >
                                <FaRedo className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                            </button>
                        </Tooltip>
                        <div className="control-divider-vertical"></div>
                        <Tooltip text="Placement Size / Shape" hideTooltip={activeSubmenu === SubMenuType.PLACEMENT || waitingForMouseCycle}>
                            <div
                                className="relative"
                                onMouseLeave={() => {
                                    // Keep waiting for mouse cycle when mouse leaves
                                }}
                                onMouseEnter={() => {
                                    // Reset waiting state when mouse re-enters
                                    if (waitingForMouseCycle) {
                                        setWaitingForMouseCycle(false);
                                    }
                                }}
                            >
                                <button
                                    className={`relative control-button active:translate-y-[1px] group transition-all ${activeSubmenu === SubMenuType.PLACEMENT ? 'selected' : ''}`}
                                    onClick={(e) => {
                                        const el = e.target as HTMLElement;
                                        if (el && el.className && el.className.toString().includes("control-button") && activeSubmenu === SubMenuType.PLACEMENT) {
                                            setActiveSubmenu(SubMenuType.NONE);
                                            setWaitingForMouseCycle(true);
                                        } else {
                                            toggleSubmenu(SubMenuType.PLACEMENT);
                                        }
                                    }}
                                >
                                    <FaThLarge className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                                </button>

                                {activeSubmenu === SubMenuType.PLACEMENT && (
                                    <div className="flex absolute -top-12 left-1/2 gap-x-1 justify-center items-center h-full -translate-x-1/2 w-fit">
                                        {(activeTab === 'blocks'
                                            ? [
                                                { label: '1×1', value: 'single' },
                                                { label: '3×3', value: '3x3' },
                                                { label: '5×5', value: '5x5' },
                                                { label: '◇3', value: '3x3diamond' },
                                                { label: '◇5', value: '5x5diamond' },
                                                { label: '🏔️', value: 'terrain', isTool: true },
                                            ]
                                            : [
                                                { label: '1×1', value: 'single' },
                                            ]).map((opt, idx) => (
                                                <button
                                                    key={idx}
                                                    className={`w-fit flex items-center justify-center bg-black/60 text-[#F1F1F1] rounded-md px-2 py-1 border border-white/0 hover:border-white transition-opacity duration-200 cursor-pointer opacity-0 fade-up ${(opt.isTool && activeTool === opt.value) || (!opt.isTool && placementSize === opt.value) ? 'bg-white/90 text-black' : ''}`}
                                                    style={{ animationDelay: `${0.05 * (idx + 1)}s` }}
                                                    onClick={(e) => {
                                                        if (opt.isTool) {
                                                            // Handle tool activation
                                                            handleToolToggle(opt.value);
                                                            setPlacementSize("single");
                                                        } else {
                                                            // Handle placement size change
                                                            if (activeTool) {
                                                                try {
                                                                    terrainBuilderRef.current?.activateTool(null);
                                                                } catch (_) { }
                                                                setActiveTool(null);
                                                            }
                                                            setPlacementSize(opt.value);
                                                        }
                                                        setActiveSubmenu(SubMenuType.NONE); // Close submenu after selection
                                                        setWaitingForMouseCycle(true);
                                                    }}
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                    </div>
                                )}
                            </div>
                        </Tooltip>
                        <div className="control-divider-vertical"></div>
                        <div className="relative">
                            <Tooltip text="Swapping Tools" hideTooltip={activeSubmenu === SubMenuType.SWAP}>
                                <button
                                    className={`relative control-button active:translate-y-[1px] group transition-all ${activeSubmenu === SubMenuType.SWAP ? 'selected' : ''}`}
                                    onClick={() => toggleSubmenu(SubMenuType.SWAP)}
                                >
                                    <FaExchangeAlt className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                                </button>
                            </Tooltip>

                            {activeSubmenu === SubMenuType.SWAP && (
                                <div className="flex absolute -top-12 left-1/2 gap-x-1 justify-center items-center h-full -translate-x-1/2 w-fit">
                                    <Tooltip text="Paint Terrain">
                                        <button
                                            className={`w-fit flex items-center justify-center bg-black/60 text-[#F1F1F1] rounded-md px-2 py-1 border border-white/0 hover:border-white transition-opacity duration-200 cursor-pointer opacity-0 fade-up ${activeTool === 'replace' ? 'bg-white/90 text-black' : ''}`}
                                            style={{ animationDelay: '0.05s' }}
                                            onClick={() => {
                                                handleToolToggle('replace');
                                                setPlacementSize("single");
                                                setActiveSubmenu(SubMenuType.NONE); // Close submenu after selection
                                            }}
                                        >
                                            <svg width="20" height="22" viewBox="0 0 26 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path d="M4.19196 12.3389C3.21046 13.2979 3.26696 14.5764 4.31696 15.6149L6.55446 17.8749C5.39046 18.6169 3.14196 19.5299 2.06896 20.6034C0.390963 22.2814 0.402463 24.5414 2.11396 26.2649C3.83796 27.9769 6.09796 27.9999 7.77596 26.3219C8.86046 25.2374 9.76196 22.9889 10.504 21.8359L12.787 24.0849C13.826 25.1119 15.093 25.1689 16.063 24.1989L17.2845 22.9434C18.0605 22.1444 18.186 21.1624 17.627 20.2609C18.129 20.1354 18.597 19.8499 18.962 19.4734L24.27 14.1424C25.537 12.8874 25.503 11.3919 24.19 10.0789L15.002 0.890446C14.1795 0.0799465 13.0615 -5.3525e-05 12.2965 0.764946C11.954 1.10695 11.6915 1.59795 11.5545 2.25995C10.938 5.09095 9.69346 7.72745 8.23246 9.58845C7.98146 9.91945 7.81046 10.2384 7.73046 10.5699C6.94296 10.2499 6.12046 10.4214 5.43596 11.0949L4.19196 12.3389ZM17.3645 18.5259C16.8845 18.9939 16.4395 18.9594 15.9605 18.4689H15.949L9.80796 12.3274L9.81946 12.3164C9.37446 11.8824 9.16846 11.4029 9.80796 10.4784C11.132 8.57245 12.4445 5.95845 13.221 3.04745C13.2665 2.91095 13.3235 2.79645 13.426 2.69395C13.609 2.49995 13.86 2.44245 14.111 2.70495L19.6585 8.24145C19.362 10.1474 17.8435 12.0424 16.6795 13.2064C16.5655 13.3209 16.417 13.4804 16.5995 13.6634C17.1705 14.2339 20.5945 11.7799 21.9875 10.5814L22.7975 11.3804C23.3455 11.9284 23.357 12.5219 22.866 13.0124L17.3645 18.5259ZM5.73296 13.4234L6.52046 12.6474C6.87446 12.3049 7.34246 12.2934 7.70746 12.6699L15.721 20.6949C16.075 21.0714 16.086 21.5049 15.7325 21.8589L14.979 22.6464C14.614 23.0114 14.1575 23.0004 13.792 22.6239L10.9155 19.7589C10.516 19.3479 10.0595 19.5074 9.64846 20.0439C8.81546 21.2309 7.41146 24.2219 6.57846 25.0439C5.59646 26.0024 4.29496 26.0249 3.32496 25.0549C2.35496 24.0849 2.36596 22.7719 3.33646 21.8019C4.15796 20.9799 7.14846 19.5644 8.34746 18.7314C8.87246 18.3204 9.04346 17.8639 8.62096 17.4644L5.75596 14.6104C5.39096 14.2569 5.37946 13.7774 5.73346 13.4234M4.08946 24.3014C4.46646 24.6664 5.01446 24.6664 5.37946 24.3014C5.74446 23.9134 5.73346 23.3769 5.37946 23.0114C5.00296 22.6464 4.44346 22.6349 4.08946 23.0114C3.74746 23.3999 3.72446 23.9249 4.08946 24.3014Z" fill="currentColor" />
                                            </svg>
                                        </button>
                                    </Tooltip>
                                    <Tooltip text="Global Remap (replace blocks across entire map)">
                                        <button
                                            className={`w-fit flex items-center justify-center bg-black/60 text-[#F1F1F1] rounded-md px-2 py-1 border border-white/0 hover:border-white transition-opacity duration-200 cursor-pointer opacity-0 fade-up ${showGlobalRemapModal ? 'bg-white/90 text-black' : ''}`}
                                            style={{ animationDelay: '0.1s' }}
                                            onClick={() => openGlobalRemap()}
                                        >
                                            <svg width="21" height="22" viewBox="0 0 21 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path d="M18.9849 10.5202C19.0906 8.69823 18.6399 6.88721 17.6925 5.32732C16.7452 3.76744 15.3461 2.53241 13.6806 1.78606C12.0152 1.0397 10.1623 0.81729 8.36752 1.14832C6.57278 1.47936 4.92109 2.34819 3.63153 3.63959C2.34197 4.93098 1.47548 6.5839 1.14699 8.3791C0.818506 10.1743 1.04355 12.027 1.79226 13.6913C2.54098 15.3557 3.77799 16.7531 5.33922 17.6982C6.90045 18.6433 8.71211 19.0914 10.5339 18.9832M1.5999 7.00018H18.3999M1.5999 13.0002H12.4999" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                <path d="M9.49967 1C7.81501 3.69961 6.92188 6.81787 6.92188 10C6.92188 13.1821 7.81501 16.3004 9.49967 19M10.4997 1C12.6405 4.4308 13.4883 8.51242 12.8907 12.512" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                <g clipPath="url(#clip0_3578_19110)">
                                                    <path d="M20.8528 15.6466L19.3528 17.3341C19.1575 17.5539 18.8403 17.5539 18.645 17.3341C18.4497 17.1144 18.4497 16.7576 18.645 16.5378L19.2919 15.8119H13.4997C13.2231 15.8119 12.9997 15.5605 12.9997 15.2494C12.9997 14.9382 13.2231 14.6869 13.4997 14.6869H19.2919L18.645 13.9591C18.4497 13.7394 18.4497 13.3826 18.645 13.1628C18.8403 12.9431 19.1575 12.9431 19.3528 13.1628L20.8528 14.8503C21.0481 15.0701 21.0481 15.4269 20.8528 15.6466ZM14.645 21.8341L13.145 20.1466C12.9497 19.9269 12.9497 19.5701 13.145 19.3503L14.645 17.6628C14.8403 17.4431 15.1575 17.4431 15.3528 17.6628C15.5481 17.8826 15.5481 18.2394 15.3528 18.4591L14.7075 19.1869H20.4997C20.7763 19.1869 20.9997 19.4382 20.9997 19.7494C20.9997 20.0605 20.7763 20.3119 20.4997 20.3119H14.7075L15.3544 21.0396C15.5497 21.2593 15.5497 21.6162 15.3544 21.8359C15.1591 22.0556 14.8419 22.0556 14.6466 21.8359L14.645 21.8341Z" fill="white" />
                                                </g>
                                                <defs>
                                                    <clipPath id="clip0_3578_19110">
                                                        <rect width="8" height="9" fill="white" transform="translate(13 13)" />
                                                    </clipPath>
                                                </defs>
                                            </svg>
                                        </button>
                                    </Tooltip>
                                    <Tooltip text="Find & Replace Structures (find patterns and replace them)">
                                        <button
                                            className={`w-fit flex items-center justify-center bg-black/60 text-[#F1F1F1] rounded-md px-2 py-1 border border-white/0 hover:border-white transition-opacity duration-200 cursor-pointer opacity-0 fade-up ${activeTool === 'findreplace' ? 'bg-white/90 text-black' : ''}`}
                                            style={{ animationDelay: '0.15s' }}
                                            onClick={() => {
                                                handleToolToggle('findreplace');
                                                setPlacementSize("single");
                                                setActiveSubmenu(SubMenuType.NONE);
                                            }}
                                        >
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path d="M11 19C15.4183 19 19 15.4183 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11C3 15.4183 6.58172 19 11 19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                                <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                                <path d="M8 11H14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                                <path d="M11 8V14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                            </svg>
                                        </button>
                                    </Tooltip>
                                </div>
                            )}
                        </div>
                        <div className="control-divider-vertical"></div>
                        <Tooltip text="Selection Tool - Click to start selection, click again to confirm. Click and drag to move selection. Press Escape to cancel.">
                            <button
                                onClick={() => {
                                    handleToolToggle("selection");
                                    setPlacementSize("single");
                                }}
                                className={`control-button ${activeTool === "selection" ? "selected" : ""
                                    }`}
                            >
                                <FaMousePointer className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                            </button>
                        </Tooltip>
                        {activeTab === 'blocks' && (
                            <Tooltip text="Ground Tool - Click to start, click again to place a flat ground area. Use 1 | 2 to adjust height. Use 5 | 6 to change number of sides (4-8). Hold Ctrl to erase. Press Escape to cancel.">
                                <button
                                    onClick={() => {
                                        handleToolToggle("ground");
                                        setPlacementSize("single");
                                    }}
                                    className={`control-button ${activeTool === "ground" ? "selected" : ""
                                        }`}
                                >
                                    <FaSquare className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                                </button>
                            </Tooltip>
                        )}
                        {activeTab === 'blocks' && (
                            <Tooltip text="Wall Tool - Click to place wall start, click again to place. Hold Ctrl to erase. Press 1 and 2 to adjust height. Escape cancels">
                                <button
                                    onClick={() => {
                                        handleToolToggle("wall");
                                        setPlacementSize("single");
                                    }}
                                    className={`control-button ${activeTool === "wall" ? "selected" : ""
                                        }`}
                                >
                                    <FaDrawPolygon className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                                </button>
                            </Tooltip>
                        )}
                        {activeTab === 'blocks' && (
                            <Tooltip text="Staircase Tool - Click to start, click again to place a staircase. Use 1 | 2 to adjust width. Press 3 to toggle fill underneath. Hold Ctrl to erase. Press Escape to cancel.">
                                <button
                                    onClick={() => {
                                        handleToolToggle("staircase");
                                        setPlacementSize("single");
                                    }}
                                    className={`control-button ${activeTool === "staircase" ? "selected" : ""
                                        }`}
                                >
                                    <FaArrowUp className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                                </button>
                            </Tooltip>
                        )}
                        <div className="control-divider-vertical"></div>
                        <Tooltip text="Zone Tool - Create zones/boundaries for spawn areas, triggers, etc. Click for point, click-drag for box. Press Tab to switch modes.">
                            <button
                                onClick={() => {
                                    handleToolToggle("zone");
                                    setPlacementSize("single");
                                }}
                                className={`control-button ${activeTool === "zone" ? "selected" : ""
                                    }`}
                            >
                                <FaBorderAll className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                            </button>
                        </Tooltip>
                    </div>
                </div>

                <div className="control-group bg-[#0d0d0d]/70 backdrop-filter backdrop-blur-lg">
                    <div className="control-button-wrapper">
                        <Tooltip text="Generate terrain">
                            <button
                                onClick={() => setShowTerrainModal(true)}
                                className="control-button"
                            >
                                <FaMountain className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                            </button>
                        </Tooltip>
                        <Tooltip text="Import Axiom Blueprint (.bp)">
                            <button
                                onClick={() => {
                                    bpFileInputRef.current?.click();
                                }}
                                className="control-button"
                            >
                                <FaCubes />
                            </button>
                            <input
                                ref={bpFileInputRef}
                                type="file"
                                multiple={false}
                                accept=".bp,application/octet-stream"
                                onChange={handleBpFileInputChange}
                                style={{ display: "none" }}
                            />
                        </Tooltip>
                        <div className="relative">
                            <Tooltip text="AI Tools" hideTooltip={activeSubmenu === SubMenuType.AI || isAIComponentsActive}>
                                <button
                                    className={`relative control-button active:translate-y-[1px] group transition-all ${activeSubmenu === SubMenuType.AI || isAIComponentsActive ? 'selected' : ''}`}
                                    onClick={() => toggleSubmenu(SubMenuType.AI)}
                                >
                                    <FaRobot className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                                </button>
                            </Tooltip>

                            {activeSubmenu === SubMenuType.AI && (
                                <div className="flex absolute -top-12 left-1/2 gap-x-1 justify-center items-center h-full -translate-x-1/2 w-fit">
                                    <button
                                        className="w-fit flex items-center justify-center bg-black/60 text-[#F1F1F1] rounded-md px-2 py-1 border border-white/0 hover:border-white transition-opacity duration-200 cursor-pointer opacity-0 fade-up"
                                        style={{ animationDelay: '0.05s' }}
                                        onClick={() => {
                                            onOpenTextureModal && onOpenTextureModal();
                                            setActiveSubmenu(SubMenuType.NONE); // Close submenu after selection
                                        }}
                                    >
                                        {"Textures"}
                                    </button>
                                    <button
                                        className="w-fit flex items-center justify-center bg-black/50 text-[#F1F1F1] rounded-md px-2 py-1 border border-white/0 hover:border-white transition-opacity duration-200 cursor-pointer opacity-0 fade-up"
                                        style={{ animationDelay: '0.1s' }}
                                        onClick={() => {
                                            toggleAIComponents && toggleAIComponents();
                                            setActiveSubmenu(SubMenuType.NONE); // Close submenu after selection
                                        }}
                                    >
                                        {"Components"}
                                    </button>
                                </div>
                            )}
                        </div>
                        {/* Utils / Tools submenu */}
                        <div className="relative">
                            <Tooltip text="Tools" hideTooltip={activeSubmenu === SubMenuType.UTILS}>
                                <button
                                    className={`relative control-button active:translate-y-[1px] group transition-all ${activeSubmenu === SubMenuType.UTILS ? 'selected' : ''}`}
                                    onClick={() => toggleSubmenu(SubMenuType.UTILS)}
                                >
                                    <FaWrench className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                                </button>
                            </Tooltip>

                            {activeSubmenu === SubMenuType.UTILS && (
                                <div className="flex absolute -top-12 left-1/2 gap-x-1 justify-center items-center h-full -translate-x-1/2 w-fit">
                                    <button
                                        className="w-fit flex items-center whitespace-nowrap justify-center bg-black/60 text-[#F1F1F1] rounded-md px-2 py-1 border border-white/0 hover:border-white transition-opacity duration-200 cursor-pointer opacity-0 fade-up"
                                        style={{ animationDelay: '0.05s' }}
                                        onClick={() => {
                                            setShowRemoveHiddenModal(true);
                                            setActiveSubmenu(SubMenuType.NONE); // Close submenu
                                        }}
                                    >
                                        {"Remove Hidden Blocks"}
                                    </button>
                                </div>
                            )}
                        </div>

                    </div>
                    {/* <div className="control-label">Map Tools</div> */}
                </div>
                <div className="control-group rounded-r-xl pr-2 bg-[#0d0d0d]/70 backdrop-filter backdrop-blur-lg">
                    <div className="control-button-wrapper">
                        <Tooltip text="Switch Project">
                            <button
                                onClick={() => onSwitchProject && onSwitchProject()}
                                className="control-button"
                            >
                                <FaHome className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                            </button>
                        </Tooltip>
                        <Tooltip text="Clear entire map">
                            <button
                                onClick={handleClearMap}
                                className="control-button"
                            >
                                <FaTrash className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                            </button>
                        </Tooltip>
                        <Tooltip text="Save terrain (Ctrl+S)">
                            <button
                                onClick={async () => {
                                    setIsSaving('saving');
                                    try {
                                        if (terrainBuilderRef.current) {
                                            await terrainBuilderRef.current.saveTerrainManually();
                                        }

                                        if (environmentBuilderRef.current) {
                                            await environmentBuilderRef.current.updateLocalStorage();
                                        }
                                    } finally {
                                        setIsSaving('complete');
                                        setTimeout(() => setIsSaving('idle'), 2000);
                                    }
                                }}
                                className="control-button"
                            >
                                <FaSave className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                            </button>
                        </Tooltip>
                        <Tooltip text="Take Screenshot">
                            <button
                                onClick={() => onTakeScreenshot && onTakeScreenshot()}
                                className="control-button"
                            >
                                <FaCamera className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                            </button>
                        </Tooltip>
                        <div className="relative">
                            <Tooltip text="Import / Export Map" hideTooltip={activeSubmenu === SubMenuType.IMPORT_EXPORT}>
                                <button
                                    className={`relative control-button active:translate-y-[1px] group transition-all ${activeSubmenu === SubMenuType.IMPORT_EXPORT ? 'selected' : ''}`}
                                    onClick={() => toggleSubmenu(SubMenuType.IMPORT_EXPORT)}
                                >
                                    <FaCloud className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                                </button>
                            </Tooltip>

                            {activeSubmenu === SubMenuType.IMPORT_EXPORT && <div className={`flex absolute -top-12 left-1/2 gap-x-1 justify-center items-center h-full -translate-x-1/2 w-fit`}>
                                <input
                                    id="mapFileInput"
                                    type="file"
                                    accept=".json,.zip"
                                    onChange={onMapFileSelected}
                                    style={{ display: "none" }}
                                />
                                <button
                                    className={`w-fit flex items-center justify-center bg-black/60 text-[#F1F1F1] rounded-md px-2 py-1 border border-white/0 hover:border-white transition-opacity duration-200 cursor-pointer opacity-0 fade-up`}
                                    onClick={() => {
                                        document.getElementById("mapFileInput").click();
                                    }}
                                    style={{ animationDelay: '0.1s' }}
                                >
                                    {"Import"}
                                </button>
                                <button
                                    className={`w-fit flex items-center justify-center bg-black/50 text-[#F1F1F1] rounded-md px-2 py-1 border border-white/0 hover:border-white transition-opacity duration-200 cursor-pointer opacity-0 fade-up`}
                                    onClick={() => {
                                        handleExportMap();
                                        setActiveSubmenu(SubMenuType.NONE); // Close submenu after export
                                    }}
                                    style={{ animationDelay: '0.2s' }}
                                >
                                    {"Export"}
                                </button>
                            </div>}
                        </div>


                        {!DISABLE_ASSET_PACK_IMPORT_EXPORT && (
                            <Tooltip text="Import complete asset pack (includes map and textures)">
                                <button
                                    onClick={() =>
                                        document
                                            .getElementById("assetPackInput")
                                            .click()
                                    }
                                    className="control-button import-export-button"
                                >
                                    Asset Pack
                                </button>
                                <input
                                    id="assetPackInput"
                                    type="file"
                                    accept=".zip"
                                    style={{ display: "none" }}
                                />
                            </Tooltip>
                        )}
                        <Tooltip text={playerModeEnabled ? "Exit Player Mode" : "Enter Player Mode (run around)"}>
                            <button
                                onClick={onTogglePlayerMode}
                                className={`control-button ${playerModeEnabled ? 'selected' : ''}`}
                            >
                                <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-labelledby="title" xmlns="http://www.w3.org/2000/svg">
                                    <title>Running person icon</title>
                                    <g fill="none" stroke="#ffffff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="5">
                                        <circle cx="44" cy="12" r="6" fill="#ffffff" stroke="none" />
                                        <path d="M40 20 L30 34" />
                                        <path d="M36 24 L20 22" />
                                        <path d="M38 26 L48 34" />
                                        <path d="M30 34 L46 42 L54 58" />
                                        <path d="M30 34 L20 48 L8 50" />
                                    </g>
                                </svg>
                            </button>
                        </Tooltip>
                    </div>
                </div>
            </div>
            {showDimensionsModal && (
                <div
                    className="modal-overlay"
                    onClick={(e) =>
                        handleModalOverlayClick(e, setShowDimensionsModal)
                    }
                >
                    <div className="modal-content">
                        <div className="modal-image-container">
                            <img
                                src="./assets/ui/images/generate_cube.png"
                                alt="Cube Example"
                                className="modal-image"
                            />
                        </div>
                        <h3 className="modal-title">Generate Area of Blocks</h3>
                        <p className="modal-description">
                            Generate a large area of blocks. Enter the
                            dimensions to define the size of the shape. The
                            currently selected block will be used.
                        </p>
                        <div className="modal-input">
                            <label>Width: </label>
                            <input
                                type="number"
                                value={dimensions.width}
                                onChange={(e) =>
                                    setDimensions({
                                        ...dimensions,
                                        width: parseInt(e.target.value),
                                    })
                                }
                                min="1"
                            />
                        </div>
                        <div className="modal-input">
                            <label>Length: </label>
                            <input
                                type="number"
                                value={dimensions.length}
                                onChange={(e) =>
                                    setDimensions({
                                        ...dimensions,
                                        length: parseInt(e.target.value),
                                    })
                                }
                                min="1"
                            />
                        </div>
                        <div className="modal-input">
                            <label>Height: </label>
                            <input
                                type="number"
                                value={dimensions.height}
                                onChange={(e) =>
                                    setDimensions({
                                        ...dimensions,
                                        height: parseInt(e.target.value),
                                    })
                                }
                                min="1"
                            />
                        </div>
                        <div className="modal-buttons">
                            <button
                                className="menu-button"
                                onClick={() => {
                                    handleGenerateBlocks();
                                }}
                            >
                                Generate
                            </button>
                            <button
                                className="menu-button"
                                onClick={() => setShowDimensionsModal(false)}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {showBorderModal && (
                <div
                    className="modal-overlay"
                    onClick={(e) =>
                        handleModalOverlayClick(e, setShowBorderModal)
                    }
                >
                    <div className="modal-content">
                        <div className="modal-image-container">
                            <img
                                src="./assets/ui/images/boarder_of_bricks.png"
                                alt="Border Example"
                                className="modal-image"
                            />
                        </div>
                        <h3 className="modal-title">
                            Generate Wall Blocks (Boarder)
                        </h3>
                        <p className="modal-description">
                            Generate a boarder of blocks. Enter the dimensions
                            to define the size of the shape. The currently
                            selected block will be used.
                        </p>
                        <div className="modal-input">
                            <label>Width: </label>
                            <input
                                type="number"
                                value={borderDimensions.width}
                                onChange={(e) =>
                                    setBorderDimensions({
                                        ...borderDimensions,
                                        width: parseInt(e.target.value),
                                    })
                                }
                                min="1"
                            />
                        </div>
                        <div className="modal-input">
                            <label>Length: </label>
                            <input
                                type="number"
                                value={borderDimensions.length}
                                onChange={(e) =>
                                    setBorderDimensions({
                                        ...borderDimensions,
                                        length: parseInt(e.target.value),
                                    })
                                }
                                min="1"
                            />
                        </div>
                        <div className="modal-input">
                            <label>Height: </label>
                            <input
                                type="number"
                                value={borderDimensions.height}
                                onChange={(e) =>
                                    setBorderDimensions({
                                        ...borderDimensions,
                                        height: parseInt(e.target.value),
                                    })
                                }
                                min="1"
                            />
                        </div>
                        <div className="modal-buttons">
                            <button
                                className="menu-button"
                                onClick={() => {
                                    handleGenerateBorder();
                                }}
                            >
                                Generate
                            </button>
                            <button
                                className="menu-button"
                                onClick={() => setShowBorderModal(false)}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {showTerrainModal && (
                <div
                    className="modal-overlay"
                    onClick={(e) =>
                        handleModalOverlayClick(e, setShowTerrainModal)
                    }
                >
                    <div className="modal-content">
                        <div className="modal-image-container">
                            <img
                                src="./assets/ui/images/generate_terrain.png"
                                alt="Terrain Example"
                                className="modal-image"
                            />
                        </div>
                        <h3 className="modal-title">Generate Terrain</h3>
                        <p className="modal-description">
                            Generate natural-looking terrain with mountains and
                            valleys. Adjust the slider from roughest terrain
                            (left) to smoothest terrain (right).
                        </p>
                        <div className="modal-input">
                            <label>Width: </label>
                            <input
                                type="number"
                                value={terrainSettings.width}
                                onChange={(e) =>
                                    setTerrainSettings({
                                        ...terrainSettings,
                                        width: Math.max(
                                            1,
                                            parseInt(e.target.value)
                                        ),
                                    })
                                }
                                min="1"
                            />
                        </div>
                        <div className="modal-input">
                            <label>Length: </label>
                            <input
                                type="number"
                                value={terrainSettings.length}
                                onChange={(e) =>
                                    setTerrainSettings({
                                        ...terrainSettings,
                                        length: Math.max(
                                            1,
                                            parseInt(e.target.value)
                                        ),
                                    })
                                }
                                min="1"
                            />
                        </div>
                        <div className="modal-input">
                            <label>Max Height: </label>
                            <input
                                type="number"
                                value={terrainSettings.height}
                                onChange={(e) =>
                                    setTerrainSettings({
                                        ...terrainSettings,
                                        height: Math.max(
                                            1,
                                            parseInt(e.target.value)
                                        ),
                                    })
                                }
                                min="1"
                            />
                        </div>
                        <div className="modal-input">
                            <label style={{ marginBottom: "5px" }}>
                                Roughness:{" "}
                            </label>
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "10px",
                                }}
                            >
                                <span>Smooth</span>
                                <input
                                    type="range"
                                    value={terrainSettings.roughness}
                                    onChange={(e) =>
                                        setTerrainSettings({
                                            ...terrainSettings,
                                            roughness: parseInt(e.target.value),
                                        })
                                    }
                                    min="20"
                                    max="100"
                                />
                                <span>Rough</span>
                            </div>
                        </div>
                        <div className="checkbox-input-wrapper">
                            <label>Clear existing map:</label>
                            <input
                                type="checkbox"
                                checked={terrainSettings.clearMap}
                                onChange={(e) =>
                                    setTerrainSettings({
                                        ...terrainSettings,
                                        clearMap: e.target.checked,
                                    })
                                }
                            />
                        </div>
                        <div className="modal-buttons">
                            <button
                                className="menu-button"
                                onClick={async () => {
                                    await generateTerrain();
                                }}
                            >
                                Generate
                            </button>
                            <button
                                className="menu-button"
                                onClick={() => setShowTerrainModal(false)}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {showBlockRemapper && (
                <AxiomBlockRemapper
                    unmappedBlocks={unmappedBlocks}
                    blockCounts={blockCounts}
                    onConfirmMappings={handleBlockMappingConfirm}
                    onCancel={handleBlockMappingCancel}
                />
            )}
            {showGlobalRemapModal && (
                <div
                    className="axiom-remapper-overlay"
                    onMouseDown={(e) => {
                        if (e.target === e.currentTarget) setShowGlobalRemapModal(false);
                    }}
                    onWheel={(e) => e.stopPropagation()}
                    onTouchMove={(e) => e.stopPropagation()}
                >
                    <div className="axiom-remapper-modal" onMouseDown={(e) => e.stopPropagation()}>
                        <div className="axiom-remapper-header">
                            <h2>Global Remap</h2>
                            <p className="axiom-remapper-subtitle">
                                {remapTab === 'blocks'
                                    ? `Found ${Object.keys(usedBlockCounts).length} unique block types in this map`
                                    : `Found ${Object.keys(usedEntityCounts).length} unique entity types in this map`}
                            </p>
                        </div>

                        {/* Tab Bar */}
                        <div className="remapper-tabs">
                            <div
                                className={`remapper-tab ${remapTab === 'blocks' ? 'active' : ''}`}
                                onClick={() => setRemapTab('blocks')}
                            >
                                Blocks<span className="remapper-tab-count">({Object.keys(usedBlockCounts).length})</span>
                            </div>
                            <div
                                className={`remapper-tab ${remapTab === 'entities' ? 'active' : ''}`}
                                onClick={() => setRemapTab('entities')}
                            >
                                Entities<span className="remapper-tab-count">({Object.keys(usedEntityCounts).length})</span>
                            </div>
                        </div>

                        <div
                            className="axiom-remapper-list"
                            onWheel={(e) => e.stopPropagation()}
                            onTouchMove={(e) => e.stopPropagation()}
                        >
                            {/* ====== BLOCKS TAB ====== */}
                            {remapTab === 'blocks' && (
                                <>
                                    {Object.keys(usedBlockCounts).length > 0 && (
                                        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
                                            <button
                                                className={`advanced-filter-toggle ${breakdownByShape ? 'active' : ''}`}
                                                onClick={() => setBreakdownByShape(!breakdownByShape)}
                                            >
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                                                </svg>
                                                Breakdown by shape
                                            </button>
                                        </div>
                                    )}
                                    {Object.keys(usedBlockCounts).length === 0 ? (
                                        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', padding: '40px 0' }}>
                                            No blocks found in this map
                                        </div>
                                    ) : !breakdownByShape ? (
                                        /* === Standard per-block-type rows === */
                                        Object.keys(usedBlockCounts)
                                            .map((k) => parseInt(k))
                                            .sort((a, b) => (usedBlockCounts[b] || 0) - (usedBlockCounts[a] || 0))
                                            .map((srcId) => {
                                                const srcBlock = availableBlocks.find((b: any) => b.id === srcId);
                                                const tgtId = globalRemapTargets[srcId] !== undefined ? globalRemapTargets[srcId] : srcId;
                                                const isRemoved = tgtId === null;
                                                const tgtBlock = !isRemoved ? availableBlocks.find((b: any) => b.id === tgtId) : null;
                                                const displayCount = usedBlockCounts[srcId] || 0;
                                                return (
                                                    <div key={srcId} className="axiom-remapper-item">
                                                        <div
                                                            className="remapper-item-header"
                                                            onClick={() => setOpenSelectorFor(openSelectorFor === srcId ? null : srcId)}
                                                        >
                                                            <div className="source-block">
                                                                <span className="block-name">{srcBlock?.name || `ID ${srcId}`}</span>
                                                                <span className="block-count">
                                                                    ({displayCount} block{displayCount !== 1 ? 's' : ''})
                                                                </span>
                                                                <div className="current-mapping" title="Click to change target">
                                                                    <span className="arrow-sep">{'\u2192'}</span>
                                                                    {isRemoved ? (
                                                                        <span className="remove-indicator">Remove</span>
                                                                    ) : (
                                                                        <img
                                                                            className="mapping-icon"
                                                                            src={pickBlockTexture(tgtBlock)}
                                                                            alt={tgtBlock?.name || `ID ${tgtId}`}
                                                                        />
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        {openSelectorFor === srcId && (
                                                            <div className="remapper-item-content">
                                                                <input
                                                                    type="text"
                                                                    className="block-search"
                                                                    placeholder="Search blocks..."
                                                                    value={remapSearchTerms[srcId] || ""}
                                                                    onChange={(e) => setRemapSearchTerms((prev) => ({ ...prev, [srcId]: e.target.value }))}
                                                                    onKeyDown={(e) => e.stopPropagation()}
                                                                />
                                                                <div className="selector-grid icon-only">
                                                                    <button
                                                                        className={`selector-tile remove-tile ${isRemoved ? 'selected' : ''}`}
                                                                        title="Remove block"
                                                                        onClick={() => {
                                                                            setGlobalRemapTargets((prev) => ({ ...prev, [srcId]: null }));
                                                                            setOpenSelectorFor(null);
                                                                        }}
                                                                    >
                                                                        <span className="remove-icon">{'\u00D7'}</span>
                                                                    </button>
                                                                    {getFilteredBlocksFor(srcId).map((blk: any) => (
                                                                        <button
                                                                            key={blk.id}
                                                                            className={`selector-tile ${tgtId === blk.id ? 'selected' : ''}`}
                                                                            title={blk.name}
                                                                            onClick={() => {
                                                                                setGlobalRemapTargets((prev) => ({ ...prev, [srcId]: blk.id }));
                                                                                setOpenSelectorFor(null);
                                                                            }}
                                                                        >
                                                                            <img className="selector-icon" src={pickBlockTexture(blk)} alt={blk.name} />
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })
                                    ) : (
                                        /* === Breakdown rows: one per (blockId, rotation, shape) combo === */
                                        blockComboData.map((combo) => {
                                            const srcBlock = availableBlocks.find((b: any) => b.id === combo.blockId);
                                            const tgtId = breakdownRemapTargets[combo.comboKey] !== undefined
                                                ? breakdownRemapTargets[combo.comboKey]
                                                : combo.blockId;
                                            const isRemoved = tgtId === null;
                                            const tgtBlock = !isRemoved ? availableBlocks.find((b: any) => b.id === tgtId) : null;
                                            const isOpen = openSelectorFor as any === combo.comboKey;
                                            return (
                                                <div key={combo.comboKey} className="axiom-remapper-item">
                                                    <div
                                                        className="remapper-item-header"
                                                        onClick={() => setOpenSelectorFor(isOpen ? null : combo.comboKey as any)}
                                                    >
                                                        <div className="source-block">
                                                            <span className="block-name">{srcBlock?.name || `ID ${combo.blockId}`}</span>
                                                            <span className="combo-tags">
                                                                <span className="combo-tag">{getShapeDisplayName(combo.shape)}</span>
                                                                <span className="combo-tag">{getRotationLabel(combo.rotation)}</span>
                                                            </span>
                                                            <span className="block-count">
                                                                ({combo.count} block{combo.count !== 1 ? 's' : ''})
                                                            </span>
                                                            <div className="current-mapping" title="Click to change target">
                                                                <span className="arrow-sep">{'\u2192'}</span>
                                                                {isRemoved ? (
                                                                    <span className="remove-indicator">Remove</span>
                                                                ) : (
                                                                    <img
                                                                        className="mapping-icon"
                                                                        src={pickBlockTexture(tgtBlock)}
                                                                        alt={tgtBlock?.name || `ID ${tgtId}`}
                                                                    />
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {isOpen && (
                                                        <div className="remapper-item-content">
                                                            <input
                                                                type="text"
                                                                className="block-search"
                                                                placeholder="Search blocks..."
                                                                value={remapSearchTerms[combo.comboKey as any] || ""}
                                                                onChange={(e) => setRemapSearchTerms((prev) => ({ ...prev, [combo.comboKey]: e.target.value }))}
                                                                onKeyDown={(e) => e.stopPropagation()}
                                                            />
                                                            <div className="selector-grid icon-only">
                                                                <button
                                                                    className={`selector-tile remove-tile ${isRemoved ? 'selected' : ''}`}
                                                                    title="Remove block"
                                                                    onClick={() => {
                                                                        setBreakdownRemapTargets((prev) => ({ ...prev, [combo.comboKey]: null }));
                                                                        setOpenSelectorFor(null);
                                                                    }}
                                                                >
                                                                    <span className="remove-icon">{'\u00D7'}</span>
                                                                </button>
                                                                {getFilteredBlocksForCombo(combo.comboKey).map((blk: any) => (
                                                                    <button
                                                                        key={blk.id}
                                                                        className={`selector-tile ${tgtId === blk.id ? 'selected' : ''}`}
                                                                        title={blk.name}
                                                                        onClick={() => {
                                                                            setBreakdownRemapTargets((prev) => ({ ...prev, [combo.comboKey]: blk.id }));
                                                                            setOpenSelectorFor(null);
                                                                        }}
                                                                    >
                                                                        <img className="selector-icon" src={pickBlockTexture(blk)} alt={blk.name} />
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })
                                    )}
                                </>
                            )}

                            {/* ====== ENTITIES TAB ====== */}
                            {remapTab === 'entities' && (
                                <>
                                    {Object.keys(usedEntityCounts).length === 0 ? (
                                        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', padding: '40px 0' }}>
                                            No entities found in this map
                                        </div>
                                    ) : (
                                        Object.keys(usedEntityCounts)
                                            .sort((a, b) => (usedEntityCounts[b] || 0) - (usedEntityCounts[a] || 0))
                                            .map((srcUrl) => {
                                                const tgtUrl = entityRemapTargets[srcUrl] !== undefined ? entityRemapTargets[srcUrl] : srcUrl;
                                                const isRemoved = tgtUrl === null;
                                                const isChanged = tgtUrl !== srcUrl;
                                                return (
                                                    <div key={srcUrl} className="axiom-remapper-item">
                                                        <div
                                                            className="remapper-item-header"
                                                            onClick={() => setOpenEntitySelectorFor(openEntitySelectorFor === srcUrl ? null : srcUrl)}
                                                        >
                                                            <div className="source-block">
                                                                {(() => {
                                                                    const srcThumb = getEntityThumbnailForUrl(srcUrl);
                                                                    return srcThumb ? (
                                                                        <img className="entity-thumbnail" src={srcThumb} alt="" />
                                                                    ) : (
                                                                        <span className="entity-thumbnail entity-thumbnail-fallback">
                                                                            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
                                                                        </span>
                                                                    );
                                                                })()}
                                                                <span className="block-name">{entityDisplayName(srcUrl)}</span>
                                                                <span className="block-count">({usedEntityCounts[srcUrl] || 0} instance{(usedEntityCounts[srcUrl] || 0) !== 1 ? 's' : ''})</span>
                                                                <div className="current-mapping" title="Click to change target">
                                                                    <span className="arrow-sep">{'\u2192'}</span>
                                                                    {isRemoved ? (
                                                                        <span className="remove-indicator">Remove</span>
                                                                    ) : (
                                                                        <span className={`mapping-entity-pill ${isChanged ? 'mapping-entity-pill-changed' : ''}`}>
                                                                            {(() => {
                                                                                const tgtThumb = getEntityThumbnailForUrl(tgtUrl!);
                                                                                return tgtThumb ? <img className="entity-thumbnail" src={tgtThumb} alt="" style={{ marginRight: 4 }} /> : null;
                                                                            })()}
                                                                            {entityDisplayName(tgtUrl!)}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        {openEntitySelectorFor === srcUrl && (
                                                            <div className="remapper-item-content">
                                                                <input
                                                                    type="text"
                                                                    className="block-search"
                                                                    placeholder="Search entities..."
                                                                    value={entitySearchTerms[srcUrl] || ""}
                                                                    onChange={(e) => setEntitySearchTerms((prev) => ({ ...prev, [srcUrl]: e.target.value }))}
                                                                    onKeyDown={(e) => e.stopPropagation()}
                                                                />
                                                                <div className="selector-grid entity-selector-grid">
                                                                    <button
                                                                        className={`selector-tile remove-tile ${isRemoved ? 'selected' : ''}`}
                                                                        title="Remove entity"
                                                                        onClick={() => {
                                                                            setEntityRemapTargets((prev) => ({ ...prev, [srcUrl]: null }));
                                                                            setOpenEntitySelectorFor(null);
                                                                        }}
                                                                    >
                                                                        <span className="remove-icon">{'\u00D7'}</span>
                                                                    </button>
                                                                    {getFilteredEntitiesFor(srcUrl).map((model: any) => {
                                                                        const url = model.modelUrl;
                                                                        const name = model.displayName || model.name || entityDisplayName(url);
                                                                        const thumb = resolveEntityThumbnail(model.thumbnailUrl);
                                                                        return (
                                                                            <button
                                                                                key={url}
                                                                                className={`selector-tile ${tgtUrl === url ? 'selected' : ''}`}
                                                                                title={name}
                                                                                onClick={() => {
                                                                                    setEntityRemapTargets((prev) => ({ ...prev, [srcUrl]: url }));
                                                                                    setOpenEntitySelectorFor(null);
                                                                                }}
                                                                            >
                                                                                {thumb ? (
                                                                                    <img className="selector-icon" src={thumb} alt={name} style={{ imageRendering: 'auto' }} />
                                                                                ) : (
                                                                                    <span className="selector-icon selector-fallback" style={{ color: 'rgba(255,255,255,0.3)' }}>
                                                                                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
                                                                                    </span>
                                                                                )}
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })
                                    )}
                                </>
                            )}
                        </div>
                        <div className="axiom-remapper-actions">
                            <button className="btn-cancel" onClick={() => setShowGlobalRemapModal(false)}>Cancel</button>
                            <button
                                className="btn-confirm"
                                onClick={async () => {
                                    try {
                                        let hasBlockChanges = false;
                                        let hasEntityChanges = false;

                                        // ====== BLOCK REMAP ======
                                        const data = terrainBuilderRef?.current?.getCurrentTerrainData?.();
                                        const added: Record<string, number> = {};
                                        const removed: Record<string, number> = {};
                                        const rotAdded: Record<string, number> = {};
                                        const shpAdded: Record<string, string> = {};

                                        if (data) {
                                            const rotData = terrainBuilderRef?.current?.getCurrentRotationData?.() || {};
                                            const shpData = terrainBuilderRef?.current?.getCurrentShapeData?.() || {};

                                            for (const [posKey, id] of Object.entries(data as Record<string, number>)) {
                                                const srcId = id as number;
                                                let tgtId: number | null | undefined;

                                                if (breakdownByShape) {
                                                    // Breakdown mode: look up by combo key
                                                    const rot = rotData[posKey] || 0;
                                                    const shp = shpData[posKey] || 'cube';
                                                    const comboKey = `${srcId}:${rot}:${shp}`;
                                                    tgtId = breakdownRemapTargets[comboKey];
                                                    if (tgtId === undefined) tgtId = srcId; // no change
                                                } else {
                                                    // Standard mode: look up by block id
                                                    tgtId = globalRemapTargets[srcId];
                                                }

                                                if (tgtId === undefined || tgtId === srcId) continue;

                                                if (tgtId === null) {
                                                    removed[posKey] = srcId;
                                                } else {
                                                    added[posKey] = tgtId;
                                                    removed[posKey] = srcId;
                                                    // Preserve rotation and shape for swaps
                                                    const posRot = rotData[posKey];
                                                    const posShp = shpData[posKey];
                                                    if (posRot && posRot !== 0) rotAdded[posKey] = posRot;
                                                    if (posShp && posShp !== 'cube') shpAdded[posKey] = posShp;
                                                }
                                            }
                                        }

                                        hasBlockChanges = Object.keys(added).length > 0 || Object.keys(removed).length > 0;

                                        // ====== ENTITY REMAP ======
                                        const allEntities = environmentBuilderRef?.current?.getAllEnvironmentObjects?.() || [];

                                        // Collect existing instanceIds per target modelUrl (from non-remapped entities)
                                        const existingIdsByModel: Record<string, Set<number>> = {};
                                        for (const ent of allEntities) {
                                            const tgt = entityRemapTargets[ent.modelUrl];
                                            if (tgt === undefined || tgt === ent.modelUrl) {
                                                if (!existingIdsByModel[ent.modelUrl]) existingIdsByModel[ent.modelUrl] = new Set();
                                                existingIdsByModel[ent.modelUrl].add(ent.instanceId);
                                            }
                                        }
                                        const nextIdByModel: Record<string, number> = {};
                                        const getNextId = (modelUrl: string): number => {
                                            const existing = existingIdsByModel[modelUrl] || new Set<number>();
                                            let id = nextIdByModel[modelUrl] ?? 0;
                                            while (existing.has(id)) id++;
                                            nextIdByModel[modelUrl] = id + 1;
                                            existing.add(id);
                                            return id;
                                        };

                                        const targetEntities: any[] = [];
                                        for (const ent of allEntities) {
                                            const tgt = entityRemapTargets[ent.modelUrl];
                                            if (tgt === undefined || tgt === ent.modelUrl) {
                                                // No change
                                                targetEntities.push(ent);
                                            } else if (tgt === null) {
                                                // Remove - skip
                                                hasEntityChanges = true;
                                            } else {
                                                // Remap to different model
                                                hasEntityChanges = true;
                                                targetEntities.push({
                                                    ...ent,
                                                    modelUrl: tgt,
                                                    name: entityDisplayName(tgt),
                                                    instanceId: getNextId(tgt),
                                                });
                                            }
                                        }

                                        if (!hasBlockChanges && !hasEntityChanges) {
                                            setShowGlobalRemapModal(false);
                                            return;
                                        }

                                        // Apply block remap
                                        if (hasBlockChanges) {
                                            const uniqueBlockIds = new Set<number>();
                                            Object.values(added).forEach(blockId => {
                                                if (blockId && typeof blockId === 'number' && blockId > 0) {
                                                    uniqueBlockIds.add(blockId);
                                                }
                                            });

                                            // Preload textures
                                            try {
                                                const blockTypeRegistry = (window as any).BlockTypeRegistry;
                                                if (blockTypeRegistry?.instance) {
                                                    const preloadPromises = Array.from(uniqueBlockIds).map(async (blockId) => {
                                                        try {
                                                            await blockTypeRegistry.instance.preloadBlockTypeTextures(blockId);
                                                        } catch (_) { }
                                                    });
                                                    await Promise.allSettled(preloadPromises);
                                                }
                                            } catch (_) { }

                                            const rotationOpts = Object.keys(rotAdded).length > 0 ? { added: rotAdded } : undefined;
                                            const shapeOpts = Object.keys(shpAdded).length > 0 ? { added: shpAdded } : undefined;
                                            terrainBuilderRef?.current?.updateTerrainBlocks?.(added, removed, {
                                                syncPendingChanges: true,
                                                rotationData: rotationOpts,
                                                shapeData: shapeOpts,
                                            });
                                        }

                                        // Apply entity remap
                                        if (hasEntityChanges) {
                                            try {
                                                await environmentBuilderRef?.current?.updateEnvironmentToMatch?.(targetEntities);
                                                environmentBuilderRef?.current?.updateLocalStorage?.();
                                            } catch (err) {
                                                console.error("[GLOBAL_REMAP] Error applying entity remap:", err);
                                            }
                                        }

                                        setShowGlobalRemapModal(false);
                                    } catch (e) {
                                        console.error("[GLOBAL_REMAP] Error applying global remap:", e);
                                        alert("Failed to apply remap. See console for details.");
                                    }
                                }}
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Remove Hidden Blocks Confirmation Modal */}
            {showRemoveHiddenModal && (
                <div
                    className="modal-overlay"
                    onClick={(e) => handleModalOverlayClick(e, setShowRemoveHiddenModal)}
                >
                    <div className="modal-content" style={{ maxWidth: '480px', textAlign: 'left' }}>
                        <h3 className="modal-title" style={{ textAlign: 'center' }}>Remove Hidden Blocks</h3>
                        <p className="modal-description" style={{ textAlign: 'left' }}>
                            Remove blocks that are completely surrounded by other blocks and not visible.
                            This can help reduce map file size and improve performance.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px', marginBottom: '20px' }}>
                            <label style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '12px',
                                cursor: 'pointer',
                                padding: '10px 14px',
                                borderRadius: '8px',
                                backgroundColor: 'rgba(255,255,255,0.05)',
                                transition: 'background-color 0.2s'
                            }}>
                                <input
                                    type="checkbox"
                                    checked={removeHiddenOptions.includeLiquids}
                                    onChange={(e) => setRemoveHiddenOptions(prev => ({
                                        ...prev,
                                        includeLiquids: e.target.checked
                                    }))}
                                    style={{
                                        width: '18px',
                                        height: '18px',
                                        accentColor: '#4CAF50',
                                        cursor: 'pointer',
                                        marginTop: '2px',
                                        flexShrink: 0
                                    }}
                                />
                                <div style={{ textAlign: 'left' }}>
                                    <div style={{ fontWeight: 500, marginBottom: '2px' }}>Include liquid blocks</div>
                                    <div style={{ fontSize: '12px', opacity: 0.7, lineHeight: 1.4 }}>
                                        Also remove hidden water/lava blocks
                                    </div>
                                </div>
                            </label>

                            <label style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '12px',
                                cursor: 'pointer',
                                padding: '10px 14px',
                                borderRadius: '8px',
                                backgroundColor: 'rgba(255,255,255,0.05)',
                                transition: 'background-color 0.2s'
                            }}>
                                <input
                                    type="checkbox"
                                    checked={removeHiddenOptions.preserveNextToTransparent}
                                    onChange={(e) => setRemoveHiddenOptions(prev => ({
                                        ...prev,
                                        preserveNextToTransparent: e.target.checked
                                    }))}
                                    style={{
                                        width: '18px',
                                        height: '18px',
                                        accentColor: '#4CAF50',
                                        cursor: 'pointer',
                                        marginTop: '2px',
                                        flexShrink: 0
                                    }}
                                />
                                <div style={{ textAlign: 'left' }}>
                                    <div style={{ fontWeight: 500, marginBottom: '2px' }}>Preserve blocks near transparent</div>
                                    <div style={{ fontSize: '12px', opacity: 0.7, lineHeight: 1.4 }}>
                                        Keep blocks adjacent to glass or other transparent blocks
                                    </div>
                                </div>
                            </label>

                            <label style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '12px',
                                cursor: 'pointer',
                                padding: '10px 14px',
                                borderRadius: '8px',
                                backgroundColor: 'rgba(255,255,255,0.05)',
                                transition: 'background-color 0.2s'
                            }}>
                                <input
                                    type="checkbox"
                                    checked={removeHiddenOptions.preserveNextToLiquids}
                                    onChange={(e) => setRemoveHiddenOptions(prev => ({
                                        ...prev,
                                        preserveNextToLiquids: e.target.checked
                                    }))}
                                    style={{
                                        width: '18px',
                                        height: '18px',
                                        accentColor: '#4CAF50',
                                        cursor: 'pointer',
                                        marginTop: '2px',
                                        flexShrink: 0
                                    }}
                                />
                                <div style={{ textAlign: 'left' }}>
                                    <div style={{ fontWeight: 500, marginBottom: '2px' }}>Preserve blocks near liquids</div>
                                    <div style={{ fontSize: '12px', opacity: 0.7, lineHeight: 1.4 }}>
                                        Keep blocks adjacent to water or lava
                                    </div>
                                </div>
                            </label>
                        </div>

                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
                            <button
                                className="btn-cancel"
                                onClick={() => setShowRemoveHiddenModal(false)}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn-confirm"
                                onClick={() => {
                                    handleRemoveHiddenBlocks(removeHiddenOptions);
                                    setShowRemoveHiddenModal(false);
                                }}
                            >
                                Remove Hidden Blocks
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Export Options Modal */}
            <ModalContainer
                title="Export Options"
                isOpen={showExportModal}
                onClose={() => setShowExportModal(false)}
            >
                <p style={{ marginBottom: '16px', opacity: 0.8, fontSize: '14px' }}>
                    Choose whether to include default SDK assets in your export. Custom blocks and models are always included.
                </p>

                <div style={{
                    marginBottom: '20px',
                    padding: '10px 14px',
                    backgroundColor: 'rgba(99, 102, 241, 0.1)',
                    borderRadius: '8px',
                    border: '1px solid rgba(99, 102, 241, 0.2)',
                    fontSize: '13px',
                    opacity: 0.9
                }}>
                    💡 <strong>Tip:</strong> The SDK can access default assets and blocks without needing to export them.
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                    <label style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '12px',
                        cursor: 'pointer',
                        padding: '12px 16px',
                        borderRadius: '10px',
                        backgroundColor: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        transition: 'all 0.2s'
                    }}>
                        <input
                            type="checkbox"
                            checked={exportOptions.includeBlockTextures}
                            onChange={(e) => setExportOptions(prev => ({
                                ...prev,
                                includeBlockTextures: e.target.checked
                            }))}
                            style={{
                                width: '20px',
                                height: '20px',
                                accentColor: '#6366f1',
                                cursor: 'pointer',
                                marginTop: '2px',
                                flexShrink: 0
                            }}
                        />
                        <div style={{ textAlign: 'left' }}>
                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>Include Default Block Textures</div>
                            <div style={{ fontSize: '13px', opacity: 0.7, lineHeight: 1.5 }}>
                                Embed default block texture files in the ZIP. Custom blocks are always included.
                            </div>
                        </div>
                    </label>

                    <label style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '12px',
                        cursor: 'pointer',
                        padding: '12px 16px',
                        borderRadius: '10px',
                        backgroundColor: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        transition: 'all 0.2s'
                    }}>
                        <input
                            type="checkbox"
                            checked={exportOptions.includeModels}
                            onChange={(e) => setExportOptions(prev => ({
                                ...prev,
                                includeModels: e.target.checked
                            }))}
                            style={{
                                width: '20px',
                                height: '20px',
                                accentColor: '#6366f1',
                                cursor: 'pointer',
                                marginTop: '2px',
                                flexShrink: 0
                            }}
                        />
                        <div style={{ textAlign: 'left' }}>
                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>Include Default Model Files</div>
                            <div style={{ fontSize: '13px', opacity: 0.7, lineHeight: 1.5 }}>
                                Embed default 3D model files (.gltf) in the ZIP. Custom models are always included.
                            </div>
                        </div>
                    </label>

                    <label style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '12px',
                        cursor: 'pointer',
                        padding: '12px 16px',
                        borderRadius: '10px',
                        backgroundColor: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        transition: 'all 0.2s'
                    }}>
                        <input
                            type="checkbox"
                            checked={exportOptions.includeSkybox}
                            onChange={(e) => setExportOptions(prev => ({
                                ...prev,
                                includeSkybox: e.target.checked
                            }))}
                            style={{
                                width: '20px',
                                height: '20px',
                                accentColor: '#6366f1',
                                cursor: 'pointer',
                                marginTop: '2px',
                                flexShrink: 0
                            }}
                        />
                        <div style={{ textAlign: 'left' }}>
                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>Include Skybox Images</div>
                            <div style={{ fontSize: '13px', opacity: 0.7, lineHeight: 1.5 }}>
                                Embed skybox image files in the ZIP. Custom skyboxes are always included.
                            </div>
                        </div>
                    </label>
                </div>

                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                    <button
                        onClick={() => setShowExportModal(false)}
                        style={{
                            padding: '10px 20px',
                            borderRadius: '8px',
                            border: '1px solid rgba(255,255,255,0.2)',
                            backgroundColor: 'transparent',
                            color: '#cfd6e4',
                            cursor: 'pointer',
                            fontWeight: 500,
                            transition: 'all 0.2s'
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirmExport}
                        style={{
                            padding: '10px 24px',
                            borderRadius: '8px',
                            border: 'none',
                            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                            color: 'white',
                            cursor: 'pointer',
                            fontWeight: 600,
                            transition: 'all 0.2s',
                            boxShadow: '0 2px 8px rgba(99, 102, 241, 0.3)'
                        }}
                    >
                        Export Map
                    </button>
                </div>
            </ModalContainer>
        </>
    );
};
export default ToolBar;
