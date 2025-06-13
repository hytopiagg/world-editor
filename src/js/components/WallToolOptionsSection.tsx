import { useState, useEffect } from "react";

interface WallToolOptionsSectionProps {
    wallTool: any;
    isCompactMode: boolean;
}

export default function WallToolOptionsSection({ wallTool, isCompactMode }: WallToolOptionsSectionProps) {
    const [wallHeight, setWallHeight] = useState<number>(wallTool?.wallHeight ?? 1);
    const [isDeleteMode, setIsDeleteMode] = useState<boolean>(wallTool?.isCtrlPressed ?? false);

    // Keep local state in sync with tool object
    useEffect(() => {
        if (!wallTool) return;
        const interval = setInterval(() => {
            setWallHeight(wallTool.wallHeight);
            setIsDeleteMode(wallTool.isCtrlPressed);
        }, 200);
        return () => clearInterval(interval);
    }, [wallTool]);

    if (!wallTool) {
        return <div className="text-xs text-[#F1F1F1]/60">Wall tool not initialised…</div>;
    }

    const updateHeight = (value: number) => {
        const newVal = Math.max(1, value);
        setWallHeight(newVal);
        wallTool.setWallHeight?.(newVal);
    };

    const toggleDeleteMode = () => {
        const newVal = !isDeleteMode;
        setIsDeleteMode(newVal);
        wallTool.isCtrlPressed = newVal;
        wallTool.updateWallPreviewMaterial?.();
    };

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs text-[#F1F1F1]">
                    <span className="text-xs text-[#F1F1F1] whitespace-nowrap">Delete Mode (Ctrl)</span>
                    <input
                        type="checkbox"
                        checked={isDeleteMode}
                        onChange={toggleDeleteMode}
                        className="w-4 h-4 rounded bg-white/10 border-white/10 checked:bg-red-500 checked:border-red-500"
                    />
                </div>
                <div className="flex items-center gap-x-2 w-full">
                    <label className="text-xs text-[#F1F1F1] whitespace-nowrap">Height</label>
                    <input
                        type="number"
                        min={1}
                        value={wallHeight}
                        onKeyDown={(e) => e.stopPropagation()}
                        onChange={e => updateHeight(parseInt(e.target.value))}
                        className="w-[34.5px] px-1 py-0.5 border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <input
                        type="range"
                        min={1}
                        max={100}
                        value={wallHeight}
                        onChange={e => updateHeight(parseInt(e.target.value))}
                        className="flex w-[inherit] h-1 bg-white/10 transition-all rounded-sm appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 animate-slider"
                    />
                </div>
            </div>
            <div className="flex flex-col gap-1 text-[10px] text-[#F1F1F1]/80 mt-1 bg-black/10 -mx-3 px-3 py-3 text-left">
                <p className="text-xs text-[#F1F1F1]/80 font-bold">Keyboard Shortcuts</p>
                <div className="flex items-center gap-1"><kbd className="bg-white/20 px-1 rounded">1</kbd>/<kbd className="bg-white/20 px-1 rounded">2</kbd> – Decrease/Increase height</div>
                <div className="flex items-center gap-1"><kbd className="bg-white/20 px-1 rounded">Ctrl</kbd> – Toggle delete mode</div>
                <div className="flex items-center gap-1"><kbd className="bg-white/20 px-1 rounded">Esc</kbd> – Cancel placement</div>
            </div>
        </div>
    );
} 