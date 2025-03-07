import { getHytopiaBlockById, generateUniqueBlockId } from './minecraft/BlockMapper';

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
    
    // Calculate region dimensions
    const regionWidth = this.selectedRegion.maxX - this.selectedRegion.minX;
    const regionHeight = this.selectedRegion.maxY - this.selectedRegion.minY;
    const regionDepth = this.selectedRegion.maxZ - this.selectedRegion.minZ;
    
    // For X and Z, center around 0,0
    const centerOffsetX = Math.floor(this.selectedRegion.minX + regionWidth / 2);
    const centerOffsetZ = Math.floor(this.selectedRegion.minZ + regionDepth / 2);
    
    // For Y, ensure bottom is at Y=0 if minY is negative
    const yOffset = this.selectedRegion.minY < 0 ? this.selectedRegion.minY : 0;
    
    console.log(`Centering region horizontally with offset X:${centerOffsetX}, Z:${centerOffsetZ}`);
    console.log(`Adjusting Y position with offset: ${yOffset} to ensure bottom is at Y=0`);
    
    // Convert blocks within the selected region
    for (const [posKey, blockData] of Object.entries(this.worldData.chunks)) {
      const [x, y, z] = posKey.split(',').map(Number);
      
      // Check if block is within the selected region
      if (this.isInRegion(x, y, z)) {
        const mcBlockType = blockData.type;
        const mapping = this.blockMappings[mcBlockType];
        
        if (mapping && mapping.action !== 'skip' && blockTypeIdMap[mcBlockType]) {
          // Calculate centered position horizontally (X, Z) and adjust Y position
          const centeredX = x - centerOffsetX;
          const adjustedY = y - yOffset;  // If minY is negative, this brings bottom to Y=0
          const centeredZ = z - centerOffsetZ;
          
          // Add block to HYTOPIA map
          hytopiaMap.blocks[`${centeredX},${adjustedY},${centeredZ}`] = blockTypeIdMap[mcBlockType];
          processedBlocks++;
        } else {
          skippedBlocks++;
        }
        
        // Update progress
        processedCount++;
        if (this.progressCallback && processedCount % 1000 === 0) {
          const progress = Math.floor((processedCount / totalPotentialBlocks) * 100);
          this.progressCallback(progress);
        }
      }
    }
    
    // If no blocks were processed, use a placeholder
    if (processedBlocks === 0) {
      hytopiaMap.blocks['0,0,0'] = hytopiaMap.blockTypes[0]?.id || 1;
      processedBlocks = 1;
    }
    
    // Ensure progress is complete
    if (this.progressCallback) {
      this.progressCallback(100);
    }
    
    return {
      hytopiaMap,
      stats: {
        processedBlocks,
        skippedBlocks,
        uniqueBlockTypes: Array.from(processedBlockTypes)
      }
    };
  }
  
  isInRegion(x, y, z) {
    return x >= this.selectedRegion.minX && x <= this.selectedRegion.maxX &&
           y >= this.selectedRegion.minY && y <= this.selectedRegion.maxY &&
           z >= this.selectedRegion.minZ && z <= this.selectedRegion.maxZ;
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