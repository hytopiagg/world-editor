/// <reference types="../../../react-three-fiber" />
import React, { useState } from "react";
import ParticleViewerSidebar from "./ParticleViewerSidebar";
import ParticleViewerCanvas from "./ParticleViewerCanvas";
import PlayButton from "./PlayButton";

export type TargetObjectType = "player" | "block" | "entity" | "none";

export interface EntityTarget {
    type: "entity";
    modelUrl: string;
    name: string;
}

export interface ParticleEmitterConfig {
    id: string;
    name?: string;
    textureUri: string;
    alphaTest?: number;
    colorStart?: { r: number; g: number; b: number };
    colorEnd?: { r: number; g: number; b: number };
    colorStartVariance?: { r: number; g: number; b: number };
    colorEndVariance?: { r: number; g: number; b: number };
    gravity?: { x: number; y: number; z: number };
    lifetime?: number;
    lifetimeVariance?: number;
    maxParticles?: number;
    opacityEnd?: number;
    opacityEndVariance?: number;
    opacityStart?: number;
    opacityStartVariance?: number;
    position?: { x: number; y: number; z: number };
    positionVariance?: { x: number; y: number; z: number };
    rate?: number;
    rateVariance?: number;
    sizeEnd?: number;
    sizeEndVariance?: number;
    sizeStart?: number;
    sizeStartVariance?: number;
    transparent?: boolean;
    velocity?: { x: number; y: number; z: number };
    velocityVariance?: { x: number; y: number; z: number };
    offset?: { x: number; y: number; z: number };
    attachedToTarget?: boolean;
    attachmentNode?: string; // Bone/node name for player attachment
    paused?: boolean;
    expanded?: boolean;
}

export default function ParticleViewerPage() {
    const [targetObject, setTargetObject] = useState<TargetObjectType>("none");
    const [entityTarget, setEntityTarget] = useState<EntityTarget | null>(null);
    const [emitters, setEmitters] = useState<ParticleEmitterConfig[]>([]);
    const [selectedEmitterId, setSelectedEmitterId] = useState<string | null>(null);
    const [availableBoneNames, setAvailableBoneNames] = useState<string[]>([]);
    const [playModeEnabled, setPlayModeEnabled] = useState(false);


    const handleEmitterCreate = () => {
        const newEmitter: ParticleEmitterConfig = {
            id: `emitter-${Date.now()}`,
            name: `Emitter ${emitters.length + 1}`,
            textureUri: "./assets/particles/spark_01.png",
            position: { x: 0, y: 0, z: 0 },
            rate: 10,
            rateVariance: 0,
            lifetime: 2.0,
            lifetimeVariance: 0,
            sizeStart: 0.1,
            sizeStartVariance: 0,
            sizeEnd: 0.5,
            sizeEndVariance: 0,
            opacityStart: 1.0,
            opacityStartVariance: 0,
            opacityEnd: 0.0,
            opacityEndVariance: 0,
            colorStart: { r: 1, g: 1, b: 1 },
            colorEnd: { r: 1, g: 1, b: 1 },
            colorStartVariance: { r: 0, g: 0, b: 0 },
            colorEndVariance: { r: 0, g: 0, b: 0 },
            velocity: { x: 0, y: 0.5, z: 0 },
            velocityVariance: { x: 0.2, y: 0.2, z: 0.2 },
            gravity: { x: 0, y: -0.5, z: 0 },
            transparent: true,
            paused: false,
            expanded: true,
        };
        setEmitters([...emitters, newEmitter]);
        setSelectedEmitterId(newEmitter.id);
    };

    const handleEmitterDelete = (id: string) => {
        setEmitters(emitters.filter((e) => e.id !== id));
        if (selectedEmitterId === id) {
            setSelectedEmitterId(null);
        }
    };

    const handleEmitterUpdate = (id: string, updates: Partial<ParticleEmitterConfig>) => {
        console.log('handleEmitterUpdate called:', id, updates);
        setEmitters(
            emitters.map((e) => (e.id === id ? { ...e, ...updates } : e))
        );
    };

    const handleBackToHome = () => {
        window.location.hash = "my-files";
    };

    return (
        <div className="fixed inset-0 grid [grid-template-columns:280px_1fr] bg-[#0b0e12] text-white/80">
            {/* Header */}
            <div className="col-span-2 bg-[#0e1117] border-b border-white/10 px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleBackToHome}
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/80 text-sm flex items-center gap-2"
                    >
                        <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none stroke-[1.6]">
                            <path d="M19 12H5M12 19l-7-7 7-7" />
                        </svg>
                        Back to Home
                    </button>
                    <h1 className="text-white/80 text-lg font-semibold">Particle Viewer</h1>
                </div>
            </div>

            {/* Sidebar */}
            <ParticleViewerSidebar
                targetObject={targetObject}
                entityTarget={entityTarget}
                availableBoneNames={availableBoneNames}
                onTargetObjectChange={(target, entity) => {
                    setTargetObject(target);
                    setEntityTarget(entity || null);
                }}
                emitters={emitters}
                selectedEmitterId={selectedEmitterId}
                onEmitterSelect={setSelectedEmitterId}
                onEmitterCreate={handleEmitterCreate}
                onEmitterDelete={handleEmitterDelete}
                onEmitterUpdate={handleEmitterUpdate}
            />

            {/* Canvas */}
            <div className="relative">
                <ParticleViewerCanvas 
                    targetObject={targetObject} 
                    entityTarget={entityTarget} 
                    emitters={emitters}
                    playModeEnabled={playModeEnabled}
                    onBoneNamesChange={setAvailableBoneNames}
                />
            </div>

            {/* Play Button - only show for player and entity */}
            {(targetObject === "player" || targetObject === "entity") && (
                <PlayButton 
                    enabled={playModeEnabled} 
                    onToggle={() => setPlayModeEnabled(!playModeEnabled)} 
                />
            )}
        </div>
    );
}

