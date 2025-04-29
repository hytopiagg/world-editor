import React from "react";
import PropTypes from "prop-types";
import {
    FaPencilAlt,
    FaEraser,
    FaFillDrip,
    FaUndo,
    FaRedo,
} from "react-icons/fa"; // Using icons
import "../../css/TextureGenerationModal.css"; // CSS for styling

const TOOLS = {
    PENCIL: "pencil",
    ERASER: "eraser",
    FILL: "fill",
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
        <div className="editor-toolbar">
            <label className="face-selector-label">Edit Face:</label>
            <button
                className={`tool-button ${
                    selectedTool === TOOLS.PENCIL ? "active" : ""
                }`}
                onClick={() => onSelectTool(TOOLS.PENCIL)}
                title="Pencil"
            >
                <FaPencilAlt />
            </button>
            <button
                className={`tool-button ${
                    selectedTool === TOOLS.ERASER ? "active" : ""
                }`}
                onClick={() => onSelectTool(TOOLS.ERASER)}
                title="Eraser"
            >
                <FaEraser />
            </button>
            <button
                className={`tool-button ${
                    selectedTool === TOOLS.FILL ? "active" : ""
                }`}
                onClick={() => onSelectTool(TOOLS.FILL)}
                title="Fill Bucket"
            >
                <FaFillDrip />
            </button>
            <button
                onClick={onUndo}
                disabled={!canUndo}
                title="Undo"
                className="tool-button-undo-redo"
            >
                <FaUndo />
            </button>
            <button
                onClick={onRedo}
                disabled={!canRedo}
                title="Redo"
                className="tool-button-undo-redo"
            >
                <FaRedo />
            </button>
        </div>
    );
};

EditorToolbar.propTypes = {
    selectedTool: PropTypes.string.isRequired,
    onSelectTool: PropTypes.func.isRequired,
};

// Export TOOLS constant as well if needed elsewhere
export { TOOLS };
export default EditorToolbar;
