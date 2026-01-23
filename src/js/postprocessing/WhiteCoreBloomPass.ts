import { Vector2 } from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/**
 * Bloom pass with white core effect and tone mapping (matching SDK).
 * - White core: bright bloom becomes desaturated (white)
 * - Tone mapping: ACES Filmic applied to bloom component only
 */
export class WhiteCoreBloomPass extends UnrealBloomPass {
  constructor(resolution: Vector2, strength: number, radius: number, threshold: number) {
    super(resolution, strength, radius, threshold);

    // Override the blend material's fragment shader for white-core effect (matching SDK)
    // blendMaterial is the final step that blends bloom with the original scene
    (this as any).blendMaterial.fragmentShader = `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() {
        vec3 bloom = texture2D(tDiffuse, vUv).rgb;

        // Desaturate bright bloom towards white based on luminance
        float luminance = dot(bloom, vec3(0.2126, 0.7152, 0.0722));
        float whiteFactor = smoothstep(1.0, 3.0, luminance);
        bloom = mix(bloom, vec3(luminance), whiteFactor);

        // ACES Filmic tone mapping
        float a = 2.51;
        float b = 0.03;
        float c = 2.43;
        float d = 0.59;
        float e = 0.14;
        bloom = clamp((bloom * (a * bloom + b)) / (bloom * (c * bloom + d) + e), 0.0, 1.0);

        gl_FragColor = vec4(bloom, 1.0);
      }
    `;
    (this as any).blendMaterial.needsUpdate = true;
  }
}

export default WhiteCoreBloomPass;
