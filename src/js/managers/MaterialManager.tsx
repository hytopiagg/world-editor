import * as THREE from "three";
import { detectGPU } from "../utils/GPUDetection";
import { PerformanceMonitor } from "../utils/PerformanceMonitor";
import { TextureCompression } from "../utils/TextureCompression";

/**
 * Material pool configuration for different material types
 */
interface MaterialPoolConfig {
    maxPoolSize: number;
    createFunction: () => THREE.Material;
    resetFunction: (material: THREE.Material) => void;
}

/**
 * Material optimization settings based on GPU performance
 */
interface MaterialOptimizationSettings {
    useHighPrecisionShaders: boolean;
    enableAnisotropicFiltering: boolean;
    maxAnisotropy: number;
    useAdvancedTransparency: boolean;
    enableMipmapping: boolean;
    preferredMaterialType: "Lambert" | "Phong" | "Basic";
    alphaTestThreshold: number;
    shadowMapSize: number;
}

/**
 * Manages material creation, pooling, and optimization for better performance
 */
export class MaterialManager {
    private static _instance: MaterialManager | null = null;
    private materialPools: Map<string, THREE.Material[]> = new Map();
    private activeMaterials: Map<string, Set<THREE.Material>> = new Map();
    private optimizationSettings: MaterialOptimizationSettings;
    private sharedTextures: Map<string, THREE.Texture> = new Map();
    private materialConfigs: Map<string, MaterialPoolConfig> = new Map();

    private constructor() {
        this.optimizationSettings = this.getOptimizationSettings();
        this.initializeMaterialPools();
    }

    /**
     * Get singleton instance
     */
    static get instance(): MaterialManager {
        if (!MaterialManager._instance) {
            MaterialManager._instance = new MaterialManager();
        }
        return MaterialManager._instance;
    }

    /**
     * Get optimization settings based on GPU capabilities
     */
    public getOptimizationSettings(): MaterialOptimizationSettings {
        const gpuInfo = detectGPU();

        const baseSettings: MaterialOptimizationSettings = {
            useHighPrecisionShaders: false,
            enableAnisotropicFiltering: false,
            maxAnisotropy: 1,
            useAdvancedTransparency: false,
            enableMipmapping: false,
            preferredMaterialType: "Lambert",
            alphaTestThreshold: 0.1,
            shadowMapSize: 1024,
        };

        switch (gpuInfo.estimatedPerformanceClass) {
            case "high":
                return {
                    ...baseSettings,
                    useHighPrecisionShaders: true,
                    enableAnisotropicFiltering: gpuInfo.maxAnisotropy > 1,
                    maxAnisotropy: Math.min(gpuInfo.maxAnisotropy, 8),
                    useAdvancedTransparency: true,
                    enableMipmapping: true,
                    preferredMaterialType: "Phong",
                    alphaTestThreshold: 0.01,
                    shadowMapSize: 2048,
                };
            case "medium":
                return {
                    ...baseSettings,
                    useHighPrecisionShaders: gpuInfo.supportsWebGL2,
                    enableAnisotropicFiltering: gpuInfo.maxAnisotropy > 1,
                    maxAnisotropy: Math.min(gpuInfo.maxAnisotropy, 4),
                    useAdvancedTransparency: true,
                    enableMipmapping: true,
                    preferredMaterialType: "Lambert",
                    alphaTestThreshold: 0.05,
                    shadowMapSize: 1024,
                };
            case "low":
            default:
                return {
                    ...baseSettings,
                    useHighPrecisionShaders: false,
                    enableAnisotropicFiltering: false,
                    maxAnisotropy: 1,
                    useAdvancedTransparency: false,
                    enableMipmapping: false,
                    preferredMaterialType: "Basic",
                    alphaTestThreshold: 0.1,
                    shadowMapSize: 512,
                };
        }
    }

    /**
     * Initialize material pools for different material types
     * All pools use MeshBasicMaterial for SDK-compatible performance
     */
    private initializeMaterialPools(): void {
        // Basic block material pool
        this.materialConfigs.set("block", {
            maxPoolSize: 50,
            createFunction: () => this.createOptimizedBlockMaterial(),
            resetFunction: (material) => this.resetBlockMaterial(material as THREE.MeshBasicMaterial),
        });

        // Environment object material pool
        this.materialConfigs.set("environment", {
            maxPoolSize: 100,
            createFunction: () => this.createOptimizedEnvironmentMaterial(),
            resetFunction: (material) => this.resetEnvironmentMaterial(material as THREE.MeshBasicMaterial),
        });

        // Preview material pool
        this.materialConfigs.set("preview", {
            maxPoolSize: 20,
            createFunction: () => this.createOptimizedPreviewMaterial(),
            resetFunction: (material) => this.resetPreviewMaterial(material as THREE.MeshBasicMaterial),
        });

        // Transparent material pool
        this.materialConfigs.set("transparent", {
            maxPoolSize: 30,
            createFunction: () => this.createOptimizedTransparentMaterial(),
            resetFunction: (material) => this.resetTransparentMaterial(material as THREE.MeshBasicMaterial),
        });

        // Initialize empty pools
        this.materialConfigs.forEach((config, key) => {
            this.materialPools.set(key, []);
            this.activeMaterials.set(key, new Set());
        });
    }

    /**
     * Create optimized block material based on GPU capabilities
     * 
     * Always uses MeshBasicMaterial for SDK-compatible performance.
     * MeshBasicMaterial doesn't calculate lighting, making it the cheapest option.
     * All lighting is applied manually via shader modifications.
     */
    private createOptimizedBlockMaterial(): THREE.Material {
        const settings = this.optimizationSettings;

        // Always use MeshBasicMaterial for performance (matches SDK approach)
        // Lighting is handled manually via shader uniforms, not Three.js lighting system
        const material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            transparent: true,
            alphaTest: settings.alphaTestThreshold,
            side: THREE.FrontSide,
        });

        return material;
    }

    /**
     * Create optimized environment material
     * Uses MeshBasicMaterial for SDK-compatible performance
     * Lighting is handled manually via shader modifications
     */
    private createOptimizedEnvironmentMaterial(): THREE.Material {
        const settings = this.optimizationSettings;

        // Use MeshBasicMaterial for SDK-compatible performance
        // Emissive effects are handled via shader modifications, not material properties
        const material = new THREE.MeshBasicMaterial({
            transparent: true,
            alphaTest: settings.alphaTestThreshold,
            side: THREE.FrontSide,
            depthWrite: true,
            depthTest: true,
        });

        return material;
    }

    /**
     * Create optimized preview material
     * Uses MeshBasicMaterial for SDK-compatible performance
     */
    private createOptimizedPreviewMaterial(): THREE.Material {
        const material = new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0.5,
            alphaTest: 0.01,
            side: THREE.FrontSide,
            depthWrite: false,
            depthTest: true,
        });

        return material;
    }

    /**
     * Create optimized transparent material
     * Uses MeshBasicMaterial for SDK-compatible performance
     */
    private createOptimizedTransparentMaterial(): THREE.Material {
        const settings = this.optimizationSettings;

        const material = new THREE.MeshBasicMaterial({
            transparent: true,
            alphaTest: settings.useAdvancedTransparency ? 0.01 : settings.alphaTestThreshold,
            side: THREE.DoubleSide,
            depthWrite: !settings.useAdvancedTransparency,
            depthTest: true,
        });

        return material;
    }

    /**
     * Get material from pool or create new one
     */
    getMaterial(type: string, options?: any): THREE.Material {
        const config = this.materialConfigs.get(type);
        if (!config) {
            throw new Error(`Unknown material type: ${type}`);
        }

        const pool = this.materialPools.get(type)!;
        const activeMaterials = this.activeMaterials.get(type)!;

        let material: THREE.Material;

        if (pool.length > 0) {
            material = pool.pop()!;
            config.resetFunction(material);
        } else {
            material = config.createFunction();
        }

        // Apply any custom options
        if (options) {
            this.applyMaterialOptions(material, options);
        }

        activeMaterials.add(material);
        
        // Track material usage for performance monitoring
        PerformanceMonitor.instance.trackMaterialUsage(type);
        
        return material;
    }

    /**
     * Return material to pool
     */
    returnMaterial(type: string, material: THREE.Material): void {
        const config = this.materialConfigs.get(type);
        if (!config) {
            material.dispose();
            return;
        }

        const pool = this.materialPools.get(type)!;
        const activeMaterials = this.activeMaterials.get(type)!;

        if (activeMaterials.has(material)) {
            activeMaterials.delete(material);

            if (pool.length < config.maxPoolSize) {
                pool.push(material);
            } else {
                material.dispose();
            }
        }
    }

    /**
     * Apply custom options to material
     */
    private applyMaterialOptions(material: THREE.Material, options: any): void {
        if (options.map) {
            (material as any).map = options.map;
        }
        if (options.color) {
            (material as any).color = new THREE.Color(options.color);
        }
        if (options.opacity !== undefined) {
            material.opacity = options.opacity;
        }
        if (options.transparent !== undefined) {
            material.transparent = options.transparent;
        }
        if (options.alphaTest !== undefined) {
            material.alphaTest = options.alphaTest;
        }
        if (options.side !== undefined) {
            material.side = options.side;
        }
        if (options.depthWrite !== undefined) {
            material.depthWrite = options.depthWrite;
        }
        if (options.depthTest !== undefined) {
            material.depthTest = options.depthTest;
        }
        // Note: Emissive properties are not supported by MeshBasicMaterial
        // SDK-compatible lighting handles emissive effects via shader modifications
        // and block light level uniforms, not material properties
    }

    /**
     * Reset block material to default state
     */
    private resetBlockMaterial(material: THREE.MeshBasicMaterial): void {
        material.map = null;
        material.color.setHex(0xffffff);
        material.opacity = 1;
        material.transparent = true;
        material.alphaTest = this.optimizationSettings.alphaTestThreshold;
        material.side = THREE.FrontSide;
        material.depthWrite = true;
        material.depthTest = true;
        material.needsUpdate = true;
    }

    /**
     * Reset environment material to default state
     */
    private resetEnvironmentMaterial(material: THREE.MeshBasicMaterial): void {
        material.map = null;
        material.color.setHex(0xffffff);
        material.opacity = 1;
        material.transparent = true;
        material.alphaTest = this.optimizationSettings.alphaTestThreshold;
        material.side = THREE.FrontSide;
        material.depthWrite = true;
        material.depthTest = true;
        material.needsUpdate = true;
    }

    /**
     * Reset preview material to default state
     */
    private resetPreviewMaterial(material: THREE.MeshBasicMaterial): void {
        material.map = null;
        material.color.setHex(0xffffff);
        material.opacity = 0.5;
        material.transparent = true;
        material.alphaTest = 0.01;
        material.side = THREE.FrontSide;
        material.depthWrite = false;
        material.depthTest = true;
        material.needsUpdate = true;
    }

    /**
     * Reset transparent material to default state
     */
    private resetTransparentMaterial(material: THREE.MeshBasicMaterial): void {
        material.map = null;
        material.color.setHex(0xffffff);
        material.opacity = 1;
        material.transparent = true;
        material.alphaTest = this.optimizationSettings.useAdvancedTransparency ? 0.01 : this.optimizationSettings.alphaTestThreshold;
        material.side = THREE.DoubleSide;
        material.depthWrite = !this.optimizationSettings.useAdvancedTransparency;
        material.depthTest = true;
        material.needsUpdate = true;
    }

    /**
     * Optimize texture with proper filtering, mipmapping, and compression
     */
    optimizeTexture(texture: THREE.Texture): THREE.Texture {
        const settings = this.optimizationSettings;

        // Apply texture compression if available
        let optimizedTexture = texture;
        try {
            optimizedTexture = TextureCompression.instance.compressTexture(texture);
        } catch (error) {
            console.warn('Texture compression failed, using original texture:', error);
            optimizedTexture = texture;
        }

        // Set filtering based on GPU capabilities
        if (settings.enableAnisotropicFiltering) {
            optimizedTexture.anisotropy = settings.maxAnisotropy;
        } else {
            optimizedTexture.anisotropy = 1;
        }

        // Configure mipmapping
        if (settings.enableMipmapping) {
            optimizedTexture.generateMipmaps = true;
            optimizedTexture.minFilter = THREE.LinearMipmapLinearFilter;
            optimizedTexture.magFilter = THREE.LinearFilter;
        } else {
            optimizedTexture.generateMipmaps = false;
            optimizedTexture.minFilter = THREE.NearestFilter;
            optimizedTexture.magFilter = THREE.NearestFilter;
        }

        // Set wrapping mode
        optimizedTexture.wrapS = THREE.ClampToEdgeWrapping;
        optimizedTexture.wrapT = THREE.ClampToEdgeWrapping;

        optimizedTexture.needsUpdate = true;
        return optimizedTexture;
    }

    /**
     * Get shared texture (cached for reuse)
     */
    getSharedTexture(url: string): Promise<THREE.Texture> {
        if (this.sharedTextures.has(url)) {
            return Promise.resolve(this.sharedTextures.get(url)!);
        }

        return new Promise((resolve, reject) => {
            const loader = new THREE.TextureLoader();
            loader.load(
                url,
                (texture) => {
                    this.optimizeTexture(texture);
                    this.sharedTextures.set(url, texture);
                    resolve(texture);
                },
                undefined,
                reject
            );
        });
    }

    /**
     * Dispose all materials and clear pools
     */
    dispose(): void {
        this.materialPools.forEach((pool) => {
            pool.forEach((material) => material.dispose());
        });
        this.materialPools.clear();

        this.activeMaterials.forEach((set) => {
            set.forEach((material) => material.dispose());
        });
        this.activeMaterials.clear();

        this.sharedTextures.forEach((texture) => texture.dispose());
        this.sharedTextures.clear();
    }



    /**
     * Update optimization settings (useful for dynamic quality changes)
     */
    updateOptimizationSettings(newSettings: Partial<MaterialOptimizationSettings>): void {
        this.optimizationSettings = { ...this.optimizationSettings, ...newSettings };

        // Clear existing pools to force recreation with new settings
        this.materialPools.forEach((pool) => {
            pool.forEach((material) => material.dispose());
            pool.length = 0;
        });
    }
} 