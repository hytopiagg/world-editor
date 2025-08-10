#!/usr/bin/env node

/**
 * Convert Axiom Blueprint to Editor Format
 * Usage: node scripts/convert-axiom-bp-to-editor.js <input.bp> [--debug]
 */

const fs = require("fs");
const path = require("path");
const { parseAxiomBlueprint } = require("./parse-axiom-bp");

// Default block mappings - coarse stand-ins to make blueprints load without remapping
const DEFAULT_BLOCK_MAPPINGS = {
    "minecraft:stone": { id: 1, name: "Stone" },
    "minecraft:dirt": { id: 4, name: "Dirt" },
    "minecraft:grass_block": { id: 7, name: "Grass" },
    "minecraft:cobblestone": { id: 1, name: "Cobblestone" },
    "minecraft:oak_planks": { id: 1, name: "Oak Planks" },
    "minecraft:spruce_planks": { id: 1, name: "Spruce Planks" },
    "minecraft:glass": { id: 1, name: "Glass" },
    "minecraft:stone_brick_stairs": { id: 1, name: "Stone Brick Stairs" },
    "minecraft:spruce_log": { id: 1, name: "Spruce Log" },
    "minecraft:structure_void": { id: 0, skip: true },

    // Additional mappings for leaves and materials
    "minecraft:oak_leaves": { id: 7, name: "Oak Leaves" },
    "minecraft:birch_leaves": { id: 7, name: "Birch Leaves" },
    "minecraft:spruce_leaves": { id: 7, name: "Spruce Leaves" },
    "minecraft:jungle_leaves": { id: 7, name: "Jungle Leaves" },
    "minecraft:vine": { id: 7, name: "Vine" },
    "minecraft:gravel": { id: 4, name: "Gravel" },
    "minecraft:coarse_dirt": { id: 4, name: "Coarse Dirt" },
    "minecraft:spruce_fence": { id: 1, name: "Spruce Fence" },
    "minecraft:oak_fence": { id: 1, name: "Oak Fence" },

    // Concretes (solid colors)
    "minecraft:white_concrete": { id: 1, name: "Stone" },
    "minecraft:gray_concrete": { id: 1, name: "Stone" },
    "minecraft:light_gray_concrete": { id: 1, name: "Stone" },
    "minecraft:yellow_concrete": { id: 1, name: "Stone" },
    "minecraft:green_concrete": { id: 1, name: "Stone" },
    "minecraft:cyan_concrete": { id: 1, name: "Stone" },
    "minecraft:black_concrete": { id: 1, name: "Stone" },
    "minecraft:blue_concrete": { id: 1, name: "Stone" },
    "minecraft:red_concrete": { id: 1, name: "Stone" },

    // Concrete powders → gravel/soil-like
    "minecraft:white_concrete_powder": { id: 4, name: "Gravel" },
    "minecraft:gray_concrete_powder": { id: 4, name: "Gravel" },
    "minecraft:light_gray_concrete_powder": { id: 4, name: "Gravel" },
    "minecraft:yellow_concrete_powder": { id: 4, name: "Gravel" },
    "minecraft:green_concrete_powder": { id: 4, name: "Gravel" },
    "minecraft:cyan_concrete_powder": { id: 4, name: "Gravel" },
    "minecraft:red_concrete_powder": { id: 4, name: "Gravel" },
    "minecraft:black_concrete_powder": { id: 4, name: "Gravel" },

    // Terracotta & carpets/wool → clay stand-in
    "minecraft:white_terracotta": { id: 2, name: "Clay" },
    "minecraft:light_gray_terracotta": { id: 2, name: "Clay" },
    "minecraft:gray_terracotta": { id: 2, name: "Clay" },
    "minecraft:black_terracotta": { id: 2, name: "Clay" },
    "minecraft:blue_terracotta": { id: 2, name: "Clay" },
    "minecraft:cyan_terracotta": { id: 2, name: "Clay" },
    "minecraft:green_terracotta": { id: 2, name: "Clay" },
    "minecraft:lime_terracotta": { id: 2, name: "Clay" },
    "minecraft:red_terracotta": { id: 2, name: "Clay" },
    "minecraft:orange_terracotta": { id: 2, name: "Clay" },
    "minecraft:yellow_terracotta": { id: 2, name: "Clay" },
    "minecraft:brown_terracotta": { id: 2, name: "Clay" },

    "minecraft:white_wool": { id: 2, name: "Clay" },
    "minecraft:black_wool": { id: 2, name: "Clay" },
    "minecraft:gray_wool": { id: 2, name: "Clay" },
    "minecraft:red_wool": { id: 2, name: "Clay" },
    "minecraft:yellow_wool": { id: 2, name: "Clay" },
    "minecraft:orange_wool": { id: 2, name: "Clay" },
    "minecraft:light_blue_wool": { id: 2, name: "Clay" },
    "minecraft:green_wool": { id: 2, name: "Clay" },

    "minecraft:white_carpet": { id: 2, name: "Clay" },
    "minecraft:black_carpet": { id: 2, name: "Clay" },
    "minecraft:light_gray_carpet": { id: 2, name: "Clay" },
    "minecraft:red_carpet": { id: 2, name: "Clay" },
    "minecraft:yellow_carpet": { id: 2, name: "Clay" },
    "minecraft:orange_carpet": { id: 2, name: "Clay" },
    "minecraft:light_blue_carpet": { id: 2, name: "Clay" },
    "minecraft:green_carpet": { id: 2, name: "Clay" },

    // Glass and panes (stained variants) → Glass stand-in
    "minecraft:glass_pane": { id: 1, name: "Glass" },
    "minecraft:light_gray_stained_glass": { id: 1, name: "Glass" },
    "minecraft:gray_stained_glass": { id: 1, name: "Glass" },
    "minecraft:black_stained_glass": { id: 1, name: "Glass" },
    "minecraft:green_stained_glass": { id: 1, name: "Glass" },
    "minecraft:light_gray_stained_glass_pane": { id: 1, name: "Glass" },
    "minecraft:gray_stained_glass_pane": { id: 1, name: "Glass" },
    "minecraft:blue_stained_glass_pane": { id: 1, name: "Glass" },

    // Quartz family → stone-like
    "minecraft:quartz_block": { id: 1, name: "Stone Bricks" },
    "minecraft:chiseled_quartz_block": { id: 1, name: "Stone Bricks" },
    "minecraft:quartz_pillar": { id: 1, name: "Stone Bricks" },
    "minecraft:quartz_slab": { id: 1, name: "Stone Bricks" },
    "minecraft:quartz_stairs": { id: 1, name: "Stone Bricks" },
    "minecraft:smooth_quartz": { id: 1, name: "Stone Bricks" },
    "minecraft:smooth_quartz_slab": { id: 1, name: "Stone Bricks" },
    "minecraft:smooth_quartz_stairs": { id: 1, name: "Stone Bricks" },

    // Stone/Slab/Brick variants
    "minecraft:smooth_stone": { id: 1, name: "Stone" },
    "minecraft:smooth_stone_slab": { id: 1, name: "Stone" },
    "minecraft:stone_slab": { id: 1, name: "Stone" },
    "minecraft:stone_brick_slab": { id: 1, name: "Stone Bricks" },
    "minecraft:stone_bricks": { id: 1, name: "Stone Bricks" },
    "minecraft:chiseled_stone_bricks": { id: 1, name: "Stone Bricks" },

    // Sandstone family → sand stand-ins
    "minecraft:sand": { id: 4, name: "Sand" },
    "minecraft:sandstone": { id: 4, name: "Sand" },
    "minecraft:chiseled_sandstone": { id: 4, name: "Sand" },
    "minecraft:cut_sandstone": { id: 4, name: "Sand" },
    "minecraft:sandstone_slab": { id: 4, name: "Sand" },
    "minecraft:sandstone_stairs": { id: 4, name: "Sand" },
    "minecraft:smooth_sandstone_slab": { id: 4, name: "Sand" },
    "minecraft:suspicious_sand": { id: 4, name: "Sand" },
    "minecraft:sandstone_wall": { id: 4, name: "Sand" },

    // Walls
    "minecraft:cobblestone_wall": { id: 1, name: "Cobblestone" },
    "minecraft:stone_brick_wall": { id: 1, name: "Stone Bricks" },
    "minecraft:brick_wall": { id: 1, name: "Bricks" },
    "minecraft:nether_brick_wall": { id: 1, name: "Bricks" },
    "minecraft:red_nether_brick_wall": { id: 1, name: "Bricks" },
    "minecraft:mossy_cobblestone_wall": { id: 1, name: "Cobblestone" },

    // Stairs map to base
    "minecraft:brick_stairs": { id: 1, name: "Bricks" },
    "minecraft:birch_stairs": { id: 1, name: "Oak Planks" },
    "minecraft:jungle_stairs": { id: 1, name: "Oak Planks" },
    "minecraft:acacia_stairs": { id: 1, name: "Oak Planks" },
    "minecraft:dark_oak_stairs": { id: 1, name: "Oak Planks" },
    "minecraft:polished_diorite_stairs": { id: 1, name: "Stone" },
    "minecraft:diorite_stairs": { id: 1, name: "Stone" },
    "minecraft:red_nether_brick_stairs": { id: 1, name: "Bricks" },
    "minecraft:nether_brick_stairs": { id: 1, name: "Bricks" },
    "minecraft:dark_prismarine_stairs": { id: 1, name: "Stone" },

    // Slabs
    "minecraft:cobblestone_slab": { id: 1, name: "Cobblestone" },
    "minecraft:oak_slab": { id: 1, name: "Oak Planks" },
    "minecraft:nether_brick_slab": { id: 1, name: "Bricks" },
    "minecraft:acacia_slab": { id: 1, name: "Oak Planks" },

    // Doors/Trapdoors/Signs
    "minecraft:oak_door": { id: 1, name: "Oak Planks" },
    "minecraft:birch_door": { id: 1, name: "Oak Planks" },
    "minecraft:iron_door": { id: 1, name: "Stone" },
    "minecraft:oak_trapdoor": { id: 1, name: "Oak Planks" },
    "minecraft:dark_oak_trapdoor": { id: 1, name: "Oak Planks" },
    "minecraft:acacia_trapdoor": { id: 1, name: "Oak Planks" },
    "minecraft:spruce_trapdoor": { id: 1, name: "Oak Planks" },
    "minecraft:oak_wall_sign": { id: 1, name: "Oak Planks" },
    "minecraft:birch_wall_sign": { id: 1, name: "Oak Planks" },
    "minecraft:dark_oak_wall_sign": { id: 1, name: "Oak Planks" },
    "minecraft:dark_oak_fence_gate": { id: 1, name: "Oak Planks" },

    // Bars/rails/misc
    "minecraft:iron_bars": { id: 1, name: "Stone" },
    "minecraft:rail": { id: 1, name: "Stone" },
    "minecraft:ladder": { id: 1, name: "Oak Planks" },
    "minecraft:stone_button": { id: 1, name: "Stone" },
    "minecraft:lever": { id: 1, name: "Stone" },
    "minecraft:tripwire_hook": { id: 1, name: "Stone" },

    // Lighting/Decor
    "minecraft:glowstone": { id: 1, name: "Stone" },
    "minecraft:sea_lantern": { id: 1, name: "Stone" },
    "minecraft:lantern": { id: 1, name: "Stone" },
    "minecraft:redstone_torch": { id: 1, name: "Stone" },
    "minecraft:wall_torch": { id: 1, name: "Stone" },

    // Solid blocks
    "minecraft:iron_block": { id: 1, name: "Stone" },
    "minecraft:lapis_block": { id: 1, name: "Stone" },
    "minecraft:emerald_block": { id: 1, name: "Stone" },

    // Functional blocks
    "minecraft:hopper": { id: 1, name: "Stone" },
    "minecraft:cartography_table": { id: 1, name: "Oak Planks" },
    "minecraft:furnace": { id: 1, name: "Stone" },
    "minecraft:anvil": { id: 1, name: "Stone" },
    "minecraft:beacon": { id: 1, name: "Stone" },
    "minecraft:campfire": { id: 1, name: "Oak Planks" },
    "minecraft:chain_command_block": { id: 1, name: "Stone" },
    "minecraft:jigsaw": { id: 1, name: "Stone" },
    "minecraft:blast_furnace": { id: 1, name: "Stone" },
    "minecraft:grindstone": { id: 1, name: "Stone" },

    // Mushrooms & wood variants
    "minecraft:mushroom_stem": { id: 1, name: "Log" },
    "minecraft:oak_wood": { id: 1, name: "Log" },
    "minecraft:stripped_oak_wood": { id: 1, name: "Log" },

    // Ice variants
    "minecraft:ice": { id: 1, name: "Ice" },
    "minecraft:packed_ice": { id: 1, name: "Ice" },

    // Sponges
    "minecraft:sponge": { id: 4, name: "Sand" },
    "minecraft:wet_sponge": { id: 4, name: "Sand" },

    // Nether bricks/fence
    "minecraft:nether_brick_fence": { id: 1, name: "Bricks" },

    // Banners/Skulls and risky blocks → skip
    "minecraft:green_wall_banner": { skip: true },
    "minecraft:white_wall_banner": { skip: true },
    "minecraft:wither_skeleton_skull": { skip: true },
    "minecraft:tnt": { skip: true },
    "minecraft:chest": { id: 1, name: "Oak Planks" },
};

function decodeLongPairToBigInt(pair) {
    // Handle both array pairs and direct values
    if (Array.isArray(pair)) {
        const hi = BigInt((pair[0] >>> 0) >>> 0);
        const lo = BigInt((pair[1] >>> 0) >>> 0);
        return (hi << 32n) | lo;
    }
    return BigInt(pair);
}

function decodePaletteIndices(longPairs, paletteLen, totalBlocks) {
    // Check if data is already in the right format
    if (!longPairs || longPairs.length === 0) {
        return new Array(totalBlocks).fill(0);
    }

    const longs =
        longPairs.length > 0 && typeof longPairs[0] === "bigint"
            ? longPairs
            : longPairs.map(decodeLongPairToBigInt);

    // Mojang's packed array uses floor(64 / b) entries per 64-bit long, without crossing word boundaries
    const bitsPerBlock = Math.max(
        4,
        Math.ceil(Math.log2(Math.max(1, paletteLen)))
    );
    const valuesPerLong = Math.max(1, Math.floor(64 / bitsPerBlock));
    const mask = (1n << BigInt(bitsPerBlock)) - 1n;
    const out = new Array(totalBlocks);

    for (let i = 0; i < totalBlocks; i++) {
        const longIndex = Math.floor(i / valuesPerLong);
        const indexWithinLong = i % valuesPerLong;
        const startBit = BigInt(indexWithinLong * bitsPerBlock);
        const word = longs[longIndex] ?? 0n;
        out[i] = Number((word >> startBit) & mask);
    }
    return out;
}

// Axiom blueprint format uses X-Z-Y order (X changes fastest)
// This is different from vanilla Minecraft's Y-Z-X order
function sectionIndexToLocalXYZ(index) {
    const x = index & 15;
    const z = (index >> 4) & 15;
    const y = (index >> 8) & 15;
    return { x, y, z };
}

function getVal(v) {
    return v && v.value !== undefined ? v.value : v;
}

function convertStructureToEditorFormat(structure, debug = false) {
    let regions = [];

    // Handle different NBT parser output formats
    if (Array.isArray(structure.BlockRegion)) {
        regions = structure.BlockRegion;
    } else if (structure.BlockRegion) {
        // Check for nested value structure from prismarine-nbt
        if (structure.BlockRegion.value) {
            if (Array.isArray(structure.BlockRegion.value)) {
                regions = structure.BlockRegion.value;
            } else if (
                structure.BlockRegion.value.value &&
                Array.isArray(structure.BlockRegion.value.value)
            ) {
                regions = structure.BlockRegion.value.value;
            }
        }
    }

    if (debug) {
        console.log(`Found ${regions.length} regions to process`);
    }

    const blocks = {};
    const unmappedBlocks = new Set();
    const blockCounts = {};

    for (let idx = 0; idx < regions.length; idx++) {
        const region = regions[idx];

        const baseX = getVal(region.X) * 16;
        const baseY = getVal(region.Y) * 16;
        const baseZ = getVal(region.Z) * 16;

        const bs = getVal(region.BlockStates);
        if (!bs) {
            if (debug) {
                console.log(`No BlockStates for region ${idx}`);
            }
            continue;
        }

        let data = getVal(bs.data) || [];
        let palette = bs.palette || {};

        // Handle the nested structure from prismarine-nbt
        // palette is an object with type: 'list' and value: { type: 'compound', value: [...] }
        if (palette.type === "list" && palette.value && palette.value.value) {
            palette = palette.value.value;
        } else if (palette.value && Array.isArray(palette.value)) {
            palette = palette.value;
        } else {
            palette = getVal(palette) || [];
        }

        if (!palette.length) continue;

        const totalBlocks = 16 * 16 * 16;
        const indices = decodePaletteIndices(data, palette.length, totalBlocks);

        if (debug) {
            console.log(`\nRegion #${idx} at (${baseX}, ${baseY}, ${baseZ})`);
            console.log(`Palette length: ${palette.length}`);
            const sampleNames = palette
                .slice(0, 5)
                .map((p) => getVal(p?.Name) || "?");
            console.log(`Sample blocks: ${sampleNames.join(", ")}`);
            console.log(`Data array length: ${data ? data.length : 0}`);
            if (data && data.length > 0) {
                console.log(
                    `First data element type: ${typeof data[0]}, is array: ${Array.isArray(
                        data[0]
                    )}`
                );
                if (Array.isArray(data[0])) {
                    console.log(
                        `First data pair: [${data[0][0]}, ${data[0][1]}]`
                    );
                }
            }
        }

        let regionBlockCount = 0;
        for (let i = 0; i < totalBlocks; i++) {
            const pIdx = indices[i];
            const entry = palette[pIdx];
            if (!entry) continue;

            const nameVal = getVal(entry.Name);
            if (!nameVal || typeof nameVal !== "string") continue;

            const mcName = nameVal;
            blockCounts[mcName] = (blockCounts[mcName] || 0) + 1;
            regionBlockCount++;

            const mapping = DEFAULT_BLOCK_MAPPINGS[mcName];
            if (!mapping || mapping.skip) {
                if (!mapping) {
                    unmappedBlocks.add(mcName);
                }
                continue;
            }

            const { x: lx, y: ly, z: lz } = sectionIndexToLocalXYZ(i);
            const x = baseX + lx;
            const y = baseY + ly;
            const z = baseZ + lz;

            blocks[`${x},${y},${z}`] = mapping.id;
        }

        if (debug) {
            console.log(`Region processed: ${regionBlockCount} blocks found`);
        }
    }

    return { blocks, unmappedBlocks: Array.from(unmappedBlocks), blockCounts };
}

async function main() {
    const args = process.argv.slice(2);
    const inputFile = args[0];
    const debug = args.includes("--debug");

    if (!inputFile) {
        console.error(
            "Usage: node scripts/convert-axiom-bp-to-editor.js <input.bp> [--debug]"
        );
        process.exit(1);
    }

    const inputPath = path.isAbsolute(inputFile)
        ? inputFile
        : path.resolve(process.cwd(), inputFile);

    if (!fs.existsSync(inputPath)) {
        console.error(`File not found: ${inputPath}`);
        process.exit(1);
    }

    try {
        console.log("Parsing blueprint file...");
        const { metadata, structure } = await parseAxiomBlueprint(inputPath);

        console.log("Converting to editor format...");
        const { blocks, unmappedBlocks, blockCounts } =
            convertStructureToEditorFormat(structure, debug);

        // Calculate bounding box
        const coords = Object.keys(blocks).map((k) => {
            const [x, y, z] = k.split(",").map(Number);
            return { x, y, z };
        });

        if (coords.length > 0) {
            const minX = Math.min(...coords.map((c) => c.x));
            const maxX = Math.max(...coords.map((c) => c.x));
            const minY = Math.min(...coords.map((c) => c.y));
            const maxY = Math.max(...coords.map((c) => c.y));
            const minZ = Math.min(...coords.map((c) => c.z));
            const maxZ = Math.max(...coords.map((c) => c.z));

            console.log("\n=== Conversion Summary ===");
            console.log(
                `Total blocks converted: ${Object.keys(blocks).length}`
            );
            console.log(
                `Bounding box: (${minX}, ${minY}, ${minZ}) to (${maxX}, ${maxY}, ${maxZ})`
            );
            console.log(
                `Size: ${maxX - minX + 1} x ${maxY - minY + 1} x ${
                    maxZ - minZ + 1
                }`
            );
        }

        if (unmappedBlocks.length > 0) {
            console.log("\n=== Unmapped Blocks ===");
            console.log("The following blocks do not have mappings:");
            unmappedBlocks.forEach((blockName) => {
                const count = blockCounts[blockName] || 0;
                console.log(`  - ${blockName}: ${count} blocks`);
            });
            console.log(
                "\nAdd mappings for these blocks in DEFAULT_BLOCK_MAPPINGS or use the UI remapper."
            );
        }

        // Save converted data
        const outputDir = path.join(path.dirname(inputPath), "converted");
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const outputFile = path.join(outputDir, "editor-converted.json");
        const outputData = {
            metadata: metadata,
            blocks: blocks,
            unmappedBlocks: unmappedBlocks,
            blockCounts: blockCounts,
            timestamp: new Date().toISOString(),
        };

        fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2));
        console.log(`\nConverted data saved to: ${outputFile}`);
    } catch (error) {
        console.error("Conversion failed:", error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
