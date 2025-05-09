import * as THREE from "three";
import BlockTextureAtlas from "../blocks/BlockTextureAtlas";
import BlockMaterial from "../blocks/BlockMaterial";
import BlockTypeRegistry from "../blocks/BlockTypeRegistry";
import ChunkSystem from "./ChunkSystem";
import { CHUNK_SIZE } from "./ChunkConstants";

let chunkSystem = null;
/**
 * Initialize the chunk system
 * @param {Object} scene - The THREE.js scene
 * @param {Object} options - Options for the chunk system
 * @returns {Promise<ChunkSystem>} The chunk system
 */
export const initChunkSystem = async (scene, options = {}) => {
    if (!chunkSystem) {
        chunkSystem = new ChunkSystem(scene, options);

        await chunkSystem.initialize();

        await rebuildTextureAtlas();

        const verifyTextures = async (attempt = 1) => {
            console.log(`Texture verification check #${attempt}`);
            const textureAtlas = BlockTextureAtlas.instance.textureAtlas;
            if (!textureAtlas || !textureAtlas.image) {
                console.warn(
                    "Texture atlas not properly loaded, rebuilding..."
                );
                await rebuildTextureAtlas();
            } else {
                refreshChunkMaterials();

                processChunkRenderQueue();
            }

            if (attempt < 3) {
                setTimeout(() => verifyTextures(attempt + 1), 2000 * attempt);
            }
        };

        setTimeout(() => verifyTextures(), 1000);

        console.log("Chunk system initialized with options:", options);
    }
    return chunkSystem;
};
/**
 * Get the chunk system instance
 * @returns {ChunkSystem|null} The chunk system
 */
export const getChunkSystem = () => {
    return chunkSystem;
};
/**
 * Update the camera in the chunk system
 * This is necessary for view distance culling calculations
 * @param {Object} camera - The THREE.js camera
 */
export const updateChunkSystemCamera = (camera) => {
    if (chunkSystem && chunkSystem._scene) {
        chunkSystem._scene.camera = camera;
    }
};
/**
 * Process chunk render queue
 * Priority is given to chunks closer to the camera
 */
export const processChunkRenderQueue = () => {
    if (!chunkSystem) {
        console.error(
            "Chunk system not initialized, can't process render queue"
        );
        return;
    }

    chunkSystem.updateCamera();
    chunkSystem.processRenderQueue(true);
};
/**
 * Update the chunk system from terrain data
 * @param {Object} terrainData - The terrain data in format { "x,y,z": blockId }
 * @param {boolean} onlyVisibleChunks - If true, only create meshes for chunks within view distance
 * @returns {Object} Statistics about loaded blocks
 */
export const updateTerrainChunks = (
    terrainData,
    onlyVisibleChunks = false,
    environmentBuilderRef = null
) => {
    if (!chunkSystem) {
        console.error(
            "Chunk system not initialized, can't update terrain chunks"
        );
        return { totalBlocks: 0, visibleBlocks: 0 };
    }
    if (onlyVisibleChunks && chunkSystem._scene.camera) {
        const viewDistance = chunkSystem._viewDistance || 96; // Default 6 chunks
        const priorityDistance = viewDistance * 0.5;
        chunkSystem.setBulkLoadingMode(true, priorityDistance);
    } else {
        chunkSystem.setBulkLoadingMode(false);
    }

    chunkSystem.updateFromTerrainData(terrainData);

    if (!updateTerrainChunks.spatialHashUpdating) {
        updateTerrainChunks.spatialHashUpdating = true;
        try {
            import("../managers/SpatialGridManager")
                .then(({ SpatialGridManager }) => {
                    const spatialGridManager = new SpatialGridManager();
                    console.log(
                        "Updating spatial hash grid from terrain data",
                        terrainData
                    );

                    spatialGridManager
                        .updateFromTerrain(terrainData, {
                            force: true,
                            showLoadingScreen: false,
                            message: "Building spatial index for raycasting...",
                        })
                        .then(() => {
                            console.log(
                                "Spatial hash grid updated successfully with worker"
                            );
                            if (environmentBuilderRef.current) {
                                environmentBuilderRef.current.forceRebuildSpatialHash();
                            }
                            updateTerrainChunks.spatialHashUpdating = false;
                        })
                        .catch((error) => {
                            console.error(
                                "Error updating spatial hash grid:",
                                error
                            );
                            updateTerrainChunks.spatialHashUpdating = false;
                        });
                })
                .catch((error) => {
                    console.error(
                        "Failed to import SpatialGridManager:",
                        error
                    );
                    updateTerrainChunks.spatialHashUpdating = false;
                });
        } catch (error) {
            console.error("Error updating spatial hash grid:", error);
            updateTerrainChunks.spatialHashUpdating = false;
        }
    } else {
        console.log(
            "Spatial hash grid update already in progress, skipping duplicate update"
        );
    }

    setTimeout(() => {
        if (chunkSystem) {
            console.log("Processing chunk render queue for nearby chunks...");
            chunkSystem._chunkManager.processRenderQueue(true);

            setTimeout(() => {
                console.log("Loading complete, disabling bulk loading mode");
                chunkSystem.setBulkLoadingMode(false);

                chunkSystem._chunkManager.processRenderQueue(true);
            }, 2000);
        }
    }, 100);
    return {
        totalBlocks: Object.keys(terrainData).length,
        visibleBlocks: Object.keys(terrainData).length,
    };
};
/**
 * Update terrain blocks in the chunk system
 * @param {Object} addedBlocks - The blocks that were added
 * @param {Object} removedBlocks - The blocks that were removed
 */
export const updateTerrainBlocks = (addedBlocks = {}, removedBlocks = {}) => {
    if (!chunkSystem) {
        console.warn(
            "Chunk system not initialized, skipping updateTerrainBlocks"
        );
        return;
    }
    if (!chunkSystem._initialized) {
        console.warn(
            "Chunk system not fully initialized, skipping updateTerrainBlocks"
        );
        return;
    }
    console.time("TerrainBuilderIntegration.updateTerrainBlocks");

    if (Object.keys(addedBlocks).length > 0) {
        const firstBlockKey = Object.keys(addedBlocks)[0];
        const [x, y, z] = firstBlockKey.split(",").map(Number);
    }

    const addedBlocksArray = Object.entries(addedBlocks).map(
        ([posKey, blockId]) => {
            const [x, y, z] = posKey.split(",").map(Number);
            return {
                id: blockId,
                position: [x, y, z],
            };
        }
    );

    if (addedBlocksArray.length > 0) {
        const blockIdsToPreload = new Set();

        addedBlocksArray.forEach((block) => {
            blockIdsToPreload.add(parseInt(block.id));
        });

        if (
            blockIdsToPreload.size > 0 &&
            typeof BlockTypeRegistry !== "undefined"
        ) {
            setTimeout(async () => {
                try {
                    const newBlockTypesToPreload = [];

                    blockIdsToPreload.forEach((id) => {
                        if (!BlockTypeRegistry.instance) return;

                        const blockType =
                            BlockTypeRegistry.instance.getBlockType(id);
                        if (!blockType) return;

                        BlockTypeRegistry.instance.markBlockTypeAsEssential(id);

                        const needsPreload =
                            blockType.needsTexturePreload?.() ?? false;
                        if (needsPreload) {
                            newBlockTypesToPreload.push(blockType);
                        }
                    });

                    if (newBlockTypesToPreload.length > 0) {
                        console.log(
                            `Preloading textures for ${newBlockTypesToPreload.length} newly added block types...`
                        );

                        for (const blockType of newBlockTypesToPreload) {
                            await blockType.preloadTextures();
                        }

                        refreshChunkMaterials();
                    }
                } catch (error) {
                    console.error(
                        "Error preloading textures for new blocks:",
                        error
                    );
                }
            }, 10);
        }
    }

    const removedBlocksArray = Object.entries(removedBlocks).map(
        ([posKey, blockId]) => {
            const [x, y, z] = posKey.split(",").map(Number);
            return {
                id: blockId,
                position: [x, y, z],
            };
        }
    );

    chunkSystem.updateBlocks(addedBlocksArray, removedBlocksArray);

    console.timeEnd("TerrainBuilderIntegration.updateTerrainBlocks");
};
/**
 * Set the view distance
 * @param {number} distance - The view distance
 */
export const setChunkViewDistance = (distance) => {
    if (chunkSystem) {
        chunkSystem.setViewDistance(distance);
    }
};
/**
 * Enable or disable view distance culling
 * @param {boolean} enabled - Whether view distance culling is enabled
 */
export const setChunkViewDistanceEnabled = (enabled) => {
    if (chunkSystem) {
        chunkSystem.setViewDistanceEnabled(enabled);
    }
};
/**
 * Get the block ID at a position
 * @param {Array|Object} position - The position [x, y, z] or {x, y, z}
 * @returns {number} The block ID
 */
export const getBlockId = (position) => {
    if (!chunkSystem) return 0;

    const pos = Array.isArray(position)
        ? position
        : [position.x, position.y, position.z];
    return chunkSystem.getBlockId(pos);
};
/**
 * Check if a block exists at a position
 * @param {Array|Object} position - The position [x, y, z] or {x, y, z}
 * @returns {boolean} True if a block exists
 */
export const hasBlock = (position) => {
    if (!chunkSystem) return false;

    const pos = Array.isArray(position)
        ? position
        : [position.x, position.y, position.z];
    return chunkSystem.hasBlock(pos);
};
/**
 * Clear all chunks from the chunk system
 */
export const clearChunks = () => {
    if (!chunkSystem) {
        console.warn("Cannot clear chunks: Chunk system not initialized");
        return;
    }
    try {
        console.time("clearChunks");
        console.log("Clearing all chunks from chunk system");
        chunkSystem.clearChunks();

        setTimeout(() => {
            try {
                rebuildTextureAtlas();
                refreshChunkMaterials();
            } catch (error) {
                console.error(
                    "Error rebuilding texture atlas after clearing chunks:",
                    error
                );
            }
        }, 100);
        console.timeEnd("clearChunks");
    } catch (error) {
        console.error("Error clearing chunks:", error);
    }
};
/**
 * Check if a chunk is visible
 * @param {string} chunkKey - The chunk key in format "x,y,z"
 * @returns {boolean} True if the chunk is visible
 */
export const isChunkVisible = (chunkKey) => {
    if (!chunkSystem) return false;
    const chunk = chunkSystem._chunkManager._chunks.get(chunkKey);
    return chunk ? chunk.visible : false;
};
/**
 * Get the chunk key for a position
 * @param {number} x - The x coordinate
 * @param {number} y - The y coordinate
 * @param {number} z - The z coordinate
 * @returns {string} The chunk key
 */
export const getChunkKey = (x, y, z) => {
    const cx = Math.floor(x / CHUNK_SIZE) * CHUNK_SIZE;
    const cy = Math.floor(y / CHUNK_SIZE) * CHUNK_SIZE;
    const cz = Math.floor(z / CHUNK_SIZE) * CHUNK_SIZE;
    return `${cx},${cy},${cz}`;
};
/**
 * Force update all chunk visibility based on current camera position
 * This bypasses normal render queue processing and forces an immediate update
 * @returns {Object|null} Statistics about the update or null if failed
 */
export const forceUpdateChunkVisibility = () => {
    if (!chunkSystem) {
        console.error(
            "Chunk system not available for forced visibility update"
        );
        return null;
    }
    return chunkSystem.forceUpdateChunkVisibility();
};
/**
 * Force refresh of chunk materials with current texture atlas
 * This can be called when textures have been updated
 * @returns {boolean} True if materials were refreshed
 */
export const refreshChunkMaterials = () => {
    if (!chunkSystem) {
        console.error("Chunk system not available for refreshing materials");
        return false;
    }
    try {
        const textureAtlas = BlockTextureAtlas.instance.textureAtlas;

        BlockMaterial.instance.setTextureAtlas(textureAtlas);
        console.log("Chunk materials refreshed with current texture atlas");
        return true;
    } catch (error) {
        console.error("Error refreshing chunk materials:", error);
        return false;
    }
};
/**
 * Rebuild the texture atlas completely and reload all textures
 * Call this when textures are missing or when the page reloads
 * @returns {Promise<boolean>} True if the rebuild was successful
 */
export const rebuildTextureAtlas = async () => {
    console.log("Rebuilding texture atlas and refreshing all materials...");

    THREE.Texture.DEFAULT_FILTER = THREE.NearestFilter;
    try {
        const atlasTexture =
            await BlockTextureAtlas.instance.rebuildTextureAtlas();

        await BlockTypeRegistry.instance.preload();

        const textureAtlas = BlockTextureAtlas.instance.textureAtlas;

        if (textureAtlas) {
            textureAtlas.minFilter = THREE.NearestFilter;
            textureAtlas.magFilter = THREE.NearestFilter;
            textureAtlas.needsUpdate = true;
        }
        BlockMaterial.instance.setTextureAtlas(textureAtlas);

        if (chunkSystem) {
            console.log("Forcing chunk visibility update to apply textures");
            chunkSystem.forceUpdateChunkVisibility();

            processChunkRenderQueue();
        }

        const maxRetries = 3;
        const retryDelay = 500;
        const retryMissingTextures = async (attempt = 1) => {
            if (
                BlockTextureAtlas.instance._missingTextureWarnings &&
                BlockTextureAtlas.instance._missingTextureWarnings.size > 0
            ) {
                console.log(
                    `Retry #${attempt}: Loading ${BlockTextureAtlas.instance._missingTextureWarnings.size} missing textures`
                );

                const missingTextures = Array.from(
                    BlockTextureAtlas.instance._missingTextureWarnings
                );
                await Promise.allSettled(
                    missingTextures.map((uri) =>
                        BlockTextureAtlas.instance.loadTexture(uri)
                    )
                );

                BlockMaterial.instance.setTextureAtlas(
                    BlockTextureAtlas.instance.textureAtlas
                );

                if (chunkSystem) {
                    processChunkRenderQueue();
                }

                if (attempt < maxRetries) {
                    setTimeout(
                        () => retryMissingTextures(attempt + 1),
                        retryDelay
                    );
                } else {
                    console.log("Completed all texture loading retries");
                }
            } else {
                console.log("No missing textures detected, skipping retry");
            }
        };

        setTimeout(() => retryMissingTextures(), retryDelay);
        console.log("Texture atlas rebuild completed successfully");
        return true;
    } catch (error) {
        console.error("Error during texture atlas rebuild:", error);
        return false;
    }
};
