import * as THREE from "three";
import BaseTool from "./BaseTool";
import BlockMaterial from "../blocks/BlockMaterial"; // Import BlockMaterial for preview
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
        this.previewMeshes = {}; // Store meshes by relative position string "x,y,z"
        this.anchorOffset = new THREE.Vector3(0, 0, 0); // Offset from cursor to schematic anchor (e.g., corner)
        this.currentRotation = 0; // 0: 0°, 1: 90°, 2: 180°, 3: 270°

        this.tooltip =
            "Schematic Placement Tool: Click to place. Tap R to rotate. Press Escape to cancel.";

        if (this.scene) {
            this.scene.add(this.previewGroup);
        } else {
            console.error(
                "[SchematicPlacementTool] ERROR: this.scene is still undefined after super() call!"
            );
        }

        this.previewGeometry = new THREE.BoxGeometry(1, 1, 1);
    }

    onActivate(schematicData) {
        if (!schematicData || Object.keys(schematicData).length === 0) {
            console.warn(
                "SchematicPlacementTool activated without valid schematic data."
            );

            return false; // Indicate activation failed
        }

        this.schematicData = schematicData;
        this.previewGroup.visible = true;
        this.currentRotation = 0; // Reset rotation on new schematic activation
        console.log(
            "SchematicPlacementTool specific activation with data:",
            this.schematicData
        );

        this.updatePreview(); // Initial preview update
        return true; // Indicate activation succeeded
    }

    onDeactivate() {
        this.schematicData = null;
        this.previewGroup.visible = false;
        this.clearPreviewMeshes();
        this.currentRotation = 0; // Reset rotation
        console.log("SchematicPlacementTool specific deactivation");

        if (this.terrainBuilderProps.clearAISchematic) {
            this.terrainBuilderProps.clearAISchematic();
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
        if (!this.isActive || !this.schematicData) return; // Use the getter from BaseTool

        this.updatePreview();
    }

    updatePreview() {
        if (
            !this.isActive || // Use the getter
            !this.schematicData ||
            !this.previewPositionRef.current
        )
            return;
        const basePosition = this.previewPositionRef.current;

        for (const [relPosStr, blockId] of Object.entries(this.schematicData)) {
            const [relX, relY, relZ] = relPosStr.split(",").map(Number);
            const rotatedRel = this.getRotatedRelativePosition(
                relX,
                relY,
                relZ
            );

            const worldX = basePosition.x + rotatedRel.x + this.anchorOffset.x;
            const worldY = basePosition.y + rotatedRel.y + this.anchorOffset.y;
            const worldZ = basePosition.z + rotatedRel.z + this.anchorOffset.z;
            if (this.previewMeshes[relPosStr]) {
                this.previewMeshes[relPosStr].position.set(
                    worldX,
                    worldY,
                    worldZ
                );
            } else {
                const blockType = blockTypes.find((b) => b.id === blockId);
                const color = blockType ? 0x00ff00 : 0xff00ff; // Green for known, magenta for unknown

                let material;
                if (BlockMaterial.instance) {
                    material = new THREE.MeshPhongMaterial({
                        color: color,
                        opacity: 0.5,
                        transparent: true,
                        depthWrite: false, // Render correctly with existing blocks
                    });
                } else {
                    material = new THREE.MeshBasicMaterial({
                        color: color,
                        opacity: 0.5,
                        transparent: true,
                        depthWrite: false,
                    });
                }
                const mesh = new THREE.Mesh(this.previewGeometry, material);
                mesh.position.set(worldX, worldY, worldZ);
                mesh.userData = { blockId }; // Store blockId for potential future use
                this.previewGroup.add(mesh);
                this.previewMeshes[relPosStr] = mesh;
            }
        }
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
            this.updatePreview();
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

        if (this.terrainBuilderProps.activateTool) {
            this.terrainBuilderProps.activateTool(null);
        } else {
            console.warn(
                "activateTool not found in props, deactivating schematic tool."
            );
            this.deactivate();
        }
    }

    clearPreviewMeshes() {
        while (this.previewGroup.children.length > 0) {
            const mesh = this.previewGroup.children[0];
            this.previewGroup.remove(mesh);
        }
        this.previewMeshes = {};
    }
    dispose() {
        this.clearPreviewMeshes();

        if (this.scene) {
            this.scene.remove(this.previewGroup);
        }

        if (this.previewGeometry) {
            this.previewGeometry.dispose();
            this.previewGeometry = null;
        }
        console.log("SchematicPlacementTool disposed");
    }
}
export default SchematicPlacementTool;
