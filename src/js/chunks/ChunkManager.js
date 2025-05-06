

import * as THREE from "three";
import BlockTypeRegistry from "../blocks/BlockTypeRegistry";
import Chunk from "./Chunk";
import ChunkMeshManager from "./ChunkMeshManager";
import {
    CHUNKS_NUM_TO_BUILD_AT_ONCE,
    CHUNK_INDEX_RANGE,
    CHUNK_SIZE,
} from "./ChunkConstants";
/**
 * Manages chunks in the world
 */
class ChunkManager {
    constructor(scene) {
        this._chunks = new Map();
        this._renderChunkQueue = [];
        this._pendingRenderChunks = new Set();
        this._chunkRemeshOptions = new Map();
        this._scene = scene;
        this._chunkMeshManager = new ChunkMeshManager();
        this._viewDistance = 128;
        this._viewDistanceEnabled = true;
        this._blockTypeCache = new Map();
        this._isBulkLoading = false; // Flag to indicate if we're in a bulk loading operation
        this._deferredMeshChunks = new Set(); // Store chunks that need meshes but are deferred
        this._loadingPriorityDistance = 32; // Chunks within this distance get immediate meshes during loading
        this._lastMeshBuildTime = null; // Added for rate limiting
        this._meshBuildCount = 0;
        this._meshBuildStartTime = null;
        this._chunkLastMeshedTime = null;
        this._chunkLastQueuedTime = null;

        this._setupBlockTypeChangeListener();
    }
    /**
     * Set up console filtering to reduce noise in the console output
     * Call this method once during initialization
     */
    setupConsoleFiltering() {

        const originalConsoleTime = console.time;
        const originalConsoleTimeEnd = console.timeEnd;
        const originalConsoleLog = console.log;

        const timeFilterPatterns = [
            /getTextureUVCoordinateSync/,
            /calculateVertexColor/,
        ];
        const logFilterPatterns = [
            /buildMeshes-.+-getTextureUVCoordinateSync/,
            /buildMeshes-.+-calculateVertexColor/,
        ];

        console.time = function (label) {
            if (timeFilterPatterns.some((pattern) => pattern.test(label))) {
                return; // Skip this timer
            }
            originalConsoleTime.call(console, label);
        };

        console.timeEnd = function (label) {
            if (timeFilterPatterns.some((pattern) => pattern.test(label))) {
                return; // Skip this timer
            }
            originalConsoleTimeEnd.call(console, label);
        };

        console.log = function (...args) {
            if (args.length > 0 && typeof args[0] === "string") {
                if (
                    logFilterPatterns.some((pattern) => pattern.test(args[0]))
                ) {
                    return; // Skip this log
                }
            }
            originalConsoleLog.apply(console, args);
        };
        console.log("Console filtering set up to reduce noise");
    }
    /**
     * Get the chunk mesh manager
     * @returns {ChunkMeshManager} The chunk mesh manager
     */
    get chunkMeshManager() {
        return this._chunkMeshManager;
    }
    /**
     * Get the block ID at a global coordinate
     * @param {Object} globalCoordinate - The global coordinate
     * @returns {number} The block ID
     */
    getGlobalBlockId(globalCoordinate) {
        const originCoordinate =
            Chunk.globalCoordinateToOriginCoordinate(globalCoordinate);
        const chunkId = Chunk.getChunkId(originCoordinate);
        const chunk = this._chunks.get(chunkId);
        if (!chunk) {
            return 0; // no chunk, no block, 0 is reserved for air/no-block.
        }
        return chunk.getLocalBlockId(
            Chunk.globalCoordinateToLocalCoordinate(globalCoordinate)
        );
    }
    /**
     * Get the block type at a global coordinate
     * @param {Object} globalCoordinate - The global coordinate
     * @returns {BlockType|undefined} The block type
     */
    getGlobalBlockType(globalCoordinate) {

        const cacheKey = `${globalCoordinate.x},${globalCoordinate.y},${globalCoordinate.z}`;

        if (this._blockTypeCache.has(cacheKey)) {
            const cachedType = this._blockTypeCache.get(cacheKey);

            const currentId = this.getGlobalBlockId(globalCoordinate);


            if (cachedType && currentId === 0) {
                console.log(
                    `Cache hit but block was removed at ${cacheKey} - invalidating cache`
                );
                this._blockTypeCache.delete(cacheKey);
            } else {
                return cachedType;
            }
        }
        const blockId = this.getGlobalBlockId(globalCoordinate);
        const blockType = BlockTypeRegistry.instance.getBlockType(blockId);

        this._blockTypeCache.set(cacheKey, blockType);
        return blockType;
    }
    /**
     * Mark a chunk for remeshing
     * @param {string} chunkId - The chunk ID to remesh
     * @param {Object} options - Options for remeshing
     * @param {Array<Object>} options.blockCoordinates - Specific block coordinates to update
     * @param {boolean} options.skipNeighbors - Whether to skip neighbor chunk updates
     */
    markChunkForRemesh(chunkId, options = {}) {
        if (!this._chunks.has(chunkId)) {
            return;
        }
        const chunk = this._chunks.get(chunkId);

        if (this._chunkRemeshOptions.has(chunkId)) {
            const existingOptions = this._chunkRemeshOptions.get(chunkId);

            if (options.blockCoordinates && existingOptions.blockCoordinates) {
                const existingCoords = existingOptions.blockCoordinates;

                options.blockCoordinates.forEach((coord) => {

                    const exists = existingCoords.some(
                        (existing) =>
                            existing.x === coord.x &&
                            existing.y === coord.y &&
                            existing.z === coord.z
                    );
                    if (!exists) {
                        existingCoords.push(coord);
                    }
                });
            } else if (options.blockCoordinates) {
                existingOptions.blockCoordinates = options.blockCoordinates;
            }

            if (options.skipNeighbors !== undefined) {
                existingOptions.skipNeighbors = options.skipNeighbors;
            }
        } else {

            this._chunkRemeshOptions.set(chunkId, { ...options });
        }

        this.queueChunkForRender(chunk, {
            skipNeighbors: options.skipNeighbors,
        });
    }
    /**
     * Check if a block exists at a global coordinate
     * @param {Object} globalCoordinate - The global coordinate
     * @returns {boolean} True if a block exists
     */
    hasBlock(globalCoordinate) {
        return !!this.getGlobalBlockType(globalCoordinate);
    }
    /**
     * Process the render queue
     * @param {boolean} prioritizeCloseChunks - If true, prioritize chunks closer to the camera
     */
    processRenderQueue(prioritizeCloseChunks = false) {

        if (this._renderChunkQueue.length === 0) {
            return;
        }


        const maxChunksToBuild = prioritizeCloseChunks
            ? Math.min(5, CHUNKS_NUM_TO_BUILD_AT_ONCE)
            : Math.min(20, CHUNKS_NUM_TO_BUILD_AT_ONCE);

        if (Math.random() < 0.01 || this._renderChunkQueue.length > 100) {
            console.log(
                `Processing render queue with ${this._renderChunkQueue.length} chunks (max: ${maxChunksToBuild} at once)`
            );
        }

        if (prioritizeCloseChunks && this._scene.camera) {
            const cameraPos = this._scene.camera.position;


            this._renderChunkQueue = this._renderChunkQueue.map((item) => {
                if (typeof item === "object" && item !== null && item.chunkId) {

                    if (item.options && Object.keys(item.options).length > 0) {
                        if (!this._chunkRemeshOptions.has(item.chunkId)) {
                            this._chunkRemeshOptions.set(
                                item.chunkId,
                                item.options
                            );
                        } else {

                            const existingOptions =
                                this._chunkRemeshOptions.get(item.chunkId);
                            this._chunkRemeshOptions.set(item.chunkId, {
                                ...existingOptions,
                                ...item.options,
                            });
                        }
                    }
                    return item.chunkId;
                }
                return item;
            });

            this._renderChunkQueue.sort((a, b) => {
                const chunkA = this._chunks.get(a);
                const chunkB = this._chunks.get(b);
                if (!chunkA || !chunkB) return 0;
                const originA = chunkA.originCoordinate;
                const originB = chunkB.originCoordinate;

                const distA = Math.sqrt(
                    Math.pow(originA.x + CHUNK_SIZE / 2 - cameraPos.x, 2) +
                        Math.pow(originA.y + CHUNK_SIZE / 2 - cameraPos.y, 2) +
                        Math.pow(originA.z + CHUNK_SIZE / 2 - cameraPos.z, 2)
                );
                const distB = Math.sqrt(
                    Math.pow(originB.x + CHUNK_SIZE / 2 - cameraPos.x, 2) +
                        Math.pow(originB.y + CHUNK_SIZE / 2 - cameraPos.y, 2) +
                        Math.pow(originB.z + CHUNK_SIZE / 2 - cameraPos.z, 2)
                );
                return distA - distB;
            });
            console.log(
                `Sorted ${this._renderChunkQueue.length} chunks by distance to camera`
            );
        } else {

            this._renderChunkQueue = this._renderChunkQueue.map((item) => {
                if (typeof item === "object" && item !== null && item.chunkId) {

                    return item.chunkId;
                }
                return item;
            });
        }

        const chunksToProcess = this._renderChunkQueue.splice(
            0,
            maxChunksToBuild
        );

        for (const chunkId of chunksToProcess) {

            const chunk = this._chunks.get(chunkId);

            this._pendingRenderChunks.delete(chunkId);

            if (chunk) {

                this._renderChunk(chunk);
            }
        }

        if (this._renderChunkQueue.length > 0) {

            window.requestAnimationFrame(() =>
                this.processRenderQueue(prioritizeCloseChunks)
            );
        }
    }
    /**
     * Set bulk loading mode - when true, only meshes chunks close to the camera
     * @param {boolean} isLoading - Whether we're in bulk loading mode
     * @param {number} priorityDistance - Priority distance for immediate meshing (optional)
     */
    setBulkLoadingMode(isLoading, priorityDistance = 32) {

        const wasLoading = this._isBulkLoading;

        this._isBulkLoading = isLoading;
        if (priorityDistance !== undefined) {

            this._loadingPriorityDistance = Math.max(16, priorityDistance);
        }
        if (isLoading) {
            console.log(
                `ChunkManager: Bulk loading mode enabled. Only meshing chunks within ${this._loadingPriorityDistance} blocks of camera.`
            );


            if (this._chunks.size > 0 && this._renderChunkQueue.length === 0) {
                this._forceClosestChunksVisible();
            }
        } else if (wasLoading && this._deferredMeshChunks.size > 0) {
            console.log(
                `ChunkManager: Bulk loading complete. Processing ${this._deferredMeshChunks.size} deferred chunk meshes.`
            );

            this._processDeferredChunks();
        }
    }
    /**
     * Force the closest chunks to be visible immediately
     * This prevents blank screens during loading
     * @private
     */
    _forceClosestChunksVisible() {
        if (!this._scene.camera || this._chunks.size === 0) return;
        console.log("Forcing closest chunks to be visible");
        const cameraPos = this._scene.camera.position;
        const MINIMUM_VISIBLE_CHUNKS = 8; // Always show at least this many chunks

        const sortedChunks = Array.from(this._chunks.values())
            .map((chunk) => {
                const pos = new THREE.Vector3(
                    chunk.originCoordinate.x,
                    chunk.originCoordinate.y,
                    chunk.originCoordinate.z
                );
                const distance = pos.distanceTo(cameraPos);
                return { chunk, distance };
            })
            .sort((a, b) => a.distance - b.distance);

        const chunksToProcess = sortedChunks.slice(0, MINIMUM_VISIBLE_CHUNKS);
        for (const { chunk, distance } of chunksToProcess) {
            console.log(
                `Forcing mesh for chunk ${
                    chunk.chunkId
                } at distance ${distance.toFixed(1)}`
            );

            if (!this._pendingRenderChunks.has(chunk.chunkId)) {

                this._renderChunkQueue.unshift(chunk.chunkId);
                this._pendingRenderChunks.add(chunk.chunkId);

                this._chunkRemeshOptions.set(chunk.chunkId, {
                    forceMesh: true,
                });
            }
        }
    }
    /**
     * Process chunks that were deferred during bulk loading
     * @private
     */
    _processDeferredChunks() {
        if (this._deferredMeshChunks.size === 0) {
            return;
        }
        console.log(
            `Processing ${this._deferredMeshChunks.size} deferred chunks in larger batches`
        );
        const cameraPos = this._scene.camera
            ? this._scene.camera.position
            : new THREE.Vector3();
        const deferredChunks = Array.from(this._deferredMeshChunks);

        deferredChunks.sort((a, b) => {
            const chunkA = this._chunks.get(a);
            const chunkB = this._chunks.get(b);
            if (!chunkA || !chunkB) return 0;
            const distA = new THREE.Vector3(
                chunkA.originCoordinate.x + CHUNK_SIZE / 2,
                chunkA.originCoordinate.y + CHUNK_SIZE / 2,
                chunkA.originCoordinate.z + CHUNK_SIZE / 2
            ).distanceToSquared(cameraPos);
            const distB = new THREE.Vector3(
                chunkB.originCoordinate.x + CHUNK_SIZE / 2,
                chunkB.originCoordinate.y + CHUNK_SIZE / 2,
                chunkB.originCoordinate.z + CHUNK_SIZE / 2
            ).distanceToSquared(cameraPos);
            return distA - distB;
        });

        const BATCH_SIZE = 20; // Process 20 chunks at a time
        let processedCount = 0;

        const processBatch = () => {

            if (processedCount >= deferredChunks.length) {
                console.log(
                    `ChunkManager: All ${deferredChunks.length} deferred chunks processed.`
                );
                return;
            }

            const endIndex = Math.min(
                processedCount + BATCH_SIZE,
                deferredChunks.length
            );
            const batchChunks = deferredChunks.slice(processedCount, endIndex);
            console.log(
                `Processing batch ${
                    Math.floor(processedCount / BATCH_SIZE) + 1
                }: ${batchChunks.length} chunks (${
                    processedCount + 1
                }-${endIndex} of ${deferredChunks.length})`
            );

            for (const chunkId of batchChunks) {
                if (this._pendingRenderChunks.has(chunkId)) continue;

                this._renderChunkQueue.push(chunkId);
                this._pendingRenderChunks.add(chunkId);

                this._chunkRemeshOptions.set(chunkId, {
                    forceMesh: true,
                    forceCompleteRebuild: true,
                });

                this._deferredMeshChunks.delete(chunkId);
            }

            processedCount = endIndex;


            const delay = Math.max(100, batchChunks.length * 5); // 5ms per chunk, minimum 100ms
            setTimeout(processBatch, delay);
        };

        processBatch();
    }
    /**
     * Render a chunk
     * @param {Chunk} chunk - The chunk to render
     * @private
     */
    _renderChunk(chunk) {

        if (!this._lastMeshBuildTime) {
            this._lastMeshBuildTime = performance.now();
            this._meshBuildCount = 0;
            this._meshBuildStartTime = performance.now();
        } else {
            const now = performance.now();
            const elapsed = now - this._lastMeshBuildTime;

            const timeBetweenBuilds =
                this._renderChunkQueue.length > 10 ? 5 : 20;
            if (elapsed < timeBetweenBuilds) {

                window.requestAnimationFrame(() => this._renderChunk(chunk));
                return;
            }

            this._lastMeshBuildTime = now;
            this._meshBuildCount++;

            if (this._meshBuildCount % 100 === 0) {
                const totalElapsed = (now - this._meshBuildStartTime) / 1000;
                const rate = this._meshBuildCount / totalElapsed;
                console.log(
                    `Built ${
                        this._meshBuildCount
                    } chunk meshes at ${rate.toFixed(1)} meshes/sec`
                );
            }
        }

        const options = this._chunkRemeshOptions
            ? this._chunkRemeshOptions.get(chunk.chunkId) || {}
            : {};
        const hasBlockCoords = !!(
            options.blockCoordinates && options.blockCoordinates.length > 0
        );
        const hasExistingMeshes = !!(chunk._solidMesh || chunk._liquidMesh);
        const forceCompleteRebuild = !!options.forceCompleteRebuild;

        const isFirstBlockInChunk =
            chunk._blocks.filter((id) => id !== 0).length <= 1;

        if (this._isBulkLoading && !options.forceMesh) {

            const cameraPos = this._scene.camera
                ? this._scene.camera.position
                : new THREE.Vector3();
            const chunkPos = new THREE.Vector3(
                chunk.originCoordinate.x + CHUNK_SIZE / 2,
                chunk.originCoordinate.y + CHUNK_SIZE / 2,
                chunk.originCoordinate.z + CHUNK_SIZE / 2
            );
            const distance = chunkPos.distanceTo(cameraPos);

            if (distance > this._loadingPriorityDistance) {

                this._deferredMeshChunks.add(chunk.chunkId);


                if (!hasExistingMeshes && !isFirstBlockInChunk) {
                    console.log(
                        `Deferred mesh creation for distant chunk ${
                            chunk.chunkId
                        } at distance ${distance.toFixed(1)}`
                    );
                    return; // Skip mesh creation for now
                }
            }
        }

        try {


            if (
                forceCompleteRebuild ||
                isFirstBlockInChunk ||
                !hasExistingMeshes ||
                !hasBlockCoords
            ) {

                chunk.buildMeshes(this);

                const shouldBeVisible = this._isChunkVisible(chunk.chunkId);
                chunk.visible = shouldBeVisible;

                if (this._chunkRemeshOptions) {
                    this._chunkRemeshOptions.delete(chunk.chunkId);
                }
            } else {

                chunk.buildMeshes(this);

                const shouldBeVisible = this._isChunkVisible(chunk.chunkId);
                chunk.visible = shouldBeVisible;

                if (this._chunkRemeshOptions) {
                    this._chunkRemeshOptions.delete(chunk.chunkId);
                }
            }

            if (!this._chunkLastMeshedTime) {
                this._chunkLastMeshedTime = new Map();
            }
            this._chunkLastMeshedTime.set(chunk.chunkId, performance.now());
        } catch (error) {
            console.error(
                `Error initiating mesh building for chunk ${chunk.chunkId}:`,
                error
            );
        }
    }
    /**
     * Clear the block type cache for a region around a global coordinate
     * @param {Object} globalCoordinate - The global coordinate
     * @param {number} radius - The radius to clear (default: 1)
     */
    clearBlockTypeCache(globalCoordinate, radius = 1) {
        if (!this._blockTypeCache) {
            return;
        }

        const shouldLog = false; //radius > 1 && Math.random() < 0.01; // Only log 1% of clearing operations

        if (radius === 0) {
            const exactKey = `${globalCoordinate.x},${globalCoordinate.y},${globalCoordinate.z}`;
            if (this._blockTypeCache.has(exactKey)) {
                this._blockTypeCache.delete(exactKey);
            }
            return;
        }

        let entriesCleared = shouldLog ? 0 : -1;

        for (let x = -radius; x <= radius; x++) {
            for (let y = -radius; y <= radius; y++) {
                for (let z = -radius; z <= radius; z++) {
                    const cacheKey = `${globalCoordinate.x + x},${
                        globalCoordinate.y + y
                    },${globalCoordinate.z + z}`;
                    if (this._blockTypeCache.has(cacheKey)) {
                        this._blockTypeCache.delete(cacheKey);
                        if (shouldLog) entriesCleared++;
                    }
                }
            }
        }
        if (shouldLog && entriesCleared > 0) {
            console.log(
                `Cleared ${entriesCleared} cache entries around (${globalCoordinate.x},${globalCoordinate.y},${globalCoordinate.z})`
            );
        }
    }
    /**
     * Update a block
     * @param {Object} blockData - The block data
     * @param {number} blockData.id - The block ID
     * @param {Object} blockData.globalCoordinate - The global coordinate
     */
    updateBlock(blockData) {

        const { id, globalCoordinate } = blockData;
        const originCoordinate =
            Chunk.globalCoordinateToOriginCoordinate(globalCoordinate);
        const chunkId = Chunk.getChunkId(originCoordinate);
        const chunk = this._chunks.get(chunkId);
        if (!chunk) {

            return;
        }

        const localCoordinate =
            Chunk.globalCoordinateToLocalCoordinate(globalCoordinate);
        const currentBlockId = chunk.getLocalBlockId(localCoordinate);
        const isBlockRemoval = currentBlockId !== 0 && id === 0;


        const cacheRadius = isBlockRemoval ? 2 : 1;

        this.clearBlockTypeCache(globalCoordinate, cacheRadius);

        if (isBlockRemoval) {


            const isOnChunkBoundaryX =
                localCoordinate.x === 0 ||
                localCoordinate.x === CHUNK_INDEX_RANGE;
            const isOnChunkBoundaryY =
                localCoordinate.y === 0 ||
                localCoordinate.y === CHUNK_INDEX_RANGE;
            const isOnChunkBoundaryZ =
                localCoordinate.z === 0 ||
                localCoordinate.z === CHUNK_INDEX_RANGE;

            const buildKey = (x, y, z) => `${x},${y},${z}`;

            const neighbors = [
                [1, 0, 0],
                [-1, 0, 0],
                [0, 1, 0],
                [0, -1, 0],
                [0, 0, 1],
                [0, 0, -1],
            ];
            for (const [dx, dy, dz] of neighbors) {
                const neighborX = globalCoordinate.x + dx;
                const neighborY = globalCoordinate.y + dy;
                const neighborZ = globalCoordinate.z + dz;

                const neighborKey = buildKey(neighborX, neighborY, neighborZ);
                if (this._blockTypeCache.has(neighborKey)) {
                    this._blockTypeCache.delete(neighborKey);
                }
            }

            if (isOnChunkBoundaryX) {
                const adjacentX =
                    globalCoordinate.x + (localCoordinate.x === 0 ? -1 : 1);
                this.clearBlockTypeCache(
                    {
                        x: adjacentX,
                        y: globalCoordinate.y,
                        z: globalCoordinate.z,
                    },
                    1
                );
            }
            if (isOnChunkBoundaryY) {
                const adjacentY =
                    globalCoordinate.y + (localCoordinate.y === 0 ? -1 : 1);
                this.clearBlockTypeCache(
                    {
                        x: globalCoordinate.x,
                        y: adjacentY,
                        z: globalCoordinate.z,
                    },
                    1
                );
            }
            if (isOnChunkBoundaryZ) {
                const adjacentZ =
                    globalCoordinate.z + (localCoordinate.z === 0 ? -1 : 1);
                this.clearBlockTypeCache(
                    {
                        x: globalCoordinate.x,
                        y: globalCoordinate.y,
                        z: adjacentZ,
                    },
                    1
                );
            }
        }

        chunk.setBlock(localCoordinate, id, this);

    }
    /**
     * Update a chunk
     * @param {Object} chunkData - The chunk data
     * @param {boolean} chunkData.removed - Whether the chunk was removed
     * @param {Object} chunkData.originCoordinate - The origin coordinate
     * @param {Uint8Array} chunkData.blocks - The blocks
     */
    updateChunk(chunkData) {
        if (chunkData.removed) {
            const chunk = this._chunks.get(
                Chunk.getChunkId(chunkData.originCoordinate)
            );
            if (chunk) {
                this._chunkMeshManager.removeLiquidMesh(chunk);
                this._chunkMeshManager.removeSolidMesh(chunk);
                this._chunks.delete(chunk.chunkId);
            }
        }
        if (chunkData.originCoordinate && chunkData.blocks) {
            const chunk = new Chunk(
                chunkData.originCoordinate,
                chunkData.blocks
            );
            this._chunks.set(chunk.chunkId, chunk);
        }
    }
    /**
     * Update multiple blocks
     * @param {Array} blocks - The blocks to update
     */
    updateBlocks(blocks) {

        blocks.forEach((block) => this.updateBlock(block));

    }
    /**
     * Update multiple chunks
     * @param {Array} chunks - The chunks to update
     */
    updateChunks(chunks) {
        chunks.forEach((chunk) => this.updateChunk(chunk));

        const cameraPos = this._scene.camera
            ? this._scene.camera.position
            : new THREE.Vector3();
        const vec1 = new THREE.Vector3();
        const vec2 = new THREE.Vector3();
        Array.from(this._chunks.values())
            .sort((chunk1, chunk2) => {
                return (
                    vec1
                        .copy(chunk1.originCoordinate)
                        .distanceToSquared(cameraPos) -
                    vec2
                        .copy(chunk2.originCoordinate)
                        .distanceToSquared(cameraPos)
                );
            })
            .forEach((chunk) => {
                const chunkId = Chunk.getChunkId(chunk.originCoordinate);
                if (!this._pendingRenderChunks.has(chunkId)) {
                    this._renderChunkQueue.push(chunkId);
                    this._pendingRenderChunks.add(chunkId);
                }
            });
    }
    /**
     * Set the view distance
     * @param {number} distance - The view distance
     */
    setViewDistance(distance) {
        this._viewDistance = distance;
    }
    /**
     * Enable or disable view distance culling
     * @param {boolean} enabled - Whether view distance culling is enabled
     */
    setViewDistanceEnabled(enabled) {
        this._viewDistanceEnabled = enabled;
        if (!enabled) {

            this._chunks.forEach((chunk) => {
                chunk.visible = true;
            });
        }
    }
    /**
     * Check if a chunk is adjacent to a visible chunk
     * @param {string} chunkKey - The chunk key
     * @param {Set} verifiedVisibleChunks - The verified visible chunks
     * @returns {boolean} True if the chunk is adjacent to a visible chunk
     */
    isAdjacentToVisibleChunk(chunkKey, verifiedVisibleChunks) {
        const [cx, cy, cz] = chunkKey.split(",").map(Number);

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx === 0 && dy === 0 && dz === 0) continue; // Skip self
                    const adjacentKey = `${cx + dx},${cy + dy},${cz + dz}`;
                    if (verifiedVisibleChunks.has(adjacentKey)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }


    forceUpdateAllChunkVisibility(isBulkLoading = false) {
        if (!this._scene.camera) {
            console.error("Cannot update chunk visibility without camera");
            return;
        }
        const cameraPos = this._scene.camera.position;
        let visibleCount = 0;
        let hiddenCount = 0;
        let visibilityChangedCount = 0;
        let forcedToggleCount = 0;


        const boundaryThreshold = 8; // Units in world space

        const effectiveViewDistance = isBulkLoading
            ? Math.min(32, this._viewDistance / 2)
            : this._viewDistance;
        this._chunks.forEach((chunk) => {
            const coord = chunk.originCoordinate;
            const chunkPos = new THREE.Vector3(coord.x, coord.y, coord.z);
            const distance = chunkPos.distanceTo(cameraPos);
            const wasVisible = chunk.visible;

            const shouldBeVisible = distance <= effectiveViewDistance;

            if (isBulkLoading && distance > effectiveViewDistance * 1.5) {

                chunk.visible = false;
                hiddenCount++;
                if (wasVisible) {
                    visibilityChangedCount++;
                }
                return;
            }

            const distanceFromBoundary = Math.abs(
                distance - effectiveViewDistance
            );
            const isNearBoundary = distanceFromBoundary < boundaryThreshold;


            if (isNearBoundary || wasVisible !== shouldBeVisible) {

                if (shouldBeVisible === wasVisible) {

                    chunk.visible = !shouldBeVisible;
                    forcedToggleCount++;
                }

                chunk.visible = shouldBeVisible;
            } else {

                chunk.visible = shouldBeVisible;
            }

            if (shouldBeVisible) {
                visibleCount++;
            } else {
                hiddenCount++;
            }

            if (wasVisible !== shouldBeVisible) {
                visibilityChangedCount++;
            }
        });

        return {
            total: this._chunks.size,
            visible: visibleCount,
            hidden: hiddenCount,
            changed: visibilityChangedCount,
            toggled: forcedToggleCount,
        };
    }
    /**
     * Get a chunk by its key string
     * @param {String} chunkKey - The chunk key in format "x,y,z"
     * @returns {Chunk|null} The chunk or null if not found
     */
    getChunkByKey(chunkKey) {
        if (!chunkKey || typeof chunkKey !== "string") {
            return null;
        }
        return this._chunks.get(chunkKey) || null;
    }
    /**
     * Queue a chunk for rendering
     * @param {Chunk} chunk - The chunk to queue
     * @param {any} options - Options for rendering
     * @param {Boolean} options.skipNeighbors - If true, skip neighbor chunk updates
     */
    queueChunkForRender(chunk, options = {}) {
        if (!chunk) {
            return;
        }

        if (this._pendingRenderChunks.has(chunk.chunkId)) {

            if (options && Object.keys(options).length > 0) {
                const existingOptions =
                    this._chunkRemeshOptions.get(chunk.chunkId) || {};
                this._chunkRemeshOptions.set(chunk.chunkId, {
                    ...existingOptions,
                    ...options,
                });
            }
            return;
        }

        if (!this._chunkLastMeshedTime) {
            this._chunkLastMeshedTime = new Map();
        }
        const now = performance.now();
        const lastMeshedTime =
            this._chunkLastMeshedTime.get(chunk.chunkId) || 0;
        const timeSinceLastMesh = now - lastMeshedTime;


        const hasBlockChanges =
            options.added?.length > 0 || options.removed?.length > 0;
        const isHighPriority =
            options.forceMesh ||
            options.forceCompleteRebuild ||
            hasBlockChanges;

        const minRebuildInterval = hasBlockChanges ? 20 : 100; // Only 20ms cooldown for block changes
        if (timeSinceLastMesh < minRebuildInterval && !isHighPriority) {

            return;
        }

        if (options && Object.keys(options).length > 0) {
            if (!this._chunkRemeshOptions.has(chunk.chunkId)) {
                this._chunkRemeshOptions.set(chunk.chunkId, options);
            } else {

                const existingOptions = this._chunkRemeshOptions.get(
                    chunk.chunkId
                );
                this._chunkRemeshOptions.set(chunk.chunkId, {
                    ...existingOptions,
                    ...options,
                });
            }
        }


        if (hasBlockChanges) {
            this._renderChunkQueue.unshift(chunk.chunkId);
        } else {
            this._renderChunkQueue.push(chunk.chunkId);
        }
        this._pendingRenderChunks.add(chunk.chunkId);

        this._chunkLastQueuedTime = this._chunkLastQueuedTime || new Map();
        this._chunkLastQueuedTime.set(chunk.chunkId, now);
    }
    /**
     * Check if a chunk should be visible based on distance to camera
     * @param {string} chunkId - The chunk ID
     * @returns {boolean} True if the chunk should be visible
     */
    _isChunkVisible(chunkId) {
        const chunk = this._chunks.get(chunkId);
        if (!chunk) return false;

        if (!this._scene || !this._scene.camera) return true;

        const cameraPos = this._scene.camera.position;

        const chunkCenter = new THREE.Vector3(
            chunk.originCoordinate.x + CHUNK_SIZE / 2,
            chunk.originCoordinate.y + CHUNK_SIZE / 2,
            chunk.originCoordinate.z + CHUNK_SIZE / 2
        );

        const distance = chunkCenter.distanceTo(cameraPos);

        const viewDistance = this._viewDistance;

        if (!this._viewDistanceEnabled) return true;

        return distance <= viewDistance;
    }
    /**
     * Set up event listener for block type changes
     * @private
     */
    _setupBlockTypeChangeListener() {

        document.addEventListener("blockTypeChanged", (event) => {
            const blockTypeId = event.detail?.blockTypeId;
            if (blockTypeId) {
                this._handleBlockTypeChanged(blockTypeId);
            }
        });
    }
    /**
     * Handle changes to a block type, forcing updates to chunks that use it
     * @param {number} blockTypeId - The ID of the block type that changed
     * @private
     */
    _handleBlockTypeChanged(blockTypeId) {

        const chunksToUpdate = new Set();

        for (const chunkKey of this._chunks.keys()) {

            if (this._chunks.get(chunkKey).containsBlockType(blockTypeId)) {
                chunksToUpdate.add(chunkKey);
            }
        }


        if (chunksToUpdate.size === 0) {

            for (const chunkKey of this._chunks.keys()) {
                if (this._isChunkVisible(chunkKey)) {
                    chunksToUpdate.add(chunkKey);
                }
            }
        }

        for (const chunkKey of chunksToUpdate) {
            this.markChunkForRemesh(chunkKey, { forceNow: true });
        }

        this.processRenderQueue(true);
    }
}
export default ChunkManager;
