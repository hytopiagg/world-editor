import React, { useState, useRef } from "react";
import type { ParticleEmitterConfig, TargetObjectType } from "./index";
import TextureBrowser from "./TextureBrowser";

interface ParticleEmitterControlsProps {
    emitter: ParticleEmitterConfig;
    onUpdate: (updates: Partial<ParticleEmitterConfig>) => void;
    targetObject: TargetObjectType;
    availableBoneNames: string[];
}

interface CollapsibleSectionProps {
    title: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
}

function CollapsibleSection({ title, defaultOpen = false, children }: CollapsibleSectionProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="border-b border-white/10 last:border-b-0">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between py-2 px-0 text-left hover:text-white/80 transition-colors"
            >
                <span className="text-xs font-semibold text-white/60 uppercase tracking-wide">{title}</span>
                <svg
                    viewBox="0 0 24 24"
                    className={`w-3 h-3 stroke-white/60 fill-none stroke-[2] transition-transform ${isOpen ? 'rotate-180' : ''}`}
                >
                    <path d="M6 9l6 6 6-6" />
                </svg>
            </button>
            {isOpen && (
                <div className="pb-3 space-y-2">
                    {children}
                </div>
            )}
        </div>
    );
}

export default function ParticleEmitterControls({
    emitter,
    onUpdate,
    targetObject,
    availableBoneNames,
}: ParticleEmitterControlsProps) {
    const [showTextureBrowser, setShowTextureBrowser] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const dataUrl = event.target?.result as string;
                onUpdate({ textureUri: dataUrl });
            };
            reader.readAsDataURL(file);
        }
    };

    const handleTextureSelect = (textureName: string) => {
        onUpdate({ textureUri: `./assets/particles/${textureName}` });
    };

    return (
        <div className="space-y-0 max-h-[600px] overflow-y-auto pr-1">
            {/* Basic Settings */}
            <CollapsibleSection title="Basic" defaultOpen={true}>
                <div className="space-y-2">
                    <div>
                        <label className="block text-xs text-white/60 mb-1">Name</label>
                        <input
                            type="text"
                            value={emitter.name || ""}
                            onChange={(e) => onUpdate({ name: e.target.value })}
                            placeholder="Emitter name"
                            className="w-full px-2 py-1.5 bg-white/10 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-xs text-white/60 mb-1">Texture</label>
                        <div className="space-y-1.5">
                            <div className="flex gap-1.5">
                                <input
                                    type="text"
                                    value={emitter.textureUri || ""}
                                    onChange={(e) => onUpdate({ textureUri: e.target.value })}
                                    placeholder="./assets/particles/particle.png"
                                    className="flex-1 px-2 py-1.5 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowTextureBrowser(!showTextureBrowser)}
                                    className="px-2.5 py-1.5 bg-white/10 hover:bg-white/15 rounded-lg text-xs text-white/80 transition-colors"
                                >
                                    Browse
                                </button>
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="px-2.5 py-1.5 bg-white/10 hover:bg-white/15 rounded-lg text-xs text-white/80 transition-colors"
                                >
                                    Upload
                                </button>
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handleFileUpload}
                                className="hidden"
                            />
                            {showTextureBrowser && (
                                <TextureBrowser
                                    onSelect={handleTextureSelect}
                                    onClose={() => setShowTextureBrowser(false)}
                                />
                            )}
                        </div>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer py-1">
                        <input
                            type="checkbox"
                            checked={emitter.attachedToTarget || false}
                            onChange={(e) => onUpdate({ attachedToTarget: e.target.checked })}
                            className="w-3.5 h-3.5 accent-[#2b6aff]"
                        />
                        <span className="text-xs text-white/60">Attach to target</span>
                    </label>
                    {(targetObject === "player" || targetObject === "entity") && emitter.attachedToTarget && availableBoneNames.length > 0 && (
                        <div>
                            <label className="block text-xs text-white/60 mb-1">Attachment Node</label>
                            <select
                                value={emitter.attachmentNode || ""}
                                onChange={(e) => onUpdate({ attachmentNode: e.target.value || undefined })}
                                className="w-full px-2 py-1.5 bg-white/10 border border-white/10 rounded-lg text-xs text-white focus:border-white/50 focus:outline-none"
                            >
                                <option value="">Root (default)</option>
                                {availableBoneNames.map((boneName) => (
                                    <option key={boneName} value={boneName}>
                                        {boneName}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>
            </CollapsibleSection>

            {/* Emission */}
            <CollapsibleSection title="Emission" defaultOpen={false}>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="block text-xs text-white/60 mb-1">Rate</label>
                        <input
                            type="number"
                            value={emitter.rate ?? 10}
                            onChange={(e) => onUpdate({ rate: parseFloat(e.target.value) || 0 })}
                            min={0}
                            step={0.1}
                            className="w-full px-2 py-1.5 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-white/60 mb-1">Rate Var</label>
                        <input
                            type="number"
                            value={emitter.rateVariance ?? 0}
                            onChange={(e) => onUpdate({ rateVariance: parseFloat(e.target.value) || 0 })}
                            min={0}
                            step={0.1}
                            className="w-full px-2 py-1.5 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-white/60 mb-1">Lifetime</label>
                        <input
                            type="number"
                            value={emitter.lifetime ?? 2}
                            onChange={(e) => onUpdate({ lifetime: parseFloat(e.target.value) || 0 })}
                            min={0}
                            step={0.1}
                            className="w-full px-2 py-1.5 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-white/60 mb-1">Lifetime Var</label>
                        <input
                            type="number"
                            value={emitter.lifetimeVariance ?? 0}
                            onChange={(e) => onUpdate({ lifetimeVariance: parseFloat(e.target.value) || 0 })}
                            min={0}
                            step={0.1}
                            className="w-full px-2 py-1.5 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                        />
                    </div>
                    <div className="col-span-2">
                        <label className="block text-xs text-white/60 mb-1">Max Particles</label>
                        <input
                            type="number"
                            value={emitter.maxParticles ?? 0}
                            onChange={(e) => onUpdate({ maxParticles: Math.max(0, Math.floor(parseFloat(e.target.value) || 0)) })}
                            min={0}
                            step={1}
                            className="w-full px-2 py-1.5 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                        />
                    </div>
                </div>
            </CollapsibleSection>

            {/* Size */}
            <CollapsibleSection title="Size" defaultOpen={false}>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="block text-xs text-white/60 mb-1">Start</label>
                        <input
                            type="number"
                            value={emitter.sizeStart ?? 0.1}
                            onChange={(e) => onUpdate({ sizeStart: parseFloat(e.target.value) || 0 })}
                            min={0}
                            step={0.01}
                            className="w-full px-2 py-1.5 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-white/60 mb-1">Start Var</label>
                        <input
                            type="number"
                            value={emitter.sizeStartVariance ?? 0}
                            onChange={(e) => onUpdate({ sizeStartVariance: parseFloat(e.target.value) || 0 })}
                            min={0}
                            step={0.01}
                            className="w-full px-2 py-1.5 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-white/60 mb-1">End</label>
                        <input
                            type="number"
                            value={emitter.sizeEnd ?? 0.5}
                            onChange={(e) => onUpdate({ sizeEnd: parseFloat(e.target.value) || 0 })}
                            min={0}
                            step={0.01}
                            className="w-full px-2 py-1.5 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-white/60 mb-1">End Var</label>
                        <input
                            type="number"
                            value={emitter.sizeEndVariance ?? 0}
                            onChange={(e) => onUpdate({ sizeEndVariance: parseFloat(e.target.value) || 0 })}
                            min={0}
                            step={0.01}
                            className="w-full px-2 py-1.5 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                        />
                    </div>
                </div>
            </CollapsibleSection>

            {/* Color */}
            <CollapsibleSection title="Color" defaultOpen={false}>
                <div className="space-y-2.5">
                    <div>
                        <div className="text-xs text-white/60 mb-1.5">Start Color</div>
                        <div className="grid grid-cols-3 gap-1.5">
                            <div>
                                <label className="block text-[10px] text-white/40 mb-0.5">R</label>
                                <input
                                    type="number"
                                    value={emitter.colorStart?.r ?? 1}
                                    onChange={(e) => onUpdate({ 
                                        colorStart: { 
                                            ...(emitter.colorStart || { r: 1, g: 1, b: 1 }), 
                                            r: Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)) 
                                        } 
                                    })}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    className="w-full px-1.5 py-1 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] text-white/40 mb-0.5">G</label>
                                <input
                                    type="number"
                                    value={emitter.colorStart?.g ?? 1}
                                    onChange={(e) => onUpdate({ 
                                        colorStart: { 
                                            ...(emitter.colorStart || { r: 1, g: 1, b: 1 }), 
                                            g: Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)) 
                                        } 
                                    })}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    className="w-full px-1.5 py-1 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] text-white/40 mb-0.5">B</label>
                                <input
                                    type="number"
                                    value={emitter.colorStart?.b ?? 1}
                                    onChange={(e) => onUpdate({ 
                                        colorStart: { 
                                            ...(emitter.colorStart || { r: 1, g: 1, b: 1 }), 
                                            b: Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)) 
                                        } 
                                    })}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    className="w-full px-1.5 py-1 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                                />
                            </div>
                        </div>
                    </div>
                    <div>
                        <div className="text-xs text-white/60 mb-1.5">End Color</div>
                        <div className="grid grid-cols-3 gap-1.5">
                            <div>
                                <label className="block text-[10px] text-white/40 mb-0.5">R</label>
                                <input
                                    type="number"
                                    value={emitter.colorEnd?.r ?? 1}
                                    onChange={(e) => onUpdate({ 
                                        colorEnd: { 
                                            ...(emitter.colorEnd || { r: 1, g: 1, b: 1 }), 
                                            r: Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)) 
                                        } 
                                    })}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    className="w-full px-1.5 py-1 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] text-white/40 mb-0.5">G</label>
                                <input
                                    type="number"
                                    value={emitter.colorEnd?.g ?? 1}
                                    onChange={(e) => onUpdate({ 
                                        colorEnd: { 
                                            ...(emitter.colorEnd || { r: 1, g: 1, b: 1 }), 
                                            g: Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)) 
                                        } 
                                    })}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    className="w-full px-1.5 py-1 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] text-white/40 mb-0.5">B</label>
                                <input
                                    type="number"
                                    value={emitter.colorEnd?.b ?? 1}
                                    onChange={(e) => onUpdate({ 
                                        colorEnd: { 
                                            ...(emitter.colorEnd || { r: 1, g: 1, b: 1 }), 
                                            b: Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)) 
                                        } 
                                    })}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    className="w-full px-1.5 py-1 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </CollapsibleSection>

            {/* Opacity */}
            <CollapsibleSection title="Opacity" defaultOpen={false}>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="block text-xs text-white/60 mb-1">Start</label>
                        <input
                            type="number"
                            value={emitter.opacityStart ?? 1}
                            onChange={(e) => onUpdate({ opacityStart: Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)) })}
                            min={0}
                            max={1}
                            step={0.01}
                            className="w-full px-2 py-1.5 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-white/60 mb-1">End</label>
                        <input
                            type="number"
                            value={emitter.opacityEnd ?? 0}
                            onChange={(e) => onUpdate({ opacityEnd: Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)) })}
                            min={0}
                            max={1}
                            step={0.01}
                            className="w-full px-2 py-1.5 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                        />
                    </div>
                </div>
            </CollapsibleSection>

            {/* Position & Movement */}
            <CollapsibleSection title="Position & Movement" defaultOpen={false}>
                <div className="space-y-2.5">
                    <div>
                        <div className="text-xs text-white/60 mb-1.5">Position</div>
                        <div className="grid grid-cols-3 gap-1.5">
                            <div>
                                <label className="block text-[10px] text-white/40 mb-0.5">X</label>
                                <input
                                    type="number"
                                    value={emitter.position?.x ?? 0}
                                    onChange={(e) => onUpdate({ 
                                        position: { 
                                            ...(emitter.position || { x: 0, y: 0, z: 0 }), 
                                            x: parseFloat(e.target.value) || 0 
                                        } 
                                    })}
                                    step={0.1}
                                    className="w-full px-1.5 py-1 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] text-white/40 mb-0.5">Y</label>
                                <input
                                    type="number"
                                    value={emitter.position?.y ?? 0}
                                    onChange={(e) => onUpdate({ 
                                        position: { 
                                            ...(emitter.position || { x: 0, y: 0, z: 0 }), 
                                            y: parseFloat(e.target.value) || 0 
                                        } 
                                    })}
                                    step={0.1}
                                    className="w-full px-1.5 py-1 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] text-white/40 mb-0.5">Z</label>
                                <input
                                    type="number"
                                    value={emitter.position?.z ?? 0}
                                    onChange={(e) => onUpdate({ 
                                        position: { 
                                            ...(emitter.position || { x: 0, y: 0, z: 0 }), 
                                            z: parseFloat(e.target.value) || 0 
                                        } 
                                    })}
                                    step={0.1}
                                    className="w-full px-1.5 py-1 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                                />
                            </div>
                        </div>
                    </div>
                    <div>
                        <div className="text-xs text-white/60 mb-1.5">Velocity</div>
                        <div className="grid grid-cols-3 gap-1.5">
                            <div>
                                <label className="block text-[10px] text-white/40 mb-0.5">X</label>
                                <input
                                    type="number"
                                    value={emitter.velocity?.x ?? 0}
                                    onChange={(e) => onUpdate({ 
                                        velocity: { 
                                            ...(emitter.velocity || { x: 0, y: 0.5, z: 0 }), 
                                            x: parseFloat(e.target.value) || 0 
                                        } 
                                    })}
                                    step={0.1}
                                    className="w-full px-1.5 py-1 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] text-white/40 mb-0.5">Y</label>
                                <input
                                    type="number"
                                    value={emitter.velocity?.y ?? 0.5}
                                    onChange={(e) => onUpdate({ 
                                        velocity: { 
                                            ...(emitter.velocity || { x: 0, y: 0.5, z: 0 }), 
                                            y: parseFloat(e.target.value) || 0 
                                        } 
                                    })}
                                    step={0.1}
                                    className="w-full px-1.5 py-1 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] text-white/40 mb-0.5">Z</label>
                                <input
                                    type="number"
                                    value={emitter.velocity?.z ?? 0}
                                    onChange={(e) => onUpdate({ 
                                        velocity: { 
                                            ...(emitter.velocity || { x: 0, y: 0.5, z: 0 }), 
                                            z: parseFloat(e.target.value) || 0 
                                        } 
                                    })}
                                    step={0.1}
                                    className="w-full px-1.5 py-1 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                                />
                            </div>
                        </div>
                    </div>
                    <div>
                        <div className="text-xs text-white/60 mb-1.5">Gravity</div>
                        <div className="grid grid-cols-3 gap-1.5">
                            <div>
                                <label className="block text-[10px] text-white/40 mb-0.5">X</label>
                                <input
                                    type="number"
                                    value={emitter.gravity?.x ?? 0}
                                    onChange={(e) => onUpdate({ 
                                        gravity: { 
                                            ...(emitter.gravity || { x: 0, y: -0.5, z: 0 }), 
                                            x: parseFloat(e.target.value) || 0 
                                        } 
                                    })}
                                    step={0.1}
                                    className="w-full px-1.5 py-1 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] text-white/40 mb-0.5">Y</label>
                                <input
                                    type="number"
                                    value={emitter.gravity?.y ?? -0.5}
                                    onChange={(e) => onUpdate({ 
                                        gravity: { 
                                            ...(emitter.gravity || { x: 0, y: -0.5, z: 0 }), 
                                            y: parseFloat(e.target.value) || 0 
                                        } 
                                    })}
                                    step={0.1}
                                    className="w-full px-1.5 py-1 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] text-white/40 mb-0.5">Z</label>
                                <input
                                    type="number"
                                    value={emitter.gravity?.z ?? 0}
                                    onChange={(e) => onUpdate({ 
                                        gravity: { 
                                            ...(emitter.gravity || { x: 0, y: -0.5, z: 0 }), 
                                            z: parseFloat(e.target.value) || 0 
                                        } 
                                    })}
                                    step={0.1}
                                    className="w-full px-1.5 py-1 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </CollapsibleSection>

            {/* Advanced */}
            <CollapsibleSection title="Advanced" defaultOpen={false}>
                <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer py-1">
                        <input
                            type="checkbox"
                            checked={emitter.transparent ?? true}
                            onChange={(e) => onUpdate({ transparent: e.target.checked })}
                            className="w-3.5 h-3.5 accent-[#2b6aff]"
                        />
                        <span className="text-xs text-white/60">Enable transparency</span>
                    </label>
                    <div>
                        <label className="block text-xs text-white/60 mb-1">Alpha Test</label>
                        <input
                            type="number"
                            value={emitter.alphaTest ?? 0}
                            onChange={(e) => onUpdate({ alphaTest: Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)) })}
                            min={0}
                            max={1}
                            step={0.01}
                            className="w-full px-2 py-1.5 bg-white/10 border border-white/10 rounded-lg text-xs text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                        />
                    </div>
                </div>
            </CollapsibleSection>
        </div>
    );
}
