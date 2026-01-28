import * as THREE from "three";
import BaseTool from "./BaseTool";

/**
 * Pattern data structure representing a structure to find or replace with.
 * Stores blocks in normalized format (relative to origin 0,0,0).
 */
export interface PatternData {
    blocks: Record<string, number>; // "x,y,z" -> blockId
    rotations: Record<string, number>; // "x,y,z" -> rotationIndex (only non-zero)
    shapes: Record<string, string>; // "x,y,z" -> shapeType (only non-cube)
    width: number;
    height: number;
    depth: number;
    name?: string;
    componentId?: string;
}

/**
 * Pre-parsed pattern block for faster matching (avoids string parsing in hot loop)
 */
interface ParsedPatternBlock {
    dx: number; // delta x from origin
    dy: number; // delta y from origin
    dz: number; // delta z from origin
    blockId: number;
    rotation?: number; // optional rotation index
    shape?: string; // optional shape type
}

/**
 * Pre-parsed pattern with optimized data structure for fast matching
 */
interface OptimizedPattern {
    blocks: ParsedPatternBlock[];
    firstBlock: ParsedPatternBlock; // The anchor block at 0,0,0
    width: number;
    height: number;
    depth: number;
}

/**
 * A match found in the terrain
 */
export interface FoundMatch {
    position: THREE.Vector3; // World position of match origin
    rotation: number; // 0, 1, 2, 3 (0°, 90°, 180°, 270°)
}

/**
 * FindReplaceTool – Find structures in the terrain and replace them with other structures.
 * 
 * Features:
 * - Define find pattern via selection or existing component
 * - Define replacement via component, AI generation, or multiple random components
 * - Scope: selected area or entire map
 * - Match rotations (0°, 90°, 180°, 270°) optionally
 * - Random rotation option for replacements
 * - Full undo/redo support
 */
export default class FindReplaceTool extends BaseTool {
    isDefiningFind: boolean = false;
    isDefiningReplace: boolean = false;
    selectionStartPosition: THREE.Vector3 | null = null;
    selectionPreview: THREE.Group | null = null;
    
    findPattern: PatternData | null = null;
    replacePatterns: PatternData[] = [];
    
    settings: {
        scope: "selection" | "entire_map";
        matchRotations: boolean;
        randomReplacementRotation: boolean;
        selectionBounds: {
            min: THREE.Vector3;
            max: THREE.Vector3;
        } | null;
        // Offset to shift replacement blocks (in world coordinates)
        replacementOffset: {
            x: number;
            y: number;
            z: number;
        };
    };
    
    foundMatches: FoundMatch[] = [];
    highlightMeshes: THREE.Mesh[] = [];
    
    undoRedoManager: any;
    terrainRef: any;
    scene: THREE.Scene;
    pendingChangesRef: any;
    terrainBuilderRef: any;
    previewPositionRef: any;
    
    selectionHeight: number = 1;
    currentSelectionMode: "find" | "replace" | "scope" | null = null;
    
    // Scope selection properties
    scopeStartPosition: THREE.Vector3 | null = null;
    scopeEndPosition: THREE.Vector3 | null = null;
    scopePreview: THREE.Group | null = null;
    
    // Search state for async operations
    isSearching: boolean = false;
    searchCancelled: boolean = false;
    searchProgress: number = 0;
    
    // Post-swap adjustment mode state
    isAdjustingMode: boolean = false;
    preSwapTerrainState: Record<string, number> = {}; // Terrain state before any changes
    replacementData: {
        matches: FoundMatch[];
        replacePattern: PatternData;
        addedBlockKeys: string[]; // Keys of blocks that were added
        removedBlocks: Record<string, number>; // Original blocks that were removed
    } | null = null;
    lastAppliedOffset: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
    
    constructor(terrainBuilderProps: any) {
        super(terrainBuilderProps);
        this.name = "findreplace";
        this.tooltip = "Find & Replace Tool – Define a structure to find and replace with another structure";
        
        this.undoRedoManager = terrainBuilderProps.undoRedoManager;
        this.terrainRef = terrainBuilderProps.terrainRef;
        this.scene = terrainBuilderProps.scene;
        this.pendingChangesRef = terrainBuilderProps.pendingChangesRef;
        this.terrainBuilderRef = terrainBuilderProps.terrainBuilderRef;
        this.previewPositionRef = terrainBuilderProps.previewPositionRef;
        
        this.settings = {
            scope: "entire_map",
            matchRotations: true,
            randomReplacementRotation: false,
            selectionBounds: null,
            replacementOffset: { x: 0, y: 0, z: 0 },
        };
    }
    
    async onActivate() {
        this.resetState();
        
        // Set up event listeners for UI communication
        this._handleStartFindSelection = () => this.startDefiningFind();
        this._handleStartReplaceSelection = () => this.startDefiningReplace();
        this._handleStartScopeSelection = () => this.startDefiningScope();
        
        window.addEventListener("findreplace-start-find-selection", this._handleStartFindSelection);
        window.addEventListener("findreplace-start-replace-selection", this._handleStartReplaceSelection);
        window.addEventListener("findreplace-start-scope-selection", this._handleStartScopeSelection);
        
        // Dispatch event to notify UI that tool is active
        window.dispatchEvent(new CustomEvent("findreplace-activated"));
        return true;
    }
    
    // Event handler references for cleanup
    _handleStartFindSelection: (() => void) | null = null;
    _handleStartReplaceSelection: (() => void) | null = null;
    _handleStartScopeSelection: (() => void) | null = null;
    
    onDeactivate() {
        // Auto-confirm if in adjustment mode
        if (this.isAdjustingMode) {
            this.confirmAdjustment();
        }
        
        // Clean up event listeners
        if (this._handleStartFindSelection) {
            window.removeEventListener("findreplace-start-find-selection", this._handleStartFindSelection);
        }
        if (this._handleStartReplaceSelection) {
            window.removeEventListener("findreplace-start-replace-selection", this._handleStartReplaceSelection);
        }
        if (this._handleStartScopeSelection) {
            window.removeEventListener("findreplace-start-scope-selection", this._handleStartScopeSelection);
        }
        
        this.clearAllPreviews();
        this.resetState();
        window.dispatchEvent(new CustomEvent("findreplace-deactivated"));
    }
    
    resetState() {
        this.isDefiningFind = false;
        this.isDefiningReplace = false;
        this.selectionStartPosition = null;
        this.currentSelectionMode = null;
        this.scopeStartPosition = null;
        this.scopeEndPosition = null;
        this.foundMatches = [];
        this.isAdjustingMode = false;
        this.preSwapTerrainState = {};
        this.replacementData = null;
        this.lastAppliedOffset = { x: 0, y: 0, z: 0 };
        this.selectionHeight = 1;
        this.clearAllPreviews();
    }
    
    clearAllPreviews() {
        if (this.selectionPreview && this.scene) {
            this.scene.remove(this.selectionPreview);
            this.selectionPreview.traverse((child) => {
                if ((child as any).geometry) (child as any).geometry.dispose();
                if ((child as any).material) {
                    if (Array.isArray((child as any).material)) {
                        (child as any).material.forEach((m: any) => m.dispose());
                    } else {
                        (child as any).material.dispose();
                    }
                }
            });
            this.selectionPreview = null;
        }
        
        if (this.scopePreview && this.scene) {
            this.scene.remove(this.scopePreview);
            this.scopePreview.traverse((child) => {
                if ((child as any).geometry) (child as any).geometry.dispose();
                if ((child as any).material) {
                    if (Array.isArray((child as any).material)) {
                        (child as any).material.forEach((m: any) => m.dispose());
                    } else {
                        (child as any).material.dispose();
                    }
                }
            });
            this.scopePreview = null;
        }
        
        this.clearHighlights();
    }
    
    clearHighlights() {
        this.highlightMeshes.forEach(mesh => {
            if (this.scene) {
                this.scene.remove(mesh);
            }
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) {
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach(m => m.dispose());
                } else {
                    (mesh.material as THREE.Material).dispose();
                }
            }
        });
        this.highlightMeshes = [];
    }
    
    // Start defining the find pattern via selection
    startDefiningFind() {
        // Clear any existing selection state first
        this.selectionStartPosition = null;
        this.scopeStartPosition = null;
        this.clearAllPreviews();
        
        this.currentSelectionMode = "find";
        this.selectionHeight = 1;
        this.tooltip = "Click to start selection for FIND pattern, click again to confirm. Use 1|2 to adjust height.";
        
        console.log("[FindReplaceTool] Starting find selection mode");
        
        window.dispatchEvent(new CustomEvent("findreplace-mode-changed", { 
            detail: { mode: "defining-find" } 
        }));
    }
    
    // Start defining the replace pattern via selection
    startDefiningReplace() {
        // Clear any existing selection state first
        this.selectionStartPosition = null;
        this.scopeStartPosition = null;
        this.clearAllPreviews();
        
        this.currentSelectionMode = "replace";
        this.selectionHeight = 1;
        this.tooltip = "Click to start selection for REPLACE pattern, click again to confirm. Use 1|2 to adjust height.";
        
        console.log("[FindReplaceTool] Starting replace selection mode");
        
        window.dispatchEvent(new CustomEvent("findreplace-mode-changed", { 
            detail: { mode: "defining-replace" } 
        }));
    }
    
    // Start defining scope via selection
    startDefiningScope() {
        // Clear any existing selection state first
        this.selectionStartPosition = null;
        this.scopeStartPosition = null;
        this.scopeEndPosition = null;
        this.clearAllPreviews();
        
        this.currentSelectionMode = "scope";
        this.selectionHeight = 1;
        this.tooltip = "Click to start selection for search SCOPE, click again to confirm. Use 1|2 to adjust height.";
        
        console.log("[FindReplaceTool] Starting scope selection mode");
        
        window.dispatchEvent(new CustomEvent("findreplace-mode-changed", { 
            detail: { mode: "defining-scope" } 
        }));
    }
    
    // Set find pattern from a component/schematic
    setFindPatternFromComponent(component: any) {
        const blocks = component.schematic?.blocks || component.schematic || {};
        this.findPattern = this.normalizePattern(blocks, component.name || component.prompt || "Component");
        this.findPattern.componentId = component.id;
        
        window.dispatchEvent(new CustomEvent("findreplace-pattern-updated", {
            detail: { type: "find", pattern: this.findPattern }
        }));
        
        // Auto-find matches when find pattern is set
        this.findMatches();
    }
    
    // Set replace pattern(s) from component(s)
    setReplacePatternFromComponent(component: any, addToList: boolean = false) {
        const blocks = component.schematic?.blocks || component.schematic || {};
        const pattern = this.normalizePattern(blocks, component.name || component.prompt || "Component");
        pattern.componentId = component.id;
        
        if (addToList) {
            this.replacePatterns.push(pattern);
        } else {
            this.replacePatterns = [pattern];
        }
        
        window.dispatchEvent(new CustomEvent("findreplace-pattern-updated", {
            detail: { type: "replace", patterns: this.replacePatterns }
        }));
    }
    
    // Clear replace patterns
    clearReplacePatterns() {
        this.replacePatterns = [];
        window.dispatchEvent(new CustomEvent("findreplace-pattern-updated", {
            detail: { type: "replace", patterns: [] }
        }));
    }
    
    // Remove a specific replace pattern
    removeReplacePattern(index: number) {
        this.replacePatterns.splice(index, 1);
        window.dispatchEvent(new CustomEvent("findreplace-pattern-updated", {
            detail: { type: "replace", patterns: this.replacePatterns }
        }));
    }
    
    // Normalize a block pattern to have origin at 0,0,0
    normalizePattern(
        blocks: Record<string, number>,
        name?: string,
        rotations?: Record<string, number>,
        shapes?: Record<string, string>
    ): PatternData {
        const entries = Object.entries(blocks);
        if (entries.length === 0) {
            return { blocks: {}, rotations: {}, shapes: {}, width: 0, height: 0, depth: 0, name };
        }

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        // Find bounds
        entries.forEach(([posKey]) => {
            const [x, y, z] = posKey.split(",").map(Number);
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            minZ = Math.min(minZ, z);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            maxZ = Math.max(maxZ, z);
        });

        // Normalize to origin
        const normalizedBlocks: Record<string, number> = {};
        const normalizedRotations: Record<string, number> = {};
        const normalizedShapes: Record<string, string> = {};
        entries.forEach(([posKey, blockId]) => {
            const [x, y, z] = posKey.split(",").map(Number);
            const normalizedKey = `${x - minX},${y - minY},${z - minZ}`;
            normalizedBlocks[normalizedKey] = blockId;
            // Copy rotation and shape if present
            if (rotations && rotations[posKey]) {
                normalizedRotations[normalizedKey] = rotations[posKey];
            }
            if (shapes && shapes[posKey]) {
                normalizedShapes[normalizedKey] = shapes[posKey];
            }
        });

        return {
            blocks: normalizedBlocks,
            rotations: normalizedRotations,
            shapes: normalizedShapes,
            width: maxX - minX + 1,
            height: maxY - minY + 1,
            depth: maxZ - minZ + 1,
            name,
        };
    }
    
    // Rotate a pattern by 90 degrees (clockwise when viewed from above)
    rotatePattern(pattern: PatternData, times: number): PatternData {
        if (times === 0) return pattern;

        let rotatedBlocks: Record<string, number> = { ...pattern.blocks };
        let rotatedRotations: Record<string, number> = { ...(pattern.rotations || {}) };
        let rotatedShapes: Record<string, string> = { ...(pattern.shapes || {}) };
        let width = pattern.width;
        let depth = pattern.depth;

        for (let i = 0; i < times; i++) {
            const newBlocks: Record<string, number> = {};
            const newRotations: Record<string, number> = {};
            const newShapes: Record<string, string> = {};
            const currentWidth = width; // Capture current width for this iteration

            Object.entries(rotatedBlocks).forEach(([posKey, blockId]) => {
                const [x, y, z] = posKey.split(",").map(Number);
                // Rotate 90° clockwise: (x, z) -> (z, width-1-x)
                const newX = z;
                const newZ = (currentWidth - 1) - x;
                const newKey = `${newX},${y},${newZ}`;
                newBlocks[newKey] = blockId;
                // Carry over rotation and shape data
                if (rotatedRotations[posKey]) {
                    newRotations[newKey] = rotatedRotations[posKey];
                }
                if (rotatedShapes[posKey]) {
                    newShapes[newKey] = rotatedShapes[posKey];
                }
            });

            rotatedBlocks = newBlocks;
            rotatedRotations = newRotations;
            rotatedShapes = newShapes;
            // Swap width and depth
            [width, depth] = [depth, width];
        }

        // Re-normalize to ensure origin is at 0,0,0
        return this.normalizePattern(rotatedBlocks, pattern.name, rotatedRotations, rotatedShapes);
    }
    
    // Cancel any ongoing search
    cancelSearch() {
        this.searchCancelled = true;
        window.dispatchEvent(new CustomEvent("findreplace-matches-updated", {
            detail: { matches: this.foundMatches.length, searching: false, cancelled: true }
        }));
    }
    
    /**
     * Convert a PatternData to an OptimizedPattern for faster matching.
     * Pre-parses all coordinates to avoid string parsing in the hot loop.
     */
    createOptimizedPattern(pattern: PatternData): OptimizedPattern {
        const blocks: ParsedPatternBlock[] = [];
        let firstBlock: ParsedPatternBlock | null = null;
        
        Object.entries(pattern.blocks).forEach(([posKey, blockId]) => {
            const [dx, dy, dz] = posKey.split(",").map(Number);
            const parsed: ParsedPatternBlock = { dx, dy, dz, blockId };
            blocks.push(parsed);
            
            // Use the block at 0,0,0 as the anchor (first block)
            if (dx === 0 && dy === 0 && dz === 0) {
                firstBlock = parsed;
            }
        });
        
        // If no block at origin, use the first block in the list
        if (!firstBlock && blocks.length > 0) {
            firstBlock = blocks[0];
        }
        
        return {
            blocks,
            firstBlock: firstBlock!,
            width: pattern.width,
            height: pattern.height,
            depth: pattern.depth,
        };
    }
    
    /**
     * Build an index of terrain positions by block type for fast candidate lookup.
     * Returns a Map from blockId -> Set of "x,y,z" positions.
     */
    buildTerrainIndex(terrainData: Record<string, number>): Map<number, string[]> {
        const index = new Map<number, string[]>();
        
        Object.entries(terrainData).forEach(([posKey, blockId]) => {
            if (!index.has(blockId)) {
                index.set(blockId, []);
            }
            index.get(blockId)!.push(posKey);
        });
        
        return index;
    }
    
    // Find all matches of the find pattern in the terrain (async with optimized algorithm)
    async findMatches() {
        // Cancel any existing search
        this.searchCancelled = true;
        
        // Wait a tick for previous search to stop
        await new Promise(resolve => setTimeout(resolve, 0));
        
        this.searchCancelled = false;
        
        if (!this.findPattern || Object.keys(this.findPattern.blocks).length === 0) {
            this.foundMatches = [];
            this.clearHighlights();
            this.isSearching = false;
            window.dispatchEvent(new CustomEvent("findreplace-matches-updated", {
                detail: { matches: 0, searching: false }
            }));
            return;
        }
        
        const terrainData = this.terrainRef?.current;
        if (!terrainData) {
            console.warn("[FindReplaceTool] No terrain data available");
            return;
        }
        
        this.isSearching = true;
        this.searchProgress = 0;
        
        window.dispatchEvent(new CustomEvent("findreplace-matches-updated", {
            detail: { matches: 0, searching: true, progress: 0 }
        }));
        
        const matches: FoundMatch[] = [];
        const rotationsToCheck = this.settings.matchRotations ? [0, 1, 2, 3] : [0];
        
        // Pre-compute rotated and optimized patterns
        const optimizedPatterns = rotationsToCheck.map(r => 
            this.createOptimizedPattern(this.rotatePattern(this.findPattern!, r))
        );
        
        // Build terrain index for fast block type lookup
        const terrainIndex = this.buildTerrainIndex(terrainData);
        
        // Get search bounds (if using selection scope)
        let searchBounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null = null;
        
        if (this.settings.scope === "selection" && this.settings.selectionBounds) {
            searchBounds = {
                minX: Math.floor(this.settings.selectionBounds.min.x),
                maxX: Math.ceil(this.settings.selectionBounds.max.x),
                minY: Math.floor(this.settings.selectionBounds.min.y),
                maxY: Math.ceil(this.settings.selectionBounds.max.y),
                minZ: Math.floor(this.settings.selectionBounds.min.z),
                maxZ: Math.ceil(this.settings.selectionBounds.max.z),
            };
        }
        
        // Track matched positions to avoid overlapping matches
        const matchedPositions = new Set<string>();
        
        // OPTIMIZATION: Instead of iterating every position in bounds,
        // only check positions where the pattern's anchor block actually exists.
        // This dramatically reduces iterations for sparse terrain.
        
        // Collect all candidate positions based on the first block of each rotated pattern
        const candidatePositions = new Set<string>();
        
        for (const optPattern of optimizedPatterns) {
            const anchorBlockId = optPattern.firstBlock.blockId;
            const anchorDx = optPattern.firstBlock.dx;
            const anchorDy = optPattern.firstBlock.dy;
            const anchorDz = optPattern.firstBlock.dz;
            
            const positionsWithBlock = terrainIndex.get(anchorBlockId) || [];
            
            for (const posKey of positionsWithBlock) {
                const [x, y, z] = posKey.split(",").map(Number);
                
                // Calculate the origin position if this block is the anchor
                const originX = x - anchorDx;
                const originY = y - anchorDy;
                const originZ = z - anchorDz;
                
                // Check if within bounds (if scope is selection)
                if (searchBounds) {
                    if (originX < searchBounds.minX || originX > searchBounds.maxX ||
                        originY < searchBounds.minY || originY > searchBounds.maxY ||
                        originZ < searchBounds.minZ || originZ > searchBounds.maxZ) {
                        continue;
                    }
                }
                
                candidatePositions.add(`${originX},${originY},${originZ}`);
            }
        }
        
        const candidates = Array.from(candidatePositions);
        const totalCandidates = candidates.length;
        
        // Process candidates in chunks
        const CHUNK_SIZE = 1000;
        let processedCount = 0;
        let lastProgressUpdate = 0;
        
        for (const candidateKey of candidates) {
            // Check if search was cancelled
            if (this.searchCancelled) {
                this.isSearching = false;
                return;
            }
            
            processedCount++;
            
            // Yield to main thread periodically
            if (processedCount % CHUNK_SIZE === 0) {
                const progress = Math.round((processedCount / totalCandidates) * 100);
                if (progress !== lastProgressUpdate) {
                    this.searchProgress = progress;
                    lastProgressUpdate = progress;
                    window.dispatchEvent(new CustomEvent("findreplace-matches-updated", {
                        detail: { matches: matches.length, searching: true, progress }
                    }));
                }
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            
            const [worldX, worldY, worldZ] = candidateKey.split(",").map(Number);
            
            // Skip if any position is already matched
            if (matchedPositions.has(candidateKey)) continue;
            
            // Try each rotation
            for (let rotationIdx = 0; rotationIdx < optimizedPatterns.length; rotationIdx++) {
                const optPattern = optimizedPatterns[rotationIdx];
                
                if (this.matchOptimizedPatternAtPosition(terrainData, optPattern, worldX, worldY, worldZ, matchedPositions)) {
                    matches.push({
                        position: new THREE.Vector3(worldX, worldY, worldZ),
                        rotation: rotationsToCheck[rotationIdx],
                    });
                    
                    // Mark positions as matched (using pre-parsed deltas)
                    for (const block of optPattern.blocks) {
                        matchedPositions.add(`${worldX + block.dx},${worldY + block.dy},${worldZ + block.dz}`);
                    }
                    
                    break; // Found a match at this rotation
                }
            }
        }
        
        this.foundMatches = matches;
        this.isSearching = false;
        this.searchProgress = 100;
        this.highlightMatches();
        
        window.dispatchEvent(new CustomEvent("findreplace-matches-updated", {
            detail: { matches: matches.length, searching: false, progress: 100 }
        }));
    }
    
    /**
     * Fast pattern matching using pre-parsed block coordinates.
     * Avoids string parsing in the hot loop for better performance.
     */
    matchOptimizedPatternAtPosition(
        terrainData: Record<string, number>,
        pattern: OptimizedPattern,
        worldX: number,
        worldY: number,
        worldZ: number,
        excludePositions: Set<string>
    ): boolean {
        for (const block of pattern.blocks) {
            const wx = worldX + block.dx;
            const wy = worldY + block.dy;
            const wz = worldZ + block.dz;
            const worldKey = `${wx},${wy},${wz}`;
            
            // Skip if this position is already part of another match
            if (excludePositions.has(worldKey)) {
                return false;
            }
            
            const actualBlockId = terrainData[worldKey];
            
            // Check if block matches (undefined means no block, must also be expected)
            if (actualBlockId !== block.blockId) {
                return false;
            }
        }
        
        return true;
    }
    
    // Legacy method for compatibility - delegates to optimized version
    matchPatternAtPosition(
        terrainData: Record<string, number>,
        pattern: PatternData,
        worldX: number,
        worldY: number,
        worldZ: number,
        excludePositions: Set<string>
    ): boolean {
        const optimized = this.createOptimizedPattern(pattern);
        return this.matchOptimizedPatternAtPosition(terrainData, optimized, worldX, worldY, worldZ, excludePositions);
    }
    
    // Highlight found matches in the scene
    highlightMatches() {
        this.clearHighlights();
        
        if (!this.findPattern || this.foundMatches.length === 0) return;
        
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
        });
        
        this.foundMatches.forEach((match, index) => {
            const rotatedPattern = this.rotatePattern(this.findPattern!, match.rotation);
            
            // Create a bounding box for the match
            const geometry = new THREE.BoxGeometry(
                rotatedPattern.width,
                rotatedPattern.height,
                rotatedPattern.depth
            );
            
            const mesh = new THREE.Mesh(geometry, material.clone());
            mesh.position.set(
                match.position.x + rotatedPattern.width / 2 - 0.5,
                match.position.y + rotatedPattern.height / 2 - 0.5,
                match.position.z + rotatedPattern.depth / 2 - 0.5
            );
            mesh.renderOrder = 999;
            
            if (this.scene) {
                this.scene.add(mesh);
                this.highlightMeshes.push(mesh);
            }
        });
    }
    
    // Execute the find and replace operation - enters adjustment mode after
    async executeReplace() {
        if (!this.findPattern || this.replacePatterns.length === 0 || this.foundMatches.length === 0) {
            console.warn("[FindReplaceTool] Cannot execute replace: missing pattern or no matches");
            return { success: false, replaced: 0 };
        }
        
        const terrainData = this.terrainRef?.current;
        if (!terrainData) {
            console.warn("[FindReplaceTool] No terrain data available");
            return { success: false, replaced: 0 };
        }
        
        // Store pre-swap terrain state for potential cancel
        this.preSwapTerrainState = { ...terrainData };
        
        const addedBlocks: Record<string, number> = {};
        const removedBlocks: Record<string, number> = {};
        const addedRotations: Record<string, number> = {};
        const addedShapes: Record<string, string> = {};
        const removedRotations: Record<string, number> = {};
        const removedShapes: Record<string, string> = {};
        const addedBlockKeys: string[] = [];

        // Get rotation and shape refs to track what's being removed
        const rotationsRef = (this.terrainBuilderRef as any)?.current?.getCurrentRotationData?.() ||
            (this.terrainBuilderProps as any)?.rotationsRef?.current || {};
        const shapesRef = (this.terrainBuilderRef as any)?.current?.getCurrentShapeData?.() ||
            (this.terrainBuilderProps as any)?.shapesRef?.current || {};
        
        // Store matches for adjustment
        const matchesWithPatterns: Array<{
            match: FoundMatch;
            rotatedReplacePattern: PatternData;
        }> = [];
        
        let replacedCount = 0;
        
        // Reset offset to 0 for initial replacement
        this.settings.replacementOffset = { x: 0, y: 0, z: 0 };
        this.lastAppliedOffset = { x: 0, y: 0, z: 0 };
        
        for (const match of this.foundMatches) {
            // Choose replacement pattern (use first for consistency in adjustment mode)
            const replacePattern = this.replacePatterns.length === 1
                ? this.replacePatterns[0]
                : this.replacePatterns[Math.floor(Math.random() * this.replacePatterns.length)];
            
            // Determine rotation for replacement
            let replacementRotation = 0;
            if (this.settings.randomReplacementRotation) {
                replacementRotation = Math.floor(Math.random() * 4);
            } else {
                replacementRotation = match.rotation;
            }
            
            const rotatedFindPattern = this.rotatePattern(this.findPattern, match.rotation);
            const rotatedReplacePattern = this.rotatePattern(replacePattern, replacementRotation);
            
            // Calculate center offset to align replacement center with find pattern center
            // This ensures the replacement is centered on where the original was
            const findCenterX = (rotatedFindPattern.width - 1) / 2;
            const findCenterY = (rotatedFindPattern.height - 1) / 2;
            const findCenterZ = (rotatedFindPattern.depth - 1) / 2;
            
            const replaceCenterX = (rotatedReplacePattern.width - 1) / 2;
            const replaceCenterY = (rotatedReplacePattern.height - 1) / 2;
            const replaceCenterZ = (rotatedReplacePattern.depth - 1) / 2;
            
            // Offset to center: shift replacement so its center aligns with find's center
            const centerOffsetX = Math.round(findCenterX - replaceCenterX);
            const centerOffsetY = Math.round(findCenterY - replaceCenterY);
            const centerOffsetZ = Math.round(findCenterZ - replaceCenterZ);
            
            // Store for adjustment
            matchesWithPatterns.push({ match, rotatedReplacePattern });
            
            // Remove old blocks (from find pattern)
            Object.keys(rotatedFindPattern.blocks).forEach(posKey => {
                const [px, py, pz] = posKey.split(",").map(Number);
                const worldKey = `${match.position.x + px},${match.position.y + py},${match.position.z + pz}`;

                if (terrainData[worldKey] !== undefined) {
                    removedBlocks[worldKey] = terrainData[worldKey];
                    // Track rotation and shape being removed
                    if (rotationsRef[worldKey]) {
                        removedRotations[worldKey] = rotationsRef[worldKey];
                    }
                    if (shapesRef[worldKey]) {
                        removedShapes[worldKey] = shapesRef[worldKey];
                    }
                    delete terrainData[worldKey];
                }
            });

            // Add new blocks (from replace pattern) centered on the original position
            Object.entries(rotatedReplacePattern.blocks).forEach(([posKey, blockId]) => {
                const [px, py, pz] = posKey.split(",").map(Number);
                const worldKey = `${match.position.x + px + centerOffsetX},${match.position.y + py + centerOffsetY},${match.position.z + pz + centerOffsetZ}`;

                addedBlocks[worldKey] = blockId;
                addedBlockKeys.push(worldKey);
                terrainData[worldKey] = blockId;
                // Apply rotation and shape from replace pattern
                if (rotatedReplacePattern.rotations && rotatedReplacePattern.rotations[posKey]) {
                    addedRotations[worldKey] = rotatedReplacePattern.rotations[posKey];
                }
                if (rotatedReplacePattern.shapes && rotatedReplacePattern.shapes[posKey]) {
                    addedShapes[worldKey] = rotatedReplacePattern.shapes[posKey];
                }
            });
            
            replacedCount++;
        }
        
        // Store replacement data for adjustment
        this.replacementData = {
            matches: this.foundMatches.map((m, i) => ({
                ...m,
                // Store the rotated pattern with the match
                _rotatedPattern: matchesWithPatterns[i].rotatedReplacePattern
            })) as any,
            replacePattern: this.replacePatterns[0], // Primary pattern
            addedBlockKeys,
            removedBlocks: { ...removedBlocks },
        };
        
        // Update terrain rendering
        if (this.terrainBuilderRef?.current?.updateTerrainBlocks) {
            this.terrainBuilderRef.current.updateTerrainBlocks(addedBlocks, removedBlocks, {
                skipUndoSave: true,
                rotationData: { added: addedRotations, removed: removedRotations },
                shapeData: { added: addedShapes, removed: removedShapes },
            });
        }
        
        // Enter adjustment mode - DON'T clear highlights, DON'T save undo yet
        this.isAdjustingMode = true;
        
        // Update highlight color to indicate adjustment mode
        this.updateHighlightsForAdjustmentMode();
        
        window.dispatchEvent(new CustomEvent("findreplace-adjustment-mode", {
            detail: { 
                active: true, 
                replaced: replacedCount,
                offset: this.settings.replacementOffset
            }
        }));
        
        return { success: true, replaced: replacedCount, adjustmentMode: true };
    }
    
    // Update highlight appearance for adjustment mode
    updateHighlightsForAdjustmentMode() {
        this.highlightMeshes.forEach(mesh => {
            if (mesh.material) {
                const mat = mesh.material as THREE.MeshBasicMaterial;
                mat.color.setHex(0x00aaff); // Blue for adjustment mode
                mat.opacity = 0.4;
            }
        });
    }
    
    // Apply offset adjustment in real-time
    applyOffsetAdjustment(newOffset: { x: number; y: number; z: number }) {
        if (!this.isAdjustingMode || !this.replacementData) {
            console.warn("[FindReplaceTool] Not in adjustment mode");
            return;
        }
        
        const terrainData = this.terrainRef?.current;
        if (!terrainData) return;
        
        const oldOffset = this.lastAppliedOffset;
        const deltaX = newOffset.x - oldOffset.x;
        const deltaY = newOffset.y - oldOffset.y;
        const deltaZ = newOffset.z - oldOffset.z;
        
        // No change needed
        if (deltaX === 0 && deltaY === 0 && deltaZ === 0) return;
        
        const blocksToRemove: Record<string, number> = {};
        const blocksToAdd: Record<string, number> = {};
        const newAddedBlockKeys: string[] = [];
        
        // Move each added block by the delta
        for (const oldKey of this.replacementData.addedBlockKeys) {
            const [x, y, z] = oldKey.split(",").map(Number);
            const newKey = `${x + deltaX},${y + deltaY},${z + deltaZ}`;
            
            // Remove from old position
            if (terrainData[oldKey] !== undefined) {
                blocksToRemove[oldKey] = terrainData[oldKey];
                delete terrainData[oldKey];
            }
            
            // Add to new position
            const blockId = this.preSwapTerrainState[oldKey] !== undefined 
                ? blocksToRemove[oldKey] 
                : blocksToRemove[oldKey];
            
            // Get the block ID from what was there
            const originalBlockId = blocksToRemove[oldKey];
            if (originalBlockId !== undefined) {
                blocksToAdd[newKey] = originalBlockId;
                terrainData[newKey] = originalBlockId;
            }
            
            newAddedBlockKeys.push(newKey);
        }
        
        // Update stored keys
        this.replacementData.addedBlockKeys = newAddedBlockKeys;
        this.lastAppliedOffset = { ...newOffset };
        this.settings.replacementOffset = { ...newOffset };
        
        // Update terrain rendering
        if (this.terrainBuilderRef?.current?.updateTerrainBlocks) {
            this.terrainBuilderRef.current.updateTerrainBlocks(blocksToAdd, blocksToRemove, {
                skipUndoSave: true,
            });
        }
        
        // Update highlight positions
        this.updateHighlightPositions(deltaX, deltaY, deltaZ);
        
        window.dispatchEvent(new CustomEvent("findreplace-offset-updated", {
            detail: { offset: newOffset }
        }));
    }
    
    // Update highlight mesh positions
    updateHighlightPositions(deltaX: number, deltaY: number, deltaZ: number) {
        this.highlightMeshes.forEach(mesh => {
            mesh.position.x += deltaX;
            mesh.position.y += deltaY;
            mesh.position.z += deltaZ;
        });
    }
    
    // Confirm the adjustment - finalize changes
    confirmAdjustment() {
        if (!this.isAdjustingMode || !this.replacementData) {
            return;
        }
        
        const terrainData = this.terrainRef?.current;
        if (!terrainData) return;
        
        // Calculate final added and removed blocks relative to pre-swap state
        const finalAdded: Record<string, number> = {};
        const finalRemoved: Record<string, number> = {};
        
        // What was removed (original blocks that no longer exist)
        Object.entries(this.replacementData.removedBlocks).forEach(([key, blockId]) => {
            if (terrainData[key] === undefined || terrainData[key] !== blockId) {
                finalRemoved[key] = blockId;
            }
        });
        
        // What was added (new blocks that weren't in pre-swap state)
        this.replacementData.addedBlockKeys.forEach(key => {
            if (terrainData[key] !== undefined) {
                const preSwapValue = this.preSwapTerrainState[key];
                if (preSwapValue === undefined || preSwapValue !== terrainData[key]) {
                    finalAdded[key] = terrainData[key];
                }
            }
        });
        
        // Update pending changes for auto-save
        if (this.pendingChangesRef?.current) {
            Object.entries(finalAdded).forEach(([posKey, blockId]) => {
                this.pendingChangesRef.current.terrain.added[posKey] = blockId;
            });
            Object.entries(finalRemoved).forEach(([posKey, blockId]) => {
                if (!this.pendingChangesRef.current.terrain.removed[posKey]) {
                    this.pendingChangesRef.current.terrain.removed[posKey] = blockId;
                }
            });
        }
        
        // Save undo snapshot NOW
        if (this.undoRedoManager?.current?.saveUndo) {
            // Get rotation and shape refs
            const rotationsRef = (this.terrainBuilderRef as any)?.current?.getCurrentRotationData?.() ||
                (this.terrainBuilderProps as any)?.rotationsRef?.current || {};
            const shapesRef = (this.terrainBuilderRef as any)?.current?.getCurrentShapeData?.() ||
                (this.terrainBuilderProps as any)?.shapesRef?.current || {};

            // Collect rotations and shapes for added blocks
            const addedRotations: Record<string, number> = {};
            const addedShapes: Record<string, string> = {};
            Object.keys(finalAdded).forEach(key => {
                if (rotationsRef[key]) {
                    addedRotations[key] = rotationsRef[key];
                }
                if (shapesRef[key]) {
                    addedShapes[key] = shapesRef[key];
                }
            });

            const snapshot = {
                terrain: {
                    added: { ...finalAdded },
                    removed: { ...finalRemoved },
                },
                environment: { added: [], removed: [] },
                rotations: {
                    added: addedRotations,
                    removed: {},
                },
                shapes: {
                    added: addedShapes,
                    removed: {},
                },
            };
            this.undoRedoManager.current.saveUndo(snapshot);
        }
        
        // Exit adjustment mode
        this.isAdjustingMode = false;
        this.preSwapTerrainState = {};
        this.replacementData = null;
        this.foundMatches = [];
        this.clearHighlights();
        
        // Reset offset for next operation
        this.settings.replacementOffset = { x: 0, y: 0, z: 0 };
        this.lastAppliedOffset = { x: 0, y: 0, z: 0 };
        
        window.dispatchEvent(new CustomEvent("findreplace-adjustment-mode", {
            detail: { active: false, confirmed: true }
        }));
        
        window.dispatchEvent(new CustomEvent("findreplace-executed", {
            detail: { replaced: this.foundMatches.length, confirmed: true }
        }));
    }
    
    // Cancel the adjustment - revert to pre-swap state
    cancelAdjustment() {
        if (!this.isAdjustingMode) {
            return;
        }
        
        const terrainData = this.terrainRef?.current;
        if (!terrainData) return;
        
        // Calculate what to remove (current added blocks) and what to restore
        const blocksToRemove: Record<string, number> = {};
        const blocksToAdd: Record<string, number> = {};
        
        // Remove all added blocks
        if (this.replacementData) {
            this.replacementData.addedBlockKeys.forEach(key => {
                if (terrainData[key] !== undefined) {
                    blocksToRemove[key] = terrainData[key];
                    delete terrainData[key];
                }
            });
            
            // Restore removed blocks
            Object.entries(this.replacementData.removedBlocks).forEach(([key, blockId]) => {
                blocksToAdd[key] = blockId;
                terrainData[key] = blockId;
            });
        }
        
        // Update terrain rendering
        if (this.terrainBuilderRef?.current?.updateTerrainBlocks) {
            this.terrainBuilderRef.current.updateTerrainBlocks(blocksToAdd, blocksToRemove, {
                skipUndoSave: true,
            });
        }
        
        // Exit adjustment mode without saving undo
        this.isAdjustingMode = false;
        this.preSwapTerrainState = {};
        this.replacementData = null;
        this.foundMatches = [];
        this.clearHighlights();
        
        // Reset offset
        this.settings.replacementOffset = { x: 0, y: 0, z: 0 };
        this.lastAppliedOffset = { x: 0, y: 0, z: 0 };
        
        window.dispatchEvent(new CustomEvent("findreplace-adjustment-mode", {
            detail: { active: false, cancelled: true }
        }));
        
        window.dispatchEvent(new CustomEvent("findreplace-offset-updated", {
            detail: { offset: { x: 0, y: 0, z: 0 } }
        }));
    }
    
    handleMouseDown(event: any, position: THREE.Vector3, button: number) {
        console.log("[FindReplaceTool] handleMouseDown called", {
            button,
            currentSelectionMode: this.currentSelectionMode,
            isAdjustingMode: this.isAdjustingMode,
            hasPreviewPosition: !!this.previewPositionRef?.current
        });
        
        // Prevent interactions during adjustment mode
        if (this.isAdjustingMode) {
            console.log("[FindReplaceTool] Ignoring click - in adjustment mode");
            return;
        }
        
        // Only process left clicks when in selection mode
        if (button !== 0) {
            console.log("[FindReplaceTool] Ignoring click - not left button");
            return;
        }
        
        if (!this.currentSelectionMode) {
            console.log("[FindReplaceTool] Ignoring click - no selection mode active");
            return;
        }
        
        if (!this.previewPositionRef?.current) {
            console.log("[FindReplaceTool] Ignoring click - no preview position");
            return;
        }
        
        const currentPosition = this.previewPositionRef.current;
        console.log("[FindReplaceTool] Processing click at", currentPosition);
        
        if (this.currentSelectionMode === "scope") {
            if (!this.scopeStartPosition) {
                this.scopeStartPosition = currentPosition.clone();
                this.updateScopePreview(this.scopeStartPosition, currentPosition);
                console.log("[FindReplaceTool] Started scope selection");
            } else {
                // Complete scope selection
                this.completeScopeSelection(currentPosition);
                console.log("[FindReplaceTool] Completed scope selection");
            }
        } else {
            // Find or replace pattern selection
            if (!this.selectionStartPosition) {
                this.selectionStartPosition = currentPosition.clone();
                this.updateSelectionPreview(this.selectionStartPosition, currentPosition);
                console.log("[FindReplaceTool] Started pattern selection");
            } else {
                // Complete selection
                this.completePatternSelection(currentPosition);
                console.log("[FindReplaceTool] Completed pattern selection");
            }
        }
    }
    
    handleMouseMove(event: any, position: THREE.Vector3) {
        if (this.isAdjustingMode) return;
        if (!this.previewPositionRef?.current) return;
        
        const currentPosition = this.previewPositionRef.current;
        
        if (this.currentSelectionMode === "scope" && this.scopeStartPosition) {
            this.updateScopePreview(this.scopeStartPosition, currentPosition);
        } else if (this.selectionStartPosition) {
            this.updateSelectionPreview(this.selectionStartPosition, currentPosition);
        }
    }
    
    handleKeyDown(event: KeyboardEvent) {
        // Handle adjustment mode keyboard shortcuts
        if (this.isAdjustingMode) {
            if (event.key === "Enter") {
                event.preventDefault();
                this.confirmAdjustment();
                return;
            } else if (event.key === "Escape") {
                event.preventDefault();
                this.cancelAdjustment();
                return;
            }
            // Don't process other keys during adjustment mode
            return;
        }
        
        if (event.key === "Escape") {
            this.selectionStartPosition = null;
            this.scopeStartPosition = null;
            this.currentSelectionMode = null;
            this.clearAllPreviews();
            this.tooltip = "Find & Replace Tool – Define a structure to find and replace with another structure";
            window.dispatchEvent(new CustomEvent("findreplace-mode-changed", { 
                detail: { mode: null } 
            }));
        } else if (event.key === "1") {
            this.selectionHeight = Math.max(1, this.selectionHeight - 1);
            if (this.selectionStartPosition && this.previewPositionRef?.current) {
                this.updateSelectionPreview(this.selectionStartPosition, this.previewPositionRef.current);
            }
            if (this.scopeStartPosition && this.previewPositionRef?.current) {
                this.updateScopePreview(this.scopeStartPosition, this.previewPositionRef.current);
            }
        } else if (event.key === "2") {
            this.selectionHeight += 1;
            if (this.selectionStartPosition && this.previewPositionRef?.current) {
                this.updateSelectionPreview(this.selectionStartPosition, this.previewPositionRef.current);
            }
            if (this.scopeStartPosition && this.previewPositionRef?.current) {
                this.updateScopePreview(this.scopeStartPosition, this.previewPositionRef.current);
            }
        }
    }
    
    updateSelectionPreview(startPos: THREE.Vector3, endPos: THREE.Vector3) {
        if (this.selectionPreview && this.scene) {
            this.scene.remove(this.selectionPreview);
            this.selectionPreview.traverse((child) => {
                if ((child as any).geometry) (child as any).geometry.dispose();
                if ((child as any).material) {
                    if (Array.isArray((child as any).material)) {
                        (child as any).material.forEach((m: any) => m.dispose());
                    } else {
                        (child as any).material.dispose();
                    }
                }
            });
        }
        
        this.selectionPreview = new THREE.Group();
        
        const minX = Math.min(Math.round(startPos.x), Math.round(endPos.x));
        const maxX = Math.max(Math.round(startPos.x), Math.round(endPos.x));
        const minZ = Math.min(Math.round(startPos.z), Math.round(endPos.z));
        const maxZ = Math.max(Math.round(startPos.z), Math.round(endPos.z));
        const baseY = Math.round(startPos.y);
        
        const width = maxX - minX + 1;
        const depth = maxZ - minZ + 1;
        const height = this.selectionHeight;
        
        const color = this.currentSelectionMode === "find" ? 0xffff00 : 0x00ffff;
        
        const geometry = new THREE.BoxGeometry(width, height, depth);
        const material = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(
            minX + width / 2 - 0.5,
            baseY + height / 2 - 0.5,
            minZ + depth / 2 - 0.5
        );
        mesh.renderOrder = 998;
        
        // Add wireframe
        const wireframeGeom = new THREE.BoxGeometry(width, height, depth);
        const wireframeMat = new THREE.MeshBasicMaterial({
            color,
            wireframe: true,
            transparent: true,
            opacity: 0.8,
        });
        const wireframe = new THREE.Mesh(wireframeGeom, wireframeMat);
        wireframe.position.copy(mesh.position);
        wireframe.renderOrder = 999;
        
        this.selectionPreview.add(mesh);
        this.selectionPreview.add(wireframe);
        
        if (this.scene) {
            this.scene.add(this.selectionPreview);
        }
    }
    
    updateScopePreview(startPos: THREE.Vector3, endPos: THREE.Vector3) {
        if (this.scopePreview && this.scene) {
            this.scene.remove(this.scopePreview);
            this.scopePreview.traverse((child) => {
                if ((child as any).geometry) (child as any).geometry.dispose();
                if ((child as any).material) {
                    if (Array.isArray((child as any).material)) {
                        (child as any).material.forEach((m: any) => m.dispose());
                    } else {
                        (child as any).material.dispose();
                    }
                }
            });
        }
        
        this.scopePreview = new THREE.Group();
        
        const minX = Math.min(Math.round(startPos.x), Math.round(endPos.x));
        const maxX = Math.max(Math.round(startPos.x), Math.round(endPos.x));
        const minZ = Math.min(Math.round(startPos.z), Math.round(endPos.z));
        const maxZ = Math.max(Math.round(startPos.z), Math.round(endPos.z));
        const baseY = Math.round(startPos.y);
        
        const width = maxX - minX + 1;
        const depth = maxZ - minZ + 1;
        const height = this.selectionHeight;
        
        const geometry = new THREE.BoxGeometry(width, height, depth);
        const material = new THREE.MeshBasicMaterial({
            color: 0xff8800,
            transparent: true,
            opacity: 0.15,
            depthWrite: false,
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(
            minX + width / 2 - 0.5,
            baseY + height / 2 - 0.5,
            minZ + depth / 2 - 0.5
        );
        mesh.renderOrder = 997;
        
        // Add wireframe
        const wireframeGeom = new THREE.BoxGeometry(width, height, depth);
        const wireframeMat = new THREE.MeshBasicMaterial({
            color: 0xff8800,
            wireframe: true,
            transparent: true,
            opacity: 0.6,
        });
        const wireframe = new THREE.Mesh(wireframeGeom, wireframeMat);
        wireframe.position.copy(mesh.position);
        wireframe.renderOrder = 998;
        
        this.scopePreview.add(mesh);
        this.scopePreview.add(wireframe);
        
        if (this.scene) {
            this.scene.add(this.scopePreview);
        }
    }
    
    completePatternSelection(endPos: THREE.Vector3) {
        if (!this.selectionStartPosition || !this.terrainRef?.current) return;
        
        const startPos = this.selectionStartPosition;
        
        const minX = Math.min(Math.round(startPos.x), Math.round(endPos.x));
        const maxX = Math.max(Math.round(startPos.x), Math.round(endPos.x));
        const minZ = Math.min(Math.round(startPos.z), Math.round(endPos.z));
        const maxZ = Math.max(Math.round(startPos.z), Math.round(endPos.z));
        const baseY = Math.round(startPos.y);
        
        // Collect blocks in selection
        const blocks: Record<string, number> = {};
        const rotations: Record<string, number> = {};
        const shapes: Record<string, string> = {};
        const terrainData = this.terrainRef.current;

        // Get rotation and shape refs from TerrainBuilder
        const rotationsRef = (this.terrainBuilderRef as any)?.current?.getCurrentRotationData?.() ||
            (this.terrainBuilderProps as any)?.rotationsRef?.current || {};
        const shapesRef = (this.terrainBuilderRef as any)?.current?.getCurrentShapeData?.() ||
            (this.terrainBuilderProps as any)?.shapesRef?.current || {};

        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                for (let y = 0; y < this.selectionHeight; y++) {
                    const posKey = `${x},${baseY + y},${z}`;
                    if (terrainData[posKey] !== undefined) {
                        blocks[posKey] = terrainData[posKey];
                        // Capture rotation and shape
                        if (rotationsRef[posKey]) {
                            rotations[posKey] = rotationsRef[posKey];
                        }
                        if (shapesRef[posKey]) {
                            shapes[posKey] = shapesRef[posKey];
                        }
                    }
                }
            }
        }

        if (Object.keys(blocks).length === 0) {
            console.warn("[FindReplaceTool] No blocks found in selection");
            this.selectionStartPosition = null;
            this.clearAllPreviews();
            return;
        }

        const pattern = this.normalizePattern(blocks, "Selection", rotations, shapes);
        
        if (this.currentSelectionMode === "find") {
            this.findPattern = pattern;
            window.dispatchEvent(new CustomEvent("findreplace-pattern-updated", {
                detail: { type: "find", pattern: this.findPattern }
            }));
            // Auto-find matches
            this.findMatches();
        } else if (this.currentSelectionMode === "replace") {
            this.replacePatterns = [pattern];
            window.dispatchEvent(new CustomEvent("findreplace-pattern-updated", {
                detail: { type: "replace", patterns: this.replacePatterns }
            }));
        }
        
        // Reset selection state
        this.selectionStartPosition = null;
        this.currentSelectionMode = null;
        this.clearAllPreviews();
        this.highlightMatches(); // Re-show highlights
        
        this.tooltip = "Find & Replace Tool – Define a structure to find and replace with another structure";
        window.dispatchEvent(new CustomEvent("findreplace-mode-changed", { 
            detail: { mode: null } 
        }));
    }
    
    completeScopeSelection(endPos: THREE.Vector3) {
        if (!this.scopeStartPosition) return;
        
        const startPos = this.scopeStartPosition;
        
        const minX = Math.min(Math.round(startPos.x), Math.round(endPos.x));
        const maxX = Math.max(Math.round(startPos.x), Math.round(endPos.x));
        const minZ = Math.min(Math.round(startPos.z), Math.round(endPos.z));
        const maxZ = Math.max(Math.round(startPos.z), Math.round(endPos.z));
        const baseY = Math.round(startPos.y);
        
        this.settings.scope = "selection";
        this.settings.selectionBounds = {
            min: new THREE.Vector3(minX, baseY, minZ),
            max: new THREE.Vector3(maxX, baseY + this.selectionHeight - 1, maxZ),
        };
        
        // Reset scope selection state
        this.scopeStartPosition = null;
        this.currentSelectionMode = null;
        
        window.dispatchEvent(new CustomEvent("findreplace-scope-updated", {
            detail: { scope: "selection", bounds: this.settings.selectionBounds }
        }));
        
        // Re-find matches with new scope
        this.findMatches();
        
        this.tooltip = "Find & Replace Tool – Define a structure to find and replace with another structure";
        window.dispatchEvent(new CustomEvent("findreplace-mode-changed", { 
            detail: { mode: null } 
        }));
    }
    
    updateSettings(newSettings: Partial<typeof this.settings>) {
        // Handle nested replacementOffset update
        if (newSettings.replacementOffset) {
            this.settings.replacementOffset = {
                ...this.settings.replacementOffset,
                ...newSettings.replacementOffset,
            };
            // Dispatch event for UI update
            window.dispatchEvent(new CustomEvent("findreplace-offset-updated", {
                detail: { offset: this.settings.replacementOffset }
            }));
        }
        
        // Update other settings
        const { replacementOffset, ...otherSettings } = newSettings;
        this.settings = { ...this.settings, ...otherSettings };
        
        if (newSettings.scope === "entire_map") {
            this.settings.selectionBounds = null;
            // Clear scope preview
            if (this.scopePreview && this.scene) {
                this.scene.remove(this.scopePreview);
                this.scopePreview = null;
            }
        }
        
        // Re-find matches if scope or rotation matching changed
        if (newSettings.scope !== undefined || newSettings.matchRotations !== undefined) {
            this.findMatches();
        }
    }
    
    // Helper to set individual offset axis
    setReplacementOffset(axis: "x" | "y" | "z", value: number) {
        const newOffset = { ...this.settings.replacementOffset, [axis]: value };
        
        if (this.isAdjustingMode) {
            // Apply in real-time during adjustment mode
            this.applyOffsetAdjustment(newOffset);
        } else {
            this.settings.replacementOffset = newOffset;
            window.dispatchEvent(new CustomEvent("findreplace-offset-updated", {
                detail: { offset: newOffset }
            }));
        }
    }
    
    // Helper to reset offset to zero
    resetReplacementOffset() {
        const newOffset = { x: 0, y: 0, z: 0 };
        
        if (this.isAdjustingMode) {
            this.applyOffsetAdjustment(newOffset);
        } else {
            this.settings.replacementOffset = newOffset;
            window.dispatchEvent(new CustomEvent("findreplace-offset-updated", {
                detail: { offset: newOffset }
            }));
        }
    }
    
    dispose() {
        this.clearAllPreviews();
        this.resetState();
        super.dispose();
    }
}

