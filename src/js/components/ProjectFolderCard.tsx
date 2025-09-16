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
            className="flex overflow-visible flex-col rounded-lg transition-shadow"
            data-fid={folder.id}
            onClick={(e) => {
                try {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    console.log('[FolderCard] click', { id: folder.id, name: folder.name, x: e.clientX, y: e.clientY, rect });
                } catch (_) { }
                onSelect && onSelect(folder.id, e);
            }}
            onMouseDown={(e) => {
                try { console.log('[FolderCard] mousedown', { id: folder.id, button: e.button }); } catch (_) { }
                setPressedCardId && setPressedCardId(folder.id);
            }}
            onMouseUp={() => {
                setPressedCardId && setPressedCardId(null);
                try { const sel = (window as any).__PH_SELECTED__ || []; console.log('[FolderCard] mouseup selection snapshot', sel); } catch (_) { }
            }}
            onMouseEnter={() => setHoveredId && setHoveredId(folder.id)}
            onMouseLeave={() => { setPressedCardId && setPressedCardId((cur) => (cur === folder.id ? null : cur)); setHoveredId && setHoveredId(null); }}
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
            <div className="relative">
                {isHoverOrActive && (
                    <div className="absolute -inset-[6px] border-2 border-white/95 rounded-[10px] pointer-events-none z-[1]" />
                )}
                <div
                    className={`relative bg-[#141821] rounded-lg overflow-hidden transition-[transform,box-shadow,outline] ease-out ${isHoverOrActive ? 'shadow-[0_6px_16px_rgba(0,0,0,0.35)]' : ''}`}
                    onDoubleClick={() => onOpenFolder(folder.id)}
                >
                    <div className="relative w-full pt-[56.25%]">
                        <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-[4px] rounded-md overflow-hidden">
                            {childProjects.slice(0, 9).map((p: any, idx: number) => (
                                <div key={p.id} className="relative w-full h-full rounded-md overflow-hidden bg-[#141821]">
                                    {p.thumbnailDataUrl ? (
                                        <img src={p.thumbnailDataUrl} className="object-cover absolute inset-0 w-full h-full" alt="thumb" />
                                    ) : (
                                        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-white/50">No img</div>
                                    )}
                                    {(idx === 8 && childProjects.length > 9) && (
                                        <div className="absolute inset-0 bg-black/50 text-white flex items-center justify-center text-[12px] font-semibold">+{childProjects.length - 9}</div>
                                    )}
                                </div>
                            ))}
                            {childProjects.length === 0 && (
                                <div className="col-span-3 row-span-3 text-white/40 text-[12px] flex items-center justify-center">Empty folder</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            <div className="flex flex-col gap-1 p-3 bg-transparent">
                <div className="flex justify-between items-center">
                    <div className="text-left">
                        <div className="font-semibold bg-transparent">{folder.name}</div>
                        <div className="opacity-70 text-[12px] bg-transparent">Folder • {childProjects.length}</div>
                    </div>
                    <div className="ph-menu relative transform-none w-[28px] h-[28px] inline-block z-[1100]" onClick={(e) => e.stopPropagation()}>
                        <button
                            className={`ph-menu-trigger bg-transparent border-0 text-[#cfd6e4] rounded-md w-[28px] h-[28px] cursor-pointer leading-none inline-flex items-center justify-center ${(hoveredId === folder.id) ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
                            onClick={() => {
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
            </div>
        </div>
    );
};

export default ProjectFolderCard;
