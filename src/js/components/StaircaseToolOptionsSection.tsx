import { useState, useEffect } from "react";

interface StaircaseToolOptionsSectionProps {
    staircaseTool: any;
    isCompactMode: boolean;
}

export default function StaircaseToolOptionsSection({ staircaseTool, isCompactMode }: StaircaseToolOptionsSectionProps) {
    const [staircaseWidth, setStaircaseWidth] = useState<number>(staircaseTool?.staircaseWidth ?? 1);
    const [isDeleteMode, setIsDeleteMode] = useState<boolean>(staircaseTool?.isCtrlPressed ?? false);
    const [fillUnderneath, setFillUnderneath] = useState<boolean>(staircaseTool?.fillUnderneath ?? false);

    useEffect(() => {
        if (!staircaseTool) return;
        const interval = setInterval(() => {
            setStaircaseWidth(staircaseTool.staircaseWidth);
            setIsDeleteMode(staircaseTool.isCtrlPressed);
            setFillUnderneath(staircaseTool.fillUnderneath);
        }, 200);
        return () => clearInterval(interval);
    }, [staircaseTool]);

    if (!staircaseTool) {
        return <div className="text-xs text-[#F1F1F1]/60">Staircase tool not initialised…</div>;
    }

    // Handlers -------------------------------------------------------------
    const updateWidth = (value: number) => {
        const newVal = Math.max(1, value);
        setStaircaseWidth(newVal);
        staircaseTool.setStaircaseWidth?.(newVal);
    };

    const toggleDeleteMode = () => {
        const newVal = !isDeleteMode;
        setIsDeleteMode(newVal);
        staircaseTool.isCtrlPressed = newVal;
        staircaseTool.updateStaircasePreviewMaterial?.();
    };

    const toggleFillUnderneath = () => {
        const newVal = !fillUnderneath;
        setFillUnderneath(newVal);
        staircaseTool.setFillUnderneath?.(newVal);
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
                <div className="flex items-center justify-between text-xs text-[#F1F1F1]">
                    <span className="text-xs text-[#F1F1F1] whitespace-nowrap">Fill Underneath (3)</span>
                    <input
                        type="checkbox"
                        checked={fillUnderneath}
                        onChange={toggleFillUnderneath}
                        className="w-4 h-4 rounded bg-white/10 border-white/10 checked:bg-blue-500 checked:border-blue-500"
                    />
                </div>
                <div className="flex gap-x-2 items-center w-full">
                    <label className="text-xs text-[#F1F1F1] whitespace-nowrap">Width</label>
                    <input
                        type="number"
                        min={1}
                        value={staircaseWidth}
                        onKeyDown={(e) => e.stopPropagation()}
                        onChange={e => updateWidth(parseInt(e.target.value))}
                        className="w-[34.5px] px-1 py-0.5 bg-white/10 border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    {/* add slider */}
                    <input
                        type="range"
                        min={1}
                        max={20}
                        value={staircaseWidth}
                        onChange={e => updateWidth(parseInt(e.target.value))}
                        className="flex w-[inherit] h-1 bg-white/10 transition-all rounded-sm appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 animate-slider"
                    />
                </div>
            </div>
            {/* <div className="flex flex-col gap-1 text-[10px] text-[#F1F1F1]/80 mt-1 border-t border-white/10 pt-2"> */}
            <div className="flex flex-col gap-1 text-[10px] text-[#F1F1F1]/80 mt-1 bg-black/10 -mx-3 px-3 py-3 text-left">
                <p className="text-xs text-[#F1F1F1]/80 font-bold">Keyboard Shortcuts</p>
                <div className="flex gap-1 items-center"><kbd className="px-1 rounded bg-white/20">1</kbd>/<kbd className="px-1 rounded bg-white/20">2</kbd> – Decrease/Increase width</div>
                <div className="flex gap-1 items-center"><kbd className="px-1 rounded bg-white/20">3</kbd> – Toggle fill underneath</div>
                <div className="flex gap-1 items-center"><kbd className="px-1 rounded bg-white/20">Ctrl</kbd> – Toggle delete mode</div>
                <div className="flex gap-1 items-center"><kbd className="px-1 rounded bg-white/20">Esc</kbd> – Cancel placement</div>
            </div>
        </div>
    );
}

