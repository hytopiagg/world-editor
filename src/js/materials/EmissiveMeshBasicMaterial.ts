import {
  Color,
  MeshBasicMaterial,
  MeshBasicMaterialParameters,
  Texture,
  WebGLProgramParametersWithUniforms,
  WebGLRenderer,
} from 'three';

export type ShaderProcessor = (params: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => void;

const DEFINE_USE_CUSTOM_EMISSIVEMAP = 'USE_CUSTOM_EMISSIVEMAP';
const DEFINE_USE_INSTANCED_EMISSIVE = 'USE_INSTANCED_EMISSIVE';
const DEFINE_USE_INSTANCED_OPACITY = 'USE_INSTANCED_OPACITY';
const UNIFORM_CUSTOM_EMISSIVE = 'customEmissive';
const UNIFORM_CUSTOM_EMISSIVE_INTENSITY = 'customEmissiveIntensity';
const UNIFORM_CUSTOM_EMISSIVEMAP = 'customEmissiveMap';

export default class EmissiveMeshBasicMaterial extends MeshBasicMaterial {
  private _customEmissive: Color;
  private _customEmissiveIntensity: number;
  private _customEmissiveMap: Texture | null;
  private _shaderProcessors: ShaderProcessor[] = [];
  private _useInstancedEmissive: boolean = false;
  private _useInstancedOpacity: boolean = false;

  // Store original glTF emissive values for restoration
  private _originalEmissive: Color;
  private _originalEmissiveIntensity: number;

  constructor(parameters?: MeshBasicMaterialParameters & {
    emissive?: Color | string | number;
    emissiveIntensity?: number;
    emissiveMap?: Texture | null;
    useInstancedEmissive?: boolean;
    useInstancedOpacity?: boolean;
  }) {
    const { emissive, emissiveIntensity, emissiveMap, useInstancedEmissive, useInstancedOpacity, ...basicParams } = parameters || {};
    super(basicParams);

    this.defines = this.defines || {};
    this._customEmissive = new Color(emissive ?? 0x000000);
    this._customEmissiveIntensity = emissiveIntensity ?? 1.0;
    this._customEmissiveMap = emissiveMap ?? null;
    this._useInstancedEmissive = useInstancedEmissive ?? false;
    this._useInstancedOpacity = useInstancedOpacity ?? false;

    // Cache original glTF values for later restoration (matching SDK behavior)
    this._originalEmissive = this._customEmissive.clone();
    this._originalEmissiveIntensity = this._customEmissiveIntensity;

    // Set up defines
    this.customEmissiveMap = this._customEmissiveMap;
    this.useInstancedEmissive = this._useInstancedEmissive;
    this.useInstancedOpacity = this._useInstancedOpacity;

    this._shaderProcessors.push(this._createEmissiveProcessor());
  }

  public get customEmissive(): Color {
    return this._customEmissive;
  }

  public get customEmissiveIntensity(): number {
    return this._customEmissiveIntensity;
  }

  public set customEmissiveIntensity(intensity: number) {
    this._customEmissiveIntensity = intensity;
  }

  public get customEmissiveMap(): Texture | null {
    return this._customEmissiveMap;
  }

  public set customEmissiveMap(map: Texture | null) {
    this._customEmissiveMap = map;
    if (this._customEmissiveMap !== null) {
      this.defines![DEFINE_USE_CUSTOM_EMISSIVEMAP] = '';
    } else {
      delete this.defines![DEFINE_USE_CUSTOM_EMISSIVEMAP];
    }
    this.needsUpdate = true;
  }

  /**
   * Restore original glTF emissive values (matching SDK behavior).
   * When emissive is disabled, this restores the original baked-in values
   * rather than setting to black/0.
   */
  restoreOriginalEmissive(): void {
    this._customEmissive.copy(this._originalEmissive);
    this._customEmissiveIntensity = this._originalEmissiveIntensity;
  }

  public get useInstancedEmissive(): boolean {
    return this._useInstancedEmissive;
  }

  public set useInstancedEmissive(value: boolean) {
    this._useInstancedEmissive = value;
    if (value) {
      this.defines![DEFINE_USE_INSTANCED_EMISSIVE] = '';
    } else {
      delete this.defines![DEFINE_USE_INSTANCED_EMISSIVE];
    }
    this.needsUpdate = true;
  }

  public get useInstancedOpacity(): boolean {
    return this._useInstancedOpacity;
  }

  public set useInstancedOpacity(value: boolean) {
    this._useInstancedOpacity = value;
    if (value) {
      this.defines![DEFINE_USE_INSTANCED_OPACITY] = '';
    } else {
      delete this.defines![DEFINE_USE_INSTANCED_OPACITY];
    }
    this.needsUpdate = true;
  }

  addShaderProcessor(processor: ShaderProcessor, atEnd: boolean = false): void {
    if (atEnd) {
      this._shaderProcessors.push(processor);
    } else {
      // Add new processors at the start so the emissive processor (added via push in the constructor) remains last in execution order
      this._shaderProcessors.unshift(processor);
    }
  }

  removeShaderProcessor(processor: ShaderProcessor): boolean {
    const index = this._shaderProcessors.indexOf(processor);
    if (index !== -1) {
      this._shaderProcessors.splice(index, 1);
      return true;
    }
    return false;
  }

  onBeforeCompile(params: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer): void {
    super.onBeforeCompile(params, renderer);

    for (const processor of this._shaderProcessors) {
      processor(params, renderer);
    }
  }

  private _createEmissiveProcessor(): ShaderProcessor {
    const self = this;
    return (params: WebGLProgramParametersWithUniforms, _renderer: WebGLRenderer) => {
      params.uniforms[UNIFORM_CUSTOM_EMISSIVE] = { value: this._customEmissive };
      params.uniforms[UNIFORM_CUSTOM_EMISSIVE_INTENSITY] = { get value() { return self._customEmissiveIntensity; } };
      params.uniforms[UNIFORM_CUSTOM_EMISSIVEMAP] = { get value() { return self._customEmissiveMap; } };

      params.vertexShader = params.vertexShader
        .replace(
          'void main() {',
          `
            #ifdef ${DEFINE_USE_CUSTOM_EMISSIVEMAP}
              varying vec2 vCustomEmissiveMapUv;
            #endif
            #ifdef ${DEFINE_USE_INSTANCED_EMISSIVE}
              attribute vec4 instanceEmissive;
              varying vec4 vInstanceEmissive;
            #endif
            #ifdef ${DEFINE_USE_INSTANCED_OPACITY}
              attribute float instanceOpacity;
              varying float vInstanceOpacity;
            #endif

            void main() {
              #ifdef ${DEFINE_USE_CUSTOM_EMISSIVEMAP}
                vCustomEmissiveMapUv = uv;
              #endif
              #ifdef ${DEFINE_USE_INSTANCED_EMISSIVE}
                vInstanceEmissive = instanceEmissive;
              #endif
              #ifdef ${DEFINE_USE_INSTANCED_OPACITY}
                vInstanceOpacity = instanceOpacity;
              #endif
          `
        );

      params.fragmentShader = params.fragmentShader
        .replace(
          'void main() {',
          `
            uniform vec3 ${UNIFORM_CUSTOM_EMISSIVE};
            uniform float ${UNIFORM_CUSTOM_EMISSIVE_INTENSITY};
            #ifdef ${DEFINE_USE_CUSTOM_EMISSIVEMAP}
              uniform sampler2D ${UNIFORM_CUSTOM_EMISSIVEMAP};
              varying vec2 vCustomEmissiveMapUv;
            #endif
            #ifdef ${DEFINE_USE_INSTANCED_EMISSIVE}
              varying vec4 vInstanceEmissive;
            #endif
            #ifdef ${DEFINE_USE_INSTANCED_OPACITY}
              varying float vInstanceOpacity;
            #endif
            void main() {
          `,
        )
        .replace(
          '#include <opaque_fragment>',
          `
            #ifdef ${DEFINE_USE_INSTANCED_EMISSIVE}
              vec3 emissiveColor = vInstanceEmissive.rgb * vInstanceEmissive.a;
            #else
              vec3 emissiveColor = ${UNIFORM_CUSTOM_EMISSIVE} * ${UNIFORM_CUSTOM_EMISSIVE_INTENSITY};
            #endif
            #ifdef ${DEFINE_USE_CUSTOM_EMISSIVEMAP}
              emissiveColor *= texture2D(${UNIFORM_CUSTOM_EMISSIVEMAP}, vCustomEmissiveMapUv).rgb;
            #endif
            outgoingLight += emissiveColor;
            #ifdef ${DEFINE_USE_INSTANCED_OPACITY}
              diffuseColor.a *= vInstanceOpacity;
            #endif
            #include <opaque_fragment>
          `,
        );
    };
  }

  clone(): this {
    return new (this.constructor as typeof EmissiveMeshBasicMaterial)().copy(this) as this;
  }

  copy(source: EmissiveMeshBasicMaterial): this {
    super.copy(source);
    this._customEmissive.copy(source._customEmissive);
    this._customEmissiveIntensity = source._customEmissiveIntensity;
    this.customEmissiveMap = source._customEmissiveMap;
    this.useInstancedEmissive = source._useInstancedEmissive;
    this.useInstancedOpacity = source._useInstancedOpacity;
    // Copy original values for proper restoration behavior
    this._originalEmissive.copy(source._originalEmissive);
    this._originalEmissiveIntensity = source._originalEmissiveIntensity;
    return this;
  }
}
