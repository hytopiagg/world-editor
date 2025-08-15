import React, { useState, useEffect, useMemo } from "react";
import { getBlockTypes } from "../TerrainBuilder";
import {
    DEFAULT_BLOCK_MAPPINGS,
    suggestMapping,
} from "../utils/minecraft/BlockMapper";
import { environmentModels } from "../EnvironmentBuilder";
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
    const availableEntities = useMemo(() => environmentModels || [], []);

    const resolveTextureSrc = (uri) => {
        if (!uri || typeof uri !== "string") return null;
        // Normalize leading markers
        let u = uri.trim();
        if (u.startsWith("http://") || u.startsWith("https://")) return u;
        if (u.startsWith("data:")) return u;
        if (u.startsWith("./")) u = u.slice(2);
        if (u.startsWith("/")) {
            // Absolute /assets/... -> make it relative so we don't double-prefix later
            if (u.startsWith("/assets/")) return `.${u}`;
            return u; // leave other absolutes as-is
        }
        if (u.startsWith("assets/")) return `./${u}`;
        return `./assets/${u}`;
    };

    const pickBlockTexture = (block) => {
        if (!block) return "./assets/blocks/error.png";
        const st = block.sideTextures || {};
        // Prefer top face, then fallbacks; support both +/- keys and naked axis keys
        const candidates = [
            st["+y"],
            st["-y"],
            st["+x"],
            st["-x"],
            st["+z"],
            st["-z"],
            st["y"],
            st["x"],
            st["z"],
            block.textureUri,
        ].filter(Boolean);
        const chosen =
            candidates.length > 0 ? candidates[0] : "./assets/blocks/error.png";
        return resolveTextureSrc(chosen);
    };

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
                    targetEntityName: null,
                    targetEntityModelUrl: null,
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
                    action === "skip" || action === "entity"
                        ? null
                        : prev[blockName]?.targetBlockId ||
                          availableBlocks[0]?.id,
                targetBlockName:
                    action === "skip" || action === "entity"
                        ? null
                        : prev[blockName]?.targetBlockName ||
                          availableBlocks[0]?.name,
                targetEntityName:
                    action === "entity"
                        ? prev[blockName]?.targetEntityName ||
                          availableEntities[0]?.name
                        : null,
                targetEntityModelUrl:
                    action === "entity"
                        ? prev[blockName]?.targetEntityModelUrl ||
                          availableEntities[0]?.modelUrl
                        : null,
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
                targetEntityName: null,
                targetEntityModelUrl: null,
            },
        }));
    };

    const handleEntitySelection = (blockName, targetEntity) => {
        setMappings((prev) => ({
            ...prev,
            [blockName]: {
                action: "entity",
                targetBlockId: null,
                targetBlockName: null,
                targetEntityName: targetEntity.name,
                targetEntityModelUrl: targetEntity.modelUrl,
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

    const getFilteredEntities = (blockName) => {
        const searchTerm = searchTerms[blockName] || "";
        if (!searchTerm) return availableEntities;
        const lowerSearch = searchTerm.toLowerCase();
        return availableEntities.filter((e) =>
            e.name.toLowerCase().includes(lowerSearch)
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
            } else if (
                mapping.action === "entity" &&
                mapping.targetEntityName
            ) {
                finalMappings[blockName] = {
                    action: "entity",
                    entityName: mapping.targetEntityName,
                    modelUrl: mapping.targetEntityModelUrl || null,
                };
            } else {
                finalMappings[blockName] = { action: "skip" };
            }
        });
        onConfirmMappings(finalMappings);
    };

    const mappedCount = Object.values(mappings).filter(
        (m) => m.action === "map" || m.action === "entity"
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
                                            Map to block
                                        </label>
                                        <label>
                                            <input
                                                type="radio"
                                                name={`action-${blockName}`}
                                                checked={
                                                    mapping.action === "entity"
                                                }
                                                onChange={() =>
                                                    handleActionChange(
                                                        blockName,
                                                        "entity"
                                                    )
                                                }
                                            />
                                            Place entity
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
                                        <div className="selector-grid icon-only">
                                            {filteredBlocks.map((block) => (
                                                <button
                                                    key={block.id}
                                                    className={`selector-tile ${
                                                        mapping.targetBlockId ===
                                                        block.id
                                                            ? "selected"
                                                            : ""
                                                    }`}
                                                    title={block.name}
                                                    onClick={() =>
                                                        handleBlockSelection(
                                                            blockName,
                                                            block
                                                        )
                                                    }
                                                >
                                                    {block.isMultiTexture ||
                                                    block.sideTextures ? (
                                                        <img
                                                            className="selector-icon"
                                                            src={pickBlockTexture(
                                                                block
                                                            )}
                                                            alt={block.name}
                                                        />
                                                    ) : block.textureUri ? (
                                                        <img
                                                            className="selector-icon"
                                                            src={resolveTextureSrc(
                                                                block.textureUri
                                                            )}
                                                            alt={block.name}
                                                        />
                                                    ) : (
                                                        <div className="selector-icon selector-fallback">
                                                            {block.name?.[0] ||
                                                                "?"}
                                                        </div>
                                                    )}
                                                    {/* icon-only: no label */}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {mapping.action === "entity" && (
                                    <div className="remapper-item-content">
                                        <input
                                            type="text"
                                            className="block-search"
                                            placeholder="Search models..."
                                            value={searchTerms[blockName] || ""}
                                            onChange={(e) =>
                                                handleSearchChange(
                                                    blockName,
                                                    e.target.value
                                                )
                                            }
                                        />
                                        <div className="selector-grid compact icon-only">
                                            {getFilteredEntities(blockName).map(
                                                (model) => (
                                                    <button
                                                        key={model.id}
                                                        className={`selector-tile ${
                                                            mapping.targetEntityName ===
                                                            model.name
                                                                ? "selected"
                                                                : ""
                                                        }`}
                                                        title={model.name}
                                                        onClick={() =>
                                                            handleEntitySelection(
                                                                blockName,
                                                                model
                                                            )
                                                        }
                                                    >
                                                        <div className="selector-icon selector-fallback">
                                                            {model.name?.[0] ||
                                                                "M"}
                                                        </div>
                                                        {/* icon-only: no label */}
                                                    </button>
                                                )
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
