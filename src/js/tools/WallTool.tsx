/**
 * WallTool.js - Tool for placing walls in the world editor
 *
 * This tool handles wall placement, previewing, and manipulation.
 */
import * as THREE from "three";
import BaseTool from "./BaseTool";
class WallTool extends BaseTool {

    wallHeight: number;
    isCtrlPressed: boolean;
    wallStartPosition: THREE.Vector3 | null;
    wallPreviewMeshes: THREE.Mesh[];
    wallDebugMesh: THREE.Mesh | null;
    terrainRef: React.RefObject<any>;
    currentBlockTypeRef: React.RefObject<any>;
    scene: THREE.Scene;
    toolManagerRef: React.RefObject<any>;
    terrainBuilderRef: React.RefObject<any>;
    undoRedoManager: React.RefObject<any>;
    saveUndoFunction: (changes: any) => void;
    placementChangesRef: React.RefObject<any>;
    isPlacingRef: React.RefObject<any>;
    previewPositionRef: React.RefObject<any>;
    wallPreview: THREE.InstancedMesh | null;
    pendingChangesRef: React.RefObject<any>;
    environmentBuilderRef: React.RefObject<any>;
    constructor(terrainBuilderProps) {
        console.log("WallTool initialized");
        super(terrainBuilderProps);

        this.name = "WallTool";
        this.tooltip =
            "Wall Tool: Click to start, click again to place. Use 1 | 2 to adjust height. Hold Ctrl to erase. Press Escape to cancel. ";
        this.wallHeight = 1;
        this.isCtrlPressed = false;
        this.wallStartPosition = null;
        this.wallPreviewMeshes = [];
        this.wallDebugMesh = null;

        if (terrainBuilderProps) {
            this.terrainRef = terrainBuilderProps.terrainRef;
            this.currentBlockTypeRef = terrainBuilderProps.currentBlockTypeRef;
            this.scene = terrainBuilderProps.scene;
            this.toolManagerRef = terrainBuilderProps.toolManagerRef;
            this.terrainBuilderRef = terrainBuilderProps.terrainBuilderRef;

            this.undoRedoManager = terrainBuilderProps.undoRedoManager;
            this.saveUndoFunction = terrainBuilderProps.saveUndoFunction;
            this.placementChangesRef = terrainBuilderProps.placementChangesRef;
            this.isPlacingRef = terrainBuilderProps.isPlacingRef;
            this.previewPositionRef = terrainBuilderProps.previewPositionRef;
            this.pendingChangesRef = terrainBuilderProps.pendingChangesRef;
            this.environmentBuilderRef = terrainBuilderProps.environmentBuilderRef;
        } else {
            console.error(
                "WallTool: terrainBuilderProps is undefined in constructor"
            );
        }
    }
    onActivate() {
        super.onActivate();

        if (!this.terrainRef) {
            console.error("WallTool Activation Error: terrainRef is missing.");

            return;
        }

        if (this.terrainRef && !this.terrainRef.current) {
            console.warn(
                "WallTool: Initializing terrainRef.current in onActivate (was null/undefined)."
            );
            this.terrainRef.current = {};
        }

        if (!this.isPlacingRef) {
            console.error(
                "WallTool Activation Error: isPlacingRef is missing."
            );
            return; // Stop activation
        }

        if (!this.placementChangesRef) {
            console.error(
                "WallTool Activation Error: placementChangesRef is missing."
            );
            return; // Stop activation
        }

        if (!this.scene) {
            console.error("WallTool Activation Error: scene is missing.");
            return; // Stop activation
        }

        if (!this.previewPositionRef) {
            console.warn(
                "WallTool Activation Warning: previewPositionRef is missing. Wall preview might not work correctly."
            );

        }


        this.wallStartPosition = null;
        this.removeWallPreview(); // Needs this.scene, checked above


        if (this.isPlacingRef) {

            this.isPlacingRef.current = false;
        }

        if (this.placementChangesRef) {

            this.placementChangesRef.current = {
                terrain: { added: {}, removed: {} },
                environment: { added: [], removed: [] },
            };
        }
        console.log("WallTool finished onActivate successfully.");
        return true; // Indicate successful activation
    }
    onDeactivate() {
        super.onDeactivate();
        this.removeWallPreview();
        this.wallStartPosition = null;
        if (this.isPlacingRef) {
            this.isPlacingRef.current = false;
        }
        if (this.placementChangesRef) {
            this.placementChangesRef.current = {
                terrain: { added: {}, removed: {} },
                environment: { added: [], removed: [] },
            };
        }
    }
    /**
     * Handles mouse down events for wall placement
     */
    handleMouseDown(event, position, button) {

        if (!this.previewPositionRef || !this.previewPositionRef.current) {
            console.error(
                "WallTool: previewPositionRef is undefined in handleMouseDown"
            );
            return;
        }

        const currentPosition = this.previewPositionRef.current;

        if (button === 0) {
            if (this.wallStartPosition) {

                if (!this.terrainRef) {
                    console.error(
                        "WallTool: terrainRef is undefined when attempting to place wall"
                    );
                    this.wallStartPosition = null;
                    this.removeWallPreview();
                    return;
                }
                if (!this.terrainRef.current) {
                    this.terrainRef.current = {};
                }

                if (this.isPlacingRef) {
                    this.isPlacingRef.current = true;
                }

                if (this.placementChangesRef) {
                    this.placementChangesRef.current = {
                        terrain: { added: {}, removed: {} },
                        environment: { added: [], removed: [] },
                    };
                } else {
                    console.warn(
                        "WallTool: placementChangesRef is not available, changes won't be tracked for undo/redo"
                    );
                }

                let actionPerformed = false;
                if (this.isCtrlPressed) {
                    actionPerformed = this.eraseWall(
                        this.wallStartPosition,
                        currentPosition,
                        this.wallHeight
                    );
                } else {
                    actionPerformed = this.placeWall(
                        this.wallStartPosition,
                        currentPosition,
                        this.wallHeight
                    );
                }
                if (!actionPerformed) {
                    console.warn("WallTool: Wall action failed");
                    return;
                }

                this.wallStartPosition = null;
                this.removeWallPreview();
            } else {

                this.wallStartPosition = currentPosition.clone();
                this.updateWallPreview(this.wallStartPosition, currentPosition);
            }
        }
    }
    handleMouseUp(event, position, button) {

        if (this.isPlacingRef?.current) {

            this.isPlacingRef.current = false;

            if (this.placementChangesRef?.current) {
                const changes = this.placementChangesRef.current;

                if (
                    changes &&
                    (Object.keys(changes.terrain.added || {}).length > 0 ||
                        Object.keys(changes.terrain.removed || {}).length > 0)
                ) {
                    console.log(
                        "WallTool: Saving changes to undo stack:",
                        changes
                    );

                    if (this.undoRedoManager?.current?.saveUndo) {
                        this.undoRedoManager.current.saveUndo(changes);
                    } else if (
                        this.terrainBuilderRef?.current?.undoRedoManager
                            ?.current?.saveUndo
                    ) {
                        this.terrainBuilderRef.current.undoRedoManager.current.saveUndo(
                            changes
                        );
                    } else {
                        console.warn(
                            "WallTool: No undoRedoManager available, changes won't be tracked for undo/redo"
                        );
                    }

                    this.placementChangesRef.current = {
                        terrain: { added: {}, removed: {} },
                        environment: { added: [], removed: [] },
                    };
                } else {
                    console.warn("WallTool: No changes to save");
                }
            }
        }
    }
    /**
     * Handles mouse move events for wall preview
     */
    handleMouseMove(event, position) {

        if (
            this.wallStartPosition &&
            this.previewPositionRef &&
            this.previewPositionRef.current
        ) {
            this.updateWallPreview(
                this.wallStartPosition,
                this.previewPositionRef.current
            );
        }
    }
    /**
     * Updates the wall height
     */
    setWallHeight(height) {
        console.log("Setting wall height to:", Math.max(1, height));
        this.wallHeight = Math.max(1, height);

        if (
            this.wallStartPosition &&
            this.previewPositionRef &&
            this.previewPositionRef.current
        ) {
            this.updateWallPreview(
                this.wallStartPosition,
                this.previewPositionRef.current
            );
        } else {
            console.log("Wall preview not updated - missing references:", {
                wallStartPosition: !!this.wallStartPosition,
                previewPositionRef: !!this.previewPositionRef,
                previewPositionRefCurrent:
                    this.previewPositionRef &&
                    !!this.previewPositionRef.current,
            });
        }
    }
    /**
     * Track Ctrl key state for erasing and handle wall height adjustments
     */
    handleKeyDown(event) {
        if (event.key === "Control") {
            this.isCtrlPressed = true;
            this.updateWallPreviewMaterial();
        } else if (event.key === "1") {
            this.setWallHeight(this.wallHeight - 1);
        } else if (event.key === "2") {
            this.setWallHeight(this.wallHeight + 1);
        } else if (event.key === "Escape") {
            this.removeWallPreview();
            this.wallStartPosition = null;
        }
    }
    /**
     * Handle key up events for the tool
     */
    handleKeyUp(event) {
        if (event.key === "Control") {
            console.log("WallTool: Ctrl released, switching to build mode");
            this.isCtrlPressed = false;
            this.updateWallPreviewMaterial();
        }
    }
    /**
     * Place a wall on the terrain
     * @param {THREE.Vector3} startPos - The starting position of the wall
     * @param {THREE.Vector3} endPos - The ending position of the wall
     * @param {number} height - The height of the wall
     * @returns {boolean} True if the wall was placed, false otherwise
     */
    placeWall(startPos, endPos, height) {
        console.log(
            "WallTool: Placing wall from",
            startPos,
            "to",
            endPos,
            "with height",
            height
        );
        if (!startPos || !endPos) {
            console.error("Invalid start or end position for wall placement");
            return false;
        }

        if (!this.terrainBuilderRef || !this.terrainBuilderRef.current) {
            console.error(
                "WallTool: Cannot place wall - terrainBuilderRef not available"
            );
            return false;
        }

        if (!this.currentBlockTypeRef || !this.currentBlockTypeRef.current) {
            console.error("WallTool: currentBlockTypeRef is null – no block selected");
            return false;
        }
        const blockTypeId = this.currentBlockTypeRef.current.id;

        const points = this.getLinePoints(
            Math.round(startPos.x),
            Math.round(startPos.z),
            Math.round(endPos.x),
            Math.round(endPos.z)
        );

        console.time("WallTool-placeWall");

        const addedBlocks = {};
        const baseY = Math.round(startPos.y);

        for (const point of points) {
            const [x, z] = point;
            for (let y = 0; y < height; y++) {
                const posKey = `${x},${baseY + y},${z}`;

                if (this.terrainRef.current[posKey] || this.environmentBuilderRef.current.hasInstanceAtPosition(posKey)) continue;

                addedBlocks[posKey] = blockTypeId;
                this.pendingChangesRef.current.terrain.added[posKey] = blockTypeId;
                delete this.pendingChangesRef.current.terrain.removed[posKey];
            }
        }

        if (Object.keys(addedBlocks).length === 0) {
            console.warn(
                "WallTool: No blocks were added during wall placement"
            );
            return false;
        }
        console.log(
            `WallTool: Adding ${Object.keys(addedBlocks).length
            } blocks in batch`
        );

        Object.entries(addedBlocks).forEach(([posKey, blockId]) => {
            this.terrainRef.current[posKey] = blockId;
        });

        this.terrainBuilderRef.current.updateTerrainBlocks(addedBlocks, {});

        const addedBlocksArray = Object.entries(addedBlocks).map(
            ([posKey, blockId]) => {
                const [x, y, z] = posKey.split(",").map(Number);
                return {
                    id: blockId,
                    position: [x, y, z],
                };
            }
        );

        if (this.terrainBuilderRef.current.updateSpatialHashForBlocks) {
            console.log(
                "WallTool: Explicitly updating spatial hash after placement"
            );
            this.terrainBuilderRef.current.updateSpatialHashForBlocks(
                addedBlocksArray,
                [],
                { force: true }
            );
        }

        if (this.placementChangesRef) {
            console.log(
                "WallTool: Adding placed blocks to placementChangesRef"
            );
            Object.entries(addedBlocks).forEach(([key, value]) => {
                this.placementChangesRef.current.terrain.added[key] = value;
            });

            const added = Object.keys(
                this.placementChangesRef.current.terrain.added
            ).length;
            const removed = Object.keys(
                this.placementChangesRef.current.terrain.removed
            ).length;
            console.log(
                `WallTool: placementChangesRef now has ${added} added and ${removed} removed blocks`
            );
        }
        console.timeEnd("WallTool-placeWall");
        return true;
    }
    /**
     * Erase a wall from the terrain
     * @param {THREE.Vector3} startPos - The starting position of the wall
     * @param {THREE.Vector3} endPos - The ending position of the wall
     * @param {number} height - The height of the wall
     * @returns {boolean} True if the wall was erased, false otherwise
     */
    eraseWall(startPos, endPos, height) {
        console.log(
            "WallTool: Erasing wall from",
            startPos,
            "to",
            endPos,
            "with height",
            height
        );
        if (!startPos || !endPos) {
            console.error("Invalid start or end position for erasing");
            return false;
        }

        if (!this.terrainBuilderRef || !this.terrainBuilderRef.current) {
            console.error(
                "WallTool: Cannot erase wall - terrainBuilderRef not available"
            );
            return false;
        }

        if (!this.currentBlockTypeRef || !this.currentBlockTypeRef.current) {
            console.error("WallTool: currentBlockTypeRef is null – no block selected");
            return false;
        }

        const points = this.getLinePoints(
            Math.round(startPos.x),
            Math.round(startPos.z),
            Math.round(endPos.x),
            Math.round(endPos.z)
        );

        console.time("WallTool-eraseWall");

        const removedBlocks = {};
        const baseY = Math.round(startPos.y);

        for (const point of points) {
            const [x, z] = point;
            for (let y = 0; y < height; y++) {
                const posKey = `${x},${baseY + y},${z}`;

                if (!this.terrainRef.current[posKey]) continue;

                removedBlocks[posKey] = this.terrainRef.current[posKey];
            }
        }

        if (Object.keys(removedBlocks).length === 0) {
            console.warn(
                "WallTool: No blocks were found to remove during wall erasure"
            );
            return false;
        }
        console.log(
            `WallTool: Removing ${Object.keys(removedBlocks).length
            } blocks in batch`
        );

        Object.keys(removedBlocks).forEach((posKey) => {
            delete this.terrainRef.current[posKey];
        });

        this.terrainBuilderRef.current.updateTerrainBlocks({}, removedBlocks);

        const removedBlocksArray = Object.entries(removedBlocks).map(
            ([posKey, blockId]) => {
                const [x, y, z] = posKey.split(",").map(Number);
                return {
                    id: 0, // Use 0 for removed blocks
                    position: [x, y, z],
                };
            }
        );

        if (this.terrainBuilderRef.current.updateSpatialHashForBlocks) {
            console.log(
                "WallTool: Explicitly updating spatial hash after erasure"
            );
            this.terrainBuilderRef.current.updateSpatialHashForBlocks(
                [],
                removedBlocksArray,
                { force: true }
            );
        }

        if (this.placementChangesRef) {
            Object.entries(removedBlocks).forEach(([key, value]) => {
                this.placementChangesRef.current.terrain.removed[key] = value;
            });



        }
        console.timeEnd("WallTool-eraseWall");
        return true;
    }
    /**
     * Updates the wall preview visualization
     */
    updateWallPreview(startPos, endPos) {

        if (!startPos || !endPos) {
            return;
        }

        this.removeWallPreview();

        if (startPos.equals(endPos)) return;
        console.time("WallTool-updateWallPreview");

        const points = this.getLinePoints(
            Math.round(startPos.x),
            Math.round(startPos.z),
            Math.round(endPos.x),
            Math.round(endPos.z)
        );

        const totalBlocks = points.length * this.wallHeight;

        if (totalBlocks > 0) {

            const previewGeometry = new THREE.BoxGeometry(1, 1, 1);

            const previewMaterial = new THREE.MeshBasicMaterial({
                color: this.isCtrlPressed ? 0xff4e4e : 0x4e8eff, // Red for erase, blue for add
                transparent: true,
                opacity: 0.5,
                wireframe: false,
            });

            const instancedMesh = new THREE.InstancedMesh(
                previewGeometry,
                previewMaterial,
                totalBlocks
            );
            instancedMesh.frustumCulled = false; // Disable frustum culling for preview

            let instanceIndex = 0;
            const baseY = Math.round(startPos.y);
            const matrix = new THREE.Matrix4();

            for (const point of points) {
                const [x, z] = point;
                for (let y = 0; y < this.wallHeight; y++) {
                    matrix.setPosition(x, baseY + y, z);
                    instancedMesh.setMatrixAt(instanceIndex++, matrix);
                }
            }

            instancedMesh.instanceMatrix.needsUpdate = true;

            this.wallPreview = instancedMesh;

            if (this.scene) {
                this.scene.add(this.wallPreview);
            }
        }
        console.timeEnd("WallTool-updateWallPreview");
    }
    /**
     * Updates the wall preview material based on current mode (add or erase)
     */
    updateWallPreviewMaterial() {

        if (!this.wallPreview) {
            return;
        }

        const color = this.isCtrlPressed ? 0xff4e4e : 0x4e8eff;

        if (this.wallPreview.isInstancedMesh) {
            (this.wallPreview.material as THREE.MeshBasicMaterial)?.color.set(color);
        }

        else if (this.wallPreview.children) {

            this.wallPreview.children.forEach((mesh) => {
                if (mesh && (mesh as THREE.Mesh).material) {
                    ((mesh as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(color);
                }
            });
        }
    }
    /**
     * Removes the wall preview from the scene
     */
    removeWallPreview() {

        if (this.scene && this.wallPreview) {
            this.scene.remove(this.wallPreview);

            if (this.wallPreview.geometry) {
                this.wallPreview.geometry.dispose();
            }
            if (this.wallPreview.material) {

                if (Array.isArray(this.wallPreview.material)) {
                    this.wallPreview.material.forEach((mat) => mat.dispose());
                } else {
                    this.wallPreview.material.dispose();
                }
            }
            this.wallPreview = null;
        } else if (this.wallPreview) {
            console.warn(
                "WallTool: Tried to remove wall preview, but scene is not available."
            );

            this.wallPreview = null;
        }
    }
    /**
     * Cleans up resources when the tool is disposed
     */
    dispose() {
        console.log("WallTool: disposing resources");


        this.removeWallPreview();

        this.terrainRef = null;
        this.currentBlockTypeRef = null;
        this.scene = null;
        this.wallStartPosition = null;
        this.wallPreviewMeshes = [];
        this.toolManagerRef = null;
        this.terrainBuilderRef = null;

        super.dispose();
    }

    placeColumn(x, z, baseY, height, addedBlocksTracker) {

        const blockTypeId = this.currentBlockTypeRef.current.id;

        baseY = Math.round(baseY);
        for (let y = 0; y < height; y++) {
            const posKey = `${x},${baseY + y},${z}`;

            if (this.terrainRef.current[posKey]) continue;

            this.terrainRef.current[posKey] = blockTypeId;

            if (addedBlocksTracker) {
                addedBlocksTracker[posKey] = blockTypeId;
            }
        }
    }

    getLinePoints(x0, z0, x1, z1) {
        const points = [];
        const dx = Math.abs(x1 - x0);
        const dz = Math.abs(z1 - z0);
        const sx = x0 < x1 ? 1 : -1;
        const sz = z0 < z1 ? 1 : -1;
        let err = dx - dz;
        while (true) {
            points.push([x0, z0]);
            if (x0 === x1 && z0 === z1) break;
            const e2 = 2 * err;
            if (e2 > -dz) {
                err -= dz;
                x0 += sx;
            }
            if (e2 < dx) {
                err += dx;
                z0 += sz;
            }
        }
        return points;
    }
}
export default WallTool;
