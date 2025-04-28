import { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { playPlaceSound } from "./Sound";
import {
    MAX_SELECTION_DISTANCE,
    THRESHOLD_FOR_PLACING,
} from "./constants/terrain";
import { getOptimizedRaycastIntersection } from "./TerrainChunkManager"; // Assuming this will be moved
import { importedUpdateTerrainBlocks } from "./chunks/TerrainBuilderIntegration"; // Assuming this is correct

export function useTerrainInteractionManager(props = {}) {
    const {
        // Props from TerrainBuilder
        currentBlockType,
        mode,
        axisLockEnabled,
        placementSize,
        environmentBuilderRef,
        undoRedoManager,
        previewPositionToAppJS,
        // Refs from TerrainBuilder
        toolManagerRef, // Tool manager instance
        spatialGridManagerRef, // Spatial grid for raycasting
        // Refs from DataManager (passed via TerrainBuilder)
        terrainRef,
        trackTerrainChanges,
        // Functions from other managers (passed via TerrainBuilder)
        updateSpatialHashForBlocks, // Likely from ChunkManager
    } = props;

    // Internal State/Refs for Interaction
    const isPlacingRef = useRef(false);
    const currentPlacingYRef = useRef(0);
    const previewPositionRef = useRef(new THREE.Vector3());
    const rawPlacementAnchorRef = useRef(new THREE.Vector3());
    const lockedAxisRef = useRef(null);
    const selectionDistanceRef = useRef(MAX_SELECTION_DISTANCE / 2); // Or get from constant
    const axisLockEnabledRef = useRef(axisLockEnabled); // Keep local copy synchronized
    const currentBlockTypeRef = useRef(currentBlockType); // Keep local copy synchronized
    const isFirstBlockRef = useRef(true);
    const modeRef = useRef(mode); // Keep local copy synchronized
    const placementSizeRef = useRef(placementSize); // Keep local copy synchronized
    const placedBlockCountRef = useRef(0);
    const lastDeletionTimeRef = useRef(0);
    const lastPlacementTimeRef = useRef(0);
    const [previewPosition, setPreviewPosition] = useState(new THREE.Vector3());
    const recentlyPlacedBlocksRef = useRef(new Set());
    const canvasRectRef = useRef(null);
    const tempVectorRef = useRef(new THREE.Vector3());
    const mouseMoveAnimationRef = useRef(null);
    const placementChangesRef = useRef({
        // For undo/redo batching
        terrain: { added: {}, removed: {} },
        environment: { added: [], removed: [] },
    });

    // Access Three.js context for raycasting
    const {
        scene,
        camera: threeCamera,
        raycaster: threeRaycaster,
        pointer,
        gl,
    } = useThree();

    // Synchronize internal refs with props
    useEffect(() => {
        axisLockEnabledRef.current = axisLockEnabled;
    }, [axisLockEnabled]);
    useEffect(() => {
        currentBlockTypeRef.current = currentBlockType;
    }, [currentBlockType]);
    useEffect(() => {
        modeRef.current = mode;
    }, [mode]);
    useEffect(() => {
        placementSizeRef.current = placementSize;
    }, [placementSize]);

    // --- Raycasting --- //
    const getRaycastIntersection = () => {
        if (!scene || !threeCamera || !threeRaycaster) return null;
        const normalizedMouse = pointer.clone();
        threeRaycaster.setFromCamera(normalizedMouse, threeCamera);
        let intersection = null;
        if (
            spatialGridManagerRef.current &&
            spatialGridManagerRef.current.size > 0
        ) {
            // Assuming getOptimizedRaycastIntersection is available (likely from ChunkManager)
            intersection = getOptimizedRaycastIntersection?.(true); // Needs the function passed in or defined here
        } else {
            const rayOrigin = threeRaycaster.ray.origin;
            const rayDirection = threeRaycaster.ray.direction;
            const target = new THREE.Vector3();
            const intersectionDistance = rayOrigin.y / -rayDirection.y;
            if (
                intersectionDistance > 0 &&
                intersectionDistance < selectionDistanceRef.current
            ) {
                target
                    .copy(rayOrigin)
                    .addScaledVector(rayDirection, intersectionDistance);
                // Need gridSizeRef here - pass from DataManager via TerrainBuilder
                const gridSizeHalf = props.gridSizeRef?.current / 2 || 100; // Default if not passed
                if (
                    Math.abs(target.x) <= gridSizeHalf &&
                    Math.abs(target.z) <= gridSizeHalf
                ) {
                    intersection = {
                        point: target.clone(),
                        normal: new THREE.Vector3(0, 1, 0),
                        block: {
                            x: Math.floor(target.x),
                            y: 0,
                            z: Math.floor(target.z),
                        },
                        blockId: null,
                        distance: intersectionDistance,
                        isGroundPlane: true,
                    };
                }
            }
        }
        return intersection;
    };

    // --- Preview Update --- //
    const updatePreviewPosition = () => {
        if (updatePreviewPosition.isProcessing) return;
        updatePreviewPosition.isProcessing = true;

        if (!canvasRectRef.current && gl) {
            canvasRectRef.current = gl.domElement.getBoundingClientRect();
        }

        const blockIntersection = getRaycastIntersection();
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const currentGroundPoint = new THREE.Vector3();
        const normalizedMouse = pointer.clone();
        threeRaycaster.setFromCamera(normalizedMouse, threeCamera);
        const hitGround = threeRaycaster.ray.intersectPlane(
            groundPlane,
            currentGroundPoint
        );

        if (blockIntersection?.point) {
            const isToolActive = toolManagerRef.current?.getActiveTool();
            const potentialNewPosition = tempVectorRef.current.clone();

            if (isToolActive) {
                const activeTool = toolManagerRef.current.getActiveTool();
                if (typeof activeTool.handleMouseMove === "function") {
                    const canvasRect = gl.domElement.getBoundingClientRect();
                    const mouseEvent = {
                        clientX:
                            ((pointer.x + 1) / 2) * canvasRect.width +
                            canvasRect.left,
                        clientY:
                            ((1 - pointer.y) / 2) * canvasRect.height +
                            canvasRect.top,
                        normal: blockIntersection.normal,
                    };
                    activeTool.handleMouseMove(
                        mouseEvent,
                        blockIntersection.point
                    );
                }
            }

            potentialNewPosition.copy(blockIntersection.point);

            if (modeRef.current === "delete" || modeRef.current === "remove") {
                if (blockIntersection.block) {
                    potentialNewPosition.set(
                        blockIntersection.block.x,
                        blockIntersection.block.y,
                        blockIntersection.block.z
                    );
                } else {
                    potentialNewPosition.x = Math.round(
                        potentialNewPosition.x -
                            blockIntersection.normal.x * 0.5
                    );
                    potentialNewPosition.y = Math.round(
                        potentialNewPosition.y -
                            blockIntersection.normal.y * 0.5
                    );
                    potentialNewPosition.z = Math.round(
                        potentialNewPosition.z -
                            blockIntersection.normal.z * 0.5
                    );
                }
            } else {
                // Add mode
                const hitBlock = blockIntersection.block || {
                    x: Math.floor(blockIntersection.point.x),
                    y: Math.floor(blockIntersection.point.y),
                    z: Math.floor(blockIntersection.point.z),
                };
                if (blockIntersection.face && blockIntersection.normal) {
                    potentialNewPosition.x = Math.round(
                        hitBlock.x + blockIntersection.normal.x
                    );
                    potentialNewPosition.y = Math.round(
                        hitBlock.y + blockIntersection.normal.y
                    );
                    potentialNewPosition.z = Math.round(
                        hitBlock.z + blockIntersection.normal.z
                    );
                } else {
                    potentialNewPosition.add(
                        blockIntersection.normal.clone().multiplyScalar(0.5)
                    );
                    potentialNewPosition.x = Math.round(potentialNewPosition.x);
                    potentialNewPosition.y = Math.round(potentialNewPosition.y);
                    potentialNewPosition.z = Math.round(potentialNewPosition.z);
                }
                if (
                    blockIntersection.isGroundPlane &&
                    modeRef.current === "add"
                ) {
                    potentialNewPosition.y = 0;
                }
                if (axisLockEnabledRef.current) {
                    const originalPos = previewPositionRef.current.clone();
                    const axisLock = lockedAxisRef.current;
                    if (axisLock === "x") {
                        potentialNewPosition.y = originalPos.y;
                        potentialNewPosition.z = originalPos.z;
                    } else if (axisLock === "y") {
                        potentialNewPosition.x = originalPos.x;
                        potentialNewPosition.z = originalPos.z;
                    } else if (axisLock === "z") {
                        potentialNewPosition.x = originalPos.x;
                        potentialNewPosition.y = originalPos.y;
                    }
                }
            }

            let shouldUpdatePreview = true;
            let thresholdMet = false;

            if (isPlacingRef.current && !isToolActive) {
                if (hitGround && rawPlacementAnchorRef.current) {
                    const groundDistanceMoved = currentGroundPoint.distanceTo(
                        rawPlacementAnchorRef.current
                    );
                    if (isFirstBlockRef.current) {
                        shouldUpdatePreview = true;
                        thresholdMet = true;
                        potentialNewPosition.y = currentPlacingYRef.current;
                    } else {
                        if (groundDistanceMoved < THRESHOLD_FOR_PLACING) {
                            shouldUpdatePreview = false;
                        } else {
                            shouldUpdatePreview = true;
                            thresholdMet = true;
                            potentialNewPosition.y = currentPlacingYRef.current;
                        }
                    }
                } else {
                    shouldUpdatePreview = false;
                    console.warn(
                        "Missing raw ground anchor or ground intersection point for threshold check."
                    );
                }
            }

            if (shouldUpdatePreview && previewPositionRef?.current) {
                previewPositionRef.current.copy(potentialNewPosition);
                setPreviewPosition(potentialNewPosition.clone());
                previewPositionToAppJS?.(potentialNewPosition.clone()); // Call prop function
                if (
                    isPlacingRef.current &&
                    !isToolActive &&
                    thresholdMet &&
                    hitGround
                ) {
                    rawPlacementAnchorRef.current.copy(currentGroundPoint);
                }
            }

            if (isPlacingRef.current && !isToolActive && shouldUpdatePreview) {
                handleBlockPlacement();
            }
        }

        updatePreviewPosition.isProcessing = false;
    };
    updatePreviewPosition.isProcessing = false;

    // --- Block Placement/Removal --- //
    const getPlacementPositions = (centerPos, size) => {
        const positions = [];
        positions.push({ ...centerPos }); // Use spread for shallow copy
        // Add logic for different sizes if needed in the future
        return positions;
    };

    const handleBlockPlacement = () => {
        if (toolManagerRef.current?.getActiveTool()) return;
        if (!modeRef.current || !isPlacingRef.current) return;

        if (currentBlockTypeRef.current?.isEnvironment) {
            if (
                isFirstBlockRef.current &&
                environmentBuilderRef.current?.placeEnvironmentModel
            ) {
                try {
                    const result =
                        environmentBuilderRef.current.placeEnvironmentModel(
                            modeRef.current
                        );
                    if (modeRef.current === "remove" && result?.length > 0) {
                        console.log(
                            `Removed ${result.length} environment objects`
                        );
                        // Environment undo handled by EnvironmentBuilder
                    } else if (
                        modeRef.current === "add" &&
                        result?.length > 0
                    ) {
                        console.log(
                            "Environment objects placed:",
                            result.length
                        );
                        if (placementChangesRef.current?.environment) {
                            // Track for undo
                            placementChangesRef.current.environment.added = [
                                ...placementChangesRef.current.environment
                                    .added,
                                ...result,
                            ];
                        }
                    }
                } catch (error) {
                    console.error("Error handling environment object:", error);
                }
            }
        } else {
            // Standard block placement/removal
            const now = performance.now();
            const positions = getPlacementPositions(
                previewPositionRef.current,
                placementSizeRef.current
            );
            const addedBlocks = {};
            const removedBlocks = {};
            let blockWasPlaced = false;
            let blockWasRemoved = false;

            if (modeRef.current === "add") {
                positions.forEach((pos) => {
                    const blockKey = `${pos.x},${pos.y},${pos.z}`;
                    if (!terrainRef.current?.[blockKey]) {
                        // Need terrainRef from DataManager
                        const blockId = currentBlockTypeRef.current.id;
                        addedBlocks[blockKey] = blockId;
                        // terrainRef.current[blockKey] = blockId; // Update should happen via updateTerrainBlocks
                        recentlyPlacedBlocksRef.current.add(blockKey);
                        placementChangesRef.current.terrain.added[blockKey] =
                            blockId; // Track for undo
                        blockWasPlaced = true;
                    }
                });
                if (blockWasPlaced) {
                    importedUpdateTerrainBlocks?.(addedBlocks, {}); // Needs function from Chunk Integration
                    trackTerrainChanges?.(addedBlocks, {}); // Needs function from DataManager
                    // Update spatial hash
                    const addedBlocksArray = Object.entries(addedBlocks).map(
                        ([posKey, blockId]) => {
                            const [x, y, z] = posKey.split(",").map(Number);
                            return { id: blockId, position: [x, y, z] };
                        }
                    );
                    if (addedBlocksArray.length > 0)
                        updateSpatialHashForBlocks?.(addedBlocksArray, [], {
                            force: true,
                        }); // Needs function from Chunk Manager
                    placedBlockCountRef.current +=
                        Object.keys(addedBlocks).length;
                    lastPlacementTimeRef.current = now;
                }
            } else if (modeRef.current === "remove") {
                if (now - lastDeletionTimeRef.current < 50) return;
                positions.forEach((pos) => {
                    const blockKey = `${pos.x},${pos.y},${pos.z}`;
                    if (terrainRef.current?.[blockKey]) {
                        // Need terrainRef from DataManager
                        const blockId = terrainRef.current[blockKey];
                        removedBlocks[blockKey] = blockId;
                        // delete terrainRef.current[blockKey]; // Update should happen via updateTerrainBlocks
                        placementChangesRef.current.terrain.removed[blockKey] =
                            blockId; // Track for undo
                        blockWasRemoved = true;
                    }
                });
                if (blockWasRemoved) {
                    importedUpdateTerrainBlocks?.({}, removedBlocks); // Needs function from Chunk Integration
                    trackTerrainChanges?.({}, removedBlocks); // Needs function from DataManager
                    // Update spatial hash
                    const removedBlocksArray = Object.entries(
                        removedBlocks
                    ).map(([posKey, blockId]) => {
                        const [x, y, z] = posKey.split(",").map(Number);
                        return { id: 0, position: [x, y, z] };
                    });
                    if (removedBlocksArray.length > 0)
                        updateSpatialHashForBlocks?.([], removedBlocksArray, {
                            force: true,
                        }); // Needs function from Chunk Manager
                    placedBlockCountRef.current +=
                        Object.keys(removedBlocks).length;
                    lastDeletionTimeRef.current = now;
                }
            }
        }
        isFirstBlockRef.current = false;
    };

    // --- Mouse Event Handlers --- //
    const handleMouseDown = (e) => {
        const isToolActive = toolManagerRef.current?.getActiveTool();
        if (isToolActive) {
            const intersection = getRaycastIntersection();
            if (intersection) {
                const mouseEvent = { ...e, normal: intersection.normal };
                toolManagerRef.current.handleMouseDown(
                    mouseEvent,
                    intersection.point,
                    e.button
                );
                return;
            }
        }
        if (e.button === 0 && !isToolActive) {
            isPlacingRef.current = true;
            const initialBlockIntersection = getRaycastIntersection();
            if (initialBlockIntersection) {
                currentPlacingYRef.current = previewPositionRef.current.y;
            }
            const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const groundPoint = new THREE.Vector3();
            threeRaycaster.ray.intersectPlane(groundPlane, groundPoint);
            if (groundPoint) {
                rawPlacementAnchorRef.current.copy(groundPoint);
            } else {
                console.warn(
                    "Initial ground plane raycast failed on mousedown."
                );
            }
            isFirstBlockRef.current = true;
            recentlyPlacedBlocksRef.current.clear();
            placedBlockCountRef.current = 0;
            if (axisLockEnabledRef.current) {
                // placementStartPosition.current = previewPositionRef.current.clone();
            }
            // Reset placement changes for this operation (undo batching)
            placementChangesRef.current = {
                terrain: { added: {}, removed: {} },
                environment: { added: [], removed: [] },
            };
            updatePreviewPosition();
            if (isFirstBlockRef.current) {
                handleBlockPlacement();
            }
            playPlaceSound();
        }
    };

    const handleMouseUp = (e) => {
        const t0 = performance.now();
        const isToolActive = toolManagerRef.current?.getActiveTool();
        if (isToolActive) {
            const intersection = getRaycastIntersection();
            if (intersection) {
                const mouseEvent = { ...e, normal: intersection.normal };
                toolManagerRef.current.handleMouseUp(
                    mouseEvent,
                    intersection.point,
                    e.button
                );
                return;
            }
        }

        if (isPlacingRef.current) {
            isPlacingRef.current = false;
            console.log(
                `handleMouseUp: Placed ${placedBlockCountRef.current} blocks`
            );
            if (placedBlockCountRef.current > 0) {
                // Save changes to undo stack if there are any
                if (
                    undoRedoManager?.current?.saveUndo &&
                    placementChangesRef.current &&
                    (Object.keys(
                        placementChangesRef.current.terrain.added || {}
                    ).length > 0 ||
                        Object.keys(
                            placementChangesRef.current.terrain.removed || {}
                        ).length > 0 ||
                        (placementChangesRef.current.environment.added || [])
                            .length > 0 ||
                        (placementChangesRef.current.environment.removed || [])
                            .length > 0)
                ) {
                    console.log(
                        "Saving placement changes to undo stack:",
                        placementChangesRef.current
                    );
                    undoRedoManager.current.saveUndo(
                        placementChangesRef.current
                    );
                }
                placedBlockCountRef.current = 0;
            }
            recentlyPlacedBlocksRef.current.clear();
        }
        const duration = performance.now() - t0;
        if (duration > 5)
            console.log(
                `handleMouseUp processing took ${duration.toFixed(2)}ms`
            );
    };

    // --- Keyboard Event Handlers --- //
    const handleKeyDown = (event) => {
        if (toolManagerRef.current?.getActiveTool()) {
            toolManagerRef.current.handleKeyDown(event);
        }
        // Add default key handlers if needed
    };
    const handleKeyUp = (event) => {
        if (toolManagerRef.current?.getActiveTool()) {
            toolManagerRef.current.handleKeyUp(event);
        }
        // Add default key handlers if needed
    };

    // --- Effects --- //
    // Update preview position on mouse move (throttled with rAF)
    useEffect(() => {
        const handleMouseMove = () => {
            if (mouseMoveAnimationRef.current)
                cancelAnimationFrame(mouseMoveAnimationRef.current);
            mouseMoveAnimationRef.current = requestAnimationFrame(
                updatePreviewPosition
            );
        };
        window.addEventListener("mousemove", handleMouseMove);
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            if (mouseMoveAnimationRef.current)
                cancelAnimationFrame(mouseMoveAnimationRef.current);
        };
    }, [gl, pointer, threeCamera, threeRaycaster]); // Dependencies are important!

    // Add/remove mouse/key listeners
    useEffect(() => {
        const canvas = gl?.domElement;
        if (!canvas) return;

        // Track mouse button state globally
        window.mouseButtons = 0;
        const updateMouseButtonsDown = (e) => {
            window.mouseButtons |= 1 << e.button;
        };
        const updateMouseButtonsUp = (e) => {
            window.mouseButtons &= ~(1 << e.button);
        };

        canvas.addEventListener("mousedown", handleMouseDown);
        canvas.addEventListener("mouseup", handleMouseUp);
        document.addEventListener("mousedown", updateMouseButtonsDown);
        document.addEventListener("mouseup", updateMouseButtonsUp);
        document.addEventListener("mouseleave", updateMouseButtonsUp);
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);

        return () => {
            canvas.removeEventListener("mousedown", handleMouseDown);
            canvas.removeEventListener("mouseup", handleMouseUp);
            document.removeEventListener("mousedown", updateMouseButtonsDown);
            document.removeEventListener("mouseup", updateMouseButtonsUp);
            document.removeEventListener("mouseleave", updateMouseButtonsUp);
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, [gl, handleMouseDown, handleMouseUp, handleKeyDown, handleKeyUp]); // Add dependencies

    // Fail-safe for missed mouseup
    useEffect(() => {
        let frameId;
        const checkMouseState = () => {
            if (
                isPlacingRef.current &&
                (!window.mouseButtons || !(window.mouseButtons & 1))
            ) {
                console.warn(
                    "Detected mouse button up while still in placing mode - fixing state"
                );
                handleMouseUp({ button: 0 }); // Simulate mouse up
            }
            frameId = requestAnimationFrame(checkMouseState);
        };
        frameId = requestAnimationFrame(checkMouseState);
        return () => cancelAnimationFrame(frameId);
    }, [handleMouseUp]); // Add handleMouseUp dependency

    // Return state and functions needed by TerrainBuilder or other managers
    return {
        // Refs
        previewPositionRef,
        isPlacingRef,

        // State
        previewPosition, // For rendering preview cube

        // Functions (to be called by TerrainBuilder event handlers maybe?)
        // Or attach listeners directly here?
        handleMouseDown,
        handleMouseUp,
        handleKeyDown, // If TerrainBuilder needs to forward these
        handleKeyUp,

        // Potentially expose internal state if needed by other parts
        getPlacementPositions, // If tools need it
    };
}
