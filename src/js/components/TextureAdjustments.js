import React, { useState, useCallback } from "react";
import PropTypes from "prop-types";
import { FaAdjust, FaPalette, FaSun, FaMoon, FaUndo } from "react-icons/fa";

/**
 * TextureAdjustments - Provides hue shift, tint, saturation, and brightness controls
 * for adjusting textures in a UX-friendly way
 */
const TextureAdjustments = ({ onApplyAdjustment, disabled }) => {
    const [hueShift, setHueShift] = useState(0);
    const [saturation, setSaturation] = useState(100);
    const [brightness, setBrightness] = useState(100);
    const [tintColor, setTintColor] = useState("#ffffff");
    const [tintOpacity, setTintOpacity] = useState(0);

    // Reset all adjustments
    const handleReset = useCallback(() => {
        setHueShift(0);
        setSaturation(100);
        setBrightness(100);
        setTintColor("#ffffff");
        setTintOpacity(0);
    }, []);

    // Apply all adjustments at once
    const handleApplyAll = useCallback(() => {
        onApplyAdjustment({
            type: "all",
            hueShift,
            saturation: saturation / 100,
            brightness: brightness / 100,
            tintColor,
            tintOpacity: tintOpacity / 100,
        });
    }, [hueShift, saturation, brightness, tintColor, tintOpacity, onApplyAdjustment]);

    // Quick preset buttons for common hue shifts
    const huePresets = [
        { label: "Red", value: 0, color: "#ef4444" },
        { label: "Orange", value: 30, color: "#f97316" },
        { label: "Yellow", value: 60, color: "#eab308" },
        { label: "Green", value: 120, color: "#22c55e" },
        { label: "Cyan", value: 180, color: "#06b6d4" },
        { label: "Blue", value: 240, color: "#3b82f6" },
        { label: "Purple", value: 270, color: "#a855f7" },
        { label: "Pink", value: 330, color: "#ec4899" },
    ];

    return (
        <div className="flex flex-col gap-3 p-3 bg-white/5 rounded-lg border border-white/10">
            <div className="flex items-center justify-between">
                <h4 className="text-white text-sm font-medium flex items-center gap-2">
                    <FaAdjust className="text-purple-400" />
                    Color Adjustments
                </h4>
                <button
                    onClick={handleReset}
                    className="text-white/50 hover:text-white text-xs flex items-center gap-1 transition-colors"
                    title="Reset all adjustments"
                >
                    <FaUndo size={10} />
                    Reset
                </button>
            </div>

            {/* Hue Shift */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <label className="text-xs text-white/60 flex items-center gap-1.5">
                        <FaPalette size={10} />
                        Hue Shift
                    </label>
                    <span className="text-xs text-white/40">{hueShift}°</span>
                </div>
                <div
                    className="h-3 rounded-full cursor-pointer relative overflow-hidden"
                    style={{
                        background:
                            "linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
                    }}
                >
                    <input
                        type="range"
                        min="-180"
                        max="180"
                        value={hueShift}
                        onChange={(e) => setHueShift(parseInt(e.target.value))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        disabled={disabled}
                    />
                    <div
                        className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg border-2 border-gray-800 pointer-events-none"
                        style={{
                            left: `calc(${((hueShift + 180) / 360) * 100}% - 8px)`,
                        }}
                    />
                </div>
                {/* Hue Presets */}
                <div className="flex gap-1 flex-wrap mt-1">
                    {huePresets.map((preset) => (
                        <button
                            key={preset.value}
                            onClick={() => setHueShift(preset.value)}
                            className="w-5 h-5 rounded-full border border-white/20 hover:scale-110 transition-transform"
                            style={{ backgroundColor: preset.color }}
                            title={preset.label}
                            disabled={disabled}
                        />
                    ))}
                </div>
            </div>

            {/* Saturation */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <label className="text-xs text-white/60 flex items-center gap-1.5">
                        <FaSun size={10} />
                        Saturation
                    </label>
                    <span className="text-xs text-white/40">{saturation}%</span>
                </div>
                <div 
                    className="relative h-2 rounded-full overflow-hidden"
                    style={{ background: `linear-gradient(to right, #808080, #ff4444)` }}
                >
                    <input
                        type="range"
                        min="0"
                        max="200"
                        value={saturation}
                        onChange={(e) => setSaturation(parseInt(e.target.value))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        disabled={disabled}
                    />
                    <div
                        className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg border-2 border-gray-600 pointer-events-none"
                        style={{ left: `calc(${(saturation / 200) * 100}% - 8px)` }}
                    />
                </div>
            </div>

            {/* Brightness */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <label className="text-xs text-white/60 flex items-center gap-1.5">
                        <FaMoon size={10} />
                        Brightness
                    </label>
                    <span className="text-xs text-white/40">{brightness}%</span>
                </div>
                <div 
                    className="relative h-2 rounded-full overflow-hidden"
                    style={{ background: `linear-gradient(to right, #000000, #ffffff)` }}
                >
                    <input
                        type="range"
                        min="0"
                        max="200"
                        value={brightness}
                        onChange={(e) => setBrightness(parseInt(e.target.value))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        disabled={disabled}
                    />
                    <div
                        className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg border-2 border-gray-600 pointer-events-none"
                        style={{ left: `calc(${(brightness / 200) * 100}% - 8px)` }}
                    />
                </div>
            </div>

            {/* Tint Overlay */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <label className="text-xs text-white/60">Color Tint</label>
                    <span className="text-xs text-white/40">{tintOpacity}%</span>
                </div>
                <div className="flex gap-2 items-center">
                    <input
                        type="color"
                        value={tintColor}
                        onChange={(e) => setTintColor(e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer border border-white/20 bg-transparent"
                        disabled={disabled}
                    />
                    <div 
                        className="relative flex-1 h-2 rounded-full overflow-hidden"
                        style={{ 
                            background: `linear-gradient(to right, rgba(255,255,255,0.1), ${tintColor})` 
                        }}
                    >
                        <input
                            type="range"
                            min="0"
                            max="100"
                            value={tintOpacity}
                            onChange={(e) => setTintOpacity(parseInt(e.target.value))}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            disabled={disabled}
                        />
                        <div
                            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg border-2 border-gray-600 pointer-events-none"
                            style={{ left: `calc(${tintOpacity}% - 8px)` }}
                        />
                    </div>
                </div>
                {/* Quick tint presets for common colors */}
                <div className="flex gap-1 flex-wrap mt-1">
                    {[
                        { color: "#8B4513", label: "Brown" },
                        { color: "#228B22", label: "Green" },
                        { color: "#4169E1", label: "Blue" },
                        { color: "#DC143C", label: "Red" },
                        { color: "#FFD700", label: "Gold" },
                        { color: "#9370DB", label: "Purple" },
                        { color: "#20B2AA", label: "Teal" },
                        { color: "#FF6347", label: "Coral" },
                    ].map((preset) => (
                        <button
                            key={preset.color}
                            onClick={() => {
                                setTintColor(preset.color);
                                if (tintOpacity === 0) setTintOpacity(30); // Auto-set to 30% if at 0
                            }}
                            className="w-5 h-5 rounded-full border border-white/20 hover:scale-110 transition-transform"
                            style={{ backgroundColor: preset.color }}
                            title={preset.label}
                            disabled={disabled}
                        />
                    ))}
                </div>
                <p className="text-[10px] text-white/30 mt-1">
                    Uses overlay blend - works great on gray/stone textures!
                </p>
            </div>

            {/* Apply Button */}
            <button
                onClick={handleApplyAll}
                disabled={disabled || (hueShift === 0 && saturation === 100 && brightness === 100 && tintOpacity === 0)}
                className="w-full py-2 px-3 bg-purple-600 hover:bg-purple-500 disabled:bg-white/10 disabled:text-white/30 text-white text-sm rounded-lg transition-colors font-medium"
            >
                Apply Adjustments
            </button>
        </div>
    );
};

TextureAdjustments.propTypes = {
    onApplyAdjustment: PropTypes.func.isRequired,
    disabled: PropTypes.bool,
};

export default TextureAdjustments;

/**
 * Utility functions for applying color adjustments to ImageData
 */

// Convert RGB to HSL
export const rgbToHsl = (r, g, b) => {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h,
        s,
        l = (max + min) / 2;

    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        switch (max) {
            case r:
                h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                break;
            case g:
                h = ((b - r) / d + 2) / 6;
                break;
            case b:
                h = ((r - g) / d + 4) / 6;
                break;
            default:
                h = 0;
        }
    }

    return [h * 360, s * 100, l * 100];
};

// Convert HSL to RGB
export const hslToRgb = (h, s, l) => {
    h /= 360;
    s /= 100;
    l /= 100;

    let r, g, b;

    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }

    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
};

// Overlay blend mode - preserves texture detail while adding color
// Works great for grayscale/stone textures
const overlayBlend = (base, blend) => {
    base /= 255;
    blend /= 255;
    const result = base < 0.5 
        ? 2 * base * blend 
        : 1 - 2 * (1 - base) * (1 - blend);
    return Math.round(result * 255);
};

// Apply adjustments to ImageData
export const applyColorAdjustments = (imageData, adjustments) => {
    const data = imageData.data;
    const { hueShift = 0, saturation = 1, brightness = 1, tintColor = "#ffffff", tintOpacity = 0 } = adjustments;

    // Parse tint color
    const tintR = parseInt(tintColor.slice(1, 3), 16);
    const tintG = parseInt(tintColor.slice(3, 5), 16);
    const tintB = parseInt(tintColor.slice(5, 7), 16);

    for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha === 0) continue; // Skip transparent pixels

        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        // Convert to HSL
        let [h, s, l] = rgbToHsl(r, g, b);

        // Apply hue shift
        h = (h + hueShift + 360) % 360;

        // Apply saturation
        s = Math.min(100, Math.max(0, s * saturation));

        // Apply brightness (as lightness adjustment)
        l = Math.min(100, Math.max(0, l * brightness));

        // Convert back to RGB
        [r, g, b] = hslToRgb(h, s, l);

        // Apply tint using overlay blend mode
        // This preserves the texture detail while adding color
        // Perfect for stone, wood, and other grayscale textures
        if (tintOpacity > 0) {
            // Calculate overlay blend
            const overlayR = overlayBlend(r, tintR);
            const overlayG = overlayBlend(g, tintG);
            const overlayB = overlayBlend(b, tintB);
            
            // Interpolate between original and overlay based on opacity
            r = Math.round(r * (1 - tintOpacity) + overlayR * tintOpacity);
            g = Math.round(g * (1 - tintOpacity) + overlayG * tintOpacity);
            b = Math.round(b * (1 - tintOpacity) + overlayB * tintOpacity);
        }

        data[i] = Math.min(255, Math.max(0, r));
        data[i + 1] = Math.min(255, Math.max(0, g));
        data[i + 2] = Math.min(255, Math.max(0, b));
    }

    return imageData;
};

