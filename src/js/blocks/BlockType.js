// BlockType.js
// Represents a block type in the world

import BlockTextureAtlas from './BlockTextureAtlas';
import {
  BlockFaces,
  DEFAULT_BLOCK_AO_INTENSITY,
  DEFAULT_BLOCK_COLOR,
  DEFAULT_BLOCK_FACE_GEOMETRIES,
  DEFAULT_BLOCK_NEIGHBOR_OFFSETS,
  BlockFaceAxes
} from './BlockConstants';

/**
 * Represents a block type in the world
 */
class BlockType {
  /**
   * Create a new block type
   * @param {Object} data - Block type data
   * @param {number} data.id - Block type ID
   * @param {boolean} data.isLiquid - Whether the block is a liquid
   * @param {string} data.name - Block type name
   * @param {Object} data.textureUris - Texture URIs for each face
   */
  constructor(data) {
    if (data.id === 0) {
      throw new Error('BlockType.constructor(): Block type id cannot be 0 because it is reserved for air!');
    }

    this._id = data.id;
    this._aoIntensity = DEFAULT_BLOCK_AO_INTENSITY;
    this._blockFaces = BlockFaces;
    this._blockFaceGeometries = DEFAULT_BLOCK_FACE_GEOMETRIES;
    this._blockNeighborOffsets = DEFAULT_BLOCK_NEIGHBOR_OFFSETS;
    this._color = DEFAULT_BLOCK_COLOR;
    this._isLiquid = data.isLiquid || false;
    this._name = data.name || 'Unknown';
    this._textureUris = data.textureUris || {};
    
    // Mark if this is a commonly used block type (ID < 10)
    this._isCommonlyUsed = data.id < 10;
    
    // Don't preload textures automatically - use lazy loading instead
    // If this is a commonly used block, preload its textures
    if (this._isCommonlyUsed) {
      this.preloadTextures();
    }
  }

  /**
   * Get the block type ID
   * @returns {number} The block type ID
   */
  get id() {
    return this._id;
  }

  /**
   * Get the ambient occlusion intensity
   * @returns {Array} The AO intensity values
   */
  get aoIntensity() {
    return this._aoIntensity;
  }

  /**
   * Get the block color
   * @returns {Array} The block color [r, g, b, a]
   */
  get color() {
    return this._color;
  }

  /**
   * Get the block faces
   * @returns {Array} The block faces
   */
  get faces() {
    return this._blockFaces;
  }

  /**
   * Get the block face geometries
   * @returns {Object} The block face geometries
   */
  get faceGeometries() {
    return this._blockFaceGeometries;
  }

  /**
   * Check if the block is a liquid
   * @returns {boolean} True if the block is a liquid
   */
  get isLiquid() {
    return this._isLiquid;
  }

  /**
   * Get the block name
   * @returns {string} The block name
   */
  get name() {
    return this._name;
  }

  /**
   * Get the block neighbor offsets
   * @returns {Array} The block neighbor offsets
   */
  get neighborOffsets() {
    return this._blockNeighborOffsets;
  }

  /**
   * Get the block texture URIs
   * @returns {Object} The block texture URIs
   */
  get textureUris() {
    return this._textureUris;
  }

  /**
   * Check if this block type has multi-sided textures
   * @returns {boolean} True if the block has different textures for different faces
   */
  get isMultiSided() {
    // If there's more than one unique texture URI, it's multi-sided
    const uniqueTextureUris = new Set(Object.values(this._textureUris).filter(Boolean));
    
    // If we have more than one unique texture URI, it's clearly multi-sided
    if (uniqueTextureUris.size > 1) {
      return true;
    }
    
    // If we have exactly one unique texture URI, check if it's a folder path
    if (uniqueTextureUris.size === 1) {
      const textureUri = Array.from(uniqueTextureUris)[0];
      // If the texture URI doesn't have an extension, it's likely a folder path
      return !textureUri.match(/\.(png|jpe?g)$/i);
    }
    
    return false;
  }

  /**
   * Convert a single texture URI to a map of face texture URIs
   * @param {string} textureUri - The texture URI
   * @returns {Object} The face texture URIs
   */
  static textureUriToTextureUris(textureUri) {
    const uriParts = textureUri.split('/');
    const isSingleTexture = uriParts[uriParts.length - 1].includes('.');
    const baseUri = textureUri;

    return Object.entries(BlockFaceAxes).reduce((textureUris, [face, axis]) => {
      textureUris[face] = isSingleTexture ? baseUri : `${baseUri}/${axis}.png`;
      return textureUris;
    }, {});
  }

  /**
   * Check if a face is transparent
   * @param {string} face - The face to check
   * @returns {boolean} True if the face is transparent
   */
  isFaceTransparent(face) {
    const textureMetadata = BlockTextureAtlas.instance.getTextureMetadata(this._textureUris[face]);
    return textureMetadata?.isTransparent ?? false;
  }

  /**
   * Set the block name
   * @param {string} name - The new name
   */
  setName(name) {
    this._name = name;
  }

  /**
   * Set the block texture URIs
   * @param {Object} textureUris - The new texture URIs
   * @returns {Promise<void>}
   */
  async setTextureUris(textureUris) {
    this._textureUris = textureUris;
    
    // Only preload textures for commonly used blocks
    if (this._isCommonlyUsed) {
      await this.preloadTextures();
    } else {
      // For other blocks, just queue the textures for loading
      this.queueTexturesForLoading();
    }
  }

  /**
   * Queue all textures for this block type for loading without waiting
   */
  queueTexturesForLoading() {
    Object.values(this._textureUris).forEach(textureUri => {
      if (!textureUri) return;
      
      // Queue the texture for loading
      BlockTextureAtlas.instance.queueTextureForLoading(textureUri);
      
      // If the texture URI doesn't have an extension, queue variants
      if (!textureUri.match(/\.(png|jpe?g)$/i)) {
        // Queue the base texture with extension
        BlockTextureAtlas.instance.queueTextureForLoading(`${textureUri}.png`);
        
        // Queue common fallback textures
        const fallbacks = ['all.png', 'default.png'];
        for (const fallback of fallbacks) {
          BlockTextureAtlas.instance.queueTextureForLoading(`${textureUri}/${fallback}`);
        }
      }
    });
  }

  /**
   * Preload all textures for this block type
   * @returns {Promise<void>}
   */
  async preloadTextures() {
    const loadPromises = Object.entries(this._textureUris).map(async ([face, textureUri]) => {
      if (!textureUri) return;
      
      try {
        // For data URIs, load directly without trying to append extensions
        if (textureUri.startsWith('data:image/')) {
          await BlockTextureAtlas.instance.loadTexture(textureUri);
          return;
        }
        
        // If the texture URI doesn't have an extension, try to load multiple variants
        if (!textureUri.match(/\.(png|jpe?g)$/i)) {
          // Try to load the base texture with extension
          try {
            await BlockTextureAtlas.instance.loadTexture(`${textureUri}.png`);
          } catch (error) {
            // Ignore error, will try other variants
          }
          
          // Try to load face-specific textures
          const faceMap = {
            'top': '+y.png',
            'bottom': '-y.png',
            'left': '-x.png',
            'right': '+x.png',
            'front': '+z.png',
            'back': '-z.png'
          };
          
          // Load the specific face texture
          if (faceMap[face]) {
            try {
              await BlockTextureAtlas.instance.loadTexture(`${textureUri}/${faceMap[face]}`);
            } catch (error) {
              // Ignore error, will try the direct texture URI next
            }
          }
        }
        
        // Finally, try to load the direct texture URI
        await BlockTextureAtlas.instance.loadTexture(textureUri);
      } catch (error) {
        console.warn(`Failed to preload texture for face ${face}: ${textureUri}`, error);
      }
    });
    
    await Promise.all(loadPromises);
  }

  /**
   * Check if this block type's textures need to be preloaded
   * @returns {boolean} True if any textures need to be preloaded
   */
  needsTexturePreload() {
    // If there are no texture URIs, no need to preload
    if (!this._textureUris || Object.keys(this._textureUris).length === 0) {
      return false;
    }
    
    // Check if any of the textures are not loaded
    for (const [face, textureUri] of Object.entries(this._textureUris)) {
      if (!textureUri) continue;
      
      const textureAtlas = BlockTextureAtlas.instance;
      
      // For non-extension textures (multi-sided blocks)
      if (!textureUri.match(/\.(png|jpe?g)$/i)) {
        const faceMap = {
          'top': '+y.png',
          'bottom': '-y.png',
          'left': '-x.png',
          'right': '+x.png',
          'front': '+z.png',
          'back': '-z.png'
        };
        
        // Check if the face-specific texture is loaded
        if (faceMap[face]) {
          const facePath = `${textureUri}/${faceMap[face]}`;
          if (!textureAtlas.getTextureMetadata(facePath)) {
            return true; // Needs preloading
          }
        }
        
        // Check if any fallback texture is loaded
        const basePaths = [
          `${textureUri}.png`,
          `${textureUri}/all.png`,
          `${textureUri}/default.png`
        ];
        
        // If none of the possible textures are loaded, needs preloading
        const anyTextureLoaded = basePaths.some(path => 
          textureAtlas.getTextureMetadata(path)
        );
        
        if (!anyTextureLoaded) {
          return true; // Needs preloading
        }
      } else {
        // Direct check for single textures with extensions
        if (!textureAtlas.getTextureMetadata(textureUri)) {
          return true; // Needs preloading
        }
      }
    }
    
    // All textures are already loaded
    return false;
  }

  /**
   * Set a custom texture for this block type from a data URI
   * @param {string} dataUri - The data URI of the texture
   * @param {string|null} customId - Optional custom ID for the texture
   * @returns {Promise<void>}
   */
  async setCustomTexture(dataUri, customId = null) {
    if (!dataUri) {
      console.error('No data URI provided for custom texture');
      return;
    }

    // Check if this is a valid data URI
    if (!dataUri.startsWith('data:image/')) {
      console.error('Invalid data URI format for custom texture');
      return;
    }

    console.log(`Setting custom texture for block type ${this._id} (${this._name})...`);

    // Use the data URI as the ID if no custom ID is provided
    const textureId = customId || dataUri;

    // For custom textures, we use the same texture for all faces
    const textureUris = {};
    const faceNames = Object.keys(BlockFaceAxes);
    faceNames.forEach(face => {
      textureUris[face] = dataUri;
      console.log(`Set texture for face "${face}": ${dataUri.substring(0, 30)}...`);
    });

    // Set the new texture URIs - this just stores references but doesn't load textures
    this._textureUris = textureUris;
    
    // Make sure BlockTextureAtlas is initialized
    if (!BlockTextureAtlas.instance) {
      console.error('BlockTextureAtlas is not initialized');
      return;
    }

    // Try to load the texture immediately to make it available
    try {
      console.log(`Loading texture from data URI (length: ${dataUri.length})...`);
      
      // First try to load it directly
      await BlockTextureAtlas.instance.loadTexture(dataUri);
      
      // Then force a rebuild of the texture atlas
      console.log(`Rebuilding texture atlas after loading custom texture...`);
      await BlockTextureAtlas.instance.rebuildTextureAtlas();
      
      // Verify that the texture metadata exists after loading
      const metadata = BlockTextureAtlas.instance.getTextureMetadata(dataUri);
      if (metadata) {
        console.log(`Texture successfully loaded with metadata:`, 
          {x: metadata.x, y: metadata.invertedY, width: metadata.width, height: metadata.height, isTransparent: metadata.isTransparent});
      } else {
        console.warn(`Texture was loaded but no metadata found for ${dataUri}!`);
        console.log(`Attempting direct loading with loadTextureFromDataURI...`);
        
        // Try a more direct approach as fallback
        await BlockTextureAtlas.instance.loadTextureFromDataURI(dataUri, dataUri);
        
        // Check again
        const retryMetadata = BlockTextureAtlas.instance.getTextureMetadata(dataUri);
        if (retryMetadata) {
          console.log(`Direct loading successful! Metadata:`, 
            {x: retryMetadata.x, y: retryMetadata.invertedY, width: retryMetadata.width, height: retryMetadata.height});
        } else {
          console.error(`Failed to load texture even with direct loading method`);
        }
      }
      
      // Make sure we force the renderer to update
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        console.log(`Dispatching texture update event...`);
        const event = new CustomEvent('textureAtlasUpdated', {
          detail: { textureId: dataUri, blockId: this._id }
        });
        window.dispatchEvent(event);
      }
    } catch (error) {
      console.error('Failed to load custom texture:', error);
    }
  }

  /**
   * Get the texture file path for the specified block face
   * @param {string} face - The face to get the texture for (front, back, left, right, top, bottom)
   * @returns {string} - The texture file path
   */
  getTextureForFace(face) {
    // If we have specific textures for each face, use those
    if (this._textureUris && this._textureUris[face]) {
      return this._textureUris[face];
    }
    
    // If there's a general texture URI, use that
    if (this._textureUri) {
      // If the URI is a data URI, return it directly without modification
      if (this._textureUri.startsWith('data:image/')) {
        return this._textureUri;
      }
      
      // For regular file paths, construct the path as before
      return this._textureUri;
    }
    
    // Fallback to default error texture
    return './assets/blocks/error.png';
  }
  
  /**
   * Get the texture file path for the blocks of this type
   * @param {string} face - The face of the block to get the texture for
   * @returns {string} - The path to the texture file
   */
  getTexturePath(face) {
    if (!face) face = 'front';
    
    if (this._textureUris && this._textureUris[face]) {
      // For data URIs, return directly without modification
      if (this._textureUris[face].startsWith('data:image/')) {
        return this._textureUris[face];
      }
      
      // Handle regular file paths
      return this._textureUris[face];
    } else if (this._textureUri) {
      // For data URIs, return directly without modification
      if (this._textureUri.startsWith('data:image/')) {
        return this._textureUri;
      }
      
      // For multi-texture blocks, compute the texture path based on the face
      if (this._isMultiTexture) {
        return `./assets/blocks/${this._textureUri}/${this.getFaceDirection(face)}.png`;
      }
      
      // For single-texture blocks, just use the texture URI
      return `./assets/blocks/${this._textureUri}`;
    }
    
    // Fallback to default error texture
    if (this._isMultiTexture) {
      return `./assets/blocks/error/${this.getFaceDirection(face)}.png`;
    }
    
    return './assets/blocks/error.png';
  }

  /**
   * Get texture URIs for this block type
   * @returns {Object} The texture URIs for each face
   */
  getTextureUris() {
    return this._textureUris || {};
  }
  
  /**
   * Apply a custom texture from a data URI
   * @param {string} dataUri - The data URI of the texture
   * @param {boolean} rebuildAtlas - Whether to rebuild the texture atlas
   * @returns {Promise<boolean>} Success status
   */
  async applyCustomTextureDataUri(dataUri, rebuildAtlas = false) {
    if (!dataUri || !dataUri.startsWith('data:image/')) {
      console.error('Invalid data URI format for custom texture');
      return false;
    }
    
    try {
      console.log(`Applying custom texture data URI for block ID ${this._id}`);
      
      // Set the texture URI for all faces
      const faces = ['top', 'bottom', 'left', 'right', 'front', 'back'];
      faces.forEach(face => {
        this._textureUris[face] = dataUri;
      });
      
      // Make sure the texture is loaded in the texture atlas
      if (BlockTextureAtlas.instance) {
        // First, try to use the specialized method
        let success = await BlockTextureAtlas.instance.applyDataUriToAllFaces(`${this._id}`, dataUri);
        
        // If that fails, try direct loading approach
        if (!success) {
          console.log(`Fallback: Direct loading for block ${this._id}`);
          await BlockTextureAtlas.instance.loadTextureFromDataURI(dataUri, dataUri);
          
          // Get the metadata
          const metadata = BlockTextureAtlas.instance.getTextureMetadata(dataUri);
          if (metadata) {
            // Manually map all the keys
            BlockTextureAtlas.instance._textureAtlasMetadata.set(`${this._id}`, metadata);
            BlockTextureAtlas.instance._textureAtlasMetadata.set(this._id, metadata);
            BlockTextureAtlas.instance._textureAtlasMetadata.set(`blocks/${this._id}`, metadata);
            faces.forEach(face => {
              const faceCoord = {
                'top': '+y', 'bottom': '-y', 'left': '-x', 
                'right': '+x', 'front': '+z', 'back': '-z'
              }[face];
              BlockTextureAtlas.instance._textureAtlasMetadata.set(`blocks/${this._id}/${faceCoord}.png`, metadata);
            });
            success = true;
          }
        }
        
        // Force rebuild the texture atlas
        if (success || rebuildAtlas) {
          await BlockTextureAtlas.instance.rebuildTextureAtlas();
        }
        
        // Always dispatch texture atlas updated event to notify components
        if (typeof window !== 'undefined') {
          const event = new CustomEvent('textureAtlasUpdated', {
            detail: { textureId: dataUri, blockId: this._id }
          });
          window.dispatchEvent(event);
          
          // Also try forcing a refresh of chunk meshes
          const blockTypeChangedEvent = new CustomEvent('blockTypeChanged', {
            detail: { blockTypeId: this._id }
          });
          window.dispatchEvent(blockTypeChangedEvent);
        }
        
        return success;
      } else {
        console.warn('BlockTextureAtlas not available');
        return false;
      }
    } catch (error) {
      console.error('Failed to apply custom texture:', error);
      return false;
    }
  }
}

export default BlockType; 