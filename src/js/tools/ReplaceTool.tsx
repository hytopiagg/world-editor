import * as THREE from "three";
import BaseTool from "./BaseTool";

/**
 * ReplaceTool – random block replacement brush.
 *
 * Similar to TerrainTool but instead of sculpting heights it replaces blocks in-place
 * based on a weighted random list of block IDs supplied from the UI.
 */
export default class ReplaceTool extends BaseTool {
    isPlacing: boolean;
    previewMesh: THREE.Mesh | null;
    previewGroup: THREE.Group | null;
    currentPosition: THREE.Vector3;
    settings: {
        radius: number;
        shape: "sphere" | "cube";
        blockWeights: { id: number; weight: number }[];
    };
    lastReplace: number;
    strokeAdded: Record<string, number>;
    strokeRemoved: Record<string, number>;
    undoRedoManager: any;

    constructor(terrainBuilderProps: any) {
        super(terrainBuilderProps);
        this.name = "replace";
        this.tooltip =
            "Replace Tool – Click / drag to randomly replace blocks inside a sphere/cube";

        this.isPlacing = false;
        this.currentPosition = new THREE.Vector3();
        this.lastReplace = 0;
        this.strokeAdded = {};
        this.strokeRemoved = {};

        // Reference to undo/redo manager from terrainBuilderProps (if provided)
        this.undoRedoManager = terrainBuilderProps.undoRedoManager;

        // default settings
        this.settings = {
            radius: 8,
            shape: "sphere",
            blockWeights: [{ id: 1, weight: 100 }], // stone by default
        } as const;

        this.previewMesh = null;
        this.previewGroup = null;
        this._createPreviewObjects();
    }

    /* =========================== Preview helpers ========================= */
    private _createPreviewObjects() {
        this.previewGroup = new THREE.Group();
        this._rebuildPreviewGeometry();
        this.previewGroup.visible = false;
    }

    private _rebuildPreviewGeometry() {
        if (!this.previewGroup) return;
        // dispose existing children first
        this.previewGroup.children.forEach((child) => {
            if ((child as any).geometry) (child as any).geometry.dispose();
            if ((child as any).material) {
                if (Array.isArray((child as any).material)) {
                    (child as any).material.forEach((m: any) => m.dispose());
                } else (child as any).material.dispose();
            }
        });
        this.previewGroup.clear();

        const size = this.settings.radius * 2;
        let geom: THREE.BufferGeometry;
        if (this.settings.shape === "sphere") {
            geom = new THREE.SphereGeometry(this.settings.radius, 16, 16);
        } else {
            geom = new THREE.BoxGeometry(size, size, size);
        }
        const material = new THREE.MeshBasicMaterial({
            color: 0x2196f3,
            transparent: true,
            opacity: 0.25,
            depthWrite: false,
            depthTest: true,
        });
        this.previewMesh = new THREE.Mesh(geom, material);
        this.previewMesh.renderOrder = 999;
        this.previewGroup?.add(this.previewMesh);

        // outline
        let outlineGeom: THREE.BufferGeometry;
        if (this.settings.shape === "sphere") {
            outlineGeom = new THREE.SphereGeometry(this.settings.radius, 12, 12);
        } else {
            outlineGeom = new THREE.BoxGeometry(size, size, size);
        }
        const outlineMat = new THREE.MeshBasicMaterial({
            color: 0x1976d2,
            wireframe: true,
            transparent: true,
            opacity: 0.6,
            depthWrite: false,
            depthTest: true,
        });
        const outlineMesh = new THREE.Mesh(outlineGeom, outlineMat);
        outlineMesh.renderOrder = 1000;
        this.previewGroup?.add(outlineMesh);
    }

    /* =============================== BaseTool ============================ */

    onActivate() {
        if ((this.terrainBuilderProps as any).scene && this.previewGroup) {
            (this.terrainBuilderProps as any).scene.add(this.previewGroup);
            this.previewGroup.visible = true;
        }
        this.isPlacing = false;
        return true;
    }

    onDeactivate() {
        if ((this.terrainBuilderProps as any).scene && this.previewGroup) {
            (this.terrainBuilderProps as any).scene.remove(this.previewGroup);
            this.previewGroup.visible = false;
        }
    }

    handleMouseMove(_evt: any, intersectionPoint: THREE.Vector3) {
        if (!intersectionPoint) return;
        this.currentPosition.copy(intersectionPoint).round();
        if (this.previewGroup) {
            this.previewGroup.position.set(
                this.currentPosition.x,
                this.currentPosition.y,
                this.currentPosition.z,
            );
        }
        if (this.isPlacing) {
            const now = performance.now();
            if (now - this.lastReplace > 200) {
                this._replaceBlocks();
                this.lastReplace = now;
            }
        }
    }

    handleMouseDown(_evt: any, intersectionPoint: THREE.Vector3) {
        if (!intersectionPoint) return;
        this.isPlacing = true;
        this.strokeAdded = {};
        this.strokeRemoved = {};
        this.currentPosition.copy(intersectionPoint).round();
        this._replaceBlocks();
    }

    handleMouseUp() {
        if (!this.isPlacing) return;
        this.isPlacing = false;
        // Save undo snapshot
        if (this.undoRedoManager?.current?.saveUndo) {
            const hasChanges =
                Object.keys(this.strokeAdded).length > 0 ||
                Object.keys(this.strokeRemoved).length > 0;
            if (hasChanges) {
                const snapshot = {
                    terrain: {
                        added: { ...this.strokeAdded },
                        removed: { ...this.strokeRemoved },
                    },
                    environment: null,
                } as any;
                this.undoRedoManager.current.saveUndo(snapshot);
            }
        }
    }

    /* ============================= Core logic =========================== */

    private _replaceBlocks() {
        const { radius, shape, blockWeights } = this.settings;
        const terrainData = (this.terrainBuilderProps as any).terrainRef.current;
        if (!terrainData) return;

        const center = this.currentPosition.clone();

        // Pre-compute weight table scaled to 100
        let total = blockWeights.reduce((s, w) => s + w.weight, 0);
        if (total <= 0) return;
        let scale = total > 100 ? 100 / total : 1;
        const remainder = total < 100 ? 100 - total : 0;
        const cumulative: { id: number; upto: number }[] = [];
        let acc = 0;
        blockWeights.forEach((w) => {
            acc += w.weight * scale;
            cumulative.push({ id: w.id, upto: acc });
        });

        const addedBlocks: Record<string, number> = {};
        const removedBlocks: Record<string, number> = {};

        const intRadius = Math.ceil(radius);
        for (let dx = -intRadius; dx <= intRadius; dx++) {
            for (let dy = -intRadius; dy <= intRadius; dy++) {
                for (let dz = -intRadius; dz <= intRadius; dz++) {
                    const x = center.x + dx;
                    const y = center.y + dy;
                    const z = center.z + dz;

                    // shape check
                    let inside = true;
                    if (shape === "sphere") {
                        inside = dx * dx + dy * dy + dz * dz <= radius * radius;
                    }
                    if (!inside) continue;

                    const posKey = `${x},${y},${z}`;
                    const currentId = terrainData[posKey];
                    if (currentId === undefined) continue; // no block to replace

                    const rndVal = Math.random() * 100;
                    if (rndVal < remainder) {
                        continue; // keep original
                    }
                    const rval = rndVal - remainder;
                    let chosenId = currentId;
                    for (const entry of cumulative) {
                        if (rval <= entry.upto) {
                            chosenId = entry.id;
                            break;
                        }
                    }
                    if (chosenId === currentId) continue; // no change

                    addedBlocks[posKey] = chosenId;
                    removedBlocks[posKey] = currentId;
                }
            }
        }

        if (Object.keys(addedBlocks).length || Object.keys(removedBlocks).length) {
            // Apply immediately
            (this.terrainBuilderProps as any).updateTerrainBlocks(
                addedBlocks,
                removedBlocks,
                { syncPendingChanges: true }
            );

            Object.assign(this.strokeAdded, addedBlocks);
            Object.assign(this.strokeRemoved, removedBlocks);
        }
    }

    /* ============================ Settings ============================== */

    updateSettings(newSettings: Partial<typeof this.settings>) {
        this.settings = { ...this.settings, ...newSettings } as any;
        if (newSettings.radius || newSettings.shape) {
            this._rebuildPreviewGeometry();
        }
    }

    dispose() {
        if (this.previewGroup && (this.terrainBuilderProps as any).scene) {
            (this.terrainBuilderProps as any).scene.remove(this.previewGroup);
        }
        if (this.previewGroup) {
            this.previewGroup.traverse((child) => {
                if ((child as any).geometry) (child as any).geometry.dispose();
                if ((child as any).material) {
                    if (Array.isArray((child as any).material)) {
                        (child as any).material.forEach((mat: any) =>
                            mat.dispose()
                        );
                    } else {
                        (child as any).material.dispose();
                    }
                }
            });
        }
    }
} 