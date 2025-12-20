import { ColorArea, ColorSlider, parseColor } from "@adobe/react-spectrum";
import { useCallback, useEffect, useState } from "react";

const CustomNumberInput = ({ value, onChange, min, max, step = 1, width = "w-10" }) => {
    const [localValue, setLocalValue] = useState(value);

    useEffect(() => {
        if (Math.abs(localValue - value) > 0.1) {
            setLocalValue(value);
        }
    }, [value]);

    const handleChange = (e) => {
        const newValue = Math.max(min, Math.min(max, Number(e.target.value)));
        setLocalValue(newValue);
    };

    const handleBlur = () => {
        onChange(localValue);
    };

    return (
        <input
            type="number"
            className={`${width} text-center text-xs bg-transparent border border-white/10 rounded-md p-1 outline-none`}
            value={localValue}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={(e) => e.stopPropagation()}
            min={min}
            max={max}
            step={step}
            style={{
                appearance: "none",
                MozAppearance: "textfield",
                WebkitAppearance: "none",
            }}
        />
    );
};

const CustomHexInput = ({ label, hexValue, onChange }) => {
    const [localValue, setLocalValue] = useState(hexValue);

    useEffect(() => {
        if (localValue !== hexValue) {
            setLocalValue(hexValue);
        }
    }, [hexValue]);

    const handleChange = (e) => {
        setLocalValue(e.target.value);
    };

    const handleBlur = () => {
        try {
            let formattedValue = localValue;
            if (!formattedValue.startsWith("#")) {
                formattedValue = "#" + formattedValue;
            }

            if (/^#([0-9A-F]{3}){1,2}$/i.test(formattedValue)) {
                onChange(formattedValue);
            } else {
                setLocalValue(hexValue);
            }
        } catch (error) {
            setLocalValue(hexValue);
        }
    };

    return (
        <input
            type="text"
            className="w-20 text-center text-xs bg-transparent border border-white/10 rounded-md p-1 outline-none"
            value={localValue}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={(e) => e.stopPropagation()}
            maxLength={7}
            placeholder="#RRGGBB"
        />
    );
};
/**
 * A color picker component with stable update behavior and opacity support
 */
export default function CustomColorPicker({ value = "#000000", onChange, showOpacity = true, opacity = 100, onOpacityChange }) {
    const [internalColor, setInternalColor] = useState(() => {
        try {
            return parseColor(value).toFormat("hsb");
        } catch (e) {
            return parseColor("#000000").toFormat("hsb");
        }
    });
    
    const [internalOpacity, setInternalOpacity] = useState(opacity);

    useEffect(() => {
        try {
            const newColor = parseColor(value).toFormat("hsb");
            if (newColor.toString("hex") !== internalColor.toString("hex")) {
                setInternalColor(newColor);
            }
        } catch (e) {
            console.warn("Invalid color value:", value);
        }
    }, [value]);

    useEffect(() => {
        if (opacity !== internalOpacity) {
            setInternalOpacity(opacity);
        }
    }, [opacity]);

    const handleColorChange = useCallback(
        (newColor) => {
            setInternalColor(newColor);
            const hexValue = newColor.toString("hex");
            onChange(hexValue);
        },
        [onChange]
    );

    const handleOpacityChange = useCallback(
        (newOpacity) => {
            setInternalOpacity(newOpacity);
            if (onOpacityChange) {
                onOpacityChange(newOpacity);
            }
        },
        [onOpacityChange]
    );

    const updateChannel = useCallback(
        (channel, value) => {
            const newColor = internalColor.withChannelValue(channel, value);
            setInternalColor(newColor);
            onChange(newColor.toString("hex"));
        },
        [internalColor, onChange]
    );

    const updateRgbChannel = useCallback(
        (channel, value) => {
            const rgbColor = internalColor
                .toFormat("rgb")
                .withChannelValue(channel, value);
            const newColor = rgbColor.toFormat("hsb");
            setInternalColor(newColor);
            onChange(newColor.toString("hex"));
        },
        [internalColor, onChange]
    );

    const rgbValues = {
        red: internalColor.toFormat("rgb").getChannelValue("red"),
        green: internalColor.toFormat("rgb").getChannelValue("green"),
        blue: internalColor.toFormat("rgb").getChannelValue("blue"),
    };

    const handleHexChange = useCallback(
        (hexValue) => {
            try {
                const newColor = parseColor(hexValue).toFormat("hsb");
                setInternalColor(newColor);
                onChange(hexValue);
            } catch (e) {
                console.warn("Invalid hex color:", hexValue);
            }
        },
        [onChange]
    );

    // Generate checkerboard pattern for opacity preview
    const checkerboardBg = `
        linear-gradient(45deg, #808080 25%, transparent 25%),
        linear-gradient(-45deg, #808080 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #808080 75%),
        linear-gradient(-45deg, transparent 75%, #808080 75%)
    `;

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2">
                {/* Color area */}
                <ColorArea
                    value={internalColor}
                    onChange={handleColorChange}
                    xChannel="saturation"
                    yChannel="brightness"
                    height="size-1000"
                    width="size-1200"
                />

                {/* Hue slider */}
                <ColorSlider
                    channel="hue"
                    orientation="horizontal"
                    value={internalColor}
                    onChange={handleColorChange}
                    height="calc(var(--spectrum-global-dimension-size-1000) + 2 * var(--spectrum-global-dimension-size-10))"
                />

                {/* Opacity slider */}
                {showOpacity && (
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <label className="text-xs text-white/60">Opacity</label>
                            <span className="text-xs text-white/40">{internalOpacity}%</span>
                        </div>
                        <div className="relative h-4 rounded-full overflow-hidden">
                            {/* Checkerboard background */}
                            <div
                                className="absolute inset-0"
                                style={{
                                    background: checkerboardBg,
                                    backgroundSize: "8px 8px",
                                    backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0px",
                                }}
                            />
                            {/* Gradient overlay showing current color with opacity */}
                            <div
                                className="absolute inset-0"
                                style={{
                                    background: `linear-gradient(to right, transparent, ${internalColor.toString("hex")})`,
                                }}
                            />
                            {/* Slider input */}
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={internalOpacity}
                                onChange={(e) => handleOpacityChange(parseInt(e.target.value))}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
                            {/* Slider thumb indicator */}
                            <div
                                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg border-2 border-gray-600 pointer-events-none"
                                style={{
                                    left: `calc(${internalOpacity}% - 8px)`,
                                }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Color preview with opacity */}
            {showOpacity && (
                <div className="flex items-center gap-2">
                    <span className="text-xs text-white/60">Preview:</span>
                    <div className="relative w-8 h-8 rounded overflow-hidden border border-white/20">
                        <div
                            className="absolute inset-0"
                            style={{
                                background: checkerboardBg,
                                backgroundSize: "8px 8px",
                                backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0px",
                            }}
                        />
                        <div
                            className="absolute inset-0"
                            style={{
                                backgroundColor: internalColor.toString("hex"),
                                opacity: internalOpacity / 100,
                            }}
                        />
                    </div>
                    <span className="text-xs text-white/40 font-mono">
                        {internalColor.toString("hex")}{Math.round(internalOpacity * 2.55).toString(16).padStart(2, '0').toUpperCase()}
                    </span>
                </div>
            )}

            {/* Input controls */}
            <div className="flex flex-col gap-2">
                {/* RGB inputs */}
                <div className="flex gap-2 items-center">
                    <p className="text-sm font-bold text-left w-8">RGB:</p>
                    <CustomNumberInput
                        value={Math.round(rgbValues.red)}
                        onChange={(val) => updateRgbChannel("red", val)}
                        min={0}
                        max={255}
                        step={1}
                    />
                    <CustomNumberInput
                        value={Math.round(rgbValues.green)}
                        onChange={(val) => updateRgbChannel("green", val)}
                        min={0}
                        max={255}
                        step={1}
                    />
                    <CustomNumberInput
                        value={Math.round(rgbValues.blue)}
                        onChange={(val) => updateRgbChannel("blue", val)}
                        min={0}
                        max={255}
                        step={1}
                    />
                    {showOpacity && (
                        <CustomNumberInput
                            value={internalOpacity}
                            onChange={handleOpacityChange}
                            min={0}
                            max={100}
                            step={1}
                            width="w-10"
                        />
                    )}
                </div>

                <div className="flex flex-col gap-2">
                    <div className="flex gap-2 items-center">
                        {/* HSB inputs */}
                        <p className="text-sm font-bold text-left w-8">HSB:</p>
                        <CustomNumberInput
                            value={Math.round(
                                internalColor.getChannelValue("hue")
                            )}
                            onChange={(val) => updateChannel("hue", val)}
                            min={0}
                            max={360}
                            step={1}
                        />
                        <CustomNumberInput
                            value={Math.round(
                                internalColor.getChannelValue("saturation")
                            )}
                            onChange={(val) => updateChannel("saturation", val)}
                            min={0}
                            max={100}
                            step={1}
                        />
                        <CustomNumberInput
                            value={Math.round(
                                internalColor.getChannelValue("brightness")
                            )}
                            onChange={(val) => updateChannel("brightness", val)}
                            min={0}
                            max={100}
                            step={1}
                        />
                    </div>
                </div>

                {/* Hex input */}
                <div className="flex gap-2 items-center">
                    <p className="text-sm font-bold text-left w-8">HEX:</p>
                    <CustomHexInput
                        hexValue={internalColor.toString("hex")}
                        onChange={handleHexChange}
                    />
                </div>
            </div>
        </div>
    );
}
