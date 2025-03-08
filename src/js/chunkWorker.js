/* eslint-disable no-undef */
/* eslint-disable no-restricted-globals */
/**
 * ChunkWorker.js
 * 
 * Web Worker for generating chunk meshes in background threads.
 * This offloads the heavy computation from the main thread.
 */

// Import necessary THREE.js components for worker
// Note: THREE.js needs to be self-contained in the worker
importScripts('../libs/three.min.js');

// Cache for storing texture atlas UV coordinates
let textureAtlasCache = null;
let blockTypesCache = null;
const CHUNK_SIZE = 32;

// Main worker message handler
self.onmessage = function(e) {
  const { type, data } = e.data;
  
  try {
    switch (type) {
      case 'init':
        // Initialize worker with atlas data
        initWorker(data);
        break;
      
      case 'generateMesh':
        // Generate mesh for a chunk
        const result = generateChunkMesh(data);
        self.postMessage({
          type: 'meshGenerated',
          chunkKey: data.chunkKey,
          result
        });
        break;
        
      default:
        console.error('Unknown message type:', type);
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error.message,
      stack: error.stack
    });
  }
};

/**
 * Initialize the worker with shared data
 */
function initWorker(data) {
  const { textureAtlasData, blockTypes } = data;
  
  // Store texture atlas data and block types
  textureAtlasCache = textureAtlasData;
  blockTypesCache = blockTypes;
  
  self.postMessage({ type: 'initialized' });
}

/**
 * Generate a chunk mesh based on blocks data
 */
function generateChunkMesh(data) {
  const { chunkKey, chunksBlocks } = data;
  
  // Prepare mesh data
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let vertexCount = 0;
  
  // Process each block
  for (const posKey in chunksBlocks) {
    const blockData = chunksBlocks[posKey];
    const [x, y, z] = posKey.split(',').map(Number);
    
    // Find block type
    const blockType = blockTypesCache.find(type => type.id === blockData.id || 
                                                   type.id === parseInt(blockData));
    if (!blockType) continue;
    
    // Add faces for this block
    vertexCount = addBlockFaces(
      x, y, z, blockType, chunksBlocks, 
      positions, normals, uvs, indices, vertexCount
    );
  }
  
  // Return serializable mesh data
  return {
    positions,
    normals,
    uvs,
    indices
  };
}

/**
 * Add block faces to the mesh data
 */
function addBlockFaces(x, y, z, blockType, chunksBlocks, positions, normals, uvs, indices, vertexOffset) {
  const startingVertexOffset = vertexOffset;
  
  // Check each face direction
  const faces = [
    { // Front (+Z)
      neighbor: [0, 0, 1],
      side: 'pz',
      vertices: [
        [x, y, z+1], [x+1, y, z+1], [x+1, y+1, z+1], [x, y+1, z+1]
      ],
      normal: [0, 0, 1]
    },
    { // Back (-Z)
      neighbor: [0, 0, -1],
      side: 'nz',
      vertices: [
        [x+1, y, z], [x, y, z], [x, y+1, z], [x+1, y+1, z]
      ],
      normal: [0, 0, -1]
    },
    { // Top (+Y)
      neighbor: [0, 1, 0],
      side: 'py',
      vertices: [
        [x, y+1, z], [x, y+1, z+1], [x+1, y+1, z+1], [x+1, y+1, z]
      ],
      normal: [0, 1, 0]
    },
    { // Bottom (-Y)
      neighbor: [0, -1, 0],
      side: 'ny',
      vertices: [
        [x, y, z+1], [x, y, z], [x+1, y, z], [x+1, y, z+1]
      ],
      normal: [0, -1, 0]
    },
    { // Right (+X)
      neighbor: [1, 0, 0],
      side: 'px',
      vertices: [
        [x+1, y, z], [x+1, y, z+1], [x+1, y+1, z+1], [x+1, y+1, z]
      ],
      normal: [1, 0, 0]
    },
    { // Left (-X)
      neighbor: [-1, 0, 0],
      side: 'nx',
      vertices: [
        [x, y, z+1], [x, y, z], [x, y+1, z], [x, y+1, z+1]
      ],
      normal: [-1, 0, 0]
    }
  ];
  
  for (const face of faces) {
    // Check if neighboring block exists
    const nx = x + face.neighbor[0];
    const ny = y + face.neighbor[1];
    const nz = z + face.neighbor[2];
    const neighborKey = `${nx},${ny},${nz}`;
    
    // If neighbor exists and isn't transparent, skip this face
    if (chunksBlocks[neighborKey]) {
      // You could add transparency check here if needed
      continue;
    }
    
    // Get UVs for this block face from the texture atlas
    const blockUVs = getBlockUVs(blockType.id, face.side);
    if (!blockUVs) continue;
    
    // Add vertices
    for (const vertex of face.vertices) {
      positions.push(vertex[0], vertex[1], vertex[2]);
      normals.push(face.normal[0], face.normal[1], face.normal[2]);
    }
    
    // Add UVs (clockwise order)
    uvs.push(
      blockUVs.left, blockUVs.bottom,
      blockUVs.right, blockUVs.bottom,
      blockUVs.right, blockUVs.top,
      blockUVs.left, blockUVs.top
    );
    
    // Add indices (two triangles per face)
    const baseVertex = vertexOffset / 3;
    indices.push(
      baseVertex, baseVertex + 1, baseVertex + 2,
      baseVertex, baseVertex + 2, baseVertex + 3
    );
    
    vertexOffset += 12; // 4 vertices * 3 components each
  }
  
  return vertexOffset;
}

/**
 * Get UV coordinates for a block face from the texture atlas
 */
function getBlockUVs(blockId, side = null) {
  if (!textureAtlasCache) return null;
  
  const key = side ? `${blockId}_${side}` : `${blockId}`;
  
  // Try to find specific face UVs first, fall back to general UVs
  return textureAtlasCache[key] || textureAtlasCache[`${blockId}`];
}

/**
 * Get chunk key from position
 */
function getChunkKey(x, y, z) {
  return `${Math.floor(x / CHUNK_SIZE)},${Math.floor(y / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
} 