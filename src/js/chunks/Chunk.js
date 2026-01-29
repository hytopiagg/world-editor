import BlockTypeRegistry from "../blocks/BlockTypeRegistry";
import {
    CHUNK_SIZE,
    CHUNK_INDEX_RANGE,
    MAX_LIGHT_LEVEL,
    FACE_SHADE_TOP,
    FACE_SHADE_SIDE,
    FACE_SHADE_BOTTOM,
    SKY_LIGHT_MAX_DISTANCE,
    SKY_LIGHT_BRIGHTNESS_LUT,
} from "./ChunkConstants";
import { DEFAULT_BLOCK_AO_INTENSITY } from "../blocks/BlockConstants";
import BlockTextureAtlas from "../blocks/BlockTextureAtlas";
import { rotateAroundBlockCenter, rotateDirection, BLOCK_ROTATION_MATRICES } from "../blocks/BlockRotations";
import { getShapeDefinition, buildTrimeshTriangleData } from "../blocks/BlockShapes";

// DEBUG flag for trimesh logging
const TRIMESH_DEBUG = false;

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
        this._blockRotations = new Map(); // blockIndex → rotationIndex (sparse, only non-zero)
        this._blockShapes = new Map(); // blockIndex → shapeType string (sparse, only non-cube)
        this._liquidMesh = undefined;
        this._solidMesh = undefined;
        this._visible = true;
        this._lightSources = undefined;
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

    // Check if this chunk contains at least one block of the given type id
    containsBlockType(blockTypeId) {
        if (!this._blocks) return false;
        for (let i = 0; i < this._blocks.length; i++) {
            if (this._blocks[i] === blockTypeId) return true;
        }
        return false;
    }

    // Emissive light sources cache
    getLightSources() {
        if (this._lightSources !== undefined) return this._lightSources;
        const sources = [];
        for (let y = 0; y < CHUNK_SIZE; y++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                for (let x = 0; x < CHUNK_SIZE; x++) {
                    const id = this.getLocalBlockId({ x, y, z });
                    if (id === 0) continue;
                    const type = BlockTypeRegistry.instance.getBlockType(id);
                    const level = type?.lightLevel;
                    if (typeof level === "number" && level > 0) {
                        sources.push({
                            position: {
                                x: this.originCoordinate.x + x + 0.5,
                                y: this.originCoordinate.y + y + 0.5,
                                z: this.originCoordinate.z + z + 0.5,
                            },
                            level,
                        });
                    }
                }
            }
        }
        this._lightSources = sources;
        try {
            if (
                typeof window !== "undefined" &&
                (window.__LIGHT_DEBUG__?.refresh ||
                    window.__LIGHT_DEBUG__ === true)
            ) {
                if (sources.length > 0) {
                    // Cached sources available
                }
            }
        } catch (_) {}
        return this._lightSources;
    }

    clearLightSourceCache() {
        this._lightSources = undefined;
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
        const solidMeshLightLevels = [];
        let solidMeshHasLightLevel = false;
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

        // Gather nearby light sources (including neighbors) within MAX_LIGHT_LEVEL radius in chunk units
        const nearbySources = [];
        const searchRadius = Math.ceil((MAX_LIGHT_LEVEL + 1) / CHUNK_SIZE);
        const { x: ox, y: oy, z: oz } = this.originCoordinate;
        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
            for (let dy = -searchRadius; dy <= searchRadius; dy++) {
                for (let dz = -searchRadius; dz <= searchRadius; dz++) {
                    const neighborOrigin = {
                        x: ox + dx * CHUNK_SIZE,
                        y: oy + dy * CHUNK_SIZE,
                        z: oz + dz * CHUNK_SIZE,
                    };
                    const chunkId = Chunk.getChunkId(neighborOrigin);
                    const neighbor = chunkManager.getChunkByKey?.(chunkId);
                    if (neighbor) {
                        nearbySources.push(...neighbor.getLightSources());
                    }
                }
            }
        }

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

                    // Get rotation for this block
                    const blockRotation = this.getBlockRotation({ x, y, z });

                    // === TRIMESH BLOCK RENDERING ===
                    // Check per-instance shape first, then fallback to BlockType's intrinsic shape
                    const instanceShape = this.getBlockShape({ x, y, z });
                    const isInstanceTrimesh = instanceShape !== 'cube';
                    let triangleData = null;

                    if (isInstanceTrimesh) {
                        triangleData = this._getTrimeshTriangleDataForShape(instanceShape);
                    } else if (blockType.isTrimesh) {
                        triangleData = blockType.trimeshTriangleData;
                    }

                    if (triangleData) {
                        // DEBUG: Log trimesh block processing for corner stairs
                        const shapeForLog = instanceShape || (blockType.isTrimesh ? blockType.trimesh : null);
                        if (TRIMESH_DEBUG && shapeForLog && shapeForLog.includes('corner')) {
                            console.log('[Chunk] Processing trimesh block:', {
                                position: { x: globalX, y: globalY, z: globalZ },
                                shapeType: shapeForLog,
                                triangleCount: triangleData.length,
                                rotation: blockRotation
                            });
                            // Log first few triangles
                            triangleData.slice(0, 5).forEach((tri, i) => {
                                console.log(`[Chunk] Triangle ${i}:`, {
                                    v0: tri.v0.map(n => n.toFixed(3)),
                                    v1: tri.v1.map(n => n.toFixed(3)),
                                    v2: tri.v2.map(n => n.toFixed(3)),
                                    normal: tri.normal.map(n => n.toFixed(3)),
                                    blockFace: tri.blockFace
                                });
                            });
                        }

                        const meshPositions = solidMeshPositions;
                        const meshNormals = solidMeshNormals;
                        const meshUvs = solidMeshUvs;
                        const meshIndices = solidMeshIndices;
                        const meshColors = solidMeshColors;

                        let blockLightLevel = null;

                        for (const tri of triangleData) {
                            const ndx = meshPositions.length / 3;

                            // Get texture for the face this triangle belongs to (unrotated)
                            const actualTextureUri = blockType.getTexturePath(tri.blockFace);

                            // Rotate normal
                            const rn = blockRotation > 0
                                ? rotateDirection(tri.normal, blockRotation)
                                : tri.normal;

                            // Process each vertex of the triangle
                            const triVerts = [
                                { pos: tri.v0, uv: tri.uv0 },
                                { pos: tri.v1, uv: tri.uv1 },
                                { pos: tri.v2, uv: tri.uv2 },
                            ];
                            for (const { pos, uv } of triVerts) {
                                // Rotate vertex around block center if needed
                                const rp = blockRotation > 0
                                    ? rotateAroundBlockCenter(pos, blockRotation)
                                    : pos;

                                const vertexX = globalX + rp[0] - 0.5;
                                const vertexY = globalY + rp[1] - 0.5;
                                const vertexZ = globalZ + rp[2] - 0.5;
                                meshPositions.push(vertexX, vertexY, vertexZ);
                                meshNormals.push(rn[0], rn[1], rn[2]);

                                // UV lookup from atlas
                                let texCoords = null;
                                const isCustomBlock = blockType.id >= 1000;

                                if (isCustomBlock) {
                                    // Custom block: try ID-based lookup (same pattern as cube rendering)
                                    const faceCoordMap = {
                                        top: "+y", bottom: "-y",
                                        left: "-x", right: "+x",
                                        front: "+z", back: "-z",
                                    };
                                    const faceCoord = faceCoordMap[tri.blockFace] || tri.blockFace;

                                    const candidates = [
                                        actualTextureUri,                           // 1) Direct data URI
                                        String(blockType.id),                       // 2) ID as string
                                        `blocks/${blockType.id}`,                   // 3) blocks/<id>
                                        `blocks/${blockType.id}/${faceCoord}.png`,  // 4) blocks/<id>/<face>.png
                                    ];

                                    // Add variant base ID candidates if applicable
                                    if (typeof blockType.variantOfId === "number") {
                                        const baseId = blockType.variantOfId;
                                        candidates.push(String(baseId));
                                        candidates.push(`blocks/${baseId}`);
                                        candidates.push(`blocks/${baseId}/${faceCoord}.png`);
                                    }

                                    const atlas = BlockTextureAtlas.instance;
                                    for (const key of candidates) {
                                        if (!key) continue;
                                        texCoords = atlas.getTextureUVCoordinateSync(key, uv);
                                        if (texCoords && !(texCoords[0] === 0 && texCoords[1] === 0 && texCoords[2] === 1 && texCoords[3] === 1)) {
                                            break;
                                        }
                                        atlas.queueTextureForLoading(key);
                                        texCoords = null;
                                    }

                                    // Fallback to name-based lookup
                                    if (!texCoords) {
                                        texCoords = atlas.getMultiSidedTextureUV(blockType.name, tri.blockFace, uv);
                                    }
                                } else {
                                    // Built-in block: use existing name-based lookup
                                    texCoords = BlockTextureAtlas.instance.getMultiSidedTextureUV(
                                        blockType.name, tri.blockFace, uv
                                    );
                                }

                                // Fallback to direct texture URI
                                if (!texCoords) {
                                    texCoords = BlockTextureAtlas.instance.getTextureUVCoordinateSync(
                                        actualTextureUri, uv
                                    );
                                }

                                // Final fallback to error texture
                                if (!texCoords) {
                                    texCoords = BlockTextureAtlas.instance.getTextureUVCoordinateSync(
                                        "./assets/blocks/error.png", uv
                                    );
                                }
                                if (!texCoords) texCoords = [0, 0, 1, 1];
                                meshUvs.push(texCoords[0], texCoords[1]);

                                // Vertex color (simplified for trimesh: no AO data)
                                meshColors.push(
                                    ...this._calculateVertexColor(
                                        { x: vertexX, y: vertexY, z: vertexZ },
                                        blockType,
                                        null, // no AO for trimesh
                                        chunkManager,
                                        rn
                                    )
                                );

                                // Light level
                                if (blockLightLevel === null) {
                                    blockLightLevel = this._calculateLightLevel(
                                        globalX, globalY, globalZ, nearbySources
                                    );
                                }
                                const normalized = blockLightLevel / MAX_LIGHT_LEVEL;
                                solidMeshLightLevels.push(normalized);
                                if (normalized > 0) solidMeshHasLightLevel = true;
                            }

                            // 3 indices per triangle
                            meshIndices.push(ndx, ndx + 1, ndx + 2);
                        }
                        continue; // Skip standard face-based loop for trimesh blocks
                    }

                    // === STANDARD CUBE BLOCK RENDERING (with optional rotation) ===
                    for (const blockFace of blockType.faces) {
                        const { normal: dir, vertices } =
                            blockType.faceGeometries[blockFace];

                        // For rotated cubes, rotate the face normal for neighbor culling
                        const actualDir = blockRotation > 0
                            ? rotateDirection(dir, blockRotation)
                            : dir;

                        // Round to nearest integer for neighbor lookup
                        const dnx = Math.round(actualDir[0]);
                        const dny = Math.round(actualDir[1]);
                        const dnz = Math.round(actualDir[2]);

                        const ex = x + 1 + dnx;
                        const ey = y + 1 + dny;
                        const ez = z + 1 + dnz;
                        const neighborBlockType =
                            this._extendedBlockTypes[ex] &&
                            this._extendedBlockTypes[ex][ey] &&
                            this._extendedBlockTypes[ex][ey][ez];

                        // Check if neighbor is a per-instance trimesh shape
                        const neighborLocalX = x + dnx;
                        const neighborLocalY = y + dny;
                        const neighborLocalZ = z + dnz;
                        const neighborIsLocalTrimesh =
                            neighborLocalX >= 0 && neighborLocalX < CHUNK_SIZE &&
                            neighborLocalY >= 0 && neighborLocalY < CHUNK_SIZE &&
                            neighborLocalZ >= 0 && neighborLocalZ < CHUNK_SIZE &&
                            this.getBlockShape({ x: neighborLocalX, y: neighborLocalY, z: neighborLocalZ }) !== 'cube';
                        const neighborIsTrimesh = neighborIsLocalTrimesh ||
                            (neighborBlockType && neighborBlockType.isTrimesh);

                        const shouldCullFace =
                            neighborBlockType &&
                            !neighborIsTrimesh && // never cull against trimesh neighbors
                            (neighborBlockType.isLiquid ||
                                !neighborBlockType.isFaceTransparent(
                                    blockFace
                                ) ||
                                neighborBlockType.id === blockType.id) &&
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

                        let blockLightLevel = null;
                        for (const { pos, uv, ao } of vertices) {
                            // Rotate vertex if needed
                            const rp = blockRotation > 0
                                ? rotateAroundBlockCenter(pos, blockRotation)
                                : pos;
                            const vertexX = globalX + rp[0] - 0.5;
                            const vertexY = globalY + rp[1] - 0.5;
                            const vertexZ = globalZ + rp[2] - 0.5;
                            meshPositions.push(vertexX, vertexY, vertexZ);
                            meshNormals.push(actualDir[0], actualDir[1], actualDir[2]);

                            const actualTextureUri =
                                blockType.getTexturePath(blockFace);

                            let texCoords;
                            const isCustomBlock = blockType.id >= 1000;

                            // For custom blocks, check if it's multi-texture
                            if (isCustomBlock && blockType.isMultiSided) {
                                // Multi-texture custom block - use the face-specific texture directly
                                texCoords =
                                    BlockTextureAtlas.instance.getTextureUVCoordinateSync(
                                        actualTextureUri,
                                        uv
                                    );
                            } else if (isCustomBlock) {
                                // Single-texture custom block: try multiple candidate keys
                                const faceCoordMap = {
                                    top: "+y",
                                    bottom: "-y",
                                    left: "-x",
                                    right: "+x",
                                    front: "+z",
                                    back: "-z",
                                };
                                const faceCoord =
                                    faceCoordMap[blockFace] || blockFace;
                                const candidates = [];
                                // 1) direct path/data URI
                                if (actualTextureUri)
                                    candidates.push(actualTextureUri);
                                // 2) id-based keys used when applying data URIs
                                candidates.push(String(blockType.id));
                                candidates.push(`blocks/${blockType.id}`);
                                candidates.push(
                                    `blocks/${blockType.id}/${faceCoord}.png`
                                );
                                // 3) variant base id keys
                                const baseId =
                                    typeof blockType.variantOfId === "number"
                                        ? blockType.variantOfId
                                        : null;
                                if (baseId) {
                                    candidates.push(String(baseId));
                                    candidates.push(`blocks/${baseId}`);
                                    candidates.push(
                                        `blocks/${baseId}/${faceCoord}.png`
                                    );
                                }

                                const atlas = BlockTextureAtlas.instance;
                                const ERROR_KEY = "./assets/blocks/error.png";
                                const candidateHasGoodMetadata = (
                                    candidateKey
                                ) => {
                                    if (
                                        !candidateKey ||
                                        candidateKey === ERROR_KEY
                                    )
                                        return false;
                                    // direct metadata
                                    let meta =
                                        atlas.getTextureMetadata(candidateKey);
                                    if (meta && meta.debugPath !== ERROR_KEY)
                                        return true;
                                    // blocks/<id> or blocks/<name> variants
                                    const blockFacePattern =
                                        /blocks\/(.+?)(?:\/([+\-][xyz]\.png))?$/;
                                    const m =
                                        candidateKey.match(blockFacePattern);
                                    if (m) {
                                        const base = `blocks/${m[1]}`;
                                        const faceKey = m[2];
                                        if (faceKey) {
                                            meta = atlas.getTextureMetadata(
                                                `${base}/${faceKey}`
                                            );
                                            if (
                                                meta &&
                                                meta.debugPath !== ERROR_KEY
                                            )
                                                return true;
                                        }
                                        meta = atlas.getTextureMetadata(base);
                                        if (
                                            meta &&
                                            meta.debugPath !== ERROR_KEY
                                        )
                                            return true;
                                    }
                                    // numeric id mapping
                                    if (!isNaN(parseInt(candidateKey))) {
                                        meta =
                                            atlas.getTextureMetadata(
                                                `${candidateKey}`
                                            ) ||
                                            atlas.getTextureMetadata(
                                                `blocks/${candidateKey}`
                                            );
                                        if (
                                            meta &&
                                            meta.debugPath !== ERROR_KEY
                                        )
                                            return true;
                                    }
                                    return false;
                                };

                                for (const key of candidates) {
                                    // Only accept non-error entries with real metadata bound
                                    if (!candidateHasGoodMetadata(key)) {
                                        // Make sure it's queued for load to become available next frame
                                        atlas.queueTextureForLoading(key);
                                        continue;
                                    }
                                    texCoords =
                                        atlas.getTextureUVCoordinateSync(
                                            key,
                                            uv
                                        );
                                    if (texCoords) {
                                        try {
                                            if (window.__TEX_DEBUG__) {
                                                console.log(
                                                    "[tex-debug] Resolved UV via candidate",
                                                    {
                                                        key,
                                                        id: blockType.id,
                                                        name: blockType.name,
                                                        face: blockFace,
                                                    }
                                                );
                                            }
                                        } catch (_) {}
                                        break;
                                    }
                                }

                                if (
                                    !texCoords &&
                                    typeof window !== "undefined"
                                ) {
                                    try {
                                        if (
                                            window.__TEX_DEBUG__ ||
                                            window.__LIGHT_DEBUG__
                                        ) {
                                            console.warn(
                                                "[tex-debug] Missing UV for custom single-face block",
                                                {
                                                    id: blockType.id,
                                                    name: blockType.name,
                                                    face: blockFace,
                                                    actualTextureUri,
                                                    candidates,
                                                }
                                            );
                                        }
                                    } catch (_) {}
                                }

                                // Fallback to name-based resolver like defaults use
                                if (!texCoords) {
                                    texCoords =
                                        BlockTextureAtlas.instance.getMultiSidedTextureUV(
                                            blockType.name,
                                            blockFace,
                                            uv
                                        );
                                    if (
                                        !texCoords &&
                                        typeof blockType.variantOfId ===
                                            "number"
                                    ) {
                                        // Try base name
                                        try {
                                            const base =
                                                BlockTypeRegistry.instance.getBlockType(
                                                    blockType.variantOfId
                                                );
                                            if (base) {
                                                texCoords =
                                                    BlockTextureAtlas.instance.getMultiSidedTextureUV(
                                                        base.name,
                                                        blockFace,
                                                        uv
                                                    );
                                            }
                                        } catch (_) {}
                                    }
                                    try {
                                        if (
                                            !texCoords &&
                                            window.__TEX_DEBUG__
                                        ) {
                                            console.warn(
                                                "[tex-debug] Name-based UV fallback failed",
                                                {
                                                    id: blockType.id,
                                                    name: blockType.name,
                                                    face: blockFace,
                                                }
                                            );
                                        }
                                    } catch (_) {}
                                }
                            } else {
                                // Non-custom block - use the block name for multi-sided lookup
                                texCoords =
                                    BlockTextureAtlas.instance.getMultiSidedTextureUV(
                                        blockType.name,
                                        blockFace,
                                        uv
                                    );
                            }

                            // Fallback to direct texture lookup if multi-sided failed
                            if (!texCoords && actualTextureUri) {
                                texCoords =
                                    BlockTextureAtlas.instance.getTextureUVCoordinateSync(
                                        actualTextureUri,
                                        uv
                                    );
                            }

                            // Final fallback to error texture
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

                            // Queue for loading if we got default coordinates
                            if (
                                texCoords[0] === 0 &&
                                texCoords[1] === 0 &&
                                actualTextureUri !== "./assets/blocks/error.png"
                            ) {
                                BlockTextureAtlas.instance.queueTextureForLoading(
                                    actualTextureUri
                                );
                                // Also queue id-based keys to be safe for customs
                                if (isCustomBlock) {
                                    BlockTextureAtlas.instance.queueTextureForLoading(
                                        String(blockType.id)
                                    );
                                    const faceCoordMap2 = {
                                        top: "+y",
                                        bottom: "-y",
                                        left: "-x",
                                        right: "+x",
                                        front: "+z",
                                        back: "-z",
                                    };
                                    const f2 =
                                        faceCoordMap2[blockFace] || blockFace;
                                    BlockTextureAtlas.instance.queueTextureForLoading(
                                        `blocks/${blockType.id}/${f2}.png`
                                    );
                                    if (
                                        typeof blockType.variantOfId ===
                                        "number"
                                    ) {
                                        BlockTextureAtlas.instance.queueTextureForLoading(
                                            `blocks/${blockType.variantOfId}/${f2}.png`
                                        );
                                        BlockTextureAtlas.instance.queueTextureForLoading(
                                            `blocks/${blockType.variantOfId}`
                                        );
                                    }
                                }
                            }

                            meshUvs.push(texCoords[0], texCoords[1]);

                            meshColors.push(
                                ...this._calculateVertexColor(
                                    { x: vertexX, y: vertexY, z: vertexZ },
                                    blockType,
                                    ao,
                                    chunkManager,
                                    actualDir // Pass rotated face normal for face-based shading
                                )
                            );

                            // compute light once per block using block coordinate center
                            if (blockLightLevel === null) {
                                blockLightLevel = this._calculateLightLevel(
                                    globalX,
                                    globalY,
                                    globalZ,
                                    nearbySources
                                );
                            }
                            const normalized =
                                blockLightLevel / MAX_LIGHT_LEVEL;
                            if (!blockType.isLiquid) {
                                solidMeshLightLevels.push(normalized);
                                if (normalized > 0)
                                    solidMeshHasLightLevel = true;
                            }
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
        try {
            if (
                typeof window !== "undefined" &&
                (window.__LIGHT_DEBUG__?.refresh ||
                    window.__LIGHT_DEBUG__ === true)
            ) {
                console.log(
                    "[light-build] chunk",
                    this.chunkId,
                    "nearbySources:",
                    nearbySources.length
                );
            }
        } catch (_) {}

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
                      lightLevels: solidMeshHasLightLevel
                          ? solidMeshLightLevels
                          : undefined,
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
        if (
            (!this._solidMesh && !this._liquidMesh) ||
            blockCoordinates.length > 50
        ) {
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

                // Get rotation for this block
                const blockRotation = this.getBlockRotation({ x, y, z });

                // === TRIMESH BLOCK RENDERING (partial) ===
                if (blockType.isTrimesh) {
                    const triangleData = blockType.trimeshTriangleData;
                    if (triangleData) {
                        for (const tri of triangleData) {
                            const ndx = solidMeshPositions.length / 3;
                            const actualTextureUri = blockType.getTexturePath(tri.blockFace);
                            const rn = blockRotation > 0
                                ? rotateDirection(tri.normal, blockRotation)
                                : tri.normal;
                            const triVerts = [
                                { pos: tri.v0, uv: tri.uv0 },
                                { pos: tri.v1, uv: tri.uv1 },
                                { pos: tri.v2, uv: tri.uv2 },
                            ];
                            for (const { pos, uv } of triVerts) {
                                const rp = blockRotation > 0
                                    ? rotateAroundBlockCenter(pos, blockRotation)
                                    : pos;
                                const vertexX = globalX + rp[0] - 0.5;
                                const vertexY = globalY + rp[1] - 0.5;
                                const vertexZ = globalZ + rp[2] - 0.5;
                                solidMeshPositions.push(vertexX, vertexY, vertexZ);
                                solidMeshNormals.push(rn[0], rn[1], rn[2]);
                                let texCoords = BlockTextureAtlas.instance.getMultiSidedTextureUV(
                                    blockType.name, tri.blockFace, uv
                                );
                                if (!texCoords) {
                                    texCoords = BlockTextureAtlas.instance.getTextureUVCoordinateSync(
                                        actualTextureUri, uv
                                    );
                                }
                                if (!texCoords) {
                                    texCoords = BlockTextureAtlas.instance.getTextureUVCoordinateSync(
                                        "./assets/blocks/error.png", uv
                                    );
                                }
                                if (!texCoords) texCoords = [0, 0, 1, 1];
                                solidMeshUvs.push(texCoords[0], texCoords[1]);
                                solidMeshColors.push(
                                    ...this._calculateVertexColor(
                                        { x: vertexX, y: vertexY, z: vertexZ },
                                        blockType, null, chunkManager, rn
                                    )
                                );
                            }
                            solidMeshIndices.push(ndx, ndx + 1, ndx + 2);
                        }
                    }
                    continue;
                }

                // === STANDARD CUBE BLOCK RENDERING (partial, with rotation) ===
                for (const blockFace of blockType.faces) {
                    const { normal: dir, vertices } =
                        blockType.faceGeometries[blockFace];

                    const actualDir = blockRotation > 0
                        ? rotateDirection(dir, blockRotation)
                        : dir;
                    const dnx = Math.round(actualDir[0]);
                    const dny = Math.round(actualDir[1]);
                    const dnz = Math.round(actualDir[2]);

                    const ex = x + 1 + dnx;
                    const ey = y + 1 + dny;
                    const ez = z + 1 + dnz;
                    const neighborBlockType =
                        this._extendedBlockTypes[ex] &&
                        this._extendedBlockTypes[ex][ey] &&
                        this._extendedBlockTypes[ex][ey][ez];
                    if (
                        neighborBlockType &&
                        !neighborBlockType.isTrimesh &&
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
                        const rp = blockRotation > 0
                            ? rotateAroundBlockCenter(pos, blockRotation)
                            : pos;
                        const vertexX = globalX + rp[0] - 0.5;
                        const vertexY = globalY + rp[1] - 0.5;
                        const vertexZ = globalZ + rp[2] - 0.5;
                        meshPositions.push(vertexX, vertexY, vertexZ);
                        meshNormals.push(actualDir[0], actualDir[1], actualDir[2]);

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
                            chunkManager,
                            actualDir // Pass rotated face normal for face-based shading
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

            return meshes;
        } catch (error) {
            // Error building partial meshes

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

        // Upgrade storage to Uint16Array on-demand if IDs exceed 255
        if (
            blockId > 255 &&
            this._blocks &&
            typeof this._blocks.BYTES_PER_ELEMENT === "number" &&
            this._blocks.BYTES_PER_ELEMENT === 1
        ) {
            try {
                const upgraded = new Uint16Array(this._blocks.length);
                for (let i = 0; i < this._blocks.length; i++) {
                    upgraded[i] = this._blocks[i];
                }
                this._blocks = upgraded;
            } catch (_) {}
        }
        const prev = this._blocks[blockIndex];
        this._blocks[blockIndex] = blockId;
        // Clear rotation when block is removed (set to air)
        if (blockId === 0) {
            this._blockRotations.delete(blockIndex);
        }
        try {
            const oldType = BlockTypeRegistry.instance.getBlockType(prev);
            const newType = BlockTypeRegistry.instance.getBlockType(blockId);
            if ((oldType?.lightLevel || 0) !== (newType?.lightLevel || 0)) {
                this.clearLightSourceCache();
            }
        } catch (e) {}
    }

    /**
     * Get the rotation index for a block at a local coordinate.
     * Returns 0 (no rotation) if not set.
     * @param {Object} localCoordinate - The local coordinate
     * @returns {number} The rotation index (0-23)
     */
    getBlockRotation(localCoordinate) {
        const idx = this._getIndex(localCoordinate);
        return this._blockRotations.get(idx) || 0;
    }
    /**
     * Set the rotation index for a block at a local coordinate.
     * Only stores non-zero rotations (sparse).
     * @param {Object} localCoordinate - The local coordinate
     * @param {number} rotationIndex - The rotation index (0-23)
     */
    setBlockRotation(localCoordinate, rotationIndex) {
        const idx = this._getIndex(localCoordinate);
        if (rotationIndex > 0 && rotationIndex < 24) {
            this._blockRotations.set(idx, rotationIndex);
        } else {
            this._blockRotations.delete(idx);
        }
    }
    /**
     * Get all block rotations as a Map.
     * @returns {Map<number, number>} blockIndex → rotationIndex
     */
    get blockRotations() {
        return this._blockRotations;
    }
    /**
     * Get the shape type for a block at a local coordinate.
     * Returns 'cube' if not set.
     * @param {Object} localCoordinate - The local coordinate
     * @returns {string} The shape type
     */
    getBlockShape(localCoordinate) {
        const idx = this._getIndex(localCoordinate);
        return this._blockShapes.get(idx) || 'cube';
    }
    /**
     * Set the shape type for a block at a local coordinate.
     * Only stores non-cube shapes (sparse).
     * @param {Object} localCoordinate - The local coordinate
     * @param {string} shapeType - The shape type
     */
    setBlockShape(localCoordinate, shapeType) {
        const idx = this._getIndex(localCoordinate);
        if (shapeType && shapeType !== 'cube') {
            this._blockShapes.set(idx, shapeType);
        } else {
            this._blockShapes.delete(idx);
        }
    }
    /**
     * Get all block shapes as a Map.
     * @returns {Map<number, string>} blockIndex → shapeType
     */
    get blockShapes() {
        return this._blockShapes;
    }
    // Minimal reversible nudge to guarantee a rebuild without visible change
    _nudgeBlockForRemesh() {
        const mid = Math.floor(CHUNK_SIZE / 2);
        const coord = { x: mid, y: mid, z: mid };
        const idx = this._getIndex(coord);
        const prev = this._blocks[idx];
        const temp = prev === 0 ? 1 : 0;
        this._blocks[idx] = temp;
        this._blocks[idx] = prev;
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
        if (!Chunk.isValidLocalCoordinate(localCoordinate)) {
            throw new Error(
                "Chunk.setBlock(): Block coordinate is out of bounds"
            );
        }
        const blockIndex = this._getIndex(localCoordinate);
        const oldBlockTypeId = this._blocks[blockIndex];

        if (oldBlockTypeId === blockTypeId) {
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
            return;
        }

        if (isBlockRemoval) {
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

        // Include rotation data in hash
        for (const [idx, rot] of this._blockRotations) {
            hash = (hash << 5) - hash + (idx * 37 + rot * 41);
            hash = hash & hash;
        }

        // Include shape data in hash
        for (const [idx, shape] of this._blockShapes) {
            let shapeHash = 0;
            for (let c = 0; c < shape.length; c++) {
                shapeHash = (shapeHash << 5) - shapeHash + shape.charCodeAt(c);
                shapeHash = shapeHash & shapeHash;
            }
            hash = (hash << 5) - hash + (idx * 43 + shapeHash);
            hash = hash & hash;
        }

        return hash;
    }
    /**
     * Calculate vertex color with face-based shading, ambient occlusion, and sky light.
     * Matches SDK's ChunkWorker lighting approach EXACTLY.
     * 
     * SDK Formula: (baseColor - ao) * faceShade * skyLight
     * - ao values: [0, 0.5, 0.7, 0.9] indexed by neighbor count
     * - faceShade: 1.0 (top), 0.8 (side), 0.5 (bottom)
     * - skyLight: 0.3-1.0 based on distance to sky (blocks above)
     * 
     * @param {Object} vertexCoordinate - The vertex coordinate
     * @param {BlockType} blockType - The block type
     * @param {Object} blockFaceAO - The block face AO data { corner, side1, side2 }
     * @param {ChunkManager} chunkManager - The chunk manager
     * @param {Array} faceNormal - The face normal [x, y, z] for face-based shading
     * @returns {Array} The vertex color [r, g, b, a]
     * @private
     */
    _calculateVertexColor(
        vertexCoordinate,
        blockType,
        blockFaceAO,
        chunkManager,
        faceNormal = null
    ) {
        const baseColor = blockType.color;
        const vx = vertexCoordinate.x;
        const vy = vertexCoordinate.y;
        const vz = vertexCoordinate.z;
        
        // === AMBIENT OCCLUSION (SDK-compatible) ===
        // Count neighboring solid blocks at this vertex corner
        // aoIntensityLevel: 0=no neighbors, 1=1 neighbor, 2=2 neighbors, 3=3 neighbors
        let aoIntensityLevel = 0;
        
        if (blockFaceAO && this._extendedBlockTypes) {
            // Check corner neighbor
            if (blockFaceAO.corner) {
                const nx = Math.floor(vx + blockFaceAO.corner[0]);
                const ny = Math.floor(vy + blockFaceAO.corner[1]);
                const nz = Math.floor(vz + blockFaceAO.corner[2]);
                const neighbor = this._getGlobalBlockType(nx, ny, nz, chunkManager);
                if (neighbor && !neighbor.isLiquid) {
                    aoIntensityLevel++;
                }
            }
            
            // Check side1 neighbor
            if (blockFaceAO.side1) {
                const nx = Math.floor(vx + blockFaceAO.side1[0]);
                const ny = Math.floor(vy + blockFaceAO.side1[1]);
                const nz = Math.floor(vz + blockFaceAO.side1[2]);
                const neighbor = this._getGlobalBlockType(nx, ny, nz, chunkManager);
                if (neighbor && !neighbor.isLiquid) {
                    aoIntensityLevel++;
                }
            }
            
            // Check side2 neighbor
            if (blockFaceAO.side2) {
                const nx = Math.floor(vx + blockFaceAO.side2[0]);
                const ny = Math.floor(vy + blockFaceAO.side2[1]);
                const nz = Math.floor(vz + blockFaceAO.side2[2]);
                const neighbor = this._getGlobalBlockType(nx, ny, nz, chunkManager);
                if (neighbor && !neighbor.isLiquid) {
                    aoIntensityLevel++;
                }
            }
        }
        
        // Get AO amount to subtract (SDK: [0, 0.5, 0.7, 0.9])
        const aoLevels = blockType.aoIntensity || DEFAULT_BLOCK_AO_INTENSITY;
        const ao = aoLevels[aoIntensityLevel] || 0;
        
        // === FACE-BASED SHADING (SDK-compatible) ===
        // Determine brightness based on face direction using simple threshold
        let faceShade = FACE_SHADE_SIDE; // Default: 0.8 for sides
        
        if (faceNormal && Array.isArray(faceNormal)) {
            const ny = faceNormal[1];
            // SDK uses: ny > 0 ? TOP : ny < 0 ? BOTTOM : SIDE
            if (ny > 0) {
                faceShade = FACE_SHADE_TOP;    // 1.0
            } else if (ny < 0) {
                faceShade = FACE_SHADE_BOTTOM; // 0.5
            }
        }
        
        // === SKY LIGHT (SDK-compatible baked lighting) ===
        // Darken areas that are covered/indoors based on distance to sky
        const skyLight = this._calculateSkyLight(vx, vy, vz, faceNormal, chunkManager);
        
        // === SDK FORMULA: (baseColor - ao) * faceShade * skyLight ===
        return [
            (baseColor[0] - ao) * faceShade * skyLight,
            (baseColor[1] - ao) * faceShade * skyLight,
            (baseColor[2] - ao) * faceShade * skyLight,
            baseColor[3]
        ];
    }
    
    /**
     * Calculates sky light exposure for a given surface position.
     * Traces upward from the air space in front of the face to check for sky access.
     * Uses the face normal to offset the check position so side faces check from
     * the correct perspective (the air in front of them, not inside the block).
     * 
     * @param {number} x - Vertex X coordinate
     * @param {number} y - Vertex Y coordinate
     * @param {number} z - Vertex Z coordinate
     * @param {Array} faceNormal - The face normal [x, y, z]
     * @param {ChunkManager} chunkManager - The chunk manager
     * @returns {number} Brightness multiplier (SKY_LIGHT_MIN_BRIGHTNESS to 1.0)
     * @private
     */
    _calculateSkyLight(x, y, z, faceNormal, chunkManager) {
        // Default to full brightness if no face normal
        if (!faceNormal || !Array.isArray(faceNormal)) {
            return 1.0;
        }
        
        // Offset check position by 0.5 in the direction of the face normal
        // This ensures we check from the air space in front of the face
        const checkX = Math.floor(x + faceNormal[0] * 0.5);
        const checkZ = Math.floor(z + faceNormal[2] * 0.5);
        
        // For top-facing surfaces, start from current Y
        // For other surfaces, start from the offset position
        const startY = Math.floor(y + faceNormal[1] * 0.5);
        
        // Trace upward to find first solid block or reach max distance (sky)
        for (let dy = 1; dy <= SKY_LIGHT_MAX_DISTANCE; dy++) {
            const checkY = startY + dy;
            const blockType = this._getGlobalBlockType(checkX, checkY, checkZ, chunkManager);
            
            // If we hit a solid block (not air, not liquid), we're under cover
            // Air returns null/undefined, liquids let light through
            if (blockType && !blockType.isLiquid) {
                // Use precomputed LUT to avoid operations in hot path
                return SKY_LIGHT_BRIGHTNESS_LUT[dy];
            }
        }
        
        // Clear path to sky - full brightness
        return 1.0;
    }
    
    /**
     * Get block type at global coordinates
     * @private
     */
    _getGlobalBlockType(globalX, globalY, globalZ, chunkManager) {
        // Convert global to local chunk coordinates
        const localX = Math.floor(globalX - this.originCoordinate.x);
        const localY = Math.floor(globalY - this.originCoordinate.y);
        const localZ = Math.floor(globalZ - this.originCoordinate.z);
        
        // Check if within extended block types array (includes +1 border)
        const ex = localX + 1;
        const ey = localY + 1;
        const ez = localZ + 1;
        
        if (ex >= 0 && ex < CHUNK_SIZE + 2 &&
            ey >= 0 && ey < CHUNK_SIZE + 2 &&
            ez >= 0 && ez < CHUNK_SIZE + 2) {
            return this._extendedBlockTypes?.[ex]?.[ey]?.[ez] || null;
        }
        
        // If outside extended area, use ChunkManager's getGlobalBlockType
        if (chunkManager && chunkManager.getGlobalBlockType) {
            return chunkManager.getGlobalBlockType({
                x: Math.floor(globalX),
                y: Math.floor(globalY),
                z: Math.floor(globalZ)
            }) || null;
        }
        
        return null;
    }

    _calculateLightLevel(x, y, z, sources) {
        let maxLevel = 0;
        for (const s of sources) {
            const dx = x - s.position.x + 0.5;
            const dy = y - s.position.y + 0.5;
            const dz = z - s.position.z + 0.5;
            if (
                Math.abs(dx) > s.level ||
                Math.abs(dy) > s.level ||
                Math.abs(dz) > s.level
            )
                continue;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (distance >= s.level) continue;
            maxLevel = Math.max(maxLevel, s.level - distance);
        }
        return Math.min(MAX_LIGHT_LEVEL, Math.max(0, maxLevel));
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

    /**
     * Get cached trimesh triangle data for a shape type.
     * Lazily computes and caches the data from BlockShapes definitions.
     * @param {string} shapeType - The shape type string
     * @returns {Array|null} Triangle data array or null if shape not found
     */
    _getTrimeshTriangleDataForShape(shapeType) {
        if (TRIMESH_DEBUG && shapeType.includes('corner')) {
            console.log('[Chunk] Getting trimesh data for shape:', shapeType);
        }

        if (Chunk._shapeTriangleDataCache.has(shapeType)) {
            const cached = Chunk._shapeTriangleDataCache.get(shapeType);
            if (TRIMESH_DEBUG && shapeType.includes('corner')) {
                console.log('[Chunk] Using cached data, triangles:', cached?.length);
            }
            return cached;
        }

        const shapeDef = getShapeDefinition(shapeType);
        if (TRIMESH_DEBUG && shapeType.includes('corner')) {
            console.log('[Chunk] Shape definition:', shapeDef ? {
                type: shapeDef.type,
                name: shapeDef.name,
                vertexCount: shapeDef.vertices.length / 3,
                indexCount: shapeDef.indices.length
            } : 'NULL');
        }

        if (!shapeDef) return null;
        const data = buildTrimeshTriangleData(shapeDef.vertices, shapeDef.indices, shapeType);
        if (TRIMESH_DEBUG && shapeType.includes('corner')) {
            console.log('[Chunk] Built triangle data, count:', data.length);
        }
        Chunk._shapeTriangleDataCache.set(shapeType, data);
        return data;
    }
}

// Shape triangle data cache (shared across all chunks)
Chunk._shapeTriangleDataCache = new Map();

// DEBUG: Helper to clear the shape cache for testing
Chunk.clearShapeCache = function() {
    console.log('[Chunk] Clearing shape triangle data cache');
    Chunk._shapeTriangleDataCache.clear();
};

// DEBUG: Expose cache for inspection
if (TRIMESH_DEBUG) {
    console.log('[Chunk] TRIMESH_DEBUG is ENABLED - corner stairs debugging active');
    // Make cache accessible from console
    window.__CHUNK_SHAPE_CACHE__ = Chunk._shapeTriangleDataCache;
    window.__clearShapeCache = Chunk.clearShapeCache;
}

export default Chunk;
