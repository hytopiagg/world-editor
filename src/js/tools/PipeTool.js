/**
 * PipeTool.js - Tool for placing hollow pipe-like structures in the world editor
 * 
 * This tool handles pipe placement, previewing, and manipulation.
 */

import * as THREE from 'three';
import BaseTool from './BaseTool';

class PipeTool extends BaseTool {
	/**
	 * Creates a new PipeTool instance
	 */
	constructor(terrainBuilderProps) {
		console.log('PipeTool initialized');
		super(terrainBuilderProps);

		// CAREFUL: We need to explicitly get properties from the terrainBuilder
		this.name = "PipeTool";
		this.tooltip = "Pipe Tool: Click to start, click again to place. Use 1 | 2 to adjust height. Use 3 | 4 to adjust edge depth. Use 5 | 6 to change number of sides (4-8). Hold Ctrl to erase. Press Q to cancel.";
		this.pipeHeight = 1;
		this.pipeEdgeDepth = 1; // How thick the pipe walls are
		this.pipeSides = 4; // Number of sides (4 = square, 5 = pentagon, etc.)
		this.isCtrlPressed = false;
		this.pipeStartPosition = null;
		this.pipePreview = null;

		// IMPORTANT: Get the required references from the terrainBuilder
		if (terrainBuilderProps) {
			this.terrainRef = terrainBuilderProps.terrainRef;
			this.currentBlockTypeRef = terrainBuilderProps.currentBlockTypeRef;
			this.scene = terrainBuilderProps.scene;
			this.toolManagerRef = terrainBuilderProps.toolManagerRef;
			this.terrainBuilderRef = terrainBuilderProps.terrainBuilderRef;
			
			// Add undoRedoManager reference
			this.undoRedoManager = terrainBuilderProps.undoRedoManager;
			console.log('PipeTool: Got undoRedoManager reference:', !!this.undoRedoManager);

			// Add direct references to placement tracking
			this.placementChangesRef = terrainBuilderProps.placementChangesRef;
			this.isPlacingRef = terrainBuilderProps.isPlacingRef;
			console.log('PipeTool: Got placementChangesRef:', !!this.placementChangesRef);
			console.log('PipeTool: Got isPlacingRef:', !!this.isPlacingRef);

			// Add missing preview position ref
			this.previewPositionRef = terrainBuilderProps.previewPositionRef;
			
			// Set a global reference for tools
			window.activeTool = this.name;
		} else {
			console.error('PipeTool: terrainBuilderProps is undefined in constructor');
		}
	}

	onActivate() {
		super.onActivate();

		// Log activation details for debugging
		console.log('PipeTool activated');
		console.log('terrainRef exists:', !!this.terrainRef);
		console.log('terrainRef.current exists:', this.terrainRef && !!this.terrainRef.current);
		console.log('currentBlockTypeRef exists:', !!this.currentBlockTypeRef);
		console.log('currentBlockTypeRef.current exists:', this.currentBlockTypeRef && !!this.currentBlockTypeRef.current);
		console.log('undoRedoManager exists:', !!this.undoRedoManager);
		console.log('placementChangesRef exists:', !!this.placementChangesRef);
		console.log('isPlacingRef exists:', !!this.isPlacingRef);

		// Initialize empty objects if needed
		if (this.terrainRef && !this.terrainRef.current) {
			console.log('Initializing empty terrainRef.current in onActivate');
			this.terrainRef.current = {};
		}

		// Reset pipe state on activation
		this.pipeStartPosition = null;
		this.removePipePreview();
		
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
	}

	onDeactivate() {
		super.onDeactivate();
		this.removePipePreview();
		this.pipeStartPosition = null;
	}

	/**
	 * Handles mouse down events for pipe placement
	 */
	handleMouseDown(event, position, button) {
		// Safety check - if position is undefined, we can't do anything
		if (!position) {
			console.error('PipeTool: position is undefined in handleMouseDown');
			return;
		}

		console.log('PipeTool: handleMouseDown', {
			button,
			position,
			hasStartPosition: !!this.pipeStartPosition,
			isCtrlPressed: this.isCtrlPressed,
			undoRedoManager: !!this.undoRedoManager
		});

		// Left-click to place pipe or set starting point
		if (button === 0) {
			if (this.pipeStartPosition) {
				// Make sure the terrain reference is valid before placing
				if (!this.terrainRef) {
					console.error('PipeTool: terrainRef is undefined when attempting to place pipe');
					this.pipeStartPosition = null;
					this.removePipePreview();
					return;
				}

				if (!this.terrainRef.current) {
					console.log('PipeTool: terrainRef.current is undefined, initializing empty object');
					this.terrainRef.current = {};
				}

				// Enable placement tracking for undo/redo
				if (this.isPlacingRef) {
					console.log('PipeTool: Setting isPlacingRef to true (directly)');
					this.isPlacingRef.current = true;
				}
				
				// Make sure placement changes are initialized
				if (this.placementChangesRef) {
					console.log('PipeTool: Ensuring placementChangesRef is initialized (directly)');
					this.placementChangesRef.current = { 
						terrain: { added: {}, removed: {} }, 
						environment: { added: [], removed: [] } 
					};
				} else {
					console.warn('PipeTool: placementChangesRef is not available, changes won\'t be tracked for undo/redo');
				}

				// Perform the appropriate action based on Ctrl key state
				let actionPerformed = false;
				if (this.isCtrlPressed) {
					actionPerformed = this.erasePipe(this.pipeStartPosition, position);
				} else {
					actionPerformed = this.placePipe(this.pipeStartPosition, position);
				}

				if (!actionPerformed) {
					console.warn('PipeTool: Pipe action failed');
					return;
				}

				// Save undo state directly
				console.log('PipeTool: Saving undo state directly');
				if (this.placementChangesRef) {
					const changes = this.placementChangesRef.current;
					
					// Check if we have undoRedoManager and changes to save
					const hasChanges = 
						Object.keys(changes.terrain.added).length > 0 || 
						Object.keys(changes.terrain.removed).length > 0;
						
					if (hasChanges) {
						// Try using direct undoRedoManager reference first
						if (this.undoRedoManager) {
							console.log('PipeTool: Calling saveUndo with direct undoRedoManager reference');
							this.undoRedoManager.saveUndo(changes);
						}
						// Fall back to terrainBuilder reference if available
						else if (this.terrainBuilderRef.current.undoRedoManager) {
							console.log('PipeTool: Calling saveUndo via terrainBuilderRef');
							this.terrainBuilderRef.current.undoRedoManager.saveUndo(changes);
						}
						else {
							console.warn('PipeTool: No undoRedoManager available, changes won\'t be tracked for undo/redo');
						}
						
						// Reset placement changes after saving
						this.placementChangesRef.current = { 
							terrain: { added: {}, removed: {} }, 
							environment: { added: [], removed: [] } 
						};
					} else {
						console.warn('PipeTool: No changes to save');
					}
				} else {
					console.warn('PipeTool: placementChangesRef not available, changes won\'t be tracked for undo/redo');
				}

				// Reset the start position for a new pipe area
				this.pipeStartPosition = null;
				this.removePipePreview();
				
				// Disable placing
				if (this.isPlacingRef) {
					console.log('PipeTool: Setting isPlacingRef to false (directly)');
					this.isPlacingRef.current = false;
				}
			} else {
				// Set start position for a new pipe area
				console.log('Setting pipe start position:', position);
				this.pipeStartPosition = position.clone();
				
				// Start tracking changes for undo/redo
				if (this.placementChangesRef) {
					console.log('PipeTool: Initializing placementChangesRef for new pipe area (directly)');
					this.placementChangesRef.current = { 
						terrain: { added: {}, removed: {} }, 
						environment: { added: [], removed: [] } 
					};
					
					// Start placement
					if (this.isPlacingRef) {
						console.log('PipeTool: Setting isPlacingRef to true for new pipe area (directly)');
						this.isPlacingRef.current = true;
					}
				} else {
					console.warn('PipeTool: placementChangesRef not available at pipe start');
				}
			}
		}
	}

	/**
	 * Handles mouse move events for pipe preview
	 */
	handleMouseMove(event, position) {
		if (this.pipeStartPosition) {
			this.updatePipePreview(this.pipeStartPosition, position);
		}
	}

	/**
	 * Track Ctrl key state for erasing and handle pipe adjustments
	 */
	handleKeyDown(event) {
		if (event.key === 'Control') {
			console.log('PipeTool: Ctrl pressed, switching to erase mode');
			this.isCtrlPressed = true;
			this.updatePipePreviewMaterial();
		} else if (event.key === '1') {
			console.log('PipeTool: Decreasing pipe height');
			this.setPipeHeight(this.pipeHeight - 1);
		} else if (event.key === '2') {
			console.log('PipeTool: Increasing pipe height');
			this.setPipeHeight(this.pipeHeight + 1);
		} else if (event.key === '3') {
			console.log('PipeTool: Decreasing pipe edge depth');
			this.setPipeEdgeDepth(this.pipeEdgeDepth - 1);
		} else if (event.key === '4') {
			console.log('PipeTool: Increasing pipe edge depth');
			this.setPipeEdgeDepth(this.pipeEdgeDepth + 1);
		} else if (event.key === '5') {
			console.log('PipeTool: Decreasing number of sides');
			this.setPipeSides(this.pipeSides - 1);
		} else if (event.key === '6') {
			console.log('PipeTool: Increasing number of sides');
			this.setPipeSides(this.pipeSides + 1);
		} else if (event.key === 'q') {
			this.removePipePreview();
			this.pipeStartPosition = null;
		}
	}

	/**
	 * Handle key up events for the tool
	 */
	handleKeyUp(event) {
		if (event.key === 'Control') {
			console.log('PipeTool: Ctrl released, switching to build mode');
			this.isCtrlPressed = false;
			this.updatePipePreviewMaterial();
		}
	}

	/**
	 * Updates the pipe height
	 */
	setPipeHeight(height) {
		console.log('Setting pipe height to:', Math.max(1, height));
		this.pipeHeight = Math.max(1, height);

		// Update preview if it exists
		if (this.pipeStartPosition && this.previewPositionRef && this.previewPositionRef.current) {
			this.updatePipePreview(this.pipeStartPosition, this.previewPositionRef.current);
		}
	}

	/**
	 * Updates the pipe edge depth
	 */
	setPipeEdgeDepth(depth) {
		// Ensure the edge depth is at least 1 and doesn't exceed half the pipe size
		console.log('Setting pipe edge depth to:', Math.max(1, depth));
		this.pipeEdgeDepth = Math.max(1, depth);

		// Update preview if it exists
		if (this.pipeStartPosition && this.previewPositionRef && this.previewPositionRef.current) {
			this.updatePipePreview(this.pipeStartPosition, this.previewPositionRef.current);
		}
	}

	/**
	 * Updates the number of sides for the pipe
	 */
	setPipeSides(sides) {
		// Limit number of sides between 4 and 8
		const newSides = Math.max(4, Math.min(8, sides));
		if (newSides !== this.pipeSides) {
			console.log('Setting pipe sides to:', newSides);
			this.pipeSides = newSides;

			// Update preview if it exists
			if (this.pipeStartPosition && this.previewPositionRef && this.previewPositionRef.current) {
				this.updatePipePreview(this.pipeStartPosition, this.previewPositionRef.current);
			}
		}
	}

	/**
	 * Checks if a position is within the pipe walls based on area dimensions, edge depth, and number of sides
	 * @param {number} x - X position
	 * @param {number} z - Z position 
	 * @param {number} minX - Minimum X of the area
	 * @param {number} maxX - Maximum X of the area
	 * @param {number} minZ - Minimum Z of the area
	 * @param {number} maxZ - Maximum Z of the area
	 * @param {number} edgeDepth - Thickness of pipe walls
	 * @param {number} sides - Number of sides (4 = square, 5+ = polygon)
	 * @returns {boolean} True if this position should have a block (is part of pipe wall)
	 */
	isInPipeWall(x, z, minX, maxX, minZ, maxZ, edgeDepth, sides = 4) {
		// Width and height of the rectangular area
		const width = maxX - minX + 1;
		const length = maxZ - minZ + 1;
		
		// If the area is too small to have a hollow center, treat as solid
		if (width <= edgeDepth * 2 || length <= edgeDepth * 2) {
			return true;
		}
		
		// Calculate center of the area
		const centerX = minX + width / 2;
		const centerZ = minZ + length / 2;
		
		// For square/rectangle (4 sides), use the original edge check logic
		if (sides === 4) {
			// Calculate distance from edges
			const distFromLeft = x - minX;
			const distFromRight = maxX - x;
			const distFromTop = z - minZ;
			const distFromBottom = maxZ - z;
			
			// If within edge depth from any edge, it's part of the pipe wall
			return (
				distFromLeft < edgeDepth || 
				distFromRight < edgeDepth || 
				distFromTop < edgeDepth || 
				distFromBottom < edgeDepth
			);
		} 
		// For polygons with more than 4 sides
		else {
			// Get distance from center
			const distFromCenterX = x - centerX;
			const distFromCenterZ = z - centerZ;
			
			// Squared distance from center
			const distSquared = distFromCenterX * distFromCenterX + distFromCenterZ * distFromCenterZ;
			
			// Dimensions of the virtual circle/polygon
			// Use the smaller of width/2 or length/2 as the radius
			const radius = Math.min(width / 2, length / 2);
			
			// Outer edge radius squared (blocks outside this are not in shape)
			const outerRadiusSquared = radius * radius;
			
			// Inner edge radius squared (blocks inside this are hollow)
			const innerRadiusSquared = Math.max(0, (radius - edgeDepth) * (radius - edgeDepth));
			
			// If outside the outer circle, not in shape
			if (distSquared > outerRadiusSquared) {
				return false;
			}
			
			// If inside the inner circle, it's in the hollow part
			if (distSquared < innerRadiusSquared) {
				return false;
			}
			
			// For polygons, we need to check angular position
			if (sides > 4) {
				// Get angle from center (in radians)
				let angle = Math.atan2(distFromCenterZ, distFromCenterX);
				if (angle < 0) angle += Math.PI * 2; // Convert to 0-2π range
				
				// Calculate which sector/side it belongs to
				const sectorAngle = (Math.PI * 2) / sides;
				const sectorIndex = Math.floor(angle / sectorAngle);
				
				// Calculate the two corner points of this edge
				const corner1Angle = sectorIndex * sectorAngle;
				const corner2Angle = (sectorIndex + 1) * sectorAngle;
				
				// Calculate corners in cartesian coordinates (points on the outer circle)
				const corner1X = centerX + radius * Math.cos(corner1Angle);
				const corner1Z = centerZ + radius * Math.sin(corner1Angle);
				const corner2X = centerX + radius * Math.cos(corner2Angle);
				const corner2Z = centerZ + radius * Math.sin(corner2Angle);
				
				// Calculate distance to the line segment defined by these two corners
				// This is the distance to the edge of the polygon
				const edgeDistSquared = distanceToLineSegmentSquared(
					x, z, corner1X, corner1Z, corner2X, corner2Z
				);
				
				// If the distance to the edge is less than the edge depth, it's part of the wall
				return edgeDistSquared < (edgeDepth * edgeDepth);
			}
			
			// For circle-like shapes, we already checked inner/outer radius, so it's in the wall
			return true;
		}
	}

	/**
	 * Place pipe on the terrain
	 * @param {THREE.Vector3} startPos - The starting position of the pipe area
	 * @param {THREE.Vector3} endPos - The ending position of the pipe area
	 * @returns {boolean} True if the pipe was placed, false otherwise
	 */
	placePipe(startPos, endPos) {
		console.log('PipeTool: Placing pipe from', startPos, 'to', endPos, 
			'with height', this.pipeHeight, 'edge depth', this.pipeEdgeDepth, 
			'and sides', this.pipeSides);

		if (!startPos || !endPos) {
			console.error('Invalid start or end position for pipe placement');
			return false;
		}

		// Early validation of references
		if (!this.terrainBuilderRef || !this.terrainBuilderRef.current) {
			console.error('PipeTool: Cannot place pipe - terrainBuilderRef not available');
			return false;
		}

		// Get current block type ID from the reference
		const blockTypeId = this.currentBlockTypeRef.current.id;
		
		// Calculate the area to place pipe
		const minX = Math.min(Math.round(startPos.x), Math.round(endPos.x));
		const maxX = Math.max(Math.round(startPos.x), Math.round(endPos.x));
		const minZ = Math.min(Math.round(startPos.z), Math.round(endPos.z));
		const maxZ = Math.max(Math.round(startPos.z), Math.round(endPos.z));
		const baseY = Math.round(startPos.y);
		
		// Performance optimization: Batch process all blocks
		console.time('PipeTool-placePipe');
		
		// Track any blocks added for state tracking and undo/redo
		const addedBlocks = {};
		
		// First collect all blocks to add
		for (let x = minX; x <= maxX; x++) {
			for (let z = minZ; z <= maxZ; z++) {
				// Check if this position should be part of the pipe wall
				if (this.isInPipeWall(x, z, minX, maxX, minZ, maxZ, this.pipeEdgeDepth, this.pipeSides)) {
					// Add blocks for each level of height
					for (let y = 0; y < this.pipeHeight; y++) {
						const posKey = `${x},${baseY + y},${z}`;
						// Skip if block already exists
						if (this.terrainRef.current[posKey]) continue;
						
						// Add to our batch
						addedBlocks[posKey] = blockTypeId;
					}
				}
			}
		}
		
		// If no blocks were added, return false
		if (Object.keys(addedBlocks).length === 0) {
			console.warn('PipeTool: No blocks were added during pipe placement');
			return false;
		}
		
		console.log(`PipeTool: Adding ${Object.keys(addedBlocks).length} blocks in batch`);
		
		// Update the terrain data structure with all blocks at once
		Object.entries(addedBlocks).forEach(([posKey, blockId]) => {
			this.terrainRef.current[posKey] = blockId;
		});
		
		// Use the optimized imported update function to update all blocks at once
		this.terrainBuilderRef.current.updateTerrainBlocks(addedBlocks, {});
		
		// Convert blocks to the format expected by updateSpatialHashForBlocks
		const addedBlocksArray = Object.entries(addedBlocks).map(([posKey, blockId]) => {
			const [x, y, z] = posKey.split(',').map(Number);
			return {
				id: blockId,
				position: [x, y, z]
			};
		});
		
		// Explicitly update the spatial hash for collisions with force option
		if (this.terrainBuilderRef.current.updateSpatialHashForBlocks) {
			console.log('PipeTool: Explicitly updating spatial hash after placement');
			this.terrainBuilderRef.current.updateSpatialHashForBlocks(addedBlocksArray, [], { force: true });
		}
		
		// Add to placement changes for undo/redo
		if (this.placementChangesRef) {
			console.log('PipeTool: Adding placed blocks to placementChangesRef');
			Object.entries(addedBlocks).forEach(([key, value]) => {
				this.placementChangesRef.current.terrain.added[key] = value;
			});
			
			// Log the current state of placement changes
			const added = Object.keys(this.placementChangesRef.current.terrain.added).length;
			const removed = Object.keys(this.placementChangesRef.current.terrain.removed).length;
			console.log(`PipeTool: placementChangesRef now has ${added} added and ${removed} removed blocks`);
		}
		
		console.timeEnd('PipeTool-placePipe');
		return true;
	}

	/**
	 * Erase pipe from the terrain
	 * @param {THREE.Vector3} startPos - The starting position of the pipe area
	 * @param {THREE.Vector3} endPos - The ending position of the pipe area
	 * @returns {boolean} True if the pipe was erased, false otherwise
	 */
	erasePipe(startPos, endPos) {
		console.log('PipeTool: Erasing pipe from', startPos, 'to', endPos, 
			'with height', this.pipeHeight, 'edge depth', this.pipeEdgeDepth,
			'and sides', this.pipeSides);

		if (!startPos || !endPos) {
			console.error('Invalid start or end position for erasing');
			return false;
		}

		// Early validation of references
		if (!this.terrainBuilderRef || !this.terrainBuilderRef.current) {
			console.error('PipeTool: Cannot erase pipe - terrainBuilderRef not available');
			return false;
		}

		// Calculate the area to erase
		const minX = Math.min(Math.round(startPos.x), Math.round(endPos.x));
		const maxX = Math.max(Math.round(startPos.x), Math.round(endPos.x));
		const minZ = Math.min(Math.round(startPos.z), Math.round(endPos.z));
		const maxZ = Math.max(Math.round(startPos.z), Math.round(endPos.z));
		const baseY = Math.round(startPos.y);
		
		// Performance optimization: Batch process all blocks
		console.time('PipeTool-erasePipe');
		
		// Track any blocks removed for state tracking and undo/redo
		const removedBlocks = {};
		
		// First collect all blocks to remove
		for (let x = minX; x <= maxX; x++) {
			for (let z = minZ; z <= maxZ; z++) {
				// Check if this position should be part of the pipe wall
				if (this.isInPipeWall(x, z, minX, maxX, minZ, maxZ, this.pipeEdgeDepth, this.pipeSides)) {
					// Remove blocks for each level of height
					for (let y = 0; y < this.pipeHeight; y++) {
						const posKey = `${x},${baseY + y},${z}`;
						// Skip if no block exists
						if (!this.terrainRef.current[posKey]) continue;
						
						// Add to our batch
						removedBlocks[posKey] = this.terrainRef.current[posKey];
					}
				}
			}
		}
		
		// If no blocks were found to remove, return false
		if (Object.keys(removedBlocks).length === 0) {
			console.warn('PipeTool: No blocks were found to remove during pipe erasure');
			return false;
		}
		
		console.log(`PipeTool: Removing ${Object.keys(removedBlocks).length} blocks in batch`);
		
		// Remove the blocks from the terrain data structure
		Object.keys(removedBlocks).forEach(posKey => {
			delete this.terrainRef.current[posKey];
		});
		
		// Use the optimized update function to remove all blocks at once
		this.terrainBuilderRef.current.updateTerrainBlocks({}, removedBlocks);
		
		// Convert blocks to the format expected by updateSpatialHashForBlocks
		const removedBlocksArray = Object.entries(removedBlocks).map(([posKey, blockId]) => {
			const [x, y, z] = posKey.split(',').map(Number);
			return {
				id: 0, // Use 0 for removed blocks
				position: [x, y, z]
			};
		});
		
		// Explicitly update the spatial hash for collisions with force option
		if (this.terrainBuilderRef.current.updateSpatialHashForBlocks) {
			console.log('PipeTool: Explicitly updating spatial hash after erasure');
			this.terrainBuilderRef.current.updateSpatialHashForBlocks([], removedBlocksArray, { force: true });
		}
		
		// Add to placement changes for undo/redo
		if (this.placementChangesRef) {
			console.log('PipeTool: Adding removed blocks to placementChangesRef');
			Object.entries(removedBlocks).forEach(([key, value]) => {
				this.placementChangesRef.current.terrain.removed[key] = value;
			});
			
			// Log the current state of placement changes
			const added = Object.keys(this.placementChangesRef.current.terrain.added).length;
			const removed = Object.keys(this.placementChangesRef.current.terrain.removed).length;
			console.log(`PipeTool: placementChangesRef now has ${added} added and ${removed} removed blocks`);
		}
		
		console.timeEnd('PipeTool-erasePipe');
		return true;
	}

	/**
	 * Updates the pipe preview visualization
	 */
	updatePipePreview(startPos, endPos) {
		// Safety checks
		if (!startPos || !endPos) {
			return;
		}

		// Remove existing pipe preview if it exists
		this.removePipePreview();

		// Don't show a preview if positions aren't valid
		if (startPos.equals(endPos)) return;

		console.time('PipeTool-updatePipePreview');
		
		// Calculate the area to preview
		const minX = Math.min(Math.round(startPos.x), Math.round(endPos.x));
		const maxX = Math.max(Math.round(startPos.x), Math.round(endPos.x));
		const minZ = Math.min(Math.round(startPos.z), Math.round(endPos.z));
		const maxZ = Math.max(Math.round(startPos.z), Math.round(endPos.z));
		const baseY = Math.round(startPos.y);
		
		// Count blocks needed for the preview
		let totalBlocks = 0;
		for (let x = minX; x <= maxX; x++) {
			for (let z = minZ; z <= maxZ; z++) {
				if (this.isInPipeWall(x, z, minX, maxX, minZ, maxZ, this.pipeEdgeDepth, this.pipeSides)) {
					totalBlocks += this.pipeHeight;
				}
			}
		}
		
		// Use instanced mesh for better performance
		if (totalBlocks > 0) {
			// Create a geometry for the pipe preview
			const previewGeometry = new THREE.BoxGeometry(1, 1, 1);
			
			// Use different color based on whether Ctrl is pressed (erase mode)
			const previewMaterial = new THREE.MeshBasicMaterial({
				color: this.isCtrlPressed ? 0xff4e4e : 0x4e8eff, // Red for erase, blue for add
				transparent: true,
				opacity: 0.5,
				wireframe: false
			});
			
			// Create an instanced mesh
			const instancedMesh = new THREE.InstancedMesh(previewGeometry, previewMaterial, totalBlocks);
			instancedMesh.frustumCulled = false; // Disable frustum culling for preview
			
			// Set position for each instance
			let instanceIndex = 0;
			const matrix = new THREE.Matrix4();
			
			// Add instances for all points in the pipe wall
			for (let x = minX; x <= maxX; x++) {
				for (let z = minZ; z <= maxZ; z++) {
					if (this.isInPipeWall(x, z, minX, maxX, minZ, maxZ, this.pipeEdgeDepth, this.pipeSides)) {
						for (let y = 0; y < this.pipeHeight; y++) {
							matrix.setPosition(x, baseY + y, z);
							instancedMesh.setMatrixAt(instanceIndex++, matrix);
						}
					}
				}
			}
			
			// Update the instance matrix
			instancedMesh.instanceMatrix.needsUpdate = true;
			
			// Store reference to the instanced mesh
			this.pipePreview = instancedMesh;
			
			// Add the preview to the scene
			if (this.scene) {
				this.scene.add(this.pipePreview);
			}
		}
		
		console.timeEnd('PipeTool-updatePipePreview');
	}

	/**
	 * Updates the pipe preview material based on current mode (add or erase)
	 */
	updatePipePreviewMaterial() {
		// Safety check - if no pipe preview exists, nothing to update
		if (!this.pipePreview) {
			return;
		}

		// Red for erase mode, blue for add mode
		const color = this.isCtrlPressed ? 0xff4e4e : 0x4e8eff;
		
		// For instanced mesh, just update the material directly
		if (this.pipePreview.isInstancedMesh) {
			this.pipePreview.material.color.set(color);
		}
	}

	/**
	 * Removes the pipe preview from the scene
	 */
	removePipePreview() {
		if (this.pipePreview) {
			this.scene.remove(this.pipePreview);
			this.pipePreview = null;
		}
	}

	/**
	 * Cleans up resources when the tool is disposed
	 */
	dispose() {
		console.log('PipeTool: disposing resources');

		// Clean up pipe preview meshes
		this.removePipePreview();

		// Clear references to avoid memory leaks
		this.terrainRef = null;
		this.currentBlockTypeRef = null;
		this.scene = null;
		this.pipeStartPosition = null;
		this.toolManagerRef = null;
		this.terrainBuilderRef = null;

		// Call parent dispose method
		super.dispose();
	}
}

/**
 * Helper function to calculate squared distance from point to line segment
 * @param {number} x - Point x coordinate
 * @param {number} y - Point y coordinate
 * @param {number} x1 - Line segment start x
 * @param {number} y1 - Line segment start y
 * @param {number} x2 - Line segment end x
 * @param {number} y2 - Line segment end y
 * @returns {number} Squared distance from point to line segment
 */
function distanceToLineSegmentSquared(x, y, x1, y1, x2, y2) {
	const A = x - x1;
	const B = y - y1;
	const C = x2 - x1;
	const D = y2 - y1;

	const dot = A * C + B * D;
	const lenSq = C * C + D * D;
	let param = -1;

	if (lenSq !== 0) param = dot / lenSq;

	let xx, yy;

	if (param < 0) {
		xx = x1;
		yy = y1;
	} else if (param > 1) {
		xx = x2;
		yy = y2;
	} else {
		xx = x1 + param * C;
		yy = y1 + param * D;
	}

	const dx = x - xx;
	const dy = y - yy;

	return dx * dx + dy * dy;
}

export default PipeTool; 