import * as THREE from "three";
import BaseTool from "./BaseTool";
import { ENVIRONMENT_OBJECT_Y_OFFSET } from "../Constants";
import QuickTipsManager from "../components/QuickTipsManager";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";
import { SchematicData } from "../utils/SchematicPreviewRenderer";
import { generateUniqueId } from "../components/AIAssistantPanel";

type SelectionMode = "move" | "copy" | "delete";

class SelectionTool extends BaseTool {
    selectionStartPosition = null;
    selectionPreview = null;
    selectedBlocks = null;
    selectedEnvironments = null;
    selectionActive = false;
    selectionMode: SelectionMode = "move";
    moveOffset = new THREE.Vector3();
    originalPositions = new Map();
    originalEnvironmentPositions = new Map();
    selectionHeight = 1;
    verticalOffset = 0;
    rotation = 0;
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
            "Selection Tool: Click to start selection, click again to confirm. Use 1 | 2 to adjust height. Press 3 to switch between move, copy and delete mode. Click and drag to move selection. Press Escape to cancel.";
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
        this.selectionActive = false;
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
        this.selectionActive = false;
    }

    handleMouseDown(event, position, button) {
        if (!this.previewPositionRef?.current) return;

        const currentPosition = this.previewPositionRef.current;

        if (button === 0) {
            if (
                (this.selectedBlocks || this.selectedEnvironments) &&
                this.selectionActive
            ) {
                // Place the selection
                this.placeSelection();
                this.selectedBlocks = null;
                this.selectedEnvironments = null;
                this.selectionActive = false;
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
            this.selectionActive
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
                this.selectionActive = false;
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
            if (this.selectionActive) {
                this.verticalOffset -= 1;
                this.updateSelectionPreview(
                    this.previewPositionRef.current,
                    this.previewPositionRef.current
                );
            } else {
                this.setSelectionHeight(Math.max(1, this.selectionHeight - 1));
            }
        } else if (event.key === "2") {
            if (this.selectionActive) {
                this.verticalOffset += 1;
                this.updateSelectionPreview(
                    this.previewPositionRef.current,
                    this.previewPositionRef.current
                );
            } else {
                this.setSelectionHeight(this.selectionHeight + 1);
            }
        } else if (event.key === "3" && this.selectionActive) {
            this.rotation = (this.rotation + 1) % 4;
            this.updateSelectionPreview(
                this.previewPositionRef.current,
                this.previewPositionRef.current
            );
        } else if (
            event.key === "3" &&
            !this.selectionActive &&
            this.selectionStartPosition
        ) {
            this.cycleSelectionMode();
        } else if (event.key.toLowerCase() === "t" && this.selectionActive) {
            event.preventDefault();
            this.handleSaveSelectionAsSchematic();
        }
    }

    cycleSelectionMode() {
        this.selectionMode =
            this.selectionMode === "move"
                ? "copy"
                : this.selectionMode === "copy"
                ? "delete"
                : "move";

        this.updateSelectionPreview(
            this.selectionStartPosition,
            this.previewPositionRef.current
        );

        this.tooltip = `Selection Mode: ${this.selectionMode}`;
        QuickTipsManager.setToolTip(this.tooltip);
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
        if (this.selectionActive) {
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
                color:
                    this.selectionMode === "copy"
                        ? 0xffff00 // yellow for copy
                        : this.selectionMode === "delete"
                        ? 0xff4e4e // red for delete
                        : 0x4e8eff, // blue for move
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
                        if (this.selectionMode !== "copy") {
                            removedBlocksObj[posKey] = blockId;
                            delete this.terrainRef.current[posKey];
                            delete this.pendingChangesRef.current.terrain.added[
                                posKey
                            ];
                        }
                    }
                }
            }
        }

        if (this.selectionMode !== "copy") {
            this.pendingChangesRef.current.terrain.removed = {
                ...this.pendingChangesRef.current.terrain.removed,
                ...removedBlocksObj,
            };

            this.changes.terrain.removed = removedBlocksObj;
        }

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
                    if (this.selectionMode !== "copy") {
                        this.environmentBuilderRef.current.removeInstance(
                            envObj.modelUrl,
                            envObj.instanceId,
                            false
                        );
                        this.changes.environment.removed.push(envObj);
                    }
                }
            }
        }

        console.log("selectedEnvironments", this.selectedEnvironments);

        if (blockCount > 0 && this.selectionMode !== "delete") {
            this.selectionCenter = new THREE.Vector3(
                totalX / blockCount,
                baseY,
                totalZ / blockCount
            );
        }

        if (
            this.selectedBlocks.size > 0 ||
            this.selectedEnvironments.size > 0
        ) {
            // Update terrain to reflect removed blocks
            if (
                this.terrainBuilderRef?.current &&
                this.selectionMode !== "copy"
            ) {
                this.terrainBuilderRef.current.updateTerrainBlocks(
                    {},
                    removedBlocksObj,
                    { skipUndoSave: true }
                );
            }

            if (this.selectionMode === "delete") {
                this.undoRedoManager.current.saveUndo(this.changes);
                this.selectionHeight = 1;
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
                this.selectionStartPosition = null;
                this.selectedBlocks = null;
                this.selectedEnvironments = null;
                this.selectionActive = false;
                this.moveOffset = new THREE.Vector3();
                this.verticalOffset = 0;
                this.rotation = 0;
                this.deactivate();
                return;
            }

            this.selectionActive = true;
            this.moveOffset = new THREE.Vector3();
            this.updateSelectionPreview(this.selectionStartPosition, endPos);

            // Update tooltip with detailed instructions
            this.tooltip =
                "Selection Active: Click and drag to move. Use 1 | 2 to adjust height. Press 3 to rotate (0° → 90° → 180° → 270°). Click to place. Press Escape to cancel. Press T to save as schematic.";
            QuickTipsManager.setToolTip(this.tooltip);
        } else {
            this.selectionStartPosition = null;
            this.removeSelectionPreview();
            this.deactivate();
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

                    // If we're copying, use null for instanceId to generate a new one
                    // If we're moving, keep the original instanceId
                    const instanceId =
                        this.selectionMode === "copy"
                            ? null
                            : envObj.instanceId;

                    // Create a new environment object at the new position
                    this.environmentBuilderRef.current.placeEnvironmentModelWithoutSaving(
                        modelType,
                        tempMesh,
                        instanceId
                    );
                    this.changes.environment.added.push({
                        ...envObj,
                        position: newPos,
                        instanceId: instanceId, // This will be updated by placeEnvironmentModelWithoutSaving if it's a copy
                    });
                }
            }
        }

        console.log("undoRedoManager", this.undoRedoManager);
        this.undoRedoManager.current.saveUndo(this.changes);

        this.selectedBlocks = null;
        this.selectedEnvironments = null;
        this.selectionActive = false;
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
        this.selectionActive = false;
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

    areSchematicsIdentical(s1: SchematicData, s2: SchematicData): boolean {
        const keys1 = Object.keys(s1);
        const keys2 = Object.keys(s2);

        if (keys1.length !== keys2.length) {
            return false;
        }

        for (const key of keys1) {
            if (s1[key] !== s2[key]) {
                return false;
            }
        }
        return true;
    }

    async handleSaveSelectionAsSchematic() {
        if (
            !this.selectionActive ||
            !this.selectedBlocks ||
            this.selectedBlocks.size === 0
        ) {
            QuickTipsManager.setToolTip("No blocks selected to save.");
            setTimeout(() => QuickTipsManager.setToolTip(this.tooltip), 2000);
            return;
        }

        const schematicName = window.prompt(
            "Enter a name for the schematic:",
            "My Schematic"
        );
        if (!schematicName) {
            QuickTipsManager.setToolTip("Save cancelled.");
            setTimeout(() => QuickTipsManager.setToolTip(this.tooltip), 1500);
            return;
        }

        const schematicDataToSave: SchematicData = {};
        let minX = Infinity,
            minY = Infinity,
            minZ = Infinity;

        for (const posKey of this.selectedBlocks.keys()) {
            const [x, y, z] = posKey.split(",").map(Number);
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            minZ = Math.min(minZ, z);
        }

        for (const [posKey, blockId] of this.selectedBlocks) {
            const [x, y, z] = posKey.split(",").map(Number);
            const relX = x - minX;
            const relY = y - minY;
            const relZ = z - minZ;
            schematicDataToSave[`${relX},${relY},${relZ}`] = blockId;
        }

        try {
            const db = await DatabaseManager.getDBConnection();
            const readTx = db.transaction(STORES.SCHEMATICS, "readonly");
            const store = readTx.objectStore(STORES.SCHEMATICS);
            const getAllRequest = store.getAll();

            getAllRequest.onerror = (event) => {
                console.error(
                    "Error fetching existing schematics:",
                    (event.target as IDBRequest).error
                );
                QuickTipsManager.setToolTip(
                    "Error checking schematics. See console."
                );
                setTimeout(
                    () => QuickTipsManager.setToolTip(this.tooltip),
                    3000
                );
            };

            getAllRequest.onsuccess = async (event) => {
                const existingSchematics = (event.target as IDBRequest).result;
                if (existingSchematics && Array.isArray(existingSchematics)) {
                    for (const existing of existingSchematics) {
                        if (
                            existing.schematic &&
                            this.areSchematicsIdentical(
                                schematicDataToSave,
                                existing.schematic
                            )
                        ) {
                            console.log(
                                "Duplicate schematic found:",
                                existing.prompt
                            );
                            QuickTipsManager.setToolTip(
                                `Schematic "${existing.prompt}" already exists.`
                            );
                            setTimeout(
                                () => QuickTipsManager.setToolTip(this.tooltip),
                                3000
                            );
                            return;
                        }
                    }
                }

                // If no duplicate found, proceed to save
                const newSchematicEntry = {
                    prompt: schematicName,
                    schematic: schematicDataToSave,
                    timestamp: Date.now(),
                };

                try {
                    const writeTx = db.transaction(
                        STORES.SCHEMATICS,
                        "readwrite"
                    );
                    const writeStore = writeTx.objectStore(STORES.SCHEMATICS);
                    const newId = generateUniqueId();
                    await writeStore.add(newSchematicEntry, newId);
                    await writeTx.done;

                    console.log(
                        `Schematic "${schematicName}" (ID: ${newId}) saved successfully!`
                    );
                    QuickTipsManager.setToolTip(
                        `Schematic "${schematicName}" saved!`
                    );
                    setTimeout(
                        () => QuickTipsManager.setToolTip(this.tooltip),
                        2000
                    );
                    window.dispatchEvent(
                        new CustomEvent("schematicsDbUpdated")
                    );
                } catch (writeError) {
                    console.error("Error saving new schematic:", writeError);
                    QuickTipsManager.setToolTip("Error saving. See console.");
                    setTimeout(
                        () => QuickTipsManager.setToolTip(this.tooltip),
                        3000
                    );
                }
            };
        } catch (error) {
            console.error("Error saving schematic:", error);
            QuickTipsManager.setToolTip("Error saving. See console.");
            setTimeout(() => QuickTipsManager.setToolTip(this.tooltip), 3000);
        }
    }
}

export default SelectionTool;
