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
   * Get the singleton instance
   * @returns {BlockTextureAtlas} The singleton instance
   */
  static get instance() {
    if (!this._instance) {
      this._instance = new BlockTextureAtlas();
      
      // Initialize the texture atlas
      setTimeout(() => {
        this._instance.initialize().catch(error => {
          console.error("Failed to initialize BlockTextureAtlas:", error);
        });
      }, 100);
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
    // Handle multi-sided textures by attempting to extract block type and face
    if (textureUri) {
      // Try to extract block type from the path
      const blockTypeMatch = textureUri.match(/\/blocks\/([^\/]+)(?:\/|$)/);
      
      if (blockTypeMatch) {
        const blockType = blockTypeMatch[1];
        let face = null;
        
        // Check for face indicators in the path
        if (textureUri.includes('+y') || textureUri.includes('top')) {
          face = 'top';
        } else if (textureUri.includes('-y') || textureUri.includes('bottom')) {
          face = 'bottom';
        } else if (textureUri.includes('+x') || textureUri.includes('right')) {
          face = 'right';
        } else if (textureUri.includes('-x') || textureUri.includes('left')) {
          face = 'left';
        } else if (textureUri.includes('+z') || textureUri.includes('front')) {
          face = 'front';
        } else if (textureUri.includes('-z') || textureUri.includes('back')) {
          face = 'back';
        }
        
        // If we've identified both block type and face, use the multi-sided texture handler
        if (face) {
    //      console.log(`🧊 Using multi-sided texture handler for ${blockType} ${face}`);
          return this.getMultiSidedTextureUV(blockType, face, uvOffset);
        }
      }
    }
    
    // Original handling for single texture blocks or unrecognized patterns
    // CRITICAL FIX FOR GRASS TEXTURES - Retained for backward compatibility
    if (textureUri ) {
      let exactPath = null;
      
      // If we identified an exact path, use it directly
      if (exactPath) {
        const exactMetadata = this._textureAtlasMetadata.get(exactPath);
        if (exactMetadata) {
          console.log(`⭐ Direct texture lookup for ${exactPath}`);
          const result = this._calculateUVCoordinates(exactMetadata, uvOffset);
          // Don't cache this result to ensure it's always fresh
          return result;
        }
      }
    }
    
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
    
    // If not found, try to find appropriate texture based on URI structure
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
      
      // For multi-sided textures, extract face information if available
      const facePattern = /([\+\-][xyz])(\.png)?$/;
      const faceMatch = textureUri.match(facePattern);
      
      if (faceMatch) {
        const face = faceMatch[1]; // e.g., +y, -x
        
        // Try to use the matched face with .png extension
        const facePathWithExt = textureUri.endsWith('.png') ? textureUri : `${textureUri}.png`;
        metadata = this._textureAtlasMetadata.get(facePathWithExt);
        
        if (metadata) {
          const result = this._calculateUVCoordinates(metadata, uvOffset);
          this._textureUVCache.set(cacheKey, result);
          return result;
        }
        
        // If face path doesn't exist in atlas, extract base path
        const basePath = textureUri.replace(facePattern, '');
        
        // Try checking if there are any textures with this base path
      const possibleFacePaths = [
          `${basePath}${face}.png`,   // Try with face
          `${basePath}/all.png`,      // Try all-faces texture
          `${basePath}/default.png`,  // Try default texture
          `${basePath}.png`           // Try direct base path
        ];
        
      for (const path of possibleFacePaths) {
        const pathMetadata = this._textureAtlasMetadata.get(path);
        if (pathMetadata) {
          metadata = pathMetadata;
          break;
        }
      }
      } else if (!textureUri.match(/\.(png|jpe?g)$/i)) {
        // This is a base path for a multi-sided texture (e.g., "blocks/grass")
        // Determine if we're looking for specific faces based on the context
        
        // Look for common path patterns for multi-sided blocks
        const possibleFacePaths = [
          `${textureUri}/+y.png`,     // Try top face
          `${textureUri}/-y.png`,     // Try bottom face
          `${textureUri}/+x.png`,     // Try right face
          `${textureUri}/-x.png`,     // Try left face
          `${textureUri}/+z.png`,     // Try front face
          `${textureUri}/-z.png`,     // Try back face
          `${textureUri}.png`         // Try base path with extension
        ];
        
        // Try each possible path
        for (const path of possibleFacePaths) {
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
    // Don't reload if texture is already loaded, checking both with and without ./assets prefix
    const normalizedPath = textureUri.startsWith('./assets') ? textureUri : `./assets/${textureUri}`;
    const alternativePath = textureUri.startsWith('./assets') ? textureUri.slice(9) : textureUri;
    
    if (this._textureAtlasMetadata.has(textureUri) || 
        this._textureAtlasMetadata.has(normalizedPath) || 
        this._textureAtlasMetadata.has(alternativePath)) {
      return;
    }
    
    if (textureUri) {
      // Extract block type from the texture URI
      const isSingleTextureFile = textureUri.match(/\/blocks\/([^\/]+\.(png|jpe?g))$/);
      const multiSidedBlockMatch = textureUri.match(/\/blocks\/([^\/]+)(?:\/|$)/);
      
      // Check if this is a single-file texture without extension indicator
      if (isSingleTextureFile) {
        const textureFile = isSingleTextureFile[1];
        
        await this.preloadMultiSidedTextures(textureFile);
        return;
      }
      // Check if this is a multi-sided block directory
      else if (multiSidedBlockMatch && !textureUri.match(/[\+\-][xyz]\.png$/)) {
        const blockType = multiSidedBlockMatch[1];
        
        // First, check if a single texture file exists with this name
        // Try common image formats: png, jpg, jpeg
        const possibleExtensions = ['png', 'jpg', 'jpeg'];
        let singleTextureExists = false;
        
        for (const ext of possibleExtensions) {
          const singleTextureUri = `./assets/blocks/${blockType}.${ext}`;
          
          try {
            // Use fetch to check if the single texture file exists
            const response = await fetch(singleTextureUri, { method: 'HEAD' });
            if (response.ok) {
              // The single texture file exists, load it instead of treating as multi-sided
              await this.preloadMultiSidedTextures(`${blockType}.${ext}`);
              singleTextureExists = true;
              break;
            }
          } catch (error) {
            // Ignore errors, will try next extension or fall back to multi-sided loading
          }
        }
        
        // If we found a single texture file, return early
        if (singleTextureExists) {
          return;
        }
        
        // If we get here, proceed with multi-sided texture loading
        await this.preloadMultiSidedTextures(blockType);
        return;
      }
    }
    
    // Check if texture is already loading
    if (this._textureLoadLocks[textureUri]) {
      await this._textureLoadLocks[textureUri];
      return;
    }

    // Check if texture previously failed to load
    if (this._textureLoadFailures.has(textureUri)) {
      return;
    }

    // Create a promise to load the texture
    const loadPromise = new Promise((resolve, reject) => {
      // Initialize texture loader
      const textureLoader = new THREE.TextureLoader();
      
      // Check if this looks like a multi-sided texture (no file extension)
      const isMultiSided = !textureUri.match(/\.(png|jpe?g)$/i);
      
      // Check if this is a specific face of a multi-sided texture
      const facePattern = /^(.*?)[\\/]([\+\-][xyz])\.png$/;
      const faceMatch = textureUri.match(facePattern);
      
      // For direct face loading (e.g., blocks/grass/+y.png)
      if (faceMatch) {
        const [, basePath, face] = faceMatch;
        // Load this specific face texture
        textureLoader.load(
          textureUri,
          texture => {
            if (texture.image) {
           
              // Add to atlas
              this._textureAtlasMetadata.set(textureUri, this._drawTextureToAtlas(texture, textureUri, false)); // Don't update yet
              
              // Update the texture atlas - defer update to the end
              this._updateTextureAtlas();
              
              // Update materials with new atlas
              BlockMaterial.instance.setTextureAtlas(this._textureAtlas);
              
              resolve();
            } else {
              console.error(`❌ Failed to load texture image for face: ${textureUri}`);
              reject(new Error(`Failed to load texture image for face: ${textureUri}`));
            }
          },
          undefined,
          error => {
            // Try to use error texture as fallback
            const errorTexture = this._textureAtlasMetadata.get('./assets/blocks/error.png');
            if (errorTexture) {
              // Use the error texture as fallback and don't log the error
              this._textureAtlasMetadata.set(textureUri, errorTexture);
              resolve();
            } else {
              // Only add to failures if no fallback is available
              this._textureLoadFailures.add(textureUri);
              reject(error);
            }
          }
        );
      } 
      // For multi-sided texture base paths (e.g., blocks/grass)
      else if (isMultiSided) {
        
        // For multi-sided textures, load all face textures individually
        const faceTextures = [
          `${textureUri}/+y.png`, // top
          `${textureUri}/-y.png`, // bottom
          `${textureUri}/+x.png`, // right
          `${textureUri}/-x.png`, // left
          `${textureUri}/+z.png`, // front
          `${textureUri}/-z.png`, // back
        ];
        
        // Track successfully loaded faces
        let successfulFaces = 0;
        
        // Create promises for each face texture
        const faceLoads = faceTextures.map(facePath => {
          return new Promise(faceResolve => {
            textureLoader.load(
              facePath,
              texture => {
                if (texture.image) {
                  
                  // Add to atlas
                  this._textureAtlasMetadata.set(facePath, this._drawTextureToAtlas(texture, facePath, false)); // Don't update yet
                  
                  // Mark as successful
                  successfulFaces++;
                }
                faceResolve();
              },
              undefined,
              error => {
                
                faceResolve(); // Resolve anyway to continue with other faces
              }
            );
          });
        });

        // Wait for all face load attempts
        Promise.all(faceLoads)
          .then(() => {
            // Only log for non-common textures
            
            // Successful if at least one face loaded
            if (successfulFaces > 0) {
              // Update the texture atlas once after all faces are loaded
              this._updateTextureAtlas();
              
              // Also set the base texture URI to refer to the loaded faces
              this._textureAtlasMetadata.set(textureUri, this._textureAtlasMetadata.get(faceTextures[0]));
              
              // Update materials with new atlas
              BlockMaterial.instance.setTextureAtlas(this._textureAtlas);
              resolve();
            } else {
              // Try with simple .png extension as fallback
              const fallbackPath = `${textureUri}.png`;
              
              // Try to silently load the fallback texture
              textureLoader.load(
                fallbackPath,
                texture => {
                  if (texture.image) {
                    // Add to atlas
                    this._textureAtlasMetadata.set(fallbackPath, this._drawTextureToAtlas(texture, fallbackPath, false)); // Don't update yet
                    this._textureAtlasMetadata.set(textureUri, this._textureAtlasMetadata.get(fallbackPath));
                    
                    // Update the texture atlas
                    this._updateTextureAtlas();
                    
                    // Update materials with new atlas
                    BlockMaterial.instance.setTextureAtlas(this._textureAtlas);
                    resolve();
                  } else {
                    // Try error texture as a last resort
                    const errorTexture = this._textureAtlasMetadata.get('./assets/blocks/error.png');
                    if (errorTexture) {
                      // Use the error texture as fallback
                      this._textureAtlasMetadata.set(textureUri, errorTexture);
                      resolve();
                    } else {
                      // No error texture available either, mark as failed
                      this._textureLoadFailures.add(textureUri);
                      reject(new Error(`Failed to load any textures for ${textureUri}`));
                    }
                  }
                },
                undefined,
                error => {
                  // Try error texture as a last resort
                  const errorTexture = this._textureAtlasMetadata.get('./assets/blocks/error.png');
                  if (errorTexture) {
                    // Use the error texture as fallback
                    this._textureAtlasMetadata.set(textureUri, errorTexture);
                    resolve();
                  } else {
                    // Still log the error but don't show it in console
                    this._textureLoadFailures.add(textureUri);
                    reject(new Error(`Failed to load any textures for ${textureUri}`));
                  }
                }
              );
            }
          })
          .catch(error => {
            console.error(`❌ Error processing faces for ${textureUri}`, error.message);
            reject(error);
          });
      } else {
        // Regular single texture loading
        // Only log for non-common textures
       
      textureLoader.load(
        textureUri,
        texture => {
          if (!texture.image) {
            reject(new Error(`Failed to load texture image for URI: ${textureUri}`));
            return;
          }
            
          
          // Draw texture to atlas and store metadata
            this._textureAtlasMetadata.set(textureUri, this._drawTextureToAtlas(texture, textureUri, false)); // Don't update yet
            
            // Update the texture atlas
            this._updateTextureAtlas();
          
          // Update materials with new atlas
          BlockMaterial.instance.setTextureAtlas(this._textureAtlas);
          
          resolve();
        },
        undefined,
        error => {
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
      }
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
   * Rebuild the texture atlas from scratch
   * This will clear the current atlas and reload all textures
   * @returns {Promise<void>}
   */
  async rebuildTextureAtlas() {
    console.log('Rebuilding texture atlas from scratch...');
      
    // Save a copy of the currently loaded textures
    const loadedTextures = Array.from(this._textureAtlasMetadata.keys());
      
    // Recreate the canvas and context
    this._textureAtlasCanvas.width = 512;
    this._textureAtlasCanvas.height = 512;
      this._textureAtlasContext.clearRect(0, 0, this._textureAtlasCanvas.width, this._textureAtlasCanvas.height);
      
    // Clear metadata and caches
    this._textureAtlasMetadata.clear();
    this._textureUVCache.clear();
    this._textureLoadFailures.clear();
    
    // Dispose of the old texture
    if (this._textureAtlas) {
      this._textureAtlas.dispose();
    }
    
    // Create a new texture atlas
    this._textureAtlas = new THREE.CanvasTexture(this._textureAtlasCanvas);
    this._textureAtlas.minFilter = THREE.NearestFilter;
    this._textureAtlas.magFilter = THREE.NearestFilter;
    this._textureAtlas.colorSpace = THREE.SRGBColorSpace;
    
    // Load all essential textures first
      for (const textureUri of this._essentialTextures) {
        try {
          await this.loadTexture(textureUri);
        } catch (error) {
        console.warn(`Failed to load essential texture: ${textureUri}`, error);
      }
    }
    
    console.log(`Reloading ${loadedTextures.length} previously loaded textures...`);
    
    // Group textures by type to optimize loading
    const singleFileTextures = loadedTextures.filter(uri => uri.match(/\/blocks\/[^\/]+\.(png|jpe?g)$/i));
    const faceTextures = loadedTextures.filter(uri => uri.match(/\/blocks\/[^\/]+\/[\+\-][xyz]\.png$/i));
    
    // For other textures, first check if they might be block types without extensions
    const blockTypeRegex = /\/blocks\/([^\/\.]+)$/;
    const possibleBlockTypes = new Set();
    
    // Extract potential block types from paths without extensions
    const otherTextures = loadedTextures.filter(uri => {
      if (!singleFileTextures.includes(uri) && !faceTextures.includes(uri)) {
        const match = uri.match(blockTypeRegex);
        if (match) {
          // This looks like a block type reference (e.g., blocks/stone)
          possibleBlockTypes.add(match[1]);
        }
      return true;
      }
      return false;
    });
    
    // Extract block types from face textures
    const blockTypesSet = new Set();
    for (const faceTexture of faceTextures) {
      const match = faceTexture.match(/\/blocks\/([^\/]+)\//);
      if (match) {
        blockTypesSet.add(match[1]);
      }
    }
    
    // Combine block types from both sources
    for (const blockType of possibleBlockTypes) {
      blockTypesSet.add(blockType);
    }
    
    const blockTypes = Array.from(blockTypesSet);
    
    // Load textures in batches - starting with single file textures
    const uniqueSingleFiles = [...new Set(singleFileTextures.map(uri => {
      const match = uri.match(/\/blocks\/([^\/]+\.(png|jpe?g))$/i);
      return match ? match[1] : null;
    }))].filter(Boolean);
    
    // First, try loading single file textures with the .png extension
    let singleTextureLoadCount = 0;
    for (const textureFile of uniqueSingleFiles) {
      try {
        // Use a simplified version of preloadMultiSidedTextures for rebuilding
        const path = `./assets/blocks/${textureFile}`;
        const textureLoader = new THREE.TextureLoader();
        await new Promise((resolve) => {
          textureLoader.load(
            path,
            texture => {
              if (texture.image) {
                // Draw to atlas without updating
                const metadata = this._drawTextureToAtlas(texture, path, false);
                this._textureAtlasMetadata.set(path, metadata);
                singleTextureLoadCount++;
                
                // For single textures, also create references for base name
                const blockName = textureFile.replace(/\.(png|jpe?g)$/, '');
                this._textureAtlasMetadata.set(`blocks/${blockName}`, metadata);
                this._textureAtlasMetadata.set(`./assets/blocks/${blockName}`, metadata);
              }
              resolve();
            },
            undefined,
            () => {
              // Silently fail and continue
              resolve();
            }
          );
        });
      } catch (error) {
        // Continue with other textures
      }
    }
    
    // Then load block types with their face textures
    let blockTypeLoadCount = 0;
    for (const blockType of blockTypes) {
      try {
        // First check if a single file version exists (blockType.png)
        let loaded = false;
        const possibleExtensions = ['png', 'jpg', 'jpeg'];
        
        for (const ext of possibleExtensions) {
          if (loaded) break;
          
          const singlePath = `./assets/blocks/${blockType}.${ext}`;
          try {
            // Skip if we already loaded this as a single file texture
            if (this._textureAtlasMetadata.has(singlePath)) {
              loaded = true;
              blockTypeLoadCount++;
              break;
            }
            
            // Try to load as a single file
            await new Promise((resolve) => {
              const textureLoader = new THREE.TextureLoader();
              textureLoader.load(
                singlePath,
                texture => {
                  if (texture.image) {
                    // Draw to atlas without updating
                    const metadata = this._drawTextureToAtlas(texture, singlePath, false);
                    this._textureAtlasMetadata.set(singlePath, metadata);
                    this._textureAtlasMetadata.set(`blocks/${blockType}`, metadata);
                    this._textureAtlasMetadata.set(`./assets/blocks/${blockType}`, metadata);
                    loaded = true;
                    blockTypeLoadCount++;
                  }
                  resolve();
                },
                undefined,
                () => {
                  // Silently fail and continue to next extension
                  resolve();
                }
              );
            });
          } catch (error) {
            // Continue with next extension
          }
        }
        
        // If no single file version, try multi-sided loading (only if not loaded already)
        if (!loaded) {
          // Try to load face textures
          const faceMap = {
            'top': `./assets/blocks/${blockType}/+y.png`,
            'bottom': `./assets/blocks/${blockType}/-y.png`,
            'left': `./assets/blocks/${blockType}/-x.png`,
            'right': `./assets/blocks/${blockType}/+x.png`,
            'front': `./assets/blocks/${blockType}/+z.png`,
            'back': `./assets/blocks/${blockType}/-z.png`
          };
          
          let loadedFaces = 0;
          let firstFaceMetadata = null;
          
          // Load each face
          for (const [faceName, facePath] of Object.entries(faceMap)) {
            try {
              await new Promise((resolve) => {
                const textureLoader = new THREE.TextureLoader();
                textureLoader.load(
                  facePath,
                  texture => {
                    if (texture.image) {
                      // Draw to atlas without updating
                      const metadata = this._drawTextureToAtlas(texture, facePath, false);
                      this._textureAtlasMetadata.set(facePath, metadata);
                      loadedFaces++;
                      
                      // Store first face metadata for base references
                      if (!firstFaceMetadata) {
                        firstFaceMetadata = metadata;
                      }
                    }
                    resolve();
                  },
                  undefined,
                  () => {
                    // Silently fail and continue
                    resolve();
                  }
                );
              });
            } catch (error) {
              // Continue with other faces
            }
          }
          
          // If we loaded at least one face, consider this block type loaded
          if (loadedFaces > 0 && firstFaceMetadata) {
            // Set base references
            this._textureAtlasMetadata.set(`blocks/${blockType}`, firstFaceMetadata);
            this._textureAtlasMetadata.set(`./assets/blocks/${blockType}`, firstFaceMetadata);
            blockTypeLoadCount++;
          }
        }
      } catch (error) {
        // Silently continue to next block type
      }
    }
    
    console.log(`Loaded ${singleTextureLoadCount} single textures and ${blockTypeLoadCount} block types during atlas rebuild`);
    
    // Update texture atlas once after all textures are loaded
    this._updateTextureAtlas();
    
    // Update materials with new atlas
    BlockMaterial.instance.setTextureAtlas(this._textureAtlas);
    
    console.log('Texture atlas rebuild complete');
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
                  const faceReferences = {
                    'top': '+y.png',
                    'bottom': '-y.png',
                    'left': '-x.png',
                    'right': '+x.png',
                    'front': '+z.png',
                    'back': '-z.png'
                  };
                  
                  // Create aliases for all faces without logging
                  Object.entries(faceReferences).forEach(([faceName, faceFile]) => {
                    const baseName = blockType.replace(/\.(png|jpe?g)$/, '');
                    const facePath = `./assets/blocks/${baseName}/${faceFile}`;
                    this._textureAtlasMetadata.set(facePath, metadata);
                  });
                  
                  // Also set base paths
                  const blockName = blockType.replace(/\.(png|jpe?g)$/, '');
                  this._textureAtlasMetadata.set(`blocks/${blockName}`, metadata);
                  this._textureAtlasMetadata.set(`./assets/blocks/${blockName}`, metadata);
                }
                // For multi-sided textures, add aliases based on faces - no need to log for common textures
                else if (path.includes('+y.png')) {
                  // Add aliases for top texture
                  this._textureAtlasMetadata.set(`./assets/blocks/${blockType}/top.png`, metadata);
                  this._textureAtlasMetadata.set(`blocks/${blockType}/top`, metadata);
                  this._textureAtlasMetadata.set(`blocks/${blockType}/top.png`, metadata);
                } 
                else if (path.includes('-y.png') ) {
                  // Add aliases for bottom texture
                  this._textureAtlasMetadata.set(`./assets/blocks/${blockType}/bottom.png`, metadata);
                  this._textureAtlasMetadata.set(`blocks/${blockType}/bottom`, metadata);
                  this._textureAtlasMetadata.set(`blocks/${blockType}/bottom.png`, metadata);
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
                // For multi-sided textures, we can continue with other faces
                resolve(); // Continue loading other textures
              }
            }
          );
        });
      } catch (error) {
        // Continue with other textures even if one fails
      }
    }
    
    // Update texture atlas once after all textures are loaded, instead of after each one
    if (loadedTextures > 0) {
      this._updateTextureAtlas();
    }
    
    // Update materials with new atlas
    BlockMaterial.instance.setTextureAtlas(this._textureAtlas);
    
    // For single textures or directory-based textures, set up base paths
    if (loadedTextures > 0) {
      let baseMetadata;
      
      if (isSingleTexture) {
        // For single textures, use the one texture we loaded
        baseMetadata = this._textureAtlasMetadata.get(baseTexturePath);
        const blockName = blockType.replace(/\.(png|jpe?g)$/, '');
        
        // Set standard base paths
        if (baseMetadata) {
          this._textureAtlasMetadata.set(`blocks/${blockName}`, baseMetadata);
          this._textureAtlasMetadata.set(`./assets/blocks/${blockName}`, baseMetadata);
        }
      } else {
        // For multi-sided textures, prefer the top texture
        const topPath = `./assets/blocks/${blockType}/+y.png`;
        baseMetadata = this._textureAtlasMetadata.get(topPath);
        
        if (baseMetadata) {
          this._textureAtlasMetadata.set(`blocks/${blockType}`, baseMetadata);
          this._textureAtlasMetadata.set(`./assets/blocks/${blockType}`, baseMetadata);
        }
      }
    }
    
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
    
    // Check if this is a single-texture file based on the extension
    const isSingleTexture = blockType.endsWith('.png') || 
                           blockType.endsWith('.jpg') || 
                           blockType.endsWith('.jpeg');
    
    let exactPath;
    
    if (isSingleTexture) {
      // For single textures, use the main texture file for all faces
      exactPath = `./assets/blocks/${blockType}`;
    } else {
      // First check if a single texture version of this block exists
      // Try common image formats: png, jpg, jpeg
      const possibleExtensions = ['png', 'jpg', 'jpeg'];
      let singleTextureMetadata = null;
      
      for (const ext of possibleExtensions) {
        const singleTexturePath = `./assets/blocks/${blockType}.${ext}`;
        const metadata = this._textureAtlasMetadata.get(singleTexturePath);
        
        if (metadata) {
          singleTextureMetadata = metadata;
          break;
        }
      }
      
      if (singleTextureMetadata) {
        // If the single texture exists, use it for all faces
        return this._calculateUVCoordinates(singleTextureMetadata, uvOffset);
      }
      
      // Define the face mapping for multi-sided blocks
      const faceMap = {
        'top': '+y.png',
        'bottom': '-y.png',
        'left': '-x.png',
        'right': '+x.png',
        'front': '+z.png',
        'back': '-z.png'
      };
      
      // Get the exact path for this face
      if (!faceMap[blockFace]) {
        //console.error(`❌ Invalid block face: ${blockFace}`);
        return [0, 0]; // Return default coordinates for invalid face
      }
      
      // Construct the path for this block type and face
      exactPath = `./assets/blocks/${blockType}/${faceMap[blockFace]}`;
    }
    
    // Get metadata for this exact path
    const metadata = this._textureAtlasMetadata.get(exactPath);
    if (!metadata) {
      // Only log errors for non-common textures to reduce console spam
    
      // Check if any textures of this type are loaded
      const blockTextures = Array.from(this._textureAtlasMetadata.keys())
        .filter(key => key.includes(blockType));
      
      if (blockTextures.length > 0) {
        // Try to use any available texture as fallback
        const fallbackMetadata = this._textureAtlasMetadata.get(blockTextures[0]);
        if (fallbackMetadata) {
          return this._calculateUVCoordinates(fallbackMetadata, uvOffset);
        }
      }
      
      // If we still don't have metadata, try using the base path with different extensions
      if (!isSingleTexture) {
        const possibleExtensions = ['png', 'jpg', 'jpeg'];
        for (const ext of possibleExtensions) {
          const blockBasePath = `./assets/blocks/${blockType}.${ext}`;
          const baseMetadata = this._textureAtlasMetadata.get(blockBasePath);
          
          if (baseMetadata) {
            return this._calculateUVCoordinates(baseMetadata, uvOffset);
          }
        }
      } else {
        // For single textures, try without extension
        const blockName = blockType.replace(/\.(png|jpe?g)$/, '');
        const basePath = `./assets/blocks/${blockName}`;
        const baseMetadata = this._textureAtlasMetadata.get(basePath);
        
        if (baseMetadata) {
          return this._calculateUVCoordinates(baseMetadata, uvOffset);
        }
      }
      
      // If all else fails, try loading the texture on demand
      this.queueTextureForLoading(exactPath);
      
      return [0, 0]; // Return default coordinates while texture loads
    }
    
    // Calculate UV coordinates
    const result = this._calculateUVCoordinates(metadata, uvOffset);
    return result;
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
}

// Initialize the singleton instance
BlockTextureAtlas._instance = null;

export default BlockTextureAtlas; 