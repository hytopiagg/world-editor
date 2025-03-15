import React, { useState, useEffect } from "react";
import { FaPlus, FaMinus, FaCube, FaBorderStyle, FaLock, FaLockOpen, FaUndo, FaRedo, FaExpand, FaTrash, FaCircle, FaSquare, FaMountain, FaDrawPolygon, FaCubes } from "react-icons/fa";
import Tooltip from "../components/Tooltip";
import { DatabaseManager, STORES } from "../DatabaseManager";
import "../../css/ToolBar.css";
import { generatePerlinNoise } from "perlin-noise";
import { 
	exportMapFile,
	exportFullAssetPack, 
	importMap,
	importAssetPack
} from '../ImportExport';
import { DISABLE_ASSET_PACK_IMPORT_EXPORT } from '../Constants';
import MinecraftImportWizard from './MinecraftImportWizard';
const ToolBar = ({ terrainBuilderRef, mode, handleModeChange, axisLockEnabled, setAxisLockEnabled, placementSize, setPlacementSize, setGridSize, undoRedoManager, currentBlockType, environmentBuilderRef }) => {
	const [newGridSize, setNewGridSize] = useState(100);
	const [showDimensionsModal, setShowDimensionsModal] = useState(false);
	const [dimensions, setDimensions] = useState({
		width: 1,
		length: 1,
		height: 1,
	});
	const [showGridSizeModal, setShowGridSizeModal] = useState(false);
	const [showBorderModal, setShowBorderModal] = useState(false);
	const [borderDimensions, setBorderDimensions] = useState({
		width: 1,
		length: 1,
		height: 1,
	});
	const [showTerrainModal, setShowTerrainModal] = useState(false);
	const [terrainSettings, setTerrainSettings] = useState({
		width: 32,
		length: 32,
		height: 16,
		scale: 1,
		roughness: 85,
		clearMap: false,
	});

	// Add state for undo/redo button availability
	const [canUndo, setCanUndo] = useState(true);
	const [canRedo, setCanRedo] = useState(false);

	// Add state for active tool tracking
	const [activeTool, setActiveTool] = useState(null);

	// Add state for Minecraft import modal
	const [showMinecraftImportModal, setShowMinecraftImportModal] = useState(false);

	let startPos = {
		x: 0,
		y: 0,
		z: 0,
	};

	const handleGenerateBlocks = () => {

		if(currentBlockType.id > 199)
		{
			alert("Not Compatible with Environment Objects... \n\nPlease select a block and try again!");
			return;
		}

		const { width, length, height } = dimensions;
		
		// Validate dimensions
		if (width <= 0 || length <= 0 || height <= 0) {
			alert("Dimensions must be greater than 0");
			return;
		}

		console.log("Generating blocks with dimensions:", { width, length, height });
		console.log("Current block type:", currentBlockType);

		// Get current terrain data directly from TerrainBuilder
		const terrainData = terrainBuilderRef.current.getCurrentTerrainData();
		
		console.log("Initial terrain data count:", Object.keys(terrainData).length);

		// Count how many blocks we're adding
		let blocksAdded = 0;
		startPos = {
			x: -width / 2,
			y: 0,
			z: -length / 2,
		};

		for (let x = 0; x < width; x++) {
			for (let y = 0; y < height; y++) {
				for (let z = 0; z < length; z++) {
					const position = {
						x: startPos.x + x,
						y: startPos.y + y,
						z: startPos.z + z,
					};

					// Add block to terrain data
					const key = `${position.x},${position.y},${position.z}`;
					terrainData[key] = currentBlockType.id;
					blocksAdded++;
				}
			}
		}

		console.log(`Added ${blocksAdded} blocks to terrain data`);
		console.log("Final terrain data count:", Object.keys(terrainData).length);
		
		// Update terrain directly in TerrainBuilder
		console.log("Calling updateTerrainFromToolBar");
		if (terrainBuilderRef.current) {
			terrainBuilderRef.current.updateTerrainFromToolBar(terrainData);
			console.log("updateTerrainFromToolBar called successfully");
		} else {
			console.error("terrainBuilderRef.current is null or undefined");
		}
		
		setShowDimensionsModal(false);
	};

	const handleGenerateBorder = () => {

		if(currentBlockType.id > 199)
		{
			alert("Not Compatible with Environment Objects... \n\nPlease select a block and try again!");
			return;
		}

		const { width, length, height } = borderDimensions;

		// Validate dimensions
		if (width <= 0 || length <= 0 || height <= 0) {
			alert("Border dimensions must be greater than 0");
			return;
		}

		startPos = {
			x: -width / 2,
			y: 0,
			z: -length / 2,
		};

		// Get current terrain data directly from TerrainBuilder
		const terrainData = terrainBuilderRef.current.getCurrentTerrainData();

		// Generate the border blocks
		for (let x = 0; x < width; x++) {
			for (let y = 0; y < height; y++) {
				for (let z = 0; z < length; z++) {
					// Only add blocks that form the outer shell
					if (x === 0 || x === width - 1 || z === 0 || z === length - 1) {
						// Add blocks for all Y positions on outer edges
						const position = {
							x: startPos.x + x,
							y: startPos.y + y,
							z: startPos.z + z,
						};
						const key = `${position.x},${position.y},${position.z}`;
						terrainData[key] = currentBlockType.id;
					}
				}
			}
		}
		
		// Update terrain directly in TerrainBuilder
		if (terrainBuilderRef.current) {
			terrainBuilderRef.current.updateTerrainFromToolBar(terrainData);
		}
		
		setShowBorderModal(false);
	};

	const handleClearMap = () => {
		// Deactivate any active tool
		if (activeTool) {
			terrainBuilderRef.current?.activateTool(null);
			setActiveTool(null);
		}
		
		// Confirm before clearing
		if (window.confirm("Are you sure you want to clear the map? This cannot be undone.")) {
			terrainBuilderRef.current?.clearMap();
		}
	};

	const generateTerrain = () => {

		if(currentBlockType.id > 199)
		{
			alert("Not Compatible with Environment Objects... \n\nPlease select a block and try again!");
			return;
		}

		// Get current terrain data or start with empty object if clearing map
		let terrainData = terrainSettings.clearMap 
			? {} 
			: terrainBuilderRef.current.getCurrentTerrainData();
		
		const { width, length, height, roughness } = terrainSettings;
		
		// Generate base noise with fixed parameters
		const baseNoiseMap = generatePerlinNoise(width, length, {
			octaveCount: 4,
			amplitude: 1,
			persistence: 0.5,
			scale: 0.1 // Base scale for all terrain types
		});
		
		// Center the terrain around origin
		const startX = -Math.floor(width / 2);
		const startZ = -Math.floor(length / 2);
		
		// Calculate smoothing factor (0 = roughest, 1 = smoothest)
		const smoothingFactor = roughness / 30; // Now 70 = smoothest (2.33), 100 = roughest (3.33)
		
		// Generate terrain based on noise
		for (let x = 0; x < width; x++) {
			for (let z = 0; z < length; z++) {
				// Get base noise value (0-1)
				const baseNoiseValue = baseNoiseMap[z * width + x];
				
				// Apply smoothing based on roughness setting
				// For rough terrain: use the raw noise value with exaggeration
				// For smooth terrain: apply averaging with neighbors
				let finalNoiseValue;
				
				if (smoothingFactor > 3.0) {
					// Roughest terrain - exaggerate the noise to create more dramatic peaks and valleys
					finalNoiseValue = Math.pow(baseNoiseValue, 0.6);
				} else if (smoothingFactor > 2.7) {
					// Medium-rough terrain - slight exaggeration
					finalNoiseValue = Math.pow(baseNoiseValue, 0.8);
				} else if (smoothingFactor > 2.5) {
					// Medium terrain - use raw noise
					finalNoiseValue = baseNoiseValue;
				} else {
					// Smooth terrain - use neighborhood averaging
					let neighborSum = 0;
					let neighborCount = 0;
					
					// Sample neighboring points in a radius based on smoothness
					// Smoother = larger radius
					const radius = Math.floor(15 - smoothingFactor * 4);
					for (let nx = Math.max(0, x-radius); nx <= Math.min(width-1, x+radius); nx++) {
						for (let nz = Math.max(0, z-radius); nz <= Math.min(length-1, z+radius); nz++) {
							// Weight by distance (closer points matter more)
							const dist = Math.sqrt(Math.pow(nx-x, 2) + Math.pow(nz-z, 2));
							if (dist <= radius) {
								const weight = 1 - (dist / radius);
								neighborSum += baseNoiseMap[nz * width + nx] * weight;
								neighborCount += weight;
							}
						}
					}
					
					// Create smooth terrain
					finalNoiseValue = neighborSum / neighborCount;
				}
				
				// FIX: Scale to desired height range (1 to max height)
				// Map 0-1 to 1-height
				const terrainHeight = Math.max(1, Math.floor(1 + finalNoiseValue * (height - 1)));
				
				// Place blocks from y=0 up to calculated height
				for (let y = 0; y < terrainHeight; y++) {
					const worldX = startX + x;
					const worldZ = startZ + z;
					
					const key = `${worldX},${y},${worldZ}`;
					
					// Use current block type for all blocks
					terrainData[key] = currentBlockType.id;
				}
			}
		}
		
		console.log(`Generated terrain: ${width}x${length} with height range 1-${height}, roughness: ${roughness}`);
		
		// Update terrain directly in TerrainBuilder
		if (terrainBuilderRef.current) {
			terrainBuilderRef.current.updateTerrainFromToolBar(terrainData);
		}
		
		setShowTerrainModal(false);
	};

	const handleExportMap = () => {
		try {
			exportMapFile(terrainBuilderRef);
		} catch (error) {
			console.error("Error exporting map:", error);
			alert("Error exporting map. Please try again.");
		}
	};
  

	const applyNewGridSize = async (newGridSize) => {
		if (newGridSize > 10) {
			setGridSize(newGridSize);

			// save grid size to local storage
			// this has to be done here, because terrainbuilder
			// gets the grid size from local storage
			localStorage.setItem("gridSize", newGridSize);

			setShowGridSizeModal(false);
		} else {
			alert("Grid size must be greater than 10");
		}
	};

	// Add effect to check undo/redo availability
	useEffect(() => {
		const checkUndoRedoAvailability = async () => {
			const undoStates = await DatabaseManager.getData(STORES.UNDO, 'states') || [];
			const redoStates = await DatabaseManager.getData(STORES.REDO, 'states') || [];
			setCanUndo(undoStates.length > 0);
			setCanRedo(redoStates.length > 0);
		};
		
		checkUndoRedoAvailability();
		// Set up an interval to check periodically
		const interval = setInterval(checkUndoRedoAvailability, 1000);
		return () => clearInterval(interval);
	}, []);

	// Add console logs to debug import handlers
	const onMapFileSelected = (event) => {
		console.log("Map file selected:", event.target.files[0]);
		if (event.target.files && event.target.files[0]) {
			importMap(event.target.files[0], terrainBuilderRef, environmentBuilderRef);
		}
	};

	// Add a handler for modal overlay clicks
	const handleModalOverlayClick = (e, setModalVisibility) => {
		// Only close if the click was directly on the overlay (not on the modal content)
		if (e.target.className === 'modal-overlay') {
			setModalVisibility(false);
		}
	};

	// Add function to toggle tools
	const handleToolToggle = (toolName) => {
		if (activeTool === toolName) {
			// Deactivate the current tool
			terrainBuilderRef.current?.activateTool(null);
			setActiveTool(null);
		} else {
			// Activate the requested tool
			const success = terrainBuilderRef.current?.activateTool(toolName);
			if (success) {
				setActiveTool(toolName);
				
				// Special handling for wall tool to ensure it has undoRedoManager
				if (toolName === "wall" && undoRedoManager) {
					console.log("ToolBar: Ensuring WallTool has undoRedoManager reference");
					
					// Get the tool and update its undoRedoManager reference
					const wallTool = terrainBuilderRef.current?.toolManagerRef?.current?.tools?.["wall"];
					if (wallTool) {
						wallTool.undoRedoManager = undoRedoManager;
						console.log("ToolBar: Updated WallTool undoRedoManager reference");
					}
				}
			}
		}
	};

	// Update handleModeChange to deactivate tools when switching modes
	const handleModeChangeWithToolReset = (newMode) => {
		// Deactivate any active tool
		if (activeTool) {
			terrainBuilderRef.current?.activateTool(null);
			setActiveTool(null);
		}
		
		// Call the original handleModeChange function
		handleModeChange(newMode);
	};

	return (
		<>
			<div className="controls-container">
				<div className="control-group contol-group-start">
					<div className="control-button-wrapper">
						<Tooltip text="Import just the map file">
							<button
								onClick={() => document.getElementById("mapFileInput").click()}
								className="control-button import-export-button">
								Map
							</button>
							<input
								id="mapFileInput"
								type="file"
								accept=".json"
								onChange={onMapFileSelected}
								style={{ display: "none" }}
							/>
						</Tooltip>
						{!DISABLE_ASSET_PACK_IMPORT_EXPORT && (
							<Tooltip text="Import complete asset pack (includes map and textures)">
								<button
									onClick={() => document.getElementById("assetPackInput").click()}
									className="control-button import-export-button">
									Asset Pack
								</button>
								<input
									id="assetPackInput"
									type="file"
									accept=".zip"
									style={{ display: "none" }}
								/>
							</Tooltip>
						)}
					</div>
					<div className="control-label">Import</div>
				</div>

				<div className="control-group">
					<div className="control-button-wrapper">
						{!DISABLE_ASSET_PACK_IMPORT_EXPORT && (
							<Tooltip text="Export map and assets as a complete package">
								<button
									className="control-button import-export-button">
									Asset Pack
								</button>
							</Tooltip>
						)}
						<Tooltip text="Export just the map file">
							<button
								onClick={() => handleExportMap()}
								className="control-button import-export-button">
								Map
							</button>
						</Tooltip>
					</div>
					<div className="control-label">Export</div>
				</div>

				<div className="control-group">
					<div className="control-button-wrapper">
						<Tooltip text="Add blocks">
							<button
								onClick={() => handleModeChangeWithToolReset("add")}
								className={`control-button ${mode === "add" ? "selected" : ""}`}>
								<FaPlus />
							</button>
						</Tooltip>
						<Tooltip text="Remove blocks">
							<button
								onClick={() => handleModeChangeWithToolReset("remove")}
								className={`control-button ${mode === "remove" ? "selected" : ""}`}>
								<FaMinus />
							</button>
						</Tooltip>
						<Tooltip text={axisLockEnabled ? "Disable axis lock" : "Enable axis lock (Not currently working)"}>
							<button
								onClick={() => setAxisLockEnabled(!axisLockEnabled)}
								className={`control-button ${axisLockEnabled ? "selected" : ""}`}>
								{axisLockEnabled ? <FaLock /> : <FaLockOpen />}
							</button>
						</Tooltip>
						
						<Tooltip text="Undo (Ctrl+Z)">
							<button
								onClick={() => undoRedoManager.handleUndo()}
								className={`control-button ${!canUndo ? 'disabled' : ''}`}
								disabled={!canUndo}>
								<FaUndo />
							</button>
						</Tooltip>
						<Tooltip text="Redo (Ctrl+Y)">
							<button
								onClick={() => undoRedoManager.handleRedo()}
								className={`control-button ${!canRedo ? 'disabled' : ''}`}
								disabled={!canRedo}>
								<FaRedo />
							</button>
						</Tooltip>
						<div className="control-divider-vertical"></div>
						<Tooltip text="Single block placement">
							<button
								onClick={() => setPlacementSize("single")}
								className={`control-button ${placementSize === "single" ? "selected" : ""}`}>
								<FaCircle style={{ width: "5px", height: "5px" }} />
							</button>
						</Tooltip>
						<div className="control-divider-vertical"></div>
						<Tooltip text="Cross pattern (5 blocks)">
							<button
								onClick={() => setPlacementSize("cross")}
								className={`control-button ${placementSize === "cross" ? "selected" : ""}`}>
								<FaCircle style={{ width: "10px", height: "10px" }} />
							</button>
						</Tooltip>
						<Tooltip text="diamond pattern (13 blocks)">
							<button
								onClick={() => setPlacementSize("diamond")}
								className={`control-button ${placementSize === "diamond" ? "selected" : ""}`}>
								<FaCircle style={{ width: "20px", height: "20px" }} />
							</button>
						</Tooltip>
						<div className="control-divider-vertical"></div>
						<Tooltip text="Single block placement">
							<button
								onClick={() => setPlacementSize("square9")}
								className={`control-button ${placementSize === "square9" ? "selected" : ""}`}>
								<FaSquare style={{ width: "10px", height: "10px" }} />
							</button>
						</Tooltip>
						<Tooltip text="Cross pattern (5 blocks)">
							<button
								onClick={() => setPlacementSize("square16")}
								className={`control-button ${placementSize === "square16" ? "selected" : ""}`}>
								<FaSquare style={{ width: "20px", height: "20px" }} />
							</button>
						</Tooltip>
						<div className="control-divider-vertical"></div>
						<Tooltip text="Wall Tool - Click to place wall start, click again to place. Hold Ctrl to erase. Press 1 and 2 to adjust height. q cancels">
							<button
								onClick={() => {
									handleToolToggle("wall");
									setPlacementSize("single");
								}}
								className={`control-button ${activeTool === "wall" ? "selected" : ""}`}>
								<FaDrawPolygon />
							</button>
						</Tooltip>
					</div>
					<div className="control-label">Placement Tools</div>
					
				</div>
				<div className="control-group">
					
					<div className="control-button-wrapper">
						<Tooltip text="Generate solid cube">
							<button
								onClick={() => setShowDimensionsModal(true)}
								className="control-button">
								<FaCube />
							</button>
						</Tooltip>
						<Tooltip text="Generate wall of Blocks">
							<button
								onClick={() => setShowBorderModal(true)}
								className="control-button">
								<FaBorderStyle />
							</button>
						</Tooltip>
						<Tooltip text="Generate terrain">
							<button
								onClick={() => setShowTerrainModal(true)}
								className="control-button">
								<FaMountain />
							</button>
						</Tooltip>
					</div>
					<div className="control-label">Shape Tools</div>
				</div>

				<div className="control-group contol-group-end">
					<div className="control-button-wrapper">
						<Tooltip text="Change grid size">
							<button
								onClick={() => setShowGridSizeModal(true)}
								className="control-button">
								<FaExpand />
							</button>
						</Tooltip>
						<Tooltip text="Clear entire map">
							<button
								onClick={handleClearMap}
								className="control-button">
								<FaTrash />
							</button>
						</Tooltip>
						<Tooltip text="Import Minecraft Map">
							<button
								onClick={() => setShowMinecraftImportModal(true)}
								className="control-button">
								<FaCubes />
							</button>
						</Tooltip>
					</div>
					<div className="control-label">Map Tools</div>
				</div>
			</div>

			{showDimensionsModal && (
				<div className="modal-overlay" onClick={(e) => handleModalOverlayClick(e, setShowDimensionsModal)}>
					<div className="modal-content">
						<div className="modal-image-container">
							<img src="./assets/ui/images/generate_cube.png" alt="Cube Example" className="modal-image" />
						</div>
						<h3 className="modal-title">Generate Area of Blocks</h3>
						<p className="modal-description">Generate a large area of blocks. Enter the dimensions to define the size of the shape. The currently selected block will be used.</p>
						<div className="modal-input">
							<label>Width: </label>
							<input
								type="number"
								value={dimensions.width}
								onChange={(e) =>
									setDimensions({
										...dimensions,
										width: parseInt(e.target.value),
									})
								}
								min="1"
							/>
						</div>
						<div className="modal-input">
							<label>Length: </label>
							<input
								type="number"
								value={dimensions.length}
								onChange={(e) =>
									setDimensions({
										...dimensions,
										length: parseInt(e.target.value),
									})
								}
								min="1"
							/>
						</div>
						<div className="modal-input">
							<label>Height: </label>
							<input
								type="number"
								value={dimensions.height}
								onChange={(e) =>
									setDimensions({
										...dimensions,
										height: parseInt(e.target.value),
									})
								}
								min="1"
							/>
						</div>
						<div className="modal-buttons">
							<button
								className="menu-button"
								onClick={() => {
									handleGenerateBlocks();
								}}>
								Generate
							</button>
							<button
								className="menu-button"
								onClick={() => setShowDimensionsModal(false)}>
								Cancel
							</button>
						</div>
					</div>
				</div>
			)}

			{showGridSizeModal && (
				<div className="modal-overlay" onClick={(e) => handleModalOverlayClick(e, setShowGridSizeModal)}>
					<div className="modal-content">
						<h3 className="modal-title">Change Grid Size</h3>
						<p className="modal-description">Adjust the size of the building grid. This affects the visible grid and the area where you can place blocks.</p>
						<div className="modal-input">
							<label>New Grid Size (10-500): </label>
							<input
								type="number"
								value={newGridSize}
								onChange={(e) => setNewGridSize(e.target.value)}
								min="10"
								max="500"
							/>
						</div>
						<div className="modal-buttons">
							<button
								className="menu-button"
								onClick={() => applyNewGridSize(newGridSize)}>
								Apply
							</button>
							<button
								className="menu-button"
								onClick={() => setShowGridSizeModal(false)}>
								Cancel
							</button>
						</div>
					</div>
				</div>
			)}

			{showBorderModal && (
				<div className="modal-overlay" onClick={(e) => handleModalOverlayClick(e, setShowBorderModal)}>
					<div className="modal-content">
						<div className="modal-image-container">
							<img src="./assets/ui/images/boarder_of_bricks.png" alt="Border Example" className="modal-image" />
						</div>
						<h3 className="modal-title">Generate Wall Blocks (Boarder)</h3>
						<p className="modal-description">Generate a boarder of blocks. Enter the dimensions to define the size of the shape. The currently selected block will be used.</p>
						<div className="modal-input">
							<label>Width: </label>
							<input
								type="number"
								value={borderDimensions.width}
								onChange={(e) =>
									setBorderDimensions({
										...borderDimensions,
										width: parseInt(e.target.value),
									})
								}
								min="1"
							/>
						</div>
						<div className="modal-input">
							<label>Length: </label>
							<input
								type="number"
								value={borderDimensions.length}
								onChange={(e) =>
									setBorderDimensions({
										...borderDimensions,
										length: parseInt(e.target.value),
									})
								}
								min="1"
							/>
						</div>
						<div className="modal-input">
							<label>Height: </label>
							<input
								type="number"
								value={borderDimensions.height}
								onChange={(e) =>
									setBorderDimensions({
										...borderDimensions,
										height: parseInt(e.target.value),
									})
								}
								min="1"
							/>
						</div>
						<div className="modal-buttons">
							<button
								className="menu-button"
								onClick={() => {
									handleGenerateBorder();
								}}>
								Generate
							</button>
							<button
								className="menu-button"
								onClick={() => setShowBorderModal(false)}>
								Cancel
							</button>
						</div>
					</div>
				</div>
			)}

			{showTerrainModal && (
				<div className="modal-overlay" onClick={(e) => handleModalOverlayClick(e, setShowTerrainModal)}>
					<div className="modal-content">
						<div className="modal-image-container">
							<img src="./assets/ui/images/generate_terrain.png" alt="Terrain Example" className="modal-image" />
						</div>
						<h3 className="modal-title">Generate Terrain</h3>
						<p className="modal-description">Generate natural-looking terrain with mountains and valleys. Adjust the slider from roughest terrain (left) to smoothest terrain (right).</p>
						<div className="modal-input">
							<label>Width: </label>
							<input
								type="number"
								value={terrainSettings.width}
								onChange={(e) =>
									setTerrainSettings({
										...terrainSettings,
										width: Math.max(1, parseInt(e.target.value)),
									})
								}
								min="1"
							/>
						</div>
						<div className="modal-input">
							<label>Length: </label>
							<input
								type="number"
								value={terrainSettings.length}
								onChange={(e) =>
									setTerrainSettings({
										...terrainSettings,
										length: Math.max(1, parseInt(e.target.value)),
									})
								}
								min="1"
							/>
						</div>
						<div className="modal-input">
							<label>Max Height: </label>
							<input
								type="number"
								value={terrainSettings.height}
								onChange={(e) =>
									setTerrainSettings({
										...terrainSettings,
										height: Math.max(1, parseInt(e.target.value)),
									})
								}
								min="1"
							/>
						</div>
						<div className="modal-input">
							<label style={{ marginBottom: "5px" }}>Roughness: </label>
							<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
								<span>Smooth</span>
								<input
									type="range"
									value={terrainSettings.roughness}
									onChange={(e) =>
										setTerrainSettings({
											...terrainSettings,
											roughness: parseInt(e.target.value),
										})
									}
									min="20"
									max="100"
								/>
								<span>Rough</span>
							</div>
						</div>
						<div className="checkbox-input-wrapper">
							<label>Clear existing map:</label>
							<input
								type="checkbox"
								checked={terrainSettings.clearMap}
								onChange={(e) =>
									setTerrainSettings({
										...terrainSettings,
										clearMap: e.target.checked,
									})
								}
							/>
						</div>
						<div className="modal-buttons">
							<button
								className="menu-button"
								onClick={() => {
									generateTerrain();
								}}>
								Generate
							</button>
							<button
								className="menu-button"
								onClick={() => setShowTerrainModal(false)}>
								Cancel
							</button>
						</div>
					</div>
				</div>
			)}

			{showMinecraftImportModal && (
				<MinecraftImportWizard
					isOpen={showMinecraftImportModal}
					onClose={() => setShowMinecraftImportModal(false)}
					onComplete={(result) => {
						if (result && result.success) {
							console.log('Minecraft map imported successfully:', result);
							// The wizard already updates the terrain
						}
						setShowMinecraftImportModal(false);
					}}
					terrainBuilderRef={terrainBuilderRef}
				/>
			)}
		</>
	);
};

export default ToolBar;
