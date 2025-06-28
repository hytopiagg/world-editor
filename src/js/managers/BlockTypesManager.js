/**
 * BlockTypesManager
 * Manages block types, custom blocks, and block operations for the terrain builder
 */

let blockTypesArray = (() => {
    const textureContext = require.context(
        "../../../public/assets/blocks",
        true,
        /\.(png|jpe?g)$/
    );
    const texturePaths = textureContext.keys();
    const blockMap = new Map();
    let idCounter = 1;
    texturePaths.forEach((path) => {
        if (path.includes("environment") || path.includes("error")) {
            return;
        }
        const match = path.match(/^\.\/(.+?)(\/[+-][xyz])?\.png$/);
        if (match) {
            const [, fullName, side] = match;
            const parts = fullName.split("/");
            const blockName =
                parts.length > 1 ? parts[0] : fullName.replace(/\.[^/.]+$/, "");
            if (!blockMap.has(blockName)) {
                blockMap.set(blockName, {
                    id: idCounter++,
                    name: blockName,
                    textureUri: `./assets/blocks/${blockName}.png`,
                    sideTextures: {},
                });
            }
            if (side) {
                const sideKey = side.slice(1);
                blockMap.get(blockName).sideTextures[
                    sideKey
                ] = `./assets/blocks/${blockName}${side}.png`;
            }
        }
    });
    return Array.from(blockMap.values()).map((block) => ({
        ...block,
        isMultiTexture: Object.keys(block.sideTextures).length > 0,
        isEnvironment: false,
        hasMissingTexture: block.textureUri === "./assets/blocks/error.png",
    }));
})();
/**
 * Add or update a custom block
 * @param {Object} block - The block to add or update
 * @param {boolean} deferAtlasRebuild - Whether to defer atlas rebuilding (useful for batch operations)
 * @returns {Array} - The updated block types array
 */
const processCustomBlock = (block, deferAtlasRebuild = false) => {
    const blockId = parseInt(block.id);
    const ERROR_TEXTURE_PATH = "./assets/blocks/error.png";

    const existingIndex = blockTypesArray.findIndex((b) => b.id === blockId);
    const existingBlock =
        existingIndex >= 0 ? blockTypesArray[existingIndex] : null;

    if (
        existingBlock &&
        existingBlock.textureUri &&
        existingBlock.textureUri.startsWith("data:image/")
    ) {
        return blockTypesArray; // Skip processing
    }

    let finalTextureUri = block.textureUri;
    let needsRegistryUpdate = false;

    if (
        finalTextureUri &&
        !finalTextureUri.startsWith("data:image/") &&
        !finalTextureUri.startsWith("./")
    ) {
        const storageKeys = [
            `block-texture-${blockId}`,
            `custom-block-${blockId}`,
            `datauri-${blockId}`,
        ];
        let foundDataUri = null;
        for (const key of storageKeys) {
            const storedUri = localStorage.getItem(key);
            if (storedUri && storedUri.startsWith("data:image/")) {
                foundDataUri = storedUri;
                break;
            }
        }

        if (foundDataUri) {
            finalTextureUri = foundDataUri;
            needsRegistryUpdate = true; // We found the data, need to register it
        } else {
            console.warn(
                `Data URI for custom block ${blockId} (${block.name}) not found in localStorage. Using error texture.`
            );
            finalTextureUri = ERROR_TEXTURE_PATH;

            needsRegistryUpdate = !existingBlock;
        }
    } else if (finalTextureUri && finalTextureUri.startsWith("data:image/")) {
        needsRegistryUpdate = true;
    } else if (!finalTextureUri) {
        console.warn(
            `No texture URI provided for custom block ${blockId} (${block.name}). Using error texture.`
        );
        finalTextureUri = ERROR_TEXTURE_PATH;
        needsRegistryUpdate = !existingBlock;
    }

    if (!block.id && !existingBlock) {
        const highestId = blockTypesArray
            .filter((b) => b.id >= 100)
            .reduce((max, b) => Math.max(max, b.id), 99);
        block.id = highestId + 1;
    }

    const processedBlock = {
        ...block, // Keep incoming properties like isMultiTexture, sideTextures
        id: parseInt(block.id), // Use the potentially generated ID
        name: block.name || `Custom Block ${block.id}`,
        textureUri: finalTextureUri, // Use the determined URI (data, placeholder, or error)
        sideTextures: block.sideTextures || {},

        isMultiTexture:
            block.sideTextures && Object.keys(block.sideTextures).length > 0,
        isCustom: true,
        // For multi-texture blocks, missing texture status depends on sideTextures.
        // For single-texture blocks, it depends on the main textureUri.
        hasMissingTexture: block.isMultiTexture
            ? !block.sideTextures ||
              Object.keys(block.sideTextures).length === 0
            : !finalTextureUri || finalTextureUri === ERROR_TEXTURE_PATH,
    };

    if (existingIndex >= 0) {
        blockTypesArray[existingIndex] = processedBlock;
    } else {
        blockTypesArray.push(processedBlock);
    }

    if (needsRegistryUpdate && finalTextureUri) {
        try {
            if (window.BlockTypeRegistry && window.BlockTypeRegistry.instance) {
                const registry = window.BlockTypeRegistry.instance;
                if (registry.registerCustomTextureForBlockId) {
                    registry
                        .registerCustomTextureForBlockId(
                            processedBlock.id,
                            finalTextureUri, // Use the final URI (could be data or error path)
                            {
                                name: processedBlock.name,
                                updateMeshes: true,
                                rebuildAtlas: !deferAtlasRebuild,
                            }
                        )
                        .then(() => {
                            const event = new CustomEvent(
                                "custom-block-registered",
                                {
                                    detail: {
                                        blockId: processedBlock.id,
                                        name: processedBlock.name,
                                    },
                                }
                            );
                            window.dispatchEvent(event);
                        })
                        .catch((error) => {
                            console.error(
                                `Error registering custom block ${processedBlock.id} in BlockTypeRegistry:`,
                                error
                            );
                        });
                }
            }
        } catch (error) {
            console.error(
                `Error during BlockTypeRegistry registration for block ID ${processedBlock.id}:`,
                error
            );
        }
    }

    return [...blockTypesArray];
};
/**
 * Process multiple custom blocks in batch for better performance
 * @param {Array<Object>} blocks - Array of blocks to process
 * @returns {Array} - The updated block types array
 */
const batchProcessCustomBlocks = async (blocks) => {
    if (!Array.isArray(blocks) || blocks.length === 0) {
        return blockTypesArray;
    }

    const processedBlocks = blocks.map((block) => {
        processCustomBlock(block, true); // defer atlas rebuild
        return {
            blockId: block.id || parseInt(block.id),
            dataUri: block.textureUri,
            name: block.name,
        };
    });

    if (window.batchRegisterCustomTextures) {
        try {
            await window.batchRegisterCustomTextures(
                processedBlocks.map((pb) => ({
                    blockId: pb.blockId,
                    dataUri: pb.dataUri,
                })),
                { updateMeshes: true }
            );
        } catch (error) {
            console.error("Error in batch registering custom textures:", error);
        }
    }
    return [...blockTypesArray];
};
/**
 * Place a custom block in the world
 * @param {number} blockId - The block ID to place
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} z - Z coordinate
 * @returns {Promise<boolean>} - Success status
 */
const placeCustomBlock = async (blockId, x = 0, y = 0, z = 0) => {
    const block = getBlockById(blockId);
    if (!block) {
        console.error(`Block with ID ${blockId} not found`);
        return false;
    }
    try {
        if (window.createBlockAt) {
            return await window.createBlockAt(blockId, x, y, z);
        } else if (
            window.terrainBuilderRef &&
            window.terrainBuilderRef.current
        ) {
            const terrainBuilder = window.terrainBuilderRef.current;
            if (terrainBuilder.fastUpdateBlock) {
                terrainBuilder.fastUpdateBlock({ x, y, z }, blockId);
                return true;
            } else if (terrainBuilder.updateTerrainBlocks) {
                const position = `${x},${y},${z}`;
                const blocks = {};
                blocks[position] = blockId;
                terrainBuilder.updateTerrainBlocks(
                    blocks,
                    {},
                    { source: "custom" }
                );
                return true;
            } else if (terrainBuilder.buildUpdateTerrain) {
                const blockData = {};
                blockData[`${x},${y},${z}`] = blockId;
                terrainBuilder.buildUpdateTerrain({ blocks: blockData });
                return true;
            } else {
                console.error(
                    "No suitable method found on terrainBuilderRef.current to place blocks"
                );
                return false;
            }
        } else {
            console.error(
                "Cannot place block: terrainBuilderRef or createBlockAt not available"
            );
            return false;
        }
    } catch (error) {
        console.error(`Error placing custom block:`, error);
        return false;
    }
};
/**
 * Remove a custom block by ID
 * @param {number} blockIdToRemove - The ID of the block to remove
 * @returns {Array} - The updated block types array
 */
const removeCustomBlock = (blockIdToRemove) => {
    const id = parseInt(blockIdToRemove);

    if (id < 100) {
        console.warn("Cannot remove built-in blocks");
        return blockTypesArray;
    }

    blockTypesArray = blockTypesArray.filter((block) => block.id !== id);

    return [...blockTypesArray];
};
/**
 * Get all block types
 * @returns {Array} - All block types
 */
const getBlockTypes = () => blockTypesArray;
/**
 * Get only custom blocks (ID >= 100)
 * @returns {Array} - Custom blocks
 */
const getCustomBlocks = () => {
    return blockTypesArray.filter((block) => block.id >= 100);
};
/**
 * Search blocks by name or ID
 * @param {string} query - Search query
 * @returns {Array} - Matching blocks
 */
const searchBlocks = (query) => {
    if (!query) return blockTypesArray;
    const lowerQuery = query.toLowerCase();
    const queryNum = parseInt(query);
    return blockTypesArray.filter(
        (block) =>
            block.name.toLowerCase().includes(lowerQuery) ||
            block.id === queryNum
    );
};
/**
 * Get a block by ID
 * @param {number} id - Block ID
 * @returns {Object|undefined} - Block or undefined if not found
 */
const getBlockById = (id) => {
    return blockTypesArray.find((block) => block.id === parseInt(id));
};
/**
 * Check if a block is a custom block
 * @param {number} id - Block ID
 * @returns {boolean} - True if block is custom
 */
const isCustomBlock = (id) => {
    return parseInt(id) >= 100;
};

/**
 * Update the name of a custom block.
 * @param {number} blockId - The ID of the block to update.
 * @param {string} newName - The new name for the block.
 * @returns {Promise<boolean>} - True if the update was successful, false otherwise.
 */
const updateCustomBlockName = async (blockId, newName) => {
    const id = parseInt(blockId);
    const trimmedName = newName.trim();

    if (id < 100) {
        console.warn("Cannot rename built-in blocks.");
        return false;
    }
    if (!trimmedName) {
        console.warn("Block name cannot be empty.");
        return false;
    }

    const blockIndex = blockTypesArray.findIndex((block) => block.id === id);

    if (blockIndex === -1) {
        console.warn(`Block with ID ${id} not found.`);
        return false;
    }

    // Update name in the array
    blockTypesArray[blockIndex].name = trimmedName;

    // Optional: If name affects registry or requires other updates, add logic here.
    // For now, we assume name change doesn't require re-registering textures.

    console.log(
        `Block ID ${id} renamed to "${trimmedName}" in BlockTypesManager.`
    );
    return true; // Indicate success
};

const blockTypes = blockTypesArray;
export {
    blockTypes,
    blockTypesArray,
    processCustomBlock,
    batchProcessCustomBlocks,
    removeCustomBlock,
    updateCustomBlockName,
    getBlockTypes,
    getCustomBlocks,
    searchBlocks,
    getBlockById,
    isCustomBlock,
    placeCustomBlock,
};

if (typeof window !== "undefined") {
    window.placeCustomBlock = placeCustomBlock;
    window.batchProcessCustomBlocks = batchProcessCustomBlocks;
}
