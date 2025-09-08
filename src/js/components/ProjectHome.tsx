import React, { useEffect, useMemo, useState } from "react";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";

type Project = {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    lastOpenedAt?: number;
    description?: string;
    thumbnailDataUrl?: string;
};

export default function ProjectHome({ onOpen }: { onOpen: (projectId: string) => void }) {
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState("");
    const [query, setQuery] = useState("");

    const refresh = async () => {
        setLoading(true);
        try {
            const list = await DatabaseManager.listProjects();
            setProjects(Array.isArray(list) ? list.sort((a, b) => (b.lastOpenedAt || b.updatedAt) - (a.lastOpenedAt || a.updatedAt)) : []);
        } catch (e) {
            setProjects([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refresh();
    }, []);

    const handleCreate = async (nameOverride?: string) => {
        const nameToUse = (nameOverride ?? newName).trim();
        if (!nameToUse || creating) return;
        setCreating(true);
        try {
            const meta = await DatabaseManager.createProject(nameToUse);
            if (meta && meta.id) {
                await DatabaseManager.touchProject(meta.id);
                onOpen(meta.id);
            }
        } finally {
            setCreating(false);
        }
    };

    const handleOpen = async (id: string) => {
        await DatabaseManager.touchProject(id);
        onOpen(id);
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm("Delete this project? This cannot be undone.")) return;
        await DatabaseManager.deleteProject(id);
        refresh();
    };

    const handleDuplicate = async (id: string) => {
        try {
            const list = await DatabaseManager.listProjects();
            const src = (list || []).find(p => p.id === id);
            if (!src) return;
            const copy = await DatabaseManager.createProject(`${src.name} (Copy)`);
            const newId = copy?.id;
            if (!newId) return;
            const original = DatabaseManager.getCurrentProjectId();
            // Read source data by switching context
            DatabaseManager.setCurrentProjectId(id);
            const tSrc = await DatabaseManager.getData("terrain", "current");
            const eSrc = await DatabaseManager.getData("environment", "current");
            const sky = await DatabaseManager.getData("settings", `project:${id}:selectedSkybox`);
            const amb = await DatabaseManager.getData("settings", `project:${id}:ambientLight`);
            const dir = await DatabaseManager.getData("settings", `project:${id}:directionalLight`);
            // Write to new project
            DatabaseManager.setCurrentProjectId(newId);
            await DatabaseManager.saveData("terrain", "current", tSrc || {});
            await DatabaseManager.saveData("environment", "current", eSrc || []);
            if (sky !== undefined) await DatabaseManager.saveData("settings", `project:${newId}:selectedSkybox`, sky);
            if (amb !== undefined) await DatabaseManager.saveData("settings", `project:${newId}:ambientLight`, amb);
            if (dir !== undefined) await DatabaseManager.saveData("settings", `project:${newId}:directionalLight`, dir);
            if (src.thumbnailDataUrl) await DatabaseManager.saveProjectThumbnail(newId, src.thumbnailDataUrl);
            // Restore original selection, refresh list
            DatabaseManager.setCurrentProjectId(original);
            refresh();
        } catch (e) {
            console.error("Duplicate failed", e);
        }
    };

    const handleExport = async (id: string) => {
        try {
            const original = DatabaseManager.getCurrentProjectId();
            DatabaseManager.setCurrentProjectId(id);
            const meta = (await DatabaseManager.listProjects()).find(p => p.id === id) || { id, name: "Project" };
            const terrain = await DatabaseManager.getData("terrain", "current");
            const environment = await DatabaseManager.getData("environment", "current");
            const settings = {
                skybox: await DatabaseManager.getData("settings", `project:${id}:selectedSkybox`),
                ambientLight: await DatabaseManager.getData("settings", `project:${id}:ambientLight`),
                directionalLight: await DatabaseManager.getData("settings", `project:${id}:directionalLight`),
            };
            const payload = { meta, terrain, environment, settings, version: 1 };
            const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${meta.name || "project"}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            DatabaseManager.setCurrentProjectId(original);
        } catch (e) {
            console.error("Export failed", e);
        }
    };

    const handleImport = async (file: File) => {
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const created = await DatabaseManager.createProject(data?.meta?.name || file.name.replace(/\.json$/i, ""));
            const pid = created?.id;
            if (!pid) return;
            DatabaseManager.setCurrentProjectId(pid);
            await DatabaseManager.saveData("terrain", "current", data.terrain || {});
            await DatabaseManager.saveData("environment", "current", data.environment || []);
            if (data.settings) {
                if (data.settings.skybox) await DatabaseManager.saveData("settings", `project:${pid}:selectedSkybox`, data.settings.skybox);
                if (data.settings.ambientLight) await DatabaseManager.saveData("settings", `project:${pid}:ambientLight`, data.settings.ambientLight);
                if (data.settings.directionalLight) await DatabaseManager.saveData("settings", `project:${pid}:directionalLight`, data.settings.directionalLight);
            }
            if (data.meta?.thumbnailDataUrl) await DatabaseManager.saveProjectThumbnail(pid, data.meta.thumbnailDataUrl);
            refresh();
            onOpen(pid);
        } catch (e) {
            console.error("Import failed", e);
        }
    };

    const filtered = projects.filter(p => !query || (p.name || "").toLowerCase().includes(query.toLowerCase()));

    return (
        <div style={styles.shell}>
            {/* Sidebar */}
            <aside style={styles.sidebar}>
                <div style={styles.brand}>HYTOPIA</div>
                <nav style={styles.nav}>
                    <a style={styles.navItem}>Home</a>
                    <a style={styles.navItem}>My files</a>
                    <a style={styles.navItem}>Templates</a>
                    <a style={styles.navItem}>Generate</a>
                    <a style={styles.navItem}>Shared with me</a>
                    <a style={styles.navItem}>Community</a>
                    <a style={styles.navItem}>Tutorials</a>
                    <a style={styles.navItem}>Inbox</a>
                </nav>
                <div style={styles.sidebarFooter}>
                    <a href="https://discord.gg/hytopia" target="_blank" rel="noreferrer" style={styles.socialLink}>Discord</a>
                    <a href="https://instagram.com" target="_blank" rel="noreferrer" style={styles.socialLink}>Instagram</a>
                    <a href="https://twitter.com" target="_blank" rel="noreferrer" style={styles.socialLink}>Twitter/X</a>
                </div>
            </aside>

            {/* Main area */}
            <main style={styles.main}>
                {/* Header */}
                <div style={styles.headerBar}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        <div style={styles.pageTitle}>Home</div>
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search projects"
                            style={styles.search}
                        />
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button
                            onClick={async () => {
                                const name = window.prompt("Project name", newName || "Untitled Project");
                                if (!name) return;
                                await handleCreate(name);
                            }}
                            style={styles.primaryBtn}
                        >
                            New Project
                        </button>
                        <label style={styles.secondaryBtn as any}>
                            Import
                            <input type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => e.target.files && e.target.files[0] && handleImport(e.target.files[0])} />
                        </label>
                    </div>
                </div>

                {/* Content grid */}
                <div style={styles.gridWrap}>
                    {loading ? (
                        <div style={{ opacity: 0.7 }}>Loading...</div>
                    ) : filtered.length === 0 ? (
                        <div style={{ opacity: 0.7 }}>No projects found.</div>
                    ) : (
                        filtered.map((p) => (
                            <div key={p.id} style={styles.card}>
                                <div style={styles.thumb}>
                                    {p.thumbnailDataUrl ? (
                                        <img src={p.thumbnailDataUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                    ) : (
                                        <div style={styles.placeholderThumb}>No Thumbnail</div>
                                    )}
                                </div>
                                <div style={styles.cardBody}>
                                    <div style={{ fontWeight: 600 }}>{p.name || "Untitled"}</div>
                                    <div style={styles.metaRow}>Updated {new Date(p.updatedAt || p.createdAt).toLocaleString()}</div>
                                </div>
                                <div style={styles.cardActions}>
                                    <button style={styles.primaryBtn} onClick={() => handleOpen(p.id)}>Open</button>
                                    <button style={styles.secondaryBtn} onClick={() => handleDuplicate(p.id)}>Duplicate</button>
                                    <button style={styles.secondaryBtn} onClick={() => handleExport(p.id)}>Export</button>
                                    <button style={styles.dangerBtn} onClick={() => handleDelete(p.id)}>Delete</button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </main>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    shell: {
        position: "fixed",
        inset: 0,
        display: "grid",
        gridTemplateColumns: "260px 1fr",
        background: "#0b0e12",
        color: "#eaeaea",
    },
    sidebar: {
        background: "#0e1117",
        borderRight: "1px solid #1a1f29",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 16,
    },
    brand: {
        fontWeight: 800,
        letterSpacing: 1,
        color: "#8ab4ff",
    },
    nav: {
        display: "flex",
        flexDirection: "column",
        gap: 8,
        marginTop: 8,
    },
    navItem: {
        padding: "8px 10px",
        borderRadius: 8,
        color: "#cfd6e4",
        background: "transparent",
        cursor: "pointer",
    },
    sidebarFooter: {
        marginTop: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        opacity: 0.85,
    },
    socialLink: {
        color: "#8a97ad",
        fontSize: 12,
    },
    main: {
        display: "flex",
        flexDirection: "column",
        padding: 16,
        gap: 16,
    },
    headerBar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
    },
    pageTitle: {
        fontSize: 18,
        fontWeight: 700,
    },
    search: {
        background: "#0e131a",
        border: "1px solid #1f2733",
        color: "#eaeaea",
        padding: "8px 10px",
        borderRadius: 8,
        minWidth: 240,
    },
    gridWrap: {
        overflow: "auto",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: 14,
        paddingRight: 8,
    },
    card: {
        display: "flex",
        flexDirection: "column",
        background: "#0e131a",
        border: "1px solid #1a1f29",
        borderRadius: 8,
        overflow: "hidden",
    },
    thumb: {
        height: 160,
        background: "#141821",
    },
    placeholderThumb: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#7b8496",
        fontSize: 12,
    },
    cardBody: {
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 4,
    },
    metaRow: {
        opacity: 0.7,
        fontSize: 12,
    },
    cardActions: {
        padding: 12,
        display: "flex",
        gap: 8,
        justifyContent: "flex-end",
    },
    primaryBtn: {
        background: "#2b6aff",
        color: "white",
        border: "none",
        borderRadius: 6,
        padding: "8px 12px",
        cursor: "pointer",
    },
    secondaryBtn: {
        background: "#1a1e24",
        color: "#cfd6e4",
        border: "1px solid #2b2f36",
        borderRadius: 6,
        padding: "8px 12px",
        cursor: "pointer",
    },
    dangerBtn: {
        background: "#3a3f46",
        color: "#ff8a8a",
        border: "1px solid #504a4a",
        borderRadius: 6,
        padding: "8px 12px",
        cursor: "pointer",
    },
};


