/**
 * SpatialHashGrid.js
 *
 * Binary TypedArray implementation of a spatial hash grid for efficient block lookups.
 * Uses a hash table and TypedArrays for O(1) block lookups with minimal memory overhead.
 */
export class SpatialHashGrid {
    // Singleton pattern - only one instance should exist
    static singletonInstance = null;

    /**
     * Creates a new spatial hash grid or returns the existing singleton instance
     * @param {Object} options - Configuration options
     * @param {number} options.chunkSize - Size of each chunk in blocks (default 16)
     * @returns {SpatialHashGrid} The singleton instance
     */
    constructor(options = {}) {
        // Singleton pattern - return existing instance if available
        if (SpatialHashGrid.singletonInstance) {
            return SpatialHashGrid.singletonInstance;
        }

        // Initialize grid properties
        this.chunkSize = options.chunkSize || 16;
        this.size = 0;
        this.isProcessing = false;

        // TypedArray storage
        this._blocks = null; // Uint32Array for block IDs
        this._coords = null; // Int32Array for coordinates (x,y,z)
        this._capacity = 0; // Current capacity of TypedArrays

        // Hash table for O(1) lookups
        this.hashTable = null; // Maps hash to index
        this.collisionTable = null; // Handles hash collisions

        // Hash constants
        this.HASH_EMPTY = 0xffffffff; // Marker for empty slots
        this.HASH_PRIME1 = 73856093; // Prime for spatial hashing
        this.HASH_PRIME2 = 19349663; // Prime for spatial hashing
        this.HASH_PRIME3 = 83492791; // Prime for spatial hashing

        // Set as singleton instance
        SpatialHashGrid.singletonInstance = this;

        // Initialize arrays with initial capacity
        this.initializeArrays(1000);

        //console.log(`🧊 SpatialHashGrid: Binary TypedArray singleton instance created (chunkSize: ${this.chunkSize})`);
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

        // Hash table should be larger to reduce collisions
        const hashCapacity = Math.ceil(capacity * 1.5);
        this.hashTable = new Uint32Array(hashCapacity);
        this.collisionTable = new Uint32Array(capacity);

        // Fill tables with empty markers
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

        // Validate the incoming data
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

        // Update hash constants if provided
        if (hashConstants) {
            this.HASH_EMPTY = hashConstants.HASH_EMPTY;
            this.HASH_PRIME1 = hashConstants.HASH_PRIME1;
            this.HASH_PRIME2 = hashConstants.HASH_PRIME2;
            this.HASH_PRIME3 = hashConstants.HASH_PRIME3;
        }

        console.log(
            `SpatialHashGrid: Rebuilding grid from binary data with ${size} blocks...`
        );

        // 1. Clear the existing grid state completely
        this.clear();

        // 2. Ensure capacity is sufficient (avoids multiple expansions during set)
        if (size > this._capacity) {
            this.initializeArrays(Math.ceil(size * 1.5)); // Initialize with extra capacity
        }

        // 3. Iteratively add blocks using the set method to ensure consistent state
        let addedCount = 0;
        for (let i = 0; i < size; i++) {
            const blockId = blockIds[i];
            // Skip air blocks potentially included in worker data
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

        // Set the final size based on successfully added blocks
        this.size = addedCount;

        // Log with some sample blocks to verify data
        console.log(
            `SpatialHashGrid: Rebuilt grid from binary data. Final size: ${this.size} blocks.`
        );
        this.logSampleBlocks(3);
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
        // Check if arrays exist
        if (!blocks || !coords || !hashTable || !collisionTable) {
            console.error("SpatialHashGrid: Missing arrays in grid data");
            return false;
        }

        // Check if arrays are TypedArrays
        if (
            !(blocks instanceof Uint32Array) ||
            !(coords instanceof Int32Array) ||
            !(hashTable instanceof Uint32Array) ||
            !(collisionTable instanceof Uint32Array)
        ) {
            console.error("SpatialHashGrid: Arrays are not TypedArrays");
            return false;
        }

        // Check array sizes
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

        // Check for undefined values in first few entries
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
     * Log sample blocks for debugging
     * @param {number} count - Number of blocks to sample
     */
    logSampleBlocks(count = 5) {
        if (!this._blocks || !this._coords || this.size === 0) {
            console.log("SpatialHashGrid: No blocks to sample (empty grid)");
            return;
        }

        const sampleCount = Math.min(count, this.size);
        console.log(
            `SpatialHashGrid: Sample of ${sampleCount} blocks from grid:`
        );

        for (let i = 0; i < sampleCount; i++) {
            const x = this._coords[i * 3];
            const y = this._coords[i * 3 + 1];
            const z = this._coords[i * 3 + 2];
            const blockId = this._blocks[i];
            console.log(`  Block ${i}: (${x},${y},${z}) ID=${blockId}`);
        }
    }

    /**
     * Generate a spatial hash from coordinates
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {number} z - Z coordinate
     * @returns {number} 32-bit unsigned hash
     */
    hash(x, y, z) {
        // Fast spatial hash function
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
        // Parse position key if provided as string
        if (typeof x === "string") {
            const posKey = x;

            // Check if the second parameter is a blockId (y is being used as blockId)
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

        // Skip invalid coordinates
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

        // Safety check
        if (!this._blocks || !this._coords || !this.hashTable) {
            console.warn("SpatialHashGrid: Not initialized");
            return false;
        }

        // If blockId is 0, effectively remove the block
        if (blockId === 0) {
            return this.remove(x, y, z);
        }

        // Performance: Check if the block already exists with the same ID
        const existingBlockId = this.get(x, y, z);
        if (existingBlockId === blockId) {
            // Block already exists with the same ID, no need to update
            return true;
        }

        // First remove any existing block at this position
        if (existingBlockId !== null) {
            this.remove(x, y, z);
        }

        // Calculate the hash for this position
        const hashValue = this.hash(x, y, z);
        const hashIndex = hashValue % this.hashTable.length;

        // Check if capacity reached
        if (this.size >= this._capacity) {
            // Expand the arrays to accommodate more blocks
            this._expandCapacity();
        }

        // Save in the arrays at the current size index
        const blockIndex = this.size;
        this._blocks[blockIndex] = blockId;
        this._coords[blockIndex * 3] = x;
        this._coords[blockIndex * 3 + 1] = y;
        this._coords[blockIndex * 3 + 2] = z;

        // Insert into hash table with collision handling
        const prevHeadIndex = this.hashTable[hashIndex];
        this.hashTable[hashIndex] = blockIndex;
        this.collisionTable[blockIndex] = prevHeadIndex;

        // Increment size
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
        // Enable for debugging raycasting issues
        const DEBUG_RAYCAST = false;

        // Parse position key if provided as string
        if (typeof x === "string") {
            const posKey = x;
            const [posX, posY, posZ] = posKey.split(",").map(Number);
            x = posX;
            y = posY;
            z = posZ;
        }

        // Validate coordinates
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

        // Safety check for initialized arrays
        if (!this._blocks || !this._coords || !this.hashTable) {
            return null;
        }

        // Compute hash value for block lookup
        const hashValue = this.hash(x, y, z);
        const hashIndex = hashValue % this.hashTable.length;

        // Check if hash table entry is empty
        if (this.hashTable[hashIndex] === this.HASH_EMPTY) {
            return null;
        }

        // Get the index of the first block with this hash
        let blockIndex = this.hashTable[hashIndex];

        // Follow the collision chain to find the exact block
        while (blockIndex !== this.HASH_EMPTY) {
            // Get block coordinates at this index
            const bx = this._coords[blockIndex * 3];
            const by = this._coords[blockIndex * 3 + 1];
            const bz = this._coords[blockIndex * 3 + 2];

            // Check if coordinates match
            if (bx === x && by === y && bz === z) {
                // Found the block, return its ID
                const blockId = this._blocks[blockIndex];

                return blockId;
            }

            // Move to next block in collision chain
            blockIndex = this.collisionTable[blockIndex];
        }

        // No block found with these coordinates
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
        // Parse position key (support both coordinate format and legacy string)
        let x;

        if (typeof posKey === "string") {
            [x, y, z] = posKey.split(",").map(Number);
        } else {
            x = posKey;
        }

        // Validate coordinates
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
            console.warn(
                `SpatialHashGrid: Invalid coordinates in remove(${x},${y},${z})`
            );
            return false;
        }

        // Use hash table for O(1) lookup
        const hashValue = this.hash(x, y, z);
        const hashIndex = hashValue % this.hashTable.length;

        // Check if entry exists at this hash
        if (this.hashTable[hashIndex] === this.HASH_EMPTY) {
            return false; // Not found
        }

        // Start with first entry
        let idx = this.hashTable[hashIndex];
        let prevIdx = null;

        // Check all entries in the collision chain
        while (idx !== this.HASH_EMPTY) {
            const cx = this._coords[idx * 3];
            const cy = this._coords[idx * 3 + 1];
            const cz = this._coords[idx * 3 + 2];

            // Check if coordinates match
            if (cx === x && cy === y && cz === z) {
                // Found the block to remove

                // Get the next index in the collision chain
                const nextIdx = this.collisionTable[idx];

                // Update collision chain links
                if (prevIdx === null) {
                    // This is the first item in the chain
                    // Update the hash table entry to point to the next item
                    this.hashTable[hashIndex] = nextIdx;
                } else {
                    // This is a later item in the chain
                    // Update the previous item to point to the next item
                    this.collisionTable[prevIdx] = nextIdx;
                }

                // For efficiency, we'll move the last block in the array to this position
                // (unless this is already the last block)
                if (idx < this.size - 1) {
                    // Get the last block
                    const lastIdx = this.size - 1;
                    const lastBlockId = this._blocks[lastIdx];
                    const lastX = this._coords[lastIdx * 3];
                    const lastY = this._coords[lastIdx * 3 + 1];
                    const lastZ = this._coords[lastIdx * 3 + 2];

                    // Move the last block to the removed position
                    this._blocks[idx] = lastBlockId;
                    this._coords[idx * 3] = lastX;
                    this._coords[idx * 3 + 1] = lastY;
                    this._coords[idx * 3 + 2] = lastZ;

                    // Update any pointers to the last block
                    const lastHashValue = this.hash(lastX, lastY, lastZ);
                    const lastHashIndex = lastHashValue % this.hashTable.length;

                    // Find the entry for the last block in the hash table
                    if (this.hashTable[lastHashIndex] === lastIdx) {
                        // Direct reference, update hash table
                        this.hashTable[lastHashIndex] = idx;
                    } else {
                        // In a collision chain, find and update the reference
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

                // Decrement size
                this.size--;

                return true;
            }

            // Move to next in collision chain
            prevIdx = idx;
            idx = this.collisionTable[idx];
        }

        // Not found
        return false;
    }

    /**
     * Clear all data from the grid
     * This completely resets the grid to an empty state
     */
    clear() {
        console.log("SpatialHashGrid: Clearing all data");

        // Reset size
        this.size = 0;

        // Reset all arrays
        if (this._blocks) this._blocks.fill(0);
        if (this._coords) this._coords.fill(0);

        // Reset hash tables
        if (this.hashTable) this.hashTable.fill(this.HASH_EMPTY);
        if (this.collisionTable) this.collisionTable.fill(this.HASH_EMPTY);

        console.log("SpatialHashGrid: All data cleared");
    }

    /**
     * Reset the grid to initial state
     * Useful when loading a new world
     */
    reset() {
        // Clear existing data
        this.clear();

        // Reset properties
        this.size = 0;
        this.isProcessing = false;

        // Release TypedArray storage to free memory
        this._blocks = null;
        this._coords = null;
        this.hashTable = null;
        this.collisionTable = null;
        this._capacity = 0;

        // Reinitialize with smaller capacity
        this.initializeArrays(1000);

        console.log("SpatialHashGrid: Reset to initial state");
    }

    /**
     * Dump debug information about the grid state
     * @returns {Object} Debug info object
     */
    getDebugInfo() {
        return {
            size: this.size,
            capacity: this._capacity,
            hashTableSize: this.hashTable ? this.hashTable.length : 0,
            initialized: this._blocks !== null && this._coords !== null,
            sampleBlocks: this.getSampleBlocks(5),
        };
    }

    /**
     * Get sample blocks for debugging
     * @param {number} count Number of blocks to sample
     * @returns {Array} Sample blocks
     */
    getSampleBlocks(count = 5) {
        const samples = [];

        if (!this._blocks || !this._coords || this.size === 0) {
            return samples;
        }

        const sampleCount = Math.min(count, this.size);
        for (let i = 0; i < sampleCount; i++) {
            samples.push({
                index: i,
                position: [
                    this._coords[i * 3],
                    this._coords[i * 3 + 1],
                    this._coords[i * 3 + 2],
                ],
                blockId: this._blocks[i],
            });
        }

        return samples;
    }

    /**
     * Expand the capacity of the grid's internal arrays
     * Called automatically when the grid is full
     * @private
     */
    _expandCapacity() {
        // Double capacity
        const newCapacity = this._capacity * 2;
        const newBlocks = new Uint32Array(newCapacity);
        const newCoords = new Int32Array(newCapacity * 3);

        // Copy existing data
        newBlocks.set(this._blocks);
        newCoords.set(this._coords);

        // Update references
        this._blocks = newBlocks;
        this._coords = newCoords;

        // Resize collision table
        const newCollisionTable = new Uint32Array(newCapacity);
        newCollisionTable.fill(this.HASH_EMPTY);
        newCollisionTable.set(this.collisionTable);
        this.collisionTable = newCollisionTable;

        // Rebuild hash table (needs to be larger for reduced collisions)
        const newHashCapacity = Math.ceil(newCapacity * 1.5);
        const newHashTable = new Uint32Array(newHashCapacity);
        newHashTable.fill(this.HASH_EMPTY);

        // Rehash all entries
        for (let i = 0; i < this.size; i++) {
            const ix = this._coords[i * 3];
            const iy = this._coords[i * 3 + 1];
            const iz = this._coords[i * 3 + 2];

            const hashValue = this.hash(ix, iy, iz);
            const hashIndex = hashValue % newHashCapacity;

            // Add to hash table with collision handling
            const prevHeadIndex = newHashTable[hashIndex];
            newHashTable[hashIndex] = i;
            this.collisionTable[i] = prevHeadIndex;
        }

        // Update hash table and capacity
        this.hashTable = newHashTable;
        this._capacity = newCapacity;

        console.log(`SpatialHashGrid: Expanded capacity to ${newCapacity}`);
    }
}
