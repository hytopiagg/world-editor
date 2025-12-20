import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { getBlockTypes } from "../managers/BlockTypesManager";
import { 
    FaArrowLeft, 
    FaArrowRight, 
    FaArrowUp, 
    FaArrowDown,
    FaSearch,
    FaExchangeAlt,
    FaPencilAlt,
    FaSave
} from "react-icons/fa";

const GRID_SIZE = 24;

// Blend modes
const BLEND_MODES = {
    GRADIENT: "gradient",
    STEPPED: "stepped",
    DITHER: "dither",
};

// Direction options
const DIRECTIONS = {
    LEFT_TO_RIGHT: "left-to-right",
    RIGHT_TO_LEFT: "right-to-left",
    TOP_TO_BOTTOM: "top-to-bottom",
    BOTTOM_TO_TOP: "bottom-to-top",
};

const DIRECTION_ICONS = {
    [DIRECTIONS.LEFT_TO_RIGHT]: FaArrowRight,
    [DIRECTIONS.RIGHT_TO_LEFT]: FaArrowLeft,
    [DIRECTIONS.TOP_TO_BOTTOM]: FaArrowDown,
    [DIRECTIONS.BOTTOM_TO_TOP]: FaArrowUp,
};

const TextureBlendScreen = ({ onBack, onEditTexture, onSaveDirectly, onClose }) => {
    const [textureA, setTextureA] = useState(null);
    const [textureB, setTextureB] = useState(null);
    const [textureAData, setTextureAData] = useState(null);
    const [textureBData, setTextureBData] = useState(null);
    const [selectingFor, setSelectingFor] = useState(null); // 'A' | 'B' | null
    const [searchTerm, setSearchTerm] = useState("");
    const [blendMode, setBlendMode] = useState(BLEND_MODES.GRADIENT);
    const [direction, setDirection] = useState(DIRECTIONS.LEFT_TO_RIGHT);
    const [blendStrength, setBlendStrength] = useState(50); // 0-100, controls transition width
    const [textureName, setTextureName] = useState("");
    const [loadedTextures, setLoadedTextures] = useState({});
    const [blendedResult, setBlendedResult] = useState(null);
    
    const previewCanvasRef = useRef(null);

    // Helper to convert relative paths to absolute URLs
    const toAbsoluteUrl = (p) => {
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

    // Get texture URL for a block
    const getBlockTextureUrl = (block) => {
        if (!block.textureUri || block.textureUri.includes("error.png")) {
            return toAbsoluteUrl("./assets/blocks/error.png");
        }
        if (block.isMultiTexture && block.sideTextures) {
            const topTexture = block.sideTextures["+y"] || block.textureUri;
            return toAbsoluteUrl(topTexture);
        }
        return toAbsoluteUrl(block.textureUri);
    };

    // Get all block types
    const blockTypes = useMemo(() => {
        try {
            return getBlockTypes() || [];
        } catch (_) {
            return [];
        }
    }, []);

    // Filter blocks
    const filteredBlocks = useMemo(() => {
        if (!searchTerm.trim()) return blockTypes;
        const lower = searchTerm.toLowerCase();
        return blockTypes.filter(
            (block) =>
                block.name.toLowerCase().includes(lower) ||
                String(block.id).includes(lower)
        );
    }, [blockTypes, searchTerm]);

    // Load texture preview
    const loadTexturePreview = async (block) => {
        if (loadedTextures[block.id]) return loadedTextures[block.id];

        try {
            const img = new Image();
            img.crossOrigin = "anonymous";

            return new Promise((resolve) => {
                img.onload = () => {
                    const canvas = document.createElement("canvas");
                    canvas.width = GRID_SIZE;
                    canvas.height = GRID_SIZE;
                    const ctx = canvas.getContext("2d");
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(img, 0, 0, GRID_SIZE, GRID_SIZE);
                    const dataUrl = canvas.toDataURL();
                    setLoadedTextures((prev) => ({ ...prev, [block.id]: dataUrl }));
                    resolve(dataUrl);
                };
                img.onerror = () => {
                    setLoadedTextures((prev) => ({ ...prev, [block.id]: null }));
                    resolve(null);
                };
                const textureUrl = getBlockTextureUrl(block);
                if (textureUrl) {
                    img.src = textureUrl;
                } else {
                    resolve(null);
                }
            });
        } catch (error) {
            return null;
        }
    };

    // Load textures for visible blocks
    useEffect(() => {
        if (selectingFor) {
            const blocksToLoad = filteredBlocks.filter(
                (block) => loadedTextures[block.id] === undefined
            );
            const loadBatch = async (blocks, batchSize = 10) => {
                for (let i = 0; i < blocks.length; i += batchSize) {
                    const batch = blocks.slice(i, i + batchSize);
                    await Promise.all(batch.map((block) => loadTexturePreview(block)));
                }
            };
            if (blocksToLoad.length > 0) {
                loadBatch(blocksToLoad);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filteredBlocks, selectingFor]);

    // Load full texture data for blending
    const loadTextureData = async (block) => {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = GRID_SIZE;
                canvas.height = GRID_SIZE;
                const ctx = canvas.getContext("2d");
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(img, 0, 0, GRID_SIZE, GRID_SIZE);
                const imageData = ctx.getImageData(0, 0, GRID_SIZE, GRID_SIZE);
                resolve(imageData);
            };
            img.onerror = () => resolve(null);
            img.src = getBlockTextureUrl(block);
        });
    };

    // Select a texture
    const handleSelectTexture = async (block) => {
        const data = await loadTextureData(block);
        if (selectingFor === "A") {
            setTextureA(block);
            setTextureAData(data);
        } else if (selectingFor === "B") {
            setTextureB(block);
            setTextureBData(data);
        }
        setSelectingFor(null);
        setSearchTerm("");
        
        // Auto-generate name
        if (selectingFor === "A" && textureB) {
            setTextureName(`${block.name}-to-${textureB.name}`);
        } else if (selectingFor === "B" && textureA) {
            setTextureName(`${textureA.name}-to-${block.name}`);
        }
    };

    // Swap textures
    const handleSwapTextures = () => {
        const tempBlock = textureA;
        const tempData = textureAData;
        setTextureA(textureB);
        setTextureAData(textureBData);
        setTextureB(tempBlock);
        setTextureBData(tempData);
        if (textureA && textureB) {
            setTextureName(`${textureB.name}-to-${textureA.name}`);
        }
    };

    // Blend two textures
    const blendTextures = useCallback(() => {
        if (!textureAData || !textureBData) return null;

        const result = new ImageData(GRID_SIZE, GRID_SIZE);
        const dataA = textureAData.data;
        const dataB = textureBData.data;

        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const i = (y * GRID_SIZE + x) * 4;

                // Calculate blend factor based on direction and position
                let progress;
                switch (direction) {
                    case DIRECTIONS.LEFT_TO_RIGHT:
                        progress = x / (GRID_SIZE - 1);
                        break;
                    case DIRECTIONS.RIGHT_TO_LEFT:
                        progress = 1 - x / (GRID_SIZE - 1);
                        break;
                    case DIRECTIONS.TOP_TO_BOTTOM:
                        progress = y / (GRID_SIZE - 1);
                        break;
                    case DIRECTIONS.BOTTOM_TO_TOP:
                        progress = 1 - y / (GRID_SIZE - 1);
                        break;
                    default:
                        progress = x / (GRID_SIZE - 1);
                }

                // Apply blend strength (controls transition width)
                // 0 = sharp transition at 50%, 100 = full gradient
                const transitionWidth = blendStrength / 100;
                const center = 0.5;
                let blendFactor;

                if (transitionWidth === 0) {
                    blendFactor = progress < center ? 0 : 1;
                } else {
                    const halfWidth = transitionWidth / 2;
                    const start = center - halfWidth;
                    const end = center + halfWidth;
                    
                    if (progress <= start) {
                        blendFactor = 0;
                    } else if (progress >= end) {
                        blendFactor = 1;
                    } else {
                        blendFactor = (progress - start) / (end - start);
                    }
                }

                // Apply blend mode
                let finalBlendFactor = blendFactor;

                switch (blendMode) {
                    case BLEND_MODES.GRADIENT:
                        // Smooth gradient - use easing
                        finalBlendFactor = blendFactor * blendFactor * (3 - 2 * blendFactor); // smoothstep
                        break;

                    case BLEND_MODES.STEPPED:
                        // Stepped with progressive edge
                        // Add some randomness at the edge
                        const noise = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
                        const edgeNoise = (noise - 0.5) * 0.3;
                        finalBlendFactor = Math.max(0, Math.min(1, blendFactor + edgeNoise));
                        // Quantize to create steps
                        finalBlendFactor = finalBlendFactor > 0.5 ? 1 : 0;
                        break;

                    case BLEND_MODES.DITHER:
                        // Dithered transition using ordered dithering
                        const ditherMatrix = [
                            [0, 8, 2, 10],
                            [12, 4, 14, 6],
                            [3, 11, 1, 9],
                            [15, 7, 13, 5]
                        ];
                        const threshold = ditherMatrix[y % 4][x % 4] / 16;
                        finalBlendFactor = blendFactor > threshold ? 1 : 0;
                        break;

                    default:
                        break;
                }

                // Blend the colors
                result.data[i] = Math.round(dataA[i] * (1 - finalBlendFactor) + dataB[i] * finalBlendFactor);
                result.data[i + 1] = Math.round(dataA[i + 1] * (1 - finalBlendFactor) + dataB[i + 1] * finalBlendFactor);
                result.data[i + 2] = Math.round(dataA[i + 2] * (1 - finalBlendFactor) + dataB[i + 2] * finalBlendFactor);
                result.data[i + 3] = Math.round(dataA[i + 3] * (1 - finalBlendFactor) + dataB[i + 3] * finalBlendFactor);
            }
        }

        return result;
    }, [textureAData, textureBData, direction, blendMode, blendStrength]);

    // Update preview when parameters change
    useEffect(() => {
        if (textureAData && textureBData && previewCanvasRef.current) {
            const result = blendTextures();
            if (result) {
                setBlendedResult(result);
                const ctx = previewCanvasRef.current.getContext("2d");
                ctx.putImageData(result, 0, 0);
            }
        }
    }, [textureAData, textureBData, blendTextures]);

    // Handle edit
    const handleEdit = () => {
        if (blendedResult && previewCanvasRef.current) {
            const dataUrl = previewCanvasRef.current.toDataURL();
            onEditTexture(dataUrl, textureName.trim() || "blended-texture");
        }
    };

    // Handle save directly
    const handleSave = () => {
        if (blendedResult && previewCanvasRef.current && textureName.trim()) {
            const dataUrl = previewCanvasRef.current.toDataURL();
            onSaveDirectly(dataUrl, textureName.trim());
        }
    };

    // Render texture selector
    if (selectingFor) {
        return (
            <div className="flex flex-col p-6 w-[550px] max-h-[80vh]">
                {/* Header */}
                <div className="flex items-center mb-4">
                    <button
                        onClick={() => { setSelectingFor(null); setSearchTerm(""); }}
                        className="flex items-center gap-2 text-white/50 hover:text-white transition-colors"
                    >
                        <FaArrowLeft size={14} />
                        <span className="text-sm">Back</span>
                    </button>
                    <h2 className="flex-1 text-center text-lg font-bold text-white">
                        Select Texture {selectingFor}
                    </h2>
                    <div className="w-16" />
                </div>

                {/* Search */}
                <div className="relative mb-3">
                    <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={14} />
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search blocks..."
                        className="w-full bg-white/5 border border-white/10 rounded-lg py-2 pl-9 pr-4 text-white text-sm placeholder:text-white/40 focus:outline-none focus:border-blue-500/50"
                        onKeyDown={(e) => e.stopPropagation()}
                        autoFocus
                    />
                </div>

                {/* Grid */}
                <div className="flex-1 overflow-y-auto min-h-0 mb-4">
                    <div className="grid grid-cols-8 gap-1.5">
                        {filteredBlocks.map((block) => (
                            <button
                                key={block.id}
                                onClick={() => handleSelectTexture(block)}
                                className="relative aspect-square rounded-lg border-2 border-white/10 bg-white/5 hover:border-white/30 transition-all hover:scale-105 flex items-center justify-center overflow-hidden"
                                title={block.name}
                            >
                                {loadedTextures[block.id] ? (
                                    <img
                                        src={loadedTextures[block.id]}
                                        alt={block.name}
                                        className="w-full h-full object-contain"
                                        style={{ imageRendering: "pixelated" }}
                                    />
                                ) : loadedTextures[block.id] === null ? (
                                    <div className="w-full h-full bg-red-900/30 flex items-center justify-center text-red-400 text-xs">?</div>
                                ) : (
                                    <div className="w-5 h-5 bg-white/10 rounded animate-pulse" />
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // Main blend interface
    return (
        <div className="flex flex-col p-6 w-[500px]">
            {/* Header */}
            <div className="flex items-center mb-5">
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 text-white/50 hover:text-white transition-colors"
                >
                    <FaArrowLeft size={14} />
                    <span className="text-sm">Back</span>
                </button>
                <h2 className="flex-1 text-center text-xl font-bold text-white flex items-center justify-center gap-2">
                    <FaExchangeAlt className="text-orange-400" />
                    Blend Textures
                </h2>
                <button
                    onClick={onClose}
                    className="text-white/50 hover:text-white transition-colors w-10 h-10 flex items-center justify-center"
                >
                    ✕
                </button>
            </div>

            {/* Texture Selection */}
            <div className="flex items-center gap-3 mb-5">
                {/* Texture A */}
                <div className="flex-1">
                    <label className="text-xs text-white/50 mb-1.5 block">Texture A</label>
                    <button
                        onClick={() => setSelectingFor("A")}
                        className={`w-full aspect-square rounded-xl border-2 transition-all flex items-center justify-center overflow-hidden ${
                            textureA 
                                ? "border-white/20 bg-black/30" 
                                : "border-dashed border-white/20 bg-white/5 hover:bg-white/10 hover:border-white/30"
                        }`}
                    >
                        {textureA && loadedTextures[textureA.id] ? (
                            <img
                                src={loadedTextures[textureA.id]}
                                alt={textureA.name}
                                className="w-full h-full object-contain"
                                style={{ imageRendering: "pixelated" }}
                            />
                        ) : (
                            <span className="text-white/30 text-sm">Select</span>
                        )}
                    </button>
                    {textureA && (
                        <div className="text-xs text-white/50 mt-1 text-center truncate">
                            {textureA.name}
                        </div>
                    )}
                </div>

                {/* Swap button */}
                <button
                    onClick={handleSwapTextures}
                    disabled={!textureA || !textureB}
                    className="p-2 rounded-lg bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed mt-4"
                    title="Swap textures"
                >
                    <FaExchangeAlt size={14} />
                </button>

                {/* Texture B */}
                <div className="flex-1">
                    <label className="text-xs text-white/50 mb-1.5 block">Texture B</label>
                    <button
                        onClick={() => setSelectingFor("B")}
                        className={`w-full aspect-square rounded-xl border-2 transition-all flex items-center justify-center overflow-hidden ${
                            textureB 
                                ? "border-white/20 bg-black/30" 
                                : "border-dashed border-white/20 bg-white/5 hover:bg-white/10 hover:border-white/30"
                        }`}
                    >
                        {textureB && loadedTextures[textureB.id] ? (
                            <img
                                src={loadedTextures[textureB.id]}
                                alt={textureB.name}
                                className="w-full h-full object-contain"
                                style={{ imageRendering: "pixelated" }}
                            />
                        ) : (
                            <span className="text-white/30 text-sm">Select</span>
                        )}
                    </button>
                    {textureB && (
                        <div className="text-xs text-white/50 mt-1 text-center truncate">
                            {textureB.name}
                        </div>
                    )}
                </div>
            </div>

            {/* Blend Controls */}
            {textureA && textureB && (
                <>
                    {/* Preview */}
                    <div className="flex justify-center mb-4">
                        <div className="relative">
                            <canvas
                                ref={previewCanvasRef}
                                width={GRID_SIZE}
                                height={GRID_SIZE}
                                className="w-32 h-32 rounded-xl border-2 border-white/20"
                                style={{ imageRendering: "pixelated" }}
                            />
                            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-xs text-white/40 bg-black/50 px-2 py-0.5 rounded">
                                Preview
                            </div>
                        </div>
                    </div>

                    {/* Blend Mode */}
                    <div className="mb-4">
                        <label className="text-xs text-white/50 mb-2 block">Blend Mode</label>
                        <div className="grid grid-cols-3 gap-2">
                            {[
                                { value: BLEND_MODES.GRADIENT, label: "Gradient", desc: "Smooth transition" },
                                { value: BLEND_MODES.STEPPED, label: "Stepped", desc: "Hard edge with noise" },
                                { value: BLEND_MODES.DITHER, label: "Dither", desc: "Pixelated pattern" },
                            ].map((mode) => (
                                <button
                                    key={mode.value}
                                    onClick={() => setBlendMode(mode.value)}
                                    className={`py-2 px-3 rounded-lg border text-xs transition-all ${
                                        blendMode === mode.value
                                            ? "bg-orange-500/20 border-orange-500/50 text-orange-300"
                                            : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                                    }`}
                                >
                                    {mode.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Direction */}
                    <div className="mb-4">
                        <label className="text-xs text-white/50 mb-2 block">Direction</label>
                        <div className="flex gap-2 justify-center">
                            {Object.entries(DIRECTIONS).map(([key, value]) => {
                                const Icon = DIRECTION_ICONS[value];
                                return (
                                    <button
                                        key={key}
                                        onClick={() => setDirection(value)}
                                        className={`p-3 rounded-lg border transition-all ${
                                            direction === value
                                                ? "bg-blue-500/20 border-blue-500/50 text-blue-300"
                                                : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10"
                                        }`}
                                        title={key.replace(/_/g, " ")}
                                    >
                                        <Icon size={16} />
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Blend Strength */}
                    <div className="mb-5">
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs text-white/50">Transition Width</label>
                            <span className="text-xs text-white/40">{blendStrength}%</span>
                        </div>
                        <div 
                            className="relative h-2 rounded-full overflow-hidden"
                            style={{ background: "linear-gradient(to right, #333, #888)" }}
                        >
                            <input
                                type="range"
                                min="10"
                                max="100"
                                value={blendStrength}
                                onChange={(e) => setBlendStrength(parseInt(e.target.value))}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
                            <div
                                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg border-2 border-gray-600 pointer-events-none"
                                style={{ left: `calc(${((blendStrength - 10) / 90) * 100}% - 8px)` }}
                            />
                        </div>
                    </div>

                    {/* Name Input */}
                    <div className="mb-4">
                        <label className="text-xs text-white/50 mb-1.5 block">Texture Name</label>
                        <input
                            type="text"
                            value={textureName}
                            onChange={(e) => setTextureName(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                            placeholder="e.g., grass-to-sand"
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50"
                        />
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                        <button
                            onClick={handleEdit}
                            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 hover:border-blue-500/60 text-blue-300 text-sm rounded-lg transition-all"
                        >
                            <FaPencilAlt size={12} />
                            Edit This
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={!textureName.trim()}
                            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 hover:border-emerald-500/60 text-emerald-300 text-sm rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <FaSave size={12} />
                            Save & Use
                        </button>
                    </div>
                </>
            )}

            {/* Instructions when textures not selected */}
            {(!textureA || !textureB) && (
                <div className="text-center text-white/40 text-sm py-8">
                    Select two textures to blend them together
                </div>
            )}
        </div>
    );
};

TextureBlendScreen.propTypes = {
    onBack: PropTypes.func.isRequired,
    onEditTexture: PropTypes.func.isRequired,
    onSaveDirectly: PropTypes.func.isRequired,
    onClose: PropTypes.func.isRequired,
};

export default TextureBlendScreen;

