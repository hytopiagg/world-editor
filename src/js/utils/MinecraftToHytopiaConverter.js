import { getHytopiaBlockById, generateUniqueBlockId } from './minecraft/BlockMapper';
import {
	MAX_IMPORT_SIZE_X,
	MAX_IMPORT_SIZE_Y,
	MAX_IMPORT_SIZE_Z
} from '../Constants';

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
		let processedBlocks = 0;
		let skippedBlocks = 0;
		const processedBlockTypes = new Set();

		const hytopiaMap = {
			blockTypes: [],
			blocks: null // Will be set to Int16Array later
		};

		// Process block type mappings
		for (const [mcBlockType, mapping] of Object.entries(this.blockMappings)) {
			if (mapping.action === 'skip') continue;

			let blockType;
			if (mapping.action === 'map') {
				blockType = getHytopiaBlockById(parseInt(mapping.targetBlockId, 10));
			} else if (mapping.action === 'custom') {
				if (mapping.customTextureId) {
					const customBlockId = mapping.customTextureId;
					blockType = {
						id: customBlockId,
						name: mapping.name || this.formatBlockName(mcBlockType),
						textureUri: mapping.customTexture || 'blocks/unknown.png',
						isCustom: true
					};
					console.log(`Using existing custom block ID ${customBlockId} for ${mcBlockType}`);
				} else {
					blockType = {
						id: generateUniqueBlockId(hytopiaMap.blockTypes),
						name: mapping.name || this.formatBlockName(mcBlockType),
						textureUri: mapping.customTexture || 'blocks/unknown.png',
						isCustom: true
					};
					console.log(`Generated new ID ${blockType.id} for custom block ${mcBlockType}`);
				}
			}

			if (blockType) {
				hytopiaMap.blockTypes.push(blockType);
				processedBlockTypes.add(mcBlockType);
			}
		}

		const totalPotentialBlocks = this.calculateTotalPotentialBlocks();
		let processedCount = 0;

		const blockTypeIdMap = {};
		for (const [mcBlockType, mapping] of Object.entries(this.blockMappings)) {
			if (mapping.action === 'skip') continue;

			if (mapping.action === 'map') {
				blockTypeIdMap[mcBlockType] = parseInt(mapping.targetBlockId, 10);
			} else if (mapping.action === 'custom') {
				if (mapping.customTextureId) {
					blockTypeIdMap[mcBlockType] = mapping.customTextureId;
				} else {
					const matchingBlockType = hytopiaMap.blockTypes.find(bt =>
						bt.name === (mapping.name || this.formatBlockName(mcBlockType))
					);
					if (matchingBlockType) {
						blockTypeIdMap[mcBlockType] = matchingBlockType.id;
					}
				}
			}
			console.log(`Block mapping for ${mcBlockType}: ${blockTypeIdMap[mcBlockType]}`);
		}

		const regionWidth = Math.min(this.selectedRegion.maxX - this.selectedRegion.minX + 1, MAX_IMPORT_SIZE_X);
		const regionHeight = Math.min(this.selectedRegion.maxY - this.selectedRegion.minY + 1, MAX_IMPORT_SIZE_Y);
		const regionDepth = Math.min(this.selectedRegion.maxZ - this.selectedRegion.minZ + 1, MAX_IMPORT_SIZE_Z);

		const additionalOffsetX = this.selectedRegion.offsetX || 0;
		const additionalOffsetZ = this.selectedRegion.offsetZ || 0;

		const offsetX = this.selectedRegion.minX + Math.floor(regionWidth / 2);
		const offsetY = this.selectedRegion.minY;
		const offsetZ = this.selectedRegion.minZ + Math.floor(regionDepth / 2);

		const worldBounds = {
			minX: -Math.floor(regionWidth / 2) + additionalOffsetX,
			maxX: regionWidth - Math.floor(regionWidth / 2) - 1 + additionalOffsetX,
			minY: 0,
			maxY: regionHeight - 1,
			minZ: -Math.floor(regionDepth / 2) + additionalOffsetZ,
			maxZ: regionDepth - Math.floor(regionDepth / 2) - 1 + additionalOffsetZ
		};

		console.log(`Centering map: Original region center (${offsetX}, ${offsetY + regionHeight / 2}, ${offsetZ})`);
		console.log(`Additional XZ offsets: (${additionalOffsetX}, ${additionalOffsetZ})`);
		console.log(`After centering, map will extend from (${worldBounds.minX}, ${worldBounds.minY}, ${worldBounds.minZ}) to (${worldBounds.maxX}, ${worldBounds.maxY}, ${worldBounds.maxZ})`);

		// Check if worldData has chunks array (AnvilParser format) or keys object (old format)
		const hasChunksArray = Array.isArray(this.worldData.chunks);
		const hasKeysObject = this.worldData.keys && typeof this.worldData.keys === 'object';
		
		console.log(`Processing blocks from Minecraft world. Format: ${hasChunksArray ? 'chunks array' : (hasKeysObject ? 'keys object' : 'unknown')}`);

		// Collect block data in an array
		const blockData = [];
		
		if (hasChunksArray) {
			// Process AnvilParser format (chunks array)
			console.log(`Processing ${this.worldData.chunks.length} blocks from chunks array`);
			
			for (const chunk of this.worldData.chunks) {
				const { x, y, z, type: mcBlockType } = chunk;
				
				const finalX = x - offsetX + additionalOffsetX;
				const finalY = y - offsetY;
				const finalZ = z - offsetZ + additionalOffsetZ;
				
				if (this.isInFinalRegion(finalX, finalY, finalZ, regionWidth, regionHeight, regionDepth)) {
					const mapping = this.blockMappings[mcBlockType];
					if (mapping && mapping.action !== 'skip' && blockTypeIdMap[mcBlockType]) {
						const hytopiaBlockId = blockTypeIdMap[mcBlockType];
						blockData.push([finalX, finalY, finalZ, hytopiaBlockId]);
						processedBlocks++;
					} else {
						skippedBlocks++;
					}
				}
				
				processedCount++;
				if (this.progressCallback && processedCount % 10000 === 0) {
					const progress = Math.floor((processedCount / totalPotentialBlocks) * 100);
					this.progressCallback(progress);
				}
			}
		} else if (hasKeysObject) {
			// Process old format (keys object)
			console.log(`Processing ${Object.keys(this.worldData.keys).length} blocks from keys object`);
			
			for (const [positionKey, blockId] of Object.entries(this.worldData.keys)) {
				const [x, y, z] = positionKey.split(',').map(Number);
				const mcBlockType = this.worldData.blockTypes[blockId];
				
				const finalX = x - offsetX + additionalOffsetX;
				const finalY = y - offsetY;
				const finalZ = z - offsetZ + additionalOffsetZ;
				
				if (this.isInFinalRegion(finalX, finalY, finalZ, regionWidth, regionHeight, regionDepth)) {
					const mapping = this.blockMappings[mcBlockType];
					if (mapping && mapping.action !== 'skip' && blockTypeIdMap[mcBlockType]) {
						const hytopiaBlockId = blockTypeIdMap[mcBlockType];
						blockData.push([finalX, finalY, finalZ, hytopiaBlockId]);
						processedBlocks++;
					} else {
						skippedBlocks++;
					}
				}
				
				processedCount++;
				if (this.progressCallback && processedCount % 10000 === 0) {
					const progress = Math.floor((processedCount / totalPotentialBlocks) * 100);
					this.progressCallback(progress);
				}
			}
		} else {
			console.error("Unknown world data format:", this.worldData);
			throw new Error("Unknown world data format. Cannot process blocks.");
		}

		console.log(`Collected ${blockData.length} blocks for conversion`);

		// Convert blockData to Int16Array
		const blockArray = new Int16Array(blockData.length * 4);
		blockData.forEach((block, index) => {
			const offset = index * 4;
			blockArray[offset] = block[0];     // x
			blockArray[offset + 1] = block[1]; // y
			blockArray[offset + 2] = block[2]; // z
			blockArray[offset + 3] = block[3]; // id
		});

		// Set the blocks as Int16Array
		hytopiaMap.blocks = blockArray;

		console.log(`Conversion complete: Processed ${processedBlocks} blocks, skipped ${skippedBlocks} blocks`);

		if (processedBlocks === 0) {
			if (this.progressCallback) {
				this.progressCallback(100);
			}
			return {
				success: false,
				error: "No blocks were imported. Check your block mappings.",
				stats: {
					processedBlocks: 0,
					skippedBlocks: 0,
					uniqueBlockTypes: [],
					originalCenter: { x: offsetX, y: offsetY + Math.floor(regionHeight / 2), z: offsetZ },
					worldBounds
				}
			};
		}

		if (this.progressCallback) {
			this.progressCallback(100);
		}

		return {
			success: true,
			hytopiaMap,
			stats: {
				processedBlocks,
				skippedBlocks,
				uniqueBlockTypes: Array.from(processedBlockTypes),
				originalCenter: { x: offsetX, y: offsetY + Math.floor(regionHeight / 2), z: offsetZ },
				worldBounds
			}
		};
	}

	isInFinalRegion(finalX, finalY, finalZ, regionWidth, regionHeight, regionDepth) {
		return finalX >= -Math.floor(regionWidth / 2) &&
			finalX <= regionWidth - Math.floor(regionWidth / 2) - 1 &&
			finalY >= 0 &&
			finalY <= regionHeight - 1 &&
			finalZ >= -Math.floor(regionDepth / 2) &&
			finalZ <= regionDepth - Math.floor(regionDepth / 2) - 1;
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
			.replace('minecraft:', '')
			.split('_')
			.map(word => word.charAt(0).toUpperCase() + word.slice(1))
			.join(' ');
	}
}