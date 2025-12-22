import { CHUNK_SIZE, CHUNK_VOLUME, MAX_LIGHT_LEVEL } from "./ChunkConstants";

/**
 * LightLevelVolume stores light levels for a chunk using efficient 4-bit packing.
 * 
 * SDK-compatible implementation:
 * - Light levels are integers in the range [0, 15]
 * - Two light levels are packed into a single byte (4 bits each)
 * - Memory usage: CHUNK_SIZE³ / 2 bytes per chunk (2048 bytes for 16³)
 * 
 * This is an optimization over storing full bytes or floats per block.
 */
class LightLevelVolume {
    /**
     * Create a new light level volume for a chunk
     * @param {Object} originCoordinate - The origin coordinate of the chunk
     */
    constructor(originCoordinate) {
        this.originCoordinate = originCoordinate;
        
        // 4-bit packing: 2 light levels per byte
        // For a 16³ chunk (4096 blocks), we need 2048 bytes
        const packedSize = Math.ceil(CHUNK_VOLUME / 2);
        this._data = new Uint8Array(packedSize);
    }

    /**
     * Get the packed index and bit position for a local coordinate
     * @param {number} x - Local X coordinate
     * @param {number} y - Local Y coordinate  
     * @param {number} z - Local Z coordinate
     * @returns {{byteIndex: number, isHighNibble: boolean}} The byte index and nibble position
     * @private
     */
    _getPackedPosition(x, y, z) {
        const linearIndex = x + CHUNK_SIZE * (y + CHUNK_SIZE * z);
        return {
            byteIndex: linearIndex >> 1, // Divide by 2
            isHighNibble: (linearIndex & 1) === 1, // Odd indices use high nibble
        };
    }

    /**
     * Set the light level at a local coordinate
     * @param {number} x - Local X coordinate (0-15)
     * @param {number} y - Local Y coordinate (0-15)
     * @param {number} z - Local Z coordinate (0-15)
     * @param {number} level - Light level (0-15)
     */
    setLightLevel(x, y, z, level) {
        // Clamp level to valid range
        const clampedLevel = Math.max(0, Math.min(MAX_LIGHT_LEVEL, Math.floor(level)));
        
        const { byteIndex, isHighNibble } = this._getPackedPosition(x, y, z);
        
        if (isHighNibble) {
            // Store in high nibble (bits 4-7), preserve low nibble
            this._data[byteIndex] = (this._data[byteIndex] & 0x0F) | (clampedLevel << 4);
        } else {
            // Store in low nibble (bits 0-3), preserve high nibble
            this._data[byteIndex] = (this._data[byteIndex] & 0xF0) | clampedLevel;
        }
    }

    /**
     * Get the light level at a local coordinate
     * @param {number} x - Local X coordinate (0-15)
     * @param {number} y - Local Y coordinate (0-15)
     * @param {number} z - Local Z coordinate (0-15)
     * @returns {number} Light level (0-15)
     */
    getLightLevel(x, y, z) {
        // Bounds check
        if (x < 0 || x >= CHUNK_SIZE || y < 0 || y >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) {
            return 0;
        }
        
        const { byteIndex, isHighNibble } = this._getPackedPosition(x, y, z);
        
        if (isHighNibble) {
            // Extract high nibble (bits 4-7)
            return (this._data[byteIndex] >> 4) & 0x0F;
        } else {
            // Extract low nibble (bits 0-3)
            return this._data[byteIndex] & 0x0F;
        }
    }

    /**
     * Get the light level at a global coordinate
     * @param {Object} globalCoordinate - The global coordinate {x, y, z}
     * @returns {number} Light level (0-15), or 0 if outside this volume
     */
    getLightLevelByGlobalCoordinate(globalCoordinate) {
        const localX = globalCoordinate.x - this.originCoordinate.x;
        const localY = globalCoordinate.y - this.originCoordinate.y;
        const localZ = globalCoordinate.z - this.originCoordinate.z;
        
        return this.getLightLevel(localX, localY, localZ);
    }

    /**
     * Set the light level at a global coordinate
     * @param {Object} globalCoordinate - The global coordinate {x, y, z}
     * @param {number} level - Light level (0-15)
     */
    setLightLevelByGlobalCoordinate(globalCoordinate, level) {
        const localX = globalCoordinate.x - this.originCoordinate.x;
        const localY = globalCoordinate.y - this.originCoordinate.y;
        const localZ = globalCoordinate.z - this.originCoordinate.z;
        
        // Bounds check
        if (localX >= 0 && localX < CHUNK_SIZE &&
            localY >= 0 && localY < CHUNK_SIZE &&
            localZ >= 0 && localZ < CHUNK_SIZE) {
            this.setLightLevel(localX, localY, localZ, level);
        }
    }

    /**
     * Clear all light levels to 0
     */
    clear() {
        this._data.fill(0);
    }

    /**
     * Check if this coordinate is within the volume
     * @param {Object} globalCoordinate - The global coordinate {x, y, z}
     * @returns {boolean} True if the coordinate is within this volume
     */
    containsGlobalCoordinate(globalCoordinate) {
        const localX = globalCoordinate.x - this.originCoordinate.x;
        const localY = globalCoordinate.y - this.originCoordinate.y;
        const localZ = globalCoordinate.z - this.originCoordinate.z;
        
        return localX >= 0 && localX < CHUNK_SIZE &&
               localY >= 0 && localY < CHUNK_SIZE &&
               localZ >= 0 && localZ < CHUNK_SIZE;
    }

    /**
     * Get the raw packed data (for serialization)
     * @returns {Uint8Array} The raw packed light level data
     */
    getRawData() {
        return this._data;
    }

    /**
     * Set the raw packed data (for deserialization)
     * @param {Uint8Array} data - The raw packed light level data
     */
    setRawData(data) {
        if (data.length !== this._data.length) {
            throw new Error(`LightLevelVolume: Invalid data length. Expected ${this._data.length}, got ${data.length}`);
        }
        this._data.set(data);
    }

    /**
     * Get the memory usage in bytes
     * @returns {number} Memory usage in bytes
     */
    getMemoryUsage() {
        return this._data.byteLength;
    }
}

export default LightLevelVolume;

