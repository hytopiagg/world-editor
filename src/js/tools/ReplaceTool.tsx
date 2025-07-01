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

        console.log('ReplaceTool: Starting new stroke at position:', intersectionPoint);

        // Log terrain data state for debugging
        const terrainData = (this.terrainBuilderProps as any).terrainRef.current;
        const centerKey = `${Math.round(intersectionPoint.x)},${Math.round(intersectionPoint.y)},${Math.round(intersectionPoint.z)}`;
        console.log('ReplaceTool: Terrain data check at center:', {
            position: centerKey,
            blockId: terrainData[centerKey],
            totalBlocks: Object.keys(terrainData).length
        });

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
                    environment: { added: [], removed: [] },
                } as any;
                this.undoRedoManager.current.saveUndo(snapshot);
                console.log('ReplaceTool: Saved undo snapshot', snapshot);
            }
        }
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

        const terrainData = terrainRef.current;
        console.log('ReplaceTool: Using terrain data with', Object.keys(terrainData).length, 'blocks');

        // Debug: Check a few blocks around center to see if they have the expected IDs
        const centerX = Math.round(this.currentPosition.x);
        const centerZ = Math.round(this.currentPosition.z);
        const centerY = Math.round(this.currentPosition.y);
        const centerKey = `${centerX},${centerY},${centerZ}`;
        console.log('ReplaceTool: Center block state:', {
            position: centerKey,
            blockId: terrainData[centerKey],
            exists: centerKey in terrainData
        });

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
                    let currentId = terrainData[posKey];
                    if (currentId === undefined) continue; // no block to replace

                    // Debug logging for the first few blocks to see what's happening
                    if (Object.keys(addedBlocks).length < 3) {
                        console.log('ReplaceTool: Processing block at', posKey, 'currentId:', currentId);
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

                        // Debug logging for first few changes
                        if (Object.keys(addedBlocks).length <= 3) {
                            console.log('ReplaceTool: Replacing block', posKey, 'from', currentId, 'to', chosenId);
                        }
                    } else if (Object.keys(addedBlocks).length < 3) {
                        console.log('ReplaceTool: No change needed for block', posKey, '- already', currentId);
                    }
                }
            }
        }

        if (Object.keys(addedBlocks).length || Object.keys(removedBlocks).length) {
            console.log('ReplaceTool: Applying changes', {
                added: Object.keys(addedBlocks).length,
                removed: Object.keys(removedBlocks).length,
                sampleAdded: Object.entries(addedBlocks).slice(0, 3),
                sampleRemoved: Object.entries(removedBlocks).slice(0, 3)
            });

            // Apply changes to terrain immediately
            // Skip spatial hash updates since we're replacing blocks at same positions (not adding/removing)
            (this.terrainBuilderProps as any).updateTerrainBlocks(
                addedBlocks,
                removedBlocks,
                {
                    syncPendingChanges: true,
                    skipSpatialHash: true  // Replacement operations don't change spatial positions
                }
            );

            // Verify terrain was updated by checking a sample block
            const sampleKey = Object.keys(addedBlocks)[0];
            if (sampleKey) {
                const expectedId = addedBlocks[sampleKey];
                const actualId = terrainData[sampleKey];
                console.log('ReplaceTool: Terrain update verification:', {
                    position: sampleKey,
                    expected: expectedId,
                    actual: actualId,
                    updated: actualId === expectedId
                });
            }

            // Also manually update pending changes to ensure they're tracked for auto-save
            this._updatePendingChanges(addedBlocks, removedBlocks);

            // Update stroke tracking for undo/redo
            Object.assign(this.strokeAdded, addedBlocks);
            Object.keys(addedBlocks).forEach(posKey => {
                // Only set the original removed block once per position per stroke
                if (!this.strokeRemoved[posKey]) {
                    this.strokeRemoved[posKey] = removedBlocks[posKey];
                }
            });
        } else {
            console.log('ReplaceTool: No changes to apply this cycle');
        }
    }

    /* ====================== Pending Changes Management ================== */

    /**
     * Manually update pendingChangesRef to ensure changes are tracked for auto-save.
     * For replacements, we need to track both the original block removal AND the new block addition.
     */
    private _updatePendingChanges(addedBlocks: Record<string, number>, removedBlocks: Record<string, number>) {
        const pendingRef = (this.terrainBuilderProps as any).pendingChangesRef?.current;
        if (!pendingRef) {
            console.warn('ReplaceTool: pendingChangesRef not available');
            return;
        }

        // Ensure terrain structures exist
        if (!pendingRef.terrain) {
            pendingRef.terrain = { added: {}, removed: {} };
        }

        console.log('ReplaceTool: Before updating pendingRef', {
            currentAdded: Object.keys(pendingRef.terrain.added || {}).length,
            currentRemoved: Object.keys(pendingRef.terrain.removed || {}).length,
            newAdded: Object.keys(addedBlocks).length,
            newRemoved: Object.keys(removedBlocks).length
        });

        // For block replacements, we need special logic:
        // 1. Always track the removed blocks (original blocks being replaced)
        // 2. Always track the added blocks (new blocks being placed)
        // This is different from normal add/remove operations where you might cancel out

        // First, process removed blocks - these represent the original blocks being replaced
        Object.entries(removedBlocks).forEach(([key, val]) => {
            // For replacements, we always want to track the original block that was removed
            // Don't cancel out with added blocks at the same position
            pendingRef.terrain.removed[key] = val;
        });

        // Then, process added blocks - these represent the new blocks being placed
        Object.entries(addedBlocks).forEach(([key, val]) => {
            // Always track the new block being added
            pendingRef.terrain.added[key] = val;
        });

        console.log('ReplaceTool: After updating pendingRef', {
            totalAdded: Object.keys(pendingRef.terrain.added || {}).length,
            totalRemoved: Object.keys(pendingRef.terrain.removed || {}).length,
            sampleAdded: Object.entries(pendingRef.terrain.added).slice(0, 3),
            sampleRemoved: Object.entries(pendingRef.terrain.removed).slice(0, 3)
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