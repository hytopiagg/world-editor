/**
 * GroundTool.js - Tool for placing ground areas in the world editor
 * 
 * This tool handles ground placement, previewing, and manipulation.
 */

import * as THREE from 'three';
import BaseTool from './BaseTool';

class GroundTool extends BaseTool {
	/**
	 * Creates a new GroundTool instance
	 */
	constructor(terrainBuilderProps) {
		console.log('GroundTool initialized');
		super(terrainBuilderProps);

		// CAREFUL: We need to explicitly get properties from the terrainBuilder
		this.name = "GroundTool";
		this.tooltip = "Ground Tool: Click to start, click again to place. Use 1 | 2 to adjust height. Use 5 | 6 to change number of sides (4-8). Hold Ctrl to erase. Press Q to cancel.";
		this.groundHeight = 1;
		this.groundSides = 4; // Number of sides (4 = square, 5 = pentagon, etc.)
		this.isCtrlPressed = false;
		this.groundStartPosition = null;
		this.groundPreview = null;

		// IMPORTANT: Get the required references from the terrainBuilder
		if (terrainBuilderProps) {
			this.terrainRef = terrainBuilderProps.terrainRef;
			this.currentBlockTypeRef = terrainBuilderProps.currentBlockTypeRef;
			this.scene = terrainBuilderProps.scene;
			this.toolManagerRef = terrainBuilderProps.toolManagerRef;
			this.terrainBuilderRef = terrainBuilderProps.terrainBuilderRef;
			
			// Add undoRedoManager reference
			this.undoRedoManager = terrainBuilderProps.undoRedoManager;
			console.log('GroundTool: Got undoRedoManager reference:', !!this.undoRedoManager);
			console.log('GroundTool: undoRedoManager is ref:', this.undoRedoManager && 'current' in this.undoRedoManager);
			console.log('GroundTool: undoRedoManager.current exists:', this.undoRedoManager && !!this.undoRedoManager.current);
			console.log('GroundTool: undoRedoManager.current has saveUndo:', 
				this.undoRedoManager && 
				this.undoRedoManager.current && 
				typeof this.undoRedoManager.current.saveUndo === 'function');

			// Add direct references to placement tracking
			this.placementChangesRef = terrainBuilderProps.placementChangesRef;
			this.isPlacingRef = terrainBuilderProps.isPlacingRef;
			console.log('GroundTool: Got placementChangesRef:', !!this.placementChangesRef);
			console.log('GroundTool: Got isPlacingRef:', !!this.isPlacingRef);

			// Add missing preview position ref
			this.previewPositionRef = terrainBuilderProps.previewPositionRef;
			
			// Set a global reference for tools
			window.activeTool = this.name;
		} else {
			console.error('GroundTool: terrainBuilderProps is undefined in constructor');
		}
	}

	onActivate() {
		super.onActivate();

		// Log activation details for debugging
		console.log('GroundTool activated');
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

		// Reset ground state on activation
		this.groundStartPosition = null;
		this.removeGroundPreview();
		
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
		this.removeGroundPreview();
		this.groundStartPosition = null;
	}

	/**
	 * Handles mouse down events for ground placement
	 */
	handleMouseDown(event, position, button) {
		// Safety check - use previewPositionRef for accurate placement
		if (!this.previewPositionRef || !this.previewPositionRef.current) {
			console.error('GroundTool: previewPositionRef is undefined in handleMouseDown');
			return;
		}
		// Use the accurate cursor position from TerrainBuilder
		const currentPosition = this.previewPositionRef.current;

		console.log('GroundTool: handleMouseDown', {
			button,
			position: currentPosition, // Use accurate position
			hasStartPosition: !!this.groundStartPosition,
			isCtrlPressed: this.isCtrlPressed,
			undoRedoManager: !!this.undoRedoManager
		});

		// Left-click to place ground or set starting point
		if (button === 0) {
			if (this.groundStartPosition) {
				// Make sure the terrain reference is valid before placing
				if (!this.terrainRef) {
					console.error('GroundTool: terrainRef is undefined when attempting to place ground');
					this.groundStartPosition = null;
					this.removeGroundPreview();
					return;
				}

				if (!this.terrainRef.current) {
					console.log('GroundTool: terrainRef.current is undefined, initializing empty object');
					this.terrainRef.current = {};
				}

				// Enable placement tracking for undo/redo
				if (this.isPlacingRef) {
					console.log('GroundTool: Setting isPlacingRef to true (directly)');
					this.isPlacingRef.current = true;
				}
				
				// Make sure placement changes are initialized
				if (this.placementChangesRef) {
					console.log('GroundTool: Ensuring placementChangesRef is initialized (directly)');
					this.placementChangesRef.current = { 
						terrain: { added: {}, removed: {} }, 
						environment: { added: [], removed: [] } 
					};
				} else {
					console.warn('GroundTool: placementChangesRef is not available, changes won\'t be tracked for undo/redo');
				}

				// Perform the appropriate action based on Ctrl key state
				let actionPerformed = false;
				if (this.isCtrlPressed) {
					actionPerformed = this.eraseGround(this.groundStartPosition, currentPosition); // Use accurate position
				} else {
					actionPerformed = this.placeGround(this.groundStartPosition, currentPosition); // Use accurate position
				}

				if (!actionPerformed) {
					console.warn('GroundTool: Ground action failed');
					return;
				}

				// Save undo state directly
				console.log('GroundTool: Saving undo state directly');
				if (this.placementChangesRef) {
					const changes = this.placementChangesRef.current;
					
					// Check if we have undoRedoManager and changes to save
					const hasChanges = 
						Object.keys(changes.terrain.added).length > 0 || 
						Object.keys(changes.terrain.removed).length > 0;
						
					if (hasChanges) {
						// Try using direct undoRedoManager reference first
						if (this.undoRedoManager?.current?.saveUndo) {
							console.log('GroundTool: Calling saveUndo with undoRedoManager.current');
							this.undoRedoManager.current.saveUndo(changes);
						}
						// Fall back to terrainBuilder reference if available
						else if (this.terrainBuilderRef?.current?.undoRedoManager?.current?.saveUndo) {
							console.log('GroundTool: Calling saveUndo with terrainBuilderRef fallback');
							this.terrainBuilderRef.current.undoRedoManager.current.saveUndo(changes);
						}
						else {
							console.warn('GroundTool: No undoRedoManager available, changes won\'t be tracked for undo/redo');
						}
						
						// Reset placement changes after saving
						this.placementChangesRef.current = { 
							terrain: { added: {}, removed: {} }, 
							environment: { added: [], removed: [] } 
						};
					} else {
						console.warn('GroundTool: No changes to save');
					}
				} else {
					console.warn('GroundTool: placementChangesRef not available, changes won\'t be tracked for undo/redo');
				}

				// Reset the start position for a new ground area
				this.groundStartPosition = null;
				this.removeGroundPreview();
				
				// Disable placing
				if (this.isPlacingRef) {
					console.log('GroundTool: Setting isPlacingRef to false (directly)');
					this.isPlacingRef.current = false;
				}
			} else {
				// Set start position for a new ground area
				console.log('Setting ground start position:', currentPosition); // Use accurate position
				this.groundStartPosition = currentPosition.clone();
				
				// Start tracking changes for undo/redo
				if (this.placementChangesRef) {
					console.log('GroundTool: Initializing placementChangesRef for new ground area (directly)');
					this.placementChangesRef.current = { 
						terrain: { added: {}, removed: {} }, 
						environment: { added: [], removed: [] } 
					};
					
					// Start placement
					if (this.isPlacingRef) {
						console.log('GroundTool: Setting isPlacingRef to true for new ground area (directly)');
						this.isPlacingRef.current = true;
					}
				} else {
					console.warn('GroundTool: placementChangesRef not available at ground start');
				}
			}
		}
	}

	/**
	 * Handles mouse move events for ground preview
	 */
	handleMouseMove(event, position) {
		// Use the accurate preview position for the end point
		if (this.groundStartPosition && this.previewPositionRef && this.previewPositionRef.current) {
			this.updateGroundPreview(this.groundStartPosition, this.previewPositionRef.current);
		}
	}

	/**
	 * Track Ctrl key state for erasing and handle ground height adjustments
	 */
	handleKeyDown(event) {
		if (event.key === 'Control') {
			console.log('GroundTool: Ctrl pressed, switching to erase mode');
			this.isCtrlPressed = true;
			this.updateGroundPreviewMaterial();
		} else if (event.key === '1') {
			console.log('GroundTool: Decreasing ground height');
			this.setGroundHeight(this.groundHeight - 1);
		} else if (event.key === '2') {
			console.log('GroundTool: Increasing ground height');
			this.setGroundHeight(this.groundHeight + 1);
		} else if (event.key === '5') {
			console.log('GroundTool: Decreasing number of sides');
			this.setGroundSides(this.groundSides - 1);
		} else if (event.key === '6') {
			console.log('GroundTool: Increasing number of sides');
			this.setGroundSides(this.groundSides + 1);
		} else if (event.key === 'q') {
			this.removeGroundPreview();
			this.groundStartPosition = null;
		}
	}

	/**
	 * Handle key up events for the tool
	 */
	handleKeyUp(event) {
		if (event.key === 'Control') {
			console.log('GroundTool: Ctrl released, switching to build mode');
			this.isCtrlPressed = false;
			this.updateGroundPreviewMaterial();
		}
	}

	/**
	 * Updates the ground height
	 */
	setGroundHeight(height) {
		console.log('Setting ground height to:', Math.max(1, height));
		this.groundHeight = Math.max(1, height);

		// Update preview if it exists - add safety check for previewPositionRef
		if (this.groundStartPosition && this.previewPositionRef && this.previewPositionRef.current) {
			this.updateGroundPreview(this.groundStartPosition, this.previewPositionRef.current);
		} else {
			console.log('Ground preview not updated - missing references:', {
				groundStartPosition: !!this.groundStartPosition,
				previewPositionRef: !!this.previewPositionRef,
				previewPositionRefCurrent: this.previewPositionRef && !!this.previewPositionRef.current
			});
		}
	}

	/**
	 * Updates the number of sides for the ground shape
	 */
	setGroundSides(sides) {
		// Limit number of sides between 4 and 8
		const newSides = Math.max(4, Math.min(8, sides));
		if (newSides !== this.groundSides) {
			console.log('Setting ground sides to:', newSides);
			this.groundSides = newSides;

			// Update preview if it exists
			if (this.groundStartPosition && this.previewPositionRef && this.previewPositionRef.current) {
				this.updateGroundPreview(this.groundStartPosition, this.previewPositionRef.current);
			}
		}
	}

	/**
	 * Checks if a position is within the ground shape based on area dimensions and number of sides
	 * @param {number} x - X position to check
	 * @param {number} z - Z position to check 
	 * @param {number} minX - Minimum X of the area
	 * @param {number} maxX - Maximum X of the area
	 * @param {number} minZ - Minimum Z of the area
	 * @param {number} maxZ - Maximum Z of the area
	 * @param {number} sides - Number of sides (4 = square, 5+ = polygon)
	 * @returns {boolean} True if this position should have a block
	 */
	isInGroundShape(x, z, minX, maxX, minZ, maxZ, sides = 4) {
		// For square/rectangle (4 sides), use the default rectangular bounds
		if (sides === 4) {
			// Standard rectangular check (always true for rect area)
			return (x >= minX && x <= maxX && z >= minZ && z <= maxZ);
		} 
		// For polygons with more than 4 sides
		else {
			// Width and height of the rectangular area
			const width = maxX - minX + 1;
			const length = maxZ - minZ + 1;
			
			// Calculate center of the area
			const centerX = minX + width / 2;
			const centerZ = minZ + length / 2;
			
			// Get distance from center
			const distFromCenterX = x - centerX;
			const distFromCenterZ = z - centerZ;
			
			// Squared distance from center
			const distSquared = distFromCenterX * distFromCenterX + distFromCenterZ * distFromCenterZ;
			
			// Use the smaller of width/2 or length/2 as the radius
			const radius = Math.min(width / 2, length / 2);
			
			// Outer radius squared (blocks outside this are not in shape)
			const outerRadiusSquared = radius * radius;
			
			// If outside the outer circle, not in shape
			if (distSquared > outerRadiusSquared) {
				return false;
			}
			
			// For simple circle (many sides)
			if (sides >= 8) {
				return true;
			}
			
			/*
			// For polygons, check if point is inside the polygon
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
			
			// For polygons, check if the point is in the polygon
			// For simplicity, we'll just use the distance to the edge
			// This is an approximation for preview purposes
			const edgeDistSquared = distanceToLineSegmentSquared(
				x, z, corner1X, corner1Z, corner2X, corner2Z
			);
			
			// Calculate vector from center to point
			const vectorX = distFromCenterX / Math.sqrt(distSquared);
			const vectorZ = distFromCenterZ / Math.sqrt(distSquared);
			*/
			// Calculate perpendicular distance to edge
			// This is a simplification for preview purposes
			// Full polygon check would be more complex
			return true;
		}
	}

	/**
	 * Place ground on the terrain
	 * @param {THREE.Vector3} startPos - The starting position of the ground area
	 * @param {THREE.Vector3} endPos - The ending position of the ground area
	 * @returns {boolean} True if the ground was placed, false otherwise
	 */
	placeGround(startPos, endPos) {
		console.log('GroundTool: Placing ground from', startPos, 'to', endPos, 
			'with height', this.groundHeight, 'and sides', this.groundSides);

		if (!startPos || !endPos) {
			console.error('Invalid start or end position for ground placement');
			return false;
		}

		// Early validation of references
		if (!this.terrainBuilderRef || !this.terrainBuilderRef.current) {
			console.error('GroundTool: Cannot place ground - terrainBuilderRef not available');
			return false;
		}

		// Get current block type ID from the reference
		const blockTypeId = this.currentBlockTypeRef.current.id;
		
		// Calculate the area to place ground
		const minX = Math.min(Math.round(startPos.x), Math.round(endPos.x));
		const maxX = Math.max(Math.round(startPos.x), Math.round(endPos.x));
		const minZ = Math.min(Math.round(startPos.z), Math.round(endPos.z));
		const maxZ = Math.max(Math.round(startPos.z), Math.round(endPos.z));
		const baseY = Math.round(startPos.y);
		
		// Performance optimization: Batch process all blocks
		console.time('GroundTool-placeGround');
		
		// Track any blocks added for state tracking and undo/redo
		const addedBlocks = {};
		
		// First collect all blocks to add
		for (let x = minX; x <= maxX; x++) {
			for (let z = minZ; z <= maxZ; z++) {
				// Only add blocks that are within the shape
				if (this.isInGroundShape(x, z, minX, maxX, minZ, maxZ, this.groundSides)) {
					// Add blocks for each level of height
					for (let y = 0; y < this.groundHeight; y++) {
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
			console.warn('GroundTool: No blocks were added during ground placement');
			return false;
		}
		
		console.log(`GroundTool: Adding ${Object.keys(addedBlocks).length} blocks in batch`);
		
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
			console.log('GroundTool: Explicitly updating spatial hash after placement');
			this.terrainBuilderRef.current.updateSpatialHashForBlocks(addedBlocksArray, [], { force: true });
		}
		
		// Add to placement changes for undo/redo
		if (this.placementChangesRef) {
			console.log('GroundTool: Adding placed blocks to placementChangesRef');
			Object.entries(addedBlocks).forEach(([key, value]) => {
				this.placementChangesRef.current.terrain.added[key] = value;
			});
			
			// Log the current state of placement changes
			const added = Object.keys(this.placementChangesRef.current.terrain.added).length;
			const removed = Object.keys(this.placementChangesRef.current.terrain.removed).length;
			console.log(`GroundTool: placementChangesRef now has ${added} added and ${removed} removed blocks`);
		}
		
		console.timeEnd('GroundTool-placeGround');
		return true;
	}

	/**
	 * Erase ground from the terrain
	 * @param {THREE.Vector3} startPos - The starting position of the ground area
	 * @param {THREE.Vector3} endPos - The ending position of the ground area
	 * @returns {boolean} True if the ground was erased, false otherwise
	 */
	eraseGround(startPos, endPos) {
		console.log('GroundTool: Erasing ground from', startPos, 'to', endPos, 
			'with height', this.groundHeight, 'and sides', this.groundSides);

		if (!startPos || !endPos) {
			console.error('Invalid start or end position for erasing');
			return false;
		}

		// Early validation of references
		if (!this.terrainBuilderRef || !this.terrainBuilderRef.current) {
			console.error('GroundTool: Cannot erase ground - terrainBuilderRef not available');
			return false;
		}

		// Calculate the area to erase
		const minX = Math.min(Math.round(startPos.x), Math.round(endPos.x));
		const maxX = Math.max(Math.round(startPos.x), Math.round(endPos.x));
		const minZ = Math.min(Math.round(startPos.z), Math.round(endPos.z));
		const maxZ = Math.max(Math.round(startPos.z), Math.round(endPos.z));
		const baseY = Math.round(startPos.y);
		
		// Performance optimization: Batch process all blocks
		console.time('GroundTool-eraseGround');
		
		// Track any blocks removed for state tracking and undo/redo
		const removedBlocks = {};
		
		// First collect all blocks to remove
		for (let x = minX; x <= maxX; x++) {
			for (let z = minZ; z <= maxZ; z++) {
				// Only remove blocks that are within the shape
				if (this.isInGroundShape(x, z, minX, maxX, minZ, maxZ, this.groundSides)) {
					// Remove blocks for each level of height
					for (let y = 0; y < this.groundHeight; y++) {
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
			console.warn('GroundTool: No blocks were found to remove during ground erasure');
			return false;
		}
		
		console.log(`GroundTool: Removing ${Object.keys(removedBlocks).length} blocks in batch`);
		
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
			console.log('GroundTool: Explicitly updating spatial hash after erasure');
			this.terrainBuilderRef.current.updateSpatialHashForBlocks([], removedBlocksArray, { force: true });
		}
		
		// Add to placement changes for undo/redo
		if (this.placementChangesRef) {
			console.log('GroundTool: Adding removed blocks to placementChangesRef');
			Object.entries(removedBlocks).forEach(([key, value]) => {
				this.placementChangesRef.current.terrain.removed[key] = value;
			});
			
			// Log the current state of placement changes
			const added = Object.keys(this.placementChangesRef.current.terrain.added).length;
			const removed = Object.keys(this.placementChangesRef.current.terrain.removed).length;
			console.log(`GroundTool: placementChangesRef now has ${added} added and ${removed} removed blocks`);
		}
		
		console.timeEnd('GroundTool-eraseGround');
		return true;
	}

	/**
	 * Updates the ground preview visualization
	 */
	updateGroundPreview(startPos, endPos) {
		// Safety checks
		if (!startPos || !endPos) {
			return;
		}

		// Remove existing ground preview if it exists
		this.removeGroundPreview();

		// Don't show a preview if positions aren't valid
		if (startPos.equals(endPos)) return;

		console.time('GroundTool-updateGroundPreview');
		
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
				if (this.isInGroundShape(x, z, minX, maxX, minZ, maxZ, this.groundSides)) {
					totalBlocks += this.groundHeight;
				}
			}
		}
		
		// Use instanced mesh for better performance
		if (totalBlocks > 0) {
			// Create a geometry for the ground preview
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
			
			// Add instances for all points in the area
			for (let x = minX; x <= maxX; x++) {
				for (let z = minZ; z <= maxZ; z++) {
					if (this.isInGroundShape(x, z, minX, maxX, minZ, maxZ, this.groundSides)) {
						for (let y = 0; y < this.groundHeight; y++) {
							matrix.setPosition(x, baseY + y, z);
							instancedMesh.setMatrixAt(instanceIndex++, matrix);
						}
					}
				}
			}
			
			// Update the instance matrix
			instancedMesh.instanceMatrix.needsUpdate = true;
			
			// Store reference to the instanced mesh
			this.groundPreview = instancedMesh;
			
			// Add the preview to the scene
			if (this.scene) {
				this.scene.add(this.groundPreview);
			}
		}
		
		console.timeEnd('GroundTool-updateGroundPreview');
	}

	/**
	 * Updates the ground preview material based on current mode (add or erase)
	 */
	updateGroundPreviewMaterial() {
		// Safety check - if no ground preview exists, nothing to update
		if (!this.groundPreview) {
			return;
		}

		// Red for erase mode, blue for add mode
		const color = this.isCtrlPressed ? 0xff4e4e : 0x4e8eff;
		
		// For instanced mesh, just update the material directly
		if (this.groundPreview.isInstancedMesh) {
			this.groundPreview.material.color.set(color);
		}
	}

	/**
	 * Removes the ground preview from the scene
	 */
	removeGroundPreview() {
		if (this.groundPreview) {
			this.scene.remove(this.groundPreview);
			this.groundPreview = null;
		}
	}

	/**
	 * Cleans up resources when the tool is disposed
	 */
	dispose() {
		console.log('GroundTool: disposing resources');

		// Clean up ground preview meshes
		this.removeGroundPreview();

		// Clear references to avoid memory leaks
		this.terrainRef = null;
		this.currentBlockTypeRef = null;
		this.scene = null;
		this.groundStartPosition = null;
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

export default GroundTool; 