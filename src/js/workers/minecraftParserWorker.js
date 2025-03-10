/* eslint-disable no-restricted-globals */
import JSZip from 'jszip';
import { AnvilParser } from '../utils/minecraft/AnvilParser';

// Handle messages from main thread
self.onmessage = async function(event) {
  const { type, data } = event.data;
  
  if (type === 'parseWorld') {
    try {
      const zipData = data.zipFile;
      const options = data.options || {}; // Extract options from the message
      
      self.postMessage({
        type: 'progress', 
        data: { 
          message: `Starting world parsing with options: ${JSON.stringify(options)}`, 
          progress: 2 
        } 
      });
      
      const worldData = await parseMinecraftWorld(zipData, options);
      
      self.postMessage({
        type: 'worldParsed',
        data: worldData
      });
    } catch (error) {
      self.postMessage({
        type: 'error',
        error: error.message || 'Unknown error during world parsing'
      });
    }
  }
};

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
    
    // Final progress update
    self.postMessage({ 
      type: 'progress', 
      data: { 
        message: `World parsing complete - found ${worldData.totalBlocks} blocks in ${processedRegions} regions`, 
        progress: 100 
      } 
    });
    
    return worldData;
  } catch (error) {
    console.error('Error parsing Minecraft world:', error);
    throw error; // Re-throw to be caught by the caller
  }
} 