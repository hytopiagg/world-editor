import { useState } from "react";
import { FaRedo, FaVolumeMute, FaVolumeUp } from "react-icons/fa";
import { isMuted, toggleMute } from "../Sound";

interface SettingsMenuProps {
    terrainBuilderRef: any;
    onResetCamera: () => void;
    onToggleSidebar: () => void;
    onToggleOptions: () => void;
    onToggleToolbar: () => void;
}

export default function SettingsMenu({ terrainBuilderRef, onResetCamera, onToggleSidebar, onToggleOptions, onToggleToolbar }: SettingsMenuProps) {
    const [viewDistance, setViewDistance] = useState(128);
    const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
    const [showSidebar, setShowSidebar] = useState(true);
    const [showOptions, setShowOptions] = useState(true);
    const [showToolbar, setShowToolbar] = useState(true);

    const handleViewDistanceChange = (value: number) => {
        setViewDistance(value);
        if (terrainBuilderRef?.current?.setViewDistance) {
            terrainBuilderRef.current.setViewDistance(value);
        }
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
                    <div className="flex items-center justify-between text-xs text-[#F1F1F1] cursor-pointer fade-down opacity-0 duration-150" style={{
                        animationDelay: "0.1s"
                    }}>
                        <span>Reset Camera</span>
                        <button onClick={onResetCamera} className="flex items-center justify-center cursor-pointer hover:bg-white/15 border border-white/10 hover:border-white/20 rounded-md transition-all">
                            <FaRedo />
                        </button>
                    </div>
                    <div className="flex items-center justify-between text-xs text-[#F1F1F1] cursor-pointer fade-down opacity-0 duration-150" style={{
                        animationDelay: "0.125s"
                    }}>
                        <span>Toggle Sound</span>
                        <button onClick={toggleMute} className="flex items-center justify-center cursor-pointer hover:bg-white/15 border border-white/10 hover:border-white/20 rounded-md transition-all">
                            {isMuted ? <FaVolumeMute /> : <FaVolumeUp />}
                        </button>
                    </div>
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-x-2 w-full cursor-pointer fade-down opacity-0 duration-150" style={{
                            animationDelay: "0.15s"
                        }}>
                            <label className="text-xs text-[#F1F1F1] whitespace-nowrap">View Distance</label>
                            <input
                                type="number"
                                value={viewDistance}
                                onChange={(e) => handleViewDistanceChange(Number(e.target.value))}
                                onBlur={(e) => handleViewDistanceChange(Math.max(32, Math.min(256, Number(e.target.value))))}
                                onKeyDown={(e: any) => {
                                    if (e.key === 'Enter') {
                                        handleViewDistanceChange(Math.max(32, Math.min(256, Number(e.target.value))));
                                        e.target.blur();
                                    }
                                }}
                                min={32}
                                max={256}
                                step={16}
                                className="w-[34.5px] px-1 py-0.5  border border-white/10 hover:border-white/20 focus:border-white rounded text-[#F1F1F1] text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
                </div>
            </div>
        </div>
    );
}