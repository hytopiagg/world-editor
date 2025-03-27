// ChunkManager.js
// Manages chunks in the world

import * as THREE from 'three';
import BlockTypeRegistry from '../blocks/BlockTypeRegistry';
import Chunk from './Chunk';
import ChunkMeshManager from './ChunkMeshManager';
import { CHUNKS_NUM_TO_BUILD_AT_ONCE, CHUNK_INDEX_RANGE, CHUNK_SIZE } from './ChunkConstants';

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
		this._isBulkLoading = false;  // Flag to indicate if we're in a bulk loading operation
		this._deferredMeshChunks = new Set(); // Store chunks that need meshes but are deferred
		this._loadingPriorityDistance = 32; // Chunks within this distance get immediate meshes during loading
		this._lastMeshBuildTime = null; // Added for rate limiting
		this._meshBuildCount = 0;
		this._meshBuildStartTime = null;
		this._chunkLastMeshedTime = null;
		this._chunkLastQueuedTime = null;
		
		// Set up event listener for block type changes
		this._setupBlockTypeChangeListener();
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
		console.time = function (label) {
			if (timeFilterPatterns.some(pattern => pattern.test(label))) {
				return; // Skip this timer
			}
			originalConsoleTime.call(console, label);
		};

		// Override console.timeEnd to filter out noisy timers
		console.timeEnd = function (label) {
			if (timeFilterPatterns.some(pattern => pattern.test(label))) {
				return; // Skip this timer
			}
			originalConsoleTimeEnd.call(console, label);
		};

		// Override console.log to filter out noisy logs
		console.log = function (...args) {
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
			const cachedType = this._blockTypeCache.get(cacheKey);
			// Validate that the cache isn't stale by comparing with actual block ID
			const currentId = this.getGlobalBlockId(globalCoordinate);
			
			// If the ID has changed (most likely due to block removal), 
			// don't use the cached value
			if (cachedType && currentId === 0) {
				console.log(`Cache hit but block was removed at ${cacheKey} - invalidating cache`);
				this._blockTypeCache.delete(cacheKey);
			} else {
				return cachedType;
			}
		}

		const blockId = this.getGlobalBlockId(globalCoordinate);
		const blockType = BlockTypeRegistry.instance.getBlockType(blockId);

		// Cache the result
		this._blockTypeCache.set(cacheKey, blockType);

		return blockType;
	}

	/**
	 * Mark a chunk for remeshing
	 * @param {string} chunkId - The chunk ID to remesh
	 * @param {Object} options - Options for remeshing
	 * @param {Array<Object>} options.blockCoordinates - Specific block coordinates to update
	 * @param {boolean} options.skipNeighbors - Whether to skip neighbor chunk updates
	 */
	markChunkForRemesh(chunkId, options = {}) {
		if (!this._chunks.has(chunkId)) {
			return;
		}
		
		const chunk = this._chunks.get(chunkId);
		
		// Merge options if they already exist
		if (this._chunkRemeshOptions.has(chunkId)) {
			const existingOptions = this._chunkRemeshOptions.get(chunkId);
			
			// Handle block coordinates
			if (options.blockCoordinates && existingOptions.blockCoordinates) {
				const existingCoords = existingOptions.blockCoordinates;
				
				// Add new block coordinates to the existing set
				options.blockCoordinates.forEach(coord => {
					// Check if this coordinate already exists
					const exists = existingCoords.some(existing => 
						existing.x === coord.x && 
						existing.y === coord.y && 
						existing.z === coord.z
					);
					
					if (!exists) {
						existingCoords.push(coord);
					}
				});
			} else if (options.blockCoordinates) {
				existingOptions.blockCoordinates = options.blockCoordinates;
			}
			
			// Handle skipNeighbors option
			if (options.skipNeighbors !== undefined) {
				existingOptions.skipNeighbors = options.skipNeighbors;
			}
		} else {
			// Create new options entry
			this._chunkRemeshOptions.set(chunkId, { ...options });
		}
		
		// Always queue the chunk for render
		this.queueChunkForRender(chunk, { skipNeighbors: options.skipNeighbors });
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
	 * @param {boolean} prioritizeCloseChunks - If true, prioritize chunks closer to the camera
	 */
	processRenderQueue(prioritizeCloseChunks = false) {
		// Skip if there are no chunks to render
		if (this._renderChunkQueue.length === 0) {
			return;
		}

		// Max chunks to build is smaller for camera-prioritized operations to prevent stuttering
		// but larger for bulk loading operations to speed up initial load
		const maxChunksToBuild = prioritizeCloseChunks 
			? Math.min(5, CHUNKS_NUM_TO_BUILD_AT_ONCE) 
			: Math.min(20, CHUNKS_NUM_TO_BUILD_AT_ONCE);
		
		// Log queue status occasionally for debugging
		if (Math.random() < 0.01 || this._renderChunkQueue.length > 100) {
			console.log(`Processing render queue with ${this._renderChunkQueue.length} chunks (max: ${maxChunksToBuild} at once)`);
		}

		// If we want to prioritize by distance, sort the queue by distance to camera
		if (prioritizeCloseChunks && this._scene.camera) {
			const cameraPos = this._scene.camera.position;
			
			// Process queue items to ensure they're all strings (chunk IDs)
			// This is for backward compatibility with any code that might push objects
			this._renderChunkQueue = this._renderChunkQueue.map(item => {
				if (typeof item === 'object' && item !== null && item.chunkId) {
					// If options were included with the chunk, add them to _chunkRemeshOptions
					if (item.options && Object.keys(item.options).length > 0) {
						if (!this._chunkRemeshOptions.has(item.chunkId)) {
							this._chunkRemeshOptions.set(item.chunkId, item.options);
						} else {
							// Merge with existing options
							const existingOptions = this._chunkRemeshOptions.get(item.chunkId);
							this._chunkRemeshOptions.set(item.chunkId, { ...existingOptions, ...item.options });
						}
					}
					return item.chunkId;
				}
				return item;
			});
			
			// Sort the renderChunkQueue by distance to camera
			this._renderChunkQueue.sort((a, b) => {
				const chunkA = this._chunks.get(a);
				const chunkB = this._chunks.get(b);
				
				if (!chunkA || !chunkB) return 0;
				
				const originA = chunkA.originCoordinate;
				const originB = chunkB.originCoordinate;
				
				// Calculate distance from chunk center to camera
				const distA = Math.sqrt(
					Math.pow(originA.x + CHUNK_SIZE/2 - cameraPos.x, 2) + 
					Math.pow(originA.y + CHUNK_SIZE/2 - cameraPos.y, 2) + 
					Math.pow(originA.z + CHUNK_SIZE/2 - cameraPos.z, 2)
				);
				
				const distB = Math.sqrt(
					Math.pow(originB.x + CHUNK_SIZE/2 - cameraPos.x, 2) + 
					Math.pow(originB.y + CHUNK_SIZE/2 - cameraPos.y, 2) + 
					Math.pow(originB.z + CHUNK_SIZE/2 - cameraPos.z, 2)
				);
				
				return distA - distB;
			});
			
			console.log(`Sorted ${this._renderChunkQueue.length} chunks by distance to camera`);
		} else {
			// Normalize queue items to chunk IDs
			this._renderChunkQueue = this._renderChunkQueue.map(item => {
				if (typeof item === 'object' && item !== null && item.chunkId) {
					// Extract chunkId if it's an object
					return item.chunkId;
				}
				return item;
			});
		}

		// Process chunks up to the maximum
		const chunksToProcess = this._renderChunkQueue.splice(0, maxChunksToBuild);
		
		// Remove processed chunks from pending set and call renderChunk with the actual chunk object
		for (const chunkId of chunksToProcess) {
			// Get the actual chunk object
			const chunk = this._chunks.get(chunkId);
			
			// Remove from pending set
			this._pendingRenderChunks.delete(chunkId);
			
			// Process the chunk if it exists
			if (chunk) {
				// Call renderChunk with the chunk object
				this._renderChunk(chunk);
			}
		}
		
		// If there are more chunks to process, schedule another call
		if (this._renderChunkQueue.length > 0) {
			// Schedule next render queue processing
			window.requestAnimationFrame(() => this.processRenderQueue(prioritizeCloseChunks));
		}
	}

	/**
	 * Set bulk loading mode - when true, only meshes chunks close to the camera
	 * @param {boolean} isLoading - Whether we're in bulk loading mode
	 * @param {number} priorityDistance - Priority distance for immediate meshing (optional)
	 */
	setBulkLoadingMode(isLoading, priorityDistance = 32) {
		// Store the previous state to detect changes
		const wasLoading = this._isBulkLoading;

		// Update the state
		this._isBulkLoading = isLoading;
		if (priorityDistance !== undefined) {
			// Ensure we always have a minimum priority distance to prevent blank screens
			this._loadingPriorityDistance = Math.max(16, priorityDistance);
		}

		if (isLoading) {
			console.log(`ChunkManager: Bulk loading mode enabled. Only meshing chunks within ${this._loadingPriorityDistance} blocks of camera.`);

			// If there are no chunks in the queue yet, make sure we have at least some chunks visible
			// by forcing the closest chunks to be meshed immediately
			if (this._chunks.size > 0 && this._renderChunkQueue.length === 0) {
				this._forceClosestChunksVisible();
			}
		} else if (wasLoading && this._deferredMeshChunks.size > 0) {
			console.log(`ChunkManager: Bulk loading complete. Processing ${this._deferredMeshChunks.size} deferred chunk meshes.`);
			// When bulk loading is complete, add all deferred chunks to the render queue
			this._processDeferredChunks();
		}
	}

	/**
	 * Force the closest chunks to be visible immediately
	 * This prevents blank screens during loading
	 * @private
	 */
	_forceClosestChunksVisible() {
		if (!this._scene.camera || this._chunks.size === 0) return;

		console.log("Forcing closest chunks to be visible");
		const cameraPos = this._scene.camera.position;
		const MINIMUM_VISIBLE_CHUNKS = 8; // Always show at least this many chunks

		// Get all chunks sorted by distance to camera
		const sortedChunks = Array.from(this._chunks.values())
			.map(chunk => {
				const pos = new THREE.Vector3(
					chunk.originCoordinate.x,
					chunk.originCoordinate.y,
					chunk.originCoordinate.z
				);
				const distance = pos.distanceTo(cameraPos);
				return { chunk, distance };
			})
			.sort((a, b) => a.distance - b.distance);

		// Force the closest N chunks to be processed immediately
		const chunksToProcess = sortedChunks.slice(0, MINIMUM_VISIBLE_CHUNKS);
		for (const { chunk, distance } of chunksToProcess) {
			console.log(`Forcing mesh for chunk ${chunk.chunkId} at distance ${distance.toFixed(1)}`);

			// Make sure this chunk is in the render queue with high priority
			if (!this._pendingRenderChunks.has(chunk.chunkId)) {
				// Add to front of queue with force option
				this._renderChunkQueue.unshift(chunk.chunkId);
				this._pendingRenderChunks.add(chunk.chunkId);

				// Add special option to force mesh creation
				this._chunkRemeshOptions.set(chunk.chunkId, { forceMesh: true });
			}
		}
	}

	/**
	 * Process chunks that were deferred during bulk loading
	 * @private
	 */
	_processDeferredChunks() {
		if (this._deferredMeshChunks.size === 0) {
			return;
		}

		console.log(`Processing ${this._deferredMeshChunks.size} deferred chunks in larger batches`);

		const cameraPos = this._scene.camera ? this._scene.camera.position : new THREE.Vector3();
		const deferredChunks = Array.from(this._deferredMeshChunks);

		// Sort by distance to camera to process closest chunks first
		deferredChunks.sort((a, b) => {
			const chunkA = this._chunks.get(a);
			const chunkB = this._chunks.get(b);

			if (!chunkA || !chunkB) return 0;

			const distA = new THREE.Vector3(
				chunkA.originCoordinate.x + CHUNK_SIZE/2,
				chunkA.originCoordinate.y + CHUNK_SIZE/2,
				chunkA.originCoordinate.z + CHUNK_SIZE/2
			).distanceToSquared(cameraPos);

			const distB = new THREE.Vector3(
				chunkB.originCoordinate.x + CHUNK_SIZE/2,
				chunkB.originCoordinate.y + CHUNK_SIZE/2,
				chunkB.originCoordinate.z + CHUNK_SIZE/2
			).distanceToSquared(cameraPos);

			return distA - distB;
		});

		// Process in larger batches for quicker loading
		const BATCH_SIZE = 20; // Process 20 chunks at a time
		let processedCount = 0;
		
		// Function to process a batch of deferred chunks
		const processBatch = () => {
			// Skip if no more chunks to process
			if (processedCount >= deferredChunks.length) {
				console.log(`ChunkManager: All ${deferredChunks.length} deferred chunks processed.`);
				return;
			}

			// Process a batch of chunks
			const endIndex = Math.min(processedCount + BATCH_SIZE, deferredChunks.length);
			const batchChunks = deferredChunks.slice(processedCount, endIndex);
			
			console.log(`Processing batch ${Math.floor(processedCount/BATCH_SIZE) + 1}: ${batchChunks.length} chunks (${processedCount+1}-${endIndex} of ${deferredChunks.length})`);
			
			// Add these chunks to the render queue
			for (const chunkId of batchChunks) {
				if (this._pendingRenderChunks.has(chunkId)) continue;

				// Add to the render queue with forced meshing
				this._renderChunkQueue.push(chunkId);
				this._pendingRenderChunks.add(chunkId);
				
				// Add special option to force mesh creation and complete rebuild
				this._chunkRemeshOptions.set(chunkId, { 
					forceMesh: true,
					forceCompleteRebuild: true 
				});

				// Remove from deferred set since it's now in the queue
				this._deferredMeshChunks.delete(chunkId);
			}
			
			// Update processed count
			processedCount = endIndex;

			// Schedule next batch after the current one has a chance to process
			// Use a delay proportional to the batch size - larger batches need more time
			const delay = Math.max(100, batchChunks.length * 5); // 5ms per chunk, minimum 100ms
			setTimeout(processBatch, delay);
		};

		// Start first batch immediately
		processBatch();
	}

	/**
	 * Render a chunk
	 * @param {Chunk} chunk - The chunk to render
	 * @private
	 */
	_renderChunk(chunk) {
		// Add a rate limiter - allow more frequent builds during bulk loading
		if (!this._lastMeshBuildTime) {
			this._lastMeshBuildTime = performance.now();
			this._meshBuildCount = 0;
			this._meshBuildStartTime = performance.now();
		} else {
			const now = performance.now();
			const elapsed = now - this._lastMeshBuildTime;
			
			// Much faster rate during bulk loading - 5ms vs 20ms between builds
			const timeBetweenBuilds = this._renderChunkQueue.length > 10 ? 5 : 20;
			
			if (elapsed < timeBetweenBuilds) {
				// Too soon, try again next frame
				window.requestAnimationFrame(() => this._renderChunk(chunk));
				return;
			}
			
			// Reset the timer and increment the count
			this._lastMeshBuildTime = now;
			this._meshBuildCount++;
			
			// Log progress every 100 chunks
			if (this._meshBuildCount % 100 === 0) {
				const totalElapsed = (now - this._meshBuildStartTime) / 1000;
				const rate = this._meshBuildCount / totalElapsed;
				console.log(`Built ${this._meshBuildCount} chunk meshes at ${rate.toFixed(1)} meshes/sec`);
			}
		}

		const perfId = `renderChunk-${chunk.chunkId}`;
		//console.time(perfId);

		// Get any specific options for this chunk
		const options = this._chunkRemeshOptions ? this._chunkRemeshOptions.get(chunk.chunkId) || {} : {};
		const hasBlockCoords = !!(options.blockCoordinates && options.blockCoordinates.length > 0);
		const hasExistingMeshes = !!(chunk._solidMesh || chunk._liquidMesh);
		const forceCompleteRebuild = !!options.forceCompleteRebuild;

		// Check if this is the first block in the chunk
		const isFirstBlockInChunk = chunk._blocks.filter(id => id !== 0).length <= 1;

		// In bulk loading mode, check if this chunk should have mesh creation deferred
		if (this._isBulkLoading && !options.forceMesh) {
			// Need to check distance to camera to decide if we build mesh now or defer
			const cameraPos = this._scene.camera ? this._scene.camera.position : new THREE.Vector3();
			const chunkPos = new THREE.Vector3(
				chunk.originCoordinate.x + CHUNK_SIZE/2,
				chunk.originCoordinate.y + CHUNK_SIZE/2,
				chunk.originCoordinate.z + CHUNK_SIZE/2
			);
			const distance = chunkPos.distanceTo(cameraPos);

			// If chunk is far from camera during bulk loading, defer mesh creation
			if (distance > this._loadingPriorityDistance) {
				// Add to deferred set and skip mesh creation for now
				this._deferredMeshChunks.add(chunk.chunkId);

				// Only build meshes if chunk is within the priority distance, or if it has existing
				// meshes that need updating, or if it has only one block (is new)
				if (!hasExistingMeshes && !isFirstBlockInChunk) {
					console.log(`Deferred mesh creation for distant chunk ${chunk.chunkId} at distance ${distance.toFixed(1)}`);
					return;  // Skip mesh creation for now
				}
			}
		}

		// Use a try-catch to handle potential errors during mesh building
		try {
			// Force a complete rebuild if specifically requested (for block removal operations)
			// or for first blocks and chunks with no existing meshes
			if (forceCompleteRebuild || isFirstBlockInChunk || !hasExistingMeshes || !hasBlockCoords) {
				
				// Full rebuild
				chunk.buildMeshes(this);
				
				// Check visibility after building mesh
				const shouldBeVisible = this._isChunkVisible(chunk.chunkId);
				chunk.visible = shouldBeVisible;
				
				// Clear options after processing
				if (this._chunkRemeshOptions) {
					this._chunkRemeshOptions.delete(chunk.chunkId);
				}
			} else {
				// Use partial mesh update for specific blocks
				chunk.buildMeshes(this);
				
				// Check visibility after building mesh
				const shouldBeVisible = this._isChunkVisible(chunk.chunkId);
				chunk.visible = shouldBeVisible;
				
				// Clear options after processing
				if (this._chunkRemeshOptions) {
					this._chunkRemeshOptions.delete(chunk.chunkId);
				}
			}
			
			// Update the last meshed time for this chunk for cooldown tracking
			if (!this._chunkLastMeshedTime) {
				this._chunkLastMeshedTime = new Map();
			}
			this._chunkLastMeshedTime.set(chunk.chunkId, performance.now());
			
		} catch (error) {
			console.error(`Error initiating mesh building for chunk ${chunk.chunkId}:`, error);
		}
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

		// Reduce log spam - only log if radius is larger than 1 or if sampling
		const shouldLog = false;//radius > 1 && Math.random() < 0.01; // Only log 1% of clearing operations
		
		
		// For radius 0, just clear this exact coordinate without logging
		if (radius === 0) {
			const exactKey = `${globalCoordinate.x},${globalCoordinate.y},${globalCoordinate.z}`;
			if (this._blockTypeCache.has(exactKey)) {
				this._blockTypeCache.delete(exactKey);
			}
			return;
		}

		// Track number of entries cleared (but only if we're logging)
		let entriesCleared = shouldLog ? 0 : -1;

		// Clear cache entries within the radius
		for (let x = -radius; x <= radius; x++) {
			for (let y = -radius; y <= radius; y++) {
				for (let z = -radius; z <= radius; z++) {
					const cacheKey = `${globalCoordinate.x + x},${globalCoordinate.y + y},${globalCoordinate.z + z}`;
					if (this._blockTypeCache.has(cacheKey)) {
						this._blockTypeCache.delete(cacheKey);
						if (shouldLog) entriesCleared++;
					}
				}
			}
		}

		if (shouldLog && entriesCleared > 0) {
			console.log(`Cleared ${entriesCleared} cache entries around (${globalCoordinate.x},${globalCoordinate.y},${globalCoordinate.z})`);
		}
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

		// Get the current block ID to determine if this is a block removal
		const localCoordinate = Chunk.globalCoordinateToLocalCoordinate(globalCoordinate);
		const currentBlockId = chunk.getLocalBlockId(localCoordinate);
		const isBlockRemoval = currentBlockId !== 0 && id === 0;
		
		// For block removal, use a more targeted approach to cache clearing
		// rather than a large radius that causes excessive updates
		const cacheRadius = isBlockRemoval ? 2 : 1;
		
		// Clear the block type cache for this region with the appropriate radius
		this.clearBlockTypeCache(globalCoordinate, cacheRadius);
		
		// For block removal, clear caches for immediate neighbors only
		if (isBlockRemoval) {
			// Only log once in a while to prevent console spam
		
			// Check for chunk boundaries 
			const isOnChunkBoundaryX = localCoordinate.x === 0 || localCoordinate.x === CHUNK_INDEX_RANGE;
			const isOnChunkBoundaryY = localCoordinate.y === 0 || localCoordinate.y === CHUNK_INDEX_RANGE;
			const isOnChunkBoundaryZ = localCoordinate.z === 0 || localCoordinate.z === CHUNK_INDEX_RANGE;
			
			// Helper to build key to check if edge block is in cache
			const buildKey = (x, y, z) => `${x},${y},${z}`;
			
			// Only clear immediate 6-connected neighbors
			const neighbors = [
				[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
			];
			
			for (const [dx, dy, dz] of neighbors) {
				const neighborX = globalCoordinate.x + dx;
				const neighborY = globalCoordinate.y + dy;
				const neighborZ = globalCoordinate.z + dz;
				
				// Force clear just this neighbor's exact cache entry
				const neighborKey = buildKey(neighborX, neighborY, neighborZ);
				if (this._blockTypeCache.has(neighborKey)) {
					this._blockTypeCache.delete(neighborKey);
				}
			}
			
			// For chunk boundaries, only clear adjacent chunks when necessary
			if (isOnChunkBoundaryX) {
				const adjacentX = globalCoordinate.x + (localCoordinate.x === 0 ? -1 : 1);
				this.clearBlockTypeCache({x: adjacentX, y: globalCoordinate.y, z: globalCoordinate.z}, 1);
			}
			
			if (isOnChunkBoundaryY) {
				const adjacentY = globalCoordinate.y + (localCoordinate.y === 0 ? -1 : 1);
				this.clearBlockTypeCache({x: globalCoordinate.x, y: adjacentY, z: globalCoordinate.z}, 1);
			}
			
			if (isOnChunkBoundaryZ) {
				const adjacentZ = globalCoordinate.z + (localCoordinate.z === 0 ? -1 : 1);
				this.clearBlockTypeCache({x: globalCoordinate.x, y: globalCoordinate.y, z: adjacentZ}, 1);
			}
		}

		// Update the block in the chunk
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

	// Update all chunk visibility directly based on camera position
	// This bypasses the render queue for situations where we need to force an immediate update
	forceUpdateAllChunkVisibility(isBulkLoading = false) {
		if (!this._scene.camera) {
			console.error("Cannot update chunk visibility without camera");
			return;
		}

		const cameraPos = this._scene.camera.position;
		let visibleCount = 0;
		let hiddenCount = 0;
		let visibilityChangedCount = 0;
		let forcedToggleCount = 0;

		// Define a boundary threshold to determine which chunks need forced toggling
		// Only chunks within this distance of the view distance boundary will be force-toggled
		const boundaryThreshold = 8; // Units in world space

		// During bulk loading, we'll use a smaller view distance to optimize performance
		const effectiveViewDistance = isBulkLoading ? Math.min(32, this._viewDistance / 2) : this._viewDistance;


		this._chunks.forEach((chunk) => {
			const coord = chunk.originCoordinate;
			const chunkPos = new THREE.Vector3(coord.x, coord.y, coord.z);
			const distance = chunkPos.distanceTo(cameraPos);
			const wasVisible = chunk.visible;

			// Calculate if chunk should be visible based on distance
			const shouldBeVisible = distance <= effectiveViewDistance;

			// During bulk loading, skip detailed processing for distant chunks
			if (isBulkLoading && distance > effectiveViewDistance * 1.5) {
				// Far chunks are hidden during loading
				chunk.visible = false;
				hiddenCount++;

				if (wasVisible) {
					visibilityChangedCount++;
				}
				return;
			}

			// Check if this chunk is near the visibility boundary
			const distanceFromBoundary = Math.abs(distance - effectiveViewDistance);
			const isNearBoundary = distanceFromBoundary < boundaryThreshold;

			// Only force toggle visibility for chunks near the boundary
			// This significantly reduces unnecessary updates
			if (isNearBoundary || wasVisible !== shouldBeVisible) {
				// Force a visibility toggle to ensure THREE.js registers the change
				if (shouldBeVisible === wasVisible) {
					// Toggle visibility to force THREE.js to register the change
					chunk.visible = !shouldBeVisible;
					forcedToggleCount++;
				}

				// Now set to the correct value
				chunk.visible = shouldBeVisible;
			} else {
				// For chunks far from the boundary, just set visibility directly
				chunk.visible = shouldBeVisible;
			}

			// Count chunk visibility status
			if (shouldBeVisible) {
				visibleCount++;
			} else {
				hiddenCount++;
			}

			// Track visibility changes
			if (wasVisible !== shouldBeVisible) {
				visibilityChangedCount++;
			}
		});

	
		// Return stats for debugging
		return {
			total: this._chunks.size,
			visible: visibleCount,
			hidden: hiddenCount,
			changed: visibilityChangedCount,
			toggled: forcedToggleCount
		};
	}

	/**
	 * Get a chunk by its key string
	 * @param {String} chunkKey - The chunk key in format "x,y,z"
	 * @returns {Chunk|null} The chunk or null if not found
	 */
	getChunkByKey(chunkKey) {
		if (!chunkKey || typeof chunkKey !== 'string') {
			return null;
		}
		
		return this._chunks.get(chunkKey) || null;
	}

	/**
	 * Queue a chunk for rendering
	 * @param {Chunk} chunk - The chunk to queue
	 * @param {Object} options - Options for rendering
	 * @param {Boolean} options.skipNeighbors - If true, skip neighbor chunk updates
	 */
	queueChunkForRender(chunk, options = {}) {
		if (!chunk) {
			return;
		}
		
		// Skip if this chunk is already in the queue
		if (this._pendingRenderChunks.has(chunk.chunkId)) {
		
			// Even if the chunk is already queued, we might need to update its options
			if (options && Object.keys(options).length > 0) {
				const existingOptions = this._chunkRemeshOptions.get(chunk.chunkId) || {};
				this._chunkRemeshOptions.set(chunk.chunkId, { ...existingOptions, ...options });
			}
			return;
		}
		
		// Check if the chunk was recently meshed (implement a simple cooldown mechanism)
		if (!this._chunkLastMeshedTime) {
			this._chunkLastMeshedTime = new Map();
		}
		
		const now = performance.now();
		const lastMeshedTime = this._chunkLastMeshedTime.get(chunk.chunkId) || 0;
		const timeSinceLastMesh = now - lastMeshedTime;
		
		// Shorter cooldown when placing blocks to ensure responsiveness
		// Consider block additions and removals as high priority
		const hasBlockChanges = options.added?.length > 0 || options.removed?.length > 0;
		const isHighPriority = options.forceMesh || options.forceCompleteRebuild || hasBlockChanges;
		
		// Use a much shorter cooldown for block changes to maintain responsiveness
		const minRebuildInterval = hasBlockChanges ? 20 : 100; // Only 20ms cooldown for block changes
		
		if (timeSinceLastMesh < minRebuildInterval && !isHighPriority) {
			// Skip this chunk as it was just rebuilt
			return;
		}
		
		// Store options for this chunk if provided
		if (options && Object.keys(options).length > 0) {
			if (!this._chunkRemeshOptions.has(chunk.chunkId)) {
				this._chunkRemeshOptions.set(chunk.chunkId, options);
			} else {
				// Merge with existing options
				const existingOptions = this._chunkRemeshOptions.get(chunk.chunkId);
				this._chunkRemeshOptions.set(chunk.chunkId, { ...existingOptions, ...options });
			}
		}
		
		// Add to the render queue (just the chunkId, not the full object)
		// For block changes, add to the front of the queue for faster processing
		if (hasBlockChanges) {
			this._renderChunkQueue.unshift(chunk.chunkId);
		} else {
			this._renderChunkQueue.push(chunk.chunkId);
		}
		this._pendingRenderChunks.add(chunk.chunkId);
		
		// Record the time this chunk was queued (we'll update the meshed time when it's actually processed)
		this._chunkLastQueuedTime = this._chunkLastQueuedTime || new Map();
		this._chunkLastQueuedTime.set(chunk.chunkId, now);
	}

	/**
	 * Check if a chunk should be visible based on distance to camera
	 * @param {string} chunkId - The chunk ID
	 * @returns {boolean} True if the chunk should be visible
	 */
	_isChunkVisible(chunkId) {
		const chunk = this._chunks.get(chunkId);
		if (!chunk) return false;
		
		// If no scene or camera, all chunks are visible
		if (!this._scene || !this._scene.camera) return true;
		
		// Get the camera position
		const cameraPos = this._scene.camera.position;
		
		// Calculate the chunk center position
		const chunkCenter = new THREE.Vector3(
			chunk.originCoordinate.x + CHUNK_SIZE/2,
			chunk.originCoordinate.y + CHUNK_SIZE/2,
			chunk.originCoordinate.z + CHUNK_SIZE/2
		);
		
		// Calculate the distance from camera to chunk center
		const distance = chunkCenter.distanceTo(cameraPos);
		
		// Get the view distance, which determines which chunks are visible
		const viewDistance = this._viewDistance;
		
		// If view distance culling is disabled, all chunks are visible
		if (!this._viewDistanceEnabled) return true;
		
		// Chunks are visible if they're within the view distance
		return distance <= viewDistance;
	}

	/**
	 * Set up event listener for block type changes
	 * @private
	 */
	_setupBlockTypeChangeListener() {
		// Listen for block type changes from BlockTypeRegistry
		document.addEventListener('blockTypeChanged', (event) => {
			const blockTypeId = event.detail?.blockTypeId;
			if (blockTypeId) {
				this._handleBlockTypeChanged(blockTypeId);
			}
		});
	}
	
	/**
	 * Handle changes to a block type, forcing updates to chunks that use it
	 * @param {number} blockTypeId - The ID of the block type that changed
	 * @private
	 */
	_handleBlockTypeChanged(blockTypeId) {
		
		// Find all chunks that use this block type
		const chunksToUpdate = new Set();
		
		// Iterate through all chunks
		for (const [chunkKey, chunk] of this._chunks.entries()) {
			// Check if the chunk contains the modified block type
			if (chunk.containsBlockType(blockTypeId)) {
				chunksToUpdate.add(chunkKey);
			}
		}
		
		// If no chunks found with direct check, force update visible chunks
		// This ensures new blocks can be placed with the updated texture
		if (chunksToUpdate.size === 0) {
			
			// Update only visible chunks to avoid unnecessary processing
			for (const [chunkKey, chunk] of this._chunks.entries()) {
				if (this._isChunkVisible(chunkKey)) {
					chunksToUpdate.add(chunkKey);
				}
			}
		}
		
		// Mark all affected chunks for remeshing
		for (const chunkKey of chunksToUpdate) {
			this.markChunkForRemesh(chunkKey, { forceNow: true });
		}
		
		// Process the render queue to apply changes
		this.processRenderQueue(true);
		
	}
}

export default ChunkManager; 