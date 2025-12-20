import React, { useState, useMemo, useEffect } from "react";
import PropTypes from "prop-types";
import { getBlockTypes } from "../managers/BlockTypesManager";
import { FaSearch, FaCube, FaArrowLeft } from "react-icons/fa";

/**
 * TexturePickerScreen - Inline screen for selecting an existing block texture as a base
 * Replaces the modal-based BaseTexturePicker
 */
const TexturePickerScreen = ({ onSelectTexture, onBack, onClose }) => {
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedBlock, setSelectedBlock] = useState(null);
    const [loadedTextures, setLoadedTextures] = useState({});

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

    // Get the correct texture URL for a block
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

    // Get all available block types
    const blockTypes = useMemo(() => {
        try {
            return getBlockTypes() || [];
        } catch (_) {
            return [];
        }
    }, []);

    // Filter blocks based on search term
    const filteredBlocks = useMemo(() => {
        if (!searchTerm.trim()) return blockTypes;
        const lower = searchTerm.toLowerCase();
        return blockTypes.filter(
            (block) =>
                block.name.toLowerCase().includes(lower) ||
                String(block.id).includes(lower)
        );
    }, [blockTypes, searchTerm]);

    // Load texture preview for a block
    const loadTexturePreview = async (block) => {
        if (loadedTextures[block.id]) return loadedTextures[block.id];

        try {
            const img = new Image();
            img.crossOrigin = "anonymous";

            return new Promise((resolve) => {
                img.onload = () => {
                    const canvas = document.createElement("canvas");
                    canvas.width = 24;
                    canvas.height = 24;
                    const ctx = canvas.getContext("2d");
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(img, 0, 0, 24, 24);
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
            console.error("Error loading texture preview:", error);
            return null;
        }
    };

    // Load all face textures for a multi-texture block
    const loadAllFaceTextures = async (block) => {
        const COORD_TO_FACE = {
            "+x": "right",
            "-x": "left",
            "+y": "top",
            "-y": "bottom",
            "+z": "front",
            "-z": "back",
        };

        const faceTextures = {};

        if (block.isMultiTexture && block.sideTextures) {
            for (const [coord, uri] of Object.entries(block.sideTextures)) {
                const face = COORD_TO_FACE[coord] || coord;
                const img = new Image();
                img.crossOrigin = "anonymous";

                await new Promise((resolve) => {
                    img.onload = () => {
                        const canvas = document.createElement("canvas");
                        canvas.width = 24;
                        canvas.height = 24;
                        const ctx = canvas.getContext("2d");
                        ctx.imageSmoothingEnabled = false;
                        ctx.drawImage(img, 0, 0, 24, 24);
                        faceTextures[face] = canvas.toDataURL();
                        resolve();
                    };
                    img.onerror = () => resolve();
                    img.src = toAbsoluteUrl(uri);
                });
            }
        } else if (block.textureUri) {
            const img = new Image();
            img.crossOrigin = "anonymous";

            await new Promise((resolve) => {
                img.onload = () => {
                    const canvas = document.createElement("canvas");
                    canvas.width = 24;
                    canvas.height = 24;
                    const ctx = canvas.getContext("2d");
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(img, 0, 0, 24, 24);
                    const dataUrl = canvas.toDataURL();
                    ["all", "top", "bottom", "left", "right", "front", "back"].forEach(
                        (face) => {
                            faceTextures[face] = dataUrl;
                        }
                    );
                    resolve();
                };
                img.onerror = () => resolve();
                img.src = toAbsoluteUrl(block.textureUri);
            });
        }

        return faceTextures;
    };

    // Handle double-click to select and apply immediately
    const handleDoubleClick = async (block) => {
        const faceTextures = await loadAllFaceTextures(block);
        onSelectTexture(faceTextures, block.isMultiTexture, block.name);
    };

    // Apply the selected texture
    const handleApplyTexture = async () => {
        if (!selectedBlock) return;
        const faceTextures = await loadAllFaceTextures(selectedBlock);
        onSelectTexture(faceTextures, selectedBlock.isMultiTexture, selectedBlock.name);
    };

    // Load texture previews for visible blocks
    useEffect(() => {
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filteredBlocks]);

    const defaultBlocks = filteredBlocks.filter(b => b.id < 1000);
    const customBlocks = filteredBlocks.filter(b => b.id >= 1000);

    return (
        <div className="flex flex-col p-6 w-[600px] max-h-[80vh]">
            {/* Header */}
            <div className="flex items-center mb-4">
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 text-white/50 hover:text-white transition-colors"
                >
                    <FaArrowLeft size={14} />
                    <span className="text-sm">Back</span>
                </button>
                <h2 className="flex-1 text-center text-xl font-bold text-white flex items-center justify-center gap-2">
                    <FaCube className="text-blue-400" />
                    Select Base Texture
                </h2>
                <button
                    onClick={onClose}
                    className="text-white/50 hover:text-white transition-colors w-10 h-10 flex items-center justify-center"
                >
                    ✕
                </button>
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

            {/* Results count */}
            <div className="text-xs text-white/40 mb-3">
                {searchTerm.trim()
                    ? `Found ${filteredBlocks.length} block${filteredBlocks.length !== 1 ? 's' : ''}`
                    : `${filteredBlocks.length} blocks available`}
                <span className="text-white/30 ml-2">• Double-click to select</span>
            </div>

            {/* Block Grid */}
            <div className="flex-1 overflow-y-auto mb-4 pr-1 min-h-0" style={{ scrollbarGutter: 'stable' }}>
                {/* Default blocks */}
                {defaultBlocks.length > 0 && (
                    <>
                        <div className="text-xs text-white/50 mb-2 font-medium">Default Blocks</div>
                        <div className="grid grid-cols-8 gap-1.5 mb-4">
                            {defaultBlocks.map((block) => (
                                <button
                                    key={block.id}
                                    onClick={() => setSelectedBlock(block)}
                                    onDoubleClick={() => handleDoubleClick(block)}
                                    className={`relative aspect-square rounded-lg border-2 transition-all hover:scale-105 flex items-center justify-center overflow-hidden ${
                                        selectedBlock?.id === block.id
                                            ? "border-blue-500 bg-blue-500/20"
                                            : "border-white/10 bg-white/5 hover:border-white/30"
                                    }`}
                                    title={`${block.name} (ID: ${block.id})`}
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
                                        <div className="w-6 h-6 bg-white/10 rounded animate-pulse" />
                                    )}
                                    {block.isMultiTexture && (
                                        <div className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-yellow-400 rounded-full" />
                                    )}
                                </button>
                            ))}
                        </div>
                    </>
                )}

                {/* Custom blocks */}
                {customBlocks.length > 0 && (
                    <>
                        <div className="text-xs text-white/50 mb-2 font-medium">Custom Blocks</div>
                        <div className="grid grid-cols-8 gap-1.5">
                            {customBlocks.map((block) => (
                                <button
                                    key={block.id}
                                    onClick={() => setSelectedBlock(block)}
                                    onDoubleClick={() => handleDoubleClick(block)}
                                    className={`relative aspect-square rounded-lg border-2 transition-all hover:scale-105 flex items-center justify-center overflow-hidden ${
                                        selectedBlock?.id === block.id
                                            ? "border-blue-500 bg-blue-500/20"
                                            : "border-white/10 bg-white/5 hover:border-white/30"
                                    }`}
                                    title={`${block.name} (ID: ${block.id})`}
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
                                        <div className="w-6 h-6 bg-white/10 rounded animate-pulse" />
                                    )}
                                    {block.isMultiTexture && (
                                        <div className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-yellow-400 rounded-full" />
                                    )}
                                </button>
                            ))}
                        </div>
                    </>
                )}

                {filteredBlocks.length === 0 && (
                    <div className="text-center text-white/40 py-8">
                        No blocks found matching "{searchTerm}"
                    </div>
                )}
            </div>

            {/* Selected Block Info & Actions */}
            <div className="flex items-center justify-between gap-4 pt-3 border-t border-white/10">
                {selectedBlock ? (
                    <div className="flex items-center gap-3">
                        {loadedTextures[selectedBlock.id] && (
                            <img
                                src={loadedTextures[selectedBlock.id]}
                                alt={selectedBlock.name}
                                className="w-10 h-10 rounded border border-white/20"
                                style={{ imageRendering: "pixelated" }}
                            />
                        )}
                        <div>
                            <div className="text-white font-medium text-sm">{selectedBlock.name}</div>
                            <div className="text-white/40 text-xs">
                                {selectedBlock.isMultiTexture ? "Multi-face" : "Single texture"}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="text-white/40 text-sm">Select a texture to continue</div>
                )}

                <button
                    onClick={handleApplyTexture}
                    disabled={!selectedBlock}
                    className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    Use as Base
                </button>
            </div>
        </div>
    );
};

TexturePickerScreen.propTypes = {
    onSelectTexture: PropTypes.func.isRequired,
    onBack: PropTypes.func.isRequired,
    onClose: PropTypes.func.isRequired,
};

export default TexturePickerScreen;

