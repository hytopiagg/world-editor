import { useState, useEffect } from "react";
import { FaSave, FaCog, FaTrash, FaCopy } from "react-icons/fa";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";
import { generateSchematicPreview } from "../utils/SchematicPreviewRenderer";

interface ComponentOptionsProps {
    selectedComponent: any;
    isCompactMode: boolean;
    onDeleteComponent?: (comp: any) => void;
    onRenameComponent?: (comp: any, newName: string) => void;
}

export default function ComponentOptionsSection({ selectedComponent, isCompactMode, onDeleteComponent, onRenameComponent }: ComponentOptionsProps) {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [editableName, setEditableName] = useState<string>(selectedComponent?.name || "");
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [repeatPlacement, setRepeatPlacement] = useState<boolean>(false);

    useEffect(() => {
        setEditableName(selectedComponent?.name || "");
        setIsEditing(false);
    }, [selectedComponent]);

    useEffect(() => {
        let isMounted = true;
        async function gen() {
            if (!selectedComponent?.schematic) return;
            try {
                const url = await generateSchematicPreview(selectedComponent.schematic, { width: 128, height: 128, background: "transparent" });
                if (isMounted) setPreviewUrl(url);
            } catch (err) {
                console.error("Failed to generate schematic preview", err);
            }
        }
        gen();
        return () => {
            isMounted = false;
        };
    }, [selectedComponent]);

    useEffect(() => {
        let isMounted = true;
        (async () => {
            try {
                const stored = await DatabaseManager.getData(STORES.SETTINGS, "schematicRepeatPlacement");
                const flag = stored === true || stored === "true";
                if (isMounted) {
                    setRepeatPlacement(flag);
                    localStorage.setItem("schematicRepeatPlacement", flag ? "true" : "false");
                }
            } catch (err) {
                console.warn("Failed to load schematicRepeatPlacement from DB", err);
            }
        })();
        return () => { isMounted = false; };
    }, []);

    const handleSaveName = async () => {
        if (!selectedComponent) return;
        const trimmed = editableName.trim();
        if (!trimmed || trimmed === selectedComponent.name) {
            setIsEditing(false);
            setEditableName(selectedComponent.name || "");
            return;
        }
        setIsSaving(true);
        try {
            const existing: any = await DatabaseManager.getData(STORES.SCHEMATICS, selectedComponent.id);
            if (existing && typeof existing === "object") {
                const updated: any = { ...(existing as any), name: trimmed, timestamp: Date.now() };
                await DatabaseManager.saveData(STORES.SCHEMATICS, selectedComponent.id, updated);
                // Optimistically update local prop so UI reflects change immediately
                (selectedComponent as any).name = trimmed;
                setEditableName(trimmed);
                window.dispatchEvent(new Event("schematicsDbUpdated"));
                if (onRenameComponent) onRenameComponent(selectedComponent, trimmed);
            }
            setIsEditing(false);
        } catch (e) {
            console.error("Failed to rename component", e);
            alert("Failed to rename component. See console for details.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedComponent) return;
        if (!window.confirm("Are you sure you want to delete this component?")) return;
        try {
            await DatabaseManager.deleteData(STORES.SCHEMATICS, selectedComponent.id);
            window.dispatchEvent(new Event("schematicsDbUpdated"));
            if (onDeleteComponent) onDeleteComponent(selectedComponent);
        } catch (e) {
            console.error("Failed to delete component", e);
            alert("Failed to delete component. See console for details.");
        }
    };

    const handleCopyPrompt = () => {
        if (!navigator.clipboard) {
            alert("Clipboard API not supported");
            return;
        }
        navigator.clipboard.writeText(selectedComponent.prompt || "").then(() => {
            // Optionally show toast
        });
    };

    const toggleRepeatPlacement = async (checked: boolean) => {
        setRepeatPlacement(checked);
        localStorage.setItem("schematicRepeatPlacement", checked ? "true" : "false");
        try {
            await DatabaseManager.saveData(STORES.SETTINGS, "schematicRepeatPlacement", checked);
        } catch (err) {
            console.error("Failed to save schematicRepeatPlacement to DB", err);
        }
    };

    if (!selectedComponent) {
        // Render disabled placeholder UI when no component is selected
        return (
            <div className="flex flex-col gap-3">
                <div
                    className="component-preview-container w-full bg-black/20 rounded-md overflow-hidden relative opacity-0 duration-150 fade-down"
                    style={{ height: isCompactMode ? "10rem" : "12rem", animationDelay: "0.05s" }}
                >
                    <div className="flex items-center justify-center h-full text-xs text-white/40">
                        No component selected
                    </div>
                </div>

                <div className="flex flex-col gap-2 pointer-events-none">
                    <div className="flex items-center gap-2 opacity-60">
                        <label className="text-xs text-[#F1F1F1]/80 w-10">ID:</label>
                        <input type="text" disabled value="" className="flex-grow px-2 py-1 text-xs bg-black/20 border border-white/10 rounded-md text-[#F1F1F1]/70" />
                    </div>
                    <div className="flex items-center gap-2 opacity-60">
                        <label className="text-xs text-[#F1F1F1]/80 w-10">Name:</label>
                        <input style={{ width: 'calc(100% - 8px)' }} type="text" disabled value="" className="flex-grow px-2 py-1 text-xs bg-black/20 border border-white/10 rounded-md text-[#F1F1F1]/70" />
                    </div>
                    <div className="flex items-center gap-2 opacity-60">
                        <label className="text-xs text-[#F1F1F1]/80">Prompt:</label>
                        <input style={{ width: 'calc(100% - 8px)' }} type="text" disabled value="" className="flex-grow px-2 py-1 text-xs bg-black/20 border border-white/10 rounded-md text-[#F1F1F1]/70" />
                    </div>
                    <div className="flex items-center justify-between mt-2">
                        <label className="text-xs text-[#F1F1F1]">Repeat Placement</label>
                        <input disabled={false} type="checkbox" className="w-4 h-4 pointer-events-auto" checked={repeatPlacement} onChange={(e) => toggleRepeatPlacement(e.target.checked)} />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            <div
                className="component-preview-container w-full bg-black/20 rounded-md overflow-hidden relative opacity-0 duration-150 fade-down"
                onWheel={(e) => e.stopPropagation()}
                style={{ height: isCompactMode ? "10rem" : "12rem", animationDelay: "0.05s" }}
            >
                {previewUrl ? (
                    <img src={previewUrl} alt="Component preview" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                ) : (
                    <div className="flex items-center justify-center h-full text-xs text-white/50">Generating Preview...</div>
                )}
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <label className="text-xs text-[#F1F1F1]/80 w-10">ID:</label>
                    <input type="text" disabled value={selectedComponent.id} className="flex-grow px-2 py-1 text-xs bg-black/20 border border-white/10 rounded-md text-[#F1F1F1]/70" />
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-xs text-[#F1F1F1]/80 w-10">Name:</label>
                    {isEditing ? (
                        <input
                            type="text"
                            value={editableName}
                            onChange={(e) => setEditableName(e.target.value)}
                            onBlur={handleSaveName}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") handleSaveName();
                                else if (e.key === "Escape") { setIsEditing(false); setEditableName(selectedComponent.name || ""); }
                            }}
                            disabled={isSaving}
                            autoFocus
                            className="flex-grow px-2 py-1 text-xs bg-white/10 border border-white/30 rounded-md text-[#F1F1F1] focus:outline-none focus:ring-1 focus:ring-blue-500"
                            style={{
                                width: 'calc(100% - 8px)',
                            }}
                        />
                    ) : (
                        <input
                            type="text"
                            value={editableName || "(unnamed)"}
                            disabled
                            onClick={() => setIsEditing(true)}
                            onKeyDown={(e) => e.stopPropagation()}
                            className="flex-grow px-2 py-1 text-xs bg-black/20 border border-white/10 rounded-md text-[#F1F1F1] cursor-text hover:bg-black/30"
                            style={{
                                width: 'calc(100% - 8px)',
                            }}
                        />
                    )}
                    {isEditing ? (
                        <button onClick={handleSaveName} disabled={isSaving || !editableName.trim()} className="p-1.5 text-xs border border-white/10 hover:bg-white/20 rounded-md disabled:opacity-50" title="Save Name">
                            {isSaving ? <div className="spinner" /> : <FaSave />}
                        </button>
                    ) : (
                        <button onClick={() => setIsEditing(true)} className="p-1.5 text-xs border border-white/10 hover:bg-white/20 rounded-md" title="Edit Name">
                            <FaCog />
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <label className="text-xs text-[#F1F1F1]/80">Prompt:</label>
                    <input type="text" value={selectedComponent.prompt || ""} disabled className="flex-grow px-2 py-1 text-xs bg-black/20 border border-white/10 rounded-md text-[#F1F1F1]/70"
                        style={{
                            width: 'calc(100% - 8px)',
                        }} />
                    <button onClick={handleCopyPrompt} className="p-1.5 text-xs border border-white/10 hover:bg-white/20 rounded-md" title="Copy Prompt">
                        <FaCopy />
                    </button>
                </div>

                <div className="flex items-center justify-between mt-2">
                    <label className="text-xs text-[#F1F1F1]">Repeat Placement</label>
                    <input disabled={false} type="checkbox" className="w-4 h-4 pointer-events-auto" checked={repeatPlacement} onChange={(e) => toggleRepeatPlacement(e.target.checked)} />
                </div>

                <div className="flex items-center justify-end gap-2 mt-2">
                    <button onClick={handleDelete} className="flex items-center gap-1 px-2 py-1 text-xs hover:scale-[1.02] bg-[#0D0D0D]/80 active:translate-y-0.5 hover:bg-[#0D0D0D]/90 text-white rounded-lg transition-all cursor-pointer" title="Delete Component">
                        <FaTrash /> Delete
                    </button>
                </div>

                <div className="flex flex-col gap-1 text-[10px] text-[#F1F1F1]/80 mt-3 bg-black/10 -mx-3 px-3 py-3 text-left fade-down opacity-0 duration-150" style={{ animationDelay: "0.1s" }}>
                    <p className="text-xs text-[#F1F1F1]/80 font-bold">Keyboard Shortcuts</p>
                    <div className="flex items-center gap-1"><kbd className="bg-white/20 px-1 rounded">R</kbd> – Rotate schematic (90°)</div>
                    <div className="flex items-center gap-1"><kbd className="bg-white/20 px-1 rounded">1</kbd>/<kbd className="bg-white/20 px-1 rounded">2</kbd> – Shift down / up</div>
                    <div className="flex items-center gap-1"><kbd className="bg-white/20 px-1 rounded">Esc</kbd> – Cancel placement</div>
                </div>
            </div>
        </div>
    );
} 