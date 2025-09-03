import * as THREE from "three";
import { TextureCompression } from "../utils/TextureCompression";
import BlockMaterial from "./BlockMaterial";

const TEXTURE_SIZE = 16; // Standard block texture size
const TEXTURE_ARRAY_DEPTH = 512; // Maximum textures in array

/**
 * Enhanced BlockTextureAtlas that uses WebGL2 texture arrays and compression
 */
export class EnhancedBlockTextureAtlas {
    private static _instance: EnhancedBlockTextureAtlas | null = null;

    // Traditional atlas fallback
    private _textureAtlasCanvas: HTMLCanvasElement;
    private _textureAtlasContext: CanvasRenderingContext2D;
    private _textureAtlas: THREE.CanvasTexture;

    // WebGL2 texture array
    private _textureArray: THREE.DataArrayTexture | null = null;
    private _textureArrayLayers: Map<string, number> = new Map();
    private _nextLayerIndex: number = 0;

    // Metadata and caching
    private _textureAtlasMetadata: Map<string, any> = new Map();
    private _textureUVCache: Map<string, Float32Array> = new Map();
    private _textureLoadQueue: string[] = [];
    private _textureLoadLocks: Record<string, boolean> = {};
    private _textureLoadFailures: Set<string> = new Set();
    private _isProcessingQueue: boolean = false;

    // Configuration
    private _useTextureArrays: boolean = false;
    private _textureArraySize: number = 512;
    private _essentialTextures: Set<string> = new Set([
        "./assets/blocks/error.png",
    ]);

    private constructor() {
        this._initializeAtlas();
        this._initializeTextureArray();
    }

    static get instance(): EnhancedBlockTextureAtlas {
        if (!EnhancedBlockTextureAtlas._instance) {
            EnhancedBlockTextureAtlas._instance =
                new EnhancedBlockTextureAtlas();
        }
        return EnhancedBlockTextureAtlas._instance;
    }

    /**
     * Initialize the traditional texture atlas for fallback
     */
    private _initializeAtlas(): void {
        this._textureAtlasCanvas = document.createElement("canvas");
        this._textureAtlasCanvas.width = this._textureArraySize;
        this._textureAtlasCanvas.height = this._textureArraySize;
        this._textureAtlasContext = this._textureAtlasCanvas.getContext("2d")!;

        this._textureAtlas = new THREE.CanvasTexture(this._textureAtlasCanvas);
        this._textureAtlas = BlockMaterial.instance.optimizeTexture(
            this._textureAtlas
        ) as THREE.CanvasTexture;
        this._textureAtlas.colorSpace = THREE.SRGBColorSpace;
        this._textureAtlas.needsUpdate = true;
    }

    /**
     * Initialize WebGL2 texture array if supported
     */
    private _initializeTextureArray(): void {
        if (!TextureCompression.instance.supportsTextureArrays()) {
            console.log(
                "WebGL2 texture arrays not supported, using traditional atlas"
            );
            this._useTextureArrays = false;
            return;
        }

        try {
            this._textureArray = TextureCompression.instance.createTextureArray(
                {
                    width: TEXTURE_SIZE,
                    height: TEXTURE_SIZE,
                    depth: TEXTURE_ARRAY_DEPTH,
                    format: THREE.RGBAFormat,
                    type: THREE.UnsignedByteType,
                    generateMipmaps: true,
                }
            );

            if (this._textureArray) {
                this._useTextureArrays = true;
                console.log("✅ WebGL2 texture array initialized successfully");
            } else {
                console.warn(
                    "Failed to create WebGL2 texture array, falling back to traditional atlas"
                );
                this._useTextureArrays = false;
            }
        } catch (error) {
            console.error("Error initializing texture array:", error);
            this._useTextureArrays = false;
        }
    }

    /**
     * Get the appropriate texture (array or atlas) for rendering
     */
    get textureAtlas(): THREE.Texture {
        return this._useTextureArrays && this._textureArray
            ? this._textureArray
            : this._textureAtlas;
    }

    /**
     * Get whether texture arrays are being used
     */
    get isUsingTextureArrays(): boolean {
        return this._useTextureArrays;
    }

    /**
     * Load a texture into the atlas or texture array
     */
    async loadTexture(textureUri: string): Promise<boolean> {
        if (this._textureLoadLocks[textureUri]) {
            return new Promise((resolve) => {
                const checkLock = () => {
                    if (!this._textureLoadLocks[textureUri]) {
                        resolve(this._textureAtlasMetadata.has(textureUri));
                    } else {
                        setTimeout(checkLock, 10);
                    }
                };
                checkLock();
            });
        }

        if (this._textureAtlasMetadata.has(textureUri)) {
            return true;
        }

        if (this._textureLoadFailures.has(textureUri)) {
            return false;
        }

        this._textureLoadLocks[textureUri] = true;

        try {
            const image = await this._loadImage(textureUri);

            if (this._useTextureArrays && this._textureArray) {
                return await this._addTextureToArray(textureUri, image);
            } else {
                return await this._addTextureToAtlas(textureUri, image);
            }
        } catch (error) {
            console.error(`Failed to load texture ${textureUri}:`, error);
            this._textureLoadFailures.add(textureUri);
            return false;
        } finally {
            delete this._textureLoadLocks[textureUri];
        }
    }

    /**
     * Add texture to WebGL2 texture array
     */
    private async _addTextureToArray(
        textureUri: string,
        image: HTMLImageElement
    ): Promise<boolean> {
        if (
            !this._textureArray ||
            this._nextLayerIndex >= TEXTURE_ARRAY_DEPTH
        ) {
            console.warn(
                "Texture array full or not available, cannot add texture"
            );
            return false;
        }

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        if (!ctx) {
            console.error("Could not create 2D context for texture processing");
            return false;
        }

        // Resize image to standard texture size
        canvas.width = TEXTURE_SIZE;
        canvas.height = TEXTURE_SIZE;
        ctx.drawImage(image, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

        const success = TextureCompression.instance.addTextureToArray(
            this._textureArray,
            canvas,
            this._nextLayerIndex
        );

        if (success) {
            this._textureArrayLayers.set(textureUri, this._nextLayerIndex);
            this._textureAtlasMetadata.set(textureUri, {
                layer: this._nextLayerIndex,
                u: 0,
                v: 0,
                width: 1,
                height: 1,
                textureSize: TEXTURE_SIZE,
                isTextureArray: true,
            });
            this._nextLayerIndex++;
            console.log(
                `Added texture ${textureUri} to layer ${
                    this._nextLayerIndex - 1
                }`
            );
        }

        return success;
    }

    /**
     * Add texture to traditional atlas (fallback)
     */
    private async _addTextureToAtlas(
        textureUri: string,
        image: HTMLImageElement
    ): Promise<boolean> {
        // Find available position in atlas
        const position = this._findAtlasPosition();
        if (!position) {
            console.warn("Atlas full, cannot add more textures");
            return false;
        }

        // Draw texture to atlas
        this._textureAtlasContext.drawImage(
            image,
            position.x,
            position.y,
            position.width,
            position.height
        );

        // Store metadata
        this._textureAtlasMetadata.set(textureUri, {
            x: position.x,
            y: position.y,
            width: position.width,
            height: position.height,
            u: position.x / this._textureArraySize,
            v: position.y / this._textureArraySize,
            uScale: position.width / this._textureArraySize,
            vScale: position.height / this._textureArraySize,
            isTextureArray: false,
        });

        this._textureAtlas.needsUpdate = true;
        console.log(
            `Added texture ${textureUri} to atlas at ${position.x},${position.y}`
        );
        return true;
    }

    /**
     * Find an available position in the atlas
     */
    private _findAtlasPosition(): {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null {
        const textureSize = TEXTURE_SIZE;
        const atlasSize = this._textureArraySize;
        const cols = Math.floor(atlasSize / textureSize);
        const rows = Math.floor(atlasSize / textureSize);

        const usedPositions = new Set<string>();

        // Mark used positions
        for (const metadata of this._textureAtlasMetadata.values()) {
            if (!metadata.isTextureArray) {
                const col = Math.floor(metadata.x / textureSize);
                const row = Math.floor(metadata.y / textureSize);
                usedPositions.add(`${col},${row}`);
            }
        }

        // Find first available position
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const key = `${col},${row}`;
                if (!usedPositions.has(key)) {
                    return {
                        x: col * textureSize,
                        y: row * textureSize,
                        width: textureSize,
                        height: textureSize,
                    };
                }
            }
        }

        return null;
    }

    /**
     * Load image from URI
     */
    private _normalizePath(textureUri: string): string {
        if (!textureUri) return textureUri;
        if (textureUri.startsWith("data:")) return textureUri;
        if (textureUri.startsWith("/assets/")) return `.${textureUri}`;
        if (textureUri.startsWith("assets/")) return `./${textureUri}`;
        try {
            return new URL(textureUri, window.location.href).toString();
        } catch {
            return textureUri;
        }
    }

    private _loadImage(textureUri: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = "anonymous";

            image.onload = () => resolve(image);
            image.onerror = () =>
                reject(new Error(`Failed to load image: ${textureUri}`));

            image.src = this._normalizePath(textureUri);
        });
    }

    /**
     * Get UV coordinates for a texture
     */
    getTextureUVCoordinate(
        textureUri: string,
        uvOffset: number[] = [0, 0]
    ): Float32Array {
        const cacheKey = `${textureUri}_${uvOffset[0]}_${uvOffset[1]}`;

        if (this._textureUVCache.has(cacheKey)) {
            return this._textureUVCache.get(cacheKey)!;
        }

        const metadata = this._textureAtlasMetadata.get(textureUri);
        if (!metadata) {
            // Return default UV coordinates
            const defaultUV = new Float32Array([0, 0]);
            this._textureUVCache.set(cacheKey, defaultUV);
            return defaultUV;
        }

        let uvCoords: Float32Array;

        if (metadata.isTextureArray) {
            // For texture arrays, UV coordinates are always 0-1, layer is handled separately
            uvCoords = new Float32Array([
                uvOffset[0],
                uvOffset[1],
                metadata.layer, // Include layer information
            ]);
        } else {
            // For traditional atlas, calculate UV coordinates
            uvCoords = new Float32Array([
                metadata.u + uvOffset[0] * metadata.uScale,
                metadata.v + uvOffset[1] * metadata.vScale,
            ]);
        }

        this._textureUVCache.set(cacheKey, uvCoords);
        return uvCoords;
    }

    /**
     * Get texture metadata
     */
    getTextureMetadata(textureUri: string): any {
        return this._textureAtlasMetadata.get(textureUri);
    }

    /**
     * Get UV coordinates synchronously (for backward compatibility)
     */
    getTextureUVCoordinateSync(
        textureUri: string,
        uvOffset: number[] = [0, 0]
    ): Float32Array {
        return this.getTextureUVCoordinate(textureUri, uvOffset);
    }

    /**
     * Initialize essential textures
     */
    async initialize(): Promise<void> {
        console.log("🧊 Initializing Enhanced BlockTextureAtlas...");

        try {
            // Load essential textures
            for (const textureUri of this._essentialTextures) {
                await this.loadTexture(textureUri);
            }

            console.log(
                "✅ Enhanced BlockTextureAtlas initialization complete!"
            );
            console.log("📊 Optimization stats:", this.getOptimizationStats());
        } catch (error) {
            console.error(
                "❌ Error initializing Enhanced BlockTextureAtlas:",
                error
            );
        }
    }

    /**
     * Queue texture for loading
     */
    queueTextureForLoading(textureUri: string): void {
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
     * Process texture loading queue
     */
    private async _processTextureLoadQueue(): Promise<void> {
        if (this._isProcessingQueue || this._textureLoadQueue.length === 0) {
            return;
        }

        this._isProcessingQueue = true;

        try {
            while (this._textureLoadQueue.length > 0) {
                const textureUri = this._textureLoadQueue.shift()!;
                await this.loadTexture(textureUri);

                // Small delay to prevent blocking
                await new Promise((resolve) => setTimeout(resolve, 1));
            }
        } finally {
            this._isProcessingQueue = false;
        }
    }

    /**
     * Get compression and optimization statistics
     */
    getOptimizationStats(): any {
        return {
            textureArraysSupported:
                TextureCompression.instance.supportsTextureArrays(),
            usingTextureArrays: this._useTextureArrays,
            textureArrayLayers: this._nextLayerIndex,
            maxTextureArrayLayers: TEXTURE_ARRAY_DEPTH,
            atlasTextures: this._textureAtlasMetadata.size,
            compressionStats: TextureCompression.instance.getCompressionStats(),
            cacheSize: this._textureUVCache.size,
            queueSize: this._textureLoadQueue.length,
        };
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this._textureAtlas.dispose();
        this._textureArray?.dispose();
        this._textureAtlasMetadata.clear();
        this._textureUVCache.clear();
        this._textureLoadQueue.length = 0;
        TextureCompression.instance.dispose();
    }
}
