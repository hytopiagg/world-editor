import React, { useEffect, useState } from "react";
import ProjectActionsMenu, { } from "./ProjectActionsMenu";

export type ProjectMeta = {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    lastOpenedAt?: number;
    thumbnailDataUrl?: string;
};

interface Props {
    project: ProjectMeta;
    index: number;
    selected: boolean;
    hoveredId: string | null;
    setHoveredId: (id: string | null) => void;
    pressedCardId: string | null;
    setPressedCardId: React.Dispatch<React.SetStateAction<string | null>>;
    onSelect: (id: string, index: number, e: React.MouseEvent) => void;
    onOpen: (id: string) => void;
    projects: ProjectMeta[];
    setProjects: React.Dispatch<React.SetStateAction<ProjectMeta[]>>;
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

const ProjectGridCard: React.FC<Props> = ({ project: p, index, selected, hoveredId, setHoveredId, pressedCardId, setPressedCardId, onSelect, onOpen, projects, setProjects, setContextMenu, loadingState, setLoadingProjects }) => {
    const [inlineOpen, setInlineOpen] = useState(false);

    useEffect(() => {
        const close = () => setInlineOpen(false);
        window.addEventListener('ph-close-inline-menus' as any, close);
        return () => window.removeEventListener('ph-close-inline-menus' as any, close);
    }, []);

    const isHoverOrActive = hoveredId === p.id || selected || pressedCardId === p.id;

    return (
        <div
            key={p.id}
            className="flex flex-col rounded-lg overflow-visible transition-shadow"
            data-pid={p.id}
            draggable
            onDragStart={(e) => {
                try { e.dataTransfer!.effectAllowed = 'move'; } catch (_) { }
                try { e.dataTransfer?.setData('text/project-id', p.id); } catch (_) { }
                try {
                    const sel = (window as any).__PH_SELECTED__ || [];
                    const payload = Array.isArray(sel) && sel.includes(p.id) ? sel : [p.id];
                    e.dataTransfer?.setData('application/x-project-ids', JSON.stringify(payload));
                } catch (err) { console.warn('[Card] dragstart error', err); }
            }}
            onDragEnd={() => { }}
            onClick={(ev) => {
                onSelect(p.id, index, ev);
            }}
            onMouseDown={(e) => {
                setPressedCardId(p.id);
            }}
            onMouseUp={(e) => {
                setPressedCardId(null);
            }}
            onMouseLeave={() => { setPressedCardId((cur) => (cur === p.id ? null : cur)); setHoveredId(null); }}
            onMouseEnter={() => setHoveredId(p.id)}
            onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ id: p.id, x: e.clientX, y: e.clientY, open: true });
            }}
        >
            <div className="relative">
                {isHoverOrActive && (
                    <div className="absolute -inset-[6px] border-2 border-white/95 rounded-[10px] pointer-events-none z-[1]" />
                )}
                <div
                    className={`relative bg-[#141821] rounded-lg overflow-hidden transition-[transform,box-shadow,outline] ease-out ${isHoverOrActive ? 'shadow-[0_6px_16px_rgba(0,0,0,0.35)]' : ''}`}
                    onDoubleClick={() => onOpen(p.id)}
                    draggable
                    onDragStart={(e) => {
                        try { e.dataTransfer!.effectAllowed = 'move'; } catch (_) { }
                        try { e.dataTransfer?.setData('text/project-id', p.id); } catch (_) { }
                        try {
                            const sel = (window as any).__PH_SELECTED__ || [];
                            const payload = Array.isArray(sel) && sel.includes(p.id) ? sel : [p.id];
                            e.dataTransfer?.setData('application/x-project-ids', JSON.stringify(payload));
                        } catch (err) { console.warn('[Card] dragstart error', err); }
                    }}
                >
                    {/* 16:9 ratio using padding-top fallback */}
                    <div className="relative w-full pt-[56.25%]">
                        {p.thumbnailDataUrl ? (
                            <img
                                className={`object-cover absolute inset-0 w-full h-full transition-transform ease-in-out will-change-transform ${hoveredId === p.id ? 'scale-[1.07]' : 'scale-[1]'}`}
                                alt="Project thumbnail"
                                src={p.thumbnailDataUrl}
                            />
                        ) : (
                            <div className={`absolute inset-0 flex items-center justify-center text-[#7b8496] text-[12px] transition-transform ease-in-out will-change-transform ${hoveredId === p.id ? 'scale-[1.07]' : 'scale-[1]'} bg-[#141821]`}>No Thumbnail</div>
                        )}
                        {selected && (
                            <div className="absolute inset-0 bg-white/15 pointer-events-none" />
                        )}
                        {loadingState && (
                            <div className="absolute inset-0 bg-black/70 flex items-center justify-center pointer-events-none">
                                <div className="flex flex-col items-center gap-2">
                                    <div className="w-8 h-8 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                                    <div className="text-white text-xs font-medium">{loadingState}</div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <div className="p-3 flex flex-col gap-1 bg-transparent">
                <div className="flex items-center justify-between">
                    <div className="text-left">
                        <div className="font-semibold bg-transparent">{p.name || "Untitled"}</div>
                        <div className="opacity-70 text-[12px] bg-transparent">
                            {loadingState || formatLastEdited(p.updatedAt || p.createdAt)}
                        </div>
                    </div>
                    <div className="ph-menu relative transform-none w-[28px] h-[28px] inline-block z-[1100]" onClick={(e) => e.stopPropagation()}>
                        <button
                            className={`ph-menu-trigger bg-transparent border-0 text-[#cfd6e4] rounded-md w-[28px] h-[28px] cursor-pointer leading-none inline-flex items-center justify-center transition-opacity ${hoveredId === p.id || inlineOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
                            onClick={() => {
                                if (inlineOpen) {
                                    // Close immediately if already open
                                    setInlineOpen(false);
                                } else {
                                    // Close any other inline menus and the global context menu first
                                    try { window.dispatchEvent(new Event('ph-close-inline-menus')); } catch (_) { }
                                    setContextMenu({ id: null, x: 0, y: 0, open: false });
                                    setInlineOpen(true);
                                }
                            }}
                        >
                            ⋮
                        </button>
                        {inlineOpen && (
                            <div className="ph-inline-menu absolute right-0 top-[30px] block" onClick={(e) => e.stopPropagation()}>
                                <ProjectActionsMenu variant="inline" id={p.id} projects={projects} setProjects={setProjects} setContextMenu={setContextMenu} onOpen={onOpen} onRequestClose={() => setInlineOpen(false)} setLoadingProjects={setLoadingProjects} />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProjectGridCard;
