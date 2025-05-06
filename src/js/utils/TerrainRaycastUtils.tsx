import * as THREE from "three";

const getOptimizedRaycastIntersection = (
    scene: THREE.Scene,
    threeCamera: THREE.Camera,
    threeRaycaster: THREE.Raycaster,
    pointer: THREE.Vector2,
    useSpatialHashRef,
    spatialGridManagerRef,
    gridSizeRef,
    selectionDistanceRef,
    prioritizeBlocks: boolean,
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
    scene: THREE.Scene,
    threeCamera: THREE.Camera,
    threeRaycaster: THREE.Raycaster,
    pointer: THREE.Vector2,
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
        ); // Always prioritize blocks
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
