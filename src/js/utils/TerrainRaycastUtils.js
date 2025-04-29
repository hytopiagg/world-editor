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
            debug: false,
        };
        const gridResult = spatialGridManagerRef.current.raycast(
            threeRaycaster,
            threeCamera,
            raycastOptions
        );

        if (gridResult && gridResult.block) {
            gridResult.block.x = Math.floor(gridResult.block.x);
            gridResult.block.y = Math.floor(gridResult.block.y);
            gridResult.block.z = Math.floor(gridResult.block.z);
        }

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
                const adjustedX = Math.floor(target.x) + 0.5;
                const adjustedZ = Math.floor(target.z) + 0.5;

                intersection = {
                    point: new THREE.Vector3(adjustedX, 0, adjustedZ),
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

    // Use the raw pointer coordinates directly from THREE.js
    const normalizedMouse = pointer.clone();

    // Setup raycaster with the normalized coordinates
    threeRaycaster.setFromCamera(normalizedMouse, threeCamera);

    // First, check for block collisions using optimized ray casting
    let intersection = null;

    // Safety check - ensure spatialGridManagerRef.current is initialized
    if (
        useSpatialHashRef.current &&
        spatialGridManagerRef.current &&
        spatialGridManagerRef.current.size > 0
    ) {
        // Use the optimized raycast method which now handles both block and ground plane detection
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
        ); // Always prioritize blocks
    } else {
        // Fallback to simple ground plane detection if spatial hash is not available
        const rayOrigin = threeRaycaster.ray.origin;
        const rayDirection = threeRaycaster.ray.direction;

        // Calculate intersection with the ground plane
        const target = new THREE.Vector3();
        const intersectionDistance = rayOrigin.y / -rayDirection.y;

        // Only consider intersections in front of the camera and within selection distance
        if (
            intersectionDistance > 0 &&
            intersectionDistance < selectionDistanceRef.current
        ) {
            // Calculate the intersection point
            target
                .copy(rayOrigin)
                .addScaledVector(rayDirection, intersectionDistance);

            // Check if this point is within our valid grid area
            const gridSizeHalf = gridSizeRef.current / 2;
            if (
                Math.abs(target.x) <= gridSizeHalf &&
                Math.abs(target.z) <= gridSizeHalf
            ) {
                // Ensure consistent behavior with block intersection by using centered coordinates
                const adjustedX = Math.floor(target.x) + 0.5;
                const adjustedZ = Math.floor(target.z) + 0.5;
                
                // This is a hit against the ground plane within the valid build area
                intersection = {
                    point: new THREE.Vector3(adjustedX, 0, adjustedZ),
                    normal: new THREE.Vector3(0, 1, 0), // Normal is up for ground plane
                    block: {
                        // For ground plane hits in remove mode, we need to be very specific about the block position
                        // to match the exact behavior when hitting blocks
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
