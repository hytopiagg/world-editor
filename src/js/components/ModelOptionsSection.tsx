import { useEffect, useState } from "react";
import { FaCog, FaDownload, FaSave, FaTrash } from "react-icons/fa";
import { environmentModels } from "../EnvironmentBuilder";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";
import ModelPreview from "./ModelPreview";

const SCALE_MIN = 0.1;
const SCALE_MAX = 5.0;
const ROTATION_MIN = 0;
const ROTATION_MAX = 360;
const SHIFT_MIN = -1.0;
const SHIFT_MAX = 1.0;

interface ModelOptionsProps {
    selectedModel: any;
    placementSettings: {
        randomScale: boolean;
        randomRotation: boolean;
        minScale: number;
        maxScale: number;
        minRotation: number;
        maxRotation: number;
        scale: number;
        rotation: number;
        snapToGrid: boolean;
    };
    onPlacementSettingsChange: (settings: any) => void;
    onDownloadModel?: (model: any) => void;
    onDeleteModel?: (model: any) => void;
    onUpdateModelName?: (modelId: number, newName: string) => Promise<void>;
    environmentBuilder?: any;
    isCompactMode: boolean;
}

export default function ModelOptionsSection({
    selectedModel,
    placementSettings,
    onPlacementSettingsChange,
    isCompactMode,
    onDownloadModel,
    onDeleteModel,
    onUpdateModelName,
    environmentBuilder
}: ModelOptionsProps) {
    const [settings, setSettings] = useState({
        ...placementSettings,
        snapToGrid: placementSettings.snapToGrid !== false,
    });
    const [editableName, setEditableName] = useState(selectedModel?.name || '');
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [addColliderEnabled, setAddColliderEnabled] = useState(true);
    const [verticalShift, setVerticalShift] = useState(0);
    const [verticalShiftInput, setVerticalShiftInput] = useState("0");

    useEffect(() => {
        setSettings({
            ...placementSettings,
            snapToGrid: placementSettings.snapToGrid !== false,
        });
    }, [placementSettings]);

    useEffect(() => {
        setEditableName(selectedModel?.name || '');
        setIsEditing(false); // Reset editing state when model changes
        // Load collider preference
        const loadColliderPref = async () => {
            if (!selectedModel) return;
            try {
                let prefs: Record<string, boolean> = {};
                try {
                    prefs = (await DatabaseManager.getData(
                        STORES.ENVIRONMENT_MODEL_SETTINGS,
                        "colliderSettings"
                    )) as Record<string, boolean> || {};
                } catch (e) {
                    // Fallback: use the SETTINGS store when the dedicated one is missing
                    try {
                        prefs = (await DatabaseManager.getData(
                            STORES.SETTINGS,
                            "colliderSettings"
                        )) as Record<string, boolean> || {};
                    } catch {
                        prefs = {};
                    }
                }
                const idKey = String(selectedModel.id);
                const prefValue = Object.prototype.hasOwnProperty.call(prefs, idKey) ? prefs[idKey] : true;
                setAddColliderEnabled(!!prefValue);
                // Ensure environmentModels reflects current value
                const idx = environmentModels.findIndex((m) => m.id === selectedModel.id);
                if (idx !== -1) {
                    environmentModels[idx].addCollider = !!prefValue;
                }
            } catch (err) {
                console.warn("Failed to load collider preference:", err);
                setAddColliderEnabled(true);
            }
            // NEW: load vertical shift preference
            try {
                let shiftPrefs: Record<string, number> = {};
                try {
                    shiftPrefs = (await DatabaseManager.getData(
                        STORES.ENVIRONMENT_MODEL_SETTINGS,
                        "yShiftSettings"
                    )) as Record<string, number> || {};
                } catch (e) {
                    try {
                        shiftPrefs = (await DatabaseManager.getData(
                            STORES.SETTINGS,
                            "yShiftSettings"
                        )) as Record<string, number> || {};
                    } catch {
                        shiftPrefs = {};
                    }
                }
                const idKey = String(selectedModel.id);
                const shiftValue = Object.prototype.hasOwnProperty.call(shiftPrefs, idKey) ? shiftPrefs[idKey] : 0;
                setVerticalShift(shiftValue);
                setVerticalShiftInput(String(shiftValue));
                const idx = environmentModels.findIndex((m) => m.id === selectedModel.id);
                if (idx !== -1) {
                    environmentModels[idx].yShift = shiftValue;
                }
                if (selectedModel) {
                    selectedModel.yShift = shiftValue;
                }
            } catch (err) {
                console.warn("Failed to load y-shift preference:", err);
                setVerticalShift(0);
            }
        };
        loadColliderPref();
    }, [selectedModel]);

    const handleColliderToggle = async (checked: boolean) => {
        setAddColliderEnabled(checked);
        try {
            const storeKey = "colliderSettings";
            let existingPrefs: Record<string, boolean> = {};
            let saveStore = STORES.ENVIRONMENT_MODEL_SETTINGS;
            try {
                existingPrefs = (await DatabaseManager.getData(
                    STORES.ENVIRONMENT_MODEL_SETTINGS,
                    storeKey
                )) as Record<string, boolean> || {};
            } catch (e) {
                saveStore = STORES.SETTINGS;
                existingPrefs = (await DatabaseManager.getData(
                    STORES.SETTINGS,
                    storeKey
                )) as Record<string, boolean> || {};
            }
            existingPrefs[String(selectedModel.id)] = checked;
            await DatabaseManager.saveData(saveStore, storeKey, existingPrefs);
            const idx = environmentModels.findIndex((m) => m.id === selectedModel.id);
            if (idx !== -1) {
                environmentModels[idx].addCollider = checked;
            }
            // Also reflect in incoming selectedModel object (clone) for immediate UI consistency
            if (selectedModel) {
                selectedModel.addCollider = checked;
            }
        } catch (err) {
            console.error("Failed to save collider preference:", err);
        }
    };

    const commitVerticalShift = async (value: number) => {
        if (!selectedModel) return;
        setVerticalShift(value);
        setVerticalShiftInput(String(value));
        try {
            const storeKey = "yShiftSettings";
            let existingPrefs: Record<string, number> = {};
            let saveStore = STORES.ENVIRONMENT_MODEL_SETTINGS;
            try {
                existingPrefs = (await DatabaseManager.getData(
                    STORES.ENVIRONMENT_MODEL_SETTINGS,
                    storeKey
                )) as Record<string, number> || {};
            } catch (e) {
                saveStore = STORES.SETTINGS;
                existingPrefs = (await DatabaseManager.getData(
                    STORES.SETTINGS,
                    storeKey
                )) as Record<string, number> || {};
            }
            existingPrefs[String(selectedModel.id)] = value;
            await DatabaseManager.saveData(saveStore, storeKey, existingPrefs);
            const idx = environmentModels.findIndex((m) => m.id === selectedModel.id);
            if (idx !== -1) {
                environmentModels[idx].yShift = value;
            }
            selectedModel.yShift = value;
            // Inform EnvironmentBuilder if available
            if (environmentBuilder?.current?.setModelYShift) {
                try {
                    environmentBuilder.current.setModelYShift(selectedModel.id, value);
                } catch { /* ignore */ }
            }
        } catch (err) {
            console.error("Failed to save y-shift preference:", err);
        }
    };

    const handleVerticalShiftInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        const val = e.target.value;
        // Allow only - digits and single dot
        if (/^-?\d*\.?\d*$/.test(val)) {
            setVerticalShiftInput(val);
        }
    };

    const handleVerticalShiftInputBlur = () => {
        let parsed = parseFloat(verticalShiftInput);
        if (isNaN(parsed)) {
            parsed = 0;
        }
        parsed = Math.min(SHIFT_MAX, Math.max(SHIFT_MIN, parsed));
        commitVerticalShift(parseFloat(parsed.toFixed(2)));
    };

    const handleVerticalShiftKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        // Prevent global shortcuts / key listeners from firing while typing
        e.stopPropagation();
        if (e.key === "Enter") {
            handleVerticalShiftInputBlur();
        }
    };

    const updateSettings = (updates: any) => {
        const newSettings = { ...settings, ...updates };
        setSettings(newSettings);
        onPlacementSettingsChange(newSettings);
    };

    const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setEditableName(event.target.value);
    };

    const handleSaveName = async () => {
        if (!selectedModel || !selectedModel.isCustom || isSaving) return;

        const trimmedName = editableName.trim();
        if (trimmedName && trimmedName !== selectedModel.name) {
            setIsSaving(true);
            try {
                const existingModels = (await DatabaseManager.getData(STORES.CUSTOM_MODELS, "models") || []) as Array<{ name: string }>;
                const modelToUpdate = existingModels.find(
                    (model: { name: string }) => model.name === selectedModel.name
                );

                if (modelToUpdate) {
                    modelToUpdate.name = trimmedName;
                    await DatabaseManager.saveData(STORES.CUSTOM_MODELS, "models", existingModels);
                    const modelIndex = environmentModels.findIndex(
                        (model) => model.id === selectedModel.id
                    );
                    if (modelIndex !== -1) {
                        environmentModels[modelIndex].name = trimmedName;
                    }
                    const currentEnvironment = await DatabaseManager.getData(STORES.ENVIRONMENT, "current") || [];
                    const updatedEnvironment = Array.isArray(currentEnvironment) ? currentEnvironment.map((obj: { name: string }) => {
                        if (obj.name === selectedModel.name) {
                            return { ...obj, name: trimmedName };
                        }
                        return obj;
                    }) : [];
                    await DatabaseManager.saveData(STORES.ENVIRONMENT, "current", updatedEnvironment);
                    if (environmentBuilder?.current?.refreshEnvironmentFromDB) {
                        await environmentBuilder.current.refreshEnvironmentFromDB();
                    }
                    if (onUpdateModelName) {
                        try {
                            await onUpdateModelName(selectedModel.id, trimmedName);
                        } catch (err) {
                            console.warn("onUpdateModelName callback failed (ignored for models):", err);
                        }
                    }
                }

                // Update visible name immediately in this component
                if (selectedModel) {
                    selectedModel.name = trimmedName;
                }
                setEditableName(trimmedName);
                setIsEditing(false);
            } catch (error) {
                console.error("Failed to update model name:", error);
            } finally {
                setIsSaving(false);
            }
        } else {
            setIsEditing(false);
            setEditableName(selectedModel.name);
        }
    };

    const handleKeyDown = (event: React.KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
            handleSaveName();
        } else if (event.key === 'Escape') {
            setIsEditing(false);
            setEditableName(selectedModel.name); // Reset on escape
        }
    };

    const handleDownload = async () => {
        if (!selectedModel || !selectedModel.modelUrl) return;

        try {
            const response = await fetch(selectedModel.modelUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch model: ${response.statusText}`);
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${selectedModel.name}.${selectedModel.modelUrl.endsWith('.glb') ? 'glb' : 'gltf'}`;
            document.body.appendChild(a);
            a.click();

            // Clean up
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            console.error("Error downloading model:", error);
            alert("Failed to download model. See console for details.");
        }
    };

    const handleDelete = async () => {
        if (!selectedModel || !selectedModel.isCustom) return;

        if (window.confirm("Are you sure you want to delete this custom model?")) {
            try {
                const existingModels = (await DatabaseManager.getData(STORES.CUSTOM_MODELS, "models") || []) as Array<{ name: string }>;
                const modelIndex = environmentModels.findIndex(
                    (model) => model.id === selectedModel.id
                );

                if (modelIndex !== -1) {
                    environmentModels.splice(modelIndex, 1);
                }

                const updatedModels = Array.isArray(existingModels) ? existingModels.filter(
                    (model: { name: string }) => model.name !== selectedModel.name
                ) : [];

                await DatabaseManager.saveData(STORES.CUSTOM_MODELS, "models", updatedModels);

                const currentEnvironment = await DatabaseManager.getData(STORES.ENVIRONMENT, "current") || [];
                const updatedEnvironment = Array.isArray(currentEnvironment) ? currentEnvironment.filter(
                    (obj: { name: string }) => obj.name !== selectedModel.name
                ) : [];

                await DatabaseManager.saveData(STORES.ENVIRONMENT, "current", updatedEnvironment);

                if (environmentBuilder?.current?.refreshEnvironmentFromDB) {
                    await environmentBuilder.current.refreshEnvironmentFromDB();
                }

                if (onDeleteModel) {
                    onDeleteModel(selectedModel);
                }
            } catch (error) {
                console.error("Error deleting environment model:", error);
                alert("Failed to delete model. See console for details.");
            }
        }
    };

    if (!selectedModel) return null;

    return (
        <div className="flex flex-col gap-3">
            <div className={"model-preview-container w-full bg-black/20 rounded-md overflow-hidden relative opacity-0 duration-150 fade-down"}
                style={{
                    height: isCompactMode ? "10rem" : "12rem",
                    animationDelay: "0.05s"
                }}
                onWheel={(e) => e.stopPropagation()}
            >
                {selectedModel.modelUrl ? (
                    <ModelPreview modelUrl={selectedModel.modelUrl} skybox={null} />
                ) : (
                    <div className="flex items-center justify-center h-full text-xs text-white/50">No model preview available</div>
                )}
            </div>
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <label className="text-xs text-[#F1F1F1]/80 w-10">ID:</label>
                    <input
                        type="text"
                        value={selectedModel.id}
                        disabled
                        className="flex-grow px-2 py-1 text-xs bg-black/20 border border-white/10 rounded-md text-[#F1F1F1]/70"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-xs text-[#F1F1F1]/80 w-10">Name:</label>
                    {selectedModel.isCustom && isEditing ? (
                        <input
                            type="text"
                            value={editableName}
                            onChange={handleNameChange}
                            onBlur={handleSaveName}
                            onKeyDown={handleKeyDown}
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
                            value={editableName}
                            disabled
                            onClick={() => selectedModel.isCustom && setIsEditing(true)}
                            className={`flex-grow px-2 py-1 text-xs bg-black/20 border border-white/10 rounded-md ${selectedModel.isCustom ? 'text-[#F1F1F1] cursor-text hover:bg-black/30' : 'text-[#F1F1F1]/70'}`}
                            style={{
                                width: 'calc(100% - 8px)',
                            }}
                        />
                    )}
                    {selectedModel.isCustom && (
                        isEditing ? (
                            <button
                                onClick={handleSaveName}
                                disabled={isSaving || !editableName.trim() || editableName.trim() === selectedModel.name}
                                className="p-1.5 text-xs border border-white/10 hover:bg-white/20 rounded-md disabled:opacity-50"
                                title="Save Name"
                            >
                                {isSaving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white/90 rounded-full animate-spin" /> : <FaSave />}
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

                <div className="flex flex-col gap-1 mt-3">
                    <div className="flex flex-col gap-1 fade-down opacity-0 duration-150" style={{ animationDelay: "0.05s" }}>
                        <label className="flex items-center justify-between text-xs text-[#F1F1F1] cursor-pointer">
                            <span>Randomize Scale</span>
                            <input
                                type="checkbox"
                                id="randomScale"
                                checked={settings.randomScale}
                                onChange={(e) => updateSettings({ randomScale: e.target.checked })}
                                className="w-4 h-4 rounded bg-white/10 border-white/10 checked:bg-blue-500 checked:border-blue-500"
                            />
                        </label>

                        {settings.randomScale && (
                            <div className="flex items-center gap-x-2 w-full mt-1">
                                <span className="text-xs text-[#F1F1F1]/80">Range:</span>
                                <input
                                    type="number"
                                    value={settings.minScale}
                                    min={SCALE_MIN}
                                    max={SCALE_MAX}
                                    step="0.1"
                                    onKeyDown={(e) => e.stopPropagation()}
                                    onChange={(e) => updateSettings({ minScale: Number(e.target.value) })}
                                    onBlur={(e) => {
                                        const value = Number(e.target.value);
                                        if (value < SCALE_MIN || value > SCALE_MAX) {
                                            updateSettings({ minScale: 0.5 });
                                        }
                                    }}
                                    className="w-16 px-1 py-0.5 border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                />
                                <span className="text-xs text-[#F1F1F1]/80">-</span>
                                <input
                                    type="number"
                                    value={settings.maxScale}
                                    min={SCALE_MIN}
                                    max={SCALE_MAX}
                                    step="0.1"
                                    onKeyDown={(e) => e.stopPropagation()}
                                    onChange={(e) => updateSettings({ maxScale: Number(e.target.value) })}
                                    onBlur={(e) => {
                                        const value = Number(e.target.value);
                                        if (value < SCALE_MIN || value > SCALE_MAX) {
                                            updateSettings({ maxScale: 1.5 });
                                        }
                                    }}
                                    className="w-16 px-1 py-0.5 border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                />
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col gap-1 fade-down opacity-0 duration-150" style={{ animationDelay: "0.075s" }}>
                        <label className="flex items-center justify-between text-xs text-[#F1F1F1] cursor-pointer">
                            <span>Randomize Rotation</span>
                            <input
                                type="checkbox"
                                id="randomRotation"
                                checked={settings.randomRotation}
                                onChange={(e) => updateSettings({ randomRotation: e.target.checked })}
                                className="w-4 h-4 rounded bg-white/10 border-white/10 checked:bg-blue-500 checked:border-blue-500"
                            />
                        </label>

                        {settings.randomRotation && (
                            <div className="flex items-center gap-x-2 w-full mt-1">
                                <span className="text-xs text-[#F1F1F1]/80">Range:</span>
                                <input
                                    type="number"
                                    value={settings.minRotation}
                                    min={ROTATION_MIN}
                                    max={ROTATION_MAX}
                                    step="15"
                                    onKeyDown={(e) => e.stopPropagation()}
                                    onChange={(e) => updateSettings({ minRotation: Number(e.target.value) })}
                                    onBlur={(e) => {
                                        const value = Number(e.target.value);
                                        if (value < ROTATION_MIN || value > ROTATION_MAX) {
                                            updateSettings({ minRotation: 0 });
                                        }
                                    }}
                                    className="w-16 px-1 py-0.5 border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                />
                                <span className="text-xs text-[#F1F1F1]/80">-</span>
                                <input
                                    type="number"
                                    value={settings.maxRotation}
                                    min={ROTATION_MIN}
                                    max={ROTATION_MAX}
                                    step="15"
                                    onKeyDown={(e) => e.stopPropagation()}
                                    onChange={(e) => updateSettings({ maxRotation: Number(e.target.value) })}
                                    onBlur={(e) => {
                                        const value = Number(e.target.value);
                                        if (value < ROTATION_MIN || value > ROTATION_MAX) {
                                            updateSettings({ maxRotation: 360 });
                                        }
                                    }}
                                    className="w-16 px-1 py-0.5 border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                />
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col gap-1 fade-down opacity-0 duration-150" style={{ animationDelay: "0.1s" }}>
                        <div className="flex items-center gap-x-2 w-full">
                            <label className="text-xs text-[#F1F1F1] whitespace-nowrap">Scale</label>
                            <input
                                type="number"
                                value={settings.scale}
                                disabled={settings.randomScale}
                                min={SCALE_MIN}
                                max={SCALE_MAX}
                                step="0.1"
                                onKeyDown={(e) => e.stopPropagation()}
                                onChange={(e) => updateSettings({ scale: Number(e.target.value) })}
                                onBlur={(e) => {
                                    const value = Number(e.target.value);
                                    if (value < SCALE_MIN || value > SCALE_MAX) {
                                        updateSettings({ scale: 1.0 });
                                    }
                                }}
                                className="w-[34.5px] px-1 py-0.5  border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                            <input
                                type="range"
                                min={SCALE_MIN}
                                max={SCALE_MAX}
                                step="0.1"
                                disabled={settings.randomScale}
                                value={settings.scale}
                                onChange={(e) => updateSettings({ scale: Number(e.target.value) })}
                                className="flex w-[inherit] h-1 bg-white/10 transition-all rounded-sm appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 animate-slider"
                                style={{
                                    transition: "all 0.3s ease-in-out",
                                    background: `linear-gradient(to right, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0.8) ${(settings.scale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN) * 100}%, rgba(255, 255, 255, 0.1) ${(settings.scale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN) * 100}%, rgba(255, 255, 255, 0.1) 100%)`
                                }}
                            />
                        </div>
                    </div>

                    <div className="flex flex-col gap-1 fade-down opacity-0 duration-150" style={{ animationDelay: "0.125s" }}>
                        <div className="flex items-center gap-x-2 w-full">
                            <label className="text-xs text-[#F1F1F1] whitespace-nowrap">Rotation</label>
                            <div className="flex items-center ml-auto">
                                <input
                                    type="number"
                                    value={settings.rotation}
                                    disabled={settings.randomRotation}
                                    min={ROTATION_MIN}
                                    max={ROTATION_MAX}
                                    step="15"
                                    onKeyDown={(e) => e.stopPropagation()}
                                    onChange={(e) => updateSettings({ rotation: Number(e.target.value) })}
                                    onBlur={(e) => {
                                        const value = Number(e.target.value);
                                        if (value < ROTATION_MIN || value > ROTATION_MAX) {
                                            updateSettings({ rotation: 0 });
                                        }
                                    }}
                                    className="w-[34.5px] px-1 py-0.5  border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                />
                            </div>
                            <input
                                type="range"
                                min={ROTATION_MIN}
                                max={ROTATION_MAX}
                                step="15"
                                disabled={settings.randomRotation}
                                value={settings.rotation}
                                onChange={(e) => updateSettings({ rotation: Number(e.target.value) })}
                                className="flex w-[inherit] h-1 bg-white/10 transition-all rounded-sm appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 animate-slider"
                                style={{
                                    transition: "all 0.3s ease-in-out",
                                    background: `linear-gradient(to right, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0.8) ${(settings.rotation - ROTATION_MIN) / (ROTATION_MAX - ROTATION_MIN) * 100}%, rgba(255, 255, 255, 0.1) ${(settings.rotation - ROTATION_MIN) / (ROTATION_MAX - ROTATION_MIN) * 100}%, rgba(255, 255, 255, 0.1) 100%)`
                                }}
                            />
                        </div>
                    </div>

                    {/* Add Collider Checkbox */}
                    <div className="flex flex-col gap-1 fade-down opacity-0 duration-150" style={{ animationDelay: "0.15s" }}>
                        <label className="flex items-center justify-between text-xs text-[#F1F1F1] cursor-pointer">
                            <span>Add Collider</span>
                            <input
                                type="checkbox"
                                checked={addColliderEnabled}
                                onChange={(e) => handleColliderToggle(e.target.checked)}
                                className="w-4 h-4 rounded bg-white/10 border-white/10 checked:bg-blue-500 checked:border-blue-500"
                            />
                        </label>
                    </div>

                    {/* Snap to Grid Checkbox */}
                    <div className="flex flex-col gap-1 fade-down opacity-0 duration-150" style={{ animationDelay: "0.175s" }}>
                        <label className="flex items-center justify-between text-xs text-[#F1F1F1] cursor-pointer">
                            <span>Snap to Grid</span>
                            <input
                                type="checkbox"
                                checked={settings.snapToGrid}
                                onChange={(e) => updateSettings({ snapToGrid: e.target.checked })}
                                className="w-4 h-4 rounded bg-white/10 border-white/10 checked:bg-blue-500 checked:border-blue-500"
                            />
                        </label>
                    </div>

                    {/* NEW: Vertical Offset Slider */}
                    <div className="flex flex-col gap-1 fade-down opacity-0 duration-150" style={{ animationDelay: "0.2s" }}>
                        <div className="flex items-center gap-x-2 w-full">
                            <label className="text-xs text-[#F1F1F1] whitespace-nowrap">Vertical Offset</label>
                            <input
                                type="text"
                                inputMode="decimal"
                                pattern="-?[0-9]*[.]?[0-9]*"
                                value={verticalShiftInput}
                                onChange={handleVerticalShiftInputChange}
                                onBlur={handleVerticalShiftInputBlur}
                                onKeyDown={handleVerticalShiftKeyDown}
                                className="w-[34.5px] max-w-[34.5px] px-1 py-0.5 border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                            <input
                                type="range"
                                min={SHIFT_MIN}
                                max={SHIFT_MAX}
                                step="0.1"
                                value={verticalShift}
                                onChange={(e) => commitVerticalShift(Number(e.target.value))}
                                className="flex w-[inherit] h-1 bg-white/10 transition-all rounded-sm appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 animate-slider"
                                style={{
                                    transition: "all 0.3s ease-in-out",
                                    background: `linear-gradient(to right, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0.8) ${(verticalShift - SHIFT_MIN) / (SHIFT_MAX - SHIFT_MIN) * 100}%, rgba(255, 255, 255, 0.1) ${(verticalShift - SHIFT_MIN) / (SHIFT_MAX - SHIFT_MIN) * 100}%, rgba(255, 255, 255, 0.1) 100%)`
                                }}
                            />
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-2 mt-4">
                    {selectedModel.modelUrl && (
                        <button
                            onClick={handleDownload}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg transition-all hover:scale-[1.02] active:translate-y-0.5 hover:bg-white bg-white/90 text-[#0d0d0d] disabled:bg-gray-600/50 disabled:text-white/50 disabled:border-gray-500/30 disabled:cursor-not-allowed cursor-pointer"
                            title="Download Model"
                        >
                            <FaDownload /> Download
                        </button>
                    )}
                    {selectedModel.isCustom && (
                        <button
                            onClick={handleDelete}
                            className="flex items-center gap-1 px-2 py-1 text-xs hover:scale-[1.02] bg-[#0D0D0D]/80 active:translate-y-0.5 hover:bg-[#0D0D0D]/90 text-white rounded-lg transition-all cursor-pointer"
                            title="Delete Custom Model"
                        >
                            <FaTrash /> Delete
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
} 