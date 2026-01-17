import * as THREE from "three";
import BaseTool from "./BaseTool";
import { ENVIRONMENT_OBJECT_Y_OFFSET } from "../Constants";
import QuickTipsManager from "../components/QuickTipsManager";
import ToastManager from "../components/ToastManager";
import { SchematicNameModalManager } from "../components/SchematicNameModal";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";
import { SchematicData } from "../utils/SchematicPreviewRenderer";
import { generateUniqueId } from "../components/AIAssistantPanel";
import {
    raycastEntities,
    EntityRaycastResult,
} from "../utils/EntityRaycastUtils";
import { environmentModels } from "../EnvironmentBuilder";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

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

    // Entity selection properties
    hoveredEntity: EntityRaycastResult | null = null;
    hoveredEntityBoundingBox: THREE.Group | null = null;
    selectedEntity: {
        modelUrl: string;
        instanceId: number;
        name: string;
        originalPosition: THREE.Vector3;
        originalRotation: THREE.Euler;
        originalScale: THREE.Vector3;
        currentPosition: THREE.Vector3;
        currentRotation: THREE.Euler;
        currentScale: THREE.Vector3;
        currentTag?: string;
    } | null = null;
    selectedEntityBoundingBox: THREE.Group | null = null;

    // Raycaster and camera references for entity detection
    threeRaycaster: THREE.Raycaster | null = null;
    threeCamera: THREE.Camera | null = null;
    pointer: THREE.Vector2 | null = null;
    gl: THREE.WebGLRenderer | null = null;

    // Gizmo system properties
    transformControls: TransformControls | null = null;
    gizmoMode: "translate" | "rotate" | "scale" = "translate";
    gizmoObject: THREE.Object3D | null = null; // Helper object for gizmo attachment
    isManipulating: boolean = false;
    manipulationStartTransform: {
        position: THREE.Vector3;
        rotation: THREE.Euler;
        scale: THREE.Vector3;
    } | null = null;
    // Bound event handlers for proper cleanup
    onGizmoChangeBound: (() => void) | null = null;
    onDraggingChangedBound: ((event: any) => void) | null = null;
    onGizmoMouseDownBound: (() => void) | null = null;
    onGizmoMouseUpBound: (() => void) | null = null;
    // Sidebar event handlers
    handleSidebarPositionChange: ((e: CustomEvent) => void) | null = null;
    handleSidebarRotationChange: ((e: CustomEvent) => void) | null = null;
    handleSidebarScaleChange: ((e: CustomEvent) => void) | null = null;
    handleSidebarTagChange: ((e: CustomEvent) => void) | null = null;
    handleUndoRedoComplete: (() => void) | null = null;

    // Copy/paste properties
    copiedEntity: {
        modelUrl: string;
        name: string;
        position: THREE.Vector3;
        rotation: THREE.Euler;
        scale: THREE.Vector3;
    } | null = null;

    // Flag to indicate if we should hide the preview block
    shouldHidePreviewBlock(): boolean {
        return !!(this.hoveredEntity || this.selectedEntity);
    }

    constructor(terrainBuilderProps) {
        super(terrainBuilderProps);
        this.name = "selection";
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
            this.threeRaycaster = terrainBuilderProps.threeRaycaster;
            this.threeCamera = terrainBuilderProps.threeCamera;
            this.pointer = terrainBuilderProps.pointer;
            this.gl = terrainBuilderProps.gl;
        }

        // Initialize gizmo mode
        this.gizmoMode = "translate";

        // Listen for sidebar changes (when user edits values in EntityOptionsSection)
        this.handleSidebarPositionChange = (e: CustomEvent) => {
            if (this.selectedEntity && e.detail.position) {
                // Store original transform for undo if not already stored
                if (!this.manipulationStartTransform) {
                    this.manipulationStartTransform = {
                        position: this.selectedEntity.currentPosition.clone(),
                        rotation: this.selectedEntity.currentRotation.clone(),
                        scale: this.selectedEntity.currentScale.clone(),
                    };
                }
                this.selectedEntity.currentPosition.copy(e.detail.position);
                this.updateGizmoPosition();
                this.updateEntityInstanceTransform();
                this.updateSelectedEntityBoundingBox();
                // Commit changes immediately when sidebar value changes
                this.commitEntityChanges();
            }
        };

        this.handleSidebarRotationChange = (e: CustomEvent) => {
            if (this.selectedEntity && e.detail.rotation) {
                // Store original transform for undo if not already stored
                if (!this.manipulationStartTransform) {
                    this.manipulationStartTransform = {
                        position: this.selectedEntity.currentPosition.clone(),
                        rotation: this.selectedEntity.currentRotation.clone(),
                        scale: this.selectedEntity.currentScale.clone(),
                    };
                }
                this.selectedEntity.currentRotation.copy(e.detail.rotation);
                this.updateGizmoPosition();
                this.updateEntityInstanceTransform();
                this.updateSelectedEntityBoundingBox();
                // Commit changes immediately when sidebar value changes
                this.commitEntityChanges();
            }
        };

        this.handleSidebarScaleChange = (e: CustomEvent) => {
            if (this.selectedEntity && e.detail.scale) {
                // Store original transform for undo if not already stored
                if (!this.manipulationStartTransform) {
                    this.manipulationStartTransform = {
                        position: this.selectedEntity.currentPosition.clone(),
                        rotation: this.selectedEntity.currentRotation.clone(),
                        scale: this.selectedEntity.currentScale.clone(),
                    };
                }
                this.selectedEntity.currentScale.copy(e.detail.scale);
                this.updateGizmoPosition();
                this.updateEntityInstanceTransform();
                this.updateSelectedEntityBoundingBox();
                // Commit changes immediately when sidebar value changes
                this.commitEntityChanges();
            }
        };

        this.handleSidebarTagChange = (e: CustomEvent) => {
            if (this.selectedEntity && this.environmentBuilderRef?.current) {
                const tag = e.detail.tag;
                // Update local state
                this.selectedEntity.currentTag = tag || undefined;
                // Update in EnvironmentBuilder and save to database
                this.environmentBuilderRef.current.updateEntityTag(
                    this.selectedEntity.modelUrl,
                    this.selectedEntity.instanceId,
                    tag || undefined
                );
            }
        };

        window.addEventListener(
            "entity-position-changed",
            this.handleSidebarPositionChange
        );
        window.addEventListener(
            "entity-rotation-changed",
            this.handleSidebarRotationChange
        );
        window.addEventListener(
            "entity-scale-changed",
            this.handleSidebarScaleChange
        );
        window.addEventListener(
            "entity-tag-changed",
            this.handleSidebarTagChange
        );

        // Listen for undo/redo completion to check if selected entity still exists
        this.handleUndoRedoComplete = () => {
            if (this.selectedEntity) {
                // Check if the selected entity still exists after undo/redo
                this.checkSelectedEntityExists();
            }
        };
        window.addEventListener("undo-complete", this.handleUndoRedoComplete);
        window.addEventListener("redo-complete", this.handleUndoRedoComplete);
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
        // Don't dispose gizmo here - keep it if entity is still selected

        // Trigger preview visibility update when tool activates
        // This ensures preview is hidden if entity is already selected
        window.dispatchEvent(new CustomEvent("entity-hover-changed"));

        return true;
    }

    onDeactivate() {
        super.onDeactivate();
        this.removeSelectionPreview();
        this.disposeGizmo();
        this.deselectEntity();
        this.selectionStartPosition = null;
        this.selectedBlocks = null;
        this.selectedEnvironments = null;
        this.selectionActive = false;
        if (this.toolManagerRef?.current?.activateTool) {
            this.toolManagerRef.current.activateTool(null);
        }
    }

    handleMouseDown(event, position, button) {
        if (!this.previewPositionRef?.current) return;

        const currentPosition = this.previewPositionRef.current;

        if (button === 0) {
            // IMPORTANT: Don't process mouse events if TransformControls is active
            // TransformControls handles its own mouse interaction
            if (this.transformControls && this.isManipulating) {
                // Let TransformControls handle this
                return;
            }

            // Check if mouse is over TransformControls gizmo
            // TransformControls uses its own raycasting, so we need to check if it's being dragged
            if (this.transformControls && this.selectedEntity) {
                // If TransformControls exists and entity is selected, let it handle the interaction
                // We'll only deselect if clicking truly empty space (not on gizmo)
                // TransformControls will set isManipulating when dragging starts
                // For now, skip deselection when gizmo is active - let TransformControls handle it
                // The dragging-changed event will tell us when manipulation starts/ends
            }

            // Check for entity selection first (if hovering over an entity)
            if (
                this.hoveredEntity &&
                !this.selectedEntity &&
                !this.selectionStartPosition
            ) {
                // Select the hovered entity
                this.selectEntity(this.hoveredEntity);
                return;
            }

            // Deselect entity if clicking empty space
            // BUT: Don't deselect if we're currently manipulating the gizmo
            // TransformControls handles its own pointer events, so if isManipulating is false
            // and we click empty space, it means TransformControls didn't intercept the click
            if (this.selectedEntity && !this.hoveredEntity) {
                // Only deselect if we're not currently manipulating
                // If TransformControls intercepts the click, isManipulating will be true
                if (!this.isManipulating) {
                    this.deselectEntity();
                    // Don't start area selection when deselecting entity
                    return;
                }
                // If we're manipulating, let TransformControls handle it
                return;
            }

            if (
                (this.selectedBlocks || this.selectedEnvironments) &&
                this.selectionActive
            ) {
                // Place the selection
                this.placeSelection();
                // Reset all selection-related state
                this.resetSelectionState();
            } else if (this.selectionStartPosition) {
                // Complete the selection
                this.completeSelection(currentPosition);
            } else if (!this.selectedEntity) {
                // Start new selection (only if no entity is selected)
                this.selectionStartPosition = currentPosition.clone();
                this.updateSelectionPreview(
                    this.selectionStartPosition,
                    currentPosition
                );
            }
        }
    }

    selectEntity(entityResult: EntityRaycastResult) {
        // Get the tag from EnvironmentBuilder if available
        let currentTag: string | undefined = undefined;
        if (this.environmentBuilderRef?.current?.getEntityTag) {
            currentTag = this.environmentBuilderRef.current.getEntityTag(
                entityResult.entity.modelUrl,
                entityResult.entity.instanceId
            );
        }

        // Store entity selection
        this.selectedEntity = {
            modelUrl: entityResult.entity.modelUrl,
            instanceId: entityResult.entity.instanceId,
            name: entityResult.entity.name,
            originalPosition: entityResult.entity.position.clone(),
            originalRotation: entityResult.entity.rotation.clone(),
            originalScale: entityResult.entity.scale.clone(),
            currentPosition: entityResult.entity.position.clone(),
            currentRotation: entityResult.entity.rotation.clone(),
            currentScale: entityResult.entity.scale.clone(),
            currentTag,
        };

        // Remove hover bounding box and show selected bounding box
        this.removeHoveredEntityBoundingBox();
        this.updateSelectedEntityBoundingBox();

        // Clear hover state
        this.hoveredEntity = null;

        // Setup gizmo for the selected entity
        this.setupGizmo();

        // Update tooltip
        this.tooltip = `Entity Selected: ${this.selectedEntity.name}. Use gizmo to manipulate or edit in sidebar. Press G/R/S to switch modes.`;
        QuickTipsManager.setToolTip(this.tooltip);

        // Dispatch event for sidebar to update
        window.dispatchEvent(
            new CustomEvent("entity-selected", {
                detail: { entity: this.selectedEntity },
            })
        );
    }

    deselectEntity() {
        if (this.selectedEntity) {
            // Commit any pending changes before deselecting
            if (this.isManipulating) {
                this.commitEntityChanges();
            }

            this.removeSelectedEntityBoundingBox();
            this.disposeGizmo();
            this.selectedEntity = null;
            this.tooltip = this.originalTooltip;
            QuickTipsManager.setToolTip(this.tooltip);

            // Dispatch event for sidebar to update
            window.dispatchEvent(new CustomEvent("entity-deselected"));
        }
    }

    deleteSelectedEntity() {
        if (!this.selectedEntity || !this.environmentBuilderRef?.current) {
            return;
        }

        // Store entity info before deletion
        const modelUrl = this.selectedEntity.modelUrl;
        const instanceId = this.selectedEntity.instanceId;
        const entityName = this.selectedEntity.name;

        // Remove the entity instance
        // removeInstance handles undo/redo internally
        this.environmentBuilderRef.current.removeInstance(
            modelUrl,
            instanceId,
            true // updateUndoRedo = true
        );

        // Deselect the entity (this will clean up gizmo, bounding box, etc.)
        this.deselectEntity();

        // Update tooltip to confirm deletion
        QuickTipsManager.setToolTip(`Entity "${entityName}" deleted`);
        setTimeout(() => {
            QuickTipsManager.setToolTip(this.tooltip);
        }, 2000);
    }

    handleMouseMove(event, position) {
        if (!this.previewPositionRef?.current) return;

        const currentPosition = this.previewPositionRef.current;

        // First, check for entity hover (if no area selection is active)
        if (
            !this.selectionStartPosition &&
            !this.selectedBlocks &&
            !this.selectedEnvironments &&
            !this.selectedEntity
        ) {
            const hadHover = !!this.hoveredEntity;
            this.updateEntityHover();
            const hasHover = !!this.hoveredEntity;
            // Dispatch event if hover state changed
            if (hadHover !== hasHover) {
                window.dispatchEvent(new CustomEvent("entity-hover-changed"));
            }
        }

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
        // Handle copy shortcut when entity is selected
        if (this.selectedEntity) {
            // Check for copy (Cmd/Ctrl+C)
            if (
                (event.ctrlKey || event.metaKey) &&
                event.key.toLowerCase() === "c"
            ) {
                // Prevent default browser copy behavior
                const target = event.target as HTMLElement;
                const isInput =
                    target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.isContentEditable;

                // Only handle copy if not in an input field
                if (!isInput) {
                    event.preventDefault();
                    this.copyEntity();
                    return;
                }
            }
        }

        // Handle paste shortcut (works even when no entity is selected)
        // Check for paste (Cmd/Ctrl+V)
        if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "v"
        ) {
            // Prevent default browser paste behavior
            const target = event.target as HTMLElement;
            const isInput =
                target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.isContentEditable;

            // Only handle paste if not in an input field
            if (!isInput) {
                event.preventDefault();
                this.pasteEntity();
                return;
            }
        }

        // Handle entity-specific keyboard shortcuts when entity is selected
        if (this.selectedEntity) {
            if (event.key === "Escape") {
                // Deselect entity on Escape
                this.deselectEntity();
                return;
            } else if (event.key === "Backspace" || event.key === "Delete") {
                // Delete selected entity on Backspace/Delete
                event.preventDefault();
                this.deleteSelectedEntity();
                return;
            }
        }

        if (event.key === "Escape") {
            if (this.selectedBlocks || this.selectedEnvironments) {
                this.resetSelectionState();
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

        // Create a group to hold preview meshes (or instanced meshes)
        const previewGroup = new THREE.Group();

        const createInstancedPreview = (
            positions: THREE.Vector3[],
            color: number,
            scaleFactor: number = 1
        ) => {
            if (positions.length === 0) return;
            const geom = new THREE.BoxGeometry(1, 1, 1);
            const mat = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0.5,
                depthWrite: true,
            });
            const instanced = new THREE.InstancedMesh(
                geom,
                mat,
                positions.length
            );
            const dummy = new THREE.Object3D();
            positions.forEach((pos, idx) => {
                dummy.position.copy(pos);
                dummy.scale.setScalar(scaleFactor);
                dummy.updateMatrix();
                instanced.setMatrixAt(idx, dummy.matrix);
            });
            instanced.instanceMatrix.needsUpdate = true;
            // Draw on top of regular blocks
            instanced.renderOrder = 999;
            previewGroup.add(instanced);
        };

        if (this.selectionActive) {
            const blockPositions: THREE.Vector3[] = [];
            const envPositions: THREE.Vector3[] = [];

            if (this.selectedBlocks) {
                for (const [posKey] of this.selectedBlocks) {
                    const originalPos = this.originalPositions.get(posKey);
                    if (!originalPos) continue;
                    const rotatedPos = this.rotatePosition(
                        originalPos,
                        this.selectionCenter
                    );
                    blockPositions.push(
                        new THREE.Vector3(
                            rotatedPos.x + this.moveOffset.x,
                            rotatedPos.y +
                                this.moveOffset.y +
                                this.verticalOffset,
                            rotatedPos.z + this.moveOffset.z
                        )
                    );
                }
            }

            if (this.selectedEnvironments) {
                for (const [envKey] of this.selectedEnvironments) {
                    const originalPos =
                        this.originalEnvironmentPositions.get(envKey);
                    if (!originalPos) continue;
                    const rotatedPos = this.rotatePosition(
                        new THREE.Vector3(
                            originalPos.x,
                            originalPos.y,
                            originalPos.z
                        ),
                        this.selectionCenter
                    );
                    envPositions.push(
                        new THREE.Vector3(
                            rotatedPos.x + this.moveOffset.x,
                            rotatedPos.y +
                                this.moveOffset.y +
                                this.verticalOffset,
                            rotatedPos.z + this.moveOffset.z
                        )
                    );
                }
            }

            createInstancedPreview(blockPositions, 0x4eff4e, 1);
            createInstancedPreview(envPositions, 0x4eff9e, 1.2);
        } else {
            const minX = Math.min(Math.round(startPos.x), Math.round(endPos.x));
            const maxX = Math.max(Math.round(startPos.x), Math.round(endPos.x));
            const minZ = Math.min(Math.round(startPos.z), Math.round(endPos.z));
            const maxZ = Math.max(Math.round(startPos.z), Math.round(endPos.z));
            const baseY = Math.round(startPos.y);

            const areaPositions: THREE.Vector3[] = [];
            for (let x = minX; x <= maxX; x++) {
                for (let z = minZ; z <= maxZ; z++) {
                    for (let y = 0; y < this.selectionHeight; y++) {
                        areaPositions.push(new THREE.Vector3(x, baseY + y, z));
                    }
                }
            }

            const color =
                this.selectionMode === "copy"
                    ? 0xffff00
                    : this.selectionMode === "delete"
                    ? 0xff4e4e
                    : 0x4e8eff;
            createInstancedPreview(areaPositions, color, 1);
        }

        this.selectionPreview = previewGroup;
        this.scene.add(this.selectionPreview);
    }

    completeSelection(endPos) {
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
                this.resetSelectionState();
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
            this.resetSelectionState();
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

            for (const [posKey, blockId] of this.selectedBlocks) {
                const originalPos = this.originalPositions.get(posKey);
                if (originalPos) {
                    const rotatedPos = this.rotatePosition(
                        originalPos,
                        this.selectionCenter
                    );

                    const finalPos = new THREE.Vector3(
                        rotatedPos.x + this.moveOffset.x,
                        rotatedPos.y + this.moveOffset.y + this.verticalOffset,
                        rotatedPos.z + this.moveOffset.z
                    );

                    const newX = Math.round(finalPos.x);
                    const newY = Math.round(finalPos.y);
                    const newZ = Math.round(finalPos.z);
                    const newPosKey = `${newX},${newY},${newZ}`;

                    addedBlocks[newPosKey] = blockId;
                    this.terrainRef.current[newPosKey] = blockId;
                }
            }

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
                    const rotatedPos = this.rotatePosition(
                        new THREE.Vector3(
                            originalPos.x,
                            originalPos.y,
                            originalPos.z
                        ),
                        this.selectionCenter
                    );

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

                    const tempMesh = new THREE.Object3D();
                    tempMesh.position.set(newPos.x, newPos.y, newPos.z);
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

                    const instanceId =
                        this.selectionMode === "copy"
                            ? null
                            : envObj.instanceId;

                    this.environmentBuilderRef.current.placeEnvironmentModelWithoutSaving(
                        modelType,
                        tempMesh,
                        instanceId
                    );
                    this.changes.environment.added.push({
                        ...envObj,
                        position: newPos,
                        instanceId: instanceId,
                    });
                }
            }
        }

        this.undoRedoManager.current.saveUndo(this.changes);
    }

    resetSelectionState() {
        this.selectedBlocks = null;
        this.selectedEnvironments = null;
        this.selectionActive = false;
        this.selectionStartPosition = null;
        this.moveOffset = new THREE.Vector3();
        this.verticalOffset = 0;
        this.rotation = 0;
        this.removeSelectionPreview();
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
        this.removeHoveredEntityBoundingBox();
        this.removeSelectedEntityBoundingBox();
        this.disposeGizmo();

        // Remove sidebar event listeners
        if (this.handleSidebarPositionChange) {
            window.removeEventListener(
                "entity-position-changed",
                this.handleSidebarPositionChange
            );
        }
        if (this.handleSidebarRotationChange) {
            window.removeEventListener(
                "entity-rotation-changed",
                this.handleSidebarRotationChange
            );
        }
        if (this.handleSidebarScaleChange) {
            window.removeEventListener(
                "entity-scale-changed",
                this.handleSidebarScaleChange
            );
        }
        if (this.handleSidebarTagChange) {
            window.removeEventListener(
                "entity-tag-changed",
                this.handleSidebarTagChange
            );
        }
        if (this.handleUndoRedoComplete) {
            window.removeEventListener(
                "undo-complete",
                this.handleUndoRedoComplete
            );
            window.removeEventListener(
                "redo-complete",
                this.handleUndoRedoComplete
            );
        }

        this.selectionStartPosition = null;
        this.selectedBlocks = null;
        this.selectedEnvironments = null;
        this.selectionActive = false;
        this.hoveredEntity = null;
        this.selectedEntity = null;
        super.dispose();
    }

    // Entity hover detection
    updateEntityHover() {
        if (
            !this.threeRaycaster ||
            !this.environmentBuilderRef?.current ||
            !this.scene ||
            !this.threeCamera ||
            !this.pointer
        ) {
            return;
        }

        // Update raycaster with current pointer position
        this.threeRaycaster.setFromCamera(this.pointer, this.threeCamera);

        // Perform entity raycast
        const result = raycastEntities(
            this.threeRaycaster,
            this.environmentBuilderRef,
            100 // max distance
        );

        // Update hovered entity
        if (result && result.entity) {
            // Only update if it's a different entity
            if (
                !this.hoveredEntity ||
                this.hoveredEntity.entity.instanceId !==
                    result.entity.instanceId ||
                this.hoveredEntity.entity.modelUrl !== result.entity.modelUrl
            ) {
                this.hoveredEntity = result;
                this.updateHoveredEntityBoundingBox(result);
            }
        } else {
            // No entity hovered
            if (this.hoveredEntity) {
                this.hoveredEntity = null;
                this.removeHoveredEntityBoundingBox();
            }
        }
    }

    // Create bounding box for hovered entity
    createEntityBoundingBox(
        entity: EntityRaycastResult,
        color: number = 0x00ffff
    ): THREE.Group {
        const group = new THREE.Group();
        const model = environmentModels.find(
            (m) => m.modelUrl === entity.entity.modelUrl
        );

        if (!model) return group;

        // Get bounding box dimensions
        const baseBboxWidth = model.boundingBoxWidth || 1;
        const baseBboxHeight = model.boundingBoxHeight || 1;
        const baseBboxDepth = model.boundingBoxDepth || 1;
        const bboxCenter =
            model.boundingBoxCenter || new THREE.Vector3(0, 0, 0);

        // Apply entity scale to bounding box dimensions
        const entityScale = entity.entity.scale || new THREE.Vector3(1, 1, 1);
        const bboxWidth = baseBboxWidth * entityScale.x;
        const bboxHeight = baseBboxHeight * entityScale.y;
        const bboxDepth = baseBboxDepth * entityScale.z;

        // Create box geometry with scaled dimensions
        const geometry = new THREE.BoxGeometry(
            bboxWidth,
            bboxHeight,
            bboxDepth
        );

        // Create wireframe edges with thicker appearance using cylindrical tubes
        // Since WebGL doesn't support linewidth, we render edges as small cylinders
        const edges = new THREE.EdgesGeometry(geometry);
        const edgePositions = edges.attributes.position;
        const tubeRadius = 0.08; // Thickness of the edge tubes
        const tubeSegments = 8; // Number of segments around the tube

        // Create reusable tube geometry for thick edges
        const tubeGeometry = new THREE.CylinderGeometry(
            tubeRadius,
            tubeRadius,
            1,
            tubeSegments
        );
        const edgeMaterial = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.95,
        });

        // Render each edge as a cylinder
        for (let i = 0; i < edgePositions.count; i += 2) {
            const start = new THREE.Vector3(
                edgePositions.getX(i),
                edgePositions.getY(i),
                edgePositions.getZ(i)
            );
            const end = new THREE.Vector3(
                edgePositions.getX(i + 1),
                edgePositions.getY(i + 1),
                edgePositions.getZ(i + 1)
            );

            const direction = new THREE.Vector3().subVectors(end, start);
            const length = direction.length();
            if (length < 0.001) continue; // Skip zero-length edges

            const center = new THREE.Vector3()
                .addVectors(start, end)
                .multiplyScalar(0.5);
            const normalizedDirection = direction.clone().normalize();

            const tube = new THREE.Mesh(tubeGeometry, edgeMaterial);
            tube.position.copy(center);
            tube.scale.set(1, length, 1); // Scale along Y axis (cylinder's default orientation)

            // Rotate to align with edge direction
            const up = new THREE.Vector3(0, 1, 0);
            const quaternion = new THREE.Quaternion().setFromUnitVectors(
                up,
                normalizedDirection
            );
            tube.setRotationFromQuaternion(quaternion);

            group.add(tube);
        }

        // Also add traditional line segments for better edge definition
        const lineMaterial = new THREE.LineBasicMaterial({
            color: color,
            transparent: true,
            opacity: 1.0,
        });
        const wireframe = new THREE.LineSegments(edges, lineMaterial);
        group.add(wireframe);

        // Position the bounding box group at entity position + rotated scaled center offset
        // Scale the center offset by the entity scale to maintain correct positioning
        const scaledBboxCenter = bboxCenter.clone().multiply(entityScale);
        // Rotate the offset to match entity rotation (same as gizmo positioning)
        const rotatedOffset = scaledBboxCenter.clone();
        rotatedOffset.applyEuler(entity.entity.rotation);
        const worldPos = entity.entity.position.clone().add(rotatedOffset);
        group.position.copy(worldPos);
        group.rotation.copy(entity.entity.rotation);

        return group;
    }

    updateHoveredEntityBoundingBox(entity: EntityRaycastResult) {
        this.removeHoveredEntityBoundingBox();
        this.hoveredEntityBoundingBox = this.createEntityBoundingBox(
            entity,
            0x00ffff
        ); // Cyan for hover
        if (this.hoveredEntityBoundingBox && this.scene) {
            this.scene.add(this.hoveredEntityBoundingBox);
        }
    }

    removeHoveredEntityBoundingBox() {
        if (this.hoveredEntityBoundingBox && this.scene) {
            this.scene.remove(this.hoveredEntityBoundingBox);
            // Dispose geometry and material
            this.hoveredEntityBoundingBox.traverse((child) => {
                if (child instanceof THREE.LineSegments) {
                    child.geometry.dispose();
                    if (child.material instanceof THREE.Material) {
                        child.material.dispose();
                    }
                }
            });
            this.hoveredEntityBoundingBox = null;
        }
    }

    // Helper to position bounding box group
    positionBoundingBoxGroup(group: THREE.Group, entity: EntityRaycastResult) {
        const model = environmentModels.find(
            (m) => m.modelUrl === entity.entity.modelUrl
        );
        if (!model) return;

        const bboxCenter =
            model.boundingBoxCenter || new THREE.Vector3(0, 0, 0);
        const worldPos = entity.entity.position.clone().add(bboxCenter);
        group.position.copy(worldPos);
        group.rotation.copy(entity.entity.rotation);
    }

    updateSelectedEntityBoundingBox() {
        if (!this.selectedEntity) {
            this.removeSelectedEntityBoundingBox();
            return;
        }

        this.removeSelectedEntityBoundingBox();

        // Create EntityRaycastResult-like object for bounding box creation
        const entityResult: EntityRaycastResult = {
            entity: {
                modelUrl: this.selectedEntity.modelUrl,
                instanceId: this.selectedEntity.instanceId,
                name: this.selectedEntity.name,
                position: this.selectedEntity.currentPosition,
                rotation: this.selectedEntity.currentRotation,
                scale: this.selectedEntity.currentScale,
            },
            distance: 0,
            point: this.selectedEntity.currentPosition.clone(),
        };

        this.selectedEntityBoundingBox = this.createEntityBoundingBox(
            entityResult,
            0xffff00
        ); // Yellow for selected
        if (this.selectedEntityBoundingBox && this.scene) {
            this.scene.add(this.selectedEntityBoundingBox);
        }
    }

    removeSelectedEntityBoundingBox() {
        if (this.selectedEntityBoundingBox && this.scene) {
            this.scene.remove(this.selectedEntityBoundingBox);
            // Dispose geometry and material
            this.selectedEntityBoundingBox.traverse((child) => {
                if (
                    child instanceof THREE.Mesh ||
                    child instanceof THREE.LineSegments
                ) {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material instanceof THREE.Material) {
                        child.material.dispose();
                    }
                }
            });
            this.selectedEntityBoundingBox = null;
        }
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

    // Compare two schematics for equality. Works for both the new wrapper format
    // ( { blocks: {...}, entities?: [...] } ) as well as the legacy plain-object
    // format where the object itself was the blocks mapping.
    areSchematicsIdentical(s1: any, s2: any): boolean {
        const blocks1 = s1 && s1.blocks ? s1.blocks : s1;
        const blocks2 = s2 && s2.blocks ? s2.blocks : s2;

        const keys1 = Object.keys(blocks1);
        const keys2 = Object.keys(blocks2);

        if (keys1.length !== keys2.length) {
            return false;
        }

        for (const key of keys1) {
            if (blocks1[key] !== blocks2[key]) {
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

        const schematicName = await SchematicNameModalManager.promptForName(
            "My Schematic"
        );
        if (!schematicName) {
            QuickTipsManager.setToolTip("Save cancelled.");
            setTimeout(() => QuickTipsManager.setToolTip(this.tooltip), 1500);
            return;
        }

        const blocksData: SchematicData = {};
        const entitiesData: any[] = [];
        let minX = Infinity,
            minY = Infinity,
            minZ = Infinity;

        // Determine bounding box across selected blocks and environment objects (if any)
        for (const posKey of this.selectedBlocks.keys()) {
            const [x, y, z] = posKey.split(",").map(Number);
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            minZ = Math.min(minZ, z);
        }
        if (this.selectedEnvironments && this.selectedEnvironments.size > 0) {
            for (const [, envObj] of this.selectedEnvironments) {
                const { x, y, z } = envObj.position;
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                minZ = Math.min(minZ, z);
            }
        }

        // Populate blocks mapping
        for (const [posKey, blockId] of this.selectedBlocks) {
            const [x, y, z] = posKey.split(",").map(Number);
            const relX = x - minX;
            const relY = y - minY;
            const relZ = z - minZ;
            blocksData[`${relX},${relY},${relZ}`] = blockId;
        }

        // Populate entities list (relative positions)
        if (this.selectedEnvironments && this.selectedEnvironments.size > 0) {
            for (const [, envObj] of this.selectedEnvironments) {
                const relX = envObj.position.x - minX;
                const relY = envObj.position.y - minY;
                const relZ = envObj.position.z - minZ;
                entitiesData.push({
                    entityName: envObj.name,
                    modelUrl: envObj.modelUrl,
                    position: [relX, relY, relZ],
                    rotation: [
                        envObj.rotation?.x || 0,
                        envObj.rotation?.y || 0,
                        envObj.rotation?.z || 0,
                    ],
                    scale: [
                        envObj.scale?.x || 1,
                        envObj.scale?.y || 1,
                        envObj.scale?.z || 1,
                    ],
                });
            }
        }

        const schematicWrapper = {
            blocks: blocksData,
            ...(entitiesData.length > 0 ? { entities: entitiesData } : {}),
        };

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
                                schematicWrapper,
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
                    schematic: schematicWrapper,
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

    // ========== Gizmo System Methods ==========

    setupGizmo() {
        if (!this.selectedEntity || !this.scene || !this.threeCamera) {
            return;
        }

        // Dispose existing gizmo if any
        this.disposeGizmo();

        // Get model info to calculate bounding box center
        const model = environmentModels.find(
            (m) => m.modelUrl === this.selectedEntity.modelUrl
        );
        const bboxCenter =
            model?.boundingBoxCenter || new THREE.Vector3(0, 0, 0);
        const entityScale = this.selectedEntity.currentScale;
        const scaledBboxCenter = bboxCenter.clone().multiply(entityScale);

        // Rotate the offset to match entity rotation
        const rotatedOffset = scaledBboxCenter.clone();
        rotatedOffset.applyEuler(this.selectedEntity.currentRotation);

        // Calculate bounding box center in world space
        // This is where the gizmo should be positioned (same as bounding box rotation pivot)
        const bboxCenterWorld = this.selectedEntity.currentPosition
            .clone()
            .add(rotatedOffset);

        // Create helper object at bounding box center (not entity origin)
        this.gizmoObject = new THREE.Object3D();
        this.gizmoObject.position.copy(bboxCenterWorld);
        this.gizmoObject.rotation.copy(this.selectedEntity.currentRotation);
        this.gizmoObject.scale.copy(this.selectedEntity.currentScale);

        // IMPORTANT: Add gizmoObject to scene BEFORE attaching TransformControls
        // TransformControls requires the attached object to be in the scene graph
        this.scene.add(this.gizmoObject);

        // Get renderer domElement for TransformControls
        // TransformControls needs access to the canvas for mouse events
        let domElement = null;
        if (this.gl?.domElement) {
            domElement = this.gl.domElement;
        } else if (this.terrainBuilderRef?.current?.gl?.domElement) {
            domElement = this.terrainBuilderRef.current.gl.domElement;
        } else if (
            this.scene &&
            (this.scene as any).userData?.renderer?.domElement
        ) {
            domElement = (this.scene as any).userData.renderer.domElement;
        }

        if (!domElement) {
            console.warn(
                "[SelectionTool] Cannot setup gizmo: no DOM element found"
            );
            // Clean up gizmoObject if we can't proceed
            this.scene.remove(this.gizmoObject);
            this.gizmoObject = null;
            return;
        }

        // Create TransformControls
        this.transformControls = new TransformControls(
            this.threeCamera,
            domElement
        );
        this.transformControls.attach(this.gizmoObject);
        this.transformControls.setMode(this.gizmoMode);
        this.transformControls.setSpace("world"); // Use world space by default

        // Configure gizmo appearance
        this.transformControls.setSize(1.0);
        this.transformControls.showX = true;
        this.transformControls.showY = true;
        this.transformControls.showZ = true;

        // Add TransformControls to scene
        // Note: TransformControls manages its own rendering, but needs to be in scene
        this.scene.add(this.transformControls);

        // Set up event listeners with bound methods
        this.transformControls.addEventListener(
            "change",
            (this.onGizmoChangeBound = () => {
                this.onGizmoChange();
            })
        );
        this.transformControls.addEventListener(
            "dragging-changed",
            (this.onDraggingChangedBound = (event: any) => {
                this.onDraggingChanged(event.value);
            })
        );
        this.transformControls.addEventListener(
            "mouseDown",
            (this.onGizmoMouseDownBound = () => {
                console.log(
                    "[SelectionTool] Gizmo mouseDown - preventing deselection"
                );
                this.onGizmoMouseDown();
            })
        );
        this.transformControls.addEventListener(
            "mouseUp",
            (this.onGizmoMouseUpBound = () => {
                this.onGizmoMouseUp();
            })
        );

        // Track if TransformControls is handling pointer events
        // This helps us know when to skip deselection
        this.transformControls.addEventListener("objectChange", () => {
            // This fires when TransformControls starts interacting
        });
    }

    disposeGizmo() {
        if (this.transformControls && this.scene) {
            // Remove event listeners using bound handlers
            if (this.onGizmoChangeBound) {
                this.transformControls.removeEventListener(
                    "change",
                    this.onGizmoChangeBound
                );
            }
            if (this.onDraggingChangedBound) {
                this.transformControls.removeEventListener(
                    "dragging-changed",
                    this.onDraggingChangedBound
                );
            }
            if (this.onGizmoMouseDownBound) {
                this.transformControls.removeEventListener(
                    "mouseDown",
                    this.onGizmoMouseDownBound
                );
            }
            if (this.onGizmoMouseUpBound) {
                this.transformControls.removeEventListener(
                    "mouseUp",
                    this.onGizmoMouseUpBound
                );
            }

            // Remove from scene
            this.scene.remove(this.transformControls);
            this.transformControls.dispose();
            this.transformControls = null;
        }

        if (this.gizmoObject && this.scene) {
            this.scene.remove(this.gizmoObject);
            this.gizmoObject = null;
        }

        // Clear bound handlers
        this.onGizmoChangeBound = null;
        this.onDraggingChangedBound = null;
        this.onGizmoMouseDownBound = null;
        this.onGizmoMouseUpBound = null;

        this.isManipulating = false;
        this.manipulationStartTransform = null;
    }

    setGizmoMode(mode: "translate" | "rotate" | "scale") {
        if (this.gizmoMode === mode) return;

        this.gizmoMode = mode;

        if (this.transformControls) {
            this.transformControls.setMode(mode);
        } else if (this.selectedEntity) {
            // If gizmo doesn't exist yet, recreate it with new mode
            this.setupGizmo();
        }

        // Update tooltip
        const modeNames = {
            translate: "Move",
            rotate: "Rotate",
            scale: "Scale",
        };
        QuickTipsManager.setToolTip(`Gizmo Mode: ${modeNames[mode]}`);

        // Dispatch event for UI updates
        window.dispatchEvent(
            new CustomEvent("gizmo-mode-changed", {
                detail: { mode },
            })
        );
    }

    updateGizmoPosition() {
        if (!this.selectedEntity || !this.gizmoObject) {
            return;
        }

        // Get model info to calculate bounding box center
        const model = environmentModels.find(
            (m) => m.modelUrl === this.selectedEntity.modelUrl
        );
        const bboxCenter =
            model?.boundingBoxCenter || new THREE.Vector3(0, 0, 0);
        const entityScale = this.selectedEntity.currentScale;
        const scaledBboxCenter = bboxCenter.clone().multiply(entityScale);

        // Rotate the offset to match entity rotation
        const rotatedOffset = scaledBboxCenter.clone();
        rotatedOffset.applyEuler(this.selectedEntity.currentRotation);

        // Calculate bounding box center in world space
        const bboxCenterWorld = this.selectedEntity.currentPosition
            .clone()
            .add(rotatedOffset);

        // Sync gizmo helper object with entity transform
        // Position gizmo at bounding box center (rotation pivot)
        this.gizmoObject.position.copy(bboxCenterWorld);
        this.gizmoObject.rotation.copy(this.selectedEntity.currentRotation);
        this.gizmoObject.scale.copy(this.selectedEntity.currentScale);
    }

    onGizmoChange() {
        console.log("[SelectionTool] onGizmoChange called");
        if (!this.gizmoObject || !this.selectedEntity) {
            console.warn(
                "[SelectionTool] onGizmoChange: Missing gizmoObject or selectedEntity",
                {
                    hasGizmoObject: !!this.gizmoObject,
                    hasSelectedEntity: !!this.selectedEntity,
                }
            );
            return;
        }

        // Update entity transform from gizmo helper object
        // Ensure matrix is up to date
        this.gizmoObject.updateMatrixWorld(false);

        // Get model info to calculate bounding box center
        const model = environmentModels.find(
            (m) => m.modelUrl === this.selectedEntity.modelUrl
        );
        const bboxCenter =
            model?.boundingBoxCenter || new THREE.Vector3(0, 0, 0);

        // The gizmoObject is positioned at the bounding box center
        // We need to calculate the entity origin position from this
        const newScale = this.gizmoObject.scale.clone();
        const scaledBboxCenter = bboxCenter.clone().multiply(newScale);

        // Calculate entity origin: gizmo position (bbox center) - scaled bbox center offset
        // The offset needs to be rotated to match the current rotation
        const rotatedOffset = scaledBboxCenter.clone();
        rotatedOffset.applyEuler(this.gizmoObject.rotation);

        const newEntityPosition = this.gizmoObject.position
            .clone()
            .sub(rotatedOffset);

        // Update entity transform
        this.selectedEntity.currentPosition.copy(newEntityPosition);
        this.selectedEntity.currentRotation.copy(this.gizmoObject.rotation);
        this.selectedEntity.currentScale.copy(newScale);

        // Update entity instance in EnvironmentBuilder (without saving yet)
        this.updateEntityInstanceTransform();

        // Update bounding box visualization to match new position
        // This ensures the bounding box moves with the entity
        this.updateSelectedEntityBoundingBox();

        // Dispatch event for sidebar to update
        window.dispatchEvent(
            new CustomEvent("entity-transform-changed", {
                detail: {
                    position: this.selectedEntity.currentPosition.clone(),
                    rotation: this.selectedEntity.currentRotation.clone(),
                    scale: this.selectedEntity.currentScale.clone(),
                },
            })
        );
    }

    onDraggingChanged(isDragging: boolean) {
        this.isManipulating = isDragging;

        // Disable camera controls while dragging gizmo
        if (this.terrainBuilderRef?.current?.orbitControlsRef?.current) {
            const controls =
                this.terrainBuilderRef.current.orbitControlsRef.current;
            controls.enabled = !isDragging;
        }

        // Prevent deselection while manipulating
        // The entity should stay selected during gizmo manipulation
    }

    onGizmoMouseDown() {
        if (!this.selectedEntity) return;

        // Check if entity still exists before starting manipulation
        if (!this.checkSelectedEntityExists()) {
            return;
        }

        // Store original transform for undo
        this.manipulationStartTransform = {
            position: this.selectedEntity.currentPosition.clone(),
            rotation: this.selectedEntity.currentRotation.clone(),
            scale: this.selectedEntity.currentScale.clone(),
        };
    }

    onGizmoMouseUp() {
        if (this.isManipulating && this.selectedEntity) {
            // Commit changes to database
            this.commitEntityChanges();
        }
        this.isManipulating = false;
    }

    checkSelectedEntityExists(): boolean {
        if (!this.selectedEntity || !this.environmentBuilderRef?.current) {
            return false;
        }

        // Check if the entity still exists in the environment
        const allObjects =
            this.environmentBuilderRef.current.getAllEnvironmentObjects();
        const exists = allObjects.some(
            (obj) =>
                obj.modelUrl === this.selectedEntity.modelUrl &&
                obj.instanceId === this.selectedEntity.instanceId
        );

        if (!exists) {
            // Entity no longer exists, deselect it
            this.deselectEntity();
            return false;
        }

        return true;
    }

    updateEntityInstanceTransform() {
        if (
            !this.selectedEntity ||
            !this.environmentBuilderRef?.current ||
            !this.threeCamera
        ) {
            console.warn(
                "[SelectionTool] Cannot update entity instance transform: missing dependencies",
                {
                    hasSelectedEntity: !!this.selectedEntity,
                    hasEnvBuilder: !!this.environmentBuilderRef?.current,
                    hasCamera: !!this.threeCamera,
                }
            );
            return null;
        }

        // Check if entity still exists before trying to update
        if (!this.checkSelectedEntityExists()) {
            return null;
        }

        // Update the entity instance in EnvironmentBuilder
        const envBuilder = this.environmentBuilderRef.current;

        // Get camera position for rebuilding visible instances
        const cameraPosition = this.threeCamera.position.clone();

        // Update the entity instance transform
        if (envBuilder.updateEntityInstance) {
            console.log("[SelectionTool] Calling updateEntityInstance with:", {
                modelUrl: this.selectedEntity.modelUrl,
                instanceId: this.selectedEntity.instanceId,
                position: this.selectedEntity.currentPosition.toArray(),
                rotation: this.selectedEntity.currentRotation.toArray(),
                scale: this.selectedEntity.currentScale.toArray(),
            });

            const result = envBuilder.updateEntityInstance(
                this.selectedEntity.modelUrl,
                this.selectedEntity.instanceId,
                this.selectedEntity.currentPosition,
                this.selectedEntity.currentRotation,
                this.selectedEntity.currentScale,
                cameraPosition // Pass camera position for efficient rebuilding
            );
            return result;
        } else {
            console.warn(
                "[SelectionTool] EnvironmentBuilder.updateEntityInstance method not found"
            );
            return null;
        }
    }

    commitEntityChanges() {
        if (!this.selectedEntity || !this.environmentBuilderRef?.current) {
            return;
        }

        const envBuilder = this.environmentBuilderRef.current;

        // Update entity instance in EnvironmentBuilder
        this.updateEntityInstanceTransform();

        // Use the original position from manipulationStartTransform as the old position
        // This is the true starting position before any gizmo manipulation
        // (updateResult.oldPosition would be the position from the last frame, not the original)
        let oldPosition: THREE.Vector3 | null = null;
        if (this.manipulationStartTransform) {
            oldPosition = this.manipulationStartTransform.position;
        }

        // Update spatial grid if position changed
        if (oldPosition && envBuilder.updateEntitySpatialGrid) {
            const positionChanged = !oldPosition.equals(
                this.selectedEntity.currentPosition
            );
            if (positionChanged) {
                console.log(
                    "[SelectionTool] Updating spatial grid for moved entity",
                    {
                        modelUrl: this.selectedEntity.modelUrl,
                        oldPosition: oldPosition.toArray(),
                        newPosition:
                            this.selectedEntity.currentPosition.toArray(),
                    }
                );
                envBuilder.updateEntitySpatialGrid(
                    this.selectedEntity.modelUrl,
                    oldPosition,
                    this.selectedEntity.currentPosition
                );
            }
        }

        // Update bounding box to reflect final scale (especially important for scale changes)
        this.updateSelectedEntityBoundingBox();

        // After manipulation ends, rebuild visible instances to ensure proper culling state
        if (envBuilder.rebuildVisibleInstances && this.threeCamera) {
            const cameraPos = this.threeCamera.position.clone();
            envBuilder.rebuildVisibleInstances(
                this.selectedEntity.modelUrl,
                cameraPos
            );
        }

        // Save to database
        if (envBuilder.updateLocalStorage) {
            envBuilder.updateLocalStorage();
        }

        // Create undo/redo entry
        if (this.undoRedoManager?.current && this.manipulationStartTransform) {
            const changes = {
                terrain: { added: {}, removed: {} },
                environment: {
                    added: [
                        {
                            modelUrl: this.selectedEntity.modelUrl,
                            instanceId: this.selectedEntity.instanceId,
                            position: this.selectedEntity.currentPosition,
                            rotation: this.selectedEntity.currentRotation,
                            scale: this.selectedEntity.currentScale,
                        },
                    ],
                    removed: [
                        {
                            modelUrl: this.selectedEntity.modelUrl,
                            instanceId: this.selectedEntity.instanceId,
                            position: this.manipulationStartTransform.position,
                            rotation: this.manipulationStartTransform.rotation,
                            scale: this.manipulationStartTransform.scale,
                        },
                    ],
                },
            };
            this.undoRedoManager.current.saveUndo(changes);
        }

        // Clear manipulation state
        this.manipulationStartTransform = null;
    }

    copyEntity() {
        if (!this.selectedEntity) {
            return;
        }

        // Store the entity data for pasting
        this.copiedEntity = {
            modelUrl: this.selectedEntity.modelUrl,
            name: this.selectedEntity.name,
            position: this.selectedEntity.currentPosition.clone(),
            rotation: this.selectedEntity.currentRotation.clone(),
            scale: this.selectedEntity.currentScale.clone(),
        };

        // Show feedback to user
        ToastManager.showToast("Copied", 2000);
        QuickTipsManager.setToolTip(
            `Copied "${this.selectedEntity.name}". Press Cmd/Ctrl+V to paste.`
        );
        setTimeout(() => {
            if (this.selectedEntity) {
                QuickTipsManager.setToolTip(this.tooltip);
            }
        }, 2000);
    }

    pasteEntity() {
        if (!this.copiedEntity || !this.environmentBuilderRef?.current) {
            QuickTipsManager.setToolTip(
                "No entity copied. Select an entity and press Cmd/Ctrl+C to copy."
            );
            setTimeout(() => {
                if (this.selectedEntity) {
                    QuickTipsManager.setToolTip(this.tooltip);
                }
            }, 2000);
            return;
        }

        // Calculate offset position (2 blocks offset)
        // Use currently selected entity position if available, otherwise use copied entity position
        const basePosition = this.selectedEntity
            ? this.selectedEntity.currentPosition
            : this.copiedEntity.position;
        const offset = new THREE.Vector3(2, 0, 2);
        const newPosition = basePosition.clone().add(offset);

        // Get model type
        const modelType = this.environmentBuilderRef.current.getModelType(
            this.copiedEntity.name,
            this.copiedEntity.modelUrl
        );

        if (!modelType) {
            QuickTipsManager.setToolTip(
                "Error: Could not find model type for pasted entity."
            );
            setTimeout(() => {
                if (this.selectedEntity) {
                    QuickTipsManager.setToolTip(this.tooltip);
                }
            }, 2000);
            return;
        }

        // Create temporary mesh with new position
        const tempMesh = new THREE.Object3D();
        tempMesh.position.copy(newPosition);
        tempMesh.rotation.copy(this.copiedEntity.rotation);
        tempMesh.scale.copy(this.copiedEntity.scale);

        // Place the new entity instance (null instanceId means generate new one)
        const placedInstance =
            this.environmentBuilderRef.current.placeEnvironmentModelWithoutSaving(
                modelType,
                tempMesh,
                null // Generate new instance ID
            );

        if (!placedInstance) {
            QuickTipsManager.setToolTip("Error: Failed to paste entity.");
            setTimeout(() => {
                if (this.selectedEntity) {
                    QuickTipsManager.setToolTip(this.tooltip);
                }
            }, 2000);
            return;
        }

        // Create undo/redo entry for the paste operation
        if (this.undoRedoManager?.current) {
            const changes = {
                terrain: { added: {}, removed: {} },
                environment: {
                    added: [
                        {
                            modelUrl: placedInstance.modelUrl,
                            instanceId: placedInstance.instanceId,
                            position: placedInstance.position,
                            rotation: placedInstance.rotation,
                            scale: placedInstance.scale,
                        },
                    ],
                    removed: [],
                },
            };
            this.undoRedoManager.current.saveUndo(changes);
        }

        // Save to database
        if (this.environmentBuilderRef.current.updateLocalStorage) {
            this.environmentBuilderRef.current.updateLocalStorage();
        }

        // Create EntityRaycastResult-like object directly from placed instance
        // placeEnvironmentModelWithoutSaving returns position, rotation, scale as THREE objects
        const entityResult: EntityRaycastResult = {
            entity: {
                modelUrl: placedInstance.modelUrl,
                instanceId: placedInstance.instanceId,
                name: this.copiedEntity.name,
                position: placedInstance.position,
                rotation: placedInstance.rotation,
                scale: placedInstance.scale,
            },
            distance: 0,
            point: placedInstance.position.clone(),
        };

        // Select the new entity immediately
        this.selectEntity(entityResult);

        // Show feedback
        ToastManager.showToast("Paste Successful", 2000);
        QuickTipsManager.setToolTip(
            `Pasted "${this.copiedEntity.name}". Entity selected.`
        );
        setTimeout(() => {
            if (this.selectedEntity) {
                QuickTipsManager.setToolTip(this.tooltip);
            }
        }, 2000);
    }
}

export default SelectionTool;
