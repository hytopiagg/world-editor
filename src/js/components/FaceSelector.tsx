import React from "react";
import PropTypes from "prop-types";
import "../../css/TextureGenerationModal.css";
import clsx from "clsx";

const FACES = ["Top", "Bottom", "Left", "Right", "Front", "Back", "All"];
const FaceSelector = ({ selectedFace, onSelectFace }) => {
    return (
        <div className="flex flex-col gap-1">
            <label className="text-xs text-white/50">Edit Face:</label>
            <div className="flex flex-wrap gap-1.5">
                {FACES.map((face) => (
                    <button
                        key={face}
                        className={clsx(
                            "border hover:border-white items-center justify-center flex w-1/3 grow py-1 px-1 rounded-md transition-colors duration-200 cursor-pointer active:scale-95",
                            selectedFace === face.toLowerCase() && "border-white/50 bg-white/10",
                            selectedFace !== face.toLowerCase() && "border-white/10"
                        )}
                        onClick={() => onSelectFace(face.toLowerCase())}
                    >
                        {face}
                    </button>
                ))}
            </div>
        </div>
    );
};
FaceSelector.propTypes = {
    selectedFace: PropTypes.string.isRequired,
    onSelectFace: PropTypes.func.isRequired,
};
export default FaceSelector;
