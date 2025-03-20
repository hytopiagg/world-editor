// BlockTextureAtlas.js
// Manages texture atlas for blocks

import * as THREE from 'three';
import BlockMaterial from './BlockMaterial';

// Padding between textures in the atlas to prevent bleeding
const TEXTURE_IMAGE_PADDING = 2;

/**
 * Manages the texture atlas for blocks
 */
class BlockTextureAtlas {
  constructor() {
    // Create canvas for texture atlas
    this._textureAtlasCanvas = document.createElement('canvas');
    this._textureAtlasCanvas.width = 512;
    this._textureAtlasCanvas.height = 512;
    this._textureAtlasContext = this._textureAtlasCanvas.getContext('2d');
    
    // Create texture from canvas
    this._textureAtlas = new THREE.CanvasTexture(this._textureAtlasCanvas);
    this._textureAtlas.minFilter = THREE.NearestFilter;
    this._textureAtlas.magFilter = THREE.NearestFilter;
    this._textureAtlas.colorSpace = THREE.SRGBColorSpace;
    
    // Map to store texture metadata
    this._textureAtlasMetadata = new Map();
    
    // Track texture load failures and locks
    this._textureLoadFailures = new Set();
    this._textureLoadLocks = {};
    
    // Cache for UV coordinates
    this._textureUVCache = new Map();
    
    // Queue for texture loading
    this._textureLoadQueue = [];
    this._isProcessingQueue = false;
    
    // Set of textures that are essential for initialization
    this._essentialTextures = new Set(['./assets/blocks/error.png']);
    
    // Missing texture warnings
    this._missingTextureWarnings = new Set();
    
    // Debug: uncomment to see the texture atlas canvas
    // document.body.appendChild(this._textureAtlasCanvas);
    // this._textureAtlasCanvas.style.position = 'absolute';
    // this._textureAtlasCanvas.style.bottom = '0px';
    // this._textureAtlasCanvas.style.left = '0px';
  }

  /**
   * Get the singleton instance
   * @returns {BlockTextureAtlas} The singleton instance
   */
  static get instance() {
    if (!this._instance) {
      this._instance = new BlockTextureAtlas();
    }
    return this._instance;
  }

  /**
   * Get the texture atlas
   * @returns {THREE.CanvasTexture} The texture atlas
   */
  get textureAtlas() {
    return this._textureAtlas;
  }

  /**
   * Get metadata for a texture
   * @param {string} textureUri - The texture URI
   * @returns {Object|undefined} The texture metadata
   */
  getTextureMetadata(textureUri) {
    return this._textureAtlasMetadata.get(textureUri);
  }

  /**
   * Get UV coordinates for a texture
   * @param {string} textureUri - The texture URI
   * @param {Array} uvOffset - The UV offset [u, v]
   * @returns {Promise<Array>} The UV coordinates [u, v]
   */
  async getTextureUVCoordinate(textureUri, uvOffset) {
    // For essential textures, ensure they're loaded
    if (this._essentialTextures.has(textureUri)) {
      await this.loadTexture(textureUri);
    } else {
      // For non-essential textures, queue them for loading but don't wait
      this.queueTextureForLoading(textureUri);
    }
    
    return this.getTextureUVCoordinateSync(textureUri, uvOffset);
  }

  /**
   * Queue a texture for loading without waiting for it to complete
   * @param {string} textureUri - The texture URI to queue
   */
  queueTextureForLoading(textureUri) {
    // Skip if already loaded, loading, or failed
    if (this._textureAtlasMetadata.has(textureUri) || 
        this._textureLoadLocks[textureUri] || 
        this._textureLoadFailures.has(textureUri)) {
      return;
    }
    
    // Add to queue if not already in it
    if (!this._textureLoadQueue.includes(textureUri)) {
      this._textureLoadQueue.push(textureUri);
    }
    
    // Start processing the queue if not already processing
    if (!this._isProcessingQueue) {
      this._processTextureLoadQueue();
    }
  }
  
  /**
   * Process the texture load queue asynchronously
   * @private
   */
  async _processTextureLoadQueue() {
    if (this._isProcessingQueue || this._textureLoadQueue.length === 0) {
      return;
    }
    
    this._isProcessingQueue = true;
    
    try {
      while (this._textureLoadQueue.length > 0) {
        const textureUri = this._textureLoadQueue.shift();
        
        // Skip if already loaded, loading, or failed
        if (this._textureAtlasMetadata.has(textureUri) || 
            this._textureLoadLocks[textureUri] || 
            this._textureLoadFailures.has(textureUri)) {
          continue;
        }
        
        try {
          await this.loadTexture(textureUri);
        } catch (error) {
          // Already logged in loadTexture
        }
        
        // Yield to main thread after each texture
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } finally {
      this._isProcessingQueue = false;
    }
  }

  /**
   * Get UV coordinates for a texture (synchronous version)
   * @param {string} textureUri - The texture URI
   * @param {Array} uvOffset - The UV offset [u, v]
   * @returns {Array} The UV coordinates [u, v]
   */
  getTextureUVCoordinateSync(textureUri, uvOffset) {
    // Create a cache key from the texture URI and UV offset
    const cacheKey = `${textureUri}-${uvOffset[0]}-${uvOffset[1]}`;
    
    // Check if we have a cached result
    if (this._textureUVCache.has(cacheKey)) {
      return this._textureUVCache.get(cacheKey);
    }
    
    // Handle undefined texture URI
    if (!textureUri) {
      // Try to use the error texture
      const errorUri = './assets/blocks/error.png';
      const errorMetadata = this._textureAtlasMetadata.get(errorUri);
      
      if (errorMetadata) {
        const result = this._calculateUVCoordinates(errorMetadata, uvOffset);
        this._textureUVCache.set(cacheKey, result);
        return result;
      }
      
      // If error texture not loaded, return default UV coordinates
      const defaultResult = [0, 0];
      this._textureUVCache.set(cacheKey, defaultResult);
      return defaultResult;
    }
    
    // Check if the texture is already in the atlas
    let metadata = this._textureAtlasMetadata.get(textureUri);
    
    // If not found, check if it's a multi-sided texture path
    if (!metadata) {
      // First, try the exact path with common extensions if it doesn't have one
      if (!textureUri.match(/\.(png|jpe?g)$/i)) {
        const withExtension = `${textureUri}.png`;
        metadata = this._textureAtlasMetadata.get(withExtension);
        
        if (metadata) {
          const result = this._calculateUVCoordinates(metadata, uvOffset);
          this._textureUVCache.set(cacheKey, result);
          return result;
        }
      }
      
      // Try common face patterns for multi-sided textures
      const possibleFacePaths = [
        `${textureUri}/all.png`,            // Try all-faces texture
        `${textureUri}/default.png`,        // Try default texture
        `${textureUri}/+y.png`,             // Try top face
        `${textureUri}/-y.png`,             // Try bottom face
        `${textureUri}/+x.png`,             // Try right face
        `${textureUri}/-x.png`,             // Try left face
        `${textureUri}/+z.png`,             // Try front face
        `${textureUri}/-z.png`              // Try back face
      ];
      
      // Try each possible path
      for (const path of possibleFacePaths) {
        const pathMetadata = this._textureAtlasMetadata.get(path);
        if (pathMetadata) {
          metadata = pathMetadata;
          break;
        }
      }
      
      // If still not found, try to extract the base path and check for textures
      if (!metadata && textureUri.includes('/')) {
        const basePath = textureUri.split('/').slice(0, -1).join('/');
        const basePathWithExtensions = [
          `${basePath}/all.png`,
          `${basePath}/default.png`,
          `${basePath}/+y.png`,
          `${basePath}.png`
        ];
        
        for (const path of basePathWithExtensions) {
          const pathMetadata = this._textureAtlasMetadata.get(path);
          if (pathMetadata) {
            metadata = pathMetadata;
            break;
          }
        }
      }
    }
    
    // If still no metadata, use error texture
    if (!metadata) {
      const errorUri = './assets/blocks/error.png';
      metadata = this._textureAtlasMetadata.get(errorUri);
      
      // If error texture not loaded, return default UV coordinates
      if (!metadata) {
        // Only log this once per texture to avoid spamming the console
        if (!this._missingTextureWarnings.has(textureUri)) {
          console.warn(`Texture not found in atlas: ${textureUri}`);
          this._missingTextureWarnings.add(textureUri);
          
          // Queue this texture for loading
          this.queueTextureForLoading(textureUri);
        }
        
        const defaultResult = [0, 0];
        this._textureUVCache.set(cacheKey, defaultResult);
        return defaultResult;
      }
    }
    
    const result = this._calculateUVCoordinates(metadata, uvOffset);
    this._textureUVCache.set(cacheKey, result);
    return result;
  }
  
  /**
   * Calculate UV coordinates from metadata
   * @param {Object} metadata - The texture metadata
   * @param {Array} uvOffset - The UV offset [u, v]
   * @returns {Array} The UV coordinates [u, v]
   * @private
   */
  _calculateUVCoordinates(metadata, uvOffset) {
    const atlasWidth = this._textureAtlasCanvas.width;
    const atlasHeight = this._textureAtlasCanvas.height;

    const imageX = metadata.x + TEXTURE_IMAGE_PADDING;
    const imageInvertedY = metadata.invertedY + TEXTURE_IMAGE_PADDING;
    const tileWidth = metadata.width - TEXTURE_IMAGE_PADDING * 2;
    const tileHeight = metadata.height - TEXTURE_IMAGE_PADDING * 2;

    // Calculate UV coordinates within atlas, taking into account texture position and size
    // Flip the V coordinate by using (1 - uvOffset[1]) to invert the texture vertically due to our
    // atlas having Y coordinates inverted from being a canvas.
    const u = (imageX + (uvOffset[0] * tileWidth)) / atlasWidth;
    const v = (atlasHeight - imageInvertedY - ((1 - uvOffset[1]) * tileHeight)) / atlasHeight;

    return [u, v];
  }

  /**
   * Load a texture into the atlas
   * @param {string} textureUri - The texture URI
   * @returns {Promise<void>}
   */
  async loadTexture(textureUri) {
    // Check if texture is already loading
    if (this._textureLoadLocks[textureUri]) {
      await this._textureLoadLocks[textureUri];
      return;
    }

    // Check if texture is already loaded or failed
    if (this._textureAtlasMetadata.has(textureUri) || this._textureLoadFailures.has(textureUri)) {
      return;
    }

    // Create a promise to load the texture
    const loadPromise = new Promise((resolve, reject) => {
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(
        textureUri,
        texture => {
          if (!texture.image) {
            reject(new Error(`Failed to load texture image for URI: ${textureUri}`));
            return;
          }
          
          // Draw texture to atlas and store metadata
          this._textureAtlasMetadata.set(textureUri, this._drawTextureToAtlas(texture));
          
          // Update materials with new atlas
          BlockMaterial.instance.setTextureAtlas(this._textureAtlas);
          
          resolve();
        },
        undefined,
        error => {
          console.error(`Failed to load texture: ${textureUri}`);
          console.error(error);

          // Prevent retries on textures that failed to load
          this._textureLoadFailures.add(textureUri);
          reject(error);
        }
      );
    });

    // Store the promise to prevent duplicate loads
    this._textureLoadLocks[textureUri] = loadPromise;

    try {
      await loadPromise;
    } finally {
      this._textureLoadLocks[textureUri] = undefined;
    }
  }

  /**
   * Draw a texture to the atlas
   * @param {THREE.Texture} texture - The texture to draw
   * @returns {Object} The texture metadata
   * @private
   */
  _drawTextureToAtlas(texture) {
    if (!this._textureAtlasContext) {
      throw new Error('Texture atlas context not found!');
    }

    const canvasWidth = this._textureAtlasCanvas.width;
    const canvasHeight = this._textureAtlasCanvas.height;
    const imageWidth = texture.image.width;
    const imageHeight = texture.image.height;
    const tileWidth = imageWidth + TEXTURE_IMAGE_PADDING * 2;
    const tileHeight = imageHeight + TEXTURE_IMAGE_PADDING * 2;
    
    // Create metadata object
    const metadata = {
      x: 0,
      invertedY: 0,
      width: tileWidth,
      height: tileHeight,
      isTransparent: this._textureIsTransparent(texture)
    };

    // Try to find space in current canvas dimensions
    let foundSpace = false;
    const existingTextures = Array.from(this._textureAtlasMetadata.values());

    // Check each row for available space, 
    // Scan rows from top to bottom
    for (let y = 0; y <= canvasHeight - tileHeight && !foundSpace; y++) {
      // Scan columns from left to right
      for (let x = 0; x <= canvasWidth - tileWidth; x++) {
        // Check for overlap with existing textures
        const hasOverlap = existingTextures.some(existing => 
          x < existing.x + existing.width &&
          x + tileWidth > existing.x &&
          y < existing.invertedY + existing.height &&
          y + tileHeight > existing.invertedY
        );

        if (!hasOverlap) {
          metadata.x = x;
          metadata.invertedY = y;
          foundSpace = true;
          break;
        }
      }
    }

    // If no space found, resize canvas
    if (!foundSpace) {
      // Create temporary canvas to store current content
      const tempCanvas = document.createElement('canvas');
      const tempContext = tempCanvas.getContext('2d');
      if (!tempContext) throw new Error('Failed to create temporary context');
      
      tempCanvas.width = canvasWidth;
      tempCanvas.height = canvasHeight;
      tempContext.drawImage(this._textureAtlasCanvas, 0, 0);

      // Double canvas size in smaller dimension
      if (canvasWidth <= canvasHeight) {
        this._textureAtlasCanvas.width = canvasWidth * 2;
        metadata.x = canvasWidth;
        metadata.invertedY = 0;
      } else {
        this._textureAtlasCanvas.height = canvasHeight * 2;
        metadata.x = 0;
        metadata.invertedY = canvasHeight;
      }

      // Restore previous content
      this._textureAtlasContext.drawImage(tempCanvas, 0, 0);

      // Recreate the CanvasTexture
      this._textureAtlas.dispose(); // Dispose of the old texture
      this._textureAtlas = new THREE.CanvasTexture(this._textureAtlasCanvas);
      this._textureAtlas.minFilter = THREE.NearestFilter;
      this._textureAtlas.magFilter = THREE.NearestFilter;
      this._textureAtlas.colorSpace = THREE.SRGBColorSpace;
    }

    // Creating TextureAtlas tiles directly from texture images causes seam-like artifacts
    // between voxels. This seems to be due to color gaps between tiles. To fix this,
    // redundant padding is added around image when generating the tile, resolving
    // the artifact issue.

    // Center (Main)
    this._textureAtlasContext.drawImage(
      texture.image,
      0, // sx
      0, // sy
      imageWidth, // sw
      imageHeight, // sh
      metadata.x + TEXTURE_IMAGE_PADDING, // dx
      metadata.invertedY + TEXTURE_IMAGE_PADDING, // dy
      imageWidth, // dw
      imageHeight, // dh
    );

    // Top
    this._textureAtlasContext.drawImage(
      texture.image,
      0, // sx
      0, // sy
      imageWidth, // sw
      1, // sh
      metadata.x + TEXTURE_IMAGE_PADDING, // dx
      metadata.invertedY, // dy
      imageWidth, // dw
      TEXTURE_IMAGE_PADDING, // dh
    );

    // Bottom
    this._textureAtlasContext.drawImage(
      texture.image,
      0, // sx
      imageHeight - 1, // sy
      imageWidth, // sw
      1, // sh
      metadata.x + TEXTURE_IMAGE_PADDING, // dx
      metadata.invertedY + imageHeight + TEXTURE_IMAGE_PADDING, // dy
      imageWidth, // dw
      TEXTURE_IMAGE_PADDING, // dh
    );

    // Left
    this._textureAtlasContext.drawImage(
      texture.image,
      0, // sx
      0, // sy
      1, // sw
      imageHeight, // sh
      metadata.x, // dx
      metadata.invertedY + TEXTURE_IMAGE_PADDING, // dy
      TEXTURE_IMAGE_PADDING, // dw
      imageHeight, // dh
    );

    // Right
    this._textureAtlasContext.drawImage(
      texture.image,
      imageWidth - 1, // sx
      0, // sy
      1, // sw
      imageHeight, // sh
      metadata.x + imageWidth + TEXTURE_IMAGE_PADDING, // dx
      metadata.invertedY + TEXTURE_IMAGE_PADDING, // dy
      TEXTURE_IMAGE_PADDING, // dw
      imageHeight, // dh
    );

    // Top Left
    this._textureAtlasContext.drawImage(
      texture.image,
      0, // sx
      0, // sy
      1, // sw
      1, // sh
      metadata.x, // dx
      metadata.invertedY, // dy
      TEXTURE_IMAGE_PADDING, // dw
      TEXTURE_IMAGE_PADDING, // dh
    );

    // Top Right
    this._textureAtlasContext.drawImage(
      texture.image,
      imageWidth - 1, // sx
      0, // sy
      1, // sw
      1, // sh
      metadata.x + imageWidth + TEXTURE_IMAGE_PADDING, // dx
      metadata.invertedY, // dy
      TEXTURE_IMAGE_PADDING, // dw
      TEXTURE_IMAGE_PADDING, // dh
    );

    // Bottom Left
    this._textureAtlasContext.drawImage(
      texture.image,
      0, // sx
      imageHeight - 1, // sy
      1, // sw
      1, // sh
      metadata.x, // dx
      metadata.invertedY + imageHeight + TEXTURE_IMAGE_PADDING, // dy
      TEXTURE_IMAGE_PADDING, // dw
      TEXTURE_IMAGE_PADDING, // dh
    );

    // Bottom Right
    this._textureAtlasContext.drawImage(
      texture.image,
      imageWidth - 1, // sx
      imageHeight - 1, // sy
      1, // sw
      1, // sh
      metadata.x + imageWidth + TEXTURE_IMAGE_PADDING, // dx
      metadata.invertedY + imageHeight + TEXTURE_IMAGE_PADDING, // dy
      TEXTURE_IMAGE_PADDING, // dw
      TEXTURE_IMAGE_PADDING, // dh
    );

    // Update texture
    this._textureAtlas.needsUpdate = true;

    return metadata;
  }

  /**
   * Check if a texture has transparency
   * @param {THREE.Texture} texture - The texture to check
   * @returns {boolean} True if the texture has transparency
   * @private
   */
  _textureIsTransparent(texture) {
    // Create a temporary canvas to analyze the texture
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Failed to create temporary context');

    canvas.width = texture.image.width;
    canvas.height = texture.image.height;
    context.drawImage(texture.image, 0, 0);

    // Get image data and check alpha values
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Check each pixel's alpha value, if it's less than 255 then the texture has transparency
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) {
        return true;
      }
    }

    return false; // No transparent pixels found
  }
  
  /**
   * Mark a texture as essential for initialization
   * @param {string} textureUri - The texture URI to mark as essential
   */
  markTextureAsEssential(textureUri) {
    this._essentialTextures.add(textureUri);
  }
  
  /**
   * Clear the texture UV cache
   */
  clearTextureUVCache() {
    this._textureUVCache.clear();
  }
  
  /**
   * Reset and rebuild the texture atlas
   * This will clear the current atlas and reload all essential textures
   * @returns {Promise<boolean>} True if successful
   */
  async rebuildTextureAtlas() {
    try {
      console.log("Rebuilding texture atlas...");
      
      // Clear caches
      this._textureUVCache.clear();
      
      // Clear the canvas
      this._textureAtlasContext.clearRect(0, 0, this._textureAtlasCanvas.width, this._textureAtlasCanvas.height);
      
      // Reset metadata
      this._textureAtlasMetadata = new Map();
      
      // Reset failure tracking
      this._textureLoadFailures = new Set();
      
      // Force texture update
      this._textureAtlas.needsUpdate = true;
      
      // Reload essential textures
      for (const textureUri of this._essentialTextures) {
        try {
          await this.loadTexture(textureUri);
        } catch (error) {
          console.error(`Failed to reload essential texture ${textureUri}:`, error);
        }
      }
      
      console.log("Texture atlas rebuilt successfully");
      return true;
    } catch (error) {
      console.error("Error rebuilding texture atlas:", error);
      return false;
    }
  }
}

// Initialize the singleton instance
BlockTextureAtlas._instance = null;

export default BlockTextureAtlas; 