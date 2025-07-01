import React, { useEffect, useState, useMemo } from "react";
import { getBlockTypes, getBlockById } from "../managers/BlockTypesManager";

interface ReplaceToolOptionsSectionProps {
    replacementTool: any;
    isCompactMode: boolean;
}

export default function ReplaceToolOptionsSection({ replacementTool, isCompactMode }: ReplaceToolOptionsSectionProps) {
    const [settings, setSettings] = useState({
        radius: 8,
        shape: "sphere" as "sphere" | "cube",
        blockWeights: [{ id: 1, weight: 100 }],
    });

    /* List of available blocks (default + custom) */
    const availableBlocks = useMemo(() => {
        try {
            return getBlockTypes();
        } catch (_) {
            return [];
        }
    }, []);

    const [openSelectorIdx, setOpenSelectorIdx] = useState<number | null>(null);

    // Sync local state with tool settings periodically
    useEffect(() => {
        if (!replacementTool) return;
        const interval = setInterval(() => {
            if (replacementTool.settings) {
                setSettings({ ...replacementTool.settings });
            }
        }, 300);
        return () => clearInterval(interval);
    }, [replacementTool]);

    const updateTool = (partial: any) => {
        const newSettings = { ...settings, ...partial };
        setSettings(newSettings);
        replacementTool?.updateSettings?.(partial);
    };

    const updateBlockWeight = (idx: number, field: "id" | "weight", value: number) => {
        const updated = settings.blockWeights.map((bw, i) =>
            i === idx ? { ...bw, [field]: value } : bw
        );
        updateTool({ blockWeights: updated });
    };

    const addBlockWeight = () => {
        const newCount = settings.blockWeights.length + 1;
        const defaultWeight = Math.round((100 / newCount) * 10) / 10;

        // pick a random block not already in the list (fallback to 1)
        const existingIds = new Set(settings.blockWeights.map((bw) => bw.id));
        const candidates = availableBlocks.filter((b) => !existingIds.has(b.id));
        const randomId = candidates.length
            ? candidates[Math.floor(Math.random() * candidates.length)].id
            : 1;

        const newWeights = [
            ...settings.blockWeights.map((bw) => ({ ...bw, weight: defaultWeight })),
            { id: randomId, weight: defaultWeight },
        ];
        updateTool({ blockWeights: newWeights });
    };

    const removeBlockWeight = (idx: number) => {
        if (settings.blockWeights.length === 1) return;
        const newWeights = settings.blockWeights.filter((_bw, i) => i !== idx);
        updateTool({ blockWeights: newWeights });
    };

    const totalWeight = settings.blockWeights.reduce((s, w) => s + w.weight, 0);

    return (
        <div className="flex flex-col gap-3">
            {/* Shape selection */}
            <div className="flex gap-2 items-center fade-down opacity-0 duration-150" style={{ animationDelay: "0.05s" }}>
                <label className="text-xs text-[#F1F1F1] whitespace-nowrap">Shape</label>
                {(["sphere", "cube"] as const).map((sh) => (
                    <button
                        key={sh}
                        className={`px-2 py-1 text-xs rounded-md cursor-pointer border border-white/10 ${settings.shape === sh ? "bg-blue-500 text-white" : "bg-white/5 text-[#F1F1F1] hover:bg-white/10"}`}
                        onClick={() => updateTool({ shape: sh })}
                    >
                        {sh.charAt(0).toUpperCase() + sh.slice(1)}
                    </button>
                ))}
            </div>

            {/* Radius control */}
            <div className="flex items-center gap-x-2 fade-down opacity-0 duration-150" style={{ animationDelay: "0.075s" }}>
                <label className="text-xs text-[#F1F1F1] whitespace-nowrap">Size</label>
                <input
                    type="number"
                    min={1}
                    max={100}
                    value={settings.radius}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => updateTool({ radius: parseInt(e.target.value) })}
                    className="w-[40px] px-1 py-0.5 border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <input
                    type="range"
                    min="1"
                    max="100"
                    step="1"
                    value={settings.radius}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => updateTool({ radius: parseInt(e.target.value) })}
                    className="flex w-full h-1 bg-white/10 transition-all rounded-sm appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 animate-slider"
                />
            </div>



            {/* Block weights */}
            <div className="flex flex-col gap-2 fade-down opacity-0 duration-150" style={{ animationDelay: "0.1s" }}>
                <label className="text-xs text-[#F1F1F1]/80 text-left">Block Weights (Total {totalWeight.toFixed(1)}%)</label>
                <div className="flex flex-col gap-1">
                    {settings.blockWeights.map((bw, idx) => {
                        const block = getBlockById(bw.id) || {} as any;
                        return (
                            <div key={idx} className="flex flex-col gap-1">
                                <div className="flex items-center gap-1">
                                    <button
                                        className="w-8 h-8 bg-black/20 border border-white/20 rounded relative flex-shrink-0"
                                        onClick={() => setOpenSelectorIdx(openSelectorIdx === idx ? null : idx)}
                                        title={`Select block (ID ${bw.id})`}
                                    >
                                        {block.sideTextures["+y"] || block.textureUri ? (
                                            <img src={block.sideTextures["+y"] || block.textureUri} alt={block.name || bw.id} className="w-full h-full object-cover" />
                                        ) : (
                                            <span className="text-[8px] text-white">{bw.id}</span>
                                        )}
                                    </button>
                                    <input
                                        type="number"
                                        value={bw.weight}
                                        min={0}
                                        max={100}
                                        step={0.1}
                                        onKeyDown={(e) => e.stopPropagation()}
                                        onChange={(e) => { e.stopPropagation(); updateBlockWeight(idx, "weight", Math.round(parseFloat(e.target.value) * 10) / 10) }}
                                        className="w-12 px-1 py-0.5 text-xs bg-white/5 border border-white/10 rounded text-[#F1F1F1] focus:outline-none"
                                    />
                                    <button
                                        onClick={() => removeBlockWeight(idx)}
                                        className="text-xs px-1 text-red-400 bg-white/10 rounded-md"
                                        title="Remove"
                                    >
                                        –
                                    </button>
                                </div>
                                {openSelectorIdx === idx && (
                                    <div className="flex flex-wrap gap-1 p-1 bg-black/80 border border-white/20 rounded mt-1 max-h-32 overflow-y-auto">
                                        {availableBlocks.map((blk) => (
                                            <button
                                                key={blk.id}
                                                className="w-8 h-8 border border-white/10 hover:border-white/40 rounded"
                                                title={`${blk.name} (ID ${blk.id})`}
                                                onClick={() => {
                                                    updateBlockWeight(idx, "id", blk.id);
                                                    setOpenSelectorIdx(null);
                                                }}
                                            >
                                                <img src={blk.sideTextures["+y"] || blk.textureUri} alt={blk.name} className="w-full h-full object-cover" />
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    <button
                        onClick={addBlockWeight}
                        className="mt-1 text-xs px-1 py-0.5 bg-white/10 text-[#F1F1F1] rounded-md hover:bg-white/20 cursor-pointer"
                    >
                        + Add Block
                    </button>
                </div>
            </div>
        </div>
    );
} 