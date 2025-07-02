import { useEffect, useState } from "react";
import {
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
    FaWrench
} from "react-icons/fa";
import "../../css/ToolBar.css";
import { DISABLE_ASSET_PACK_IMPORT_EXPORT } from "../Constants";
import { exportMapFile, importMap } from "../ImportExport";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";
import MinecraftImportWizard from "./MinecraftImportWizard";
import Tooltip from "./Tooltip";

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
}) => {
    const [showDimensionsModal, setShowDimensionsModal] = useState(false);
    const [showImportExportMenu, setShowImportExportMenu] = useState(false);
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
    const [showAISubmenu, setShowAISubmenu] = useState(false);
    const [showUtilsSubmenu, setShowUtilsSubmenu] = useState(false);
    const [showSwapSubmenu, setShowSwapSubmenu] = useState(false);
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
    const [showPlacementMenu, setShowPlacementMenu] = useState(false);

    const [waitingForMouseCycle, setWaitingForMouseCycle] = useState(false);

    const [showMinecraftImportModal, setShowMinecraftImportModal] =
        useState(false);
    let startPos = {
        x: 0,
        y: 0,
        z: 0,
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
        try {
            exportMapFile(terrainBuilderRef, environmentBuilderRef);
        } catch (error) {
            console.error("Error exporting map:", error);
            alert("Error exporting map. Please try again.");
        }
    };

    const handleRemoveHiddenBlocks = () => {
        if (!terrainBuilderRef?.current?.getCurrentTerrainData) {
            console.error("TerrainBuilder reference not available for removing hidden blocks");
            return;
        }

        const terrainData = terrainBuilderRef.current.getCurrentTerrainData();
        if (!terrainData) return;

        const originalCount = Object.keys(terrainData).length;
        const removedBlocks = {};

        for (const key in terrainData) {
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
            for (const nKey of neighborKeys) {
                if (!(nKey in terrainData)) {
                    isHidden = false;
                    break;
                }
            }

            if (isHidden) {
                removedBlocks[key] = terrainData[key];
            }
        }

        const removedCount = Object.keys(removedBlocks).length;

        if (removedCount === 0) {
            alert("No hidden blocks found to remove.");
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
        const checkUndoRedoAvailability = async () => {
            const undoStates =
                (await DatabaseManager.getData(STORES.UNDO, "states")) as any[] || [];
            const redoStates =
                (await DatabaseManager.getData(STORES.REDO, "states")) as any[] || [];
            setCanUndo(undoStates.length > 0);
            setCanRedo(redoStates.length > 0);
        };
        checkUndoRedoAvailability();

        const interval = setInterval(checkUndoRedoAvailability, 1000);
        return () => clearInterval(interval);
    }, []);

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
                })
                .catch((error) => {
                    event.target.value = "";
                    console.error("Error during import:", error);
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
            setShowPlacementMenu(false);
            setShowSwapSubmenu(false);
        };
        window.addEventListener("blockToolsTabChanged", handleTabChangeReset);
        window.addEventListener("pointerLockModeChanged", handleTabChangeReset);
        return () => {
            window.removeEventListener("blockToolsTabChanged", handleTabChangeReset);
            window.removeEventListener("pointerLockModeChanged", handleTabChangeReset);
        };
    }, []);

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
                                className={`control-button ${axisLockEnabled ? "selected" : ""
                                    }`}
                            >
                                {axisLockEnabled ? <FaLock /> : <FaLockOpen />}
                            </button>
                        </Tooltip> */}
                        <Tooltip text="Undo (Ctrl+Z)">
                            <button
                                onClick={() =>
                                    undoRedoManager?.current?.handleUndo()
                                }
                                className={`control-button ${!canUndo ? "disabled" : ""
                                    }`}
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
                                className={`control-button ${!canRedo ? "disabled" : ""
                                    }`}
                                disabled={!canRedo}
                            >
                                <FaRedo className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                            </button>
                        </Tooltip>
                        <div className="control-divider-vertical"></div>
                        <Tooltip text="Placement Size / Shape" hideTooltip={showPlacementMenu || waitingForMouseCycle}>
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
                                    className={`relative control-button active:translate-y-[1px] group transition-all ${showPlacementMenu ? 'selected' : ''}`}
                                    onClick={(e) => {
                                        const el = e.target as HTMLElement;
                                        if (el && el.className && el.className.toString().includes("control-button") && showPlacementMenu) {
                                            setShowPlacementMenu(false);
                                            setWaitingForMouseCycle(true);
                                        } else {
                                            setShowPlacementMenu(!showPlacementMenu);
                                        }
                                    }}
                                >
                                    <FaThLarge className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                                </button>

                                {showPlacementMenu && (
                                    <div className="absolute -top-12 h-full flex w-fit items-center gap-x-1 justify-center -translate-x-1/2 left-1/2">
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
                                                        setShowPlacementMenu(false);
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
                            <Tooltip text="Swapping Tools" hideTooltip={showSwapSubmenu}>
                                <button
                                    className={`relative control-button active:translate-y-[1px] group transition-all ${showSwapSubmenu ? 'selected' : ''}`}
                                    onClick={() => setShowSwapSubmenu(!showSwapSubmenu)}
                                >
                                    <FaExchangeAlt className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                                </button>
                            </Tooltip>

                            {showSwapSubmenu && (
                                <div className="absolute -top-12 h-full flex w-fit items-center gap-x-1 justify-center -translate-x-1/2 left-1/2">
                                    <Tooltip text="Paint Terrain">
                                        <button
                                            className={`w-fit flex items-center justify-center bg-black/60 text-[#F1F1F1] rounded-md px-2 py-1 border border-white/0 hover:border-white transition-opacity duration-200 cursor-pointer opacity-0 fade-up ${activeTool === 'replace' ? 'bg-white/90 text-black' : ''}`}
                                            style={{ animationDelay: '0.05s' }}
                                            onClick={() => {
                                                handleToolToggle('replace');
                                                setPlacementSize("single");
                                                setShowSwapSubmenu(false);
                                            }}
                                        >
                                            <svg width="20" height="22" viewBox="0 0 26 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path d="M4.19196 12.3389C3.21046 13.2979 3.26696 14.5764 4.31696 15.6149L6.55446 17.8749C5.39046 18.6169 3.14196 19.5299 2.06896 20.6034C0.390963 22.2814 0.402463 24.5414 2.11396 26.2649C3.83796 27.9769 6.09796 27.9999 7.77596 26.3219C8.86046 25.2374 9.76196 22.9889 10.504 21.8359L12.787 24.0849C13.826 25.1119 15.093 25.1689 16.063 24.1989L17.2845 22.9434C18.0605 22.1444 18.186 21.1624 17.627 20.2609C18.129 20.1354 18.597 19.8499 18.962 19.4734L24.27 14.1424C25.537 12.8874 25.503 11.3919 24.19 10.0789L15.002 0.890446C14.1795 0.0799465 13.0615 -5.3525e-05 12.2965 0.764946C11.954 1.10695 11.6915 1.59795 11.5545 2.25995C10.938 5.09095 9.69346 7.72745 8.23246 9.58845C7.98146 9.91945 7.81046 10.2384 7.73046 10.5699C6.94296 10.2499 6.12046 10.4214 5.43596 11.0949L4.19196 12.3389ZM17.3645 18.5259C16.8845 18.9939 16.4395 18.9594 15.9605 18.4689H15.949L9.80796 12.3274L9.81946 12.3164C9.37446 11.8824 9.16846 11.4029 9.80796 10.4784C11.132 8.57245 12.4445 5.95845 13.221 3.04745C13.2665 2.91095 13.3235 2.79645 13.426 2.69395C13.609 2.49995 13.86 2.44245 14.111 2.70495L19.6585 8.24145C19.362 10.1474 17.8435 12.0424 16.6795 13.2064C16.5655 13.3209 16.417 13.4804 16.5995 13.6634C17.1705 14.2339 20.5945 11.7799 21.9875 10.5814L22.7975 11.3804C23.3455 11.9284 23.357 12.5219 22.866 13.0124L17.3645 18.5259ZM5.73296 13.4234L6.52046 12.6474C6.87446 12.3049 7.34246 12.2934 7.70746 12.6699L15.721 20.6949C16.075 21.0714 16.086 21.5049 15.7325 21.8589L14.979 22.6464C14.614 23.0114 14.1575 23.0004 13.792 22.6239L10.9155 19.7589C10.516 19.3479 10.0595 19.5074 9.64846 20.0439C8.81546 21.2309 7.41146 24.2219 6.57846 25.0439C5.59646 26.0024 4.29496 26.0249 3.32496 25.0549C2.35496 24.0849 2.36596 22.7719 3.33646 21.8019C4.15796 20.9799 7.14846 19.5644 8.34746 18.7314C8.87246 18.3204 9.04346 17.8639 8.62096 17.4644L5.75596 14.6104C5.39096 14.2569 5.37946 13.7774 5.73346 13.4234M4.08946 24.3014C4.46646 24.6664 5.01446 24.6664 5.37946 24.3014C5.74446 23.9134 5.73346 23.3769 5.37946 23.0114C5.00296 22.6464 4.44346 22.6349 4.08946 23.0114C3.74746 23.3999 3.72446 23.9249 4.08946 24.3014Z" fill="currentColor" />
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
                        <Tooltip text="Import Minecraft Map">
                            <button
                                onClick={() =>
                                    setShowMinecraftImportModal(true)
                                }
                                className="control-button"
                            >
                                <FaCubes />
                            </button>
                        </Tooltip>
                        <div className="relative">
                            <Tooltip text="AI Tools" hideTooltip={showAISubmenu}>
                                <button
                                    className={`relative control-button active:translate-y-[1px] group transition-all ${showAISubmenu || isAIComponentsActive ? 'selected' : ''}`}
                                    onClick={() => setShowAISubmenu(!showAISubmenu)}
                                >
                                    <FaRobot className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                                </button>
                            </Tooltip>

                            {showAISubmenu && (
                                <div className="absolute -top-12 h-full flex w-fit items-center gap-x-1 justify-center -translate-x-1/2 left-1/2">
                                    <button
                                        className="w-fit flex items-center justify-center bg-black/60 text-[#F1F1F1] rounded-md px-2 py-1 border border-white/0 hover:border-white transition-opacity duration-200 cursor-pointer opacity-0 fade-up"
                                        style={{ animationDelay: '0.05s' }}
                                        onClick={() => {
                                            onOpenTextureModal && onOpenTextureModal();
                                            setShowAISubmenu(false);
                                        }}
                                    >
                                        {"Textures"}
                                    </button>
                                    <button
                                        className="w-fit flex items-center justify-center bg-black/50 text-[#F1F1F1] rounded-md px-2 py-1 border border-white/0 hover:border-white transition-opacity duration-200 cursor-pointer opacity-0 fade-up"
                                        style={{ animationDelay: '0.1s' }}
                                        onClick={() => {
                                            toggleAIComponents && toggleAIComponents();
                                            setShowAISubmenu(false);
                                        }}
                                    >
                                        {"Components"}
                                    </button>
                                </div>
                            )}
                        </div>
                        {/* Utils / Tools submenu */}
                        <div className="relative">
                            <Tooltip text="Tools" hideTooltip={showUtilsSubmenu}>
                                <button
                                    className={`relative control-button active:translate-y-[1px] group transition-all ${showUtilsSubmenu ? 'selected' : ''}`}
                                    onClick={() => setShowUtilsSubmenu(!showUtilsSubmenu)}
                                >
                                    <FaWrench className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                                </button>
                            </Tooltip>

                            {showUtilsSubmenu && (
                                <div className="absolute -top-12 h-full flex w-fit items-center gap-x-1 justify-center -translate-x-1/2 left-1/2">
                                    <button
                                        className="w-fit flex items-center whitespace-nowrap justify-center bg-black/60 text-[#F1F1F1] rounded-md px-2 py-1 border border-white/0 hover:border-white transition-opacity duration-200 cursor-pointer opacity-0 fade-up"
                                        style={{ animationDelay: '0.05s' }}
                                        onClick={() => {
                                            handleRemoveHiddenBlocks();
                                            setShowUtilsSubmenu(false);
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
                        <div className="relative">
                            <Tooltip text="Import / Export Map" hideTooltip={showImportExportMenu}>
                                <button
                                    className={`relative control-button active:translate-y-[1px] group transition-all ${showImportExportMenu ? 'selected' : ''}`}
                                    onClick={() => setShowImportExportMenu(!showImportExportMenu)}
                                >
                                    <FaCloud className="text-[#F1F1F1] group-hover:scale-[1.02] transition-all" />
                                </button>
                            </Tooltip>

                            {showImportExportMenu && <div className={`absolute -top-12 h-full flex w-fit items-center gap-x-1 justify-center -translate-x-1/2 left-1/2`}>
                                <input
                                    id="mapFileInput"
                                    type="file"
                                    accept=".json,.zip"
                                    onChange={onMapFileSelected}
                                    style={{ display: "none" }}
                                />
                                <button
                                    className={`w-fit flex items-center justify-center bg-black/60 text-[#F1F1F1] rounded-md px-2 py-1 border border-white/0 hover:border-white transition-opacity duration-200 cursor-pointer opacity-0 fade-up`}
                                    onClick={() => document.getElementById("mapFileInput").click()}
                                    style={{ animationDelay: '0.1s' }}
                                >
                                    {"Import"}
                                </button>
                                <button
                                    className={`w-fit flex items-center justify-center bg-black/50 text-[#F1F1F1] rounded-md px-2 py-1 border border-white/0 hover:border-white transition-opacity duration-200 cursor-pointer opacity-0 fade-up`}
                                    onClick={handleExportMap}
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
            {showMinecraftImportModal && (
                <MinecraftImportWizard
                    isOpen={showMinecraftImportModal}
                    onClose={() => setShowMinecraftImportModal(false)}
                    onComplete={(result) => {
                        if (result && result.success) {
                            console.log(
                                "Minecraft map imported successfully:",
                                result
                            );
                        }
                        setShowMinecraftImportModal(false);
                    }}
                    terrainBuilderRef={terrainBuilderRef}
                />
            )}
        </>
    );
};
export default ToolBar;
