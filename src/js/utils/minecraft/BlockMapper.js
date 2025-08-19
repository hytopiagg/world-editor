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
    // Always ignore structure voids – they denote empty space/placeholders in blueprints
    "minecraft:structure_void": {
        action: "skip",
    },
    // Air blocks should be skipped by default
    "minecraft:air": { action: "skip" },
    "minecraft:cave_air": { action: "skip" },
    "minecraft:void_air": { action: "skip" },
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
        id: findBlockIdByName("gravel") || BLOCK_IDS.DIRT || 4,
        name: "Gravel",
        action: "map",
    },
    // (coarse_dirt defined earlier above)

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
        name: "Oak Leaves",
        action: "map",
    },
    "minecraft:spruce_leaves": {
        id: findBlockIdByName("oak-leaves") || BLOCK_IDS.GRASS || 7,
        name: "Spruce Leaves",
        action: "map",
    },
    "minecraft:birch_leaves": {
        id: findBlockIdByName("oak-leaves") || BLOCK_IDS.GRASS || 7,
        name: "Birch Leaves",
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

    // Fences and decorative blocks
    "minecraft:oak_fence": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Fence",
        action: "map",
    },
    "minecraft:spruce_fence": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Spruce Fence",
        action: "map",
    },
    "minecraft:birch_fence": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Birch Fence",
        action: "map",
    },
    "minecraft:vine": {
        id: BLOCK_IDS.GRASS || 7,
        name: "Vine",
        action: "map",
    },

    // --- Defaults to cover materials used across test-blueprints ---
    // Concretes (solid color) → neutral structural stand-ins
    "minecraft:white_concrete": {
        id: findBlockIdByName("clay") || BLOCK_IDS.STONE || 1,
        name: "White (Clay)",
        action: "map",
    },
    "minecraft:gray_concrete": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:light_gray_concrete": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:yellow_concrete": {
        id: BLOCK_IDS.BRICKS || 1,
        name: "Bricks",
        action: "map",
    },
    "minecraft:green_concrete": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:cyan_concrete": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:black_concrete": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:blue_concrete": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:red_concrete": {
        id: BLOCK_IDS.BRICKS || 1,
        name: "Bricks",
        action: "map",
    },

    // Concrete powder → Gravel (granular look)
    "minecraft:white_concrete_powder": {
        id: findBlockIdByName("gravel") || BLOCK_IDS.DIRT || 4,
        name: "Gravel",
        action: "map",
    },
    "minecraft:gray_concrete_powder": {
        id: findBlockIdByName("gravel") || BLOCK_IDS.DIRT || 4,
        name: "Gravel",
        action: "map",
    },
    "minecraft:light_gray_concrete_powder": {
        id: findBlockIdByName("gravel") || BLOCK_IDS.DIRT || 4,
        name: "Gravel",
        action: "map",
    },
    "minecraft:yellow_concrete_powder": {
        id: findBlockIdByName("gravel") || BLOCK_IDS.DIRT || 4,
        name: "Gravel",
        action: "map",
    },
    "minecraft:cyan_concrete_powder": {
        id: findBlockIdByName("gravel") || BLOCK_IDS.DIRT || 4,
        name: "Gravel",
        action: "map",
    },
    "minecraft:black_concrete_powder": {
        id: findBlockIdByName("gravel") || BLOCK_IDS.DIRT || 4,
        name: "Gravel",
        action: "map",
    },
    "minecraft:red_concrete_powder": {
        id: findBlockIdByName("gravel") || BLOCK_IDS.DIRT || 4,
        name: "Gravel",
        action: "map",
    },
    "minecraft:green_concrete_powder": {
        id: findBlockIdByName("gravel") || BLOCK_IDS.DIRT || 4,
        name: "Gravel",
        action: "map",
    },

    // Terracotta (all colors) → Clay
    "minecraft:white_terracotta": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:light_gray_terracotta": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:gray_terracotta": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:black_terracotta": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:blue_terracotta": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:cyan_terracotta": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:green_terracotta": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:lime_terracotta": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:red_terracotta": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:orange_terracotta": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:yellow_terracotta": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:brown_terracotta": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },

    // Wool & carpets → Clay (flat tint)
    "minecraft:white_wool": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:black_wool": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:gray_wool": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:red_wool": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:yellow_wool": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:orange_wool": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:light_blue_wool": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:green_wool": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },

    "minecraft:white_carpet": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:black_carpet": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:light_gray_carpet": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:red_carpet": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:yellow_carpet": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:orange_carpet": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:light_blue_carpet": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },
    "minecraft:green_carpet": {
        id: BLOCK_IDS.CLAY || 2,
        name: "Clay",
        action: "map",
    },

    // Glass and panes (stained variants) → Glass
    "minecraft:glass": {
        id: findBlockIdByName("glass") || BLOCK_IDS.STONE || 1,
        name: "Glass",
        action: "map",
    },
    "minecraft:glass_pane": {
        id: findBlockIdByName("glass") || BLOCK_IDS.STONE || 1,
        name: "Glass",
        action: "map",
    },
    "minecraft:light_gray_stained_glass": {
        id: findBlockIdByName("glass") || BLOCK_IDS.STONE || 1,
        name: "Glass",
        action: "map",
    },
    "minecraft:gray_stained_glass": {
        id: findBlockIdByName("glass") || BLOCK_IDS.STONE || 1,
        name: "Glass",
        action: "map",
    },
    "minecraft:black_stained_glass": {
        id: findBlockIdByName("glass") || BLOCK_IDS.STONE || 1,
        name: "Glass",
        action: "map",
    },
    "minecraft:green_stained_glass": {
        id: findBlockIdByName("glass") || BLOCK_IDS.STONE || 1,
        name: "Glass",
        action: "map",
    },
    "minecraft:light_gray_stained_glass_pane": {
        id: findBlockIdByName("glass") || BLOCK_IDS.STONE || 1,
        name: "Glass",
        action: "map",
    },
    "minecraft:gray_stained_glass_pane": {
        id: findBlockIdByName("glass") || BLOCK_IDS.STONE || 1,
        name: "Glass",
        action: "map",
    },
    "minecraft:blue_stained_glass_pane": {
        id: findBlockIdByName("glass") || BLOCK_IDS.STONE || 1,
        name: "Glass",
        action: "map",
    },
    "minecraft:green_stained_glass_pane": {
        id: findBlockIdByName("glass") || BLOCK_IDS.STONE || 1,
        name: "Glass",
        action: "map",
    },

    // Quartz family → Stone Bricks stand-in
    "minecraft:quartz_block": {
        id: findBlockIdByName("stone-bricks") || BLOCK_IDS.BRICKS || 1,
        name: "Stone Bricks",
        action: "map",
    },
    "minecraft:chiseled_quartz_block": {
        id: findBlockIdByName("stone-bricks") || BLOCK_IDS.BRICKS || 1,
        name: "Stone Bricks",
        action: "map",
    },
    "minecraft:quartz_pillar": {
        id: findBlockIdByName("stone-bricks") || BLOCK_IDS.BRICKS || 1,
        name: "Stone Bricks",
        action: "map",
    },
    "minecraft:quartz_slab": {
        id: findBlockIdByName("stone-bricks") || BLOCK_IDS.BRICKS || 1,
        name: "Stone Bricks",
        action: "map",
    },
    "minecraft:quartz_stairs": {
        id: findBlockIdByName("stone-bricks") || BLOCK_IDS.BRICKS || 1,
        name: "Stone Bricks",
        action: "map",
    },
    "minecraft:smooth_quartz": {
        id: findBlockIdByName("stone-bricks") || BLOCK_IDS.BRICKS || 1,
        name: "Stone Bricks",
        action: "map",
    },
    "minecraft:smooth_quartz_slab": {
        id: findBlockIdByName("stone-bricks") || BLOCK_IDS.BRICKS || 1,
        name: "Stone Bricks",
        action: "map",
    },
    "minecraft:smooth_quartz_stairs": {
        id: findBlockIdByName("stone-bricks") || BLOCK_IDS.BRICKS || 1,
        name: "Stone Bricks",
        action: "map",
    },

    // Stone/Slab/Brick variants
    "minecraft:smooth_stone": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:smooth_stone_slab": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:stone_slab": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:stone_brick_slab": {
        id: findBlockIdByName("stone-bricks") || BLOCK_IDS.BRICKS || 1,
        name: "Stone Bricks",
        action: "map",
    },
    "minecraft:stone_brick_stairs": {
        id: findBlockIdByName("stone-bricks") || BLOCK_IDS.BRICKS || 1,
        name: "Stone Bricks",
        action: "map",
    },
    "minecraft:chiseled_stone_bricks": {
        id: findBlockIdByName("stone-bricks") || BLOCK_IDS.BRICKS || 1,
        name: "Stone Bricks",
        action: "map",
    },

    // Sandstone family → Sand stand-in
    "minecraft:sandstone": {
        id: BLOCK_IDS.SAND || 4,
        name: "Sand",
        action: "map",
    },
    "minecraft:chiseled_sandstone": {
        id: BLOCK_IDS.SAND || 4,
        name: "Sand",
        action: "map",
    },
    "minecraft:cut_sandstone": {
        id: BLOCK_IDS.SAND || 4,
        name: "Sand",
        action: "map",
    },
    "minecraft:sandstone_slab": {
        id: BLOCK_IDS.SAND || 4,
        name: "Sand",
        action: "map",
    },
    "minecraft:sandstone_stairs": {
        id: BLOCK_IDS.SAND || 4,
        name: "Sand",
        action: "map",
    },
    "minecraft:smooth_sandstone_slab": {
        id: BLOCK_IDS.SAND || 4,
        name: "Sand",
        action: "map",
    },
    "minecraft:suspicious_sand": {
        id: BLOCK_IDS.SAND || 4,
        name: "Sand",
        action: "map",
    },
    "minecraft:sandstone_wall": {
        id: BLOCK_IDS.SAND || 4,
        name: "Sand",
        action: "map",
    },

    // Walls
    "minecraft:cobblestone_wall": {
        id: BLOCK_IDS.COBBLESTONE || 1,
        name: "Cobblestone",
        action: "map",
    },
    "minecraft:stone_brick_wall": {
        id: findBlockIdByName("stone-bricks") || BLOCK_IDS.BRICKS || 1,
        name: "Stone Bricks",
        action: "map",
    },
    "minecraft:brick_wall": {
        id: BLOCK_IDS.BRICKS || 1,
        name: "Bricks",
        action: "map",
    },
    "minecraft:nether_brick_wall": {
        id: BLOCK_IDS.BRICKS || 1,
        name: "Bricks",
        action: "map",
    },
    "minecraft:red_nether_brick_wall": {
        id: BLOCK_IDS.BRICKS || 1,
        name: "Bricks",
        action: "map",
    },
    "minecraft:mossy_cobblestone_wall": {
        id: BLOCK_IDS.COBBLESTONE || 1,
        name: "Cobblestone",
        action: "map",
    },

    // Stairs map to base
    "minecraft:brick_stairs": {
        id: BLOCK_IDS.BRICKS || 1,
        name: "Bricks",
        action: "map",
    },
    "minecraft:birch_stairs": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:jungle_stairs": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:acacia_stairs": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:dark_oak_stairs": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:polished_diorite_stairs": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:diorite_stairs": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:red_nether_brick_stairs": {
        id: BLOCK_IDS.BRICKS || 1,
        name: "Bricks",
        action: "map",
    },
    "minecraft:nether_brick_stairs": {
        id: BLOCK_IDS.BRICKS || 1,
        name: "Bricks",
        action: "map",
    },
    "minecraft:dark_prismarine_stairs": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },

    // Slabs
    "minecraft:cobblestone_slab": {
        id: BLOCK_IDS.COBBLESTONE || 1,
        name: "Cobblestone",
        action: "map",
    },
    "minecraft:oak_slab": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:nether_brick_slab": {
        id: BLOCK_IDS.BRICKS || 1,
        name: "Bricks",
        action: "map",
    },
    "minecraft:acacia_slab": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },

    // Doors/Trapdoors/Signs & related
    "minecraft:oak_door": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:birch_door": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:iron_door": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:oak_trapdoor": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:dark_oak_trapdoor": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:acacia_trapdoor": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:spruce_trapdoor": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:oak_wall_sign": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:birch_wall_sign": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:dark_oak_wall_sign": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:dark_oak_fence_gate": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:acacia_button": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:acacia_pressure_plate": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },

    // Bars/rails/misc
    "minecraft:iron_bars": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:rail": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:ladder": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:stone_button": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:lever": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:tripwire_hook": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },

    // Lighting/Decor
    "minecraft:sea_lantern": {
        id: BLOCK_IDS.DRAGON_STONE || 5,
        name: "Dragons Stone",
        action: "map",
    },
    "minecraft:lantern": {
        id: BLOCK_IDS.DRAGON_STONE || 5,
        name: "Dragons Stone",
        action: "map",
    },
    "minecraft:redstone_torch": {
        id: BLOCK_IDS.DRAGON_STONE || 5,
        name: "Dragons Stone",
        action: "map",
    },
    "minecraft:wall_torch": {
        id: BLOCK_IDS.DRAGON_STONE || 5,
        name: "Dragons Stone",
        action: "map",
    },

    // Solid blocks
    "minecraft:iron_block": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:lapis_block": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:emerald_block": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },

    // Functional blocks
    "minecraft:hopper": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:cartography_table": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:furnace": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:anvil": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:beacon": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:campfire": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },
    "minecraft:chain_command_block": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:jigsaw": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:blast_furnace": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },
    "minecraft:grindstone": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
    },

    // Mushrooms & wood variants
    "minecraft:mushroom_stem": {
        id: findBlockIdByName("log") || 1,
        name: "Log",
        action: "map",
    },
    "minecraft:oak_wood": {
        id: findBlockIdByName("log") || 1,
        name: "Log",
        action: "map",
    },
    "minecraft:stripped_oak_wood": {
        id: findBlockIdByName("log") || 1,
        name: "Log",
        action: "map",
    },

    // Ice variants
    "minecraft:ice": {
        id: findBlockIdByName("ice") || findBlockIdByName("glass") || 1,
        name: "Ice",
        action: "map",
    },
    "minecraft:packed_ice": {
        id: findBlockIdByName("ice") || findBlockIdByName("glass") || 1,
        name: "Ice",
        action: "map",
    },

    // Sponges
    "minecraft:sponge": {
        id: BLOCK_IDS.SAND || 4,
        name: "Sand",
        action: "map",
    },
    "minecraft:wet_sponge": {
        id: BLOCK_IDS.SAND || 4,
        name: "Sand",
        action: "map",
    },

    // Nether bricks/fence
    "minecraft:nether_brick_fence": {
        id: BLOCK_IDS.BRICKS || 1,
        name: "Bricks",
        action: "map",
    },

    // Banners/Skulls and risky blocks → skip by default
    "minecraft:green_wall_banner": { action: "skip" },
    "minecraft:white_wall_banner": { action: "skip" },
    "minecraft:wither_skeleton_skull": { action: "skip" },
    "minecraft:tnt": { action: "skip" },
    "minecraft:chest": {
        id: BLOCK_IDS.OAK_PLANKS || 1,
        name: "Oak Planks",
        action: "map",
    },

    // Additional defaults for test-blueprints materials
    // (oak_wood, mushroom_stem defined earlier above)

    // (ice, packed_ice defined earlier above)

    // (tnt, chest defined earlier above)
    "minecraft:iron_trapdoor": {
        id: BLOCK_IDS.STONE || 1,
        name: "Stone",
        action: "map",
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

    // --- Pattern-based fallbacks to cover blueprint blocks ---
    // Skip decorative entities and flora
    if (
        /banner|skull|head|potted|flower|dandelion|daisy|tulip|orchid|cornflower|azure_bluet|sea_pickle|fern|tall_grass|scaffolding|cobweb/.test(
            blockName
        )
    ) {
        return { action: "skip" };
    }

    // Glass family (including stained and panes)
    if (blockName.includes("glass")) {
        return {
            id: findBlockIdByName("glass") || BLOCK_IDS.STONE || 1,
            name: "Glass",
            action: "map",
        };
    }

    // Concrete powder -> Gravel stand-in
    if (blockName.includes("concrete_powder")) {
        return {
            id: findBlockIdByName("gravel") || BLOCK_IDS.DIRT || 4,
            name: "Gravel",
            action: "map",
        };
    }

    // Solid concretes
    if (blockName.includes("concrete")) {
        const warm = /(red|yellow|orange)_concrete/.test(blockName);
        return {
            id: warm ? BLOCK_IDS.BRICKS || 1 : BLOCK_IDS.STONE || 1,
            name: warm ? "Bricks" : "Stone",
            action: "map",
        };
    }

    // Terracotta family -> Clay
    if (blockName.includes("terracotta")) {
        return { id: BLOCK_IDS.CLAY || 2, name: "Clay", action: "map" };
    }

    // Quartz family -> Stone Bricks
    if (blockName.includes("quartz")) {
        return {
            id: findBlockIdByName("stone-bricks") || BLOCK_IDS.BRICKS || 1,
            name: "Stone Bricks",
            action: "map",
        };
    }

    // Sandstone family -> Sand
    if (blockName.includes("sandstone")) {
        return { id: BLOCK_IDS.SAND || 4, name: "Sand", action: "map" };
    }

    // Stone-like variants (andesite, diorite, granite, cobblestone, deepslate)
    if (/(andesite|diorite|granite|cobblestone|deepslate)/.test(blockName)) {
        return { id: BLOCK_IDS.STONE || 1, name: "Stone", action: "map" };
    }

    // Nether bricks and red nether bricks -> Bricks
    if (blockName.includes("nether_brick")) {
        return { id: BLOCK_IDS.BRICKS || 1, name: "Bricks", action: "map" };
    }

    // Blackstone family -> Stone or Bricks when "brick" appears
    if (blockName.includes("blackstone")) {
        const isBrick = blockName.includes("brick");
        return {
            id: isBrick ? BLOCK_IDS.BRICKS || 1 : BLOCK_IDS.STONE || 1,
            name: isBrick ? "Bricks" : "Stone",
            action: "map",
        };
    }

    // Prismarine family -> Stone Bricks stand-in
    if (blockName.includes("prismarine")) {
        return {
            id: findBlockIdByName("stone-bricks") || BLOCK_IDS.BRICKS || 1,
            name: "Stone Bricks",
            action: "map",
        };
    }

    // Wood family parts (doors, trapdoors, fences, fence gates, signs, buttons, pressure plates, slabs, stairs)
    if (
        /(door|trapdoor|fence_gate|fence|sign|button|pressure_plate|slab|stairs)/.test(
            blockName
        )
    ) {
        // Iron variants to stone
        if (
            blockName.includes("iron_door") ||
            blockName.includes("iron_trapdoor")
        ) {
            return { id: BLOCK_IDS.STONE || 1, name: "Stone", action: "map" };
        }
        // Stone buttons/pressure plates
        if (
            blockName.includes("stone_button") ||
            blockName.includes("stone_pressure_plate")
        ) {
            return { id: BLOCK_IDS.STONE || 1, name: "Stone", action: "map" };
        }
        // Default wooden parts to Oak Planks stand-in
        return {
            id: BLOCK_IDS.OAK_PLANKS || 1,
            name: "Oak Planks",
            action: "map",
        };
    }

    // Functional wood tables -> Oak Planks
    if (
        /(crafting_table|fletching_table|cartography_table|lectern|loom|note_block)/.test(
            blockName
        )
    ) {
        return {
            id: BLOCK_IDS.OAK_PLANKS || 1,
            name: "Oak Planks",
            action: "map",
        };
    }

    // Functional stone or metal -> Stone
    if (
        /anvil|furnace|cauldron|brewing_stand|grindstone|hopper/.test(blockName)
    ) {
        return { id: BLOCK_IDS.STONE || 1, name: "Stone", action: "map" };
    }

    // Lighting -> Dragons Stone stand-in
    if (
        /sea_lantern|lantern|glowstone|redstone_torch|wall_torch|end_rod/.test(
            blockName
        )
    ) {
        return {
            id: BLOCK_IDS.DRAGON_STONE || 5,
            name: "Dragons Stone",
            action: "map",
        };
    }

    // Leaves and logs -> Leaves / Log
    if (blockName.includes("leaves")) {
        return {
            id: findBlockIdByName("oak-leaves") || BLOCK_IDS.GRASS || 7,
            name: "Leaves",
            action: "map",
        };
    }
    if (blockName.includes("log") || blockName.includes("_wood")) {
        return {
            id: findBlockIdByName("log") || 1,
            name: "Log",
            action: "map",
        };
    }

    // Ice family
    if (blockName.includes("ice")) {
        return {
            id: findBlockIdByName("ice") || findBlockIdByName("glass") || 1,
            name: "Ice",
            action: "map",
        };
    }

    // Rails and bars -> Stone stand-in
    if (blockName.includes("rail") || blockName.includes("iron_bars")) {
        return { id: BLOCK_IDS.STONE || 1, name: "Stone", action: "map" };
    }

    // Pressure plates (weighted)
    if (blockName.includes("weighted_pressure_plate")) {
        return { id: BLOCK_IDS.STONE || 1, name: "Stone", action: "map" };
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
