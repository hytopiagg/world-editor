import React from "react";
import type { ParticleEmitterConfig, TargetObjectType } from "./index";
import ParticleEmitterCard from "./ParticleEmitterCard";

interface ParticleEmitterListProps {
    emitters: ParticleEmitterConfig[];
    selectedEmitterId: string | null;
    onEmitterSelect: (id: string) => void;
    onEmitterDelete: (id: string) => void;
    onEmitterUpdate: (id: string, updates: Partial<ParticleEmitterConfig>) => void;
    targetObject: TargetObjectType;
    availableBoneNames: string[];
}

export default function ParticleEmitterList({
    emitters,
    selectedEmitterId,
    onEmitterSelect,
    onEmitterDelete,
    onEmitterUpdate,
    targetObject,
    availableBoneNames,
}: ParticleEmitterListProps) {
    if (emitters.length === 0) {
        return (
            <div className="text-white/40 text-sm text-center py-8">
                No emitters yet. Click "New" to create one.
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2" style={{ pointerEvents: 'auto' }}>
            {emitters.map((emitter) => (
                <ParticleEmitterCard
                    key={emitter.id}
                    emitter={emitter}
                    isSelected={selectedEmitterId === emitter.id}
                    onSelect={() => onEmitterSelect(emitter.id)}
                    onDelete={() => onEmitterDelete(emitter.id)}
                    onUpdate={(updates) => onEmitterUpdate(emitter.id, updates)}
                    targetObject={targetObject}
                    availableBoneNames={availableBoneNames}
                />
            ))}
        </div>
    );
}

