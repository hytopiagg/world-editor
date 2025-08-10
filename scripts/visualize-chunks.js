#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const inputFile = process.argv[2] || "converted/editor-converted.json";
const inputPath = path.isAbsolute(inputFile)
    ? inputFile
    : path.resolve(process.cwd(), inputFile);

if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const blocks = data.blocks;

// Group blocks by 16x16x16 chunks
const chunks = {};
Object.entries(blocks).forEach(([coordStr, blockId]) => {
    const [x, y, z] = coordStr.split(",").map(Number);
    const chunkX = Math.floor(x / 16);
    const chunkY = Math.floor(y / 16);
    const chunkZ = Math.floor(z / 16);
    const chunkKey = `${chunkX},${chunkY},${chunkZ}`;

    if (!chunks[chunkKey]) {
        chunks[chunkKey] = {
            count: 0,
            minX: Infinity,
            maxX: -Infinity,
            minY: Infinity,
            maxY: -Infinity,
            minZ: Infinity,
            maxZ: -Infinity,
        };
    }

    chunks[chunkKey].count++;
    chunks[chunkKey].minX = Math.min(chunks[chunkKey].minX, x);
    chunks[chunkKey].maxX = Math.max(chunks[chunkKey].maxX, x);
    chunks[chunkKey].minY = Math.min(chunks[chunkKey].minY, y);
    chunks[chunkKey].maxY = Math.max(chunks[chunkKey].maxY, y);
    chunks[chunkKey].minZ = Math.min(chunks[chunkKey].minZ, z);
    chunks[chunkKey].maxZ = Math.max(chunks[chunkKey].maxZ, z);
});

console.log("=== Chunk Analysis ===");
console.log(`Total chunks with blocks: ${Object.keys(chunks).length}`);
console.log("\nChunk details:");

Object.entries(chunks)
    .sort((a, b) => {
        const [ax, ay, az] = a[0].split(",").map(Number);
        const [bx, by, bz] = b[0].split(",").map(Number);
        if (ay !== by) return ay - by;
        if (ax !== bx) return ax - bx;
        return az - bz;
    })
    .forEach(([chunkKey, chunk]) => {
        const [cx, cy, cz] = chunkKey.split(",").map(Number);
        console.log(
            `  Chunk (${cx}, ${cy}, ${cz}): ${chunk.count} blocks, ` +
                `X:[${chunk.minX}..${chunk.maxX}], ` +
                `Y:[${chunk.minY}..${chunk.maxY}], ` +
                `Z:[${chunk.minZ}..${chunk.maxZ}]`
        );
    });

// Check for gaps between chunks
console.log("\n=== Gap Analysis ===");
const chunkCoords = Object.keys(chunks).map((k) => {
    const [x, y, z] = k.split(",").map(Number);
    return { x, y, z };
});

// Check for missing adjacent chunks
let gaps = [];
chunkCoords.forEach((chunk) => {
    const neighbors = [
        { x: chunk.x + 1, y: chunk.y, z: chunk.z },
        { x: chunk.x - 1, y: chunk.y, z: chunk.z },
        { x: chunk.x, y: chunk.y + 1, z: chunk.z },
        { x: chunk.x, y: chunk.y - 1, z: chunk.z },
        { x: chunk.x, y: chunk.y, z: chunk.z + 1 },
        { x: chunk.x, y: chunk.y, z: chunk.z - 1 },
    ];

    neighbors.forEach((neighbor) => {
        const neighborKey = `${neighbor.x},${neighbor.y},${neighbor.z}`;
        const hasNeighbor = chunks[neighborKey];

        // Check if there should be a neighbor based on the overall structure bounds
        const coords = Object.keys(blocks).map((k) => {
            const [x, y, z] = k.split(",").map(Number);
            return { x, y, z };
        });

        const inBounds = coords.some(
            (c) =>
                Math.floor(c.x / 16) === neighbor.x &&
                Math.floor(c.y / 16) === neighbor.y &&
                Math.floor(c.z / 16) === neighbor.z
        );

        if (!hasNeighbor && inBounds) {
            const gapKey = `(${chunk.x},${chunk.y},${chunk.z}) -> (${neighbor.x},${neighbor.y},${neighbor.z})`;
            if (!gaps.includes(gapKey)) {
                gaps.push(gapKey);
            }
        }
    });
});

if (gaps.length > 0) {
    console.log("Potential gaps found between chunks:");
    gaps.forEach((gap) => console.log(`  ${gap}`));
} else {
    console.log("No obvious gaps detected between chunks.");
}

// Analyze block distribution at chunk boundaries
console.log("\n=== Boundary Analysis ===");
Object.entries(chunks).forEach(([chunkKey, chunk]) => {
    const [cx, cy, cz] = chunkKey.split(",").map(Number);
    const expectedMinX = cx * 16;
    const expectedMaxX = cx * 16 + 15;
    const expectedMinY = cy * 16;
    const expectedMaxY = cy * 16 + 15;
    const expectedMinZ = cz * 16;
    const expectedMaxZ = cz * 16 + 15;

    const xGap = chunk.minX > expectedMinX || chunk.maxX < expectedMaxX;
    const yGap = chunk.minY > expectedMinY || chunk.maxY < expectedMaxY;
    const zGap = chunk.minZ > expectedMinZ || chunk.maxZ < expectedMaxZ;

    if (xGap || yGap || zGap) {
        console.log(`Chunk (${cx}, ${cy}, ${cz}) has incomplete boundaries:`);
        if (xGap)
            console.log(
                `  X: expected [${expectedMinX}..${expectedMaxX}], got [${chunk.minX}..${chunk.maxX}]`
            );
        if (yGap)
            console.log(
                `  Y: expected [${expectedMinY}..${expectedMaxY}], got [${chunk.minY}..${chunk.maxY}]`
            );
        if (zGap)
            console.log(
                `  Z: expected [${expectedMinZ}..${expectedMaxZ}], got [${chunk.minZ}..${chunk.maxZ}]`
            );
    }
});