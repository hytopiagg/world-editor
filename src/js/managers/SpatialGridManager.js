import * as THREE from "three";
import { CHUNK_SIZE } from "../constants/terrain";
import { SpatialHashGrid } from "../chunks/SpatialHashGrid";
/**
 * SpatialGridManager provides a higher-level interface for managing the spatial hash grid
 * It handles batched updates, optimized raycasting, and other operations
 */

let managerInstance = null;
class SpatialGridManager {
    constructor(loadingManager) {
        if (managerInstance) {
            if (loadingManager && !managerInstance.loadingManager) {
                managerInstance.loadingManager = loadingManager;
            }
            return managerInstance;
        }

        this.spatialHashGrid = new SpatialHashGrid({ chunkSize: CHUNK_SIZE });
        this.loadingManager = loadingManager;
        this.isProcessing = false; // Flag to track if processing is happening
        this.lastFrustumUpdate = 0;
        this.chunksInFrustum = new Set(); // Set of chunk keys in frustum

        this.perfMetrics = {
            lastUpdateTime: 0,
            blockCount: 0,
            updateCount: 0,
        };

        managerInstance = this;
        console.log(
            `SpatialGridManager singleton instance created with chunk size ${CHUNK_SIZE}`
        );
    }
    /**
     * Get chunks that are visible within the camera frustum
     * @param {THREE.Camera} camera - The camera to use
     * @param {number} maxDistance - Maximum distance to check (defaults to view distance)
     * @returns {Set<string>} - Set of chunk keys in the frustum
     */
    getChunksInFrustum(camera, maxDistance = 64) {
        if (!camera) {
            console.warn("No camera provided for getChunksInFrustum");
            return new Set();
        }
        const start = performance.now();

        const frustum = new THREE.Frustum();
        const projScreenMatrix = new THREE.Matrix4();

        projScreenMatrix.multiplyMatrices(
            camera.projectionMatrix,
            camera.matrixWorldInverse
        );
        frustum.setFromProjectionMatrix(projScreenMatrix);

        const cameraPosition = camera.position.clone();

        const chunksInFrustum = new Set();

        const cameraChunkX = Math.floor(cameraPosition.x / CHUNK_SIZE);
        const cameraChunkY = Math.floor(cameraPosition.y / CHUNK_SIZE);
        const cameraChunkZ = Math.floor(cameraPosition.z / CHUNK_SIZE);

        chunksInFrustum.add(`${cameraChunkX},${cameraChunkY},${cameraChunkZ}`);

        const maxChunks = Math.ceil(maxDistance / CHUNK_SIZE);

        for (let shell = 0; shell <= 2; shell++) {
            const shellSize = shell * Math.ceil(maxChunks / 3);

            for (
                let dx = -shellSize;
                dx <= shellSize;
                dx += shell === 0 ? 1 : 2
            ) {
                for (
                    let dy = -shellSize;
                    dy <= shellSize;
                    dy += shell === 0 ? 1 : 2
                ) {
                    for (
                        let dz = -shellSize;
                        dz <= shellSize;
                        dz += shell === 0 ? 1 : 2
                    ) {
                        if (
                            shell > 0 &&
                            Math.abs(dx) < shellSize &&
                            Math.abs(dy) < shellSize &&
                            Math.abs(dz) < shellSize
                        ) {
                            continue;
                        }

                        const cx = cameraChunkX + dx;
                        const cy = cameraChunkY + dy;
                        const cz = cameraChunkZ + dz;

                        const chunkCenter = new THREE.Vector3(
                            cx * CHUNK_SIZE + CHUNK_SIZE / 2,
                            cy * CHUNK_SIZE + CHUNK_SIZE / 2,
                            cz * CHUNK_SIZE + CHUNK_SIZE / 2
                        );

                        const distance = chunkCenter.distanceTo(cameraPosition);

                        if (distance > maxDistance) {
                            continue;
                        }

                        if (distance < CHUNK_SIZE * 2) {
                            chunksInFrustum.add(`${cx},${cy},${cz}`);
                            continue;
                        }

                        if (frustum.containsPoint(chunkCenter)) {
                            chunksInFrustum.add(`${cx},${cy},${cz}`);
                        }
                    }
                }
            }
        }

        const end = performance.now();
        const duration = end - start;
        if (duration > 5) {
            console.log(
                `Frustum check took ${duration.toFixed(2)}ms for ${
                    chunksInFrustum.size
                } chunks`
            );
        }
        return chunksInFrustum;
    }
    /**
     * Update the frustum cache - should be called regularly when camera moves
     * @param {THREE.Camera} camera - The camera to use
     * @param {number} maxDistance - Maximum distance to check
     */
    updateFrustumCache(camera, maxDistance = 64) {
        const now = performance.now();

        if (now - this.lastFrustumUpdate < 100) {
            return;
        }
        this.lastFrustumUpdate = now;
        this.chunksInFrustum = this.getChunksInFrustum(camera, maxDistance);
    }
    /**
     * Update blocks within the camera frustum only
     * @param {Object} terrainBlocks - Object containing all blocks in the terrain
     * @param {THREE.Camera} camera - The camera to use
     * @param {Object} options - Options for updating
     */
    updateInFrustum(terrainBlocks, camera, options = {}) {
        console.log("SpatialGridManager: Updating blocks in frustum");
        if (!camera) {
            console.warn("No camera provided for updateInFrustum");
            return Promise.resolve();
        }
        if (!terrainBlocks || typeof terrainBlocks !== "object") {
            console.warn("Invalid terrain blocks provided for updateInFrustum");
            return Promise.resolve();
        }
        const start = performance.now();

        this.isProcessing = true;
        try {
            this.updateFrustumCache(camera, options.maxDistance || 64);

            if (this.chunksInFrustum.size === 0) {
                this.isProcessing = false;
                return Promise.resolve();
            }

            const frustumBlocks = {};
            let blockCount = 0;

            const chunksInFrustumSet = this.chunksInFrustum;

            for (const [posKey, blockId] of Object.entries(terrainBlocks)) {
                const [x, y, z] = posKey.split(",").map(Number);

                const chunkX = Math.floor(x / CHUNK_SIZE);
                const chunkY = Math.floor(y / CHUNK_SIZE);
                const chunkZ = Math.floor(z / CHUNK_SIZE);
                const chunkKey = `${chunkX},${chunkY},${chunkZ}`;

                if (chunksInFrustumSet.has(chunkKey)) {
                    frustumBlocks[posKey] = blockId;
                    blockCount++;
                }
            }

            if (blockCount === 0) {
                this.isProcessing = false;
                return Promise.resolve();
            }

            const self = this;

            return this.updateFromTerrain(frustumBlocks, options)
                .then(() => {})
                .catch((error) => {
                    console.error("Error in updateInFrustum:", error);
                })
                .finally(() => {
                    self.isProcessing = false;
                });
        } catch (error) {
            console.error("Exception in updateInFrustum:", error);
            this.isProcessing = false;
            return Promise.resolve();
        }
    }
    /**
     * Update the spatial hash grid with all blocks from the terrain
     * @param {Object} terrainBlocks - Object containing all blocks in the terrain
     * @param {Object} options - Options for updating
     * @param {boolean} options.showLoadingScreen - Whether to show a loading screen
     * @param {number} options.batchSize - Number of blocks to process in each batch
     */
    async updateFromTerrain(terrainBlocks, options = {}) {
        const {
            force = false,
            showLoadingScreen = false,
            message = "Building spatial index...",
        } = options;

        if (this.isProcessing && !force) {
            console.log(
                "SpatialGridManager: Already processing a grid update, skipped"
            );
            return;
        }

        this.isProcessing = true;

        if (
            showLoadingScreen &&
            this.loadingManager &&
            typeof this.loadingManager.showLoadingScreen === "function"
        ) {
            this.loadingManager.showLoadingScreen(message);
        }

        const blocks = Object.entries(terrainBlocks);
        console.log(
            `SpatialGridManager: Updating from terrain with ${blocks.length.toLocaleString()} blocks ${
                force ? "(FORCED)" : ""
            }`
        );

        if (force) {
            this.spatialHashGrid.clear();
        }

        let workerSuccess = false;
        try {
            workerSuccess = await this.processWithWorker(blocks);
        } catch (error) {
            console.error(
                "SpatialGridManager: Worker error, falling back to direct processing",
                error
            );
        }

        if (!workerSuccess) {
            console.log(
                "SpatialGridManager: Using direct fallback for block processing"
            );
            this.buildDirectly(blocks);
        }

        this.isProcessing = false;

        if (
            showLoadingScreen &&
            this.loadingManager &&
            typeof this.loadingManager.hideLoadingScreen === "function"
        ) {
            this.loadingManager.hideLoadingScreen();
        }
    }
    /**
     * Build the spatial grid directly (fallback if worker fails)
     * @param {Array} blocks - Block entries
     * @private
     */
    buildDirectly(blocks) {
        console.log(
            `SpatialGridManager: Building spatial grid directly with ${blocks.length} blocks`
        );

        this.spatialHashGrid.clear();

        const batchSize = 1000;
        const totalBatches = Math.ceil(blocks.length / batchSize);

        const firstBatch = blocks.slice(0, batchSize);
        this.processBatch(firstBatch);

        if (blocks.length > batchSize) {
            let batchIndex = 1;
            const processNextBatch = () => {
                const start = batchIndex * batchSize;
                const end = Math.min(start + batchSize, blocks.length);
                const batch = blocks.slice(start, end);
                this.processBatch(batch);
                batchIndex++;

                if (batchIndex % 10 === 0 || batchIndex === totalBatches) {
                    const progress = Math.round(
                        (batchIndex / totalBatches) * 100
                    );
                    console.log(
                        `SpatialGridManager: Processed ${batchIndex} of ${totalBatches} batches (${progress}%)`
                    );
                }

                if (batchIndex < totalBatches) {
                    setTimeout(processNextBatch, 0);
                } else {
                    console.log(
                        `SpatialGridManager: Direct processing complete, added ${this.spatialHashGrid.size} blocks`
                    );
                }
            };

            setTimeout(processNextBatch, 0);
        }
    }
    /**
     * Process a batch of blocks
     * @param {Array} batch - Batch of blocks to process
     * @private
     */
    processBatch(batch) {
        for (const [posKey, blockId] of batch) {
            if (blockId === 0 || blockId === null || blockId === undefined) {
                continue;
            }

            this.spatialHashGrid.set(posKey, blockId);
        }
    }
    /**
     * Update specific blocks in the spatial hash grid
     * @param {Array} addedBlocks - Array of blocks to add
     * @param {Array} removedBlocks - Array of blocks to remove
     * @param {Object} options - Options for updating
     */
    updateBlocks(addedBlocks = [], removedBlocks = [], options = {}) {
        if (addedBlocks.length === 0 && removedBlocks.length === 0) {
            return;
        }

        if (!this.spatialHashGrid) {
            console.warn("Creating new spatial hash grid");
            this.spatialHashGrid = new SpatialHashGrid();
        }

        if (addedBlocks.length > 0) {
            for (const block of addedBlocks) {
                let blockId, x, y, z;

                if (Array.isArray(block)) {
                    const [posKey, id] = block;
                    [x, y, z] = posKey.split(",").map(Number);
                    blockId = id;
                } else if (block.position) {
                    [x, y, z] = block.position;
                    blockId = block.id;
                } else if (block.x !== undefined) {
                    x = block.x;
                    y = block.y;
                    z = block.z;
                    blockId = block.id || block.blockId;
                }

                if (
                    blockId === 0 ||
                    blockId === undefined ||
                    blockId === null
                ) {
                    continue;
                }

                console.log(
                    "setting block in spatial hash grid:",
                    x,
                    y,
                    z,
                    blockId
                );
                this.spatialHashGrid.set(x, y, z, blockId);
            }
        }

        if (removedBlocks.length > 0) {
            for (const block of removedBlocks) {
                let x, y, z;

                if (Array.isArray(block)) {
                    const [posKey] = block;
                    [x, y, z] = posKey.split(",").map(Number);
                } else if (block.position) {
                    [x, y, z] = block.position;
                } else if (block.x !== undefined) {
                    x = block.x;
                    y = block.y;
                    z = block.z;
                }

                this.spatialHashGrid.remove(x, y, z);
            }
        }
    }
    /**
     * Perform a raycast against the spatial hash grid
     * @param {THREE.Raycaster} raycaster - The raycaster to use
     * @param {THREE.Camera} camera - The camera to use
     * @param {Object} options - Options for the raycast
     * @returns {Object|null} - Raycast result with point, normal, block position, and blockId
     */
    raycast(raycaster, camera, options = {}) {
        if (!raycaster || !camera) return null;

        const forceDebug = false; // Changed from true to false to disable debug logging
        const {
            maxDistance = 32,
            prioritizeBlocks = true, // Default to prioritizing blocks
            gridSize = 256,
            recentlyPlacedBlocks = new Set(),
            debug = forceDebug, // Enable for detailed debugging
        } = options;

        if (!this.spatialHashGrid) {
            if (debug)
                console.warn(
                    "SpatialGridManager: No spatial hash grid for raycast"
                );
            return null;
        }

        const ray = raycaster.ray;
        const rayOrigin = ray.origin;
        const rayDirection = ray.direction;

        const groundTarget = new THREE.Vector3();
        const groundIntersectionDistance = rayOrigin.y / -rayDirection.y;

        let groundIntersection = null;
        if (
            groundIntersectionDistance > 0 &&
            groundIntersectionDistance < maxDistance
        ) {
            groundTarget
                .copy(rayOrigin)
                .addScaledVector(rayDirection, groundIntersectionDistance);

            const gridSizeHalf = gridSize / 2;
            if (
                Math.abs(groundTarget.x) <= gridSizeHalf &&
                Math.abs(groundTarget.z) <= gridSizeHalf
            ) {
                groundIntersection = {
                    point: groundTarget.clone(),
                    normal: new THREE.Vector3(0, 1, 0), // Normal is up for ground plane
                    block: {
                        x: Math.floor(groundTarget.x),
                        y: 0,
                        z: Math.floor(groundTarget.z),
                    },
                    blockId: null, // No block here - it's the ground
                    distance: groundIntersectionDistance,
                    isGroundPlane: true,
                };
            }
        }

        if (!prioritizeBlocks || this.spatialHashGrid.size === 0) {
            return groundIntersection;
        }

        const stepSize = 0.005; // Reduced for better accuracy with thin walls
        const maxSteps = Math.ceil(maxDistance / stepSize);

        let currentX = rayOrigin.x + 0.5;
        let currentY = rayOrigin.y + 0.5;
        let currentZ = rayOrigin.z + 0.5;

        const dirNormalized = rayDirection.clone().normalize();

        let distance = 0;

        let foundBlockId = null;
        let foundBlock = null;
        let foundDistance = Infinity;
        let foundNormal = new THREE.Vector3(0, 1, 0); // Default to up normal
        let foundHitPoint = new THREE.Vector3();
        let foundFace = null;

        let crossedBoundary = false;
        let previousBlockX = Math.floor(currentX);
        let previousBlockY = Math.floor(currentY);
        let previousBlockZ = Math.floor(currentZ);

        let lastEmptyPosition = new THREE.Vector3(currentX, currentY, currentZ);

        const isDebugEnabled = false; //debug && isPlacing;
        if (isDebugEnabled) {
            console.log(
                `RAYCAST: Starting ray from (${rayOrigin.x.toFixed(
                    2
                )}, ${rayOrigin.y.toFixed(2)}, ${rayOrigin.z.toFixed(2)})`
            );
            console.log(
                `RAYCAST: Ray direction (${dirNormalized.x.toFixed(
                    2
                )}, ${dirNormalized.y.toFixed(2)}, ${dirNormalized.z.toFixed(
                    2
                )})`
            );
        }

        for (let step = 0; step < maxSteps; step++) {
            const blockX = Math.floor(currentX);
            const blockY = Math.floor(currentY);
            const blockZ = Math.floor(currentZ);

            crossedBoundary =
                blockX !== previousBlockX ||
                blockY !== previousBlockY ||
                blockZ !== previousBlockZ;
            if (crossedBoundary) {
                previousBlockX = blockX;
                previousBlockY = blockY;
                previousBlockZ = blockZ;
                if (isDebugEnabled) {
                    console.log(
                        `RAYCAST: Crossed block boundary to (${blockX}, ${blockY}, ${blockZ})`
                    );
                }
            }

            const key = `${blockX},${blockY},${blockZ}`;

            if (recentlyPlacedBlocks && recentlyPlacedBlocks.has(key)) {
                lastEmptyPosition.set(currentX, currentY, currentZ);

                currentX += dirNormalized.x * stepSize;
                currentY += dirNormalized.y * stepSize;
                currentZ += dirNormalized.z * stepSize;

                distance += stepSize;
                continue;
            }

            const blockId = this.spatialHashGrid.get(blockX, blockY, blockZ);

            if (blockId === 0 || blockId === null || blockId === undefined) {
                lastEmptyPosition.set(currentX, currentY, currentZ);
                if (isDebugEnabled && step % 10 === 0) {
                    console.log(
                        `RAYCAST: Empty at (${blockX}, ${blockY}, ${blockZ}), step=${step}`
                    );
                }
            } else {
                const blockPos = new THREE.Vector3(
                    blockX + 0.5,
                    blockY + 0.5,
                    blockZ + 0.5
                );
                const exactDistance = rayOrigin.distanceTo(blockPos);

                if (exactDistance < foundDistance) {
                    const hitPointRaw = lastEmptyPosition.clone();
                    if (isDebugEnabled) {
                        console.log(
                            `RAYCAST: Ray trajectory between (${lastEmptyPosition.x.toFixed(
                                2
                            )}, ${lastEmptyPosition.y.toFixed(
                                2
                            )}, ${lastEmptyPosition.z.toFixed(
                                2
                            )}) and (${currentX.toFixed(2)}, ${currentY.toFixed(
                                2
                            )}, ${currentZ.toFixed(2)})`
                        );
                    }

                    const faceInfo = this._determineBlockFaceAdvanced(
                        hitPointRaw,
                        blockX,
                        blockY,
                        blockZ,
                        dirNormalized,
                        lastEmptyPosition,
                        new THREE.Vector3(currentX, currentY, currentZ)
                    );

                    const { normal, face } = faceInfo;

                    const hitPoint = this._adjustHitPointToFace(
                        hitPointRaw,
                        blockX,
                        blockY,
                        blockZ,
                        face
                    );

                    foundBlockId = blockId;
                    foundDistance = exactDistance;
                    foundBlock = { x: blockX, y: blockY, z: blockZ };
                    foundNormal = normal.clone();
                    foundHitPoint = hitPoint.clone();
                    foundFace = face;

                    break;
                }
            }

            currentX += dirNormalized.x * stepSize;
            currentY += dirNormalized.y * stepSize;
            currentZ += dirNormalized.z * stepSize;

            distance += stepSize;

            if (distance > maxDistance) break;
        }

        if (foundBlockId !== null) {
            return {
                point: foundHitPoint.clone(),
                normal: foundNormal,
                block: foundBlock,
                blockId: foundBlockId,
                distance: foundDistance,
                isGroundPlane: false,
                face: foundFace,
            };
        }

        return groundIntersection;
    }
    /**
     * Advanced face detection that handles grazing angles better
     * @param {THREE.Vector3} hitPoint - Point where the ray hit
     * @param {number} blockX - Block X coordinate
     * @param {number} blockY - Block Y coordinate
     * @param {number} blockZ - Block Z coordinate
     * @param {THREE.Vector3} rayDir - Ray direction (normalized)
     * @param {THREE.Vector3} lastEmptyPos - Last position before hitting the block
     * @param {THREE.Vector3} currentPos - Current position of ray traversal
     * @returns {Object} Object containing normal vector and face name
     * @private
     */
    _determineBlockFaceAdvanced(
        hitPoint,
        blockX,
        blockY,
        blockZ,
        rayDir,
        lastEmptyPos,
        currentPos
    ) {
        const trajectory = new THREE.Vector3()
            .subVectors(currentPos, lastEmptyPos)
            .normalize();

        const blockMinX = blockX;
        const blockMinY = blockY;
        const blockMinZ = blockZ;
        const blockMaxX = blockX + 1;
        const blockMaxY = blockY + 1;
        const blockMaxZ = blockZ + 1;

        const blockFractionX = lastEmptyPos.x - blockMinX;
        const blockFractionY = lastEmptyPos.y - blockMinY;
        const blockFractionZ = lastEmptyPos.z - blockMinZ;

        const distToMinX = blockFractionX;
        const distToMaxX = blockMaxX - lastEmptyPos.x;
        const distToMinY = blockFractionY;
        const distToMaxY = blockMaxY - lastEmptyPos.y;
        const distToMinZ = blockFractionZ;
        const distToMaxZ = blockMaxZ - lastEmptyPos.z;

        const faces = [
            {
                name: "minX",
                normal: new THREE.Vector3(-1, 0, 0),
                valid: trajectory.x > 0, // Moving in positive X direction means entering through minX face

                tValue:
                    trajectory.x !== 0
                        ? Math.abs(distToMinX / trajectory.x)
                        : Infinity,

                perpendicular: Math.abs(trajectory.x),
            },

            {
                name: "maxX",
                normal: new THREE.Vector3(1, 0, 0),
                valid: trajectory.x < 0, // Moving in negative X direction means entering through maxX face
                tValue:
                    trajectory.x !== 0
                        ? Math.abs(distToMaxX / -trajectory.x)
                        : Infinity,
                perpendicular: Math.abs(trajectory.x),
            },

            {
                name: "minY",
                normal: new THREE.Vector3(0, -1, 0),
                valid: trajectory.y > 0, // Moving upward means entering through bottom face
                tValue:
                    trajectory.y !== 0
                        ? Math.abs(distToMinY / trajectory.y)
                        : Infinity,
                perpendicular: Math.abs(trajectory.y),
            },

            {
                name: "maxY",
                normal: new THREE.Vector3(0, 1, 0),
                valid: trajectory.y < 0, // Moving downward means entering through top face
                tValue:
                    trajectory.y !== 0
                        ? Math.abs(distToMaxY / -trajectory.y)
                        : Infinity,
                perpendicular: Math.abs(trajectory.y),
            },

            {
                name: "minZ",
                normal: new THREE.Vector3(0, 0, -1),
                valid: trajectory.z > 0, // Moving in positive Z direction means entering through minZ face
                tValue:
                    trajectory.z !== 0
                        ? Math.abs(distToMinZ / trajectory.z)
                        : Infinity,
                perpendicular: Math.abs(trajectory.z),
            },

            {
                name: "maxZ",
                normal: new THREE.Vector3(0, 0, 1),
                valid: trajectory.z < 0, // Moving in negative Z direction means entering through maxZ face
                tValue:
                    trajectory.z !== 0
                        ? Math.abs(distToMaxZ / -trajectory.z)
                        : Infinity,
                perpendicular: Math.abs(trajectory.z),
            },
        ];

        const validFaces = faces.filter((face) => face.valid);

        if (validFaces.length > 0) {
            validFaces.sort((a, b) => a.tValue - b.tValue);

            return {
                normal: validFaces[0].normal,
                face: validFaces[0].name,
            };
        }

        faces.sort((a, b) => b.perpendicular - a.perpendicular);

        return {
            normal: faces[0].normal,
            face: faces[0].name,
        };
    }
    /**
     * Adjust hit point to be exactly on the face of the block
     * @param {THREE.Vector3} rawPoint - Raw hit point
     * @param {number} blockX - Block X coordinate
     * @param {number} blockY - Block Y coordinate
     * @param {number} blockZ - Block Z coordinate
     * @param {string} face - Face name
     * @returns {THREE.Vector3} Adjusted hit point
     * @private
     */
    _adjustHitPointToFace(rawPoint, blockX, blockY, blockZ, face) {
        const adjustedPoint = rawPoint.clone();

        const blockMinX = blockX;
        const blockMinY = blockY;
        const blockMinZ = blockZ;
        const blockMaxX = blockX + 1;
        const blockMaxY = blockY + 1;
        const blockMaxZ = blockZ + 1;

        switch (face) {
            case "minX":
                adjustedPoint.x = blockMinX;

                adjustedPoint.y = Math.max(
                    blockMinY,
                    Math.min(blockMaxY, adjustedPoint.y)
                );
                adjustedPoint.z = Math.max(
                    blockMinZ,
                    Math.min(blockMaxZ, adjustedPoint.z)
                );
                break;
            case "maxX":
                adjustedPoint.x = blockMaxX;
                adjustedPoint.y = Math.max(
                    blockMinY,
                    Math.min(blockMaxY, adjustedPoint.y)
                );
                adjustedPoint.z = Math.max(
                    blockMinZ,
                    Math.min(blockMaxZ, adjustedPoint.z)
                );
                break;
            case "minY":
                adjustedPoint.y = blockMinY;
                adjustedPoint.x = Math.max(
                    blockMinX,
                    Math.min(blockMaxX, adjustedPoint.x)
                );
                adjustedPoint.z = Math.max(
                    blockMinZ,
                    Math.min(blockMaxZ, adjustedPoint.z)
                );
                break;
            case "maxY":
                adjustedPoint.y = blockMaxY;
                adjustedPoint.x = Math.max(
                    blockMinX,
                    Math.min(blockMaxX, adjustedPoint.x)
                );
                adjustedPoint.z = Math.max(
                    blockMinZ,
                    Math.min(blockMaxZ, adjustedPoint.z)
                );
                break;
            case "minZ":
                adjustedPoint.z = blockMinZ;
                adjustedPoint.x = Math.max(
                    blockMinX,
                    Math.min(blockMaxX, adjustedPoint.x)
                );
                adjustedPoint.y = Math.max(
                    blockMinY,
                    Math.min(blockMaxY, adjustedPoint.y)
                );
                break;
            case "maxZ":
                adjustedPoint.z = blockMaxZ;
                adjustedPoint.x = Math.max(
                    blockMinX,
                    Math.min(blockMaxX, adjustedPoint.x)
                );
                adjustedPoint.y = Math.max(
                    blockMinY,
                    Math.min(blockMaxY, adjustedPoint.y)
                );
                break;
        }
        return adjustedPoint;
    }
    /**
     * Get all chunks that a ray passes through
     * @param {THREE.Ray} ray - The ray to check
     * @param {number} maxDistance - Maximum distance to check
     * @returns {Set<string>} - Set of chunk keys
     */
    getChunksAlongRay(ray, maxDistance) {
        const chunksToCheck = new Set();

        const startPos = ray.origin.clone();
        const dir = ray.direction.clone().normalize();

        let currentX = Math.floor(startPos.x / CHUNK_SIZE);
        let currentY = Math.floor(startPos.y / CHUNK_SIZE);
        let currentZ = Math.floor(startPos.z / CHUNK_SIZE);

        chunksToCheck.add(`${currentX},${currentY},${currentZ}`);

        const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
        const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
        const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

        const nextBoundaryX = (currentX + (stepX > 0 ? 1 : 0)) * CHUNK_SIZE;
        const nextBoundaryY = (currentY + (stepY > 0 ? 1 : 0)) * CHUNK_SIZE;
        const nextBoundaryZ = (currentZ + (stepZ > 0 ? 1 : 0)) * CHUNK_SIZE;

        let tMaxX =
            stepX === 0
                ? Infinity
                : Math.abs((nextBoundaryX - startPos.x) / dir.x);
        let tMaxY =
            stepY === 0
                ? Infinity
                : Math.abs((nextBoundaryY - startPos.y) / dir.y);
        let tMaxZ =
            stepZ === 0
                ? Infinity
                : Math.abs((nextBoundaryZ - startPos.z) / dir.z);

        const tDeltaX = stepX === 0 ? Infinity : Math.abs(CHUNK_SIZE / dir.x);
        const tDeltaY = stepY === 0 ? Infinity : Math.abs(CHUNK_SIZE / dir.y);
        const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(CHUNK_SIZE / dir.z);

        let totalDistance = 0;

        const maxIterations = 100;
        let iterations = 0;

        while (totalDistance < maxDistance && iterations < maxIterations) {
            iterations++;

            if (tMaxX < tMaxY && tMaxX < tMaxZ) {
                currentX += stepX;
                totalDistance = tMaxX;
                tMaxX += tDeltaX;
            } else if (tMaxY < tMaxZ) {
                currentY += stepY;
                totalDistance = tMaxY;
                tMaxY += tDeltaY;
            } else {
                currentZ += stepZ;
                totalDistance = tMaxZ;
                tMaxZ += tDeltaZ;
            }

            chunksToCheck.add(`${currentX},${currentY},${currentZ}`);
        }
        return chunksToCheck;
    }
    /**
     * Get all blocks in the grid
     * @returns {Object} - Object with position keys and block IDs
     */
    getAllBlocks() {
        const blocks = {};

        if (this.spatialHashGrid._blocks && this.spatialHashGrid._coords) {
            for (let i = 0; i < this.spatialHashGrid.size; i++) {
                const x = this.spatialHashGrid._coords[i * 3];
                const y = this.spatialHashGrid._coords[i * 3 + 1];
                const z = this.spatialHashGrid._coords[i * 3 + 2];
                const blockId = this.spatialHashGrid._blocks[i];

                const posKey = `${x},${y},${z}`;
                blocks[posKey] = blockId;
            }
        }
        return blocks;
    }
    /**
     * Get all blocks in a specific chunk
     * @param {number} cx - Chunk X coordinate
     * @param {number} cy - Chunk Y coordinate
     * @param {number} cz - Chunk Z coordinate
     * @returns {Object} - Object with position keys and block IDs
     */
    getChunkBlocks(cx, cy, cz) {
        const blocks = {};

        const minX = cx * CHUNK_SIZE;
        const minY = cy * CHUNK_SIZE;
        const minZ = cz * CHUNK_SIZE;
        const maxX = minX + CHUNK_SIZE - 1;
        const maxY = minY + CHUNK_SIZE - 1;
        const maxZ = minZ + CHUNK_SIZE - 1;

        if (this.spatialHashGrid._blocks && this.spatialHashGrid._coords) {
            for (let i = 0; i < this.spatialHashGrid.size; i++) {
                const x = this.spatialHashGrid._coords[i * 3];
                const y = this.spatialHashGrid._coords[i * 3 + 1];
                const z = this.spatialHashGrid._coords[i * 3 + 2];

                if (
                    x >= minX &&
                    x <= maxX &&
                    y >= minY &&
                    y <= maxY &&
                    z >= minZ &&
                    z <= maxZ
                ) {
                    const blockId = this.spatialHashGrid._blocks[i];

                    const posKey = `${x},${y},${z}`;
                    blocks[posKey] = blockId;
                }
            }
        }
        return blocks;
    }
    /**
     * Get the number of blocks in the grid
     * @returns {number} - Number of blocks
     */
    get size() {
        return this.spatialHashGrid.size;
    }
    /**
     * Check if a block exists at the given coordinates
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {number} z - Z coordinate
     * @returns {boolean} True if a block exists at the coordinates
     */
    hasBlock(x, y, z) {
        if (!this.spatialHashGrid) return false;

        const blockId = this.spatialHashGrid.get(x, y, z);

        return blockId !== null && blockId !== 0;
    }
    /**
     * Get the block ID at the given position
     * @param {string|number} key - Position key in format "x,y,z" or x coordinate
     * @param {number} [y] - Y coordinate if first param is x coordinate
     * @param {number} [z] - Z coordinate if first param is x coordinate
     * @returns {number|null} - Block ID or null if not found
     */
    getBlock(key, y, z) {
        if (arguments.length === 3) {
            return this.spatialHashGrid.get(key, y, z) || 0;
        } else {
            if (typeof key === "string") {
                const [x, y, z] = key.split(",").map(Number);
                return this.spatialHashGrid.get(x, y, z) || 0;
            }
            return 0;
        }
    }
    /**
     * Set a block at the given position
     * @param {string|number} key - Position key in format "x,y,z" or x coordinate
     * @param {number} blockId - Block ID to set or y coordinate if first param is x coordinate
     * @param {number} [z] - Z coordinate if first param is x coordinate
     * @param {number} [id] - Block ID if using x,y,z coordinates
     */
    setBlock(key, blockId, z, id) {
        if (
            typeof key === "number" &&
            typeof blockId === "number" &&
            typeof z === "number" &&
            id !== undefined
        ) {
            this.spatialHashGrid.set(key, blockId, z, id);
        } else if (typeof key === "string" && blockId !== undefined) {
            const [x, y, z] = key.split(",").map(Number);
            this.spatialHashGrid.set(x, y, z, blockId);
        } else {
            console.warn("Invalid parameters for setBlock");
        }
    }
    /**
     * Delete a block at the given position
     * @param {string|number} key - Position key in format "x,y,z" or x coordinate
     * @param {number} [y] - Y coordinate if first param is x coordinate
     * @param {number} [z] - Z coordinate if first param is x coordinate
     * @returns {boolean} - True if the block was deleted
     */
    deleteBlock(key, y, z) {
        console.log(`SpatialGridManager.deleteBlock: Deleting block at ${key}`);
        if (arguments.length === 3) {
            return this.spatialHashGrid.set(key, y, z, 0);
        } else {
            if (typeof key === "string") {
                const [x, y, z] = key.split(",").map(Number);
                return this.spatialHashGrid.set(x, y, z, 0);
            }
            return false;
        }
    }
    /**
     * @deprecated This function is no longer used
     * The occlusion culling system has been removed
     */
    isChunkOccluded() {
        return false;
    }
    /**
     * Clear the spatial hash grid completely
     * This will remove all blocks from the grid
     */
    clear() {
        console.log("SpatialGridManager: Clearing spatial hash grid");
        if (!this.spatialHashGrid) {
            console.warn("SpatialGridManager: No spatial hash grid to clear");
            return;
        }

        if (typeof this.spatialHashGrid.clear === "function") {
            this.spatialHashGrid.clear();
        } else {
            console.log("SpatialGridManager: Recreating spatial hash grid");
            this.spatialHashGrid = new SpatialHashGrid({
                chunkSize: CHUNK_SIZE,
            });
        }

        this.perfMetrics = {
            lastUpdateTime: 0,
            blockCount: 0,
            updateCount: 0,
        };
        console.log("SpatialGridManager: Spatial hash grid cleared");
    }
    /**
     * Deserialize the grid data from the worker
     * @param {Object} data - Grid data from worker
     * @returns {boolean} True if successful
     */
    deserializeWorkerGrid(data) {
        try {
            const {
                blockIds,
                coordinates,
                hashTable,
                collisionTable,
                size,
                stats,
                hashConstants,
            } = data;

            if (!blockIds || !coordinates || !hashTable || !collisionTable) {
                console.error(
                    "SpatialGridManager: Missing data in worker response",
                    data
                );
                return false;
            }

            if (!this.spatialHashGrid) {
                this.spatialHashGrid = new SpatialHashGrid();
            }

            if (
                !(blockIds instanceof Uint32Array) ||
                !(coordinates instanceof Int32Array) ||
                !(hashTable instanceof Uint32Array) ||
                !(collisionTable instanceof Uint32Array)
            ) {
                console.error(
                    "SpatialGridManager: Arrays in worker response are not TypedArrays",
                    {
                        blockIds: blockIds?.constructor?.name,
                        coordinates: coordinates?.constructor?.name,
                        hashTable: hashTable?.constructor?.name,
                        collisionTable: collisionTable?.constructor?.name,
                    }
                );

                console.log("SpatialGridManager: Data details", {
                    blockIdsLength: blockIds?.length,
                    coordinatesLength: coordinates?.length,
                    size,
                });
                return false;
            }

            if (size > 0) {
                console.log(
                    `SpatialGridManager: Received grid with ${size} blocks. Sample blocks:`
                );
                const sampleSize = Math.min(3, size);
                for (let i = 0; i < sampleSize; i++) {
                    const x = coordinates[i * 3];
                    const y = coordinates[i * 3 + 1];
                    const z = coordinates[i * 3 + 2];
                    const id = blockIds[i];
                    console.log(`  Block ${i}: (${x},${y},${z}) ID=${id}`);
                }
            }

            this.spatialHashGrid.initializeFromBinary({
                blockIds,
                coordinates,
                hashTable,
                collisionTable,
                size,
                hashConstants,
            });
            console.log(
                `SpatialGridManager: Successfully deserialized worker grid with ${this.spatialHashGrid.size} blocks`
            );
            return true;
        } catch (error) {
            console.error(
                "SpatialGridManager: Error deserializing worker grid",
                error
            );
            return false;
        }
    }
    /**
     * Reset the manager to its initial state
     * This is useful when loading a new world or switching modes
     */
    reset() {
        this.spatialHashGrid.reset();

        this.isProcessing = false;
        this.lastFrustumUpdate = 0;
        this.chunksInFrustum = new Set();

        this.perfMetrics = {
            lastUpdateTime: 0,
            blockCount: 0,
            updateCount: 0,
        };
        console.log("SpatialGridManager: Reset to initial state");
    }

    processWithWorker(blocks) {
        return new Promise((resolve) => {
            try {
                console.log(
                    `Processing ${blocks.length} blocks with web worker`
                );

                const worker = new Worker(
                    new URL("../workers/SpatialHashWorker.js", import.meta.url)
                );

                const workerStartTime = performance.now();

                worker.onmessage = (event) => {
                    console.log(
                        "SpatialGridManager: Web worker message received",
                        event
                    );
                    const data = event.data;
                    if (data.error) {
                        console.error("Web worker error:", data.error);
                        worker.terminate();
                        resolve(false);
                        return;
                    }
                    if (data.result === "gridBuilt") {
                        const workerElapsedTime = (
                            (performance.now() - workerStartTime) /
                            1000
                        ).toFixed(2);
                        console.log(
                            `Web worker processing completed in ${workerElapsedTime}s`
                        );

                        if (!this.spatialHashGrid) {
                            console.warn(
                                "SpatialHashGrid not initialized before worker completed"
                            );
                            this.spatialHashGrid = new SpatialHashGrid();
                        }
                        try {
                            const success = this.deserializeWorkerGrid(data);
                            if (success) {
                                console.log(
                                    `Spatial hash built with ${this.spatialHashGrid.size} blocks using web worker`
                                );

                                if (data.stats) {
                                    console.log(
                                        `Worker processed ${data.size.toLocaleString()} blocks in ${
                                            data.stats?.processTime?.toFixed(
                                                1
                                            ) || "unknown"
                                        }s`
                                    );
                                }
                            } else {
                                console.error(
                                    "Failed to deserialize worker grid data"
                                );
                                worker.terminate();
                                resolve(false);
                                return;
                            }
                        } catch (error) {
                            console.error(
                                "Error deserializing worker grid:",
                                error
                            );
                            worker.terminate();
                            resolve(false);
                            return;
                        }

                        worker.terminate();
                        console.log(
                            `SpatialGridManager: Successfully deserialized worker grid with ${this.spatialHashGrid.size} blocks`
                        );
                        resolve(true);
                    }
                };

                worker.onerror = (error) => {
                    console.error("Web worker error:", error);
                    worker.terminate();
                    resolve(false);
                };

                console.log("processWithWorker - build grid sent")
                worker.postMessage({
                    operation: "buildGrid",
                    blocks: blocks,
                    chunkSize: 16,
                });
            } catch (error) {
                console.error("Error setting up worker:", error);
                resolve(false);
            }
        });
    }
}
export { SpatialGridManager, SpatialHashGrid };
