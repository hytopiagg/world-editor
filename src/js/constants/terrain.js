// Define chunk constants
export const CHUNK_SIZE = 16;
export const CHUNK_BLOCK_CAPACITY = 4096; // Fixed capacity for chunks (16x16x16)
export const FRUSTUM_CULLING_DISTANCE = 64; // Increase view distance for less pop-in
export const MAX_SELECTION_DISTANCE = 256; // Maximum distance for block selection (in blocks)

// Placement threshold
export const THRESHOLD_FOR_PLACING = 0.9; // Minimum distance for block placement (in world units)

// Map import size limitations
export const MAX_IMPORT_SIZE_X = 500;
export const MAX_IMPORT_SIZE_Y = 500;
export const MAX_IMPORT_SIZE_Z = 500;
export const DEFAULT_IMPORT_SIZE = 500;
export const CENTER_IMPORTS_AT_ORIGIN = true;

// Selection distance for raycasting
let selectionDistance = 128; // Store the current value
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
