import * as THREE from "three";

function handleTerrainMouseUp(
    e,
    toolManagerRef,
    isPlacingRef,
    placedBlockCountRef,
    recentlyPlacedBlocksRef,
    terrainRef,
    spatialGridManagerRef,
    undoRedoManager,
    placementChangesRef,
    ref,
    getRaycastIntersection
) {
    const isToolActive =
        toolManagerRef.current && toolManagerRef.current.getActiveTool();
    if (isToolActive) {
        const intersection = getRaycastIntersection();
        if (intersection) {
            const mouseEvent = {
                ...e,
                normal: intersection.normal,
            };
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
        if (placedBlockCountRef.current > 0) {
            if (spatialGridManagerRef.current) {
                const addedBlocks = Array.from(
                    recentlyPlacedBlocksRef.current
                ).map((posKey) => {
                    return [posKey, terrainRef.current[posKey as string]];
                });
                spatialGridManagerRef.current.updateBlocks(addedBlocks, []);
            }
            if (
                placementChangesRef.current &&
                (Object.keys(placementChangesRef.current.terrain.added || {})
                    .length > 0 ||
                    Object.keys(
                        placementChangesRef.current.terrain.removed || {}
                    ).length > 0 ||
                    (placementChangesRef.current.environment.added || [])
                        .length > 0 ||
                    (placementChangesRef.current.environment.removed || [])
                        .length > 0)
            ) {
                if (undoRedoManager?.current?.saveUndo) {
                    undoRedoManager.current.saveUndo(
                        placementChangesRef.current
                    );
                } else {
                    console.warn(
                        "No direct access to saveUndo function, trying fallbacks"
                    );
                    const tempRef = ref?.current;
                    if (
                        tempRef &&
                        tempRef.undoRedoManager &&
                        tempRef.undoRedoManager.current &&
                        tempRef.undoRedoManager.current.saveUndo
                    ) {
                        tempRef.undoRedoManager.current.saveUndo(
                            placementChangesRef.current
                        );
                    } else {
                        console.error(
                            "Could not find a way to save undo state, changes won't be tracked for undo/redo"
                        );
                    }
                }
            }
            placedBlockCountRef.current = 0;
        }
        recentlyPlacedBlocksRef.current.clear();
    }
}

function handleTerrainMouseDown(
    e,
    toolManagerRef,
    isPlacingRef,
    placedBlockCountRef,
    recentlyPlacedBlocksRef,
    placementChangesRef,
    getRaycastIntersection,
    currentPlacingYRef,
    previewPositionRef,
    rawPlacementAnchorRef,
    isFirstBlockRef,
    updatePreviewPosition,
    handleBlockPlacement,
    playPlaceSound,
    threeRaycaster
) {
    const isToolActive =
        toolManagerRef.current && toolManagerRef.current.getActiveTool();
    if (isToolActive) {
        const intersection = getRaycastIntersection();
        if (intersection) {
            const mouseEvent = {
                ...e,
                normal: intersection.normal,
            };
            toolManagerRef.current.handleMouseDown(
                mouseEvent,
                intersection.point,
                e.button
            );
            return;
        }
    }
    if (e.button === 0) {
        if (!isToolActive) {
            isPlacingRef.current = true;
            const initialBlockIntersection = getRaycastIntersection();
            if (initialBlockIntersection) {
                currentPlacingYRef.current = previewPositionRef.current.y; // Use current preview Y
            }
            const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Plane at y=0
            const groundPoint = new THREE.Vector3();
            threeRaycaster.ray.intersectPlane(groundPlane, groundPoint);
            if (groundPoint) {
                rawPlacementAnchorRef.current.copy(groundPoint);
            } else {
                console.warn(
                    "Initial ground plane raycast failed on mousedown. Cannot set raw placement anchor."
                );
            }
            isFirstBlockRef.current = true;
            recentlyPlacedBlocksRef.current.clear();
            placedBlockCountRef.current = 0;
            placementChangesRef.current = {
                terrain: { added: {}, removed: {} },
                environment: { added: [], removed: [] },
            };
            updatePreviewPosition();
            if (isFirstBlockRef.current) {
                console.log("isFirstBlockRef.current");
                handleBlockPlacement();
            }
            playPlaceSound(); // Play sound on initial click
        }
    }
}

export { handleTerrainMouseUp, handleTerrainMouseDown };
