import * as THREE from 'three';
import { CHUNK_SIZE } from '../../constants/terrain';

// Helper function to get chunk key from position
export const getChunkKey = (x, y, z) => {
  return `${Math.floor(x / CHUNK_SIZE)},${Math.floor(y / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
};

// Get chunk coordinates from position
export const getChunkCoords = (x, y, z) => {
  return {
    cx: Math.floor(x / CHUNK_SIZE),
    cy: Math.floor(y / CHUNK_SIZE),
    cz: Math.floor(z / CHUNK_SIZE)
  };
};

// Get local coordinates within a chunk
export const getLocalCoords = (x, y, z) => {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cy = Math.floor(y / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  
  return {
    lx: Math.abs(x - cx * CHUNK_SIZE) % CHUNK_SIZE,
    ly: Math.abs(y - cy * CHUNK_SIZE) % CHUNK_SIZE,
    lz: Math.abs(z - cz * CHUNK_SIZE) % CHUNK_SIZE
  };
};

// Get local key for a block within a chunk
export const getLocalKey = (lx, ly, lz) => {
  return `${lx},${ly},${lz}`;
};

// Check if a chunk is within view distance of the camera
export const isChunkVisible = (chunkKey, camera, frustum, viewDistance) => {
  const [cx, cy, cz] = chunkKey.split(',').map(Number);
  
  // Create a bounding box for the chunk
  const chunkCenter = new THREE.Vector3(
    cx * CHUNK_SIZE + CHUNK_SIZE / 2,
    cy * CHUNK_SIZE + CHUNK_SIZE / 2,
    cz * CHUNK_SIZE + CHUNK_SIZE / 2
  );
  
  // Check if chunk center is within view distance
  if (camera.position.distanceTo(chunkCenter) > viewDistance) {
    return false;
  }
  
  // Create bounding box for the chunk
  const bbox = new THREE.Box3().setFromCenterAndSize(
    chunkCenter,
    new THREE.Vector3(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE)
  );
  
  // Check if chunk is in frustum
  return frustum.intersectsBox(bbox);
}; 