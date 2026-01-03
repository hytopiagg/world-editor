import React, { useEffect, useState } from "react";
import ProjectActionsMenu from "./ProjectActionsMenu";

interface ProjectMeta {
    id: string;
    name: string;
    updatedAt?: number;
    createdAt?: number;
    thumbnailDataUrl?: string;
}

interface Props {
    project: ProjectMeta;
    index: number;
    selected: boolean;
    hoveredId: string | null;
    setHoveredId: (id: string | null) => void;
    onSelect: (id: string, index: number, ev: React.MouseEvent) => void;
    onOpen: (projectId: string) => void;
    projects: any;
    setProjects: any;
    setContextMenu: (v: { id: string | null; x: number; y: number; open: boolean }) => void;
    loadingState?: string;
    setLoadingProjects: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

function formatLastEdited(ts?: number) {
    const t = ts || 0;
    const diff = Date.now() - t;
    const m = 60 * 1000;
    const h = 60 * m;
    const d = 24 * h;
    const w = 7 * d;
    const mo = 30 * d;
    if (diff < h) {
        const mins = Math.max(1, Math.round(diff / m));
        return `Last edited ${mins} minute${mins === 1 ? '' : 's'} ago`;
    }
    if (diff < d) {
        const hrs = Math.round(diff / h);
        return `Last edited ${hrs} hour${hrs === 1 ? '' : 's'} ago`;
    }
    if (diff < w * 2) {
        const days = Math.round(diff / d);
        return `Last edited ${days} day${days === 1 ? '' : 's'} ago`;
    }
    if (diff < mo * 2) {
        const weeks = Math.round(diff / w);
        return `Last edited ${weeks} week${weeks === 1 ? '' : 's'} ago`;
    }
    const months = Math.round(diff / mo);
    return `Last edited ${months} month${months === 1 ? '' : 's'} ago`;
}

const ProjectListCard: React.FC<Props> = ({ project: p, index, selected, hoveredId, setHoveredId, onSelect, onOpen, projects, setProjects, setContextMenu, loadingState, setLoadingProjects }) => {
    const [menuOpen, setMenuOpen] = useState(false);

    useEffect(() => {
        const close = () => setMenuOpen(false);
        window.addEventListener('ph-close-inline-menus' as any, close);
        return () => window.removeEventListener('ph-close-inline-menus' as any, close);
    }, []);

    return (
        <div
            className={`grid grid-cols-[160px_1fr_28px] items-center gap-x-3 p-2.5 rounded-xl border border-transparent cursor-pointer relative ${selected ? 'bg-white/10' : (hoveredId === p.id ? 'bg-white/5' : 'bg-transparent')}`}
            data-pid={p.id}
            draggable
            onDragStart={(e) => {
                try { e.dataTransfer?.setData('text/project-id', p.id); } catch (_) { }
                try {
                    const sel = (window as any).__PH_SELECTED__ || [];
                    const payload = Array.isArray(sel) && sel.includes(p.id) ? sel : [p.id];
                    e.dataTransfer?.setData('application/x-project-ids', JSON.stringify(payload));
                } catch (_) { }
            }}
            onDragEnd={() => { }}
            onClick={(ev) => onSelect(p.id, index, ev)}
            onMouseEnter={() => setHoveredId(p.id)}
            onMouseLeave={() => setHoveredId(null)}
            onMouseUp={(e) => { try { const sel = (window as any).__PH_SELECTED__ || []; console.log('[ListCard] mouseup selection snapshot', sel); } catch (_) { } }}
            onDoubleClick={() => onOpen(p.id)}
            onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ id: p.id, x: e.clientX, y: e.clientY, open: true });
            }}
        >
            <div className="relative">
                {selected && (
                    <div className="absolute -inset-[6px] border-2 border-white/95 rounded-[10px] pointer-events-none z-[1]" />
                )}
                <div className="relative w-full h-[90px] rounded-lg overflow-hidden bg-[#141821]" draggable onDragStart={(e) => {
                    try { e.dataTransfer!.effectAllowed = 'move'; } catch (_) { }
                    try { e.dataTransfer?.setData('text/project-id', p.id); } catch (_) { }
                    try {
                        const sel = (window as any).__PH_SELECTED__ || [];
                        const payload = Array.isArray(sel) && sel.includes(p.id) ? sel : [p.id];
                        e.dataTransfer?.setData('application/x-project-ids', JSON.stringify(payload));
                    } catch (_) { }
                }}>
                    {p.thumbnailDataUrl ? (
                        <img src={p.thumbnailDataUrl} alt="Project thumbnail" className="object-cover absolute inset-0 w-full h-full" />
                    ) : (
                        <div className="absolute inset-0 bg-[#141821] text-[#7b8496] flex items-center justify-center rounded-lg text-[12px]">No Thumbnail</div>
                    )}
                    {loadingState && (
                        <div className="absolute inset-0 bg-black/70 flex items-center justify-center pointer-events-none">
                            <div className="flex flex-col items-center gap-2">
                                <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                <div className="text-white text-[10px] font-medium">{loadingState}</div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            <div className="flex flex-col gap-1 justify-center items-start">
                <div className="font-semibold">{p.name || 'Untitled'}</div>
                <div className="opacity-70 text-[12px]">{loadingState || formatLastEdited(p.updatedAt || p.createdAt)}</div>
            </div>
            <div className="ph-menu relative w-[28px] h-[28px] justify-self-end self-center z-[1100]" onClick={(e) => e.stopPropagation()}>
                <button
                    className={`ph-menu-trigger bg-transparent border-0 text-[#cfd6e4] rounded-md w-[28px] h-[28px] cursor-pointer leading-none inline-flex items-center justify-center transition-opacity ${hoveredId === p.id || menuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
                    onClick={() => {
                        if (menuOpen) {
                            // Close immediately if already open
                            setMenuOpen(false);
                        } else {
                            try { window.dispatchEvent(new Event('ph-close-inline-menus')); } catch (_) { }
                            setContextMenu({ id: null, x: 0, y: 0, open: false });
                            setMenuOpen(true);
                        }
                    }}
                >
                    ⋮
                </button>
                <div className={`ph-inline-menu absolute right-0 top-[30px] ${menuOpen ? 'block' : 'hidden'}`} onClick={(e) => e.stopPropagation()}>
                    <ProjectActionsMenu variant="inline" id={p.id} projects={projects} setProjects={setProjects} setContextMenu={setContextMenu} onOpen={onOpen} onRequestClose={() => setMenuOpen(false)} setLoadingProjects={setLoadingProjects} />
                </div>
            </div>
        </div>
    );
};

export default ProjectListCard;
