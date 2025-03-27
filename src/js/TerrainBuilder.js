import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { playPlaceSound } from "./Sound";
import { cameraManager } from "./Camera";
import { DatabaseManager, STORES } from "./DatabaseManager";
// Replace old texture atlas and chunk imports with new ones
import { initChunkSystem, updateTerrainChunks, updateTerrainBlocks as importedUpdateTerrainBlocks, 
         processChunkRenderQueue, getChunkSystem, setChunkViewDistance, 
         setChunkViewDistanceEnabled, getBlockId, hasBlock, clearChunks, isChunkVisible,
         updateChunkSystemCamera, rebuildTextureAtlas } from "./chunks/TerrainBuilderIntegration";
import { loadingManager } from './LoadingManager';
import { PERFORMANCE_SETTINGS, 
	    meshesNeedsRefresh, toggleInstancing, getInstancingEnabled } from "./constants/performance";

import {CHUNK_SIZE, 
		 getViewDistance, MAX_SELECTION_DISTANCE,
		THRESHOLD_FOR_PLACING, CHUNK_BLOCK_CAPACITY,
        getGreedyMeshingEnabled, setGreedyMeshingEnabled } from "./constants/terrain";

// Import tools
import { ToolManager, WallTool, BrushTool, GroundTool, PipeTool } from "./tools";

// Import chunk utility functions
import { SpatialGridManager } from "./managers/SpatialGridManager";
import { blockTypes, processCustomBlock, removeCustomBlock, getBlockTypes, getCustomBlocks } from "./managers/BlockTypesManager";
import BlockTextureAtlas from './blocks/BlockTextureAtlas';
import BlockTypeRegistry from './blocks/BlockTypeRegistry';
// At the top of the file, add this import
import { SpatialHashGrid } from './chunks/SpatialHashGrid';


// Function to optimize rendering performance
const optimizeRenderer = (gl) => {
  // Optimize THREE.js renderer
  if (gl) {
    // Disable shadow auto update
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    
    // Optimize for static scenes
    gl.sortObjects = false;
    
    // Don't change physically correct lights (keep default)
    // Don't set output encoding (keep default)
    
    // Set power preference to high-performance
    if (gl.getContextAttributes) {
      const contextAttributes = gl.getContextAttributes();
      if (contextAttributes) {
        contextAttributes.powerPreference = "high-performance";
      }
    }
  }
};

function TerrainBuilder({ onSceneReady, previewPositionToAppJS, currentBlockType, undoRedoManager, mode, setDebugInfo, sendTotalBlocks, axisLockEnabled, gridSize, cameraReset, cameraAngle, placementSize, setPageIsLoaded, customBlocks, environmentBuilderRef}, ref) {
	// Initialize refs, state, and other variables
	const [isSaving, setIsSaving] = useState(false);
	
	// Add loading state tracking
	const isLoadingRef = useRef(false);
	const isForceRef = useRef(false);
	
	// Spatial hash tracking
	const spatialHashUpdateQueuedRef = useRef(false);
	const spatialHashLastUpdateRef = useRef(0);
	const disableSpatialHashUpdatesRef = useRef(false); // Flag to completely disable spatial hash updates
	const deferSpatialHashUpdatesRef = useRef(false); // Flag to defer spatial hash updates during loading
	const pendingSpatialHashUpdatesRef = useRef({ added: [], removed: [] }); // Store deferred updates
	const firstLoadCompletedRef = useRef(false); // Flag to track if the first load is complete
	
	// Camera ref for frustum culling
	const cameraRef = useRef(null);
	
	// Define chunk size constant for spatial calculations
	const CHUNK_SIZE = 16; // Size of each chunk in blocks
	
	// Efficient database save mechanism
	const pendingSaveRef = useRef(false);
	const lastSaveTimeRef = useRef(Date.now()); // Initialize with current time to prevent immediate save on load
	const saveThrottleTime = 2000; // Min 2 seconds between saves
	const pendingChangesRef = useRef({
		terrain: {
			added: {},
			removed: {}
		},
		environment: {
			added: [],
			removed: []
		}
	});
	const initialSaveCompleteRef = useRef(false);
	const autoSaveIntervalRef = useRef(null);
	const AUTO_SAVE_INTERVAL = 300000; // Auto-save every 5 minutes (300,000 ms)
	const isAutoSaveEnabledRef = useRef(true); // Default to enabled, but can be toggled
	const gridSizeRef = useRef(gridSize); // Add a ref to maintain grid size state
	
	// Setup auto-save only if enabled
	useEffect(() => {
		const setupAutoSave = () => {
			// Clear any existing interval first
			if (autoSaveIntervalRef.current) {
				clearInterval(autoSaveIntervalRef.current);
				autoSaveIntervalRef.current = null;
			}
			
			// Only set up the interval if auto-save is enabled
			if (isAutoSaveEnabledRef.current) {
				console.log(`Auto-save enabled with interval: ${AUTO_SAVE_INTERVAL/1000} seconds`);
				autoSaveIntervalRef.current = setInterval(() => {
					// Only save if there are pending changes
					if (Object.keys(pendingChangesRef.current.terrain.added).length > 0 || 
						Object.keys(pendingChangesRef.current.terrain.removed).length > 0) {
						console.log("Auto-saving terrain...");
						efficientTerrainSave();
					}
				}, AUTO_SAVE_INTERVAL);
			} else {
				console.log("Auto-save is disabled");
			}
		};
		
		// Initial setup
		setupAutoSave();
		
		// Cleanup on unmount
		return () => {
			if (autoSaveIntervalRef.current) {
				clearInterval(autoSaveIntervalRef.current);
			}
		};
	}, []); // Empty dependency array means this runs once on mount
	
	// Also save when user navigates away
	useEffect(() => {
		// Variable to track if a reload was just prevented (Cancel was clicked)
		let reloadJustPrevented = false;
		// Store the URL to detect actual navigation vs reload attempts
		const currentUrl = window.location.href;
		
		const handleBeforeUnload = (event) => {
			// Skip save if database is being cleared
			if (window.IS_DATABASE_CLEARING) {
				console.log("Database is being cleared, skipping unsaved changes check");
				return;
			}

			// Skip if pendingChangesRef or its current property is null/undefined
			if (!pendingChangesRef || !pendingChangesRef.current) {
				console.log("No pending changes ref available");
				return;
			}
			
			// Ensure we have properly structured changes before checking
			const hasTerrainChanges = pendingChangesRef.current.terrain && (
				Object.keys(pendingChangesRef.current.terrain.added || {}).length > 0 || 
				Object.keys(pendingChangesRef.current.terrain.removed || {}).length > 0
			);
			
			// If we have pending changes, save immediately and show warning
			if (hasTerrainChanges) {
				localStorage.setItem('reload_attempted', 'true');
				
				// Standard way to show a confirmation dialog when closing the page
				// This works across modern browsers
				reloadJustPrevented = true;
				event.preventDefault();
				event.returnValue = "You have unsaved changes. Are you sure you want to leave?";
				return event.returnValue;
			}
		};
		
		// This handler runs when the user navigates back/forward or after the beforeunload dialog
		const handlePopState = (event) => {
			// Check if this is after a cancel action from beforeunload
			if (reloadJustPrevented) {
				console.log("Detected popstate after reload prevention");
				event.preventDefault();
				
				// Reset the flag
				reloadJustPrevented = false;
				
				// Restore the history state to prevent the reload
				window.history.pushState(null, document.title, currentUrl);
				return false;
			}
		};
		
		// Function to handle when the page is shown after being hidden
		// This can happen when user clicks Cancel on the reload prompt
		const handleVisibilityChange = () => {
			if (document.visibilityState === 'visible') {
				// Check if we were in the middle of a reload attempt
				const reloadAttempted = localStorage.getItem('reload_attempted') === 'true';
				if (reloadAttempted) {
					console.log("Page became visible again after reload attempt");
					// Clear the flag
					localStorage.removeItem('reload_attempted');
					// If we have a reload prevention flag, this means the user canceled
					if (reloadJustPrevented) {
						reloadJustPrevented = false;
						console.log("User canceled reload, restoring history state");
						// Restore history state
						window.history.pushState(null, document.title, currentUrl);
					}
				}
			}
		};
		
		window.addEventListener('beforeunload', handleBeforeUnload);
		window.addEventListener('popstate', handlePopState);
		document.addEventListener('visibilitychange', handleVisibilityChange);
		
		// Set initial history state
		window.history.pushState(null, document.title, currentUrl);
		
		// Clear any stale reload flags
		localStorage.removeItem('reload_attempted');
		
		return () => {
			window.removeEventListener('beforeunload', handleBeforeUnload);
			window.removeEventListener('popstate', handlePopState);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
	}, []);
	
	// Track changes for incremental saves
	const trackTerrainChanges = (added = {}, removed = {}) => {
		// Skip if the database is being cleared
		if (window.IS_DATABASE_CLEARING) {
			console.log("Database is being cleared, skipping tracking changes");
			return;
		}

		// Initialize the changes object if it doesn't exist
		if (!pendingChangesRef.current) {
			pendingChangesRef.current = {
				terrain: {
					added: {},
						removed: {}
				},
				environment: {
					added: [],
					removed: []
				}
			};
		}

		// Ensure terrain object exists
		if (!pendingChangesRef.current.terrain) {
			pendingChangesRef.current.terrain = {
				added: {},
				removed: {}
			};
		}

		// Ensure environment object exists
		if (!pendingChangesRef.current.environment) {
			pendingChangesRef.current.environment = {
				added: [],
				removed: []
			};
		}

		// Safely handle potentially null or undefined values
		const safeAdded = added || {};
		const safeRemoved = removed || {};

		// Track added blocks
		Object.entries(safeAdded).forEach(([key, value]) => {
			if (pendingChangesRef.current?.terrain?.added) {
				pendingChangesRef.current.terrain.added[key] = value;
			}
			// If this position was previously in the removed list, remove it
			if (pendingChangesRef.current?.terrain?.removed && 
				pendingChangesRef.current.terrain.removed[key]) {
				delete pendingChangesRef.current.terrain.removed[key];
			}
		});
		
		// Track removed blocks
		Object.entries(safeRemoved).forEach(([key, value]) => {
			// If this position was previously in the added list, just remove it
			if (pendingChangesRef.current?.terrain?.added && 
				pendingChangesRef.current.terrain.added[key]) {
				delete pendingChangesRef.current.terrain.added[key];
			} else if (pendingChangesRef.current?.terrain?.removed) {
				// Otherwise track it as removed
				pendingChangesRef.current.terrain.removed[key] = value;
			}
		});
	};
	
	// Helper function to properly reset pendingChangesRef
	const resetPendingChanges = () => {
		pendingChangesRef.current = {
			terrain: {
				added: {},
				removed: {}
			},
			environment: {
				added: [],
				removed: []
			}
		};
	};

	// Function to efficiently save terrain data
	const efficientTerrainSave = () => {
		// Skip if database is being cleared
		if (window.IS_DATABASE_CLEARING) {
			console.log("Database is being cleared, skipping terrain save");
			return;
		}

		// Skip if no changes to save
		if (!pendingChangesRef.current || 
			!pendingChangesRef.current.terrain ||
			(Object.keys(pendingChangesRef.current.terrain.added || {}).length === 0 && 
			 Object.keys(pendingChangesRef.current.terrain.removed || {}).length === 0)) {
			return;
		}

		// Save changes to database
		saveTerrainManually();

		// Reset pending changes with proper structure
		resetPendingChanges();
	};
	
	// Initialize the incremental terrain save system
	useEffect(() => {
		console.log("Initializing incremental terrain save system");
		// Reset initial save flag to ensure we save a baseline
		initialSaveCompleteRef.current = false;
		// Clear pending changes 
		pendingChangesRef.current = { added: {}, removed: {} };
		// Set the last save time to now to prevent immediate saving on startup
		lastSaveTimeRef.current = Date.now();
		console.log("Last save time initialized to:", new Date(lastSaveTimeRef.current).toLocaleTimeString());
		
		// Attempt to load and validate terrain data
		const validateTerrain = async () => {
			try {
				const terrain = await DatabaseManager.getData(STORES.TERRAIN, "current");
				if (terrain && Object.keys(terrain).length > 0) {
					console.log(`Loaded existing terrain with ${Object.keys(terrain).length} blocks`);
					// We already have terrain data, mark as initialized
					initialSaveCompleteRef.current = true;
				} else {
					console.log("No existing terrain found, will create baseline on first save");
				}
			} catch (err) {
				console.error("Error validating terrain data:", err);
			}
		};
		
		validateTerrain();
	}, []);
	
	// Initialize refs for environment, terrain, etc.
	
	// State and Refs
	// We no longer need this since we're getting scene from useThree
	// const [scene, setScene] = useState(null);
	const spatialGridManagerRef = useRef(new SpatialGridManager(loadingManager));
	const orbitControlsRef = useRef(null);
	const frustumRef = useRef(new THREE.Frustum());
	const frustumMatrixRef = useRef(new THREE.Matrix4());
	const meshesInitializedRef = useRef(false);
	const cameraMoving = useRef(false);
	const useSpatialHashRef = useRef(true);
	const totalBlocksRef = useRef(0);
	const cameraMovementTimeoutRef = useRef(null);

	// Scene setup
	const { scene, camera: threeCamera, raycaster: threeRaycaster, pointer, gl } = useThree();
	
	// Keep a reference to the current camera that can be accessed from outside the component
	const currentCameraRef = useRef(null);
	
	// Update the camera reference whenever it changes
	useEffect(() => {
		if (threeCamera) {
			currentCameraRef.current = threeCamera;
			cameraRef.current = threeCamera; // Also update our camera ref for frustum culling
		}
	}, [threeCamera]);
	
	// Function to update chunk system with current camera and process render queue
	const updateChunkSystemWithCamera = () => {
		// Only log occasionally to avoid console spam
		const shouldLog = false;//Date.now() % 2000 < 50; // Log roughly every 2 seconds for ~50ms window
		
		if (!currentCameraRef.current) {
			console.error("[updateChunkSystemWithCamera] Camera reference not available");
			return false;
		}

		const camera = currentCameraRef.current;
		const chunkSystem = getChunkSystem();
		if (!chunkSystem) {
			console.error("[updateChunkSystemWithCamera] Chunk system not available");
			return false;
		}

		// Ensure camera matrices are up to date
		camera.updateMatrixWorld(true);
		camera.updateProjectionMatrix();

		// Check if the camera is actually set in the chunk system
		const cameraWasSet = !!chunkSystem._scene.camera;
		
		// Update the camera in the chunk system
		updateChunkSystemCamera(camera);
  
		if (shouldLog) {
			console.log("[updateChunkSystemWithCamera] Camera updated:",
				"Was set:", cameraWasSet,
				"New camera:", camera.position.toArray().map(v => v.toFixed(2)),
				"Chunk system camera:", chunkSystem._scene.camera?.position?.toArray().map(v => v.toFixed(2)) || "null");
		}
		
		// Make sure view distance settings are correct
		const { getViewDistance } = require('./constants/terrain');
		const currentViewDistance = getViewDistance();
  
		// Ensure view distance is set and view distance culling is enabled
		chunkSystem.setViewDistance(currentViewDistance);
		chunkSystem.setViewDistanceEnabled(true);
		
		if (shouldLog) {
			console.log("[updateChunkSystemWithCamera] Updated view distance:", 
				currentViewDistance, 
				"Camera position:", camera.position.toArray().map(v => v.toFixed(2)));
		}
		
		// Process chunks with updated camera reference
		processChunkRenderQueue();
  
		// Update the frustum for visibility calculations
		const projScreenMatrix = new THREE.Matrix4();
		projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		const frustum = new THREE.Frustum();
		frustum.setFromProjectionMatrix(projScreenMatrix);
		frustumRef.current = frustum;
		
		if (shouldLog) {
			console.log("[updateChunkSystemWithCamera] Render queue processed and frustum updated");
		}
		
		return true;
	};
	
	// Add a debug function to force refresh all chunks
	const forceRefreshAllChunks = () => {
		console.log("[Debug] Forcing refresh of all chunks based on camera position");
		
		const camera = currentCameraRef.current;
		if (!camera) {
			console.error("[Debug] No camera reference available");
			return;
		}
		
		const chunkSystem = getChunkSystem();
		if (!chunkSystem) {
			console.error("[Debug] No chunk system available");
			return;
		}
		
		// Ensure view distance settings are correct
		const { getViewDistance } = require('./constants/terrain');
		const currentViewDistance = getViewDistance();
		
		// Ensure camera matrices are up to date
		camera.updateMatrixWorld(true);
		camera.updateProjectionMatrix();
		
		// Update the frustum for visibility calculations
		const projScreenMatrix = new THREE.Matrix4();
		projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		const frustum = new THREE.Frustum();
		frustum.setFromProjectionMatrix(projScreenMatrix);
		frustumRef.current = frustum;
		
		// Explicitly update view distance and enable culling
		chunkSystem.setViewDistance(currentViewDistance);
		chunkSystem.setViewDistanceEnabled(true);
		
		// Set camera in chunk system
		updateChunkSystemCamera(camera);
		
		// Process render queue multiple times to ensure updates are applied
		processChunkRenderQueue();
		setTimeout(() => processChunkRenderQueue(), 50);
		setTimeout(() => processChunkRenderQueue(), 100);
		
		return true;
	};

	
	// Add a new ref to track changes during placement
	const placementChangesRef = useRef({ terrain: { added: {}, removed: {} }, environment: { added: [], removed: [] } });
	const instancedMeshRef = useRef({});
	const placementStartPosition = useRef(null);
	const shadowPlaneRef = useRef();
	const directionalLightRef = useRef();
	const terrainRef = useRef({});
	const gridRef = useRef();

	
	// Animation tracking
	const mouseMoveAnimationRef = useRef(null);
	const cameraAnimationRef = useRef(null);

	// Refs needed for real-time updates that functions depend on
	const isPlacingRef = useRef(false);
	const currentPlacingYRef = useRef(0);
	const previewPositionRef = useRef(new THREE.Vector3());
	const lockedAxisRef = useRef(null);
	const blockCountsRef = useRef({});
	const previewMeshRef = useRef(null);
	const selectionDistanceRef = useRef(MAX_SELECTION_DISTANCE/2);
	const axisLockEnabledRef = useRef(axisLockEnabled);
	const currentBlockTypeRef = useRef(currentBlockType);
	const isFirstBlockRef = useRef(true);
	const modeRef = useRef(mode);
	const lastPreviewPositionRef = useRef(new THREE.Vector3());
	const placementSizeRef = useRef(placementSize);
	const previewIsGroundPlaneRef = useRef(false);
	const isBulkLoadingRef = useRef(false);
	const placedBlockCountRef = useRef(0); // Track number of blocks placed during a mouse down/up cycle

	// state for preview position to force re-render of preview cube when it changes
	const [previewPosition, setPreviewPosition] = useState(new THREE.Vector3());

	// Replace lastPlacedBlockRef with a Set to track all recently placed blocks
	const recentlyPlacedBlocksRef = useRef(new Set());

	/// references for
	const canvasRectRef = useRef(null);
	const tempVectorRef = useRef(new THREE.Vector3());

	// Add Tool Manager ref
	const toolManagerRef = useRef(null);




	

	//* TERRAIN UPDATE FUNCTIONS *//
	//* TERRAIN UPDATE FUNCTIONS *//
	//* TERRAIN UPDATE FUNCTIONS *//
	//* TERRAIN UPDATE FUNCTIONS *//

	/**
	 * Build or update the terrain mesh from the terrain data
	 * @param {Object} options - Options for terrain update
	 * @param {boolean} options.deferMeshBuilding - Whether to defer mesh building for distant chunks
	 * @param {number} options.priorityDistance - Distance within which chunks get immediate meshes
	 * @param {number} options.deferredBuildDelay - Delay in ms before building deferred chunks
	 * @param {Object} options.blocks - Blocks to use (if not provided, uses terrainRef.current)
	 */
	const buildUpdateTerrain = async (options = {}) => {
		console.time('buildUpdateTerrain');
		
		// Use provided blocks or terrainRef.current
		const useProvidedBlocks = options.blocks && Object.keys(options.blocks).length > 0;
		
		if (!useProvidedBlocks && !terrainRef.current) {
			console.error("Terrain reference is not initialized and no blocks provided");
			console.timeEnd('buildUpdateTerrain');
			return;
		}
		
		try {
			// Get terrain blocks from options or reference
			const terrainBlocks = useProvidedBlocks ? options.blocks : { ...terrainRef.current };
			
			// Check if terrain is empty
			if (Object.keys(terrainBlocks).length === 0) {
				console.log("No terrain blocks to build");
				console.timeEnd('buildUpdateTerrain');
				return;
			}
			
			// Configure chunk loading with provided options
			const deferMeshBuilding = options.deferMeshBuilding !== false;
			console.log(`Building terrain with ${Object.keys(terrainBlocks).length} blocks (defer: ${deferMeshBuilding})`);
			
			// Configure chunk loading behavior
			configureChunkLoading({
				deferMeshBuilding: deferMeshBuilding,
				priorityDistance: options.priorityDistance,
				deferredBuildDelay: options.deferredBuildDelay
			});
			
			// If using provided blocks that aren't in terrainRef yet (like during initial load)
			// Only load directly into ChunkSystem without adding to terrainRef to prevent duplicates
			if (useProvidedBlocks) {
				// Use the chunk-based terrain system for better performance
				if (getChunkSystem() && updateTerrainChunks) {
					console.time('updateTerrainChunks');
					updateTerrainChunks(terrainBlocks, deferMeshBuilding);
					console.timeEnd('updateTerrainChunks');
					
					// If they aren't already in terrainRef, add them gradually for future operations
					if (Object.keys(terrainRef.current).length === 0) {
						// Add the blocks to terrainRef in small batches to avoid blocking the UI
						const blockEntries = Object.entries(terrainBlocks);
						const BATCH_SIZE = 10000;
						const totalBatches = Math.ceil(blockEntries.length / BATCH_SIZE);
						
						console.log(`Adding ${blockEntries.length} blocks to terrainRef in ${totalBatches} batches`);
						
						// Start adding blocks in background
						const processBlockBatch = (startIdx, batchNum) => {
							const endIdx = Math.min(startIdx + BATCH_SIZE, blockEntries.length);
							const batch = blockEntries.slice(startIdx, endIdx);
							
							// Add blocks from this batch
							batch.forEach(([posKey, blockId]) => {
								terrainRef.current[posKey] = blockId;
								// Also add to pendingChanges
								pendingChangesRef.current.added[posKey] = blockId;
							});
							
							// Log progress occasionally
							if (batchNum % 5 === 0 || batchNum === totalBatches - 1) {
								console.log(`Added batch ${batchNum + 1}/${totalBatches} to terrainRef`);
							}
							
							// Schedule next batch if there are more
							if (endIdx < blockEntries.length) {
								setTimeout(() => {
									processBlockBatch(endIdx, batchNum + 1);
								}, 50); // 50ms delay to avoid blocking UI
							} else {
								console.log(`Finished adding all ${blockEntries.length} blocks to terrainRef`);
							}
						};
						
						// Start background processing after a short delay
						setTimeout(() => {
							processBlockBatch(0, 0);
						}, 1000);
					}
				} else {
					console.warn("Chunk system or updateTerrainChunks not available");
				}
			} else {
				// Normal operation with terrainRef
				if (getChunkSystem() && updateTerrainChunks) {
					console.time('updateTerrainChunks');
					updateTerrainChunks(terrainBlocks, deferMeshBuilding);
					console.timeEnd('updateTerrainChunks');
				} else {
					console.warn("Chunk system or updateTerrainChunks not available");
				}
			}
			
			// Ensure we process the queue to show initial chunks
			if (processChunkRenderQueue) {
				processChunkRenderQueue();
			}
			
			console.timeEnd('buildUpdateTerrain');
		} catch (error) {
			console.error("Error building terrain:", error);
			console.timeEnd('buildUpdateTerrain');
		}
	};
	
	// Helper function to get view distance in case import isn't working
	const getViewDistanceLocal = () => {
		// Try to use the imported function first
		if (typeof getViewDistance === 'function') {
			return getViewDistance();
		}
		
		// Fallback to a default value
		return 64; // Default view distance
	};

	
	// Helper functions for testing custom textures from the console
	const setupTestFunctions = (terrainBuilderInstance) => {
		if (typeof window === 'undefined') return;

		// Create a test texture and place it in the world
		window.createAndPlaceTestBlock = async (blockId = 100, x = 0, y = 0, z = 0) => {
			console.log(`Creating test block (ID: ${blockId}) at position (${x}, ${y}, ${z})...`);

			try {
				// First create the test texture if needed
				if (window.testCustomTexture) {
					await window.testCustomTexture(blockId);
				} else if (window.BlockTypeRegistry) {
					await window.BlockTypeRegistry.instance.registerTestCustomTexture(blockId);
				} else {
					console.error("BlockTypeRegistry not found in global scope");
					return false;
				}

				// Then place the block
				if (terrainBuilderInstance && terrainBuilderInstance.current) {
					terrainBuilderInstance.current.placeBlockAt(x, y, z, blockId);
					console.log(`Test block placed successfully at (${x}, ${y}, ${z})!`);
					return true;
				} else {
					console.error("TerrainBuilder instance not available");
					return false;
				}
			} catch (error) {
				console.error("Error creating or placing test block:", error);
				return false;
			}
		};

		console.log("Test functions initialized. Use window.createAndPlaceTestBlock() to create and place a test block.");
	};



	// Ultra-optimized direct block update path for drag operations
	const fastUpdateBlock = (position, blockId) => {
		// Early validation
		if (!position) return;
		
		// Convert to integer positions and get position key
		const x = Math.round(position[0] || position.x);
		const y = Math.round(position[1] || position.y);
		const z = Math.round(position[2] || position.z);
		const posKey = `${x},${y},${z}`;
		
		// Skip if no change
		if (terrainRef.current[posKey] === blockId) return;

		// For removal (blockId = 0), use a different approach
		if (blockId === 0) {
			// Skip if block doesn't exist
			if (!terrainRef.current[posKey]) return;

			// Save the original block ID for undo
			const originalBlockId = terrainRef.current[posKey];
			
			// Add to database tracking changes
			const removedBlocks = { [posKey]: originalBlockId };
			trackTerrainChanges({}, removedBlocks);

			// IMPORTANT: Track for undo/redo
			placementChangesRef.current.terrain.removed[posKey] = originalBlockId;

			// Remove from terrain
			delete terrainRef.current[posKey];
		} else {
			// Add to database tracking changes
			const addedBlocks = { [posKey]: blockId };
			trackTerrainChanges(addedBlocks, {});

			// IMPORTANT: Track for undo/redo
			placementChangesRef.current.terrain.added[posKey] = blockId;

			// Add to terrain
			terrainRef.current[posKey] = blockId;
		}

		// Update block count
		totalBlocksRef.current = Object.keys(terrainRef.current).length;

		// Direct call to chunk system for fastest performance
		if (getChunkSystem()) {
			getChunkSystem().updateBlocks([{
				position: position,
				id: blockId
			}], []);
		}
		
		// Explicitly update the spatial hash for collisions
		// Format the block for updateSpatialHashForBlocks
		const blockArray = [{
			id: blockId,
			position: [x, y, z]
		}];
		
		// Call with force option to ensure immediate update
		if (blockId === 0) {
			// For removal
			updateSpatialHashForBlocks([], blockArray, { force: true });
		} else {
			// For addition
			updateSpatialHashForBlocks(blockArray, [], { force: true });
		}

		// We'll update debug info and total blocks count later in bulk
	};


	
	/// Placement and Modification Functions ///
	/// Placement and Modification Functions ///
	/// Placement and Modification Functions ///
	/// Placement and Modification Functions ///

	// Handle pointer/mouse down
	const handleMouseDown = (e) => {
		// Check if a tool is active
		const isToolActive = toolManagerRef.current && toolManagerRef.current.getActiveTool();
		if (isToolActive) {
			// Get the raycast intersection to determine mouse position in 3D space
			const intersection = getRaycastIntersection();
			if (intersection) {
				// Create a synthetic mouse event with normal information
				const mouseEvent = {
					...e,
					normal: intersection.normal
				};
				// Forward to tool manager
				toolManagerRef.current.handleMouseDown(mouseEvent, intersection.point, e.button);
				return;
			}
		}
		
		// Otherwise use default behavior for block placement
		if (e.button === 0) {
			// Only set isPlacingRef.current to true if no tool is active
			// (This check is redundant now, but kept for clarity)
			if (!isToolActive) {
				isPlacingRef.current = true;
				
				isFirstBlockRef.current = true;
				currentPlacingYRef.current = previewPositionRef.current.y;
				
				// Clear recently placed blocks on mouse down
				recentlyPlacedBlocksRef.current.clear();

				// Reset the placed block counter for a new placement session
				placedBlockCountRef.current = 0;

				// Store initial position for axis lock
				if (axisLockEnabledRef.current) {
					placementStartPosition.current = previewPositionRef.current.clone();
				}

				// Reset the placement changes tracker
				placementChangesRef.current = { 
					terrain: { added: {}, removed: {} }, 
					environment: { added: [], removed: [] } 
				};

				// Handle initial placement
				updatePreviewPosition();
				playPlaceSound();
			}
		}
	};

	const handleBlockPlacement = () => {
		const startTime = performance.now();
		
		// Safety check: Don't do anything if a tool is active - this avoids interfering with tool functionality
		if (toolManagerRef.current && toolManagerRef.current.getActiveTool()) {
			return;
		}
		
		if (!modeRef.current || !isPlacingRef.current) return;

		if (currentBlockTypeRef.current?.isEnvironment) {
			if (isFirstBlockRef.current) {
				// Call the environment builder to place the object
				if (environmentBuilderRef.current && typeof environmentBuilderRef.current.placeEnvironmentModel === 'function') {
					try {
						const addedEnvironmentObjects = environmentBuilderRef.current.placeEnvironmentModel();
						if (addedEnvironmentObjects && addedEnvironmentObjects.length > 0) {
							console.log('Environment objects placed:', addedEnvironmentObjects.length);
							// Track added environment objects in the placementChangesRef for undo/redo support
							if (placementChangesRef.current) {
								placementChangesRef.current.environment.added = [
									...placementChangesRef.current.environment.added,
									...addedEnvironmentObjects
								];
							}
						} else {
							console.warn('No environment objects were placed or returned');
						}
					} catch (error) {
						console.error('Error placing environment object:', error);
					}
				} else {
					console.error('Environment builder reference or placeEnvironmentModel function not available');
				}
			}
		} else {
			// Standard block placement
			if (modeRef.current === "add") {
				// Addition logic
				const placeStartTime = performance.now();
				
				// Get all positions to place blocks at based on placement size
				const positions = getPlacementPositions(previewPositionRef.current, placementSizeRef.current);
				
				// Create new blocks
				const addedBlocks = {};
				
				// Check each position
				positions.forEach(pos => {
					const blockKey = `${pos.x},${pos.y},${pos.z}`;
					
					// Don't place if block exists at this position and we're in add mode
					if (!terrainRef.current[blockKey]) {
						addedBlocks[blockKey] = currentBlockTypeRef.current.id;
						terrainRef.current[blockKey] = currentBlockTypeRef.current.id;
						
						// Track this block to avoid removing it if we drag through
						recentlyPlacedBlocksRef.current.add(blockKey);
						
						// IMPORTANT: Track for undo/redo
						placementChangesRef.current.terrain.added[blockKey] = currentBlockTypeRef.current.id;
					}
				});

				// Update terrain with new blocks
				const preUpdateTime = performance.now();
				//console.log(`Performance: Block placement preparation took ${preUpdateTime - placeStartTime}ms`);
		//		console.log(`Added ${Object.keys(addedBlocks).length} blocks, tracked ${Object.keys(placementChangesRef.current.terrain.added).length} for undo/redo`);
				
				importedUpdateTerrainBlocks(addedBlocks, {});
				
				
				// Explicitly update the spatial hash for collisions with force option
				const addedBlocksArray = Object.entries(addedBlocks).map(([posKey, blockId]) => {
					const [x, y, z] = posKey.split(',').map(Number);
					return {
						id: blockId,
						position: [x, y, z]
					};
				});
				
				// Force immediate update of spatial hash for collision detection
				if (addedBlocksArray.length > 0) {
					updateSpatialHashForBlocks(addedBlocksArray, [], { force: true });
				}
				
				const postUpdateTime = performance.now();
				//console.log(`Performance: updateTerrainBlocks took ${postUpdateTime - preUpdateTime}ms`);

				// Increment the placed block counter
				placedBlockCountRef.current += Object.keys(addedBlocks).length;
			} else if (modeRef.current === "remove") {
				// Removal logic
				const removeStartTime = performance.now();
				
				// Get all positions to remove blocks at based on placement size
				const positions = getPlacementPositions(previewPositionRef.current, placementSizeRef.current);
				
				// Track removed blocks
				const removedBlocks = {};
				
				// Check each position
				positions.forEach(pos => {
					const blockKey = `${pos.x},${pos.y},${pos.z}`;
					
					// Only remove if block exists at this position
					if (terrainRef.current[blockKey]) {
						removedBlocks[blockKey] = terrainRef.current[blockKey];
						delete terrainRef.current[blockKey];
						
						// IMPORTANT: Track for undo/redo
						placementChangesRef.current.terrain.removed[blockKey] = removedBlocks[blockKey];
					}
				});
				
				// Update terrain with removed blocks
				const preUpdateTime = performance.now();
				//console.log(`Performance: Block removal preparation took ${preUpdateTime - removeStartTime}ms`);
				//console.log(`Removed ${Object.keys(removedBlocks).length} blocks, tracked ${Object.keys(placementChangesRef.current.terrain.removed).length} for undo/redo`);
				
				importedUpdateTerrainBlocks({}, removedBlocks);
				
				// Explicitly update the spatial hash for collisions with force option
				const removedBlocksArray = Object.entries(removedBlocks).map(([posKey, blockId]) => {
					const [x, y, z] = posKey.split(',').map(Number);
					return {
						id: 0, // Use 0 for removed blocks
						position: [x, y, z]
					};
				});
				
				// Force immediate update of spatial hash for collision detection
				if (removedBlocksArray.length > 0) {
					updateSpatialHashForBlocks([], removedBlocksArray, { force: true });
				}
				
				const postUpdateTime = performance.now();
				//console.log(`Performance: updateTerrainBlocks took ${postUpdateTime - preUpdateTime}ms`);

				// Increment the placed block counter (even for removals)
				placedBlockCountRef.current += Object.keys(removedBlocks).length;
			}
			
			// Set flag to avoid placing at the same position again
			isFirstBlockRef.current = false;
		}
		
		const endTime = performance.now();
		//console.log(`Performance: handleBlockPlacement total time ${endTime - startTime}ms`);
	};

	/// Raycast and Grid Intersection Functions ///
	/// Raycast and Grid Intersection Functions ///
	/// Raycast and Grid Intersection Functions ///
	/// Raycast and Grid Intersection Functions ///

	const getRaycastIntersection = () => {
		// Skip raycasting completely if scene is not ready
		if (!scene || !threeCamera || !threeRaycaster) return null;
		
		// Use the raw pointer coordinates directly from THREE.js
		const normalizedMouse = pointer.clone();
		
		// Setup raycaster with the normalized coordinates
		threeRaycaster.setFromCamera(normalizedMouse, threeCamera);
		
		// First, check for block collisions using optimized ray casting
		let intersection = null;
		
		// Safety check - ensure spatialGridManagerRef.current is initialized
		if (useSpatialHashRef.current && spatialGridManagerRef.current && spatialGridManagerRef.current.size > 0) {
			// Use the optimized raycast method which now handles both block and ground plane detection
			intersection = getOptimizedRaycastIntersection(true); // Always prioritize blocks
		} else {
			// Fallback to simple ground plane detection if spatial hash is not available
			const rayOrigin = threeRaycaster.ray.origin;
			const rayDirection = threeRaycaster.ray.direction;
			
			// Calculate intersection with the ground plane
			const target = new THREE.Vector3();
			const intersectionDistance = rayOrigin.y / -rayDirection.y;
			
			// Only consider intersections in front of the camera and within selection distance
			if (intersectionDistance > 0 && intersectionDistance < selectionDistanceRef.current) {
				// Calculate the intersection point
				target.copy(rayOrigin).addScaledVector(rayDirection, intersectionDistance);
				
				// Check if this point is within our valid grid area
				const gridSizeHalf = gridSizeRef.current / 2;
				if (Math.abs(target.x) <= gridSizeHalf && Math.abs(target.z) <= gridSizeHalf) {
					// This is a hit against the ground plane within the valid build area
					intersection = {
						point: target.clone(),
						normal: new THREE.Vector3(0, 1, 0), // Normal is up for ground plane
						block: { x: Math.floor(target.x), y: 0, z: Math.floor(target.z) },
						blockId: null, // No block here - it's the ground
						distance: intersectionDistance,
						isGroundPlane: true
					};
				}
			}
		}
		
		return intersection;
	};

	// Throttle mouse move updates
	const updatePreviewPosition = () => {
		// Skip update if we updated too recently
		const now = performance.now();
		if (now - updatePreviewPosition.lastUpdate < 10) { // ~60fps
			return;
		}
		updatePreviewPosition.lastUpdate = now;

		// Cache the canvas rect calculation
		if (!canvasRectRef.current) {
			canvasRectRef.current = gl.domElement.getBoundingClientRect();
		}

		const rect = canvasRectRef.current;
		
		// Get intersection for preview
		const blockIntersection = getRaycastIntersection();
		
		// If we have a valid intersection and mouse position:
		if (blockIntersection && blockIntersection.point) {
			// Check if a tool is active - this is important to prevent default block placement when tools are active
			const isToolActive = toolManagerRef.current && toolManagerRef.current.getActiveTool();
			
			// Delegate mouse move to tool if active
			if (isToolActive) {
				const activeTool = toolManagerRef.current.getActiveTool();
				// Only call the tool's handleMouseMove if it has this method
				if (typeof activeTool.handleMouseMove === 'function') {
					// Create a synthetic mouse event using the current pointer coordinates and canvas position
					const canvasRect = gl.domElement.getBoundingClientRect();
					const mouseEvent = {
						// Calculate client coordinates based on normalized pointer and canvas rect
						clientX: ((pointer.x + 1) / 2) * canvasRect.width + canvasRect.left,
						clientY: ((1 - pointer.y) / 2) * canvasRect.height + canvasRect.top,
						// Add normal information from blockIntersection for proper tool positioning
						normal: blockIntersection.normal
					};
					
					// Call the tool's handleMouseMove
					activeTool.handleMouseMove(mouseEvent, blockIntersection.point);
				}
			}
			
			// Always update previewPositionRef for tools and default behavior
			tempVectorRef.current.copy(blockIntersection.point);

			// If in delete/remove mode, select the actual block, not the face
			if (modeRef.current === "delete" || modeRef.current === "remove") {
				// For delete/remove mode, use the block coordinates directly
				if (blockIntersection.block) {
					tempVectorRef.current.x = blockIntersection.block.x;
					tempVectorRef.current.y = blockIntersection.block.y;
					tempVectorRef.current.z = blockIntersection.block.z;
				} else {
					// If no block property, use the old method as fallback
					tempVectorRef.current.x = Math.round(tempVectorRef.current.x - blockIntersection.normal.x * 0.5);
					tempVectorRef.current.y = Math.round(tempVectorRef.current.y - blockIntersection.normal.y * 0.5);
					tempVectorRef.current.z = Math.round(tempVectorRef.current.z - blockIntersection.normal.z * 0.5);
				}
			} else {
				// For add mode, calculate placement position precisely based on the face that was hit
				// First, get the block coordinates where we hit
				const hitBlock = blockIntersection.block || {
					x: Math.floor(blockIntersection.point.x),
					y: Math.floor(blockIntersection.point.y),
					z: Math.floor(blockIntersection.point.z)
				};

				// Use the face information if available for more precise placement
				if (blockIntersection.face && blockIntersection.normal) {
					// Position the new block adjacent to the face that was hit
					// By adding the normal vector, we place the block directly against the hit face
					tempVectorRef.current.x = hitBlock.x + blockIntersection.normal.x;
					tempVectorRef.current.y = hitBlock.y + blockIntersection.normal.y;
					tempVectorRef.current.z = hitBlock.z + blockIntersection.normal.z;
					
					// Ensure we have integer coordinates for block placement
					tempVectorRef.current.x = Math.round(tempVectorRef.current.x);
					tempVectorRef.current.y = Math.round(tempVectorRef.current.y);
					tempVectorRef.current.z = Math.round(tempVectorRef.current.z);
					
					// Log face detection for debugging
				} else {
					// Fallback to the old method if face information is not available
					tempVectorRef.current.add(blockIntersection.normal.clone().multiplyScalar(0.5));
					tempVectorRef.current.x = Math.round(tempVectorRef.current.x);
					tempVectorRef.current.y = Math.round(tempVectorRef.current.y);
					tempVectorRef.current.z = Math.round(tempVectorRef.current.z);
				}
				
				// Handle y-coordinate special case if this is a ground plane hit
				if (blockIntersection.isGroundPlane && modeRef.current === "add") {
					tempVectorRef.current.y = 0; // Position at y=0 when placing on ground plane
				}
				
				// Apply axis lock if enabled
				if (axisLockEnabled) {
					// Keep only movement along the selected axis
					const originalPos = previewPositionRef.current.clone();
					const axisLock = lockedAxisRef.current;
					
					if (axisLock === 'x') {
						tempVectorRef.current.y = originalPos.y;
						tempVectorRef.current.z = originalPos.z;
					} else if (axisLock === 'y') {
						tempVectorRef.current.x = originalPos.x;
						tempVectorRef.current.z = originalPos.z;
					} else if (axisLock === 'z') {
						tempVectorRef.current.x = originalPos.x;
						tempVectorRef.current.y = originalPos.y;
					}
				}
			}
			
			// CRITICAL: Update the previewPositionRef with the calculated position from tempVectorRef
			// This ensures the preview block moves with the mouse
			if (previewPositionRef && previewPositionRef.current) {
				previewPositionRef.current.copy(tempVectorRef.current);
				
				// CRITICAL: Also update the React state variable that's used for rendering the preview box
				// This ensures the green box indicator follows the mouse
				setPreviewPosition(tempVectorRef.current.clone());
				
				// Send the preview position to the App component, which forwards it to EnvironmentBuilder
				if (previewPositionToAppJS && typeof previewPositionToAppJS === 'function') {
					previewPositionToAppJS(tempVectorRef.current.clone());
				}
			}
			
			// Important check: Only call handleBlockPlacement if a tool is NOT active.
			// This prevents the default block placement behavior from interfering with tools like WallTool
			if (isPlacingRef.current && !isToolActive) {
				handleBlockPlacement();
			}
		}
	};

	updatePreviewPosition.lastUpdate = 0;

	// Move undo state saving to handlePointerUp
	const handleMouseUp = (e) => {
		// Performance tracking
		const t0 = performance.now();
		
		// Check if a tool is active and forward the event
		const isToolActive = toolManagerRef.current && toolManagerRef.current.getActiveTool();
		if (isToolActive) {
			const intersection = getRaycastIntersection();
			if (intersection) {
				// Create a synthetic mouse event with normal information
				const mouseEvent = {
					...e,
					normal: intersection.normal
				};
				// Forward to tool manager with button parameter
				toolManagerRef.current.handleMouseUp(mouseEvent, intersection.point, e.button);
				return;
			}
		}
		
		// Only process if we were actually placing blocks
		if (isPlacingRef.current) {
			// Stop placing blocks
			isPlacingRef.current = false;
			
			console.log(`handleMouseUp: Placed ${placedBlockCountRef.current} blocks`);
			
			// Only update the spatial grid if blocks were placed
			if (placedBlockCountRef.current > 0) {
				// Update only the newly placed blocks instead of rebuilding entire grid
				if (spatialGridManagerRef.current) {
					// Use the recently placed blocks array directly
					const addedBlocks = Array.from(recentlyPlacedBlocksRef.current).map(posKey => {
						return [posKey, terrainRef.current[posKey]];
					});
					
					// Update spatial grid with just these blocks
					spatialGridManagerRef.current.updateBlocks(addedBlocks, []);
				}

				// Save changes to undo stack if there are any changes
				if (placementChangesRef.current && 
					(Object.keys(placementChangesRef.current.terrain.added || {}).length > 0 || 
					 Object.keys(placementChangesRef.current.terrain.removed || {}).length > 0 ||
					 (placementChangesRef.current.environment.added || []).length > 0 ||
					 (placementChangesRef.current.environment.removed || []).length > 0)) {
					console.log("Saving changes to undo stack:", placementChangesRef.current);
					
					// Debug undoRedoManager state in this context
					console.log("handleMouseUp: undoRedoManager available:", !!undoRedoManager);
					console.log("handleMouseUp: undoRedoManager is ref:", undoRedoManager && 'current' in undoRedoManager);
					console.log("handleMouseUp: undoRedoManager.current exists:", undoRedoManager && !!undoRedoManager.current);
					console.log("handleMouseUp: undoRedoManager.current has .saveUndo:", 
					   undoRedoManager && undoRedoManager.current && typeof undoRedoManager.current.saveUndo === 'function');
					
					// Try direct undoRedoManager.current access
					if (undoRedoManager?.current?.saveUndo) {
						console.log("Using direct undoRedoManager.current.saveUndo");
						undoRedoManager.current.saveUndo(placementChangesRef.current);
					} 
					// Final fallback - check if we can access it another way
					else {
						console.warn("No direct access to saveUndo function, trying fallbacks");
						// Try to use any available reference as last resort
						const tempRef = ref?.current;
						if (tempRef && tempRef.undoRedoManager && tempRef.undoRedoManager.current && 
							tempRef.undoRedoManager.current.saveUndo) {
							console.log("Using ref.current.undoRedoManager fallback");
							tempRef.undoRedoManager.current.saveUndo(placementChangesRef.current);
						} else {
							console.error("Could not find a way to save undo state, changes won't be tracked for undo/redo");
						}
					}
				}
				
				// Reset the block counter
				placedBlockCountRef.current = 0;
			}
			
			// Clear recently placed blocks
			recentlyPlacedBlocksRef.current.clear();
		}
		
		// Log performance
		const duration = performance.now() - t0;
		if (duration > 5) {
			console.log(`handleMouseUp processing took ${duration.toFixed(2)}ms`);
		}
	};

	const getPlacementPositions = (centerPos, placementSize) => {
		const positions = [];

		// Always include center position
		positions.push({ ...centerPos });

		switch (placementSize) {
			default:
			case "single":
				break;

			case "cross":
				positions.push({ x: centerPos.x + 1, y: centerPos.y, z: centerPos.z }, { x: centerPos.x - 1, y: centerPos.y, z: centerPos.z }, { x: centerPos.x, y: centerPos.y, z: centerPos.z + 1 }, { x: centerPos.x, y: centerPos.y, z: centerPos.z - 1 });
				break;

			case "diamond":
				// 13-block diamond pattern
				positions.push(
					// Inner cardinal positions (4 blocks)
					{ x: centerPos.x + 1, y: centerPos.y, z: centerPos.z },
					{ x: centerPos.x - 1, y: centerPos.y, z: centerPos.z },
					{ x: centerPos.x, y: centerPos.y, z: centerPos.z + 1 },
					{ x: centerPos.x, y: centerPos.y, z: centerPos.z - 1 },
					// Middle diagonal positions (4 blocks)
					{ x: centerPos.x + 1, y: centerPos.y, z: centerPos.z + 1 },
					{ x: centerPos.x + 1, y: centerPos.y, z: centerPos.z - 1 },
					{ x: centerPos.x - 1, y: centerPos.y, z: centerPos.z + 1 },
					{ x: centerPos.x - 1, y: centerPos.y, z: centerPos.z - 1 },
					// Outer cardinal positions (4 blocks)
					{ x: centerPos.x + 2, y: centerPos.y, z: centerPos.z },
					{ x: centerPos.x - 2, y: centerPos.y, z: centerPos.z },
					{ x: centerPos.x, y: centerPos.y, z: centerPos.z + 2 },
					{ x: centerPos.x, y: centerPos.y, z: centerPos.z - 2 }
				);
				break;

			case "square9":
				for (let x = -1; x <= 1; x++) {
					for (let z = -1; z <= 1; z++) {
						if (x !== 0 || z !== 0) {
							// Skip center as it's already added
							positions.push({
								x: centerPos.x + x,
								y: centerPos.y,
								z: centerPos.z + z,
							});
						}
					}
				}
				break;

			case "square16":
				for (let x = -2; x <= 1; x++) {
					for (let z = -2; z <= 1; z++) {
						if (x !== 0 || z !== 0) {
							// Skip center as it's already added
							positions.push({
								x: centerPos.x + x,
								y: centerPos.y,
								z: centerPos.z + z,
							});
						}
					}
				}
				break;
		}

		return positions;
	};

	const getCurrentTerrainData = () => {
		return terrainRef.current;
	};

	const determineLockedAxis = (currentPos) => {
		if (!placementStartPosition.current || !axisLockEnabledRef.current) return null;

		const xDiff = Math.abs(currentPos.x - placementStartPosition.current.x);
		const zDiff = Math.abs(currentPos.z - placementStartPosition.current.z);

		// Only lock axis if we've moved enough to determine direction
		// and one axis has significantly more movement than the other
		if (Math.max(xDiff, zDiff) > THRESHOLD_FOR_PLACING) {
			// Require one axis to have at least 50% more movement than the other
			if (xDiff > zDiff * 1.5) {
				return 'x';
			} else if (zDiff > xDiff * 1.5) {
				return 'z';
			}
		}
		return null;
	};


	const updateTerrainFromToolBar = (terrainData) => {
		// Show initial loading screen
		loadingManager.showLoading('Preparing to import map...');
		
		// Set terrain data immediately
		terrainRef.current = terrainData;
		
		// Calculate grid size from terrain dimensions
		if (terrainData && Object.keys(terrainData).length > 0) {
			console.log("Calculating grid size based on map dimensions...");
			
			// Find the min/max coordinates
			let minX = Infinity, minZ = Infinity;
			let maxX = -Infinity, maxZ = -Infinity;
			
			Object.keys(terrainData).forEach(key => {
				const [x, y, z] = key.split(',').map(Number);
				minX = Math.min(minX, x);
				maxX = Math.max(maxX, x);
				minZ = Math.min(minZ, z);
				maxZ = Math.max(maxZ, z);
			});
			
			// Calculate width and length (adding a small margin)
			const width = maxX - minX + 10;
			const length = maxZ - minZ + 10;
			
			// Use the larger dimension for the grid size (rounded up to nearest multiple of 16)
			const gridSize = Math.ceil(Math.max(width, length) / 16) * 16;
			
			console.log(`Map dimensions: ${width}x${length}, updating grid size to ${gridSize}`);
			
			// Update the grid size
			updateGridSize(gridSize);
		}
		
		// For imports, we'll save to database immediately and not mark as unsaved
		if (terrainData) {
			console.log("Importing map and saving to database");
			
			// First save to database
			DatabaseManager.saveData(STORES.TERRAIN, "current", terrainData)
				.then(() => {
					console.log("Imported terrain saved to database successfully");
					// Clear any pending changes to prevent unsaved changes warning
					pendingChangesRef.current = { terrain: { added: {}, removed: {} }, environment: { added: [], removed: [] } };
				})
				.catch(error => {
					console.error("Error saving imported terrain:", error);
				});
		}
		
		// Start terrain update immediately for faster response
		// Configure for bulk loading for better performance
		configureChunkLoading({ 
			deferMeshBuilding: true,
			priorityDistance: 48,
			deferredBuildDelay: 5000
		});
		
		// Set bulk loading mode to optimize for large terrain loads
		if (getChunkSystem()) {
			getChunkSystem().setBulkLoadingMode(true, 48);
		}
		
		// Build the terrain with the provided blocks
		buildUpdateTerrain({ blocks: terrainData, deferMeshBuilding: true });
		
		// Initialize spatial hash grid
		setTimeout(async () => {
			// Initialize spatial hash (all blocks, not just visible ones)
			await initializeSpatialHash(true, false);
			
			// Process render queue to update visible chunks
			processChunkRenderQueue();
			
			// Hide loading screen
			loadingManager.hideLoading();
		}, 1000);
	};

	// Update
	const updateGridSize = (newGridSize) => {
		if (gridRef.current) {
			// If newGridSize is provided, use it and update localStorage
			// Otherwise, get grid size from localStorage
			let gridSizeToUse;
			
			if (newGridSize) {
				gridSizeToUse = newGridSize;
				// Update localStorage with the new value
				localStorage.setItem("gridSize", gridSizeToUse.toString());
			} else {
				gridSizeToUse = parseInt(localStorage.getItem("gridSize"), 10) || 64; // Default to 64
			}
			
			// Update the gridSizeRef to maintain current grid size value
			gridSizeRef.current = gridSizeToUse;

			if (gridRef.current.geometry) {
				gridRef.current.geometry.dispose();
				gridRef.current.geometry = new THREE.GridHelper(gridSizeToUse, gridSizeToUse, 0x5c5c5c, 0xeafaea).geometry;
				gridRef.current.material.opacity = 0.1;
				gridRef.current.position.set(0.5, -0.5, 0.5);
			}

			if (shadowPlaneRef.current.geometry) {
				shadowPlaneRef.current.geometry.dispose();
				shadowPlaneRef.current.geometry = new THREE.PlaneGeometry(gridSizeToUse, gridSizeToUse);
				shadowPlaneRef.current.position.set(0.5, -0.5, 0.5);
			}
			
			console.log(`Grid size updated to: ${gridSizeToUse}x${gridSizeToUse}`);
		}
	};

	const updateDebugInfo = () => {
		setDebugInfo({
			preview: previewPositionRef.current,
			totalBlocks: totalBlocksRef.current,
			isGroundPlane: previewIsGroundPlaneRef.current,
		});
		
		// Send total blocks to App component
		if (sendTotalBlocks) {
			sendTotalBlocks(totalBlocksRef.current);
		}
	}

	// Clear the terrain
	const clearMap = () => {
		console.log("Clearing map...");
		
		// Remove all blocks from the terrain object
		terrainRef.current = {};
		totalBlocksRef.current = 0;
		
		// Send total blocks count to parent component
		if (sendTotalBlocks) {
			sendTotalBlocks(0);
		}
		
		// Clear all chunks from the system
		console.log("Clearing chunks from the chunk system...");
		clearChunks();
		
		// Clear spatial grid for raycasting
		if (spatialGridManagerRef.current) {
			console.log("Clearing spatial grid manager...");
			spatialGridManagerRef.current.clear();
			
			// Reset the firstLoadCompleted flag to ensure it gets initialized for the next terrain
			firstLoadCompletedRef.current = false;
		}
		
		// Reset placement state
		isPlacingRef.current = false;
		recentlyPlacedBlocksRef.current = new Set();
		
		// Reset pending changes
		pendingChangesRef.current = { added: {}, removed: {} };
		
		// Reset undo/redo stack
		if (undoRedoManager) {
			console.log("Clearing undo/redo history...");
			// Use DatabaseManager directly instead of non-existent clearHistory method
			import('./DatabaseManager').then(({ DatabaseManager, STORES }) => {
				// Clear undo and redo stacks
				DatabaseManager.saveData(STORES.UNDO, 'states', []);
				DatabaseManager.saveData(STORES.REDO, 'states', []);
				console.log("Undo/redo history cleared");
			}).catch(error => {
				console.error("Failed to clear undo/redo history:", error);
			});
		}
		
		// Update debug info
		updateDebugInfo();
		
		// Force scene update
		if (scene) {
			console.log("Forcing scene update...");
			scene.updateMatrixWorld(true);
			// Don't need to call render directly - the animation loop will handle it
		}
		
		// Save empty terrain to database
		console.log("Saving empty terrain to database...");
		efficientTerrainSave();
		
		console.log("Map cleared successfully");
		resetPendingChanges();
	};

	// Function to initialize spatial hash once after map is loaded
	const initializeSpatialHash = async (forceUpdate = false, visibleOnly = false) => {
		if (!forceUpdate && firstLoadCompletedRef.current) {
			console.log("Spatial hash already initialized, skipping");
			return Promise.resolve();
		}
		
		if (!spatialGridManagerRef.current) {
			console.error("Cannot initialize spatial hash: manager not initialized");
			return Promise.resolve();
		}
		
		console.log(`Initializing spatial hash${visibleOnly ? ' with visible blocks only' : ''}...`);
		
		// If using visible only mode, filter blocks to those in visible chunks
		if (visibleOnly && terrainRef.current) {
			const chunkSystem = getChunkSystem();
			
			if (chunkSystem && chunkSystem._scene.camera) {
				const camera = chunkSystem._scene.camera;
				const cameraPos = camera.position;
				const viewDistance = getViewDistance() || 64;
				
				console.log(`Filtering blocks for spatial hash to only those within ${viewDistance} blocks of camera at ${cameraPos.x.toFixed(1)},${cameraPos.y.toFixed(1)},${cameraPos.z.toFixed(1)}`);
				
				// Create a reduced set of blocks for the spatial hash
				const visibleBlocks = {};
				let totalBlocks = 0;
				let visibleBlockCount = 0;
				
				// Helper to get chunk origin from position
				const getChunkOrigin = (pos) => {
					const [x, y, z] = pos.split(',').map(Number);
					const chunkSize = CHUNK_SIZE;
					return {
						x: Math.floor(x / chunkSize) * chunkSize,
						y: Math.floor(y / chunkSize) * chunkSize,
						z: Math.floor(z / chunkSize) * chunkSize
					};
				};
				
				// Iterate through all blocks
				Object.entries(terrainRef.current).forEach(([posKey, blockId]) => {
					totalBlocks++;
					
					// Get the chunk origin for this block
					const origin = getChunkOrigin(posKey);
					
					// Calculate distance from chunk center to camera
					const distance = Math.sqrt(
						Math.pow(origin.x + CHUNK_SIZE/2 - cameraPos.x, 2) + 
						Math.pow(origin.y + CHUNK_SIZE/2 - cameraPos.y, 2) + 
						Math.pow(origin.z + CHUNK_SIZE/2 - cameraPos.z, 2)
					);
					
					// Only include blocks in visible chunks
					if (distance <= viewDistance) {
						visibleBlocks[posKey] = blockId;
						visibleBlockCount++;
					}
				});
				
				console.log(`Filtered spatial hash blocks: ${visibleBlockCount} out of ${totalBlocks} blocks (${Math.round(visibleBlockCount/totalBlocks*100)}%)`);
				
				// Update with filtered blocks
				spatialGridManagerRef.current.updateFromTerrain(visibleBlocks);
				
				// Schedule a full update later
				console.log("Scheduling full spatial hash update in the background");
				setTimeout(() => {
					if (spatialGridManagerRef.current) {
						console.log("Performing full spatial hash update");
						spatialGridManagerRef.current.updateFromTerrain(terrainRef.current);
					}
				}, 10000); // 10 seconds later
				
				return Promise.resolve();
			}
		}
		
		// Continue with normal initialization
		console.log("Initializing spatial hash with all terrain blocks...");
		
		try {
			await spatialGridManagerRef.current.updateFromTerrain(terrainRef.current);
		} catch (error) {
			console.error("Error initializing spatial hash:", error);
		}
		
		// Mark first load as completed
		firstLoadCompletedRef.current = true;
		
		return Promise.resolve();
	};

	// Update mousemove effect to use requestAnimationFrame
	useEffect(() => {
		const handleMouseMove = () => {
			// Cancel any existing animation frame
			if (mouseMoveAnimationRef.current) {
				cancelAnimationFrame(mouseMoveAnimationRef.current);
			}
			// Request new animation frame
			mouseMoveAnimationRef.current = requestAnimationFrame(updatePreviewPosition);
		};

		window.addEventListener("mousemove", handleMouseMove);
		
		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			// Clean up animation on unmount
			if (mouseMoveAnimationRef.current) {
				cancelAnimationFrame(mouseMoveAnimationRef.current);
				mouseMoveAnimationRef.current = null;
			}
		};
	}, []);

	// Define camera reset effects and axis lock effects
	useEffect(() => {
		if (cameraReset) {
			cameraManager.resetCamera();
		}
	}, [cameraReset]);

	useEffect(() => {
		cameraManager.handleSliderChange(cameraAngle);
	}, [cameraAngle]);

	useEffect(() => {
		axisLockEnabledRef.current = axisLockEnabled;
	}, [axisLockEnabled]);

	// effect to update grid size
	useEffect(() => {
		updateGridSize(gridSize);
	}, [gridSize]);

	// Add this effect to disable frustum culling
	useEffect(() => {
		// Disable frustum culling on camera
		if (threeCamera) {
			threeCamera.frustumCulled = false;
		}
		
		// Disable frustum culling on all scene objects
		if (scene) {
			scene.traverse((object) => {
				if (object.isMesh || object.isInstancedMesh) {
					object.frustumCulled = false;
				}
			});
		}
	}, [threeCamera, scene]);

	// Initialize instanced meshes and load terrain from IndexedDB
	useEffect(() => {
		let mounted = true;

		function initialize() {
			// Initialize camera manager with camera and controls
			if (threeCamera && orbitControlsRef.current) {
				cameraManager.initialize(threeCamera, orbitControlsRef.current);
				
				// Add direct change event listener for camera movement
				// This ensures view distance culling updates when using orbit controls
				orbitControlsRef.current.addEventListener('change', () => {
					// Trigger camera movement handling
					handleCameraMove();
				});
			}

			// Load skybox
			const loader = new THREE.CubeTextureLoader();
			loader.setPath("./assets/skyboxes/partly-cloudy/");
			const textureCube = loader.load(["+x.png", "-x.png", "+y.png", "-y.png", "+z.png", "-z.png"]);
			if (scene) {
				scene.background = textureCube;
			}

			// Initialize the new chunk system instead of the texture atlas
			if (scene) {
				console.log("Initializing chunk system with view distance:", getViewDistance());
				// Initialize the chunk system with the scene and view distance
				initChunkSystem(scene, { 
					viewDistance: getViewDistance(),
					viewDistanceEnabled: true
				}).then(() => {
					console.log("Chunk system initialized successfully");
				}).catch(error => {
					console.error("Error initializing chunk system:", error);
				});
			}
			
			meshesInitializedRef.current = true;

			// Load custom blocks from IndexedDB
			DatabaseManager.getData(STORES.CUSTOM_BLOCKS, "blocks")
				.then((customBlocksData) => {
					if (customBlocksData && customBlocksData.length > 0) {
						/// loop through all the custom blocks and process them
						for(const block of customBlocksData) {
							processCustomBlock(block);
						}
						
						// Notify the app that custom blocks were loaded
						window.dispatchEvent(new CustomEvent('custom-blocks-loaded', {
							detail: { blocks: customBlocksData }
						}));
						
						// No need to initialize texture atlas here, it's done in the chunk system
					}
					
					// Load terrain from IndexedDB
					return DatabaseManager.getData(STORES.TERRAIN, "current");
				})
				.then((savedTerrain) => {
					if (!mounted) return;

					if (savedTerrain) {
						terrainRef.current = savedTerrain;
						console.log("Terrain loaded from IndexedDB");
						totalBlocksRef.current = Object.keys(terrainRef.current).length;
						
						// Don't mark loaded terrain as having unsaved changes
						pendingChangesRef.current = { added: {}, removed: {} };
						console.log("Loaded terrain marked as saved - no unsaved changes");
						
						// Show a loading message while we preload all textures
						loadingManager.showLoading('Preloading textures for all blocks...');
						
						// Preload textures for all block types actually used in the terrain
						setTimeout(async () => {
							try {
								console.log("Preloading textures for ALL blocks in terrain...");
								
								// Create a set of unique block IDs used in the terrain
								const usedBlockIds = new Set();
								Object.values(terrainRef.current).forEach(blockId => {
									usedBlockIds.add(parseInt(blockId));
								});
								
								console.log(`Found ${usedBlockIds.size} unique block types in terrain`);
								
								// Mark each used block type as essential to ensure its textures are loaded
								usedBlockIds.forEach(blockId => {
									if (BlockTypeRegistry && BlockTypeRegistry.instance) {
										BlockTypeRegistry.instance.markBlockTypeAsEssential(blockId);
									}
								});
								
								// Force a reload of ALL block textures, not just the ones in the terrain
								// This ensures a complete texture atlas
								if (BlockTypeRegistry && BlockTypeRegistry.instance) {
									await BlockTypeRegistry.instance.preload();
								}
								
								// Now force a complete texture atlas rebuild to ensure all textures are available
								await rebuildTextureAtlas();
								
								// Update the chunk system with the loaded terrain only AFTER textures are loaded
								console.log("Textures preloaded, updating terrain chunks...");
								updateTerrainChunks(terrainRef.current, true); // Set true to only load visible chunks
								
								// Process chunks to ensure everything is visible
								processChunkRenderQueue();
								
								// Store all terrain data in a separate reference for incremental loading
								// This will be used to load additional chunks as the camera moves
								window.fullTerrainDataRef = terrainRef.current;
								
								// Add a new "pendingChunksToLoad" state to track chunks that need loading
								window.pendingChunksToLoad = new Set();
								
								// Hide loading screen
								loadingManager.hideLoading();
								
								// Set page as loaded
								setPageIsLoaded(true);
							} catch (error) {
								console.error("Error preloading textures:", error);
								// Still update terrain and show page even if there was an error
								updateTerrainChunks(terrainRef.current);
								loadingManager.hideLoading();
								setPageIsLoaded(true);
							}
						}, 100);
					} else {
						console.log("No terrain found in IndexedDB");
						// Initialize with empty terrain
						terrainRef.current = {};
						totalBlocksRef.current = 0;
					}

					setPageIsLoaded(true);
				})
				.catch((error) => {
					console.error("Error loading terrain or custom blocks:", error);
					meshesInitializedRef.current = true;
					setPageIsLoaded(true);
				});
		}

		// Initialize the tool manager with all the properties tools might need
		const terrainBuilderProps = {
			scene,
			terrainRef: terrainRef,
			currentBlockTypeRef: currentBlockTypeRef,
			previewPositionRef: previewPositionRef,
			terrainBuilderRef: ref, // Add a reference to this component
			undoRedoManager: undoRedoManager, // Pass undoRedoManager directly without wrapping
			placementChangesRef: placementChangesRef, // Add placement changes ref for tracking undo/redo
			isPlacingRef: isPlacingRef, // Add placing state ref
			modeRef, // Add mode reference for add/remove functionality
			getPlacementPositions, // Share position calculation utility
			importedUpdateTerrainBlocks, // Direct access to optimized terrain update function
			updateSpatialHashForBlocks, // Direct access to spatial hash update function
			// Add any other properties tools might need
		};
		
		toolManagerRef.current = new ToolManager(terrainBuilderProps);
		
		// Register tools
		const wallTool = new WallTool(terrainBuilderProps);
		toolManagerRef.current.registerTool("wall", wallTool);
		
		// Register the new BrushTool
		const brushTool = new BrushTool(terrainBuilderProps);
		toolManagerRef.current.registerTool("brush", brushTool);
		
		// Register the new GroundTool
		const groundTool = new GroundTool(terrainBuilderProps);
		toolManagerRef.current.registerTool("ground", groundTool);
		
		// Register the new PipeTool
		const pipeTool = new PipeTool(terrainBuilderProps);
		toolManagerRef.current.registerTool("pipe", pipeTool);
		
		initialize();

		// Add at the end of the initialize() function, right before the final closing bracket
		// Also register a keydown event listener to detect WASD movement
		window.addEventListener('keydown', (event) => {
			// For WASD/arrow keys movement, also trigger chunk loading
			const key = event.key.toLowerCase();
			if (['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'].includes(key)) {
				// Throttle calls during continuous movement
				if (!window.lastKeyMoveTime || Date.now() - window.lastKeyMoveTime > 200) {
					handleCameraMove();
					window.lastKeyMoveTime = Date.now();
				}
			}
		});

		// Set up periodic check for chunks to load, even if camera isn't moving
		// This ensures chunks eventually load even without camera movement
		window.chunkLoadCheckInterval = setInterval(() => {
			if (window.fullTerrainDataRef && terrainRef.current &&
				Object.keys(window.fullTerrainDataRef).length > Object.keys(terrainRef.current).length) {
				console.log("Performing periodic check for chunks to load");
				loadNewChunksInViewDistance();
			} else if (window.fullTerrainDataRef && terrainRef.current &&
				Object.keys(window.fullTerrainDataRef).length === Object.keys(terrainRef.current).length) {
				// All chunks loaded, clear the interval
				console.log("All chunks loaded, clearing periodic check");
				clearInterval(window.chunkLoadCheckInterval);
			}
		}, 3000); // Check every 3 seconds

		// Return cleanup function
		return () => {
			console.log("TerrainBuilder component unmounting, cleaning up resources");
			mounted = false;
			
			// Clean up any chunk-related timers
			if (window.chunkLoadCheckInterval) {
				clearInterval(window.chunkLoadCheckInterval);
				window.chunkLoadCheckInterval = null;
			}
		};
	}, [threeCamera, scene]);
	
	// Add effect to update tools with undoRedoManager when it becomes available - at the top level of the component
	useEffect(() => {
		if (undoRedoManager?.current && toolManagerRef.current) {
	
			try {
				Object.values(toolManagerRef.current.tools).forEach(tool => {
					if (tool) {
						// Pass the undoRedoManager ref to each tool
						tool.undoRedoManager = undoRedoManager;
						const toolGotManager = tool.undoRedoManager === undoRedoManager;
					}
				});
			} catch (error) {
				console.error('TerrainBuilder: Error updating tools with undoRedoManager:', error);
			}
		} else {
			if (!undoRedoManager?.current) {
				console.warn('TerrainBuilder: undoRedoManager.current is not available yet');
			}
			if (!toolManagerRef.current) {
				console.warn('TerrainBuilder: toolManagerRef.current is not available yet');
			}
		}
	}, [undoRedoManager?.current]);

	// Cleanup effect that cleans up meshes when component unmounts
	useEffect(() => {
		// Capture the current value of the ref when the effect runs
		const currentInstancedMeshes = instancedMeshRef.current;
		
		return () => {
			// Cleanup meshes when component unmounts, using the captured value
			if (currentInstancedMeshes) {
				Object.values(currentInstancedMeshes).forEach((mesh) => {
					if (mesh) {
						scene.remove(mesh);
						if (mesh.geometry) mesh.geometry.dispose();
						if (Array.isArray(mesh.material)) {
							mesh.material.forEach((m) => m?.dispose());
						} else if (mesh.material) {
							mesh.material.dispose();
						}
					}
				});
			}
		};
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [scene]); // Can't include safeRemoveFromScene due to function order

	// effect to refresh meshes when the meshesNeedsRefresh flag is true
	useEffect(() => {
		if (meshesNeedsRefresh.value) {
			console.log("Refreshing instance meshes due to new custom blocks");
			buildUpdateTerrain();
			meshesNeedsRefresh.value = false;
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [meshesNeedsRefresh.value]); // Use meshesNeedsRefresh.value in the dependency array

	// effect to update current block type reference when the prop changes
	useEffect(() => {
		currentBlockTypeRef.current = currentBlockType;
	}, [currentBlockType]);

	// Add this effect to update the mode ref when the prop changes
	useEffect(() => {
		modeRef.current = mode;
	}, [mode]);

	// Add this effect to update the ref when placementSize changes
	useEffect(() => {
		placementSizeRef.current = placementSize;
	}, [placementSize]);

	// Add this effect to listen for texture atlas updates
	useEffect(() => {
		if (!scene || !gl) return;
		
		console.log("Setting up texture atlas update listener");
		
		const handleTextureAtlasUpdate = (event) => {
			// Force update all materials
			scene.traverse((object) => {
				if (object.isMesh && object.material) {
					if (Array.isArray(object.material)) {
						object.material.forEach(mat => {
							if (mat.map) mat.needsUpdate = true;
						});
					} else if (object.material.map) {
						object.material.needsUpdate = true;
					}
				}
			});
			
			// Force a render
			gl.render(scene, threeCamera);
			
			// Update chunk visibility to force mesh updates
			if (getChunkSystem()) {
				console.log("Forcing chunk visibility update after texture change");
				getChunkSystem().forceUpdateChunkVisibility(); // Changed from forceUpdateAllChunkVisibility
				// Also force processing the render queue
				getChunkSystem().processRenderQueue(true);
			}
		};
		
		// Add event listener
		window.addEventListener('textureAtlasUpdated', handleTextureAtlasUpdate);
		
		// Cleanup function
		return () => {
			window.removeEventListener('textureAtlasUpdated', handleTextureAtlasUpdate);
		};
	}, [scene, gl, threeCamera]);

	/// build update terrain when the terrain state changes
	useEffect(() => {
		buildUpdateTerrain();
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [terrainRef.current]); // terrainRef.current is a mutable object, react-hooks/exhaustive-deps warning is expected

	/// onSceneReady send the scene to App.js via a setter
	useEffect(() => {
		if (scene && onSceneReady) {
			onSceneReady(scene);
		}
	}, [scene, onSceneReady]);

	// Function to manually save the terrain (can be called from parent or UI)
	const saveTerrainManually = () => {
		console.log("Manual save requested...");
		return efficientTerrainSave();
	};

	// Helper function to enable/disable auto-save
	const setAutoSaveEnabled = (enabled) => {
		console.log(`Auto-save being ${enabled ? 'enabled' : 'disabled'}`);
		isAutoSaveEnabledRef.current = enabled;
		
		// Clear existing interval
		if (autoSaveIntervalRef.current) {
			console.log("Clearing existing auto-save interval");
			clearInterval(autoSaveIntervalRef.current);
			autoSaveIntervalRef.current = null;
		}
		
		// Re-establish interval if enabled
		if (enabled) {
			console.log(`Auto-save enabled with interval: ${AUTO_SAVE_INTERVAL/1000} seconds`);
			autoSaveIntervalRef.current = setInterval(() => {
				// Only save if there are pending changes and not in the middle of an operation
				if (!isPlacingRef.current && 
				    (Object.keys(pendingChangesRef.current.terrain.added).length > 0 || 
				    Object.keys(pendingChangesRef.current.terrain.removed).length > 0)) {
					console.log("Auto-saving terrain...");
					efficientTerrainSave();
				}
			}, AUTO_SAVE_INTERVAL);
			
			// Save immediately if there are pending changes and not in the middle of an operation
			if (!isPlacingRef.current && 
			    (Object.keys(pendingChangesRef.current.terrain.added).length > 0 || 
			    Object.keys(pendingChangesRef.current.terrain.removed).length > 0)) {
				console.log("Immediate save after enabling auto-save...");
				efficientTerrainSave();
			}
		} else {
			console.log("Auto-save disabled");
		}
		
		return enabled;
	};


	// Helper function to clear all terrain data
	const clearTerrain = () => {
		if (terrainRef.current && Object.keys(terrainRef.current).length > 0) {
			terrainRef.current = {};
			console.log("Terrain cleared");
		}
		resetPendingChanges();
	};

	// Helper function to get block key from coordinates
	const getBlockKey = (coord) => {
		if (!coord) return null;
		return `${coord.x},${coord.y},${coord.z}`;
	};


	// Expose buildUpdateTerrain and clearMap via ref
	useImperativeHandle(ref, () => ({
		buildUpdateTerrain,
		updateTerrainFromToolBar,
		getCurrentTerrainData,
		clearMap,
		// Keeping these for compatibility, but they now just pass through to ChunkSystem
		saveTerrainManually, // Add manual save function
		updateTerrainBlocks, // Expose for selective updates in undo/redo
		updateTerrainForUndoRedo, // Optimized version specifically for undo/redo operations
		updateSpatialHashForBlocks, // Expose for external spatial hash updates
		fastUpdateBlock, // Ultra-optimized function for drag operations
		updateDebugInfo, // Expose debug info updates for tools
		forceChunkUpdate, // Direct chunk updating for tools like BrushTool
		forceRefreshAllChunks, // Force refresh of all chunks
		updateGridSize, // Expose for updating grid size when importing maps
		
		// Tool management
		activateTool: (toolName) => {
			if (!toolManagerRef.current) {
				console.error("Cannot activate tool: tool manager not initialized");
				return false;
			}
			return toolManagerRef.current.activateTool(toolName);
		},
		
		// Expose toolManagerRef for direct access (but only as read-only)
		get toolManagerRef() {
			return { current: toolManagerRef.current };
		},
		
		// Performance optimization APIs
		setDeferredChunkMeshing,
		
		// API for managing deferred spatial hash updates
		deferSpatialHashUpdates: (defer) => {
			deferSpatialHashUpdatesRef.current = defer;
			console.log(`Spatial hash updates are now ${defer ? 'deferred' : 'immediate'}`);
			// If we're turning off deferred updates, apply any pending updates
			if (!defer && 
				pendingSpatialHashUpdatesRef.current && 
				(pendingSpatialHashUpdatesRef.current.added.length + 
				pendingSpatialHashUpdatesRef.current.removed.length > 0)) {
				return applyDeferredSpatialHashUpdates();
			}
			return Promise.resolve();
		},
		applyDeferredSpatialHashUpdates,
		isPendingSpatialHashUpdates: () => 
			pendingSpatialHashUpdatesRef.current && 
			(pendingSpatialHashUpdatesRef.current.added.length + 
			pendingSpatialHashUpdatesRef.current.removed.length > 0),
		
		// Methods for view distance handling
		setViewDistance: (distance) => {
			console.log(`Setting view distance to ${distance} from component ref`);
			
			// Import setViewDistance from terrain constants
			const { setViewDistance } = require('./constants/terrain');
			
			// Update the global view distance
			setViewDistance(distance);
			
			// Update the chunk system
			const chunkSystem = getChunkSystem();
			if (chunkSystem) {
				chunkSystem.setViewDistance(distance);
			}
			
			// Always force a complete refresh when view distance changes
			console.log("[setViewDistance] Forcing complete chunk refresh");
			
			forceRefreshAllChunks();
			
			return true;
		},
		
		getViewDistance: () => {
			// Import getViewDistance from terrain constants
			const { getViewDistance } = require('./constants/terrain');
			return getViewDistance();
		},
		
		// Toggle view distance culling
		toggleViewDistanceCulling: (enabled) => {
			console.log(`${enabled ? 'Enabling' : 'Disabling'} view distance culling`);
			
			const chunkSystem = getChunkSystem();
			if (chunkSystem) {
				setChunkViewDistanceEnabled(enabled);
				
				// Force refresh chunks to apply the change
				forceRefreshAllChunks();
				return true;
			}
			
			return false;
		},
		
		// Configure the auto-save interval (in milliseconds)
		setAutoSaveInterval: (intervalMs) => {
			console.log(`Setting auto-save interval to ${intervalMs}ms`);
			// Clear existing interval
			if (autoSaveIntervalRef.current) {
				clearInterval(autoSaveIntervalRef.current);
			}
			
			// Set new interval if a valid duration provided
			if (intervalMs && intervalMs > 0) {
				autoSaveIntervalRef.current = setInterval(() => {
					// Only save if there are pending changes and not in the middle of an operation
					if (!isPlacingRef.current && 
					    (Object.keys(pendingChangesRef.current.terrain.added).length > 0 || 
					    Object.keys(pendingChangesRef.current.terrain.removed).length > 0)) {
						console.log(`Auto-saving terrain (interval: ${intervalMs}ms)...`);
						
						efficientTerrainSave();
					}
				}, intervalMs);
				return true;
			} else {
				// Disable auto-save
				autoSaveIntervalRef.current = null;
				return false;
			}
		},
		
		// Toggle auto-save on/off
		toggleAutoSave: (enabled) => {
			return setAutoSaveEnabled(enabled);
		},
		
		// Get current auto-save status
		isAutoSaveEnabled: () => {
			return isAutoSaveEnabledRef.current;
		},
		
		// Expose placement status for other components (like UndoRedoManager)
		isPlacing: () => {
			return isPlacingRef.current;
		},
		
		

		/**
		 * Force a DB reload of terrain and then rebuild it
		 */
		async refreshTerrainFromDB() {
			console.log("=== REFRESHING TERRAIN FROM DATABASE ===");
			
			// Show a single loading screen from start to finish
			loadingManager.showLoading('Loading terrain from database...');
			
			return new Promise(async resolve => {
				try {
					// Get blocks directly
					const blocks = await DatabaseManager.getData(STORES.TERRAIN, "current");
					if (!blocks || Object.keys(blocks).length === 0) {
						console.log("No blocks found in database");
						loadingManager.hideLoading();
						resolve(false);
						return;
					}
					
					console.log(`Loaded ${Object.keys(blocks).length} blocks from database`);
					
					// Update our terrain reference
					terrainRef.current = {};
					Object.entries(blocks).forEach(([posKey, blockId]) => {
						terrainRef.current[posKey] = blockId;
					});
					
					// Clear existing chunks
					if (getChunkSystem()) {
						getChunkSystem().reset();
					}
					
					// Add all blocks to chunk system
					const chunkSystem = getChunkSystem();
					if (chunkSystem) {
						console.log(`Adding ${Object.keys(blocks).length} blocks to chunk system all at once`);
						chunkSystem.updateFromTerrainData(blocks);
						
						// Process all chunks immediately
						await loadAllChunks();
					}
					
					// Initialize spatial hash
					await initializeSpatialHash(true, false);
					
					// Hide loading screen
					loadingManager.hideLoading();
					
					resolve(true);
				} catch (error) {
					console.error("Error in refreshTerrainFromDB:", error);
					loadingManager.hideLoading();
					resolve(false);
				}
			});
		},
		// Add a new public method to force a complete rebuild of the spatial hash grid
		// This method can be called by tools like BrushTool when they need to ensure
		// the spatial hash is completely up to date after operation
		forceRebuildSpatialHash: (options = {}) => {
			//console.log("TerrainBuilder: Forcing complete rebuild of spatial hash grid");

			// Skip if spatial grid manager isn't available
			if (!spatialGridManagerRef.current) {
				console.warn("TerrainBuilder: Cannot rebuild spatial hash - spatial grid manager not available");
				return Promise.resolve();
			}

			// Force disable any throttling or deferral
			disableSpatialHashUpdatesRef.current = false;
			deferSpatialHashUpdatesRef.current = false;

			try {
				// First, clear the spatial hash grid completely
				spatialGridManagerRef.current.clear();

				// Use getCurrentTerrainData instead of terrainRef.current directly
				// This gets the full terrain data including any recent changes
				const terrainData = getCurrentTerrainData();
				
				if (!terrainData || Object.keys(terrainData).length === 0) {
					console.warn("TerrainBuilder: No terrain data available for spatial hash rebuild");
					return Promise.resolve();
				}
				
				const totalBlocks = Object.keys(terrainData).length;
				//console.log(`TerrainBuilder: Found ${totalBlocks} terrain blocks to process`);
				
				// Show loading screen if requested and there are many blocks
				const showLoading = options.showLoadingScreen || (totalBlocks > 100000);
				if (showLoading) {
					loadingManager.showLoading('Rebuilding spatial hash grid...');
				}
				
				// Organize blocks by chunks to process more efficiently
				const blocksByChunk = {};
				
				// Process terrain data to organize blocks by chunk
				for (const [posKey, blockId] of Object.entries(terrainData)) {
					// Skip air blocks (id = 0) and invalid blocks
					if (blockId === 0 || blockId === undefined || blockId === null) continue;

					// Parse the position
					const [x, y, z] = posKey.split(',').map(Number);
					
					// Get chunk key (we use chunk coordinates like x>>4,z>>4)
					const chunkX = Math.floor(x / 16);
					const chunkZ = Math.floor(z / 16);
					const chunkKey = `${chunkX},${chunkZ}`;
					
					// Initialize chunk array if needed
					if (!blocksByChunk[chunkKey]) {
						blocksByChunk[chunkKey] = [];
					}
					
					// Add to chunk's blocks array with proper format for spatial hash
					blocksByChunk[chunkKey].push({
						id: blockId,
						position: [x, y, z]
					});
				}
				
				const chunkKeys = Object.keys(blocksByChunk);
				//console.log(`TerrainBuilder: Organized blocks into ${chunkKeys.length} chunks`);
				
				if (chunkKeys.length === 0) {
					console.warn("TerrainBuilder: No valid chunks found for spatial hash rebuild");
					if (showLoading) loadingManager.hideLoading();
					return Promise.resolve();
				}
				
				// Process chunks in batches to avoid UI freezes
				const MAX_CHUNKS_PER_BATCH = 10;
				const totalBatches = Math.ceil(chunkKeys.length / MAX_CHUNKS_PER_BATCH);
				
				// Function to process a batch of chunks
				const processBatch = (batchIndex) => {
					return new Promise((resolve) => {
						// Get batch of chunk keys
						const startIdx = batchIndex * MAX_CHUNKS_PER_BATCH;
						const endIdx = Math.min(startIdx + MAX_CHUNKS_PER_BATCH, chunkKeys.length);
						const batchChunks = chunkKeys.slice(startIdx, endIdx);
						
						// Collect all blocks from this batch
						const batchBlocks = [];
						batchChunks.forEach(chunkKey => {
							batchBlocks.push(...blocksByChunk[chunkKey]);
						});
						
						// Skip if no blocks in this batch
						if (batchBlocks.length === 0) {
							resolve();
							return;
						}
						
						// Update progress if showing loading screen
						if (showLoading) {
							const progress = Math.round((batchIndex / totalBatches) * 100);
							loadingManager.updateLoading(`Processing batch ${batchIndex + 1}/${totalBatches}`, progress);
						}
						
						// Update spatial hash with this batch of blocks
						spatialGridManagerRef.current.updateBlocks(
							batchBlocks, 
							[], // No blocks to remove
							{ 
								force: true,
								silent: false,
								skipIfBusy: false
							}
						);
						
						// Use setTimeout to avoid UI freezes between batches
						setTimeout(() => resolve(), 0);
					});
				};
				
				// Process all batches sequentially
				return new Promise(async (resolve) => {
					for (let i = 0; i < totalBatches; i++) {
						await processBatch(i);
					}
					
					//console.log(`TerrainBuilder: Completed spatial hash rebuild with ${totalBlocks} blocks in ${totalBatches} batches`);
					
					// Force mesh updates only for affected chunks to avoid unnecessary work
					if (typeof forceChunkUpdate === 'function' && chunkKeys.length > 0) {
						forceChunkUpdate(chunkKeys, { skipNeighbors: true });
					} 
					// Fall back to refreshing all chunks if needed
					else if (typeof forceRefreshAllChunks === 'function') {
						forceRefreshAllChunks();
					}
					
					// Hide loading screen if it was shown
					if (showLoading) {
						loadingManager.hideLoading();
					}
					
					resolve();
				});
			} catch (err) {
				console.error("TerrainBuilder: Error rebuilding spatial hash grid", err);
				if (options.showLoadingScreen) {
					loadingManager.hideLoading();
				}
				return Promise.reject(err);
			}
		}
	}));  // This is the correct syntax with just one closing parenthesis

	
	// Add resize listener to update canvasRect
	useEffect(() => {
		const handleResize = () => {
			canvasRectRef.current = null; // Force recalculation on next update
		};
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	}, []);

	// Add key event handlers to delegate to tools
	const handleKeyDown = (event) => {
		// Add keyboard shortcut for Brush tool - 'B' key
		if (event.key === 'b' || event.key === 'B') {
			// Toggle brush tool (activate if not active, deactivate if active)
			const activeTool = toolManagerRef.current?.getActiveTool();
			if (activeTool && activeTool.name === "BrushTool") {
				// Tool is already active, deactivate it
				toolManagerRef.current?.activateTool(null);
			} else {
				// Activate the brush tool
				toolManagerRef.current?.activateTool("brush");
			}
			// Don't propagate the event further
			return;
		}
		
		// Forward event to active tool
		if (toolManagerRef.current && toolManagerRef.current.getActiveTool()) {
			toolManagerRef.current.handleKeyDown(event);
		}
	};

	const handleKeyUp = (event) => {
		if (toolManagerRef.current && toolManagerRef.current.getActiveTool()) {
			toolManagerRef.current.handleKeyUp(event);
		}
	};

	// Update useEffect to add key event listeners
	useEffect(() => {
		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('keyup', handleKeyUp);
		
		return () => {
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('keyup', handleKeyUp);
		};
	}, []);

	// Add cleanup for tool manager when component unmounts
	useEffect(() => {
		return () => {
			if (toolManagerRef.current) {
				toolManagerRef.current.dispose();
				toolManagerRef.current = null;
			}
		};
	}, []);

	
	// update the terrain blocks for added and removed blocks
	const updateTerrainBlocks = (addedBlocks, removedBlocks, options = {}) => {
		if (!addedBlocks && !removedBlocks) {
			return;
		}

		// Validate input
		if (typeof addedBlocks !== 'object') addedBlocks = {};
		if (typeof removedBlocks !== 'object') removedBlocks = {};

		// Skip if no blocks to update
		if (Object.keys(addedBlocks).length === 0 && Object.keys(removedBlocks).length === 0) {
			return;
		}

		console.time('updateTerrainBlocks');
		console.log(`Updating terrain with ${Object.keys(addedBlocks).length} added blocks and ${Object.keys(removedBlocks).length} removed blocks`);

		// Track changes for undo/redo
		trackTerrainChanges(addedBlocks, removedBlocks);

		// Save changes to undo stack immediately
		if (pendingChangesRef.current && 
			(Object.keys(pendingChangesRef.current.terrain.added || {}).length > 0 || 
			 Object.keys(pendingChangesRef.current.terrain.removed || {}).length > 0)) {
			console.log("Saving changes to undo stack:", pendingChangesRef.current);
			if (undoRedoManager?.current?.saveUndo) {
				undoRedoManager.current.saveUndo(pendingChangesRef.current);
			}
		}

		// Update the terrain data structure
		Object.entries(addedBlocks).forEach(([posKey, blockId]) => {
			terrainRef.current[posKey] = blockId;
		});
			
		Object.entries(removedBlocks).forEach(([posKey]) => {
			delete terrainRef.current[posKey];
		});
			
		// Update total block count
		totalBlocksRef.current = Object.keys(terrainRef.current).length;
		
		// Send total blocks count back to parent component
		if (sendTotalBlocks) {
			sendTotalBlocks(totalBlocksRef.current);
		}
		
		// Update debug info
		updateDebugInfo();

		// Delegate to the optimized imported function for chunk and spatial hash updates
		importedUpdateTerrainBlocks(addedBlocks, removedBlocks);
		
		// Only update spatial hash if not explicitly skipped
		// This allows BrushTool to skip spatial hash updates during dragging
		if (!options.skipSpatialHash) {
			// Convert blocks to the format expected by updateSpatialHashForBlocks
			const addedBlocksArray = Object.entries(addedBlocks).map(([posKey, blockId]) => {
				const [x, y, z] = posKey.split(',').map(Number);
				return {
					id: blockId,
					position: [x, y, z]
				};
			});

			const removedBlocksArray = Object.entries(removedBlocks).map(([posKey, blockId]) => {
				const [x, y, z] = posKey.split(',').map(Number);
				return {
					id: 0, // Use 0 for removed blocks
					position: [x, y, z]
				};
			});
			
			// Explicitly update the spatial hash for collisions with force option
			// This ensures that the spatial hash is updated immediately, not deferred
			updateSpatialHashForBlocks(addedBlocksArray, removedBlocksArray, { force: true });
		} else {
			console.log('Skipping spatial hash update as requested');
		}
		
		console.timeEnd('updateTerrainBlocks');
	};

	
	// Special optimized version for undo/redo operations
	const updateTerrainForUndoRedo = (addedBlocks, removedBlocks, source = "undo/redo") => {
		console.time(`updateTerrainForUndoRedo-${source}`);
		
		// Skip if no blocks to update
		if ((!addedBlocks || Object.keys(addedBlocks).length === 0) && 
			(!removedBlocks || Object.keys(removedBlocks).length === 0)) {
			console.log(`No blocks to update for ${source}`);
			console.timeEnd(`updateTerrainForUndoRedo-${source}`);
			return;
		}
		
		// Log operation
		console.log(`${source} operation: Adding ${Object.keys(addedBlocks || {}).length} blocks, removing ${Object.keys(removedBlocks || {}).length} blocks`);
		
		// Validate input
		addedBlocks = addedBlocks || {};
		removedBlocks = removedBlocks || {};

		// Update the terrain data structure
		Object.entries(addedBlocks).forEach(([posKey, blockId]) => {
			terrainRef.current[posKey] = blockId;
		});
			
		Object.entries(removedBlocks).forEach(([posKey]) => {
			delete terrainRef.current[posKey];
		});
			
		// Update total block count
		totalBlocksRef.current = Object.keys(terrainRef.current).length;
		
		// Send updated total blocks count back to parent component
		if (sendTotalBlocks) {
			sendTotalBlocks(totalBlocksRef.current);
		}
		
		// Update debug info
		updateDebugInfo();
		
		// Delegate to the optimized imported function for chunk and spatial hash updates
		importedUpdateTerrainBlocks(addedBlocks, removedBlocks);
		
		// Convert blocks to the format expected by updateSpatialHashForBlocks
		const addedBlocksArray = Object.entries(addedBlocks).map(([posKey, blockId]) => {
			const [x, y, z] = posKey.split(',').map(Number);
			return {
				id: blockId,
				position: [x, y, z]
			};
		});

		const removedBlocksArray = Object.entries(removedBlocks).map(([posKey, blockId]) => {
			const [x, y, z] = posKey.split(',').map(Number);
			return {
				id: 0, // Use 0 for removed blocks
				position: [x, y, z]
			};
		});
		
		// Explicitly update the spatial hash for collisions with force option
		updateSpatialHashForBlocks(addedBlocksArray, removedBlocksArray, { force: true });
		
		console.timeEnd(`updateTerrainForUndoRedo-${source}`);
	};

	
	// Function to update which chunks are visible based on camera position and frustum
	// REMOVED: This function is no longer needed since we're using the new ChunkSystem
	// Replaced all calls with direct calls to processChunkRenderQueue()
	// const updateVisibleChunks = () => { ... };

	// Call this in buildUpdateTerrain after updating terrainRef
	
	// Optimized ray intersection using spatial hash
	const getOptimizedRaycastIntersection = (prioritizeBlocks = true) => {
		// Safety checks
		if (!scene || !threeCamera || !threeRaycaster) return null;
		
		// Use the raw pointer coordinates directly from THREE.js
		const normalizedMouse = pointer.clone();
		
		// Setup raycaster with the normalized coordinates
		threeRaycaster.setFromCamera(normalizedMouse, threeCamera);
		
		// First, check for block collisions using optimized ray casting
		let intersection = null;
		
		// Safety check - ensure spatialGridManagerRef.current is initialized
		if (useSpatialHashRef.current && spatialGridManagerRef.current && spatialGridManagerRef.current.size > 0) {
			// Prepare raycast options
			const raycastOptions = {
				maxDistance: selectionDistanceRef.current,
				prioritizeBlocks,
				gridSize: gridSizeRef.current,
				recentlyPlacedBlocks: recentlyPlacedBlocksRef.current,
				isPlacing: isPlacingRef.current,
				mode: modeRef.current,
				debug: true // Enable debug logging for this call
			};
			
			// Perform raycast against spatial hash grid
			const gridResult = spatialGridManagerRef.current.raycast(
				threeRaycaster, 
				threeCamera, 
				raycastOptions
			);
			
			
			intersection = gridResult;
		} else {
			// Fallback to simple ground plane detection if spatial hash is not available
			const rayOrigin = threeRaycaster.ray.origin;
			const rayDirection = threeRaycaster.ray.direction;
			
			// Calculate intersection with the ground plane
			const target = new THREE.Vector3();
			const intersectionDistance = rayOrigin.y / -rayDirection.y;
			
			// Only consider intersections in front of the camera and within selection distance
			if (intersectionDistance > 0 && intersectionDistance < selectionDistanceRef.current) {
				// Calculate the intersection point
				target.copy(rayOrigin).addScaledVector(rayDirection, intersectionDistance);
				
				// Check if this point is within our valid grid area
				const gridSizeHalf = gridSizeRef.current / 2;
				if (Math.abs(target.x) <= gridSizeHalf && Math.abs(target.z) <= gridSizeHalf) {
					// This is a hit against the ground plane within the valid build area
					intersection = {
						point: target.clone(),
						normal: new THREE.Vector3(0, 1, 0), // Normal is up for ground plane
						block: { x: Math.floor(target.x), y: 0, z: Math.floor(target.z) },
						blockId: null, // No block here - it's the ground
						distance: intersectionDistance,
						isGroundPlane: true
					};
				}
			}
		}
		
		return intersection;
	};

	
	
	// Add these variables to track camera movement outside the animate function
	const lastCameraPosition = new THREE.Vector3();
	const lastCameraRotation = new THREE.Euler();
	const cameraMovementTimeout = { current: null };
	const chunkUpdateThrottle = { current: 0 };
	const logThrottle = { current: 0, lastTime: 0 }; // Add throttling for logs

	// Update the usages of these optimizations
	useEffect(() => {
		// Apply renderer optimizations
		optimizeRenderer(gl);
		
		// Initialize camera manager with camera and controls
		cameraManager.initialize(threeCamera, orbitControlsRef.current);
		
		// Set up a consistent update loop
		let frameId;
		let lastTime = 0;
		let frameCount = 0;
		
		const animate = (time) => {
			frameId = requestAnimationFrame(animate);
			
			// Calculate delta time for smooth updates
			const delta = time - lastTime;
			lastTime = time;
			
			// Only run heavy operations every few frames to reduce lag
			frameCount++;
			const shouldRunHeavyOperations = frameCount % 2 === 0; // Reduced from 3 to 2 for more frequent updates
			
			// Check for valid camera
			if (!threeCamera) {
				console.warn("[Animation] Three camera is null or undefined");
				return;
			}

			// Check the currentCameraRef to ensure it's properly set
			if (!currentCameraRef.current) {
				console.warn("[Animation] Current camera reference is not set");
				currentCameraRef.current = threeCamera;
			}
			
			// Detect camera movement (cheaper comparison)
			const posX = threeCamera.position.x;
			const posY = threeCamera.position.y;
			const posZ = threeCamera.position.z;
			
			const rotX = threeCamera.rotation.x;
			const rotY = threeCamera.rotation.y;
			const rotZ = threeCamera.rotation.z;
			
			const positionChanged = 
				Math.abs(posX - lastCameraPosition.x) > 0.01 ||
				Math.abs(posY - lastCameraPosition.y) > 0.01 ||
				Math.abs(posZ - lastCameraPosition.z) > 0.01;
				
			const rotationChanged = 
				Math.abs(rotX - lastCameraRotation.x) > 0.01 ||
				Math.abs(rotY - lastCameraRotation.y) > 0.01 ||
				Math.abs(rotZ - lastCameraRotation.z) > 0.01;
			
			const isCameraMoving = positionChanged || rotationChanged;
			
			// Update stored values (cheaper than .copy())
			lastCameraPosition.x = posX;
			lastCameraPosition.y = posY;
			lastCameraPosition.z = posZ;
			
			lastCameraRotation.x = rotX;
			lastCameraRotation.y = rotY;
			lastCameraRotation.z = rotZ;
			
			// Log camera movement details (throttled to prevent console spam)
			logThrottle.current++;
			const now = Date.now();
			if ((isCameraMoving && logThrottle.current >= 30) || (now - logThrottle.lastTime > 5000)) {
				logThrottle.current = 0;
				logThrottle.lastTime = now;
			}
			
			// Update chunk system with the current camera and process render queue
			// Always do this regardless of movement
			const updateResult = updateChunkSystemWithCamera();
			
			// If camera is moving, update more frequently and force visibility updates
			if (isCameraMoving) {
				// Force an extra chunk system update to ensure visibility is updated
				const chunkSystem = getChunkSystem();
				if (chunkSystem && chunkSystem._scene && chunkSystem._scene.camera) {
					
					// Only force update visibility every 5 frames during movement
					// This reduces performance impact while maintaining visual quality
					if (frameCount % 10 === 0) {
						// IMPORTANT: Use the new method to force chunk visibility updates
						// This bypasses the render queue and directly updates all chunks
						const { forceUpdateChunkVisibility } = require('./chunks/TerrainBuilderIntegration');
						forceUpdateChunkVisibility();
					}
				}
			} else {
				// When camera is still, update much less frequently (every ~1 second at 60fps)
				// Force a full chunk update periodically even if the camera isn't moving
				// This ensures chunk visibility is refreshed regularly but at a lower cost
				if (frameCount % 60 === 0) { // Every ~1 second at 60fps
					// Use direct force update instead of the older refresh method
					const { forceUpdateChunkVisibility } = require('./chunks/TerrainBuilderIntegration');
					forceUpdateChunkVisibility();
				}
			}
			
			// Only log failure occasionally
			if (!updateResult && logThrottle.current % 60 === 0) {
				console.error("[Animation] Failed to update chunk system with camera");
			}
			
			// Set camera moving state
			if (isCameraMoving) {
				cameraMoving.current = true;
				
				// Clear any existing timeout
				if (cameraMovementTimeout.current) {
					clearTimeout(cameraMovementTimeout.current);
				}
				
				// Set timeout to detect when camera stops moving
				cameraMovementTimeout.current = setTimeout(() => {
					cameraMoving.current = false;
					console.log("[Animation] Camera stopped moving");
					
					// Force a full update when camera stops
					updateChunkSystemWithCamera();
					// Force a second update after a short delay to ensure chunks are properly visible
					setTimeout(() => {
						updateChunkSystemWithCamera();
						//updateVisibleChunks();
					}, 50);
				}, 100); // Reduced from 150ms to 100ms for faster response
			}
			
			// Only update if enough time has passed (throttle updates)
			if (delta > 16 && shouldRunHeavyOperations) { // ~60fps max and only every 2nd frame
				// Throttle chunk updates during camera movement
				if (cameraMoving.current) {
					// Decrease throttle during camera movement (update more frequently)
					chunkUpdateThrottle.current++;
					if (chunkUpdateThrottle.current >= 2) { // Reduced from 3 to 2 for more frequent updates
						//updateVisibleChunks();
						chunkUpdateThrottle.current = 0;
					}
					
					// Skip spatial hash updates completely during camera movement
				} else if (frameCount % 5 === 0) { // Reduced from 10 to 5 for more frequent updates when camera is still
					// Normal updates when camera is still, but less frequent
					//updateVisibleChunks();
					
					// Extremely infrequent spatial hash updates (only once every ~5 seconds)
					if (frameCount % 300 === 0) {
						// Don't update spatial hash in the animation loop at all
						// This should only happen on explicit user actions or when the map is first loaded
					}
				}
				
				// Only update shadows periodically and even less frequently
				if (frameCount % 30 === 0) {
					if (gl && gl.shadowMap) {
						gl.shadowMap.needsUpdate = true;
					}
					
					// Force shadow maps to update occasionally
					if (directionalLightRef.current) {
						directionalLightRef.current.shadow.needsUpdate = true;
					}
				}
			}
		}
		
		// Start the animation loop
		frameId = requestAnimationFrame(animate);
		
		// Clean up animation frame on component unmount
		return () => {
			cancelAnimationFrame(frameId);
		};
	}, [gl]);

	

	// Handle camera movement to pause chunk processing during navigation
	const handleCameraMove = () => {
		if (!threeCamera) return;
		
		// Update the camera in the chunk system for culling
		updateChunkSystemCamera(threeCamera);
		
		// Check if we need to load additional chunks from the full terrain data
		loadNewChunksInViewDistance();
		
		// Process the chunk render queue to update visibility
		processChunkRenderQueue();
	};

	// Handle camera movement for instant processing of chunks as they come into view
	const loadNewChunksInViewDistance = () => {
		// Skip if no camera or chunk system
		const chunkSystem = getChunkSystem();
		if (!chunkSystem || !threeCamera) {
			return;
		}
		
		// All chunks are already loaded, just process the render queue
		// to update visibility for chunks that are now in view
		processChunkRenderQueue();
	};

	// Initialize the last update time
	handleCameraMove.lastUpdateTime = 0;

	// Add this function to efficiently update the spatial hash for a batch of blocks
	const updateSpatialHashForBlocks = (addedBlocks = [], removedBlocks = [], options = {}) => {
		// Skip if disabled globally
		if (disableSpatialHashUpdatesRef.current) {
			return;
		}
		
		// Safety check - ensure spatialGridManagerRef.current is initialized
		if (!spatialGridManagerRef.current) {
			return;
		}
		
		// Ensure both arrays are valid
		const validAddedBlocks = Array.isArray(addedBlocks) ? addedBlocks : [];
		const validRemovedBlocks = Array.isArray(removedBlocks) ? removedBlocks : [];
		
		// Skip if both arrays are empty
		if (validAddedBlocks.length === 0 && validRemovedBlocks.length === 0) {
			return;
		}

		// If we're currently in bulk loading mode, just collect updates for later processing
		if (deferSpatialHashUpdatesRef.current && !options.force) {
			console.log(`Deferring spatial hash update for ${validAddedBlocks.length} added and ${validRemovedBlocks.length} removed blocks`);
			// Collect updates to apply later
			pendingSpatialHashUpdatesRef.current.added.push(...validAddedBlocks);
			pendingSpatialHashUpdatesRef.current.removed.push(...validRemovedBlocks);
			return;
		}
		
		// Skip if too many blocks - will be handled by periodic updates instead
		// But always process if force option is set
		if (!options.force && (validAddedBlocks.length > 100 || validRemovedBlocks.length > 100)) {
			return;
		}
		
		// Very aggressive throttling to avoid performance impact
		const now = performance.now();
		if (now - spatialHashLastUpdateRef.current < 1000 && !options.force) { // Wait at least 1 second between updates
			// For small numbers of blocks (1-10), queue for later update
			if (validAddedBlocks.length + validRemovedBlocks.length <= 10 && !spatialHashUpdateQueuedRef.current) {
				spatialHashUpdateQueuedRef.current = true;
				
				// Use longer delay
				setTimeout(() => {
					// Only update if not processing something else
					if (spatialGridManagerRef.current && !spatialGridManagerRef.current.isProcessing) {
						try {
							// Filter blocks to only those in or near the frustum
							const camera = cameraRef.current;
							
							if (camera && !options.force) {
								// Update the frustum cache
								spatialGridManagerRef.current.updateFrustumCache(camera, getViewDistance());
								
								// Filter added blocks to those in frustum
								const filteredAddedBlocks = validAddedBlocks.filter(block => {
									if (!block || typeof block !== 'object') return false;
									
									// Handle different possible formats
									let x, y, z;
									if (Array.isArray(block.position)) {
										[x, y, z] = block.position;
									} else if (block.x !== undefined && block.y !== undefined && block.z !== undefined) {
										x = block.x;
										y = block.y;
										z = block.z;
									} else if (typeof block === 'string') {
										[x, y, z] = block.split(',').map(Number);
									} else {
										return false;
									}
									
									const chunkX = Math.floor(x / CHUNK_SIZE);
									const chunkY = Math.floor(y / CHUNK_SIZE);
									const chunkZ = Math.floor(z / CHUNK_SIZE);
									const chunkKey = `${chunkX},${chunkY},${chunkZ}`;
									
									return spatialGridManagerRef.current.chunksInFrustum.has(chunkKey);
								});
								
								// Filter removed blocks to those in frustum
								const filteredRemovedBlocks = validRemovedBlocks.filter(block => {
									if (!block) return false;
									
									// Handle different possible formats
									let x, y, z;
									if (typeof block === 'object' && Array.isArray(block.position)) {
										[x, y, z] = block.position;
									} else if (typeof block === 'object' && block.x !== undefined && block.y !== undefined && block.z !== undefined) {
										x = block.x;
										y = block.y;
										z = block.z;
									} else if (typeof block === 'string') {
										[x, y, z] = block.split(',').map(Number);
									} else {
										return false;
									}
									
									const chunkX = Math.floor(x / CHUNK_SIZE);
									const chunkY = Math.floor(y / CHUNK_SIZE);
									const chunkZ = Math.floor(z / CHUNK_SIZE);
									const chunkKey = `${chunkX},${chunkY},${chunkZ}`;
									
									return spatialGridManagerRef.current.chunksInFrustum.has(chunkKey);
								});
								
								// Only update if there are blocks to process
								if (filteredAddedBlocks.length > 0 || filteredRemovedBlocks.length > 0) {
									spatialGridManagerRef.current.updateBlocks(
										filteredAddedBlocks,
										filteredRemovedBlocks,
										{ 
											showLoadingScreen: false, 
											silent: true,
											skipIfBusy: true
										}
									);
								}
							} else {
								// Use regular update if no camera or forced
								spatialGridManagerRef.current.updateBlocks(
										validAddedBlocks,
										validRemovedBlocks,
										{ 
											showLoadingScreen: false, 
											silent: true,
											skipIfBusy: true
										}
									);
							}
						} catch (e) {
							// Silence errors
							console.error("Error updating spatial hash:", e);
						}
					}
					
					// Reset flag - but with delay to prevent rapid sequential updates
					setTimeout(() => {
						spatialHashUpdateQueuedRef.current = false;
					}, 1000);
				}, 1000);
			}
			return;
		}
		
		// Update timestamp first to prevent overlapping calls
		spatialHashLastUpdateRef.current = now;
		
		// Skip update if camera is moving and not forced
		if (cameraMoving.current && !options.force) {
			return;
		}
		
		// Use a try/catch to handle any potential errors
		try {
			// For forced updates or large batches, use regular update
			if (options.force || validAddedBlocks.length > 1000 || validRemovedBlocks.length > 1000) {
				spatialGridManagerRef.current.updateBlocks(
					validAddedBlocks, 
					validRemovedBlocks,
					{ 
						showLoadingScreen: options.force ? true : false, 
						silent: options.force ? false : true,
						skipIfBusy: options.force ? false : true
					}
				);
				return;
			}
			
			// For smaller updates, filter to frustum
			const camera = cameraRef.current;
			
			if (camera) {
				// Update the frustum cache
				spatialGridManagerRef.current.updateFrustumCache(camera, getViewDistance());
				
				// Filter added blocks to those in frustum
				const filteredAddedBlocks = validAddedBlocks.filter(block => {
					if (!block || typeof block !== 'object') return false;
					
					// Handle different possible formats
					let x, y, z;
					if (Array.isArray(block.position)) {
						[x, y, z] = block.position;
					} else if (block.x !== undefined && block.y !== undefined && block.z !== undefined) {
						x = block.x;
						y = block.y;
						z = block.z;
					} else if (typeof block === 'string') {
						[x, y, z] = block.split(',').map(Number);
					} else {
						return false;
					}
					
					const chunkX = Math.floor(x / CHUNK_SIZE);
					const chunkY = Math.floor(y / CHUNK_SIZE);
					const chunkZ = Math.floor(z / CHUNK_SIZE);
					const chunkKey = `${chunkX},${chunkY},${chunkZ}`;
					
					return spatialGridManagerRef.current.chunksInFrustum.has(chunkKey);
				});
				
				// Filter removed blocks to those in frustum
				const filteredRemovedBlocks = validRemovedBlocks.filter(block => {
					if (!block) return false;
					
					// Handle different possible formats
					let x, y, z;
					if (typeof block === 'object' && Array.isArray(block.position)) {
						[x, y, z] = block.position;
					} else if (typeof block === 'object' && block.x !== undefined && block.y !== undefined && block.z !== undefined) {
						x = block.x;
						y = block.y;
						z = block.z;
					} else if (typeof block === 'string') {
						[x, y, z] = block.split(',').map(Number);
					} else {
						return false;
					}
					
					const chunkX = Math.floor(x / CHUNK_SIZE);
					const chunkY = Math.floor(y / CHUNK_SIZE);
					const chunkZ = Math.floor(z / CHUNK_SIZE);
					const chunkKey = `${chunkX},${chunkY},${chunkZ}`;
					
					return spatialGridManagerRef.current.chunksInFrustum.has(chunkKey);
				});
				
				console.log(`Filtered blocks for spatial hash update: ${filteredAddedBlocks.length}/${validAddedBlocks.length} added, ${filteredRemovedBlocks.length}/${validRemovedBlocks.length} removed`);
				
				// Only update if there are blocks to process
				if (filteredAddedBlocks.length > 0 || filteredRemovedBlocks.length > 0) {
					spatialGridManagerRef.current.updateBlocks(
						filteredAddedBlocks,
						filteredRemovedBlocks,
						{ 
							showLoadingScreen: false, 
							silent: true,
							skipIfBusy: true
						}
					);
				}
			} else {
				// Fallback to regular update if no camera
				spatialGridManagerRef.current.updateBlocks(
					validAddedBlocks, 
					validRemovedBlocks,
					{ 
						showLoadingScreen: options.force ? true : false, 
						silent: options.force ? false : true,
						skipIfBusy: options.force ? false : true
					}
				);
			}
		} catch (e) {
			// Silence any errors
			console.error("Error updating spatial hash:", e);
		}
	};

	// Add a new function to apply deferred spatial hash updates
	const applyDeferredSpatialHashUpdates = async () => {
		// If there are no pending updates, just return
		if (pendingSpatialHashUpdatesRef.current.added.length === 0 && 
			pendingSpatialHashUpdatesRef.current.removed.length === 0) {
			return;
		}

		console.log(`Applying deferred spatial hash updates: ${pendingSpatialHashUpdatesRef.current.added.length} added and ${pendingSpatialHashUpdatesRef.current.removed.length} removed blocks`);
		
		const added = [...pendingSpatialHashUpdatesRef.current.added];
		const removed = [...pendingSpatialHashUpdatesRef.current.removed];
		
		// Clear the pending updates first to avoid potential duplicates
		pendingSpatialHashUpdatesRef.current = { added: [], removed: [] };
		
		// Process all spatial hash updates in one go
		return updateSpatialHashForBlocks(added, removed, { force: true });
	};
	

	// Main return statement
	return (
		<>
			<OrbitControls
				ref={orbitControlsRef}
				enablePan={true}
				enableZoom={false}
				enableRotate={true}
				mouseButtons={{
					MIDDLE: THREE.MOUSE.PAN,
					RIGHT: THREE.MOUSE.ROTATE,
				}}
				onChange={handleCameraMove}
			/>

			{/* Shadow directional light */}
			<directionalLight
				ref={directionalLightRef}
				position={[10, 20, 10]}
				intensity={2}
				color={0xffffff}
				castShadow={true}
				shadow-mapSize-width={2048}
				shadow-mapSize-height={2048}
				shadow-camera-far={1000}
				shadow-camera-near={10}
				shadow-camera-left={-100}
				shadow-camera-right={100}
				shadow-camera-top={100}
				shadow-camera-bottom={-100}
				shadow-bias={0.00005}
				shadow-normalBias={0.1}
			/>

			{/* Non shadow directional light */}
			<directionalLight
				position={[10, 20, 10]}
				intensity={1}
				color={0xffffff}
				castShadow={false}
			/>

			{/* Ambient light */}
			<ambientLight intensity={0.8} />
			
			{/* mesh of invisible plane to receive shadows, and grid helper to display grid */}
			<mesh 
				ref={shadowPlaneRef} 
				position={[0.5, -0.51, 0.5]}
				rotation={[-Math.PI / 2, 0, 0]} 
				onPointerDown={handleMouseDown}
				onPointerUp={handleMouseUp}
				transparent={true}
				receiveShadow={true}
				castShadow={false}
				frustumCulled={false}>
				<planeGeometry args={[gridSize, gridSize]} />
				<meshPhongMaterial
					transparent
					opacity={0}
				/>
			</mesh>
			<gridHelper
				position={[0.5, -0.5, 0.5]}
				ref={gridRef}
			/>

			{previewPosition && (modeRef.current === "add" || modeRef.current === "remove") && (
				<group>
					{getPlacementPositions(previewPosition, placementSizeRef.current).map((pos, index) => (
						<group
							key={index}
							position={[pos.x, pos.y, pos.z]}>
							<mesh renderOrder={2}>
								<boxGeometry args={[1.02, 1.02, 1.02]} />
								<meshPhongMaterial
									color={modeRef.current === "add" ? "green" : "red"}
									opacity={0.4}
									transparent={true}
									depthWrite={false}
									depthTest={true}
									alphaTest={0.1}
								/>
							</mesh>
							<lineSegments renderOrder={3}>
								<edgesGeometry args={[new THREE.BoxGeometry(1, 1, 1)]} />
								<lineBasicMaterial
									color="darkgreen"
									linewidth={2}
								/>
							</lineSegments>
						</group>
					))}
				</group>
			)}
		</>
	);
}

// Convert to forwardRef
export default forwardRef(TerrainBuilder);

// Export block types and related functions
export { blockTypes, getCustomBlocks, processCustomBlock, getBlockTypes } from "./managers/BlockTypesManager";
// Add a method to explicitly set deferred chunk meshing mode
const setDeferredChunkMeshing = (defer) => {
	const chunkSystem = getChunkSystem();
	if (!chunkSystem) {
		console.error("Cannot set deferred chunk meshing: chunk system not available");
		return false;
	}

	console.log(`${defer ? 'Enabling' : 'Disabling'} deferred chunk meshing`);

	// If enabling, use a more conservative priority distance to ensure at least some content is visible
	// Calculate a reasonable priority distance based on view distance
	let priorityDistance = Math.min(32, getViewDistance() / 2);

	// Make sure it's not too small to prevent blank screens
	priorityDistance = Math.max(24, priorityDistance);

	// When disabling, force all chunks to be visible
	if (!defer) {
		// Force process any deferred chunks
		chunkSystem.forceUpdateChunkVisibility(false);
	}

	console.log(`Using priority distance of ${priorityDistance} blocks`);
	chunkSystem.setBulkLoadingMode(defer, priorityDistance);

	return true;
};


/**
 * Force an update for specific chunks by key
 * @param {Array<String>} chunkKeys - Array of chunk keys to update, e.g. ["32,48,0", "16,48,0"]
 * @param {Object} options - Options for the update
 * @param {Boolean} options.skipNeighbors - If true, skip neighbor chunk updates (faster but less accurate at boundaries)
 */
const forceChunkUpdate = (chunkKeys, options = {}) => {
	const chunkSystem = getChunkSystem();
	if (!chunkSystem || chunkKeys.length === 0) {
		return;
	}

	//console.log(`TerrainBuilder: Forcing update for ${chunkKeys.length} chunks${options.skipNeighbors ? ' (skipping neighbors)' : ''}`);

	// Pass the chunk keys to the chunk system for direct update
	chunkSystem.forceUpdateChunks(chunkKeys, options);
};

/**
 * Force update a chunk by its origin
 * @param {Array} chunkOrigin - Array with the chunk's origin coordinates [x, y, z]
 * @param {Object} options - Options for the update
 * @param {Boolean} options.skipNeighbors - If true, skip neighbor chunk updates for faster processing
 */
const forceChunkUpdateByOrigin = (chunkOrigin, options = {}) => {
	const chunkSystem = getChunkSystem();
	if (!chunkSystem) {
		console.warn('forceChunkUpdateByOrigin: No chunk system available');
		return;
	}

	const skipNeighbors = options.skipNeighbors === true;
	console.log(`Forcing update for chunk at [${chunkOrigin.join(',')}]${skipNeighbors ? ' (skipping neighbors)' : ''}`);

	const chunkId = `${chunkOrigin[0]},${chunkOrigin[1]},${chunkOrigin[2]}`;
	chunkSystem.forceUpdateChunks([chunkId], { skipNeighbors });
}


/**
 * Configure chunk loading behavior
 * @param {Object} options Configuration options
 * @param {boolean} options.deferMeshBuilding Whether to defer mesh building for distant chunks
 * @param {number} options.priorityDistance Distance within which chunks get immediate meshes
 * @param {number} options.deferredBuildDelay Delay in ms before building deferred chunks
 */
const configureChunkLoading = (options = {}) => {
	const chunkSystem = getChunkSystem();
	if (!chunkSystem) {
		console.warn('Cannot configure chunk loading: chunk system not available');
		return false;
	}

	// Extract options with defaults
	const deferMeshBuilding = options.deferMeshBuilding !== false;
	const priorityDistance = options.priorityDistance || Math.max(32, getViewDistance() * 0.33);
	const deferredBuildDelay = options.deferredBuildDelay || 5000;

	console.log(`Configuring chunk loading:
    - Defer mesh building: ${deferMeshBuilding}
    - Priority distance: ${priorityDistance} blocks
    - Deferred build delay: ${deferredBuildDelay}ms`);

	// Enable bulk loading mode if deferred mesh building is enabled
	if (deferMeshBuilding) {
		// Enable bulk loading mode - only chunks within priorityDistance of camera get immediate meshes
		chunkSystem.setBulkLoadingMode(true, priorityDistance);
		
		// No longer disable bulk loading mode automatically
		// This way chunks will only be built when they enter the camera view distance
		console.log(`Bulk loading mode enabled permanently - chunks will only build when within ${priorityDistance} blocks of camera`);
	} else {
		// Disable bulk loading mode if deferred mesh building is disabled
		chunkSystem.setBulkLoadingMode(false);
	}

	return true;
};

// Fix the exports to only include module-level functions
export { 
    setDeferredChunkMeshing, 
    forceChunkUpdate, 
    forceChunkUpdateByOrigin, 
    configureChunkLoading, 
    loadAllChunks 
};

// Utility function to force loading of all chunks at once
const loadAllChunks = async () => {
    console.log("Loading chunks prioritized by camera distance...");
    
    const chunkSystem = getChunkSystem();
    if (!chunkSystem) {
        console.warn("No chunk system available for loading chunks");
        return;
    }
    
    // Get scene and camera
    const scene = chunkSystem._scene;
    const camera = scene?.camera;
    
    if (!camera) {
        console.warn("No camera available for prioritizing chunks");
        return;
    }
    
    // Get camera position
    const cameraPos = camera.position;
    console.log(`Prioritizing chunks around camera at (${cameraPos.x.toFixed(1)}, ${cameraPos.y.toFixed(1)}, ${cameraPos.z.toFixed(1)})`);
    
    // Get all chunk IDs that exist in the system
    const chunkIds = Array.from(chunkSystem._chunkManager._chunks.keys());
    console.log(`Found ${chunkIds.length} chunks to process`);
    
    // Calculate distances from camera for each chunk
    const chunksWithDistances = chunkIds.map(chunkId => {
        const [x, y, z] = chunkId.split(',').map(Number);
        
        // Use the imported CHUNK_SIZE constant
        const chunkCenterX = x + CHUNK_SIZE/2;
        const chunkCenterY = y + CHUNK_SIZE/2;
        const chunkCenterZ = z + CHUNK_SIZE/2;
        
        const distance = Math.sqrt(
            Math.pow(chunkCenterX - cameraPos.x, 2) +
            Math.pow(chunkCenterY - cameraPos.y, 2) +
            Math.pow(chunkCenterZ - cameraPos.z, 2)
        );
        
        return { chunkId, distance };
    });
    
    // Sort chunks by distance to camera (closest first)
    chunksWithDistances.sort((a, b) => a.distance - b.distance);
    
    console.log(`Processing chunks in order of distance to camera`);
    
    // Process chunks in batches from closest to farthest
    const BATCH_SIZE = 20;
    let processedCount = 0;
    
    // Process all chunks in distance-sorted batches
    for (let i = 0; i < chunksWithDistances.length; i += BATCH_SIZE) {
        const batch = chunksWithDistances.slice(i, i + BATCH_SIZE);
        
        // Queue this batch for rendering with high priority
        for (const { chunkId, distance } of batch) {
            const chunk = chunkSystem._chunkManager._chunks.get(chunkId);
            if (chunk) {
                // Queue the chunk for rendering with high priority
                chunkSystem._chunkManager.queueChunkForRender(chunkId, {
                    forceMesh: true,  // Force immediate mesh building
                    priority: true    // High priority
                });
            }
        }
        
        // Process the render queue to build these chunks immediately
        chunkSystem.processRenderQueue(true); // true = prioritize by camera distance
        
        // Update the processed count
        processedCount += batch.length;
        
        // Log progress periodically
        if (i === 0 || processedCount % 100 === 0 || i + BATCH_SIZE >= chunksWithDistances.length) {
            console.log(`Processed ${processedCount}/${chunksWithDistances.length} chunks (${(processedCount/chunksWithDistances.length*100).toFixed(1)}%)`);
        }
        
        // Allow a short delay for UI updates between batches
        if (i + BATCH_SIZE < chunksWithDistances.length) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }
    
    // Final render queue processing to catch any remaining chunks
    chunkSystem.processRenderQueue(true);
    
    console.log("Finished loading all chunks prioritized by camera distance");
    return true;
};
