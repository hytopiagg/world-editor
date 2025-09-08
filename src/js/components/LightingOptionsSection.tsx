import { useEffect, useMemo, useState } from "react";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";

interface LightingOptionsSectionProps {
    terrainBuilderRef: any;
}

export default function LightingOptionsSection({ terrainBuilderRef }: LightingOptionsSectionProps) {
    type LightSettings = { color?: string; intensity?: number };
    const [ambientColor, setAmbientColor] = useState<string>("#ffffff");
    const [ambientIntensity, setAmbientIntensity] = useState<number>(0.25);
    const [dirColor, setDirColor] = useState<string>("#ffffff");
    const [dirIntensity, setDirIntensity] = useState<number>(2);

    const clampIntensity = (v: number, min = 0, max = 10) => Math.max(min, Math.min(max, v));

    // Initialize from saved settings if available; fall back to current scene lights
    useEffect(() => {
        const tb = terrainBuilderRef?.current;
        (async () => {
            try {
                const savedAmb = (await DatabaseManager.getData(STORES.SETTINGS, `project:${DatabaseManager.getCurrentProjectId()}:ambientLight`)) as LightSettings | null;
                if (savedAmb && (typeof savedAmb.color === "string" || typeof savedAmb.intensity === "number")) {
                    if (typeof savedAmb.color === "string") setAmbientColor(savedAmb.color);
                    if (typeof savedAmb.intensity === "number") setAmbientIntensity(savedAmb.intensity);
                    tb?.setAmbientLight?.({
                        color: typeof savedAmb.color === "string" ? savedAmb.color : undefined,
                        intensity: typeof savedAmb.intensity === "number" ? savedAmb.intensity : undefined,
                    });
                } else {
                    try {
                        const amb = tb?.getAmbientLight?.();
                        if (amb) {
                            setAmbientColor(amb.color);
                            setAmbientIntensity(amb.intensity);
                        }
                    } catch (_) { }
                }
            } catch (_) { }

            try {
                const savedDir = (await DatabaseManager.getData(STORES.SETTINGS, `project:${DatabaseManager.getCurrentProjectId()}:directionalLight`)) as LightSettings | null;
                if (savedDir && (typeof savedDir.color === "string" || typeof savedDir.intensity === "number")) {
                    if (typeof savedDir.color === "string") setDirColor(savedDir.color);
                    if (typeof savedDir.intensity === "number") setDirIntensity(savedDir.intensity);
                    tb?.setDirectionalLight?.({
                        color: typeof savedDir.color === "string" ? savedDir.color : undefined,
                        intensity: typeof savedDir.intensity === "number" ? savedDir.intensity : undefined,
                    });
                } else {
                    try {
                        const dir = tb?.getDirectionalLight?.();
                        if (dir) {
                            setDirColor(dir.color);
                            setDirIntensity(dir.intensity);
                        }
                    } catch (_) { }
                }
            } catch (_) { }
        })();
    }, [terrainBuilderRef]);

    // Listen for global lighting resets (e.g., map cleared) and update local state without re-saving
    useEffect(() => {
        const handler = (e: Event) => {
            try {
                const { ambient, directional } = (e as CustomEvent).detail || {};
                if (ambient) {
                    if (typeof ambient.color === "string") setAmbientColor(ambient.color);
                    if (typeof ambient.intensity === "number") setAmbientIntensity(ambient.intensity);
                }
                if (directional) {
                    if (typeof directional.color === "string") setDirColor(directional.color);
                    if (typeof directional.intensity === "number") setDirIntensity(directional.intensity);
                }
            } catch (_) { }
        };
        window.addEventListener("lighting-reset", handler as EventListener);
        return () => window.removeEventListener("lighting-reset", handler as EventListener);
    }, []);

    const labelCls = useMemo(() => "text-xs text-[#F1F1F1] whitespace-nowrap", []);
    const numberInputCls = useMemo(() => "w-[34.5px] px-1 py-0.5 bg-white/10 border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none", []);

    const applyAmbient = async (next: { color?: string; intensity?: number }) => {
        const tb = terrainBuilderRef?.current;
        tb?.setAmbientLight?.(next);
        try {
            const toSave = {
                color: next.color !== undefined ? next.color : ambientColor,
                intensity: next.intensity !== undefined ? next.intensity : ambientIntensity,
            };
            await DatabaseManager.saveData(STORES.SETTINGS, `project:${DatabaseManager.getCurrentProjectId()}:ambientLight`, toSave);
        } catch (_) { }
    };
    const applyDirectional = async (next: { color?: string; intensity?: number }) => {
        const tb = terrainBuilderRef?.current;
        tb?.setDirectionalLight?.(next);
        try {
            const toSave = {
                color: next.color !== undefined ? next.color : dirColor,
                intensity: next.intensity !== undefined ? next.intensity : dirIntensity,
            };
            await DatabaseManager.saveData(STORES.SETTINGS, `project:${DatabaseManager.getCurrentProjectId()}:directionalLight`, toSave);
        } catch (_) { }
    };

    return (
        <div className="flex flex-col gap-3">
            {/* Intensities Group */}
            <div className="flex flex-col gap-2 opacity-0 duration-150 fade-down" style={{ animationDelay: "0.04s" }}>
                <span className="text-xs text-[#F1F1F1]/60 text-left">Intensities</span>
                <div className="flex gap-x-2 items-center w-full">
                    <label className={labelCls}>Ambient</label>
                    <input
                        type="number"
                        className={numberInputCls}
                        value={ambientIntensity}
                        min={0}
                        max={10}
                        step={0.05}
                        onChange={(e) => {
                            const v = clampIntensity(Number(e.target.value));
                            setAmbientIntensity(v);
                            applyAmbient({ intensity: v });
                        }}
                        onKeyDown={(e: any) => e.stopPropagation()}
                    />
                    <input
                        type="range"
                        min={0}
                        max={10}
                        step={0.05}
                        value={ambientIntensity}
                        onChange={(e) => {
                            const v = clampIntensity(Number(e.target.value));
                            setAmbientIntensity(v);
                            applyAmbient({ intensity: v });
                        }}
                        className="flex w-[inherit] h-1 bg-white/10 transition-all rounded-sm appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 animate-slider"
                        style={{
                            transition: "all 0.3s ease-in-out",
                            background: `linear-gradient(to right, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0.8) ${(ambientIntensity - 0) / (10 - 0) * 100}%, rgba(255, 255, 255, 0.1) ${(ambientIntensity - 0) / (10 - 0) * 100}%, rgba(255, 255, 255, 0.1) 100%)`
                        }}
                    />
                </div>
                <div className="flex gap-x-2 items-center w-full">
                    <label className={labelCls}>Directional</label>
                    <input
                        type="number"
                        className={numberInputCls}
                        value={dirIntensity}
                        min={0}
                        max={10}
                        step={0.05}
                        onChange={(e) => {
                            const v = clampIntensity(Number(e.target.value));
                            setDirIntensity(v);
                            applyDirectional({ intensity: v });
                        }}
                        onKeyDown={(e: any) => e.stopPropagation()}
                    />
                    <input
                        type="range"
                        min={0}
                        max={10}
                        step={0.05}
                        value={dirIntensity}
                        onChange={(e) => {
                            const v = clampIntensity(Number(e.target.value));
                            setDirIntensity(v);
                            applyDirectional({ intensity: v });
                        }}
                        className="flex w-[inherit] h-1 bg-white/10 transition-all rounded-sm appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 animate-slider"
                        style={{
                            transition: "all 0.3s ease-in-out",
                            background: `linear-gradient(to right, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0.8) ${(dirIntensity - 0) / (10 - 0) * 100}%, rgba(255, 255, 255, 0.1) ${(dirIntensity - 0) / (10 - 0) * 100}%, rgba(255, 255, 255, 0.1) 100%)`
                        }}
                    />
                </div>
            </div>

            {/* Colors Group */}
            <div className="flex flex-col gap-2 opacity-0 duration-150 fade-down" style={{ animationDelay: "0.02s" }}>
                <span className="text-xs text-[#F1F1F1]/60 text-left">Colors</span>
                <div className="flex gap-x-2 items-center w-full">
                    <label className={labelCls}>Ambient</label>
                    <input
                        type="color"
                        value={ambientColor}
                        onChange={(e) => {
                            const value = e.target.value;
                            setAmbientColor(value);
                            applyAmbient({ color: value });
                        }}
                        className="p-0 bg-transparent rounded border border-white/20"
                        style={{ width: 24, height: 24 }}
                    />
                </div>
                <div className="flex gap-x-2 items-center w-full">
                    <label className={labelCls}>Directional</label>
                    <input
                        type="color"
                        value={dirColor}
                        onChange={(e) => {
                            const value = e.target.value;
                            setDirColor(value);
                            applyDirectional({ color: value });
                        }}
                        className="p-0 bg-transparent rounded border border-white/20"
                        style={{ width: 24, height: 24 }}
                    />
                </div>
            </div>
        </div>
    );
}


