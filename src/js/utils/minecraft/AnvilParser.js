/* global BigInt */
import { NBTParser } from './NBTParser';

export class AnvilParser {
	constructor(selectedRegion) {
		this.selectedMinX = selectedRegion?.minX ?? -Infinity;
		this.selectedMaxX = selectedRegion?.maxX ?? Infinity;
		this.selectedMinY = selectedRegion?.minY ?? -Infinity;
		this.selectedMaxY = selectedRegion?.maxY ?? Infinity;
		this.selectedMinZ = selectedRegion?.minZ ?? -Infinity;
		this.selectedMaxZ = selectedRegion?.maxZ ?? Infinity;
		this.minX = Infinity;
		this.minY = Infinity;
		this.minZ = Infinity;
		this.maxX = -Infinity;
		this.maxY = -Infinity;
		this.maxZ = -Infinity;
		this.keys = {};
		this.blockTypes = [];
		this.blockTypeMap = new Map();
		this.blockCount = 0;
		this.worldVersion = null;
	}

	// Check Minecraft world version from level.dat
	checkWorldVersion(levelDatBuffer) {
		try {
			const nbtData = NBTParser.parse(levelDatBuffer);
			const dataVersion = nbtData.Data?.DataVersion || nbtData.DataVersion;
			this.worldVersion = dataVersion;
			console.log(`World Data Version: ${dataVersion}`);
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
		const levelDatFile = Object.keys(zipFiles).find(file => file.endsWith('level.dat'));
		if (!levelDatFile) {
			console.error('level.dat not found in ZIP');
			return false;
		}
		const buffer = zipFiles[levelDatFile];
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
					const chunkX = regionX * 32 + localX;
					const chunkZ = regionZ * 32 + localZ;
					const chunkMinX = chunkX * 16;
					const chunkMaxX = chunkMinX + 15;
					const chunkMinZ = chunkZ * 16;
					const chunkMaxZ = chunkMinZ + 15;

					if (chunkMaxX < this.selectedMinX || chunkMinX > this.selectedMaxX ||
						chunkMaxZ < this.selectedMinZ || chunkMinZ > this.selectedMaxZ) {
						continue;
					}

					const index = localX + localZ * 32;
					const locationOffset = index * 4;
					if (locationOffset + 4 > buffer.byteLength) continue;
					const offset = view.getUint32(locationOffset) >>> 8;
					const sectorCount = view.getUint8(locationOffset + 3);
					if (offset === 0 || sectorCount === 0) continue;
					try {
						chunksProcessed++;
						const chunkData = this.readChunkData(buffer, offset * 4096);
						if (chunkData) {
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
			if (nbtData.DataVersion && !this.worldVersion) {
				this.worldVersion = nbtData.DataVersion;
				console.log(`Detected world version from chunk: ${this.worldVersion}`);
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
			}
			if (chunkData.sections && Array.isArray(chunkData.sections)) {
				for (const section of chunkData.sections) {
					if (!section.block_states) continue;
					const y = section.Y ?? section.y ?? null;
					if (y === null) continue;

					const sectionMinY = y * 16;
					const sectionMaxY = sectionMinY + 15;
					if (sectionMaxY < this.selectedMinY || sectionMinY > this.selectedMaxY) {
						continue;
					}

					this.processModern121Section(section, chunkX, chunkZ, y);
				}
			}
		} catch (e) {
			console.error('Error processing chunk:', e);
		}
	}

	processModern121Section(section, chunkX, chunkZ, sectionY) {
		try {
			const blockStatesCompound = section.block_states;
			if (!blockStatesCompound || !blockStatesCompound.palette) return;

			const palette = blockStatesCompound.palette;
			const blockStates = blockStatesCompound.data;
			const blockNames = palette.map(entry => typeof entry === 'string' ? entry : entry.Name);

			if (!blockStates) {
				if (palette.length === 1 && blockNames[0] !== 'minecraft:air') {
					for (let y = 0; y < 16; y++) {
						for (let z = 0; z < 16; z++) {
							for (let x = 0; x < 16; x++) {
								const globalX = chunkX * 16 + x;
								const globalY = sectionY * 16 + y;
								const globalZ = chunkZ * 16 + z;
								this.addBlock(globalX, globalY, globalZ, blockNames[0]);
							}
						}
					}
				}
				return;
			}

			const bitsPerBlock = Math.max(4, Math.ceil(Math.log2(palette.length)));
			const blocksPerLong = Math.floor(64 / bitsPerBlock);
			const mask = (1n << BigInt(bitsPerBlock)) - 1n;
			let blockIndex = 0;

			for (let longIndex = 0; longIndex < blockStates.length; longIndex++) {
				const value = BigInt(blockStates[longIndex]);
				for (let i = 0; i < blocksPerLong && blockIndex < 4096; i++) {
					const stateIndex = Number((value >> BigInt(i * bitsPerBlock)) & mask);
					if (stateIndex < blockNames.length && blockNames[stateIndex] !== 'minecraft:air') {
						const y = Math.floor(blockIndex / 256);
						const z = Math.floor((blockIndex % 256) / 16);
						const x = blockIndex % 16;
						const globalX = chunkX * 16 + x;
						const globalY = sectionY * 16 + y;
						const globalZ = chunkZ * 16 + z;
						this.addBlock(globalX, globalY, globalZ, blockNames[stateIndex]);
					}
					blockIndex++;
				}
			}
		} catch (e) {
			console.error('Error processing modern section:', e);
		}
	}

	addBlock(x, y, z, blockName) {
		if (x < this.selectedMinX || x > this.selectedMaxX ||
			y < this.selectedMinY || y > this.selectedMaxY ||
			z < this.selectedMinZ || z > this.selectedMaxZ) {
			return;
		}

		let blockId = this.blockTypeMap.get(blockName);
		if (blockId === undefined) {
			blockId = this.blockTypes.length;
			this.blockTypes.push(blockName);
			this.blockTypeMap.set(blockName, blockId);
		}

		const key = `${x},${y},${z}`;
		this.keys[key] = blockId;

		this.minX = Math.min(this.minX, x);
		this.minY = Math.min(this.minY, y);
		this.minZ = Math.min(this.minZ, z);
		this.maxX = Math.max(this.maxX, x);
		this.maxY = Math.max(this.maxY, y);
		this.maxZ = Math.max(this.maxZ, z);
		this.blockCount++;
	}

	getWorldData() {
		return {
			blockTypes: this.blockTypes,
			blocks: this.keys,
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
}