#!/usr/bin/env node

/*
 * Axiom .bp (Blueprint) parser
 *
 * Usage:
 *   node scripts/parse-axiom-bp.js /absolute/path/to/file.bp [--out /absolute/output/dir]
 *
 * Output (when --out is provided):
 *   - <out>/metadata.json
 *   - <out>/structure.json (may be large)
 *   - <out>/preview.png
 */

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const MAGIC = Buffer.from([0x0a, 0xe5, 0xbb, 0x36]);

function readUInt32BE(buf, offset) {
    if (offset + 4 > buf.length) {
        throw new Error(`Unexpected EOF reading u32 at ${offset}`);
    }
    return buf.readUInt32BE(offset);
}

// Minimal NBT parser (big-endian) with gzip detection
const TAG_TYPES = {
    END: 0,
    BYTE: 1,
    SHORT: 2,
    INT: 3,
    LONG: 4,
    FLOAT: 5,
    DOUBLE: 6,
    BYTE_ARRAY: 7,
    STRING: 8,
    LIST: 9,
    COMPOUND: 10,
    INT_ARRAY: 11,
    LONG_ARRAY: 12,
};

class NbtReader {
    constructor(buf) {
        this.buf = buf; // Node Buffer
        this.offset = 0;
    }
    readU8() {
        const v = this.buf.readUInt8(this.offset);
        this.offset += 1;
        return v;
    }
    readI8() {
        const v = this.buf.readInt8(this.offset);
        this.offset += 1;
        return v;
    }
    readI16() {
        const v = this.buf.readInt16BE(this.offset);
        this.offset += 2;
        return v;
    }
    readI32() {
        const v = this.buf.readInt32BE(this.offset);
        this.offset += 4;
        return v;
    }
    readF32() {
        const v = this.buf.readFloatBE(this.offset);
        this.offset += 4;
        return v;
    }
    readF64() {
        const v = this.buf.readDoubleBE(this.offset);
        this.offset += 8;
        return v;
    }
    readString() {
        const len = this.readI16();
        const s = this.buf.subarray(this.offset, this.offset + len).toString("utf8");
        this.offset += len;
        return s;
    }
    parseTagValue(tagType) {
        switch (tagType) {
            case TAG_TYPES.BYTE:
                return this.readI8();
            case TAG_TYPES.SHORT:
                return this.readI16();
            case TAG_TYPES.INT:
                return this.readI32();
            case TAG_TYPES.LONG: {
                const hi = this.readI32();
                const lo = this.readI32();
                return (BigInt(hi) << 32n) | BigInt(lo >>> 0);
            }
            case TAG_TYPES.FLOAT:
                return this.readF32();
            case TAG_TYPES.DOUBLE:
                return this.readF64();
            case TAG_TYPES.BYTE_ARRAY: {
                const len = this.readI32();
                const arr = new Int8Array(len);
                for (let i = 0; i < len; i++) arr[i] = this.readI8();
                return Array.from(arr);
            }
            case TAG_TYPES.STRING:
                return this.readString();
            case TAG_TYPES.LIST: {
                const childType = this.readU8();
                const len = this.readI32();
                const out = [];
                for (let i = 0; i < len; i++) {
                    out.push(this.parseTagValue(childType));
                }
                return out;
            }
            case TAG_TYPES.COMPOUND:
                return this.parseCompound(true);
            case TAG_TYPES.INT_ARRAY: {
                const len = this.readI32();
                const out = new Array(len);
                for (let i = 0; i < len; i++) out[i] = this.readI32();
                return out;
            }
            case TAG_TYPES.LONG_ARRAY: {
                const len = this.readI32();
                const out = new Array(len);
                for (let i = 0; i < len; i++) {
                    const hi = this.readI32();
                    const lo = this.readI32();
                    out[i] = (BigInt(hi) << 32n) | BigInt(lo >>> 0);
                }
                return out;
            }
            default:
                throw new Error(`Unknown tag type ${tagType} @${this.offset}`);
        }
    }
    parseCompound(skipOuterHeader = false) {
        const out = {};
        if (!skipOuterHeader) {
            const t = this.readU8();
            if (t !== TAG_TYPES.COMPOUND) throw new Error(`Expected compound tag`);
            const _name = this.readString(); // ignore root name
        }
        while (true) {
            const t = this.readU8();
            if (t === TAG_TYPES.END) break;
            const name = this.readString();
            out[name] = this.parseTagValue(t);
        }
        return out;
    }
}

function parseNbt(buffer) {
    // Detect gzip (0x1F 0x8B) or zlib (0x78 0x9C/DA/01)
    let data = buffer;
    if (buffer.length >= 2) {
        const b0 = buffer[0], b1 = buffer[1];
        if (b0 === 0x1f && b1 === 0x8b) {
            data = zlib.gunzipSync(buffer);
        } else if (b0 === 0x78) {
            try { data = zlib.inflateSync(buffer); } catch { /* fall through */ }
        }
    }
    const reader = new NbtReader(data);
    // Root is a compound with a name header
    return reader.parseCompound(false);
}

async function parseAxiomBlueprint(filePath) {
    const buffer = fs.readFileSync(filePath);
    let offset = 0;

    // Magic number
    const magic = buffer.subarray(offset, offset + 4);
    offset += 4;
    if (!magic.equals(MAGIC)) {
        throw new Error(
            `Invalid magic number: got ${magic.toString(
                "hex"
            )}, expected ${MAGIC.toString("hex")}`
        );
    }

    // Metadata (raw NBT)
    const metadataLength = readUInt32BE(buffer, offset);
    offset += 4;
    const metadataBuf = buffer.subarray(offset, offset + metadataLength);
    offset += metadataLength;
    const metadata = parseNbt(metadataBuf);

    // Preview image (PNG)
    const previewLength = readUInt32BE(buffer, offset);
    offset += 4;
    const previewBuf = buffer.subarray(offset, offset + previewLength);
    offset += previewLength;
    // Validate PNG signature when present
    if (
        previewBuf.length >= 8 &&
        !(
            previewBuf[0] === 0x89 &&
            previewBuf[1] === 0x50 &&
            previewBuf[2] === 0x4e &&
            previewBuf[3] === 0x47 &&
            previewBuf[4] === 0x0d &&
            previewBuf[5] === 0x0a &&
            previewBuf[6] === 0x1a &&
            previewBuf[7] === 0x0a
        )
    ) {
        console.warn(
            "Warning: preview image does not start with PNG signature"
        );
    }

    // Structure data (GZIP compressed NBT)
    const structureLength = readUInt32BE(buffer, offset);
    offset += 4;
    const structureCompressed = buffer.subarray(
        offset,
        offset + structureLength
    );
    offset += structureLength;
    let structure;
    try {
        structure = parseNbt(zlib.gunzipSync(structureCompressed));
    } catch (e) {
        console.warn(
            "Structure not gzip-compressed or failed to decompress, trying raw parse..."
        );
        try {
            structure = parseNbt(structureCompressed);
        } catch (e2) {
            console.error("Failed to parse structure NBT:", e2);
            throw e2;
        }
    }

    // Optional trailing data
    if (offset !== buffer.length) {
        // In case of future format changes; not fatal
        console.warn(
            `Notice: ${buffer.length - offset} trailing bytes at end of file`
        );
    }

    return { metadata, previewBuf, structure };
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function main() {
    const [, , inputPathArg, ...rest] = process.argv;
    if (!inputPathArg) {
        console.error(
            "Usage: node scripts/parse-axiom-bp.js /absolute/path/to/file.bp [--out /absolute/output/dir]"
        );
        process.exit(1);
    }

    let outDir = null;
    for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--out") {
            outDir = rest[i + 1] || null;
            i++;
        }
    }

    const inputPath = path.isAbsolute(inputPathArg)
        ? inputPathArg
        : path.resolve(process.cwd(), inputPathArg);

    try {
        const result = await parseAxiomBlueprint(inputPath);
        console.log("Metadata keys:", Object.keys(result.metadata || {}));
        console.log("Preview size (bytes):", result.previewBuf?.length ?? 0);
        console.log("Structure keys:", Object.keys(result.structure || {}));

        if (outDir) {
            ensureDir(outDir);
            const metaPath = path.join(outDir, "metadata.json");
            const structPath = path.join(outDir, "structure.json");
            const previewPath = path.join(outDir, "preview.png");

            fs.writeFileSync(
                metaPath,
                JSON.stringify(result.metadata, null, 2)
            );
            fs.writeFileSync(
                structPath,
                JSON.stringify(result.structure, null, 2)
            );
            fs.writeFileSync(previewPath, result.previewBuf);
            console.log(
                `Wrote:\n- ${metaPath}\n- ${structPath}\n- ${previewPath}`
            );
        }
    } catch (err) {
        console.error("Failed to parse blueprint:", err);
        process.exit(2);
    }
}

if (require.main === module) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    main();
}

module.exports = { parseAxiomBlueprint };