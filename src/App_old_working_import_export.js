import React, { useState, useEffect, useCallback, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import TerrainBuilder, {
    blockTypes,
    updateBlockTypes,
    getBlockTypes,
} from "./js/TerrainBuilder";
import { environmentModels } from "./js/EnvironmentBuilder";
import EnvironmentButton from "./js/components/EnvironmentButton";
import EnvironmentBuilder from "./js/EnvironmentBuilder";
import * as THREE from "three";
import {
    FaPlus,
    FaMinus,
    FaCube,
    FaBorderStyle,
    FaLock,
    FaLockOpen,
    FaUndo,
    FaRedo,
    FaExpand,
    FaCamera,
    FaTrash,
    FaCircle,
    FaSquare,
    FaVolumeMute,
    FaMountain,
    FaUpload,
    FaDatabase,
    FaTree,
} from "react-icons/fa";
import Tooltip from "./js/components/Tooltip";
import hytopiaLogo from "./images/Hytopia_Tiny.png";
import "./css/App.css";
import { generatePerlinNoise } from "perlin-noise";
import { cameraManager } from "./js/Camera";
import { soundManager } from "./js/Sound";
import BlockButton from "./js/components/BlockButton";
import DebugInfo from "./js/components/DebugInfo";
import { DatabaseManager, STORES } from "./js/DatabaseManager";
import JSZip from "jszip";

/// change this to the version number of the map builder
const version = "1.3";

// Add this near the top of the file, before the App function
const LoadingScreen = () => (
    <div className="loading-screen">
        <img src={hytopiaLogo} alt="Hytopia Logo" className="loading-logo" />
        <div className="loading-spinner"></div>
        <div className="loading-text">
            <i>Loading...</i>
        </div>
        <div className="version-text">HYTOPIA Map Builder v{version}</div>
    </div>
);

const scanDirectory = async () => {
    const context = require.context(
        "../public/assets",
        true,
        /\.(png|jpe?g|glb|gltf|json|wav|mp3|ogg|pem|key|crt)$/
    );
    return context.keys().map((key) => key.replace("./", ""));
};

const handleExport = async (terrain) => {
    try {
        if (!terrain || Object.keys(terrain).length === 0) {
            alert("No map found to export!");
            return;
        }

        const zip = new JSZip();
        const assetsFolder = zip.folder("assets");
        const blocksFolder = assetsFolder.folder("blocks");
        const mapsFolder = assetsFolder.folder("maps");
        const modelsFolder = assetsFolder.folder("models/environment");
        const certsFolder = assetsFolder.folder("certs");
        const soundsFolder = assetsFolder.folder("sounds");
        const skyboxesFolder = assetsFolder.folder("skyboxes");

        // Add custom GLTF models from IndexedDB - Add logging to debug
        const customModels =
            (await DatabaseManager.getData(STORES.CUSTOM_MODELS, "models")) ||
            [];
        console.log("Custom models to export:", customModels);

        for (const model of customModels) {
            try {
                if (!model.data) {
                    console.warn(`No data found for model ${model.name}`);
                    continue;
                }

                // Convert ArrayBuffer to blob
                const blob = new Blob([model.data], {
                    type: "model/gltf+json",
                });
                console.log(`Adding model to zip: ${model.name}.gltf`);

                // Add to zip in the models/environment directory
                await modelsFolder.file(`${model.name}.gltf`, blob);
            } catch (error) {
                console.error(`Failed to add model ${model.name}:`, error);
                continue;
            }
        }

        // 1. Create and add the map JSON
        const environmentObjects =
            (await DatabaseManager.getData(STORES.ENVIRONMENT, "current")) ||
            [];

        const simplifiedTerrain = Object.entries(terrain).reduce(
            (acc, [key, value]) => {
                if (key.split(",").length === 3) {
                    acc[key] = value.id;
                }
                return acc;
            },
            {}
        );

        const allBlockTypes = getBlockTypes();

        const exportData = {
            blockTypes: Array.from(
                new Map(
                    allBlockTypes.map((block) => [
                        block.id,
                        {
                            id: block.id,
                            name: block.name,
                            textureUri: block.isMultiTexture
                                ? `blocks/${block.name}`
                                : `blocks/${block.name}.png`,
                            isCustom: block.isCustom || false,
                        },
                    ])
                ).values()
            ),
            blocks: simplifiedTerrain,
            entities: environmentObjects.reduce((acc, obj) => {
                const entityType = environmentModels.find(
                    (model) => model.modelUrl === obj.modelUrl
                );

                if (entityType) {
                    const quaternion = new THREE.Quaternion();
                    quaternion.setFromEuler(
                        new THREE.Euler(
                            obj.rotation.x,
                            obj.rotation.y,
                            obj.rotation.z
                        )
                    );

                    const modelUri = entityType.isCustom
                        ? `models/environment/${entityType.name}.gltf`
                        : obj.modelUrl.replace("assets/", "");

                    // Calculate adjusted Y position
                    const boundingBoxHeight = entityType.boundingBoxHeight || 1;
                    const verticalOffset =
                        (boundingBoxHeight * obj.scale.y) / 2;
                    const adjustedY = obj.position.y + 0.5 + verticalOffset;

                    // Use adjusted Y in the key
                    const key = `${obj.position.x},${adjustedY},${obj.position.z}`;

                    acc[key] = {
                        modelUri: modelUri,
                        modelLoopedAnimations: entityType.animations || [
                            "idle",
                        ],
                        modelScale: obj.scale.x,
                        name: entityType.name,
                        rigidBodyOptions: {
                            type: "kinematic_velocity",
                            rotation: {
                                x: quaternion.x,
                                y: quaternion.y,
                                z: quaternion.z,
                                w: quaternion.w,
                            },
                        },
                    };
                }
                return acc;
            }, {}),
        };

        // Add map JSON to the maps folder
        mapsFolder.file("terrain.json", JSON.stringify(exportData, null, 2));

        // 2. Add custom block textures from IndexedDB
        const customBlocks =
            (await DatabaseManager.getData(STORES.CUSTOM_BLOCKS, "blocks")) ||
            [];
        for (const block of customBlocks) {
            // Convert base64 to blob
            const base64Data = block.textureUri.split(",")[1];
            const binaryData = atob(base64Data);
            const array = new Uint8Array(binaryData.length);
            for (let i = 0; i < binaryData.length; i++) {
                array[i] = binaryData.charCodeAt(i);
            }
            const blob = new Blob([array], { type: "image/png" });

            // Add to zip
            blocksFolder.file(`${block.name}.png`, blob);
        }

        // 3. Dynamically add all default assets
        const addDefaultassets = async () => {
            try {
                // Scan assets directory for all files
                const files = await scanDirectory();

                // Add each file to the zip
                const promises = [];
                for (const filePath of files) {
                    const task = new Promise(async (resolve) => {
                        try {
                            const response = await fetch(`/assets/${filePath}`);
                            if (!response.ok) {
                                console.warn(
                                    `Failed to fetch file ${filePath}`
                                );
                                return;
                            }

                            const blob = await response.blob();

                            // Special handling for different asset types
                            if (filePath.includes("certs/")) {
                                // Just store the cert file directly in the certs folder
                                const certFileName = filePath.split("/").pop();
                                certsFolder.file(certFileName, blob);
                            } else if (filePath.startsWith("sounds/")) {
                                soundsFolder.file(
                                    filePath.replace("sounds/", ""),
                                    blob
                                );
                            } else if (filePath.startsWith("skyboxes/")) {
                                skyboxesFolder.file(
                                    filePath.replace("skyboxes/", ""),
                                    blob
                                );
                            } else {
                                assetsFolder.file(filePath, blob);
                            }
                        } catch (error) {
                            console.warn(
                                `Failed to add file ${filePath}:`,
                                error
                            );
                            return;
                        } finally {
                            resolve();
                        }
                    });
                    promises.push(task);
                }

                await Promise.all(promises);
            } catch (error) {
                console.error("Error adding default assets:", error);
                throw error;
            }
        };

        await addDefaultassets();

        // 4. Generate and download the zip - Add logging before generating
        console.log("Folders in zip:", Object.keys(zip.files));
        const content = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(content);
        const a = document.createElement("a");
        a.href = url;
        a.download = "hytopia_build_" + version + "_assets.zip";
        a.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error("Error exporting map:", error);
        alert("Error exporting map. Please try again.");
    }
};

const handleExportMap = async (terrain) => {
    try {
        if (!terrain || Object.keys(terrain).length === 0) {
            alert("No map found to export!");
            return;
        }

        // Create the map data structure
        const environmentObjects =
            (await DatabaseManager.getData(STORES.ENVIRONMENT, "current")) ||
            [];

        const simplifiedTerrain = Object.entries(terrain).reduce(
            (acc, [key, value]) => {
                if (key.split(",").length === 3) {
                    acc[key] = value.id;
                }
                return acc;
            },
            {}
        );

        const allBlockTypes = getBlockTypes();

        const exportData = {
            blockTypes: Array.from(
                new Map(
                    allBlockTypes.map((block) => [
                        block.id,
                        {
                            id: block.id,
                            name: block.name,
                            textureUri: block.isMultiTexture
                                ? `blocks/${block.name}`
                                : `blocks/${block.name}.png`,
                            isCustom: block.isCustom || false,
                        },
                    ])
                ).values()
            ),
            blocks: simplifiedTerrain,
            entities: environmentObjects.reduce((acc, obj) => {
                const entityType = environmentModels.find(
                    (model) => model.modelUrl === obj.modelUrl
                );

                if (entityType) {
                    const quaternion = new THREE.Quaternion();
                    quaternion.setFromEuler(
                        new THREE.Euler(
                            obj.rotation.x,
                            obj.rotation.y,
                            obj.rotation.z
                        )
                    );

                    const modelUri = entityType.isCustom
                        ? `models/environment/${entityType.name}.gltf`
                        : obj.modelUrl.replace("assets/", "");

                    // Calculate adjusted Y position
                    const boundingBoxHeight = entityType.boundingBoxHeight || 1;
                    const verticalOffset =
                        (boundingBoxHeight * obj.scale.y) / 2;
                    const adjustedY = obj.position.y + 0.5 + verticalOffset;

                    // Use adjusted Y in the key
                    const key = `${obj.position.x},${adjustedY},${obj.position.z}`;

                    acc[key] = {
                        modelUri: modelUri,
                        modelLoopedAnimations: entityType.animations || [
                            "idle",
                        ],
                        modelScale: obj.scale.x,
                        name: entityType.name,
                        rigidBodyOptions: {
                            type: "kinematic_velocity",
                            rotation: {
                                x: quaternion.x,
                                y: quaternion.y,
                                z: quaternion.z,
                                w: quaternion.w,
                            },
                        },
                    };
                }
                return acc;
            }, {}),
        };

        // Create and download the JSON file
        const jsonContent = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonContent], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "terrain.json";
        a.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error("Error exporting map:", error);
        alert("Error exporting map. Please try again.");
    }
};

function App() {
    const [terrain, setTerrainState] = useState({});
    const [currentBlockType, setCurrentBlockType] = useState(blockTypes[0]);
    const [mode, setMode] = useState("add");
    const [showDimensionsModal, setShowDimensionsModal] = useState(false);
    const [dimensions, setDimensions] = useState({
        width: 1,
        length: 1,
        height: 1,
    });
    const [debugInfo, setDebugInfo] = useState({
        mouse: {},
        preview: {},
        grid: {},
    });
    const [totalBlocks, setTotalBlocks] = useState(0);
    const [axisLockEnabled, setAxisLockEnabled] = useState(false);
    const [redoStates, setRedoStates] = useState([]);
    const [gridSize, setGridSize] = useState(100);
    const [showGridSizeModal, setShowGridSizeModal] = useState(false);
    const [newGridSize, setNewGridSize] = useState(100);
    const [showBorderModal, setShowBorderModal] = useState(false);
    const [borderDimensions, setBorderDimensions] = useState({
        width: 1,
        length: 1,
        height: 1,
    });
    const [cameraReset, setCameraReset] = useState(false);
    const [cameraAngle, setCameraAngle] = useState(0);
    const [placementSize, setPlacementSize] = useState("single");
    const [isMuted, setIsMuted] = useState(false);
    const [activeTab, setActiveTab] = useState("blocks"); // 'blocks' or 'environment'
    const [showTerrainModal, setShowTerrainModal] = useState(false);
    const [terrainSettings, setTerrainSettings] = useState({
        width: 32,
        length: 32,
        height: 16,
        scale: 1, // Fixed at 1% (lowest value)
        roughness: 85, // Default value in middle of new range
        clearMap: false, // Add this new setting
    });
    const [objectScale, setObjectScale] = useState(1);
    const [pageIsLoaded, setPageIsLoaded] = useState(false);
    const [currentDraggingBlock, setCurrentDraggingBlock] = useState(null);
    const handleDropRef = useRef(null);
    const [customBlocks, setCustomBlocks] = useState([]);

    const terrainRef = useRef(terrain);
    const environmentBuilder = useRef(null);

    // Add new state for environment preview
    const [previewScale, setPreviewScale] = useState(1);
    const [previewRotation, setPreviewRotation] = useState(new THREE.Euler());

    const [scene, setScene] = useState(null);
    const [totalEnvironmentObjects, setTotalEnvironmentObjects] = useState(0);

    useEffect(() => {
        terrainRef.current = terrain;
    }, [terrain]);

    useEffect(() => {
        const count = Object.keys(terrain).length;
        setTotalBlocks(count);
    }, [terrain]);

    const undo = useCallback(async () => {
        try {
            const undoStates =
                (await DatabaseManager.getData(STORES.UNDO, "states")) || [];
            if (undoStates.length === 0) {
                console.log("No undo states available");
                return;
            }

            const currentState = {
                terrain: { ...terrain },
                environment:
                    (await DatabaseManager.getData(
                        STORES.ENVIRONMENT,
                        "current"
                    )) || [],
            };

            const [stateToRestore, ...remainingUndoStates] = undoStates;
            console.log("Restoring state:", stateToRestore);

            // 1. First save the current state to redo and update undo states
            await Promise.all([
                DatabaseManager.saveData(STORES.REDO, "states", [
                    currentState,
                    ...redoStates,
                ]),
                DatabaseManager.saveData(
                    STORES.UNDO,
                    "states",
                    remainingUndoStates
                ),
            ]);

            // 2. Update React state for undo/redo
            setRedoStates((prev) => [currentState, ...prev]);

            // 3. Save and update the state we're restoring
            await Promise.all([
                DatabaseManager.saveData(
                    STORES.TERRAIN,
                    "current",
                    stateToRestore.terrain
                ),
                DatabaseManager.saveData(
                    STORES.ENVIRONMENT,
                    "current",
                    stateToRestore.environment
                ),
            ]);

            // 4. Update terrain state
            setTerrainState(stateToRestore.terrain);

            // 5. Reload environment only if we have environment data
            if (
                stateToRestore.environment &&
                stateToRestore.environment.length > 0
            ) {
                console.log(
                    "Restoring environment with data:",
                    stateToRestore.environment
                );
                if (environmentBuilder.current) {
                    await environmentBuilder.current.loadSavedEnvironment();
                }
            } else {
                console.log(
                    "No environment data to restore, clearing environment"
                );
                if (environmentBuilder.current) {
                    await environmentBuilder.current.clearEnvironments();
                }
            }
        } catch (error) {
            console.error("Error during undo:", error);
        }
    }, [terrain, redoStates]);

    const redo = useCallback(async () => {
        try {
            const redoStates =
                (await DatabaseManager.getData(STORES.REDO, "states")) || [];
            if (redoStates.length === 0) return;

            const currentState = {
                terrain: { ...terrain },
                environment:
                    (await DatabaseManager.getData(
                        STORES.ENVIRONMENT,
                        "current"
                    )) || [],
            };

            const [stateToRestore, ...remainingRedoStates] = redoStates;

            // Save current state to undo
            const undoStates =
                (await DatabaseManager.getData(STORES.UNDO, "states")) || [];
            await DatabaseManager.saveData(STORES.UNDO, "states", [
                currentState,
                ...undoStates,
            ]);

            // Update redo states
            await DatabaseManager.saveData(
                STORES.REDO,
                "states",
                remainingRedoStates
            );
            setRedoStates(remainingRedoStates);

            // First save the state
            await Promise.all([
                DatabaseManager.saveData(
                    STORES.TERRAIN,
                    "current",
                    stateToRestore.terrain
                ),
                DatabaseManager.saveData(
                    STORES.ENVIRONMENT,
                    "current",
                    stateToRestore.environment
                ),
            ]);

            // Then update the UI and reload environment
            setTerrainState(stateToRestore.terrain);

            // Wait a frame to ensure DB write is complete
            await new Promise((resolve) => setTimeout(resolve, 0));

            if (environmentBuilder.current) {
                await environmentBuilder.current.loadSavedEnvironment();
            }
        } catch (error) {
            console.error("Error during redo:", error);
        }
    }, [terrain, redoStates]);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.ctrlKey && event.key === "z") {
                event.preventDefault();
                undo();
            } else if (event.ctrlKey && event.key === "y") {
                event.preventDefault();
                redo();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [undo, redo]);

    const handleImport = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const content = e.target.result;
                const importedData = JSON.parse(content);

                // First, handle custom blocks if present
                if (importedData.blockTypes) {
                    const customBlocksToImport = importedData.blockTypes.filter(
                        (block) => block.isCustom
                    );
                    if (customBlocksToImport.length > 0) {
                        const existingBlocksByName = new Map(
                            customBlocks.map((block) => [block.name, block])
                        );

                        const maxId = Math.max(
                            ...customBlocks.map((block) => block.id),
                            99
                        );

                        let nextId = maxId + 1;
                        const missingTextures = [];
                        const loadedCustomBlocks = await Promise.all(
                            customBlocksToImport.map(async (block) => {
                                const existingBlock = existingBlocksByName.get(
                                    block.name
                                );

                                // If block doesn't exist in our DB, add it to missing textures
                                if (!existingBlock) {
                                    missingTextures.push(
                                        `${block.name} (ID: ${block.id})`
                                    );
                                    return {
                                        ...block,
                                        id: nextId++,
                                        textureUri:
                                            "./assets/blocks/error/error.png", // Use error texture instead of empty string
                                        isCustom: true, // Ensure isCustom flag is set
                                    };
                                }

                                return existingBlock;
                            })
                        );

                        // Show alert for missing textures if any
                        if (missingTextures.length > 0) {
                            alert(
                                `Some textures missing from import, please add them to the block pallet:\n\n${missingTextures.join("\n")}`
                            );
                        }

                        const validCustomBlocks = loadedCustomBlocks.filter(
                            (block) => block !== null
                        );

                        if (validCustomBlocks.length > 0) {
                            const processedBlocks = new Map([
                                ...customBlocks.map((block) => [
                                    block.name,
                                    block,
                                ]),
                                ...validCustomBlocks.map((block) => [
                                    block.name,
                                    block,
                                ]),
                            ]);

                            const updatedBlocks = Array.from(
                                processedBlocks.values()
                            );
                            await DatabaseManager.saveData(
                                STORES.CUSTOM_BLOCKS,
                                "blocks",
                                updatedBlocks
                            );
                            setCustomBlocks(updatedBlocks);
                            updateBlockTypes(updatedBlocks);
                        }
                    }
                }

                // Handle terrain blocks with ID mapping
                if (importedData.blocks) {
                    // Clear existing terrain first
                    setTerrainState({});
                    setRedoStates([]);

                    const importedTerrain = importedData.blocks;
                    let minX = Infinity,
                        maxX = -Infinity,
                        minZ = Infinity,
                        maxZ = -Infinity;

                    // Create ID mapping for blocks
                    const idMapping = new Map();
                    const existingBlockTypes = getBlockTypes();

                    // Scan imported blocks and create mapping
                    Object.values(importedTerrain).forEach((blockId) => {
                        if (!idMapping.has(blockId)) {
                            const importedBlockType =
                                importedData.blockTypes.find(
                                    (b) => b.id === blockId
                                );
                            if (importedBlockType) {
                                const matchingExistingBlock =
                                    existingBlockTypes.find(
                                        (b) => b.name === importedBlockType.name
                                    );
                                if (
                                    matchingExistingBlock &&
                                    matchingExistingBlock.id !== blockId
                                ) {
                                    idMapping.set(
                                        blockId,
                                        matchingExistingBlock.id
                                    );
                                    console.log(
                                        `Mapping block ID ${blockId} (${importedBlockType.name}) to ${matchingExistingBlock.id}`
                                    );
                                }
                            }
                        }
                    });

                    // Calculate center for positioning
                    Object.keys(importedTerrain).forEach((key) => {
                        const [x, , z] = key.split(",").map(Number);
                        minX = Math.min(minX, x);
                        maxX = Math.max(maxX, x);
                        minZ = Math.min(minZ, z);
                        maxZ = Math.max(maxZ, z);
                    });

                    const centerX = (minX + maxX) / 2;
                    const centerZ = (minZ + maxZ) / 2;

                    // Create new terrain with mapped block types
                    const reconstructedTerrain = Object.entries(
                        importedTerrain
                    ).reduce((acc, [key, importedId]) => {
                        const [x, y, z] = key.split(",").map(Number);
                        const newX = Math.round(x - centerX);
                        const newZ = Math.round(z - centerZ);
                        const newKey = `${newX},${y},${newZ}`;

                        // Use mapped ID if exists, otherwise use original ID
                        const mappedId =
                            idMapping.get(importedId) || importedId;
                        const validType =
                            existingBlockTypes.find(
                                (block) => block.id === mappedId
                            ) || blockTypes[0];

                        acc[newKey] = validType;
                        return acc;
                    }, {});

                    // Update terrain state and save to database
                    setTerrainState(reconstructedTerrain);
                    await DatabaseManager.saveData(
                        STORES.TERRAIN,
                        "current",
                        reconstructedTerrain
                    );

                    // Clear environment objects
                    if (environmentBuilder.current) {
                        environmentBuilder.current.clearEnvironments();
                    }
                    await DatabaseManager.saveData(
                        STORES.ENVIRONMENT,
                        "current",
                        []
                    );

                    // Import environment objects if present
                    if (importedData.entities) {
                        const environmentObjects = Object.entries(
                            importedData.entities
                        )
                            .map(([key, entity]) => {
                                const [x, y, z] = key.split(",").map(Number);

                                // Convert rotation from quaternion to euler angles
                                const quaternion = new THREE.Quaternion(
                                    entity.rigidBodyOptions.rotation.x,
                                    entity.rigidBodyOptions.rotation.y,
                                    entity.rigidBodyOptions.rotation.z,
                                    entity.rigidBodyOptions.rotation.w
                                );
                                const euler =
                                    new THREE.Euler().setFromQuaternion(
                                        quaternion
                                    );

                                // Get model name from the file path - this should never be undefined
                                const modelName = entity.modelUri
                                    .split("/")
                                    .pop()
                                    .replace(".gltf", "");
                                const matchingModel = environmentModels.find(
                                    (model) => model.name === modelName
                                );

                                // Calculate the vertical offset to subtract
                                const boundingBoxHeight =
                                    matchingModel?.boundingBoxHeight || 1;
                                const verticalOffset =
                                    (boundingBoxHeight * entity.modelScale) / 2;
                                const adjustedY = y - 0.5 - verticalOffset;

                                return {
                                    position: { x, y: adjustedY, z },
                                    rotation: {
                                        x: euler.x,
                                        y: euler.y,
                                        z: euler.z,
                                    },
                                    scale: {
                                        x: entity.modelScale,
                                        y: entity.modelScale,
                                        z: entity.modelScale,
                                    },
                                    modelUrl: matchingModel
                                        ? matchingModel.modelUrl
                                        : entity.modelUri,
                                    name: modelName, // Use name instead of modelName for the property
                                };
                            })
                            .filter((obj) => obj !== null);

                        if (environmentObjects.length > 0) {
                            await DatabaseManager.saveData(
                                STORES.ENVIRONMENT,
                                "current",
                                environmentObjects
                            );
                            if (environmentBuilder.current) {
                                await environmentBuilder.current.loadSavedEnvironment();
                            }
                        }
                    } else {
                        // If no entities, ensure environment data is cleared
                        await DatabaseManager.saveData(
                            STORES.ENVIRONMENT,
                            "current",
                            []
                        );
                    }
                }

                // Reset file input
                event.target.value = "";

                console.log("Map imported successfully");
            } catch (error) {
                console.error("Error parsing JSON:", error);
                alert("Invalid JSON file");
                event.target.value = "";
            }
        };
        reader.readAsText(file);
    };

    // Add a new useEffect to handle loading initial values from DB
    useEffect(() => {
        const loadSettings = async () => {
            try {
                const settings =
                    (await DatabaseManager.getData(
                        STORES.SETTINGS,
                        "userPreferences"
                    )) || {};

                // Load selected block
                const savedBlockId = settings.selectedBlock;
                if (savedBlockId) {
                    const block = blockTypes.find(
                        (b) => b.id === parseInt(savedBlockId)
                    );
                    if (block) setCurrentBlockType(block);
                }

                // Load grid size
                if (settings.gridSize) {
                    setGridSize(parseInt(settings.gridSize));
                }

                // Load camera angle
                if (settings.cameraAngle !== undefined) {
                    setCameraAngle(parseFloat(settings.cameraAngle));
                }

                // Load mute state
                if (settings.isMuted !== undefined) {
                    setIsMuted(settings.isMuted);
                    if (settings.isMuted) {
                        soundManager.mute();
                    }
                }
            } catch (error) {
                console.error("Error loading settings from DB:", error);
            }
        };

        loadSettings();
    }, []);

    // Update custom blocks effect to also update blockTypes
    useEffect(() => {
        const loadCustomBlocks = async () => {
            try {
                const savedBlocks =
                    (await DatabaseManager.getData(
                        STORES.CUSTOM_BLOCKS,
                        "blocks"
                    )) || [];
                setCustomBlocks(savedBlocks);
                updateBlockTypes(savedBlocks); // Update blockTypes with custom blocks
            } catch (error) {
                console.error("Error loading custom blocks:", error);
            }
        };
        loadCustomBlocks();
    }, []);

    const handleModeChange = (newMode) => {
        setMode(newMode);
    };

    const handleGenerateBlocks = (fillInterior = true) => {
        const { width, length, height } = dimensions;
        const startX = -Math.floor(width / 2) + 1;
        const startZ = -Math.floor(length / 2) + 1;

        setTerrainState((prevTerrain) => {
            const newTerrain = { ...prevTerrain };
            for (let x = 0; x < width; x++) {
                for (let z = 0; z < length; z++) {
                    if (
                        fillInterior ||
                        x === 0 ||
                        x === width - 1 ||
                        z === 0 ||
                        z === length - 1
                    ) {
                        for (let y = 0; y < height; y++) {
                            const key = `${startX + x},${y},${startZ + z}`;
                            newTerrain[key] = { id: currentBlockType.id };
                        }
                    }
                }
            }
            return newTerrain;
        });

        setShowDimensionsModal(false);
    };

    const handleGridSizeChange = async (size) => {
        setGridSize(size);
        try {
            const settings =
                (await DatabaseManager.getData(
                    STORES.SETTINGS,
                    "userPreferences"
                )) || {};
            await DatabaseManager.saveData(STORES.SETTINGS, "userPreferences", {
                ...settings,
                gridSize: size,
            });
        } catch (error) {
            console.error("Error saving grid size to DB:", error);
        }
    };

    const handleGenerateBorder = () => {
        const { width, length, height } = borderDimensions;
        const startX = -Math.floor(width / 2) + 1;
        const startZ = -Math.floor(length / 2) + 1;

        setTerrainState((prevTerrain) => {
            const newTerrain = { ...prevTerrain };
            for (let x = 0; x < width; x++) {
                for (let z = 0; z < length; z++) {
                    if (
                        x === 0 ||
                        x === width - 1 ||
                        z === 0 ||
                        z === length - 1
                    ) {
                        for (let y = 0; y < height; y++) {
                            const key = `${startX + x},${y},${startZ + z}`;
                            newTerrain[key] = { id: currentBlockType.id };
                        }
                    }
                }
            }
            return newTerrain;
        });

        setShowBorderModal(false);
    };

    const handleResetCamera = () => {
        setCameraReset((prev) => !prev);
    };

    const handleClearMap = async () => {
        if (
            window.confirm(
                "Are you sure you want to clear the entire map? This action cannot be undone."
            )
        ) {
            try {
                // Clear terrain state
                setTerrainState({});
                setTotalBlocks(0);
                setRedoStates([]);

                // Clear environment objects
                if (environmentBuilder.current) {
                    environmentBuilder.current.clearEnvironments();
                }

                // Clear data from IndexedDB
                await DatabaseManager.saveData(STORES.TERRAIN, "current", {});
                await DatabaseManager.saveData(
                    STORES.ENVIRONMENT,
                    "current",
                    []
                );

                console.log("Map cleared and database reset");
            } catch (error) {
                console.error("Error clearing map data:", error);
                alert("There was an error clearing the map. Please try again.");
            }
        }
    };

    const handleSliderChange = async (event) => {
        const newAngle = parseFloat(event.target.value);
        setCameraAngle(newAngle);
        try {
            const settings =
                (await DatabaseManager.getData(
                    STORES.SETTINGS,
                    "userPreferences"
                )) || {};
            await DatabaseManager.saveData(STORES.SETTINGS, "userPreferences", {
                ...settings,
                cameraAngle: newAngle,
            });
        } catch (error) {
            console.error("Error saving camera angle to DB:", error);
        }
    };

    const handleCameraAngleChange = useCallback((newAngle) => {
        setCameraAngle(newAngle);
    }, []);

    const updateTerrainWithHistory = useCallback((newTerrain) => {
        setTerrainState(newTerrain);
    }, []);

    // Replace the existing audio effects with this simplified version
    useEffect(() => {
        const handleFirstInteraction = () => {
            if (!isMuted) {
                // backgroundMusic.play().catch(err => console.log('Music playback error:', err));
            }
            // Remove event listeners after first interaction
            document.removeEventListener("click", handleFirstInteraction);
            document.removeEventListener("keydown", handleFirstInteraction);
        };

        document.addEventListener("click", handleFirstInteraction);
        document.addEventListener("keydown", handleFirstInteraction);

        return () => {
            // backgroundMusic.pause();
            document.removeEventListener("click", handleFirstInteraction);
            document.removeEventListener("keydown", handleFirstInteraction);
        };
    }, [isMuted]);

    // Simplify the click handler
    useEffect(() => {
        let clickTimeout;

        const handleClick = (event) => {
            if (event.target.closest("button") && !isMuted) {
                // Clear any existing timeout
                if (clickTimeout) {
                    clearTimeout(clickTimeout);
                }

                // Reset and play sound
                soundManager.playUIClick();

                // Set a timeout to prevent rapid-fire sound playing
                clickTimeout = setTimeout(() => {
                    clickTimeout = null;
                }, 50);
            }
        };

        document.addEventListener("click", handleClick);
        return () => {
            document.removeEventListener("click", handleClick);
            if (clickTimeout) {
                clearTimeout(clickTimeout);
            }
        };
    }, [isMuted]);

    // Add effects to save changes to localStorage
    useEffect(() => {
        localStorage.setItem("selectedBlock", currentBlockType.id);
    }, [currentBlockType]);

    useEffect(() => {
        localStorage.setItem("gridSize", gridSize);
    }, [gridSize]);

    useEffect(() => {
        localStorage.setItem("isMuted", isMuted);
    }, [isMuted]);

    useEffect(() => {
        localStorage.setItem("cameraAngle", cameraAngle);
    }, [cameraAngle]);

    const generateTerrain = async () => {
        const { width, length, height, scale, roughness, clearMap } =
            terrainSettings;
        const startX = -Math.floor(width / 2) + 1;
        const startZ = -Math.floor(length / 2) + 1;

        const octaves = Math.max(1, Math.floor(roughness / 20));
        const persistence = scale / 100;

        try {
            const noise = generatePerlinNoise(width, length, {
                octaveCount: octaves,
                amplitude: 1,
                persistence: persistence,
            });

            const newTerrain = clearMap ? {} : { ...terrain };

            // Add water layer
            const waterBlock =
                blockTypes.find((block) =>
                    block.name.toLowerCase().includes("water")
                ) || blockTypes[0];

            for (let x = 0; x < width; x++) {
                for (let z = 0; z < length; z++) {
                    const key = `${startX + x},0,${startZ + z}`;
                    newTerrain[key] = { id: waterBlock.id };
                }
            }

            // Generate terrain
            for (let x = 0; x < width; x++) {
                for (let z = 0; z < length; z++) {
                    const noiseValue = noise[x + z * width];
                    const terrainHeight = Math.max(
                        0,
                        Math.floor(noiseValue * height)
                    );

                    for (let y = 0; y < terrainHeight; y++) {
                        const key = `${startX + x},${y},${startZ + z}`;
                        newTerrain[key] = { id: currentBlockType.id };
                    }
                }
            }

            // Save to IndexedDB
            try {
                await DatabaseManager.saveData(
                    STORES.TERRAIN,
                    "current",
                    newTerrain
                );
            } catch (error) {
                console.warn(
                    "Failed to save generated terrain to IndexedDB:",
                    error
                );
            }

            setTerrainState(newTerrain);
            setShowTerrainModal(false);
        } catch (error) {
            console.error("Error generating terrain:", error);
            alert(
                "Error generating terrain. Please try different dimensions or settings."
            );
        }
    };

    useEffect(() => {
        cameraManager.setAngleChangeCallback(handleCameraAngleChange);
    }, [handleCameraAngleChange]);

    const handleMuteToggle = async () => {
        const newMuteState = !isMuted;
        setIsMuted(newMuteState);
        if (newMuteState) {
            soundManager.mute();
        } else {
            soundManager.unmute();
        }

        try {
            const settings =
                (await DatabaseManager.getData(
                    STORES.SETTINGS,
                    "userPreferences"
                )) || {};
            await DatabaseManager.saveData(STORES.SETTINGS, "userPreferences", {
                ...settings,
                isMuted: newMuteState,
            });
        } catch (error) {
            console.error("Error saving mute state to DB:", error);
        }
    };

    // Add this function to handle drag start
    const handleDragStart = (blockId) => {
        console.log("Drag started with block:", blockId);
        setCurrentDraggingBlock(blockId);
    };

    // Update handleDrop to update blockTypes
    const handleDrop = (e) => {
        e.preventDefault();
        e.currentTarget.classList.remove("drag-over");

        const files = Array.from(e.dataTransfer.files);

        if (activeTab === "blocks") {
            // Handle image files for blocks
            const imageFiles = files.filter((file) =>
                file.type.startsWith("image/")
            );

            if (imageFiles.length > 0) {
                imageFiles.forEach((file) => {
                    const reader = new FileReader();
                    reader.onload = async () => {
                        const fileName = file.name.replace(/\.[^/.]+$/, "");

                        // Check if a block with this name already exists
                        const existingBlockIndex = customBlocks.findIndex(
                            (block) => block.name === fileName
                        );

                        if (existingBlockIndex !== -1) {
                            // Update existing block with new texture
                            const updatedBlocks = [...customBlocks];
                            updatedBlocks[existingBlockIndex] = {
                                ...updatedBlocks[existingBlockIndex],
                                textureUri: reader.result, // Store base64 data
                            };
                            setCustomBlocks(updatedBlocks);
                            updateBlockTypes(updatedBlocks);

                            try {
                                await DatabaseManager.saveData(
                                    STORES.CUSTOM_BLOCKS,
                                    "blocks",
                                    updatedBlocks
                                );
                                console.log(
                                    `Updated texture for existing block: ${fileName}`
                                );
                                alert(
                                    `Updated texture for existing block: ${fileName}\n\n Please refresh the page to see the changes.`
                                );
                            } catch (error) {
                                console.error(
                                    "Error updating custom block:",
                                    error
                                );
                            }
                        } else {
                            // Find the highest existing custom block ID
                            const maxId = Math.max(
                                ...customBlocks.map((block) => block.id),
                                99
                            );

                            // Create new block
                            const newBlockType = {
                                id: maxId + 1,
                                name: fileName,
                                textureUri: reader.result, // Store base64 data
                                isCustom: true,
                            };

                            const updatedBlocks = [
                                ...customBlocks,
                                newBlockType,
                            ];
                            setCustomBlocks(updatedBlocks);
                            updateBlockTypes(updatedBlocks);

                            try {
                                await DatabaseManager.saveData(
                                    STORES.CUSTOM_BLOCKS,
                                    "blocks",
                                    updatedBlocks
                                );
                            } catch (error) {
                                console.error(
                                    "Error saving custom blocks:",
                                    error
                                );
                            }
                        }
                    };
                    reader.readAsDataURL(file); // Read as base64 data URL
                });
            }
        } else if (activeTab === "environment") {
            const gltfFiles = files.filter((file) =>
                file.name.endsWith(".gltf")
            );

            if (gltfFiles.length > 0) {
                gltfFiles.reduce((promise, file) => {
                    return promise.then(() => {
                        return new Promise((resolve) => {
                            const fileName = file.name.replace(/\.[^/.]+$/, ""); // Remove extension

                            // Check if model with this name already exists
                            const modelExists = environmentModels.some(
                                (model) =>
                                    model.name.toLowerCase() ===
                                    fileName.toLowerCase()
                            );

                            if (modelExists) {
                                alert(
                                    `A model named "${fileName}" already exists. Please rename the file and try again.`
                                );
                                resolve();
                                return;
                            }

                            // Rest of the existing model loading code
                            const reader = new FileReader();
                            reader.onload = async () => {
                                try {
                                    // Get existing custom models
                                    const existingModels =
                                        (await DatabaseManager.getData(
                                            STORES.CUSTOM_MODELS,
                                            "models"
                                        )) || [];

                                    // Create the model data
                                    const modelData = {
                                        name: fileName,
                                        data: reader.result,
                                        timestamp: Date.now(),
                                    };

                                    // Add to existing models
                                    const updatedModels = [
                                        ...existingModels,
                                        modelData,
                                    ];

                                    // Save to IndexedDB
                                    await DatabaseManager.saveData(
                                        STORES.CUSTOM_MODELS,
                                        "models",
                                        updatedModels
                                    );

                                    // Create a temporary URL for immediate use
                                    const blob = new Blob([reader.result], {
                                        type: "model/gltf+json",
                                    });
                                    const fileUrl = URL.createObjectURL(blob);

                                    // Create new environment model
                                    const newEnvironmentModel = {
                                        id:
                                            Math.max(
                                                ...environmentModels
                                                    .filter(
                                                        (model) =>
                                                            model.isCustom
                                                    )
                                                    .map((model) => model.id),
                                                199
                                            ) + 1,
                                        name: fileName,
                                        modelUrl: fileUrl,
                                        isEnvironment: true,
                                        isCustom: true,
                                        animations: ["idle"],
                                    };

                                    // Add to environment models array
                                    environmentModels.push(newEnvironmentModel);

                                    // Preload the new model
                                    if (environmentBuilder.current) {
                                        await environmentBuilder.current.loadCustomModel(
                                            newEnvironmentModel
                                        );
                                        console.log(
                                            `Successfully loaded custom model: ${fileName}`
                                        );
                                    }
                                } catch (error) {
                                    console.error(
                                        `Error processing model ${fileName}:`,
                                        error
                                    );
                                }
                                resolve();
                            };
                            reader.readAsArrayBuffer(file);
                        });
                    });
                }, Promise.resolve());
            }
        }
    };

    const handleDeleteCustomBlock = async (blockType) => {
        const confirmMessage = `Deleting "${blockType.name}" will remove any block of this type from the scene and CANNOT BE UNDONE! Are you sure you want to proceed?`;

        if (window.confirm(confirmMessage)) {
            const updatedBlocks = customBlocks.filter(
                (b) => b.id !== blockType.id
            );
            setCustomBlocks(updatedBlocks);

            // Save updated blocks to IndexedDB
            try {
                await DatabaseManager.saveData(
                    STORES.CUSTOM_BLOCKS,
                    "blocks",
                    updatedBlocks
                );

                // Update terrain to remove deleted block instances
                const currentTerrain =
                    (await DatabaseManager.getData(
                        STORES.TERRAIN,
                        "current"
                    )) || {};
                const newTerrain = Object.fromEntries(
                    Object.entries(currentTerrain).filter(
                        ([_, block]) => block.id !== blockType.id
                    )
                );
                await DatabaseManager.saveData(
                    STORES.TERRAIN,
                    "current",
                    newTerrain
                );
                updateTerrainWithHistory(newTerrain);
            } catch (error) {
                console.error(
                    "Error updating database after block deletion:",
                    error
                );
            }
        }
    };

    // Handler for environment button clicks
    const handleEnvironmentSelect = (envType) => {
        // Set the current block type to the environment model
        setCurrentBlockType({
            ...envType,
            isEnvironment: true,
        });

        // Set mode to 'add'
        setMode("add");
    };

    // Update the tab switching logic
    const handleTabChange = (newTab) => {
        // Remove any existing environment preview when switching tabs
        if (environmentBuilder.current) {
            environmentBuilder.current.removePreview();
        }

        // Reset current block type to default block when switching to blocks tab
        if (newTab === "blocks") {
            setCurrentBlockType(blockTypes[0]);
        }

        setActiveTab(newTab);
    };

    // Add this function to clear the database
    const clearDatabase = async () => {
        if (
            window.confirm(
                "Are you sure you want to clear all saved data? This cannot be undone."
            )
        ) {
            try {
                await DatabaseManager.deleteData(STORES.TERRAIN, "current");
                await DatabaseManager.deleteData(STORES.ENVIRONMENT, "current");
                await DatabaseManager.deleteData(
                    STORES.CUSTOM_BLOCKS,
                    "blocks"
                );
                await DatabaseManager.deleteData(
                    STORES.CUSTOM_MODELS,
                    "models"
                );
                window.location.reload();
            } catch (error) {
                console.error("Error clearing database:", error);
            }
        }
    };

    const findassetsFolder = (zip) => {
        // Check direct assets folder
        if (zip.files["assets/"]) {
            return "";
        }

        // Look for nested assets folder up to 2 levels deep
        const folders = Object.keys(zip.files).filter((path) =>
            path.endsWith("/")
        );

        for (const folder of folders) {
            // Check first level nesting
            if (zip.files[`${folder}assets/`]) {
                return folder;
            }

            // Check second level nesting
            const nestedFolders = folders.filter(
                (path) => path.startsWith(folder) && path !== folder
            );

            for (const nestedFolder of nestedFolders) {
                if (zip.files[`${nestedFolder}assets/`]) {
                    return nestedFolder;
                }
            }
        }

        return null;
    };

    const handleAssetPackImport = async (event) => {
        const file = event.target.files[0];
        if (!file || !file.name.endsWith(".zip")) {
            alert("Please select a valid asset pack (.zip file)");
            return;
        }

        try {
            const zip = await JSZip.loadAsync(file);

            // Find the correct path to the assets folder
            const basePath = findassetsFolder(zip);
            if (basePath === null) {
                alert("Invalid asset pack: assets folder not found");
                return;
            }

            // Update path to map file based on found assets location
            const mapFile = zip.file(`${basePath}assets/maps/terrain.json`);
            if (!mapFile) {
                console.error("Map file not found in asset pack");
                alert("Invalid asset pack: missing terrain.json");
                return;
            }

            // Load the map data
            const mapContent = await mapFile.async("text");
            const importedData = JSON.parse(mapContent);

            // Handle custom blocks if present
            if (importedData.blockTypes) {
                const customBlocksToImport = importedData.blockTypes.filter(
                    (block) => block.isCustom
                );

                if (customBlocksToImport.length > 0) {
                    // Get current custom blocks from database
                    const currentCustomBlocks =
                        (await DatabaseManager.getData(
                            STORES.CUSTOM_BLOCKS,
                            "blocks"
                        )) || [];
                    const existingBlocksByName = new Map(
                        currentCustomBlocks.map((block) => [block.name, block])
                    );

                    const maxId = Math.max(
                        ...currentCustomBlocks.map((block) => block.id),
                        99
                    );
                    let nextId = maxId + 1;

                    const missingTextures = [];
                    const loadedCustomBlocks = await Promise.all(
                        customBlocksToImport.map(async (block) => {
                            const existingBlock = existingBlocksByName.get(
                                block.name
                            );

                            // Check if texture exists in the zip file
                            const texturePath = `${basePath}assets/${block.textureUri}`;
                            const textureFile = zip.file(texturePath);

                            if (textureFile) {
                                // Load texture from zip
                                const textureData =
                                    await textureFile.async("base64");
                                const textureUri = `data:image/png;base64,${textureData}`;

                                return {
                                    ...block,
                                    id: existingBlock
                                        ? existingBlock.id
                                        : nextId++,
                                    textureUri,
                                    isCustom: true,
                                };
                            } else if (!existingBlock) {
                                // Only add to missing textures if we don't have an existing block
                                missingTextures.push(
                                    `${block.name} (ID: ${block.id})`
                                );
                                return {
                                    ...block,
                                    id: nextId++,
                                    textureUri:
                                        "./assets/blocks/error/error.png",
                                    isCustom: true,
                                };
                            }

                            return existingBlock;
                        })
                    );

                    // Show alert for missing textures if any
                    if (missingTextures.length > 0) {
                        alert(
                            `Some textures missing from import, please add them to the block pallet:\n\n${missingTextures.join("\n")}`
                        );
                    }

                    const validCustomBlocks = loadedCustomBlocks.filter(
                        (block) => block !== null
                    );

                    if (validCustomBlocks.length > 0) {
                        const processedBlocks = new Map([
                            ...currentCustomBlocks.map((block) => [
                                block.name,
                                block,
                            ]),
                            ...validCustomBlocks.map((block) => [
                                block.name,
                                block,
                            ]),
                        ]);

                        const updatedBlocks = Array.from(
                            processedBlocks.values()
                        );
                        await DatabaseManager.saveData(
                            STORES.CUSTOM_BLOCKS,
                            "blocks",
                            updatedBlocks
                        );
                        setCustomBlocks(updatedBlocks);
                        updateBlockTypes(updatedBlocks);
                    }
                }
            }

            // First, import custom GLTF models if present
            const modelFiles = Object.keys(zip.files).filter(
                (path) =>
                    path.startsWith(`${basePath}assets/models/environment/`) &&
                    path.endsWith(".gltf")
            );

            // Track all loaded models to ensure they're ready before processing environment data
            const loadedModels = new Set();

            if (modelFiles.length > 0) {
                const customModels = [];

                for (const modelPath of modelFiles) {
                    const modelFile = zip.file(modelPath);
                    if (modelFile) {
                        const modelName = modelPath
                            .split("/")
                            .pop()
                            .replace(".gltf", "");

                        // Skip if model with this name already exists
                        if (
                            environmentModels.find(
                                (model) => model.name === modelName
                            )
                        ) {
                            console.log(
                                `Skipping import of existing model: ${modelName}`
                            );
                            loadedModels.add(modelName); // Add existing model to loaded set
                            continue;
                        }

                        const modelData = await modelFile.async("arraybuffer");

                        // Create blob URL for immediate use
                        const blob = new Blob([modelData], {
                            type: "model/gltf+json",
                        });
                        const blobUrl = URL.createObjectURL(blob);

                        customModels.push({
                            name: modelName,
                            data: modelData,
                            timestamp: Date.now(),
                        });

                        // Create new environment model entry with blob URL
                        const newEnvironmentModel = {
                            id:
                                Math.max(
                                    ...environmentModels
                                        .filter((model) => model.isCustom)
                                        .map((model) => model.id),
                                    199
                                ) + 1,
                            name: modelName,
                            modelUrl: blobUrl,
                            isEnvironment: true,
                            isCustom: true,
                            animations: ["idle"],
                        };

                        environmentModels.push(newEnvironmentModel);

                        // Load the model in EnvironmentBuilder
                        if (environmentBuilder.current) {
                            await environmentBuilder.current.loadCustomModel(
                                newEnvironmentModel
                            );
                            loadedModels.add(modelName); // Add to loaded set after successful load
                        }
                    }
                }

                // Save custom models to IndexedDB
                if (customModels.length > 0) {
                    await DatabaseManager.saveData(
                        STORES.CUSTOM_MODELS,
                        "models",
                        customModels
                    );
                }
            }

            // Clear existing terrain and environment
            setTerrainState({});
            setRedoStates([]);

            if (environmentBuilder.current) {
                environmentBuilder.current.clearEnvironments();
            }
            await DatabaseManager.saveData(STORES.ENVIRONMENT, "current", []);

            // Import terrain blocks
            if (importedData.blocks) {
                const importedTerrain = importedData.blocks;
                let minX = Infinity,
                    maxX = -Infinity,
                    minZ = Infinity,
                    maxZ = -Infinity;

                Object.keys(importedTerrain).forEach((key) => {
                    const [x, , z] = key.split(",").map(Number);
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                    minZ = Math.min(minZ, z);
                    maxZ = Math.max(maxZ, z);
                });

                const centerX = (minX + maxX) / 2;
                const centerZ = (minZ + maxZ) / 2;

                const reconstructedTerrain = Object.entries(
                    importedTerrain
                ).reduce((acc, [key, type]) => {
                    const [x, y, z] = key.split(",").map(Number);
                    const newX = Math.round(x - centerX);
                    const newZ = Math.round(z - centerZ);
                    const newKey = `${newX},${y},${newZ}`;

                    const importedBlockType = importedData.blockTypes.find(
                        (b) => b.id === type
                    );
                    const validType =
                        getBlockTypes().find((block) =>
                            importedBlockType
                                ? block.name === importedBlockType.name
                                : block.id === type
                        ) || blockTypes[0];

                    acc[newKey] = validType;
                    return acc;
                }, {});

                setTerrainState(reconstructedTerrain);
                await DatabaseManager.saveData(
                    STORES.TERRAIN,
                    "current",
                    reconstructedTerrain
                );
            }

            // Import environment objects after ensuring all models are loaded
            if (importedData.entities) {
                const environmentObjects = Object.entries(importedData.entities)
                    .map(([key, entity]) => {
                        const [x, y, z] = key.split(",").map(Number);

                        // Convert rotation from quaternion to euler angles
                        const quaternion = new THREE.Quaternion(
                            entity.rigidBodyOptions.rotation.x,
                            entity.rigidBodyOptions.rotation.y,
                            entity.rigidBodyOptions.rotation.z,
                            entity.rigidBodyOptions.rotation.w
                        );
                        const euler = new THREE.Euler().setFromQuaternion(
                            quaternion
                        );

                        // Get model name from the file path - this should never be undefined
                        const modelName = entity.modelUri
                            .split("/")
                            .pop()
                            .replace(".gltf", "");
                        const matchingModel = environmentModels.find(
                            (model) => model.name === modelName
                        );

                        // Calculate the vertical offset to subtract
                        const boundingBoxHeight =
                            matchingModel?.boundingBoxHeight || 1;
                        const verticalOffset =
                            (boundingBoxHeight * entity.modelScale) / 2;
                        const adjustedY = y - 0.5 - verticalOffset;

                        return {
                            position: { x, y: adjustedY, z },
                            rotation: { x: euler.x, y: euler.y, z: euler.z },
                            scale: {
                                x: entity.modelScale,
                                y: entity.modelScale,
                                z: entity.modelScale,
                            },
                            modelUrl: matchingModel
                                ? matchingModel.modelUrl
                                : entity.modelUri,
                            name: modelName, // Use name instead of modelName for the property
                        };
                    })
                    .filter((obj) => obj !== null);

                if (environmentObjects.length > 0) {
                    await DatabaseManager.saveData(
                        STORES.ENVIRONMENT,
                        "current",
                        environmentObjects
                    );
                    if (environmentBuilder.current) {
                        await environmentBuilder.current.loadSavedEnvironment();
                    }
                }
            } else {
                // If no entities, ensure environment data is cleared
                await DatabaseManager.saveData(
                    STORES.ENVIRONMENT,
                    "current",
                    []
                );
            }

            // Reset file input
            event.target.value = "";

            console.log("Asset pack imported successfully");
        } catch (error) {
            console.error("Error importing asset pack:", error);
            alert(
                "Error importing asset pack. Please make sure it's a valid Hytopia asset pack."
            );
            event.target.value = "";
        }
    };

    // Add this function near your other handlers
    const handleDeleteEnvironmentModel = async (modelId) => {
        if (
            window.confirm("Are you sure you want to delete this custom model?")
        ) {
            try {
                // Get existing models from DB
                const existingModels =
                    (await DatabaseManager.getData(
                        STORES.CUSTOM_MODELS,
                        "models"
                    )) || [];

                // Find the model to delete
                const modelToDelete = environmentModels.find(
                    (model) => model.id === modelId
                );
                if (!modelToDelete) {
                    console.warn("Model not found:", modelId);
                    return;
                }

                console.log("Deleting model:", modelToDelete);

                // Remove from environmentModels array
                const modelIndex = environmentModels.findIndex(
                    (model) => model.id === modelId
                );
                if (modelIndex !== -1) {
                    environmentModels.splice(modelIndex, 1);
                }

                // Remove from DB
                const updatedModels = existingModels.filter(
                    (model) => model.name !== modelToDelete.name
                );
                await DatabaseManager.saveData(
                    STORES.CUSTOM_MODELS,
                    "models",
                    updatedModels
                );

                // Get current environment data
                const currentEnvironment =
                    (await DatabaseManager.getData(
                        STORES.ENVIRONMENT,
                        "current"
                    )) || [];
                console.log(
                    "Current environment before filter:",
                    currentEnvironment
                );

                // Filter out only instances of the deleted model
                const updatedEnvironment = currentEnvironment.filter((obj) => {
                    const shouldKeep = obj.name !== modelToDelete.name;
                    return shouldKeep;
                });

                console.log(
                    "Updated environment after filter:",
                    updatedEnvironment
                );

                // Save the filtered environment data
                await DatabaseManager.saveData(
                    STORES.ENVIRONMENT,
                    "current",
                    updatedEnvironment
                );

                await environmentBuilder.current.loadSavedEnvironment();

                console.log(
                    `Successfully deleted model ${modelToDelete.name} and its instances`
                );
            } catch (error) {
                console.error("Error deleting environment model:", error);
            }
        }
    };

    return (
        <div className="App">
            {/* Under Construction Screen, comment this out when the map is ready */}

            {/* Loading Screen */}
            {!pageIsLoaded && <LoadingScreen />}

            {/* Hytopia Logo */}
            <div className="hytopia-logo">
                <img
                    src={hytopiaLogo}
                    alt="Hytopia Logo"
                    className="hytopia-logo"
                />
                <p
                    style={{
                        marginTop: "50px",
                        fontSize: "12px",
                        color: "gray",
                    }}
                >
                    World Editor Version {version}
                </p>
            </div>

            {/* Block Tools Section */}

            <div className="block-tools-container">
                <div className="block-tools-sidebar">
                    <div className="block-buttons-grid">
                        {activeTab === "blocks" ? (
                            <>
                                <div
                                    style={{
                                        width: "100%",
                                        borderBottom: "2px solid #ccc",
                                        fontSize: "12px",
                                        textAlign: "left",
                                    }}
                                >
                                    Default Blocks (ID: 1-99)
                                </div>
                                {blockTypes.map((blockType) => (
                                    <BlockButton
                                        key={blockType.id}
                                        blockType={blockType}
                                        isSelected={
                                            blockType.id ===
                                            currentBlockType?.id
                                        }
                                        onSelect={(block) => {
                                            setCurrentBlockType(block);
                                            localStorage.setItem(
                                                "selectedBlock",
                                                block.id
                                            );
                                        }}
                                        onDelete={handleDeleteCustomBlock}
                                        handleDragStart={handleDragStart}
                                    />
                                ))}
                                <div
                                    style={{
                                        width: "100%",
                                        borderBottom: "2px solid #ccc",
                                        fontSize: "12px",
                                        textAlign: "left",
                                    }}
                                >
                                    Custom Blocks (ID: 100-199)
                                </div>
                                {customBlocks.map((blockType) => (
                                    <BlockButton
                                        key={blockType.id}
                                        blockType={blockType}
                                        isSelected={
                                            blockType.id ===
                                            currentBlockType?.id
                                        }
                                        onSelect={(block) => {
                                            setCurrentBlockType(block);
                                            localStorage.setItem(
                                                "selectedBlock",
                                                block.id
                                            );
                                        }}
                                        onDelete={handleDeleteCustomBlock}
                                        handleDragStart={handleDragStart}
                                    />
                                ))}
                            </>
                        ) : (
                            <div className="environment-button-wrapper">
                                <div
                                    style={{
                                        width: "100%",
                                        borderBottom: "2px solid #ccc",
                                        fontSize: "12px",
                                        textAlign: "left",
                                    }}
                                >
                                    Default Environment Objects (ID: 200-299)
                                </div>
                                {environmentModels
                                    .filter((envType) => !envType.isCustom)
                                    .map((envType) => (
                                        <EnvironmentButton
                                            key={envType.id}
                                            envType={envType}
                                            isSelected={
                                                envType.id ===
                                                currentBlockType?.id
                                            }
                                            onSelect={handleEnvironmentSelect}
                                            onDelete={
                                                handleDeleteEnvironmentModel
                                            }
                                        />
                                    ))}

                                <div
                                    style={{
                                        width: "100%",
                                        borderBottom: "2px solid #ccc",
                                        fontSize: "12px",
                                        textAlign: "left",
                                        marginTop: "10px",
                                    }}
                                >
                                    Custom Environment Objects (ID: 300+)
                                </div>
                                {environmentModels
                                    .filter((envType) => envType.isCustom)
                                    .map((envType) => (
                                        <EnvironmentButton
                                            key={envType.id}
                                            envType={envType}
                                            isSelected={
                                                envType.id ===
                                                currentBlockType?.id
                                            }
                                            onSelect={handleEnvironmentSelect}
                                            onDelete={
                                                handleDeleteEnvironmentModel
                                            }
                                        />
                                    ))}
                            </div>
                        )}
                    </div>
                    <div className="tab-button-wrapper">
                        <button
                            className={`tab-button ${activeTab === "blocks" ? "active" : ""}`}
                            onClick={() => handleTabChange("blocks")}
                        >
                            Blocks
                        </button>
                        <button
                            className={`tab-button ${activeTab === "environment" ? "active" : ""}`}
                            onClick={() => handleTabChange("environment")}
                        >
                            Environment
                        </button>
                    </div>
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
                        onDrop={handleDrop}
                    >
                        <div className="drop-zone-content">
                            <div className="drop-zone-icons">
                                <FaUpload className="upload-icon" />
                                {activeTab === "blocks" ? (
                                    <FaCube className="block-icon" />
                                ) : (
                                    <FaTree className="block-icon" />
                                )}
                            </div>
                            <div className="drop-zone-text">
                                {activeTab === "blocks"
                                    ? "Drag textures here to add new blocks"
                                    : "Drag .gltf models here to add new environment objects"}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <Canvas shadows className="canvas-container">
                <TerrainBuilder
                    terrain={terrain}
                    onTerrainUpdate={updateTerrainWithHistory}
                    currentBlockType={currentBlockType}
                    mode={mode}
                    setDebugInfo={setDebugInfo}
                    setTotalBlocks={setTotalBlocks}
                    axisLockEnabled={axisLockEnabled}
                    gridSize={gridSize}
                    cameraReset={cameraReset}
                    cameraAngle={cameraAngle}
                    onCameraAngleChange={handleCameraAngleChange}
                    placementSize={placementSize}
                    objectScale={objectScale}
                    setPageIsLoaded={setPageIsLoaded}
                    currentDraggingBlock={currentDraggingBlock}
                    onHandleDropRef={(fn) => (handleDropRef.current = fn)}
                    customBlocks={customBlocks}
                    environmentBuilder={environmentBuilder}
                    onSceneReady={(sceneObject) => setScene(sceneObject)}
                    totalEnvironmentObjects={totalEnvironmentObjects}
                />
                {scene && (
                    <EnvironmentBuilder
                        ref={environmentBuilder}
                        scene={scene}
                        currentBlockType={currentBlockType}
                        terrain={terrain}
                        mode={mode}
                        previewScale={previewScale}
                        previewRotation={previewRotation}
                        onTotalObjectsChange={setTotalEnvironmentObjects}
                    />
                )}
            </Canvas>

            <DebugInfo
                debugInfo={debugInfo}
                totalBlocks={totalBlocks}
                totalEnvironmentObjects={totalEnvironmentObjects}
            />

            <div className="controls-container">
                <div className="control-group">
                    <div className="control-button-wrapper">
                        <Tooltip text="Import just the map file">
                            <button
                                onClick={() =>
                                    document
                                        .getElementById("mapFileInput")
                                        .click()
                                }
                                className="control-button import-export-button"
                            >
                                Map
                            </button>
                            <input
                                id="mapFileInput"
                                type="file"
                                accept=".json"
                                onChange={handleImport}
                                style={{ display: "none" }}
                            />
                        </Tooltip>
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
                                onChange={handleAssetPackImport}
                                style={{ display: "none" }}
                            />
                        </Tooltip>
                    </div>
                    <div className="control-label">Import</div>
                </div>

                <div className="control-group">
                    <div className="control-button-wrapper">
                        <Tooltip text="Export map and assets as a complete package">
                            <button
                                onClick={() => handleExport(terrain)}
                                className="control-button import-export-button"
                            >
                                Asset Pack
                            </button>
                        </Tooltip>
                        <Tooltip text="Export just the map file">
                            <button
                                onClick={() => handleExportMap(terrain)}
                                className="control-button import-export-button"
                            >
                                Map
                            </button>
                        </Tooltip>
                    </div>
                    <div className="control-label">Export</div>
                </div>

                <div className="control-group">
                    <div className="control-button-wrapper">
                        <Tooltip text="Add blocks">
                            <button
                                onClick={() => handleModeChange("add")}
                                className={`control-button ${mode === "add" ? "selected" : ""}`}
                            >
                                <FaPlus />
                            </button>
                        </Tooltip>
                        <Tooltip text="Remove blocks">
                            <button
                                onClick={() => handleModeChange("remove")}
                                className={`control-button ${
                                    mode === "remove" ? "selected" : ""
                                }`}
                            >
                                <FaMinus />
                            </button>
                        </Tooltip>
                        <Tooltip
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
                                className={`control-button ${
                                    axisLockEnabled ? "selected" : ""
                                }`}
                            >
                                {axisLockEnabled ? <FaLock /> : <FaLockOpen />}
                            </button>
                        </Tooltip>
                        <Tooltip text="Undo (Ctrl+Z)">
                            <button onClick={undo} className="control-button">
                                <FaUndo />
                            </button>
                        </Tooltip>
                        <Tooltip text="Redo (Ctrl+Y)">
                            <button onClick={redo} className="control-button">
                                <FaRedo />
                            </button>
                        </Tooltip>
                        <div className="control-divider-vertical"></div>
                        <Tooltip text="Single block placement">
                            <button
                                onClick={() => setPlacementSize("single")}
                                className={`control-button ${
                                    placementSize === "single" ? "selected" : ""
                                }`}
                            >
                                <FaCircle
                                    style={{ width: "5px", height: "5px" }}
                                />
                            </button>
                        </Tooltip>
                        <div className="control-divider-vertical"></div>
                        <Tooltip text="Cross pattern (5 blocks)">
                            <button
                                onClick={() => setPlacementSize("cross")}
                                className={`control-button ${
                                    placementSize === "cross" ? "selected" : ""
                                }`}
                            >
                                <FaCircle
                                    style={{ width: "10px", height: "10px" }}
                                />
                            </button>
                        </Tooltip>
                        <Tooltip text="diamond pattern (13 blocks)">
                            <button
                                onClick={() => setPlacementSize("diamond")}
                                className={`control-button ${
                                    placementSize === "diamond"
                                        ? "selected"
                                        : ""
                                }`}
                            >
                                <FaCircle
                                    style={{ width: "20px", height: "20px" }}
                                />
                            </button>
                        </Tooltip>
                        <div className="control-divider-vertical"></div>
                        <Tooltip text="Single block placement">
                            <button
                                onClick={() => setPlacementSize("square9")}
                                className={`control-button ${
                                    placementSize === "square9"
                                        ? "selected"
                                        : ""
                                }`}
                            >
                                <FaSquare
                                    style={{ width: "10px", height: "10px" }}
                                />
                            </button>
                        </Tooltip>
                        <Tooltip text="Cross pattern (5 blocks)">
                            <button
                                onClick={() => setPlacementSize("square16")}
                                className={`control-button ${
                                    placementSize === "square16"
                                        ? "selected"
                                        : ""
                                }`}
                            >
                                <FaSquare
                                    style={{ width: "20px", height: "20px" }}
                                />
                            </button>
                        </Tooltip>
                    </div>
                    <div className="control-label">Placement Tools</div>
                </div>

                <div className="control-group">
                    <div className="control-button-wrapper">
                        <Tooltip text="Generate solid cube">
                            <button
                                onClick={() => setShowDimensionsModal(true)}
                                className="control-button"
                            >
                                <FaCube />
                            </button>
                        </Tooltip>
                        <Tooltip text="Generate wall of Blocks">
                            <button
                                onClick={() => setShowBorderModal(true)}
                                className="control-button"
                            >
                                <FaBorderStyle />
                            </button>
                        </Tooltip>
                        <Tooltip text="Generate terrain">
                            <button
                                onClick={() => setShowTerrainModal(true)}
                                className="control-button"
                            >
                                <FaMountain />
                            </button>
                        </Tooltip>
                    </div>
                    <div className="control-label">Shape Tools</div>
                </div>

                <div className="control-group">
                    <div className="control-button-wrapper">
                        <Tooltip text="Change grid size">
                            <button
                                onClick={() => setShowGridSizeModal(true)}
                                className="control-button"
                            >
                                <FaExpand />
                            </button>
                        </Tooltip>
                        <Tooltip text="Clear entire map">
                            <button
                                onClick={handleClearMap}
                                className="control-button"
                            >
                                <FaTrash />
                            </button>
                        </Tooltip>
                    </div>
                    <div className="control-label">Map Tools</div>
                </div>
            </div>

            {showDimensionsModal && (
                <div className="modal-overlay">
                    <div className="modal-content">
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

            {showGridSizeModal && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h3 className="modal-title">Change Grid Size</h3>
                        <p className="modal-description">
                            Adjust the size of the building grid. This affects
                            the visible grid and the area where you can place
                            blocks.
                        </p>
                        <div className="modal-input">
                            <label>New Grid Size (10-500): </label>
                            <input
                                type="number"
                                value={newGridSize}
                                onChange={(e) =>
                                    setNewGridSize(parseInt(e.target.value))
                                }
                                min="10"
                                max="500"
                            />
                        </div>
                        <div className="modal-buttons">
                            <button
                                className="menu-button"
                                onClick={() =>
                                    handleGridSizeChange(newGridSize)
                                }
                            >
                                Apply
                            </button>
                            <button
                                className="menu-button"
                                onClick={() => setShowGridSizeModal(false)}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showBorderModal && (
                <div className="modal-overlay">
                    <div className="modal-content">
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
                <div className="modal-overlay">
                    <div className="modal-content">
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
                                Terrain Style:{" "}
                            </label>
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "10px",
                                }}
                            >
                                <span>Roughest</span>
                                <input
                                    type="range"
                                    value={terrainSettings.roughness}
                                    onChange={(e) =>
                                        setTerrainSettings({
                                            ...terrainSettings,
                                            roughness: parseInt(e.target.value),
                                        })
                                    }
                                    min="70"
                                    max="100"
                                />
                                <span>Smoothest</span>
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
                                onClick={generateTerrain}
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

            <div className="camera-controls-wrapper">
                <Tooltip text="Reset camera position">
                    <button
                        onClick={handleResetCamera}
                        className="camera-control-button"
                    >
                        <FaCamera />
                    </button>
                </Tooltip>
                <Tooltip text={isMuted ? "Unmute" : "Mute"}>
                    <button
                        onClick={handleMuteToggle}
                        className={`camera-control-button ${!isMuted ? "active" : ""}`}
                    >
                        <FaVolumeMute />
                    </button>
                </Tooltip>

                <div className="camera-angle-slider">
                    <input
                        type="range"
                        min="-80"
                        max="10"
                        value={cameraAngle}
                        className="vertical-slider"
                        onChange={handleSliderChange}
                    />
                </div>
            </div>

            <div className="controls-description">
                W, A, S, D & Middle Mouse - Move Camera | Right Mouse - Rotate
                Camera | Space - Move Up | Shift - Move Down
            </div>
            <div
                className="controls-description"
                style={{ marginTop: "20px", color: "green" }}
            >
                New Functionality: Drag and drop a block from the toolbar onto
                other blocks to replace them.
            </div>
            <button
                className="toolbar-button"
                onClick={clearDatabase}
                title="Clear Database"
                style={{ position: "absolute", bottom: "10px", left: "10px" }}
            >
                <FaDatabase />
            </button>
        </div>
    );
}

export default App;
