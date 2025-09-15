import React, { useEffect, useState } from "react";
import ProjectActionsMenu from "./ProjectActionsMenu";

interface FolderMeta {
    id: string;
    name: string;
    type?: string;
}

interface Props {
    folder: FolderMeta;
    onOpenFolder: (id: string) => void;
    setContextMenu: (v: { id: string | null; x: number; y: number; open: boolean }) => void;
    onDropProjects: (folderId: string, ids: string[]) => void;
    projects: any[];
    setProjects: any;
    selected?: boolean;
    onSelect?: (id: string, e: React.MouseEvent) => void;
}

const ProjectFolderCard: React.FC<Props> = ({ folder, onOpenFolder, setContextMenu, onDropProjects, projects, setProjects, selected, onSelect }) => {
    const [inlineOpen, setInlineOpen] = useState(false);

    useEffect(() => {
        const close = () => setInlineOpen(false);
        window.addEventListener('ph-close-inline-menus' as any, close);
        return () => window.removeEventListener('ph-close-inline-menus' as any, close);
    }, []);

    return (
        <div
            className="group relative flex flex-col rounded-lg p-3 border border-white/10 bg-[#0e131a] cursor-pointer"
            data-fid={folder.id}
            onClick={(e) => onSelect && onSelect(folder.id, e)}
            onMouseDown={(e) => {
                // Visual ring similar to projects on press/hover
                const el = e.currentTarget as HTMLElement;
                try {
                    const ring = document.createElement('div');
                    ring.style.position = 'absolute';
                    ring.style.inset = '-6px';
                    ring.style.border = '2px solid rgba(255,255,255,0.95)';
                    ring.style.borderRadius = '10px';
                    ring.style.pointerEvents = 'none';
                    ring.style.zIndex = '1';
                    ring.className = 'ph-folder-ring';
                    el.appendChild(ring);
                    setTimeout(() => { try { ring.remove(); } catch (_) { } }, 200);
                } catch (_) { }
            }}
            onDoubleClick={() => onOpenFolder(folder.id)}
            onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ id: folder.id, x: e.clientX, y: e.clientY, open: true });
            }}
            onDragOver={(e) => { e.preventDefault(); try { e.dataTransfer!.dropEffect = 'move'; } catch (_) { } }}
            onDrop={(e) => {
                try {
                    const json = e.dataTransfer?.getData('application/x-project-ids');
                    const ids = json ? JSON.parse(json) : [];
                    if (Array.isArray(ids) && ids.length > 0) onDropProjects(folder.id, ids);
                } catch (_) { }
            }}
        >
            {(selected) && (
                <div className="absolute -inset-[6px] border-2 border-white/95 rounded-[10px] pointer-events-none z-[1]" />
            )}
            <div className="font-semibold">{folder.name}</div>
            <div className="text-white/50 text-[12px]">Folder</div>
            <div className="absolute top-2 right-2">
                <button
                    className="ph-menu-trigger bg-transparent border-0 text-[#cfd6e4] rounded-md w-[28px] h-[28px] cursor-pointer leading-none inline-flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                        e.stopPropagation();
                        try { window.dispatchEvent(new Event('ph-close-inline-menus')); } catch (_) { }
                        setContextMenu({ id: null, x: 0, y: 0, open: false });
                        setInlineOpen((v) => !v);
                    }}
                >
                    ⋮
                </button>
                {inlineOpen && (
                    <div className="ph-inline-menu absolute right-0 top-[30px]" onClick={(e) => e.stopPropagation()}>
                        <ProjectActionsMenu
                            variant="inline"
                            id={folder.id}
                            projects={projects as any}
                            setProjects={setProjects as any}
                            setContextMenu={setContextMenu as any}
                            onOpen={() => { }}
                            entityType="folder"
                            onOpenFolder={onOpenFolder}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProjectFolderCard;
