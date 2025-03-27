// Chunk.js
// Represents a chunk in the world

import BlockTypeRegistry from '../blocks/BlockTypeRegistry';
import { CHUNK_SIZE, CHUNK_INDEX_RANGE } from './ChunkConstants';
import BlockTextureAtlas from '../blocks/BlockTextureAtlas';

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
      throw new Error(`Chunk.constructor(): Chunk origin coordinate must be divisible by CHUNK_SIZE (${CHUNK_SIZE}).`);
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
      z: globalCoordinate.z & ~(CHUNK_SIZE - 1)
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
      z: globalCoordinate.z & (CHUNK_SIZE - 1)
    };
  }

  /**
   * Check if a local coordinate is valid
   * @param {Object} localCoordinate - The local coordinate
   * @returns {boolean} True if the local coordinate is valid
   */
  static isValidLocalCoordinate(localCoordinate) {
    return localCoordinate.x >= 0 && localCoordinate.x <= CHUNK_INDEX_RANGE &&
           localCoordinate.y >= 0 && localCoordinate.y <= CHUNK_INDEX_RANGE &&
           localCoordinate.z >= 0 && localCoordinate.z <= CHUNK_INDEX_RANGE;
  }

  /**
   * Check if an origin coordinate is valid
   * @param {Object} originCoordinate - The origin coordinate
   * @returns {boolean} True if the origin coordinate is valid
   */
  static isValidOriginCoordinate(originCoordinate) {
    return originCoordinate.x % CHUNK_SIZE === 0 && 
           originCoordinate.y % CHUNK_SIZE === 0 &&
           originCoordinate.z % CHUNK_SIZE === 0;
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
    
    // Always set the visibility regardless of whether it changed
    this._visible = isVisible;
    
    // Always update mesh visibility to ensure THREE.js registers it
    this._updateMeshVisibility();
   	
  }

  /**
   * Update mesh visibility based on chunk visibility
   * @private
   */
  _updateMeshVisibility() {
    // Always explicitly set the visibility even if it hasn't changed
    // This ensures THREE.js registers the update
    if (this._solidMesh) {
      if (this._solidMesh.visible !== this._visible) {
        //console.log(`Chunk ${this.chunkId} solid mesh visibility changing to ${this._visible}`);
      }
      this._solidMesh.visible = this._visible;
    }
    
    if (this._liquidMesh) {
      if (this._liquidMesh.visible !== this._visible) {
        //console.log(`Chunk ${this.chunkId} liquid mesh visibility changing to ${this._visible}`);
      }
      this._liquidMesh.visible = this._visible;
    }
    
    // Force immediate update of the scene
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
          blockTypes[ex][ey][ez] = chunkManager.getGlobalBlockType({ x: globalX, y: globalY, z: globalZ });
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
    const skipNeighbors = options && options.skipNeighbors === true;
    const forceCompleteRebuild = options && options.forceCompleteRebuild === true;
    const hasAddedBlocks = options && options.added && options.added.length > 0;
    const hasRemovedBlocks = options && options.removed && options.removed.length > 0;
    const perfId = `buildMeshes-${this.chunkId}${skipNeighbors ? '-fast' : ''}`;
    
    // If the chunk hasn't changed and we're not forcing a rebuild, skip the mesh build
    // Never skip if we have explicit added/removed blocks
    if (!forceCompleteRebuild && !hasAddedBlocks && !hasRemovedBlocks && this._meshHashCode) {
      const currentHashCode = this._calculateBlocksHashCode();
      if (currentHashCode === this._meshHashCode) {
        return;
      }
    }
    
    // Add a safety check for existing timers
    try {
      console.time(perfId);
    } catch (e) {
      // If timer already exists, log a warning but continue
      console.warn(`Timer '${perfId}' already exists, continuing with mesh build`);
    }
      
    //console.log(`Building full meshes for chunk ${this.chunkId}`);

    // Always remove any existing meshes first
    if (this._solidMesh) {
      chunkManager.chunkMeshManager.removeSolidMesh(this);
      this._solidMesh = undefined;
    }
    
    if (this._liquidMesh) {
      chunkManager.chunkMeshManager.removeLiquidMesh(this);
      this._liquidMesh = undefined;
    }
    
    // Force THREE.js to update the scene to ensure old meshes are gone
    if (chunkManager._scene && chunkManager._scene.updateMatrixWorld) {
      chunkManager._scene.updateMatrixWorld(true);
    }
    
    // Initialize mesh geometry arrays
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
    
    // Precompute extended block types
    this._extendedBlockTypes = this._getExtendedBlockTypes(chunkManager);

    let verticesProcessed = 0;
    //let visibleFacesGenerated = 0;
    
    for (let y = 0; y < CHUNK_SIZE; y++) {
      const globalY = originY + y;
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const globalZ = originZ + z;
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const globalX = originX + x;
          const blockType = this.getLocalBlockType({ x, y, z });

          // Skip air blocks for mesh generation
          if (!blockType) {
            continue;
          }

          // Process each face of this block
          for (const blockFace of blockType.faces) {
            const { normal: dir, vertices } = blockType.faceGeometries[blockFace];
            
            // Use extended block types array instead of getGlobalBlockType
            const ex = x + 1 + dir[0];
            const ey = y + 1 + dir[1];
            const ez = z + 1 + dir[2];
            const neighborBlockType = this._extendedBlockTypes[ex][ey][ez];

            // Detailed debug logging for face culling decisions (reduced frequency)
            const shouldCullFace = neighborBlockType &&
                (neighborBlockType.isLiquid || !neighborBlockType.isFaceTransparent(blockFace)) &&
                (!neighborBlockType.isLiquid || neighborBlockType.id === blockType.id);
            
            if (shouldCullFace) {
              continue; // cull face
            }
            
            //visibleFacesGenerated++;

            const meshColors = blockType.isLiquid ? liquidMeshColors : solidMeshColors;
            const meshIndices = blockType.isLiquid ? liquidMeshIndices : solidMeshIndices;
            const meshNormals = blockType.isLiquid ? liquidMeshNormals : solidMeshNormals;
            const meshPositions = blockType.isLiquid ? liquidMeshPositions : solidMeshPositions;
            const meshUvs = blockType.isLiquid ? liquidMeshUvs : solidMeshUvs;

            const ndx = meshPositions.length / 3;
            const textureUri = blockType.textureUris[blockFace];
            
            // Process vertices for this face
            for (const { pos, uv, ao } of vertices) {
              verticesProcessed++;
              const vertexX = globalX + pos[0] - 0.5;
              const vertexY = globalY + pos[1] - 0.5;
              const vertexZ = globalZ + pos[2] - 0.5;

              meshPositions.push(vertexX, vertexY, vertexZ);
              meshNormals.push(...dir);

              // Calculate UV coords for face texture
              // Determine texture path based on block face - this correctly handles data URIs
              const actualTextureUri = blockType.getTexturePath(blockFace);
                                 
              // Variable to store texture coordinates
              let texCoords;
          
              // If not handled by special case, continue with normal handling
              if (!texCoords) {
                // Special debug for multi-sided blocks
                if (blockType.isMultiSided) {
                  console.debug(`Multi-sided block at (${globalX},${globalY},${globalZ}): ${blockType.name}, face: ${blockFace}`);
                }
                
                // Special handling for liquid blocks
                if (blockType.isLiquid) {
                  const liquidTexturePath = blockType.getTextureUris().top || './assets/blocks/water-still.png';
                  texCoords = BlockTextureAtlas.instance.getTextureUVCoordinateSync(liquidTexturePath, uv);
                }
                // Special handling for multi-sided blocks
                else if (blockType.isMultiSided) {
                  // First try using getMultiSidedTextureUV which handles multi-sided textures specially
                  texCoords = BlockTextureAtlas.instance.getMultiSidedTextureUV(blockType.name, blockFace, uv);
                  
                  // If that didn't work, try the direct path from getTexturePath
                  if (!texCoords || (texCoords[0] === 0 && texCoords[1] === 0)) {
                    texCoords = BlockTextureAtlas.instance.getTextureUVCoordinateSync(actualTextureUri, uv);
                  }
                } else {
                  // The normal case - get texture UV coordinates from the atlas
                  texCoords = BlockTextureAtlas.instance.getTextureUVCoordinateSync(actualTextureUri, uv);
                }
                
                if (!texCoords && actualTextureUri) {
                  // If not in atlas yet, synchronously get coordinates, ensuring it's added
                  texCoords = BlockTextureAtlas.instance.getTextureUVCoordinateSync(actualTextureUri, uv);
                }
                
                if (!texCoords) {
                  // Still no coordinates? Use error texture
                  texCoords = BlockTextureAtlas.instance.getTextureUVCoordinateSync('./assets/blocks/error.png', uv);
                  
                  if (!texCoords) {
                    // Last resort - use default UV coordinates
                    texCoords = [0, 0, 1, 1];
                  }
                }
                
                // Queue textures for loading if they're missing
                if (texCoords[0] === 0 && texCoords[1] === 0 && actualTextureUri !== './assets/blocks/error.png') {
                  BlockTextureAtlas.instance.queueTextureForLoading(actualTextureUri);
                }
              }
              
              // Push the UV coordinates
              meshUvs.push(texCoords[0], texCoords[1]);

              // Calculate vertex colors (Ambient occlusion)
              meshColors.push(...this._calculateVertexColor(
                { x: vertexX, y: vertexY, z: vertexZ },
                blockType,
                ao,
                chunkManager
              ));
            }

            meshIndices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
          }
        }
      }
    }
   // console.log(`Processed ${verticesProcessed} vertices for chunk ${this.chunkId}`);
    
    // Create meshes using ChunkMeshManager
    //console.time(`${perfId}-createMeshes`);
    //console.time(`${perfId}-createLiquidMesh`);
    this._liquidMesh = liquidMeshPositions.length > 0 
      ? chunkManager.chunkMeshManager.getLiquidMesh(this, {
          colors: liquidMeshColors,
          indices: liquidMeshIndices,
          normals: liquidMeshNormals,
          positions: liquidMeshPositions,
          uvs: liquidMeshUvs,
        }) 
      : undefined;
    //console.timeEnd(`${perfId}-createLiquidMesh`);

    //console.time(`${perfId}-createSolidMesh`);
    this._solidMesh = solidMeshPositions.length > 0 
      ? chunkManager.chunkMeshManager.getSolidMesh(this, {
          colors: solidMeshColors,
          indices: solidMeshIndices,
          normals: solidMeshNormals,
          positions: solidMeshPositions,
          uvs: solidMeshUvs,
        }) 
      : undefined;
    //console.timeEnd(`${perfId}-createSolidMesh`);

    this._updateMeshVisibility();
    //console.timeEnd(`${perfId}-createMeshes`);
    
    // Store the hash code for this chunks blocks to detect future changes
    this._meshHashCode = this._calculateBlocksHashCode();
    
    // Clean up extended block types array
    delete this._extendedBlockTypes;
    
    // End the performance timer for this mesh build
    try {
      console.timeEnd(perfId);
    } catch (e) {
      // Timer might not exist or might have been cleared already
    }
    
    // Add meshes to the scene
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
    console.log(`Building partial meshes for ${blockCoordinates.length} blocks in chunk ${this.chunkId}`);
    
    // If we don't have existing meshes, do a full build
    if ((!this._solidMesh && !this._liquidMesh) || blockCoordinates.length > 50) {
      console.log(`Falling back to full rebuild for chunk ${this.chunkId} - no existing meshes or too many blocks (${blockCoordinates.length})`);
      console.timeEnd(perfId);
      return this.buildMeshes(chunkManager);
    }
    
    try {
      // Handle the block coordinates correctly - they could be either global or local
      // We need to convert them to local coordinates for processing
      const localCoordinates = [];
      
      for (const coord of blockCoordinates) {
        // If coord is already a local coordinate within this chunk
        if (coord.x >= 0 && coord.x < CHUNK_SIZE && 
            coord.y >= 0 && coord.y < CHUNK_SIZE && 
            coord.z >= 0 && coord.z < CHUNK_SIZE) {
          localCoordinates.push(coord);
        } 
        // If coord is a global coordinate
        else {
          // Check if this global coordinate belongs to this chunk
          const originCoord = Chunk.globalCoordinateToOriginCoordinate(coord);
          if (originCoord.x === this.originCoordinate.x && 
              originCoord.y === this.originCoordinate.y && 
              originCoord.z === this.originCoordinate.z) {
            // Convert to local
            localCoordinates.push(Chunk.globalCoordinateToLocalCoordinate(coord));
          }
        }
      }
      
      if (localCoordinates.length === 0) {
        console.log(`No valid local coordinates for this chunk - skipping partial mesh update`);
        console.timeEnd(perfId);
        return { liquidMesh: this._liquidMesh, solidMesh: this._solidMesh };
      }

      // Expand the range to include neighboring blocks
      const effectiveRange = new Set();
      const processedBlocks = new Set();
      
      for (const coord of localCoordinates) {
        // Skip if out of bounds
        if (!Chunk.isValidLocalCoordinate(coord)) {
          continue;
        }
        
        // Add this block
        effectiveRange.add(`${coord.x},${coord.y},${coord.z}`);
        
        // Add neighbors (consider diagonals too for AO)
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              const nx = coord.x + dx;
              const ny = coord.y + dy;
              const nz = coord.z + dz;
              
              // Skip if this would be out of bounds
              if (nx < 0 || nx >= CHUNK_SIZE ||
                  ny < 0 || ny >= CHUNK_SIZE ||
                  nz < 0 || nz >= CHUNK_SIZE) {
                continue;
              }
              
              effectiveRange.add(`${nx},${ny},${nz}`);
            }
          }
        }
      }
      
      // Prepare mesh arrays
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

      // Precompute extended block types
      this._extendedBlockTypes = this._getExtendedBlockTypes(chunkManager);

      // Generate meshes for all blocks in the effective range
      for (const blockKey of effectiveRange) {
        const [x, y, z] = blockKey.split(',').map(Number);
        const globalX = originX + x;
        const globalY = originY + y;
        const globalZ = originZ + z;
        
        // Skip if we've already processed this block
        if (processedBlocks.has(blockKey)) continue;
        processedBlocks.add(blockKey);
        
        const blockType = this.getLocalBlockType({ x, y, z });

        if (!blockType) { // air, ignore
          continue; 
        }

        for (const blockFace of blockType.faces) {
          const { normal: dir, vertices } = blockType.faceGeometries[blockFace];
          
          // Use extended block types array instead of getGlobalBlockType
          const ex = x + 1 + dir[0];
          const ey = y + 1 + dir[1];
          const ez = z + 1 + dir[2];
          const neighborBlockType = this._extendedBlockTypes[ex][ey][ez];

          if (
            neighborBlockType &&
            (neighborBlockType.isLiquid || !neighborBlockType.isFaceTransparent(blockFace)) &&
            (!neighborBlockType.isLiquid || neighborBlockType.id === blockType.id)
          ) {
            continue; // cull face
          }

          const meshColors = blockType.isLiquid ? liquidMeshColors : solidMeshColors;
          const meshIndices = blockType.isLiquid ? liquidMeshIndices : solidMeshIndices;
          const meshNormals = blockType.isLiquid ? liquidMeshNormals : solidMeshNormals;
          const meshPositions = blockType.isLiquid ? liquidMeshPositions : solidMeshPositions;
          const meshUvs = blockType.isLiquid ? liquidMeshUvs : solidMeshUvs;

          const ndx = meshPositions.length / 3;
          const textureUri = blockType.textureUris[blockFace];
          
          // Process vertices for this face
          for (const { pos, uv, ao } of vertices) {
            const vertexX = globalX + pos[0] - 0.5;
            const vertexY = globalY + pos[1] - 0.5;
            const vertexZ = globalZ + pos[2] - 0.5;
            
            meshPositions.push(vertexX, vertexY, vertexZ);
            meshNormals.push(...dir);
            
            // Calculate UV coordinates
            const actualTextureUri = blockType.getTexturePath(blockFace);
            let texCoords;
            
            // Special debug for multi-sided blocks
            if (blockType.isMultiSided) {
              console.debug(`Multi-sided block at (${globalX},${globalY},${globalZ}): ${blockType.name}, face: ${blockFace}`);
            }
              
            if (!texCoords) {
              // Special handling for liquid blocks
              if (blockType.isLiquid) {
                const liquidTexturePath = blockType.getTextureUris().top || './assets/blocks/water-still.png';
                texCoords = BlockTextureAtlas.instance.getTextureUVCoordinateSync(liquidTexturePath, uv);
              }
              // Special handling for multi-sided blocks
              else if (blockType.isMultiSided) {
                // First try using getMultiSidedTextureUV which handles multi-sided textures specially
                texCoords = BlockTextureAtlas.instance.getMultiSidedTextureUV(blockType.name, blockFace, uv);
                
                // If that didn't work, try the direct path from getTexturePath
                if (!texCoords || (texCoords[0] === 0 && texCoords[1] === 0)) {
                  texCoords = BlockTextureAtlas.instance.getTextureUVCoordinateSync(actualTextureUri, uv);
                }
              } else {
                // Get texture coordinates
                texCoords = BlockTextureAtlas.instance.getTextureUVCoordinateSync(actualTextureUri, uv);
              }
              
              if (!texCoords && actualTextureUri) {
                texCoords = BlockTextureAtlas.instance.getTextureUVCoordinateSync(actualTextureUri, uv);
              }
              
              if (!texCoords) {
                texCoords = BlockTextureAtlas.instance.getTextureUVCoordinateSync('./assets/blocks/error.png', uv);
                
                if (!texCoords) {
                  texCoords = [0, 0, 1, 1];
                }
              }
              
              // Queue textures for loading if they're missing
              if (texCoords[0] === 0 && texCoords[1] === 0 && actualTextureUri !== './assets/blocks/error.png') {
                BlockTextureAtlas.instance.queueTextureForLoading(actualTextureUri);
              }
            }
            
            // Push the UV coordinates
            meshUvs.push(texCoords[0], texCoords[1]);

            // Calculate vertex color with ambient occlusion
            const vertexCoordinate = {
              x: vertexX,
              y: vertexY,
              z: vertexZ,
            };

            const vertexColor = this._calculateVertexColor(vertexCoordinate, blockType, ao, chunkManager);
            meshColors.push(...vertexColor);
          }

          meshIndices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
        }
      }

      // Create new meshes from the generated data
      const meshes = {
        solidMesh: undefined,
        liquidMesh: undefined,
      };

      // Create meshes only if we have vertices
      if (solidMeshPositions.length > 0) {
        // Remove previous solid mesh if it exists
        if (this._solidMesh) {
          chunkManager.chunkMeshManager.removeSolidMesh(this);
        }
        
        // Create new solid mesh
        meshes.solidMesh = chunkManager.chunkMeshManager.getSolidMesh(this, {
          positions: solidMeshPositions,
          normals: solidMeshNormals,
          uvs: solidMeshUvs,
          indices: solidMeshIndices,
          colors: solidMeshColors,
        });
        
        this._solidMesh = meshes.solidMesh;
      }

      if (liquidMeshPositions.length > 0) {
        // Remove previous liquid mesh if it exists
        if (this._liquidMesh) {
          chunkManager.chunkMeshManager.removeLiquidMesh(this);
        }
        
        // Create new liquid mesh
        meshes.liquidMesh = chunkManager.chunkMeshManager.getLiquidMesh(this, {
          positions: liquidMeshPositions,
          normals: liquidMeshNormals,
          uvs: liquidMeshUvs,
          indices: liquidMeshIndices,
          colors: liquidMeshColors,
        });
        
        this._liquidMesh = meshes.liquidMesh;
      }

      // Update visibility for both meshes
      this._updateMeshVisibility();

      // Clean up extended block types array
      delete this._extendedBlockTypes;

      console.log(`Successfully built partial mesh for chunk ${this.chunkId} with ${blockCoordinates.length} affected blocks (expanded to ${effectiveRange.size} blocks)`);
      console.timeEnd(perfId);
      return meshes;
    } catch (error) {
      console.error(`Error building partial meshes for chunk ${this.chunkId}:`, error);
      console.timeEnd(perfId);
      // Fall back to full rebuild in case of error
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
      throw new Error('Chunk.setLocalBlockId(): Block coordinate is out of bounds');
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
    
    // Since the cache keys include block type and AO data, which are complex,
    // we'll just clear the entire cache when a block is updated
    this._vertexColorCache.clear();
  }

  /**
   * Set a block at a local coordinate
   * @param {Object} localCoordinate - The local coordinate
   * @param {number} blockTypeId - The block type ID
   * @param {ChunkManager} chunkManager - The chunk manager
   */
  setBlock(localCoordinate, blockTypeId, chunkManager) {
    // Reduce performance logging to avoid console spam
    const shouldLogPerf = Math.random() < 0.01; // Only log 1% of operations
    if (shouldLogPerf) {
      console.time(`setBlock-${this.chunkId}`);
    }
    
    if (!Chunk.isValidLocalCoordinate(localCoordinate)) {
      if (shouldLogPerf) {
        console.timeEnd(`setBlock-${this.chunkId}`);
      }
      throw new Error('Chunk.setBlock(): Block coordinate is out of bounds');
    }

    const blockIndex = this._getIndex(localCoordinate);
    const oldBlockTypeId = this._blocks[blockIndex];

    // If the block type is the same, no need to update
    if (oldBlockTypeId === blockTypeId) {
      if (shouldLogPerf) {
        console.timeEnd(`setBlock-${this.chunkId}`);
      }
      return;
    }

    // Is this a block removal operation?
    const isBlockRemoval = oldBlockTypeId !== 0 && blockTypeId === 0;
    
    // Update the block
    this._blocks[blockIndex] = blockTypeId;

    // Clear the vertex color cache for this block and its neighbors
    this.clearVertexColorCache(localCoordinate);
    
    // Track if this is the first block placed in the chunk
    const isFirstBlockInChunk = oldBlockTypeId === 0 && blockTypeId !== 0 && 
                               this._blocks.filter(id => id !== 0).length === 1;
    
    // For the first block in a chunk, we need a full remesh
    if (isFirstBlockInChunk) {
      chunkManager.markChunkForRemesh(this.chunkId);
      if (shouldLogPerf) {
        console.timeEnd(`setBlock-${this.chunkId}`);
      }
      return;
    }
    
    // For block removal (block to air transitions), ALWAYS do a full chunk rebuild
    // This ensures all faces are properly updated
    if (isBlockRemoval) {
      // Reduce logging to avoid spam
      if (Math.random() < 0.1) {
        console.log(`Block removal at (${localCoordinate.x},${localCoordinate.y},${localCoordinate.z}) - doing full chunk rebuild`);
      }
      
      // Force removal of all existing meshes before requesting a rebuild
      if (this._solidMesh) {
        chunkManager.chunkMeshManager.removeSolidMesh(this);
        this._solidMesh = undefined;
      }
      
      if (this._liquidMesh) {
        chunkManager.chunkMeshManager.removeLiquidMesh(this);
        this._liquidMesh = undefined;
      }
      
      // Special flag to force complete rebuild
      chunkManager.markChunkForRemesh(this.chunkId, { forceCompleteRebuild: true });
      
      // Check adjacent chunks only if this block is on the edge of the chunk
      const isOnChunkEdge = 
        localCoordinate.x === 0 || 
        localCoordinate.y === 0 || 
        localCoordinate.z === 0 || 
        localCoordinate.x === CHUNK_INDEX_RANGE || 
        localCoordinate.y === CHUNK_INDEX_RANGE || 
        localCoordinate.z === CHUNK_INDEX_RANGE;

      if (isOnChunkEdge) {
        const globalCoordinate = this._getGlobalCoordinate(localCoordinate);
        const adjacentEdgeBlockCoordinateDeltas = [];
        
        // Only add the directions where the block is on the edge
        if (localCoordinate.x === 0) adjacentEdgeBlockCoordinateDeltas.push({ x: -1, y: 0, z: 0 });
        if (localCoordinate.y === 0) adjacentEdgeBlockCoordinateDeltas.push({ x: 0, y: -1, z: 0 });
        if (localCoordinate.z === 0) adjacentEdgeBlockCoordinateDeltas.push({ x: 0, y: 0, z: -1 });
        if (localCoordinate.x === CHUNK_INDEX_RANGE) adjacentEdgeBlockCoordinateDeltas.push({ x: 1, y: 0, z: 0 });
        if (localCoordinate.y === CHUNK_INDEX_RANGE) adjacentEdgeBlockCoordinateDeltas.push({ x: 0, y: 1, z: 0 });
        if (localCoordinate.z === CHUNK_INDEX_RANGE) adjacentEdgeBlockCoordinateDeltas.push({ x: 0, y: 0, z: 1 });

        // Force remesh adjacent chunks
        for (const adjacentEdgeBlockCoordinateDelta of adjacentEdgeBlockCoordinateDeltas) {
          const adjacentEdgeBlockGlobalCoordinate = {
            x: globalCoordinate.x + adjacentEdgeBlockCoordinateDelta.x,
            y: globalCoordinate.y + adjacentEdgeBlockCoordinateDelta.y,
            z: globalCoordinate.z + adjacentEdgeBlockCoordinateDelta.z,
          };

          // Get the adjacent chunk's ID
          const adjacentChunkOriginCoordinate = Chunk.globalCoordinateToOriginCoordinate(adjacentEdgeBlockGlobalCoordinate);
          const adjacentChunkId = Chunk.getChunkId(adjacentChunkOriginCoordinate);
          
          // Only remesh if the adjacent chunk exists and is different from this chunk
          if (adjacentChunkId !== this.chunkId && chunkManager._chunks.has(adjacentChunkId)) {
            // Reduce logging to avoid spam
            if (Math.random() < 0.1) {
              console.log(`Also rebuilding adjacent chunk ${adjacentChunkId} due to edge block removal`);
            }
            
            // Get the chunk and clean up its meshes too 
            const adjacentChunk = chunkManager._chunks.get(adjacentChunkId);
            
            // Force remesh adjacent chunks
            chunkManager.markChunkForRemesh(adjacentChunkId, { forceCompleteRebuild: true });
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
  _updateBlockFaces(localCoordinate, oldBlockTypeId, newBlockTypeId, chunkManager) {
    const timerId = `_updateBlockFaces-${this.chunkId}`;
    try {
      console.time(timerId);
      
      // If we don't have meshes yet, just mark the chunk for full remeshing
      if (!this._solidMesh && !this._liquidMesh) {
        chunkManager.markChunkForRemesh(this.chunkId);
        return;
      }

      // Get the old and new block types
      const oldBlockType = oldBlockTypeId ? BlockTypeRegistry.instance.getBlockType(oldBlockTypeId) : null;
      const newBlockType = newBlockTypeId ? BlockTypeRegistry.instance.getBlockType(newBlockTypeId) : null;

      // Mark the chunk for remeshing with the affected blocks
      chunkManager.markChunkForRemesh(this.chunkId, { blockCoordinates: [localCoordinate] });
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
    
    // Process all blocks for a more accurate hash
    // We need to be careful with this to not miss block changes
    for (let i = 0; i < length; i++) {
      // Only use non-zero blocks for the hash
      if (this._blocks[i] !== 0) {
        hash = ((hash << 5) - hash) + (i * 31 + this._blocks[i]);
        hash = hash & hash; // Convert to 32bit integer
      }
    }
    
    // Include a timestamp component for placements
    // This ensures we rebuild after recent changes
    hash = (hash * 31) + Math.floor(performance.now() / 10000); // Changes every 10 seconds
    
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
  _calculateVertexColor(vertexCoordinate, blockType, blockFaceAO, chunkManager) {
    // Initialize the cache if it doesn't exist
    if (!this._vertexColorCache) {
      this._vertexColorCache = new Map();
    }

    // Create a cache key from the vertex coordinate, block type
    // Using coordinates and block ID is enough, no need to include AO data in the key
    const cacheKey = `${vertexCoordinate.x},${vertexCoordinate.y},${vertexCoordinate.z}-${blockType.id}`;
    
    // Check if we have a cached result
    if (this._vertexColorCache.has(cacheKey)) {
      return this._vertexColorCache.get(cacheKey);
    }
    
    const baseColor = blockType.color;
    let aoIntensityLevel = 0;

    // Calculate AO
    for (const aoSide of Object.values(blockFaceAO)) {
      const [ dx, dy, dz ] = aoSide;
      let neighborBlockType;

      if (this._extendedBlockTypes) {
        const ex = Math.floor(vertexCoordinate.x + dx) - (this.originCoordinate.x - 1);
        const ey = Math.floor(vertexCoordinate.y + dy) - (this.originCoordinate.y - 1);
        const ez = Math.floor(vertexCoordinate.z + dz) - (this.originCoordinate.z - 1);
        if (ex >= 0 && ex <= CHUNK_SIZE + 1 && ey >= 0 && ey <= CHUNK_SIZE + 1 && ez >= 0 && ez <= CHUNK_SIZE + 1) {
          neighborBlockType = this._extendedBlockTypes[ex][ey][ez];
        }
      }

      if (!neighborBlockType) {
        const neighborGlobalCoordinate = {
          x: Math.floor(vertexCoordinate.x + dx),
          y: Math.floor(vertexCoordinate.y + dy),
          z: Math.floor(vertexCoordinate.z + dz),
        };
        neighborBlockType = chunkManager.getGlobalBlockType(neighborGlobalCoordinate);
      }

      if (neighborBlockType && !neighborBlockType.isLiquid) {
        aoIntensityLevel++;
      }
    }

    const ao = blockType.aoIntensity[aoIntensityLevel];
    const result = [
      baseColor[0] - ao,
      baseColor[1] - ao,
      baseColor[2] - ao,
      baseColor[3],
    ];
    
    // Cache the result
    this._vertexColorCache.set(cacheKey, result);
    
    return result;
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
    return localCoordinate.x + CHUNK_SIZE * (localCoordinate.y + CHUNK_SIZE * localCoordinate.z);
  }
}

export default Chunk; 