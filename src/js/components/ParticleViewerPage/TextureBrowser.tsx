import React, { useState, useMemo } from "react";

interface TextureBrowserProps {
    onSelect: (textureName: string) => void;
    onClose: () => void;
}

const availableTextures = [
    "circle_01.png", "circle_02.png", "circle_03.png", "circle_04.png", "circle_05.png",
    "dirt_01.png", "dirt_02.png", "dirt_03.png",
    "fire_01.png", "fire_02.png", "fire.png",
    "flame_01.png", "flame_02.png", "flame_03.png", "flame_04.png", "flame_05.png", "flame_06.png",
    "flare_01.png",
    "light_01.png", "light_02.png", "light_03.png",
    "magic_01.png", "magic_02.png", "magic_03.png", "magic_04.png", "magic_05.png", "magic.png",
    "muzzle_01.png", "muzzle_02.png", "muzzle_03.png", "muzzle_04.png", "muzzle_05.png",
    "scorch_01.png", "scorch_02.png", "scorch_03.png",
    "scratch_01.png",
    "slash_01.png", "slash_02.png", "slash_03.png", "slash_04.png",
    "smoke_01.png", "smoke_02.png", "smoke_03.png", "smoke_04.png", "smoke_05.png",
    "smoke_06.png", "smoke_07.png", "smoke_08.png", "smoke_09.png", "smoke_10.png", "smoke.png",
    "spark_01.png", "spark_02.png", "spark_03.png", "spark_04.png", "spark_05.png", "spark_06.png", "spark_07.png",
    "star_01.png", "star_02.png", "star_03.png", "star_04.png", "star_05.png",
    "star_06.png", "star_07.png", "star_08.png", "star_09.png",
    "symbol_01.png", "symbol_02.png",
    "trace_01.png", "trace_02.png", "trace_03.png", "trace_04.png", "trace_05.png", "trace_06.png", "trace_07.png",
    "twirl_01.png", "twirl_02.png", "twirl_03.png",
    "window_01.png", "window_02.png", "window_03.png", "window_04.png",
];

export default function TextureBrowser({ onSelect, onClose }: TextureBrowserProps) {
    const [searchQuery, setSearchQuery] = useState("");

    const filteredTextures = useMemo(() => {
        if (!searchQuery.trim()) return availableTextures;
        const query = searchQuery.toLowerCase();
        return availableTextures.filter(tex => tex.toLowerCase().includes(query));
    }, [searchQuery]);

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div 
                className="bg-[#0e1117] border border-white/10 rounded-lg w-full max-w-4xl max-h-[80vh] flex flex-col shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10">
                    <h2 className="text-white/80 text-lg font-semibold">Select Texture</h2>
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
                        placeholder="Search textures..."
                        className="w-full px-3 py-2 bg-white/10 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                        autoFocus
                    />
                </div>

                {/* Grid */}
                <div className="flex-1 overflow-y-auto p-4">
                    {filteredTextures.length === 0 ? (
                        <div className="text-center text-white/40 py-8">No textures found</div>
                    ) : (
                        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
                            {filteredTextures.map((textureName) => {
                                const texturePath = `./assets/particles/${textureName}`;
                                return (
                                    <button
                                        key={textureName}
                                        onClick={() => {
                                            onSelect(textureName);
                                            onClose();
                                        }}
                                        className="group relative aspect-square bg-white/5 border border-white/10 rounded-lg overflow-hidden hover:border-white/30 transition-colors"
                                        title={textureName}
                                    >
                                        <img
                                            src={texturePath}
                                            alt={textureName}
                                            className="w-full h-full object-contain p-2"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = 'none';
                                            }}
                                        />
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                                        <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-white/80 text-[10px] px-1.5 py-1 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                                            {textureName}
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

