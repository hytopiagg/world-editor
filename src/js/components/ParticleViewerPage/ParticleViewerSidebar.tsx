import React, { useState } from "react";
import type { TargetObjectType, ParticleEmitterConfig, EntityTarget } from "./index";
import TargetObjectSelector from "./TargetObjectSelector";
import ParticleEmitterList from "./ParticleEmitterList";
import EntityBrowser from "./EntityBrowser";
import { environmentModels } from "../../EnvironmentBuilder";

interface ParticleViewerSidebarProps {
    targetObject: TargetObjectType;
    entityTarget: EntityTarget | null;
    availableBoneNames: string[];
    onTargetObjectChange: (target: TargetObjectType, entity?: EntityTarget) => void;
    emitters: ParticleEmitterConfig[];
    selectedEmitterId: string | null;
    onEmitterSelect: (id: string | null) => void;
    onEmitterCreate: () => void;
    onEmitterDelete: (id: string) => void;
    onEmitterUpdate: (id: string, updates: Partial<ParticleEmitterConfig>) => void;
}

export default function ParticleViewerSidebar({
    targetObject,
    entityTarget,
    availableBoneNames,
    onTargetObjectChange,
    emitters,
    selectedEmitterId,
    onEmitterSelect,
    onEmitterDelete,
    onEmitterCreate,
    onEmitterUpdate,
}: ParticleViewerSidebarProps) {
    const [showEntityBrowser, setShowEntityBrowser] = useState(false);
    return (
        <aside className="bg-[#0e1117] border-r-0 p-5 flex flex-col gap-4 overflow-y-auto w-[280px]">
            {/* Target Object Selector */}
            <div className="flex flex-col gap-3">
                <h2 className="text-white/60 text-sm font-semibold uppercase tracking-wide text-left">
                    Target Object
                </h2>
                <div className="h-px bg-white/10"></div>
                <TargetObjectSelector 
                    value={targetObject} 
                    onChange={(target) => {
                        if (target === "entity") {
                            setShowEntityBrowser(true);
                        } else {
                            onTargetObjectChange(target);
                        }
                    }} 
                />
                {targetObject === "entity" && entityTarget && (
                    <div className="px-2.5 py-2 bg-white/5 rounded-lg border border-white/10">
                        <div className="text-xs text-white/60 mb-1">Selected Entity</div>
                        <div className="text-sm text-white/80 truncate">{entityTarget.name}</div>
                    </div>
                )}
                {showEntityBrowser && (
                    <EntityBrowser
                        onSelect={(modelUrl) => {
                            const entity = environmentModels.find((e: any) => e.modelUrl === modelUrl);
                            if (entity) {
                                onTargetObjectChange("entity", {
                                    type: "entity",
                                    modelUrl: modelUrl,
                                    name: entity.name || modelUrl.split('/').pop() || "Entity",
                                });
                            }
                            setShowEntityBrowser(false);
                        }}
                        onClose={() => {
                            setShowEntityBrowser(false);
                            if (targetObject === "entity" && !entityTarget) {
                                onTargetObjectChange("none");
                            }
                        }}
                    />
                )}
            </div>

            {/* Particle Emitters */}
            <div className="flex flex-col gap-3 flex-1">
                <div className="flex items-center justify-between">
                    <h2 className="text-white/60 text-sm font-semibold uppercase tracking-wide">
                        Particle Emitters
                    </h2>
                    <button
                        onClick={onEmitterCreate}
                        className="px-3 py-1.5 rounded-lg bg-[#2b6aff] hover:bg-[#2560e6] text-white text-sm flex items-center gap-2 transition-colors"
                    >
                        <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none stroke-[2]">
                            <path d="M12 5v14M5 12h14" />
                        </svg>
                        New
                    </button>
                </div>
                <div className="h-px bg-white/10"></div>

                <ParticleEmitterList
                    emitters={emitters}
                    selectedEmitterId={selectedEmitterId}
                    onEmitterSelect={onEmitterSelect}
                    onEmitterDelete={onEmitterDelete}
                    onEmitterUpdate={onEmitterUpdate}
                    targetObject={targetObject}
                    availableBoneNames={availableBoneNames}
                />
            </div>
        </aside>
    );
}

