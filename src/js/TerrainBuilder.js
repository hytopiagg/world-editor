import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { playPlaceSound } from "./Sound";
import { cameraManager } from "./Camera";
import { DatabaseManager, STORES } from "./DatabaseManager";
import { refreshBlockTools } from "./components/BlockToolsSidebar";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
// Replace old texture atlas and chunk imports with new ones
import BlockTextureAtlas from "./blocks/BlockTextureAtlas";
import BlockTypeRegistry from "./blocks/BlockTypeRegistry";
import { initChunkSystem, updateTerrainChunks, updateTerrainBlocks as importedUpdateTerrainBlocks, 
         processChunkRenderQueue, getChunkSystem, setChunkViewDistance, 
         setChunkViewDistanceEnabled, getBlockId, hasBlock, clearChunks, isChunkVisible,
         updateChunkSystemCamera } from "./chunks/TerrainBuilderIntegration";
import { loadingManager } from './LoadingManager';
import { PERFORMANCE_SETTINGS, TEXTURE_ATLAS_SETTINGS, getTextureAtlasSettings, 
	    meshesNeedsRefresh, toggleInstancing, getInstancingEnabled,
		setTextureAtlasSetting, toggleOcclusionCulling, getOcclusionCullingEnabled, getOcclusionThreshold, setOcclusionThreshold } from "./constants/performance";

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
// Keep the old export functions for backward compatibility but they will be redirected
import { initTextureAtlas, generateGreedyMesh, isAtlasInitialized, 
         getChunkMeshBuilder, getTextureAtlas, createChunkLoadManager, getChunkLoadManager } from "./managers/TextureAtlasManager";



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
	
	// Define geometry and material caches with proper naming
	const geometryCacheRef = useRef(new Map());
	const materialCacheRef = useRef(new Map());
	
	// Helper function to ensure render cycle completion
	const waitForRenderCycle = (callback) => {
		return new Promise(resolve => {
			requestAnimationFrame(() => {
				// Execute on next frame
				const result = callback ? callback() : null;
				resolve(result);
			});
		});
	};
	
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
	const chunksRef = useRef(new Map());
	const chunkMeshesRef = useRef({});
	const orbitControlsRef = useRef(null);
	const frustumRef = useRef(new THREE.Frustum());
	const frustumMatrixRef = useRef(new THREE.Matrix4());
	const chunkBoxCache = useRef(new Map());
	const isUpdatingChunksRef = useRef(false);
	const meshesInitializedRef = useRef(false);
	const cameraMoving = useRef(false);
	const chunkLoadManager = useRef(null);
	const chunkUpdateQueueRef = useRef([]);
	const isProcessingChunkQueueRef = useRef(false);
	const lastChunkProcessTimeRef = useRef(0);
	const useSpatialHashRef = useRef(true);
	const totalBlocksRef = useRef(0);
	const cameraMovementTimeoutRef = useRef(null);
	
	// Add visibility history tracking for reducing flickering
	const chunkVisibilityHistoryRef = useRef({});
	const visibilityHistoryFramesRef = useRef(15); // Increased from 5 to 15 for more stable visibility
	
	// Add debounce tracking for chunk visibility changes
	const chunkVisibilityChangeTimeRef = useRef({});
	const visibilityChangeDelayRef = useRef(500); // ms to wait before changing visibility state

	// For throttling visibility updates to improve performance
	const lastVisibilityUpdateTimeRef = useRef(0);
	const visibilityUpdateIntervalRef = useRef(100); // ms between full visibility updates

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



	// Special version for block placement - add this before updateTerrainBlocks
	const updateChunkSystemForBlockPlacement = () => {
		console.log("[Block Placement] Updating chunk system with camera:", 
			threeCamera?.position.toArray().map(v => v.toFixed(2)) || "null");
  
		const chunkSystem = getChunkSystem();
		if (!chunkSystem) {
			console.error("[Block Placement] Chunk system not available");
			return false;
		}
  
		// Log the camera state in chunk system before update
		console.log("[Block Placement] Camera in chunk system before:", 
			chunkSystem._scene.camera?.position?.toArray().map(v => v.toFixed(2)) || "null");
		
		// Update the camera directly
		chunkSystem._scene.camera = threeCamera;
		
		// Log the camera state in chunk system after update
		console.log("[Block Placement] Camera in chunk system after:", 
			chunkSystem._scene.camera?.position?.toArray().map(v => v.toFixed(2)) || "null");
  
		return true;
	};
	
	const placementStartState = useRef(null);
	
	// Add a new ref to track changes during placement
	const placementChangesRef = useRef({ terrain: { added: {}, removed: {} }, environment: { added: [], removed: [] } });
	const instancedMeshRef = useRef({});
	const placementStartPosition = useRef(null);
	const shadowPlaneRef = useRef();
	const directionalLightRef = useRef();
	const terrainRef = useRef({});
	const gridRef = useRef();

	// Forward declaration of initAtlas to avoid "not defined" errors
	let initAtlas;
	
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
	const normalizedMouseRef = useRef(new THREE.Vector2());
	const tempVectorRef = useRef(new THREE.Vector3());
	const tempVec2Ref = useRef(new THREE.Vector2());
	const tempVec2_2Ref = useRef(new THREE.Vector2());

	// Add Tool Manager ref
	const toolManagerRef = useRef(null);

	// Add caching for geometries and materials
	const geometryCache = useRef(new Map());
	const materialCache = useRef(new Map());

	// For batching scene changes to improve performance
	const pendingAddToSceneRef = useRef([]);
	const pendingRemoveFromSceneRef = useRef([]);
	const sceneUpdateScheduledRef = useRef(false);
	
	// Batch scene updates for improved performance
	const processPendingSceneChanges = () => {
		// Process all pending adds
		pendingAddToSceneRef.current.forEach(mesh => {
			if (mesh && scene && !scene.children.includes(mesh)) {
				try {
					scene.add(mesh);
				} catch (error) {
					console.error("Error adding mesh to scene:", error);
				}
			}
		});
		
		// Process all pending removes
		pendingRemoveFromSceneRef.current.forEach(mesh => {
			if (mesh && scene && scene.children.includes(mesh)) {
				try {
					scene.remove(mesh);
				} catch (error) {
					console.error("Error removing mesh from scene:", error);
				}
			}
		});
		
		// Clear the lists
		pendingAddToSceneRef.current = [];
		pendingRemoveFromSceneRef.current = [];
		sceneUpdateScheduledRef.current = false;
	};
	
	// Create a safe function to add a mesh to the scene (batched)
	const safeAddToScene = (mesh) => {
		if (!mesh) return;
		
		// Add to pending additions
		pendingAddToSceneRef.current.push(mesh);
		
		// Schedule update if not already scheduled
		if (!sceneUpdateScheduledRef.current) {
			sceneUpdateScheduledRef.current = true;
			requestAnimationFrame(processPendingSceneChanges);
		}
	};
	
	// Create a safe function to remove a mesh from the scene (batched)
	const safeRemoveFromScene = (mesh) => {
		if (mesh && scene) {
			scene.remove(mesh);
			
			if (mesh.geometry) {
				mesh.geometry.dispose();
			}
			
			if (mesh.material) {
				if (Array.isArray(mesh.material)) {
					mesh.material.forEach(m => m.dispose());
				} else {
					mesh.material.dispose();
				}
			}
		}
	};

	
	
	const toggleSpatialHashRayCasting = (enabled) => {
		if (enabled === undefined) {
			// Toggle if no value provided
			useSpatialHashRef.current = !useSpatialHashRef.current;
		} else {
			// Set to provided value
			useSpatialHashRef.current = enabled;
		}
		
		// Re-build spatial hash if enabling
		if (useSpatialHashRef.current) {
			updateSpatialHash();
		}
		
		console.log(`Spatial hash ray casting is now ${useSpatialHashRef.current ? 'enabled' : 'disabled'}`);
		return useSpatialHashRef.current;
	};
	
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
	// Helper function to get chunk key from coordinates
	const getChunkKey = (x, y, z) => {
		return getChunkKeyUtil(x, y, z);
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
		if (!position) return;

		// Generate the position key
		const posKey = `${position[0]},${position[1]},${position[2]}`;

		// Skip if block type is unchanged
		if (terrainRef.current[posKey] === blockId) return;

		// For removal (blockId = 0), use a different approach
		if (blockId === 0) {
			// Skip if block doesn't exist
			if (!terrainRef.current[posKey]) return;

			// Add to undo stack
			const removedBlocks = { [posKey]: terrainRef.current[posKey] };
			trackTerrainChanges({}, removedBlocks);

			// Remove from terrain
			delete terrainRef.current[posKey];
		} else {
			// Add to terrain and undo stack
			const addedBlocks = { [posKey]: blockId };
			trackTerrainChanges(addedBlocks, {});

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

		// We'll update debug info and total blocks count later in bulk
	};


	// Update the updateSpatialHash function to use getViewDistanceLocal
	const updateSpatialHash = () => {
		// Skip if disabled globally
		if (disableSpatialHashUpdatesRef.current) {
			return;
		}

		if (!spatialGridManagerRef.current) {
			return;
		}
		
		// Throttle updates to avoid performance impact
		if (spatialHashUpdateQueuedRef.current) {
			return; // Already queued for update
		}
		
		// Skip update if camera is moving to prioritize smooth movement
		if (cameraMoving.current) {
			return;
		}
		
		// Check if we're already in the middle of processing a batch
		if (spatialGridManagerRef.current.isProcessing) {
			return;
		}
		
		// Set update as queued
		spatialHashUpdateQueuedRef.current = true;
		
		// Much longer delay for updates
		setTimeout(() => {
			// Only proceed if still initialized and not currently processing
			if (spatialGridManagerRef.current && !spatialGridManagerRef.current.isProcessing) {
				// Get camera for frustum culling
				const camera = cameraRef.current;
				
				if (camera) {
					// Use frustum-based update only for blocks in view
					spatialGridManagerRef.current.updateInFrustum(terrainRef.current, camera, {
						showLoadingScreen: false,  // Never show loading screen
						batchSize: 100000,         // Use much larger batches
						silent: true,              // Suppress all logs
						skipIfBusy: true,          // Skip if already busy
						maxDistance: getViewDistanceLocal() // Use current view distance with local function
					});
				} else {
					// Fallback to regular update if no camera
					spatialGridManagerRef.current.updateFromTerrain(terrainRef.current, {
						showLoadingScreen: false,
						batchSize: 100000,
						silent: true,
						skipIfBusy: true
					});
				}
			}
			
			// Reset queue flag after a longer delay
			setTimeout(() => {
				spatialHashUpdateQueuedRef.current = false;
			}, 3000); // Allow at most one update every 3 seconds
		}, 1000); // Delay the update by 1 second
	};

	// Create an optimized greedy mesh for a chunk
	const createGreedyMeshForChunk = (chunksBlocks) => {
		// If we have an initialized chunk system, use it for greedy meshing
		const chunkSystem = getChunkSystem();
		if (chunkSystem) {
			// Note: ChunkSystem handles meshing internally
			// This is just a stub for backward compatibility
			return null;
		}

		// Fallback for backward compatibility
		return null;
	};

	// Get cached geometry for a block type
	const getCachedGeometry = (blockType) => {
		// Check if we have a cached geometry for this block type
		if (!geometryCacheRef.current.has(blockType.id)) {
			// Create and cache the geometry
			const geometry = createBlockGeometry(blockType);
			geometryCacheRef.current.set(blockType.id, geometry);
		}

		return geometryCacheRef.current.get(blockType.id);
	};

	// Get cached material for a block type
	const getCachedMaterial = (blockType) => {
		// Check if we have a cached material for this block type
		if (!materialCacheRef.current.has(blockType.id)) {
			// Create and cache the material
			const material = createBlockMaterial(blockType);
			materialCacheRef.current.set(blockType.id, material);
		}

		return materialCacheRef.current.get(blockType.id);
	};

	// Update greedy meshing setting
	const toggleGreedyMeshing = (enabled) => {
		// Update the terrain constant
		setGreedyMeshingEnabled(enabled);
		console.log(`Greedy meshing ${enabled ? 'enabled' : 'disabled'}`);

		// If we have an initialized chunk system, it will handle the meshing style
		// No need to manually rebuild the entire terrain

		// Trigger rebuild of visible chunks to apply the new meshing style
		if (getChunkSystem()) {
			// Clear current chunks and reload from terrain data
			clearChunks();
			updateTerrainChunks(terrainRef.current);
		}
	};
	// A version of rebuildChunk that doesn't update visibility (for batch processing)
	const rebuildChunkNoVisibilityUpdate = (chunkKey) => {
		try {
			// Skip if scene not ready or meshes not initialized
			if (!scene || !meshesInitializedRef.current) return;
			
			const chunksBlocks = {};
			const meshes = {};
			
			// Clean up existing chunk meshes for this specific chunk
			if (chunkMeshesRef.current[chunkKey]) {
				Object.values(chunkMeshesRef.current[chunkKey]).forEach(mesh => {
					safeRemoveFromScene(mesh);
				});
			}
			chunkMeshesRef.current[chunkKey] = {};
			
			// If chunk doesn't exist in our tracking, nothing to do
			if (!chunksRef.current.has(chunkKey)) {
				return;
			}
			
			// Try to get blocks from spatial grid manager if available
			let useOriginalImplementation = true;
			
			if (spatialGridManagerRef.current && typeof spatialGridManagerRef.current.forEachBlockInChunk === 'function') {
				const blocksInChunk = [];
				
				// Get all blocks within this chunk using the spatial grid manager
				spatialGridManagerRef.current.forEachBlockInChunk(chunkKey, (blockKey, blockData) => {
					chunksBlocks[blockKey] = blockData.type;
					blocksInChunk.push(blockKey);
				});
				
				// If blocks were found, don't fallback to original implementation
				if (blocksInChunk.length > 0) {
					useOriginalImplementation = false;
				}
			}
			
			// Fallback to original implementation if needed
			if (useOriginalImplementation) {
				// Get blocks for this chunk from chunksRef
				const chunkBlocks = chunksRef.current.get(chunkKey) || {};
				
				// Format chunk data for mesh generation
				Object.entries(chunkBlocks).forEach(([posKey, blockId]) => {
					chunksBlocks[posKey] = blockId;
				});
			}
			
			// If no blocks in this chunk, return
			if (Object.keys(chunksBlocks).length === 0) {
				return;
			}
			
			// Try to use greedy meshing first if enabled (most efficient)
			if (getGreedyMeshingEnabled()) {
				try {
					const meshes = createGreedyMeshForChunk(chunksBlocks);
					if (meshes) {
						if (!chunkMeshesRef.current[chunkKey]) {
							chunkMeshesRef.current[chunkKey] = {};
						}
						
						// Add all generated meshes
						Object.entries(meshes).forEach(([key, mesh]) => {
							mesh.userData = { chunkKey };
							mesh.frustumCulled = true;
							chunkMeshesRef.current[chunkKey][key] = mesh;
							safeAddToScene(mesh);
						});
						
						return;
					}
				} catch (error) {
					console.error("Error creating greedy mesh:", error);
				}
			}
			
			// Fall back to instanced rendering (second most efficient)
			if (getInstancingEnabled()) {
				// Group blocks by type (id)
				const blockTypesByPosition = {};
				
				// For each block, add it to the right type group
				Object.entries(chunksBlocks).forEach(([posKey, blockId]) => {
					if (!blockTypesByPosition[blockId]) {
						blockTypesByPosition[blockId] = [];
					}
					blockTypesByPosition[blockId].push(posKey);
				});
				
				// Create instance mesh for each block type
				Object.entries(blockTypesByPosition).forEach(([blockId, positions]) => {
					const blockType = getBlockTypes().find(b => b.id === parseInt(blockId));
					if (!blockType) return;
					
					// Use cached geometry and material
					const geometry = getCachedGeometry(blockType);
					const material = getCachedMaterial(blockType);
					
					// Create instanced mesh with exact capacity
					const capacity = Math.min(positions.length, CHUNK_BLOCK_CAPACITY);
					const instancedMesh = new THREE.InstancedMesh(geometry, material, capacity);
					instancedMesh.count = positions.length;
					
					// Set instance matrix for each position
					const dummy = new THREE.Object3D();
					positions.forEach((posKey, index) => {
						if (index >= capacity) return; // Skip if exceeding capacity
						
						const [x, y, z] = posKey.split(',').map(Number);
						dummy.position.set(x, y, z);
						dummy.updateMatrix();
						instancedMesh.setMatrixAt(index, dummy.matrix);
					});
					
					instancedMesh.instanceMatrix.needsUpdate = true;
					
					// Set userdata for tracking
					instancedMesh.userData = {
						chunkKey,
						blockId,
						type: 'instanced'
					};
					
					// Add to mesh tracking
					if (!chunkMeshesRef.current[chunkKey]) {
						chunkMeshesRef.current[chunkKey] = {};
					}
					
					// Add instance mesh to scene
					const key = `instanced-${blockId}`;
					chunkMeshesRef.current[chunkKey][key] = instancedMesh;
					safeAddToScene(instancedMesh);
				});
				
				return;
			}
			
			// Individual meshes as last resort
			Object.entries(chunksBlocks).forEach(([posKey, blockId]) => {
				const blockType = getBlockTypes().find(b => b.id === parseInt(blockId));
				if (!blockType) return;
				
				// Create mesh for each block (least efficient, but most compatible)
				const [x, y, z] = posKey.split(',').map(Number);
				
				const geometry = getCachedGeometry(blockType);
				const material = getCachedMaterial(blockType);
				
				const mesh = new THREE.Mesh(geometry, material);
				mesh.position.set(x, y, z);
				
				mesh.userData = {
					blockId,
					chunkKey,
					type: 'individual'
				};
				
				// Add to tracking
				if (!chunkMeshesRef.current[chunkKey]) {
					chunkMeshesRef.current[chunkKey] = {};
				}
				
				const blockKey = `block-${posKey}`;
				chunkMeshesRef.current[chunkKey][blockKey] = mesh;
				safeAddToScene(mesh);
			});
			
		} catch (error) {
			console.error("Error rebuilding chunk:", error);
		}
	};

	/// Geometry and Material Helper Functions ///
	/// Geometry and Material Helper Functions ///
	/// Geometry and Material Helper Functions ///
	/// Geometry and Material Helper Functions ///

	const createBlockGeometry = (blockType) => {
		// If blockType is a number (ID), find the actual block type object
		if (typeof blockType === 'number') {
			const blockId = blockType;
			blockType = blockTypes.find(b => b.id === parseInt(blockId));
			
			if (!blockType) {
				console.error(`Block type with ID ${blockId} not found`);
				return null;
			}
		}

		if (blockType.isEnvironment) {
			if (blockType.textureUri) {
				const texture = new THREE.TextureLoader().load(blockType.textureUri);

				// Set default aspect ratio of 1 initially
				const planeGeometry = new THREE.PlaneGeometry(1, 1);
				const plane1 = planeGeometry.clone();
				const plane2 = planeGeometry.clone();
				plane2.rotateY(Math.PI / 2);

				// Update aspect ratio when texture loads
				texture.onload = () => {
					const aspectRatio = texture.image.width / texture.image.height;
					plane1.scale(aspectRatio, 1, 1);
					plane2.scale(aspectRatio, 1, 1);
					plane1.computeBoundingSphere();
					plane2.computeBoundingSphere();
				};

				return mergeGeometries([plane1, plane2]);
			}
			return new THREE.BoxGeometry(1, 1, 1);
		}

		return new THREE.BoxGeometry(1, 1, 1);
	};

	const createBlockMaterial = (blockType) => {
		if (blockType.isCustom || blockType.id >= 100) {
			const texture = new THREE.TextureLoader().load(blockType.textureUri);
			texture.magFilter = THREE.NearestFilter;
			texture.minFilter = THREE.NearestFilter;
			texture.colorSpace = THREE.SRGBColorSpace;

			// Create material with the loaded texture
			const material = new THREE.MeshPhongMaterial({
				map: texture,
				depthWrite: true,
				depthTest: true,
				transparent: true,
				alphaTest: 0.5,
			});

			// Handle texture loading errors by replacing with error texture
			texture.onerror = () => {
				console.warn(`Error loading texture for custom block ${blockType.name}, using error texture`);
				const errorTexture = new THREE.TextureLoader().load("./assets/blocks/error.png");
				errorTexture.magFilter = THREE.NearestFilter;
				errorTexture.minFilter = THREE.NearestFilter;
				errorTexture.colorSpace = THREE.SRGBColorSpace;
				material.map = errorTexture;
				material.needsUpdate = true;
			};

			return Array(6).fill(material);
		}

		// Order of faces in THREE.js BoxGeometry: right, left, top, bottom, front, back
		const faceOrder = ['+x', '-x', '+y', '-y', '+z', '-z'];
		const materials = [];

		for (const face of faceOrder) {
			let texturePath;
			
			if (blockType.isMultiTexture && blockType.sideTextures[face]) {
				texturePath = blockType.sideTextures[face];
			} else {
				texturePath = blockType.textureUri;
			}

			const texture = new THREE.TextureLoader().load(texturePath);
			texture.magFilter = THREE.NearestFilter;
			texture.minFilter = THREE.NearestFilter;
			texture.colorSpace = THREE.SRGBColorSpace;

			materials.push(
				new THREE.MeshPhongMaterial({
					map: texture,
					color: 0xffffff,
					transparent: true,
					alphaTest: 0.5,
					opacity: texturePath.includes("water") ? 0.5 : 1,
					depthWrite: true,
					depthTest: true,
				})
			);
		}

		return materials;
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
					}
				});

				// Update terrain with new blocks
				const preUpdateTime = performance.now();
				console.log(`Performance: Block placement preparation took ${preUpdateTime - placeStartTime}ms`);
				
				importedUpdateTerrainBlocks(addedBlocks, {});
				
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
					}
				});
				
				// Update terrain with removed blocks
				const preUpdateTime = performance.now();
				console.log(`Performance: Block removal preparation took ${preUpdateTime - removeStartTime}ms`);
				
				importedUpdateTerrainBlocks({}, removedBlocks);
				
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
		buildUpdateTerrain()
			.then(() => {
				// Force a full visibility update after terrain is loaded
				updateVisibleChunks();
				
				// Clear the chunk bounding box cache to ensure proper recalculation
				chunkBoxCache.current.clear();
			})
			.catch((error) => {
				console.error('Error updating terrain:', error);
				loadingManager.hideLoading();
			});
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
		// Clear terrain object
				terrainRef.current = {};
				totalBlocksRef.current = 0;
		
		// Send total blocks count to parent component
		if (sendTotalBlocks) {
			sendTotalBlocks(0);
		}
		
		// Clear all chunks from the system
		clearChunks();
		
		// Clear spatial grid for raycasting
		if (spatialGridManagerRef.current) {
			spatialGridManagerRef.current.clear();
		}
		
		// Reset pending changes
		pendingChangesRef.current = { added: {}, removed: {} };
		
		// Update debug info
		updateDebugInfo();
		
		// Save empty terrain to database
		efficientTerrainSave();
	};

	// Function to initialize spatial hash once after map is loaded
	const initializeSpatialHash = () => {
		// If already initialized, don't do it again
		if (firstLoadCompletedRef.current && !scheduleSpatialHashUpdateRef.current) {
			console.log("Spatial hash already initialized, skipping...");
			return Promise.resolve();
		}
		
		// Only call this once after initial map loading, not during regular updates
		console.log("Initializing spatial hash (one-time operation)...");
		
		if (!spatialGridManagerRef.current) {
			console.warn("Spatial grid manager not initialized, cannot initialize spatial hash");
			return Promise.resolve();
		}
		
		// Mark as completed to prevent duplicate calls
		firstLoadCompletedRef.current = true;
		
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
						// This was causing the unnecessary beforeunload warnings
						// pendingChangesRef.current.added = {};
						// Instead, just make sure we have an empty pending changes object
						pendingChangesRef.current = { added: {}, removed: {} };
						console.log("Loaded terrain marked as saved - no unsaved changes");
						
						// Update the chunk system with the loaded terrain
						updateTerrainChunks(terrainRef.current);
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
		
		// Remove the incorrect useEffect from here
		
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
		toggleOcclusionCulling: toggleOcclusionCullingLocal,
		setOcclusionThreshold: setOcclusionThresholdLocal,
		saveTerrainManually, // Add manual save function
		updateTerrainBlocks, // Expose for selective updates in undo/redo
		updateTerrainForUndoRedo, // Optimized version specifically for undo/redo operations
		fastUpdateBlock, // Ultra-optimized function for drag operations
		updateDebugInfo, // Expose debug info updates for tools
		
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
		
		// Test function to manually refresh chunk culling
		refreshChunkCulling: () => {
			console.log(`[refreshChunkCulling] Current view distance: ${getViewDistance()}`);
			
			// Always do a full refresh for the manual refresh button
			console.log("[refreshChunkCulling] Forcing complete chunk refresh");
			forceRefreshAllChunks();
			
			return true;
		},
		
		// Methods for view distance handling
		setViewDistance: (distance) => {
			console.log(`Setting view distance to ${distance} from component ref`);
			
			// Call the module-level function to update the distance value
			updateViewDistance(distance);
			
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
		
		toggleViewDistanceCulling: (enabled) => {
			console.log(`${enabled ? 'Enabling' : 'Disabling'} view distance culling from component ref`);
			toggleViewDistanceCulling(enabled);
			return true;
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
						
						// Check if we need to update the spatial hash
						if (!firstLoadCompletedRef.current && spatialGridManagerRef.current) {
							// Now for the slow part - spatial hash update
							// We'll use a more optimized approach with larger batches
							loadingManager.updateLoading(`Preparing spatial hash update for ${totalBlocks} blocks...`, 40);
							
							// Clear the spatial hash grid
							spatialGridManagerRef.current.clear();
							
							// Use our initialization function instead of manual batching
							await initializeSpatialHash();
							
							// Set the flag to indicate spatial hash is built
							firstLoadCompletedRef.current = true;
							
							// Disable all future spatial hash updates - it's only needed once at load time
							disableSpatialHashUpdatesRef.current = true;
							console.log("Spatial hash updates disabled - only needed once on load");
						} else {
							console.log("Skipping spatial hash update - already initialized");
						}
						
						// Reset throttle but set last update time to prevent immediate re-update
						spatialHashUpdateThrottleRef.current = prevThrottle;
						spatialHashLastUpdateRef.current = performance.now(); // Mark as just updated
						
						// Final steps
						loadingManager.updateLoading(`Finalizing terrain display...`, 90);
						
						// Update visibility
						updateVisibleChunks();
						
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
						
						// Apply a temporary boost to chunk loading speed
						const tempBoostChunkLoading = () => {
							console.log("Applying temporary boost to chunk loading speed");
							
							// Store original values
							const originalMaxConcurrent = TEXTURE_ATLAS_SETTINGS.maxConcurrentChunkRebuilds;
							const originalTimePerFrame = 20; // From processChunkQueue
							
							// Apply boosted values (even higher than our optimized settings)
							TEXTURE_ATLAS_SETTINGS.maxConcurrentChunkRebuilds = 12;
							if (chunkLoadManager.current) {
								chunkLoadManager.current.maxConcurrentLoads = 12;
								chunkLoadManager.current.processingTimeLimit = 30;
							}
							
							// Reset after 10 seconds
							setTimeout(() => {
								console.log("Reverting chunk loading speed to normal settings");
								TEXTURE_ATLAS_SETTINGS.maxConcurrentChunkRebuilds = originalMaxConcurrent;
								if (chunkLoadManager.current) {
									chunkLoadManager.current.maxConcurrentLoads = originalMaxConcurrent;
									chunkLoadManager.current.processingTimeLimit = 25;
								}
							}, 10000);
						};
						
						// Apply the temporary boost
						tempBoostChunkLoading();
						
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
			
			// Flag to prevent duplicate update attempts
			isUpdatingChunksRef.current = true;
			
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
						isUpdatingChunksRef.current = false;
						
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
					isUpdatingChunksRef.current = false;
					
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
		
		console.timeEnd(`updateTerrainForUndoRedo-${source}`);
	};

	// Function to rebuild a single chunk
	const rebuildChunk = (() => {
		// Add a queue for chunk rebuilds to prevent rebuilding too many chunks at once
		const chunkRebuildQueue = [];
		let isProcessingChunkRebuildQueue = false;
		
		// Track chunks being updated to prevent visual flickering
		const chunksBeingUpdated = new Set();
		
		// Process chunks in the rebuild queue one at a time to prevent lag
		const processChunkRebuildQueue = () => {
			const startTime = performance.now();
			
			if (chunkRebuildQueue.length === 0) {
				isProcessingChunkRebuildQueue = false;
				return;
			}
			
			isProcessingChunkRebuildQueue = true;
			
			// Process one chunk per frame to reduce lag
			const { chunkKey } = chunkRebuildQueue.shift();
			
			// Skip if this chunk is already being updated
			if (chunksBeingUpdated.has(chunkKey)) {
				console.log(`Skipping chunk ${chunkKey} as it's already being updated`);
				
				// Continue with the next chunk on the next frame
				requestAnimationFrame(processChunkRebuildQueue);
				return;
			}
			
			// Mark this chunk as being updated
			chunksBeingUpdated.add(chunkKey);
			
			const processStartTime = performance.now();
			
			// Create a wrapper function to handle chunk rebuilding with sync to render cycle
			const rebuildWithRenderSync = () => {
				// Perform the rebuild
				rebuildChunkImpl(chunkKey);
				
				// Mark chunk as completed (on next frame to ensure renderer has completed a cycle)
				waitForRenderCycle(() => {
					// Now that a full render cycle has completed, we can remove this chunk from the being-updated set
					chunksBeingUpdated.delete(chunkKey);
					
					const processEndTime = performance.now();
					console.log(`Performance: Processing chunk ${chunkKey} took ${processEndTime - processStartTime}ms`);
					
					// Schedule next chunk processing after a brief delay to allow frame to complete
					setTimeout(() => {
						processChunkRebuildQueue();
					}, 10); // Small delay to improve visual quality
				});
			};
			
			// Use waitForRenderCycle to sync with render cycle
			waitForRenderCycle(rebuildWithRenderSync);
			
			const endTime = performance.now();
			console.log(`Performance: processChunkRebuildQueue scheduling total time ${endTime - startTime}ms, queue length: ${chunkRebuildQueue.length}`);
		};
		
		// Actual implementation of chunk rebuilding
		const rebuildChunkImpl = (chunkKey) => {
		// Skip if scene not ready
		if (!scene || !meshesInitializedRef.current) return;
		
			const startTime = performance.now();
		try {
			// Instead of removing old meshes immediately, keep them until new ones are ready
			// We'll store old meshes and only remove them after new ones are built
			const oldChunkMeshes = chunkMeshesRef.current[chunkKey] ? {...chunkMeshesRef.current[chunkKey]} : {};
			
			// Create a new mesh container for this chunk
			const newChunkMeshes = {};
			
			// Get blocks for this chunk
				const dataPreparationStart = performance.now();
			const chunksBlocks = {};
			// Use chunksRef which tracks blocks by chunk
			const blockRefsData = chunksRef.current.get(chunkKey) || {};
			
			// Convert chunk data to the format expected by mesh builders
			Object.entries(blockRefsData).forEach(([posKey, blockId]) => {
				chunksBlocks[posKey] = blockId;
			});
			
			// If no blocks in this chunk, remove old meshes and we're done
			if (Object.keys(chunksBlocks).length === 0) {
				// Now it's safe to remove the old meshes
				// First set the color to transparent to fade out
				Object.values(oldChunkMeshes).forEach(mesh => {
					if (Array.isArray(mesh)) {
						mesh.forEach(m => {
							if (m.material) {
								if (Array.isArray(m.material)) {
									m.material.forEach(mat => {
										if (mat.opacity !== undefined) {
											mat.transparent = true;
											mat.needsUpdate = true;
										}
									});
								} else if (m.material.opacity !== undefined) {
									m.material.transparent = true;
									m.material.needsUpdate = true;
								}
							}
							safeRemoveFromScene(m);
						});
					} else {
						if (mesh.material) {
							if (Array.isArray(mesh.material)) {
								mesh.material.forEach(mat => {
									if (mat.opacity !== undefined) {
										mat.transparent = true;
										mat.needsUpdate = true;
									}
								});
							} else if (mesh.material.opacity !== undefined) {
								mesh.material.transparent = true;
								mesh.material.needsUpdate = true;
							}
						}
						safeRemoveFromScene(mesh);
					}
				});
				
				chunkMeshesRef.current[chunkKey] = {};
				return;
			}
				const dataPreparationEnd = performance.now();
				console.log(`Performance: Chunk data preparation took ${dataPreparationEnd - dataPreparationStart}ms`);
			
			// Try to use greedy meshing first if enabled (most efficient)
				const meshingStart = performance.now();
			if (GREEDY_MESHING_ENABLED) {
				try {
					const meshes = createGreedyMeshForChunk(chunksBlocks);
					if (meshes) {
						// Add all generated meshes to our new container
						Object.entries(meshes).forEach(([key, mesh]) => {
						mesh.userData = { chunkKey };
							mesh.frustumCulled = true;
							newChunkMeshes[key] = mesh;
							
							// Set initial properties to match any old mesh for smooth transition
							if (oldChunkMeshes[key]) {
								mesh.visible = true;
							}
							
						safeAddToScene(mesh);
					});
						
						// Wait for a complete render cycle before removing old meshes
						// Use a microtask to ensure it happens soon but after this render cycle
						
						waitForRenderCycle(() => {
							// Now that new meshes are added, remove the old ones
							Object.values(oldChunkMeshes).forEach(mesh => {
								safeRemoveFromScene(mesh);
							});
							
							// Update the reference with our new meshes
							chunkMeshesRef.current[chunkKey] = newChunkMeshes;
						});
						
						const meshingEnd = performance.now();
						console.log(`Performance: Greedy meshing took ${meshingEnd - meshingStart}ms`);
					return;
				}
				} catch (error) {
					console.error("Error creating greedy mesh:", error);
				}
			}
			
			// Fall back to instanced rendering (second most efficient)
			if (PERFORMANCE_SETTINGS.instancingEnabled) {
				// Group blocks by type
				const blockTypeMapping = {};
				Object.entries(chunksBlocks).forEach(([posKey, blockId]) => {
					if (!blockTypeMapping[blockId]) {
						blockTypeMapping[blockId] = [];
					}
					blockTypeMapping[blockId].push(posKey);
				});
				
				// Create instance mesh for each block type
				Object.entries(blockTypeMapping).forEach(([blockId, positions]) => {
					// Use the imported blockTypes array (global) instead of using blockTypeMapping as an array
					const blockType = blockTypes.find(b => b.id === parseInt(blockId));
					if (!blockType) return;
					
					// Use cached geometry and material
					const geometry = getCachedGeometry(blockType);
					const material = getCachedMaterial(blockType);
					
					// Create instanced mesh with exact capacity
					const capacity = Math.min(positions.length, CHUNK_BLOCK_CAPACITY);
					const instancedMesh = new THREE.InstancedMesh(
						geometry,
						material,
						capacity
					);
					instancedMesh.count = positions.length;
					
					// Set instance matrix for each position
					const dummy = new THREE.Object3D();
					positions.forEach((posKey, index) => {
						if (index >= capacity) return; // Skip if exceeding capacity
						
						const [x, y, z] = posKey.split(',').map(Number);
						dummy.position.set(x, y, z);
						dummy.updateMatrix();
						instancedMesh.setMatrixAt(index, dummy.matrix);
					});
					
					instancedMesh.instanceMatrix.needsUpdate = true;
					
					// Set userdata for tracking
					instancedMesh.userData = {
						chunkKey,
						blockId,
						type: 'instanced'
					};
					
					// Add instance mesh to our new container
					const key = `instanced-${blockId}`;
					newChunkMeshes[key] = instancedMesh;
					safeAddToScene(instancedMesh);
				});
				
				// Wait for a frame before removing old meshes - improves visualization
				waitForRenderCycle(() => {
					// Now that all new meshes are in place, remove old ones
					Object.values(oldChunkMeshes).forEach(mesh => {
						safeRemoveFromScene(mesh);
					});
					
					// Update the reference with our new meshes
					chunkMeshesRef.current[chunkKey] = newChunkMeshes;
				});
			} else {
				// Individual meshes as last resort
				Object.entries(chunksBlocks).forEach(([posKey, blockId]) => {
					const blockType = blockTypes.find(b => b.id === parseInt(blockId));
					if (!blockType) return;
					
					const geometry = getCachedGeometry(blockType);
					const material = getCachedMaterial(blockType);
					
					const mesh = new THREE.Mesh(geometry, material);
					const [x, y, z] = posKey.split(',').map(Number);
					mesh.position.set(x, y, z);
					
					mesh.userData = { blockId: blockType.id, chunkKey, blockPos: posKey };
					mesh.frustumCulled = true;
					
					// Add to our new container
					if (!newChunkMeshes[blockId]) {
						newChunkMeshes[blockId] = [];
					}
					if (Array.isArray(newChunkMeshes[blockId])) {
						newChunkMeshes[blockId].push(mesh);
					} else {
						newChunkMeshes[blockId] = [mesh];
					}
					safeAddToScene(mesh);
				});
				
				// Wait for a frame before removing old meshes
				waitForRenderCycle(() => {
					// Now that all new meshes are in place, remove old ones
					Object.values(oldChunkMeshes).forEach(mesh => {
						safeRemoveFromScene(mesh);
					});
					
					// Update the reference with our new meshes
					chunkMeshesRef.current[chunkKey] = newChunkMeshes;
				});
			}
				const meshingEnd = performance.now();
				console.log(`Performance: Fallback meshing took ${meshingEnd - meshingStart}ms`);
		} catch (error) {
				console.error("Error rebuilding chunk:", error, chunkKey);
			}
			const endTime = performance.now();
			console.log(`Performance: rebuildChunkImpl total time ${endTime - startTime}ms for chunk ${chunkKey}`);
		};
		
		// Return the function that queues chunks for rebuilding
		return (chunkKey) => {
			// Don't queue the same chunk multiple times
			if (chunkRebuildQueue.some(item => item.chunkKey === chunkKey)) {
				return;
			}
			
			// Calculate priority based on distance to camera
			const [cx, cy, cz] = chunkKey.split(',').map(Number);
			const chunkCenter = new THREE.Vector3(
				cx * CHUNK_SIZE + CHUNK_SIZE / 2,
				cy * CHUNK_SIZE + CHUNK_SIZE / 2,
				cz * CHUNK_SIZE + CHUNK_SIZE / 2
			);
			
			// Closer chunks get higher priority
			const distanceToCamera = threeCamera.position.distanceTo(chunkCenter);
			const priority = 1000 - distanceToCamera; // Higher number = higher priority
			
			// Add to the queue with priority
			chunkRebuildQueue.push({ chunkKey, priority });
			
			// Sort queue by priority (higher priority first)
			chunkRebuildQueue.sort((a, b) => b.priority - a.priority);
			
			// Start processing the queue if not already processing
			if (!isProcessingChunkRebuildQueue) {
				processChunkRebuildQueue();
			}
		};
	})();

	// Cleanup on unmount or when dependencies change
	useEffect(() => {
		return () => {
			// Clean up chunk meshes
			if (chunkMeshesRef.current && scene) {
				Object.entries(chunkMeshesRef.current).forEach(([chunkKey, blockMeshes]) => {
					Object.values(blockMeshes).forEach(mesh => {
						safeRemoveFromScene(mesh);
					});
				});
				chunkMeshesRef.current = {};
			}
		};
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [scene]); // safeRemoveFromScene is used but declared later

	// Function to update which chunks are visible based on camera position and frustum
	const updateVisibleChunks = () => {
		// Skip if we don't have necessary components
		if (!scene || !threeCamera) {
			return;
		}
		
		// Simply update the camera and frustum for raycasting
		threeCamera.updateMatrixWorld();
		const projScreenMatrix = new THREE.Matrix4();
		projScreenMatrix.multiplyMatrices(threeCamera.projectionMatrix, threeCamera.matrixWorldInverse);
		const frustum = new THREE.Frustum();
		frustum.setFromProjectionMatrix(projScreenMatrix);
		frustumRef.current = frustum;
		
		// Let the chunk system handle visibility entirely - it's more efficient
		// Just make sure it gets processed
		processChunkRenderQueue();
	};

	// Update spatial hash in chunks to avoid blocking the main thread
	const updateSpatialHashChunked = () => {
		// Skip if disabled globally
		if (disableSpatialHashUpdatesRef.current) {
				return;
			}
			
		// Skip if not initialized
		if (!spatialGridManagerRef.current) {
			return;
		}
		
		// VERY aggressive throttling to prevent performance issues
		const now = performance.now();
		if (now - spatialHashLastUpdateRef.current < 2000) { // Limit to once every 2 seconds
			return;
		}
		
		// Skip update if camera is moving to prioritize smooth movement
		if (cameraMoving.current) {
			return;
		}
		
		// Only update if we actually have a significant number of blocks
		const blockCount = Object.keys(terrainRef.current).length;
		if (blockCount < 100) {
			// For small scenes, update more often
			if (now - spatialHashLastUpdateRef.current < 1000) {
			return;
		}
		}
		
		// Update timestamp before the operation to prevent any overlapping calls
		spatialHashLastUpdateRef.current = now;
		
		// Don't show loading screen, use larger batches to reduce updates
		return spatialGridManagerRef.current.updateFromTerrain(terrainRef.current, {
			showLoadingScreen: false,  // Never show loading screen for routine updates
			batchSize: 100000,         // Use much larger batches to reduce update frequency
			silent: true,              // Suppress all console logs
			skipIfBusy: true           // Skip update if another one is in progress
		});
	};

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

	
	// Add texture atlas initialization effect
	useEffect(() => {
		// Skip texture atlas initialization if disabled
		if (!TEXTURE_ATLAS_SETTINGS.useTextureAtlas) {
			console.log("Texture atlas disabled in settings");
			return;
		}
		
		// Initialize texture atlas
		initAtlas = async () => {
			console.log("Initializing with new BlockTextureAtlas and ChunkSystem");
			
			// Don't initialize if already initialized
			if (isAtlasInitialized()) {
				console.log("Texture atlas already initialized");
				return;
			}
			
			try {
				// The new ChunkSystem automatically initializes BlockTextureAtlas
				if (scene) {
					await initChunkSystem(scene, {
						viewDistance: getViewDistance(),
						viewDistanceEnabled: true
					});
					console.log("ChunkSystem and BlockTextureAtlas initialized successfully");
					
					// Set initial camera reference in chunk system
					const chunkSystem = getChunkSystem();
					if (chunkSystem && threeCamera) {
						console.log("[Initialization] Setting initial camera reference in chunk system");
						chunkSystem._scene.camera = threeCamera;
						currentCameraRef.current = threeCamera;
						console.log("[Initialization] Camera position:", 
							threeCamera.position.toArray().map(v => v.toFixed(2)));
						
						// Update once to apply the camera
						updateChunkSystemWithCamera();
					} else {
						console.error("[Initialization] Failed to set initial camera reference");
					}
				} else {
					console.error("Scene not available for ChunkSystem initialization");
				}
			} catch (error) {
				console.error("Error initializing ChunkSystem:", error);
			}
		};
		
		// Call initialization
		initAtlas();
		
		// Cleanup function
		return () => {
			// Clear any pending operations if component unmounts
			if (chunkLoadManager.current) {
				chunkLoadManager.current.clearQueue();
			}
		};
	}, [blockTypes]); // Re-run if block types change


	
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
						updateVisibleChunks();
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
						updateVisibleChunks();
						chunkUpdateThrottle.current = 0;
					}
					
					// Skip spatial hash updates completely during camera movement
				} else if (frameCount % 5 === 0) { // Reduced from 10 to 5 for more frequent updates when camera is still
					// Normal updates when camera is still, but less frequent
					updateVisibleChunks();
					
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

	
	// Helper function to check if a chunk is visible in the frustum
	const isChunkVisible = (chunkKey, camera, frustum) => {
	  // Get view distance for visibility check
	  const viewDistance = getViewDistance();
	  
	  // Use the imported function, passing the necessary parameters
	  return isChunkVisibleUtil(chunkKey, camera, frustum, viewDistance);
	};

	// Add these getter/setter functions

	// Add this function to manage the chunk update queue
	const addChunkToUpdateQueue = (chunkKey, priority = 0) => {
		// Don't add duplicates
		if (chunkUpdateQueueRef.current.some(item => item.chunkKey === chunkKey)) {
			// If it's already in the queue with lower priority, update the priority
			const existingItem = chunkUpdateQueueRef.current.find(item => item.chunkKey === chunkKey);
			if (existingItem && priority > existingItem.priority) {
				existingItem.priority = priority;
				// Re-sort the queue based on updated priorities
				chunkUpdateQueueRef.current.sort((a, b) => b.priority - a.priority);
			}
			return;
		}
		
		// Add to queue with priority
		chunkUpdateQueueRef.current.push({
			chunkKey,
			priority,
			addedTime: performance.now()
		});
		
		// Sort by priority (higher first)
		chunkUpdateQueueRef.current.sort((a, b) => b.priority - a.priority);
		
		// Start processing the queue if it's not already running
		if (!isProcessingChunkQueueRef.current) {
			processChunkQueue();
		}
	};

	// Function to process chunks from the queue with frame timing
	const processChunkQueue = () => {
		// Use the new chunk system's process function
		processChunkRenderQueue();
	};

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
					updateVisibleChunks();
					
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
				
				// Update the frustum and visible chunks
				updateVisibleChunks();
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

	// Effect to initialize and maintain visibility tracking
	useEffect(() => {
		// Initialize visibility history if needed
		if (!chunkVisibilityHistoryRef.current.frames) {
			chunkVisibilityHistoryRef.current = {
				frames: [],
				currentFrameIndex: 0
			};
			
			for (let i = 0; i < visibilityHistoryFramesRef.current; i++) {
				chunkVisibilityHistoryRef.current.frames.push(new Set());
			}
		}
		
		// Handle cleanup
		return () => {
			// Clear visibility history when component unmounts
			if (chunkVisibilityHistoryRef.current.frames) {
				chunkVisibilityHistoryRef.current.frames.forEach(frame => frame.clear());
			}
			
			// Clear debounce timers
			chunkVisibilityChangeTimeRef.current = {};
		};
	}, []);

	// Add a ref for the chunk solidity cache
	const chunkSolidityCacheRef = useRef(new Map());
	
	// Use the performance settings for occlusion culling
	const occlusionCullingEnabledRef = useRef(getOcclusionCullingEnabled());
	
	// Update the toggleOcclusionCulling function to use the performance settings
	const toggleOcclusionCullingLocal = (enabled) => {
		// Just update the global setting - ChunkSystem handles culling now
		toggleOcclusionCulling(enabled);
		// No need for custom occlusion culling implementation
	};

	// Add a method to set the occlusion threshold
	const setOcclusionThresholdLocal = (threshold) => {
		// Just update the global setting - ChunkSystem handles culling now
		setOcclusionThreshold(threshold);
		// No need for custom occlusion culling implementation
	};

	// Add a cache for chunk adjacency information
	const chunkAdjacencyCache = new Map();
	
	// Helper function to check if a chunk is adjacent to any verified visible chunk
	const isAdjacentToVisibleChunk = (chunkKey, verifiedVisibleChunks) => {
		// Check if we have cached result
		if (chunkAdjacencyCache.has(chunkKey)) {
			const cachedAdjacentChunks = chunkAdjacencyCache.get(chunkKey);
			// Check if any of the cached adjacent chunks are in the verified visible set
			for (const adjacentChunk of cachedAdjacentChunks) {
				if (verifiedVisibleChunks.has(adjacentChunk)) {
					return true;
				}
			}
			return false;
		}
		
		// Parse chunk coordinates
		const [cx, cy, cz] = chunkKey.split(',').map(Number);
		
		// Store adjacent chunks for caching
		const adjacentChunks = [];
		
		// First check the 6 face-adjacent neighbors (more likely to be visible)
		const faceAdjacentOffsets = [
			[1, 0, 0], [-1, 0, 0],  // X axis
			[0, 1, 0], [0, -1, 0],  // Y axis
			[0, 0, 1], [0, 0, -1]   // Z axis
		];
		
		for (const [dx, dy, dz] of faceAdjacentOffsets) {
			const adjacentChunkKey = `${cx + dx},${cy + dy},${cz + dz}`;
			adjacentChunks.push(adjacentChunkKey);
			
			if (verifiedVisibleChunks.has(adjacentChunkKey)) {
				// Cache the result before returning
				chunkAdjacencyCache.set(chunkKey, adjacentChunks);
				return true;
			}
		}
		
		// If no face-adjacent chunks are visible, check the 20 diagonal neighbors
		// 8 corner diagonals
		for (let dx = -1; dx <= 1; dx += 2) {
			for (let dy = -1; dy <= 1; dy += 2) {
				for (let dz = -1; dz <= 1; dz += 2) {
					const adjacentChunkKey = `${cx + dx},${cy + dy},${cz + dz}`;
					adjacentChunks.push(adjacentChunkKey);
					
					if (verifiedVisibleChunks.has(adjacentChunkKey)) {
						// Cache the result before returning
						chunkAdjacencyCache.set(chunkKey, adjacentChunks);
						return true;
					}
				}
			}
		}
		
		// 12 edge diagonals
		const edgeDiagonalOffsets = [
			// X-Y plane edges
			[1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0],
			// X-Z plane edges
			[1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
			// Y-Z plane edges
			[0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1]
		];
		
		for (const [dx, dy, dz] of edgeDiagonalOffsets) {
			const adjacentChunkKey = `${cx + dx},${cy + dy},${cz + dz}`;
			adjacentChunks.push(adjacentChunkKey);
			
			if (verifiedVisibleChunks.has(adjacentChunkKey)) {
				// Cache the result before returning
				chunkAdjacencyCache.set(chunkKey, adjacentChunks);
				return true;
			}
		}
		
		// Cache the result before returning
		chunkAdjacencyCache.set(chunkKey, adjacentChunks);
		return false;
	};
	
	// Function to update which chunks are visible based on camera position and frustum
	// Delete the old updateVisibleChunks function and keep only this optimized version
	// ... existing code ...

	
	

	

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

// Re-export functions from the BlockTypesManager for backward compatibility
export { blockTypes, processCustomBlock, removeCustomBlock, getBlockTypes, getCustomBlocks };

// Define view distance functions at module level
const updateViewDistance = (distance) => {
  console.log(`Updating view distance to ${distance} blocks`);
  
  // Update the terrain constant
  setViewDistance(distance);
  
  // Just update the chunk system's view distance since we don't have access to camera here
  setChunkViewDistance(distance);
  
  // Note: Camera-dependent refresh will happen through the component-level methods
};

// Toggle view distance culling at module level
const toggleViewDistanceCulling = (enabled) => {
  // Update the chunk system's view distance culling
  setChunkViewDistanceEnabled(enabled);
};

// Module-level function for forcing chunk culling update
// Camera must be provided by the caller
const forceChunkCullingUpdate = (viewDistance, camera) => {
  console.log("Force updating chunk culling...");
  
  if (!camera) {
    console.error("No camera available for culling update");
    return false;
  }
  
  const chunkSystem = getChunkSystem();
  if (!chunkSystem) {
    console.error("Chunk system not available");
    return false;
  }
  
  // Step 1: Update the camera in the chunk system
  console.log("Updating camera in chunk system:", camera.position);
  updateChunkSystemCamera(camera);
  
  // Step 2: Make sure view distance is set correctly
  chunkSystem.setViewDistance(viewDistance);
  console.log(`Ensured view distance is set to ${viewDistance}`);
  
  // Step 3: Make sure view distance culling is enabled
  chunkSystem.setViewDistanceEnabled(true);
  console.log("Ensured view distance culling is enabled");
  
  // Step 4: Process the render queue to update visibility
  chunkSystem.processRenderQueue();
  console.log("Processed render queue to update chunk visibility");
  
  return true;
};

// Re-export functions from the TextureAtlasManager for backward compatibility
export { initTextureAtlas, generateGreedyMesh, isAtlasInitialized, getChunkMeshBuilder, getTextureAtlas, createChunkLoadManager, getChunkLoadManager, updateViewDistance, toggleViewDistanceCulling, forceChunkCullingUpdate };

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

// Add these functions somewhere before they are first used (around line 2300)
