/**
 * BlockTypesManager
 * Manages block types, custom blocks, and block operations for the terrain builder
 */

// Initialize blockTypesArray
let blockTypesArray = (() => {
	const textureContext = require.context("../../../public/assets/blocks", true, /\.(png|jpe?g)$/);
	const texturePaths = textureContext.keys();
	const blockMap = new Map();
	let idCounter = 1;

	texturePaths.forEach((path) => {
		// Skip environment and error textures
		if (path.includes("environment") || path.includes("error")) {
			return;
		}

		const match = path.match(/^\.\/(.+?)(\/[+-][xyz])?\.png$/);
		if (match) {
			const [, fullName, side] = match;
			const parts = fullName.split("/");
			const blockName = parts.length > 1 ? parts[0] : fullName.replace(/\.[^/.]+$/, "");

			if (!blockMap.has(blockName)) {
				blockMap.set(blockName, {
					id: idCounter++,
					name: blockName,
					textureUri: `./assets/blocks/${blockName}.png`,
					sideTextures: {},
				});
			}

			if (side) {
				const sideKey = side.slice(1);
				blockMap.get(blockName).sideTextures[sideKey] = `./assets/blocks/${blockName}${side}.png`;
			}
		}
	});

	return Array.from(blockMap.values()).map((block) => ({
		...block,
		isMultiTexture: Object.keys(block.sideTextures).length > 0,
		isEnvironment: false,
		hasMissingTexture: block.textureUri === "./assets/blocks/error.png",
	}));
})();

/**
 * Add or update a custom block
 * @param {Object} block - The block to add or update
 * @param {boolean} deferAtlasRebuild - Whether to defer atlas rebuilding (useful for batch operations)
 * @returns {Array} - The updated block types array
 */
const processCustomBlock = (block, deferAtlasRebuild = false) => {
	const blockId = parseInt(block.id);
	const ERROR_TEXTURE_PATH = './assets/blocks/error.png';

	// 1. Check if block already exists
	const existingIndex = blockTypesArray.findIndex(b => b.id === blockId);
	const existingBlock = existingIndex >= 0 ? blockTypesArray[existingIndex] : null;

	// 2. Check if existing block already has a loaded texture (data URI)
	if (existingBlock && existingBlock.textureUri && existingBlock.textureUri.startsWith('data:image/')) {
		console.log(`Custom block ${blockId} (${existingBlock.name}) already exists with a loaded texture. Skipping import processing.`);
		return blockTypesArray; // Skip processing
	}

	// 3. Determine the texture URI to use
	let finalTextureUri = block.textureUri;
	let needsRegistryUpdate = false;

	// Check if the incoming URI is a placeholder path (not a data URI)
	if (finalTextureUri && !finalTextureUri.startsWith('data:image/') && !finalTextureUri.startsWith('./')) {
		console.log(`Custom block ${blockId} has a placeholder URI: ${finalTextureUri}. Attempting to load from localStorage.`);
		// It's likely a placeholder path like 'blocks/custom/MyBlock.png'
		// Attempt to load the actual data URI from localStorage
		const storageKeys = [
			`block-texture-${blockId}`,
			`custom-block-${blockId}`,
			`datauri-${blockId}`
		];
		let foundDataUri = null;
		for (const key of storageKeys) {
			const storedUri = localStorage.getItem(key);
			if (storedUri && storedUri.startsWith('data:image/')) {
				foundDataUri = storedUri;
				console.log(`Found data URI for block ${blockId} in localStorage key: ${key}`);
				break;
			}
		}

		// 4. Use error texture if not found in localStorage
		if (foundDataUri) {
			finalTextureUri = foundDataUri;
			needsRegistryUpdate = true; // We found the data, need to register it
		} else {
			console.warn(`Data URI for custom block ${blockId} (${block.name}) not found in localStorage. Using error texture.`);
			finalTextureUri = ERROR_TEXTURE_PATH;
			// Even with error texture, we might need to register it if the block is new
			needsRegistryUpdate = !existingBlock; 
		}
	} else if (finalTextureUri && finalTextureUri.startsWith('data:image/')) {
		// It's an incoming data URI, likely from a file upload or direct creation
		needsRegistryUpdate = true;
	} else if (!finalTextureUri) {
		// No texture URI provided at all
		console.warn(`No texture URI provided for custom block ${blockId} (${block.name}). Using error texture.`);
		finalTextureUri = ERROR_TEXTURE_PATH;
		needsRegistryUpdate = !existingBlock;
	}

	// Set default id if needed (only for truly new blocks, not updates)
	if (!block.id && !existingBlock) {
		const highestId = blockTypesArray
			.filter(b => b.id >= 100)
			.reduce((max, b) => Math.max(max, b.id), 99);
		block.id = highestId + 1;
	}
  
	// Ensure the block has required properties
	const processedBlock = {
		...block, // Keep incoming properties like isMultiTexture, sideTextures
		id: parseInt(block.id), // Use the potentially generated ID
		name: block.name || `Custom Block ${block.id}`,
		textureUri: finalTextureUri, // Use the determined URI (data, placeholder, or error)
		sideTextures: block.sideTextures || {},
		// Recalculate isMultiTexture based on final sideTextures
		isMultiTexture: block.sideTextures && Object.keys(block.sideTextures).length > 0,
		isCustom: true
	};
  
	// Update or add the block in our local array
	if (existingIndex >= 0) {
		blockTypesArray[existingIndex] = processedBlock;
	} else {
		blockTypesArray.push(processedBlock);
	}
  
	// Register the block texture in the BlockTypeRegistry if needed
	if (needsRegistryUpdate && finalTextureUri) {
		try {
			if (window.BlockTypeRegistry && window.BlockTypeRegistry.instance) {
				const registry = window.BlockTypeRegistry.instance;
				if (registry.registerCustomTextureForBlockId) {
					registry.registerCustomTextureForBlockId(
						processedBlock.id, 
						finalTextureUri, // Use the final URI (could be data or error path)
						{
							name: processedBlock.name,
							updateMeshes: true,
							rebuildAtlas: !deferAtlasRebuild 
						}
					).then(() => {
						const event = new CustomEvent('custom-block-registered', {
							detail: { blockId: processedBlock.id, name: processedBlock.name }
						});
						window.dispatchEvent(event);
					}).catch(error => {
						console.error(`Error registering custom block ${processedBlock.id} in BlockTypeRegistry:`, error);
					});
				}
			}
		} catch (error) {
			console.error(`Error during BlockTypeRegistry registration for block ID ${processedBlock.id}:`, error);
		}
	}
  
	// Return the updated array
	return [...blockTypesArray]; 
};

/**
 * Process multiple custom blocks in batch for better performance
 * @param {Array<Object>} blocks - Array of blocks to process
 * @returns {Array} - The updated block types array
 */
const batchProcessCustomBlocks = async (blocks) => {
	if (!Array.isArray(blocks) || blocks.length === 0) {
		return blockTypesArray;
	}
  
	// Process each block locally without rebuilding the atlas
	const processedBlocks = blocks.map(block => {
		// Add block to our local registry first
		processCustomBlock(block, true); // defer atlas rebuild
		return {
			blockId: block.id || parseInt(block.id),
			dataUri: block.textureUri,
			name: block.name
		};
	});
  
	// If we have the batch registration function available, use it
	if (window.batchRegisterCustomTextures) {
		try {
			// This will register all textures and only rebuild the atlas once
			await window.batchRegisterCustomTextures(
				processedBlocks.map(pb => ({
					blockId: pb.blockId,
					dataUri: pb.dataUri
				})),
				{ updateMeshes: true }
			);
		} catch (error) {
			console.error('Error in batch registering custom textures:', error);
		}
	}
  
	return [...blockTypesArray];
};

/**
 * Place a custom block in the world
 * @param {number} blockId - The block ID to place
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} z - Z coordinate
 * @returns {Promise<boolean>} - Success status
 */
const placeCustomBlock = async (blockId, x = 0, y = 0, z = 0) => {
	// Get the block from our registry
	const block = getBlockById(blockId);
	
	if (!block) {
		console.error(`Block with ID ${blockId} not found`);
		return false;
	}
	
	try {
		// Check if we have the createBlockAt helper function
		if (window.createBlockAt) {
			return await window.createBlockAt(blockId, x, y, z);
		} 
		// Alternative: Try to use terrainBuilderRef directly
		else if (window.terrainBuilderRef && window.terrainBuilderRef.current) {
			const terrainBuilder = window.terrainBuilderRef.current;
			
			if (terrainBuilder.fastUpdateBlock) {
				terrainBuilder.fastUpdateBlock({x, y, z}, blockId);
				return true;
			}
			else if (terrainBuilder.updateTerrainBlocks) {
				const position = `${x},${y},${z}`;
				const blocks = {};
				blocks[position] = blockId;
				
				terrainBuilder.updateTerrainBlocks(blocks, {}, {source: 'custom'});
				return true;
			}
			else if (terrainBuilder.buildUpdateTerrain) {
				const blockData = {};
				blockData[`${x},${y},${z}`] = blockId;
				
				terrainBuilder.buildUpdateTerrain({blocks: blockData});
				return true;
			}
			else {
				console.error('No suitable method found on terrainBuilderRef.current to place blocks');
				return false;
			}
		}
		else {
			console.error('Cannot place block: terrainBuilderRef or createBlockAt not available');
			return false;
		}
	} catch (error) {
		console.error(`Error placing custom block:`, error);
		return false;
	}
};

/**
 * Remove a custom block by ID
 * @param {number} blockIdToRemove - The ID of the block to remove
 * @returns {Array} - The updated block types array
 */
const removeCustomBlock = (blockIdToRemove) => {
	// Ensure blockIdToRemove is a number
	const id = parseInt(blockIdToRemove);
  
	// Only allow removing custom blocks (ID >= 100)
	if (id < 100) {
		console.warn('Cannot remove built-in blocks');
		return blockTypesArray;
	}
  
	// Remove the block
	blockTypesArray = blockTypesArray.filter(block => block.id !== id);
  
	// Return the updated array
	return [...blockTypesArray];
};

/**
 * Get all block types
 * @returns {Array} - All block types
 */
const getBlockTypes = () => blockTypesArray;

/**
 * Get only custom blocks (ID >= 100)
 * @returns {Array} - Custom blocks
 */
const getCustomBlocks = () => {
	return blockTypesArray.filter(block => block.id >= 100);
};

/**
 * Search blocks by name or ID
 * @param {string} query - Search query
 * @returns {Array} - Matching blocks
 */
const searchBlocks = (query) => {
	if (!query) return blockTypesArray;
	
	const lowerQuery = query.toLowerCase();
	const queryNum = parseInt(query);
	
	return blockTypesArray.filter(block => 
		block.name.toLowerCase().includes(lowerQuery) || 
		block.id === queryNum
	);
};

/**
 * Get a block by ID
 * @param {number} id - Block ID
 * @returns {Object|undefined} - Block or undefined if not found
 */
const getBlockById = (id) => {
	return blockTypesArray.find(block => block.id === parseInt(id));
};

/**
 * Check if a block is a custom block
 * @param {number} id - Block ID
 * @returns {boolean} - True if block is custom
 */
const isCustomBlock = (id) => {
	return parseInt(id) >= 100;
};

// Export a reference to the array for direct access when needed
const blockTypes = blockTypesArray;

export { 
	blockTypes, 
	blockTypesArray, 
	processCustomBlock, 
	batchProcessCustomBlocks,
	removeCustomBlock, 
	getBlockTypes, 
	getCustomBlocks, 
	searchBlocks, 
	getBlockById, 
	isCustomBlock, 
	placeCustomBlock 
};

// Expose useful functions to the window object
if (typeof window !== 'undefined') {
	window.placeCustomBlock = placeCustomBlock;
	window.batchProcessCustomBlocks = batchProcessCustomBlocks;
} 