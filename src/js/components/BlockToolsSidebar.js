import { saveAs } from "file-saver";
import JSZip from "jszip";
import { useEffect, useState, useCallback, useRef } from "react";
import { FaDownload, FaWrench } from "react-icons/fa";
import "../../css/BlockToolsSidebar.css";
import { environmentModels } from "../EnvironmentBuilder";
import {
    batchProcessCustomBlocks,
    blockTypes,
    getCustomBlocks,
    processCustomBlock,
    removeCustomBlock,
} from "../managers/BlockTypesManager";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";
import { generateSchematicPreview } from "../utils/SchematicPreviewRenderer";
import BlockButton from "./BlockButton";
import EnvironmentButton from "./EnvironmentButton";
import ModelPreview from "./ModelPreview";
import { cameraManager } from "../Camera";

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

/**
 * @typedef {"blocks" | "models" | "schematics"} ActiveTabType
 */

/**
 * @param {object} props
 * @param {ActiveTabType} props.activeTab
 * @param {React.RefObject<any>} props.terrainBuilderRef
 * @param {(tab: ActiveTabType) => void} props.setActiveTab
 * @param {(block: any | null) => void} props.setCurrentBlockType
 * @param {React.RefObject<any>} props.environmentBuilder
 * @param {(settings: any) => void} [props.onPlacementSettingsChange]
 * @param {() => void} props.onOpenTextureModal
 * @param {(schematic: import("./AIAssistantPanel").RawSchematicType) => void} props.onLoadSchematicFromHistory
 */
const BlockToolsSidebar = ({
    activeTab,
    terrainBuilderRef,
    setActiveTab,
    setCurrentBlockType,
    environmentBuilder,
    onPlacementSettingsChange,
    onOpenTextureModal,
    onLoadSchematicFromHistory,
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
        if (activeTab === "schematics") {
            loadSchematicsFromDB();
        }
        const handleSchematicsUpdated = () => {
            console.log(
                "[BlockToolsSidebar] schematicsDbUpdated event received."
            );
            if (
                document.visibilityState === "visible" &&
                activeTab === "schematics"
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
        let hasError = false;
        for (const key of faceKeys) {
            const dataUrl = textures[key] || mainTexture;
            let blob = dataURLtoBlob(dataUrl);
            if (!blob) {
                console.warn(
                    `Missing texture ${key} for ${blockType.name}, using placeholder.`
                );
                blob = await createPlaceholderBlob();
                if (!blob) {
                    console.error(`Placeholder failed for ${key}, skipping.`);
                    hasError = true;
                    continue;
                }
            }
            zip.file(`${key}.png`, blob);
        }
        if (hasError) console.warn("Some textures missing; placeholders used.");
        try {
            const zipBlob = await zip.generateAsync({ type: "blob" });
            saveAs(zipBlob, `${blockType.name}.zip`);
            console.log(`Downloaded ${blockType.name}.zip`);
        } catch (err) {
            console.error("Error saving zip: ", err);
            alert("Failed to save zip. See console.");
        }
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

    /** @param {ActiveTabType} newTab */
    const handleTabChange = (newTab) => {
        if (newTab === "blocks") {
            const defaultBlock = blockTypes[0];
            setCurrentBlockType(defaultBlock);
            selectedBlockID = defaultBlock.id;
            setPreviewModelUrl(null);
        } else if (newTab === "models") {
            const defaultEnvModel = environmentModels.find((m) => !m.isCustom);
                console.log("defaultEnvModel", defaultEnvModel);
            if (defaultEnvModel) {
                setCurrentBlockType({
                    ...defaultEnvModel,
                    isEnvironment: true,
                });
                selectedBlockID = defaultEnvModel.id;
                setPreviewModelUrl(defaultEnvModel.modelUrl);
            } else {
                setCurrentBlockType(null);
                selectedBlockID = 0;
                setPreviewModelUrl(null);
            }
        } else if (newTab === "schematics") {
            setPreviewModelUrl(null);
            setCurrentBlockType(null);
            selectedBlockID = 0;
            loadSchematicsFromDB();
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
                    id: 999,
                    name: `missing_${blockType.name}`,
                    textureUri: "./assets/blocks/error.png",
                    hasMissingTexture: true,
                    originalId: blockType.id,
                };
                const errorId = errorBlock.id;
                console.log("blockType", blockType);
                Object.entries(newTerrain).forEach(([position, block]) => {
                    console.log("block", block);
                    console.log(
                        "blockType.id == block.id",
                        blockType.id == block.id
                    );
                    if (block === blockType.id) {
                        newTerrain[position] = errorId;
                    }
                });
                console.log("newTerrain", newTerrain);
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
        console.log("Block selected:", blockType);
        setCurrentBlockType({
            ...blockType,
            isEnvironment: false,
        });
        selectedBlockID = blockType.id;
    };

    /** @param {import("./AIAssistantPanel").SchematicHistoryEntry} schematicEntry */
    const handleSchematicSelect = (schematicEntry) => {
        console.log("Schematic selected:", schematicEntry.prompt);
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
            <div className="dead-space"></div>
            <div className="block-tools-sidebar">
                <div className="tab-button-outer-wrapper">
                    <div className="tab-button-inner-wrapper">
                        {["blocks", "models", "schematics"].map(
                            (tab, index) => (
                                <div className="tab-button-wrapper" key={index}>
                                    <button
                                        onClick={() => handleTabChange(tab)}
                                        className={`tab-button ${
                                            activeTab === tab ? "active" : ""
                                        }`}
                                    >
                                        {tab}
                                    </button>
                                </div>
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
                                        onDelete={handleDeleteCustomBlock}
                                        onDownload={handleDownloadBlock}
                                        handleDragStart={handleDragStart}
                                    />
                                ))}
                            <div className="block-tools-section-label custom-label-with-icon">
                                Custom Blocks (ID: 100-199)
                                <button
                                    className="download-all-icon-button"
                                    onClick={handleDownloadAllCustom}
                                    title="Download all custom textures"
                                >
                                    <FaDownload />
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
                                        onDelete={handleDeleteCustomBlock}
                                        onDownload={handleDownloadBlock}
                                        handleDragStart={handleDragStart}
                                        needsTexture={blockType.needsTexture}
                                    />
                                ))}
                        </>
                    ) : activeTab === "models" ? (
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
                    ) : activeTab === "schematics" ? (
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
                                    className="schematic-button"
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
                {activeTab === "models" && (
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
                                : activeTab === "models"
                                ? "Drag .gltf files here to add custom models"
                                : "Use AI Assistant to generate schematics"}
                        </div>
                    </div>
                </div>
                <button
                    className="create-texture-button"
                    onClick={onOpenTextureModal}
                >
                    Create Texture
                </button>
            </div>
            <div className="dead-space"></div>
        </div>
    );
};
export default BlockToolsSidebar;
