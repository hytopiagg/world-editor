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

import {CHUNK_SIZE, GREEDY_MESHING_ENABLED, 
		 getViewDistance, setViewDistance, MAX_SELECTION_DISTANCE,
		THRESHOLD_FOR_PLACING, CHUNK_BLOCK_CAPACITY,
        getGreedyMeshingEnabled, setGreedyMeshingEnabled } from "./constants/terrain";

// Import tools
import { ToolManager, WallTool } from "./tools";

// Import chunk utility functions
import { getChunkKey as getChunkKeyUtil, getChunkCoords, getLocalCoords, getLocalKey, isChunkVisible as isChunkVisibleUtil } from "./utils/terrain/chunkUtils";
import { SpatialGridManager } from "./managers/SpatialGridManager";
import { blockTypes, processCustomBlock, removeCustomBlock, getBlockTypes, getCustomBlocks } from "./managers/BlockTypesManager";
import BlockTextureAtlas from './blocks/BlockTextureAtlas';
import BlockTypeRegistry from './blocks/BlockTypeRegistry';


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
	const spatialHashUpdateThrottleRef = useRef(0);
	const spatialHashLastUpdateRef = useRef(0);
	const disableSpatialHashUpdatesRef = useRef(false); // Flag to completely disable spatial hash updates
	const deferSpatialHashUpdatesRef = useRef(false); // Flag to defer spatial hash updates during loading
	const pendingSpatialHashUpdatesRef = useRef({ added: [], removed: [] }); // Store deferred updates
	const scheduleSpatialHashUpdateRef = useRef(false); // Flag to schedule a spatial hash update
	const firstLoadCompletedRef = useRef(false); // Flag to track if the first load is complete
	
	// Camera ref for frustum culling
	const cameraRef = useRef(null);
	
	// Define chunk size constant for spatial calculations
	const CHUNK_SIZE = 16; // Size of each chunk in blocks
	
	// Efficient database save mechanism
	const pendingSaveRef = useRef(false);
	const lastSaveTimeRef = useRef(Date.now()); // Initialize with current time to prevent immediate save on load
	const saveThrottleTime = 2000; // Min 2 seconds between saves
	const pendingChangesRef = useRef({ added: {}, removed: {} });
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
					if (Object.keys(pendingChangesRef.current.added).length > 0 || 
						Object.keys(pendingChangesRef.current.removed).length > 0) {
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
			// If we have pending changes, save immediately and show warning
			if (Object.keys(pendingChangesRef.current.added).length > 0 || 
				Object.keys(pendingChangesRef.current.removed).length > 0) {

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
		Object.entries(added).forEach(([key, value]) => {
			pendingChangesRef.current.added[key] = value;
			// If this position was previously in the removed list, remove it
			if (pendingChangesRef.current.removed[key]) {
				delete pendingChangesRef.current.removed[key];
			}
		});
		
		Object.entries(removed).forEach(([key, value]) => {
			// If this position was previously in the added list, just remove it
			if (pendingChangesRef.current.added[key]) {
				delete pendingChangesRef.current.added[key];
			} else {
				// Otherwise track it as removed
				pendingChangesRef.current.removed[key] = value;
			}
		});
	};
	
	// Function to efficiently save terrain data
	const efficientTerrainSave = () => {
		// Skip if saving is already in progress
		if (isSaving) {
			console.log("Save already in progress, skipping new save request");
			return Promise.resolve();
		}
		
		// Skip if we just loaded the terrain or if auto-save is disabled
		if (isLoadingRef.current) {
			console.log("Skipping save during loading");
			return Promise.resolve();
		}
		
		// Skip if we're in the middle of a bulk operation
		if (isBulkLoadingRef.current) {
			console.log("Skipping save during bulk operation");
			return Promise.resolve();
		}
		
		// Skip if no changes or throttled
		const now = Date.now();
		const timeSinceLastSave = now - lastSaveTimeRef.current;
		const hasChanges = Object.keys(pendingChangesRef.current.added).length > 0 || 
						   Object.keys(pendingChangesRef.current.removed).length > 0;
		
		if (!hasChanges) {
			console.log("No changes to save");
			return Promise.resolve();
		}
		
		// Throttle saves to avoid frequent database operations
		if (timeSinceLastSave < saveThrottleTime && !isForceRef.current) {
			console.log(`Save throttled (${timeSinceLastSave}ms < ${saveThrottleTime}ms)`);
			
			// If we haven't queued a save yet, queue one
			if (!pendingSaveRef.current) {
				const delayTime = saveThrottleTime - timeSinceLastSave + 100; // Add 100ms buffer
				console.log(`Queueing save in ${delayTime}ms`);
				
				pendingSaveRef.current = true;
				setTimeout(() => {
					pendingSaveRef.current = false;
					efficientTerrainSave();
				}, delayTime);
			}
			
			return Promise.resolve();
		}
		
		// Set saving flag
		setIsSaving(true);
		console.log("Saving terrain data...");
		
		// Merge changes
		const addedBlocksCount = Object.keys(pendingChangesRef.current.added).length;
		const removedBlocksCount = Object.keys(pendingChangesRef.current.removed).length;
		
		// Update lastSaveTime immediately to prevent rapid subsequent calls
		lastSaveTimeRef.current = now;
		
		// Clear the force flag
		isForceRef.current = false;
		
		// Create a copy of the pending changes before clearing them
		const changesSnapshot = {
			added: { ...pendingChangesRef.current.added },
			removed: { ...pendingChangesRef.current.removed }
		};
		
		// Clear pending changes so new ones can be tracked while we save
		pendingChangesRef.current = { added: {}, removed: {} };
		
		// Execute the save operation
		return DatabaseManager.saveData(STORES.TERRAIN, "current", terrainRef.current)
			.then(() => {
				console.log(`Terrain saved successfully (added: ${addedBlocksCount}, removed: ${removedBlocksCount})`);
				setIsSaving(false);
				
				// Mark initial save as complete
				initialSaveCompleteRef.current = true;
				
				return { success: true, added: addedBlocksCount, removed: removedBlocksCount };
			})
			.catch((error) => {
				console.error("Error saving terrain:", error);
				
				// Restore the changes that failed to save
				for (const [key, value] of Object.entries(changesSnapshot.added)) {
					pendingChangesRef.current.added[key] = value;
				}
				
				for (const [key, value] of Object.entries(changesSnapshot.removed)) {
					pendingChangesRef.current.removed[key] = value;
				}
				
				setIsSaving(false);
				return { success: false, error: error.message };
			});
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
		
		// Log current camera state only when needed
		if (Date.now() % 5000 < 50) { // Only log every ~5 seconds
			console.log("[Debug] Camera position:", camera.position.toArray().map(v => v.toFixed(2)));
			console.log("[Debug] Camera rotation:", camera.rotation.toArray().map(v => v.toFixed(2)));
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

	// Build and update the terrain, using the new ChunkSystem
	const buildUpdateTerrain = () => {
		// Skip if terrain is empty
		if (!terrainRef.current || Object.keys(terrainRef.current).length === 0) {
			console.log("Terrain is empty, nothing to build");
			return;
		}
		
		console.time('buildUpdateTerrain');

		// Update the chunk system with terrain data
		const chunkSystem = getChunkSystem();
		if (chunkSystem) {
			console.log("Updating chunk system with terrain data...");
			// Tell the chunk system to update with terrain data
			updateTerrainChunks(terrainRef.current);
		} else {
			console.warn("Chunk system not initialized, cannot build terrain");
		}
		
		// Skip spatial hash updates if already completed, unless explicitly requested
		if (firstLoadCompletedRef.current && !scheduleSpatialHashUpdateRef.current) {
			console.log("Spatial hash already built, skipping update");
		}
		// Update the spatial hash for raycasting ONLY if this is the first load
		// or if explicitly requested via scheduleSpatialHashUpdateRef
		else if (spatialGridManagerRef.current) {
			// Only log on first load or when explicitly scheduled
			if (!firstLoadCompletedRef.current) {
				console.log("First load: Building spatial hash for raycasting...");
			} else if (scheduleSpatialHashUpdateRef.current) {
				console.log("Scheduled update: Building spatial hash for raycasting...");
				scheduleSpatialHashUpdateRef.current = false; // Reset the flag
			}
			
			// Always use the regular update for incremental changes
			spatialGridManagerRef.current.updateFromTerrain(terrainRef.current);
		}
		
		// Mark first load as completed
		firstLoadCompletedRef.current = true;
		
		console.timeEnd('buildUpdateTerrain');
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

	const handleMouseDown = (event) => {
		const startTime = performance.now();
		
		// Check if a tool is active
		const isToolActive = toolManagerRef.current && toolManagerRef.current.getActiveTool();
		
		// If a tool is active, delegate the event to it
		if (isToolActive) {
			const intersection = getRaycastIntersection();
			if (intersection) {
				toolManagerRef.current.handleMouseDown(event, intersection.point, event.button);
				// Important: Return immediately to prevent default block placement
				return;
			} else {
				// If we didn't get an intersection but a tool is active, still return
				// to prevent default block placement behavior
				//console.log('TerrainBuilder: No intersection found for tool, but tool is active');
				return;
			}
		}
		
		// Otherwise use default behavior for block placement
		if (event.button === 0) {
			// Only set isPlacingRef.current to true if no tool is active
			// (This check is redundant now, but kept for clarity)
			if (!isToolActive) {
				isPlacingRef.current = true;
				
				isFirstBlockRef.current = true;
				currentPlacingYRef.current = previewPositionRef.current.y;
				
				// Clear recently placed blocks on mouse down
				recentlyPlacedBlocksRef.current.clear();

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
			
			const endTime = performance.now();
			console.log(`Performance: handleMouseDown took ${endTime - startTime}ms`);
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
				console.log(`Performance: Block placement preparation took ${preUpdateTime - placeStartTime}ms`);
				console.log(`Added ${Object.keys(addedBlocks).length} blocks, tracked ${Object.keys(placementChangesRef.current.terrain.added).length} for undo/redo`);
				
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
				console.log(`Performance: updateTerrainBlocks took ${postUpdateTime - preUpdateTime}ms`);
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
				console.log(`Performance: Block removal preparation took ${preUpdateTime - removeStartTime}ms`);
				console.log(`Removed ${Object.keys(removedBlocks).length} blocks, tracked ${Object.keys(placementChangesRef.current.terrain.removed).length} for undo/redo`);
				
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
				console.log(`Performance: updateTerrainBlocks took ${postUpdateTime - preUpdateTime}ms`);
			}
			
			// Set flag to avoid placing at the same position again
			isFirstBlockRef.current = false;
		}
		
		const endTime = performance.now();
		console.log(`Performance: handleBlockPlacement total time ${endTime - startTime}ms`);
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
						clientY: ((1 - pointer.y) / 2) * canvasRect.height + canvasRect.top
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
				// For add mode, add a small offset in the normal direction before rounding
				tempVectorRef.current.add(blockIntersection.normal.clone().multiplyScalar(0.01));
				// Replace simple rounding with a more consistent approach for negative coordinates
				tempVectorRef.current.x = Math.sign(tempVectorRef.current.x) * Math.round(Math.abs(tempVectorRef.current.x));
				tempVectorRef.current.y = Math.sign(tempVectorRef.current.y) * Math.round(Math.abs(tempVectorRef.current.y));
				tempVectorRef.current.z = Math.sign(tempVectorRef.current.z) * Math.round(Math.abs(tempVectorRef.current.z));
				
				// Handle y-coordinate special case if this is a ground plane hit
				if (previewIsGroundPlaneRef.current && modeRef.current === "add") {
					tempVectorRef.current.y = 0; // Position at y=0 when placing on ground plane
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
	const handleMouseUp = (event) => {
		const startTime = performance.now();
		
		// If a tool is active, delegate the event to it
		if (toolManagerRef.current && toolManagerRef.current.getActiveTool()) {
			const intersection = getRaycastIntersection();
			if (intersection) {
				toolManagerRef.current.handleMouseUp(event, intersection.point);
				return; // Let the tool handle it
			}
		}
		
		// Otherwise use default behavior
		if (event.button === 0) {
			isPlacingRef.current = false;
			// Clear recently placed blocks
			recentlyPlacedBlocksRef.current.clear();

			// Check if we have any changes to save for undo
			const changes = placementChangesRef.current;
				if (
					Object.keys(changes.terrain.added).length > 0 ||
				Object.keys(changes.terrain.removed).length > 0 ||
				changes.environment.added.length > 0 ||
				changes.environment.removed.length > 0
				) {
				const undoStartTime = performance.now();
				// Save Undo with our tracked changes
					undoRedoManager.saveUndo(changes);
				const undoEndTime = performance.now();
				console.log(`Performance: Undo state saving took ${undoEndTime - undoStartTime}ms`);
				
				// REMOVED: No longer saving to database on mouse up
				// Just track the changes for when we do save
				trackTerrainChanges(changes.terrain.added, changes.terrain.removed);
				console.log(`Performance: Changes tracked for future save (${Object.keys(pendingChangesRef.current.added).length} additions, ${Object.keys(pendingChangesRef.current.removed).length} removals)`);
			}

			// Reset tracking
			placementChangesRef.current = { 
				terrain: { added: {}, removed: {} }, 
				environment: { added: [], removed: [] } 
			};

			// If axis lock was on, reset
			if (axisLockEnabled) {
				lockedAxisRef.current = null;
				placementStartPosition.current = null;
			}
		}
		
		const endTime = performance.now();
		console.log(`Performance: handleMouseUp total time ${endTime - startTime}ms`);
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
		loadingManager.showLoading('Preparing to import Minecraft world...');
		
		// Set terrain data immediately
		terrainRef.current = terrainData;
		
		// For Minecraft imports, we'll save to database immediately and not mark as unsaved
		if (terrainData) {
			console.log("Importing Minecraft map and saving to database");
			
			// First save to database
			DatabaseManager.saveData(STORES.TERRAIN, "current", terrainData)
				.then(() => {
					console.log("Minecraft imported terrain saved to database successfully");
					// Clear any pending changes to prevent unsaved changes warning
					pendingChangesRef.current = { added: {}, removed: {} };
				})
				.catch(error => {
					console.error("Error saving Minecraft imported terrain:", error);
				});
		}
		
		// Start terrain update immediately for faster response
		// The buildUpdateTerrain function doesn't return a Promise, so we can't use .then()
		buildUpdateTerrain();
		
		// Process render queue after a short delay to ensure terrain is updated
		setTimeout(() => {
			// Force a full visibility update after terrain is loaded
			processChunkRenderQueue();
			// Hide loading screen
			loadingManager.hideLoading();
		}, 1000);
	};

	// Update
	const updateGridSize = (newGridSize) => {
		if (gridRef.current) {
			// Get grid size from localStorage or use default value
			const savedGridSize = parseInt(localStorage.getItem("gridSize"), 10) || newGridSize;
			
			// Update the gridSizeRef to maintain current grid size value
			gridSizeRef.current = savedGridSize;

			if (gridRef.current.geometry) {
				gridRef.current.geometry.dispose();
				gridRef.current.geometry = new THREE.GridHelper(savedGridSize, savedGridSize, 0x5c5c5c, 0xeafaea).geometry;
				gridRef.current.material.opacity = 0.1;
				gridRef.current.position.set(0.5, -0.5, 0.5);
			}

			if (shadowPlaneRef.current.geometry) {
				shadowPlaneRef.current.geometry.dispose();
				shadowPlaneRef.current.geometry = new THREE.PlaneGeometry(savedGridSize, savedGridSize);
				shadowPlaneRef.current.position.set(0.5, -0.5, 0.5);
			}
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
	};

	// Function to initialize spatial hash once after map is loaded
	const initializeSpatialHash = (forceUpdate = false) => {
		// If already initialized and not forced, don't do it again
		if (firstLoadCompletedRef.current && !scheduleSpatialHashUpdateRef.current && !forceUpdate) {
			console.log("Spatial hash already initialized, skipping...");
			return Promise.resolve();
		}
		
		// Only call this once after initial map loading, not during regular updates
		console.log("Initializing spatial hash...");
		
		if (!spatialGridManagerRef.current) {
			console.warn("Spatial grid manager not initialized, cannot initialize spatial hash");
			return Promise.resolve();
		}
		
		// Mark as completed to prevent duplicate calls
		if (!forceUpdate) {
			firstLoadCompletedRef.current = true;
		}
		
		// Show loading screen only for this initial full build - this is an expensive operation
		return spatialGridManagerRef.current.updateFromTerrain(terrainRef.current, {
			showLoadingScreen: true,  // Show loading screen for initial build only
			batchSize: 100000,        // Use large batches for efficiency
			silent: false,            // Log progress
			message: "Building Spatial Index..."
		});
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
								updateTerrainChunks(terrainRef.current);
								
								// Hide loading screen
								loadingManager.hideLoading();
								
								// Process chunks to ensure everything is visible
								processChunkRenderQueue();
								
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
			undoRedoManager: undoRedoManager, // Pass the undoRedoManager to the tools
			placementChangesRef: placementChangesRef, // Add placement changes ref for tracking undo/redo
			isPlacingRef: isPlacingRef, // Add placing state ref
			// Add any other properties tools might need
		};
		
		toolManagerRef.current = new ToolManager(terrainBuilderProps);
		
		// Register tools
		const wallTool = new WallTool(terrainBuilderProps);
		toolManagerRef.current.registerTool("wall", wallTool);
		
		initialize();

		return () => {
			mounted = false; // Prevent state updates after unmount
		};
	}, [threeCamera, scene]);
	
	// Add effect to update tools with undoRedoManager when it becomes available - at the top level of the component
	useEffect(() => {
		if (undoRedoManager && toolManagerRef.current) {
			//console.log('TerrainBuilder: UndoRedoManager is now available, updating tools');

			// Update WallTool with the undoRedoManager
			const wallTool = toolManagerRef.current.tools["wall"];
			if (wallTool) {
			//	console.log('TerrainBuilder: Updating WallTool with undoRedoManager');
				wallTool.undoRedoManager = undoRedoManager;
			}
		}
	}, [undoRedoManager]);

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
				    (Object.keys(pendingChangesRef.current.added).length > 0 || 
				    Object.keys(pendingChangesRef.current.removed).length > 0)) {
					console.log("Auto-saving terrain...");
					efficientTerrainSave();
				}
			}, AUTO_SAVE_INTERVAL);
			
			// Save immediately if there are pending changes and not in the middle of an operation
			if (!isPlacingRef.current && 
			    (Object.keys(pendingChangesRef.current.added).length > 0 || 
			    Object.keys(pendingChangesRef.current.removed).length > 0)) {
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
					    (Object.keys(pendingChangesRef.current.added).length > 0 || 
					    Object.keys(pendingChangesRef.current.removed).length > 0)) {
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
					// Set a flag to prevent automatic spatial hash updates
					// Store the previous value to restore it later
					spatialHashUpdateQueuedRef.current = true; 
					
					// Get terrain data from database
					console.log("Retrieving blocks from database...");
					const blocks = await DatabaseManager.getData(STORES.TERRAIN, "current");
					console.log("Retrieved blocks from database:", typeof blocks, 
						blocks ? Object.keys(blocks).length : 0, 
						blocks ? "Sample:" : "No blocks found", 
						blocks && Object.keys(blocks).length > 0 ? 
							Object.entries(blocks).slice(0, 1) : "No samples");
					
					if (blocks && Object.keys(blocks).length > 0) {
						// Convert to array format
						const blocksArray = Object.entries(blocks).map(([posKey, blockId]) => {
							return { posKey, blockId };
						});
						
						// Clear current grid
						terrainRef.current = {}; 
						
						// Update loading screen with count
						const totalBlocks = blocksArray.length;
						loadingManager.updateLoading(`Loading ${totalBlocks} blocks...`, 5);
						console.log(`Loading ${totalBlocks} blocks from database`);
						
						// Process blocks directly without the complexity
						const start = performance.now();
						
						// Add all blocks to terrain - this is fast, so just do it in one go
						loadingManager.updateLoading(`Processing ${totalBlocks} blocks...`, 10);
						blocksArray.forEach(block => {
							terrainRef.current[block.posKey] = block.blockId;
							
							// Also add to pendingChanges to trigger unsaved changes warning
							pendingChangesRef.current.added[block.posKey] = block.blockId;
						});
						
						console.log("Marking refreshed terrain data as having unsaved changes");
						
						// Update loading screen for terrain building
						loadingManager.updateLoading(`Building terrain meshes...`, 20);
						
						// Disable spatial hash updates during terrain building
						const prevThrottle = spatialHashUpdateThrottleRef.current;
						spatialHashUpdateThrottleRef.current = 100000;
						
						// Build terrain - this will not rebuild spatial hash if firstLoadCompletedRef is true
						await buildUpdateTerrain();
						
						// IMPORTANT: Force a spatial hash rebuild even if it's already initialized once
						// This fixes issues with raycasting after clearing and loading new maps
						loadingManager.updateLoading(`Rebuilding spatial hash for ${totalBlocks} blocks...`, 40);
						
						// Clear the spatial hash grid
						if (spatialGridManagerRef.current) {
							spatialGridManagerRef.current.clear();
							
							// Mark as not initialized to force a rebuild
							firstLoadCompletedRef.current = false;
							
							// Use our initialization function with force=true to ensure it runs
							await initializeSpatialHash(true);
							
							// Set the flag to indicate spatial hash is built
							firstLoadCompletedRef.current = true;
						}
						
						// Reset throttle but set last update time to prevent immediate re-update
						spatialHashUpdateThrottleRef.current = prevThrottle;
						spatialHashLastUpdateRef.current = performance.now(); // Mark as just updated
						
						// Final steps
						loadingManager.updateLoading(`Finalizing terrain display...`, 90);
						
						// Update visibility
						processChunkRenderQueue();
						
						// Reset pending changes since we've loaded a fresh state from DB
						// Use a more cautious approach to avoid breaking undo/redo
						pendingChangesRef.current = { added: {}, removed: {} };
						// Don't reset placement changes here as it might interfere with ongoing operations
						
						// Save to database
						loadingManager.updateLoading(`Saving terrain data...`, 95);
						efficientTerrainSave();
						
						const end = performance.now();
						const seconds = ((end - start) / 1000).toFixed(2);
						console.log(`Terrain loaded in ${seconds} seconds (${totalBlocks} blocks)`);
						
						// Allow spatial hash updates again after a delay
						setTimeout(() => {
							spatialHashUpdateQueuedRef.current = false;
						}, 2000);
						
						loadingManager.hideLoading();
						resolve(true);
					} else {
						console.log("No blocks found in database");
						spatialHashUpdateQueuedRef.current = false;
						loadingManager.hideLoading();
						resolve(false);
					}
				} catch (error) {
					console.error("Error refreshing terrain from database:", error);
					
					// Reset flags and references to prevent stuck states
					spatialHashUpdateQueuedRef.current = false;
					isPlacingRef.current = false;
					
					// Reset placement tracking to prevent inconsistency
					placementChangesRef.current = {
						terrain: { added: {}, removed: {} },
						environment: { added: [], removed: [] }
					};
					
					// Make sure the loading screen is hidden
					loadingManager.hideLoading();
					
					resolve(false);
				}
			});
		},
		
		/**
		 * Load large terrain data incrementally to avoid UI freezes
		 * @param {Array} blocks - Array of blocks to load
		 * @returns {Promise} - Resolves when all blocks are loaded
		 */
		loadLargeTerrainIncrementally(blocks) {
			// Error handling for invalid input
			if (!blocks || !Array.isArray(blocks)) {
				console.error("Invalid blocks data passed to loadLargeTerrainIncrementally:", blocks);
				return Promise.resolve();
			}
			
			// Set loading flag to prevent saving during loading
			isLoadingRef.current = true;
			console.log("*** Setting loading flag to prevent auto-saves ***");
			
			// Show loading screen
			loadingManager.showLoading('Loading terrain blocks...');
			
			// Clear terrain if needed
			if (Object.keys(terrainRef.current).length > 0) {
				terrainRef.current = {};
			}
			
			// Save original throttle and increase it temporarily
			const prevSpatialHashUpdateThrottle = spatialHashUpdateThrottleRef.current;
			spatialHashUpdateThrottleRef.current = 100000; // Prevent automatic updates
			
			// IMPORTANT: Completely disable spatial hash updates during loading
			// This is the key change to make loading faster
			disableSpatialHashUpdatesRef.current = true;
			console.log("*** DISABLED spatial hash updates during loading for faster performance ***");
			
			// Clear any pending updates before starting
			pendingSpatialHashUpdatesRef.current = { added: [], removed: [] };
			
			// Set a global loading flag to suppress unnecessary updates
			const prevIsBulkLoading = isBulkLoadingRef.current;
			isBulkLoadingRef.current = true;
			console.log("Setting bulk loading flag to TRUE - optimizing visibility updates");
			
			// Temporarily disable chunk visibility updates during loading
			const chunkSystem = getChunkSystem();
			if (chunkSystem) {
				console.log("Temporarily disabling chunk visibility updates during loading");
				// Store the current settings to restore later
				const wasEnabled = chunkSystem._chunkManager._viewDistanceEnabled;
				chunkSystem._chunkManager._viewDistanceEnabled = false;
				
				// Enable bulk loading mode to defer distant chunk mesh creation
				const cameraPos = currentCameraRef.current?.position || new THREE.Vector3();
				console.log(`Enabling chunk system bulk loading mode with camera at ${cameraPos.x.toFixed(1)}, ${cameraPos.y.toFixed(1)}, ${cameraPos.z.toFixed(1)}`);
				
				// Calculate a good priority distance based on view distance
				const priorityDistance = Math.min(32, getViewDistance() / 2);
				chunkSystem.setBulkLoadingMode(true, priorityDistance);
				console.log(`Only chunks within ${priorityDistance} units of camera will be meshed immediately`);
			}
			
			// Use larger batch size for better performance
			const MAX_BLOCKS_PER_BATCH = 100000;
			const totalBlocks = blocks.length;
			const totalBatches = Math.ceil(totalBlocks / MAX_BLOCKS_PER_BATCH);
			
			console.log(`Loading terrain with ${totalBlocks} blocks in ${totalBatches} batches`);
			
			// Sort blocks by distance to camera before batching for faster perceived loading
			const cameraPos = currentCameraRef.current?.position || new THREE.Vector3();
			console.log("Sorting blocks by distance to camera at", cameraPos);
			
			// Clone original blocks before sorting
			const sortedBlocks = [...blocks];
			
			// Sort blocks by distance to camera
			if (currentCameraRef.current) {
				console.time("sortBlocksByDistance");
				sortedBlocks.sort((a, b) => {
					// Extract positions based on different possible formats
					const posA = getBlockPosition(a);
					const posB = getBlockPosition(b);
					
					if (!posA || !posB) return 0;
					
					// Calculate squared distances (faster than using sqrt)
					const distA = Math.pow(posA.x - cameraPos.x, 2) + 
								 Math.pow(posA.y - cameraPos.y, 2) + 
								 Math.pow(posA.z - cameraPos.z, 2);
					
					const distB = Math.pow(posB.x - cameraPos.x, 2) + 
								 Math.pow(posB.y - cameraPos.y, 2) + 
								 Math.pow(posB.z - cameraPos.z, 2);
					
					return distA - distB;
				});
				console.timeEnd("sortBlocksByDistance");
				console.log("Blocks sorted by distance to camera");
			}
			
			// Helper function to extract position from different block formats
			function getBlockPosition(block) {
				if (block.position) return block.position;
				if (block.posKey) {
					const parts = block.posKey.split(',');
					if (parts.length === 3) {
						return {
							x: parseInt(parts[0]),
							y: parseInt(parts[1]),
							z: parseInt(parts[2])
						};
					}
				}
				if (Array.isArray(block) && block.length >= 1) {
					const posKey = block[0];
					if (typeof posKey === 'string') {
						const parts = posKey.split(',');
						if (parts.length === 3) {
							return {
								x: parseInt(parts[0]),
								y: parseInt(parts[1]),
								z: parseInt(parts[2])
							};
						}
					}
				}
				return null;
			}
			
			// Function to process one batch
			const processBatch = async (startIndex, promiseResolve) => {
				try {
					const endIndex = Math.min(startIndex + MAX_BLOCKS_PER_BATCH, totalBlocks);
					const batchBlocks = sortedBlocks.slice(startIndex, endIndex);
					const currentBatch = Math.floor(startIndex / MAX_BLOCKS_PER_BATCH) + 1;
					
					// Update loading progress
					const progress = Math.floor((startIndex / totalBlocks) * 80); // Only use 80% for loading, keep 20% for finalization
					loadingManager.updateLoading(`Loading blocks: batch ${currentBatch}/${totalBatches} (${progress}%)`, progress);
					
					// Process blocks in this batch without triggering visibility updates
					batchBlocks.forEach(block => {
						try {
							// Handle different block formats
							if (block.posKey && block.blockId !== undefined) {
								terrainRef.current[block.posKey] = block.blockId;
							} else if (Array.isArray(block) && block.length >= 2) {
								terrainRef.current[block[0]] = block[1];
							} else if (typeof block === 'object' && block !== null) {
								const posKey = block.posKey || block.position || block.key || null;
								const blockId = block.blockId || block.id || block.value || null;
								
								if (posKey && blockId !== null) {
									terrainRef.current[posKey] = blockId;
								}
							}
						} catch (blockError) {
							console.error("Error processing block:", block, blockError);
						}
					});
					
					// Update visibility for chunks near camera every batch during loading
					// This helps user see progress for blocks near them
					if (currentBatch % 1 === 0 && chunkSystem) {
						chunkSystem._chunkManager.forceUpdateAllChunkVisibility(true);
					}
					
					// Update scene on final batch only to avoid redundant updates
					if (currentBatch === totalBatches) {
						loadingManager.updateLoading(`Building terrain meshes...`, 82);
						await buildUpdateTerrain();
						
						// Final steps
						loadingManager.updateLoading(`Finalizing terrain display...`, 90);
						
						// Reset bulk loading flag
						console.log("Setting bulk loading flag back to FALSE");
						isBulkLoadingRef.current = prevIsBulkLoading;
						
						// Turn off chunk system bulk loading mode to process deferred chunks
						if (chunkSystem) {
							console.log("Turning off chunk system bulk loading mode");
							chunkSystem.setBulkLoadingMode(false);
							
							console.log("Re-enabling chunk visibility updates");
							// Restore previous visibility setting
							chunkSystem._chunkManager._viewDistanceEnabled = true;
							// Now do a single visibility update with normal settings
							chunkSystem._chunkManager.forceUpdateAllChunkVisibility(false);
						}
						
						// Only now re-enable spatial hash updates, but DON'T trigger an update
						disableSpatialHashUpdatesRef.current = false;
						console.log("*** Re-enabled spatial hash updates but NOT triggering an immediate update ***");
						
						// Reset throttle to normal
						spatialHashUpdateThrottleRef.current = prevSpatialHashUpdateThrottle;
						
						// Skip auto-save after loading
						console.log("Skipping auto-save after loading");
						initialSaveCompleteRef.current = true;
						lastSaveTimeRef.current = Date.now();
						
						// Complete loading
						loadingManager.updateLoading(`Loading complete!`, 100);
						
						// Final cleanup
						loadingManager.hideLoading();
						
						// Clear loading flag now that we're done
						isLoadingRef.current = false;
						console.log("*** Cleared loading flag, auto-saves re-enabled ***");
						
						if (promiseResolve) promiseResolve();
					} else {
						// Continue with next batch
						setTimeout(async () => {
							await processBatch(endIndex, promiseResolve);
						}, 0);
					}
				} catch (batchError) {
					console.error("Error processing batch:", batchError);
					loadingManager.hideLoading();
					
					// Clear loading flag in case of error
					isLoadingRef.current = false;
					console.log("*** Cleared loading flag (error recovery) ***");
					
					// Restore loading flag even on error
					console.log("Setting bulk loading flag back to FALSE (error recovery)");
					isBulkLoadingRef.current = prevIsBulkLoading;
					
					// Re-enable spatial hash updates
					disableSpatialHashUpdatesRef.current = false;
					
					// Turn off chunk system bulk loading mode even on error
					if (chunkSystem) {
						chunkSystem.setBulkLoadingMode(false);
						chunkSystem._chunkManager._viewDistanceEnabled = true;
					}
					
					if (promiseResolve) promiseResolve();
				}
			};
			
			// Start processing
			return new Promise(resolve => {
					processBatch(0, resolve);
				});
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
	const updateTerrainBlocks = (addedBlocks, removedBlocks) => {
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
		// Safety check - ensure spatialGridManagerRef.current is initialized
		if (!threeRaycaster || !threeCamera || !spatialGridManagerRef.current) return null;
		
		// In erase mode, we need to make sure we're not hitting blocks that have been removed
		// but might still be in the spatial hash due to caching or other issues
		const currentMode = modeRef.current;
		
		// Use the SpatialGridManager's raycast method instead of implementing it here
		const result = spatialGridManagerRef.current.raycast(threeRaycaster, threeCamera, {
			maxDistance: selectionDistanceRef.current,
			prioritizeBlocks,
			gridSize: gridSizeRef.current, // Use the current grid size from ref instead of prop
			recentlyPlacedBlocks: recentlyPlacedBlocksRef.current,
			isPlacing: isPlacingRef.current,
			mode: currentMode // Pass the current mode to help with block selection
		});
		
		// If we're in erase mode and got a block intersection, double-check that the block still exists
		if (result && !result.isGroundPlane && (currentMode === "delete" || currentMode === "remove")) {
			const blockKey = `${result.block.x},${result.block.y},${result.block.z}`;
			if (!terrainRef.current[blockKey]) {
				console.log(`Block at ${blockKey} no longer exists in terrain, but was found in spatial hash`);
				// The block doesn't exist in the terrain anymore, so we should ignore this intersection
				// and try again with the block removed from the spatial hash
				spatialGridManagerRef.current.deleteBlock(blockKey);
				// Recursively call this function again to get a new intersection
				return getOptimizedRaycastIntersection(prioritizeBlocks);
			}
		}
		
		return result;
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
		// Update view distance based on camera position
		const chunkSystem = getChunkSystem();
		if (chunkSystem) {
			// No need to explicitly pause/resume - the chunk system handles this internally
			// Just update visible chunks after camera stops moving
			clearTimeout(cameraMovementTimeoutRef.current);
			cameraMovementTimeoutRef.current = setTimeout(() => {
				// Trigger a visible chunk update after camera stops moving
				requestAnimationFrame(() => {
					// Force update the camera frustum
					// Update camera frustum for raycasting
					threeCamera.updateMatrixWorld();
					const projScreenMatrix = new THREE.Matrix4();
					projScreenMatrix.multiplyMatrices(threeCamera.projectionMatrix, threeCamera.matrixWorldInverse);
					const frustum = new THREE.Frustum();
					frustum.setFromProjectionMatrix(projScreenMatrix);
					frustumRef.current = frustum;
					
					processChunkRenderQueue();
					
					// Explicitly update the chunk system with the current view distance
					chunkSystem.setViewDistance(getViewDistance());
				});
			}, 50); // 50ms delay after camera stops
		}
		
		// Request a visible chunk update immediately (but throttled for performance)
		if (!handleCameraMove.lastUpdateTime || performance.now() - handleCameraMove.lastUpdateTime > 75) {
			requestAnimationFrame(() => {
				// Mark camera as explicitly moving to handle view distance culling
				cameraMoving.current = true;
				
				// Clear any existing camera stop timeout
				if (cameraMovementTimeout?.current) {
					clearTimeout(cameraMovementTimeout.current);
				}
				
				// Set a new timeout to mark camera as stopped
				cameraMovementTimeout.current = setTimeout(() => {
					cameraMoving.current = false;
				}, 150);
				
				// Update the frustum for raycasting
				threeCamera.updateMatrixWorld();
				const projScreenMatrix = new THREE.Matrix4();
				projScreenMatrix.multiplyMatrices(threeCamera.projectionMatrix, threeCamera.matrixWorldInverse);
				const frustum = new THREE.Frustum();
				frustum.setFromProjectionMatrix(projScreenMatrix);
				frustumRef.current = frustum;
				
				processChunkRenderQueue();
				handleCameraMove.lastUpdateTime = performance.now();
			});
		}
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

// Export the deferred chunk meshing function
export { setDeferredChunkMeshing };
