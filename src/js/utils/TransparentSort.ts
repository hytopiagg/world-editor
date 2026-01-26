import * as THREE from "three";

/**
 * AABB-based transparent sort utilities, ported from the HYTOPIA SDK.
 * Uses the farthest point of the AABB as the reference for determining
 * the rendering order of transparent objects.
 */

type TransparentSortData = {
  center: THREE.Vector3;
  halfSize: THREE.Vector3;
  key: number;
  frame: number;
};

const TRANSPARENT_SORT_DATA = "TransparentSortData";

// Working variables (reused to avoid allocations)
const _vec3 = new THREE.Vector3();
const _box3 = new THREE.Box3();

/**
 * Compute world-space AABB and store in mesh.userData for transparent sorting.
 * Must be called whenever the mesh's world matrix changes.
 */
export const updateAABB = (mesh: THREE.Mesh | THREE.InstancedMesh): void => {
  if (!(TRANSPARENT_SORT_DATA in mesh.userData)) {
    const data: TransparentSortData = {
      center: new THREE.Vector3(),
      halfSize: new THREE.Vector3(),
      key: -1,
      frame: -1,
    };
    mesh.userData[TRANSPARENT_SORT_DATA] = data;
  }

  if (mesh.geometry.boundingBox === null) {
    mesh.geometry.computeBoundingBox();
  }

  const { center, halfSize } =
    mesh.userData[TRANSPARENT_SORT_DATA] as TransparentSortData;
  _box3.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
  _box3.getCenter(center);
  _box3.getSize(halfSize).multiplyScalar(0.5);
};

const calculateDistanceKey = (
  center: THREE.Vector3,
  halfSize: THREE.Vector3,
  cameraPos: THREE.Vector3,
  viewDir: THREE.Vector3
): number => {
  const centerDist = _vec3.copy(center).sub(cameraPos).dot(viewDir);
  const projRadius = halfSize.dot(
    _vec3.set(Math.abs(viewDir.x), Math.abs(viewDir.y), Math.abs(viewDir.z))
  );
  return centerDist + projRadius;
};

/**
 * Get a cached sort key for a mesh based on its AABB distance from the camera.
 * Returns 0 as fallback for meshes without sort data (terrain chunks, etc.),
 * unlike the SDK which throws.
 */
export const getTransparentSortKey = (
  mesh: THREE.Object3D,
  cameraPos: THREE.Vector3,
  viewDir: THREE.Vector3,
  frame: number
): number => {
  if (!(TRANSPARENT_SORT_DATA in mesh.userData)) {
    return 0;
  }

  const data = mesh.userData[TRANSPARENT_SORT_DATA] as TransparentSortData;

  if (data.frame !== frame) {
    data.key = calculateDistanceKey(
      data.center,
      data.halfSize,
      cameraPos,
      viewDir
    );
    data.frame = frame;
  }

  return data.key;
};
