// Default mapping from Minecraft to HYTOPIA blocks
import { blockTypes, getBlockTypes } from "../../TerrainBuilder";

// First, let's create a function to find a block ID by name pattern
function findBlockIdByName(pattern) {
    // Get the latest block types to ensure we have up-to-date data
    const currentBlockTypes = getBlockTypes();

    if (!currentBlockTypes || !currentBlockTypes.length) {
        // Use fallbacks if editor blocks aren't available
        return getFallbackBlockId(pattern);
    }

    // Convert pattern to lowercase for case-insensitive matching
    const patternLower = pattern.toLowerCase();

    // First try exact match
    const exactMatch = currentBlockTypes.find(
        (block) => block.name.toLowerCase() === patternLower
    );

    if (exactMatch) {
        return exactMatch.id;
    }

    // Then try includes match
    const includesMatch = currentBlockTypes.find((block) =>
        block.name.toLowerCase().includes(patternLower)
    );

    if (includesMatch) {
        return includesMatch.id;
    }

    // If no matches, use fallbacks
    return getFallbackBlockId(pattern);
}

// Fallback block IDs if we can't find a match in the editor blocks
function getFallbackBlockId(pattern) {
    const fallbacks = {
        grass: 7,
        dirt: 4,
        ore: 3,
        diamond: 3,
        stone: 1,
        brick: 1,
        clay: 2,
        water: 6,
        dragon: 5,
        default: 1,
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
    BRICKS: findBlockIdByName("bricks"),
    DIRT: findBlockIdByName("dirt"),
    GRASS: findBlockIdByName("grass"),
    DRAGON_STONE: findBlockIdByName("dragon"),
    DIAMOND_ORE: findBlockIdByName("diamond-ore"),
    CLAY: findBlockIdByName("clay"),
    WATER: findBlockIdByName("water"),
    STONE: findBlockIdByName("stone"),
    COBBLESTONE: findBlockIdByName("cobblestone"),
    OAK_PLANKS: findBlockIdByName("oak-planks"),
    SAND: findBlockIdByName("sand"),
};

export const DEFAULT_BLOCK_MAPPINGS = {
    // Stone and variants
    "minecraft:stone": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:granite": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:polished_granite": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:diorite": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:polished_diorite": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:andesite": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:polished_andesite": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:cobblestone": {
        id: BLOCK_IDS.COBBLESTONE || 1,
        name: "Cobblestone",
        action: "map",
    },
    "minecraft:bedrock": {
        id: BLOCK_IDS.DRAGON_STONE || 5,
        name: "Dragons Stone",
        action: "map",
    },

    // Dirt and variants
    "minecraft:dirt": { id: BLOCK_IDS.DIRT || 4, name: "Dirt", action: "map" },
    "minecraft:grass_block": {
        id: BLOCK_IDS.GRASS || 7,
        name: "Grass",
        action: "map",
    },
    "minecraft:podzol": {
        id: BLOCK_IDS.DIRT || 4,
        name: "Dirt",
        action: "map",
    },
    "minecraft:mycelium": {
        id: BLOCK_IDS.DIRT || 4,
        name: "Dirt",
        action: "map",
    },
    "minecraft:farmland": {
        id: BLOCK_IDS.DIRT || 4,
        name: "Dirt",
        action: "map",
    },
    "minecraft:mud": { id: BLOCK_IDS.DIRT || 4, name: "Dirt", action: "map" },
    "minecraft:mud_bricks": {
        id: BLOCK_IDS.BRICKS || 1,
        name: "Bricks",
        action: "map",
    },
    "minecraft:coarse_dirt": {
        id: BLOCK_IDS.DIRT || 4,
        name: "Dirt",
        action: "map",
    },
    "minecraft:rooted_dirt": {
        id: BLOCK_IDS.DIRT || 4,
        name: "Dirt",
        action: "map",
    },

    // Sand and variants
    "minecraft:sand": { id: BLOCK_IDS.SAND || 4, name: "Sand", action: "map" },
    "minecraft:red_sand": {
        id: BLOCK_IDS.SAND || 4,
        name: "Sand",
        action: "map",
    },
    "minecraft:gravel": {
        id: findBlockIdByName("gravel") || 4,
        name: "Gravel",
        action: "map",
    },

    // Wood and variants
    "minecraft:oak_log": {
        id: findBlockIdByName("log") || 1,
        name: "Log",
        action: "map",
    },
    "minecraft:spruce_log": {
        id: findBlockIdByName("log") || 1,
        name: "Log",
        action: "map",
    },
    "minecraft:birch_log": {
        id: findBlockIdByName("log") || 1,
        name: "Log",
        action: "map",
    },
    "minecraft:jungle_log": {
        id: findBlockIdByName("log") || 1,
        name: "Log",
        action: "map",
    },
    "minecraft:acacia_log": {
        id: findBlockIdByName("log") || 1,
        name: "Log",
        action: "map",
    },
    "minecraft:dark_oak_log": {
        id: findBlockIdByName("log") || 1,
        name: "Log",
        action: "map",
    },
    "minecraft:mangrove_log": {
        id: findBlockIdByName("log") || 1,
        name: "Log",
        action: "map",
    },
    "minecraft:cherry_log": {
        id: findBlockIdByName("log") || 1,
        name: "Log",
        action: "map",
    },

    // Planks
    "minecraft:oak_planks": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:spruce_planks": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:birch_planks": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:jungle_planks": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:acacia_planks": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:dark_oak_planks": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:mangrove_planks": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:cherry_planks": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },

    // Leaves
    "minecraft:oak_leaves": {
        id: findBlockIdByName("oak-leaves") || BLOCK_IDS.GRASS || 7,
        name: "Leaves",
        action: "map",
    },
    "minecraft:spruce_leaves": {
        id: findBlockIdByName("oak-leaves") || BLOCK_IDS.GRASS || 7,
        name: "Leaves",
        action: "map",
    },
    "minecraft:birch_leaves": {
        id: findBlockIdByName("oak-leaves") || BLOCK_IDS.GRASS || 7,
        name: "Leaves",
        action: "map",
    },
    "minecraft:jungle_leaves": {
        id: findBlockIdByName("oak-leaves") || BLOCK_IDS.GRASS || 7,
        name: "Leaves",
        action: "map",
    },
    "minecraft:acacia_leaves": {
        id: findBlockIdByName("oak-leaves") || BLOCK_IDS.GRASS || 7,
        name: "Leaves",
        action: "map",
    },
    "minecraft:dark_oak_leaves": {
        id: findBlockIdByName("oak-leaves") || BLOCK_IDS.GRASS || 7,
        name: "Leaves",
        action: "map",
    },
    "minecraft:mangrove_leaves": {
        id: findBlockIdByName("oak-leaves") || BLOCK_IDS.GRASS || 7,
        name: "Leaves",
        action: "map",
    },
    "minecraft:cherry_leaves": {
        id: findBlockIdByName("oak-leaves") || BLOCK_IDS.GRASS || 7,
        name: "Leaves",
        action: "map",
    },

    // Ores and mineral blocks
    "minecraft:coal_ore": {
        id: findBlockIdByName("coal-ore") || BLOCK_IDS.DIAMOND_ORE || 3,
        name: "Coal Ore",
        action: "map",
    },
    "minecraft:iron_ore": {
        id: findBlockIdByName("iron-ore") || BLOCK_IDS.DIAMOND_ORE || 3,
        name: "Iron Ore",
        action: "map",
    },
    "minecraft:copper_ore": {
        id: findBlockIdByName("iron-ore") || BLOCK_IDS.DIAMOND_ORE || 3,
        name: "Copper Ore",
        action: "map",
    },
    "minecraft:gold_ore": {
        id: findBlockIdByName("gold-ore") || BLOCK_IDS.DIAMOND_ORE || 3,
        name: "Gold Ore",
        action: "map",
    },
    "minecraft:redstone_ore": {
        id: findBlockIdByName("iron-ore") || BLOCK_IDS.DIAMOND_ORE || 3,
        name: "Redstone Ore",
        action: "map",
    },
    "minecraft:emerald_ore": {
        id: findBlockIdByName("emerald-ore") || BLOCK_IDS.DIAMOND_ORE || 3,
        name: "Emerald Ore",
        action: "map",
    },
    "minecraft:lapis_ore": {
        id: findBlockIdByName("diamond-ore") || BLOCK_IDS.DIAMOND_ORE || 3,
        name: "Lapis Ore",
        action: "map",
    },
    "minecraft:diamond_ore": {
        id: BLOCK_IDS.DIAMOND_ORE || 3,
        name: "Diamond Ore",
        action: "map",
    },

    // Building blocks
    "minecraft:bricks": {
        id: BLOCK_IDS.BRICKS || 1,
        name: "Bricks",
        action: "map",
    },
    "minecraft:bookshelf": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:mossy_cobblestone": {
        id: findBlockIdByName("mossy-coblestone") || BLOCK_IDS.COBBLESTONE || 1,
        name: "Mossy Cobblestone",
        action: "map",
    },
    "minecraft:obsidian": {
        id: BLOCK_IDS.DRAGON_STONE || 5,
        name: "Dragons Stone",
        action: "map",
    },
    "minecraft:clay": { id: BLOCK_IDS.CLAY || 2, name: "Clay", action: "map" },
    "minecraft:netherrack": {
        id: findBlockIdByName("nether") || BLOCK_IDS.DRAGON_STONE || 5,
        name: "Dragons Stone",
        action: "map",
    },
    "minecraft:soul_sand": {
        id: BLOCK_IDS.SAND || 4,
        name: "Sand",
        action: "map",
    },
    "minecraft:glowstone": {
        id: BLOCK_IDS.DRAGON_STONE || 5,
        name: "Dragons Stone",
        action: "map",
    },
    "minecraft:stone_bricks": {
        id: findBlockIdByName("stone-bricks") || BLOCK_IDS.BRICKS || 1,
        name: "Stone Bricks",
        action: "map",
    },

    // Fluids
    "minecraft:water": {
        id: BLOCK_IDS.WATER || 6,
        name: "Water",
        action: "map",
        isLiquid: true,
    },
    "minecraft:lava": {
        id: findBlockIdByName("lava") || BLOCK_IDS.WATER || 6,
        name: "Lava",
        action: "map",
        isLiquid: true,
    },

    // Default action for unmapped blocks
    default: { action: "skip" },
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
            action: "map",
        };
    }

    // Only do simple matches for obvious block types
    // This is intentionally limited to very clear matches

    // Exact matches for common materials - be very conservative
    if (blockName === "stone" || blockName === "cobblestone") {
        return { id: BLOCK_IDS.STONE || 1, name: "Stone", action: "map" };
    }

    if (blockName === "dirt") {
        return { id: BLOCK_IDS.DIRT || 4, name: "Dirt", action: "map" };
    }

    if (blockName === "grass_block" || blockName === "grass") {
        return { id: BLOCK_IDS.GRASS || 7, name: "Grass", action: "map" };
    }

    if (blockName === "oak_log" || blockName === "oak_planks") {
        return { id: 2, name: "Wood", action: "map" };
    }

    if (blockName === "water") {
        return { id: BLOCK_IDS.WATER || 6, name: "Water", action: "map" };
    }

    // Default to skip for non-obvious matches - let user decide
    return { action: "skip" };
}

// Helper function to find matching block in blockTypes array
function findMatchingBlock(blockNamePattern) {
    // Get the latest block types
    const currentBlockTypes = getBlockTypes();

    if (!currentBlockTypes || !currentBlockTypes.length) {
        return null;
    }

    // First try exact match without minecraft: prefix
    const nameWithoutPrefix = blockNamePattern.replace("minecraft:", "");

    // Try direct match
    let match = currentBlockTypes.find(
        (block) => block.name.toLowerCase() === nameWithoutPrefix.toLowerCase()
    );

    if (match) {
        return match;
    }

    // Try contains match
    match = currentBlockTypes.find((block) => {
        const normalizedBlockName = block.name.toLowerCase();
        return (
            normalizedBlockName.includes(nameWithoutPrefix) ||
            nameWithoutPrefix.includes(normalizedBlockName)
        );
    });

    return match || null;
}

// Default HYTOPIA block types
export const DEFAULT_HYTOPIA_BLOCKS = [
    { id: 1, name: "Bricks", textureUri: "blocks/bricks.png" },
    {
        id: 2,
        name: "Bouncy Clay",
        textureUri: "blocks/clay.png",
        customColliderOptions: { bounciness: 4 },
    },
    { id: 3, name: "Diamond Ore", textureUri: "blocks/diamond-ore.png" },
    { id: 4, name: "Dirt", textureUri: "blocks/dirt.png" },
    { id: 5, name: "Dragons Stone", textureUri: "blocks/dragons-stone.png" },
    { id: 6, name: "Water", textureUri: "blocks/water.png", isLiquid: true },
    { id: 7, name: "Grass", textureUri: "blocks/grass" },
];

// Get all available HYTOPIA blocks
export function getHytopiaBlocks() {
    try {
        // Use the editor's block types if available (for better variety)
        if (blockTypes && blockTypes.length > 0) {
            // Log block types for debugging
            //console.log("Available editor blocks:", blockTypes.map(b => `${b.name} (ID: ${b.id})`));

            // Format them to match the expected structure
            return blockTypes.map((block) => ({
                id: block.id,
                name:
                    block.name.charAt(0).toUpperCase() +
                    block.name.slice(1).replace(/-/g, " "),
                textureUri: block.textureUri,
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
    const existingIds = existingBlockTypes.map((block) => block.id);
    return Math.max(0, ...existingIds) + 1;
}

// Find a HYTOPIA block by ID
export function getHytopiaBlockById(id) {
    // Use the same source as getHytopiaBlocks
    const blocks = getHytopiaBlocks();
    return blocks.find((block) => block.id === id);
}
