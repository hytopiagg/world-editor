import { useState, useEffect } from "react";
import { FaSave, FaCog, FaTrash, FaCopy, FaDownload, FaExchangeAlt, FaCube } from "react-icons/fa";
import { saveAs } from "file-saver";
import { getBlockById } from "../managers/BlockTypesManager";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";
import { generateSchematicPreview } from "../utils/SchematicPreviewRenderer";

interface ComponentOptionsProps {
    selectedComponent: any;
    isCompactMode: boolean;
    onDeleteComponent?: (comp: any) => void;
    onRenameComponent?: (comp: any, newName: string) => void;
    onConvertToEntity?: (comp: any) => Promise<void>;
}

export default function ComponentOptionsSection({ selectedComponent, isCompactMode, onDeleteComponent, onRenameComponent, onConvertToEntity }: ComponentOptionsProps) {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [editableName, setEditableName] = useState<string>(selectedComponent?.name || "");
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [repeatPlacement, setRepeatPlacement] = useState<boolean>(false);
    const [isRemapping, setIsRemapping] = useState(false);
    const [isConverting, setIsConverting] = useState(false);

    useEffect(() => {
        setEditableName(selectedComponent?.name || "");
        setIsEditing(false);
    }, [selectedComponent]);

    useEffect(() => {
        let isMounted = true;
        async function gen() {
            if (!selectedComponent?.schematic) return;
            try {
                const blocksForPreview =
                    selectedComponent.schematic && (selectedComponent.schematic as any).blocks
                        ? (selectedComponent.schematic as any).blocks
                        : selectedComponent.schematic;
                const url = await generateSchematicPreview(blocksForPreview, {
                    width: 128,
                    height: 128,
                    background: "transparent",
                });
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

    const sanitizeFileName = (name: string) => {
        if (!name) return "component";
        return name
            .toString()
            .trim()
            .replace(/\s+/g, "-")
            .replace(/[^a-zA-Z0-9-_.]/g, "-")
            .replace(/-+/g, "-")
            .substring(0, 64);
    };

    const handleDownload = () => {
        if (!selectedComponent) return;
        const fileNameBase = sanitizeFileName(selectedComponent.name || selectedComponent.prompt || selectedComponent.id || "component");
        const blocksMeta = (selectedComponent?.schematic)
            ? (() => {
                try {
                    const blocks = (selectedComponent.schematic as any).blocks || selectedComponent.schematic;
                    const ids = new Set<number>();
                    Object.values(blocks || {}).forEach((v: any) => {
                        if (typeof v === 'number') ids.add(v as number);
                    });
                    const meta: Record<string, any> = {};
                    ids.forEach((id) => {
                        const bt: any = (getBlockById as any)?.(id);
                        if (bt) {
                            meta[id] = {
                                id: bt.id,
                                name: bt.name,
                                isCustom: !!bt.isCustom,
                                isMultiTexture: !!bt.isMultiTexture,
                                textureUri: bt.textureUri || null,
                                sideTextures: bt.sideTextures || null,
                                lightLevel: typeof bt.lightLevel === 'number' ? bt.lightLevel : undefined,
                            };
                        } else {
                            meta[id] = { id };
                        }
                    });
                    return meta;
                } catch { return undefined; }
            })()
            : undefined;
        const exportEntry = blocksMeta ? { ...selectedComponent, blocksMeta } : selectedComponent;
        const json = JSON.stringify(exportEntry, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        saveAs(blob, `${fileNameBase}.json`);
    };

    const handleRemap = async () => {
        if (!selectedComponent?.schematic) return;
        try {
            setIsRemapping(true);
            // Let the sidebar own the remap flow and saving a new component
            window.dispatchEvent(new CustomEvent("requestComponentRemap", { detail: { component: selectedComponent } }));
        } finally {
            setIsRemapping(false);
        }
    };

    const handleConvertToEntity = async () => {
        if (!selectedComponent?.schematic || !onConvertToEntity) return;
        
        const blocks = selectedComponent.schematic.blocks || selectedComponent.schematic;
        const blockCount = Object.keys(blocks).length;
        
        if (blockCount === 0) {
            alert("This component has no blocks to convert.");
            return;
        }
        
        const confirmed = window.confirm(
            `Convert "${selectedComponent.name || 'Component'}" to an entity?\n\n` +
            `This will create a new 3D model from ${blockCount} blocks that you can place as a single entity in your world.\n\n` +
            `The original component will remain unchanged.`
        );
        
        if (!confirmed) return;
        
        setIsConverting(true);
        try {
            await onConvertToEntity(selectedComponent);
        } catch (err) {
            console.error("Failed to convert component to entity:", err);
            alert("Failed to convert component to entity. See console for details.");
        } finally {
            setIsConverting(false);
        }
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
                    className="overflow-hidden relative w-full rounded-md opacity-0 duration-150 component-preview-container bg-black/20 fade-down"
                    style={{ height: isCompactMode ? "10rem" : "12rem", animationDelay: "0.05s" }}
                >
                    <div className="flex justify-center items-center h-full text-xs text-white/40">
                        No component selected
                    </div>
                </div>

                <div className="flex flex-col gap-2 pointer-events-none">
                    <div className="flex gap-2 items-center opacity-60">
                        <label className="text-xs text-[#F1F1F1]/80 w-10">ID:</label>
                        <input type="text" disabled value="" className="flex-grow px-2 py-1 text-xs bg-black/20 border border-white/10 rounded-md text-[#F1F1F1]/70" />
                    </div>
                    <div className="flex gap-2 items-center opacity-60">
                        <label className="text-xs text-[#F1F1F1]/80 w-10">Name:</label>
                        <input style={{ width: 'calc(100% - 8px)' }} type="text" disabled value="" className="flex-grow px-2 py-1 text-xs bg-black/20 border border-white/10 rounded-md text-[#F1F1F1]/70" />
                    </div>
                    <div className="flex gap-2 items-center opacity-60">
                        <label className="text-xs text-[#F1F1F1]/80">Prompt:</label>
                        <input style={{ width: 'calc(100% - 8px)' }} type="text" disabled value="" className="flex-grow px-2 py-1 text-xs bg-black/20 border border-white/10 rounded-md text-[#F1F1F1]/70" />
                    </div>
                    <div className="flex justify-between items-center mt-2">
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
                className="overflow-hidden relative w-full rounded-md opacity-0 duration-150 component-preview-container bg-black/20 fade-down"
                onWheel={(e) => e.stopPropagation()}
                style={{ height: isCompactMode ? "10rem" : "12rem", animationDelay: "0.05s" }}
            >
                {previewUrl ? (
                    <img src={previewUrl} alt="Component preview" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                ) : (
                    <div className="flex justify-center items-center h-full text-xs text-white/50">Generating Preview...</div>
                )}
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex gap-2 items-center">
                    <label className="text-xs text-[#F1F1F1]/80 w-10">ID:</label>
                    <input type="text" disabled value={selectedComponent.id} className="flex-grow px-2 py-1 text-xs bg-black/20 border border-white/10 rounded-md text-[#F1F1F1]/70" />
                </div>
                <div className="flex gap-2 items-center">
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

                <div className="flex gap-2 items-center">
                    <label className="text-xs text-[#F1F1F1]/80">Prompt:</label>
                    <input type="text" value={selectedComponent.prompt || ""} disabled className="flex-grow px-2 py-1 text-xs bg-black/20 border border-white/10 rounded-md text-[#F1F1F1]/70"
                        style={{
                            width: 'calc(100% - 8px)',
                        }} />
                    <button onClick={handleCopyPrompt} className="p-1.5 text-xs border border-white/10 hover:bg-white/20 rounded-md" title="Copy Prompt">
                        <FaCopy />
                    </button>
                </div>

                <div className="flex justify-between items-center mt-2">
                    <label className="text-xs text-[#F1F1F1]">Repeat Placement</label>
                    <input disabled={false} type="checkbox" className="w-4 h-4 pointer-events-auto" checked={repeatPlacement} onChange={(e) => toggleRepeatPlacement(e.target.checked)} />
                </div>

                <div className="flex gap-2 justify-end items-center mt-2">
                    <button 
                        onClick={handleConvertToEntity} 
                        disabled={isConverting || !onConvertToEntity} 
                        className="p-1.5 text-xs border border-white/10 hover:bg-white/20 rounded-md disabled:opacity-50" 
                        title="Convert to Entity"
                    >
                        {isConverting ? <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" /> : <FaCube />}
                    </button>
                    <button onClick={handleRemap} disabled={isRemapping} className="p-1.5 text-xs border border-white/10 hover:bg-white/20 rounded-md disabled:opacity-50" title="Remap Component">
                        <FaExchangeAlt />
                    </button>
                    <button onClick={handleDownload} className="p-1.5 text-xs border border-white/10 hover:bg-white/20 rounded-md" title={`Download ${selectedComponent.name || "component"}`}>
                        <FaDownload />
                    </button>
                    <button onClick={handleDelete} className="p-1.5 text-xs border border-white/10 hover:bg-white/20 rounded-md" title="Delete Component">
                        <FaTrash />
                    </button>
                </div>

                <div className="flex flex-col gap-1 text-[10px] text-[#F1F1F1]/80 mt-3 bg-black/10 -mx-3 px-3 py-3 text-left fade-down opacity-0 duration-150" style={{ animationDelay: "0.1s" }}>
                    <p className="text-xs text-[#F1F1F1]/80 font-bold">Keyboard Shortcuts</p>
                    <div className="flex gap-1 items-center"><kbd className="px-1 rounded bg-white/20">R</kbd> – Rotate schematic (90°)</div>
                    <div className="flex gap-1 items-center"><kbd className="px-1 rounded bg-white/20">1</kbd>/<kbd className="px-1 rounded bg-white/20">2</kbd> – Shift down / up</div>
                    <div className="flex gap-1 items-center"><kbd className="px-1 rounded bg-white/20">Esc</kbd> – Cancel placement</div>
                </div>
            </div>
        </div>
    );
} 