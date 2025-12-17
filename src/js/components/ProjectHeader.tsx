import React from "react";

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
                <div className="text-[18px] font-bold">
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
                    <button onClick={onCreateFolder} className="inline-flex items-center justify-center bg-[#1a1e24] text-[#cfd6e4] border border-[#2b2f36] rounded-lg py-1.5 px-3 text-[13px]">
                        + New Folder
                    </button>
                )}
            </div>
            <div className="flex gap-3 items-center">
                <div className="inline-flex gap-2">
                    <button
                        title="Grid view"
                        onClick={() => setViewMode('grid')}
                        className={`w-8 h-8 rounded-lg inline-flex items-center justify-center ${viewMode === 'grid' ? 'bg-white/5 text-white' : 'bg-[#0e131a] text-[#cfd6e4]'}`}
                    >
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <rect x="4" y="4" width="6" height="6" rx="1" fill="currentColor" opacity="0.9" />
                            <rect x="14" y="4" width="6" height="6" rx="1" fill="currentColor" opacity="0.9" />
                            <rect x="4" y="14" width="6" height="6" rx="1" fill="currentColor" opacity="0.9" />
                            <rect x="14" y="14" width="6" height="6" rx="1" fill="currentColor" opacity="0.9" />
                        </svg>
                    </button>
                    <button
                        title="List view"
                        onClick={() => setViewMode('list')}
                        className={`w-8 h-8 rounded-lg inline-flex items-center justify-center ${viewMode === 'list' ? 'bg-white/5 text-white' : 'bg-[#0e131a] text-[#cfd6e4]'}`}
                    >
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <circle cx="6" cy="7" r="1.5" fill="currentColor" />
                            <rect x="9" y="6" width="11" height="2" rx="1" fill="currentColor" />
                            <circle cx="6" cy="12" r="1.5" fill="currentColor" />
                            <rect x="9" y="11" width="11" height="2" rx="1" fill="currentColor" />
                            <circle cx="6" cy="17" r="1.5" fill="currentColor" />
                            <rect x="9" y="16" width="11" height="2" rx="1" fill="currentColor" />
                        </svg>
                    </button>
                </div>
                <div className="relative inline-block">
                    <svg viewBox="0 0 24 24" width="16" height="16" className="absolute left-[10px] top-1/2 -translate-y-1/2 text-white/60">
                        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" fill="none" />
                        <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" strokeWidth="2" />
                    </svg>
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search"
                        className="bg-[#0e131a] border-0 text-[#eaeaea] py-2 px-2 rounded-lg min-w-[240px] pl-[30px] outline-none shadow-none"
                    />
                </div>
                <button onClick={onCreate} className="inline-flex items-center justify-center bg-[#2b6aff] text-white rounded-lg py-2 px-3">
                    Create
                </button>
            </div>
        </div>
    );
};

export default ProjectHeader;
