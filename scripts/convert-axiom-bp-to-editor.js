/*
 * Convert Axiom .bp to world-editor format:
 * {
 *   terrain: { added: { "x,y,z": blockId, ... }, removed: {} },
 *   environment: { added: [], removed: [] }
 * }
 *
 * Usage:
 *   node scripts/convert-axiom-bp-to-editor.js /absolute/path/to/file.bp [--out /absolute/output.json]
 * Options:
 *   --names   Output block names instead of IDs (for debugging)
 */

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { parseAxiomBlueprint } = require("./parse-axiom-bp");

const BLOCKS_ASSETS_DIR = path.join(__dirname, "../public/assets/blocks");

function listAllBlockTexturePaths(rootDir) {
  const results = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && /\.png$/i.test(entry.name)) {
        const rel = path
          .relative(rootDir, full)
          .replace(/\\/g, "/");
        results.push(rel);
      }
    }
  }
  walk(rootDir);
  // Sort to mimic webpack require.context().keys() lexical ordering
  results.sort();
  return results;
}

function buildEditorBlockIdMap(rootDir) {
  const texturePaths = listAllBlockTexturePaths(rootDir);
  const blockNameToId = new Map();
  let idCounter = 1; // 0 reserved for air
  for (const rel of texturePaths) {
    // match formats: "bricks.png" or "log/+x.png" → base name is before first '/'
    const firstSlash = rel.indexOf("/");
    const base = firstSlash === -1 ? rel.replace(/\.png$/i, "") : rel.slice(0, firstSlash);
    if (!blockNameToId.has(base)) {
      blockNameToId.set(base, idCounter++);
    }
  }
  return blockNameToId;
}

function normalizeMcName(mcName) {
  const name = (mcName || "").toLowerCase().replace(/^minecraft:/, "");
  return name;
}

function findBestBlockNameFor(mcName, blockNameToId) {
  const name = normalizeMcName(mcName);
  if (name === "air" || name === "structure_void" || name === "cave_air") return null;

  // Prefer exact base name match
  if (blockNameToId.has(name)) return name;

  // Common mappings/aliases
  const aliases = [
    [/(.*)_planks$/, "oak-planks"],
    [/^spruce_log$/, "log"],
    [/^oak_log$/, "log"],
    [/^birch_log$/, "log"],
    [/^jungle_log$/, "log"],
    [/^acacia_log$/, "log"],
    [/^dark_oak_log$/, "log"],
    [/^cherry_log$/, "log"],
    [/^mangrove_log$/, "log"],
    [/^stone_brick(s)?_stairs$/, "stone-bricks"],
    [/^stone_bricks$/, "stone-bricks"],
    [/^polished_(granite|diorite|andesite)$/, "stone"],
    [/^(granite|diorite|andesite)$/, "stone"],
    [/^cobblestone$/, "cobblestone"],
    [/^bricks$/, "bricks"],
    [/^glass$/, "glass"],
    [/^clay$/, "clay"],
    [/^sand$/, "sand"],
    [/^red_sand$/, "sand"],
    [/^gravel$/, "gravel"],
    [/^dirt|podzol|mycelium|farmland|mud|coarse_dirt|rooted_dirt$/, "dirt"],
    [/^grass_block$/, "grass"],
    [/^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry)_leaves$/, "oak-leaves"],
    [/^water|lava$/, "water"],
    [/^obsidian|netherrack|glowstone$/, "dragons-stone"],
    [/^stone$/, "stone"],
  ];
  for (const [regex, target] of aliases) {
    if (regex.test(name) && blockNameToId.has(target)) return target;
  }

  // Try hyphen/underscore variants
  const hyphen = name.replace(/_/g, "-");
  if (blockNameToId.has(hyphen)) return hyphen;
  // Fuzzy includes: pick the first asset whose name is contained in mc name or vice versa
  for (const assetName of blockNameToId.keys()) {
    if (name.includes(assetName) || assetName.includes(name)) return assetName;
  }
  // Default fallback
  return blockNameToId.has("stone") ? "stone" : Array.from(blockNameToId.keys())[0] || null;
}

function mapMcNameToId(mcName, blockNameToId) {
  const best = findBestBlockNameFor(mcName, blockNameToId);
  if (!best) return 0; // treat as air/skip
  return blockNameToId.get(best) || 0;
}

function longPairToBigInt(pair) {
  // pair can be [hi, lo] signed 32-bit each. We want unsigned 64-bit composition.
  const hi = BigInt((pair[0] >>> 0) >>> 0);
  const lo = BigInt((pair[1] >>> 0) >>> 0);
  return (hi << 32n) | lo;
}

function decodePaletteIndices(longPairs, paletteLen, totalBlocks) {
  const longs = longPairs.map(longPairToBigInt);
  const bitsPerBlock = Math.max(4, Math.ceil(Math.log2(Math.max(1, paletteLen))));
  const mask = (1n << BigInt(bitsPerBlock)) - 1n;
  const out = new Array(totalBlocks);
  for (let i = 0; i < totalBlocks; i++) {
    const bitIndex = BigInt(i * bitsPerBlock);
    const longIndex = Number(bitIndex / 64n);
    const startBit = Number(bitIndex % 64n);
    let value;
    if (startBit + bitsPerBlock <= 64) {
      value = Number((longs[longIndex] >> BigInt(startBit)) & mask);
    } else {
      const lowBits = 64 - startBit;
      const low = (longs[longIndex] >> BigInt(startBit)) & ((1n << BigInt(lowBits)) - 1n);
      const high = longs[longIndex + 1] & ((1n << BigInt(bitsPerBlock - lowBits)) - 1n);
      value = Number(low | (high << BigInt(lowBits)));
    }
    out[i] = value;
  }
  return out;
}

function sectionIndexToLocalXYZ(index) {
  // Assume order y(0..15), z(0..15), x(0..15) as Minecraft does: i = y<<8 | z<<4 | x
  const x = index & 15;
  const z = (index >> 4) & 15;
  const y = (index >> 8) & 15;
  return { x, y, z };
}

async function convertBlueprintToEditor(filePath, options = {}) {
  const { structure } = await parseAxiomBlueprint(filePath);
  const blockNameToId = buildEditorBlockIdMap(BLOCKS_ASSETS_DIR);
  const regions = (structure.BlockRegion && structure.BlockRegion.value && structure.BlockRegion.value.value) || [];
  const terrainAdded = {};
  const environmentAdded = [];
  for (const region of regions) {
    const baseX = region.X.value * 16;
    const baseY = region.Y.value * 16;
    const baseZ = region.Z.value * 16;
    const blockStates = region.BlockStates.value;
    const data = (blockStates.data && blockStates.data.value) || [];
    const palette = (blockStates.palette && blockStates.palette.value && blockStates.palette.value.value) || [];
    if (!palette.length) continue;
    const totalBlocks = 16 * 16 * 16;
    const indices = decodePaletteIndices(data, palette.length, totalBlocks);
    for (let i = 0; i < totalBlocks; i++) {
      const paletteIndex = indices[i];
      const entry = palette[paletteIndex];
      if (!entry || !entry.Name || !entry.Name.value) continue;
      const mcName = entry.Name.value;
      const idOrName = options.names
        ? normalizeMcName(mcName)
        : mapMcNameToId(mcName, blockNameToId);
      if (options.names) {
        if (idOrName === null) continue; // air
      } else {
        if (!idOrName) continue; // id 0 is air
      }
      const { x: lx, y: ly, z: lz } = sectionIndexToLocalXYZ(i);
      const x = baseX + lx;
      const y = baseY + ly;
      const z = baseZ + lz;
      const key = `${x},${y},${z}`;
      terrainAdded[key] = idOrName;
    }
  }
  // Optionally translate BlockEntities / Entities later; for now, leave empty arrays
  return {
    terrain: { added: terrainAdded, removed: {} },
    environment: { added: environmentAdded, removed: [] },
  };
}

async function main() {
  const [, , inputPathArg, ...rest] = process.argv;
  if (!inputPathArg) {
    console.error(
      "Usage: node scripts/convert-axiom-bp-to-editor.js /abs/path/to/file.bp [--out /abs/output.json] [--names]"
    );
    process.exit(1);
  }
  let outPath = null;
  let names = false;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--out") {
      outPath = rest[i + 1] || null;
      i++;
    } else if (rest[i] === "--names") {
      names = true;
    }
  }
  const inputPath = path.isAbsolute(inputPathArg)
    ? inputPathArg
    : path.resolve(process.cwd(), inputPathArg);
  try {
    const converted = await convertBlueprintToEditor(inputPath, { names });
    if (outPath) {
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(converted, null, 2));
      console.log(`Wrote ${outPath}`);
    } else {
      console.log(JSON.stringify(converted, null, 2));
    }
  } catch (err) {
    console.error("Conversion failed:", err);
    process.exit(2);
  }
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main();
}

module.exports = { convertBlueprintToEditor };


