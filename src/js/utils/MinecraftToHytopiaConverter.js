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
        blockType = {
          id: generateUniqueBlockId(hytopiaMap.blockTypes),
          name: mapping.name || this.formatBlockName(mcBlockType),
          textureUri: mapping.customTexture || 'blocks/unknown.png'
        };
      }
      
      if (blockType) {
        hytopiaMap.blockTypes.push(blockType);
        processedBlockTypes.add(mcBlockType);
      }
    }
    
    // Get total block count for progress tracking
    const totalPotentialBlocks = this.calculateTotalPotentialBlocks();
    let processedCount = 0;
    
    // Create a block ID mapping for easy lookup
    const blockTypeIdMap = {};
    for (const [mcBlockType, mapping] of Object.entries(this.blockMappings)) {
      if (mapping.action === 'skip') continue;
      
      const matchingBlockType = hytopiaMap.blockTypes.find(bt => 
        (mapping.action === 'map' && bt.id === parseInt(mapping.targetBlockId, 10)) ||
        (mapping.action === 'custom' && bt.name === (mapping.name || this.formatBlockName(mcBlockType)))
      );
      
      if (matchingBlockType) {
        blockTypeIdMap[mcBlockType] = matchingBlockType.id;
      }
    }
    
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
    
    // Calculate the world bounds after centering and applying additional offsets
    const worldBounds = {
      minX: -Math.floor(regionWidth / 2) + additionalOffsetX,
      maxX: regionWidth - Math.floor(regionWidth / 2) - 1 + additionalOffsetX,
      minY: 0, // Bottom at y=0
      maxY: regionHeight - 1,
      minZ: -Math.floor(regionDepth / 2) + additionalOffsetZ,
      maxZ: regionDepth - Math.floor(regionDepth / 2) - 1 + additionalOffsetZ
    };
    
    console.log(`Centering map: Original region center (${offsetX}, ${offsetY + regionHeight/2}, ${offsetZ})`);
    console.log(`Additional XZ offsets: (${additionalOffsetX}, ${additionalOffsetZ})`);
    console.log(`After centering, map will extend from (${worldBounds.minX}, ${worldBounds.minY}, ${worldBounds.minZ}) to (${worldBounds.maxX}, ${worldBounds.maxY}, ${worldBounds.maxZ})`);
    
    console.log(`Processing ${this.worldData.chunks.length} blocks from Minecraft world`);
    
    // Convert blocks within the selected region - FIXED to work with AnvilParser's array format
    for (const blockData of this.worldData.chunks) {
      const { x, y, z, type: mcBlockType } = blockData;
      
      // Calculate final position after centering and offsets
      const finalX = x - offsetX + additionalOffsetX;
      const finalY = y - offsetY; // Bottom of map is now at y=0
      const finalZ = z - offsetZ + additionalOffsetZ;
      
      // Check if block is within the selected region and respects size limits
      if (this.isInFinalRegion(finalX, finalY, finalZ, regionWidth, regionHeight, regionDepth)) {
        const mapping = this.blockMappings[mcBlockType];
        
        if (mapping && mapping.action !== 'skip' && blockTypeIdMap[mcBlockType]) {
          // Add block to HYTOPIA map using its final position
          hytopiaMap.blocks[`${finalX},${finalY},${finalZ}`] = blockTypeIdMap[mcBlockType];
          processedBlocks++;
        } else {
          skippedBlocks++;
        }
      }
      
      // Update progress for all blocks in original region
      if (this.isInRegion(x, y, z)) {
        processedCount++;
        if (this.progressCallback && processedCount % 10000 === 0) {
          const progress = Math.floor((processedCount / totalPotentialBlocks) * 100);
          this.progressCallback(progress);
        }
      }
    }
    
    console.log(`Conversion complete: Processed ${processedBlocks} blocks, skipped ${skippedBlocks} blocks`);
    
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
          originalCenter: { x: offsetX, y: offsetY + Math.floor(regionHeight / 2), z: offsetZ },
          worldBounds
        }
      };
    }
    
    // Ensure progress is complete
    if (this.progressCallback) {
      this.progressCallback(100);
    }
    
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
} 