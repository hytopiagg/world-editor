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
    
    // Timer for batched texture updates
    this._updateTimer = null;
    
    // Debug: uncomment to see the texture atlas canvas
    // document.body.appendChild(this._textureAtlasCanvas);
    // this._textureAtlasCanvas.style.position = 'absolute';
    // this._textureAtlasCanvas.style.bottom = '0px';
    // this._textureAtlasCanvas.style.left = '0px';
  }

  /**
   * Initialize the texture atlas with required textures
   * @returns {Promise<void>}
   */
  async initialize() {
    console.log("🧊 Initializing BlockTextureAtlas...");
    
    try {
      // Try to load error texture first as it's a fallback
      await this.loadTexture('./assets/blocks/error.png');
      
      // Define a list of multi-sided block types to automatically preload
      const multiSidedBlockTypes = [
        'grass',
        // Add other multi-sided block types here:
        // 'wood',
        // 'stone',
        // etc.
      ];
      
      // Define a list of single-texture files to automatically preload
      const singleTextureFiles = [
        'water-still.png',
        'water-flow.png',
        'lava.png',
        // Add other single-texture files here as needed
      ];
      
      // Preload all multi-sided block types
      for (const blockType of multiSidedBlockTypes) {
        try {
          await this.preloadMultiSidedTextures(blockType);
        } catch (error) {
          // Continue with other block types even if one fails
        }
      }
      
      // Preload all single-texture files without logging each one
      for (const textureFile of singleTextureFiles) {
        try {
          await this.preloadMultiSidedTextures(textureFile);
        } catch (error) {
          // Continue with other textures even if one fails
        }
      }
      
      console.log("✅ BlockTextureAtlas initialization complete!");
    } catch (error) {
      console.error("❌ Error initializing BlockTextureAtlas:", error);
    }
  }

  /**
   * Get singleton instance
   * @returns {BlockTextureAtlas}
   */
  static get instance() {
    if (!BlockTextureAtlas._instance) {
      BlockTextureAtlas._instance = new BlockTextureAtlas();
      console.log("Created BlockTextureAtlas singleton instance");
      
      // Expose to window for debugging
      if (typeof window !== 'undefined') {
        window.BlockTextureAtlas = BlockTextureAtlas;
        window.showTextureAtlas = () => BlockTextureAtlas._instance.showTextureAtlasVisualizer();
        console.log("Exposed BlockTextureAtlas to window for debugging");
      }
    }
    return BlockTextureAtlas._instance;
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
   * @param {string} textureUri - The texture URI or ID (can be a data URI)
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
   * @param {string} textureUri - The texture URI or ID (can be a data URI)
   * @param {Array} uvOffset - The UV offset [u, v]
   * @returns {Array} The UV coordinates [u, v]
   */
  getTextureUVCoordinateSync(textureUri, uvOffset) {
    // Skip invalid texture URIs
    if (!textureUri) {
      const errorMetadata = this._textureAtlasMetadata.get('./assets/blocks/error.png');
      if (errorMetadata) {
        return this._calculateUVCoordinates(errorMetadata, uvOffset);
      }
      return [0, 0]; // Fallback UV if error texture not found
    }
    
    // Create a cache key from the texture URI and UV offset
    const cacheKey = `${textureUri}-${uvOffset[0]}-${uvOffset[1]}`;
    
    // Check if we have a cached result
    if (this._textureUVCache.has(cacheKey)) {
      return this._textureUVCache.get(cacheKey);
    }
    
    // Handle data URIs specially
    if (textureUri.startsWith('data:image/')) {
      // Check if the data URI texture is already in the atlas
      const metadata = this._textureAtlasMetadata.get(textureUri);
      
      if (metadata) {
        // It's loaded, calculate UVs
        const result = this._calculateUVCoordinates(metadata, uvOffset);
        this._textureUVCache.set(cacheKey, result);
        return result;
      } else {
        // Not loaded yet, queue it and use error texture for now
        this.queueTextureForLoading(textureUri);
        const errorMetadata = this._textureAtlasMetadata.get('./assets/blocks/error.png');
        if (errorMetadata) {
          return this._calculateUVCoordinates(errorMetadata, uvOffset);
        }
        return [0, 0]; // Fallback UV if error texture not found
      }
    }
    
    // Define mappings between coordinate faces and descriptive names
    const faceNameToCoordMap = {
      'top': '+y',
      'bottom': '-y',
      'left': '-x',
      'right': '+x',
      'front': '+z',
      'back': '-z'
    };
    
    const coordToFaceNameMap = {
      '+y': 'top',
      '-y': 'bottom',
      '-x': 'left',
      '+x': 'right',
      '+z': 'front',
      '-z': 'back'
    };
    
    // First, check for an exact match in the metadata
    let metadata = this._textureAtlasMetadata.get(textureUri);
        
        if (metadata) {
      // Direct hit, use this metadata
          const result = this._calculateUVCoordinates(metadata, uvOffset);
          this._textureUVCache.set(cacheKey, result);
          return result;
    }
    
    // Try with ./assets/ prefix if not already present
    if (!textureUri.startsWith('./assets/')) {
      const withAssetsPrefix = `./assets/${textureUri}`;
      metadata = this._textureAtlasMetadata.get(withAssetsPrefix);
        
        if (metadata) {
          const result = this._calculateUVCoordinates(metadata, uvOffset);
          this._textureUVCache.set(cacheKey, result);
          return result;
        }
    }
    
    // Try without ./assets/ prefix if it's present
    if (textureUri.startsWith('./assets/')) {
      const withoutAssetsPrefix = textureUri.slice(9);
      metadata = this._textureAtlasMetadata.get(withoutAssetsPrefix);
      
      if (metadata) {
        const result = this._calculateUVCoordinates(metadata, uvOffset);
        this._textureUVCache.set(cacheKey, result);
        return result;
      }
    }
    
    // Handle multi-sided block textures by extracting block type and face
    const blockFacePattern = /blocks\/([^\/]+)(?:\/([^\/]+))?$/;
    const blockFaceMatch = textureUri.match(blockFacePattern);
    
    if (blockFaceMatch) {
      const [, blockType, facePart] = blockFaceMatch;
      
      // No face specified, try to use the base block texture
      if (!facePart) {
        // Try the base block references
        const basePaths = [
          `./assets/blocks/${blockType}`,
          `blocks/${blockType}`,
          `./assets/blocks/${blockType}.png`,
          `blocks/${blockType}.png`
        ];
        
        for (const path of basePaths) {
          metadata = this._textureAtlasMetadata.get(path);
          if (metadata) {
            const result = this._calculateUVCoordinates(metadata, uvOffset);
            this._textureUVCache.set(cacheKey, result);
            return result;
          }
        }
      } 
      else {
        // Face part specified - could be a face name or coordinate
        let face = facePart;
        
        // Strip extension if present
        if (face.endsWith('.png') || face.endsWith('.jpg') || face.endsWith('.jpeg')) {
          face = face.replace(/\.(png|jpe?g)$/, '');
        }
        
        // Try to use our multi-sided texture handling with the extracted face
        if (faceNameToCoordMap[face] || coordToFaceNameMap[face]) {
          // This is a valid face name or coordinate, use getMultiSidedTextureUV
          const result = this.getMultiSidedTextureUV(blockType, face, uvOffset);
    this._textureUVCache.set(cacheKey, result);
    return result;
        }
      }
    }
    
    // If we get here, we couldn't find a direct match. Try loading the texture.
    this.queueTextureForLoading(textureUri);
    
    // Use error texture as fallback
    const errorMetadata = this._textureAtlasMetadata.get('./assets/blocks/error.png');
    if (errorMetadata) {
      return this._calculateUVCoordinates(errorMetadata, uvOffset);
    }
    
    // If all else fails
    return [0, 0];
  }

  /**
   * Load a texture into the atlas
   * @param {string} textureUri - The texture URI (file path or data URI)
   * @returns {Promise<void>}
   */
  async loadTexture(textureUri) {
    // Early return for empty texture URIs
    if (!textureUri) {
      return;
    }
    
    // Check if this is a data URI
    const isDataUri = textureUri && textureUri.startsWith('data:image/');
    
    if (isDataUri) {
      // For data URIs, we use the entire URI as the ID
      await this.loadTextureFromDataURI(textureUri, textureUri);
      return;
    }

    // Don't reload if texture is already loaded, checking both with and without ./assets prefix
    const normalizedPath = textureUri.startsWith('./assets') ? textureUri : `./assets/${textureUri}`;
    const alternativePath = textureUri.startsWith('./assets') ? textureUri.slice(9) : textureUri;
    
    if (this._textureAtlasMetadata.has(textureUri)) {
      return;
    } else if (this._textureAtlasMetadata.has(normalizedPath)) {
      return;
    } else if (this._textureAtlasMetadata.has(alternativePath)) {
      return;
    }
    
    if (textureUri) {
      // Extract block type from the texture URI
      const isSingleTextureFile = textureUri.match(/\/blocks\/([^\/]+\.(png|jpe?g))$/);
      const multiSidedBlockMatch = textureUri.match(/\/blocks\/([^\/]+)(?:\/|$)/);
      
      if (isSingleTextureFile) {
        // Single texture file, load it directly
        await this._loadTextureDirectly(textureUri);
      } 
      else if (multiSidedBlockMatch && !textureUri.match(/[\+\-][xyz]\.png$/)) {
        // Multi-sided block texture, try to preload all faces
        const blockType = multiSidedBlockMatch[1];
        await this.preloadMultiSidedTextures(blockType);
      } 
      else {
        // Try common image formats only for non-data URIs
        if (!textureUri.match(/\.(png|jpe?g)$/i) && !isDataUri) {
              // Try with simple .png extension as fallback
              const fallbackPath = `${textureUri}.png`;
              
          try {
            await this._loadTextureDirectly(fallbackPath);
            return;
          } catch (error) {
            // Failed to load with .png extension, continue to try without
          }
        }
        
        // Try to load directly without extension
        await this._loadTextureDirectly(textureUri);
      }
    }
  }

  /**
   * Update the texture atlas with a debounce to avoid too frequent updates
   * @private
   */
  _updateTextureAtlas() {
    // Clear any existing update timer
    if (this._updateTimer) {
      clearTimeout(this._updateTimer);
    }
    
    // Set a timer to update the texture atlas
    this._updateTimer = setTimeout(() => {
      // Update the texture atlas
      this._textureAtlas.needsUpdate = true;
      this._updateTimer = null;
    }, 50); // 50ms debounce
  }

  /**
   * Draw a texture to the texture atlas
   * @param {THREE.Texture} texture - The texture
   * @param {string} debugPath - Debug path for the texture
   * @param {boolean} updateAtlas - Whether to update the atlas after drawing
   * @returns {Object} The texture metadata
   * @private
   */
  _drawTextureToAtlas(texture, debugPath, updateAtlas = true) {
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
      isTransparent: this._textureIsTransparent(texture),
      debugPath: debugPath // Store path for debugging
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

    // For padding, duplicate top edge
    this._textureAtlasContext.drawImage(
      texture.image,
      0, // sx
      0, // sy
      imageWidth, // sw
      1, // sh - just one pixel for padding
      metadata.x + TEXTURE_IMAGE_PADDING, // dx
      metadata.invertedY, // dy - at top edge
      imageWidth, // dw
      TEXTURE_IMAGE_PADDING // dh - stretched vertically to padding size
    );

    // For padding, duplicate bottom edge
    this._textureAtlasContext.drawImage(
      texture.image,
      0, // sx
      imageHeight - 1, // sy - bottom pixel
      imageWidth, // sw
      1, // sh - just one pixel for padding
      metadata.x + TEXTURE_IMAGE_PADDING, // dx
      metadata.invertedY + TEXTURE_IMAGE_PADDING + imageHeight, // dy - below main image
      imageWidth, // dw
      TEXTURE_IMAGE_PADDING // dh - stretched vertically to padding size
    );

    // For padding, duplicate left edge
    this._textureAtlasContext.drawImage(
      texture.image,
      0, // sx - leftmost pixel
      0, // sy
      1, // sw - just one pixel for padding
      imageHeight, // sh
      metadata.x, // dx - left of main image
      metadata.invertedY + TEXTURE_IMAGE_PADDING, // dy
      TEXTURE_IMAGE_PADDING, // dw - stretched horizontally to padding size
      imageHeight // dh
    );

    // For padding, duplicate right edge
    this._textureAtlasContext.drawImage(
      texture.image,
      imageWidth - 1, // sx - rightmost pixel
      0, // sy
      1, // sw - just one pixel for padding
      imageHeight, // sh
      metadata.x + TEXTURE_IMAGE_PADDING + imageWidth, // dx - right of main image
      metadata.invertedY + TEXTURE_IMAGE_PADDING, // dy
      TEXTURE_IMAGE_PADDING, // dw - stretched horizontally to padding size
      imageHeight // dh
    );

    // For padding, duplicate top-left corner
    this._textureAtlasContext.drawImage(
      texture.image,
      0, // sx - top-left pixel
      0, // sy - top-left pixel
      1, // sw - just one pixel for padding
      1, // sh - just one pixel for padding
      metadata.x, // dx - top left of main image
      metadata.invertedY, // dy - top left of main image
      TEXTURE_IMAGE_PADDING, // dw - stretched horizontally to padding size
      TEXTURE_IMAGE_PADDING // dh - stretched vertically to padding size
    );

    // For padding, duplicate top-right corner
    this._textureAtlasContext.drawImage(
      texture.image,
      imageWidth - 1, // sx - top-right pixel
      0, // sy - top pixel
      1, // sw - just one pixel for padding
      1, // sh - just one pixel for padding
      metadata.x + TEXTURE_IMAGE_PADDING + imageWidth, // dx - top right of main image
      metadata.invertedY, // dy - top of main image
      TEXTURE_IMAGE_PADDING, // dw - stretched horizontally to padding size
      TEXTURE_IMAGE_PADDING // dh - stretched vertically to padding size
    );

    // For padding, duplicate bottom-left corner
    this._textureAtlasContext.drawImage(
      texture.image,
      0, // sx - left pixel
      imageHeight - 1, // sy - bottom pixel
      1, // sw - just one pixel for padding
      1, // sh - just one pixel for padding
      metadata.x, // dx - left of main image
      metadata.invertedY + TEXTURE_IMAGE_PADDING + imageHeight, // dy - bottom of main image
      TEXTURE_IMAGE_PADDING, // dw - stretched horizontally to padding size
      TEXTURE_IMAGE_PADDING // dh - stretched vertically to padding size
    );

    // For padding, duplicate bottom-right corner
    this._textureAtlasContext.drawImage(
      texture.image,
      imageWidth - 1, // sx - right pixel
      imageHeight - 1, // sy - bottom pixel
      1, // sw - just one pixel for padding
      1, // sh - just one pixel for padding
      metadata.x + TEXTURE_IMAGE_PADDING + imageWidth, // dx - right of main image
      metadata.invertedY + TEXTURE_IMAGE_PADDING + imageHeight, // dy - bottom of main image
      TEXTURE_IMAGE_PADDING, // dw - stretched horizontally to padding size
      TEXTURE_IMAGE_PADDING // dh - stretched vertically to padding size
    );

    // Calculate UV coordinates based on canvas size
    const u = metadata.x / canvasWidth;
    const v = metadata.invertedY / canvasHeight;
    const uWidth = tileWidth / canvasWidth;
    const vHeight = tileHeight / canvasHeight;
    
    // Store UV info in metadata
    metadata.uv = { 
      u, 
      v, 
      uWidth, 
      vHeight 
    };

    // Update texture
    if (updateAtlas) {
      this._updateTextureAtlas();
    }

    return metadata;
  }

  /**
   * Check if a texture has transparency
   * @param {THREE.Texture|HTMLCanvasElement} input - The texture or canvas to check
   * @returns {boolean} True if the texture has transparency
   * @private
   */
  _textureIsTransparent(input) {
    let canvas;
    let width, height;
    
    // Handle different input types
    if (input instanceof HTMLCanvasElement) {
      // Input is already a canvas
      canvas = input;
      width = canvas.width;
      height = canvas.height;
    } else if (input && input.image) {
      // Input is a texture with an image property
    // Create a temporary canvas to analyze the texture
      canvas = document.createElement('canvas');
      width = input.image.width;
      height = input.image.height;
      
      // Set canvas dimensions
      canvas.width = width;
      canvas.height = height;
      
      // Draw the image to the canvas
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Failed to create temporary context');
      context.drawImage(input.image, 0, 0);
    } else {
      // Invalid input
      console.warn('Invalid input to _textureIsTransparent, returning false');
      return false;
    }

    // Get image data and check alpha values
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Failed to get context from canvas');
    
    try {
      const imageData = context.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Check each pixel's alpha value, if it's less than 255 then the texture has transparency
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) {
        return true;
      }
      }
    } catch (error) {
      console.warn('Error checking texture transparency:', error);
      return false;
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
   * Clear the texture UV coordinate cache
   * This forces recalculation of all UV coordinates
   */
  clearTextureUVCache() {
    console.log("Clearing texture UV coordinate cache");
    this._textureUVCache.clear();
  }
  
  /**
   * Rebuild the texture atlas completely
   * This forces a complete refresh of the atlas texture
   * @returns {Promise<void>}
   */
  async rebuildTextureAtlas() {
    console.log("Rebuilding texture atlas...");
    
    // Force need update on the texture
    this._textureAtlas.needsUpdate = true;
    
    // Update all materials using this atlas
    BlockMaterial.instance.setTextureAtlas(this._textureAtlas);
    
    // Just to be extra sure, force a THREE.js render update
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      // Create and dispatch a custom event that your renderer can listen for
      const event = new CustomEvent('textureAtlasUpdated', {
        detail: { atlasTexture: this._textureAtlas }
      });
      window.dispatchEvent(event);
      console.log("Dispatched textureAtlasUpdated event");
    }
    
    // Clear any cached UV coordinates
    this.clearTextureUVCache();
    
    console.log("Texture atlas rebuilt successfully");
  }

  /**
   * Preload multi-sided block textures to ensure they're properly loaded
   * @param {string} blockType - The block type to preload (e.g., 'grass', 'wood')
   * @returns {Promise<boolean>} True if preloading was successful
   */
  async preloadMultiSidedTextures(blockType) {
    
    // Check if this is a single-texture file (like water-still.png) 
    const isSingleTexture = blockType.endsWith('.png') || 
                           blockType.endsWith('.jpg') || 
                           blockType.endsWith('.jpeg');
    
    let texturePaths = [];
    let baseTexturePath = '';
    
    if (isSingleTexture) {
      // For single file textures (like water-still.png), just load the one file
      baseTexturePath = `./assets/blocks/${blockType}`;
      
      // If we already have this texture loaded, don't reload it
      if (this._textureAtlasMetadata.has(baseTexturePath)) {
        return true;
      }
      
      texturePaths = [baseTexturePath];
    } else {
      // Define mapping of face names to paths for multi-sided blocks
      const faceMap = {
        'top': `./assets/blocks/${blockType}/+y.png`,
        'bottom': `./assets/blocks/${blockType}/-y.png`,
        'left': `./assets/blocks/${blockType}/-x.png`,
        'right': `./assets/blocks/${blockType}/+x.png`,
        'front': `./assets/blocks/${blockType}/+z.png`,
        'back': `./assets/blocks/${blockType}/-z.png`
      };
      
      baseTexturePath = `./assets/blocks/${blockType}`;
      
      // Force preload all textures in the right order for multi-sided blocks
      texturePaths = [
        // Load top and bottom first, as they're often most visually important
        faceMap.top,
        faceMap.bottom,
        // Then load the sides
        faceMap.left,
        faceMap.right,
        faceMap.front,
        faceMap.back
      ];
    }
    
    // Force clear any existing texture entries from metadata for this block type
    Array.from(this._textureAtlasMetadata.keys())
      .filter(key => key.includes(blockType))
      .forEach(key => this._textureAtlasMetadata.delete(key));
    
    // Force clear texture UV cache for this block type
    Array.from(this._textureUVCache.keys())
      .filter(key => key.includes(blockType))
      .forEach(key => this._textureUVCache.delete(key));
    
    // Clear any existing texture load failures for this block type
    Array.from(this._textureLoadFailures)
      .filter(path => path.includes(blockType))
      .forEach(path => this._textureLoadFailures.delete(path));
    
    // Track loading success
    let loadedTextures = 0;
    
    // Define mappings between coordinate faces and descriptive names
    const faceNameToCoordMap = {
      'top': '+y',
      'bottom': '-y',
      'left': '-x',
      'right': '+x',
      'front': '+z',
      'back': '-z'
    };
    
    const coordToFaceNameMap = {
      '+y': 'top',
      '-y': 'bottom',
      '-x': 'left',
      '+x': 'right',
      '+z': 'front',
      '-z': 'back'
    };
    
    // Load textures sequentially to ensure proper order
    for (const path of texturePaths) {
      try {
        await new Promise((resolve, reject) => {
          const textureLoader = new THREE.TextureLoader();
          textureLoader.load(
            path,
            texture => {
              if (texture.image) {
                // Draw texture to atlas and store metadata
                // Don't update the texture atlas immediately (false parameter)
                const metadata = this._drawTextureToAtlas(texture, path, false);
                this._textureAtlasMetadata.set(path, metadata);
                loadedTextures++;
                
                // If this is a single texture, add it for all faces
                if (isSingleTexture) {
                  // Add references for all faces using this same texture
                  const blockName = blockType.replace(/\.(png|jpe?g)$/, '');
                  
                  // Create descriptive and coordinate-based face paths
                  Object.entries(faceNameToCoordMap).forEach(([faceName, faceCoord]) => {
                    // With ./assets/ prefix
                    const coordPath = `./assets/blocks/${blockName}/${faceCoord}.png`;
                    const descriptivePath = `./assets/blocks/${blockName}/${faceName}.png`;
                    this._textureAtlasMetadata.set(coordPath, metadata);
                    this._textureAtlasMetadata.set(descriptivePath, metadata);
                    
                    // Without ./assets/ prefix (normalized)
                    const normalizedCoordPath = `blocks/${blockName}/${faceCoord}.png`;
                    const normalizedDescriptivePath = `blocks/${blockName}/${faceName}.png`;
                    this._textureAtlasMetadata.set(normalizedCoordPath, metadata);
                    this._textureAtlasMetadata.set(normalizedDescriptivePath, metadata);
                  });
                  
                  // Also set base paths
                  this._textureAtlasMetadata.set(`blocks/${blockName}`, metadata);
                  this._textureAtlasMetadata.set(`./assets/blocks/${blockName}`, metadata);
                }
                // For multi-sided textures, add aliases based on faces
                else {
                  // Extract face information from path
                  const facePattern = /\/([\+\-][xyz])\.png$/;
                  const faceMatch = path.match(facePattern);
                  
                  if (faceMatch) {
                    const [, faceCoord] = faceMatch;
                    const faceName = coordToFaceNameMap[faceCoord];
                    
                    if (faceName) {
                      // Set descriptive face paths
                      const descriptiveFacePath = `./assets/blocks/${blockType}/${faceName}.png`;
                      this._textureAtlasMetadata.set(descriptiveFacePath, metadata);
                      
                      // Set normalized paths (without ./assets/)
                      const normalizedCoordPath = `blocks/${blockType}/${faceCoord}.png`;
                      const normalizedDescriptivePath = `blocks/${blockType}/${faceName}.png`;
                      this._textureAtlasMetadata.set(normalizedCoordPath, metadata);
                      this._textureAtlasMetadata.set(normalizedDescriptivePath, metadata);
                      
                      // Also set simple face references
                      this._textureAtlasMetadata.set(`blocks/${blockType}/${faceName}`, metadata);
                    }
                    
                    // Store a reference to the block type for the top face (or first loaded)
                    if (faceCoord === '+y' || loadedTextures === 1) {
                      this._textureAtlasMetadata.set(`./assets/blocks/${blockType}`, metadata);
                      this._textureAtlasMetadata.set(`blocks/${blockType}`, metadata);
                    }
                  }
                }
                
                resolve();
              } else {
                reject(new Error(`Failed to preload ${blockType} texture: ${path}`));
              }
            },
            undefined,
            error => {
              // For single textures, this is a critical error
              if (isSingleTexture) {
                reject(error);
              } else {
                console.warn(`Failed to load texture ${path}: ${error.message}`);
                // For multi-sided textures, we can continue with other faces
                resolve(); // Continue loading other textures
              }
            }
          );
        });
      } catch (error) {
        // Continue with other textures even if one fails
        console.warn(`Failed to load texture ${path}: ${error.message}`);
      }
    }
    
    // Update texture atlas once after all textures are loaded, instead of after each one
    if (loadedTextures > 0) {
      this._updateTextureAtlas();
    }
    
    // Update materials with new atlas
    BlockMaterial.instance.setTextureAtlas(this._textureAtlas);
    
    return loadedTextures > 0;
  }
  
  /**
   * Preload grass block textures to ensure they're properly loaded
   * This is a special case function to fix the grass texture loading issue
   * @deprecated Use preloadMultiSidedTextures('grass') instead
   */
  async preloadGrassTextures() {
    return this.preloadMultiSidedTextures('grass');
  }

  /**
   * Get UV coordinates for a multi-sided block texture
   * This directly uses hardcoded paths for each face to avoid any confusion
   * @param {string} blockType - The block type name (e.g., 'grass', 'wood')
   * @param {string} blockFace - The block face (top, bottom, left, right, front, back)
   * @param {Array} uvOffset - The UV offset [u, v]
   * @returns {Array} The UV coordinates [u, v]
   */
  getMultiSidedTextureUV(blockType, blockFace, uvOffset) {
    
    // Ensure we have valid blockType and blockFace
    if (!blockType || !blockFace) {
      console.warn(`Invalid block type or face: ${blockType}, ${blockFace}`);
      const errorMetadata = this._textureAtlasMetadata.get('./assets/blocks/error.png');
      if (errorMetadata) {
        return this._calculateUVCoordinates(errorMetadata, uvOffset);
      }
      return [0, 0]; // Return default coordinates for invalid parameters
    }
    
    // Define mappings between coordinate faces and descriptive names
    const faceNameToCoordMap = {
      'top': '+y',
      'bottom': '-y',
      'left': '-x',
      'right': '+x',
      'front': '+z',
      'back': '-z'
    };
    
    const coordToFaceNameMap = {
      '+y': 'top',
      '-y': 'bottom',
      '-x': 'left',
      '+x': 'right',
      '+z': 'front',
      '-z': 'back'
    };
    
    // Check if this is a single-texture file based on the extension
    const isSingleTexture = blockType.endsWith('.png') || 
                           blockType.endsWith('.jpg') || 
                           blockType.endsWith('.jpeg');
    
    // Strip extension from block type if it has one
    const blockTypeName = isSingleTexture ? 
      blockType.replace(/\.(png|jpe?g)$/, '') : 
      blockType;
    
    // Try all possible path combinations in a prioritized order
    const possiblePaths = [];
    
    // 1. Try exact paths based on the provided face (most specific first)
    if (faceNameToCoordMap[blockFace]) {
      // If blockFace is a descriptive name (top, bottom, etc.)
      const coordFace = faceNameToCoordMap[blockFace];
      
      // With ./assets/ prefix
      possiblePaths.push(`./assets/blocks/${blockTypeName}/${coordFace}.png`);
      possiblePaths.push(`./assets/blocks/${blockTypeName}/${blockFace}.png`);
      
      // Without ./assets/ prefix
      possiblePaths.push(`blocks/${blockTypeName}/${coordFace}.png`);
      possiblePaths.push(`blocks/${blockTypeName}/${blockFace}.png`);
    } else if (coordToFaceNameMap[blockFace]) {
      // If blockFace is a coordinate face (+y, -x, etc.)
      const descriptiveFace = coordToFaceNameMap[blockFace];
      
      // With ./assets/ prefix
      possiblePaths.push(`./assets/blocks/${blockTypeName}/${blockFace}.png`);
      possiblePaths.push(`./assets/blocks/${blockTypeName}/${descriptiveFace}.png`);
      
      // Without ./assets/ prefix
      possiblePaths.push(`blocks/${blockTypeName}/${blockFace}.png`);
      possiblePaths.push(`blocks/${blockTypeName}/${descriptiveFace}.png`);
    }
    
    // 2. Try with just the face name (no extension)
    if (faceNameToCoordMap[blockFace]) {
      possiblePaths.push(`blocks/${blockTypeName}/${blockFace}`);
    }
    
    // 3. Try single-texture versions (if face lookup fails)
    possiblePaths.push(`./assets/blocks/${blockTypeName}.png`);
    possiblePaths.push(`blocks/${blockTypeName}.png`);
    
    // 4. Try generic block type paths (for defaults)
    possiblePaths.push(`./assets/blocks/${blockTypeName}`);
    possiblePaths.push(`blocks/${blockTypeName}`);
    
    // Try each path in order until we find a match
    for (const path of possiblePaths) {
      const metadata = this._textureAtlasMetadata.get(path);
      if (metadata) {
        // We found a matching texture, use it
        return this._calculateUVCoordinates(metadata, uvOffset);
      }
    }
    
    // If we got here, we couldn't find any texture for this block/face combination
    // Queue for loading and log a warning
    console.warn(`No texture found for ${blockType}, face ${blockFace}. Queuing for loading.`);
    
    // Try to queue the preferred path for loading
    const preferredPath = `./assets/blocks/${blockTypeName}/${faceNameToCoordMap[blockFace] || blockFace}.png`;
    this.queueTextureForLoading(preferredPath);
    
    // Try to use error texture as fallback
    const errorMetadata = this._textureAtlasMetadata.get('./assets/blocks/error.png');
    if (errorMetadata) {
      return this._calculateUVCoordinates(errorMetadata, uvOffset);
    }
    
    return [0, 0]; // Return default coordinates if all else fails
  }
  
  /**
   * Get UV coordinates for a grass texture - DEPRECATED: Use getMultiSidedTextureUV instead
   * @param {string} blockFace - The block face (top, bottom, left, right, front, back)
   * @param {Array} uvOffset - The UV offset [u, v]
   * @returns {Array} The UV coordinates [u, v]
   */
  getGrassTextureUV(blockFace, uvOffset) {
    // For backward compatibility, redirect to the generic method
    return this.getMultiSidedTextureUV('grass', blockFace, uvOffset);
  }

  /**
   * Load a texture from a data URI directly
   * @param {string} dataUri - The data URI of the texture
   * @param {string} textureId - The ID to use for the texture in the atlas
   * @param {boolean} dispatchUpdateEvent - Whether to dispatch an update event (default: false)
   * @returns {Promise<void>}
   */
  async loadTextureFromDataURI(dataUri, textureId, dispatchUpdateEvent = false) {
    //console.log(`Loading texture from data URI to atlas (ID: ${textureId})...`);
    
    // Prevent reloading if already loaded
    if (this._textureAtlasMetadata.has(textureId)) {
      //console.log(`Texture ${textureId} already loaded, skipping.`);
      return;
    }

    // Check if texture is already loading
    if (this._textureLoadLocks[textureId]) {
      //console.log(`Texture ${textureId} is already loading, waiting...`);
      await this._textureLoadLocks[textureId];
      return;
    }

    // Check if texture previously failed
    if (this._textureLoadFailures.has(textureId)) {
      console.warn(`Texture ${textureId} previously failed to load, skipping.`);
      return;
    }
    
    // Create a lock for this texture
    this._textureLoadLocks[textureId] = new Promise((resolve, reject) => {
      const img = new Image();
      
      img.onload = () => {
        try {
          // Create a temporary canvas to hold the image
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = img.width;
          tempCanvas.height = img.height;
          
          const ctx = tempCanvas.getContext('2d');
          if (!ctx) {
            throw new Error('Failed to create temporary canvas context');
          }
          
          // Draw the image to the canvas
          ctx.drawImage(img, 0, 0);
          
          // Check if the texture has transparent pixels
          const isTransparent = this._textureIsTransparent(tempCanvas);
          
          // Create a THREE.js texture from the canvas
          const texture = new THREE.CanvasTexture(tempCanvas);
          texture.magFilter = THREE.NearestFilter;
          texture.minFilter = THREE.NearestFilter;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.needsUpdate = true;
          texture.flipY = false;
          
          // Draw to atlas and store metadata
          const metadata = this._drawTextureToAtlas(texture, textureId, false);
          this._textureAtlasMetadata.set(textureId, metadata);
          
          // Update texture atlas
          this._textureAtlas.needsUpdate = true;
          
          // Also store the texture with alternative IDs to make it easier to find
          this._textureAtlasMetadata.set(`custom:${textureId}`, metadata);
          
          // Update BlockMaterial with the new atlas without rebuilding
          BlockMaterial.instance.setTextureAtlas(this._textureAtlas);
          
          // Only dispatch update event if explicitly requested
          // This prevents unnecessary rebuilds during batch operations
          if (dispatchUpdateEvent && typeof window !== 'undefined' && window.dispatchEvent) {
            const event = new CustomEvent('textureAtlasUpdated', {
              detail: { textureId, atlasTexture: this._textureAtlas }
            });
            window.dispatchEvent(event);
          }
          
          delete this._textureLoadLocks[textureId];
          resolve();
        } catch (error) {
          console.error(`Error processing loaded image for ${textureId}:`, error);
          this._textureLoadFailures.add(textureId);
          delete this._textureLoadLocks[textureId];
          reject(error);
        }
      };
      
      img.onerror = (error) => {
        console.error(`Failed to load image from data URI for ${textureId}:`, error);
        this._textureLoadFailures.add(textureId);
        
        // Fallback to error texture
        const errorTexture = this._textureAtlasMetadata.get('./assets/blocks/error.png');
        if (errorTexture) {
          console.warn(`Using error texture as fallback for ${textureId}`);
          this._textureAtlasMetadata.set(textureId, errorTexture);
          delete this._textureLoadLocks[textureId];
          resolve();
        } else {
          delete this._textureLoadLocks[textureId];
          reject(new Error(`No fallback error texture available for ${textureId}`));
        }
      };
      
      // Set the source to the data URI
      img.src = dataUri;
    });
    
    return this._textureLoadLocks[textureId];
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
   * Display the texture atlas in a popup DOM element for debugging
   */
  showTextureAtlasVisualizer() {
    try {
      if (!this._textureAtlasCanvas) {
        console.error('Texture atlas canvas not available');
        return;
      }
      
      const existingVisualizer = document.getElementById('texture-atlas-visualizer');
      if (existingVisualizer) {
        document.body.removeChild(existingVisualizer);
      }
      
      // Create container
      const container = document.createElement('div');
      container.id = 'texture-atlas-visualizer';
      container.style.position = 'fixed';
      container.style.top = '10px';
      container.style.right = '10px';
      container.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
      container.style.border = '1px solid #444';
      container.style.borderRadius = '5px';
      container.style.padding = '10px';
      container.style.zIndex = '1000';
      container.style.maxHeight = '80vh';
      container.style.overflowY = 'auto';
      container.style.color = 'white';
      container.style.fontFamily = 'monospace';
      container.style.fontSize = '12px';
      
      // Create header
      const header = document.createElement('div');
      header.style.marginBottom = '10px';
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';
      
      const title = document.createElement('h3');
      title.innerText = 'Texture Atlas Visualizer';
      title.style.margin = '0';
      header.appendChild(title);
      
      const closeBtn = document.createElement('button');
      closeBtn.innerText = 'X';
      closeBtn.style.backgroundColor = '#f44336';
      closeBtn.style.border = 'none';
      closeBtn.style.borderRadius = '3px';
      closeBtn.style.color = 'white';
      closeBtn.style.cursor = 'pointer';
      closeBtn.style.padding = '5px 10px';
      closeBtn.onclick = () => document.body.removeChild(container);
      header.appendChild(closeBtn);
      
      container.appendChild(header);
      
      // Add texture count info
      const texInfo = document.createElement('div');
      texInfo.innerText = `Total textures: ${this._textureAtlasMetadata.size}`;
      texInfo.style.marginBottom = '10px';
      container.appendChild(texInfo);
      
      // Canvas clone
      const canvasClone = document.createElement('canvas');
      canvasClone.width = this._textureAtlasCanvas.width / 2; // Show at half size
      canvasClone.height = this._textureAtlasCanvas.height / 2;
      const ctx = canvasClone.getContext('2d');
      ctx.drawImage(this._textureAtlasCanvas, 0, 0, canvasClone.width, canvasClone.height);
      canvasClone.style.border = '1px solid #666';
      canvasClone.style.marginBottom = '10px';
      container.appendChild(canvasClone);
      
      // Add texture list with coordinates
      const texList = document.createElement('div');
      texList.style.maxHeight = '300px';
      texList.style.overflowY = 'auto';
      texList.style.border = '1px solid #555';
      texList.style.padding = '5px';
      
      // Table for texture metadata
      const table = document.createElement('table');
      table.style.width = '100%';
      table.style.borderCollapse = 'collapse';
      
      // Table header
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      ['Texture ID', 'Position', 'Size', 'Type'].forEach(text => {
        const th = document.createElement('th');
        th.innerText = text;
        th.style.textAlign = 'left';
        th.style.padding = '3px';
        th.style.borderBottom = '1px solid #555';
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);
      
      // Table body
      const tbody = document.createElement('tbody');
      this._textureAtlasMetadata.forEach((metadata, id) => {
        const row = document.createElement('tr');
        row.style.backgroundColor = id.startsWith('data:') ? 'rgba(50, 50, 50, 0.5)' : 'transparent';
        
        // ID cell - truncate data URIs
        const idCell = document.createElement('td');
        idCell.style.padding = '3px';
        idCell.title = id; // Full ID on hover
        idCell.innerText = id.startsWith('data:') 
          ? id.substring(0, 20) + '...' 
          : id;
        row.appendChild(idCell);
        
        // Position cell
        const posCell = document.createElement('td');
        posCell.style.padding = '3px';
        posCell.innerText = `(${metadata.x}, ${metadata.invertedY})`;
        row.appendChild(posCell);
        
        // Size cell
        const sizeCell = document.createElement('td');
        sizeCell.style.padding = '3px';
        sizeCell.innerText = `${metadata.width}x${metadata.height}`;
        row.appendChild(sizeCell);
        
        // Type cell
        const typeCell = document.createElement('td');
        typeCell.style.padding = '3px';
        typeCell.innerText = id.startsWith('data:') ? 'Data URI' : 'File';
        row.appendChild(typeCell);
        
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      texList.appendChild(table);
      
      container.appendChild(texList);
      
      // Add to document
      document.body.appendChild(container);
      
      return 'Texture atlas visualizer opened';
    } catch (error) {
      console.error('Failed to show texture atlas visualizer:', error);
      return 'Error: ' + error.message;
    }
  }

  /**
   * Load a texture directly using THREE.TextureLoader
   * @param {string} textureUri - The texture URI to load
   * @returns {Promise<void>} - A promise that resolves when the texture is loaded
   * @private
   */
  async _loadTextureDirectly(textureUri) {
    // Check if texture is already loading
    if (this._textureLoadLocks[textureUri]) {
      await this._textureLoadLocks[textureUri];
      return;
    }

    // Check if texture previously failed to load
    if (this._textureLoadFailures.has(textureUri)) {
      throw new Error(`Texture previously failed to load: ${textureUri}`);
    }

    // Define mappings between coordinate faces and descriptive names for consistent use
    const faceNameToCoordMap = {
      'top': '+y',
      'bottom': '-y',
      'left': '-x',
      'right': '+x',
      'front': '+z',
      'back': '-z'
    };
    
    const coordToFaceNameMap = {
      '+y': 'top',
      '-y': 'bottom',
      '-x': 'left',
      '+x': 'right',
      '+z': 'front',
      '-z': 'back'
    };

    // Create a promise to load the texture
    const loadPromise = new Promise((resolve, reject) => {
      // Initialize texture loader
      const textureLoader = new THREE.TextureLoader();
      
      textureLoader.load(
        textureUri,
        texture => {
          if (!texture.image) {
            reject(new Error(`Failed to load texture image for URI: ${textureUri}`));
            return;
          }
            
          // Draw texture to atlas and store metadata
          const metadata = this._drawTextureToAtlas(texture, textureUri, false); // Don't update yet
          this._textureAtlasMetadata.set(textureUri, metadata);
          
          // Create a normalized version of the path (without ./assets/ prefix)
          const normalizedUri = textureUri.startsWith('./assets/') ? textureUri.slice(9) : textureUri;
          if (normalizedUri !== textureUri) {
            this._textureAtlasMetadata.set(normalizedUri, metadata);
          }
          
          // For face textures, also create multi-face mappings to ensure they can be found
          const facePattern = /^(.*?)[\\/]([\+\-][xyz])\.png$/;
          const faceMatch = textureUri.match(facePattern);
          
          if (faceMatch) {
            const [, basePath, faceCoord] = faceMatch;
            const faceName = coordToFaceNameMap[faceCoord];
            
            if (faceName) {
              // Store base path for block type reference
              const blockTypeMatch = basePath.match(/^\.\/assets\/blocks\/([^\/]+)$/);
              if (blockTypeMatch) {
                const blockType = blockTypeMatch[1];
                // Create block type base references
                this._textureAtlasMetadata.set(`./assets/blocks/${blockType}`, metadata);
                this._textureAtlasMetadata.set(`blocks/${blockType}`, metadata);
                
                // Create descriptive face paths
                const descriptivePath = `${basePath}/${faceName}.png`;
                this._textureAtlasMetadata.set(descriptivePath, metadata);
                
                // Create normalized paths (without ./assets/)
                if (basePath.startsWith('./assets/')) {
                  const normalizedBasePath = basePath.slice(9);
                  this._textureAtlasMetadata.set(`${normalizedBasePath}/${faceCoord}.png`, metadata);
                  this._textureAtlasMetadata.set(`${normalizedBasePath}/${faceName}.png`, metadata);
                  this._textureAtlasMetadata.set(`${normalizedBasePath}/${faceName}`, metadata);
                }
              }
            }
          } else {
            // For non-face textures (plain texture files), create additional aliases
            const plainTextureMatch = textureUri.match(/^\.\/assets\/blocks\/([^\/]+\.(png|jpe?g))$/);
            if (plainTextureMatch) {
              const [, fileName] = plainTextureMatch;
              const baseName = fileName.replace(/\.(png|jpe?g)$/, '');
              
              // Store under normalized path (without ./assets/)
              this._textureAtlasMetadata.set(`blocks/${fileName}`, metadata);
              this._textureAtlasMetadata.set(`blocks/${baseName}`, metadata);
              
              // For block types using a single texture for all faces, create face references
              // Create descriptive and coordinate-based face paths
              Object.entries(faceNameToCoordMap).forEach(([faceName, faceCoord]) => {
                // With ./assets/ prefix
                const coordPath = `./assets/blocks/${baseName}/${faceCoord}.png`;
                const descriptivePath = `./assets/blocks/${baseName}/${faceName}.png`;
                this._textureAtlasMetadata.set(coordPath, metadata);
                this._textureAtlasMetadata.set(descriptivePath, metadata);
                
                // Without ./assets/ prefix (normalized)
                const normalizedCoordPath = `blocks/${baseName}/${faceCoord}.png`;
                const normalizedDescriptivePath = `blocks/${baseName}/${faceName}.png`;
                this._textureAtlasMetadata.set(normalizedCoordPath, metadata);
                this._textureAtlasMetadata.set(normalizedDescriptivePath, metadata);
                
                // Also set with just the face name
                this._textureAtlasMetadata.set(`blocks/${baseName}/${faceName}`, metadata);
              });
            }
          }
            
          // Update the texture atlas
          this._updateTextureAtlas();
          
          // Update materials with new atlas
          BlockMaterial.instance.setTextureAtlas(this._textureAtlas);
          
          resolve(texture);
        },
        undefined,
        error => {
          console.error(`Failed to load texture: ${textureUri}`, error);
          
          // Try to use error texture as fallback
          const errorTexture = this._textureAtlasMetadata.get('./assets/blocks/error.png');
          if (errorTexture) {
            // Use the error texture as fallback
            this._textureAtlasMetadata.set(textureUri, errorTexture);
            resolve();
          } else {
            // Prevent retries on textures that failed to load
            this._textureLoadFailures.add(textureUri);
            reject(error);
          }
        }
      );
    });

    // Store the promise to prevent duplicate loads
    this._textureLoadLocks[textureUri] = loadPromise;

    try {
      return await loadPromise;
    } finally {
      delete this._textureLoadLocks[textureUri];
    }
  }
}

// Initialize the singleton instance
BlockTextureAtlas._instance = null;

export default BlockTextureAtlas; 