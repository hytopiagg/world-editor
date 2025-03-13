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
	}
	
	/**
	 * Update the spatial hash grid with all blocks from the terrain
	 * @param {Object} terrainBlocks - Object containing all blocks in the terrain
	 * @param {Object} options - Options for updating
	 * @param {boolean} options.showLoadingScreen - Whether to show a loading screen
	 * @param {number} options.batchSize - Number of blocks to process in each batch
	 */
	updateFromTerrain(terrainBlocks, options = {}) {
		const blockEntries = Object.entries(terrainBlocks);
		const totalBlocks = blockEntries.length;
		let processedBlocks = 0;
		const BATCH_SIZE = options.batchSize || 50000;
		const totalBatches = Math.ceil(totalBlocks / BATCH_SIZE);
		let currentBatch = 0;
		
		// Check if we need to show a loading screen
		const showLoadingScreen = options.showLoadingScreen === true;
		
		// Clear the grid before updating
		this.spatialHashGrid.clear();
		
		// Show loading screen if requested
		if (showLoadingScreen && this.loadingManager) {
			try {
				this.loadingManager.showLoading('Updating spatial hash grid...');
			} catch (error) {
				console.error("Error showing loading screen:", error);
			}
		}
		
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
					console.log(`Spatial hash fully updated with ${this.spatialHashGrid.size} blocks`);
					
					// Hide loading screen if shown
					if (showLoadingScreen && this.loadingManager) {
						try {
							// Set progress to 100% before hiding the loading screen
							this.loadingManager.updateLoading(`Spatial hash update complete (100%)`, 100);
							// Wait a brief moment to ensure the update is visible
							setTimeout(() => {
								this.loadingManager.hideLoading();
							}, 500); // Increased timeout to ensure the 100% is visible
						} catch (error) {
							console.error("Error hiding loading screen:", error);
						}
					}
					
					// Resolve the promise
					resolve();
				}
			};
			
			// Start processing
			processBatch(0);
		});
	}
	
	/**
	 * Update specific blocks in the spatial hash grid
	 * @param {Array} addedBlocks - Array of [key, blockId] pairs to add
	 * @param {Array} removedBlocks - Array of keys to remove
	 */
	updateBlocks(addedBlocks = [], removedBlocks = []) {
		// Process removed blocks
		for (const key of removedBlocks) {
			this.spatialHashGrid.delete(key);
		}
		
		// Process added blocks
		for (const [key, blockId] of addedBlocks) {
			this.spatialHashGrid.set(key, blockId);
		}
	}
	
	/**
	 * Perform raycasting using the spatial hash grid
	 * @param {THREE.Raycaster} raycaster - Three.js raycaster
	 * @param {THREE.Camera} camera - Three.js camera
	 * @param {Object} options - Options for raycasting
	 * @param {number} options.maxDistance - Maximum raycast distance
	 * @param {boolean} options.prioritizeBlocks - Whether to prioritize block hits over ground plane
	 * @param {number} options.gridSize - Size of the buildable grid for ground plane detection
	 * @param {Set} options.recentlyPlacedBlocks - Set of recently placed blocks to ignore
	 * @param {boolean} options.isPlacing - Whether we're currently in placement mode
	 * @returns {Object|null} - Raycast result with point, normal, block position, and blockId
	 */
	raycast(raycaster, camera, options = {}) {
		if (!raycaster || !camera) return null;
		
		const {
			maxDistance = 32,
			prioritizeBlocks = false,
			gridSize = 256,
			recentlyPlacedBlocks = new Set(),
			isPlacing = false
		} = options;
		
		// Create ray from camera
		const ray = raycaster.ray.clone();
		
		// First, check for ground plane intersection to have it as a fallback
		const rayOrigin = ray.origin;
		const rayDirection = ray.direction;
		
		// Calculate intersection with the ground plane
		const target = new THREE.Vector3();
		const intersectionDistance = rayOrigin.y / -rayDirection.y;
		
		// Store ground plane intersection if valid
		let groundIntersection = null;
		
		// Only consider intersections in front of the camera and within selection distance
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
		
		// If prioritizeBlocks is false and we have a ground intersection, return it immediately
		if (!prioritizeBlocks && groundIntersection) {
			return groundIntersection;
		}
		
		// If spatial hash is empty or still being built, return ground intersection
		if (this.spatialHashGrid.size === 0) {
			return groundIntersection;
		}
		
		// Parameters for ray marching
		const precision = 0.5; // Use a larger step size for better performance
		
		// Start at camera position
		let pos = ray.origin.clone();
		let step = ray.direction.clone().normalize().multiplyScalar(precision);
		let distance = 0;
		
		// For performance tracking
		let iterations = 0;
		const maxIterations = 1000; // Limit iterations to prevent infinite loops
		
		// Track which blocks we've checked
		const checkedBlocks = new Set();
		
		// Ray marching loop
		while (distance < maxDistance && iterations < maxIterations) {
			iterations++;
			
			// Get block coordinates
			const blockX = Math.floor(pos.x);
			const blockY = Math.floor(pos.y);
			const blockZ = Math.floor(pos.z);
			
			// Skip if below ground
			if (blockY < 0) {
				pos.add(step);
				distance += precision;
				continue;
			}
			
			// Create block key
			const blockKey = `${blockX},${blockY},${blockZ}`;
			
			// Skip if we've already checked this block
			if (checkedBlocks.has(blockKey)) {
				pos.add(step);
				distance += precision;
				continue;
			}
			
			// Add to checked blocks
			checkedBlocks.add(blockKey);
			
			// Skip recently placed blocks during placement
			if (isPlacing && recentlyPlacedBlocks.has(blockKey)) {
				pos.add(step);
				distance += precision;
				continue;
			}
			
			// Check if there's a block at this position (using spatial hash)
			if (this.spatialHashGrid.has(blockKey)) {
				// We hit a block!
				const blockId = this.spatialHashGrid.get(blockKey);
				
				// Calculate exact hit position
				const point = pos.clone();
				
				// Calculate normal (which face was hit)
				const normal = new THREE.Vector3();
				
				// Use epsilon tests to determine face
				const epsilon = 0.01;
				const px = pos.x - blockX;
				const py = pos.y - blockY;
				const pz = pos.z - blockZ;
				
				if (px < epsilon) normal.set(-1, 0, 0);
				else if (px > 1-epsilon) normal.set(1, 0, 0);
				else if (py < epsilon) normal.set(0, -1, 0);
				else if (py > 1-epsilon) normal.set(0, 1, 0);
				else if (pz < epsilon) normal.set(0, 0, -1);
				else normal.set(0, 0, 1);
				
				// Return block intersection
				return {
					point,
					normal,
					block: { x: blockX, y: blockY, z: blockZ },
					blockId,
					distance,
					isGroundPlane: false
				};
			}
			
			// Move along the ray
			pos.add(step);
			distance += precision;
		}
		
		// If we didn't hit any blocks, return the ground intersection as a fallback
		return groundIntersection;
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
		return this.spatialHashGrid.delete(key);
	}
	
	/**
	 * Clear all blocks from the grid
	 */
	clear() {
		this.spatialHashGrid.clear();
	}
	
	/**
	 * Check if a chunk is occluded by other chunks
	 * @param {string} chunkKey - The chunk key to check
	 * @param {THREE.Vector3} cameraPosition - The camera position
	 * @param {number} occlusionThreshold - Threshold for considering a chunk as occluding (0-1)
	 * @returns {boolean} - True if the chunk is occluded
	 */
	isChunkOccluded(chunkKey, cameraPosition, occlusionThreshold = 0.7) {
		// If spatial hash is empty, nothing is occluded
		if (this.spatialHashGrid.size === 0) {
			return false;
		}
		
		// Parse chunk coordinates
		const [cx, cy, cz] = chunkKey.split(',').map(Number);
		
		// Get camera chunk coordinates
		const cameraChunkX = Math.floor(cameraPosition.x / CHUNK_SIZE);
		const cameraChunkY = Math.floor(cameraPosition.y / CHUNK_SIZE);
		const cameraChunkZ = Math.floor(cameraPosition.z / CHUNK_SIZE);
		
		// If camera is inside this chunk, it's definitely not occluded
		if (cx === cameraChunkX && cy === cameraChunkY && cz === cameraChunkZ) {
			return false;
		}
		
		// Add a 1-chunk buffer around the target chunk to avoid false positives
		// Check if the chunk is adjacent to the target chunk (including diagonals)
		const isAdjacent = Math.abs(cx - cameraChunkX) <= 1 && 
						   Math.abs(cy - cameraChunkY) <= 1 && 
						   Math.abs(cz - cameraChunkZ) <= 1;
		
		// If it's adjacent to the camera chunk, don't consider it occluded
		if (isAdjacent) {
			return false;
		}
		
		// Calculate chunk center
		const chunkCenter = new THREE.Vector3(
			cx * CHUNK_SIZE + CHUNK_SIZE / 2,
			cy * CHUNK_SIZE + CHUNK_SIZE / 2,
			cz * CHUNK_SIZE + CHUNK_SIZE / 2
		);
		
		// Create ray from camera to chunk center
		const direction = new THREE.Vector3().subVectors(chunkCenter, cameraPosition).normalize();
		const ray = new THREE.Ray(cameraPosition.clone(), direction);
		
		// Parameters for ray marching
		const precision = CHUNK_SIZE / 4; // Use a larger step size for better performance
		
		// Start at camera position
		let pos = ray.origin.clone();
		let step = ray.direction.clone().normalize().multiplyScalar(precision);
		let distance = 0;
		
		// Calculate distance to target chunk
		const distanceToChunk = cameraPosition.distanceTo(chunkCenter);
		
		// For performance tracking
		let iterations = 0;
		const maxIterations = 100; // Limit iterations to prevent infinite loops
		
		// Track which chunks we've checked
		const checkedChunks = new Set();
		
		// Ray marching loop
		while (distance < distanceToChunk && iterations < maxIterations) {
			iterations++;
			
			// Get current chunk coordinates
			const currentChunkX = Math.floor(pos.x / CHUNK_SIZE);
			const currentChunkY = Math.floor(pos.y / CHUNK_SIZE);
			const currentChunkZ = Math.floor(pos.z / CHUNK_SIZE);
			
			// Skip if we've reached the target chunk
			if (currentChunkX === cx && currentChunkY === cy && currentChunkZ === cz) {
				break;
			}
			
			// Create chunk key
			const currentChunkKey = `${currentChunkX},${currentChunkY},${currentChunkZ}`;
			
			// Skip if we've already checked this chunk
			if (checkedChunks.has(currentChunkKey)) {
				pos.add(step);
				distance += precision;
				continue;
			}
			
			// Add to checked chunks
			checkedChunks.add(currentChunkKey);
			
			// Check if this chunk exists in the grid
			const chunk = this.spatialHashGrid.grid.get(currentChunkKey);
			
			if (chunk && chunk.size > 0) {
				// Calculate chunk fullness (how many blocks it contains)
				const chunkCapacity = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;
				const chunkFullness = chunk.size / chunkCapacity;
				
				// If chunk is full enough, consider it as occluding
				if (chunkFullness >= occlusionThreshold) {
					// Check if the occluding chunk is adjacent to the target chunk
					const isAdjacentToTarget = Math.abs(currentChunkX - cx) <= 1 && 
											  Math.abs(currentChunkY - cy) <= 1 && 
											  Math.abs(currentChunkZ - cz) <= 1;
					
					// If the occluding chunk is adjacent to the target, don't consider it occluded
					if (isAdjacentToTarget) {
						continue;
					}
					
					return true;
				}
			}
			
			// Move along the ray
			pos.add(step);
			distance += precision;
		}
		
		// If we didn't hit any occluding chunks, the chunk is not occluded
		return false;
	}
}

export { SpatialGridManager, SpatialHashGrid }; 