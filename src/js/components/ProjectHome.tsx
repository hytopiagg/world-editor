import React, { useEffect, useState } from "react";
import { DatabaseManager, MigrationStatus } from "../managers/DatabaseManager";
import ProjectActionsMenu from "./ProjectActionsMenu";
import ProjectGridCard from "./ProjectGridCard";
import ProjectSidebar from "./ProjectSidebar";
import ProjectHeader from "./ProjectHeader";
import { useProjectSelection } from "./useProjectSelection";
import ProjectListCard from "./ProjectListCard";
import { DatabaseManager as DB } from "../managers/DatabaseManager";
import ProjectFolderCard from "./ProjectFolderCard";
import ModalContainer from "./ModalContainer";
import ParticleViewerPage from "./ParticleViewerPage";
import ScreenshotGalleryPage from "./ScreenshotGalleryPage";

// Migration overlay component
const MigrationOverlay: React.FC<{ status: MigrationStatus }> = ({ status }) => {
    const progressPercent = status.totalItems > 0 
        ? Math.round((status.itemsProcessed / status.totalItems) * 100)
        : 0;
    
    const overallProgress = status.totalStores > 0
        ? Math.round(((status.currentStoreIndex - 1) / status.totalStores) * 100 + (progressPercent / status.totalStores))
        : 0;
    
    return (
        <div className="fixed inset-0 z-[9999] bg-[#0b0e12] flex flex-col items-center justify-center text-white">
            {/* Animated background */}
            <div className="absolute inset-0 overflow-hidden opacity-20">
                <div className="absolute w-[500px] h-[500px] bg-gradient-to-r from-blue-500 to-purple-600 rounded-full blur-[120px] animate-pulse" 
                     style={{ top: '20%', left: '10%' }} />
                <div className="absolute w-[400px] h-[400px] bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full blur-[100px] animate-pulse" 
                     style={{ top: '50%', right: '15%', animationDelay: '1s' }} />
            </div>
            
            <div className="relative z-10 flex flex-col items-center gap-6 max-w-lg px-8">
                {/* Logo/Icon */}
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mb-2">
                    <svg className="w-8 h-8 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                </div>
                
                {/* Title */}
                <h1 className="text-2xl font-semibold text-center">
                    Upgrading Your Projects
                </h1>
                
                {/* Description */}
                <p className="text-white/60 text-center text-sm">
                    We're migrating your data to a new format. This only happens once and may take a few minutes for large projects.
                </p>
                
                {/* Progress container */}
                <div className="w-full flex flex-col gap-4 mt-4">
                    {/* Overall progress bar */}
                    <div className="w-full">
                        <div className="flex justify-between text-xs text-white/50 mb-2">
                            <span>Overall Progress</span>
                            <span>{overallProgress}%</span>
                        </div>
                        <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300 ease-out rounded-full"
                                style={{ width: `${overallProgress}%` }}
                            />
                        </div>
                    </div>
                    
                    {/* Current store progress */}
                    {status.currentStore && (
                        <div className="w-full">
                            <div className="flex justify-between text-xs text-white/50 mb-2">
                                <span className="truncate max-w-[200px]">{status.currentStore}</span>
                                <span>
                                    {status.itemsProcessed.toLocaleString()} / {status.totalItems.toLocaleString()}
                                </span>
                            </div>
                            <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-blue-400 transition-all duration-150 ease-out rounded-full"
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>
                        </div>
                    )}
                </div>
                
                {/* Status message */}
                <p className="text-white/40 text-xs text-center mt-2 min-h-[20px]">
                    {status.message}
                </p>
                
                {/* Store counter */}
                {status.totalStores > 0 && status.currentStore && (
                    <div className="flex flex-col items-center gap-1 text-xs text-white/30">
                        <span>Migrating store {status.currentStoreIndex} of {status.totalStores}</span>
                        <span className="text-white/50 font-medium">{status.currentStore}</span>
                    </div>
                )}
                
                {/* Warning */}
                <p className="text-amber-400/70 text-xs text-center mt-4">
                    ⚠️ Please don't close this tab until migration is complete
                </p>
            </div>
        </div>
    );
};

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

interface InputModalProps {
    isOpen: boolean;
    title: string;
    placeholder?: string;
    defaultValue?: string;
    onCancel: () => void;
    onConfirm: (value: string) => void;
}

const InputModal: React.FC<InputModalProps> = ({ isOpen, title, placeholder = "", defaultValue = "", onCancel, onConfirm }) => {
    const [value, setValue] = useState(defaultValue);
    useEffect(() => { if (isOpen) setValue(defaultValue); }, [isOpen, defaultValue]);
    
    if (!isOpen) return null;
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = (value || '').trim();
        if (trimmed) {
            onConfirm(trimmed);
        }
    };
    
    return (
        <ModalContainer isOpen={isOpen} onClose={onCancel} title={title} className="min-w-[480px]">
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <input 
                    value={value} 
                    onChange={(e) => setValue(e.target.value)} 
                    className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none" 
                    placeholder={placeholder}
                    autoFocus
                />
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={onCancel} className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15">Cancel</button>
                    <button type="submit" className="px-3 py-2 rounded-xl bg-[#2b6aff] hover:bg-[#2560e6] text-white">Create</button>
                </div>
            </form>
        </ModalContainer>
    );
};

const TEMPLATES = [
    {
        id: "city",
        name: "City",
        description: "A detailed city environment with buildings and streets.",
        thumbnail: "./assets/template-maps/city.jpg",
        mapUrl: "./assets/template-maps/city.json",
    },
];

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

    // Migration status tracking
    const [migrationStatus, setMigrationStatus] = useState<MigrationStatus | null>(null);

    // Loading states for project operations
    const [loadingProjects, setLoadingProjects] = useState<Record<string, string>>({});

    const handleCreateFromTemplate = async (template: typeof TEMPLATES[number], projectName: string) => {
        try {
            const meta = await DatabaseManager.createProject(projectName);
            if (!meta || !meta.id) return;
            sessionStorage.setItem("pendingTemplateImport", template.mapUrl);
            await DatabaseManager.touchProject(meta.id);
            onOpen(meta.id);
        } catch (error) {
            console.error("Error creating project from template:", error);
            alert("Failed to create project from template. Please try again.");
        }
    };
    
    useEffect(() => {
        // Check initial migration status
        if (DatabaseManager.migrationStatus.inProgress) {
            setMigrationStatus({ ...DatabaseManager.migrationStatus });
        }
        
        // Listen for migration progress events
        const handleMigrationProgress = (e: CustomEvent<MigrationStatus>) => {
            if (e.detail.inProgress) {
                setMigrationStatus({ ...e.detail });
            } else {
                // Migration complete, clear status after a short delay and refresh projects
                setTimeout(() => {
                    setMigrationStatus(null);
                    refresh(); // Refresh projects list after migration
                }, 500);
            }
        };
        
        window.addEventListener("db-migration-progress", handleMigrationProgress as EventListener);
        return () => window.removeEventListener("db-migration-progress", handleMigrationProgress as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Listen for hash changes
    useEffect(() => {
        const handleHashChange = () => {
            try {
                const hash = window.location.hash.replace('#', '') || 'my-files';
                setActiveNav(hash);
            } catch (_) {
                setActiveNav('my-files');
            }
        };
        window.addEventListener('hashchange', handleHashChange);
        return () => window.removeEventListener('hashchange', handleHashChange);
    }, []);
    const [hoverNav, setHoverNav] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    // inline menu state is now self-contained in card components
    const [folders, setFolders] = useState<any[]>([]);
    const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
    const [inputModal, setInputModal] = useState<{ open: boolean; type: 'project' | 'folder'; defaultValue?: string; onConfirm: (name: string) => void }>({ open: false, type: 'project', onConfirm: () => {} });

    // Using shared ProjectActionsMenu component

    // ProjectActionsMenu animates itself on mount
    useEffect(() => { }, [contextMenu.open]);

    // Global outside click: close inline menus and clear hover when clicking away
    useEffect(() => {
        const onDocMouseDown = (e: MouseEvent) => {
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
                        return; // do nothing here
                    }
                    setContextMenu({ id: null, x: 0, y: 0, open: false });
                } else {
                    if (!onCard) {
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

    // Apply name filter first, then root/folder filtering at render time.
    const filtered = projects.filter((p) => !query || (p.name || "").toLowerCase().includes(query.toLowerCase()));

    const refresh = async () => {
        // Don't refresh while migration is in progress
        if (DatabaseManager.isMigrating()) {
            return;
        }
        
        setLoading(true);
        try {
            try { await (DatabaseManager as any).getDBConnection?.(); } catch (_) { }
            
            // Double check migration isn't happening after DB connection
            if (DatabaseManager.isMigrating()) {
                setLoading(false);
                return;
            }
            
            const list = await DatabaseManager.listProjects();
            const all = Array.isArray(list) ? list.map((p: any) => ({ ...p })) : [];
            setFolders(all.filter((p: any) => p.type === 'folder'));
            setProjects(
                all
                    .filter((p: any) => p.type !== 'folder')
                    .sort((a: any, b: any) => (b.lastOpenedAt || b.updatedAt || 0) - (a.lastOpenedAt || a.updatedAt || 0))
            );
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

    // Handle screenshots route - must be after all hooks
    if (activeNav === 'screenshots') {
        return <ScreenshotGalleryPage />;
    }

    // Handle particle-viewer route - must be after all hooks
    if (activeNav === 'particle-viewer') {
        return <ParticleViewerPage />;
    }

    const titleForNav = () => {
        if (activeFolderId) return folders.find((f) => f.id === activeFolderId)?.name || 'Folder';
        // Match sidebar labels exactly
        switch (activeNav) {
            case 'home': return 'Home';
            case 'my-files': return 'My files';
            case 'templates': return 'Templates';
            case 'tutorials': return 'Tutorials';
            default: return activeNav.replace('-', ' ');
        }
    };

    // Show migration overlay if migration is in progress
    if (migrationStatus?.inProgress) {
        return <MigrationOverlay status={migrationStatus} />;
    }
    
    return (
        <div className="fixed inset-0 grid [grid-template-columns:280px_1fr] bg-[#0b0e12] text-[#eaeaea]">
            {/* Sidebar */}
            <ProjectSidebar activeNav={activeNav} setActiveNav={setActiveNav} hoverNav={hoverNav} setHoverNav={setHoverNav} />

            {/* Main area */}
            <main className="flex flex-col p-5 gap-4 select-none overflow-y-auto" onMouseDown={beginDragSelect}
                onContextMenu={(e) => {
                    // Capture right-clicks at main level as a fallback to ensure consistency
                    const target = e.target as HTMLElement;
                    const inCard = !!(target && target.closest && (target.closest('[data-pid]') || target.closest('[data-fid]')));
                    const inMenu = !!(target && target.closest && target.closest('.ph-context-menu'));
                    if (inCard || inMenu) return; // let card/menu handlers manage
                    e.preventDefault();
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
                    onCreateFolder={async () => {
                        if (activeNav !== 'my-files' || activeFolderId) return; // Only show on My files root
                        setInputModal({
                            open: true,
                            type: 'folder',
                            onConfirm: async (name: string) => {
                                const folder = await DB.createFolder(name || 'New Folder');
                                if (folder) setFolders((prev) => [folder, ...prev]);
                                setInputModal({ open: false, type: 'folder', onConfirm: () => {} });
                            }
                        });
                    }}
                    onCreate={async () => {
                        setInputModal({
                            open: true,
                            type: 'project',
                            onConfirm: async (name: string) => {
                                await handleCreate(name);
                                setInputModal({ open: false, type: 'project', onConfirm: () => {} });
                            }
                        });
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
                                    for (const id of ids) await DB.updateProjectFolder(id, folderId);
                                    setProjects((prev) => prev.map((p) => ids.includes(p.id) ? { ...p, folderId } : p));
                                }}
                                projects={[...folders as any, ...projects as any] as any}
                                setProjects={(updater: any) => setFolders((prev) => updater(prev as any))}
                                selected={false}
                                onSelect={() => { }}
                                hoveredId={hoveredId}
                                setHoveredId={setHoveredId}
                                pressedCardId={pressedCardId}
                                setPressedCardId={setPressedCardId}
                            />
                        ))}
                        {loading ? (
                            <div style={{ opacity: 0.7 }}>Loading...</div>
                        ) : (filtered.filter((p) => !activeFolderId ? (p.folderId == null) : (p.folderId === activeFolderId)).length === 0 && (!activeFolderId ? folders.length === 0 : true)) ? (
                            <div style={{ opacity: 0.7 }}>No projects found.</div>
                        ) : (
                            filtered
                                .filter((p) => !activeFolderId ? (p.folderId == null) : (p.folderId === activeFolderId))
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
                                        onSelect={(id, idx, ev) => {
                                            let visibleIds: string[] = [];
                                            try {
                                                visibleIds = filtered
                                                    .filter((pp) => !activeFolderId ? (pp.folderId == null) : (pp.folderId === activeFolderId))
                                                    .map((pp) => pp.id);
                                            } catch (_) { }
                                            selectByIndex(visibleIds, idx, ev);
                                        }}
                                        onOpen={handleOpen}
                                        projects={[...folders as any, ...projects as any] as any}
                                        setProjects={(updater: any) => setProjects((prev) => typeof updater === 'function' ? updater(prev) : updater)}
                                        setContextMenu={setContextMenu as any}
                                        loadingState={loadingProjects[p.id]}
                                        setLoadingProjects={setLoadingProjects}
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
                                if (Array.isArray(ids) && ids.length > 0) {
                                    for (const id of ids) await DB.updateProjectFolder(id, null);
                                    setProjects((prev) => prev.map((p) => ids.includes(p.id) ? { ...p, folderId: null } : p));
                                }
                            } catch (err) { console.warn('[PH] root drop error', err); }
                        }}
                    >
                        {loading ? (
                            <div style={{ opacity: 0.7 }}>Loading...</div>
                        ) : filtered.filter((p) => !activeFolderId ? (p.folderId == null) : (p.folderId === activeFolderId)).length === 0 ? (
                            <div style={{ opacity: 0.7 }}>No projects found.</div>
                        ) : (
                            filtered
                                .filter((p) => !activeFolderId ? (p.folderId == null) : (p.folderId === activeFolderId))
                                .map((p, index) => (
                                    <ProjectListCard
                                        key={p.id}
                                        project={p}
                                        index={index}
                                        selected={selectedIds.includes(p.id)}
                                        hoveredId={hoveredId}
                                        setHoveredId={setHoveredId}
                                        onSelect={(id, idx, ev) => {
                                            const visibleIds = filtered
                                                .filter((pp) => !activeFolderId ? (pp.folderId == null) : (pp.folderId === activeFolderId))
                                                .map((pp) => pp.id);
                                            selectByIndex(visibleIds, idx, ev);
                                        }}
                                        onOpen={handleOpen}
                                        projects={[...folders as any, ...projects as any] as any}
                                        setProjects={(updater: any) => setProjects((prev) => typeof updater === 'function' ? updater(prev) : updater)}
                                        setContextMenu={setContextMenu as any}
                                        loadingState={loadingProjects[p.id]}
                                        setLoadingProjects={setLoadingProjects}
                                    />
                                ))
                        )}
                    </div>
                ))}
                {activeNav === 'templates' && (
                    <div className="grid [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))] gap-[18px] pr-2">
                        {TEMPLATES.map((template) => (
                            <div
                                key={template.id}
                                className="relative group rounded-xl overflow-hidden bg-white/5 border border-white/10 hover:border-white/30 transition-all cursor-pointer"
                                onClick={() => {
                                    setInputModal({
                                        open: true,
                                        type: 'project',
                                        defaultValue: template.name,
                                        onConfirm: async (name: string) => {
                                            setInputModal({ open: false, type: 'project', onConfirm: () => {} });
                                            await handleCreateFromTemplate(template, name);
                                        }
                                    });
                                }}
                            >
                                <div className="aspect-video bg-black/20">
                                    <img
                                        src={template.thumbnail}
                                        alt={template.name}
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                                <div className="p-4">
                                    <h3 className="text-white text-sm font-medium">{template.name}</h3>
                                    <p className="text-white/50 text-xs mt-1">{template.description}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {/* Global context menu (right-click) */}
                {contextMenu.open && contextMenu.id && (
                    <>
                        <div
                            onMouseDown={(e) => {
                                // Close on left-click; allow right-click to reposition
                                if (e.button === 0) {
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
                                            const visible = filtered.filter((pp) => !activeFolderId ? (pp.folderId == null) : (pp.folderId === activeFolderId));
                                            const visibleIds = visible.map(pp => pp.id);
                                            const idx = visibleIds.findIndex((vid) => vid === pid);
                                            selectByIndex(visibleIds, idx, e as any);
                                        }
                                    } catch (_) { }
                                    setContextMenu({ id: null, x: 0, y: 0, open: false });
                                }
                            }}
                            onContextMenu={(e) => {
                                e.preventDefault();
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
                            setLoadingProjects={setLoadingProjects}
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
            <InputModal
                isOpen={inputModal.open}
                title={inputModal.type === 'project' ? 'Create Project' : 'Create Folder'}
                placeholder={inputModal.type === 'project' ? 'Project name' : 'Folder name'}
                defaultValue={inputModal.defaultValue ?? (inputModal.type === 'project' ? (newName || 'Untitled Project') : '')}
                onCancel={() => setInputModal({ open: false, type: inputModal.type, onConfirm: () => {} })}
                onConfirm={inputModal.onConfirm}
            />
        </div>
    );
}


