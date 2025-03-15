/**
 * WallTool.js - Tool for placing walls in the world editor
 * 
 * This tool handles wall placement, previewing, and manipulation.
 */

import * as THREE from 'three';
import BaseTool from './BaseTool';

class WallTool extends BaseTool {
	/**
	 * Creates a new WallTool instance
	 */
	constructor(terrainBuilderProps) {
		console.log('WallTool initialized');
		super(terrainBuilderProps);

		// CAREFUL: We need to explicitly get properties from the terrainBuilder
		this.name = "WallTool";
		this.tooltip = "Wall Tool: Click to start, click again to place. Use 1 | 2 to adjust height. Hold Ctrl to erase. Press Q to cancel. ";
		this.wallHeight = 1;
		this.isCtrlPressed = false;
		this.wallStartPosition = null;
		this.wallPreviewMeshes = [];
		this.wallDebugMesh = null;

		// IMPORTANT: Get the required references from the terrainBuilder
		if (terrainBuilderProps) {
			this.terrainRef = terrainBuilderProps.terrainRef;
			this.currentBlockTypeRef = terrainBuilderProps.currentBlockTypeRef;
			this.scene = terrainBuilderProps.scene;
			this.toolManagerRef = terrainBuilderProps.toolManagerRef;
			this.terrainBuilderRef = terrainBuilderProps.terrainBuilderRef;
			
			// Add undoRedoManager reference
			this.undoRedoManager = terrainBuilderProps.undoRedoManager;
			console.log('WallTool: Got undoRedoManager reference:', !!this.undoRedoManager);

			// Add direct references to placement tracking
			this.placementChangesRef = terrainBuilderProps.placementChangesRef;
			this.isPlacingRef = terrainBuilderProps.isPlacingRef;
			console.log('WallTool: Got placementChangesRef:', !!this.placementChangesRef);
			console.log('WallTool: Got isPlacingRef:', !!this.isPlacingRef);

			// Add missing preview position ref
			this.previewPositionRef = terrainBuilderProps.previewPositionRef;
			
			// Set a global reference for tools
			window.activeTool = this.name;

			// Only set up context menu prevention if we have a renderer
		} else {
			console.error('WallTool: terrainBuilderProps is undefined in constructor');
		}
	}

	onActivate() {
		super.onActivate();

		// Log activation details for debugging
		console.log('WallTool activated');
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

		// Reset wall state on activation
		this.wallStartPosition = null;
		this.removeWallPreview();
		
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
		this.removeWallPreview();
		this.wallStartPosition = null;
	}

	/**
	 * Handles mouse down events for wall placement
	 */
	handleMouseDown(event, position, button) {
		// Safety check - if position is undefined, we can't do anything
		if (!position) {
			console.error('WallTool: position is undefined in handleMouseDown');
			return;
		}

		console.log('WallTool: handleMouseDown', {
			button,
			position,
			hasStartPosition: !!this.wallStartPosition,
			isCtrlPressed: this.isCtrlPressed,
			undoRedoManager: !!this.undoRedoManager
		});

		// Left-click to place wall or set starting point
		if (button === 0) {
			if (this.wallStartPosition) {
				// Make sure the terrain reference is valid before placing
				if (!this.terrainRef) {
					console.error('WallTool: terrainRef is undefined when attempting to place wall');
					this.wallStartPosition = null;
					this.removeWallPreview();
					return;
				}

				if (!this.terrainRef.current) {
					console.log('WallTool: terrainRef.current is undefined, initializing empty object');
					this.terrainRef.current = {};
				}

				// Enable placement tracking for undo/redo
				if (this.isPlacingRef) {
					console.log('WallTool: Setting isPlacingRef to true (directly)');
					this.isPlacingRef.current = true;
				}
				
				// Make sure placement changes are initialized
				if (this.placementChangesRef) {
					console.log('WallTool: Ensuring placementChangesRef is initialized (directly)');
					this.placementChangesRef.current = { 
						terrain: { added: {}, removed: {} }, 
						environment: { added: [], removed: [] } 
					};
				} else {
					console.warn('WallTool: placementChangesRef is not available, changes won\'t be tracked for undo/redo');
				}

				// Perform the appropriate action based on Ctrl key state
				let actionPerformed = false;
				if (this.isCtrlPressed) {
					actionPerformed = this.eraseWall(this.wallStartPosition, position, this.wallHeight);
				} else {
					actionPerformed = this.placeWall(this.wallStartPosition, position, this.wallHeight);
				}

				if (!actionPerformed) {
					console.warn('WallTool: Wall action failed');
					return;
				}

				// Save undo state directly
				console.log('WallTool: Saving undo state directly');
				if (this.placementChangesRef) {
					const changes = this.placementChangesRef.current;
					
					// Check if we have undoRedoManager and changes to save
					const hasChanges = 
						Object.keys(changes.terrain.added).length > 0 || 
						Object.keys(changes.terrain.removed).length > 0;
						
					if (hasChanges) {
						// Try using direct undoRedoManager reference first
						if (this.undoRedoManager) {
							console.log('WallTool: Calling saveUndo with direct undoRedoManager reference');
							this.undoRedoManager.saveUndo(changes);
						}
						// Fall back to terrainBuilder reference if available
						else if (this.terrainBuilderRef.current.undoRedoManager) {
							console.log('WallTool: Calling saveUndo via terrainBuilderRef');
							this.terrainBuilderRef.current.undoRedoManager.saveUndo(changes);
						}
						else {
							console.warn('WallTool: No undoRedoManager available, changes won\'t be tracked for undo/redo');
						}
						
						// Reset placement changes after saving
						this.placementChangesRef.current = { 
							terrain: { added: {}, removed: {} }, 
							environment: { added: [], removed: [] } 
						};
					} else {
						console.warn('WallTool: No changes to save');
					}
				} else {
					console.warn('WallTool: placementChangesRef not available, changes won\'t be tracked for undo/redo');
				}

				// Reset the start position for a new wall
				this.wallStartPosition = null;
				this.removeWallPreview();
				
				// Disable placing
				if (this.isPlacingRef) {
					console.log('WallTool: Setting isPlacingRef to false (directly)');
					this.isPlacingRef.current = false;
				}
			} else {
				// Set start position for a new wall
				console.log('Setting wall start position:', position);
				this.wallStartPosition = position.clone();
				
				// Start tracking changes for undo/redo
				if (this.placementChangesRef) {
					console.log('WallTool: Initializing placementChangesRef for new wall (directly)');
					this.placementChangesRef.current = { 
						terrain: { added: {}, removed: {} }, 
						environment: { added: [], removed: [] } 
					};
					
					// Start placement
					if (this.isPlacingRef) {
						console.log('WallTool: Setting isPlacingRef to true for new wall (directly)');
						this.isPlacingRef.current = true;
					}
				} else {
					console.warn('WallTool: placementChangesRef not available at wall start');
				}
			}
		}
	}

	/**
	 * Handles mouse move events for wall preview
	 */
	handleMouseMove(event, position) {
		if (this.wallStartPosition) {
			this.updateWallPreview(this.wallStartPosition, position);
		}
	}

	/**
	 * Updates the wall height
	 */
	setWallHeight(height) {
		console.log('Setting wall height to:', Math.max(1, height));
		this.wallHeight = Math.max(1, height);

		// Update preview if it exists - add safety check for previewPositionRef
		if (this.wallStartPosition && this.previewPositionRef && this.previewPositionRef.current) {
			this.updateWallPreview(this.wallStartPosition, this.previewPositionRef.current);
		} else {
			console.log('Wall preview not updated - missing references:', {
				wallStartPosition: !!this.wallStartPosition,
				previewPositionRef: !!this.previewPositionRef,
				previewPositionRefCurrent: this.previewPositionRef && !!this.previewPositionRef.current
			});
		}
	}

	/**
	 * Track Ctrl key state for erasing and handle wall height adjustments
	 */
	handleKeyDown(event) {
		if (event.key === 'Control') {
			console.log('WallTool: Ctrl pressed, switching to erase mode');
			this.isCtrlPressed = true;
			this.updateWallPreviewMaterial();
		} else if (event.key === '1') {
			console.log('WallTool: Decreasing wall height');
			this.setWallHeight(this.wallHeight - 1);
		} else if (event.key === '2') {
			console.log('WallTool: Increasing wall height');
			this.setWallHeight(this.wallHeight + 1);
		} else if (event.key === 'q') {
			this.removeWallPreview();
			this.wallStartPosition = null;
		}
	}

	/**
	 * Handle key up events for the tool
	 */
	handleKeyUp(event) {
		if (event.key === 'Control') {
			console.log('WallTool: Ctrl released, switching to build mode');
			this.isCtrlPressed = false;
			this.updateWallPreviewMaterial();
		}
	}

	/**
	 * Place a wall on the terrain
	 * @param {THREE.Vector3} startPos - The starting position of the wall
	 * @param {THREE.Vector3} endPos - The ending position of the wall
	 * @param {number} height - The height of the wall
	 * @returns {boolean} True if the wall was placed, false otherwise
	 */
	placeWall(startPos, endPos, height) {
		console.log('WallTool: Placing wall from', startPos, 'to', endPos, 'with height', height);

		if (!startPos || !endPos) {
			console.error('WallTool: Invalid start or end position for placing');
			return false;
		}

		// Ensure the terrainRef is available
		if (!this.terrainRef || !this.terrainRef.current) {
			console.error('WallTool: terrainRef not available for placing');
			return false;
		}

		// Ensure we have a block type to place
		if (!this.currentBlockTypeRef || !this.currentBlockTypeRef.current) {
			console.error('WallTool: No block type to place');
			return false;
		}

		// Convert positions to integers
		const startX = Math.round(startPos.x), startY = Math.round(startPos.y), startZ = Math.round(startPos.z);
		const endX = Math.round(endPos.x), endZ = Math.round(endPos.z);

		// Calculate direction vector
		const dx = Math.sign(endX - startX);
		const dz = Math.sign(endZ - startZ);

		const addedBlocks = {};
		const blockType = this.currentBlockTypeRef.current.id;

		// Helper function to place a column of blocks
		const placeColumn = (x, z) => {
			for (let y = 0; y < height; y++) {
				const pos = `${x},${startY + y},${z}`;
				if (!this.terrainRef.current[pos]) {
					this.terrainRef.current[pos] = blockType;
					addedBlocks[pos] = blockType;
				}
			}
		};

		// Iterate along the path (including endpoint)
		for (let x = startX, z = startZ; x !== endX || z !== endZ; x += (x !== endX ? dx : 0), z += (z !== endZ ? dz : 0)) {
			placeColumn(x, z);
		}

		// Ensure the final column is placed
		placeColumn(endX, endZ);

		console.log(`WallTool: Added ${Object.keys(addedBlocks).length} blocks to terrain`);
		
		// If no blocks were added, return false
		if (Object.keys(addedBlocks).length === 0) {
			console.warn('WallTool: No blocks were added during wall placement');
			return false;
		}

		// Update the terrain with added blocks
		if (this.terrainBuilderRef && this.terrainBuilderRef.current && this.terrainBuilderRef.current.updateTerrainBlocks) {
			this.terrainBuilderRef.current.updateTerrainBlocks(
				addedBlocks,
				{},
				this.currentBlockTypeRef.current.id
			);
		} else {
			console.error('WallTool: Cannot update terrain - terrainBuilderRef not available');
			return false;
		}

		// Add to placement changes for undo/redo
		if (this.placementChangesRef) {
			console.log('WallTool: Adding placed blocks to placementChangesRef (directly)');
			Object.entries(addedBlocks).forEach(([key, value]) => {
				this.placementChangesRef.current.terrain.added[key] = value;
			});
			
			// Log the current state of placement changes
			const added = Object.keys(this.placementChangesRef.current.terrain.added).length;
			const removed = Object.keys(this.placementChangesRef.current.terrain.removed).length;
			console.log(`WallTool: placementChangesRef now has ${added} added and ${removed} removed blocks`);
		} else {
			console.warn('WallTool: placementChangesRef not available, changes won\'t be tracked for undo/redo');
		}

		return true;
	}

	/**
	 * Erase a wall from the terrain
	 * @param {THREE.Vector3} startPos - The starting position of the wall
	 * @param {THREE.Vector3} endPos - The ending position of the wall
	 * @param {number} height - The height of the wall
	 * @returns {boolean} True if the wall was erased, false otherwise
	 */
	eraseWall(startPos, endPos, height) {
		console.log('WallTool: Erasing wall from', startPos, 'to', endPos, 'with height', height);

		if (!startPos || !endPos) {
			console.error('Invalid start or end position for erasing');
			return false;
		}

		// Ensure the terrainRef is available
		if (!this.terrainRef || !this.terrainRef.current) {
			console.error('WallTool: terrainRef not available for erasing');
			return false;
		}

		// Convert positions to integers
		const startX = Math.round(startPos.x), startY = Math.round(startPos.y), startZ = Math.round(startPos.z);
		const endX = Math.round(endPos.x), endY = Math.round(endPos.y), endZ = Math.round(endPos.z);

		console.log(`Erasing wall from ${startX}, ${startY}, ${startZ} to ${endX}, ${endY}, ${endZ}`);

		const removedBlocks = {};
		const dx = Math.sign(endX - startX);
		const dz = Math.sign(endZ - startZ);

		// Helper function to erase a column at a given (x, z)
		const eraseColumn = (x, z) => {
			for (let h = 0; h < height; h++) {
				const posKey = `${x},${startY + h},${z}`;
				if (this.terrainRef.current[posKey]) {
					removedBlocks[posKey] = this.terrainRef.current[posKey];
					delete this.terrainRef.current[posKey];
				}
			}
		};

		// Erase along the path
		let x = startX, z = startZ;
		while (x !== endX || z !== endZ) {
			eraseColumn(x, z);
			if (x !== endX) x += dx;
			if (z !== endZ) z += dz;
		}

		// Erase the final column at the endpoint
		eraseColumn(endX, endZ);

		console.log(`WallTool: Removed ${Object.keys(removedBlocks).length} blocks from terrain`);
		
		// If no blocks were removed, return false
		if (Object.keys(removedBlocks).length === 0) {
			console.warn('WallTool: No blocks were removed during wall erasure');
			return false;
		}

		// Update the terrain with removed blocks
		if (this.terrainBuilderRef && this.terrainBuilderRef.current && this.terrainBuilderRef.current.updateTerrainBlocks) {
			this.terrainBuilderRef.current.updateTerrainBlocks(
				{},
				removedBlocks
			);
		} else {
			console.error('WallTool: Cannot update terrain - terrainBuilderRef not available');
			return false;
		}

		// Add to placement changes for undo/redo
		if (this.placementChangesRef) {
			console.log('WallTool: Adding removed blocks to placementChangesRef (directly)');
			Object.entries(removedBlocks).forEach(([key, value]) => {
				this.placementChangesRef.current.terrain.removed[key] = value;
			});
			
			// Log the current state of placement changes
			const added = Object.keys(this.placementChangesRef.current.terrain.added).length;
			const removed = Object.keys(this.placementChangesRef.current.terrain.removed).length;
			console.log(`WallTool: placementChangesRef now has ${added} added and ${removed} removed blocks`);
		} else {
			console.warn('WallTool: placementChangesRef not available, changes won\'t be tracked for undo/redo');
		}

		return true;
	}

	/**
	 * Updates the wall preview visualization
	 */
	updateWallPreview(startPos, endPos) {
		// Safety checks
		if (!startPos || !endPos) {
			return;
		}

		// Remove existing wall preview if it exists
		this.removeWallPreview();

		// Don't show a preview if positions aren't valid
		if (startPos.equals(endPos)) return;

		// Create a geometry for the wall preview
		const previewGeometry = new THREE.BoxGeometry(1, 1, 1);

		// Use different color based on whether Ctrl is pressed (erase mode)
		const previewMaterial = new THREE.MeshBasicMaterial({
			color: this.isCtrlPressed ? 0xff4e4e : 0x4e8eff, // Red for erase, blue for add
			transparent: true,
			opacity: 0.5,
			wireframe: false
		});

		// Create a group to hold all preview blocks
		this.wallPreview = new THREE.Group();

		// Convert positions to integers for block placement
		const startX = Math.round(startPos.x);
		const startY = Math.round(startPos.y);
		const startZ = Math.round(startPos.z);

		const endX = Math.round(endPos.x);
		const endZ = Math.round(endPos.z);

		// Calculate direction vector
		const dx = Math.sign(endX - startX);
		const dz = Math.sign(endZ - startZ);

		// Start at the start position
		let x = startX;
		let z = startZ;

		// Iterate along the path until we reach the end position
		while (x !== endX || z !== endZ) {
			// For each position along the path, create a column of preview blocks
			for (let y = 0; y < this.wallHeight; y++) {
				const previewMesh = new THREE.Mesh(previewGeometry, previewMaterial);
				previewMesh.position.set(x, startY + y, z);
				this.wallPreview.add(previewMesh);
			}

			// Move to the next position along the path
			if (x !== endX) x += dx;
			if (z !== endZ) z += dz;
		}

		// Add preview blocks for the end position
		for (let y = 0; y < this.wallHeight; y++) {
			const previewMesh = new THREE.Mesh(previewGeometry, previewMaterial);
			previewMesh.position.set(endX, startY + y, endZ);
			this.wallPreview.add(previewMesh);
		}

		// Add the preview to the scene
		if (this.scene) {
			this.scene.add(this.wallPreview);
		}
	}

	/**
	 * Updates the wall preview material based on current mode (add or erase)
	 */
	updateWallPreviewMaterial() {
		// Safety check - if no wall preview exists, nothing to update
		if (!this.wallPreview || !this.wallPreview.children) {
			return;
		}

		// Red for erase mode, blue for add mode
		const color = this.isCtrlPressed ? 0xff4e4e : 0x4e8eff;

		// Update the color of each mesh in the preview
		this.wallPreview.children.forEach(mesh => {
			if (mesh && mesh.material) {
				mesh.material.color.set(color);
			}
		});
	}

	/**
	 * Removes the wall preview from the scene
	 */
	removeWallPreview() {
		if (this.wallPreview) {
			this.scene.remove(this.wallPreview);
			this.wallPreview = null;
		}
	}

	/**
	 * Cleans up resources when the tool is disposed
	 */
	dispose() {
		console.log('WallTool: disposing resources');

		// Remove event listeners

		// Clean up wall preview meshes
		this.removeWallPreview();

		// Clear references to avoid memory leaks
		this.terrainRef = null;
		this.currentBlockTypeRef = null;
		this.scene = null;
		this.renderer = null;
		this.wallStartPosition = null;
		this.wallPreviewMeshes = [];
		this.toolManagerRef = null;
		this.terrainBuilderRef = null;

		// Call parent dispose method
		super.dispose();
	}
}

export default WallTool; 