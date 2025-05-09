/**
 * PipeTool.js - Tool for placing hollow pipe-like structures in the world editor
 *
 * This tool handles pipe placement, previewing, and manipulation.
 */
import * as THREE from "three";
import BaseTool from "./BaseTool";
class PipeTool extends BaseTool {
    /**
     * Creates a new PipeTool instance
     */
    pipeHeight: number;
    pipeEdgeDepth: number;
    pipeSides: number;
    isCtrlPressed: boolean;
    pipeStartPosition: THREE.Vector3 | null;
    pipePreview: THREE.InstancedMesh | null;
    terrainRef: React.RefObject<any>;
    currentBlockTypeRef: React.RefObject<any>;
    scene: THREE.Scene;
    toolManagerRef: React.RefObject<any>;
    terrainBuilderRef: React.RefObject<any>;
    undoRedoManager: React.RefObject<any>;
    placementChangesRef: React.RefObject<any>;
    isPlacingRef: React.RefObject<any>;
    previewPositionRef: React.RefObject<any>;
    pendingChangesRef: React.RefObject<any>;
    environmentBuilderRef: React.RefObject<any>;
    constructor(terrainBuilderProps) {
        console.log("PipeTool initialized");
        super(terrainBuilderProps);

        this.name = "PipeTool";
        this.tooltip =
            "Pipe Tool: Click to start, click again to place. Use 1 | 2 to adjust height. Use 3 | 4 to adjust edge depth. Use 5 | 6 to change number of sides (4-8). Hold Ctrl to erase. Press Escape to cancel.";
        this.pipeHeight = 1;
        this.pipeEdgeDepth = 1; // How thick the pipe walls are
        this.pipeSides = 4; // Number of sides (4 = square, 5 = pentagon, etc.)
        this.isCtrlPressed = false;
        this.pipeStartPosition = null;
        this.pipePreview = null;

        if (terrainBuilderProps) {
            this.terrainRef = terrainBuilderProps.terrainRef;
            this.currentBlockTypeRef = terrainBuilderProps.currentBlockTypeRef;
            this.scene = terrainBuilderProps.scene;
            this.toolManagerRef = terrainBuilderProps.toolManagerRef;
            this.terrainBuilderRef = terrainBuilderProps.terrainBuilderRef;

            this.undoRedoManager = terrainBuilderProps.undoRedoManager;

            this.placementChangesRef = terrainBuilderProps.placementChangesRef;
            this.isPlacingRef = terrainBuilderProps.isPlacingRef;
            this.pendingChangesRef = terrainBuilderProps.pendingChangesRef;
            this.previewPositionRef = terrainBuilderProps.previewPositionRef;
            this.environmentBuilderRef = terrainBuilderProps.environmentBuilderRef;
        } else {
            console.error(
                "PipeTool: terrainBuilderProps is undefined in constructor"
            );
        }
    }
    onActivate() {
        super.onActivate();

        console.log("PipeTool activated");

        if (this.terrainRef && !this.terrainRef.current) {
            console.log("Initializing empty terrainRef.current in onActivate");
            this.terrainRef.current = {};
        }

        this.pipeStartPosition = null;
        this.removePipePreview();

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
        this.removePipePreview();
        this.pipeStartPosition = null;
    }
    /**
     * Handles mouse down events for pipe placement
     */
    handleMouseDown(event, position, button) {

        if (!this.previewPositionRef || !this.previewPositionRef.current) {
            console.error(
                "PipeTool: previewPositionRef is undefined in handleMouseDown"
            );
            return;
        }

        const currentPosition = this.previewPositionRef.current;

        if (button === 0) {
            if (this.pipeStartPosition) {

                if (!this.terrainRef) {
                    console.error(
                        "PipeTool: terrainRef is undefined when attempting to place pipe"
                    );
                    this.pipeStartPosition = null;
                    this.removePipePreview();
                    return;
                }
                if (!this.terrainRef.current) {
                    console.log(
                        "PipeTool: terrainRef.current is undefined, initializing empty object"
                    );
                    this.terrainRef.current = {};
                }

                if (this.isPlacingRef) {
                    console.log(
                        "PipeTool: Setting isPlacingRef to true (directly)"
                    );
                    this.isPlacingRef.current = true;
                }

                if (this.placementChangesRef) {
                    console.log(
                        "PipeTool: Ensuring placementChangesRef is initialized (directly)"
                    );
                    this.placementChangesRef.current = {
                        terrain: { added: {}, removed: {} },
                        environment: { added: [], removed: [] },
                    };
                } else {
                    console.warn(
                        "PipeTool: placementChangesRef is not available, changes won't be tracked for undo/redo"
                    );
                }

                let actionPerformed = false;
                if (this.isCtrlPressed) {
                    actionPerformed = this.erasePipe(
                        this.pipeStartPosition,
                        currentPosition
                    ); // Use accurate position
                } else {
                    actionPerformed = this.placePipe(
                        this.pipeStartPosition,
                        currentPosition
                    ); // Use accurate position
                }
                if (!actionPerformed) {
                    console.warn("PipeTool: Pipe action failed");
                    return;
                }

                console.log("PipeTool: Saving undo state directly");
                if (this.placementChangesRef) {
                    const changes = this.placementChangesRef.current;

                    const hasChanges =
                        Object.keys(changes.terrain.added).length > 0 ||
                        Object.keys(changes.terrain.removed).length > 0;
                    if (hasChanges) {

                        if (this.undoRedoManager?.current?.saveUndo) {
                            console.log(
                                "PipeTool: Calling saveUndo with undoRedoManager.current"
                            );
                            this.undoRedoManager.current.saveUndo(changes);
                        }

                        else if (
                            this.terrainBuilderRef?.current?.undoRedoManager
                                ?.current?.saveUndo
                        ) {
                            console.log(
                                "PipeTool: Calling saveUndo with terrainBuilderRef fallback"
                            );
                            this.terrainBuilderRef.current.undoRedoManager.current.saveUndo(
                                changes
                            );
                        } else {
                            console.warn(
                                "PipeTool: No undoRedoManager available, changes won't be tracked for undo/redo"
                            );
                        }

                        this.placementChangesRef.current = {
                            terrain: { added: {}, removed: {} },
                            environment: { added: [], removed: [] },
                        };
                    } else {
                        console.warn("PipeTool: No changes to save");
                    }
                } else {
                    console.warn(
                        "PipeTool: placementChangesRef not available, changes won't be tracked for undo/redo"
                    );
                }

                this.pipeStartPosition = null;
                this.removePipePreview();

                if (this.isPlacingRef) {
                    console.log(
                        "PipeTool: Setting isPlacingRef to false (directly)"
                    );
                    this.isPlacingRef.current = false;
                }
            } else {

                console.log("Setting pipe start position:", currentPosition); // Use accurate position
                this.pipeStartPosition = currentPosition.clone();

                if (this.placementChangesRef) {
                    console.log(
                        "PipeTool: Initializing placementChangesRef for new pipe area (directly)"
                    );
                    this.placementChangesRef.current = {
                        terrain: { added: {}, removed: {} },
                        environment: { added: [], removed: [] },
                    };

                    if (this.isPlacingRef) {
                        console.log(
                            "PipeTool: Setting isPlacingRef to true for new pipe area (directly)"
                        );
                        this.isPlacingRef.current = true;
                    }
                } else {
                    console.warn(
                        "PipeTool: placementChangesRef not available at pipe start"
                    );
                }
            }
        }
    }
    /**
     * Handles mouse move events for pipe preview
     */
    handleMouseMove(event, position) {

        if (
            this.pipeStartPosition &&
            this.previewPositionRef &&
            this.previewPositionRef.current
        ) {
            this.updatePipePreview(
                this.pipeStartPosition,
                this.previewPositionRef.current
            );
        }
    }
    /**
     * Track Ctrl key state for erasing and handle pipe adjustments
     */
    handleKeyDown(event) {
        if (event.key === "Control") {
            console.log("PipeTool: Ctrl pressed, switching to erase mode");
            this.isCtrlPressed = true;
            this.updatePipePreviewMaterial();
        } else if (event.key === "1") {
            console.log("PipeTool: Decreasing pipe height");
            this.setPipeHeight(this.pipeHeight - 1);
        } else if (event.key === "2") {
            console.log("PipeTool: Increasing pipe height");
            this.setPipeHeight(this.pipeHeight + 1);
        } else if (event.key === "3") {
            console.log("PipeTool: Decreasing pipe edge depth");
            this.setPipeEdgeDepth(this.pipeEdgeDepth - 1);
        } else if (event.key === "4") {
            console.log("PipeTool: Increasing pipe edge depth");
            this.setPipeEdgeDepth(this.pipeEdgeDepth + 1);
        } else if (event.key === "5") {
            console.log("PipeTool: Decreasing number of sides");
            this.setPipeSides(this.pipeSides - 1);
        } else if (event.key === "6") {
            console.log("PipeTool: Increasing number of sides");
            this.setPipeSides(this.pipeSides + 1);
        } else if (event.key === "Escape" ) {
            this.removePipePreview();
            this.pipeStartPosition = null;
        }
    }
    /**
     * Handle key up events for the tool
     */
    handleKeyUp(event) {
        if (event.key === "Control") {
            console.log("PipeTool: Ctrl released, switching to build mode");
            this.isCtrlPressed = false;
            this.updatePipePreviewMaterial();
        }
    }
    /**
     * Updates the pipe height
     */
    setPipeHeight(height) {
        console.log("Setting pipe height to:", Math.max(1, height));
        this.pipeHeight = Math.max(1, height);

        if (
            this.pipeStartPosition &&
            this.previewPositionRef &&
            this.previewPositionRef.current
        ) {
            this.updatePipePreview(
                this.pipeStartPosition,
                this.previewPositionRef.current
            );
        }
    }
    /**
     * Updates the pipe edge depth
     */
    setPipeEdgeDepth(depth) {

        console.log("Setting pipe edge depth to:", Math.max(1, depth));
        this.pipeEdgeDepth = Math.max(1, depth);

        if (
            this.pipeStartPosition &&
            this.previewPositionRef &&
            this.previewPositionRef.current
        ) {
            this.updatePipePreview(
                this.pipeStartPosition,
                this.previewPositionRef.current
            );
        }
    }
    /**
     * Updates the number of sides for the pipe
     */
    setPipeSides(sides) {

        const newSides = Math.max(4, Math.min(8, sides));
        if (newSides !== this.pipeSides) {
            console.log("Setting pipe sides to:", newSides);
            this.pipeSides = newSides;

            if (
                this.pipeStartPosition &&
                this.previewPositionRef &&
                this.previewPositionRef.current
            ) {
                this.updatePipePreview(
                    this.pipeStartPosition,
                    this.previewPositionRef.current
                );
            }
        }
    }
    /**
     * Checks if a position is within the pipe walls based on area dimensions, edge depth, and number of sides
     * @param {number} x - X position
     * @param {number} z - Z position
     * @param {number} minX - Minimum X of the area
     * @param {number} maxX - Maximum X of the area
     * @param {number} minZ - Minimum Z of the area
     * @param {number} maxZ - Maximum Z of the area
     * @param {number} edgeDepth - Thickness of pipe walls
     * @param {number} sides - Number of sides (4 = square, 5+ = polygon)
     * @returns {boolean} True if this position should have a block (is part of pipe wall)
     */
    isInPipeWall(x, z, minX, maxX, minZ, maxZ, edgeDepth, sides = 4) {

        const width = maxX - minX + 1;
        const length = maxZ - minZ + 1;

        if (width <= edgeDepth * 2 || length <= edgeDepth * 2) {
            return true;
        }

        const centerX = minX + width / 2;
        const centerZ = minZ + length / 2;

        if (sides === 4) {

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
        }

        else {

            const distFromCenterX = x - centerX;
            const distFromCenterZ = z - centerZ;

            const distSquared =
                distFromCenterX * distFromCenterX +
                distFromCenterZ * distFromCenterZ;


            const radius = Math.min(width / 2, length / 2);

            const outerRadiusSquared = radius * radius;

            const innerRadiusSquared = Math.max(
                0,
                (radius - edgeDepth) * (radius - edgeDepth)
            );

            if (distSquared > outerRadiusSquared) {
                return false;
            }

            if (distSquared < innerRadiusSquared) {
                return false;
            }

            if (sides > 4) {

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
                    x,
                    z,
                    corner1X,
                    corner1Z,
                    corner2X,
                    corner2Z
                );

                return edgeDistSquared < edgeDepth * edgeDepth;
            }

            return true;
        }
    }
    /**
     * Place pipe on the terrain
     * @param {THREE.Vector3} startPos - The starting position of the pipe area
     * @param {THREE.Vector3} endPos - The ending position of the pipe area
     * @returns {boolean} True if the pipe was placed, false otherwise
     */
    placePipe(startPos, endPos) {
        console.log(
            "PipeTool: Placing pipe from",
            startPos,
            "to",
            endPos,
            "with height",
            this.pipeHeight,
            "edge depth",
            this.pipeEdgeDepth,
            "and sides",
            this.pipeSides
        );
        if (!startPos || !endPos) {
            console.error("Invalid start or end position for pipe placement");
            return false;
        }

        if (!this.terrainBuilderRef || !this.terrainBuilderRef.current) {
            console.error(
                "PipeTool: Cannot place pipe - terrainBuilderRef not available"
            );
            return false;
        }

        const blockTypeId = this.currentBlockTypeRef.current.id;

        const minX = Math.min(Math.round(startPos.x), Math.round(endPos.x));
        const maxX = Math.max(Math.round(startPos.x), Math.round(endPos.x));
        const minZ = Math.min(Math.round(startPos.z), Math.round(endPos.z));
        const maxZ = Math.max(Math.round(startPos.z), Math.round(endPos.z));
        const baseY = Math.round(startPos.y);

        console.time("PipeTool-placePipe");

        const addedBlocks = {};

        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {

                if (
                    this.isInPipeWall(
                        x,
                        z,
                        minX,
                        maxX,
                        minZ,
                        maxZ,
                        this.pipeEdgeDepth,
                        this.pipeSides
                    )
                ) {

                    for (let y = 0; y < this.pipeHeight; y++) {
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
                "PipeTool: No blocks were added during pipe placement"
            );
            return false;
        }
        console.log(
            `PipeTool: Adding ${
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
                "PipeTool: Explicitly updating spatial hash after placement"
            );
            this.terrainBuilderRef.current.updateSpatialHashForBlocks(
                addedBlocksArray,
                [],
                { force: true }
            );
        }

        if (this.placementChangesRef) {
            console.log(
                "PipeTool: Adding placed blocks to placementChangesRef"
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
                `PipeTool: placementChangesRef now has ${added} added and ${removed} removed blocks`
            );
        }
        console.timeEnd("PipeTool-placePipe");
        return true;
    }
    /**
     * Erase pipe from the terrain
     * @param {THREE.Vector3} startPos - The starting position of the pipe area
     * @param {THREE.Vector3} endPos - The ending position of the pipe area
     * @returns {boolean} True if the pipe was erased, false otherwise
     */
    erasePipe(startPos, endPos) {
        console.log(
            "PipeTool: Erasing pipe from",
            startPos,
            "to",
            endPos,
            "with height",
            this.pipeHeight,
            "edge depth",
            this.pipeEdgeDepth,
            "and sides",
            this.pipeSides
        );
        if (!startPos || !endPos) {
            console.error("Invalid start or end position for erasing");
            return false;
        }

        if (!this.terrainBuilderRef || !this.terrainBuilderRef.current) {
            console.error(
                "PipeTool: Cannot erase pipe - terrainBuilderRef not available"
            );
            return false;
        }

        const minX = Math.min(Math.round(startPos.x), Math.round(endPos.x));
        const maxX = Math.max(Math.round(startPos.x), Math.round(endPos.x));
        const minZ = Math.min(Math.round(startPos.z), Math.round(endPos.z));
        const maxZ = Math.max(Math.round(startPos.z), Math.round(endPos.z));
        const baseY = Math.round(startPos.y);

        console.time("PipeTool-erasePipe");

        const removedBlocks = {};

        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {

                if (
                    this.isInPipeWall(
                        x,
                        z,
                        minX,
                        maxX,
                        minZ,
                        maxZ,
                        this.pipeEdgeDepth,
                        this.pipeSides
                    )
                ) {

                    for (let y = 0; y < this.pipeHeight; y++) {
                        const posKey = `${x},${baseY + y},${z}`;

                        if (!this.terrainRef.current[posKey]) continue;

                        removedBlocks[posKey] = this.terrainRef.current[posKey];
                    }
                }
            }
        }

        if (Object.keys(removedBlocks).length === 0) {
            console.warn(
                "PipeTool: No blocks were found to remove during pipe erasure"
            );
            return false;
        }
        console.log(
            `PipeTool: Removing ${
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
                "PipeTool: Explicitly updating spatial hash after erasure"
            );
            this.terrainBuilderRef.current.updateSpatialHashForBlocks(
                [],
                removedBlocksArray,
                { force: true }
            );
        }

        if (this.placementChangesRef) {
            console.log(
                "PipeTool: Adding removed blocks to placementChangesRef"
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
                `PipeTool: placementChangesRef now has ${added} added and ${removed} removed blocks`
            );
        }
        console.timeEnd("PipeTool-erasePipe");
        return true;
    }
    /**
     * Updates the pipe preview visualization
     */
    updatePipePreview(startPos, endPos) {

        if (!startPos || !endPos) {
            return;
        }

        this.removePipePreview();

        if (startPos.equals(endPos)) return;
        console.time("PipeTool-updatePipePreview");

        const minX = Math.min(Math.round(startPos.x), Math.round(endPos.x));
        const maxX = Math.max(Math.round(startPos.x), Math.round(endPos.x));
        const minZ = Math.min(Math.round(startPos.z), Math.round(endPos.z));
        const maxZ = Math.max(Math.round(startPos.z), Math.round(endPos.z));
        const baseY = Math.round(startPos.y);

        let totalBlocks = 0;
        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                if (
                    this.isInPipeWall(
                        x,
                        z,
                        minX,
                        maxX,
                        minZ,
                        maxZ,
                        this.pipeEdgeDepth,
                        this.pipeSides
                    )
                ) {
                    totalBlocks += this.pipeHeight;
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
                        this.isInPipeWall(
                            x,
                            z,
                            minX,
                            maxX,
                            minZ,
                            maxZ,
                            this.pipeEdgeDepth,
                            this.pipeSides
                        )
                    ) {
                        for (let y = 0; y < this.pipeHeight; y++) {
                            matrix.setPosition(x, baseY + y, z);
                            instancedMesh.setMatrixAt(instanceIndex++, matrix);
                        }
                    }
                }
            }

            instancedMesh.instanceMatrix.needsUpdate = true;

            this.pipePreview = instancedMesh;

            if (this.scene) {
                this.scene.add(this.pipePreview);
            }
        }
        console.timeEnd("PipeTool-updatePipePreview");
    }
    /**
     * Updates the pipe preview material based on current mode (add or erase)
     */
    updatePipePreviewMaterial() {

        if (!this.pipePreview) {
            return;
        }

        const color = this.isCtrlPressed ? 0xff4e4e : 0x4e8eff;

        console.log("PipeTool: Updating pipe preview material");
        console.log(this.pipePreview);
        if (this.pipePreview.isInstancedMesh) {
            (this.pipePreview.material as THREE.MeshBasicMaterial).color.set(color);
        }
    }
    /**
     * Removes the pipe preview from the scene
     */
    removePipePreview() {
        if (this.pipePreview) {
            this.scene.remove(this.pipePreview);
            this.pipePreview = null;
        }
    }
    /**
     * Cleans up resources when the tool is disposed
     */
    dispose() {
        console.log("PipeTool: disposing resources");

        this.removePipePreview();

        this.terrainRef = null;
        this.currentBlockTypeRef = null;
        this.scene = null;
        this.pipeStartPosition = null;
        this.toolManagerRef = null;
        this.terrainBuilderRef = null;

        super.dispose();
    }
}
/**
 * Helper function to calculate squared distance from point to line segment
 * @param {number} x - Point x coordinate
 * @param {number} y - Point y coordinate
 * @param {number} x1 - Line segment start x
 * @param {number} y1 - Line segment start y
 * @param {number} x2 - Line segment end x
 * @param {number} y2 - Line segment end y
 * @returns {number} Squared distance from point to line segment
 */
function distanceToLineSegmentSquared(x, y, x1, y1, x2, y2) {
    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;
    let xx, yy;
    if (param < 0) {
        xx = x1;
        yy = y1;
    } else if (param > 1) {
        xx = x2;
        yy = y2;
    } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }
    const dx = x - xx;
    const dy = y - yy;
    return dx * dx + dy * dy;
}
export default PipeTool;
