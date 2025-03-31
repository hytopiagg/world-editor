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
			console.log('WallTool: undoRedoManager is ref:', this.undoRedoManager && 'current' in this.undoRedoManager);
			console.log('WallTool: undoRedoManager.current exists:', this.undoRedoManager && !!this.undoRedoManager.current);
			console.log('WallTool: undoRedoManager.current has saveUndo:', 
				this.undoRedoManager && 
				this.undoRedoManager.current && 
				typeof this.undoRedoManager.current.saveUndo === 'function');

			// Direct access to saveUndo function
			this.saveUndoFunction = terrainBuilderProps.saveUndoFunction;
			console.log('WallTool: Got saveUndoFunction:', !!this.saveUndoFunction);

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
		// Safety check - use previewPositionRef for accurate placement
		if (!this.previewPositionRef || !this.previewPositionRef.current) {
			console.error('WallTool: previewPositionRef is undefined in handleMouseDown');
			return;
		}
		// Use the accurate cursor position from TerrainBuilder
		const currentPosition = this.previewPositionRef.current;

		console.log('WallTool: handleMouseDown', {
			button,
			position: currentPosition, // Use accurate position
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
					actionPerformed = this.eraseWall(this.wallStartPosition, currentPosition, this.wallHeight); // Use accurate position
				} else {
					actionPerformed = this.placeWall(this.wallStartPosition, currentPosition, this.wallHeight); // Use accurate position
				}

				if (!actionPerformed) {
					console.warn('WallTool: Wall action failed');
					return;
				}

				// Reset wall state
				this.wallStartPosition = null;
				this.removeWallPreview();
			} else {
				// Set starting point
				console.log('Setting wall start position:', currentPosition); // Use accurate position
				this.wallStartPosition = currentPosition.clone();
				this.updateWallPreview(this.wallStartPosition, currentPosition); // Use accurate position
			}
		}
	}

	handleMouseUp(event, position, button) {
		// Only process if we were actually placing blocks
		if (this.isPlacingRef?.current) {
			// Stop placing blocks
			this.isPlacingRef.current = false;
			
			// Save changes to undo stack if there are any changes
			if (this.placementChangesRef?.current) {
				const changes = this.placementChangesRef.current;
				
				// Check if we have undoRedoManager and changes to save
				if (changes && 
					(Object.keys(changes.terrain.added || {}).length > 0 || 
					Object.keys(changes.terrain.removed || {}).length > 0)) {
					
					console.log('WallTool: Saving changes to undo stack:', changes);
					
					// Try using undoRedoManager reference
					if (this.undoRedoManager?.current?.saveUndo) {
						console.log('WallTool: Calling saveUndo with undoRedoManager.current');
						this.undoRedoManager.current.saveUndo(changes);
					}
					else if (this.terrainBuilderRef?.current?.undoRedoManager?.current?.saveUndo) {
						console.log('WallTool: Calling saveUndo with terrainBuilderRef fallback');
						this.terrainBuilderRef.current.undoRedoManager.current.saveUndo(changes);
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
			}
		}
	}

	/**
	 * Handles mouse move events for wall preview
	 */
	handleMouseMove(event, position) {
		// Use the accurate preview position for the end point
		if (this.wallStartPosition && this.previewPositionRef && this.previewPositionRef.current) {
			this.updateWallPreview(this.wallStartPosition, this.previewPositionRef.current);
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
			console.error('Invalid start or end position for wall placement');
			return false;
		}

		// Early validation of references
		if (!this.terrainBuilderRef || !this.terrainBuilderRef.current) {
			console.error('WallTool: Cannot place wall - terrainBuilderRef not available');
			return false;
		}

		// Get current block type ID from the reference
		const blockTypeId = this.currentBlockTypeRef.current.id;
		
		// Use Bresenham's line algorithm to draw line on the ground
		const points = this.getLinePoints(
			Math.round(startPos.x),
			Math.round(startPos.z),
			Math.round(endPos.x),
			Math.round(endPos.z)
		);

		// Performance optimization: Batch process all blocks
		console.time('WallTool-placeWall');
		
		// Track any blocks added for state tracking and undo/redo
		const addedBlocks = {};
		const baseY = Math.round(startPos.y);
		
		// First collect all blocks to add
		for (const point of points) {
			const [x, z] = point;
			for (let y = 0; y < height; y++) {
				const posKey = `${x},${baseY + y},${z}`;
				// Skip if block already exists
				if (this.terrainRef.current[posKey]) continue;
				
				// Add to our batch
				addedBlocks[posKey] = blockTypeId;
			}
		}
		
		// If no blocks were added, return false
		if (Object.keys(addedBlocks).length === 0) {
			console.warn('WallTool: No blocks were added during wall placement');
			return false;
		}
		
		console.log(`WallTool: Adding ${Object.keys(addedBlocks).length} blocks in batch`);
		
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
			console.log('WallTool: Explicitly updating spatial hash after placement');
			this.terrainBuilderRef.current.updateSpatialHashForBlocks(addedBlocksArray, [], { force: true });
		}
		
		// Add to placement changes for undo/redo
		if (this.placementChangesRef) {
			console.log('WallTool: Adding placed blocks to placementChangesRef');
			Object.entries(addedBlocks).forEach(([key, value]) => {
				this.placementChangesRef.current.terrain.added[key] = value;
			});
			
			// Log the current state of placement changes
			const added = Object.keys(this.placementChangesRef.current.terrain.added).length;
			const removed = Object.keys(this.placementChangesRef.current.terrain.removed).length;
			console.log(`WallTool: placementChangesRef now has ${added} added and ${removed} removed blocks`);
		}
		
		console.timeEnd('WallTool-placeWall');
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

		// Early validation of references
		if (!this.terrainBuilderRef || !this.terrainBuilderRef.current) {
			console.error('WallTool: Cannot erase wall - terrainBuilderRef not available');
			return false;
		}

		// Use Bresenham's line algorithm to get all points on the line
		const points = this.getLinePoints(
			Math.round(startPos.x),
			Math.round(startPos.z),
			Math.round(endPos.x),
			Math.round(endPos.z)
		);

		// Performance optimization: Batch process all blocks
		console.time('WallTool-eraseWall');
		
		// Track any blocks removed for state tracking and undo/redo
		const removedBlocks = {};
		const baseY = Math.round(startPos.y);
		
		// First collect all blocks to remove
		for (const point of points) {
			const [x, z] = point;
			for (let y = 0; y < height; y++) {
				const posKey = `${x},${baseY + y},${z}`;
				// Skip if no block exists
				if (!this.terrainRef.current[posKey]) continue;
				
				// Add to our batch
				removedBlocks[posKey] = this.terrainRef.current[posKey];
			}
		}
		
		// If no blocks were found to remove, return false
		if (Object.keys(removedBlocks).length === 0) {
			console.warn('WallTool: No blocks were found to remove during wall erasure');
			return false;
		}
		
		console.log(`WallTool: Removing ${Object.keys(removedBlocks).length} blocks in batch`);
		
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
			console.log('WallTool: Explicitly updating spatial hash after erasure');
			this.terrainBuilderRef.current.updateSpatialHashForBlocks([], removedBlocksArray, { force: true });
		}
		
		// Add to placement changes for undo/redo
		if (this.placementChangesRef) {
			console.log('WallTool: Adding removed blocks to placementChangesRef');
			Object.entries(removedBlocks).forEach(([key, value]) => {
				this.placementChangesRef.current.terrain.removed[key] = value;
			});
			
			// Log the current state of placement changes
			const added = Object.keys(this.placementChangesRef.current.terrain.added).length;
			const removed = Object.keys(this.placementChangesRef.current.terrain.removed).length;
			console.log(`WallTool: placementChangesRef now has ${added} added and ${removed} removed blocks`);
		}
		
		console.timeEnd('WallTool-eraseWall');
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

		console.time('WallTool-updateWallPreview');
		
		// Use Bresenham's line algorithm to get all points on the line
		const points = this.getLinePoints(
			Math.round(startPos.x),
			Math.round(startPos.z),
			Math.round(endPos.x),
			Math.round(endPos.z)
		);
		
		// Calculate how many instances we'll need
		const totalBlocks = points.length * this.wallHeight;
		
		// Use instanced mesh for better performance
		if (totalBlocks > 0) {
			// Create a geometry for the wall preview
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
			const baseY = Math.round(startPos.y);
			const matrix = new THREE.Matrix4();
			
			// Add instances for all points on the line
			for (const point of points) {
				const [x, z] = point;
				for (let y = 0; y < this.wallHeight; y++) {
					matrix.setPosition(x, baseY + y, z);
					instancedMesh.setMatrixAt(instanceIndex++, matrix);
				}
			}
			
			// Update the instance matrix
			instancedMesh.instanceMatrix.needsUpdate = true;
			
			// Store reference to the instanced mesh
			this.wallPreview = instancedMesh;
			
			// Add the preview to the scene
			if (this.scene) {
				this.scene.add(this.wallPreview);
			}
		}
		
		console.timeEnd('WallTool-updateWallPreview');
	}

	/**
	 * Updates the wall preview material based on current mode (add or erase)
	 */
	updateWallPreviewMaterial() {
		// Safety check - if no wall preview exists, nothing to update
		if (!this.wallPreview) {
			return;
		}

		// Red for erase mode, blue for add mode
		const color = this.isCtrlPressed ? 0xff4e4e : 0x4e8eff;
		
		// For instanced mesh, just update the material directly
		if (this.wallPreview.isInstancedMesh) {
			this.wallPreview.material.color.set(color);
		}
		// Fallback for group with children (legacy support)
		else if (this.wallPreview.children) {
			// Update the color of each mesh in the preview
			this.wallPreview.children.forEach(mesh => {
				if (mesh && mesh.material) {
					mesh.material.color.set(color);
				}
			});
		}
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

	// Helper function to place a column of blocks
	placeColumn(x, z, baseY, height, addedBlocksTracker) {
		// Get current block type ID from the reference
		const blockTypeId = this.currentBlockTypeRef.current.id;

		// Create a column of blocks from baseY up to the specified height
		baseY = Math.round(baseY);
		
		for (let y = 0; y < height; y++) {
			const posKey = `${x},${baseY + y},${z}`;
			// Skip if block already exists
			if (this.terrainRef.current[posKey]) continue;
			
			// Add to our terrain data structure
			this.terrainRef.current[posKey] = blockTypeId;
			
			// Track for undo/redo
			if (addedBlocksTracker) {
				addedBlocksTracker[posKey] = blockTypeId;
			}
		}
	}

	// Implement Bresenham's line algorithm to get all points on a line
	getLinePoints(x0, z0, x1, z1) {
		const points = [];
		const dx = Math.abs(x1 - x0);
		const dz = Math.abs(z1 - z0);
		const sx = x0 < x1 ? 1 : -1;
		const sz = z0 < z1 ? 1 : -1;
		let err = dx - dz;
		
		while (true) {
			points.push([x0, z0]);
			
			if (x0 === x1 && z0 === z1) break;
			
			const e2 = 2 * err;
			if (e2 > -dz) {
				err -= dz;
				x0 += sx;
			}
			if (e2 < dx) {
				err += dx;
				z0 += sz;
			}
		}
		
		return points;
	}
}

export default WallTool; 