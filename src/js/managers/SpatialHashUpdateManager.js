import { CHUNK_SIZE } from "../constants/terrain";
import { getViewDistance } from "../constants/terrain";
import { cameraMovementTracker } from "./CameraMovementTracker";

class SpatialHashUpdateManager {
    constructor() {
        this.spatialHashUpdateQueuedRef = { current: false };
        this.spatialHashLastUpdateRef = { current: 0 };
        this.disableSpatialHashUpdatesRef = { current: false };
        this.deferSpatialHashUpdatesRef = { current: false };
        this.pendingSpatialHashUpdatesRef = {
            current: { added: [], removed: [] },
        };
    }

    updateSpatialHashForBlocks(
        spatialGridManager,
        addedBlocks = [],
        removedBlocks = [],
        options = {}
    ) {
        console.log("updateSpatialHashForBlocks");
        if (this.disableSpatialHashUpdatesRef.current) {
            return;
        }

        if (!spatialGridManager) {
            return;
        }

        const validAddedBlocks = Array.isArray(addedBlocks) ? addedBlocks : [];
        const validRemovedBlocks = Array.isArray(removedBlocks)
            ? removedBlocks
            : [];

        if (validAddedBlocks.length === 0 && validRemovedBlocks.length === 0) {
            return;
        }

        if (this.deferSpatialHashUpdatesRef.current && !options.force) {
            this.pendingSpatialHashUpdatesRef.current.added.push(
                ...validAddedBlocks
            );
            this.pendingSpatialHashUpdatesRef.current.removed.push(
                ...validRemovedBlocks
            );
            return;
        }

        if (
            !options.force &&
            (validAddedBlocks.length > 100 || validRemovedBlocks.length > 100)
        ) {
            return;
        }

        const now = performance.now();
        if (
            now - this.spatialHashLastUpdateRef.current < 1000 &&
            !options.force
        ) {
            if (
                validAddedBlocks.length + validRemovedBlocks.length <= 10 &&
                !this.spatialHashUpdateQueuedRef.current
            ) {
                this.spatialHashUpdateQueuedRef.current = true;
                setTimeout(() => {
                    if (
                        spatialGridManager &&
                        !spatialGridManager.isProcessing
                    ) {
                        try {
                            const camera = spatialGridManager.camera;
                            if (camera && !options.force) {
                                spatialGridManager.updateFrustumCache(
                                    camera,
                                    getViewDistance()
                                );
                                const filteredAddedBlocks =
                                    validAddedBlocks.filter((block) => {
                                        if (!block || typeof block !== "object")
                                            return false;
                                        let x, y, z;
                                        if (Array.isArray(block.position)) {
                                            [x, y, z] = block.position;
                                        } else if (
                                            block.x !== undefined &&
                                            block.y !== undefined &&
                                            block.z !== undefined
                                        ) {
                                            x = block.x;
                                            y = block.y;
                                            z = block.z;
                                        } else if (typeof block === "string") {
                                            [x, y, z] = block
                                                .split(",")
                                                .map(Number);
                                        } else {
                                            return false;
                                        }
                                        const chunkX = Math.floor(
                                            x / CHUNK_SIZE
                                        );
                                        const chunkY = Math.floor(
                                            y / CHUNK_SIZE
                                        );
                                        const chunkZ = Math.floor(
                                            z / CHUNK_SIZE
                                        );
                                        const chunkKey = `${chunkX},${chunkY},${chunkZ}`;
                                        return spatialGridManager.chunksInFrustum.has(
                                            chunkKey
                                        );
                                    });
                                const filteredRemovedBlocks =
                                    validRemovedBlocks.filter((block) => {
                                        if (!block) return false;
                                        let x, y, z;
                                        if (
                                            typeof block === "object" &&
                                            Array.isArray(block.position)
                                        ) {
                                            [x, y, z] = block.position;
                                        } else if (
                                            typeof block === "object" &&
                                            block.x !== undefined &&
                                            block.y !== undefined &&
                                            block.z !== undefined
                                        ) {
                                            x = block.x;
                                            y = block.y;
                                            z = block.z;
                                        } else if (typeof block === "string") {
                                            [x, y, z] = block
                                                .split(",")
                                                .map(Number);
                                        } else {
                                            return false;
                                        }
                                        const chunkX = Math.floor(
                                            x / CHUNK_SIZE
                                        );
                                        const chunkY = Math.floor(
                                            y / CHUNK_SIZE
                                        );
                                        const chunkZ = Math.floor(
                                            z / CHUNK_SIZE
                                        );
                                        const chunkKey = `${chunkX},${chunkY},${chunkZ}`;
                                        return spatialGridManager.chunksInFrustum.has(
                                            chunkKey
                                        );
                                    });
                                if (
                                    filteredAddedBlocks.length > 0 ||
                                    filteredRemovedBlocks.length > 0
                                ) {
                                    spatialGridManager.updateBlocks(
                                        filteredAddedBlocks,
                                        filteredRemovedBlocks,
                                        {
                                            showLoadingScreen: false,
                                            silent: true,
                                            skipIfBusy: true,
                                        }
                                    );
                                }
                            } else {
                                spatialGridManager.updateBlocks(
                                    validAddedBlocks,
                                    validRemovedBlocks,
                                    {
                                        showLoadingScreen: false,
                                        silent: true,
                                        skipIfBusy: true,
                                    }
                                );
                            }
                        } catch (e) {
                            console.error("Error updating spatial hash:", e);
                        }
                    }
                    setTimeout(() => {
                        this.spatialHashUpdateQueuedRef.current = false;
                    }, 1000);
                }, 1000);
            }
            return;
        }

        this.spatialHashLastUpdateRef.current = now;
        if (cameraMovementTracker.isMoving() && !options.force) {
            return;
        }

        try {
            if (
                options.force ||
                validAddedBlocks.length > 1000 ||
                validRemovedBlocks.length > 1000
            ) {
                spatialGridManager.updateBlocks(
                    validAddedBlocks,
                    validRemovedBlocks,
                    {
                        showLoadingScreen: options.force ? true : false,
                        silent: options.force ? false : true,
                        skipIfBusy: options.force ? false : true,
                    }
                );
                return;
            }

            const camera = spatialGridManager.camera;
            if (camera) {
                spatialGridManager.updateFrustumCache(
                    camera,
                    getViewDistance()
                );
                const filteredAddedBlocks = validAddedBlocks.filter((block) => {
                    if (!block || typeof block !== "object") return false;
                    let x, y, z;
                    if (Array.isArray(block.position)) {
                        [x, y, z] = block.position;
                    } else if (
                        block.x !== undefined &&
                        block.y !== undefined &&
                        block.z !== undefined
                    ) {
                        x = block.x;
                        y = block.y;
                        z = block.z;
                    } else if (typeof block === "string") {
                        [x, y, z] = block.split(",").map(Number);
                    } else {
                        return false;
                    }
                    const chunkX = Math.floor(x / CHUNK_SIZE);
                    const chunkY = Math.floor(y / CHUNK_SIZE);
                    const chunkZ = Math.floor(z / CHUNK_SIZE);
                    const chunkKey = `${chunkX},${chunkY},${chunkZ}`;
                    return spatialGridManager.chunksInFrustum.has(chunkKey);
                });
                const filteredRemovedBlocks = validRemovedBlocks.filter(
                    (block) => {
                        if (!block) return false;
                        let x, y, z;
                        if (
                            typeof block === "object" &&
                            Array.isArray(block.position)
                        ) {
                            [x, y, z] = block.position;
                        } else if (
                            typeof block === "object" &&
                            block.x !== undefined &&
                            block.y !== undefined &&
                            block.z !== undefined
                        ) {
                            x = block.x;
                            y = block.y;
                            z = block.z;
                        } else if (typeof block === "string") {
                            [x, y, z] = block.split(",").map(Number);
                        } else {
                            return false;
                        }
                        const chunkX = Math.floor(x / CHUNK_SIZE);
                        const chunkY = Math.floor(y / CHUNK_SIZE);
                        const chunkZ = Math.floor(z / CHUNK_SIZE);
                        const chunkKey = `${chunkX},${chunkY},${chunkZ}`;
                        return spatialGridManager.chunksInFrustum.has(chunkKey);
                    }
                );
                if (
                    filteredAddedBlocks.length > 0 ||
                    filteredRemovedBlocks.length > 0
                ) {
                    spatialGridManager.updateBlocks(
                        filteredAddedBlocks,
                        filteredRemovedBlocks,
                        {
                            showLoadingScreen: false,
                            silent: true,
                            skipIfBusy: true,
                        }
                    );
                }
            } else {
                spatialGridManager.updateBlocks(
                    validAddedBlocks,
                    validRemovedBlocks,
                    {
                        showLoadingScreen: options.force ? true : false,
                        silent: options.force ? false : true,
                        skipIfBusy: options.force ? false : true,
                    }
                );
            }
        } catch (e) {
            console.error("Error updating spatial hash:", e);
        }
    }

    applyDeferredSpatialHashUpdates(spatialGridManager) {
        if (
            this.pendingSpatialHashUpdatesRef.current.added.length === 0 &&
            this.pendingSpatialHashUpdatesRef.current.removed.length === 0
        ) {
            return;
        }
        const added = [...this.pendingSpatialHashUpdatesRef.current.added];
        const removed = [...this.pendingSpatialHashUpdatesRef.current.removed];
        this.pendingSpatialHashUpdatesRef.current = { added: [], removed: [] };
        return this.updateSpatialHashForBlocks(
            spatialGridManager,
            added,
            removed,
            { force: true }
        );
    }

    setDeferSpatialHashUpdates(defer) {
        this.deferSpatialHashUpdatesRef.current = defer;
        return defer;
    }

    setDisableSpatialHashUpdates(disable) {
        this.disableSpatialHashUpdatesRef.current = disable;
        return disable;
    }

    isPendingSpatialHashUpdates() {
        return (
            this.pendingSpatialHashUpdatesRef.current &&
            this.pendingSpatialHashUpdatesRef.current.added.length +
                this.pendingSpatialHashUpdatesRef.current.removed.length >
                0
        );
    }
}

export const spatialHashUpdateManager = new SpatialHashUpdateManager();
