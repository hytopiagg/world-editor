import { useState, useEffect, useMemo, useCallback } from "react";
import { FaSave, FaCog, FaDownload, FaTrash } from "react-icons/fa";
import BlockPreview3D from "./BlockPreview3D";
import * as THREE from 'three';

const FACE_ORDER = ["right", "left", "top", "bottom", "front", "back"];

interface BlockOptionsSectionProps {
    selectedBlock: any;
    onUpdateBlockName: (id: number, name: string) => Promise<void>;
    onDownloadBlock: (block: any) => void;
    onDeleteBlock: (block: any) => void;
    isCompactMode: boolean;
}

export default function BlockOptionsSection({ selectedBlock, onUpdateBlockName, onDownloadBlock, onDeleteBlock, isCompactMode }: BlockOptionsSectionProps) {
    const [editableName, setEditableName] = useState(selectedBlock?.name || '');
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const textureObjects = useBlockTextures(selectedBlock);

    useEffect(() => {
        setEditableName(selectedBlock?.name || '');
        setIsEditing(false); // Reset editing state when block changes
    }, [selectedBlock]);

    const handleNameChange = (event) => {
        setEditableName(event.target.value);
    };

    const handleSaveName = async () => {
        if (!selectedBlock || !selectedBlock.isCustom || isSaving) return;
        const trimmedName = editableName.trim();
        if (trimmedName && trimmedName !== selectedBlock.name) {
            setIsSaving(true);
            try {
                await onUpdateBlockName(selectedBlock.id, trimmedName);
                // Optional: Update local state if parent doesn't force re-render with new selectedBlock
                // selectedBlock.name = trimmedName; // Be cautious modifying props directly
                setIsEditing(false);
            } catch (error) {
                console.error("Failed to update block name:", error);
                // Handle error display if needed
            } finally {
                setIsSaving(false);
            }
        } else {
            setIsEditing(false); // Cancel edit if name is empty or unchanged
            setEditableName(selectedBlock.name); // Reset to original name if cancelled
        }
    };

    const handleKeyDown = (event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
            handleSaveName();
        } else if (event.key === 'Escape') {
            setIsEditing(false);
            setEditableName(selectedBlock.name); // Reset on escape
        }
    };

    const handleDownload = () => {
        onDownloadBlock(selectedBlock);
    };

    const handleDelete = () => {
        onDeleteBlock(selectedBlock);
    };

    if (!selectedBlock) return null;

    return (
        <div className="flex flex-col gap-3">
            <div className="block-preview-container w-full bg-black/20 rounded-md overflow-hidden relative opacity-0 duration-150 fade-down"
                onWheel={(e) => e.stopPropagation()}
                style={{
                    height: isCompactMode ? "10rem" : "12rem",
                    animationDelay: "0.05s"
                }}
            >
                {Object.keys(textureObjects).length > 0 ? (
                    <BlockPreview3D textureObjects={textureObjects} target={[0, -0.3, 0]} showControls={false} />
                ) : (
                    <div className="flex items-center justify-center h-full text-xs text-white/50">Loading Preview...</div>
                )}
            </div>
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <label className="text-xs text-[#F1F1F1]/80 w-10">ID:</label>
                    <input
                        type="text"
                        onKeyDown={(e) => e.stopPropagation()}
                        value={selectedBlock.id}
                        disabled
                        className="flex-grow px-2 py-1 text-xs bg-black/20 border border-white/10 rounded-md text-[#F1F1F1]/70"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-xs text-[#F1F1F1]/80 w-10">Name:</label>
                    {selectedBlock.isCustom && isEditing ? (
                        <input
                            type="text"
                            value={editableName}
                            onChange={handleNameChange}
                            onBlur={handleSaveName} // Save on blur
                            onKeyDown={handleKeyDown} // Save on Enter, Cancel on Escape
                            disabled={isSaving}
                            autoFocus
                            className="flex-grow px-2 py-1 text-xs bg-white/10 border border-white/30 rounded-md text-[#F1F1F1] focus:outline-none focus:ring-1 focus:ring-blue-500"
                            style={{
                                width: 'calc(100% - 8px)',
                            }}
                        />
                    ) : (
                        <input
                            type="text"
                            value={selectedBlock.name}
                            disabled
                            onKeyDown={(e) => e.stopPropagation()}
                            onClick={() => selectedBlock.isCustom && setIsEditing(true)} // Enable editing on click for custom blocks
                            className={`flex-grow px-2 py-1 text-xs bg-black/20 border border-white/10 rounded-md ${selectedBlock.isCustom ? 'text-[#F1F1F1] cursor-text hover:bg-black/30' : 'text-[#F1F1F1]/70'}`}
                            style={{
                                width: 'calc(100% - 8px)',
                            }}
                        />
                    )}
                    {selectedBlock.isCustom && (
                        isEditing ? (
                            <button
                                onClick={handleSaveName}
                                disabled={isSaving || !editableName.trim() || editableName.trim() === selectedBlock.name}
                                className="p-1.5 text-xs border border-white/10 hover:bg-white/20 rounded-md disabled:opacity-50"
                                title="Save Name"
                            >
                                {isSaving ? <div className="spinner" /> : <FaSave />} {/* Add spinner CSS */}
                            </button>
                        ) : (
                            <button
                                onClick={() => setIsEditing(true)}
                                className="p-1.5 text-xs border border-white/10 hover:bg-white/20 rounded-md"
                                title="Edit Name"
                            >
                                <FaCog />
                            </button>
                        )
                    )}
                </div>
                <div className="flex items-center justify-end gap-2 mt-2">
                    <button
                        onClick={handleDownload}
                        className={`flex items-center gap-1 px-2 py-1 text-xs rounded-lg transition-all hover:scale-[1.02] active:translate-y-0.5 hover:bg-white bg-white/90 text-[#0d0d0d] disabled:bg-gray-600/50 disabled:text-white/50 disabled:border-gray-500/30 disabled:cursor-not-allowed cursor-pointer`}
                        title={selectedBlock.textureUri ? "Download Block Textures" : "No textures available for download"}
                        disabled={!selectedBlock.textureUri}
                    >
                        <FaDownload /> Download
                    </button>
                    {selectedBlock.isCustom && (
                        <button onClick={handleDelete} className="flex items-center gap-1 px-2 py-1 text-xs hover:scale-[1.02] bg-[#0D0D0D]/80 active:translate-y-0.5 hover:bg-[#0D0D0D]/90 text-white rounded-lg  transition-all cursor-pointer" title="Delete Custom Block">
                            <FaTrash /> Delete
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

const useBlockTextures = (selectedBlock) => {
    const [textureObjects, setTextureObjects] = useState({});
    const textureCache = useMemo(() => new Map(), []); // Cache THREE.Texture objects

    const loadTexture = useCallback((url) => {
        if (!url) return Promise.resolve(null);

        if (textureCache.has(url)) {
            return Promise.resolve(textureCache.get(url));
        }

        return new Promise((resolve) => {
            if (url.startsWith('data:image')) {
                const img = new Image();
                img.onload = () => {
                    const texture = new THREE.CanvasTexture(img);
                    texture.magFilter = THREE.NearestFilter;
                    texture.minFilter = THREE.NearestFilter;
                    texture.needsUpdate = true;
                    textureCache.set(url, texture);
                    resolve(texture);
                };
                img.onerror = () => resolve(null); // Handle loading errors
                img.src = url;
            } else {
                // Assume it's a path/URL loadable by TextureLoader
                const loader = new THREE.TextureLoader();
                loader.load(
                    url,
                    (texture) => {
                        texture.magFilter = THREE.NearestFilter;
                        texture.minFilter = THREE.NearestFilter;
                        textureCache.set(url, texture);
                        resolve(texture);
                    },
                    undefined, // onProgress callback (optional)
                    () => resolve(null) // onError callback
                );
            }
        });
    }, [textureCache]);

    useEffect(() => {
        if (!selectedBlock || selectedBlock.isEnvironment) {
            // Clear textures if no block selected or if it's an environment model
            Object.values(textureObjects).forEach((tex: any) => tex?.dispose());
            setTextureObjects({});
            return;
        }

        let isMounted = true;
        const newTextureObjects = {};

        const loadFaces = async () => {
            const baseTextureUrl = selectedBlock.textureUri;
            const sideTextures = selectedBlock.sideTextures || {};

            // Load base texture first (fallback)
            const baseTexture = await loadTexture(baseTextureUrl);
            if (baseTexture) {
                newTextureObjects['all'] = baseTexture; // Used by BlockPreview3D as fallback
            }


            for (const face of FACE_ORDER) {
                // Default to base texture URL if specific face texture doesn't exist
                const faceTextureUrl = sideTextures[face === 'right' ? '+x' : face === 'left' ? '-x' : face === 'top' ? '+y' : face === 'bottom' ? '-y' : face === 'front' ? '+z' : '-z'] || baseTextureUrl;
                const texture = await loadTexture(faceTextureUrl);
                if (texture) {
                    newTextureObjects[face] = texture;
                } else if (baseTexture) {
                    // Fallback to base texture if face texture failed to load but base exists
                    newTextureObjects[face] = baseTexture;
                }
            }


            if (isMounted) {
                // Dispose old textures before setting new ones
                Object.values(textureObjects).forEach((tex: any) => {
                    // Only dispose if it's not reused in the new set
                    if (!Object.values(newTextureObjects).includes(tex)) {
                        tex?.dispose();
                    }
                });
                setTextureObjects(newTextureObjects);
            }
        };

        loadFaces();

        return () => {
            isMounted = false;
            // Dispose textures on unmount *only if* they are not in the cache for reuse later
            // This logic might be simplified depending on how often blocks change vs component remounts
            Object.values(newTextureObjects).forEach((tex: any) => {
                // A more robust caching strategy might be needed if textures are frequently reused across renders
                // For now, let's assume disposal is okay unless it's clearly cached
                if (tex && !Array.from(textureCache.values()).includes(tex)) {
                    // tex.dispose(); // Careful with disposing cached textures
                }
            });
        };
    }, [selectedBlock, loadTexture]); // Rerun when block changes

    // Cleanup cache on component unmount
    useEffect(() => {
        return () => {
            textureCache.forEach(texture => texture.dispose());
            textureCache.clear();
        };
    }, [textureCache]);


    return textureObjects;
};