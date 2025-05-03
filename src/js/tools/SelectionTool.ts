import * as THREE from "three";
import BaseTool from "./BaseTool";
import { ENVIRONMENT_OBJECT_Y_OFFSET } from "../Constants";

class SelectionTool extends BaseTool {
    selectionStartPosition = null;
    selectionPreview = null;
    selectedBlocks = null;
    selectedEnvironments = null;
    isMovingSelection = false;
    moveOffset = new THREE.Vector3();
    originalPositions = new Map();
    originalEnvironmentPositions = new Map();
    selectionHeight = 1;

    terrainRef = null;
    scene = null;
    toolManagerRef = null;
    terrainBuilderRef = null;
    previewPositionRef = null;
    environmentBuilderRef = null;
    pendingChangesRef = null;
    selectionCenter = null;
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
            this.environmentBuilderRef =
                terrainBuilderProps.environmentBuilderRef;
            this.pendingChangesRef = terrainBuilderProps.pendingChangesRef;
        }
    }

    onActivate(activationData) {
        super.onActivate(activationData);
        this.selectionStartPosition = null;
        this.removeSelectionPreview();
        this.selectedBlocks = null;
        this.selectedEnvironments = null;
        this.isMovingSelection = false;
        this.selectionHeight = 1;
        return true;
    }

    onDeactivate() {
        super.onDeactivate();
        this.removeSelectionPreview();
        this.selectionStartPosition = null;
        this.selectedBlocks = null;
        this.selectedEnvironments = null;
        this.isMovingSelection = false;
    }

    handleMouseDown(event, position, button) {
        if (!this.previewPositionRef?.current) return;

        const currentPosition = this.previewPositionRef.current;

        if (button === 0) {
            if (
                (this.selectedBlocks || this.selectedEnvironments) &&
                this.isMovingSelection
            ) {
                // Place the selection
                this.placeSelection();
                this.selectedBlocks = null;
                this.selectedEnvironments = null;
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
        } else if (
            (this.selectedBlocks || this.selectedEnvironments) &&
            this.isMovingSelection
        ) {
            // Update selection position
            this.updateSelectionPosition(currentPosition);
        }
    }

    handleKeyDown(event) {
        if (event.key === "Escape") {
            if (this.selectedBlocks || this.selectedEnvironments) {
                this.selectedBlocks = null;
                this.selectedEnvironments = null;
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

        // If we're in moving mode, use the actual selected blocks and environments
        if (this.isMovingSelection) {
            const previewGeometry = new THREE.BoxGeometry(1, 1, 1);
            const previewMaterial = new THREE.MeshBasicMaterial({
                color: 0x4eff4e, // Green for moving
                transparent: true,
                opacity: 0.5,
                wireframe: false,
            });

            // Create preview for each selected block with offset
            if (this.selectedBlocks) {
                for (const [posKey, blockId] of this.selectedBlocks) {
                    const originalPos = this.originalPositions.get(posKey);
                    if (originalPos) {
                        const mesh = new THREE.Mesh(
                            previewGeometry,
                            previewMaterial
                        );
                        mesh.position.set(
                            originalPos.x + this.moveOffset.x,
                            originalPos.y + this.moveOffset.y,
                            originalPos.z + this.moveOffset.z
                        );
                        previewGroup.add(mesh);
                    }
                }
            }

            // Create preview for each selected environment object
            if (this.selectedEnvironments) {
                const envPreviewMaterial = previewMaterial.clone();
                envPreviewMaterial.color.setHex(0x4eff9e); // Slightly different green for environments

                for (const [envKey, envObj] of this.selectedEnvironments) {
                    const originalPos =
                        this.originalEnvironmentPositions.get(envKey);
                    if (originalPos) {
                        const mesh = new THREE.Mesh(
                            previewGeometry,
                            envPreviewMaterial
                        );
                        mesh.position.set(
                            originalPos.x + this.moveOffset.x,
                            originalPos.y + this.moveOffset.y,
                            originalPos.z + this.moveOffset.z
                        );
                        mesh.scale.set(1.2, 1.2, 1.2); // Slightly larger to distinguish from blocks
                        previewGroup.add(mesh);
                    }
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
        console.log("completeSelection", this.selectionStartPosition, endPos);
        console.log("terrainBuilderRef", this.terrainBuilderRef);
        console.log("environmentBuilderRef", this.environmentBuilderRef);
        if (
            !this.selectionStartPosition ||
            !this.terrainRef?.current ||
            !this.environmentBuilderRef?.current
        )
            return;

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
        const envBaseY = baseY + ENVIRONMENT_OBJECT_Y_OFFSET;

        this.selectedBlocks = new Map();
        this.selectedEnvironments = new Map();
        this.originalPositions = new Map();
        this.originalEnvironmentPositions = new Map();
        const removedBlocksObj = {};

        // Calculate center of selection
        let totalX = 0;
        let totalY = 0;
        let totalZ = 0;
        let blockCount = 0;

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

                        // Add to center calculation
                        totalX += x;
                        totalY += baseY + y;
                        totalZ += z;
                        blockCount++;

                        // Remove the block immediately
                        removedBlocksObj[posKey] = blockId;
                        delete this.terrainRef.current[posKey];
                        delete this.pendingChangesRef.current.terrain.added[
                            posKey
                        ];
                    }
                }
            }
        }

        // Calculate center point
        if (blockCount > 0) {
            this.selectionCenter = new THREE.Vector3(
                totalX / blockCount,
                totalY / blockCount,
                totalZ / blockCount
            );
        }

        this.pendingChangesRef.current.terrain.removed = {
            ...this.pendingChangesRef.current.terrain.removed,
            ...removedBlocksObj,
        };

        // Collect environment objects in the selection area
        if (this.environmentBuilderRef?.current?.getAllEnvironmentObjects) {
            const environmentObjects =
                this.environmentBuilderRef.current.getAllEnvironmentObjects();
            for (const envObj of environmentObjects) {
                const pos = envObj.position;
                if (
                    pos.x >= minX &&
                    pos.x <= maxX &&
                    pos.z >= minZ &&
                    pos.z <= maxZ &&
                    pos.y >= envBaseY &&
                    pos.y < envBaseY + this.selectionHeight
                ) {
                    const envKey = `${envObj.position.x},${envObj.position.y},${envObj.position.z}`;
                    this.selectedEnvironments.set(envKey, envObj);
                    this.originalEnvironmentPositions.set(envKey, { ...pos });

                    // Add to center calculation
                    totalX += pos.x;
                    totalY += pos.y;
                    totalZ += pos.z;
                    blockCount++;

                    // Remove the environment object immediately
                    this.environmentBuilderRef.current.removeInstance(
                        envObj.modelUrl,
                        envObj.instanceId,
                        false
                    );
                }
            }
        }

        // Update center point if we have environment objects
        if (blockCount > 0) {
            this.selectionCenter = new THREE.Vector3(
                totalX / blockCount,
                totalY / blockCount,
                totalZ / blockCount
            );
        }

        if (
            this.selectedBlocks.size > 0 ||
            this.selectedEnvironments.size > 0
        ) {
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
        if (!this.selectedBlocks && !this.selectedEnvironments) return;

        // Calculate offset from the center of the selection to the current mouse position
        const newOffset = new THREE.Vector3(
            Math.round(currentPosition.x - this.selectionCenter.x),
            Math.round(currentPosition.y - this.selectionCenter.y),
            Math.round(currentPosition.z - this.selectionCenter.z)
        );

        if (!newOffset.equals(this.moveOffset)) {
            this.moveOffset.copy(newOffset);
            // Only update the preview with the current position
            this.updateSelectionPreview(currentPosition, currentPosition);
        }
    }

    placeSelection() {
        if (!this.selectedBlocks && !this.selectedEnvironments) return;

        // Place terrain blocks
        if (this.selectedBlocks && this.terrainRef?.current) {
            const addedBlocks = {};

            // Place blocks in new positions
            for (const [posKey, blockId] of this.selectedBlocks) {
                const originalPos = this.originalPositions.get(posKey);
                if (originalPos) {
                    const newX = originalPos.x + this.moveOffset.x;
                    const newY = originalPos.y + this.moveOffset.y;
                    const newZ = originalPos.z + this.moveOffset.z;
                    const newPosKey = `${newX},${newY},${newZ}`;

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
            this.pendingChangesRef.current.terrain.added = {
                ...this.pendingChangesRef.current.terrain.added,
                ...addedBlocks,
            };
            console.log(
                "pendingChangesRef after adding blocks",
                this.pendingChangesRef.current
            );
        }

        // Place environment objects

        console.log("selectedEnvironments", this.selectedEnvironments);
        console.log("environmentBuilderRef", this.environmentBuilderRef);
        if (this.selectedEnvironments && this.environmentBuilderRef?.current) {
            console.log("placing environment objects");
            for (const [envKey, envObj] of this.selectedEnvironments) {
                console.log("envKey", envKey);
                console.log("envObj", envObj);
                const originalPos =
                    this.originalEnvironmentPositions.get(envKey);
                console.log("originalPos", originalPos);
                if (originalPos) {
                    const newPos = { ...originalPos };
                    newPos.x += this.moveOffset.x;
                    newPos.y += this.moveOffset.y;
                    newPos.z += this.moveOffset.z;

                    const modelType =
                        this.environmentBuilderRef.current.getModelType(
                            envObj.name,
                            envObj.modelUrl
                        );

                    // Create a new THREE.Object3D with the correct position, rotation, and scale
                    const tempMesh = new THREE.Object3D();
                    tempMesh.position.set(newPos.x, newPos.y, newPos.z);
                    tempMesh.rotation.set(
                        envObj.rotation.x,
                        envObj.rotation.y,
                        envObj.rotation.z
                    );
                    tempMesh.scale.set(
                        envObj.scale.x,
                        envObj.scale.y,
                        envObj.scale.z
                    );

                    // Create a new environment object at the new position
                    this.environmentBuilderRef.current.placeEnvironmentModelWithoutSaving(
                        modelType,
                        tempMesh,
                        envObj.instanceId
                    );
                }
            }
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
        this.selectedEnvironments = null;
        this.isMovingSelection = false;
        super.dispose();
    }
}

export default SelectionTool;
