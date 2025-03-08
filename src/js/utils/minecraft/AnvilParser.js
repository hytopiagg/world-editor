/* global BigInt */
import { NBTParser } from './NBTParser';

export class AnvilParser {
	constructor() {
		this.minX = Infinity;
		this.minY = Infinity;
		this.minZ = Infinity;
		this.maxX = -Infinity;
		this.maxY = -Infinity;
		this.maxZ = -Infinity;
		this.chunks = [];
		this.blockTypes = new Set();
		this.blockCount = 0; // Track blocks added
		this.worldVersion = null; // Store world version
	}

	// Check Minecraft world version from level.dat
	checkWorldVersion(levelDatBuffer) {
		try {
			const nbtData = NBTParser.parse(levelDatBuffer);
			const dataVersion = nbtData.Data?.DataVersion || nbtData.DataVersion;
			
			this.worldVersion = dataVersion;
			console.log(`World Data Version: ${dataVersion}`);

			// Minecraft 1.21 is Data Version 3953
			if (dataVersion === 3953) {
				console.log('World is fully compatible with Minecraft 1.21');
				return true;
			} else if (dataVersion > 3953) {
				console.log('World is from a newer version than 1.21. May not be fully compatible.');
				return false;
			} else {
				console.log(`World is from an older version (Data Version ${dataVersion}). Needs updating to 1.21.`);
				return false;
			}
		} catch (e) {
			console.error('Error parsing level.dat:', e);
			return false;
		}
	}

	// Function to check world version from a ZIP file
	async checkWorldVersionFromZip(zipFiles) {
		// Find level.dat in the ZIP
		const levelDatFile = Object.keys(zipFiles).find(file => file.endsWith('level.dat'));
		if (!levelDatFile) {
			console.error('level.dat not found in ZIP');
			return false;
		}

		const buffer = zipFiles[levelDatFile]; // Get buffer from ZIP
		return this.checkWorldVersion(buffer);
	}

	parseRegionFile(buffer, regionX, regionZ, debug = false) {
		try {
			console.log(`Parsing region file (${regionX}, ${regionZ}), buffer size: ${buffer.byteLength} bytes`);
			if (!buffer || buffer.byteLength < 8192) {
				console.warn(`Region file is too small (${buffer.byteLength} bytes)`);
				return;
			}
			const view = new DataView(buffer);
			let chunksProcessed = 0;
			let chunksSuccessful = 0;
			for (let localZ = 0; localZ < 32; localZ++) {
				for (let localX = 0; localX < 32; localX++) {
					const index = localX + localZ * 32;
					const locationOffset = index * 4;
					if (locationOffset + 4 > buffer.byteLength) {
						console.warn(`Location offset out of bounds: ${locationOffset}`);
						continue;
					}
					const offset = view.getUint32(locationOffset) >>> 8;
					const sectorCount = view.getUint8(locationOffset + 3);
					if (offset === 0 || sectorCount === 0) continue;
					try {
						chunksProcessed++;
						const chunkData = this.readChunkData(buffer, offset * 4096);
						if (chunkData) {
							console.log(`Chunk keys: ${Object.keys(chunkData)}`);
							const chunkX = regionX * 32 + localX;
							const chunkZ = regionZ * 32 + localZ;
							this.processChunk(chunkData, chunkX, chunkZ, debug);
							chunksSuccessful++;
						}
					} catch (e) {
						console.warn(`Error processing chunk at (${localX}, ${localZ}):`, e);
					}
				}
			}
			console.log(`Region (${regionX}, ${regionZ}): Processed ${chunksProcessed} chunks, successful: ${chunksSuccessful}`);
			console.log(`Total blocks added: ${this.blockCount}`);
		} catch (e) {
			console.error(`Failed to parse region file (${regionX}, ${regionZ}):`, e);
		}
	}

	readChunkData(buffer, offset) {
		try {
			const view = new DataView(buffer);
			if (offset + 5 >= buffer.byteLength) {
				console.warn('Invalid chunk offset or data length');
				return null;
			}
			const length = view.getUint32(offset, false);
			if (length <= 0 || offset + 5 + length > buffer.byteLength) {
				console.warn('Invalid chunk length:', length, 'buffer size:', buffer.byteLength);
				return null;
			}
			const compressionType = view.getUint8(offset + 4);
			const compressedData = buffer.slice(offset + 5, offset + 5 + length - 1);
			const nbtData = NBTParser.parse(compressedData);
			
			// Check chunk data version
			if (nbtData.DataVersion && !this.worldVersion) {
				this.worldVersion = nbtData.DataVersion;
				console.log(`Detected world version from chunk: ${this.worldVersion}`);
				
				// Check compatibility with Minecraft 1.21 (Data Version 3953)
				if (this.worldVersion === 3953) {
					console.log('Chunk format is compatible with Minecraft 1.21');
				} else if (this.worldVersion > 3953) {
					console.log('Chunk format is from a newer version than 1.21. May not be fully compatible.');
				} else {
					console.log(`Chunk format is from an older version (Data Version ${this.worldVersion}). May need updating.`);
				}
			}
			
			return nbtData;
		} catch (e) {
			console.warn('Error processing chunk data:', e);
			return null;
		}
	}

	processChunk(chunkData, chunkX, chunkZ, debug = false) {
		try {
			if (debug) {
				console.log(`Processing chunk (${chunkX}, ${chunkZ})`);
				console.log('Chunk top-level keys:', Object.keys(chunkData));
				console.log('Chunk DataVersion:', chunkData.DataVersion || 'Not found');
			}
			
			if (chunkData.sections && Array.isArray(chunkData.sections)) {
				if (debug) {
					console.log(`Found ${chunkData.sections.length} sections`);
				}
				
				for (const section of chunkData.sections) {
					if (!section.block_states) {
						console.log(`Section at Y=${section.Y} has no block_states. Keys: ${Object.keys(section)}`);
						continue;
					}
					
					const y = section.Y ?? section.y ?? null;
					if (y === null) {
						console.warn('Section has no Y coordinate');
						continue;
					}
					
					if (debug) {
						console.log(`Section Y=${y}, block_states keys: ${Object.keys(section.block_states)}`);
					}
					
					this.processModern121Section(section, chunkX, chunkZ, y);
				}
			} else {
				console.warn('No sections array found in chunk data. Available keys:', Object.keys(chunkData));
			}
		} catch (e) {
			console.error('Error processing chunk:', e);
		}
	}

	processModern121Section(section, chunkX, chunkZ, sectionY) {
		try {
			const blockStatesCompound = section.block_states;
			if (!blockStatesCompound) {
				console.log(`Section at Y=${sectionY} has no block_states.`);
				return;
			}
			const palette = blockStatesCompound.palette;
			const blockStates = blockStatesCompound.data;

			if (!palette) {
				console.log(`Section at Y=${sectionY} has no palette. block_states keys: ${Object.keys(blockStatesCompound)}`);
				return;
			}

			// Precompute block names from palette
			const blockNames = palette.map(entry => typeof entry === 'string' ? entry : entry.Name);

			if (!blockStates) {
				// Handle single-state section (no data array)
				if (palette.length === 1) {
					const blockName = blockNames[0];
					if (blockName !== 'minecraft:air') {
						console.log(`Single-state section at Y=${sectionY} with block: ${blockName}`);
						for (let y = 0; y < 16; y++) {
							for (let z = 0; z < 16; z++) {
								for (let x = 0; x < 16; x++) {
									const globalX = chunkX * 16 + x;
									const globalY = sectionY * 16 + y;
									const globalZ = chunkZ * 16 + z;
									this.addBlock(globalX, globalY, globalZ, blockName);
								}
							}
						}
					} else {
						console.log(`Section at Y=${sectionY} is all air (single-state)`);
					}
				} else {
					console.warn(`Section at Y=${sectionY} has no block states data but palette has ${palette.length} entries. block_states keys: ${Object.keys(blockStatesCompound)}`);
				}
				return;
			}

			// Normal case: process block states with data array
			const bitsPerBlock = Math.max(4, Math.ceil(Math.log2(palette.length)));
			const blocksPerLong = Math.floor(64 / bitsPerBlock);
			const mask = (1n << BigInt(bitsPerBlock)) - 1n;
			let blockIndex = 0;

			for (let longIndex = 0; longIndex < blockStates.length; longIndex++) {
				const value = BigInt(blockStates[longIndex]);
				for (let i = 0; i < blocksPerLong && blockIndex < 4096; i++) {
					const stateIndex = Number((value >> BigInt(i * bitsPerBlock)) & mask);
					if (stateIndex < blockNames.length) {
						const blockName = blockNames[stateIndex];
						if (blockName !== 'minecraft:air') {
							const y = Math.floor(blockIndex / 256);
							const z = Math.floor((blockIndex % 256) / 16);
							const x = blockIndex % 16;
							const globalX = chunkX * 16 + x;
							const globalY = sectionY * 16 + y;
							const globalZ = chunkZ * 16 + z;
							this.addBlock(globalX, globalY, globalZ, blockName);
						}
					}
					blockIndex++;
				}
			}
		} catch (e) {
			console.error('Error processing modern section:', e);
		}
	}

	addBlock(x, y, z, blockName) {
		this.minX = Math.min(this.minX, x);
		this.minY = Math.min(this.minY, y);
		this.minZ = Math.min(this.minZ, z);
		this.maxX = Math.max(this.maxX, x);
		this.maxY = Math.max(this.maxY, y);
		this.maxZ = Math.max(this.maxZ, z);
		this.chunks.push({ type: blockName, x, y, z });
		this.blockTypes.add(blockName);
		this.blockCount = (this.blockCount || 0) + 1;
	}

	getWorldData() {
		return {
			blockTypes: Array.from(this.blockTypes),
			chunks: this.chunks,
			bounds: {
				minX: this.minX,
				minY: this.minY,
				minZ: this.minZ,
				maxX: this.maxX,
				maxY: this.maxY,
				maxZ: this.maxZ
			},
			worldVersion: this.worldVersion,
			totalBlocks: this.blockCount
		};
	}

	debugChunkStructure(chunkData, prefix = '', maxDepth = 3, currentDepth = 0) {
		if (currentDepth > maxDepth) return;
		if (!chunkData || typeof chunkData !== 'object') {
			console.log(`${prefix}Value: ${chunkData}`);
			return;
		}
		if (Array.isArray(chunkData)) {
			console.log(`${prefix}Array with ${chunkData.length} items`);
			if (chunkData.length > 0 && currentDepth < maxDepth) {
				const sampleSize = Math.min(3, chunkData.length);
				for (let i = 0; i < sampleSize; i++) {
					console.log(`${prefix}  [${i}]:`);
					this.debugChunkStructure(chunkData[i], `${prefix}    `, maxDepth, currentDepth + 1);
				}
				if (chunkData.length > sampleSize) {
					console.log(`${prefix}  ... (${chunkData.length - sampleSize} more items)`);
				}
			}
			return;
		}
		const keys = Object.keys(chunkData);
		console.log(`${prefix}Object with ${keys.length} keys: ${keys.join(', ')}`);
		if (currentDepth < maxDepth) {
			for (const key of keys) {
				console.log(`${prefix}  ${key}:`);
				this.debugChunkStructure(chunkData[key], `${prefix}    `, maxDepth, currentDepth + 1);
			}
		}
	}
}