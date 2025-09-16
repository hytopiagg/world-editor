import React, { useEffect, useRef, useState } from "react";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";
import ModalContainer from "./ModalContainer";
import MoveToModal from "./MoveToModal";

interface RenameModalProps {
    isOpen: boolean;
    initialName: string;
    title?: string;
    onCancel: () => void;
    onConfirm: (name: string) => void;
}

const RenameModal: React.FC<RenameModalProps> = ({ isOpen, initialName, title = "Rename", onCancel, onConfirm }) => {
    const [value, setValue] = useState(initialName);
    useEffect(() => { if (isOpen) setValue(initialName); }, [isOpen, initialName]);
    if (!isOpen) return null;
    return (
        <ModalContainer isOpen={isOpen} onClose={onCancel} title={title} className="min-w-[480px]">
            <form onSubmit={(e) => { e.preventDefault(); onConfirm((value || '').trim()); }} className="flex flex-col gap-3">
                <input value={value} onChange={(e) => setValue(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none" placeholder="Name" />
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={onCancel} className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15">Cancel</button>
                    <button type="submit" className="px-3 py-2 rounded-xl bg-white/20 hover:bg-white/25">Save</button>
                </div>
            </form>
        </ModalContainer>
    );
};

interface ConfirmModalProps {
    isOpen: boolean;
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onCancel: () => void;
    onConfirm: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({ isOpen, title = "Confirm", message, confirmLabel = "Delete", cancelLabel = "Cancel", onCancel, onConfirm }) => {
    if (!isOpen) return null;
    return (
        <ModalContainer isOpen={isOpen} onClose={onCancel} title={title} className="min-w-[480px]">
            <div className="flex flex-col gap-4">
                <div className="text-white/80">{message}</div>
                <div className="flex justify-end gap-2">
                    <button onClick={onCancel} className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15">{cancelLabel}</button>
                    <button onClick={onConfirm} className="px-3 py-2 rounded-xl bg-[#3a3f46] text-[#ff8a8a] border border-[#504a4a]">{confirmLabel}</button>
                </div>
            </div>
        </ModalContainer>
    );
};

export type ProjectMeta = {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    lastOpenedAt?: number;
    thumbnailDataUrl?: string;
    type?: string;
    folderId?: string | null;
};

interface Props {
    id: string;
    projects: ProjectMeta[];
    setProjects: React.Dispatch<React.SetStateAction<ProjectMeta[]>>;
    setContextMenu: (v: { id: string | null; x: number; y: number; open: boolean }) => void;
    onOpen: (id: string) => void;
    onRequestClose?: () => void;
    variant?: "inline" | "context";
    x?: number;
    y?: number;
    containerClassName?: string;
    containerStyle?: React.CSSProperties;
    entityType?: "project" | "folder" | "root";
    onOpenFolder?: (id: string) => void;
    folders?: { id: string; name: string }[];
}

const ProjectActionsMenu: React.FC<Props> = ({ id, projects, setProjects, setContextMenu, onOpen, onRequestClose, variant = "inline", x, y, containerClassName = "", containerStyle, entityType, onOpenFolder, folders = [] }) => {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [entered, setEntered] = useState(false);
    const [moveOpen, setMoveOpen] = useState(false);
    const [renameOpen, setRenameOpen] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [selectionSnapshot, setSelectionSnapshot] = useState<string[]>([]);

    useEffect(() => {
        const t = requestAnimationFrame(() => setEntered(true));
        return () => cancelAnimationFrame(t);
    }, []);

    // Capture selection at the moment the menu mounts so later clicks do not clear it
    useEffect(() => {
        try {
            const live = (typeof window !== 'undefined' && (window as any).__PH_SELECTED__ ? (window as any).__PH_SELECTED__ : []) as string[];
            setSelectionSnapshot(Array.isArray(live) ? [...live] : []);
            console.log('[ActionsMenu] selection snapshot at open', live);
        } catch (_) { setSelectionSnapshot([]); }
    }, []);

    const closeAllMenus = () => {
        setContextMenu({ id: null, x: 0, y: 0, open: false });
        onRequestClose?.();
    };

    const performRename = async (name: string) => {
        if (!name) return;
        try {
            console.log('[Actions] Rename start', { id, name });
            const db = await (DatabaseManager as any).getConnection();
            await new Promise<void>((resolve) => {
                const tx = db.transaction(STORES.PROJECTS, "readwrite");
                const store = tx.objectStore(STORES.PROJECTS);
                const src = (projects.find((pp) => pp.id === id) || { id }) as any;
                const next = {
                    ...(src || {}),
                    id,
                    name,
                    updatedAt: Date.now(),
                    type: (src && src.type) || (entityType === 'folder' ? 'folder' : 'project'),
                    folderId: src?.folderId ?? null,
                } as any;
                const req = store.put(next, id);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
            });
            setProjects((prev: any[]) => prev.map((px: any) => (px.id === id ? { ...px, name, updatedAt: Date.now() } : px)));
        } finally {
            console.log('[Actions] Rename done');
        }
    };

    const handleDuplicate = async () => {
        try {
            console.log('[Actions] Duplicate start', { id });
            const all = await DatabaseManager.listProjects();
            const src = (projects.find((p) => p.id === id) || all.find((p) => p.id === id)) as any;
            if (!src) return;
            const copy = await DatabaseManager.createProject(`${src.name} (Copy)`);
            const newId = (copy && (copy as any).id) as string | undefined;
            if (!newId) return;
            const original = DatabaseManager.getCurrentProjectId();
            DatabaseManager.setCurrentProjectId(id);
            const tSrc = await DatabaseManager.getData("terrain", "current");
            const eSrc = await DatabaseManager.getData("environment", "current");
            const sky = await DatabaseManager.getData("settings", `project:${id}:selectedSkybox`);
            const amb = await DatabaseManager.getData("settings", `project:${id}:ambientLight`);
            const dir = await DatabaseManager.getData("settings", `project:${id}:directionalLight`);
            DatabaseManager.setCurrentProjectId(newId);
            await DatabaseManager.saveData("terrain", "current", tSrc || {});
            await DatabaseManager.saveData("environment", "current", eSrc || []);
            if (sky !== undefined) await DatabaseManager.saveData("settings", `project:${newId}:selectedSkybox`, sky);
            if (amb !== undefined) await DatabaseManager.saveData("settings", `project:${newId}:ambientLight`, amb);
            if (dir !== undefined) await DatabaseManager.saveData("settings", `project:${newId}:directionalLight`, dir);
            if (src.thumbnailDataUrl) await DatabaseManager.saveProjectThumbnail(newId, src.thumbnailDataUrl);
            DatabaseManager.setCurrentProjectId(original);
            const now = Date.now();
            const newMeta: any = {
                ...(copy as any),
                name: `${src.name} (Copy)`,
                thumbnailDataUrl: src.thumbnailDataUrl,
                type: 'project',
                updatedAt: now,
                lastOpenedAt: now,
            };
            setProjects((prev: any) => [newMeta, ...prev]);
        } finally {
            console.log('[Actions] Duplicate done');
            closeAllMenus();
        }
    };

    const handleExport = async () => {
        try {
            console.log('[Actions] Export start', { id });
            DatabaseManager.setCurrentProjectId(id);
            const meta = (await DatabaseManager.listProjects()).find((p) => p.id === id) || { id, name: "Project" };
            const terrain = await DatabaseManager.getData("terrain", "current");
            const environment = await DatabaseManager.getData("environment", "current");
            const settings = {
                skybox: await DatabaseManager.getData("settings", `project:${id}:selectedSkybox`),
                ambientLight: await DatabaseManager.getData("settings", `project:${id}:ambientLight`),
                directionalLight: await DatabaseManager.getData("settings", `project:${id}:directionalLight`),
            };
            const payload = { meta, terrain, environment, settings, version: 1 } as any;
            const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${(meta as any).name || "project"}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } finally {
            console.log('[Actions] Export done');
            closeAllMenus();
        }
    };

    const handleOpen = async () => {
        try { await DatabaseManager.touchProject(id); } finally { onOpen(id); closeAllMenus(); }
    };

    const handleOpenFolder = () => { try { onOpenFolder && onOpenFolder(id); } finally { closeAllMenus(); } };

    const performDelete = async () => {
        if (entityType === 'folder') {
            await DatabaseManager.deleteFolder(id);
            // Folders are managed by caller; setProjects here is assumed to update appropriate list (caller decides which setter to pass)
            setProjects((prev: any[]) => prev.filter((p: any) => p.id !== id));
        } else {
            await DatabaseManager.deleteProject(id);
            setProjects((prev: any[]) => prev.filter((p: any) => p.id !== id));
        }
    };

    const selected = (typeof window !== 'undefined' && (window as any).__PH_SELECTED__ ? (window as any).__PH_SELECTED__ : []) as string[];
    const multi = Array.isArray(selected) && selected.length > 1;

    const type = entityType || (id === '__ROOT__' ? 'root' : 'project');

    const items = type === 'root'
        ? [
            {
                label: "+ New Folder", onClick: () => {
                    const eventName = '[Actions] Create folder';
                    const doCreate = async () => {
                        const raw = window.prompt('Folder name');
                        if (raw === null) return;
                        const name = (raw || '').trim() || 'New Folder';
                        console.log(eventName, { name });
                        const f = await DatabaseManager.createFolder(name);
                        setProjects((prev: any) => [f, ...prev]);
                        closeAllMenus();
                    };
                    doCreate();
                }, danger: false
            },
        ]
        : type === 'folder'
            ? [
                { label: "Open", onClick: handleOpenFolder, danger: false },
                { label: "Rename", onClick: () => setRenameOpen(true), danger: false },
                { label: "Delete", onClick: () => setConfirmOpen(true), danger: true },
            ]
            : [
                ...(multi ? [
                    { label: "Move to…", onClick: () => setMoveOpen(true), danger: false },
                    { label: "Delete all", onClick: async () => { try { await Promise.all(selected.map((pid) => DatabaseManager.deleteProject(pid))); setProjects((prev) => (prev as any).filter((p: any) => !selected.includes(p.id))); } finally { closeAllMenus(); } }, danger: true },
                    { label: "Archive all", onClick: async () => { try { await DatabaseManager.setProjectsArchived(selected, true); } finally { closeAllMenus(); } }, danger: false },
                ] : [
                    { label: "Move to…", onClick: () => setMoveOpen(true), danger: false },
                    { label: "Rename", onClick: () => setRenameOpen(true), danger: false },
                    { label: "Duplicate", onClick: handleDuplicate, danger: false },
                    { label: "Export", onClick: handleExport, danger: false },
                    { label: "Open", onClick: handleOpen, danger: false },
                    { label: "Delete", onClick: () => setConfirmOpen(true), danger: true },
                ]),
            ];

    const delayClasses = [
        "delay-[120ms]",
        "delay-[195ms]",
        "delay-[270ms]",
        "delay-[345ms]",
        "delay-[420ms]",
    ];

    const panel = (
        <div ref={rootRef} className={`ph-actions-menu flex flex-col transition-all ease-in-out duration-200 ${entered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
            {items.map((it, idx) => (
                <button
                    key={it.label}
                    onClick={it.onClick}
                    className={`block w-full text-left px-3 py-2 transition-all duration-200 ease-in-out ${entered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'} ${delayClasses[idx] || ''} ${it.danger ? 'text-[#ff8a8a]' : 'text-[#cfd6e4]'} bg-transparent hover:bg-white/5`}
                >
                    {it.label}
                </button>
            ))}
            {moveOpen && (
                <MoveToModal
                    isOpen={moveOpen}
                    folders={folders || []}
                    onClose={() => setMoveOpen(false)}
                    onMove={async (folderId) => {
                        try {
                            const currentSelected = selectionSnapshot;
                            const ids = Array.isArray(currentSelected) && currentSelected.length > 0 ? currentSelected : [id];
                            console.log('[MoveTo] begin', { fromClickId: id, targetFolderId: folderId, selectionAtStart: currentSelected, finalIds: ids, count: ids.length });
                            await Promise.all(ids.map((pid) => DatabaseManager.updateProjectFolder(pid, folderId)));
                            setProjects((prev: any) => prev.map((p: any) => ids.includes(p.id) ? { ...p, folderId } : p));
                            console.log('[MoveTo] updated state', { ids, to: folderId });
                        } finally {
                            setMoveOpen(false);
                            closeAllMenus();
                        }
                    }}
                />
            )}
            {renameOpen && (
                <RenameModal
                    isOpen={renameOpen}
                    initialName={(projects.find((pp) => pp.id === id)?.name) || ''}
                    onCancel={() => setRenameOpen(false)}
                    onConfirm={async (name) => { await performRename(name); setRenameOpen(false); closeAllMenus(); }}
                />
            )}
            {confirmOpen && (
                <ConfirmModal
                    isOpen={confirmOpen}
                    title={entityType === 'folder' ? 'Delete folder' : 'Delete project'}
                    message={entityType === 'folder' ? 'This will delete the folder. Projects inside will be moved to root.' : 'This will permanently delete the project.'}
                    onCancel={() => setConfirmOpen(false)}
                    onConfirm={async () => { await performDelete(); setConfirmOpen(false); closeAllMenus(); }}
                />
            )}
        </div>
    );

    if (variant === 'inline') {
        return (
            <div className={`ph-context-menu z-[1100] min-w-[180px] rounded-xl border border-[#1a1f29] bg-[#0e131a] p-1 shadow-xl ${containerClassName}`} style={containerStyle}>{panel}</div>
        );
    }

    // context
    const style: React.CSSProperties = { position: 'fixed', left: (x || 0), top: (y || 0), zIndex: 1100, ...containerStyle };
    return (
        <div className={`ph-context-menu fixed rounded-xl border border-[#1a1f29] bg-[#0e131a] p-1 shadow-xl ${containerClassName}`} style={style}>
            {panel}
        </div>
    );
};

export default ProjectActionsMenu;
