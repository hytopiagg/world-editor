import { ColorArea, ColorSlider, parseColor } from "@adobe/react-spectrum";
import { useCallback, useEffect, useState } from "react";
import styles from "../../css/ColorPicker.module.css";

const CustomNumberInput = ({ value, onChange, min, max, step = 1 }) => {
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
            className="w-10 text-center text-xs bg-transparent border border-white/10 rounded-md p-1 outline-none"
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
 * A color picker component with stable update behavior
 */
export default function CustomColorPicker({ value = "#000000", onChange }) {
    const [internalColor, setInternalColor] = useState(() => {
        try {
            return parseColor(value).toFormat("hsb");
        } catch (e) {
            return parseColor("#000000").toFormat("hsb");
        }
    });

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

    const handleColorChange = useCallback(
        (newColor) => {
            setInternalColor(newColor);
            const hexValue = newColor.toString("hex");
            onChange(hexValue);
        },
        [onChange]
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
            </div>

            {/* Input controls */}
            <div className="flex flex-col gap-2">
                {/* RGB inputs */}
                <div className="flex gap-2">
                    <p className="text-sm font-bold text-left">RGB:</p>
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
                </div>

                <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                        {/* HSB inputs */}
                        <p className="text-sm font-bold text-left">HSB:</p>
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
                <div className="flex gap-2">
                    <p className="text-sm font-bold text-left">HEX:</p>
                    <CustomHexInput
                        hexValue={internalColor.toString("hex")}
                        onChange={handleHexChange}
                    />
                </div>
            </div>
        </div>
    );
}
