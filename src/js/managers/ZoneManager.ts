/**
 * ZoneManager.ts - Manages zones/boundaries in the world editor
 * 
 * Handles zone CRUD operations, persistence to IndexedDB, and 3D visualization
 */

import * as THREE from "three";
import { DatabaseManager, STORES } from "./DatabaseManager";
import { Zone, ZonePosition, ZoneDimensions, ZONE_LABEL_PRESETS } from "../types/DatabaseTypes";

// Generate a unique ID for zones
const generateZoneId = (): string => {
    return `zone_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

// Get color for a zone label
export const getZoneLabelColor = (label: string): string => {
    const preset = ZONE_LABEL_PRESETS.find(p => p.value === label);
    return preset?.color || "#9ca3af"; // Default to gray
};

class ZoneManager {
    private zones: Map<string, Zone> = new Map();
    private zoneVisuals: Map<string, THREE.Group> = new Map();
    private scene: THREE.Scene | null = null;
    private visible: boolean = true;
    private labelSprites: Map<string, THREE.Sprite> = new Map();
    
    // Event listeners
    private changeListeners: Set<() => void> = new Set();
    
    constructor() {
        // Initialize
    }
    
    /**
     * Initialize the zone manager with a scene reference
     */
    initialize(scene: THREE.Scene) {
        const projectId = DatabaseManager.getCurrentProjectId();
        console.log(`[ZoneManager] initialize called, projectId: ${projectId}, hasExistingScene: ${!!this.scene}, sameScene: ${this.scene === scene}`);
        
        // If scene changed (project switch), clear all old visuals first
        if (this.scene && this.scene !== scene) {
            console.log("[ZoneManager] Scene changed, clearing old visuals");
            // Clear visuals from old scene (they're orphaned now anyway)
            this.zoneVisuals.forEach((visual) => {
                // Dispose geometries and materials
                visual.traverse((child) => {
                    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Line) {
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
            });
            this.zoneVisuals.clear();
            this.labelSprites.clear();
            this.zones.clear();
        } else if (!this.scene) {
            // First initialization - also clear any stale data
            console.log("[ZoneManager] First initialization, clearing any stale data");
            this.zoneVisuals.clear();
            this.labelSprites.clear();
            this.zones.clear();
        }
        
        this.scene = scene;
        this.visible = true; // Reset visibility to true on project load
        this.loadFromDatabase();
    }
    
    /**
     * Add a change listener
     */
    addChangeListener(callback: () => void) {
        this.changeListeners.add(callback);
    }
    
    /**
     * Remove a change listener
     */
    removeChangeListener(callback: () => void) {
        this.changeListeners.delete(callback);
    }
    
    /**
     * Notify all change listeners
     */
    private notifyChange() {
        this.changeListeners.forEach(callback => {
            try {
                callback();
            } catch (e) {
                console.error("[ZoneManager] Error in change listener:", e);
            }
        });
        // Also dispatch a global event
        window.dispatchEvent(new CustomEvent("zones-changed"));
    }
    
    /**
     * Load zones from database
     */
    async loadFromDatabase() {
        try {
            const projectId = DatabaseManager.getCurrentProjectId();
            console.log(`[ZoneManager] loadFromDatabase called, projectId: ${projectId}`);
            
            if (!projectId) {
                console.log("[ZoneManager] No active project, skipping zone load");
                return;
            }
            
            const key = `project:${projectId}:zones`;
            console.log(`[ZoneManager] Loading zones with key: ${key}`);
            
            // Check if ZONES store exists before loading
            const db = await DatabaseManager.getConnection();
            const storeExists = db.objectStoreNames.contains(STORES.ZONES);
            console.log(`[ZoneManager] ZONES store exists: ${storeExists}`);
            
            if (!storeExists) {
                console.error(`[ZoneManager] ERROR: ZONES store does not exist in database!`);
                console.error(`[ZoneManager] Available stores:`, Array.from(db.objectStoreNames));
                console.error(`[ZoneManager] This indicates a roll-forward migration issue. The store should have been created.`);
            }
            
            const storedZones = await DatabaseManager.getData(STORES.ZONES, key) as Zone[] | undefined;
            console.log(`[ZoneManager] Got data from DB:`, storedZones ? `${storedZones.length} zones` : 'undefined/null');
            if (storedZones && Array.isArray(storedZones) && storedZones.length > 0) {
                console.log(`[ZoneManager] Zone data loaded:`, storedZones);
            }
            
            // Always clear existing zones when loading (even if no zones found for this project)
            this.zones.clear();
            
            if (storedZones && Array.isArray(storedZones)) {
                storedZones.forEach(zone => {
                    this.zones.set(zone.id, zone);
                });
                console.log(`[ZoneManager] Loaded ${storedZones.length} zones from database`);
            } else {
                console.log(`[ZoneManager] No zones found for project ${projectId}`);
            }
            
            // Always rebuild visuals (creates visuals for loaded zones, clears if none)
            console.log(`[ZoneManager] Rebuilding visuals, scene exists: ${!!this.scene}, zones count: ${this.zones.size}`);
            this.rebuildAllVisuals();
            this.notifyChange();
        } catch (error) {
            console.error("[ZoneManager] Error loading zones:", error);
            console.error("[ZoneManager] Error details:", error);
        }
    }
    
    /**
     * Save zones to database
     */
    async saveToDatabase() {
        try {
            const projectId = DatabaseManager.getCurrentProjectId();
            console.log(`[ZoneManager] saveToDatabase called, projectId: ${projectId}`);
            
            if (!projectId) {
                console.warn("[ZoneManager] No active project, cannot save zones");
                return;
            }
            
            const key = `project:${projectId}:zones`;
            const zonesArray = Array.from(this.zones.values());
            console.log(`[ZoneManager] Saving ${zonesArray.length} zones with key: ${key}`);
            console.log(`[ZoneManager] Zone data:`, zonesArray);
            
            // Check if ZONES store exists before saving
            const db = await DatabaseManager.getConnection();
            const storeExists = db.objectStoreNames.contains(STORES.ZONES);
            console.log(`[ZoneManager] ZONES store exists: ${storeExists}`);
            
            if (!storeExists) {
                console.error(`[ZoneManager] ERROR: ZONES store does not exist in database!`);
                console.error(`[ZoneManager] Available stores:`, Array.from(db.objectStoreNames));
            }
            
            await DatabaseManager.saveData(STORES.ZONES, key, zonesArray);
            console.log(`[ZoneManager] Successfully saved ${zonesArray.length} zones to database`);
        } catch (error) {
            console.error("[ZoneManager] Error saving zones:", error);
            console.error("[ZoneManager] Error details:", error);
        }
    }
    
    /**
     * Create a new zone
     */
    createZone(
        label: string,
        type: "point" | "box",
        position: ZonePosition,
        dimensions?: ZoneDimensions,
        color?: string,
        metadata?: Record<string, any>,
        name?: string
    ): Zone {
        const zone: Zone = {
            id: generateZoneId(),
            name: name || undefined,
            label,
            type,
            position: { ...position },
            dimensions: dimensions ? { ...dimensions } : undefined,
            color: color || getZoneLabelColor(label),
            metadata: metadata || {},
        };
        
        // Calculate from/to for box zones
        if (type === "box" && dimensions) {
            zone.from = { ...position };
            zone.to = {
                x: position.x + dimensions.width - 1,
                y: position.y + dimensions.height - 1,
                z: position.z + dimensions.depth - 1,
            };
        }
        
        this.zones.set(zone.id, zone);
        this.createZoneVisual(zone);
        this.saveToDatabase();
        this.notifyChange();
        
        console.log(`[ZoneManager] Created zone: ${zone.id} (${label})`);
        return zone;
    }
    
    /**
     * Update an existing zone
     */
    updateZone(zoneId: string, updates: Partial<Omit<Zone, "id">>): Zone | null {
        const zone = this.zones.get(zoneId);
        if (!zone) {
            console.warn(`[ZoneManager] Zone not found: ${zoneId}`);
            return null;
        }
        
        // Apply updates
        if (updates.name !== undefined) zone.name = updates.name || undefined;
        if (updates.label !== undefined) zone.label = updates.label;
        if (updates.position !== undefined) zone.position = { ...updates.position };
        if (updates.dimensions !== undefined) zone.dimensions = { ...updates.dimensions };
        if (updates.color !== undefined) zone.color = updates.color;
        if (updates.metadata !== undefined) zone.metadata = { ...zone.metadata, ...updates.metadata };
        
        // Handle type change
        if (updates.type !== undefined && updates.type !== zone.type) {
            zone.type = updates.type;
            
            // Convert point to box: add default dimensions
            if (updates.type === "box" && !zone.dimensions) {
                zone.dimensions = { width: 3, height: 3, depth: 3 };
            }
            
            // Convert box to point: clear dimensions and from/to
            if (updates.type === "point") {
                // Calculate center position from box if dimensions exist
                if (zone.dimensions) {
                    zone.position = {
                        x: Math.round(zone.position.x + zone.dimensions.width / 2),
                        y: Math.round(zone.position.y + zone.dimensions.height / 2),
                        z: Math.round(zone.position.z + zone.dimensions.depth / 2),
                    };
                }
                zone.dimensions = undefined;
                zone.from = undefined;
                zone.to = undefined;
            }
        }
        
        // Recalculate from/to for box zones
        if (zone.type === "box" && zone.dimensions) {
            zone.from = { ...zone.position };
            zone.to = {
                x: zone.position.x + zone.dimensions.width - 1,
                y: zone.position.y + zone.dimensions.height - 1,
                z: zone.position.z + zone.dimensions.depth - 1,
            };
        } else {
            zone.from = undefined;
            zone.to = undefined;
        }
        
        // If color not explicitly set, update based on label
        if (updates.label !== undefined && updates.color === undefined) {
            zone.color = getZoneLabelColor(zone.label);
        }
        
        this.zones.set(zoneId, zone);
        this.updateZoneVisual(zone);
        this.saveToDatabase();
        this.notifyChange();
        
        return zone;
    }
    
    /**
     * Delete a zone
     */
    deleteZone(zoneId: string): boolean {
        const zone = this.zones.get(zoneId);
        if (!zone) {
            console.warn(`[ZoneManager] Zone not found: ${zoneId}`);
            return false;
        }
        
        this.removeZoneVisual(zoneId);
        this.zones.delete(zoneId);
        this.saveToDatabase();
        this.notifyChange();
        
        console.log(`[ZoneManager] Deleted zone: ${zoneId}`);
        return true;
    }
    
    /**
     * Get a zone by ID
     */
    getZone(zoneId: string): Zone | undefined {
        return this.zones.get(zoneId);
    }
    
    /**
     * Get all zones
     */
    getAllZones(): Zone[] {
        return Array.from(this.zones.values());
    }
    
    /**
     * Get zones by label
     */
    getZonesByLabel(label: string): Zone[] {
        return Array.from(this.zones.values()).filter(zone => zone.label === label);
    }
    
    /**
     * Clear all zones
     */
    clearAllZones() {
        this.zones.forEach((_, id) => {
            this.removeZoneVisual(id);
        });
        this.zones.clear();
        this.saveToDatabase();
        this.notifyChange();
    }
    
    /**
     * Set visibility of all zones
     */
    setVisible(visible: boolean) {
        this.visible = visible;
        this.zoneVisuals.forEach(visual => {
            visual.visible = visible;
        });
        window.dispatchEvent(new CustomEvent("zones-visibility-changed", { detail: { visible } }));
    }
    
    /**
     * Get visibility state
     */
    isVisible(): boolean {
        return this.visible;
    }
    
    /**
     * Toggle visibility
     */
    toggleVisibility(): boolean {
        this.setVisible(!this.visible);
        return this.visible;
    }
    
    // ========== Visual rendering methods ==========
    
    /**
     * Create 3D visual for a zone
     */
    private createZoneVisual(zone: Zone) {
        if (!this.scene) return;
        
        // Remove existing visual if any
        this.removeZoneVisual(zone.id);
        
        const group = new THREE.Group();
        group.name = `zone_${zone.id}`;
        
        const color = new THREE.Color(zone.color || getZoneLabelColor(zone.label));
        
        if (zone.type === "point") {
            // Point zone: small marker
            this.createPointMarker(group, zone.position, color);
        } else if (zone.type === "box" && zone.dimensions) {
            // Box zone: wireframe box with semi-transparent fill
            this.createBoxMarker(group, zone.position, zone.dimensions, color);
        }
        
        // Add label sprite (with custom name if set)
        const labelSprite = this.createLabelSprite(zone.label, color, zone.name);
        if (zone.type === "point") {
            labelSprite.position.set(zone.position.x, zone.position.y + 1.2, zone.position.z);
        } else if (zone.dimensions) {
            labelSprite.position.set(
                zone.position.x + zone.dimensions.width / 2,
                zone.position.y + zone.dimensions.height + 0.3,
                zone.position.z + zone.dimensions.depth / 2
            );
        }
        group.add(labelSprite);
        this.labelSprites.set(zone.id, labelSprite);
        
        group.visible = this.visible;
        this.scene.add(group);
        this.zoneVisuals.set(zone.id, group);
    }
    
    /**
     * Create a point marker (small cube)
     */
    private createPointMarker(group: THREE.Group, position: ZonePosition, color: THREE.Color) {
        const size = 0.5;
        
        // Create glowing cube
        const geometry = new THREE.BoxGeometry(size, size, size);
        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.7,
        });
        const cube = new THREE.Mesh(geometry, material);
        cube.position.set(position.x, position.y + size / 2, position.z);
        group.add(cube);
        
        // Add wireframe edges
        const edgesGeometry = new THREE.EdgesGeometry(geometry);
        const edgesMaterial = new THREE.LineBasicMaterial({ color: color, linewidth: 2 });
        const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
        edges.position.copy(cube.position);
        group.add(edges);
        
        // Add vertical line indicator
        const lineGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(position.x, position.y, position.z),
            new THREE.Vector3(position.x, position.y + 1.2, position.z),
        ]);
        const lineMaterial = new THREE.LineBasicMaterial({ color: color });
        const line = new THREE.Line(lineGeometry, lineMaterial);
        group.add(line);
    }
    
    /**
     * Create a box marker (wireframe with semi-transparent fill)
     */
    private createBoxMarker(
        group: THREE.Group,
        position: ZonePosition,
        dimensions: ZoneDimensions,
        color: THREE.Color
    ) {
        const { width, height, depth } = dimensions;
        
        // Create semi-transparent fill
        const fillGeometry = new THREE.BoxGeometry(width, height, depth);
        const fillMaterial = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.15,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        const fill = new THREE.Mesh(fillGeometry, fillMaterial);
        fill.position.set(
            position.x + width / 2,
            position.y + height / 2,
            position.z + depth / 2
        );
        fill.renderOrder = 1;
        group.add(fill);
        
        // Create thick wireframe edges using cylinders (like SelectionTool bounding boxes)
        const edgesGeometry = new THREE.EdgesGeometry(fillGeometry);
        const edgePositions = edgesGeometry.attributes.position;
        const tubeRadius = 0.06;
        const tubeSegments = 6;
        
        const tubeGeometry = new THREE.CylinderGeometry(tubeRadius, tubeRadius, 1, tubeSegments);
        const tubeMaterial = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.9,
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
            if (length < 0.001) continue;
            
            const center = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
            const normalizedDirection = direction.clone().normalize();
            
            const tube = new THREE.Mesh(tubeGeometry, tubeMaterial);
            tube.position.copy(center).add(fill.position);
            tube.scale.set(1, length, 1);
            
            // Rotate to align with edge direction
            const up = new THREE.Vector3(0, 1, 0);
            const quaternion = new THREE.Quaternion().setFromUnitVectors(up, normalizedDirection);
            tube.setRotationFromQuaternion(quaternion);
            
            group.add(tube);
        }
        
        // Also add thin line segments for better edge definition
        const lineMaterial = new THREE.LineBasicMaterial({
            color: color,
            transparent: true,
            opacity: 1.0,
        });
        const wireframe = new THREE.LineSegments(edgesGeometry, lineMaterial);
        wireframe.position.copy(fill.position);
        wireframe.renderOrder = 2;
        group.add(wireframe);
    }
    
    /**
     * Create a label sprite
     */
    private createLabelSprite(text: string, color: THREE.Color, zoneName?: string): THREE.Sprite {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d")!;
        
        // Set canvas size - smaller for less intrusive labels
        canvas.width = 192;
        canvas.height = 48;
        
        // Clear canvas
        context.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw background
        context.fillStyle = "rgba(0, 0, 0, 0.6)";
        context.roundRect(0, 0, canvas.width, canvas.height, 6);
        context.fill();
        
        // Draw border
        context.strokeStyle = `#${color.getHexString()}`;
        context.lineWidth = 2;
        context.roundRect(0, 0, canvas.width, canvas.height, 6);
        context.stroke();
        
        // Draw text
        context.fillStyle = "#ffffff";
        context.textAlign = "center";
        context.textBaseline = "middle";
        
        // Format label: convert snake_case to Title Case
        const formattedLabel = text
            .split("_")
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
        
        // If zone has custom name, show that instead (or show both)
        if (zoneName) {
            context.font = "bold 18px Arial";
            context.fillText(zoneName, canvas.width / 2, canvas.height / 2 - 8);
            context.font = "12px Arial";
            context.fillStyle = "#aaaaaa";
            context.fillText(formattedLabel, canvas.width / 2, canvas.height / 2 + 10);
        } else {
            context.font = "bold 18px Arial";
            context.fillText(formattedLabel, canvas.width / 2, canvas.height / 2);
        }
        
        // Create sprite
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
        });
        
        const sprite = new THREE.Sprite(spriteMaterial);
        // Reduced scale for smaller labels
        sprite.scale.set(1.2, 0.3, 1);
        sprite.renderOrder = 999;
        
        return sprite;
    }
    
    /**
     * Update zone visual
     */
    private updateZoneVisual(zone: Zone) {
        // For simplicity, recreate the visual
        this.createZoneVisual(zone);
    }
    
    /**
     * Remove zone visual
     */
    private removeZoneVisual(zoneId: string) {
        const visual = this.zoneVisuals.get(zoneId);
        if (visual && this.scene) {
            // Dispose of geometries and materials
            visual.traverse((child) => {
                if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Line) {
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
            this.scene.remove(visual);
            this.zoneVisuals.delete(zoneId);
        }
        this.labelSprites.delete(zoneId);
    }
    
    /**
     * Rebuild all visuals
     */
    private rebuildAllVisuals() {
        // Remove all existing visuals
        this.zoneVisuals.forEach((_, id) => {
            this.removeZoneVisual(id);
        });
        
        // Create visuals for all zones
        this.zones.forEach(zone => {
            this.createZoneVisual(zone);
        });
    }
    
    /**
     * Get zone at a world position (for selection)
     */
    getZoneAtPosition(position: THREE.Vector3): Zone | null {
        for (const zone of this.zones.values()) {
            if (zone.type === "point") {
                // Check if position is near the point
                const dist = Math.sqrt(
                    Math.pow(position.x - zone.position.x, 2) +
                    Math.pow(position.y - zone.position.y, 2) +
                    Math.pow(position.z - zone.position.z, 2)
                );
                if (dist < 1.0) return zone;
            } else if (zone.type === "box" && zone.dimensions) {
                // Check if position is inside the box
                const { x, y, z } = zone.position;
                const { width, height, depth } = zone.dimensions;
                if (
                    position.x >= x && position.x <= x + width &&
                    position.y >= y && position.y <= y + height &&
                    position.z >= z && position.z <= z + depth
                ) {
                    return zone;
                }
            }
        }
        return null;
    }
    
    /**
     * Export zones for map export
     */
    exportZones(): Zone[] {
        return Array.from(this.zones.values()).map(zone => {
            const exportedZone: Zone = {
                id: zone.id,
                label: zone.label,
                type: zone.type,
                position: { ...zone.position },
                dimensions: zone.dimensions ? { ...zone.dimensions } : undefined,
                color: zone.color,
                metadata: zone.metadata ? { ...zone.metadata } : undefined,
            };
            
            // Include name if set
            if (zone.name) {
                exportedZone.name = zone.name;
            }
            
            // Include from/to coordinates for box zones
            if (zone.type === "box" && zone.dimensions) {
                exportedZone.from = { ...zone.position };
                exportedZone.to = {
                    x: zone.position.x + zone.dimensions.width - 1,
                    y: zone.position.y + zone.dimensions.height - 1,
                    z: zone.position.z + zone.dimensions.depth - 1,
                };
            }
            
            return exportedZone;
        });
    }
    
    /**
     * Generate TypeScript export string for zones
     */
    generateZonesTypeScript(): string {
        const zones = this.exportZones();
        
        if (zones.length === 0) {
            return `// No zones defined
export const zones = [];
`;
        }
        
        let ts = `/**
 * Zone definitions exported from HYTOPIA World Editor
 * Generated: ${new Date().toISOString()}
 */

export interface ZonePosition {
    x: number;
    y: number;
    z: number;
}

export interface ZoneDimensions {
    width: number;
    height: number;
    depth: number;
}

export interface Zone {
    id: string;
    name?: string;
    label: string;
    type: "point" | "box";
    position: ZonePosition;
    dimensions?: ZoneDimensions;
    from?: ZonePosition;
    to?: ZonePosition;
    color?: string;
    metadata?: Record<string, any>;
}

export const zones: Zone[] = [\n`;
        
        zones.forEach((zone, index) => {
            ts += `    {\n`;
            ts += `        id: "${zone.id}",\n`;
            if (zone.name) {
                ts += `        name: "${zone.name}",\n`;
            }
            ts += `        label: "${zone.label}",\n`;
            ts += `        type: "${zone.type}",\n`;
            ts += `        position: { x: ${zone.position.x}, y: ${zone.position.y}, z: ${zone.position.z} },\n`;
            
            if (zone.dimensions) {
                ts += `        dimensions: { width: ${zone.dimensions.width}, height: ${zone.dimensions.height}, depth: ${zone.dimensions.depth} },\n`;
            }
            
            if (zone.from) {
                ts += `        from: { x: ${zone.from.x}, y: ${zone.from.y}, z: ${zone.from.z} },\n`;
            }
            
            if (zone.to) {
                ts += `        to: { x: ${zone.to.x}, y: ${zone.to.y}, z: ${zone.to.z} },\n`;
            }
            
            if (zone.color) {
                ts += `        color: "${zone.color}",\n`;
            }
            
            if (zone.metadata && Object.keys(zone.metadata).length > 0) {
                ts += `        metadata: ${JSON.stringify(zone.metadata)},\n`;
            }
            
            ts += `    }${index < zones.length - 1 ? ',' : ''}\n`;
        });
        
        ts += `];\n\n`;
        
        // Add helper functions
        ts += `// Helper functions for working with zones
export const getZonesByLabel = (label: string): Zone[] => 
    zones.filter(zone => zone.label === label);

export const getZoneById = (id: string): Zone | undefined => 
    zones.find(zone => zone.id === id);

export const getZoneByName = (name: string): Zone | undefined => 
    zones.find(zone => zone.name === name);

export const getSpawnPoints = (): Zone[] => 
    zones.filter(zone => zone.label === "spawn_point" || zone.label === "spawn_area");

export const isPositionInZone = (x: number, y: number, z: number, zone: Zone): boolean => {
    if (zone.type === "point") {
        return zone.position.x === x && zone.position.y === y && zone.position.z === z;
    }
    if (zone.from && zone.to) {
        return x >= zone.from.x && x <= zone.to.x &&
               y >= zone.from.y && y <= zone.to.y &&
               z >= zone.from.z && z <= zone.to.z;
    }
    return false;
};
`;
        
        return ts;
    }
    
    /**
     * Import zones from map import
     */
    importZones(zones: Zone[]) {
        // Clear existing zones
        this.clearAllZones();
        
        // Import new zones
        zones.forEach(zone => {
            // Ensure zone has all required fields
            const validZone: Zone = {
                id: zone.id || generateZoneId(),
                label: zone.label || "custom",
                type: zone.type || "box",
                position: zone.position || { x: 0, y: 0, z: 0 },
                dimensions: zone.dimensions,
                color: zone.color || getZoneLabelColor(zone.label || "custom"),
                metadata: zone.metadata,
            };
            
            this.zones.set(validZone.id, validZone);
            this.createZoneVisual(validZone);
        });
        
        this.saveToDatabase();
        this.notifyChange();
        console.log(`[ZoneManager] Imported ${zones.length} zones`);
    }
    
    /**
     * Dispose of the manager
     */
    dispose() {
        this.zoneVisuals.forEach((_, id) => {
            this.removeZoneVisual(id);
        });
        this.zones.clear();
        this.changeListeners.clear();
        this.scene = null;
    }
}

// Export singleton instance
export const zoneManager = new ZoneManager();
export default ZoneManager;

