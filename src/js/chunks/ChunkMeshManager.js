// ChunkMeshManager.js
// Manages meshes for chunks

import * as THREE from 'three';
import BlockMaterial from '../blocks/BlockMaterial';
import {
  CHUNK_BUFFER_GEOMETRY_NUM_POSITION_COMPONENTS,
  CHUNK_BUFFER_GEOMETRY_NUM_NORMAL_COMPONENTS,
  CHUNK_BUFFER_GEOMETRY_NUM_UV_COMPONENTS,
  CHUNK_BUFFER_GEOMETRY_NUM_COLOR_COMPONENTS,
  MAX_SOLID_MESH_POOL_SIZE
} from './ChunkConstants';
import BlockTextureAtlas from '../blocks/BlockTextureAtlas';

/**
 * Manages meshes for chunks
 */
class ChunkMeshManager {
  constructor() {
    this._liquidMeshes = new Map();
    this._liquidMeshPool = [];
    this._solidMeshes = new Map();
    this._solidMeshPool = [];
  }

  /**
   * Get a liquid mesh for a chunk
   * @param {Chunk} chunk - The chunk
   * @param {Object} data - The mesh data
   * @returns {THREE.Mesh} The liquid mesh
   */
  getLiquidMesh(chunk, data) {
    const { positions, normals, uvs, indices, colors } = data;
    const liquidMesh = this._getLiquidMesh(chunk);
    const liquidGeometry = liquidMesh.geometry;

    liquidGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(positions), CHUNK_BUFFER_GEOMETRY_NUM_POSITION_COMPONENTS)
    );

    liquidGeometry.setAttribute(
      "normal",
      new THREE.BufferAttribute(new Float32Array(normals), CHUNK_BUFFER_GEOMETRY_NUM_NORMAL_COMPONENTS)
    );

    liquidGeometry.setAttribute(
      "uv",
      new THREE.BufferAttribute(new Float32Array(uvs), CHUNK_BUFFER_GEOMETRY_NUM_UV_COMPONENTS)
    );

    liquidGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(colors), CHUNK_BUFFER_GEOMETRY_NUM_COLOR_COMPONENTS)
    );

    liquidGeometry.setIndex(indices);
    liquidGeometry.computeBoundingSphere();

    liquidMesh.name = chunk.chunkId;

    this._liquidMeshes.set(chunk.chunkId, liquidMesh);

    return liquidMesh;
  }

  /**
   * Get a solid mesh for a chunk
   * @param {Chunk} chunk - The chunk
   * @param {Object} data - The mesh data
   * @returns {THREE.Mesh} The solid mesh
   */
  getSolidMesh(chunk, data) {
    const { positions, normals, uvs, indices, colors } = data;
    const solidMesh = this._getSolidMesh(chunk);
    const solidGeometry = solidMesh.geometry;

    solidGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(positions), CHUNK_BUFFER_GEOMETRY_NUM_POSITION_COMPONENTS)
    );

    solidGeometry.setAttribute(
      "normal",
      new THREE.BufferAttribute(new Float32Array(normals), CHUNK_BUFFER_GEOMETRY_NUM_NORMAL_COMPONENTS)
    );

    solidGeometry.setAttribute(
      "uv",
      new THREE.BufferAttribute(new Float32Array(uvs), CHUNK_BUFFER_GEOMETRY_NUM_UV_COMPONENTS)
    );

    solidGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(colors), CHUNK_BUFFER_GEOMETRY_NUM_COLOR_COMPONENTS)
    );

    solidGeometry.setIndex(indices);
    solidGeometry.computeBoundingSphere();

    solidMesh.name = chunk.chunkId;

    this._solidMeshes.set(chunk.chunkId, solidMesh);

    return solidMesh;
  }

  /**
   * Remove a liquid mesh for a chunk
   * @param {Chunk} chunk - The chunk
   * @returns {THREE.Mesh|undefined} The removed mesh
   */
  removeLiquidMesh(chunk) {
    const mesh = this._liquidMeshes.get(chunk.chunkId);

    if (mesh) {
      // Make sure the mesh is properly removed from its parent
      if (mesh.parent) {
        mesh.parent.remove(mesh);
      }
      mesh.removeFromParent();
      
      // Clear any caches
      mesh.geometry.dispose();
      
      // Clean mesh properties
      mesh.userData = {};
      
      // Remove from our tracking
      this._liquidMeshes.delete(chunk.chunkId);

      if (this._liquidMeshPool.length < MAX_SOLID_MESH_POOL_SIZE) {
        // Force clear any existing data on the mesh before re-pooling
        this._cleanMeshForReuse(mesh);
        this._liquidMeshPool.push(mesh);
      } else {
        // Dispose of geometry and material
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }
      }
      
      // Force THREE.js to update the scene
      if (mesh.parent && mesh.parent.updateMatrixWorld) {
        mesh.parent.updateMatrixWorld(true);
      }
    }

    return mesh;
  }

  /**
   * Remove a solid mesh for a chunk
   * @param {Chunk} chunk - The chunk
   * @returns {THREE.Mesh|undefined} The removed mesh
   */
  removeSolidMesh(chunk) {
    const mesh = this._solidMeshes.get(chunk.chunkId);

    if (mesh) {
      // Make sure the mesh is properly removed from its parent
      if (mesh.parent) {
        mesh.parent.remove(mesh);
      }
      mesh.removeFromParent();
      
      // Clear any caches
      mesh.geometry.dispose();
      
      // Clean mesh properties
      mesh.userData = {};
      
      // Remove from our tracking
      this._solidMeshes.delete(chunk.chunkId);

      if (this._solidMeshPool.length < MAX_SOLID_MESH_POOL_SIZE) {
        // Force clear any existing data on the mesh before re-pooling
        this._cleanMeshForReuse(mesh);
        this._solidMeshPool.push(mesh);
      } else {
        // Dispose of geometry and material
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }
      }
      
      // Force THREE.js to update the scene
      if (mesh.parent && mesh.parent.updateMatrixWorld) {
        mesh.parent.updateMatrixWorld(true);
      }
    }

    return mesh;
  }

  /**
   * Get a liquid mesh from the pool or create a new one
   * @param {Chunk} chunk - The chunk
   * @returns {THREE.Mesh} The liquid mesh
   * @private
   */
  _getLiquidMesh(chunk) {
    const chunkId = chunk.chunkId;
    const currentMesh = this._liquidMeshes.get(chunkId);

    if (currentMesh) {
      return currentMesh;
    }

    // Ensure BlockMaterial is initialized with the texture atlas
    const material = BlockMaterial.instance.liquidMaterial;
    
    // Check if the texture atlas is set
    if (BlockTextureAtlas.instance.textureAtlas && 
        (!material.uniforms.textureAtlas.value || material.uniforms.textureAtlas.value.image !== BlockTextureAtlas.instance.textureAtlas.image)) {
      console.log('Setting texture atlas for liquid material');
      BlockMaterial.instance.setTextureAtlas(BlockTextureAtlas.instance.textureAtlas);
    }

    let newMesh = this._liquidMeshPool.pop() || new THREE.Mesh(
      new THREE.BufferGeometry(), 
      material
    );

    newMesh.renderOrder = 1;
    newMesh.frustumCulled = false;

    this._liquidMeshes.set(chunkId, newMesh);

    return newMesh;
  }
  
  /**
   * Get a solid mesh from the pool or create a new one
   * @param {Chunk} chunk - The chunk
   * @returns {THREE.Mesh} The solid mesh
   * @private
   */
  _getSolidMesh(chunk) {
    const chunkId = chunk.chunkId;
    const currentMesh = this._solidMeshes.get(chunkId);

    if (currentMesh) {
      return currentMesh;
    }

    // Ensure BlockMaterial is initialized with the texture atlas
    const material = BlockMaterial.instance.defaultMaterial;
    
    // Check if the texture atlas is set
    if (BlockTextureAtlas.instance.textureAtlas && 
        (!material.map || material.map.image !== BlockTextureAtlas.instance.textureAtlas.image)) {
      console.log('Setting texture atlas for solid material');
      BlockMaterial.instance.setTextureAtlas(BlockTextureAtlas.instance.textureAtlas);
    }

    let newMesh = this._solidMeshPool.pop() || new THREE.Mesh(
      new THREE.BufferGeometry(), 
      material
    );

    newMesh.renderOrder = 0;
    newMesh.frustumCulled = true;

    this._solidMeshes.set(chunkId, newMesh);

    return newMesh;
  }

  /**
   * Clean a mesh for reuse
   * @param {THREE.Mesh} mesh - The mesh to clean
   * @private
   */
  _cleanMeshForReuse(mesh) {
    if (!mesh) return;
    
    // Remove all attributes from the geometry
    if (mesh.geometry) {
      const geometry = mesh.geometry;
      
      // Clear all attributes
      geometry.deleteAttribute('position');
      geometry.deleteAttribute('normal');
      geometry.deleteAttribute('uv');
      geometry.deleteAttribute('color');
      
      // Clear indices
      geometry.setIndex([]);
      
      // Update bounding information
      geometry.boundingSphere = null;
    }
    
    // Reset other properties
    mesh.visible = true;
    mesh.userData = {};
    mesh.name = '';
    
    return mesh;
  }
}

export default ChunkMeshManager; 