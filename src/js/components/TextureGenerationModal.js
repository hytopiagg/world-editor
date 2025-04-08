import React, { useState, useCallback, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { FaUndo, FaRedo } from "react-icons/fa";
import EditorToolbar, { TOOLS } from "./EditorToolbar";
import ColorPalette from "./ColorPalette";
import PixelEditorCanvas from "./PixelEditorCanvas";
import BlockPreview3D from "./BlockPreview3D";
import FaceSelector from "./FaceSelector";
import "../../css/TextureGenerationModal.css"; // We'll create this CSS file next
import "../../css/BlockPreview3D.css"; // Import preview CSS
import "../../css/FaceSelector.css"; // Import face selector CSS
import "../../css/EditorToolbar.css"; // Ensure toolbar CSS is imported for button styles
import * as THREE from "three"; // Import THREE

const FACES = ["all", "top", "bottom", "left", "right", "front", "back"];
const GRID_SIZE = 24; // Ensure grid size is accessible here

// Helper to create an empty texture
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

const TextureGenerationModal = ({
    isOpen,
    onClose,
    apiKey,
    onTextureReady,
}) => {
    const [prompt, setPrompt] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    // State to hold the actual THREE.CanvasTexture objects
    const [textureObjects, setTextureObjects] = useState({});
    const [error, setError] = useState(null);

    // Editor state
    const [selectedTool, setSelectedTool] = useState(TOOLS.PENCIL);
    const [selectedColor, setSelectedColor] = useState("#000000");
    const [selectedFace, setSelectedFace] = useState("all");

    // Ref for the canvas component
    const pixelCanvasRef = useRef(null);

    // State to track undo/redo availability for button disabling
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);

    // Effect to dispose textures on unmount
    useEffect(() => {
        return () => {
            Object.values(textureObjects).forEach((texture) =>
                texture?.dispose()
            );
        };
    }, [textureObjects]);

    const handleGenerate = async () => {
        if (!prompt.trim()) {
            setError("Please enter a prompt.");
            return;
        }
        if (!apiKey) {
            setError("API Key is missing. Please configure it.");
            return;
        }

        setIsLoading(true);
        // Dispose existing textures before creating new ones
        Object.values(textureObjects).forEach((texture) => texture?.dispose());
        setTextureObjects({});
        setError(null);
        setSelectedFace("all");

        try {
            const response = await fetch(
                "https://api.retrodiffusion.ai/v1/inferences",
                {
                    method: "POST",
                    headers: {
                        "X-RD-Token": apiKey,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        model: "RD_FLUX",
                        width: GRID_SIZE,
                        height: GRID_SIZE,
                        prompt: `${prompt} with a smooth texture, only 3 shades per color max`,
                        num_images: 1,
                        prompt_style: "mc_texture",
                    }),
                }
            );

            if (!response.ok) {
                throw new Error(await response.text());
            }

            const data = await response.json();

            console.log(data.base64_images[0]);

            if (data.base64_images && data.base64_images.length > 0) {
                const imageDataUrl = `data:image/png;base64,${data.base64_images[0]}`;

                // Load the image
                const img = new Image();
                img.onload = () => {
                    const newTextureObjects = {};
                    FACES.forEach((face) => {
                        const texture = createTexture(GRID_SIZE);
                        const ctx = texture.image.getContext("2d");
                        // Draw the loaded image onto each texture's canvas source
                        ctx.drawImage(img, 0, 0, GRID_SIZE, GRID_SIZE);
                        texture.needsUpdate = true;
                        newTextureObjects[face] = texture;
                    });
                    setTextureObjects(newTextureObjects); // Update state with all textures initialized
                    setIsLoading(false);
                    // Update undo/redo state after textures are loaded
                    setTimeout(() => {
                        if (pixelCanvasRef.current) {
                            setCanUndo(pixelCanvasRef.current.canUndo);
                            setCanRedo(pixelCanvasRef.current.canRedo);
                        }
                    }, 0);
                };
                img.onerror = () => {
                    console.error("Failed to load generated image");
                    setError("Failed to load generated image.");
                    // Initialize with empty textures on error?
                    const errorTextures = {};
                    FACES.forEach((face) => {
                        errorTextures[face] = createTexture(GRID_SIZE);
                    });
                    setTextureObjects(errorTextures);
                    setIsLoading(false);
                };
                img.src = imageDataUrl;
            } else {
                throw new Error("No image data received from API.");
            }
        } catch (err) {
            console.error("API Error:", err);
            setError(err.message || "Failed to generate texture.");
            // Initialize with empty textures on error?
            const errorTextures = {};
            FACES.forEach((face) => {
                errorTextures[face] = createTexture(GRID_SIZE);
            });
            setTextureObjects(errorTextures);
            setIsLoading(false);
        }
    };

    const handleClose = () => {
        setPrompt("");
        Object.values(textureObjects).forEach((texture) => texture?.dispose()); // Dispose textures
        setTextureObjects({});
        setError(null);
        setIsLoading(false);
        setSelectedTool(TOOLS.PENCIL);
        setSelectedColor("#000000");
        setSelectedFace("all");
        onClose();
    };

    // Callback for PixelEditorCanvas to directly update a texture
    const handlePixelUpdate = useCallback(
        (face, imageData) => {
            // If 'all' is selected, update all textures
            if (face === "all") {
                Object.entries(textureObjects).forEach(([key, texture]) => {
                    if (texture && texture.image instanceof HTMLCanvasElement) {
                        const ctx = texture.image.getContext("2d");
                        // Use the single imageData to update all canvases
                        ctx.putImageData(imageData, 0, 0);
                        texture.needsUpdate = true;
                    }
                });
            } else {
                // Otherwise, update only the specific face's texture
                const texture = textureObjects[face];
                if (texture && texture.image instanceof HTMLCanvasElement) {
                    const ctx = texture.image.getContext("2d");
                    ctx.putImageData(imageData, 0, 0);
                    texture.needsUpdate = true;
                } else {
                    console.warn(
                        `Texture object not found or invalid for face: ${face}`
                    );
                }
            }

            // Force a re-render of the modal to ensure BlockPreview3D gets the update signal
            // (Even though texture object references don't change, this ensures parent re-renders)
            setTextureObjects((prev) => ({ ...prev }));

            // Update availability state after the update finishes
            setTimeout(() => {
                if (pixelCanvasRef.current) {
                    setCanUndo(pixelCanvasRef.current.canUndo);
                    setCanRedo(pixelCanvasRef.current.canRedo);
                }
            }, 0);
        },
        [textureObjects] // Keep dependency on textureObjects
    );

    // Update undo/redo state when selected face changes (as history resets)
    useEffect(() => {
        setTimeout(() => {
            if (pixelCanvasRef.current) {
                setCanUndo(pixelCanvasRef.current.canUndo);
                setCanRedo(pixelCanvasRef.current.canRedo);
            }
        }, 0);
    }, [selectedFace]);

    const handleSelectFace = (face) => {
        console.log("Selected face:", face);
        setSelectedFace(face);
    };

    const handleUseTexture = () => {
        if (onTextureReady && Object.keys(textureObjects).length > 0) {
            // Convert texture objects back to data URLs for export
            const exportData = {};
            let success = true;
            try {
                FACES.forEach((face) => {
                    const texture = textureObjects[face];
                    if (texture && texture.image instanceof HTMLCanvasElement) {
                        exportData[face] = texture.image.toDataURL();
                    } else {
                        // Handle cases where a texture might be missing (e.g., initial error)
                        console.warn(
                            `Skipping export for missing/invalid texture on face: ${face}`
                        );
                        // Optionally set to null or a default? Depends on receiver.
                        exportData[face] = null;
                    }
                });
            } catch (error) {
                console.error("Error converting textures to DataURLs:", error);
                setError("Failed to prepare textures for export.");
                success = false;
            }

            if (success) {
                onTextureReady(exportData, prompt || "generated-texture");
            }
        }
        handleClose();
    };

    // Undo/Redo Handlers
    const handleUndo = () => {
        if (pixelCanvasRef.current?.undo) {
            pixelCanvasRef.current.undo();
            setTimeout(() => {
                if (pixelCanvasRef.current) {
                    setCanUndo(pixelCanvasRef.current.canUndo);
                    setCanRedo(pixelCanvasRef.current.canRedo);
                }
            }, 0);
        }
    };

    const handleRedo = () => {
        if (pixelCanvasRef.current?.redo) {
            pixelCanvasRef.current.redo();
            setTimeout(() => {
                if (pixelCanvasRef.current) {
                    setCanUndo(pixelCanvasRef.current.canUndo);
                    setCanRedo(pixelCanvasRef.current.canRedo);
                }
            }, 0);
        }
    };

    if (!isOpen) return null;

    // Determine texture to initially load into canvas
    const initialCanvasTexture = textureObjects[selectedFace];

    return (
        <div className="modal-overlay">
            <div className="modal-content texture-editor-modal">
                {/* Top Bar: Prompt and Generate */}
                <div className="modal-header">
                    <h2>Create & Edit Texture</h2>
                    <button
                        className="modal-close-button"
                        onClick={handleClose}
                    >
                        ×
                    </button>
                </div>
                <div className="generation-controls">
                    <textarea
                        className="prompt-input"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="Enter prompt for 24x24 texture (e.g., mossy stone brick)"
                        rows="2"
                        disabled={isLoading}
                    />
                    <button
                        className="generate-button"
                        onClick={handleGenerate}
                        disabled={isLoading || !prompt.trim()}
                    >
                        {isLoading ? "Generating..." : "Generate"}
                    </button>
                </div>

                {isLoading && (
                    <div className="loading-indicator">Generating image...</div>
                )}
                {error && <div className="error-message">{error}</div>}

                {/* Editor Section: Check if textureObjects has keys */}
                {Object.keys(textureObjects).length > 0 && (
                    <div className="editor-area">
                        <div className="editor-tools">
                            <EditorToolbar
                                selectedTool={selectedTool}
                                onSelectTool={setSelectedTool}
                            />
                            <div className="undo-redo-buttons">
                                <button
                                    onClick={handleUndo}
                                    disabled={!canUndo}
                                    title="Undo"
                                    className="tool-button"
                                >
                                    <FaUndo />
                                </button>
                                <button
                                    onClick={handleRedo}
                                    disabled={!canRedo}
                                    title="Redo"
                                    className="tool-button"
                                >
                                    <FaRedo />
                                </button>
                            </div>
                            <ColorPalette
                                selectedColor={selectedColor}
                                onSelectColor={setSelectedColor}
                            />
                            <BlockPreview3D textureObjects={textureObjects} />
                            <FaceSelector
                                selectedFace={selectedFace}
                                onSelectFace={handleSelectFace}
                            />
                        </div>
                        <div className="editor-canvas-container">
                            <PixelEditorCanvas
                                ref={pixelCanvasRef}
                                key={selectedFace}
                                initialTextureObject={initialCanvasTexture}
                                selectedTool={selectedTool}
                                selectedColor={selectedColor}
                                selectedFace={selectedFace}
                                onPixelUpdate={handlePixelUpdate}
                            />
                        </div>
                    </div>
                )}

                {/* Action Button */}
                {Object.keys(textureObjects).length > 0 && (
                    <div className="modal-actions">
                        <button
                            className="use-texture-button"
                            onClick={handleUseTexture}
                            disabled={!Object.keys(textureObjects).length}
                        >
                            Use Texture
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

TextureGenerationModal.propTypes = {
    isOpen: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired,
    apiKey: PropTypes.string,
    onTextureReady: PropTypes.func.isRequired,
};

export default TextureGenerationModal;
