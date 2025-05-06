import * as THREE from "three";
import BlockMaterial from "./BlockMaterial";

const TEXTURE_IMAGE_PADDING = 2;

export const FACE_NAME_TO_COORD_MAP = {
    top: "+y",
    bottom: "-y",
    left: "-x",
    right: "+x",
    front: "+z",
    back: "-z",
};
export const COORD_TO_FACE_NAME_MAP = {
    "+y": "top",
    "-y": "bottom",
    "-x": "left",
    "+x": "right",
    "+z": "front",
    "-z": "back",
};
/**
 * Manages the texture atlas for blocks
 */
class BlockTextureAtlas {
    constructor() {

        this._textureAtlasCanvas = document.createElement("canvas");
        this._textureAtlasCanvas.width = 512;
        this._textureAtlasCanvas.height = 512;
        this._textureAtlasContext = this._textureAtlasCanvas.getContext("2d");

        this._textureAtlas = new THREE.CanvasTexture(this._textureAtlasCanvas);
        this._textureAtlas.minFilter = THREE.NearestFilter;
        this._textureAtlas.magFilter = THREE.NearestFilter;
        this._textureAtlas.colorSpace = THREE.SRGBColorSpace;

        this._textureAtlasMetadata = new Map();

        this._textureLoadFailures = new Set();
        this._textureLoadLocks = {};

        this._textureUVCache = new Map();

        this._textureLoadQueue = [];
        this._isProcessingQueue = false;

        this._essentialTextures = new Set(["./assets/blocks/error.png"]);

        this._missingTextureWarnings = new Set();

        this._updateTimer = null;
    }
    /**
     * Initialize the texture atlas with required textures
     * @returns {Promise<void>}
     */
    async initialize() {
        console.log("🧊 Initializing BlockTextureAtlas...");
        try {

            await this.loadTexture("./assets/blocks/error.png");

            const multiSidedBlockTypes = ["grass", "dirt", "stone"]; // Add more as needed

            for (const blockType of multiSidedBlockTypes) {
                await this.preloadMultiSidedTextures(blockType);
            }
            console.log("✅ BlockTextureAtlas initialization complete!");
        } catch (error) {
            console.error("❌ Error initializing BlockTextureAtlas:", error);
        }
    }
    /**
     * Get singleton instance
     * @returns {BlockTextureAtlas}
     */
    static get instance() {
        if (!BlockTextureAtlas._instance) {
            BlockTextureAtlas._instance = new BlockTextureAtlas();
            console.log("Created BlockTextureAtlas singleton instance");
        }
        return BlockTextureAtlas._instance;
    }
    /**
     * Get the texture atlas
     * @returns {THREE.CanvasTexture} The texture atlas
     */
    get textureAtlas() {
        return this._textureAtlas;
    }
    /**
     * Get metadata for a texture
     * @param {string} textureUri - The texture URI
     * @returns {Object|undefined} The texture metadata
     */
    getTextureMetadata(textureUri) {
        return this._textureAtlasMetadata.get(textureUri);
    }
    /**
     * Get UV coordinates for a texture
     * @param {string} textureUri - The texture URI or ID (can be a data URI)
     * @param {Array} uvOffset - The UV offset [u, v]
     * @returns {Promise<Array>} The UV coordinates [u, v]
     */
    async getTextureUVCoordinate(textureUri, uvOffset) {
        if (this._essentialTextures.has(textureUri)) {
            await this.loadTexture(textureUri);
        } else {
            this.queueTextureForLoading(textureUri);
        }
        return this.getTextureUVCoordinateSync(textureUri, uvOffset);
    }
    /**
     * Queue a texture for loading without waiting for it to complete
     * @param {string} textureUri - The texture URI to queue
     */
    queueTextureForLoading(textureUri) {
        if (
            this._textureAtlasMetadata.has(textureUri) ||
            this._textureLoadLocks[textureUri] ||
            this._textureLoadFailures.has(textureUri)
        ) {
            return;
        }
        if (!this._textureLoadQueue.includes(textureUri)) {
            this._textureLoadQueue.push(textureUri);
        }
        if (!this._isProcessingQueue) {
            this._processTextureLoadQueue();
        }
    }
    /**
     * Process the texture load queue asynchronously
     * @private
     */
    async _processTextureLoadQueue() {
        if (this._isProcessingQueue || this._textureLoadQueue.length === 0)
            return;
        this._isProcessingQueue = true;
        try {
            while (this._textureLoadQueue.length > 0) {
                const textureUri = this._textureLoadQueue.shift();
                if (
                    this._textureAtlasMetadata.has(textureUri) ||
                    this._textureLoadLocks[textureUri] ||
                    this._textureLoadFailures.has(textureUri)
                ) {
                    continue;
                }
                try {
                    await this.loadTexture(textureUri);
                } catch (error) {

                }
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        } finally {
            this._isProcessingQueue = false;
        }
    }
    /**
     * Get UV coordinates for a texture (synchronous version)
     * @param {string} textureUri - The texture URI or ID (can be a data URI)
     * @param {Array} uvOffset - The UV offset [u, v]
     * @returns {Array} The UV coordinates [u, v]
     */
    getTextureUVCoordinateSync(textureUri, uvOffset) {
        if (!textureUri) {
            const errorMetadata = this._textureAtlasMetadata.get(
                "./assets/blocks/error.png"
            );
            return errorMetadata
                ? this._calculateUVCoordinates(errorMetadata, uvOffset)
                : [0, 0];
        }
        const cacheKey = `${textureUri}-${uvOffset[0]}-${uvOffset[1]}`;
        if (this._textureUVCache.has(cacheKey))
            return this._textureUVCache.get(cacheKey);
        const metadata = this._textureAtlasMetadata.get(textureUri);
        if (metadata) {
            const result = this._calculateUVCoordinates(metadata, uvOffset);
            this._textureUVCache.set(cacheKey, result);
            return result;
        }

        const blockFacePattern = /blocks\/([^\/]+)(?:\/([^\/]+))?$/;
        const blockFaceMatch = textureUri.match(blockFacePattern);
        if (blockFaceMatch) {
            const [, blockType, facePart] = blockFaceMatch;
            if (!facePart) {
                const basePath = `blocks/${blockType}`;
                const baseMetadata = this._textureAtlasMetadata.get(basePath);
                if (baseMetadata) {
                    const result = this._calculateUVCoordinates(
                        baseMetadata,
                        uvOffset
                    );
                    this._textureUVCache.set(cacheKey, result);
                    return result;
                }
            } else {
                let face = facePart.replace(/\.(png|jpe?g)$/, "");
                if (FACE_NAME_TO_COORD_MAP[face])
                    face = FACE_NAME_TO_COORD_MAP[face];
                const facePath = `blocks/${blockType}/${face}.png`;
                const faceMetadata = this._textureAtlasMetadata.get(facePath);
                if (faceMetadata) {
                    const result = this._calculateUVCoordinates(
                        faceMetadata,
                        uvOffset
                    );
                    this._textureUVCache.set(cacheKey, result);
                    return result;
                }
            }
        }
        this.queueTextureForLoading(textureUri);
        const errorMetadata = this._textureAtlasMetadata.get(
            "./assets/blocks/error.png"
        );
        return errorMetadata
            ? this._calculateUVCoordinates(errorMetadata, uvOffset)
            : [0, 0];
    }
    /**
     * Load a texture into the atlas
     * @param {string} textureUri - The texture URI (file path or data URI)
     * @returns {Promise<void>}
     */
    async loadTexture(textureUri) {
        if (!textureUri) return;
        const isDataUri = textureUri.startsWith("data:image/");
        if (isDataUri) {
            await this.loadTextureFromDataURI(textureUri, textureUri);
            return;
        }
        const normalizedPath = textureUri.startsWith("./assets")
            ? textureUri
            : `./assets/${textureUri}`;
        const alternativePath = textureUri.startsWith("./assets")
            ? textureUri.slice(9)
            : textureUri;
        if (
            this._textureAtlasMetadata.has(textureUri) ||
            this._textureAtlasMetadata.has(normalizedPath) ||
            this._textureAtlasMetadata.has(alternativePath)
        ) {
            return;
        }
        const isSingleTextureFile = textureUri.match(
            /\/blocks\/([^\/]+\.(png|jpe?g))$/
        );
        const multiSidedBlockMatch = textureUri.match(
            /\/blocks\/([^\/]+)(?:\/|$)/
        );
        if (isSingleTextureFile) {
            await this._loadTextureDirectly(textureUri);
        } else if (
            multiSidedBlockMatch &&
            !textureUri.match(/[\+\-][xyz]\.png$/)
        ) {
            const blockType = multiSidedBlockMatch[1];
            await this.preloadMultiSidedTextures(blockType);
        } else {
            if (!textureUri.match(/\.(png|jpe?g)$/i) && !isDataUri) {
                const fallbackPath = `${textureUri}.png`;
                try {
                    await this._loadTextureDirectly(fallbackPath);
                    return;
                } catch (error) {

                }
            }
            await this._loadTextureDirectly(textureUri);
        }
    }
    /**
     * Schedule a batched atlas update
     * @private
     */
    _scheduleAtlasUpdate() {
        if (this._updateTimer) clearTimeout(this._updateTimer);
        this._updateTimer = setTimeout(() => {
            this._textureAtlas.needsUpdate = true;
            BlockMaterial.instance.setTextureAtlas(this._textureAtlas);
            this._updateTimer = null;
        }, 50);
    }
    /**
     * Draw a texture to the texture atlas
     * @param {THREE.Texture} texture - The texture
     * @param {string} debugPath - Debug path for the texture
     * @param {boolean} updateAtlas - Whether to update the atlas after drawing
     * @returns {Object} The texture metadata
     * @private
     */
    _drawTextureToAtlas(texture, debugPath, updateAtlas = true) {
        if (!this._textureAtlasContext)
            throw new Error("Texture atlas context not found!");
        const canvasWidth = this._textureAtlasCanvas.width;
        const canvasHeight = this._textureAtlasCanvas.height;
        const imageWidth = texture.image.width;
        const imageHeight = texture.image.height;
        const tileWidth = imageWidth + TEXTURE_IMAGE_PADDING * 2;
        const tileHeight = imageHeight + TEXTURE_IMAGE_PADDING * 2;
        const metadata = {
            x: 0,
            invertedY: 0,
            width: tileWidth,
            height: tileHeight,
            isTransparent: this._textureIsTransparent(texture),
            debugPath: debugPath,
        };
        let foundSpace = false;
        const existingTextures = Array.from(
            this._textureAtlasMetadata.values()
        );
        for (let y = 0; y <= canvasHeight - tileHeight && !foundSpace; y++) {
            for (let x = 0; x <= canvasWidth - tileWidth; x++) {
                const hasOverlap = existingTextures.some(
                    (existing) =>
                        x < existing.x + existing.width &&
                        x + tileWidth > existing.x &&
                        y < existing.invertedY + existing.height &&
                        y + tileHeight > existing.invertedY
                );
                if (!hasOverlap) {
                    metadata.x = x;
                    metadata.invertedY = y;
                    foundSpace = true;
                    break;
                }
            }
        }
        if (!foundSpace) {
            const tempCanvas = document.createElement("canvas");
            const tempContext = tempCanvas.getContext("2d");
            if (!tempContext)
                throw new Error("Failed to create temporary context");
            tempCanvas.width = canvasWidth;
            tempCanvas.height = canvasHeight;
            tempContext.drawImage(this._textureAtlasCanvas, 0, 0);
            if (canvasWidth <= canvasHeight) {
                this._textureAtlasCanvas.width = canvasWidth * 2;
                metadata.x = canvasWidth;
                metadata.invertedY = 0;
            } else {
                this._textureAtlasCanvas.height = canvasHeight * 2;
                metadata.x = 0;
                metadata.invertedY = canvasHeight;
            }
            this._textureAtlasContext.drawImage(tempCanvas, 0, 0);
            this._textureAtlas.dispose();
            this._textureAtlas = new THREE.CanvasTexture(
                this._textureAtlasCanvas
            );
            this._textureAtlas.minFilter = THREE.NearestFilter;
            this._textureAtlas.magFilter = THREE.NearestFilter;
            this._textureAtlas.colorSpace = THREE.SRGBColorSpace;
        }

        this._textureAtlasContext.drawImage(
            texture.image,
            0,
            0,
            imageWidth,
            imageHeight,
            metadata.x + TEXTURE_IMAGE_PADDING,
            metadata.invertedY + TEXTURE_IMAGE_PADDING,
            imageWidth,
            imageHeight
        );

        this._textureAtlasContext.drawImage(
            texture.image,
            0,
            0,
            imageWidth,
            1,
            metadata.x + TEXTURE_IMAGE_PADDING,
            metadata.invertedY,
            imageWidth,
            TEXTURE_IMAGE_PADDING
        );

        this._textureAtlasContext.drawImage(
            texture.image,
            0,
            imageHeight - 1,
            imageWidth,
            1,
            metadata.x + TEXTURE_IMAGE_PADDING,
            metadata.invertedY + TEXTURE_IMAGE_PADDING + imageHeight,
            imageWidth,
            TEXTURE_IMAGE_PADDING
        );

        this._textureAtlasContext.drawImage(
            texture.image,
            0,
            0,
            1,
            imageHeight,
            metadata.x,
            metadata.invertedY + TEXTURE_IMAGE_PADDING,
            TEXTURE_IMAGE_PADDING,
            imageHeight
        );

        this._textureAtlasContext.drawImage(
            texture.image,
            imageWidth - 1,
            0,
            1,
            imageHeight,
            metadata.x + TEXTURE_IMAGE_PADDING + imageWidth,
            metadata.invertedY + TEXTURE_IMAGE_PADDING,
            TEXTURE_IMAGE_PADDING,
            imageHeight
        );

        this._textureAtlasContext.drawImage(
            texture.image,
            0,
            0,
            1,
            1,
            metadata.x,
            metadata.invertedY,
            TEXTURE_IMAGE_PADDING,
            TEXTURE_IMAGE_PADDING
        );
        this._textureAtlasContext.drawImage(
            texture.image,
            imageWidth - 1,
            0,
            1,
            1,
            metadata.x + TEXTURE_IMAGE_PADDING + imageWidth,
            metadata.invertedY,
            TEXTURE_IMAGE_PADDING,
            TEXTURE_IMAGE_PADDING
        );
        this._textureAtlasContext.drawImage(
            texture.image,
            0,
            imageHeight - 1,
            1,
            1,
            metadata.x,
            metadata.invertedY + TEXTURE_IMAGE_PADDING + imageHeight,
            TEXTURE_IMAGE_PADDING,
            TEXTURE_IMAGE_PADDING
        );
        this._textureAtlasContext.drawImage(
            texture.image,
            imageWidth - 1,
            imageHeight - 1,
            1,
            1,
            metadata.x + TEXTURE_IMAGE_PADDING + imageWidth,
            metadata.invertedY + TEXTURE_IMAGE_PADDING + imageHeight,
            TEXTURE_IMAGE_PADDING,
            TEXTURE_IMAGE_PADDING
        );
        const u = metadata.x / canvasWidth;
        const v = metadata.invertedY / canvasHeight;
        const uWidth = tileWidth / canvasWidth;
        const vHeight = tileHeight / canvasHeight;
        metadata.uv = { u, v, uWidth, vHeight };
        if (updateAtlas) this._scheduleAtlasUpdate();
        return metadata;
    }
    /**
     * Check if a texture has transparency
     * @param {THREE.Texture|HTMLCanvasElement} input - The texture or canvas to check
     * @returns {boolean} True if the texture has transparency
     * @private
     */
    _textureIsTransparent(input) {
        let canvas, width, height;
        if (input instanceof HTMLCanvasElement) {
            canvas = input;
            width = canvas.width;
            height = canvas.height;
        } else if (input && input.image) {
            canvas = document.createElement("canvas");
            width = input.image.width;
            height = input.image.height;
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Failed to create temporary context");
            context.drawImage(input.image, 0, 0);
        } else {
            console.warn(
                "Invalid input to _textureIsTransparent, returning false"
            );
            return false;
        }
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Failed to get context from canvas");
        try {
            const imageData = context.getImageData(0, 0, width, height);
            const data = imageData.data;
            for (let i = 3; i < data.length; i += 4) {
                if (data[i] < 255) return true;
            }
        } catch (error) {
            console.warn("Error checking texture transparency:", error);
            return false;
        }
        return false;
    }
    /**
     * Mark a texture as essential for initialization
     * @param {string} textureUri - The texture URI to mark as essential
     */
    markTextureAsEssential(textureUri) {
        this._essentialTextures.add(textureUri);
    }
    /**
     * Clear the texture UV coordinate cache
     */
    clearTextureUVCache() {
        console.log("Clearing texture UV coordinate cache");
        this._textureUVCache.clear();
    }
    /**
     * Rebuild the texture atlas completely
     * @returns {Promise<void>}
     */
    async rebuildTextureAtlas() {
        console.log("Rebuilding texture atlas...");
        this._textureAtlas.needsUpdate = true;
        BlockMaterial.instance.setTextureAtlas(this._textureAtlas);
        this.clearTextureUVCache();
        console.log("Texture atlas rebuilt successfully");
    }
    /**
     * Preload multi-sided block textures
     * @param {string} blockType - The block type to preload (e.g., 'grass', 'wood')
     * @returns {Promise<boolean>} True if preloading was successful
     */
    async preloadMultiSidedTextures(blockType) {
        const isSingleTexture =
            blockType.endsWith(".png") ||
            blockType.endsWith(".jpg") ||
            blockType.endsWith(".jpeg");
        let texturePaths = [];
        if (isSingleTexture) {
            const baseTexturePath = `./assets/blocks/${blockType}`;
            if (this._textureAtlasMetadata.has(baseTexturePath)) return true;
            texturePaths = [baseTexturePath];
        } else {
            texturePaths = Object.values(FACE_NAME_TO_COORD_MAP).map(
                (coord) => `./assets/blocks/${blockType}/${coord}.png`
            );
        }

        Array.from(this._textureAtlasMetadata.keys())
            .filter((key) => key.includes(blockType))
            .forEach((key) => this._textureAtlasMetadata.delete(key));
        Array.from(this._textureUVCache.keys())
            .filter((key) => key.includes(blockType))
            .forEach((key) => this._textureUVCache.delete(key));
        Array.from(this._textureLoadFailures)
            .filter((path) => path.includes(blockType))
            .forEach((path) => this._textureLoadFailures.delete(path));

        const loadPromises = texturePaths.map((path) =>
            this._loadTextureDirectly(path).catch(() => null)
        );
        await Promise.all(loadPromises);
        const loadedTextures = loadPromises.filter((p) => p !== null).length;
        if (loadedTextures > 0) {
            this._scheduleAtlasUpdate();
            return true;
        }
        return false;
    }
    /**
     * Get UV coordinates for a multi-sided block texture
     * @param {string} blockType - The block type name (e.g., 'grass', 'wood')
     * @param {string} blockFace - The block face (top, bottom, left, right, front, back)
     * @param {Array} uvOffset - The UV offset [u, v]
     * @returns {Array} The UV coordinates [u, v]
     */
    getMultiSidedTextureUV(blockType, blockFace, uvOffset) {
        if (!blockType || !blockFace) {

            const errorMetadata = this._textureAtlasMetadata.get(
                "./assets/blocks/error.png"
            );
            return errorMetadata
                ? this._calculateUVCoordinates(errorMetadata, uvOffset)
                : [0, 0];
        }

        const faceCoord = FACE_NAME_TO_COORD_MAP[blockFace] || blockFace;

        if (blockType.startsWith("data:image/")) {
            const metadata = this._textureAtlasMetadata.get(blockType);
            if (metadata) {
                return this._calculateUVCoordinates(metadata, uvOffset);
            }
        }

        const facePath = `blocks/${blockType}/${faceCoord}.png`;
        const faceMetadata = this._textureAtlasMetadata.get(facePath);
        if (faceMetadata) {
            return this._calculateUVCoordinates(faceMetadata, uvOffset);
        }


        const blockTypePath = `blocks/${blockType}`;
        const blockTypeMetadata = this._textureAtlasMetadata.get(blockTypePath);
        if (blockTypeMetadata) {
            return this._calculateUVCoordinates(blockTypeMetadata, uvOffset);
        }

        const warningKey = `${blockType}-${blockFace}`;
        if (!this._missingTextureWarnings.has(warningKey)) {
            console.warn(
                `No texture found for ${blockType}, face ${blockFace}. Queuing for loading.`
            );
            this._missingTextureWarnings.add(warningKey);

            this.queueTextureForLoading(
                `./assets/blocks/${blockType}/${faceCoord}.png`
            );
            this.queueTextureForLoading(`./assets/blocks/${blockType}.png`);
        }

        const errorMetadata = this._textureAtlasMetadata.get(
            "./assets/blocks/error.png"
        );
        return errorMetadata
            ? this._calculateUVCoordinates(errorMetadata, uvOffset)
            : [0, 0];
    }
    /**
     * Load a texture from a data URI directly
     * @param {string} dataUri - The data URI of the texture
     * @param {string} textureId - The ID to use for the texture in the atlas
     * @param {boolean} dispatchUpdateEvent - Whether to dispatch an update event (default: false)
     * @returns {Promise<void>}
     */
    async loadTextureFromDataURI(
        dataUri,
        textureId,
        dispatchUpdateEvent = false
    ) {
        if (this._textureAtlasMetadata.has(textureId)) return;
        if (this._textureLoadLocks[textureId])
            return await this._textureLoadLocks[textureId];
        if (this._textureLoadFailures.has(textureId)) {
            console.warn(
                `Texture ${textureId} previously failed to load, skipping.`
            );
            return;
        }
        this._textureLoadLocks[textureId] = new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                try {
                    const tempCanvas = document.createElement("canvas");
                    tempCanvas.width = img.width;
                    tempCanvas.height = img.height;
                    const ctx = tempCanvas.getContext("2d");
                    if (!ctx)
                        throw new Error(
                            "Failed to create temporary canvas context"
                        );
                    ctx.drawImage(img, 0, 0);
                    const texture = new THREE.CanvasTexture(tempCanvas);
                    texture.magFilter = THREE.NearestFilter;
                    texture.minFilter = THREE.NearestFilter;
                    texture.colorSpace = THREE.SRGBColorSpace;
                    texture.needsUpdate = true;
                    texture.flipY = false;
                    const metadata = this._drawTextureToAtlas(
                        texture,
                        textureId,
                        false
                    );
                    this._textureAtlasMetadata.set(textureId, metadata);
                    this._textureAtlasMetadata.set(
                        `custom:${textureId}`,
                        metadata
                    );
                    this._scheduleAtlasUpdate();
                    BlockMaterial.instance.setTextureAtlas(this._textureAtlas);
                    if (
                        dispatchUpdateEvent &&
                        typeof window !== "undefined" &&
                        window.dispatchEvent
                    ) {
                        const event = new CustomEvent("textureAtlasUpdated", {
                            detail: {
                                textureId,
                                atlasTexture: this._textureAtlas,
                            },
                        });
                        window.dispatchEvent(event);
                    }
                    delete this._textureLoadLocks[textureId];
                    resolve();
                } catch (error) {
                    console.error(
                        `Error processing loaded image for ${textureId}:`,
                        error
                    );
                    this._textureLoadFailures.add(textureId);
                    delete this._textureLoadLocks[textureId];
                    reject(error);
                }
            };
            img.onerror = (error) => {
                console.error(
                    `Failed to load image from data URI for ${textureId}:`,
                    error
                );
                this._textureLoadFailures.add(textureId);
                const errorTexture = this._textureAtlasMetadata.get(
                    "./assets/blocks/error.png"
                );
                if (errorTexture) {
                    console.warn(
                        `Using error texture as fallback for ${textureId}`
                    );
                    this._textureAtlasMetadata.set(textureId, errorTexture);
                    delete this._textureLoadLocks[textureId];
                    resolve();
                } else {
                    delete this._textureLoadLocks[textureId];
                    reject(
                        new Error(
                            `No fallback error texture available for ${textureId}`
                        )
                    );
                }
            };
            img.src = dataUri;
        });
        return this._textureLoadLocks[textureId];
    }
    /**
     * Calculate UV coordinates from metadata
     * @param {Object} metadata - The texture metadata
     * @param {Array} uvOffset - The UV offset [u, v]
     * @returns {Array} The UV coordinates [u, v]
     * @private
     */
    _calculateUVCoordinates(metadata, uvOffset) {
        const atlasWidth = this._textureAtlasCanvas.width;
        const atlasHeight = this._textureAtlasCanvas.height;
        const imageX = metadata.x + TEXTURE_IMAGE_PADDING;
        const imageInvertedY = metadata.invertedY + TEXTURE_IMAGE_PADDING;
        const tileWidth = metadata.width - TEXTURE_IMAGE_PADDING * 2;
        const tileHeight = metadata.height - TEXTURE_IMAGE_PADDING * 2;
        const u = (imageX + uvOffset[0] * tileWidth) / atlasWidth;
        const v =
            (atlasHeight - imageInvertedY - (1 - uvOffset[1]) * tileHeight) /
            atlasHeight;
        return [u, v];
    }
    /**
     * Parse texture URI into components
     * @param {string} textureUri
     * @returns {Object} { basePath, faceCoord, isFaceTexture, blockType }
     * @private
     */
    _parseTextureUri(textureUri) {
        const facePattern = /^(.*?)[\\/]([\+\-][xyz])\.png$/;
        const faceMatch = textureUri.match(facePattern);
        if (faceMatch) {
            const [, basePath, faceCoord] = faceMatch;
            const blockTypeMatch = basePath.match(
                /^\.\/assets\/blocks\/([^\/]+)$/
            );
            return {
                basePath,
                faceCoord,
                isFaceTexture: true,
                blockType: blockTypeMatch ? blockTypeMatch[1] : null,
            };
        }
        const plainTextureMatch = textureUri.match(
            /^\.\/assets\/blocks\/([^\/]+\.(png|jpe?g))$/
        );
        if (plainTextureMatch) {
            const [, fileName] = plainTextureMatch;
            const blockType = fileName.replace(/\.(png|jpe?g)$/, "");
            return {
                basePath: textureUri,
                faceCoord: null,
                isFaceTexture: false,
                blockType,
            };
        }
        return {
            basePath: textureUri,
            faceCoord: null,
            isFaceTexture: false,
            blockType: null,
        };
    }
    /**
     * Load a texture directly using THREE.TextureLoader
     * @param {string} textureUri - The texture URI to load
     * @returns {Promise<void>} - A promise that resolves when the texture is loaded
     * @private
     */
    async _loadTextureDirectly(textureUri) {
        if (this._textureLoadLocks[textureUri])
            return await this._textureLoadLocks[textureUri];
        if (this._textureLoadFailures.has(textureUri))
            throw new Error(`Texture previously failed to load: ${textureUri}`);


        if (
            textureUri.includes("/Untitled/") ||
            textureUri.includes("/Untitled.") ||
            textureUri.includes("/test_block/") ||
            textureUri.includes("/test-block/")
        ) {

            const errorMetadata = this._textureAtlasMetadata.get(
                "./assets/blocks/error.png"
            );
            if (errorMetadata) {
                this._textureAtlasMetadata.set(textureUri, errorMetadata);
                return;
            }
            throw new Error(
                `Cannot load texture for custom block path: ${textureUri}`
            );
        }
        const loadPromise = new Promise((resolve, reject) => {
            const textureLoader = new THREE.TextureLoader();
            textureLoader.load(
                textureUri,
                (texture) => {
                    if (!texture.image)
                        return reject(
                            new Error(
                                `Failed to load texture image for URI: ${textureUri}`
                            )
                        );
                    const metadata = this._drawTextureToAtlas(
                        texture,
                        textureUri,
                        false
                    );
                    this._textureAtlasMetadata.set(textureUri, metadata);
                    const { basePath, faceCoord, isFaceTexture, blockType } =
                        this._parseTextureUri(textureUri);
                    const normalizedUri = basePath.startsWith("./assets/")
                        ? basePath.slice(9)
                        : basePath;
                    if (normalizedUri !== textureUri)
                        this._textureAtlasMetadata.set(normalizedUri, metadata);
                    if (isFaceTexture && faceCoord && blockType) {
                        const faceName = COORD_TO_FACE_NAME_MAP[faceCoord];
                        this._textureAtlasMetadata.set(
                            `blocks/${blockType}/${faceCoord}.png`,
                            metadata
                        );
                        if (faceCoord === "+y")
                            this._textureAtlasMetadata.set(
                                `blocks/${blockType}`,
                                metadata
                            );
                    } else if (blockType) {
                        this._textureAtlasMetadata.set(
                            `blocks/${blockType}`,
                            metadata
                        );
                        Object.values(FACE_NAME_TO_COORD_MAP).forEach(
                            (coord) => {
                                this._textureAtlasMetadata.set(
                                    `blocks/${blockType}/${coord}.png`,
                                    metadata
                                );
                            }
                        );
                    }
                    this._scheduleAtlasUpdate();
                    resolve(texture);
                },
                undefined,
                (error) => {
                    console.error(
                        `Failed to load texture: ${textureUri}`,
                        error
                    );
                    const errorMetadata = this._textureAtlasMetadata.get(
                        "./assets/blocks/error.png"
                    );
                    if (errorMetadata) {
                        this._textureAtlasMetadata.set(
                            textureUri,
                            errorMetadata
                        );
                        this._scheduleAtlasUpdate();
                        resolve();
                    } else {
                        this._textureLoadFailures.add(textureUri);
                        reject(error);
                    }
                }
            );
        });
        this._textureLoadLocks[textureUri] = loadPromise;
        try {
            return await loadPromise;
        } finally {
            delete this._textureLoadLocks[textureUri];
        }
    }
    /**
     * Apply a texture from a data URI to all faces of a block type
     * @param {string} blockType - The block type name
     * @param {string} dataUri - The data URI containing the texture
     * @returns {Promise<boolean>} Whether the application was successful
     */
    async applyDataUriToAllFaces(blockType, dataUri) {
        if (!blockType || !dataUri || !dataUri.startsWith("data:image/")) {
            console.warn("Invalid block type or data URI");
            return false;
        }
        try {

            await this.loadTextureFromDataURI(dataUri, dataUri);

            const metadata = this._textureAtlasMetadata.get(dataUri);
            if (!metadata) {
                console.warn(
                    `Failed to load texture from data URI for ${blockType}`
                );
                return false;
            }

            const isNumericBlockType = !isNaN(parseInt(blockType));
            if (isNumericBlockType) {

                this._textureAtlasMetadata.set(blockType, metadata);

                this._textureAtlasMetadata.set(`${blockType}`, metadata);
            }

            this._textureAtlasMetadata.set(blockType, metadata);
            this._textureAtlasMetadata.set(`custom:${blockType}`, metadata);
            this._textureAtlasMetadata.set(`blocks/${blockType}`, metadata);

            Object.values(FACE_NAME_TO_COORD_MAP).forEach((coord) => {
                this._textureAtlasMetadata.set(
                    `blocks/${blockType}/${coord}.png`,
                    metadata
                );
            });

            if (
                blockType === "test_block" ||
                blockType === "test-block" ||
                blockType === "Untitled"
            ) {
                this._textureAtlasMetadata.set("test_block", metadata);
                this._textureAtlasMetadata.set("test-block", metadata);
                this._textureAtlasMetadata.set("Untitled", metadata);

                Object.values(FACE_NAME_TO_COORD_MAP).forEach((coord) => {
                    this._textureAtlasMetadata.set(
                        `blocks/test_block/${coord}.png`,
                        metadata
                    );
                    this._textureAtlasMetadata.set(
                        `blocks/test-block/${coord}.png`,
                        metadata
                    );
                    this._textureAtlasMetadata.set(
                        `blocks/Untitled/${coord}.png`,
                        metadata
                    );
                });
            }

            this._mapBlockIdToTexture(blockType, dataUri, metadata);

            Array.from(this._missingTextureWarnings)
                .filter((key) => key.startsWith(`${blockType}-`))
                .forEach((key) => this._missingTextureWarnings.delete(key));

            this._scheduleAtlasUpdate();
            return true;
        } catch (error) {
            console.error(
                `Error applying data URI texture to block ${blockType}:`,
                error
            );
            return false;
        }
    }
    /**
     * Create a direct mapping between a block ID and its texture
     * @param {string|number} blockId - The block ID
     * @param {string} dataUri - The data URI of the texture
     * @param {Object} metadata - The texture metadata
     * @private
     */
    _mapBlockIdToTexture(blockId, dataUri, metadata) {
        if (!blockId || !dataUri || !metadata) return;
        try {


            this._textureAtlasMetadata.set(blockId, metadata);

            if (
                blockId === "test_block" ||
                blockId === "test-block" ||
                blockId === "Untitled"
            ) {

                this._textureAtlasMetadata.set("test_block", metadata);
                this._textureAtlasMetadata.set("test-block", metadata);
                this._textureAtlasMetadata.set("Untitled", metadata);

                Object.values(FACE_NAME_TO_COORD_MAP).forEach((coord) => {
                    this._textureAtlasMetadata.set(
                        `blocks/test_block/${coord}.png`,
                        metadata
                    );
                    this._textureAtlasMetadata.set(
                        `blocks/test-block/${coord}.png`,
                        metadata
                    );
                    this._textureAtlasMetadata.set(
                        `blocks/Untitled/${coord}.png`,
                        metadata
                    );
                });
            }

            if (typeof blockId === "number" || !isNaN(parseInt(blockId))) {

                this._textureAtlasMetadata.set(`${blockId}`, metadata);

                this._textureAtlasMetadata.set(`custom:${blockId}`, metadata);

                this._textureAtlasMetadata.set(`blocks/${blockId}`, metadata);

                Object.values(FACE_NAME_TO_COORD_MAP).forEach((coord) => {
                    this._textureAtlasMetadata.set(
                        `blocks/${blockId}/${coord}.png`,
                        metadata
                    );
                });
            }

            const storageKeys = [
                `block-texture-${blockId}`,
                `custom-block-${blockId}`,
                `datauri-${blockId}`,
            ];
            if (typeof window !== "undefined" && window.localStorage) {
                try {

                    storageKeys.forEach((key) => {
                        window.localStorage.setItem(key, dataUri);
                    });
                } catch (e) {

                    console.warn("Failed to store texture in localStorage:", e);
                }
            }
            console.log(`Created mapping for block ID ${blockId} to texture`);
        } catch (error) {
            console.warn(`Error mapping block ID to texture: ${error.message}`);
        }
    }
}

BlockTextureAtlas._instance = null;
export default BlockTextureAtlas;
