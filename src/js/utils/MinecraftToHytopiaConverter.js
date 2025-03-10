import { getHytopiaBlockById, generateUniqueBlockId } from './minecraft/BlockMapper';
import { 
  MAX_IMPORT_SIZE_X, 
  MAX_IMPORT_SIZE_Y, 
  MAX_IMPORT_SIZE_Z
} from '../Constants';

export class MinecraftToHytopiaConverter {
  constructor(worldData, selectedRegion, blockMappings) {
    this.worldData = worldData;
    this.selectedRegion = selectedRegion;
    this.blockMappings = blockMappings;
    this.progressCallback = null;
  }
  
  setProgressCallback(callback) {
    this.progressCallback = callback;
  }
  
  async convert() {
    // Compute final region sizing and centering
    const {
      offsetX, offsetY, offsetZ,
      regionWidth, regionHeight, regionDepth,
      additionalOffsetX, additionalOffsetZ
    } = this.calculateRegionParameters();
    
    // Calculate world bounds
    const worldBounds = {
      minX: -Math.floor(regionWidth / 2) + additionalOffsetX,
      maxX: regionWidth - Math.floor(regionWidth / 2) - 1 + additionalOffsetX,
      minY: 0,
      maxY: regionHeight - 1,
      minZ: -Math.floor(regionDepth / 2) + additionalOffsetZ,
      maxZ: regionDepth - Math.floor(regionDepth / 2) - 1 + additionalOffsetZ
    };
    
    console.log(`Centering map: Original region center (${offsetX}, ${offsetY + regionHeight/2}, ${offsetZ})`);
    console.log(`Additional XZ offsets: (${additionalOffsetX}, ${additionalOffsetZ})`);
    console.log(`After centering, map will extend from (${worldBounds.minX}, ${worldBounds.minY}, ${worldBounds.minZ}) to (${worldBounds.maxX}, ${worldBounds.maxY}, ${worldBounds.maxZ})`);
    
    // Choose the block source based on available data (supporting both old and new formats)
    const blockSource = this.getBlockSource();
    const blockCount = this.getBlockCount(blockSource);
    
    console.log(`Processing ${blockCount} blocks from Minecraft world`);
    
    // Final map for editor (x,y,z -> blockId)
    const editorMap = {};
    
    // Process blocks using the appropriate format
    let processedBlocks = 0;
    const totalBlocks = this.calculateTotalPotentialBlocks();
    
    // Process blocks using the appropriate format
    if (Array.isArray(blockSource)) {
      // Process the array format (chunks)
      for (const blockData of blockSource) {
        const { x, y, z, type: mcBlockType } = blockData;
        
        // Calculate final position after centering and offsets
        const finalX = x - offsetX + additionalOffsetX;
        const finalY = y - offsetY; // Bottom of map is now at y=0
        const finalZ = z - offsetZ + additionalOffsetZ;
        
        // Check if block is within the selected region and respects size limits
        if (this.isInFinalRegion(finalX, finalY, finalZ, regionWidth, regionHeight, regionDepth)) {
          // Process this block - same as original
          this.processBlock(editorMap, mcBlockType, finalX, finalY, finalZ);
        }
        
        // Update progress
        processedBlocks++;
        if (processedBlocks % 10000 === 0 && this.progressCallback) {
          this.progressCallback((processedBlocks / blockSource.length) * 100);
        }
      }
    } else {
      // Process the object format (blocks)
      let processedKeys = 0;
      const totalKeys = Object.keys(blockSource).length;
      
      for (const key in blockSource) {
        if (key.startsWith('section:')) {
          // Handle section blocks
          const [prefix, x, y, z, width, height, depth] = key.split(':')[1].split(',');
          const blockData = blockSource[key];
          const startX = parseInt(x);
          const startY = parseInt(y);
          const startZ = parseInt(z);
          const blockWidth = parseInt(width);
          const blockHeight = parseInt(height);
          const blockDepth = parseInt(depth);
          
          // Check if any part of this section is within our region
          // Calculate section bounds after transformation
          const sectionMinX = startX - offsetX + additionalOffsetX;
          const sectionMinY = startY - offsetY;
          const sectionMinZ = startZ - offsetZ + additionalOffsetZ;
          const sectionMaxX = sectionMinX + blockWidth - 1;
          const sectionMaxY = sectionMinY + blockHeight - 1;
          const sectionMaxZ = sectionMinZ + blockDepth - 1;
          
          // If section intersects with our region, process it
          if (this.sectionsIntersect(
            sectionMinX, sectionMinY, sectionMinZ, sectionMaxX, sectionMaxY, sectionMaxZ,
            worldBounds.minX, worldBounds.minY, worldBounds.minZ, 
            worldBounds.maxX, worldBounds.maxY, worldBounds.maxZ
          )) {
            // Process blocks in this section that fall within our region
            for (let dx = 0; dx < blockWidth; dx++) {
              const finalX = sectionMinX + dx;
              if (finalX < worldBounds.minX || finalX > worldBounds.maxX) continue;
              
              for (let dy = 0; dy < blockHeight; dy++) {
                const finalY = sectionMinY + dy;
                if (finalY < worldBounds.minY || finalY > worldBounds.maxY) continue;
                
                for (let dz = 0; dz < blockDepth; dz++) {
                  const finalZ = sectionMinZ + dz;
                  if (finalZ < worldBounds.minZ || finalZ > worldBounds.maxZ) continue;
                  
                  // Process this block
                  this.processBlock(editorMap, blockData.type, finalX, finalY, finalZ);
                  processedBlocks++;
                }
              }
            }
          }
        } else {
          // Handle individual blocks
          const [x, y, z] = key.split(',').map(Number);
          const blockData = blockSource[key];
          
          // Calculate final position after centering and offsets
          const finalX = x - offsetX + additionalOffsetX;
          const finalY = y - offsetY; // Bottom of map is now at y=0
          const finalZ = z - offsetZ + additionalOffsetZ;
          
          // Check if block is within the selected region and respects size limits
          if (this.isInFinalRegion(finalX, finalY, finalZ, regionWidth, regionHeight, regionDepth)) {
            // Process this block
            this.processBlock(editorMap, blockData.type, finalX, finalY, finalZ);
            processedBlocks++;
          }
        }
        
        // Update progress
        processedKeys++;
        if (processedKeys % 1000 === 0 && this.progressCallback) {
          this.progressCallback((processedKeys / totalKeys) * 100);
        }
      }
    }
    
    // Now convert to the editor's expected format
    return this.createEditorData(editorMap, worldBounds);
  }
  
  // Helper methods for the enhanced functionality
  
  getBlockSource() {
    // Use chunks array if available (backwards compatibility)
    if (this.worldData.chunks && Array.isArray(this.worldData.chunks) && this.worldData.chunks.length > 0) {
      return this.worldData.chunks;
    }
    
    // Otherwise use the new blocks object format
    if (this.worldData.blocks && typeof this.worldData.blocks === 'object') {
      return this.worldData.blocks;
    }
    
    // Fallback to empty array if neither is available
    console.warn('No valid block data found in world data');
    return [];
  }
  
  getBlockCount(blockSource) {
    if (Array.isArray(blockSource)) {
      return blockSource.length;
    }
    
    // For object format, count the total blocks including sections
    let count = 0;
    for (const key in blockSource) {
      if (key.startsWith('section:')) {
        const [prefix, x, y, z, width, height, depth] = key.split(':')[1].split(',');
        count += parseInt(width) * parseInt(height) * parseInt(depth);
      } else {
        count++;
      }
    }
    return count;
  }
  
  // Check if two 3D sections intersect
  sectionsIntersect(minX1, minY1, minZ1, maxX1, maxY1, maxZ1, minX2, minY2, minZ2, maxX2, maxY2, maxZ2) {
    return !(
      maxX1 < minX2 || minX1 > maxX2 ||
      maxY1 < minY2 || minY1 > maxY2 ||
      maxZ1 < minZ2 || minZ1 > maxZ2
    );
  }
  
  // Process a single block
  processBlock(editorMap, mcBlockType, finalX, finalY, finalZ) {
    // Map Minecraft block to editor block
    const editorBlockId = this.getBlockMapping(mcBlockType);
    if (editorBlockId !== null) {
      // Add to editor map
      if (!editorMap[finalY]) editorMap[finalY] = {};
      if (!editorMap[finalY][finalZ]) editorMap[finalY][finalZ] = {};
      editorMap[finalY][finalZ][finalX] = editorBlockId;
    }
  }
  
  isInFinalRegion(finalX, finalY, finalZ, regionWidth, regionHeight, regionDepth) {
    // Check if within bounds of maximum import size
    return finalX >= -Math.floor(regionWidth / 2) && 
           finalX <= regionWidth - Math.floor(regionWidth / 2) - 1 &&
           finalY >= 0 && 
           finalY <= regionHeight - 1 &&
           finalZ >= -Math.floor(regionDepth / 2) && 
           finalZ <= regionDepth - Math.floor(regionDepth / 2) - 1;
  }
  
  isInRegion(x, y, z) {
    // First check if the point is within the selected region
    const isInSelectedRegion = 
      x >= this.selectedRegion.minX && x <= this.selectedRegion.maxX &&
      y >= this.selectedRegion.minY && y <= this.selectedRegion.maxY &&
      z >= this.selectedRegion.minZ && z <= this.selectedRegion.maxZ;
    
    if (!isInSelectedRegion) return false;
    
    // Now ensure we don't exceed the maximum size limits
    // Check X dimension limit
    if (x - this.selectedRegion.minX >= MAX_IMPORT_SIZE_X) return false;
    
    // Check Y dimension limit
    if (y - this.selectedRegion.minY >= MAX_IMPORT_SIZE_Y) return false;
    
    // Check Z dimension limit
    if (z - this.selectedRegion.minZ >= MAX_IMPORT_SIZE_Z) return false;
    
    return true;
  }
  
  calculateTotalPotentialBlocks() {
    if (!this.selectedRegion) return 0;
    
    const width = this.selectedRegion.maxX - this.selectedRegion.minX + 1;
    const height = this.selectedRegion.maxY - this.selectedRegion.minY + 1;
    const depth = this.selectedRegion.maxZ - this.selectedRegion.minZ + 1;
    
    return width * height * depth;
  }
  
  formatBlockName(mcBlockName) {
    // Convert minecraft:oak_planks to Oak Planks
    return mcBlockName
      .replace('minecraft:', '')
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  
  // Calculate region parameters
  calculateRegionParameters() {
    // Calculate region dimensions (respecting maximum limits)
    const regionWidth = Math.min(this.selectedRegion.maxX - this.selectedRegion.minX + 1, MAX_IMPORT_SIZE_X);
    const regionHeight = Math.min(this.selectedRegion.maxY - this.selectedRegion.minY + 1, MAX_IMPORT_SIZE_Y);
    const regionDepth = Math.min(this.selectedRegion.maxZ - this.selectedRegion.minZ + 1, MAX_IMPORT_SIZE_Z);
    
    // Get additional XZ offsets (if provided)
    const additionalOffsetX = this.selectedRegion.offsetX || 0;
    const additionalOffsetZ = this.selectedRegion.offsetZ || 0;
    
    // Calculate offset for proper XZ centering and Y elevation
    // For X and Z, we want to center the map so center of map is at (0,0) + any additional offset
    // For Y, we want to move the entire map up so the bottom is at y=0
    const offsetX = this.selectedRegion.minX + Math.floor(regionWidth / 2);
    const offsetY = this.selectedRegion.minY; // Shift up to make bottom at y=0
    const offsetZ = this.selectedRegion.minZ + Math.floor(regionDepth / 2);
    
    return {
      offsetX, offsetY, offsetZ,
      regionWidth, regionHeight, regionDepth,
      additionalOffsetX, additionalOffsetZ
    };
  }
  
  // Get block mapping (returns editor block ID or null if skipped)
  getBlockMapping(mcBlockType) {
    const mapping = this.blockMappings[mcBlockType];
    if (!mapping || mapping.action === 'skip') {
      return null;
    }
    
    if (mapping.action === 'map') {
      return parseInt(mapping.targetBlockId, 10);
    } else if (mapping.action === 'custom' && mapping.customTextureId) {
      return mapping.customTextureId;
    }
    
    return null;
  }
  
  // Create the final editor data format
  createEditorData(editorMap, worldBounds) {
    // Initialize result counters
    let processedBlocks = 0;
    let skippedBlocks = 0;
    const processedBlockTypes = new Set();
    
    // Create HYTOPIA map structure
    const hytopiaMap = {
      blockTypes: [],
      blocks: {}
    };
    
    // Process block type mappings
    for (const [mcBlockType, mapping] of Object.entries(this.blockMappings)) {
      if (mapping.action === 'skip') continue;
      
      let blockType;
      if (mapping.action === 'map') {
        // Reference existing HYTOPIA block type
        blockType = getHytopiaBlockById(parseInt(mapping.targetBlockId, 10));
      } else if (mapping.action === 'custom') {
        // Create new block type with custom texture
        // For custom blocks, use the customTextureId if available
        if (mapping.customTextureId) {
          // Use the existing custom block ID
          const customBlockId = mapping.customTextureId;
          blockType = {
            id: customBlockId,
            name: mapping.name || this.formatBlockName(mcBlockType),
            textureUri: mapping.customTexture || 'blocks/unknown.png',
            isCustom: true
          };
          console.log(`Using existing custom block ID ${customBlockId} for ${mcBlockType}`);
        } else {
          // Generate a new ID if customTextureId is not available
          blockType = {
            id: generateUniqueBlockId(hytopiaMap.blockTypes),
            name: mapping.name || this.formatBlockName(mcBlockType),
            textureUri: mapping.customTexture || 'blocks/unknown.png',
            isCustom: true
          };
          console.log(`Generated new ID ${blockType.id} for custom block ${mcBlockType}`);
        }
      }
      
      if (blockType) {
        hytopiaMap.blockTypes.push(blockType);
        processedBlockTypes.add(mcBlockType);
      }
    }
    
    // Convert the editorMap to the expected format
    for (const y in editorMap) {
      for (const z in editorMap[y]) {
        for (const x in editorMap[y][z]) {
          const blockId = editorMap[y][z][x];
          hytopiaMap.blocks[`${x},${y},${z}`] = blockId;
          processedBlocks++;
        }
      }
    }
    
    // If no blocks were processed, return error
    if (processedBlocks === 0) {
      // Ensure progress is complete
      if (this.progressCallback) {
        this.progressCallback(100);
      }
      
      return {
        success: false,
        error: "No blocks were imported. Check your block mappings.",
        stats: {
          processedBlocks: 0,
          skippedBlocks: 0,
          uniqueBlockTypes: [],
          originalCenter: { 
            x: this.selectedRegion.minX + Math.floor((this.selectedRegion.maxX - this.selectedRegion.minX) / 2),
            y: this.selectedRegion.minY + Math.floor((this.selectedRegion.maxY - this.selectedRegion.minY) / 2),
            z: this.selectedRegion.minZ + Math.floor((this.selectedRegion.maxZ - this.selectedRegion.minZ) / 2)
          },
          worldBounds
        }
      };
    }
    
    // Ensure progress is complete
    if (this.progressCallback) {
      this.progressCallback(100);
    }
    
    const { offsetX, offsetY, offsetZ, regionHeight } = this.calculateRegionParameters();
    
    return {
      success: true,
      hytopiaMap,
      stats: {
        processedBlocks,
        skippedBlocks,
        uniqueBlockTypes: Array.from(processedBlockTypes),
        originalCenter: { x: offsetX, y: offsetY + Math.floor(regionHeight / 2), z: offsetZ },
        worldBounds
      }
    };
  }
} 