import {
    getHytopiaBlockById,
    generateUniqueBlockId,
} from "./minecraft/BlockMapper";
import {
    MAX_IMPORT_SIZE_X,
    MAX_IMPORT_SIZE_Y,
    MAX_IMPORT_SIZE_Z,
} from "../constants/terrain";
export class MinecraftToHytopiaConverter {
    constructor(worldData, selectedRegion, blockMappings) {
        this.worldData = worldData;
        this.selectedRegion = selectedRegion;
        this.blockMappings = blockMappings;
        this.progressCallback = null;
    }
    setProgressCallback(callback) {
        this.progressCallback = callback;
    }
    async convert() {

        const {
            offsetX,
            offsetY,
            offsetZ,
            regionWidth,
            regionHeight,
            regionDepth,
            additionalOffsetX,
            additionalOffsetZ,
        } = this.calculateRegionParameters();

        const worldBounds = {
            minX: -Math.floor(regionWidth / 2) + additionalOffsetX,
            maxX:
                regionWidth -
                Math.floor(regionWidth / 2) -
                1 +
                additionalOffsetX,
            minY: 0,
            maxY: regionHeight - 1,
            minZ: -Math.floor(regionDepth / 2) + additionalOffsetZ,
            maxZ:
                regionDepth -
                Math.floor(regionDepth / 2) -
                1 +
                additionalOffsetZ,
        };
        console.log(
            `Centering map: Original region center (${offsetX}, ${offsetY + regionHeight / 2}, ${offsetZ})`
        );
        console.log(
            `Additional XZ offsets: (${additionalOffsetX}, ${additionalOffsetZ})`
        );
        console.log(
            `After centering, map will extend from (${worldBounds.minX}, ${worldBounds.minY}, ${worldBounds.minZ}) to (${worldBounds.maxX}, ${worldBounds.maxY}, ${worldBounds.maxZ})`
        );

        const blockSource = this.getBlockSource();
        const blockCount = this.getBlockCount(blockSource);
        console.log(`Processing ${blockCount} blocks from Minecraft world`);

        const editorMap = {};



        let lastProgressUpdate = Date.now();

        const processBlockBatch = async (
            batchSize,
            batchIndex,
            totalBatches
        ) => {

            if (this.progressCallback) {
                this.progressCallback((batchIndex / totalBatches) * 100);
            }

            if (batchIndex > 0 && batchIndex % 5 === 0) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
            let batchStartIndex = batchIndex * batchSize;
            let batchEndIndex = Math.min(
                batchStartIndex + batchSize,
                blockCount
            );

            if (Array.isArray(blockSource)) {

                for (let i = batchStartIndex; i < batchEndIndex; i++) {
                    const blockData = blockSource[i];
                    const { x, y, z, type: mcBlockType } = blockData;

                    const finalX = x - offsetX + additionalOffsetX;
                    const finalY = y - offsetY; // Bottom of map is now at y=0
                    const finalZ = z - offsetZ + additionalOffsetZ;

                    if (
                        this.isInFinalRegion(
                            finalX,
                            finalY,
                            finalZ,
                            regionWidth,
                            regionHeight,
                            regionDepth
                        )
                    ) {

                        this.processBlock(
                            editorMap,
                            mcBlockType,
                            finalX,
                            finalY,
                            finalZ
                        );

                    }
                }
            } else {


                const blockKeys = Object.keys(blockSource);
                for (
                    let i = batchStartIndex;
                    i < batchEndIndex && i < blockKeys.length;
                    i++
                ) {
                    const key = blockKeys[i];
                    if (key.startsWith("section:")) {

                        const parts = key.split(":")[1].split(",");
                        const startX = parseInt(parts[0]);
                        const startY = parseInt(parts[1]);
                        const startZ = parseInt(parts[2]);
                        const blockWidth = parseInt(parts[3]);
                        const blockHeight = parseInt(parts[4]);
                        const blockDepth = parseInt(parts[5]);
                        const blockData = blockSource[key];

                        const sectionMinX =
                            startX - offsetX + additionalOffsetX;
                        const sectionMinY = startY - offsetY;
                        const sectionMinZ =
                            startZ - offsetZ + additionalOffsetZ;
                        const sectionMaxX = sectionMinX + blockWidth - 1;
                        const sectionMaxY = sectionMinY + blockHeight - 1;
                        const sectionMaxZ = sectionMinZ + blockDepth - 1;

                        if (
                            !this.sectionsIntersect(
                                sectionMinX,
                                sectionMinY,
                                sectionMinZ,
                                sectionMaxX,
                                sectionMaxY,
                                sectionMaxZ,
                                worldBounds.minX,
                                worldBounds.minY,
                                worldBounds.minZ,
                                worldBounds.maxX,
                                worldBounds.maxY,
                                worldBounds.maxZ
                            )
                        ) {
                            continue;
                        }


                        for (let dy = 0; dy < blockHeight; dy++) {
                            const finalY = sectionMinY + dy;
                            if (
                                finalY < worldBounds.minY ||
                                finalY > worldBounds.maxY
                            )
                                continue;
                            for (let dx = 0; dx < blockWidth; dx++) {
                                const finalX = sectionMinX + dx;
                                if (
                                    finalX < worldBounds.minX ||
                                    finalX > worldBounds.maxX
                                )
                                    continue;
                                for (let dz = 0; dz < blockDepth; dz++) {
                                    const finalZ = sectionMinZ + dz;
                                    if (
                                        finalZ < worldBounds.minZ ||
                                        finalZ > worldBounds.maxZ
                                    )
                                        continue;

                                    this.processBlock(
                                        editorMap,
                                        blockData.type,
                                        finalX,
                                        finalY,
                                        finalZ
                                    );

                                }
                            }
                        }
                    } else {

                        const [x, y, z] = key.split(",").map(Number);
                        const blockData = blockSource[key];

                        const finalX = x - offsetX + additionalOffsetX;
                        const finalY = y - offsetY; // Bottom of map is now at y=0
                        const finalZ = z - offsetZ + additionalOffsetZ;

                        if (
                            this.isInFinalRegion(
                                finalX,
                                finalY,
                                finalZ,
                                regionWidth,
                                regionHeight,
                                regionDepth
                            )
                        ) {

                            this.processBlock(
                                editorMap,
                                blockData.type,
                                finalX,
                                finalY,
                                finalZ
                            );

                        }
                    }
                }
            }

            const now = Date.now();
            if (this.progressCallback && now - lastProgressUpdate > 250) {
                this.progressCallback(
                    Math.min(((batchIndex + 1) / totalBatches) * 100, 99)
                );
                lastProgressUpdate = now;
            }

            if (batchIndex + 1 < totalBatches) {
                return processBlockBatch(
                    batchSize,
                    batchIndex + 1,
                    totalBatches
                );
            }

            return this.createEditorData(editorMap, worldBounds);
        };

        const batchSize = 50000; // Much larger batch size for better performance
        const totalBatches = Math.ceil(blockCount / batchSize);
        return processBlockBatch(batchSize, 0, totalBatches);
    }

    getBlockSource() {

        if (
            this.worldData.chunks &&
            Array.isArray(this.worldData.chunks) &&
            this.worldData.chunks.length > 0
        ) {
            return this.worldData.chunks;
        }

        if (
            this.worldData.blocks &&
            typeof this.worldData.blocks === "object"
        ) {
            return this.worldData.blocks;
        }

        console.warn("No valid block data found in world data");
        return [];
    }
    getBlockCount(blockSource) {
        if (Array.isArray(blockSource)) {
            return blockSource.length;
        }

        let count = 0;
        for (const key in blockSource) {
            if (key.startsWith("section:")) {
                const [width, height, depth] = key.split(":")[1].split(",");
                count += parseInt(width) * parseInt(height) * parseInt(depth);
            } else {
                count++;
            }
        }
        return count;
    }

    sectionsIntersect(
        minX1,
        minY1,
        minZ1,
        maxX1,
        maxY1,
        maxZ1,
        minX2,
        minY2,
        minZ2,
        maxX2,
        maxY2,
        maxZ2
    ) {
        return !(
            maxX1 < minX2 ||
            minX1 > maxX2 ||
            maxY1 < minY2 ||
            minY1 > maxY2 ||
            maxZ1 < minZ2 ||
            minZ1 > maxZ2
        );
    }

    processBlock(editorMap, mcBlockType, finalX, finalY, finalZ) {

        const editorBlockId = this.getBlockMapping(mcBlockType);
        if (editorBlockId !== null) {

            if (!editorMap[finalY]) editorMap[finalY] = {};
            if (!editorMap[finalY][finalZ]) editorMap[finalY][finalZ] = {};
            editorMap[finalY][finalZ][finalX] = editorBlockId;
        }
    }
    isInFinalRegion(
        finalX,
        finalY,
        finalZ,
        regionWidth,
        regionHeight,
        regionDepth
    ) {

        return (
            finalX >= -Math.floor(regionWidth / 2) &&
            finalX <= regionWidth - Math.floor(regionWidth / 2) - 1 &&
            finalY >= 0 &&
            finalY <= regionHeight - 1 &&
            finalZ >= -Math.floor(regionDepth / 2) &&
            finalZ <= regionDepth - Math.floor(regionDepth / 2) - 1
        );
    }
    isInRegion(x, y, z) {

        const isInSelectedRegion =
            x >= this.selectedRegion.minX &&
            x <= this.selectedRegion.maxX &&
            y >= this.selectedRegion.minY &&
            y <= this.selectedRegion.maxY &&
            z >= this.selectedRegion.minZ &&
            z <= this.selectedRegion.maxZ;
        if (!isInSelectedRegion) return false;


        if (x - this.selectedRegion.minX >= MAX_IMPORT_SIZE_X) return false;

        if (y - this.selectedRegion.minY >= MAX_IMPORT_SIZE_Y) return false;

        if (z - this.selectedRegion.minZ >= MAX_IMPORT_SIZE_Z) return false;
        return true;
    }
    calculateTotalPotentialBlocks() {
        if (!this.selectedRegion) return 0;
        const width = this.selectedRegion.maxX - this.selectedRegion.minX + 1;
        const height = this.selectedRegion.maxY - this.selectedRegion.minY + 1;
        const depth = this.selectedRegion.maxZ - this.selectedRegion.minZ + 1;
        return width * height * depth;
    }
    formatBlockName(mcBlockName) {

        return mcBlockName
            .replace("minecraft:", "")
            .split("_")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
    }

    calculateRegionParameters() {

        const regionWidth = Math.min(
            this.selectedRegion.maxX - this.selectedRegion.minX + 1,
            MAX_IMPORT_SIZE_X
        );
        const regionHeight = Math.min(
            this.selectedRegion.maxY - this.selectedRegion.minY + 1,
            MAX_IMPORT_SIZE_Y
        );
        const regionDepth = Math.min(
            this.selectedRegion.maxZ - this.selectedRegion.minZ + 1,
            MAX_IMPORT_SIZE_Z
        );

        const additionalOffsetX = this.selectedRegion.offsetX || 0;
        const additionalOffsetZ = this.selectedRegion.offsetZ || 0;



        const offsetX = this.selectedRegion.minX + Math.floor(regionWidth / 2);
        const offsetY = this.selectedRegion.minY; // Shift up to make bottom at y=0
        const offsetZ = this.selectedRegion.minZ + Math.floor(regionDepth / 2);
        return {
            offsetX,
            offsetY,
            offsetZ,
            regionWidth,
            regionHeight,
            regionDepth,
            additionalOffsetX,
            additionalOffsetZ,
        };
    }

    getBlockMapping(mcBlockType) {
        const mapping = this.blockMappings[mcBlockType];
        if (!mapping || mapping.action === "skip") {
            return null;
        }
        if (mapping.action === "map") {
            return parseInt(mapping.targetBlockId, 10);
        } else if (mapping.action === "custom" && mapping.customTextureId) {
            return mapping.customTextureId;
        }
        return null;
    }

    createEditorData(editorMap, worldBounds) {

        let processedBlocks = 0;
        const processedBlockTypes = new Set();

        const hytopiaMap = {
            blockTypes: [],
            blocks: {},
        };

        for (const [mcBlockType, mapping] of Object.entries(
            this.blockMappings
        )) {
            if (mapping.action === "skip") continue;
            let blockType;
            if (mapping.action === "map") {

                blockType = getHytopiaBlockById(
                    parseInt(mapping.targetBlockId, 10)
                );
            } else if (mapping.action === "custom") {


                if (mapping.customTextureId) {

                    const customBlockId = mapping.customTextureId;
                    blockType = {
                        id: customBlockId,
                        name: mapping.name || this.formatBlockName(mcBlockType),
                        textureUri:
                            mapping.customTexture || "blocks/unknown.png",
                        isCustom: true,
                    };
                    console.log(
                        `Using existing custom block ID ${customBlockId} for ${mcBlockType}`
                    );
                } else {

                    blockType = {
                        id: generateUniqueBlockId(hytopiaMap.blockTypes),
                        name: mapping.name || this.formatBlockName(mcBlockType),
                        textureUri:
                            mapping.customTexture || "blocks/unknown.png",
                        isCustom: true,
                    };
                    console.log(
                        `Generated new ID ${blockType.id} for custom block ${mcBlockType}`
                    );
                }
            }
            if (blockType) {
                hytopiaMap.blockTypes.push(blockType);
                processedBlockTypes.add(mcBlockType);
            }
        }

        for (const y in editorMap) {
            for (const z in editorMap[y]) {
                for (const x in editorMap[y][z]) {
                    const blockId = editorMap[y][z][x];
                    hytopiaMap.blocks[`${x},${y},${z}`] = blockId;
                    processedBlocks++;
                }
            }
        }

        if (processedBlocks === 0) {

            if (this.progressCallback) {
                this.progressCallback(100);
            }
            return {
                success: false,
                error: "No blocks were imported. Check your block mappings.",
                stats: {
                    processedBlocks: 0,
                    uniqueBlockTypes: [],
                    originalCenter: {
                        x:
                            this.selectedRegion.minX +
                            Math.floor(
                                (this.selectedRegion.maxX -
                                    this.selectedRegion.minX) /
                                    2
                            ),
                        y:
                            this.selectedRegion.minY +
                            Math.floor(
                                (this.selectedRegion.maxY -
                                    this.selectedRegion.minY) /
                                    2
                            ),
                        z:
                            this.selectedRegion.minZ +
                            Math.floor(
                                (this.selectedRegion.maxZ -
                                    this.selectedRegion.minZ) /
                                    2
                            ),
                    },
                    worldBounds,
                },
            };
        }

        if (this.progressCallback) {
            this.progressCallback(100);
        }
        const { offsetX, offsetY, offsetZ, regionHeight } =
            this.calculateRegionParameters();
        return {
            success: true,
            hytopiaMap,
            stats: {
                processedBlocks,
                uniqueBlockTypes: Array.from(processedBlockTypes),
                originalCenter: {
                    x: offsetX,
                    y: offsetY + Math.floor(regionHeight / 2),
                    z: offsetZ,
                },
                worldBounds,
            },
        };
    }
}
