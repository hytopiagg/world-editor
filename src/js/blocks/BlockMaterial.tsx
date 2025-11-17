

import * as THREE from "three";
import { MaterialManager } from "../managers/MaterialManager";
import { detectGPU } from "../utils/GPUDetection";

/**
 * Optimized water shader uniforms
 */
interface WaterShaderUniforms {
    textureAtlas: { value: THREE.Texture | null };
    time: { value: number };
    filter: { value: THREE.TextureFilter };
    waveIntensity: { value: number };
    waveSpeed: { value: number };
    waterTint: { value: THREE.Vector3 };
    brightness: { value: number };
    alpha: { value: number };
    [uniform: string]: { value: any };
}

/**
 * Singleton class for managing block materials with performance optimizations
 */
class BlockMaterial {
    private _defaultMaterial: THREE.Material | null = null;
    private _defaultSolidLit: THREE.MeshPhongMaterial | null = null;
    private _defaultSolidNonLit: THREE.MeshPhongMaterial | null = null;
    private _liquidMaterial: THREE.ShaderMaterial | null = null;
    private _materialManager: MaterialManager;
    private _gpuInfo: any;
    private _waterShaderUniforms: WaterShaderUniforms | null = null;
    private static _instance: BlockMaterial | null = null;

    constructor() {
        this._materialManager = MaterialManager.instance;
        this._gpuInfo = detectGPU();
    }

    /**
     * Get the singleton instance
     */
    static get instance(): BlockMaterial {
        if (!BlockMaterial._instance) {
            BlockMaterial._instance = new BlockMaterial();
        }
        return BlockMaterial._instance;
    }

    /**
     * Non-lit solid block material (no lightLevel attribute in shader)
     */
    get defaultSolidNonLit(): THREE.MeshPhongMaterial {
        if (!this._defaultSolidNonLit) {
            this._defaultSolidNonLit = this._createSolidBlockMaterial(false);
        }
        return this._defaultSolidNonLit;
    }

    /**
     * Lit solid block material (expects attribute float lightLevel)
     */
    get defaultSolidLit(): THREE.MeshPhongMaterial {
        if (!this._defaultSolidLit) {
            this._defaultSolidLit = this._createSolidBlockMaterial(true);
        }
        return this._defaultSolidLit;
    }

    /**
     * Get optimized material for environment objects
     */
    getEnvironmentMaterial(options?: any): THREE.Material {
        return this._materialManager.getMaterial("environment", options);
    }

    /**
     * Get optimized material for preview objects
     */
    getPreviewMaterial(options?: any): THREE.Material {
        return this._materialManager.getMaterial("preview", options);
    }

    /**
     * Get optimized material for transparent objects
     */
    getTransparentMaterial(options?: any): THREE.Material {
        return this._materialManager.getMaterial("transparent", options);
    }

    /**
     * Return material to pool for reuse
     */
    returnMaterial(type: string, material: THREE.Material): void {
        this._materialManager.returnMaterial(type, material);
    }

    /**
     * Set the texture atlas for materials with optimization
     */
    setTextureAtlas(textureAtlas: THREE.Texture | null): void {
        if (textureAtlas) {
            // Optimize texture based on GPU capabilities
            this._materialManager.optimizeTexture(textureAtlas);
        }

        // Update solid materials
        if (this._defaultSolidNonLit) {
            (this._defaultSolidNonLit as any).map = textureAtlas;
            this._defaultSolidNonLit.needsUpdate = true;
        }
        if (this._defaultSolidLit) {
            (this._defaultSolidLit as any).map = textureAtlas;
            this._defaultSolidLit.needsUpdate = true;
        }

        // Update liquid material uniforms
        if (this._liquidMaterial && this._waterShaderUniforms) {
            this._waterShaderUniforms.textureAtlas.value = textureAtlas;
            this._liquidMaterial.needsUpdate = true;
        }
    }

    /**
     * Create a MeshPhongMaterial for solid blocks with optional lightLevel support
     */
    private _createSolidBlockMaterial(hasLightLevel: boolean): THREE.MeshPhongMaterial {
        const mat = new THREE.MeshPhongMaterial({
            vertexColors: true,
            transparent: true,
            alphaTest: this._materialManager.getOptimizationSettings().alphaTestThreshold,
            side: THREE.FrontSide,
            shininess: 0,
            specular: 0x000000,
        });

        // Attach define so program cache keys differ when toggling feature
        (mat as any).defines = (mat as any).defines || {};
        (mat as any).defines["HAS_LIGHT_LEVEL"] = hasLightLevel;

        const UNIFORM_RAW_AMBIENT_LIGHT_COLOR = 'rawAmbientLightColor';

        mat.onBeforeCompile = (params: any) => {
            if (!(mat as any).defines["HAS_LIGHT_LEVEL"]) return;

            const u = { value: new THREE.Color() };
            params.uniforms[UNIFORM_RAW_AMBIENT_LIGHT_COLOR] = u;
            // Keep a reference so we can update it each frame from updateAmbient()
            (mat as any).userData = (mat as any).userData || {};
            (mat as any).userData.rawAmbientUniform = u;

            params.vertexShader = params.vertexShader.replace(
                'void main() {',
                `
                attribute float lightLevel;
                varying float vLightLevel;
                void main() {
                  vLightLevel = lightLevel;
                `
            );

            params.fragmentShader = params.fragmentShader
                .replace(
                    'void main() {',
                    `
                    varying float vLightLevel;
                    uniform vec3 ${UNIFORM_RAW_AMBIENT_LIGHT_COLOR};
                    void main() {
                    `
                )
                .replace(
                    '#include <lights_fragment_begin>',
                    `
                    #include <lights_fragment_begin>
                    irradiance = max(irradiance, ${UNIFORM_RAW_AMBIENT_LIGHT_COLOR} * vLightLevel);
                    `
                );
        };

        return mat;
    }

    /**
     * Update ambient data on materials each frame
     */
    updateAmbient(ambientColor: THREE.Color, ambientIntensity: number): void {
        const color = new THREE.Color().copy(ambientColor);
        const apply = (mat?: THREE.MeshPhongMaterial | null) => {
            if (!mat) return;
            const u = (mat as any).userData?.rawAmbientUniform;
            if (u && u.value) {
                u.value.copy(color);
            }
        };
        apply(this._defaultSolidLit);
        apply(this._defaultSolidNonLit);
    }

    /**
     * Get the optimized liquid material with performance-based features
     */
    get liquidMaterial(): THREE.ShaderMaterial {
        if (!this._liquidMaterial) {
            this._liquidMaterial = this.createOptimizedLiquidMaterial();
        }
        return this._liquidMaterial;
    }

    /**
     * Create optimized liquid material based on GPU performance
     */
    private createOptimizedLiquidMaterial(): THREE.ShaderMaterial {
        const settings = this._materialManager.getOptimizationSettings();
        const isLowEnd = this._gpuInfo.estimatedPerformanceClass === "low";

        // Initialize uniforms
        this._waterShaderUniforms = {
            textureAtlas: { value: null },
            time: { value: 0 },
            filter: { value: THREE.NearestFilter },
            waveIntensity: { value: isLowEnd ? 0.5 : 1.0 },
            waveSpeed: { value: isLowEnd ? 0.5 : 1.0 },
            waterTint: { value: new THREE.Vector3(0.9, 0.9, 1.0) },
            brightness: { value: 1.3 },
            alpha: { value: 0.75 }
        };

        // Use different shader precision based on GPU
        const precision = settings.useHighPrecisionShaders ? 'highp' : 'mediump';
        const lowEndOptimizations = this._gpuInfo.estimatedPerformanceClass === "low";

        const vertexShader = `
            precision ${precision} float;
            
            varying vec2 vUv;
            varying vec3 vPosition;
            varying vec3 vNormal;
            varying vec3 vWorldPosition;
            
            uniform float time;
            uniform float waveIntensity;
            uniform float waveSpeed;
            
            void main() {
                vUv = uv;
                vPosition = position;
                vNormal = normal;
                vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;

                float isTopSurface = step(0.9, normal.y);
                vec3 pos = position;
                
                if (isTopSurface > 0.5) {
                    pos.y -= 0.1;
                    
                    ${lowEndOptimizations ?
                // Simplified waves for low-end GPUs
                `
                        float wave = sin(pos.x * 2.0 + time * waveSpeed) * 0.02 * waveIntensity;
                        pos.y += wave;
                        ` :
                // Full wave calculation for better GPUs
                `
                        float wave1 = sin(pos.x * 2.0 + time * waveSpeed) * 0.03;
                        float wave2 = cos(pos.z * 3.0 + time * waveSpeed * 0.7) * 0.02;
                        float wave3 = sin(pos.x * 5.0 + pos.z * 5.0 + time * waveSpeed * 2.0) * 0.01;
                        float combinedWave = (wave1 + wave2 + wave3) * waveIntensity;
                        pos.y += combinedWave;
                        `
            }
                }
                
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
            }
        `;

        const fragmentShader = `
            precision ${precision} float;
            
            uniform sampler2D textureAtlas;
            uniform float time;
            uniform float waveSpeed;
            uniform vec3 waterTint;
            uniform float brightness;
            uniform float alpha;
            
            varying vec2 vUv;
            varying vec3 vPosition;
            varying vec3 vNormal;
            varying vec3 vWorldPosition;
            
            void main() {
                vec4 texColor = texture2D(textureAtlas, vUv);
                
                // Apply brightness
                vec3 brightColor = texColor.rgb * brightness;
                
                // Apply water tint
                vec3 finalColor = mix(brightColor, waterTint, 0.2);
                
                ${lowEndOptimizations ?
                // Skip complex surface effects for low-end GPUs
                `
                    gl_FragColor = vec4(finalColor, texColor.a * alpha);
                    ` :
                // Full surface effects for better GPUs
                `
                    // Add surface ripples for top faces
                    if (vNormal.y > 0.9) {
                        float waveTime = time * waveSpeed * 2.0;
                        float wave1 = sin(vWorldPosition.x * 8.0 + vWorldPosition.z * 6.0 + waveTime) * 0.5 + 0.5;
                        float wave2 = sin(vWorldPosition.x * 5.0 - vWorldPosition.z * 7.0 + waveTime * 0.8) * 0.5 + 0.5;
                        float combinedWave = (wave1 * 0.65 + wave2 * 0.45);
                        float rippleFactor = combinedWave * 0.1;
                        
                        vec3 highlightColor = vec3(1.0, 1.0, 1.0);
                        finalColor = mix(finalColor, highlightColor, rippleFactor);
                    }
                    
                    gl_FragColor = vec4(finalColor, texColor.a * alpha);
                    `
            }
            }
        `;

        const material = new THREE.ShaderMaterial({
            uniforms: this._waterShaderUniforms,
            vertexShader,
            fragmentShader,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: settings.useAdvancedTransparency ? false : true,
            depthTest: true,
            alphaTest: settings.alphaTestThreshold,
        });

        // Set shader extensions based on GPU capabilities
        (material as any).extensions = {
            derivatives: !lowEndOptimizations,
            fragDepth: false,
            drawBuffers: false,
            shaderTextureLOD: settings.useHighPrecisionShaders,
        };

        return material;
    }

    /**
     * Update liquid material time uniform (optimized)
     */
    updateLiquidTime(time: number): void {
        if (this._liquidMaterial && this._waterShaderUniforms) {
            this._waterShaderUniforms.time.value = time;
        }
    }

    /**
     * Update liquid material settings for dynamic quality adjustment
     */
    updateLiquidSettings(settings: {
        waveIntensity?: number;
        waveSpeed?: number;
        waterTint?: THREE.Vector3;
        brightness?: number;
        alpha?: number;
    }): void {
        if (this._liquidMaterial && this._waterShaderUniforms) {
            if (settings.waveIntensity !== undefined) {
                this._waterShaderUniforms.waveIntensity.value = settings.waveIntensity;
            }
            if (settings.waveSpeed !== undefined) {
                this._waterShaderUniforms.waveSpeed.value = settings.waveSpeed;
            }
            if (settings.waterTint !== undefined) {
                this._waterShaderUniforms.waterTint.value = settings.waterTint;
            }
            if (settings.brightness !== undefined) {
                this._waterShaderUniforms.brightness.value = settings.brightness;
            }
            if (settings.alpha !== undefined) {
                this._waterShaderUniforms.alpha.value = settings.alpha;
            }
        }
    }

    /**
     * Get shared texture with caching
     */
    getSharedTexture(url: string): Promise<THREE.Texture> {
        return this._materialManager.getSharedTexture(url);
    }

    /**
     * Optimize an existing texture
     */
    optimizeTexture(texture: THREE.Texture): THREE.Texture {
        return this._materialManager.optimizeTexture(texture);
    }

    /**
     * Get current material optimization settings
     */
    getOptimizationSettings(): any {
        return this._materialManager.getOptimizationSettings();
    }

    /**
     * Update optimization settings (useful for performance mode changes)
     */
    updateOptimizationSettings(newSettings: any): void {
        this._materialManager.updateOptimizationSettings(newSettings);

        // Recreate liquid material with new settings
        if (this._liquidMaterial) {
            this._liquidMaterial.dispose();
            this._liquidMaterial = null;
            this._waterShaderUniforms = null;
        }

        // Recreate default material
        if (this._defaultMaterial) {
            this._defaultMaterial = null;
        }
    }

    /**
     * Dispose all materials and resources
     */
    dispose(): void {
        if (this._defaultSolidNonLit) { this._defaultSolidNonLit.dispose(); this._defaultSolidNonLit = null; }
        if (this._defaultSolidLit) { this._defaultSolidLit.dispose(); this._defaultSolidLit = null; }

        if (this._liquidMaterial) {
            this._liquidMaterial.dispose();
            this._liquidMaterial = null;
        }

        this._waterShaderUniforms = null;
        this._materialManager.dispose();
    }
}

export default BlockMaterial;
