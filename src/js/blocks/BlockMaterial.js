// BlockMaterial.js
// Manages materials for blocks

import * as THREE from "three";

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
                specular: 0x000000,
            });
        }
        return this._defaultMaterial;
    }

    /**
     * Set the texture atlas for the default material
     * @param {THREE.Texture} textureAtlas - The texture atlas
     */
    setTextureAtlas(textureAtlas) {
        // Configure nearest neighbor filtering for pixelated look
        if (textureAtlas) {
            // Disable mipmaps since we want crisp pixels
            textureAtlas.generateMipmaps = false;

            // Use nearest neighbor filtering
            textureAtlas.minFilter = THREE.NearestFilter;
            textureAtlas.magFilter = THREE.NearestFilter;

            // Disable anisotropic filtering
            textureAtlas.anisotropy = 1;

            // Set wrapS and wrapT to clamp to edge to prevent texture bleeding
            textureAtlas.wrapS = THREE.ClampToEdgeWrapping;
            textureAtlas.wrapT = THREE.ClampToEdgeWrapping;

            // Force texture update
            textureAtlas.needsUpdate = true;
        }

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
                    time: { value: 0 },
                    filter: { value: THREE.NearestFilter },
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
            
            // Only create waves on the top surface (where normal.y is near 1)
            float isTopSurface = step(0.9, normal.y);
            
            // Create subtle waves with multiple frequencies
            vec3 pos = position;
            
            if (isTopSurface > 0.5) {
              // Lower the top surface by 0.1 units
              pos.y -= 0.1;
              
              // Add wave animation
              float wave1 = sin(pos.x * 2.0 + time) * 0.03;
              float wave2 = cos(pos.z * 3.0 + time * 0.7) * 0.02;
              float wave3 = sin(pos.x * 5.0 + pos.z * 5.0 + time * 2.0) * 0.01;
              
              // Combine waves with smaller amplitude
              float combinedWave = wave1 + wave2 + wave3;
              
              // Add waves to top face only
              pos.y += combinedWave;
            }
            
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
            float brightness = 1.3;
            vec3 brightColor = texColor.rgb * brightness;
            
            // Increase transparency
            float alpha = texColor.a * 0.75;
            
            // Add a slight blue tint to water
            vec3 waterTint = vec3(0.9, 0.9, 1.0);
            vec3 finalColor = mix(brightColor, waterTint, 0.2);
            
            // Add subtle ripples on top faces only
            if (vNormal.y > 0.9) {
              float waveTime = time * 2.0;
              
              // Create subtle ripple pattern
              float wave1 = sin(vWorldPosition.x * 8.0 + vWorldPosition.z * 6.0 + waveTime) * 0.5 + 0.5;
              float wave2 = sin(vWorldPosition.x * 5.0 - vWorldPosition.z * 7.0 + waveTime * 0.8) * 0.5 + 0.5;
              
              float combinedWave = (wave1 * 0.65 + wave2 * 0.45);
              float rippleFactor = combinedWave * 0.15; // 10% intensity
              
              // Apply subtle highlights to the water surface
              vec3 highlightColor = vec3(1.0, 1.0, 1.0);
              finalColor = mix(finalColor, highlightColor, rippleFactor);
            }
            
            gl_FragColor = vec4(finalColor, alpha);
          }
        `,
                transparent: true,
                side: THREE.DoubleSide,
            });

            // Disable mipmapping features for shader material
            this._liquidMaterial.extensions = {
                derivatives: false,
                fragDepth: false,
                drawBuffers: false,
                shaderTextureLOD: false,
            };
        }
        return this._liquidMaterial;
    }
}

// Initialize the singleton instance
BlockMaterial._instance = null;

export default BlockMaterial;
