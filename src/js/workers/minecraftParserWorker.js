/* eslint-disable no-restricted-globals */
import JSZip from "jszip";
import { AnvilParser } from "../utils/minecraft/AnvilParser";

self.onmessage = async function (event) {
    const { type, data } = event.data;
    if (type === "scanWorldSize") {
        try {
            const zipData = data.zipFile;
            self.postMessage({
                type: "progress",
                data: {
                    message: `Scanning world size...`,
                    progress: 5,
                },
            });
            const worldSizeInfo = await scanWorldSize(zipData);
            self.postMessage({
                type: "worldSizeScanned",
                data: worldSizeInfo,
            });
        } catch (error) {
            self.postMessage({
                type: "error",
                error: error.message || "Unknown error during world scanning",
            });
        }
    } else if (type === "parseWorld") {
        try {
            const zipData = data.zipFile;
            const options = data.options || {};
            self.postMessage({
                type: "progress",
                data: {
                    message: `Starting world parsing with options: ${JSON.stringify(options)}`,
                    progress: 2,
                },
            });

            await parseMinecraftWorld(zipData, options);

        } catch (error) {
            self.postMessage({
                type: "error",
                error: error.message || "Unknown error during world parsing",
            });
        }
    }
};
/**
 * Scan a Minecraft world to determine its size and boundaries without fully parsing it
 * @param {ArrayBuffer} zipData - The world ZIP file data
 * @returns {Object} World size information including boundaries
 */
async function scanWorldSize(zipData) {
    try {

        const zip = await JSZip.loadAsync(zipData);

        const filesInZip = Object.keys(zip.files);
        console.log("Files in ZIP:", filesInZip);
        self.postMessage({
            type: "progress",
            data: {
                message: `Found ${filesInZip.length} files in ZIP`,
                progress: 10,
            },
        });

        let worldVersion = null;

        const levelDatPatterns = [/^level\.dat$/, /^.*\/level\.dat$/];
        for (const pattern of levelDatPatterns) {
            const levelDatFile = Object.keys(zip.files).find((path) =>
                path.match(pattern)
            );
            if (levelDatFile) {
                try {
                    const levelDatBuffer =
                        await zip.files[levelDatFile].async("arraybuffer");

                    const tempParser = new AnvilParser();
                    tempParser.checkWorldVersion(levelDatBuffer);
                    worldVersion = tempParser.worldVersion;
                    self.postMessage({
                        type: "progress",
                        data: {
                            message: `Found level.dat at ${levelDatFile}, World Version: ${worldVersion || "Unknown"}`,
                            progress: 15,
                        },
                    });
                    break;
                } catch (e) {
                    console.warn(
                        `Failed to read level.dat at ${levelDatFile}:`,
                        e
                    );
                }
            }
        }
        if (!worldVersion) {
            console.warn("Could not determine world version from level.dat");
        }

        const possibleRegionPaths = [
            /^region\/r\.-?\d+\.-?\d+\.mca$/, // Direct region folder
            /^.+\/region\/r\.-?\d+\.-?\d+\.mca$/, // World folder/region
            /^saves\/.+\/region\/r\.-?\d+\.-?\d+\.mca$/, // saves/world folder/region
        ];
        let regionFiles = [];

        for (const pattern of possibleRegionPaths) {
            const matchingFiles = Object.keys(zip.files).filter((path) =>
                path.match(pattern)
            );
            if (matchingFiles.length > 0) {
                regionFiles = matchingFiles;
                self.postMessage({
                    type: "progress",
                    data: {
                        message: `Found ${regionFiles.length} region files with pattern ${pattern}`,
                        progress: 30,
                    },
                });
                break;
            }
        }

        if (regionFiles.length === 0) {
            regionFiles = Object.keys(zip.files).filter((path) =>
                path.endsWith(".mca")
            );
            self.postMessage({
                type: "progress",
                data: {
                    message: `Found ${regionFiles.length} .mca files by extension`,
                    progress: 30,
                },
            });
        }
        if (regionFiles.length === 0) {
            throw new Error(
                "No region files found in the uploaded world. The file may not be a valid Minecraft world ZIP or the region files might be stored in an unexpected location."
            );
        }

        let regionCoords = [];
        for (const regionPath of regionFiles) {
            const regionMatch = regionPath.match(/r\.(-?\d+)\.(-?\d+)\.mca$/);
            if (regionMatch) {
                regionCoords.push({
                    path: regionPath,
                    x: parseInt(regionMatch[1]),
                    z: parseInt(regionMatch[2]),
                });
            }
        }

        let minRegionX = Infinity,
            maxRegionX = -Infinity;
        let minRegionZ = Infinity,
            maxRegionZ = -Infinity;
        for (const region of regionCoords) {
            minRegionX = Math.min(minRegionX, region.x);
            maxRegionX = Math.max(maxRegionX, region.x);
            minRegionZ = Math.min(minRegionZ, region.z);
            maxRegionZ = Math.max(maxRegionZ, region.z);
        }


        const minBlockX = minRegionX * 512;
        const maxBlockX = (maxRegionX + 1) * 512 - 1;
        const minBlockZ = minRegionZ * 512;
        const maxBlockZ = (maxRegionZ + 1) * 512 - 1;

        const minBlockY = -64;
        const maxBlockY = 320;

        const sampleRegions = getRepresentativeRegions(regionCoords);
        self.postMessage({
            type: "progress",
            data: {
                message: `Sampling ${sampleRegions.length} regions to analyze height distribution...`,
                progress: 50,
            },
        });
        let actualMinY = minBlockY;
        let actualMaxY = maxBlockY;

        if (sampleRegions.length > 0) {
            const sampleYBounds = await getSampleYBounds(zip, sampleRegions);
            if (sampleYBounds) {
                actualMinY = sampleYBounds.minY;
                actualMaxY = sampleYBounds.maxY;
            }
        }

        const worldWidthBlocks = maxBlockX - minBlockX + 1;
        const worldHeightBlocks = actualMaxY - actualMinY + 1;
        const worldDepthBlocks = maxBlockZ - minBlockZ + 1;

        const regionWidth = maxRegionX - minRegionX + 1;
        const regionDepth = maxRegionZ - minRegionZ + 1;
        const regionCount = regionWidth * regionDepth;


        const approximateSizeMB = regionCount * 2;

        const worldSizeInfo = {
            bounds: {
                minX: minBlockX,
                maxX: maxBlockX,
                minY: actualMinY,
                maxY: actualMaxY,
                minZ: minBlockZ,
                maxZ: maxBlockZ,
            },
            size: {
                width: worldWidthBlocks,
                height: worldHeightBlocks,
                depth: worldDepthBlocks,
                regionCount: regionCount,
                regionWidth: regionWidth,
                regionDepth: regionDepth,
                approximateSizeMB: approximateSizeMB,
            },
            regionCoords: regionCoords,
            worldFolder: detectWorldFolder(regionFiles[0]),
            worldVersion: worldVersion,
        };
        self.postMessage({
            type: "progress",
            data: {
                message: `World scan complete. Size: ${worldWidthBlocks}x${worldHeightBlocks}x${worldDepthBlocks} blocks across ${regionCount} regions`,
                progress: 100,
            },
        });
        return worldSizeInfo;
    } catch (error) {
        console.error("Error in scanWorldSize:", error);
        throw error;
    }
}
/**
 * Get a representative sample of regions to analyze for Y-bounds
 * @param {Array} regionCoords - All region coordinates
 * @returns {Array} A subset of regions to sample
 */
function getRepresentativeRegions(regionCoords) {

    if (regionCoords.length <= 3) {
        return regionCoords;
    }


    let sumX = 0,
        sumZ = 0;
    regionCoords.forEach((region) => {
        sumX += region.x;
        sumZ += region.z;
    });
    const centerX = Math.round(sumX / regionCoords.length);
    const centerZ = Math.round(sumZ / regionCoords.length);

    let centerRegion = null;
    let minDistToCenter = Infinity;
    regionCoords.forEach((region) => {
        const dist = Math.sqrt(
            Math.pow(region.x - centerX, 2) + Math.pow(region.z - centerZ, 2)
        );
        if (dist < minDistToCenter) {
            minDistToCenter = dist;
            centerRegion = region;
        }
    });

    const quadrants = [
        [], // Q1: positive X, positive Z
        [], // Q2: negative X, positive Z
        [], // Q3: negative X, negative Z
        [], // Q4: positive X, negative Z
    ];
    regionCoords.forEach((region) => {
        if (region.x >= 0 && region.z >= 0) quadrants[0].push(region);
        else if (region.x < 0 && region.z >= 0) quadrants[1].push(region);
        else if (region.x < 0 && region.z < 0) quadrants[2].push(region);
        else quadrants[3].push(region);
    });

    const samples = [centerRegion];
    quadrants.forEach((quadrant) => {
        if (quadrant.length > 0) {

            const randomIndex = Math.floor(Math.random() * quadrant.length);
            const region = quadrant[randomIndex];

            if (region.x !== centerRegion.x || region.z !== centerRegion.z) {
                samples.push(region);
            }
        }
    });

    return samples.slice(0, 5);
}
/**
 * Extract representative Y bounds by sampling a few chunks from each provided region
 * @param {JSZip} zip - The world ZIP
 * @param {Array} sampleRegions - Regions to sample
 * @returns {Object|null} An object with minY and maxY if found
 */
async function getSampleYBounds(zip, sampleRegions) {
    try {
        let minY = Infinity;
        let maxY = -Infinity;

        const parser = new AnvilParser({
            skipBlockLoading: true, // Special option to only read section headers
        });

        for (const region of sampleRegions) {
            try {

                const regionFileBuffer =
                    await zip.files[region.path].async("arraybuffer");

                const yBounds = parser.extractYBoundsFromRegion(
                    regionFileBuffer,
                    region.x,
                    region.z
                );
                if (yBounds) {
                    minY = Math.min(minY, yBounds.minY);
                    maxY = Math.max(maxY, yBounds.maxY);
                }
            } catch (e) {
                console.warn(
                    `Error sampling Y-bounds from region (${region.x}, ${region.z}):`,
                    e
                );
            }
        }

        if (minY !== Infinity && maxY !== -Infinity) {
            return { minY, maxY };
        }

        return null;
    } catch (e) {
        console.warn("Error sampling Y-bounds:", e);
        return null;
    }
}
/**
 * Detect the world folder name from a region file path
 * @param {string} regionPath - Path to a region file
 * @returns {string} The detected world folder name or null
 */
function detectWorldFolder(regionPath) {

    const worldFolderMatch = regionPath.match(/(?:saves\/)?([^\/]+)\/region\//);
    if (worldFolderMatch && worldFolderMatch[1]) {
        return worldFolderMatch[1];
    }
    return null;
}
async function parseMinecraftWorld(zipData, options = {}) {
    try {

        const zip = await JSZip.loadAsync(zipData);

        const filesInZip = Object.keys(zip.files);
        console.log("Files in ZIP:", filesInZip);
        self.postMessage({
            type: "progress",
            data: {
                message: `Found ${filesInZip.length} files in ZIP`,
                progress: 5,
            },
        });


        const possibleRegionPaths = [
            /^region\/r\.-?\d+\.-?\d+\.mca$/, // Direct region folder
            /^.+\/region\/r\.-?\d+\.-?\d+\.mca$/, // World folder/region
            /^saves\/.+\/region\/r\.-?\d+\.-?\d+\.mca$/, // saves/world folder/region
        ];
        let regionFiles = [];

        for (const pattern of possibleRegionPaths) {
            const matchingFiles = Object.keys(zip.files).filter((path) =>
                path.match(pattern)
            );
            if (matchingFiles.length > 0) {
                regionFiles = matchingFiles;
                self.postMessage({
                    type: "progress",
                    data: {
                        message: `Found ${regionFiles.length} region files with pattern ${pattern}`,
                        progress: 8,
                    },
                });
                break;
            }
        }

        if (regionFiles.length === 0) {
            regionFiles = Object.keys(zip.files).filter((path) =>
                path.endsWith(".mca")
            );
            self.postMessage({
                type: "progress",
                data: {
                    message: `Found ${regionFiles.length} .mca files by extension`,
                    progress: 8,
                },
            });
        }
        if (regionFiles.length === 0) {

            console.log("ZIP contents:", filesInZip);
            throw new Error(
                "No region files found in the uploaded world. The file may not be a valid Minecraft world ZIP or the region files might be stored in an unexpected location."
            );
        }

        let levelDatBuffer = null;
        let levelDatFound = false;

        const levelDatPatterns = [/^level\.dat$/, /^.*\/level\.dat$/];
        for (const pattern of levelDatPatterns) {
            const levelDatFile = Object.keys(zip.files).find((path) =>
                path.match(pattern)
            );
            if (levelDatFile) {
                try {
                    levelDatBuffer =
                        await zip.files[levelDatFile].async("arraybuffer");
                    levelDatFound = true;
                    self.postMessage({
                        type: "progress",
                        data: {
                            message: `Found level.dat at ${levelDatFile}`,
                            progress: 9,
                        },
                    });
                    break;
                } catch (e) {
                    console.warn(
                        `Failed to read level.dat at ${levelDatFile}:`,
                        e
                    );
                }
            }
        }
        if (!levelDatFound) {
            console.warn(
                "Could not find level.dat, continuing without world metadata"
            );
        }

        let regionCoords = [];
        for (const regionPath of regionFiles) {
            const regionMatch = regionPath.match(/r\.(-?\d+)\.(-?\d+)\.mca$/);
            if (regionMatch) {
                regionCoords.push({
                    path: regionPath,
                    x: parseInt(regionMatch[1]),
                    z: parseInt(regionMatch[2]),
                });
            }
        }

        let minRegionX = Infinity,
            maxRegionX = -Infinity;
        let minRegionZ = Infinity,
            maxRegionZ = -Infinity;
        for (const region of regionCoords) {
            minRegionX = Math.min(minRegionX, region.x);
            maxRegionX = Math.max(maxRegionX, region.x);
            minRegionZ = Math.min(minRegionZ, region.z);
            maxRegionZ = Math.max(maxRegionZ, region.z);
        }

        let regionBounds = null;
        if (options.limitRegions) {

            if (
                regionCoords.length > options.maxRegions &&
                options.maxRegions > 0
            ) {
                const centerX = Math.floor((minRegionX + maxRegionX) / 2);
                const centerZ = Math.floor((minRegionZ + maxRegionZ) / 2);
                const radius = Math.floor(Math.sqrt(options.maxRegions) / 2);
                regionBounds = {
                    minX: centerX - radius,
                    maxX: centerX + radius,
                    minZ: centerZ - radius,
                    maxZ: centerZ + radius,
                };
                self.postMessage({
                    type: "progress",
                    data: {
                        message: `Limiting to ${(regionBounds.maxX - regionBounds.minX + 1) * (regionBounds.maxZ - regionBounds.minZ + 1)} central regions around (${centerX}, ${centerZ})`,
                        progress: 10,
                    },
                });
            } else if (options.regionBounds) {

                regionBounds = options.regionBounds;
            }
        }

        self.postMessage({
            type: "progress",
            data: {
                message: `Found ${regionFiles.length} region files in ${maxRegionX - minRegionX + 1}x${maxRegionZ - minRegionZ + 1} area`,
                progress: 10,
            },
        });

        const parserOptions = {

            ...options,

            regionBounds: regionBounds || options.regionBounds,
        };
        self.postMessage({
            type: "progress",
            data: {
                message: `Initializing parser with options: ${JSON.stringify(parserOptions)}`,
                progress: 12,
            },
        });
        const parser = new AnvilParser(parserOptions);

        if (levelDatBuffer) {
            parser.checkWorldVersion(levelDatBuffer);
        }

        let processedRegions = 0;
        let errorRegions = 0;

        let sortedRegionCoords = [...regionCoords];
        if (regionBounds) {
            const centerX = (regionBounds.minX + regionBounds.maxX) / 2;
            const centerZ = (regionBounds.minZ + regionBounds.maxZ) / 2;
            sortedRegionCoords.sort((a, b) => {
                const distA = Math.sqrt(
                    Math.pow(a.x - centerX, 2) + Math.pow(a.z - centerZ, 2)
                );
                const distB = Math.sqrt(
                    Math.pow(b.x - centerX, 2) + Math.pow(b.z - centerZ, 2)
                );
                return distA - distB;
            });
        }
        for (let i = 0; i < sortedRegionCoords.length; i++) {

            if (
                options.memoryLimit &&
                self.performance &&
                self.performance.memory
            ) {
                const usedMemory =
                    self.performance.memory.usedJSHeapSize / (1024 * 1024); // MB
                const totalMemory =
                    self.performance.memory.totalJSHeapSize / (1024 * 1024); // MB
                const memoryPercent = (usedMemory / options.memoryLimit) * 100;
                if (usedMemory > options.memoryLimit) {
                    self.postMessage({
                        type: "progress",
                        data: {
                            message: `Memory limit reached (${usedMemory.toFixed(2)}MB > ${options.memoryLimit}MB). Stopping after ${processedRegions} regions.`,
                            progress:
                                10 +
                                Math.floor(
                                    (i / sortedRegionCoords.length) * 80
                                ),
                            memoryUsage: {
                                used: usedMemory,
                                total: totalMemory,
                                percent: memoryPercent,
                                limit: options.memoryLimit,
                            },
                        },
                    });
                    break;
                }

                if (i % 5 === 0) {
                    self.postMessage({
                        type: "memoryUpdate",
                        data: {
                            used: usedMemory,
                            total: totalMemory,
                            percent: memoryPercent,
                            limit: options.memoryLimit,
                        },
                    });
                }
            }
            const regionInfo = sortedRegionCoords[i];
            const regionPath = regionInfo.path;
            const regionX = regionInfo.x;
            const regionZ = regionInfo.z;

            try {
                const regionBuffer =
                    await zip.files[regionPath].async("arraybuffer");

                parser.parseRegionFile(
                    regionBuffer,
                    regionX,
                    regionZ,
                    options.debug
                );
                processedRegions++;

                const progress =
                    10 + Math.floor((i / sortedRegionCoords.length) * 80);
                self.postMessage({
                    type: "progress",
                    data: {
                        message: `Processed ${i + 1}/${sortedRegionCoords.length} regions (${regionX},${regionZ}). Skipped ${parser.skippedChunks.yBounds + parser.skippedChunks.xzBounds} chunks due to filters.`,
                        progress,
                        skippedChunks: parser.skippedChunks,
                    },
                });

                if (global.gc) {
                    global.gc();
                }
            } catch (error) {
                console.warn(
                    `Error processing region file ${regionPath}:`,
                    error
                );
                errorRegions++;
                self.postMessage({
                    type: "progress",
                    data: {
                        message: `Warning: Skipped region file ${regionPath} due to error`,
                        progress:
                            10 +
                            Math.floor((i / sortedRegionCoords.length) * 80),
                    },
                });
            }
        }

        const worldData = parser.getWorldData();

        let estimatedMemory = "Unknown";
        if (self.performance && self.performance.memory) {
            estimatedMemory =
                (
                    self.performance.memory.usedJSHeapSize /
                    (1024 * 1024)
                ).toFixed(2) + " MB";
        }

        worldData.processingStats = {
            regionsProcessed: processedRegions,
            regionsWithErrors: errorRegions,
            totalRegions: regionCoords.length,
            estimatedMemoryUsage: estimatedMemory,
            bounds: regionBounds,
        };

        if (worldData.totalBlocks === 0) {
            if (processedRegions === 0) {
                throw new Error(
                    "Could not process any region files. The world file may be corrupted or in an unsupported format."
                );
            } else {
                console.warn("No blocks found in processed regions");

            }
        }

        console.log(
            `Processed ${processedRegions} regions out of ${regionCoords.length}, errors: ${errorRegions}, total blocks: ${worldData.totalBlocks}`
        );

        console.log("[CHUNKS] Splitting blocks data into chunks");

        const blocksData = worldData.blocks || {};

        const worldDataWithoutBlocks = { ...worldData };
        delete worldDataWithoutBlocks.blocks;

        const blockEntries = Object.entries(blocksData);
        const totalBlocks = blockEntries.length;

        const CHUNK_SIZE = 100000; // Blocks per chunk (increased from 50000)
        const totalChunks = Math.ceil(totalBlocks / CHUNK_SIZE);
        console.log(
            `[CHUNKS] Sending ${totalBlocks} blocks in ${totalChunks} chunks of ${CHUNK_SIZE} blocks each`
        );

        for (let chunkId = 1; chunkId <= totalChunks; chunkId++) {
            const startIndex = (chunkId - 1) * CHUNK_SIZE;
            const endIndex = Math.min(startIndex + CHUNK_SIZE, totalBlocks);

            const chunkBlocks = {};
            for (let i = startIndex; i < endIndex; i++) {
                const [key, value] = blockEntries[i];
                chunkBlocks[key] = value;
            }

            self.postMessage({
                type: "blockChunk",
                data: {
                    chunkId: chunkId,
                    totalChunks: totalChunks,
                    blocks: chunkBlocks,
                },
            });

            await new Promise((resolve) => setTimeout(resolve, 0));
        }

        self.postMessage({
            type: "progress",
            data: {
                message: `World parsing complete - sent ${totalBlocks} blocks in ${totalChunks} chunks`,
                progress: 100,
            },
        });

        self.postMessage({
            type: "worldParsed",
            data: worldDataWithoutBlocks,
        });
        return worldDataWithoutBlocks;
    } catch (error) {
        console.error("Error parsing Minecraft world:", error);
        throw error; // Re-throw to be caught by the caller
    }
}
