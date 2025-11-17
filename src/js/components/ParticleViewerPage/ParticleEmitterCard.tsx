import React, { useCallback } from "react";
import type { ParticleEmitterConfig, TargetObjectType } from "./index";
import ParticleEmitterControls from "./ParticleEmitterControls";

interface ParticleEmitterCardProps {
    emitter: ParticleEmitterConfig;
    isSelected: boolean;
    onSelect: () => void;
    onDelete: () => void;
    onUpdate: (updates: Partial<ParticleEmitterConfig>) => void;
    targetObject: TargetObjectType;
    availableBoneNames: string[];
}

export default function ParticleEmitterCard({
    emitter,
    isSelected,
    onSelect,
    onDelete,
    onUpdate,
    targetObject,
    availableBoneNames,
}: ParticleEmitterCardProps) {
    const toggleExpanded = useCallback(() => {
        onUpdate({ expanded: !emitter.expanded });
    }, [emitter.expanded, onUpdate]);

    const handleUpdate = useCallback((updates: Partial<ParticleEmitterConfig>) => {
        onUpdate(updates);
    }, [onUpdate]);

    return (
        <div
            className={`rounded-lg border transition-colors ${
                isSelected
                    ? "border-[#2b6aff] bg-[#2b6aff]/10"
                    : "border-white/10 bg-white/5 hover:bg-white/8"
            }`}
            style={{ position: 'relative' }}
        >
            {/* Header */}
            <div
                className="flex items-center justify-between px-3 py-2 cursor-pointer card-header"
                onClick={(e) => {
                    // Only select if not clicking on a button
                    if (!(e.target as HTMLElement).closest('button')) {
                        onSelect();
                    }
                }}
            >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            emitter.paused ? "bg-yellow-500" : "bg-green-500"
                        }`}
                    />
                    <span className="text-sm text-white truncate">
                        {emitter.name || `Emitter ${emitter.id}`}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onUpdate({ paused: !emitter.paused });
                        }}
                        className="p-1 hover:bg-white/10 rounded"
                        title={emitter.paused ? "Resume" : "Pause"}
                    >
                        {emitter.paused ? (
                            <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-white/60 fill-white/60 stroke-[2]">
                                <path d="M5 3l14 9-14 9V3z" />
                            </svg>
                        ) : (
                            <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-white/60 fill-none stroke-[2]">
                                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                            </svg>
                        )}
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleExpanded();
                        }}
                        className="p-1 hover:bg-white/10 rounded"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            className={`w-4 h-4 stroke-white/60 fill-none stroke-[2] transition-transform ${
                                emitter.expanded ? "rotate-180" : ""
                            }`}
                        >
                            <path d="M6 9l6 6 6-6" />
                        </svg>
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete();
                        }}
                        className="p-1 hover:bg-red-500/20 rounded"
                        title="Delete"
                    >
                        <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-red-400 fill-none stroke-[2]">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Expanded Content */}
            {emitter.expanded && isSelected && (
                <div 
                    className="px-3 pb-3 pt-2 border-t border-white/10 controls-container"
                    onClick={(e) => {
                        // Only stop propagation if clicking on the container itself, not on inputs
                        if (e.target === e.currentTarget) {
                            e.stopPropagation();
                        }
                    }}
                    style={{ 
                        pointerEvents: 'auto', 
                        position: 'relative', 
                        zIndex: 1000,
                        isolation: 'isolate'
                    }}
                >
                    <ParticleEmitterControls 
                        emitter={emitter} 
                        onUpdate={handleUpdate} 
                        targetObject={targetObject}
                        availableBoneNames={availableBoneNames}
                    />
                </div>
            )}
        </div>
    );
}

