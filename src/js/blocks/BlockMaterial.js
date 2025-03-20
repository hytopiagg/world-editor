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
            
            // Wave animation calculations
            vec3 pos = position;
            float slowTime = time * 0.5;
            
            // Optimize face checks by combining conditions
            float yOffset = -0.1;
            float normalY = normal.y;
            float absNormalX = abs(normal.x);
            float absNormalZ = abs(normal.z);
            
            // Apply vertical offset to all faces that need it
            if (normalY > 0.5 || absNormalX > 0.5 || absNormalZ > 0.5) {
              pos.y += yOffset;
            }
            
            // Minimal outward push for side faces
            if (absNormalX > 0.5) pos.x += sign(normal.x) * 0.001;
            if (absNormalZ > 0.5) pos.z += sign(normal.z) * 0.001;
            
            // Simplified wave calculation
            vec2 corner = floor(worldPos.xz + 0.5);
            float wave = sin(dot(corner, vec2(0.5)) + slowTime) * cos(dot(corner, vec2(0.5)) + slowTime) * 0.04 +
                         sin(dot(corner, vec2(0.8)) + slowTime * 1.2) * cos(dot(corner, vec2(0.8)) + slowTime * 0.8) * 0.02;
            
            // Only apply negative waves
            wave = min(0.0, wave);
            pos.y += wave;
            
            // Apply inward depression
            float depression = abs(wave) * 0.05;
            if (absNormalX > 0.5) pos.x -= sign(normal.x) * depression;
            if (absNormalZ > 0.5) pos.z -= sign(normal.z) * depression;
            
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
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
            
            gl_FragColor = vec4(color, 0.8);
          }
        `,
        transparent: true,
        depthWrite: false
      });

      // Animate the water
      const animate = () => {
        if (this._liquidMaterial) {
          this._liquidMaterial.uniforms.time.value += 0.0075;
        }
        requestAnimationFrame(animate);
      };
      animate();
    }
    return this._liquidMaterial;
  }
}

// Initialize the singleton instance
BlockMaterial._instance = null;

export default BlockMaterial; 