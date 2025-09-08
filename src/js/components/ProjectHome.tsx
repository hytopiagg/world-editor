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
    const [contextMenu, setContextMenu] = useState<{ id: string | null; x: number; y: number; open: boolean }>({ id: null, x: 0, y: 0, open: false });

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

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (contextMenu.open) {
                e.preventDefault();
            }
        };
        window.addEventListener('contextmenu', handler, { capture: true } as any);
        return () => window.removeEventListener('contextmenu', handler as any, { capture: true } as any);
    }, [contextMenu.open]);

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
                                data-pid={p.id}
                                onClick={() => handleOpen(p.id)}
                                onMouseEnter={() => setHoveredId(p.id)}
                                onMouseLeave={() => setHoveredId(null)}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    // Close any inline menus when global context menu opens
                                    try {
                                        document.querySelectorAll('.ph-inline-menu').forEach((el) => {
                                            (el as HTMLElement).style.display = 'none';
                                        });
                                    } catch (_) { }
                                    // Always reposition and open the menu at the new cursor location
                                    setContextMenu({ id: p.id, x: e.clientX, y: e.clientY, open: false });
                                    requestAnimationFrame(() => setContextMenu({ id: p.id, x: e.clientX, y: e.clientY, open: true }));
                                }}
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
                                        <img src={p.thumbnailDataUrl} style={{ position: 'absolute', inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                                    ) : (
                                        <div style={{ ...styles.placeholderThumb, position: 'absolute', inset: 0 }}>No Thumbnail</div>
                                    )}
                                </div>
                                <div style={styles.cardBody}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div style={{ textAlign: 'left' }}>
                                            <div style={styles.cardTitle}>{p.name || "Untitled"}</div>
                                            <div style={styles.metaRow}>{formatLastEdited(p.updatedAt || p.createdAt)}</div>
                                        </div>
                                        <div className="ph-menu" style={{ position: 'relative', transform: 'none', width: 28, height: 28, display: 'inline-block' }} onClick={(e) => e.stopPropagation()}>
                                            <button
                                                onClick={(e) => {
                                                    const btn = e.currentTarget as HTMLButtonElement;
                                                    // Close any open right-click menu
                                                    setContextMenu({ id: null, x: 0, y: 0, open: false });
                                                    // Close other inline menus
                                                    try {
                                                        document.querySelectorAll('.ph-inline-menu').forEach((el) => {
                                                            (el as HTMLElement).style.display = 'none';
                                                        });
                                                    } catch (_) { }
                                                    const menu = btn.nextElementSibling as HTMLDivElement;
                                                    if (menu) menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
                                                }}
                                                style={{ ...styles.ellipsisBtn, opacity: hoveredId === p.id ? 1 : 0, pointerEvents: hoveredId === p.id ? 'auto' : 'none' } as any}
                                            >
                                                ⋮
                                            </button>
                                            <div className="ph-inline-menu" style={styles.menu as any} onClick={(e) => e.stopPropagation()}>
                                                <button style={styles.menuItem as any} onClick={async (evt) => {
                                                    const raw = window.prompt('Rename project', p.name || 'Untitled');
                                                    if (raw === null) return;
                                                    const name = (raw || '').trim();
                                                    if (!name) return;
                                                    console.log('[ProjectHome] Inline rename start', { id: p.id, prev: p.name, next: name });
                                                    try {
                                                        const db = await (DatabaseManager as any).getConnection();
                                                        await new Promise<void>((resolve) => {
                                                            const tx = db.transaction(STORES.PROJECTS, 'readwrite');
                                                            tx.onerror = (e) => console.warn('[ProjectHome] Inline rename TX error', (e as any)?.target?.error);
                                                            const store = tx.objectStore(STORES.PROJECTS);
                                                            const next = { ...p, name, updatedAt: Date.now() };
                                                            const req = store.put(next, p.id);
                                                            req.onsuccess = () => { console.log('[ProjectHome] Inline rename DB success', { id: p.id, name }); resolve(); };
                                                            req.onerror = () => { console.warn('[ProjectHome] Inline rename DB error', req.error); resolve(); };
                                                        });
                                                        // Update local state immediately
                                                        setProjects(prev => {
                                                            const next = prev.map(px => px.id === p.id ? { ...px, name } : px);
                                                            console.log('[ProjectHome] Inline rename state updated');
                                                            return next;
                                                        });
                                                    } catch (err) { console.error('[ProjectHome] Inline rename exception', err); }
                                                    // Hide this inline menu
                                                    try {
                                                        const btn = evt.currentTarget as HTMLElement;
                                                        const wrapper = btn.closest('.ph-inline-menu') as HTMLElement | null;
                                                        if (wrapper) wrapper.style.display = 'none';
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
                {/* Global context menu (right-click) */}
                {contextMenu.open && contextMenu.id && (
                    <>
                        <div
                            onMouseDown={(e) => {
                                // Close on left-click; allow right-click to reposition
                                if (e.button === 0) {
                                    setContextMenu({ id: null, x: 0, y: 0, open: false });
                                }
                            }}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                // Hit-test using elementsFromPoint to go through overlay
                                const els = (document as any).elementsFromPoint ? (document as any).elementsFromPoint(e.clientX, e.clientY) : [];
                                let pid: string | null = null;
                                for (const el of els) {
                                    if (el && el.getAttribute && el.getAttribute('data-pid')) {
                                        pid = el.getAttribute('data-pid');
                                        break;
                                    }
                                }
                                if (pid) {
                                    // Close inline menus
                                    try {
                                        document.querySelectorAll('.ph-inline-menu').forEach((el) => {
                                            (el as HTMLElement).style.display = 'none';
                                        });
                                    } catch (_) { }
                                    // Open immediately at new location
                                    setContextMenu({ id: pid, x: e.clientX, y: e.clientY, open: true });
                                } else {
                                    setContextMenu({ id: null, x: 0, y: 0, open: false });
                                }
                            }}
                            style={styles.cmOverlay as any}
                        />
                        <div style={{
                            ...styles.menu,
                            position: 'fixed',
                            left: Math.min(contextMenu.x, window.innerWidth - 180),
                            top: Math.min(contextMenu.y, window.innerHeight - 160),
                            display: 'block',
                            zIndex: 1000
                        } as any}>
                            <button style={styles.menuItem as any} onClick={async () => {
                                const raw = window.prompt('Rename project');
                                if (raw === null) return;
                                const name = (raw || '').trim();
                                if (!name) return;
                                console.log('[ProjectHome] Context rename start', { id: contextMenu.id, next: name });
                                try {
                                    const db = await (DatabaseManager as any).getConnection();
                                    await new Promise<void>((resolve) => {
                                        const tx = db.transaction(STORES.PROJECTS, 'readwrite');
                                        tx.onerror = (e) => console.warn('[ProjectHome] Context rename TX error', (e as any)?.target?.error);
                                        const store = tx.objectStore(STORES.PROJECTS);
                                        const src = projects.find(pp => pp.id === contextMenu.id);
                                        const next = { ...(src || {}), id: contextMenu.id, name, updatedAt: Date.now() };
                                        const req = store.put(next, contextMenu.id);
                                        req.onsuccess = () => { console.log('[ProjectHome] Context rename DB success', { id: contextMenu.id, name }); resolve(); };
                                        req.onerror = () => { console.warn('[ProjectHome] Context rename DB error', req.error); resolve(); };
                                    });
                                    setProjects(prev => {
                                        const next = prev.map(px => px.id === contextMenu.id ? { ...px, name } : px);
                                        console.log('[ProjectHome] Context rename state updated');
                                        return next;
                                    });
                                } catch (err) { console.error('[ProjectHome] Context rename exception', err); }
                                setContextMenu({ id: null, x: 0, y: 0, open: false });
                            }}>Rename</button>
                            <button style={styles.menuItem as any} onClick={() => { handleDuplicate(contextMenu.id); setContextMenu({ id: null, x: 0, y: 0, open: false }); }}>Duplicate</button>
                            <button style={styles.menuItem as any} onClick={() => { handleExport(contextMenu.id); setContextMenu({ id: null, x: 0, y: 0, open: false }); }}>Export</button>
                            <button style={styles.menuItem as any} onClick={() => { handleOpen(contextMenu.id); setContextMenu({ id: null, x: 0, y: 0, open: false }); }}>Open</button>
                            <button style={{ ...styles.menuItem, color: '#ff8a8a' } as any} onClick={() => { handleDelete(contextMenu.id); setContextMenu({ id: null, x: 0, y: 0, open: false }); }}>Delete</button>
                        </div>
                    </>
                )}
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
        gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
        gap: 18,
        paddingRight: 8,
    },
    card: {
        display: "flex",
        flexDirection: "column",
        borderRadius: 8,
        overflow: "visible",
        transition: "box-shadow 120ms ease",
    },
    thumb: {
        // height: 160,
        background: "#141821",
        borderRadius: 8,
        overflow: "hidden",
        transition: "transform 120ms ease, box-shadow 120ms ease, outline 120ms ease",
        // Maintain 16:9 with aspect-ratio where supported and padding-top fallback
        aspectRatio: '16 / 9' as any,
        width: '100%',
        position: 'relative',
        height: 'auto',
        paddingTop: '56.25%',
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
        width: 180,
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
    cmOverlay: {
        position: 'fixed',
        inset: 0,
        background: 'transparent',
        zIndex: 999,
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


