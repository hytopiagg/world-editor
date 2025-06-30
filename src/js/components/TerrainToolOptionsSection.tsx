import React, { useState, useEffect } from "react";

interface TerrainToolOptionsSectionProps {
    terrainTool: any;
    isCompactMode: boolean;
}

export default function TerrainToolOptionsSection({
    terrainTool,
    isCompactMode,
}: TerrainToolOptionsSectionProps) {
    const [settings, setSettings] = useState({
        radius: 8,
        yLimit: 32,
        smoothing: 0.5,
        elevationRate: 2.0, // Increased default for better responsiveness
        noiseScale: 0.1,
        falloffCurve: "smooth",
        mode: "elevate",
    });

    // Keep local state in sync with tool internal properties
    useEffect(() => {
        if (!terrainTool) return;
        const interval = setInterval(() => {
            if (terrainTool.settings) {
                setSettings(terrainTool.settings);
            }
        }, 200);
        return () => clearInterval(interval);
    }, [terrainTool]);

    const updateSetting = (key: string, value: any) => {
        const newSettings = { ...settings, [key]: value };
        setSettings(newSettings);

        if (terrainTool && terrainTool.updateSettings) {
            terrainTool.updateSettings({ [key]: value });
        }
    };

    if (!terrainTool) {
        return <div className="text-xs text-[#F1F1F1]/60">Terrain tool not initialised…</div>;
    }

    return (
        <div className="flex flex-col gap-3">
            {/* Mode Selection */}
            <div className="flex flex-col gap-2">
                <div className="flex gap-2 fade-down opacity-0 duration-150" style={{ animationDelay: "0.05s" }}>
                    {[
                        { key: "elevate", label: "Elevate" },
                        { key: "flatten", label: "Flatten" },
                        { key: "smooth", label: "Smooth" }
                    ].map((modeOption) => (
                        <button
                            key={modeOption.key}
                            className={`px-2 py-1 text-xs rounded-md cursor-pointer border border-white/10 ${settings.mode === modeOption.key
                                ? "bg-blue-500 text-white"
                                : "bg-white/5 text-[#F1F1F1] hover:bg-white/10"
                                }`}
                            onClick={() => updateSetting("mode", modeOption.key)}
                        >
                            {modeOption.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Radius Control */}
            <div className="flex items-center gap-x-2 w-full fade-down opacity-0 duration-150" style={{ animationDelay: "0.075s" }}>
                <label className="text-xs text-[#F1F1F1] whitespace-nowrap">Radius</label>
                <input
                    type="number"
                    min={1}
                    max={50}
                    value={settings.radius}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => updateSetting("radius", parseInt(e.target.value))}
                    className="w-[40px] px-1 py-0.5 border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <input
                    type="range"
                    min="1"
                    max="100"
                    step="1"
                    value={settings.radius}
                    onChange={(e) => updateSetting("radius", parseInt(e.target.value))}
                    className="flex w-[inherit] h-1 bg-white/10 transition-all rounded-sm appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 animate-slider"
                />
            </div>

            {/* Y-Limit Control */}
            <div className="flex items-center gap-x-2 w-full fade-down opacity-0 duration-150" style={{ animationDelay: "0.1s" }}>
                <label className="text-xs text-[#F1F1F1] whitespace-nowrap">Y-Limit</label>
                <input
                    type="number"
                    min={4}
                    max={64}
                    value={settings.yLimit}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => updateSetting("yLimit", parseInt(e.target.value))}
                    className="w-[34.5px] px-1 py-0.5 border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <input
                    type="range"
                    min="4"
                    max="64"
                    step="1"
                    value={settings.yLimit}
                    onChange={(e) => updateSetting("yLimit", parseInt(e.target.value))}
                    className="flex w-[inherit] h-1 bg-white/10 transition-all rounded-sm appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 animate-slider"
                />
            </div>

            {/* Elevation Rate Control */}
            <div className="flex items-center gap-x-2 w-full fade-down opacity-0 duration-150" style={{ animationDelay: "0.125s" }}>
                <label className="text-xs text-[#F1F1F1] whitespace-nowrap">Rate</label>
                <input
                    type="number"
                    min={0.1}
                    max={10.0}
                    step={0.1}
                    value={settings.elevationRate.toFixed(1)}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => updateSetting("elevationRate", parseFloat(e.target.value))}
                    className="w-[40px] px-1 py-0.5 border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <input
                    type="range"
                    min="0.1"
                    max="10.0"
                    step="0.1"
                    value={settings.elevationRate}
                    onChange={(e) => updateSetting("elevationRate", parseFloat(e.target.value))}
                    className="flex w-[inherit] h-1 bg-white/10 transition-all rounded-sm appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 animate-slider"
                />
            </div>

            {/* Smoothing Control */}
            <div className="flex items-center gap-x-2 w-full fade-down opacity-0 duration-150" style={{ animationDelay: "0.15s" }}>
                <label className="text-xs text-[#F1F1F1] whitespace-nowrap">Smooth</label>
                <input
                    type="number"
                    min={0.0}
                    max={1.0}
                    step={0.1}
                    value={settings.smoothing.toFixed(1)}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => updateSetting("smoothing", parseFloat(e.target.value))}
                    className="w-[40px] px-1 py-0.5 border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <input
                    type="range"
                    min="0.0"
                    max="1.0"
                    step="0.1"
                    value={settings.smoothing}
                    onChange={(e) => updateSetting("smoothing", parseFloat(e.target.value))}
                    className="flex w-[inherit] h-1 bg-white/10 transition-all rounded-sm appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 animate-slider"
                />
            </div>

            {/* Noise Scale Control */}
            <div className="flex items-center gap-x-2 w-full fade-down opacity-0 duration-150" style={{ animationDelay: "0.175s" }}>
                <label className="text-xs text-[#F1F1F1] whitespace-nowrap">Noise</label>
                <input
                    type="number"
                    min={0.01}
                    max={0.5}
                    step={0.01}
                    value={settings.noiseScale.toFixed(2)}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => updateSetting("noiseScale", parseFloat(e.target.value))}
                    className="w-[45px] px-1 py-0.5 border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <input
                    type="range"
                    min="0.01"
                    max="0.5"
                    step="0.01"
                    value={settings.noiseScale}
                    onChange={(e) => updateSetting("noiseScale", parseFloat(e.target.value))}
                    className="flex w-[inherit] h-1 bg-white/10 transition-all rounded-sm appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 animate-slider"
                />
            </div>

            {/* Falloff Curve Selection */}
            <div className="flex items-center gap-x-2 w-full fade-down opacity-0 duration-150" style={{ animationDelay: "0.2s" }}>
                <label className="text-xs text-[#F1F1F1] whitespace-nowrap">Falloff</label>
                <select
                    value={settings.falloffCurve}
                    onChange={(e) => updateSetting("falloffCurve", e.target.value)}
                    className="flex-1 px-2 py-1 bg-white/5 border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs focus:outline-none"
                >
                    <option value="smooth">Smooth</option>
                    <option value="linear">Linear</option>
                    <option value="sharp">Sharp</option>
                </select>
            </div>

            {/* Quick Presets */}
            <div className="flex flex-col gap-2 fade-down opacity-0 duration-150" style={{ animationDelay: "0.225s" }}>
                <label className="text-xs text-[#F1F1F1]/80 text-left">Quick Presets</label>
                <div
                    style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
                    className="grid gap-1.5">
                    {[
                        { name: "Hill", preset: { radius: 8, elevationRate: 4.0, smoothing: 0.8, mode: "elevate" } },
                        { name: "Plateau", preset: { radius: 16, elevationRate: 2.0, smoothing: 0.9, mode: "flatten" } },
                        { name: "Smooth", preset: { radius: 12, elevationRate: 3.0, smoothing: 0.7, mode: "smooth" } },
                        { name: "Rocky", preset: { radius: 10, elevationRate: 6.0, smoothing: 0.3, mode: "elevate", noiseScale: 0.25 } }
                    ].map((preset) => (
                        <button
                            key={preset.name}
                            onClick={() => {
                                setSettings({ ...settings, ...preset.preset });
                                if (terrainTool && terrainTool.updateSettings) {
                                    terrainTool.updateSettings(preset.preset);
                                }
                            }}
                            className="px-2 py-1 text-xs bg-white/5 hover:bg-white/10 text-[#F1F1F1] border border-white/10 hover:border-white/20 rounded transition-colors cursor-pointer"
                        >
                            {preset.name}
                        </button>
                    ))}
                </div>
            </div>

            {/* Keyboard Shortcuts Info */}
            <div className="flex flex-col gap-1 text-[10px] text-[#F1F1F1]/80 bg-black/10 -mx-3 px-3 py-3 text-left fade-down opacity-0 duration-150" style={{ animationDelay: "0.25s" }}>
                <p className="text-xs text-[#F1F1F1]/80 font-bold">Keyboard Shortcuts</p>
                <div className="flex items-center gap-1"><kbd className="bg-white/20 px-1 rounded">1</kbd>/<kbd className="bg-white/20 px-1 rounded">2</kbd> – Decrease/Increase radius</div>
                <div className="flex items-center gap-1"><kbd className="bg-white/20 px-1 rounded">3</kbd>/<kbd className="bg-white/20 px-1 rounded">4</kbd> – Adjust elevation rate</div>
                <div className="flex items-center gap-1"><kbd className="bg-white/20 px-1 rounded">Esc</kbd> – Cancel operation</div>
            </div>
        </div>
    );
} 