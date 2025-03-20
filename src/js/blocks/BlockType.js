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
              // Ignore error, will try fallbacks
            }
          }
          
          // Try to load common fallback textures
          const fallbacks = ['all.png', 'default.png'];
          for (const fallback of fallbacks) {
            try {
              await BlockTextureAtlas.instance.loadTexture(`${textureUri}/${fallback}`);
            } catch (error) {
              // Ignore error, will try next fallback
            }
          }
        } else {
          // Load the texture directly if it has an extension
          await BlockTextureAtlas.instance.loadTexture(textureUri);
        }
      } catch (error) {
        console.warn(`Failed to preload texture uri ${textureUri} for face ${face}`, error);
      }
    });

    try {
      await Promise.all(loadPromises);
    } catch (error) {
      console.warn('Failed to preload some textures', error);
    }
  }
}

export default BlockType; 