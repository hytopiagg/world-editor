// Define chunk constants
export const CHUNK_SIZE = 16;
export const BLOCK_INSTANCED_MESH_CAPACITY = 500000; // Maximum number of blocks that can be instanced at once
export const CHUNK_BLOCK_CAPACITY = 62500; // BLOCK_INSTANCED_MESH_CAPACITY / 8
export const FRUSTUM_CULLING_DISTANCE = 64; // Increase view distance for less pop-in
export const MAX_SELECTION_DISTANCE = 32; // Maximum distance for block selection (in blocks)

// Placement threshold
export const THRESHOLD_FOR_PLACING = 0.9; // Minimum distance for block placement (in world units)

// Map import size limitations
export const MAX_IMPORT_SIZE_X = 500;
export const MAX_IMPORT_SIZE_Y = 500;
export const MAX_IMPORT_SIZE_Z = 500;
export const DEFAULT_IMPORT_SIZE = 500;
export const CENTER_IMPORTS_AT_ORIGIN = true;

// Greedy meshing constants
export let GREEDY_MESHING_ENABLED = true; // Enable greedy meshing by default for better performance

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

// Greedy meshing functions
export const getGreedyMeshingEnabled = () => GREEDY_MESHING_ENABLED;
export const setGreedyMeshingEnabled = (enabled) => {
  const changed = GREEDY_MESHING_ENABLED !== enabled;
  GREEDY_MESHING_ENABLED = enabled;
  return changed;
}; 