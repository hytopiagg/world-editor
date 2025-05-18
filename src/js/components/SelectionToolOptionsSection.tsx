import { useEffect, useState } from "react";
import QuickTipsManager from "./QuickTipsManager";

interface SelectionToolOptionsSectionProps {
    selectionTool: any;
    isCompactMode: boolean;
}

export default function SelectionToolOptionsSection({ selectionTool, isCompactMode }: SelectionToolOptionsSectionProps) {
    const [mode, setMode] = useState<string>(selectionTool?.selectionMode ?? "move");

    // Keep local state in sync with tool internal property
    useEffect(() => {
        if (!selectionTool) return;
        const interval = setInterval(() => {
            if (selectionTool.selectionMode && selectionTool.selectionMode !== mode) {
                setMode(selectionTool.selectionMode);
            }
        }, 300);
        return () => clearInterval(interval);
    }, [selectionTool, mode]);

    if (!selectionTool) {
        return <div className="text-xs text-[#F1F1F1]/60">Selection tool not initialised…</div>;
    }

    const applyMode = (newMode: "move" | "copy" | "delete") => {
        if (!selectionTool) return;
        if (selectionTool.selectionMode !== newMode) {
            selectionTool.selectionMode = newMode;
            // Attempt to refresh preview if active
            try {
                if (selectionTool.selectionStartPosition && selectionTool.previewPositionRef?.current) {
                    selectionTool.updateSelectionPreview(
                        selectionTool.selectionStartPosition,
                        selectionTool.previewPositionRef.current
                    );
                }
            } catch (_) { }
            setMode(newMode);
            QuickTipsManager.setToolTip(`Selection Mode: ${newMode}`);
        }
    };

    const btnClass = (m: string) =>
        `px-2 py-1 text-xs rounded-md cursor-pointer border border-white/10 ${mode === m ? "bg-blue-500 text-white" : "bg-white/5 text-[#F1F1F1] hover:bg-white/10"}`;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 fade-down opacity-0 duration-150" style={{ animationDelay: "0.05s" }}>

                <div className="flex gap-2">
                    <button className={btnClass("move")} onClick={() => applyMode("move")}>Move</button>
                    <button className={btnClass("copy")} onClick={() => applyMode("copy")}>Copy</button>
                    <button className={btnClass("delete")} onClick={() => applyMode("delete")}>Delete</button>
                </div>
            </div>

            {/* Keyboard shortcuts info */}
            <div className="flex flex-col gap-1 text-[10px] text-[#F1F1F1]/80 bg-black/10 -mx-3 px-3 py-3 text-left fade-down opacity-0 duration-150" style={{ animationDelay: "0.075s" }}>
                <p className="text-xs text-[#F1F1F1]/80 font-bold">Keyboard Shortcuts</p>
                <div className="flex items-center gap-1"><kbd className="bg-white/20 px-1 rounded">1</kbd>/<kbd className="bg-white/20 px-1 rounded">2</kbd> – Adjust vertical offset</div>
                <div className="flex items-center gap-1"><kbd className="bg-white/20 px-1 rounded">3</kbd> – Rotate or cycle modes</div>
                <div className="flex items-center gap-1"><kbd className="bg-white/20 px-1 rounded">T</kbd> – Save selection as schematic</div>
                <div className="flex items-center gap-1"><kbd className="bg-white/20 px-1 rounded">Esc</kbd> – Cancel selection</div>
            </div>
        </div>
    );
} 