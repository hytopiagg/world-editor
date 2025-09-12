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
}

const ProjectGridCard: React.FC<Props> = ({ project: p, index, selected, hoveredId, setHoveredId, pressedCardId, setPressedCardId, onSelect, onOpen, projects, setProjects, setContextMenu }) => {
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
            onClick={(ev) => onSelect(p.id, index, ev)}
            onMouseDown={() => setPressedCardId(p.id)}
            onMouseUp={() => setPressedCardId(null)}
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
                    </div>
                </div>
            </div>
            <div className="p-3 flex flex-col gap-1 bg-transparent">
                <div className="flex items-center justify-between">
                    <div className="text-left">
                        <div className="font-semibold bg-transparent">{p.name || "Untitled"}</div>
                        <div className="opacity-70 text-[12px] bg-transparent"></div>
                    </div>
                    <div className="ph-menu relative transform-none w-[28px] h-[28px] inline-block z-[1100]" onClick={(e) => e.stopPropagation()}>
                        <button
                            className={`ph-menu-trigger bg-transparent border-0 text-[#cfd6e4] rounded-md w-[28px] h-[28px] cursor-pointer leading-none inline-flex items-center justify-center ${hoveredId === p.id ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
                            onClick={() => {
                                // Close any other inline menus and the global context menu first
                                try { window.dispatchEvent(new Event('ph-close-inline-menus')); } catch (_) { }
                                setContextMenu({ id: null, x: 0, y: 0, open: false });
                                setInlineOpen((v) => !v);
                            }}
                        >
                            ⋮
                        </button>
                        {inlineOpen && (
                            <div className="ph-inline-menu absolute right-0 top-[30px] block" onClick={(e) => e.stopPropagation()}>
                                <ProjectActionsMenu variant="inline" id={p.id} projects={projects} setProjects={setProjects} setContextMenu={setContextMenu} onOpen={onOpen} onRequestClose={() => setInlineOpen(false)} />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProjectGridCard;
