import { DatabaseManager, STORES } from "./managers/DatabaseManager";
import { getBlockTypes, processCustomBlock } from "./TerrainBuilder";
import { getCustomBlocks } from "./managers/BlockTypesManager";
import { environmentModels } from "./EnvironmentBuilder";
import * as THREE from "three";
import { version } from "./Constants";
import { loadingManager } from "./managers/LoadingManager";
import JSZip from "jszip";

export const importMap = async (
    file,
    terrainBuilderRef,
    environmentBuilderRef
) => {
    try {

        loadingManager.showLoading("Starting import process...", 0);

        // Check if file is a ZIP
        const isZipFile = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip';

        if (isZipFile) {
            // Handle ZIP file import
            return await importFromZip(file, terrainBuilderRef, environmentBuilderRef);
        } else {
            // Handle JSON file import (existing logic)
            const reader = new FileReader();
            return new Promise((resolve, reject) => {
                reader.onload = async (event) => {
                    try {
                        loadingManager.updateLoading(
                            "Parsing imported file...",
                            10
                        );

                        const importData = JSON.parse(event.target.result as string);
                        await processImportData(importData, terrainBuilderRef, environmentBuilderRef, resolve, reject);
                    } catch (error) {
                        loadingManager.hideLoading();
                        console.error("Error processing import:", error);
                        reject(error);
                    }
                };
                reader.onerror = () => {
                    loadingManager.hideLoading();
                    reject(new Error("Error reading file"));
                };
                reader.readAsText(file);
            });
        }
    } catch (error) {
        loadingManager.hideLoading();
        console.error("Error importing map:", error);
        alert("Error importing map. Please try again.");
        throw error;
    }
};

// Helper function to handle ZIP file imports
const importFromZip = async (file, terrainBuilderRef, environmentBuilderRef) => {
    try {
        loadingManager.updateLoading("Extracting ZIP contents...", 10);

        const zip = await JSZip.loadAsync(file);

        // Extract map.json
        const mapJsonFile = zip.file("map.json");
        if (!mapJsonFile) {
            throw new Error("map.json not found in ZIP file");
        }

        const mapJsonContent = await mapJsonFile.async("text");
        const importData = JSON.parse(mapJsonContent);

        loadingManager.updateLoading("Processing assets from ZIP...", 20);

        // Process custom blocks from blocks/ folder
        await processCustomBlocksFromZip(zip, importData);

        // Process custom models from models/environment/ folder
        await processCustomModelsFromZip(zip, importData);

        // Trigger model preloading if environment builder is available
        if (environmentBuilderRef && environmentBuilderRef.current && environmentBuilderRef.current.preloadModels) {
            loadingManager.updateLoading("Loading custom models...", 25);
            await environmentBuilderRef.current.preloadModels();
        }

        // Now process the import data as normal
        await processImportData(importData, terrainBuilderRef, environmentBuilderRef);

    } catch (error) {
        loadingManager.hideLoading();
        console.error("Error importing ZIP:", error);
        alert("Error importing ZIP file. Please check the file format.");
        throw error;
    }
};

// Helper function to process custom blocks from ZIP
const processCustomBlocksFromZip = async (zip, importData) => {
    const blocksFolder = zip.folder("blocks");
    if (!blocksFolder) return;

    // Process each block type that has custom textures
    if (importData.blockTypes) {
        console.log(`Processing ${importData.blockTypes.filter(b => b.isCustom).length} custom blocks from ZIP`);
        for (const blockType of importData.blockTypes) {
            if (blockType.isCustom && blockType.textureUri) {
                if (blockType.isMultiTexture) {
                    // Multi-texture block - folder contains face textures
                    const blockFolder = blocksFolder.folder(blockType.name);
                    if (blockFolder) {
                        const sideTextures = {};
                        const faceKeys = ["+x", "-x", "+y", "-y", "+z", "-z"];

                        for (const faceKey of faceKeys) {
                            // Try different extensions
                            for (const ext of ["png", "jpg", "jpeg"]) {
                                const textureFile = blockFolder.file(`${faceKey}.${ext}`);
                                if (textureFile) {
                                    let blob = await textureFile.async("blob");
                                    // Ensure correct MIME type as JSZip might default to octet-stream
                                    if (blob.type === 'application/octet-stream' || !blob.type) {
                                        const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
                                        blob = new Blob([blob], { type: mimeType });
                                    }
                                    const dataUrl = await blobToDataUrl(blob);
                                    sideTextures[faceKey] = dataUrl;
                                    break; // Found one, move to next face
                                }
                            }
                        }

                        // Update the block type with the extracted textures
                        blockType.sideTextures = sideTextures;
                        // For multi-texture, ensure textureUri is a valid data URI from one of the sides.
                        // The registry needs a data URI for the main texture, even if it's just one of the faces.
                        blockType.textureUri = sideTextures["+y"] || Object.values(sideTextures)[0] || null;

                        if (!blockType.textureUri) {
                            console.warn(`Could not find any textures for multi-texture block: ${blockType.name}`);
                        }
                    }
                } else {
                    // Single texture block
                    const sanitizedBlockName = blockType.name.replace(/\s+/g, "_").toLowerCase();
                    let textureFile = null;
                    let fileExt = '';

                    // Try different extensions
                    for (const ext of ["png", "jpg", "jpeg"]) {
                        const potentialFile = blocksFolder.file(`${sanitizedBlockName}.${ext}`);
                        if (potentialFile) {
                            textureFile = potentialFile;
                            fileExt = ext;
                            break;
                        }
                    }

                    if (textureFile) {
                        let blob = await textureFile.async("blob");
                        // Ensure correct MIME type as JSZip might default to octet-stream
                        if (blob.type === 'application/octet-stream' || !blob.type) {
                            const mimeType = `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`;
                            blob = new Blob([blob], { type: mimeType });
                        }
                        const dataUrl = await blobToDataUrl(blob);
                        blockType.textureUri = dataUrl;
                    }
                }
            }
        }
    }
};

// Helper function to process custom models from ZIP
const processCustomModelsFromZip = async (zip, importData) => {
    const modelsFolder = zip.folder("models/environment");
    if (!modelsFolder) return;

    // For each entity, check if we need to extract its model
    if (importData.entities) {
        const modelFiles = new Map();
        const customModelsToSave = [];

        // Collect all unique model URIs that need to be extracted
        Object.values(importData.entities).forEach((entity: any) => {
            if (entity.modelUri && !entity.modelUri.startsWith('data:') && !entity.modelUri.startsWith('assets/')) {
                const fileName = entity.modelUri.split('/').pop();
                if (fileName && !modelFiles.has(fileName)) {
                    modelFiles.set(fileName, entity.modelUri);
                }
            }
        });

        // Extract and process each unique model
        for (const [fileName, modelUri] of modelFiles) {
            const modelFile = modelsFolder.file(fileName);
            if (modelFile) {
                const arrayBuffer = await modelFile.async("arraybuffer");
                const modelName = fileName.replace('.gltf', '');

                // Save to custom models database
                const modelDataForDB = {
                    name: modelName,
                    data: arrayBuffer,
                    timestamp: Date.now(),
                };
                customModelsToSave.push(modelDataForDB);

                // Update all entities using this model to reference by name instead of URI
                Object.values(importData.entities).forEach((entity: any) => {
                    if (entity.modelUri === modelUri) {
                        // Set the entity to use the model name so it can be found after preload
                        entity.modelName = modelName;
                        // Keep the original URI for now, will be updated after preload
                        entity.originalModelUri = entity.modelUri;
                    }
                });
            }
        }

        // Save all custom models to database
        if (customModelsToSave.length > 0) {
            const existingModels = (await DatabaseManager.getData(STORES.CUSTOM_MODELS, "models") || []) as Array<{ name: string, data: ArrayBuffer, timestamp: number }>;
            const existingCustomModelNames = new Set(existingModels.map(m => m.name));

            // Also check against default models in environmentModels
            const existingDefaultModelNames = new Set(environmentModels.map(m => m.name));

            // Only add models that don't already exist in either custom or default models
            const newModels = customModelsToSave.filter(model =>
                !existingCustomModelNames.has(model.name) &&
                !existingDefaultModelNames.has(model.name)
            );

            if (newModels.length > 0) {
                const updatedModels = [...existingModels, ...newModels];
                await DatabaseManager.saveData(STORES.CUSTOM_MODELS, "models", updatedModels);

                console.log(`Saved ${newModels.length} custom models to database:`, newModels.map(m => m.name));

                // Trigger a custom event to notify that new models were added
                window.dispatchEvent(new CustomEvent("custom-models-loaded", {
                    detail: { models: newModels }
                }));
            } else {
                console.log(`No new models to add. Found ${customModelsToSave.length} models in ZIP, but all already exist.`);
            }
        }
    }
};

// Helper function to convert blob to data URL
const blobToDataUrl = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

// Extracted the main import processing logic into a separate function
const processImportData = async (importData, terrainBuilderRef, environmentBuilderRef, resolve?, reject?) => {
    try {
        let terrainData = {};
        let environmentData = [];

        if (importData.blocks) {

            // Initialize block ID mapping early for remapping during import
            const blockIdMapping = {};

            if (
                importData.blockTypes &&
                importData.blockTypes.length > 0
            ) {
                loadingManager.updateLoading(
                    `Processing ${importData.blockTypes.length} block types...`,
                    30
                );


                // Get existing blocks to check for duplicates
                const existingBlocks = getBlockTypes();
                const existingBlockNames = new Set(existingBlocks.map(b => b.name.toLowerCase()));
                const existingBlockIds = new Set(existingBlocks.map(b => b.id));

                // Create a mapping from block name to ID for existing blocks
                const existingBlockNameToId = {};
                existingBlocks.forEach(block => {
                    existingBlockNameToId[block.name.toLowerCase()] = block.id;
                });

                // Find the next available ID for new custom blocks
                const getNextAvailableId = () => {
                    let nextId = 100; // Start at 100 for custom blocks
                    while (existingBlockIds.has(nextId)) {
                        nextId++;
                    }
                    return nextId;
                };

                let processedCount = 0;
                let remappedCount = 0;

                for (const blockType of importData.blockTypes) {

                    if (
                        blockType.isCustom ||
                        (blockType.id >= 100 && blockType.id < 200)
                    ) {
                        // Check if block already exists by name only
                        const blockNameLower = blockType.name.toLowerCase();
                        const importedBlockId = blockType.id;

                        if (existingBlockNames.has(blockNameLower)) {
                            // Block name exists, remap to existing block's ID
                            const existingBlockId = existingBlockNameToId[blockNameLower];
                            blockIdMapping[importedBlockId] = existingBlockId;
                            console.log(`Remapping block "${blockType.name}" from imported ID ${importedBlockId} to existing ID ${existingBlockId}`);
                            remappedCount++;
                            continue;
                        }

                        // This is a new block - assign it a new available ID
                        const newBlockId = getNextAvailableId();
                        blockIdMapping[importedBlockId] = newBlockId;

                        const likelyIsMultiTexture =
                            blockType.isMultiTexture !== undefined
                                ? blockType.isMultiTexture
                                : !(
                                    blockType.textureUri?.endsWith(
                                        ".png"
                                    ) ||
                                    blockType.textureUri?.endsWith(
                                        ".jpg"
                                    ) ||
                                    blockType.textureUri?.endsWith(
                                        ".jpeg"
                                    ) ||
                                    blockType.textureUri?.endsWith(
                                        ".gif"
                                    )
                                );

                        const processedBlock = {
                            id: newBlockId, // Use the new ID instead of imported ID
                            name: blockType.name,
                            textureUri: blockType.textureUri, // Pass the URI from the file (could be path or data)
                            isCustom: true,
                            isMultiTexture: likelyIsMultiTexture,

                            sideTextures:
                                blockType.sideTextures || {},
                        };

                        await processCustomBlock(processedBlock);
                        processedCount++;

                        // Update our tracking sets with the new block
                        existingBlockNames.add(blockNameLower);
                        existingBlockIds.add(newBlockId);
                        existingBlockNameToId[blockNameLower] = newBlockId;

                        console.log(`Added new custom block "${blockType.name}" with ID ${newBlockId} (imported as ID ${importedBlockId})`);
                    }
                }

                console.log(`Block processing complete: ${processedCount} new blocks added, ${remappedCount} blocks remapped to existing IDs`);

                // Save custom blocks to database for persistence
                try {
                    const updatedCustomBlocks = getCustomBlocks();
                    await DatabaseManager.saveData(
                        STORES.CUSTOM_BLOCKS,
                        "blocks",
                        updatedCustomBlocks
                    );
                    console.log(`Saved ${updatedCustomBlocks.length} custom blocks to database`);
                } catch (error) {
                    console.error("Error saving custom blocks to database:", error);
                }

                window.dispatchEvent(
                    new CustomEvent("custom-blocks-loaded", {
                        detail: {
                            blocks: importData.blockTypes.filter(
                                (b) =>
                                    b.isCustom ||
                                    (b.id >= 100 && b.id < 200)
                            ),
                        },
                    })
                );
            }
            loadingManager.updateLoading(
                "Processing terrain data...",
                40
            );


            const currentBlockTypes = getBlockTypes();

            // Handle remaining block mappings (for blocks that aren't custom blocks)
            // Don't overwrite mappings already created during custom block processing
            if (importData.blockTypes && importData.blockTypes.length > 0) {
                importData.blockTypes.forEach(importedBlockType => {
                    const importedId = importedBlockType.id;

                    // Only create mapping if it doesn't already exist (wasn't processed as custom block)
                    if (!blockIdMapping.hasOwnProperty(importedId)) {
                        const blockName = importedBlockType.name.toLowerCase();
                        const existingBlock = currentBlockTypes.find(block =>
                            block.name.toLowerCase() === blockName
                        );

                        if (existingBlock) {
                            blockIdMapping[importedId] = existingBlock.id;
                        } else {
                            // Block doesn't exist in current system, keep original ID
                            blockIdMapping[importedId] = importedId;
                        }
                    }
                });
            } else {
                // No block types in import, create identity mapping for current blocks
                currentBlockTypes.forEach(blockType => {
                    if (!blockIdMapping.hasOwnProperty(blockType.id)) {
                        blockIdMapping[blockType.id] = blockType.id;
                    }
                });
            }


            terrainData = Object.entries(importData.blocks as { [key: string]: number }).reduce(
                (acc, [key, importedBlockId]) => {

                    const mappedId = blockIdMapping[importedBlockId] !== undefined
                        ? blockIdMapping[importedBlockId]
                        : importedBlockId;

                    acc[key] = mappedId;
                    return acc;
                },
                {}
            );

            if (
                Object.keys(terrainData).length > 0 &&
                terrainBuilderRef &&
                terrainBuilderRef.current
            ) {
                loadingManager.updateLoading(
                    "Calculating map dimensions...",
                    50
                );
                let minX = Infinity,
                    minZ = Infinity;
                let maxX = -Infinity,
                    maxZ = -Infinity;
                Object.keys(terrainData).forEach((key) => {
                    const [x, y, z] = key.split(",").map(Number);
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                    minZ = Math.min(minZ, z);
                    maxZ = Math.max(maxZ, z);
                });
            }

            if (importData.entities) {
                loadingManager.updateLoading(
                    "Processing environment objects...",
                    60
                );
                const instanceIdCounters: Record<string, number> = {};
                environmentData = Object.entries(
                    importData.entities
                )
                    .map(([key, entity]: [string, any]) => {
                        const [x, y, z] = key
                            .split(",")
                            .map(Number);

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

                        // Use the model name from ZIP processing if available, otherwise derive from URI
                        const modelName = entity.modelName || entity.modelUri
                            .split("/")
                            .pop()
                            .replace(".gltf", "");
                        const matchingModel =
                            environmentModels.find(
                                (model) => model.name === modelName
                            );

                        // --- Reverse of export: from centre to origin ---
                        let localCentreOffset: THREE.Vector3;
                        if (matchingModel?.boundingBoxCenter instanceof THREE.Vector3) {
                            localCentreOffset = matchingModel.boundingBoxCenter.clone();
                        } else {
                            localCentreOffset = new THREE.Vector3(
                                (matchingModel?.boundingBoxWidth || 1) / 2,
                                (matchingModel?.boundingBoxHeight || 1) / 2,
                                (matchingModel?.boundingBoxDepth || 1) / 2
                            );
                        }

                        // Apply scale
                        const scaledOffset = localCentreOffset.multiply(new THREE.Vector3(entity.modelScale, entity.modelScale, entity.modelScale));

                        // Apply rotation around Y
                        const qInv = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), euler.y);
                        scaledOffset.applyQuaternion(qInv);

                        // Convert centre position (x,y,z) to origin (adjustedX etc.)
                        const originPos = new THREE.Vector3(x, y, z).sub(scaledOffset).sub(new THREE.Vector3(0.5, 0.5, 0.5));

                        const adjustedX = originPos.x;
                        const adjustedY = originPos.y;
                        const adjustedZ = originPos.z;

                        return {
                            position: { x: adjustedX, y: adjustedY, z: adjustedZ },
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
                                : entity.originalModelUri
                                    ? (entity.modelUri.startsWith('data:')
                                        ? entity.modelUri
                                        : `assets/${entity.originalModelUri}`)
                                    : entity.modelUri.startsWith('data:')
                                        ? entity.modelUri
                                        : `assets/${entity.modelUri}`,
                            name: modelName,
                            modelLoopedAnimations:
                                entity.modelLoopedAnimations || [
                                    "idle",
                                ],

                            // Assign a sequential ID for **this** model type only
                            instanceId: (() => {
                                const modelKey = matchingModel
                                    ? matchingModel.modelUrl
                                    : entity.originalModelUri
                                        ? (entity.modelUri.startsWith('data:')
                                            ? entity.modelUri
                                            : `assets/${entity.originalModelUri}`)
                                        : entity.modelUri.startsWith('data:')
                                            ? entity.modelUri
                                            : `assets/${entity.modelUri}`;
                                const nextId = instanceIdCounters[modelKey] ?? 0;
                                instanceIdCounters[modelKey] = nextId + 1;
                                return nextId;
                            })(),
                        };
                    })
                    .filter((obj) => obj !== null);
            }
        } else {
            loadingManager.hideLoading();
            alert(
                "Invalid map file format - no valid map data found"
            );
            if (reject) reject(new Error("Invalid map file format"));
            return;
        }

        loadingManager.updateLoading(
            "Saving terrain data to database...",
            70
        );
        await DatabaseManager.saveData(
            STORES.TERRAIN,
            "current",
            terrainData
        );

        loadingManager.updateLoading(
            "Saving environment data to database...",
            80
        );
        await DatabaseManager.saveData(
            STORES.ENVIRONMENT,
            "current",
            environmentData
        );

        if (terrainBuilderRef && terrainBuilderRef.current) {
            loadingManager.updateLoading(
                "Rebuilding terrain from imported data...",
                85
            );
            await terrainBuilderRef.current.refreshTerrainFromDB();


        }
        if (
            environmentBuilderRef &&
            environmentBuilderRef.current
        ) {

            loadingManager.updateLoading(
                "Loading environment objects...",
                95
            );
            await environmentBuilderRef.current.refreshEnvironmentFromDB();
        }
        loadingManager.updateLoading("Import complete!", 100);

        setTimeout(() => {
            loadingManager.hideLoading();
        }, 500);

        if (resolve) resolve(undefined);
    } catch (error) {
        loadingManager.hideLoading();
        console.error("Error processing import:", error);
        if (reject) reject(error);
        else throw error;
    }
};
export const exportMapFile = async (terrainBuilderRef, environmentBuilderRef) => {
    try {
        const currentTerrainData = terrainBuilderRef.current.getCurrentTerrainData() || {};
        const hasBlocks = Object.keys(currentTerrainData).length > 0;

        const environmentObjects = environmentBuilderRef.current.getAllEnvironmentObjects();

        if (!hasBlocks && (!environmentObjects || environmentObjects.length === 0)) {
            alert("Nothing to export! Add blocks or models first.");
            return;
        }

        loadingManager.showLoading("Preparing to export map...", 0);

        loadingManager.updateLoading("Retrieving environment data...", 10);

        loadingManager.updateLoading("Processing terrain data...", 30);
        const simplifiedTerrain = Object.entries(currentTerrainData).reduce((acc, [key, value]) => {
            if (key.split(",").length === 3) {
                acc[key] = value;
            }
            return acc;
        }, {});
        loadingManager.updateLoading(
            "Collecting block type information...",
            50
        );
        const allBlockTypes = getBlockTypes();

        // === Helper utilities for texture handling ===
        const sanitizeName = (name: string) => name.replace(/\s+/g, "_").toLowerCase();
        const FACE_KEYS = ["+x", "-x", "+y", "-y", "+z", "-z"] as const;

        const getFileExtensionFromUri = (uri: string) => {
            if (uri.startsWith("data:")) {
                const match = uri.match(/^data:image\/([a-zA-Z0-9+]+);/);
                if (match && match[1]) {
                    return match[1] === "jpeg" ? "jpg" : match[1];
                }
                return "png"; // default when mime not recognised
            }
            const parts = uri.split(".");
            return parts.length > 1 ? parts.pop()!.split("?")[0].toLowerCase() : "png";
        };
        // === End helper utilities ===

        // --- Determine Used Block IDs ---
        const usedBlockIds = new Set<number>();
        Object.values(simplifiedTerrain).forEach(blockId => {
            if (typeof blockId === 'number') { // Ensure it's a valid ID
                usedBlockIds.add(blockId);
            }
        });

        // --- Filter Block Types ---
        // Include only block types that actually appear in the terrain.
        const usedBlockTypes = allBlockTypes.filter(block => usedBlockIds.has(block.id));
        // If no blocks used but custom blocks may still exist; nothing wrong. Proceed.

        // --- Collect Asset URIs ---
        loadingManager.updateLoading("Collecting asset URIs...", 60);
        // Store texture info: { uri: string, blockName: string | null, isMulti: boolean, fileName: string }
        const textureInfos = new Set<{ uri: string; blockName: string | null; isMulti: boolean; fileName: string }>();
        const modelUris = new Set<string>();

        // Iterate over ONLY the used block types to collect textures (including data URIs)
        usedBlockTypes.forEach((block) => {
            const isMulti = block.isMultiTexture || false;
            const sanitizedBlockName = sanitizeName(block.name);
            const blockNameForPath = isMulti ? block.name : null;

            // Handle main texture URI only for NON-multi-texture blocks
            if (!isMulti && block.textureUri && typeof block.textureUri === "string") {
                const ext = getFileExtensionFromUri(block.textureUri);
                const fileName = `${sanitizedBlockName}.${ext}`;
                textureInfos.add({ uri: block.textureUri, blockName: blockNameForPath, isMulti, fileName });
            }

            // For multi-texture blocks, collect each face texture. Single-texture blocks need only the main texture.
            if (isMulti) {
                FACE_KEYS.forEach(faceKey => {
                    const uri = block.sideTextures?.[faceKey] || block.sideTextures?.["+y"] || block.textureUri;
                    if (!uri) {
                        return; // Skip this face if no texture found
                    }
                    const ext = getFileExtensionFromUri(uri);
                    const fileName = `${faceKey}.${ext}`;
                    textureInfos.add({ uri, blockName: blockNameForPath, isMulti, fileName });
                });
            }
        });


        environmentObjects.forEach(obj => {
            const entityType = environmentModels.find(
                (model) => model.modelUrl === obj.modelUrl
            );
            if (entityType && entityType.modelUrl && !entityType.modelUrl.startsWith('data:')) { // Check if modelUrl exists and is not a data URI
                modelUris.add(entityType.modelUrl);
            }
        });

        // --- End Collect Asset URIs ---


        loadingManager.updateLoading("Building export data structure...", 70);
        const exportData = {
            // Export block type definitions only for the blocks actually used
            blockTypes: usedBlockTypes.map((block) => {
                // Determine JSON paths based on zip structure
                const isMulti = block.isMultiTexture || false;
                const sanitizedBlockName = sanitizeName(block.name);

                // --- Main texture path (single-texture blocks) ---
                let textureUriForJson: string | undefined;
                if (isMulti) {
                    // Multi-texture blocks reference their folder
                    textureUriForJson = `blocks/${block.name}`;
                } else if (block.textureUri) {
                    const ext = getFileExtensionFromUri(block.textureUri);
                    const fileNameSingle = `${sanitizedBlockName}.${ext}`;
                    textureUriForJson = `blocks/${fileNameSingle}`;
                }



                return {
                    id: block.id,
                    name: block.name,
                    textureUri: textureUriForJson, // For multi texture blocks this will be folder path; single texture blocks file path
                    isCustom: block.isCustom || (block.id >= 100 && block.id < 200),
                    isMultiTexture: isMulti,
                };
            }),
            blocks: simplifiedTerrain,
            entities: environmentObjects.reduce((acc, obj) => {
                const entityType = environmentModels.find(
                    (model) => model.modelUrl === obj.modelUrl
                );
                if (entityType) {
                    // ... (keep existing entity processing logic)
                    const isThreeEuler = obj.rotation instanceof THREE.Euler;
                    const rotYVal = isThreeEuler ? obj.rotation.y : (obj.rotation?.y || 0);


                    const hasRotation = Math.abs(rotYVal) > 0.001;


                    const quaternion = new THREE.Quaternion();
                    if (hasRotation) {
                        quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotYVal);
                    } else {

                        quaternion.identity();
                    }

                    // Adjust modelUri for JSON export (relative path within zip/final structure)
                    let modelUriForJson: string | undefined;
                    if (entityType.modelUrl && entityType.modelUrl.startsWith('data:')) {
                        modelUriForJson = entityType.modelUrl; // Keep data URI
                    } else {
                        modelUriForJson = entityType.isCustom
                            ? `models/environment/${entityType.name}.gltf` // Standard path for custom models
                            : `models/environment/${entityType.modelUrl.split('/').pop()}`; // Path for standard models (just filename in models folder)

                    }

                    let localCentreOffset: THREE.Vector3;
                    if (entityType.boundingBoxCenter instanceof THREE.Vector3) {
                        localCentreOffset = entityType.boundingBoxCenter.clone();
                    } else {
                        localCentreOffset = new THREE.Vector3(
                            (entityType.boundingBoxWidth || 1) / 2,
                            (entityType.boundingBoxHeight || 1) / 2,
                            (entityType.boundingBoxDepth || 1) / 2
                        );
                    }

                    const scaledOffset = localCentreOffset.multiply(new THREE.Vector3(obj.scale.x, obj.scale.y, obj.scale.z));

                    const qOffset = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotYVal);
                    scaledOffset.applyQuaternion(qOffset);

                    const adjustedPos = new THREE.Vector3(
                        obj.position.x,
                        obj.position.y,
                        obj.position.z
                    ).add(new THREE.Vector3(0.5, 0.5, 0.5)).add(scaledOffset);

                    const key = `${adjustedPos.x},${adjustedPos.y},${adjustedPos.z}`;
                    acc[key] = {
                        modelUri: modelUriForJson, // Use adjusted relative path
                        modelPreferredShape: (entityType.addCollider === false) ? "none" : "trimesh",
                        modelLoopedAnimations: entityType.animations || [
                            "idle",
                        ],
                        modelScale: obj.scale.x, // Assuming uniform scale for simplicity
                        name: entityType.name,
                        rigidBodyOptions: {
                            type: "fixed",
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
            version: version || "1.0.0",
        };

        // --- Fetch Assets and Create ZIP ---
        loadingManager.updateLoading("Fetching assets...", 80);
        const zip = new JSZip();
        const blocksRootFolder = zip.folder("blocks"); // Changed from textures to blocks
        const modelsFolder = zip.folder("models/environment"); // Changed to models/environment
        const fetchPromises: Promise<void>[] = [];

        const fetchedAssetUrls = new Set<string>(); // Keep track of URLs already being fetched/added

        // --- Helper to create a blank PNG blob (24x24 transparent) ---
        const blankPngBlobPromise = (() => {
            let cache = null;
            return async () => {
                if (cache) return cache;
                const canvas = document.createElement('canvas');
                canvas.width = 24;
                canvas.height = 24;
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                cache = blob;
                return blob;
            };
        })();

        // Cache fetched blobs so duplicate URIs don't trigger network again but all face files are still written.
        const uriBlobCache = new Map<string, Blob>();

        textureInfos.forEach(texInfo => {
            const fileName = texInfo.fileName;
            if (!fileName || !blocksRootFolder) return;

            const targetFolder = texInfo.isMulti && texInfo.blockName
                ? blocksRootFolder.folder(texInfo.blockName)
                : blocksRootFolder;

            if (!targetFolder) {
                console.error(`Could not get or create texture folder for ${texInfo.blockName || 'root'}`);
                return;
            }

            const addFileToZip = (blob: Blob) => {
                targetFolder.file(fileName, blob);
            };

            if (!texInfo.uri) {
                // No texture URI provided – create blank PNG
                fetchPromises.push(
                    blankPngBlobPromise().then(addFileToZip)
                );
                return;
            }

            // If we've already fetched this URI, reuse the blob
            if (uriBlobCache.has(texInfo.uri)) {
                addFileToZip(uriBlobCache.get(texInfo.uri));
                return;
            }

            // Fetch (or convert data URI) then cache and add
            const fetchPromise = (async () => {
                let blob: Blob;
                try {
                    if (texInfo.uri.startsWith('data:image')) {
                        const res = await fetch(texInfo.uri);
                        blob = await res.blob();
                    } else {
                        const response = await fetch(texInfo.uri);
                        if (!response.ok) throw new Error(`HTTP error! status: ${response.status} for ${texInfo.uri}`);
                        blob = await response.blob();
                    }
                } catch (error) {
                    console.warn(`Failed to fetch texture ${texInfo.uri}, using blank PNG.`, error);
                    blob = await blankPngBlobPromise();
                }
                uriBlobCache.set(texInfo.uri, blob);
                addFileToZip(blob);
            })();

            fetchPromises.push(fetchPromise);
        });


        modelUris.forEach(uri => {
            if (uri && !uri.startsWith('data:') && !fetchedAssetUrls.has(uri)) { // Avoid data URIs and duplicates
                fetchedAssetUrls.add(uri);
                let fileName: string | undefined;
                const matchingModel = environmentModels.find(m => m.modelUrl === uri);
                if (matchingModel && matchingModel.isCustom) {
                    fileName = `${matchingModel.name}.gltf`;
                } else {
                    fileName = uri.split('/').pop();
                }

                if (fileName && modelsFolder) {
                    fetchPromises.push(
                        fetch(uri)
                            .then(response => {
                                if (!response.ok) throw new Error(`HTTP error! status: ${response.status} for ${uri}`);
                                return response.blob();
                            })
                            .then(blob => {
                                modelsFolder.file(fileName, blob);
                            })
                            .catch(error => console.error(`Failed to fetch/add model ${uri}:`, error))
                    );
                }
            }
        });


        await Promise.all(fetchPromises);
        // --- End Fetch Assets and Create ZIP ---

        loadingManager.updateLoading("Creating export files...", 90);
        const jsonContent = JSON.stringify(exportData, null, 2);
        const jsonBlob = new Blob([jsonContent], { type: "application/json" });

        // Add map.json to the zip file root
        zip.file("map.json", jsonBlob);

        const zipBlob = await zip.generateAsync({ type: "blob" });

        loadingManager.updateLoading("Preparing download...", 95);

        // Download ZIP (which now includes map.json)
        const zipUrl = URL.createObjectURL(zipBlob);
        const zipLink = document.createElement("a");
        zipLink.href = zipUrl;
        zipLink.download = "map_export.zip"; // Renamed zip for clarity


        loadingManager.updateLoading("Export complete!", 100);

        setTimeout(() => {
            zipLink.click(); // Trigger ZIP download
            URL.revokeObjectURL(zipUrl);
            loadingManager.hideLoading();
        }, 500); // Added slight delay for robustness

    } catch (error) {
        loadingManager.hideLoading();
        console.error("Error exporting map file:", error);
        alert("Error exporting map. Please try again.");
        throw error; // Re-throw error after handling
    }
};
