import { saveAs } from "file-saver";
import JSZip from "jszip";
import { useCallback, useEffect, useRef, useState } from "react";
import { FaDownload, FaWrench } from "react-icons/fa";
import "../../css/BlockToolsSidebar.css";
import { cameraManager } from "../Camera";
import { environmentModels } from "../EnvironmentBuilder";
import {
    batchProcessCustomBlocks,
    blockTypes,
    getCustomBlocks,
    processCustomBlock,
} from "../managers/BlockTypesManager";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";
import { generateSchematicPreview } from "../utils/SchematicPreviewRenderer";
import BlockButton from "./BlockButton";
import EnvironmentButton from "./EnvironmentButton";
import { BlockIcon } from "./icons/BlockIcon";
import { PalmTreeIcon } from "./icons/PalmTreeIcon";
import { BlocksIcon } from "./icons/BlocksIcon";

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
    onLoadSchematicFromHistory,
    isCompactMode,
}) => {
    const [customBlocks, setCustomBlocks] = useState([]);
    /** @type {[import("./AIAssistantPanel").SchematicHistoryEntry[], Function]} */
    const [schematicList, setSchematicList] = useState([]);
    const [schematicPreviews, setSchematicPreviews] = useState({});
    const schematicPreviewsRef = useRef(schematicPreviews);
    const schematicListStateRef = useRef(schematicList);
    const isGeneratingPreviews = useRef(false);
    const currentPreviewIndex = useRef(0);

    useEffect(() => {
        const savedBlockId = localStorage.getItem("selectedBlock");
        if (savedBlockId) {
            selectedBlockID = parseInt(savedBlockId);
        }
    }, []);

    const loadSchematicsFromDB = useCallback(async () => {
        console.log("[BlockToolsSidebar] Loading schematics from DB...");
        try {
            const { DatabaseManager, STORES } = await import(
                "../managers/DatabaseManager"
            );
            const db = await DatabaseManager.getDBConnection();
            const tx = db.transaction(STORES.SCHEMATICS, "readonly");
            const store = tx.objectStore(STORES.SCHEMATICS);
            const cursorRequest = store.openCursor();
            /** @type {import("./AIAssistantPanel").SchematicHistoryEntry[]} */
            const loadedSchematics = [];

            cursorRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const dbKey = cursor.key;
                    const dbValue = cursor.value;
                    // Basic check for V2 schematic structure
                    if (
                        dbValue &&
                        typeof dbValue.prompt === "string" &&
                        dbValue.schematic &&
                        typeof dbValue.timestamp === "number"
                    ) {
                        loadedSchematics.push({
                            id: dbKey,
                            prompt: dbValue.prompt,
                            schematic: dbValue.schematic,
                            timestamp: dbValue.timestamp,
                        });
                    }
                    cursor.continue();
                } else {
                    loadedSchematics.sort((a, b) => b.timestamp - a.timestamp);

                    const currentSchematicListFromState =
                        schematicListStateRef.current;
                    let listsAreIdentical =
                        currentSchematicListFromState.length ===
                        loadedSchematics.length;

                    if (listsAreIdentical && loadedSchematics.length > 0) {
                        for (let i = 0; i < loadedSchematics.length; i++) {
                            if (
                                currentSchematicListFromState[i].id !==
                                    loadedSchematics[i].id ||
                                currentSchematicListFromState[i].timestamp !==
                                    loadedSchematics[i].timestamp
                            ) {
                                listsAreIdentical = false;
                                break;
                            }
                        }
                    }

                    if (!listsAreIdentical) {
                        console.log(
                            `[BlockToolsSidebar] Schematic list changed or initial load. Updating state with ${loadedSchematics.length} schematics.`
                        );
                        setSchematicList(loadedSchematics);
                    } else {
                        console.log(
                            `[BlockToolsSidebar] Loaded ${loadedSchematics.length} schematics from DB, list content (IDs, timestamps) is unchanged. Skipping state update.`
                        );
                    }
                }
            };
            cursorRequest.onerror = (event) => {
                console.error(
                    "[BlockToolsSidebar] Error reading schematics store:",
                    event.target.error
                );
            };
        } catch (err) {
            console.error(
                "[BlockToolsSidebar] Error accessing DB for schematics:",
                err
            );
        }
    }, []);

    useEffect(() => {
        if (activeTab === "components") {
            loadSchematicsFromDB();
        }
        const handleSchematicsUpdated = () => {
            console.log(
                "[BlockToolsSidebar] schematicsDbUpdated event received."
            );
            if (
                document.visibilityState === "visible" &&
                activeTab === "components"
            ) {
                loadSchematicsFromDB();
            }
        };
        window.addEventListener("schematicsDbUpdated", handleSchematicsUpdated);

        return () => {
            window.removeEventListener(
                "schematicsDbUpdated",
                handleSchematicsUpdated
            );
        };
    }, [activeTab, loadSchematicsFromDB]);

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
    }, []);

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

    useEffect(() => {
        schematicPreviewsRef.current = schematicPreviews;
    }, [schematicPreviews]);

    useEffect(() => {
        schematicListStateRef.current = schematicList;
    }, [schematicList]);

    useEffect(() => {
        const processQueue = async () => {
            if (
                currentPreviewIndex.current >= schematicList.length ||
                !isGeneratingPreviews.current
            ) {
                isGeneratingPreviews.current = false;
                console.log(
                    "[BlockToolsSidebar] Finished preview generation queue or queue stopped."
                );
                if (currentPreviewIndex.current > 0) {
                    requestAnimationFrame(() => {
                        if (cameraManager) {
                            cameraManager.loadSavedState();
                            console.log(
                                "[BlockToolsSidebar] Camera state restored after preview generation batch."
                            );
                        }
                    });
                }
                currentPreviewIndex.current = 0;
                return;
            }

            const entry = schematicList[currentPreviewIndex.current];

            if (!entry.schematic) {
                console.log(
                    `[BlockToolsSidebar] No schematic data for entry ${entry.id} (index ${currentPreviewIndex.current}), marking as null.`
                );
                setSchematicPreviews((prevPreviews) => ({
                    ...prevPreviews,
                    [entry.id]: null,
                }));
            } else if (
                schematicPreviewsRef.current[entry.id] === undefined ||
                schematicPreviewsRef.current[entry.id] === null
            ) {
                // Schematic data exists, and preview is missing or previously failed. Try/Retry generating.
                let newPreviewDataUrl = null;
                let errorOccurred = false;
                try {
                    console.log(
                        `[BlockToolsSidebar] Generating preview for schematic (index ${
                            currentPreviewIndex.current
                        }): ${entry.prompt.substring(0, 30)}...`
                    );
                    newPreviewDataUrl = await generateSchematicPreview(
                        entry.schematic,
                        {
                            width: 48,
                            height: 48,
                            background: "transparent",
                        }
                    );
                } catch (error) {
                    console.error(
                        `[BlockToolsSidebar] Error generating preview for schematic ${entry.id}:`,
                        error
                    );
                    errorOccurred = true;
                }

                setSchematicPreviews((prevPreviews) => ({
                    ...prevPreviews,
                    [entry.id]: errorOccurred
                        ? null
                        : newPreviewDataUrl || null,
                }));
            } else {
                // Preview already exists and is valid (not undefined or null), or no schematic data (handled above)
                console.log(
                    `[BlockToolsSidebar] Skipping preview for schematic (index ${
                        currentPreviewIndex.current
                    }): ${entry.prompt.substring(
                        0,
                        30
                    )} - already processed or no retry needed.`
                );
            }

            currentPreviewIndex.current++;
            requestAnimationFrame(processQueue);
        };

        if (schematicList.length > 0) {
            if (!isGeneratingPreviews.current) {
                let needsProcessing = false;
                for (const entry of schematicList) {
                    // If preview is undefined (never processed) or null (failed/no data), it needs processing.
                    if (
                        schematicPreviewsRef.current[entry.id] === undefined ||
                        schematicPreviewsRef.current[entry.id] === null
                    ) {
                        needsProcessing = true;
                        break;
                    }
                }

                if (needsProcessing) {
                    console.log(
                        "[BlockToolsSidebar] Starting/Restarting preview generation queue as items need processing."
                    );
                    isGeneratingPreviews.current = true;
                    currentPreviewIndex.current = 0;
                    requestAnimationFrame(processQueue);
                } else {
                    console.log(
                        "[BlockToolsSidebar] All schematics processed or no new items/failures."
                    );
                }
            } else {
                // console.log("[BlockToolsSidebar] Preview generation already in progress."); // Can be noisy
            }
        } else if (schematicList.length === 0) {
            setSchematicPreviews({});
            isGeneratingPreviews.current = false;
            currentPreviewIndex.current = 0;
        }

        return () => {
            isGeneratingPreviews.current = false;
            console.log(
                "[BlockToolsSidebar] Preview generation queue stopped due to cleanup or schematicList change."
            );
        };
    }, [schematicList]);

    const handleDragStart = (blockId) => {
        console.log("Drag started with block:", blockId);
    };

    const handleDownloadAllCustom = async () => {
        const zip = new JSZip();
        const root = zip.folder("custom");
        const faceKeys = ["+x", "-x", "+y", "-y", "+z", "-z"];
        const list = getCustomBlocks();
        for (const block of list) {
            const folder = root.folder(block.name);
            const textures = block.sideTextures || {};
            const mainTex = block.textureUri;
            for (const key of faceKeys) {
                const dataUrl = textures[key] || mainTex;
                let blob = dataURLtoBlob(dataUrl);
                if (!blob) blob = await createPlaceholderBlob();
                folder.file(`${key}.png`, blob || new Blob());
            }
        }
        try {
            const zipBlob = await zip.generateAsync({ type: "blob" });
            saveAs(zipBlob, "custom.zip");
            console.log("Downloaded custom.zip");
        } catch (err) {
            console.error("Error saving custom.zip: ", err);
            alert("Failed to save custom.zip. See console.");
        }
    };

    const handleTabChange = (newTab) => {
        terrainBuilderRef?.current?.activateTool(null);
        if (newTab === "blocks") {
            const defaultBlock = blockTypes[0];
            setCurrentBlockType(defaultBlock);
            selectedBlockID = defaultBlock.id;
        } else if (newTab === "models") {
            const defaultEnvModel = environmentModels.find((m) => !m.isCustom);
            console.log("defaultEnvModel", defaultEnvModel);
            if (defaultEnvModel) {
                setCurrentBlockType({
                    ...defaultEnvModel,
                    isEnvironment: true,
                });
                selectedBlockID = defaultEnvModel.id;
            } else {
                setCurrentBlockType(null);
                selectedBlockID = 0;
            }
        } else if (newTab === "components") {
            setCurrentBlockType(null);
            selectedBlockID = 0;
            loadSchematicsFromDB();
        }
        setActiveTab(newTab);
    };

    const handleEnvironmentSelect = (envType) => {
        console.log("Environment selected:", envType);
        terrainBuilderRef?.current?.activateTool(null);
        setCurrentBlockType({
            ...envType,
            isEnvironment: true,
        });
        selectedBlockID = envType.id;
    };

    const handleBlockSelect = (blockType) => {
        console.log("Block selected:", blockType);
        terrainBuilderRef?.current?.activateTool(null);
        setCurrentBlockType({
            ...blockType,
            isEnvironment: false,
        });
        selectedBlockID = blockType.id;
    };

    /** @param {import("./AIAssistantPanel").SchematicHistoryEntry} schematicEntry */
    const handleSchematicSelect = (schematicEntry) => {
        console.log("Schematic selected:", schematicEntry.prompt);
        setCurrentBlockType({
            ...schematicEntry,
            isComponent: true,
        });
        onLoadSchematicFromHistory(schematicEntry.schematic);
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
                                    );
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
                                );
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
        } else if (activeTab === "models") {
            const modelFiles = files.filter(
                (file) =>
                    file.name.endsWith(".gltf") || file.name.endsWith(".glb")
            );
            if (modelFiles.length > 0) {
                const existingModels =
                    (await DatabaseManager.getData(
                        STORES.CUSTOM_MODELS,
                        "models"
                    )) || [];
                const existingModelNames = new Set(
                    environmentModels.map((m) => m.name.toLowerCase())
                );
                const newModelsForDB = [];
                const newModelsForUI = [];
                const duplicateFileNames = new Set();
                const processedFileNames = new Set();
                const fileReadPromises = modelFiles.map((file) => {
                    return new Promise((resolve, reject) => {
                        const fileName = file.name.replace(/\.[^/.]+$/, "");
                        const lowerCaseFileName = fileName.toLowerCase();
                        if (existingModelNames.has(lowerCaseFileName)) {
                            duplicateFileNames.add(fileName);
                            console.warn(
                                `Duplicate model skipped: ${fileName} (already exists)`
                            );
                            reject(new Error(`Duplicate model: ${fileName}`));
                            return;
                        }
                        if (processedFileNames.has(lowerCaseFileName)) {
                            duplicateFileNames.add(fileName);
                            console.warn(
                                `Duplicate model skipped: ${fileName} (in current batch)`
                            );
                            reject(
                                new Error(
                                    `Duplicate model in batch: ${fileName}`
                                )
                            );
                            return;
                        }
                        processedFileNames.add(lowerCaseFileName);
                        const reader = new FileReader();
                        reader.onload = () =>
                            resolve({ file, fileName, data: reader.result });
                        reader.onerror = (error) => reject(error);
                        reader.readAsArrayBuffer(file);
                    });
                });
                const results = await Promise.allSettled(fileReadPromises);
                if (duplicateFileNames.size > 0) {
                    alert(
                        `The following model names already exist or were duplicated in the drop:\n- ${Array.from(
                            duplicateFileNames
                        ).join(
                            "\n- "
                        )}\n\nPlease rename the files and try again.`
                    );
                }
                results.forEach((result) => {
                    if (result.status === "fulfilled") {
                        const { file, fileName, data } = result.value;
                        try {
                            const modelDataForDB = {
                                name: fileName,
                                data: data,
                                timestamp: Date.now(),
                            };
                            newModelsForDB.push(modelDataForDB);
                            const blob = new Blob([data], {
                                type: file.type || "model/gltf-binary",
                            });
                            const fileUrl = URL.createObjectURL(blob);
                            const newEnvironmentModel = {
                                id:
                                    Math.max(
                                        0,
                                        ...environmentModels
                                            .filter((model) => model.isCustom)
                                            .map((model) => model.id),
                                        299
                                    ) +
                                    1 +
                                    newModelsForUI.length,
                                name: fileName,
                                modelUrl: fileUrl,
                                isEnvironment: true,
                                isCustom: true,
                                animations: ["idle"],
                            };
                            newModelsForUI.push(newEnvironmentModel);
                        } catch (error) {
                            console.error(
                                `Error processing model ${fileName}:`,
                                error
                            );
                        }
                    } else {
                        console.error(
                            "Failed to process a model file:",
                            result.reason?.message || result.reason
                        );
                    }
                });
                if (newModelsForDB.length > 0) {
                    try {
                        const updatedModelsForDB = [
                            ...existingModels,
                            ...newModelsForDB,
                        ];
                        await DatabaseManager.saveData(
                            STORES.CUSTOM_MODELS,
                            "models",
                            updatedModelsForDB
                        );
                        console.log(
                            `Saved ${newModelsForDB.length} new models to DB.`
                        );
                        environmentModels.push(...newModelsForUI);
                        if (environmentBuilder && environmentBuilder.current) {
                            for (const model of newModelsForUI) {
                                try {
                                    await environmentBuilder.current.loadModel(
                                        model.modelUrl
                                    );
                                    console.log(
                                        `Custom model ${model.name} added and loaded.`
                                    );
                                } catch (loadError) {
                                    console.error(
                                        `Error loading model ${model.name} into environment:`,
                                        loadError
                                    );
                                }
                            }
                        }
                        refreshBlockTools();
                    } catch (error) {
                        console.error(
                            "Error saving or loading new models:",
                            error
                        );
                        alert(
                            "An error occurred while saving or loading the new models. Check the console for details."
                        );
                    }
                } else if (
                    duplicateFileNames.size === 0 &&
                    modelFiles.length > 0
                ) {
                    alert(
                        "Could not process any of the dropped model files. Check the console for errors."
                    );
                }
            }
        }
    };

    return (
        <div
            className="block-tools-container"
            style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                width: "100%",
            }}
        >
            <div
                className="block-tools-sidebar transition-all ease-in-out duration-500 bg-[#0d0d0d]/70 backdrop-filter backdrop-blur-lg"
                style={{
                    width: isCompactMode ? "205px" : "295px",
                }}
            >
                <div className="tab-button-outer-wrapper w-full flex">
                    <div
                        className="tab-button-inner-wrapper flex w-full"
                        style={{ width: "100%" }}
                    >
                        {["blocks", "models", "components"].map(
                            (tab, index) => (
                                <button
                                    key={index}
                                    onClick={() => handleTabChange(tab)}
                                    className={`tab-button w-full ${
                                        activeTab === tab ? "active" : ""
                                    }`}
                                    title={
                                        isCompactMode
                                            ? tab.charAt(0).toUpperCase() +
                                              tab.slice(1)
                                            : undefined
                                    }
                                >
                                    {isCompactMode ? (
                                        tab === "blocks" ? (
                                            <BlockIcon className="mx-auto h-4.5 w-4.5" />
                                        ) : tab === "models" ? (
                                            <PalmTreeIcon className="mx-auto h-4.5 w-4.5" />
                                        ) : (
                                            <BlocksIcon className="mx-auto h-4.5 w-4.5" />
                                        )
                                    ) : (
                                        tab
                                    )}
                                </button>
                            )
                        )}
                        <div
                            className="tab-indicator"
                            style={{
                                left: `${
                                    activeTab === "blocks"
                                        ? "calc(0%)"
                                        : activeTab === "models"
                                        ? "calc(33.333% + 2px)"
                                        : "calc(66.666% + 4px)"
                                }`,
                            }}
                        />
                    </div>
                </div>
                <div
                    className="block-tools-divider"
                    style={{
                        width: "100%",
                        height: "1px",
                        backgroundColor: "rgba(255, 255, 255, 0.15)",
                        marginBottom: "15px",
                    }}
                />
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
                                        handleDragStart={handleDragStart}
                                    />
                                ))}
                            <div className="block-tools-section-label custom-label-with-icon mt-2">
                                Custom Blocks (ID: 100-199)
                                <button
                                    className="download-all-icon-button"
                                    onClick={handleDownloadAllCustom}
                                    title="Download all custom textures"
                                >
                                    {customBlocks.filter(
                                        (block) =>
                                            block.id >= 100 && block.id < 200
                                    ).length > 0 && <FaDownload />}
                                </button>
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
                                        handleDragStart={handleDragStart}
                                        needsTexture={blockType.needsTexture}
                                    />
                                ))}
                        </>
                    ) : activeTab === "models" ? (
                        <>
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
                                        />
                                    ))}
                                <div className="block-tools-section-label mt-2">
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
                                        />
                                    ))}
                            </div>
                        </>
                    ) : activeTab === "components" ? (
                        <>
                            <div className="block-tools-section-label">
                                Saved Schematics
                            </div>
                            {schematicList.length === 0 && (
                                <div className="no-schematics-text">
                                    No schematics saved yet. Generate some using
                                    the AI Assistant!
                                </div>
                            )}
                            {schematicList.map((entry) => (
                                <div
                                    key={entry.id}
                                    className="schematic-button bg-white/10 border border-white/0 hover:border-white/20 transition-all duration-150 active:border-white"
                                    style={{
                                        width: isCompactMode
                                            ? "calc(50% - 6px)"
                                            : "calc(33.333% - 4px)",
                                    }}
                                    onClick={() => handleSchematicSelect(entry)}
                                    title={`Load: ${entry.prompt}`}
                                >
                                    <div className="schematic-button-icon">
                                        {typeof schematicPreviews[entry.id] ===
                                        "string" ? (
                                            <img
                                                src={
                                                    schematicPreviews[entry.id]
                                                }
                                                alt="Schematic preview"
                                                style={{
                                                    width: "48px",
                                                    height: "48px",
                                                    objectFit: "contain",
                                                }}
                                            />
                                        ) : schematicPreviews[entry.id] ===
                                          null ? (
                                            <FaWrench title="Preview unavailable" />
                                        ) : (
                                            <div
                                                className="schematic-loading-spinner"
                                                title="Loading preview..."
                                            ></div>
                                        )}
                                    </div>
                                    <div className="schematic-button-prompt">
                                        {entry.prompt.length > 50
                                            ? entry.prompt.substring(0, 47) +
                                              "..."
                                            : entry.prompt}
                                    </div>
                                </div>
                            ))}
                        </>
                    ) : null}
                </div>
                <div className="flex w-full px-3">
                    <div
                        className="texture-drop-zone w-full"
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
                                    alt="Upload icon"
                                    src="./assets/ui/icons/upload-icon.png"
                                />
                            </div>
                            <div className="drop-zone-text">
                                {activeTab === "blocks"
                                    ? "Drag textures here to add new blocks or fix missing textures"
                                    : activeTab === "models"
                                    ? "Drag .gltf files here to add custom models"
                                    : "Use AI Assistant to generate schematics"}
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex px-3 w-full my-3">
                    <button
                        className="flex w-full bg-white text-black rounded-md p-2 text-center font-medium justify-center items-center cursor-pointer hover:border-2 hover:border-black transition-all border"
                        onClick={onOpenTextureModal}
                    >
                        Create Texture
                    </button>
                </div>
            </div>
        </div>
    );
};
export default BlockToolsSidebar;
