import { useEffect, useState } from "react";
import * as THREE from "three";

interface EntityOptionsSectionProps {
    selectedEntity: {
        modelUrl: string;
        instanceId: number;
        name: string;
        currentPosition: THREE.Vector3;
        currentRotation: THREE.Euler;
        currentScale: THREE.Vector3;
        currentTag?: string;
        currentEmissiveColor?: { r: number; g: number; b: number } | null;
        currentEmissiveIntensity?: number | null;
    } | null;
    onPositionChange?: (position: THREE.Vector3) => void;
    onRotationChange?: (rotation: THREE.Euler) => void;
    onScaleChange?: (scale: THREE.Vector3) => void;
    isCompactMode: boolean;
}

export default function EntityOptionsSection({
    selectedEntity,
    onPositionChange,
    onRotationChange,
    onScaleChange,
    isCompactMode,
}: EntityOptionsSectionProps) {
    const [position, setPosition] = useState({ x: 0, y: 0, z: 0 });
    const [rotation, setRotation] = useState({ x: 0, y: 0, z: 0 });
    const [scale, setScale] = useState({ x: 1, y: 1, z: 1 });
    const [tag, setTag] = useState('');
    // Emissive glow settings
    const [emissiveEnabled, setEmissiveEnabled] = useState(false);
    const [emissiveColor, setEmissiveColor] = useState('#ffffff');
    const [emissiveIntensity, setEmissiveIntensity] = useState(1.0);
    // Track focused inputs to allow free typing without forced formatting
    const [focusedInput, setFocusedInput] = useState<string | null>(null);
    // Store raw input values for focused inputs
    const [rawInputValues, setRawInputValues] = useState<Record<string, string>>({});

    // Helper: convert RGB object (0-1 range) to hex string
    const rgbToHex = (color: { r: number; g: number; b: number }): string => {
        const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
        const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
        const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
        return `#${r}${g}${b}`;
    };

    // Helper: convert hex string to RGB object (0-1 range)
    const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (result) {
            return {
                r: parseInt(result[1], 16) / 255,
                g: parseInt(result[2], 16) / 255,
                b: parseInt(result[3], 16) / 255,
            };
        }
        return { r: 1, g: 1, b: 1 };
    };

    // Update local state when selectedEntity changes
    useEffect(() => {
        if (selectedEntity) {
            setPosition({
                x: selectedEntity.currentPosition.x,
                y: selectedEntity.currentPosition.y,
                z: selectedEntity.currentPosition.z,
            });
            setRotation({
                x: THREE.MathUtils.radToDeg(selectedEntity.currentRotation.x),
                y: THREE.MathUtils.radToDeg(selectedEntity.currentRotation.y),
                z: THREE.MathUtils.radToDeg(selectedEntity.currentRotation.z),
            });
            setScale({
                x: selectedEntity.currentScale.x,
                y: selectedEntity.currentScale.y,
                z: selectedEntity.currentScale.z,
            });
            setTag(selectedEntity.currentTag || '');

            // Initialize emissive state
            const hasEmissive = selectedEntity.currentEmissiveColor != null &&
                               selectedEntity.currentEmissiveIntensity != null &&
                               selectedEntity.currentEmissiveIntensity > 0;
            setEmissiveEnabled(hasEmissive);
            if (selectedEntity.currentEmissiveColor) {
                setEmissiveColor(rgbToHex(selectedEntity.currentEmissiveColor));
            } else {
                setEmissiveColor('#ffffff');
            }
            setEmissiveIntensity(selectedEntity.currentEmissiveIntensity ?? 1.0);
        }
    }, [selectedEntity]);

    // Listen for transform changes from gizmo manipulation
    useEffect(() => {
        const handleTransformChanged = (e: CustomEvent) => {
            if (!selectedEntity) return;
            const detail = e.detail;
            setPosition({
                x: detail.position.x,
                y: detail.position.y,
                z: detail.position.z,
            });
            setRotation({
                x: THREE.MathUtils.radToDeg(detail.rotation.x),
                y: THREE.MathUtils.radToDeg(detail.rotation.y),
                z: THREE.MathUtils.radToDeg(detail.rotation.z),
            });
            setScale({
                x: detail.scale.x,
                y: detail.scale.y,
                z: detail.scale.z,
            });
        };

        window.addEventListener('entity-transform-changed', handleTransformChanged as EventListener);
        return () => window.removeEventListener('entity-transform-changed', handleTransformChanged as EventListener);
    }, [selectedEntity]);

    if (!selectedEntity) {
        return (
            <div className="text-xs text-[#F1F1F1]/60">
                No entity selected. Select an entity to edit its properties.
            </div>
        );
    }

    const handlePositionInputChange = (axis: 'x' | 'y' | 'z', value: string) => {
        const inputKey = `position-${axis}`;
        setRawInputValues({ ...rawInputValues, [inputKey]: value });
        
        // Parse the value, allowing empty string for easier typing
        const numValue = value === '' || value === '-' ? 0 : parseFloat(value);
        if (!isNaN(numValue)) {
            const newPosition = { ...position, [axis]: numValue };
            setPosition(newPosition);
            if (onPositionChange) {
                onPositionChange(new THREE.Vector3(newPosition.x, newPosition.y, newPosition.z));
            }
            // Dispatch event to update entity
            window.dispatchEvent(new CustomEvent('entity-position-changed', {
                detail: { position: new THREE.Vector3(newPosition.x, newPosition.y, newPosition.z) }
            }));
        }
    };

    const handlePositionBlur = (axis: 'x' | 'y' | 'z') => {
        const inputKey = `position-${axis}`;
        setFocusedInput(null);
        // Clear raw value on blur so it uses formatted value
        const newRawValues = { ...rawInputValues };
        delete newRawValues[inputKey];
        setRawInputValues(newRawValues);
    };

    const handleRotationInputChange = (axis: 'x' | 'y' | 'z', value: string) => {
        const inputKey = `rotation-${axis}`;
        setRawInputValues({ ...rawInputValues, [inputKey]: value });
        
        // Parse the value, allowing empty string for easier typing
        const numValue = value === '' || value === '-' ? 0 : parseFloat(value);
        if (!isNaN(numValue)) {
            const newRotation = { ...rotation, [axis]: numValue };
            setRotation(newRotation);
            if (onRotationChange) {
                const euler = new THREE.Euler(
                    THREE.MathUtils.degToRad(newRotation.x),
                    THREE.MathUtils.degToRad(newRotation.y),
                    THREE.MathUtils.degToRad(newRotation.z)
                );
                onRotationChange(euler);
            }
            // Dispatch event to update entity
            window.dispatchEvent(new CustomEvent('entity-rotation-changed', {
                detail: {
                    rotation: new THREE.Euler(
                        THREE.MathUtils.degToRad(newRotation.x),
                        THREE.MathUtils.degToRad(newRotation.y),
                        THREE.MathUtils.degToRad(newRotation.z)
                    )
                }
            }));
        }
    };

    const handleRotationBlur = (axis: 'x' | 'y' | 'z') => {
        const inputKey = `rotation-${axis}`;
        setFocusedInput(null);
        // Clear raw value on blur so it uses formatted value
        const newRawValues = { ...rawInputValues };
        delete newRawValues[inputKey];
        setRawInputValues(newRawValues);
    };

    const handleScaleInputChange = (axis: 'x' | 'y' | 'z', value: string) => {
        const inputKey = `scale-${axis}`;
        setRawInputValues({ ...rawInputValues, [inputKey]: value });
        
        // Parse the value, allowing empty string for easier typing
        const numValue = value === '' || value === '-' ? 0.01 : parseFloat(value);
        if (!isNaN(numValue)) {
            const newScale = { ...scale, [axis]: Math.max(0.01, numValue) }; // Prevent zero or negative scale
            setScale(newScale);
            if (onScaleChange) {
                onScaleChange(new THREE.Vector3(newScale.x, newScale.y, newScale.z));
            }
            // Dispatch event to update entity
            window.dispatchEvent(new CustomEvent('entity-scale-changed', {
                detail: { scale: new THREE.Vector3(newScale.x, newScale.y, newScale.z) }
            }));
        }
    };

    const handleScaleBlur = (axis: 'x' | 'y' | 'z') => {
        const inputKey = `scale-${axis}`;
        setFocusedInput(null);
        // Clear raw value on blur so it uses formatted value
        const newRawValues = { ...rawInputValues };
        delete newRawValues[inputKey];
        setRawInputValues(newRawValues);
    };

    const handleScaleKeyDown = (axis: 'x' | 'y' | 'z', e: React.KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();

        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const currentValue = scale[axis];
            const increment = e.key === 'ArrowUp' ? 0.01 : -0.01;
            const newValue = Math.max(0.01, currentValue + increment);

            const newScale = { ...scale, [axis]: newValue };
            setScale(newScale);

            // Clear raw input value so it shows the new formatted value
            const inputKey = `scale-${axis}`;
            const newRawValues = { ...rawInputValues };
            delete newRawValues[inputKey];
            setRawInputValues(newRawValues);

            if (onScaleChange) {
                onScaleChange(new THREE.Vector3(newScale.x, newScale.y, newScale.z));
            }
            // Dispatch event to update entity
            window.dispatchEvent(new CustomEvent('entity-scale-changed', {
                detail: { scale: new THREE.Vector3(newScale.x, newScale.y, newScale.z) }
            }));
        }
    };

    // Tag validation: only allow alphanumeric, underscores, and dashes
    const validateTag = (value: string): string => {
        // Remove any characters that aren't alphanumeric, underscore, or dash
        return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    };

    const handleTagChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const validatedTag = validateTag(e.target.value);
        setTag(validatedTag);
    };

    const handleTagBlur = () => {
        // Dispatch event to update entity tag
        window.dispatchEvent(new CustomEvent('entity-tag-changed', {
            detail: { tag: tag || undefined }
        }));
    };

    const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            // Commit tag change on Enter
            window.dispatchEvent(new CustomEvent('entity-tag-changed', {
                detail: { tag: tag || undefined }
            }));
            (e.target as HTMLInputElement).blur();
        }
    };

    // Emissive handlers
    const handleEmissiveToggle = (enabled: boolean) => {
        setEmissiveEnabled(enabled);
        if (enabled) {
            // Enable emissive with current color and intensity
            const rgb = hexToRgb(emissiveColor);
            window.dispatchEvent(new CustomEvent('entity-emissive-color-changed', {
                detail: { color: rgb }
            }));
            window.dispatchEvent(new CustomEvent('entity-emissive-intensity-changed', {
                detail: { intensity: emissiveIntensity }
            }));
        } else {
            // Disable emissive
            window.dispatchEvent(new CustomEvent('entity-emissive-color-changed', {
                detail: { color: null }
            }));
            window.dispatchEvent(new CustomEvent('entity-emissive-intensity-changed', {
                detail: { intensity: null }
            }));
        }
    };

    const handleEmissiveColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newColor = e.target.value;
        setEmissiveColor(newColor);
        if (emissiveEnabled) {
            const rgb = hexToRgb(newColor);
            window.dispatchEvent(new CustomEvent('entity-emissive-color-changed', {
                detail: { color: rgb }
            }));
        }
    };

    const handleEmissiveIntensityChange = (value: number) => {
        const clampedValue = Math.max(0, Math.min(5, value));
        setEmissiveIntensity(clampedValue);
        if (emissiveEnabled) {
            window.dispatchEvent(new CustomEvent('entity-emissive-intensity-changed', {
                detail: { intensity: clampedValue }
            }));
        }
    };

    // Helper function to round to maximum decimal places (removes trailing zeros)
    const roundToMaxDecimals = (value: number, maxDecimals: number): string => {
        // Round to maxDecimals places, then remove trailing zeros
        const rounded = Number(value.toFixed(maxDecimals));
        return rounded.toString();
    };

    const inputClass = "w-14 px-1 py-0.5 bg-white/10 border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

    return (
        <div className="flex flex-col gap-2.5">
            {/* Entity Info */}
            <div className="flex flex-col gap-1 fade-down opacity-0 duration-150" style={{ animationDelay: "0.05s" }}>
                <div className="text-xs text-[#F1F1F1]/60 text-left">Entity: {selectedEntity.name}</div>
                <div className="text-[10px] text-[#F1F1F1]/50 text-left">Instance ID: {selectedEntity.instanceId}</div>
            </div>

            {/* Tag */}
            <div className="flex flex-col gap-1.5 fade-down opacity-0 duration-150" style={{ animationDelay: "0.075s" }}>
                <div className="text-xs text-[#F1F1F1]/80 font-semibold text-left">Tag</div>
                <input
                    type="text"
                    value={tag}
                    onChange={handleTagChange}
                    onBlur={handleTagBlur}
                    onKeyDown={handleTagKeyDown}
                    className="w-full px-2 py-1 bg-white/10 border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs outline-none"
                    placeholder="Enter tag (optional)"
                    maxLength={64}
                />
                <div className="text-[10px] text-[#F1F1F1]/40 text-left">Alphanumeric, underscores, dashes only</div>
            </div>

            {/* Position */}
            <div className="flex flex-col gap-1.5 fade-down opacity-0 duration-150" style={{ animationDelay: "0.1s" }}>
                <div className="text-xs text-[#F1F1F1]/80 font-semibold text-left">Position</div>
                <div className="flex items-center gap-2">
                    <input
                        type="number"
                        value={focusedInput === 'position-x' ? (rawInputValues['position-x'] ?? position.x.toString()) : roundToMaxDecimals(position.x, 2)}
                        step="any"
                        onChange={(e) => handlePositionInputChange('x', e.target.value)}
                        onFocus={() => setFocusedInput('position-x')}
                        onBlur={() => handlePositionBlur('x')}
                        onKeyDown={(e) => e.stopPropagation()}
                        className={inputClass}
                        placeholder="X"
                    />
                    <input
                        type="number"
                        value={focusedInput === 'position-y' ? (rawInputValues['position-y'] ?? position.y.toString()) : roundToMaxDecimals(position.y, 2)}
                        step="any"
                        onChange={(e) => handlePositionInputChange('y', e.target.value)}
                        onFocus={() => setFocusedInput('position-y')}
                        onBlur={() => handlePositionBlur('y')}
                        onKeyDown={(e) => e.stopPropagation()}
                        className={inputClass}
                        placeholder="Y"
                    />
                    <input
                        type="number"
                        value={focusedInput === 'position-z' ? (rawInputValues['position-z'] ?? position.z.toString()) : roundToMaxDecimals(position.z, 2)}
                        step="any"
                        onChange={(e) => handlePositionInputChange('z', e.target.value)}
                        onFocus={() => setFocusedInput('position-z')}
                        onBlur={() => handlePositionBlur('z')}
                        onKeyDown={(e) => e.stopPropagation()}
                        className={inputClass}
                        placeholder="Z"
                    />
                </div>
            </div>

            {/* Rotation */}
            <div className="flex flex-col gap-1.5 fade-down opacity-0 duration-150" style={{ animationDelay: "0.15s" }}>
                <div className="text-xs text-[#F1F1F1]/80 font-semibold text-left">Rotation (degrees)</div>
                <div className="flex items-center gap-2">
                    <input
                        type="number"
                        value={focusedInput === 'rotation-x' ? (rawInputValues['rotation-x'] ?? rotation.x.toString()) : roundToMaxDecimals(rotation.x, 2)}
                        step="any"
                        onChange={(e) => handleRotationInputChange('x', e.target.value)}
                        onFocus={() => setFocusedInput('rotation-x')}
                        onBlur={() => handleRotationBlur('x')}
                        onKeyDown={(e) => e.stopPropagation()}
                        className={inputClass}
                        placeholder="X"
                    />
                    <input
                        type="number"
                        value={focusedInput === 'rotation-y' ? (rawInputValues['rotation-y'] ?? rotation.y.toString()) : roundToMaxDecimals(rotation.y, 2)}
                        step="any"
                        onChange={(e) => handleRotationInputChange('y', e.target.value)}
                        onFocus={() => setFocusedInput('rotation-y')}
                        onBlur={() => handleRotationBlur('y')}
                        onKeyDown={(e) => e.stopPropagation()}
                        className={inputClass}
                        placeholder="Y"
                    />
                    <input
                        type="number"
                        value={focusedInput === 'rotation-z' ? (rawInputValues['rotation-z'] ?? rotation.z.toString()) : roundToMaxDecimals(rotation.z, 2)}
                        step="any"
                        onChange={(e) => handleRotationInputChange('z', e.target.value)}
                        onFocus={() => setFocusedInput('rotation-z')}
                        onBlur={() => handleRotationBlur('z')}
                        onKeyDown={(e) => e.stopPropagation()}
                        className={inputClass}
                        placeholder="Z"
                    />
                </div>
            </div>

            {/* Scale */}
            <div className="flex flex-col gap-1.5 fade-down opacity-0 duration-150" style={{ animationDelay: "0.2s" }}>
                <div className="text-xs text-[#F1F1F1]/80 font-semibold text-left">Scale</div>
                <div className="flex items-center gap-2">
                    <input
                        type="number"
                        value={focusedInput === 'scale-x' ? (rawInputValues['scale-x'] ?? scale.x.toString()) : roundToMaxDecimals(scale.x, 3)}
                        step="any"
                        min="0.01"
                        onChange={(e) => handleScaleInputChange('x', e.target.value)}
                        onFocus={() => setFocusedInput('scale-x')}
                        onBlur={() => handleScaleBlur('x')}
                        onKeyDown={(e) => handleScaleKeyDown('x', e)}
                        className={inputClass}
                        placeholder="X"
                    />
                    <input
                        type="number"
                        value={focusedInput === 'scale-y' ? (rawInputValues['scale-y'] ?? scale.y.toString()) : roundToMaxDecimals(scale.y, 3)}
                        step="any"
                        min="0.01"
                        onChange={(e) => handleScaleInputChange('y', e.target.value)}
                        onFocus={() => setFocusedInput('scale-y')}
                        onBlur={() => handleScaleBlur('y')}
                        onKeyDown={(e) => handleScaleKeyDown('y', e)}
                        className={inputClass}
                        placeholder="Y"
                    />
                    <input
                        type="number"
                        value={focusedInput === 'scale-z' ? (rawInputValues['scale-z'] ?? scale.z.toString()) : roundToMaxDecimals(scale.z, 3)}
                        step="any"
                        min="0.01"
                        onChange={(e) => handleScaleInputChange('z', e.target.value)}
                        onFocus={() => setFocusedInput('scale-z')}
                        onBlur={() => handleScaleBlur('z')}
                        onKeyDown={(e) => handleScaleKeyDown('z', e)}
                        className={inputClass}
                        placeholder="Z"
                    />
                </div>
            </div>

            {/* Emissive Glow */}
            <div className="flex flex-col gap-1.5 fade-down opacity-0 duration-150" style={{ animationDelay: "0.25s" }}>
                <div className="flex items-center justify-between">
                    <div className="text-xs text-[#F1F1F1]/80 font-semibold text-left">Emissive Glow</div>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={emissiveEnabled}
                            onChange={(e) => handleEmissiveToggle(e.target.checked)}
                            className="w-4 h-4 accent-[#6366f1] cursor-pointer"
                        />
                        <span className="text-xs text-[#F1F1F1]/60">{emissiveEnabled ? 'On' : 'Off'}</span>
                    </label>
                </div>
                {emissiveEnabled && (
                    <div className="flex flex-col gap-2 mt-1">
                        {/* Emissive Color */}
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-[#F1F1F1]/60 w-14">Color</span>
                            <input
                                type="color"
                                value={emissiveColor}
                                onChange={handleEmissiveColorChange}
                                className="w-8 h-6 cursor-pointer border border-white/10 rounded bg-transparent"
                            />
                            <span className="text-xs text-[#F1F1F1]/50">{emissiveColor.toUpperCase()}</span>
                        </div>
                        {/* Emissive Intensity */}
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-[#F1F1F1]/60 w-14">Intensity</span>
                            <input
                                type="range"
                                min="0"
                                max="5"
                                step="0.1"
                                value={emissiveIntensity}
                                onChange={(e) => handleEmissiveIntensityChange(parseFloat(e.target.value))}
                                className="flex-1 h-1 cursor-pointer accent-[#6366f1]"
                            />
                            <span className="text-xs text-[#F1F1F1]/50 w-8 text-right">{emissiveIntensity.toFixed(1)}</span>
                        </div>
                    </div>
                )}
                <div className="text-[10px] text-[#F1F1F1]/40 text-left">Makes entity glow (visible with bloom enabled)</div>
            </div>
        </div>
    );
}

