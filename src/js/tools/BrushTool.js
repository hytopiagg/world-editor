/**
 * BrushTool.js - Tool for placing blocks in the world editor with brush functionality
 * 
 * This tool handles block placement with customizable brush size and shape.
 */

import * as THREE from 'three';
import BaseTool from './BaseTool';


class BrushTool extends BaseTool {
	/**
	 * Creates a new BrushTool instance
	 */
	constructor(terrainBuilderProps) {
		console.log('BrushTool initialized');
		super(terrainBuilderProps);

		// Tool properties
		this.name = "BrushTool";
		this.tooltip = "Brush Tool: 1/2 to adjust size. 3 to toggle shape (square/circle). 4 to toggle flat/3D mode. Hold Ctrl to erase.";
		
		// Brush properties
		this.brushSize = 1; // Default size (radius)
		this.isCircular = false; // Default shape is square
		this.isEraseMode = false; // Default mode is place
		this.isPlacing = false; // Tracks active block placement
		this.isFlatMode = true; // Default is flat mode (when set to true, only places blocks at one Y level)
		this.previewMesh = null; // Visual preview of brush area
		this.lastPosition = null; // Last position for drag placement
		this.addedPositions = new Set(); // Track positions where blocks have been added in current drag
		this.removedPositions = new Set(); // Track positions where blocks have been removed in current drag
		this.processedPositionsMap = new Map(); // Track positions processed during drag for efficient lookup
		
		// Performance optimizations
		this.positionCache = new Map(); // Cache brush positions for faster retrieval
		this.lastPreviewPosition = null; // Track last preview position to avoid unnecessary updates
		this.previewGeometry = null; // Reuse preview geometry
		this.previewMaterialAdd = null; // Reuse preview material for add mode
		this.previewMaterialErase = null; // Reuse preview material for erase mode
		
		// Mesh update optimizations
		this.chunkUpdateQueue = new Set(); // Track chunks that need updates
		this.debounceTimer = null; // Timer for debouncing mesh updates
		this.DEBOUNCE_DELAY = 50; // Milliseconds to wait before triggering a mesh rebuild
		this.dirtyChunks = new Map(); // Map of chunks with pending updates
		this.processingChunks = new Set(); // Track chunks currently being processed

		// Batch processing for smoother performance
		this.batchSize = 10; // Number of blocks to process in each batch
		this.updateInterval = 50; // Milliseconds between batch updates
		this.pendingBatch = { added: {}, removed: {} }; // Blocks waiting to be processed
		this.lastBatchTime = 0; // Last time a batch was processed

		// Performance tuning for large maps
		this.batchInterval = 300; // Increased from 200ms to reduce update frequency for large maps 
		this.chunkUpdateDelay = 100; // Increased from 50ms to reduce update frequency for large maps
		this.processedPositionsThreshold = 10000; // Clear processed positions map when it gets too large
		
		// Detect if we're on a large map
		this.isLargeMap = false;
		// Will be set to true if terrain has more than this many blocks
		this.largeMapThreshold = 50000;
		
		// Initialize default values
		this.lastPosition = new THREE.Vector3(-999, -999, -999);
		
		// Get references from terrainBuilder
		if (terrainBuilderProps) {
			this.terrainRef = terrainBuilderProps.terrainRef;
			this.currentBlockTypeRef = terrainBuilderProps.currentBlockTypeRef;
			this.scene = terrainBuilderProps.scene;
			this.toolManagerRef = terrainBuilderProps.toolManagerRef;
			this.terrainBuilderRef = terrainBuilderProps.terrainBuilderRef;
			
			// Add undoRedoManager reference
			this.undoRedoManager = terrainBuilderProps.undoRedoManager;
		
			// Direct access to saveUndo function
			this.saveUndoFunction = terrainBuilderProps.saveUndoFunction;
		
			this.placementChangesRef = terrainBuilderProps.placementChangesRef;
			this.isPlacingRef = terrainBuilderProps.isPlacingRef;
			this.previewPositionRef = terrainBuilderProps.previewPositionRef;
			this.modeRef = terrainBuilderProps.modeRef;
			this.importedUpdateTerrainBlocks = terrainBuilderProps.importedUpdateTerrainBlocks;
			this.getPlacementPositions = terrainBuilderProps.getPlacementPositions;
			this.updateSpatialHashForBlocks = terrainBuilderProps.updateSpatialHashForBlocks;
			
			// Get references for total block count updates
			if (terrainBuilderProps.totalBlocksRef) {
				this.totalBlocksRef = terrainBuilderProps.totalBlocksRef;
			}
			if (terrainBuilderProps.sendTotalBlocks) {
				this.sendTotalBlocks = terrainBuilderProps.sendTotalBlocks;
			}
			
			// Store reference to method that rebuilds chunk meshes
			if (this.terrainBuilderRef && this.terrainBuilderRef.current) {
				// Try to grab the forceRebuildSpatialHash method directly
				if (typeof this.terrainBuilderRef.current.forceRefreshAllChunks === 'function') {
					this.forceRefreshAllChunks = this.terrainBuilderRef.current.forceRefreshAllChunks.bind(this.terrainBuilderRef.current);
				}
			}
			
			// Apply safe brush size to ensure we start with a valid size
			this.brushSize = this.getSafeBrushSize(this.brushSize);
			
			// Set a global reference for tools
			window.activeTool = this.name;
		} else {
			console.error('BrushTool: terrainBuilderProps is undefined in constructor');
		}
		
		// Initialize reusable preview objects
		this.initializePreviewObjects();
	}

	onActivate() {
		super.onActivate();

		// Log activation details for debugging
		console.log('BrushTool activated');
	
		// Initialize empty objects if needed
		if (this.terrainRef && !this.terrainRef.current) {
			console.log('Initializing empty terrainRef.current in onActivate');
			this.terrainRef.current = {};
		}

		// Reset state on activation
		this.isPlacing = false;
		this.lastPosition = null;
		this.addedPositions.clear();
		this.removedPositions.clear();
		this.processedPositionsMap.clear();
		this.removeBrushPreview();
		
		// Reset tracking state to ensure clean activation
		if (this.isPlacingRef) {
			this.isPlacingRef.current = false;
		}
		
		// Reset placement changes to ensure we don't have leftover changes
		if (this.placementChangesRef) {
			this.placementChangesRef.current = { 
				terrain: { added: {}, removed: {} }, 
				environment: { added: [], removed: [] } 
			};
		}
		
		// Initialize reusable preview objects
		this.initializePreviewObjects();
		
		// Detect if we're on a large map and adjust settings accordingly
		if (this.terrainRef && this.terrainRef.current) {
			const blockCount = Object.keys(this.terrainRef.current).length;
			this.isLargeMap = blockCount > this.largeMapThreshold;
			
			if (this.isLargeMap) {
				console.log(`BrushTool: Detected large map with ${blockCount} blocks, optimizing performance settings`);
				// Increase batch interval for large maps
				this.batchInterval = 500; // Increase batch interval
				this.chunkUpdateDelay = 200; // Increase delay between chunk updates
				// Reduce frequency of position tracking for large maps
				this.placementThreshold = Math.max(this.brushSize * 0.4, 0.5);
			} else {
				// Regular settings for normal-sized maps
				this.batchInterval = 300;
				this.chunkUpdateDelay = 100;
				this.placementThreshold = Math.max(this.brushSize * 0.15, 0.2);
			}
		}
	}
	
	/**
	 * Initialize reusable preview objects for better performance
	 */
	initializePreviewObjects() {
		// Create reusable preview materials if they don't exist
		if (!this.previewMaterialAdd) {
			this.previewMaterialAdd = new THREE.MeshBasicMaterial({
				color: 0x4e8eff, // Blue
				transparent: true, 
				opacity: 0.5,
				depthTest: true,
				depthWrite: false
			});
		}
		
		if (!this.previewMaterialErase) {
			this.previewMaterialErase = new THREE.MeshBasicMaterial({
				color: 0xff4e4e, // Red
				transparent: true, 
				opacity: 0.5,
				depthTest: true,
				depthWrite: false
			});
		}
	}

	onDeactivate() {
		super.onDeactivate();
		this.removeBrushPreview();
		this.isPlacing = false;
		this.lastPosition = null;
		this.addedPositions.clear();
		this.removedPositions.clear();
		this.processedPositionsMap.clear();
		
		// Clear position cache on deactivation to free memory
		this.positionCache.clear();
		this.lastPreviewPosition = null;
		
		// Clear any pending chunk updates
		this.clearChunkUpdates();
	}

	/**
	 * Clear any pending chunk updates
	 */
	clearChunkUpdates() {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		this.chunkUpdateQueue.clear();
		this.dirtyChunks.clear();
		this.processingChunks.clear();
	}

	/**
	 * Queue a chunk for update with debouncing to reduce rebuilds
	 * @param {Object} position - Position within the chunk to update
	 * @param {String} action - 'add' or 'remove'
	 */
	queueChunkUpdate(position, action) {
		// Calculate chunk coordinates using the utility method to ensure valid chunk origins
		const chunkOrigin = this.ensureValidChunkOrigin(position);
		const chunkKey = `${chunkOrigin.x},${chunkOrigin.y},${chunkOrigin.z}`;
		
		// Skip if this chunk is currently being processed
		if (this.processingChunks && this.processingChunks.has(chunkKey)) {
			// console.log(`BrushTool: Skipping chunk ${chunkKey} as it's currently being processed`);
			return;
		}
		
		// Add to the update queue
		this.chunkUpdateQueue.add(chunkKey);
		
		// Track changes for this chunk
		if (!this.dirtyChunks.has(chunkKey)) {
			this.dirtyChunks.set(chunkKey, { adds: new Set(), removes: new Set() });
		}
		
		// Record the specific change
		const posKey = `${position.x},${position.y},${position.z}`;
		if (action === 'add') {
			this.dirtyChunks.get(chunkKey).adds.add(posKey);
		} else if (action === 'remove') {
			this.dirtyChunks.get(chunkKey).removes.add(posKey);
		}
		
		// Debounce the update to avoid excessive rebuilds
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
		
		this.debounceTimer = setTimeout(() => {
			this.processChunkUpdates();
		}, this.DEBOUNCE_DELAY);
	}
	
	/**
	 * Process all queued chunk updates
	 */
	processChunkUpdates() {
		if (!this.chunkUpdateQueue || this.chunkUpdateQueue.size === 0) {
			return;
		}
		
		// Get the number of chunks to update
		const chunkCount = this.chunkUpdateQueue.size;
		
		// Limit the number of chunks processed at once to prevent lag
		// More conservative limits for large maps
		const MAX_CHUNKS_PER_UPDATE = this.isLargeMap ? 2 : 4; // Reduced from 3/5 to 2/4
		
		// If we have too many chunks, process them in batches
		if (chunkCount > MAX_CHUNKS_PER_UPDATE && typeof setTimeout === 'function') {
			const chunkKeysArray = Array.from(this.chunkUpdateQueue);
			
			// On large maps, prioritize chunks near the camera
			if (this.terrainBuilderRef?.current?.threeCamera) {
				const camera = this.terrainBuilderRef.current.threeCamera;
				const cameraPos = camera.position;
				
				// Calculate distances from camera to each chunk
				const chunksWithDistances = chunkKeysArray.map(chunkKey => {
					const [x, y, z] = chunkKey.split(',').map(Number);
					// Convert to chunk center coordinates
					const centerX = x * 16 + 8;
					const centerY = y * 16 + 8;
					const centerZ = z * 16 + 8;
					// Calculate squared distance (faster than using Math.sqrt)
					const distSq = (centerX - cameraPos.x) ** 2 + 
								  (centerY - cameraPos.y) ** 2 + 
								  (centerZ - cameraPos.z) ** 2;
					return { chunkKey, distSq };
				});
				
				// Sort chunks by distance to camera (closest first)
				chunksWithDistances.sort((a, b) => a.distSq - b.distSq);
				
				// Extract sorted chunk keys
				const sortedChunkKeys = chunksWithDistances.map(c => c.chunkKey);
				
				// Process closest chunks first - but limit to fewer chunks
				const firstBatch = sortedChunkKeys.slice(0, MAX_CHUNKS_PER_UPDATE);
				const remainingChunks = sortedChunkKeys.slice(MAX_CHUNKS_PER_UPDATE);
				
				// Process first batch immediately
				this.updateChunkBatch(firstBatch);
				
				// Clear the queue immediately to prevent double processing
				this.chunkUpdateQueue.clear();
				
				// Process remaining chunks after a delay - only if there aren't too many
				if (remainingChunks.length > 0) {
					setTimeout(() => {
						// On large maps, limit the number of deferred chunks even more
						if (this.isLargeMap && remainingChunks.length > 5) { // Reduced from 10 to 5
							console.log(`BrushTool: Limiting deferred chunks from ${remainingChunks.length} to 5 for performance reasons`);
							// Just process the 5 closest chunks
							const closestChunks = new Set(remainingChunks.slice(0, 5));
							this.chunkUpdateQueue = closestChunks;
						} else {
							this.chunkUpdateQueue = new Set(remainingChunks);
						}
						
						this.processChunkUpdates();
					}, this.isLargeMap ? 150 : 75); // Increased delay
				}
				
				return;
			}
			
			// Standard processing for normal maps or when camera isn't available
			const firstBatch = chunkKeysArray.slice(0, MAX_CHUNKS_PER_UPDATE);
			const remainingChunks = chunkKeysArray.slice(MAX_CHUNKS_PER_UPDATE);
			
			// Process first batch immediately
			this.updateChunkBatch(firstBatch);
			
			// Clear the queue immediately to prevent double processing
			this.chunkUpdateQueue.clear();
			
			// Process remaining chunks with a delay
			if (remainingChunks.length > 0) {
				setTimeout(() => {
					// Limit remaining chunks for large maps
					if (this.isLargeMap && remainingChunks.length > 5) {
						const limitedChunks = remainingChunks.slice(0, 5);
						console.log(`BrushTool: Processing ${limitedChunks.length} deferred chunks (limited from ${remainingChunks.length})`);
						this.chunkUpdateQueue = new Set(limitedChunks);
					} else {
						console.log(`BrushTool: Processing ${remainingChunks.length} deferred chunks`);
						this.chunkUpdateQueue = new Set(remainingChunks);
					}
					this.processChunkUpdates();
				}, this.isLargeMap ? 150 : 75); // Increased delay
			}
			
			return;
		}
		
		// Process all chunks at once if we're below the threshold
		const chunkKeys = Array.from(this.chunkUpdateQueue);
		this.updateChunkBatch(chunkKeys);
		
		// Clear the tracked updates
		this.chunkUpdateQueue.clear();
	}

	/**
	 * Update a batch of chunks
	 * @param {Array} chunkKeys - Array of chunk keys to update
	 */
	updateChunkBatch(chunkKeys) {
		if (!chunkKeys || chunkKeys.length === 0) {
			return;
		}
		
		// For very large maps, be even more conservative with chunk updates
		const MAX_CHUNKS = this.isLargeMap ? 3 : 5; // Reduced from 20 to 3 for large maps
		
		// Only update the chunks that absolutely need it
		let chunksToUpdate = chunkKeys;
		
		if (chunkKeys.length > MAX_CHUNKS) {
			console.log(`BrushTool: Limiting chunk update from ${chunkKeys.length} to ${MAX_CHUNKS} chunks to improve performance`);
			
			// Sort by distance to camera if possible
			if (this.terrainBuilderRef?.current?.threeCamera) {
				const camera = this.terrainBuilderRef.current.threeCamera;
				const cameraPos = camera.position;
				
				// Calculate chunk centers and distances to camera
				const chunksWithDistances = chunkKeys.map(chunkKey => {
					const [x, y, z] = chunkKey.split(',').map(Number);
					// Calculate chunk center (assuming 16×16×16 chunks)
					const centerX = x * 16 + 8;
					const centerY = y * 16 + 8;
					const centerZ = z * 16 + 8;
					
					// Calculate distance to camera
					const distSq = (centerX - cameraPos.x) ** 2 + 
								   (centerY - cameraPos.y) ** 2 + 
								   (centerZ - cameraPos.z) ** 2;
					
					return { chunkKey, distSq };
				});
				
				// Sort by distance (closest first)
				chunksWithDistances.sort((a, b) => a.distSq - b.distSq);
				
				// Take only the closest chunks
				chunksToUpdate = chunksWithDistances.slice(0, MAX_CHUNKS).map(c => c.chunkKey);
			} else {
				// If we can't sort by distance, just take the first MAX_CHUNKS
				chunksToUpdate = chunkKeys.slice(0, MAX_CHUNKS);
			}
			
			// Queue the remaining chunks with a longer delay to spread out the work
			const remainingChunks = chunkKeys.filter(key => !chunksToUpdate.includes(key));
			if (remainingChunks.length > 0) {
				setTimeout(() => {
					console.log(`BrushTool: Queueing ${remainingChunks.length} additional chunks with delay`);
					// Only queue up to MAX_CHUNKS additional chunks to prevent lag
					const nextBatch = remainingChunks.slice(0, MAX_CHUNKS);
					this.chunkUpdateQueue = new Set(nextBatch);
					this.processChunkUpdates();
				}, this.isLargeMap ? 200 : 100); // Longer delay for large maps
			}
		}
		
		// Use the directly imported forceChunkUpdate instead of trying to access it through TerrainBuilder
		if (this.terrainBuilderRef && this.terrainBuilderRef.current) {
			// Check if the method exists on the terrainBuilderRef object
			if (this.terrainBuilderRef.current.forceChunkUpdate) {
				console.log(`ChunkSystem: Forcing update for ${chunksToUpdate.length} chunks (skipping neighbors)`);
				this.terrainBuilderRef.current.forceChunkUpdate(chunksToUpdate, { 
					skipNeighbors: true, // Skip neighbors for better performance
					frustumCulled: true,  // Only update chunks in view
					deferMeshBuilding: this.isLargeMap // Defer mesh building for large maps
				});
			} else {
				console.warn('BrushTool: terrainBuilderRef.current.forceChunkUpdate is not available, falling back to forceRefreshAllChunks');
				// Fall back to refreshing all chunks as a last resort
				if (this.terrainBuilderRef.current.forceRefreshAllChunks) {
					this.terrainBuilderRef.current.forceRefreshAllChunks();
				}
			}
		}
	}

	/**
	 * Add blocks to the pending batch for optimized processing
	 * @param {Object} blocks - Object containing block data keyed by position
	 * @param {Boolean} isRemoval - Whether these are blocks to be removed
	 */
	addToPendingBatch(blocks, isRemoval = false) {
		if (!blocks || Object.keys(blocks).length === 0) {
			return;
		}
		
		// Add to the appropriate collection in the pending batch
		const batchCollection = isRemoval ? this.pendingBatch.removed : this.pendingBatch.added;
		
		// Add each block to the batch
		for (const [posKey, blockId] of Object.entries(blocks)) {
			batchCollection[posKey] = blockId;
		}
		
		// If this is the first addition, initialize the timer
		if (this.lastBatchTime === 0) {
			this.lastBatchTime = performance.now();
		}
	}

	/**
	 * Process any pending batches of blocks
	 */
	processPendingBatch() {
		const hasAdded = Object.keys(this.pendingBatch.added).length > 0;
		const hasRemoved = Object.keys(this.pendingBatch.removed).length > 0;
		
		if (!hasAdded && !hasRemoved) {
			return;
		}
		
		// Don't update the total block count or send updates for each small batch
		// This will be done in handleMouseUp instead to reduce overhead
		
		// Use imported fast update method for better performance
		if (this.importedUpdateTerrainBlocks) {
			this.importedUpdateTerrainBlocks(
				this.pendingBatch.added, 
				this.pendingBatch.removed, 
				{ 
					skipSpatialHash: true,  // Always skip spatial hash during painting for performance
					skipUndoSave: true      // Skip saving to undo during painting, will be done once at the end
				}
			);
		} else if (this.terrainBuilderRef && this.terrainBuilderRef.current) {
			// Fallback to standard update method
			this.terrainBuilderRef.current.updateTerrainBlocks(
				this.pendingBatch.added, 
				this.pendingBatch.removed, 
				{ 
					skipSpatialHash: true,  // Always skip spatial hash during painting for performance
					skipUndoSave: true      // Skip saving to undo during painting, will be done once at the end
				}
			);
		}
		
		// Clear the pending batch
		this.pendingBatch = { added: {}, removed: {} };
	}

	/**
	 * Handles mouse down events for brush placement
	 */
	handleMouseDown(event, position, button) {
		// Safety check - if position is undefined, we can't do anything
		if (!position) {
			console.error('BrushTool: position is undefined in handleMouseDown');
			return;
		}

		// Only handle left mouse button (button 0)
		if (button !== undefined && button !== 0) {
			return;
		}

		// Make sure the terrain reference is valid before placing
		if (!this.terrainRef || !this.terrainRef.current) {
			console.error('BrushTool: terrainRef is undefined or empty when attempting to place blocks');
			return;
		}

		// Start placement tracking for undo/redo
		if (this.isPlacingRef) {
			this.isPlacingRef.current = true;
		}
		
		// Make sure placement changes are initialized
		if (this.placementChangesRef) {
			this.placementChangesRef.current = { 
				terrain: { added: {}, removed: {} }, 
				environment: { added: [], removed: [] } 
			};
		} else {
			console.warn('BrushTool: placementChangesRef is not available, changes won\'t be tracked for undo/redo');
		}

		// Use the previewPositionRef from TerrainBuilder which has the correct green cursor position
		let finalPosition;
		if (this.previewPositionRef && this.previewPositionRef.current) {
			// Use the position from the standard green cursor
			finalPosition = this.previewPositionRef.current;
		} else {
			// Fallback to manual calculation if previewPositionRef isn't available
			console.warn('BrushTool: previewPositionRef not available, using less accurate positioning');
			
			// Process position to match standard cursor calculation
			const processedPosition = { 
				x: position.x,
				y: position.y,
				z: position.z
			};

			// Get normal from the event if it exists
			const normal = event.normal || { x: 0, y: 1, z: 0 }; 
			
			// Add normal * 0.5 to position
			processedPosition.x += normal.x * 0.5;
			processedPosition.y += normal.y * 0.5;
			processedPosition.z += normal.z * 0.5;
			
			// Round X and Z, but FLOOR the Y coordinate
			processedPosition.x = Math.round(processedPosition.x);
			processedPosition.y = Math.floor(processedPosition.y);
			processedPosition.z = Math.round(processedPosition.z);
			
			finalPosition = processedPosition;
		}

		// Start block placement or erasure
		this.isPlacing = true;
		this.lastPosition = new THREE.Vector3(finalPosition.x, finalPosition.y, finalPosition.z);
		this.addedPositions.clear();
		this.removedPositions.clear();
		
		// Perform the placement or erasure
		if (this.isEraseMode) {
			this.eraseBlocksAtPosition(finalPosition);
		} else {
			this.placeBlocksAtPosition(finalPosition);
		}
	}

	/**
	 * Handles mouse move events for brush placement
	 */
	handleMouseMove(event, position) {
		// Safety check
		if (!position) return;

		// Instead of calculating our own position, use the previewPositionRef from TerrainBuilder
		// which already has the correct position calculation logic
		if (this.previewPositionRef && this.previewPositionRef.current) {
			// Use the previewPositionRef position which matches the green cursor exactly
			const cursorPosition = this.previewPositionRef.current;
			
			// Only update the brush preview if it's not too expensive
			if (!this.isLargeMap || !this.isPlacing) {
				this.updateBrushPreview(cursorPosition);
			}

			// Process any pending updates to keep the UI responsive
			// This ensures we don't wait too long between updates during fast movements
			const now = performance.now();
			if (now - this.lastBatchTime > this.updateInterval && 
				(Object.keys(this.pendingBatch.added).length > 0 || Object.keys(this.pendingBatch.removed).length > 0)) {
				this.processPendingBatch();
				this.lastBatchTime = now;
			}

			// If we're placing blocks and the mouse is down, handle continuous placement
			if (this.isPlacing && this.lastPosition) {
				// Check if left mouse button is still pressed (as a safety measure)
				if (event.buttons !== undefined && (event.buttons & 1) === 0) {
					this.isPlacing = false;
					this.handleMouseUp(event, cursorPosition, 0);
					return;
				}
				
				// For performance, only place blocks if position has changed significantly
				// Convert cursor position to Vector3 for distance calculation
				const positionVector = new THREE.Vector3(
					cursorPosition.x, 
					cursorPosition.y, 
					cursorPosition.z
				);
				
				// Calculate distance moved and compare to a threshold based on brush size
				// Smaller brush = smaller steps needed for good coverage
				// This threshold is now set in onActivate based on map size
				const distanceMoved = positionVector.distanceTo(this.lastPosition);
				
				if (
					// Either position has changed in integer coordinates
					!this.lastPosition.equals(positionVector) && 
					// And we've moved far enough for a new placement
					distanceMoved >= this.placementThreshold
				) {
					// Place or erase blocks based on current mode
					if (this.isEraseMode) {
						this.eraseBlocksAtPosition(cursorPosition);
					} else {
						this.placeBlocksAtPosition(cursorPosition);
					}
					
					// Update last position
					this.lastPosition.copy(positionVector);
					
					// On large maps, periodically clear the processed positions map to prevent memory issues
					if (this.isLargeMap && this.processedPositionsMap.size > this.processedPositionsThreshold) {
						console.log(`BrushTool: Clearing processed positions map (size: ${this.processedPositionsMap.size})`);
						this.processedPositionsMap.clear();
					}
				}
			}
		} else {
			// Fallback to old behavior if previewPositionRef isn't available
			console.warn('BrushTool: previewPositionRef not available, using less accurate positioning');
			
			// Process position to match exactly how the standard green cursor calculates it
			const processedPosition = { 
				x: position.x,
				y: position.y,
				z: position.z
			};

			// Get normal from the event if it exists
			const normal = event.normal || { x: 0, y: 1, z: 0 }; 
			
			// Add normal * 0.5 to position
			processedPosition.x += normal.x * 0.5;
			processedPosition.y += normal.y * 0.5;
			processedPosition.z += normal.z * 0.5;
			
			// Round X and Z, but FLOOR the Y coordinate 
			processedPosition.x = Math.round(processedPosition.x);
			processedPosition.y = Math.floor(processedPosition.y);
			processedPosition.z = Math.round(processedPosition.z);
			
			// Update brush preview
			this.updateBrushPreview(processedPosition);
		}
	}

	/**
	 * Handles mouse up events for brush placement
	 */
	handleMouseUp(event, position, button) {
		// Only handle left mouse button (button 0)
		if (button !== undefined && button !== 0) {
			return;
		}

		// Process any remaining blocks in the batch
		this.processPendingBatch();

		// Log the outcome of the operation
		const addedCount = this.addedPositions.size;
		const removedCount = this.removedPositions.size;
		
		if (addedCount > 0 || removedCount > 0) {
			console.log(`BrushTool: Completed operation - Added: ${addedCount} blocks, Removed: ${removedCount} blocks`);
		}

		// Update total block count at the end of the operation
		if (this.totalBlocksRef) {
			this.totalBlocksRef.current = Object.keys(this.terrainRef.current).length;
			
			// Send total blocks count back to parent component
			if (this.sendTotalBlocks) {
				this.sendTotalBlocks(this.totalBlocksRef.current);
			}
		}
		// Fallback to terrainBuilderRef if direct references aren't available
		else if (this.terrainBuilderRef?.current?.totalBlocksRef) {
			this.terrainBuilderRef.current.totalBlocksRef.current = Object.keys(this.terrainRef.current).length;
			
			// Send total blocks count back to parent component
			if (this.terrainBuilderRef.current.sendTotalBlocks) {
				this.terrainBuilderRef.current.sendTotalBlocks(this.terrainBuilderRef.current.totalBlocksRef.current);
			}
		}

		// Only proceed with spatial hash update if blocks were added or removed
		if ((addedCount > 0 || removedCount > 0) && this.terrainBuilderRef && this.terrainBuilderRef.current) {
			// For large maps, we need to be more careful with spatial hash updates
			
			/*
			if (this.isLargeMap && (addedCount + removedCount) > 1000) {
				console.log(`BrushTool: Large update detected (${addedCount + removedCount} blocks), optimizing spatial hash update`);
				
				// For very large operations, just do a full rebuild which can be more efficient
				if (typeof this.terrainBuilderRef.current.forceRebuildSpatialHash === 'function') {
					this.terrainBuilderRef.current.forceRebuildSpatialHash({
						showLoadingScreen: false,
						force: true,
						visibleOnly: true // Only update visible blocks for large maps
					});
				}
			} else {
			 */
				// For smaller operations, use the incremental update
				// Prepare optimized data structures for spatial hash update
				const addedBlocks = addedCount > 0 ? Array.from(this.addedPositions).map(posKey => {
					const [x, y, z] = posKey.split(',').map(Number);
					const blockId = this.terrainRef.current[posKey];
					return { id: blockId, position: [x, y, z] };
				}) : [];
				
				const removedBlocks = removedCount > 0 ? Array.from(this.removedPositions).map(posKey => {
					const [x, y, z] = posKey.split(',').map(Number);
					return { id: 0, position: [x, y, z] };
				}) : [];
				
				// Define options for spatial hash update
				const updateOptions = { 
					force: true,
					skipIfBusy: false, // Ensure this update happens even if another update is in progress
					silent: this.isLargeMap, // Only log if not a large map
					batchSize: this.isLargeMap ? 1000 : 100 // Use larger batch size for large maps
				};
				
				// Use the most efficient update method available
				if (typeof this.terrainBuilderRef.current.updateSpatialHashForBlocks === 'function') {
					this.terrainBuilderRef.current.updateSpatialHashForBlocks(addedBlocks, removedBlocks, updateOptions);
				}
				// Fallback to local reference if available
				else if (typeof this.updateSpatialHashForBlocks === 'function') {
					this.updateSpatialHashForBlocks(addedBlocks, removedBlocks, updateOptions);
				}
				// Last resort - use full rebuild if incremental update not available
				else if (typeof this.terrainBuilderRef.current.forceRebuildSpatialHash === 'function') {
					this.terrainBuilderRef.current.forceRebuildSpatialHash({
						showLoadingScreen: false,
						force: true
					});
				} else {
					console.warn('BrushTool: No spatial hash update method found');
				}
			}
		//}

		// Process any pending chunk updates with a small delay to reduce lag
		// For large maps, use a bigger delay to prevent UI freezing
		if (this.chunkUpdateQueue && this.chunkUpdateQueue.size > 0) {
			const delay = this.isLargeMap ? this.chunkUpdateDelay * 2 : this.chunkUpdateDelay;
			setTimeout(() => {
				this.processChunkUpdates();
			}, delay);
		}

		// Finish placement and notify the undo/redo manager
		if (this.isPlacingRef) {
			this.isPlacingRef.current = false;
		}

		// Save changes to undo stack if there are any changes
		if (this.placementChangesRef?.current) {
			const changes = this.placementChangesRef.current;
			
			// Check if we have changes to save
			const hasChanges = 
				Object.keys(changes.terrain.added || {}).length > 0 || 
				Object.keys(changes.terrain.removed || {}).length > 0 ||
				(changes.environment.added || []).length > 0 ||
				(changes.environment.removed || []).length > 0;
				
			if (hasChanges) {
				console.log("Saving changes to undo stack");
				
				// Try using direct undoRedoManager reference
				if (this.undoRedoManager?.current?.saveUndo) {
					this.undoRedoManager.current.saveUndo(changes);
				}
				else if (this.terrainBuilderRef?.current?.undoRedoManager?.current?.saveUndo) {
					this.terrainBuilderRef.current.undoRedoManager.current.saveUndo(changes);
				}
				else {
					console.warn('BrushTool: No undoRedoManager available, changes won\'t be tracked for undo/redo');
				}
				
				// Reset placement changes after saving
				this.placementChangesRef.current = { 
					terrain: { added: {}, removed: {} }, 
					environment: { added: [], removed: [] } 
				};
			}
		}

		// Clear tracking variables
		this.isPlacing = false;
		this.lastPosition = null;
		this.addedPositions.clear();
		this.removedPositions.clear();

		// Set a small timeout to make sure batch processing is complete before allowing new ones
		setTimeout(() => {
			this.lastBatchTime = 0;
		}, this.batchInterval / 2);
	}

	/**
	 * Handles key down events
	 */
	handleKeyDown(event) {
		// Check for Control key
		if (event.key === 'Control') {
			this.isEraseMode = true;
			
			// Update the preview to reflect erase mode
			if (this.previewPositionRef && this.previewPositionRef.current) {
				this.updateBrushPreview(this.previewPositionRef.current);
			}
			return;
		}
		
		// Updated control scheme:
		// 1: Decrease brush size
		// 2: Increase brush size
		// 3: Toggle shape (square/circle)
		// 4: Toggle flat (Y height = 1) / 3D (full height)
		
		// Handle size adjustments
		if (event.key === '1') {
			// Decrease size (minimum 1)
			const newSize = Math.max(1, this.brushSize - 1);
			if (newSize !== this.brushSize) {
				this.brushSize = newSize;
				console.log(`BrushTool: Size decreased to ${this.brushSize}`);
				this.positionCache.clear();
			}
		}
		else if (event.key === '2') {
			// Increase size (with safe maximum)
			const newSize = this.brushSize + 1;
			const safeSize = this.getSafeBrushSize(newSize);
			
			if (safeSize !== this.brushSize) {
				this.brushSize = safeSize;
				console.log(`BrushTool: Size increased to ${this.brushSize}`);
				this.positionCache.clear();
				
				// Notify if the size was capped
				if (safeSize !== newSize) {
					console.warn(`BrushTool: Size was limited to ${safeSize} to prevent chunk boundary issues`);
				}
			}
		}
		// Toggle shape (square/circle)
		else if (event.key === '3') {
			this.isCircular = !this.isCircular;
			console.log(`BrushTool: Shape changed to ${this.isCircular ? 'circle' : 'square'}`);
			this.positionCache.clear();
		}
		// Toggle flat/3D mode
		else if (event.key === '4') {
			this.isFlatMode = !this.isFlatMode;
			console.log(`BrushTool: Mode changed to ${this.isFlatMode ? 'flat' : '3D'}`);
			this.positionCache.clear();
		}
		
		// Update the preview after any changes
		if (['1', '2', '3', '4'].includes(event.key) && this.previewPositionRef && this.previewPositionRef.current) {
			this.updateBrushPreview(this.previewPositionRef.current);
		}
	}

	/**
	 * Get a safe brush size that won't cause out-of-bounds errors
	 * @param {number} requestedSize - The requested brush size
	 * @returns {number} - A safe brush size
	 */
	getSafeBrushSize(requestedSize) {
		// The maximum safe size is determined by the chunk size
		// Since we want to avoid out-of-bounds errors when placing blocks near chunk boundaries,
		// we need to limit the brush radius to less than half the chunk size
		
		const CHUNK_SIZE = 16; // Standard chunk size
		const MAX_SAFE_RADIUS = Math.floor(CHUNK_SIZE / 4); // Conservative limit to prevent issues
		
		// Cap the brush size to the maximum safe radius
		return Math.min(requestedSize, MAX_SAFE_RADIUS);
	}

	/**
	 * Handles key up events
	 */
	handleKeyUp(event) {
		// Check for Control key release
		if (event.key === 'Control') {
			this.isEraseMode = false;
			
			// Update the preview to reflect place mode
			if (this.previewPositionRef && this.previewPositionRef.current) {
				this.updateBrushPreview(this.previewPositionRef.current);
			}
		}
	}

	/**
	 * Check if coordinates are valid for block placement
	 * @param {Object} position - Position to validate
	 * @returns {boolean} - True if the position is valid
	 */
	isValidBlockPosition(position) {
		// Check if position is defined
		if (!position || typeof position.x !== 'number' || typeof position.y !== 'number' || typeof position.z !== 'number') {
			return false;
		}
		
		// Check if coordinates are within valid bounds
		// The valid range would typically depend on your chunk system implementation
		// For example, if using 16-bit integers, the range would be -32768 to 32767
		// Use a conservative range to ensure we're within valid chunk bounds
		const MAX_COORDINATE = 4000; // Use a reasonable limit
		
		return position.x >= -MAX_COORDINATE && position.x <= MAX_COORDINATE &&
			   position.y >= -MAX_COORDINATE && position.y <= MAX_COORDINATE &&
			   position.z >= -MAX_COORDINATE && position.z <= MAX_COORDINATE;
	}

	/**
	 * Check if the position is valid for the chunk system
	 * This is a more specific validation than isValidBlockPosition
	 * @param {Object} position - Position to validate
	 * @returns {boolean} - True if the position is valid for chunk placement
	 */
	isValidForChunk(position) {
		// First do basic position validation
		if (!this.isValidBlockPosition(position)) {
			return false;
		}
		
		// Import what we know about chunks from the error message
		// The coordinates are still within valid range, we just need to ensure
		// they're properly aligned with chunk boundaries
		
		// This method should always return true as we'll let the chunk system handle
		// the block alignment. The error was happening because we were trying to directly
		// manipulate local chunk coordinates, but we should be working with global coordinates.
		return true;
	}

	/**
	 * Places blocks at the specified position using the brush shape and size
	 * @param {Object} position - The position to place blocks at
	 * @returns {Number} - The number of blocks placed
	 */
	placeBlocksAtPosition(position) {
		const currentBlockTypeId = this.getCurrentBlockTypeId();
		if (!currentBlockTypeId) {
			console.error('BrushTool: No current block type id');
			return 0;
		}

		// Skip if terrain reference is missing
		if (!this.terrainRef || !this.terrainRef.current) {
			console.error('BrushTool: terrainRef is undefined or null');
			return 0;
		}

		// Get the brush positions
		const brushPositions = this.getBrushPositions(position);
		
		// Track how many blocks we actually place (excluding existing blocks)
		let placedCount = 0;
		
		// Batch these blocks to minimize updates
		const blocksToAdd = {};
		
		// Store chunk keys that need updating to avoid redundant queue calls
		const affectedChunks = new Set();
		
		// Process each position in the brush area
		for (const brushPos of brushPositions) {
			// Only place if the position doesn't already have this block type
			const posKey = `${brushPos.x},${brushPos.y},${brushPos.z}`;
			
			// Skip if we've already processed this position in the current operation
			if (this.processedPositionsMap.has(posKey)) {
				continue;
			}
			
			// Check if position already has a block
			const existingBlockId = this.terrainRef.current[posKey];
			if (existingBlockId === currentBlockTypeId) {
				continue; // Skip if same block type already exists
			}
			
			// Update the terrain data structure - CRITICAL FOR SPATIAL HASH
			this.terrainRef.current[posKey] = currentBlockTypeId;
			
			// Add this block to the batch
			blocksToAdd[posKey] = currentBlockTypeId;
			
			// Track for undo/redo
			if (this.placementChangesRef && this.placementChangesRef.current) {
				// If this position had a different block, record it as removed for undo
				if (existingBlockId !== undefined && existingBlockId !== 0) {
					this.placementChangesRef.current.terrain.removed[posKey] = existingBlockId;
				}
				
				// Record the added block
				this.placementChangesRef.current.terrain.added[posKey] = currentBlockTypeId;
			}
			
			// Mark this position as processed
			this.processedPositionsMap.set(posKey, true);
			
			// Track for spatial hash update on mouse up
			this.addedPositions.add(posKey);
			
			// Calculate chunk key for batch updates
			const chunkX = Math.floor(brushPos.x / 16);
			const chunkY = Math.floor(brushPos.y / 16);
			const chunkZ = Math.floor(brushPos.z / 16);
			const chunkKey = `${chunkX},${chunkY},${chunkZ}`;
			
			// Add to affected chunks set for batch processing
			affectedChunks.add(chunkKey);
			
			// Increment placed count
			placedCount++;
			
			// Track blocks for spatial hash update
			if (!this.addedBlocks) this.addedBlocks = [];
			this.addedBlocks.push({ 
				x: brushPos.x, 
				y: brushPos.y, 
				z: brushPos.z, 
				id: currentBlockTypeId 
			});
		}
		
		// Only process batches if we have blocks to place
		if (placedCount > 0) {
			// Add blocks to pending batch
			this.addToPendingBatch(blocksToAdd);
			
			// Queue chunk updates - but only once per chunk to avoid duplicate work
			affectedChunks.forEach(chunkKey => {
				const [chunkX, chunkY, chunkZ] = chunkKey.split(',').map(Number);
				this.queueChunkUpdate({ 
					x: chunkX * 16, 
					y: chunkY * 16, 
					z: chunkZ * 16 
				}, 'add');
			});
			
			// Process batches based on time interval
			const now = performance.now();
			if (now - this.lastBatchTime > this.batchInterval) {
				this.processPendingBatch();
				this.lastBatchTime = now;
			}
		}
		
		return placedCount;
	}

	/**
	 * Erase blocks at the specified position using the brush shape and size
	 * @param {Object} position - The position to erase blocks at
	 * @returns {Number} - The number of blocks erased
	 */
	eraseBlocksAtPosition(position) {
		// Skip if terrain reference is missing
		if (!this.terrainRef || !this.terrainRef.current) {
			console.error('BrushTool: terrainRef is undefined or null');
			return 0;
		}

		// Get the brush positions
		const brushPositions = this.getBrushPositions(position);
		
		// Track how many blocks we actually erase
		let erasedCount = 0;
		
		// Batch these blocks
		const blocksToRemove = {};
		
		// Store chunk keys that need updating to avoid redundant queue calls
		const affectedChunks = new Set();
		
		// Process each position in the brush area
		for (const brushPos of brushPositions) {
			// Create a position key
			const posKey = `${brushPos.x},${brushPos.y},${brushPos.z}`;
			
			// Skip if we've already processed this position in the current operation
			if (this.processedPositionsMap.has(posKey)) {
				continue;
			}
			
			// Check if position has a block to erase
			const existingBlockId = this.terrainRef.current[posKey];
			if (existingBlockId === undefined || existingBlockId === 0) {
				continue; // Skip if no block exists
			}
			
			// Remove from terrain data structure - CRITICAL FOR SPATIAL HASH
			delete this.terrainRef.current[posKey];
			
			// Add this block to the batch for removal
			blocksToRemove[posKey] = 0; // 0 = air
			
			// Track for undo/redo
			if (this.placementChangesRef && this.placementChangesRef.current) {
				// Record the removed block for undo
				this.placementChangesRef.current.terrain.removed[posKey] = existingBlockId;
			}
			
			// Mark as processed to avoid duplicates
			this.processedPositionsMap.set(posKey, true);
			
			// Track for spatial hash update on mouse up
			this.removedPositions.add(posKey);
			
			// Calculate chunk key for batch updates
			const chunkX = Math.floor(brushPos.x / 16);
			const chunkY = Math.floor(brushPos.y / 16);
			const chunkZ = Math.floor(brushPos.z / 16);
			const chunkKey = `${chunkX},${chunkY},${chunkZ}`;
			
			// Add to affected chunks set for batch processing
			affectedChunks.add(chunkKey);
			
			// Increment erased count
			erasedCount++;
			
			// Track blocks for spatial hash update
			if (!this.removedBlocks) this.removedBlocks = [];
			this.removedBlocks.push({ 
				x: brushPos.x, 
				y: brushPos.y, 
				z: brushPos.z, 
				id: existingBlockId // Remember the original ID for spatial hash updates
			});
		}
		
		// Only process batches if we have blocks to erase
		if (erasedCount > 0) {
			// Add blocks to pending batch
			this.addToPendingBatch(blocksToRemove, true);
			
			// Queue chunk updates - but only once per chunk to avoid duplicate work
			affectedChunks.forEach(chunkKey => {
				const [chunkX, chunkY, chunkZ] = chunkKey.split(',').map(Number);
				this.queueChunkUpdate({ 
					x: chunkX * 16, 
					y: chunkY * 16, 
					z: chunkZ * 16 
				}, 'remove');
			});
			
			// Process batches based on time interval
			const now = performance.now();
			if (now - this.lastBatchTime > this.batchInterval) {
				this.processPendingBatch();
				this.lastBatchTime = now;
			}
		}
		
		return erasedCount;
	}

	/**
	 * Gets all positions within the brush area based on current brush settings
	 * @param {Object} centerPos The center position of the brush
	 * @returns {Array} Array of positions covered by the brush
	 */
	getBrushPositions(centerPos) {
		// Check if we have a cached result for this input
		const cacheKey = `${centerPos.x},${centerPos.y},${centerPos.z},${this.brushSize},${this.isCircular},${this.isFlatMode}`;
		
		if (this.positionCache.has(cacheKey)) {
			return this.positionCache.get(cacheKey);
		}
		
		// Limit the cache size to prevent memory issues
		if (this.positionCache.size > 100) {
			// Remove the oldest entries
			const keysToDelete = Array.from(this.positionCache.keys()).slice(0, 20);
			keysToDelete.forEach(key => this.positionCache.delete(key));
		}
		
		// Ensure center position is grid-aligned
		const gridAlignedCenter = this.alignPositionToGrid(centerPos);
		
		// Generate positions array
		const positions = [];
		
		// For size 1, just return the center position (1x1x1 block)
		if (this.brushSize === 1) {
			positions.push(gridAlignedCenter);
			this.positionCache.set(cacheKey, positions);
			//console.log(`BrushTool: Generated ${positions.length} position(s) for size 1 brush`);
			return positions;
		}
		
		// Size 2 is a 3x3 square or circle (in flat mode) or 3x3x3 cube/sphere (in 3D mode)
		// Size 3 is a 5x5 square or circle (in flat mode) or 5x5x5 cube/sphere (in 3D mode)
		// And so on...
		
		// Calculate the actual size - each brush size unit adds 2 blocks to the dimension
		const actualSize = (this.brushSize - 1) * 2 + 1;
		const radius = Math.floor(actualSize / 2);
		
		// Calculate min/max coordinates
		const min = {
			x: gridAlignedCenter.x - radius,
			y: this.isFlatMode ? gridAlignedCenter.y : gridAlignedCenter.y - radius,
			z: gridAlignedCenter.z - radius
		};
		
		const max = {
			x: gridAlignedCenter.x + radius,
			y: this.isFlatMode ? gridAlignedCenter.y : gridAlignedCenter.y + radius,
			z: gridAlignedCenter.z + radius
		};
		
		// Generate positions
		for (let x = min.x; x <= max.x; x++) {
			for (let y = min.y; y <= max.y; y++) {
				for (let z = min.z; z <= max.z; z++) {
					// For circular brush, check distance
					if (this.isCircular) {
						let distance;
						
						if (this.isFlatMode) {
							// In flat mode, only consider x and z for distance calculation
							const dx = x - gridAlignedCenter.x;
							const dz = z - gridAlignedCenter.z;
							distance = Math.sqrt(dx * dx + dz * dz);
						} else {
							// In 3D mode, consider all coordinates
							const dx = x - gridAlignedCenter.x;
							const dy = y - gridAlignedCenter.y;
							const dz = z - gridAlignedCenter.z;
							distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
						}
						
						if (distance > radius) {
							continue; // Skip positions outside the circle
						}
					}
					
					// Ensure the position is grid-aligned
					const pos = this.alignPositionToGrid({ x, y, z });
					
					// Check if this is a valid position
					if (this.isValidBlockPosition({ x: pos.x, y: pos.y, z: pos.z })) {
						positions.push(pos);
					}
				}
			}
		}
		
		// Add debug logging to verify brush size
		//console.log(`BrushTool: Generated ${positions.length} position(s) for size ${this.brushSize} brush (${this.isCircular ? 'circle' : 'square'}, ${this.isFlatMode ? 'flat' : '3D'}) - Actual dimensions: ${actualSize}x${this.isFlatMode ? 1 : actualSize}x${actualSize}`);
		
		// Cache the result
		this.positionCache.set(cacheKey, positions);
		
		return positions;
	}

	/**
	 * Update the brush preview visualization
	 */
	updateBrushPreview(position) {
		if (!position) {
			this.removeBrushPreview();
			return;
		}

		// Check if position is the same as last time (to avoid needless updates)
		if (this.lastPreviewPosition &&
			this.lastPreviewPosition.x === position.x &&
			this.lastPreviewPosition.y === position.y &&
			this.lastPreviewPosition.z === position.z) {
			return;
		}

		// Save current position
		this.lastPreviewPosition = {
			x: position.x,
			y: position.y,
			z: position.z
		};

		// Align position to grid for consistent preview
		const alignedPosition = this.alignPositionToGrid(position);

		// Create or update the preview mesh
		if (!this.previewMesh) {
			// Create new mesh if one doesn't exist
			this.initializePreviewObjects();
		}

		// Get positions for blocks in the brush
		const brushPositions = this.getBrushPositions(alignedPosition);

		// Early exit if no positions
		if (!brushPositions || brushPositions.length === 0) {
			return;
		}

		// Use the appropriate material based on current mode
		const material = this.isEraseMode ? this.previewMaterialErase : this.previewMaterialAdd;

		// Generate blocks for each position
		const blockSize = 1.02; // Slightly larger than 1 for visibility
		let previewGeometry = new THREE.BoxGeometry(blockSize, blockSize, blockSize);

		// Create instances for each brush position
		const instances = new THREE.InstancedMesh(previewGeometry, material, brushPositions.length);
		instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		
		// Set position for each instance
		const matrix = new THREE.Matrix4();
		brushPositions.forEach((pos, index) => {
			// Verify each position is grid-aligned
			const verifiedPos = this.alignPositionToGrid(pos);
			matrix.setPosition(verifiedPos.x, verifiedPos.y, verifiedPos.z);
			instances.setMatrixAt(index, matrix);
		});

		// Update the instance matrix
		instances.instanceMatrix.needsUpdate = true;

		// Remove old preview if it exists
		this.removeBrushPreview();

		// Add the new preview mesh
		this.previewMesh = instances;
		if (this.scene) {
			this.scene.add(this.previewMesh);
		}
	}

	/**
	 * Removes the brush preview from the scene
	 */
	removeBrushPreview() {
		if (this.previewMesh) {
			this.scene.remove(this.previewMesh);
			this.previewMesh = null;
		}
	}
	
	/**
	 * Clean up resources when the tool is disposed
	 */
	dispose() {
		super.dispose();
		this.removeBrushPreview();
		
		// Cancel any pending timers
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		
		// Dispose of any created geometries and materials
		if (this.previewGeometry) {
			this.previewGeometry.dispose();
			this.previewGeometry = null;
		}
		
		if (this.previewMaterialAdd) {
			this.previewMaterialAdd.dispose();
			this.previewMaterialAdd = null;
		}
		
		if (this.previewMaterialErase) {
			this.previewMaterialErase.dispose();
			this.previewMaterialErase = null;
		}
		
		// Clear caches and state
		this.positionCache.clear();
		this.processedPositionsMap.clear();
		this.addedPositions.clear();
		this.removedPositions.clear();
		this.clearChunkUpdates();
		this.pendingBatch = { added: {}, removed: {} };
		this.lastBatchTime = 0;
		
		// Null out references to avoid memory leaks
		this.lastPosition = null;
		this.lastPreviewPosition = null;
	}

	/**
	 * Ensures a position is properly aligned to the grid
	 * @param {Object} position - The position to align
	 * @returns {Object} The aligned position
	 */
	alignPositionToGrid(position) {
		return {
			x: Math.floor(position.x),
			y: Math.floor(position.y), 
			z: Math.floor(position.z)
		};
	}

	/**
	 * Ensures a coordinate is a valid chunk origin
	 * @param {Object} coordinate - The coordinate to check/correct
	 * @returns {Object} A valid chunk origin coordinate
	 */
	ensureValidChunkOrigin(coordinate) {
		const CHUNK_SIZE = 16;
		return {
			x: Math.floor(coordinate.x / CHUNK_SIZE) * CHUNK_SIZE,
			y: Math.floor(coordinate.y / CHUNK_SIZE) * CHUNK_SIZE,
			z: Math.floor(coordinate.z / CHUNK_SIZE) * CHUNK_SIZE
		};
	}

	/**
	 * Gets the current block type ID from the current block type reference
	 * @returns {number|null} The current block type ID or null if not available
	 */
	getCurrentBlockTypeId() {
		if (!this.currentBlockTypeRef || !this.currentBlockTypeRef.current) {
			console.error('BrushTool: currentBlockTypeRef is undefined or null');
			return null;
		}
		
		return this.currentBlockTypeRef.current.id;
	}
}

export default BrushTool; 