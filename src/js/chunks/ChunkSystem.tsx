import * as THREE from "three";
import BlockTypeRegistry from "../blocks/BlockTypeRegistry";
import { CHUNK_SIZE } from "./ChunkConstants";
import ChunkManager from "./ChunkManager";
/**
 * Integrates the chunk system with TerrainBuilder
 */
class ChunkSystem {
    _scene: THREE.Scene;
    _chunkManager: ChunkManager;
    _initialized: boolean;
    _options: {
        viewDistance: number;
        viewDistanceEnabled: boolean;
    };
    _cameraPosition: THREE.Vector3;
    _frustum: THREE.Frustum;
    _nonVisibleBlocks: { [key: string]: boolean };
    /**
     * Create a new chunk system
     * @param {Object} scene - The THREE.js scene
     * @param {Object} options - Options for the chunk system
     */
    constructor(scene, options: any = {}) {
        this._scene = scene;
        this._chunkManager = new ChunkManager(scene);
        this._initialized = false;
        this._options = {
            viewDistance: options.viewDistance || 128,
            viewDistanceEnabled:
                options.viewDistanceEnabled !== undefined
                    ? options.viewDistanceEnabled
                    : true,
        };
    }

    async initialize(): Promise<void> {
        if (this._initialized) {
            return;
        }
        await BlockTypeRegistry.instance.initialize();
        await BlockTypeRegistry.instance.preload();
        this._chunkManager.setViewDistance(this._options.viewDistance);
        this._chunkManager.setViewDistanceEnabled(
            this._options.viewDistanceEnabled
        );
        this._initialized = true;
    }

    processRenderQueue() {
        if (!this._initialized) {
            return;
        }
        this._chunkManager.processRenderQueue();
    }

    updateFromTerrainData(terrainData: Object) {
        if (!this._initialized) {
            return;
        }
        let chunks = [];
        const chunkBlocks = new Map();

        for (const [posKey, blockId] of Object.entries(terrainData)) {
            const [x, y, z] = posKey.split(",").map(Number);
            const originCoordinate = {
                x: Math.floor(x / CHUNK_SIZE) * CHUNK_SIZE,
                y: Math.floor(y / CHUNK_SIZE) * CHUNK_SIZE,
                z: Math.floor(z / CHUNK_SIZE) * CHUNK_SIZE,
            };
            const chunkId = `${originCoordinate.x},${originCoordinate.y},${originCoordinate.z}`;
            if (!chunkBlocks.has(chunkId)) {
                chunkBlocks.set(
                    chunkId,
                    new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE)
                );
            }
            const localX = x - originCoordinate.x;
            const localY = y - originCoordinate.y;
            const localZ = z - originCoordinate.z;
            const index = localX + CHUNK_SIZE * (localY + CHUNK_SIZE * localZ);
            chunkBlocks.get(chunkId)[index] = blockId;
        }

        for (const [chunkId, blocks] of chunkBlocks.entries()) {
            const [x, y, z] = chunkId.split(",").map(Number);
            chunks.push({
                originCoordinate: { x, y, z },
                blocks,
            });
        }

        const validChunks = [];
        for (const chunk of chunks) {
            const { originCoordinate } = chunk;
            if (
                isNaN(originCoordinate.x) ||
                isNaN(originCoordinate.y) ||
                isNaN(originCoordinate.z)
            ) {
                console.warn(
                    `Skipping chunk with NaN coordinates: ${JSON.stringify(
                        originCoordinate
                    )}`
                );
            } else {
                validChunks.push(chunk);
            }
        }
        chunks = validChunks;

        this._chunkManager.updateChunks(chunks);
    }
    /**
     * Update blocks in the chunk system
     * @param {Array} addedBlocks - The blocks to add
     * @param {Array} removedBlocks - The blocks to remove
     */
    updateBlocks(addedBlocks = [], removedBlocks = []) {
        if (
            !this._initialized ||
            (addedBlocks.length === 0 && removedBlocks.length === 0)
        ) {
            return;
        }

        const chunksToUpdate = new Set();
        const chunkOptions = new Map();

        removedBlocks.forEach((block) => {
            const x = block.position[0];
            const y = block.position[1];
            const z = block.position[2];
            const originX = Math.floor(x / CHUNK_SIZE) * CHUNK_SIZE;
            const originY = Math.floor(y / CHUNK_SIZE) * CHUNK_SIZE;
            const originZ = Math.floor(z / CHUNK_SIZE) * CHUNK_SIZE;
            const chunkId = `${originX},${originY},${originZ}`;
            const chunk = this._chunkManager._chunks.get(chunkId);

            if (chunk) {
                const localX = x - originX;
                const localY = y - originY;
                const localZ = z - originZ;

                chunk.setLocalBlockId(
                    {
                        x: localX,
                        y: localY,
                        z: localZ,
                    },
                    0
                );
            }

            // Clear cached block types so neighbouring face visibility is recalculated
            this._chunkManager.clearBlockTypeCache({ x, y, z }, 2);

            chunksToUpdate.add(chunkId);

            if (!chunkOptions.has(chunkId)) {
                chunkOptions.set(chunkId, {
                    added: [],
                    removed: [],
                    forceCompleteRebuild: true,
                });
            }
            chunkOptions.get(chunkId).removed.push({
                position: { x, y, z },
                id: block.id,
            });

            const isNearXBoundary =
                x % CHUNK_SIZE === 0 || x % CHUNK_SIZE === CHUNK_SIZE - 1;
            const isNearYBoundary =
                y % CHUNK_SIZE === 0 || y % CHUNK_SIZE === CHUNK_SIZE - 1;
            const isNearZBoundary =
                z % CHUNK_SIZE === 0 || z % CHUNK_SIZE === CHUNK_SIZE - 1;
            if (isNearXBoundary || isNearYBoundary || isNearZBoundary) {
                for (let ox = -1; ox <= 1; ox++) {
                    for (let oy = -1; oy <= 1; oy++) {
                        for (let oz = -1; oz <= 1; oz++) {
                            if (ox === 0 && oy === 0 && oz === 0) continue;

                            if (Math.abs(ox) + Math.abs(oy) + Math.abs(oz) > 1)
                                continue;

                            if (ox !== 0 && !isNearXBoundary) continue;
                            if (oy !== 0 && !isNearYBoundary) continue;
                            if (oz !== 0 && !isNearZBoundary) continue;
                            const neighborChunkId = `${originX + ox * CHUNK_SIZE
                                },${originY + oy * CHUNK_SIZE},${originZ + oz * CHUNK_SIZE
                                }`;

                            chunksToUpdate.add(neighborChunkId);

                            if (!chunkOptions.has(neighborChunkId)) {
                                chunkOptions.set(neighborChunkId, {
                                    added: [],
                                    removed: [],
                                    skipNeighbors: true,
                                });
                            }
                        }
                    }
                }
            }
        });

        addedBlocks.forEach((block) => {
            const x = block.position[0];
            const y = block.position[1];
            const z = block.position[2];
            const originX = Math.floor(x / CHUNK_SIZE) * CHUNK_SIZE;
            const originY = Math.floor(y / CHUNK_SIZE) * CHUNK_SIZE;
            const originZ = Math.floor(z / CHUNK_SIZE) * CHUNK_SIZE;
            const chunkId = `${originX},${originY},${originZ}`;

            let chunk = this._chunkManager._chunks.get(chunkId);

            if (!chunk) {

                const blocks = new Uint8Array(
                    CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE
                );

                this._chunkManager.updateChunk({
                    originCoordinate: { x: originX, y: originY, z: originZ },
                    blocks,
                    removed: false,
                });

                chunk = this._chunkManager._chunks.get(chunkId);
                if (!chunk) {
                    console.error(`Failed to create chunk for ${chunkId}`);
                    return;
                }
            }

            const localX = x - originX;
            const localY = y - originY;
            const localZ = z - originZ;

            chunk.setLocalBlockId(
                {
                    x: localX,
                    y: localY,
                    z: localZ,
                },
                block.id
            );

            // Newly placed blocks may expose/occlude neighbouring faces; clear a smaller cache radius
            this._chunkManager.clearBlockTypeCache({ x, y, z }, 1);

            chunksToUpdate.add(chunkId);

            if (!chunkOptions.has(chunkId)) {
                chunkOptions.set(chunkId, { added: [], removed: [] });
            }
            chunkOptions.get(chunkId).added.push({
                position: { x, y, z },
                id: block.id,
            });

            const isNearXBoundary =
                x % CHUNK_SIZE === 0 || x % CHUNK_SIZE === CHUNK_SIZE - 1;
            const isNearYBoundary =
                y % CHUNK_SIZE === 0 || y % CHUNK_SIZE === CHUNK_SIZE - 1;
            const isNearZBoundary =
                z % CHUNK_SIZE === 0 || z % CHUNK_SIZE === CHUNK_SIZE - 1;
            if (isNearXBoundary || isNearYBoundary || isNearZBoundary) {
                for (let ox = -1; ox <= 1; ox++) {
                    for (let oy = -1; oy <= 1; oy++) {
                        for (let oz = -1; oz <= 1; oz++) {
                            if (ox === 0 && oy === 0 && oz === 0) continue;

                            if (Math.abs(ox) + Math.abs(oy) + Math.abs(oz) > 1)
                                continue;

                            if (ox !== 0 && !isNearXBoundary) continue;
                            if (oy !== 0 && !isNearYBoundary) continue;
                            if (oz !== 0 && !isNearZBoundary) continue;
                            const neighborChunkId = `${originX + ox * CHUNK_SIZE
                                },${originY + oy * CHUNK_SIZE},${originZ + oz * CHUNK_SIZE
                                }`;

                            chunksToUpdate.add(neighborChunkId);

                            if (!chunkOptions.has(neighborChunkId)) {
                                chunkOptions.set(neighborChunkId, {
                                    added: [],
                                    removed: [],
                                    skipNeighbors: true,
                                });
                            }
                        }
                    }
                }
            }
        });

        for (const chunkId of chunksToUpdate) {
            const chunk = this._chunkManager._chunks.get(chunkId);
            if (chunk) {
                const options = chunkOptions.get(chunkId) || {};

                if (options.added && options.added.length > 0) {
                    options.forceCompleteRebuild = true;
                }

                this._chunkManager.queueChunkForRender(chunk, options);
            }
        }
    }
    /**
     * Check if a block is on the chunk boundary
     * @param {Object} position - The block position
     * @param {number} originX - The chunk origin X
     * @param {number} originY - The chunk origin Y
     * @param {number} originZ - The chunk origin Z
     * @returns {boolean} Whether the block is on the chunk boundary
     * @private
     */
    _isOnChunkBoundary(position, originX, originY, originZ) {
        const x = position.x;
        const y = position.y;
        const z = position.z;

        const boundary = 1; // 1 block buffer
        return (
            x <= originX + boundary ||
            x >= originX + CHUNK_SIZE - 1 - boundary ||
            y <= originY + boundary ||
            y >= originY + CHUNK_SIZE - 1 - boundary ||
            z <= originZ + boundary ||
            z >= originZ + CHUNK_SIZE - 1 - boundary
        );
    }
    /**
     * Mark neighboring chunks for remeshing
     * @param {number} originX - The chunk origin X
     * @param {number} originY - The chunk origin Y
     * @param {number} originZ - The chunk origin Z
     * @private
     */
    _markNeighboringChunks(originX, originY, originZ) {
        this._markNeighborIfExists(originX - CHUNK_SIZE, originY, originZ);
        this._markNeighborIfExists(originX + CHUNK_SIZE, originY, originZ);

        this._markNeighborIfExists(originX, originY - CHUNK_SIZE, originZ);
        this._markNeighborIfExists(originX, originY + CHUNK_SIZE, originZ);

        this._markNeighborIfExists(originX, originY, originZ - CHUNK_SIZE);
        this._markNeighborIfExists(originX, originY, originZ + CHUNK_SIZE);
    }
    /**
     * Mark a neighbor chunk for remeshing if it exists
     * @param {number} x - The chunk origin X
     * @param {number} y - The chunk origin Y
     * @param {number} z - The chunk origin Z
     * @private
     */
    _markNeighborIfExists(x, y, z) {
        const chunkId = `${x},${y},${z}`;
        if (this._chunkManager._chunks.has(chunkId)) {
            this._chunkManager.markChunkForRemesh(chunkId);
        }
    }
    /**
     * Get the block ID at a position
     * @param {Array} position - The position [x, y, z]
     * @returns {number} The block ID
     */
    getBlockId(position) {
        if (!this._initialized) {
            return 0;
        }
        return this._chunkManager.getGlobalBlockId({
            x: position[0],
            y: position[1],
            z: position[2],
        });
    }
    /**
     * Check if a block exists at a position
     * @param {Array} position - The position [x, y, z]
     * @returns {boolean} True if a block exists
     */
    hasBlock(position) {
        if (!this._initialized) {
            return false;
        }
        return this._chunkManager.hasBlock({
            x: position[0],
            y: position[1],
            z: position[2],
        });
    }
    /**
     * Set the view distance
     * @param {number} distance - The view distance
     */
    setViewDistance(distance) {
        this._options.viewDistance = distance;
        if (this._initialized) {
            this._chunkManager.setViewDistance(distance);
        }
    }
    /**
     * Enable or disable view distance culling
     * @param {boolean} enabled - Whether view distance culling is enabled
     */
    setViewDistanceEnabled(enabled) {
        this._options.viewDistanceEnabled = enabled;
        if (this._initialized) {
            this._chunkManager.setViewDistanceEnabled(enabled);
        }
    }
    /**
     * Clear all chunks from the system
     * This should be called when the map is cleared
     */
    clearChunks() {
        if (!this._initialized) {
            return;
        }

        const chunks = Array.from(this._chunkManager._chunks.values());

        for (const chunk of chunks) {
            if (chunk._solidMesh) {
                this._scene.remove(chunk._solidMesh);
                this._chunkManager.chunkMeshManager.removeSolidMesh(chunk);
            }
            if (chunk._liquidMesh) {
                this._scene.remove(chunk._liquidMesh);
                this._chunkManager.chunkMeshManager.removeLiquidMesh(chunk);
            }

            this._chunkManager._chunks.delete(chunk.chunkId);
        }

        this._chunkManager._renderChunkQueue = [];
        this._chunkManager._pendingRenderChunks.clear();
        this._chunkManager._chunkRemeshOptions.clear();
        this._chunkManager._blockTypeCache.clear();
        this._chunkManager._deferredMeshChunks.clear();

        if (this._scene) {
            this._scene.updateMatrixWorld(true);
        }
    }
    /**
     * Force an update of chunk visibility
     * @param {boolean} isBulkLoading - Whether we're in a bulk loading operation
     * @returns {Object} Statistics about the visibility update
     */
    forceUpdateChunkVisibility(isBulkLoading = false) {
        if (!this._initialized || !this._chunkManager) {
            console.error(
                "Cannot force update chunk visibility: system not initialized"
            );
            return null;
        }

        if (!(this._scene as any).camera) {
            console.error(
                "Cannot force update chunk visibility: no camera set"
            );
            return null;
        }

        (this._scene as any).camera.updateMatrixWorld(true);
        (this._scene as any).camera.updateProjectionMatrix();

        return this._chunkManager.forceUpdateAllChunkVisibility(isBulkLoading);
    }
    /**
     * Set bulk loading mode to optimize performance during large terrain loads
     * @param {boolean} isLoading - Whether the system is in bulk loading mode
     * @param {number} priorityDistance - Distance within which chunks get immediate meshes
     */
    setBulkLoadingMode(isLoading, priorityDistance) {
        if (!this._initialized || !this._chunkManager) {
            console.error(
                "Cannot set bulk loading mode: system not initialized"
            );
            return;
        }
        this._chunkManager.setBulkLoadingMode(isLoading, priorityDistance);
    }
    /**
     * Force update specific chunks by key
     * @param {Array<String>} chunkKeys - Array of chunk keys to update
     * @param {Object} options - Options for the update
     * @param {Boolean} options.skipNeighbors - If true, skip neighbor chunk updates
     */
    forceUpdateChunks(chunkKeys, options: any = {}) {
        if (!this._initialized || !chunkKeys || chunkKeys.length === 0) {
            return;
        }
        const skipNeighbors = options.skipNeighbors === true;

        for (const chunkKey of chunkKeys) {
            const chunk = this._chunkManager.getChunkByKey(chunkKey);
            if (chunk) {
                this._chunkManager.queueChunkForRender(chunk, {
                    skipNeighbors,
                });
            }
        }

        this.processRenderQueue();
    }

    updateCamera() {
        if ((this._scene as any).camera) {
            const camera = (this._scene as any).camera;

            camera.updateMatrixWorld(true);
            camera.updateProjectionMatrix();

            const projScreenMatrix = new THREE.Matrix4();
            projScreenMatrix.multiplyMatrices(
                camera.projectionMatrix,
                camera.matrixWorldInverse
            );
            const frustum = new THREE.Frustum();
            frustum.setFromProjectionMatrix(projScreenMatrix);

            this._cameraPosition = camera.position.clone();
            this._frustum = frustum;
        }
    }

    reset() {
        this.clearChunks();
        if (this._nonVisibleBlocks) {
            this._nonVisibleBlocks = {};
        }
        this._chunkManager._renderChunkQueue = [];
        this._chunkManager._pendingRenderChunks.clear();
    }
}
export default ChunkSystem;
