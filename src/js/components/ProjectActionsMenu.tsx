import React, { useEffect, useRef, useState } from "react";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";
import MoveToModal from "./MoveToModal";

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
}

const ProjectActionsMenu: React.FC<Props> = ({ id, projects, setProjects, setContextMenu, onOpen, onRequestClose, variant = "inline", x, y, containerClassName = "", containerStyle, entityType, onOpenFolder }) => {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [entered, setEntered] = useState(false);
    const [moveOpen, setMoveOpen] = useState(false);

    useEffect(() => {
        const t = requestAnimationFrame(() => setEntered(true));
        return () => cancelAnimationFrame(t);
    }, []);

    const closeAllMenus = () => {
        setContextMenu({ id: null, x: 0, y: 0, open: false });
        onRequestClose?.();
    };

    const handleRename = async () => {
        const raw = window.prompt("Rename");
        if (raw === null) return;
        const name = (raw || "").trim();
        if (!name) return;
        try {
            console.log('[Actions] Rename start', { id, name });
            const db = await (DatabaseManager as any).getConnection();
            await new Promise<void>((resolve) => {
                const tx = db.transaction(STORES.PROJECTS, "readwrite");
                const store = tx.objectStore(STORES.PROJECTS);
                const src = projects.find((pp) => pp.id === id) || { id } as any;
                const next = {
                    ...(src || {}),
                    id,
                    name,
                    updatedAt: Date.now(),
                    // Preserve entity type and folder assignment
                    type: (src && (src as any).type) || (entityType === 'folder' ? 'folder' : 'project'),
                    folderId: (src && (src as any).folderId) !== undefined ? (src as any).folderId : null,
                } as any;
                const req = store.put(next, id);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
            });
            setProjects((prev) => prev.map((px) => (px.id === id ? { ...px, name, updatedAt: Date.now(), type: (px as any).type || (entityType === 'folder' ? 'folder' : (px as any).type), folderId: (px as any).folderId ?? null } : px)) as any);
        } finally {
            console.log('[Actions] Rename done');
            closeAllMenus();
        }
    };

    const handleDuplicate = async () => {
        try {
            console.log('[Actions] Duplicate start', { id });
            const src = projects.find((p) => p.id === id) || (await DatabaseManager.listProjects()).find((p) => p.id === id);
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
            if ((src as any).thumbnailDataUrl) await DatabaseManager.saveProjectThumbnail(newId, (src as any).thumbnailDataUrl);
            DatabaseManager.setCurrentProjectId(original);
            const now = Date.now();
            const newMeta: any = {
                ...(copy as any),
                name: `${src.name} (Copy)`,
                thumbnailDataUrl: (src as any).thumbnailDataUrl,
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
        try {
            await DatabaseManager.touchProject(id);
        } finally {
            onOpen(id);
            closeAllMenus();
        }
    };

    const handleOpenFolder = () => {
        try { onOpenFolder && onOpenFolder(id); } finally { closeAllMenus(); }
    };

    const handleDelete = async () => {
        try {
            console.log('[Actions] Delete start', { id });
            await DatabaseManager.deleteProject(id);
            setProjects((prev) => prev.filter((p) => p.id !== id));
        } finally {
            console.log('[Actions] Delete done');
            closeAllMenus();
        }
    };

    const handleDeleteFolder = async () => {
        try { await DatabaseManager.deleteFolder(id); setProjects((prev) => prev.filter((p) => p.id !== id)); } finally { closeAllMenus(); }
    };

    const selected = (typeof window !== 'undefined' && (window as any).__PH_SELECTED__ ? (window as any).__PH_SELECTED__ : []) as string[];
    const multi = Array.isArray(selected) && selected.length > 1;

    const type = entityType || (id === '__ROOT__' ? 'root' : 'project');

    const items = type === 'root'
        ? [
            {
                label: "+ New Folder", onClick: async () => {
                    const raw = window.prompt('Folder name');
                    if (raw === null) return;
                    const name = (raw || '').trim() || 'New Folder';
                    try { const f = await DatabaseManager.createFolder(name); setProjects((prev: any) => [f, ...prev]); } finally { closeAllMenus(); }
                }, danger: false
            },
        ]
        : type === 'folder'
            ? [
                { label: "Open", onClick: handleOpenFolder, danger: false },
                { label: "Rename", onClick: handleRename, danger: false },
                { label: "Delete", onClick: handleDeleteFolder, danger: true },
            ]
            : [
                ...(multi ? [
                    { label: "Move to…", onClick: () => setMoveOpen(true), danger: false },
                    { label: "Delete all", onClick: async () => { try { await Promise.all(selected.map((pid) => DatabaseManager.deleteProject(pid))); setProjects((prev) => (prev as any).filter((p: any) => !selected.includes(p.id))); } finally { closeAllMenus(); } }, danger: true },
                    { label: "Archive all", onClick: async () => { try { await DatabaseManager.setProjectsArchived(selected, true); } finally { closeAllMenus(); } }, danger: false },
                ] : [
                    { label: "Move to…", onClick: () => setMoveOpen(true), danger: false },
                    { label: "Rename", onClick: handleRename, danger: false },
                    { label: "Duplicate", onClick: handleDuplicate, danger: false },
                    { label: "Export", onClick: handleExport, danger: false },
                    { label: "Open", onClick: handleOpen, danger: false },
                    { label: "Delete", onClick: async () => { try { await handleDelete(); } finally { } }, danger: true },
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
                    folders={(projects as any[]).filter((p: any) => p && p.type === 'folder') as any}
                    onClose={() => setMoveOpen(false)}
                    onMove={async (folderId) => {
                        try {
                            const ids = multi ? selected : [id];
                            console.log('[MoveTo] moving', ids, 'to', folderId);
                            for (const pid of ids) await DatabaseManager.updateProjectFolder(pid, folderId);
                            setProjects((prev: any) => prev.map((p: any) => ids.includes(p.id) ? { ...p, folderId: folderId } : p));
                        } finally {
                            setMoveOpen(false);
                            closeAllMenus();
                        }
                    }}
                />
            )}
        </div>
    );

    if (variant === "context") {
        const left = Math.min(x || 0, typeof window !== 'undefined' ? window.innerWidth - 180 : (x || 0));
        const top = Math.min(y || 0, typeof window !== 'undefined' ? window.innerHeight - 160 : (y || 0));
        return (
            <div className={`ph-context-menu fixed bg-[#0e131a] border border-[#1a1f29] rounded-lg overflow-hidden z-[1000] w-[180px] ${entered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'} transition-all ease-in-out duration-200 ${containerClassName}`} style={{ left, top, ...(containerStyle || {}) }}>
                {panel}
            </div>
        );
    }

    return (
        <div className={`bg-[#0e131a] border border-[#1a1f29] rounded-lg overflow-hidden z-[1000] w-[180px] ${entered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'} transition-all ease-in-out duration-200 ${containerClassName}`} style={containerStyle}>
            {panel}
        </div>
    );
};

export default ProjectActionsMenu;
