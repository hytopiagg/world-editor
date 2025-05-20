import BlockTypeRegistry from "../blocks/BlockTypeRegistry";
import { CHUNK_SIZE, CHUNK_INDEX_RANGE } from "./ChunkConstants";
import BlockTextureAtlas from "../blocks/BlockTextureAtlas";
/**
 * Represents a chunk in the world
 */
class Chunk {
    /**
     * Create a new chunk
     * @param {Object} originCoordinate - The origin coordinate of the chunk
     * @param {Uint8Array} blocks - The blocks in the chunk
     */
    constructor(originCoordinate, blocks) {
        if (!Chunk.isValidOriginCoordinate(originCoordinate)) {
            throw new Error(
                `Chunk.constructor(): Chunk origin coordinate must be divisible by CHUNK_SIZE (${CHUNK_SIZE}).`
            );
        }
        this.originCoordinate = originCoordinate;
        this._blocks = blocks;
        this._liquidMesh = undefined;
        this._solidMesh = undefined;
        this._visible = true;
    }
    /**
     * Get the chunk ID from origin coordinate
     * @param {Object} originCoordinate - The origin coordinate
     * @returns {string} The chunk ID
     */
    static getChunkId(originCoordinate) {
        return `${originCoordinate.x},${originCoordinate.y},${originCoordinate.z}`;
    }
    /**
     * Convert global coordinate to chunk origin coordinate
     * @param {Object} globalCoordinate - The global coordinate
     * @returns {Object} The chunk origin coordinate
     */
    static globalCoordinateToOriginCoordinate(globalCoordinate) {
        return {
            x: globalCoordinate.x & ~(CHUNK_SIZE - 1),
            y: globalCoordinate.y & ~(CHUNK_SIZE - 1),
            z: globalCoordinate.z & ~(CHUNK_SIZE - 1),
        };
    }
    /**
     * Convert global coordinate to local coordinate within a chunk
     * @param {Object} globalCoordinate - The global coordinate
     * @returns {Object} The local coordinate
     */
    static globalCoordinateToLocalCoordinate(globalCoordinate) {
        return {
            x: globalCoordinate.x & (CHUNK_SIZE - 1),
            y: globalCoordinate.y & (CHUNK_SIZE - 1),
            z: globalCoordinate.z & (CHUNK_SIZE - 1),
        };
    }
    /**
     * Check if a local coordinate is valid
     * @param {Object} localCoordinate - The local coordinate
     * @returns {boolean} True if the local coordinate is valid
     */
    static isValidLocalCoordinate(localCoordinate) {
        return (
            localCoordinate.x >= 0 &&
            localCoordinate.x <= CHUNK_INDEX_RANGE &&
            localCoordinate.y >= 0 &&
            localCoordinate.y <= CHUNK_INDEX_RANGE &&
            localCoordinate.z >= 0 &&
            localCoordinate.z <= CHUNK_INDEX_RANGE
        );
    }
    /**
     * Check if an origin coordinate is valid
     * @param {Object} originCoordinate - The origin coordinate
     * @returns {boolean} True if the origin coordinate is valid
     */
    static isValidOriginCoordinate(originCoordinate) {
        return (
            originCoordinate.x % CHUNK_SIZE === 0 &&
            originCoordinate.y % CHUNK_SIZE === 0 &&
            originCoordinate.z % CHUNK_SIZE === 0
        );
    }
    /**
     * Get the blocks in the chunk
     * @returns {Uint8Array} The blocks
     */
    get blocks() {
        return this._blocks;
    }
    /**
     * Get the chunk ID
     * @returns {string} The chunk ID
     */
    get chunkId() {
        return Chunk.getChunkId(this.originCoordinate);
    }
    /**
     * Check if the chunk has a mesh
     * @returns {boolean} True if the chunk has at least one mesh
     */
    hasMesh() {
        return !!(this._solidMesh || this._liquidMesh);
    }
    /**
     * Get whether the chunk is visible
     * @returns {boolean} Whether the chunk is visible
     */
    get visible() {
        return this._visible;
    }
    /**
     * Set whether the chunk is visible
     * @param {boolean} isVisible - Whether the chunk is visible
     */
    set visible(isVisible) {
        this._visible = isVisible;
        this._updateMeshVisibility();
    }
    /**
     * Update mesh visibility based on chunk visibility
     * @private
     */
    _updateMeshVisibility() {
        if (this._solidMesh) {
            if (this._solidMesh.visible !== this._visible) {
            }
            this._solidMesh.visible = this._visible;
        }
        if (this._liquidMesh) {
            if (this._liquidMesh.visible !== this._visible) {
            }
            this._liquidMesh.visible = this._visible;
        }
        if (this._scene) {
            this._scene.updateMatrixWorld(true);
        }
    }
    /**
     * Precompute block types for this chunk and its neighbors
     * @param {ChunkManager} chunkManager - The chunk manager
     * @returns {Array} A 3D array of block types
     * @private
     */
    _getExtendedBlockTypes(chunkManager) {
        const extendedSize = CHUNK_SIZE + 2;
        const blockTypes = new Array(extendedSize);
        for (let i = 0; i < extendedSize; i++) {
            blockTypes[i] = new Array(extendedSize);
            for (let j = 0; j < extendedSize; j++) {
                blockTypes[i][j] = new Array(extendedSize);
            }
        }
        const { x: originX, y: originY, z: originZ } = this.originCoordinate;
        for (let ex = 0; ex < extendedSize; ex++) {
            for (let ey = 0; ey < extendedSize; ey++) {
                for (let ez = 0; ez < extendedSize; ez++) {
                    const globalX = originX + ex - 1;
                    const globalY = originY + ey - 1;
                    const globalZ = originZ + ez - 1;
                    blockTypes[ex][ey][ez] = chunkManager.getGlobalBlockType({
                        x: globalX,
                        y: globalY,
                        z: globalZ,
                    });
                }
            }
        }
        return blockTypes;
    }
    /**
     * Build meshes for this chunk
     * @param {ChunkManager} chunkManager - The chunk manager
     * @param {Object} options - Additional options
     * @param {Boolean} options.skipNeighbors - If true, skip neighbor chunk updates
     * @returns {Promise<Object>} The meshes
     */
    async buildMeshes(chunkManager, options = {}) {
        const forceCompleteRebuild =
            options && options.forceCompleteRebuild === true;
        const hasAddedBlocks =
            options && options.added && options.added.length > 0;
        const hasRemovedBlocks =
            options && options.removed && options.removed.length > 0;

        if (
            !forceCompleteRebuild &&
            !hasAddedBlocks &&
            !hasRemovedBlocks &&
            this._meshHashCode
        ) {
            const currentHashCode = this._calculateBlocksHashCode();
            if (currentHashCode === this._meshHashCode) {
                return;
            }
        }

        if (this._solidMesh) {
            chunkManager.chunkMeshManager.removeSolidMesh(this);
            this._solidMesh = undefined;
        }
        if (this._liquidMesh) {
            chunkManager.chunkMeshManager.removeLiquidMesh(this);
            this._liquidMesh = undefined;
        }

        if (chunkManager._scene && chunkManager._scene.updateMatrixWorld) {
            chunkManager._scene.updateMatrixWorld(true);
        }

        const solidMeshPositions = [];
        const solidMeshNormals = [];
        const solidMeshUvs = [];
        const solidMeshIndices = [];
        const solidMeshColors = [];
        const liquidMeshPositions = [];
        const liquidMeshNormals = [];
        const liquidMeshUvs = [];
        const liquidMeshIndices = [];
        const liquidMeshColors = [];
        const { x: originX, y: originY, z: originZ } = this.originCoordinate;

        // Check quickly if the chunk actually contains any non-air blocks.
        let hasBlocks = false;
        for (let i = 0; i < this._blocks.length; i++) {
            if (this._blocks[i] !== 0) {
                hasBlocks = true;
                break;
            }
        }
        if (!hasBlocks) {
            if (this._solidMesh) {
                chunkManager.chunkMeshManager.removeSolidMesh(this);
                this._solidMesh = undefined;
            }
            if (this._liquidMesh) {
                chunkManager.chunkMeshManager.removeLiquidMesh(this);
                this._liquidMesh = undefined;
            }
            this._meshHashCode = 0;
            return;
        }

        // Only now that we know we have blocks worth rendering, build the neighbour lookup table.
        this._extendedBlockTypes = this._getExtendedBlockTypes(chunkManager);

        for (let y = 0; y < CHUNK_SIZE; y++) {
            // Quick test: if the entire X-Z slice at this Y level is air, skip costly per-face work
            let sliceHasBlocks = false;
            for (
                let zTest = 0;
                zTest < CHUNK_SIZE && !sliceHasBlocks;
                zTest++
            ) {
                // compute contiguous offset once per row
                const rowBase = CHUNK_SIZE * (y + CHUNK_SIZE * zTest);
                for (let xTest = 0; xTest < CHUNK_SIZE; xTest++) {
                    if (this._blocks[rowBase + xTest] !== 0) {
                        sliceHasBlocks = true;
                        break;
                    }
                }
            }
            if (!sliceHasBlocks) {
                continue; // nothing on this Y level
            }
            const globalY = originY + y;
            for (let z = 0; z < CHUNK_SIZE; z++) {
                const globalZ = originZ + z;
                for (let x = 0; x < CHUNK_SIZE; x++) {
                    const globalX = originX + x;
                    const blockType = this.getLocalBlockType({ x, y, z });

                    if (!blockType) {
                        continue;
                    }

                    for (const blockFace of blockType.faces) {
                        const { normal: dir, vertices } =
                            blockType.faceGeometries[blockFace];

                        const ex = x + 1 + dir[0];
                        const ey = y + 1 + dir[1];
                        const ez = z + 1 + dir[2];
                        const neighborBlockType =
                            this._extendedBlockTypes[ex][ey][ez];

                        const shouldCullFace =
                            neighborBlockType &&
                            (neighborBlockType.isLiquid ||
                                !neighborBlockType.isFaceTransparent(
                                    blockFace
                                )) &&
                            (!neighborBlockType.isLiquid ||
                                neighborBlockType.id === blockType.id);
                        if (shouldCullFace) {
                            continue; // cull face
                        }

                        const meshColors = blockType.isLiquid
                            ? liquidMeshColors
                            : solidMeshColors;
                        const meshIndices = blockType.isLiquid
                            ? liquidMeshIndices
                            : solidMeshIndices;
                        const meshNormals = blockType.isLiquid
                            ? liquidMeshNormals
                            : solidMeshNormals;
                        const meshPositions = blockType.isLiquid
                            ? liquidMeshPositions
                            : solidMeshPositions;
                        const meshUvs = blockType.isLiquid
                            ? liquidMeshUvs
                            : solidMeshUvs;
                        const ndx = meshPositions.length / 3;

                        for (const { pos, uv, ao } of vertices) {
                            const vertexX = globalX + pos[0] - 0.5;
                            const vertexY = globalY + pos[1] - 0.5;
                            const vertexZ = globalZ + pos[2] - 0.5;
                            meshPositions.push(vertexX, vertexY, vertexZ);
                            meshNormals.push(...dir);

                            const actualTextureUri =
                                blockType.getTexturePath(blockFace);

                            let texCoords;
                            const isCustomBlock = blockType.id >= 100;
                            if (isCustomBlock) {
                            }

                            if (!texCoords) {
                                if (isCustomBlock) {
                                    texCoords =
                                        BlockTextureAtlas.instance.getMultiSidedTextureUV(
                                            actualTextureUri, // Pass ID as string first
                                            blockFace,
                                            uv
                                        );
                                } else {
                                    texCoords =
                                        BlockTextureAtlas.instance.getMultiSidedTextureUV(
                                            blockType.name, // Pass ID as string first
                                            blockFace,
                                            uv
                                        );
                                }
                                if (!texCoords && actualTextureUri) {
                                    texCoords =
                                        BlockTextureAtlas.instance.getTextureUVCoordinateSync(
                                            actualTextureUri,
                                            uv
                                        );
                                }
                                if (!texCoords) {
                                    texCoords =
                                        BlockTextureAtlas.instance.getTextureUVCoordinateSync(
                                            "./assets/blocks/error.png",
                                            uv
                                        );
                                    if (!texCoords) {
                                        texCoords = [0, 0, 1, 1];
                                    }
                                }

                                if (
                                    texCoords[0] === 0 &&
                                    texCoords[1] === 0 &&
                                    actualTextureUri !==
                                        "./assets/blocks/error.png"
                                ) {
                                    BlockTextureAtlas.instance.queueTextureForLoading(
                                        actualTextureUri
                                    );
                                }
                            }

                            meshUvs.push(texCoords[0], texCoords[1]);

                            meshColors.push(
                                ...this._calculateVertexColor(
                                    { x: vertexX, y: vertexY, z: vertexZ },
                                    blockType,
                                    ao,
                                    chunkManager
                                )
                            );
                        }
                        meshIndices.push(
                            ndx,
                            ndx + 1,
                            ndx + 2,
                            ndx + 2,
                            ndx + 1,
                            ndx + 3
                        );
                    }
                }
            }
        }

        this._liquidMesh =
            liquidMeshPositions.length > 0
                ? chunkManager.chunkMeshManager.getLiquidMesh(this, {
                      colors: liquidMeshColors,
                      indices: liquidMeshIndices,
                      normals: liquidMeshNormals,
                      positions: liquidMeshPositions,
                      uvs: liquidMeshUvs,
                  })
                : undefined;

        this._solidMesh =
            solidMeshPositions.length > 0
                ? chunkManager.chunkMeshManager.getSolidMesh(this, {
                      colors: solidMeshColors,
                      indices: solidMeshIndices,
                      normals: solidMeshNormals,
                      positions: solidMeshPositions,
                      uvs: solidMeshUvs,
                  })
                : undefined;

        this._updateMeshVisibility();

        this._meshHashCode = this._calculateBlocksHashCode();

        delete this._extendedBlockTypes;

        if (chunkManager._scene) {
            if (this._solidMesh) {
                chunkManager._scene.add(this._solidMesh);
            }
            if (this._liquidMesh) {
                chunkManager._scene.add(this._liquidMesh);
            }
        }
        return {
            liquidMesh: this._liquidMesh,
            solidMesh: this._solidMesh,
        };
    }
    /**
     * Build partial meshes for specific blocks in the chunk
     * @param {ChunkManager} chunkManager - The chunk manager
     * @param {Array} blockCoordinates - The block coordinates to update
     * @returns {Promise<Object>} The meshes
     */
    async buildPartialMeshes(chunkManager, blockCoordinates) {
        const perfId = `buildPartialMeshes-${this.chunkId}-${blockCoordinates.length}`;
        console.time(perfId);
        console.log(
            `Building partial meshes for ${blockCoordinates.length} blocks in chunk ${this.chunkId}`
        );

        if (
            (!this._solidMesh && !this._liquidMesh) ||
            blockCoordinates.length > 50
        ) {
            console.log(
                `Falling back to full rebuild for chunk ${this.chunkId} - no existing meshes or too many blocks (${blockCoordinates.length})`
            );
            console.timeEnd(perfId);
            return this.buildMeshes(chunkManager);
        }
        try {
            const localCoordinates = [];
            for (const coord of blockCoordinates) {
                if (
                    coord.x >= 0 &&
                    coord.x < CHUNK_SIZE &&
                    coord.y >= 0 &&
                    coord.y < CHUNK_SIZE &&
                    coord.z >= 0 &&
                    coord.z < CHUNK_SIZE
                ) {
                    localCoordinates.push(coord);
                } else {
                    const originCoord =
                        Chunk.globalCoordinateToOriginCoordinate(coord);
                    if (
                        originCoord.x === this.originCoordinate.x &&
                        originCoord.y === this.originCoordinate.y &&
                        originCoord.z === this.originCoordinate.z
                    ) {
                        localCoordinates.push(
                            Chunk.globalCoordinateToLocalCoordinate(coord)
                        );
                    }
                }
            }
            if (localCoordinates.length === 0) {
                console.log(
                    `No valid local coordinates for this chunk - skipping partial mesh update`
                );
                console.timeEnd(perfId);
                return {
                    liquidMesh: this._liquidMesh,
                    solidMesh: this._solidMesh,
                };
            }

            const effectiveRange = new Set();
            const processedBlocks = new Set();
            for (const coord of localCoordinates) {
                if (!Chunk.isValidLocalCoordinate(coord)) {
                    continue;
                }

                effectiveRange.add(`${coord.x},${coord.y},${coord.z}`);

                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dz = -1; dz <= 1; dz++) {
                            const nx = coord.x + dx;
                            const ny = coord.y + dy;
                            const nz = coord.z + dz;

                            if (
                                nx < 0 ||
                                nx >= CHUNK_SIZE ||
                                ny < 0 ||
                                ny >= CHUNK_SIZE ||
                                nz < 0 ||
                                nz >= CHUNK_SIZE
                            ) {
                                continue;
                            }
                            effectiveRange.add(`${nx},${ny},${nz}`);
                        }
                    }
                }
            }

            const solidMeshPositions = [];
            const solidMeshNormals = [];
            const solidMeshUvs = [];
            const solidMeshIndices = [];
            const solidMeshColors = [];
            const liquidMeshPositions = [];
            const liquidMeshNormals = [];
            const liquidMeshUvs = [];
            const liquidMeshIndices = [];
            const liquidMeshColors = [];
            const {
                x: originX,
                y: originY,
                z: originZ,
            } = this.originCoordinate;

            this._extendedBlockTypes =
                this._getExtendedBlockTypes(chunkManager);

            for (const blockKey of effectiveRange) {
                const [x, y, z] = blockKey.split(",").map(Number);
                const globalX = originX + x;
                const globalY = originY + y;
                const globalZ = originZ + z;

                if (processedBlocks.has(blockKey)) continue;
                processedBlocks.add(blockKey);
                const blockType = this.getLocalBlockType({ x, y, z });
                if (!blockType) {
                    continue;
                }
                for (const blockFace of blockType.faces) {
                    const { normal: dir, vertices } =
                        blockType.faceGeometries[blockFace];

                    const ex = x + 1 + dir[0];
                    const ey = y + 1 + dir[1];
                    const ez = z + 1 + dir[2];
                    const neighborBlockType =
                        this._extendedBlockTypes[ex][ey][ez];
                    if (
                        neighborBlockType &&
                        (neighborBlockType.isLiquid ||
                            !neighborBlockType.isFaceTransparent(blockFace)) &&
                        (!neighborBlockType.isLiquid ||
                            neighborBlockType.id === blockType.id)
                    ) {
                        continue; // cull face
                    }
                    const meshColors = blockType.isLiquid
                        ? liquidMeshColors
                        : solidMeshColors;
                    const meshIndices = blockType.isLiquid
                        ? liquidMeshIndices
                        : solidMeshIndices;
                    const meshNormals = blockType.isLiquid
                        ? liquidMeshNormals
                        : solidMeshNormals;
                    const meshPositions = blockType.isLiquid
                        ? liquidMeshPositions
                        : solidMeshPositions;
                    const meshUvs = blockType.isLiquid
                        ? liquidMeshUvs
                        : solidMeshUvs;
                    const ndx = meshPositions.length / 3;

                    for (const { pos, uv, ao } of vertices) {
                        const vertexX = globalX + pos[0] - 0.5;
                        const vertexY = globalY + pos[1] - 0.5;
                        const vertexZ = globalZ + pos[2] - 0.5;
                        meshPositions.push(vertexX, vertexY, vertexZ);
                        meshNormals.push(...dir);

                        const actualTextureUri =
                            blockType.getTexturePath(blockFace);
                        let texCoords;

                        if (blockType.isMultiSided) {
                            console.debug(
                                `Multi-sided block at (${globalX},${globalY},${globalZ}): ${blockType.name}, face: ${blockFace}`
                            );
                        }
                        if (!texCoords) {
                            if (blockType.isLiquid) {
                                const liquidTexturePath =
                                    blockType.getTextureUris().top ||
                                    "./assets/blocks/water-still.png";
                                texCoords =
                                    BlockTextureAtlas.instance.getTextureUVCoordinateSync(
                                        liquidTexturePath,
                                        uv
                                    );
                            } else if (blockType.isMultiSided) {
                                texCoords =
                                    BlockTextureAtlas.instance.getMultiSidedTextureUV(
                                        blockType.id.toString(), // Pass ID as string first
                                        blockFace,
                                        uv
                                    );

                                if (
                                    !texCoords ||
                                    (texCoords[0] === 0 && texCoords[1] === 0)
                                ) {
                                    texCoords =
                                        BlockTextureAtlas.instance.getMultiSidedTextureUV(
                                            blockType.name,
                                            blockFace,
                                            uv
                                        );
                                }

                                if (
                                    !texCoords ||
                                    (texCoords[0] === 0 && texCoords[1] === 0)
                                ) {
                                    texCoords =
                                        BlockTextureAtlas.instance.getTextureUVCoordinateSync(
                                            actualTextureUri,
                                            uv
                                        );
                                }
                            } else {
                                texCoords =
                                    BlockTextureAtlas.instance.getTextureUVCoordinateSync(
                                        actualTextureUri,
                                        uv
                                    );
                            }
                            if (!texCoords && actualTextureUri) {
                                texCoords =
                                    BlockTextureAtlas.instance.getTextureUVCoordinateSync(
                                        actualTextureUri,
                                        uv
                                    );
                            }
                            if (!texCoords) {
                                texCoords =
                                    BlockTextureAtlas.instance.getTextureUVCoordinateSync(
                                        "./assets/blocks/error.png",
                                        uv
                                    );
                                if (!texCoords) {
                                    texCoords = [0, 0, 1, 1];
                                }
                            }

                            if (
                                texCoords[0] === 0 &&
                                texCoords[1] === 0 &&
                                actualTextureUri !== "./assets/blocks/error.png"
                            ) {
                                BlockTextureAtlas.instance.queueTextureForLoading(
                                    actualTextureUri
                                );
                            }
                        }

                        meshUvs.push(texCoords[0], texCoords[1]);

                        const vertexCoordinate = {
                            x: vertexX,
                            y: vertexY,
                            z: vertexZ,
                        };
                        const vertexColor = this._calculateVertexColor(
                            vertexCoordinate,
                            blockType,
                            ao,
                            chunkManager
                        );
                        meshColors.push(...vertexColor);
                    }
                    meshIndices.push(
                        ndx,
                        ndx + 1,
                        ndx + 2,
                        ndx + 2,
                        ndx + 1,
                        ndx + 3
                    );
                }
            }

            const meshes = {
                solidMesh: undefined,
                liquidMesh: undefined,
            };

            if (solidMeshPositions.length > 0) {
                if (this._solidMesh) {
                    chunkManager.chunkMeshManager.removeSolidMesh(this);
                }

                meshes.solidMesh = chunkManager.chunkMeshManager.getSolidMesh(
                    this,
                    {
                        positions: solidMeshPositions,
                        normals: solidMeshNormals,
                        uvs: solidMeshUvs,
                        indices: solidMeshIndices,
                        colors: solidMeshColors,
                    }
                );
                this._solidMesh = meshes.solidMesh;
            }
            if (liquidMeshPositions.length > 0) {
                if (this._liquidMesh) {
                    chunkManager.chunkMeshManager.removeLiquidMesh(this);
                }

                meshes.liquidMesh = chunkManager.chunkMeshManager.getLiquidMesh(
                    this,
                    {
                        positions: liquidMeshPositions,
                        normals: liquidMeshNormals,
                        uvs: liquidMeshUvs,
                        indices: liquidMeshIndices,
                        colors: liquidMeshColors,
                    }
                );
                this._liquidMesh = meshes.liquidMesh;
            }

            this._updateMeshVisibility();

            delete this._extendedBlockTypes;
            console.log(
                `Successfully built partial mesh for chunk ${this.chunkId} with ${blockCoordinates.length} affected blocks (expanded to ${effectiveRange.size} blocks)`
            );
            console.timeEnd(perfId);
            return meshes;
        } catch (error) {
            console.error(
                `Error building partial meshes for chunk ${this.chunkId}:`,
                error
            );
            console.timeEnd(perfId);

            return this.buildMeshes(chunkManager);
        }
    }
    /**
     * Get the block ID at a local coordinate
     * @param {Object} localCoordinate - The local coordinate
     * @returns {number} The block ID
     */
    getLocalBlockId(localCoordinate) {
        return this._blocks[this._getIndex(localCoordinate)];
    }
    /**
     * Get the block type at a local coordinate
     * @param {Object} localCoordinate - The local coordinate
     * @returns {BlockType|undefined} The block type
     */
    getLocalBlockType(localCoordinate) {
        const blockId = this.getLocalBlockId(localCoordinate);
        if (blockId === 0) {
            return undefined;
        }
        return BlockTypeRegistry.instance.getBlockType(blockId);
    }
    /**
     * Set the block ID at a local coordinate
     * @param {Object} localCoordinate - The local coordinate
     * @param {number} blockId - The block ID
     */
    setLocalBlockId(localCoordinate, blockId) {
        if (!Chunk.isValidLocalCoordinate(localCoordinate)) {
            throw new Error(
                "Chunk.setLocalBlockId(): Block coordinate is out of bounds"
            );
        }
        const blockIndex = this._getIndex(localCoordinate);
        this._blocks[blockIndex] = blockId;
    }
    /**
     * Clear the vertex color cache for a specific region
     * @param {Object} localCoordinate - The local coordinate
     * @param {number} radius - The radius around the coordinate to clear
     */
    clearVertexColorCache(localCoordinate, radius = 2) {
        if (!this._vertexColorCache) return;

        this._vertexColorCache.clear();
    }
    /**
     * Set a block at a local coordinate
     * @param {Object} localCoordinate - The local coordinate
     * @param {number} blockTypeId - The block type ID
     * @param {ChunkManager} chunkManager - The chunk manager
     */
    setBlock(localCoordinate, blockTypeId, chunkManager) {
        const shouldLogPerf = Math.random() < 0.01; // Only log 1% of operations
        if (shouldLogPerf) {
            console.time(`setBlock-${this.chunkId}`);
        }
        if (!Chunk.isValidLocalCoordinate(localCoordinate)) {
            if (shouldLogPerf) {
                console.timeEnd(`setBlock-${this.chunkId}`);
            }
            throw new Error(
                "Chunk.setBlock(): Block coordinate is out of bounds"
            );
        }
        const blockIndex = this._getIndex(localCoordinate);
        const oldBlockTypeId = this._blocks[blockIndex];

        if (oldBlockTypeId === blockTypeId) {
            if (shouldLogPerf) {
                console.timeEnd(`setBlock-${this.chunkId}`);
            }
            return;
        }

        const isBlockRemoval = oldBlockTypeId !== 0 && blockTypeId === 0;

        this._blocks[blockIndex] = blockTypeId;

        this.clearVertexColorCache(localCoordinate);

        const isFirstBlockInChunk =
            oldBlockTypeId === 0 &&
            blockTypeId !== 0 &&
            this._blocks.filter((id) => id !== 0).length === 1;

        if (isFirstBlockInChunk) {
            chunkManager.markChunkForRemesh(this.chunkId);
            if (shouldLogPerf) {
                console.timeEnd(`setBlock-${this.chunkId}`);
            }
            return;
        }

        if (isBlockRemoval) {
            if (Math.random() < 0.1) {
                console.log(
                    `Block removal at (${localCoordinate.x},${localCoordinate.y},${localCoordinate.z}) - doing full chunk rebuild`
                );
            }

            if (this._solidMesh) {
                chunkManager.chunkMeshManager.removeSolidMesh(this);
                this._solidMesh = undefined;
            }
            if (this._liquidMesh) {
                chunkManager.chunkMeshManager.removeLiquidMesh(this);
                this._liquidMesh = undefined;
            }

            chunkManager.markChunkForRemesh(this.chunkId, {
                forceCompleteRebuild: true,
            });

            const isOnChunkEdge =
                localCoordinate.x === 0 ||
                localCoordinate.y === 0 ||
                localCoordinate.z === 0 ||
                localCoordinate.x === CHUNK_INDEX_RANGE ||
                localCoordinate.y === CHUNK_INDEX_RANGE ||
                localCoordinate.z === CHUNK_INDEX_RANGE;
            if (isOnChunkEdge) {
                const globalCoordinate =
                    this._getGlobalCoordinate(localCoordinate);
                const adjacentEdgeBlockCoordinateDeltas = [];

                if (localCoordinate.x === 0)
                    adjacentEdgeBlockCoordinateDeltas.push({
                        x: -1,
                        y: 0,
                        z: 0,
                    });
                if (localCoordinate.y === 0)
                    adjacentEdgeBlockCoordinateDeltas.push({
                        x: 0,
                        y: -1,
                        z: 0,
                    });
                if (localCoordinate.z === 0)
                    adjacentEdgeBlockCoordinateDeltas.push({
                        x: 0,
                        y: 0,
                        z: -1,
                    });
                if (localCoordinate.x === CHUNK_INDEX_RANGE)
                    adjacentEdgeBlockCoordinateDeltas.push({
                        x: 1,
                        y: 0,
                        z: 0,
                    });
                if (localCoordinate.y === CHUNK_INDEX_RANGE)
                    adjacentEdgeBlockCoordinateDeltas.push({
                        x: 0,
                        y: 1,
                        z: 0,
                    });
                if (localCoordinate.z === CHUNK_INDEX_RANGE)
                    adjacentEdgeBlockCoordinateDeltas.push({
                        x: 0,
                        y: 0,
                        z: 1,
                    });

                for (const adjacentEdgeBlockCoordinateDelta of adjacentEdgeBlockCoordinateDeltas) {
                    const adjacentEdgeBlockGlobalCoordinate = {
                        x:
                            globalCoordinate.x +
                            adjacentEdgeBlockCoordinateDelta.x,
                        y:
                            globalCoordinate.y +
                            adjacentEdgeBlockCoordinateDelta.y,
                        z:
                            globalCoordinate.z +
                            adjacentEdgeBlockCoordinateDelta.z,
                    };

                    const adjacentChunkOriginCoordinate =
                        Chunk.globalCoordinateToOriginCoordinate(
                            adjacentEdgeBlockGlobalCoordinate
                        );
                    const adjacentChunkId = Chunk.getChunkId(
                        adjacentChunkOriginCoordinate
                    );

                    if (
                        adjacentChunkId !== this.chunkId &&
                        chunkManager._chunks.has(adjacentChunkId)
                    ) {
                        if (Math.random() < 0.1) {
                            console.log(
                                `Also rebuilding adjacent chunk ${adjacentChunkId} due to edge block removal`
                            );
                        }

                        chunkManager.markChunkForRemesh(adjacentChunkId, {
                            forceCompleteRebuild: true,
                        });
                    }
                }
            }
        }
    }
    /**
     * Update only the affected faces when a block is placed or removed
     * @param {Object} localCoordinate - The local coordinate
     * @param {number} oldBlockTypeId - The old block type ID
     * @param {number} newBlockTypeId - The new block type ID
     * @param {ChunkManager} chunkManager - The chunk manager
     * @private
     */
    _updateBlockFaces(
        localCoordinate,
        oldBlockTypeId,
        newBlockTypeId,
        chunkManager
    ) {
        const timerId = `_updateBlockFaces-${this.chunkId}`;
        try {
            console.time(timerId);

            if (!this._solidMesh && !this._liquidMesh) {
                chunkManager.markChunkForRemesh(this.chunkId);
                return;
            }

            chunkManager.markChunkForRemesh(this.chunkId, {
                blockCoordinates: [localCoordinate],
            });
        } finally {
            console.timeEnd(timerId);
        }
    }
    /**
     * Calculate a simple hash code for the blocks array to detect changes
     * @private
     * @returns {number} A hash code for the blocks array
     */
    _calculateBlocksHashCode() {
        let hash = 0;
        const { length } = this._blocks;

        for (let i = 0; i < length; i++) {
            if (this._blocks[i] !== 0) {
                hash = (hash << 5) - hash + (i * 31 + this._blocks[i]);
                hash = hash & hash; // Convert to 32bit integer
            }
        }

        return hash;
    }
    /**
     * Calculate vertex color with ambient occlusion
     * @param {Object} vertexCoordinate - The vertex coordinate
     * @param {BlockType} blockType - The block type
     * @param {Object} blockFaceAO - The block face AO data
     * @param {ChunkManager} chunkManager - The chunk manager
     * @returns {Array} The vertex color [r, g, b, a]
     * @private
     */
    _calculateVertexColor(
        vertexCoordinate,
        blockType,
        blockFaceAO,
        chunkManager
    ) {
        const baseColor = blockType.color;
        return [...baseColor]; // Return a copy of the base color
    }
    /**
     * Convert local coordinate to global coordinate
     * @param {Object} localCoordinate - The local coordinate
     * @returns {Object} The global coordinate
     * @private
     */
    _getGlobalCoordinate(localCoordinate) {
        return {
            x: this.originCoordinate.x + localCoordinate.x,
            y: this.originCoordinate.y + localCoordinate.y,
            z: this.originCoordinate.z + localCoordinate.z,
        };
    }
    /**
     * Get the index in the blocks array for a local coordinate
     * @param {Object} localCoordinate - The local coordinate
     * @returns {number} The index
     * @private
     */
    _getIndex(localCoordinate) {
        return (
            localCoordinate.x +
            CHUNK_SIZE * (localCoordinate.y + CHUNK_SIZE * localCoordinate.z)
        );
    }
}
export default Chunk;
