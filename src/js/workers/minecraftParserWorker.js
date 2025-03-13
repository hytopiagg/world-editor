/* eslint-disable no-restricted-globals */
import JSZip from 'jszip';
import { AnvilParser } from '../utils/minecraft/AnvilParser';

// Handle messages from main thread
self.onmessage = async function(event) {
  const { type, data } = event.data;
  
  if (type === 'scanWorldSize') {
    try {
      const zipData = data.zipFile;
      
      self.postMessage({
        type: 'progress', 
        data: { 
          message: `Scanning world size...`, 
          progress: 5 
        } 
      });
      
      const worldSizeInfo = await scanWorldSize(zipData);
      
      self.postMessage({
        type: 'worldSizeScanned',
        data: worldSizeInfo
      });
    } catch (error) {
      self.postMessage({
        type: 'error',
        error: error.message || 'Unknown error during world scanning'
      });
    }
  } else if (type === 'parseWorld') {
    try {
      const zipData = data.zipFile;
      const options = data.options || {};
      
      self.postMessage({
        type: 'progress', 
        data: { 
          message: `Starting world parsing with options: ${JSON.stringify(options)}`, 
          progress: 2 
        } 
      });
      
      // Call the parseMinecraftWorld function - it will handle sending data in chunks
      await parseMinecraftWorld(zipData, options);
      
      // The worldParsed message is now sent from within parseMinecraftWorld
    } catch (error) {
      self.postMessage({
        type: 'error',
        error: error.message || 'Unknown error during world parsing'
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
    // Load the ZIP file
    const zip = await JSZip.loadAsync(zipData);
    
    // Debug: Log the files in the ZIP
    const filesInZip = Object.keys(zip.files);
    console.log('Files in ZIP:', filesInZip);
    self.postMessage({ 
      type: 'progress', 
      data: { 
        message: `Found ${filesInZip.length} files in ZIP`, 
        progress: 10 
      } 
    });
    
    // Find level.dat for world version check
    let worldVersion = null;
    
    // Try to find level.dat in common locations
    const levelDatPatterns = [
      /^level\.dat$/,
      /^.*\/level\.dat$/
    ];
    
    for (const pattern of levelDatPatterns) {
      const levelDatFile = Object.keys(zip.files).find(path => path.match(pattern));
      if (levelDatFile) {
        try {
          const levelDatBuffer = await zip.files[levelDatFile].async('arraybuffer');
          
          // Create a temporary parser to check the world version
          const tempParser = new AnvilParser();
          tempParser.checkWorldVersion(levelDatBuffer);
          worldVersion = tempParser.worldVersion;
          
          self.postMessage({ 
            type: 'progress',
            data: { 
              message: `Found level.dat at ${levelDatFile}, World Version: ${worldVersion || 'Unknown'}`,
              progress: 15
            }
          });
          break;
        } catch (e) {
          console.warn(`Failed to read level.dat at ${levelDatFile}:`, e);
        }
      }
    }
    
    if (!worldVersion) {
      console.warn('Could not determine world version from level.dat');
    }
    
    // Find region files
    const possibleRegionPaths = [
      /^region\/r\.-?\d+\.-?\d+\.mca$/,           // Direct region folder
      /^.+\/region\/r\.-?\d+\.-?\d+\.mca$/,       // World folder/region
      /^saves\/.+\/region\/r\.-?\d+\.-?\d+\.mca$/ // saves/world folder/region
    ];
    
    let regionFiles = [];
    
    // Try each possible path pattern
    for (const pattern of possibleRegionPaths) {
      const matchingFiles = Object.keys(zip.files).filter(path => path.match(pattern));
      if (matchingFiles.length > 0) {
        regionFiles = matchingFiles;
        self.postMessage({ 
          type: 'progress',
          data: { 
            message: `Found ${regionFiles.length} region files with pattern ${pattern}`,
            progress: 30
          }
        });
        break;
      }
    }
    
    // If still no region files, look for any .mca files
    if (regionFiles.length === 0) {
      regionFiles = Object.keys(zip.files).filter(path => path.endsWith('.mca'));
      self.postMessage({ 
        type: 'progress',
        data: { 
          message: `Found ${regionFiles.length} .mca files by extension`,
          progress: 30
        }
      });
    }
    
    if (regionFiles.length === 0) {
      throw new Error('No region files found in the uploaded world. The file may not be a valid Minecraft world ZIP or the region files might be stored in an unexpected location.');
    }
    
    // Process region coordinates
    let regionCoords = [];
    
    for (const regionPath of regionFiles) {
      const regionMatch = regionPath.match(/r\.(-?\d+)\.(-?\d+)\.mca$/);
      if (regionMatch) {
        regionCoords.push({
          path: regionPath,
          x: parseInt(regionMatch[1]),
          z: parseInt(regionMatch[2])
        });
      }
    }
    
    // Calculate region bounds
    let minRegionX = Infinity, maxRegionX = -Infinity;
    let minRegionZ = Infinity, maxRegionZ = -Infinity;
    
    for (const region of regionCoords) {
      minRegionX = Math.min(minRegionX, region.x);
      maxRegionX = Math.max(maxRegionX, region.x);
      minRegionZ = Math.min(minRegionZ, region.z);
      maxRegionZ = Math.max(maxRegionZ, region.z);
    }
    
    // Calculate block coordinates
    // Each region is 512x512 blocks (32 chunks x 16 blocks)
    const minBlockX = minRegionX * 512;
    const maxBlockX = (maxRegionX + 1) * 512 - 1;
    const minBlockZ = minRegionZ * 512;
    const maxBlockZ = (maxRegionZ + 1) * 512 - 1;
    
    // Y-range is typically -64 to 320 in 1.21+ worlds
    const minBlockY = -64;
    const maxBlockY = 320;
    
    // Sample data from a few regions to analyze height distribution
    const sampleRegions = getRepresentativeRegions(regionCoords);
    
    self.postMessage({ 
      type: 'progress',
      data: { 
        message: `Sampling ${sampleRegions.length} regions to analyze height distribution...`,
        progress: 50
      }
    });
    
    let actualMinY = minBlockY;
    let actualMaxY = maxBlockY;
    
    // If we have sample regions, try to get more accurate Y bounds
    if (sampleRegions.length > 0) {
      const sampleYBounds = await getSampleYBounds(zip, sampleRegions);
      if (sampleYBounds) {
        actualMinY = sampleYBounds.minY;
        actualMaxY = sampleYBounds.maxY;
      }
    }
    
    // Calculate world size
    const worldWidthBlocks = maxBlockX - minBlockX + 1;
    const worldHeightBlocks = actualMaxY - actualMinY + 1;
    const worldDepthBlocks = maxBlockZ - minBlockZ + 1;
    
    // Calculate region count
    const regionWidth = maxRegionX - minRegionX + 1;
    const regionDepth = maxRegionZ - minRegionZ + 1;
    const regionCount = regionWidth * regionDepth;
    
    // Calculate approximate world size in MB (rough estimation)
    // Average region file is about 1-5MB, we'll use 2MB as a conservative estimate
    const approximateSizeMB = regionCount * 2;
    
    // Create object with world size info
    const worldSizeInfo = {
      bounds: {
        minX: minBlockX,
        maxX: maxBlockX,
        minY: actualMinY,
        maxY: actualMaxY,
        minZ: minBlockZ,
        maxZ: maxBlockZ
      },
      size: {
        width: worldWidthBlocks,
        height: worldHeightBlocks,
        depth: worldDepthBlocks,
        regionCount: regionCount,
        regionWidth: regionWidth,
        regionDepth: regionDepth,
        approximateSizeMB: approximateSizeMB
      },
      regionCoords: regionCoords,
      worldFolder: detectWorldFolder(regionFiles[0]),
      worldVersion: worldVersion
    };
    
    self.postMessage({ 
      type: 'progress',
      data: { 
        message: `World scan complete. Size: ${worldWidthBlocks}x${worldHeightBlocks}x${worldDepthBlocks} blocks across ${regionCount} regions`,
        progress: 100
      }
    });
    
    return worldSizeInfo;
  } catch (error) {
    console.error('Error in scanWorldSize:', error);
    throw error;
  }
}

/**
 * Get a representative sample of regions to analyze for Y-bounds
 * @param {Array} regionCoords - All region coordinates
 * @returns {Array} A subset of regions to sample
 */
function getRepresentativeRegions(regionCoords) {
  // If few regions, sample all of them
  if (regionCoords.length <= 3) {
    return regionCoords;
  }
  
  // Otherwise, sample the center region and a few others spread out
  // Calculate center
  let sumX = 0, sumZ = 0;
  regionCoords.forEach(region => {
    sumX += region.x;
    sumZ += region.z;
  });
  
  const centerX = Math.round(sumX / regionCoords.length);
  const centerZ = Math.round(sumZ / regionCoords.length);
  
  // Find center region or closest to center
  let centerRegion = null;
  let minDistToCenter = Infinity;
  
  regionCoords.forEach(region => {
    const dist = Math.sqrt(Math.pow(region.x - centerX, 2) + Math.pow(region.z - centerZ, 2));
    if (dist < minDistToCenter) {
      minDistToCenter = dist;
      centerRegion = region;
    }
  });
  
  // Also select regions from different quadrants if available
  const quadrants = [
    [], // Q1: positive X, positive Z
    [], // Q2: negative X, positive Z
    [], // Q3: negative X, negative Z
    []  // Q4: positive X, negative Z
  ];
  
  regionCoords.forEach(region => {
    if (region.x >= 0 && region.z >= 0) quadrants[0].push(region);
    else if (region.x < 0 && region.z >= 0) quadrants[1].push(region);
    else if (region.x < 0 && region.z < 0) quadrants[2].push(region);
    else quadrants[3].push(region);
  });
  
  // Get one region from each non-empty quadrant
  const samples = [centerRegion];
  
  quadrants.forEach(quadrant => {
    if (quadrant.length > 0) {
      // Pick a region randomly from this quadrant
      const randomIndex = Math.floor(Math.random() * quadrant.length);
      const region = quadrant[randomIndex];
      
      // Don't duplicate the center region
      if (region.x !== centerRegion.x || region.z !== centerRegion.z) {
        samples.push(region);
      }
    }
  });
  
  // Limit to at most 5 sample regions
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
    
    // Use a lightweight NBT parser just to get section Y values
    const parser = new AnvilParser({
      skipBlockLoading: true // Special option to only read section headers
    });
    
    // Sample a few regions
    for (const region of sampleRegions) {
      try {
        // Load region file data
        const regionFileBuffer = await zip.files[region.path].async('arraybuffer');
        
        // Call a special method to just extract Y-bounds
        const yBounds = parser.extractYBoundsFromRegion(regionFileBuffer, region.x, region.z);
        
        if (yBounds) {
          minY = Math.min(minY, yBounds.minY);
          maxY = Math.max(maxY, yBounds.maxY);
        }
      } catch (e) {
        console.warn(`Error sampling Y-bounds from region (${region.x}, ${region.z}):`, e);
      }
    }
    
    // If we found valid bounds, return them
    if (minY !== Infinity && maxY !== -Infinity) {
      return { minY, maxY };
    }
    
    // Default to standard range if sampling failed
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
  // Try to extract world name from path
  const worldFolderMatch = regionPath.match(/(?:saves\/)?([^\/]+)\/region\//);
  if (worldFolderMatch && worldFolderMatch[1]) {
    return worldFolderMatch[1];
  }
  return null;
}

async function parseMinecraftWorld(zipData, options = {}) {
  try {
    // Load the ZIP file
    const zip = await JSZip.loadAsync(zipData);
    
    // Debug: Log the files in the ZIP
    const filesInZip = Object.keys(zip.files);
    console.log('Files in ZIP:', filesInZip);
    self.postMessage({ 
      type: 'progress', 
      data: { 
        message: `Found ${filesInZip.length} files in ZIP`, 
        progress: 5 
      } 
    });
    
    // Look for region files with different possible paths
    // Some zips might have the world data in a subfolder
    const possibleRegionPaths = [
      /^region\/r\.-?\d+\.-?\d+\.mca$/,           // Direct region folder
      /^.+\/region\/r\.-?\d+\.-?\d+\.mca$/,       // World folder/region
      /^saves\/.+\/region\/r\.-?\d+\.-?\d+\.mca$/ // saves/world folder/region
    ];
    
    let regionFiles = [];
    
    // Try each possible path pattern
    for (const pattern of possibleRegionPaths) {
      const matchingFiles = Object.keys(zip.files).filter(path => path.match(pattern));
      if (matchingFiles.length > 0) {
        regionFiles = matchingFiles;
        self.postMessage({ 
          type: 'progress',
          data: { 
            message: `Found ${regionFiles.length} region files with pattern ${pattern}`,
            progress: 8
          }
        });
        break;
      }
    }
    
    // If still no region files, look for any .mca files
    if (regionFiles.length === 0) {
      regionFiles = Object.keys(zip.files).filter(path => path.endsWith('.mca'));
      self.postMessage({ 
        type: 'progress',
        data: { 
          message: `Found ${regionFiles.length} .mca files by extension`,
          progress: 8
        }
      });
    }
    
    if (regionFiles.length === 0) {
      // Try to log all zip files to help debugging
      console.log("ZIP contents:", filesInZip);
      throw new Error('No region files found in the uploaded world. The file may not be a valid Minecraft world ZIP or the region files might be stored in an unexpected location.');
    }
    
    // Find level.dat for region bounds check
    let levelDatBuffer = null;
    let levelDatFound = false;
    
    // Try to find level.dat in common locations
    const levelDatPatterns = [
      /^level\.dat$/,
      /^.*\/level\.dat$/
    ];
    
    for (const pattern of levelDatPatterns) {
      const levelDatFile = Object.keys(zip.files).find(path => path.match(pattern));
      if (levelDatFile) {
        try {
          levelDatBuffer = await zip.files[levelDatFile].async('arraybuffer');
          levelDatFound = true;
          self.postMessage({ 
            type: 'progress',
            data: { 
              message: `Found level.dat at ${levelDatFile}`,
              progress: 9
            }
          });
          break;
        } catch (e) {
          console.warn(`Failed to read level.dat at ${levelDatFile}:`, e);
        }
      }
    }
    
    if (!levelDatFound) {
      console.warn('Could not find level.dat, continuing without world metadata');
    }
    
    // Process region coordinates for optional bounds
    let regionCoords = [];
    
    for (const regionPath of regionFiles) {
      const regionMatch = regionPath.match(/r\.(-?\d+)\.(-?\d+)\.mca$/);
      if (regionMatch) {
        regionCoords.push({
          path: regionPath,
          x: parseInt(regionMatch[1]),
          z: parseInt(regionMatch[2])
        });
      }
    }
    
    // Calculate region bounds
    let minRegionX = Infinity, maxRegionX = -Infinity;
    let minRegionZ = Infinity, maxRegionZ = -Infinity;
    
    for (const region of regionCoords) {
      minRegionX = Math.min(minRegionX, region.x);
      maxRegionX = Math.max(maxRegionX, region.x);
      minRegionZ = Math.min(minRegionZ, region.z);
      maxRegionZ = Math.max(maxRegionZ, region.z);
    }
    
    // Apply region bounds if specified in options
    let regionBounds = null;
    
    if (options.limitRegions) {
      // Limit to central regions if too many regions
      if (regionCoords.length > options.maxRegions && options.maxRegions > 0) {
        const centerX = Math.floor((minRegionX + maxRegionX) / 2);
        const centerZ = Math.floor((minRegionZ + maxRegionZ) / 2);
        const radius = Math.floor(Math.sqrt(options.maxRegions) / 2);
        
        regionBounds = {
          minX: centerX - radius,
          maxX: centerX + radius,
          minZ: centerZ - radius,
          maxZ: centerZ + radius
        };
        
        self.postMessage({ 
          type: 'progress',
          data: { 
            message: `Limiting to ${(regionBounds.maxX - regionBounds.minX + 1) * (regionBounds.maxZ - regionBounds.minZ + 1)} central regions around (${centerX}, ${centerZ})`,
            progress: 10
          }
        });
      } else if (options.regionBounds) {
        // Use custom region bounds if provided
        regionBounds = options.regionBounds;
      }
    }
    
    // Send progress update
    self.postMessage({ 
      type: 'progress', 
      data: { 
        message: `Found ${regionFiles.length} region files in ${maxRegionX - minRegionX + 1}x${maxRegionZ - minRegionZ + 1} area`, 
        progress: 10 
      } 
    });
    
    // Initialize parser with options
    const parserOptions = {
      // Copy options from user input
      ...options,
      // Add calculated region bounds if applicable
      regionBounds: regionBounds || options.regionBounds
    };
    
    self.postMessage({ 
      type: 'progress',
      data: { 
        message: `Initializing parser with options: ${JSON.stringify(parserOptions)}`,
        progress: 12
      }
    });
    
    const parser = new AnvilParser(parserOptions);
    
    // Check world version if level.dat was found
    if (levelDatBuffer) {
      parser.checkWorldVersion(levelDatBuffer);
    }
    
    // Process each region file
    let processedRegions = 0;
    let errorRegions = 0;
    
    // Sort region files by distance from center (if region bounds are active)
    let sortedRegionCoords = [...regionCoords];
    
    if (regionBounds) {
      const centerX = (regionBounds.minX + regionBounds.maxX) / 2;
      const centerZ = (regionBounds.minZ + regionBounds.maxZ) / 2;
      
      sortedRegionCoords.sort((a, b) => {
        const distA = Math.sqrt(Math.pow(a.x - centerX, 2) + Math.pow(a.z - centerZ, 2));
        const distB = Math.sqrt(Math.pow(b.x - centerX, 2) + Math.pow(b.z - centerZ, 2));
        return distA - distB;
      });
    }
    
    for (let i = 0; i < sortedRegionCoords.length; i++) {
      // Check if we should stop processing based on memory usage
      if (options.memoryLimit && self.performance && self.performance.memory) {
        const usedMemory = self.performance.memory.usedJSHeapSize / (1024 * 1024); // MB
        const totalMemory = self.performance.memory.totalJSHeapSize / (1024 * 1024); // MB
        const memoryPercent = (usedMemory / options.memoryLimit) * 100;
        
        if (usedMemory > options.memoryLimit) {
          self.postMessage({ 
            type: 'progress',
            data: { 
              message: `Memory limit reached (${usedMemory.toFixed(2)}MB > ${options.memoryLimit}MB). Stopping after ${processedRegions} regions.`,
              progress: 10 + Math.floor((i / sortedRegionCoords.length) * 80),
              memoryUsage: {
                used: usedMemory,
                total: totalMemory,
                percent: memoryPercent,
                limit: options.memoryLimit
              }
            }
          });
          break;
        }
        
        // Send memory usage every 5 regions
        if (i % 5 === 0) {
          self.postMessage({
            type: 'memoryUpdate',
            data: {
              used: usedMemory,
              total: totalMemory,
              percent: memoryPercent,
              limit: options.memoryLimit
            }
          });
        }
      }
      
      const regionInfo = sortedRegionCoords[i];
      const regionPath = regionInfo.path;
      const regionX = regionInfo.x;
      const regionZ = regionInfo.z;
      
      // Read the region file data
      try {
        const regionBuffer = await zip.files[regionPath].async('arraybuffer');
        
        // Parse the region
        parser.parseRegionFile(regionBuffer, regionX, regionZ, options.debug);
        processedRegions++;
        
        // Send progress update
        const progress = 10 + Math.floor((i / sortedRegionCoords.length) * 80);
        self.postMessage({ 
          type: 'progress', 
          data: { 
            message: `Processed ${i+1}/${sortedRegionCoords.length} regions (${regionX},${regionZ}). Skipped ${parser.skippedChunks.yBounds + parser.skippedChunks.xzBounds} chunks due to filters.`,
            progress, 
            skippedChunks: parser.skippedChunks
          } 
        });
        
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      } catch (error) {
        console.warn(`Error processing region file ${regionPath}:`, error);
        errorRegions++;
        self.postMessage({ 
          type: 'progress', 
          data: { 
            message: `Warning: Skipped region file ${regionPath} due to error`,
            progress: 10 + Math.floor((i / sortedRegionCoords.length) * 80) 
          } 
        });
      }
    }
    
    // Get the processed world data
    const worldData = parser.getWorldData();
    
    // Estimate memory usage
    let estimatedMemory = "Unknown";
    if (self.performance && self.performance.memory) {
      estimatedMemory = (self.performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(2) + " MB";
    }
    
    // Add world info
    worldData.processingStats = {
      regionsProcessed: processedRegions,
      regionsWithErrors: errorRegions,
      totalRegions: regionCoords.length,
      estimatedMemoryUsage: estimatedMemory,
      bounds: regionBounds
    };
    
    // Check if we have any blocks
    if (worldData.totalBlocks === 0) {
      if (processedRegions === 0) {
        throw new Error('Could not process any region files. The world file may be corrupted or in an unsupported format.');
      } else {
        console.warn('No blocks found in processed regions');
        // Continue anyway, but log a warning
      }
    }
    
    // Log stats
    console.log(`Processed ${processedRegions} regions out of ${regionCoords.length}, errors: ${errorRegions}, total blocks: ${worldData.totalBlocks}`);
    
    // Send the blocks data in chunks to avoid UI freezing
    console.log('[CHUNKS] Splitting blocks data into chunks');
    
    // Extract blocks into a separate object to send in chunks
    const blocksData = worldData.blocks || {};
    
    // Create a simplified worldData object without the large blocks property
    const worldDataWithoutBlocks = { ...worldData };
    delete worldDataWithoutBlocks.blocks;
    
    // Send blocks in chunks to avoid message size limits
    const blockEntries = Object.entries(blocksData);
    const totalBlocks = blockEntries.length;
    
    // Increase chunk size for better performance
    const CHUNK_SIZE = 100000; // Blocks per chunk (increased from 50000)
    const totalChunks = Math.ceil(totalBlocks / CHUNK_SIZE);
    
    console.log(`[CHUNKS] Sending ${totalBlocks} blocks in ${totalChunks} chunks of ${CHUNK_SIZE} blocks each`);
    
    // Send the blocks in chunks
    for (let chunkId = 1; chunkId <= totalChunks; chunkId++) {
      const startIndex = (chunkId - 1) * CHUNK_SIZE;
      const endIndex = Math.min(startIndex + CHUNK_SIZE, totalBlocks);
      
      // Create a chunk of blocks
      const chunkBlocks = {};
      for (let i = startIndex; i < endIndex; i++) {
        const [key, value] = blockEntries[i];
        chunkBlocks[key] = value;
      }
      
      // Send this chunk to the main thread
      self.postMessage({
        type: 'blockChunk',
        data: {
          chunkId: chunkId,
          totalChunks: totalChunks,
          blocks: chunkBlocks
        }
      });
      
      // Small delay to allow the main thread to process the message
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    // Final progress update
    self.postMessage({ 
      type: 'progress', 
      data: { 
        message: `World parsing complete - sent ${totalBlocks} blocks in ${totalChunks} chunks`, 
        progress: 100 
      } 
    });
    
    // Send the world data (without blocks) after all chunks are sent
    self.postMessage({
      type: 'worldParsed',
      data: worldDataWithoutBlocks
    });
    
    return worldDataWithoutBlocks;
  } catch (error) {
    console.error('Error parsing Minecraft world:', error);
    throw error; // Re-throw to be caught by the caller
  }
} 