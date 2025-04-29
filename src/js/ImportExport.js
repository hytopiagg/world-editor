import { DatabaseManager, STORES } from "./DatabaseManager";
import { getBlockTypes, processCustomBlock } from "./TerrainBuilder";
import { environmentModels } from "./EnvironmentBuilder";
import * as THREE from "three";
import { version } from "./Constants";
import { loadingManager } from "./LoadingManager";

export const importMap = async (
    file,
    terrainBuilderRef,
    environmentBuilderRef
) => {
    try {
        // Show loading screen at the start of import
        loadingManager.showLoading("Starting import process...", 0);

        const reader = new FileReader();

        return new Promise((resolve, reject) => {
            reader.onload = async (event) => {
                try {
                    loadingManager.updateLoading(
                        "Parsing imported file...",
                        10
                    );

                    // get the data from the event, and convert it to a json object
                    const importData = JSON.parse(event.target.result);

                    console.log("Importing map data:", importData);

                    let terrainData = {};
                    let environmentData = [];

                    // Lets make sure there is data at all
                    if (importData.blocks) {
                        // Process any custom blocks first
                        if (
                            importData.blockTypes &&
                            importData.blockTypes.length > 0
                        ) {
                            loadingManager.updateLoading(
                                `Processing ${importData.blockTypes.length} block types...`,
                                20
                            );
                            //console.log(`Processing ${importData.blockTypes.length} block types from import`);

                            // Process each block type, ensuring custom blocks are properly handled
                            for (const blockType of importData.blockTypes) {
                                // Only process blocks that are custom or have IDs in the custom range (100-199)
                                if (
                                    blockType.isCustom ||
                                    (blockType.id >= 100 && blockType.id < 200)
                                ) {
                                    //  console.log(`Processing custom block: ${blockType.name} (ID: ${blockType.id})`);

                                    // Determine if it's multi-texture based on URI or explicit flag (if present)
                                    // If textureUri doesn't end with .png (or similar image extension), assume multi-texture
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

                                    // Prepare block data for processing
                                    const processedBlock = {
                                        id: blockType.id,
                                        name: blockType.name,
                                        textureUri: blockType.textureUri, // Pass the URI from the file (could be path or data)
                                        isCustom: true,
                                        isMultiTexture: likelyIsMultiTexture,
                                        // Pass sideTextures if they exist in the import, otherwise default to empty
                                        sideTextures:
                                            blockType.sideTextures || {},
                                    };

                                    // Process the custom block - this function needs to handle existing/missing logic
                                    await processCustomBlock(processedBlock);
                                }
                            }

                            // Dispatch event to notify that custom blocks have been loaded
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

                        // Create a mapping from imported block IDs to editor block IDs
                        const blockIdMapping = {};
                        
                        // Get all current block types in the editor
                        const currentBlockTypes = getBlockTypes();
                        
                        // Create a map of names to IDs for quick lookups
                        const currentBlockNameToId = {};
                        currentBlockTypes.forEach(blockType => {
                            currentBlockNameToId[blockType.name.toLowerCase()] = blockType.id;
                        });
                        
                        // If imported file has block types, build the mapping
                        if (importData.blockTypes && importData.blockTypes.length > 0) {
                            importData.blockTypes.forEach(importedBlockType => {
                                const blockName = importedBlockType.name.toLowerCase();
                                const importedId = importedBlockType.id;
                                
                                // First try to match by name (case insensitive)
                                if (currentBlockNameToId.hasOwnProperty(blockName)) {
                                    blockIdMapping[importedId] = currentBlockNameToId[blockName];
                                    console.log(`Mapped imported block "${importedBlockType.name}" (ID: ${importedId}) to editor ID: ${blockIdMapping[importedId]}`);
                                } else {
                                    // If no name match, use the original ID
                                    blockIdMapping[importedId] = importedId;
                                    console.log(`No name match for imported block "${importedBlockType.name}" (ID: ${importedId}), using original ID`);
                                }
                            });
                        } else {
                            // If no block types in import, attempt to match standard blocks by ID only
                            console.log("No block types in import file, using direct ID mapping");
                            currentBlockTypes.forEach(blockType => {
                                blockIdMapping[blockType.id] = blockType.id;
                            });
                        }

                        // Now process terrain data with ID mapping
                        terrainData = Object.entries(importData.blocks).reduce(
                            (acc, [key, importedBlockId]) => {
                                // Use mapped ID if available, otherwise use the original ID
                                const mappedId = blockIdMapping[importedBlockId] !== undefined 
                                    ? blockIdMapping[importedBlockId] 
                                    : importedBlockId;
                                    
                                acc[key] = mappedId;
                                return acc;
                            },
                            {}
                        );

                        // Calculate map size from terrain data to update grid size
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

                            // Find the min/max coordinates
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

                            // Calculate width and length (adding a small margin)
                            const width = maxX - minX + 10;
                            const length = maxZ - minZ + 10;

                            // Use the larger dimension for the grid size (rounded up to nearest multiple of 16)
                            const gridSize =
                                Math.ceil(Math.max(width, length) / 16) * 16;

                            console.log(
                                `Map dimensions: ${width}x${length}, setting grid size to ${gridSize}`
                            );

                            // Update the grid size before loading the terrain
                            if (terrainBuilderRef.current.updateGridSize) {
                                loadingManager.updateLoading(
                                    `Updating grid size to ${gridSize}...`,
                                    50
                                );
                                console.log(
                                    `Calling updateGridSize with gridSize=${gridSize}`
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

                        // Convert entities to environment format
                        if (importData.entities) {
                            loadingManager.updateLoading(
                                "Processing environment objects...",
                                60
                            );
                            environmentData = Object.entries(
                                importData.entities
                            )
                                .map(([key, entity], index) => {
                                    const [x, y, z] = key
                                        .split(",")
                                        .map(Number);

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

                                    // Get model name from the file path
                                    const modelName = entity.modelUri
                                        .split("/")
                                        .pop()
                                        .replace(".gltf", "");
                                    const matchingModel =
                                        environmentModels.find(
                                            (model) => model.name === modelName
                                        );

                                    // Calculate the vertical offset to subtract
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
                                        // Add instanceId to each object - this is critical!
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

                    // Save terrain data
                    loadingManager.updateLoading(
                        "Saving terrain data to database...",
                        70
                    );
                    await DatabaseManager.saveData(
                        STORES.TERRAIN,
                        "current",
                        terrainData
                    );

                    // Save environment data
                    loadingManager.updateLoading(
                        "Saving environment data to database...",
                        80
                    );
                    await DatabaseManager.saveData(
                        STORES.ENVIRONMENT,
                        "current",
                        environmentData
                    );

                    // Refresh terrain and environment builders
                    if (terrainBuilderRef && terrainBuilderRef.current) {
                        loadingManager.updateLoading(
                            "Rebuilding terrain from imported data...",
                            85
                        );
                        console.log("Refreshing terrain from DB after import");
                        await terrainBuilderRef.current.refreshTerrainFromDB();

                        // The spatial hash is already rebuilt during refreshTerrainFromDB,
                        // so we don't need to do it again here
                    }

                    if (
                        environmentBuilderRef &&
                        environmentBuilderRef.current
                    ) {
                        // Wait for environment refresh to complete
                        loadingManager.updateLoading(
                            "Loading environment objects...",
                            95
                        );
                        await environmentBuilderRef.current.refreshEnvironmentFromDB();
                    }

                    loadingManager.updateLoading("Import complete!", 100);
                    // Allow a moment to see the completed status before hiding
                    setTimeout(() => {
                        loadingManager.hideLoading();
                    }, 500);

                    resolve();
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

export const exportMapFile = async (terrainBuilderRef) => {
    try {
        if (
            !terrainBuilderRef.current.getCurrentTerrainData() ||
            Object.keys(terrainBuilderRef.current.getCurrentTerrainData())
                .length === 0
        ) {
            alert("No map found to export!");
            return;
        }

        // Show loading screen at the start of export
        loadingManager.showLoading("Preparing to export map...", 0);

        // Get environment data
        loadingManager.updateLoading("Retrieving environment data...", 10);
        const environmentObjects =
            (await DatabaseManager.getData(STORES.ENVIRONMENT, "current")) ||
            [];

        // Simplify terrain data to just include block IDs
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

        // Create the export object with properly formatted block types
        loadingManager.updateLoading("Building export data structure...", 70);
        const exportData = {
            blockTypes: allBlockTypes.map((block) => {
                // Check if it's a custom block (using ID range 100-199 or isCustom flag)
                if ((block.id >= 100 && block.id < 200) || block.isCustom) {
                    // Generate the custom path based on whether it's multi-texture or not
                    const customPath = block.isMultiTexture
                        ? `blocks/custom/${block.name}` // Path for multi-texture (folder)
                        : `blocks/custom/${block.name}.png`; // Path for single texture (PNG file)

                    // Return simplified custom block structure
                    return {
                        id: block.id,
                        name: block.name,
                        textureUri: customPath,
                        isCustom: true,
                        // Removed: isMultiTexture, sideTextures
                    };
                } else {
                    // Standard blocks: use the normalized path format
                    // Return simplified standard block structure
                    return {
                        id: block.id,
                        name: block.name,
                        textureUri: block.isMultiTexture
                            ? `blocks/${block.name}`
                            : `blocks/${block.name}.png`,
                        isCustom: false,
                        // Removed: isMultiTexture, sideTextures, isLiquid
                    };
                }
            }),
            blocks: simplifiedTerrain,
            entities: environmentObjects.reduce((acc, obj) => {
                const entityType = environmentModels.find(
                    (model) => model.modelUrl === obj.modelUrl
                );

                if (entityType) {
                    // Get the Y rotation value (this is the only axis that's used in the app)
                    // Check if rotation is a plain object (from DB) or a THREE.Euler object
                    const isThreeEuler = obj.rotation instanceof THREE.Euler;
                    const rotY = isThreeEuler ? obj.rotation.y : (obj.rotation?.y || 0);
                    
                    // Only apply non-zero rotation (with a small epsilon to handle floating point imprecision)
                    const hasRotation = Math.abs(rotY) > 0.001;
                    
                    // Create quaternion directly from Y rotation (this is more reliable than Euler conversion)
                    const quaternion = new THREE.Quaternion();
                    if (hasRotation) {
                        quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
                    } else {
                        // Use identity quaternion for no rotation (0,0,0,1)
                        quaternion.identity();
                    }

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
            version: version || "1.0.0",
        };

        // Convert to JSON and create a blob
        loadingManager.updateLoading("Creating export file...", 90);
        const jsonContent = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonContent], { type: "application/json" });

        // Create download link
        loadingManager.updateLoading("Preparing download...", 95);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "terrain.json";

        loadingManager.updateLoading("Export complete!", 100);
        // Allow a brief moment to see completion message
        setTimeout(() => {
            a.click();
            URL.revokeObjectURL(url);
            loadingManager.hideLoading();
        }, 500);
    } catch (error) {
        loadingManager.hideLoading();
        console.error("Error exporting map file:", error);
        alert("Error exporting map. Please try again.");
        throw error;
    }
};
