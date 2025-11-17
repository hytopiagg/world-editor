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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div 
                className="bg-[#0e1117] border border-white/10 rounded-lg w-full max-w-6xl max-h-[80vh] flex flex-col shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10">
                    <h2 className="text-white/80 text-lg font-semibold">Select Entity</h2>
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
                        className="w-full px-3 py-2 bg-white/10 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                        autoFocus
                    />
                </div>

                {/* Grid */}
                <div className="flex-1 overflow-y-auto p-4">
                    {filteredEntities.length === 0 ? (
                        <div className="text-center text-white/40 py-8">No entities found</div>
                    ) : (
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                            {filteredEntities.map((entity) => {
                                const thumbnailPath = entity.thumbnailUrl 
                                    ? `./${entity.thumbnailUrl}` 
                                    : entity.modelUrl.replace('.gltf', '_thumb.png');
                                
                                return (
                                    <button
                                        key={entity.id}
                                        onClick={() => {
                                            onSelect(entity.modelUrl);
                                            onClose();
                                        }}
                                        className="group relative aspect-square bg-white/5 border border-white/10 rounded-lg overflow-hidden hover:border-white/30 transition-colors flex flex-col"
                                        title={entity.name}
                                    >
                                        {/* Thumbnail */}
                                        <div className="flex-1 flex items-center justify-center p-2">
                                            {entity.thumbnailUrl ? (
                                                <img
                                                    src={thumbnailPath}
                                                    alt={entity.name}
                                                    className="w-full h-full object-contain"
                                                    onError={(e) => {
                                                        // Fallback to placeholder if thumbnail fails
                                                        (e.target as HTMLImageElement).style.display = 'none';
                                                        const placeholder = (e.target as HTMLElement).nextElementSibling as HTMLElement;
                                                        if (placeholder) placeholder.style.display = 'flex';
                                                    }}
                                                />
                                            ) : null}
                                            <div 
                                                className="w-full h-full flex items-center justify-center text-white/20 text-xs"
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

