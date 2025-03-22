// Chunk.js
// Represents a chunk in the world

import * as THREE from 'three';
import BlockTypeRegistry from '../blocks/BlockTypeRegistry';
import { CHUNK_SIZE, CHUNK_INDEX_RANGE, CHUNK_VOLUME } from './ChunkConstants';
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
    // Store the previous state for comparison
    const wasVisible = this._visible;
    
    // Always set the visibility regardless of whether it changed
    this._visible = isVisible;
    
    // Always update mesh visibility to ensure THREE.js registers it
    this._updateMeshVisibility();
    
	/*
    // Log visibility changes (but only occasionally to reduce spam)
    if (wasVisible !== isVisible || (Date.now() % 10000 < 100)) {
      console.log(`Chunk ${this.chunkId} visibility set to ${isVisible} (was ${wasVisible})`);
    }
	  */
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
   * Build the meshes for the chunk
   * @param {ChunkManager} chunkManager - The chunk manager
   * @returns {Promise<Object>} The meshes
   */
  async buildMeshes(chunkManager) {
    const perfId = `buildMeshes-${this.chunkId}`;
    //console.time(perfId);
    //console.log(`Building full meshes for chunk ${this.chunkId}`);
    
    // Removed unnecessary texture preloading that was causing performance issues
    // The textures should already be preloaded during initialization

    //console.time(`${perfId}-setup`);
    const { x: originX, y: originY, z: originZ } = this.originCoordinate;

    const liquidMeshColors = [];
    const liquidMeshIndices = [];
    const liquidMeshNormals = [];
    const liquidMeshPositions = [];
    const liquidMeshUvs = [];

    const solidMeshColors = [];
    const solidMeshIndices = [];
    const solidMeshNormals = [];
    const solidMeshPositions = [];
    const solidMeshUvs = [];
    //console.timeEnd(`${perfId}-setup`);

    //console.time(`${perfId}-buildGeometry`);
    let verticesProcessed = 0;
    for (let y = 0; y < CHUNK_SIZE; y++) {
      const globalY = originY + y;
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const globalZ = originZ + z;
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const globalX = originX + x;
          const blockType = this.getLocalBlockType({ x, y, z });

          if (!blockType) { // air, ignore
            continue;
          }

          for (const blockFace of blockType.faces) {
            const { normal: dir, vertices } = blockType.faceGeometries[blockFace];
            const neighborGlobalCoordinate = {
              x: globalX + dir[0],
              y: globalY + dir[1],
              z: globalZ + dir[2],
            };

            const neighborBlockType = chunkManager.getGlobalBlockType(neighborGlobalCoordinate);

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

            for (const { pos, uv, ao } of vertices) {
              verticesProcessed++;
              const vertexX = globalX + pos[0] - 0.5;
              const vertexY = globalY + pos[1] - 0.5;
              const vertexZ = globalZ + pos[2] - 0.5;

              meshPositions.push(vertexX, vertexY, vertexZ);
              meshNormals.push(...dir);

              // Calculate UV coords for face texture
              let actualTextureUri = textureUri;
              
              // Handle undefined texture URI
              if (!actualTextureUri) {
                // Try to find a texture for this face from other faces
                const availableFaces = Object.keys(blockType.textureUris).filter(
                  face => blockType.textureUris[face]
                );
                
                if (availableFaces.length > 0) {
                  // Use the first available texture
                  actualTextureUri = blockType.textureUris[availableFaces[0]];
                } else {
                  // Use error texture as last resort
                  actualTextureUri = './assets/blocks/error.png';
                }
              }
              
              // Detect multi-sided blocks based on the texture path or block metadata
              const isMultiSided = blockType.isMultiSided || 
                                 (blockType.textureUris && Object.keys(blockType.textureUris).length > 1) ||
                                 (actualTextureUri && !actualTextureUri.match(/\.(png|jpe?g)$/i));
              
              const blockName = blockType.name || '';
                                 
              // Handle multi-sided blocks generically
              if (isMultiSided) {
                // Get the block type name from textureUri or block metadata
                let blockTypeName = '';
                
                if (blockType.name) {
                  blockTypeName = blockType.name;
                } else if (actualTextureUri) {
                  // Try to extract block type from the texture URI
                  const match = actualTextureUri.match(/\/blocks\/([^\/]+)(?:\/|$)/);
                  if (match) {
                    blockTypeName = match[1];
                  }
                }
                
                if (blockTypeName) {
                  // Comment out excessive logging
                  // console.log(`🧊 Processing multi-sided block (${blockTypeName}) at (${globalX},${globalY},${globalZ}) - face: ${blockFace}`);
                  
                  // Force correct texture selection based on face
                  const faceMap = {
                    'top': '+y.png',
                    'bottom': '-y.png',
                    'left': '-x.png',
                    'right': '+x.png',
                    'front': '+z.png',
                    'back': '-z.png'
                  };
                  
                  if (faceMap[blockFace]) {
                    const specificFaceTexture = `./assets/blocks/${blockTypeName}/${faceMap[blockFace]}`;
                    actualTextureUri = specificFaceTexture;
                    
                    // Uncomment for debugging specific issues only
                    /*
                    if (blockFace === 'top' || blockFace === 'bottom') {
                      console.log(`🧊 Using ${blockFace} texture for ${blockTypeName}: ${actualTextureUri}`);
                    }
                    */
                  }
                }
              }
              // Original multi-sided texture handling for backwards compatibility
              else if (actualTextureUri && !actualTextureUri.match(/\.(png|jpe?g)$/i)) {
                // Map the blockFace to the corresponding face-specific texture
                const faceMap = {
                  'top': '+y.png',
                  'bottom': '-y.png',
                  'left': '-x.png',
                  'right': '+x.png',
                  'front': '+z.png',
                  'back': '-z.png'
                };
                
                // Create a specific face texture path
                if (faceMap[blockFace]) {
                  const specificFaceTexture = `${actualTextureUri}/${faceMap[blockFace]}`;
                  actualTextureUri = specificFaceTexture;
                  
                  // Uncomment for debugging specific issues only
                  /*
                  if (blockFace === 'top' || blockFace === 'bottom') {
                    console.log(`Using ${blockFace} texture: ${actualTextureUri}`);
                  }
                  */
                } else {
                  // If no specific face mapping, try to use a default texture
                  const allTexture = `${actualTextureUri}/all.png`;
                  const defaultTexture = `${actualTextureUri}/default.png`;
                  
                  // Let the texture atlas handle fallbacks
                  actualTextureUri = allTexture;
                }
              }
              
              // Get UV coordinates for this texture (may be cached)
              let texCoords;
              
              // Special handling for multi-sided blocks
              if (isMultiSided && blockType.name) {
                // Use our specialized method for multi-sided textures
                texCoords = BlockTextureAtlas.instance.getMultiSidedTextureUV(blockType.name, blockFace, uv);
                // Comment out excessive logging
                // console.log(`🧊 Using multi-sided UV for ${blockType.name} ${blockFace} at ${globalX},${globalY},${globalZ}: [${texCoords[0].toFixed(4)}, ${texCoords[1].toFixed(4)}]`);
              } 
              // Backward compatibility for grass blocks
              else if (blockName.includes('grass')) {
                // Use grass-specific method for backward compatibility
                texCoords = BlockTextureAtlas.instance.getGrassTextureUV(blockFace, uv);
              }
              else {
                // Normal texture handling for regular blocks
                texCoords = BlockTextureAtlas.instance.getTextureUVCoordinateSync(actualTextureUri, uv);
              }
              
              // Debug logging for multi-sided blocks - only enable when needed
              /*
              if (isMultiSided) {
                console.log(`🧊 ${blockFace} texture at ${globalX},${globalY},${globalZ}: ${actualTextureUri} → UV: [${texCoords[0].toFixed(4)}, ${texCoords[1].toFixed(4)}]`);
              }
              */
              
              // If the coordinates are [0,0], it means the texture wasn't found
              // Queue it for loading so it will be available on next render
              if (texCoords[0] === 0 && texCoords[1] === 0 && actualTextureUri !== './assets/blocks/error.png') {
                if (BlockTextureAtlas.instance.queueTextureForLoading) {
                  BlockTextureAtlas.instance.queueTextureForLoading(actualTextureUri);
                  // Also ensure error texture is loaded
                  BlockTextureAtlas.instance.queueTextureForLoading('./assets/blocks/error.png');
                }
              }
              
              meshUvs.push(...texCoords);

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
    //console.timeEnd(`${perfId}-buildGeometry`);

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
    
    //console.timeEnd(perfId);
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
      // For now, it's safer to do a full rebuild if the block count is over 7
      // This avoids visual artifacts from partial updates
      if (blockCoordinates.length > 7) {
        console.log(`Using full rebuild for chunk ${this.chunkId} with ${blockCoordinates.length} affected blocks for visual consistency`);
        console.timeEnd(perfId);
        return this.buildMeshes(chunkManager);
      }

      // Set up meshes
      const { x: originX, y: originY, z: originZ } = this.originCoordinate;

      // Create buffers for the new mesh data
      const liquidMeshColors = [];
      const liquidMeshIndices = [];
      const liquidMeshNormals = [];
      const liquidMeshPositions = [];
      const liquidMeshUvs = [];

      const solidMeshColors = [];
      const solidMeshIndices = [];
      const solidMeshNormals = [];
      const solidMeshPositions = [];
      const solidMeshUvs = [];

      // Track which blocks we've already processed to avoid duplicates
      const processedBlocks = new Set();

      // Create a set for effective range - include blocks and their neighbors
      const effectiveRange = new Set();
      
      // Add all affected blocks to the effective range
      for (const blockCoord of blockCoordinates) {
        const key = `${blockCoord.x},${blockCoord.y},${blockCoord.z}`;
        effectiveRange.add(key);
      }
      
      // Add a wider range of neighbors to ensure clean seams
      // This is crucial to prevent visual artifacts
      const blocksToProcess = [...effectiveRange];
      for (const blockKey of blocksToProcess) {
        const [x, y, z] = blockKey.split(',').map(Number);
        
        // Add all neighbors (including diagonals) within a distance of 2
        // This larger radius ensures proper ambient occlusion and face connectivity
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            for (let dz = -2; dz <= 2; dz++) {
              // Skip the block itself
              if (dx === 0 && dy === 0 && dz === 0) continue;
              
              const nx = x + dx;
              const ny = y + dy;
              const nz = z + dz;
              
              // Ensure we're inside chunk bounds
              if (nx >= 0 && nx < CHUNK_SIZE && 
                  ny >= 0 && ny < CHUNK_SIZE && 
                  nz >= 0 && nz < CHUNK_SIZE) {
                effectiveRange.add(`${nx},${ny},${nz}`);
              }
            }
          }
        }
      }

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
          const neighborGlobalCoordinate = {
            x: globalX + dir[0],
            y: globalY + dir[1],
            z: globalZ + dir[2],
          };

          const neighborBlockType = chunkManager.getGlobalBlockType(neighborGlobalCoordinate);

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

          for (const { pos, uv, ao } of vertices) {
            const vertexX = globalX + pos[0] - 0.5;
            const vertexY = globalY + pos[1] - 0.5;
            const vertexZ = globalZ + pos[2] - 0.5;

            meshPositions.push(vertexX, vertexY, vertexZ);
            meshNormals.push(...dir);

            // Calculate UV coords for face texture
            let actualTextureUri = textureUri;
            
            // Handle undefined texture URI
            if (!actualTextureUri) {
              // Try to find a texture for this face from other faces
              const availableFaces = Object.keys(blockType.textureUris).filter(
                face => blockType.textureUris[face]
              );
              
              if (availableFaces.length > 0) {
                // Use the first available texture
                actualTextureUri = blockType.textureUris[availableFaces[0]];
              } else {
                // Use error texture as last resort
                actualTextureUri = './assets/blocks/error.png';
              }
            }
            
            // Detect multi-sided blocks based on the texture path or block metadata
            const isMultiSided = blockType.isMultiSided || 
                               (blockType.textureUris && Object.keys(blockType.textureUris).length > 1) ||
                               (actualTextureUri && !actualTextureUri.match(/\.(png|jpe?g)$/i));
            
            const blockName = blockType.name || '';
                               
            // Handle multi-sided blocks generically
            if (isMultiSided) {
              // Get the block type name from textureUri or block metadata
              let blockTypeName = '';
              
              if (blockType.name) {
                blockTypeName = blockType.name;
              } else if (actualTextureUri) {
                // Try to extract block type from the texture URI
                const match = actualTextureUri.match(/\/blocks\/([^\/]+)(?:\/|$)/);
                if (match) {
                  blockTypeName = match[1];
                }
              }
              
              if (blockTypeName) {
                // Comment out excessive logging
                // console.log(`🧊 Processing multi-sided block (${blockTypeName}) at (${globalX},${globalY},${globalZ}) - face: ${blockFace}`);
                
                // Force correct texture selection based on face
                const faceMap = {
                  'top': '+y.png',
                  'bottom': '-y.png',
                  'left': '-x.png',
                  'right': '+x.png',
                  'front': '+z.png',
                  'back': '-z.png'
                };
                
                if (faceMap[blockFace]) {
                  const specificFaceTexture = `./assets/blocks/${blockTypeName}/${faceMap[blockFace]}`;
                  actualTextureUri = specificFaceTexture;
                  
                  // Uncomment for debugging specific issues only
                  /*
                  if (blockFace === 'top' || blockFace === 'bottom') {
                    console.log(`🧊 Using ${blockFace} texture for ${blockTypeName}: ${actualTextureUri}`);
                  }
                  */
                }
              }
            }
            // Original multi-sided texture handling for backwards compatibility
            else if (actualTextureUri && !actualTextureUri.match(/\.(png|jpe?g)$/i)) {
              // Map the blockFace to the corresponding face-specific texture
              const faceMap = {
                'top': '+y.png',
                'bottom': '-y.png',
                'left': '-x.png',
                'right': '+x.png',
                'front': '+z.png',
                'back': '-z.png'
              };
              
              // Create a specific face texture path
              if (faceMap[blockFace]) {
                const specificFaceTexture = `${actualTextureUri}/${faceMap[blockFace]}`;
                actualTextureUri = specificFaceTexture;
                
                // Uncomment for debugging specific issues only
                /*
                if (blockFace === 'top' || blockFace === 'bottom') {
                  console.log(`Using ${blockFace} texture: ${actualTextureUri}`);
                }
                */
              } else {
                // If no specific face mapping, try to use a default texture
                const allTexture = `${actualTextureUri}/all.png`;
                const defaultTexture = `${actualTextureUri}/default.png`;
                
                // Let the texture atlas handle fallbacks
                actualTextureUri = allTexture;
              }
            }
            
            // Get UV coordinates for this texture (may be cached)
            let texCoords;
            
            // Special handling for multi-sided blocks
            if (isMultiSided && blockType.name) {
              // Use our specialized method for multi-sided textures
              texCoords = BlockTextureAtlas.instance.getMultiSidedTextureUV(blockType.name, blockFace, uv);
              // Comment out excessive logging
              // console.log(`🧊 Using multi-sided UV for ${blockType.name} ${blockFace} at ${globalX},${globalY},${globalZ}: [${texCoords[0].toFixed(4)}, ${texCoords[1].toFixed(4)}]`);
            } 
            // Backward compatibility for grass blocks
            else if (blockName.includes('grass')) {
              // Use grass-specific method for backward compatibility
              texCoords = BlockTextureAtlas.instance.getGrassTextureUV(blockFace, uv);
            }
            else {
              // Normal texture handling for regular blocks
              texCoords = BlockTextureAtlas.instance.getTextureUVCoordinateSync(actualTextureUri, uv);
            }
            
            // Debug logging for multi-sided blocks - only enable when needed
            /*
            if (isMultiSided) {
              console.log(`🧊 ${blockFace} texture at ${globalX},${globalY},${globalZ}: ${actualTextureUri} → UV: [${texCoords[0].toFixed(4)}, ${texCoords[1].toFixed(4)}]`);
            }
            */
            
            // If the coordinates are [0,0], it means the texture wasn't found
            // Queue it for loading so it will be available on next render
            if (texCoords[0] === 0 && texCoords[1] === 0 && actualTextureUri !== './assets/blocks/error.png') {
              if (BlockTextureAtlas.instance.queueTextureForLoading) {
                BlockTextureAtlas.instance.queueTextureForLoading(actualTextureUri);
                // Also ensure error texture is loaded
                BlockTextureAtlas.instance.queueTextureForLoading('./assets/blocks/error.png');
              }
            }
            
            meshUvs.push(...texCoords);

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
    console.time(`setBlock-${this.chunkId}`);
    
    if (!Chunk.isValidLocalCoordinate(localCoordinate)) {
      console.timeEnd(`setBlock-${this.chunkId}`);
      throw new Error('Chunk.setBlock(): Block coordinate is out of bounds');
    }

    const blockIndex = this._getIndex(localCoordinate);
    const oldBlockTypeId = this._blocks[blockIndex];

    // If the block type is the same, no need to update
    if (oldBlockTypeId === blockTypeId) {
      console.timeEnd(`setBlock-${this.chunkId}`);
      return;
    }

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
      console.timeEnd(`setBlock-${this.chunkId}`);
      return;
    }
    
    // For air to block or block to air transitions, we need to update faces
    const isAirToBlock = oldBlockTypeId === 0 && blockTypeId !== 0;
    const isBlockToAir = oldBlockTypeId !== 0 && blockTypeId === 0;
    
    if (isAirToBlock || isBlockToAir) {
      // Instead of marking the entire chunk for remeshing,
      // we'll update only the affected faces
      this._updateBlockFaces(localCoordinate, oldBlockTypeId, blockTypeId, chunkManager);
    } else {
      // For block to different block transitions, just mark the chunk for remesh
      // This is faster than calculating all the face updates
      chunkManager.markChunkForRemesh(this.chunkId);
    }

    // Only check adjacent chunks if this block is on the edge of the chunk
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

      // Only remesh adjacent chunks that have blocks
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
          chunkManager.markChunkForRemesh(adjacentChunkId);
        }
      }
    }
    
    console.timeEnd(`setBlock-${this.chunkId}`);
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

      // Start with the modified block itself
      const affectedBlocks = [{ ...localCoordinate }];
      const affectedSet = new Set([`${localCoordinate.x},${localCoordinate.y},${localCoordinate.z}`]);

      // Get the neighboring blocks - only check the 6 adjacent faces first
      const { x, y, z } = localCoordinate;
      const neighbors = [
        { dir: [1, 0, 0], face: 'right', oppositeFace: 'left', coord: { x: x + 1, y, z } },
        { dir: [-1, 0, 0], face: 'left', oppositeFace: 'right', coord: { x: x - 1, y, z } },
        { dir: [0, 1, 0], face: 'top', oppositeFace: 'bottom', coord: { x, y: y + 1, z } },
        { dir: [0, -1, 0], face: 'bottom', oppositeFace: 'top', coord: { x, y: y - 1, z } },
        { dir: [0, 0, 1], face: 'front', oppositeFace: 'back', coord: { x, y, z: z + 1 } },
        { dir: [0, 0, -1], face: 'back', oppositeFace: 'front', coord: { x, y, z: z - 1 } }
      ];

      // Whether we're adding or removing a block
      const isAirToBlock = oldBlockTypeId === 0 && newBlockTypeId !== 0;
      const isBlockToAir = oldBlockTypeId !== 0 && newBlockTypeId === 0;
      const isBlockTypeChange = oldBlockTypeId !== 0 && newBlockTypeId !== 0 && oldBlockTypeId !== newBlockTypeId;
      
      // Special case for block removal - we need to make sure all neighboring solid blocks 
      // update their faces that were previously hidden by this block
      if (isBlockToAir) {
        // For block removal, we definitely need to update all direct neighbors
        // to ensure they show the previously hidden faces
        for (const { coord } of neighbors) {
          // Skip neighbors outside chunk boundaries
          if (coord.x < 0 || coord.x > CHUNK_INDEX_RANGE || 
              coord.y < 0 || coord.y > CHUNK_INDEX_RANGE || 
              coord.z < 0 || coord.z > CHUNK_INDEX_RANGE) {
            // For neighbors outside our chunk, we need to notify those chunks to update
            // Get the global coordinate
            const globalCoord = this._getGlobalCoordinate(localCoordinate);
            
            // Calculate the adjacent block's global coordinate
            const neighborGlobal = {
              x: globalCoord.x + (coord.x - localCoordinate.x),
              y: globalCoord.y + (coord.y - localCoordinate.y),
              z: globalCoord.z + (coord.z - localCoordinate.z)
            };
            
            // Get the chunk for this neighbor
            const neighborChunkOrigin = Chunk.globalCoordinateToOriginCoordinate(neighborGlobal);
            const neighborChunkId = Chunk.getChunkId(neighborChunkOrigin);
            
            // If it's a different chunk, mark it for remeshing
            if (neighborChunkId !== this.chunkId && chunkManager._chunks.has(neighborChunkId)) {
              chunkManager.markChunkForRemesh(neighborChunkId);
            }
            
            continue;
          }
          
          // Check if this neighbor has a solid block
          const neighborBlockId = this.getLocalBlockId(coord);
          if (neighborBlockId !== 0) {
            // Add to affected blocks
            const coordKey = `${coord.x},${coord.y},${coord.z}`;
            if (!affectedSet.has(coordKey)) {
              affectedSet.add(coordKey);
              affectedBlocks.push({ ...coord });
            }
          }
        }
      }
      // For normal cases, include direct face neighbors
      else {
        for (const { coord } of neighbors) {
          // Skip neighbors outside chunk boundaries
          if (coord.x < 0 || coord.x > CHUNK_INDEX_RANGE || 
              coord.y < 0 || coord.y > CHUNK_INDEX_RANGE || 
              coord.z < 0 || coord.z > CHUNK_INDEX_RANGE) {
            continue;
          }
          
          // Always include direct neighbors in the update
          const coordKey = `${coord.x},${coord.y},${coord.z}`;
          if (!affectedSet.has(coordKey)) {
            affectedSet.add(coordKey);
            affectedBlocks.push({ ...coord });
          }
        }
      }

      // For visual consistency, always include a wider radius of blocks
      // This ensures proper ambient occlusion and seamless transitions
      const blocksToProcess = [...affectedBlocks];
      for (const block of blocksToProcess) {
        // Include diagonal/corner neighbors within a radius
        // This creates a more reliable updating pattern
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              // Skip already processed blocks and center block
              if (dx === 0 && dy === 0 && dz === 0) continue;
              
              const nx = block.x + dx;
              const ny = block.y + dy;
              const nz = block.z + dz;
              
              // Skip if out of bounds
              if (nx < 0 || nx > CHUNK_INDEX_RANGE || 
                  ny < 0 || ny > CHUNK_INDEX_RANGE || 
                  nz < 0 || nz > CHUNK_INDEX_RANGE) {
                continue;
              }
              
              const coordKey = `${nx},${ny},${nz}`;
              if (!affectedSet.has(coordKey)) {
                affectedSet.add(coordKey);
                affectedBlocks.push({ x: nx, y: ny, z: nz });
              }
            }
          }
        }
      }

      // If we're placing a special block type (transparent/etc.) or if we're removing a block,
      // we need to update an even wider area for proper visual appearance
      if ((isAirToBlock && newBlockType?.transparent) || 
          isBlockToAir || 
          (isBlockTypeChange && (newBlockType?.transparent || oldBlockType?.transparent))) {
        
        // For special cases, do a second pass with extended radius
        // For block removal, use a larger radius to ensure all previously hidden faces update properly
        const additionalRadius = isBlockToAir ? 2 : 1; 
        const additionalBlocks = [...affectedBlocks]; // Start with current blocks
        
        for (const block of additionalBlocks) {
          for (let dx = -additionalRadius; dx <= additionalRadius; dx++) {
            for (let dy = -additionalRadius; dy <= additionalRadius; dy++) {
              for (let dz = -additionalRadius; dz <= additionalRadius; dz++) {
                // Skip center which would be original block
                if (dx === 0 && dy === 0 && dz === 0) continue;
                
                const nx = block.x + dx;
                const ny = block.y + dy;
                const nz = block.z + dz;
                
                // Skip if out of bounds
                if (nx < 0 || nx > CHUNK_INDEX_RANGE || 
                    ny < 0 || ny > CHUNK_INDEX_RANGE || 
                    nz < 0 || nz > CHUNK_INDEX_RANGE) {
                  continue;
                }
                
                const coordKey = `${nx},${ny},${nz}`;
                if (!affectedSet.has(coordKey)) {
                  affectedSet.add(coordKey);
                  affectedBlocks.push({ x: nx, y: ny, z: nz });
                }
              }
            }
          }
        }
      }

      // For block removal, make sure to log status for debugging
      if (isBlockToAir) {
        console.log(`Block removal at ${x},${y},${z} affected ${affectedBlocks.length} blocks in chunk ${this.chunkId}`);
      } else {
        console.log(`Block update affected ${affectedBlocks.length} blocks in chunk ${this.chunkId}`);
      }
      
      // Mark the chunk for remeshing with the affected blocks
      chunkManager.markChunkForRemesh(this.chunkId, { blockCoordinates: affectedBlocks });
    } finally {
      console.timeEnd(timerId);
    }
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
      const neighborGlobalCoordinate = {
        x: Math.floor(vertexCoordinate.x + dx),
        y: Math.floor(vertexCoordinate.y + dy),
        z: Math.floor(vertexCoordinate.z + dz),
      };

      const neighborBlockType = chunkManager.getGlobalBlockType(neighborGlobalCoordinate);

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