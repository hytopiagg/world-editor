import * as THREE from 'three';

/**
 * ChunkWorkerManager
 * 
 * Manages a pool of web workers for parallel chunk mesh generation.
 * Distributes work across multiple threads and handles results asynchronously.
 */
export class ChunkWorkerManager {
  constructor(maxWorkers = 4) {
    this.workers = [];
    this.busy = [];
    this.pendingChunks = [];
    this.callbacks = new Map();
    this.textureAtlasData = null;
    this.blockTypes = [];
    this.maxWorkers = maxWorkers || Math.max(2, (navigator.hardwareConcurrency || 4) - 1);
    this.initialized = false;
    this.atlasTexture = null;
    
    // Initialize worker pool
    this.init();
  }
  
  /**
   * Initialize the worker pool
   */
  init() {
    console.log(`Initializing chunk worker pool with ${this.maxWorkers} workers`);
    
    for (let i = 0; i < this.maxWorkers; i++) {
      try {
        const worker = new Worker(new URL('./chunkWorker.js', import.meta.url));
        
        worker.onmessage = (e) => this.handleWorkerMessage(i, e);
        worker.onerror = (error) => this.handleWorkerError(i, error);
        
        this.workers.push(worker);
        this.busy.push(false);
      } catch (error) {
        console.error('Error creating chunk worker:', error);
      }
    }
  }
  
  /**
   * Set texture atlas data for workers
   */
  setTextureAtlas(textureAtlas) {
    if (!textureAtlas) return;
    
    this.atlasTexture = textureAtlas.getAtlasTexture();
    
    // Extract UV data as a plain object for easy transfer to workers
    this.textureAtlasData = {};
    textureAtlas.blockUVs.forEach((uvs, key) => {
      this.textureAtlasData[key] = uvs;
    });
    
    // Initialize workers with atlas data
    if (this.workers.length > 0 && this.textureAtlasData && this.blockTypes.length > 0) {
      this.initWorkers();
    }
  }
  
  /**
   * Set block types for workers
   */
  setBlockTypes(blockTypes) {
    this.blockTypes = blockTypes;
    
    // Initialize workers with block types data
    if (this.workers.length > 0 && this.textureAtlasData && this.blockTypes.length > 0) {
      this.initWorkers();
    }
  }
  
  /**
   * Initialize workers with shared data
   */
  initWorkers() {
    if (this.initialized) return;
    
    const initData = {
      textureAtlasData: this.textureAtlasData,
      blockTypes: this.blockTypes
    };
    
    for (let i = 0; i < this.workers.length; i++) {
      this.workers[i].postMessage({
        type: 'init',
        data: initData
      });
    }
    
    this.initialized = true;
  }
  
  /**
   * Generate chunk mesh using a worker
   */
  generateChunkMesh(chunkKey, chunksBlocks) {
    return new Promise((resolve, reject) => {
      // Store callback for this chunk
      this.callbacks.set(chunkKey, {
        resolve: (data) => {
          // Create THREE.js BufferGeometry from worker data
          const geometry = this.createGeometryFromWorkerData(data);
          resolve(geometry);
        },
        reject
      });
      
      // Add to processing queue
      this.pendingChunks.push({
        chunkKey,
        chunksBlocks
      });
      
      // Process queue
      this.processQueue();
    });
  }
  
  /**
   * Process pending chunks queue
   */
  processQueue() {
    if (this.pendingChunks.length === 0) return;
    
    // Find available worker
    const workerIndex = this.getAvailableWorker();
    if (workerIndex === -1) return; // No available workers
    
    // Get next chunk
    const { chunkKey, chunksBlocks } = this.pendingChunks.shift();
    
    // Mark worker as busy
    this.busy[workerIndex] = true;
    
    // Send data to worker
    this.workers[workerIndex].postMessage({
      type: 'generateMesh',
      data: {
        chunkKey,
        chunksBlocks
      }
    });
  }
  
  /**
   * Get index of an available worker
   */
  getAvailableWorker() {
    for (let i = 0; i < this.busy.length; i++) {
      if (!this.busy[i]) return i;
    }
    return -1; // No workers available
  }
  
  /**
   * Handle worker message
   */
  handleWorkerMessage(workerIndex, event) {
    const { type, chunkKey, result, error } = event.data;
    
    // Mark worker as available
    this.busy[workerIndex] = false;
    
    switch (type) {
      case 'initialized':
        console.log(`Worker ${workerIndex} initialized`);
        break;
        
      case 'meshGenerated':
        // Find and call the callback for this chunk
        if (this.callbacks.has(chunkKey)) {
          const callbacks = this.callbacks.get(chunkKey);
          callbacks.resolve(result);
          this.callbacks.delete(chunkKey);
        }
        break;
        
      case 'error':
        console.error(`Worker ${workerIndex} error:`, error);
        if (chunkKey && this.callbacks.has(chunkKey)) {
          const callbacks = this.callbacks.get(chunkKey);
          callbacks.reject(new Error(`Worker error: ${error}`));
          this.callbacks.delete(chunkKey);
        }
        break;
    }
    
    // Process next chunk
    this.processQueue();
  }
  
  /**
   * Handle worker error
   */
  handleWorkerError(workerIndex, error) {
    console.error(`Worker ${workerIndex} encountered an error:`, error);
    
    // Mark worker as available so other tasks can be processed
    this.busy[workerIndex] = false;
    
    // Process next chunk
    this.processQueue();
  }
  
  /**
   * Create THREE.js geometry from worker result data
   */
  createGeometryFromWorkerData(data) {
    const { positions, normals, uvs, indices } = data;
    
    const geometry = new THREE.BufferGeometry();
    
    // Add attributes
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    
    // Add indices
    geometry.setIndex(indices);
    
    // Compute bounding sphere for frustum culling
    geometry.computeBoundingSphere();
    
    return geometry;
  }
  
  /**
   * Create a mesh from generated geometry
   */
  createMeshFromGeometry(geometry) {
    // Create material using the same texture atlas
    const material = new THREE.MeshStandardMaterial({
      map: this.atlasTexture,
      side: THREE.FrontSide,
      transparent: false,
      alphaTest: 0.5
    });
    
    // Create and return the mesh
    return new THREE.Mesh(geometry, material);
  }
  
  /**
   * Terminate all workers
   */
  dispose() {
    for (const worker of this.workers) {
      worker.terminate();
    }
    
    this.workers = [];
    this.busy = [];
    this.pendingChunks = [];
    this.callbacks.clear();
    this.initialized = false;
    
    console.log('Chunk worker pool terminated');
  }
} 