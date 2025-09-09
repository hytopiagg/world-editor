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
    const [cardsVisible, setCardsVisible] = useState(false);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [dragSelecting, setDragSelecting] = useState(false);
    const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
    const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
    const [pressedCardId, setPressedCardId] = useState<string | null>(null);

    // Shared project actions menu (used by inline and right-click menus)
    const ProjectActionsMenu = ({ id }: { id: string }) => (
        <>
            <button style={styles.menuItem as any} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#141a22'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }} onClick={async () => {
                const raw = window.prompt('Rename project');
                if (raw === null) return;
                const name = (raw || '').trim();
                if (!name) return;
                console.log('[ProjectHome] Rename start', { id, next: name });
                try {
                    const db = await (DatabaseManager as any).getConnection();
                    await new Promise<void>((resolve) => {
                        const tx = db.transaction(STORES.PROJECTS, 'readwrite');
                        tx.onerror = (e) => console.warn('[ProjectHome] Rename TX error', (e as any)?.target?.error);
                        const store = tx.objectStore(STORES.PROJECTS);
                        const src = projects.find(pp => pp.id === id);
                        const next = { ...(src || {}), id, name, updatedAt: Date.now() };
                        const req = store.put(next, id);
                        req.onsuccess = () => { console.log('[ProjectHome] Rename DB success', { id, name }); resolve(); };
                        req.onerror = () => { console.warn('[ProjectHome] Rename DB error', req.error); resolve(); };
                    });
                    setProjects(prev => prev.map(px => px.id === id ? { ...px, name } : px));
                } catch (err) { console.error('[ProjectHome] Rename exception', err); }
                try { document.querySelectorAll('.ph-inline-menu').forEach((el) => ((el as HTMLElement).style.display = 'none')); } catch (_) { }
                setContextMenu({ id: null, x: 0, y: 0, open: false });
            }}>Rename</button>
            <button style={styles.menuItem as any} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#141a22'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }} onClick={() => { handleDuplicate(id); setContextMenu({ id: null, x: 0, y: 0, open: false }); }}>Duplicate</button>
            <button style={styles.menuItem as any} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#141a22'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }} onClick={() => { handleExport(id); setContextMenu({ id: null, x: 0, y: 0, open: false }); }}>Export</button>
            <button style={styles.menuItem as any} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#141a22'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }} onClick={() => { handleOpen(id); setContextMenu({ id: null, x: 0, y: 0, open: false }); }}>Open</button>
            <button style={{ ...styles.menuItem, color: '#ff8a8a' } as any} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#2b1a1a'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }} onClick={() => { handleDelete(id); setContextMenu({ id: null, x: 0, y: 0, open: false }); }}>Delete</button>
        </>
    );

    const animateMenuStagger = (menuEl: HTMLElement | null, perItemDelayMs = 75, baseDelayMs = 180) => {
        if (!menuEl) return;
        try {
            const items = Array.from(menuEl.querySelectorAll('button')) as HTMLElement[];
            items.forEach((btn, idx) => {
                btn.style.opacity = '0';
                btn.style.transform = 'translateY(6px)';
                btn.style.transition = 'opacity 220ms ease, transform 220ms ease, background-color 120ms ease';
                btn.style.transitionDelay = `${baseDelayMs + idx * perItemDelayMs}ms`;
            });
            requestAnimationFrame(() => {
                items.forEach((btn) => {
                    btn.style.opacity = '1';
                    btn.style.transform = 'translateY(0)';
                });
            });
        } catch (_) { }
    };

    const refresh = async () => {
        setLoading(true);
        setCardsVisible(false);
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
            setTimeout(() => setCardsVisible(true), 0);
        }
    };

    useEffect(() => {
        refresh();
    }, []);

    // Animate right-click context menu on open
    useEffect(() => {
        if (contextMenu.open) {
            const el = document.getElementById('ph-context-menu');
            if (el) {
                try {
                    el.style.opacity = '0';
                    el.style.transform = 'translateY(4px)';
                    el.style.transition = 'opacity 180ms ease, transform 180ms ease';
                    requestAnimationFrame(() => {
                        el.style.opacity = '1';
                        el.style.transform = 'translateY(0)';
                        animateMenuStagger(el, 75, 180);
                    });
                } catch (_) { }
            }
        }
    }, [contextMenu.open]);

    // Global outside click: close inline menus and clear hover when clicking away
    useEffect(() => {
        const onDocMouseDown = (e: MouseEvent) => {
            console.log('[PH] doc mousedown', { btn: e.button, menuOpen: contextMenu.open });
            const target = e.target as HTMLElement | null;
            const inInlineMenu = !!(target && target.closest('.ph-inline-menu'));
            const inContextMenu = !!(target && target.closest('#ph-context-menu'));
            const onTrigger = !!(target && target.closest('.ph-menu-trigger'));
            const onOverlay = !!(target && (target.closest as any) && (target.closest as any)('#ph-cm-overlay'));
            if (!inInlineMenu && !inContextMenu && !onTrigger) {
                try {
                    document.querySelectorAll('.ph-inline-menu').forEach((el) => {
                        (el as HTMLElement).style.display = 'none';
                    });
                } catch (_) { }
                // If a context menu is open, close it but keep selection on first outside click
                if (contextMenu.open) {
                    // If the click is on the overlay, let the overlay handler process selection and close the menu
                    if (onOverlay) {
                        console.log('[PH] overlay click detected in capture; deferring to overlay handler');
                        return; // do nothing here
                    }
                    console.log('[PH] closing menu only (keeping selection)');
                    setContextMenu({ id: null, x: 0, y: 0, open: false });
                } else {
                    console.log('[PH] clearing selection (no menu open)');
                    setContextMenu({ id: null, x: 0, y: 0, open: false });
                    setSelectedIds([]);
                    setHoveredId(null);
                }
            }
            // Do not clear selection when clicking inside menus
            const onCard = !!(target && target.closest('[data-pid]'));
            if (!onCard && !inInlineMenu && !inContextMenu && !onTrigger && !contextMenu.open) {
                setHoveredId(null);
                setSelectedIds([]);
            }
        };
        document.addEventListener('mousedown', onDocMouseDown, true);
        return () => document.removeEventListener('mousedown', onDocMouseDown, true);
    }, [contextMenu.open]);

    const beginDragSelect = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement | null;
        const inCard = !!(target && target.closest('[data-pid]'));
        const inMenu = !!(target && (target.closest('.ph-inline-menu') || target.closest('#ph-context-menu') || target.closest('.ph-menu-trigger')));
        // ignore inputs/buttons in header
        const tag = target?.tagName || '';
        if (inCard || inMenu || tag === 'INPUT' || tag === 'BUTTON' || tag === 'LABEL') return;
        setDragSelecting(true);
        const startX = e.clientX;
        const startY = e.clientY;
        setDragStart({ x: startX, y: startY });
        setSelectionRect({ x: startX, y: startY, w: 0, h: 0 });
        setSelectedIds([]);
        const onMove = (ev: MouseEvent) => {
            const sx = startX;
            const sy = startY;
            const cx = ev.clientX;
            const cy = ev.clientY;
            const x = Math.min(sx, cx);
            const y = Math.min(sy, cy);
            const w = Math.abs(cx - sx);
            const h = Math.abs(cy - sy);
            setSelectionRect({ x, y, w, h });
            // Update selection based on intersection
            try {
                const nodes = Array.from(document.querySelectorAll('[data-pid]')) as HTMLElement[];
                const newly: string[] = [];
                nodes.forEach((el) => {
                    const r = el.getBoundingClientRect();
                    const intersects = x < r.right && x + w > r.left && y < r.bottom && y + h > r.top;
                    if (intersects) {
                        const pid = el.getAttribute('data-pid');
                        if (pid) newly.push(pid);
                    }
                });
                setSelectedIds(Array.from(new Set(newly)));
            } catch (_) { }
        };
        const onUp = () => {
            setDragSelecting(false);
            setSelectionRect(null);
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('mouseup', onUp, true);
        };
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onUp, true);
    };

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
        try {
            await DatabaseManager.deleteProject(id);
            // Update local state without full reload/animation
            setProjects((prev) => prev.filter((p) => p.id !== id));
            setSelectedIds((prev) => prev.filter((pid) => pid !== id));
            if (contextMenu.id === id) setContextMenu({ id: null, x: 0, y: 0, open: false });
        } catch (e) {
            console.error("Delete failed", e);
        }
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
            // Restore original selection, update list locally (no re-animation)
            DatabaseManager.setCurrentProjectId(original);
            const now = Date.now();
            const lastOpened = (copy as any)?.lastOpenedAt ?? now;
            const newMeta = { ...(copy as any), thumbnailDataUrl: src.thumbnailDataUrl, updatedAt: now, lastOpenedAt: lastOpened } as any;
            setProjects((prev) => [newMeta, ...prev]);
            // Maintain selection on duplicate: select the new copy
            setSelectedIds([newId]);
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
                    <div style={styles.navItem}>
                        <svg viewBox="0 0 24 24" style={styles.navIconSvg as any}><path d="M3 10l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M9 20v-6h6v6" /></svg>
                        <span style={styles.navText}>Home</span>
                    </div>
                    <div style={styles.navItem}>
                        <svg viewBox="0 0 24 24" style={styles.navIconSvg as any}><path d="M3 7h18v12H3z" /><path d="M3 7l4-4h10l4 4" /></svg>
                        <span style={styles.navText}>My files</span>
                    </div>
                    <div style={styles.navItem}>
                        <svg viewBox="0 0 24 24" style={styles.navIconSvg as any}><rect x="4" y="4" width="7" height="7" /><rect x="13" y="4" width="7" height="7" /><rect x="4" y="13" width="7" height="7" /><rect x="13" y="13" width="7" height="7" /></svg>
                        <span style={styles.navText}>Templates</span>
                    </div>
                    <div style={styles.navItem}>
                        <svg viewBox="0 0 24 24" style={styles.navIconSvg as any}><path d="M12 2l1.8 4.6L19 8l-4.2 2.2L13 15l-1-4.8L8 8l4-1.4z" /></svg>
                        <span style={styles.navText}>Generate</span>
                    </div>
                    <div style={styles.navItem}>
                        <svg viewBox="0 0 24 24" style={styles.navIconSvg as any}><circle cx="8" cy="8" r="3" /><circle cx="16" cy="8" r="3" /><path d="M2 20c1.5-3 4-5 6-5s4.5 2 6 5" /></svg>
                        <span style={styles.navText}>Shared with me</span>
                    </div>
                    <div style={styles.navItem}>
                        <svg viewBox="0 0 24 24" style={styles.navIconSvg as any}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18" /></svg>
                        <span style={styles.navText}>Community</span>
                    </div>
                    <div style={styles.navItem}>
                        <svg viewBox="0 0 24 24" style={styles.navIconSvg as any}><path d="M4 5h16v14H4z" /><path d="M8 5v14" /></svg>
                        <span style={styles.navText}>Tutorials</span>
                    </div>
                    <div style={styles.navItem}>
                        <svg viewBox="0 0 24 24" style={styles.navIconSvg as any}><path d="M4 13h16l-3 6H7l-3-6z" /><path d="M7 13V5h10v8" /></svg>
                        <span style={styles.navText}>Inbox</span>
                    </div>
                </nav>
                <div style={styles.sidebarFooter}>
                    <a href="https://discord.gg/hytopia" target="_blank" rel="noreferrer" style={styles.socialDiscord as any}>
                        <svg viewBox="0 0 24 24" width="16" height="16" style={{ marginRight: 8, display: 'inline-block' }}>
                            <path fill="currentColor" d="M20.317 4.369a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.211.375-.444.864-.608 1.249-1.827-.274-3.65-.274-5.475 0-.164-.396-.405-.874-.617-1.249a.077.077 0 00-.079-.037 19.736 19.736 0 00-4.885 1.515.07.07 0 00-.032.027C.533 9.04-.32 13.579.099 18.061a.082.082 0 00.031.056c2.052 1.507 4.041 2.422 5.992 3.029a.077.077 0 00.084-.027c.461-.63.873-1.295 1.226-1.994a.076.076 0 00-.041-.105c-.652-.247-1.27-.549-1.862-.892a.077.077 0 01-.007-.127c.125-.094.25-.192.37-.291a.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.099.245.197.37.291a.077.077 0 01-.006.127 12.298 12.298 0 01-1.863.892.076.076 0 00-.04.106c.36.699.772 1.364 1.225 1.994a.077.077 0 00.084.027c1.961-.607 3.95-1.522 6.002-3.029a.077.077 0 00.031-.055c.5-5.177-.838-9.673-3.549-13.665a.061.061 0 00-.031-.028zM8.02 15.331c-1.183 0-2.155-1.085-2.155-2.419 0-1.333.955-2.419 2.155-2.419 1.21 0 2.173 1.095 2.155 2.419 0 1.334-.955 2.419-2.155 2.419zm7.963 0c-1.183 0-2.155-1.085-2.155-2.419 0-1.333.955-2.419 2.155-2.419 1.21 0 2.173 1.095 2.155 2.419 0 1.334-.945 2.419-2.155 2.419z" />
                        </svg>
                        <span>Join our Discord</span>
                    </a>
                    <a href="https://x.com/hytopiagg" target="_blank" rel="noreferrer" style={styles.socialX as any}>
                        <svg viewBox="0 0 300 271" width="16" height="16" style={{ marginRight: 8, display: 'inline-block' }}>
                            <path fill="currentColor" d="m236 0h46l-101 115 118 156h-92.6l-72.5-94.8-83 94.8h-46l107-123-113-148h94.9l65.5 86.6zm-16.1 244h25.5l-165-218h-27.4z" />
                        </svg>
                        <span>Follow us on X</span>
                    </a>
                </div>
            </aside>

            {/* Main area */}
            <main style={styles.main} onMouseDown={beginDragSelect}>
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
                                style={{
                                    ...styles.card,
                                    opacity: cardsVisible ? 1 : 0,
                                    transform: cardsVisible ? 'none' : 'translateY(6px)',
                                    transition: 'opacity 260ms ease, transform 260ms ease',
                                    transitionDelay: cardsVisible ? `${Math.min(filtered.indexOf(p), 10) * 35}ms` : '0ms',
                                }}
                                data-pid={p.id}
                                onClick={(ev) => {
                                    console.log('[PH] card click', { id: p.id, multi: ev.metaKey || ev.ctrlKey || ev.shiftKey });
                                    const multi = ev.metaKey || ev.ctrlKey || ev.shiftKey;
                                    if (multi) {
                                        setSelectedIds((prev) => prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id]);
                                    } else {
                                        setSelectedIds([p.id]);
                                    }
                                }}
                                onMouseDown={() => setPressedCardId(p.id)}
                                onMouseUp={() => setPressedCardId(null)}
                                onMouseLeave={() => setPressedCardId((cur) => (cur === p.id ? null : cur))}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    console.log('[PH] card right-click -> open context', { id: p.id });
                                    // Close any inline menus when global context menu opens
                                    try {
                                        document.querySelectorAll('.ph-inline-menu').forEach((el) => {
                                            (el as HTMLElement).style.display = 'none';
                                        });
                                    } catch (_) { }
                                    // Always reposition and open the menu at the new cursor location
                                    setSelectedIds((prev) => prev.includes(p.id) ? prev : [p.id]);
                                    setContextMenu({ id: p.id, x: e.clientX, y: e.clientY, open: false });
                                    requestAnimationFrame(() => setContextMenu({ id: p.id, x: e.clientX, y: e.clientY, open: true }));
                                }}
                            >
                                <div style={{ position: 'relative' }}>
                                    {/* Outer white ring with small gap (visible on hover or selected) */}
                                    {(hoveredId === p.id || selectedIds.includes(p.id) || pressedCardId === p.id) && (
                                        <div style={{ position: 'absolute', inset: '-6px', border: '2px solid rgba(255,255,255,0.95)', borderRadius: 10, pointerEvents: 'none', zIndex: 1 }} />
                                    )}
                                    <div
                                        style={{
                                            ...styles.thumb,
                                            boxShadow: (hoveredId === p.id || selectedIds.includes(p.id) || pressedCardId === p.id) ? '0 6px 16px rgba(0,0,0,0.35)' : 'none',
                                            outline: '1px solid transparent',
                                            outlineOffset: -1,
                                        }}
                                        onDoubleClick={() => handleOpen(p.id)}
                                    >
                                        {p.thumbnailDataUrl ? (
                                            <img
                                                className="object-cover absolute inset-0 w-full h-full transition-transform ease-in-out transform will-change-transform"
                                                alt="Project thumbnail"
                                                src={p.thumbnailDataUrl}
                                                style={{
                                                    transform: hoveredId === p.id ? 'scale(1.07)' : 'scale(1)',
                                                    transformOrigin: 'center center',
                                                }}
                                            />
                                        ) : (
                                            <div
                                                style={{
                                                    ...styles.placeholderThumb,
                                                    position: 'absolute',
                                                    inset: 0,
                                                    transform: hoveredId === p.id ? 'scale(1.07)' : 'scale(1)',
                                                    transition: 'transform 180ms ease',
                                                    transformOrigin: 'center center',
                                                    willChange: 'transform',
                                                }}
                                            >
                                                No Thumbnail
                                            </div>
                                        )}
                                        {selectedIds.includes(p.id) && (
                                            <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.14)', pointerEvents: 'none' }} />
                                        )}
                                    </div>
                                </div>
                                <div style={styles.cardBody}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div style={{ textAlign: 'left' }}>
                                            <div style={styles.cardTitle}>{p.name || "Untitled"}</div>
                                            <div style={styles.metaRow}>{formatLastEdited(p.updatedAt || p.createdAt)}</div>
                                        </div>
                                        <div className="ph-menu" style={{ position: 'relative', transform: 'none', width: 28, height: 28, display: 'inline-block' }} onClick={(e) => e.stopPropagation()}>
                                            <button className="ph-menu-trigger"
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
                                                    setSelectedIds((prev) => prev.includes(p.id) ? prev : [p.id]);
                                                    const menu = btn.nextElementSibling as HTMLDivElement;
                                                    if (menu) {
                                                        const willShow = menu.style.display !== 'block';
                                                        menu.style.display = willShow ? 'block' : 'none';
                                                        if (willShow) {
                                                            menu.style.opacity = '0';
                                                            menu.style.transform = 'translateY(4px)';
                                                            menu.style.transition = 'opacity 180ms ease, transform 180ms ease';
                                                            requestAnimationFrame(() => {
                                                                menu.style.opacity = '1';
                                                                menu.style.transform = 'translateY(0)';
                                                                animateMenuStagger(menu, 75, 180);
                                                            });
                                                        }
                                                    }
                                                }}
                                                style={{ ...styles.ellipsisBtn, opacity: hoveredId === p.id ? 1 : 0, pointerEvents: hoveredId === p.id ? 'auto' : 'none' } as any}
                                            >
                                                ⋮
                                            </button>
                                            <div className="ph-inline-menu" style={styles.menu as any} onClick={(e) => e.stopPropagation()}>
                                                <ProjectActionsMenu id={p.id} />
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
                                    console.log('[PH] overlay left-click');
                                    try {
                                        const els = (document as any).elementsFromPoint ? (document as any).elementsFromPoint(e.clientX, e.clientY) : [];
                                        let pid: string | null = null;
                                        for (const el of els) {
                                            if (el && (el as any).getAttribute && (el as any).getAttribute('data-pid')) {
                                                pid = (el as any).getAttribute('data-pid');
                                                break;
                                            }
                                        }
                                        if (pid) {
                                            console.log('[PH] overlay select underlying', { pid });
                                            const multi = e.metaKey || e.ctrlKey || e.shiftKey;
                                            if (multi) {
                                                setSelectedIds((prev) => prev.includes(pid!) ? prev.filter((id) => id !== pid) : [...prev, pid!]);
                                            } else {
                                                setSelectedIds([pid]);
                                            }
                                        }
                                    } catch (_) { }
                                    setContextMenu({ id: null, x: 0, y: 0, open: false });
                                }
                            }}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                console.log('[PH] overlay right-click');
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
                                    setSelectedIds((prev) => prev.includes(pid!) ? prev : [pid!]);
                                    setContextMenu({ id: pid, x: e.clientX, y: e.clientY, open: true });
                                } else {
                                    setContextMenu({ id: null, x: 0, y: 0, open: false });
                                }
                            }}
                            id="ph-cm-overlay"
                            style={styles.cmOverlay as any}
                        />
                        <div id="ph-context-menu" style={{
                            ...styles.menu,
                            position: 'fixed',
                            left: Math.min(contextMenu.x, window.innerWidth - 180),
                            top: Math.min(contextMenu.y, window.innerHeight - 160),
                            display: 'block',
                            zIndex: 1000
                        } as any}>
                            <ProjectActionsMenu id={contextMenu.id as string} />
                        </div>
                    </>
                )}
                {/* Drag-select rectangle */}
                {dragSelecting && selectionRect && (
                    <div style={{
                        position: 'fixed',
                        left: `${selectionRect.x}px`,
                        top: `${selectionRect.y}px`,
                        width: `${selectionRect.w}px`,
                        height: `${selectionRect.h}px`,
                        background: 'rgba(43,106,255,0.15)',
                        border: '1px solid rgba(43,106,255,0.6)',
                        borderRadius: 2,
                        pointerEvents: 'none',
                        zIndex: 998
                    }} />
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
        color: "rgba(255,255,255,0.6)",
        background: "transparent",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 8,
    },
    navIconSvg: {
        width: 16,
        height: 16,
        stroke: 'rgba(255,255,255,0.6)',
        fill: 'none',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        flex: '0 0 auto',
    },
    navText: {
        color: 'rgba(255,255,255,0.6)',
    },
    sidebarFooter: {
        marginTop: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        opacity: 0.85,
    },
    socialDiscord: {
        display: 'flex',
        alignItems: 'center',
        color: '#cb6cf6',
        textDecoration: 'none',
        fontSize: 13,
    },
    socialX: {
        display: 'flex',
        alignItems: 'center',
        color: '#1DA1F2',
        textDecoration: 'none',
        fontSize: 13,
    },
    main: {
        display: "flex",
        flexDirection: "column",
        padding: 16,
        gap: 16,
        userSelect: 'none',
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
        position: 'relative',
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


