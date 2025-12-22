import * as THREE from "three";
import { MaterialManager } from "../managers/MaterialManager";
import { detectGPU } from "../utils/GPUDetection";
import {
    LIGHT_LEVEL_STRENGTH_MULTIPLIER,
    ALPHA_TEST_THRESHOLD,
    WATER_SURFACE_Y_OFFSET,
} from "../chunks/ChunkConstants";

interface WaterShaderUniforms {
    textureAtlas: { value: THREE.Texture | null };
    time: { value: number };
    filter: { value: THREE.TextureFilter };
    waveIntensity: { value: number };
    waveSpeed: { value: number };
    waterTint: { value: THREE.Vector3 };
    brightness: { value: number };
    alpha: { value: number };
    ambientLightColor: { value: THREE.Color };
    [uniform: string]: { value: any };
}

const UNIFORM_RAW_AMBIENT_LIGHT_COLOR = 'rawAmbientLightColor';
const UNIFORM_AMBIENT_LIGHT_INTENSITY = 'ambientLightIntensity';
const DEFINE_HAS_LIGHT_LEVEL = 'HAS_LIGHT_LEVEL';

export interface AmbientLightData {
    color: THREE.Color;
    intensity: number;
}

class BlockMaterial {
    private _defaultMaterial: THREE.Material | null = null;
    private _defaultSolidLit: THREE.MeshBasicMaterial | null = null;
    private _defaultSolidNonLit: THREE.MeshBasicMaterial | null = null;
    private _liquidMaterial: THREE.ShaderMaterial | null = null;
    private _materialManager: MaterialManager;
    private _gpuInfo: any;
    private _waterShaderUniforms: WaterShaderUniforms | null = null;
    private static _instance: BlockMaterial | null = null;

    // Shared uniform objects that can be updated
    private _ambientColorUniform = { value: new THREE.Color(1, 1, 1) };
    private _ambientIntensityUniform = { value: 1.0 };

    private _ambientLight: AmbientLightData = {
        color: new THREE.Color(1, 1, 1),
        intensity: 1.0,
    };

    constructor() {
        this._materialManager = MaterialManager.instance;
        this._gpuInfo = detectGPU();
    }

    static get instance(): BlockMaterial {
        if (!BlockMaterial._instance) {
            BlockMaterial._instance = new BlockMaterial();
        }
        return BlockMaterial._instance;
    }

    get ambientLight(): AmbientLightData {
        return this._ambientLight;
    }

    get defaultSolidNonLit(): THREE.MeshBasicMaterial {
        if (!this._defaultSolidNonLit) {
            this._defaultSolidNonLit = this._createSolidBlockMaterial(false);
        }
        return this._defaultSolidNonLit;
    }

    get defaultSolidLit(): THREE.MeshBasicMaterial {
        if (!this._defaultSolidLit) {
            this._defaultSolidLit = this._createSolidBlockMaterial(true);
        }
        return this._defaultSolidLit;
    }

    getEnvironmentMaterial(options?: any): THREE.Material {
        return this._materialManager.getMaterial("environment", options);
    }

    getPreviewMaterial(options?: any): THREE.Material {
        return this._materialManager.getMaterial("preview", options);
    }

    getTransparentMaterial(options?: any): THREE.Material {
        return this._materialManager.getMaterial("transparent", options);
    }

    returnMaterial(type: string, material: THREE.Material): void {
        this._materialManager.returnMaterial(type, material);
    }

    setTextureAtlas(textureAtlas: THREE.Texture | null): void {
        if (textureAtlas) {
            this._materialManager.optimizeTexture(textureAtlas);
        }
        if (this._defaultSolidNonLit) {
            this._defaultSolidNonLit.map = textureAtlas;
            this._defaultSolidNonLit.needsUpdate = true;
        }
        if (this._defaultSolidLit) {
            this._defaultSolidLit.map = textureAtlas;
            this._defaultSolidLit.needsUpdate = true;
        }
        if (this._liquidMaterial && this._waterShaderUniforms) {
            this._waterShaderUniforms.textureAtlas.value = textureAtlas;
            this._liquidMaterial.needsUpdate = true;
        }
    }

    /**
     * Create a MeshBasicMaterial for solid blocks with SDK-compatible lighting
     * 
     * Face-based shading is BAKED into vertex colors during chunk mesh generation.
     * The shader only applies ambient light and block light levels.
     * This matches the SDK's approach in ChunkWorker + MeshBlockMaterial.
     */
    private _createSolidBlockMaterial(hasLightLevel: boolean): THREE.MeshBasicMaterial {
        const mat = new THREE.MeshBasicMaterial({
            vertexColors: true,
            transparent: true,
            alphaTest: ALPHA_TEST_THRESHOLD,
            side: THREE.FrontSide,
        });

        (mat as any).defines = (mat as any).defines || {};
        (mat as any).defines[DEFINE_HAS_LIGHT_LEVEL] = hasLightLevel;

        // Use shared uniform objects so they update across all materials
        const ambientColorUniform = this._ambientColorUniform;
        const ambientIntensityUniform = this._ambientIntensityUniform;

        mat.onBeforeCompile = (params: THREE.WebGLProgramParametersWithUniforms) => {
            // Use shared uniform objects (not getters - Three.js needs direct value access)
            params.uniforms[UNIFORM_RAW_AMBIENT_LIGHT_COLOR] = ambientColorUniform;
            params.uniforms[UNIFORM_AMBIENT_LIGHT_INTENSITY] = ambientIntensityUniform;

            // Add lightLevel attribute/varying to vertex shader if needed
            if (hasLightLevel) {
                params.vertexShader = params.vertexShader.replace(
                    'void main() {',
                    `
                    attribute float lightLevel;
                    varying float vLightLevel;
                    void main() {
                        vLightLevel = lightLevel;
                    `
                );
            }

            // Fragment shader: apply ambient/block lighting
            // Note: Face-based shading is already baked into vertex colors from Chunk.js
            // We only apply ambient light and block light level comparisons here
            const varyingDecl = hasLightLevel ? 'varying float vLightLevel;' : '';
            const lightingCalc = hasLightLevel
                ? `
                    // Base ambient lighting
                    vec3 ambientLight = ${UNIFORM_RAW_AMBIENT_LIGHT_COLOR} * ${UNIFORM_AMBIENT_LIGHT_INTENSITY};
                    // Block light contribution from emissive blocks
                    vec3 blockLight = ${UNIFORM_RAW_AMBIENT_LIGHT_COLOR} * vLightLevel * float(${LIGHT_LEVEL_STRENGTH_MULTIPLIER});
                    // Take the brighter of ambient or block light
                    outgoingLight *= max(ambientLight, blockLight);
                `
                : `
                    // Apply ambient lighting only (no block light levels)
                    outgoingLight *= ${UNIFORM_RAW_AMBIENT_LIGHT_COLOR} * ${UNIFORM_AMBIENT_LIGHT_INTENSITY};
                `;

            params.fragmentShader = params.fragmentShader
                .replace(
                    'void main() {',
                    `
                    ${varyingDecl}
                    uniform vec3 ${UNIFORM_RAW_AMBIENT_LIGHT_COLOR};
                    uniform float ${UNIFORM_AMBIENT_LIGHT_INTENSITY};
                    void main() {
                    `
                )
                .replace(
                    '#include <opaque_fragment>',
                    `
                    ${lightingCalc}
                    #include <opaque_fragment>
                    `
                );
        };

        return mat;
    }

    updateAmbient(ambientColor: THREE.Color, ambientIntensity: number): void {
        // Update both the data store and the shared uniforms
        this._ambientLight.color.copy(ambientColor);
        this._ambientLight.intensity = ambientIntensity;

        // Update shared uniform objects - these are referenced by all materials
        this._ambientColorUniform.value.copy(ambientColor);
        this._ambientIntensityUniform.value = ambientIntensity;

        if (this._waterShaderUniforms) {
            this._waterShaderUniforms.ambientLightColor.value.copy(ambientColor).multiplyScalar(ambientIntensity);
        }
    }

    get liquidMaterial(): THREE.ShaderMaterial {
        if (!this._liquidMaterial) {
            this._liquidMaterial = this.createOptimizedLiquidMaterial();
        }
        return this._liquidMaterial;
    }

    private createOptimizedLiquidMaterial(): THREE.ShaderMaterial {
        const settings = this._materialManager.getOptimizationSettings();
        const isLowEnd = this._gpuInfo.estimatedPerformanceClass === "low";

        this._waterShaderUniforms = {
            textureAtlas: { value: null },
            time: { value: 0 },
            filter: { value: THREE.NearestFilter },
            waveIntensity: { value: isLowEnd ? 0.5 : 1.0 },
            waveSpeed: { value: isLowEnd ? 0.5 : 1.0 },
            waterTint: { value: new THREE.Vector3(0.9, 0.9, 1.0) },
            brightness: { value: 1.3 },
            alpha: { value: 0.75 },
            ambientLightColor: { value: new THREE.Color().copy(this._ambientLight.color).multiplyScalar(this._ambientLight.intensity) },
        };

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
                    pos.y += float(${WATER_SURFACE_Y_OFFSET});
                    ${lowEndOptimizations ?
                `float wave = sin(pos.x * 2.0 + time * waveSpeed) * 0.02 * waveIntensity;
                        pos.y += wave;` :
                `float wave1 = sin(pos.x * 2.0 + time * waveSpeed) * 0.03;
                        float wave2 = cos(pos.z * 3.0 + time * waveSpeed * 0.7) * 0.02;
                        float wave3 = sin(pos.x * 5.0 + pos.z * 5.0 + time * waveSpeed * 2.0) * 0.01;
                        float combinedWave = (wave1 + wave2 + wave3) * waveIntensity;
                        pos.y += combinedWave;`
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
            uniform vec3 ambientLightColor;
            varying vec2 vUv;
            varying vec3 vPosition;
            varying vec3 vNormal;
            varying vec3 vWorldPosition;
            void main() {
                vec4 texColor = texture2D(textureAtlas, vUv);
                vec3 brightColor = texColor.rgb * brightness;
                vec3 finalColor = mix(brightColor, waterTint, 0.2);
                finalColor *= ambientLightColor;
                ${lowEndOptimizations ?
                `gl_FragColor = vec4(finalColor, texColor.a * alpha);` :
                `if (vNormal.y > 0.9) {
                        float waveTime = time * waveSpeed * 2.0;
                        float wave1 = sin(vWorldPosition.x * 8.0 + vWorldPosition.z * 6.0 + waveTime) * 0.5 + 0.5;
                        float wave2 = sin(vWorldPosition.x * 5.0 - vWorldPosition.z * 7.0 + waveTime * 0.8) * 0.5 + 0.5;
                        float combinedWave = (wave1 * 0.65 + wave2 * 0.45);
                        float rippleFactor = combinedWave * 0.1;
                        vec3 highlightColor = vec3(1.0, 1.0, 1.0);
                        finalColor = mix(finalColor, highlightColor, rippleFactor);
                    }
                    gl_FragColor = vec4(finalColor, texColor.a * alpha);`
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
            alphaTest: ALPHA_TEST_THRESHOLD,
            forceSinglePass: true,
        });

        (material as any).extensions = {
            derivatives: !lowEndOptimizations,
            fragDepth: false,
            drawBuffers: false,
            shaderTextureLOD: settings.useHighPrecisionShaders,
        };

        return material;
    }

    updateLiquidTime(time: number): void {
        if (this._liquidMaterial && this._waterShaderUniforms) {
            this._waterShaderUniforms.time.value = time;
        }
    }

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

    getSharedTexture(url: string): Promise<THREE.Texture> {
        return this._materialManager.getSharedTexture(url);
    }

    optimizeTexture(texture: THREE.Texture): THREE.Texture {
        return this._materialManager.optimizeTexture(texture);
    }

    getOptimizationSettings(): any {
        return this._materialManager.getOptimizationSettings();
    }

    updateOptimizationSettings(newSettings: any): void {
        this._materialManager.updateOptimizationSettings(newSettings);
        if (this._liquidMaterial) {
            this._liquidMaterial.dispose();
            this._liquidMaterial = null;
            this._waterShaderUniforms = null;
        }
        if (this._defaultMaterial) {
            this._defaultMaterial = null;
        }
    }

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
