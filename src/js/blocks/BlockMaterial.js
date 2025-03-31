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
					textureAtlas: { value: null },
					time: { value: 0 }
				},
				vertexShader: `
          varying vec2 vUv;
          varying vec3 vPosition;
          varying vec3 vNormal;
          varying vec3 vWorldPosition;
          
          uniform float time;
          
          void main() {
            vUv = uv;
            vPosition = position;
            vNormal = normal;
            vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
            
            vec3 pos = position;
            float wave = sin(pos.x * 2.0 + time) * 0.1;
            pos.y += wave;
            
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
          }
        `,
				fragmentShader: `
          uniform sampler2D textureAtlas;
          uniform float time;
          
          varying vec2 vUv;
          varying vec3 vPosition;
          varying vec3 vNormal;
          varying vec3 vWorldPosition;
          
          void main() {
            vec4 texColor = texture2D(textureAtlas, vUv);
            
            // Make water brighter and more transparent
            float brightness = 1.2; // Increase brightness by 20%
            vec3 brightColor = texColor.rgb * brightness;
            
            // Increase transparency
            float alpha = texColor.a * 0.8; // More transparent (0.6 instead of 0.8)
            
            // Add a slight blue tint to water
            vec3 waterTint = vec3(0.9, 0.9, 1.0); // Light blue tint
            vec3 finalColor = mix(brightColor, waterTint, 0.2); // Mix with 20% tint
            
            gl_FragColor = vec4(finalColor, alpha);
          }
        `,
				transparent: true,
				side: THREE.DoubleSide
			});
		}
		return this._liquidMaterial;
	}
}

// Initialize the singleton instance
BlockMaterial._instance = null;

export default BlockMaterial; 