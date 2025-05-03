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
    groundSides = 4; // Number of sides (4 = square, 5 = pentagon, etc.)
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

    constructor(terrainBuilderProps) {
        

        console.log("GroundTool initialized");
        super(terrainBuilderProps);

        this.name = "GroundTool";
        this.tooltip =
            "Ground Tool: Click to start, click again to place. Use 1 | 2 to adjust height. Use 5 | 6 to change number of sides (4-8). Hold Ctrl to erase. Press Q to cancel.";
        this.groundHeight = 1;
        this.groundSides = 4; // Number of sides (4 = square, 5 = pentagon, etc.)
        this.isCtrlPressed = false;
        this.groundStartPosition = null;
        this.groundPreview = null;

        if (terrainBuilderProps) {
            this.terrainRef = terrainBuilderProps.terrainRef;
            this.currentBlockTypeRef = terrainBuilderProps.currentBlockTypeRef;
            this.scene = terrainBuilderProps.scene;
            this.toolManagerRef = terrainBuilderProps.toolManagerRef;
            this.terrainBuilderRef = terrainBuilderProps.terrainBuilderRef;

            this.undoRedoManager = terrainBuilderProps.undoRedoManager;
            console.log(
                "GroundTool: Got undoRedoManager reference:",
                !!this.undoRedoManager
            );
            console.log(
                "GroundTool: undoRedoManager is ref:",
                this.undoRedoManager && "current" in this.undoRedoManager
            );
            console.log(
                "GroundTool: undoRedoManager.current exists:",
                this.undoRedoManager && !!this.undoRedoManager.current
            );
            console.log(
                "GroundTool: undoRedoManager.current has saveUndo:",
                this.undoRedoManager &&
                    this.undoRedoManager.current &&
                    typeof this.undoRedoManager.current.saveUndo === "function"
            );

            this.placementChangesRef = terrainBuilderProps.placementChangesRef;
            this.isPlacingRef = terrainBuilderProps.isPlacingRef;
            console.log(
                "GroundTool: Got placementChangesRef:",
                !!this.placementChangesRef
            );
            console.log("GroundTool: Got isPlacingRef:", !!this.isPlacingRef);

            this.previewPositionRef = terrainBuilderProps.previewPositionRef;
        } else {
            console.error(
                "GroundTool: terrainBuilderProps is undefined in constructor"
            );
        }
    }
    
    onActivate(activationData) {
        super.onActivate(activationData);

        console.log("GroundTool activated");

        if (this.terrainRef && !this.terrainRef.current) {
            console.log("Initializing empty terrainRef.current in onActivate");
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
                    console.log(
                        "GroundTool: terrainRef.current is undefined, initializing empty object"
                    );
                    this.terrainRef.current = {};
                }

                if (this.isPlacingRef) {
                    console.log(
                        "GroundTool: Setting isPlacingRef to true (directly)"
                    );
                    this.isPlacingRef.current = true;
                }

                if (this.placementChangesRef) {
                    console.log(
                        "GroundTool: Ensuring placementChangesRef is initialized (directly)"
                    );
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

                console.log("GroundTool: Saving undo state directly");
                if (this.placementChangesRef) {
                    const changes = this.placementChangesRef.current;

                    const hasChanges =
                        Object.keys(changes.terrain.added).length > 0 ||
                        Object.keys(changes.terrain.removed).length > 0;
                    if (hasChanges) {

                        if (this.undoRedoManager?.current?.saveUndo) {
                            console.log(
                                "GroundTool: Calling saveUndo with undoRedoManager.current"
                            );
                            this.undoRedoManager.current.saveUndo(changes);
                        }

                        else if (
                            this.terrainBuilderRef?.current?.undoRedoManager
                                ?.current?.saveUndo
                        ) {
                            console.log(
                                "GroundTool: Calling saveUndo with terrainBuilderRef fallback"
                            );
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
                    console.log(
                        "GroundTool: Setting isPlacingRef to false (directly)"
                    );
                    this.isPlacingRef.current = false;
                }
            } else {

                console.log("Setting ground start position:", currentPosition); // Use accurate position
                this.groundStartPosition = currentPosition.clone();

                if (this.placementChangesRef) {
                    console.log(
                        "GroundTool: Initializing placementChangesRef for new ground area (directly)"
                    );
                    this.placementChangesRef.current = {
                        terrain: { added: {}, removed: {} },
                        environment: { added: [], removed: [] },
                    };

                    if (this.isPlacingRef) {
                        console.log(
                            "GroundTool: Setting isPlacingRef to true for new ground area (directly)"
                        );
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
            console.log("GroundTool: Ctrl pressed, switching to erase mode");
            this.isCtrlPressed = true;
            this.updateGroundPreviewMaterial();
        } else if (event.key === "1") {
            console.log("GroundTool: Decreasing ground height");
            this.setGroundHeight(this.groundHeight - 1);
        } else if (event.key === "2") {
            console.log("GroundTool: Increasing ground height");
            this.setGroundHeight(this.groundHeight + 1);
        } else if (event.key === "5") {
            console.log("GroundTool: Decreasing number of sides");
            this.setGroundSides(this.groundSides - 1);
        } else if (event.key === "6") {
            console.log("GroundTool: Increasing number of sides");
            this.setGroundSides(this.groundSides + 1);
        } else if (event.key === "q") {
            this.removeGroundPreview();
            this.groundStartPosition = null;
        }
    }
    /**
     * Handle key up events for the tool
     */
    handleKeyUp(event) {
        if (event.key === "Control") {
            console.log("GroundTool: Ctrl released, switching to build mode");
            this.isCtrlPressed = false;
            this.updateGroundPreviewMaterial();
        }
    }
    /**
     * Updates the ground height
     */
    setGroundHeight(height) {
        console.log("Setting ground height to:", Math.max(1, height));
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
        } else {
            console.log("Ground preview not updated - missing references:", {
                groundStartPosition: !!this.groundStartPosition,
                previewPositionRef: !!this.previewPositionRef,
                previewPositionRefCurrent:
                    this.previewPositionRef &&
                    !!this.previewPositionRef.current,
            });
        }
    }
    /**
     * Updates the number of sides for the ground shape
     */
    setGroundSides(sides) {

        const newSides = Math.max(4, Math.min(8, sides));
        if (newSides !== this.groundSides) {
            console.log("Setting ground sides to:", newSides);
            this.groundSides = newSides;

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
    /**
     * Checks if a position is within the ground shape based on area dimensions and number of sides
     * @param {number} x - X position to check
     * @param {number} z - Z position to check
     * @param {number} minX - Minimum X of the area
     * @param {number} maxX - Maximum X of the area
     * @param {number} minZ - Minimum Z of the area
     * @param {number} maxZ - Maximum Z of the area
     * @param {number} sides - Number of sides (4 = square, 5+ = polygon)
     * @returns {boolean} True if this position should have a block
     */
    isInGroundShape(x, z, minX, maxX, minZ, maxZ, sides = 4) {

        if (sides === 4) {

            return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
        }

        else {

            const width = maxX - minX + 1;
            const length = maxZ - minZ + 1;

            const centerX = minX + width / 2;
            const centerZ = minZ + length / 2;

            const distFromCenterX = x - centerX;
            const distFromCenterZ = z - centerZ;

            const distSquared =
                distFromCenterX * distFromCenterX +
                distFromCenterZ * distFromCenterZ;

            const radius = Math.min(width / 2, length / 2);

            const outerRadiusSquared = radius * radius;

            if (distSquared > outerRadiusSquared) {
                return false;
            }

            if (sides >= 8) {
                return true;
            }
            /*


			let angle = Math.atan2(distFromCenterZ, distFromCenterX);
			if (angle < 0) angle += Math.PI * 2; // Convert to 0-2π range

			const sectorAngle = (Math.PI * 2) / sides;
			const sectorIndex = Math.floor(angle / sectorAngle);

			const corner1Angle = sectorIndex * sectorAngle;
			const corner2Angle = (sectorIndex + 1) * sectorAngle;

			const corner1X = centerX + radius * Math.cos(corner1Angle);
			const corner1Z = centerZ + radius * Math.sin(corner1Angle);
			const corner2X = centerX + radius * Math.cos(corner2Angle);
			const corner2Z = centerZ + radius * Math.sin(corner2Angle);



			const edgeDistSquared = distanceToLineSegmentSquared(
				x, z, corner1X, corner1Z, corner2X, corner2Z
			);

			const vectorX = distFromCenterX / Math.sqrt(distSquared);
			const vectorZ = distFromCenterZ / Math.sqrt(distSquared);
			*/



            return true;
        }
    }
    /**
     * Place ground on the terrain
     * @param {THREE.Vector3} startPos - The starting position of the ground area
     * @param {THREE.Vector3} endPos - The ending position of the ground area
     * @returns {boolean} True if the ground was placed, false otherwise
     */
    placeGround(startPos, endPos) {
        console.log(
            "GroundTool: Placing ground from",
            startPos,
            "to",
            endPos,
            "with height",
            this.groundHeight,
            "and sides",
            this.groundSides
        );
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
                    this.isInGroundShape(
                        x,
                        z,
                        minX,
                        maxX,
                        minZ,
                        maxZ,
                        this.groundSides
                    )
                ) {

                    for (let y = 0; y < this.groundHeight; y++) {
                        const posKey = `${x},${baseY + y},${z}`;

                        if (this.terrainRef.current[posKey]) continue;

                        addedBlocks[posKey] = blockTypeId;
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
        console.log(
            `GroundTool: Adding ${
                Object.keys(addedBlocks).length
            } blocks in batch`
        );

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
            this.groundSides
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
                    this.isInGroundShape(
                        x,
                        z,
                        minX,
                        maxX,
                        minZ,
                        maxZ,
                        this.groundSides
                    )
                ) {

                    for (let y = 0; y < this.groundHeight; y++) {
                        const posKey = `${x},${baseY + y},${z}`;

                        if (!this.terrainRef.current[posKey]) continue;

                        removedBlocks[posKey] = this.terrainRef.current[posKey];
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
            `GroundTool: Removing ${
                Object.keys(removedBlocks).length
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
                    this.isInGroundShape(
                        x,
                        z,
                        minX,
                        maxX,
                        minZ,
                        maxZ,
                        this.groundSides
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
                        this.isInGroundShape(
                            x,
                            z,
                            minX,
                            maxX,
                            minZ,
                            maxZ,
                            this.groundSides
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
}

export default GroundTool;
