// TerrainBuilderIntegration.js
// Integration of the chunk system with TerrainBuilder

import * as THREE from "three";
import BlockTextureAtlas from "../blocks/BlockTextureAtlas";
import BlockMaterial from "../blocks/BlockMaterial";
import BlockTypeRegistry from "../blocks/BlockTypeRegistry";
import ChunkSystem from "./ChunkSystem";
import { CHUNK_SIZE } from "./ChunkConstants";

/**
 * Integrates the chunk system with TerrainBuilder
 *
 * Usage in TerrainBuilder:
 *
 * 1. Import this file:
 *    import { initChunkSystem, updateTerrainChunks, updateTerrainBlocks, processChunkRenderQueue } from './chunks/TerrainBuilderIntegration';
 *
 * 2. Initialize the chunk system in the TerrainBuilder component:
 *    useEffect(() => {
 *      const scene = sceneRef.current;
 *      if (scene) {
 *        initChunkSystem(scene, { viewDistance: getViewDistance() });
 *      }
 *    }, [sceneRef.current]);
 *
 * 3. Update the chunk system when terrain changes:
 *    updateTerrainChunks(terrainRef.current);
 *
 * 4. Update the chunk system when blocks are added or removed:
 *    updateTerrainBlocks(addedBlocks, removedBlocks);
 *
 * 5. Process the render queue in the animation loop:
 *    const animate = () => {
 *      processChunkRenderQueue();
 *      // ... other animation code
 *    };
 */

// The chunk system instance
let chunkSystem = null;

/**
 * Initialize the chunk system
 * @param {Object} scene - The THREE.js scene
 * @param {Object} options - Options for the chunk system
 * @returns {Promise<ChunkSystem>} The chunk system
 */
export const initChunkSystem = async (scene, options = {}) => {
    if (!chunkSystem) {
        // Create the chunk system
        chunkSystem = new ChunkSystem(scene, options);

        // Initialize the system
        await chunkSystem.initialize();

        // Rebuild the texture atlas to ensure all textures are properly loaded
        // This is crucial for fixing texture loading issues, especially on page reload
        await rebuildTextureAtlas();

        // Set up multiple texture verification checks at different intervals
        // This helps catch textures that might load at different times
        const verifyTextures = async (attempt = 1) => {
            console.log(`Texture verification check #${attempt}`);
            const textureAtlas = BlockTextureAtlas.instance.textureAtlas;

            if (!textureAtlas || !textureAtlas.image) {
                console.warn(
                    "Texture atlas not properly loaded, rebuilding..."
                );
                await rebuildTextureAtlas();
            } else {
                // Refresh chunk materials to apply the texture atlas
                refreshChunkMaterials();
                // Process the render queue to update visuals
                processChunkRenderQueue();
            }

            // Schedule next check if we haven't reached the maximum attempts
            if (attempt < 3) {
                setTimeout(() => verifyTextures(attempt + 1), 2000 * attempt);
            }
        };

        // Start the verification process
        setTimeout(() => verifyTextures(), 1000);

        // Log initialization
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

    // Update the camera position in the chunk system
    if (chunkSystem._scene.camera) {
        chunkSystem.updateCamera(chunkSystem._scene.camera);
    } else {
        console.warn(
            "No camera set in chunk system for render queue processing"
        );
    }

    // Process the render queue with priority for chunks closer to camera
    chunkSystem.processRenderQueue(true);
};

/**
 * Update the chunk system from terrain data
 * @param {Object} terrainData - The terrain data in format { "x,y,z": blockId }
 * @param {boolean} onlyVisibleChunks - If true, only create meshes for chunks within view distance
 * @returns {Object} Statistics about loaded blocks
 */
export const updateTerrainChunks = (terrainData, onlyVisibleChunks = false) => {
    if (!chunkSystem) {
        console.error(
            "Chunk system not initialized, can't update terrain chunks"
        );
        return { totalBlocks: 0, visibleBlocks: 0 };
    }

    console.log(
        `Loading terrain data with ${Object.keys(terrainData).length} blocks (defer: ${onlyVisibleChunks})`
    );

    // Enable bulk loading mode during the initial load to prevent lag
    if (onlyVisibleChunks && chunkSystem._scene.camera) {
        const viewDistance = chunkSystem._viewDistance || 96; // Default 6 chunks
        const priorityDistance = viewDistance * 0.5;

        console.log(
            `Setting bulk loading mode temporarily during initial load with priority distance ${priorityDistance}`
        );
        chunkSystem.setBulkLoadingMode(true, priorityDistance);
    } else {
        // Ensure bulk loading is disabled if we're not doing optimized loading
        chunkSystem.setBulkLoadingMode(false);
    }

    // Load all blocks at once
    chunkSystem.updateFromTerrainData(terrainData);

    // Update the spatial hash grid for raycasting - but only once
    // Use a static flag to prevent multiple updates
    if (!updateTerrainChunks.spatialHashUpdating) {
        updateTerrainChunks.spatialHashUpdating = true;

        try {
            // Import the SpatialGridManager dynamically to avoid circular dependencies
            import("../managers/SpatialGridManager")
                .then(({ SpatialGridManager }) => {
                    const spatialGridManager = new SpatialGridManager();
                    console.log("Updating spatial hash grid from terrain data");

                    // Force update from terrain data with loading screen
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

    // Process the render queue for chunks near the camera first
    setTimeout(() => {
        if (chunkSystem) {
            console.log("Processing chunk render queue for nearby chunks...");
            chunkSystem._chunkManager.processRenderQueue(true);

            // Schedule disabling bulk loading mode after a brief delay
            // to finish loading all chunks
            setTimeout(() => {
                console.log("Loading complete, disabling bulk loading mode");
                chunkSystem.setBulkLoadingMode(false);

                // Process any remaining chunks
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
    //console.log(`TerrainBuilderIntegration.updateTerrainBlocks: Processing ${Object.keys(addedBlocks).length} added blocks and ${Object.keys(removedBlocks).length} removed blocks`);

    // DEBUGGING: Check if we're adding blocks to empty space
    if (Object.keys(addedBlocks).length > 0) {
        const firstBlockKey = Object.keys(addedBlocks)[0];
        const [x, y, z] = firstBlockKey.split(",").map(Number);
        //console.log(`DEBUG: Adding block at position ${firstBlockKey}, chunk key: ${chunkKey}`);
        //console.log(`DEBUG: Chunk system initialized: ${chunkSystem._initialized}`);
        //console.log(`DEBUG: Chunk exists: ${chunkSystem._chunkManager._chunks.has(chunkKey)}`);
    }

    // Convert added blocks to the format expected by ChunkSystem
    //console.time('TerrainBuilderIntegration.updateTerrainBlocks-conversion');
    const addedBlocksArray = Object.entries(addedBlocks).map(
        ([posKey, blockId]) => {
            const [x, y, z] = posKey.split(",").map(Number);
            return {
                id: blockId,
                position: [x, y, z],
            };
        }
    );

    // Mark newly added block types as essential and preload their textures
    if (addedBlocksArray.length > 0) {
        // Create a set of block IDs to avoid duplicates
        const blockIdsToPreload = new Set();

        // Collect all block IDs added
        addedBlocksArray.forEach((block) => {
            blockIdsToPreload.add(parseInt(block.id));
        });

        // Preload textures for these block types if they're not already loaded
        if (
            blockIdsToPreload.size > 0 &&
            typeof BlockTypeRegistry !== "undefined"
        ) {
            // Try to load asynchronously without blocking the update
            setTimeout(async () => {
                try {
                    // Instead of preloading ALL textures, only preload the ones for new block types
                    // that aren't already loaded

                    // Store block types that actually need preloading
                    const newBlockTypesToPreload = [];

                    // Check each block type
                    blockIdsToPreload.forEach((id) => {
                        if (!BlockTypeRegistry.instance) return;

                        // Get the block type
                        const blockType =
                            BlockTypeRegistry.instance.getBlockType(id);
                        if (!blockType) return;

                        // Mark as essential
                        BlockTypeRegistry.instance.markBlockTypeAsEssential(id);

                        // Check if this block type's textures are already loaded
                        // We'll use a simple check to see if we need to preload
                        const needsPreload =
                            blockType.needsTexturePreload?.() ?? false;

                        if (needsPreload) {
                            newBlockTypesToPreload.push(blockType);
                        }
                    });

                    // Only preload textures for block types that need it
                    if (newBlockTypesToPreload.length > 0) {
                        console.log(
                            `Preloading textures for ${newBlockTypesToPreload.length} newly added block types...`
                        );

                        // Preload each block type individually instead of calling preload() for all blocks
                        for (const blockType of newBlockTypesToPreload) {
                            await blockType.preloadTextures();
                        }

                        // Refresh chunk materials to ensure textures are applied
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

    // Convert removed blocks to the format expected by ChunkSystem
    const removedBlocksArray = Object.entries(removedBlocks).map(
        ([posKey, blockId]) => {
            const [x, y, z] = posKey.split(",").map(Number);
            return {
                id: blockId,
                position: [x, y, z],
            };
        }
    );
    //console.timeEnd('TerrainBuilderIntegration.updateTerrainBlocks-conversion');

    // Update the chunk system
    //console.time('TerrainBuilderIntegration.updateTerrainBlocks-chunkSystemUpdate');
    chunkSystem.updateBlocks(addedBlocksArray, removedBlocksArray);
    //console.timeEnd('TerrainBuilderIntegration.updateTerrainBlocks-chunkSystemUpdate');

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

    // Convert position object to array if needed
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

    // Convert position object to array if needed
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

        // Force texture atlas rebuild to ensure clean state
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
        // Get the current texture atlas
        const textureAtlas = BlockTextureAtlas.instance.textureAtlas;

        // Update the materials with the current texture atlas
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

    try {
        // Step 1: Rebuild the texture atlas
        await BlockTextureAtlas.instance.rebuildTextureAtlas();

        // Step 2: Reload textures for ALL block types (now they're all essential)
        await BlockTypeRegistry.instance.preload();

        // Step 3: Update materials with the new texture atlas
        const textureAtlas = BlockTextureAtlas.instance.textureAtlas;
        BlockMaterial.instance.setTextureAtlas(textureAtlas);

        // Step 4: Force an update of chunk visibility to refresh rendering
        if (chunkSystem) {
            console.log("Forcing chunk visibility update to apply textures");
            chunkSystem.forceUpdateChunkVisibility();

            // Force a quick render queue update to apply new textures
            processChunkRenderQueue();
        }

        // Step 5: Set up multiple retries for any textures that might still be missing
        // This uses a more aggressive approach with multiple attempts
        const maxRetries = 3;
        const retryDelay = 500;

        const retryMissingTextures = async (attempt = 1) => {
            // Only retry if we still have missing texture warnings
            if (
                BlockTextureAtlas.instance._missingTextureWarnings &&
                BlockTextureAtlas.instance._missingTextureWarnings.size > 0
            ) {
                console.log(
                    `Retry #${attempt}: Loading ${BlockTextureAtlas.instance._missingTextureWarnings.size} missing textures`
                );

                // Try to load any missing textures
                const missingTextures = Array.from(
                    BlockTextureAtlas.instance._missingTextureWarnings
                );
                await Promise.allSettled(
                    missingTextures.map((uri) =>
                        BlockTextureAtlas.instance.loadTexture(uri)
                    )
                );

                // Update materials again
                BlockMaterial.instance.setTextureAtlas(
                    BlockTextureAtlas.instance.textureAtlas
                );

                // Force render update again
                if (chunkSystem) {
                    processChunkRenderQueue();
                }

                // Schedule next retry if we haven't reached max attempts
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

        // Start the retry process
        setTimeout(() => retryMissingTextures(), retryDelay);

        console.log("Texture atlas rebuild completed successfully");
        return true;
    } catch (error) {
        console.error("Error during texture atlas rebuild:", error);
        return false;
    }
};
