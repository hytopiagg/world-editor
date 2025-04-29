// BlockTypeRegistry.js
// Registry for block types

import BlockType from "./BlockType";
import { getBlockTypes } from "../managers/BlockTypesManager";
import BlockTextureAtlas from "./BlockTextureAtlas";

/**
 * Registry for block types
 */
class BlockTypeRegistry {
    constructor() {
        this._blockTypes = {};
        this._initialized = false;

        // Expanded list of essential block types to preload - include more common blocks
        // This ensures more textures are loaded immediately on startup
        this._essentialBlockTypes = new Set([
            // Add more common block IDs
        ]);
    }

    /**
     * Get the singleton instance
     * @returns {BlockTypeRegistry} The singleton instance
     */
    static get instance() {
        if (!this._instance) {
            this._instance = new BlockTypeRegistry();

            // Expose to window for API access
            if (typeof window !== "undefined") {
                window.BlockTypeRegistry = BlockTypeRegistry;

                // Expose essential functions for custom texture handling
                window.createCustomBlock = (blockId, dataUri) =>
                    this._instance.createCustomBlock(blockId, dataUri);
                window.generateTextureDataURI = (color) =>
                    this._instance.generateTextureDataURI(color);
                window.createBlockAt = (blockId, x, y, z, color) =>
                    this._instance.createBlockAt(blockId, x, y, z, color);
                window.fixCustomTextures = () =>
                    this._instance.fixCustomTextures();

                // Expose batch texture registration function for more efficient texture loading
                window.batchRegisterCustomTextures = (
                    textureEntries,
                    options
                ) =>
                    this._instance.batchRegisterCustomTextures(
                        textureEntries,
                        options
                    );
            }
        }
        return this._instance;
    }

    /**
     * Initialize the registry with block types from BlockTypesManager
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this._initialized) {
            return;
        }

        console.time("BlockTypeRegistry.initialize");

        // Ensure error texture is loaded first
        try {
            BlockTextureAtlas.instance.markTextureAsEssential(
                "./assets/blocks/error.png"
            );
            await BlockTextureAtlas.instance.loadTexture(
                "./assets/blocks/error.png"
            );
        } catch (error) {
            console.warn("Failed to load error texture:", error);
        }

        const blockTypes = getBlockTypes();

        // First pass: register all block types without loading textures
        for (const blockTypeData of blockTypes) {

            /// disabled liquid rendering
            const isLiquid = false;
                // blockTypeData.name.toLowerCase().includes("water") ||
                // blockTypeData.name.toLowerCase().includes("lava");

            const blockType = new BlockType({
                id: blockTypeData.id,
                isLiquid: blockTypeData.isLiquid || isLiquid,
                name: blockTypeData.name || "Unknown",
                textureUris: blockTypeData.isMultiTexture
                    ? blockTypeData.sideTextures
                    : BlockType.textureUriToTextureUris(
                          blockTypeData.textureUri
                      ),
            });

            this._blockTypes[blockTypeData.id] = blockType;
        }

        this._initialized = true;
        console.log(
            `BlockTypeRegistry initialized with ${Object.keys(this._blockTypes).length} block types`
        );
        console.timeEnd("BlockTypeRegistry.initialize");
    }

    /**
     * Register a block type
     * @param {BlockType} blockType - The block type to register
     * @returns {Promise<void>}
     */
    async registerBlockType(blockType) {
        this._blockTypes[blockType.id] = blockType;
    }

    /**
     * Unregister a block type
     * @param {number} id - The block type ID to unregister
     */
    unregisterBlockType(id) {
        delete this._blockTypes[id];
    }

    /**
     * Get a block type by ID
     * @param {number} id - The block type ID
     * @returns {BlockType|undefined} The block type, or undefined if not found
     */
    getBlockType(id) {
        return this._blockTypes[id];
    }

    /**
     * Update a block type from data
     * @param {Object} blockTypeData - The block type data
     * @returns {Promise<void>}
     */
    async updateBlockType(blockTypeData) {
        const blockType = this._blockTypes[blockTypeData.id];

        if (!blockType) {
            await this.registerBlockType(
                new BlockType({
                    id: blockTypeData.id,
                    isLiquid: blockTypeData.isLiquid || false,
                    name: blockTypeData.name || "Unknown",
                    textureUris: blockTypeData.isMultiTexture
                        ? blockTypeData.sideTextures
                        : BlockType.textureUriToTextureUris(
                              blockTypeData.textureUri
                          ),
                })
            );
        } else {
            if (blockTypeData.name) {
                blockType.setName(blockTypeData.name);
            }

            if (blockTypeData.textureUri || blockTypeData.sideTextures) {
                const textureUris = blockTypeData.isMultiTexture
                    ? blockTypeData.sideTextures
                    : BlockType.textureUriToTextureUris(
                          blockTypeData.textureUri
                      );
                await blockType.setTextureUris(textureUris);
            }
        }
    }

    /**
     * Preload all textures for all block types
     * @returns {Promise<void>}
     */
    async preload() {
        console.time("BlockTypeRegistry.preload");

        // Mark ALL block types as essential to ensure everything loads properly
        Object.values(this._blockTypes).forEach((blockType) => {
            this._essentialBlockTypes.add(blockType.id);
        });

        // Get all block types, but only preload those that actually need it
        const allBlockTypes = Object.values(this._blockTypes);
        const blockTypesToPreload = allBlockTypes.filter(
            (blockType) => blockType.needsTexturePreload?.() ?? true
        );

        if (blockTypesToPreload.length === 0) {
            console.log("No block types need texture preloading, skipping.");
            console.timeEnd("BlockTypeRegistry.preload");
            return;
        }

        console.log(
            `Preloading textures for ${blockTypesToPreload.length} block types...`
        );

        await Promise.all(
            blockTypesToPreload.map((blockType) => blockType.preloadTextures())
        );

        console.timeEnd("BlockTypeRegistry.preload");
    }

    /**
     * Add a block type ID to the essential block types set
     * @param {number} id - The block type ID to mark as essential
     */
    markBlockTypeAsEssential(id) {
        this._essentialBlockTypes.add(id);
    }

    /**
     * Register a custom texture for a specific block ID
     * @param {number} blockId - The block ID to associate with the custom texture
     * @param {string} dataUri - The data URI of the texture
     * @param {Object} [options] - Additional options
     * @param {string} [options.name] - Optional name for the block type (default: "Custom Block {blockId}")
     * @param {boolean} [options.isLiquid] - Whether the block is a liquid (default: false)
     * @param {boolean} [options.updateMeshes] - Whether to update chunk meshes after registering (default: true)
     * @param {boolean} [options.rebuildAtlas] - Whether to rebuild texture atlas (default: false)
     * @returns {Promise<BlockType>} The created or updated BlockType
     */
    async registerCustomTextureForBlockId(blockId, dataUri, options = {}) {
        if (!blockId || blockId <= 0) {
            throw new Error("Invalid block ID. Must be a positive number.");
        }

        if (!dataUri || !dataUri.startsWith("data:image/")) {
            throw new Error("Invalid data URI format for custom texture");
        }

        // Check if this blockId is already registered
        let blockType = this.getBlockType(blockId);

        // Determine if this is a new block being added
        const isNewBlock = !blockType;

        // If not registered, create a new BlockType
        if (isNewBlock) {
            const name = options.name || `Custom Block ${blockId}`;

            // Create empty textureUris object - will be filled by applyCustomTextureDataUri
            const textureUris = {};

            // Create the BlockType
            blockType = new BlockType({
                id: blockId,
                name,
                isLiquid: options.isLiquid || false,
                textureUris,
            });

            // Register the new block type
            this._blockTypes[blockId] = blockType;
        }

        // Check if we need to rebuild the atlas
        // Rebuild if:
        // 1. It's explicitly requested in options
        // 2. It's a new block being added (to ensure textures are properly loaded)
        const shouldRebuildAtlas = options.rebuildAtlas === true || isNewBlock;

        // Apply the custom texture using the enhanced method for data URIs
        const success = await blockType.applyCustomTextureDataUri(
            dataUri,
            shouldRebuildAtlas
        );

        if (!success) {
            console.warn(
                `Failed to apply custom texture to block type ${blockId}`
            );
        }

        // Ensure the block type is saved in _blockTypes
        this._blockTypes[blockId] = blockType;

        // Verify block type is in registry after all operations
        const verifyBlock = this.getBlockType(blockId);
        if (!verifyBlock) {
            console.error(
                `Block type ${blockId} is missing from registry after registration!`
            );
            // Force add it again
            this._blockTypes[blockId] = blockType;
        }

        // Trigger mesh updates if needed
        const shouldUpdateMeshes = options.updateMeshes !== false; // default to true
        if (shouldUpdateMeshes) {
            try {
                // Using a custom event allows decoupling from direct ChunkManager dependency
                const blockTypeChangedEvent = new CustomEvent(
                    "blockTypeChanged",
                    {
                        detail: { blockTypeId: blockId },
                    }
                );
                window.dispatchEvent(blockTypeChangedEvent);
            } catch (error) {
                console.warn(
                    `Failed to trigger chunk mesh updates: ${error.message}`
                );
            }
        }

        return blockType;
    }

    /**
     * Register a test custom texture to verify texture loading
     * This can be called from the console for testing
     * @param {number} [blockId=100] - The block ID to use for the test (default: 100)
     * @returns {Promise<BlockType>} The created block type
     */
    async registerTestCustomTexture(blockId = 100) {
        console.log(
            `Registering test custom texture for block ID ${blockId}...`
        );

        // Create a simple colored texture as data URI
        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext("2d");

        // Draw a gradient background
        const gradient = ctx.createLinearGradient(0, 0, 16, 16);
        gradient.addColorStop(0, "red");
        gradient.addColorStop(0.5, "yellow");
        gradient.addColorStop(1, "green");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 16, 16);

        // Draw a border
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, 14, 14);

        // Add text
        ctx.fillStyle = "black";
        ctx.font = "8px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(blockId.toString(), 8, 8);

        // Convert to data URI
        const dataUri = canvas.toDataURL("image/png");

        // Register the texture
        return this.registerCustomTextureForBlockId(blockId, dataUri, {
            name: `Test Block ${blockId}`,
            updateMeshes: true,
        });
    }

    /**
     * Place a block in the world using one of the available TerrainBuilder methods
     * @param {Object} terrainBuilder - The terrain builder instance
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {number} z - Z coordinate
     * @param {number} blockId - The block ID to place
     * @returns {boolean} Success status
     */
    _placeBlockWithTerrainBuilder(terrainBuilder, x, y, z, blockId) {
        if (!terrainBuilder) return false;

        // Try different methods for placing blocks
        if (terrainBuilder.fastUpdateBlock) {
            terrainBuilder.fastUpdateBlock({ x, y, z }, blockId);
            return true;
        } else if (terrainBuilder.updateTerrainBlocks) {
            // Create block data in the format expected by the method
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
            // Create block data in the format expected by the method
            const blockData = {};
            blockData[`${x},${y},${z}`] = blockId;

            terrainBuilder.buildUpdateTerrain({ blocks: blockData });
            return true;
        } else {
            return false;
        }
    }

    /**
     * Create a custom block directly with data URI
     * @param {number} blockId - The block ID (recommended to use IDs > 100)
     * @param {string} dataUri - The data URI for the texture
     * @returns {Promise<boolean>} - Success status
     */
    async createCustomBlock(blockId, dataUri) {
        try {
            if (!blockId || blockId < 1) {
                console.error("Invalid block ID. Must be a positive number.");
                return false;
            }

            if (!dataUri || !dataUri.startsWith("data:image/")) {
                console.error("Invalid data URI format for custom texture");
                return false;
            }

            // Register the block with custom texture
            const blockType = await this.registerCustomTextureForBlockId(
                blockId,
                dataUri,
                {
                    name: `Custom Block ${blockId}`,
                    updateMeshes: true,
                }
            );

            return !!blockType;
        } catch (error) {
            console.error("Error creating custom block:", error);
            return false;
        }
    }

    /**
     * Global function to generate a texture data URI with specific color
     * @param {string} color - CSS color value
     * @returns {string} - Data URI of the generated texture
     */
    generateTextureDataURI(color = "#FF00FF") {
        try {
            // Generate a simple colored square as a test texture using a canvas
            const canvas = document.createElement("canvas");
            canvas.width = 16;
            canvas.height = 16;
            const ctx = canvas.getContext("2d");

            // Draw the main color
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 16, 16);

            // Add a border
            ctx.strokeStyle = "#000000";
            ctx.lineWidth = 1;
            ctx.strokeRect(0, 0, 16, 16);

            // Convert to data URI
            const dataUri = canvas.toDataURL("image/png");
            return dataUri;
        } catch (error) {
            console.error("Error generating texture data URI:", error);
            return null;
        }
    }

    /**
     * Create a block at specific coordinates
     * @param {number} blockId - ID for the block
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {number} z - Z coordinate
     * @param {string} color - Color for the block
     * @returns {Promise<boolean>} Success status
     */
    async createBlockAt(blockId, x, y, z, color = "#FF00FF") {
        try {
            // Generate texture
            const dataUri = this.generateTextureDataURI(color);

            // Register the block
            const blockType = await this.registerCustomTextureForBlockId(
                blockId,
                dataUri,
                {
                    name: `Custom Block ${blockId}`,
                    updateMeshes: true,
                }
            );

            if (!blockType) {
                console.error(`Failed to register block with ID ${blockId}`);
                return false;
            }

            // Try to place the block
            if (window.terrainBuilderRef && window.terrainBuilderRef.current) {
                const terrainBuilder = window.terrainBuilderRef.current;
                return this._placeBlockWithTerrainBuilder(
                    terrainBuilder,
                    x,
                    y,
                    z,
                    blockId
                );
            } else {
                console.error(
                    "terrainBuilderRef or terrainBuilderRef.current is not available"
                );
                return false;
            }
        } catch (error) {
            console.error("Error creating and placing block:", error);
            return false;
        }
    }

    /**
     * Fix custom textures for all registered block types
     * Call this method if you're having issues with custom block textures
     * Can be called from console: window.fixCustomTextures()
     * @returns {Promise<Object>} Results of the fix operation
     */
    async fixCustomTextures() {
        console.log("🔧 Starting custom texture repair process...");

        const results = {
            fixed: 0,
            failed: 0,
            blockIdsFixed: [],
            errors: [],
        };

        // First, check for blocks with IDs > 50 which are likely custom blocks
        const customBlockTypes = Object.values(this._blockTypes).filter(
            (blockType) => blockType.id > 50
        );
        console.log(`Found ${customBlockTypes.length} potential custom blocks`);

        if (customBlockTypes.length === 0) {
            console.log("No custom blocks found to fix");
            return results;
        }

        // For each custom block, try to repair its textures
        for (const blockType of customBlockTypes) {
            try {
                console.log(
                    `Attempting to fix textures for block ${blockType.id} (${blockType.name})`
                );

                // Get the texture URIs for this block type
                const textureUris = blockType.textureUris;

                // Look for data URIs in the texture URIs
                let dataUri = null;
                for (const face in textureUris) {
                    const uri = textureUris[face];
                    if (uri && uri.startsWith("data:image/")) {
                        dataUri = uri;
                        break;
                    }
                }

                // If we found a data URI, apply it to all faces
                if (dataUri) {
                    console.log(
                        `Found data URI for block ${blockType.id}, reapplying to all faces`
                    );

                    // First, try to load the texture into the texture atlas
                    const textureAtlas = BlockTextureAtlas.instance;
                    if (!textureAtlas) {
                        throw new Error("BlockTextureAtlas not available");
                    }

                    // Use the helper method to apply the data URI to all faces of the block
                    await blockType.applyCustomTextureDataUri(dataUri, true);

                    // Force a full update of the chunk meshes
                    if (typeof window !== "undefined") {
                        const event = new CustomEvent("blockTypeChanged", {
                            detail: { blockTypeId: blockType.id },
                        });
                        window.dispatchEvent(event);
                    }

                    results.fixed++;
                    results.blockIdsFixed.push(blockType.id);
                } else {
                    console.log(`No data URI found for block ${blockType.id}`);

                    // Check if we have a stored texture in localStorage
                    if (typeof window !== "undefined" && window.localStorage) {
                        const key = `block-texture-${blockType.id}`;
                        const storedDataUri = window.localStorage.getItem(key);

                        if (
                            storedDataUri &&
                            storedDataUri.startsWith("data:image/")
                        ) {
                            console.log(
                                `Found stored texture for block ${blockType.id} in localStorage`
                            );

                            // Apply the stored texture
                            await blockType.applyCustomTextureDataUri(
                                storedDataUri,
                                true
                            );

                            // Force a full update of the chunk meshes
                            if (typeof window !== "undefined") {
                                const event = new CustomEvent(
                                    "blockTypeChanged",
                                    {
                                        detail: { blockTypeId: blockType.id },
                                    }
                                );
                                window.dispatchEvent(event);
                            }

                            results.fixed++;
                            results.blockIdsFixed.push(blockType.id);
                        } else {
                            console.log(
                                `No stored texture found for block ${blockType.id}`
                            );
                            results.failed++;
                        }
                    } else {
                        console.log(`localStorage not available`);
                        results.failed++;
                    }
                }
            } catch (error) {
                console.error(
                    `Error fixing textures for block ${blockType.id}:`,
                    error
                );
                results.failed++;
                results.errors.push({
                    blockId: blockType.id,
                    error: error.message,
                });
            }
        }

        // Force a rebuild of the texture atlas
        await BlockTextureAtlas.instance.rebuildTextureAtlas();

        console.log(
            `🔧 Custom texture repair complete: Fixed ${results.fixed} blocks, failed ${results.failed} blocks`
        );
        return results;
    }

    /**
     * Batch register multiple custom textures for block IDs
     * This is more efficient as it only rebuilds the texture atlas once after all textures are loaded
     *
     * @param {Array<Object>} textureEntries - Array of objects with blockId and dataUri properties
     * @param {Object} [options] - Additional options same as registerCustomTextureForBlockId
     * @returns {Promise<Array<BlockType>>} The created or updated BlockTypes
     */
    async batchRegisterCustomTextures(textureEntries, options = {}) {
        if (!Array.isArray(textureEntries) || textureEntries.length === 0) {
            return [];
        }

        const results = [];
        const blockTypes = [];

        // First pass: register all block types without rebuilding atlas
        for (const entry of textureEntries) {
            const { blockId, dataUri } = entry;

            try {
                // Use same registration logic but explicitly prevent atlas rebuilding
                const entryOptions = {
                    ...options,
                    rebuildAtlas: false, // Prevent individual rebuilds during batch operation
                    updateMeshes: false, // Defer mesh updates until end of batch
                };

                const blockType = await this.registerCustomTextureForBlockId(
                    blockId,
                    dataUri,
                    entryOptions
                );

                if (blockType) {
                    blockTypes.push(blockType);
                    results.push({ blockId, success: true, blockType });
                } else {
                    results.push({
                        blockId,
                        success: false,
                        error: "Failed to register block type",
                    });
                }
            } catch (error) {
                results.push({ blockId, success: false, error: error.message });
            }
        }

        // After all textures are loaded, rebuild the atlas once
        if (blockTypes.length > 0) {
            try {
                // Force a single rebuild of the texture atlas
                if (BlockTextureAtlas.instance) {
                    await BlockTextureAtlas.instance.rebuildTextureAtlas();
                }

                // Trigger mesh updates if needed
                if (options.updateMeshes !== false) {
                    // Broadcast a single event for all updated block types
                    const blockTypeChangedEvent = new CustomEvent(
                        "blockTypesChanged",
                        {
                            detail: {
                                blockTypeIds: blockTypes.map((type) => type.id),
                                count: blockTypes.length,
                            },
                        }
                    );
                    window.dispatchEvent(blockTypeChangedEvent);
                }
            } catch (error) {
                console.error("Error during final atlas rebuild:", error);
            }
        }

        return results;
    }
}

// Initialize the singleton instance
BlockTypeRegistry._instance = null;

export default BlockTypeRegistry;
