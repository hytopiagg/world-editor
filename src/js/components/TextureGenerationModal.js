import React, { useState, useCallback, useEffect, useRef } from "react";
import Button from "../../js/components/buttons/Button";
import PropTypes from "prop-types";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import EditorToolbar, { TOOLS } from "./EditorToolbar";
import PixelEditorCanvas from "./PixelEditorCanvas";
import BlockPreview3D from "./BlockPreview3D";
import FaceSelector from "./FaceSelector";
import "../../css/TextureGenerationModal.css"; // We'll create this CSS file next
import * as THREE from "three"; // Import THREE
import CustomColorPicker from "./ColorPicker";
const FACES = ["all", "top", "bottom", "left", "right", "front", "back"];
const GRID_SIZE = 24; // Ensure grid size is accessible here

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
const TextureGenerationModal = ({ isOpen, onClose, onTextureReady }) => {
    const [prompt, setPrompt] = useState("");
    const [textureName, setTextureName] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const [textureObjects, setTextureObjects] = useState({});
    const [error, setError] = useState(null);
    const [hCaptchaToken, setHCaptchaToken] = useState(null);
    const [captchaError, setCaptchaError] = useState(null);
    const hCaptchaRef = useRef(null); // Ref for resetting captcha

    const [selectedTool, setSelectedTool] = useState(TOOLS.PENCIL);
    const [selectedColor, setSelectedColor] = useState("#000000");
    const [selectedFace, setSelectedFace] = useState("all");

    const pixelCanvasRef = useRef(null);

    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);

    useEffect(() => {
        if (isOpen) {
            const initialTextures = {};
            FACES.forEach((face) => {
                initialTextures[face] = createTexture(GRID_SIZE);
            });
            setTextureObjects(initialTextures);

            setSelectedTool(TOOLS.PENCIL);
            setSelectedColor("#000000");
            setSelectedFace("all");
            setCanUndo(false);
            setCanRedo(false);
            setError(null);
            setCaptchaError(null);
            setPrompt(""); // Clear prompt on open
            setHCaptchaToken(null);

            if (hCaptchaRef.current) {
                hCaptchaRef.current.resetCaptcha();
            }
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
    }, [isOpen]); // Depend only on isOpen

    const generateTexture = async () => {
        if (!prompt.trim()) {
            setError("Please enter a prompt.");
            return;
        }
        setIsLoading(true);

        Object.values(textureObjects).forEach((texture) => texture?.dispose());
        setTextureObjects({});
        setError(null);
        setSelectedFace("all");
        setCaptchaError(null); // Clear captcha error on new generation attempt

        if (!hCaptchaToken) {
            setCaptchaError("Please complete the CAPTCHA verification.");
            setIsLoading(false);
            return;
        }

        try {
            const response = await fetch(
                `${process.env.REACT_APP_API_URL}/generate_texture`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        prompt: prompt,
                        hCaptchaToken: hCaptchaToken,
                    }),
                }
            );
            if (!response.ok) {
                throw new Error(await response.text());
            }
            const data = await response.json();
            console.log(data);
            if (data.base64_image) {
                const imageDataUrl = `data:image/png;base64,${data.base64_image}`;

                const img = new Image();
                img.onload = () => {
                    const newTextureObjects = {};
                    FACES.forEach((face) => {
                        const texture = createTexture(GRID_SIZE);
                        const ctx = texture.image.getContext("2d");

                        ctx.drawImage(img, 0, 0, GRID_SIZE, GRID_SIZE);
                        texture.needsUpdate = true;
                        newTextureObjects[face] = texture;
                    });
                    setTextureObjects(newTextureObjects); // Update state with all textures initialized
                    setTextureName(prompt); // Default texture name to prompt
                    setIsLoading(false);

                    setCanUndo(false);
                    setCanRedo(false);
                };
                img.onerror = () => {
                    console.error("Failed to load generated image");
                    setError("Failed to load generated image.");

                    setIsLoading(false);
                };
                img.src = imageDataUrl;
            } else {
                throw new Error("No image data received from API.");
            }
        } catch (err) {
            console.error("API Error:", err);
            setError(err.message || "Failed to generate texture.");

            setIsLoading(false);
        } finally {
            setHCaptchaToken(null);
            if (hCaptchaRef.current) {
                hCaptchaRef.current.resetCaptcha();
            }
            setIsLoading(false); // Ensure loading is false on errors too
        }
    };

    const handleGenerateClick = () => {
        if (!prompt.trim() || isLoading) return;

        if (hCaptchaToken) {
            generateTexture();
            return;
        }

        setCaptchaError(null);
        // Execute the captcha verification programmatically
        if (hCaptchaRef.current) {
            try {
                hCaptchaRef.current.execute();
            } catch (error) {
                console.error("Failed to execute hCaptcha:", error);
                setCaptchaError(
                    "Failed to initiate CAPTCHA. Please try again."
                );
            }
        } else {
            setCaptchaError("CAPTCHA component not ready. Please try again.");
        }
    };

    useEffect(() => {
        if (hCaptchaToken) {
            generateTexture();
        }
    }, [hCaptchaToken]);

    const handleClose = () => {
        onClose(); // Just call onClose, useEffect handles the rest
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
                } else {
                    console.warn(
                        `Texture object not found or invalid for face: ${face}`
                    );
                }
            }

            setTextureObjects((prev) => ({ ...prev }));
        },
        [textureObjects] // Keep dependency on textureObjects
    );

    const handleHistoryChange = useCallback((canUndoNow, canRedoNow) => {
        console.log("TextureGenerationModal: History changed:", {
            canUndoNow,
            canRedoNow,
        });
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
    }, [pixelCanvasRef.current, handleHistoryChange]);
    const handleSelectFace = (face) => {
        console.log("Selected face:", face);
        setSelectedFace(face);
    };
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
                        console.warn(
                            `Skipping export for missing/invalid texture on face: ${face}`
                        );

                        exportData[face] = null;
                    }
                });
            } catch (error) {
                console.error("Error converting textures to DataURLs:", error);
                setError("Failed to prepare textures for export.");
                success = false;
            }
            if (success) {
                onTextureReady(
                    exportData,
                    textureName.trim() || prompt || "generated-texture"
                );
            }
        }
        handleClose();
    };

    const handleUndo = () => {
        console.log("Undo");
        if (pixelCanvasRef.current?.undo) {
            console.log("Calling undo");
            pixelCanvasRef.current.undo();
        }
    };
    const handleRedo = () => {
        if (pixelCanvasRef.current?.redo) {
            pixelCanvasRef.current.redo();
        }
    };

    const colorPickerController = useCallback(
        {
            pickColor: (hexColor) => {
                if (hexColor) {
                    setSelectedColor(hexColor);
                }
            },
            setTool: (toolName) => {
                setSelectedTool(toolName);
            },
        },
        [] // Empty dependency array since the functions only reference state setters
    );

    if (!isOpen) return null;

    const initialCanvasTexture = textureObjects[selectedFace];
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
                className="flex flex-col gap-2 bg-[#0D0D0D]/30 max-h-[90vh] rounded-2xl p-3 backdrop-blur-lg opacity-0 fade-up overflow-scroll"
                style={{
                    animationDuration: "0.5s",
                }}
            >
                {/* Top Bar: Title */}

                {/* Main Content Area with Sidebar and Canvas */}
                <div className="p-3">
                    <div className="modal-header">
                        <h2 className="text-white text-2xl font-bold">
                            Create & Edit Texture
                        </h2>
                    </div>
                    <div className="top-controls-container">
                        {/* Static Sidebar for Tools and Preview */}
                        <div className="flex flex-col gap-2 max-w-fit p-2.5 border border-white/10 rounded-lg">
                            <div className="preview-face-container">
                                <BlockPreview3D
                                    textureObjects={textureObjects}
                                />
                            </div>
                            <FaceSelector
                                selectedFace={selectedFace}
                                onSelectFace={handleSelectFace}
                            />
                        </div>

                        {/* Scalable Canvas Area */}
                        <div className="flex items-center gap-2 justify-center">
                            <PixelEditorCanvas
                                ref={pixelCanvasRef}
                                key={selectedFace}
                                initialTextureObject={initialCanvasTexture}
                                selectedTool={selectedTool}
                                selectedColor={selectedColor}
                                selectedFace={selectedFace}
                                onPixelUpdate={handlePixelUpdate}
                                onColorPicked={colorPickerController}
                            />
                        </div>
                        <div className="flex flex-col gap-2 max-w-fit p-2.5 border border-white/10 rounded-lg">
                            <CustomColorPicker
                                value={selectedColor}
                                onChange={setSelectedColor}
                            />
                            <EditorToolbar
                                selectedTool={selectedTool}
                                onSelectTool={setSelectedTool}
                                onUndo={handleUndo}
                                onRedo={handleRedo}
                                canUndo={canUndo}
                                canRedo={canRedo}
                            />
                        </div>
                    </div>
                    {/* Bottom Controls Area */}
                    <div className="border border-white/10 bg-white/10 rounded-lg p-2.5 mt-3 flex flex-col gap-2 items-center w-full text-start">
                        {/* Error Display */}
                        {error && <div className="error-message">{error}</div>}
                        <h3 className="text-white text-xs mr-auto">
                            Generate AI Texture
                        </h3>
                        {/* Generation Section - Moved to Bottom */}
                        <div className="flex gap-2 w-full relative">
                            <div className="generation-controls">
                                <textarea
                                    className="border border-white/10 rounded-lg p-2 w-full resize-none"
                                    value={prompt}
                                    onKeyDown={(e) => e.stopPropagation()}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    placeholder="Enter prompt for 24x24 texture (e.g., mossy stone brick)"
                                    rows="1"
                                    disabled={isLoading}
                                />
                            </div>

                            <div className="generation-buttons">
                                <Button
                                    design="primary"
                                    tier={3}
                                    onClick={handleGenerateClick}
                                    style={{
                                        fontSize: "12px",
                                        padding: "6px 12px",
                                        borderRadius: "8px",
                                    }}
                                    disabled={isLoading || !prompt.trim()}
                                >
                                    {isLoading ? (
                                        <div className="flex items-center gap-1.5 justify-center">
                                            Generating
                                            <div className="w-3.5 h-3.5 border-2 border-black/30 border-t-black/80 rounded-full animate-spin" />
                                        </div>
                                    ) : (
                                        "Generate"
                                    )}
                                </Button>
                            </div>

                            {/* Invisible hCaptcha - always in DOM but hidden */}
                            <div
                                style={{
                                    position: "fixed",
                                    visibility: "hidden",
                                    bottom: 0,
                                    right: 0,
                                }}
                            >
                                <HCaptcha
                                    ref={hCaptchaRef}
                                    theme="dark"
                                    size="invisible"
                                    sitekey={
                                        process.env.REACT_APP_HCAPTCHA_SITE_KEY
                                    }
                                    onVerify={(token) => {
                                        setHCaptchaToken(token);
                                        setCaptchaError(null);
                                    }}
                                    onExpire={() => {
                                        setHCaptchaToken(null);
                                        setCaptchaError(
                                            "CAPTCHA expired. Please try again."
                                        );
                                    }}
                                    onError={(err) => {
                                        setHCaptchaToken(null);
                                        setCaptchaError(
                                            `CAPTCHA error: ${err}`
                                        );
                                    }}
                                />
                            </div>

                            {captchaError && (
                                <div className="error-message captcha-error">
                                    {captchaError}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                {/* Action Buttons */}
                <div className="modal-actions">
                    <Button
                        design="tertiary"
                        tier={3}
                        onClick={handleClose}
                        style={{
                            fontSize: "12px",
                            padding: "6px 12px",
                            borderRadius: "8px",
                        }}
                    >
                        Cancel
                    </Button>
                    {/* Texture name input */}
                    <input
                        type="text"
                        className="texture-name-input"
                        placeholder="Texture name"
                        value={textureName}
                        onChange={(e) => setTextureName(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                    />
                    <Button
                        design="primary"
                        tier={3}
                        style={{
                            fontSize: "12px",
                            padding: "6px 12px",
                            borderRadius: "8px",
                        }}
                        onClick={handleUseTexture}
                        disabled={
                            Object.keys(textureObjects).length === 0 ||
                            !textureName.trim()
                        }
                    >
                        Add Texture
                    </Button>
                </div>
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
