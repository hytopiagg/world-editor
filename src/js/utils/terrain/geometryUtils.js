import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils';

/**
 * Create geometry for a block type
 */
export const createBlockGeometry = (blockType) => {
  if (!blockType) {
    console.error("Invalid blockType:", blockType);
    return new THREE.BoxGeometry(1, 1, 1);
  }

  // Handle environment blocks (special case)
  if (blockType.isEnvironment && blockType.textureUri) {
    const texture = new THREE.TextureLoader().load(blockType.textureUri);
    const planeGeometry = new THREE.PlaneGeometry(1, 1);
    const plane1 = planeGeometry.clone();
    const plane2 = planeGeometry.clone();
    plane2.rotateY(Math.PI / 2);
    
    texture.onload = () => {
      const aspectRatio = texture.image.width / texture.image.height;
      plane1.scale(aspectRatio, 1, 1);
      plane2.scale(aspectRatio, 1, 1);
    };
    
    return mergeGeometries([plane1, plane2]);
  }

  // Standard block
  return new THREE.BoxGeometry(1, 1, 1);
};

/**
 * Create material for a block type
 */
export const createBlockMaterial = (blockType) => {
  if (!blockType) {
    console.error("Invalid blockType:", blockType);
    return new THREE.MeshLambertMaterial({ color: 0xff0000 });
  }

  // Check if block has side textures
  const hasSideTextures = blockType.sideTextures && Object.keys(blockType.sideTextures).length > 0;

  if (hasSideTextures) {
    // Create materials for each face
    const materials = [];
    const sides = ["+x", "-x", "+y", "-y", "+z", "-z"];

    sides.forEach((side) => {
      const texturePath = blockType.sideTextures[side] || blockType.textureUri;
      const texture = new THREE.TextureLoader().load(texturePath);
      
      // Configure texture
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(1, 1);
      texture.magFilter = THREE.NearestFilter; // Pixelated look
      
      // Create material
      const material = new THREE.MeshLambertMaterial({
        map: texture,
        alphaTest: 0.5,
        transparent: false,
        side: THREE.FrontSide,
      });
      
      materials.push(material);
    });

    return materials;
  } else {
    // Single texture for all faces
    const texture = new THREE.TextureLoader().load(blockType.textureUri);
    
    // Configure texture
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
    texture.magFilter = THREE.NearestFilter; // Pixelated look
    
    return new THREE.MeshLambertMaterial({
      map: texture,
      alphaTest: 0.5,
      transparent: false,
      side: THREE.FrontSide,
    });
  }
};

/**
 * Generate greedy mesh for a chunk's blocks
 */
export const generateGreedyMesh = (chunksBlocks, blockTypes) => {
  if (!chunksBlocks || chunksBlocks.length === 0) {
    return {
      positions: [],
      normals: [],
      uvs: [],
      indices: [],
      blockTypeIndices: []
    };
  }

  // Implementation would go here
  // This is a complex algorithm that merges adjacent blocks of the same type
  console.log(`Generating greedy mesh for ${chunksBlocks.length} blocks`);
  
  // Placeholder implementation
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const blockTypeIndices = [];
  
  // For each block, add its geometry
  chunksBlocks.forEach(block => {
    const { x, y, z, blockId } = block;
    const blockType = blockTypes.find(type => type.id === blockId);
    
    if (!blockType) return;
    
    // Add cube vertices (simplified)
    const verts = [
      // Front face
      x, y, z+1,
      x+1, y, z+1,
      x+1, y+1, z+1,
      x, y+1, z+1,
      // Back face
      x, y, z,
      x, y+1, z,
      x+1, y+1, z,
      x+1, y, z,
      // Top face
      x, y+1, z,
      x, y+1, z+1,
      x+1, y+1, z+1,
      x+1, y+1, z,
      // Bottom face
      x, y, z,
      x+1, y, z,
      x+1, y, z+1,
      x, y, z+1,
      // Right face
      x+1, y, z,
      x+1, y+1, z,
      x+1, y+1, z+1,
      x+1, y, z+1,
      // Left face
      x, y, z,
      x, y, z+1,
      x, y+1, z+1,
      x, y+1, z
    ];
    
    // Add vertices to positions array
    for (let i = 0; i < verts.length; i++) {
      positions.push(verts[i]);
    }
    
    // Add other attributes (simplified)
    for (let i = 0; i < 24; i++) {
      blockTypeIndices.push(blockId);
    }
  });
  
  return {
    positions,
    normals,
    uvs,
    indices,
    blockTypeIndices
  };
}; 