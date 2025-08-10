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
const { parse } = require("prismarine-nbt");

const MAGIC = Buffer.from([0x0a, 0xe5, 0xbb, 0x36]);

function readUInt32BE(buf, offset) {
    if (offset + 4 > buf.length) {
        throw new Error(`Unexpected EOF reading u32 at ${offset}`);
    }
    return buf.readUInt32BE(offset);
}

function parseNbt(buffer) {
    return new Promise((resolve, reject) => {
        parse(buffer, (err, data) => {
            if (err) return reject(err);
            // prismarine-nbt has returned different shapes across versions
            // Try common shapes in order
            if (data && typeof data === "object") {
                if (data.value !== undefined) return resolve(data.value);
                if (data.parsed !== undefined) return resolve(data.parsed);
            }
            return resolve(data);
        });
    });
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
    const metadata = await parseNbt(metadataBuf);

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
    let structureDecompressed;
    try {
        structureDecompressed = zlib.gunzipSync(structureCompressed);
    } catch (e) {
        // Some files may store uncompressed NBT
        console.warn(
            "Structure not gzip-compressed or failed to decompress, trying raw parse..."
        );
        structureDecompressed = structureCompressed;
    }
    const structure = await parseNbt(structureDecompressed);

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