import React, { useEffect, useRef } from "react";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";

function animateProjectActionsMenu(menuEl: HTMLElement | null, perItemDelayMs = 25, baseDelayMs = 120) {
    if (!menuEl) return;
    try {
        menuEl.style.opacity = '0';
        menuEl.style.transform = 'translateY(4px)';
        menuEl.style.transition = 'opacity 180ms ease, transform 180ms ease';
        const items = Array.from(menuEl.querySelectorAll('button')) as HTMLElement[];
        items.forEach((btn, idx) => {
            btn.style.opacity = '0';
            btn.style.transform = 'translateY(6px)';
            btn.style.transition = 'opacity 220ms ease, transform 220ms ease, background-color 120ms ease';
            btn.style.transitionDelay = `${baseDelayMs + idx * perItemDelayMs}ms`;
        });
        requestAnimationFrame(() => {
            menuEl.style.opacity = '1';
            menuEl.style.transform = 'translateY(0)';
            items.forEach((btn) => {
                btn.style.opacity = '1';
                btn.style.transform = 'translateY(0)';
            });
        });
    } catch (_) { }
}

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
}

const ProjectActionsMenu: React.FC<Props> = ({ id, projects, setProjects, setContextMenu, onOpen, onRequestClose }) => {
    const rootRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        // Animate the nearest menu container when mounted (works for both inline and context menus)
        const container = rootRef.current?.parentElement || rootRef.current;
        animateProjectActionsMenu(container as HTMLElement);
    }, []);

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
            setContextMenu({ id: null, x: 0, y: 0, open: false });
            onRequestClose?.();
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
            setContextMenu({ id: null, x: 0, y: 0, open: false });
            onRequestClose?.();
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
            setContextMenu({ id: null, x: 0, y: 0, open: false });
            onRequestClose?.();
        }
    };

    const handleOpen = async () => {
        try {
            await DatabaseManager.touchProject(id);
        } finally {
            onOpen(id);
            setContextMenu({ id: null, x: 0, y: 0, open: false });
            onRequestClose?.();
        }
    };

    const handleDelete = async () => {
        if (!window.confirm("Delete this project? This cannot be undone.")) return;
        try {
            await DatabaseManager.deleteProject(id);
            setProjects((prev) => prev.filter((p) => p.id !== id));
        } finally {
            setContextMenu({ id: null, x: 0, y: 0, open: false });
            onRequestClose?.();
        }
    };

    return (
        <div ref={rootRef} style={{ display: "flex", flexDirection: "column" }}>
            <button style={menuItemStyle as any} onClick={handleRename}>Rename</button>
            <button style={menuItemStyle as any} onClick={handleDuplicate}>Duplicate</button>
            <button style={menuItemStyle as any} onClick={handleExport}>Export</button>
            <button style={menuItemStyle as any} onClick={handleOpen}>Open</button>
            <button style={{ ...(menuItemStyle as any), color: '#ff8a8a' }} onClick={handleDelete}>Delete</button>
        </div>
    );
};

const menuItemStyle: React.CSSProperties = {
    display: "block",
    padding: "8px 12px",
    color: "#cfd6e4",
    background: "transparent",
    border: "none",
    textAlign: "left",
    cursor: "pointer",
    width: "100%",
};

export default ProjectActionsMenu;
