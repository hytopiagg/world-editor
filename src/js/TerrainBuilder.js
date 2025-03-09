import React, { useRef, useEffect, useState, forwardRef, useMemo, useImperativeHandle } from "react";
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

// Import tools
import { ToolManager, WallTool } from "./tools";

// Define chunk constants
const CHUNK_SIZE = 16;
const CHUNK_BLOCK_CAPACITY = BLOCK_INSTANCED_MESH_CAPACITY / 8; // Smaller capacity per chunk
const FRUSTUM_CULLING_DISTANCE = 64; // Increase view distance for less pop-in
const FRUSTUM_BUFFER_DISTANCE = 16; // Additional buffer distance to reduce popping
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

// Greedy meshing constants
const MESH_SIDES = [
    { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]], normal: [0, 0, 1] }, // front (+z)
    { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]], normal: [0, 0, -1] }, // back (-z)
    { dir: [0, 1, 0], corners: [[0, 1, 0], [1, 1, 0], [0, 1, 1], [1, 1, 1]], normal: [0, 1, 0] }, // top (+y)
    { dir: [0, -1, 0], corners: [[0, 0, 1], [1, 0, 1], [0, 0, 0], [1, 0, 0]], normal: [0, -1, 0] }, // bottom (-y)
    { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 0, 1], [1, 1, 1]], normal: [1, 0, 0] }, // right (+x)
    { dir: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 0, 0], [0, 1, 0]], normal: [-1, 0, 0] }, // left (-x)
];

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
  if (atlasInitialized) return;
  
  console.log("Initializing texture atlas...");
  textureAtlas = new TextureAtlas();
  await textureAtlas.initialize(blockTypes);
  
  chunkMeshBuilder = new ChunkMeshBuilder(textureAtlas);
  atlasInitialized = true;
  console.log("Texture atlas initialized");
  
  return textureAtlas.getAtlasTexture();
};

// Replace the createGreedyMesh function with our optimized version
const generateGreedyMesh = (chunksBlocks, blockTypes) => {
    if (!atlasInitialized) {
        console.warn("Texture atlas not initialized, falling back to original mesh generation");
        // Call original implementation or initialize texture atlas first
        return null;
    }
    
    return chunkMeshBuilder.buildChunkMesh(chunksBlocks, blockTypes);
};

// LOD System Constants
const LOD_ENABLED = true;
const LOD_LEVELS = [
	{ distance: 3, scale: 1 },    // Level 0: Full detail (1-3 chunks away)
	{ distance: 6, scale: 2 },    // Level 1: Medium detail (4-6 chunks away)
	{ distance: 10, scale: 4 },   // Level 2: Low detail (7-10 chunks away)
	{ distance: 16, scale: 8 }    // Level 3: Very low detail (11-16 chunks away)
];

// Define face directions for optimized neighbor checking
const NEIGHBOR_CHECK_DIRECTIONS = [
    { offset: [1, 0, 0], axis: 0, dir: 1 },   // +X
    { offset: [-1, 0, 0], axis: 0, dir: -1 }, // -X
    { offset: [0, 1, 0], axis: 1, dir: 1 },   // +Y
    { offset: [0, -1, 0], axis: 1, dir: -1 }, // -Y
    { offset: [0, 0, 1], axis: 2, dir: 1 },   // +Z
    { offset: [0, 0, -1], axis: 2, dir: -1 }  // -Z
];

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

function TerrainBuilder({ onSceneReady, previewPositionToAppJS, currentBlockType, undoRedoManager, mode, setDebugInfo, sendTotalBlocks, axisLockEnabled, gridSize, cameraReset, cameraAngle, placementSize, setPageIsLoaded, customBlocks, environmentBuilderRef}, ref) {

	// Scene setup
	const { camera, scene, raycaster, pointer, gl } = useThree();
	const meshesInitializedRef = useRef(false);
	const placementStartState = useRef(null);
	const instancedMeshRef = useRef({});
	const placementStartPosition = useRef(null);
	const orbitControlsRef = useRef();
	const gridRef = useRef();
	const shadowPlaneRef = useRef();
	const directionalLightRef = useRef();
	const terrainRef = useRef({});

	// Animation tracking
	const mouseMoveAnimationRef = useRef(null);
	const cameraAnimationRef = useRef(null);

	// Refs needed for real-time updates that functions depend on
	const isPlacingRef = useRef(false);
	const currentPlacingYRef = useRef(0);
	const previewPositionRef = useRef(new THREE.Vector3());
	const lockedAxisRef = useRef(null);
	const blockCountsRef = useRef({});
	const totalBlocksRef = useRef(0);
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

	// Add chunk management references
	const chunksRef = useRef(new Map());
	const chunkMeshesRef = useRef({});
	const [chunksNeedUpdate, setChunksNeedUpdate] = useState(false);
	const isUpdatingChunksRef = useRef(false);
	const frustumRef = useRef(new THREE.Frustum());
	const frustumMatrixRef = useRef(new THREE.Matrix4());

	// Add caching for geometries and materials
	const geometryCache = useRef(new Map());
	const materialCache = useRef(new Map());

	// Add spatial hash grid ref for efficient ray casting
	const spatialHashGridRef = useRef(new Map());

	// Toggle use of spatial hash for ray casting
	const useSpatialHashRef = useRef(true); // Default to true
	
	// Chunk update queue refs
	const chunkUpdateQueueRef = useRef([]);
	const isProcessingChunkQueueRef = useRef(false);
	const lastChunkProcessTimeRef = useRef(0);
	
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
		// Skip if meshes not initialized yet
		if (!meshesInitializedRef.current || !scene) return;
		
		// Don't queue multiple updates
		if (isUpdatingChunksRef.current) {
			console.log("Skipping redundant terrain update, one is already in progress");
			return;
		}

		// Set updating flag
		isUpdatingChunksRef.current = true;

		// Process in the next frame to avoid React rendering issues
		setTimeout(() => {
			try {
				// Reset block counts
				let blockCountsByType = {};
				
				// Clear existing chunk data
				chunksRef.current.clear();
				
				// Organize chunks by distance from camera
				const cameraChunkX = Math.floor(camera.position.x / CHUNK_SIZE);
				const cameraChunkY = Math.floor(camera.position.y / CHUNK_SIZE);
				const cameraChunkZ = Math.floor(camera.position.z / CHUNK_SIZE);
				
				// Processing queue
				const chunkQueue = [];
				
				// Group blocks by chunk and calculate distances
				Object.entries(terrainRef.current).forEach(([posKey, blockId]) => {
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
				});
				
				// Update spatial hash grid for ray casting
				updateSpatialHash();
				
				// Sort chunks by distance (closest first)
				chunkQueue.sort((a, b) => a.distance - b.distance);
				
				// Clean up existing chunk meshes
				Object.entries(chunkMeshesRef.current).forEach(([chunkKey, blockMeshes]) => {
					Object.values(blockMeshes).forEach(mesh => {
						safeRemoveFromScene(mesh);
					});
				});
				
				// Reset chunk meshes
				chunkMeshesRef.current = {};
				
				// For backward compatibility, update the block counts
				blockCountsRef.current = blockCountsByType;
				totalBlocksRef.current = Object.keys(terrainRef.current).length;
				
				// Update debug info early
				updateDebugInfo();
				
				// Process chunks in batches for smoother loading
				const BATCH_SIZE = 5; // Number of chunks to process in each batch
				
				const processBatch = (startIndex) => {
					// If we're done, finish up
					if (startIndex >= chunkQueue.length) {
						// Flag that we're done
						isUpdatingChunksRef.current = false;
						
						// Update visibility now that all chunks are built
						updateVisibleChunks();
						
						// Save terrain asynchronously after all chunks are loaded
						DatabaseManager.saveData(STORES.TERRAIN, "current", terrainRef.current)
							.catch(error => console.error("Error saving terrain:", error));
							
						return;
					}
					
					// Process a batch of chunks
					const endIndex = Math.min(startIndex + BATCH_SIZE, chunkQueue.length);
					
					// Process this batch
					for (let i = startIndex; i < endIndex; i++) {
						const { chunkKey } = chunkQueue[i];
						try {
							rebuildChunkNoVisibilityUpdate(chunkKey);
						} catch (error) {
							console.error(`Error processing chunk ${chunkKey}:`, error);
						}
					}
					
					// Update visibility once for the whole batch
					updateVisibleChunks();
					
					// Schedule the next batch with a small delay to let the UI update
					setTimeout(() => {
						processBatch(endIndex);
					}, 5); // 5ms between batches
				};
				
				// Start processing the first batch
				processBatch(0);
				
			} catch (error) {
				console.error("Error in buildUpdateTerrain:", error);
				isUpdatingChunksRef.current = false;
			}
		}, 0);
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
					
					// Update spatial hash for faster ray casting
					spatialHashGridRef.current.set(key, blockId);

					// Track block updates
					blockUpdates.push({ type: 'add', key, chunkKey, pos, blockId });
				}
			} else if (isRemovingBlock) {
				if (terrainRef.current[key]) {
					const oldBlockId = terrainRef.current[key];
					delete terrainRef.current[key];
					terrainChanged = true;
					
					// Remove from spatial hash
					spatialHashGridRef.current.delete(key);

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
		if (!scene || !camera || !raycaster) return null;
		
		// Use the raw pointer coordinates directly from THREE.js
		const normalizedMouse = pointer.clone();
		
		// Setup raycaster with the normalized coordinates
		raycaster.setFromCamera(normalizedMouse, camera);
		
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
		const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
		const rayOrigin = raycaster.ray.origin;
		const rayDirection = raycaster.ray.direction;
		
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
		const dir = raycaster.ray.direction.clone().normalize();
		const pos = raycaster.ray.origin.clone();
		
		// Check if there are any chunks in this direction
		let hasChunksInDirection = false;
		const checkedChunks = new Set();
		
		// Get camera chunk
		const camChunkX = Math.floor(pos.x / CHUNK_SIZE);
		const camChunkY = Math.floor(pos.y / CHUNK_SIZE);
		const camChunkZ = Math.floor(pos.z / CHUNK_SIZE);
		
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
			const toCenterX = chunkCenterX - camera.position.x;
			const toCenterY = chunkCenterY - camera.position.y;
			const toCenterZ = chunkCenterZ - camera.position.z;
			
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
			const distanceToCamera = camera.position.distanceToSquared(new THREE.Vector3(x, y, z));
			if (distanceToCamera > selectionDistanceRef.current * selectionDistanceRef.current) {
				return; // Skip blocks beyond selection distance
			}
			
			// Create a temporary box for raycasting
			const tempBox = new THREE.Box3(
				new THREE.Vector3(x - 0.5, y - 0.5, z - 0.5),
				new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5)
			);
			
			// Check if ray intersects this box
			if (raycaster.ray.intersectsBox(tempBox)) {
				// Calculate true distance from camera
				const distanceFromCamera = camera.position.distanceTo(new THREE.Vector3(x, y, z));
				
				// Skip blocks that are too far away
				if (distanceFromCamera > selectionDistanceRef.current) {
					return;
				}
				
				// Determine which face was hit (approximation)
				const intersection = raycaster.ray.intersectBox(tempBox, new THREE.Vector3());
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
		raycaster.setFromCamera(normalizedMouseRef.current, camera);
		
		// FIRST PASS: Check for block intersections directly
		let blockIntersection = null;
		
		// Use spatial hash for efficient block checking
		if (useSpatialHashRef.current && spatialHashGridRef.current.size > 0) {
			// Create ray from camera
			const ray = raycaster.ray.clone();
			
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
			const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
			const rayOrigin = raycaster.ray.origin;
			const rayDirection = raycaster.ray.direction;
			
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
					environment: DatabaseManager.getData(STORES.ENVIRONMENT, "current") || [],
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
		// Check if terrainData is an Int16Array (new format) or an object (old format)
		if (terrainData instanceof Int16Array) {
			console.log("Processing terrain data in Int16Array format");
			// Convert Int16Array to the object format used internally
			const convertedTerrain = {};
			for (let i = 0; i < terrainData.length; i += 4) {
				const x = terrainData[i];
				const y = terrainData[i + 1];
				const z = terrainData[i + 2];
				const blockId = terrainData[i + 3];
				convertedTerrain[`${x},${y},${z}`] = blockId;
			}
			terrainRef.current = convertedTerrain;
		} else {
			console.log("Processing terrain data in object format");
			terrainRef.current = terrainData;
		}
		buildUpdateTerrain();
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
				buildUpdateTerrain();
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
		camera.frustumCulled = false;
		
		// Disable frustum culling on all scene objects
		scene.traverse((object) => {
			if (object.isMesh || object.isInstancedMesh) {
				object.frustumCulled = false;
			}
		});
	}, [camera, scene]);

	// Initialize instanced meshes and load terrain from IndexedDB
	useEffect(() => {
		let mounted = true;

		function initialize() {
			// Initialize camera manager with camera and controls
			cameraManager.initialize(camera, orbitControlsRef.current);

			// Load skybox
			const loader = new THREE.CubeTextureLoader();
			loader.setPath("./assets/skyboxes/partly-cloudy/");
			const textureCube = loader.load(["+x.png", "-x.png", "+y.png", "-y.png", "+z.png", "-z.png"]);
			scene.background = textureCube;

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
	}, [camera, scene]);

	// Cleanup effect that cleans up meshes when component unmounts
	useEffect(() => {
		return () => {
			// Cleanup meshes when component unmounts
			Object.values(instancedMeshRef.current).forEach((mesh) => {
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
		};
	}, [scene]); // Empty dependency array means this only runs on unmount

	// effect to refresh meshes when the meshesNeedsRefresh flag is true
	useEffect(() => {
		if (meshesNeedsRefresh) {
			console.log("Refreshing instance meshes due to new custom blocks");
			buildUpdateTerrain();
			meshesNeedsRefresh = false;
		}
	}, [meshesNeedsRefresh]);

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
	}, [terrainRef.current]);

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
			try {
				const saved = await DatabaseManager.getData(STORES.TERRAIN, "current");
				console.log("Refreshing terrain from DB, found blocks:", saved ? Object.keys(saved).length : 0);
				if (saved) {
					terrainRef.current = saved;
				} else {
					terrainRef.current = {};
				}
				buildUpdateTerrain();
			} catch (err) {
				console.error("Error reloading terrain from DB:", err);
			}
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

	// Function to update chunk meshes efficiently
	const updateChunkMeshes = (chunkKey, adds, removes) => {
		// Skip if scene not ready
		if (!scene || !meshesInitializedRef.current) return;
		
		// If chunk doesn't exist in our tracking, initialize it
		if (!chunksRef.current.has(chunkKey)) {
			chunksRef.current.set(chunkKey, {});
		}
		const chunksBlocks = chunksRef.current.get(chunkKey);

		// Process removes first
		removes.forEach(({ key, blockId }) => {
			delete chunksBlocks[key];
		});

		// Process adds
		adds.forEach(({ key, pos, blockId }) => {
			chunksBlocks[key] = blockId;
		});
		
		// Calculate distance to camera for priority
		let priority = 1; // Default priority
		
		// If we have access to the camera, prioritize chunks closest to the camera
		if (camera) {
			// Parse chunk coordinates
			const [cx, cy, cz] = chunkKey.split(',').map(Number);
			
			// Calculate chunk center in world space
			const centerX = (cx * CHUNK_SIZE) + (CHUNK_SIZE / 2);
			const centerY = (cy * CHUNK_SIZE) + (CHUNK_SIZE / 2);
			const centerZ = (cz * CHUNK_SIZE) + (CHUNK_SIZE / 2);
			
			// Calculate distance to camera (squared is faster)
			const dx = centerX - camera.position.x;
			const dy = centerY - camera.position.y;
			const dz = centerZ - camera.position.z;
			const distanceSquared = dx*dx + dy*dy + dz*dz;
			
			// Convert to priority (closer = higher priority)
			priority = 1000 / (1 + distanceSquared);
			
			// Extra priority boost for chunks right in front of the camera
			if (distanceSquared < 100) {
			  priority *= 2;
			}
		}
		
		// Add to the priority queue
		addChunkToUpdateQueue(chunkKey, priority);
		
		// Also rebuild neighboring chunks if blocks were added/removed at chunk borders
		const needsNeighborUpdate = adds.length > 0 || removes.length > 0;
		if (needsNeighborUpdate) {
			// Calculate the chunk coordinates
			const [cx, cy, cz] = chunkKey.split(',').map(Number);
			
			// Check for blocks at the chunk borders that would affect neighboring chunks
			const hasBlocksAtBorder = [...adds, ...removes].some(({pos}) => {
				if (!pos) return false;
				
				// Check if this block is at the edge of the chunk
				const inChunkX = pos.x % CHUNK_SIZE;
				const inChunkY = pos.y % CHUNK_SIZE;
				const inChunkZ = pos.z % CHUNK_SIZE;
				
				return inChunkX === 0 || inChunkX === CHUNK_SIZE - 1 ||
					   inChunkY === 0 || inChunkY === CHUNK_SIZE - 1 ||
					   inChunkZ === 0 || inChunkZ === CHUNK_SIZE - 1;
			});
			
			// If we have blocks at borders, queue neighboring chunks with lower priority
			if (hasBlocksAtBorder) {
				// Check all 6 neighboring chunks (only the ones that exist)
				const neighbors = [
					`${cx+1},${cy},${cz}`,
					`${cx-1},${cy},${cz}`,
					`${cx},${cy+1},${cz}`,
					`${cx},${cy-1},${cz}`,
					`${cx},${cy},${cz+1}`,
					`${cx},${cy},${cz-1}`
				];
				
				neighbors.forEach(neighborKey => {
					if (chunksRef.current.has(neighborKey)) {
						// Lower priority for neighboring chunks
						addChunkToUpdateQueue(neighborKey, priority * 0.5);
					}
				});
			}
		}
	};

	// Function to rebuild a single chunk
	const rebuildChunk = (chunkKey) => {
		// Skip if scene not ready
		if (!scene || !meshesInitializedRef.current) return;
		
		// Performance tracking
		const startTime = performance.now();
			
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
	}, [scene]);

	// Create a safe function to add a mesh to the scene
	const safeAddToScene = (mesh) => {
		if (!mesh || !scene) return;
		
		try {
			// Only add if it's not already in the scene
			if (!scene.children.includes(mesh)) {
				scene.add(mesh);
			}
		} catch (error) {
			console.error("Error adding mesh to scene:", error);
		}
	};
	
	// Create a safe function to remove a mesh from the scene
	const safeRemoveFromScene = (mesh) => {
		if (!mesh || !scene) return;
		
		try {
			// Only remove if it's in the scene
			if (scene.children.includes(mesh)) {
				scene.remove(mesh);
			}
			
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
			console.error("Error removing mesh from scene:", error);
		}
	};

	// Function to update which chunks are visible based on camera position and frustum
	const updateVisibleChunks = () => {
		if (!camera || !scene) return;
		
		// Performance tracking
		const startTime = performance.now();
		
		// Update frustum for culling
		frustumRef.current.setFromProjectionMatrix(
		frustumMatrixRef.current.multiplyMatrices(
			camera.projectionMatrix,
			camera.matrixWorldInverse
			)
		);
		
		// Track visible chunks for this update
		const visibleChunks = new Set();
		
		// Track chunks that need to be loaded, with distance to camera for prioritization
		const chunksToLoad = [];
		
		// Get camera position for distance calculations
		const cameraPos = camera.position.clone();
		
		// Check all chunks to see which are visible
		chunksRef.current.forEach((_, chunkKey) => {
			// Check if chunk is visible using our improved function
			if (isChunkVisible(chunkKey, camera, frustumRef.current)) {
				visibleChunks.add(chunkKey);
				
				// Get chunk center for distance calculation
				const [x, y, z] = chunkKey.split('_').map(Number);
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
				// Chunk is not visible, hide its meshes to save on rendering
				if (chunkMeshesRef.current[chunkKey]) {
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
			}
		});
		
		// Sort chunks to load by distance (closest first)
		chunksToLoad.sort((a, b) => a.distance - b.distance);
		
		// Only process a limited number of chunks per frame to avoid stuttering
		// Take the closest chunks first, up to the limit
		const maxChunksToProcess = PERFORMANCE_SETTINGS.maxChunksPerFrame;
		const prioritizedChunks = chunksToLoad.slice(0, maxChunksToProcess);
		
		// Queue the high-priority chunks for immediate loading
		if (prioritizedChunks.length > 0 && !isUpdatingChunksRef.current) {
			// Process chunks in a batched manner to avoid blocking the main thread
			isUpdatingChunksRef.current = true;
			
			// Use a setTimeout to defer chunk processing to the next frame
			setTimeout(() => {
				// Process each chunk one at a time with small delays between
				const processNextChunk = (index) => {
					if (index >= prioritizedChunks.length) {
						isUpdatingChunksRef.current = false;
						return;
					}
					
					const { chunkKey } = prioritizedChunks[index];
					rebuildChunkNoVisibilityUpdate(chunkKey);
					
					// Process next chunk in the next browser idle period
					requestIdleCallbackPolyfill(() => processNextChunk(index + 1), { timeout: 16 });
				};
				
				processNextChunk(0);
			}, 0);
		}
		
		// Queue remaining chunks with lower priority (for later frames)
		if (chunksToLoad.length > maxChunksToProcess) {
			const lowerPriorityChunks = chunksToLoad.slice(maxChunksToProcess);
			
			// Queue these for later processing with lower priority
			setTimeout(() => {
				// Only process if we're not already updating high-priority chunks
				if (!isUpdatingChunksRef.current) {
					const processLowerPriority = (index) => {
						if (index >= lowerPriorityChunks.length) {
							return;
						}
						
						const { chunkKey } = lowerPriorityChunks[index];
						// Only rebuild if the chunk is still needed (camera might have moved)
						if (isChunkVisible(chunkKey, camera, frustumRef.current)) {
							rebuildChunkNoVisibilityUpdate(chunkKey);
						}
						
						// Process next chunk after a delay
						setTimeout(() => processLowerPriority(index + 1), 100);
					};
					
					processLowerPriority(0);
				}
			}, 200); // Delay lower priority chunks
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
		if (!camera.current) return;
		
		// Initial update
		updateVisibleChunks();
		
		// Set up a render loop to check camera changes
		const handler = () => {
			updateVisibleChunks();
		};
		
		// Listen for camera movements
		orbitControlsRef.current?.addEventListener('change', handler);
		
		// Clean up
		return () => {
			orbitControlsRef.current?.removeEventListener('change', handler);
		};
	}, [camera.current, scene.current, orbitControlsRef.current]);

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
	}, []);

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
		if (atlasInitialized) {
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

	// Update spatial hash when terrain changes
	const updateSpatialHash = () => {
		console.log("Updating spatial hash grid");
		const startTime = performance.now();
		
		// Clear existing hash
		spatialHashGridRef.current.clear();
		
		// Add all blocks to the hash
		Object.entries(terrainRef.current).forEach(([posKey, blockId]) => {
			spatialHashGridRef.current.set(posKey, blockId);
		});
		
		const endTime = performance.now();
		console.log(`Spatial hash updated with ${spatialHashGridRef.current.size} blocks in ${(endTime - startTime).toFixed(2)}ms`);
	};
	
	// Call this in buildUpdateTerrain after updating terrainRef
	
	// Optimized ray intersection using spatial hash
	const getOptimizedRaycastIntersection = (prioritizeBlocks = false) => {
		if (!raycaster || !camera) return null;
		
		// Create ray from camera
		const ray = raycaster.ray.clone();
		
		// First, check for ground plane intersection to have it as a fallback
		const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
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
		
		// Parameters for ray marching
		const maxDistance = selectionDistanceRef.current; // Use the configurable selection distance
		const precision = 0.1;
		
		// Start at camera position
		let pos = ray.origin.clone();
		let step = ray.direction.clone().normalize().multiplyScalar(precision);
		let distance = 0;
		
		// For performance tracking
		let iterations = 0;
		const maxIterations = 1000; // Limit iterations to prevent infinite loops
		
		// Track which chunks we've already checked
		const checkedChunks = new Set();
		
		// Fast check: see if we're even pointing at any chunks with blocks
		const dir = ray.direction.clone().normalize();
		
		// Check if there are any chunks in this direction
		let hasChunksInDirection = false;
		
		// Get camera chunk
		const camChunkX = Math.floor(pos.x / CHUNK_SIZE);
		const camChunkY = Math.floor(pos.y / CHUNK_SIZE);
		const camChunkZ = Math.floor(pos.z / CHUNK_SIZE);
		
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

	// Efficient ray testing for hovering and interaction
	const fastRayTest = () => {
		// Skip if spatial hash is not ready
		if (!spatialHashGridRef.current.size) return null;
		
		// Use optimized ray casting with prioritizeBlocks set to true
		return getOptimizedRaycastIntersection(true);
	};

	// Add texture atlas initialization effect
	useEffect(() => {
		// Initialize texture atlas
		const initAtlas = async () => {
			if (!atlasInitialized) {
				console.log("Initializing texture atlas in TerrainBuilder...");
				const atlas = await initTextureAtlas(blockTypesArray);
				
				// Setup chunk load manager with rebuildChunk callback
				chunkLoadManager = new ChunkLoadManager(async (chunkKey) => {
					await rebuildChunk(chunkKey);
				});
				
				// Force rebuild all chunks to use the new atlas
				console.log("Texture atlas ready, rebuilding chunks...");
				
				// Use the correct refs
				const chunkMeshesData = chunkMeshesRef ? chunkMeshesRef.current : {};
				Object.keys(chunkMeshesData).forEach(chunkKey => {
					chunkLoadManager.addChunkToQueue(chunkKey, 100);
				});
			}
		};
		
		if (meshesInitializedRef && meshesInitializedRef.current) {
			initAtlas();
		}
	}, [meshesInitializedRef && meshesInitializedRef.current]);

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

	const cancelIdleCallbackPolyfill = window.cancelIdleCallback || clearTimeout;

	// Add these variables to track camera movement outside the animate function
	const lastCameraPosition = new THREE.Vector3();
	const lastCameraRotation = new THREE.Euler();
	const cameraMoving = { current: false };
	const cameraMovementTimeout = { current: null };
	const chunkUpdateThrottle = { current: 0 };

	// Update the usages of these optimizations
	useEffect(() => {
		// Apply renderer optimizations
		optimizeRenderer(gl);
		
		// Initialize camera manager with camera and controls
		cameraManager.initialize(camera, orbitControlsRef.current);
		
		// Set up a consistent update loop
		let frameId;
		let lastTime = 0;
		
		const animate = (time) => {
			frameId = requestAnimationFrame(animate);
			
			// Calculate delta time for smooth updates
			const delta = time - lastTime;
			lastTime = time;
			
			// Detect camera movement
			if (camera) {
				const positionChanged = !camera.position.equals(lastCameraPosition);
				const rotationChanged = 
					lastCameraRotation.x !== camera.rotation.x ||
					lastCameraRotation.y !== camera.rotation.y ||
					lastCameraRotation.z !== camera.rotation.z;
				
				const isCameraMoving = positionChanged || rotationChanged;
				
				// Update stored values
				lastCameraPosition.copy(camera.position);
				lastCameraRotation.copy(camera.rotation);
				
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
						updateVisibleChunks();
					}, 250);
				}
			}
			
			// Only update if enough time has passed (throttle updates)
			if (delta > 16) { // ~60fps max
				// Throttle chunk updates during camera movement
				if (cameraMoving.current) {
					// Increase throttle during camera movement (update less frequently)
					chunkUpdateThrottle.current++;
					if (chunkUpdateThrottle.current >= 5) { // Only update every 5 frames during movement
						updateVisibleChunks();
						chunkUpdateThrottle.current = 0;
					}
				} else {
					// Normal updates when camera is still
					updateVisibleChunks();
				}
				
				// Only update shadows periodically
				if (time % 500 < 16) {
					gl.shadowMap.needsUpdate = true;
				}
				
				// Force shadow maps to update occasionally
				if (directionalLightRef.current) {
					directionalLightRef.current.shadow.needsUpdate = time % 2000 < 16;
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

	// Add a cache for chunk bounding boxes
	const chunkBoxCache = new Map();

	// Helper function to check if a chunk is visible in the frustum
	const isChunkVisible = (chunkKey, camera, frustum) => {
	  // Check distance to camera first (quick rejection)
	  const [x, y, z] = chunkKey.split('_').map(Number);
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
	  
	  // Quick reject if chunk is too far (square of the distance)
	  const maxSquareDistance = FRUSTUM_CULLING_DISTANCE * FRUSTUM_CULLING_DISTANCE;
	  if (squareDistance > maxSquareDistance) {
	    return false;
	  }
	  
	  // Look up or create bounding box
	  let chunkBox = chunkBoxCache.get(chunkKey);
	  if (!chunkBox) {
	    // Create a new bounding box and cache it
	    chunkBox = new THREE.Box3(
	      new THREE.Vector3(worldX, worldY, worldZ),
	      new THREE.Vector3(worldX + chunkSize, worldY + chunkSize, worldZ + chunkSize)
	    );
	    chunkBoxCache.set(chunkKey, chunkBox);
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
		
		// Process chunks until time budget is exhausted or queue is empty
		while (chunkUpdateQueueRef.current.length > 0 && 
				performance.now() - startTime < maxTimePerFrame) {
			
			// Get the highest priority chunk
			const { chunkKey } = chunkUpdateQueueRef.current.shift();
			
			// Rebuild the chunk
			rebuildChunkNoVisibilityUpdate(chunkKey);
			
			// Record last process time
			lastChunkProcessTimeRef.current = performance.now();
		}
		
		// If there are more chunks to process, continue in the next frame
		if (chunkUpdateQueueRef.current.length > 0) {
			requestAnimationFrame(processChunkQueue);
		} else {
			isProcessingChunkQueueRef.current = false;
		}
	};

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


