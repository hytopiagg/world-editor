import React, { useState, useEffect, useMemo, useRef } from "react";
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
    const [expandedRows, setExpandedRows] = useState({});
    const availableBlocks = useMemo(() => getBlockTypes() || [], []);
    const availableEntities = useMemo(() => environmentModels || [], []);

    // Local storage helpers for persistent user mappings
    const STORAGE_KEY = "axiomBlockMappings";
    const loadSavedMappings = () => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (_) {
            return {};
        }
    };
    const saveMappingsToStorage = (toSave) => {
        try {
            const existing = loadSavedMappings();
            const merged = { ...existing, ...toSave };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        } catch (_) {}
    };

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

    // Prevent background page scroll when modal is open
    useEffect(() => {
        const original = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = original;
        };
    }, []);

    useEffect(() => {
        // Initialize mappings with persisted overrides or suggestions
        const initialMappings = {};
        const saved = loadSavedMappings();
        // Use all seen blocks (so auto-mapped ones can be remapped too)
        const allBlockNames = Object.keys(blockCounts || {});
        allBlockNames.forEach((blockName) => {
            const savedMapping = saved[blockName];
            if (savedMapping && savedMapping.action) {
                if (
                    savedMapping.action === "map" &&
                    (savedMapping.id || savedMapping.targetBlockId)
                ) {
                    const id = savedMapping.id || savedMapping.targetBlockId;
                    const name =
                        savedMapping.name ||
                        savedMapping.targetBlockName ||
                        availableBlocks.find((b) => b.id === id)?.name ||
                        "Unknown";
                    initialMappings[blockName] = {
                        action: "map",
                        targetBlockId: id,
                        targetBlockName: name,
                        targetEntityName: null,
                        targetEntityModelUrl: null,
                    };
                } else if (
                    savedMapping.action === "entity" &&
                    (savedMapping.entityName || savedMapping.targetEntityName)
                ) {
                    const entityName =
                        savedMapping.entityName ||
                        savedMapping.targetEntityName;
                    const modelUrl =
                        savedMapping.modelUrl ||
                        savedMapping.targetEntityModelUrl ||
                        null;
                    initialMappings[blockName] = {
                        action: "entity",
                        targetBlockId: null,
                        targetBlockName: null,
                        targetEntityName: entityName,
                        targetEntityModelUrl: modelUrl,
                    };
                } else if (savedMapping.action === "skip") {
                    initialMappings[blockName] = {
                        action: "skip",
                        targetBlockId: null,
                        targetBlockName: null,
                        targetEntityName: null,
                        targetEntityModelUrl: null,
                    };
                }
                return;
            }

            // Fallback to automatic suggestion
            const suggestion = suggestMapping(blockName);
            if (suggestion && suggestion.action === "map" && suggestion.id) {
                initialMappings[blockName] = {
                    action: "map",
                    targetBlockId: suggestion.id,
                    targetBlockName: suggestion.name || "Unknown",
                    targetEntityName: null,
                    targetEntityModelUrl: null,
                };
            } else if (
                suggestion &&
                suggestion.action === "entity" &&
                suggestion.entityName
            ) {
                initialMappings[blockName] = {
                    action: "entity",
                    targetBlockId: null,
                    targetBlockName: null,
                    targetEntityName: suggestion.entityName,
                    targetEntityModelUrl: suggestion.modelUrl || null,
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
    }, [unmappedBlocks, blockCounts, availableBlocks]);

    const handleActionChange = (blockName, action) => {
        setMappings((prev) => ({
            ...prev,
            [blockName]: {
                ...prev[blockName],
                action,
                targetBlockId:
                    action === "map"
                        ? prev[blockName]?.targetBlockId || null
                        : null,
                targetBlockName:
                    action === "map"
                        ? prev[blockName]?.targetBlockName || null
                        : null,
                targetEntityName:
                    action === "entity"
                        ? prev[blockName]?.targetEntityName || null
                        : null,
                targetEntityModelUrl:
                    action === "entity"
                        ? prev[blockName]?.targetEntityModelUrl || null
                        : null,
            },
        }));
        setExpandedRows((prev) => ({ ...prev, [blockName]: true }));
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
        setExpandedRows((prev) => ({ ...prev, [blockName]: false }));
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
        setExpandedRows((prev) => ({ ...prev, [blockName]: false }));
    };

    const handleSearchChange = (blockName, searchTerm) => {
        setSearchTerms((prev) => ({
            ...prev,
            [blockName]: searchTerm,
        }));
    };

    const getFilteredBlocks = (blockName) => {
        const searchTerm = searchTerms[blockName] || "";
        if (!searchTerm)
            return availableBlocks.filter((block) => !block.isVariant);

        const lowerSearch = searchTerm.toLowerCase();
        return availableBlocks.filter(
            (block) =>
                !block.isVariant &&
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
        // Persist user decisions for future sessions (map/entity only)
        const toPersist = {};
        Object.entries(finalMappings).forEach(([blockName, m]) => {
            if (m.action === "map") {
                toPersist[blockName] = {
                    action: "map",
                    id: m.id,
                    name: m.name,
                };
            } else if (m.action === "entity") {
                toPersist[blockName] = {
                    action: "entity",
                    entityName: m.entityName,
                    modelUrl: m.modelUrl || null,
                };
            }
        });
        if (Object.keys(toPersist).length > 0) {
            saveMappingsToStorage(toPersist);
        }
        onConfirmMappings(finalMappings);
    };

    // Prepare display list: include all seen blocks; sort with unmapped first then by count desc
    const allBlockNames = useMemo(
        () => Object.keys(blockCounts || {}),
        [blockCounts]
    );
    const savedOverrides = useMemo(() => loadSavedMappings(), [blockCounts]);
    const unmappedSet = useMemo(
        () => new Set(unmappedBlocks || []),
        [unmappedBlocks]
    );
    const displayBlockNames = useMemo(() => {
        // Filter out default-skipped blocks (e.g., air, structure_void) unless user overrode
        const list = allBlockNames.filter((name) => {
            const user = savedOverrides[name];
            if (user && user.action && user.action !== "skip") return true;
            const def = DEFAULT_BLOCK_MAPPINGS[name];
            if (def && def.action === "skip") return false;
            return true;
        });
        list.sort((a, b) => {
            const aUn = unmappedSet.has(a) ? 0 : 1;
            const bUn = unmappedSet.has(b) ? 0 : 1;
            if (aUn !== bUn) return aUn - bUn;
            const ca = blockCounts[a] || 0;
            const cb = blockCounts[b] || 0;
            return cb - ca;
        });
        return list;
    }, [allBlockNames, unmappedSet, blockCounts, savedOverrides]);

    const mappedCount = Object.values(mappings).filter(
        (m) =>
            (m.action === "map" && m.targetBlockId) ||
            (m.action === "entity" && m.targetEntityName)
    ).length;
    const totalCount = displayBlockNames.length;

    const overlayRef = useRef(null);

    const handleOverlayMouseDown = (e) => {
        try {
            if (overlayRef.current && e.target === overlayRef.current) {
                onCancel && onCancel();
            }
        } catch (_) {}
    };

    return (
        <div
            className="axiom-remapper-overlay"
            ref={overlayRef}
            onMouseDown={handleOverlayMouseDown}
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
        >
            <div
                className="axiom-remapper-modal"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="axiom-remapper-header">
                    <h2>Remap Minecraft Blocks</h2>
                    <p className="axiom-remapper-subtitle">
                        Found {totalCount} unique block types in this blueprint
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
                    {displayBlockNames.map((blockName) => {
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
                                        <div
                                            className="current-mapping"
                                            title="Click to remap"
                                            onClick={() =>
                                                setExpandedRows((prev) => ({
                                                    ...prev,
                                                    [blockName]: true,
                                                }))
                                            }
                                        >
                                            {mapping.action === "map" &&
                                                mapping.targetBlockId && (
                                                    <div className="mapping-target">
                                                        <span className="arrow-sep">
                                                            →
                                                        </span>
                                                        <img
                                                            className="mapping-icon"
                                                            src={pickBlockTexture(
                                                                availableBlocks.find(
                                                                    (b) =>
                                                                        b.id ===
                                                                        mapping.targetBlockId
                                                                )
                                                            )}
                                                            alt={
                                                                mapping.targetBlockName ||
                                                                "Selected block"
                                                            }
                                                        />
                                                    </div>
                                                )}
                                            {mapping.action === "entity" &&
                                                mapping.targetEntityName && (
                                                    <div className="mapping-target">
                                                        <span className="arrow-sep">
                                                            →
                                                        </span>
                                                        <span className="mapping-entity-pill">
                                                            {
                                                                mapping.targetEntityName
                                                            }
                                                        </span>
                                                    </div>
                                                )}
                                        </div>
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
                                        {(expandedRows[blockName] ??
                                            !mapping.targetBlockId) && (
                                            <input
                                                type="text"
                                                className="block-search"
                                                placeholder="Search blocks..."
                                                value={
                                                    searchTerms[blockName] || ""
                                                }
                                                onChange={(e) =>
                                                    handleSearchChange(
                                                        blockName,
                                                        e.target.value
                                                    )
                                                }
                                            />
                                        )}
                                        <div
                                            className="selector-grid icon-only"
                                            style={{
                                                display:
                                                    expandedRows[blockName] ??
                                                    !mapping.targetBlockId
                                                        ? undefined
                                                        : "none",
                                            }}
                                        >
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
                                        {(expandedRows[blockName] ??
                                            !mapping.targetEntityName) && (
                                            <input
                                                type="text"
                                                className="block-search"
                                                placeholder="Search models..."
                                                value={
                                                    searchTerms[blockName] || ""
                                                }
                                                onChange={(e) =>
                                                    handleSearchChange(
                                                        blockName,
                                                        e.target.value
                                                    )
                                                }
                                            />
                                        )}
                                        <div
                                            className="entity-pills"
                                            style={{
                                                display:
                                                    expandedRows[blockName] ??
                                                    !mapping.targetEntityName
                                                        ? undefined
                                                        : "none",
                                            }}
                                        >
                                            {getFilteredEntities(blockName).map(
                                                (model) => (
                                                    <button
                                                        key={model.id}
                                                        className={`entity-pill ${
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
                                                        <span className="entity-pill-label">
                                                            {model.name}
                                                        </span>
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
