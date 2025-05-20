/**
 * SpatialHashGrid.js
 *
 * Binary TypedArray implementation of a spatial hash grid for efficient block lookups.
 * Uses a hash table and TypedArrays for O(1) block lookups with minimal memory overhead.
 */
export class SpatialHashGrid {

    static singletonInstance = null;
    /**
     * Creates a new spatial hash grid or returns the existing singleton instance
     * @param {Object} options - Configuration options
     * @param {number} options.chunkSize - Size of each chunk in blocks (default 16)
     * @returns {SpatialHashGrid} The singleton instance
     */
    constructor(options = {}) {

        if (SpatialHashGrid.singletonInstance) {
            return SpatialHashGrid.singletonInstance;
        }

        this.chunkSize = options.chunkSize || 16;
        this.size = 0;
        this.isProcessing = false;

        this._blocks = null; // Uint32Array for block IDs
        this._coords = null; // Int32Array for coordinates (x,y,z)
        this._capacity = 0; // Current capacity of TypedArrays

        this.hashTable = null; // Maps hash to index
        this.collisionTable = null; // Handles hash collisions

        this.HASH_EMPTY = 0xffffffff; // Marker for empty slots
        this.HASH_PRIME1 = 73856093; // Prime for spatial hashing
        this.HASH_PRIME2 = 19349663; // Prime for spatial hashing
        this.HASH_PRIME3 = 83492791; // Prime for spatial hashing

        SpatialHashGrid.singletonInstance = this;

        this.initializeArrays(1000);

    }
    /**
     * Initialize TypedArrays with specified capacity
     * @param {number} capacity - Initial capacity
     * @private
     */
    initializeArrays(capacity) {
        this._capacity = capacity;
        this._blocks = new Uint32Array(capacity);
        this._coords = new Int32Array(capacity * 3);

        const hashCapacity = Math.ceil(capacity * 1.5);
        this.hashTable = new Uint32Array(hashCapacity);
        this.collisionTable = new Uint32Array(capacity);

        this.hashTable.fill(this.HASH_EMPTY);
        this.collisionTable.fill(this.HASH_EMPTY);
    }
    /**
     * Initialize grid from binary data (from worker)
     * @param {Object} data - Binary data from worker
     */
    initializeFromBinary(data) {
        const {
            blockIds,
            coordinates,
            hashTable,
            collisionTable,
            size,
            hashConstants,
        } = data;

        if (
            !this.validateGridData(
                blockIds,
                coordinates,
                hashTable,
                collisionTable,
                size
            )
        ) {
            console.error(
                "SpatialHashGrid: Invalid binary data received from worker, falling back to empty grid"
            );
            this.reset();
            return;
        }

        if (hashConstants) {
            this.HASH_EMPTY = hashConstants.HASH_EMPTY;
            this.HASH_PRIME1 = hashConstants.HASH_PRIME1;
            this.HASH_PRIME2 = hashConstants.HASH_PRIME2;
            this.HASH_PRIME3 = hashConstants.HASH_PRIME3;
        }

        this.clear();

        if (size > this._capacity) {
            this.initializeArrays(Math.ceil(size * 1.5)); // Initialize with extra capacity
        }

        let addedCount = 0;
        for (let i = 0; i < size; i++) {
            const blockId = blockIds[i];

            if (blockId === 0 || blockId === undefined || blockId === null)
                continue;
            const x = coordinates[i * 3];
            const y = coordinates[i * 3 + 1];
            const z = coordinates[i * 3 + 2];
            if (this.set(x, y, z, blockId)) {
                addedCount++;
            } else {
                console.warn(
                    `SpatialHashGrid: Failed to set block at (${x},${y},${z}) during binary initialization`
                );
            }
        }

        this.size = addedCount;
    }
    /**
     * Validate grid data to ensure it's properly formed
     * @param {Uint32Array} blocks - Block IDs
     * @param {Int32Array} coords - Coordinates
     * @param {Uint32Array} hashTable - Hash table
     * @param {Uint32Array} collisionTable - Collision table
     * @param {number} size - Number of blocks
     * @returns {boolean} True if data is valid
     */
    validateGridData(blocks, coords, hashTable, collisionTable, size) {

        if (!blocks || !coords || !hashTable || !collisionTable) {
            console.error("SpatialHashGrid: Missing arrays in grid data");
            return false;
        }

        if (
            !(blocks instanceof Uint32Array) ||
            !(coords instanceof Int32Array) ||
            !(hashTable instanceof Uint32Array) ||
            !(collisionTable instanceof Uint32Array)
        ) {
            console.error("SpatialHashGrid: Arrays are not TypedArrays");
            return false;
        }

        if (
            blocks.length < size ||
            coords.length < size * 3 ||
            hashTable.length < size ||
            collisionTable.length < size
        ) {
            console.error(
                "SpatialHashGrid: Arrays are too small for specified size"
            );
            return false;
        }

        if (size > 0) {
            for (let i = 0; i < Math.min(3, size); i++) {
                if (
                    blocks[i] === undefined ||
                    coords[i * 3] === undefined ||
                    coords[i * 3 + 1] === undefined ||
                    coords[i * 3 + 2] === undefined
                ) {
                    console.error(
                        `SpatialHashGrid: Undefined values found in data at index ${i}`
                    );
                    return false;
                }
            }
        }
        return true;
    }
    /**
     * Generate a spatial hash from coordinates
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {number} z - Z coordinate
     * @returns {number} 32-bit unsigned hash
     */
    hash(x, y, z) {

        return (
            ((x * this.HASH_PRIME1) ^
                (y * this.HASH_PRIME2) ^
                (z * this.HASH_PRIME3)) >>>
            0
        ); // Force unsigned 32-bit
    }
    /**
     * Set a block at the specified coordinates
     * Optimized for high-frequency calls during block placement
     *
     * @param {number|string} x - X coordinate or posKey string
     * @param {number|null} y - Y coordinate or blockId if first param is posKey
     * @param {number|null} z - Z coordinate (can be null if first param is posKey)
     * @param {number|null} blockId - Block ID (can be null if first param is posKey and second is blockId)
     * @returns {boolean} - True if successful
     */
    set(x, y, z, blockId) {

        if (typeof x === "string") {
            const posKey = x;

            if (typeof y === "number" && z === undefined) {
                blockId = y;
                const [posX, posY, posZ] = posKey.split(",").map(Number);
                x = posX;
                y = posY;
                z = posZ;
            } else {
                console.warn("Invalid parameters for set method", {
                    x,
                    y,
                    z,
                    blockId,
                });
                return false;
            }
        }

        if (
            x === undefined ||
            y === undefined ||
            z === undefined ||
            isNaN(x) ||
            isNaN(y) ||
            isNaN(z)
        ) {
            console.warn("Invalid coordinates in set method", {
                x,
                y,
                z,
                blockId,
            });
            return false;
        }

        if (!this._blocks || !this._coords || !this.hashTable) {
            console.warn("SpatialHashGrid: Not initialized");
            return false;
        }

        if (blockId === 0) {
            return this.remove(x, y, z);
        }

        const existingBlockId = this.get(x, y, z);
        if (existingBlockId === blockId) {

            return true;
        }

        if (existingBlockId !== null) {
            this.remove(x, y, z);
        }

        const hashValue = this.hash(x, y, z);
        const hashIndex = hashValue % this.hashTable.length;

        if (this.size >= this._capacity) {

            this._expandCapacity();
        }

        const blockIndex = this.size;
        this._blocks[blockIndex] = blockId;
        this._coords[blockIndex * 3] = x;
        this._coords[blockIndex * 3 + 1] = y;
        this._coords[blockIndex * 3 + 2] = z;

        if (blockId >= 1000) {
            console.log("SpatialHashGrid: Setting block at", x, y, z, "with blockId", blockId);
        }

        const prevHeadIndex = this.hashTable[hashIndex];
        this.hashTable[hashIndex] = blockIndex;
        this.collisionTable[blockIndex] = prevHeadIndex;

        this.size++;
        return true;
    }
    /**
     * Get a block at the specified coordinates
     * @param {number|string} x - X coordinate or posKey string
     * @param {number} [y] - Y coordinate
     * @param {number} [z] - Z coordinate
     * @returns {number|null} Block ID or null if not found
     */
    get(x, y, z) {

        const DEBUG_RAYCAST = false;

        if (typeof x === "string") {
            const posKey = x;
            const [posX, posY, posZ] = posKey.split(",").map(Number);
            x = posX;
            y = posY;
            z = posZ;
        }

        if (
            x === undefined ||
            y === undefined ||
            z === undefined ||
            isNaN(x) ||
            isNaN(y) ||
            isNaN(z)
        ) {
            return null;
        }

        if (!this._blocks || !this._coords || !this.hashTable) {
            return null;
        }

        const hashValue = this.hash(x, y, z);
        const hashIndex = hashValue % this.hashTable.length;

        if (this.hashTable[hashIndex] === this.HASH_EMPTY) {
            return null;
        }

        let blockIndex = this.hashTable[hashIndex];

        while (blockIndex !== this.HASH_EMPTY) {

            const bx = this._coords[blockIndex * 3];
            const by = this._coords[blockIndex * 3 + 1];
            const bz = this._coords[blockIndex * 3 + 2];

            if (bx === x && by === y && bz === z) {

                const blockId = this._blocks[blockIndex];
                return blockId;
            }

            blockIndex = this.collisionTable[blockIndex];
        }

        return null;
    }
    /**
     * Remove a block from the grid
     * @param {string|number} posKey - Position key or x coordinate
     * @param {number} [y] - Y coordinate if posKey is x
     * @param {number} [z] - Z coordinate if posKey is x
     * @returns {boolean} True if block was removed
     */
    remove(posKey, y, z) {

        let x;
        if (typeof posKey === "string") {
            [x, y, z] = posKey.split(",").map(Number);
        } else {
            x = posKey;
        }

        if (isNaN(x) || isNaN(y) || isNaN(z)) {
            console.warn(
                `SpatialHashGrid: Invalid coordinates in remove(${x},${y},${z})`
            );
            return false;
        }

        const hashValue = this.hash(x, y, z);
        const hashIndex = hashValue % this.hashTable.length;

        if (this.hashTable[hashIndex] === this.HASH_EMPTY) {
            return false; // Not found
        }

        let idx = this.hashTable[hashIndex];
        let prevIdx = null;

        while (idx !== this.HASH_EMPTY) {
            const cx = this._coords[idx * 3];
            const cy = this._coords[idx * 3 + 1];
            const cz = this._coords[idx * 3 + 2];

            if (cx === x && cy === y && cz === z) {


                const nextIdx = this.collisionTable[idx];

                if (prevIdx === null) {


                    this.hashTable[hashIndex] = nextIdx;
                } else {


                    this.collisionTable[prevIdx] = nextIdx;
                }


                if (idx < this.size - 1) {

                    const lastIdx = this.size - 1;
                    const lastBlockId = this._blocks[lastIdx];
                    const lastX = this._coords[lastIdx * 3];
                    const lastY = this._coords[lastIdx * 3 + 1];
                    const lastZ = this._coords[lastIdx * 3 + 2];

                    this._blocks[idx] = lastBlockId;
                    this._coords[idx * 3] = lastX;
                    this._coords[idx * 3 + 1] = lastY;
                    this._coords[idx * 3 + 2] = lastZ;

                    const lastHashValue = this.hash(lastX, lastY, lastZ);
                    const lastHashIndex = lastHashValue % this.hashTable.length;

                    if (this.hashTable[lastHashIndex] === lastIdx) {

                        this.hashTable[lastHashIndex] = idx;
                    } else {

                        let chainIdx = this.hashTable[lastHashIndex];
                        while (chainIdx !== this.HASH_EMPTY) {
                            if (this.collisionTable[chainIdx] === lastIdx) {
                                this.collisionTable[chainIdx] = idx;
                                break;
                            }
                            chainIdx = this.collisionTable[chainIdx];
                        }
                    }
                }

                this.size--;
                return true;
            }

            prevIdx = idx;
            idx = this.collisionTable[idx];
        }

        return false;
    }
    /**
     * Clear all data from the grid
     * This completely resets the grid to an empty state
     */
    clear() {
        console.log("SpatialHashGrid: Clearing all data");

        this.size = 0;

        if (this._blocks) this._blocks.fill(0);
        if (this._coords) this._coords.fill(0);

        if (this.hashTable) this.hashTable.fill(this.HASH_EMPTY);
        if (this.collisionTable) this.collisionTable.fill(this.HASH_EMPTY);
        console.log("SpatialHashGrid: All data cleared");
    }
    /**
     * Reset the grid to initial state
     * Useful when loading a new world
     */
    reset() {
        console.log("SpatialHashGrid: Resetting to initial state");
        this.clear();

        this.size = 0;
        this.isProcessing = false;

        this._blocks = null;
        this._coords = null;
        this.hashTable = null;
        this.collisionTable = null;
        this._capacity = 0;

        this.initializeArrays(1000);
        console.log("SpatialHashGrid: Reset to initial state");
    }
    /**
     * Expand the capacity of the grid's internal arrays
     * Called automatically when the grid is full
     * @private
     */
    _expandCapacity() {

        const newCapacity = this._capacity * 2;
        const newBlocks = new Uint32Array(newCapacity);
        const newCoords = new Int32Array(newCapacity * 3);

        newBlocks.set(this._blocks);
        newCoords.set(this._coords);

        this._blocks = newBlocks;
        this._coords = newCoords;

        const newCollisionTable = new Uint32Array(newCapacity);
        newCollisionTable.fill(this.HASH_EMPTY);
        newCollisionTable.set(this.collisionTable);
        this.collisionTable = newCollisionTable;

        const newHashCapacity = Math.ceil(newCapacity * 1.5);
        const newHashTable = new Uint32Array(newHashCapacity);
        newHashTable.fill(this.HASH_EMPTY);

        for (let i = 0; i < this.size; i++) {
            const ix = this._coords[i * 3];
            const iy = this._coords[i * 3 + 1];
            const iz = this._coords[i * 3 + 2];
            const hashValue = this.hash(ix, iy, iz);
            const hashIndex = hashValue % newHashCapacity;

            const prevHeadIndex = newHashTable[hashIndex];
            newHashTable[hashIndex] = i;
            this.collisionTable[i] = prevHeadIndex;
        }

        this.hashTable = newHashTable;
        this._capacity = newCapacity;
        console.log(`SpatialHashGrid: Expanded capacity to ${newCapacity}`);
    }
}
