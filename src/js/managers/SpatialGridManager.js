import * as THREE from 'three';
import { CHUNK_SIZE } from '../constants/terrain';
import { SpatialHashGrid } from '../chunks/SpatialHashGrid';


/**
 * SpatialGridManager provides a higher-level interface for managing the spatial hash grid
 * It handles batched updates, optimized raycasting, and other operations
 */

// Singleton instance - shared across the application
let managerInstance = null;

class SpatialGridManager {
	constructor(loadingManager) {
		// Return existing instance if already created
		if (managerInstance) {
			// Update loading manager if provided
			if (loadingManager && !managerInstance.loadingManager) {
				managerInstance.loadingManager = loadingManager;
			}
			return managerInstance;
		}
		
		// Initialize with binary implementation
		this.spatialHashGrid = new SpatialHashGrid({ chunkSize: CHUNK_SIZE });
		this.loadingManager = loadingManager;
		this.isProcessing = false; // Flag to track if processing is happening
		this.lastFrustumUpdate = 0;
		this.chunksInFrustum = new Set(); // Set of chunk keys in frustum
		
		// Performance monitoring
		this.perfMetrics = {
			lastUpdateTime: 0,
			blockCount: 0,
			updateCount: 0
		};
		
		// Store as singleton
		managerInstance = this;
		
		console.log(`SpatialGridManager singleton instance created with chunk size ${CHUNK_SIZE}`);
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
		
		// Use standard approach - just check nearby chunks
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
			
			// Process all blocks
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
	async updateFromTerrain(terrainBlocks, options = {}) {
		const { force = false, showLoadingScreen = false, message = "Building spatial index..." } = options;
		
		// Skip if we're already processing
		if (this.isProcessing && !force) {
			console.log('SpatialGridManager: Already processing a grid update, skipped');
			return;
		}
		
		// Mark as processing
		this.isProcessing = true;
		
		// Show loading screen if requested
		if (showLoadingScreen && this.loadingManager && typeof this.loadingManager.showLoadingScreen === 'function') {
			this.loadingManager.showLoadingScreen(message);
		}
		
		// Get block data
		const blocks = Object.entries(terrainBlocks);
		console.log(`SpatialGridManager: Updating from terrain with ${blocks.length.toLocaleString()} blocks ${force ? '(FORCED)' : ''}`);
		
		// Clear the grid first if forced
		if (force) {
			this.spatialHashGrid.clear();
		}
		
		// Try with worker first
		let workerSuccess = false;
		try {
			workerSuccess = await this.processWithWorker(blocks);
			} catch (error) {
			console.error('SpatialGridManager: Worker error, falling back to direct processing', error);
		}
		
		// If worker failed, use direct fallback
		if (!workerSuccess) {
			console.log('SpatialGridManager: Using direct fallback for block processing');
			this.buildDirectly(blocks);
		}
		
		// Mark as no longer processing
		this.isProcessing = false;
		
		// Hide loading screen if it was shown
		if (showLoadingScreen && this.loadingManager && typeof this.loadingManager.hideLoadingScreen === 'function') {
			this.loadingManager.hideLoadingScreen();
		}
	}
	
	/**
	 * Build the spatial grid directly (fallback if worker fails)
	 * @param {Array} blocks - Block entries
	 * @private
	 */
	buildDirectly(blocks) {
		console.log(`SpatialGridManager: Building spatial grid directly with ${blocks.length} blocks`);
		
		// Create a fresh grid and ensure it's empty
		this.spatialHashGrid.clear();
		
		// Process blocks in batches to avoid UI freezes
		const batchSize = 1000;
		const totalBatches = Math.ceil(blocks.length / batchSize);
		
		// Process first batch immediately
		const firstBatch = blocks.slice(0, batchSize);
		this.processBatch(firstBatch);
		
		// Schedule remaining batches
		if (blocks.length > batchSize) {
			let batchIndex = 1;
			
			const processNextBatch = () => {
				const start = batchIndex * batchSize;
				const end = Math.min(start + batchSize, blocks.length);
				const batch = blocks.slice(start, end);
				
				this.processBatch(batch);
				batchIndex++;
				
				// Log progress
				if (batchIndex % 10 === 0 || batchIndex === totalBatches) {
					const progress = Math.round((batchIndex / totalBatches) * 100);
					console.log(`SpatialGridManager: Processed ${batchIndex} of ${totalBatches} batches (${progress}%)`);
				}
				
				// Continue if more batches remain
				if (batchIndex < totalBatches) {
					setTimeout(processNextBatch, 0);
				} else {
					console.log(`SpatialGridManager: Direct processing complete, added ${this.spatialHashGrid.size} blocks`);
				}
			};
			
			// Start processing batches
			setTimeout(processNextBatch, 0);
		}
	}
	
	/**
	 * Process a batch of blocks
	 * @param {Array} batch - Batch of blocks to process
	 * @private
	 */
	processBatch(batch) {
		for (const [posKey, blockId] of batch) {
			// Skip air blocks
			if (blockId === 0 || blockId === null || blockId === undefined) {
				continue;
			}
			
			// Add to spatial hash grid
			this.spatialHashGrid.set(posKey, blockId);
		}
	}
	
	/**
	 * Update specific blocks in the spatial hash grid
	 * @param {Array} addedBlocks - Array of blocks to add
	 * @param {Array} removedBlocks - Array of blocks to remove
	 * @param {Object} options - Options for updating
	 */
	updateBlocks(addedBlocks = [], removedBlocks = [], options = {}) {
		// Skip if no blocks to update
		if (addedBlocks.length === 0 && removedBlocks.length === 0) {
			return;
		}
		
		// Log the update
		
		// Create spatial hash grid if it doesn't exist
		if (!this.spatialHashGrid) {
			console.warn("Creating new spatial hash grid");
			this.spatialHashGrid = new SpatialHashGrid();
		}
		
		// Process added blocks
		if (addedBlocks.length > 0) {
			for (const block of addedBlocks) {
				let blockId, x, y, z;
				
				// Handle different block formats
				if (Array.isArray(block)) {
					// Format: [posKey, blockId]
					const [posKey, id] = block;
					[x, y, z] = posKey.split(',').map(Number);
					blockId = id;
				} else if (block.position) {
					// Format: { position: [x, y, z], id: blockId }
					[x, y, z] = block.position;
					blockId = block.id;
				} else if (block.x !== undefined) {
					// Format: { x, y, z, id }
					x = block.x;
					y = block.y;
					z = block.z;
					blockId = block.id || block.blockId;
				}
				
				// Skip if invalid or air block
				if (blockId === 0 || blockId === undefined || blockId === null) {
					continue;
				}
				
				// Add to spatial hash
				this.spatialHashGrid.set(x, y, z, blockId);
			}
		}
		
		// Process removed blocks
		if (removedBlocks.length > 0) {
			for (const block of removedBlocks) {
				let x, y, z;
				
				// Handle different block formats
				if (Array.isArray(block)) {
					// Format: [posKey, blockId]
					const [posKey] = block;
					[x, y, z] = posKey.split(',').map(Number);
				} else if (block.position) {
					// Format: { position: [x, y, z] }
					[x, y, z] = block.position;
				} else if (block.x !== undefined) {
					// Format: { x, y, z }
					x = block.x;
					y = block.y;
					z = block.z;
				}
				
				// Remove from spatial hash
				this.spatialHashGrid.remove(x, y, z);
			}
		}
		
		//console.log(`Successfully updated spatial hash: added ${addedBlocks.length}, removed ${removedBlocks.length}`);
	}
	
	/**
	 * Perform a raycast against the spatial hash grid
	 * @param {THREE.Raycaster} raycaster - The raycaster to use
	 * @param {THREE.Camera} camera - The camera to use
	 * @param {Object} options - Options for the raycast
	 * @returns {Object|null} - Raycast result with point, normal, block position, and blockId
	 */
	raycast(raycaster, camera, options = {}) {
		if (!raycaster || !camera) return null;
		
		// TEMPORARY: Force debug mode to diagnose collision issues
		const forceDebug = false; // Changed from true to false to disable debug logging
		
		const {
			maxDistance = 32,
			prioritizeBlocks = true, // Default to prioritizing blocks
			gridSize = 256,
			recentlyPlacedBlocks = new Set(),
			isPlacing = false,
			mode = 'add', // Default to add mode
			debug = forceDebug // Enable for detailed debugging
		} = options;
		
		// Make sure we have a spatial hash grid
		if (!this.spatialHashGrid) {
			if (debug) console.warn("SpatialGridManager: No spatial hash grid for raycast");
			return null;
		}
		
		// Convert the ray to world space if needed
		const ray = raycaster.ray;
		const rayOrigin = ray.origin;
		const rayDirection = ray.direction;
		
		// Calculate intersection with the ground plane
		const groundTarget = new THREE.Vector3();
		const groundIntersectionDistance = rayOrigin.y / -rayDirection.y;
		
		// Check if the ground intersection is valid
		let groundIntersection = null;
		if (groundIntersectionDistance > 0 && groundIntersectionDistance < maxDistance) {
			// Calculate the intersection point
			groundTarget.copy(rayOrigin).addScaledVector(rayDirection, groundIntersectionDistance);
			
			// Check if this point is within our valid grid area
			const gridSizeHalf = gridSize / 2;
			if (Math.abs(groundTarget.x) <= gridSizeHalf && Math.abs(groundTarget.z) <= gridSizeHalf) {
				// Valid ground intersection
				groundIntersection = {
					point: groundTarget.clone(),
					normal: new THREE.Vector3(0, 1, 0), // Normal is up for ground plane
					block: { x: Math.floor(groundTarget.x), y: 0, z: Math.floor(groundTarget.z) },
					blockId: null, // No block here - it's the ground
					distance: groundIntersectionDistance,
					isGroundPlane: true
				};
			}
		}
		
		// If not prioritizing blocks or there are no blocks in the spatial hash grid,
		// return the ground intersection directly
		if (!prioritizeBlocks || this.spatialHashGrid.size === 0) {
			return groundIntersection;
		}
		
		// Use a very small step size for more accurate detection of all faces
		const stepSize = 0.02; // Reduced for better accuracy with thin walls
		const maxSteps = Math.ceil(maxDistance / stepSize);
		
		// DDA algorithm for efficient ray traversal through the grid
		// Starting position and current position
		let currentX = rayOrigin.x+0.5;
		let currentY = rayOrigin.y+0.5;
		let currentZ = rayOrigin.z+0.5;
		
		// Direction and step variables
		//const signX = Math.sign(rayDirection.x);
		//const signY = Math.sign(rayDirection.y);
		//const signZ = Math.sign(rayDirection.z);
		
		// Normalize ray direction for more consistent results
		const dirNormalized = rayDirection.clone().normalize();
		
		// Distance traveled
		let distance = 0;
		
		// Tracking
		let foundBlockId = null;
		let foundBlock = null;
		let foundDistance = Infinity;
		let foundNormal = new THREE.Vector3(0, 1, 0); // Default to up normal
		let foundHitPoint = new THREE.Vector3();
		let foundFace = null;
		
		// Store entry point into current block
		//let entryPointX = 0;
		//let entryPointY = 0;
		//let entryPointZ = 0;
		
		// Flags to track when we cross block boundaries
		let crossedBoundary = false;
		let previousBlockX = Math.floor(currentX);
		let previousBlockY = Math.floor(currentY);
		let previousBlockZ = Math.floor(currentZ);
		
		// For determining the correct face when crossing block boundaries
		let lastEmptyPosition = new THREE.Vector3(currentX, currentY, currentZ);
		let lastEmptyBlockX = Math.floor(currentX);
		let lastEmptyBlockY = Math.floor(currentY);
		let lastEmptyBlockZ = Math.floor(currentZ);
		
		// Debug logging for troubleshooting
		const isDebugEnabled = false;//debug && isPlacing;
		if (isDebugEnabled) {
			console.log(`RAYCAST: Starting ray from (${rayOrigin.x.toFixed(2)}, ${rayOrigin.y.toFixed(2)}, ${rayOrigin.z.toFixed(2)})`);
			console.log(`RAYCAST: Ray direction (${dirNormalized.x.toFixed(2)}, ${dirNormalized.y.toFixed(2)}, ${dirNormalized.z.toFixed(2)})`);
		}
		
		// Check along the ray
		for (let step = 0; step < maxSteps; step++) {
			// Calculate current block coordinates
			const blockX = Math.floor(currentX);
			const blockY = Math.floor(currentY);
			const blockZ = Math.floor(currentZ);
			
			// Check if we've crossed to a new block
			crossedBoundary = blockX !== previousBlockX || 
							  blockY !== previousBlockY || 
							  blockZ !== previousBlockZ;
							  
			if (crossedBoundary) {
				// Store entry point to this block
				//entryPointX = currentX;
				//entryPointY = currentY;
				//entryPointZ = currentZ;
				
				// Update previous block
				previousBlockX = blockX;
				previousBlockY = blockY;
				previousBlockZ = blockZ;
				
				if (isDebugEnabled) {
					console.log(`RAYCAST: Crossed block boundary to (${blockX}, ${blockY}, ${blockZ})`);
				}
			}
			
			// Create key for lookup
			const key = `${blockX},${blockY},${blockZ}`;
			
			// Skip if this is a recently placed/erased block we should ignore
			if (recentlyPlacedBlocks && recentlyPlacedBlocks.has(key)) {
				// Save this position as the last empty position before advancing
				lastEmptyPosition.set(currentX, currentY, currentZ);
				lastEmptyBlockX = blockX;
				lastEmptyBlockY = blockY;
				lastEmptyBlockZ = blockZ;
				
				// Advance to next position
				currentX += dirNormalized.x * stepSize;
				currentY += dirNormalized.y * stepSize;
				currentZ += dirNormalized.z * stepSize;
				
				// Update distance
				distance += stepSize;
				continue;
			}
				
			// Check if there's a block at this position
			const blockId = this.spatialHashGrid.get(blockX, blockY, blockZ);
			
			// If we don't hit a block, remember where we were
			if (blockId === 0 || blockId === null || blockId === undefined) {
				lastEmptyPosition.set(currentX, currentY, currentZ);
				lastEmptyBlockX = blockX;
				lastEmptyBlockY = blockY;
				lastEmptyBlockZ = blockZ;
				
				if (isDebugEnabled && step % 10 === 0) {
					console.log(`RAYCAST: Empty at (${blockX}, ${blockY}, ${blockZ}), step=${step}`);
				}
			} 
			// Check for valid block
			else {
				// Calculate exact distance for sorting
				const blockPos = new THREE.Vector3(blockX + 0.5, blockY + 0.5, blockZ + 0.5);
				const exactDistance = rayOrigin.distanceTo(blockPos);
			
				// Block is closer than our current best block
				if (exactDistance < foundDistance) {
					// Calculate intersection more precisely using block boundaries and last empty position
					// Get the entry point for ray into this block - use last empty position for better accuracy
					const hitPointRaw = lastEmptyPosition.clone();
					
					if (isDebugEnabled) {
						console.log(`RAYCAST: Ray trajectory between (${lastEmptyPosition.x.toFixed(2)}, ${lastEmptyPosition.y.toFixed(2)}, ${lastEmptyPosition.z.toFixed(2)}) and (${currentX.toFixed(2)}, ${currentY.toFixed(2)}, ${currentZ.toFixed(2)})`);
					}
					
					// Calculate which face was penetrated at entry point
					// Use advanced face detection with special handling for grazing angles
					const faceInfo = this._determineBlockFaceAdvanced(
						hitPointRaw, blockX, blockY, blockZ, dirNormalized, 
						lastEmptyPosition, new THREE.Vector3(currentX, currentY, currentZ)
					);
					
					// Extract face information
					const { normal, face } = faceInfo;
					
					// Calculate exact point on the face for more precise placement
					const hitPoint = this._adjustHitPointToFace(
						hitPointRaw, blockX, blockY, blockZ, face
					);
					
					// For debug visualization, also store the block center
					const blockCenter = new THREE.Vector3(
						blockX + 0.5,
						blockY + 0.5,
						blockZ + 0.5
					);
					
					// Update found information with precise data
					foundBlockId = blockId;
					foundDistance = exactDistance;
					foundBlock = { x: blockX, y: blockY, z: blockZ };
					foundNormal = normal.clone();
					foundHitPoint = hitPoint.clone();
					foundFace = face;
					
					// We found our first intersection, so we can stop
					break;
				}
			}
			
			// Advance to next position
			currentX += dirNormalized.x * stepSize;
			currentY += dirNormalized.y * stepSize;
			currentZ += dirNormalized.z * stepSize;
			
			// Update distance
			distance += stepSize;
			
			// Stop if we're beyond max distance
			if (distance > maxDistance) break;
		}
		
		// If we found a block, return that intersection
		if (foundBlockId !== null) {
			// Return precise hit data
			return {
				point: foundHitPoint.clone(),
				normal: foundNormal,
				block: foundBlock,
				blockId: foundBlockId,
				distance: foundDistance,
				isGroundPlane: false,
				face: foundFace
			};
		}
		
		// If we prioritize blocks but didn't find any, or it's further away than ground,
		// return the ground intersection as fallback
		return groundIntersection;
	}
	
	/**
	 * Advanced face detection that handles grazing angles better
	 * @param {THREE.Vector3} hitPoint - Point where the ray hit
	 * @param {number} blockX - Block X coordinate
	 * @param {number} blockY - Block Y coordinate
	 * @param {number} blockZ - Block Z coordinate
	 * @param {THREE.Vector3} rayDir - Ray direction (normalized)
	 * @param {THREE.Vector3} lastEmptyPos - Last position before hitting the block
	 * @param {THREE.Vector3} currentPos - Current position of ray traversal
	 * @returns {Object} Object containing normal vector and face name
	 * @private
	 */
	_determineBlockFaceAdvanced(hitPoint, blockX, blockY, blockZ, rayDir, lastEmptyPos, currentPos) {
		// Calculate trajectory between last empty position and current position
		const trajectory = new THREE.Vector3()
			.subVectors(currentPos, lastEmptyPos)
			.normalize();
		
		// Calculate block boundaries
		// Block at (x,y,z) has bounds from (x,y,z) to (x+1,y+1,z+1)
		// And its center is at (x+0.5,y+0.5,z+0.5)
		const blockMinX = blockX;
		const blockMinY = blockY;
		const blockMinZ = blockZ;
		const blockMaxX = blockX + 1;
		const blockMaxY = blockY + 1;
		const blockMaxZ = blockZ + 1;
		const blockCenterX = blockX + 0.5;
		const blockCenterY = blockY + 0.5;
		const blockCenterZ = blockZ + 0.5;
		
		// Calculate position within block (0-1 range) for the last empty position
		// This is relative to the block's minimum corner
		const blockFractionX = lastEmptyPos.x - blockMinX;
		const blockFractionY = lastEmptyPos.y - blockMinY;
		const blockFractionZ = lastEmptyPos.z - blockMinZ;
		
		// Calculate distance to each boundary - negative means outside the block
		// These distances help determine which face we're entering through
		const distToMinX = blockFractionX;
		const distToMaxX = blockMaxX - lastEmptyPos.x;
		const distToMinY = blockFractionY;
		const distToMaxY = blockMaxY - lastEmptyPos.y;
		const distToMinZ = blockFractionZ;
		const distToMaxZ = blockMaxZ - lastEmptyPos.z;
		
		// Calculate entry boundaries based on trajectory
		const faces = [
			// -X face (entering from negative X direction)
			{
				name: 'minX',
				normal: new THREE.Vector3(-1, 0, 0),
				valid: trajectory.x > 0, // Moving in positive X direction means entering through minX face
				// Calculate t-value (time to intersection) with the X=blockMinX plane
				tValue: trajectory.x !== 0 ? Math.abs(distToMinX / trajectory.x) : Infinity,
				// How perpendicular the ray is to this face (0-1)
				perpendicular: Math.abs(trajectory.x)
			},
			// +X face (entering from positive X direction)
			{
				name: 'maxX',
				normal: new THREE.Vector3(1, 0, 0),
				valid: trajectory.x < 0, // Moving in negative X direction means entering through maxX face
				tValue: trajectory.x !== 0 ? Math.abs(distToMaxX / -trajectory.x) : Infinity,
				perpendicular: Math.abs(trajectory.x)
			},
			// -Y face (entering from below)
			{
				name: 'minY',
				normal: new THREE.Vector3(0, -1, 0),
				valid: trajectory.y > 0, // Moving upward means entering through bottom face
				tValue: trajectory.y !== 0 ? Math.abs(distToMinY / trajectory.y) : Infinity,
				perpendicular: Math.abs(trajectory.y)
			},
			// +Y face (entering from above)
			{
				name: 'maxY',
				normal: new THREE.Vector3(0, 1, 0),
				valid: trajectory.y < 0, // Moving downward means entering through top face
				tValue: trajectory.y !== 0 ? Math.abs(distToMaxY / -trajectory.y) : Infinity,
				perpendicular: Math.abs(trajectory.y)
			},
			// -Z face (entering from negative Z direction)
			{
				name: 'minZ',
				normal: new THREE.Vector3(0, 0, -1),
				valid: trajectory.z > 0, // Moving in positive Z direction means entering through minZ face
				tValue: trajectory.z !== 0 ? Math.abs(distToMinZ / trajectory.z) : Infinity,
				perpendicular: Math.abs(trajectory.z)
			},
			// +Z face (entering from positive Z direction)
			{
				name: 'maxZ',
				normal: new THREE.Vector3(0, 0, 1),
				valid: trajectory.z < 0, // Moving in negative Z direction means entering through maxZ face
				tValue: trajectory.z !== 0 ? Math.abs(distToMaxZ / -trajectory.z) : Infinity,
				perpendicular: Math.abs(trajectory.z)
			}
		];
		
		// Filter to faces with valid entry (ray is coming from outside)
		const validFaces = faces.filter(face => face.valid);
		
		// If we have valid faces, find the one with the minimum tValue
		// tValue represents how far along the ray to hit that boundary
		if (validFaces.length > 0) {
			// Sort by t-value (time to hit)
			validFaces.sort((a, b) => a.tValue - b.tValue);
			
			// Return the first face we would hit
			return {
				normal: validFaces[0].normal,
				face: validFaces[0].name
			};
		}
		
		// For grazing angles where no face is clearly being entered
		// Sort by perpendicularity to determine which face the ray is most normal to
		faces.sort((a, b) => b.perpendicular - a.perpendicular);
		
		// Bias towards the strongest trajectory component
		return {
			normal: faces[0].normal,
			face: faces[0].name
		};
	}
	
	/**
	 * Adjust hit point to be exactly on the face of the block
	 * @param {THREE.Vector3} rawPoint - Raw hit point
	 * @param {number} blockX - Block X coordinate
	 * @param {number} blockY - Block Y coordinate
	 * @param {number} blockZ - Block Z coordinate
	 * @param {string} face - Face name
	 * @returns {THREE.Vector3} Adjusted hit point
	 * @private
	 */
	_adjustHitPointToFace(rawPoint, blockX, blockY, blockZ, face) {
		const adjustedPoint = rawPoint.clone();
		
		// Calculate block boundaries
		// Block at (x,y,z) has bounds from (x,y,z) to (x+1,y+1,z+1)
		// And its center is at (x+0.5,y+0.5,z+0.5)
		const blockMinX = blockX;
		const blockMinY = blockY;
		const blockMinZ = blockZ;
		const blockMaxX = blockX + 1;
		const blockMaxY = blockY + 1;
		const blockMaxZ = blockZ + 1;
		const blockCenterX = blockX + 0.5;
		const blockCenterY = blockY + 0.5;
		const blockCenterZ = blockZ + 0.5;
		
		// Place point exactly on the face
		switch (face) {
			case 'minX':
				adjustedPoint.x = blockMinX;
				// Keep Y and Z constrained within block face
				adjustedPoint.y = Math.max(blockMinY, Math.min(blockMaxY, adjustedPoint.y));
				adjustedPoint.z = Math.max(blockMinZ, Math.min(blockMaxZ, adjustedPoint.z));
				break;
			case 'maxX':
				adjustedPoint.x = blockMaxX;
				adjustedPoint.y = Math.max(blockMinY, Math.min(blockMaxY, adjustedPoint.y));
				adjustedPoint.z = Math.max(blockMinZ, Math.min(blockMaxZ, adjustedPoint.z));
				break;
			case 'minY':
				adjustedPoint.y = blockMinY;
				adjustedPoint.x = Math.max(blockMinX, Math.min(blockMaxX, adjustedPoint.x));
				adjustedPoint.z = Math.max(blockMinZ, Math.min(blockMaxZ, adjustedPoint.z));
				break;
			case 'maxY':
				adjustedPoint.y = blockMaxY;
				adjustedPoint.x = Math.max(blockMinX, Math.min(blockMaxX, adjustedPoint.x));
				adjustedPoint.z = Math.max(blockMinZ, Math.min(blockMaxZ, adjustedPoint.z));
				break;
			case 'minZ':
				adjustedPoint.z = blockMinZ;
				adjustedPoint.x = Math.max(blockMinX, Math.min(blockMaxX, adjustedPoint.x));
				adjustedPoint.y = Math.max(blockMinY, Math.min(blockMaxY, adjustedPoint.y));
				break;
			case 'maxZ':
				adjustedPoint.z = blockMaxZ;
				adjustedPoint.x = Math.max(blockMinX, Math.min(blockMaxX, adjustedPoint.x));
				adjustedPoint.y = Math.max(blockMinY, Math.min(blockMaxY, adjustedPoint.y));
				break;
		}
		
		return adjustedPoint;
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
		const blocks = {};
		
		// Iterate through all blocks in the binary spatial hash grid
		if (this.spatialHashGrid._blocks && this.spatialHashGrid._coords) {
			for (let i = 0; i < this.spatialHashGrid.size; i++) {
				const x = this.spatialHashGrid._coords[i * 3];
				const y = this.spatialHashGrid._coords[i * 3 + 1];
				const z = this.spatialHashGrid._coords[i * 3 + 2];
				const blockId = this.spatialHashGrid._blocks[i];
				
				// Create position key and add to result
				const posKey = `${x},${y},${z}`;
				blocks[posKey] = blockId;
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
		
		// Calculate chunk bounds
		const minX = cx * CHUNK_SIZE;
		const minY = cy * CHUNK_SIZE;
		const minZ = cz * CHUNK_SIZE;
		const maxX = minX + CHUNK_SIZE - 1;
		const maxY = minY + CHUNK_SIZE - 1;
		const maxZ = minZ + CHUNK_SIZE - 1;
		
		// Iterate through all blocks in the binary spatial hash grid
		if (this.spatialHashGrid._blocks && this.spatialHashGrid._coords) {
			for (let i = 0; i < this.spatialHashGrid.size; i++) {
				const x = this.spatialHashGrid._coords[i * 3];
				const y = this.spatialHashGrid._coords[i * 3 + 1];
				const z = this.spatialHashGrid._coords[i * 3 + 2];
				
				// Check if the block is in this chunk
				if (x >= minX && x <= maxX && 
					y >= minY && y <= maxY && 
					z >= minZ && z <= maxZ) {
					
					const blockId = this.spatialHashGrid._blocks[i];
					
					// Create position key and add to result
					const posKey = `${x},${y},${z}`;
					blocks[posKey] = blockId;
				}
			}
		}
		
		return blocks;
	}
	
	/**
	 * Get the number of blocks in the grid
	 * @returns {number} - Number of blocks
	 */
	get size() {
		return this.spatialHashGrid.size;
	}
	
	/**
	 * Check if a block exists at the given coordinates
	 * @param {number} x - X coordinate
	 * @param {number} y - Y coordinate
	 * @param {number} z - Z coordinate
	 * @returns {boolean} True if a block exists at the coordinates
	 */
	hasBlock(x, y, z) {
		if (!this.spatialHashGrid) return false;
		
		// Get block ID at position
		const blockId = this.spatialHashGrid.get(x, y, z);
		
		// Return true if a valid block exists
		return blockId !== null && blockId !== 0;
	}
	
	/**
	 * Get the block ID at the given position
	 * @param {string|number} key - Position key in format "x,y,z" or x coordinate
	 * @param {number} [y] - Y coordinate if first param is x coordinate
	 * @param {number} [z] - Z coordinate if first param is x coordinate
	 * @returns {number|null} - Block ID or null if not found
	 */
	getBlock(key, y, z) {
		if (arguments.length === 3) {
			// x, y, z coordinates provided
			return this.spatialHashGrid.get(key, y, z) || 0;
		} else {
			// Key string provided
			if (typeof key === 'string') {
				const [x, y, z] = key.split(',').map(Number);
				return this.spatialHashGrid.get(x, y, z) || 0;
			}
			return 0;
		}
	}
	
	/**
	 * Set a block at the given position
	 * @param {string|number} key - Position key in format "x,y,z" or x coordinate
	 * @param {number} blockId - Block ID to set or y coordinate if first param is x coordinate
	 * @param {number} [z] - Z coordinate if first param is x coordinate
	 * @param {number} [id] - Block ID if using x,y,z coordinates
	 */
	setBlock(key, blockId, z, id) {
		if (typeof key === 'number' && typeof blockId === 'number' && typeof z === 'number' && id !== undefined) {
			// x, y, z, id coordinates provided
			this.spatialHashGrid.set(key, blockId, z, id);
		} else if (typeof key === 'string' && blockId !== undefined) {
			// Key string provided with blockId
			const [x, y, z] = key.split(',').map(Number);
			this.spatialHashGrid.set(x, y, z, blockId);
		} else {
			console.warn('Invalid parameters for setBlock');
		}
	}
	
	/**
	 * Delete a block at the given position
	 * @param {string|number} key - Position key in format "x,y,z" or x coordinate
	 * @param {number} [y] - Y coordinate if first param is x coordinate
	 * @param {number} [z] - Z coordinate if first param is x coordinate
	 * @returns {boolean} - True if the block was deleted
	 */
	deleteBlock(key, y, z) {
		console.log(`SpatialGridManager.deleteBlock: Deleting block at ${key}`);
		
		if (arguments.length === 3) {
			// x, y, z coordinates provided - use 0 as blockId to remove
			return this.spatialHashGrid.set(key, y, z, 0);
		} else {
			// Key string provided
			if (typeof key === 'string') {
				const [x, y, z] = key.split(',').map(Number);
				return this.spatialHashGrid.set(x, y, z, 0);
			}
			return false;
		}
	}
	
	/**
	 * @deprecated This function is no longer used
	 * The occlusion culling system has been removed
	 */
	isChunkOccluded() {
		return false;
	}
	
	/**
	 * Clear the spatial hash grid completely
	 * This will remove all blocks from the grid
	 */
	clear() {
		console.log("SpatialGridManager: Clearing spatial hash grid");
		if (!this.spatialHashGrid) {
			console.warn("SpatialGridManager: No spatial hash grid to clear");
			return;
		}
		
		// Clear the underlying grid using its clear method
		if (typeof this.spatialHashGrid.clear === 'function') {
			this.spatialHashGrid.clear();
		} 
		// If clear method doesn't exist, recreate the grid
		else {
			console.log("SpatialGridManager: Recreating spatial hash grid");
			this.spatialHashGrid = new SpatialHashGrid({ chunkSize: CHUNK_SIZE });
		}
		
		// Reset metrics
		this.perfMetrics = {
			lastUpdateTime: 0,
			blockCount: 0,
			updateCount: 0
		};
		
		console.log("SpatialGridManager: Spatial hash grid cleared");
	}
	
	/**
	 * Deserialize the grid data from the worker
	 * @param {Object} data - Grid data from worker
	 * @returns {boolean} True if successful
	 */
	deserializeWorkerGrid(data) {
		try {
			const { blockIds, coordinates, hashTable, collisionTable, size, stats, hashConstants } = data;
			
			// Ensure we have all required data
			if (!blockIds || !coordinates || !hashTable || !collisionTable) {
				console.error('SpatialGridManager: Missing data in worker response', data);
		return false;
			}
			
			// Create a new spatial hash grid if it doesn't exist
			if (!this.spatialHashGrid) {
				this.spatialHashGrid = new SpatialHashGrid();
			}
			
			// Validate the arrays before initializing (in case of transfer issues)
			if (!(blockIds instanceof Uint32Array) || 
				!(coordinates instanceof Int32Array) || 
				!(hashTable instanceof Uint32Array) || 
				!(collisionTable instanceof Uint32Array)) {
				console.error('SpatialGridManager: Arrays in worker response are not TypedArrays', {
					blockIds: blockIds?.constructor?.name,
					coordinates: coordinates?.constructor?.name,
					hashTable: hashTable?.constructor?.name,
					collisionTable: collisionTable?.constructor?.name
				});
				
				// Log details about the data to help debug
				console.log('SpatialGridManager: Data details', {
					blockIdsLength: blockIds?.length,
					coordinatesLength: coordinates?.length,
					size
				});
				
				return false;
			}
			
			// Log sample blocks to verify data
			if (size > 0) {
				console.log(`SpatialGridManager: Received grid with ${size} blocks. Sample blocks:`);
				const sampleSize = Math.min(3, size);
				for (let i = 0; i < sampleSize; i++) {
					const x = coordinates[i * 3];
					const y = coordinates[i * 3 + 1];
					const z = coordinates[i * 3 + 2];
					const id = blockIds[i];
					console.log(`  Block ${i}: (${x},${y},${z}) ID=${id}`);
				}
			}
			
			// Initialize the grid with the TypedArrays
			this.spatialHashGrid.initializeFromBinary({
				blockIds,
				coordinates,
				hashTable,
				collisionTable,
				size,
				hashConstants
			});
			
			console.log(`SpatialGridManager: Successfully deserialized worker grid with ${this.spatialHashGrid.size} blocks`);
			return true;
		} catch (error) {
			console.error('SpatialGridManager: Error deserializing worker grid', error);
			return false;
		}
	}
	
	/**
	 * Reset the manager to its initial state
	 * This is useful when loading a new world or switching modes
	 */
	reset() {
		// Reset spatial hash grid
		this.spatialHashGrid.reset();
		
		// Reset properties
		this.isProcessing = false;
		this.lastFrustumUpdate = 0;
		this.chunksInFrustum = new Set();
		
		// Reset performance metrics
		this.perfMetrics = {
			lastUpdateTime: 0,
			blockCount: 0,
			updateCount: 0
		};
		
		console.log("SpatialGridManager: Reset to initial state");
	}
	
	/**
	 * Process blocks with web worker
	 * @param {Array} blocks - Block entries to process
	 * @returns {Promise<boolean>} Promise resolving to true if successful
	 * @private
	 */
	processWithWorker(blocks) {
		return new Promise((resolve) => {
			try {
				console.log(`Processing ${blocks.length} blocks with web worker`);
				
				// Create a new worker for this task
				const worker = new Worker(new URL('../workers/SpatialHashWorker.js', import.meta.url));
				
				// Log start time
				const workerStartTime = performance.now();
				
				// Set up message listener for when worker completes
				worker.onmessage = (event) => {
					const data = event.data;
					
					if (data.error) {
						console.error("Web worker error:", data.error);
						worker.terminate();
						resolve(false);
						return;
					}
					
					if (data.result === 'gridBuilt') {
						// Calculate elapsed time
						const workerElapsedTime = ((performance.now() - workerStartTime) / 1000).toFixed(2);
						console.log(`Web worker processing completed in ${workerElapsedTime}s`);
						
						// Create a new grid if needed
						if (!this.spatialHashGrid) {
							console.warn("SpatialHashGrid not initialized before worker completed");
							this.spatialHashGrid = new SpatialHashGrid();
						}
						
						try {
							// Process the worker data
							const success = this.deserializeWorkerGrid(data);
							
							if (success) {
								console.log(`Spatial hash built with ${this.spatialHashGrid.size} blocks using web worker`);
								
								// Log performance stats
								if (data.stats) {
									console.log(`Worker processed ${data.size.toLocaleString()} blocks in ${data.stats?.processTime?.toFixed(1) || 'unknown'}s`);
								}
							} else {
								console.error("Failed to deserialize worker grid data");
								worker.terminate();
								resolve(false);
								return;
							}
						} catch (error) {
							console.error("Error deserializing worker grid:", error);
							worker.terminate();
							resolve(false);
							return;
						}
						
						// Terminate the worker
						worker.terminate();
						
						console.log(`SpatialGridManager: Successfully deserialized worker grid with ${this.spatialHashGrid.size} blocks`);
						resolve(true);
					}
				};
				
				// Handle worker errors
				worker.onerror = (error) => {
					console.error("Web worker error:", error);
					worker.terminate();
					resolve(false);
				};
				
				// Send the blocks to the worker
				worker.postMessage({
					operation: 'buildGrid',
					blocks: blocks,
					chunkSize: 16
				});
			} catch (error) {
				console.error("Error setting up worker:", error);
				resolve(false);
			}
		});
	}
}

export { SpatialGridManager, SpatialHashGrid }; 