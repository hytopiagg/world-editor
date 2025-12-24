/**
 * ZoneToolOptionsSection.tsx - Sidebar options panel for the Zone Tool
 * 
 * Provides controls for zone type, label selection, zone list management,
 * and visibility toggle.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { Zone, ZONE_LABEL_PRESETS } from "../types/DatabaseTypes";
import { zoneManager, getZoneLabelColor } from "../managers/ZoneManager";
import QuickTipsManager from "./QuickTipsManager";

interface ZoneToolOptionsSectionProps {
    zoneTool: any;
    isCompactMode: boolean;
}

export default function ZoneToolOptionsSection({ zoneTool, isCompactMode }: ZoneToolOptionsSectionProps) {
    const [zoneMode, setZoneMode] = useState<"box" | "point">(zoneTool?.zoneMode ?? "box");
    const [selectedLabel, setSelectedLabel] = useState<string>(zoneTool?.selectedLabel ?? "spawn_point");
    const [zones, setZones] = useState<Zone[]>([]);
    const [selectedZone, setSelectedZone] = useState<Zone | null>(null);
    const [zonesVisible, setZonesVisible] = useState<boolean>(true);
    const [showCustomLabelInput, setShowCustomLabelInput] = useState(false);
    const [customLabelName, setCustomLabelName] = useState("");
    
    // Edit states for selected zone
    const [editingName, setEditingName] = useState(false);
    const [editNameValue, setEditNameValue] = useState("");
    
    // Ref for smooth scrolling
    const sectionRef = useRef<HTMLDivElement>(null);
    
    // Smooth scroll to section when zone tool is activated
    useEffect(() => {
        const handleToolActivated = () => {
            setTimeout(() => {
                sectionRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                });
            }, 100);
        };
        
        window.addEventListener("zone-tool-activated", handleToolActivated);
        return () => window.removeEventListener("zone-tool-activated", handleToolActivated);
    }, []);
    
    // Load zones on mount
    useEffect(() => {
        const loadZones = () => {
            setZones(zoneManager.getAllZones());
            setZonesVisible(zoneManager.isVisible());
        };
        
        loadZones();
        
        // Listen for zone changes
        const handleZonesChanged = () => loadZones();
        window.addEventListener("zones-changed", handleZonesChanged);
        
        return () => {
            window.removeEventListener("zones-changed", handleZonesChanged);
        };
    }, []);
    
    // Sync with tool state
    useEffect(() => {
        if (!zoneTool) return;
        
        const interval = setInterval(() => {
            if (zoneTool.zoneMode !== zoneMode) {
                setZoneMode(zoneTool.zoneMode);
            }
            if (zoneTool.selectedLabel !== selectedLabel) {
                setSelectedLabel(zoneTool.selectedLabel);
            }
            if (zoneTool.selectedZone !== selectedZone) {
                setSelectedZone(zoneTool.selectedZone);
                if (zoneTool.selectedZone) {
                    setEditNameValue(zoneTool.selectedZone.name || "");
                }
            }
        }, 200);
        
        return () => clearInterval(interval);
    }, [zoneTool, zoneMode, selectedLabel, selectedZone]);
    
    // Listen for zone mode changes
    useEffect(() => {
        const handleModeChange = (e: CustomEvent) => {
            setZoneMode(e.detail.mode);
        };
        window.addEventListener("zone-mode-changed", handleModeChange as EventListener);
        return () => window.removeEventListener("zone-mode-changed", handleModeChange as EventListener);
    }, []);
    
    // Listen for zone selection changes
    useEffect(() => {
        const handleZoneSelected = (e: CustomEvent) => {
            setSelectedZone(e.detail.zone);
            setEditNameValue(e.detail.zone?.name || "");
            setEditingName(false);
        };
        const handleZoneDeselected = () => {
            setSelectedZone(null);
            setEditingName(false);
        };
        window.addEventListener("zone-selected", handleZoneSelected as EventListener);
        window.addEventListener("zone-deselected", handleZoneDeselected);
        return () => {
            window.removeEventListener("zone-selected", handleZoneSelected as EventListener);
            window.removeEventListener("zone-deselected", handleZoneDeselected);
        };
    }, []);
    
    // Listen for visibility changes
    useEffect(() => {
        const handleVisibilityChange = (e: CustomEvent) => {
            setZonesVisible(e.detail.visible);
        };
        window.addEventListener("zones-visibility-changed", handleVisibilityChange as EventListener);
        return () => window.removeEventListener("zones-visibility-changed", handleVisibilityChange as EventListener);
    }, []);
    
    const applyMode = useCallback((mode: "box" | "point") => {
        if (!zoneTool) return;
        zoneTool.setZoneMode(mode);
        setZoneMode(mode);
    }, [zoneTool]);
    
    const applyLabel = useCallback((label: string) => {
        if (!zoneTool) return;
        zoneTool.setSelectedLabel(label);
        setSelectedLabel(label);
    }, [zoneTool]);
    
    const handleToggleVisibility = useCallback(() => {
        const newVisible = zoneManager.toggleVisibility();
        setZonesVisible(newVisible);
        QuickTipsManager.setToolTip(`Zones ${newVisible ? "visible" : "hidden"}`);
    }, []);
    
    const handleDeleteZone = useCallback((zoneId: string) => {
        zoneManager.deleteZone(zoneId);
        setZones(zoneManager.getAllZones());
    }, []);
    
    const handleSelectZone = useCallback((zone: Zone) => {
        if (zoneTool) {
            zoneTool.selectZone(zone);
        }
    }, [zoneTool]);
    
    const handleAddCustomLabel = useCallback(() => {
        if (customLabelName.trim()) {
            const labelValue = customLabelName.toLowerCase().replace(/\s+/g, "_");
            applyLabel(labelValue);
            setShowCustomLabelInput(false);
            setCustomLabelName("");
        }
    }, [customLabelName, applyLabel]);
    
    const handleClearAllZones = useCallback(() => {
        if (window.confirm("Are you sure you want to delete all zones? This cannot be undone.")) {
            zoneManager.clearAllZones();
            setZones([]);
        }
    }, []);
    
    // Handle changing zone type for selected zone
    const handleChangeSelectedZoneType = useCallback((newType: "box" | "point") => {
        if (!selectedZone || selectedZone.type === newType) return;
        
        zoneManager.updateZone(selectedZone.id, { type: newType });
        const updated = zoneManager.getZone(selectedZone.id);
        if (updated) {
            setSelectedZone(updated);
            if (zoneTool) {
                zoneTool.selectedZone = updated;
                zoneTool.selectZone(updated);
            }
        }
        setZones(zoneManager.getAllZones());
    }, [selectedZone, zoneTool]);
    
    // Handle saving custom name for selected zone
    const handleSaveZoneName = useCallback(() => {
        if (!selectedZone) return;
        
        zoneManager.updateZone(selectedZone.id, { name: editNameValue.trim() || undefined });
        const updated = zoneManager.getZone(selectedZone.id);
        if (updated) {
            setSelectedZone(updated);
            if (zoneTool) {
                zoneTool.selectedZone = updated;
            }
        }
        setEditingName(false);
        setZones(zoneManager.getAllZones());
    }, [selectedZone, editNameValue, zoneTool]);
    
    // Handle changing label for selected zone
    const handleChangeSelectedZoneLabel = useCallback((newLabel: string) => {
        if (!selectedZone || selectedZone.label === newLabel) return;
        
        zoneManager.updateZone(selectedZone.id, { label: newLabel });
        const updated = zoneManager.getZone(selectedZone.id);
        if (updated) {
            setSelectedZone(updated);
            if (zoneTool) {
                zoneTool.selectedZone = updated;
            }
        }
        setZones(zoneManager.getAllZones());
    }, [selectedZone, zoneTool]);
    
    if (!zoneTool) {
        return <div className="text-xs text-[#F1F1F1]/60">Zone tool not initialized...</div>;
    }
    
    const modeBtnClass = (m: string, forSelected = false) => {
        const isActive = forSelected ? selectedZone?.type === m : zoneMode === m;
        return `px-2 py-1 text-[10px] rounded cursor-pointer border border-white/10 transition-all ${
            isActive
                ? "bg-emerald-500 text-white border-emerald-400" 
                : "bg-white/5 text-[#F1F1F1] hover:bg-white/10"
        }`;
    };
    
    // Get display label for the current selection
    const getCurrentLabelDisplay = () => {
        const preset = ZONE_LABEL_PRESETS.find(p => p.value === selectedLabel);
        return preset?.label || selectedLabel.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    };
    
    return (
        <div ref={sectionRef} className="flex flex-col gap-3">
            {/* Zone Type Selection (for new zones) */}
            <div className="flex flex-col gap-1.5 fade-down opacity-0 duration-150" style={{ animationDelay: "0.05s" }}>
                <div className="text-[10px] text-[#F1F1F1]/50">New Zone Type</div>
                <div className="flex gap-1.5">
                    <button className={modeBtnClass("point")} onClick={() => applyMode("point")}>
                        📍 Point
                    </button>
                    <button className={modeBtnClass("box")} onClick={() => applyMode("box")}>
                        📦 Box
                    </button>
                </div>
            </div>
            
            {/* Label Selection - compact grid */}
            <div className="flex flex-col gap-1.5 fade-down opacity-0 duration-150" style={{ animationDelay: "0.1s" }}>
                <div className="text-[10px] text-[#F1F1F1]/50">Zone Label</div>
                <div className="grid grid-cols-2 gap-1">
                    {ZONE_LABEL_PRESETS.map((preset) => (
                        <button
                            key={preset.value}
                            className={`flex items-center gap-1.5 px-2 py-1 text-[10px] rounded cursor-pointer border transition-all ${
                                selectedLabel === preset.value
                                    ? "border-white/40 bg-white/10"
                                    : "border-white/5 bg-white/5 hover:bg-white/10"
                            }`}
                            onClick={() => {
                                if (preset.value === "custom") {
                                    setShowCustomLabelInput(true);
                                } else {
                                    applyLabel(preset.value);
                                }
                            }}
                        >
                            <div 
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: preset.color }}
                            />
                            <span className="text-[#F1F1F1] truncate">{preset.label}</span>
                        </button>
                    ))}
                </div>
                
                {/* Custom Label Input */}
                {showCustomLabelInput && (
                    <div className="flex gap-1.5 mt-1">
                        <input
                            type="text"
                            value={customLabelName}
                            onChange={(e) => setCustomLabelName(e.target.value)}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") handleAddCustomLabel();
                                if (e.key === "Escape") setShowCustomLabelInput(false);
                            }}
                            placeholder="Custom label..."
                            className="flex-1 px-2 py-1 text-[10px] rounded bg-black/30 border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
                            autoFocus
                        />
                        <button
                            onClick={handleAddCustomLabel}
                            className="px-2 py-1 text-[10px] rounded bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
                        >
                            Add
                        </button>
                    </div>
                )}
            </div>
            
            {/* Visibility Toggle */}
            <div className="flex items-center justify-between px-2 py-1.5 bg-black/20 rounded fade-down opacity-0 duration-150" style={{ animationDelay: "0.15s" }}>
                <span className="text-[10px] text-[#F1F1F1]/70">Show Zones</span>
                <button
                    onClick={handleToggleVisibility}
                    className={`relative w-8 h-4 rounded-full transition-colors ${
                        zonesVisible ? "bg-emerald-500" : "bg-white/20"
                    }`}
                >
                    <div 
                        className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                            zonesVisible ? "left-4" : "left-0.5"
                        }`}
                    />
                </button>
            </div>
            
            {/* Zone List - more compact */}
            <div className="flex flex-col gap-1.5 fade-down opacity-0 duration-150" style={{ animationDelay: "0.2s" }}>
                <div className="flex items-center justify-between">
                    <div className="text-[10px] text-[#F1F1F1]/50">
                        Zones ({zones.length})
                    </div>
                    {zones.length > 0 && (
                        <button
                            onClick={handleClearAllZones}
                            className="text-[9px] text-red-400 hover:text-red-300 transition-colors"
                        >
                            Clear All
                        </button>
                    )}
                </div>
                
                {zones.length === 0 ? (
                    <div className="text-[9px] text-[#F1F1F1]/40 text-center py-3">
                        No zones created yet.<br/>
                        Click in the world to create one.
                    </div>
                ) : (
                    <div className="flex flex-col gap-0.5 max-h-36 overflow-y-auto pr-1 custom-scrollbar">
                        {zones.map((zone) => {
                            const labelPreset = ZONE_LABEL_PRESETS.find(p => p.value === zone.label);
                            const displayLabel = zone.name || labelPreset?.label || zone.label.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
                            const isSelected = selectedZone?.id === zone.id;
                            
                            return (
                                <div
                                    key={zone.id}
                                    className={`flex items-center justify-between px-1.5 py-1 rounded cursor-pointer transition-all ${
                                        isSelected
                                            ? "bg-white/15 border border-white/30"
                                            : "bg-white/5 border border-transparent hover:bg-white/10"
                                    }`}
                                    onClick={() => handleSelectZone(zone)}
                                >
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <div 
                                            className="w-2 h-2 rounded-full shrink-0"
                                            style={{ backgroundColor: zone.color || getZoneLabelColor(zone.label) }}
                                        />
                                        <span className="text-[10px] text-[#F1F1F1] truncate">
                                            {displayLabel}
                                        </span>
                                        <span className="text-[8px] text-[#F1F1F1]/40 shrink-0">
                                            {zone.type === "point" ? "📍" : "📦"}
                                        </span>
                                    </div>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteZone(zone.id);
                                        }}
                                        className="text-[9px] text-red-400 hover:text-red-300 px-1 rounded hover:bg-red-500/20 transition-all shrink-0"
                                    >
                                        ✕
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            
            {/* Selected Zone Editor */}
            {selectedZone && (
                <div className="flex flex-col gap-2 p-2 bg-black/20 rounded border border-white/10 fade-down opacity-0 duration-150" style={{ animationDelay: "0.25s" }}>
                    <div className="text-[10px] text-[#F1F1F1]/50 font-medium">Selected Zone</div>
                    
                    {/* Custom Name Input */}
                    <div className="flex flex-col gap-1">
                        <div className="text-[9px] text-[#F1F1F1]/40">Custom Name</div>
                        {editingName ? (
                            <div className="flex gap-1">
                                <input
                                    type="text"
                                    value={editNameValue}
                                    onChange={(e) => setEditNameValue(e.target.value)}
                                    onKeyDown={(e) => {
                                        e.stopPropagation();
                                        if (e.key === "Enter") handleSaveZoneName();
                                        if (e.key === "Escape") {
                                            setEditingName(false);
                                            setEditNameValue(selectedZone.name || "");
                                        }
                                    }}
                                    placeholder="Enter a name..."
                                    className="flex-1 px-1.5 py-0.5 text-[10px] rounded bg-black/30 border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
                                    autoFocus
                                />
                                <button
                                    onClick={handleSaveZoneName}
                                    className="px-1.5 py-0.5 text-[9px] rounded bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
                                >
                                    Save
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setEditingName(true)}
                                className="text-left px-1.5 py-0.5 text-[10px] rounded bg-white/5 border border-white/10 text-[#F1F1F1] hover:bg-white/10 transition-all"
                            >
                                {selectedZone.name || <span className="text-white/40">Click to add name...</span>}
                            </button>
                        )}
                    </div>
                    
                    {/* Change Zone Type */}
                    <div className="flex flex-col gap-1">
                        <div className="text-[9px] text-[#F1F1F1]/40">Type</div>
                        <div className="flex gap-1">
                            <button 
                                className={modeBtnClass("point", true)}
                                onClick={() => handleChangeSelectedZoneType("point")}
                            >
                                📍 Point
                            </button>
                            <button 
                                className={modeBtnClass("box", true)}
                                onClick={() => handleChangeSelectedZoneType("box")}
                            >
                                📦 Box
                            </button>
                        </div>
                    </div>
                    
                    {/* Change Label */}
                    <div className="flex flex-col gap-1">
                        <div className="text-[9px] text-[#F1F1F1]/40">Label</div>
                        <select
                            value={selectedZone.label}
                            onChange={(e) => handleChangeSelectedZoneLabel(e.target.value)}
                            className="px-1.5 py-0.5 text-[10px] rounded bg-black/30 border border-white/10 text-white focus:outline-none focus:border-white/30"
                        >
                            {ZONE_LABEL_PRESETS.filter(p => p.value !== "custom").map((preset) => (
                                <option key={preset.value} value={preset.value}>
                                    {preset.label}
                                </option>
                            ))}
                            {!ZONE_LABEL_PRESETS.find(p => p.value === selectedZone.label) && (
                                <option value={selectedZone.label}>
                                    {selectedZone.label.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
                                </option>
                            )}
                        </select>
                    </div>
                    
                    {/* Zone Info */}
                    <div className="flex flex-col gap-0.5 text-[9px] text-[#F1F1F1]/60 pt-1 border-t border-white/5">
                        <div>Position: <span className="text-[#F1F1F1]">
                            {selectedZone.position.x}, {selectedZone.position.y}, {selectedZone.position.z}
                        </span></div>
                        {selectedZone.dimensions && (
                            <div>Size: <span className="text-[#F1F1F1]">
                                {selectedZone.dimensions.width}×{selectedZone.dimensions.height}×{selectedZone.dimensions.depth}
                            </span></div>
                        )}
                        {selectedZone.from && selectedZone.to && (
                            <div>
                                From: <span className="text-[#F1F1F1]">{selectedZone.from.x}, {selectedZone.from.y}, {selectedZone.from.z}</span>
                                <br/>
                                To: <span className="text-[#F1F1F1]">{selectedZone.to.x}, {selectedZone.to.y}, {selectedZone.to.z}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
            
            {/* Keyboard shortcuts - compact */}
            <div className="flex flex-col gap-0.5 text-[9px] text-[#F1F1F1]/60 bg-black/10 -mx-3 px-3 py-2 text-left fade-down opacity-0 duration-150" style={{ animationDelay: "0.3s" }}>
                <p className="text-[10px] text-[#F1F1F1]/70 font-medium mb-0.5">Shortcuts</p>
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                    <div><kbd className="bg-white/20 px-0.5 rounded text-[8px]">M</kbd> Mode toggle</div>
                    <div><kbd className="bg-white/20 px-0.5 rounded text-[8px]">S</kbd> Scale (box)</div>
                    <div><kbd className="bg-white/20 px-0.5 rounded text-[8px]">1</kbd>/<kbd className="bg-white/20 px-0.5 rounded text-[8px]">2</kbd> Height</div>
                    <div><kbd className="bg-white/20 px-0.5 rounded text-[8px]">G</kbd> Move</div>
                    <div><kbd className="bg-white/20 px-0.5 rounded text-[8px]">Del</kbd> Delete</div>
                    <div><kbd className="bg-white/20 px-0.5 rounded text-[8px]">Esc</kbd> Cancel</div>
                </div>
            </div>
        </div>
    );
}
