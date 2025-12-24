/**
 * ZoneTool.ts - Tool for creating and editing zones/boundaries in the world
 * 
 * Allows users to define 3D regions (boxes) or points for spawn areas,
 * boundaries, trigger zones, etc.
 */

import * as THREE from "three";
import BaseTool from "./BaseTool";
import { zoneManager, getZoneLabelColor } from "../managers/ZoneManager";
import { Zone, ZonePosition, ZoneDimensions, ZONE_LABEL_PRESETS } from "../types/DatabaseTypes";
import QuickTipsManager from "../components/QuickTipsManager";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

type ZoneMode = "box" | "point";
type CreationState = "idle" | "firstCorner" | "secondCorner";

class ZoneTool extends BaseTool {
    // Tool properties
    name = "zone";
    tooltip = "Zone Tool: Click to place a point, or click and move to define a box area. Use 1 | 2 to adjust height. Press M to switch point/box mode. Press S to scale selected zone. Press Escape to cancel.";
    
    // References
    scene: THREE.Scene | null = null;
    terrainBuilderRef: any = null;
    previewPositionRef: any = null;
    threeCamera: THREE.Camera | null = null;
    gl: THREE.WebGLRenderer | null = null;
    
    // Mode and state
    zoneMode: ZoneMode = "box";
    creationState: CreationState = "idle";
    selectedLabel: string = "spawn_point";
    
    // Creation state
    firstCornerPosition: THREE.Vector3 | null = null;
    currentHeight: number = 3;
    previewGroup: THREE.Group | null = null;
    
    // Selection/editing state
    selectedZone: Zone | null = null;
    selectedZoneBoundingBox: THREE.Group | null = null;
    hoveredZone: Zone | null = null;
    
    // Gizmo for moving zones
    transformControls: TransformControls | null = null;
    gizmoObject: THREE.Object3D | null = null;
    isManipulating: boolean = false;
    
    // Scale sensitivity factor (lower = less sensitive)
    private scaleSensitivity: number = 0.1;
    
    // Bound event handlers
    onGizmoChangeBound: (() => void) | null = null;
    onDraggingChangedBound: ((event: any) => void) | null = null;
    
    constructor(terrainBuilderProps: any) {
        super(terrainBuilderProps);
        
        if (terrainBuilderProps) {
            this.scene = terrainBuilderProps.scene;
            this.terrainBuilderRef = terrainBuilderProps.terrainBuilderRef;
            this.previewPositionRef = terrainBuilderProps.previewPositionRef;
            this.threeCamera = terrainBuilderProps.threeCamera;
            this.gl = terrainBuilderProps.gl;
        }
    }
    
    onActivate(activationData?: any): boolean {
        super.onActivate(activationData);
        this.creationState = "idle";
        this.firstCornerPosition = null;
        this.removePreview();
        this.deselectZone();
        
        // Ensure zones are visible when tool is active
        zoneManager.setVisible(true);
        
        QuickTipsManager.setToolTip(this.tooltip);
        
        // Dispatch event to show zone options in sidebar
        window.dispatchEvent(new CustomEvent("zone-tool-activated"));
        
        return true;
    }
    
    onDeactivate() {
        super.onDeactivate();
        this.removePreview();
        this.deselectZone();
        this.disposeGizmo();
        this.creationState = "idle";
        this.firstCornerPosition = null;
        
        window.dispatchEvent(new CustomEvent("zone-tool-deactivated"));
    }
    
    // ========== Mode and Label Methods ==========
    
    setZoneMode(mode: ZoneMode) {
        this.zoneMode = mode;
        this.resetCreation();
        
        const modeLabel = mode === "box" ? "Box" : "Point";
        QuickTipsManager.setToolTip(`Zone Mode: ${modeLabel}. ${this.tooltip}`);
        
        window.dispatchEvent(new CustomEvent("zone-mode-changed", { detail: { mode } }));
    }
    
    cycleZoneMode() {
        this.setZoneMode(this.zoneMode === "box" ? "point" : "box");
    }
    
    setSelectedLabel(label: string) {
        this.selectedLabel = label;
        window.dispatchEvent(new CustomEvent("zone-label-changed", { detail: { label } }));
    }
    
    // ========== Mouse Event Handlers ==========
    
    handleMouseDown(event: any, position: THREE.Vector3, button: number) {
        if (!this.previewPositionRef?.current) return;
        
        const currentPosition = this.previewPositionRef.current;
        
        if (button === 0) { // Left click
            // If gizmo is being manipulated, let it handle the event
            if (this.transformControls && this.isManipulating) {
                return;
            }
            
            // Check if clicking on an existing zone
            const clickedZone = zoneManager.getZoneAtPosition(currentPosition);
            
            if (clickedZone && this.creationState === "idle") {
                // Select the clicked zone
                this.selectZone(clickedZone);
                return;
            }
            
            // If a zone is selected and clicking empty space, deselect
            if (this.selectedZone && !clickedZone && this.creationState === "idle") {
                if (!this.isManipulating) {
                    this.deselectZone();
                    return;
                }
            }
            
            // Handle zone creation based on mode
            if (this.zoneMode === "point") {
                // Create point zone immediately
                this.createPointZone(currentPosition);
            } else {
                // Box mode
                if (this.creationState === "idle") {
                    // Set first corner
                    this.firstCornerPosition = currentPosition.clone();
                    this.creationState = "firstCorner";
                    QuickTipsManager.setToolTip("First corner set. Move to define area, then click to confirm. Use 1 | 2 to adjust height.");
                } else if (this.creationState === "firstCorner") {
                    // Create box zone
                    this.createBoxZone(this.firstCornerPosition!, currentPosition);
                    this.resetCreation();
                }
            }
        } else if (button === 2) { // Right click
            // Cancel current creation
            this.resetCreation();
        }
    }
    
    handleMouseMove(event: any, position: THREE.Vector3) {
        if (!this.previewPositionRef?.current) return;
        
        const currentPosition = this.previewPositionRef.current;
        
        // Update preview if creating a box
        if (this.creationState === "firstCorner" && this.firstCornerPosition) {
            this.updatePreview(this.firstCornerPosition, currentPosition);
        }
        
        // Update hover state if not creating
        if (this.creationState === "idle" && !this.selectedZone) {
            const hovered = zoneManager.getZoneAtPosition(currentPosition);
            if (hovered !== this.hoveredZone) {
                this.hoveredZone = hovered;
                // Could add hover visual feedback here
            }
        }
    }
    
    handleKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            if (this.selectedZone) {
                this.deselectZone();
            } else {
                this.resetCreation();
            }
        } else if (event.key.toLowerCase() === "m") {
            // Mode toggle (changed from Tab to M)
            event.preventDefault();
            this.cycleZoneMode();
        } else if (event.key === "1") {
            // Decrease height
            this.currentHeight = Math.max(1, this.currentHeight - 1);
            this.updatePreviewIfActive();
            // Also update selected zone height if box type
            if (this.selectedZone && this.selectedZone.type === "box") {
                this.adjustSelectedZoneHeight(-1);
            } else {
                QuickTipsManager.setToolTip(`Zone height: ${this.currentHeight}`);
            }
        } else if (event.key === "2") {
            // Increase height
            this.currentHeight = Math.min(256, this.currentHeight + 1);
            this.updatePreviewIfActive();
            // Also update selected zone height if box type
            if (this.selectedZone && this.selectedZone.type === "box") {
                this.adjustSelectedZoneHeight(1);
            } else {
                QuickTipsManager.setToolTip(`Zone height: ${this.currentHeight}`);
            }
        } else if (event.key === "Delete" || event.key === "Backspace") {
            if (this.selectedZone) {
                event.preventDefault();
                this.deleteSelectedZone();
            }
        } else if (event.key.toLowerCase() === "g" || event.key.toLowerCase() === "w") {
            // Move mode for selected zone
            if (this.selectedZone && this.transformControls) {
                this.transformControls.setMode("translate");
                QuickTipsManager.setToolTip("Move mode: Drag to move zone");
            }
        } else if (event.key.toLowerCase() === "s") {
            // Scale mode for selected zone (only for box zones)
            if (this.selectedZone && this.selectedZone.type === "box" && this.transformControls) {
                this.transformControls.setMode("scale");
                QuickTipsManager.setToolTip("Scale mode: Drag to resize zone");
            } else if (this.selectedZone && this.selectedZone.type === "point") {
                QuickTipsManager.setToolTip("Point zones cannot be scaled. Convert to box first.");
            }
        }
    }
    
    /**
     * Adjust the height of the selected zone
     */
    private adjustSelectedZoneHeight(delta: number) {
        if (!this.selectedZone || this.selectedZone.type !== "box" || !this.selectedZone.dimensions) return;
        
        const newHeight = Math.max(1, Math.min(256, this.selectedZone.dimensions.height + delta));
        
        zoneManager.updateZone(this.selectedZone.id, {
            dimensions: {
                ...this.selectedZone.dimensions,
                height: newHeight,
            }
        });
        
        // Refresh selection highlight and gizmo
        const updatedZone = zoneManager.getZone(this.selectedZone.id);
        if (updatedZone) {
            this.selectedZone = updatedZone;
            this.createSelectionHighlight(updatedZone);
            this.updateGizmoPosition(updatedZone);
        }
        
        QuickTipsManager.setToolTip(`Zone height: ${newHeight}`);
    }
    
    /**
     * Update gizmo position for a zone
     */
    private updateGizmoPosition(zone: Zone) {
        if (!this.gizmoObject) return;
        
        if (zone.type === "point") {
            this.gizmoObject.position.set(zone.position.x, zone.position.y, zone.position.z);
        } else if (zone.dimensions) {
            this.gizmoObject.position.set(
                zone.position.x + zone.dimensions.width / 2,
                zone.position.y + zone.dimensions.height / 2,
                zone.position.z + zone.dimensions.depth / 2
            );
        }
    }
    
    // ========== Zone Creation Methods ==========
    
    private createPointZone(position: THREE.Vector3) {
        const zonePosition: ZonePosition = {
            x: Math.round(position.x),
            y: Math.round(position.y),
            z: Math.round(position.z),
        };
        
        const zone = zoneManager.createZone(
            this.selectedLabel,
            "point",
            zonePosition
        );
        
        QuickTipsManager.setToolTip(`Created point zone: ${this.selectedLabel}`);
        setTimeout(() => QuickTipsManager.setToolTip(this.tooltip), 2000);
        
        // Select the newly created zone
        this.selectZone(zone);
    }
    
    private createBoxZone(startPos: THREE.Vector3, endPos: THREE.Vector3) {
        // Calculate min/max corners
        const minX = Math.min(Math.round(startPos.x), Math.round(endPos.x));
        const maxX = Math.max(Math.round(startPos.x), Math.round(endPos.x));
        const minZ = Math.min(Math.round(startPos.z), Math.round(endPos.z));
        const maxZ = Math.max(Math.round(startPos.z), Math.round(endPos.z));
        const baseY = Math.round(startPos.y);
        
        const zonePosition: ZonePosition = {
            x: minX,
            y: baseY,
            z: minZ,
        };
        
        const zoneDimensions: ZoneDimensions = {
            width: maxX - minX + 1,
            height: this.currentHeight,
            depth: maxZ - minZ + 1,
        };
        
        const zone = zoneManager.createZone(
            this.selectedLabel,
            "box",
            zonePosition,
            zoneDimensions
        );
        
        QuickTipsManager.setToolTip(`Created box zone: ${this.selectedLabel} (${zoneDimensions.width}x${zoneDimensions.height}x${zoneDimensions.depth})`);
        setTimeout(() => QuickTipsManager.setToolTip(this.tooltip), 2000);
        
        // Select the newly created zone
        this.selectZone(zone);
    }
    
    private resetCreation() {
        this.creationState = "idle";
        this.firstCornerPosition = null;
        this.removePreview();
        QuickTipsManager.setToolTip(this.tooltip);
    }
    
    // ========== Preview Methods ==========
    
    private updatePreview(startPos: THREE.Vector3, endPos: THREE.Vector3) {
        if (!this.scene) return;
        
        this.removePreview();
        
        const previewGroup = new THREE.Group();
        previewGroup.name = "zone_preview";
        
        const minX = Math.min(Math.round(startPos.x), Math.round(endPos.x));
        const maxX = Math.max(Math.round(startPos.x), Math.round(endPos.x));
        const minZ = Math.min(Math.round(startPos.z), Math.round(endPos.z));
        const maxZ = Math.max(Math.round(startPos.z), Math.round(endPos.z));
        const baseY = Math.round(startPos.y);
        
        const width = maxX - minX + 1;
        const height = this.currentHeight;
        const depth = maxZ - minZ + 1;
        
        const color = new THREE.Color(getZoneLabelColor(this.selectedLabel));
        
        // Create preview box
        const geometry = new THREE.BoxGeometry(width, height, depth);
        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(minX + width / 2, baseY + height / 2, minZ + depth / 2);
        previewGroup.add(mesh);
        
        // Add wireframe
        const edgesGeometry = new THREE.EdgesGeometry(geometry);
        const edgesMaterial = new THREE.LineBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.8,
        });
        const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
        edges.position.copy(mesh.position);
        previewGroup.add(edges);
        
        // Add dimension label
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;
        canvas.width = 128;
        canvas.height = 32;
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(0, 0, 128, 32);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 18px Arial";
        ctx.textAlign = "center";
        ctx.fillText(`${width}x${height}x${depth}`, 64, 22);
        
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.set(minX + width / 2, baseY + height + 0.5, minZ + depth / 2);
        sprite.scale.set(2, 0.5, 1);
        previewGroup.add(sprite);
        
        previewGroup.renderOrder = 999;
        this.scene.add(previewGroup);
        this.previewGroup = previewGroup;
    }
    
    private updatePreviewIfActive() {
        if (this.creationState === "firstCorner" && this.firstCornerPosition && this.previewPositionRef?.current) {
            this.updatePreview(this.firstCornerPosition, this.previewPositionRef.current);
        }
    }
    
    private removePreview() {
        if (this.previewGroup && this.scene) {
            this.previewGroup.traverse((child) => {
                if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material instanceof THREE.Material) {
                        child.material.dispose();
                    }
                }
                if (child instanceof THREE.Sprite) {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            });
            this.scene.remove(this.previewGroup);
            this.previewGroup = null;
        }
    }
    
    // ========== Zone Selection Methods ==========
    
    selectZone(zone: Zone) {
        this.deselectZone();
        this.selectedZone = zone;
        
        // Create selection highlight
        this.createSelectionHighlight(zone);
        
        // Setup gizmo for moving
        this.setupGizmo(zone);
        
        // Update tooltip
        const labelName = ZONE_LABEL_PRESETS.find(p => p.value === zone.label)?.label || zone.label;
        QuickTipsManager.setToolTip(`Selected: ${labelName}. Press G to move, Delete to remove. Press Escape to deselect.`);
        
        // Dispatch event
        window.dispatchEvent(new CustomEvent("zone-selected", { detail: { zone } }));
    }
    
    deselectZone() {
        if (this.selectedZone) {
            this.removeSelectionHighlight();
            this.disposeGizmo();
            this.selectedZone = null;
            QuickTipsManager.setToolTip(this.tooltip);
            
            window.dispatchEvent(new CustomEvent("zone-deselected"));
        }
    }
    
    deleteSelectedZone() {
        if (this.selectedZone) {
            const zoneName = this.selectedZone.label;
            zoneManager.deleteZone(this.selectedZone.id);
            this.deselectZone();
            QuickTipsManager.setToolTip(`Deleted zone: ${zoneName}`);
            setTimeout(() => QuickTipsManager.setToolTip(this.tooltip), 2000);
        }
    }
    
    private createSelectionHighlight(zone: Zone) {
        if (!this.scene) return;
        
        this.removeSelectionHighlight();
        
        const group = new THREE.Group();
        group.name = "zone_selection_highlight";
        
        const highlightColor = new THREE.Color("#ffffff");
        
        if (zone.type === "point") {
            const geometry = new THREE.SphereGeometry(0.8, 16, 16);
            const material = new THREE.MeshBasicMaterial({
                color: highlightColor,
                transparent: true,
                opacity: 0.3,
                wireframe: true,
            });
            const sphere = new THREE.Mesh(geometry, material);
            sphere.position.set(zone.position.x, zone.position.y + 0.25, zone.position.z);
            group.add(sphere);
        } else if (zone.dimensions) {
            const { width, height, depth } = zone.dimensions;
            const padding = 0.1;
            const geometry = new THREE.BoxGeometry(
                width + padding * 2,
                height + padding * 2,
                depth + padding * 2
            );
            const material = new THREE.MeshBasicMaterial({
                color: highlightColor,
                transparent: true,
                opacity: 0.2,
                wireframe: true,
            });
            const box = new THREE.Mesh(geometry, material);
            box.position.set(
                zone.position.x + width / 2,
                zone.position.y + height / 2,
                zone.position.z + depth / 2
            );
            group.add(box);
        }
        
        this.scene.add(group);
        this.selectedZoneBoundingBox = group;
    }
    
    private removeSelectionHighlight() {
        if (this.selectedZoneBoundingBox && this.scene) {
            this.selectedZoneBoundingBox.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material instanceof THREE.Material) {
                        child.material.dispose();
                    }
                }
            });
            this.scene.remove(this.selectedZoneBoundingBox);
            this.selectedZoneBoundingBox = null;
        }
    }
    
    // ========== Gizmo Methods ==========
    
    private setupGizmo(zone: Zone) {
        if (!this.scene || !this.threeCamera) return;
        
        this.disposeGizmo();
        
        // Create helper object at zone center
        this.gizmoObject = new THREE.Object3D();
        
        if (zone.type === "point") {
            this.gizmoObject.position.set(zone.position.x, zone.position.y, zone.position.z);
        } else if (zone.dimensions) {
            this.gizmoObject.position.set(
                zone.position.x + zone.dimensions.width / 2,
                zone.position.y + zone.dimensions.height / 2,
                zone.position.z + zone.dimensions.depth / 2
            );
        }
        
        this.scene.add(this.gizmoObject);
        
        // Get DOM element
        let domElement = this.gl?.domElement;
        if (!domElement && this.terrainBuilderRef?.current?.gl?.domElement) {
            domElement = this.terrainBuilderRef.current.gl.domElement;
        }
        
        if (!domElement) {
            console.warn("[ZoneTool] Cannot setup gizmo: no DOM element found");
            return;
        }
        
        // Create TransformControls
        this.transformControls = new TransformControls(this.threeCamera, domElement);
        this.transformControls.attach(this.gizmoObject);
        this.transformControls.setMode("translate");
        this.transformControls.setSpace("world");
        this.transformControls.setSize(0.8);
        
        this.scene.add(this.transformControls as unknown as THREE.Object3D);
        
        // Set up event listeners
        this.onGizmoChangeBound = () => this.onGizmoChange();
        this.onDraggingChangedBound = (event: any) => this.onDraggingChanged(event.value);
        
        this.transformControls.addEventListener("change", this.onGizmoChangeBound);
        this.transformControls.addEventListener("dragging-changed", this.onDraggingChangedBound);
    }
    
    private disposeGizmo() {
        if (this.transformControls && this.scene) {
            if (this.onGizmoChangeBound) {
                this.transformControls.removeEventListener("change", this.onGizmoChangeBound);
            }
            if (this.onDraggingChangedBound) {
                this.transformControls.removeEventListener("dragging-changed", this.onDraggingChangedBound);
            }
            
            this.scene.remove(this.transformControls as unknown as THREE.Object3D);
            this.transformControls.dispose();
            this.transformControls = null;
        }
        
        if (this.gizmoObject && this.scene) {
            this.scene.remove(this.gizmoObject);
            this.gizmoObject = null;
        }
        
        this.onGizmoChangeBound = null;
        this.onDraggingChangedBound = null;
        this.isManipulating = false;
    }
    
    private onGizmoChange() {
        if (!this.gizmoObject || !this.selectedZone || !this.transformControls) return;
        
        const mode = this.transformControls.mode;
        const gizmoPos = this.gizmoObject.position;
        const gizmoScale = this.gizmoObject.scale;
        
        if (mode === "translate") {
            // Update zone position based on gizmo
            let newPosition: ZonePosition;
            if (this.selectedZone.type === "point") {
                newPosition = {
                    x: Math.round(gizmoPos.x),
                    y: Math.round(gizmoPos.y),
                    z: Math.round(gizmoPos.z),
                };
            } else if (this.selectedZone.dimensions) {
                // Gizmo is at center, calculate corner position
                newPosition = {
                    x: Math.round(gizmoPos.x - this.selectedZone.dimensions.width / 2),
                    y: Math.round(gizmoPos.y - this.selectedZone.dimensions.height / 2),
                    z: Math.round(gizmoPos.z - this.selectedZone.dimensions.depth / 2),
                };
            } else {
                return;
            }
            
            // Update the zone
            zoneManager.updateZone(this.selectedZone.id, { position: newPosition });
        } else if (mode === "scale" && this.selectedZone.type === "box" && this.selectedZone.dimensions) {
            // Update zone dimensions based on scale with sensitivity factor
            const originalDimensions = this.selectedZone.dimensions;
            
            // Apply sensitivity factor: scale delta is reduced
            // When gizmoScale is 1.0, no change. When it's 2.0, we want less than 2x change
            // Formula: 1 + (scale - 1) * sensitivity
            const effectiveScaleX = 1 + (gizmoScale.x - 1) * this.scaleSensitivity;
            const effectiveScaleY = 1 + (gizmoScale.y - 1) * this.scaleSensitivity;
            const effectiveScaleZ = 1 + (gizmoScale.z - 1) * this.scaleSensitivity;
            
            const newDimensions: ZoneDimensions = {
                width: Math.max(1, Math.round(originalDimensions.width * effectiveScaleX)),
                height: Math.max(1, Math.round(originalDimensions.height * effectiveScaleY)),
                depth: Math.max(1, Math.round(originalDimensions.depth * effectiveScaleZ)),
            };
            
            // Reset gizmo scale to 1 so next change is relative
            this.gizmoObject.scale.set(1, 1, 1);
            
            // Update zone dimensions
            zoneManager.updateZone(this.selectedZone.id, { dimensions: newDimensions });
            
            // Update selected zone reference
            const updatedZone = zoneManager.getZone(this.selectedZone.id);
            if (updatedZone) {
                this.selectedZone = updatedZone;
                this.updateGizmoPosition(updatedZone);
            }
        }
        
        // Update selection highlight
        const updatedZone = zoneManager.getZone(this.selectedZone.id);
        if (updatedZone) {
            this.selectedZone = updatedZone;
            this.createSelectionHighlight(updatedZone);
        }
    }
    
    private onDraggingChanged(isDragging: boolean) {
        this.isManipulating = isDragging;
        
        // Disable camera controls while dragging
        if (this.terrainBuilderRef?.current?.orbitControlsRef?.current) {
            const controls = this.terrainBuilderRef.current.orbitControlsRef.current;
            controls.enabled = !isDragging;
        }
    }
    
    // ========== Utility Methods ==========
    
    shouldHidePreviewBlock(): boolean {
        return this.creationState !== "idle" || !!this.selectedZone;
    }
    
    dispose() {
        this.removePreview();
        this.removeSelectionHighlight();
        this.disposeGizmo();
        this.creationState = "idle";
        this.firstCornerPosition = null;
        this.selectedZone = null;
        this.hoveredZone = null;
        super.dispose();
    }
}

export default ZoneTool;

