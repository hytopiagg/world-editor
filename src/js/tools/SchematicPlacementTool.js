import * as THREE from "three";
import BaseTool from "./BaseTool";
import BlockMaterial from "../blocks/BlockMaterial"; // Import BlockMaterial for preview
import { blockTypes } from "../managers/BlockTypesManager"; // For getting block type info

class SchematicPlacementTool extends BaseTool {
    constructor(terrainBuilderProps) {
        // Add a log to check the incoming props
        console.log(
            "[SchematicPlacementTool] Constructor received props:",
            terrainBuilderProps
        );
        // Check specifically for the scene property
        if (!terrainBuilderProps || !terrainBuilderProps.scene) {
            console.error(
                "[SchematicPlacementTool] ERROR: Scene object is missing in terrainBuilderProps!"
            );
            // Avoid calling super or accessing this.scene if it's missing
            // This prevents the immediate error, but the tool won't work correctly.
            return; // Or throw an error?
        }

        super(terrainBuilderProps);
        // Explicitly copy the function if it exists in props
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
            // Consider how to handle this error - maybe prevent the tool from being usable
        }
        this.name = "SchematicPlacementTool";
        this.schematicData = null;
        this.previewGroup = new THREE.Group();
        this.previewMeshes = {}; // Store meshes by relative position string "x,y,z"
        this.anchorOffset = new THREE.Vector3(0, 0, 0); // Offset from cursor to schematic anchor (e.g., corner)

        // Now that we've checked this.scene should be initialized by super()
        if (this.scene) {
            this.scene.add(this.previewGroup);
        } else {
            // This case shouldn't happen if the check above passes and super() works, but added for safety
            console.error(
                "[SchematicPlacementTool] ERROR: this.scene is still undefined after super() call!"
            );
        }

        // Use a shared geometry and different materials for efficiency
        this.previewGeometry = new THREE.BoxGeometry(1, 1, 1);
    }

    // Override onActivate (called by BaseTool's activate)
    onActivate(schematicData) {
        if (!schematicData || Object.keys(schematicData).length === 0) {
            console.warn(
                "SchematicPlacementTool activated without valid schematic data."
            );
            // this.deactivate(); // BaseTool's activate won't proceed if onActivate returns false/throws
            return false; // Indicate activation failed
        }
        // super.activate(); // No longer needed, BaseTool handles this
        this.schematicData = schematicData;
        this.previewGroup.visible = true;
        console.log(
            "SchematicPlacementTool specific activation with data:",
            this.schematicData
        );
        // Calculate anchor offset if needed (e.g., center the schematic)
        // For now, we assume the origin (0,0,0 in schematic) aligns with the cursor
        this.updatePreview(); // Initial preview update
        return true; // Indicate activation succeeded
    }

    // Override onDeactivate (called by BaseTool's deactivate)
    onDeactivate() {
        // super.deactivate(); // No longer needed, BaseTool handles this
        this.schematicData = null;
        this.previewGroup.visible = false;
        this.clearPreviewMeshes();
        console.log("SchematicPlacementTool specific deactivation");
        // Notify App.js to clear the schematic state if needed
        if (this.terrainBuilderProps.clearAISchematic) {
            this.terrainBuilderProps.clearAISchematic();
        }
    }

    handleMouseMove(event, intersectionPoint) {
        if (!this.isActive || !this.schematicData) return; // Use the getter from BaseTool
        // Update preview position based on intersectionPoint
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

        // Optimize: Only update positions, don't recreate meshes if schematic hasn't changed
        for (const [relPosStr, blockId] of Object.entries(this.schematicData)) {
            const [relX, relY, relZ] = relPosStr.split(",").map(Number);
            const worldX = basePosition.x + relX + this.anchorOffset.x;
            const worldY = basePosition.y + relY + this.anchorOffset.y;
            const worldZ = basePosition.z + relZ + this.anchorOffset.z;

            if (this.previewMeshes[relPosStr]) {
                // Update existing mesh position
                this.previewMeshes[relPosStr].position.set(
                    worldX,
                    worldY,
                    worldZ
                );
            } else {
                // Create new preview mesh
                const blockType = blockTypes.find((b) => b.id === blockId);
                const color = blockType ? 0x00ff00 : 0xff00ff; // Green for known, magenta for unknown

                // Use BlockMaterial instance for consistent visuals, or fallback
                let material;
                if (BlockMaterial.instance) {
                    // Clone the material to avoid modifying the original
                    // We need a simple, non-textured, transparent material for preview
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

        // Optional: Remove preview meshes for blocks that are no longer in schematicData (if it can change dynamically)
        // Not needed if schematicData is static after activation
    }

    handleMouseDown(event, intersectionPoint, button) {
        if (!this.isActive || !this.schematicData) return; // Use the getter

        if (button === 0) {
            // Left mouse button for placement
            this.placeSchematic();
        } else if (button === 2) {
            // Right mouse button for cancellation
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
        // Add rotation handling? (e.g., R key)
        // Add anchor point adjustment? (e.g., arrow keys)
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

        console.log(
            `Placing schematic at base position: ${basePosition.x},${basePosition.y},${basePosition.z}`
        );

        for (const [relPosStr, blockId] of Object.entries(this.schematicData)) {
            const [relX, relY, relZ] = relPosStr.split(",").map(Number);
            // Round world coordinates to align with the grid
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

        // Call the TerrainBuilder function copied to the instance
        if (this.updateTerrainForUndoRedo) {
            this.updateTerrainForUndoRedo(
                addedBlocks,
                removedBlocks,
                "ai-schematic"
            );

            if (this.undoRedoManager && this.undoRedoManager.current) {
                const changes = {
                    terrain: { added: addedBlocks, removed: removedBlocks },
                    environment: { added: [], removed: [] },
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

        // Instead of deactivating, switch back to the brush tool
        if (this.terrainBuilderProps.activateTool) {
            console.log("Schematic placed, activating Brush tool...");
            this.terrainBuilderProps.activateTool("brush");
        } else {
            // Fallback to deactivate if activateTool isn't available for some reason
            console.warn(
                "activateTool not found in props, deactivating schematic tool."
            );
            this.deactivate();
        }
    }

    clearPreviewMeshes() {
        // Remove all children from the group
        while (this.previewGroup.children.length > 0) {
            const mesh = this.previewGroup.children[0];
            this.previewGroup.remove(mesh);
            // Dispose material and geometry if they are unique to this preview
            // Since we use shared geometry and basic materials, disposal might not be strictly needed
            // if (mesh.material) mesh.material.dispose();
            // if (mesh.geometry) mesh.geometry.dispose(); // Don't dispose shared geometry
        }
        this.previewMeshes = {};
    }

    dispose() {
        // Ensure preview meshes are cleaned up when the tool is completely disposed
        this.clearPreviewMeshes();
        // Remove the group from the scene
        if (this.scene) {
            this.scene.remove(this.previewGroup);
        }
        // Dispose shared geometry
        if (this.previewGeometry) {
            this.previewGeometry.dispose();
            this.previewGeometry = null;
        }
        console.log("SchematicPlacementTool disposed");
    }
}

export default SchematicPlacementTool;
