export type UndoRedoState = {
    terrain: {
        added: any[];
        removed: any[];
    };
    environment: {
        added: any[];
        removed: any[];
    }
}

export type CustomModel = {
    data: ArrayBuffer;
    name: string;
    timestamp: number;
}

// Zone types for demarcating areas in the world
export type ZoneType = "point" | "box";

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
    name?: string;           // Optional custom name/tag for the zone
    label: string;           // e.g., "spawn_point", "npc_spawn", "boundary"
    type: ZoneType;          // Point = single coord, Box = 3D region
    position: ZonePosition;  // Origin point (min corner for box, center for point)
    dimensions?: ZoneDimensions; // For box type only
    // For box zones: from/to coordinates (calculated from position + dimensions)
    from?: ZonePosition;     // Min corner of box zone
    to?: ZonePosition;       // Max corner of box zone
    color?: string;          // Optional custom color (hex string)
    metadata?: Record<string, any>; // User-defined properties
}

// Predefined zone label presets
export const ZONE_LABEL_PRESETS = [
    { value: "spawn_point", label: "Spawn Point", color: "#22c55e" },       // Green
    { value: "spawn_area", label: "Spawn Area", color: "#16a34a" },         // Darker green
    { value: "boundary", label: "Boundary", color: "#ef4444" },             // Red
    { value: "npc_spawn", label: "NPC Spawn", color: "#f59e0b" },           // Amber
    { value: "trigger_zone", label: "Trigger Zone", color: "#3b82f6" },     // Blue
    { value: "safe_zone", label: "Safe Zone", color: "#06b6d4" },           // Cyan
    { value: "danger_zone", label: "Danger Zone", color: "#dc2626" },       // Dark red
    { value: "checkpoint", label: "Checkpoint", color: "#8b5cf6" },         // Purple
    { value: "custom", label: "Custom", color: "#9ca3af" },                 // Gray
] as const;

export type ZoneLabelPreset = typeof ZONE_LABEL_PRESETS[number]["value"];