import React, { useRef, useEffect, useState, forwardRef, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { playPlaceSound } from "./Sound";
import { cameraManager } from "./Camera";
import { DatabaseManager, STORES } from "./DatabaseManager";
import { THRESHOLD_FOR_PLACING, BLOCK_INSTANCED_MESH_CAPACITY } from "./Constants";
import { refreshBlockTools } from "./components/BlockToolsSidebar";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";

// Import tools
import { ToolManager, WallTool } from "./tools";

// Define chunk constants
const CHUNK_SIZE = 32;
const CHUNK_BLOCK_CAPACITY = BLOCK_INSTANCED_MESH_CAPACITY / 8; // Smaller capacity per chunk
const FRUSTUM_CULLING_DISTANCE = 48; // Reduced from 64 to be less noticeable
const FRUSTUM_BUFFER_DISTANCE = 16; // Additional buffer distance to reduce popping

// Greedy meshing constants - use ref later to allow runtime toggling
let GREEDY_MESHING_ENABLED = false; // Start with classic method for stability

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

// Helper function to get chunk key from position
const getChunkKey = (x, y, z) => {
	return `${Math.floor(x / CHUNK_SIZE)},${Math.floor(y / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
};

let meshesNeedsRefresh = false;

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

// Greedy meshing algorithm
// Implementation based on "Meshing in a Minecraft Game" by Mikola Lysenko (0fps.net)
const generateGreedyMesh = (chunksBlocks, blockTypes) => {
    // Initialize result
    const meshData = {
        vertices: [],
        indices: [],
        normals: [],
        uvs: [],
        blockIds: [], // Store block ID for material selection
    };
    
    // Get dimensions (assuming cubic chunks)
    const SIZE = CHUNK_SIZE;
    
    // Create a 3D grid to track block IDs
    const grid = new Array(SIZE + 2).fill(0).map(() => 
        new Array(SIZE + 2).fill(0).map(() => 
            new Array(SIZE + 2).fill(0)
        )
    );
    
    // Extract chunk coordinates from the first block to use as base
    let chunkBaseX = 0, chunkBaseY = 0, chunkBaseZ = 0;
    const firstBlockKey = Object.keys(chunksBlocks)[0];
    if (firstBlockKey) {
        const [firstX, firstY, firstZ] = firstBlockKey.split(',').map(Number);
        chunkBaseX = Math.floor(firstX / SIZE) * SIZE;
        chunkBaseY = Math.floor(firstY / SIZE) * SIZE;
        chunkBaseZ = Math.floor(firstZ / SIZE) * SIZE;
    }
    
    // Debug info
    console.log(`Greedy meshing chunk at ${chunkBaseX},${chunkBaseY},${chunkBaseZ}`);
    console.log(`Block count: ${Object.keys(chunksBlocks).length}`);
    
    // Fill grid with block IDs (adding a 1-block border for face detection)
    Object.entries(chunksBlocks).forEach(([posKey, blockId]) => {
        const [worldX, worldY, worldZ] = posKey.split(',').map(Number);
        
        // Convert from world coordinates to local chunk coordinates
        const localX = worldX - chunkBaseX;
        const localY = worldY - chunkBaseY;
        const localZ = worldZ - chunkBaseZ;
        
        // Skip if outside the chunk bounds (this shouldn't happen)
        if (localX < 0 || localX >= SIZE || localY < 0 || localY >= SIZE || localZ < 0 || localZ >= SIZE) {
            console.warn(`Block at ${worldX},${worldY},${worldZ} is outside chunk bounds:`, localX, localY, localZ);
            return;
        }
        
        // Add block to grid with a 1-cell border
        grid[localX + 1][localY + 1][localZ + 1] = parseInt(blockId);
    });
    
    // Process each of the six faces (directions)
    MESH_SIDES.forEach((side, faceIndex) => {
        const { dir, normal } = side;
        const [dx, dy, dz] = dir;
        
        // Create a mask for this slice
        const mask = new Array(SIZE + 1).fill(0).map(() => 
            new Array(SIZE + 1).fill(0)
        );
        
        // Process each slice in this direction
        for (let depth = 0; depth < SIZE; depth++) {
            // Compute the mask for this slice
            for (let y = 0; y < SIZE; y++) {
                for (let x = 0; x < SIZE; x++) {
                    // Determine slice coordinates based on direction
                    let blockX, blockY, blockZ, neighborX, neighborY, neighborZ;
                    
                    if (dx === 1) { 
                        blockX = depth; neighborX = depth + 1; 
                        blockY = y; neighborY = y;
                        blockZ = x; neighborZ = x;
                    } else if (dx === -1) {
                        blockX = SIZE - 1 - depth; neighborX = SIZE - 2 - depth;
                        blockY = y; neighborY = y;
                        blockZ = x; neighborZ = x;
                    } else if (dy === 1) {
                        blockX = x; neighborX = x;
                        blockY = depth; neighborY = depth + 1;
                        blockZ = y; neighborZ = y;
                    } else if (dy === -1) {
                        blockX = x; neighborX = x;
                        blockY = SIZE - 1 - depth; neighborY = SIZE - 2 - depth;
                        blockZ = y; neighborZ = y;
                    } else if (dz === 1) {
                        blockX = x; neighborX = x;
                        blockY = y; neighborY = y;
                        blockZ = depth; neighborZ = depth + 1;
                    } else if (dz === -1) {
                        blockX = x; neighborX = x;
                        blockY = y; neighborY = y;
                        blockZ = SIZE - 1 - depth; neighborZ = SIZE - 2 - depth;
                    }
                    
                    // Adjust for grid border
                    blockX += 1; blockY += 1; blockZ += 1;
                    neighborX += 1; neighborY += 1; neighborZ += 1;
                    
                    // Get the block IDs
                    const blockId = grid[blockX][blockY][blockZ];
                    const neighborId = grid[neighborX][neighborY][neighborZ];
                    
                    // Only create a face if there's a visible boundary:
                    // 1. Current position has a block (blockId != 0)
                    // 2. Neighbor position is empty or different block type
                    if (blockId !== 0 && blockId !== neighborId) {
                        mask[y][x] = blockId; // Store the block ID in the mask
                    } else {
                        mask[y][x] = 0; // No face needed
                    }
                }
            }
            
            // Now generate mesh for this mask using greedy approach
            let x = 0;
            while (x < SIZE) {
                let y = 0;
                while (y < SIZE) {
                    // If this is a face
                    const blockId = mask[y][x];
                    if (blockId !== 0) {
                        // Find width (how far can we go in x direction)
                        let width = 1;
                        while (x + width < SIZE && mask[y][x + width] === blockId) {
                            width++;
                        }
                        
                        // Find height (how far can we go in y direction with this width)
                        let height = 1;
                        let done = false;
                        while (y + height < SIZE && !done) {
                            for (let ix = 0; ix < width; ix++) {
                                if (mask[y + height][x + ix] !== blockId) {
                                    done = true;
                                    break;
                                }
                            }
                            if (!done) height++;
                        }
                        
                        // Create the quad
                        const localX = (dx === 1) ? depth : (dx === -1) ? SIZE - 1 - depth : x;
                        const localY = (dy === 1) ? depth : (dy === -1) ? SIZE - 1 - depth : y;
                        const localZ = (dz === 1) ? depth : (dz === -1) ? SIZE - 1 - depth : (dx !== 0) ? y : x;
                        
                        // Convert from local to world coordinates
                        const worldX = localX + chunkBaseX;
                        const worldY = localY + chunkBaseY;
                        const worldZ = localZ + chunkBaseZ;
                        
                        // Add quad for this region
                        const vertexCount = meshData.vertices.length / 3;
                        
                        // Calculate quad corners based on face direction
                        let positions = [];
                        if (dx === 1) { // +X face
                            positions = [
                                worldX + 1, worldY, worldZ,
                                worldX + 1, worldY + height, worldZ,
                                worldX + 1, worldY + height, worldZ + width,
                                worldX + 1, worldY, worldZ + width
                            ];
                        } else if (dx === -1) { // -X face
                            positions = [
                                worldX, worldY, worldZ + width,
                                worldX, worldY + height, worldZ + width,
                                worldX, worldY + height, worldZ,
                                worldX, worldY, worldZ
                            ];
                        } else if (dy === 1) { // +Y face
                            positions = [
                                worldX, worldY + 1, worldZ,
                                worldX, worldY + 1, worldZ + width,
                                worldX + height, worldY + 1, worldZ + width,
                                worldX + height, worldY + 1, worldZ
                            ];
                        } else if (dy === -1) { // -Y face
                            positions = [
                                worldX, worldY, worldZ + width,
                                worldX, worldY, worldZ,
                                worldX + height, worldY, worldZ,
                                worldX + height, worldY, worldZ + width
                            ];
                        } else if (dz === 1) { // +Z face
                            positions = [
                                worldX, worldY, worldZ + 1,
                                worldX + width, worldY, worldZ + 1,
                                worldX + width, worldY + height, worldZ + 1,
                                worldX, worldY + height, worldZ + 1
                            ];
                        } else if (dz === -1) { // -Z face
                            positions = [
                                worldX + width, worldY, worldZ,
                                worldX, worldY, worldZ,
                                worldX, worldY + height, worldZ,
                                worldX + width, worldY + height, worldZ
                            ];
                        }
                        
                        // Add vertices (for each corner of quad)
                        for (let i = 0; i < 12; i += 3) {
                            meshData.vertices.push(positions[i], positions[i+1], positions[i+2]);
                        }
                        
                        // Add indices (two triangles for the quad)
                        meshData.indices.push(
                            vertexCount, vertexCount + 1, vertexCount + 2,
                            vertexCount, vertexCount + 2, vertexCount + 3
                        );
                        
                        // Add normals (same for all vertices in the quad)
                        for (let i = 0; i < 4; i++) {
                            meshData.normals.push(normal[0], normal[1], normal[2]);
                        }
                        
                        // Add UVs (simple mapping based on size)
                        meshData.uvs.push(
                            0, 0,          // Bottom-left
                            width, 0,       // Bottom-right
                            width, height,  // Top-right
                            0, height       // Top-left
                        );
                        
                        // Add block ID for material selection
                        for (let i = 0; i < 4; i++) {
                            meshData.blockIds.push(blockId);
                        }
                        
                        // Clear the mask area we just processed
                        for (let iy = 0; iy < height; iy++) {
                            for (let ix = 0; ix < width; ix++) {
                                mask[y + iy][x + ix] = 0;
                            }
                        }
                        
                        // Move to the next area
                        x += width - 1; // -1 because the outer loop will add 1
                    }
                    y++;
                }
                x++;
            }
        }
    });
    
    return meshData;
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
		// Skip if scene not ready
		if (!scene || !meshesInitializedRef.current) return;
		
		try {
			// Get all blocks in this chunk
			const chunksBlocks = chunksRef.current.get(chunkKey) || {};
			
			// Clean up existing chunk meshes for this specific chunk
			if (chunkMeshesRef.current[chunkKey]) {
				Object.values(chunkMeshesRef.current[chunkKey]).forEach(mesh => {
					safeRemoveFromScene(mesh);
				});
			}
			chunkMeshesRef.current[chunkKey] = {};
			
			// If no blocks in this chunk, we're done
			if (Object.keys(chunksBlocks).length === 0) {
				return;
			}
			
			// Use greedy meshing if enabled
			if (GREEDY_MESHING_ENABLED) {
				const meshes = createGreedyMeshForChunk(chunksBlocks);
				
				// If no meshes were created, we're done
				if (!meshes) return;
				
				// Add meshes to scene
				chunkMeshesRef.current[chunkKey] = meshes;
				Object.values(meshes).forEach(mesh => {
					mesh.userData = { chunkKey };
					safeAddToScene(mesh);
				});
			} else {
				// Use the original non-greedy meshing approach
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
			}
		} catch (error) {
			console.error(`Error rebuilding chunk ${chunkKey}:`, error);
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
		
		// Also check intersection with the shadow plane (grid)
		// This is essential for placing the first block when no blocks exist
		const planeIntersects = raycaster.intersectObject(shadowPlaneRef.current);
		
		// Filter out any preview objects
		const gridIntersections = planeIntersects.filter(hit => 
			hit.object.isMesh && hit.object === shadowPlaneRef.current
		);
		
		// If we hit the grid, add it to our intersections list
		if (gridIntersections.length > 0) {
			const gridHit = gridIntersections[0];
			
			// Calculate grid position
			const point = gridHit.point.clone();
			
			// When placing the first block, we want to place it on top of the grid
			// So we snap the y coordinate to 0 and adjust it upward if needed
			// Depending on your grid setup, you may need to adjust this logic
			const gridNormal = new THREE.Vector3(0, 1, 0); // Assuming grid faces upward
			
			allIntersections.push({
				point,
				normal: gridNormal,
				block: { x: Math.floor(point.x), y: Math.floor(point.y), z: Math.floor(point.z) },
				distance: gridHit.distance,
				isGrid: true
			});
		}
		
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
			
			// Special handling for grid intersections (when there are no blocks)
			if (intersection.isGrid) {
				// For grid intersections, we want to place blocks on top of the grid
				tempVectorRef.current.y = 0; // Start at grid level
			}
			
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
	React.useImperativeHandle(ref, () => ({
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
		// Skip if scene not ready
		if (!scene || !meshesInitializedRef.current) return;
		
		try {
			// Get all blocks in this chunk
			const chunksBlocks = chunksRef.current.get(chunkKey) || {};
			
			// Clean up existing chunk meshes
			if (chunkMeshesRef.current[chunkKey]) {
				Object.values(chunkMeshesRef.current[chunkKey]).forEach(mesh => {
					safeRemoveFromScene(mesh);
				});
			}
			chunkMeshesRef.current[chunkKey] = {};
			
			// If no blocks in this chunk, we're done
			if (Object.keys(chunksBlocks).length === 0) {
				return;
			}
			
			// Use greedy meshing if enabled
			if (GREEDY_MESHING_ENABLED) {
				try {
					const meshes = createGreedyMeshForChunk(chunksBlocks);
					
					// If no meshes were created, we're done
					if (!meshes) return;
					
					// Add meshes to scene
					chunkMeshesRef.current[chunkKey] = meshes;
					Object.values(meshes).forEach(mesh => {
						mesh.userData = { chunkKey };
						safeAddToScene(mesh);
					});
				} catch (error) {
					console.error("Error in greedy meshing:", error);
					// Fall back to regular meshing if greedy meshing fails
					GREEDY_MESHING_ENABLED = false;
					// Try again with regular meshing
					rebuildChunk(chunkKey);
					return;
				}
			} else {
				// Use the original non-greedy meshing approach
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
			}
			
			// Update visibility after rebuilding
			updateVisibleChunks();
		} catch (error) {
			console.error(`Error rebuilding chunk ${chunkKey}:`, error);
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
		if (!camera || !scene || !chunkMeshesRef.current) return;
		
		// Update frustum from camera
		frustumMatrixRef.current.multiplyMatrices(
			camera.projectionMatrix,
			camera.matrixWorldInverse
		);
		frustumRef.current.setFromProjectionMatrix(frustumMatrixRef.current);
		
		// Get camera position in chunk coordinates
		const camChunkX = Math.floor(camera.position.x / CHUNK_SIZE);
		const camChunkY = Math.floor(camera.position.y / CHUNK_SIZE);
		const camChunkZ = Math.floor(camera.position.z / CHUNK_SIZE);
		
		// Determine visible distance in chunks
		const chunkDistance = Math.ceil(FRUSTUM_CULLING_DISTANCE / CHUNK_SIZE);
		const bufferDistance = Math.ceil(FRUSTUM_BUFFER_DISTANCE / CHUNK_SIZE);
		
		// Get camera facing direction for better culling
		const cameraDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
		
		// Check each chunk
		Object.entries(chunkMeshesRef.current).forEach(([chunkKey, blockMeshes]) => {
			const [chunkX, chunkY, chunkZ] = chunkKey.split(',').map(Number);
			
			// Distance-based culling (faster than frustum test)
			const distanceX = Math.abs(chunkX - camChunkX);
			const distanceY = Math.abs(chunkY - camChunkY);
			const distanceZ = Math.abs(chunkZ - camChunkZ);
			
			// Calculate center of chunk
			const chunkCenter = new THREE.Vector3(
				(chunkX + 0.5) * CHUNK_SIZE,
				(chunkY + 0.5) * CHUNK_SIZE, 
				(chunkZ + 0.5) * CHUNK_SIZE
			);
			
			// Get vector from camera to chunk
			const toChunk = chunkCenter.clone().sub(camera.position);
			
			// Get dot product to determine if chunk is in front of camera
			const dotProduct = toChunk.normalize().dot(cameraDirection);
			
			// Simple Manhattan distance check first (very fast)
			const manhattanDistance = distanceX + distanceY + distanceZ;
			
			// Always show chunks very close to camera regardless of frustum
			const isVeryClose = manhattanDistance <= 2;
			
			// Simple distance check for farther chunks
			const isInExtendedRange = (
				distanceX <= chunkDistance + bufferDistance && 
				distanceY <= chunkDistance + bufferDistance && 
				distanceZ <= chunkDistance + bufferDistance
			);
			
			// Closer check for chunks in the basic range
			const isInBasicRange = (
				distanceX <= chunkDistance && 
				distanceY <= chunkDistance && 
				distanceZ <= chunkDistance
			);
			
			// Determine if chunk should be visible
			let isVisible = false;
			
			if (isVeryClose) {
				// Always show very close chunks
				isVisible = true;
			} else if (isInBasicRange) {
				// For chunks in basic range, check if they're in the frustum
				isVisible = frustumRef.current.containsPoint(chunkCenter);
			} else if (isInExtendedRange && dotProduct > -0.3) {
				// For chunks in extended range, only show if somewhat in front of camera
				// The -0.3 value means we show chunks slightly behind us in peripheral vision
				const distance = camera.position.distanceTo(chunkCenter);
				isVisible = distance < FRUSTUM_CULLING_DISTANCE + FRUSTUM_BUFFER_DISTANCE;
			}
			
			// Show/hide meshes based on visibility
			Object.values(blockMeshes).forEach(mesh => {
				if (mesh.visible !== isVisible) {
					mesh.visible = isVisible;
				}
			});
		});
	};

	// Call update visible chunks when camera moves
	useEffect(() => {
		if (!camera) return;
		
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
	}, [camera, scene, orbitControlsRef.current]);

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

	// Function to create a THREE.js mesh from greedy mesh data
	const createGreedyMeshForChunk = (chunksBlocks) => {
		// Log block count for debugging
		console.log(`Creating greedy mesh for chunk with ${Object.keys(chunksBlocks).length} blocks`);
		
		// Generate the greedy mesh data
		const meshData = generateGreedyMesh(chunksBlocks, blockTypesArray);
		
		// If no vertices were generated, return null
		if (meshData.vertices.length === 0) {
			console.log("No vertices generated for this chunk");
			return null;
		}
		
		console.log(`Generated mesh with ${meshData.vertices.length/3} vertices, ${meshData.indices.length/3} triangles`);
		
		// Group vertices by block ID to create separate meshes for each block type
		const blockGroups = {};
		
		// Go through all vertices and group them by block ID
		for (let i = 0; i < meshData.vertices.length / 3; i++) {
			const blockId = meshData.blockIds[i];
			if (!blockGroups[blockId]) {
				blockGroups[blockId] = {
					vertices: [],
					indices: [],
					normals: [],
					uvs: [],
					baseIndex: 0
				};
			}
			
			// Add vertex
			blockGroups[blockId].vertices.push(
				meshData.vertices[i * 3],
				meshData.vertices[i * 3 + 1],
				meshData.vertices[i * 3 + 2]
			);
			
			// Add normal
			blockGroups[blockId].normals.push(
				meshData.normals[i * 3],
				meshData.normals[i * 3 + 1],
				meshData.normals[i * 3 + 2]
			);
			
			// Add UV
			blockGroups[blockId].uvs.push(
				meshData.uvs[i * 2],
				meshData.uvs[i * 2 + 1]
			);
		}
		
		// Process indices for each group
		for (let i = 0; i < meshData.indices.length; i += 6) {
			const vertIndex = meshData.indices[i]; // This is already the vertex index
			const blockId = meshData.blockIds[Math.floor(vertIndex / 4)]; // Every 4 vertices form a quad
			const group = blockGroups[blockId];
			
			// We need to adjust indices to be relative to this group
			const quadBaseIndex = Math.floor(vertIndex / 4) * 4; // Find the start of this quad
			const localBaseIndex = group.baseIndex / 3; // Base index in the group
			
			// Add the 6 indices for the quad (2 triangles)
			group.indices.push(
				localBaseIndex, localBaseIndex + 1, localBaseIndex + 2,
				localBaseIndex, localBaseIndex + 2, localBaseIndex + 3
			);
			
			// Update the base index for the next quad
			group.baseIndex += 12; // 4 vertices per quad * 3 components per vertex
		}
		
		// Create a mesh for each block type
		const meshes = {};
		
		Object.entries(blockGroups).forEach(([blockId, group]) => {
			console.log(`Creating mesh for block type ${blockId} with ${group.vertices.length/3} vertices`);
			
			// Get the block type
			const blockType = blockTypesArray.find(b => b.id === parseInt(blockId));
			if (!blockType) {
				console.error(`Block type ${blockId} not found!`);
				return; // Skip if block type not found
			}
			
			try {
				// Create geometry
				const geometry = new THREE.BufferGeometry();
				
				// Set attributes
				geometry.setAttribute('position', new THREE.Float32BufferAttribute(group.vertices, 3));
				geometry.setAttribute('normal', new THREE.Float32BufferAttribute(group.normals, 3));
				geometry.setAttribute('uv', new THREE.Float32BufferAttribute(group.uvs, 2));
				
				// Set indices
				geometry.setIndex(group.indices);
				
				// Create material - either use cached or create new
				let material;
				try {
					material = getCachedMaterial(blockType);
				} catch (error) {
					console.error("Error getting cached material:", error);
					// Fallback to a default material
					material = new THREE.MeshPhongMaterial({ color: 0xff00ff });
				}
				
				// Create mesh
				const mesh = new THREE.Mesh(geometry, material);
				mesh.castShadow = true;
				mesh.receiveShadow = true;
				
				// Store mesh
				meshes[blockId] = mesh;
			} catch (error) {
				console.error(`Error creating mesh for block type ${blockId}:`, error);
			}
		});
		
		console.log(`Created ${Object.keys(meshes).length} block type meshes`);
		return meshes;
	};

	// Toggle greedy meshing and rebuild all chunks
	const toggleGreedyMeshing = (enabled) => {
		const oldValue = GREEDY_MESHING_ENABLED;
		
		// If toggling on, make sure performance info is displayed
		if (enabled && !oldValue) {
			GREEDY_MESHING_ENABLED = true;
			// Force rebuild of all chunks
			buildUpdateTerrain();
			// Return success
			return true;
		} else if (!enabled && oldValue) {
			// Disable greedy meshing
			GREEDY_MESHING_ENABLED = false;
			// Force rebuild of all chunks
			buildUpdateTerrain();
			// Return success
			return true;
		}
		
		// No change
		return false;
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


