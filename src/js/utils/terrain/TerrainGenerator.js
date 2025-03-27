/**
 * TerrainGenerator.js - Hytopia terrain generation utility
 * 
 * This utility handles the generation of Hytopia terrain with biomes,
 * caves, rivers, lakes, and ore distribution based on a seed value.
 */

import { generatePerlinNoise, generatePerlinNoise3D } from '../noise/PerlinNoiseGenerator';

/**
 * Generates a Hytopia world from a seed
 * @param {Object} settings - Generation settings
 * @param {number} seedNum - The numeric seed value
 * @param {Object} blockTypes - Map of block types to IDs
 * @param {Function} progressCallback - Optional callback for progress updates
 * @returns {Object} The generated terrain data
 */
export function generateHytopiaWorld(settings, seedNum, blockTypes, progressCallback = null) {
  console.log('Starting world generation with block types:', blockTypes);
  
  const updateProgress = (message, progress) => {
    console.log(message);
    if (progressCallback) {
      progressCallback(message, progress);
    }
  };
  
  updateProgress('Starting seed-based world generation...', 0);
  
  // Ensure consistent settings without overriding the sea level
  const worldSettings = {
    ...settings,
    maxHeight: 64,
    // Use the passed seaLevel value instead of hardcoding it
  };
  
  console.log(`Using sea level: ${worldSettings.seaLevel}`);
  
  // Step 3.1: Create Layered Heightmap
  updateProgress('Generating heightmap...', 5);
  
  // Generate various noise layers with more isolated effects
  const continentalNoise = generatePerlinNoise(settings.width, settings.length, { 
    octaveCount: 1, 
    scale: settings.scale * 0.5, 
    persistence: 0.5, 
    amplitude: 1.0, 
    seed: seedNum 
  });
  
  const hillNoise = generatePerlinNoise(settings.width, settings.length, { 
    octaveCount: 3, 
    scale: settings.scale * 2, 
    persistence: 0.5, 
    amplitude: 0.5, 
    seed: seedNum + 1 
  });
  
  const detailNoise = generatePerlinNoise(settings.width, settings.length, { 
    octaveCount: 5, 
    scale: settings.scale * 4, 
    persistence: 0.5, 
    amplitude: 0.2, 
    seed: seedNum + 2 
  });
  
  // Add new noise for rocky features with more isolated parameters
  const rockNoise = generatePerlinNoise(settings.width, settings.length, {
    octaveCount: 4,
    scale: settings.scale * 3,
    persistence: 0.6,
    amplitude: 0.4,
    seed: seedNum + 10
  });
  
  const depthMap = generatePerlinNoise(settings.width, settings.length, { 
    octaveCount: 2, 
    scale: 0.02, 
    persistence: 0.5, 
    amplitude: 1.0, 
    seed: seedNum + 6 
  });
  
  // Combine the noise layers with better isolation
  const heightMap = new Float32Array(settings.width * settings.length);
  
  // Special case: completely flat terrain
  if (settings.isCompletelyFlat) {
    const flatHeight = 0.25; // 25% of max height
    for (let i = 0; i < heightMap.length; i++) {
      heightMap[i] = flatHeight;
    }
    console.log("Generating completely flat terrain");
  } else {
    // Normal terrain generation with isolated effects
    for (let i = 0; i < heightMap.length; i++) {
      // Base terrain shape from continental noise
      let baseTerrain = continentalNoise[i];
      
      // Add hills with reduced influence
      const hillInfluence = hillNoise[i] * (1.0 - settings.flatnessFactor);
      
      // Add detail with reduced influence
      const detailInfluence = detailNoise[i] * (1.0 - settings.flatnessFactor) * 0.5;
      
      // Add depth variation with reduced influence
      const depthInfluence = depthMap[i] * (1.0 - settings.flatnessFactor) * 0.3;
      
      // Combine with better isolation
      const noiseValue = (baseTerrain + hillInfluence + detailInfluence) * (1.0 + depthInfluence);
      
      // Apply flatness factor more gradually
      heightMap[i] = noiseValue * (1.0 - settings.flatnessFactor) + 0.5 * settings.flatnessFactor;
    }
  }
  
  // Step 3.2: Smooth the Heightmap
  updateProgress('Smoothing heightmap...', 10);
  const smoothedHeightMap = new Float32Array(settings.width * settings.length);
  const radius = Math.floor(2 + settings.terrainBlend * 2);
  
  for (let z = 0; z < settings.length; z++) {
    for (let x = 0; x < settings.width; x++) {
      let total = 0;
      let count = 0;
      
      // Apply weighted average over a radius
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const nz = z + dz;
          
          if (nx >= 0 && nx < settings.width && nz >= 0 && nz < settings.length) {
            // Weight by distance (inverse square)
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
  
  // Step 3.3: Apply Erosion Pass
  updateProgress('Applying erosion...', 15);
  const erodedHeightMap = new Float32Array(settings.width * settings.length);
  
  for (let z = 0; z < settings.length; z++) {
    for (let x = 0; x < settings.width; x++) {
      const index = z * settings.width + x;
      
      // For completely flat terrain, bypass erosion calculations
      if (settings.isCompletelyFlat) {
        // Use the flat height value (converted to the same scale as the erosion calculation)
        erodedHeightMap[index] = heightMap[index];
        continue;
      }
      
      let height = Math.floor(36 + smoothedHeightMap[index] * 28 * settings.roughness);
      
      // Compare with neighbors to smooth peaks and valleys
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const nz = z + dz;
          
          if (nx >= 0 && nx < settings.width && nz >= 0 && nz < settings.length) {
            const neighborHeight = Math.floor(36 + smoothedHeightMap[nz * settings.width + nx] * 28 * settings.roughness);
            
            // If neighbor is much lower, reduce height
            if (neighborHeight < height - 1) {
              height = Math.max(height - 1, neighborHeight + 1);
            }
          }
        }
      }
      
      erodedHeightMap[index] = (height - 36) / 28 / settings.roughness;
    }
  }
  
  // Step 4: Assign Biomes with Climate Zones
  updateProgress('Generating climate maps and biomes...', 20);
  
  // Create reference to the final height map we'll use for terrain generation
  // For flat terrain, use the unmodified heightMap; otherwise use the erodedHeightMap
  const finalHeightMap = settings.isCompletelyFlat ? heightMap : erodedHeightMap;
  
  // Step 4.1: Generate Climate Maps
  const tempMap = generatePerlinNoise(settings.width, settings.length, { 
    octaveCount: 1, 
    scale: 0.005, 
    persistence: 0.5, 
    amplitude: 1.0, 
    seed: seedNum + 7 
  });
  
  // Add temperature offset based on slider
  const temperatureOffset = (settings.temperature || 0.5) - 0.5; // Convert 0-1 to -0.5 to 0.5
  
  const humidityMap = generatePerlinNoise(settings.width, settings.length, { 
    octaveCount: 1, 
    scale: 0.005, 
    persistence: 0.5, 
    amplitude: 1.0, 
    seed: seedNum + 8 
  });
  
  // Generate river noise
  const riverNoise = generatePerlinNoise(settings.width, settings.length, { 
    octaveCount: 1, 
    scale: 0.01 + (settings.riverFreq || 0.05), 
    persistence: 0.5,
    amplitude: 1.0, 
    seed: seedNum + 5 
  });
  
  // Generate lake noise
  const lakeNoise = generatePerlinNoise(settings.width, settings.length, { 
    octaveCount: 1, 
    scale: 0.02,
    persistence: 0.5, 
    amplitude: 1.0, 
    seed: seedNum + 9 
  });
  
  // Additional smoothing pass for lake noise to prevent honeycomb patterns
  const smoothedLakeNoise = new Float32Array(lakeNoise.length);
  const lakeRadius = 2; // Smoothing radius
  
  for (let z = 0; z < settings.length; z++) {
    for (let x = 0; x < settings.width; x++) {
      let total = 0;
      let count = 0;
      
      // Apply weighted average over a radius
      for (let dz = -lakeRadius; dz <= lakeRadius; dz++) {
        for (let dx = -lakeRadius; dx <= lakeRadius; dx++) {
          const nx = x + dx;
          const nz = z + dz;
          
          if (nx >= 0 && nx < settings.width && nz >= 0 && nz < settings.length) {
            // Weight by distance (inverse square)
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
  
  // Step 4.2: Assign Biomes
  const biomeMap = new Array(settings.width * settings.length);
  
  for (let z = 0; z < settings.length; z++) {
    for (let x = 0; x < settings.width; x++) {
      const index = z * settings.width + x;
      const temp = tempMap[index] + temperatureOffset; // Apply temperature offset
      const humidity = humidityMap[index];
      
      // Temperature-based biome selection (similar to Minecraft)
      if (temp < 0.2) {
        // Cold biomes
        if (humidity < 0.3) biomeMap[index] = 'snowy_plains';
        else if (humidity < 0.6) biomeMap[index] = 'snowy_forest';
        else biomeMap[index] = 'snowy_taiga';
      } else if (temp < 0.4) {
        // Cool biomes
        if (humidity < 0.3) biomeMap[index] = 'plains';
        else if (humidity < 0.6) biomeMap[index] = 'forest';
        else biomeMap[index] = 'taiga';
      } else if (temp < 0.6) {
        // Temperate biomes
        if (humidity < 0.3) biomeMap[index] = 'plains';
        else if (humidity < 0.6) biomeMap[index] = 'forest';
        else biomeMap[index] = 'swamp';
      } else if (temp < 0.8) {
        // Warm biomes
        if (humidity < 0.3) biomeMap[index] = 'savanna';
        else if (humidity < 0.6) biomeMap[index] = 'jungle';
        else biomeMap[index] = 'swamp';
      } else {
        // Hot biomes
        if (humidity < 0.3) biomeMap[index] = 'desert';
        else if (humidity < 0.6) biomeMap[index] = 'savanna';
        else biomeMap[index] = 'jungle';
      }
    }
  }
  
  // Step 5: Generate Terrain Layers
  updateProgress('Building terrain layers...', 25);
  
  // Step 5.1: Calculate World Coordinates
  const startX = -Math.floor(settings.width / 2);
  const startZ = -Math.floor(settings.length / 2);
  
  // Create 3D density field for terrain
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
  
  // Step 6: Build Terrain from Density Field
  updateProgress('Building world from density field...', 45);
  
  const terrainData = {};
  let blocksCount = 0;
  
  // First pass: Generate base terrain from density field
  for (let z = 0; z < settings.length; z++) {
    for (let x = 0; x < settings.width; x++) {
      const worldX = startX + x;
      const worldZ = startZ + z;
      const biomeIndex = z * settings.width + x;
      const biome = biomeMap[biomeIndex];
      
      // Add bedrock layer at y=0 using lava
      console.log('Adding lava bedrock layer at y=0');
      terrainData[`${worldX},0,${worldZ}`] = blockTypes.lava; // Use lava for the bottom layer
      blocksCount++;
      
      // Find surface height
      let surfaceHeight = 0;
      for (let y = settings.maxHeight - 1; y > 0; y--) {
        const index = (z * settings.width * settings.maxHeight) + (y * settings.width) + x;
        const aboveIndex = (z * settings.width * settings.maxHeight) + ((y+1) * settings.width) + x;
        
        // Detect surface where density changes from positive to negative
        if (densityField[index] >= 0 && (y === settings.maxHeight - 1 || densityField[aboveIndex] < 0)) {
          surfaceHeight = y;
          break;
        }
      }
      
      // Fill solid blocks
      for (let y = 1; y < settings.maxHeight; y++) {
        const index = (z * settings.width * settings.maxHeight) + (y * settings.width) + x;
        
        if (densityField[index] >= 0) { // Solid block
          // Determine block type based on depth from surface
          if (y === 0) {
            // Skip since y=0 is already filled with lava as bedrock
            continue;
          } else if (y < surfaceHeight - 3) {
            terrainData[`${worldX},${y},${worldZ}`] = blockTypes.stone; // Deep terrain
          } else if (y < surfaceHeight) {
            // Transition layers
            if (biome === 'desert' || biome === 'savanna') {
              terrainData[`${worldX},${y},${worldZ}`] = blockTypes.sand;
            } else if (biome === 'snowy_plains' || biome === 'snowy_forest' || biome === 'snowy_taiga') {
              terrainData[`${worldX},${y},${worldZ}`] = blockTypes.snow;
            } else if (biome === 'ocean' && y < worldSettings.seaLevel) {
              terrainData[`${worldX},${y},${worldZ}`] = blockTypes.gravel; // Underwater surface
            } else {
              // Add occasional cobblestone outcrops on the surface
              const rockValue = rockNoise[z * settings.width + x];
              if (rockValue > 0.8) {
                terrainData[`${worldX},${y},${worldZ}`] = blockTypes.cobblestone;
              } else {
                terrainData[`${worldX},${y},${worldZ}`] = blockTypes.dirt;
              }
            }
          } else { // Surface block
            if (biome === 'desert' || biome === 'savanna') {
              terrainData[`${worldX},${y},${worldZ}`] = blockTypes.sand;
            } else if (biome === 'snowy_plains' || biome === 'snowy_forest' || biome === 'snowy_taiga') {
              terrainData[`${worldX},${y},${worldZ}`] = blockTypes.snow;
            } else if (biome === 'ocean' && y < worldSettings.seaLevel) {
              terrainData[`${worldX},${y},${worldZ}`] = blockTypes.gravel; // Underwater surface
            } else {
              // Add occasional cobblestone outcrops on the surface
              const rockValue = rockNoise[z * settings.width + x];
              if (rockValue > 0.8) {
                terrainData[`${worldX},${y},${worldZ}`] = blockTypes.cobblestone;
              } else {
                terrainData[`${worldX},${y},${worldZ}`] = blockTypes.grass;
              }
            }
          }
          blocksCount++;
        }
      }
    }
    
    // Update progress every 10% of rows
    if (z % Math.ceil(settings.length / 10) === 0) {
      const progress = Math.floor(45 + (z / settings.length) * 15);
      updateProgress(`Building terrain: ${Math.floor((z / settings.length) * 100)}% complete`, progress);
    }
  }
  
  // Step 6.5: Process water bodies with natural pooling constraints
  updateProgress('Creating natural water bodies...', 65);
  
  // Find the surface height at each position and mark ocean areas
  const waterMap = {};
  const surfaceHeightMap = {};
  const waterBedHeightMap = {}; // Track water bed heights for cleanup
  
  // First pass: Identify surface heights and water bodies
  for (let z = 0; z < settings.length; z++) {
    for (let x = 0; x < settings.width; x++) {
      const worldX = startX + x;
      const worldZ = startZ + z;
      const index = z * settings.width + x;
      const biome = biomeMap[index];
      
      // Find surface height at this position
      let surfaceHeight = 0;
      for (let y = settings.maxHeight - 1; y > 0; y--) {
        const key = `${worldX},${y},${worldZ}`;
        if (terrainData[key] && terrainData[key] !== blockTypes['water-still']) {
          surfaceHeight = y;
          break;
        }
      }
      
      // Store height in our map
      const key = `${worldX},${worldZ}`;
      surfaceHeightMap[key] = surfaceHeight;
      
      // Mark ocean biomes for water filling
      waterMap[key] = biome === 'ocean';
    }
  }
  
  // Find natural depressions and basins where water would pool
  for (let z = 1; z < settings.length - 1; z++) {
    for (let x = 1; x < settings.width - 1; x++) {
      const worldX = startX + x;
      const worldZ = startZ + z;
      const key = `${worldX},${worldZ}`;
      const height = surfaceHeightMap[key];
      const index = z * settings.width + x;
      
      // Skip if already marked as water or above sea level
      if (waterMap[key] || height > worldSettings.seaLevel) continue;
      
      // MODIFIED: Use smoothed lake noise to create more natural lake shapes
      const lakeValue = smoothedLakeNoise[index];
      
      // Create a lake if the noise value is within the lake range
      if (lakeValue > 0.7 && height < worldSettings.seaLevel - 1) {
        waterMap[key] = true;
        continue;
      }
      
      // Check if this is a depression (local minimum)
      let isDepression = true;
      let lowestNeighborHeight = Infinity;
      
      // Check all 8 surrounding cells
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          
          const nx = worldX + dx;
          const nz = worldZ + dz;
          const nKey = `${nx},${nz}`;
          
          // Skip if out of bounds
          if (!surfaceHeightMap[nKey]) continue;
          
          const neighborHeight = surfaceHeightMap[nKey];
          
          // If any neighbor is lower, this is not a depression
          if (neighborHeight < height) {
            isDepression = false;
          }
          
          // Track lowest neighbor for flow direction
          if (neighborHeight < lowestNeighborHeight) {
            lowestNeighborHeight = neighborHeight;
          }
        }
      }
      
      // Mark depressions below sea level as water
      if (isDepression && height < worldSettings.seaLevel) {
        waterMap[key] = true;
      }
      // Mark areas that are surrounded by higher terrain as potential basins
      else if (height < worldSettings.seaLevel - 2) {
        let higherNeighbors = 0;
        
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            
            const nx = worldX + dx;
            const nz = worldZ + dz;
            const nKey = `${nx},${nz}`;
            
            // Skip if out of bounds
            if (!surfaceHeightMap[nKey]) continue;
            
            // Count neighbors that are at least 2 blocks higher
            if (surfaceHeightMap[nKey] >= height + 2) {
              higherNeighbors++;
            }
          }
        }
        
        // If surrounded by higher terrain, mark as water basin
        if (higherNeighbors >= 5) {
          waterMap[key] = true;
        }
      }
    }
  }
  
  // Expand water to create continuous bodies (water flows into adjacent lower areas)
  for (let i = 0; i < 3; i++) { // Multiple iterations for water spread
    const newWaterMap = {...waterMap};
    
    for (let z = 1; z < settings.length - 1; z++) {
      for (let x = 1; x < settings.width - 1; x++) {
        const worldX = startX + x;
        const worldZ = startZ + z;
        const key = `${worldX},${worldZ}`;
        const height = surfaceHeightMap[key];
        
        // Skip if already water or above sea level
        if (waterMap[key] || height > worldSettings.seaLevel) continue;
        
        // Check if adjacent to water
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
        
        // Water flows to adjacent cells if they're below or at sea level
        if (adjacentToWater && height <= worldSettings.seaLevel) {
          newWaterMap[key] = true;
        }
      }
    }
    
    // Update the water map
    Object.assign(waterMap, newWaterMap);
  }
  
  // Add water and shorelines
  for (let z = 0; z < settings.length; z++) {
    for (let x = 0; x < settings.width; x++) {
      const worldX = startX + x;
      const worldZ = startZ + z;
      const key = `${worldX},${worldZ}`;
      const surfaceHeight = surfaceHeightMap[key];
      const biome = biomeMap[z * settings.width + x];
      
      // Add water in marked areas
      if (waterMap[key] && surfaceHeight < worldSettings.seaLevel) {
        // MODIFIED: Calculate a smoother waterbed height that doesn't honeycomb
        // Create a smooth transition for waterbed
        let waterBedHeight = surfaceHeight;
        
        // Check surrounding heights to smooth out the water bed
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
        
        // Calculate average height of area, but never go deeper than 2 blocks below surface
        const smoothedHeight = Math.floor(totalHeight / countNeighbors);
        waterBedHeight = Math.max(surfaceHeight - 2, smoothedHeight);
        
        // Store the calculated water bed height for later cleanup
        waterBedHeightMap[key] = waterBedHeight;
        
        // Fill with water from waterbed+1 to sea level
        for (let y = waterBedHeight + 1; y <= worldSettings.seaLevel; y++) {
          terrainData[`${worldX},${y},${worldZ}`] = blockTypes['water-still'];
          blocksCount++;
        }
        
        // Make bottom sandy/muddy depending on depth
        const waterDepth = worldSettings.seaLevel - waterBedHeight;
        if (waterDepth > 3) {
          // Deeper areas have gravel or clay
          terrainData[`${worldX},${waterBedHeight},${worldZ}`] = 
            Math.random() < 0.6 ? blockTypes.gravel : blockTypes.clay;
        } else {
          // Shallow areas have sand
          terrainData[`${worldX},${waterBedHeight},${worldZ}`] = blockTypes.sand;
        }
        
        // Remove old terrain blocks that would be underwater
        for (let y = waterBedHeight + 1; y <= surfaceHeight; y++) {
          delete terrainData[`${worldX},${y},${worldZ}`];
        }
      }
      
      // Create shorelines with sand around water bodies
      if (!waterMap[key]) {
        // Check if adjacent to water
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
        
        // Add sand beaches near water
        if (adjacentToWater && 
            surfaceHeight >= worldSettings.seaLevel - 2 && 
            surfaceHeight <= worldSettings.seaLevel + 1) {
          // Replace surface block with sand
          terrainData[`${worldX},${surfaceHeight},${worldZ}`] = 
            Math.random() < 0.7 ? blockTypes.sand : blockTypes['sand-light'];
          
          // Occasionally add sand below the surface for deeper beaches
          if (Math.random() < 0.5 && surfaceHeight > 1) {
            terrainData[`${worldX},${surfaceHeight - 1},${worldZ}`] = blockTypes.sand;
          }
        }
      }
    }
  }
  
  // Additional water feature adjustments for rivers
  if (riverNoise) { // Only if river noise exists
    for (let z = 0; z < settings.length; z++) {
      for (let x = 0; x < settings.width; x++) {
        const worldX = startX + x;
        const worldZ = startZ + z;
        const key = `${worldX},${worldZ}`;
        const index = z * settings.width + x;
        
        // Skip if already water
        if (waterMap[key]) continue;
        
        // Check for river path
        const riverVal = riverNoise[index];
        if (riverVal > 0.47 && riverVal < 0.53) {
          const height = surfaceHeightMap[key];
          
          // Only carve rivers at or below sea level + 4
          if (height <= worldSettings.seaLevel + 4) {
            // MODIFIED: Determine river depth - make rivers more shallow to prevent honeycomb effect
            // Original: const riverDepth = Math.min(3, height - 1);
            const riverDepth = Math.min(2, Math.max(1, Math.floor((height - worldSettings.seaLevel) * 0.3) + 1));
            const waterHeight = Math.max(height - riverDepth, Math.min(worldSettings.seaLevel, height - 1));
            
            // Only proceed if we can create a valid river
            if (waterHeight > 0 && waterHeight < height) {
              // Carve river channel - MODIFIED to be more gentle with sublayers
              for (let y = waterHeight; y <= height; y++) {
                // Don't cut more than 2 blocks below surface to avoid honeycomb effect
                if (y >= height - 2) {
                  delete terrainData[`${worldX},${y},${worldZ}`];
                }
              }
              
              // Add water (only at or below sea level)
              if (waterHeight <= worldSettings.seaLevel) {
                terrainData[`${worldX},${waterHeight},${worldZ}`] = blockTypes['water-still'];
                blocksCount++;
                
                // Mark as water and track river bed height for cleanup
                waterMap[key] = true;
                waterBedHeightMap[key] = waterHeight;
              }
              
              // Create river banks with sand/dirt
              for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                  if (dx === 0 && dz === 0) continue;
                  
                  const nx = worldX + dx;
                  const nz = worldZ + dz;
                  const nKey = `${nx},${nz}`;
                  
                  // Skip if already water
                  if (waterMap[nKey]) continue;
                  
                  const bankHeight = surfaceHeightMap[nKey];
                  if (bankHeight > 0 && bankHeight <= waterHeight + 2) {
                    // Make river banks sandy
                    terrainData[`${nx},${bankHeight},${nz}`] = 
                      Math.random() < 0.6 ? blockTypes.sand : blockTypes.dirt;
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  
  // Step 7: Generate Cave Noise Maps
  updateProgress('Preparing cave systems...', 75);
  
  const smallCaveNoise = generatePerlinNoise3D(settings.width, settings.maxHeight, settings.length, { 
    octaveCount: 2, 
    scale: 0.03, 
    persistence: 0.5, 
    amplitude: 1.0, 
    seed: seedNum + 2 
  });
  
  const largeCaveNoise = generatePerlinNoise3D(settings.width, settings.maxHeight, settings.length, { 
    octaveCount: 2, 
    scale: 0.06, 
    persistence: 0.5, 
    amplitude: 1.0, 
    seed: seedNum + 3 
  });
  
  // Generate ore noise
  const oreNoise = generatePerlinNoise3D(settings.width, settings.maxHeight, settings.length, { 
    octaveCount: 1, 
    scale: 0.04, 
    persistence: 0.5, 
    amplitude: 1.0, 
    seed: seedNum + 4 
  });
  
  // Step 7.1: Process caves by removing blocks
  updateProgress('Carving cave systems...', 80);
  for (let z = 0; z < settings.length; z++) {
    for (let x = 0; x < settings.width; x++) {
      const worldX = startX + x;
      const worldZ = startZ + z;
      const key = `${worldX},${worldZ}`;
      
      // Use already calculated surface height
      const surfaceHeight = surfaceHeightMap[key] || 0;
      
      // Generate caves below the surface down to y=1
      for (let y = Math.min(surfaceHeight - 2, settings.maxHeight - 3); y > 1; y--) {
        const blockKey = `${worldX},${y},${worldZ}`;
        
        // Skip if not a stone block (don't carve caves in water, etc.)
        if (!terrainData[blockKey] || terrainData[blockKey] !== blockTypes.stone) continue;
        
        // Get noise values for cave carving
        const index = (z * settings.width * settings.maxHeight) + (y * settings.width) + x;
        const smallCaveValue = smallCaveNoise[index];
        const largeCaveValue = largeCaveNoise[index];
        
        // Carve caves where noise values create cave-like spaces
        if ((smallCaveValue > 0.6 && largeCaveValue > 0.5) || 
            (smallCaveValue > 0.7) || 
            (largeCaveValue > 0.65)) {
          delete terrainData[blockKey]; // Remove block to create cave
        }
        
        // Place ores in stone blocks that aren't carved into caves
        else if (terrainData[blockKey] === blockTypes.stone) {
          const oreValue = oreNoise[index];
          const oreRarity = settings.oreRarity || 0.78; // Default if not specified
          
          // Place different ore types based on noise value and depth
          if (settings.generateOres !== false) {
            if (oreValue > oreRarity + 0.12 && y <= 40) {
              terrainData[blockKey] = blockTypes.coal;
            } else if (oreValue > oreRarity + 0.07 && y <= 35) {
              terrainData[blockKey] = blockTypes.iron;
            } else if (oreValue > oreRarity + 0.04 && y <= 20) {
              terrainData[blockKey] = blockTypes.gold;
            } else if (oreValue > oreRarity + 0.02 && y <= 30 && Math.random() < 0.3) {
              terrainData[blockKey] = blockTypes.emerald;
            } else if (oreValue > oreRarity && y <= 15) {
              terrainData[blockKey] = blockTypes.diamond;
            }
          }
        }
      }
    }
    
    // Update progress every 10% of rows
    if (z % Math.ceil(settings.length / 10) === 0) {
      const progress = Math.floor(80 + (z / settings.length) * 5);
      updateProgress(`Generating caves and ores: ${Math.floor((z / settings.length) * 100)}% complete`, progress);
    }
  }
  
  // Perform underwater terrain cleanup to eliminate columns and pillars
  updateProgress('Smoothing underwater terrain...', 88);
  
  // Find connected water bodies and ensure consistent waterbed heights
  for (let z = 0; z < settings.length; z++) {
    for (let x = 0; x < settings.width; x++) {
      const worldX = startX + x;
      const worldZ = startZ + z;
      const key = `${worldX},${worldZ}`;
      
      // Skip non-water cells
      if (!waterMap[key] || !waterBedHeightMap[key]) continue;
      
      const waterBedHeight = waterBedHeightMap[key];
      
      // Check all blocks below the waterbed for potential pillars
      for (let y = waterBedHeight - 1; y > 0; y--) {
        // Check if this is an isolated pillar
        const currentBlockKey = `${worldX},${y},${worldZ}`;
        
        // Skip if no block exists at this position
        if (!terrainData[currentBlockKey]) continue;
        
        // Count how many adjacent blocks exist at this level
        let adjacentBlocks = 0;
        let adjacentWater = 0;
        
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            
            const nx = worldX + dx;
            const nz = worldZ + dz;
            const nKey = `${nx},${nz}`;
            const neighborBlockKey = `${nx},${y},${nz}`;
            
            // Count adjacent solid blocks
            if (terrainData[neighborBlockKey]) {
              adjacentBlocks++;
            }
            
            // Count adjacent water cells
            if (waterMap[nKey]) {
              adjacentWater++;
            }
          }
        }
        
        // Remove isolated pillars (blocks with few neighbors but surrounded by water)
        // More aggressive cleanup higher up, more conservative deeper down
        const heightFactor = (y - 1) / waterBedHeight; // 0 near bottom, close to 1 near waterbed
        const threshold = Math.floor(2 + 3 * heightFactor); // 2-5 based on depth
        
        if (adjacentBlocks <= threshold && adjacentWater >= 4) {
          delete terrainData[currentBlockKey];
        }
      }
    }
  }
  
  // Step 8: Place Surface Features
  updateProgress('Adding biome-specific features...', 90);
  
  // Step 8.1: Generate a mountain range if enabled
  if (settings.mountainRange && settings.mountainRange.enabled) {
    updateProgress('Creating snow-capped mountain ranges along world borders...', 92);
    
    // Recalibrated: "Small" setting is now the max size (25% slider value = 100% effect)
    // This creates an inverse relationship where lower slider values = larger mountains
    const sizeAdjustmentFactor = Math.max(0.05, 1.0 - (settings.mountainRange.size * 4.0));
    
    // Get the base mountain height and multiply by 2 for taller mountains
    // Adjusted to scale inversely with size - smaller mountains are taller relatively
    const mountainBaseHeight = settings.mountainRange.height * 2 * (1 + sizeAdjustmentFactor * 0.5);
    const snowHeight = settings.mountainRange.snowHeight * 1.5; // Adjust snow line accordingly
    
    // Size based on a percentage of the world size, scaled inversely with slider
    // Lower slider values = larger mountains (wider mountain borders)
    const mountainWidth = Math.max(5, Math.floor(settings.width * 0.25 * sizeAdjustmentFactor));
    
    console.log(`Generating mountain ranges around all borders: width ${mountainWidth}, height ${mountainBaseHeight}, snow at ${snowHeight}, size adjustment ${sizeAdjustmentFactor}`);
    
    // Process all world coordinates
    for (let z = 0; z < settings.length; z++) {
      for (let x = 0; x < settings.width; x++) {
        const worldX = startX + x;
        const worldZ = startZ + z;
        
        // Calculate distance from all four edges
        const distFromWest = x;
        const distFromEast = settings.width - x - 1;
        const distFromNorth = z;
        const distFromSouth = settings.length - z - 1;
        
        // Find the minimum distance to any edge
        const distFromEdge = Math.min(distFromWest, distFromEast, distFromNorth, distFromSouth);
        
        // Skip if not within mountain width of any border
        if (distFromEdge > mountainWidth) continue;
        
        // Determine which edge(s) we're closest to for terrain variation
        const isNearWest = distFromWest <= mountainWidth;
        const isNearEast = distFromEast <= mountainWidth;
        const isNearNorth = distFromNorth <= mountainWidth;
        const isNearSouth = distFromSouth <= mountainWidth;
        
        // Calculate height factor based on distance from edge
        // Closer to the border = higher mountains
        let heightFactor = Math.cos((distFromEdge / mountainWidth) * (Math.PI * 0.5));
        
        // Boost corners where mountain ranges meet
        let cornerBoost = 0;
        
        // Check if we're in a corner region (near two perpendicular edges)
        if ((isNearWest && isNearNorth) || 
            (isNearWest && isNearSouth) || 
            (isNearEast && isNearNorth) || 
            (isNearEast && isNearSouth)) {
          
          // Calculate the product of the two edge distances for a smooth corner transition
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
          
          // Add extra height in corners
          const cornerFactor = (1.0 - edgeDist1/mountainWidth) * (1.0 - edgeDist2/mountainWidth);
          cornerBoost = cornerFactor * 0.4; // Boost corner height
        }
        
        // Apply height factor to base height with corner boost
        const baseHeight = Math.floor(mountainBaseHeight * (heightFactor + cornerBoost));
        
        // Calculate terrain variation based on position along the edge
        let terrainVariationFactor;
        
        if (isNearWest && distFromWest <= distFromNorth && distFromWest <= distFromSouth) {
          // Western edge variation
          terrainVariationFactor = z / settings.length;
        } else if (isNearEast && distFromEast <= distFromNorth && distFromEast <= distFromSouth) {
          // Eastern edge variation
          terrainVariationFactor = z / settings.length;
        } else if (isNearNorth && distFromNorth <= distFromWest && distFromNorth <= distFromEast) {
          // Northern edge variation
          terrainVariationFactor = x / settings.width;
        } else {
          // Southern edge variation
          terrainVariationFactor = x / settings.width;
        }
        
        // Add mountain ridges and variations
        // Use position-specific noise to create natural-looking mountain ridges
        const ridgeFactor = Math.cos(x * 0.2) * Math.sin(z * 0.15) * 6; 
        
        // Use distance from edge for more variation
        const edgeVariation = Math.sin(terrainVariationFactor * Math.PI * 4) * 5;
        
        // Combine all factors for the local mountain height
        const localMountainHeight = Math.floor(baseHeight + ridgeFactor + edgeVariation);
        
        // Add small-scale noise for texture
        const noise1 = Math.sin(x * 0.8) * Math.cos(z * 0.8) * 2;
        const noise2 = Math.cos(x * 0.3 + z * 0.2) * 2;
        const noiseOffset = noise1 + noise2;
        
        const finalHeight = Math.max(1, Math.floor(localMountainHeight + noiseOffset));
        
        // Get the current surface height at this position
        const key = `${worldX},${worldZ}`;
        const currentHeight = surfaceHeightMap[key] || 0;
        
        // Only build the mountain if it would be higher than the current terrain
        if (finalHeight <= 0 || currentHeight >= finalHeight) continue;
        
        // Build the mountain using stone
        for (let y = currentHeight + 1; y <= finalHeight; y++) {
          // Determine block type
          // Snow cap at the top of the mountain
          if (settings.mountainRange.snowCap) {
            // Snow on the very top
            if (y === finalHeight && y >= snowHeight - 5) {
              terrainData[`${worldX},${y},${worldZ}`] = blockTypes.snow;
            }
            // Snow layers on steep sides near the top
            else if (y >= snowHeight - 3 && y >= finalHeight - 2 && Math.random() < 0.7) {
              terrainData[`${worldX},${y},${worldZ}`] = blockTypes.snow;
            }
            // Small patches of snow on north-facing slopes
            else if (y >= snowHeight - 8 && Math.random() < 0.3) {
              terrainData[`${worldX},${y},${worldZ}`] = blockTypes.snow;
            }
            // Otherwise stone
            else {
              terrainData[`${worldX},${y},${worldZ}`] = blockTypes.stone;
            }
          } else {
            terrainData[`${worldX},${y},${worldZ}`] = blockTypes.stone;
          }
          blocksCount++;
        }
        
        // Update the surface height map for this location
        surfaceHeightMap[key] = finalHeight;
      }
    }
  }
  
  // Use a random offset for tree placement to avoid grid patterns
  const treeOffsetX = Math.floor(Math.random() * 5);
  const treeOffsetZ = Math.floor(Math.random() * 5);
  
  // Step 9: Add Trees and Vegetation
  updateProgress('Adding trees and vegetation...', 85);
  
  // Add cacti in desert biomes first
  // Use a random offset for cactus placement to avoid grid patterns
  const cactusOffsetX = Math.floor(Math.random() * 7);
  const cactusOffsetZ = Math.floor(Math.random() * 7);
  
  for (let z = 0; z < settings.length; z++) {
    for (let x = 0; x < settings.width; x++) {
      const worldX = startX + x;
      const worldZ = startZ + z;
      const biomeIndex = z * settings.width + x;
      const biome = biomeMap[biomeIndex];
      
      // Get the surface height at this position
      let surfaceHeight = 0;
      for (let y = settings.maxHeight - 1; y >= 0; y--) {
        if (terrainData[`${worldX},${y},${worldZ}`] && 
            terrainData[`${worldX},${y},${worldZ}`] !== blockTypes['water-still']) {
          surfaceHeight = y;
          break;
        }
      }
      
      // Check if we're in a desert biome and the surface is sand
      const surfaceBlock = terrainData[`${worldX},${surfaceHeight},${worldZ}`];
      if (biome === 'desert' && surfaceHeight > 0 && 
          (surfaceBlock === blockTypes.sand || surfaceBlock === blockTypes['sand-light'])) {
        // Only place cacti on certain coordinates to avoid grid patterns
        if ((x + cactusOffsetX) % 7 === 0 && (z + cactusOffsetZ) % 7 === 0) {
          // Use a more natural distribution pattern
          const noiseValue = Math.random();
          const temp = tempMap[biomeIndex] + temperatureOffset;
          
          // Adjust probability based on temperature and noise
          let cactusProbability = 0.2; // Base probability
          if (temp > 0.8) {
            cactusProbability = 0.35; // Higher chance in very hot areas
          } else if (temp > 0.7) {
            cactusProbability = 0.3; // Medium-high chance in hot areas
          } else if (temp > 0.6) {
            cactusProbability = 0.25; // Medium chance in warm areas
          }
          
          // Add some randomness to prevent grid patterns
          if (noiseValue < cactusProbability) {
            const cactusHeight = 3 + Math.floor(Math.random() * 2); // Cactus height
            
            // Check if there's enough space for a cactus
            let canPlaceCactus = true;
            for (let ty = 1; ty <= cactusHeight; ty++) {
              if (terrainData[`${worldX},${surfaceHeight + ty},${worldZ}`]) {
                canPlaceCactus = false;
                break;
              }
            }
            
            if (canPlaceCactus) {
              // Place cactus
              for (let ty = 1; ty <= cactusHeight; ty++) {
                terrainData[`${worldX},${surfaceHeight + ty},${worldZ}`] = blockTypes.cactus;
                blocksCount++;
              }
            }
          }
        }
      }
    }
  }
  
  // Then add trees in non-desert biomes
  for (let z = 0; z < settings.length; z++) {
    for (let x = 0; x < settings.width; x++) {
      const worldX = startX + x;
      const worldZ = startZ + z;
      const biomeIndex = z * settings.width + x;
      const biome = biomeMap[biomeIndex];
      
      // Get the surface height at this position
      let surfaceHeight = 0;
      for (let y = settings.maxHeight - 1; y >= 0; y--) {
        if (terrainData[`${worldX},${y},${worldZ}`] && 
            terrainData[`${worldX},${y},${worldZ}`] !== blockTypes['water-still']) {
          surfaceHeight = y;
          break;
        }
      }
      
      // Skip desert biomes and sand blocks for trees
      if (biome === 'desert') continue;
      
      // Only place trees on certain coordinates to avoid grid patterns
      if ((x + treeOffsetX) % 5 === 0 && (z + treeOffsetZ) % 5 === 0) {
        // Check if the surface block is sand - if so, skip tree placement
        const surfaceBlock = terrainData[`${worldX},${surfaceHeight},${worldZ}`];
        if (surfaceBlock === blockTypes.sand || surfaceBlock === blockTypes['sand-light']) {
          continue;
        }
        
        // Place trees with varying probabilities based on biome
        let treeProbability = 0.1; // Default low probability
        if (biome === 'forest' || biome === 'taiga') {
          treeProbability = 0.3; // Higher probability in forests
        } else if (biome === 'plains' || biome === 'savanna') {
          treeProbability = 0.15; // Medium probability in plains
        } else if (biome === 'snowy_forest' || biome === 'snowy_taiga') {
          treeProbability = 0.25; // Medium-high probability in snowy forests
        }
        
        if (Math.random() < treeProbability) {
          // Determine tree height based on biome
          let treeHeight = 4 + Math.floor(Math.random() * 2); // Default height
          if (biome === 'savanna') {
            treeHeight = 5 + Math.floor(Math.random() * 2); // Taller trees in savanna
          } else if (biome === 'snowy_plains' || biome === 'snowy_forest' || biome === 'snowy_taiga') {
            treeHeight = 3 + Math.floor(Math.random() * 2); // Shorter trees in snowy biomes
          }
          
          // Check if there's enough space for a tree
          let canPlaceTree = true;
          for (let ty = 1; ty <= treeHeight + 2; ty++) {
            if (terrainData[`${worldX},${surfaceHeight + ty},${worldZ}`]) {
              canPlaceTree = false;
              break;
            }
          }
          
          if (canPlaceTree) {
            // Place trunk - use poplar log for snowy biomes, regular log for others
            const logType = (biome === 'snowy_plains' || biome === 'snowy_forest' || biome === 'snowy_taiga')
              ? blockTypes['poplar log'] 
              : (biome === 'desert' ? blockTypes.cactus : blockTypes.log);
            
            for (let ty = 1; ty <= treeHeight; ty++) {
              terrainData[`${worldX},${surfaceHeight + ty},${worldZ}`] = logType;
              blocksCount++;
            }
            
            // Only place leaves for non-desert biomes
            if (biome !== 'desert') {
              // Place leaves (more complex canopy)
              // Different leaf patterns per biome
              let leafRadius = 2;
              if (biome === 'savanna') {
                leafRadius = 3; // Wider canopy for savanna
              } else if (biome === 'snowy_plains' || biome === 'snowy_forest' || biome === 'snowy_taiga') {
                leafRadius = 2; // Standard canopy for snowy trees
              }
              
              for (let ly = treeHeight - 1; ly <= treeHeight + 1; ly++) {
                const layerRadius = ly === treeHeight ? leafRadius : leafRadius - 1;
                
                for (let lx = -layerRadius; lx <= layerRadius; lx++) {
                  for (let lz = -layerRadius; lz <= layerRadius; lz++) {
                    // Skip trunk position
                    if (lx === 0 && lz === 0 && ly < treeHeight) continue;
                    
                    // Calculate distance from trunk
                    const dist = Math.sqrt(lx * lx + lz * lz + (ly - treeHeight) * (ly - treeHeight) * 0.5);
                    
                    // Place leaves based on distance (sparser at edges)
                    if (dist <= layerRadius || (dist <= layerRadius + 0.5 && Math.random() < 0.5)) {
                      const leafKey = `${worldX + lx},${surfaceHeight + ly},${worldZ + lz}`;
                      if (!terrainData[leafKey]) {
                        // Use cold leaves for snowy biomes, oak leaves for all others
                        const leafType = (biome === 'snowy_plains' || biome === 'snowy_forest' || biome === 'snowy_taiga')
                          ? blockTypes['cold-leaves']
                          : blockTypes['oak-leaves'];
                        terrainData[leafKey] = leafType;
                        blocksCount++;
                      }
                    }
                  }
                }
              }
              
              // Add a few random leaves for natural variation
              for (let i = 0; i < 5; i++) {
                const lx = Math.floor(Math.random() * 5) - 2;
                const ly = treeHeight + Math.floor(Math.random() * 3) - 1;
                const lz = Math.floor(Math.random() * 5) - 2;
                
                if (Math.abs(lx) <= leafRadius && Math.abs(lz) <= leafRadius && 
                    ly >= treeHeight - 1 && ly <= treeHeight + 1) {
                  const leafKey = `${worldX + lx},${surfaceHeight + ly},${worldZ + lz}`;
                  if (!terrainData[leafKey]) {
                    // Use cold leaves for snowy biomes, oak leaves for all others
                    const leafType = (biome === 'snowy_plains' || biome === 'snowy_forest' || biome === 'snowy_taiga')
                      ? blockTypes['cold-leaves']
                      : blockTypes['oak-leaves'];
                    terrainData[leafKey] = leafType;
                    blocksCount++;
                  }
                }
              }
            }
          }
        }
      }
      
      // Step 9.2: Add Biome-Specific Features
      if (biome === 'desert' && Math.random() < 0.05 && surfaceHeight > 0) {
        // Add occasional sandstone structures in desert
        terrainData[`${worldX},${surfaceHeight + 1},${worldZ}`] = blockTypes.sandstone;
        blocksCount++;
        
        if (Math.random() < 0.3) {
          for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
              if ((dx === 0 || dz === 0) && !(dx === 0 && dz === 0)) {
                terrainData[`${worldX + dx},${surfaceHeight + 1},${worldZ + dz}`] = blockTypes.sandstone;
                blocksCount++;
              }
            }
          }
        }
      }
    }
  }
  
  updateProgress(`World generation complete. Created ${blocksCount} blocks.`, 100);
  
  // Return the generated terrain data
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
function generate3DDensityField(width, height, length, settings, seedNum, biomeMap, finalHeightMap, isCompletelyFlat) {
  // Generate 3D noise for the density field with more isolated parameters
  const continentalnessNoise = generatePerlinNoise3D(width, height, length, {
    octaveCount: 2,
    scale: settings.scale * 0.5,
    persistence: 0.7,
    amplitude: 1.0,
    seed: seedNum
  });
  
  const densityField = new Float32Array(width * height * length);
  const REFERENCE_HEIGHT = 32;
  
  console.log(`Using fixed reference height ${REFERENCE_HEIGHT} for terrain shaping, actual sea level: ${settings.seaLevel}`);
  
  for (let z = 0; z < length; z++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (z * width * height) + (y * width) + x;
        const biomeIndex = z * width + x;
        const biome = biomeMap[biomeIndex];
        
        if (isCompletelyFlat) {
          const flatSurfaceHeight = Math.round(16 + finalHeightMap[biomeIndex] * 32);
          densityField[index] = y < flatSurfaceHeight ? 10.0 : -10.0;
        } else {
          // Base density calculation
          let density = REFERENCE_HEIGHT - y;
          
          // Biome adjustments with reduced influence
          if (biome === 'desert') {
            density *= 0.95; // Reduced from 0.9
          } else if (biome === 'forest') {
            density *= 1.05; // Reduced from 1.1
          }
          
          // Isolated noise amplitude based on roughness
          let noiseAmplitude;
          if (settings.roughness < 0.5) {
            noiseAmplitude = 4.0 + (settings.roughness - 0.3) * 4.0; // Reduced from 6.0-14.0
          } else if (settings.roughness > 1.5) {
            noiseAmplitude = 6.0 + (settings.roughness - 1.5) * 2.0; // Reduced from 10.0-14.0
          } else {
            noiseAmplitude = 6.0; // Reduced from 10.0
          }
          
          // Add noise with reduced influence
          density += continentalnessNoise[index] * noiseAmplitude * (1.0 - settings.flatnessFactor);
          
          // Ensure bottom layer is solid
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
  generateHytopiaWorld
}; 