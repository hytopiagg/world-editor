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
const CHUNK_SIZE = 32;
const CHUNK_BLOCK_CAPACITY = BLOCK_INSTANCED_MESH_CAPACITY / 8; // Smaller capacity per chunk
const FRUSTUM_CULLING_DISTANCE = 64; // Increase view distance for less pop-in
const FRUSTUM_BUFFER_DISTANCE = 16; // Additional buffer distance to reduce popping

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

	// Find existing block with same name
	const existingBlock = blockTypesArray.find(b => b.name === block.name);

	if (existingBlock) {
		// If block exists and has missing texture, update it
		if (existingBlock.hasMissingTexture) {
			existingBlock.textureUri = block.textureUri;
			existingBlock.hasMissingTexture = false;
			existingBlock.isMultiTexture = block.isMultiTexture || false;
			existingBlock.sideTextures = block.sideTextures || {};

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
			console.log("Updated missing texture for block:", block.name);
		} else {
			console.log("Block already exists:", block.name);
		}
		return;
	}

	// Add new block with ID in custom block range (100-199)
	const newBlock = {
		id: Math.max(...blockTypesArray.filter(b => b.id >= 100).map(b => b.id), 99) + 1, // Start at 100 if no custom blocks exist
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

function TerrainBuilder({ onSceneReady, previewPositionToAppJS, currentBlockType, undoRedoManager, mode, setDebugInfo, axisLockEnabled, gridSize, cameraReset, cameraAngle, placementSize, setPageIsLoaded, customBlocks, environmentBuilderRef}, ref) {

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
	const axisLockEnabledRef = useRef(axisLockEnabled);
	const currentBlockTypeRef = useRef(currentBlockType);
	const isFirstBlockRef = useRef(true);
	const modeRef = useRef(mode);
	const lastPreviewPositionRef = useRef(new THREE.Vector3());
	const placementSizeRef = useRef(placementSize);

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
		// Performance tracking
		const startTime = performance.now();
		
		// Skip if scene not ready
		if (!scene || !meshesInitializedRef.current) return;
		
		try {
			// Get all blocks in this chunk
			const chunksBlocks = chunksRef.current.get(chunkKey) || {};
			
			// Clean up existing chunk meshes for this specific chunk
			if (chunkMeshesRef.current[chunkKey]) {
				Object.values(chunkMeshesRef.current[chunkKey]).forEach(mesh => {
					safeRemoveFromScene(mesh);
					// Dispose of geometries to free memory
					if (mesh.geometry) mesh.geometry.dispose();
				});
			}
			chunkMeshesRef.current[chunkKey] = {};
			
			// If no blocks in this chunk, we're done
			if (Object.keys(chunksBlocks).length === 0) {
				return;
			}

			// Try to use greedy meshing first if enabled
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
			
			// If greedy meshing is disabled or failed, use instanced or standard rendering
			if (PERFORMANCE_SETTINGS.instancingEnabled) {
				// Use instanced rendering
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
					
					// Set matrix for each block
					positions.forEach((posKey, index) => {
						const [x, y, z] = posKey.split(',').map(Number);
						const matrix = new THREE.Matrix4().setPosition(x, y, z);
						instancedMesh.setMatrixAt(index, matrix);
					});
					
					// Update mesh
					instancedMesh.count = positions.length;
					instancedMesh.instanceMatrix.needsUpdate = true;
					
					// Store and add to scene directly (not through R3F)
					if (!chunkMeshesRef.current[chunkKey]) {
						chunkMeshesRef.current[chunkKey] = {};
					}
					chunkMeshesRef.current[chunkKey][blockId] = instancedMesh;
					safeAddToScene(instancedMesh);
				});
			} else {
				// Use standard (non-instanced) rendering - one mesh per block
				Object.entries(chunksBlocks).forEach(([posKey, blockId]) => {
					const blockType = blockTypesArray.find(b => b.id === parseInt(blockId));
					if (!blockType) return;
					
					// Use cached geometry and material
					const geometry = getCachedGeometry(blockType);
					const material = getCachedMaterial(blockType);
					
					// Create regular mesh
					const mesh = new THREE.Mesh(geometry, material);
					
					// Set position
					const [x, y, z] = posKey.split(',').map(Number);
					mesh.position.set(x, y, z);
					
					// Set metadata
					mesh.userData = { blockId: blockType.id, chunkKey, blockPos: posKey };
					mesh.frustumCulled = true;
					mesh.castShadow = true;
					mesh.receiveShadow = true;
					
					// Store and add to scene
					if (!chunkMeshesRef.current[chunkKey]) {
						chunkMeshesRef.current[chunkKey] = {};
					}
					if (!chunkMeshesRef.current[chunkKey][blockId]) {
						chunkMeshesRef.current[chunkKey][blockId] = [];
					}
					if (Array.isArray(chunkMeshesRef.current[chunkKey][blockId])) {
						chunkMeshesRef.current[chunkKey][blockId].push(mesh);
					} else {
						// If it's not an array (e.g., from a previous instanced mesh), make it an array
						chunkMeshesRef.current[chunkKey][blockId] = [mesh];
					}
					safeAddToScene(mesh);
				});
			}
			
			// Record performance data
			const endTime = performance.now();
			console.log(`Chunk rebuild took ${endTime - startTime}ms`);
			
		} catch (error) {
			console.error("Error rebuilding chunk:", error, chunkKey);
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
		const chunkUpdates = new Map(); // Track which chunks need updates

		positions.forEach((pos) => {
			const key = `${pos.x},${pos.y},${pos.z}`;
			const chunkKey = getChunkKey(pos.x, pos.y, pos.z);
			const blockId = currentBlockTypeRef.current.id;

			if (modeRef.current === "add") {
				if (!terrainRef.current[key]) {
					terrainRef.current[key] = blockId;
					terrainChanged = true;
					recentlyPlacedBlocksRef.current.add(key);
					
					// Add to spatial hash for faster ray casting
					spatialHashGridRef.current.set(key, blockId);

					// Track chunk update
					if (!chunkUpdates.has(chunkKey)) {
						chunkUpdates.set(chunkKey, { adds: [], removes: [] });
					}
					chunkUpdates.get(chunkKey).adds.push({ key, pos, blockId });
				}
			} else if (modeRef.current === "remove") {
				if (terrainRef.current[key]) {
					const oldBlockId = terrainRef.current[key];
					delete terrainRef.current[key];
					terrainChanged = true;
					
					// Remove from spatial hash
					spatialHashGridRef.current.delete(key);

					// Track chunk update
					if (!chunkUpdates.has(chunkKey)) {
						chunkUpdates.set(chunkKey, { adds: [], removes: [] });
					}
					chunkUpdates.get(chunkKey).removes.push({ key, pos, blockId: oldBlockId });
				}
			}
		});

		if (isFirstBlockRef.current) {
			isFirstBlockRef.current = false;
		}

		if (terrainChanged) {
			totalBlocksRef.current = Object.keys(terrainRef.current).length;
			updateDebugInfo();

			// Process chunk updates
			chunkUpdates.forEach((updates, chunkKey) => {
				updateChunkMeshes(chunkKey, updates.adds, updates.removes);
			});

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
		// Try optimized ray casting first if spatial hash is ready and enabled
		if (useSpatialHashRef.current && spatialHashGridRef.current.size > 0) {
			const result = getOptimizedRaycastIntersection();
			if (result) return result;
		}
		
		// Fall back to original method if optimized method fails or spatial hash is not ready
		
		// Use the raw pointer coordinates directly from THREE.js
		const normalizedMouse = pointer.clone();
		// Setup raycaster with the normalized coordinates
		raycaster.setFromCamera(normalizedMouse, camera);
		// Create a temporary array to store all intersections
		let allIntersections = [];
		// Manually check each block in the terrain
		Object.entries(terrainRef.current).forEach(([posKey, blockId]) => {
			// Skip recently placed blocks during placement
			if (isPlacingRef.current && recentlyPlacedBlocksRef.current.has(posKey)) {
				return;
			}
			
			const [x, y, z] = posKey.split(',').map(Number);
			// Create a temporary box for raycasting
			const tempBox = new THREE.Box3(
				new THREE.Vector3(x - 0.5, y - 0.5, z - 0.5),
				new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5)
			);
			
			// Check if ray intersects this box
			if (raycaster.ray.intersectsBox(tempBox)) {
				// Calculate true distance from camera
				const distanceFromCamera = camera.position.distanceTo(new THREE.Vector3(x, y, z));
				
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
					distance: distanceFromCamera
				});
			}
		});
		
		// Sort by distance (closest first)
		allIntersections.sort((a, b) => a.distance - b.distance);
		
		// Return the closest intersection, if any
		return allIntersections.length > 0 ? allIntersections[0] : null;
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

		const intersection = getRaycastIntersection();
		if (!intersection) return;

		// If a tool is active, delegate the mouse move event to it
		if (toolManagerRef.current && toolManagerRef.current.getActiveTool()) {
			toolManagerRef.current.handleMouseMove(null, intersection.point);
			
			// Also call tool update method to allow for continuous updates
			toolManagerRef.current.update();
		}

		if (!currentBlockTypeRef?.current?.isEnvironment) {
			// Reuse vector for grid position calculation
			tempVectorRef.current.copy(intersection.point);
			
			// Apply mode-specific adjustments
			if (modeRef.current === "remove") {
				tempVectorRef.current.x = Math.round(tempVectorRef.current.x - intersection.normal.x * 0.5);
				tempVectorRef.current.y = Math.round(tempVectorRef.current.y - intersection.normal.y * 0.5);
				tempVectorRef.current.z = Math.round(tempVectorRef.current.z - intersection.normal.z * 0.5);
			} else {
				// For add mode, add a small offset in the normal direction before rounding
				tempVectorRef.current.add(intersection.normal.clone().multiplyScalar(0.01));
				// Replace simple rounding with a more consistent approach for negative coordinates
				tempVectorRef.current.x = Math.sign(tempVectorRef.current.x) * Math.round(Math.abs(tempVectorRef.current.x));
				tempVectorRef.current.y = Math.sign(tempVectorRef.current.y) * Math.round(Math.abs(tempVectorRef.current.y));
				tempVectorRef.current.z = Math.sign(tempVectorRef.current.z) * Math.round(Math.abs(tempVectorRef.current.z));
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

			// Only update if the position has actually changed
			if (!previewPositionRef.current.equals(tempVectorRef.current)) {
				previewPositionRef.current.copy(tempVectorRef.current);
				// Store the constrained position, not the raw intersection point
				lastPreviewPositionRef.current.copy(tempVectorRef.current);
				setPreviewPosition(previewPositionRef.current.clone());
				updateDebugInfo();
			}
		} else {
			// Handle environment objects
			const envPosition = intersection.point.clone();
			
			// For environment objects, we want to snap the Y position to the nearest integer
			// and add 0.5 to place them on top of blocks rather than halfway through
			envPosition.y = Math.ceil(envPosition.y);
			
			previewPositionRef.current.copy(envPosition);
			lastPreviewPositionRef.current.copy(envPosition);
			setPreviewPosition(envPosition);
			previewPositionToAppJS(envPosition);
			updateDebugInfo();
		}

		if (previewMeshRef.current) {
			previewMeshRef.current.position.copy(previewPositionRef.current);
			previewMeshRef.current.updateMatrix();
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
		terrainRef.current = terrainData;
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
		});
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
		
		// Signal that this chunk needs rebuilding
		setTimeout(() => {
			rebuildChunk(chunkKey);
		}, 0);
	};

	// Function to rebuild a single chunk
	const rebuildChunk = (chunkKey) => {
		if (!scene.current) return;

		// Get existing chunk mesh if any
			if (chunkMeshesRef.current[chunkKey]) {
			safeRemoveFromScene(chunkMeshesRef.current[chunkKey]);
			delete chunkMeshesRef.current[chunkKey];
		}

		// Get blocks for this chunk
		const chunksBlocks = {};
		// Use chunksRef instead of blockRefs since that's what was previously defined
		const blockRefsData = chunksRef ? chunksRef.current.get(chunkKey) : {};
		for (const posKey in blockRefsData) {
			const [x, y, z] = posKey.split(',').map(Number);
			// We already have the blocks for this chunk, so we don't need to check the chunk key
			chunksBlocks[posKey] = blockRefsData[posKey];
		}

		if (Object.keys(chunksBlocks).length === 0) return;

		// Use the optimized mesh builder if atlas is initialized
		if (atlasInitialized && !GREEDY_MESHING_ENABLED) {
			try {
				const optimizedMesh = chunkMeshBuilder.buildChunkMesh(chunksBlocks, blockTypesArray);
				if (optimizedMesh) {
					chunkMeshesRef.current[chunkKey] = optimizedMesh;
					safeAddToScene(optimizedMesh);
					return;
				}
			} catch (error) {
				console.error("Error using optimized mesh builder:", error);
				// Fall back to original method
			}
		}

		// Use greedy meshing or fall back to original method
		if (GREEDY_MESHING_ENABLED) {
			// ... existing greedy meshing code ...
		} else {
			// ... existing classic mesh building code ...
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
		
		// Update frustum for culling
		frustumRef.current.setFromProjectionMatrix(
		frustumMatrixRef.current.multiplyMatrices(
			camera.projectionMatrix,
			camera.matrixWorldInverse
			)
		);
		
		// Track visible chunks for this update
		const visibleChunks = new Set();
		
		// Check all chunks to see which are visible
		chunksRef.current.forEach((_, chunkKey) => {
			// Check if chunk is visible using our improved function
			if (isChunkVisible(chunkKey, camera, frustumRef.current)) {
				visibleChunks.add(chunkKey);
				
				// Ensure chunk mesh exists and is visible
				if (!chunkMeshesRef.current[chunkKey]) {
					// Queue chunk for loading if not already loaded
					setTimeout(() => {
						if (!isUpdatingChunksRef.current) {
							rebuildChunkNoVisibilityUpdate(chunkKey);
						}
					}, 0);
				} else {
					// Make sure all meshes in the chunk are visible
					const meshes = chunkMeshesRef.current[chunkKey];
					Object.values(meshes).forEach(mesh => {
						if (!scene.children.includes(mesh)) {
							safeAddToScene(mesh);
						}
					});
				}
			} else {
				// Chunk not visible, hide its meshes (but don't destroy them)
				const meshes = chunkMeshesRef.current[chunkKey];
				if (meshes) {
					Object.values(meshes).forEach(mesh => {
						if (scene.children.includes(mesh)) {
							safeRemoveFromScene(mesh);
						}
					});
				}
			}
		});
		
		// Use ChunkLoadManager for prioritized chunk loading if available
		if (chunkLoadManager) {
			// Clear existing queue
			chunkLoadManager.clearQueue();
			
			// Get chunks with distance
			const chunksWithDistance = Array.from(visibleChunks).map(chunkKey => {
				const [cx, cy, cz] = chunkKey.split(',').map(Number);
				const centerX = (cx + 0.5) * CHUNK_SIZE;
				const centerY = (cy + 0.5) * CHUNK_SIZE;
				const centerZ = (cz + 0.5) * CHUNK_SIZE;
				const dx = centerX - camera.position.x;
				const dy = centerY - camera.position.y;
				const dz = centerZ - camera.position.z;
				const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
				return { chunkKey, distance };
			});
			
			// Sort by distance (closest first)
			chunksWithDistance.sort((a, b) => a.distance - b.distance);
			
			// Add to load queue with priority based on distance
			for (let i = 0; i < chunksWithDistance.length; i++) {
				const { chunkKey, distance } = chunksWithDistance[i];
				// Higher priority for closer chunks
				const priority = Math.max(0, 1000 - Math.floor(distance));
				chunkLoadManager.addChunkToQueue(chunkKey, priority);
			}
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
	const getOptimizedRaycastIntersection = () => {
		if (!raycaster || !camera) return null;
		
		// Create ray from camera
		const ray = raycaster.ray.clone();
		
		// Parameters for ray marching
		const maxDistance = 100;
		const precision = 0.1;
		
		// Start at camera position
		let pos = ray.origin.clone();
		let step = ray.direction.clone().normalize().multiplyScalar(precision);
		let distance = 0;
		
		// For performance tracking
		let iterations = 0;
		
		while (distance < maxDistance) {
			iterations++;
			
			// Get block position (rounded to integers)
			const blockX = Math.floor(pos.x);
			const blockY = Math.floor(pos.y);
			const blockZ = Math.floor(pos.z);
			const blockKey = `${blockX},${blockY},${blockZ}`;
			
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
				
				// console.log(`Ray hit block at ${blockKey} after ${iterations} steps`);
				
				return {
					point,
					normal,
					block: { x: blockX, y: blockY, z: blockZ },
					blockId,
					distance
				};
			}
			
			// Move along the ray
			pos.add(step);
			distance += precision;
		}
		
		// No intersection found
		return null;
	};
	
	// Efficient ray testing for hovering and interaction
	const fastRayTest = () => {
		// Skip if spatial hash is not ready
		if (!spatialHashGridRef.current.size) return null;
		
		// Use optimized ray casting
		return getOptimizedRaycastIntersection();
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
			
			// Only update if enough time has passed (throttle updates)
			if (delta > 16) { // ~60fps max
				// Update visible chunks
				updateVisibleChunks();
				
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

	// Helper function to check if a chunk is visible in the frustum
	const isChunkVisible = (chunkKey, camera, frustum) => {
		// Get chunk coordinates
		const [x, y, z] = chunkKey.split('_').map(Number);
		
		// Create a bounding box for the chunk
		const chunkSize = CHUNK_SIZE;
		const worldX = x * chunkSize;
		const worldY = y * chunkSize;
		const worldZ = z * chunkSize;
		
		const chunkBox = new THREE.Box3(
			new THREE.Vector3(worldX, worldY, worldZ),
			new THREE.Vector3(worldX + chunkSize, worldY + chunkSize, worldZ + chunkSize)
		);
		
		// Test if the chunk is in frustum
		return frustum.intersectsBox(chunkBox);
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


