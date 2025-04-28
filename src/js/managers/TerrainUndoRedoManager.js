import { DatabaseManager, STORES } from "./DatabaseManager";

class TerrainUndoRedoManager {
    constructor({
        terrainRef,
        totalBlocksRef,
        sendTotalBlocks,
        updateDebugInfo,
        importedUpdateTerrainBlocks,
        updateSpatialHashForBlocks,
        customBlocks,
        BlockTextureAtlas,
    }) {
        this.terrainRef = terrainRef;
        this.totalBlocksRef = totalBlocksRef;
        this.sendTotalBlocks = sendTotalBlocks;
        this.updateDebugInfo = updateDebugInfo;
        this.importedUpdateTerrainBlocks = importedUpdateTerrainBlocks;
        this.updateSpatialHashForBlocks = updateSpatialHashForBlocks;
        this.customBlocks = customBlocks;
        this.BlockTextureAtlas = BlockTextureAtlas;
        this.pendingChangesRef = {
            current: {
                terrain: {
                    added: {},
                    removed: {},
                },
                environment: {
                    added: [],
                    removed: [],
                },
            },
        };
    }

    trackTerrainChanges(added = {}, removed = {}) {
        if (window.IS_DATABASE_CLEARING) {
            return;
        }

        if (!this.pendingChangesRef.current) {
            this.pendingChangesRef.current = {
                terrain: {
                    added: {},
                    removed: {},
                },
                environment: {
                    added: [],
                    removed: [],
                },
            };
        }

        if (!this.pendingChangesRef.current.terrain) {
            this.pendingChangesRef.current.terrain = {
                added: {},
                removed: {},
            };
        }

        if (!this.pendingChangesRef.current.environment) {
            this.pendingChangesRef.current.environment = {
                added: [],
                removed: [],
            };
        }

        const safeAdded = added || {};
        const safeRemoved = removed || {};

        Object.entries(safeAdded).forEach(([key, value]) => {
            if (this.pendingChangesRef.current?.terrain?.added) {
                this.pendingChangesRef.current.terrain.added[key] = value;
            }
            if (
                this.pendingChangesRef.current?.terrain?.removed &&
                this.pendingChangesRef.current.terrain.removed[key]
            ) {
                delete this.pendingChangesRef.current.terrain.removed[key];
            }
        });

        Object.entries(safeRemoved).forEach(([key, value]) => {
            if (
                this.pendingChangesRef.current?.terrain?.added &&
                this.pendingChangesRef.current.terrain.added[key]
            ) {
                delete this.pendingChangesRef.current.terrain.added[key];
            } else if (this.pendingChangesRef.current?.terrain?.removed) {
                this.pendingChangesRef.current.terrain.removed[key] = value;
            }
        });
    }

    resetPendingChanges() {
        this.pendingChangesRef.current = {
            terrain: {
                added: {},
                removed: {},
            },
            environment: {
                added: [],
                removed: [],
            },
        };
    }

    updateTerrainForUndoRedo(addedBlocks, removedBlocks, source = "undo/redo") {
        console.time(`updateTerrainForUndoRedo-${source}`);
        this.trackTerrainChanges(addedBlocks, removedBlocks);

        addedBlocks = addedBlocks || {};
        removedBlocks = removedBlocks || {};

        if (
            Object.keys(addedBlocks).length === 0 &&
            Object.keys(removedBlocks).length === 0
        ) {
            console.timeEnd(`updateTerrainForUndoRedo-${source}`);
            return;
        }

        // Handle custom block textures
        Object.entries(addedBlocks).forEach(([posKey, blockId]) => {
            if (!isNaN(parseInt(blockId))) {
                let dataUri = null;
                if (this.customBlocks && this.customBlocks[blockId]) {
                    dataUri = this.customBlocks[blockId].dataUri;
                }
                if (!dataUri && typeof localStorage !== "undefined") {
                    const storageKeys = [
                        `block-texture-${blockId}`,
                        `custom-block-${blockId}`,
                        `datauri-${blockId}`,
                    ];
                    for (const key of storageKeys) {
                        const storedUri = localStorage.getItem(key);
                        if (storedUri && storedUri.startsWith("data:image/")) {
                            dataUri = storedUri;
                            break;
                        }
                    }
                }
                if (dataUri && dataUri.startsWith("data:image/")) {
                    localStorage.setItem(`block-texture-${blockId}`, dataUri);
                    if (
                        this.BlockTextureAtlas &&
                        this.BlockTextureAtlas.instance
                    ) {
                        this.BlockTextureAtlas.instance
                            .applyDataUriToAllFaces(blockId, dataUri)
                            .catch((err) =>
                                console.error(
                                    `Error applying data URI to block ${blockId}:`,
                                    err
                                )
                            );
                    }
                }
            }
        });

        // Update terrain data
        Object.entries(addedBlocks).forEach(([posKey, blockId]) => {
            this.terrainRef.current[posKey] = blockId;
        });

        Object.entries(removedBlocks).forEach(([posKey]) => {
            delete this.terrainRef.current[posKey];
        });

        // Update block count
        this.totalBlocksRef.current = Object.keys(
            this.terrainRef.current
        ).length;
        if (this.sendTotalBlocks) {
            this.sendTotalBlocks(this.totalBlocksRef.current);
        }

        this.updateDebugInfo();
        this.importedUpdateTerrainBlocks(addedBlocks, removedBlocks);

        // Update spatial hash
        const addedBlocksArray = Object.entries(addedBlocks).map(
            ([posKey, blockId]) => {
                const [x, y, z] = posKey.split(",").map(Number);
                return {
                    id: blockId,
                    position: [x, y, z],
                };
            }
        );

        const removedBlocksArray = Object.entries(removedBlocks).map(
            ([posKey]) => {
                const [x, y, z] = posKey.split(",").map(Number);
                return {
                    id: 0, // Use 0 for removed blocks
                    position: [x, y, z],
                };
            }
        );

        this.updateSpatialHashForBlocks(addedBlocksArray, removedBlocksArray, {
            force: true,
        });

        console.timeEnd(`updateTerrainForUndoRedo-${source}`);
    }

    async clearUndoRedoHistory() {
        try {
            await DatabaseManager.saveData(STORES.UNDO, "states", []);
            await DatabaseManager.saveData(STORES.REDO, "states", []);
        } catch (error) {
            console.error("Failed to clear undo/redo history:", error);
        }
    }
}

export default TerrainUndoRedoManager;
