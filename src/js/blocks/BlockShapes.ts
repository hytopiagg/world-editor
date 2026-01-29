/**
 * Predefined block shapes for custom block geometry.
 * Each shape defines trimesh vertices and indices in unit cube space [0,1].
 * CUBE is the default and uses the standard face-based rendering (no trimesh).
 *
 * Vertices are in the 0-1 range per axis, matching the SDK convention.
 * Rotation is applied around center (0.5, 0.5, 0.5).
 */

export enum BlockShapeType {
    CUBE = 'cube',
    HALF_SLAB = 'half_slab',
    WEDGE_45 = 'wedge_45',
    STAIRS_2 = 'stairs_2',
    STAIRS_3 = 'stairs_3',
    QUARTER = 'quarter',
    FENCE_POST = 'fence_post',
    CROSS = 'cross',
    FENCE_1H = 'fence_1h',
    FENCE_2H = 'fence_2h',
    OUTER_CORNER_STAIRS_2 = 'outer_corner_stairs_2',
    OUTER_CORNER_STAIRS_3 = 'outer_corner_stairs_3',
}

export interface BlockShapeDefinition {
    type: BlockShapeType;
    name: string;
    vertices: Float32Array;
    indices: Uint32Array;
}

export interface TrimeshTriangleData {
    v0: [number, number, number];
    v1: [number, number, number];
    v2: [number, number, number];
    normal: [number, number, number];
    blockFace: string; // 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back'
    uv0: [number, number];
    uv1: [number, number];
    uv2: [number, number];
}

/**
 * Determine which block face a triangle normal corresponds to (for texture lookup).
 * Uses the dominant axis of the normal vector.
 */
export function normalToBlockFace(normal: [number, number, number]): string {
    const ax = Math.abs(normal[0]);
    const ay = Math.abs(normal[1]);
    const az = Math.abs(normal[2]);

    if (ay >= ax && ay >= az) {
        return normal[1] > 0 ? 'top' : 'bottom';
    } else if (ax >= az) {
        return normal[0] > 0 ? 'right' : 'left';
    } else {
        return normal[2] > 0 ? 'front' : 'back';
    }
}

/**
 * Compute UV coordinates for a trimesh triangle vertex based on its position
 * and the dominant face normal. Each face uses a specific projection that
 * matches the standard cube face UV conventions from BlockConstants.tsx:
 *   TOP:    u = 1-x, v = z
 *   BOTTOM: u = x,   v = 1-z
 *   LEFT:   u = z,   v = y
 *   RIGHT:  u = 1-z, v = y
 *   FRONT:  u = x,   v = y
 *   BACK:   u = 1-x, v = y
 */
export function computeTrimeshUV(
    pos: [number, number, number],
    blockFace: string
): [number, number] {
    switch (blockFace) {
        case 'top':    return [1 - pos[0], pos[2]];
        case 'bottom': return [pos[0], 1 - pos[2]];
        case 'left':   return [pos[2], pos[1]];
        case 'right':  return [1 - pos[2], pos[1]];
        case 'front':  return [pos[0], pos[1]];
        case 'back':   return [1 - pos[0], pos[1]];
        default:       return [pos[0], pos[1]];
    }
}

/**
 * Build TrimeshTriangleData array from raw vertices and indices.
 * This is the lazy-computed cache that BlockType stores.
 */
export function buildTrimeshTriangleData(
    vertices: Float32Array,
    indices: Uint32Array,
    shapeType?: string
): TrimeshTriangleData[] {
    const triangles: TrimeshTriangleData[] = [];
    for (let i = 0; i < indices.length; i += 3) {
        const i0 = indices[i] * 3;
        const i1 = indices[i + 1] * 3;
        const i2 = indices[i + 2] * 3;

        const v0: [number, number, number] = [vertices[i0], vertices[i0 + 1], vertices[i0 + 2]];
        const v1: [number, number, number] = [vertices[i1], vertices[i1 + 1], vertices[i1 + 2]];
        const v2: [number, number, number] = [vertices[i2], vertices[i2 + 1], vertices[i2 + 2]];

        // Compute face normal via cross product
        const e1x = v1[0] - v0[0], e1y = v1[1] - v0[1], e1z = v1[2] - v0[2];
        const e2x = v2[0] - v0[0], e2y = v2[1] - v0[1], e2z = v2[2] - v0[2];
        let nx = e1y * e2z - e1z * e2y;
        let ny = e1z * e2x - e1x * e2z;
        let nz = e1x * e2y - e1y * e2x;

        // Normalize
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len > 0) { nx /= len; ny /= len; nz /= len; }

        const normal: [number, number, number] = [nx, ny, nz];
        const blockFace = normalToBlockFace(normal);

        const uv0 = computeTrimeshUV(v0, blockFace);
        const uv1 = computeTrimeshUV(v1, blockFace);
        const uv2 = computeTrimeshUV(v2, blockFace);


        triangles.push({ v0, v1, v2, normal, blockFace, uv0, uv1, uv2 });
    }

    return triangles;
}

// ============================================
// Shape Definitions
// ============================================

// Helper: create Float32Array from flat number array
function v(arr: number[]): Float32Array { return new Float32Array(arr); }
function idx(arr: number[]): Uint32Array { return new Uint32Array(arr); }

// --- HALF SLAB (1 x 0.5 x 1, bottom half) ---
const HALF_SLAB_VERTICES = v([
    // Bottom face (y=0)
    0,0,0,  1,0,0,  1,0,1,  0,0,1,
    // Top face (y=0.5)
    0,0.5,0,  1,0.5,0,  1,0.5,1,  0,0.5,1,
]);
const HALF_SLAB_INDICES = idx([
    // Bottom
    0,1,2, 0,2,3,
    // Top
    4,6,5, 4,7,6,
    // Front (z=1)
    3,2,6, 3,6,7,
    // Back (z=0)
    0,5,1, 0,4,5,
    // Left (x=0)
    0,7,4, 0,3,7,
    // Right (x=1)
    1,6,2, 1,5,6,
]);

// --- WEDGE 45° (ramp from bottom-back to top-front) ---
const WEDGE_45_VERTICES = v([
    // Bottom face (y=0)
    0,0,0,  1,0,0,  1,0,1,  0,0,1,
    // Top edge (y=1, z=1)
    0,1,1,  1,1,1,
]);
const WEDGE_45_INDICES = idx([
    // Bottom
    0,1,2, 0,2,3,
    // Front (z=1, vertical)
    3,2,5, 3,5,4,
    // Slope (from back-bottom to front-top)
    0,5,1, 0,4,5,
    // Left triangle
    0,3,4,
    // Right triangle
    1,5,2,
]);

// --- 2-STEP STAIRS ---
const STAIRS_2_VERTICES = v([
    // Bottom face
    0,0,0,  1,0,0,  1,0,1,  0,0,1,
    // Step 1 top (y=0.5, z=0.5 to z=1)
    0,0.5,0.5,  1,0.5,0.5,  1,0.5,1,  0,0.5,1,
    // Step 2 top (y=1, z=0 to z=0.5)
    0,1,0,  1,1,0,  1,1,0.5,  0,1,0.5,
]);
const STAIRS_2_INDICES = idx([
    // Bottom
    0,1,2, 0,2,3,
    // Step 1 top
    4,6,5, 4,7,6,
    // Step 2 top
    8,10,9, 8,11,10,
    // Front face (z=1)
    3,2,6, 3,6,7,
    // Back face (z=0)
    0,9,1, 0,8,9,
    // Left face
    0,11,8, 0,4,11, 0,7,4, 0,3,7,
    // Right face
    1,6,2, 1,5,6, 1,10,5, 1,9,10,
    // Step 1 riser (z=0.5, y=0 to y=0.5)
    4,1,5, 4,0,1,  // reuse: connects bottom back to step 1 -- actually this needs to be the riser
    // Step 2 riser (z=0.5, y=0.5 to y=1)
    11,5,10, 11,4,5,
]);

// --- 3-STEP STAIRS ---
const STAIRS_3_VERTICES = v([
    // Bottom
    0,0,0,  1,0,0,  1,0,1,  0,0,1,
    // Step 1 (y=1/3, z=2/3..1)
    0,1/3,2/3,  1,1/3,2/3,  1,1/3,1,  0,1/3,1,
    // Step 2 (y=2/3, z=1/3..2/3)
    0,2/3,1/3,  1,2/3,1/3,  1,2/3,2/3,  0,2/3,2/3,
    // Step 3 (y=1, z=0..1/3)
    0,1,0,  1,1,0,  1,1,1/3,  0,1,1/3,
]);
const STAIRS_3_INDICES = idx([
    // Bottom
    0,1,2, 0,2,3,
    // Step 1 top
    4,6,5, 4,7,6,
    // Step 2 top
    8,10,9, 8,11,10,
    // Step 3 top
    12,14,13, 12,15,14,
    // Front (z=1)
    3,2,6, 3,6,7,
    // Back (z=0)
    0,13,1, 0,12,13,
    // Left
    0,15,12, 0,8,15, 0,11,8, 0,4,11, 0,7,4, 0,3,7,
    // Right
    1,6,2, 1,5,6, 1,10,5, 1,9,10, 1,14,9, 1,13,14,
    // Riser 1 (z=2/3)
    4,0,5, 5,0,1, // bottom to step1 — this is a simplification
    // Riser 2 (z=1/3)
    11,5,10, 11,4,5,
    // Riser 3
    15,9,14, 15,8,9,
]);

// --- QUARTER BLOCK (1x1x1 corner piece, lower-front-left quarter: x=0..0.5, y=0..0.5, z=0.5..1) ---
const QUARTER_VERTICES = v([
    0,0,0.5,  0.5,0,0.5,  0.5,0,1,  0,0,1,
    0,0.5,0.5,  0.5,0.5,0.5,  0.5,0.5,1,  0,0.5,1,
]);
const QUARTER_INDICES = idx([
    // Bottom
    0,1,2, 0,2,3,
    // Top
    4,6,5, 4,7,6,
    // Front (z=1)
    3,2,6, 3,6,7,
    // Back (z=0.5)
    0,5,1, 0,4,5,
    // Left (x=0)
    0,7,4, 0,3,7,
    // Right (x=0.5)
    1,6,2, 1,5,6,
]);

// --- FENCE POST (centered 0.25x1x0.25) ---
const FP_MIN = 0.375;
const FP_MAX = 0.625;
const FENCE_POST_VERTICES = v([
    FP_MIN,0,FP_MIN,  FP_MAX,0,FP_MIN,  FP_MAX,0,FP_MAX,  FP_MIN,0,FP_MAX,
    FP_MIN,1,FP_MIN,  FP_MAX,1,FP_MIN,  FP_MAX,1,FP_MAX,  FP_MIN,1,FP_MAX,
]);
const FENCE_POST_INDICES = idx([
    // Bottom
    0,1,2, 0,2,3,
    // Top
    4,6,5, 4,7,6,
    // Front
    3,2,6, 3,6,7,
    // Back
    0,5,1, 0,4,5,
    // Left
    0,7,4, 0,3,7,
    // Right
    1,6,2, 1,5,6,
]);

// --- CROSS (two intersecting planes, like flowers/grass) ---
const CROSS_VERTICES = v([
    // Plane 1 (diagonal from 0,0,0 to 1,0,1 / 0,1,0 to 1,1,1)
    0,0,0,  1,0,1,  0,1,0,  1,1,1,
    // Plane 2 (diagonal from 1,0,0 to 0,0,1 / 1,1,0 to 0,1,1)
    1,0,0,  0,0,1,  1,1,0,  0,1,1,
]);
const CROSS_INDICES = idx([
    // Plane 1 front
    0,3,1, 0,2,3,
    // Plane 1 back
    1,2,0, 1,3,2,
    // Plane 2 front
    4,7,5, 4,6,7,
    // Plane 2 back
    5,6,4, 5,7,6,
]);

// --- FENCE WITH 1 HORIZONTAL BAR (post + bar at mid-height on +Z side) ---
const FENCE_1H_VERTICES = v([
    // Post (same as FENCE_POST)
    FP_MIN,0,FP_MIN,  FP_MAX,0,FP_MIN,  FP_MAX,0,FP_MAX,  FP_MIN,0,FP_MAX,
    FP_MIN,1,FP_MIN,  FP_MAX,1,FP_MIN,  FP_MAX,1,FP_MAX,  FP_MIN,1,FP_MAX,
    // Horizontal bar (y=0.375..0.625, x=FP_MIN..FP_MAX, z=FP_MAX..1)
    FP_MIN,0.375,FP_MAX,  FP_MAX,0.375,FP_MAX,  FP_MAX,0.375,1,  FP_MIN,0.375,1,
    FP_MIN,0.625,FP_MAX,  FP_MAX,0.625,FP_MAX,  FP_MAX,0.625,1,  FP_MIN,0.625,1,
]);
const FENCE_1H_INDICES = idx([
    // Post bottom
    0,1,2, 0,2,3,
    // Post top
    4,6,5, 4,7,6,
    // Post front
    3,2,6, 3,6,7,
    // Post back
    0,5,1, 0,4,5,
    // Post left
    0,7,4, 0,3,7,
    // Post right
    1,6,2, 1,5,6,
    // Bar bottom
    8,9,10, 8,10,11,
    // Bar top
    12,14,13, 12,15,14,
    // Bar front (z=1)
    11,10,14, 11,14,15,
    // Bar left (x=FP_MIN)
    8,15,12, 8,11,15,
    // Bar right (x=FP_MAX)
    9,14,10, 9,13,14,
]);

// --- FENCE WITH 2 HORIZONTAL BARS ---
const FENCE_2H_VERTICES = v([
    // Post
    FP_MIN,0,FP_MIN,  FP_MAX,0,FP_MIN,  FP_MAX,0,FP_MAX,  FP_MIN,0,FP_MAX,
    FP_MIN,1,FP_MIN,  FP_MAX,1,FP_MIN,  FP_MAX,1,FP_MAX,  FP_MIN,1,FP_MAX,
    // Lower bar (y=0.25..0.375)
    FP_MIN,0.25,FP_MAX,  FP_MAX,0.25,FP_MAX,  FP_MAX,0.25,1,  FP_MIN,0.25,1,
    FP_MIN,0.375,FP_MAX,  FP_MAX,0.375,FP_MAX,  FP_MAX,0.375,1,  FP_MIN,0.375,1,
    // Upper bar (y=0.625..0.75)
    FP_MIN,0.625,FP_MAX,  FP_MAX,0.625,FP_MAX,  FP_MAX,0.625,1,  FP_MIN,0.625,1,
    FP_MIN,0.75,FP_MAX,  FP_MAX,0.75,FP_MAX,  FP_MAX,0.75,1,  FP_MIN,0.75,1,
]);
const FENCE_2H_INDICES = idx([
    // Post
    0,1,2, 0,2,3,  4,6,5, 4,7,6,
    3,2,6, 3,6,7,  0,5,1, 0,4,5,
    0,7,4, 0,3,7,  1,6,2, 1,5,6,
    // Lower bar
    8,9,10, 8,10,11,  12,14,13, 12,15,14,
    11,10,14, 11,14,15,
    8,15,12, 8,11,15,  9,14,10, 9,13,14,
    // Upper bar
    16,17,18, 16,18,19,  20,22,21, 20,23,22,
    19,18,22, 19,22,23,
    16,23,20, 16,19,23,  17,22,18, 17,21,22,
]);

// --- OUTER CORNER STAIRS (2-step, corner piece) ---
// Like STAIRS_2 but with back-right corner (x∈[0.5,1], z∈[0,0.5]) cut out above y=0.5
const OCS2_VERTICES = v([
    // y=0 plane (bottom)
    0,0,0,      // 0: x=0, z=0
    0.5,0,0,    // 1: x=0.5, z=0
    1,0,0,      // 2: x=1, z=0
    0,0,0.5,    // 3: x=0, z=0.5
    0.5,0,0.5,  // 4: x=0.5, z=0.5
    1,0,0.5,    // 5: x=1, z=0.5
    0,0,1,      // 6: x=0, z=1
    1,0,1,      // 7: x=1, z=1
    // y=0.5 plane (step 1 top / cutout floor)
    0,0.5,0.5,    // 8: x=0, z=0.5
    0.5,0.5,0.5,  // 9: x=0.5, z=0.5 (corner of step 2)
    1,0.5,0.5,    // 10: x=1, z=0.5
    0,0.5,1,      // 11: x=0, z=1
    1,0.5,1,      // 12: x=1, z=1
    0.5,0.5,0,    // 13: x=0.5, z=0 (cutout floor)
    1,0.5,0,      // 14: x=1, z=0 (cutout floor)
    // y=1 plane (step 2 top) - only x∈[0,0.5], z∈[0,0.5]
    0,1,0,      // 15: x=0, z=0
    0.5,1,0,    // 16: x=0.5, z=0
    0.5,1,0.5,  // 17: x=0.5, z=0.5
    0,1,0.5,    // 18: x=0, z=0.5
]);
const OCS2_INDICES = idx([
    // Bottom y=0 (normal -Y) - full quad
    0,2,7, 0,7,6,
    // Step 1 top y=0.5, z∈[0.5,1] (normal +Y)
    8,12,10, 8,11,12,
    // Step 2 top y=1 (normal +Y)
    15,17,16, 15,18,17,
    // Cutout floor y=0.5, x∈[0.5,1], z∈[0,0.5] (normal +Y)
    13,10,14, 13,9,10,
    // Front z=1 (normal +Z)
    6,7,12, 6,12,11,
    // Back z=0, x∈[0,0.5], y∈[0,1] (normal -Z)
    0,16,1, 0,15,16,
    // Back z=0, x∈[0.5,1], y∈[0,0.5] (normal -Z)
    1,14,2, 1,13,14,
    // Left x=0 (normal -X) - L-shaped fan
    0,18,15, 0,8,18, 0,11,8, 0,6,11,
    // Right x=1, y∈[0,0.5] (normal +X)
    2,12,7, 2,10,12, 2,14,10,
    // Z-riser z=0.5, x∈[0,0.5], y∈[0,0.5] (normal -Z)
    3,9,4, 3,8,9,
    // Z-riser z=0.5, x∈[0.5,1], y∈[0,0.5] (normal -Z)
    4,10,5, 4,9,10,
    // Z-riser z=0.5, x∈[0,0.5], y∈[0.5,1] (normal -Z)
    8,17,9, 8,18,17,
    // X-riser x=0.5, z∈[0,0.5], y∈[0,0.5] (normal +X)
    1,9,4, 1,13,9,
    // X-riser x=0.5, z∈[0,0.5], y∈[0.5,1] (normal +X)
    13,17,9, 13,16,17,
]);

// --- OUTER CORNER STAIRS (3-step) ---
// Layout (top-down view, +Z is front, +X is right):
//   Step 3 (y=2/3→1): x∈[0,1/3], z∈[0,1/3] - back-left corner (tallest)
//   Step 2 (y=1/3→2/3): x∈[0,2/3], z∈[1/3,2/3] - middle band
//   Step 1 (y=0→1/3): full base, top at z∈[2/3,1] - front (shortest)
//   Open corner: the staircase notch cut into back-right
const T = 1/3;
const TT = 2/3;
const OCS3_VERTICES = v([
    // Bottom corners (y=0)
    0,0,0,      // 0: back-left
    1,0,0,      // 1: back-right
    1,0,1,      // 2: front-right
    0,0,1,      // 3: front-left
    // Step 1 top (y=T) - front strip z∈[TT,1]
    0,T,TT,     // 4: left at z=TT
    T,T,TT,     // 5
    TT,T,TT,    // 6
    1,T,TT,     // 7: right at z=TT
    1,T,1,      // 8: front-right
    0,T,1,      // 9: front-left
    // Step 2 top (y=TT) - middle strip
    0,TT,T,     // 10: left at z=T
    T,TT,T,     // 11
    TT,TT,T,    // 12
    TT,TT,TT,   // 13
    0,TT,TT,    // 14
    // Step 3 top (y=1) - back-left corner
    0,1,0,      // 15: back-left
    T,1,0,      // 16
    T,1,T,      // 17
    0,1,T,      // 18
    // Interior floor at y=T (cut-out area)
    T,T,0,      // 19
    TT,T,0,     // 20
    1,T,0,      // 21
    T,T,T,      // 22
    TT,T,T,     // 23
    1,T,T,      // 24
    // Interior floor at y=TT
    T,TT,0,     // 25
    TT,TT,0,    // 26
    // Bottom edge vertices
    0,0,T,      // 27: left at z=T
    0,0,TT,     // 28: left at z=TT
    T,0,0,      // 29: at x=T, z=0
    TT,0,0,     // 30: at x=TT, z=0
    T,0,T,      // 31: at x=T, z=T
    TT,0,T,     // 32: at x=TT, z=T
    T,0,TT,     // 33: at x=T, z=TT
    TT,0,TT,    // 34: at x=TT, z=TT
    1,0,T,      // 35: right at z=T
    1,0,TT,     // 36: right at z=TT
]);
const OCS3_INDICES = idx([
    // === EXTERIOR FACES ===

    // Bottom (normal -Y)
    0,2,3, 0,1,2,

    // Step 1 top y=T, z∈[TT,1] (normal +Y)
    4,8,7, 4,9,8,

    // Step 2 top y=TT, z∈[T,TT] (normal +Y)
    10,13,12, 10,14,13,

    // Step 3 top y=1 (normal +Y)
    15,17,16, 15,18,17,

    // Front face z=1 (normal +Z)
    3,2,8, 3,8,9,

    // Back face z=0, x∈[0,T], full height (normal -Z)
    0,16,29, 0,15,16,

    // Back face z=0, x∈[T,TT], y∈[0,T] (normal -Z)
    29,20,30, 29,19,20,

    // Back face z=0, x∈[T,TT], y∈[T,TT] (normal -Z)
    19,26,20, 19,25,26,

    // Back face z=0, x∈[TT,1], y∈[0,T] (normal -Z)
    30,21,1, 30,20,21,

    // Left face x=0 (normal -X) - L-shaped
    0,18,15, 0,10,18, 0,14,10, 0,4,14, 0,9,4, 0,3,9,

    // Right face x=1, z∈[TT,1], y∈[0,T] (normal +X)
    36,8,2, 36,7,8,

    // Right face x=1, z∈[T,TT], y∈[0,T] (normal +X)
    35,7,36, 35,24,7,

    // Right face x=1, z∈[0,T], y∈[0,T] (normal +X)
    1,24,35, 1,21,24,

    // === INTERIOR FACES ===

    // Floor at y=T, z∈[T,TT], x∈[TT,1] (normal +Y)
    23,7,24, 23,6,7,

    // Floor at y=T, z∈[0,T], x∈[T,1] (normal +Y)
    19,23,20, 19,22,23, 20,24,21, 20,23,24,

    // Floor at y=TT, z∈[0,T], x∈[T,TT] (normal +Y)
    25,12,26, 25,11,12,

    // Z-riser at z=TT, y∈[0,T], full width (normal -Z)
    28,5,33, 28,4,5, 33,6,34, 33,5,6, 34,7,36, 34,6,7,

    // Z-riser at z=TT, y∈[T,TT], x∈[0,TT] (normal -Z)
    4,13,6, 4,14,13,

    // Z-riser at z=T, y∈[0,T], x∈[0,T] (normal -Z)
    27,22,31, 27,11,22, 27,10,11,

    // Z-riser at z=T, y∈[0,T], x∈[T,TT] (normal -Z)
    31,23,32, 31,22,23, 22,12,23, 22,11,12,

    // Z-riser at z=T, y∈[TT,1], x∈[0,T] (normal -Z)
    10,17,11, 10,18,17,

    // Z-riser at z=T, y∈[0,T], x∈[TT,1] (normal -Z)
    32,24,35, 32,23,24,

    // X-riser at x=TT, z∈[T,TT], y∈[0,T] (normal +X)
    32,13,34, 32,12,13,

    // X-riser at x=TT, z∈[T,TT], y∈[T,TT] (normal +X)
    23,12,13,

    // X-riser at x=TT, z∈[0,T], y∈[0,T] (normal +X)
    30,23,32, 30,20,23,

    // X-riser at x=T, z∈[0,T], y∈[0,T] (normal +X)
    29,22,31, 29,19,22,

    // X-riser at x=T, z∈[0,T], y∈[T,1] (normal +X)
    19,17,22, 19,16,17,
]);

/**
 * Registry of all predefined block shapes.
 * CUBE has no trimesh data (null) and uses standard face-based rendering.
 */
export const BLOCK_SHAPES: Record<BlockShapeType, BlockShapeDefinition | null> = {
    [BlockShapeType.CUBE]: null, // Uses standard face rendering, no trimesh

    [BlockShapeType.HALF_SLAB]: {
        type: BlockShapeType.HALF_SLAB,
        name: 'Half Slab',
        vertices: HALF_SLAB_VERTICES,
        indices: HALF_SLAB_INDICES,
    },

    [BlockShapeType.WEDGE_45]: {
        type: BlockShapeType.WEDGE_45,
        name: 'Wedge',
        vertices: WEDGE_45_VERTICES,
        indices: WEDGE_45_INDICES,
    },

    [BlockShapeType.STAIRS_2]: {
        type: BlockShapeType.STAIRS_2,
        name: '2-Step Stairs',
        vertices: STAIRS_2_VERTICES,
        indices: STAIRS_2_INDICES,
    },

    [BlockShapeType.STAIRS_3]: {
        type: BlockShapeType.STAIRS_3,
        name: '3-Step Stairs',
        vertices: STAIRS_3_VERTICES,
        indices: STAIRS_3_INDICES,
    },

    [BlockShapeType.QUARTER]: {
        type: BlockShapeType.QUARTER,
        name: 'Quarter Block',
        vertices: QUARTER_VERTICES,
        indices: QUARTER_INDICES,
    },

    [BlockShapeType.FENCE_POST]: {
        type: BlockShapeType.FENCE_POST,
        name: 'Fence Post',
        vertices: FENCE_POST_VERTICES,
        indices: FENCE_POST_INDICES,
    },

    [BlockShapeType.CROSS]: {
        type: BlockShapeType.CROSS,
        name: 'Cross',
        vertices: CROSS_VERTICES,
        indices: CROSS_INDICES,
    },

    [BlockShapeType.FENCE_1H]: {
        type: BlockShapeType.FENCE_1H,
        name: 'Fence (1 Bar)',
        vertices: FENCE_1H_VERTICES,
        indices: FENCE_1H_INDICES,
    },

    [BlockShapeType.FENCE_2H]: {
        type: BlockShapeType.FENCE_2H,
        name: 'Fence (2 Bars)',
        vertices: FENCE_2H_VERTICES,
        indices: FENCE_2H_INDICES,
    },

    [BlockShapeType.OUTER_CORNER_STAIRS_2]: {
        type: BlockShapeType.OUTER_CORNER_STAIRS_2,
        name: 'Corner Stairs (2)',
        vertices: OCS2_VERTICES,
        indices: OCS2_INDICES,
    },

    [BlockShapeType.OUTER_CORNER_STAIRS_3]: {
        type: BlockShapeType.OUTER_CORNER_STAIRS_3,
        name: 'Corner Stairs (3)',
        vertices: OCS3_VERTICES,
        indices: OCS3_INDICES,
    },
};

/**
 * Get all non-cube shape types for UI display.
 */
export function getCustomShapeTypes(): BlockShapeType[] {
    return Object.values(BlockShapeType).filter(t => t !== BlockShapeType.CUBE);
}

/**
 * Get shape definition by type. Returns null for CUBE.
 */
export function getShapeDefinition(shapeType: BlockShapeType): BlockShapeDefinition | null {
    return BLOCK_SHAPES[shapeType] ?? null;
}
