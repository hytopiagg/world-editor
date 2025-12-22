import LightLevelVolume from "./LightLevelVolume";
import Chunk from "./Chunk";
import { CHUNK_SIZE, MAX_LIGHT_LEVEL } from "./ChunkConstants";

/**
 * LightLevelManager manages light level volumes for all loaded chunks.
 * 
 * SDK-compatible implementation:
 * - Maintains a Map of LightLevelVolume instances keyed by chunk ID
 * - Provides global coordinate lookups that resolve to the correct chunk's volume
 * - Supports propagating light from emissive blocks to surrounding blocks
 */
class LightLevelManager {
    /**
     * Create a new light level manager
     */
    constructor() {
        /** @type {Map<string, LightLevelVolume>} */
        this._volumes = new Map();
    }

    /**
     * Get or create a light level volume for a chunk
     * @param {string} chunkId - The chunk ID
     * @param {Object} originCoordinate - The chunk's origin coordinate
     * @returns {LightLevelVolume} The light level volume for the chunk
     */
    getOrCreateVolume(chunkId, originCoordinate) {
        let volume = this._volumes.get(chunkId);
        if (!volume) {
            volume = new LightLevelVolume(originCoordinate);
            this._volumes.set(chunkId, volume);
        }
        return volume;
    }

    /**
     * Get the light level volume for a chunk
     * @param {string} chunkId - The chunk ID
     * @returns {LightLevelVolume|undefined} The light level volume, or undefined if not found
     */
    getVolume(chunkId) {
        return this._volumes.get(chunkId);
    }

    /**
     * Remove the light level volume for a chunk
     * @param {string} chunkId - The chunk ID
     */
    removeVolume(chunkId) {
        this._volumes.delete(chunkId);
    }

    /**
     * Get the light level at a global coordinate
     * @param {Object} globalCoordinate - The global coordinate {x, y, z}
     * @returns {number} Light level (0-15), or 0 if no volume exists
     */
    getLightLevel(globalCoordinate) {
        const originCoordinate = Chunk.globalCoordinateToOriginCoordinate(globalCoordinate);
        const chunkId = Chunk.getChunkId(originCoordinate);
        const volume = this._volumes.get(chunkId);
        
        if (!volume) {
            return 0;
        }
        
        return volume.getLightLevelByGlobalCoordinate(globalCoordinate);
    }

    /**
     * Set the light level at a global coordinate
     * @param {Object} globalCoordinate - The global coordinate {x, y, z}
     * @param {number} level - Light level (0-15)
     */
    setLightLevel(globalCoordinate, level) {
        const originCoordinate = Chunk.globalCoordinateToOriginCoordinate(globalCoordinate);
        const chunkId = Chunk.getChunkId(originCoordinate);
        const volume = this.getOrCreateVolume(chunkId, originCoordinate);
        
        volume.setLightLevelByGlobalCoordinate(globalCoordinate, level);
    }

    /**
     * Calculate and propagate light levels from emissive blocks in a chunk
     * This should be called when a chunk is built or when emissive blocks change
     * 
     * @param {Chunk} chunk - The chunk to process
     * @param {Function} getChunkByKey - Function to get chunks by key (for cross-chunk propagation)
     */
    calculateLightLevels(chunk, getChunkByKey) {
        const volume = this.getOrCreateVolume(chunk.chunkId, chunk.originCoordinate);
        volume.clear();
        
        // Get light sources from this chunk
        const sources = chunk.getLightSources();
        
        // Also get sources from neighboring chunks (for cross-chunk lighting)
        const searchRadius = Math.ceil((MAX_LIGHT_LEVEL + 1) / CHUNK_SIZE);
        const { x: ox, y: oy, z: oz } = chunk.originCoordinate;
        
        const allSources = [...sources];
        
        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
            for (let dy = -searchRadius; dy <= searchRadius; dy++) {
                for (let dz = -searchRadius; dz <= searchRadius; dz++) {
                    if (dx === 0 && dy === 0 && dz === 0) continue;
                    
                    const neighborOrigin = {
                        x: ox + dx * CHUNK_SIZE,
                        y: oy + dy * CHUNK_SIZE,
                        z: oz + dz * CHUNK_SIZE,
                    };
                    const neighborId = Chunk.getChunkId(neighborOrigin);
                    const neighbor = getChunkByKey(neighborId);
                    
                    if (neighbor) {
                        allSources.push(...neighbor.getLightSources());
                    }
                }
            }
        }
        
        // Calculate light level for each block in the chunk
        for (let y = 0; y < CHUNK_SIZE; y++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                for (let x = 0; x < CHUNK_SIZE; x++) {
                    const globalX = chunk.originCoordinate.x + x;
                    const globalY = chunk.originCoordinate.y + y;
                    const globalZ = chunk.originCoordinate.z + z;
                    
                    let maxLevel = 0;
                    
                    for (const source of allSources) {
                        const dx = globalX - source.position.x + 0.5;
                        const dy = globalY - source.position.y + 0.5;
                        const dz = globalZ - source.position.z + 0.5;
                        
                        // Quick distance check using Manhattan distance
                        if (Math.abs(dx) > source.level ||
                            Math.abs(dy) > source.level ||
                            Math.abs(dz) > source.level) {
                            continue;
                        }
                        
                        // Euclidean distance for accurate falloff
                        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                        if (distance >= source.level) continue;
                        
                        maxLevel = Math.max(maxLevel, source.level - distance);
                    }
                    
                    if (maxLevel > 0) {
                        volume.setLightLevel(x, y, z, Math.min(MAX_LIGHT_LEVEL, Math.max(0, Math.round(maxLevel))));
                    }
                }
            }
        }
    }

    /**
     * Clear all light level volumes
     */
    clear() {
        this._volumes.clear();
    }

    /**
     * Get the number of active volumes
     * @returns {number} The number of active volumes
     */
    get volumeCount() {
        return this._volumes.size;
    }

    /**
     * Get total memory usage across all volumes
     * @returns {number} Total memory usage in bytes
     */
    getTotalMemoryUsage() {
        let total = 0;
        for (const volume of this._volumes.values()) {
            total += volume.getMemoryUsage();
        }
        return total;
    }
}

// Singleton instance
let _instance = null;

/**
 * Get the singleton LightLevelManager instance
 * @returns {LightLevelManager}
 */
LightLevelManager.getInstance = function() {
    if (!_instance) {
        _instance = new LightLevelManager();
    }
    return _instance;
};

export default LightLevelManager;

