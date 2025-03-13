/**
 * TextureAtlasManager
 * Manages texture atlas initialization and operations
 */

import { TextureAtlas, ChunkMeshBuilder, ChunkLoadManager } from "../TextureAtlas";
import { getBlockTypes } from "./BlockTypesManager";

// Use texture atlas for rendering
let textureAtlas = null;
let chunkMeshBuilder = null;
let chunkLoadManager = null;

// Track if the atlas is initialized
let atlasInitialized = false;

/**
 * Initialize the texture atlas with the provided block types
 * @param {Array} blockTypes - Array of block types to initialize the atlas with
 * @returns {Object|null} - The atlas texture or null if initialization failed
 */
export const initTextureAtlas = async (blockTypes = null) => {
  // Use provided block types or get them from BlockTypesManager
  const blocksToUse = blockTypes || getBlockTypes();
  
  if (!blocksToUse || blocksToUse.length === 0) {
    console.warn("Cannot initialize texture atlas: No block types provided");
    return null;
  }
  
  if (atlasInitialized && textureAtlas) {
    console.log("Texture atlas already initialized, returning existing instance");
    return textureAtlas.getAtlasTexture();
  }
  
  console.log(`Initializing texture atlas with ${blocksToUse.length} block types...`);
  
  try {
    // Reset initialization flag until complete
    atlasInitialized = false;
    
    // Create new instances if they don't exist
    if (!textureAtlas) {
      textureAtlas = new TextureAtlas();
    }
    
    // Wait for the atlas to be initialized
    const atlas = await textureAtlas.initialize(blocksToUse);
    
    if (!atlas) {
      throw new Error("Texture atlas initialization failed: No atlas returned");
    }
    
    // Only create chunk mesh builder if the atlas was successfully initialized
    if (!chunkMeshBuilder) {
      chunkMeshBuilder = new ChunkMeshBuilder(textureAtlas);
    } else {
      // Update existing mesh builder with new atlas
      chunkMeshBuilder.textureAtlas = textureAtlas;
    }
    
    // Only set initialized flag when everything is complete
    atlasInitialized = true;
    console.log("Texture atlas successfully initialized with:", 
      textureAtlas ? `${textureAtlas.blockUVs.size} block textures` : "no textures");
    
    return atlas;
  } catch (error) {
    console.error("Texture atlas initialization failed with error:", error);
    atlasInitialized = false;
    return null;
  }
};

/**
 * Get the texture atlas instance
 * @returns {Object|null} - The texture atlas or null if not initialized
 */
export const getTextureAtlas = () => {
  return textureAtlas;
};

/**
 * Get the chunk mesh builder instance
 * @returns {Object|null} - The chunk mesh builder or null if not initialized
 */
export const getChunkMeshBuilder = () => {
  return chunkMeshBuilder;
};

/**
 * Create a chunk load manager
 * @param {Object} options - Options for the chunk load manager
 * @returns {Object} - The chunk load manager
 */
export const createChunkLoadManager = (options = {}) => {
  chunkLoadManager = new ChunkLoadManager(options);
  return chunkLoadManager;
};

/**
 * Get the chunk load manager instance
 * @returns {Object|null} - The chunk load manager or null if not initialized
 */
export const getChunkLoadManager = () => {
  return chunkLoadManager;
};

/**
 * Check if the texture atlas is initialized
 * @returns {boolean} - True if the atlas is initialized
 */
export const isAtlasInitialized = () => {
  return atlasInitialized;
};

/**
 * Generate a greedy mesh for the provided chunks blocks
 * @param {Object} chunksBlocks - Blocks for a chunk
 * @param {Array} blockTypes - Block types
 * @returns {Object|null} - The generated mesh or null if texture atlas is not initialized
 */
export const generateGreedyMesh = (chunksBlocks, blockTypes) => {
  if (!atlasInitialized || !chunkMeshBuilder) {
    //console.warn("Texture atlas not initialized, cannot generate greedy mesh");
    return null;
  }
  
  return chunkMeshBuilder.buildChunkMesh(chunksBlocks, blockTypes);
}; 