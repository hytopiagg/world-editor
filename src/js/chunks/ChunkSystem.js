// ChunkSystem.js
// Integrates the chunk system with TerrainBuilder

import * as THREE from 'three';
import BlockTypeRegistry from '../blocks/BlockTypeRegistry';
import BlockTextureAtlas from '../blocks/BlockTextureAtlas';
import ChunkManager from './ChunkManager';
import { CHUNK_SIZE } from './ChunkConstants';

/**
 * Integrates the chunk system with TerrainBuilder
 */
class ChunkSystem {
  /**
   * Create a new chunk system
   * @param {Object} scene - The THREE.js scene
   * @param {Object} options - Options for the chunk system
   */
  constructor(scene, options = {}) {
    this._scene = scene;
    this._chunkManager = new ChunkManager(scene);
    this._initialized = false;
    this._options = {
      viewDistance: options.viewDistance || 64,
      viewDistanceEnabled: options.viewDistanceEnabled !== undefined ? options.viewDistanceEnabled : true
    };
  }

  /**
   * Initialize the chunk system
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this._initialized) {
      return;
    }

    console.time('ChunkSystem.initialize');

    // Set up console filtering to reduce noise
    this.setupConsoleFiltering();

    // Initialize block type registry (this now only registers block types without loading textures)
    await BlockTypeRegistry.instance.initialize();
    
    // Ensure error texture is loaded
    console.log('Loading essential textures for chunk system...');
    
    // Preload only essential textures
    await BlockTypeRegistry.instance.preload();
    
    // Set view distance options
    this._chunkManager.setViewDistance(this._options.viewDistance);
    this._chunkManager.setViewDistanceEnabled(this._options.viewDistanceEnabled);
    
    this._initialized = true;
    console.log('Chunk system initialized');
    console.timeEnd('ChunkSystem.initialize');
    
    // Start background loading of non-essential textures
    this._startBackgroundTasks();
  }
  
  /**
   * Start background tasks after initialization
   * @private
   */
  async _startBackgroundTasks() {
    // This runs in the background and doesn't block initialization
    setTimeout(async () => {
      try {
        // Additional texture loading or other non-essential tasks can be done here
        console.log('Starting background tasks...');
        
        // Any additional background initialization can be done here
        
        console.log('Background tasks completed');
      } catch (error) {
        console.warn('Error in background tasks:', error);
      }
    }, 1000); // Delay background tasks to prioritize user interaction
  }

  /**
   * Set up console filtering to reduce noise in the console output
   * Call this method once during initialization
   */
  setupConsoleFiltering() {
    // Store the original console methods
    const originalConsoleTime = console.time;
    const originalConsoleTimeEnd = console.timeEnd;
    const originalConsoleLog = console.log;
    
    // Define patterns to filter out
    const timeFilterPatterns = [
      /getTextureUVCoordinateSync/,
      /calculateVertexColor/
    ];
    
    const logFilterPatterns = [
      /buildMeshes-.+-getTextureUVCoordinateSync/,
      /buildMeshes-.+-calculateVertexColor/
    ];
    
    // Override console.time to filter out noisy timers
    console.time = function(label) {
      if (timeFilterPatterns.some(pattern => pattern.test(label))) {
        return; // Skip this timer
      }
      originalConsoleTime.call(console, label);
    };
    
    // Override console.timeEnd to filter out noisy timers
    console.timeEnd = function(label) {
      if (timeFilterPatterns.some(pattern => pattern.test(label))) {
        return; // Skip this timer
      }
      originalConsoleTimeEnd.call(console, label);
    };
    
    // Override console.log to filter out noisy logs
    console.log = function(...args) {
      if (args.length > 0 && typeof args[0] === 'string') {
        if (logFilterPatterns.some(pattern => pattern.test(args[0]))) {
          return; // Skip this log
        }
      }
      originalConsoleLog.apply(console, args);
    };
    
    console.log('Console filtering set up to reduce noise');
  }

  /**
   * Process the render queue
   */
  processRenderQueue() {
    if (!this._initialized) {
      return;
    }
    
    this._chunkManager.processRenderQueue();
  }

  /**
   * Update the chunk system from terrain data
   * @param {Object} terrainData - The terrain data
   */
  updateFromTerrainData(terrainData) {
    if (!this._initialized) {
      return;
    }
    
    const chunks = [];
    const chunkBlocks = new Map();
    
    // Group blocks by chunk
    for (const [posKey, blockId] of Object.entries(terrainData)) {
      const [x, y, z] = posKey.split(',').map(Number);
      const originCoordinate = {
        x: Math.floor(x / CHUNK_SIZE) * CHUNK_SIZE,
        y: Math.floor(y / CHUNK_SIZE) * CHUNK_SIZE,
        z: Math.floor(z / CHUNK_SIZE) * CHUNK_SIZE
      };
      
      const chunkId = `${originCoordinate.x},${originCoordinate.y},${originCoordinate.z}`;
      
      if (!chunkBlocks.has(chunkId)) {
        chunkBlocks.set(chunkId, new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE));
      }
      
      const localX = x - originCoordinate.x;
      const localY = y - originCoordinate.y;
      const localZ = z - originCoordinate.z;
      const index = localX + CHUNK_SIZE * (localY + CHUNK_SIZE * localZ);
      
      chunkBlocks.get(chunkId)[index] = blockId;
    }
    
    // Create chunks from grouped blocks
    for (const [chunkId, blocks] of chunkBlocks.entries()) {
      const [x, y, z] = chunkId.split(',').map(Number);
      chunks.push({
        originCoordinate: { x, y, z },
        blocks
      });
    }
    
    // Update chunks in the chunk manager
    this._chunkManager.updateChunks(chunks);
  }

  /**
   * Update blocks in the chunk system
   * @param {Array} addedBlocks - The blocks to add
   * @param {Array} removedBlocks - The blocks to remove
   */
  updateBlocks(addedBlocks = [], removedBlocks = []) {
    if (!this._initialized || (addedBlocks.length === 0 && removedBlocks.length === 0)) {
      return;
    }
    
    //console.time('ChunkSystem.updateBlocks');
    //console.log(`ChunkSystem.updateBlocks: Processing ${addedBlocks.length} added blocks and ${removedBlocks.length} removed blocks`);
    
    // Group blocks by chunk to minimize chunk updates
    //console.time('ChunkSystem.updateBlocks-grouping');
    const blocksByChunk = new Map();
    
    // Process added blocks
    for (const block of addedBlocks) {
      const globalCoordinate = {
        x: block.position[0],
        y: block.position[1],
        z: block.position[2]
      };
      
      const originCoordinate = {
        x: Math.floor(globalCoordinate.x / CHUNK_SIZE) * CHUNK_SIZE,
        y: Math.floor(globalCoordinate.y / CHUNK_SIZE) * CHUNK_SIZE,
        z: Math.floor(globalCoordinate.z / CHUNK_SIZE) * CHUNK_SIZE
      };
      const chunkId = `${originCoordinate.x},${originCoordinate.y},${originCoordinate.z}`;
      
      if (!blocksByChunk.has(chunkId)) {
        blocksByChunk.set(chunkId, []);
      }
      
      blocksByChunk.get(chunkId).push({
        id: block.id,
        globalCoordinate
      });
    }
    
    // Process removed blocks (set ID to 0 for air)
    for (const block of removedBlocks) {
      const globalCoordinate = {
        x: block.position[0],
        y: block.position[1],
        z: block.position[2]
      };
      
      const originCoordinate = {
        x: Math.floor(globalCoordinate.x / CHUNK_SIZE) * CHUNK_SIZE,
        y: Math.floor(globalCoordinate.y / CHUNK_SIZE) * CHUNK_SIZE,
        z: Math.floor(globalCoordinate.z / CHUNK_SIZE) * CHUNK_SIZE
      };
      const chunkId = `${originCoordinate.x},${originCoordinate.y},${originCoordinate.z}`;
      
      if (!blocksByChunk.has(chunkId)) {
        blocksByChunk.set(chunkId, []);
      }
      
      blocksByChunk.get(chunkId).push({
        id: 0, // Air
        globalCoordinate
      });
    }
    //console.timeEnd('ChunkSystem.updateBlocks-grouping');
    
    // Update blocks in the chunk manager, one chunk at a time
    //console.time('ChunkSystem.updateBlocks-processing');
   // console.log(`ChunkSystem.updateBlocks: Updating ${blocksByChunk.size} chunks`);
    
    for (const [chunkId, blocks] of blocksByChunk.entries()) {
      // Process blocks in batches to avoid overwhelming the system
      const batchSize = 10;
      for (let i = 0; i < blocks.length; i += batchSize) {
        const batch = blocks.slice(i, i + batchSize);
        this._chunkManager.updateBlocks(batch);
      }
    }
    //console.timeEnd('ChunkSystem.updateBlocks-processing');
    
    //console.timeEnd('ChunkSystem.updateBlocks');
  }

  /**
   * Get the block ID at a position
   * @param {Array} position - The position [x, y, z]
   * @returns {number} The block ID
   */
  getBlockId(position) {
    if (!this._initialized) {
      return 0;
    }
    
    return this._chunkManager.getGlobalBlockId({
      x: position[0],
      y: position[1],
      z: position[2]
    });
  }

  /**
   * Check if a block exists at a position
   * @param {Array} position - The position [x, y, z]
   * @returns {boolean} True if a block exists
   */
  hasBlock(position) {
    if (!this._initialized) {
      return false;
    }
    
    return this._chunkManager.hasBlock({
      x: position[0],
      y: position[1],
      z: position[2]
    });
  }

  /**
   * Set the view distance
   * @param {number} distance - The view distance
   */
  setViewDistance(distance) {
    this._options.viewDistance = distance;
    if (this._initialized) {
      this._chunkManager.setViewDistance(distance);
    }
  }

  /**
   * Enable or disable view distance culling
   * @param {boolean} enabled - Whether view distance culling is enabled
   */
  setViewDistanceEnabled(enabled) {
    this._options.viewDistanceEnabled = enabled;
    if (this._initialized) {
      this._chunkManager.setViewDistanceEnabled(enabled);
    }
  }

  /**
   * Clear all chunks from the system
   * This should be called when the map is cleared
   */
  clearChunks() {
    if (!this._initialized) {
      return;
    }
    
    console.log('Clearing all chunks from the chunk system');
    
    // Get all chunks from the chunk manager
    const chunks = this._chunkManager._chunks;
    
    // For each existing chunk, mark it for removal
    for (const [chunkId, chunk] of chunks.entries()) {
      this._chunkManager.updateChunk({
        removed: true,
        originCoordinate: chunk.originCoordinate
      });
    }
    
    // Clear the render queue
    this._chunkManager._renderChunkQueue = [];
    this._chunkManager._pendingRenderChunks = new Set();
    
    console.log('All chunks cleared from the chunk system');
  }

  /**
   * Force an update of chunk visibility
   * @param {boolean} isBulkLoading - Whether we're in a bulk loading operation
   * @returns {Object} Statistics about the visibility update
   */
  forceUpdateChunkVisibility(isBulkLoading = false) {
    if (!this._initialized || !this._chunkManager) {
      console.error("Cannot force update chunk visibility: system not initialized");
      return null;
    }
    
    // Make sure camera is set
    if (!this._scene.camera) {
      console.error("Cannot force update chunk visibility: no camera set");
      return null;
    }
    
    // Ensure up-to-date matrices for the camera
    this._scene.camera.updateMatrixWorld(true);
    this._scene.camera.updateProjectionMatrix();
    
    // Call the ChunkManager's force update method with bulk loading flag
    return this._chunkManager.forceUpdateAllChunkVisibility(isBulkLoading);
  }

  /**
   * Set bulk loading mode to optimize performance during large terrain loads
   * @param {boolean} isLoading - Whether the system is in bulk loading mode
   * @param {number} priorityDistance - Distance within which chunks get immediate meshes
   */
  setBulkLoadingMode(isLoading, priorityDistance) {
    if (!this._initialized || !this._chunkManager) {
      console.error("Cannot set bulk loading mode: system not initialized");
      return;
    }
    
    console.log(`Setting ChunkSystem bulk loading mode to: ${isLoading ? 'ON' : 'OFF'}`);
    this._chunkManager.setBulkLoadingMode(isLoading, priorityDistance);
  }
}

export default ChunkSystem; 