import * as THREE from "three";
import { detectGPU } from "./GPUDetection";

/**
 * Supported texture compression formats
 */
export enum CompressionFormat {
    NONE = "none",
    S3TC_DXT1 = "s3tc_dxt1",
    S3TC_DXT5 = "s3tc_dxt5",
    ETC1 = "etc1",
    ETC2 = "etc2",
    ASTC = "astc",
    BPTC = "bptc",
}

/**
 * Texture compression capabilities
 */
interface CompressionCapabilities {
    s3tc: boolean;
    etc: boolean;
    etc1: boolean;
    astc: boolean;
    bptc: boolean;
    rgtc: boolean;
}

/**
 * Texture array configuration
 */
interface TextureArrayConfig {
    width: number;
    height: number;
    depth: number;
    format: THREE.PixelFormat;
    type: THREE.TextureDataType;
    generateMipmaps: boolean;
}

/**
 * Manages texture compression and WebGL2 texture arrays
 */
export class TextureCompression {
    private static _instance: TextureCompression | null = null;
    private gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
    private capabilities: CompressionCapabilities | null = null;
    private supportedFormats: CompressionFormat[] = [];
    private textureArrayCache: Map<string, THREE.DataArrayTexture> = new Map();
    private compressionExtensions: any = {};

    private constructor() {
        this.initializeCapabilities();
    }

    static get instance(): TextureCompression {
        if (!TextureCompression._instance) {
            TextureCompression._instance = new TextureCompression();
        }
        return TextureCompression._instance;
    }

    /**
     * Initialize compression capabilities based on WebGL context
     */
    private initializeCapabilities(): void {
        const gpuInfo = detectGPU();

        // Create a temporary canvas to check capabilities
        const canvas = document.createElement("canvas");
        this.gl = canvas.getContext("webgl2") || canvas.getContext("webgl");

        if (!this.gl) {
            console.warn(
                "No WebGL context available for texture compression detection"
            );
            this.capabilities = {
                s3tc: false,
                etc: false,
                etc1: false,
                astc: false,
                bptc: false,
                rgtc: false,
            };
            return;
        }

        // Check for compression extensions
        this.compressionExtensions = {
            s3tc: this.gl.getExtension("WEBGL_compressed_texture_s3tc"),
            etc: this.gl.getExtension("WEBGL_compressed_texture_etc"),
            etc1: this.gl.getExtension("WEBGL_compressed_texture_etc1"),
            astc: this.gl.getExtension("WEBGL_compressed_texture_astc"),
            bptc: this.gl.getExtension("EXT_texture_compression_bptc"),
            rgtc: this.gl.getExtension("EXT_texture_compression_rgtc"),
        };

        this.capabilities = {
            s3tc: !!this.compressionExtensions.s3tc,
            etc: !!this.compressionExtensions.etc,
            etc1: !!this.compressionExtensions.etc1,
            astc: !!this.compressionExtensions.astc,
            bptc: !!this.compressionExtensions.bptc,
            rgtc: !!this.compressionExtensions.rgtc,
        };

        // Determine supported formats based on capabilities
        this.supportedFormats = [CompressionFormat.NONE];

        if (this.capabilities.s3tc) {
            this.supportedFormats.push(
                CompressionFormat.S3TC_DXT1,
                CompressionFormat.S3TC_DXT5
            );
        }
        if (this.capabilities.etc1) {
            this.supportedFormats.push(CompressionFormat.ETC1);
        }
        if (this.capabilities.etc) {
            this.supportedFormats.push(CompressionFormat.ETC2);
        }
        if (this.capabilities.astc) {
            this.supportedFormats.push(CompressionFormat.ASTC);
        }
        if (this.capabilities.bptc) {
            this.supportedFormats.push(CompressionFormat.BPTC);
        }

    }

    /**
     * Get the best compression format for the current hardware
     */
    getBestCompressionFormat(hasAlpha: boolean = false): CompressionFormat {
        // Prefer formats in order of quality and support
        const preferredFormats = hasAlpha
            ? [
                  CompressionFormat.ASTC,
                  CompressionFormat.S3TC_DXT5,
                  CompressionFormat.ETC2,
                  CompressionFormat.BPTC,
              ]
            : [
                  CompressionFormat.ASTC,
                  CompressionFormat.S3TC_DXT1,
                  CompressionFormat.ETC1,
                  CompressionFormat.ETC2,
                  CompressionFormat.BPTC,
              ];

        for (const format of preferredFormats) {
            if (this.supportedFormats.includes(format)) {
                return format;
            }
        }

        return CompressionFormat.NONE;
    }

    /**
     * Check if WebGL2 texture arrays are supported
     */
    supportsTextureArrays(): boolean {
        return this.gl instanceof WebGL2RenderingContext;
    }

    /**
     * Create a WebGL2 texture array
     */
    createTextureArray(
        config: TextureArrayConfig
    ): THREE.DataArrayTexture | null {
        if (!this.supportsTextureArrays()) {
            console.warn("WebGL2 texture arrays not supported");
            return null;
        }

        const cacheKey = `${config.width}x${config.height}x${config.depth}_${config.format}_${config.type}`;

        if (this.textureArrayCache.has(cacheKey)) {
            return this.textureArrayCache.get(cacheKey)!;
        }

        try {
            const size = config.width * config.height * config.depth;
            const data = new Uint8Array(size * 4); // RGBA

            const textureArray = new THREE.DataArrayTexture(
                data,
                config.width,
                config.height,
                config.depth
            );

            textureArray.format = config.format;
            textureArray.type = config.type;
            textureArray.generateMipmaps = config.generateMipmaps;
            textureArray.minFilter = config.generateMipmaps
                ? THREE.LinearMipmapLinearFilter
                : THREE.LinearFilter;
            textureArray.magFilter = THREE.LinearFilter;
            textureArray.wrapS = THREE.ClampToEdgeWrapping;
            textureArray.wrapT = THREE.ClampToEdgeWrapping;
            textureArray.needsUpdate = true;

            this.textureArrayCache.set(cacheKey, textureArray);
            console.log(`Created WebGL2 texture array: ${cacheKey}`);

            return textureArray;
        } catch (error) {
            console.error("Error creating texture array:", error);
            return null;
        }
    }

    /**
     * Add a texture to a texture array at specified layer
     */
    addTextureToArray(
        textureArray: THREE.DataArrayTexture,
        imageData: ImageData | HTMLCanvasElement,
        layer: number
    ): boolean {
        if (!this.supportsTextureArrays()) {
            return false;
        }

        try {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");

            if (!ctx) {
                console.error(
                    "Could not create 2D context for texture processing"
                );
                return false;
            }

            // Ensure image is the correct size
            canvas.width = textureArray.image.width;
            canvas.height = textureArray.image.height;

            if (imageData instanceof ImageData) {
                ctx.putImageData(imageData, 0, 0);
            } else {
                ctx.drawImage(imageData, 0, 0, canvas.width, canvas.height);
            }

            const layerData = ctx.getImageData(
                0,
                0,
                canvas.width,
                canvas.height
            );
            const layerSize = canvas.width * canvas.height * 4;
            const layerOffset = layer * layerSize;

            // Copy layer data to the texture array
            const arrayData = textureArray.image.data as Uint8Array;
            arrayData.set(layerData.data, layerOffset);

            textureArray.needsUpdate = true;
            return true;
        } catch (error) {
            console.error("Error adding texture to array:", error);
            return false;
        }
    }

    /**
     * Compress a texture using the best available format
     */
    compressTexture(texture: THREE.Texture): THREE.Texture {
        const format = this.getBestCompressionFormat(
            texture.format === THREE.RGBAFormat
        );

        if (format === CompressionFormat.NONE) {
            return texture;
        }

        // Note: Real compression would require a compression library or server-side processing
        // For now, we'll optimize the texture with better settings
        const optimizedTexture = texture.clone();

        // Apply compression-like optimizations
        switch (format) {
            case CompressionFormat.S3TC_DXT1:
            case CompressionFormat.S3TC_DXT5:
                optimizedTexture.format = THREE.RGBAFormat;
                optimizedTexture.generateMipmaps = true;
                optimizedTexture.minFilter = THREE.LinearMipmapLinearFilter;
                break;

            case CompressionFormat.ETC1:
            case CompressionFormat.ETC2:
                optimizedTexture.format = THREE.RGBAFormat;
                optimizedTexture.generateMipmaps = true;
                optimizedTexture.minFilter = THREE.LinearMipmapLinearFilter;
                break;

            case CompressionFormat.ASTC:
                optimizedTexture.format = THREE.RGBAFormat;
                optimizedTexture.generateMipmaps = true;
                optimizedTexture.minFilter = THREE.LinearMipmapLinearFilter;
                // Get anisotropy from extension
                if (this.gl) {
                    const ext = this.gl.getExtension(
                        "EXT_texture_filter_anisotropic"
                    );
                    if (ext) {
                        optimizedTexture.anisotropy = Math.min(
                            16,
                            this.gl.getParameter(
                                ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT
                            ) || 1
                        );
                    } else {
                        optimizedTexture.anisotropy = 1;
                    }
                }
                break;
        }

        optimizedTexture.needsUpdate = true;

        return optimizedTexture;
    }

    /**
     * Get compression statistics
     */
    getCompressionStats(): any {
        return {
            capabilities: this.capabilities,
            supportedFormats: this.supportedFormats,
            textureArraysSupported: this.supportsTextureArrays(),
            cachedTextureArrays: this.textureArrayCache.size,
        };
    }

    /**
     * Dispose of all cached texture arrays
     */
    dispose(): void {
        this.textureArrayCache.forEach((textureArray) => {
            textureArray.dispose();
        });
        this.textureArrayCache.clear();
    }
}
