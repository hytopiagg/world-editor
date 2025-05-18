import * as THREE from "three";
import BaseTool from "./BaseTool";
import { blockTypes } from "../managers/BlockTypesManager"; // For getting block type info

class SchematicPlacementTool extends BaseTool {
    constructor(terrainBuilderProps) {
        console.log(
            "[SchematicPlacementTool] Constructor received props:",
            terrainBuilderProps
        );

        if (!terrainBuilderProps || !terrainBuilderProps.scene) {
            console.error(
                "[SchematicPlacementTool] ERROR: Scene object is missing in terrainBuilderProps!"
            );

            return; // Or throw an error?
        }
        super(terrainBuilderProps);

        if (
            terrainBuilderProps &&
            terrainBuilderProps.updateTerrainForUndoRedo
        ) {
            this.updateTerrainForUndoRedo =
                terrainBuilderProps.updateTerrainForUndoRedo;
        } else {
            console.error(
                "[SchematicPlacementTool] ERROR: updateTerrainForUndoRedo function is missing in terrainBuilderProps!"
            );
        }
        this.name = "SchematicPlacementTool";
        this.schematicData = null;
        this.previewGroup = new THREE.Group();
        this.anchorOffset = new THREE.Vector3(0, 0, 0); // Offset from cursor to schematic anchor (e.g., corner)
        this.currentRotation = 0; // 0: 0°, 1: 90°, 2: 180°, 3: 270°
        this.verticalOffset = 0; // Y offset applied via 1 / 2 keys

        if (this.scene) {
            this.scene.add(this.previewGroup);
        } else {
            console.error(
                "[SchematicPlacementTool] ERROR: this.scene is still undefined after super() call!"
            );
        }

        this.previewGeometry = new THREE.BoxGeometry(1, 1, 1);
        this.previewInstancedMesh = null;
        this.dummy = new THREE.Object3D(); // For setting instance matrices
        this.previewInstancedMaterial = new THREE.MeshPhongMaterial({
            opacity: 0.5,
            transparent: true,
            depthWrite: false,
            // vertexColors: true is not needed for InstancedMesh.setColorAt
        });

        // For debouncing mouse move updates
        this.mouseMoveTimeout = null;
        this.mouseMoveDelay = 0; // ms, adjust as needed
    }

    onActivate(schematicData) {
        if (!schematicData || Object.keys(schematicData).length === 0) {
            console.warn(
                "SchematicPlacementTool activated without valid schematic data."
            );

            return false; // Indicate activation failed
        }

        this.schematicData = schematicData;
        this.currentRotation = 0; // Reset rotation on new schematic activation
        this.verticalOffset = 0;
        this.anchorOffset.y = 0;
        this._rebuildPreviewInstancedMesh(); // Build/rebuild the InstancedMesh
        this._updatePreviewAnchorPosition(); // Position the group
        this.previewGroup.visible = true;
        console.log(
            "SchematicPlacementTool specific activation with data:",
            this.schematicData
        );

        return true; // Indicate activation succeeded
    }

    onDeactivate() {
        this.schematicData = null;
        this.previewGroup.visible = false;
        this._clearPreviewInstancedMesh(); // Clear the instanced mesh
        this.currentRotation = 0; // Reset rotation
        this.verticalOffset = 0;
        this.anchorOffset.y = 0;
        console.log("SchematicPlacementTool specific deactivation");

        if (this.terrainBuilderProps.clearAISchematic) {
            this.terrainBuilderProps.clearAISchematic();
        }

        // Clear any pending mouse move updates
        if (this.mouseMoveTimeout) {
            clearTimeout(this.mouseMoveTimeout);
            this.mouseMoveTimeout = null;
        }
    }

    getRotatedRelativePosition(relX, relY, relZ) {
        let rotatedX = relX;
        let rotatedZ = relZ;
        // Rotate around Y axis, relative to schematic anchor (0,0,0 locally)
        switch (this.currentRotation) {
            case 1: // 90 degrees (clockwise if looking down Y axis, typical for screen coordinates)
                rotatedX = -relZ;
                rotatedZ = relX;
                break;
            case 2: // 180 degrees
                rotatedX = -relX;
                rotatedZ = -relZ;
                break;
            case 3: // 270 degrees
                rotatedX = relZ;
                rotatedZ = -relX;
                break;
            // case 0: // 0 degrees - no change, initial values are fine
        }
        return { x: rotatedX, y: relY, z: rotatedZ };
    }

    handleMouseMove(event, intersectionPoint) {
        if (!this.isActive || !this.schematicData) return;

        // Debounce the preview update
        clearTimeout(this.mouseMoveTimeout);
        this.mouseMoveTimeout = setTimeout(() => {
            this._updatePreviewAnchorPosition();
        }, this.mouseMoveDelay);
    }

    _rebuildPreviewInstancedMesh() {
        if (!this.schematicData) return;

        this._clearPreviewInstancedMesh(); // Clear existing instanced mesh first

        const blocks = Object.entries(this.schematicData);
        const count = blocks.length;

        if (count === 0) return;

        this.previewInstancedMesh = new THREE.InstancedMesh(
            this.previewGeometry,
            this.previewInstancedMaterial,
            count
        );
        // Optional: for transparency, might help with rendering order
        // this.previewInstancedMesh.renderOrder = 1;

        const colorInstance = new THREE.Color(); // Reusable color object

        for (let i = 0; i < count; i++) {
            const [relPosStr, blockId] = blocks[i];
            const [relX, relY, relZ] = relPosStr.split(",").map(Number);
            const rotatedRel = this.getRotatedRelativePosition(
                relX,
                relY,
                relZ
            );

            // Set instance transform (position)
            this.dummy.position.set(rotatedRel.x, rotatedRel.y, rotatedRel.z);
            // No rotation or scale needed for individual preview blocks beyond schematic rotation
            this.dummy.rotation.set(0, 0, 0);
            this.dummy.scale.set(1, 1, 1);
            this.dummy.updateMatrix();
            this.previewInstancedMesh.setMatrixAt(i, this.dummy.matrix);

            // Set instance color
            const blockType = blockTypes.find((b) => b.id === blockId);
            const colorHex = blockType ? 0x00ff00 : 0xff00ff; // Green for known, magenta for unknown
            this.previewInstancedMesh.setColorAt(
                i,
                colorInstance.setHex(colorHex)
            );
        }

        this.previewInstancedMesh.instanceMatrix.needsUpdate = true;
        if (this.previewInstancedMesh.instanceColor) {
            this.previewInstancedMesh.instanceColor.needsUpdate = true;
        }

        this.previewGroup.add(this.previewInstancedMesh);
    }

    _clearPreviewInstancedMesh() {
        if (this.previewInstancedMesh) {
            this.previewGroup.remove(this.previewInstancedMesh);
            // Geometry and Material are shared, dispose them in the main dispose() method
            this.previewInstancedMesh.dispose(); // Disposes internal buffer attributes
            this.previewInstancedMesh = null;
        }
    }

    _updatePreviewAnchorPosition() {
        if (
            !this.isActive || // Check inherited isActive getter
            !this.previewPositionRef.current
        ) {
            return;
        }

        const basePosition = this.previewPositionRef.current;
        this.previewGroup.position.set(
            basePosition.x + this.anchorOffset.x,
            basePosition.y + this.anchorOffset.y,
            basePosition.z + this.anchorOffset.z
        );
    }

    handleMouseDown(event, intersectionPoint, button) {
        if (!this.isActive || !this.schematicData) return; // Use the getter
        if (button === 0) {
            this.placeSchematic();
        } else if (button === 2) {
            console.log("Schematic placement cancelled by right-click.");
            this.onDeactivate();
        }
    }

    handleKeyDown(event) {
        if (!this.isActive) return; // Use the getter
        if (event.key === "Escape") {
            console.log("Schematic placement cancelled by Escape key.");
            this.onDeactivate();
        } else if (event.key.toLowerCase() === "r") {
            this.currentRotation = (this.currentRotation + 1) % 4;
            console.log(`Schematic rotation: ${this.currentRotation * 90}°`);
            this._rebuildPreviewInstancedMesh(); // Rebuild with new relative positions
            this._updatePreviewAnchorPosition(); // Ensure group is correctly positioned
        } else if (event.key === "1") {
            // Shift down
            this.verticalOffset -= 1;
            this.anchorOffset.y = this.verticalOffset;
            this._updatePreviewAnchorPosition();
        } else if (event.key === "2") {
            // Shift up
            this.verticalOffset += 1;
            this.anchorOffset.y = this.verticalOffset;
            this._updatePreviewAnchorPosition();
        }
    }

    placeSchematic() {
        if (!this.schematicData || !this.previewPositionRef.current) {
            console.error("Cannot place schematic: data or position missing.");
            return;
        }
        const basePosition = this.previewPositionRef.current;
        const addedBlocks = {};
        const removedBlocks = {};
        const terrain = this.terrainRef.current;
        const pendingChanges = this.terrainBuilderProps?.pendingChangesRef
            ?.current || {
            terrain: { added: {}, removed: {} },
            environment: { added: [], removed: [] },
        };
        console.log("original pendingChanges", JSON.stringify(pendingChanges));
        console.log("terrain", terrain);
        console.log("this.terrainBuilderProps", this.terrainBuilderProps);
        console.log(
            `Placing schematic at base position: ${basePosition.x},${basePosition.y},${basePosition.z}`
        );
        for (const [relPosStr, blockId] of Object.entries(this.schematicData)) {
            const [relX, relY, relZ] = relPosStr.split(",").map(Number);
            const rotatedRel = this.getRotatedRelativePosition(
                relX,
                relY,
                relZ
            );

            const worldX = Math.round(
                basePosition.x + rotatedRel.x + this.anchorOffset.x
            );
            const worldY = Math.round(
                basePosition.y + rotatedRel.y + this.anchorOffset.y
            );
            const worldZ = Math.round(
                basePosition.z + rotatedRel.z + this.anchorOffset.z
            );
            const worldPosStr = `${worldX},${worldY},${worldZ}`;
            if (terrain[worldPosStr]) {
                removedBlocks[worldPosStr] = terrain[worldPosStr];
            }
            addedBlocks[worldPosStr] = blockId;
        }
        console.log("Applying schematic changes:", {
            added: addedBlocks,
            removed: removedBlocks,
        });

        if (this.updateTerrainForUndoRedo) {
            this.updateTerrainForUndoRedo(
                addedBlocks,
                removedBlocks,
                "ai-schematic"
            );
            if (this.undoRedoManager && this.undoRedoManager.current) {
                const changes = {
                    terrain: { added: addedBlocks, removed: removedBlocks },
                    environment: {
                        added: this.terrainBuilderProps?.environment?.added,
                        removed: this.terrainBuilderProps?.environment?.removed,
                    },
                };
                this.undoRedoManager.current.saveUndo(changes);
                console.log(
                    "[Schematic Tool] Saved placement action to undo stack."
                );
            } else {
                console.warn(
                    "[Schematic Tool] UndoRedoManager not available, cannot save undo state."
                );
            }
        } else {
            console.error(
                "updateTerrainForUndoRedo function not found on this tool instance!"
            );
        }

        console.log("pendingChanges", pendingChanges);

        if (pendingChanges) {
            pendingChanges.terrain.added = {
                ...pendingChanges.terrain.added,
                ...addedBlocks,
            };
            pendingChanges.terrain.removed = removedBlocks;
        }

        const repeatPlacement =
            localStorage.getItem("schematicRepeatPlacement") === "true";

        if (!repeatPlacement) {
            if (this.terrainBuilderProps.activateTool) {
                this.terrainBuilderProps.activateTool(null);
            } else {
                console.warn(
                    "activateTool not found in props, deactivating schematic tool."
                );
                this.deactivate();
            }
        } else {
            // Keep preview visible and allow further placements.
            this._updatePreviewAnchorPosition();
        }
    }

    dispose() {
        this._clearPreviewInstancedMesh(); // Use the new clear method

        if (this.scene) {
            this.scene.remove(this.previewGroup); // previewGroup itself
        }

        if (this.previewGeometry) {
            this.previewGeometry.dispose();
            this.previewGeometry = null;
        }
        if (this.previewInstancedMaterial) {
            // Dispose the shared material
            this.previewInstancedMaterial.dispose();
            this.previewInstancedMaterial = null;
        }
        // this.dummy is a simple Object3D and doesn't need explicit disposal
        console.log("SchematicPlacementTool disposed");
    }
}
export default SchematicPlacementTool;
