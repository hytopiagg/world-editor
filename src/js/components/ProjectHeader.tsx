import React from "react";
import { Search, LayoutGrid, List, FolderPlus, Plus } from "lucide-react";

interface Crumb {
    label: string;
    onClick?: () => void;
}

interface Props {
    viewMode: 'grid' | 'list';
    setViewMode: (m: 'grid' | 'list') => void;
    query: string;
    setQuery: (q: string) => void;
    onCreate: () => void;
    onCreateFolder?: () => void;
    title?: string;
    breadcrumbs?: Crumb[];
    showNewFolder?: boolean;
}

const ProjectHeader: React.FC<Props> = ({ viewMode, setViewMode, query, setQuery, onCreate, onCreateFolder, title = 'My Files', breadcrumbs = [], showNewFolder = true }) => {
    return (
        <div className="flex items-center justify-between">
            <div className="flex gap-3 items-center">
                <div className="text-[16px] font-semibold text-white/90">
                    {breadcrumbs.length > 0 ? (
                        <div className="flex items-center gap-2">
                            {breadcrumbs.map((c, idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                    {idx > 0 && <span className="text-white/30">/</span>}
                                    {c.onClick ? (
                                        <button onClick={c.onClick} className="text-white/70 hover:text-white transition-colors">
                                            {c.label}
                                        </button>
                                    ) : (
                                        <span className="text-white/90">{c.label}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <span>{title}</span>
                    )}
                </div>
                {showNewFolder && (
                    <button onClick={onCreateFolder} className="inline-flex items-center gap-1.5 justify-center bg-white/[0.06] text-white/60 border border-white/10 hover:bg-white/10 hover:text-white/80 active:translate-y-0.5 rounded-xl py-1.5 px-3 text-[13px] transition-all duration-200">
                        <FolderPlus size={14} />
                        New Folder
                    </button>
                )}
            </div>
            <div className="flex gap-3 items-center">
                <div className="inline-flex gap-2">
                    <button
                        title="Grid view"
                        onClick={() => setViewMode('grid')}
                        className={`w-8 h-8 rounded-xl inline-flex items-center justify-center transition-colors duration-200 ${viewMode === 'grid' ? 'bg-white/10 text-white' : 'bg-white/[0.04] text-white/50 hover:bg-white/[0.08] hover:text-white/70'}`}
                    >
                        <LayoutGrid size={16} />
                    </button>
                    <button
                        title="List view"
                        onClick={() => setViewMode('list')}
                        className={`w-8 h-8 rounded-xl inline-flex items-center justify-center transition-colors duration-200 ${viewMode === 'list' ? 'bg-white/10 text-white' : 'bg-white/[0.04] text-white/50 hover:bg-white/[0.08] hover:text-white/70'}`}
                    >
                        <List size={16} />
                    </button>
                </div>
                <div className="relative inline-block">
                    <Search size={15} className="absolute left-[10px] top-1/2 -translate-y-1/2 text-white/40" />
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search"
                        className="bg-white/[0.06] border border-white/10 focus:border-white/20 text-[#eaeaea] py-2 px-2 rounded-xl min-w-[240px] pl-[32px] outline-none shadow-none text-[13px] transition-colors duration-200"
                    />
                </div>
                <button onClick={onCreate} className="inline-flex items-center gap-1.5 justify-center bg-[#2b6aff] hover:bg-[#2560e6] active:translate-y-0.5 text-white rounded-xl py-2 px-4 text-[13px] font-medium transition-all duration-200">
                    <Plus size={15} />
                    Create
                </button>
            </div>
        </div>
    );
};

export default ProjectHeader;
