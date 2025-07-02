import { saveAs } from "file-saver";
import JSZip from "jszip";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    FaDownload,
    FaWrench,
    FaUpload,
    FaChevronLeft,
    FaChevronRight,
} from "react-icons/fa";
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
    setPlacementSize,
    onOpenTextureModal,
    onLoadSchematicFromHistory,
    isCompactMode,
}) => {
    const [customBlocks, setCustomBlocks] = useState([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedModelCategory, setSelectedModelCategory] = useState("All");
    const [categoryScrollIndex, setCategoryScrollIndex] = useState(0);
    const [hasNavigatedCategories, setHasNavigatedCategories] = useState(false);
    const [netNavigationCount, setNetNavigationCount] = useState(0);
    /** @type {[import("./AIAssistantPanel").SchematicHistoryEntry[], Function]} */
    const [schematicList, setSchematicList] = useState([]);
    const [schematicPreviews, setSchematicPreviews] = useState({});
    const schematicPreviewsRef = useRef(schematicPreviews);
    const schematicListStateRef = useRef(schematicList);
    const isGeneratingPreviews = useRef(false);
    const currentPreviewIndex = useRef(0);
    const fileInputRef = useRef(null);

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
                            name: dbValue.name || "",
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
                // Check if preview already exists in IndexedDB and use it if available
                let previewFromDB = null;
                try {
                    previewFromDB = await DatabaseManager.getData(
                        STORES.PREVIEWS,
                        entry.id
                    );
                } catch (dbErr) {
                    // ignore, will generate preview below
                }

                if (previewFromDB && typeof previewFromDB === "string") {
                    setSchematicPreviews((prev) => ({
                        ...prev,
                        [entry.id]: previewFromDB,
                    }));
                    schematicPreviewsRef.current[entry.id] = previewFromDB;
                    // Skip generation as we already have it
                } else {
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

                    // If preview was generated (and not errored), cache it in DB for future sessions
                    if (!errorOccurred && newPreviewDataUrl) {
                        try {
                            await DatabaseManager.saveData(
                                STORES.PREVIEWS,
                                entry.id,
                                newPreviewDataUrl
                            );
                        } catch (saveErr) {
                            console.warn(
                                "Failed to cache schematic preview:",
                                saveErr
                            );
                        }
                    }

                    setSchematicPreviews((prevPreviews) => ({
                        ...prevPreviews,
                        [entry.id]: errorOccurred
                            ? null
                            : newPreviewDataUrl || null,
                    }));
                }
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

    // Load previews from DB when schematic list changes
    useEffect(() => {
        const fetchPreviews = async () => {
            if (schematicList.length === 0) return;
            const updates = {};
            for (const entry of schematicList) {
                if (schematicPreviewsRef.current[entry.id] !== undefined)
                    continue;
                try {
                    const preview = await DatabaseManager.getData(
                        STORES.PREVIEWS,
                        entry.id
                    );
                    if (preview) {
                        updates[entry.id] = preview;
                    }
                } catch {
                    // ignore
                }
            }
            if (Object.keys(updates).length > 0) {
                setSchematicPreviews((prev) => ({ ...prev, ...updates }));
            }
        };
        fetchPreviews();
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
        // Always deactivate any active tool (including Terrain) when switching tabs
        try {
            terrainBuilderRef?.current?.activateTool(null);
        } catch (_) {}

        // Ensure placement returns to 1×1 on tab change
        if (typeof setPlacementSize === "function") {
            setPlacementSize("single");
        }
        setSearchQuery("");
        setSelectedModelCategory("All");
        setCategoryScrollIndex(0);
        setHasNavigatedCategories(false);
        setNetNavigationCount(0);
        // Notify other components (e.g., ToolBar) of tab change so they can reset state
        window.dispatchEvent(new Event("blockToolsTabChanged"));
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
        // Keep Terrain tool active while changing blocks; deactivate others
        try {
            const manager = terrainBuilderRef?.current?.toolManagerRef?.current;
            const activeToolInstance = manager?.getActiveTool?.();
            const activeToolName = activeToolInstance?.name;
            if (activeToolName && activeToolName !== "terrain") {
                terrainBuilderRef?.current?.activateTool(null);
            }
        } catch (_) {
            terrainBuilderRef?.current?.activateTool(null);
        }
        setCurrentBlockType({
            ...envType,
            isEnvironment: true,
        });
        selectedBlockID = envType.id;
    };

    const handleBlockSelect = (blockType) => {
        console.log("Block selected:", blockType);
        // Keep Terrain tool active while changing blocks; deactivate others
        try {
            const manager = terrainBuilderRef?.current?.toolManagerRef?.current;
            const activeToolInstance = manager?.getActiveTool?.();
            const activeToolName = activeToolInstance?.name;
            if (activeToolName && activeToolName !== "terrain") {
                terrainBuilderRef?.current?.activateTool(null);
            }
        } catch (_) {
            terrainBuilderRef?.current?.activateTool(null);
        }
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

    // Category navigation functions
    const getAllCategories = () => {
        const categories = Array.from(
            new Set(environmentModels.map((m) => m.category || "Misc"))
        ).sort();
        const fullList = ["All", ...categories, "Custom"];
        return fullList.filter((v, i, a) => a.indexOf(v) === i);
    };

    const navigateCategories = (direction) => {
        const categories = getAllCategories();
        const visibleCount = 2; // Number of categories to show at once
        const stepSize = visibleCount; // Move by full visible width (90-100%)
        const maxIndex = Math.max(0, categories.length - visibleCount);

        if (direction === "left") {
            // Only allow left navigation if we have net forward progress
            if (netNavigationCount > 0) {
                setNetNavigationCount((prev) => prev - 1);
                setCategoryScrollIndex((prev) => {
                    const newIndex = prev - stepSize;
                    return Math.max(0, newIndex);
                });
            }
        } else {
            // Only allow right navigation if we haven't reached the end
            if (categoryScrollIndex < maxIndex) {
                setHasNavigatedCategories(true); // Mark that we've navigated
                setNetNavigationCount((prev) => prev + 1);
                setCategoryScrollIndex((prev) => {
                    const newIndex = prev + stepSize;
                    return Math.min(maxIndex, newIndex);
                });
            }
        }
    };

    // Get categories for display - no more repetitions
    const getCategoriesForDisplay = () => {
        return getAllCategories();
    };

    const getVisibleCategories = () => {
        const categories = getAllCategories();
        const visibleCount = 2;
        return categories.slice(
            categoryScrollIndex,
            categoryScrollIndex + visibleCount
        );
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

    const handleDropzoneClick = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    const handleFileInputChange = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            // Create a synthetic event object similar to drag and drop
            const syntheticEvent = {
                preventDefault: () => {},
                currentTarget: {
                    classList: {
                        remove: () => {},
                    },
                },
                dataTransfer: {
                    files: files,
                },
            };
            await handleCustomAssetDropUpload(syntheticEvent);
            // Reset the file input so the same file can be selected again if needed
            e.target.value = "";
        }
    };

    // ---------- Search Filtering ----------
    const normalizedQuery = searchQuery.trim().toLowerCase();

    const isMatch = (str) => {
        if (!normalizedQuery) return true;
        return str && str.toString().toLowerCase().includes(normalizedQuery);
    };

    const visibleDefaultBlocks = blockTypes
        .filter((block) => block.id < 100)
        .filter((block) => isMatch(block.name) || isMatch(block.id));

    const visibleCustomBlocks = customBlocks
        .filter((block) => block.id >= 100 && block.id < 200)
        .filter((block) => isMatch(block.name) || isMatch(block.id));

    // --------- Category Filtering Helpers ---------
    const modelCategoryMatch = (envType) => {
        if (selectedModelCategory === "All") return true;
        if (selectedModelCategory === "Custom") return envType.isCustom;
        return envType.category === selectedModelCategory;
    };

    const visibleDefaultModels = environmentModels
        .filter((envType) => !envType.isCustom)
        .filter(modelCategoryMatch)
        .filter((envType) => isMatch(envType.name) || isMatch(envType.id));

    const visibleCustomModels = environmentModels
        .filter((envType) => envType.isCustom)
        .filter(modelCategoryMatch)
        .filter((envType) => isMatch(envType.name) || isMatch(envType.id));

    const visibleSchematics = schematicList.filter((entry) => {
        return (
            isMatch(entry.name) || isMatch(entry.prompt) || isMatch(entry.id)
        );
    });

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
                <div className="px-3">
                    <input
                        type="text"
                        placeholder="Search..."
                        value={searchQuery}
                        onKeyDown={(e) => e.stopPropagation()}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-md bg-black/30 border border-white/20 text-white focus:outline-none focus:ring-1 focus:ring-white/50 placeholder-white/40"
                    />
                </div>
                {activeTab === "models" && (
                    <div className="flex items-center px-3 py-2">
                        <div className="flex items-center w-full">
                            {hasNavigatedCategories &&
                                netNavigationCount > 0 && (
                                    <button
                                        onClick={() =>
                                            navigateCategories("left")
                                        }
                                        className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white rounded-sm border border-white/20 transition-all mr-2 cursor-pointer"
                                        title="Previous categories"
                                    >
                                        <FaChevronLeft className="w-3 h-3" />
                                    </button>
                                )}

                            <div
                                className={`flex-1 overflow-hidden ${
                                    hasNavigatedCategories
                                        ? "justify-center"
                                        : "justify-start"
                                }`}
                            >
                                <div
                                    className="flex gap-1.5 transition-transform duration-300 ease-in-out"
                                    style={{
                                        transform: `translateX(-${
                                            (categoryScrollIndex / 2) * 120
                                        }px)`, // Translation based on visible count steps
                                    }}
                                >
                                    {getCategoriesForDisplay().map(
                                        (cat, index) => (
                                            <button
                                                key={`${cat}-${index}`}
                                                className={`text-xs cursor-pointer px-2 py-1 rounded-lg border transition-all duration-300 whitespace-nowrap flex-shrink-0 ${
                                                    selectedModelCategory ===
                                                    cat
                                                        ? "bg-white text-black border-white"
                                                        : "bg-white/10 text-white border-white/20 hover:bg-white/20 hover:border-white/40"
                                                }`}
                                                onClick={() =>
                                                    setSelectedModelCategory(
                                                        cat
                                                    )
                                                }
                                            >
                                                {cat}
                                            </button>
                                        )
                                    )}
                                </div>
                            </div>

                            {(() => {
                                const categories = getAllCategories();
                                const maxIndex = Math.max(
                                    0,
                                    categories.length - 2
                                );
                                return (
                                    categoryScrollIndex < maxIndex && (
                                        <button
                                            onClick={() =>
                                                navigateCategories("right")
                                            }
                                            className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white rounded-sm border border-white/20 transition-all ml-2 cursor-pointer"
                                            title="Next categories"
                                        >
                                            <FaChevronRight className="w-3 h-3" />
                                        </button>
                                    )
                                );
                            })()}
                        </div>
                    </div>
                )}
                <div className="block-buttons-grid">
                    {activeTab === "blocks" ? (
                        <>
                            <div className="block-tools-section-label">
                                Default Blocks (ID: 1-99)
                            </div>
                            {visibleDefaultBlocks.map((blockType) => (
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
                                    {visibleCustomBlocks.length > 0 && (
                                        <FaDownload />
                                    )}
                                </button>
                            </div>
                            {visibleCustomBlocks.map((blockType) => (
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
                                {visibleDefaultModels.map((envType) => (
                                    <EnvironmentButton
                                        key={envType.id}
                                        envType={envType}
                                        isSelected={
                                            selectedBlockID === envType.id
                                        }
                                        onSelect={(envType) => {
                                            handleEnvironmentSelect(envType);
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
                                {visibleCustomModels.map((envType) => (
                                    <EnvironmentButton
                                        key={envType.id}
                                        envType={envType}
                                        isSelected={
                                            selectedBlockID === envType.id
                                        }
                                        onSelect={(envType) => {
                                            handleEnvironmentSelect(envType);
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
                                Saved Components
                            </div>
                            {visibleSchematics.length === 0 && (
                                <div className="no-schematics-text">
                                    No schematics saved yet. Generate some using
                                    the AI Assistant!
                                </div>
                            )}
                            {visibleSchematics.map((entry) => (
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
                                        {entry.name && entry.name.trim()
                                            ? entry.name.length > 50
                                                ? entry.name.substring(0, 47) +
                                                  "..."
                                                : entry.name
                                            : entry.prompt.length > 50
                                            ? entry.prompt.substring(0, 47) +
                                              "..."
                                            : entry.prompt}
                                    </div>
                                </div>
                            ))}
                        </>
                    ) : null}
                </div>
                {(activeTab === "blocks" || activeTab === "models") && (
                    <div className="flex w-full px-3 mb-3">
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            accept={
                                activeTab === "blocks"
                                    ? "image/*"
                                    : activeTab === "models"
                                    ? ".gltf,.glb"
                                    : ""
                            }
                            onChange={handleFileInputChange}
                            style={{ display: "none" }}
                        />
                        <div
                            className="texture-drop-zone w-full py-2 h-[120px] cursor-pointer"
                            onDragOver={(e) => {
                                e.preventDefault();
                                e.currentTarget.classList.add("drag-over");
                            }}
                            onDragLeave={(e) => {
                                e.preventDefault();
                                e.currentTarget.classList.remove("drag-over");
                            }}
                            onDrop={handleCustomAssetDropUpload}
                            onClick={handleDropzoneClick}
                        >
                            <div className="drop-zone-content">
                                <div className="drop-zone-icons">
                                    <FaUpload />
                                </div>
                                <div className="drop-zone-text">
                                    {activeTab === "blocks"
                                        ? "Click or drag images to upload new blocks"
                                        : activeTab === "models"
                                        ? "Click or drag .gltf files to add custom models"
                                        : ""}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                {activeTab === "blocks" && (
                    <div className="flex px-3 w-full mb-3">
                        <button
                            className="flex w-full bg-white text-black rounded-md p-2 text-center font-medium justify-center items-center cursor-pointer hover:border-2 hover:border-black transition-all border"
                            onClick={onOpenTextureModal}
                        >
                            Create Texture
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
export default BlockToolsSidebar;
