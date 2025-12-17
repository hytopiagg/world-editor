import { useState, useEffect } from "react";
import { FaRedo, FaVolumeMute, FaVolumeUp } from "react-icons/fa";
import { isMuted, toggleMute } from "../Sound";
import { cameraManager } from "../Camera";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";
import QuickTipsManager from "./QuickTipsManager";

interface SettingsMenuProps {
    terrainBuilderRef: any;
    onResetCamera: () => void;
    onToggleSidebar: () => void;
    onToggleOptions: () => void;
    onToggleToolbar: () => void;
    isCompactMode: boolean;
    onToggleCompactMode: () => void;
}

export default function SettingsMenu({ terrainBuilderRef, onResetCamera, onToggleSidebar, onToggleOptions, onToggleToolbar, isCompactMode, onToggleCompactMode }: SettingsMenuProps) {
    const maxMoveSpeed = 5;
    const [loadedDefaults, setLoadedDefaults] = useState(false);
    const [viewDistance, setViewDistance] = useState(256);

    const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
    const [showSidebar, setShowSidebar] = useState(true);
    const [showOptions, setShowOptions] = useState(true);
    const [showToolbar, setShowToolbar] = useState(true);
    const [cameraSensitivity, setCameraSensitivity] = useState(5);
    const [moveSpeed, setMoveSpeed] = useState(0.2);
    const [lowResDrag, setLowResDrag] = useState(false);
    const [showGrid, setShowGrid] = useState(true);
    const [baseGridY, setBaseGridY] = useState(0);
    const [isPointerUnlockedMode, setIsPointerUnlockedMode] = useState(!cameraManager.isPointerUnlockedMode);

    // Load saved sensitivity on mount
    useEffect(() => {
        (async () => {
            try {
                const saved = await DatabaseManager.getData(STORES.SETTINGS, "cameraSensitivity");
                if (typeof saved === "number") {
                    setCameraSensitivity(saved);
                    cameraManager.setPointerSensitivity(saved);
                }
                // Ensure pointer mode matches persisted value (in case App hasn't already)
                try {
                    const savedPointerMode = await DatabaseManager.getData(STORES.SETTINGS, "pointerLockMode");
                    if (typeof savedPointerMode === "boolean") {
                        cameraManager.isPointerUnlockedMode = savedPointerMode;
                        setIsPointerUnlockedMode(savedPointerMode);
                    }
                } catch (error) {
                    console.error("Error loading pointer lock mode:", error);
                }

                // >>> Load saved movement speed
                try {
                    const savedMoveSpeed = await DatabaseManager.getData(STORES.SETTINGS, "cameraMoveSpeed");
                    if (typeof savedMoveSpeed === "number") {
                        setMoveSpeed(savedMoveSpeed);
                        cameraManager.setMoveSpeed(savedMoveSpeed);
                    }
                } catch (error) {
                    console.error("Error loading camera move speed:", error);
                }

                // >>> Load saved view distance
                try {
                    const savedViewDistance = await DatabaseManager.getData(STORES.SETTINGS, "viewDistance");
                    if (typeof savedViewDistance === "number") {
                        setViewDistance(savedViewDistance);
                        if (terrainBuilderRef?.current?.setViewDistance) {
                            terrainBuilderRef.current.setViewDistance(savedViewDistance);
                        }
                    }
                } catch (error) {
                    console.error("Error loading view distance:", error);
                }

                // Load low-res sculpt flag
                try {
                    const savedLowRes = await DatabaseManager.getData(STORES.SETTINGS, "lowResDrag");
                    if (typeof savedLowRes === "boolean") {
                        setLowResDrag(savedLowRes);
                        // Expose globally for runtime checks
                        if (typeof window !== "undefined") {
                            (window as any).lowResDragEnabled = savedLowRes;
                        }
                    }
                } catch (err) {
                    console.error("Error loading lowResDrag", err);
                }

                // Floor grid now always defaults to visible; no DB persistence.
                if (terrainBuilderRef?.current?.setGridVisible) {
                    terrainBuilderRef.current.setGridVisible(true);
                }

                // Load saved base grid Y position
                try {
                    const savedBaseGridY = await DatabaseManager.getData(STORES.SETTINGS, "baseGridY");
                    if (typeof savedBaseGridY === "number") {
                        setBaseGridY(savedBaseGridY);
                        if (terrainBuilderRef?.current?.setGridY) {
                            terrainBuilderRef.current.setGridY(savedBaseGridY);
                        }
                    }
                } catch (error) {
                    console.error("Error loading base grid Y:", error);
                }

            } catch (error) {
                console.error("Error loading camera sensitivity:", error);
            }
        })();
    }, []);

    useEffect(() => {
        if (terrainBuilderRef?.current?.setViewDistance && !loadedDefaults) {
            setLoadedDefaults(true);
            terrainBuilderRef.current.setViewDistance(viewDistance);
        }
    }, [terrainBuilderRef?.current, viewDistance]);

    // Sync state if user toggles camera mode via keyboard ('0')
    useEffect(() => {
        const keyListener = (e: KeyboardEvent) => {
            if (e.key === "0") {
                // Defer update to allow CameraManager to process toggle first
                requestAnimationFrame(() => {
                    setIsPointerUnlockedMode(cameraManager.isPointerUnlockedMode);
                });
            }
        };
        window.addEventListener("keydown", keyListener);
        return () => window.removeEventListener("keydown", keyListener);
    }, []);

    const handleViewDistanceChange = async (value: number) => {
        setViewDistance(value);
        if (terrainBuilderRef?.current?.setViewDistance) {
            terrainBuilderRef.current.setViewDistance(value);
        }
        await DatabaseManager.saveData(STORES.SETTINGS, "viewDistance", value);
    };

    const handleAutoSaveToggle = (checked: boolean) => {
        setAutoSaveEnabled(checked);
        if (terrainBuilderRef?.current?.toggleAutoSave) {
            terrainBuilderRef.current.toggleAutoSave(checked);
        }
    };

    const handleSidebarToggle = () => {
        setShowSidebar(!showSidebar);
        onToggleSidebar();
    };

    const handleOptionsToggle = () => {
        setShowOptions(!showOptions);
        onToggleOptions();
    };

    const handleToolbarToggle = () => {
        setShowToolbar(!showToolbar);
        onToggleToolbar();
    };

    const handlePointerModeToggle = async () => {
        const newValue = !isPointerUnlockedMode;
        setIsPointerUnlockedMode(newValue);
        cameraManager.isPointerUnlockedMode = newValue;

        // If switching to Rotate mode (unlocked), exit any existing pointer lock
        if (newValue && cameraManager.isPointerLocked && document.exitPointerLock) {
            document.exitPointerLock();
        }

        const modeText = newValue ? "Rotate" : "Crosshair";
        QuickTipsManager.setToolTip(`Camera Mode: ${modeText}`);

        try {
            await DatabaseManager.saveData(STORES.SETTINGS, "pointerLockMode", newValue);
        } catch (error) {
            console.error("Error saving pointer lock mode:", error);
        }
    };

    const handleSensitivityChange = async (value: number) => {
        const clamped = Math.max(1, Math.min(10, value));
        setCameraSensitivity(clamped);
        cameraManager.setPointerSensitivity(clamped);
        await DatabaseManager.saveData(STORES.SETTINGS, "cameraSensitivity", clamped);
    };

    const handleMoveSpeedChange = async (value: number) => {
        const clamped = Math.max(0.05, Math.min(2.5, value));
        setMoveSpeed(clamped);
        cameraManager.setMoveSpeed(clamped);
        try {
            await DatabaseManager.saveData(STORES.SETTINGS, "cameraMoveSpeed", clamped);
        } catch (error) {
            console.error("Error saving camera move speed:", error);
        }
    };

    const handleLowResToggle = async (checked: boolean) => {
        setLowResDrag(checked);
        if (typeof window !== "undefined") {
            (window as any).lowResDragEnabled = checked;
        }
        try {
            await DatabaseManager.saveData(STORES.SETTINGS, "lowResDrag", checked);
        } catch (err) { console.error("saving lowResDrag", err); }
    };

    const handleGridToggle = (checked: boolean) => {
        setShowGrid(checked);
        if (terrainBuilderRef?.current?.setGridVisible) {
            terrainBuilderRef.current.setGridVisible(checked);
        }
    };

    const handleBaseGridYChange = async (value: number) => {
        setBaseGridY(value);
        if (terrainBuilderRef?.current?.setGridY) {
            terrainBuilderRef.current.setGridY(value);
        }
        try {
            await DatabaseManager.saveData(STORES.SETTINGS, "baseGridY", value);
        } catch (error) {
            console.error("Error saving base grid Y:", error);
        }
    };

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
                <div className="flex flex-col gap-1"
                >
                    <label className="flex items-center justify-between text-xs text-[#F1F1F1] h-4 cursor-pointer fade-down opacity-0 duration-150" style={{
                        animationDelay: "0.025s"
                    }}>
                        <span>Auto-Save (5 min)</span>
                        <input
                            type="checkbox"
                            checked={autoSaveEnabled}
                            onChange={(e) => handleAutoSaveToggle(e.target.checked)}
                            className="w-4 h-4 rounded bg-white/10 border-white/10 checked:bg-blue-500 checked:border-blue-500"
                        />
                    </label>
                    <label className="flex items-center justify-between text-xs text-[#F1F1F1] cursor-pointer fade-down opacity-0 duration-150" style={{
                        animationDelay: "0.05s"
                    }}>
                        <span>Block Sidebar</span>
                        <input
                            type="checkbox"
                            checked={showSidebar}
                            onChange={handleSidebarToggle}
                            className="w-4 h-4 rounded bg-white/10 border-white/10 checked:bg-blue-500 checked:border-blue-500"
                        />
                    </label>
                    <label className="flex items-center justify-between text-xs text-[#F1F1F1] cursor-pointer fade-down opacity-0 duration-150" style={{
                        animationDelay: "0.05s"
                    }}>
                        <span>Options Panel</span>
                        <input
                            type="checkbox"
                            checked={showOptions}
                            onChange={handleOptionsToggle}
                            className="w-4 h-4 rounded bg-white/10 border-white/10 checked:bg-blue-500 checked:border-blue-500"
                        />
                    </label>
                    <label className="flex items-center justify-between text-xs text-[#F1F1F1] cursor-pointer fade-down opacity-0 duration-150" style={{
                        animationDelay: "0.075s"
                    }}>
                        <span>Toolbar</span>
                        <input
                            type="checkbox"
                            checked={showToolbar}
                            onChange={handleToolbarToggle}
                            className="w-4 h-4 rounded bg-white/10 border-white/10 checked:bg-blue-500 checked:border-blue-500"
                        />
                    </label>
                    <label className="flex items-center justify-between text-xs text-[#F1F1F1] cursor-pointer fade-down opacity-0 duration-150" style={{
                        animationDelay: "0.087s"
                    }}>
                        <span>Compact Sidebar</span>
                        <input
                            type="checkbox"
                            checked={isCompactMode}
                            onChange={onToggleCompactMode}
                            className="w-4 h-4 rounded bg-white/10 border-white/10 checked:bg-blue-500 checked:border-blue-500"
                        />
                    </label>
                    <label className="flex items-center justify-between text-xs text-[#F1F1F1] cursor-pointer fade-down opacity-0 duration-150" style={{
                        animationDelay: "0.095s"
                    }}>
                        <span>Crosshair Mode</span>
                        <input
                            type="checkbox"
                            checked={!isPointerUnlockedMode}
                            onChange={handlePointerModeToggle}
                            className="w-4 h-4 rounded bg-white/10 border-white/10 checked:bg-blue-500 checked:border-blue-500"
                        />
                    </label>
                    <label className="flex items-center justify-between text-xs text-[#F1F1F1] cursor-pointer fade-down opacity-0 duration-150" style={{
                        animationDelay: "0.11s"
                    }}>
                        <span>Low-Res Sculpt</span>
                        <input
                            type="checkbox"
                            checked={lowResDrag}
                            onChange={(e) => handleLowResToggle(e.target.checked)}
                            className="w-4 h-4 rounded bg-white/10 border-white/10 checked:bg-blue-500 checked:border-blue-500"
                        />
                    </label>
                    <label className="flex items-center justify-between text-xs text-[#F1F1F1] cursor-pointer fade-down opacity-0 duration-150" style={{
                        animationDelay: "0.115s"
                    }}>
                        <span>Floor Grid</span>
                        <input
                            type="checkbox"
                            checked={showGrid}
                            onChange={(e) => handleGridToggle(e.target.checked)}
                            className="w-4 h-4 rounded bg-white/10 border-white/10 checked:bg-blue-500 checked:border-blue-500"
                        />
                    </label>
                    <div className="flex items-center justify-between text-xs text-[#F1F1F1] cursor-pointer fade-down opacity-0 duration-150" style={{
                        animationDelay: "0.1s"
                    }}>
                        <span>Reset Camera</span>
                        <button onClick={onResetCamera} className="flex justify-center items-center rounded-md border transition-all cursor-pointer hover:bg-white/15 border-white/10 hover:border-white/20">
                            <FaRedo />
                        </button>
                    </div>
                    <div className="flex items-center justify-between text-xs text-[#F1F1F1] cursor-pointer fade-down opacity-0 duration-150" style={{
                        animationDelay: "0.125s"
                    }}>
                        <span>Toggle Sound</span>
                        <button onClick={toggleMute} className="flex justify-center items-center rounded-md border transition-all cursor-pointer hover:bg-white/15 border-white/10 hover:border-white/20">
                            {isMuted ? <FaVolumeMute /> : <FaVolumeUp />}
                        </button>
                    </div>
                    <div className="flex flex-col gap-1">
                        <div className="flex gap-x-2 items-center w-full opacity-0 duration-150 cursor-pointer fade-down" style={{
                            animationDelay: "0.15s"
                        }}>
                            <label className="text-xs text-[#F1F1F1] whitespace-nowrap">View Distance</label>
                            <input
                                type="number"
                                value={viewDistance}
                                onChange={(e) => handleViewDistanceChange(Number(e.target.value))}
                                onBlur={(e) => handleViewDistanceChange(Math.max(32, Math.min(256, Number(e.target.value))))}
                                onKeyDown={(e: any) => {
                                    e.stopPropagation();
                                    if (e.key === 'Enter') {
                                        handleViewDistanceChange(Math.max(32, Math.min(256, Number(e.target.value))));
                                        e.target.blur();
                                    }
                                }}
                                min={32}
                                max={256}
                                step={16}
                                className="w-[34.5px] px-1 py-0.5 bg-white/10 border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                            <input
                                type="range"
                                min="32"
                                max="256"
                                step="16"
                                value={viewDistance}
                                onChange={(e) => handleViewDistanceChange(Number(e.target.value))}
                                className="flex w-[inherit] h-1 bg-white/10 transition-all rounded-sm appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 animate-slider"
                                style={{
                                    transition: "all 0.3s ease-in-out",
                                    background: `linear-gradient(to right, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0.8) ${(viewDistance - 32) / (256 - 32) * 100}%, rgba(255, 255, 255, 0.1) ${(viewDistance - 32) / (256 - 32) * 100}%, rgba(255, 255, 255, 0.1) 100%)`
                                }}
                            />

                        </div>
                    </div>
                    <div className="flex flex-col gap-1">
                        <div className="flex gap-x-2 items-center w-full opacity-0 duration-150 cursor-pointer fade-down" style={{
                            animationDelay: "0.14s"
                        }}>
                            <label className="text-xs text-[#F1F1F1] whitespace-nowrap">Base Grid Y</label>
                            <input
                                type="number"
                                value={baseGridY}
                                onChange={(e) => handleBaseGridYChange(Number(e.target.value))}
                                onBlur={(e) => handleBaseGridYChange(Number(e.target.value))}
                                onKeyDown={(e: any) => {
                                    e.stopPropagation();
                                    if (e.key === 'Enter') {
                                        handleBaseGridYChange(Number(e.target.value));
                                        e.target.blur();
                                    }
                                }}
                                min={-100}
                                max={100}
                                step={1}
                                className="w-[50px] px-1 py-0.5 bg-white/10 border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                            <input
                                type="range"
                                min="-100"
                                max="100"
                                step="1"
                                value={baseGridY}
                                onChange={(e) => handleBaseGridYChange(Number(e.target.value))}
                                className="flex w-[inherit] h-1 bg-white/10 transition-all rounded-sm appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 animate-slider"
                                style={{
                                    transition: "all 0.3s ease-in-out",
                                    background: `linear-gradient(to right, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0.8) ${(baseGridY + 100) / 200 * 100}%, rgba(255, 255, 255, 0.1) ${(baseGridY + 100) / 200 * 100}%, rgba(255, 255, 255, 0.1) 100%)`
                                }}
                            />
                        </div>
                    </div>

                    {/* Camera sensitivity visible only when pointer-lock capable (Glide mode) */}
                    {!isPointerUnlockedMode && (
                        <div className="flex gap-x-2 items-center w-full opacity-0 duration-150 cursor-pointer fade-down" style={{ animationDelay: "0.17s" }}>
                            <label className="text-xs text-[#F1F1F1] whitespace-nowrap">Sensitivity</label>
                            <input
                                type="number"
                                value={cameraSensitivity}
                                onKeyDown={(e) => e.stopPropagation()}
                                onChange={(e) => handleSensitivityChange(parseInt(e.target.value))}
                                onBlur={(e) => handleSensitivityChange(Math.max(1, Math.min(10, parseInt(e.target.value))))}
                                className="w-[34.5px] px-1 py-0.5 bg-white/10 border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                min={1}
                                max={10}
                                step={1}
                            />
                            <input
                                type="range"
                                min={1}
                                max={10}
                                step={1}
                                value={cameraSensitivity}
                                onChange={(e) => handleSensitivityChange(parseInt(e.target.value))}
                                className="flex w-[inherit] h-1 bg-white/10 transition-all rounded-sm appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 animate-slider"
                            />
                            <span className="text-xs text-[#F1F1F1] w-4 text-center">{cameraSensitivity}</span>
                        </div>
                    )}
                    {/* Camera movement speed */}
                    <div className="flex flex-col gap-1">
                        <div className="flex gap-x-2 items-center w-full opacity-0 duration-150 cursor-pointer fade-down" style={{ animationDelay: "0.16s" }}>
                            <label className="text-xs text-[#F1F1F1] whitespace-nowrap">Move Speed</label>
                            <input
                                type="number"
                                value={moveSpeed.toFixed(2)}
                                onChange={(e) => handleMoveSpeedChange(Number(e.target.value))}
                                onBlur={(e) => handleMoveSpeedChange(Math.max(0.05, Math.min(maxMoveSpeed, Number(e.target.value))))}
                                onKeyDown={(e: any) => {
                                    e.stopPropagation();
                                    if (e.key === 'Enter') {
                                        handleMoveSpeedChange(Math.max(0.05, Math.min(maxMoveSpeed, Number(e.target.value))));
                                        e.target.blur();
                                    }
                                }}
                                min={0.05}
                                max={maxMoveSpeed}
                                step={0.05}
                                className="w-[50px] px-1 py-0.5 bg-white/10  border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin_button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                            <input
                                type="range"
                                min={0.05}
                                max={maxMoveSpeed}
                                step={0.05}
                                value={moveSpeed}
                                onChange={(e) => handleMoveSpeedChange(Number(e.target.value))}
                                className="flex w-[inherit] h-1 bg-white/10 transition-all rounded-sm appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 animate-slider"
                                style={{
                                    transition: "all 0.3s ease-in-out",
                                    background: `linear-gradient(to right, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0.8) ${(moveSpeed - 0.05) / (maxMoveSpeed - 0.05) * 100}%, rgba(255, 255, 255, 0.1) ${(moveSpeed - 0.05) / (maxMoveSpeed - 0.05) * 100}%, rgba(255, 255, 255, 0.1) 100%)`
                                }}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}