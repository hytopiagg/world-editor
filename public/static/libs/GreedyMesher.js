/**
 * GreedyMesher
 * 
 * A faster implementation of the "Greedy Meshing" algorithm for voxel worlds.
 * This implementation is designed to be compatible with:
 * 1. Worker threads (no THREE.js dependencies)
 * 2. Texture atlas system
 * 3. Occlusion culling
 * 
 * Based on the algorithm by Mikola Lysenko but optimized for modern JS engines.
 */

// Constants for direction mapping
const DIRECTION = {
  FRONT: 0,  // +z
  BACK: 1,   // -z
  TOP: 2,    // +y
  BOTTOM: 3, // -y
  RIGHT: 4,  // +x
  LEFT: 5    // -x
};

// Mapping texture sides to direction indices
const TEXTURE_SIDE_MAP = {
  'front': DIRECTION.FRONT,
  'back': DIRECTION.BACK,
  'top': DIRECTION.TOP,
  'bottom': DIRECTION.BOTTOM,
  'right': DIRECTION.RIGHT,
  'left': DIRECTION.LEFT,
  // Add support for alternate naming conventions
  '+z': DIRECTION.FRONT,
  '-z': DIRECTION.BACK,
  '+y': DIRECTION.TOP,
  '-y': DIRECTION.BOTTOM,
  '+x': DIRECTION.RIGHT,
  '-x': DIRECTION.LEFT,
  // Add numeric keys for compatibility
  '0': DIRECTION.FRONT,
  '1': DIRECTION.BACK,
  '2': DIRECTION.TOP,
  '3': DIRECTION.BOTTOM,
  '4': DIRECTION.RIGHT,
  '5': DIRECTION.LEFT
};

// Reverse mapping from direction to side names (for looking up textures)
const DIRECTION_TO_SIDE = [
  ['front', '+z', '0'],      // FRONT
  ['back', '-z', '1'],       // BACK
  ['top', '+y', '2'],        // TOP
  ['bottom', '-y', '3'],     // BOTTOM
  ['right', '+x', '4'],      // RIGHT
  ['left', '-x', '5']        // LEFT
];

// Face normal vectors for each direction
const FACE_NORMALS = [
  [0, 0, 1],   // FRONT
  [0, 0, -1],  // BACK
  [0, 1, 0],   // TOP
  [0, -1, 0],  // BOTTOM
  [1, 0, 0],   // RIGHT
  [-1, 0, 0]   // LEFT
];

// Face vertex offsets for each direction
const FACE_VERTEX_OFFSETS = {
  // Format: [du1, dv1, du2, dv2] for each face where u, v are the axes perpendicular to the face normal
  [DIRECTION.FRONT]: [1, 1, 0, 0],  // +z: x, y
  [DIRECTION.BACK]: [0, 1, 1, 0],   // -z: x, y
  [DIRECTION.TOP]: [1, 0, 0, 1],    // +y: x, z
  [DIRECTION.BOTTOM]: [1, 0, 0, 1], // -y: x, z
  [DIRECTION.RIGHT]: [0, 1, 1, 0],  // +x: z, y
  [DIRECTION.LEFT]: [0, 1, 1, 0]    // -x: z, y
};

// Dimension helpers for each face
const DIMENSION_INFO = [
  { u: 0, v: 1, w: 2 }, // FRONT: x, y, z
  { u: 0, v: 1, w: 2 }, // BACK: x, y, z
  { u: 0, v: 2, w: 1 }, // TOP: x, z, y
  { u: 0, v: 2, w: 1 }, // BOTTOM: x, z, y
  { u: 2, v: 1, w: 0 }, // RIGHT: z, y, x
  { u: 2, v: 1, w: 0 }  // LEFT: z, y, x
];

export class GreedyMesher {
  constructor(options = {}) {
    this.chunkSize = options.chunkSize || 32;
    this.enableTiming = options.enableTiming || false;
    this.debug = options.debug || false;
  }
  
  /**
   * Create mesh data for a chunk
   * @param {Object} blocks - The blocks in the chunk, keyed by position
   * @param {Object} textureAtlas - Texture atlas data
   * @param {Array} blockTypes - Array of block type definitions
   * @returns {Object} MeshData including positions, normals, uvs, and indices
   */
  createMeshData(blocks, textureAtlas, blockTypes) {
    const startTime = performance.now();
    
    // Initialize mesh data
    const meshData = {
      positions: [],
      normals: [],
      uvs: [],
      indices: []
    };
    
    // Get the block type map for quick lookups
    const blockTypeMap = {};
    if (blockTypes && blockTypes.length) {
      blockTypes.forEach(type => {
        if (type && type.id) {
          blockTypeMap[type.id] = type;
        }
      });
    }
    
    // Create a voxel grid for greedy meshing
    const grid = this.createVoxelGrid(blocks, blockTypeMap);
    
    if (this.debug) {
      console.log("Grid created:", grid);
    }
    
    // Process each dimension (0=x, 1=y, 2=z)
    for (let d = 0; d < 6; d++) {
      this.processDimension(d, grid, meshData, textureAtlas, blockTypeMap);
    }
    
    // Performance logging
    if (this.enableTiming) {
      const endTime = performance.now();
      console.log(`Greedy meshing took ${(endTime - startTime).toFixed(2)}ms for ${Object.keys(blocks).length} blocks`);
      console.log(`Generated ${meshData.indices.length / 3} triangles, ${meshData.positions.length / 3} vertices`);
    }
    
    return meshData;
  }
  
  /**
   * Create a 3D voxel grid from block data
   * @param {Object} blocks - The blocks in the chunk, keyed by position
   * @param {Object} blockTypeMap - Map of block types by ID
   * @returns {Object} 3D grid with block IDs and mask for processed blocks
   */
  createVoxelGrid(blocks, blockTypeMap) {
    // Determine chunk bounds
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
    // Analyze block positions to find bounds
    for (const posKey in blocks) {
      const [x, y, z] = posKey.split(',').map(Number);
      
      // Track min/max for each dimension
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
    
    // Create grid dimensions - add 2 for padding on each side
    const sizeX = maxX - minX + 3;
    const sizeY = maxY - minY + 3;
    const sizeZ = maxZ - minZ + 3;
    
    // Create 3D grid arrays - one for block IDs and one for processed flags
    const grid = {
      data: new Array(sizeX * sizeY * sizeZ).fill(0),
      mask: new Uint8Array(sizeX * sizeY * sizeZ),
      sizeX,
      sizeY,
      sizeZ,
      offsetX: minX - 1,
      offsetY: minY - 1,
      offsetZ: minZ - 1
    };
    
    // Populate grid with block IDs
    for (const posKey in blocks) {
      const [x, y, z] = posKey.split(',').map(Number);
      const blockId = blocks[posKey];
      
      // If it's a valid block type, add it to the grid
      if (blockId && blockTypeMap[blockId]) {
        const gx = x - grid.offsetX;
        const gy = y - grid.offsetY;
        const gz = z - grid.offsetZ;
        
        const index = gx + gy * sizeX + gz * sizeX * sizeY;
        grid.data[index] = blockId;
      }
    }
    
    return grid;
  }
  
  /**
   * Get a block ID from the grid at the specified coordinates
   * @param {Object} grid - The voxel grid
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {number} z - Z coordinate
   * @returns {number} Block ID or 0 if out of bounds
   */
  getBlockId(grid, x, y, z) {
    // Check if coordinates are in bounds
    if (x < 0 || y < 0 || z < 0 || x >= grid.sizeX || y >= grid.sizeY || z >= grid.sizeZ) {
      return 0; // Out of bounds, treat as air
    }
    
    // Calculate index and return block ID
    const index = x + y * grid.sizeX + z * grid.sizeX * grid.sizeY;
    return grid.data[index];
  }
  
  /**
   * Process a specific dimension for greedy meshing
   * @param {number} dimension - The dimension (0-5 for each face direction)
   * @param {Object} grid - The voxel grid
   * @param {Object} meshData - The mesh data to append to
   * @param {Object} textureAtlas - Texture atlas data
   * @param {Object} blockTypeMap - Map of block types by ID
   */
  processDimension(dimension, grid, meshData, textureAtlas, blockTypeMap) {
    const { sizeX, sizeY, sizeZ } = grid;
    
    // Get dimension info
    const dimInfo = DIMENSION_INFO[dimension];
    const { u, v, w } = dimInfo;
    
    // Define dimensions based on axis
    let WIDTH, HEIGHT, DEPTH;
    if (w === 0) { WIDTH = sizeX; HEIGHT = sizeY; DEPTH = sizeZ; }
    if (w === 1) { WIDTH = sizeX; HEIGHT = sizeZ; DEPTH = sizeY; }
    if (w === 2) { WIDTH = sizeY; HEIGHT = sizeZ; DEPTH = sizeX; }
    
    // Create mask for this slice
    const mask = new Uint8Array(WIDTH * HEIGHT);
    
    // For each depth
    for (let d = 0; d < DEPTH; d++) {
      // For each depth level, go through the 2D mask
      for (let h = 0; h < HEIGHT; h++) {
        for (let w = 0; w < WIDTH; w++) {
          // Get coordinates for the current position and adjacent position
          let x1, y1, z1, x2, y2, z2;
          
          // Set coordinates based on dimension mapping
          if (dimInfo.w === 0) {
            x1 = d; y1 = w; z1 = h;
            x2 = d + 1; y2 = w; z2 = h;
          } else if (dimInfo.w === 1) {
            x1 = w; y1 = d; z1 = h;
            x2 = w; y2 = d + 1; z2 = h;
          } else {
            x1 = w; y1 = h; z1 = d;
            x2 = w; y2 = h; z2 = d + 1;
          }
          
          // Get block IDs for current and adjacent blocks
          const blockId1 = this.getBlockId(grid, x1, y1, z1);
          const blockId2 = this.getBlockId(grid, x2, y2, z2);
          
          // Skip if both blocks are empty or both are solid
          if ((blockId1 === 0 && blockId2 === 0) || (blockId1 !== 0 && blockId2 !== 0)) {
            mask[w + h * WIDTH] = 0;
            continue;
          }
          
          // Determine which face we need to create
          let blockId, faceDir;
          if (blockId1 !== 0) {
            blockId = blockId1;
            faceDir = dimension;
          } else {
            blockId = blockId2;
            faceDir = dimension ^ 1; // Flip direction for opposite face
          }
          
          // Set the mask with the block ID (1-indexed for mask to distinguish from empty)
          mask[w + h * WIDTH] = blockId;
        }
      }
      
      // Now, use the greedy meshing algorithm on the mask
      let w = 0;
      while (w < WIDTH) {
        let h = 0;
        while (h < HEIGHT) {
          const maskIndex = w + h * WIDTH;
          const blockId = mask[maskIndex];
          
          // Skip empty or processed blocks
          if (blockId === 0) {
            h++;
            continue;
          }
          
          // Find the width (how far we can go in the w direction)
          let width = 1;
          while (w + width < WIDTH && 
                 mask[w + width + h * WIDTH] === blockId && 
                 width < 64) { // Limit to reasonable size to prevent issues
            width++;
          }
          
          // Find the height (how far we can go in the h direction)
          let height = 1;
          let done = false;
          
          while (h + height < HEIGHT && !done && height < 64) { // Limit height too
            // Check if the entire row matches the current block ID
            for (let k = 0; k < width; k++) {
              if (mask[w + k + (h + height) * WIDTH] !== blockId) {
                done = true;
                break;
              }
            }
            
            if (!done) {
              height++;
            }
          }
          
          // Generate the quad for this rectangle
          // Map from grid coordinates to world coordinates
          let x, y, z;
          if (dimInfo.w === 0) {
            x = d; y = w; z = h;
          } else if (dimInfo.w === 1) {
            x = w; y = d; z = h;
          } else {
            x = w; y = h; z = d;
          }
          
          // Add the quad to the mesh
          this.generateQuad(
            dimension,
            x, y, z,         // Starting position
            width, height,   // Size of the quad
            dimInfo.u, dimInfo.v, dimInfo.w,  // Dimension mapping
            blockId,         // Block ID for texture
            meshData,        // Mesh data to append to
            textureAtlas,    // Texture atlas
            blockTypeMap     // Block type map
          );
          
          // Mark the processed blocks in the mask
          for (let dh = 0; dh < height; dh++) {
            for (let dw = 0; dw < width; dw++) {
              mask[w + dw + (h + dh) * WIDTH] = 0;
            }
          }
          
          // Move past the processed area
          h += height;
        }
        w++;
      }
    }
  }
  
  /**
   * Generate a quad for a meshed rectangle
   * @param {number} dimension - The dimension (0-5 for each face direction)
   * @param {number} u - Starting U coordinate
   * @param {number} v - Starting V coordinate
   * @param {number} width - Width of the quad
   * @param {number} height - Height of the quad
   * @param {number} depth - Depth of the quad
   * @param {number} du - U axis index (0=x, 1=y, 2=z)
   * @param {number} dv - V axis index (0=x, 1=y, 2=z)
   * @param {number} dw - W axis index (0=x, 1=y, 2=z)
   * @param {number} blockId - Block ID for texture lookup
   * @param {Object} meshData - Mesh data to append to
   * @param {Object} textureAtlas - Texture atlas data
   * @param {Object} blockTypeMap - Map of block types by ID
   */
  generateQuad(dimension, u, v, w, width, height, depth, du, dv, dw, blockId, meshData, textureAtlas, blockTypeMap) {
    // Get current index
    const indexOffset = meshData.positions.length / 3;
    
    // Convert from grid to world coordinates
    const wc = [0, 0, 0]; // World coordinates
    wc[du] = u;
    wc[dv] = v;
    wc[dw] = depth;
    
    // Add adjust back to chunk offset - this ensures the meshes align correctly
    const x = wc[0];
    const y = wc[1];
    const z = wc[2];
    
    // Adjust the face normal direction based on dimension
    const normal = FACE_NORMALS[dimension];
    
    // Get UV coordinates from texture atlas
    let faceUVs = {
      uMin: 0, vMin: 0,
      uMax: 1, vMax: 1
    };
    
    // Try to get proper UVs from the texture atlas if available
    try {
      const blockType = blockTypeMap[blockId];
      
      // Get all possible side names for this dimension
      const possibleSides = DIRECTION_TO_SIDE[dimension];
      
      if (textureAtlas && blockType) {
        // Try to find an entry in the texture atlas for this block
        if (blockId in textureAtlas) {
          const atlasEntry = textureAtlas[blockId];
          
          // Try each possible side name until we find one that works
          let foundSide = false;
          for (const side of possibleSides) {
            if (atlasEntry[side]) {
              const { uMin, uMax, vMin, vMax } = atlasEntry[side];
              faceUVs = { uMin, uMax, vMin, vMax };
              foundSide = true;
              break;
            }
          }
          
          // If no side-specific texture, try using a default
          if (!foundSide && atlasEntry['default']) {
            const { uMin, uMax, vMin, vMax } = atlasEntry['default'];
            faceUVs = { uMin, uMax, vMin, vMax };
          }
        }
        // Special case for blocks with side-specific textures as separate entries
        else {
          // Try to find texture by combining blockId with side name (e.g. "dragon_block-x")
          for (const side of possibleSides) {
            const sideSpecificId = `${blockId}${side}`;
            if (textureAtlas[sideSpecificId]) {
              const { uMin, uMax, vMin, vMax } = textureAtlas[sideSpecificId];
              faceUVs = { uMin, uMax, vMin, vMax };
              break;
            }
          }
        }
      }
    } catch (error) {
      console.warn("Error getting UVs from texture atlas:", error);
    }
    
    // Handle UV scaling for the quad size
    const { uMin, uMax, vMin, vMax } = faceUVs;
    
    // Vertex positions for the quad
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    
    // Calculate offsets for the face
    const offsets = FACE_VERTEX_OFFSETS[dimension];
    if (!offsets) {
      console.error("Missing offsets for dimension:", dimension);
      return;
    }
    
    // Create vertices based on width and height
    // This is a bit complex because we need to map the 2D quad into 3D space
    const pos = [];
    
    if (dimension === DIRECTION.FRONT) {
      // Front face (+z)
      pos.push(
        [x, y, z + 1],
        [x + width, y, z + 1],
        [x + width, y + height, z + 1],
        [x, y + height, z + 1]
      );
    } else if (dimension === DIRECTION.BACK) {
      // Back face (-z)
      pos.push(
        [x + width, y, z],
        [x, y, z],
        [x, y + height, z],
        [x + width, y + height, z]
      );
    } else if (dimension === DIRECTION.TOP) {
      // Top face (+y)
      pos.push(
        [x, y + 1, z + height],
        [x, y + 1, z],
        [x + width, y + 1, z],
        [x + width, y + 1, z + height]
      );
    } else if (dimension === DIRECTION.BOTTOM) {
      // Bottom face (-y)
      pos.push(
        [x, y, z],
        [x, y, z + height],
        [x + width, y, z + height],
        [x + width, y, z]
      );
    } else if (dimension === DIRECTION.RIGHT) {
      // Right face (+x)
      pos.push(
        [x + 1, y, z],
        [x + 1, y, z + width],
        [x + 1, y + height, z + width],
        [x + 1, y + height, z]
      );
    } else if (dimension === DIRECTION.LEFT) {
      // Left face (-x)
      pos.push(
        [x, y, z + width],
        [x, y, z],
        [x, y + height, z],
        [x, y + height, z + width]
      );
    }
    
    // Add all positions, normals and UVs to the arrays
    for (let i = 0; i < 4; i++) {
      meshData.positions.push(pos[i][0], pos[i][1], pos[i][2]);
      meshData.normals.push(normal[0], normal[1], normal[2]);
    }
    
    // Add UVs - the order needs to match the vertex positions
    if (dimension === DIRECTION.FRONT || dimension === DIRECTION.BACK) {
      // Front/back faces use standard UV mapping
      meshData.uvs.push(
        uMin, vMax,  // Bottom-left
        uMax, vMax,  // Bottom-right
        uMax, vMin,  // Top-right
        uMin, vMin   // Top-left
      );
    } else if (dimension === DIRECTION.TOP || dimension === DIRECTION.BOTTOM) {
      // Top/bottom faces might need UV rotation
      meshData.uvs.push(
        uMin, vMin,  // Top-left
        uMin, vMax,  // Bottom-left
        uMax, vMax,  // Bottom-right
        uMax, vMin   // Top-right
      );
    } else {
      // Side faces
      meshData.uvs.push(
        uMin, vMax,  // Bottom-left
        uMax, vMax,  // Bottom-right
        uMax, vMin,  // Top-right
        uMin, vMin   // Top-left
      );
    }
    
    // Add indices for two triangles making the quad
    meshData.indices.push(
      indexOffset, indexOffset + 1, indexOffset + 2,
      indexOffset, indexOffset + 2, indexOffset + 3
    );
  }
} 