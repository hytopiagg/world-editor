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
        // Default no emission. Users can later set lightLevel per block id via registry APIs.
        lightLevel: undefined,
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
        // Allocate custom block IDs in 1000-1999 range
        const highestId = blockTypesArray
            .filter((b) => b.id >= 1000 && b.id < 2000)
            .reduce((max, b) => Math.max(max, b.id), 999);
        block.id = Math.max(1000, highestId + 1);
    }

    const processedBlock = {
        ...block, // Keep incoming properties like isMultiTexture, sideTextures
        id: parseInt(block.id), // Use the potentially generated ID
        name: block.name || `Custom Block ${block.id}`,
        textureUri: finalTextureUri, // Use the determined URI (data, placeholder, or error)
        sideTextures: block.sideTextures || {},
        lightLevel:
            typeof block.lightLevel === "number"
                ? block.lightLevel
                : block.lightLevel === 0
                ? 0
                : undefined,

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

    // Always ensure the block is registered in the BlockTypeRegistry so meshes can resolve its textures
    try {
        if (window.BlockTypeRegistry && window.BlockTypeRegistry.instance) {
            const registry = window.BlockTypeRegistry.instance;

            if (processedBlock.isMultiTexture && processedBlock.sideTextures) {
                // Multi-texture path: update with face textures (works for data URIs or paths)
                registry.updateBlockType(processedBlock);
                try {
                    window.dispatchEvent(
                        new CustomEvent("custom-block-registered", {
                            detail: {
                                blockId: processedBlock.id,
                                name: processedBlock.name,
                                isMultiTexture: true,
                            },
                        })
                    );
                } catch (_) {}
            } else if (finalTextureUri) {
                if (finalTextureUri.startsWith("data:image/")) {
                    // Data URI path: use register API which loads and binds atlas
                    if (registry.registerCustomTextureForBlockId) {
                        registry.registerCustomTextureForBlockId(
                            processedBlock.id,
                            finalTextureUri,
                            {
                                name: processedBlock.name,
                                updateMeshes: true,
                                rebuildAtlas: !deferAtlasRebuild,
                            }
                        );
                    }
                } else {
                    // Asset path: directly update block type so the registry references the path
                    registry.updateBlockType({
                        id: processedBlock.id,
                        name: processedBlock.name,
                        textureUri: finalTextureUri,
                        lightLevel: processedBlock.lightLevel,
                    });
                }
            }
        }

        // Push lightLevel again to be safe (covers both branches)
        if (typeof processedBlock.lightLevel !== "undefined") {
            try {
                const reg = window.BlockTypeRegistry?.instance;
                if (reg && reg.updateBlockType) {
                    reg.updateBlockType({
                        id: processedBlock.id,
                        lightLevel: processedBlock.lightLevel,
                    });
                }
            } catch (e) {}
        }
    } catch (error) {
        console.error(
            `Error during BlockTypeRegistry registration for block ID ${processedBlock.id}:`,
            error
        );
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
 * Create a light variant of an existing block type.
 * Clones textures and metadata, assigns a new custom ID (1000-1999), and sets lightLevel.
 * @param {number} baseBlockId - The source block id to clone from
 * @param {number} lightLevel - Emissive level 0..15
 * @param {Object} [options]
 * @param {string} [options.name] - Optional name override
 * @returns {Promise<Object|null>} The created block type or null on error
 */
const createLightVariant = async (baseBlockId, lightLevel, options = {}) => {
    try {
        const base = getBlockById(baseBlockId);
        if (!base) {
            console.warn(
                "createLightVariant: base block not found",
                baseBlockId
            );
            return null;
        }
        const clamped = Math.max(0, Math.min(15, Number(lightLevel) || 0));
        // If base is already a variant, normalize to original base id/name
        const trueBaseId =
            typeof base.variantOfId === "number" ? base.variantOfId : base.id;
        const trueBaseName = base.variantOfName || base.name;
        const name = trueBaseName;

        const newBlock = {
            // no id -> processCustomBlock will allocate in 1000-1999
            name,
            isCustom: true,
            isMultiTexture: !!(
                base.sideTextures && Object.keys(base.sideTextures).length > 0
            ),
            sideTextures: base.sideTextures ? { ...base.sideTextures } : {},
            textureUri: base.textureUri,
            lightLevel: clamped,
            isVariant: true,
            variantOfId: trueBaseId,
            variantOfName: trueBaseName,
            variantLightLevel: clamped,
        };

        // Create/Update in registry and local list
        processCustomBlock(newBlock);

        const created =
            (getCustomBlocks() || [])
                .filter(
                    (b) =>
                        b.isVariant &&
                        b.variantOfId === trueBaseId &&
                        b.variantLightLevel === clamped
                )
                .sort((a, b) => b.id - a.id)[0] || null;

        // Persist to DB
        try {
            const updated = getCustomBlocks();
            const { DatabaseManager, STORES } = require("./DatabaseManager");
            await DatabaseManager.saveData(
                STORES.CUSTOM_BLOCKS,
                "blocks",
                updated
            );
        } catch (e) {
            console.warn("createLightVariant: failed to persist to DB", e);
        }

        // Notify UI to refresh
        try {
            const evt = new CustomEvent("custom-blocks-updated", {
                detail: { block: created },
            });
            window.dispatchEvent(evt);
        } catch (_) {}

        return created || null;
    } catch (e) {
        console.error("createLightVariant error", e);
        return null;
    }
};
/**
 * Remove a custom block by ID
 * @param {number} blockIdToRemove - The ID of the block to remove
 * @returns {Array} - The updated block types array
 */
const removeCustomBlock = (blockIdToRemove) => {
    const id = parseInt(blockIdToRemove);

    if (id < 1000) {
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
    return blockTypesArray.filter((block) => block.id >= 1000);
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
    return parseInt(id) >= 1000;
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

    if (id < 1000) {
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
    createLightVariant,
};

if (typeof window !== "undefined") {
    window.placeCustomBlock = placeCustomBlock;
    window.batchProcessCustomBlocks = batchProcessCustomBlocks;
    window.createLightVariant = createLightVariant;
}
