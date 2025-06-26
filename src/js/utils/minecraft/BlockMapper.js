
import { blockTypes, getBlockTypes } from "../../TerrainBuilder";

function findBlockIdByName(pattern) {

    const currentBlockTypes = getBlockTypes();
    if (!currentBlockTypes || !currentBlockTypes.length) {

        return getFallbackBlockId(pattern);
    }

    const patternLower = pattern.toLowerCase();

    const exactMatch = currentBlockTypes.find(
        (block) => block.name.toLowerCase() === patternLower
    );
    if (exactMatch) {
        return exactMatch.id;
    }

    const includesMatch = currentBlockTypes.find((block) =>
        block.name.toLowerCase().includes(patternLower)
    );
    if (includesMatch) {
        return includesMatch.id;
    }

    return getFallbackBlockId(pattern);
}

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

    default: { action: "skip" },
};

export function suggestMapping(minecraftBlockName) {

    if (DEFAULT_BLOCK_MAPPINGS[minecraftBlockName]) {
        return DEFAULT_BLOCK_MAPPINGS[minecraftBlockName];
    }

    const blockName = minecraftBlockName.toLowerCase();

    const matchingBlock = findMatchingBlock(blockName);
    if (matchingBlock) {
        return {
            id: matchingBlock.id,
            name: matchingBlock.name,
            action: "map",
        };
    }



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

    return { action: "skip" };
}

function findMatchingBlock(blockNamePattern) {

    const currentBlockTypes = getBlockTypes();
    if (!currentBlockTypes || !currentBlockTypes.length) {
        return null;
    }

    const nameWithoutPrefix = blockNamePattern.replace("minecraft:", "");

    let match = currentBlockTypes.find(
        (block) => block.name.toLowerCase() === nameWithoutPrefix.toLowerCase()
    );
    if (match) {
        return match;
    }

    match = currentBlockTypes.find((block) => {
        const normalizedBlockName = block.name.toLowerCase();
        return (
            normalizedBlockName.includes(nameWithoutPrefix) ||
            nameWithoutPrefix.includes(normalizedBlockName)
        );
    });
    return match || null;
}

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

export function getHytopiaBlocks() {
    try {

        if (blockTypes && blockTypes.length > 0) {



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

    return DEFAULT_HYTOPIA_BLOCKS;
}

export function generateUniqueBlockId(existingBlockTypes) {
    const existingIds = existingBlockTypes.map((block) => block.id);
    return Math.max(0, ...existingIds) + 1;
}

export function getHytopiaBlockById(id) {

    const blocks = getHytopiaBlocks();
    return blocks.find((block) => block.id === id);
}
