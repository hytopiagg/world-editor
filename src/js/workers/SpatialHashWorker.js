/**
 * SpatialHashWorker.js
 * Web Worker that handles spatial hash grid operations off the main thread.
 * This worker processes terrain blocks and creates a spatial hash grid that
 * can be efficiently used for collision detection and block lookup.
 *
 * Binary-optimized version using TypedArrays.
 */

/* eslint-disable no-restricted-globals */
// Constants for hash table
const HASH_EMPTY = 0xffffffff; // Marker for empty slots
const HASH_PRIME1 = 73856093; // Prime number for spatial hashing
const HASH_PRIME2 = 19349663; // Prime number for spatial hashing
const HASH_PRIME3 = 83492791; // Prime number for spatial hashing

/**
 * Fast 32-bit spatial hash function
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} z - Z coordinate
 * @returns {number} 32-bit hash value
 */
function hash(x, y, z) {
    // Simple and fast spatial hash function
    // Warning: Assumes coordinates are 32-bit integers
    return ((x * HASH_PRIME1) ^ (y * HASH_PRIME2) ^ (z * HASH_PRIME3)) >>> 0; // Force unsigned 32-bit integer
}

// Handle messages from the main thread
self.onmessage = function (event) {
    const { operation, blocks, chunkSize, added, removed, current } =
        event.data;

    // Override chunk size if provided
    const actualChunkSize = chunkSize || 16;

    try {
        // Determine which operation to perform
        let result;
        if (operation === "buildGrid") {
            console.log(
                `[Worker] Starting buildGrid operation with ${blocks?.length || 0} blocks`
            );
            result = buildSpatialGrid(blocks, actualChunkSize);

            // IMPORTANT FIX: Don't transfer the buffers, as this causes issues with undefined values
            // Instead, clone the TypedArrays to ensure proper data transfer
            self.postMessage({
                result: "gridBuilt",
                // Send the complete TypedArrays instead of just the buffers
                blockIds: result.blockIds,
                coordinates: result.coordinates,
                hashTable: result.hashTable,
                collisionTable: result.collisionTable,
                size: result.size,
                stats: result.stats,
                hashConstants: {
                    HASH_EMPTY,
                    HASH_PRIME1,
                    HASH_PRIME2,
                    HASH_PRIME3,
                },
            });

            console.log(
                `[Worker] Sent grid data back to main thread with ${result.size} blocks`
            );
        } else if (operation === "updateGrid") {
            result = updateSpatialGrid(current, added, removed);
            self.postMessage({
                result: "gridUpdated",
                error: result.error,
            });
        } else {
            self.postMessage({
                error: `Unknown operation: ${operation}`,
            });
        }
    } catch (error) {
        console.error(`[Worker] Error in worker: ${error.message}`);
        console.error(error.stack);
        self.postMessage({
            error: error.message,
            stack: error.stack,
        });
    }
};

/**
 * Builds a spatial hash grid from terrain blocks using TypedArrays for performance
 * @param {Array} blocks - Array of [posKey, blockId] entries
 * @param {number} chunkSize - Size of each chunk in the grid
 */
function buildSpatialGrid(blocks, chunkSize) {
    const startTime = performance.now();

    console.log(
        `[Worker] Building spatial grid with ${blocks.length} blocks and chunk size ${chunkSize}`
    );

    // Track stats for debugging
    let airBlocksSkipped = 0;
    let validBlocksProcessed = 0;
    let skippedInvalidKeys = 0;

    // TypedArray approach for better performance
    // This will be transferred back to the main thread
    const blockIds = new Uint32Array(blocks.length);
    const coordinates = new Int32Array(blocks.length * 3);

    // Create hash table for O(1) lookups (1.5x capacity to reduce collisions)
    const hashCapacity = Math.ceil(blocks.length * 1.5);
    const hashTable = new Uint32Array(hashCapacity);
    const collisionTable = new Uint32Array(blocks.length);

    // Initialize hash tables with empty markers
    hashTable.fill(HASH_EMPTY);
    collisionTable.fill(HASH_EMPTY);

    // Track actual block count (may be less than blocks.length due to skipped blocks)
    let blockCount = 0;

    try {
        // Process each block
        for (let i = 0; i < blocks.length; i++) {
            const [posKey, blockId] = blocks[i];

            // Skip air blocks (usually id 0)
            if (blockId === 0 || blockId === null || blockId === undefined) {
                airBlocksSkipped++;
                continue;
            }

            // Parse coordinates from key
            const [x, y, z] = posKey.split(",").map(Number);

            // Skip if coordinates are invalid
            if (isNaN(x) || isNaN(y) || isNaN(z)) {
                skippedInvalidKeys++;
                continue;
            }

            // Store in TypedArray format
            coordinates[blockCount * 3] = x;
            coordinates[blockCount * 3 + 1] = y;
            coordinates[blockCount * 3 + 2] = z;
            blockIds[blockCount] = blockId;

            // Add to hash table
            const hashValue = hash(x, y, z);
            const hashIndex = hashValue % hashCapacity;

            // Check if slot is empty
            if (hashTable[hashIndex] === HASH_EMPTY) {
                // Direct insert
                hashTable[hashIndex] = blockCount;
            } else {
                // Handle collision - add to collision chain
                let currentIdx = hashTable[hashIndex];

                // Find the end of the chain
                while (collisionTable[currentIdx] !== HASH_EMPTY) {
                    currentIdx = collisionTable[currentIdx];
                }

                // Add to end of chain
                collisionTable[currentIdx] = blockCount;
            }

            // Increment block count
            blockCount++;
            validBlocksProcessed++;
        }

        // Actually size the arrays to match the block count
        const actualBlockIds = new Uint32Array(blockCount);
        const actualCoordinates = new Int32Array(blockCount * 3);

        // Copy only the valid blocks
        for (let i = 0; i < blockCount; i++) {
            actualBlockIds[i] = blockIds[i];
            actualCoordinates[i * 3] = coordinates[i * 3];
            actualCoordinates[i * 3 + 1] = coordinates[i * 3 + 1];
            actualCoordinates[i * 3 + 2] = coordinates[i * 3 + 2];
        }

        const endTime = performance.now();
        const processTime = (endTime - startTime) / 1000;

        // Include detailed debug info
        console.log(
            `[Worker] Grid built in ${processTime.toFixed(2)}s with ${blockCount} blocks`
        );
        console.log(
            `[Worker] Stats: ${validBlocksProcessed} valid, ${airBlocksSkipped} air skipped, ${skippedInvalidKeys} invalid keys`
        );

        // Create spatial index data
        const spatialIndex = buildSpatialIndex(
            actualCoordinates,
            blockCount,
            chunkSize
        );

        // Return TypedArrays directly rather than buffers
        return {
            blockIds: actualBlockIds,
            coordinates: actualCoordinates,
            hashTable: hashTable,
            collisionTable: collisionTable,
            size: blockCount,
            stats: {
                processTime,
                validBlocks: validBlocksProcessed,
                airBlocksSkipped,
                skippedInvalidKeys,
                chunksInIndex: Object.keys(spatialIndex).length,
            },
            hashConstants: {
                HASH_EMPTY,
                HASH_PRIME1,
                HASH_PRIME2,
                HASH_PRIME3,
            },
            spatialIndex,
        };
    } catch (error) {
        console.error(`[Worker] Error building spatial grid: ${error.message}`);
        return { error: error.message };
    }
}

/**
 * Builds a spatial index for faster lookups
 * @param {Int32Array} coordinates - Array of x,y,z coordinates
 * @param {number} size - Number of blocks
 * @param {number} chunkSize - Size of each chunk
 * @returns {Object} Serialized spatial index
 */
function buildSpatialIndex(coordinates, size, chunkSize) {
    console.time("worker:buildSpatialIndex");

    // Create an object to hold chunk indices
    // Format: { "chunkX,chunkY,chunkZ": [indices] }
    const index = {};

    // Process each block
    for (let i = 0; i < size; i++) {
        const x = coordinates[i * 3];
        const y = coordinates[i * 3 + 1];
        const z = coordinates[i * 3 + 2];

        // Calculate chunk coordinates
        const chunkX = Math.floor(x / chunkSize);
        const chunkY = Math.floor(y / chunkSize);
        const chunkZ = Math.floor(z / chunkSize);
        const chunkKey = `${chunkX},${chunkY},${chunkZ}`;

        // Get or create array for this chunk
        if (!index[chunkKey]) {
            index[chunkKey] = [];
        }

        // Add block index to chunk
        index[chunkKey].push(i);
    }

    // Count chunks and the average blocks per chunk
    const chunkCount = Object.keys(index).length;
    const avgBlocksPerChunk = size / chunkCount;

    console.timeEnd("worker:buildSpatialIndex");
    console.log(
        `Worker: Built spatial index with ${chunkCount} chunks, avg ${avgBlocksPerChunk.toFixed(1)} blocks/chunk`
    );

    return index;
}

/**
 * Updates the spatial grid with added or removed blocks
 * Note: This is a placeholder for incremental updates
 * @param {Object} data - Update data including blocks to add/remove
 */
function updateSpatialGrid(current, added, removed) {
    // Will be implemented for incremental updates
    console.log("[Worker] updateSpatialGrid not fully implemented yet");
    return { error: "updateSpatialGrid not fully implemented" };
}
/* eslint-enable no-restricted-globals */
