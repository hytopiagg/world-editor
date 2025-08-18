import React, { useState, useEffect, useMemo } from "react";
import { getBlockTypes } from "../TerrainBuilder";
import { environmentModels } from "../EnvironmentBuilder";
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
    const [modelSearchTerms, setModelSearchTerms] = useState({});
    const [defaultAction, setDefaultAction] = useState("skip"); // "skip" | "map-block" | "map-model"
    const [defaultBlockTarget, setDefaultBlockTarget] = useState(null);
    const [defaultModelTarget, setDefaultModelTarget] = useState(null);
    const availableBlocks = useMemo(() => getBlockTypes() || [], []);
    const availableModels = useMemo(() => environmentModels || [], []);

    useEffect(() => {
        // Initialize mappings with suggestions
        const initialMappings = {};
        unmappedBlocks.forEach((blockName) => {
            const suggestion = suggestMapping(blockName);
            if (suggestion && suggestion.action === "map" && suggestion.id) {
                initialMappings[blockName] = {
                    action: "map-block",
                    targetBlockId: suggestion.id,
                    targetBlockName: suggestion.name || "Unknown",
                };
            } else if (
                blockName === "minecraft:air" ||
                blockName === "minecraft:structure_void" ||
                blockName === "minecraft:barrier"
            ) {
                initialMappings[blockName] = { action: "skip" };
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
                    action === "map-block"
                        ? prev[blockName]?.targetBlockId ||
                          availableBlocks[0]?.id
                        : null,
                targetBlockName:
                    action === "map-block"
                        ? prev[blockName]?.targetBlockName ||
                          availableBlocks[0]?.name
                        : null,
                targetModelName:
                    action === "map-model"
                        ? prev[blockName]?.targetModelName ||
                          availableModels[0]?.name
                        : null,
            },
        }));
    };

    const handleBlockSelection = (blockName, targetBlock) => {
        setMappings((prev) => ({
            ...prev,
            [blockName]: {
                action: "map-block",
                targetBlockId: targetBlock.id,
                targetBlockName: targetBlock.name,
            },
        }));
    };

    const handleModelSelection = (blockName, targetModel) => {
        setMappings((prev) => ({
            ...prev,
            [blockName]: {
                action: "map-model",
                targetModelName: targetModel.name,
            },
        }));
    };

    const handleSearchChange = (blockName, searchTerm) => {
        setSearchTerms((prev) => ({
            ...prev,
            [blockName]: searchTerm,
        }));
    };

    const handleModelSearchChange = (blockName, searchTerm) => {
        setModelSearchTerms((prev) => ({
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

    const getFilteredModels = (blockName) => {
        const searchTerm = modelSearchTerms[blockName] || "";
        if (!searchTerm) return availableModels;
        const lower = searchTerm.toLowerCase();
        return availableModels.filter((m) =>
            (m.name || "").toLowerCase().includes(lower)
        );
    };

    const handleConfirm = () => {
        // Convert to the format expected by the parser
        const finalMappings = {};
        Object.entries(mappings).forEach(([blockName, mapping]) => {
            if (mapping.action === "map-block" && mapping.targetBlockId) {
                finalMappings[blockName] = {
                    id: mapping.targetBlockId,
                    name: mapping.targetBlockName,
                    action: "map",
                };
            } else if (mapping.action === "map-model" && mapping.targetModelName) {
                finalMappings[blockName] = {
                    modelName: mapping.targetModelName,
                    action: "model",
                };
            } else {
                finalMappings[blockName] = { action: "skip" };
            }
        });
        onConfirmMappings(finalMappings);
    };

    const mappedCount = Object.values(mappings).filter(
        (m) => m.action === "map-block" || m.action === "map-model"
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

                <div className="axiom-remapper-defaults">
                    <div className="defaults-row">
                        <span>Default action for unmapped:</span>
                        <label>
                            <input
                                type="radio"
                                name="default-action"
                                checked={defaultAction === "skip"}
                                onChange={() => setDefaultAction("skip")}
                            />
                            Skip
                        </label>
                        <label>
                            <input
                                type="radio"
                                name="default-action"
                                checked={defaultAction === "map-block"}
                                onChange={() => setDefaultAction("map-block")}
                            />
                            Map to block
                        </label>
                        <label>
                            <input
                                type="radio"
                                name="default-action"
                                checked={defaultAction === "map-model"}
                                onChange={() => setDefaultAction("map-model")}
                            />
                            Map to model
                        </label>
                    </div>
                    <div className="defaults-row">
                        {defaultAction === "map-block" && (
                            <select
                                value={defaultBlockTarget?.id || ""}
                                onChange={(e) => {
                                    const target = availableBlocks.find(
                                        (b) => String(b.id) === e.target.value
                                    );
                                    setDefaultBlockTarget(target || null);
                                }}
                            >
                                <option value="">Select block…</option>
                                {availableBlocks.map((b) => (
                                    <option key={b.id} value={b.id}>
                                        {b.name}
                                    </option>
                                ))}
                            </select>
                        )}
                        {defaultAction === "map-model" && (
                            <select
                                value={defaultModelTarget?.name || ""}
                                onChange={(e) => {
                                    const target = availableModels.find(
                                        (m) => m.name === e.target.value
                                    );
                                    setDefaultModelTarget(target || null);
                                }}
                            >
                                <option value="">Select model…</option>
                                {availableModels.map((m) => (
                                    <option key={m.name} value={m.name}>
                                        {m.name}
                                    </option>
                                ))}
                            </select>
                        )}
                        <button
                            className="btn-apply-default"
                            onClick={() => {
                                setMappings((prev) => {
                                    const next = { ...prev };
                                    Object.keys(next).forEach((blockName) => {
                                        if (
                                            blockName === "minecraft:air" ||
                                            blockName === "minecraft:structure_void" ||
                                            blockName === "minecraft:barrier"
                                        ) {
                                            next[blockName] = { action: "skip" };
                                            return;
                                        }
                                        if (defaultAction === "skip") {
                                            next[blockName] = { action: "skip" };
                                        } else if (
                                            defaultAction === "map-block" &&
                                            defaultBlockTarget
                                        ) {
                                            next[blockName] = {
                                                action: "map-block",
                                                targetBlockId: defaultBlockTarget.id,
                                                targetBlockName: defaultBlockTarget.name,
                                            };
                                        } else if (
                                            defaultAction === "map-model" &&
                                            defaultModelTarget
                                        ) {
                                            next[blockName] = {
                                                action: "map-model",
                                                targetModelName: defaultModelTarget.name,
                                            };
                                        }
                                    });
                                    return next;
                                });
                            }}
                        >
                            Apply to all
                        </button>
                    </div>
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
                        const filteredModels = getFilteredModels(blockName);
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
                                                checked={mapping.action === "map-block"}
                                                onChange={() =>
                                                    handleActionChange(
                                                        blockName,
                                                        "map-block"
                                                    )
                                                }
                                            />
                                            Map to
                                        </label>
                                        <label>
                                            <input
                                                type="radio"
                                                name={`action-${blockName}`}
                                                checked={mapping.action === "map-model"}
                                                onChange={() =>
                                                    handleActionChange(
                                                        blockName,
                                                        "map-model"
                                                    )
                                                }
                                            />
                                            Model
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

                                {mapping.action === "map-block" && (
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
                                                            mapping.targetBlockId === block.id
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
                                {mapping.action === "map-model" && (
                                    <div className="remapper-item-content">
                                        <input
                                            type="text"
                                            className="block-search"
                                            placeholder="Search models..."
                                            value={modelSearchTerms[blockName] || ""}
                                            onChange={(e) =>
                                                handleModelSearchChange(
                                                    blockName,
                                                    e.target.value
                                                )
                                            }
                                        />
                                        <div className="block-options">
                                            {filteredModels
                                                .slice(0, 5)
                                                .map((model) => (
                                                    <button
                                                        key={model.name}
                                                        className={`block-option ${
                                                            mapping.targetModelName === model.name
                                                                ? "selected"
                                                                : ""
                                                        }`}
                                                        onClick={() =>
                                                            handleModelSelection(
                                                                blockName,
                                                                model
                                                            )
                                                        }
                                                    >
                                                        <span>{model.name}</span>
                                                    </button>
                                                ))}
                                            {filteredModels.length > 5 && (
                                                <div className="more-options">
                                                    +{filteredModels.length - 5} more options
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