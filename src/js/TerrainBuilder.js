import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { playPlaceSound } from "./Sound";
import { cameraManager } from "./Camera";
import { DatabaseManager, STORES } from "./DatabaseManager";
import { THRESHOLD_FOR_PLACING, BLOCK_INSTANCED_MESH_CAPACITY } from "./Constants";
import { refreshBlockTools } from "./components/BlockToolsSidebar";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import { TextureAtlas, ChunkMeshBuilder, ChunkLoadManager } from "./TextureAtlas";
import { loadingManager } from './LoadingManager';

// Import tools
import { ToolManager, WallTool } from "./tools";

// Define chunk constants
const CHUNK_SIZE = 16;
const CHUNK_BLOCK_CAPACITY = BLOCK_INSTANCED_MESH_CAPACITY / 8; // Smaller capacity per chunk
const FRUSTUM_CULLING_DISTANCE = 64; // Increase view distance for less pop-in
const MAX_SELECTION_DISTANCE = 32; // Maximum distance for block selection (in blocks)

// Selection distance for raycasting
let selectionDistance = MAX_SELECTION_DISTANCE; // Store the current value
export const getSelectionDistance = () => selectionDistance;
export const setSelectionDistance = (distance) => {
  const newDistance = Math.max(16, Math.min(256, distance)); // Clamp between 16 and 256
  selectionDistance = newDistance;
  console.log(`Selection distance set to ${newDistance} blocks`);
  return newDistance;
};

// View distance for frustum culling
let viewDistance = FRUSTUM_CULLING_DISTANCE; // Store the current value
export const getViewDistance = () => viewDistance;
export const setViewDistance = (distance) => {
  const newDistance = Math.max(32, Math.min(256, distance)); // Clamp between 32 and 256
  viewDistance = newDistance;
  console.log(`View distance set to ${newDistance} blocks`);
  return newDistance;
};

// Helper function to get chunk key from position
const getChunkKey = (x, y, z) => {
	return `${Math.floor(x / CHUNK_SIZE)},${Math.floor(y / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
};

// Greedy meshing constants - use ref later to allow runtime toggling
let GREEDY_MESHING_ENABLED = true; // Enable greedy meshing by default for better performance
let meshesNeedsRefresh = false;

// Get or set the greedy meshing state
export const getGreedyMeshingEnabled = () => GREEDY_MESHING_ENABLED;
export const setGreedyMeshingEnabled = (enabled) => {
    const changed = GREEDY_MESHING_ENABLED !== enabled;
    GREEDY_MESHING_ENABLED = enabled;
    return changed;
};

// Modify the blockTypes definition to be a function that can be updated
let blockTypesArray = (() => {
	const textureContext = require.context("../../public/assets/blocks", true, /\.(png|jpe?g)$/);
	const texturePaths = textureContext.keys();
	const blockMap = new Map();
	let idCounter = 1;

	texturePaths.forEach((path) => {
		// Skip environment and error textures
		if (path.includes("environment") || path.includes("error")) {
			return;
		}

		const match = path.match(/^\.\/(.+?)(\/[+-][xyz])?\.png$/);
		if (match) {
			const [, fullName, side] = match;
			const parts = fullName.split("/");
			const blockName = parts.length > 1 ? parts[0] : fullName.replace(/\.[^/.]+$/, "");

			if (!blockMap.has(blockName)) {
				blockMap.set(blockName, {
					id: idCounter++,
					name: blockName,
					textureUri: `./assets/blocks/${blockName}.png`,
					sideTextures: {},
				});
			}

			if (side) {
				const sideKey = side.slice(1);
				blockMap.get(blockName).sideTextures[sideKey] = `./assets/blocks/${blockName}${side}.png`;
			}
		}
	});

	return Array.from(blockMap.values()).map((block) => ({
		...block,
		isMultiTexture: Object.keys(block.sideTextures).length > 0,
		isEnvironment: false,
		hasMissingTexture: block.textureUri === "./assets/blocks/error.png",
	}));
})();

//// function to handle the adding/updating of a custom block
export const processCustomBlock = (block) => {
	// Validate block data
	if (!block || !block.name || !block.textureUri) {
		console.error("Invalid block data:", block);
		return;
	}

	// Find existing block with same name or ID
	let existingBlock = null;
	
	// If block has an ID, try to find by ID first
	if (block.id) {
		existingBlock = blockTypesArray.find(b => b.id === block.id);
		if (existingBlock) {
			console.log(`Found existing block with ID ${block.id}`);
		}
	}
	
	// If not found by ID, try to find by name
	if (!existingBlock) {
		existingBlock = blockTypesArray.find(b => b.name === block.name);
		if (existingBlock) {
			console.log(`Found existing block with name ${block.name}`);
		}
	}

	if (existingBlock) {
		// If block exists, update it
		existingBlock.textureUri = block.textureUri;
		existingBlock.hasMissingTexture = false;
		existingBlock.isMultiTexture = block.isMultiTexture || false;
		existingBlock.sideTextures = block.sideTextures || {};
		existingBlock.isCustom = true;

		/// if the texture uri is not a data uri, then we need to set it to the error texture
		if(!existingBlock.textureUri.startsWith('data:image/'))
		{
			console.error(`Texture failed to load for block ${existingBlock.name}, using error texture`);
			existingBlock.textureUri = "./assets/blocks/error.png";
			existingBlock.hasMissingTexture = true;
		}
	
		// Save only custom blocks to database
		const customBlocksOnly = blockTypesArray.filter(b => b.isCustom);
		DatabaseManager.saveData(STORES.CUSTOM_BLOCKS, 'blocks', customBlocksOnly)
			.catch(error => console.error("Error saving updated blocks:", error));
		
		meshesNeedsRefresh = true;
		console.log("Updated block:", existingBlock.name);
		return existingBlock;
	}

	// Add new block with ID in custom block range (100-199)
	const newBlock = {
		id: block.id || Math.max(...blockTypesArray.filter(b => b.id >= 100).map(b => b.id), 99) + 1, // Use provided ID or generate new one
		name: block.name,
		textureUri: block.textureUri,
		isCustom: true,
		isMultiTexture: block.isMultiTexture || false,
		
		sideTextures: block.sideTextures || {},
		hasMissingTexture: false
	};

	/// if the texture uri is not a data uri, then we need to set it to the error texture
	if(!newBlock.textureUri.startsWith('data:image/'))
	{
		console.error(`Texture failed to load for block ${newBlock.name}, using error texture`);
		newBlock.textureUri = "./assets/blocks/error.png";
		newBlock.hasMissingTexture = true;
	}

	// Validate ID is in custom block range
	if (newBlock.id < 100 || newBlock.id >= 200) {
		console.error("Invalid custom block ID:", newBlock.id);
		return;
	}

	// Add the new block to the blockTypesArray
	blockTypesArray.push(newBlock);

	// Save only custom blocks to database
	const customBlocksOnly = blockTypesArray.filter(b => b.isCustom);
	DatabaseManager.saveData(STORES.CUSTOM_BLOCKS, 'blocks', customBlocksOnly)
		.catch(error => console.error("Error saving custom blocks:", error));

	meshesNeedsRefresh = true;
	refreshBlockTools();
	
	console.log("Added new custom block:", newBlock);
	return newBlock;
};

// Add function to remove custom blocks
export const removeCustomBlock = (blockIdToRemove) => {
	// Convert input to array if it's not already
	const idsToRemove = Array.isArray(blockIdToRemove) ? blockIdToRemove : [blockIdToRemove];
	
	// Validate that all IDs are in the custom block range (100-199)
	const invalidIds = idsToRemove.filter(id => id < 100 || id >= 200);
	if (invalidIds.length > 0) {
		console.error('Cannot remove non-custom blocks with IDs:', invalidIds);
		return;
	}

	// Remove the specified blocks
	blockTypesArray = blockTypesArray.filter(block => !idsToRemove.includes(block.id));

	// Save the updated blockTypesArray to the database
	DatabaseManager.saveData(STORES.CUSTOM_BLOCKS, 'blocks', blockTypesArray)
		.catch(error => console.error("Error saving updated blocks:", error));

	console.log("Removed custom blocks with IDs:", idsToRemove);
	refreshBlockTools();
	meshesNeedsRefresh = true;
};

// Export the blockTypes getter
export const getBlockTypes = () => blockTypesArray;

export const getCustomBlocks = () => {
	const customBlocks = blockTypesArray.filter(block => block.id >= 100);
	return customBlocks;
};

// Export the initial blockTypes for backward compatibility
export const blockTypes = blockTypesArray;

// Use texture atlas for rendering
let textureAtlas = null;
let chunkMeshBuilder = null;
let chunkLoadManager = null;

// Track if the atlas is initialized
let atlasInitialized = false;

// Initialize the texture atlas
const initTextureAtlas = async (blockTypes) => {
  if (!blockTypes || blockTypes.length === 0) {
    console.warn("Cannot initialize texture atlas: No block types provided");
    return null;
  }
  
  if (atlasInitialized && textureAtlas) {
    console.log("Texture atlas already initialized, returning existing instance");
    return textureAtlas.getAtlasTexture();
  }
  
  console.log(`Initializing texture atlas with ${blockTypes.length} block types...`);
  
  try {
    // Reset initialization flag until complete
    atlasInitialized = false;
    
    // Create new instances if they don't exist
    if (!textureAtlas) {
      textureAtlas = new TextureAtlas();
    }
    
    // Wait for the atlas to be initialized
    const atlas = await textureAtlas.initialize(blockTypes);
    
    if (!atlas) {
      throw new Error("Texture atlas initialization failed: No atlas returned");
    }
    
    // Only create chunk mesh builder if the atlas was successfully initialized
    if (!chunkMeshBuilder) {
      chunkMeshBuilder = new ChunkMeshBuilder(textureAtlas);
    } else {
      // Update existing mesh builder with new atlas
      chunkMeshBuilder.textureAtlas = textureAtlas;
    }
    
    // Only set initialized flag when everything is complete
    atlasInitialized = true;
    console.log("Texture atlas successfully initialized with:", 
      textureAtlas ? `${textureAtlas.blockUVs.size} block textures` : "no textures");
    
    return atlas;
  } catch (error) {
    console.error("Texture atlas initialization failed with error:", error);
    atlasInitialized = false;
    return null;
  }
};

// Replace the createGreedyMesh function with our optimized version
const generateGreedyMesh = (chunksBlocks, blockTypes) => {
    // Skip if texture atlas is disabled
    if (!TEXTURE_ATLAS_SETTINGS.useTextureAtlas) {
        return null; // Fall back to basic rendering
    }
    
    if (!atlasInitialized) {
        console.warn("Texture atlas not initialized, falling back to original mesh generation");
        // Call original implementation or initialize texture atlas first
        return null;
    }
    
    return chunkMeshBuilder.buildChunkMesh(chunksBlocks, blockTypes);
};

// Add performance optimization settings
const PERFORMANCE_SETTINGS = {
  maxChunksPerFrame: 5,          // Max chunks to process in a single frame
  objectPooling: true,           // Reuse geometry/material objects
  batchedGeometry: true,         // Combine similar geometries
  occlusionCulling: true,        // Skip rendering fully hidden chunks
  instancingEnabled: true,       // Use instanced meshes when possible
  shadowDistance: 96            // Distance at which to disable shadows
};

// Function to toggle instanced rendering
export const toggleInstancing = (enabled) => {
  if (PERFORMANCE_SETTINGS.instancingEnabled !== enabled) {
    console.log(`Setting instanced rendering to ${enabled}`);
    PERFORMANCE_SETTINGS.instancingEnabled = enabled;
    return true;
  }
  return false;
};

// Function to get current instancing state
export const getInstancingEnabled = () => PERFORMANCE_SETTINGS.instancingEnabled;

// Function to optimize rendering performance
const optimizeRenderer = (gl) => {
  // Optimize THREE.js renderer
  if (gl) {
    // Disable shadow auto update
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    
    // Optimize for static scenes
    gl.sortObjects = false;
    
    // Don't change physically correct lights (keep default)
    // Don't set output encoding (keep default)
    
    // Set power preference to high-performance
    if (gl.getContextAttributes) {
      const contextAttributes = gl.getContextAttributes();
      if (contextAttributes) {
        contextAttributes.powerPreference = "high-performance";
      }
    }
  }
};

// Add this class definition near the top of the file, outside the component
class SpatialHashGrid {
	constructor() {
		// Use a Map for better performance with large datasets
		this.grid = new Map();
		this.size = 0;
		
		// Cache for chunk coordinates to avoid recalculating
		this.chunkCoordCache = new Map();
		
		// Chunk size for spatial partitioning
		this.chunkSize = 16;
		
		// Performance tracking
		this.lastOperationTime = 0;
	}
	
	/**
	 * Get chunk coordinates from world coordinates
	 * @param {number} x - World X coordinate
	 * @param {number} y - World Y coordinate
	 * @param {number} z - World Z coordinate
	 * @returns {Object} - Chunk coordinates
	 */
	getChunkCoords(x, y, z) {
		// Convert to numbers to ensure proper division
		x = Number(x);
		y = Number(y);
		z = Number(z);
		
		return {
			cx: Math.floor(x / this.chunkSize),
			cy: Math.floor(y / this.chunkSize),
			cz: Math.floor(z / this.chunkSize)
		};
	}
	
	/**
	 * Get local coordinates within a chunk
	 * @param {number} x - World X coordinate
	 * @param {number} y - World Y coordinate
	 * @param {number} z - World Z coordinate
	 * @returns {Object} - Local coordinates
	 */
	getLocalCoords(x, y, z) {
		// Convert to numbers and get modulo for local coordinates
		x = Number(x);
		y = Number(y);
		z = Number(z);
		
		return {
			lx: ((x % this.chunkSize) + this.chunkSize) % this.chunkSize,
			ly: ((y % this.chunkSize) + this.chunkSize) % this.chunkSize,
			lz: ((z % this.chunkSize) + this.chunkSize) % this.chunkSize
		};
	}
	
	/**
	 * Get local key from local coordinates
	 * @param {number} lx - Local X coordinate
	 * @param {number} ly - Local Y coordinate
	 * @param {number} lz - Local Z coordinate
	 * @returns {string} - Local key
	 */
	getLocalKey(lx, ly, lz) {
		return `${lx},${ly},${lz}`;
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

function TerrainBuilder({ onSceneReady, previewPositionToAppJS, currentBlockType, undoRedoManager, mode, setDebugInfo, sendTotalBlocks, axisLockEnabled, gridSize, cameraReset, cameraAngle, placementSize, setPageIsLoaded, customBlocks, environmentBuilderRef}, ref) {
	// State and Refs
	// We no longer need this since we're getting scene from useThree
	// const [scene, setScene] = useState(null);
	const spatialHashGridRef = useRef(new SpatialHashGrid());
	const chunksRef = useRef(new Map());
	const chunkMeshesRef = useRef({});
	const containerRef = useRef(null);
	const rendererRef = useRef(null);
	const cameraRef = useRef(null);
	const orbitControlsRef = useRef(null);
	const groundRef = useRef(null);
	const textureAtlasRef = useRef(null);
	const blockGeometryCache = useRef({});
	const blockMaterialCache = useRef({});
	const placementPreviewRef = useRef(null);
	const axisLockedDirRef = useRef(null);
	const raycasterRef = useRef(new THREE.Raycaster());
	const canvasRef = useRef(null);
	const mouseRef = useRef({ x: 0, y: 0 });
	const isMouseDownRef = useRef(false);
	const canPlaceBlockRef = useRef(true);
	const canRemoveBlockRef = useRef(true);
	const lastPlacedBlockRef = useRef(null);
	const lastPlacementPositionsRef = useRef([]);
	const frustumRef = useRef(new THREE.Frustum());
	const frustumMatrixRef = useRef(new THREE.Matrix4());
	const chunkBoxCache = useRef(new Map());
	const isUpdatingChunksRef = useRef(false);
	const lastUpdateTimeRef = useRef(0);
	const meshesInitializedRef = useRef(false);
	const blockSizeRef = useRef(1);
	const cameraMoving = useRef(false);
	const previewTargetRef = useRef(null);
	const previewInstanceRef = useRef(null);
	const chunkLoadManager = useRef(null);
	const chunkUpdateQueueRef = useRef([]);
	const isProcessingChunkQueueRef = useRef(false);
	const lastChunkProcessTimeRef = useRef(0);
	const useSpatialHashRef = useRef(true);
	const useRaySpatialHashingRef = useRef(false);
	const totalBlocksRef = useRef(0);
	const updateSpatialHashTimerRef = useRef(null);
	const cameraMovementTimeoutRef = useRef(null);
	const cameraPosition = useRef({ x: 0, y: 0, z: 0 });
	
	// Add visibility history tracking for reducing flickering
	const chunkVisibilityHistoryRef = useRef({});
	const visibilityHistoryFramesRef = useRef(15); // Increased from 5 to 15 for more stable visibility
	
	// Add debounce tracking for chunk visibility changes
	const chunkVisibilityChangeTimeRef = useRef({});
	const visibilityChangeDelayRef = useRef(500); // ms to wait before changing visibility state

	// For throttling visibility updates to improve performance
	const lastVisibilityUpdateTimeRef = useRef(0);
	const visibilityUpdateIntervalRef = useRef(100); // ms between full visibility updates

	// Scene setup
	const { scene, camera: threeCamera, raycaster: threeRaycaster, pointer, gl } = useThree();
	const placementStartState = useRef(null);
	const instancedMeshRef = useRef({});
	const placementStartPosition = useRef(null);
	const shadowPlaneRef = useRef();
	const directionalLightRef = useRef();
	const terrainRef = useRef({});
	const gridRef = useRef();

	// Animation tracking
	const mouseMoveAnimationRef = useRef(null);
	const cameraAnimationRef = useRef(null);

	// Refs needed for real-time updates that functions depend on
	const isPlacingRef = useRef(false);
	const currentPlacingYRef = useRef(0);
	const previewPositionRef = useRef(new THREE.Vector3());
	const lockedAxisRef = useRef(null);
	const blockCountsRef = useRef({});
	const previewMeshRef = useRef(null);
	const selectionDistanceRef = useRef(MAX_SELECTION_DISTANCE);
	const axisLockEnabledRef = useRef(axisLockEnabled);
	const currentBlockTypeRef = useRef(currentBlockType);
	const isFirstBlockRef = useRef(true);
	const modeRef = useRef(mode);
	const lastPreviewPositionRef = useRef(new THREE.Vector3());
	const placementSizeRef = useRef(placementSize);
	const previewIsGroundPlaneRef = useRef(false);

	// state for preview position to force re-render of preview cube when it changes
	const [previewPosition, setPreviewPosition] = useState(new THREE.Vector3());

	// Replace lastPlacedBlockRef with a Set to track all recently placed blocks
	const recentlyPlacedBlocksRef = useRef(new Set());

	/// references for
	const canvasRectRef = useRef(null);
	const normalizedMouseRef = useRef(new THREE.Vector2());
	const tempVectorRef = useRef(new THREE.Vector3());
	const tempVec2Ref = useRef(new THREE.Vector2());
	const tempVec2_2Ref = useRef(new THREE.Vector2());

	// Add Tool Manager ref
	const toolManagerRef = useRef(null);

	// Add caching for geometries and materials
	const geometryCache = useRef(new Map());
	const materialCache = useRef(new Map());

	// For batching scene changes to improve performance
	const pendingAddToSceneRef = useRef([]);
	const pendingRemoveFromSceneRef = useRef([]);
	const sceneUpdateScheduledRef = useRef(false);
	
	// Batch scene updates for improved performance
	const processPendingSceneChanges = () => {
		// Process all pending adds
		pendingAddToSceneRef.current.forEach(mesh => {
			if (mesh && scene && !scene.children.includes(mesh)) {
				try {
					scene.add(mesh);
				} catch (error) {
					console.error("Error adding mesh to scene:", error);
				}
			}
		});
		
		// Process all pending removes
		pendingRemoveFromSceneRef.current.forEach(mesh => {
			if (mesh && scene && scene.children.includes(mesh)) {
				try {
					scene.remove(mesh);
				} catch (error) {
					console.error("Error removing mesh from scene:", error);
				}
			}
		});
		
		// Clear the lists
		pendingAddToSceneRef.current = [];
		pendingRemoveFromSceneRef.current = [];
		sceneUpdateScheduledRef.current = false;
	};
	
	// Create a safe function to add a mesh to the scene (batched)
	const safeAddToScene = (mesh) => {
		if (!mesh) return;
		
		// Add to pending additions
		pendingAddToSceneRef.current.push(mesh);
		
		// Schedule update if not already scheduled
		if (!sceneUpdateScheduledRef.current) {
			sceneUpdateScheduledRef.current = true;
			requestAnimationFrame(processPendingSceneChanges);
		}
	};
	
	// Create a safe function to remove a mesh from the scene (batched)
	const safeRemoveFromScene = (mesh) => {
		if (!mesh) return;
		
		// Add to pending removes
		pendingRemoveFromSceneRef.current.push(mesh);
		
		// Dispose resources when removing
		// This needs to happen immediately to free memory
		try {
			// Dispose resources
			if (mesh.geometry) {
				mesh.geometry.dispose();
			}
			
			if (Array.isArray(mesh.material)) {
				mesh.material.forEach(m => m?.dispose());
			} else if (mesh.material) {
				mesh.material.dispose();
			}
		} catch (error) {
			console.error("Error disposing mesh resources:", error);
		}
		
		// Schedule update if not already scheduled
		if (!sceneUpdateScheduledRef.current) {
			sceneUpdateScheduledRef.current = true;
			requestAnimationFrame(processPendingSceneChanges);
		}
	};

	
	
	const toggleSpatialHashRayCasting = (enabled) => {
		if (enabled === undefined) {
			// Toggle if no value provided
			useSpatialHashRef.current = !useSpatialHashRef.current;
		} else {
			// Set to provided value
			useSpatialHashRef.current = enabled;
		}
		
		// Re-build spatial hash if enabling
		if (useSpatialHashRef.current) {
			updateSpatialHash();
		}
		
		console.log(`Spatial hash ray casting is now ${useSpatialHashRef.current ? 'enabled' : 'disabled'}`);
		return useSpatialHashRef.current;
	};
	
	//* TERRAIN UPDATE FUNCTIONS *//
	//* TERRAIN UPDATE FUNCTIONS *//
	//* TERRAIN UPDATE FUNCTIONS *//
	//* TERRAIN UPDATE FUNCTIONS *//

	/// define buildUpdateTerrain to update the terrain
	const buildUpdateTerrain = () => {
		// Return a promise that resolves when the terrain update is complete
		return new Promise((resolve, reject) => {
			// Skip if meshes not initialized yet
			if (!meshesInitializedRef.current || !scene) {
				console.warn("Meshes not initialized or scene not ready");
				resolve(); // Resolve instead of reject to avoid error messages
				return;
			}
			
			// Don't queue multiple updates
			if (isUpdatingChunksRef.current) {
				console.log("Skipping redundant terrain update, one is already in progress");
				resolve(); // Resolve instead of reject to avoid error messages
				return;
			}

			// Set updating flag
			isUpdatingChunksRef.current = true;
			
			// Show loading screen for the initial processing
			loadingManager.showLoading('Processing terrain data...');

			// Process in the next frame to avoid React rendering issues
			setTimeout(() => {
				try {
					// Reset block counts
					let blockCountsByType = {};
					
					// Clear existing chunk data
					chunksRef.current.clear();
					
					// Organize chunks by distance from camera
					const cameraChunkX = Math.floor(threeCamera.position.x / CHUNK_SIZE);
					const cameraChunkY = Math.floor(threeCamera.position.y / CHUNK_SIZE);
					const cameraChunkZ = Math.floor(threeCamera.position.z / CHUNK_SIZE);
					
					// Processing queue
					const chunkQueue = [];
					
					// Get all block entries for processing
					const blockEntries = Object.entries(terrainRef.current);
					const totalBlocks = blockEntries.length;
					
					// Process blocks in larger batches for faster performance
					const INITIAL_BATCH_SIZE = 100000; // Increased from 10000 to 50000
					let processedBlocks = 0;
					
					// Function to process a batch of blocks
					const processBlockBatch = (startIndex) => {
						// Update loading progress
						const progress = Math.floor((processedBlocks / totalBlocks) * 100);
						loadingManager.updateLoading(`Processing blocks (${processedBlocks}/${totalBlocks})`, progress);
						
						// Process a batch of blocks
						const endIndex = Math.min(startIndex + INITIAL_BATCH_SIZE, totalBlocks);
						
						for (let i = startIndex; i < endIndex; i++) {
							const [posKey, blockId] = blockEntries[i];
							const [x, y, z] = posKey.split(',').map(Number);
							const chunkKey = getChunkKey(x, y, z);
							
							// Initialize chunk if it doesn't exist
							if (!chunksRef.current.has(chunkKey)) {
								chunksRef.current.set(chunkKey, {});
								
								// Calculate chunk center
								const chunkX = Math.floor(x / CHUNK_SIZE);
								const chunkY = Math.floor(y / CHUNK_SIZE);
								const chunkZ = Math.floor(z / CHUNK_SIZE);
								
								// Calculate squared distance to camera (faster than sqrt)
								const distSq = 
									Math.pow(chunkX - cameraChunkX, 2) +
									Math.pow(chunkY - cameraChunkY, 2) +
									Math.pow(chunkZ - cameraChunkZ, 2);
									
								// Add to processing queue with priority
								chunkQueue.push({
									chunkKey,
									distance: distSq
								});
							}
							
							// Store block in chunk
							chunksRef.current.get(chunkKey)[posKey] = blockId;
							
							// Count blocks by type
							blockCountsByType[blockId] = (blockCountsByType[blockId] || 0) + 1;
						}
						
						// Update processed count
						processedBlocks = endIndex;
						
						// If there are more blocks to process, schedule the next batch
						if (processedBlocks < totalBlocks) {
							setTimeout(() => {
								processBlockBatch(processedBlocks);
							}, 0); // Use 0ms timeout to yield to the browser
						} else {
							// All blocks processed, continue with the rest of the setup
							finishSetup();
						}
					};
					
					// Function to finish setup after all blocks are processed
					const finishSetup = () => {
						loadingManager.updateLoading('Finalizing terrain setup...', 95);
						
						// Update spatial hash grid for ray casting
						updateSpatialHash();
						
						// Sort chunks by distance (closest first)
						chunkQueue.sort((a, b) => a.distance - b.distance);
						
						// Clean up existing chunk meshes in larger batches
						const cleanupMeshes = () => {
							// Get all mesh entries
							const meshEntries = Object.entries(chunkMeshesRef.current);
							
							// Process in larger batches
							const CLEANUP_BATCH_SIZE = 200; // Increased from 50 to 200
							let processedMeshes = 0;
							
							const cleanupBatch = (startIndex) => {
								const endIndex = Math.min(startIndex + CLEANUP_BATCH_SIZE, meshEntries.length);
								
								for (let i = startIndex; i < endIndex; i++) {
									const [chunkKey, blockMeshes] = meshEntries[i];
									Object.values(blockMeshes).forEach(mesh => {
										safeRemoveFromScene(mesh);
									});
								}
								
								processedMeshes = endIndex;
								
								if (processedMeshes < meshEntries.length) {
									setTimeout(() => {
										cleanupBatch(processedMeshes);
									}, 0);
								} else {
									// All meshes cleaned up, continue
									continueAfterCleanup();
								}
							};
							
							// Start cleanup if there are meshes
							if (meshEntries.length > 0) {
								cleanupBatch(0);
							} else {
								continueAfterCleanup();
							}
						};
						
						// Function to continue after mesh cleanup
						const continueAfterCleanup = () => {
							// Reset chunk meshes
							chunkMeshesRef.current = {};
							
							// For backward compatibility, update the block counts
							blockCountsRef.current = blockCountsByType;
							totalBlocksRef.current = Object.keys(terrainRef.current).length;
							
							// Update debug info early
							updateDebugInfo();
							
							// Hide loading screen before starting chunk processing
							loadingManager.hideLoading();
							
							// Track progress for internal use only (no loading UI updates)
							const totalChunks = chunkQueue.length;
							let processedChunks = 0;
							
							// Process chunks in larger batches for faster processing
							const BATCH_SIZE = 25; // Increased from 10 to 25
							
							const processBatch = (startIndex) => {
								// If we're done, finish up
								if (startIndex >= chunkQueue.length) {
									// Flag that we're done
									isUpdatingChunksRef.current = false;
									
									// Update visibility now that all chunks are built
									updateVisibleChunks();
									
									// Save terrain asynchronously after all chunks are loaded
									setTimeout(() => {
										DatabaseManager.saveData(STORES.TERRAIN, "current", terrainRef.current)
											.catch(error => console.error("Error saving terrain:", error));
									}, 100);
									
									// Don't resolve yet - will resolve in final update step
									return;
								}
								
								// Process a batch of chunks
								const endIndex = Math.min(startIndex + BATCH_SIZE, chunkQueue.length);
								
								// Process this batch
								for (let i = startIndex; i < endIndex; i++) {
									const { chunkKey } = chunkQueue[i];
									try {
										rebuildChunkNoVisibilityUpdate(chunkKey);
										
										// Update processed count (no UI updates)
										processedChunks++;
									} catch (error) {
										console.error(`Error processing chunk ${chunkKey}:`, error);
									}
								}
								
								// Update visibility once for the whole batch
								updateVisibleChunks();
								
								// Schedule the next batch with zero delay for maximum speed
								setTimeout(() => {
									processBatch(endIndex);
								}, 0); // Reduced from 1ms for maximum speed
							};
							
							// Start processing the first batch
							processBatch(0);
							
							// Add a final step to ensure all visibility is correct at the end
							setTimeout(() => {
								// Clear the chunk bounding box cache to ensure proper recalculation
								chunkBoxCache.current.clear();
								
								// Do a final visibility update to ensure all chunks are properly shown/hidden
								updateVisibleChunks();
								
								// Finally resolve the promise as everything is complete
								resolve();
							}, 100);
						};
						
						// Start the mesh cleanup process
						cleanupMeshes();
					};
					
					// Start processing the first batch of blocks
					processBlockBatch(0);
					
				} catch (error) {
					console.error("Error in buildUpdateTerrain:", error);
					isUpdatingChunksRef.current = false;
					
					// If there's an error, hide the loading screen
					loadingManager.hideLoading();
					
					resolve(); // Resolve instead of reject to avoid error messages
				}
			}, 0);
		});
	};

	// A version of rebuildChunk that doesn't update visibility (for batch processing)
	const rebuildChunkNoVisibilityUpdate = (chunkKey) => {
		// Skip if scene not ready
		if (!scene || !meshesInitializedRef.current) return;
		
		try {
			// Clean up existing chunk meshes for this specific chunk
			if (chunkMeshesRef.current[chunkKey]) {
				Object.values(chunkMeshesRef.current[chunkKey]).forEach(mesh => {
					safeRemoveFromScene(mesh);
				});
			}
			chunkMeshesRef.current[chunkKey] = {};
			
			// If chunk doesn't exist in our tracking, nothing to do
			if (!chunksRef.current.has(chunkKey)) {
				return;
			}
			
			// Get blocks for this chunk
			const chunkBlocks = chunksRef.current.get(chunkKey) || {};
			
			// If no blocks in this chunk, we're done
			if (Object.keys(chunkBlocks).length === 0) {
				return;
			}
			
			// Format chunk data for mesh generation
			const chunksBlocks = {};
			Object.entries(chunkBlocks).forEach(([posKey, blockId]) => {
				chunksBlocks[posKey] = blockId;
			});
			
			// Try to use greedy meshing first if enabled (most efficient)
			if (GREEDY_MESHING_ENABLED) {
				try {
				const meshes = createGreedyMeshForChunk(chunksBlocks);
					if (meshes) {
						if (!chunkMeshesRef.current[chunkKey]) {
							chunkMeshesRef.current[chunkKey] = {};
						}

						// Add all generated meshes
						Object.entries(meshes).forEach(([key, mesh]) => {
							mesh.userData = { chunkKey };
							mesh.frustumCulled = true;
							chunkMeshesRef.current[chunkKey][key] = mesh;
					safeAddToScene(mesh);
				});
				
						return;
					}
				} catch (error) {
					console.error("Error creating greedy mesh:", error);
				}
			}
			
			// Fall back to instanced rendering (second most efficient)
			if (PERFORMANCE_SETTINGS.instancingEnabled) {
				// Group blocks by type
				const blockTypes = {};
				Object.entries(chunksBlocks).forEach(([posKey, blockId]) => {
					if (!blockTypes[blockId]) {
						blockTypes[blockId] = [];
					}
					blockTypes[blockId].push(posKey);
				});
				
				// Create instance mesh for each block type
				Object.entries(blockTypes).forEach(([blockId, positions]) => {
					const blockType = blockTypesArray.find(b => b.id === parseInt(blockId));
					if (!blockType) return;
					
					// Use cached geometry and material
					const geometry = getCachedGeometry(blockType);
					const material = getCachedMaterial(blockType);
					
					// Create instanced mesh with exact capacity
					const capacity = Math.min(positions.length, CHUNK_BLOCK_CAPACITY);
					const instancedMesh = new THREE.InstancedMesh(
						geometry,
						material,
						capacity
					);
					instancedMesh.userData = { blockTypeId: blockType.id, chunkKey };
					instancedMesh.frustumCulled = true;
					instancedMesh.castShadow = true;
					instancedMesh.receiveShadow = true;
					
					// Use pooled matrix if available
					const tempMatrix = new THREE.Matrix4();
					
					// Set matrix for each block
					positions.forEach((posKey, index) => {
						const [x, y, z] = posKey.split(',').map(Number);
						tempMatrix.makeTranslation(x, y, z);
						instancedMesh.setMatrixAt(index, tempMatrix);
					});
					
					// Update mesh
					instancedMesh.count = positions.length;
					instancedMesh.instanceMatrix.needsUpdate = true;
					
					// Store and add to scene directly
					if (!chunkMeshesRef.current[chunkKey]) {
						chunkMeshesRef.current[chunkKey] = {};
					}
					chunkMeshesRef.current[chunkKey][blockId] = instancedMesh;
					safeAddToScene(instancedMesh);
				});
			} else {
				// Individual meshes as last resort
				Object.entries(chunksBlocks).forEach(([posKey, blockId]) => {
					const blockType = blockTypesArray.find(b => b.id === parseInt(blockId));
					if (!blockType) return;
					
					const geometry = getCachedGeometry(blockType);
					const material = getCachedMaterial(blockType);
					
					const mesh = new THREE.Mesh(geometry, material);
					const [x, y, z] = posKey.split(',').map(Number);
					mesh.position.set(x, y, z);
					
					mesh.userData = { blockId: blockType.id, chunkKey, blockPos: posKey };
					mesh.frustumCulled = true;
					
					// Add to scene
					if (!chunkMeshesRef.current[chunkKey]) {
						chunkMeshesRef.current[chunkKey] = {};
					}
					if (!chunkMeshesRef.current[chunkKey][blockId]) {
						chunkMeshesRef.current[chunkKey][blockId] = [];
					}
					if (Array.isArray(chunkMeshesRef.current[chunkKey][blockId])) {
						chunkMeshesRef.current[chunkKey][blockId].push(mesh);
					} else {
						chunkMeshesRef.current[chunkKey][blockId] = [mesh];
					}
					safeAddToScene(mesh);
				});
			}
		} catch (error) {
			console.error("Error rebuilding chunk:", error);
		}
	};

	/// Geometry and Material Helper Functions ///
	/// Geometry and Material Helper Functions ///
	/// Geometry and Material Helper Functions ///
	/// Geometry and Material Helper Functions ///

	const createBlockGeometry = (blockType) => {
		if (!blockType) {
			console.error("Invalid blockType:", blockType);
			return new THREE.BoxGeometry(1, 1, 1); // Default fallback
		}

		if (blockType.isEnvironment) {
			if (blockType.textureUri) {
				const texture = new THREE.TextureLoader().load(blockType.textureUri);

				// Set default aspect ratio of 1 initially
				const planeGeometry = new THREE.PlaneGeometry(1, 1);
				const plane1 = planeGeometry.clone();
				const plane2 = planeGeometry.clone();
				plane2.rotateY(Math.PI / 2);

				// Update aspect ratio when texture loads
				texture.onload = () => {
					const aspectRatio = texture.image.width / texture.image.height;
					plane1.scale(aspectRatio, 1, 1);
					plane2.scale(aspectRatio, 1, 1);
					plane1.computeBoundingSphere();
					plane2.computeBoundingSphere();
				};

				return mergeGeometries([plane1, plane2]);
			}
			return new THREE.BoxGeometry(1, 1, 1);
		}

		return new THREE.BoxGeometry(1, 1, 1);
	};

	const createBlockMaterial = (blockType) => {
		if (blockType.isCustom || blockType.id >= 100) {
			const texture = new THREE.TextureLoader().load(blockType.textureUri);
			texture.magFilter = THREE.NearestFilter;
			texture.minFilter = THREE.NearestFilter;
			texture.colorSpace = THREE.SRGBColorSpace;

			// Create material with the loaded texture
			const material = new THREE.MeshPhongMaterial({
				map: texture,
				depthWrite: true,
				depthTest: true,
				transparent: true,
				alphaTest: 0.5,
			});

			// Handle texture loading errors by replacing with error texture
			texture.onerror = () => {
				console.warn(`Error loading texture for custom block ${blockType.name}, using error texture`);
				const errorTexture = new THREE.TextureLoader().load("./assets/blocks/error.png");
				errorTexture.magFilter = THREE.NearestFilter;
				errorTexture.minFilter = THREE.NearestFilter;
				errorTexture.colorSpace = THREE.SRGBColorSpace;
				material.map = errorTexture;
				material.needsUpdate = true;
			};

			return Array(6).fill(material);
		}

		// Order of faces in THREE.js BoxGeometry: right, left, top, bottom, front, back
		const faceOrder = ['+x', '-x', '+y', '-y', '+z', '-z'];
		const materials = [];

		for (const face of faceOrder) {
			let texturePath;
			
			if (blockType.isMultiTexture && blockType.sideTextures[face]) {
				texturePath = blockType.sideTextures[face];
			} else {
				texturePath = blockType.textureUri;
			}

			const texture = new THREE.TextureLoader().load(texturePath);
			texture.magFilter = THREE.NearestFilter;
			texture.minFilter = THREE.NearestFilter;
			texture.colorSpace = THREE.SRGBColorSpace;

			materials.push(
				new THREE.MeshPhongMaterial({
					map: texture,
					color: 0xffffff,
					transparent: true,
					alphaTest: 0.5,
					opacity: texturePath.includes("water") ? 0.5 : 1,
					depthWrite: true,
					depthTest: true,
				})
			);
		}

		return materials;
	};

	/// Placement and Modification Functions ///
	/// Placement and Modification Functions ///
	/// Placement and Modification Functions ///
	/// Placement and Modification Functions ///

	const handleMouseDown = (event) => {
		// If a tool is active, delegate the event to it
		if (toolManagerRef.current && toolManagerRef.current.getActiveTool()) {
			const intersection = getRaycastIntersection();
			if (intersection) {
				toolManagerRef.current.handleMouseDown(event, intersection.point, event.button);
				return; // Let the tool handle it
			}
		}
		
		// Otherwise use default behavior
		if (event.button === 0) {
			isPlacingRef.current = true;
			isFirstBlockRef.current = true;
			currentPlacingYRef.current = previewPositionRef.current.y;
			
			// Clear recently placed blocks on mouse down
			recentlyPlacedBlocksRef.current.clear();

			// Store initial position for axis lock
			if (axisLockEnabledRef.current) {
				placementStartPosition.current = previewPositionRef.current.clone();
			}

			// Save the initial state for undo/redo
			placementStartState.current = {
				terrain: { ...terrainRef.current },
				environment: DatabaseManager.getData(STORES.ENVIRONMENT, "current") || []
			};

			// Handle initial placement
			updatePreviewPosition();
			playPlaceSound();
		}
	};

	const handleBlockPlacement = () => {
		if (!modeRef.current || !isPlacingRef.current) return;

		if (currentBlockTypeRef.current?.isEnvironment) {
			if (isFirstBlockRef.current) {
				environmentBuilderRef.current.placeEnvironmentModel(previewPositionRef.current.clone());
				isFirstBlockRef.current = false;
			}
			return;
		}

		const newPlacementPosition = previewPositionRef.current.clone();
		const positions = getPlacementPositions(newPlacementPosition, placementSizeRef.current);
		let terrainChanged = false;
		
		// Track modified chunk keys to rebuild only those chunks
		const modifiedChunks = new Set();
		
		// Keep track of blocks added and removed
		const blockUpdates = [];

		// Check if we're placing on a block or on the ground plane
		// If we're placing on a block, we should only allow placement if the block doesn't already exist
		// If we're placing on the ground plane, we should always allow placement
		const isPlacingOnGround = previewIsGroundPlaneRef.current && newPlacementPosition.y === 0;
		
		// If we're in remove mode, we should only allow removal if the block exists
		const isRemovingBlock = modeRef.current === "remove";
		
		// If we're placing on the ground plane, check if there are any blocks nearby
		// that might be getting obscured by the ground plane detection
		let shouldAllowGroundPlacement = isPlacingOnGround;
		
		if (isPlacingOnGround && modeRef.current === "add") {
			// Check for blocks in a larger radius around the placement position
			const checkRadius = 3.0; // Increased from 1.5 to 3.0 blocks
			const nearbyBlocks = [];
			
			// Check for blocks in a cube around the placement position
			for (let x = Math.floor(newPlacementPosition.x - checkRadius); x <= Math.ceil(newPlacementPosition.x + checkRadius); x++) {
				for (let y = Math.floor(newPlacementPosition.y - checkRadius); y <= Math.ceil(newPlacementPosition.y + checkRadius); y++) {
					for (let z = Math.floor(newPlacementPosition.z - checkRadius); z <= Math.ceil(newPlacementPosition.z + checkRadius); z++) {
						const key = `${x},${y},${z}`;
						if (terrainRef.current[key]) {
							// Calculate distance to the block
							const distance = Math.sqrt(
								Math.pow(x - newPlacementPosition.x, 2) +
								Math.pow(y - newPlacementPosition.y, 2) +
								Math.pow(z - newPlacementPosition.z, 2)
							);
							
							// Only consider blocks that are close enough
							if (distance <= checkRadius) {
								nearbyBlocks.push({
									x, y, z,
									distance
								});
							}
						}
					}
				}
			}
			
			// Sort by distance
			nearbyBlocks.sort((a, b) => a.distance - b.distance);
			
			// If there are nearby blocks, don't allow ground placement
			// unless the closest block is more than 2 blocks away (increased from 1.0)
			if (nearbyBlocks.length > 0 && nearbyBlocks[0].distance < 2.0) {
				shouldAllowGroundPlacement = false;
				
				// Debug output
				console.log(`Blocked ground placement due to nearby block at distance ${nearbyBlocks[0].distance.toFixed(2)}`);
			}
		}

		positions.forEach((pos) => {
			const key = `${pos.x},${pos.y},${pos.z}`;
			const chunkKey = getChunkKey(pos.x, pos.y, pos.z);
			const blockId = currentBlockTypeRef.current.id;
			
			// Add this chunk to the list of modified chunks
			modifiedChunks.add(chunkKey);

			if (modeRef.current === "add") {
				// Only place a block if:
				// 1. There's no block already there, OR
				// 2. We're placing on the ground plane at y=0 and there are no nearby blocks
				if (!terrainRef.current[key] || (shouldAllowGroundPlacement && pos.y === 0)) {
					terrainRef.current[key] = blockId;
					terrainChanged = true;
					recentlyPlacedBlocksRef.current.add(key);
					
					// Track block updates
					blockUpdates.push({ type: 'add', key, chunkKey, pos, blockId });
				}
			} else if (isRemovingBlock) {
				if (terrainRef.current[key]) {
					const oldBlockId = terrainRef.current[key];
					delete terrainRef.current[key];
					terrainChanged = true;
					
					// Track block updates
					blockUpdates.push({ type: 'remove', key, chunkKey, pos, blockId: oldBlockId });
				}
			}
		});

		if (isFirstBlockRef.current) {
			isFirstBlockRef.current = false;
		}

		if (terrainChanged) {
			totalBlocksRef.current = Object.keys(terrainRef.current).length;
			updateDebugInfo();

			// Update spatial hash for all changed blocks at once
			updateSpatialHashForBlocks(
				blockUpdates.filter(update => update.type === 'add'),
				blockUpdates.filter(update => update.type === 'remove')
			);

			// Update chunks directly - no batching or queuing
			if (modifiedChunks.size > 0) {
				// First, make sure chunks data is updated
				blockUpdates.forEach(update => {
					const { type, key, chunkKey, blockId } = update;
					
					// Make sure chunk exists in our data
					if (!chunksRef.current.has(chunkKey)) {
						chunksRef.current.set(chunkKey, {});
					}
					
					// Get the chunk's blocks
					const chunkBlocks = chunksRef.current.get(chunkKey);
					
					// Update the chunk data
					if (type === 'add') {
						chunkBlocks[key] = blockId;
					} else {
						delete chunkBlocks[key];
					}
				});
				
				// Now, rebuild only the absolutely required chunks (where blocks were modified)
				const chunksArray = Array.from(modifiedChunks);
				
				// Process up to 3 chunks immediately, queue the rest with higher priority
				const immediateChunks = chunksArray.slice(0, 3);
				const queuedChunks = chunksArray.slice(3);
				
				// Immediately rebuild the chunks that are most important (where the cursor is)
				immediateChunks.forEach(chunkKey => {
					rebuildChunkNoVisibilityUpdate(chunkKey);
				});
				
				// Queue the rest with high priority
				queuedChunks.forEach(chunkKey => {
					addChunkToUpdateQueue(chunkKey, 1000); // High priority
				});
			}
			
			// Save terrain to storage asynchronously
			DatabaseManager.saveData(STORES.TERRAIN, "current", terrainRef.current)
				.catch(error => console.error("Error saving terrain:", error));
		}
	};

	/// Raycast and Grid Intersection Functions ///
	/// Raycast and Grid Intersection Functions ///
	/// Raycast and Grid Intersection Functions ///
	/// Raycast and Grid Intersection Functions ///

	const getRaycastIntersection = () => {
		// Skip raycasting completely if scene is not ready
		if (!scene || !threeCamera || !threeRaycaster) return null;
		
		// Use the raw pointer coordinates directly from THREE.js
		const normalizedMouse = pointer.clone();
		
		// Setup raycaster with the normalized coordinates
		threeRaycaster.setFromCamera(normalizedMouse, threeCamera);
		
		// First, check for block collisions using optimized ray casting
		let blockIntersection = null;
		if (useSpatialHashRef.current && spatialHashGridRef.current.size > 0) {
			blockIntersection = getOptimizedRaycastIntersection();
		}
		
		// If we found a block intersection, return it immediately
		if (blockIntersection && !blockIntersection.isGroundPlane) {
			return blockIntersection;
		}
		
		// If no block intersection, check for ground plane intersection
		//const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
		const rayOrigin = threeRaycaster.ray.origin;
		const rayDirection = threeRaycaster.ray.direction;
		
		// Calculate intersection with the ground plane
		const target = new THREE.Vector3();
		const intersectionDistance = rayOrigin.y / -rayDirection.y;
		
		// Store ground plane intersection if valid
		let groundIntersection = null;
		
		// Only consider intersections in front of the camera and within selection distance
		if (intersectionDistance > 0 && intersectionDistance < selectionDistanceRef.current) {
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
		
		// If we already have a block intersection from the optimized raycast, return it
		if (blockIntersection) {
			return blockIntersection;
		}
		
		// Fall back to original method for block detection
		
		// Quick check: see if we're even pointing at any chunks with blocks
		const dir = threeRaycaster.ray.direction.clone().normalize();
		const pos = threeRaycaster.ray.origin.clone();
		
		// Check if there are any chunks in this direction
		let hasChunksInDirection = false;
		const checkedChunks = new Set();
		
		// Get camera chunk
		
		// Check a few chunks in the ray direction
		for (let dist = 1; dist <= 5; dist++) {
			const checkPos = pos.clone().add(dir.clone().multiplyScalar(dist * CHUNK_SIZE));
			const chunkX = Math.floor(checkPos.x / CHUNK_SIZE);
			const chunkY = Math.floor(checkPos.y / CHUNK_SIZE);
			const chunkZ = Math.floor(checkPos.z / CHUNK_SIZE);
			
			// Skip if we've already checked this chunk
			const chunkKey = `${chunkX},${chunkY},${chunkZ}`;
			if (checkedChunks.has(chunkKey)) continue;
			checkedChunks.add(chunkKey);
			
			// If this chunk exists in our data, we need to do the raycast
			if (chunksRef.current.has(chunkKey)) {
				hasChunksInDirection = true;
				break;
			}
		}
		
		// If no chunks in this direction, return the ground intersection if we have one
		if (!hasChunksInDirection) {
			return groundIntersection;
		}
		
		// Create a temporary array to store all intersections
		let allIntersections = [];
		
		// Get blocks that are in chunks along the ray direction
		const blocksToCheck = [];
		
		// Collect blocks from chunks that are in the ray direction
		chunksRef.current.forEach((chunkBlocks, chunkKey) => {
			const [cx, cy, cz] = chunkKey.split(',').map(Number);
	  
			// Calculate chunk center
			const chunkCenterX = (cx * CHUNK_SIZE) + (CHUNK_SIZE / 2);
			const chunkCenterY = (cy * CHUNK_SIZE) + (CHUNK_SIZE / 2);
			const chunkCenterZ = (cz * CHUNK_SIZE) + (CHUNK_SIZE / 2);
			
			// Create a vector from camera to chunk center
			const toCenterX = chunkCenterX - threeCamera.position.x;
			const toCenterY = chunkCenterY - threeCamera.position.y;
			const toCenterZ = chunkCenterZ - threeCamera.position.z;
			
			// Calculate dot product with ray direction to see if chunk is in front of camera
			const dotProduct = toCenterX * dir.x + toCenterY * dir.y + toCenterZ * dir.z;
			
			// Only check chunks that are in front of the camera and within a reasonable angle
			if (dotProduct > 0) {
				// Calculate squared distance to chunk center
				const distanceSquared = toCenterX * toCenterX + toCenterY * toCenterY + toCenterZ * toCenterZ;
				
				// Skip chunks that are too far away
				if (distanceSquared <= selectionDistanceRef.current * selectionDistanceRef.current) {
					// Add blocks from this chunk to the check list
					Object.entries(chunkBlocks).forEach(([posKey, blockId]) => {
						blocksToCheck.push({ posKey, blockId });
					});
				}
			}
		});
		
		// Manually check each block in the filtered list
		blocksToCheck.forEach(({ posKey, blockId }) => {
			// Skip recently placed blocks during placement
			if (isPlacingRef.current && recentlyPlacedBlocksRef.current.has(posKey)) {
				return;
			}
			
			const [x, y, z] = posKey.split(',').map(Number);
			
			// Check distance to camera first (quick reject for distant blocks)
			const distanceToCamera = threeCamera.position.distanceToSquared(new THREE.Vector3(x, y, z));
			if (distanceToCamera > selectionDistanceRef.current * selectionDistanceRef.current) {
				return; // Skip blocks beyond selection distance
			}
			
			// Create a temporary box for raycasting
			const tempBox = new THREE.Box3(
				new THREE.Vector3(x - 0.5, y - 0.5, z - 0.5),
				new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5)
			);
			
			// Check if ray intersects this box
			if (threeRaycaster.ray.intersectsBox(tempBox)) {
				// Calculate true distance from camera
				const distanceFromCamera = threeCamera.position.distanceTo(new THREE.Vector3(x, y, z));
				
				// Skip blocks that are too far away
				if (distanceFromCamera > selectionDistanceRef.current) {
					return;
				}
				
				// Determine which face was hit (approximation)
				const intersection = threeRaycaster.ray.intersectBox(tempBox, new THREE.Vector3());
				if (!intersection) return; // Should never happen
				
				const faceNormal = new THREE.Vector3();
				
				// Determine face normal by checking which box side was hit
				const epsilon = 0.001;
				if (Math.abs(intersection.x - (x - 0.5)) < epsilon) faceNormal.set(-1, 0, 0);
				else if (Math.abs(intersection.x - (x + 0.5)) < epsilon) faceNormal.set(1, 0, 0);
				else if (Math.abs(intersection.y - (y - 0.5)) < epsilon) faceNormal.set(0, -1, 0);
				else if (Math.abs(intersection.y - (y + 0.5)) < epsilon) faceNormal.set(0, 1, 0);
				else if (Math.abs(intersection.z - (z - 0.5)) < epsilon) faceNormal.set(0, 0, -1);
				else faceNormal.set(0, 0, 1);
				
				// Add to intersection list
				allIntersections.push({
					point: intersection,
					normal: faceNormal,
					block: { x, y, z },
					blockId,
					distance: distanceFromCamera,
					isGroundPlane: false
				});
			}
		});
		
		// Sort by distance (closest first)
		allIntersections.sort((a, b) => a.distance - b.distance);
		
		// Return the closest intersection, if any
		if (allIntersections.length > 0) {
			return allIntersections[0];
		}
		
		// If no block intersections, return the ground intersection as a fallback
		return groundIntersection;
	};

	// Throttle mouse move updates
	const updatePreviewPosition = () => {
		// Skip update if we updated too recently
		const now = performance.now();
		if (now - updatePreviewPosition.lastUpdate < 10) { // ~60fps
			return;
		}
		updatePreviewPosition.lastUpdate = now;

		// Cache the canvas rect calculation
		if (!canvasRectRef.current) {
			canvasRectRef.current = gl.domElement.getBoundingClientRect();
		}

		const rect = canvasRectRef.current;

		// Reuse vectors for normalized mouse position
		normalizedMouseRef.current.x = ((((pointer.x + 1) / 2) * rect.width - rect.width / 2) / rect.width) * 2;
		normalizedMouseRef.current.y = ((((pointer.y + 1) / 2) * rect.height - rect.height / 2) / rect.height) * 2;

		// Setup raycaster with the normalized coordinates
		threeRaycaster.setFromCamera(normalizedMouseRef.current, threeCamera);
		
		// FIRST PASS: Check for block intersections directly
		let blockIntersection = null;
		
		// Use spatial hash for efficient block checking
		if (useSpatialHashRef.current && spatialHashGridRef.current.size > 0) {
			// Create ray from camera
			const ray = threeRaycaster.ray.clone();
			
			// Parameters for ray marching
			const maxDistance = selectionDistanceRef.current;
			const precision = 0.1;
			
			// Start at camera position
			let pos = ray.origin.clone();
			let step = ray.direction.clone().normalize().multiplyScalar(precision);
			let distance = 0;
			
			// For performance tracking
			let iterations = 0;
			const maxIterations = 1000; // Limit iterations to prevent infinite loops
			
			// Ray marching loop - ALWAYS check for blocks first
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
				
				// Skip recently placed blocks during placement
				if (isPlacingRef.current && recentlyPlacedBlocksRef.current.has(blockKey)) {
					pos.add(step);
					distance += precision;
					continue;
				}
				
				// Check if there's a block at this position (using spatial hash)
				if (spatialHashGridRef.current.has(blockKey)) {
					// We hit a block!
					const blockId = spatialHashGridRef.current.get(blockKey);
					
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
					
					// Set block intersection
					blockIntersection = {
						point,
						normal,
						block: { x: blockX, y: blockY, z: blockZ },
						blockId,
						distance,
						isGroundPlane: false
					};
					
					// Exit the loop since we found a block
					break;
				}
				
				// Move along the ray
				pos.add(step);
				distance += precision;
			}
		}
		
		// SECOND PASS: If no block intersections, check for ground plane intersection
		if (!blockIntersection) {
			// Create a ground plane for raycasting
			//const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
			const rayOrigin = threeRaycaster.ray.origin;
			const rayDirection = threeRaycaster.ray.direction;
			
			// Calculate intersection with the ground plane
			const target = new THREE.Vector3();
			const intersectionDistance = rayOrigin.y / -rayDirection.y;
			
			// Only consider intersections in front of the camera and within selection distance
			if (intersectionDistance > 0 && intersectionDistance < selectionDistanceRef.current) {
				// Calculate the intersection point
				target.copy(rayOrigin).addScaledVector(rayDirection, intersectionDistance);
				
				// Check if this point is within our valid grid area
				const gridSizeHalf = gridSize / 2;
				if (Math.abs(target.x) <= gridSizeHalf && Math.abs(target.z) <= gridSizeHalf) {
					// This is a hit against the ground plane within the valid build area
					blockIntersection = {
						point: target.clone(),
						normal: new THREE.Vector3(0, 1, 0), // Normal is up for ground plane
						block: { x: Math.floor(target.x), y: 0, z: Math.floor(target.z) },
						blockId: null, // No block here - it's the ground
						distance: intersectionDistance,
						isGroundPlane: true
					};
				}
			}
		}
		
		// If no intersection at all, hide preview and return
		if (!blockIntersection) {
			if (previewMeshRef.current && previewMeshRef.current.visible) {
				previewMeshRef.current.visible = false;
			}
			return;
		}
		
		// Track if we're hitting the ground plane
		previewIsGroundPlaneRef.current = blockIntersection.isGroundPlane === true;

		// If a tool is active, delegate the mouse move event to it
		if (toolManagerRef.current && toolManagerRef.current.getActiveTool()) {
			toolManagerRef.current.handleMouseMove(null, blockIntersection.point);
			
			// Also call tool update method to allow for continuous updates
			toolManagerRef.current.update();
		}

		// Update preview mesh color based on whether we're hitting a block or the ground plane
		if (previewMeshRef.current && previewMeshRef.current.material) {
			if (previewIsGroundPlaneRef.current) {
				// Ground plane - use a blue tint
				previewMeshRef.current.material.color.setRGB(0.7, 0.7, 1.0);
				previewMeshRef.current.material.opacity = 0.6;
			} else {
				// Block - use normal color
				previewMeshRef.current.material.color.setRGB(1.0, 1.0, 1.0);
				previewMeshRef.current.material.opacity = 0.8;
			}
		}

		if (!currentBlockTypeRef?.current?.isEnvironment) {
			// Reuse vector for grid position calculation
			tempVectorRef.current.copy(blockIntersection.point);
			
			// Apply mode-specific adjustments
			if (modeRef.current === "remove") {
				tempVectorRef.current.x = Math.round(tempVectorRef.current.x - blockIntersection.normal.x * 0.5);
				tempVectorRef.current.y = Math.round(tempVectorRef.current.y - blockIntersection.normal.y * 0.5);
				tempVectorRef.current.z = Math.round(tempVectorRef.current.z - blockIntersection.normal.z * 0.5);
			} else {
				// For add mode, add a small offset in the normal direction before rounding
				tempVectorRef.current.add(blockIntersection.normal.clone().multiplyScalar(0.01));
				// Replace simple rounding with a more consistent approach for negative coordinates
				tempVectorRef.current.x = Math.sign(tempVectorRef.current.x) * Math.round(Math.abs(tempVectorRef.current.x));
				tempVectorRef.current.y = Math.sign(tempVectorRef.current.y) * Math.round(Math.abs(tempVectorRef.current.y));
				tempVectorRef.current.z = Math.sign(tempVectorRef.current.z) * Math.round(Math.abs(tempVectorRef.current.z));
				
				// Handle y-coordinate special case if this is a ground plane hit
				if (previewIsGroundPlaneRef.current && modeRef.current === "add") {
					tempVectorRef.current.y = 0; // Position at y=0 when placing on ground plane
				}
			}

			// Maintain Y position during placement
			if (isPlacingRef.current) {
				tempVectorRef.current.y = currentPlacingYRef.current;
			}

			// Apply axis lock if needed
			if (axisLockEnabledRef.current && isPlacingRef.current) {
				if (!lockedAxisRef.current && !isFirstBlockRef.current) {
					// Determine which axis to lock based on movement
					const newAxis = determineLockedAxis(tempVectorRef.current);
					if (newAxis) {
						lockedAxisRef.current = newAxis;
						console.log("Axis locked to:", newAxis); // Debug log
					}
				}

				if (lockedAxisRef.current) {
					// Lock movement to the determined axis
					if (lockedAxisRef.current === 'x') {
						tempVectorRef.current.z = placementStartPosition.current.z;
					} else {
						tempVectorRef.current.x = placementStartPosition.current.x;
					}
				}
			}

			// Check if we've moved enough to update the preview position
			// This adds hysteresis to prevent small jitters
			if (!isFirstBlockRef.current && isPlacingRef.current) {
				tempVec2Ref.current.set(lastPreviewPositionRef.current.x, lastPreviewPositionRef.current.z);
				tempVec2_2Ref.current.set(tempVectorRef.current.x, tempVectorRef.current.z);
				if (tempVec2Ref.current.distanceTo(tempVec2_2Ref.current) < THRESHOLD_FOR_PLACING) {
					return;
				}
			}

			// Update preview position
			previewPositionRef.current.copy(tempVectorRef.current);
			
			// Only update the state if the position has changed significantly
			if (!lastPreviewPositionRef.current.equals(previewPositionRef.current)) {
				lastPreviewPositionRef.current.copy(previewPositionRef.current);
				setPreviewPosition(previewPositionRef.current.clone());
				
				// Send preview position to App.js
				if (previewPositionToAppJS) {
					previewPositionToAppJS(previewPositionRef.current);
				}
				
				updateDebugInfo();
			}
			
			// Update preview mesh position
			if (previewMeshRef.current) {
				previewMeshRef.current.position.copy(previewPositionRef.current);
				previewMeshRef.current.visible = true;
			}
		} else {
			// For environment objects, position at the intersection point
			const envPosition = blockIntersection.point.clone();
			
			// For environment objects, we want to snap the Y position to the nearest integer
			// and add 0.5 to place them on top of blocks rather than halfway through
			envPosition.y = Math.ceil(envPosition.y);
			
			previewPositionRef.current.copy(envPosition);
			
			// Only update the state if the position has changed significantly
			if (!lastPreviewPositionRef.current.equals(previewPositionRef.current)) {
				lastPreviewPositionRef.current.copy(previewPositionRef.current);
				setPreviewPosition(previewPositionRef.current.clone());
				
				// Send preview position to App.js
				if (previewPositionToAppJS) {
					previewPositionToAppJS(previewPositionRef.current);
				}
				
				updateDebugInfo();
			}
			
			// Update preview mesh position
			if (previewMeshRef.current) {
				previewMeshRef.current.position.copy(previewPositionRef.current);
				previewMeshRef.current.visible = true;
				previewMeshRef.current.updateMatrix();
			}
		}

		if (isPlacingRef.current) {
			handleBlockPlacement();
		}
	};

	updatePreviewPosition.lastUpdate = 0;

	// Move undo state saving to handlePointerUp
	const handleMouseUp = (event) => {
		// If a tool is active, delegate the event to it
		if (toolManagerRef.current && toolManagerRef.current.getActiveTool()) {
			const intersection = getRaycastIntersection();
			if (intersection) {
				toolManagerRef.current.handleMouseUp(event, intersection.point);
				return; // Let the tool handle it
			}
		}
		
		// Otherwise use default behavior
		if (event.button === 0) {
			isPlacingRef.current = false;
			// Clear recently placed blocks
			recentlyPlacedBlocksRef.current.clear();

			if (placementStartState.current) {
				// Gather current state
				const currentState = {
					terrain: { ...terrainRef.current },
					environment: DatabaseManager.getData(STORES.ENVIRONMENT, "current") || []
				};

				// Each "undo" record stores only the blocks added or removed during this drag
				const changes = {
					terrain: {
						added: {},
						removed: {},
					},
					environment: {
						added: [],
						removed: [],
					},
				};

				// Compare old & new terrain for added/removed
				Object.entries(currentState.terrain).forEach(([key, value]) => {
					if (!placementStartState.current.terrain[key]) {
						changes.terrain.added[key] = value;
					}
				});
				Object.entries(placementStartState.current.terrain).forEach(([key, value]) => {
					if (!currentState.terrain[key]) {
						changes.terrain.removed[key] = value;
					}
				});

				if (
					Object.keys(changes.terrain.added).length > 0 ||
					Object.keys(changes.terrain.removed).length > 0
				) {
					// Save Undo
					undoRedoManager.saveUndo(changes);
				}

				// Clear out the "start state"
				placementStartState.current = null;
			}

			// If axis lock was on, reset
			if (axisLockEnabled) {
				lockedAxisRef.current = null;
				placementStartPosition.current = null;
			}
		}
	};

	const getPlacementPositions = (centerPos, placementSize) => {
		const positions = [];

		// Always include center position
		positions.push({ ...centerPos });

		switch (placementSize) {
			default:
			case "single":
				break;

			case "cross":
				positions.push({ x: centerPos.x + 1, y: centerPos.y, z: centerPos.z }, { x: centerPos.x - 1, y: centerPos.y, z: centerPos.z }, { x: centerPos.x, y: centerPos.y, z: centerPos.z + 1 }, { x: centerPos.x, y: centerPos.y, z: centerPos.z - 1 });
				break;

			case "diamond":
				// 13-block diamond pattern
				positions.push(
					// Inner cardinal positions (4 blocks)
					{ x: centerPos.x + 1, y: centerPos.y, z: centerPos.z },
					{ x: centerPos.x - 1, y: centerPos.y, z: centerPos.z },
					{ x: centerPos.x, y: centerPos.y, z: centerPos.z + 1 },
					{ x: centerPos.x, y: centerPos.y, z: centerPos.z - 1 },
					// Middle diagonal positions (4 blocks)
					{ x: centerPos.x + 1, y: centerPos.y, z: centerPos.z + 1 },
					{ x: centerPos.x + 1, y: centerPos.y, z: centerPos.z - 1 },
					{ x: centerPos.x - 1, y: centerPos.y, z: centerPos.z + 1 },
					{ x: centerPos.x - 1, y: centerPos.y, z: centerPos.z - 1 },
					// Outer cardinal positions (4 blocks)
					{ x: centerPos.x + 2, y: centerPos.y, z: centerPos.z },
					{ x: centerPos.x - 2, y: centerPos.y, z: centerPos.z },
					{ x: centerPos.x, y: centerPos.y, z: centerPos.z + 2 },
					{ x: centerPos.x, y: centerPos.y, z: centerPos.z - 2 }
				);
				break;

			case "square9":
				for (let x = -1; x <= 1; x++) {
					for (let z = -1; z <= 1; z++) {
						if (x !== 0 || z !== 0) {
							// Skip center as it's already added
							positions.push({
								x: centerPos.x + x,
								y: centerPos.y,
								z: centerPos.z + z,
							});
						}
					}
				}
				break;

			case "square16":
				for (let x = -2; x <= 1; x++) {
					for (let z = -2; z <= 1; z++) {
						if (x !== 0 || z !== 0) {
							// Skip center as it's already added
							positions.push({
								x: centerPos.x + x,
								y: centerPos.y,
								z: centerPos.z + z,
							});
						}
					}
				}
				break;
		}

		return positions;
	};

	const getCurrentTerrainData = () => {
		return terrainRef.current;
	};

	const determineLockedAxis = (currentPos) => {
		if (!placementStartPosition.current || !axisLockEnabledRef.current) return null;

		const xDiff = Math.abs(currentPos.x - placementStartPosition.current.x);
		const zDiff = Math.abs(currentPos.z - placementStartPosition.current.z);

		// Only lock axis if we've moved enough to determine direction
		// and one axis has significantly more movement than the other
		if (Math.max(xDiff, zDiff) > THRESHOLD_FOR_PLACING) {
			// Require one axis to have at least 50% more movement than the other
			if (xDiff > zDiff * 1.5) {
				return 'x';
			} else if (zDiff > xDiff * 1.5) {
				return 'z';
			}
		}
		return null;
	};


	const updateTerrainFromToolBar = (terrainData) => {
		// Show initial loading screen
		loadingManager.showLoading('Preparing to import Minecraft world...');
		
		// Set terrain data immediately
		terrainRef.current = terrainData;
		
		// Start terrain update immediately for faster response
		buildUpdateTerrain()
			.then(() => {
				// Force a full visibility update after terrain is loaded
				updateVisibleChunks();
				
				// Clear the chunk bounding box cache to ensure proper recalculation
				chunkBoxCache.current.clear();
			})
			.catch((error) => {
				console.error('Error updating terrain:', error);
				loadingManager.hideLoading();
			});
	};

	// Update
	const updateGridSize = (newGridSize) => {
		if (gridRef.current) {
			// Get grid size from localStorage or use default value
			const savedGridSize = parseInt(localStorage.getItem("gridSize"), 10) || newGridSize;

			if (gridRef.current.geometry) {
				gridRef.current.geometry.dispose();
				gridRef.current.geometry = new THREE.GridHelper(savedGridSize, savedGridSize, 0x5c5c5c, 0xeafaea).geometry;
				gridRef.current.material.opacity = 0.1;
				gridRef.current.position.set(0.5, -0.5, 0.5);
			}

			if (shadowPlaneRef.current.geometry) {
				shadowPlaneRef.current.geometry.dispose();
				shadowPlaneRef.current.geometry = new THREE.PlaneGeometry(savedGridSize, savedGridSize);
				shadowPlaneRef.current.position.set(0.5, -0.5, 0.5);
			}
		}
	};

	const updateDebugInfo = () => {
		setDebugInfo({
			preview: previewPositionRef.current,
			totalBlocks: totalBlocksRef.current,
			isGroundPlane: previewIsGroundPlaneRef.current,
		});
		
		// Send total blocks to App component
		if (sendTotalBlocks) {
			sendTotalBlocks(totalBlocksRef.current);
		}
	}

	const clearMap = () => {
		// Clear environment data first
		DatabaseManager.clearStore(STORES.ENVIRONMENT)
			.then(() => {
				// Clear environment objects
				environmentBuilderRef.current.clearEnvironments();
				
				// Clear terrain data
				return DatabaseManager.clearStore(STORES.TERRAIN);
			})
			.then(() => {
				// Clear undo/redo history
				return Promise.all([
					DatabaseManager.saveData(STORES.UNDO, "states", []),
					DatabaseManager.saveData(STORES.REDO, "states", [])
				]);
			})
			.then(() => {
				// Update local terrain state
				terrainRef.current = {};
				buildUpdateTerrain().then(() => {
					// Force a visibility update after clearing the map
					updateVisibleChunks();
				});
				totalBlocksRef.current = 0;
			})
			.catch(error => {
				console.error("Error clearing map data:", error);
			});
	}

	// Update mousemove effect to use requestAnimationFrame
	useEffect(() => {
		const handleMouseMove = () => {
			// Cancel any existing animation frame
			if (mouseMoveAnimationRef.current) {
				cancelAnimationFrame(mouseMoveAnimationRef.current);
			}
			// Request new animation frame
			mouseMoveAnimationRef.current = requestAnimationFrame(updatePreviewPosition);
		};

		window.addEventListener("mousemove", handleMouseMove);
		
		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			// Clean up animation on unmount
			if (mouseMoveAnimationRef.current) {
				cancelAnimationFrame(mouseMoveAnimationRef.current);
				mouseMoveAnimationRef.current = null;
			}
		};
	}, []);

	// Define camera reset effects and axis lock effects
	useEffect(() => {
		if (cameraReset) {
			cameraManager.resetCamera();
		}
	}, [cameraReset]);

	useEffect(() => {
		cameraManager.handleSliderChange(cameraAngle);
	}, [cameraAngle]);

	useEffect(() => {
		axisLockEnabledRef.current = axisLockEnabled;
	}, [axisLockEnabled]);

	// effect to update grid size
	useEffect(() => {
		updateGridSize(gridSize);
	}, [gridSize]);

	// Add this effect to disable frustum culling
	useEffect(() => {
		// Disable frustum culling on camera
		if (threeCamera) {
			threeCamera.frustumCulled = false;
		}
		
		// Disable frustum culling on all scene objects
		if (scene) {
			scene.traverse((object) => {
				if (object.isMesh || object.isInstancedMesh) {
					object.frustumCulled = false;
				}
			});
		}
	}, [threeCamera, scene]);

	// Initialize instanced meshes and load terrain from IndexedDB
	useEffect(() => {
		let mounted = true;

		function initialize() {
			// Initialize camera manager with camera and controls
			if (threeCamera && orbitControlsRef.current) {
				cameraManager.initialize(threeCamera, orbitControlsRef.current);
			}

			// Load skybox
			const loader = new THREE.CubeTextureLoader();
			loader.setPath("./assets/skyboxes/partly-cloudy/");
			const textureCube = loader.load(["+x.png", "-x.png", "+y.png", "-y.png", "+z.png", "-z.png"]);
			if (scene) {
				scene.background = textureCube;
			}

			// Note: We don't pre-initialize meshes for all block types anymore
			// Instead, we'll create them on-demand per chunk
			
			meshesInitializedRef.current = true;

			// Load custom blocks from IndexedDB
			DatabaseManager.getData(STORES.CUSTOM_BLOCKS, "blocks")
				.then((customBlocksData) => {
					if (customBlocksData && customBlocksData.length > 0) {
						/// loop through all the custom blocks and process them
						for(const block of customBlocksData) {
							processCustomBlock(block);
						}
						
						// Notify the app that custom blocks were loaded
						window.dispatchEvent(new CustomEvent('custom-blocks-loaded', {
							detail: { blocks: customBlocksData }
						}));
					}
					
					// Load terrain from IndexedDB
					return DatabaseManager.getData(STORES.TERRAIN, "current");
				})
				.then((savedTerrain) => {
					if (!mounted) return;

					if (savedTerrain) {
						terrainRef.current = savedTerrain;
						console.log("Terrain loaded from IndexedDB");
						totalBlocksRef.current = Object.keys(terrainRef.current).length;
						buildUpdateTerrain(); // Build using chunked approach
					} else {
						console.log("No terrain found in IndexedDB");
						// Initialize with empty terrain
						terrainRef.current = {};
						totalBlocksRef.current = 0;
					}

					setPageIsLoaded(true);
				})
				.catch((error) => {
					console.error("Error loading terrain or custom blocks:", error);
					meshesInitializedRef.current = true;
					setPageIsLoaded(true);
				});
		}

		// Initialize the tool manager with all the properties tools might need
		const terrainBuilderProps = {
			scene,
			terrainRef: terrainRef,
			currentBlockTypeRef: currentBlockTypeRef,
			previewPositionRef: previewPositionRef,
			terrainBuilderRef: ref, // Add a reference to this component
			// Add any other properties tools might need
		};
		
		toolManagerRef.current = new ToolManager(terrainBuilderProps);
		
		// Register tools
		const wallTool = new WallTool(terrainBuilderProps);
		toolManagerRef.current.registerTool("wall", wallTool);
		
		initialize();

		return () => {
			mounted = false; // Prevent state updates after unmount
		};
	}, [threeCamera, scene]);

	// Cleanup effect that cleans up meshes when component unmounts
	useEffect(() => {
		// Capture the current value of the ref when the effect runs
		const currentInstancedMeshes = instancedMeshRef.current;
		
		return () => {
			// Cleanup meshes when component unmounts, using the captured value
			if (currentInstancedMeshes) {
				Object.values(currentInstancedMeshes).forEach((mesh) => {
					if (mesh) {
						scene.remove(mesh);
						if (mesh.geometry) mesh.geometry.dispose();
						if (Array.isArray(mesh.material)) {
							mesh.material.forEach((m) => m?.dispose());
						} else if (mesh.material) {
							mesh.material.dispose();
						}
					}
				});
			}
		};
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [scene]); // Can't include safeRemoveFromScene due to function order

	// effect to refresh meshes when the meshesNeedsRefresh flag is true
	useEffect(() => {
		if (meshesNeedsRefresh) {
			console.log("Refreshing instance meshes due to new custom blocks");
			buildUpdateTerrain();
			meshesNeedsRefresh = false;
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [meshesNeedsRefresh]); // meshesNeedsRefresh is a flag, buildUpdateTerrain is called conditionally

	// effect to update current block type reference when the prop changes
	useEffect(() => {
		currentBlockTypeRef.current = currentBlockType;
	}, [currentBlockType]);

	// Add this effect to update the mode ref when the prop changes
	useEffect(() => {
		modeRef.current = mode;
	}, [mode]);

	// Add this effect to update the ref when placementSize changes
	useEffect(() => {
		placementSizeRef.current = placementSize;
	}, [placementSize]);

	/// build update terrain when the terrain state changes
	useEffect(() => {
		buildUpdateTerrain();
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [terrainRef.current]); // terrainRef.current is a mutable object, react-hooks/exhaustive-deps warning is expected

	/// onSceneReady send the scene to App.js via a setter
	useEffect(() => {
		if (scene && onSceneReady) {
			onSceneReady(scene);
		}
	}, [scene, onSceneReady]);

	// Expose buildUpdateTerrain and clearMap via ref
	useImperativeHandle(ref, () => ({
		buildUpdateTerrain,
		updateTerrainFromToolBar,
		getCurrentTerrainData,
		clearMap,

		/**
		 * Force a DB reload of terrain and then rebuild it
		 */
		async refreshTerrainFromDB() {
			console.log("Refreshing terrain from database");
			
			// Show a single loading screen from start to finish
			loadingManager.showLoading('Loading terrain from database...');
			
			return new Promise(async resolve => {
				try {
					// Set a flag to prevent automatic spatial hash updates
					// Store the previous value to restore it later
					spatialHashUpdateQueuedRef.current = true; 
					
					// Get terrain data from database
					const blocks = await DatabaseManager.getData(STORES.TERRAIN, "current");
					
					console.log("Retrieved blocks from database:", typeof blocks, 
						blocks ? Object.keys(blocks).length : 0, 
						blocks ? "Sample:" : "No blocks found", 
						blocks && Object.keys(blocks).length > 0 ? 
							Object.entries(blocks).slice(0, 1) : "No samples");
					
					if (blocks && Object.keys(blocks).length > 0) {
						// Convert to array format
						const blocksArray = Object.entries(blocks).map(([posKey, blockId]) => {
							return { posKey, blockId };
						});
						
						// Clear current grid
						terrainRef.current = {}; 
						
						// Update loading screen with count
						const totalBlocks = blocksArray.length;
						loadingManager.updateLoading(`Loading ${totalBlocks} blocks...`, 5);
						console.log(`Loading ${totalBlocks} blocks from database`);
						
						// Process blocks directly without the complexity
						const start = performance.now();
						
						// Add all blocks to terrain - this is fast, so just do it in one go
						loadingManager.updateLoading(`Processing ${totalBlocks} blocks...`, 10);
						blocksArray.forEach(block => {
							terrainRef.current[block.posKey] = block.blockId;
						});
						
						// Update loading screen for terrain building
						loadingManager.updateLoading(`Building terrain meshes...`, 20);
						
						// Disable spatial hash updates during terrain building
						const prevThrottle = spatialHashUpdateThrottleRef.current;
						spatialHashUpdateThrottleRef.current = 100000;
						
						// Build terrain
						await buildUpdateTerrain();
						
						// Now for the slow part - spatial hash update
						// We'll use a more optimized approach with larger batches
						loadingManager.updateLoading(`Preparing spatial hash update for ${totalBlocks} blocks...`, 40);
						
						// Clear the spatial hash grid
						spatialHashGridRef.current.clear();
						
						// Prepare the data for faster processing
						const blockEntries = Object.entries(terrainRef.current);
						const totalEntries = blockEntries.length;
						
						// Use larger batches for better performance
						const SPATIAL_HASH_BATCH_SIZE = 100000; // Increased from 50000
						const totalSpatialHashBatches = Math.ceil(totalEntries / SPATIAL_HASH_BATCH_SIZE);
						
						// Process spatial hash in batches
						loadingManager.updateLoading(`Updating spatial hash (0/${totalSpatialHashBatches} batches)...`, 45);
						
						// Use a promise-based batch processor for better UI responsiveness
						const processSpatialHashBatches = async () => {
							for (let batchIndex = 0; batchIndex < totalSpatialHashBatches; batchIndex++) {
								const startIdx = batchIndex * SPATIAL_HASH_BATCH_SIZE;
								const endIdx = Math.min(startIdx + SPATIAL_HASH_BATCH_SIZE, totalEntries);
								
								// Update loading screen with detailed progress
								const progress = 45 + Math.floor((batchIndex / totalSpatialHashBatches) * 45);
								loadingManager.updateLoading(
									`Updating spatial hash: batch ${batchIndex + 1}/${totalSpatialHashBatches} (${Math.floor((batchIndex / totalSpatialHashBatches) * 100)}%)`, 
									progress
								);
								
								// Process this batch
								for (let i = startIdx; i < endIdx; i++) {
									const [posKey, blockId] = blockEntries[i];
									spatialHashGridRef.current.set(posKey, blockId);
								}
								
								// Allow UI to update between batches
								await new Promise(r => setTimeout(r, 0));
							}
							
							return true;
						};
						
						// Process all spatial hash batches
						await processSpatialHashBatches();
						
						// Reset throttle but set last update time to prevent immediate re-update
						spatialHashUpdateThrottleRef.current = prevThrottle;
						spatialHashLastUpdateRef.current = performance.now(); // Mark as just updated
						
						// Log that spatial hash is fully updated
						console.log(`Spatial hash fully updated with ${spatialHashGridRef.current.size} blocks`);
						
						// Final steps
						loadingManager.updateLoading(`Finalizing terrain display...`, 90);
						
						// Update visibility
						updateVisibleChunks();
						
						// Save to database
						loadingManager.updateLoading(`Saving terrain data...`, 95);
						await DatabaseManager.saveData(STORES.TERRAIN, "current", terrainRef.current);
						
						const end = performance.now();
						const seconds = ((end - start) / 1000).toFixed(2);
						console.log(`Terrain loaded in ${seconds} seconds (${totalBlocks} blocks)`);
						
						// Allow spatial hash updates again after a delay
						setTimeout(() => {
							spatialHashUpdateQueuedRef.current = false;
						}, 2000);
						
						loadingManager.hideLoading();
						resolve(true);
					} else {
						console.log("No blocks found in database");
						spatialHashUpdateQueuedRef.current = false;
						loadingManager.hideLoading();
						resolve(false);
					}
				} catch (error) {
					console.error("Error refreshing terrain from database:", error);
					spatialHashUpdateQueuedRef.current = false;
					loadingManager.hideLoading();
					resolve(false);
				}
			});
		},
		
		/**
		 * Load large terrain data incrementally to avoid UI freezes
		 * @param {Array} blocks - Array of blocks to load
		 * @returns {Promise} - Resolves when all blocks are loaded
		 */
		loadLargeTerrainIncrementally(blocks) {
			// Error handling for invalid input
			if (!blocks || !Array.isArray(blocks)) {
				console.error("Invalid blocks data passed to loadLargeTerrainIncrementally:", blocks);
				return Promise.resolve();
			}
			
			// Show loading screen
			loadingManager.showLoading('Loading terrain blocks...');
			
			// Clear terrain if needed
			if (Object.keys(terrainRef.current).length > 0) {
				terrainRef.current = {};
			}
			
			// Save original throttle and increase it temporarily
			const prevSpatialHashUpdateThrottle = spatialHashUpdateThrottleRef.current;
			spatialHashUpdateThrottleRef.current = 100000; // Prevent automatic updates
			
			// Flag to prevent duplicate update attempts
			isUpdatingChunksRef.current = true;
			
			// Use larger batch size for better performance
			const MAX_BLOCKS_PER_BATCH = 100000;
			const totalBlocks = blocks.length;
			const totalBatches = Math.ceil(totalBlocks / MAX_BLOCKS_PER_BATCH);
			
			console.log(`Loading terrain with ${totalBlocks} blocks in ${totalBatches} batches`);
			
			// Function to process one batch
			const processBatch = async (startIndex, promiseResolve) => {
				try {
					const endIndex = Math.min(startIndex + MAX_BLOCKS_PER_BATCH, totalBlocks);
					const batchBlocks = blocks.slice(startIndex, endIndex);
					const currentBatch = Math.floor(startIndex / MAX_BLOCKS_PER_BATCH) + 1;
					
					// Update loading progress
					const progress = Math.floor((startIndex / totalBlocks) * 40);
					loadingManager.updateLoading(`Loading blocks: batch ${currentBatch}/${totalBatches} (${progress}%)`, progress);
					
					// Process blocks in this batch
					batchBlocks.forEach(block => {
						try {
							// Handle different block formats
							if (block.posKey && block.blockId !== undefined) {
								terrainRef.current[block.posKey] = block.blockId;
							} else if (Array.isArray(block) && block.length >= 2) {
								terrainRef.current[block[0]] = block[1];
							} else if (typeof block === 'object' && block !== null) {
								const posKey = block.posKey || block.position || block.key || null;
								const blockId = block.blockId || block.id || block.value || null;
								
								if (posKey && blockId !== null) {
									terrainRef.current[posKey] = blockId;
								}
							}
						} catch (blockError) {
							console.error("Error processing block:", block, blockError);
						}
					});
					
					// Update scene on every batch or final batch for larger batch sizes
					if (currentBatch === totalBatches) {
						loadingManager.updateLoading(`Building terrain meshes...`, 45);
						await buildUpdateTerrain();
						
						// Now handle the spatial hash update - the slow part
						loadingManager.updateLoading(`Preparing spatial hash update...`, 50);
						
						// Clear the spatial hash grid
						spatialHashGridRef.current.clear();
						
						// Prepare the data for faster processing
						const blockEntries = Object.entries(terrainRef.current);
						const totalEntries = blockEntries.length;
						
						// Use larger batches for better performance
						const SPATIAL_HASH_BATCH_SIZE = 100000;
						const totalSpatialHashBatches = Math.ceil(totalEntries / SPATIAL_HASH_BATCH_SIZE);
						
						// Process spatial hash in batches
						loadingManager.updateLoading(`Updating spatial hash (0/${totalSpatialHashBatches} batches)...`, 55);
						
						// Process all spatial hash batches
						for (let batchIndex = 0; batchIndex < totalSpatialHashBatches; batchIndex++) {
							const startIdx = batchIndex * SPATIAL_HASH_BATCH_SIZE;
							const endIdx = Math.min(startIdx + SPATIAL_HASH_BATCH_SIZE, totalEntries);
							
							// Update loading screen with detailed progress
							const progress = 55 + Math.floor((batchIndex / totalSpatialHashBatches) * 35);
							loadingManager.updateLoading(
								`Updating spatial hash: batch ${batchIndex + 1}/${totalSpatialHashBatches} (${Math.floor((batchIndex / totalSpatialHashBatches) * 100)}%)`, 
								progress
							);
							
							// Process this batch
							for (let i = startIdx; i < endIdx; i++) {
								const [posKey, blockId] = blockEntries[i];
								spatialHashGridRef.current.set(posKey, blockId);
							}
							
							// Allow UI to update between batches
							await new Promise(r => setTimeout(r, 0));
						}
						
						// Reset throttle
						spatialHashUpdateThrottleRef.current = prevSpatialHashUpdateThrottle;
						
						// Final steps
						loadingManager.updateLoading(`Finalizing terrain display...`, 90);
						updateVisibleChunks();
						
						// Save to database
						loadingManager.updateLoading(`Saving terrain data...`, 95);
						await DatabaseManager.saveData(STORES.TERRAIN, "current", terrainRef.current);
						
						console.log("Terrain data saved to database");
						loadingManager.hideLoading();
						isUpdatingChunksRef.current = false;
						
						if (promiseResolve) promiseResolve();
					} else {
						// Continue with next batch
						setTimeout(async () => {
							await processBatch(endIndex, promiseResolve);
						}, 0);
					}
				} catch (batchError) {
					console.error("Error processing batch:", batchError);
					loadingManager.hideLoading();
					isUpdatingChunksRef.current = false;
					
					if (promiseResolve) promiseResolve();
				}
			};
			
			// Start processing
			return new Promise(resolve => {
				processBatch(0, resolve);
			});
		},
		
		// Add method to activate a tool
		activateTool: (toolName) => {
			if (toolManagerRef.current) {
				return toolManagerRef.current.activateTool(toolName);
			}
			return false;
		},
		// Add method to get active tool name
		getActiveToolName: () => {
			if (toolManagerRef.current && toolManagerRef.current.getActiveTool()) {
				return toolManagerRef.current.getActiveTool().name;
			}
			return null;
		},

		updateTerrainBlocks,
	
		// Add new chunk-related methods
		rebuildChunk,
		getChunkKey,
	
		// Add greedy meshing toggle
		toggleGreedyMeshing,
		getGreedyMeshingEnabled: () => GREEDY_MESHING_ENABLED,
		
		// Add instancing toggle
		toggleInstancing,
		getInstancingEnabled,
		
		// Add spatial hash toggle
		toggleSpatialHashRayCasting,
		isSpatialHashRayCastingEnabled: () => useSpatialHashRef.current,
		
		// Add selection distance functions
		getSelectionDistance: () => selectionDistanceRef.current,
		setSelectionDistance: (distance) => {
			const newDistance = Math.max(16, Math.min(256, distance)); // Clamp between 16 and 256
			selectionDistanceRef.current = newDistance;
			return newDistance;
		},
		
		// Add view distance functions
		getViewDistance: () => viewDistance,
		setViewDistance: (distance) => {
			const newDistance = Math.max(32, Math.min(256, distance)); // Clamp between 32 and 256
			
			// Only update if value changed
			if (viewDistance !== newDistance) {
				viewDistance = newDistance;
				
				// Clear the chunk bounding box cache to ensure proper recalculation
				chunkBoxCache.current.clear();
				
				// Force immediate update of visible chunks
				updateVisibleChunks();
				
				// Additionally trigger camera move to ensure all systems are updated
				handleCameraMove();
				
				// Schedule additional updates to ensure proper culling
				setTimeout(() => {
					updateVisibleChunks();
					
					// One more update after a delay to catch edge cases
					setTimeout(updateVisibleChunks, 500);
				}, 100);
				
				console.log(`View distance set to ${newDistance} blocks`);
			}
			
			return newDistance;
		},
	}));

	// Add resize listener to update canvasRect
	useEffect(() => {
		const handleResize = () => {
			canvasRectRef.current = null; // Force recalculation on next update
		};
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	}, []);

	// Add key event handlers to delegate to tools
	const handleKeyDown = (event) => {
		if (toolManagerRef.current && toolManagerRef.current.getActiveTool()) {
			toolManagerRef.current.handleKeyDown(event);
		}
	};

	const handleKeyUp = (event) => {
		if (toolManagerRef.current && toolManagerRef.current.getActiveTool()) {
			toolManagerRef.current.handleKeyUp(event);
		}
	};

	// Update useEffect to add key event listeners
	useEffect(() => {
		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('keyup', handleKeyUp);
		
		return () => {
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('keyup', handleKeyUp);
		};
	}, []);

	// Add cleanup for tool manager when component unmounts
	useEffect(() => {
		return () => {
			if (toolManagerRef.current) {
				toolManagerRef.current.dispose();
				toolManagerRef.current = null;
			}
		};
	}, []);

	
	// update the terrain blocks for added and removed blocks
	const updateTerrainBlocks = (addedBlocks, removedBlocks) => {
		console.log('Updating terrain blocks:', addedBlocks);
		// If we placed any blocks, update the scene
		if (Object.keys(addedBlocks).length > 0 || Object.keys(removedBlocks).length > 0) {
			
			buildUpdateTerrain();
			playPlaceSound();

			// Save to database
			DatabaseManager.saveData(STORES.TERRAIN, "current", terrainRef.current);

			// Handle undo/redo correctly
			if (undoRedoManager) {
				// Create the changes object in the format expected by saveUndo
				const changes = {
					terrain: {
						added: addedBlocks,
						removed: removedBlocks
					}
				};
				// Save the undo state
				undoRedoManager.saveUndo(changes);
			}
		}
	}

	
	// Function to rebuild a single chunk
	const rebuildChunk = (chunkKey) => {
		// Skip if scene not ready
		if (!scene || !meshesInitializedRef.current) return;
		
		// Performance tracking
		//const startTime = performance.now();
			
		try {
			// Clean up existing chunk meshes for this chunk
			if (chunkMeshesRef.current[chunkKey]) {
				Object.values(chunkMeshesRef.current[chunkKey]).forEach(mesh => {
					safeRemoveFromScene(mesh);
				});
			}
			chunkMeshesRef.current[chunkKey] = {};
			
			// Get blocks for this chunk
			const chunksBlocks = {};
			// Use chunksRef which tracks blocks by chunk
			const blockRefsData = chunksRef.current.get(chunkKey) || {};
			
			// Convert chunk data to the format expected by mesh builders
			Object.entries(blockRefsData).forEach(([posKey, blockId]) => {
				chunksBlocks[posKey] = blockId;
			});
			
			// If no blocks in this chunk, we're done
			if (Object.keys(chunksBlocks).length === 0) {
				return;
			}
			
			// Try to use greedy meshing first if enabled (most efficient)
			if (GREEDY_MESHING_ENABLED) {
				try {
					const meshes = createGreedyMeshForChunk(chunksBlocks);
					if (meshes) {
						if (!chunkMeshesRef.current[chunkKey]) {
							chunkMeshesRef.current[chunkKey] = {};
						}

						// Add all generated meshes
						Object.entries(meshes).forEach(([key, mesh]) => {
						mesh.userData = { chunkKey };
							mesh.frustumCulled = true;
							chunkMeshesRef.current[chunkKey][key] = mesh;
						safeAddToScene(mesh);
					});
						
					return;
				}
				} catch (error) {
					console.error("Error creating greedy mesh:", error);
				}
			}
			
			// Fall back to instanced rendering (second most efficient)
			if (PERFORMANCE_SETTINGS.instancingEnabled) {
				// Group blocks by type
				const blockTypes = {};
				Object.entries(chunksBlocks).forEach(([posKey, blockId]) => {
					if (!blockTypes[blockId]) {
						blockTypes[blockId] = [];
					}
					blockTypes[blockId].push(posKey);
				});
				
				// Create instance mesh for each block type
				Object.entries(blockTypes).forEach(([blockId, positions]) => {
					const blockType = blockTypesArray.find(b => b.id === parseInt(blockId));
					if (!blockType) return;
					
					// Use cached geometry and material
					const geometry = getCachedGeometry(blockType);
					const material = getCachedMaterial(blockType);
					
					// Create instanced mesh with exact capacity
					const capacity = Math.min(positions.length, CHUNK_BLOCK_CAPACITY);
					const instancedMesh = new THREE.InstancedMesh(
						geometry,
						material,
						capacity
					);
					instancedMesh.userData = { blockTypeId: blockType.id, chunkKey };
					instancedMesh.frustumCulled = true;
					instancedMesh.castShadow = true;
					instancedMesh.receiveShadow = true;
					
					// Use pooled matrix if available
					const tempMatrix = new THREE.Matrix4();
					
					// Set matrix for each block
					positions.forEach((posKey, index) => {
						const [x, y, z] = posKey.split(',').map(Number);
						tempMatrix.makeTranslation(x, y, z);
						instancedMesh.setMatrixAt(index, tempMatrix);
					});
					
					// Update mesh
					instancedMesh.count = positions.length;
					instancedMesh.instanceMatrix.needsUpdate = true;
					
					// Store and add to scene directly
					if (!chunkMeshesRef.current[chunkKey]) {
						chunkMeshesRef.current[chunkKey] = {};
					}
					chunkMeshesRef.current[chunkKey][blockId] = instancedMesh;
					safeAddToScene(instancedMesh);
				});
			} else {
				// Individual meshes as last resort
				Object.entries(chunksBlocks).forEach(([posKey, blockId]) => {
					const blockType = blockTypesArray.find(b => b.id === parseInt(blockId));
					if (!blockType) return;
					
					const geometry = getCachedGeometry(blockType);
					const material = getCachedMaterial(blockType);
					
					const mesh = new THREE.Mesh(geometry, material);
					const [x, y, z] = posKey.split(',').map(Number);
					mesh.position.set(x, y, z);
					
					mesh.userData = { blockId: blockType.id, chunkKey, blockPos: posKey };
					mesh.frustumCulled = true;
					
					// Add to scene
					if (!chunkMeshesRef.current[chunkKey]) {
						chunkMeshesRef.current[chunkKey] = {};
					}
					if (!chunkMeshesRef.current[chunkKey][blockId]) {
						chunkMeshesRef.current[chunkKey][blockId] = [];
					}
					if (Array.isArray(chunkMeshesRef.current[chunkKey][blockId])) {
						chunkMeshesRef.current[chunkKey][blockId].push(mesh);
					} else {
						chunkMeshesRef.current[chunkKey][blockId] = [mesh];
					}
					safeAddToScene(mesh);
				});
			}
		} catch (error) {
			console.error("Error rebuilding chunk:", error);
		}
	};

	// Cleanup on unmount or when dependencies change
	useEffect(() => {
		return () => {
			// Clean up chunk meshes
			if (chunkMeshesRef.current && scene) {
				Object.entries(chunkMeshesRef.current).forEach(([chunkKey, blockMeshes]) => {
					Object.values(blockMeshes).forEach(mesh => {
						safeRemoveFromScene(mesh);
					});
				});
				chunkMeshesRef.current = {};
			}
		};
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [scene]); // safeRemoveFromScene is used but declared later

	// Function to update which chunks are visible based on camera position and frustum
	const updateVisibleChunks = () => {
		if (!threeCamera || !scene) return;
		
		const currentTime = performance.now();
		
		// Don't perform full visibility updates too frequently
		// This significantly reduces lag spikes during movement
		if (currentTime - lastVisibilityUpdateTimeRef.current < visibilityUpdateIntervalRef.current) {
			// We're updating too frequently, skip this update
			return;
		}
		
		// Record the time of this update
		lastVisibilityUpdateTimeRef.current = currentTime;
		
		// Performance tracking
		const startTime = performance.now();
		
		// Update frustum for culling
		frustumRef.current.setFromProjectionMatrix(
		frustumMatrixRef.current.multiplyMatrices(
			threeCamera.projectionMatrix,
			threeCamera.matrixWorldInverse
			)
		);
		
		// Track visible chunks for this update
		const visibleChunks = new Set();
		
		// Track chunks that need to be loaded, with distance to camera for prioritization
		const chunksToLoad = [];
		
		// Get current and next history frames
		const currentHistoryFrame = chunkVisibilityHistoryRef.current.currentFrameIndex;
		const nextHistoryFrame = (currentHistoryFrame + 1) % visibilityHistoryFramesRef.current;
		
		// Clear the next frame (which will become our current frame)
		chunkVisibilityHistoryRef.current.frames[nextHistoryFrame].clear();
		
		// Get camera position for distance calculations
		const cameraPos = threeCamera.position.clone();
		
		// Get camera forward vector for predictive loading during rotation
		const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(threeCamera.quaternion);
		
		// Get camera chunk coordinates
		const cameraChunkX = Math.floor(cameraPos.x / CHUNK_SIZE);
		const cameraChunkY = Math.floor(cameraPos.y / CHUNK_SIZE);
		const cameraChunkZ = Math.floor(cameraPos.z / CHUNK_SIZE);
		
		// Calculate view radius in chunks (add margin of 1 chunk)
		const viewRadiusInChunks = Math.ceil(viewDistance / CHUNK_SIZE) + 1;
		
		// Cache this calculation to avoid recomputing for each chunk
		const viewRadiusSquared = (viewRadiusInChunks * CHUNK_SIZE) * (viewRadiusInChunks * CHUNK_SIZE);
		
		// Pre-filter chunks more efficiently using square distance
		const chunksToCheck = [...chunksRef.current.keys()].filter(chunkKey => {
			const [x, y, z] = chunkKey.split(',').map(Number);
			
			// Quick approximate distance check in chunk coordinates (Manhattan distance first)
			const dx = Math.abs(x - cameraChunkX);
			const dy = Math.abs(y - cameraChunkY);
			const dz = Math.abs(z - cameraChunkZ);
	  
			// If any dimension is greater than view radius, chunk is definitely too far
			if (dx > viewRadiusInChunks || dy > viewRadiusInChunks || dz > viewRadiusInChunks) {
				return false;
			}
	  
			// For chunks that pass the quick check, do a more accurate but still fast check
			// Calculate squared distance between chunk center and camera
			const worldX = x * CHUNK_SIZE + CHUNK_SIZE/2;
			const worldY = y * CHUNK_SIZE + CHUNK_SIZE/2;
			const worldZ = z * CHUNK_SIZE + CHUNK_SIZE/2;
			
			const sqDx = worldX - cameraPos.x;
			const sqDy = worldY - cameraPos.y;
			const sqDz = worldZ - cameraPos.z;
			const sqDistance = sqDx*sqDx + sqDy*sqDy + sqDz*sqDz;
			
			// Include chunks within the view radius plus some margin
			return sqDistance <= viewRadiusSquared;
		});
		
		// Check filtered chunks to see which are visible
		chunksToCheck.forEach(chunkKey => {
			// Check if chunk is visible using our improved function
			if (isChunkVisible(chunkKey, threeCamera, frustumRef.current)) {
				visibleChunks.add(chunkKey);
				
				// Reset the visibility change timer since chunk is now visible
				delete chunkVisibilityChangeTimeRef.current[chunkKey];
				
				// Track this chunk as visible for this frame
				chunkVisibilityHistoryRef.current.frames[nextHistoryFrame].add(chunkKey);
				
				// Get chunk center for distance calculation
				const [x, y, z] = chunkKey.split(',').map(Number);
				const chunkSize = CHUNK_SIZE;
				const chunkCenter = new THREE.Vector3(
					x * chunkSize + chunkSize/2,
					y * chunkSize + chunkSize/2,
					z * chunkSize + chunkSize/2
				);
				
				// Calculate distance to camera
				const distanceToCamera = chunkCenter.distanceTo(cameraPos);
				
				// Ensure chunk mesh exists and is visible
				if (!chunkMeshesRef.current[chunkKey]) {
					// Add to load queue with distance priority
					chunksToLoad.push({
						chunkKey,
						distance: distanceToCamera
					});
				} else {
					// Make sure all meshes in the chunk are visible
					const meshes = chunkMeshesRef.current[chunkKey];
					Object.values(meshes).forEach(mesh => {
						if (Array.isArray(mesh)) {
							// Handle array of meshes
							mesh.forEach(m => {
								if (!scene.children.includes(m)) {
									safeAddToScene(m);
								}
							});
						} else if (!scene.children.includes(mesh)) {
							safeAddToScene(mesh);
						}
					});
				}
			} else {
				// Check if chunk has been visible in recent frames
				let wasRecentlyVisible = false;
				let recentVisibilityCount = 0;
				
				// Count how many recent frames had this chunk visible
				for (let i = 0; i < visibilityHistoryFramesRef.current; i++) {
					if (i !== nextHistoryFrame && // Skip the frame we're currently updating
						chunkVisibilityHistoryRef.current.frames[i].has(chunkKey)) {
						wasRecentlyVisible = true;
						recentVisibilityCount++;
					}
				}
				
				// Calculate visibility stability based on recent history
				// Higher count means chunk has been stable for longer
				const visibilityStability = recentVisibilityCount / visibilityHistoryFramesRef.current;
				
				// Keep recently visible chunks visible for a few frames to reduce flickering
				// The longer it's been visible, the more we want to keep showing it
				if (wasRecentlyVisible && chunkMeshesRef.current[chunkKey]) {
					// For very stable chunks (visible in most recent frames), add to next frame history
					// This makes stable chunks "stick" longer and prevents random flickering
					if (visibilityStability > 0.5) {
						visibleChunks.add(chunkKey);
						// Add to the next frame history to maintain visibility
						chunkVisibilityHistoryRef.current.frames[nextHistoryFrame].add(chunkKey);
					} else {
						// For less stable chunks, still show them but don't add to history
						visibleChunks.add(chunkKey);
						// Do not add to the next frame's history to let it naturally fade out
						// if it stays invisible
					}
					
					// Existing code for chunk handling...
					Object.values(chunkMeshesRef.current[chunkKey]).forEach(mesh => {
						if (Array.isArray(mesh)) {
							mesh.forEach(m => {
								if (!scene.children.includes(m)) {
									safeAddToScene(m);
								}
							});
						} else if (!scene.children.includes(mesh)) {
							safeAddToScene(mesh);
						}
					});
				} else {
					// Check if chunk might soon be visible due to camera rotation
					// This adds predictive loading for chunks that will soon come into view
					// to reduce pop-in during camera rotation
					const [x, y, z] = chunkKey.split(',').map(Number);
					const chunkSize = CHUNK_SIZE;
					const chunkCenter = new THREE.Vector3(
						x * chunkSize + chunkSize/2,
						y * chunkSize + chunkSize/2,
						z * chunkSize + chunkSize/2
					);
					
					// Vector from camera to chunk center
					const camToChunk = chunkCenter.clone().sub(cameraPos);
					const distanceToCamera = camToChunk.length();
					
					// Only consider chunks within view distance
					if (distanceToCamera <= viewDistance) {
						// Check if chunk is in the general direction of where camera is looking
						// Dot product > 0 means the chunk is in front of the camera
						// Higher dot product means more aligned with camera view direction
						camToChunk.normalize();
						const dotProduct = camToChunk.dot(cameraForward);
						
						// If chunk is in front of camera (within a 120-degree cone)
						// and close enough to potentially become visible during rotation
						if (dotProduct > 0.3 && cameraMoving.current) { // Reduced from 0.5 to 0.3 to widen the prediction cone
							// Preload this chunk with a slightly lower priority
							chunksToLoad.push({
								chunkKey,
								distance: distanceToCamera + 5 // Add slight penalty to prioritize actually visible chunks
							});
							
							// Don't add to visibleChunks so it doesn't get rendered yet
							// but it will be ready when camera rotates to see it
						} else {
							// Chunk is not visible and not likely to become visible soon, hide its meshes
							if (chunkMeshesRef.current[chunkKey]) {
								const currentTime = performance.now();
								
								// Only hide if it's been invisible for a while (debounce)
								if (!chunkVisibilityChangeTimeRef.current[chunkKey]) {
									// First time chunk is invisible, just record the time
									chunkVisibilityChangeTimeRef.current[chunkKey] = currentTime;
								} else if (currentTime - chunkVisibilityChangeTimeRef.current[chunkKey] > visibilityChangeDelayRef.current) {
									// Chunk has been invisible for long enough, hide it
									Object.values(chunkMeshesRef.current[chunkKey]).forEach(mesh => {
										if (Array.isArray(mesh)) {
											// Handle array of meshes
											mesh.forEach(m => {
												if (scene.children.includes(m)) {
													safeRemoveFromScene(m);
												}
											});
										} else if (scene.children.includes(mesh)) {
											safeRemoveFromScene(mesh);
										}
									});
								}
								// Otherwise keep showing the chunk to avoid flickering
							}
						}
					} else {
						// Chunk is not visible, hide its meshes to save on rendering
						if (chunkMeshesRef.current[chunkKey]) {
							const currentTime = performance.now();
							
							// Only hide if it's been invisible for a while (debounce)
							if (!chunkVisibilityChangeTimeRef.current[chunkKey]) {
								// First time chunk is invisible, just record the time
								chunkVisibilityChangeTimeRef.current[chunkKey] = currentTime;
							} else if (currentTime - chunkVisibilityChangeTimeRef.current[chunkKey] > visibilityChangeDelayRef.current) {
								// Chunk has been invisible for long enough, hide it
								Object.values(chunkMeshesRef.current[chunkKey]).forEach(mesh => {
									if (Array.isArray(mesh)) {
										// Handle array of meshes
										mesh.forEach(m => {
											if (scene.children.includes(m)) {
												safeRemoveFromScene(m);
											}
										});
									} else if (scene.children.includes(mesh)) {
										safeRemoveFromScene(mesh);
									}
								});
							}
							// Otherwise keep showing the chunk to avoid flickering
						}
					}
				}
			}
		});
		
		// Update the history frame index
		chunkVisibilityHistoryRef.current.currentFrameIndex = nextHistoryFrame;
		
		// Process chunks that weren't checked in the pre-filtering to ensure they are hidden
		// This fixes the issue where distant chunks remain visible
		[...chunksRef.current.keys()].forEach(chunkKey => {
			if (!chunksToCheck.includes(chunkKey) && chunkMeshesRef.current[chunkKey]) {
				// This chunk is definitely out of view distance, make sure it's hidden
				Object.values(chunkMeshesRef.current[chunkKey]).forEach(mesh => {
					if (Array.isArray(mesh)) {
						mesh.forEach(m => {
							if (scene.children.includes(m)) {
								safeRemoveFromScene(m);
							}
						});
					} else if (scene.children.includes(mesh)) {
						safeRemoveFromScene(mesh);
					}
				});
			}
		});
		
		// Sort chunks to load by distance (closest first)
		chunksToLoad.sort((a, b) => a.distance - b.distance);
		
		// Only process a limited number of chunks per frame to avoid stuttering
		// Take the closest chunks first, up to the limit
		const maxChunksToProcess = PERFORMANCE_SETTINGS.maxChunksPerFrame * (cameraMoving.current ? 1.5 : 1); // Process more chunks during camera movement
		const prioritizedChunks = chunksToLoad.slice(0, Math.ceil(maxChunksToProcess));
		
		// Queue the high-priority chunks for immediate loading
		if (prioritizedChunks.length > 0 && !isUpdatingChunksRef.current) {
			// Process chunks in sync with the render cycle
			isUpdatingChunksRef.current = true;
			
			const processNextChunk = (index) => {
				if (index >= prioritizedChunks.length) {
					isUpdatingChunksRef.current = false;
					updateVisibleChunks(); // Final visibility update
					return;
				}
				
				const { chunkKey } = prioritizedChunks[index];
				rebuildChunkNoVisibilityUpdate(chunkKey);
				
				// Process next chunk on the next animation frame to stay in sync with rendering
				requestAnimationFrame(() => processNextChunk(index + 1));
			};
			
			requestAnimationFrame(() => processNextChunk(0));
		}
		
		// Queue remaining chunks with lower priority (for later frames)
		if (chunksToLoad.length > maxChunksToProcess) {
			const lowerPriorityChunks = chunksToLoad.slice(maxChunksToProcess);
			
			// Only process if we're not already updating high-priority chunks
			if (!isUpdatingChunksRef.current) {
				isUpdatingChunksRef.current = true;
				
				const processLowerPriority = (index) => {
					if (index >= lowerPriorityChunks.length) {
						isUpdatingChunksRef.current = false;
						return;
					}
					
					const { chunkKey } = lowerPriorityChunks[index];
					// Only rebuild if the chunk is still needed (camera might have moved)
					if (isChunkVisible(chunkKey, threeCamera, frustumRef.current)) {
						rebuildChunkNoVisibilityUpdate(chunkKey);
					}
					
					// Process next chunk after next animation frame
					requestAnimationFrame(() => processLowerPriority(index + 1));
				};
				
				requestAnimationFrame(() => processLowerPriority(0));
			}
		}
		
		// Track performance
		const endTime = performance.now();
		const duration = endTime - startTime;
		if (duration > 16) {
			console.log(`Chunk visibility update took ${duration.toFixed(2)}ms`);
		}
	};

	// Call update visible chunks when camera moves
	useEffect(() => {
		if (!threeCamera.current) return;
		
		// Initial update
		updateVisibleChunks();
		
		// Set up a render loop to check camera changes
		const handler = () => {
			updateVisibleChunks();
		};
		
		// Capture the current value of orbitControlsRef when the effect runs
		const currentOrbitControls = orbitControlsRef.current;
		
		// Listen for camera movements
		currentOrbitControls?.addEventListener('change', handler);
		
		// Clean up
		return () => {
			// Use the captured value in cleanup
			currentOrbitControls?.removeEventListener('change', handler);
		};
	}, [updateVisibleChunks]); // Only depend on updateVisibleChunks

	// Add camera movement hook to update visible chunks
	useEffect(() => {
		const animate = () => {
			// Only update when camera is moving
			if (orbitControlsRef.current?.isMoving) {
				updateVisibleChunks();
			}
			
			// Store the animation ID in the ref
			cameraAnimationRef.current = requestAnimationFrame(animate);
		};
		
		// Start the animation
		cameraAnimationRef.current = requestAnimationFrame(animate);
		
		return () => {
			// Clean up animation on unmount
			if (cameraAnimationRef.current) {
				cancelAnimationFrame(cameraAnimationRef.current);
				cameraAnimationRef.current = null;
			}
		};
	}, [updateVisibleChunks]); // Add updateVisibleChunks as dependency

	// Add clean-up code for caches
	useEffect(() => {
		return () => {
			clearMaterialGeometryCaches();
		};
	}, []);

	// Function to get cached or create new geometry
	const getCachedGeometry = (blockType) => {
		const cacheKey = blockType.id;
		
		if (geometryCache.current.has(cacheKey)) {
			return geometryCache.current.get(cacheKey);
		}
		
		const geometry = createBlockGeometry(blockType);
		geometryCache.current.set(cacheKey, geometry);
		return geometry;
	};
	
	// Function to get cached or create new material
	const getCachedMaterial = (blockType) => {
		const cacheKey = blockType.id;
		
		if (materialCache.current.has(cacheKey)) {
			return materialCache.current.get(cacheKey);
		}
		
		const material = blockType.isMultiTexture 
			? createBlockMaterial(blockType)
			: createBlockMaterial(blockType)[0];
			
		materialCache.current.set(cacheKey, material);
		return material;
	};
	
	// Clear geometry and material caches when blocks are modified
	const clearMaterialGeometryCaches = () => {
		// Dispose of all geometries in the cache
		geometryCache.current.forEach(geometry => {
			if (geometry && geometry.dispose) {
				geometry.dispose();
			}
		});
		
		// Dispose of all materials in the cache
		materialCache.current.forEach(material => {
			if (material) {
				if (Array.isArray(material)) {
					material.forEach(m => m?.dispose?.());
				} else if (material.dispose) {
					material.dispose();
				}
			}
		});
		
		// Clear the caches
		geometryCache.current.clear();
		materialCache.current.clear();
	};

	// Implement createGreedyMeshForChunk to use our optimized version
	const createGreedyMeshForChunk = (chunksBlocks) => {
		// Skip texture atlas if disabled
		if (TEXTURE_ATLAS_SETTINGS.useTextureAtlas && atlasInitialized) {
			try {
				const optimizedMesh = chunkMeshBuilder.buildChunkMesh(chunksBlocks, blockTypesArray);
				if (optimizedMesh) {
					// Return a single mesh as an object for compatibility with existing code
					return { 'optimized': optimizedMesh };
				}
			} catch (error) {
				console.error("Error creating greedy mesh:", error);
				// Fall back to original implementation
			}
		}
		
		// Use our generateGreedyMesh function as fallback
		const meshData = generateGreedyMesh(chunksBlocks, blockTypesArray);
		
		// If using original implementation that returns meshData, convert it to meshes
		if (meshData) {
				const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.Float32BufferAttribute(meshData.vertices, 3));
			geometry.setAttribute('normal', new THREE.Float32BufferAttribute(meshData.normals, 3));
			geometry.setAttribute('uv', new THREE.Float32BufferAttribute(meshData.uvs, 2));
			geometry.setIndex(meshData.indices);
			
			const material = new THREE.MeshStandardMaterial({
				map: textureAtlas ? textureAtlas.getAtlasTexture() : null,
				side: THREE.FrontSide,
				transparent: false,
				alphaTest: 0.5
			});
			
				const mesh = new THREE.Mesh(geometry, material);
			return { 'greedy': mesh };
		}
		
		// If all else fails, return null
		return null;
	};

	// Toggle greedy meshing on/off
	const toggleGreedyMeshing = (enabled) => {
	  console.log(`Setting greedy meshing to ${enabled}`);
	  const changed = setGreedyMeshingEnabled(enabled);
	  
	  // Also update the ChunkMeshBuilder if it exists
	  if (chunkMeshBuilder) {
	    chunkMeshBuilder.setGreedyMeshing(enabled);
	  }
	  
	  // If changed, rebuild all chunks
	  if (changed) {
	    console.log("Rebuilding all chunks with greedy meshing", enabled ? "enabled" : "disabled");
	    Object.keys(chunkMeshesRef.current).forEach(chunkKey => {
	      rebuildChunk(chunkKey);
	    });
	  }
	  
	  return changed;
	};

	// Add these variables near the top of the component
	const spatialHashLastUpdateRef = useRef(0);
	const spatialHashUpdateQueuedRef = useRef(false);
	const spatialHashUpdateThrottleRef = useRef(1000); // 1 second minimum between updates

	// Replace the updateSpatialHash function with this throttled version
	const updateSpatialHash = () => {
		// If an update is already queued, don't queue another one
		if (spatialHashUpdateQueuedRef.current) {
			console.log("Skipping redundant spatial hash update (update already queued)");
			return;
		}
		
		const now = performance.now();
		
		// If it's been less than the throttle time since the last update, queue an update
		// Note: During bulk operations like loading a map, spatialHashUpdateThrottleRef.current can be
		// temporarily set to a high value to prevent excessive updates
		if (now - spatialHashLastUpdateRef.current < spatialHashUpdateThrottleRef.current) {
			console.log(`Throttling spatial hash update (last update was ${((now - spatialHashLastUpdateRef.current) / 1000).toFixed(2)}s ago, throttle is ${(spatialHashUpdateThrottleRef.current / 1000).toFixed(2)}s)`);
			spatialHashUpdateQueuedRef.current = true;
			
			// Schedule an update after the throttle time has passed
			setTimeout(() => {
				spatialHashUpdateQueuedRef.current = false;
				// Only update if no other updates were scheduled while waiting
				if (!spatialHashUpdateQueuedRef.current) {
					console.log("Executing delayed spatial hash update after throttle period");
					updateSpatialHashImpl();
				}
			}, spatialHashUpdateThrottleRef.current - (now - spatialHashLastUpdateRef.current));
			
			return;
		}
		
		// Otherwise, update immediately
		console.log("Executing immediate spatial hash update");
		updateSpatialHashImpl();
	};

	// Implement the actual spatial hash update logic
	const updateSpatialHashImpl = () => {
		const blockCount = Object.keys(terrainRef.current).length;
		console.log(`Starting spatial hash grid update for ${blockCount} blocks (throttle: ${spatialHashUpdateThrottleRef.current}ms, queued: ${spatialHashUpdateQueuedRef.current})`);
		
		const startTime = performance.now();
		
		// Update the last update time
		spatialHashLastUpdateRef.current = startTime;
		
		// Clear existing hash
		spatialHashGridRef.current.clear();
		
		// If there are too many blocks, use a chunked approach
		if (blockCount > 100000) {
			// Schedule the chunked update
			updateSpatialHashChunked();
			
			// Return early with a partial update for immediate interaction
			// Just add blocks from visible chunks for now
			const visibleChunks = getVisibleChunks();
			let visibleBlockCount = 0;
			
			visibleChunks.forEach(chunkKey => {
				const chunkBlocks = chunksRef.current.get(chunkKey);
				if (chunkBlocks) {
					Object.entries(chunkBlocks).forEach(([posKey, blockId]) => {
						spatialHashGridRef.current.set(posKey, blockId);
						visibleBlockCount++;
					});
				}
			});
			
			const endTime = performance.now();
			console.log(`Spatial hash partially updated with ${visibleBlockCount} visible blocks in ${(endTime - startTime).toFixed(2)}ms. Full update scheduled.`);
			return;
		}
		
		// For smaller maps, add all blocks to the hash in one go
		Object.entries(terrainRef.current).forEach(([posKey, blockId]) => {
			spatialHashGridRef.current.set(posKey, blockId);
		});
		
		const endTime = performance.now();
		console.log(`Spatial hash fully updated with ${spatialHashGridRef.current.size} blocks in ${(endTime - startTime).toFixed(2)}ms`);
	};

	// Get visible chunks based on camera position and frustum
	const getVisibleChunks = () => {
		if (!threeCamera || !scene) return [];
		
		// Create frustum from camera
		const frustum = new THREE.Frustum();
		const projScreenMatrix = new THREE.Matrix4();
		projScreenMatrix.multiplyMatrices(threeCamera.projectionMatrix, threeCamera.matrixWorldInverse);
		frustum.setFromProjectionMatrix(projScreenMatrix);
		
		// Get camera position for calculations
		const cameraPos = threeCamera.position.clone();
		
		// Get chunks within view distance
		const cameraChunkX = Math.floor(cameraPos.x / CHUNK_SIZE);
		const cameraChunkY = Math.floor(cameraPos.y / CHUNK_SIZE);
		const cameraChunkZ = Math.floor(cameraPos.z / CHUNK_SIZE);
		
		// Collect visible chunks
		const visibleChunks = [];
		// Use the global viewDistance variable instead of a hardcoded value
		
		// Check all chunks in our data
		chunksRef.current.forEach((_, chunkKey) => {
			// Check if this chunk is visible
			if (isChunkVisible(chunkKey, threeCamera, frustum)) {
				visibleChunks.push(chunkKey);
			}
		});
		
		// If we have very few visible chunks, add some nearby chunks
		if (visibleChunks.length < 5) {
			// Add chunks in a small radius around the camera
			for (let x = -2; x <= 2; x++) {
				for (let y = -2; y <= 2; y++) {
					for (let z = -2; z <= 2; z++) {
						const chunkKey = `${cameraChunkX + x},${cameraChunkY + y},${cameraChunkZ + z}`;
						if (chunksRef.current.has(chunkKey) && !visibleChunks.includes(chunkKey)) {
							visibleChunks.push(chunkKey);
						}
					}
				}
			}
		}
		
		return visibleChunks;
	};

	// Update spatial hash in chunks to avoid blocking the main thread
	const updateSpatialHashChunked = () => {
		const blockEntries = Object.entries(terrainRef.current);
		const totalBlocks = blockEntries.length;
		let processedBlocks = 0;
		const BATCH_SIZE = 50000;
		const totalBatches = Math.ceil(totalBlocks / BATCH_SIZE);
		let currentBatch = 0;
		
		// Check if we're already in a loading process
		// If we have a high throttle set, we're likely in the middle of an import/load
		const alreadyInLoadingProcess = spatialHashUpdateThrottleRef.current > 10000;
		let showingLoadingScreen = false;
		
		// Show loading screen if this appears to be a standalone update
		if (!alreadyInLoadingProcess) {
			try {
				loadingManager.showLoading('Updating spatial hash grid...');
				showingLoadingScreen = true;
			} catch (error) {
				console.error("Error showing loading screen:", error);
			}
		}
		
		// Function to process a batch of blocks
		const processBatch = (startIndex) => {
			currentBatch++;
			const endIndex = Math.min(startIndex + BATCH_SIZE, totalBlocks);
			
			// Update the loading status if we created a loading screen
			if (showingLoadingScreen) {
				try {
					const progress = Math.floor((currentBatch / totalBatches) * 100);
					loadingManager.updateLoading(`Updating spatial hash: batch ${currentBatch}/${totalBatches} (${progress}%)`, progress);
				} catch (error) {
					console.error("Error updating loading screen:", error);
				}
			}
			
			for (let i = startIndex; i < endIndex; i++) {
				const [posKey, blockId] = blockEntries[i];
				spatialHashGridRef.current.set(posKey, blockId);
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
				console.log(`Spatial hash fully updated with ${spatialHashGridRef.current.size} blocks`);
				
				// Hide loading screen if we created one
				if (showingLoadingScreen) {
					try {
						loadingManager.hideLoading();
					} catch (error) {
						console.error("Error hiding loading screen:", error);
					}
				}
			}
		};
		
		// Start processing
		processBatch(0);
	};

	// Call this in buildUpdateTerrain after updating terrainRef
	
	// Optimized ray intersection using spatial hash
	const getOptimizedRaycastIntersection = (prioritizeBlocks = false) => {
		if (!threeRaycaster || !threeCamera) return null;
		
		// Create ray from camera
		const ray = threeRaycaster.ray.clone();
		
		// First, check for ground plane intersection to have it as a fallback
		const rayOrigin = ray.origin;
		const rayDirection = ray.direction;
		
		// Calculate intersection with the ground plane
		const target = new THREE.Vector3();
		const intersectionDistance = rayOrigin.y / -rayDirection.y;
		
		// Store ground plane intersection if valid
		let groundIntersection = null;
		
		// Only consider intersections in front of the camera and within selection distance
		if (intersectionDistance > 0 && intersectionDistance < selectionDistanceRef.current) {
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
		if (spatialHashGridRef.current.size === 0) {
			return groundIntersection;
		}
		
		// Parameters for ray marching
		const maxDistance = selectionDistanceRef.current; // Use the configurable selection distance
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
			if (isPlacingRef.current && recentlyPlacedBlocksRef.current.has(blockKey)) {
				pos.add(step);
				distance += precision;
				continue;
			}
			
			// Check if there's a block at this position (using spatial hash)
			if (spatialHashGridRef.current.has(blockKey)) {
				// We hit a block!
				const blockId = spatialHashGridRef.current.get(blockKey);
				
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
	};

	
	// Add texture atlas initialization effect
	useEffect(() => {
		// Skip texture atlas initialization if disabled
		if (!TEXTURE_ATLAS_SETTINGS.useTextureAtlas) {
			console.log("Texture atlas disabled in settings");
			return;
		}
		
		// Initialize texture atlas
		const initAtlas = async () => {
			if (!blockTypesArray || blockTypesArray.length === 0) {
				console.warn("Cannot initialize texture atlas: no block types available");
				return;
			}
			
			console.log("Initializing texture atlas in TerrainBuilder with", blockTypesArray.length, "block types");
			try {
				// Clear any previous initialization state
				atlasInitialized = false;
				
				// Initialize the texture atlas and wait for it to complete
				const atlas = await initTextureAtlas(blockTypesArray);
				
				if (!atlas) {
					throw new Error("Texture atlas initialization returned null");
				}
				
				console.log("Texture atlas initialization complete!");
				
				// Setup chunk load manager if it doesn't exist
				if (!chunkLoadManager.current) {
					// Apply concurrent rebuild setting
					const maxConcurrent = TEXTURE_ATLAS_SETTINGS.maxConcurrentChunkRebuilds;
					chunkLoadManager.current = new ChunkLoadManager(async (chunkKey) => {
						await rebuildChunk(chunkKey);
					});
					chunkLoadManager.current.maxConcurrentLoads = maxConcurrent;
				}
				
				// Only rebuild chunks if we have any
				const chunkMeshesData = chunkMeshesRef ? chunkMeshesRef.current : {};
				const chunkKeys = Object.keys(chunkMeshesData);
				
				if (chunkKeys.length > 0) {
					console.log(`Texture atlas ready, rebuilding ${chunkKeys.length} chunks...`);
					
					// If batch rebuilding is disabled, rebuild all chunks at once
					if (!TEXTURE_ATLAS_SETTINGS.batchedChunkRebuilding) {
						console.log("Batch rebuilding disabled, rebuilding all chunks at once");
						// Use a slight delay to allow UI to update
						setTimeout(() => {
							chunkKeys.forEach(chunkKey => {
								rebuildChunk(chunkKey);
							});
						}, TEXTURE_ATLAS_SETTINGS.initialRebuildDelay);
					} else {
						// Queue chunks for rebuilding with priorities
						const rebuildChunks = () => {
							chunkKeys.forEach((chunkKey, index) => {
								let priority = 100 - (index % 10);
								
								// Prioritize by distance if enabled
								if (TEXTURE_ATLAS_SETTINGS.prioritizeChunksByDistance && threeCamera) {
									const [chunkX, chunkY, chunkZ] = chunkKey.split(',').map(Number);
									const cameraPos = threeCamera.position;
									const distance = Math.sqrt(
										Math.pow(chunkX*16 - cameraPos.x, 2) + 
										Math.pow(chunkY*16 - cameraPos.y, 2) + 
										Math.pow(chunkZ*16 - cameraPos.z, 2)
									);
									// Higher priority for closer chunks (0-100 range)
									priority = Math.max(0, 100 - Math.min(100, Math.floor(distance / 10)));
								}
								
								chunkLoadManager.current.addChunkToQueue(chunkKey, priority);
							});
						};
						
						// Delay initial rebuild if enabled
						if (TEXTURE_ATLAS_SETTINGS.delayInitialRebuild) {
							setTimeout(rebuildChunks, TEXTURE_ATLAS_SETTINGS.initialRebuildDelay);
						} else {
							rebuildChunks();
						}
					}
				} else {
					console.log("Texture atlas ready, no chunks to rebuild");
				}
			} catch (error) {
				console.error("Failed to initialize texture atlas:", error);
				// Reset the flag so we can try again
				atlasInitialized = false;
			}
		};
		
		// Call the async function
		initAtlas().catch(error => {
			console.error("Texture atlas initialization failed:", error);
			atlasInitialized = false;
		});
		
		// Cleanup function
		return () => {
			// Cancel any pending operations if component unmounts
			if (chunkLoadManager.current) {
				chunkLoadManager.current.clearQueue();
			}
		};
	}, [blockTypesArray]); // Re-run if block types change

	// Add a polyfill for requestIdleCallback for browsers that don't support it
	const requestIdleCallbackPolyfill = window.requestIdleCallback || 
	  ((callback, options) => {
	    const start = Date.now();
	    return setTimeout(() => {
	      callback({
	        didTimeout: false,
	        timeRemaining: () => Math.max(0, 50 - (Date.now() - start))
	      });
	    }, options?.timeout || 1);
	  });

	
	// Add these variables to track camera movement outside the animate function
	const lastCameraPosition = new THREE.Vector3();
	const lastCameraRotation = new THREE.Euler();
	const cameraMovementTimeout = { current: null };
	const chunkUpdateThrottle = { current: 0 };

	// Update the usages of these optimizations
	useEffect(() => {
		// Apply renderer optimizations
		optimizeRenderer(gl);
		
		// Initialize camera manager with camera and controls
		cameraManager.initialize(threeCamera, orbitControlsRef.current);
		
		// Set up a consistent update loop
		let frameId;
		let lastTime = 0;
		let frameCount = 0;
		
		const animate = (time) => {
			frameId = requestAnimationFrame(animate);
			
			// Calculate delta time for smooth updates
			const delta = time - lastTime;
			lastTime = time;
			
			// Only run heavy operations every few frames to reduce lag
			frameCount++;
			const shouldRunHeavyOperations = frameCount % 3 === 0; // Only every 3rd frame
			
			// Detect camera movement (cheaper comparison)
			if (threeCamera) {
				const posX = threeCamera.position.x;
				const posY = threeCamera.position.y;
				const posZ = threeCamera.position.z;
				
				const rotX = threeCamera.rotation.x;
				const rotY = threeCamera.rotation.y;
				const rotZ = threeCamera.rotation.z;
				
				const positionChanged = 
					Math.abs(posX - lastCameraPosition.x) > 0.01 ||
					Math.abs(posY - lastCameraPosition.y) > 0.01 ||
					Math.abs(posZ - lastCameraPosition.z) > 0.01;
					
				const rotationChanged = 
					Math.abs(rotX - lastCameraRotation.x) > 0.01 ||
					Math.abs(rotY - lastCameraRotation.y) > 0.01 ||
					Math.abs(rotZ - lastCameraRotation.z) > 0.01;
				
				const isCameraMoving = positionChanged || rotationChanged;
				
				// Update stored values (cheaper than .copy())
				lastCameraPosition.x = posX;
				lastCameraPosition.y = posY;
				lastCameraPosition.z = posZ;
				
				lastCameraRotation.x = rotX;
				lastCameraRotation.y = rotY;
				lastCameraRotation.z = rotZ;
				
				// Set camera moving state
				if (isCameraMoving) {
					cameraMoving.current = true;
					
					// Clear any existing timeout
					if (cameraMovementTimeout.current) {
						clearTimeout(cameraMovementTimeout.current);
					}
					
					// Set timeout to detect when camera stops moving
					cameraMovementTimeout.current = setTimeout(() => {
						cameraMoving.current = false;
						chunkUpdateThrottle.current = 0;
						
						// Force a full visibility update when camera stops
						if (shouldRunHeavyOperations) {
							updateVisibleChunks();
						} else {
							// Schedule for next frame when heavy operations are allowed
							requestAnimationFrame(() => updateVisibleChunks());
						}
					}, 100); // Reduced from 150ms to 100ms for quicker response
				}
			}
			
			// Only update if enough time has passed (throttle updates)
			if (delta > 16 && shouldRunHeavyOperations) { // ~60fps max and only every 3rd frame
				// Throttle chunk updates during camera movement
				if (cameraMoving.current) {
					// Increase throttle during camera movement (update less frequently)
					chunkUpdateThrottle.current++;
					if (chunkUpdateThrottle.current >= 3) { // Keep at 3 frames to maintain balance
						updateVisibleChunks();
						chunkUpdateThrottle.current = 0;
					}
				} else if (frameCount % 10 === 0) { // Even less frequent updates when camera is still
					// Normal updates when camera is still, but less frequent
					updateVisibleChunks();
				}
				
				// Only update shadows periodically and even less frequently
				if (frameCount % 30 === 0) {
					if (gl && gl.shadowMap) {
						gl.shadowMap.needsUpdate = true;
					}
					
					// Force shadow maps to update occasionally
					if (directionalLightRef.current) {
						directionalLightRef.current.shadow.needsUpdate = true;
					}
				}
			}
		};
		
		// Start the animation loop
		frameId = requestAnimationFrame(animate);
		
		// Clean up animation frame on component unmount
		return () => {
			cancelAnimationFrame(frameId);
		};
	}, [gl]);

	
	// Helper function to check if a chunk is visible in the frustum
	const isChunkVisible = (chunkKey, camera, frustum) => {
	  // Check distance to camera first (quick rejection)
	  const [x, y, z] = chunkKey.split(',').map(Number);
	  const chunkSize = CHUNK_SIZE;
	  const worldX = x * chunkSize;
	  const worldY = y * chunkSize;
	  const worldZ = z * chunkSize;
	  
	  // Calculate chunk center
	  const centerX = worldX + chunkSize/2;
	  const centerY = worldY + chunkSize/2;
	  const centerZ = worldZ + chunkSize/2;
	  
	  // Calculate square distance to camera (faster than actual distance)
	  const dx = centerX - camera.position.x;
	  const dy = centerY - camera.position.y;
	  const dz = centerZ - camera.position.z;
	  const squareDistance = dx*dx + dy*dy + dz*dz;
	  
	  // Special handling for very close chunks - always consider them visible
	  // This prevents flickering of chunks that are right next to the camera
	  const closeThreshold = CHUNK_SIZE * 3; // 3 chunks distance
	  if (squareDistance < (closeThreshold * closeThreshold)) {
	    return true;
	  }
	  
	  // For distant chunks, use a faster but less accurate approach
	  // This significantly improves performance for large worlds
	  const farThreshold = CHUNK_SIZE * 15; // 15 chunks distance
	  if (squareDistance > (farThreshold * farThreshold)) {
	    // For far chunks, only check against a simplified frustum (cone check)
	    // This is much faster than full frustum intersection tests
	    // Calculate normalized direction from camera to chunk center
	    const dirX = dx / Math.sqrt(squareDistance);
	    const dirY = dy / Math.sqrt(squareDistance);
	    const dirZ = dz / Math.sqrt(squareDistance);
	    
	    // Get camera forward vector
	    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
	    
	    // Calculate dot product - how aligned chunk is with camera direction
	    const dotProduct = dirX * forward.x + dirY * forward.y + dirZ * forward.z;
	    
	    // Frustum has ~60 degree field of view (cos(30) ≈ 0.866)
	    // Chunks outside this cone are definitely not visible
	    return dotProduct > -0.5; // Use -0.5 for wider cone to be safe
	  }
	  
	  // For chunks at medium distance, use proper frustum culling
	  // Get or create bounding box for this chunk
	  let chunkBox = chunkBoxCache.current.get(chunkKey);
	  
	  if (!chunkBox) {
	    // Create and cache the bounding box
	    chunkBox = new THREE.Box3().setFromPoints([
	      new THREE.Vector3(worldX, worldY, worldZ),
	      new THREE.Vector3(worldX + chunkSize, worldY + chunkSize, worldZ + chunkSize)
	    ]);
	    chunkBoxCache.current.set(chunkKey, chunkBox);
	  }
	  
	  // Test if the chunk is in frustum
	  return frustum.intersectsBox(chunkBox);
	};

	// Add these getter/setter functions

	// Add this function to manage the chunk update queue
	const addChunkToUpdateQueue = (chunkKey, priority = 0) => {
		// Don't add duplicates
		if (chunkUpdateQueueRef.current.some(item => item.chunkKey === chunkKey)) {
			// If it's already in the queue with lower priority, update the priority
			const existingItem = chunkUpdateQueueRef.current.find(item => item.chunkKey === chunkKey);
			if (existingItem && priority > existingItem.priority) {
				existingItem.priority = priority;
				// Re-sort the queue based on updated priorities
				chunkUpdateQueueRef.current.sort((a, b) => b.priority - a.priority);
			}
			return;
		}
		
		// Add to queue with priority
		chunkUpdateQueueRef.current.push({
			chunkKey,
			priority,
			addedTime: performance.now()
		});
		
		// Sort by priority (higher first)
		chunkUpdateQueueRef.current.sort((a, b) => b.priority - a.priority);
		
		// Start processing the queue if it's not already running
		if (!isProcessingChunkQueueRef.current) {
			processChunkQueue();
		}
	};

	// Function to process chunks from the queue with frame timing
	const processChunkQueue = () => {
		isProcessingChunkQueueRef.current = true;
		
		// If queue is empty, stop processing
		if (chunkUpdateQueueRef.current.length === 0) {
			isProcessingChunkQueueRef.current = false;
			return;
		}
		
		const startTime = performance.now();
		const maxTimePerFrame = 10; // Max ms to spend processing chunks per frame
		
		// Process a limited number of chunks per frame
		let chunksProcessed = 0;
		const maxChunksPerFrame = 3; // Limit chunks per frame to prevent render stuttering
		
		while (chunkUpdateQueueRef.current.length > 0 && 
				(performance.now() - startTime < maxTimePerFrame) &&
				(chunksProcessed < maxChunksPerFrame)) {
			
			// Get the highest priority chunk
			const { chunkKey } = chunkUpdateQueueRef.current.shift();
			
			// Rebuild the chunk
			rebuildChunkNoVisibilityUpdate(chunkKey);
			
			// Record last process time and increment counter
			lastChunkProcessTimeRef.current = performance.now();
			chunksProcessed++;
		}
		
		// If there are more chunks to process, continue in the next frame
		if (chunkUpdateQueueRef.current.length > 0) {
			requestAnimationFrame(processChunkQueue);
		} else {
			isProcessingChunkQueueRef.current = false;
		}
	};

	// Handle camera movement to pause chunk processing during navigation
	const handleCameraMove = () => {
		// Pause chunk processing during camera movement to prevent stutters
		if (chunkLoadManager.current && TEXTURE_ATLAS_SETTINGS.batchedChunkRebuilding) {
			chunkLoadManager.current.pause();
			
			// Resume after a short delay when camera stops moving
			clearTimeout(cameraMovementTimeoutRef.current);
			cameraMovementTimeoutRef.current = setTimeout(() => {
				if (chunkLoadManager.current) {
					chunkLoadManager.current.resume();
				}
				
				// Update visible chunks after camera stops moving
				// Use requestAnimationFrame to ensure it's synchronized with the render cycle
				requestAnimationFrame(() => {
					updateVisibleChunks();
				});
			}, 50); // Reduced from 75ms to 50ms for faster response
		}
		
		// Also request a visible chunk update immediately (but throttled for performance)
		// This makes movement more responsive without waiting for the camera to stop
		if (!handleCameraMove.lastUpdateTime || performance.now() - handleCameraMove.lastUpdateTime > 75) { // Reduced from 100ms to 75ms for more frequent updates
			requestAnimationFrame(() => {
				updateVisibleChunks();
				handleCameraMove.lastUpdateTime = performance.now();
			});
		}
	};
	
	// Initialize the last update time
	handleCameraMove.lastUpdateTime = 0;

	// Add this function to efficiently update the spatial hash for a batch of blocks
	const updateSpatialHashForBlocks = (addedBlocks = [], removedBlocks = []) => {
		// Skip if spatial hash is disabled
		if (!useSpatialHashRef.current) return;
		
		// If we have a lot of updates, it might be more efficient to rebuild the entire hash
		if (addedBlocks.length + removedBlocks.length > 1000) {
			// Queue a full update with throttling
			updateSpatialHash();
			return;
		}
		
		// Otherwise, just update the specific blocks
		addedBlocks.forEach(({ key, blockId }) => {
			spatialHashGridRef.current.set(key, blockId);
		});
		
		removedBlocks.forEach(({ key }) => {
			spatialHashGridRef.current.delete(key);
		});
	};

	// Effect to initialize and maintain visibility tracking
	useEffect(() => {
		// Initialize visibility history if needed
		if (!chunkVisibilityHistoryRef.current.frames) {
			chunkVisibilityHistoryRef.current = {
				frames: [],
				currentFrameIndex: 0
			};
			
			for (let i = 0; i < visibilityHistoryFramesRef.current; i++) {
				chunkVisibilityHistoryRef.current.frames.push(new Set());
			}
		}
		
		// Handle cleanup
		return () => {
			// Clear visibility history when component unmounts
			if (chunkVisibilityHistoryRef.current.frames) {
				chunkVisibilityHistoryRef.current.frames.forEach(frame => frame.clear());
			}
			
			// Clear debounce timers
			chunkVisibilityChangeTimeRef.current = {};
		};
	}, []);

	// Main return statement
	return (
		<>
			<OrbitControls
				ref={orbitControlsRef}
				enablePan={true}
				enableZoom={false}
				enableRotate={true}
				mouseButtons={{
					MIDDLE: THREE.MOUSE.PAN,
					RIGHT: THREE.MOUSE.ROTATE,
				}}
				onChange={handleCameraMove}
			/>

			{/* Shadow directional light */}
			<directionalLight
				ref={directionalLightRef}
				position={[10, 20, 10]}
				intensity={2}
				color={0xffffff}
				castShadow={true}
				shadow-mapSize-width={2048}
				shadow-mapSize-height={2048}
				shadow-camera-far={1000}
				shadow-camera-near={10}
				shadow-camera-left={-100}
				shadow-camera-right={100}
				shadow-camera-top={100}
				shadow-camera-bottom={-100}
				shadow-bias={0.00005}
				shadow-normalBias={0.1}
			/>

			{/* Non shadow directional light */}
			<directionalLight
				position={[10, 20, 10]}
				intensity={1}
				color={0xffffff}
				castShadow={false}
			/>

			{/* Ambient light */}
			<ambientLight intensity={0.8} />
			
			{/* mesh of invisible plane to receive shadows, and grid helper to display grid */}
			<mesh 
				ref={shadowPlaneRef} 
				position={[0.5, -0.51, 0.5]}
				rotation={[-Math.PI / 2, 0, 0]} 
				onPointerDown={handleMouseDown}
				onPointerUp={handleMouseUp}
				transparent={true}
				receiveShadow={true}
				castShadow={false}
				frustumCulled={false}>
				<planeGeometry args={[gridSize, gridSize]} />
				<meshPhongMaterial
					transparent
					opacity={0}
				/>
			</mesh>
			<gridHelper
				position={[0.5, -0.5, 0.5]}
				ref={gridRef}
			/>

			{previewPosition && (modeRef.current === "add" || modeRef.current === "remove") && (
				<group>
					{getPlacementPositions(previewPosition, placementSizeRef.current).map((pos, index) => (
						<group
							key={index}
							position={[pos.x, pos.y, pos.z]}>
							<mesh renderOrder={2}>
								<boxGeometry args={[1.02, 1.02, 1.02]} />
								<meshPhongMaterial
									color={modeRef.current === "add" ? "green" : "red"}
									opacity={0.4}
									transparent={true}
									depthWrite={false}
									depthTest={true}
									alphaTest={0.1}
								/>
							</mesh>
							<lineSegments renderOrder={3}>
								<edgesGeometry args={[new THREE.BoxGeometry(1, 1, 1)]} />
								<lineBasicMaterial
									color="darkgreen"
									linewidth={2}
								/>
							</lineSegments>
						</group>
					))}
				</group>
			)}
		</>
	);
}

// Convert to forwardRef
export default forwardRef(TerrainBuilder);

// Performance settings for the texture atlas and chunk loading
const TEXTURE_ATLAS_SETTINGS = {
  // Whether to use batched chunk rebuilding (smooth but can cause stutters on large maps)
  batchedChunkRebuilding: true,
  
  // Maximum number of concurrent chunk rebuilds (lower = smoother but slower)
  maxConcurrentChunkRebuilds: 4,
  
  // Whether to prioritize chunks by distance (helps with camera movement fluidity)
  prioritizeChunksByDistance: true,
  
  // Whether to delay chunk rebuilding when atlas is initialized (reduces initial stutter)
  delayInitialRebuild: true,
  
  // Initial delay before starting chunk rebuilds (ms)
  initialRebuildDelay: 100,
  
  // Whether to use texture atlas at all (disable for very low-end devices)
  useTextureAtlas: false
};

// Export settings getter/setter functions
export const getTextureAtlasSettings = () => TEXTURE_ATLAS_SETTINGS;

export const setTextureAtlasSetting = (setting, value) => {
  if (setting in TEXTURE_ATLAS_SETTINGS) {
    TEXTURE_ATLAS_SETTINGS[setting] = value;
    
    // Update chunk load manager concurrency if it exists
    if (setting === 'maxConcurrentChunkRebuilds' && chunkLoadManager && chunkLoadManager.current) {
      chunkLoadManager.current.maxConcurrentLoads = value;
    }
    
    console.log(`Updated texture atlas setting: ${setting} = ${value}`);
    return true;
  }
  return false;
};

// Reset chunk renderer with new settings
export const resetChunkRenderer = (settings = {}) => {
	// Update settings
	Object.entries(settings).forEach(([key, value]) => {
		setTextureAtlasSetting(key, value);
	});
	
	// Clear chunk load manager if it exists
	if (chunkLoadManager && chunkLoadManager.current) {
		chunkLoadManager.current.clearQueue();
	}
	
	// If disabling texture atlas, clear the atlas
	if (settings.hasOwnProperty('useTextureAtlas') && !settings.useTextureAtlas) {
		atlasInitialized = false;
		textureAtlas = null;
		chunkMeshBuilder = null;
	}
	
	// Set flag to rebuild all meshes
	meshesNeedsRefresh = true;
	
	console.log("Chunk renderer reset with new settings:", settings);
};

