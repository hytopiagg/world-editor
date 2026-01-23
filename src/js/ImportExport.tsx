import { DatabaseManager, STORES } from "./managers/DatabaseManager";
import { getBlockTypes, processCustomBlock } from "./TerrainBuilder";
import { getCustomBlocks } from "./managers/BlockTypesManager";
import { environmentModels } from "./EnvironmentBuilder";
import * as THREE from "three";
import { ENVIRONMENT_OBJECT_Y_OFFSET, version } from "./Constants";
import { loadingManager } from "./managers/LoadingManager";
import JSZip from "jszip";
import { zoneManager } from "./managers/ZoneManager";
import { Zone } from "./types/DatabaseTypes";

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

        // After processing map data, let's handle the skybox
        const skyboxesFolder = zip.folder("skyboxes");
        if (skyboxesFolder) {
            let skyboxName: string | null = null;
            // Find the first directory inside 'skyboxes/'
            skyboxesFolder.forEach((relativePath, file) => {
                if (file.dir && !skyboxName) { // take the first one
                    skyboxName = relativePath.replace(/\/$/, "");
                }
            });

            if (skyboxName) {
                console.log(`Found skybox in import: ${skyboxName}`);

                // Check if this is a custom skybox (not in default list)
                const isCustomSkybox = !DEFAULT_SKYBOXES.includes(skyboxName);

                if (isCustomSkybox) {
                    // Extract face textures and save as custom skybox
                    const faceKeys = ['+x', '-x', '+y', '-y', '+z', '-z'] as const;
                    const faceTextures: Record<string, string> = {};
                    let allFacesFound = true;

                    for (const faceKey of faceKeys) {
                        const faceFile = skyboxesFolder.file(`${skyboxName}/${faceKey}.png`) ||
                            skyboxesFolder.file(`${skyboxName}/${faceKey}.jpg`);
                        if (faceFile) {
                            try {
                                const blob = await faceFile.async('blob');
                                const dataUri = await new Promise<string>((resolve, reject) => {
                                    const reader = new FileReader();
                                    reader.onload = () => resolve(reader.result as string);
                                    reader.onerror = reject;
                                    reader.readAsDataURL(blob);
                                });
                                faceTextures[faceKey] = dataUri;
                            } catch (e) {
                                console.warn(`Failed to load skybox face ${faceKey}:`, e);
                                allFacesFound = false;
                            }
                        } else {
                            console.warn(`Skybox face ${faceKey} not found in ZIP`);
                            allFacesFound = false;
                        }
                    }

                    if (allFacesFound) {
                        // Generate preview for the custom skybox
                        const { generateSkyboxPreviewFromDataUris } = await import('./utils/SkyboxPreviewRenderer');
                        let previewDataUrl: string | undefined;
                        try {
                            previewDataUrl = await generateSkyboxPreviewFromDataUris(
                                faceTextures as Record<'+x' | '-x' | '+y' | '-y' | '+z' | '-z', string>,
                                { width: 64, height: 64 }
                            );
                        } catch (e) {
                            console.warn('Failed to generate preview for imported skybox:', e);
                        }

                        // Save custom skybox to database
                        const customSkybox = {
                            name: skyboxName,
                            faceTextures,
                            previewDataUrl
                        };

                        const existingSkyboxes = (await DatabaseManager.getData(STORES.SETTINGS, 'customSkyboxes') || []) as any[];
                        // Check if skybox with same name already exists
                        const existingIndex = existingSkyboxes.findIndex((s: any) => s.name === skyboxName);
                        if (existingIndex >= 0) {
                            existingSkyboxes[existingIndex] = customSkybox; // Update existing
                        } else {
                            existingSkyboxes.push(customSkybox); // Add new
                        }
                        await DatabaseManager.saveData(STORES.SETTINGS, 'customSkyboxes', existingSkyboxes);
                        console.log(`Saved imported custom skybox: ${skyboxName}`);
                    }
                }

                // Save to DB so it persists (project-scoped)
                await DatabaseManager.saveData(STORES.SETTINGS, `project:${DatabaseManager.getCurrentProjectId()}:selectedSkybox`, skyboxName);

                // Apply to current scene
                if (terrainBuilderRef.current?.changeSkybox) {
                    // Add a delay to ensure scene is ready, similar to App.tsx
                    setTimeout(() => {
                        console.log(`Applying imported skybox: ${skyboxName}`);
                        terrainBuilderRef.current.changeSkybox(skyboxName);
                    }, 1000);
                }

                // Dispatch event to notify UI components of the change
                window.dispatchEvent(new CustomEvent('skybox-changed', { detail: { skyboxName } }));
            }
        }

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

// Helper function to extract the relative path from a model URI
// e.g., "models/environment/City/barrel-wood-1.gltf" -> "City/barrel-wood-1.gltf"
// e.g., "models/environment/barrel-wood-1.gltf" -> "barrel-wood-1.gltf"
const getRelativeModelPath = (modelUri: string): string => {
    return modelUri.replace(/^models\/environment\//, '');
};

// Helper function to get the filename from a model URI or path
const getModelFileName = (modelUri: string): string => {
    return modelUri.split('/').pop() || modelUri;
};

// Helper function to process custom models from ZIP
const processCustomModelsFromZip = async (zip, importData) => {
    const modelsFolder = zip.folder("models/environment");
    if (!modelsFolder) return;

    // For each entity, check if we need to extract its model
    if (importData.entities) {
        const modelFiles = new Map<string, { modelUri: string; relativePath: string; fileName: string }>();
        const customModelsToSave = [];

        // Collect all unique model URIs that need to be extracted
        Object.values(importData.entities).forEach((entity: any) => {
            if (entity.modelUri && !entity.modelUri.startsWith('data:') && !entity.modelUri.startsWith('assets/')) {
                const relativePath = getRelativeModelPath(entity.modelUri);
                const fileName = getModelFileName(entity.modelUri);

                // Use relativePath as key to handle both flat and folder-based structures
                if (!modelFiles.has(relativePath)) {
                    modelFiles.set(relativePath, {
                        modelUri: entity.modelUri,
                        relativePath,
                        fileName
                    });
                }
            }
        });

        // Extract and process each unique model
        for (const [relativePath, modelInfo] of modelFiles) {
            // Try to find the model file - first with the full relative path (new format with folders)
            // then fallback to just filename (old flat format)
            let modelFile = modelsFolder.file(relativePath);

            // If not found with relative path, try just the filename (backward compatibility)
            if (!modelFile && relativePath.includes('/')) {
                modelFile = modelsFolder.file(modelInfo.fileName);
            }

            if (modelFile) {
                const arrayBuffer = await modelFile.async("arraybuffer");
                const modelName = modelInfo.fileName.replace('.gltf', '');

                // Save to custom models database
                const modelDataForDB = {
                    name: modelName,
                    data: arrayBuffer,
                    timestamp: Date.now(),
                };
                customModelsToSave.push(modelDataForDB);

                // Update all entities using this model to reference by name instead of URI
                Object.values(importData.entities).forEach((entity: any) => {
                    if (entity.modelUri === modelInfo.modelUri) {
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
                    // Start custom blocks at 1000, cap at 1999
                    let nextId = 1000;
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
                        (blockType.id >= 1000 && blockType.id < 2000)
                    ) {
                        // Check if block already exists by name only
                        const blockNameLower = blockType.name.toLowerCase();
                        const importedBlockId = blockType.id;

                        if (existingBlockNames.has(blockNameLower)) {
                            // Block name exists, remap to existing block's ID
                            const existingBlockId = existingBlockNameToId[blockNameLower];
                            blockIdMapping[importedBlockId] = existingBlockId;
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
                            lightLevel: blockType.lightLevel,
                            isLiquid: blockType.isLiquid === true, // Preserve isLiquid flag from import

                            sideTextures:
                                blockType.sideTextures || {},
                        };

                        await processCustomBlock(processedBlock);
                        processedCount++;

                        // Update our tracking sets with the new block
                        existingBlockNames.add(blockNameLower);
                        existingBlockIds.add(newBlockId);
                        existingBlockNameToId[blockNameLower] = newBlockId;

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
                                    (b.id >= 1000 && b.id < 2000)
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
                    // Validate that importedBlockId is a valid number
                    if (typeof importedBlockId !== 'number' || !Number.isInteger(importedBlockId) || importedBlockId < 0) {
                        console.warn(`Skipping corrupted block entry at ${key}: invalid block ID "${importedBlockId}"`);
                        return acc; // Skip this entry
                    }

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
                    const [x, , z] = key.split(",").map(Number);
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                    minZ = Math.min(minZ, z);
                    maxZ = Math.max(maxZ, z);
                });
            }

            if (importData.entities) {
                loadingManager.updateLoading(
                    "Calculating bounding boxes for import...",
                    60
                );

                // Ensure all models used in the import have bounding box data calculated
                const uniqueModelNames = new Set<string>();
                Object.values(importData.entities).forEach((entity: any) => {
                    const modelName = entity.modelName || entity.modelUri
                        ?.split("/")
                        .pop()
                        ?.replace(".gltf", "");
                    if (modelName) {
                        uniqueModelNames.add(modelName);
                    }
                });

                // Load models and calculate bounding boxes if missing
                let processedCount = 0;
                for (const modelName of uniqueModelNames) {
                    const model = environmentModels.find(m => m.name === modelName);
                    if (model && (!model.boundingBoxHeight || !model.boundingBoxCenter)) {
                        try {
                            // Load the model if not already loaded
                            await environmentBuilderRef.current.ensureModelLoaded(model);

                            // If still missing, calculate bounding box directly
                            if (!model.boundingBoxHeight || !model.boundingBoxCenter) {
                                const gltf = await environmentBuilderRef.current.loadModel(model.modelUrl);
                                if (gltf && gltf.scene) {
                                    // Reset transforms before calculating bounding box
                                    gltf.scene.position.set(0, 0, 0);
                                    gltf.scene.rotation.set(0, 0, 0);
                                    gltf.scene.scale.set(1, 1, 1);
                                    gltf.scene.updateMatrixWorld(true);

                                    // Use precise = true to match SDK client's bounding box calculation
                                    const bbox = new THREE.Box3().setFromObject(gltf.scene, true);
                                    const size = bbox.getSize(new THREE.Vector3());
                                    const center = bbox.getCenter(new THREE.Vector3());

                                    // Update the model in environmentModels array
                                    const modelIndex = environmentModels.findIndex(m => m.id === model.id);
                                    if (modelIndex !== -1) {
                                        environmentModels[modelIndex] = {
                                            ...environmentModels[modelIndex],
                                            boundingBoxHeight: size.y,
                                            boundingBoxWidth: size.x,
                                            boundingBoxDepth: size.z,
                                            boundingBoxCenter: center,
                                        };
                                        processedCount++;
                                    }
                                }
                            } else {
                                processedCount++;
                            }
                        } catch (error) {
                            console.warn(`Failed to calculate bounding box for ${modelName} during import:`, error);
                        }
                    }
                }

                loadingManager.updateLoading(
                    "Processing environment objects...",
                    65
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

                        // Handle modelScale: support both old format (number) and new format (Vector3 object)
                        const modelScale = entity.modelScale;
                        const scaleX = typeof modelScale === 'number' ? modelScale : (modelScale?.x ?? 1);
                        const scaleY = typeof modelScale === 'number' ? modelScale : (modelScale?.y ?? 1);
                        const scaleZ = typeof modelScale === 'number' ? modelScale : (modelScale?.z ?? 1);

                        // Reverse the export transformation:
                        // The JSON contains the CENTER position, but the editor stores the ORIGIN position.
                        // 1. Subtract the scaled bounding box center Y to convert from center back to origin
                        // 2. Add back ENVIRONMENT_OBJECT_Y_OFFSET (editor's internal Y offset)
                        const boundingBoxCenterY = matchingModel?.boundingBoxCenter?.y ?? (matchingModel?.boundingBoxHeight || 1) / 2;
                        const scaledCenterY = boundingBoxCenterY * scaleY;
                        const adjustedX = x;
                        const adjustedY = y + ENVIRONMENT_OBJECT_Y_OFFSET - scaledCenterY;
                        const adjustedZ = z;

                        // Warn if bounding box data is missing
                        if (!matchingModel?.boundingBoxHeight || !matchingModel?.boundingBoxCenter) {
                            console.warn(`[IMPORT] Missing bounding box data for ${modelName}`);
                        }

                        return {
                            position: { x: adjustedX, y: adjustedY, z: adjustedZ },
                            rotation: {
                                x: euler.x,
                                y: euler.y,
                                z: euler.z,
                            },
                            scale: {
                                x: scaleX,
                                y: scaleY,
                                z: scaleZ,
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
                            // Preserve tag from imported data if present
                            ...(entity.tag ? { tag: entity.tag } : {}),
                            // Preserve emissive properties from imported data if present
                            ...(entity.emissiveColor ? { emissiveColor: entity.emissiveColor } : {}),
                            ...(entity.emissiveIntensity != null ? { emissiveIntensity: entity.emissiveIntensity } : {}),
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

        // Preload textures for all blocks in the imported map
        if (terrainBuilderRef && terrainBuilderRef.current && Object.keys(terrainData).length > 0) {
            loadingManager.updateLoading(
                "Preloading textures...",
                82
            );

            try {
                // Collect all unique block IDs from the terrain data
                const uniqueBlockIds = new Set<number>();
                Object.values(terrainData).forEach((blockId) => {
                    if (blockId && typeof blockId === 'number' && blockId > 0) {
                        uniqueBlockIds.add(blockId);
                    }
                });

                console.log(`[IMPORT] Preloading textures for ${uniqueBlockIds.size} unique block types...`);

                const blockTypeRegistry = (window as any).BlockTypeRegistry;
                if (blockTypeRegistry && blockTypeRegistry.instance) {
                    const preloadPromises = Array.from(uniqueBlockIds).map(async (blockId) => {
                        try {
                            await blockTypeRegistry.instance.preloadBlockTypeTextures(blockId);
                        } catch (error) {
                            console.error(`[IMPORT] ✗ Failed to preload textures for block ${blockId}:`, error);
                        }
                    });
                    await Promise.allSettled(preloadPromises);
                    console.log(`[IMPORT] ✓ Completed texture preloading`);
                } else {
                    console.warn("[IMPORT] BlockTypeRegistry not available");
                }
            } catch (error) {
                console.error("[IMPORT] ✗ Error during texture preloading:", error);
                // Continue with import even if preloading fails
            }
        }

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

        // Import zones if present
        if (importData.zones && Array.isArray(importData.zones)) {
            loadingManager.updateLoading("Loading zones...", 98);
            try {
                zoneManager.importZones(importData.zones as Zone[]);
                console.log(`[IMPORT] Imported ${importData.zones.length} zones`);
            } catch (error) {
                console.warn("[IMPORT] Error importing zones:", error);
            }
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
// Export options interface
export interface ExportOptions {
    includeBlockTextures: boolean;
    includeModels: boolean;
    includeSkybox: boolean;
}

// Default export options (unchecked by default - custom assets are always included)
export const defaultExportOptions: ExportOptions = {
    includeBlockTextures: false,
    includeModels: false,
    includeSkybox: false,
};

// List of default skyboxes that come with the SDK
export const DEFAULT_SKYBOXES = ['partly-cloudy', 'partly-cloudy-alt', 'sunset', 'night'];

export const exportMapFile = async (
    terrainBuilderRef,
    environmentBuilderRef,
    options: ExportOptions = defaultExportOptions
) => {
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

        // Ensure all models used in the map have bounding box data calculated
        if (environmentObjects && environmentObjects.length > 0) {
            loadingManager.updateLoading("Calculating bounding boxes...", 15);
            const uniqueModelUrls = new Set(environmentObjects.map(obj => obj.modelUrl));
            const modelsToProcess = environmentModels.filter(model => uniqueModelUrls.has(model.modelUrl));

            // Calculate bounding boxes for models that don't have them
            let processedCount = 0;
            for (const model of modelsToProcess) {
                if (!model.boundingBoxHeight || !model.boundingBoxCenter) {
                    try {
                        // Load the model if not already loaded
                        await environmentBuilderRef.current.ensureModelLoaded(model);

                        // If still missing, calculate bounding box directly
                        if (!model.boundingBoxHeight || !model.boundingBoxCenter) {
                            const gltf = await environmentBuilderRef.current.loadModel(model.modelUrl);
                            if (gltf && gltf.scene) {
                                // Reset transforms before calculating bounding box
                                gltf.scene.position.set(0, 0, 0);
                                gltf.scene.rotation.set(0, 0, 0);
                                gltf.scene.scale.set(1, 1, 1);
                                gltf.scene.updateMatrixWorld(true);

                                // Use precise = true to match SDK client's bounding box calculation
                                // The SDK client uses Box3().setFromObject(model, true) for visual centering
                                const bbox = new THREE.Box3().setFromObject(gltf.scene, true);
                                const size = bbox.getSize(new THREE.Vector3());
                                const center = bbox.getCenter(new THREE.Vector3());

                                // Update the model in environmentModels array
                                const modelIndex = environmentModels.findIndex(m => m.id === model.id);
                                if (modelIndex !== -1) {
                                    environmentModels[modelIndex] = {
                                        ...environmentModels[modelIndex],
                                        boundingBoxHeight: size.y,
                                        boundingBoxWidth: size.x,
                                        boundingBoxDepth: size.z,
                                        boundingBoxCenter: center,
                                    };
                                    processedCount++;
                                }
                            }
                        } else {
                            processedCount++;
                        }
                    } catch (error) {
                        console.warn(`Failed to calculate bounding box for ${model.name}:`, error);
                    }
                }
            }
        }

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
        // Store texture info: { uri: string, blockName: string | null, isMulti: boolean, fileName: string; isCustom: boolean }
        const textureInfos = new Set<{ uri: string; blockName: string | null; isMulti: boolean; fileName: string; isCustom: boolean }>();
        const modelUris = new Map<string, boolean>(); // Map of modelUrl -> isCustom

        // Iterate over ONLY the used block types to collect textures (including data URIs)
        usedBlockTypes.forEach((block) => {
            const isMulti = block.isMultiTexture || false;
            const sanitizedBlockName = sanitizeName(block.name);
            const blockNameForPath = isMulti ? block.name : null;
            const isCustomBlock = block.isCustom || (block.id >= 1000 && block.id < 2000);

            // Handle main texture URI only for NON-multi-texture blocks
            if (!isMulti && block.textureUri && typeof block.textureUri === "string") {
                const ext = getFileExtensionFromUri(block.textureUri);
                const fileName = `${sanitizedBlockName}.${ext}`;
                textureInfos.add({ uri: block.textureUri, blockName: blockNameForPath, isMulti, fileName, isCustom: isCustomBlock });
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
                    textureInfos.add({ uri, blockName: blockNameForPath, isMulti, fileName, isCustom: isCustomBlock });
                });
            }
        });


        environmentObjects.forEach(obj => {
            const entityType = environmentModels.find(
                (model) => model.modelUrl === obj.modelUrl
            );
            if (entityType && entityType.modelUrl && !entityType.modelUrl.startsWith('data:')) { // Check if modelUrl exists and is not a data URI
                // Track whether the model is custom
                modelUris.set(entityType.modelUrl, entityType.isCustom || false);
            }
        });

        // Collect asset URIs - use project-scoped key for selected skybox
        const selectedSkybox = await DatabaseManager.getData(STORES.SETTINGS, `project:${DatabaseManager.getCurrentProjectId()}:selectedSkybox`);


        // --- Remap block IDs to 1..254 for SDK compatibility ---
        const sortedUsedIds = Array.from(usedBlockIds)
            .filter((id) => id !== 0)
            .sort((a, b) => a - b);
        const MAX_EXPORT_IDS = 254;
        if (sortedUsedIds.length > MAX_EXPORT_IDS) {
            loadingManager.hideLoading();
            alert(`Too many block types to export (${sortedUsedIds.length}). The export format supports up to ${MAX_EXPORT_IDS}. Reduce unique block types and try again.`);
            return;
        }

        const originalToExportId = new Map<number, number>();
        let nextExportId = 1; // 1..254
        for (const originalId of sortedUsedIds) {
            originalToExportId.set(originalId, nextExportId++);
        }

        const remappedTerrain = Object.entries(simplifiedTerrain).reduce((acc, [key, value]) => {
            const originalId = typeof value === 'number' ? value : Number(value);
            const mappedId = originalToExportId.get(originalId) ?? originalId;
            acc[key] = mappedId;
            return acc;
        }, {} as Record<string, number>);


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
                    id: originalToExportId.get(block.id) ?? block.id,
                    name: block.name,
                    textureUri: textureUriForJson, // For multi texture blocks this will be folder path; single texture blocks file path
                    isCustom: block.isCustom || (block.id >= 1000 && block.id < 2000),
                    isMultiTexture: isMulti,
                    lightLevel: (block as any).lightLevel,
                    isLiquid: (block as any).isLiquid === true, // Export isLiquid flag if set to true
                };
            }),
            blocks: remappedTerrain,
            entities: environmentObjects.reduce((acc, obj) => {
                const entityType = environmentModels.find(
                    (model) => model.modelUrl === obj.modelUrl
                );

                if (!entityType) {
                    console.warn(`[EXPORT] Model not found for URL: ${obj.modelUrl}`);
                    return acc;
                }

                {
                    // ... (keep existing entity processing logic)
                    const isThreeEuler = obj.rotation instanceof THREE.Euler;
                    // Extract rotation values - support both THREE.Euler and plain object format
                    const rotX = isThreeEuler ? obj.rotation.x : (obj.rotation?.x || 0);
                    const rotY = isThreeEuler ? obj.rotation.y : (obj.rotation?.y || 0);
                    const rotZ = isThreeEuler ? obj.rotation.z : (obj.rotation?.z || 0);

                    const hasRotation = Math.abs(rotX) > 0.001 || Math.abs(rotY) > 0.001 || Math.abs(rotZ) > 0.001;

                    // Create euler for quaternion conversion
                    const rotationEuler = new THREE.Euler(rotX, rotY, rotZ);

                    const quaternion = new THREE.Quaternion();
                    if (hasRotation) {
                        quaternion.setFromEuler(rotationEuler);
                    } else {
                        quaternion.identity();
                    }

                    // Adjust modelUri for JSON export (relative path within zip/final structure)
                    let modelUriForJson: string | undefined;
                    if (entityType.modelUrl && entityType.modelUrl.startsWith('data:')) {
                        modelUriForJson = entityType.modelUrl; // Keep data URI
                    } else if (entityType.isCustom) {
                        // Custom models go in the environment root
                        modelUriForJson = `models/environment/${entityType.name}.gltf`;
                    } else {
                        // Default models: preserve their folder structure
                        // modelUrl is like 'assets/models/environment/City/barrel-wood-1.gltf'
                        // We want to extract 'City/barrel-wood-1.gltf' and prepend 'models/environment/'
                        const pathAfterEnvironment = entityType.modelUrl.replace(/^assets\/models\/environment\//, '');
                        modelUriForJson = `models/environment/${pathAfterEnvironment}`;
                    }

                    // The SDK expects the CENTER position in map.json (physics position).
                    // The client calculates modelCenter using Three.js Box3().setFromObject() (same as editor)
                    // and offsets the visual model by -modelCenter to align center with physics position.
                    // 
                    // The editor stores the ORIGIN position (bottom), so we need to:
                    // 1. Add the scaled bounding box center Y to convert from origin to center
                    // 2. Compensate for ENVIRONMENT_OBJECT_Y_OFFSET (editor's internal Y offset)
                    const boundingBoxCenterY = entityType.boundingBoxCenter?.y ?? (entityType.boundingBoxHeight || 1) / 2;
                    const scaledCenterY = boundingBoxCenterY * obj.scale.y;
                    const adjustedPos = new THREE.Vector3(
                        obj.position.x,
                        obj.position.y - ENVIRONMENT_OBJECT_Y_OFFSET + scaledCenterY,
                        obj.position.z
                    );

                    // Warn if bounding box data is missing
                    if (!entityType.boundingBoxHeight || !entityType.boundingBoxCenter) {
                        console.warn(`[EXPORT] Missing bounding box data for ${entityType.name}`);
                    }

                    const key = `${adjustedPos.x},${adjustedPos.y},${adjustedPos.z}`;
                    acc[key] = {
                        modelUri: modelUriForJson, // Use adjusted relative path
                        modelPreferredShape: (entityType.addCollider === false) ? "none" : "trimesh",
                        modelLoopedAnimations: [],
                        modelScale: {
                            x: obj.scale.x,
                            y: obj.scale.y,
                            z: obj.scale.z,
                        },
                        name: entityType.name,
                        ...(obj.tag ? { tag: obj.tag } : {}), // Include tag only if set
                        ...(obj.emissiveColor ? { emissiveColor: obj.emissiveColor } : {}), // Include emissive color only if set
                        ...(obj.emissiveIntensity != null && obj.emissiveIntensity > 0 ? { emissiveIntensity: obj.emissiveIntensity } : {}), // Include emissive intensity only if set
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
            // Export zones
            zones: zoneManager.exportZones(),
            version: version || "1.0.0",
        };

        // --- Fetch Assets and Create ZIP ---
        loadingManager.updateLoading("Fetching assets...", 80);
        const zip = new JSZip();
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

        // Check if we have any block textures to include (custom blocks or default blocks with option enabled)
        const hasBlockTexturesToInclude = Array.from(textureInfos).some(
            texInfo => texInfo.isCustom || options.includeBlockTextures
        );

        // Only create blocks folder if there's content to add
        const blocksRootFolder = hasBlockTexturesToInclude ? zip.folder("blocks") : null;

        // Include block textures: always include custom blocks, include default blocks only if option is enabled
        if (blocksRootFolder) {
            textureInfos.forEach(texInfo => {
                // Skip default blocks if option is disabled (custom blocks are always included)
                if (!texInfo.isCustom && !options.includeBlockTextures) {
                    return;
                }

                const fileName = texInfo.fileName;
                if (!fileName) return;

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
        }


        // Check if we have any models to include (custom models or default models with option enabled)
        const hasModelsToInclude = Array.from(modelUris.entries()).some(
            ([uri, isCustomModel]) => isCustomModel || options.includeModels
        );

        // Only create models folder if there's content to add
        const modelsFolder = hasModelsToInclude ? zip.folder("models/environment") : null;

        // Include models: always include custom models, include default models only if option is enabled
        if (modelsFolder) {
            modelUris.forEach((isCustomModel, uri) => {
                // Skip default models if option is disabled (custom models are always included)
                if (!isCustomModel && !options.includeModels) {
                    return;
                }

                if (uri && !uri.startsWith('data:') && !fetchedAssetUrls.has(uri)) { // Avoid data URIs and duplicates
                    fetchedAssetUrls.add(uri);
                    const matchingModel = environmentModels.find(m => m.modelUrl === uri);

                    let relativePath: string | undefined;
                    if (matchingModel && matchingModel.isCustom) {
                        // Custom models go in the environment root
                        relativePath = `${matchingModel.name}.gltf`;
                    } else {
                        // Default models: preserve their folder structure
                        // uri is like 'assets/models/environment/City/barrel-wood-1.gltf'
                        // Extract 'City/barrel-wood-1.gltf'
                        relativePath = uri.replace(/^assets\/models\/environment\//, '');
                    }

                    if (relativePath) {
                        fetchPromises.push(
                            fetch(uri)
                                .then(response => {
                                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status} for ${uri}`);
                                    return response.blob();
                                })
                                .then(blob => {
                                    // This will create subfolders automatically if relativePath contains '/'
                                    modelsFolder.file(relativePath, blob);
                                })
                                .catch(error => console.error(`Failed to fetch/add model ${uri}:`, error))
                        );
                    }
                }
            });
        }

        // Handle skybox export
        if (typeof selectedSkybox === 'string' && selectedSkybox) {
            const isCustomSkybox = !DEFAULT_SKYBOXES.includes(selectedSkybox);
            const shouldIncludeSkybox = isCustomSkybox || options.includeSkybox;

            if (shouldIncludeSkybox) {
                const skyboxesRootFolder = zip.folder("skyboxes");
                if (skyboxesRootFolder) {
                    const skyboxFolder = skyboxesRootFolder.folder(selectedSkybox);
                    const faceKeys = ["+x", "-x", "+y", "-y", "+z", "-z"];

                    if (isCustomSkybox) {
                        // Custom skybox - load from database
                        const customSkyboxes = (await DatabaseManager.getData(STORES.SETTINGS, 'customSkyboxes') || []) as any[];
                        const customSkybox = customSkyboxes.find((s: any) => s.name === selectedSkybox);

                        if (customSkybox && customSkybox.faceTextures) {
                            for (const faceKey of faceKeys) {
                                const dataUri = customSkybox.faceTextures[faceKey];
                                if (dataUri) {
                                    // Convert data URI to blob
                                    const response = await fetch(dataUri);
                                    const blob = await response.blob();
                                    skyboxFolder.file(`${faceKey}.png`, blob);
                                }
                            }
                        }
                    } else {
                        // Default skybox - fetch from assets
                        faceKeys.forEach(faceKey => {
                            const uri = `assets/skyboxes/${selectedSkybox}/${faceKey}.png`;
                            if (!fetchedAssetUrls.has(uri)) {
                                fetchedAssetUrls.add(uri);
                                fetchPromises.push(
                                    fetch(uri)
                                        .then(response => {
                                            if (!response.ok) throw new Error(`HTTP error! status: ${response.status} for ${uri}`);
                                            return response.blob();
                                        })
                                        .then(blob => {
                                            skyboxFolder.file(`${faceKey}.png`, blob);
                                        })
                                        .catch(error => console.error(`Failed to fetch/add skybox texture ${uri}:`, error))
                                );
                            }
                        });
                    }
                }
            }
        }


        await Promise.all(fetchPromises);
        // --- End Fetch Assets and Create ZIP ---

        loadingManager.updateLoading("Creating export files...", 90);
        const jsonContent = JSON.stringify(exportData, null, 2);
        const jsonBlob = new Blob([jsonContent], { type: "application/json" });

        // Add map.json to the zip file root
        zip.file("map.json", jsonBlob);

        // Add zones.ts TypeScript file if there are zones
        const zonesTs = zoneManager.generateZonesTypeScript();
        if (zonesTs) {
            const zonesTsBlob = new Blob([zonesTs], { type: "text/typescript" });
            zip.file("zones.ts", zonesTsBlob);
        }

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
