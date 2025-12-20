import React, { useState, useMemo, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { getBlockTypes } from "../managers/BlockTypesManager";
import { FaSearch, FaTimes, FaCube } from "react-icons/fa";

/**
 * BaseTexturePicker - Allows selecting an existing block texture as a base
 * Supports both single-texture and multi-texture blocks
 */
const BaseTexturePicker = ({ onSelectTexture, onClose }) => {
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedBlock, setSelectedBlock] = useState(null);
    const [loadedTextures, setLoadedTextures] = useState({});
    const containerRef = useRef(null);

    // Helper to convert relative paths to absolute URLs (same as BlockButton)
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

    // Get the correct texture URL for a block (handles multi-texture and custom blocks)
    const getBlockTextureUrl = (block) => {
        if (!block.textureUri || block.textureUri.includes("error.png")) {
            return toAbsoluteUrl("./assets/blocks/error.png");
        }
        
        // For multi-texture blocks, prefer +y (top) face
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

    // Filter blocks based on search term - show ALL blocks by default
    const filteredBlocks = useMemo(() => {
        if (!searchTerm.trim()) return blockTypes; // Show all blocks by default
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
                    // Create a small canvas for the preview
                    const canvas = document.createElement("canvas");
                    canvas.width = 24;
                    canvas.height = 24;
                    const ctx = canvas.getContext("2d");
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(img, 0, 0, 24, 24);
                    const dataUrl = canvas.toDataURL();
                    setLoadedTextures((prev) => ({
                        ...prev,
                        [block.id]: dataUrl,
                    }));
                    resolve(dataUrl);
                };
                img.onerror = () => {
                    // On error, set to null so we don't keep retrying
                    setLoadedTextures((prev) => ({
                        ...prev,
                        [block.id]: null,
                    }));
                    resolve(null);
                };

                // Use the helper function to get the correct texture URL
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
            // Multi-texture block
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
                    // Use the helper for proper URL conversion
                    img.src = toAbsoluteUrl(uri);
                });
            }
        } else if (block.textureUri) {
            // Single texture block - apply to all faces
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

                    // Apply single texture to all faces
                    ["all", "top", "bottom", "left", "right", "front", "back"].forEach(
                        (face) => {
                            faceTextures[face] = dataUrl;
                        }
                    );
                    resolve();
                };
                img.onerror = () => resolve();
                // Use the helper for proper URL conversion
                img.src = toAbsoluteUrl(block.textureUri);
            });
        }

        return faceTextures;
    };

    // Handle block selection
    const handleSelectBlock = async (block) => {
        setSelectedBlock(block);
    };

    // Apply the selected texture
    const handleApplyTexture = async () => {
        if (!selectedBlock) return;

        const faceTextures = await loadAllFaceTextures(selectedBlock);
        onSelectTexture(faceTextures, selectedBlock.isMultiTexture);
        onClose();
    };

    // Load texture previews for visible blocks (lazy loading)
    useEffect(() => {
        // Only load textures that haven't been attempted yet
        const blocksToLoad = filteredBlocks.filter(
            (block) => loadedTextures[block.id] === undefined
        );
        
        // Load in batches to avoid overwhelming the browser
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

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[1100]">
            <div
                ref={containerRef}
                className="bg-[#1a1a1a] border border-white/10 rounded-xl p-4 max-w-2xl w-full max-h-[80vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-white text-lg font-semibold flex items-center gap-2">
                        <FaCube className="text-blue-400" />
                        Select Base Texture
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-white/60 hover:text-white transition-colors p-1"
                    >
                        <FaTimes size={18} />
                    </button>
                </div>

                {/* Search */}
                <div className="relative mb-3">
                    <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search blocks by name or ID..."
                        className="w-full bg-white/5 border border-white/10 rounded-lg py-2 pl-10 pr-4 text-white placeholder:text-white/40 focus:outline-none focus:border-blue-500/50"
                        onKeyDown={(e) => e.stopPropagation()}
                        autoFocus
                    />
                </div>
                
                {/* Results count */}
                <div className="text-xs text-white/40 mb-2">
                    {searchTerm.trim() 
                        ? `Found ${filteredBlocks.length} block${filteredBlocks.length !== 1 ? 's' : ''}`
                        : `${filteredBlocks.length} blocks available`
                    }
                </div>

                {/* Block Grid */}
                <div className="flex-1 overflow-y-auto mb-4 pr-1" style={{ scrollbarGutter: 'stable' }}>
                    {/* Default blocks section */}
                    {filteredBlocks.some(b => b.id < 1000) && (
                        <div className="text-xs text-white/50 mb-2 font-medium">Default Blocks</div>
                    )}
                    <div className="grid grid-cols-6 gap-2 mb-3">
                        {filteredBlocks.filter(b => b.id < 1000).map((block) => (
                            <button
                                key={block.id}
                                onClick={() => handleSelectBlock(block)}
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
                                        style={{
                                            imageRendering: "pixelated",
                                        }}
                                    />
                                ) : loadedTextures[block.id] === null ? (
                                    <div className="w-full h-full bg-red-900/30 flex items-center justify-center text-red-400 text-xs">
                                        ?
                                    </div>
                                ) : (
                                    <div className="w-8 h-8 bg-white/10 rounded animate-pulse" />
                                )}
                                {block.isMultiTexture && (
                                    <div className="absolute top-1 right-1 w-2 h-2 bg-yellow-400 rounded-full" title="Multi-texture block" />
                                )}
                            </button>
                        ))}
                    </div>
                    
                    {/* Custom blocks section */}
                    {filteredBlocks.some(b => b.id >= 1000) && (
                        <div className="text-xs text-white/50 mb-2 font-medium">Custom Blocks</div>
                    )}
                    <div className="grid grid-cols-6 gap-2">
                        {filteredBlocks.filter(b => b.id >= 1000).map((block) => (
                            <button
                                key={block.id}
                                onClick={() => handleSelectBlock(block)}
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
                                        style={{
                                            imageRendering: "pixelated",
                                        }}
                                    />
                                ) : loadedTextures[block.id] === null ? (
                                    // Failed to load - show error indicator
                                    <div className="w-full h-full bg-red-900/30 flex items-center justify-center text-red-400 text-xs">
                                        ?
                                    </div>
                                ) : (
                                    // Still loading
                                    <div className="w-8 h-8 bg-white/10 rounded animate-pulse" />
                                )}
                                {block.isMultiTexture && (
                                    <div className="absolute top-1 right-1 w-2 h-2 bg-yellow-400 rounded-full" title="Multi-texture block" />
                                )}
                            </button>
                        ))}
                    </div>
                    {filteredBlocks.length === 0 && (
                        <div className="text-center text-white/40 py-8">
                            No blocks found matching "{searchTerm}"
                        </div>
                    )}
                </div>

                {/* Selected Block Info */}
                {selectedBlock && (
                    <div className="bg-white/5 rounded-lg p-3 mb-4 border border-white/10">
                        <div className="flex items-center gap-3">
                            {loadedTextures[selectedBlock.id] && (
                                <img
                                    src={loadedTextures[selectedBlock.id]}
                                    alt={selectedBlock.name}
                                    className="w-12 h-12 rounded"
                                    style={{ imageRendering: "pixelated" }}
                                />
                            )}
                            <div>
                                <div className="text-white font-medium">
                                    {selectedBlock.name}
                                </div>
                                <div className="text-white/50 text-sm">
                                    ID: {selectedBlock.id}
                                    {selectedBlock.isMultiTexture && (
                                        <span className="ml-2 text-yellow-400">
                                            • Multi-face texture
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg border border-white/10 text-white/70 hover:bg-white/5 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleApplyTexture}
                        disabled={!selectedBlock}
                        className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Use as Base
                    </button>
                </div>
            </div>
        </div>
    );
};

BaseTexturePicker.propTypes = {
    onSelectTexture: PropTypes.func.isRequired,
    onClose: PropTypes.func.isRequired,
};

export default BaseTexturePicker;

