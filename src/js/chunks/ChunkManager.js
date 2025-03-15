// ChunkManager.js
// Manages chunks in the world

import * as THREE from 'three';
import BlockTypeRegistry from '../blocks/BlockTypeRegistry';
import Chunk from './Chunk';
import ChunkMeshManager from './ChunkMeshManager';
import { CHUNKS_NUM_TO_BUILD_AT_ONCE } from './ChunkConstants';

/**
 * Manages chunks in the world
 */
class ChunkManager {
  constructor(scene) {
    this._chunks = new Map();
    this._renderChunkQueue = [];
    this._pendingRenderChunks = new Set();
    this._chunkRemeshOptions = new Map();
    this._scene = scene;
    this._chunkMeshManager = new ChunkMeshManager();
    this._viewDistance = 64;
    this._viewDistanceEnabled = true;
    this._blockTypeCache = new Map();
    this._processingPaused = false;
    this._greedyMeshing = true;
    this._maxConcurrentProcessing = 0;
    this._processingTimeLimit = 0;
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
   * Get the chunk mesh manager
   * @returns {ChunkMeshManager} The chunk mesh manager
   */
  get chunkMeshManager() {
    return this._chunkMeshManager;
  }

  /**
   * Get the block ID at a global coordinate
   * @param {Object} globalCoordinate - The global coordinate
   * @returns {number} The block ID
   */
  getGlobalBlockId(globalCoordinate) {
    const originCoordinate = Chunk.globalCoordinateToOriginCoordinate(globalCoordinate);
    const chunkId = Chunk.getChunkId(originCoordinate);
    const chunk = this._chunks.get(chunkId);

    if (!chunk) {
      return 0; // no chunk, no block, 0 is reserved for air/no-block.
    }

    return chunk.getLocalBlockId(Chunk.globalCoordinateToLocalCoordinate(globalCoordinate));
  }

  /**
   * Get the block type at a global coordinate
   * @param {Object} globalCoordinate - The global coordinate
   * @returns {BlockType|undefined} The block type
   */
  getGlobalBlockType(globalCoordinate) {
    // Create a cache key from the global coordinate
    const cacheKey = `${globalCoordinate.x},${globalCoordinate.y},${globalCoordinate.z}`;
    
    // Check if we have a cached result
    if (this._blockTypeCache.has(cacheKey)) {
      return this._blockTypeCache.get(cacheKey);
    }
    
    const blockId = this.getGlobalBlockId(globalCoordinate);
    const blockType = BlockTypeRegistry.instance.getBlockType(blockId);
    
    // Cache the result
    this._blockTypeCache.set(cacheKey, blockType);
    
    return blockType;
  }

  /**
   * Mark a chunk for remeshing
   * @param {string} chunkId - The chunk ID
   * @param {Object} options - Options for remeshing
   * @param {Array} options.blockCoordinates - The block coordinates to update
   */
  markChunkForRemesh(chunkId, options = {}) {
    // Skip performance timing for this common operation to reduce console noise
    const hasBlockCoords = !!(options.blockCoordinates && options.blockCoordinates.length > 0);
    
    // If this chunk is already in the queue, update its options if needed
    if (this._pendingRenderChunks.has(chunkId)) {
      // Chunk is already in the queue, update options if needed
      if (hasBlockCoords) {
        const existingOptions = this._chunkRemeshOptions.get(chunkId) || {};
        const existingBlocks = existingOptions.blockCoordinates || [];
        
        // Merge block coordinates
        const mergedBlocks = [...existingBlocks];
        for (const block of options.blockCoordinates) {
          // Check if this block is already in the list
          const exists = mergedBlocks.some(b => 
            b.x === block.x && b.y === block.y && b.z === block.z
          );
          
          if (!exists) {
            mergedBlocks.push(block);
          }
        }
        
        this._chunkRemeshOptions.set(chunkId, { 
          ...existingOptions, 
          blockCoordinates: mergedBlocks 
        });
        
        // If this chunk is already in the queue but not at the front,
        // consider moving it forward for faster processing
        const queueIndex = this._renderChunkQueue.indexOf(chunkId);
        if (queueIndex > 5) { // Don't bother if it's already near the front
          // Remove from current position
          this._renderChunkQueue.splice(queueIndex, 1);
          // Add to a position closer to the front, but not the very front
          // to avoid constantly reshuffling priorities
          this._renderChunkQueue.splice(3, 0, chunkId);
        }
      }
      return;
    }
    
    // Add to the queue with options
    if (hasBlockCoords) {
      // If we have specific blocks to update, add to the front of the queue
      // for faster processing, but not the very front to maintain some order
      this._renderChunkQueue.splice(Math.min(3, this._renderChunkQueue.length), 0, chunkId);
    } else {
      // Otherwise, add to the end of the queue
      this._renderChunkQueue.push(chunkId);
    }
    
    this._pendingRenderChunks.add(chunkId);
    this._chunkRemeshOptions.set(chunkId, options);
  }

  /**
   * Check if a block exists at a global coordinate
   * @param {Object} globalCoordinate - The global coordinate
   * @returns {boolean} True if a block exists
   */
  hasBlock(globalCoordinate) {
    return !!this.getGlobalBlockType(globalCoordinate);
  }

  /**
   * Process the render queue
   */
  processRenderQueue() {
    // Skip processing if paused
    if (this._processingPaused) return;
    
    // If there are no chunks to process, return early
    if (this._renderChunkQueue.length === 0) {
      // Even if there are no chunks to process, still enforce view distance
      this.enforceViewDistance();
      return;
    }
    
    // First, identify chunks with first blocks, partial updates, and full rebuilds
    const firstBlockChunks = [];
    const partialUpdateChunks = [];
    const fullRebuildChunks = [];
    
    for (const chunkId of this._renderChunkQueue) {
      const chunk = this._chunks.get(chunkId);
      if (!chunk) {
        continue;
      }
      
      // Check if this is a chunk with only one block (first block placement)
      const blockCount = chunk._blocks.filter(id => id !== 0).length;
      const isFirstBlock = blockCount <= 1;
      
      if (isFirstBlock) {
        // Prioritize chunks with first block placement
        firstBlockChunks.push(chunkId);
      } else {
        const options = this._chunkRemeshOptions ? this._chunkRemeshOptions.get(chunkId) : null;
        if (options && options.blockCoordinates && options.blockCoordinates.length > 0) {
          partialUpdateChunks.push(chunkId);
        } else {
          fullRebuildChunks.push(chunkId);
        }
      }
    }
    
    // Sort the remaining chunks by distance to camera
    if (this._scene.camera) {
      const cameraPos = this._scene.camera.position;
      
      // Sort first block chunks by distance to camera
      firstBlockChunks.sort((chunkIdA, chunkIdB) => {
        const chunkA = this._chunks.get(chunkIdA);
        const chunkB = this._chunks.get(chunkIdB);
        
        if (!chunkA || !chunkB) return 0;
        
        const distA = new THREE.Vector3(
          chunkA.originCoordinate.x, 
          chunkA.originCoordinate.y, 
          chunkA.originCoordinate.z
        ).distanceToSquared(cameraPos);
        
        const distB = new THREE.Vector3(
          chunkB.originCoordinate.x, 
          chunkB.originCoordinate.y, 
          chunkB.originCoordinate.z
        ).distanceToSquared(cameraPos);
        
        return distA - distB;
      });
      
      // Sort partial update chunks by distance to camera
      partialUpdateChunks.sort((chunkIdA, chunkIdB) => {
        const chunkA = this._chunks.get(chunkIdA);
        const chunkB = this._chunks.get(chunkIdB);
        
        if (!chunkA || !chunkB) return 0;
        
        const distA = new THREE.Vector3(
          chunkA.originCoordinate.x, 
          chunkA.originCoordinate.y, 
          chunkA.originCoordinate.z
        ).distanceToSquared(cameraPos);
        
        const distB = new THREE.Vector3(
          chunkB.originCoordinate.x, 
          chunkB.originCoordinate.y, 
          chunkB.originCoordinate.z
        ).distanceToSquared(cameraPos);
        
        return distA - distB;
      });
      
      // Sort full rebuild chunks by distance to camera
      fullRebuildChunks.sort((chunkIdA, chunkIdB) => {
        const chunkA = this._chunks.get(chunkIdA);
        const chunkB = this._chunks.get(chunkIdB);
        
        if (!chunkA || !chunkB) return 0;
        
        const distA = new THREE.Vector3(
          chunkA.originCoordinate.x, 
          chunkA.originCoordinate.y, 
          chunkA.originCoordinate.z
        ).distanceToSquared(cameraPos);
        
        const distB = new THREE.Vector3(
          chunkB.originCoordinate.x, 
          chunkB.originCoordinate.y, 
          chunkB.originCoordinate.z
        ).distanceToSquared(cameraPos);
        
        return distA - distB;
      });
    }
    
    // Combine the sorted queues, with first blocks first, then partial updates, then full rebuilds
    this._renderChunkQueue = [...firstBlockChunks, ...partialUpdateChunks, ...fullRebuildChunks];
    
    // Process a limited number of chunks per frame - INCREASED LIMITS FOR FASTER PROCESSING
    // Always process all first block chunks, then more partial updates than full rebuilds
    const maxFirstBlocks = firstBlockChunks.length; // Process all first blocks
    const maxPartialUpdates = Math.min(partialUpdateChunks.length, CHUNKS_NUM_TO_BUILD_AT_ONCE * 8); // Doubled from 4 to 8
    const maxFullRebuilds = Math.min(
      fullRebuildChunks.length, 
      Math.max(2, CHUNKS_NUM_TO_BUILD_AT_ONCE) // Increased from 1/2 to 2
    );
    
    // Track how many of each type we've processed
    let firstBlocksProcessed = 0;
    let partialUpdatesProcessed = 0;
    let fullRebuildsProcessed = 0;
    
    // Batch process chunks for better performance
    const chunksToProcess = {
      firstBlocks: [],
      partialUpdates: [],
      fullRebuilds: []
    };
    
    // Collect chunks to process
    for (let i = 0; i < this._renderChunkQueue.length; i++) {
      const chunkId = this._renderChunkQueue[i];
      const chunk = this._chunks.get(chunkId);
      if (!chunk) {
        // Remove invalid chunks
        this._renderChunkQueue.splice(i, 1);
        i--;
        continue;
      }
      
      // Check what type of update this is
      const blockCount = chunk._blocks.filter(id => id !== 0).length;
      const isFirstBlock = blockCount <= 1;
      
      const options = this._chunkRemeshOptions ? this._chunkRemeshOptions.get(chunkId) : null;
      const isPartialUpdate = !isFirstBlock && options && options.blockCoordinates && options.blockCoordinates.length > 0;
      
      // Skip if we've reached the limit for this type
      if (isFirstBlock && firstBlocksProcessed >= maxFirstBlocks) {
        continue;
      }
      if (isPartialUpdate && partialUpdatesProcessed >= maxPartialUpdates) {
        continue;
      }
      if (!isFirstBlock && !isPartialUpdate && fullRebuildsProcessed >= maxFullRebuilds) {
        continue;
      }
      
      // Add to appropriate batch
      if (isFirstBlock) {
        chunksToProcess.firstBlocks.push({ chunk, chunkId });
        firstBlocksProcessed++;
      } else if (isPartialUpdate) {
        chunksToProcess.partialUpdates.push({ chunk, chunkId, options });
        partialUpdatesProcessed++;
      } else {
        chunksToProcess.fullRebuilds.push({ chunk, chunkId });
        fullRebuildsProcessed++;
      }
      
      // Remove from queue
      this._renderChunkQueue.splice(i, 1);
      i--; // Adjust index since we removed an item
      
      this._pendingRenderChunks.delete(chunkId);
    }
    
    // Process batches in parallel using Promise.all for better performance
    const processPromises = [];
    
    // Process first blocks
    if (chunksToProcess.firstBlocks.length > 0) {
      const promise = Promise.all(
        chunksToProcess.firstBlocks.map(({ chunk, chunkId }) => {
          return this._renderChunkAsync(chunk)
            .then(() => {
              // Clear options after processing
              if (this._chunkRemeshOptions) {
                this._chunkRemeshOptions.delete(chunkId);
              }
            });
        })
      );
      processPromises.push(promise);
    }
    
    // Process partial updates
    if (chunksToProcess.partialUpdates.length > 0) {
      const promise = Promise.all(
        chunksToProcess.partialUpdates.map(({ chunk, chunkId, options }) => {
          return this._renderChunkAsync(chunk, options)
            .then(() => {
              // Clear options after processing
              if (this._chunkRemeshOptions) {
                this._chunkRemeshOptions.delete(chunkId);
              }
            });
        })
      );
      processPromises.push(promise);
    }
    
    // Process full rebuilds
    if (chunksToProcess.fullRebuilds.length > 0) {
      const promise = Promise.all(
        chunksToProcess.fullRebuilds.map(({ chunk, chunkId }) => {
          return this._renderChunkAsync(chunk)
            .then(() => {
              // Clear options after processing
              if (this._chunkRemeshOptions) {
                this._chunkRemeshOptions.delete(chunkId);
              }
            });
        })
      );
      processPromises.push(promise);
    }
    
    // Update chunk visibility based on camera position and frustum
    if (this._viewDistanceEnabled && this._scene.camera) {
      const camera = this._scene.camera;
      
      // Create frustum for culling
      const frustum = new THREE.Frustum();
      const projScreenMatrix = new THREE.Matrix4();
      projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projScreenMatrix);
      
      // Get camera position
      const cameraPos = camera.position;
      
      // Track how many chunks were hidden
      let hiddenChunks = 0;
      let visibleChunks = 0;
      
      // Enhanced culling: Sort chunks by distance to camera, process nearest first
      const sortedChunks = Array.from(this._chunks.entries())
        .map(([chunkKey, chunk]) => {
          const [cx, cy, cz] = chunkKey.split(',').map(Number);
          const chunkCenter = new THREE.Vector3(
            cx * chunk.chunkSize + chunk.chunkSize / 2,
            cy * chunk.chunkSize + chunk.chunkSize / 2,
            cz * chunk.chunkSize + chunk.chunkSize / 2
          );
          const distance = cameraPos.distanceTo(chunkCenter);
          return { chunkKey, chunk, distance, center: chunkCenter };
        })
        .sort((a, b) => a.distance - b.distance);
      
      // First pass: Handle chunks inside view distance and frustum
      const visibleChunkKeys = new Set();
      
      // Consider chunks within view distance first
      sortedChunks.forEach(({ chunkKey, chunk, distance, center }) => {
        // Skip chunks that don't have meshes yet
        if (!chunk._solidMesh && !chunk._liquidMesh) {
          return;
        }
        
        // If chunk is too far, hide it
        if (distance > this._viewDistance) {
          if (chunk.visible) {
            chunk.visible = false;
            hiddenChunks++;
          }
          return;
        }
        
        // Create bounding box for frustum check
        const bbox = new THREE.Box3().setFromCenterAndSize(
          center,
          new THREE.Vector3(chunk.chunkSize, chunk.chunkSize, chunk.chunkSize)
        );
        
        // Check if in frustum
        const isInFrustum = frustum.intersectsBox(bbox);
        
        // Update visibility for chunks in frustum
        if (isInFrustum) {
          // Use a more aggressive distance-based approach:
          // Further chunks are more likely to be occluded
          let shouldBeVisible = true;
          
          // For chunks beyond a certain distance, perform additional occlusion check
          // (simplified occlusion culling based on line-of-sight)
          if (distance > 16) {
            // Create ray from camera to chunk center
            const direction = new THREE.Vector3().subVectors(center, cameraPos).normalize();
            const ray = new THREE.Ray(cameraPos, direction);
            
            // Check for occlusion by other chunks
            const maxRayLength = distance * 0.9; // Don't check all the way to the chunk
            let currentDist = Math.min(8, distance * 0.2); // Start checking a bit away from camera
            const rayStep = chunk.chunkSize / 2; // Step size
            
            // Simple ray march to check for occlusion
            while (currentDist < maxRayLength) {
              const checkPoint = new THREE.Vector3().copy(ray.origin).addScaledVector(ray.direction, currentDist);
              const pointChunkCoords = {
                x: Math.floor(checkPoint.x / chunk.chunkSize),
                y: Math.floor(checkPoint.y / chunk.chunkSize),
                z: Math.floor(checkPoint.z / chunk.chunkSize)
              };
              const pointChunkKey = `${pointChunkCoords.x},${pointChunkCoords.y},${pointChunkCoords.z}`;
              
              // If we hit another chunk that's closer, check if it's full enough to occlude
              if (pointChunkKey !== chunkKey && this._chunks.has(pointChunkKey)) {
                const occludingChunk = this._chunks.get(pointChunkKey);
                const blockCount = occludingChunk._blocks.filter(id => id !== 0).length;
                const fullness = blockCount / (chunk.chunkSize * chunk.chunkSize * chunk.chunkSize);
                
                // If chunk is more than 60% full, consider it occluding
                if (fullness > 0.6) {
                  shouldBeVisible = false;
                  break;
                }
              }
              
              // Move along ray
              currentDist += rayStep;
            }
          }
          
          // Update chunk visibility
          if (shouldBeVisible) {
            if (!chunk.visible) {
              chunk.visible = true;
            }
            visibleChunkKeys.add(chunkKey);
            visibleChunks++;
          } else {
            if (chunk.visible) {
              chunk.visible = false;
              hiddenChunks++;
            }
          }
        } else {
          // Not in frustum
          if (chunk.visible) {
            chunk.visible = false;
            hiddenChunks++;
          }
        }
      });
      
      // Second pass: Handle chunks outside view distance but adjacent to visible chunks
      this._chunks.forEach((chunk, chunkKey) => {
        if (!visibleChunkKeys.has(chunkKey)) {
          // Skip chunks that are already hidden
          if (!chunk.visible) {
            return;
          }
          
          // Check if the chunk is adjacent to any visible chunk
          if (this.isAdjacentToVisibleChunk(chunkKey, visibleChunkKeys)) {
            if (chunk.visible) {
              chunk.visible = false;
              hiddenChunks++;
            }
          } else {
            if (!chunk.visible) {
              chunk.visible = true;
              visibleChunks++;
            }
          }
        }
      });
    }
    
    // Always enforce view distance at the end to ensure chunks outside view distance are hidden
    this.enforceViewDistance();
  }
  
  /**
   * Render a chunk asynchronously
   * @param {Chunk} chunk - The chunk to render
   * @param {Object} options - Options for rendering
   * @returns {Promise} A promise that resolves when the chunk is rendered
   * @private
   */
  _renderChunkAsync(chunk, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        const hasBlockCoords = !!(options.blockCoordinates && options.blockCoordinates.length > 0);
        const hasExistingMeshes = !!(chunk._solidMesh || chunk._liquidMesh);
        const isFirstBlockInChunk = chunk._blocks.filter(id => id !== 0).length <= 1;
        
        // For the first block in a chunk or if we don't have existing meshes, always do a full rebuild
        if (isFirstBlockInChunk || !hasExistingMeshes || !hasBlockCoords) {
          // Full rebuild
          chunk.buildMeshes(this)
            .then(meshes => {
              if (meshes.solidMesh) {
                this._scene.add(meshes.solidMesh);
              }
              if (meshes.liquidMesh) {
                this._scene.add(meshes.liquidMesh);
              }
              resolve();
            })
            .catch(error => {
              console.error(`Error building meshes for chunk ${chunk.chunkId}:`, error);
              reject(error);
            });
        } else {
          // Use partial mesh update for specific blocks
          chunk.buildPartialMeshes(this, options.blockCoordinates)
            .then(meshes => {
              if (meshes.solidMesh) {
                this._scene.add(meshes.solidMesh);
              }
              if (meshes.liquidMesh) {
                this._scene.add(meshes.liquidMesh);
              }
              resolve();
            })
            .catch(error => {
              console.error(`Error building partial meshes for chunk ${chunk.chunkId}:`, error);
              reject(error);
            });
        }
      } catch (error) {
        console.error(`Error initiating mesh building for chunk ${chunk.chunkId}:`, error);
        reject(error);
      }
    });
  }

  /**
   * Clear the block type cache for a region around a global coordinate
   * @param {Object} globalCoordinate - The global coordinate
   * @param {number} radius - The radius to clear (default: 1)
   */
  clearBlockTypeCache(globalCoordinate, radius = 1) {
    if (!this._blockTypeCache) {
      return;
    }
    
    //console.time('ChunkManager.clearBlockTypeCache');
    
    // Clear cache entries within the radius
    for (let x = -radius; x <= radius; x++) {
      for (let y = -radius; y <= radius; y++) {
        for (let z = -radius; z <= radius; z++) {
          const cacheKey = `${globalCoordinate.x + x},${globalCoordinate.y + y},${globalCoordinate.z + z}`;
          this._blockTypeCache.delete(cacheKey);
        }
      }
    }
    
    //console.timeEnd('ChunkManager.clearBlockTypeCache');
  }

  /**
   * Update a block
   * @param {Object} blockData - The block data
   * @param {number} blockData.id - The block ID
   * @param {Object} blockData.globalCoordinate - The global coordinate
   */
  updateBlock(blockData) {
    const perfId = `updateBlock-${blockData.globalCoordinate.x},${blockData.globalCoordinate.y},${blockData.globalCoordinate.z}`;
    //console.time(perfId);
    
    const { id, globalCoordinate } = blockData;
    const originCoordinate = Chunk.globalCoordinateToOriginCoordinate(globalCoordinate);
    const chunkId = Chunk.getChunkId(originCoordinate);
    const chunk = this._chunks.get(chunkId);

    if (!chunk) {
      //console.timeEnd(perfId);
      return;
    }

    // Clear the block type cache for this region
    this.clearBlockTypeCache(globalCoordinate);

    const localCoordinate = Chunk.globalCoordinateToLocalCoordinate(globalCoordinate);
    chunk.setBlock(localCoordinate, id, this);
    
    //console.timeEnd(perfId);
  }

  /**
   * Update a chunk
   * @param {Object} chunkData - The chunk data
   * @param {boolean} chunkData.removed - Whether the chunk was removed
   * @param {Object} chunkData.originCoordinate - The origin coordinate
   * @param {Uint8Array} chunkData.blocks - The blocks
   */
  updateChunk(chunkData) {
    if (chunkData.removed) {
      const chunk = this._chunks.get(Chunk.getChunkId(chunkData.originCoordinate));

      if (chunk) {
        this._chunkMeshManager.removeLiquidMesh(chunk);
        this._chunkMeshManager.removeSolidMesh(chunk);
        this._chunks.delete(chunk.chunkId);
      }
    }

    if (chunkData.originCoordinate && chunkData.blocks) {
      const chunk = new Chunk(chunkData.originCoordinate, chunkData.blocks);
      this._chunks.set(chunk.chunkId, chunk);
    }
  }

  /**
   * Update multiple blocks
   * @param {Array} blocks - The blocks to update
   */
  updateBlocks(blocks) {
    //console.time(`updateBlocks-${blocks.length}`);
    blocks.forEach(block => this.updateBlock(block));
    //console.timeEnd(`updateBlocks-${blocks.length}`);
  }

  /**
   * Update multiple chunks
   * @param {Array} chunks - The chunks to update
   */
  updateChunks(chunks) {
    chunks.forEach(chunk => this.updateChunk(chunk));

    // Initialize chunks in order of proximity to the camera
    const cameraPos = this._scene.camera ? this._scene.camera.position : new THREE.Vector3();
    const vec1 = new THREE.Vector3();
    const vec2 = new THREE.Vector3();
    
    Array.from(this._chunks.values())
      .sort((chunk1, chunk2) => {
        return vec1.copy(chunk1.originCoordinate).distanceToSquared(cameraPos) - 
               vec2.copy(chunk2.originCoordinate).distanceToSquared(cameraPos);
      })
      .forEach(chunk => {
        const chunkId = Chunk.getChunkId(chunk.originCoordinate);
        if (!this._pendingRenderChunks.has(chunkId)) {
          this._renderChunkQueue.push(chunkId);
          this._pendingRenderChunks.add(chunkId);
        }
      });
  }

  /**
   * Set the view distance
   * @param {number} distance - The view distance
   */
  setViewDistance(distance) {
    this._viewDistance = distance;
  }

  /**
   * Enable or disable view distance culling
   * @param {boolean} enabled - Whether view distance culling is enabled
   */
  setViewDistanceEnabled(enabled) {
    this._viewDistanceEnabled = enabled;
    
    if (!enabled) {
      // Make all chunks visible
      this._chunks.forEach(chunk => {
        chunk.visible = true;
      });
    }
  }

  /**
   * Check if a chunk is adjacent to a visible chunk
   * @param {string} chunkKey - The chunk key
   * @param {Set} verifiedVisibleChunks - The verified visible chunks
   * @returns {boolean} True if the chunk is adjacent to a visible chunk
   */
  isAdjacentToVisibleChunk(chunkKey, verifiedVisibleChunks) {
    const [cx, cy, cz] = chunkKey.split(',').map(Number);
    
    // Check all adjacent chunks
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue; // Skip self
          
          const adjacentKey = `${cx + dx},${cy + dy},${cz + dz}`;
          if (verifiedVisibleChunks.has(adjacentKey)) {
            return true;
          }
        }
      }
    }
    
    return false;
  }

  /**
   * Sets the visibility of a chunk
   * @param {string} chunkKey - The chunk key
   * @param {boolean} visible - Whether the chunk should be visible
   */
  setChunkVisible(chunkKey, visible) {
    const chunk = this._chunks.get(chunkKey);
    if (!chunk) return;
    
    // Set the chunk's visibility
    if (chunk.solidMesh) {
        chunk.solidMesh.visible = visible;
    }
    
    if (chunk.liquidMesh) {
        chunk.liquidMesh.visible = visible;
    }
  }

  /**
   * Gets an array of all loaded chunk keys
   * @returns {string[]} Array of chunk keys
   */
  getLoadedChunkKeys() {
    return Array.from(this._chunks.keys());
  }

  /**
   * Checks if a chunk has any blocks
   * @param {string} chunkKey - The chunk key
   * @returns {boolean} True if the chunk has any blocks
   */
  chunkHasBlocks(chunkKey) {
    const chunk = this._chunks.get(chunkKey);
    if (!chunk) return false;
    
    // Check if the chunk has any non-air blocks
    const blocks = chunk.blocks;
    if (!blocks) return false;
    
    // Check if any block is not air (id > 0)
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i] > 0) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Pauses chunk processing (useful during camera movement)
   */
  pauseProcessing() {
    this._processingPaused = true;
  }

  /**
   * Resumes chunk processing
   */
  resumeProcessing() {
    this._processingPaused = false;
  }

  /**
   * Strictly enforces the view distance by hiding all chunks outside the view distance
   * Using a simpler approach similar to the TypeScript implementation
   */
  enforceViewDistance() {
    if (!this._viewDistanceEnabled || !this._scene.camera) {
      return;
    }

    const camera = this._scene.camera;
    const cameraPos = camera.position;
    
    // Create frustum for culling
    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();
    projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreenMatrix);

    let hiddenChunks = 0;
    let visibleChunks = 0;
    
    // Use a reduced view distance for more aggressive culling
    const reducedViewDistance = this._viewDistance * 0.8; // 80% of normal view distance
    
    // Enhanced culling: Sort chunks by distance to camera, process nearest first
    const sortedChunks = Array.from(this._chunks.entries())
      .map(([chunkKey, chunk]) => {
        const [cx, cy, cz] = chunkKey.split(',').map(Number);
        const chunkCenter = new THREE.Vector3(
          cx * chunk.chunkSize + chunk.chunkSize / 2,
          cy * chunk.chunkSize + chunk.chunkSize / 2,
          cz * chunk.chunkSize + chunk.chunkSize / 2
        );
        const distance = cameraPos.distanceTo(chunkCenter);
        return { chunkKey, chunk, distance, center: chunkCenter };
      })
      .sort((a, b) => a.distance - b.distance);
    
    // Set a hard limit on how many chunks can be visible
    const MAX_VISIBLE_CHUNKS = 150;
    
    // First pass: Hide all chunks
    this._chunks.forEach(chunk => {
      // Use the chunk's visible property setter instead of directly manipulating meshes
      if (chunk.visible) {
        chunk.visible = false;
        hiddenChunks++;
      }
    });
    
    // Second pass: Make the closest chunks visible
    let visibleChunkCount = 0;
    
    for (const { chunkKey, chunk, distance, center } of sortedChunks) {
      // Stop if we've reached the max visible chunks
      if (visibleChunkCount >= MAX_VISIBLE_CHUNKS) {
        break;
      }
      
      // Skip chunks that don't have meshes yet
      if (!chunk._solidMesh && !chunk._liquidMesh) {
        continue;
      }
      
      // Skip chunks that are too far away
      if (distance > reducedViewDistance) {
        continue;
      }
      
      // Create bounding box for frustum check
      const bbox = new THREE.Box3().setFromCenterAndSize(
        center,
        new THREE.Vector3(chunk.chunkSize, chunk.chunkSize, chunk.chunkSize)
      );
      
      // Skip chunks outside the frustum
      if (!frustum.intersectsBox(bbox)) {
        continue;
      }
      
      // Use the chunk's visible property setter to make it visible
      chunk.visible = true;
      visibleChunks++;
      visibleChunkCount++;
    }
    
    console.log(`ChunkSystem.js:128 View distance enforcement: ${visibleChunks} visible, ${hiddenChunks} hidden, max: ${MAX_VISIBLE_CHUNKS}`);
  }

  /**
   * Create mesh for a chunk using the provided blocks data
   * This method is called from TerrainBuilder's createGreedyMeshForChunk
   * @param {Object} chunksBlocks - The blocks data for the chunk
   * @param {Array} blockTypes - Array of block type definitions
   * @returns {Object|null} - The created mesh object or null
   */
  createMeshForChunk(chunksBlocks, blockTypes) {
    if (!chunksBlocks || Object.keys(chunksBlocks).length === 0) {
      console.warn("ChunkManager: No blocks provided for mesh creation");
      return null;
    }
    
    try {
      // Extract first block key to determine chunk coordinates
      const blockKey = Object.keys(chunksBlocks)[0];
      if (!blockKey) return null;
      
      // Parse coordinates
      const [x, y, z] = blockKey.split(',').map(Number);
      if (isNaN(x) || isNaN(y) || isNaN(z)) return null;
      
      // Get chunk coordinates
      const chunkCoords = this._getChunkCoordsByWorldCoords(x, y, z);
      const chunkId = `${chunkCoords.x},${chunkCoords.y},${chunkCoords.z}`;
      
      // Create a temporary chunk for mesh generation
      const tempChunk = new Chunk(
        new THREE.Vector3(chunkCoords.x, chunkCoords.y, chunkCoords.z),
        this._createBlocksFromData(chunksBlocks)
      );
      
      // Create meshes for the chunk using our mesh manager
      const meshes = {};
      
      // Use the ChunkMeshGenerator to create the mesh
      // This is an async operation but we'll make it synchronous for compatibility
      this._chunkMeshManager.createMeshes(tempChunk, this._greedyMeshing)
        .then(result => {
          if (result.solidMesh) {
            meshes['greedy'] = result.solidMesh;
          }
          if (result.liquidMesh) {
            meshes['liquid'] = result.liquidMesh;
          }
        })
        .catch(error => {
          console.error("Error creating mesh:", error);
        });
      
      return meshes;
    } catch (error) {
      console.error("Error in createMeshForChunk:", error);
      return null;
    }
  }
  
  /**
   * Create block array from chunk data
   * @private
   * @param {Object} chunksBlocks - The blocks data
   * @returns {Uint8Array} - The blocks array
   */
  _createBlocksFromData(chunksBlocks) {
    const blocks = new Uint8Array(this._chunkSize * this._chunkSize * this._chunkSize);
    
    // Fill with zeros (empty)
    blocks.fill(0);
    
    // Convert block data to array format
    Object.entries(chunksBlocks).forEach(([posKey, blockId]) => {
      const [x, y, z] = posKey.split(',').map(Number);
      
      // Get local coordinates within the chunk
      const chunkCoords = this._getChunkCoordsByWorldCoords(x, y, z);
      const lx = x - (chunkCoords.x * this._chunkSize);
      const ly = y - (chunkCoords.y * this._chunkSize);
      const lz = z - (chunkCoords.z * this._chunkSize);
      
      // Validate coordinates
      if (lx >= 0 && lx < this._chunkSize && 
          ly >= 0 && ly < this._chunkSize && 
          lz >= 0 && lz < this._chunkSize) {
        // Calculate index in the blocks array
        const index = (ly * this._chunkSize * this._chunkSize) + (lz * this._chunkSize) + lx;
        blocks[index] = blockId;
      }
    });
    
    return blocks;
  }
  
  /**
   * Get chunk coordinates from world coordinates
   * @private
   * @param {number} x - World X coordinate
   * @param {number} y - World Y coordinate
   * @param {number} z - World Z coordinate
   * @returns {Object} - Chunk coordinates {x, y, z}
   */
  _getChunkCoordsByWorldCoords(x, y, z) {
    return {
      x: Math.floor(x / this._chunkSize),
      y: Math.floor(y / this._chunkSize),
      z: Math.floor(z / this._chunkSize)
    };
  }

  /**
   * Set whether to use greedy meshing for chunk generation
   * @param {boolean} enabled - Whether to enable greedy meshing
   */
  setGreedyMeshing(enabled) {
    if (this._greedyMeshing !== enabled) {
      console.log(`ChunkManager: Setting greedy meshing to ${enabled}`);
      this._greedyMeshing = enabled;
      
      // Rebuild all chunks with the new meshing method
      // This is an expensive operation, so we queue it with a small delay
      if (this._chunks.size > 0) {
        console.log(`ChunkManager: Rebuilding ${this._chunks.size} chunks with new meshing method`);
        
        // Use setTimeout to avoid blocking the main thread
        setTimeout(() => {
          // Add all chunks to the render queue
          for (const chunkId of this._chunks.keys()) {
            if (!this._renderChunkQueue.includes(chunkId)) {
              this._renderChunkQueue.push(chunkId);
            }
          }
          
          // Process the queue
          this.processRenderQueue();
        }, 100);
      }
    }
  }

  /**
   * Set the maximum number of chunks to process concurrently
   * @param {number} max - The maximum number of chunks
   */
  setMaxConcurrentProcessing(max) {
    if (max > 0) {
      this._maxConcurrentProcessing = max;
      console.log(`ChunkManager: Set max concurrent processing to ${max}`);
    }
  }
  
  /**
   * Set the time limit for processing chunks per frame
   * @param {number} limit - The time limit in milliseconds
   */
  setProcessingTimeLimit(limit) {
    if (limit > 0) {
      this._processingTimeLimit = limit;
      console.log(`ChunkManager: Set processing time limit to ${limit}ms`);
    }
  }

  /**
   * Forces an update of chunk visibility based on view distance and camera position
   * This is more aggressive than the normal visibility update in processRenderQueue
   */
  forceUpdateChunkVisibility() {
    console.log("ChunkSystem.js:128 Forcing chunk visibility update with view distance:", this._viewDistance);
    
    // Skip if no camera or view distance is disabled
    if (!this._viewDistanceEnabled || !this._scene.camera) {
      return;
    }
    
    const camera = this._scene.camera;
    
    // Create frustum for culling
    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();
    projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreenMatrix);
    
    // Get camera position
    const cameraPos = camera.position;
    
    // Track how many chunks were hidden
    let hiddenChunks = 0;
    let visibleChunks = 0;
    
    // Use a reduced view distance for more aggressive culling
    const reducedViewDistance = this._viewDistance * 0.6; // Only 60% of normal view distance for extreme culling
    
    // Enhanced culling: Sort chunks by distance to camera, process nearest first
    const sortedChunks = Array.from(this._chunks.entries())
      .map(([chunkKey, chunk]) => {
        const [cx, cy, cz] = chunkKey.split(',').map(Number);
        const chunkCenter = new THREE.Vector3(
          cx * chunk.chunkSize + chunk.chunkSize / 2,
          cy * chunk.chunkSize + chunk.chunkSize / 2,
          cz * chunk.chunkSize + chunk.chunkSize / 2
        );
        const distance = cameraPos.distanceTo(chunkCenter);
        return { chunkKey, chunk, distance, center: chunkCenter };
      })
      .sort((a, b) => a.distance - b.distance);
    
    // Set a hard limit on how many chunks can be visible
    const MAX_VISIBLE_CHUNKS = 100; // Even fewer chunks for better performance
    
    // First pass: Hide all chunks
    this._chunks.forEach(chunk => {
      if (chunk.visible) {
        chunk.visible = false;
        hiddenChunks++;
      }
    });
    
    // Second pass: Make the closest chunks visible
    let visibleChunkCount = 0;
    
    for (const { chunkKey, chunk, distance, center } of sortedChunks) {
      // Stop if we've reached the max visible chunks
      if (visibleChunkCount >= MAX_VISIBLE_CHUNKS) {
        break;
      }
      
      // Skip chunks that don't have meshes yet
      if (!chunk._solidMesh && !chunk._liquidMesh) {
        continue;
      }
      
      // Skip chunks that are too far away
      if (distance > reducedViewDistance) {
        continue;
      }
      
      // Create bounding box for frustum check
      const bbox = new THREE.Box3().setFromCenterAndSize(
        center,
        new THREE.Vector3(chunk.chunkSize, chunk.chunkSize, chunk.chunkSize)
      );
      
      // Skip chunks outside the frustum
      if (!frustum.intersectsBox(bbox)) {
        continue;
      }
      
      // Make chunk visible
      chunk.visible = true;
      visibleChunks++;
      visibleChunkCount++;
    }
    
    console.log(`ChunkSystem.js:128 Visibility update complete: ${visibleChunks} visible, ${hiddenChunks} hidden, max visible: ${MAX_VISIBLE_CHUNKS}`);
  }
}

export default ChunkManager; 