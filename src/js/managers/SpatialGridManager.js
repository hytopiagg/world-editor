import * as THREE from 'three';
import { CHUNK_SIZE } from '../constants/terrain';
import { getChunkCoords, getLocalCoords, getLocalKey } from '../utils/terrain/chunkUtils';

/**
 * SpatialHashGrid is responsible for efficiently organizing and accessing blocks in 3D space
 * It divides space into chunks and provides methods for adding, removing, and querying blocks
 */
class SpatialHashGrid {
	constructor() {
		this.grid = new Map(); // Map(chunkKey => Map(localKey => blockId))
		this.chunkCoordCache = new Map(); // Cache for chunk coordinates
		this.chunkSize = CHUNK_SIZE;
		this.size = 0; // Total number of blocks
	}
	
	/**
	 * Get chunk coordinates for a position
	 * @param {number} x - World X coordinate
	 * @param {number} y - World Y coordinate
	 * @param {number} z - World Z coordinate
	 * @returns {Object} - Chunk coordinates
	 */
	getChunkCoords(x, y, z) {
		// Use imported utility function instead of implementing here
		return getChunkCoords(x, y, z);
	}
	
	/**
	 * Get local coordinates within a chunk
	 * @param {number} x - World X coordinate
	 * @param {number} y - World Y coordinate
	 * @param {number} z - World Z coordinate
	 * @returns {Object} - Local coordinates
	 */
	getLocalCoords(x, y, z) {
		// Use imported utility function instead of implementing here
		return getLocalCoords(x, y, z);
	}
	
	/**
	 * Get local key from local coordinates
	 * @param {number} lx - Local X coordinate
	 * @param {number} ly - Local Y coordinate
	 * @param {number} lz - Local Z coordinate
	 * @returns {string} - Local key
	 */
	getLocalKey(lx, ly, lz) {
		// Use imported utility function instead of implementing here
		return getLocalKey(lx, ly, lz);
	}
	
	/**
	 * Set a block in the spatial hash grid
	 * Optimized for bulk operations
	 * @param {string} key - Position key in format "x,y,z"
	 * @param {number} blockId - Block ID to set
	 */
	set(key, blockId) {
		// Skip if key is invalid
		if (!key || typeof key !== 'string') return;
		
		// Parse coordinates from key
		const [x, y, z] = key.split(',').map(Number);
		
		// Skip if coordinates are invalid
		if (isNaN(x) || isNaN(y) || isNaN(z)) return;
		
		// Get chunk coordinates - use cached value if available
		let chunkKey = this.chunkCoordCache.get(key);
		let chunkCoords;
		
		if (!chunkKey) {
			chunkCoords = this.getChunkCoords(x, y, z);
			chunkKey = `${chunkCoords.cx},${chunkCoords.cy},${chunkCoords.cz}`;
			
			// Cache the chunk key for this position to avoid recalculating
			this.chunkCoordCache.set(key, chunkKey);
		}
		
		// Get or create chunk
		let chunk = this.grid.get(chunkKey);
		if (!chunk) {
			chunk = new Map();
			this.grid.set(chunkKey, chunk);
		}
		
		// Get local coordinates
		const localCoords = this.getLocalCoords(x, y, z);
		const localKey = this.getLocalKey(localCoords.lx, localCoords.ly, localCoords.lz);
		
		// Set block in chunk
		const hadBlock = chunk.has(localKey);
		chunk.set(localKey, blockId);
		
		// Update size if this is a new block
		if (!hadBlock) {
			this.size++;
		}
	}
	
	/**
	 * Get a block from the spatial hash grid
	 * @param {string} key - Position key in format "x,y,z"
	 * @returns {number|null} - Block ID or null if not found
	 */
	get(key) {
		// Skip if key is invalid
		if (!key || typeof key !== 'string') return null;
		
		// Parse coordinates from key
		const [x, y, z] = key.split(',').map(Number);
		
		// Skip if coordinates are invalid
		if (isNaN(x) || isNaN(y) || isNaN(z)) return null;
		
		// Get chunk coordinates - use cached value if available
		let chunkKey = this.chunkCoordCache.get(key);
		
		if (!chunkKey) {
			const chunkCoords = this.getChunkCoords(x, y, z);
			chunkKey = `${chunkCoords.cx},${chunkCoords.cy},${chunkCoords.cz}`;
		}
		
		// Get chunk
		const chunk = this.grid.get(chunkKey);
		if (!chunk) return null;
		
		// Get local coordinates
		const localCoords = this.getLocalCoords(x, y, z);
		const localKey = this.getLocalKey(localCoords.lx, localCoords.ly, localCoords.lz);
		
		// Get block from chunk
		return chunk.get(localKey) || null;
	}
	
	/**
	 * Check if a block exists in the spatial hash grid
	 * @param {string} key - Position key in format "x,y,z"
	 * @returns {boolean} - True if block exists
	 */
	has(key) {
		// Skip if key is invalid
		if (!key || typeof key !== 'string') return false;
		
		// Parse coordinates from key
		const [x, y, z] = key.split(',').map(Number);
		
		// Skip if coordinates are invalid
		if (isNaN(x) || isNaN(y) || isNaN(z)) return false;
		
		// Get chunk coordinates - use cached value if available
		let chunkKey = this.chunkCoordCache.get(key);
		
		if (!chunkKey) {
			const chunkCoords = this.getChunkCoords(x, y, z);
			chunkKey = `${chunkCoords.cx},${chunkCoords.cy},${chunkCoords.cz}`;
		}
		
		// Get chunk
		const chunk = this.grid.get(chunkKey);
		if (!chunk) return false;
		
		// Get local coordinates
		const localCoords = this.getLocalCoords(x, y, z);
		const localKey = this.getLocalKey(localCoords.lx, localCoords.ly, localCoords.lz);
		
		// Check if block exists in chunk
		return chunk.has(localKey);
	}
	
	/**
	 * Delete a block from the spatial hash grid
	 * @param {string} key - Position key in format "x,y,z"
	 * @returns {boolean} - True if block was deleted
	 */
	delete(key) {
		// Skip if key is invalid
		if (!key || typeof key !== 'string') return false;
		
		// Parse coordinates from key
		const [x, y, z] = key.split(',').map(Number);
		
		// Skip if coordinates are invalid
		if (isNaN(x) || isNaN(y) || isNaN(z)) return false;
		
		// Get chunk coordinates - use cached value if available
		let chunkKey = this.chunkCoordCache.get(key);
		
		if (!chunkKey) {
			const chunkCoords = this.getChunkCoords(x, y, z);
			chunkKey = `${chunkCoords.cx},${chunkCoords.cy},${chunkCoords.cz}`;
		}
		
		// Get chunk
		const chunk = this.grid.get(chunkKey);
		if (!chunk) return false;
		
		// Get local coordinates
		const localCoords = this.getLocalCoords(x, y, z);
		const localKey = this.getLocalKey(localCoords.lx, localCoords.ly, localCoords.lz);
		
		// Delete block from chunk
		const deleted = chunk.delete(localKey);
		
		// Update size if block was deleted
		if (deleted) {
			this.size--;
			
			// Remove chunk if empty
			if (chunk.size === 0) {
				this.grid.delete(chunkKey);
			}
			
			// Remove from cache
			this.chunkCoordCache.delete(key);
		}
		
		return deleted;
	}
	
	/**
	 * Clear the spatial hash grid
	 */
	clear() {
		this.grid.clear();
		this.chunkCoordCache.clear();
		this.size = 0;
	}
	
	/**
	 * Get all blocks in the spatial hash grid
	 * @returns {Object} - Object with position keys and block IDs
	 */
	getBlocks() {
		const blocks = {};
		
		// Iterate through all chunks
		for (const [chunkKey, chunk] of this.grid.entries()) {
			// Parse chunk coordinates
			const [cx, cy, cz] = chunkKey.split(',').map(Number);
			
			// Iterate through all blocks in chunk
			for (const [localKey, blockId] of chunk.entries()) {
				// Parse local coordinates
				const [lx, ly, lz] = localKey.split(',').map(Number);
				
				// Calculate world coordinates
				const x = cx * this.chunkSize + lx;
				const y = cy * this.chunkSize + ly;
				const z = cz * this.chunkSize + lz;
				
				// Add block to result
				const worldKey = `${x},${y},${z}`;
				blocks[worldKey] = blockId;
			}
		}
		
		return blocks;
	}
	
	/**
	 * Get all blocks in a specific chunk
	 * @param {number} cx - Chunk X coordinate
	 * @param {number} cy - Chunk Y coordinate
	 * @param {number} cz - Chunk Z coordinate
	 * @returns {Object} - Object with position keys and block IDs
	 */
	getChunkBlocks(cx, cy, cz) {
		const blocks = {};
		const chunkKey = `${cx},${cy},${cz}`;
		
		// Get chunk
		const chunk = this.grid.get(chunkKey);
		if (!chunk) return blocks;
		
		// Iterate through all blocks in chunk
		for (const [localKey, blockId] of chunk.entries()) {
			// Parse local coordinates
			const [lx, ly, lz] = localKey.split(',').map(Number);
			
			// Calculate world coordinates
			const x = cx * this.chunkSize + lx;
			const y = cy * this.chunkSize + ly;
			const z = cz * this.chunkSize + lz;
			
			// Add block to result
			const worldKey = `${x},${y},${z}`;
			blocks[worldKey] = blockId;
		}
		
		return blocks;
	}
}

/**
 * SpatialGridManager provides a higher-level interface for managing the spatial hash grid
 * It handles batched updates, optimized raycasting, and other operations
 */
class SpatialGridManager {
	constructor(loadingManager) {
		this.spatialHashGrid = new SpatialHashGrid();
		this.loadingManager = loadingManager;
		this.isProcessing = false; // Flag to track if processing is happening
		this.lastFrustumUpdate = 0;
		this.chunksInFrustum = new Set(); // Set of chunk keys in frustum
	}
	
	/**
	 * Get chunks that are visible within the camera frustum
	 * @param {THREE.Camera} camera - The camera to use
	 * @param {number} maxDistance - Maximum distance to check (defaults to view distance)
	 * @returns {Set<string>} - Set of chunk keys in the frustum
	 */
	getChunksInFrustum(camera, maxDistance = 64) {
		if (!camera) {
			console.warn("No camera provided for getChunksInFrustum");
			return new Set();
		}
		
		const start = performance.now();
		
		// Create frustum from camera
		const frustum = new THREE.Frustum();
		const projScreenMatrix = new THREE.Matrix4();
		
		// Update the projection matrix
		projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		frustum.setFromProjectionMatrix(projScreenMatrix);
		
		// Get camera position
		const cameraPosition = camera.position.clone();
		
		// Store chunks in frustum
		const chunksInFrustum = new Set();
		
		// Get camera chunk coordinates
		const cameraChunkX = Math.floor(cameraPosition.x / CHUNK_SIZE);
		const cameraChunkY = Math.floor(cameraPosition.y / CHUNK_SIZE);
		const cameraChunkZ = Math.floor(cameraPosition.z / CHUNK_SIZE);
		
		// Add the chunk containing the camera
		chunksInFrustum.add(`${cameraChunkX},${cameraChunkY},${cameraChunkZ}`);
		
		// Use a more efficient approach - only check chunks that actually have content
		// Get all chunks that have blocks in them, as they're the only ones we need to consider
		const allChunksWithBlocks = Array.from(this.spatialHashGrid.grid.keys());
		
		// If the grid is empty or very small, use the standard approach
		if (allChunksWithBlocks.length < 10) {
			// Calculate maximum chunks to check based on maxDistance
			const maxChunks = Math.ceil(maxDistance / CHUNK_SIZE);
			
			// Check chunks around the camera in progressively larger shells
			for (let shell = 0; shell <= 2; shell++) {
				// Start with the camera chunk, then nearby chunks, then more distant chunks
				const shellSize = shell * Math.ceil(maxChunks/3);
				
				// Check a subset of chunks in this shell (more aggressively cull distant chunks)
				for (let dx = -shellSize; dx <= shellSize; dx += shell === 0 ? 1 : 2) {
					for (let dy = -shellSize; dy <= shellSize; dy += shell === 0 ? 1 : 2) {
						for (let dz = -shellSize; dz <= shellSize; dz += shell === 0 ? 1 : 2) {
							// Skip the inner shells which we've already checked
							if (shell > 0 && 
								Math.abs(dx) < shellSize && 
								Math.abs(dy) < shellSize && 
								Math.abs(dz) < shellSize) {
								continue;
							}
							
							// Calculate chunk coordinates
							const cx = cameraChunkX + dx;
							const cy = cameraChunkY + dy;
							const cz = cameraChunkZ + dz;
							
							// Calculate chunk center for distance check
							const chunkCenter = new THREE.Vector3(
								cx * CHUNK_SIZE + CHUNK_SIZE / 2,
								cy * CHUNK_SIZE + CHUNK_SIZE / 2,
								cz * CHUNK_SIZE + CHUNK_SIZE / 2
							);
							
							// First, check distance to camera (faster than frustum test)
							const distance = chunkCenter.distanceTo(cameraPosition);
							
							// Skip if too far
							if (distance > maxDistance) {
								continue;
							}
							
							// For nearby chunks, always include them
							if (distance < CHUNK_SIZE * 2) {
								chunksInFrustum.add(`${cx},${cy},${cz}`);
								continue;
							}
							
							// For more distant chunks, check frustum containment
							if (frustum.containsPoint(chunkCenter)) {
								chunksInFrustum.add(`${cx},${cy},${cz}`);
							}
						}
					}
				}
			}
		} else {
			// For larger worlds, only consider chunks that actually have content
			for (const chunkKey of allChunksWithBlocks) {
				// Parse chunk coordinates
				const [cx, cy, cz] = chunkKey.split(',').map(Number);
				
				// Calculate chunk center
				const chunkCenter = new THREE.Vector3(
					cx * CHUNK_SIZE + CHUNK_SIZE / 2,
					cy * CHUNK_SIZE + CHUNK_SIZE / 2,
					cz * CHUNK_SIZE + CHUNK_SIZE / 2
				);
				
				// First, check distance to camera (faster than frustum test)
				const distance = chunkCenter.distanceTo(cameraPosition);
				
				// Skip if too far
				if (distance > maxDistance) {
					continue;
				}
				
				// For nearby chunks, always include them
				if (distance < CHUNK_SIZE * 2) {
					chunksInFrustum.add(chunkKey);
					continue;
				}
				
				// For more distant chunks, check frustum containment
				if (frustum.containsPoint(chunkCenter)) {
					chunksInFrustum.add(chunkKey);
				}
			}
		}
		
		// Performance logging
		const end = performance.now();
		const duration = end - start;
		if (duration > 5) {
			console.log(`Frustum check took ${duration.toFixed(2)}ms for ${chunksInFrustum.size} chunks`);
		}
		
		return chunksInFrustum;
	}
	
	/**
	 * Update the frustum cache - should be called regularly when camera moves
	 * @param {THREE.Camera} camera - The camera to use
	 * @param {number} maxDistance - Maximum distance to check
	 */
	updateFrustumCache(camera, maxDistance = 64) {
		const now = performance.now();
		
		// Only update after 100ms to avoid excessive updates
		if (now - this.lastFrustumUpdate < 100) {
			return;
		}
		
		this.lastFrustumUpdate = now;
		this.chunksInFrustum = this.getChunksInFrustum(camera, maxDistance);
	}
	
	/**
	 * Update blocks within the camera frustum only
	 * @param {Object} terrainBlocks - Object containing all blocks in the terrain
	 * @param {THREE.Camera} camera - The camera to use
	 * @param {Object} options - Options for updating
	 */
	updateInFrustum(terrainBlocks, camera, options = {}) {
		if (!camera) {
			console.warn("No camera provided for updateInFrustum");
			return Promise.resolve();
		}
		
		if (!terrainBlocks || typeof terrainBlocks !== 'object') {
			console.warn("Invalid terrain blocks provided for updateInFrustum");
			return Promise.resolve();
		}
		
		const start = performance.now();
		
		// Set processing flag to prevent overlapping calls
		this.isProcessing = true;
		
		try {
			// Update the frustum cache
			this.updateFrustumCache(camera, options.maxDistance || 64);
			
			// If no chunks in frustum, skip update
			if (this.chunksInFrustum.size === 0) {
				this.isProcessing = false;
				return Promise.resolve();
			}
			
			// Filter blocks to only those in frustum
			const frustumBlocks = {};
			let blockCount = 0;
			let skipCount = 0;
			
			// Use chunksInFrustum for fast lookups
			const chunksInFrustumSet = this.chunksInFrustum;
			
			// For small worlds, process everything
			if (Object.keys(terrainBlocks).length < 5000) {
				// Process all blocks as we don't have too many
				for (const [posKey, blockId] of Object.entries(terrainBlocks)) {
					// Add all blocks to the frustum blocks object
					frustumBlocks[posKey] = blockId;
					blockCount++;
				}
			} else {
				// For larger worlds, filter by frustum
				for (const [posKey, blockId] of Object.entries(terrainBlocks)) {
					const [x, y, z] = posKey.split(',').map(Number);
					
					// Calculate which chunk this block is in
					const chunkX = Math.floor(x / CHUNK_SIZE);
					const chunkY = Math.floor(y / CHUNK_SIZE);
					const chunkZ = Math.floor(z / CHUNK_SIZE);
					const chunkKey = `${chunkX},${chunkY},${chunkZ}`;
					
					// If this chunk is in frustum, include the block
					if (chunksInFrustumSet.has(chunkKey)) {
						frustumBlocks[posKey] = blockId;
						blockCount++;
					} else {
						skipCount++;
					}
				}
			}
			
			const filterTime = performance.now() - start;
			
			// Log information about the filtering
			if (blockCount > 0 && !options.silent) {
				console.log(`Filtered ${blockCount} blocks in frustum (${skipCount} skipped) in ${filterTime.toFixed(2)}ms`);
			}
			
			// Only proceed with update if we have blocks to update
			if (blockCount === 0) {
				this.isProcessing = false;
				return Promise.resolve();
			}
			
			// Store current context for promise callback
			const self = this;
			
			// Update only blocks in frustum
			return this.updateFromTerrain(frustumBlocks, options)
				.then(() => {
					const totalTime = performance.now() - start;
					if (totalTime > 50 && !options.silent) {
						console.log(`Total frustum update took ${totalTime.toFixed(2)}ms for ${blockCount} blocks`);
					}
				})
				.catch(error => {
					console.error("Error in updateInFrustum:", error);
				})
				.finally(() => {
					// Clear processing flag after completion
					self.isProcessing = false;
				});
		} catch (error) {
			console.error("Exception in updateInFrustum:", error);
			this.isProcessing = false;
			return Promise.resolve();
		}
	}
	
	/**
	 * Update the spatial hash grid with all blocks from the terrain
	 * @param {Object} terrainBlocks - Object containing all blocks in the terrain
	 * @param {Object} options - Options for updating
	 * @param {boolean} options.showLoadingScreen - Whether to show a loading screen
	 * @param {number} options.batchSize - Number of blocks to process in each batch
	 */
	updateFromTerrain(terrainBlocks, options = {}) {
		// Set processing flag
		this.isProcessing = true;
		
		// Validate input
		if (!terrainBlocks || typeof terrainBlocks !== 'object') {
			console.warn("Invalid terrain blocks provided to updateFromTerrain");
			this.isProcessing = false;
			return Promise.resolve();
		}
		
		const blockEntries = Object.entries(terrainBlocks);
		const totalBlocks = blockEntries.length;
		
		// If no blocks, just resolve immediately
		if (totalBlocks === 0) {
			this.isProcessing = false;
			return Promise.resolve();
		}
		
		let processedBlocks = 0;
		const BATCH_SIZE = options.batchSize || 50000;
		const totalBatches = Math.ceil(totalBlocks / BATCH_SIZE);
		let currentBatch = 0;
		
		// Check if we need to show a loading screen
		const showLoadingScreen = options.showLoadingScreen === true;
		const silent = options.silent === true;
		
		// Skip this update if skipIfBusy is set and we're already processing
		if (options.skipIfBusy && this.spatialHashGrid.isProcessing) {
			if (!silent) {
				console.log("Skipping spatial hash update because grid is busy");
			}
			this.isProcessing = false;
			return Promise.resolve();
		}
		
		// Clear the grid before updating
		this.spatialHashGrid.clear();
		
		// Show loading screen if requested
		if (showLoadingScreen && this.loadingManager) {
			try {
				this.loadingManager.showLoading(options.message || 'Updating spatial hash grid...');
			} catch (error) {
				console.error("Error showing loading screen:", error);
			}
		}
		
		// Store a reference to self for promise chain
		const self = this;
		
		return new Promise((resolve) => {
			// Function to process a batch of blocks
			const processBatch = (startIndex) => {
				currentBatch++;
				const endIndex = Math.min(startIndex + BATCH_SIZE, totalBlocks);
				
				// Update the loading status if showing loading screen
				if (showLoadingScreen && this.loadingManager) {
					try {
						// For the last batch, always set progress to 100%
						const progress = (currentBatch === totalBatches) 
							? 100
							: Math.floor((currentBatch / totalBatches) * 100);
						this.loadingManager.updateLoading(`Updating spatial hash: batch ${currentBatch}/${totalBatches} (${progress}%)`, progress);
					} catch (error) {
						console.error("Error updating loading screen:", error);
					}
				}
				
				// Process blocks in this batch
				for (let i = startIndex; i < endIndex; i++) {
					const [posKey, blockId] = blockEntries[i];
					this.spatialHashGrid.set(posKey, blockId);
				}
				
				// Update processed count
				processedBlocks = endIndex;
				
				// If there are more blocks to process, schedule the next batch
				if (processedBlocks < totalBlocks) {
					// Use requestIdleCallback if available, otherwise setTimeout
					if (window.requestIdleCallback) {
						window.requestIdleCallback(() => {
							processBatch(processedBlocks);
						}, { timeout: 100 });
					} else {
						setTimeout(() => {
							processBatch(processedBlocks);
						}, 0);
					}
				} else {
					// All blocks processed
					if (!silent) {
						console.log(`Spatial hash fully updated with ${this.spatialHashGrid.size} blocks`);
					}
					
					// Hide loading screen if shown
					if (showLoadingScreen && this.loadingManager) {
						try {
							// Set progress to 100% before hiding the loading screen
							this.loadingManager.updateLoading(`Spatial hash update complete (100%)`, 100);
							// Wait a brief moment to ensure the update is visible
							setTimeout(() => {
								this.loadingManager.hideLoading();
								// Clear processing flag
								self.isProcessing = false;
								// Resolve the promise
								resolve();
							}, 500); // Increased timeout to ensure the 100% is visible
						} catch (error) {
							console.error("Error hiding loading screen:", error);
							// Clear processing flag even on error
							self.isProcessing = false;
							resolve();
						}
					} else {
						// Clear processing flag
						self.isProcessing = false;
						// Resolve the promise
						resolve();
					}
				}
			};
			
			// Start processing
			processBatch(0);
		}).catch(error => {
			console.error("Error in updateFromTerrain:", error);
			// Clear processing flag on error
			this.isProcessing = false;
		});
	}
	
	/**
	 * Update specific blocks in the spatial hash grid
	 * @param {Array} addedBlocks - Array of [key, blockId] pairs to add
	 * @param {Array} removedBlocks - Array of keys to remove
	 * @param {Object} options - Options for updating
	 */
	updateBlocks(addedBlocks = [], removedBlocks = [], options = {}) {
		// Set processing flag
		this.isProcessing = true;
		
		try {
			if (!options.silent) {
				console.log("SpatialGridManager.updateBlocks:", {
					addedBlocks: addedBlocks.length,
					removedBlocks: removedBlocks.length
				});
			}
			
			// Process removed blocks
			let removedCount = 0;
			for (const block of removedBlocks) {
				try {
					// Handle different formats of removed blocks
					let key;
					
					if (typeof block === 'string') {
						// Format: "x,y,z"
						key = block;
					} else if (Array.isArray(block)) {
						// Format: [x, y, z]
						key = block.join(',');
					} else if (typeof block === 'object' && block !== null) {
						// Format: {position: [x, y, z]} or {x, y, z}
						if (Array.isArray(block.position)) {
							key = block.position.join(',');
						} else if (block.x !== undefined && block.y !== undefined && block.z !== undefined) {
							key = `${block.x},${block.y},${block.z}`;
						} else if (block.posKey) {
							key = block.posKey;
						}
					}
					
					if (key && this.spatialHashGrid.has(key)) {
						this.spatialHashGrid.delete(key);
						removedCount++;
					}
				} catch (e) {
					console.error(`Error removing block:`, e);
				}
			}
			
			// Process added blocks
			let addedCount = 0;
			for (const item of addedBlocks) {
				try {
					// Handle different formats of added blocks
					let key, blockId;
					
					if (Array.isArray(item) && item.length >= 2) {
						// Format: [key, blockId]
						[key, blockId] = item;
					} else if (typeof item === 'object' && item !== null) {
						// Format: {position: [x, y, z], id} or {x, y, z, id}
						if (Array.isArray(item.position)) {
							key = item.position.join(',');
							blockId = item.id || item.blockId;
						} else if (item.x !== undefined && item.y !== undefined && item.z !== undefined) {
							key = `${item.x},${item.y},${item.z}`;
							blockId = item.id || item.blockId;
						} else if (item.posKey) {
							key = item.posKey;
							blockId = item.id || item.blockId;
						}
					}
					
					// Only proceed if we have valid data
					if (key && blockId !== undefined) {
						this.spatialHashGrid.set(key, blockId);
						addedCount++;
					}
				} catch (e) {
					console.error("Error adding block:", e, item);
				}
			}
			
			if (!options.silent && (addedCount > 0 || removedCount > 0)) {
				console.log(`Successfully updated spatial hash: added ${addedCount}, removed ${removedCount}`);
			}
		} catch (e) {
			console.error("Error in updateBlocks:", e);
		} finally {
			// Clear processing flag
			this.isProcessing = false;
		}
	}
	
	/**
	 * Perform a raycast against the spatial hash grid
	 * @param {THREE.Raycaster} raycaster - The raycaster to use
	 * @param {THREE.Camera} camera - The camera to use
	 * @param {Object} options - Options for the raycast
	 * @param {number} options.maxDistance - Maximum distance to check
	 * @param {boolean} options.prioritizeBlocks - Whether to prioritize blocks over ground plane
	 * @param {number} options.gridSize - Size of the grid
	 * @param {Set} options.recentlyPlacedBlocks - Set of recently placed blocks to ignore
	 * @param {boolean} options.isPlacing - Whether we're currently in placement mode
	 * @param {string} options.mode - Current mode (add, delete, remove)
	 * @returns {Object|null} - Raycast result with point, normal, block position, and blockId
	 */
	raycast(raycaster, camera, options = {}) {
		if (!raycaster || !camera) return null;
		
		const {
			maxDistance = 32,
			prioritizeBlocks = true, // Default to prioritizing blocks
			gridSize = 256,
			recentlyPlacedBlocks = new Set(),
			isPlacing = false,
			mode = 'add' // Default to add mode
		} = options;
		
		// Create ray from camera
		const ray = raycaster.ray.clone();
		
		// Calculate ground plane intersection as a fallback
		const rayOrigin = ray.origin;
		const rayDirection = ray.direction;
		
		// Calculate intersection with the ground plane
		const target = new THREE.Vector3();
		const intersectionDistance = rayOrigin.y / -rayDirection.y;
		
		// Store ground plane intersection if valid
		let groundIntersection = null;
		
		// Only consider ground intersections in front of the camera and within selection distance
		if (intersectionDistance > 0 && intersectionDistance < maxDistance) {
			// Calculate the intersection point
			target.copy(rayOrigin).addScaledVector(rayDirection, intersectionDistance);
			
			// Check if this point is within our valid grid area
			const gridSizeHalf = gridSize / 2;
			if (Math.abs(target.x) <= gridSizeHalf && Math.abs(target.z) <= gridSizeHalf) {
				// This is a hit against the ground plane within the valid build area
				groundIntersection = {
					point: target.clone(),
					normal: new THREE.Vector3(0, 1, 0), // Normal is up for ground plane
					block: { x: Math.floor(target.x), y: 0, z: Math.floor(target.z) },
					blockId: null, // No block here - it's the ground
					distance: intersectionDistance,
					isGroundPlane: true
				};
			}
		}
		
		// If spatial hash is empty, return ground intersection
		if (this.spatialHashGrid.size === 0) {
			console.log("Spatial hash is empty, returning ground intersection");
			return groundIntersection;
		}
		
		// Use a more accurate ray-box intersection approach
		// First, determine which chunks the ray passes through
		const chunksToCheck = this.getChunksAlongRay(ray, maxDistance);
		
		// Store all block intersections
		const blockIntersections = [];
		
		// Check each chunk for block intersections
		for (const chunkKey of chunksToCheck) {
			const chunk = this.spatialHashGrid.grid.get(chunkKey);
			if (!chunk) continue;
			
			// Parse chunk coordinates
			const [cx, cy, cz] = chunkKey.split(',').map(Number);
			
			// Check each block in the chunk
			for (const [localKey, blockId] of chunk.entries()) {
				// Parse local coordinates
				const [lx, ly, lz] = localKey.split(',').map(Number);
				
				// Calculate world coordinates
				const x = cx * CHUNK_SIZE + lx;
				const y = cy * CHUNK_SIZE + ly;
				const z = cz * CHUNK_SIZE + lz;
				
				// Create block key
				const blockKey = `${x},${y},${z}`;
				
				// Skip recently placed blocks during placement
				if (isPlacing && recentlyPlacedBlocks.has(blockKey)) {
					continue;
				}
				
				// Create a box for this block
				const blockBox = new THREE.Box3(
					new THREE.Vector3(x - 0.5, y - 0.5, z - 0.5),
					new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5)
				);
				
				// Check if ray intersects this box
				const intersectionPoint = new THREE.Vector3();
				const doesIntersect = ray.intersectBox(blockBox, intersectionPoint);
				
				if (doesIntersect) {
					// Calculate distance from camera to intersection
					const distance = rayOrigin.distanceTo(intersectionPoint);
					
					// Skip if too far
					if (distance > maxDistance) {
						continue;
					}
					
					// Calculate which face was hit with high precision
					const normal = this.calculateExactFaceNormal(intersectionPoint, x, y, z);
					
					// Add to intersections
					blockIntersections.push({
						point: intersectionPoint.clone(),
						normal,
						block: { x, y, z },
						blockId,
						distance,
						isGroundPlane: false
					});
				}
			}
		}
		
		// Sort intersections by distance (closest first)
		blockIntersections.sort((a, b) => a.distance - b.distance);
		
		// Return the closest block intersection if any
		if (blockIntersections.length > 0) {
			// For erase mode, modify the intersection point to be the center of the block
			if (mode === 'delete' || mode === 'remove') {
				const intersection = blockIntersections[0];
				const { x, y, z } = intersection.block;
				intersection.point.set(x, y, z);
			}
			return blockIntersections[0];
		}
		
		// If no block intersections, return the ground intersection as a fallback
		return groundIntersection;
	}
	
	/**
	 * Calculate the exact face normal for a block intersection
	 * @param {THREE.Vector3} point - Intersection point
	 * @param {number} blockX - Block X coordinate
	 * @param {number} blockY - Block Y coordinate
	 * @param {number} blockZ - Block Z coordinate
	 * @returns {THREE.Vector3} - Face normal
	 */
	calculateExactFaceNormal(point, blockX, blockY, blockZ) {
		// Calculate distances to each face
		const distToXMinus = Math.abs(point.x - (blockX - 0.5));
		const distToXPlus = Math.abs(point.x - (blockX + 0.5));
		const distToYMinus = Math.abs(point.y - (blockY - 0.5));
		const distToYPlus = Math.abs(point.y - (blockY + 0.5));
		const distToZMinus = Math.abs(point.z - (blockZ - 0.5));
		const distToZPlus = Math.abs(point.z - (blockZ + 0.5));
		
		// Find the minimum distance
		const minDist = Math.min(
			distToXMinus, distToXPlus,
			distToYMinus, distToYPlus,
			distToZMinus, distToZPlus
		);
		
		// Return the normal for the closest face
		if (minDist === distToXMinus) return new THREE.Vector3(-1, 0, 0);
		if (minDist === distToXPlus) return new THREE.Vector3(1, 0, 0);
		if (minDist === distToYMinus) return new THREE.Vector3(0, -1, 0);
		if (minDist === distToYPlus) return new THREE.Vector3(0, 1, 0);
		if (minDist === distToZMinus) return new THREE.Vector3(0, 0, -1);
		return new THREE.Vector3(0, 0, 1);
	}
	
	/**
	 * Get all chunks that a ray passes through
	 * @param {THREE.Ray} ray - The ray to check
	 * @param {number} maxDistance - Maximum distance to check
	 * @returns {Set<string>} - Set of chunk keys
	 */
	getChunksAlongRay(ray, maxDistance) {
		const chunksToCheck = new Set();
		
		// Use 3D DDA (Digital Differential Analyzer) algorithm for ray traversal
		// This is more accurate than ray marching for finding all chunks
		
		// Start at ray origin
		const startPos = ray.origin.clone();
		const dir = ray.direction.clone().normalize();
		
		// Calculate which chunk the ray starts in
		let currentX = Math.floor(startPos.x / CHUNK_SIZE);
		let currentY = Math.floor(startPos.y / CHUNK_SIZE);
		let currentZ = Math.floor(startPos.z / CHUNK_SIZE);
		
		// Add starting chunk
		chunksToCheck.add(`${currentX},${currentY},${currentZ}`);
		
		// Calculate step direction (which way to step in each dimension)
		const stepX = dir.x > 0 ? 1 : (dir.x < 0 ? -1 : 0);
		const stepY = dir.y > 0 ? 1 : (dir.y < 0 ? -1 : 0);
		const stepZ = dir.z > 0 ? 1 : (dir.z < 0 ? -1 : 0);
		
		// Calculate distance to next chunk boundary in each dimension
		// First, calculate the boundaries of the current chunk
		const nextBoundaryX = (currentX + (stepX > 0 ? 1 : 0)) * CHUNK_SIZE;
		const nextBoundaryY = (currentY + (stepY > 0 ? 1 : 0)) * CHUNK_SIZE;
		const nextBoundaryZ = (currentZ + (stepZ > 0 ? 1 : 0)) * CHUNK_SIZE;
		
		// Calculate distance to next boundary in each dimension
		let tMaxX = stepX === 0 ? Infinity : Math.abs((nextBoundaryX - startPos.x) / dir.x);
		let tMaxY = stepY === 0 ? Infinity : Math.abs((nextBoundaryY - startPos.y) / dir.y);
		let tMaxZ = stepZ === 0 ? Infinity : Math.abs((nextBoundaryZ - startPos.z) / dir.z);
		
		// Calculate how far along the ray we need to move to cross a chunk in each dimension
		const tDeltaX = stepX === 0 ? Infinity : Math.abs(CHUNK_SIZE / dir.x);
		const tDeltaY = stepY === 0 ? Infinity : Math.abs(CHUNK_SIZE / dir.y);
		const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(CHUNK_SIZE / dir.z);
		
		// Track total distance traveled
		let totalDistance = 0;
		
		// Limit iterations to prevent infinite loops
		const maxIterations = 100;
		let iterations = 0;
		
		// Traverse chunks until we reach the maximum distance
		while (totalDistance < maxDistance && iterations < maxIterations) {
			iterations++;
			
			// Find the closest boundary
			if (tMaxX < tMaxY && tMaxX < tMaxZ) {
				// X boundary is closest
				currentX += stepX;
				totalDistance = tMaxX;
				tMaxX += tDeltaX;
			} else if (tMaxY < tMaxZ) {
				// Y boundary is closest
				currentY += stepY;
				totalDistance = tMaxY;
				tMaxY += tDeltaY;
			} else {
				// Z boundary is closest
				currentZ += stepZ;
				totalDistance = tMaxZ;
				tMaxZ += tDeltaZ;
			}
			
			// Add this chunk to the set
			chunksToCheck.add(`${currentX},${currentY},${currentZ}`);
		}
		
		return chunksToCheck;
	}
	
	/**
	 * Get all blocks in the grid
	 * @returns {Object} - Object with position keys and block IDs
	 */
	getAllBlocks() {
		return this.spatialHashGrid.getBlocks();
	}
	
	/**
	 * Get all blocks in a specific chunk
	 * @param {number} cx - Chunk X coordinate
	 * @param {number} cy - Chunk Y coordinate
	 * @param {number} cz - Chunk Z coordinate
	 * @returns {Object} - Object with position keys and block IDs
	 */
	getChunkBlocks(cx, cy, cz) {
		return this.spatialHashGrid.getChunkBlocks(cx, cy, cz);
	}
	
	/**
	 * Get the number of blocks in the grid
	 * @returns {number} - Number of blocks
	 */
	get size() {
		return this.spatialHashGrid.size;
	}
	
	/**
	 * Check if a block exists at the given position
	 * @param {string} key - Position key in format "x,y,z"
	 * @returns {boolean} - True if a block exists
	 */
	hasBlock(key) {
		return this.spatialHashGrid.has(key);
	}
	
	/**
	 * Get the block ID at the given position
	 * @param {string} key - Position key in format "x,y,z"
	 * @returns {number|null} - Block ID or null if not found
	 */
	getBlock(key) {
		return this.spatialHashGrid.get(key);
	}
	
	/**
	 * Set a block at the given position
	 * @param {string} key - Position key in format "x,y,z"
	 * @param {number} blockId - Block ID to set
	 */
	setBlock(key, blockId) {
		this.spatialHashGrid.set(key, blockId);
	}
	
	/**
	 * Delete a block at the given position
	 * @param {string} key - Position key in format "x,y,z"
	 * @returns {boolean} - True if the block was deleted
	 */
	deleteBlock(key) {
		console.log(`SpatialGridManager.deleteBlock: Deleting block at ${key}`);
		return this.spatialHashGrid.delete(key);
	}
	
	/**
	 * Clear all blocks from the grid
	 */
	clear() {
		this.spatialHashGrid.clear();
	}
	
	/**
	 * @deprecated This function is no longer used
	 * The occlusion culling system has been removed
	 */
	isChunkOccluded() {
		return false;
	}
}

export { SpatialGridManager, SpatialHashGrid }; 