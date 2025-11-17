import BlockType from "./BlockType";
import { getBlockTypes } from "../managers/BlockTypesManager";
import BlockTextureAtlas from "./BlockTextureAtlas";
import BlockMaterial from "./BlockMaterial";

// Utility to translate side texture keys from coordinate notation ("+x", "-y", etc.)
// to human-readable face names ("right", "bottom", etc.) expected by BlockType.
// If the key is already a face name it is passed through unchanged.
const COORD_TO_FACE_MAP = {
    "+x": "right",
    "-x": "left",
    "+y": "top",
    "-y": "bottom",
    "+z": "front",
    "-z": "back",
};

function convertSideTexturesToFaceNames(sideTextures = {}) {
    const result = {};
    Object.entries(sideTextures).forEach(([key, uri]) => {
        const faceKey = COORD_TO_FACE_MAP[key] || key; // default to existing key if already a face name
        result[faceKey] = uri;
    });
    return result;
}

/**
 * Registry for block types
 */
class BlockTypeRegistry {
    constructor() {
        this._blockTypes = {};
        this._initialized = false;

        this._essentialBlockTypes = new Set([]);
    }
    /**
     * Get the singleton instance
     * @returns {BlockTypeRegistry} The singleton instance
     */
    static get instance() {
        if (!this._instance) {
            this._instance = new BlockTypeRegistry();

            if (typeof window !== "undefined") {
                window.BlockTypeRegistry = BlockTypeRegistry;

                window.createCustomBlock = (blockId, dataUri) =>
                    this._instance.createCustomBlock(blockId, dataUri);
                window.generateTextureDataURI = (color) =>
                    this._instance.generateTextureDataURI(color);
                window.createBlockAt = (blockId, x, y, z, color) =>
                    this._instance.createBlockAt(blockId, x, y, z, color);
                window.fixCustomTextures = () =>
                    this._instance.fixCustomTextures();

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

        for (const blockTypeData of blockTypes) {
            const isLiquid = false;

            const blockType = new BlockType({
                id: blockTypeData.id,
                isLiquid: blockTypeData.isLiquid || isLiquid,
                name: blockTypeData.name || "Unknown",
                textureUris: blockTypeData.isMultiTexture
                    ? convertSideTexturesToFaceNames(blockTypeData.sideTextures)
                    : BlockType.textureUriToTextureUris(
                          blockTypeData.textureUri
                      ),
                lightLevel: blockTypeData.lightLevel,
            });
            this._blockTypes[blockTypeData.id] = blockType;
        }
        this._initialized = true;
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
            // For multi-texture blocks, handle specially to avoid duplicate texture loading
            if (blockTypeData.isMultiTexture && blockTypeData.sideTextures) {
                // Pre-load all face textures
                const textureAtlas = BlockTextureAtlas.instance;
                for (const [faceKey, dataUri] of Object.entries(
                    blockTypeData.sideTextures
                )) {
                    if (dataUri && dataUri.startsWith("data:image/")) {
                        await textureAtlas.loadTextureFromDataURI(
                            dataUri,
                            dataUri,
                            false
                        );
                    }
                }

                // Create block type with face textures
                const newBlockType = new BlockType({
                    id: blockTypeData.id,
                    isLiquid: blockTypeData.isLiquid || false,
                    name: blockTypeData.name || "Unknown",
                    textureUris: convertSideTexturesToFaceNames(
                        blockTypeData.sideTextures
                    ),
                    lightLevel: blockTypeData.lightLevel,
                });

                // Register directly without triggering additional texture loading
                this._blockTypes[blockTypeData.id] = newBlockType;

                // Rebuild atlas once after all textures are loaded
                await textureAtlas.rebuildTextureAtlas();

                // Dispatch event
                const event = new CustomEvent("blockTypeChanged", {
                    detail: { blockTypeId: blockTypeData.id },
                });
                window.dispatchEvent(event);

                return; // Exit early for multi-texture blocks
            }

            // Single texture block - use normal flow
            const newBlockType = new BlockType({
                id: blockTypeData.id,
                isLiquid: blockTypeData.isLiquid || false,
                name: blockTypeData.name || "Unknown",
                textureUris: BlockType.textureUriToTextureUris(
                    blockTypeData.textureUri
                ),
                lightLevel: blockTypeData.lightLevel,
            });
            await this.registerBlockType(newBlockType);
        } else {
            // Updating existing block
            if (blockTypeData.name) {
                blockType.setName(blockTypeData.name);
            }

            if (blockTypeData.textureUri || blockTypeData.sideTextures) {
                // For multi-texture blocks, pre-load textures
                if (
                    blockTypeData.isMultiTexture &&
                    blockTypeData.sideTextures
                ) {
                    const textureAtlas = BlockTextureAtlas.instance;
                    for (const [faceKey, dataUri] of Object.entries(
                        blockTypeData.sideTextures
                    )) {
                        if (dataUri && dataUri.startsWith("data:image/")) {
                            await textureAtlas.loadTextureFromDataURI(
                                dataUri,
                                dataUri,
                                false
                            );
                        }
                    }

                    // Set texture URIs on block type
                    const textureUris = convertSideTexturesToFaceNames(
                        blockTypeData.sideTextures
                    );
                    blockType._textureUris = textureUris; // Direct assignment to avoid triggering loads

                    // Rebuild atlas once
                    await textureAtlas.rebuildTextureAtlas();

                    // Dispatch event
                    const event = new CustomEvent("blockTypeChanged", {
                        detail: { blockTypeId: blockTypeData.id },
                    });
                    window.dispatchEvent(event);
                } else {
                    // Single texture block
                    const textureUris = BlockType.textureUriToTextureUris(
                        blockTypeData.textureUri
                    );
                    await blockType.setTextureUris(textureUris);
                }
            }

            // Update light level, trigger mesh refresh if changed
            if (
                typeof blockTypeData.lightLevel !== "undefined" &&
                blockType.lightLevel !== blockTypeData.lightLevel
            ) {
                blockType._lightLevel = blockTypeData.lightLevel; // internal update
                try {
                    const event = new CustomEvent("blockTypeChanged", {
                        detail: { blockTypeId: blockTypeData.id },
                    });
                    window.dispatchEvent(event);
                } catch (e) {}

                // After changing light level, ensure affected and neighboring chunks are remeshed
                try {
                    const chunkSystem =
                        window?.getChunkSystem?.() ||
                        require("../chunks/TerrainBuilderIntegration").getChunkSystem();
                    const manager = chunkSystem;
                    if (manager && manager._chunks) {
                        const chunkIds = Array.from(manager._chunks.keys());
                        for (const chunkId of chunkIds) {
                            const chunk = manager._chunks.get(chunkId);
                            if (!chunk) continue;
                            const hadType = chunk.containsBlockType?.(
                                blockTypeData.id
                            );
                            if (!hadType) continue;
                            // mark this chunk and neighbors within light radius for remesh
                            const searchRadius = Math.ceil((15 + 1) / 16); // MAX_LIGHT_LEVEL + 1 over CHUNK_SIZE
                            const origin = chunk.originCoordinate;
                            const marked = [];
                            for (
                                let dx = -searchRadius;
                                dx <= searchRadius;
                                dx++
                            ) {
                                for (
                                    let dy = -searchRadius;
                                    dy <= searchRadius;
                                    dy++
                                ) {
                                    for (
                                        let dz = -searchRadius;
                                        dz <= searchRadius;
                                        dz++
                                    ) {
                                        const neighborKey = `${
                                            origin.x + dx * 16
                                        },${origin.y + dy * 16},${
                                            origin.z + dz * 16
                                        }`;
                                        if (manager._chunks.has(neighborKey)) {
                                            const n =
                                                manager._chunks.get(
                                                    neighborKey
                                                );
                                            n?.clearLightSourceCache?.();
                                            manager.markChunkForRemesh(
                                                neighborKey,
                                                { forceCompleteRebuild: true }
                                            );
                                            marked.push(neighborKey);
                                        }
                                    }
                                }
                            }
                            if (
                                typeof window !== "undefined" &&
                                (window.__LIGHT_DEBUG__?.refresh ||
                                    window.__LIGHT_DEBUG__ === true)
                            ) {
                            }
                        }
                        manager.processRenderQueue?.(true);
                    }
                } catch (e) {}
            }
        }
    }
    /**
     * Preload textures for block types
     * @param {Object} options - Preload options
     * @param {boolean} options.onlyEssential - If true, only preload essential block types (default: false)
     * @returns {Promise<void>}
     */
    async preload(options = {}) {
        const { onlyEssential = false } = options;

        // If onlyEssential is false, mark all block types as essential (backward compatibility)
        if (!onlyEssential) {
            Object.values(this._blockTypes).forEach((blockType) => {
                this._essentialBlockTypes.add(blockType.id);
            });
        }

        // Filter block types to preload
        let blockTypesToPreload;
        if (onlyEssential) {
            // Only preload essential block types (those actually used in terrain)
            blockTypesToPreload = Object.values(this._blockTypes).filter(
                (blockType) => 
                    this._essentialBlockTypes.has(blockType.id) &&
                    (blockType.needsTexturePreload?.() ?? true)
            );
        } else {
            // Preload all block types (original behavior)
            blockTypesToPreload = Object.values(this._blockTypes).filter(
                (blockType) => blockType.needsTexturePreload?.() ?? true
            );
        }

        if (blockTypesToPreload.length === 0) {
            return;
        }
        await Promise.all(
            blockTypesToPreload.map((blockType) => blockType.preloadTextures())
        );
    }
    /**
     * Add a block type ID to the essential block types set
     * @param {number} id - The block type ID to mark as essential
     */
    markBlockTypeAsEssential(id) {
        this._essentialBlockTypes.add(id);
    }
    /**
     * Preload textures for a specific block type immediately
     * Used when a block is selected to ensure textures are ready
     * @param {number} blockId - The block type ID to preload
     * @returns {Promise<void>}
     */
    async preloadBlockTypeTextures(blockId) {
        const logKey = `BlockTypeRegistry.preloadBlockTypeTextures(${blockId})`;
        
        const blockType = this.getBlockType(blockId);
        if (!blockType) {
            console.warn(`[TEXTURE] Block type ${blockId} not found for preload`);
            return;
        }
        
        this.markBlockTypeAsEssential(blockId);
        
        try {
            await blockType.preloadTextures();
            
            // Immediately rebuild atlas to ensure textures are available
            await BlockTextureAtlas.instance.rebuildTextureAtlas();
            
            // Retry any missing textures immediately
            await this._retryMissingTextures();
            
        } catch (error) {
            console.error(`[TEXTURE] ✗ Failed to preload textures for ${blockType.name}:`, error);
            throw error;
        }
    }
    /**
     * Retry loading missing textures immediately
     * @private
     * @returns {Promise<void>}
     */
    async _retryMissingTextures() {
        const atlas = BlockTextureAtlas.instance;
        if (!atlas._missingTextureWarnings || atlas._missingTextureWarnings.size === 0) {
            return;
        }
        
        const missingTextures = Array.from(atlas._missingTextureWarnings);
        
        // Clear the warnings set so we can track new failures
        atlas._missingTextureWarnings.clear();
        
        const results = await Promise.allSettled(
            missingTextures.map(async (uri) => {
                try {
                    await atlas.loadTexture(uri);
                    return { uri, success: true };
                } catch (error) {
                    console.warn(`[TEXTURE] ✗ Retry failed: ${uri}`, error);
                    return { uri, success: false, error };
                }
            })
        );
        
        const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
        
        // Update material if any textures were loaded
        if (successful > 0) {
            BlockMaterial.instance.setTextureAtlas(atlas.textureAtlas);
        }
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

        let blockType = this.getBlockType(blockId);

        const isNewBlock = !blockType;

        if (isNewBlock) {
            const name = options.name || `Custom Block ${blockId}`;

            const textureUris = {};

            blockType = new BlockType({
                id: blockId,
                name,
                isLiquid: options.isLiquid || false,
                textureUris,
            });

            this._blockTypes[blockId] = blockType;
        }

        const shouldRebuildAtlas = options.rebuildAtlas === true || isNewBlock;

        const success = await blockType.applyCustomTextureDataUri(
            dataUri,
            shouldRebuildAtlas
        );
        if (!success) {
            console.warn(
                `Failed to apply custom texture to block type ${blockId}`
            );
        }

        this._blockTypes[blockId] = blockType;

        const verifyBlock = this.getBlockType(blockId);
        if (!verifyBlock) {
            console.error(
                `Block type ${blockId} is missing from registry after registration!`
            );

            this._blockTypes[blockId] = blockType;
        }

        const shouldUpdateMeshes = options.updateMeshes !== false; // default to true
        if (shouldUpdateMeshes) {
            try {
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

        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext("2d");

        const gradient = ctx.createLinearGradient(0, 0, 16, 16);
        gradient.addColorStop(0, "red");
        gradient.addColorStop(0.5, "yellow");
        gradient.addColorStop(1, "green");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 16, 16);

        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, 14, 14);

        ctx.fillStyle = "black";
        ctx.font = "8px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(blockId.toString(), 8, 8);

        const dataUri = canvas.toDataURL("image/png");

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
            const canvas = document.createElement("canvas");
            canvas.width = 16;
            canvas.height = 16;
            const ctx = canvas.getContext("2d");

            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 16, 16);

            ctx.strokeStyle = "#000000";
            ctx.lineWidth = 1;
            ctx.strokeRect(0, 0, 16, 16);

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
            const dataUri = this.generateTextureDataURI(color);

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
        const results = {
            fixed: 0,
            failed: 0,
            blockIdsFixed: [],
            errors: [],
        };

        const customBlockTypes = Object.values(this._blockTypes).filter(
            (blockType) => blockType.id > 50
        );
        if (customBlockTypes.length === 0) {
            return results;
        }

        for (const blockType of customBlockTypes) {
            try {

                const textureUris = blockType.textureUris;

                let dataUri = null;
                for (const face in textureUris) {
                    const uri = textureUris[face];
                    if (uri && uri.startsWith("data:image/")) {
                        dataUri = uri;
                        break;
                    }
                }

                if (dataUri) {
                    const textureAtlas = BlockTextureAtlas.instance;
                    if (!textureAtlas) {
                        throw new Error("BlockTextureAtlas not available");
                    }

                    await blockType.applyCustomTextureDataUri(dataUri, true);

                    if (typeof window !== "undefined") {
                        const event = new CustomEvent("blockTypeChanged", {
                            detail: { blockTypeId: blockType.id },
                        });
                        window.dispatchEvent(event);
                    }
                    results.fixed++;
                    results.blockIdsFixed.push(blockType.id);
                } else {
                    if (typeof window !== "undefined" && window.localStorage) {
                        const key = `block-texture-${blockType.id}`;
                        const storedDataUri = window.localStorage.getItem(key);
                        if (
                            storedDataUri &&
                            storedDataUri.startsWith("data:image/")
                        ) {

                            await blockType.applyCustomTextureDataUri(
                                storedDataUri,
                                true
                            );

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
                            results.failed++;
                        }
                    } else {
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

        await BlockTextureAtlas.instance.rebuildTextureAtlas();
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

        for (const entry of textureEntries) {
            const { blockId, dataUri } = entry;
            try {
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

        if (blockTypes.length > 0) {
            try {
                if (BlockTextureAtlas.instance) {
                    await BlockTextureAtlas.instance.rebuildTextureAtlas();
                }

                if (options.updateMeshes !== false) {
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

BlockTypeRegistry._instance = null;
export default BlockTypeRegistry;
