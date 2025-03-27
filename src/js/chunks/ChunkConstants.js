// ChunkConstants.js
// Constants for chunk-related operations

// Chunk size (must be a power of 2)
export const CHUNK_SIZE = 16;
export const CHUNK_INDEX_RANGE = CHUNK_SIZE - 1;
export const CHUNK_VOLUME = CHUNK_SIZE ** 3;

// Buffer geometry constants
export const CHUNK_BUFFER_GEOMETRY_NUM_POSITION_COMPONENTS = 3;
export const CHUNK_BUFFER_GEOMETRY_NUM_NORMAL_COMPONENTS = 3;
export const CHUNK_BUFFER_GEOMETRY_NUM_UV_COMPONENTS = 2;
export const CHUNK_BUFFER_GEOMETRY_NUM_COLOR_COMPONENTS = 4;

// Chunk buffer geometry data type
export const ChunkBufferGeometryData = {
  colors: [],
  indices: [],
  normals: [],
  positions: [],
  uvs: []
};

// Mesh pool sizes
export const MAX_LIQUID_MESH_POOL_SIZE = 50;
export const MAX_SOLID_MESH_POOL_SIZE = 250;

// Chunk processing constants
export const CHUNKS_NUM_TO_BUILD_AT_ONCE = 32; 