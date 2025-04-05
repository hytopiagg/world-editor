import React from "react";
import PropTypes from "prop-types";
import "../../css/ColorPalette.css";

// Simple default palette - can be expanded or made dynamic later
const DEFAULT_COLORS = [
    "#FFFFFF",
    "#C1C1C1",
    "#8F8F8F",
    "#5B5B5B",
    "#272727",
    "#FF0000",
    "#FF7F00",
    "#FFFF00",
    "#7FFF00",
    "#00FF00",
    "#00FF7F",
    "#00FFFF",
    "#007FFF",
    "#0000FF",
    "#7F00FF",
    "#FF00FF",
    "#FF007F",
    "#603B1F",
    "#946741",
    "#C79363",
    "#FAD1A8",
    "#000000", // Added Black
];

const ColorPalette = ({
    selectedColor,
    onSelectColor,
    colors = DEFAULT_COLORS,
}) => {
    return (
        <div className="color-palette">
            {colors.map((color) => (
                <button
                    key={color}
                    className={`color-swatch ${
                        selectedColor === color ? "active" : ""
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => onSelectColor(color)}
                    title={color}
                />
            ))}
            {/* Add custom color picker/adder later? */}
        </div>
    );
};

ColorPalette.propTypes = {
    selectedColor: PropTypes.string.isRequired,
    onSelectColor: PropTypes.func.isRequired,
    colors: PropTypes.arrayOf(PropTypes.string),
};

export default ColorPalette;
