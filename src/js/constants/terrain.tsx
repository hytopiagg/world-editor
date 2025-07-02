
export const CHUNK_SIZE = 16;
export const CHUNK_BLOCK_CAPACITY = 4096; // Fixed capacity for chunks (16x16x16)
export const FRUSTUM_CULLING_DISTANCE = 128; // Changed from 64 to 128
export const MAX_SELECTION_DISTANCE = 256; // Maximum distance for block selection (in blocks)

export const THRESHOLD_FOR_PLACING = 0.4; // Minimum distance for block placement (in world units)

export const MAX_IMPORT_SIZE_X = 500;
export const MAX_IMPORT_SIZE_Y = 500;
export const MAX_IMPORT_SIZE_Z = 500;
export const DEFAULT_IMPORT_SIZE = 500;
export const CENTER_IMPORTS_AT_ORIGIN = true;

const selectionDistance = 256; // Permanently set to maximum value
export const getSelectionDistance = () => selectionDistance;

let viewDistance = FRUSTUM_CULLING_DISTANCE; // Store the current value
export const getViewDistance = () => viewDistance;
export const setViewDistance = (distance) => {
    const newDistance = Math.max(32, Math.min(256, distance)); // Clamp between 32 and 256
    viewDistance = newDistance;
    console.log(`View distance set to ${newDistance} blocks`);
    return newDistance;
};
