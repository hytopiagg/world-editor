import { useState } from "react";

export function useProjectSelection() {
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(
        null
    );

    const selectByIndex = (
        filteredIds: string[],
        index: number,
        e: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }
    ) => {
        const isMeta = !!(e.metaKey || e.ctrlKey);
        const isShift = !!e.shiftKey;
        if (isShift) {
            const anchor =
                lastSelectedIndex != null ? lastSelectedIndex : index;
            const start = Math.min(anchor, index);
            const end = Math.max(anchor, index);
            const rangeIds = filteredIds.slice(start, end + 1);
            if (isMeta)
                setSelectedIds((prev) =>
                    Array.from(new Set([...prev, ...rangeIds]))
                );
            else setSelectedIds(rangeIds);
            setLastSelectedIndex(index);
        } else if (isMeta) {
            const id = filteredIds[index];
            setSelectedIds((prev) =>
                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
            );
            setLastSelectedIndex(index);
        } else {
            setSelectedIds([filteredIds[index]]);
            setLastSelectedIndex(index);
        }
    };

    const clearSelection = () => setSelectedIds([]);

    return {
        selectedIds,
        setSelectedIds,
        lastSelectedIndex,
        setLastSelectedIndex,
        selectByIndex,
        clearSelection,
    } as const;
}
