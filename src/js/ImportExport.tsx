import { DatabaseManager, STORES } from "./managers/DatabaseManager";
import { getBlockTypes, processCustomBlock } from "./TerrainBuilder";
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
        const reader = new FileReader();
        return new Promise((resolve, reject) => {
            reader.onload = async (event) => {
                try {
                    loadingManager.updateLoading(
                        "Parsing imported file...",
                        10
                    );

                    const importData = JSON.parse(event.target.result as string);
                    console.log("Importing map data:", importData);
                    let terrainData = {};
                    let environmentData = [];

                    if (importData.blocks) {

                        if (
                            importData.blockTypes &&
                            importData.blockTypes.length > 0
                        ) {
                            loadingManager.updateLoading(
                                `Processing ${importData.blockTypes.length} block types...`,
                                20
                            );


                            for (const blockType of importData.blockTypes) {

                                if (
                                    blockType.isCustom ||
                                    (blockType.id >= 100 && blockType.id < 200)
                                ) {



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
                                        id: blockType.id,
                                        name: blockType.name,
                                        textureUri: blockType.textureUri, // Pass the URI from the file (could be path or data)
                                        isCustom: true,
                                        isMultiTexture: likelyIsMultiTexture,

                                        sideTextures:
                                            blockType.sideTextures || {},
                                    };

                                    await processCustomBlock(processedBlock);
                                }
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
                            30
                        );


                        const blockIdMapping = {};


                        const currentBlockTypes = getBlockTypes();


                        const currentBlockNameToId = {};
                        currentBlockTypes.forEach(blockType => {
                            currentBlockNameToId[blockType.name.toLowerCase()] = blockType.id;
                        });


                        if (importData.blockTypes && importData.blockTypes.length > 0) {
                            importData.blockTypes.forEach(importedBlockType => {
                                const blockName = importedBlockType.name.toLowerCase();
                                const importedId = importedBlockType.id;


                                if (currentBlockNameToId.hasOwnProperty(blockName)) {
                                    blockIdMapping[importedId] = currentBlockNameToId[blockName];
                                    console.log(`Mapped imported block "${importedBlockType.name}" (ID: ${importedId}) to editor ID: ${blockIdMapping[importedId]}`);
                                } else {

                                    blockIdMapping[importedId] = importedId;
                                    console.log(`No name match for imported block "${importedBlockType.name}" (ID: ${importedId}), using original ID`);
                                }
                            });
                        } else {

                            console.log("No block types in import file, using direct ID mapping");
                            currentBlockTypes.forEach(blockType => {
                                blockIdMapping[blockType.id] = blockType.id;
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
                                40
                            );
                            console.log(
                                "Calculating map dimensions to update grid size..."
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
                            environmentData = Object.entries(
                                importData.entities
                            )
                                .map(([key, entity]: [string, any], index) => {
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

                                    const modelName = entity.modelUri
                                        .split("/")
                                        .pop()
                                        .replace(".gltf", "");
                                    const matchingModel =
                                        environmentModels.find(
                                            (model) => model.name === modelName
                                        );

                                    const boundingBoxHeight =
                                        matchingModel?.boundingBoxHeight || 1;
                                    const verticalOffset =
                                        (boundingBoxHeight *
                                            entity.modelScale) /
                                        2;
                                    const adjustedY = y - 0.5 - verticalOffset;

                                    const boundingBoxWidth =
                                        matchingModel?.boundingBoxWidth || 1;
                                    const boundingBoxDepth =
                                        matchingModel?.boundingBoxDepth || 1;

                                    const horizontalOffsetX =
                                        (boundingBoxWidth * entity.modelScale) / 2;
                                    const horizontalOffsetZ =
                                        (boundingBoxDepth * entity.modelScale) / 2;

                                    const adjustedX = x - horizontalOffsetX;
                                    const adjustedZ = z - horizontalOffsetZ;

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
                                            : `assets/${entity.modelUri}`,
                                        name: modelName,
                                        modelLoopedAnimations:
                                            entity.modelLoopedAnimations || [
                                                "idle",
                                            ],

                                        instanceId: index, // Use the array index as a unique ID
                                    };
                                })
                                .filter((obj) => obj !== null);
                            console.log(
                                `Imported ${environmentData.length} environment objects`
                            );
                        }
                    } else {
                        loadingManager.hideLoading();
                        alert(
                            "Invalid map file format - no valid map data found"
                        );
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
                        console.log("Refreshing terrain from DB after import");
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
                    // resolve();
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
    } catch (error) {
        loadingManager.hideLoading();
        console.error("Error importing map:", error);
        alert("Error importing map. Please try again.");
        throw error;
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
        console.log("Retrieved environmentObjects for export:", environmentObjects);

        console.log("Exporting environment data:", environmentObjects);

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
        console.log("Exporting block types:", allBlockTypes);

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
        console.log("Used Block IDs in terrain:", usedBlockIds);

        // --- Filter Block Types to only those used ---
        const usedBlockTypes = allBlockTypes.filter(block => usedBlockIds.has(block.id));
        console.log("Filtered Block Types (used in terrain):", usedBlockTypes);
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

            // Handle side textures (ensure we consider every face key defined)
            FACE_KEYS.forEach(faceKey => {
                const uri = block.sideTextures?.[faceKey] || block.sideTextures?.["+y"] || block.textureUri;
                if (!uri) {
                    return; // Skip this face if no texture found
                }
                const ext = getFileExtensionFromUri(uri);
                const fileName = `${sanitizedBlockName}_${faceKey}.${ext}`;
                textureInfos.add({ uri, blockName: blockNameForPath, isMulti, fileName });
            });
        });


        environmentObjects.forEach(obj => {
            const entityType = environmentModels.find(
                (model) => model.modelUrl === obj.modelUrl
            );
            if (entityType && entityType.modelUrl && !entityType.modelUrl.startsWith('data:')) { // Check if modelUrl exists and is not a data URI
                modelUris.add(entityType.modelUrl);
            }
        });

        console.log("Collected Texture Infos:", Array.from(textureInfos));
        console.log("Collected Model URIs:", Array.from(modelUris));
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

                // --- Side textures (for both single- and multi-texture blocks) ---
                const sideTexturesForJson = Object.fromEntries(
                    FACE_KEYS.map(faceKey => {
                        const uri = block.sideTextures?.[faceKey] || block.sideTextures?.["+y"] || block.textureUri;
                        if (!uri) {
                            return [faceKey, ""];
                        }
                        const ext = getFileExtensionFromUri(uri);
                        const fileNameSide = `${sanitizedBlockName}_${faceKey}.${ext}`;
                        const pathInZip = isMulti ? `blocks/${block.name}/${fileNameSide}` : `blocks/${fileNameSide}`;
                        return [faceKey, pathInZip];
                    })
                );

                return {
                    id: block.id,
                    name: block.name,
                    textureUri: textureUriForJson, // Use adjusted path for zip structure
                    isCustom: block.isCustom || (block.id >= 100 && block.id < 200),
                    isMultiTexture: isMulti, // Ensure this is exported
                    sideTextures: sideTexturesForJson, // Use adjusted paths for zip structure
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
                    const rotY = isThreeEuler ? obj.rotation.y : (obj.rotation?.y || 0);


                    const hasRotation = Math.abs(rotY) > 0.001;


                    const quaternion = new THREE.Quaternion();
                    if (hasRotation) {
                        quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
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


                    const boundingBoxHeight = entityType.boundingBoxHeight || 1;
                    const verticalOffset =
                        (boundingBoxHeight * obj.scale.y) / 2;
                    const adjustedY = obj.position.y + 0.5 + verticalOffset;

                    const boundingBoxWidth = entityType.boundingBoxWidth || 1;
                    const boundingBoxDepth = entityType.boundingBoxDepth || 1;

                    const horizontalOffsetX = (boundingBoxWidth * obj.scale.x) / 2;
                    const horizontalOffsetZ = (boundingBoxDepth * obj.scale.z) / 2;

                    const adjustedX = obj.position.x + horizontalOffsetX;
                    const adjustedZ = obj.position.z + horizontalOffsetZ;

                    const key = `${adjustedX},${adjustedY},${adjustedZ}`;
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

        textureInfos.forEach(texInfo => {
            if (texInfo.uri && !fetchedAssetUrls.has(texInfo.uri)) {
                fetchedAssetUrls.add(texInfo.uri);

                const fileName = texInfo.fileName;

                if (fileName && blocksRootFolder) {
                    // Determine the target folder within the zip (sub-folder for multi-texture blocks)
                    const targetFolder = texInfo.isMulti && texInfo.blockName
                        ? blocksRootFolder.folder(texInfo.blockName)
                        : blocksRootFolder;

                    if (!targetFolder) {
                        console.error(`Could not get or create texture folder for ${texInfo.blockName || 'root'}`);
                        return; // Skip this texture if folder creation fails
                    }

                    fetchPromises.push(
                        fetch(texInfo.uri)
                            .then(response => {
                                if (!response.ok) throw new Error(`HTTP error! status: ${response.status} for ${texInfo.uri}`);
                                return response.blob();
                            })
                            .then(blob => {
                                targetFolder.file(fileName, blob); // Add to the appropriate folder
                                const pathInZip = texInfo.isMulti && texInfo.blockName ? `${texInfo.blockName}/${fileName}` : fileName;
                                console.log(`Added texture: ${pathInZip} to zip`);
                            })
                            .catch(error => console.error(`Failed to fetch/add texture ${texInfo.uri}:`, error))
                    );
                }
            }
        });


        modelUris.forEach(uri => {
            if (uri && !uri.startsWith('data:') && !fetchedAssetUrls.has(uri)) { // Avoid data URIs and duplicates
                fetchedAssetUrls.add(uri);
                const fileName = uri.split('/').pop(); // Extract filename
                if (fileName && modelsFolder) {
                    fetchPromises.push(
                        fetch(uri)
                            .then(response => {
                                if (!response.ok) throw new Error(`HTTP error! status: ${response.status} for ${uri}`);
                                return response.blob();
                            })
                            .then(blob => {
                                modelsFolder.file(fileName, blob);
                                console.log(`Added model: ${fileName} to zip`);
                            })
                            .catch(error => console.error(`Failed to fetch/add model ${uri}:`, error))
                    );
                }
            }
        });


        await Promise.all(fetchPromises);
        console.log("Asset fetching complete.");
        // --- End Fetch Assets and Create ZIP ---

        loadingManager.updateLoading("Creating export files...", 90);
        const jsonContent = JSON.stringify(exportData, null, 2);
        const jsonBlob = new Blob([jsonContent], { type: "application/json" });

        // Add terrain.json to the zip file root
        zip.file("terrain.json", jsonBlob);
        console.log("Added terrain.json to zip");

        const zipBlob = await zip.generateAsync({ type: "blob" });

        loadingManager.updateLoading("Preparing download...", 95);

        // Download ZIP (which now includes terrain.json)
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
