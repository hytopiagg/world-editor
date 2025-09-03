import React from "react";
import { playUIClick } from "../Sound";
import Tooltip from "./Tooltip";
const BlockButton = ({
    blockType,
    isSelected,
    onSelect,
    handleDragStart,
}) => {
    const getTextureUrl = (blockType) => {
        const toAbsolute = (p) => {
            if (!p) return p;
            if (p.startsWith("data:")) return p;
            let rel = p;
            if (p.startsWith("/assets/")) rel = `.${p}`;
            if (p.startsWith("assets/")) rel = `./${p}`;
            try {
                return new URL(rel, window.location.href).toString();
            } catch {
                return rel;
            }
        };

        if (!blockType.textureUri || blockType.textureUri.includes("error.png")) {
            return toAbsolute("./assets/blocks/error.png");
        }
        // Use as-is for custom (often data URIs) and built-ins (relative paths)
        return toAbsolute(blockType.textureUri);
    };
    const isMissingTexture =
        !blockType.textureUri ||
        blockType.textureUri.includes("error.png") ||
        blockType.hasMissingTexture ||
        (blockType.isMultiTexture && !blockType.sideTextures["+y"]);
    return (
        <Tooltip text={blockType.name}>
            <button
                className={`block-button ${isSelected ? "selected" : ""}`}
                style={{
                    border: isSelected ? "2px solid #fff" : "2px solid rgba(255, 255, 255, 0.1)",
                }}
                onClick={() => {
                    if (isMissingTexture && !blockType.isCustom) {
                        alert(
                            "Missing system texture! \n \nThis means the map has this block, but the texture hasn't been added yet. Please select a different block, or upload the correct texture of the same name.\n \nTexture Name: \"" +
                            blockType.name +
                            '"'
                        );
                        return;
                    }
                    onSelect(blockType);
                    playUIClick();
                }}
                draggable={true}
                onDragStart={() => handleDragStart(blockType.id)}
            >
                <div
                    className="block-preview"
                    style={{
                        backgroundImage: `url(${getTextureUrl(
                            blockType.isMultiTexture
                                ? {
                                    ...blockType,
                                    textureUri:
                                        blockType.sideTextures["+y"] ||
                                        blockType.textureUri,
                                }
                                : blockType
                        )})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        imageRendering: "pixelated",
                    }}
                />
                {blockType?.isCustom && typeof blockType?.lightLevel === "number" && (
                    <div className="light-level-badge" title={`Light: ${blockType.lightLevel}`}>
                        {blockType.lightLevel}
                    </div>
                )}
                <div className="block-button-label">{blockType.name}</div>
                {isMissingTexture && (
                    <div className="block-button-missing-texture">
                        Missing Texture!
                    </div>
                )}
            </button>
        </Tooltip>
    );
};
export default React.memo(BlockButton);
