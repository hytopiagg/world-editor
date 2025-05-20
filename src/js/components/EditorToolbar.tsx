import React from "react";
import PropTypes from "prop-types";
import {
    FaPencilAlt,
    FaEraser,
    FaFillDrip,
    FaUndo,
    FaRedo,
    FaEyeDropper,
} from "react-icons/fa"; // Using icons
import "../../css/TextureGenerationModal.css"; // CSS for styling

const TOOLS = {
    PENCIL: "pencil",
    ERASER: "eraser",
    FILL: "fill",
    EYEDROPPER: "eyedropper", // New eyedropper tool
};
const EditorToolbar = ({
    selectedTool,
    onSelectTool,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
}) => {
    return (
        <div className="flex flex-col gap-1">
            <label className="text-xs text-white/50">Tools:</label>
            <div className="flex flex-wrap gap-1.5">
                <button
                    className={`border border-white/10 items-center justify-center flex w-1/3 grow py-1.5 px-1 rounded-md transition-colors duration-200 cursor-pointer active:scale-95 hover:border-white ${
                        selectedTool === TOOLS.PENCIL ? "active" : ""
                    }`}
                onClick={() => onSelectTool(TOOLS.PENCIL)}
                title="Pencil"
            >
                <FaPencilAlt />
            </button>
            <button
                className={`border border-white/10 items-center justify-center flex w-1/3 grow py-1.5 px-1 rounded-md transition-colors duration-200 cursor-pointer active:scale-95 hover:border-white ${
                    selectedTool === TOOLS.ERASER ? "active" : ""
                }`}
                onClick={() => onSelectTool(TOOLS.ERASER)}
                title="Eraser"
            >
                <FaEraser />
            </button>
            <button
                className={`border border-white/10 items-center justify-center flex w-1/3 grow py-1.5 px-1 rounded-md transition-colors duration-200 cursor-pointer active:scale-95 hover:border-white ${
                    selectedTool === TOOLS.FILL ? "active" : ""
                }`}
                onClick={() => onSelectTool(TOOLS.FILL)}
                title="Fill Bucket"
            >
                <FaFillDrip />
            </button>
            <button
                className={`border border-white/10 items-center justify-center flex w-1/3 grow py-1.5 px-1 rounded-md transition-colors duration-200 cursor-pointer active:scale-95 hover:border-white ${
                    selectedTool === TOOLS.EYEDROPPER ? "active" : ""
                }`}
                onClick={() => onSelectTool(TOOLS.EYEDROPPER)}
                title="Color Picker (Alt)"
            >
                <FaEyeDropper />
            </button>
            <button
                onClick={onUndo}
                disabled={!canUndo}
                title="Undo"
                className="border border-white/10 items-center justify-center flex w-1/3 grow py-1.5 px-1 rounded-md transition-colors duration-200 cursor-pointer active:scale-95 hover:border-white"
            >
                <FaUndo />
            </button>
            <button
                onClick={onRedo}
                disabled={!canRedo}
                title="Redo"
                className="border border-white/10 items-center justify-center flex w-1/3 grow py-1.5 px-1 rounded-md transition-colors duration-200 cursor-pointer active:scale-95 hover:border-white"
            >
                <FaRedo />
            </button>
            </div>
        </div>
    );
};
EditorToolbar.propTypes = {
    selectedTool: PropTypes.string.isRequired,
    onSelectTool: PropTypes.func.isRequired,
    onUndo: PropTypes.func,
    onRedo: PropTypes.func,
    canUndo: PropTypes.bool,
    canRedo: PropTypes.bool,
};

export { TOOLS };
export default EditorToolbar;
