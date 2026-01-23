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
const UNIFORM_CUSTOM_EMISSIVE = 'customEmissive';
const UNIFORM_CUSTOM_EMISSIVE_INTENSITY = 'customEmissiveIntensity';
const UNIFORM_CUSTOM_EMISSIVEMAP = 'customEmissiveMap';

export default class EmissiveMeshBasicMaterial extends MeshBasicMaterial {
  private _customEmissive: Color;
  private _customEmissiveIntensity: number;
  private _customEmissiveMap: Texture | null;
  private _shaderProcessors: ShaderProcessor[] = [];

  constructor(parameters?: MeshBasicMaterialParameters & {
    emissive?: Color | string | number;
    emissiveIntensity?: number;
    emissiveMap?: Texture | null;
  }) {
    const { emissive, emissiveIntensity, emissiveMap, ...basicParams } = parameters || {};
    super(basicParams);

    this.defines = this.defines || {};
    this._customEmissive = new Color(emissive ?? 0x000000);
    this._customEmissiveIntensity = emissiveIntensity ?? 1.0;
    this._customEmissiveMap = emissiveMap ?? null;
    // Hack for update defines
    this.customEmissiveMap = this._customEmissiveMap;

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

            void main() {
              #ifdef ${DEFINE_USE_CUSTOM_EMISSIVEMAP}
                vCustomEmissiveMapUv = uv;
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
            void main() {
          `,
        )
        .replace(
          '#include <opaque_fragment>',
          `
            vec3 emissiveColor = ${UNIFORM_CUSTOM_EMISSIVE} * ${UNIFORM_CUSTOM_EMISSIVE_INTENSITY};
            #ifdef ${DEFINE_USE_CUSTOM_EMISSIVEMAP}
              emissiveColor *= texture2D(${UNIFORM_CUSTOM_EMISSIVEMAP}, vCustomEmissiveMapUv).rgb;
            #endif
            outgoingLight += emissiveColor;
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
    return this;
  }
}
