import { defaultTheme, Provider } from "@adobe/react-spectrum";
import { Canvas } from "@react-three/fiber";
import { saveAs } from "file-saver";
import JSZip from "jszip";
import { useCallback, useEffect, useRef, useState } from "react";
import "./css/App.css";
import "./css/output.css";
import { cameraManager } from "./js/Camera";
import { IS_UNDER_CONSTRUCTION, version } from "./js/Constants";
import EnvironmentBuilder, { environmentModels } from "./js/EnvironmentBuilder";
import TerrainBuilder from "./js/TerrainBuilder";
import { BlockToolOptions } from "./js/components/BlockToolOptions";
import BlockToolsSidebar, {
    refreshBlockTools,
} from "./js/components/BlockToolsSidebar";
import GlobalLoadingScreen from "./js/components/GlobalLoadingScreen";
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
    const cameraAngle = 0;
    const gridSize = 5000;

    useEffect(() => {
        if (terrainBuilderRef.current) {
            terrainBuilderRef.current.updateGridSize(gridSize);
        }
    }, [gridSize, terrainBuilderRef.current?.updateGridSize]);

    useEffect(() => {
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

        if (!pageIsLoaded) {
            loadingManager.showLoading();
        }

        if (pageIsLoaded) {
            loadAppSettings();
        }
    }, [pageIsLoaded]);

    useEffect(() => {
        const handleKeyDown = async (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();

                setSaveStatus('saving');

                try {
                    if (terrainBuilderRef.current) {
                        await terrainBuilderRef.current.saveTerrainManually();
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
        DatabaseManager.clearStore(STORES.UNDO);
        DatabaseManager.clearStore(STORES.REDO);
    }, []);

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
                {IS_UNDER_CONSTRUCTION && <UnderConstruction />}

                {!pageIsLoaded && <LoadingScreen />}

                <GlobalLoadingScreen />

                {/* QuickTips removed per UX update */}

                <UndoRedoManager
                    ref={undoRedoManagerRef}
                    terrainBuilderRef={terrainBuilderRef}
                    environmentBuilderRef={environmentBuilderRef}
                />

                {showBlockSidebar && (
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

                {showOptionsPanel && (
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

                <TextureGenerationModal
                    isOpen={isTextureModalOpen}
                    onClose={() => setIsTextureModalOpen(false)}
                    onTextureReady={handleTextureReady}
                />

                <div className="vignette-gradient"></div>

                {saveStatus !== 'idle' && (
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

                <Canvas shadows className="canvas-container">
                    <TerrainBuilder
                        isInputDisabled={isTextureModalOpen}
                        ref={terrainBuilderRef}
                        currentBlockType={currentBlockType}
                        mode={mode}
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
                        snapToGrid={placementSettings.snapToGrid}
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
                        onOpenTextureModal={() => setIsTextureModalOpen(true)}
                        toggleAIComponents={() => setIsAIComponentsActive((v) => !v)}
                        isAIComponentsActive={isAIComponentsActive}
                        setIsSaving={setSaveStatus}
                        activeTab={activeTab}
                    />
                )}

                {/* Crosshair visible while pointer is locked */}
                {showCrosshair && !cameraManager.isPointerUnlockedMode && (
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
