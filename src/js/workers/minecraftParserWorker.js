/* eslint-disable no-restricted-globals */
import JSZip from 'jszip';
import { AnvilParser } from '../utils/minecraft/AnvilParser';

// Handle messages from main thread
self.onmessage = async function(event) {
  const { type, data } = event.data;
  
  if (type === 'parseWorld') {
    try {
      const zipData = data.zipFile;
      const worldData = await parseMinecraftWorld(zipData);
      
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

async function parseMinecraftWorld(zipData) {
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
    
    // Send progress update
    self.postMessage({ 
      type: 'progress', 
      data: { 
        message: `Found ${regionFiles.length} region files`, 
        progress: 10 
      } 
    });
    
    // Parse level.dat for world info (optional)
    let worldInfo = null;
    if (zip.files['level.dat']) {
      try {
        const levelDatBuffer = await zip.files['level.dat'].async('arraybuffer');
        // Simple check for valid level.dat without trying to parse
        worldInfo = { exists: true };
      } catch (e) {
        console.warn('Failed to process level.dat:', e);
      }
    } else {
      // Try to find level.dat in subfolders
      const levelDatFile = Object.keys(zip.files).find(path => path.endsWith('/level.dat'));
      if (levelDatFile) {
        try {
          const levelDatBuffer = await zip.files[levelDatFile].async('arraybuffer');
          worldInfo = { exists: true, path: levelDatFile };
        } catch (e) {
          console.warn(`Failed to process level.dat at ${levelDatFile}:`, e);
        }
      }
    }
    
    // Initialize parser
    const parser = new AnvilParser();
    
    // Process each region file
    let processedRegions = 0;
    let errorRegions = 0;
    
    for (let i = 0; i < regionFiles.length; i++) {
      const regionPath = regionFiles[i];
      
      // Extract region coordinates from filename
      // Format is typically r.X.Z.mca where X and Z are the region coordinates
      const regionMatch = regionPath.match(/r\.(-?\d+)\.(-?\d+)\.mca$/);
      
      if (!regionMatch) {
        console.warn(`Could not parse coordinates from region file: ${regionPath}`);
        errorRegions++;
        continue;
      }
      
      const regionX = parseInt(regionMatch[1]);
      const regionZ = parseInt(regionMatch[2]);
      
      // Read the region file data
      try {
        const regionBuffer = await zip.files[regionPath].async('arraybuffer');
        
        // Parse the region
        parser.parseRegionFile(regionBuffer, regionX, regionZ);
        processedRegions++;
        
        // Send progress update
        const progress = 10 + Math.floor((i / regionFiles.length) * 80);
        self.postMessage({ 
          type: 'progress', 
          data: { 
            message: `Processed region ${i+1}/${regionFiles.length} (${regionX},${regionZ})`,
            progress 
          } 
        });
      } catch (error) {
        console.warn(`Error processing region file ${regionPath}:`, error);
        errorRegions++;
        self.postMessage({ 
          type: 'progress', 
          data: { 
            message: `Warning: Skipped region file ${regionPath} due to error`,
            progress: 10 + Math.floor((i / regionFiles.length) * 80) 
          } 
        });
      }
    }
    
    // Get the processed world data
    const worldData = parser.getWorldData();
    
    // Add world info if available
    if (worldInfo) {
      worldData.worldInfo = worldInfo;
    }
    
    // Check if we have any blocks
    if (Object.keys(worldData.chunks).length === 0) {
      if (processedRegions === 0) {
        throw new Error('Could not process any region files. The world file may be corrupted or in an unsupported format.');
      } else {
        console.warn('No blocks found in processed regions');
        // Continue anyway, but log a warning
      }
    }
    
    // Log stats
    console.log(`Processed ${processedRegions} regions, errors: ${errorRegions}, total blocks: ${Object.keys(worldData.chunks).length}`);
    
    // Final progress update
    self.postMessage({ 
      type: 'progress', 
      data: { 
        message: `World parsing complete - found ${Object.keys(worldData.chunks).length} blocks`, 
        progress: 100 
      } 
    });
    
    return worldData;
  } catch (error) {
    console.error('Error parsing Minecraft world:', error);
    throw error; // Re-throw to be caught by the caller
  }
} 