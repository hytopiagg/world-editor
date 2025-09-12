import React, { useEffect, useRef, useState } from "react";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";

export type ProjectMeta = {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    lastOpenedAt?: number;
    thumbnailDataUrl?: string;
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
}

const ProjectActionsMenu: React.FC<Props> = ({ id, projects, setProjects, setContextMenu, onOpen, onRequestClose, variant = "inline", x, y, containerClassName = "", containerStyle }) => {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [entered, setEntered] = useState(false);

    useEffect(() => {
        const t = requestAnimationFrame(() => setEntered(true));
        return () => cancelAnimationFrame(t);
    }, []);

    const closeAllMenus = () => {
        setContextMenu({ id: null, x: 0, y: 0, open: false });
        onRequestClose?.();
    };

    const handleRename = async () => {
        const raw = window.prompt("Rename project");
        if (raw === null) return;
        const name = (raw || "").trim();
        if (!name) return;
        try {
            const db = await (DatabaseManager as any).getConnection();
            await new Promise<void>((resolve) => {
                const tx = db.transaction(STORES.PROJECTS, "readwrite");
                const store = tx.objectStore(STORES.PROJECTS);
                const src = projects.find((pp) => pp.id === id);
                const next = { ...(src || {}), id, name, updatedAt: Date.now() };
                const req = store.put(next, id);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
            });
            setProjects((prev) => prev.map((px) => (px.id === id ? { ...px, name, updatedAt: Date.now() } : px)));
        } finally {
            closeAllMenus();
        }
    };

    const handleDuplicate = async () => {
        try {
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
            if (src.thumbnailDataUrl) await DatabaseManager.saveProjectThumbnail(newId, src.thumbnailDataUrl);
            DatabaseManager.setCurrentProjectId(original);
            const now = Date.now();
            const newMeta: ProjectMeta = {
                id: newId,
                name: `${src.name} (Copy)`,
                createdAt: now,
                updatedAt: now,
                lastOpenedAt: now,
                thumbnailDataUrl: src.thumbnailDataUrl,
            } as any;
            setProjects((prev) => [newMeta, ...prev]);
        } finally {
            closeAllMenus();
        }
    };

    const handleExport = async () => {
        try {
            const original = DatabaseManager.getCurrentProjectId();
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
            DatabaseManager.setCurrentProjectId(original);
        } finally {
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

    const handleDelete = async () => {
        if (!window.confirm("Delete this project? This cannot be undone.")) return;
        try {
            await DatabaseManager.deleteProject(id);
            setProjects((prev) => prev.filter((p) => p.id !== id));
        } finally {
            closeAllMenus();
        }
    };

    const items = [
        { label: "Rename", onClick: handleRename, danger: false },
        { label: "Duplicate", onClick: handleDuplicate, danger: false },
        { label: "Export", onClick: handleExport, danger: false },
        { label: "Open", onClick: handleOpen, danger: false },
        { label: "Delete", onClick: handleDelete, danger: true },
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

    // inline variant
    return (
        <div className={`bg-[#0e131a] border border-[#1a1f29] rounded-lg overflow-hidden z-[1000] w-[180px] ${entered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'} transition-all ease-in-out duration-200 ${containerClassName}`} style={containerStyle}>
            {panel}
        </div>
    );
};

export default ProjectActionsMenu;
