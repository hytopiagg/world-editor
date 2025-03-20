/**
 * TextureAtlasManager
 * Compatibility layer for migrating from TextureAtlas to BlockTextureAtlas and ChunkSystem
 */

// Import the new system components
import BlockTextureAtlas from "../blocks/BlockTextureAtlas";
import BlockTypeRegistry from "../blocks/BlockTypeRegistry";
import { getChunkSystem } from "../chunks/TerrainBuilderIntegration";
import { getBlockTypes } from "./BlockTypesManager";

// Track if the system is initialized
let systemInitialized = false;

/**
 * Initialize the texture atlas with the provided block types
 * This is a compatibility function that now uses BlockTextureAtlas and ChunkSystem
 * @param {Array} blockTypes - Array of block types to initialize the atlas with
 * @returns {Object|null} - The atlas texture or null if initialization failed
 */
export const initTextureAtlas = async (blockTypes = null) => {
  console.log("Using new BlockTextureAtlas and ChunkSystem");
  
  // The ChunkSystem initializes the BlockTextureAtlas automatically
  // This function remains for compatibility
  
  // Return the texture from BlockTextureAtlas if available
  const blockTextureAtlas = BlockTextureAtlas.instance;
  if (blockTextureAtlas) {
    systemInitialized = true;
    return blockTextureAtlas.textureAtlas;
  }
  
  return null;
};

/**
 * Get the texture atlas instance
 * @returns {Object|null} - The texture atlas or null if not initialized
 */
export const getTextureAtlas = () => {
  const blockTextureAtlas = BlockTextureAtlas.instance;
  return blockTextureAtlas ? { 
    getAtlasTexture: () => blockTextureAtlas.textureAtlas,
    blockUVs: { size: 0 } // Compatibility property
  } : null;
};

/**
 * Get the chunk mesh builder instance
 * @returns {Object|null} - A compatibility wrapper for the ChunkSystem
 */
export const getChunkMeshBuilder = () => {
  const chunkSystem = getChunkSystem();
  
  // Return a compatibility wrapper
  return chunkSystem ? {
    buildChunkMesh: (chunksBlocks, blockTypes) => {
      console.warn("Using compatibility layer for buildChunkMesh - consider upgrading to ChunkSystem directly");
      // This is a simplified compatibility stub - real implementation would need to convert formats
      return { geometry: null, material: null };
    },
    setGreedyMeshing: (enabled) => {
      console.warn("setGreedyMeshing called via compatibility layer - consider using constants/terrain directly");
    },
    textureAtlas: getTextureAtlas()
  } : null;
};

/**
 * Create a chunk load manager
 * @param {Object} options - Options for the chunk load manager
 * @returns {Object} - Compatibility wrapper for ChunkSystem
 */
export const createChunkLoadManager = (options = {}) => {
  console.warn("createChunkLoadManager called via compatibility layer - consider using ChunkSystem directly");
  
  // Return a compatibility wrapper
  return {
    addChunkToQueue: (chunkKey, priority) => {
      // No-op, handled by ChunkSystem internally
    },
    clearQueue: () => {
      // No-op, handled by ChunkSystem internally
    },
    pause: () => {
      // No-op, handled by ChunkSystem internally
    },
    resume: () => {
      // No-op, handled by ChunkSystem internally
    },
    maxConcurrentLoads: options.maxConcurrentLoads || 4,
    processingTimeLimit: options.processingTimeLimit || 20
  };
};

/**
 * Get the chunk load manager instance
 * @returns {Object|null} - Compatibility wrapper for ChunkSystem
 */
export const getChunkLoadManager = () => {
  return createChunkLoadManager(); // Return a dummy wrapper
};

/**
 * Check if the texture atlas is initialized
 * @returns {boolean} - True if the system is initialized
 */
export const isAtlasInitialized = () => {
  // Check if both BlockTextureAtlas and ChunkSystem are initialized
  const blockTextureAtlas = BlockTextureAtlas.instance;
  const chunkSystem = getChunkSystem();
  
  return blockTextureAtlas && chunkSystem && chunkSystem._initialized;
};

/**
 * Generate a greedy mesh for the provided chunks blocks
 * @param {Object} chunksBlocks - Blocks for a chunk
 * @param {Array} blockTypes - Block types
 * @returns {Object|null} - The generated mesh or null if texture atlas is not initialized
 */
export const generateGreedyMesh = (chunksBlocks, blockTypes) => {
  console.warn("generateGreedyMesh called via compatibility layer - use ChunkSystem directly");
  // This is now handled internally by the ChunkSystem
  return null;
}; 