import * as THREE from "three";
import BaseTool from "./BaseTool";
import { ENVIRONMENT_OBJECT_Y_OFFSET } from "../Constants";
import QuickTipsManager from "../components/QuickTipsManager";

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
    verticalOffset = 0;
    rotation = 0; // 0: 0°, 1: 90°, 2: 180°, 3: 270°
    changes = {
        terrain: {
            added: {},
            removed: {},
        },
        environment: {
            added: [],
            removed: [],
        },
    };

    terrainRef = null;
    scene = null;
    toolManagerRef = null;
    terrainBuilderRef = null;
    previewPositionRef = null;
    environmentBuilderRef = null;
    pendingChangesRef = null;
    selectionCenter = null;
    undoRedoManager: React.RefObject<any>;
    originalTooltip = null;
    tooltip = null;

    constructor(terrainBuilderProps) {
        super(terrainBuilderProps);
        this.name = "SelectionTool";
        this.originalTooltip =
            "Selection Tool: Click to start selection, click again to confirm. Use 1 | 2 to adjust height. Click and drag to move selection. Press Escape to cancel.";
        this.tooltip = this.originalTooltip;

        if (terrainBuilderProps) {
            this.terrainRef = terrainBuilderProps.terrainRef;
            this.scene = terrainBuilderProps.scene;
            this.toolManagerRef = terrainBuilderProps.toolManagerRef;
            this.terrainBuilderRef = terrainBuilderProps.terrainBuilderRef;
            this.previewPositionRef = terrainBuilderProps.previewPositionRef;
            this.environmentBuilderRef =
                terrainBuilderProps.environmentBuilderRef;
            this.pendingChangesRef = terrainBuilderProps.pendingChangesRef;
            this.undoRedoManager = terrainBuilderProps.undoRedoManager;
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
        this.verticalOffset = 0;
        this.rotation = 0;
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
                this.rotation = 0; // Reset rotation on cancellation
                this.changes = {
                    terrain: {
                        added: {},
                        removed: {},
                    },
                    environment: {
                        added: [],
                        removed: [],
                    },
                };
                // Revert to original tooltip on cancellation
                this.tooltip = this.originalTooltip;
                QuickTipsManager.setToolTip(this.tooltip);
            } else {
                this.selectionStartPosition = null;
                this.removeSelectionPreview();
            }
        } else if (event.key === "1") {
            if (this.isMovingSelection) {
                this.verticalOffset -= 1;
                this.updateSelectionPreview(
                    this.previewPositionRef.current,
                    this.previewPositionRef.current
                );
            } else {
                this.setSelectionHeight(Math.max(1, this.selectionHeight - 1));
            }
        } else if (event.key === "2") {
            if (this.isMovingSelection) {
                this.verticalOffset += 1;
                this.updateSelectionPreview(
                    this.previewPositionRef.current,
                    this.previewPositionRef.current
                );
            } else {
                this.setSelectionHeight(this.selectionHeight + 1);
            }
        } else if (event.key === "3" && this.isMovingSelection) {
            this.rotation = (this.rotation + 1) % 4;
            this.updateSelectionPreview(
                this.previewPositionRef.current,
                this.previewPositionRef.current
            );
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
                        const rotatedPos = this.rotatePosition(
                            originalPos,
                            this.selectionCenter
                        );
                        mesh.position.set(
                            rotatedPos.x + this.moveOffset.x,
                            rotatedPos.y +
                                this.moveOffset.y +
                                this.verticalOffset,
                            rotatedPos.z + this.moveOffset.z
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
                        const rotatedPos = this.rotatePosition(
                            new THREE.Vector3(
                                originalPos.x,
                                originalPos.y,
                                originalPos.z
                            ),
                            this.selectionCenter
                        );
                        mesh.position.set(
                            rotatedPos.x + this.moveOffset.x,
                            rotatedPos.y +
                                this.moveOffset.y +
                                this.verticalOffset,
                            rotatedPos.z + this.moveOffset.z
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
                        console.log("posKey", posKey);
                        console.log(
                            "this.terrainRef.current",
                            this.terrainRef.current
                        );
                        console.log(
                            "this.terrainRef.current[posKey]",
                            this.terrainRef.current[posKey]
                        );
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

        console.log("removedBlocksObj", removedBlocksObj);

        // Calculate center point
        if (blockCount > 0) {
            this.selectionCenter = new THREE.Vector3(
                totalX / blockCount,
                totalY / blockCount,
                totalZ / blockCount
            );
            console.log("this.selectionCenter blocks", this.selectionCenter);
        }

        this.pendingChangesRef.current.terrain.removed = {
            ...this.pendingChangesRef.current.terrain.removed,
            ...removedBlocksObj,
        };

        this.changes.terrain.removed = removedBlocksObj;

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
                    totalY += pos.y - ENVIRONMENT_OBJECT_Y_OFFSET;
                    totalZ += pos.z;
                    blockCount++;

                    // Remove the environment object immediately
                    this.environmentBuilderRef.current.removeInstance(
                        envObj.modelUrl,
                        envObj.instanceId,
                        false
                    );
                    this.changes.environment.removed.push(envObj);
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
            console.log("this.selectionCenter env", this.selectionCenter);
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

            // Update tooltip with detailed instructions
            this.tooltip =
                "Selection Active: Click and drag to move. Use 1 | 2 to adjust height. Press 3 to rotate (0° → 90° → 180° → 270°). Click to place. Press Escape to cancel.";
            QuickTipsManager.setToolTip(this.tooltip);
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
                    // First rotate the position around the center
                    const rotatedPos = this.rotatePosition(
                        originalPos,
                        this.selectionCenter
                    );

                    // Then apply the move offset
                    console.log("this.moveOffset", this.moveOffset);
                    const finalPos = new THREE.Vector3(
                        rotatedPos.x + this.moveOffset.x,
                        rotatedPos.y + this.moveOffset.y + this.verticalOffset,
                        rotatedPos.z + this.moveOffset.z
                    );

                    // Round the final position to ensure we're on grid points
                    const newX = Math.round(finalPos.x);
                    const newY = Math.round(finalPos.y);
                    const newZ = Math.round(finalPos.z);
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
            this.changes.terrain.added = addedBlocks;
        }

        // Place environment objects
        if (this.selectedEnvironments && this.environmentBuilderRef?.current) {
            for (const [envKey, envObj] of this.selectedEnvironments) {
                const originalPos =
                    this.originalEnvironmentPositions.get(envKey);
                if (originalPos) {
                    // First rotate the position around the center
                    const rotatedPos = this.rotatePosition(
                        new THREE.Vector3(
                            originalPos.x,
                            originalPos.y,
                            originalPos.z
                        ),
                        this.selectionCenter
                    );

                    // Then apply the move offset
                    console.log("this.moveOffset", this.moveOffset);
                    const newPos = {
                        x: rotatedPos.x + this.moveOffset.x,
                        y:
                            rotatedPos.y +
                            this.moveOffset.y +
                            this.verticalOffset,
                        z: rotatedPos.z + this.moveOffset.z,
                    };

                    const modelType =
                        this.environmentBuilderRef.current.getModelType(
                            envObj.name,
                            envObj.modelUrl
                        );

                    // Create a new THREE.Object3D with the correct position, rotation, and scale
                    const tempMesh = new THREE.Object3D();
                    tempMesh.position.set(newPos.x, newPos.y, newPos.z);
                    // Add rotation based on current rotation state
                    const rotationY = (this.rotation * Math.PI) / 2;
                    tempMesh.rotation.set(
                        envObj.rotation.x,
                        envObj.rotation.y + rotationY,
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
                    this.changes.environment.added.push({
                        ...envObj,
                        position: newPos,
                    });
                }
            }
        }

        console.log("undoRedoManager", this.undoRedoManager);
        this.undoRedoManager.current.saveUndo(this.changes);

        this.selectedBlocks = null;
        this.selectedEnvironments = null;
        this.isMovingSelection = false;
        this.moveOffset = new THREE.Vector3();
        this.verticalOffset = 0;
        this.rotation = 0;
        this.changes = {
            terrain: {
                added: {},
                removed: {},
            },
            environment: {
                added: [],
                removed: [],
            },
        };
        this.removeSelectionPreview();

        // Revert to original tooltip after placement
        this.tooltip = this.originalTooltip;
        QuickTipsManager.setToolTip(this.tooltip);
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

    // Helper method to rotate a position around the center point
    rotatePosition(pos, center) {
        const relativeX = pos.x - center.x;
        const relativeZ = pos.z - center.z;
        let newX, newZ;
        switch (this.rotation) {
            case 1: // 90°
                newX = center.x + relativeZ;
                newZ = center.z - relativeX;
                break;
            case 2: // 180°
                newX = center.x - relativeX;
                newZ = center.z - relativeZ;
                break;
            case 3: // 270°
                newX = center.x - relativeZ;
                newZ = center.z + relativeX;
                break;
            default: // 0°
                newX = pos.x;
                newZ = pos.z;
        }

        return new THREE.Vector3(newX, pos.y, newZ);
    }
}

export default SelectionTool;
