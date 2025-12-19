/**
 * StaircaseTool.tsx - Tool for placing staircases in the world editor
 *
 * This tool handles staircase placement, previewing, and manipulation.
 * Staircases can face north, south, east, or west.
 */
import * as THREE from "three";
import BaseTool from "./BaseTool";
import SelectionDimensionsManager from "../components/SelectionDimensionsManager";

class StaircaseTool extends BaseTool {
    /**
     * Creates a new StaircaseTool instance
     */
    staircaseWidth = 1; // Width of the staircase (perpendicular to direction)
    isCtrlPressed = false;
    staircaseStartPosition = null;
    staircasePreview = null;

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

        this.name = "StaircaseTool";
        this.tooltip =
            "Staircase Tool: Click to start, click again to place. Use 1 | 2 to adjust width. Hold Ctrl to erase. Press Escape to cancel.";
        this.staircaseWidth = 1;
        this.staircaseStartPosition = null;
        this.staircasePreview = null;

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
                "StaircaseTool: terrainBuilderProps is undefined in constructor"
            );
        }
    }

    onActivate(activationData) {
        super.onActivate(activationData);

        if (this.terrainRef && !this.terrainRef.current) {
            this.terrainRef.current = {};
        }

        this.staircaseStartPosition = null;
        this.removeStaircasePreview();

        if (this.isPlacingRef) {
            this.isPlacingRef.current = false;
        }

        if (this.placementChangesRef) {
            this.placementChangesRef.current = {
                terrain: { added: {}, removed: {} },
                environment: { added: [], removed: [] },
            };
        }
        return true;
    }

    onDeactivate() {
        super.onDeactivate();
        this.removeStaircasePreview();
        this.staircaseStartPosition = null;
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
     * Handles mouse down events for staircase placement
     */
    handleMouseDown(event, position, button) {
        if (!this.previewPositionRef || !this.previewPositionRef.current) {
            console.error(
                "StaircaseTool: previewPositionRef is undefined in handleMouseDown"
            );
            return;
        }

        const currentPosition = this.previewPositionRef.current;

        if (button === 0) {
            if (this.staircaseStartPosition) {
                if (!this.terrainRef) {
                    console.error(
                        "StaircaseTool: terrainRef is undefined when attempting to place staircase"
                    );
                    this.staircaseStartPosition = null;
                    this.removeStaircasePreview();
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
                }

                let actionPerformed = false;
                if (this.isCtrlPressed) {
                    actionPerformed = this.eraseStaircase(
                        this.staircaseStartPosition,
                        currentPosition
                    );
                } else {
                    actionPerformed = this.placeStaircase(
                        this.staircaseStartPosition,
                        currentPosition
                    );
                }
                if (!actionPerformed) {
                    console.warn("StaircaseTool: Staircase action failed");
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
                        }
                        this.placementChangesRef.current = {
                            terrain: { added: {}, removed: {} },
                            environment: { added: [], removed: [] },
                        };
                    }
                }

                this.staircaseStartPosition = null;
                this.removeStaircasePreview();

                if (this.isPlacingRef) {
                    this.isPlacingRef.current = false;
                }
            } else {
                this.staircaseStartPosition = currentPosition.clone();

                if (this.placementChangesRef) {
                    this.placementChangesRef.current = {
                        terrain: { added: {}, removed: {} },
                        environment: { added: [], removed: [] },
                    };
                    if (this.isPlacingRef) {
                        this.isPlacingRef.current = true;
                    }
                }
            }
        }
    }

    /**
     * Handles mouse move events for staircase preview
     */
    handleMouseMove(event, position) {
        if (
            this.staircaseStartPosition &&
            this.previewPositionRef &&
            this.previewPositionRef.current
        ) {
            this.updateStaircasePreview(
                this.staircaseStartPosition,
                this.previewPositionRef.current
            );
        }
    }

    /**
     * Track Ctrl key state for erasing and handle staircase width adjustments
     */
    handleKeyDown(event) {
        if (event.key === "Control") {
            this.isCtrlPressed = !this.isCtrlPressed;
            this.updateStaircasePreviewMaterial();
        } else if (event.key === "1") {
            this.setStaircaseWidth(this.staircaseWidth - 1);
        } else if (event.key === "2") {
            this.setStaircaseWidth(this.staircaseWidth + 1);
        } else if (event.key === "Escape") {
            this.removeStaircasePreview();
            this.staircaseStartPosition = null;
            SelectionDimensionsManager.clear();
        }
    }

    /**
     * Handle key up events for the tool
     */
    handleKeyUp(event) {
        // no-op for Control now (toggle handled on keydown)
    }

    /**
     * Updates the staircase width
     */
    setStaircaseWidth(width) {
        this.staircaseWidth = Math.max(1, width);

        if (
            this.staircaseStartPosition &&
            this.previewPositionRef &&
            this.previewPositionRef.current
        ) {
            this.updateStaircasePreview(
                this.staircaseStartPosition,
                this.previewPositionRef.current
            );
        }
    }

    /**
     * Determine the direction of the staircase based on start and end positions
     * Returns: 'north', 'south', 'east', or 'west'
     */
    getStaircaseDirection(startPos, endPos) {
        const dx = endPos.x - startPos.x;
        const dz = endPos.z - startPos.z;

        // Determine primary direction based on which axis has the larger change
        if (Math.abs(dx) > Math.abs(dz)) {
            return dx > 0 ? "east" : "west";
        } else {
            return dz > 0 ? "south" : "north";
        }
    }

    /**
     * Get all block positions for a staircase
     * Returns an array of {x, y, z} positions
     */
    getStaircaseBlocks(startPos, endPos) {
        const blocks = [];
        const startX = Math.round(startPos.x);
        const startY = Math.round(startPos.y);
        const startZ = Math.round(startPos.z);
        const endX = Math.round(endPos.x);
        const endY = Math.round(endPos.y);
        const endZ = Math.round(endPos.z);

        const direction = this.getStaircaseDirection(startPos, endPos);

        let stepX = 0;
        let stepZ = 0;
        let length = 0;

        if (direction === "north" || direction === "south") {
            stepZ = direction === "north" ? -1 : 1;
            length = Math.abs(endZ - startZ);
        } else {
            stepX = direction === "west" ? -1 : 1;
            length = Math.abs(endX - startX);
        }

        // Calculate width direction (perpendicular to staircase direction)
        let widthDirX = 0;
        let widthDirZ = 0;
        if (direction === "north" || direction === "south") {
            widthDirX = 1; // Width extends east-west
        } else {
            widthDirZ = 1; // Width extends north-south
        }

        // Place blocks for each step
        for (let step = 0; step <= length; step++) {
            const stepY = startY + step; // Each step rises by 1 block

            // Place blocks across the width
            for (let w = 0; w < this.staircaseWidth; w++) {
                const x = startX + step * stepX + w * widthDirX;
                const z = startZ + step * stepZ + w * widthDirZ;
                const y = stepY;

                blocks.push({ x, y, z });
            }
        }

        return blocks;
    }

    /**
     * Place staircase on the terrain
     * @param {THREE.Vector3} startPos - The starting position of the staircase
     * @param {THREE.Vector3} endPos - The ending position of the staircase
     * @returns {boolean} True if the staircase was placed, false otherwise
     */
    placeStaircase(startPos, endPos) {
        if (!startPos || !endPos) {
            console.error("Invalid start or end position for staircase placement");
            return false;
        }

        if (!this.terrainBuilderRef || !this.terrainBuilderRef.current) {
            console.error(
                "StaircaseTool: Cannot place staircase - terrainBuilderRef not available"
            );
            return false;
        }

        if (!this.currentBlockTypeRef || !this.currentBlockTypeRef.current) {
            console.error("StaircaseTool: currentBlockTypeRef is null – no block selected");
            return false;
        }

        const blockTypeId = this.currentBlockTypeRef.current.id;
        const blocks = this.getStaircaseBlocks(startPos, endPos);

        if (blocks.length === 0) {
            console.warn("StaircaseTool: No blocks to place");
            return false;
        }

        const addedBlocks = {};

        for (const block of blocks) {
            const posKey = `${block.x},${block.y},${block.z}`;

            if (
                this.terrainRef.current[posKey] ||
                this.environmentBuilderRef.current.hasInstanceAtPosition(posKey)
            ) {
                continue;
            }

            addedBlocks[posKey] = blockTypeId;
            this.pendingChangesRef.current.terrain.added[posKey] = blockTypeId;
            delete this.pendingChangesRef.current.terrain.removed[posKey];
        }

        if (Object.keys(addedBlocks).length === 0) {
            console.warn(
                "StaircaseTool: No blocks were added during staircase placement"
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
            this.terrainBuilderRef.current.updateSpatialHashForBlocks(
                addedBlocksArray,
                [],
                { force: true }
            );
        }

        if (this.placementChangesRef) {
            Object.entries(addedBlocks).forEach(([key, value]) => {
                this.placementChangesRef.current.terrain.added[key] = value;
            });
        }
        return true;
    }

    /**
     * Erase staircase from the terrain
     * @param {THREE.Vector3} startPos - The starting position of the staircase
     * @param {THREE.Vector3} endPos - The ending position of the staircase
     * @returns {boolean} True if the staircase was erased, false otherwise
     */
    eraseStaircase(startPos, endPos) {
        if (!startPos || !endPos) {
            console.error("Invalid start or end position for erasing");
            return false;
        }

        if (!this.terrainBuilderRef || !this.terrainBuilderRef.current) {
            console.error(
                "StaircaseTool: Cannot erase staircase - terrainBuilderRef not available"
            );
            return false;
        }

        const blocks = this.getStaircaseBlocks(startPos, endPos);

        if (blocks.length === 0) {
            console.warn("StaircaseTool: No blocks to erase");
            return false;
        }

        const removedBlocks = {};

        for (const block of blocks) {
            const posKey = `${block.x},${block.y},${block.z}`;

            if (!this.terrainRef.current[posKey]) continue;

            const blockId = this.terrainRef.current[posKey];
            removedBlocks[posKey] = blockId;
            this.pendingChangesRef.current.terrain.removed[posKey] = blockId;
            delete this.pendingChangesRef.current.terrain.added[posKey];
        }

        if (Object.keys(removedBlocks).length === 0) {
            console.warn(
                "StaircaseTool: No blocks were found to remove during staircase erasure"
            );
            return false;
        }

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
                    id: 0,
                    position: [x, y, z],
                };
            }
        );

        if (this.terrainBuilderRef.current.updateSpatialHashForBlocks) {
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
        return true;
    }

    /**
     * Updates the staircase preview visualization
     */
    updateStaircasePreview(startPos, endPos) {
        if (!startPos || !endPos) {
            return;
        }

        this.removeStaircasePreview();

        if (startPos.equals(endPos)) return;

        const blocks = this.getStaircaseBlocks(startPos, endPos);

        if (blocks.length === 0) {
            return;
        }

        // Publish live dimensions
        const direction = this.getStaircaseDirection(startPos, endPos);
        const startX = Math.round(startPos.x);
        const startZ = Math.round(startPos.z);
        const endX = Math.round(endPos.x);
        const endZ = Math.round(endPos.z);

        let length = 0;
        if (direction === "north" || direction === "south") {
            length = Math.abs(endZ - startZ) + 1;
        } else {
            length = Math.abs(endX - startX) + 1;
        }

        const height = length; // Each step rises by 1
        SelectionDimensionsManager.setDimensions({
            kind: "staircase",
            width: this.staircaseWidth,
            length: length,
            height: height,
            meta: `direction: ${direction}`,
        });

        const previewGeometry = new THREE.BoxGeometry(1, 1, 1);
        const previewMaterial = new THREE.MeshBasicMaterial({
            color: this.isCtrlPressed ? 0xff4e4e : 0x4e8eff,
            transparent: true,
            opacity: 0.5,
            wireframe: false,
        });

        const instancedMesh = new THREE.InstancedMesh(
            previewGeometry,
            previewMaterial,
            blocks.length
        );
        instancedMesh.frustumCulled = false;

        const matrix = new THREE.Matrix4();
        blocks.forEach((block, index) => {
            matrix.setPosition(block.x, block.y, block.z);
            instancedMesh.setMatrixAt(index, matrix);
        });

        instancedMesh.instanceMatrix.needsUpdate = true;
        this.staircasePreview = instancedMesh;

        if (this.scene) {
            this.scene.add(this.staircasePreview);
        }
    }

    /**
     * Updates the staircase preview material based on current mode (add or erase)
     */
    updateStaircasePreviewMaterial() {
        if (!this.staircasePreview) {
            return;
        }

        const color = this.isCtrlPressed ? 0xff4e4e : 0x4e8eff;

        if (this.staircasePreview.isInstancedMesh) {
            this.staircasePreview.material.color.set(color);
        }
    }

    /**
     * Removes the staircase preview from the scene
     */
    removeStaircasePreview() {
        if (this.staircasePreview) {
            this.scene.remove(this.staircasePreview);
            this.staircasePreview = null;
        }
        SelectionDimensionsManager.clear();
    }

    /**
     * Cleans up resources when the tool is disposed
     */
    dispose() {
        console.log("StaircaseTool: disposing resources");

        this.removeStaircasePreview();

        this.terrainRef = null;
        this.currentBlockTypeRef = null;
        this.scene = null;
        this.staircaseStartPosition = null;
        this.toolManagerRef = null;
        this.terrainBuilderRef = null;

        super.dispose();
    }
}

export default StaircaseTool;

