import * as THREE from "three";

function handleTerrainMouseUp(
    e,
    toolManagerRef,
    isPlacingRef,
    placedBlockCountRef,
    placedEnvironmentCountRef,
    recentlyPlacedBlocksRef,
    terrainRef,
    spatialGridManagerRef,
    undoRedoManager,
    placementChangesRef,
    ref,
    getRaycastIntersection
) {
    console.log("handleTerrainMouseUp");
    console.log('e', e);

    if (e.type !== "mouseup") {
        return;
    }

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

    console.log("isPlacingRef.current", isPlacingRef.current);
    if (isPlacingRef.current) {
        isPlacingRef.current = false;
        console.log("placedBlockCountRef.current", placedBlockCountRef.current);
        if (placedBlockCountRef.current > 0) {
            if (spatialGridManagerRef.current) {
                const addedBlocks = Array.from(
                    recentlyPlacedBlocksRef.current
                ).map((posKey) => {
                    return [posKey, terrainRef.current[posKey as string]];
                });
                spatialGridManagerRef.current.updateBlocks(addedBlocks, []);
            }
        }

        if (placedBlockCountRef.current > 0) {
            if (
                placementChangesRef.current &&
                (Object.keys(placementChangesRef.current.terrain.added || {})
                    .length > 0 ||
                    Object.keys(
                        placementChangesRef.current.terrain.removed || {}
                    ).length > 0
                ) && placedEnvironmentCountRef.current === 0
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
                        console.log("mouse-up saveUndo");
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
            placedEnvironmentCountRef.current = 0;
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
    placedEnvironmentCountRef,
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
    threeRaycaster,
    cameraManager,
    currentBlockTypeRef
) {
    // if (!cameraManager.isPointerUnlockedMode && !cameraManager.isPointerLocked) {
    //     cameraManager.isPointerLocked = true;
    //     return;
    // }
    const isToolActive =
        toolManagerRef.current && toolManagerRef.current.getActiveTool();

    if (currentBlockTypeRef?.current?.isComponent && !isToolActive) {
        return;
    }

    console.log("handleTerrainMouseDown");
    if (isToolActive) {
        console.log("isToolActive");
        if ((isToolActive.name === "terrain" || isToolActive.name === "replace") && e.button !== 0) {
            console.log("Terrain tool ignoring non-left click");
            return;
        }
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
    // TODO: Handle pointer lock mode
    // If Terrain tool is active, ignore mouse buttons other than left (0) and right (2)
    const activeTool = toolManagerRef.current?.getActiveTool?.();
    if (activeTool?.name === "terrain") {
        // In unlocked mode we only care about left click; in locked mode keep original behaviour
        const isLocked = !cameraManager.isPointerUnlockedMode && cameraManager.isPointerLocked;
        if (!isLocked && e.button !== 0) return;
    }

    // For the general placement system we proceed only on left-click (button 0) unless pointer-lock remove mode
    if (e.button !== 0 && !(!cameraManager.isPointerUnlockedMode && cameraManager.isPointerLocked && e.button === 2)) {
        return;
    }

    if (e.button === 0 || (!cameraManager.isPointerUnlockedMode && cameraManager.isPointerLocked && e.button === 2)) {
        if (!isToolActive) {
            console.log("isPlacingRef.current = true");
            isPlacingRef.current = true;
            const initialBlockIntersection = getRaycastIntersection();
            console.log("initialBlockIntersection", initialBlockIntersection);
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
            placedEnvironmentCountRef.current = 0;
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
