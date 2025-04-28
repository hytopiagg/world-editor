/**
 * TerrainGenerator.js - Hytopia terrain generation utility
 *
 * This utility handles the generation of Hytopia terrain with biomes,
 * caves, rivers, lakes, and ore distribution based on a seed value.
 */
import {
    generatePerlinNoise,
    generatePerlinNoise3D,
} from "./PerlinNoiseGenerator";
/**
 * Generates a Hytopia world from a seed
 * @param {Object} settings - Generation settings
 * @param {number} seedNum - The numeric seed value
 * @param {Object} blockTypes - Map of block types to IDs
 * @param {Function} progressCallback - Optional callback for progress updates
 * @returns {Object} The generated terrain data
 */
export function generateHytopiaWorld(
    settings,
    seedNum,
    blockTypes,
    progressCallback = null
) {
    console.log("Starting world generation with block types:", blockTypes);
    const updateProgress = (message, progress) => {
        console.log(message);
        if (progressCallback) {
            progressCallback(message, progress);
        }
    };
    updateProgress("Starting seed-based world generation...", 0);

    const worldSettings = {
        ...settings,
        maxHeight: 64,

    };
    console.log(`Using sea level: ${worldSettings.seaLevel}`);

    updateProgress("Generating heightmap...", 5);

    const continentalNoise = generatePerlinNoise(
        settings.width,
        settings.length,
        {
            octaveCount: 1,
            scale: settings.scale * 0.5,
            persistence: 0.5,
            amplitude: 1.0,
            seed: seedNum,
        }
    );
    const hillNoise = generatePerlinNoise(settings.width, settings.length, {
        octaveCount: 3,
        scale: settings.scale * 2,
        persistence: 0.5,
        amplitude: 0.5,
        seed: seedNum + 1,
    });
    const detailNoise = generatePerlinNoise(settings.width, settings.length, {
        octaveCount: 5,
        scale: settings.scale * 4,
        persistence: 0.5,
        amplitude: 0.2,
        seed: seedNum + 2,
    });

    const rockNoise = generatePerlinNoise(settings.width, settings.length, {
        octaveCount: 4,
        scale: settings.scale * 3,
        persistence: 0.6,
        amplitude: 0.4,
        seed: seedNum + 10,
    });
    const depthMap = generatePerlinNoise(settings.width, settings.length, {
        octaveCount: 2,
        scale: 0.02,
        persistence: 0.5,
        amplitude: 1.0,
        seed: seedNum + 6,
    });

    const heightMap = new Float32Array(settings.width * settings.length);

    if (settings.isCompletelyFlat) {
        const flatHeight = 0.25; // 25% of max height
        for (let i = 0; i < heightMap.length; i++) {
            heightMap[i] = flatHeight;
        }
        console.log("Generating completely flat terrain");
    } else {

        for (let i = 0; i < heightMap.length; i++) {

            let baseTerrain = continentalNoise[i];

            const hillInfluence =
                hillNoise[i] * (1.0 - settings.flatnessFactor);

            const detailInfluence =
                detailNoise[i] * (1.0 - settings.flatnessFactor) * 0.5;

            const depthInfluence =
                depthMap[i] * (1.0 - settings.flatnessFactor) * 0.3;

            const noiseValue =
                (baseTerrain + hillInfluence + detailInfluence) *
                (1.0 + depthInfluence);

            heightMap[i] =
                noiseValue * (1.0 - settings.flatnessFactor) +
                0.5 * settings.flatnessFactor;
        }
    }

    updateProgress("Smoothing heightmap...", 10);
    const smoothedHeightMap = new Float32Array(
        settings.width * settings.length
    );
    const radius = Math.floor(2 + settings.terrainBlend * 2);
    for (let z = 0; z < settings.length; z++) {
        for (let x = 0; x < settings.width; x++) {
            let total = 0;
            let count = 0;

            for (let dz = -radius; dz <= radius; dz++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const nx = x + dx;
                    const nz = z + dz;
                    if (
                        nx >= 0 &&
                        nx < settings.width &&
                        nz >= 0 &&
                        nz < settings.length
                    ) {

                        const distance = Math.sqrt(dx * dx + dz * dz);
                        const weight = 1 / (1 + distance);
                        total += heightMap[nz * settings.width + nx] * weight;
                        count += weight;
                    }
                }
            }
            smoothedHeightMap[z * settings.width + x] =
                (total / count) * settings.smoothing +
                heightMap[z * settings.width + x] * (1 - settings.smoothing);
        }
    }

    updateProgress("Applying erosion...", 15);
    const erodedHeightMap = new Float32Array(settings.width * settings.length);
    for (let z = 0; z < settings.length; z++) {
        for (let x = 0; x < settings.width; x++) {
            const index = z * settings.width + x;

            if (settings.isCompletelyFlat) {

                erodedHeightMap[index] = heightMap[index];
                continue;
            }
            let height = Math.floor(
                36 + smoothedHeightMap[index] * 28 * settings.roughness
            );

            for (let dz = -1; dz <= 1; dz++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const nz = z + dz;
                    if (
                        nx >= 0 &&
                        nx < settings.width &&
                        nz >= 0 &&
                        nz < settings.length
                    ) {
                        const neighborHeight = Math.floor(
                            36 +
                                smoothedHeightMap[nz * settings.width + nx] *
                                    28 *
                                    settings.roughness
                        );

                        if (neighborHeight < height - 1) {
                            height = Math.max(height - 1, neighborHeight + 1);
                        }
                    }
                }
            }
            erodedHeightMap[index] = (height - 36) / 28 / settings.roughness;
        }
    }

    updateProgress("Generating climate maps and biomes...", 20);


    const finalHeightMap = settings.isCompletelyFlat
        ? heightMap
        : erodedHeightMap;

    const tempMap = generatePerlinNoise(settings.width, settings.length, {
        octaveCount: 1,
        scale: 0.005,
        persistence: 0.5,
        amplitude: 1.0,
        seed: seedNum + 7,
    });

    const temperatureOffset = (settings.temperature || 0.5) - 0.5; // Convert 0-1 to -0.5 to 0.5
    const humidityMap = generatePerlinNoise(settings.width, settings.length, {
        octaveCount: 1,
        scale: 0.005,
        persistence: 0.5,
        amplitude: 1.0,
        seed: seedNum + 8,
    });

    const riverNoise = generatePerlinNoise(settings.width, settings.length, {
        octaveCount: 1,
        scale: 0.01 + (settings.riverFreq || 0.05),
        persistence: 0.5,
        amplitude: 1.0,
        seed: seedNum + 5,
    });

    const lakeNoise = generatePerlinNoise(settings.width, settings.length, {
        octaveCount: 1,
        scale: 0.02,
        persistence: 0.5,
        amplitude: 1.0,
        seed: seedNum + 9,
    });

    const smoothedLakeNoise = new Float32Array(lakeNoise.length);
    const lakeRadius = 2; // Smoothing radius
    for (let z = 0; z < settings.length; z++) {
        for (let x = 0; x < settings.width; x++) {
            let total = 0;
            let count = 0;

            for (let dz = -lakeRadius; dz <= lakeRadius; dz++) {
                for (let dx = -lakeRadius; dx <= lakeRadius; dx++) {
                    const nx = x + dx;
                    const nz = z + dz;
                    if (
                        nx >= 0 &&
                        nx < settings.width &&
                        nz >= 0 &&
                        nz < settings.length
                    ) {

                        const distance = Math.sqrt(dx * dx + dz * dz);
                        const weight = 1 / (1 + distance);
                        total += lakeNoise[nz * settings.width + nx] * weight;
                        count += weight;
                    }
                }
            }
            smoothedLakeNoise[z * settings.width + x] = total / count;
        }
    }

    const biomeMap = new Array(settings.width * settings.length);
    for (let z = 0; z < settings.length; z++) {
        for (let x = 0; x < settings.width; x++) {
            const index = z * settings.width + x;
            const temp = tempMap[index] + temperatureOffset; // Apply temperature offset
            const humidity = humidityMap[index];

            if (temp < 0.2) {

                if (humidity < 0.3) biomeMap[index] = "snowy_plains";
                else if (humidity < 0.6) biomeMap[index] = "snowy_forest";
                else biomeMap[index] = "snowy_taiga";
            } else if (temp < 0.4) {

                if (humidity < 0.3) biomeMap[index] = "plains";
                else if (humidity < 0.6) biomeMap[index] = "forest";
                else biomeMap[index] = "taiga";
            } else if (temp < 0.6) {

                if (humidity < 0.3) biomeMap[index] = "plains";
                else if (humidity < 0.6) biomeMap[index] = "forest";
                else biomeMap[index] = "swamp";
            } else if (temp < 0.8) {

                if (humidity < 0.3) biomeMap[index] = "savanna";
                else if (humidity < 0.6) biomeMap[index] = "jungle";
                else biomeMap[index] = "swamp";
            } else {

                if (humidity < 0.3) biomeMap[index] = "desert";
                else if (humidity < 0.6) biomeMap[index] = "savanna";
                else biomeMap[index] = "jungle";
            }
        }
    }

    updateProgress("Building terrain layers...", 25);

    const startX = -Math.floor(settings.width / 2);
    const startZ = -Math.floor(settings.length / 2);

    const densityField = generate3DDensityField(
        settings.width,
        settings.maxHeight,
        settings.length,
        worldSettings,
        seedNum,
        biomeMap,
        finalHeightMap,
        settings.isCompletelyFlat
    );

    updateProgress("Building world from density field...", 45);
    const terrainData = {};
    let blocksCount = 0;

    for (let z = 0; z < settings.length; z++) {
        for (let x = 0; x < settings.width; x++) {
            const worldX = startX + x;
            const worldZ = startZ + z;
            const biomeIndex = z * settings.width + x;
            const biome = biomeMap[biomeIndex];

            console.log("Adding lava bedrock layer at y=0");
            terrainData[`${worldX},0,${worldZ}`] = blockTypes.lava; // Use lava for the bottom layer
            blocksCount++;

            let surfaceHeight = 0;
            for (let y = settings.maxHeight - 1; y > 0; y--) {
                const index =
                    z * settings.width * settings.maxHeight +
                    y * settings.width +
                    x;
                const aboveIndex =
                    z * settings.width * settings.maxHeight +
                    (y + 1) * settings.width +
                    x;

                if (
                    densityField[index] >= 0 &&
                    (y === settings.maxHeight - 1 ||
                        densityField[aboveIndex] < 0)
                ) {
                    surfaceHeight = y;
                    break;
                }
            }

            for (let y = 1; y < settings.maxHeight; y++) {
                const index =
                    z * settings.width * settings.maxHeight +
                    y * settings.width +
                    x;
                if (densityField[index] >= 0) {


                    if (y === 0) {

                        continue;
                    } else if (y < surfaceHeight - 3) {
                        terrainData[`${worldX},${y},${worldZ}`] =
                            blockTypes.stone; // Deep terrain
                    } else if (y < surfaceHeight) {

                        if (biome === "desert" || biome === "savanna") {
                            terrainData[`${worldX},${y},${worldZ}`] =
                                blockTypes.sand;
                        } else if (
                            biome === "snowy_plains" ||
                            biome === "snowy_forest" ||
                            biome === "snowy_taiga"
                        ) {
                            terrainData[`${worldX},${y},${worldZ}`] =
                                blockTypes.snow;
                        } else if (
                            biome === "ocean" &&
                            y < worldSettings.seaLevel
                        ) {
                            terrainData[`${worldX},${y},${worldZ}`] =
                                blockTypes.gravel; // Underwater surface
                        } else {

                            const rockValue = rockNoise[z * settings.width + x];
                            if (rockValue > 0.8) {
                                terrainData[`${worldX},${y},${worldZ}`] =
                                    blockTypes.cobblestone;
                            } else {
                                terrainData[`${worldX},${y},${worldZ}`] =
                                    blockTypes.dirt;
                            }
                        }
                    } else {

                        if (biome === "desert" || biome === "savanna") {
                            terrainData[`${worldX},${y},${worldZ}`] =
                                blockTypes.sand;
                        } else if (
                            biome === "snowy_plains" ||
                            biome === "snowy_forest" ||
                            biome === "snowy_taiga"
                        ) {
                            terrainData[`${worldX},${y},${worldZ}`] =
                                blockTypes.snow;
                        } else if (
                            biome === "ocean" &&
                            y < worldSettings.seaLevel
                        ) {
                            terrainData[`${worldX},${y},${worldZ}`] =
                                blockTypes.gravel; // Underwater surface
                        } else {

                            const rockValue = rockNoise[z * settings.width + x];
                            if (rockValue > 0.8) {
                                terrainData[`${worldX},${y},${worldZ}`] =
                                    blockTypes.cobblestone;
                            } else {
                                terrainData[`${worldX},${y},${worldZ}`] =
                                    blockTypes.grass;
                            }
                        }
                    }
                    blocksCount++;
                }
            }
        }

        if (z % Math.ceil(settings.length / 10) === 0) {
            const progress = Math.floor(45 + (z / settings.length) * 15);
            updateProgress(
                `Building terrain: ${Math.floor((z / settings.length) * 100)}% complete`,
                progress
            );
        }
    }

    updateProgress("Creating natural water bodies...", 65);

    const waterMap = {};
    const surfaceHeightMap = {};
    const waterBedHeightMap = {}; // Track water bed heights for cleanup

    for (let z = 0; z < settings.length; z++) {
        for (let x = 0; x < settings.width; x++) {
            const worldX = startX + x;
            const worldZ = startZ + z;
            const index = z * settings.width + x;
            const biome = biomeMap[index];

            let surfaceHeight = 0;
            for (let y = settings.maxHeight - 1; y > 0; y--) {
                const key = `${worldX},${y},${worldZ}`;
                if (
                    terrainData[key] &&
                    terrainData[key] !== blockTypes["water-still"]
                ) {
                    surfaceHeight = y;
                    break;
                }
            }

            const key = `${worldX},${worldZ}`;
            surfaceHeightMap[key] = surfaceHeight;

            waterMap[key] = biome === "ocean";
        }
    }

    for (let z = 1; z < settings.length - 1; z++) {
        for (let x = 1; x < settings.width - 1; x++) {
            const worldX = startX + x;
            const worldZ = startZ + z;
            const key = `${worldX},${worldZ}`;
            const height = surfaceHeightMap[key];
            const index = z * settings.width + x;

            if (waterMap[key] || height > worldSettings.seaLevel) continue;

            const lakeValue = smoothedLakeNoise[index];

            if (lakeValue > 0.7 && height < worldSettings.seaLevel - 1) {
                waterMap[key] = true;
                continue;
            }

            let isDepression = true;
            let lowestNeighborHeight = Infinity;

            for (let dz = -1; dz <= 1; dz++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dz === 0) continue;
                    const nx = worldX + dx;
                    const nz = worldZ + dz;
                    const nKey = `${nx},${nz}`;

                    if (!surfaceHeightMap[nKey]) continue;
                    const neighborHeight = surfaceHeightMap[nKey];

                    if (neighborHeight < height) {
                        isDepression = false;
                    }

                    if (neighborHeight < lowestNeighborHeight) {
                        lowestNeighborHeight = neighborHeight;
                    }
                }
            }

            if (isDepression && height < worldSettings.seaLevel) {
                waterMap[key] = true;
            }

            else if (height < worldSettings.seaLevel - 2) {
                let higherNeighbors = 0;
                for (let dz = -1; dz <= 1; dz++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dz === 0) continue;
                        const nx = worldX + dx;
                        const nz = worldZ + dz;
                        const nKey = `${nx},${nz}`;

                        if (!surfaceHeightMap[nKey]) continue;

                        if (surfaceHeightMap[nKey] >= height + 2) {
                            higherNeighbors++;
                        }
                    }
                }

                if (higherNeighbors >= 5) {
                    waterMap[key] = true;
                }
            }
        }
    }

    for (let i = 0; i < 3; i++) {

        const newWaterMap = { ...waterMap };
        for (let z = 1; z < settings.length - 1; z++) {
            for (let x = 1; x < settings.width - 1; x++) {
                const worldX = startX + x;
                const worldZ = startZ + z;
                const key = `${worldX},${worldZ}`;
                const height = surfaceHeightMap[key];

                if (waterMap[key] || height > worldSettings.seaLevel) continue;

                let adjacentToWater = false;
                for (let dz = -1; dz <= 1; dz++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dz === 0) continue;
                        const nx = worldX + dx;
                        const nz = worldZ + dz;
                        const nKey = `${nx},${nz}`;
                        if (waterMap[nKey]) {
                            adjacentToWater = true;
                            break;
                        }
                    }
                    if (adjacentToWater) break;
                }

                if (adjacentToWater && height <= worldSettings.seaLevel) {
                    newWaterMap[key] = true;
                }
            }
        }

        Object.assign(waterMap, newWaterMap);
    }

    for (let z = 0; z < settings.length; z++) {
        for (let x = 0; x < settings.width; x++) {
            const worldX = startX + x;
            const worldZ = startZ + z;
            const key = `${worldX},${worldZ}`;
            const surfaceHeight = surfaceHeightMap[key];
            const biome = biomeMap[z * settings.width + x];

            if (waterMap[key] && surfaceHeight < worldSettings.seaLevel) {


                let waterBedHeight = surfaceHeight;

                let totalHeight = surfaceHeight;
                let countNeighbors = 1; // Include this cell
                for (let dz = -1; dz <= 1; dz++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dz === 0) continue;
                        const nx = worldX + dx;
                        const nz = worldZ + dz;
                        const nKey = `${nx},${nz}`;
                        if (surfaceHeightMap[nKey] !== undefined) {
                            totalHeight += surfaceHeightMap[nKey];
                            countNeighbors++;
                        }
                    }
                }

                const smoothedHeight = Math.floor(totalHeight / countNeighbors);
                waterBedHeight = Math.max(surfaceHeight - 2, smoothedHeight);

                waterBedHeightMap[key] = waterBedHeight;

                for (
                    let y = waterBedHeight + 1;
                    y <= worldSettings.seaLevel;
                    y++
                ) {
                    terrainData[`${worldX},${y},${worldZ}`] =
                        blockTypes["water-still"];
                    blocksCount++;
                }

                const waterDepth = worldSettings.seaLevel - waterBedHeight;
                if (waterDepth > 3) {

                    terrainData[`${worldX},${waterBedHeight},${worldZ}`] =
                        Math.random() < 0.6
                            ? blockTypes.gravel
                            : blockTypes.clay;
                } else {

                    terrainData[`${worldX},${waterBedHeight},${worldZ}`] =
                        blockTypes.sand;
                }

                for (let y = waterBedHeight + 1; y <= surfaceHeight; y++) {
                    delete terrainData[`${worldX},${y},${worldZ}`];
                }
            }

            if (!waterMap[key]) {

                let adjacentToWater = false;
                for (let dz = -1; dz <= 1; dz++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dz === 0) continue;
                        const nx = worldX + dx;
                        const nz = worldZ + dz;
                        const nKey = `${nx},${nz}`;
                        if (waterMap[nKey]) {
                            adjacentToWater = true;
                            break;
                        }
                    }
                    if (adjacentToWater) break;
                }

                if (
                    adjacentToWater &&
                    surfaceHeight >= worldSettings.seaLevel - 2 &&
                    surfaceHeight <= worldSettings.seaLevel + 1
                ) {

                    terrainData[`${worldX},${surfaceHeight},${worldZ}`] =
                        Math.random() < 0.7
                            ? blockTypes.sand
                            : blockTypes["sand-light"];

                    if (Math.random() < 0.5 && surfaceHeight > 1) {
                        terrainData[
                            `${worldX},${surfaceHeight - 1},${worldZ}`
                        ] = blockTypes.sand;
                    }
                }
            }
        }
    }

    if (riverNoise) {

        for (let z = 0; z < settings.length; z++) {
            for (let x = 0; x < settings.width; x++) {
                const worldX = startX + x;
                const worldZ = startZ + z;
                const key = `${worldX},${worldZ}`;
                const index = z * settings.width + x;

                if (waterMap[key]) continue;

                const riverVal = riverNoise[index];
                if (riverVal > 0.47 && riverVal < 0.53) {
                    const height = surfaceHeightMap[key];

                    if (height <= worldSettings.seaLevel + 4) {


                        const riverDepth = Math.min(
                            2,
                            Math.max(
                                1,
                                Math.floor(
                                    (height - worldSettings.seaLevel) * 0.3
                                ) + 1
                            )
                        );
                        const waterHeight = Math.max(
                            height - riverDepth,
                            Math.min(worldSettings.seaLevel, height - 1)
                        );

                        if (waterHeight > 0 && waterHeight < height) {

                            for (let y = waterHeight; y <= height; y++) {

                                if (y >= height - 2) {
                                    delete terrainData[
                                        `${worldX},${y},${worldZ}`
                                    ];
                                }
                            }

                            if (waterHeight <= worldSettings.seaLevel) {
                                terrainData[
                                    `${worldX},${waterHeight},${worldZ}`
                                ] = blockTypes["water-still"];
                                blocksCount++;

                                waterMap[key] = true;
                                waterBedHeightMap[key] = waterHeight;
                            }

                            for (let dx = -1; dx <= 1; dx++) {
                                for (let dz = -1; dz <= 1; dz++) {
                                    if (dx === 0 && dz === 0) continue;
                                    const nx = worldX + dx;
                                    const nz = worldZ + dz;
                                    const nKey = `${nx},${nz}`;

                                    if (waterMap[nKey]) continue;
                                    const bankHeight = surfaceHeightMap[nKey];
                                    if (
                                        bankHeight > 0 &&
                                        bankHeight <= waterHeight + 2
                                    ) {

                                        terrainData[
                                            `${nx},${bankHeight},${nz}`
                                        ] =
                                            Math.random() < 0.6
                                                ? blockTypes.sand
                                                : blockTypes.dirt;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    updateProgress("Preparing cave systems...", 75);
    const smallCaveNoise = generatePerlinNoise3D(
        settings.width,
        settings.maxHeight,
        settings.length,
        {
            octaveCount: 2,
            scale: 0.03,
            persistence: 0.5,
            amplitude: 1.0,
            seed: seedNum + 2,
        }
    );
    const largeCaveNoise = generatePerlinNoise3D(
        settings.width,
        settings.maxHeight,
        settings.length,
        {
            octaveCount: 2,
            scale: 0.06,
            persistence: 0.5,
            amplitude: 1.0,
            seed: seedNum + 3,
        }
    );

    const oreNoise = generatePerlinNoise3D(
        settings.width,
        settings.maxHeight,
        settings.length,
        {
            octaveCount: 1,
            scale: 0.04,
            persistence: 0.5,
            amplitude: 1.0,
            seed: seedNum + 4,
        }
    );

    updateProgress("Carving cave systems...", 80);
    for (let z = 0; z < settings.length; z++) {
        for (let x = 0; x < settings.width; x++) {
            const worldX = startX + x;
            const worldZ = startZ + z;
            const key = `${worldX},${worldZ}`;

            const surfaceHeight = surfaceHeightMap[key] || 0;

            for (
                let y = Math.min(surfaceHeight - 2, settings.maxHeight - 3);
                y > 1;
                y--
            ) {
                const blockKey = `${worldX},${y},${worldZ}`;

                if (
                    !terrainData[blockKey] ||
                    terrainData[blockKey] !== blockTypes.stone
                )
                    continue;

                const index =
                    z * settings.width * settings.maxHeight +
                    y * settings.width +
                    x;
                const smallCaveValue = smallCaveNoise[index];
                const largeCaveValue = largeCaveNoise[index];

                if (
                    (smallCaveValue > 0.6 && largeCaveValue > 0.5) ||
                    smallCaveValue > 0.7 ||
                    largeCaveValue > 0.65
                ) {
                    delete terrainData[blockKey]; // Remove block to create cave
                }

                else if (terrainData[blockKey] === blockTypes.stone) {
                    const oreValue = oreNoise[index];
                    const oreRarity = settings.oreRarity || 0.78; // Default if not specified

                    if (settings.generateOres !== false) {
                        if (oreValue > oreRarity + 0.12 && y <= 40) {
                            terrainData[blockKey] = blockTypes.coal;
                        } else if (oreValue > oreRarity + 0.07 && y <= 35) {
                            terrainData[blockKey] = blockTypes.iron;
                        } else if (oreValue > oreRarity + 0.04 && y <= 20) {
                            terrainData[blockKey] = blockTypes.gold;
                        } else if (
                            oreValue > oreRarity + 0.02 &&
                            y <= 30 &&
                            Math.random() < 0.3
                        ) {
                            terrainData[blockKey] = blockTypes.emerald;
                        } else if (oreValue > oreRarity && y <= 15) {
                            terrainData[blockKey] = blockTypes.diamond;
                        }
                    }
                }
            }
        }

        if (z % Math.ceil(settings.length / 10) === 0) {
            const progress = Math.floor(80 + (z / settings.length) * 5);
            updateProgress(
                `Generating caves and ores: ${Math.floor((z / settings.length) * 100)}% complete`,
                progress
            );
        }
    }

    updateProgress("Smoothing underwater terrain...", 88);

    for (let z = 0; z < settings.length; z++) {
        for (let x = 0; x < settings.width; x++) {
            const worldX = startX + x;
            const worldZ = startZ + z;
            const key = `${worldX},${worldZ}`;

            if (!waterMap[key] || !waterBedHeightMap[key]) continue;
            const waterBedHeight = waterBedHeightMap[key];

            for (let y = waterBedHeight - 1; y > 0; y--) {

                const currentBlockKey = `${worldX},${y},${worldZ}`;

                if (!terrainData[currentBlockKey]) continue;

                let adjacentBlocks = 0;
                let adjacentWater = 0;
                for (let dz = -1; dz <= 1; dz++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dz === 0) continue;
                        const nx = worldX + dx;
                        const nz = worldZ + dz;
                        const nKey = `${nx},${nz}`;
                        const neighborBlockKey = `${nx},${y},${nz}`;

                        if (terrainData[neighborBlockKey]) {
                            adjacentBlocks++;
                        }

                        if (waterMap[nKey]) {
                            adjacentWater++;
                        }
                    }
                }


                const heightFactor = (y - 1) / waterBedHeight; // 0 near bottom, close to 1 near waterbed
                const threshold = Math.floor(2 + 3 * heightFactor); // 2-5 based on depth
                if (adjacentBlocks <= threshold && adjacentWater >= 4) {
                    delete terrainData[currentBlockKey];
                }
            }
        }
    }

    updateProgress("Adding biome-specific features...", 90);

    if (settings.mountainRange && settings.mountainRange.enabled) {
        updateProgress(
            "Creating snow-capped mountain ranges along world borders...",
            92
        );


        const sizeAdjustmentFactor = Math.max(
            0.05,
            1.0 - settings.mountainRange.size * 4.0
        );


        const mountainBaseHeight =
            settings.mountainRange.height *
            2 *
            (1 + sizeAdjustmentFactor * 0.5);
        const snowHeight = settings.mountainRange.snowHeight * 1.5; // Adjust snow line accordingly


        const mountainWidth = Math.max(
            5,
            Math.floor(settings.width * 0.25 * sizeAdjustmentFactor)
        );
        console.log(
            `Generating mountain ranges around all borders: width ${mountainWidth}, height ${mountainBaseHeight}, snow at ${snowHeight}, size adjustment ${sizeAdjustmentFactor}`
        );

        for (let z = 0; z < settings.length; z++) {
            for (let x = 0; x < settings.width; x++) {
                const worldX = startX + x;
                const worldZ = startZ + z;

                const distFromWest = x;
                const distFromEast = settings.width - x - 1;
                const distFromNorth = z;
                const distFromSouth = settings.length - z - 1;

                const distFromEdge = Math.min(
                    distFromWest,
                    distFromEast,
                    distFromNorth,
                    distFromSouth
                );

                if (distFromEdge > mountainWidth) continue;

                const isNearWest = distFromWest <= mountainWidth;
                const isNearEast = distFromEast <= mountainWidth;
                const isNearNorth = distFromNorth <= mountainWidth;
                const isNearSouth = distFromSouth <= mountainWidth;


                let heightFactor = Math.cos(
                    (distFromEdge / mountainWidth) * (Math.PI * 0.5)
                );

                let cornerBoost = 0;

                if (
                    (isNearWest && isNearNorth) ||
                    (isNearWest && isNearSouth) ||
                    (isNearEast && isNearNorth) ||
                    (isNearEast && isNearSouth)
                ) {

                    let edgeDist1, edgeDist2;
                    if (isNearWest && isNearNorth) {
                        edgeDist1 = distFromWest;
                        edgeDist2 = distFromNorth;
                    } else if (isNearWest && isNearSouth) {
                        edgeDist1 = distFromWest;
                        edgeDist2 = distFromSouth;
                    } else if (isNearEast && isNearNorth) {
                        edgeDist1 = distFromEast;
                        edgeDist2 = distFromNorth;
                    } else {
                        edgeDist1 = distFromEast;
                        edgeDist2 = distFromSouth;
                    }

                    const cornerFactor =
                        (1.0 - edgeDist1 / mountainWidth) *
                        (1.0 - edgeDist2 / mountainWidth);
                    cornerBoost = cornerFactor * 0.4; // Boost corner height
                }

                const baseHeight = Math.floor(
                    mountainBaseHeight * (heightFactor + cornerBoost)
                );

                let terrainVariationFactor;
                if (
                    isNearWest &&
                    distFromWest <= distFromNorth &&
                    distFromWest <= distFromSouth
                ) {

                    terrainVariationFactor = z / settings.length;
                } else if (
                    isNearEast &&
                    distFromEast <= distFromNorth &&
                    distFromEast <= distFromSouth
                ) {

                    terrainVariationFactor = z / settings.length;
                } else if (
                    isNearNorth &&
                    distFromNorth <= distFromWest &&
                    distFromNorth <= distFromEast
                ) {

                    terrainVariationFactor = x / settings.width;
                } else {

                    terrainVariationFactor = x / settings.width;
                }


                const ridgeFactor = Math.cos(x * 0.2) * Math.sin(z * 0.15) * 6;

                const edgeVariation =
                    Math.sin(terrainVariationFactor * Math.PI * 4) * 5;

                const localMountainHeight = Math.floor(
                    baseHeight + ridgeFactor + edgeVariation
                );

                const noise1 = Math.sin(x * 0.8) * Math.cos(z * 0.8) * 2;
                const noise2 = Math.cos(x * 0.3 + z * 0.2) * 2;
                const noiseOffset = noise1 + noise2;
                const finalHeight = Math.max(
                    1,
                    Math.floor(localMountainHeight + noiseOffset)
                );

                const key = `${worldX},${worldZ}`;
                const currentHeight = surfaceHeightMap[key] || 0;

                if (finalHeight <= 0 || currentHeight >= finalHeight) continue;

                for (let y = currentHeight + 1; y <= finalHeight; y++) {


                    if (settings.mountainRange.snowCap) {

                        if (y === finalHeight && y >= snowHeight - 5) {
                            terrainData[`${worldX},${y},${worldZ}`] =
                                blockTypes.snow;
                        }

                        else if (
                            y >= snowHeight - 3 &&
                            y >= finalHeight - 2 &&
                            Math.random() < 0.7
                        ) {
                            terrainData[`${worldX},${y},${worldZ}`] =
                                blockTypes.snow;
                        }

                        else if (y >= snowHeight - 8 && Math.random() < 0.3) {
                            terrainData[`${worldX},${y},${worldZ}`] =
                                blockTypes.snow;
                        }

                        else {
                            terrainData[`${worldX},${y},${worldZ}`] =
                                blockTypes.stone;
                        }
                    } else {
                        terrainData[`${worldX},${y},${worldZ}`] =
                            blockTypes.stone;
                    }
                    blocksCount++;
                }

                surfaceHeightMap[key] = finalHeight;
            }
        }
    }

    const treeOffsetX = Math.floor(Math.random() * 5);
    const treeOffsetZ = Math.floor(Math.random() * 5);

    updateProgress("Adding trees and vegetation...", 85);


    const cactusOffsetX = Math.floor(Math.random() * 7);
    const cactusOffsetZ = Math.floor(Math.random() * 7);
    for (let z = 0; z < settings.length; z++) {
        for (let x = 0; x < settings.width; x++) {
            const worldX = startX + x;
            const worldZ = startZ + z;
            const biomeIndex = z * settings.width + x;
            const biome = biomeMap[biomeIndex];

            let surfaceHeight = 0;
            for (let y = settings.maxHeight - 1; y >= 0; y--) {
                if (
                    terrainData[`${worldX},${y},${worldZ}`] &&
                    terrainData[`${worldX},${y},${worldZ}`] !==
                        blockTypes["water-still"]
                ) {
                    surfaceHeight = y;
                    break;
                }
            }

            const surfaceBlock =
                terrainData[`${worldX},${surfaceHeight},${worldZ}`];
            if (
                biome === "desert" &&
                surfaceHeight > 0 &&
                (surfaceBlock === blockTypes.sand ||
                    surfaceBlock === blockTypes["sand-light"])
            ) {

                if (
                    (x + cactusOffsetX) % 7 === 0 &&
                    (z + cactusOffsetZ) % 7 === 0
                ) {

                    const noiseValue = Math.random();
                    const temp = tempMap[biomeIndex] + temperatureOffset;

                    let cactusProbability = 0.2; // Base probability
                    if (temp > 0.8) {
                        cactusProbability = 0.35; // Higher chance in very hot areas
                    } else if (temp > 0.7) {
                        cactusProbability = 0.3; // Medium-high chance in hot areas
                    } else if (temp > 0.6) {
                        cactusProbability = 0.25; // Medium chance in warm areas
                    }

                    if (noiseValue < cactusProbability) {
                        const cactusHeight = 3 + Math.floor(Math.random() * 2); // Cactus height

                        let canPlaceCactus = true;
                        for (let ty = 1; ty <= cactusHeight; ty++) {
                            if (
                                terrainData[
                                    `${worldX},${surfaceHeight + ty},${worldZ}`
                                ]
                            ) {
                                canPlaceCactus = false;
                                break;
                            }
                        }
                        if (canPlaceCactus) {

                            for (let ty = 1; ty <= cactusHeight; ty++) {
                                terrainData[
                                    `${worldX},${surfaceHeight + ty},${worldZ}`
                                ] = blockTypes.cactus;
                                blocksCount++;
                            }
                        }
                    }
                }
            }
        }
    }

    for (let z = 0; z < settings.length; z++) {
        for (let x = 0; x < settings.width; x++) {
            const worldX = startX + x;
            const worldZ = startZ + z;
            const biomeIndex = z * settings.width + x;
            const biome = biomeMap[biomeIndex];

            let surfaceHeight = 0;
            for (let y = settings.maxHeight - 1; y >= 0; y--) {
                if (
                    terrainData[`${worldX},${y},${worldZ}`] &&
                    terrainData[`${worldX},${y},${worldZ}`] !==
                        blockTypes["water-still"]
                ) {
                    surfaceHeight = y;
                    break;
                }
            }

            if (biome === "desert") continue;

            if ((x + treeOffsetX) % 5 === 0 && (z + treeOffsetZ) % 5 === 0) {

                const surfaceBlock =
                    terrainData[`${worldX},${surfaceHeight},${worldZ}`];
                if (
                    surfaceBlock === blockTypes.sand ||
                    surfaceBlock === blockTypes["sand-light"]
                ) {
                    continue;
                }

                let treeProbability = 0.1; // Default low probability
                if (biome === "forest" || biome === "taiga") {
                    treeProbability = 0.3; // Higher probability in forests
                } else if (biome === "plains" || biome === "savanna") {
                    treeProbability = 0.15; // Medium probability in plains
                } else if (
                    biome === "snowy_forest" ||
                    biome === "snowy_taiga"
                ) {
                    treeProbability = 0.25; // Medium-high probability in snowy forests
                }
                if (Math.random() < treeProbability) {

                    let treeHeight = 4 + Math.floor(Math.random() * 2); // Default height
                    if (biome === "savanna") {
                        treeHeight = 5 + Math.floor(Math.random() * 2); // Taller trees in savanna
                    } else if (
                        biome === "snowy_plains" ||
                        biome === "snowy_forest" ||
                        biome === "snowy_taiga"
                    ) {
                        treeHeight = 3 + Math.floor(Math.random() * 2); // Shorter trees in snowy biomes
                    }

                    let canPlaceTree = true;
                    for (let ty = 1; ty <= treeHeight + 2; ty++) {
                        if (
                            terrainData[
                                `${worldX},${surfaceHeight + ty},${worldZ}`
                            ]
                        ) {
                            canPlaceTree = false;
                            break;
                        }
                    }
                    if (canPlaceTree) {

                        const logType =
                            biome === "snowy_plains" ||
                            biome === "snowy_forest" ||
                            biome === "snowy_taiga"
                                ? blockTypes["poplar log"]
                                : biome === "desert"
                                  ? blockTypes.cactus
                                  : blockTypes.log;
                        for (let ty = 1; ty <= treeHeight; ty++) {
                            terrainData[
                                `${worldX},${surfaceHeight + ty},${worldZ}`
                            ] = logType;
                            blocksCount++;
                        }

                        if (biome !== "desert") {


                            let leafRadius = 2;
                            if (biome === "savanna") {
                                leafRadius = 3; // Wider canopy for savanna
                            } else if (
                                biome === "snowy_plains" ||
                                biome === "snowy_forest" ||
                                biome === "snowy_taiga"
                            ) {
                                leafRadius = 2; // Standard canopy for snowy trees
                            }
                            for (
                                let ly = treeHeight - 1;
                                ly <= treeHeight + 1;
                                ly++
                            ) {
                                const layerRadius =
                                    ly === treeHeight
                                        ? leafRadius
                                        : leafRadius - 1;
                                for (
                                    let lx = -layerRadius;
                                    lx <= layerRadius;
                                    lx++
                                ) {
                                    for (
                                        let lz = -layerRadius;
                                        lz <= layerRadius;
                                        lz++
                                    ) {

                                        if (
                                            lx === 0 &&
                                            lz === 0 &&
                                            ly < treeHeight
                                        )
                                            continue;

                                        const dist = Math.sqrt(
                                            lx * lx +
                                                lz * lz +
                                                (ly - treeHeight) *
                                                    (ly - treeHeight) *
                                                    0.5
                                        );

                                        if (
                                            dist <= layerRadius ||
                                            (dist <= layerRadius + 0.5 &&
                                                Math.random() < 0.5)
                                        ) {
                                            const leafKey = `${worldX + lx},${surfaceHeight + ly},${worldZ + lz}`;
                                            if (!terrainData[leafKey]) {

                                                const leafType =
                                                    biome === "snowy_plains" ||
                                                    biome === "snowy_forest" ||
                                                    biome === "snowy_taiga"
                                                        ? blockTypes[
                                                              "cold-leaves"
                                                          ]
                                                        : blockTypes[
                                                              "oak-leaves"
                                                          ];
                                                terrainData[leafKey] = leafType;
                                                blocksCount++;
                                            }
                                        }
                                    }
                                }
                            }

                            for (let i = 0; i < 5; i++) {
                                const lx = Math.floor(Math.random() * 5) - 2;
                                const ly =
                                    treeHeight +
                                    Math.floor(Math.random() * 3) -
                                    1;
                                const lz = Math.floor(Math.random() * 5) - 2;
                                if (
                                    Math.abs(lx) <= leafRadius &&
                                    Math.abs(lz) <= leafRadius &&
                                    ly >= treeHeight - 1 &&
                                    ly <= treeHeight + 1
                                ) {
                                    const leafKey = `${worldX + lx},${surfaceHeight + ly},${worldZ + lz}`;
                                    if (!terrainData[leafKey]) {

                                        const leafType =
                                            biome === "snowy_plains" ||
                                            biome === "snowy_forest" ||
                                            biome === "snowy_taiga"
                                                ? blockTypes["cold-leaves"]
                                                : blockTypes["oak-leaves"];
                                        terrainData[leafKey] = leafType;
                                        blocksCount++;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (
                biome === "desert" &&
                Math.random() < 0.05 &&
                surfaceHeight > 0
            ) {

                terrainData[`${worldX},${surfaceHeight + 1},${worldZ}`] =
                    blockTypes.sandstone;
                blocksCount++;
                if (Math.random() < 0.3) {
                    for (let dx = -1; dx <= 1; dx++) {
                        for (let dz = -1; dz <= 1; dz++) {
                            if (
                                (dx === 0 || dz === 0) &&
                                !(dx === 0 && dz === 0)
                            ) {
                                terrainData[
                                    `${worldX + dx},${surfaceHeight + 1},${worldZ + dz}`
                                ] = blockTypes.sandstone;
                                blocksCount++;
                            }
                        }
                    }
                }
            }
        }
    }
    updateProgress(
        `World generation complete. Created ${blocksCount} blocks.`,
        100
    );

    return terrainData;
}
/**
 * Generates a 3D density field for terrain
 * @param {number} width - World width
 * @param {number} height - World height
 * @param {number} length - World length
 * @param {Object} settings - Generation settings
 * @param {number} seedNum - Seed number
 * @param {Array} biomeMap - Biome assignment for each x,z coordinate
 * @param {Float32Array} finalHeightMap - Final height map for terrain generation
 * @param {boolean} isCompletelyFlat - Flag indicating if the terrain is completely flat
 * @returns {Float32Array} 3D density field where positive values = solid, negative = air
 */
function generate3DDensityField(
    width,
    height,
    length,
    settings,
    seedNum,
    biomeMap,
    finalHeightMap,
    isCompletelyFlat
) {

    const continentalnessNoise = generatePerlinNoise3D(width, height, length, {
        octaveCount: 2,
        scale: settings.scale * 0.5,
        persistence: 0.7,
        amplitude: 1.0,
        seed: seedNum,
    });
    const densityField = new Float32Array(width * height * length);
    const REFERENCE_HEIGHT = 32;
    console.log(
        `Using fixed reference height ${REFERENCE_HEIGHT} for terrain shaping, actual sea level: ${settings.seaLevel}`
    );
    for (let z = 0; z < length; z++) {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = z * width * height + y * width + x;
                const biomeIndex = z * width + x;
                const biome = biomeMap[biomeIndex];
                if (isCompletelyFlat) {
                    const flatSurfaceHeight = Math.round(
                        16 + finalHeightMap[biomeIndex] * 32
                    );
                    densityField[index] = y < flatSurfaceHeight ? 10.0 : -10.0;
                } else {

                    let density = REFERENCE_HEIGHT - y;

                    if (biome === "desert") {
                        density *= 0.95; // Reduced from 0.9
                    } else if (biome === "forest") {
                        density *= 1.05; // Reduced from 1.1
                    }

                    let noiseAmplitude;
                    if (settings.roughness < 0.5) {
                        noiseAmplitude = 4.0 + (settings.roughness - 0.3) * 4.0; // Reduced from 6.0-14.0
                    } else if (settings.roughness > 1.5) {
                        noiseAmplitude = 6.0 + (settings.roughness - 1.5) * 2.0; // Reduced from 10.0-14.0
                    } else {
                        noiseAmplitude = 6.0; // Reduced from 10.0
                    }

                    density +=
                        continentalnessNoise[index] *
                        noiseAmplitude *
                        (1.0 - settings.flatnessFactor);

                    if (y <= 1) {
                        density = 10.0;
                    }
                    densityField[index] = density;
                }
            }
        }
    }
    return densityField;
}
export default {
    generateHytopiaWorld,
};
