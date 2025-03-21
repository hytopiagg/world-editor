// BlockTypeRegistry.js
// Registry for block types

import BlockType from './BlockType';
import { getBlockTypes } from '../managers/BlockTypesManager';
import BlockTextureAtlas from './BlockTextureAtlas';

/**
 * Registry for block types
 */
class BlockTypeRegistry {
  constructor() {
    this._blockTypes = {};
    this._initialized = false;
    
    // Expanded list of essential block types to preload - include more common blocks
    // This ensures more textures are loaded immediately on startup
    this._essentialBlockTypes = new Set([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 
      11, 12, 13, 14, 15  // Add more common block IDs
    ]); 
  }

  /**
   * Get the singleton instance
   * @returns {BlockTypeRegistry} The singleton instance
   */
  static get instance() {
    if (!this._instance) {
      this._instance = new BlockTypeRegistry();
    }
    return this._instance;
  }

  /**
   * Initialize the registry with block types from BlockTypesManager
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this._initialized) {
      return;
    }

    console.time('BlockTypeRegistry.initialize');
    
    // Ensure error texture is loaded first
    try {
      BlockTextureAtlas.instance.markTextureAsEssential('./assets/blocks/error.png');
      await BlockTextureAtlas.instance.loadTexture('./assets/blocks/error.png');
    } catch (error) {
      console.warn('Failed to load error texture:', error);
    }

    const blockTypes = getBlockTypes();
    
    // First pass: register all block types without loading textures
    for (const blockTypeData of blockTypes) {
      const blockType = new BlockType({
        id: blockTypeData.id,
        isLiquid: blockTypeData.isLiquid || false,
        name: blockTypeData.name || 'Unknown',
        textureUris: blockTypeData.isMultiTexture 
          ? blockTypeData.sideTextures 
          : BlockType.textureUriToTextureUris(blockTypeData.textureUri)
      });
      
      this._blockTypes[blockTypeData.id] = blockType;
    }
    
    this._initialized = true;
    console.log(`BlockTypeRegistry initialized with ${Object.keys(this._blockTypes).length} block types`);
    console.timeEnd('BlockTypeRegistry.initialize');
  }

  /**
   * Register a block type
   * @param {BlockType} blockType - The block type to register
   * @returns {Promise<void>}
   */
  async registerBlockType(blockType) {
    this._blockTypes[blockType.id] = blockType;
  }

  /**
   * Unregister a block type
   * @param {number} id - The block type ID to unregister
   */
  unregisterBlockType(id) {
    delete this._blockTypes[id];
  }

  /**
   * Get a block type by ID
   * @param {number} id - The block type ID
   * @returns {BlockType|undefined} The block type, or undefined if not found
   */
  getBlockType(id) {
    return this._blockTypes[id];
  }

  /**
   * Update a block type from data
   * @param {Object} blockTypeData - The block type data
   * @returns {Promise<void>}
   */
  async updateBlockType(blockTypeData) {
    const blockType = this._blockTypes[blockTypeData.id];

    if (!blockType) {
      await this.registerBlockType(new BlockType({
        id: blockTypeData.id,
        isLiquid: blockTypeData.isLiquid || false,
        name: blockTypeData.name || 'Unknown',
        textureUris: blockTypeData.isMultiTexture 
          ? blockTypeData.sideTextures 
          : BlockType.textureUriToTextureUris(blockTypeData.textureUri)
      }));
    } else {
      if (blockTypeData.name) {
        blockType.setName(blockTypeData.name);
      }

      if (blockTypeData.textureUri || blockTypeData.sideTextures) {
        const textureUris = blockTypeData.isMultiTexture 
          ? blockTypeData.sideTextures 
          : BlockType.textureUriToTextureUris(blockTypeData.textureUri);
        await blockType.setTextureUris(textureUris);
      }
    }
  }

  /**
   * Preload all textures for all block types
   * @returns {Promise<void>}
   */
  async preload() {
    console.time('BlockTypeRegistry.preload');
    
    // Mark ALL block types as essential to ensure everything loads properly
    Object.values(this._blockTypes).forEach(blockType => {
      this._essentialBlockTypes.add(blockType.id);
    });
    
    // Get all block types, but only preload those that actually need it
    const allBlockTypes = Object.values(this._blockTypes);
    const blockTypesToPreload = allBlockTypes.filter(blockType => 
      blockType.needsTexturePreload?.() ?? true
    );
    
    if (blockTypesToPreload.length === 0) {
      console.log('No block types need texture preloading, skipping.');
      console.timeEnd('BlockTypeRegistry.preload');
      return;
    }
    
    console.log(`Preloading textures for ${blockTypesToPreload.length} block types...`);
    
    await Promise.all(blockTypesToPreload.map(blockType => blockType.preloadTextures()));
    
    console.timeEnd('BlockTypeRegistry.preload');
  }
  
  /**
   * Add a block type ID to the essential block types set
   * @param {number} id - The block type ID to mark as essential
   */
  markBlockTypeAsEssential(id) {
    this._essentialBlockTypes.add(id);
  }
}

// Initialize the singleton instance
BlockTypeRegistry._instance = null;

export default BlockTypeRegistry; 