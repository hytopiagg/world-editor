import { defaultTheme, Provider } from "@adobe/react-spectrum";
import { Canvas } from "@react-three/fiber";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { FaCamera, FaDatabase, FaVolumeMute } from "react-icons/fa";
import "./css/App.css";
import { IS_UNDER_CONSTRUCTION, version } from "./js/Constants";
import { DatabaseManager, STORES } from "./js/managers/DatabaseManager";
import EnvironmentBuilder, { environmentModels } from "./js/EnvironmentBuilder";
import { isMuted, toggleMute } from "./js/Sound";
import TerrainBuilder, {
    blockTypes,
    getCustomBlocks,
} from "./js/TerrainBuilder";
import UndoRedoManager from "./js/managers/UndoRedoManager";
import AIAssistantPanel from "./js/components/AIAssistantPanel";
import BlockToolsSidebar, {
    refreshBlockTools,
} from "./js/components/BlockToolsSidebar";
import DebugInfo from "./js/components/DebugInfo";
import GlobalLoadingScreen from "./js/components/GlobalLoadingScreen";
import QuickTips from "./js/components/QuickTips";
import TextureGenerationModal from "./js/components/TextureGenerationModal";
import ToolBar from "./js/components/ToolBar";
import Tooltip from "./js/components/Tooltip";
import UnderConstruction from "./js/components/UnderConstruction";
import { processCustomBlock } from "./js/managers/BlockTypesManager";
import { getHytopiaBlocks } from "./js/utils/minecraft/BlockMapper";
import { loadingManager } from "./js/managers/LoadingManager";
function App() {
    const undoRedoManagerRef = useRef(null);
    const [currentBlockType, setCurrentBlockType] = useState(blockTypes[0]);
    const [mode, setMode] = useState("add");
    const [debugInfo, setDebugInfo] = useState({
        mouse: {},
        preview: {},
        grid: {},
    });
    const [totalBlocks, setTotalBlocks] = useState(0);
    const [axisLockEnabled, setAxisLockEnabled] = useState(false);
    const [cameraReset, setCameraReset] = useState(false);
    const [cameraAngle, setCameraAngle] = useState(0);
    const [placementSize, setPlacementSize] = useState("single");
    const [activeTab, setActiveTab] = useState("blocks");
    const [pageIsLoaded, setPageIsLoaded] = useState(false);
    const [scene, setScene] = useState(null);
    const [totalEnvironmentObjects, setTotalEnvironmentObjects] = useState(0);
    const [gridSize, setGridSize] = useState(100);
    const [currentPreviewPosition, setCurrentPreviewPosition] = useState(null);
    const environmentBuilderRef = useRef(null);
    const blockToolsRef = useRef(null);
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
    });
    const [isSaving, setIsSaving] = useState(false);
    const [isTextureModalOpen, setIsTextureModalOpen] = useState(false);

    // AI Assistant State
    const [currentSchematic, setCurrentSchematic] = useState(null);
    const [isAIAssistantVisible, setIsAIAssistantVisible] = useState(false);

    useEffect(() => {
        const loadSavedToolSelection = () => {
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
                            setActiveTab("environment");
                        }
                    }
                }
            }
        };

        if (!pageIsLoaded) {
            loadingManager.showLoading();
        }

        if (pageIsLoaded) {
            loadSavedToolSelection();
        }
    }, [pageIsLoaded]);

    // Add Ctrl+S hotkey for saving
    useEffect(() => {
        const handleKeyDown = async (e) => {
            // Check for Ctrl+S (or Cmd+S on Mac)
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault(); // Prevent browser's save dialog

                // Set saving state directly for immediate feedback
                setIsSaving(true);

                try {
                    if (terrainBuilderRef.current) {
                        await terrainBuilderRef.current.saveTerrainManually();
                    }

                    if (environmentBuilderRef.current) {
                        await environmentBuilderRef.current.updateLocalStorage();
                    }
                } finally {
                    setIsSaving(false);
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    // Log undoRedoManager initialization and updates
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

    // Add useEffect to load grid size from IndexedDB
    useEffect(() => {
        const loadGridSize = async () => {
            try {
                const savedGridSize = await DatabaseManager.getData(
                    STORES.SETTINGS,
                    "gridSize"
                );
                if (savedGridSize) {
                    setGridSize(+savedGridSize);
                }
            } catch (error) {
                console.error("Error loading grid size from IndexedDB:", error);
            }
        };
        loadGridSize();
    }, []);

    useEffect(() => {
        DatabaseManager.clearStore(STORES.UNDO);
        DatabaseManager.clearStore(STORES.REDO);
    }, []);

    const LoadingScreen = () => (
        <div className="loading-screen">
            <img
                src={'/assets/img/hytopia_logo_white.png'}
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

    // Callback for when the modal finishes editing/generating
    const handleTextureReady = async (faceTextures, textureName) => {
        console.log(
            "Texture ready:",
            textureName,
            "Face Count:",
            Object.keys(faceTextures).length
        );
        try {
            // Map face names to coordinate system keys
            const faceMap = {
                top: "+y",
                bottom: "-y",
                left: "-x",
                right: "+x",
                front: "+z",
                back: "-z",
            };

            // Prepare the block data for processCustomBlock
            const newBlockData = {
                name:
                    textureName
                        .replace(/[^a-zA-Z0-9_\-\s]/g, "")
                        .replace(/\s+/g, "_") || "custom_texture",
                // Use 'all' or fallback to 'top' if 'all' is missing but others exist
                textureUri: faceTextures.all || faceTextures.top || null,
                sideTextures: {},
                isCustom: true,
                isMultiTexture: false,
            };

            // Populate sideTextures using the mapped keys, excluding 'all'
            let hasSpecificFaces = false;
            for (const face in faceTextures) {
                if (face !== "all" && faceTextures[face] && faceMap[face]) {
                    const coordinateKey = faceMap[face];
                    newBlockData.sideTextures[coordinateKey] =
                        faceTextures[face];
                    hasSpecificFaces = true;
                }
            }

            // If only 'all' texture was provided, but we expect multi-texture, copy 'all' to '+y'
            // This helps with previews if the modal only returned an 'all' texture.
            if (!hasSpecificFaces && faceTextures.all) {
                newBlockData.sideTextures["+y"] = faceTextures.all;
                // Technically not multi-texture, but lets BlockButton preview work
                // isMultiTexture will be false based on hasSpecificFaces below.
            } else if (
                hasSpecificFaces &&
                !newBlockData.sideTextures["+y"] &&
                newBlockData.textureUri
            ) {
                // If we have specific faces but somehow miss +y, use the main textureUri as +y fallback for preview
                newBlockData.sideTextures["+y"] = newBlockData.textureUri;
            }

            // Set isMultiTexture based only on whether specific faces (top, bottom, etc.) were provided
            newBlockData.isMultiTexture = hasSpecificFaces;

            // Fallback textureUri if 'all' and 'top' were missing
            if (!newBlockData.textureUri && hasSpecificFaces) {
                newBlockData.textureUri = newBlockData.sideTextures["+y"]; // Use top as the main URI
            }

            console.log("Processing block data:", newBlockData);

            // Process the new texture as a custom block
            await processCustomBlock(newBlockData);
            console.log("Custom block processed:", newBlockData.name);

            // Save updated custom blocks to DB
            try {
                const updatedCustomBlocks = getCustomBlocks(); // Get the latest list including the new one
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

            // Refresh the block tools sidebar to show the new block
            refreshBlockTools();
        } catch (error) {
            console.error("Error processing generated texture:", error);
            // Show an error message to the user?
        }
    };

    // Callback to get available blocks for AI Panel
    const handleGetAvailableBlocks = useCallback(() => {
        try {
            return getHytopiaBlocks();
        } catch (error) {
            console.error("Error getting Hytopia blocks:", error);
            return []; // Return empty array on error
        }
    }, []);

    // Callback to load schematic data and activate the placement tool
    const handleLoadAISchematic = useCallback((schematic) => {
        console.log("App: Loading AI schematic and activating tool", schematic);
        setCurrentSchematic(schematic); // Store schematic data
        // Activate the tool via TerrainBuilder's ref
        terrainBuilderRef.current?.activateTool("schematic", schematic);
    }, []);

    return (
        <Provider theme={defaultTheme}>
            <div className="App">
                {IS_UNDER_CONSTRUCTION && <UnderConstruction />}

                {/* Loading Screen */}
                {!pageIsLoaded && <LoadingScreen />}

                {/* Global Loading Screen for heavy operations */}
                <GlobalLoadingScreen />

                {/* Hytopia Logo */}
                <div className="hytopia-logo-wrapper">
                    <img src={'/assets/img/hytopia_logo_white.png'} alt="Hytopia Logo" />
                    <p className="hytopia-version-text">
                        World Editor Version {version}
                    </p>
                </div>

                {pageIsLoaded && <QuickTips />}

                <UndoRedoManager
                    ref={undoRedoManagerRef}
                    terrainBuilderRef={terrainBuilderRef}
                    environmentBuilderRef={environmentBuilderRef}
                />

                <BlockToolsSidebar
                    onOpenTextureModal={() => setIsTextureModalOpen(true)}
                    terrainBuilderRef={terrainBuilderRef}
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                    setCurrentBlockType={setCurrentBlockType}
                    environmentBuilder={environmentBuilderRef.current}
                    onPlacementSettingsChange={setPlacementSettings}
                />

                {/* Texture Generation Modal */}
                <TextureGenerationModal
                    isOpen={isTextureModalOpen}
                    onClose={() => setIsTextureModalOpen(false)}
                    onTextureReady={handleTextureReady}
                />

                {/* AI Assistant Panel */}
                <AIAssistantPanel
                    isVisible={isAIAssistantVisible}
                    getAvailableBlocks={handleGetAvailableBlocks}
                    loadAISchematic={handleLoadAISchematic}
                />

                <div className="vignette-gradient"></div>

                {/* Saving indicator */}
                {isSaving && (
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
                            pointerEvents: "none", // Ensure it doesn't interfere with clicks
                        }}
                    >
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
                    </div>
                )}

                <Canvas shadows className="canvas-container">
                    <TerrainBuilder
                        isInputDisabled={isTextureModalOpen}
                        ref={terrainBuilderRef}
                        currentBlockType={currentBlockType}
                        mode={mode}
                        setDebugInfo={setDebugInfo}
                        sendTotalBlocks={setTotalBlocks}
                        axisLockEnabled={axisLockEnabled}
                        placementSize={placementSize}
                        cameraReset={cameraReset}
                        cameraAngle={cameraAngle}
                        setPageIsLoaded={setPageIsLoaded}
                        onSceneReady={(sceneObject) => setScene(sceneObject)}
                        gridSize={gridSize}
                        environmentBuilderRef={environmentBuilderRef}
                        previewPositionToAppJS={setCurrentPreviewPosition}
                        undoRedoManager={undoRedoManagerRef}
                        customBlocks={getCustomBlocks()}
                    />
                    <EnvironmentBuilder
                        ref={environmentBuilderRef}
                        scene={scene}
                        currentBlockType={currentBlockType}
                        mode={mode}
                        onTotalObjectsChange={setTotalEnvironmentObjects}
                        placementSize={placementSize}
                        previewPositionFromAppJS={currentPreviewPosition}
                        placementSettings={placementSettings}
                        undoRedoManager={undoRedoManagerRef}
                    />
                </Canvas>

                <DebugInfo
                    debugInfo={debugInfo}
                    totalBlocks={totalBlocks}
                    totalEnvironmentObjects={totalEnvironmentObjects}
                    terrainBuilderRef={terrainBuilderRef}
                />

                <ToolBar
                    terrainBuilderRef={terrainBuilderRef}
                    environmentBuilderRef={environmentBuilderRef}
                    mode={mode}
                    handleModeChange={setMode}
                    axisLockEnabled={axisLockEnabled}
                    setAxisLockEnabled={setAxisLockEnabled}
                    placementSize={placementSize}
                    setPlacementSize={setPlacementSize}
                    setGridSize={setGridSize}
                    undoRedoManager={undoRedoManagerRef}
                    currentBlockType={currentBlockType}
                    toggleAIAssistant={() => setIsAIAssistantVisible((v) => !v)}
                    isAIAssistantVisible={isAIAssistantVisible}
                    setIsSaving={setIsSaving}
                />

                <div className="camera-controls-wrapper">
                    <div className="camera-buttons">
                        <Tooltip text="Reset camera position">
                            <button
                                onClick={() => setCameraReset((prev) => !prev)}
                                className="camera-control-button"
                            >
                                <FaCamera />
                            </button>
                        </Tooltip>
                        <Tooltip text={isMuted ? "Unmute" : "Mute"}>
                            <button
                                onClick={toggleMute}
                                className={`camera-control-button ${!isMuted ? "active" : ""
                                    }`}
                            >
                                <FaVolumeMute />
                            </button>
                        </Tooltip>
                    </div>
                </div>

                <button
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
                </button>
            </div>
        </Provider>
    );
}

export default App;
