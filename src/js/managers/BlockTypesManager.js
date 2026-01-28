/**
 * BlockTypesManager
 * Manages block types, custom blocks, and block operations for the terrain builder
 */

// Load block manifest for stable ID assignments
let blockManifest = {};
try {
    // Try to load the manifest file
    blockManifest = require("../blocks/block-manifest.json");
} catch (error) {
    console.warn(
        "Block manifest not found. Block IDs may shift when new blocks are added.",
        error
    );
}

let blockTypesArray = (() => {
    const textureContext = require.context(
        "../../../public/assets/blocks",
        true,
        /\.(png|jpe?g)$/
    );
    const texturePaths = textureContext.keys();
    const blockMap = new Map();
    
    // Find the highest ID in the manifest to assign new blocks IDs starting from there
    const manifestIds = Object.values(blockManifest);
    const maxManifestId = manifestIds.length > 0 ? Math.max(...manifestIds) : 0;
    let nextNewBlockId = maxManifestId + 1;
    
    // Track new blocks that aren't in the manifest
    const newBlocks = [];
    
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
                // Use manifest ID if available, otherwise assign a new ID
                let blockId;
                if (blockManifest[blockName]) {
                    blockId = blockManifest[blockName];
                } else {
                    blockId = nextNewBlockId++;
                    newBlocks.push(blockName);
                    console.warn(
                        `Block "${blockName}" not found in manifest. Assigned ID ${blockId}. ` +
                        `Please add it to block-manifest.json to ensure stable IDs.`
                    );
                }
                
                blockMap.set(blockName, {
                    id: blockId,
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
    
    // Log warning if new blocks were discovered
    if (newBlocks.length > 0) {
        console.warn(
            `Found ${newBlocks.length} new block(s) not in manifest: ${newBlocks.join(", ")}. ` +
            `These blocks have been assigned IDs starting from ${maxManifestId + 1}. ` +
            `To ensure stable IDs, add these blocks to src/js/blocks/block-manifest.json`
        );
    }
    
    return Array.from(blockMap.values()).map((block) => {
        // Set water and lava blocks as liquid by default
        const isLiquid = block.name.toLowerCase() === 'water' || block.name.toLowerCase() === 'lava';
        
        return {
            ...block,
            isMultiTexture: Object.keys(block.sideTextures).length > 0,
            isEnvironment: false,
            hasMissingTexture: block.textureUri === "./assets/blocks/error.png",
            // Default no emission. Users can later set lightLevel per block id via registry APIs.
            lightLevel: undefined,
            isLiquid: isLiquid,
        };
    });
})();
/**
 * Add or update a custom block
 * @param {Object} block - The block to add or update
 * @param {boolean} deferAtlasRebuild - Whether to defer atlas rebuilding (useful for batch operations)
 * @returns {Array} - The updated block types array
 */
const processCustomBlock = async (block, deferAtlasRebuild = false) => {
    const blockId = parseInt(block.id);
    const ERROR_TEXTURE_PATH = "./assets/blocks/error.png";

    const existingIndex = blockTypesArray.findIndex((b) => b.id === blockId);
    const existingBlock =
        existingIndex >= 0 ? blockTypesArray[existingIndex] : null;

    // Do not skip processing here; we need to ensure registry and atlas stay in sync

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
        isLiquid: block.isLiquid === true, // Store isLiquid flag
        shapeType: block.shapeType || 'cube', // Block shape (cube, half_slab, wedge_45, etc.)

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
    // Use lazy loading (like default textures) instead of eager loading
    try {
        if (window.BlockTypeRegistry && window.BlockTypeRegistry.instance) {
            const registry = window.BlockTypeRegistry.instance;
            const BlockType = require("../blocks/BlockType").default;

            if (processedBlock.isMultiTexture && processedBlock.sideTextures) {
                // Multi-texture path: create BlockType and queue textures for lazy loading
                const textureUris = {};
                const COORD_TO_FACE_MAP = {
                    "+x": "right",
                    "-x": "left",
                    "+y": "top",
                    "-y": "bottom",
                    "+z": "front",
                    "-z": "back",
                };
                Object.entries(processedBlock.sideTextures).forEach(([coord, uri]) => {
                    const face = COORD_TO_FACE_MAP[coord] || coord;
                    textureUris[face] = uri;
                });

                const blockType = new BlockType({
                    id: processedBlock.id,
                    name: processedBlock.name,
                    isLiquid: processedBlock.isLiquid || false,
                    textureUris: textureUris,
                    lightLevel: processedBlock.lightLevel,
                    shapeType: processedBlock.shapeType,
                });

                // Register without loading textures immediately
                await registry.registerBlockType(blockType);

                // Don't queue textures here - they'll be loaded on-demand when chunks need them
                // This prevents FPS drops from loading all textures at once

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
                // Create BlockType with texture URIs (works for both data URIs and asset paths)
                const textureUris = BlockType.textureUriToTextureUris(finalTextureUri);
                
                const blockType = new BlockType({
                    id: processedBlock.id,
                    name: processedBlock.name,
                    isLiquid: processedBlock.isLiquid || false,
                    textureUris: textureUris,
                    lightLevel: processedBlock.lightLevel,
                    shapeType: processedBlock.shapeType,
                });

                // Register without loading textures immediately
                await registry.registerBlockType(blockType);

                // Don't queue textures here - they'll be loaded on-demand when chunks need them
                // This prevents FPS drops from loading all textures at once
            }
            
            // Don't rebuild atlas immediately - let it happen lazily when textures are actually loaded
            // The queue system will handle rebuilding when needed
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

/**
 * Save a property override for a built-in block (ID < 1000)
 * This allows persisting changes like isLiquid for built-in blocks
 * @param {number} blockId - The ID of the built-in block
 * @param {Object} overrides - Object containing properties to override (e.g., { isLiquid: true })
 * @returns {Promise<boolean>} - True if save was successful
 */
const saveBlockOverride = async (blockId, overrides) => {
    const id = parseInt(blockId);
    if (id >= 1000) {
        // Custom blocks are handled by CUSTOM_BLOCKS store, not overrides
        console.warn("saveBlockOverride: Use processCustomBlock for custom blocks (ID >= 1000)");
        return false;
    }
    
    try {
        const { DatabaseManager, STORES } = require("./DatabaseManager");
        
        // Load existing overrides
        let allOverrides = await DatabaseManager.getData(STORES.BLOCK_OVERRIDES, "builtin-overrides") || {};
        
        // Merge new overrides for this block
        if (!allOverrides[id]) {
            allOverrides[id] = {};
        }
        allOverrides[id] = { ...allOverrides[id], ...overrides };
        
        // Save back to database
        await DatabaseManager.saveData(STORES.BLOCK_OVERRIDES, "builtin-overrides", allOverrides);
        
        return true;
    } catch (e) {
        console.error("saveBlockOverride: failed to persist to DB", e);
        return false;
    }
};

/**
 * Load and apply all saved block overrides for built-in blocks
 * Should be called during initialization after blockTypesArray is populated
 * @returns {Promise<void>}
 */
const loadAndApplyBlockOverrides = async () => {
    try {
        const { DatabaseManager, STORES } = require("./DatabaseManager");
        
        const allOverrides = await DatabaseManager.getData(STORES.BLOCK_OVERRIDES, "builtin-overrides");
        
        if (!allOverrides || typeof allOverrides !== 'object') {
            return;
        }
        
        // Apply overrides to blockTypesArray
        for (const [blockIdStr, overrides] of Object.entries(allOverrides)) {
            const blockId = parseInt(blockIdStr);
            const blockIndex = blockTypesArray.findIndex((b) => b.id === blockId);
            
            if (blockIndex >= 0 && blockId < 1000) {
                // Apply each override property
                Object.entries(overrides).forEach(([key, value]) => {
                    blockTypesArray[blockIndex][key] = value;
                });
                
                // Also update the BlockTypeRegistry if it exists
                try {
                    const reg = window.BlockTypeRegistry?.instance;
                    if (reg && reg.updateBlockType) {
                        reg.updateBlockType({ id: blockId, ...overrides });
                    }
                } catch (e) {
                    // Registry may not be initialized yet, that's okay
                }
            }
        }
        
        console.log(`Applied block overrides for ${Object.keys(allOverrides).length} built-in block(s)`);
    } catch (e) {
        console.error("loadAndApplyBlockOverrides: failed to load from DB", e);
    }
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
    saveBlockOverride,
    loadAndApplyBlockOverrides,
};

if (typeof window !== "undefined") {
    window.placeCustomBlock = placeCustomBlock;
    window.batchProcessCustomBlocks = batchProcessCustomBlocks;
    window.createLightVariant = createLightVariant;
}
