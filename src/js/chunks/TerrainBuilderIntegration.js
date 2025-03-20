// TerrainBuilderIntegration.js
// Integration of the chunk system with TerrainBuilder

import ChunkSystem from './ChunkSystem';
import { CHUNK_SIZE } from './ChunkConstants';
import * as THREE from 'three';

/**
 * Integrates the chunk system with TerrainBuilder
 * 
 * Usage in TerrainBuilder:
 * 
 * 1. Import this file:
 *    import { initChunkSystem, updateTerrainChunks, updateTerrainBlocks, processChunkRenderQueue } from './chunks/TerrainBuilderIntegration';
 * 
 * 2. Initialize the chunk system in the TerrainBuilder component:
 *    useEffect(() => {
 *      const scene = sceneRef.current;
 *      if (scene) {
 *        initChunkSystem(scene, { viewDistance: getViewDistance() });
 *      }
 *    }, [sceneRef.current]);
 * 
 * 3. Update the chunk system when terrain changes:
 *    updateTerrainChunks(terrainRef.current);
 * 
 * 4. Update the chunk system when blocks are added or removed:
 *    updateTerrainBlocks(addedBlocks, removedBlocks);
 * 
 * 5. Process the render queue in the animation loop:
 *    const animate = () => {
 *      processChunkRenderQueue();
 *      // ... other animation code
 *    };
 */

// The chunk system instance
let chunkSystem = null;

/**
 * Initialize the chunk system
 * @param {Object} scene - The THREE.js scene
 * @param {Object} options - Options for the chunk system
 * @returns {Promise<ChunkSystem>} The chunk system
 */
export const initChunkSystem = async (scene, options = {}) => {
	if (!chunkSystem) {
		chunkSystem = new ChunkSystem(scene, options);
		await chunkSystem.initialize();

		// The setupConsoleFiltering is now called during ChunkSystem initialization
		// No need to call it here anymore

		console.log('Chunk system initialized with options:', options);
	}
	return chunkSystem;
};

/**
 * Get the chunk system instance
 * @returns {ChunkSystem|null} The chunk system
 */
export const getChunkSystem = () => {
	return chunkSystem;
};

/**
 * Update the camera in the chunk system
 * This is necessary for view distance culling calculations
 * @param {Object} camera - The THREE.js camera
 */
export const updateChunkSystemCamera = (camera) => {
	if (chunkSystem && chunkSystem._scene) {
		chunkSystem._scene.camera = camera;
	}
};

/**
 * Process the chunk render queue
 * Should be called in the animation loop
 */
export const processChunkRenderQueue = () => {
	if (!chunkSystem) {
		console.error("Chunk system not available for render queue processing");
		return;
	}

	// Ensure camera is correctly set
	if (!chunkSystem._scene.camera) {
		console.error("Camera not set in chunk system - cannot process render queue properly");
		return;
	}

	// Make sure camera matrices are up to date before processing
	if (chunkSystem._scene.camera) {
		const camera = chunkSystem._scene.camera;
		camera.updateMatrixWorld(true);
		camera.updateProjectionMatrix();

		// Generate a new frustum object for visibility culling
		const projScreenMatrix = new THREE.Matrix4();
		projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		const frustum = new THREE.Frustum();
		frustum.setFromProjectionMatrix(projScreenMatrix);

		// Store the frustum in the chunk system for visibility checks
		chunkSystem._frustum = frustum;


	} else {
		console.warn("No camera set in chunk system for render queue processing");
	}

	// Process the render queue
	chunkSystem.processRenderQueue();

	// Force visibility update for all chunks if camera has moved significantly
	// This is checked internally by the chunk manager
};

/**
 * Update the chunk system from terrain data
 * @param {Object} terrainData - The terrain data in format { "x,y,z": blockId }
 */
export const updateTerrainChunks = (terrainData) => {
	if (chunkSystem) {
		chunkSystem.updateFromTerrainData(terrainData);
	}
};

/**
 * Update terrain blocks in the chunk system
 * @param {Object} addedBlocks - The blocks that were added
 * @param {Object} removedBlocks - The blocks that were removed
 */
export const updateTerrainBlocks = (addedBlocks = {}, removedBlocks = {}) => {
	if (!chunkSystem) {
		console.warn('Chunk system not initialized, skipping updateTerrainBlocks');
		return;
	}

	if (!chunkSystem._initialized) {
		console.warn('Chunk system not fully initialized, skipping updateTerrainBlocks');
		return;
	}

	console.time('TerrainBuilderIntegration.updateTerrainBlocks');
	console.log(`TerrainBuilderIntegration.updateTerrainBlocks: Processing ${Object.keys(addedBlocks).length} added blocks and ${Object.keys(removedBlocks).length} removed blocks`);

	// Convert added blocks to the format expected by ChunkSystem
	console.time('TerrainBuilderIntegration.updateTerrainBlocks-conversion');
	const addedBlocksArray = Object.entries(addedBlocks).map(([posKey, blockId]) => {
		const [x, y, z] = posKey.split(',').map(Number);
		return {
			id: blockId,
			position: [x, y, z]
		};
	});

	// Convert removed blocks to the format expected by ChunkSystem
	const removedBlocksArray = Object.entries(removedBlocks).map(([posKey, blockId]) => {
		const [x, y, z] = posKey.split(',').map(Number);
		return {
			id: blockId,
			position: [x, y, z]
		};
	});
	console.timeEnd('TerrainBuilderIntegration.updateTerrainBlocks-conversion');

	// Update the chunk system
	console.time('TerrainBuilderIntegration.updateTerrainBlocks-chunkSystemUpdate');
	chunkSystem.updateBlocks(addedBlocksArray, removedBlocksArray);
	console.timeEnd('TerrainBuilderIntegration.updateTerrainBlocks-chunkSystemUpdate');

	console.timeEnd('TerrainBuilderIntegration.updateTerrainBlocks');
};

/**
 * Set the view distance
 * @param {number} distance - The view distance
 */
export const setChunkViewDistance = (distance) => {
	if (chunkSystem) {
		chunkSystem.setViewDistance(distance);
	}
};

/**
 * Enable or disable view distance culling
 * @param {boolean} enabled - Whether view distance culling is enabled
 */
export const setChunkViewDistanceEnabled = (enabled) => {
	if (chunkSystem) {
		chunkSystem.setViewDistanceEnabled(enabled);
	}
};

/**
 * Get the block ID at a position
 * @param {Array|Object} position - The position [x, y, z] or {x, y, z}
 * @returns {number} The block ID
 */
export const getBlockId = (position) => {
	if (!chunkSystem) return 0;

	// Convert position object to array if needed
	const pos = Array.isArray(position)
		? position
		: [position.x, position.y, position.z];

	return chunkSystem.getBlockId(pos);
};

/**
 * Check if a block exists at a position
 * @param {Array|Object} position - The position [x, y, z] or {x, y, z}
 * @returns {boolean} True if a block exists
 */
export const hasBlock = (position) => {
	if (!chunkSystem) return false;

	// Convert position object to array if needed
	const pos = Array.isArray(position)
		? position
		: [position.x, position.y, position.z];

	return chunkSystem.hasBlock(pos);
};

/**
 * Clear all chunks from the chunk system
 */
export const clearChunks = () => {
	if (chunkSystem) {
		chunkSystem.clearChunks();
	}
};

/**
 * Check if a chunk is visible
 * @param {string} chunkKey - The chunk key in format "x,y,z"
 * @returns {boolean} True if the chunk is visible
 */
export const isChunkVisible = (chunkKey) => {
	if (!chunkSystem) return false;

	const [x, y, z] = chunkKey.split(',').map(Number);
	const chunk = chunkSystem._chunkManager._chunks.get(chunkKey);

	return chunk ? chunk.visible : false;
};

/**
 * Get the chunk key for a position
 * @param {number} x - The x coordinate
 * @param {number} y - The y coordinate
 * @param {number} z - The z coordinate
 * @returns {string} The chunk key
 */
export const getChunkKey = (x, y, z) => {
	const cx = Math.floor(x / CHUNK_SIZE) * CHUNK_SIZE;
	const cy = Math.floor(y / CHUNK_SIZE) * CHUNK_SIZE;
	const cz = Math.floor(z / CHUNK_SIZE) * CHUNK_SIZE;
	return `${cx},${cy},${cz}`;
};

/**
 * Force update all chunk visibility based on current camera position
 * This bypasses normal render queue processing and forces an immediate update
 * @returns {Object|null} Statistics about the update or null if failed
 */
export const forceUpdateChunkVisibility = () => {
	if (!chunkSystem) {
		console.error("Chunk system not available for forced visibility update");
		return null;
	}

	return chunkSystem.forceUpdateChunkVisibility();
}; 