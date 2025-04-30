import { getChunkSystem } from "../chunks/TerrainBuilderIntegration";
import { CHUNK_SIZE, getViewDistance } from "../constants/terrain";

export const setDeferredChunkMeshing = (defer) => {
    const chunkSystem = getChunkSystem();
    if (!chunkSystem) {
        console.error(
            "Cannot set deferred chunk meshing: chunk system not available"
        );
        return false;
    }
    let priorityDistance = Math.min(32, getViewDistance() / 2);
    priorityDistance = Math.max(24, priorityDistance);
    if (!defer) {
        chunkSystem.forceUpdateChunkVisibility(false);
    }
    chunkSystem.setBulkLoadingMode(defer, priorityDistance);
    return true;
};

/**
 * Force an update for specific chunks by key
 * @param {Array<String>} chunkKeys - Array of chunk keys to update, e.g. ["32,48,0", "16,48,0"]
 * @param {Object} options - Options for the update
 * @param {Boolean} options.skipNeighbors - If true, skip neighbor chunk updates (faster but less accurate at boundaries)
 */
export const forceChunkUpdate = (chunkKeys, options: any = {}) => {
    const chunkSystem = getChunkSystem();
    if (!chunkSystem || chunkKeys.length === 0) {
        return;
    }
    chunkSystem.forceUpdateChunks(chunkKeys, options);
};

/**
 * Force update a chunk by its origin
 * @param {Array} chunkOrigin - Array with the chunk's origin coordinates [x, y, z]
 * @param {Object} options - Options for the update
 * @param {Boolean} options.skipNeighbors - If true, skip neighbor chunk updates for faster processing
 */
export const forceChunkUpdateByOrigin = (chunkOrigin, options: any = {}) => {
    const chunkSystem = getChunkSystem();
    if (!chunkSystem) {
        console.warn("forceChunkUpdateByOrigin: No chunk system available");
        return;
    }
    const skipNeighbors = options.skipNeighbors === true;
    const chunkId = `${chunkOrigin[0]},${chunkOrigin[1]},${chunkOrigin[2]}`;
    chunkSystem.forceUpdateChunks([chunkId], { skipNeighbors });
};

/**
 * Configure chunk loading behavior
 * @param {Object} options Configuration options
 * @param {boolean} options.deferMeshBuilding Whether to defer mesh building for distant chunks
 * @param {number} options.priorityDistance Distance within which chunks get immediate meshes
 * @param {number} options.deferredBuildDelay Delay in ms before building deferred chunks
 */
export const configureChunkLoading = (options: any = {}) => {
    const chunkSystem = getChunkSystem();
    if (!chunkSystem) {
        console.warn(
            "Cannot configure chunk loading: chunk system not available"
        );
        return false;
    }
    const deferMeshBuilding = options.deferMeshBuilding !== false;
    const priorityDistance =
        options.priorityDistance || Math.max(32, getViewDistance() * 0.33);
    if (deferMeshBuilding) {
        chunkSystem.setBulkLoadingMode(true, priorityDistance);
    } else {
        chunkSystem.setBulkLoadingMode(false, priorityDistance);
    }
    return true;
};

export const loadAllChunks = async () => {
    const chunkSystem = getChunkSystem();
    if (!chunkSystem) {
        console.warn("No chunk system available for loading chunks");
        return;
    }
    const scene = chunkSystem._scene;
    const camera = (scene as any).camera;
    if (!camera) {
        console.warn("No camera available for prioritizing chunks");
        return;
    }
    const cameraPos = camera.position;
    const chunkIds = Array.from(chunkSystem._chunkManager._chunks.keys());
    const chunksWithDistances = chunkIds.map((chunkId) => {
        const [x, y, z] = chunkId.split(",").map(Number);
        const chunkCenterX = x + CHUNK_SIZE / 2;
        const chunkCenterY = y + CHUNK_SIZE / 2;
        const chunkCenterZ = z + CHUNK_SIZE / 2;
        const distance = Math.sqrt(
            Math.pow(chunkCenterX - cameraPos.x, 2) +
                Math.pow(chunkCenterY - cameraPos.y, 2) +
                Math.pow(chunkCenterZ - cameraPos.z, 2)
        );
        return { chunkId, distance };
    });
    chunksWithDistances.sort((a, b) => a.distance - b.distance);
    const BATCH_SIZE = 50;
    for (let i = 0; i < chunksWithDistances.length; i += BATCH_SIZE) {
        const batch = chunksWithDistances.slice(i, i + BATCH_SIZE);
        for (const { chunkId, distance } of batch) {
            const chunk = chunkSystem._chunkManager._chunks.get(chunkId);
            if (chunk) {
                chunkSystem._chunkManager.queueChunkForRender(chunkId, {
                    forceMesh: true, // Force immediate mesh building
                    priority: true, // High priority
                });
            }
        }
        chunkSystem.processRenderQueue(); // true = prioritize by camera distance
        if (i + BATCH_SIZE < chunksWithDistances.length) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }
    chunkSystem.processRenderQueue();
    return true;
};
