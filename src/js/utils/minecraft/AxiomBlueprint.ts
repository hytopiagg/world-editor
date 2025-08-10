import { NBTParser } from "./NBTParser";
import { DEFAULT_BLOCK_MAPPINGS, suggestMapping } from "./BlockMapper";

const AXIOM_MAGIC = new Uint8Array([0x0a, 0xe5, 0xbb, 0x36]);

function u32(view: DataView, offset: number): number {
  if (offset + 4 > view.byteLength) throw new Error(`Unexpected EOF at ${offset}`);
  return view.getUint32(offset, false);
}

function buffersEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export type EditorSchematic = {
  blocks: Record<string, number>;
  entities?: Array<{
    entityName: string;
    position: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
  }>;
  unmapped?: string[];
  blockCounts?: Record<string, number>;
};

function getVal(v: any): any {
  return v && v.value !== undefined ? v.value : v;
}

function decodeLongPairToBigInt(pair: any): bigint {
  if (Array.isArray(pair)) {
    const hi = BigInt((pair[0] >>> 0) >>> 0);
    const lo = BigInt((pair[1] >>> 0) >>> 0);
    return (hi << 32n) | lo;
  }
  return BigInt(pair);
}

function decodePaletteIndices(longPairs: any[], paletteLen: number, totalBlocks: number): number[] {
  if (!longPairs || longPairs.length === 0) return new Array(totalBlocks).fill(0);
  const longs = typeof longPairs[0] === "bigint" ? longPairs as any : longPairs.map(decodeLongPairToBigInt);
  const bitsPerBlock = Math.max(4, Math.ceil(Math.log2(Math.max(1, paletteLen))));
  const mask = (1n << BigInt(bitsPerBlock)) - 1n;
  const out = new Array<number>(totalBlocks);
  for (let i = 0; i < totalBlocks; i++) {
    const bitIndex = BigInt(i * bitsPerBlock);
    const longIndex = Number(bitIndex / 64n);
    const startBit = Number(bitIndex % 64n);
    let value: number;
    if (startBit + bitsPerBlock <= 64) {
      value = Number(((longs[longIndex] as bigint) >> BigInt(startBit)) & mask);
    } else {
      const lowBits = 64 - startBit;
      const low = ((longs[longIndex] as bigint) >> BigInt(startBit)) & ((1n << BigInt(lowBits)) - 1n);
      const high = (longs[longIndex + 1] as bigint) & ((1n << BigInt(bitsPerBlock - lowBits)) - 1n);
      value = Number(low | (high << BigInt(lowBits)));
    }
    out[i] = value;
  }
  return out;
}

// Axiom order: X-Z-Y (x changes fastest)
function sectionIndexToLocalXYZ(index: number) {
  const x = index & 15;
  const z = (index >> 4) & 15;
  const y = (index >> 8) & 15;
  return { x, y, z };
}

// Optional mapping to environment entities by block name
const ENVIRONMENT_ENTITY_MAPPINGS: Record<string, { entityName: string }> = {
  // Example: "minecraft:torch": { entityName: "Essentials/lantern" },
};

export async function parseAxiomBlueprintFromArrayBuffer(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const fileMagic = new Uint8Array(buffer, 0, 4);
  if (!buffersEqual(fileMagic, AXIOM_MAGIC)) {
    throw new Error("Invalid Axiom .bp magic");
  }
  let offset = 4;
  const metadataLength = u32(view, offset); offset += 4;
  const metadataBuf = buffer.slice(offset, offset + metadataLength); offset += metadataLength;
  const metadata = NBTParser.parse(metadataBuf);

  const previewLength = u32(view, offset); offset += 4;
  const previewBuf = buffer.slice(offset, offset + previewLength); offset += previewLength;

  const structureLength = u32(view, offset); offset += 4;
  const structureBuf = buffer.slice(offset, offset + structureLength); offset += structureLength;
  const structure = NBTParser.parse(structureBuf);

  return { metadata, previewBuf, structure };
}

export function convertStructureToEditorSchematic(structure: any, options?: { mapUnknownToDefault?: boolean; defaultBlockId?: number; }): EditorSchematic {
  let regions: any[] = [];
  if (Array.isArray(structure.BlockRegion)) {
    regions = structure.BlockRegion;
  } else if (structure.BlockRegion) {
    if (structure.BlockRegion.value) {
      if (Array.isArray(structure.BlockRegion.value)) {
        regions = structure.BlockRegion.value;
      } else if (structure.BlockRegion.value.value && Array.isArray(structure.BlockRegion.value.value)) {
        regions = structure.BlockRegion.value.value;
      }
    }
  }

  const blocks: Record<string, number> = {};
  const entities: EditorSchematic["entities"] = [];
  const unmappedSet = new Set<string>();
  const blockCounts: Record<string, number> = {};

  for (let idx = 0; idx < regions.length; idx++) {
    const region = regions[idx];
    const baseX = getVal(region.X) * 16;
    const baseY = getVal(region.Y) * 16;
    const baseZ = getVal(region.Z) * 16;

    const bs = getVal(region.BlockStates);
    if (!bs) continue;

    let data = getVal(bs.data) || [];
    let palette: any = bs.palette || {};

    if (palette?.type === "list" && palette.value?.value) {
      palette = palette.value.value;
    } else if (palette?.value && Array.isArray(palette.value)) {
      palette = palette.value;
    } else {
      palette = getVal(palette) || [];
    }
    if (!palette.length) continue;

    const totalBlocks = 16 * 16 * 16;
    const indices = decodePaletteIndices(data, palette.length, totalBlocks);

    for (let i = 0; i < totalBlocks; i++) {
      const pIdx = indices[i];
      const entry = palette[pIdx];
      if (!entry) continue;

      const mcName: string = getVal(entry.Name);
      if (!mcName || typeof mcName !== "string") continue;

      blockCounts[mcName] = (blockCounts[mcName] || 0) + 1;

      if (mcName === "minecraft:structure_void") continue; // explicit skip

      // Environment entity mapping
      const env = ENVIRONMENT_ENTITY_MAPPINGS[mcName];
      const { x: lx, y: ly, z: lz } = sectionIndexToLocalXYZ(i);
      const wx = baseX + lx;
      const wy = baseY + ly;
      const wz = baseZ + lz;

      if (env) {
        entities!.push({ entityName: env.entityName, position: [wx, wy, wz] });
        continue;
      }

      const mapping = (DEFAULT_BLOCK_MAPPINGS as any)[mcName] || suggestMapping(mcName);
      if (mapping && mapping.action !== "skip" && mapping.id != null) {
        blocks[`${wx},${wy},${wz}`] = mapping.id as number;
      } else if (options?.mapUnknownToDefault && options.defaultBlockId != null) {
        blocks[`${wx},${wy},${wz}`] = options.defaultBlockId;
      } else {
        unmappedSet.add(mcName);
      }
    }
  }

  return { blocks, entities, unmapped: Array.from(unmappedSet), blockCounts };
}