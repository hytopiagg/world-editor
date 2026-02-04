export type ChangelogEntry = {
    date: string;
    version?: string;
    changes: { type: "added" | "fixed" | "improved"; text: string }[];
};

export const CHANGELOG: ChangelogEntry[] = [
    {
        date: "2026-02-04",
        version: "0.9.0",
        changes: [
            { type: "added", text: "Home dashboard with recently opened projects, templates, and screenshots" },
            { type: "added", text: "Changelog panel in the home tab" },
            { type: "added", text: "Template import functionality in project creation flow" },
            { type: "improved", text: "UI components with Lucide icons and refined styles" },
            { type: "improved", text: "Empty state designs for projects and screenshots" },
            { type: "fixed", text: "Snap to grid behavior" },
        ],
    },
    {
        date: "2026-01-30",
        changes: [
            { type: "added", text: "Screenshot gallery page with project filtering" },
            { type: "fixed", text: "Rendering clarity using actual framebuffer size in post-processing" },
        ],
    },
    {
        date: "2026-01-27",
        changes: [
            { type: "added", text: "Block rotation and shape management in terrain builder" },
            { type: "added", text: "Enhanced block preview and shape selection" },
            { type: "fixed", text: "Triangle index order in BlockShapes for various geometries" },
        ],
    },
    {
        date: "2026-01-24",
        changes: [
            { type: "added", text: "Per-instance opacity support for instanced meshes" },
            { type: "added", text: "Per-instance emissive attributes for instanced meshes" },
            { type: "improved", text: "Material transparency handling and AABB sorting" },
        ],
    },
    {
        date: "2026-01-20",
        changes: [
            { type: "added", text: "Emissive properties support for entities" },
            { type: "improved", text: "Emissive material handling to restore original values" },
        ],
    },
];
