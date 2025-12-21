import React, { useState, useCallback, useEffect, useRef } from "react";
import Button from "../../js/components/buttons/Button";
import PropTypes from "prop-types";
import { TOOLS } from "./EditorToolbar";
import PixelEditorCanvas from "./PixelEditorCanvas";
import BlockPreview3D from "./BlockPreview3D";
import FaceSelector from "./FaceSelector";
import "../../css/TextureGenerationModal.css";
import * as THREE from "three";
import CustomColorPicker from "./ColorPicker";
import TextureAdjustments, {
    applyColorAdjustments,
} from "./TextureAdjustments";
import CreationModeSelector from "./CreationModeSelector";
import AIGenerateScreen from "./AIGenerateScreen";
import TexturePickerScreen from "./TexturePickerScreen";
import TextureBlendScreen from "./TextureBlendScreen";
import CollapsibleSection from "./CollapsibleSection";
import {
    FaPalette,
    FaMagic,
    FaPencilAlt,
    FaFillDrip,
    FaEraser,
    FaEyeDropper,
    FaUndo,
    FaRedo,
    FaArrowLeft,
    FaSyncAlt,
} from "react-icons/fa";

const FACES = ["all", "top", "bottom", "left", "right", "front", "back"];
const GRID_SIZE = 24;

const createTexture = (size) => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    return texture;
};

// Tool icons mapping
const TOOL_ICONS = {
    [TOOLS.PENCIL]: FaPencilAlt,
    [TOOLS.FILL]: FaFillDrip,
    [TOOLS.ERASER]: FaEraser,
    [TOOLS.COLOR_PICKER]: FaEyeDropper,
};

const TextureGenerationModal = ({ isOpen, onClose, onTextureReady }) => {
    // Creation mode: 'choose' | 'existing' | 'ai' | 'editor'
    const [creationMode, setCreationMode] = useState("choose");

    const [textureName, setTextureName] = useState("");
    const [textureObjects, setTextureObjects] = useState({});
    const [error, setError] = useState(null);

    const [selectedTool, setSelectedTool] = useState(TOOLS.PENCIL);
    const [selectedColor, setSelectedColor] = useState("#000000");
    const [selectedOpacity, setSelectedOpacity] = useState(100);
    const [selectedFace, setSelectedFace] = useState("all");

    const pixelCanvasRef = useRef(null);

    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);

    // Which sidebar section is open: 'color' | 'adjustments' | null
    const [openSection, setOpenSection] = useState("color");

    // Initialize textures
    const initializeTextures = useCallback(() => {
        const initialTextures = {};
        FACES.forEach((face) => {
            initialTextures[face] = createTexture(GRID_SIZE);
        });
        setTextureObjects(initialTextures);
        setCanUndo(false);
        setCanRedo(false);
    }, []);

    useEffect(() => {
        if (isOpen) {
            initializeTextures();
            setCreationMode("choose");
            setSelectedTool(TOOLS.PENCIL);
            setSelectedColor("#000000");
            setSelectedFace("all");
            setError(null);
            setTextureName("");
        } else {
            Object.values(textureObjects).forEach((texture) =>
                texture?.dispose()
            );
            setTextureObjects({});
        }

        return () => {
            if (!isOpen) {
                Object.values(textureObjects).forEach((texture) =>
                    texture?.dispose()
                );
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const handleClose = () => {
        onClose();
    };

    const handlePixelUpdate = useCallback(
        (face, imageData) => {
            if (face === "all") {
                Object.entries(textureObjects).forEach(([key, texture]) => {
                    if (texture && texture.image instanceof HTMLCanvasElement) {
                        const ctx = texture.image.getContext("2d");
                        ctx.putImageData(imageData, 0, 0);
                        texture.needsUpdate = true;
                    }
                });
            } else {
                const texture = textureObjects[face];
                if (texture && texture.image instanceof HTMLCanvasElement) {
                    const ctx = texture.image.getContext("2d");
                    ctx.putImageData(imageData, 0, 0);
                    texture.needsUpdate = true;
                }
            }
            setTextureObjects((prev) => ({ ...prev }));
        },
        [textureObjects]
    );

    const handleHistoryChange = useCallback((canUndoNow, canRedoNow) => {
        setCanUndo(canUndoNow);
        setCanRedo(canRedoNow);
    }, []);

    useEffect(() => {
        if (pixelCanvasRef.current) {
            const originalNotify = pixelCanvasRef.current.notifyHistoryChanged;
            pixelCanvasRef.current.notifyHistoryChanged = (
                canUndoNow,
                canRedoNow
            ) => {
                if (originalNotify) {
                    originalNotify(canUndoNow, canRedoNow);
                }
                handleHistoryChange(canUndoNow, canRedoNow);
            };
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [handleHistoryChange]);

    const handleSelectFace = (face) => {
        setSelectedFace(face);
    };

    // Handle mode selection
    const handleSelectMode = (mode) => {
        if (mode === "blank") {
            initializeTextures();
            setCreationMode("editor");
        } else if (mode === "existing") {
            setCreationMode("existing");
        } else if (mode === "blend") {
            setCreationMode("blend");
        } else if (mode === "ai") {
            setCreationMode("ai");
        }
    };

    // Handle base texture selection from picker
    const handleBaseTextureSelect = useCallback(
        (faceTextures, isMultiTexture, blockName) => {
            const newTextureObjects = {};

            FACES.forEach((face) => {
                const texture = createTexture(GRID_SIZE);
                const ctx = texture.image.getContext("2d");

                let textureDataUrl;
                if (isMultiTexture && faceTextures[face]) {
                    textureDataUrl = faceTextures[face];
                } else if (faceTextures.all) {
                    textureDataUrl = faceTextures.all;
                } else {
                    textureDataUrl = Object.values(faceTextures)[0];
                }

                if (textureDataUrl) {
                    const img = new Image();
                    img.onload = () => {
                        ctx.drawImage(img, 0, 0, GRID_SIZE, GRID_SIZE);
                        texture.needsUpdate = true;
                        setTextureObjects((prev) => ({ ...prev }));
                    };
                    img.src = textureDataUrl;
                }

                newTextureObjects[face] = texture;
            });

            setTextureObjects(newTextureObjects);
            setTextureName(blockName ? `${blockName} (modified)` : "");
            setCanUndo(false);
            setCanRedo(false);
            setCreationMode("editor");
        },
        []
    );

    // Handle AI texture for editing
    const handleAIEditTexture = useCallback((imageDataUrl, name) => {
        const newTextureObjects = {};

        const img = new Image();
        img.onload = () => {
            FACES.forEach((face) => {
                const texture = createTexture(GRID_SIZE);
                const ctx = texture.image.getContext("2d");
                ctx.drawImage(img, 0, 0, GRID_SIZE, GRID_SIZE);
                texture.needsUpdate = true;
                newTextureObjects[face] = texture;
            });
            setTextureObjects(newTextureObjects);
            setTextureName(name || "");
            setCanUndo(false);
            setCanRedo(false);
            setCreationMode("editor");
        };
        img.src = imageDataUrl;
    }, []);

    // Handle AI texture direct save
    const handleAISaveDirectly = useCallback(
        (imageDataUrl, name) => {
            const exportData = {};

            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = GRID_SIZE;
                canvas.height = GRID_SIZE;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, GRID_SIZE, GRID_SIZE);
                const dataUrl = canvas.toDataURL();

                FACES.forEach((face) => {
                    exportData[face] = dataUrl;
                });

                onTextureReady(exportData, name);
                onClose();
            };
            img.src = imageDataUrl;
        },
        [onTextureReady, onClose]
    );

    // Handle color adjustments
    const handleApplyAdjustment = useCallback(
        (adjustment) => {
            if (!textureObjects || Object.keys(textureObjects).length === 0) {
                setError("No texture to adjust.");
                return;
            }

            const facesToAdjust =
                selectedFace === "all"
                    ? FACES.filter((f) => f !== "all")
                    : [selectedFace];

            facesToAdjust.forEach((face) => {
                const texture = textureObjects[face];
                if (texture && texture.image instanceof HTMLCanvasElement) {
                    const ctx = texture.image.getContext("2d");
                    const imageData = ctx.getImageData(
                        0,
                        0,
                        GRID_SIZE,
                        GRID_SIZE
                    );

                    const adjustedData = applyColorAdjustments(imageData, {
                        hueShift: adjustment.hueShift || 0,
                        saturation: adjustment.saturation ?? 1,
                        brightness: adjustment.brightness ?? 1,
                        tintColor: adjustment.tintColor || "#ffffff",
                        tintOpacity: adjustment.tintOpacity || 0,
                    });

                    ctx.putImageData(adjustedData, 0, 0);
                    texture.needsUpdate = true;
                }
            });

            setTextureObjects((prev) => ({ ...prev }));

            if (pixelCanvasRef.current && textureObjects[selectedFace]) {
                const texture = textureObjects[selectedFace];
                if (texture && texture.image instanceof HTMLCanvasElement) {
                    const ctx = texture.image.getContext("2d");
                    const imageData = ctx.getImageData(
                        0,
                        0,
                        GRID_SIZE,
                        GRID_SIZE
                    );
                    if (pixelCanvasRef.current.onPixelUpdate) {
                        pixelCanvasRef.current.onPixelUpdate(
                            selectedFace,
                            imageData
                        );
                    }
                }
            }
        },
        [textureObjects, selectedFace]
    );

    const handleUseTexture = () => {
        if (onTextureReady && Object.keys(textureObjects).length > 0) {
            const exportData = {};
            let success = true;
            try {
                FACES.forEach((face) => {
                    const texture = textureObjects[face];
                    if (texture && texture.image instanceof HTMLCanvasElement) {
                        exportData[face] = texture.image.toDataURL();
                    } else {
                        exportData[face] = null;
                        success = false;
                    }
                });
            } catch (error) {
                console.error("Error converting textures:", error);
                setError("Failed to prepare textures.");
                success = false;
            }
            if (success) {
                onTextureReady(
                    exportData,
                    textureName.trim() || "custom-texture"
                );
            }
        }
        handleClose();
    };

    // Rotate texture by specified degrees (90, 180, 270)
    const handleRotate = useCallback(
        (degrees) => {
            if (!textureObjects || Object.keys(textureObjects).length === 0) {
                return;
            }

            const facesToRotate =
                selectedFace === "all"
                    ? FACES.filter((f) => f !== "all")
                    : [selectedFace];

            facesToRotate.forEach((face) => {
                const texture = textureObjects[face];
                if (texture && texture.image instanceof HTMLCanvasElement) {
                    const ctx = texture.image.getContext("2d");
                    const imageData = ctx.getImageData(
                        0,
                        0,
                        GRID_SIZE,
                        GRID_SIZE
                    );

                    // Create rotated image data
                    const rotatedData = new ImageData(GRID_SIZE, GRID_SIZE);
                    const src = imageData.data;
                    const dst = rotatedData.data;

                    for (let y = 0; y < GRID_SIZE; y++) {
                        for (let x = 0; x < GRID_SIZE; x++) {
                            let newX, newY;

                            switch (degrees) {
                                case 90:
                                    newX = GRID_SIZE - 1 - y;
                                    newY = x;
                                    break;
                                case 180:
                                    newX = GRID_SIZE - 1 - x;
                                    newY = GRID_SIZE - 1 - y;
                                    break;
                                case 270:
                                    newX = y;
                                    newY = GRID_SIZE - 1 - x;
                                    break;
                                default:
                                    newX = x;
                                    newY = y;
                            }

                            const srcIdx = (y * GRID_SIZE + x) * 4;
                            const dstIdx = (newY * GRID_SIZE + newX) * 4;

                            dst[dstIdx] = src[srcIdx];
                            dst[dstIdx + 1] = src[srcIdx + 1];
                            dst[dstIdx + 2] = src[srcIdx + 2];
                            dst[dstIdx + 3] = src[srcIdx + 3];
                        }
                    }

                    ctx.putImageData(rotatedData, 0, 0);
                    texture.needsUpdate = true;
                }
            });

            // Trigger re-render
            setTextureObjects((prev) => ({ ...prev }));

            // Update the pixel canvas
            if (pixelCanvasRef.current && textureObjects[selectedFace]) {
                const texture = textureObjects[selectedFace];
                if (texture && texture.image instanceof HTMLCanvasElement) {
                    const ctx = texture.image.getContext("2d");
                    const imageData = ctx.getImageData(
                        0,
                        0,
                        GRID_SIZE,
                        GRID_SIZE
                    );
                    // Force canvas to reload the texture
                    if (pixelCanvasRef.current.loadFromImageData) {
                        pixelCanvasRef.current.loadFromImageData(imageData);
                    }
                }
            }
        },
        [textureObjects, selectedFace]
    );

    const handleUndo = () => {
        if (pixelCanvasRef.current?.undo) {
            pixelCanvasRef.current.undo();
        }
    };

    const handleRedo = () => {
        if (pixelCanvasRef.current?.redo) {
            pixelCanvasRef.current.redo();
        }
    };

    const colorPickerController = {
        pickColor: (hexColor) => {
            if (hexColor) {
                setSelectedColor(hexColor);
            }
        },
        setTool: (toolName) => {
            setSelectedTool(toolName);
        },
    };

    if (!isOpen) return null;

    const initialCanvasTexture = textureObjects[selectedFace];

    // Render different screens based on creation mode
    const renderContent = () => {
        switch (creationMode) {
            case "choose":
                return (
                    <CreationModeSelector
                        onSelectMode={handleSelectMode}
                        onClose={handleClose}
                    />
                );

            case "existing":
                return (
                    <TexturePickerScreen
                        onSelectTexture={handleBaseTextureSelect}
                        onBack={() => setCreationMode("choose")}
                        onClose={handleClose}
                    />
                );

            case "ai":
                return (
                    <AIGenerateScreen
                        onBack={() => setCreationMode("choose")}
                        onEditTexture={handleAIEditTexture}
                        onSaveDirectly={handleAISaveDirectly}
                        onClose={handleClose}
                    />
                );

            case "blend":
                return (
                    <TextureBlendScreen
                        onBack={() => setCreationMode("choose")}
                        onEditTexture={handleAIEditTexture}
                        onSaveDirectly={handleAISaveDirectly}
                        onClose={handleClose}
                    />
                );

            case "editor":
                return (
                    <div className="flex flex-col gap-3 p-4 min-w-[700px] max-h-[90vh]">
                        {/* Header with Tools */}
                        <div className="flex gap-3 items-center">
                            {/* Back button */}
                            <button
                                onClick={() => setCreationMode("choose")}
                                className="flex gap-1.5 items-center text-sm transition-colors text-white/50 hover:text-white"
                            >
                                <FaArrowLeft size={12} />
                                New
                            </button>

                            {/* Tool buttons */}
                            <div className="flex gap-1 items-center px-2 py-1 rounded-lg border bg-white/5 border-white/10">
                                {Object.entries(TOOL_ICONS).map(
                                    ([tool, Icon]) => (
                                        <button
                                            key={tool}
                                            onClick={() =>
                                                setSelectedTool(tool)
                                            }
                                            className={`p-2 rounded transition-all ${
                                                selectedTool === tool
                                                    ? "bg-white text-black"
                                                    : "text-white/60 hover:text-white hover:bg-white/10"
                                            }`}
                                            title={
                                                tool.charAt(0).toUpperCase() +
                                                tool.slice(1)
                                            }
                                        >
                                            <Icon size={14} />
                                        </button>
                                    )
                                )}
                                <div className="mx-1 w-px h-5 bg-white/20" />
                                <button
                                    onClick={handleUndo}
                                    disabled={!canUndo}
                                    className="p-2 rounded transition-all text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
                                    title="Undo"
                                >
                                    <FaUndo size={12} />
                                </button>
                                <button
                                    onClick={handleRedo}
                                    disabled={!canRedo}
                                    className="p-2 rounded transition-all text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
                                    title="Redo"
                                >
                                    <FaRedo size={12} />
                                </button>
                                <div className="mx-1 w-px h-5 bg-white/20" />
                                {/* Rotate 90° button */}
                                <button
                                    onClick={() => handleRotate(90)}
                                    className="p-2 rounded transition-all text-white/60 hover:text-white hover:bg-white/10"
                                    title="Rotate 90°"
                                >
                                    <FaSyncAlt size={12} />
                                </button>
                            </div>

                            {/* Spacer */}
                            <div className="flex-1" />

                            {/* Texture name input */}
                            <input
                                type="text"
                                value={textureName}
                                onChange={(e) => setTextureName(e.target.value)}
                                onKeyDown={(e) => e.stopPropagation()}
                                placeholder="Texture name..."
                                className="px-3 py-1.5 w-48 text-sm text-white rounded-lg border bg-white/5 border-white/10 focus:outline-none focus:border-blue-500/50"
                            />

                            {/* Save button */}
                            <Button
                                design="primary"
                                tier={3}
                                onClick={handleUseTexture}
                                disabled={
                                    Object.keys(textureObjects).length === 0 ||
                                    !textureName.trim()
                                }
                                style={{
                                    fontSize: "12px",
                                    padding: "6px 16px",
                                    borderRadius: "8px",
                                }}
                            >
                                Save Texture
                            </Button>

                            {/* Close button */}
                            <button
                                onClick={handleClose}
                                className="p-2 transition-colors text-white/50 hover:text-white"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Error Display */}
                        {error && (
                            <div className="px-3 py-2 text-sm text-red-400 rounded-lg border bg-red-500/10 border-red-500/30">
                                {error}
                            </div>
                        )}

                        {/* Main Editor Area */}
                        <div className="flex gap-4">
                            {/* Left Panel - Preview & Face Selector */}
                            <div className="flex flex-col gap-3 p-3 rounded-lg border border-white/10 bg-white/5">
                                <BlockPreview3D
                                    textureObjects={textureObjects}
                                />
                                <FaceSelector
                                    selectedFace={selectedFace}
                                    onSelectFace={handleSelectFace}
                                />
                            </div>

                            {/* Center - Canvas */}
                            <div className="flex flex-1 justify-center items-center">
                                <PixelEditorCanvas
                                    ref={pixelCanvasRef}
                                    key={selectedFace}
                                    initialTextureObject={initialCanvasTexture}
                                    selectedTool={selectedTool}
                                    selectedColor={selectedColor}
                                    selectedOpacity={selectedOpacity}
                                    selectedFace={selectedFace}
                                    onPixelUpdate={handlePixelUpdate}
                                    onColorPicked={colorPickerController}
                                />
                            </div>

                            {/* Right Panel - Color & Adjustments */}
                            <div className="flex flex-col gap-2 w-64">
                                <CollapsibleSection
                                    title="Color"
                                    icon={FaPalette}
                                    iconColor="text-pink-400"
                                    isOpen={openSection === "color"}
                                    onToggle={() =>
                                        setOpenSection(
                                            openSection === "color"
                                                ? null
                                                : "color"
                                        )
                                    }
                                >
                                    <CustomColorPicker
                                        value={selectedColor}
                                        onChange={setSelectedColor}
                                        showOpacity={true}
                                        opacity={selectedOpacity}
                                        onOpacityChange={setSelectedOpacity}
                                    />
                                </CollapsibleSection>

                                <CollapsibleSection
                                    title="Adjustments"
                                    icon={FaMagic}
                                    iconColor="text-purple-400"
                                    isOpen={openSection === "adjustments"}
                                    onToggle={() =>
                                        setOpenSection(
                                            openSection === "adjustments"
                                                ? null
                                                : "adjustments"
                                        )
                                    }
                                >
                                    <TextureAdjustments
                                        onApplyAdjustment={
                                            handleApplyAdjustment
                                        }
                                        disabled={
                                            Object.keys(textureObjects)
                                                .length === 0
                                        }
                                    />
                                </CollapsibleSection>
                            </div>
                        </div>
                    </div>
                );

            default:
                return null;
        }
    };

    return (
        <div
            onClick={handleClose}
            className="modal-overlay"
            style={{
                zIndex: 1000,
                backgroundColor: "rgba(0, 0, 0, 0.7)",
                backdropFilter: "blur(10px)",
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="flex flex-col bg-[#0D0D0D]/90 rounded-2xl backdrop-blur-lg opacity-0 fade-up border border-white/10"
                style={{
                    animationDuration: "0.4s",
                }}
            >
                {renderContent()}
            </div>
        </div>
    );
};

TextureGenerationModal.propTypes = {
    isOpen: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired,
    onTextureReady: PropTypes.func.isRequired,
};

export default TextureGenerationModal;
