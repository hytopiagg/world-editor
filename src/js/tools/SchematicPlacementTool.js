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
        console.log("SchematicPlacementTool specific deactivation");

        if (this.terrainBuilderProps.clearAISchematic) {
            this.terrainBuilderProps.clearAISchematic();
        }
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
            const worldX = basePosition.x + relX + this.anchorOffset.x;
            const worldY = basePosition.y + relY + this.anchorOffset.y;
            const worldZ = basePosition.z + relZ + this.anchorOffset.z;
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
        const pendingChanges = this.terrainBuilderProps?.pendingChangesRef?.current || {
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

            const worldX = Math.round(
                basePosition.x + relX + this.anchorOffset.x
            );
            const worldY = Math.round(
                basePosition.y + relY + this.anchorOffset.y
            );
            const worldZ = Math.round(
                basePosition.z + relZ + this.anchorOffset.z
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
            console.log("Schematic placed, activating Brush tool...");
            this.terrainBuilderProps.activateTool("brush");
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
