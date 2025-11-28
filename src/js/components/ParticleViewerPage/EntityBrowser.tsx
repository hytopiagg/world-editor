import React, { useState, useMemo } from "react";
import { environmentModels } from "../../EnvironmentBuilder";

interface EntityBrowserProps {
    onSelect: (modelUrl: string) => void;
    onClose: () => void;
}

export default function EntityBrowser({ onSelect, onClose }: EntityBrowserProps) {
    const [searchQuery, setSearchQuery] = useState("");

    const filteredEntities = useMemo(() => {
        if (!searchQuery.trim()) return environmentModels;
        const query = searchQuery.toLowerCase();
        return environmentModels.filter(entity =>
            entity.name.toLowerCase().includes(query) ||
            entity.category?.toLowerCase().includes(query)
        );
    }, [searchQuery]);

    return (
        <div className="flex fixed inset-0 z-50 justify-center items-center p-4 backdrop-blur-sm bg-black/60" onClick={onClose}>
            <div
                className="bg-[#0e1117] border border-white/10 rounded-lg w-full max-w-6xl max-h-[80vh] flex flex-col shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex justify-between items-center p-4 border-b border-white/10">
                    <h2 className="text-lg font-semibold text-white/80">Select Entity</h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                    >
                        <svg viewBox="0 0 24 24" className="w-5 h-5 stroke-white/60 fill-none stroke-[2]">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Search */}
                <div className="p-4 border-b border-white/10">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search entities by name..."
                        className="px-3 py-2 w-full text-sm text-white rounded-lg border bg-white/10 border-white/10 placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                        autoFocus
                    />
                </div>

                {/* Grid */}
                <div className="overflow-y-auto flex-1 p-4">
                    {filteredEntities.length === 0 ? (
                        <div className="py-8 text-center text-white/40">No entities found</div>
                    ) : (
                        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
                            {filteredEntities.map((entity) => {
                                // Construct thumbnail path using PUBLIC_URL (needed for Electron file:// protocol)
                                let thumbnailPath;
                                if (entity.thumbnailUrl) {
                                    if (entity.thumbnailUrl.startsWith("http://") || entity.thumbnailUrl.startsWith("https://") || entity.thumbnailUrl.startsWith("blob:")) {
                                        thumbnailPath = entity.thumbnailUrl;
                                    } else if (entity.thumbnailUrl.startsWith("assets/")) {
                                        const cleanPath = entity.thumbnailUrl.replace(/^\/+/, "");
                                        thumbnailPath = `${process.env.PUBLIC_URL || ""}/${cleanPath}`.replace(/\/+/g, "/").replace(/^\/\//, "/");
                                    } else {
                                        thumbnailPath = entity.thumbnailUrl;
                                    }
                                } else {
                                    thumbnailPath = entity.modelUrl.replace('.gltf', '_thumb.png');
                                }

                                return (
                                    <button
                                        key={entity.id}
                                        onClick={() => {
                                            onSelect(entity.modelUrl);
                                            onClose();
                                        }}
                                        className="flex overflow-hidden relative flex-col rounded-lg border transition-colors group aspect-square bg-white/5 border-white/10 hover:border-white/30"
                                        title={entity.name}
                                    >
                                        {/* Thumbnail */}
                                        <div className="flex flex-1 justify-center items-center p-2">
                                            {entity.thumbnailUrl ? (
                                                <img
                                                    src={thumbnailPath}
                                                    alt={entity.name}
                                                    className="object-contain w-full h-full"
                                                    onError={(e) => {
                                                        // Fallback to placeholder if thumbnail fails
                                                        (e.target as HTMLImageElement).style.display = 'none';
                                                        const placeholder = (e.target as HTMLElement).nextElementSibling as HTMLElement;
                                                        if (placeholder) placeholder.style.display = 'flex';
                                                    }}
                                                />
                                            ) : null}
                                            <div
                                                className="flex justify-center items-center w-full h-full text-xs text-white/20"
                                                style={{ display: entity.thumbnailUrl ? 'none' : 'flex' }}
                                            >
                                                <svg viewBox="0 0 24 24" className="w-8 h-8 stroke-current fill-none stroke-[1.5]">
                                                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                                </svg>
                                            </div>
                                        </div>

                                        {/* Name */}
                                        <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-white/80 text-[10px] px-1.5 py-1 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                                            {entity.name}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

