/**
 * GroundTool.js - Tool for placing ground areas in the world editor
 *
 * This tool handles ground placement, previewing, and manipulation.
 */
import * as THREE from "three";
import BaseTool from "./BaseTool";
class GroundTool extends BaseTool {
    /**
     * Creates a new GroundTool instance
     */
    groundHeight = 1;
    isCircleShape = false; // false = square, true = circle
    groundEdgeDepth = 0; // 0 = solid, >=1 = hollow with specified wall thickness
    isCtrlPressed = false;
    groundStartPosition = null;
    groundPreview = null;

    terrainRef = null;
    currentBlockTypeRef = null;
    scene = null;
    toolManagerRef = null;
    terrainBuilderRef = null;
    undoRedoManager = null;
    placementChangesRef = null;
    isPlacingRef = null;
    previewPositionRef = null;
    pendingChangesRef = null;
    environmentBuilderRef = null;
    constructor(terrainBuilderProps) {
        super(terrainBuilderProps);

        this.name = "GroundTool";
        this.tooltip =
            "Ground Tool: Click to start, click again to place. Use 1 | 2 to adjust height. Use 5 to toggle rounded edges. Use 3 | 4 to adjust hollowness. Hold Ctrl to erase. Press Escape to cancel.";
        this.groundHeight = 1;
        this.isCircleShape = false;
        this.groundEdgeDepth = 0;
        this.groundStartPosition = null;
        this.groundPreview = null;

        if (terrainBuilderProps) {
            this.terrainRef = terrainBuilderProps.terrainRef;
            this.currentBlockTypeRef = terrainBuilderProps.currentBlockTypeRef;
            this.scene = terrainBuilderProps.scene;
            this.toolManagerRef = terrainBuilderProps.toolManagerRef;
            this.terrainBuilderRef = terrainBuilderProps.terrainBuilderRef;
            this.environmentBuilderRef = terrainBuilderProps.environmentBuilderRef;
            this.pendingChangesRef = terrainBuilderProps.pendingChangesRef;
            this.undoRedoManager = terrainBuilderProps.undoRedoManager;
            this.placementChangesRef = terrainBuilderProps.placementChangesRef;
            this.isPlacingRef = terrainBuilderProps.isPlacingRef;
            this.previewPositionRef = terrainBuilderProps.previewPositionRef;
        } else {
            console.error(
                "GroundTool: terrainBuilderProps is undefined in constructor"
            );
        }
    }

    onActivate(activationData) {
        super.onActivate(activationData);

        if (this.terrainRef && !this.terrainRef.current) {
            this.terrainRef.current = {};
        }

        this.groundStartPosition = null;
        this.removeGroundPreview();

        if (this.isPlacingRef) {
            this.isPlacingRef.current = false;
        }

        if (this.placementChangesRef) {
            this.placementChangesRef.current = {
                terrain: { added: {}, removed: {} },
                environment: { added: [], removed: [] },
            };
        }
        return true; // Indicate successful activation
    }
    onDeactivate() {
        super.onDeactivate();
        this.removeGroundPreview();
        this.groundStartPosition = null;
        // Ensure global placing state is reset in case the tool is deactivated mid-action
        if (this.isPlacingRef) {
            this.isPlacingRef.current = false;
        }
        // Clear any in-progress placement records to avoid leaking into other tools / default mode
        if (this.placementChangesRef) {
            this.placementChangesRef.current = {
                terrain: { added: {}, removed: {} },
                environment: { added: [], removed: [] },
            };
        }
    }
    /**
     * Handles mouse down events for ground placement
     */
    handleMouseDown(event, position, button) {
        if (!this.previewPositionRef || !this.previewPositionRef.current) {
            console.error(
                "GroundTool: previewPositionRef is undefined in handleMouseDown"
            );
            return;
        }

        const currentPosition = this.previewPositionRef.current;

        if (button === 0) {
            if (this.groundStartPosition) {
                if (!this.terrainRef) {
                    console.error(
                        "GroundTool: terrainRef is undefined when attempting to place ground"
                    );
                    this.groundStartPosition = null;
                    this.removeGroundPreview();
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
                        "GroundTool: placementChangesRef is not available, changes won't be tracked for undo/redo"
                    );
                }

                let actionPerformed = false;
                if (this.isCtrlPressed) {
                    actionPerformed = this.eraseGround(
                        this.groundStartPosition,
                        currentPosition
                    ); // Use accurate position
                } else {
                    actionPerformed = this.placeGround(
                        this.groundStartPosition,
                        currentPosition
                    ); // Use accurate position
                }
                if (!actionPerformed) {
                    console.warn("GroundTool: Ground action failed");
                    return;
                }

                if (this.placementChangesRef) {
                    const changes = this.placementChangesRef.current;

                    const hasChanges =
                        Object.keys(changes.terrain.added).length > 0 ||
                        Object.keys(changes.terrain.removed).length > 0;
                    if (hasChanges) {
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
                                "GroundTool: No undoRedoManager available, changes won't be tracked for undo/redo"
                            );
                        }

                        this.placementChangesRef.current = {
                            terrain: { added: {}, removed: {} },
                            environment: { added: [], removed: [] },
                        };
                    } else {
                        console.warn("GroundTool: No changes to save");
                    }
                } else {
                    console.warn(
                        "GroundTool: placementChangesRef not available, changes won't be tracked for undo/redo"
                    );
                }

                this.groundStartPosition = null;
                this.removeGroundPreview();

                if (this.isPlacingRef) {
                    this.isPlacingRef.current = false;
                }
            } else {
                console.log("Setting ground start position:", currentPosition); // Use accurate position
                this.groundStartPosition = currentPosition.clone();

                if (this.placementChangesRef) {
                    this.placementChangesRef.current = {
                        terrain: { added: {}, removed: {} },
                        environment: { added: [], removed: [] },
                    };

                    if (this.isPlacingRef) {
                        this.isPlacingRef.current = true;
                    }
                } else {
                    console.warn(
                        "GroundTool: placementChangesRef not available at ground start"
                    );
                }
            }
        }
    }
    /**
     * Handles mouse move events for ground preview
     */
    handleMouseMove(event, position) {
        if (
            this.groundStartPosition &&
            this.previewPositionRef &&
            this.previewPositionRef.current
        ) {
            this.updateGroundPreview(
                this.groundStartPosition,
                this.previewPositionRef.current
            );
        }
    }
    /**
     * Track Ctrl key state for erasing and handle ground height adjustments
     */
    handleKeyDown(event) {
        if (event.key === "Control") {
            this.isCtrlPressed = !this.isCtrlPressed; // toggle mode
            this.updateGroundPreviewMaterial();
        } else if (event.key === "1") {
            this.setGroundHeight(this.groundHeight - 1);
        } else if (event.key === "2") {
            this.setGroundHeight(this.groundHeight + 1);
        } else if (event.key === "3") {
            this.setGroundEdgeDepth(this.groundEdgeDepth - 1);
        } else if (event.key === "4") {
            this.setGroundEdgeDepth(this.groundEdgeDepth + 1);
        } else if (event.key === "5") {
            this.toggleShape();
        } else if (event.key === "Escape") {
            this.removeGroundPreview();
            this.groundStartPosition = null;
        }
    }
    /**
     * Handle key up events for the tool
     */
    handleKeyUp(event) {
        // no-op for Control now (toggle handled on keydown)
    }
    /**
     * Updates the ground height
     */
    setGroundHeight(height) {
        this.groundHeight = Math.max(1, height);

        if (
            this.groundStartPosition &&
            this.previewPositionRef &&
            this.previewPositionRef.current
        ) {
            this.updateGroundPreview(
                this.groundStartPosition,
                this.previewPositionRef.current
            );
        }
    }

    toggleShape() {
        this.isCircleShape = !this.isCircleShape;
        if (
            this.groundStartPosition &&
            this.previewPositionRef &&
            this.previewPositionRef.current
        ) {
            this.updateGroundPreview(
                this.groundStartPosition,
                this.previewPositionRef.current
            );
        }
    }

    /**
     * Determine if a point is on the ground wall based on hollowness.
     */
    isInGroundWall(
        x: number,
        z: number,
        minX: number,
        maxX: number,
        minZ: number,
        maxZ: number,
        edgeDepth: number,
        isCircle = false
    ) {
        if (edgeDepth <= 0) {
            // Solid fill behaves like original isInGroundShape
            if (!isCircle) {
                return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
            }
            const width = maxX - minX + 1;
            const length = maxZ - minZ + 1;
            const centerX = minX + width / 2;
            const centerZ = minZ + length / 2;
            const dx = x - centerX;
            const dz = z - centerZ;
            const distSquared = dx * dx + dz * dz;
            const radius = Math.min(width, length) / 2;
            return distSquared <= radius * radius;
        }

        // Hollow walls determination
        const width = maxX - minX + 1;
        const length = maxZ - minZ + 1;

        if (!isCircle) {
            const distFromLeft = x - minX;
            const distFromRight = maxX - x;
            const distFromTop = z - minZ;
            const distFromBottom = maxZ - z;

            return (
                distFromLeft < edgeDepth ||
                distFromRight < edgeDepth ||
                distFromTop < edgeDepth ||
                distFromBottom < edgeDepth
            );
        } else {
            const centerX = minX + width / 2;
            const centerZ = minZ + length / 2;
            const dx = x - centerX;
            const dz = z - centerZ;
            const distSquared = dx * dx + dz * dz;
            const radius = Math.min(width, length) / 2;

            const outerRadiusSquared = radius * radius;
            const innerRadius = Math.max(0, radius - edgeDepth);
            const innerRadiusSquared = innerRadius * innerRadius;

            return distSquared <= outerRadiusSquared && distSquared >= innerRadiusSquared;
        }
    }
    /**
     * Place ground on the terrain
     * @param {THREE.Vector3} startPos - The starting position of the ground area
     * @param {THREE.Vector3} endPos - The ending position of the ground area
     * @returns {boolean} True if the ground was placed, false otherwise
     */
    placeGround(startPos, endPos) {
        if (!startPos || !endPos) {
            console.error("Invalid start or end position for ground placement");
            return false;
        }

        if (!this.terrainBuilderRef || !this.terrainBuilderRef.current) {
            console.error(
                "GroundTool: Cannot place ground - terrainBuilderRef not available"
            );
            return false;
        }

        if (!this.currentBlockTypeRef || !this.currentBlockTypeRef.current) {
            console.error("GroundTool: currentBlockTypeRef is null – no block selected");
            return false;
        }

        const blockTypeId = this.currentBlockTypeRef.current.id;

        const minX = Math.min(Math.round(startPos.x), Math.round(endPos.x));
        const maxX = Math.max(Math.round(startPos.x), Math.round(endPos.x));
        const minZ = Math.min(Math.round(startPos.z), Math.round(endPos.z));
        const maxZ = Math.max(Math.round(startPos.z), Math.round(endPos.z));
        const baseY = Math.round(startPos.y);

        console.time("GroundTool-placeGround");

        const addedBlocks = {};

        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                if (
                    this.isInGroundWall(
                        x,
                        z,
                        minX,
                        maxX,
                        minZ,
                        maxZ,
                        this.groundEdgeDepth,
                        this.isCircleShape
                    )
                ) {
                    for (let y = 0; y < this.groundHeight; y++) {
                        const posKey = `${x},${baseY + y},${z}`;

                        if (this.terrainRef.current[posKey] || this.environmentBuilderRef.current.hasInstanceAtPosition(posKey)) continue;

                        addedBlocks[posKey] = blockTypeId;
                        this.pendingChangesRef.current.terrain.added[posKey] = blockTypeId;
                        delete this.pendingChangesRef.current.terrain.removed[posKey];
                    }
                }
            }
        }

        if (Object.keys(addedBlocks).length === 0) {
            console.warn(
                "GroundTool: No blocks were added during ground placement"
            );
            return false;
        }

        Object.entries(addedBlocks).forEach(([posKey, blockId]) => {
            this.terrainRef.current[posKey] = blockId;
        });

        this.terrainBuilderRef.current.updateTerrainBlocks(
            addedBlocks,
            {},
            { skipUndoSave: true }
        );

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
                "GroundTool: Explicitly updating spatial hash after placement"
            );
            this.terrainBuilderRef.current.updateSpatialHashForBlocks(
                addedBlocksArray,
                [],
                { force: true }
            );
        }

        if (this.placementChangesRef) {
            console.log(
                "GroundTool: Adding placed blocks to placementChangesRef"
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
                `GroundTool: placementChangesRef now has ${added} added and ${removed} removed blocks`
            );
        }
        console.timeEnd("GroundTool-placeGround");
        return true;
    }
    /**
     * Erase ground from the terrain
     * @param {THREE.Vector3} startPos - The starting position of the ground area
     * @param {THREE.Vector3} endPos - The ending position of the ground area
     * @returns {boolean} True if the ground was erased, false otherwise
     */
    eraseGround(startPos, endPos) {
        console.log(
            "GroundTool: Erasing ground from",
            startPos,
            "to",
            endPos,
            "with height",
            this.groundHeight,
            "and sides",
            this.isCircleShape
        );
        if (!startPos || !endPos) {
            console.error("Invalid start or end position for erasing");
            return false;
        }

        if (!this.terrainBuilderRef || !this.terrainBuilderRef.current) {
            console.error(
                "GroundTool: Cannot erase ground - terrainBuilderRef not available"
            );
            return false;
        }

        const minX = Math.min(Math.round(startPos.x), Math.round(endPos.x));
        const maxX = Math.max(Math.round(startPos.x), Math.round(endPos.x));
        const minZ = Math.min(Math.round(startPos.z), Math.round(endPos.z));
        const maxZ = Math.max(Math.round(startPos.z), Math.round(endPos.z));
        const baseY = Math.round(startPos.y);

        console.time("GroundTool-eraseGround");

        const removedBlocks = {};

        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                if (
                    this.isInGroundWall(
                        x,
                        z,
                        minX,
                        maxX,
                        minZ,
                        maxZ,
                        this.groundEdgeDepth,
                        this.isCircleShape
                    )
                ) {
                    for (let y = 0; y < this.groundHeight; y++) {
                        const posKey = `${x},${baseY + y},${z}`;

                        if (!this.terrainRef.current[posKey]) continue;

                        const blockId = this.terrainRef.current[posKey];
                        removedBlocks[posKey] = blockId;
                        this.pendingChangesRef.current.terrain.removed[posKey] = blockId;
                        delete this.pendingChangesRef.current.terrain.added[posKey];
                    }
                }
            }
        }

        if (Object.keys(removedBlocks).length === 0) {
            console.warn(
                "GroundTool: No blocks were found to remove during ground erasure"
            );
            return false;
        }
        console.log(
            `GroundTool: Removing ${Object.keys(removedBlocks).length
            } blocks in batch`
        );

        Object.keys(removedBlocks).forEach((posKey) => {
            delete this.terrainRef.current[posKey];
        });

        this.terrainBuilderRef.current.updateTerrainBlocks({}, removedBlocks, {
            skipUndoSave: true,
        });

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
                "GroundTool: Explicitly updating spatial hash after erasure"
            );
            this.terrainBuilderRef.current.updateSpatialHashForBlocks(
                [],
                removedBlocksArray,
                { force: true }
            );
        }

        if (this.placementChangesRef) {
            console.log(
                "GroundTool: Adding removed blocks to placementChangesRef"
            );
            Object.entries(removedBlocks).forEach(([key, value]) => {
                this.placementChangesRef.current.terrain.removed[key] = value;
            });

            const added = Object.keys(
                this.placementChangesRef.current.terrain.added
            ).length;
            const removed = Object.keys(
                this.placementChangesRef.current.terrain.removed
            ).length;
            console.log(
                `GroundTool: placementChangesRef now has ${added} added and ${removed} removed blocks`
            );
        }
        console.timeEnd("GroundTool-eraseGround");
        return true;
    }
    /**
     * Updates the ground preview visualization
     */
    updateGroundPreview(startPos, endPos) {
        if (!startPos || !endPos) {
            return;
        }

        this.removeGroundPreview();

        if (startPos.equals(endPos)) return;
        console.time("GroundTool-updateGroundPreview");

        const minX = Math.min(Math.round(startPos.x), Math.round(endPos.x));
        const maxX = Math.max(Math.round(startPos.x), Math.round(endPos.x));
        const minZ = Math.min(Math.round(startPos.z), Math.round(endPos.z));
        const maxZ = Math.max(Math.round(startPos.z), Math.round(endPos.z));
        const baseY = Math.round(startPos.y);

        let totalBlocks = 0;
        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                if (
                    this.isInGroundWall(
                        x,
                        z,
                        minX,
                        maxX,
                        minZ,
                        maxZ,
                        this.groundEdgeDepth,
                        this.isCircleShape
                    )
                ) {
                    totalBlocks += this.groundHeight;
                }
            }
        }

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
            const matrix = new THREE.Matrix4();

            for (let x = minX; x <= maxX; x++) {
                for (let z = minZ; z <= maxZ; z++) {
                    if (
                        this.isInGroundWall(
                            x,
                            z,
                            minX,
                            maxX,
                            minZ,
                            maxZ,
                            this.groundEdgeDepth,
                            this.isCircleShape
                        )
                    ) {
                        for (let y = 0; y < this.groundHeight; y++) {
                            matrix.setPosition(x, baseY + y, z);
                            instancedMesh.setMatrixAt(instanceIndex++, matrix);
                        }
                    }
                }
            }

            instancedMesh.instanceMatrix.needsUpdate = true;

            this.groundPreview = instancedMesh;

            if (this.scene) {
                this.scene.add(this.groundPreview);
            }
        }
        console.timeEnd("GroundTool-updateGroundPreview");
    }
    /**
     * Updates the ground preview material based on current mode (add or erase)
     */
    updateGroundPreviewMaterial() {
        if (!this.groundPreview) {
            return;
        }

        const color = this.isCtrlPressed ? 0xff4e4e : 0x4e8eff;

        if (this.groundPreview.isInstancedMesh) {
            this.groundPreview.material.color.set(color);
        }
    }
    /**
     * Removes the ground preview from the scene
     */
    removeGroundPreview() {
        if (this.groundPreview) {
            this.scene.remove(this.groundPreview);
            this.groundPreview = null;
        }
    }
    /**
     * Cleans up resources when the tool is disposed
     */
    dispose() {
        console.log("GroundTool: disposing resources");

        this.removeGroundPreview();

        this.terrainRef = null;
        this.currentBlockTypeRef = null;
        this.scene = null;
        this.groundStartPosition = null;
        this.toolManagerRef = null;
        this.terrainBuilderRef = null;

        super.dispose();
    }

    setGroundEdgeDepth(depth) {
        this.groundEdgeDepth = Math.max(0, depth);

        if (
            this.groundStartPosition &&
            this.previewPositionRef &&
            this.previewPositionRef.current
        ) {
            this.updateGroundPreview(
                this.groundStartPosition,
                this.previewPositionRef.current
            );
        }
    }
}

export default GroundTool;
