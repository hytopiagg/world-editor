import * as THREE from "three";

const getOptimizedRaycastIntersection = (
    scene,
    threeCamera,
    threeRaycaster,
    pointer,
    useSpatialHashRef,
    spatialGridManagerRef,
    gridSizeRef,
    selectionDistanceRef,
    prioritizeBlocks,
    recentlyPlacedBlocksRef,
    isPlacingRef,
    modeRef
) => {
    if (!scene || !threeCamera || !threeRaycaster) return null;
    const normalizedMouse = pointer.clone();
    threeRaycaster.setFromCamera(normalizedMouse, threeCamera);
    let intersection = null;
    if (
        useSpatialHashRef.current &&
        spatialGridManagerRef.current &&
        spatialGridManagerRef.current.size > 0
    ) {
        const raycastOptions = {
            maxDistance: selectionDistanceRef.current,
            prioritizeBlocks,
            gridSize: gridSizeRef.current,
            recentlyPlacedBlocks: recentlyPlacedBlocksRef.current,
            isPlacing: isPlacingRef.current,
            mode: modeRef.current,
            debug: true, // Enable debug logging for this call
        };
        const gridResult = spatialGridManagerRef.current.raycast(
            threeRaycaster,
            threeCamera,
            raycastOptions
        );
        intersection = gridResult;
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
            const gridSizeHalf = gridSizeRef.current / 2;
            if (
                Math.abs(target.x) <= gridSizeHalf &&
                Math.abs(target.z) <= gridSizeHalf
            ) {
                intersection = {
                    point: target.clone(),
                    normal: new THREE.Vector3(0, 1, 0), // Normal is up for ground plane
                    block: {
                        x: Math.floor(target.x),
                        y: 0,
                        z: Math.floor(target.z),
                    },
                    blockId: null, // No block here - it's the ground
                    distance: intersectionDistance,
                    isGroundPlane: true,
                };
            }
        }
    }
    return intersection;
};

const getTerrainRaycastIntersection = (
    scene,
    threeCamera,
    threeRaycaster,
    pointer,
    useSpatialHashRef,
    spatialGridManagerRef,
    gridSizeRef,
    selectionDistanceRef,
    recentlyPlacedBlocksRef,
    isPlacingRef,
    modeRef
) => {
    if (!scene || !threeCamera || !threeRaycaster) return null;
    const normalizedMouse = pointer.clone();
    threeRaycaster.setFromCamera(normalizedMouse, threeCamera);
    let intersection = null;
    if (
        useSpatialHashRef.current &&
        spatialGridManagerRef.current &&
        spatialGridManagerRef.current.size > 0
    ) {
        intersection = getOptimizedRaycastIntersection(
            scene,
            threeCamera,
            threeRaycaster,
            pointer,
            useSpatialHashRef,
            spatialGridManagerRef,
            gridSizeRef,
            selectionDistanceRef,
            true,
            recentlyPlacedBlocksRef,
            isPlacingRef,
            modeRef
        );
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
            const gridSizeHalf = gridSizeRef.current / 2;
            if (
                Math.abs(target.x) <= gridSizeHalf &&
                Math.abs(target.z) <= gridSizeHalf
            ) {
                intersection = {
                    point: target.clone(),
                    normal: new THREE.Vector3(0, 1, 0), // Normal is up for ground plane
                    block: {
                        x: Math.floor(target.x),
                        y: 0,
                        z: Math.floor(target.z),
                    },
                    blockId: null, // No block here - it's the ground
                    distance: intersectionDistance,
                    isGroundPlane: true,
                };
            }
        }
    }
    return intersection;
};

export { getTerrainRaycastIntersection };
