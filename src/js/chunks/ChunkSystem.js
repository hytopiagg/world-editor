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
    
    console.time('ChunkSystem.updateBlocks');
    
    // Organize blocks by chunk
    const chunkMap = new Map();
    
    // Track chunks that need neighbor updates
    const needsNeighborUpdate = new Set();
    
    // First, handle removed blocks
    removedBlocks.forEach(block => {
      const x = block.position[0];
      const y = block.position[1];
      const z = block.position[2];
      
      const originX = Math.floor(x / CHUNK_SIZE) * CHUNK_SIZE;
      const originY = Math.floor(y / CHUNK_SIZE) * CHUNK_SIZE;
      const originZ = Math.floor(z / CHUNK_SIZE) * CHUNK_SIZE;
      
      const chunkId = `${originX},${originY},${originZ}`;
      
      if (!chunkMap.has(chunkId)) {
        chunkMap.set(chunkId, { added: [], removed: [] });
      }
      
      chunkMap.get(chunkId).removed.push({
        position: { x, y, z },
        id: block.id
      });
      
      // Always check neighbors for removed blocks to ensure proper mesh updates
      needsNeighborUpdate.add(chunkId);
    });
    
    // Then, handle added blocks
    addedBlocks.forEach(block => {
      const x = block.position[0];
      const y = block.position[1];
      const z = block.position[2];
      
      const originX = Math.floor(x / CHUNK_SIZE) * CHUNK_SIZE;
      const originY = Math.floor(y / CHUNK_SIZE) * CHUNK_SIZE;
      const originZ = Math.floor(z / CHUNK_SIZE) * CHUNK_SIZE;
      
      const chunkId = `${originX},${originY},${originZ}`;
      
      // Debug: Log info about creating new chunks when placing in empty space
      const chunkExists = this._chunkManager._chunks.has(chunkId);
      if (!chunkExists) {
        console.log(`DEBUG: Creating new chunk for ${chunkId} to place block at ${x},${y},${z}`);
      }
      
      if (!chunkMap.has(chunkId)) {
        chunkMap.set(chunkId, { added: [], removed: [] });
      }
      
      chunkMap.get(chunkId).added.push({
        position: { x, y, z },
        id: block.id
      });
      
      // Check if the block is on chunk boundary for added blocks too
      if (this._isOnChunkBoundary({ x, y, z }, originX, originY, originZ)) {
        needsNeighborUpdate.add(chunkId);
      }
    });
    
    // Update chunks
    for (const [chunkId, { added, removed }] of chunkMap.entries()) {
      const [originX, originY, originZ] = chunkId.split(',').map(Number);
      
      // Get or create the chunk
      let chunk = this._chunkManager._chunks.get(chunkId);
      
      if (!chunk) {
        // Create a new chunk if it doesn't exist
        console.log(`DEBUG: Creating new chunk for ${chunkId}`);
        // Create an empty blocks array for the new chunk
        const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
        
        // Create the chunk
        this._chunkManager.updateChunk({
          originCoordinate: { x: originX, y: originY, z: originZ },
          blocks
        });
        
        // Get the created chunk
        chunk = this._chunkManager._chunks.get(chunkId);
        
        if (!chunk) {
          console.error(`Failed to create chunk for ${chunkId}`);
          continue;
        }
      }
      
      // Update blocks in the chunk
      added.forEach(block => {
        const localX = block.position.x - originX;
        const localY = block.position.y - originY;
        const localZ = block.position.z - originZ;
        
        chunk.setLocalBlockId({
          x: localX,
          y: localY,
          z: localZ
        }, block.id);
      });
      
      removed.forEach(block => {
        const localX = block.position.x - originX;
        const localY = block.position.y - originY;
        const localZ = block.position.z - originZ;
        
        chunk.setLocalBlockId({
          x: localX,
          y: localY,
          z: localZ
        }, 0); // 0 is reserved for air/no-block
      });
      
      // Mark the chunk for remeshing
      this._chunkManager.markChunkForRemesh(chunkId);
      
      // Also mark neighboring chunks for remeshing if needed
      if (needsNeighborUpdate.has(chunkId)) {
        // For removed blocks, we need to update neighboring chunks more aggressively
        const hasRemovedBlocks = removed.length > 0;
        
        // Debug for block removal
        if (hasRemovedBlocks) {
          console.log(`Marking neighbors for remeshing because of block removal in chunk ${chunkId}`);
        }
        
        this._markNeighboringChunks(originX, originY, originZ);
      }
    }
    
    console.timeEnd('ChunkSystem.updateBlocks');
  }
  
  /**
   * Check if a block is on the chunk boundary
   * @param {Object} position - The block position
   * @param {number} originX - The chunk origin X
   * @param {number} originY - The chunk origin Y
   * @param {number} originZ - The chunk origin Z
   * @returns {boolean} Whether the block is on the chunk boundary
   * @private
   */
  _isOnChunkBoundary(position, originX, originY, originZ) {
    const x = position.x;
    const y = position.y;
    const z = position.z;
    
    // For blocks near the chunk boundary (within 1 block distance)
    // This ensures we catch all cases that might affect neighboring chunks
    const boundary = 1; // 1 block buffer
    
    return (
      x <= originX + boundary ||
      x >= originX + CHUNK_SIZE - 1 - boundary ||
      y <= originY + boundary ||
      y >= originY + CHUNK_SIZE - 1 - boundary ||
      z <= originZ + boundary ||
      z >= originZ + CHUNK_SIZE - 1 - boundary
    );
  }
  
  /**
   * Mark neighboring chunks for remeshing
   * @param {number} originX - The chunk origin X
   * @param {number} originY - The chunk origin Y
   * @param {number} originZ - The chunk origin Z
   * @private
   */
  _markNeighboringChunks(originX, originY, originZ) {
    // X axis neighbors
    this._markNeighborIfExists(originX - CHUNK_SIZE, originY, originZ);
    this._markNeighborIfExists(originX + CHUNK_SIZE, originY, originZ);
    
    // Y axis neighbors
    this._markNeighborIfExists(originX, originY - CHUNK_SIZE, originZ);
    this._markNeighborIfExists(originX, originY + CHUNK_SIZE, originZ);
    
    // Z axis neighbors
    this._markNeighborIfExists(originX, originY, originZ - CHUNK_SIZE);
    this._markNeighborIfExists(originX, originY, originZ + CHUNK_SIZE);
  }
  
  /**
   * Mark a neighbor chunk for remeshing if it exists
   * @param {number} x - The chunk origin X
   * @param {number} y - The chunk origin Y
   * @param {number} z - The chunk origin Z
   * @private
   */
  _markNeighborIfExists(x, y, z) {
    const chunkId = `${x},${y},${z}`;
    if (this._chunkManager._chunks.has(chunkId)) {
      this._chunkManager.markChunkForRemesh(chunkId);
    }
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
    const chunks = Array.from(this._chunkManager._chunks.values());
    
    // For each existing chunk, properly remove it
    for (const chunk of chunks) {
      // Remove meshes from the scene
      if (chunk._solidMesh) {
        this._scene.remove(chunk._solidMesh);
        this._chunkManager.chunkMeshManager.removeSolidMesh(chunk);
      }
      
      if (chunk._liquidMesh) {
        this._scene.remove(chunk._liquidMesh);
        this._chunkManager.chunkMeshManager.removeLiquidMesh(chunk);
      }
      
      // Delete the chunk from the manager
      this._chunkManager._chunks.delete(chunk.chunkId);
    }
    
    // Clear all internal collections
    this._chunkManager._renderChunkQueue = [];
    this._chunkManager._pendingRenderChunks.clear();
    this._chunkManager._chunkRemeshOptions.clear();
    this._chunkManager._blockTypeCache.clear();
    this._chunkManager._deferredMeshChunks.clear();
    
    // Force THREE.js to update
    if (this._scene) {
      this._scene.updateMatrixWorld(true);
    }
    
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

  /**
   * Force update specific chunks by key
   * @param {Array<String>} chunkKeys - Array of chunk keys to update
   * @param {Object} options - Options for the update
   * @param {Boolean} options.skipNeighbors - If true, skip neighbor chunk updates
   */
  forceUpdateChunks(chunkKeys, options = {}) {
    if (!this._initialized || !chunkKeys || chunkKeys.length === 0) {
      return;
    }
    
    const skipNeighbors = options.skipNeighbors === true;
    console.log(`ChunkSystem: Forcing update for ${chunkKeys.length} chunks${skipNeighbors ? ' (skipping neighbors)' : ''}`);
    
    // Keep track of chunks we're already updating to avoid duplication
    const updatingChunks = new Set(chunkKeys);
    
    // Directly queue the specified chunks for rendering
    for (const chunkKey of chunkKeys) {
      const chunk = this._chunkManager.getChunkByKey(chunkKey);
      if (chunk) {
        // Add to render queue directly
        this._chunkManager.queueChunkForRender(chunk, { skipNeighbors });
        
        if (!skipNeighbors) {
          // Add neighbor chunks if we're not skipping them
          const neighbors = this._chunkManager.getChunkNeighbors(chunk);
          for (const neighbor of neighbors) {
            if (neighbor && !updatingChunks.has(neighbor.chunkId)) {
              updatingChunks.add(neighbor.chunkId);
              this._chunkManager.queueChunkForRender(neighbor, { skipNeighbors: true });
            }
          }
        }
      }
    }
    
    // Process the render queue immediately to avoid waiting for the next frame
    this.processRenderQueue();
  }

  /**
   * Update the camera position and matrices for visibility culling
   * @param {THREE.Camera} camera - The camera to use for culling
   */
  updateCamera(camera) {
    if (!camera) {
      console.warn("No camera provided for chunk system");
      return;
    }
    
    // Update camera matrices for accurate frustum culling
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    
    // Generate a new frustum object for visibility culling
    const projScreenMatrix = new THREE.Matrix4();
    projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const frustum = new THREE.Frustum();
    frustum.setFromProjectionMatrix(projScreenMatrix);
    
    // Store the camera position and frustum for visibility checks
    this._cameraPosition = camera.position.clone();
    this._frustum = frustum;
    
    // Log camera update occasionally for debugging
    if (Math.random() < 0.01) { 
      console.log(`Updated camera position to ${camera.position.x.toFixed(1)},${camera.position.y.toFixed(1)},${camera.position.z.toFixed(1)}`);
    }
  }

  /**
   * Reset the chunk system - clear all chunks and prepare for new data
   */
  reset() {
    console.log('Resetting chunk system');
    
    // Clear all existing chunks
    this.clearChunks();
    
    // Reset the nonVisibleBlocks storage if it exists
    if (this._nonVisibleBlocks) {
      this._nonVisibleBlocks = {};
    }
    
    // Reset any other state that needs to be cleared
    this._chunkManager._renderChunkQueue = [];
    this._chunkManager._pendingRenderChunks.clear();
    
    console.log('Chunk system reset complete');
  }
}

export default ChunkSystem; 