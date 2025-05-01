import React, { useState, useEffect, useCallback } from "react";
import {
    Flex,
    ColorArea,
    ColorSlider,
    parseColor,
} from "@adobe/react-spectrum";
import styles from "../../css/ColorPicker.module.css";


const CustomNumberInput = ({ label, value, onChange, min, max, step = 1 }) => {
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
        <div className={styles.inputRow}>
            <label className={styles.label}>{label}</label>
            <div className={styles.inputWrapper}>
                <input
                    type="number"
                    className={styles.numberInput}
                    value={localValue}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    min={min}
                    max={max}
                    step={step}
                    style={{ appearance: "textfield", MozAppearance: "textfield" }}
                />
            </div>
        </div>
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
            if (!formattedValue.startsWith('#')) {
                formattedValue = '#' + formattedValue;
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
        <div className={styles.inputRow}>
            <label className={styles.label}>{label}</label>
            <input
                type="text"
                className={styles.hexInput}
                value={localValue}
                onChange={handleChange}
                onBlur={handleBlur}
                maxLength={7}
                placeholder="#RRGGBB"
            />
        </div>
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


    const handleColorChange = useCallback((newColor) => {
        setInternalColor(newColor);
        const hexValue = newColor.toString("hex");
        onChange(hexValue);
    }, [onChange]);


    const updateChannel = useCallback((channel, value) => {
        const newColor = internalColor.withChannelValue(channel, value);
        setInternalColor(newColor);
        onChange(newColor.toString("hex"));
    }, [internalColor, onChange]);


    const updateRgbChannel = useCallback((channel, value) => {
        const rgbColor = internalColor.toFormat("rgb").withChannelValue(channel, value);
        const newColor = rgbColor.toFormat("hsb");
        setInternalColor(newColor);
        onChange(newColor.toString("hex"));
    }, [internalColor, onChange]);


    const rgbValues = {
        red: internalColor.toFormat("rgb").getChannelValue("red"),
        green: internalColor.toFormat("rgb").getChannelValue("green"),
        blue: internalColor.toFormat("rgb").getChannelValue("blue")
    };


    const handleHexChange = useCallback((hexValue) => {
        try {
            const newColor = parseColor(hexValue).toFormat("hsb");
            setInternalColor(newColor);
            onChange(hexValue);
        } catch (e) {
            console.warn("Invalid hex color:", hexValue);
        }
    }, [onChange]);

    return (
        <Flex direction="row" gap="size-150" alignItems="flex-start">
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
                orientation="vertical"
                value={internalColor}
                onChange={handleColorChange}
                height="calc(var(--spectrum-global-dimension-size-1000) + 2 * var(--spectrum-global-dimension-size-10))"
            />

            {/* Input controls */}
            <div className={styles.inputContainer}>
                {/* HSB inputs */}
                <CustomNumberInput
                    label="H"
                    value={Math.round(internalColor.getChannelValue("hue"))}
                    onChange={(val) => updateChannel("hue", val)}
                    min={0}
                    max={360}
                    step={1}
                />
                <CustomNumberInput
                    label="S"
                    value={Math.round(internalColor.getChannelValue("saturation"))}
                    onChange={(val) => updateChannel("saturation", val)}
                    min={0}
                    max={100}
                    step={1}
                />
                <CustomNumberInput
                    label="B"
                    value={Math.round(internalColor.getChannelValue("brightness"))}
                    onChange={(val) => updateChannel("brightness", val)}
                    min={0}
                    max={100}
                    step={1}
                />
                
                <div className={styles.separator}></div>
                
                {/* RGB inputs */}
                <CustomNumberInput
                    label="R"
                    value={Math.round(rgbValues.red)}
                    onChange={(val) => updateRgbChannel("red", val)}
                    min={0}
                    max={255}
                    step={1}
                />
                <CustomNumberInput
                    label="G"
                    value={Math.round(rgbValues.green)}
                    onChange={(val) => updateRgbChannel("green", val)}
                    min={0}
                    max={255}
                    step={1}
                />
                <CustomNumberInput
                    label="B"
                    value={Math.round(rgbValues.blue)}
                    onChange={(val) => updateRgbChannel("blue", val)}
                    min={0}
                    max={255}
                    step={1}
                />
                
                <div className={styles.separator}></div>
                
                {/* Hex input */}
                <CustomHexInput
                    label="Hex"
                    hexValue={internalColor.toString("hex")}
                    onChange={handleHexChange}
                />
            </div>
        </Flex>
    );
}
