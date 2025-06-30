import * as THREE from "three";
// Import from the same place as ToolBar.tsx
import { generatePerlinNoise } from "perlin-noise";
import BaseTool from "./BaseTool";

export class TerrainTool extends BaseTool {
    isPlacing: boolean;
    settings: any;
    previewCylinder: THREE.Mesh | null;
    previewGroup: THREE.Group | null;
    currentPosition: THREE.Vector3;
    placementHeight: number;
    heightMap: Map<string, number>;
    originalHeights: Map<string, number>;
    undoRedoManager: any;
    lastUpdateTime: number;
    noiseCache: Map<string, Float32Array>;
    lastTerrainUpdate: number;
    lastPosition: THREE.Vector3;
    dirtyRegions: Set<string>;
    falloffTable: number[];
    lastMeshUpdate: number;
    dirtyChunks: Set<string>;
    pendingAdded: Record<string, number>;
    pendingRemoved: Record<string, number>;
    strokeAdded: Record<string, number>;
    strokeRemoved: Record<string, number>;

    constructor(terrainBuilderProps: any) {
        super(terrainBuilderProps);
        this.name = "terrain";
        this.tooltip = "Terrain Tool - Click and drag to sculpt terrain. Use 1/2 for radius, 3/4 for elevation rate, ESC to cancel.";
        this.isPlacing = false;

        // Tool settings
        this.settings = {
            radius: 8,
            yLimit: 32,
            smoothing: 0.5,
            elevationRate: 2.0, // Increased default for better responsiveness
            noiseScale: 0.1,
            falloffCurve: "smooth", // smooth, linear, sharp
            mode: "elevate", // elevate, flatten, smooth
        };

        // Preview objects
        this.previewCylinder = null;
        this.previewGroup = null;
        this.currentPosition = new THREE.Vector3();
        this.placementHeight = 0;

        // Terrain modification state
        this.heightMap = new Map(); // Store modified heights
        this.originalHeights = new Map(); // Store original terrain heights
        this.undoRedoManager = terrainBuilderProps.undoRedoManager;

        // Performance optimization properties
        this.lastUpdateTime = 0;
        this.noiseCache = new Map(); // Cache noise generation
        this.lastTerrainUpdate = 0;
        this.lastPosition = new THREE.Vector3();
        this.dirtyRegions = new Set();
        this.lastMeshUpdate = 0;
        this.dirtyChunks = new Set();
        this.pendingAdded = {};
        this.pendingRemoved = {};

        // Initialize per-stroke change tracking
        this.strokeAdded = {};
        this.strokeRemoved = {};

        // Pre-compute fall-off table for the initial radius
        this.falloffTable = [];
        this._rebuildFalloffTable();

        this.createPreviewObjects();
    }

    createPreviewObjects() {
        this.previewGroup = new THREE.Group();

        // Create cylinder preview (balanced geometry for visibility)
        const cylinderGeometry = new THREE.CylinderGeometry(
            this.settings.radius,
            this.settings.radius,
            this.settings.yLimit,
            24, // Enough segments for proper face visibility
            1,
            true // Open ended
        );

        const cylinderMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.2, // Slightly increased for better visibility
            side: THREE.DoubleSide,
            wireframe: false,
            depthTest: true,
            depthWrite: false, // Don't write to depth buffer to avoid z-fighting
            alphaTest: 0.01, // Helps with transparency sorting
        });

        this.previewCylinder = new THREE.Mesh(cylinderGeometry, cylinderMaterial);
        this.previewGroup.add(this.previewCylinder);

        // Create wireframe outline
        const wireframeGeometry = new THREE.CylinderGeometry(
            this.settings.radius,
            this.settings.radius,
            this.settings.yLimit,
            16, // Balanced segments for wireframe visibility
            1,
            true
        );
        const wireframeMaterial = new THREE.MeshBasicMaterial({
            color: 0x00aa00,
            wireframe: true,
            transparent: true,
            opacity: 0.6,
            depthTest: true,
            depthWrite: false, // Don't write to depth buffer
        });

        const wireframe = new THREE.Mesh(wireframeGeometry, wireframeMaterial);
        this.previewGroup.add(wireframe);

        this.previewGroup.visible = false;
    }

    onActivate() {
        console.log("Terrain tool activated");

        // Add preview to scene
        if ((this.terrainBuilderProps as any).scene && this.previewGroup) {
            (this.terrainBuilderProps as any).scene.add(this.previewGroup);
            this.previewGroup.visible = true;
        }

        // Reset tool state
        this.isPlacing = false;
        this.heightMap.clear();
        this.originalHeights.clear();
        this.dirtyRegions.clear();

        return true;
    }

    onDeactivate() {
        console.log("Terrain tool deactivated");

        // Remove preview from scene
        if ((this.terrainBuilderProps as any).scene && this.previewGroup) {
            (this.terrainBuilderProps as any).scene.remove(this.previewGroup);
            this.previewGroup.visible = false;
        }

        // Apply any pending terrain changes
        if (this.heightMap.size > 0) {
            this.applyHeightChanges();
        }

        // Clear cache to free memory
        this.noiseCache.clear();
    }

    handleMouseMove(mouseEvent, intersectionPoint) {
        if (!this.active || !intersectionPoint) return;

        // Update preview position
        this.currentPosition.copy(intersectionPoint);
        this.currentPosition.x = Math.round(this.currentPosition.x);
        this.currentPosition.z = Math.round(this.currentPosition.z);

        // Find ground level at this position
        this.placementHeight = this.findGroundLevel(this.currentPosition.x, this.currentPosition.z);

        // Update preview cylinder position (slightly elevated to avoid z-fighting)
        if (this.previewGroup) {
            this.previewGroup.position.set(
                this.currentPosition.x,
                this.placementHeight + this.settings.yLimit / 2 + 0.05, // Minimal offset to avoid z-fighting
                this.currentPosition.z
            );
        }

        // If actively placing, modify terrain (with aggressive throttling for performance)
        if (this.isPlacing) {
            const now = performance.now();
            if (now - this.lastTerrainUpdate > 33) { // Throttle to 30fps max for terrain updates during drag
                this.modifyTerrain();
                this.lastTerrainUpdate = now;
            }
        }
    }

    handleMouseDown(mouseEvent, intersectionPoint) {
        if (!this.active || !intersectionPoint) return;

        // First click of a stroke – enable deferred meshing so chunks are rebuilt once at the end
        if (!this.isPlacing && (this.terrainBuilderProps as any).setDeferredChunkMeshing) {
            try {
                (this.terrainBuilderProps as any).setDeferredChunkMeshing(true);
            } catch (_) { }
        }

        this.isPlacing = true;
        console.log("Terrain tool: Started terrain modification");

        // Reset per-stroke change trackers
        this.strokeAdded = {};
        this.strokeRemoved = {};

        // Store original heights for undo
        this.storeOriginalHeights();

        // Start modifying terrain
        this.modifyTerrain();
    }

    handleMouseUp() {
        if (!this.active) return;

        this.isPlacing = false;
        console.log("Terrain tool: Finished terrain modification");

        // Apply all height changes to terrain and spatial hash updates
        this.applyHeightChanges();

        // Re-enable chunk meshing now that the stroke is complete
        if ((this.terrainBuilderProps as any).setDeferredChunkMeshing) {
            try {
                (this.terrainBuilderProps as any).setDeferredChunkMeshing(false);
            } catch (_) { }
        }

        // Flush remaining dirty chunks
        if ((Object.keys(this.pendingAdded).length || Object.keys(this.pendingRemoved).length) && (this.terrainBuilderProps as any).updateTerrainBlocks) {
            (this.terrainBuilderProps as any).updateTerrainBlocks(this.pendingAdded, this.pendingRemoved, { syncPendingChanges: true });
            this.pendingAdded = {}; this.pendingRemoved = {};
        }

        if (this.dirtyChunks.size > 0 && (this.terrainBuilderProps as any).forceChunkUpdate) {
            try {
                (this.terrainBuilderProps as any).forceChunkUpdate(Array.from(this.dirtyChunks));
            } catch (_) {
                if ((this.terrainBuilderProps as any).forceRefreshAllChunks) {
                    (this.terrainBuilderProps as any).forceRefreshAllChunks();
                }
            }
            this.dirtyChunks.clear();
        } else if ((this.terrainBuilderProps as any).forceRefreshAllChunks) {
            try {
                (this.terrainBuilderProps as any).forceRefreshAllChunks();
            } catch (_) { }
        }

        // Persist undo state for THIS stroke only
        if (this.undoRedoManager?.current?.saveUndo) {
            const hasTerrainChanges =
                Object.keys(this.strokeAdded).length > 0 ||
                Object.keys(this.strokeRemoved).length > 0;
            if (hasTerrainChanges) {
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
        // Leave pendingChangesRef untouched for auto-save – stroke trackers will be cleared automatically on next handleMouseDown
    }

    findGroundLevel(x, z) {
        const terrainData = (this.terrainBuilderProps as any).terrainRef.current;

        // Search downward from a reasonable height to find the ground
        for (let y = 64; y >= 0; y--) {
            const key = `${x},${y},${z}`;
            if (terrainData[key]) {
                return y + 1; // Return one block above the highest solid block
            }
        }

        return 0; // Default to y=0 if no terrain found
    }

    storeOriginalHeights() {
        const radius = Math.ceil(this.settings.radius);
        const centerX = Math.round(this.currentPosition.x);
        const centerZ = Math.round(this.currentPosition.z);

        for (let x = centerX - radius; x <= centerX + radius; x++) {
            for (let z = centerZ - radius; z <= centerZ + radius; z++) {
                const distance = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(z - centerZ, 2));
                if (distance <= this.settings.radius) {
                    const heightKey = `${x},${z}`;
                    if (!this.originalHeights.has(heightKey)) {
                        const currentHeight = this.findGroundLevel(x, z);
                        this.originalHeights.set(heightKey, currentHeight);
                    }
                }
            }
        }
    }

    modifyTerrain() {
        const radius = this.settings.radius;
        const centerX = Math.round(this.currentPosition.x);
        const centerZ = Math.round(this.currentPosition.z);
        const centerY = this.placementHeight;

        // Skip if position hasn't changed enough (micro-optimization)
        const positionDelta = this.currentPosition.distanceTo(this.lastPosition);
        if (positionDelta < 0.1) {
            return;
        }
        this.lastPosition.copy(this.currentPosition);

        // Use full radius for consistent behavior - LOD was causing radius issues
        const effectiveRadius = radius;

        // Generate noise for more natural terrain (with caching for performance)
        const noiseSize = Math.ceil(effectiveRadius * 2);
        const cacheKey = `${noiseSize}_${this.settings.noiseScale}`;
        let noiseData = this.noiseCache.get(cacheKey);

        if (!noiseData) {
            noiseData = generatePerlinNoise(noiseSize, noiseSize, {
                octaveCount: 2, // Consistent octaves for reliable performance
                scale: this.settings.noiseScale,
                persistence: 0.5,
                amplitude: 1.0
            });
            this.noiseCache.set(cacheKey, noiseData);

            // Limit cache size to prevent memory leaks
            if (this.noiseCache.size > 15) {
                const firstKey = this.noiseCache.keys().next().value;
                this.noiseCache.delete(firstKey);
            }
        }

        // Track changes for real-time application
        const addedBlocks = {};
        const removedBlocks = {};
        const terrainData = (this.terrainBuilderProps as any).terrainRef.current;

        // Cache ground levels to avoid repeated calculations
        const groundLevelCache = new Map();

        // Use effective radius for performance during fast movement
        for (let x = centerX - effectiveRadius; x <= centerX + effectiveRadius; x++) {
            for (let z = centerZ - effectiveRadius; z <= centerZ + effectiveRadius; z++) {
                const dx = x - centerX;
                const dz = z - centerZ;
                const distanceSq = dx * dx + dz * dz;
                const radiusSq = effectiveRadius * effectiveRadius;

                if (distanceSq <= radiusSq) {
                    const distance = Math.sqrt(distanceSq);
                    // Calculate falloff based on distance from center
                    const falloff = this.falloffTable[Math.min(this.falloffTable.length - 1, Math.round(distance))];

                    // Track dirty chunk for selective meshing
                    const CHUNK_SIZE = 16;
                    const chunkKey = `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
                    this.dirtyChunks.add(chunkKey);

                    // Skip blocks with minimal effect (performance optimization)
                    if (falloff < 0.005) { // Reduced threshold to ensure more blocks are processed
                        continue;
                    }

                    // Add noise variation (optimized indexing)
                    const noiseX = Math.floor((x - (centerX - effectiveRadius)) * (noiseSize / (effectiveRadius * 2)));
                    const noiseZ = Math.floor((z - (centerZ - effectiveRadius)) * (noiseSize / (effectiveRadius * 2)));
                    const noiseIndex = Math.max(0, Math.min(noiseSize * noiseSize - 1, noiseZ * noiseSize + noiseX));
                    const noiseValue = noiseData[noiseIndex] * 0.5; // Scale noise effect

                    // Calculate target height based on mode
                    const heightKey = `${x},${z}`;
                    let currentHeight = this.heightMap.get(heightKey);
                    if (currentHeight === undefined) {
                        // Use cached ground level or calculate once
                        const groundKey = `${x},${z}`;
                        if (!groundLevelCache.has(groundKey)) {
                            groundLevelCache.set(groundKey, this.findGroundLevel(x, z));
                        }
                        currentHeight = groundLevelCache.get(groundKey);
                    }
                    let targetHeight = currentHeight;

                    switch (this.settings.mode) {
                        case "elevate":
                            targetHeight = Math.min(
                                currentHeight + (this.settings.elevationRate * falloff * 0.5) + (noiseValue * 0.2), // Increased for better responsiveness
                                centerY + this.settings.yLimit
                            );
                            break;
                        case "flatten":
                            targetHeight = this.lerp(currentHeight, centerY, falloff * this.settings.elevationRate * 0.3);
                            break;
                        case "smooth":
                            // Average with surrounding heights
                            const avgHeight = this.getAverageHeight(x, z, 2);
                            targetHeight = this.lerp(currentHeight, avgHeight, falloff * this.settings.elevationRate * 0.3);
                            break;
                    }

                    // Skip if height change is negligible (performance optimization)
                    const heightDifference = Math.abs(targetHeight - currentHeight);
                    if (heightDifference < 0.005) { // Reduced threshold to process more height changes
                        continue;
                    }

                    // Apply smoothing
                    if (this.settings.smoothing > 0) {
                        const smoothedHeight = this.lerp(currentHeight, targetHeight, this.settings.smoothing);
                        this.heightMap.set(heightKey, smoothedHeight);
                    } else {
                        this.heightMap.set(heightKey, targetHeight);
                    }

                    // Apply changes in real-time
                    const newGroundLevel = Math.round(this.heightMap.get(heightKey));
                    const groundKey = `${x},${z}`;
                    const oldGroundLevel = groundLevelCache.get(groundKey) || this.findGroundLevel(x, z);

                    // Remove blocks above new height
                    for (let y = Math.max(oldGroundLevel, newGroundLevel + 1); y <= Math.max(oldGroundLevel, 64); y++) {
                        const blockKey = `${x},${y},${z}`;
                        if (terrainData[blockKey]) {
                            removedBlocks[blockKey] = terrainData[blockKey];
                        }
                    }

                    // Add blocks up to new height using the currently selected block type from App.tsx
                    const currentBlockType = (this.terrainBuilderProps as any).currentBlockTypeRef?.current;
                    const selectedBlockId = currentBlockType?.id || 1; // Default fallback

                    for (let y = Math.min(oldGroundLevel, 0); y <= newGroundLevel; y++) {
                        const blockKey = `${x},${y},${z}`;
                        if (!terrainData[blockKey]) {
                            // Always use the currently selected block type
                            const blockType = selectedBlockId;
                            addedBlocks[blockKey] = blockType;
                        }
                    }
                }
            }
        }

        // Apply changes to terrain in real-time (optimized for speed)
        const totalChanges = Object.keys(addedBlocks).length + Object.keys(removedBlocks).length;
        if (totalChanges > 0) {
            // Buffer terrain changes; commit during flush for better performance
            Object.assign(this.pendingAdded, addedBlocks);
            Object.assign(this.pendingRemoved, removedBlocks);

            // Accumulate per-stroke changes for accurate undo
            Object.assign(this.strokeAdded, addedBlocks);
            Object.assign(this.strokeRemoved, removedBlocks);

            // Periodically flush chunk meshing for near-real-time visuals
            const nowFlush = performance.now();
            if (nowFlush - this.lastMeshUpdate > 250) {
                // First push buffered terrain updates so mesher sees new blocks
                if ((Object.keys(this.pendingAdded).length || Object.keys(this.pendingRemoved).length) && (this.terrainBuilderProps as any).updateTerrainBlocks) {
                    (this.terrainBuilderProps as any).updateTerrainBlocks(this.pendingAdded, this.pendingRemoved, { syncPendingChanges: true, skipSpatialHash: true, skipUndoSave: true });
                    this.pendingAdded = {}; this.pendingRemoved = {};
                }

                if (this.dirtyChunks.size > 0 && (this.terrainBuilderProps as any).forceChunkUpdate) {
                    try {
                        (this.terrainBuilderProps as any).forceChunkUpdate(Array.from(this.dirtyChunks));
                    } catch (_) {
                        // fallback to full refresh if selective update fails
                        if ((this.terrainBuilderProps as any).forceRefreshAllChunks) {
                            (this.terrainBuilderProps as any).forceRefreshAllChunks();
                        }
                    }
                    this.dirtyChunks.clear();
                } else if ((this.terrainBuilderProps as any).forceRefreshAllChunks) {
                    try {
                        (this.terrainBuilderProps as any).forceRefreshAllChunks();
                    } catch (_) { }
                }
                this.lastMeshUpdate = nowFlush;
            }
        }
    }

    calculateFalloff(distance, radius) {
        const normalizedDistance = distance / radius;

        switch (this.settings.falloffCurve) {
            case "linear":
                return 1 - normalizedDistance;
            case "sharp":
                return 1 - Math.pow(normalizedDistance, 0.5);
            case "smooth":
            default:
                return 1 - Math.pow(normalizedDistance, 2);
        }
    }

    getAverageHeight(centerX, centerZ, sampleRadius) {
        let totalHeight = 0;
        let sampleCount = 0;

        // Cache for this calculation to avoid repeated ground level lookups
        const localCache = new Map();

        for (let x = centerX - sampleRadius; x <= centerX + sampleRadius; x++) {
            for (let z = centerZ - sampleRadius; z <= centerZ + sampleRadius; z++) {
                const heightKey = `${x},${z}`;
                let height = this.heightMap.get(heightKey);

                if (height === undefined) {
                    if (!localCache.has(heightKey)) {
                        localCache.set(heightKey, this.findGroundLevel(x, z));
                    }
                    height = localCache.get(heightKey);
                }

                totalHeight += height;
                sampleCount++;
            }
        }

        return sampleCount > 0 ? totalHeight / sampleCount : 0;
    }

    lerp(a, b, t) {
        return a + (b - a) * Math.max(0, Math.min(1, t));
    }

    applyHeightChanges() {
        // Since we're now applying changes in real-time during modifyTerrain(),
        // we just need to clear the height maps on mouse up and update spatial hash

        // Apply final spatial hash update for collision detection
        if (this.heightMap.size > 0) {
            const terrainData = (this.terrainBuilderProps as any).terrainRef.current;
            const affectedBlocks = [];

            for (const [heightKey] of this.heightMap.entries()) {
                const [x, z] = heightKey.split(',').map(Number);
                const groundLevel = this.findGroundLevel(x, z);

                // Add all blocks in the affected column to spatial hash update
                for (let y = 0; y <= Math.max(groundLevel + 5, 20); y++) {
                    const blockKey = `${x},${y},${z}`;
                    if (terrainData[blockKey]) {
                        affectedBlocks.push({
                            id: terrainData[blockKey],
                            position: [x, y, z]
                        });
                    }
                }
            }

            // Update spatial hash for affected area
            if (affectedBlocks.length > 0 && (this.terrainBuilderProps as any).updateSpatialHashForBlocks) {
                (this.terrainBuilderProps as any).updateSpatialHashForBlocks(affectedBlocks, [], {
                    force: true
                });
            }
        }

        this.heightMap.clear();
        this.originalHeights.clear();
        this.dirtyRegions.clear();

        console.log("Terrain tool: Cleared height maps after terrain modification");
    }

    updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };

        // Update preview cylinder if settings changed
        if (this.previewCylinder && this.previewGroup && (newSettings.radius || newSettings.yLimit)) {
            // Remove old cylinder and wireframe
            this.previewGroup.children.forEach(child => {
                if ((child as any).geometry) (child as any).geometry.dispose();
                if ((child as any).material) {
                    if (Array.isArray((child as any).material)) {
                        (child as any).material.forEach((mat: any) => mat.dispose());
                    } else {
                        (child as any).material.dispose();
                    }
                }
            });
            this.previewGroup.clear();

            // Create new cylinder with updated settings
            const cylinderGeometry = new THREE.CylinderGeometry(
                this.settings.radius,
                this.settings.radius,
                this.settings.yLimit,
                24, // Enough segments for proper face visibility
                1,
                true
            );

            const cylinderMaterial = new THREE.MeshBasicMaterial({
                color: 0x00ff00,
                transparent: true,
                opacity: 0.2, // Slightly increased for better visibility
                side: THREE.DoubleSide,
                wireframe: false,
                depthTest: true,
                depthWrite: false, // Don't write to depth buffer to avoid z-fighting
                alphaTest: 0.01, // Helps with transparency sorting
            });

            this.previewCylinder = new THREE.Mesh(cylinderGeometry, cylinderMaterial);
            this.previewGroup.add(this.previewCylinder);

            // Create new wireframe outline
            const wireframeGeometry = new THREE.CylinderGeometry(
                this.settings.radius,
                this.settings.radius,
                this.settings.yLimit,
                16, // Balanced segments for wireframe visibility
                1,
                true
            );
            const wireframeMaterial = new THREE.MeshBasicMaterial({
                color: 0x00aa00,
                wireframe: true,
                transparent: true,
                opacity: 0.6,
                depthTest: true,
                depthWrite: false, // Don't write to depth buffer
            });

            const wireframe = new THREE.Mesh(wireframeGeometry, wireframeMaterial);
            this.previewGroup.add(wireframe);
        }

        // Rebuild fall-off table if radius or curve changed
        if (newSettings.radius || newSettings.falloffCurve) {
            this._rebuildFalloffTable();
        }
    }

    handleKeyDown(event) {
        switch (event.key.toLowerCase()) {
            case 'escape':
                // Cancel current operation
                this.isPlacing = false;
                this.heightMap.clear();
                break;
            case '1':
                // Decrease radius
                this.updateSettings({ radius: Math.max(1, this.settings.radius - 1) });
                break;
            case '2':
                // Increase radius
                this.updateSettings({ radius: Math.min(100, this.settings.radius + 1) });
                break;
            case '3':
                // Decrease elevation rate
                this.updateSettings({ elevationRate: Math.max(0.1, this.settings.elevationRate - 0.5) });
                break;
            case '4':
                // Increase elevation rate
                this.updateSettings({ elevationRate: Math.min(10.0, this.settings.elevationRate + 0.5) });
                break;
        }
    }

    dispose() {
        if (this.previewGroup) {
            if ((this.terrainBuilderProps as any).scene) {
                (this.terrainBuilderProps as any).scene.remove(this.previewGroup);
            }

            // Dispose of geometries and materials
            this.previewGroup.traverse((child) => {
                if ((child as any).geometry) (child as any).geometry.dispose();
                if ((child as any).material) {
                    if (Array.isArray((child as any).material)) {
                        (child as any).material.forEach((material: any) => material.dispose());
                    } else {
                        (child as any).material.dispose();
                    }
                }
            });
        }

        this.heightMap.clear();
        this.originalHeights.clear();
        this.noiseCache.clear();
        this.dirtyRegions.clear();
    }

    _rebuildFalloffTable() {
        const r = Math.ceil(this.settings.radius);
        this.falloffTable.length = r + 1;
        for (let d = 0; d <= r; d++) {
            const normalized = d / r;
            let val;
            switch (this.settings.falloffCurve) {
                case "linear":
                    val = 1 - normalized;
                    break;
                case "sharp":
                    val = 1 - Math.pow(normalized, 0.5);
                    break;
                case "smooth":
                default:
                    val = 1 - normalized * normalized;
                    break;
            }
            this.falloffTable[d] = val;
        }
    }

    /**
     * Flush buffered edits by merging them into TerrainBuilder.pendingChangesRef only.
     * We purposely avoid calling updateTerrainBlocks here to prevent unintended
     * DB writes or extra undo-stack entries. The actual DB commit happens later
     * via efficientTerrainSave which reads pendingChangesRef.
     */
    flushPending() {
        const pendingRef = (this.terrainBuilderProps as any).pendingChangesRef?.current;
        if (!pendingRef) {
            return;
        }

        // Ensure terrain structures exist
        if (!pendingRef.terrain) {
            pendingRef.terrain = { added: {}, removed: {} };
        }

        // Merge buffered additions
        Object.entries(this.pendingAdded).forEach(([key, val]) => {
            if (pendingRef.terrain.removed[key]) {
                delete pendingRef.terrain.removed[key];
            }
            pendingRef.terrain.added[key] = val;
        });

        // Merge buffered removals
        Object.entries(this.pendingRemoved).forEach(([key, val]) => {
            if (pendingRef.terrain.added[key]) {
                delete pendingRef.terrain.added[key];
            }
            pendingRef.terrain.removed[key] = val;
        });

        // Clear internal buffers – changes safely transferred
        this.pendingAdded = {};
        this.pendingRemoved = {};

        // Keep dirtyChunks so selective meshing still happens on the visual side.
    }
} 