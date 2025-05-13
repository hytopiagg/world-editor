import { defaultTheme, Provider } from "@adobe/react-spectrum";
import { Canvas } from "@react-three/fiber";
import { saveAs } from "file-saver";
import JSZip from "jszip";
import { useCallback, useEffect, useRef, useState } from "react";
import { FaDatabase } from "react-icons/fa";
import "./css/App.css";
import "./css/output.css";
import { IS_UNDER_CONSTRUCTION, version } from "./js/Constants";
import EnvironmentBuilder, { environmentModels } from "./js/EnvironmentBuilder";
import TerrainBuilder from "./js/TerrainBuilder";
import AIAssistantPanel from "./js/components/AIAssistantPanel";
import { BlockToolOptions } from "./js/components/BlockToolOptions";
import BlockToolsSidebar, {
    ActiveTabType,
    refreshBlockTools,
} from "./js/components/BlockToolsSidebar";
import GlobalLoadingScreen from "./js/components/GlobalLoadingScreen";
import QuickTips from "./js/components/QuickTips";
import TextureGenerationModal from "./js/components/TextureGenerationModal";
import ToolBar from "./js/components/ToolBar";
import UnderConstruction from "./js/components/UnderConstruction";
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
import { createPlaceholderBlob, dataURLtoBlob } from "./js/utils/blobUtils";
import { getHytopiaBlocks } from "./js/utils/minecraft/BlockMapper";

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
    const [activeTab, setActiveTab] = useState<ActiveTabType>("blocks");
    const [pageIsLoaded, setPageIsLoaded] = useState(false);
    const [scene, setScene] = useState(null);
    const [totalEnvironmentObjects, setTotalEnvironmentObjects] = useState(0);
    const [gridSize, setGridSize] = useState(100);
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
    });
    const [isSaving, setIsSaving] = useState(false);
    const [isTextureModalOpen, setIsTextureModalOpen] = useState(false);

    // AI Assistant State
    const [currentSchematic, setCurrentSchematic] = useState(null);
    const [isAIAssistantVisible, setIsAIAssistantVisible] = useState(false);

    // Add new state variables for UI visibility
    const [showBlockSidebar, setShowBlockSidebar] = useState(true);
    const [showOptionsPanel, setShowOptionsPanel] = useState(true);
    const [showToolbar, setShowToolbar] = useState(true);

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
                            setActiveTab("models");
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
                src={"/assets/img/hytopia_logo_white.png"}
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

    const handleLoadAISchematic = useCallback((schematic) => {
        console.log("App: Loading AI schematic and activating tool", schematic);
        setCurrentSchematic(schematic);
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

            // Handle both data URIs and file paths
            if (dataUrl && dataUrl.startsWith('data:image')) {
                blob = dataURLtoBlob(dataUrl);
            } else if (dataUrl && (dataUrl.startsWith('./') || dataUrl.startsWith('/'))) {
                // For file paths, fetch the image
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
            const fileName = `${key.replace('+', 'positive_').replace('-', 'negative_')}.png`;
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
                const errorId = 0; // Air block ID
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
                {IS_UNDER_CONSTRUCTION && <UnderConstruction />}

                {!pageIsLoaded && <LoadingScreen />}

                <GlobalLoadingScreen />

                {pageIsLoaded && <QuickTips />}

                <UndoRedoManager
                    ref={undoRedoManagerRef}
                    terrainBuilderRef={terrainBuilderRef}
                    environmentBuilderRef={environmentBuilderRef}
                />

                {/* Block Tools Sidebar - Now conditionally rendered */}
                {showBlockSidebar && (
                    <BlockToolsSidebar
                        onOpenTextureModal={() => setIsTextureModalOpen(true)}
                        terrainBuilderRef={terrainBuilderRef}
                        activeTab={activeTab}
                        onLoadSchematicFromHistory={handleLoadAISchematic}
                        setActiveTab={setActiveTab}
                        setCurrentBlockType={setCurrentBlockType}
                        environmentBuilder={environmentBuilderRef.current}
                        onPlacementSettingsChange={setPlacementSettings}
                    />
                )}

                {/* Block Tool Options - Now conditionally rendered */}
                {showOptionsPanel && (
                    <BlockToolOptions
                        debugInfo={debugInfo}
                        totalBlocks={totalBlocks}
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
                        gridSize={gridSize}
                        setGridSize={setGridSize}
                        placementSettings={placementSettings}
                        onPlacementSettingsChange={setPlacementSettings}
                    />
                )}

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
                            pointerEvents: "none",
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
                        onTotalObjectsChange={setTotalEnvironmentObjects}
                        placementSize={placementSize}
                        previewPositionFromAppJS={currentPreviewPosition}
                        placementSettings={placementSettings}
                        undoRedoManager={undoRedoManagerRef}
                        terrainBuilderRef={terrainBuilderRef}
                    />
                </Canvas>

                {/* Toolbar - Now conditionally rendered */}
                {showToolbar && (
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
                        toggleAIAssistant={() => setIsAIAssistantVisible((v) => !v)}
                        isAIAssistantVisible={isAIAssistantVisible}
                        setIsSaving={setIsSaving}
                    />
                )}

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
