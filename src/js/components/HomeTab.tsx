import React, { useEffect, useState, useCallback, useRef } from "react";
import { Plus, ImageOff, ChevronRight, Clock, LayoutGrid, Camera } from "lucide-react";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";
import ChangelogPanel from "./ChangelogPanel";

interface Screenshot {
    id: string;
    projectId: string;
    dataUrl: string;
    timestamp: number;
    thumbnailUrl: string;
}

export type Project = {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    lastOpenedAt?: number;
    description?: string;
    thumbnailDataUrl?: string;
    type?: string;
    folderId?: string | null;
};

export type Template = {
    id: string;
    name: string;
    description: string;
    thumbnail: string;
    mapUrl: string;
};

interface Props {
    projects: Project[];
    templates: Template[];
    onOpenProject: (id: string) => void;
    onNavigate: (nav: string) => void;
    onCreateFromTemplate: (template: Template) => void;
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
        return `${mins}m ago`;
    }
    if (diff < d) {
        const hrs = Math.round(diff / h);
        return `${hrs}h ago`;
    }
    if (diff < w * 2) {
        const days = Math.round(diff / d);
        return `${days}d ago`;
    }
    if (diff < mo * 2) {
        const weeks = Math.round(diff / w);
        return `${weeks}w ago`;
    }
    const months = Math.round(diff / mo);
    return `${months}mo ago`;
}

const SectionHeader: React.FC<{ title: string; onSeeAll: () => void; icon: React.ReactNode }> = ({ title, onSeeAll, icon }) => (
    <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-white/[0.06] text-white/40">
                {icon}
            </div>
            <h2 className="text-white/90 text-[14px] font-semibold tracking-wide uppercase">{title}</h2>
        </div>
        <button
            onClick={onSeeAll}
            className="flex items-center gap-1.5 text-white/30 hover:text-white/60 text-[12px] transition-all duration-200 bg-transparent border border-white/10 hover:border-white/20 hover:bg-white/[0.04] rounded-lg px-3 py-1.5 cursor-pointer"
        >
            See all
            <ChevronRight size={14} />
        </button>
    </div>
);

/* Subtle animated gradient border on hover */
const cardStyle = `
@keyframes homeCardShimmer {
    0% { opacity: 0; }
    100% { opacity: 1; }
}
.home-project-card {
    position: relative;
    transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s ease;
}
.home-project-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.12);
}
.home-project-card::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    padding: 1px;
    background: linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02), rgba(255,255,255,0.06));
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.25s ease;
}
.home-project-card:hover::before {
    opacity: 1;
}
.home-template-card {
    position: relative;
    transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s ease;
}
.home-template-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(43,106,255,0.25);
}
.home-screenshot-thumb {
    transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s ease;
}
.home-screenshot-thumb:hover {
    transform: scale(1.04);
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
}
.home-tab-fade-in {
    animation: homeCardShimmer 0.4s ease forwards;
}
.home-tab-stagger-1 { animation-delay: 0.05s; opacity: 0; }
.home-tab-stagger-2 { animation-delay: 0.1s; opacity: 0; }
.home-tab-stagger-3 { animation-delay: 0.15s; opacity: 0; }
.home-tab-stagger-4 { animation-delay: 0.2s; opacity: 0; }
.home-tab-stagger-5 { animation-delay: 0.25s; opacity: 0; }
.home-tab-stagger-6 { animation-delay: 0.3s; opacity: 0; }
`;

const HomeTab: React.FC<Props> = ({ projects, templates, onOpenProject, onNavigate, onCreateFromTemplate }) => {
    const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
    const [mounted, setMounted] = useState(false);
    const styleRef = useRef<HTMLStyleElement | null>(null);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (!styleRef.current) {
            const style = document.createElement("style");
            style.textContent = cardStyle;
            document.head.appendChild(style);
            styleRef.current = style;
        }
        return () => {
            if (styleRef.current) {
                document.head.removeChild(styleRef.current);
                styleRef.current = null;
            }
        };
    }, []);

    const loadScreenshots = useCallback(async () => {
        try {
            const projectList = await DatabaseManager.listProjects();
            const projectsOnly = projectList.filter((p: any) => p.type !== "folder");
            const allScreenshots: Screenshot[] = [];
            for (const project of projectsOnly) {
                const prefix = `${project.id}::screenshot::`;
                const projectScreenshots = await DatabaseManager.getAllDataWithPrefix(STORES.SCREENSHOTS, prefix);
                allScreenshots.push(...projectScreenshots);
            }
            allScreenshots.sort((a, b) => b.timestamp - a.timestamp);
            setScreenshots(allScreenshots);
        } catch (error) {
            console.error("Error loading screenshots:", error);
        }
    }, []);

    useEffect(() => {
        loadScreenshots();
    }, [loadScreenshots]);

    const recentProjects = projects.slice(0, 3);
    const recentScreenshots = screenshots.slice(0, 6);

    const clockIcon = <Clock size={16} />;
    const templateIcon = <LayoutGrid size={16} />;
    const cameraIcon = <Camera size={16} />;

    return (
        <div className="grid [grid-template-columns:1fr_300px] gap-0 h-full overflow-hidden">
            {/* Left column */}
            <div className="flex flex-col gap-10 overflow-y-auto pr-6 py-1 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.08)_transparent]">

                {/* Recently Opened */}
                <section className={`${mounted ? 'home-tab-fade-in home-tab-stagger-1' : 'opacity-0'}`}>
                    <SectionHeader title="Recent Projects" onSeeAll={() => onNavigate("my-files")} icon={clockIcon} />
                    {recentProjects.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] flex flex-col items-center justify-center py-12 px-6">
                            <div className="w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center mb-3">
                                <Plus size={24} className="text-white/20" />
                            </div>
                            <span className="text-white/30 text-[13px]">No projects yet</span>
                            <span className="text-white/20 text-[11px] mt-1">Create your first project to get started</span>
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 gap-4">
                            {recentProjects.map((p, i) => (
                                <div
                                    key={p.id}
                                    className={`home-project-card rounded-xl overflow-hidden bg-[#141821] border border-white/10 cursor-pointer group ${mounted ? `home-tab-fade-in home-tab-stagger-${i + 2}` : 'opacity-0'}`}
                                    onClick={() => onOpenProject(p.id)}
                                >
                                    <div className="relative w-full pt-[56.25%] overflow-hidden">
                                        {p.thumbnailDataUrl ? (
                                            <img
                                                className="object-cover absolute inset-0 w-full h-full transition-transform duration-500 ease-out group-hover:scale-[1.08]"
                                                alt={p.name}
                                                src={p.thumbnailDataUrl}
                                            />
                                        ) : (
                                            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#141821] to-[#0d1018]">
                                                <ImageOff size={28} className="text-white/10" />
                                            </div>
                                        )}
                                        {/* Gradient overlay at bottom of thumbnail */}
                                        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#141821] to-transparent pointer-events-none" />
                                    </div>
                                    <div className="px-3.5 pb-3 pt-1 flex items-center justify-between">
                                        <div className="min-w-0">
                                            <div className="text-white/90 text-[13px] font-medium truncate">{p.name || "Untitled"}</div>
                                            <div className="text-white/30 text-[11px] mt-0.5 flex items-center gap-1">
                                                <Clock size={12} className="shrink-0 opacity-60" />
                                                {formatLastEdited(p.updatedAt || p.createdAt)}
                                            </div>
                                        </div>
                                        <div className="w-7 h-7 rounded-lg bg-white/[0.06] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                                            <ChevronRight size={14} className="text-white/50" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {/* Templates */}
                <section className={`${mounted ? 'home-tab-fade-in home-tab-stagger-3' : 'opacity-0'}`}>
                    <SectionHeader title="Templates" onSeeAll={() => onNavigate("templates")} icon={templateIcon} />
                    <div className="grid grid-cols-3 gap-4">
                        {templates.map((template) => (
                            <div
                                key={template.id}
                                className="home-template-card rounded-xl overflow-hidden bg-[#141821] border border-white/10 cursor-pointer group"
                                onClick={() => onCreateFromTemplate(template)}
                            >
                                <div className="relative aspect-video overflow-hidden">
                                    <img
                                        src={template.thumbnail}
                                        alt={template.name}
                                        className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.08]"
                                    />
                                    {/* Play / use overlay */}
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-300 flex items-center justify-center">
                                        <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 scale-75 group-hover:scale-100">
                                            <Plus size={20} className="text-white" />
                                        </div>
                                    </div>
                                </div>
                                <div className="px-3.5 py-3 flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="text-white/90 text-[13px] font-medium">{template.name}</div>
                                        <div className="text-white/30 text-[11px] mt-0.5 leading-relaxed line-clamp-2">{template.description}</div>
                                    </div>
                                    <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-md bg-[#2b6aff]/15 text-[#6b9fff] font-medium mt-0.5">
                                        Template
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Screenshots */}
                <section className={`${mounted ? 'home-tab-fade-in home-tab-stagger-4' : 'opacity-0'} pb-4`}>
                    <SectionHeader title="Screenshots" onSeeAll={() => onNavigate("screenshots")} icon={cameraIcon} />
                    {recentScreenshots.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] flex flex-col items-center justify-center py-10 px-6">
                            <div className="w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center mb-3">
                                <Camera size={24} className="text-white/20" />
                            </div>
                            <span className="text-white/30 text-[13px]">No screenshots yet</span>
                            <span className="text-white/20 text-[11px] mt-1">Capture moments from your projects</span>
                        </div>
                    ) : (
                        <div className="grid grid-cols-6 gap-3">
                            {recentScreenshots.map((s, i) => (
                                <div
                                    key={s.id}
                                    className={`home-screenshot-thumb rounded-xl overflow-hidden cursor-pointer ring-1 ring-white/[0.06] hover:ring-white/20 ${mounted ? `home-tab-fade-in home-tab-stagger-${Math.min(i + 1, 6)}` : 'opacity-0'}`}
                                    onClick={() => onNavigate("screenshots")}
                                >
                                    <div className="aspect-video">
                                        <img
                                            src={s.thumbnailUrl}
                                            alt="Screenshot"
                                            className="w-full h-full object-cover"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>

            {/* Right column - changelog */}
            <div className="border-l border-white/10 overflow-hidden flex flex-col">
                <ChangelogPanel />
            </div>
        </div>
    );
};

export default HomeTab;
