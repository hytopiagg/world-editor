// BlockType.js
// Represents a block type in the world

import BlockTextureAtlas, { FACE_NAME_TO_COORD_MAP } from "./BlockTextureAtlas";
import {
    BlockFaces,
    DEFAULT_BLOCK_AO_INTENSITY,
    DEFAULT_BLOCK_COLOR,
    DEFAULT_BLOCK_FACE_GEOMETRIES,
    DEFAULT_BLOCK_NEIGHBOR_OFFSETS,
    BlockFaceAxes,
} from "./BlockConstants";

/**
 * Represents a block type in the world
 */
class BlockType {
    /**
     * Create a new block type
     * @param {Object} data - Block type data
     * @param {number} data.id - Block type ID
     * @param {boolean} data.isLiquid - Whether the block is a liquid
     * @param {string} data.name - Block type name
     * @param {Object} data.textureUris - Texture URIs for each face
     */
    constructor(data) {
        if (data.id === 0) {
            throw new Error(
                "BlockType.constructor(): Block type id cannot be 0 because it is reserved for air!"
            );
        }

        this._id = data.id;
        this._aoIntensity = DEFAULT_BLOCK_AO_INTENSITY;
        this._blockFaces = BlockFaces;
        this._blockFaceGeometries = DEFAULT_BLOCK_FACE_GEOMETRIES;
        this._blockNeighborOffsets = DEFAULT_BLOCK_NEIGHBOR_OFFSETS;
        this._color = DEFAULT_BLOCK_COLOR;
        this._isLiquid = data.isLiquid || false;
        this._name = data.name || "Unknown";
        this._textureUris = data.textureUris || {};

        // Mark if this is a commonly used block type (ID < 10)
        this._isCommonlyUsed = data.id < 10;

        // Don't preload textures automatically - use lazy loading instead
        // If this is a commonly used block, preload its textures
        if (this._isCommonlyUsed) {
            this.preloadTextures();
        }
    }

    /**
     * Get the block type ID
     * @returns {number} The block type ID
     */
    get id() {
        return this._id;
    }

    /**
     * Get the ambient occlusion intensity
     * @returns {Array} The AO intensity values
     */
    get aoIntensity() {
        return this._aoIntensity;
    }

    /**
     * Get the block color
     * @returns {Array} The block color [r, g, b, a]
     */
    get color() {
        return this._color;
    }

    /**
     * Get the block faces
     * @returns {Array} The block faces
     */
    get faces() {
        return this._blockFaces;
    }

    /**
     * Get the block face geometries
     * @returns {Object} The block face geometries
     */
    get faceGeometries() {
        return this._blockFaceGeometries;
    }

    /**
     * Check if the block is a liquid
     * @returns {boolean} True if the block is a liquid
     */
    get isLiquid() {
        return this._isLiquid;
    }

    /**
     * Get the block name
     * @returns {string} The block name
     */
    get name() {
        return this._name;
    }

    /**
     * Get the block neighbor offsets
     * @returns {Array} The block neighbor offsets
     */
    get neighborOffsets() {
        return this._blockNeighborOffsets;
    }

    /**
     * Get the block texture URIs
     * @returns {Object} The block texture URIs
     */
    get textureUris() {
        return this._textureUris;
    }

    /**
     * Check if this block type has multi-sided textures
     * @returns {boolean} True if the block has different textures for different faces
     */
    get isMultiSided() {
        // If there's more than one unique texture URI, it's multi-sided
        const uniqueTextureUris = new Set(
            Object.values(this._textureUris).filter(Boolean)
        );

        // If we have more than one unique texture URI, it's clearly multi-sided
        if (uniqueTextureUris.size > 1) {
            return true;
        }

        // If we have exactly one unique texture URI, check if it's a folder path
        if (uniqueTextureUris.size === 1) {
            const textureUri = Array.from(uniqueTextureUris)[0];
            // If the texture URI doesn't have an extension, it's likely a folder path
            return !textureUri.match(/\.(png|jpe?g)$/i);
        }

        return false;
    }

    /**
     * Check if this block type has multiple textures (different from isMultiSided)
     * @returns {boolean} True if the block has multiple textures
     */
    get _isMultiTexture() {
        // For compatibility, we'll use the same implementation as isMultiSided
        // This ensures that getTexturePath works correctly
        return this.isMultiSided;
    }

    /**
     * Get the base texture URI for this block
     * @returns {string|undefined} The base texture URI
     */
    get _textureUri() {
        // Extract from _textureUris if it exists
        if (this._textureUris) {
            // Try to get the common name for multi-sided blocks
            const uniqueTextureUris = new Set(
                Object.values(this._textureUris).filter(Boolean)
            );

            if (uniqueTextureUris.size > 0) {
                const uri = Array.from(uniqueTextureUris)[0];
                // If there's a path with slashes, get the base folder
                const parts = uri.split("/");
                if (parts.length > 1) {
                    // Return the part before the last slash (the directory name)
                    return parts.slice(0, -1).join("/");
                }

                // For single texture blocks, just return the uri
                return uri;
            }
        }

        // Fallback to undefined if no texture URIs exist
        return undefined;
    }

    /**
     * Convert a single texture URI to a map of face texture URIs
     * @param {string} textureUri - The texture URI
     * @returns {Object} The face texture URIs
     */
    static textureUriToTextureUris(textureUri) {
        // If null or undefined, return empty object
        if (!textureUri) return {};

        // For data URIs, use the same URI for all faces
        if (textureUri.startsWith("data:image/")) {
            return Object.keys(BlockFaceAxes).reduce((textureUris, face) => {
                textureUris[face] = textureUri;
                return textureUris;
            }, {});
        }

        const uriParts = textureUri.split("/");
        const isSingleTexture = uriParts[uriParts.length - 1].includes("."); // Has file extension

        // Create the base URI (either the full path or the directory path)
        const baseUri = textureUri;

        // For each face, create the appropriate texture URI
        return Object.entries(FACE_NAME_TO_COORD_MAP).reduce(
            (textureUris, [face, coord]) => {
                if (isSingleTexture) {
                    // Single texture - use same texture for all faces
                    textureUris[face] = baseUri;
                } else {
                    // Multi-sided texture - create face-specific paths
                    textureUris[face] = `${baseUri}/${coord}.png`;
                }
                return textureUris;
            },
            {}
        );
    }

    /**
     * Check if a face is transparent
     * @param {string} face - The face to check
     * @returns {boolean} True if the face is transparent
     */
    isFaceTransparent(face) {
        const textureMetadata = BlockTextureAtlas.instance.getTextureMetadata(
            this._textureUris[face]
        );
        return textureMetadata?.isTransparent ?? false;
    }

    /**
     * Set the block name
     * @param {string} name - The new name
     */
    setName(name) {
        this._name = name;
    }

    /**
     * Set the block texture URIs
     * @param {Object} textureUris - The new texture URIs
     * @returns {Promise<void>}
     */
    async setTextureUris(textureUris) {
        this._textureUris = textureUris;

        // Only preload textures for commonly used blocks
        if (this._isCommonlyUsed) {
            await this.preloadTextures();
        } else {
            // For other blocks, just queue the textures for loading
            this.queueTexturesForLoading();
        }
    }

    /**
     * Queue all textures for this block type for loading without waiting
     */
    queueTexturesForLoading() {
        Object.values(this._textureUris).forEach((textureUri) => {
            if (!textureUri) return;

            // Queue the texture for loading
            BlockTextureAtlas.instance.queueTextureForLoading(textureUri);

            // If the texture URI doesn't have an extension, queue variants
            if (!textureUri.match(/\.(png|jpe?g)$/i)) {
                // Queue the base texture with extension
                BlockTextureAtlas.instance.queueTextureForLoading(
                    `${textureUri}.png`
                );

                // Queue common fallback textures
                const fallbacks = ["all.png", "default.png"];
                for (const fallback of fallbacks) {
                    BlockTextureAtlas.instance.queueTextureForLoading(
                        `${textureUri}/${fallback}`
                    );
                }
            }
        });
    }

    /**
     * Preload all textures for this block type
     * @returns {Promise<void>}
     */
    async preloadTextures() {
        const loadPromises = Object.entries(this._textureUris).map(
            async ([face, textureUri]) => {
                if (!textureUri) return;

                try {
                    // For data URIs, load directly without trying to append extensions
                    if (textureUri.startsWith("data:image/")) {
                        await BlockTextureAtlas.instance.loadTexture(
                            textureUri
                        );
                        return;
                    }

                    // If the texture URI doesn't have an extension, try to load multiple variants
                    if (!textureUri.match(/\.(png|jpe?g)$/i)) {
                        // Try to load the base texture with extension
                        try {
                            await BlockTextureAtlas.instance.loadTexture(
                                `${textureUri}.png`
                            );
                        } catch (error) {
                            // Ignore error, will try other variants
                        }

                        // Try to load face-specific textures
                        const faceMap = {
                            top: "+y.png",
                            bottom: "-y.png",
                            left: "-x.png",
                            right: "+x.png",
                            front: "+z.png",
                            back: "-z.png",
                        };

                        // Load the specific face texture
                        if (faceMap[face]) {
                            try {
                                await BlockTextureAtlas.instance.loadTexture(
                                    `${textureUri}/${faceMap[face]}`
                                );
                            } catch (error) {
                                // Ignore error, will try the direct texture URI next
                            }
                        }
                    }

                    // Finally, try to load the direct texture URI
                    await BlockTextureAtlas.instance.loadTexture(textureUri);
                } catch (error) {
                    console.warn(
                        `Failed to preload texture for face ${face}: ${textureUri}`,
                        error
                    );
                }
            }
        );

        await Promise.all(loadPromises);
    }

    /**
     * Check if this block type's textures need to be preloaded
     * @returns {boolean} True if any textures need to be preloaded
     */
    needsTexturePreload() {
        // If there are no texture URIs, no need to preload
        if (!this._textureUris || Object.keys(this._textureUris).length === 0) {
            return false;
        }

        // Check if any of the textures are not loaded
        for (const [face, textureUri] of Object.entries(this._textureUris)) {
            if (!textureUri) continue;

            const textureAtlas = BlockTextureAtlas.instance;

            // For non-extension textures (multi-sided blocks)
            if (!textureUri.match(/\.(png|jpe?g)$/i)) {
                const faceMap = {
                    top: "+y.png",
                    bottom: "-y.png",
                    left: "-x.png",
                    right: "+x.png",
                    front: "+z.png",
                    back: "-z.png",
                };

                // Check if the face-specific texture is loaded
                if (faceMap[face]) {
                    const facePath = `${textureUri}/${faceMap[face]}`;
                    if (!textureAtlas.getTextureMetadata(facePath)) {
                        return true; // Needs preloading
                    }
                }

                // Check if any fallback texture is loaded
                const basePaths = [
                    `${textureUri}.png`,
                    `${textureUri}/all.png`,
                    `${textureUri}/default.png`,
                ];

                // If none of the possible textures are loaded, needs preloading
                const anyTextureLoaded = basePaths.some((path) =>
                    textureAtlas.getTextureMetadata(path)
                );

                if (!anyTextureLoaded) {
                    return true; // Needs preloading
                }
            } else {
                // Direct check for single textures with extensions
                if (!textureAtlas.getTextureMetadata(textureUri)) {
                    return true; // Needs preloading
                }
            }
        }

        // All textures are already loaded
        return false;
    }

    /**
     * Set a custom texture for this block type from a data URI
     * @param {string} dataUri - The data URI of the texture
     * @param {string|null} customId - Optional custom ID for the texture
     * @returns {Promise<void>}
     */
    async setCustomTexture(dataUri, customId = null) {
        if (!dataUri) {
            console.error("No data URI provided for custom texture");
            return;
        }

        // Check if this is a valid data URI
        if (!dataUri.startsWith("data:image/")) {
            console.error("Invalid data URI format for custom texture");
            return;
        }

        console.log(
            `Setting custom texture for block type ${this._id} (${this._name})...`
        );

        // For custom textures, we use the same texture for all faces
        const textureUris = {};
        const faceNames = Object.keys(BlockFaceAxes);
        faceNames.forEach((face) => {
            textureUris[face] = dataUri;
            console.log(
                `Set texture for face "${face}": ${dataUri.substring(0, 30)}...`
            );
        });

        // Set the new texture URIs - this just stores references but doesn't load textures
        this._textureUris = textureUris;

        // Make sure BlockTextureAtlas is initialized
        if (!BlockTextureAtlas.instance) {
            console.error("BlockTextureAtlas is not initialized");
            return;
        }

        // Try to load the texture immediately to make it available
        try {
            console.log(
                `Loading texture from data URI (length: ${dataUri.length})...`
            );

            // First try to load it directly
            await BlockTextureAtlas.instance.loadTexture(dataUri);

            // Then force a rebuild of the texture atlas
            console.log(
                `Rebuilding texture atlas after loading custom texture...`
            );
            await BlockTextureAtlas.instance.rebuildTextureAtlas();

            // Verify that the texture metadata exists after loading
            const metadata =
                BlockTextureAtlas.instance.getTextureMetadata(dataUri);
            if (metadata) {
                console.log(`Texture successfully loaded with metadata:`, {
                    x: metadata.x,
                    y: metadata.invertedY,
                    width: metadata.width,
                    height: metadata.height,
                    isTransparent: metadata.isTransparent,
                });
            } else {
                console.warn(
                    `Texture was loaded but no metadata found for ${dataUri}!`
                );
                console.log(
                    `Attempting direct loading with loadTextureFromDataURI...`
                );

                // Try a more direct approach as fallback
                await BlockTextureAtlas.instance.loadTextureFromDataURI(
                    dataUri,
                    dataUri
                );

                // Check again
                const retryMetadata =
                    BlockTextureAtlas.instance.getTextureMetadata(dataUri);
                if (retryMetadata) {
                    console.log(`Direct loading successful! Metadata:`, {
                        x: retryMetadata.x,
                        y: retryMetadata.invertedY,
                        width: retryMetadata.width,
                        height: retryMetadata.height,
                    });
                } else {
                    console.error(
                        `Failed to load texture even with direct loading method`
                    );
                }
            }

            // Make sure we force the renderer to update
            if (typeof window !== "undefined" && window.dispatchEvent) {
                console.log(`Dispatching texture update event...`);
                const event = new CustomEvent("textureAtlasUpdated", {
                    detail: { textureId: dataUri, blockId: this._id },
                });
                window.dispatchEvent(event);
            }
        } catch (error) {
            console.error("Failed to load custom texture:", error);
        }
    }

    /**
     * Get the texture file path for the specified block face
     * @param {string} face - The face to get the texture for (front, back, left, right, top, bottom)
     * @returns {string} - The texture file path
     */
    getTextureForFace(face) {
        // If we have specific textures for each face, use those
        if (this._textureUris && this._textureUris[face]) {
            return this._textureUris[face];
        }

        // If there's a general texture URI, use that
        if (this._textureUri) {
            // If the URI is a data URI, return it directly without modification
            if (this._textureUri.startsWith("data:image/")) {
                return this._textureUri;
            }

            // For regular file paths, construct the path as before
            return this._textureUri;
        }

        // Fallback to default error texture
        return "./assets/blocks/error.png";
    }

    /**
     * Get the texture file path for the blocks of this type
     * @param {string} face - The face of the block to get the texture for
     * @returns {string} - The path to the texture file
     */
    getTexturePath(face) {
        if (!face) face = "front";

        // For custom blocks (numeric IDs), check localStorage directly first
        const isCustomBlock =
            !isNaN(parseInt(this._id)) ||
            this._name === "Untitled" ||
            this._name === "test_block";
        if (isCustomBlock) {
            // Try to find a custom texture in localStorage first
            if (typeof window !== "undefined" && window.localStorage) {
                const storageKeys = [
                    `block-texture-${this._id}`,
                    `custom-block-${this._id}`,
                    `datauri-${this._id}`,
                ];

                for (const key of storageKeys) {
                    const storedUri = window.localStorage.getItem(key);
                    if (storedUri && storedUri.startsWith("data:image/")) {
                        // Found a data URI, use it directly
                        return storedUri;
                    }
                }
            }

            // For custom blocks with specific face textures, return them
            if (this._textureUris && this._textureUris[face]) {
                const texturePath = this._textureUris[face];
                // Only use it if it's a data URI, not a file path that will fail
                if (texturePath && texturePath.startsWith("data:image/")) {
                    return texturePath;
                }
            }

            // If we didn't find a texture in localStorage, use error texture
            // instead of trying to load from file system which will fail
            return "./assets/blocks/error.png";
        }

        // First check if we have face-specific textures
        if (this._textureUris && this._textureUris[face]) {
            const texturePath = this._textureUris[face];

            // For data URIs, return directly without modification
            if (texturePath.startsWith("data:image/")) {
                return texturePath;
            }

            // Handle regular file paths
            return texturePath;
        }

        // If no specific texture for this face, use the base texture folder for multi-sided blocks
        if (this.isMultiSided || this._isMultiTexture) {
            // Get base folder from first texture URI or _textureUri
            const baseFolder =
                this._textureUri ||
                (this._textureUris && Object.values(this._textureUris)[0]);

            if (baseFolder) {
                // Handle data URIs directly
                if (baseFolder.startsWith("data:image/")) {
                    return baseFolder;
                }

                // For paths that already have a file extension, return as is
                if (baseFolder.match(/\.(png|jpe?g)$/i)) {
                    return baseFolder;
                }

                // Special handling for paths that already include 'blocks/'
                const basePath = baseFolder.includes("blocks/")
                    ? baseFolder
                    : `./assets/blocks/${baseFolder}`;

                // Get the face direction
                const faceDir = this.getFaceDirection(face);

                // Construct the full path for multi-sided blocks
                const finalPath = `${basePath}/${faceDir}.png`;
                return finalPath;
            }
        }

        // For single texture (non-multi-sided) blocks, just use the first texture URI
        if (this._textureUris) {
            const firstUri = Object.values(this._textureUris)[0];
            if (firstUri) {
                return firstUri;
            }
        }

        // Fallback to default error texture
        console.warn(
            `No texture found for block ${this._id} (${this._name}), face: ${face}`
        );
        return "./assets/blocks/error.png";
    }

    /**
     * Get texture URIs for this block type
     * @returns {Object} The texture URIs for each face
     */
    getTextureUris() {
        return this._textureUris || {};
    }

    /**
     * Apply a custom texture from a data URI
     * @param {string} dataUri - The data URI of the texture
     * @param {boolean} rebuildAtlas - Whether to rebuild the texture atlas
     * @returns {Promise<boolean>} Success status
     */
    async applyCustomTextureDataUri(dataUri, rebuildAtlas = false) {
        if (!dataUri || !dataUri.startsWith("data:image/")) {
            console.error("Invalid data URI format for custom texture");
            return false;
        }

        try {
            console.log(
                `Applying custom texture data URI for block ID ${this._id}`
            );

            // Set the texture URI for all faces
            const faces = ["top", "bottom", "left", "right", "front", "back"];
            faces.forEach((face) => {
                this._textureUris[face] = dataUri;
            });

            // Make sure the texture is loaded in the texture atlas
            if (BlockTextureAtlas.instance) {
                // First, try to use the specialized method
                let success =
                    await BlockTextureAtlas.instance.applyDataUriToAllFaces(
                        `${this._id}`,
                        dataUri
                    );

                // If that fails, try direct loading approach
                if (!success) {
                    console.log(
                        `Fallback: Direct loading for block ${this._id}`
                    );
                    await BlockTextureAtlas.instance.loadTextureFromDataURI(
                        dataUri,
                        dataUri
                    );

                    // Get the metadata
                    const metadata =
                        BlockTextureAtlas.instance.getTextureMetadata(dataUri);
                    if (metadata) {
                        // Manually map all the keys
                        BlockTextureAtlas.instance._textureAtlasMetadata.set(
                            `${this._id}`,
                            metadata
                        );
                        BlockTextureAtlas.instance._textureAtlasMetadata.set(
                            this._id,
                            metadata
                        );
                        BlockTextureAtlas.instance._textureAtlasMetadata.set(
                            `blocks/${this._id}`,
                            metadata
                        );
                        faces.forEach((face) => {
                            const faceCoord = {
                                top: "+y",
                                bottom: "-y",
                                left: "-x",
                                right: "+x",
                                front: "+z",
                                back: "-z",
                            }[face];
                            BlockTextureAtlas.instance._textureAtlasMetadata.set(
                                `blocks/${this._id}/${faceCoord}.png`,
                                metadata
                            );
                        });
                        success = true;
                    }
                }

                // Force rebuild the texture atlas
                if (success || rebuildAtlas) {
                    await BlockTextureAtlas.instance.rebuildTextureAtlas();
                }

                // Always dispatch texture atlas updated event to notify components
                if (typeof window !== "undefined") {
                    const event = new CustomEvent("textureAtlasUpdated", {
                        detail: { textureId: dataUri, blockId: this._id },
                    });
                    window.dispatchEvent(event);

                    // Also try forcing a refresh of chunk meshes
                    const blockTypeChangedEvent = new CustomEvent(
                        "blockTypeChanged",
                        {
                            detail: { blockTypeId: this._id },
                        }
                    );
                    window.dispatchEvent(blockTypeChangedEvent);
                }

                return success;
            } else {
                console.warn("BlockTextureAtlas not available");
                return false;
            }
        } catch (error) {
            console.error("Failed to apply custom texture:", error);
            return false;
        }
    }

    /**
     * Get the direction string for a face to use in texture paths
     * @param {string} face - The face of the block (e.g., 'top', 'bottom', etc.)
     * @returns {string} - The direction string for the face (e.g., '+y', '-y', etc.)
     */
    getFaceDirection(face) {
        // Use the imported constant from BlockTextureAtlas
        return FACE_NAME_TO_COORD_MAP[face] || face;
    }
}

export default BlockType;
