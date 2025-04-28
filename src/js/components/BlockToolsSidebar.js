import React, { useState, useEffect } from "react";
import BlockButton from "./BlockButton";
import EnvironmentButton from "./EnvironmentButton";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";
import { environmentModels } from "../EnvironmentBuilder";
import {
    blockTypes,
    processCustomBlock,
    batchProcessCustomBlocks,
    getCustomBlocks,
    removeCustomBlock,
    getBlockTypes,
} from "../managers/BlockTypesManager";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import "../../css/BlockToolsSidebar.css";
import ModelPreview from "./ModelPreview";
const SCALE_MIN = 0.1;
const SCALE_MAX = 5.0;
const ROTATION_MIN = 0;
const ROTATION_MAX = 360;
let selectedBlockID = 0;
export const refreshBlockTools = () => {
    const event = new CustomEvent("refreshBlockTools");
    window.dispatchEvent(event);
};

if (typeof window !== "undefined") {
    window.refreshBlockTools = refreshBlockTools;
}

const dataURLtoBlob = (dataurl) => {
    if (!dataurl || !dataurl.startsWith("data:image")) return null;
    try {
        const arr = dataurl.split(",");
        const mimeMatch = arr[0].match(/:(.*?);/);
        if (!mimeMatch) return null;
        const mime = mimeMatch[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
    } catch (e) {
        console.error("Error converting data URL to Blob:", e);
        return null;
    }
};

const createPlaceholderBlob = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 16; // Or your default texture size
    canvas.height = 16;
    const ctx = canvas.getContext("2d");
    if (ctx) {
        ctx.fillStyle = "#FF00FF"; // Magenta
        ctx.fillRect(0, 0, 16, 16);



        return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    }
    return Promise.resolve(null); // Fallback
};
const firstDefaultModel = environmentModels.find((m) => !m.isCustom);
const initialPreviewUrl = firstDefaultModel?.modelUrl ?? null;
const BlockToolsSidebar = ({
    activeTab,
    terrainBuilderRef,
    setActiveTab,
    setCurrentBlockType,
    environmentBuilder,
    onPlacementSettingsChange,
    onOpenTextureModal,
}) => {
    const [settings, setSettings] = useState({
        randomScale: false,
        randomRotation: false,
        minScale: 0.5,
        maxScale: 1.5,
        minRotation: 0,
        maxRotation: 360,
        scale: 1.0,
        rotation: 0,
    });
    const [customBlocks, setCustomBlocks] = useState([]);
    const [previewModelUrl, setPreviewModelUrl] = useState(initialPreviewUrl);

    useEffect(() => {

        if (activeTab === "environment" && initialPreviewUrl) {
            const model = environmentModels.find(
                (m) => m.modelUrl === initialPreviewUrl
            );
            if (model) {



                selectedBlockID = model.id;
                setCurrentBlockType({
                    ...model,
                    isEnvironment: true,
                });
                console.log(
                    "Initial environment model auto-selected:",
                    model.name
                );


            }
        }


    }, []); // Run once on mount
    useEffect(() => {
        const handleRefresh = () => {
            console.log("Handling refresh event in BlockToolsSidebar");
            try {
                const customBlocksData = getCustomBlocks();
                console.log("Custom blocks loaded:", customBlocksData);
                setCustomBlocks(customBlocksData);
            } catch (error) {
                console.error("Error refreshing custom blocks:", error);
            }
        };

        const handleCustomBlocksUpdated = (event) => {
            console.log(
                "Custom blocks updated from Minecraft importer:",
                event.detail?.blocks
            );
            handleRefresh();
        };

        handleRefresh();

        window.addEventListener("refreshBlockTools", handleRefresh);
        window.addEventListener("custom-blocks-loaded", handleRefresh);
        window.addEventListener(
            "custom-blocks-updated",
            handleCustomBlocksUpdated
        );
        window.addEventListener("textureAtlasUpdated", handleRefresh);
        return () => {
            window.removeEventListener("refreshBlockTools", handleRefresh);
            window.removeEventListener("custom-blocks-loaded", handleRefresh);
            window.removeEventListener(
                "custom-blocks-updated",
                handleCustomBlocksUpdated
            );
            window.removeEventListener("textureAtlasUpdated", handleRefresh);
        };
    }, []);
    const updateSettings = (updates) => {
        const newSettings = { ...settings, ...updates };
        setSettings(newSettings);

        onPlacementSettingsChange?.(newSettings);
    };
    const handleDragStart = (blockId) => {
        console.log("Drag started with block:", blockId);
    };

    const handleDownloadBlock = async (blockType) => {
        if (!blockType || !blockType.isCustom) return;
        const zip = new JSZip();
        const faceKeys = ["+x", "-x", "+y", "-y", "+z", "-z"];
        const textures = blockType.sideTextures || {};
        const mainTexture = blockType.textureUri;
        console.log("Preparing download for:", blockType.name);
        console.log("Main Texture URI:", mainTexture);
        console.log("Side Textures:", textures);
        let hasError = false;
        for (const key of faceKeys) {
            const textureDataUrl = textures[key] || mainTexture; // Use side texture or fall back to main
            let blob = dataURLtoBlob(textureDataUrl);
            if (!blob) {
                console.warn(
                    `Missing or invalid texture data for face ${key} in block ${blockType.name}. Using placeholder.`
                );
                blob = await createPlaceholderBlob();
                if (!blob) {
                    console.error(
                        `Failed to create placeholder for face ${key}. Skipping this face.`
                    );
                    hasError = true;
                    continue; // Skip adding this file if placeholder fails
                }
            }
            zip.file(`${key}.png`, blob);
        }
        if (hasError) {
            console.warn(
                "Some textures were missing or invalid and replaced with placeholders."
            );


        }
        try {
            const zipBlob = await zip.generateAsync({ type: "blob" });
            saveAs(zipBlob, `${blockType.name}.zip`);
            console.log(`Downloaded ${blockType.name}.zip`);
        } catch (error) {
            console.error("Error generating or saving zip file:", error);
            alert(
                "Failed to generate or save the zip file. See console for details."
            );
        }
    };

    const handleTabChange = (newTab) => {

        if (newTab === "blocks") {
            setCurrentBlockType(blockTypes[0]);
            setPreviewModelUrl(null);
        } else if (newTab === "environment") {
            const defaultEnvModel = environmentModels.find((m) => !m.isCustom);
            if (defaultEnvModel) {
                setCurrentBlockType(defaultEnvModel);
                setPreviewModelUrl(defaultEnvModel.modelUrl);
                selectedBlockID = defaultEnvModel.id;
            } else {
                setCurrentBlockType(null);
                setPreviewModelUrl(null);
            }
        }
        setActiveTab(newTab);
    };
    const handleDeleteCustomBlock = async (blockType) => {
        const confirmMessage = `Deleting "${blockType.name}" will replace any instances of this block with an error texture. Are you sure you want to proceed?`;
        if (window.confirm(confirmMessage)) {

            removeCustomBlock(blockType.id);

            setCustomBlocks(getCustomBlocks());

            try {
                await DatabaseManager.saveData(
                    STORES.CUSTOM_BLOCKS,
                    "blocks",
                    getCustomBlocks()
                );
            } catch (err) {
                console.error(
                    "Error saving custom blocks after deletion:",
                    err
                );
            }
            try {

                const currentTerrain =
                    (await DatabaseManager.getData(
                        STORES.TERRAIN,
                        "current"
                    )) || {};
                const newTerrain = { ...currentTerrain };

                const errorBlock = {
                    id: 999, // Special ID for error blocks
                    name: `missing_${blockType.name}`,
                    textureUri: "./assets/blocks/error.png",
                    hasMissingTexture: true,
                    originalId: blockType.id, // Store the original ID for potential future recovery
                };

                Object.entries(newTerrain).forEach(([position, block]) => {
                    if (block.id === blockType.id) {
                        newTerrain[position] = errorBlock;
                    }
                });
                await DatabaseManager.saveData(
                    STORES.TERRAIN,
                    "current",
                    newTerrain
                );
                terrainBuilderRef.current.buildUpdateTerrain();
            } catch (error) {
                console.error(
                    "Error updating database after block deletion:",
                    error
                );
            }

            refreshBlockTools();
        }
    };
    const handleDeleteEnvironmentModel = async (modelId) => {
        if (
            window.confirm("Are you sure you want to delete this custom model?")
        ) {
            try {
                const existingModels =
                    (await DatabaseManager.getData(
                        STORES.CUSTOM_MODELS,
                        "models"
                    )) || [];
                const modelToDelete = environmentModels.find(
                    (model) => model.id === modelId
                );
                if (!modelToDelete) return;

                const modelIndex = environmentModels.findIndex(
                    (model) => model.id === modelId
                );
                if (modelIndex !== -1) {
                    environmentModels.splice(modelIndex, 1);
                }

                const updatedModels = existingModels.filter(
                    (model) => model.name !== modelToDelete.name
                );
                await DatabaseManager.saveData(
                    STORES.CUSTOM_MODELS,
                    "models",
                    updatedModels
                );

                const currentEnvironment =
                    (await DatabaseManager.getData(
                        STORES.ENVIRONMENT,
                        "current"
                    )) || [];
                const updatedEnvironment = currentEnvironment.filter(
                    (obj) => obj.name !== modelToDelete.name
                );

                await DatabaseManager.saveData(
                    STORES.ENVIRONMENT,
                    "current",
                    updatedEnvironment
                );

                if (environmentBuilder && environmentBuilder.current) {
                    await environmentBuilder.current.refreshEnvironmentFromDB();
                }
                if (
                    modelToDelete &&
                    previewModelUrl === modelToDelete.modelUrl
                ) {
                    setPreviewModelUrl(null);
                }
            } catch (error) {
                console.error("Error deleting environment model:", error);
            }
        }
    };
    const handleEnvironmentSelect = (envType) => {
        console.log("Environment selected:", envType);
        setCurrentBlockType({
            ...envType,
            isEnvironment: true,
        });
        selectedBlockID = envType.id;
        setPreviewModelUrl(envType.modelUrl);
    };
    const handleBlockSelect = (blockType) => {

        setCurrentBlockType({
            ...blockType,
            isEnvironment: false,
        });
        selectedBlockID = blockType.id;
    };
    const handleCustomAssetDropUpload = async (e) => {
        e.preventDefault();
        e.currentTarget.classList.remove("drag-over");
        const files = Array.from(e.dataTransfer.files);

        if (activeTab === "blocks") {
            const imageFiles = files.filter((file) =>
                file.type.startsWith("image/")
            );

            if (imageFiles.length > 0) {

                if (imageFiles.length > 1) {

                    try {

                        const blockPromises = imageFiles.map((file) => {
                            return new Promise((resolve) => {
                                const reader = new FileReader();
                                reader.onload = () => {
                                    const blockName = file.name.replace(
                                        /\.[^/.]+$/,
                                        ""
                                    ); // Remove file extension
                                    resolve({
                                        name: blockName,
                                        textureUri: reader.result,
                                    });
                                };
                                reader.readAsDataURL(file);
                            });
                        });

                        const blocks = await Promise.all(blockPromises);

                        await batchProcessCustomBlocks(blocks);

                        const updatedCustomBlocks = getCustomBlocks();
                        await DatabaseManager.saveData(
                            STORES.CUSTOM_BLOCKS,
                            "blocks",
                            updatedCustomBlocks
                        );

                        refreshBlockTools();
                    } catch (error) {
                        console.error(
                            "Error in batch processing custom blocks:",
                            error
                        );
                    }
                } else {

                    const filePromises = imageFiles.map((file) => {
                        return new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onload = () => {
                                const blockName = file.name.replace(
                                    /\.[^/.]+$/,
                                    ""
                                ); // Remove file extension
                                const block = {
                                    name: blockName,
                                    textureUri: reader.result,
                                };

                                processCustomBlock(block);
                                resolve();
                            };
                            reader.readAsDataURL(file);
                        });
                    });

                    await Promise.all(filePromises);

                    try {
                        const updatedCustomBlocks = getCustomBlocks();
                        await DatabaseManager.saveData(
                            STORES.CUSTOM_BLOCKS,
                            "blocks",
                            updatedCustomBlocks
                        );
                    } catch (error) {
                        console.error(
                            "Error saving custom blocks to database:",
                            error
                        );
                    }

                    refreshBlockTools();
                }
            }
        }

        else if (activeTab === "environment") {
            const gltfFiles = files.filter((file) =>
                file.name.endsWith(".gltf")
            );
            if (gltfFiles.length > 0) {
                for (const file of gltfFiles) {
                    const fileName = file.name.replace(/\.[^/.]+$/, "");
                    if (
                        environmentModels.some(
                            (model) =>
                                model.name.toLowerCase() ===
                                fileName.toLowerCase()
                        )
                    ) {
                        alert(
                            `A model named "${fileName}" already exists. Please rename the file and try again.`
                        );
                        continue;
                    }
                    const reader = new FileReader();
                    reader.onload = async () => {
                        try {
                            const existingModels =
                                (await DatabaseManager.getData(
                                    STORES.CUSTOM_MODELS,
                                    "models"
                                )) || [];
                            const modelData = {
                                name: fileName,
                                data: reader.result,
                                timestamp: Date.now(),
                            };
                            const updatedModels = [
                                ...existingModels,
                                modelData,
                            ];
                            await DatabaseManager.saveData(
                                STORES.CUSTOM_MODELS,
                                "models",
                                updatedModels
                            );
                            const blob = new Blob([reader.result], {
                                type: "model/gltf+json",
                            });
                            const fileUrl = URL.createObjectURL(blob);
                            const newEnvironmentModel = {
                                id:
                                    Math.max(
                                        ...environmentModels
                                            .filter((model) => model.isCustom)
                                            .map((model) => model.id),
                                        199
                                    ) + 1,
                                name: fileName,
                                modelUrl: fileUrl,
                                isEnvironment: true,
                                isCustom: true,
                                animations: ["idle"],
                            };
                            environmentModels.push(newEnvironmentModel);
                            if (environmentBuilder) {
                                await environmentBuilder.current.loadModel(
                                    newEnvironmentModel.modelUrl
                                );
                                console.log(
                                    `Custom model ${newEnvironmentModel.name} added and loaded.`
                                );
                            }
                        } catch (error) {
                            console.error(
                                `Error processing model ${fileName}:`,
                                error
                            );
                        }
                    };
                    reader.readAsArrayBuffer(file);
                }
                refreshBlockTools();
            }
        }
    };
    return (
        <div className="block-tools-container">
            <div className="dead-space"></div>
            <div className="block-tools-sidebar">
                <div className="tab-button-wrapper">
                    <button
                        className={`tab-button-left ${
                            activeTab === "blocks" ? "active" : ""
                        }`}
                        onClick={() => handleTabChange("blocks")}
                    >
                        Blocks
                    </button>
                    <button
                        className={`tab-button-right ${
                            activeTab === "environment" ? "active" : ""
                        }`}
                        onClick={() => handleTabChange("environment")}
                    >
                        Models
                    </button>
                </div>
                <div className="block-buttons-grid">
                    {activeTab === "blocks" ? (
                        <>
                            <div className="block-tools-section-label">
                                Default Blocks (ID: 1-99)
                            </div>
                            {blockTypes
                                .filter((block) => block.id < 100)
                                .map((blockType) => (
                                    <BlockButton
                                        key={blockType.id}
                                        blockType={blockType}
                                        isSelected={
                                            selectedBlockID === blockType.id
                                        }
                                        onSelect={(block) => {
                                            handleBlockSelect(block);
                                            localStorage.setItem(
                                                "selectedBlock",
                                                block.id
                                            );
                                        }}
                                        onDelete={handleDeleteCustomBlock}
                                        onDownload={handleDownloadBlock}
                                        handleDragStart={handleDragStart}
                                    />
                                ))}
                            <div className="block-tools-section-label">
                                Custom Blocks (ID: 100-199)
                            </div>
                            {customBlocks
                                .filter(
                                    (block) => block.id >= 100 && block.id < 200
                                )
                                .map((blockType) => (
                                    <BlockButton
                                        key={blockType.id}
                                        blockType={blockType}
                                        isSelected={
                                            selectedBlockID === blockType.id
                                        }
                                        onSelect={(block) => {
                                            handleBlockSelect(block);
                                            localStorage.setItem(
                                                "selectedBlock",
                                                block.id
                                            );
                                        }}
                                        onDelete={handleDeleteCustomBlock}
                                        onDownload={handleDownloadBlock}
                                        handleDragStart={handleDragStart}
                                        needsTexture={blockType.needsTexture}
                                    />
                                ))}
                        </>
                    ) : (
                        <>
                            <div className="environment-preview-container">
                                {previewModelUrl ? (
                                    <ModelPreview modelUrl={previewModelUrl} />
                                ) : (
                                    <div className="no-preview-text">
                                        Select an object to preview
                                    </div>
                                )}
                            </div>
                            <div className="environment-button-wrapper">
                                <div className="block-tools-section-label">
                                    Default Models (ID: 200-299)
                                </div>
                                {environmentModels
                                    .filter((envType) => !envType.isCustom)
                                    .map((envType) => (
                                        <EnvironmentButton
                                            key={envType.id}
                                            envType={envType}
                                            isSelected={
                                                selectedBlockID === envType.id
                                            }
                                            onSelect={(envType) => {
                                                handleEnvironmentSelect(
                                                    envType
                                                );
                                                localStorage.setItem(
                                                    "selectedBlock",
                                                    envType.id
                                                );
                                            }}
                                            onDelete={
                                                handleDeleteEnvironmentModel
                                            }
                                        />
                                    ))}
                                <div className="block-tools-section-label">
                                    Custom Models (ID: 300+)
                                </div>
                                {environmentModels
                                    .filter((envType) => envType.isCustom)
                                    .map((envType) => (
                                        <EnvironmentButton
                                            key={envType.id}
                                            envType={envType}
                                            isSelected={
                                                selectedBlockID === envType.id
                                            }
                                            onSelect={(envType) => {
                                                handleEnvironmentSelect(
                                                    envType
                                                );
                                                localStorage.setItem(
                                                    "selectedBlock",
                                                    envType.id
                                                );
                                            }}
                                            onDelete={
                                                handleDeleteEnvironmentModel
                                            }
                                        />
                                    ))}
                            </div>
                        </>
                    )}
                </div>
                {activeTab === "environment" && (
                    <div className="placement-tools">
                        <div className="placement-tools-grid">
                            <div className="placement-tool full-width">
                                <div className="randomize-header">
                                    <input
                                        type="checkbox"
                                        id="randomScale"
                                        className="placement-checkbox"
                                        checked={settings.randomScale}
                                        onChange={(e) =>
                                            updateSettings({
                                                randomScale: e.target.checked,
                                            })
                                        }
                                    />
                                    <label
                                        id="randomScaleLabel"
                                        htmlFor="randomScale"
                                    >
                                        Randomize Scale
                                    </label>
                                </div>
                                <div className="min-max-inputs">
                                    <div className="min-max-input">
                                        <label>Range: </label>
                                        <input
                                            type="number"
                                            className="slider-value-input"
                                            value={settings.minScale}
                                            min={SCALE_MIN}
                                            max={SCALE_MAX}
                                            step="0.1"
                                            disabled={!settings.randomScale}
                                            onChange={(e) =>
                                                updateSettings({
                                                    minScale: Number(
                                                        e.target.value
                                                    ),
                                                })
                                            }
                                            onBlur={(e) => {
                                                const value = Number(
                                                    e.target.value
                                                );
                                                if (
                                                    value < SCALE_MIN ||
                                                    value > SCALE_MAX
                                                ) {
                                                    alert(
                                                        `Please enter a value between ${SCALE_MIN} and ${SCALE_MAX}!`
                                                    );
                                                    updateSettings({
                                                        minScale: 0.5,
                                                    });
                                                }
                                            }}
                                            onKeyDown={(e) =>
                                                e.stopPropagation()
                                            }
                                        />
                                    </div>
                                    <div className="min-max-input">
                                        <label>-</label>
                                        <input
                                            type="number"
                                            className="slider-value-input"
                                            value={settings.maxScale}
                                            min={SCALE_MIN}
                                            max={SCALE_MAX}
                                            step="0.1"
                                            disabled={!settings.randomScale}
                                            onChange={(e) =>
                                                updateSettings({
                                                    maxScale: Number(
                                                        e.target.value
                                                    ),
                                                })
                                            }
                                            onBlur={(e) => {
                                                const value = Number(
                                                    e.target.value
                                                );
                                                if (
                                                    value < SCALE_MIN ||
                                                    value > SCALE_MAX
                                                ) {
                                                    alert(
                                                        `Please enter a value between ${SCALE_MIN} and ${SCALE_MAX}!`
                                                    );
                                                    updateSettings({
                                                        maxScale: 1.5,
                                                    });
                                                }
                                            }}
                                            onKeyDown={(e) =>
                                                e.stopPropagation()
                                            }
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="placement-tool full-width">
                                <div className="randomize-header">
                                    <input
                                        type="checkbox"
                                        id="randomRotation"
                                        className="placement-checkbox"
                                        checked={settings.randomRotation}
                                        onChange={(e) =>
                                            updateSettings({
                                                randomRotation:
                                                    e.target.checked,
                                            })
                                        }
                                    />
                                    <label
                                        id="randomRotationLabel"
                                        htmlFor="randomRotation"
                                    >
                                        Randomize Rotation
                                    </label>
                                </div>
                                <div className="min-max-inputs">
                                    <div className="min-max-input">
                                        <label>Range: </label>
                                        <input
                                            type="number"
                                            className="slider-value-input"
                                            value={settings.minRotation}
                                            min={ROTATION_MIN}
                                            max={ROTATION_MAX}
                                            step="15"
                                            disabled={!settings.randomRotation}
                                            onChange={(e) =>
                                                updateSettings({
                                                    minRotation: Number(
                                                        e.target.value
                                                    ),
                                                })
                                            }
                                            onBlur={(e) => {
                                                const value = Number(
                                                    e.target.value
                                                );
                                                if (
                                                    value < ROTATION_MIN ||
                                                    value > ROTATION_MAX
                                                ) {
                                                    alert(
                                                        `Please enter a value between ${ROTATION_MIN} and ${ROTATION_MAX}!`
                                                    );
                                                    updateSettings({
                                                        minRotation: 0,
                                                    });
                                                }
                                            }}
                                            onKeyDown={(e) =>
                                                e.stopPropagation()
                                            }
                                        />
                                    </div>
                                    <div className="min-max-input">
                                        <label>-</label>
                                        <input
                                            type="number"
                                            className="slider-value-input"
                                            value={settings.maxRotation}
                                            min={ROTATION_MIN}
                                            max={ROTATION_MAX}
                                            step="15"
                                            disabled={!settings.randomRotation}
                                            onChange={(e) =>
                                                updateSettings({
                                                    maxRotation: Number(
                                                        e.target.value
                                                    ),
                                                })
                                            }
                                            onBlur={(e) => {
                                                const value = Number(
                                                    e.target.value
                                                );
                                                if (
                                                    value < ROTATION_MIN ||
                                                    value > ROTATION_MAX
                                                ) {
                                                    alert(
                                                        `Please enter a value between ${ROTATION_MIN} and ${ROTATION_MAX}!`
                                                    );
                                                    updateSettings({
                                                        maxRotation: 360,
                                                    });
                                                }
                                            }}
                                            onKeyDown={(e) =>
                                                e.stopPropagation()
                                            }
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="placement-tool-slider">
                                <div className="slider-header">
                                    <label htmlFor="placementScale">
                                        Object Scale
                                    </label>
                                    <input
                                        type="number"
                                        className="slider-value-input"
                                        value={settings.scale}
                                        min={SCALE_MIN}
                                        max={SCALE_MAX}
                                        step="0.1"
                                        disabled={settings.randomScale}
                                        onChange={(e) =>
                                            updateSettings({
                                                scale: Number(e.target.value),
                                            })
                                        }
                                        onBlur={(e) => {
                                            const value = Number(
                                                e.target.value
                                            );
                                            if (
                                                value < SCALE_MIN ||
                                                value > SCALE_MAX
                                            ) {
                                                alert(
                                                    `Please enter a value between ${SCALE_MIN} and ${SCALE_MAX}!`
                                                );
                                                updateSettings({ scale: 1.0 });
                                            }
                                        }}
                                        onKeyDown={(e) => e.stopPropagation()}
                                    />
                                </div>
                                <input
                                    type="range"
                                    id="placementScale"
                                    min={SCALE_MIN}
                                    max={SCALE_MAX}
                                    step="0.1"
                                    value={settings.scale}
                                    className="placement-slider"
                                    onChange={(e) =>
                                        updateSettings({
                                            scale: Number(e.target.value),
                                        })
                                    }
                                    disabled={settings.randomScale}
                                />
                            </div>
                            <div className="placement-tool-slider">
                                <div className="slider-header">
                                    <label htmlFor="placementRotation">
                                        Rotation
                                    </label>
                                    <input
                                        type="number"
                                        className="slider-value-input"
                                        value={settings.rotation}
                                        min={ROTATION_MIN}
                                        max={ROTATION_MAX}
                                        step="15"
                                        disabled={settings.randomRotation}
                                        onChange={(e) =>
                                            updateSettings({
                                                rotation: Number(
                                                    e.target.value
                                                ),
                                            })
                                        }
                                        onBlur={(e) => {
                                            const value = Number(
                                                e.target.value
                                            );
                                            if (
                                                value < ROTATION_MIN ||
                                                value > ROTATION_MAX
                                            ) {
                                                alert(
                                                    `Please enter a value between ${ROTATION_MIN} and ${ROTATION_MAX}!`
                                                );
                                                updateSettings({ rotation: 0 });
                                            }
                                        }}
                                        onKeyDown={(e) => e.stopPropagation()}
                                    />
                                    <span className="degree-symbol">°</span>
                                </div>
                                <input
                                    type="range"
                                    id="placementRotation"
                                    min={ROTATION_MIN}
                                    max={ROTATION_MAX}
                                    step="15"
                                    value={settings.rotation}
                                    className="placement-slider"
                                    onChange={(e) =>
                                        updateSettings({
                                            rotation: Number(e.target.value),
                                        })
                                    }
                                    disabled={settings.randomRotation}
                                />
                            </div>
                        </div>
                    </div>
                )}
                <div
                    className="texture-drop-zone"
                    onDragOver={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.add("drag-over");
                    }}
                    onDragLeave={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove("drag-over");
                    }}
                    onDrop={handleCustomAssetDropUpload}
                >
                    <div className="drop-zone-content">
                        <div className="drop-zone-icons">
                            <img
                                className="upload-icon"
                                src="./assets/ui/icons/upload-icon.png"
                            />
                        </div>
                        <div className="drop-zone-text">
                            {activeTab === "blocks"
                                ? "Drag textures here to add new blocks or fix missing textures"
                                : "Drag .gltf files here to add custom models"}
                        </div>
                    </div>
                </div>
                {/* Create Texture Button - Added Here */}
                <button
                    className="create-texture-button"
                    onClick={onOpenTextureModal}
                >
                    Create a Texture
                </button>
            </div>
            <div className="dead-space"></div>
        </div>
    );
};
export default BlockToolsSidebar;
