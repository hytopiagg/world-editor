

export const CHUNK_SIZE = 16;
export const CHUNK_INDEX_RANGE = CHUNK_SIZE - 1;
export const CHUNK_VOLUME = CHUNK_SIZE ** 3;

export const CHUNK_BUFFER_GEOMETRY_NUM_POSITION_COMPONENTS = 3;
export const CHUNK_BUFFER_GEOMETRY_NUM_NORMAL_COMPONENTS = 3;
export const CHUNK_BUFFER_GEOMETRY_NUM_UV_COMPONENTS = 2;
export const CHUNK_BUFFER_GEOMETRY_NUM_COLOR_COMPONENTS = 4;
export const CHUNK_BUFFER_GEOMETRY_NUM_LIGHT_LEVEL_COMPONENTS = 1;

export const ChunkBufferGeometryData = {
    colors: [],
    indices: [],
    normals: [],
    positions: [],
    uvs: [],
};

export const MAX_LIQUID_MESH_POOL_SIZE = 50;
export const MAX_SOLID_MESH_POOL_SIZE = 250;

export const CHUNKS_NUM_TO_BUILD_AT_ONCE = 32;

// ============================================================================
// SDK-compatible lighting constants
// ============================================================================

// Maximum light level for emissive blocks (0-15 range, 4-bit)
export const MAX_LIGHT_LEVEL = 15;

// Multiplier applied to block light levels in shader calculations
// Higher values make emissive blocks cast brighter light
export const LIGHT_LEVEL_STRENGTH_MULTIPLIER = 0.07;

// Alpha test threshold for block materials
export const ALPHA_TEST_THRESHOLD = 0.1;

// Water surface Y offset for liquid shader
export const WATER_SURFACE_Y_OFFSET = -0.1;

// ============================================================================
// Face-based shading constants (SDK-compatible)
// ============================================================================

// Face shading multipliers - creates depth by darkening faces based on direction
// SDK-compatible values for consistent visual appearance

// Top (+Y): brightest - receives direct light
export const FACE_SHADE_TOP = 1.0;

// Sides (+/-X, +/-Z): medium - partially lit
export const FACE_SHADE_SIDE = 0.8;

// Bottom (-Y): darkest - in shadow
export const FACE_SHADE_BOTTOM = 0.5;
