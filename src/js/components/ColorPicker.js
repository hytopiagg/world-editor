import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
    Flex,
    ColorArea,
    ColorSlider,
    parseColor,
} from "@adobe/react-spectrum";
import styles from "./CustomColorPicker.module.css";

const CustomNumberInput = ({
    label,
    value,
    onChange,
    min,
    max,
    step = 1,
    formatOptions,
    width,
}) => {
    const handleChange = (e) => {
        let newValue = parseFloat(e.target.value);
        if (isNaN(newValue)) {
            newValue = min; // Or handle differently
        }
        newValue = Math.max(min, Math.min(max, newValue));
        onChange(newValue);
    };

    let displayValue = value;
    if (formatOptions?.style === "percent") {
        displayValue = (value / 100).toLocaleString(undefined, {
            style: "percent",
            maximumFractionDigits: formatOptions.maximumFractionDigits ?? 0,
        });
    } else {
        displayValue = value.toFixed(formatOptions?.maximumFractionDigits ?? 0);
    }

    const [inputValue, setInputValue] = useState(() =>
        value.toFixed(formatOptions?.maximumFractionDigits ?? 0)
    ); // Initial state from prop
    useEffect(() => {
        const propValueFormatted = value.toFixed(
            formatOptions?.maximumFractionDigits ?? 0
        );
        if (propValueFormatted !== inputValue) {
            setInputValue(propValueFormatted);
        }
    }, [value, formatOptions]);
    const handleInputChange = (e) => {
        setInputValue(e.target.value);
    };
    const handleBlur = (e) => {
        let numericValue = parseFloat(e.target.value);
        if (isNaN(numericValue)) {
            numericValue = min;
        } else {
            numericValue = Math.max(min, Math.min(max, numericValue));
        }
        onChange(numericValue);
        setInputValue(
            numericValue.toFixed(formatOptions?.maximumFractionDigits ?? 0)
        );
    };
    const increment = () => {
        const newValue = Math.min(max, value + step);
        onChange(newValue);
        setInputValue(
            newValue.toFixed(formatOptions?.maximumFractionDigits ?? 0)
        );
    };
    const decrement = () => {
        const newValue = Math.max(min, value - step);
        onChange(newValue);
        setInputValue(
            newValue.toFixed(formatOptions?.maximumFractionDigits ?? 0)
        );
    };
    return (
        <div className={styles.inputRow} style={width ? { width } : {}}>
            <label className={styles.label}>{label}</label>
            <div className={styles.inputWrapper}>
                <input
                    type="number"
                    className={styles.numberInput}
                    value={inputValue}
                    onChange={handleInputChange}
                    onBlur={handleBlur}
                    min={min}
                    max={max}
                    step={step}
                    style={{
                        appearance: "textfield",
                        MozAppearance: "textfield",
                    }}
                />
                <div className={styles.stepperButtons}>
                    <button
                        type="button"
                        onClick={increment}
                        className={styles.stepperButton}
                    >
                        ▲
                    </button>
                    <button
                        type="button"
                        onClick={decrement}
                        className={styles.stepperButton}
                    >
                        ▼
                    </button>
                </div>
            </div>
        </div>
    );
};

const CustomHexInput = ({ label, value, onChange }) => {
    const [hexValue, setHexValue] = useState(value.toString("hex"));
    useEffect(() => {
        setHexValue(value.toString("hex"));
    }, [value]);
    const handleChange = (e) => {
        let input = e.target.value;
        setHexValue(input); // Allow typing
        try {
            if (
                input.startsWith("#") &&
                (input.length === 7 || input.length === 4)
            ) {
                const newColor = parseColor(input);
                onChange(newColor.toFormat("hsb"));
            } else if (
                !input.startsWith("#") &&
                (input.length === 6 || input.length === 3)
            ) {
                const newColor = parseColor(`#${input}`);
                onChange(newColor.toFormat("hsb"));
            }
        } catch (error) {

            console.warn("Invalid hex color", input);
        }
    };
    const handleBlur = (e) => {
        let input = e.target.value;
        try {
            const newColor = parseColor(
                input.startsWith("#") ? input : `#${input}`
            );
            onChange(newColor.toFormat("hsb"));
            setHexValue(newColor.toString("hex"));
        } catch (error) {
            setHexValue(value.toString("hex"));
            console.warn("Invalid hex color on blur, reverting", input);
        }
    };
    return (
        <div className={styles.inputRow}>
            <label className={styles.label}>{label}</label>
            <input
                type="text"
                className={styles.hexInput}
                value={hexValue}
                onChange={handleChange}
                onBlur={handleBlur}
                maxLength={7}
                placeholder="#aabbcc"
            />
        </div>
    );
};
/**
 * A Spectrum-style picker with custom inputs
 * • 2-D SV box
 * • vertical hue slider
 * • custom editable hex/HSB/RGB inputs
 *
 * Props
 * ──────────────────────────────────────────────────
 * value        – hex string (“#C4DB42”)
 * onChange(hex) – called whenever the color changes
 */
export default function CustomColorPicker({ value, onChange }) {
    const [colorObj, setColorObj] = useState(() =>
        parseColor(value || "#000000").toFormat("hsb")
    );
    useEffect(() => {
        const newHex = colorObj.toString("hex");

        if (newHex !== value) {
            onChange(newHex);
        }
    }, [colorObj, onChange, value]); // Added value dependency

    const syncColor = useMemo(
        () => parseColor(value || "#000000").toFormat("hsb"),
        [value]
    );
    useEffect(() => {
        if (syncColor.toString("hsb") !== colorObj.toString("hsb")) {
            setColorObj(syncColor);
        }
    }, [syncColor]);

    const handleHueChange = useCallback(
        (h) => setColorObj(colorObj.withChannelValue("hue", h)),
        [colorObj]
    );
    const handleSaturationChange = useCallback(
        (s) => setColorObj(colorObj.withChannelValue("saturation", s)),
        [colorObj]
    );
    const handleBrightnessChange = useCallback(
        (b) => setColorObj(colorObj.withChannelValue("brightness", b)),
        [colorObj]
    );
    const handleRedChange = useCallback(
        (r) => {
            const rgbColor = colorObj
                .toFormat("rgb")
                .withChannelValue("red", r);
            setColorObj(rgbColor.toFormat("hsb"));
        },
        [colorObj]
    );
    const handleGreenChange = useCallback(
        (g) => {
            const rgbColor = colorObj
                .toFormat("rgb")
                .withChannelValue("green", g);
            setColorObj(rgbColor.toFormat("hsb"));
        },
        [colorObj]
    );
    const handleBlueChange = useCallback(
        (b) => {
            const rgbColor = colorObj
                .toFormat("rgb")
                .withChannelValue("blue", b);
            setColorObj(rgbColor.toFormat("hsb"));
        },
        [colorObj]
    );
    const handleHexChange = useCallback((newColor) => {

        setColorObj(newColor);
    }, []);
    return (
        <Flex direction="row" gap="size-150" alignItems="flex-start">
            {/* SV square – saturation (x) × brightness (y) in HSB space  */}
            <ColorArea
                value={colorObj}
                onChange={setColorObj}
                xChannel="saturation"
                yChannel="brightness"
                height="size-1000" // Adjust size as needed
                width="size-1200" // Adjust size as needed
            />
            {/* vertical hue slider */}
            <ColorSlider
                channel="hue"
                orientation="vertical"
                value={colorObj}
                onChange={setColorObj}
                height="calc(var(--spectrum-global-dimension-size-1000) + 2 * var(--spectrum-global-dimension-size-10))" // Match height of ColorArea + input padding/margins roughly
            />
            {/* Container for Custom Inputs */}
            <div className={styles.inputContainer}>
                <CustomNumberInput
                    label="H"
                    value={colorObj.getChannelValue("hue")}
                    onChange={handleHueChange}
                    min={0}
                    max={360}
                    step={1}
                    formatOptions={{ maximumFractionDigits: 0 }}
                />
                <CustomNumberInput
                    label="S"
                    value={colorObj.getChannelValue("saturation")}
                    onChange={handleSaturationChange}
                    min={0}
                    max={100}
                    step={1}
                    formatOptions={{
                        /*style: "percent",*/ maximumFractionDigits: 0,
                    }} // Using plain number for simplicity
                />
                <CustomNumberInput
                    label="B"
                    value={colorObj.getChannelValue("brightness")}
                    onChange={handleBrightnessChange}
                    min={0}
                    max={100}
                    step={1}
                    formatOptions={{
                        /*style: "percent",*/ maximumFractionDigits: 0,
                    }} // Using plain number for simplicity
                />
                <div className={styles.separator}></div>{" "}
                {/* Optional separator */}
                <CustomNumberInput
                    label="R"
                    value={colorObj.toFormat("rgb").getChannelValue("red")}
                    onChange={handleRedChange}
                    min={0}
                    max={255}
                    step={1}
                    formatOptions={{ maximumFractionDigits: 0 }}
                />
                <CustomNumberInput
                    label="G"
                    value={colorObj.toFormat("rgb").getChannelValue("green")}
                    onChange={handleGreenChange}
                    min={0}
                    max={255}
                    step={1}
                    formatOptions={{ maximumFractionDigits: 0 }}
                />
                <CustomNumberInput
                    label="B"
                    value={colorObj.toFormat("rgb").getChannelValue("blue")}
                    onChange={handleBlueChange}
                    min={0}
                    max={255}
                    step={1}
                    formatOptions={{ maximumFractionDigits: 0 }}
                />
                <div className={styles.separator}></div>{" "}
                {/* Optional separator */}
                <CustomHexInput
                    label="Hex"
                    value={colorObj} // Pass the color object
                    onChange={handleHexChange} // Let the component handle parsing
                />
            </div>
        </Flex>
    );
}
