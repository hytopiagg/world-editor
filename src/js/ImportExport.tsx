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

                            const width = maxX - minX + 10;
                            const length = maxZ - minZ + 10;

                            const gridSize =
                                Math.ceil(Math.max(width, length) / 16) * 16;

                            if (terrainBuilderRef.current.updateGridSize) {
                                loadingManager.updateLoading(
                                    `Updating grid size to ${gridSize}...`,
                                    50
                                );

                                terrainBuilderRef.current.updateGridSize(
                                    gridSize
                                );
                                console.log(
                                    `Grid size update completed, should now be ${gridSize}`
                                );
                            } else {
                                console.warn(
                                    "updateGridSize method not found on terrainBuilderRef"
                                );
                            }
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
        if (
            !terrainBuilderRef.current.getCurrentTerrainData() ||
            Object.keys(terrainBuilderRef.current.getCurrentTerrainData())
                .length === 0
        ) {
            alert("No map found to export!");
            return;
        }

        loadingManager.showLoading("Preparing to export map...", 0);

        loadingManager.updateLoading("Retrieving environment data...", 10);
        const environmentObjects = environmentBuilderRef.current.getAllEnvironmentObjects();
        // (await DatabaseManager.getData(STORES.ENVIRONMENT, "current")) ||
        // [];
        console.log("Retrieved environmentObjects for export:", environmentObjects);

        console.log("Exporting environment data:", environmentObjects);

        loadingManager.updateLoading("Processing terrain data...", 30);
        const simplifiedTerrain = Object.entries(
            terrainBuilderRef.current.getCurrentTerrainData()
        ).reduce((acc, [key, value]) => {
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

        // --- Collect Asset URIs ---
        loadingManager.updateLoading("Collecting asset URIs...", 60);
        // Store texture info: { uri: string, blockName: string | null, isMulti: boolean }
        const textureInfos = new Set<{ uri: string; blockName: string | null; isMulti: boolean }>();
        const modelUris = new Set<string>();

        // Iterate over ONLY the used block types to collect textures
        usedBlockTypes.forEach((block) => {
            const isMulti = block.isMultiTexture || false;
            const blockNameForPath = isMulti ? block.name : null;

            // Handle main texture URI if it exists and isn't data
            if (block.textureUri && typeof block.textureUri === 'string' && !block.textureUri.startsWith('data:')) {
                // For multi-texture blocks, the main textureUri might represent a convention or primary texture.
                // We add it like any other texture associated with this block.
                textureInfos.add({ uri: block.textureUri, blockName: blockNameForPath, isMulti });
            }

            // Add side textures if they exist and are not data URIs
            if (block.sideTextures) {
                Object.values(block.sideTextures).forEach(uri => {
                    if (uri && typeof uri === 'string' && !uri.startsWith('data:')) {
                        textureInfos.add({ uri: uri, blockName: blockNameForPath, isMulti });
                    }
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

        console.log("Collected Texture Infos:", Array.from(textureInfos));
        console.log("Collected Model URIs:", Array.from(modelUris));
        // --- End Collect Asset URIs ---


        loadingManager.updateLoading("Building export data structure...", 70);
        const exportData = {
            // Export block type definitions only for the blocks actually used
            blockTypes: usedBlockTypes.map((block) => {
                // Determine JSON paths based on zip structure
                let textureUriForJson: string | undefined;
                const isMulti = block.isMultiTexture || false;

                if (block.textureUri && block.textureUri.startsWith('data:')) {
                    textureUriForJson = block.textureUri; // Keep data URI as is
                } else if (isMulti) {
                    // Multi-texture blocks point to their folder in the zip
                    textureUriForJson = `blocks/${block.name}`; // Represents the folder
                } else if (block.textureUri) {
                    // Single-texture blocks point to the file in the root textures folder
                    const fileName = block.textureUri.split('/').pop();
                    textureUriForJson = `blocks/${fileName}`;
                } else {
                    textureUriForJson = undefined; // No texture URI provided
                }

                // Process side textures for JSON paths
                const sideTexturesForJson = block.sideTextures ? Object.entries(block.sideTextures).reduce((acc, [side, uri]) => {
                    if (uri && typeof uri === 'string') {
                        if (uri.startsWith('data:')) {
                            acc[side] = uri; // Keep data URI as is
                        } else {
                            const fileName = uri.split('/').pop();
                            if (fileName) {
                                acc[side] = isMulti
                                    ? `blocks/${block.name}/${fileName}` // Path within block's subfolder
                                    : `blocks/${fileName}`; // Path in root textures folder
                            }
                        }
                    }
                    return acc;
                }, {}) : undefined;


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

                    const key = `${obj.position.x},${adjustedY},${obj.position.z}`;
                    acc[key] = {
                        modelUri: modelUriForJson, // Use adjusted relative path
                        modelLoopedAnimations: entityType.animations || [
                            "idle",
                        ],
                        modelScale: obj.scale.x, // Assuming uniform scale for simplicity
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
            if (texInfo.uri && !texInfo.uri.startsWith('data:') && !fetchedAssetUrls.has(texInfo.uri)) {
                fetchedAssetUrls.add(texInfo.uri);
                const fileName = texInfo.uri.split('/').pop();

                if (fileName && blocksRootFolder) {
                    // Determine the target folder within the zip
                    const targetFolder = texInfo.isMulti && texInfo.blockName
                        ? blocksRootFolder.folder(texInfo.blockName) // Get or create subfolder
                        : blocksRootFolder; // Use root textures folder

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
                                targetFolder.file(fileName, blob); // Add to the correct folder (root or subfolder)
                                const pathInZip = texInfo.isMulti && texInfo.blockName ? `${texInfo.blockName}/${fileName}` : fileName;
                                console.log(`Added texture: ${pathInZip} to zip folder textures/`);
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
