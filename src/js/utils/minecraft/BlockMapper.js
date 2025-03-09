// Default mapping from Minecraft to HYTOPIA blocks
import { blockTypes } from '../../TerrainBuilder';

// First, let's create a function to find a block ID by name pattern
function findBlockIdByName(pattern) {
  if (!blockTypes || !blockTypes.length) {
    // Use fallbacks if editor blocks aren't available
    return getFallbackBlockId(pattern);
  }

  // Convert pattern to lowercase for case-insensitive matching
  const patternLower = pattern.toLowerCase();
  
  // First try exact match
  const exactMatch = blockTypes.find(block => 
    block.name.toLowerCase() === patternLower
  );
  
  if (exactMatch) {
    return exactMatch.id;
  }
  
  // Then try includes match
  const includesMatch = blockTypes.find(block => 
    block.name.toLowerCase().includes(patternLower)
  );
  
  if (includesMatch) {
    return includesMatch.id;
  }
  
  // If no match, fall back to default mapping
  return getFallbackBlockId(pattern);
}

// Fallback block IDs if we can't find a match in the editor blocks
function getFallbackBlockId(pattern) {
  const fallbacks = {
    'grass': 7,
    'dirt': 4,
    'ore': 3,
    'diamond': 3,
    'stone': 1,
    'brick': 1,
    'clay': 2,
    'water': 6,
    'dragon': 5,
    'default': 1
  };
  
  for (const [key, id] of Object.entries(fallbacks)) {
    if (pattern.toLowerCase().includes(key)) {
      return id;
    }
  }
  
  return fallbacks.default;
}

// Define key block ID constants based on available blocks
const BLOCK_IDS = {
  BRICKS: findBlockIdByName('bricks'),
  DIRT: findBlockIdByName('dirt'),
  GRASS: findBlockIdByName('grass'),
  DRAGON_STONE: findBlockIdByName('dragon'),
  DIAMOND_ORE: findBlockIdByName('diamond-ore'),
  CLAY: findBlockIdByName('clay'),
  WATER: findBlockIdByName('water'),
  STONE: findBlockIdByName('stone'),
  COBBLESTONE: findBlockIdByName('cobblestone'),
  OAK_PLANKS: findBlockIdByName('oak-planks'),
  SAND: findBlockIdByName('sand')
};

export const DEFAULT_BLOCK_MAPPINGS = {
  // Stone and variants
  'minecraft:stone': { id: BLOCK_IDS.STONE || 1, name: 'Stone', action: 'map' },
  'minecraft:granite': { id: BLOCK_IDS.STONE || 1, name: 'Stone', action: 'map' },
  'minecraft:polished_granite': { id: BLOCK_IDS.STONE || 1, name: 'Stone', action: 'map' },
  'minecraft:diorite': { id: BLOCK_IDS.STONE || 1, name: 'Stone', action: 'map' },
  'minecraft:polished_diorite': { id: BLOCK_IDS.STONE || 1, name: 'Stone', action: 'map' },
  'minecraft:andesite': { id: BLOCK_IDS.STONE || 1, name: 'Stone', action: 'map' },
  'minecraft:polished_andesite': { id: BLOCK_IDS.STONE || 1, name: 'Stone', action: 'map' },
  'minecraft:cobblestone': { id: BLOCK_IDS.COBBLESTONE || 1, name: 'Cobblestone', action: 'map' },
  'minecraft:bedrock': { id: BLOCK_IDS.DRAGON_STONE || 5, name: 'Dragons Stone', action: 'map' },
  
  // Dirt and variants
  'minecraft:dirt': { id: BLOCK_IDS.DIRT || 4, name: 'Dirt', action: 'map' },
  'minecraft:grass_block': { id: BLOCK_IDS.GRASS || 7, name: 'Grass', action: 'map' },
  'minecraft:podzol': { id: BLOCK_IDS.DIRT || 4, name: 'Dirt', action: 'map' },
  'minecraft:mycelium': { id: BLOCK_IDS.DIRT || 4, name: 'Dirt', action: 'map' },
  'minecraft:farmland': { id: BLOCK_IDS.DIRT || 4, name: 'Dirt', action: 'map' },
  'minecraft:mud': { id: BLOCK_IDS.DIRT || 4, name: 'Dirt', action: 'map' },
  'minecraft:mud_bricks': { id: BLOCK_IDS.BRICKS || 1, name: 'Bricks', action: 'map' },
  'minecraft:coarse_dirt': { id: BLOCK_IDS.DIRT || 4, name: 'Dirt', action: 'map' },
  'minecraft:rooted_dirt': { id: BLOCK_IDS.DIRT || 4, name: 'Dirt', action: 'map' },
  
  // Sand and variants
  'minecraft:sand': { id: BLOCK_IDS.SAND || 4, name: 'Sand', action: 'map' },
  'minecraft:red_sand': { id: BLOCK_IDS.SAND || 4, name: 'Sand', action: 'map' },
  'minecraft:gravel': { id: findBlockIdByName('gravel') || 4, name: 'Gravel', action: 'map' },
  
  // Wood and variants
  'minecraft:oak_log': { id: findBlockIdByName('log') || 1, name: 'Log', action: 'map' },
  'minecraft:spruce_log': { id: findBlockIdByName('log') || 1, name: 'Log', action: 'map' },
  'minecraft:birch_log': { id: findBlockIdByName('log') || 1, name: 'Log', action: 'map' },
  'minecraft:jungle_log': { id: findBlockIdByName('log') || 1, name: 'Log', action: 'map' },
  'minecraft:acacia_log': { id: findBlockIdByName('log') || 1, name: 'Log', action: 'map' },
  'minecraft:dark_oak_log': { id: findBlockIdByName('log') || 1, name: 'Log', action: 'map' },
  'minecraft:mangrove_log': { id: findBlockIdByName('log') || 1, name: 'Log', action: 'map' },
  'minecraft:cherry_log': { id: findBlockIdByName('log') || 1, name: 'Log', action: 'map' },
  
  // Planks
  'minecraft:oak_planks': { id: BLOCK_IDS.OAK_PLANKS || 1, name: 'Oak Planks', action: 'map' },
  'minecraft:spruce_planks': { id: BLOCK_IDS.OAK_PLANKS || 1, name: 'Oak Planks', action: 'map' },
  'minecraft:birch_planks': { id: BLOCK_IDS.OAK_PLANKS || 1, name: 'Oak Planks', action: 'map' },
  'minecraft:jungle_planks': { id: BLOCK_IDS.OAK_PLANKS || 1, name: 'Oak Planks', action: 'map' },
  'minecraft:acacia_planks': { id: BLOCK_IDS.OAK_PLANKS || 1, name: 'Oak Planks', action: 'map' },
  'minecraft:dark_oak_planks': { id: BLOCK_IDS.OAK_PLANKS || 1, name: 'Oak Planks', action: 'map' },
  'minecraft:mangrove_planks': { id: BLOCK_IDS.OAK_PLANKS || 1, name: 'Oak Planks', action: 'map' },
  'minecraft:cherry_planks': { id: BLOCK_IDS.OAK_PLANKS || 1, name: 'Oak Planks', action: 'map' },
  
  // Leaves
  'minecraft:oak_leaves': { id: findBlockIdByName('oak-leaves') || BLOCK_IDS.GRASS || 7, name: 'Leaves', action: 'map' },
  'minecraft:spruce_leaves': { id: findBlockIdByName('oak-leaves') || BLOCK_IDS.GRASS || 7, name: 'Leaves', action: 'map' },
  'minecraft:birch_leaves': { id: findBlockIdByName('oak-leaves') || BLOCK_IDS.GRASS || 7, name: 'Leaves', action: 'map' },
  'minecraft:jungle_leaves': { id: findBlockIdByName('oak-leaves') || BLOCK_IDS.GRASS || 7, name: 'Leaves', action: 'map' },
  'minecraft:acacia_leaves': { id: findBlockIdByName('oak-leaves') || BLOCK_IDS.GRASS || 7, name: 'Leaves', action: 'map' },
  'minecraft:dark_oak_leaves': { id: findBlockIdByName('oak-leaves') || BLOCK_IDS.GRASS || 7, name: 'Leaves', action: 'map' },
  'minecraft:mangrove_leaves': { id: findBlockIdByName('oak-leaves') || BLOCK_IDS.GRASS || 7, name: 'Leaves', action: 'map' },
  'minecraft:cherry_leaves': { id: findBlockIdByName('oak-leaves') || BLOCK_IDS.GRASS || 7, name: 'Leaves', action: 'map' },
  
  // Ores and mineral blocks
  'minecraft:coal_ore': { id: findBlockIdByName('coal-ore') || BLOCK_IDS.DIAMOND_ORE || 3, name: 'Coal Ore', action: 'map' },
  'minecraft:iron_ore': { id: findBlockIdByName('iron-ore') || BLOCK_IDS.DIAMOND_ORE || 3, name: 'Iron Ore', action: 'map' },
  'minecraft:copper_ore': { id: findBlockIdByName('iron-ore') || BLOCK_IDS.DIAMOND_ORE || 3, name: 'Copper Ore', action: 'map' },
  'minecraft:gold_ore': { id: findBlockIdByName('gold-ore') || BLOCK_IDS.DIAMOND_ORE || 3, name: 'Gold Ore', action: 'map' },
  'minecraft:redstone_ore': { id: findBlockIdByName('iron-ore') || BLOCK_IDS.DIAMOND_ORE || 3, name: 'Redstone Ore', action: 'map' },
  'minecraft:emerald_ore': { id: findBlockIdByName('emerald-ore') || BLOCK_IDS.DIAMOND_ORE || 3, name: 'Emerald Ore', action: 'map' },
  'minecraft:lapis_ore': { id: findBlockIdByName('diamond-ore') || BLOCK_IDS.DIAMOND_ORE || 3, name: 'Lapis Ore', action: 'map' },
  'minecraft:diamond_ore': { id: BLOCK_IDS.DIAMOND_ORE || 3, name: 'Diamond Ore', action: 'map' },
  
  // Building blocks
  'minecraft:bricks': { id: BLOCK_IDS.BRICKS || 1, name: 'Bricks', action: 'map' },
  'minecraft:bookshelf': { id: BLOCK_IDS.OAK_PLANKS || 1, name: 'Oak Planks', action: 'map' },
  'minecraft:mossy_cobblestone': { id: findBlockIdByName('mossy-coblestone') || BLOCK_IDS.COBBLESTONE || 1, name: 'Mossy Cobblestone', action: 'map' },
  'minecraft:obsidian': { id: BLOCK_IDS.DRAGON_STONE || 5, name: 'Dragons Stone', action: 'map' },
  'minecraft:clay': { id: BLOCK_IDS.CLAY || 2, name: 'Clay', action: 'map' },
  'minecraft:netherrack': { id: findBlockIdByName('nether') || BLOCK_IDS.DRAGON_STONE || 5, name: 'Dragons Stone', action: 'map' },
  'minecraft:soul_sand': { id: BLOCK_IDS.SAND || 4, name: 'Sand', action: 'map' },
  'minecraft:glowstone': { id: BLOCK_IDS.DRAGON_STONE || 5, name: 'Dragons Stone', action: 'map' },
  'minecraft:stone_bricks': { id: findBlockIdByName('stone-bricks') || BLOCK_IDS.BRICKS || 1, name: 'Stone Bricks', action: 'map' },
  
  // Fluids
  'minecraft:water': { id: BLOCK_IDS.WATER || 6, name: 'Water', action: 'map', isLiquid: true },
  'minecraft:lava': { id: findBlockIdByName('lava') || BLOCK_IDS.WATER || 6, name: 'Lava', action: 'map', isLiquid: true },
  
  // Default action for unmapped blocks
  'default': { action: 'skip' }
};

// Suggested mappings for Minecraft blocks to HYTOPIA
export function suggestMapping(minecraftBlockName) {
  // First check for direct mappings in DEFAULT_BLOCK_MAPPINGS
  if (DEFAULT_BLOCK_MAPPINGS[minecraftBlockName]) {
    return DEFAULT_BLOCK_MAPPINGS[minecraftBlockName];
  }
  
  // If no direct mapping, try to determine based on block name
  const blockName = minecraftBlockName.toLowerCase();
  
  // Try to find a match in the blockTypes array first
  const matchingBlock = findMatchingBlock(blockName);
  if (matchingBlock) {
    return {
      id: matchingBlock.id,
      name: matchingBlock.name,
      action: 'map'
    };
  }
  
  // If no match found in blockTypes, use pattern matching
  
  // Map grass-related blocks to grass
  if (blockName.includes('grass') || blockName.includes('fern') || blockName.includes('vine') || 
      blockName.includes('leaves') || blockName.includes('foliage')) {
    return { id: BLOCK_IDS.GRASS || 7, name: 'Grass', action: 'map' };
  }
  
  // Map dirt-related blocks to dirt
  if (blockName.includes('dirt') || blockName.includes('soil') || blockName.includes('mud')) {
    return { id: BLOCK_IDS.DIRT || 4, name: 'Dirt', action: 'map' };
  }
  
  // Map sand-related blocks
  if (blockName.includes('sand') || blockName.includes('gravel')) {
    return { id: BLOCK_IDS.SAND || 4, name: 'Sand', action: 'map' };
  }
  
  // Map ore-related blocks to diamond ore
  if (blockName.includes('ore') || blockName.includes('mineral')) {
    return { id: BLOCK_IDS.DIAMOND_ORE || 3, name: 'Diamond Ore', action: 'map' };
  }
  
  // Map brick/stone-related blocks to stone
  if (blockName.includes('brick') || blockName.includes('stone') || blockName.includes('rock') || 
      blockName.includes('cobble') || blockName.includes('smooth') || blockName.includes('polish')) {
    return { id: BLOCK_IDS.STONE || 1, name: 'Stone', action: 'map' };
  }
  
  // Map wood-related blocks
  if (blockName.includes('log') || blockName.includes('wood')) {
    return { id: findBlockIdByName('log') || BLOCK_IDS.OAK_PLANKS || 1, name: 'Log', action: 'map' };
  }
  
  // Map planks-related blocks
  if (blockName.includes('plank')) {
    return { id: BLOCK_IDS.OAK_PLANKS || 1, name: 'Oak Planks', action: 'map' };
  }
  
  // Map special blocks to dragons stone
  if (blockName.includes('obsidian') || blockName.includes('end') || blockName.includes('nether') || 
      blockName.includes('ancient') || blockName.includes('deepslate') || blockName.includes('bedrock')) {
    return { id: BLOCK_IDS.DRAGON_STONE || 5, name: 'Dragons Stone', action: 'map' };
  }
  
  // Map clay-related blocks
  if (blockName.includes('clay') || blockName.includes('terracotta')) {
    return { id: BLOCK_IDS.CLAY || 2, name: 'Clay', action: 'map' };
  }
  
  // Map water-related blocks
  if (blockName.includes('water') || blockName.includes('ice') || blockName.includes('liquid') || 
      blockName.includes('aqua')) {
    return { id: BLOCK_IDS.WATER || 6, name: 'Water', action: 'map', isLiquid: true };
  }
  
  // Default fallback
  return DEFAULT_BLOCK_MAPPINGS.default;
}

// Helper function to find matching block in blockTypes array
function findMatchingBlock(blockNamePattern) {
  if (!blockTypes || !blockTypes.length) {
    return null;
  }
  
  // First try exact match without minecraft: prefix
  const nameWithoutPrefix = blockNamePattern.replace('minecraft:', '');
  
  // Try direct match
  let match = blockTypes.find(block => 
    block.name.toLowerCase() === nameWithoutPrefix.toLowerCase() ||
    block.name.toLowerCase().replace('-', '_') === nameWithoutPrefix.toLowerCase()
  );
  
  if (match) {
    return match;
  }
  
  // Try contains match
  match = blockTypes.find(block => {
    const normalizedBlockName = block.name.toLowerCase().replace(/-/g, '_');
    return normalizedBlockName.includes(nameWithoutPrefix.toLowerCase()) ||
           nameWithoutPrefix.toLowerCase().includes(normalizedBlockName);
  });
  
  return match || null;
}

// Default HYTOPIA block types
export const DEFAULT_HYTOPIA_BLOCKS = [
  { id: 1, name: 'Bricks', textureUri: 'blocks/bricks.png' },
  { id: 2, name: 'Bouncy Clay', textureUri: 'blocks/clay.png', customColliderOptions: { bounciness: 4 } },
  { id: 3, name: 'Diamond Ore', textureUri: 'blocks/diamond-ore.png' },
  { id: 4, name: 'Dirt', textureUri: 'blocks/dirt.png' },
  { id: 5, name: 'Dragons Stone', textureUri: 'blocks/dragons-stone.png' },
  { id: 6, name: 'Water', textureUri: 'blocks/water.png', isLiquid: true },
  { id: 7, name: 'Grass', textureUri: 'blocks/grass' }
];

// Get all available HYTOPIA blocks
export function getHytopiaBlocks() {
  try {
    // Use the editor's block types if available (for better variety)
    if (blockTypes && blockTypes.length > 0) {
      // Log block types for debugging
      console.log("Available editor blocks:", blockTypes.map(b => `${b.name} (ID: ${b.id})`));
      
      // Format them to match the expected structure
      return blockTypes.map(block => ({
        id: block.id,
        name: block.name.charAt(0).toUpperCase() + block.name.slice(1).replace(/-/g, ' '),
        textureUri: block.textureUri
      }));
    }
  } catch (error) {
    console.warn("Could not load editor block types:", error);
  }
  
  // Fall back to default block types if editor blocks aren't available
  return DEFAULT_HYTOPIA_BLOCKS;
}

// Generate a unique ID for a new block type
export function generateUniqueBlockId(existingBlockTypes) {
  const existingIds = existingBlockTypes.map(block => block.id);
  return Math.max(0, ...existingIds) + 1;
}

// Find a HYTOPIA block by ID
export function getHytopiaBlockById(id) {
  // Use the same source as getHytopiaBlocks
  const blocks = getHytopiaBlocks();
  return blocks.find(block => block.id === id);
} 