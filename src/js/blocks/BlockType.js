

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

        this._isCommonlyUsed = data.id < 10;


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
        return [0, 0, 0, 0]; // Always return zeros to disable AO
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

        const uniqueTextureUris = new Set(
            Object.values(this._textureUris).filter(Boolean)
        );

        if (uniqueTextureUris.size > 1) {
            return true;
        }

        if (uniqueTextureUris.size === 1) {
            const textureUri = Array.from(uniqueTextureUris)[0];

            return !textureUri.match(/\.(png|jpe?g)$/i);
        }
        return false;
    }
    /**
     * Check if this block type has multiple textures (different from isMultiSided)
     * @returns {boolean} True if the block has multiple textures
     */
    get _isMultiTexture() {


        return this.isMultiSided;
    }
    /**
     * Get the base texture URI for this block
     * @returns {string|undefined} The base texture URI
     */
    get _textureUri() {

        if (this._textureUris) {

            const uniqueTextureUris = new Set(
                Object.values(this._textureUris).filter(Boolean)
            );
            if (uniqueTextureUris.size > 0) {
                const uri = Array.from(uniqueTextureUris)[0];

                const parts = uri.split("/");
                if (parts.length > 1) {

                    return parts.slice(0, -1).join("/");
                }

                return uri;
            }
        }

        return undefined;
    }
    /**
     * Convert a single texture URI to a map of face texture URIs
     * @param {string} textureUri - The texture URI
     * @returns {Object} The face texture URIs
     */
    static textureUriToTextureUris(textureUri) {

        if (!textureUri) return {};

        if (textureUri.startsWith("data:image/")) {
            return Object.keys(BlockFaceAxes).reduce((textureUris, face) => {
                textureUris[face] = textureUri;
                return textureUris;
            }, {});
        }
        const uriParts = textureUri.split("/");
        const isSingleTexture = uriParts[uriParts.length - 1].includes("."); // Has file extension

        const baseUri = textureUri;

        return Object.entries(FACE_NAME_TO_COORD_MAP).reduce(
            (textureUris, [face, coord]) => {
                if (isSingleTexture) {

                    textureUris[face] = baseUri;
                } else {

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

        if (this._isCommonlyUsed) {
            await this.preloadTextures();
        } else {

            this.queueTexturesForLoading();
        }
    }
    /**
     * Queue all textures for this block type for loading without waiting
     */
    queueTexturesForLoading() {
        Object.values(this._textureUris).forEach((textureUri) => {
            if (!textureUri) return;

            BlockTextureAtlas.instance.queueTextureForLoading(textureUri);

            if (!textureUri.match(/\.(png|jpe?g)$/i)) {

                BlockTextureAtlas.instance.queueTextureForLoading(
                    `${textureUri}.png`
                );

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

                    if (textureUri.startsWith("data:image/")) {
                        await BlockTextureAtlas.instance.loadTexture(
                            textureUri
                        );
                        return;
                    }

                    if (!textureUri.match(/\.(png|jpe?g)$/i)) {

                        try {
                            await BlockTextureAtlas.instance.loadTexture(
                                `${textureUri}.png`
                            );
                        } catch (error) {

                        }

                        const faceMap = {
                            top: "+y.png",
                            bottom: "-y.png",
                            left: "-x.png",
                            right: "+x.png",
                            front: "+z.png",
                            back: "-z.png",
                        };

                        if (faceMap[face]) {
                            try {
                                await BlockTextureAtlas.instance.loadTexture(
                                    `${textureUri}/${faceMap[face]}`
                                );
                            } catch (error) {

                            }
                        }
                    }

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

        if (!this._textureUris || Object.keys(this._textureUris).length === 0) {
            return false;
        }

        for (const [face, textureUri] of Object.entries(this._textureUris)) {
            if (!textureUri) continue;
            const textureAtlas = BlockTextureAtlas.instance;

            if (!textureUri.match(/\.(png|jpe?g)$/i)) {
                const faceMap = {
                    top: "+y.png",
                    bottom: "-y.png",
                    left: "-x.png",
                    right: "+x.png",
                    front: "+z.png",
                    back: "-z.png",
                };

                if (faceMap[face]) {
                    const facePath = `${textureUri}/${faceMap[face]}`;
                    if (!textureAtlas.getTextureMetadata(facePath)) {
                        return true; // Needs preloading
                    }
                }

                const basePaths = [
                    `${textureUri}.png`,
                    `${textureUri}/all.png`,
                    `${textureUri}/default.png`,
                ];

                const anyTextureLoaded = basePaths.some((path) =>
                    textureAtlas.getTextureMetadata(path)
                );
                if (!anyTextureLoaded) {
                    return true; // Needs preloading
                }
            } else {

                if (!textureAtlas.getTextureMetadata(textureUri)) {
                    return true; // Needs preloading
                }
            }
        }

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

        if (!dataUri.startsWith("data:image/")) {
            console.error("Invalid data URI format for custom texture");
            return;
        }
        console.log(
            `Setting custom texture for block type ${this._id} (${this._name})...`
        );

        const textureUris = {};
        const faceNames = Object.keys(BlockFaceAxes);
        faceNames.forEach((face) => {
            textureUris[face] = dataUri;
            console.log(
                `Set texture for face "${face}": ${dataUri.substring(0, 30)}...`
            );
        });

        this._textureUris = textureUris;

        if (!BlockTextureAtlas.instance) {
            console.error("BlockTextureAtlas is not initialized");
            return;
        }

        try {
            console.log(
                `Loading texture from data URI (length: ${dataUri.length})...`
            );

            await BlockTextureAtlas.instance.loadTexture(dataUri);

            console.log(
                `Rebuilding texture atlas after loading custom texture...`
            );
            await BlockTextureAtlas.instance.rebuildTextureAtlas();

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

                await BlockTextureAtlas.instance.loadTextureFromDataURI(
                    dataUri,
                    dataUri
                );

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

        if (this._textureUris && this._textureUris[face]) {
            return this._textureUris[face];
        }

        if (this._textureUri) {

            if (this._textureUri.startsWith("data:image/")) {
                return this._textureUri;
            }

            return this._textureUri;
        }

        return "./assets/blocks/error.png";
    }
    /**
     * Get the texture file path for the blocks of this type
     * @param {string} face - The face of the block to get the texture for
     * @returns {string} - The path to the texture file
     */
    getTexturePath(face) {
        if (!face) face = "front";

        const isCustomBlock =
            !isNaN(parseInt(this._id)) ||
            this._name === "Untitled" ||
            this._name === "test_block";
        if (isCustomBlock) {

            if (typeof window !== "undefined" && window.localStorage) {
                const storageKeys = [
                    `block-texture-${this._id}`,
                    `custom-block-${this._id}`,
                    `datauri-${this._id}`,
                ];
                for (const key of storageKeys) {
                    const storedUri = window.localStorage.getItem(key);
                    if (storedUri && storedUri.startsWith("data:image/")) {

                        return storedUri;
                    }
                }
            }

            if (this._textureUris && this._textureUris[face]) {
                const texturePath = this._textureUris[face];

                if (texturePath && texturePath.startsWith("data:image/")) {
                    return texturePath;
                }
            }


            return "./assets/blocks/error.png";
        }

        if (this._textureUris && this._textureUris[face]) {
            const texturePath = this._textureUris[face];

            if (texturePath.startsWith("data:image/")) {
                return texturePath;
            }

            return texturePath;
        }

        if (this.isMultiSided || this._isMultiTexture) {

            const baseFolder =
                this._textureUri ||
                (this._textureUris && Object.values(this._textureUris)[0]);
            if (baseFolder) {

                if (baseFolder.startsWith("data:image/")) {
                    return baseFolder;
                }

                if (baseFolder.match(/\.(png|jpe?g)$/i)) {
                    return baseFolder;
                }

                const basePath = baseFolder.includes("blocks/")
                    ? baseFolder
                    : `./assets/blocks/${baseFolder}`;

                const faceDir = this.getFaceDirection(face);

                const finalPath = `${basePath}/${faceDir}.png`;
                return finalPath;
            }
        }

        if (this._textureUris) {
            const firstUri = Object.values(this._textureUris)[0];
            if (firstUri) {
                return firstUri;
            }
        }

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

            const faces = ["top", "bottom", "left", "right", "front", "back"];
            faces.forEach((face) => {
                this._textureUris[face] = dataUri;
            });

            if (BlockTextureAtlas.instance) {

                let success =
                    await BlockTextureAtlas.instance.applyDataUriToAllFaces(
                        `${this._id}`,
                        dataUri
                    );

                if (!success) {
                    console.log(
                        `Fallback: Direct loading for block ${this._id}`
                    );
                    await BlockTextureAtlas.instance.loadTextureFromDataURI(
                        dataUri,
                        dataUri
                    );

                    const metadata =
                        BlockTextureAtlas.instance.getTextureMetadata(dataUri);
                    if (metadata) {

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

                if (success || rebuildAtlas) {
                    await BlockTextureAtlas.instance.rebuildTextureAtlas();
                }

                if (typeof window !== "undefined") {
                    const event = new CustomEvent("textureAtlasUpdated", {
                        detail: { textureId: dataUri, blockId: this._id },
                    });
                    window.dispatchEvent(event);

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

        return FACE_NAME_TO_COORD_MAP[face] || face;
    }
}
export default BlockType;
