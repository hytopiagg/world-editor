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
 * @returns {Array} - The updated block types array
 */
export const processCustomBlock = (block) => {
	// Set default id for custom blocks starting at 100
	if (!block.id) {
		// Find the highest custom block ID and add 1
		const highestId = blockTypesArray
			.filter(b => b.id >= 100)
			.reduce((max, b) => Math.max(max, b.id), 99);
		block.id = highestId + 1;
	}
  
	// Ensure the block has required properties
	const processedBlock = {
		...block,
		id: parseInt(block.id),
		name: block.name || `Custom Block ${block.id}`,
		textureUri: block.textureUri || './assets/blocks/error.png',
		sideTextures: block.sideTextures || {},
		isMultiTexture: block.sideTextures && Object.keys(block.sideTextures).length > 0,
		isCustom: true
	};
  
	// Check if this is an update to an existing block
	const existingIndex = blockTypesArray.findIndex(b => b.id === processedBlock.id);
  
	if (existingIndex >= 0) {
		// Update the existing block
		blockTypesArray[existingIndex] = processedBlock;
	} else {
		// Add the new block
		blockTypesArray.push(processedBlock);
	}
  
	// Return the updated array
	return [...blockTypesArray]; 
};

/**
 * Remove a custom block by ID
 * @param {number} blockIdToRemove - The ID of the block to remove
 * @returns {Array} - The updated block types array
 */
export const removeCustomBlock = (blockIdToRemove) => {
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
export const getBlockTypes = () => blockTypesArray;

/**
 * Get only custom blocks (ID >= 100)
 * @returns {Array} - Custom blocks
 */
export const getCustomBlocks = () => {
	return blockTypesArray.filter(block => block.id >= 100);
};

/**
 * Search blocks by name or ID
 * @param {string} query - Search query
 * @returns {Array} - Matching blocks
 */
export const searchBlocks = (query) => {
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
export const getBlockById = (id) => {
	return blockTypesArray.find(block => block.id === parseInt(id));
};

/**
 * Check if a block is a custom block
 * @param {number} id - Block ID
 * @returns {boolean} - True if block is custom
 */
export const isCustomBlock = (id) => {
	return parseInt(id) >= 100;
};

// Export a reference to the array for direct access when needed
export const blockTypes = blockTypesArray; 