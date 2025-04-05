import React from "react";
import PropTypes from "prop-types";
import "../../css/FaceSelector.css";

const FACES = ["Top", "Bottom", "Left", "Right", "Front", "Back", "All"];

const FaceSelector = ({ selectedFace, onSelectFace }) => {
	return (
		<div className="face-selector">
			<label className="face-selector-label">Edit Face:</label>
			<div className="face-buttons">
				{FACES.map((face) => (
					<button
						key={face}
						className={`face-button ${
							selectedFace === face.toLowerCase() ? "active" : ""
						}`}
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
