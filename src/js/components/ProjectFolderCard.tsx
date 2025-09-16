import React, { useEffect, useMemo, useState } from "react";
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
    hoveredId?: string | null;
    setHoveredId?: (id: string | null) => void;
    pressedCardId?: string | null;
    setPressedCardId?: React.Dispatch<React.SetStateAction<string | null>>;
}

const ProjectFolderCard: React.FC<Props> = ({ folder, onOpenFolder, setContextMenu, onDropProjects, projects, setProjects, selected, onSelect, hoveredId, setHoveredId, pressedCardId, setPressedCardId }) => {
    const [inlineOpen, setInlineOpen] = useState(false);

    useEffect(() => {
        const close = () => setInlineOpen(false);
        window.addEventListener('ph-close-inline-menus' as any, close);
        return () => window.removeEventListener('ph-close-inline-menus' as any, close);
    }, []);

    const isHoverOrActive = (hoveredId === folder.id) || !!selected || (pressedCardId === folder.id);

    const childProjects = useMemo(() => {
        try {
            return (projects || []).filter((p: any) => p && p.type !== 'folder' && p.folderId === folder.id);
        } catch (_) { return []; }
    }, [projects, folder.id]);

    return (
        <div
            className="group relative flex flex-col rounded-lg p-3 border border-white/10 bg-[#0e131a] cursor-pointer overflow-hidden"
            data-fid={folder.id}
            onClick={(e) => onSelect && onSelect(folder.id, e)}
            onMouseDown={() => setPressedCardId && setPressedCardId(folder.id)}
            onMouseUp={() => setPressedCardId && setPressedCardId(null)}
            onMouseEnter={() => setHoveredId && setHoveredId(folder.id)}
            onMouseLeave={() => { setPressedCardId && setPressedCardId((cur) => (cur === folder.id ? null : cur)); setHoveredId && setHoveredId(null); }}
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
            {isHoverOrActive && (
                <div className="absolute -inset-[6px] border-2 border-white/95 rounded-[10px] pointer-events-none z-[1]" />
            )}
            <div className="flex items-center justify-between mb-2">
                <div>
                    <div className="font-semibold">{folder.name}</div>
                    <div className="text-white/50 text-[12px]">Folder • {childProjects.length}</div>
                </div>
            </div>
            <div className="relative">
                <div className="grid grid-cols-3 gap-[4px]">
                    {childProjects.slice(0, 9).map((p: any, idx: number) => (
                        <div key={p.id} className="relative w-full pt-[56%] rounded-md overflow-hidden bg-[#141821]">
                            {p.thumbnailDataUrl ? (
                                <img src={p.thumbnailDataUrl} className="absolute inset-0 w-full h-full object-cover" alt="thumb" />
                            ) : (
                                <div className="absolute inset-0 flex items-center justify-center text-[10px] text-white/50">No img</div>
                            )}
                            {(idx === 8 && childProjects.length > 9) && (
                                <div className="absolute inset-0 bg-black/50 text-white flex items-center justify-center text-[12px] font-semibold">+{childProjects.length - 9}</div>
                            )}
                        </div>
                    ))}
                    {childProjects.length === 0 && (
                        <div className="col-span-3 text-white/40 text-[12px] py-6 text-center">Empty folder</div>
                    )}
                </div>
            </div>
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
