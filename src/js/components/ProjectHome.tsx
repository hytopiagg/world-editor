import React, { useEffect, useState } from "react";
import { DatabaseManager } from "../managers/DatabaseManager";
import ProjectActionsMenu from "./ProjectActionsMenu";
import ProjectGridCard from "./ProjectGridCard";
import ProjectSidebar from "./ProjectSidebar";
import ProjectHeader from "./ProjectHeader";
import { useProjectSelection } from "./useProjectSelection";
import ProjectListCard from "./ProjectListCard";
import { DatabaseManager as DB } from "../managers/DatabaseManager";
import ProjectFolderCard from "./ProjectFolderCard";

type Project = {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    lastOpenedAt?: number;
    description?: string;
    thumbnailDataUrl?: string;
    type?: string;
    folderId?: string | null;
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
    const [activeNav, setActiveNav] = useState<string>(() => {
        try {
            const hash = window.location.hash.replace('#', '') || 'my-files';
            return hash;
        } catch (_) { return 'my-files'; }
    });
    const [hoverNav, setHoverNav] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    // inline menu state is now self-contained in card components
    const [folders, setFolders] = useState<any[]>([]);
    const [activeFolderId, setActiveFolderId] = useState<string | null>(null);

    // Using shared ProjectActionsMenu component

    // ProjectActionsMenu animates itself on mount
    useEffect(() => { }, [contextMenu.open]);

    // Global outside click: close inline menus and clear hover when clicking away
    useEffect(() => {
        const onDocMouseDown = (e: MouseEvent) => {
            console.log('[PH] doc mousedown', { btn: e.button, menuOpen: contextMenu.open });
            const target = e.target as HTMLElement | null;
            const inInlineMenu = !!(target && (target as any).closest && (target as any).closest('.ph-inline-menu'));
            const inContextMenu = !!(target && (target as any).closest && (target as any).closest('.ph-context-menu'));
            const inModal = !!(target && (target as any).closest && (target as any).closest('.ph-modal-panel'));
            const onTrigger = !!(target && target.closest('.ph-menu-trigger'));
            const onOverlay = !!(target && (target.closest as any) && (target.closest as any)('#ph-cm-overlay'));
            const onCard = !!(target && (target.closest && (target.closest('[data-pid]') || target.closest('[data-fid]'))));
            if (!inInlineMenu && !inContextMenu && !onTrigger && !inModal) {
                try { window.dispatchEvent(new Event('ph-close-inline-menus')); } catch (_) { }
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
            if (!onCard && !inInlineMenu && !inContextMenu && !onTrigger && !inModal && !contextMenu.open) {
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
        const inCard = !!(target && (target.closest('[data-pid]') || target.closest('[data-fid]')));
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
            const all = Array.isArray(list) ? list.map((p: any) => ({ ...p })) : [];
            setFolders(all.filter((p: any) => p.type === 'folder'));
            setProjects(
                all
                    .filter((p: any) => p.type !== 'folder')
                    .sort((a: any, b: any) => (b.lastOpenedAt || b.updatedAt || 0) - (a.lastOpenedAt || a.updatedAt || 0))
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
    useEffect(() => {
        try { window.location.hash = activeNav || 'my-files'; } catch (_) { }
    }, [activeNav]);

    useEffect(() => {
        try { (window as any).__PH_SELECTED__ = selectedIds || []; } catch (_) { }
    }, [selectedIds]);

    const titleForNav = () => {
        if (activeFolderId) return folders.find((f) => f.id === activeFolderId)?.name || 'Folder';
        // Match sidebar labels exactly
        switch (activeNav) {
            case 'home': return 'Home';
            case 'my-files': return 'My files';
            case 'templates': return 'Templates';
            case 'generate': return 'Generate';
            case 'shared': return 'Shared with me';
            case 'community': return 'Community';
            case 'tutorials': return 'Tutorials';
            case 'changelog': return 'Changelog';
            default: return activeNav.replace('-', ' ');
        }
    };

    return (
        <div className="fixed inset-0 grid [grid-template-columns:280px_1fr] bg-[#0b0e12] text-[#eaeaea]">
            {/* Sidebar */}
            <ProjectSidebar activeNav={activeNav} setActiveNav={setActiveNav} hoverNav={hoverNav} setHoverNav={setHoverNav} />

            {/* Main area */}
            <main className="flex flex-col p-5 gap-4 select-none" onMouseDown={beginDragSelect}
                onContextMenu={(e) => {
                    // Capture right-clicks at main level as a fallback to ensure consistency
                    const target = e.target as HTMLElement;
                    const inCard = !!(target && target.closest && (target.closest('[data-pid]') || target.closest('[data-fid]')));
                    const inMenu = !!(target && target.closest && target.closest('.ph-context-menu'));
                    if (inCard || inMenu) return; // let card/menu handlers manage
                    e.preventDefault();
                    console.log('[PH] main onContextMenu fallback -> open root menu');
                    try { window.dispatchEvent(new Event('ph-close-inline-menus')); } catch (_) { }
                    setSelectedIds([]);
                    setContextMenu({ id: '__ROOT__', x: e.clientX, y: e.clientY, open: true });
                }}
            >
                <ProjectHeader
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                    query={query}
                    setQuery={setQuery}
                    onImport={handleImport}
                    onCreateFolder={async () => {
                        if (activeNav !== 'my-files' || activeFolderId) return; // Only show on My files root
                        const raw = window.prompt('Folder name');
                        if (raw === null) return;
                        const name = (raw || '').trim() || 'New Folder';
                        const folder = await DB.createFolder(name);
                        if (folder) setFolders((prev) => [folder, ...prev]);
                    }}
                    onCreate={async () => {
                        const name = window.prompt("Project name", newName || "Untitled Project");
                        if (!name) return;
                        await handleCreate(name);
                    }}
                    title={titleForNav()}
                    breadcrumbs={activeFolderId ? [{ label: 'My files', onClick: () => setActiveFolderId(null) }, { label: folders.find((f) => f.id === activeFolderId)?.name || 'Folder' }] : []}
                    showNewFolder={activeNav === 'my-files' && !activeFolderId}
                />

                {/* Content area */}
                {activeNav === 'my-files' && (viewMode === 'grid' ? (
                    <div
                        className="overflow-visible grid [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))] gap-[18px] pr-2 relative"
                        onDragOver={(e) => { e.preventDefault(); try { e.dataTransfer!.dropEffect = 'move'; } catch (_) { } }}
                        onDrop={async (e) => {
                            try {
                                const json = e.dataTransfer?.getData('application/x-project-ids');
                                const ids = json ? JSON.parse(json) : [];
                                console.log('[PH] drop on root', ids);
                                if (Array.isArray(ids) && ids.length > 0) {
                                    for (const id of ids) await DB.updateProjectFolder(id, null);
                                    setProjects((prev) => prev.map((p) => ids.includes(p.id) ? { ...p, folderId: null } : p));
                                }
                            } catch (err) { console.warn('[PH] root drop error', err); }
                        }}
                    >
                        {/* Folders */}
                        {!activeFolderId && folders.map((f) => (
                            <ProjectFolderCard
                                key={f.id}
                                folder={f}
                                onOpenFolder={(fid) => setActiveFolderId(fid)}
                                setContextMenu={setContextMenu}
                                onDropProjects={async (folderId, ids) => {
                                    console.log('[PH] drop into folder', folderId, ids);
                                    for (const id of ids) await DB.updateProjectFolder(id, folderId);
                                    setProjects((prev) => prev.map((p) => ids.includes(p.id) ? { ...p, folderId } : p));
                                }}
                                projects={[...folders as any, ...projects as any] as any}
                                setProjects={(updater: any) => setFolders((prev) => updater(prev as any))}
                                selected={false}
                                onSelect={() => { }}
                            />
                        ))}
                        {loading ? (
                            <div style={{ opacity: 0.7 }}>Loading...</div>
                        ) : filtered.length === 0 ? (
                            <div style={{ opacity: 0.7 }}>No projects found.</div>
                        ) : (
                            filtered
                                .filter((p) => !activeFolderId || p.folderId === activeFolderId)
                                .map((p, index) => (
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
                                        projects={[...folders as any, ...projects as any] as any}
                                        setProjects={(updater: any) => setProjects((prev) => typeof updater === 'function' ? updater(prev) : updater)}
                                        setContextMenu={setContextMenu as any}
                                    />
                                ))
                        )}
                    </div>
                ) : (
                    <div className="grid [grid-template-columns:repeat(auto-fill,minmax(360px,1fr))] gap-[14px] pr-2 relative"
                        onDragOver={(e) => { e.preventDefault(); try { e.dataTransfer!.dropEffect = 'move'; } catch (_) { } }}
                        onDrop={async (e) => {
                            try {
                                const json = e.dataTransfer?.getData('application/x-project-ids');
                                const ids = json ? JSON.parse(json) : [];
                                console.log('[PH] drop on root (list)', ids);
                                if (Array.isArray(ids) && ids.length > 0) {
                                    for (const id of ids) await DB.updateProjectFolder(id, null);
                                    setProjects((prev) => prev.map((p) => ids.includes(p.id) ? { ...p, folderId: null } : p));
                                }
                            } catch (err) { console.warn('[PH] root drop error', err); }
                        }}
                    >
                        {loading ? (
                            <div style={{ opacity: 0.7 }}>Loading...</div>
                        ) : filtered.length === 0 ? (
                            <div style={{ opacity: 0.7 }}>No projects found.</div>
                        ) : (
                            filtered
                                .filter((p) => !activeFolderId || p.folderId === activeFolderId)
                                .map((p, index) => (
                                    <ProjectListCard
                                        key={p.id}
                                        project={p}
                                        index={index}
                                        selected={selectedIds.includes(p.id)}
                                        hoveredId={hoveredId}
                                        setHoveredId={setHoveredId}
                                        onSelect={(id, idx, ev) => selectByIndex(filtered.map(pp => pp.id), idx, ev)}
                                        onOpen={handleOpen}
                                        projects={[...folders as any, ...projects as any] as any}
                                        setProjects={(updater: any) => setProjects((prev) => typeof updater === 'function' ? updater(prev) : updater)}
                                        setContextMenu={setContextMenu as any}
                                    />
                                ))
                        )}
                    </div>
                ))}
                {/* Global context menu (right-click) */}
                {contextMenu.open && contextMenu.id && (
                    <>
                        <div
                            onMouseDown={(e) => {
                                // Close on left-click; allow right-click to reposition
                                if (e.button === 0) {
                                    console.log('[PH] overlay left-click');
                                    try {
                                        // If click is within an open context menu, ignore and let the menu handle it
                                        const el = e.target as HTMLElement;
                                        const inMenu = !!(el && (el.closest && el.closest('.ph-context-menu')));
                                        if (inMenu) return;
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
                                    if (el && (el as any).getAttribute && (el as any).getAttribute('data-pid')) {
                                        pid = (el as any).getAttribute('data-pid');
                                        break;
                                    }
                                }
                                if (pid) {
                                    // Close inline menus globally before opening context menu
                                    try { window.dispatchEvent(new Event('ph-close-inline-menus')); } catch (_) { }
                                    // Open immediately at new location
                                    setSelectedIds((prev) => prev.includes(pid!) ? prev : [pid!]);
                                    setContextMenu({ id: pid, x: e.clientX, y: e.clientY, open: true });
                                } else {
                                    // Blank area: open root context menu (no selection)
                                    try { window.dispatchEvent(new Event('ph-close-inline-menus')); } catch (_) { }
                                    setSelectedIds([]);
                                    setContextMenu({ id: '__ROOT__', x: e.clientX, y: e.clientY, open: true });
                                }
                            }}
                            id="ph-cm-overlay"
                            className="fixed inset-0 bg-transparent z-[999]"
                        />
                        <ProjectActionsMenu
                            variant="context"
                            x={contextMenu.x}
                            y={contextMenu.y}
                            id={contextMenu.id as string}
                            projects={[...folders as any, ...projects as any] as any}
                            setProjects={(updater: any) => {
                                // If folder was renamed/deleted, update folders list too
                                if (contextMenu.id && contextMenu.id !== '__ROOT__' && folders.find((f) => f.id === contextMenu.id)) {
                                    setFolders((prev) => typeof updater === 'function' ? updater(prev as any) : updater);
                                } else {
                                    setProjects((prev) => typeof updater === 'function' ? updater(prev) : updater);
                                }
                            }}
                            setContextMenu={setContextMenu as any}
                            onOpen={onOpen}
                            onRequestClose={() => setContextMenu({ id: null, x: 0, y: 0, open: false })}
                            containerClassName=""
                            entityType={contextMenu.id === '__ROOT__' ? 'root' : (folders.find((f) => f.id === contextMenu.id) ? 'folder' : 'project')}
                            onOpenFolder={(fid) => setActiveFolderId(fid)}
                            folders={folders as any}
                        />
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


