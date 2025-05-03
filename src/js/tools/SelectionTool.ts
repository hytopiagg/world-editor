import * as THREE from "three";
import BaseTool from "./BaseTool";

class SelectionTool extends BaseTool {
    selectionStartPosition = null;
    selectionPreview = null;
    selectedBlocks = null;
    isMovingSelection = false;
    moveOffset = new THREE.Vector3();
    originalPositions = new Map();
    selectionHeight = 1;

    terrainRef = null;
    scene = null;
    toolManagerRef = null;
    terrainBuilderRef = null;
    previewPositionRef = null;

    constructor(terrainBuilderProps) {
        super(terrainBuilderProps);
        this.name = "SelectionTool";
        this.tooltip =
            "Selection Tool: Click to start selection, click again to confirm. Use 1 | 2 to adjust height. Click and drag to move selection. Press Escape to cancel.";

        if (terrainBuilderProps) {
            this.terrainRef = terrainBuilderProps.terrainRef;
            this.scene = terrainBuilderProps.scene;
            this.toolManagerRef = terrainBuilderProps.toolManagerRef;
            this.terrainBuilderRef = terrainBuilderProps.terrainBuilderRef;
            this.previewPositionRef = terrainBuilderProps.previewPositionRef;
        }
    }

    onActivate(activationData) {
        super.onActivate(activationData);
        this.selectionStartPosition = null;
        this.removeSelectionPreview();
        this.selectedBlocks = null;
        this.isMovingSelection = false;
        this.selectionHeight = 1;
        return true;
    }

    onDeactivate() {
        super.onDeactivate();
        this.removeSelectionPreview();
        this.selectionStartPosition = null;
        this.selectedBlocks = null;
        this.isMovingSelection = false;
    }

    handleMouseDown(event, position, button) {
        if (!this.previewPositionRef?.current) return;

        const currentPosition = this.previewPositionRef.current;

        if (button === 0) {
            if (this.selectedBlocks && this.isMovingSelection) {
                // Place the selection
                this.placeSelection(currentPosition);
                this.selectedBlocks = null;
                this.isMovingSelection = false;
                this.removeSelectionPreview();
                this.deactivate();
            } else if (this.selectionStartPosition) {
                // Complete the selection
                this.completeSelection(currentPosition);
            } else {
                // Start new selection
                this.selectionStartPosition = currentPosition.clone();
                this.updateSelectionPreview(
                    this.selectionStartPosition,
                    currentPosition
                );
            }
        }
    }

    handleMouseMove(event, position) {
        if (!this.previewPositionRef?.current) return;

        const currentPosition = this.previewPositionRef.current;

        if (this.selectionStartPosition && !this.selectedBlocks) {
            // Update selection preview
            this.updateSelectionPreview(
                this.selectionStartPosition,
                currentPosition
            );
        } else if (this.selectedBlocks && this.isMovingSelection) {
            // Update selection position
            this.updateSelectionPosition(currentPosition);
        }
    }

    handleKeyDown(event) {
        if (event.key === "Escape") {
            if (this.selectedBlocks) {
                this.selectedBlocks = null;
                this.isMovingSelection = false;
                this.removeSelectionPreview();
            } else {
                this.selectionStartPosition = null;
                this.removeSelectionPreview();
            }
        } else if (event.key === "1") {
            this.setSelectionHeight(Math.max(1, this.selectionHeight - 1));
        } else if (event.key === "2") {
            this.setSelectionHeight(this.selectionHeight + 1);
        }
    }

    setSelectionHeight(height) {
        console.log("Setting selection height to:", height);
        this.selectionHeight = height;

        if (this.selectionStartPosition && this.previewPositionRef?.current) {
            this.updateSelectionPreview(
                this.selectionStartPosition,
                this.previewPositionRef.current
            );
        }
    }

    updateSelectionPreview(startPos, endPos) {
        if (!startPos || !endPos) return;

        this.removeSelectionPreview();

        // Create a group to hold all preview meshes
        const previewGroup = new THREE.Group();

        // If we're in moving mode, use the actual selected blocks
        if (this.isMovingSelection && this.selectedBlocks) {
            const previewGeometry = new THREE.BoxGeometry(1, 1, 1);
            const previewMaterial = new THREE.MeshBasicMaterial({
                color: 0x4eff4e, // Green for moving
                transparent: true,
                opacity: 0.5,
                wireframe: false,
            });

            // Create preview for each selected block with offset
            for (const [posKey, blockId] of this.selectedBlocks) {
                const originalPos = this.originalPositions.get(posKey);
                if (originalPos) {
                    const mesh = new THREE.Mesh(
                        previewGeometry,
                        previewMaterial
                    );
                    mesh.position.set(
                        originalPos.x + this.moveOffset.x,
                        originalPos.y,
                        originalPos.z + this.moveOffset.z
                    );
                    previewGroup.add(mesh);
                }
            }
        } else {
            // Selection mode preview
            const minX = Math.min(Math.round(startPos.x), Math.round(endPos.x));
            const maxX = Math.max(Math.round(startPos.x), Math.round(endPos.x));
            const minZ = Math.min(Math.round(startPos.z), Math.round(endPos.z));
            const maxZ = Math.max(Math.round(startPos.z), Math.round(endPos.z));
            const baseY = Math.round(startPos.y);

            const previewGeometry = new THREE.BoxGeometry(1, 1, 1);
            const previewMaterial = new THREE.MeshBasicMaterial({
                color: 0x4e8eff, // Blue for selection
                transparent: true,
                opacity: 0.5,
                wireframe: false,
            });

            // Create preview for selection area
            for (let x = minX; x <= maxX; x++) {
                for (let z = minZ; z <= maxZ; z++) {
                    for (let y = 0; y < this.selectionHeight; y++) {
                        const mesh = new THREE.Mesh(
                            previewGeometry,
                            previewMaterial
                        );
                        mesh.position.set(x, baseY + y, z);
                        previewGroup.add(mesh);
                    }
                }
            }
        }

        this.selectionPreview = previewGroup;
        this.scene.add(this.selectionPreview);
    }

    completeSelection(endPos) {
        if (!this.selectionStartPosition || !this.terrainRef?.current) return;

        const minX = Math.min(
            Math.round(this.selectionStartPosition.x),
            Math.round(endPos.x)
        );
        const maxX = Math.max(
            Math.round(this.selectionStartPosition.x),
            Math.round(endPos.x)
        );
        const minZ = Math.min(
            Math.round(this.selectionStartPosition.z),
            Math.round(endPos.z)
        );
        const maxZ = Math.max(
            Math.round(this.selectionStartPosition.z),
            Math.round(endPos.z)
        );
        const baseY = Math.round(this.selectionStartPosition.y);

        this.selectedBlocks = new Map();
        this.originalPositions = new Map();
        const removedBlocksObj = {};

        // Collect all blocks in the selection area and remove them
        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                for (let y = 0; y < this.selectionHeight; y++) {
                    const posKey = `${x},${baseY + y},${z}`;
                    if (this.terrainRef.current[posKey]) {
                        const blockId = this.terrainRef.current[posKey];
                        this.selectedBlocks.set(posKey, blockId);
                        this.originalPositions.set(
                            posKey,
                            new THREE.Vector3(x, baseY + y, z)
                        );

                        // Remove the block immediately
                        removedBlocksObj[posKey] = blockId;
                        delete this.terrainRef.current[posKey];
                    }
                }
            }
        }

        if (this.selectedBlocks.size > 0) {
            // Update terrain to reflect removed blocks
            if (this.terrainBuilderRef?.current) {
                this.terrainBuilderRef.current.updateTerrainBlocks(
                    {},
                    removedBlocksObj,
                    { skipUndoSave: true }
                );
            }

            this.isMovingSelection = true;
            this.moveOffset = new THREE.Vector3();
            this.updateSelectionPreview(this.selectionStartPosition, endPos);
        } else {
            this.selectionStartPosition = null;
            this.removeSelectionPreview();
        }
    }

    updateSelectionPosition(currentPosition) {
        if (!this.selectedBlocks || !this.selectionStartPosition) return;

        const newOffset = new THREE.Vector3(
            Math.round(currentPosition.x - this.selectionStartPosition.x),
            0,
            Math.round(currentPosition.z - this.selectionStartPosition.z)
        );

        if (!newOffset.equals(this.moveOffset)) {
            this.moveOffset.copy(newOffset);
            this.updateSelectionPreview(
                this.selectionStartPosition.clone().add(this.moveOffset),
                this.previewPositionRef.current
            );
        }
    }

    placeSelection(currentPosition) {
        if (!this.selectedBlocks || !this.terrainRef?.current) return;

        const addedBlocks = {};

        // Place blocks in new positions
        for (const [posKey, blockId] of this.selectedBlocks) {
            const originalPos = this.originalPositions.get(posKey);
            if (originalPos) {
                const newX = originalPos.x + this.moveOffset.x;
                const newZ = originalPos.z + this.moveOffset.z;
                const newPosKey = `${newX},${originalPos.y},${newZ}`;

                // Add new block
                addedBlocks[newPosKey] = blockId;
                this.terrainRef.current[newPosKey] = blockId;
            }
        }

        // Update terrain
        if (this.terrainBuilderRef?.current) {
            this.terrainBuilderRef.current.updateTerrainBlocks(
                addedBlocks,
                {},
                { skipUndoSave: true }
            );
        }
    }

    removeSelectionPreview() {
        if (this.selectionPreview) {
            this.scene.remove(this.selectionPreview);
            this.selectionPreview = null;
        }
    }

    dispose() {
        this.removeSelectionPreview();
        this.selectionStartPosition = null;
        this.selectedBlocks = null;
        this.isMovingSelection = false;
        super.dispose();
    }
}

export default SelectionTool;
