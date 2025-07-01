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

        // Reset stroke tracking for new operation - this allows replacing blocks from previous strokes
        this.strokeAdded = {};
        this.strokeRemoved = {};



        // Check what blocks actually exist in a wide area around where we clicked
        const centerX = Math.round(intersectionPoint.x);
        const centerY = Math.round(intersectionPoint.y);
        const centerZ = Math.round(intersectionPoint.z);

        // Get terrain data for block searching
        const terrainData = (this.terrainBuilderProps as any).terrainRef.current;

        const nearbyBlocks = {};
        // Increase search radius significantly to compensate for raycast inaccuracy
        const searchRadius = 15;
        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
            for (let dy = -searchRadius; dy <= searchRadius; dy++) {
                for (let dz = -searchRadius; dz <= searchRadius; dz++) {
                    const key = `${centerX + dx},${centerY + dy},${centerZ + dz}`;
                    if (terrainData[key]) {
                        nearbyBlocks[key] = terrainData[key];
                    }
                }
            }
        }

        // If no blocks found, use original intersection point
        if (Object.keys(nearbyBlocks).length === 0) {
            this.currentPosition.copy(intersectionPoint).round();
        } else {
            // Try to find the closest actual block to use as center
            const clickPos = intersectionPoint;
            let closestBlock = null;
            let closestDistance = Infinity;

            Object.keys(nearbyBlocks).forEach(blockKey => {
                const [bx, by, bz] = blockKey.split(',').map(Number);
                const distance = Math.sqrt(
                    Math.pow(bx - clickPos.x, 2) +
                    Math.pow(by - clickPos.y, 2) +
                    Math.pow(bz - clickPos.z, 2)
                );
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestBlock = { x: bx, y: by, z: bz, key: blockKey };
                }
            });

            if (closestBlock) {
                this.currentPosition.set(closestBlock.x, closestBlock.y, closestBlock.z);
            } else {
                this.currentPosition.copy(intersectionPoint).round();
            }
        }
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
                    environment: { added: [], removed: [] },
                } as any;
                this.undoRedoManager.current.saveUndo(snapshot);
            }
        }

        // Reset stroke tracking for next operation
        this.strokeAdded = {};
        this.strokeRemoved = {};
    }

    /* ============================= Core logic =========================== */

    private _replaceBlocks() {
        const { radius, shape, blockWeights } = this.settings;

        // Get fresh terrain data reference each time to ensure we see latest changes
        const terrainRef = (this.terrainBuilderProps as any).terrainRef;
        if (!terrainRef || !terrainRef.current) {
            console.warn('ReplaceTool: No terrain reference available');
            return;
        }



        const center = this.currentPosition.clone();

        // Calculate total weight
        const totalWeight = blockWeights.reduce((s, w) => s + w.weight, 0);
        if (totalWeight <= 0) return;

        // Create cumulative probability distribution
        // If total < 100, remainder preserves original blocks
        const cumulative: { id: number; upto: number }[] = [];
        let acc = 0;
        blockWeights.forEach((w) => {
            acc += w.weight;
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

                    // Get current block ID - always use the most up-to-date terrain data
                    // which includes changes from previous replace operations in this stroke
                    // Get fresh terrain reference to ensure we see the latest changes
                    const currentTerrainData = (this.terrainBuilderProps as any).terrainRef.current;
                    let currentId = currentTerrainData[posKey];

                    if (currentId === undefined) {
                        continue; // no block to replace
                    }

                    // Weighted selection with remainder preserving original
                    const rndVal = Math.random() * 100;

                    // If random value exceeds total weight, preserve original
                    if (rndVal > totalWeight) {
                        continue; // keep current block
                    }

                    // Find which block to place based on weights
                    let chosenId = currentId; // default to current
                    for (const entry of cumulative) {
                        if (rndVal <= entry.upto) {
                            chosenId = entry.id;
                            break;
                        }
                    }

                    // Only make change if different from current
                    if (chosenId !== currentId) {
                        addedBlocks[posKey] = chosenId;
                        // Track what we're replacing - use the original block if this is the first change
                        // at this position in this stroke, otherwise use the current block
                        if (!this.strokeRemoved[posKey]) {
                            removedBlocks[posKey] = currentId;
                        }

                    }
                }
            }
        }

        if (Object.keys(addedBlocks).length || Object.keys(removedBlocks).length) {
            // Direct replacement approach - much simpler than add/remove logic
            this._applyBlockReplacements(addedBlocks, removedBlocks);

            // Update stroke tracking for undo/redo
            Object.assign(this.strokeAdded, addedBlocks);
            Object.keys(addedBlocks).forEach(posKey => {
                // Only set the original removed block once per position per stroke
                if (!this.strokeRemoved[posKey]) {
                    this.strokeRemoved[posKey] = removedBlocks[posKey];
                }
            });
        }
    }

    /* ====================== Direct Replacement Logic =================== */

    /**
     * Apply block replacements directly without the add/remove cancellation logic.
     * This is much simpler and more direct for replacement operations.
     */
    private _applyBlockReplacements(addedBlocks: Record<string, number>, removedBlocks: Record<string, number>) {
        console.log("ReplaceTool: Applying block replacements");
        const terrainRef = (this.terrainBuilderProps as any).terrainRef;
        const pendingChangesRef = (this.terrainBuilderProps as any).pendingChangesRef;
        const importedUpdateTerrainBlocks = (this.terrainBuilderProps as any).importedUpdateTerrainBlocks;

        if (!terrainRef || !pendingChangesRef || !importedUpdateTerrainBlocks) {
            console.error('ReplaceTool: Missing required references for block replacement');
            return;
        }

        // 1. Update terrain data directly
        Object.entries(addedBlocks).forEach(([posKey, newBlockId]) => {
            terrainRef.current[posKey] = newBlockId;
        });

        // 2. Update chunk system with the changes
        importedUpdateTerrainBlocks(addedBlocks, removedBlocks);

        // 3. Update pending changes for auto-save (track replacements as changes)
        if (!pendingChangesRef.current) {
            pendingChangesRef.current = {
                terrain: { added: {}, removed: {} },
                environment: { added: [], removed: [] },
            };
        }

        // For replacements, we track them as "replacements" to avoid cancellation logic
        // We'll store the new block ID in added and old block ID in removed
        Object.entries(addedBlocks).forEach(([posKey, newBlockId]) => {
            pendingChangesRef.current.terrain.added[posKey] = newBlockId;
        });

        Object.entries(removedBlocks).forEach(([posKey, oldBlockId]) => {
            // Only track the original removal if we haven't already tracked one for this position
            if (!pendingChangesRef.current.terrain.removed[posKey]) {
                pendingChangesRef.current.terrain.removed[posKey] = oldBlockId;
            }
        });


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