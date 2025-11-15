import { useEffect, useState } from "react";
import "../../css/QuickTips.css";
import SelectionDimensionsManager, { SelectionDimensionsPayload } from "./SelectionDimensionsManager";

function formatDimensions(payload: SelectionDimensionsPayload): string {
    const width = payload.width ?? 0;
    const length = payload.length ?? 0;
    const height = payload.height ?? 0;
    const thickness = payload.thickness;

    const base = `${Math.max(0, Math.round(width))} × ${Math.max(0, Math.round(length))} × ${Math.max(0, Math.round(height))}`;

    const parts: string[] = [base];
    if (payload.kind === "wall" && (thickness ?? 1) !== 1) {
        parts.push(`thickness ${Math.max(1, Math.round(thickness!))}`);
    }
    if (payload.meta) parts.push(payload.meta);
    return parts.join("  •  ");
}

export default function SelectionDimensionsTip() {
    const [data, setData] = useState<SelectionDimensionsPayload | null>(SelectionDimensionsManager.getCurrent());

    useEffect(() => {
        const listener = (payload: SelectionDimensionsPayload | null) => setData(payload);
        SelectionDimensionsManager.addListener(listener);
        return () => SelectionDimensionsManager.removeListener(listener);
    }, []);

    if (!data) return null;

    return (
        <div className="quick-tips-container">
            <div className="quick-tips py-2 filter backdrop-blur-lg">
                <p className="tip-title">Selection</p>
                <p className="tip-text">
                    {formatDimensions(data)}
                </p>
            </div>
        </div>
    );
}


