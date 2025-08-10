import React, { useState, useEffect, useMemo } from "react";
import { getBlockTypes } from "../TerrainBuilder";
import {
    DEFAULT_BLOCK_MAPPINGS,
    suggestMapping,
} from "../utils/minecraft/BlockMapper";
import "../../css/AxiomBlockRemapper.css";

export const AxiomBlockRemapper = ({
    unmappedBlocks,
    onConfirmMappings,
    onCancel,
    blockCounts = {},
}) => {
    const [mappings, setMappings] = useState({});
    const [searchTerms, setSearchTerms] = useState({});
    const availableBlocks = useMemo(() => getBlockTypes() || [], []);

    useEffect(() => {
        // Initialize mappings with suggestions
        const initialMappings = {};
        unmappedBlocks.forEach((blockName) => {
            const suggestion = suggestMapping(blockName);
            if (suggestion && suggestion.action === "map" && suggestion.id) {
                initialMappings[blockName] = {
                    action: "map",
                    targetBlockId: suggestion.id,
                    targetBlockName: suggestion.name || "Unknown",
                };
            } else {
                initialMappings[blockName] = {
                    action: "skip",
                    targetBlockId: null,
                    targetBlockName: null,
                };
            }
        });
        setMappings(initialMappings);
    }, [unmappedBlocks]);

    const handleActionChange = (blockName, action) => {
        setMappings((prev) => ({
            ...prev,
            [blockName]: {
                ...prev[blockName],
                action,
                targetBlockId:
                    action === "skip"
                        ? null
                        : prev[blockName]?.targetBlockId ||
                          availableBlocks[0]?.id,
                targetBlockName:
                    action === "skip"
                        ? null
                        : prev[blockName]?.targetBlockName ||
                          availableBlocks[0]?.name,
            },
        }));
    };

    const handleBlockSelection = (blockName, targetBlock) => {
        setMappings((prev) => ({
            ...prev,
            [blockName]: {
                action: "map",
                targetBlockId: targetBlock.id,
                targetBlockName: targetBlock.name,
            },
        }));
    };

    const handleSearchChange = (blockName, searchTerm) => {
        setSearchTerms((prev) => ({
            ...prev,
            [blockName]: searchTerm,
        }));
    };

    const getFilteredBlocks = (blockName) => {
        const searchTerm = searchTerms[blockName] || "";
        if (!searchTerm) return availableBlocks;

        const lowerSearch = searchTerm.toLowerCase();
        return availableBlocks.filter((block) =>
            block.name.toLowerCase().includes(lowerSearch)
        );
    };

    const handleConfirm = () => {
        // Convert to the format expected by the parser
        const finalMappings = {};
        Object.entries(mappings).forEach(([blockName, mapping]) => {
            if (mapping.action === "map" && mapping.targetBlockId) {
                finalMappings[blockName] = {
                    id: mapping.targetBlockId,
                    name: mapping.targetBlockName,
                    action: "map",
                };
            } else {
                finalMappings[blockName] = { action: "skip" };
            }
        });
        onConfirmMappings(finalMappings);
    };

    const mappedCount = Object.values(mappings).filter(
        (m) => m.action === "map"
    ).length;
    const totalCount = unmappedBlocks.length;

    return (
        <div className="axiom-remapper-overlay">
            <div className="axiom-remapper-modal">
                <div className="axiom-remapper-header">
                    <h2>Remap Minecraft Blocks</h2>
                    <p className="axiom-remapper-subtitle">
                        Found {totalCount} unique block types that need mapping
                    </p>
                </div>

                <div className="axiom-remapper-progress">
                    <div className="progress-bar">
                        <div
                            className="progress-fill"
                            style={{
                                width: `${(mappedCount / totalCount) * 100}%`,
                            }}
                        />
                    </div>
                    <span className="progress-text">
                        {mappedCount} / {totalCount} blocks mapped
                    </span>
                </div>

                <div className="axiom-remapper-list">
                    {unmappedBlocks.map((blockName) => {
                        const mapping = mappings[blockName] || {};
                        const count = blockCounts[blockName] || 0;
                        const filteredBlocks = getFilteredBlocks(blockName);
                        const cleanName = blockName
                            .replace("minecraft:", "")
                            .replace(/_/g, " ")
                            .replace(/\b\w/g, (l) => l.toUpperCase());

                        return (
                            <div
                                key={blockName}
                                className="axiom-remapper-item"
                            >
                                <div className="remapper-item-header">
                                    <div className="source-block">
                                        <span className="block-name">
                                            {cleanName}
                                        </span>
                                        <span className="block-count">
                                            ({count} blocks)
                                        </span>
                                    </div>
                                    <div className="action-selector">
                                        <label>
                                            <input
                                                type="radio"
                                                name={`action-${blockName}`}
                                                checked={
                                                    mapping.action === "map"
                                                }
                                                onChange={() =>
                                                    handleActionChange(
                                                        blockName,
                                                        "map"
                                                    )
                                                }
                                            />
                                            Map to
                                        </label>
                                        <label>
                                            <input
                                                type="radio"
                                                name={`action-${blockName}`}
                                                checked={
                                                    mapping.action === "skip"
                                                }
                                                onChange={() =>
                                                    handleActionChange(
                                                        blockName,
                                                        "skip"
                                                    )
                                                }
                                            />
                                            Skip
                                        </label>
                                    </div>
                                </div>

                                {mapping.action === "map" && (
                                    <div className="remapper-item-content">
                                        <input
                                            type="text"
                                            className="block-search"
                                            placeholder="Search blocks..."
                                            value={searchTerms[blockName] || ""}
                                            onChange={(e) =>
                                                handleSearchChange(
                                                    blockName,
                                                    e.target.value
                                                )
                                            }
                                        />
                                        <div className="block-options">
                                            {filteredBlocks
                                                .slice(0, 5)
                                                .map((block) => (
                                                    <button
                                                        key={block.id}
                                                        className={`block-option ${
                                                            mapping.targetBlockId ===
                                                            block.id
                                                                ? "selected"
                                                                : ""
                                                        }`}
                                                        onClick={() =>
                                                            handleBlockSelection(
                                                                blockName,
                                                                block
                                                            )
                                                        }
                                                    >
                                                        {block.textureUri && (
                                                            <img
                                                                src={`/assets/${block.textureUri}`}
                                                                alt={block.name}
                                                                className="block-preview"
                                                                onError={(
                                                                    e
                                                                ) => {
                                                                    e.target.style.display =
                                                                        "none";
                                                                }}
                                                            />
                                                        )}
                                                        <span>
                                                            {block.name}
                                                        </span>
                                                    </button>
                                                ))}
                                            {filteredBlocks.length > 5 && (
                                                <div className="more-options">
                                                    +{filteredBlocks.length - 5}{" "}
                                                    more options
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="axiom-remapper-actions">
                    <button className="btn-cancel" onClick={onCancel}>
                        Cancel
                    </button>
                    <button className="btn-confirm" onClick={handleConfirm}>
                        Import with Mappings
                    </button>
                </div>
            </div>
        </div>
    );
};
