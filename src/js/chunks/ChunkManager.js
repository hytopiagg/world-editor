// ChunkManager.js
// Manages chunks in the world

import * as THREE from 'three';
import BlockTypeRegistry from '../blocks/BlockTypeRegistry';
import Chunk from './Chunk';
import ChunkMeshManager from './ChunkMeshManager';
import { CHUNKS_NUM_TO_BUILD_AT_ONCE, CHUNK_INDEX_RANGE } from './ChunkConstants';

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

				// Check if any blocks are on chunk boundaries - if so, prioritize this chunk
				const hasBoundaryBlocks = mergedBlocks.some(block => 
					block.x === 0 || block.y === 0 || block.z === 0 || 
					block.x === CHUNK_INDEX_RANGE || block.y === CHUNK_INDEX_RANGE || block.z === CHUNK_INDEX_RANGE
				);

				// If this chunk is already in the queue but has boundary blocks or is not at the front,
				// consider moving it forward for faster processing
				const queueIndex = this._renderChunkQueue.indexOf(chunkId);
				if (hasBoundaryBlocks && queueIndex > 2) {
					// Remove from current position
					this._renderChunkQueue.splice(queueIndex, 1);
					// Add right to the front for boundary blocks for visual continuity
					this._renderChunkQueue.unshift(chunkId);
				} else if (queueIndex > 5) { 
					// Don't bother if it's already near the front
					// Remove from current position
					this._renderChunkQueue.splice(queueIndex, 1);
					// Add to a position closer to the front, but not the very front
					// to avoid constantly reshuffling priorities
					this._renderChunkQueue.splice(3, 0, chunkId);
				}
			}
			return;
		}
		
		// DEBUGGING: Log when a new chunk is being added to the mesh queue
		const chunk = this._chunks.get(chunkId);
		if (!chunk) {
			console.warn(`DEBUG: markChunkForRemesh called for non-existent chunk ${chunkId}`);
			return; // Don't add non-existent chunks to the queue
		}
		
		// If we're adding a chunk that has no existing mesh, log it
		const hasMesh = chunk.hasMesh();
		if (!hasMesh) {
			console.log(`DEBUG: Adding chunk ${chunkId} to mesh queue - no existing mesh yet`);
		}

		// Add to the queue with options
		if (hasBlockCoords) {
			// Check if any blocks are on chunk boundaries
			const hasBoundaryBlocks = options.blockCoordinates.some(block => 
				block.x === 0 || block.y === 0 || block.z === 0 || 
				block.x === CHUNK_INDEX_RANGE || block.y === CHUNK_INDEX_RANGE || block.z === CHUNK_INDEX_RANGE
			);

			// If we have blocks on chunk boundaries, put at the very front for immediate processing
			// to maintain visual continuity between chunks
			if (hasBoundaryBlocks) {
				this._renderChunkQueue.unshift(chunkId);
			} else {
				// If we have specific blocks to update, add close to the front of the queue
				// But not all the way at the front to avoid pushing back more important chunks
				this._renderChunkQueue.splice(3, 0, chunkId);
			}
		} else {
			// For full chunk remeshing, add to the back of the queue
			this._renderChunkQueue.push(chunkId);
		}

		// Store the options for later when we process the chunk
		if (hasBlockCoords) {
			this._chunkRemeshOptions.set(chunkId, options);
		}

		// Mark this chunk as pending render to avoid duplicates in the queue
		this._pendingRenderChunks.add(chunkId);
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
		// If there are no chunks to process, return early
		if (this._renderChunkQueue.length === 0) {
			return;
		}

		//console.time('processRenderQueue');

		// First, identify chunks with first blocks, partial updates, and full rebuilds
		//console.time('processRenderQueue-sort');
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
		//console.timeEnd('processRenderQueue-sort');

		// Process a limited number of chunks per frame
		// Always process all first block chunks, then more partial updates than full rebuilds
		const maxFirstBlocks = firstBlockChunks.length; // Process all first blocks
		const maxPartialUpdates = Math.min(partialUpdateChunks.length, CHUNKS_NUM_TO_BUILD_AT_ONCE * 4);
		const maxFullRebuilds = Math.min(
			fullRebuildChunks.length,
			Math.max(1, CHUNKS_NUM_TO_BUILD_AT_ONCE / 2)
		);

		// Track how many of each type we've processed
		let firstBlocksProcessed = 0;
		let partialUpdatesProcessed = 0;
		let fullRebuildsProcessed = 0;

		//console.time('processRenderQueue-process');
		// Process chunks up to the maximum allowed
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

			// Process this chunk
			this._renderChunkQueue.splice(i, 1);
			i--; // Adjust index since we removed an item

			this._pendingRenderChunks.delete(chunkId);

			this._renderChunk(chunk);

			// Increment the appropriate counter
			if (isFirstBlock) {
				firstBlocksProcessed++;
			} else if (isPartialUpdate) {
				partialUpdatesProcessed++;
			} else {
				fullRebuildsProcessed++;
			}
		}
		//console.timeEnd('processRenderQueue-process');

		//console.time('processRenderQueue-visibility');
		// Update chunk visibility based on distance from camera
		if (this._viewDistanceEnabled) {
			const cameraPos = this._scene.camera ? this._scene.camera.position : new THREE.Vector3();
			const cameraPos2D = new THREE.Vector2(cameraPos.x, cameraPos.z);

			// Add a timestamp to force regular visibility updates regardless of camera position
			const now = Date.now();
			const shouldLog = false;//now % 5000 < 50; // Only log every ~5 seconds

			if (shouldLog) {
				console.log(`Updating chunk visibility based on view distance: ${this._viewDistance}, camera at ${cameraPos.x.toFixed(1)},${cameraPos.y.toFixed(1)},${cameraPos.z.toFixed(1)}`);
			}

			let visibleCount = 0;
			let hiddenCount = 0;
			let visibilityChangedCount = 0;

			this._chunks.forEach((chunk) => {
				const coord = chunk.originCoordinate;
				// Use 3D distance instead of 2D for more accurate visibility
				const chunkPos = new THREE.Vector3(coord.x, coord.y, coord.z);
				const distance = chunkPos.distanceTo(cameraPos);
				const wasVisible = chunk.visible;

				// Determine if the chunk should be visible based on distance
				chunk.visible = distance <= this._viewDistance;

				if (chunk.visible) {
					visibleCount++;
				} else {
					hiddenCount++;
				}

				// Track chunks with changed visibility
				if (wasVisible !== chunk.visible) {
					visibilityChangedCount++;
					// Log chunks that changed visibility (but throttle to avoid console spam)
					if (shouldLog) {
						console.log(`Chunk ${chunk.chunkId} changed visibility to ${chunk.visible ? 'visible' : 'hidden'}, distance: ${distance.toFixed(1)}`);
					}
				}
			});

			// Force at least one chunk visibility update per second to ensure chunks update even if camera doesn't move
			if (shouldLog || visibilityChangedCount > 0) {
				console.log(`Visibility update: ${visibleCount} chunks visible, ${hiddenCount} chunks hidden, ${visibilityChangedCount} changed visibility (total: ${this._chunks.size})`);
			}
		} else {
			// If view distance culling is disabled, make everything visible
			console.log('View distance culling is disabled, making all chunks visible');
			this._chunks.forEach(chunk => {
				chunk.visible = true;
			});
		}
		//console.timeEnd('processRenderQueue-visibility');

		//console.log(`Processed ${firstBlocksProcessed} first blocks, ${partialUpdatesProcessed} partial updates, and ${fullRebuildsProcessed} full rebuilds. Remaining in queue: ${this._renderChunkQueue.length}`);
		//console.timeEnd('processRenderQueue');
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

		console.log(`Processing ${this._deferredMeshChunks.size} deferred chunks in batches`);

		const cameraPos = this._scene.camera ? this._scene.camera.position : new THREE.Vector3();
		const deferredChunks = Array.from(this._deferredMeshChunks);

		// Sort by distance to camera to process closest chunks first
		deferredChunks.sort((a, b) => {
			const chunkA = this._chunks.get(a);
			const chunkB = this._chunks.get(b);

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

		// Process in smaller batches to avoid freezing
		const BATCH_SIZE = 10;
		let processedCount = 0;

		// Function to process a batch of deferred chunks
		const processBatch = () => {
			const batchChunks = deferredChunks.slice(processedCount, processedCount + BATCH_SIZE);

			// Add these chunks to the render queue
			for (const chunkId of batchChunks) {
				if (this._pendingRenderChunks.has(chunkId)) continue;

				// Add at the end of the queue since these are lower priority than
				// chunks that changed during normal operation
				this._renderChunkQueue.push(chunkId);
				this._pendingRenderChunks.add(chunkId);

				// Remove from deferred set since it's now in the queue
				this._deferredMeshChunks.delete(chunkId);
			}

			processedCount += batchChunks.length;

			// Process next batch after a delay if more chunks remain
			if (processedCount < deferredChunks.length) {
				setTimeout(processBatch, 100); // Delay between batches to avoid freezing
			} else {
				console.log(`ChunkManager: All ${deferredChunks.length} deferred chunks added to render queue.`);
			}
		};

		// Start processing
		processBatch();
	}

	/**
	 * Render a chunk
	 * @param {Chunk} chunk - The chunk to render
	 * @private
	 */
	_renderChunk(chunk) {
		const perfId = `renderChunk-${chunk.chunkId}`;
		//console.time(perfId);

		// Get any specific options for this chunk
		const options = this._chunkRemeshOptions ? this._chunkRemeshOptions.get(chunk.chunkId) || {} : {};
		const hasBlockCoords = !!(options.blockCoordinates && options.blockCoordinates.length > 0);
		const hasExistingMeshes = !!(chunk._solidMesh || chunk._liquidMesh);

		// Check if this is the first block in the chunk
		const isFirstBlockInChunk = chunk._blocks.filter(id => id !== 0).length <= 1;

		// In bulk loading mode, check if this chunk should have mesh creation deferred
		if (this._isBulkLoading && !hasExistingMeshes && !isFirstBlockInChunk && !options.forceMesh) {
			// Need to check distance to camera to decide if we build mesh now or defer
			const cameraPos = this._scene.camera ? this._scene.camera.position : new THREE.Vector3();
			const chunkPos = new THREE.Vector3(
				chunk.originCoordinate.x,
				chunk.originCoordinate.y,
				chunk.originCoordinate.z
			);
			const distance = chunkPos.distanceTo(cameraPos);

			// If chunk is far from camera during bulk loading, defer mesh creation
			if (distance > this._loadingPriorityDistance) {
				// Add to deferred set and skip mesh creation for now
				this._deferredMeshChunks.add(chunk.chunkId);

				// Log this decision occasionally for debugging
				if (Math.random() < 0.01) {  // Log only ~1% of deferrals to avoid spam
					console.log(`Deferred mesh creation for distant chunk ${chunk.chunkId} at distance ${distance.toFixed(1)}`);
				}

				return;  // Skip mesh creation for now
			}
		}

		// Use a try-catch to handle potential errors during mesh building
		try {
			// For the first block in a chunk or if we don't have existing meshes, always do a full rebuild
			// This is faster than partial updates for the first block
			if (isFirstBlockInChunk || !hasExistingMeshes || !hasBlockCoords) {
				// Full rebuild
				//console.time(`${perfId}-buildMeshes`);
				chunk.buildMeshes(this)
					.then(meshes => {
						//console.timeEnd(`${perfId}-buildMeshes`);
						if (meshes.solidMesh) {
							this._scene.add(meshes.solidMesh);
						}

						if (meshes.liquidMesh) {
							this._scene.add(meshes.liquidMesh);
						}

						// Clear options after processing
						if (this._chunkRemeshOptions) {
							this._chunkRemeshOptions.delete(chunk.chunkId);
						}

						//console.timeEnd(perfId);
					})
					.catch(error => {
						//console.error(`Error building meshes for chunk ${chunk.chunkId}:`, error);
						//console.timeEnd(`${perfId}-buildMeshes`);
						//console.timeEnd(perfId);
					});
			} else {
				// Use partial mesh update for specific blocks
				//console.time(`${perfId}-buildPartialMeshes`);
				chunk.buildPartialMeshes(this, options.blockCoordinates)
					.then(meshes => {
						//console.timeEnd(`${perfId}-buildPartialMeshes`);
						if (meshes.solidMesh) {
							this._scene.add(meshes.solidMesh);
						}

						if (meshes.liquidMesh) {
							this._scene.add(meshes.liquidMesh);
						}

						// Clear options after processing
						if (this._chunkRemeshOptions) {
							this._chunkRemeshOptions.delete(chunk.chunkId);
						}

						//console.timeEnd(perfId);
					})
					.catch(error => {
						console.error(`Error building partial meshes for chunk ${chunk.chunkId}:`, error);
						//console.timeEnd(`${perfId}-buildPartialMeshes`);
						//console.timeEnd(perfId);
					});
			}
		} catch (error) {
			console.error(`Error initiating mesh building for chunk ${chunk.chunkId}:`, error);
			//console.timeEnd(perfId);
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

		//  console.time('ChunkManager.clearBlockTypeCache');

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

		if (isBulkLoading) {
			//console.log(`Force updating chunk visibility during BULK LOADING with reduced view distance ${effectiveViewDistance}`);
		} else {
			//console.log(`Force updating chunk visibility with camera at ${cameraPos.x.toFixed(1)},${cameraPos.y.toFixed(1)},${cameraPos.z.toFixed(1)}`);
		}

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

		if (isBulkLoading) {
			//console.log(`Bulk loading visibility update: ${visibleCount} visible, ${hiddenCount} hidden, ${visibilityChangedCount} changed, ${forcedToggleCount} force-toggled`);
		} else {
			//console.log(`Visibility update: ${visibleCount} visible, ${hiddenCount} hidden, ${visibilityChangedCount} changed, ${forcedToggleCount} force-toggled`);
		}

		// Return stats for debugging
		return {
			total: this._chunks.size,
			visible: visibleCount,
			hidden: hiddenCount,
			changed: visibilityChangedCount,
			toggled: forcedToggleCount
		};
	}
}

export default ChunkManager; 