import { EnhancedBlockTextureAtlas } from "./EnhancedBlockTextureAtlas";
import BlockTextureAtlas from "./BlockTextureAtlas";

/**
 * Integration utility to switch between old and new texture atlas systems
 */
export class TextureAtlasIntegration {
    private static _instance: TextureAtlasIntegration | null = null;
    private useEnhancedAtlas: boolean = false;

    private constructor() {
        // Check if enhanced features are available
        this.useEnhancedAtlas = this.shouldUseEnhancedAtlas();
    }

    static get instance(): TextureAtlasIntegration {
        if (!TextureAtlasIntegration._instance) {
            TextureAtlasIntegration._instance = new TextureAtlasIntegration();
        }
        return TextureAtlasIntegration._instance;
    }

    /**
     * Determine if enhanced atlas should be used
     */
    private shouldUseEnhancedAtlas(): boolean {
        try {
            // Check if WebGL2 is available
            const canvas = document.createElement("canvas");
            const gl = canvas.getContext("webgl2");

            if (!gl) {
                console.log(
                    "WebGL2 not available, using traditional texture atlas"
                );
                return false;
            }

            // Check if texture arrays are supported
            const maxTextureArrayLayers = gl.getParameter(
                gl.MAX_ARRAY_TEXTURE_LAYERS
            );
            if (maxTextureArrayLayers < 256) {
                console.log(
                    "Insufficient texture array support, using traditional texture atlas"
                );
                return false;
            }

            console.log("Enhanced texture atlas features available");
            return true;
        } catch (error) {
            console.warn("Error checking enhanced atlas capabilities:", error);
            return false;
        }
    }

    /**
     * Get the appropriate atlas instance
     */
    getAtlas(): any {
        if (this.useEnhancedAtlas) {
            return EnhancedBlockTextureAtlas.instance;
        } else {
            return BlockTextureAtlas.instance;
        }
    }

    /**
     * Initialize the appropriate atlas
     */
    async initializeAtlas(): Promise<void> {
        const atlas = this.getAtlas();

        if (atlas.initialize) {
            await atlas.initialize();
        }
    }

    /**
     * Get texture atlas for materials
     */
    get textureAtlas(): any {
        return this.getAtlas().textureAtlas;
    }

    /**
     * Get texture UV coordinates
     */
    async getTextureUVCoordinate(
        textureUri: string,
        uvOffset: number[] = [0, 0]
    ): Promise<Float32Array> {
        const atlas = this.getAtlas();

        if (atlas.getTextureUVCoordinate) {
            return atlas.getTextureUVCoordinate(textureUri, uvOffset);
        } else {
            // Fallback for old atlas
            return atlas.getTextureUVCoordinateSync(textureUri, uvOffset);
        }
    }

    /**
     * Get texture metadata
     */
    getTextureMetadata(textureUri: string): any {
        return this.getAtlas().getTextureMetadata(textureUri);
    }

    /**
     * Queue texture for loading
     */
    queueTextureForLoading(textureUri: string): void {
        this.getAtlas().queueTextureForLoading(textureUri);
    }

    /**
     * Load texture
     */
    async loadTexture(textureUri: string): Promise<boolean> {
        const atlas = this.getAtlas();

        if (atlas.loadTexture) {
            return atlas.loadTexture(textureUri);
        } else {
            // Fallback for old atlas
            atlas.queueTextureForLoading(textureUri);
            return true;
        }
    }

    /**
     * Get optimization statistics
     */
    getOptimizationStats(): any {
        const atlas = this.getAtlas();

        if (atlas.getOptimizationStats) {
            return atlas.getOptimizationStats();
        } else {
            return {
                usingEnhancedAtlas: false,
                textureArraysSupported: false,
                compressionSupported: false,
            };
        }
    }

    /**
     * Check if using enhanced atlas
     */
    isUsingEnhancedAtlas(): boolean {
        return this.useEnhancedAtlas;
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        const atlas = this.getAtlas();
        if (atlas.dispose) {
            atlas.dispose();
        }
    }
}
