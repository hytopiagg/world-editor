import React, { useEffect, useState } from "react";
import { DatabaseManager } from "../managers/DatabaseManager";
import ProjectActionsMenu from "./ProjectActionsMenu";
import ProjectGridCard from "./ProjectGridCard";
import ProjectSidebar from "./ProjectSidebar";
import ProjectHeader from "./ProjectHeader";
import { useProjectSelection } from "./useProjectSelection";
import ProjectListCard from "./ProjectListCard";

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
    const [newName] = useState("");
    const [query, setQuery] = useState("");
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<{ id: string | null; x: number; y: number; open: boolean }>({ id: null, x: 0, y: 0, open: false });
    const { selectedIds, setSelectedIds, selectByIndex, clearSelection } = useProjectSelection();
    const [dragSelecting, setDragSelecting] = useState(false);
    const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
    const [pressedCardId, setPressedCardId] = useState<string | null>(null);
    const [activeNav, setActiveNav] = useState<string>("my-files");
    const [hoverNav, setHoverNav] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    // inline menu state is now self-contained in card components

    // Using shared ProjectActionsMenu component

    // ProjectActionsMenu animates itself on mount
    useEffect(() => { }, [contextMenu.open]);

    // Global outside click: close inline menus and clear hover when clicking away
    useEffect(() => {
        const onDocMouseDown = (e: MouseEvent) => {
            console.log('[PH] doc mousedown', { btn: e.button, menuOpen: contextMenu.open });
            const target = e.target as HTMLElement | null;
            const inInlineMenu = !!(target && target.closest('.ph-inline-menu'));
            const inContextMenu = !!(target && target.closest('#ph-context-menu'));
            const onTrigger = !!(target && target.closest('.ph-menu-trigger'));
            const onOverlay = !!(target && (target.closest as any) && (target.closest as any)('#ph-cm-overlay'));
            const onCard = !!(target && target.closest('[data-pid]'));
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
                    if (!onCard) {
                        console.log('[PH] clearing selection (no menu open)');
                        setContextMenu({ id: null, x: 0, y: 0, open: false });
                        clearSelection();
                    }
                }
            }
            // Do not clear selection when clicking inside menus
            if (!onCard && !inInlineMenu && !inContextMenu && !onTrigger && !contextMenu.open) {
                setHoveredId(null);
                clearSelection();
            }
        };
        document.addEventListener('mousedown', onDocMouseDown, true);
        return () => document.removeEventListener('mousedown', onDocMouseDown, true);
    }, [contextMenu.open, clearSelection]);

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
            try {
                const now = Date.now();
                const metaObj = {
                    id: pid,
                    name: (data?.meta?.name || newName || "Imported Project"),
                    createdAt: (created as any)?.createdAt || now,
                    updatedAt: now,
                    lastOpenedAt: now,
                    thumbnailDataUrl: data?.meta?.thumbnailDataUrl,
                } as any;
                setProjects((prev) => [metaObj, ...prev]);
            } catch (_) { }
            onOpen(pid);
        } catch (e) {
            console.error("Import failed", e);
        }
    };

    const filtered = projects.filter(
        (p) => !query || (p.name || "").toLowerCase().includes(query.toLowerCase())
    );

    const refresh = async () => {
        setLoading(true);
        try {
            try { await (DatabaseManager as any).getDBConnection?.(); } catch (_) { }
            console.log('[ProjectHome] refresh -> fetching projects');
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
            console.log('[ProjectHome] refresh -> projects loaded', (list || []).length);
        } catch (e) {
            setProjects([]);
            console.warn('[ProjectHome] refresh error', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refresh();
    }, []);

    return (
        <div className="fixed inset-0 grid [grid-template-columns:280px_1fr] bg-[#0b0e12] text-[#eaeaea]">
            {/* Sidebar */}
            <ProjectSidebar activeNav={activeNav} setActiveNav={setActiveNav} hoverNav={hoverNav} setHoverNav={setHoverNav} />

            {/* Main area */}
            <main className="flex flex-col gap-4 p-5 select-none" onMouseDown={beginDragSelect}>
                <ProjectHeader
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                    query={query}
                    setQuery={setQuery}
                    onImport={handleImport}
                    onCreate={async () => {
                        const name = window.prompt("Project name", newName || "Untitled Project");
                        if (!name) return;
                        await handleCreate(name);
                    }}
                />

                {/* Content area */}
                {viewMode === 'grid' ? (
                    <div className="overflow-visible grid [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))] gap-[18px] pr-2 relative">
                        {loading ? (
                            <div style={{ opacity: 0.7 }}>Loading...</div>
                        ) : filtered.length === 0 ? (
                            <div style={{ opacity: 0.7 }}>No projects found.</div>
                        ) : (
                            filtered.map((p, index) => (
                                <ProjectGridCard
                                    key={p.id}
                                    project={p as any}
                                    index={index}
                                    selected={selectedIds.includes(p.id)}
                                    hoveredId={hoveredId}
                                    setHoveredId={setHoveredId}
                                    pressedCardId={pressedCardId}
                                    setPressedCardId={setPressedCardId}
                                    onSelect={(id, idx, ev) => selectByIndex(filtered.map(pp => pp.id), idx, ev)}
                                    onOpen={handleOpen}
                                    projects={projects as any}
                                    setProjects={setProjects as any}
                                    setContextMenu={setContextMenu as any}
                                />
                            ))
                        )}
                    </div>
                ) : (
                    <div className="grid [grid-template-columns:repeat(auto-fill,minmax(360px,1fr))] gap-[14px] pr-2 relative">
                        {loading ? (
                            <div style={{ opacity: 0.7 }}>Loading...</div>
                        ) : filtered.length === 0 ? (
                            <div style={{ opacity: 0.7 }}>No projects found.</div>
                        ) : (
                            filtered.map((p, index) => (
                                <ProjectListCard
                                    key={p.id}
                                    project={p}
                                    index={index}
                                    selected={selectedIds.includes(p.id)}
                                    hoveredId={hoveredId}
                                    setHoveredId={setHoveredId}
                                    onSelect={(id, idx, ev) => selectByIndex(filtered.map(pp => pp.id), idx, ev)}
                                    onOpen={handleOpen}
                                    projects={projects as any}
                                    setProjects={setProjects as any}
                                    setContextMenu={setContextMenu as any}
                                />
                            ))
                        )}
                    </div>
                )}
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
                                            const idx = filtered.findIndex(pp => pp.id === pid);
                                            selectByIndex(filtered.map(pp => pp.id), idx, e as any);
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
                            className="fixed inset-0 bg-transparent z-[999]"
                        />
                        <div id="ph-context-menu" className="fixed bg-[#0e131a] border border-[#1a1f29] rounded-lg overflow-hidden z-[1000] w-[180px]" style={{
                            left: Math.min(contextMenu.x, window.innerWidth - 180),
                            top: Math.min(contextMenu.y, window.innerHeight - 160)
                        } as any}>
                            <ProjectActionsMenu id={contextMenu.id as string} projects={projects as any} setProjects={setProjects as any} setContextMenu={setContextMenu as any} onOpen={onOpen} onRequestClose={() => setContextMenu({ id: null, x: 0, y: 0, open: false })} />
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


