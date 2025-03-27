// BlockMaterial.js
// Manages materials for blocks

import * as THREE from 'three';

/**
 * Singleton class for managing block materials
 */
class BlockMaterial {
  constructor() {
    this._defaultMaterial = null;
    this._liquidMaterial = null;
  }

  /**
   * Get the singleton instance
   * @returns {BlockMaterial} The singleton instance
   */
  static get instance() {
    if (!this._instance) {
      this._instance = new BlockMaterial();
    }
    return this._instance;
  }

  /**
   * Get the default material for solid blocks
   * @returns {THREE.MeshPhongMaterial} The default material
   */
  get defaultMaterial() {
    if (!this._defaultMaterial) {
      // Create a new material if it doesn't exist
      this._defaultMaterial = new THREE.MeshPhongMaterial({
        map: null, // Will be set by TextureAtlas
        side: THREE.FrontSide,
        vertexColors: true,
        transparent: true,
        alphaTest: 0.1,
        shininess: 0,
        specular: 0x000000
      });
    }
    return this._defaultMaterial;
  }

  /**
   * Set the texture atlas for the default material
   * @param {THREE.Texture} textureAtlas - The texture atlas
   */
  setTextureAtlas(textureAtlas) {
    if (this._defaultMaterial) {
      this._defaultMaterial.map = textureAtlas;
      this._defaultMaterial.needsUpdate = true;
    }
    
    if (this._liquidMaterial) {
      this._liquidMaterial.uniforms.textureAtlas.value = textureAtlas;
    }
  }

  /**
   * Get the material for liquid blocks
   * @returns {THREE.ShaderMaterial} The liquid material
   */
  get liquidMaterial() {
    if (!this._liquidMaterial) {
      // Create a new shader material for liquids
      this._liquidMaterial = new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          textureAtlas: { value: null }, // Will be set by TextureAtlas
          ambientLightColor: { value: new THREE.Color(0xffffff) },
          ambientLightIntensity: { value: 0.8 }
        },
        vertexShader: `
          uniform float time;
          varying vec3 vNormal;
          varying vec3 vViewVector;
          varying vec2 vUv;
          varying vec3 vWorldPos;
          
          void main() {
            vNormal = normalize(normalMatrix * normal);
            vUv = uv;
            
            // Calculate world position and view vector
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPos = worldPos.xyz;
            vViewVector = normalize(cameraPosition - worldPos.xyz);
            
          
          }
        `,
        fragmentShader: `
          uniform float time;
          uniform sampler2D textureAtlas;
          uniform vec3 ambientLightColor;
          uniform float ambientLightIntensity;

          varying vec3 vNormal;
          varying vec3 vViewVector;
          varying vec2 vUv;
          varying vec3 vWorldPos;

          void main() {
            vec4 texColor = texture2D(textureAtlas, vUv);
            
            // Early alpha test
            if (texColor.a < 0.2) {
              discard;
            }
            
            vec3 color = texColor.rgb;
            
            // Apply ambient light
            vec3 ambientLight = ambientLightColor * ambientLightIntensity;
            color *= ambientLight;
            
            // Only calculate lighting for top faces
            if (vNormal.y > 0.5) {
                vec3 lightDir = normalize(vec3(0.5, -0.8, 0.3));
                float fresnel = pow(1.0 - dot(vNormal, vViewVector), 4.0);
                float diffuse = max(dot(vNormal, -lightDir), 0.0);
                
                // Combine lighting calculations
                vec3 halfVector = normalize(-lightDir + vViewVector);
                float specular = pow(max(dot(vNormal, halfVector), 0.0), 24.0);
                float waveLighting = sin(dot(vWorldPos.xz, vec2(2.0)) + time * 0.5) * 0.1;
                
                // Combine lighting effects
                color = color * (0.7 + diffuse * 0.3) + 
                        vec3(0.15) * specular +
                        vec3(0.08, 0.12, 0.15) * fresnel +
                        vec3(0.03, 0.05, 0.08) * waveLighting;
            }
            texColor.a = 0.8;
            gl_FragColor = texColor;
          }
        `,
        transparent: true,
        depthWrite: false,
		blendSrcAlpha: THREE.SrcAlphaFactor,
		blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
		opacity: 0.8,
      });

      
    }
    return this._liquidMaterial;
  }
}

// Initialize the singleton instance
BlockMaterial._instance = null;

export default BlockMaterial; 