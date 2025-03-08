import * as THREE from 'three';

// Texture Atlas Manager for block textures
export class TextureAtlas {
  constructor() {
    this.atlas = null;           // The THREE.Texture for the atlas
    this.atlasSize = 2048;       // Size of atlas texture (power of 2)
    this.blockSize = 64;         // Size of individual block texture
    this.padding = 1;            // Padding between textures
    this.gridSize = Math.floor(this.atlasSize / (this.blockSize + this.padding * 2)); // Number of textures per row/column
    this.blockUVs = new Map();   // Maps blockId to UV coordinates
    this.textureLoadPromises = []; // Array of promises for loading textures
    this.atlasCanvas = document.createElement('canvas');
    this.atlasCanvas.width = this.atlasSize;
    this.atlasCanvas.height = this.atlasSize;
    this.atlasContext = this.atlasCanvas.getContext('2d');
    this.usedSlots = new Set();  // Track used slots
  }

  // Initialize the texture atlas with block types
  async initialize(blockTypes) {
    console.log('Initializing texture atlas with', blockTypes.length, 'block types');
    this.atlasContext.fillStyle = 'rgba(255, 0, 255, 0.5)'; // Default color (magenta semi-transparent)
    this.atlasContext.fillRect(0, 0, this.atlasSize, this.atlasSize);
    
    // Load all textures in parallel
    for (const blockType of blockTypes) {
      if (blockType.isMultiTexture) {
        // For multi-texture blocks, load each side texture
        const sides = ['px', 'nx', 'py', 'ny', 'pz', 'nz']; // +x, -x, +y, -y, +z, -z
        for (const side of sides) {
          const textureUri = blockType.sideTextures[side] || blockType.textureUri;
          this.addTextureToLoad(blockType.id, textureUri, side);
        }
      } else {
        // For single texture blocks, use the same texture for all sides
        this.addTextureToLoad(blockType.id, blockType.textureUri);
      }
    }
    
    // Wait for all textures to load
    await Promise.all(this.textureLoadPromises);
    
    // Create the THREE texture from the canvas
    this.atlas = new THREE.CanvasTexture(this.atlasCanvas);
    this.atlas.wrapS = THREE.ClampToEdgeWrapping;
    this.atlas.wrapT = THREE.ClampToEdgeWrapping;
    this.atlas.magFilter = THREE.NearestFilter;
    this.atlas.minFilter = THREE.NearestMipmapNearestFilter;
    this.atlas.generateMipmaps = true;
    console.log('Texture atlas creation complete');
    
    return this.atlas;
  }
  
  // Add a texture to be loaded
  addTextureToLoad(blockId, textureUri, side = null) {
    const promise = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        const slotId = this.getNextAvailableSlot();
        if (slotId === -1) {
          console.error('Texture atlas full - cannot add more textures');
          reject(new Error('Texture atlas full'));
          return;
        }
        
        const x = (slotId % this.gridSize) * (this.blockSize + this.padding * 2) + this.padding;
        const y = Math.floor(slotId / this.gridSize) * (this.blockSize + this.padding * 2) + this.padding;
        
        // Draw the texture to the canvas
        this.atlasContext.drawImage(img, x, y, this.blockSize, this.blockSize);
        
        // Calculate UV coordinates (0-1 range)
        const uvLeft = x / this.atlasSize;
        const uvTop = y / this.atlasSize;
        const uvRight = (x + this.blockSize) / this.atlasSize;
        const uvBottom = (y + this.blockSize) / this.atlasSize;
        
        // Store UV coordinates for this block/side
        const key = side ? `${blockId}_${side}` : `${blockId}`;
        this.blockUVs.set(key, {
          left: uvLeft,
          top: uvTop,
          right: uvRight,
          bottom: uvBottom
        });
        
        resolve();
      };
      
      img.onerror = () => {
        console.error(`Failed to load texture: ${textureUri}`);
        reject(new Error(`Failed to load texture: ${textureUri}`));
      };
      
      // Set image source - handle data URIs and regular URLs
      if (textureUri.startsWith('data:')) {
        img.src = textureUri;
      } else {
        img.src = `${process.env.PUBLIC_URL}/${textureUri.replace(/^\.\//, '')}`;
      }
    });
    
    this.textureLoadPromises.push(promise);
  }
  
  // Get the next available slot in the atlas
  getNextAvailableSlot() {
    const maxSlots = this.gridSize * this.gridSize;
    for (let i = 0; i < maxSlots; i++) {
      if (!this.usedSlots.has(i)) {
        this.usedSlots.add(i);
        return i;
      }
    }
    return -1; // Atlas is full
  }
  
  // Get UV coordinates for a specific block
  getUVsForBlock(blockId, side = null) {
    const key = side ? `${blockId}_${side}` : `${blockId}`;
    return this.blockUVs.get(key) || this.blockUVs.get(`${blockId}`);
  }
  
  // Get the THREE.Texture atlas
  getAtlasTexture() {
    return this.atlas;
  }
}

// Create batch-friendly chunk mesh builder
export class ChunkMeshBuilder {
  constructor(textureAtlas) {
    this.textureAtlas = textureAtlas;
    this.maxBlocksPerBatch = 10000; // Maximum number of blocks per batch
  }
  
  // Build optimized mesh for a chunk
  buildChunkMesh(chunksBlocks, blockTypes) {
    const blockTypeMap = new Map();
    blockTypes.forEach(blockType => {
      blockTypeMap.set(blockType.id, blockType);
    });
    
    // Prepare geometry
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    let vertexCount = 0;
    
    // Process blocks in chunks
    const blockPositions = Object.keys(chunksBlocks);
    
    for (const posKey of blockPositions) {
      const blockData = chunksBlocks[posKey];
      const [x, y, z] = posKey.split(',').map(Number);
      const blockType = blockTypeMap.get(blockData.id);
      
      if (!blockType) continue;
      
      // Add block faces that are visible
      this.addBlockFaces(x, y, z, blockType, chunksBlocks, positions, normals, uvs, indices, vertexCount);
      vertexCount += 24; // 6 faces * 4 vertices per face
    }
    
    // Create geometry from buffers
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    
    // Create mesh
    const material = new THREE.MeshStandardMaterial({
      map: this.textureAtlas.getAtlasTexture(),
      side: THREE.FrontSide,
      transparent: false,
      alphaTest: 0.5
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    return mesh;
  }
  
  // Add block faces (only for visible faces)
  addBlockFaces(x, y, z, blockType, chunksBlocks, positions, normals, uvs, indices, vertexOffset) {
    // Face definitions (direction, vertices, UVs, normal)
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
        normal: [0, -1, 0]
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
        const neighborBlock = chunksBlocks[neighborKey];
        // Check if neighbor is opaque - for now just assume all blocks are opaque
        // You could add transparency check here if needed
        continue;
      }
      
      // Get UVs for this block face
      const blockUVs = this.textureAtlas.getUVsForBlock(blockType.id, face.side);
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
      const baseVertex = vertexOffset;
      indices.push(
        baseVertex, baseVertex + 1, baseVertex + 2,
        baseVertex, baseVertex + 2, baseVertex + 3
      );
      
      vertexOffset += 4;
    }
  }
}

// Helper for chunk loading queue management
export class ChunkLoadManager {
  constructor(onChunkLoaded) {
    this.loadQueue = [];
    this.processingChunks = new Set();
    this.maxConcurrentLoads = 4;
    this.onChunkLoaded = onChunkLoaded;
    this.isProcessing = false;
  }
  
  // Add a chunk to the load queue
  addChunkToQueue(chunkKey, priority = 0) {
    // Skip if already processing or queued
    if (this.processingChunks.has(chunkKey)) return;
    
    // Check if already in queue, remove if so
    const existingIndex = this.loadQueue.findIndex(item => item.chunkKey === chunkKey);
    if (existingIndex >= 0) {
      this.loadQueue.splice(existingIndex, 1);
    }
    
    // Add to queue with priority
    this.loadQueue.push({ chunkKey, priority });
    
    // Sort queue by priority (higher priority first)
    this.loadQueue.sort((a, b) => b.priority - a.priority);
    
    // Start processing if not already
    if (!this.isProcessing) {
      this.processQueue();
    }
  }
  
  // Process the queue
  async processQueue() {
    if (this.loadQueue.length === 0 || this.processingChunks.size >= this.maxConcurrentLoads) {
      this.isProcessing = false;
      return;
    }
    
    this.isProcessing = true;
    
    // Process up to maxConcurrentLoads chunks
    while (this.loadQueue.length > 0 && this.processingChunks.size < this.maxConcurrentLoads) {
      const { chunkKey } = this.loadQueue.shift();
      this.processingChunks.add(chunkKey);
      
      // Process chunk (don't await here to allow parallel processing)
      this.processChunk(chunkKey).then(() => {
        this.processingChunks.delete(chunkKey);
        this.processQueue(); // Process next chunk when done
      });
    }
  }
  
  // Process a single chunk
  async processChunk(chunkKey) {
    try {
      await this.onChunkLoaded(chunkKey);
    } catch (error) {
      console.error(`Error processing chunk ${chunkKey}:`, error);
    }
  }
  
  // Clear the queue
  clearQueue() {
    this.loadQueue = [];
    this.processingChunks.clear();
    this.isProcessing = false;
  }
} 