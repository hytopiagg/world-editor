import { NBTParser } from './NBTParser';
import pako from 'pako';

export class AnvilParser {
  constructor() {
    this.minX = Infinity;
    this.minY = Infinity;
    this.minZ = Infinity;
    this.maxX = -Infinity;
    this.maxY = -Infinity;
    this.maxZ = -Infinity;
    this.chunks = {};
    this.blockTypes = new Set();
  }

  parseRegionFile(buffer, regionX, regionZ) {
    try {
      console.log(`Parsing region file (${regionX}, ${regionZ}), buffer size: ${buffer.byteLength} bytes`);
      
      if (!buffer || buffer.byteLength < 8192) {
        console.warn(`Region file is too small (${buffer.byteLength} bytes)`);
        return;
      }
      
      const view = new DataView(buffer);
      let chunksProcessed = 0;
      let chunksSuccessful = 0;
      
      // Each region file contains 32×32 chunks
      for (let localZ = 0; localZ < 32; localZ++) {
        for (let localX = 0; localX < 32; localX++) {
          const index = localX + localZ * 32;
          const locationOffset = index * 4;
          
          if (locationOffset + 4 > buffer.byteLength) {
            console.warn(`Location offset out of bounds: ${locationOffset}`);
            continue;
          }
          
          // Read chunk location data
          const offset = view.getUint32(locationOffset) >>> 8;
          const sectorCount = view.getUint8(locationOffset + 3);
          
          if (offset === 0 || sectorCount === 0) {
            // Chunk doesn't exist
            continue;
          }
          
          try {
            chunksProcessed++;
            const chunkData = this.readChunkData(buffer, offset * 4096);
            if (chunkData) {
              const chunkX = regionX * 32 + localX;
              const chunkZ = regionZ * 32 + localZ;
              this.processChunk(chunkData, chunkX, chunkZ);
              chunksSuccessful++;
            }
          } catch (e) {
            console.warn(`Error processing chunk at (${localX}, ${localZ}):`, e);
          }
        }
      }
      
      console.log(`Region (${regionX}, ${regionZ}): Processed ${chunksProcessed} chunks, successful: ${chunksSuccessful}`);
    } catch (e) {
      console.error(`Failed to parse region file (${regionX}, ${regionZ}):`, e);
    }
  }

  readChunkData(buffer, offset) {
    try {
      const view = new DataView(buffer);
      
      // Safety check to ensure we don't read beyond the buffer
      if (offset + 5 >= buffer.byteLength) {
        console.warn('Invalid chunk offset or data length');
        return null;
      }
      
      // Read chunk header
      const length = view.getUint32(offset, false);
      
      // Validate length to prevent issues
      if (length <= 0 || offset + 5 + length > buffer.byteLength) {
        console.warn('Invalid chunk length:', length, 'buffer size:', buffer.byteLength);
        return null;
      }
      
      const compressionType = view.getUint8(offset + 4);
      
      // Extract compressed data
      const compressedData = buffer.slice(offset + 5, offset + 5 + length - 1);
      
      // Parse NBT data - might fail but we'll catch the error
      try {
        const nbtData = NBTParser.parse(compressedData);
        return nbtData;
      } catch (e) {
        console.warn('Failed to parse NBT data:', e);
        return null;
      }
    } catch (e) {
      console.warn('Error processing chunk data:', e);
      return null;
    }
  }

  processChunk(chunkData, chunkX, chunkZ) {
    try {
      console.log('Processing chunk data:', chunkX, chunkZ);
      
      // Debug: Log the structure of received chunk data
      if (!chunkData) {
        console.warn('Empty chunk data received');
        return;
      }
      
      this.debugChunkStructure(chunkData);
      
      // Handle Minecraft 1.13+ format (used in 1.21.x)
      if (chunkData.sections && Array.isArray(chunkData.sections)) {
        console.log('Found modern chunk format (sections array)');
        this.processModernChunk(chunkData, chunkX, chunkZ);
        return;
      }
      
      // Handle traditional format (with Level property)
      if (chunkData.Level) {
        console.log('Found traditional chunk format (with Level)');
        if (chunkData.Level.Sections && Array.isArray(chunkData.Level.Sections)) {
          for (const section of chunkData.Level.Sections) {
            const y = section.Y;
            if (y === undefined || y === null) continue;
            
            if (section.BlockStates && section.Palette) {
              // Modern format inside Level
              this.processModernSection(section, chunkX, chunkZ, y);
            } else if (section.Blocks) {
              // Legacy format
              this.processLegacySection(section, chunkX, chunkZ, y);
            }
          }
        }
      }
    } catch (e) {
      console.error('Error processing chunk:', e);
    }
  }
  
  // Helper method to debug chunk structure
  debugChunkStructure(chunkData, prefix = '', maxDepth = 3, currentDepth = 0) {
    if (currentDepth > maxDepth) return;
    
    if (!chunkData || typeof chunkData !== 'object') {
      console.log(`${prefix}Value: ${chunkData}`);
      return;
    }
    
    // Special handling for arrays
    if (Array.isArray(chunkData)) {
      console.log(`${prefix}Array with ${chunkData.length} items`);
      
      // Print first few items for arrays
      if (chunkData.length > 0 && currentDepth < maxDepth) {
        const sampleSize = Math.min(3, chunkData.length);
        for (let i = 0; i < sampleSize; i++) {
          console.log(`${prefix}  [${i}]:`);
          this.debugChunkStructure(chunkData[i], `${prefix}    `, maxDepth, currentDepth + 1);
        }
        if (chunkData.length > sampleSize) {
          console.log(`${prefix}  ... (${chunkData.length - sampleSize} more items)`);
        }
      }
      return;
    }
    
    // Handle objects
    const keys = Object.keys(chunkData);
    console.log(`${prefix}Object with ${keys.length} keys: ${keys.join(', ')}`);
    
    if (currentDepth < maxDepth) {
      for (const key of keys) {
        console.log(`${prefix}  ${key}:`);
        this.debugChunkStructure(chunkData[key], `${prefix}    `, maxDepth, currentDepth + 1);
      }
    }
  }
  
  // Process modern chunk format (1.13+)
  processModernChunk(chunkData, chunkX, chunkZ) {
    try {
      // Process sections
      if (chunkData.sections && Array.isArray(chunkData.sections)) {
        for (const section of chunkData.sections) {
          // Skip empty sections
          if (!section.block_states) continue;
          
          const y = section.Y !== undefined ? section.Y : 
                   section.y !== undefined ? section.y : null;
                   
          if (y === null) {
            console.warn('Section has no Y coordinate');
            continue;
          }
          
          console.log(`Processing section at Y=${y}`);
          
          // Check for block states and palette
          if (section.block_states && section.block_states.palette) {
            this.processModern121Section(section, chunkX, chunkZ, y);
          }
        }
      }
    } catch (e) {
      console.error('Error processing modern chunk:', e);
    }
  }
  
  // Process section in 1.21.x format
  processModern121Section(section, chunkX, chunkZ, sectionY) {
    try {
      const palette = section.block_states.palette;
      const blockStates = section.block_states.data;
      
      if (!palette || !blockStates) {
        console.warn('Missing palette or block states data');
        return;
      }
      
      console.log(`Section palette contains ${palette.length} block types:`, palette);
      console.log(`Block states data:`, blockStates);
      
      // Calculate bits per block
      const bitsPerBlock = Math.max(4, Math.ceil(Math.log2(palette.length)));
      const blocksPerLong = Math.floor(64 / bitsPerBlock);
      
      /* eslint-disable no-undef */
      const mask = (1n << BigInt(bitsPerBlock)) - 1n;
      /* eslint-enable no-undef */
      
      console.log(`Using bitsPerBlock=${bitsPerBlock}, blocksPerLong=${blocksPerLong}`);
      
      let blockCount = 0;
      
      // Process all blocks in the section
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            const blockIndex = y * 256 + z * 16 + x;
            const longIndex = Math.floor(blockIndex / blocksPerLong);
            
            if (!blockStates || longIndex >= blockStates.length) continue;
            
            // Extract the block state index from the packed data
            const bitPosition = (blockIndex % blocksPerLong) * bitsPerBlock;
            
            /* eslint-disable no-undef */
            const value = BigInt(blockStates[longIndex]);
            const stateIndex = Number((value >> BigInt(bitPosition)) & mask);
            /* eslint-enable no-undef */
            
            if (stateIndex >= palette.length) continue;
            
            // Get block name from palette
            const blockState = palette[stateIndex];
            
            // Handle block state format in 1.21
            let blockName;
            if (typeof blockState === 'string') {
              blockName = blockState;
            } else if (blockState.Name) {
              blockName = blockState.Name;
            } else {
              continue; // Skip if no name
            }
            
            // Skip air blocks
            if (blockName === 'minecraft:air' || blockName === 'air') continue;
            
            // Convert to global coordinates
            const globalX = chunkX * 16 + x;
            const globalY = sectionY * 16 + y;
            const globalZ = chunkZ * 16 + z;
            
            // Store block data
            this.addBlock(globalX, globalY, globalZ, blockName);
            blockCount++;
          }
        }
      }
      
      console.log(`Found ${blockCount} non-air blocks in section at Y=${sectionY}`);
    } catch (e) {
      console.error('Error processing modern section:', e);
    }
  }
  
  // Updated processModernSection for compatibility
  processModernSection(section, chunkX, chunkZ, sectionY) {
    try {
      const palette = section.Palette;
      const blockStates = section.BlockStates;
      
      if (!palette || !blockStates) {
        console.warn('Missing Palette or BlockStates');
        return;
      }
      
      console.log(`Section Palette contains ${palette.length} block types`);
      
      // Calculate bits per block
      const bitsPerBlock = Math.max(4, Math.ceil(Math.log2(palette.length)));
      const blocksPerLong = Math.floor(64 / bitsPerBlock);
      
      /* eslint-disable no-undef */
      const mask = (1n << BigInt(bitsPerBlock)) - 1n;
      /* eslint-enable no-undef */
      
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            const blockIndex = y * 256 + z * 16 + x;
            const longIndex = Math.floor(blockIndex / blocksPerLong);
            
            if (longIndex >= blockStates.length) continue;
            
            // Extract the block state index from the packed data
            const bitPosition = (blockIndex % blocksPerLong) * bitsPerBlock;
            
            /* eslint-disable no-undef */
            const value = BigInt(blockStates[longIndex]);
            const stateIndex = Number((value >> BigInt(bitPosition)) & mask);
            /* eslint-enable no-undef */
            
            if (stateIndex >= palette.length) continue;
            
            const blockState = palette[stateIndex];
            const blockName = blockState.Name;
            
            if (blockName === 'minecraft:air') continue;
            
            // Convert to global coordinates
            const globalX = chunkX * 16 + x;
            const globalY = sectionY * 16 + y;
            const globalZ = chunkZ * 16 + z;
            
            // Store block data
            this.addBlock(globalX, globalY, globalZ, blockName);
          }
        }
      }
    } catch (e) {
      console.error('Error processing modern section:', e);
    }
  }

  processLegacySection(section, chunkX, chunkZ, sectionY) {
    const blocks = section.Blocks;
    const data = section.Data;
    const blockLight = section.BlockLight;
    const skyLight = section.SkyLight;
    
    if (!blocks) return;
    
    for (let y = 0; y < 16; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const index = y * 256 + z * 16 + x;
          const blockId = blocks[index] & 0xFF;
          
          if (blockId === 0) continue; // Skip air blocks
          
          // Convert local coordinates to global coordinates
          const globalX = chunkX * 16 + x;
          const globalY = sectionY * 16 + y;
          const globalZ = chunkZ * 16 + z;
          
          // Use legacy block ID mapping
          const blockName = this.getLegacyBlockName(blockId, data ? (data[index >> 1] >> ((index & 1) * 4)) & 0xF : 0);
          
          // Store block data and update bounds
          this.addBlock(globalX, globalY, globalZ, blockName);
        }
      }
    }
  }

  addBlock(x, y, z, blockName) {
    // Update world boundaries
    this.minX = Math.min(this.minX, x);
    this.minY = Math.min(this.minY, y);
    this.minZ = Math.min(this.minZ, z);
    this.maxX = Math.max(this.maxX, x);
    this.maxY = Math.max(this.maxY, y);
    this.maxZ = Math.max(this.maxZ, z);
    
    // Add block to storage
    const posKey = `${x},${y},${z}`;
    this.chunks[posKey] = {
      type: blockName,
      x, y, z
    };
    
    // Track unique block types
    this.blockTypes.add(blockName);
  }

  getLegacyBlockName(id, data) {
    // This is a simplified mapping. A complete version would have all block IDs
    const legacyBlocks = {
      1: 'minecraft:stone',
      2: 'minecraft:grass_block',
      3: 'minecraft:dirt',
      4: 'minecraft:cobblestone',
      5: 'minecraft:oak_planks', // Different types based on data value
      7: 'minecraft:bedrock',
      8: 'minecraft:water',
      9: 'minecraft:water',
      10: 'minecraft:lava',
      11: 'minecraft:lava',
      12: 'minecraft:sand',
      13: 'minecraft:gravel',
      14: 'minecraft:gold_ore',
      15: 'minecraft:iron_ore',
      16: 'minecraft:coal_ore',
      17: 'minecraft:oak_log', // Different types based on data value
      18: 'minecraft:oak_leaves', // Different types based on data value
      // Add more mappings as needed
    };
    
    return legacyBlocks[id] || `minecraft:unknown_${id}_${data}`;
  }

  getWorldData() {
    return {
      blockTypes: Array.from(this.blockTypes),
      chunks: this.chunks,
      bounds: {
        minX: this.minX,
        minY: this.minY,
        minZ: this.minZ,
        maxX: this.maxX,
        maxY: this.maxY,
        maxZ: this.maxZ
      }
    };
  }
} 