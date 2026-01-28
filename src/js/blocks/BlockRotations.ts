/**
 * Block rotation system matching the HYTOPIA SDK's 24 rotation definitions.
 * Each rotation represents one of the 24 possible orientations of a cube,
 * organized as 6 face axes × 4 rotations per axis.
 *
 * Ported from:
 *   SDK server: Block.ts (BLOCK_ROTATIONS)
 *   SDK client: BlockConstants.ts (BLOCK_ROTATION_MATRICES)
 */

export interface BlockRotation {
    enumIndex: number;
    matrix: readonly number[]; // 3x3 rotation matrix in row-major order (9 values)
}

export const BLOCK_ROTATIONS = {
    // Y-axis rotations (top face up)
    Y_0:    { enumIndex: 0,  matrix: [  1, 0, 0,   0, 1, 0,   0, 0, 1 ] },
    Y_90:   { enumIndex: 1,  matrix: [  0, 0,-1,   0, 1, 0,   1, 0, 0 ] },
    Y_180:  { enumIndex: 2,  matrix: [ -1, 0, 0,   0, 1, 0,   0, 0,-1 ] },
    Y_270:  { enumIndex: 3,  matrix: [  0, 0, 1,   0, 1, 0,  -1, 0, 0 ] },

    // Negative Y-axis rotations (bottom face up)
    NY_0:   { enumIndex: 4,  matrix: [ -1, 0, 0,   0,-1, 0,   0, 0, 1 ] },
    NY_90:  { enumIndex: 5,  matrix: [  0, 0,-1,   0,-1, 0,  -1, 0, 0 ] },
    NY_180: { enumIndex: 6,  matrix: [  1, 0, 0,   0,-1, 0,   0, 0,-1 ] },
    NY_270: { enumIndex: 7,  matrix: [  0, 0, 1,   0,-1, 0,   1, 0, 0 ] },

    // X-axis rotations (right face up)
    X_0:    { enumIndex: 8,  matrix: [  0,-1, 0,   1, 0, 0,   0, 0, 1 ] },
    X_90:   { enumIndex: 9,  matrix: [  0, 0,-1,   1, 0, 0,   0,-1, 0 ] },
    X_180:  { enumIndex: 10, matrix: [  0, 1, 0,   1, 0, 0,   0, 0,-1 ] },
    X_270:  { enumIndex: 11, matrix: [  0, 0, 1,   1, 0, 0,   0, 1, 0 ] },

    // Negative X-axis rotations (left face up)
    NX_0:   { enumIndex: 12, matrix: [  0, 1, 0,  -1, 0, 0,   0, 0, 1 ] },
    NX_90:  { enumIndex: 13, matrix: [  0, 0,-1,  -1, 0, 0,   0, 1, 0 ] },
    NX_180: { enumIndex: 14, matrix: [  0,-1, 0,  -1, 0, 0,   0, 0,-1 ] },
    NX_270: { enumIndex: 15, matrix: [  0, 0, 1,  -1, 0, 0,   0,-1, 0 ] },

    // Z-axis rotations (front face up)
    Z_0:    { enumIndex: 16, matrix: [  1, 0, 0,   0, 0, 1,   0,-1, 0 ] },
    Z_90:   { enumIndex: 17, matrix: [  0, 1, 0,   0, 0, 1,   1, 0, 0 ] },
    Z_180:  { enumIndex: 18, matrix: [ -1, 0, 0,   0, 0, 1,   0, 1, 0 ] },
    Z_270:  { enumIndex: 19, matrix: [  0,-1, 0,   0, 0, 1,  -1, 0, 0 ] },

    // Negative Z-axis rotations (back face up)
    NZ_0:   { enumIndex: 20, matrix: [  1, 0, 0,   0, 0,-1,   0, 1, 0 ] },
    NZ_90:  { enumIndex: 21, matrix: [  0,-1, 0,   0, 0,-1,   1, 0, 0 ] },
    NZ_180: { enumIndex: 22, matrix: [ -1, 0, 0,   0, 0,-1,   0,-1, 0 ] },
    NZ_270: { enumIndex: 23, matrix: [  0, 1, 0,   0, 0,-1,  -1, 0, 0 ] },
} as const;

/**
 * Flat array of rotation matrices indexed by enumIndex (0-23).
 * Each entry is a 9-element row-major 3x3 rotation matrix.
 */
export const BLOCK_ROTATION_MATRICES: readonly (readonly number[])[] = Object.values(BLOCK_ROTATIONS)
    .sort((a, b) => a.enumIndex - b.enumIndex)
    .map(r => r.matrix);

/**
 * Rotate a vertex position around the block center (0.5, 0.5, 0.5).
 * This matches the SDK's _rotateAroundBlockCenter implementation.
 */
export function rotateAroundBlockCenter(
    pos: [number, number, number],
    rotationIndex: number,
    out?: [number, number, number]
): [number, number, number] {
    if (rotationIndex === 0) {
        if (out) { out[0] = pos[0]; out[1] = pos[1]; out[2] = pos[2]; return out; }
        return [pos[0], pos[1], pos[2]];
    }
    const m = BLOCK_ROTATION_MATRICES[rotationIndex];
    const cx = pos[0] - 0.5;
    const cy = pos[1] - 0.5;
    const cz = pos[2] - 0.5;
    const rx = m[0] * cx + m[1] * cy + m[2] * cz + 0.5;
    const ry = m[3] * cx + m[4] * cy + m[5] * cz + 0.5;
    const rz = m[6] * cx + m[7] * cy + m[8] * cz + 0.5;
    if (out) { out[0] = rx; out[1] = ry; out[2] = rz; return out; }
    return [rx, ry, rz];
}

/**
 * Rotate a direction vector (no translation, no centering).
 * Used for normals and face directions.
 */
export function rotateDirection(
    dir: [number, number, number] | number[],
    rotationIndex: number,
    out?: [number, number, number]
): [number, number, number] {
    if (rotationIndex === 0) {
        if (out) { out[0] = dir[0]; out[1] = dir[1]; out[2] = dir[2]; return out; }
        return [dir[0], dir[1], dir[2]];
    }
    const m = BLOCK_ROTATION_MATRICES[rotationIndex];
    const rx = m[0] * dir[0] + m[1] * dir[1] + m[2] * dir[2];
    const ry = m[3] * dir[0] + m[4] * dir[1] + m[5] * dir[2];
    const rz = m[6] * dir[0] + m[7] * dir[1] + m[8] * dir[2];
    if (out) { out[0] = rx; out[1] = ry; out[2] = rz; return out; }
    return [rx, ry, rz];
}

// --- Keyboard rotation cycle helpers ---

/** Y-axis rotation cycle: 0 → 90 → 180 → 270 → 0 */
const Y_ROTATION_CYCLE: number[] = [
    BLOCK_ROTATIONS.Y_0.enumIndex,
    BLOCK_ROTATIONS.Y_90.enumIndex,
    BLOCK_ROTATIONS.Y_180.enumIndex,
    BLOCK_ROTATIONS.Y_270.enumIndex,
];

/**
 * Face orientation groups. Each group starts at the 0° rotation for a face axis.
 * Cycling with Shift+R moves between the first entry of each group (keeping sub-rotation 0).
 */
const FACE_GROUP_STARTS: number[] = [
    BLOCK_ROTATIONS.Y_0.enumIndex,   // Y (default)
    BLOCK_ROTATIONS.X_0.enumIndex,   // X
    BLOCK_ROTATIONS.NX_0.enumIndex,  // NX
    BLOCK_ROTATIONS.Z_0.enumIndex,   // Z
    BLOCK_ROTATIONS.NZ_0.enumIndex,  // NZ
    BLOCK_ROTATIONS.NY_0.enumIndex,  // NY
];

/**
 * Get the next Y rotation (cycling 0→90→180→270→0).
 * If the current rotation is not a Y rotation, returns Y_90 as the starting point.
 */
export function getNextYRotation(currentEnumIndex: number): number {
    const idx = Y_ROTATION_CYCLE.indexOf(currentEnumIndex);
    if (idx === -1) {
        // Not currently a Y rotation; start at Y_90
        return BLOCK_ROTATIONS.Y_90.enumIndex;
    }
    return Y_ROTATION_CYCLE[(idx + 1) % Y_ROTATION_CYCLE.length];
}

/**
 * Get the next face orientation (cycling through Y, X, NX, Z, NZ, NY groups).
 * Preserves the sub-rotation offset within the group.
 */
export function getNextFaceRotation(currentEnumIndex: number): number {
    // Determine current face group (each group has 4 consecutive indices)
    const groupIndex = Math.floor(currentEnumIndex / 4);
    const subRotation = currentEnumIndex % 4;

    // Find which FACE_GROUP_STARTS group we're in
    const currentGroupStart = groupIndex * 4;
    const faceIdx = FACE_GROUP_STARTS.indexOf(currentGroupStart);

    let nextFaceIdx: number;
    if (faceIdx === -1) {
        // Shouldn't happen, but fallback to first group
        nextFaceIdx = 0;
    } else {
        nextFaceIdx = (faceIdx + 1) % FACE_GROUP_STARTS.length;
    }

    return FACE_GROUP_STARTS[nextFaceIdx] + subRotation;
}

/**
 * Get a human-readable label for a rotation index.
 */
export function getRotationLabel(enumIndex: number): string {
    const names = Object.entries(BLOCK_ROTATIONS);
    for (const [name, rot] of names) {
        if (rot.enumIndex === enumIndex) {
            return name.replace('_', ' ');
        }
    }
    return `R${enumIndex}`;
}
