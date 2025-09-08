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
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    const refresh = async () => {
        setLoading(true);
        try {
            const list = await DatabaseManager.listProjects();
            setProjects(
                Array.isArray(list)
                    ? list
                        .map((p: any) => ({ ...p }))
                        .sort(
                            (a: any, b: any) =>
                                (b.lastOpenedAt || b.updatedAt || 0) -
                                (a.lastOpenedAt || a.updatedAt || 0)
                        )
                    : []
            );
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

    const filtered = projects.filter(
        (p) => !query || (p.name || "").toLowerCase().includes(query.toLowerCase())
    );

    const formatLastEdited = (ts: number) => {
        const diff = Date.now() - (ts || 0);
        const m = 60 * 1000;
        const h = 60 * m;
        const d = 24 * h;
        const w = 7 * d;
        const mo = 30 * d;
        if (diff < h) {
            const mins = Math.max(1, Math.round(diff / m));
            return `Last edited ${mins} minute${mins === 1 ? "" : "s"} ago`;
        }
        if (diff < d) {
            const hrs = Math.round(diff / h);
            return `Last edited ${hrs} hour${hrs === 1 ? "" : "s"} ago`;
        }
        if (diff < w * 2) {
            const days = Math.round(diff / d);
            return `Last edited ${days} day${days === 1 ? "" : "s"} ago`;
        }
        if (diff < mo * 2) {
            const weeks = Math.round(diff / w);
            return `Last edited ${weeks} week${weeks === 1 ? "" : "s"} ago`;
        }
        const months = Math.round(diff / mo);
        return `Last edited ${months} month${months === 1 ? "" : "s"} ago`;
    };

    return (
        <div style={styles.shell}>
            {/* Sidebar */}
            <aside style={styles.sidebar}>
                <div style={styles.brandRow}>
                    <img src={"./assets/img/Hytopia_Tiny.png"} style={styles.brandLogo as any} />
                </div>
                <nav style={styles.nav}>
                    <div style={styles.navItem}><span style={styles.navIcon}>🏠</span><span>Home</span></div>
                    <div style={styles.navItem}><span style={styles.navIcon}>📁</span><span>My files</span></div>
                    <div style={styles.navItem}><span style={styles.navIcon}>🧩</span><span>Templates</span></div>
                    <div style={styles.navItem}><span style={styles.navIcon}>✨</span><span>Generate</span></div>
                    <div style={styles.navItem}><span style={styles.navIcon}>🤝</span><span>Shared with me</span></div>
                    <div style={styles.navItem}><span style={styles.navIcon}>🌐</span><span>Community</span></div>
                    <div style={styles.navItem}><span style={styles.navIcon}>🎓</span><span>Tutorials</span></div>
                    <div style={styles.navItem}><span style={styles.navIcon}>📥</span><span>Inbox</span></div>
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
                    </div>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search projects"
                            style={styles.search}
                        />
                        <label style={{ ...styles.secondaryBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' } as any}>
                            Import
                            <input type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => e.target.files && e.target.files[0] && handleImport(e.target.files[0])} />
                        </label>
                        <button
                            onClick={async () => {
                                const name = window.prompt("Project name", newName || "Untitled Project");
                                if (!name) return;
                                await handleCreate(name);
                            }}
                            style={{ ...styles.primaryBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                            Create
                        </button>
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
                            <div
                                key={p.id}
                                style={styles.card}
                                onClick={() => handleOpen(p.id)}
                                onMouseEnter={() => setHoveredId(p.id)}
                                onMouseLeave={() => setHoveredId(null)}
                            >
                                <div
                                    style={{
                                        ...styles.thumb,
                                        boxShadow: hoveredId === p.id ? '0 6px 16px rgba(0,0,0,0.35)' : 'none',
                                        outline: hoveredId === p.id ? '1px solid rgba(255,255,255,0.9)' : '1px solid transparent',
                                        outlineOffset: -1,
                                    }}
                                >
                                    {p.thumbnailDataUrl ? (
                                        <img src={p.thumbnailDataUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                    ) : (
                                        <div style={styles.placeholderThumb}>No Thumbnail</div>
                                    )}
                                </div>
                                <div style={styles.cardBody}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div style={{ textAlign: 'left' }}>
                                            <div style={styles.cardTitle}>{p.name || "Untitled"}</div>
                                            <div style={styles.metaRow}>{formatLastEdited(p.updatedAt || p.createdAt)}</div>
                                        </div>
                                        <div className="ph-menu" style={{ position: 'relative', transform: 'none' }} onClick={(e) => e.stopPropagation()}>
                                            <button
                                                onClick={(e) => {
                                                    const btn = e.currentTarget as HTMLButtonElement;
                                                    const menu = btn.nextElementSibling as HTMLDivElement;
                                                    if (menu) menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
                                                }}
                                                style={{ ...styles.ellipsisBtn, display: hoveredId === p.id ? 'inline-flex' : 'none' } as any}
                                            >
                                                ⋮
                                            </button>
                                            <div style={styles.menu as any} onClick={(e) => e.stopPropagation()}>
                                                <button style={styles.menuItem as any} onClick={async () => {
                                                    const name = window.prompt('Rename project', p.name || 'Untitled');
                                                    if (!name) return;
                                                    try {
                                                        const db = await (DatabaseManager as any).getConnection();
                                                        await new Promise<void>((resolve) => {
                                                            const tx = db.transaction((DatabaseManager as any).STORES.PROJECTS, 'readwrite');
                                                            const store = tx.objectStore((DatabaseManager as any).STORES.PROJECTS);
                                                            const next = { ...p, name, updatedAt: Date.now() };
                                                            const req = store.put(next, p.id);
                                                            req.onsuccess = () => resolve();
                                                            req.onerror = () => resolve();
                                                        });
                                                        refresh();
                                                    } catch (_) { }
                                                }}>Rename</button>
                                                <button style={styles.menuItem as any} onClick={() => handleDuplicate(p.id)}>Duplicate</button>
                                                <button style={styles.menuItem as any} onClick={() => handleExport(p.id)}>Export</button>
                                                <button style={styles.menuItem as any} onClick={() => handleOpen(p.id)}>Open</button>
                                                <button style={{ ...styles.menuItem, color: '#ff8a8a' } as any} onClick={() => handleDelete(p.id)}>Delete</button>
                                            </div>
                                        </div>
                                    </div>
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
    brandRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        padding: "6px 0",
    },
    brandLogo: {
        height: 24,
        width: "auto",
        imageRendering: "auto",
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
        display: "flex",
        alignItems: "center",
        gap: 8,
    },
    navIcon: {
        width: 16,
        textAlign: "center",
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
        overflow: "visible",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: 14,
        paddingRight: 8,
    },
    card: {
        display: "flex",
        flexDirection: "column",
        // background: "#0e131a",
        // border: "1px solid #1a1f29",
        borderRadius: 8,
        overflow: "visible",
        transition: "box-shadow 120ms ease",
    },
    thumb: {
        height: 160,
        background: "#141821",
        borderRadius: 8,
        overflow: "hidden",
        transition: "transform 120ms ease, box-shadow 120ms ease, outline 120ms ease",
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
        background: 'transparent',
        border: 'none',
        boxShadow: 'none',
    },
    cardTitle: {
        fontWeight: 600,
        background: 'transparent',
    },
    metaRow: {
        opacity: 0.7,
        fontSize: 12,
        background: 'transparent',
    },
    ellipsisBtn: {
        background: "transparent",
        border: "none",
        color: "#cfd6e4",
        borderRadius: 6,
        width: 28,
        height: 28,
        cursor: "pointer",
        lineHeight: 1,
        alignItems: 'center',
        justifyContent: 'center',
        display: 'inline-flex',
    },
    menu: {
        position: "absolute",
        right: 0,
        top: 30,
        display: "none",
        background: "#0e131a",
        border: "1px solid #1a1f29",
        borderRadius: 8,
        overflow: "hidden",
        zIndex: 10,
    },
    menuItem: {
        display: "block",
        padding: "8px 12px",
        color: "#cfd6e4",
        background: "transparent",
        border: "none",
        textAlign: "left" as any,
        cursor: "pointer",
        width: "100%",
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


