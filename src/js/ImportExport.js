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

        loadingManager.showLoading("Starting import process...", 0);
        const reader = new FileReader();
        return new Promise((resolve, reject) => {
            reader.onload = async (event) => {
                try {
                    loadingManager.updateLoading(
                        "Parsing imported file...",
                        10
                    );

                    const importData = JSON.parse(event.target.result);
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

                        terrainData = Object.entries(importData.blocks).reduce(
                            (acc, [key, blockId]) => {
                                acc[key] = blockId;
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
                                .map(([key, entity], index) => {
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

        loadingManager.showLoading("Preparing to export map...", 0);

        loadingManager.updateLoading("Retrieving environment data...", 10);
        const environmentObjects =
            (await DatabaseManager.getData(STORES.ENVIRONMENT, "current")) ||
            [];

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

        loadingManager.updateLoading("Building export data structure...", 70);
        const exportData = {
            blockTypes: allBlockTypes.map((block) => {

                if ((block.id >= 100 && block.id < 200) || block.isCustom) {

                    const customPath = block.isMultiTexture
                        ? `blocks/custom/${block.name}` // Path for multi-texture (folder)
                        : `blocks/custom/${block.name}.png`; // Path for single texture (PNG file)

                    return {
                        id: block.id,
                        name: block.name,
                        textureUri: customPath,
                        isCustom: true,

                    };
                } else {


                    return {
                        id: block.id,
                        name: block.name,
                        textureUri: block.isMultiTexture
                            ? `blocks/${block.name}`
                            : `blocks/${block.name}.png`,
                        isCustom: false,

                    };
                }
            }),
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

                    const boundingBoxHeight = entityType.boundingBoxHeight || 1;
                    const verticalOffset =
                        (boundingBoxHeight * obj.scale.y) / 2;
                    const adjustedY = obj.position.y + 0.5 + verticalOffset;

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

        loadingManager.updateLoading("Creating export file...", 90);
        const jsonContent = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonContent], { type: "application/json" });

        loadingManager.updateLoading("Preparing download...", 95);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "terrain.json";
        loadingManager.updateLoading("Export complete!", 100);

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
