#!/usr/bin/env node

/**
 * Convert Axiom Blueprint to Editor Format
 * Usage: node scripts/convert-axiom-bp-to-editor.js <input.bp> [--debug]
 */

const fs = require("fs");
const path = require("path");
const { parseAxiomBlueprint } = require("./parse-axiom-bp");

// Default block mappings - same as in BlockMapper.js
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

    // Explicit skips
    "minecraft:air": { skip: true },
    "minecraft:barrier": { skip: true },

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
    // Add more mappings as needed
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

function decodeLongLikeToBigIntArray(longLikeArray) {
    // Normalize any representation into two candidate BigInt arrays (hiLo and loHi)
    const hiLo = [];
    const loHi = [];
    for (const entry of longLikeArray || []) {
        if (entry == null) continue;
        if (typeof entry === "bigint") {
            hiLo.push(entry);
            loHi.push(entry);
        } else if (typeof entry === "number") {
            const v = BigInt(entry >>> 0);
            hiLo.push(v);
            loHi.push(v);
        } else if (Array.isArray(entry) && entry.length >= 2) {
            const a = BigInt((entry[0] >>> 0) >>> 0);
            const b = BigInt((entry[1] >>> 0) >>> 0);
            hiLo.push((a << 32n) | b);
            loHi.push((b << 32n) | a);
        } else if (typeof entry === "object") {
            // prismarine-nbt Long from 'long' lib usually has { low, high }
            const a = BigInt((entry.high >>> 0) >>> 0 || 0);
            const b = BigInt((entry.low >>> 0) >>> 0 || 0);
            hiLo.push((a << 32n) | b);
            loHi.push((b << 32n) | a);
        }
    }
    return { hiLo, loHi };
}

function tryDecodeWithLongs(longs, paletteLen, totalBlocks) {
    const bitsPerBlock = Math.max(4, Math.ceil(Math.log2(Math.max(1, paletteLen))));
    const mask = (1n << BigInt(bitsPerBlock)) - 1n;
    const out = new Array(totalBlocks);
    let invalid = 0;

    for (let i = 0; i < totalBlocks; i++) {
        const bitIndex = BigInt(i) * BigInt(bitsPerBlock);
        const longIndex = Number(bitIndex / 64n);
        const startBit = Number(bitIndex % 64n);
        let value;
        if (longIndex >= longs.length) {
            invalid += 1;
            out[i] = 0;
            continue;
        }
        if (startBit + bitsPerBlock <= 64) {
            value = Number((longs[longIndex] >> BigInt(startBit)) & mask);
        } else {
            const lowBits = 64 - startBit;
            const low = (longs[longIndex] >> BigInt(startBit)) & ((1n << BigInt(lowBits)) - 1n);
            const next = longIndex + 1 < longs.length ? longs[longIndex + 1] : 0n;
            const high = next & ((1n << BigInt(bitsPerBlock - lowBits)) - 1n);
            value = Number(low | (high << BigInt(lowBits)));
        }
        out[i] = value;
        if (value < 0 || value >= paletteLen) invalid += 1;
    }
    return { indices: out, invalidCount: invalid };
}

function decodePaletteIndices(longLikeArray, paletteLen, totalBlocks) {
    if (!longLikeArray || longLikeArray.length === 0) {
        return new Array(totalBlocks).fill(0);
    }

    const { hiLo, loHi } = decodeLongLikeToBigIntArray(longLikeArray);
    const a = tryDecodeWithLongs(hiLo, paletteLen, totalBlocks);
    const b = tryDecodeWithLongs(loHi, paletteLen, totalBlocks);
    const best = a.invalidCount <= b.invalidCount ? a : b;
    return best.indices;
}

// Axiom blueprint format uses X-Z-Y order (X changes fastest)
// This is different from vanilla Minecraft's Y-Z-X order
function sectionIndexToLocalXYZ_XZY(index) {
    const x = index & 15;
    const z = (index >> 4) & 15;
    const y = (index >> 8) & 15;
    return { x, y, z };
}

function sectionIndexToLocalXYZ_XYZ(index) {
    const x = index & 15;
    const y = (index >> 4) & 15;
    const z = (index >> 8) & 15;
    return { x, y, z };
}

function chooseBestAxisOrder(indices, palette, debug) {
    // Heuristic: pick order that produces more contiguous chunks (fewer boundary gaps)
    const totalBlocks = indices.length;
    const orders = [
        { name: "XZY", fn: sectionIndexToLocalXYZ_XZY },
        { name: "XYZ", fn: sectionIndexToLocalXYZ_XYZ },
    ];
    let best = null;
    for (const ord of orders) {
        const occupancy = new Map(); // chunkKey -> {minX,maxX,minY,maxY,minZ,maxZ}
        for (let i = 0; i < totalBlocks; i++) {
            const pIdx = indices[i];
            const entry = palette[pIdx];
            if (!entry) continue;
            const rel = ord.fn(i);
            const x = rel.x, y = rel.y, z = rel.z;
            const cx = Math.floor(x / 16), cy = Math.floor(y / 16), cz = Math.floor(z / 16);
            const key = `${cx},${cy},${cz}`;
            let o = occupancy.get(key);
            if (!o) {
                o = { minX: 99, maxX: -99, minY: 99, maxY: -99, minZ: 99, maxZ: -99 };
                occupancy.set(key, o);
            }
            o.minX = Math.min(o.minX, x);
            o.maxX = Math.max(o.maxX, x);
            o.minY = Math.min(o.minY, y);
            o.maxY = Math.max(o.maxY, y);
            o.minZ = Math.min(o.minZ, z);
            o.maxZ = Math.max(o.maxZ, z);
        }
        // score completeness: count boundaries reaching at least 0..15 on X and Z
        let score = 0;
        for (const o of occupancy.values()) {
            if (o.maxX - o.minX >= 15) score += 2;
            if (o.maxZ - o.minZ >= 15) score += 2;
            if (o.maxY - o.minY >= 15) score += 1;
        }
        if (!best || score > best.score) best = { order: ord, score };
    }
    if (debug) {
        console.log(`Axis order heuristic picked: ${best.order.name}`);
    }
    return best.order.fn;
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
        const axisFn = chooseBestAxisOrder(indices, palette, debug);

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

            const { x: lx, y: ly, z: lz } = axisFn(i);
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