import "../../css/BlockToolsOptions.css";
import "../../css/BlockToolsSidebar.css";
import DebugInfo from "./DebugInfo";
import { FaAngleDown, FaAngleUp, FaCamera, FaCog, FaRedo, FaVolumeMute, FaVolumeUp } from "react-icons/fa";
import { useState } from "react";
import { isMuted, toggleMute } from "../Sound";

interface SettingsMenuProps {
    terrainBuilderRef: any;
    onResetCamera: () => void;
    onToggleSidebar: () => void;
    onToggleOptions: () => void;
    onToggleToolbar: () => void;
}

interface BlockToolOptionsProps {
    debugInfo: any;
    totalBlocks: any;
    totalEnvironmentObjects: any;
    terrainBuilderRef: any;
    onResetCamera: () => void;
    onToggleSidebar: () => void;
    onToggleOptions: () => void;
    onToggleToolbar: () => void;
}

function SettingsMenu({ terrainBuilderRef, onResetCamera, onToggleSidebar, onToggleOptions, onToggleToolbar }: SettingsMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
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
        <div className="px-3">
            <button
                className="w-full flex items-center gap-2 rounded-md text-white text-xs transition-all cursor-pointer outline-none ring-0"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className="text-white/50">Settings</span>
                <div className="border-b border-white/10 w-full ml-auto"></div>
                <FaAngleUp className={`ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="mt-3 flex flex-col gap-5">
                    <div className="flex flex-col gap-1">
                        <div className="flex flex-col gap-1">
                            <label className="flex items-center justify-between text-xs text-white">
                                <span>Auto-Save (5 min)</span>
                                <input
                                    type="checkbox"
                                    checked={autoSaveEnabled}
                                    onChange={(e) => handleAutoSaveToggle(e.target.checked)}
                                    className="w-4 h-4 rounded bg-white/10 border-white/10 checked:bg-blue-500 checked:border-blue-500"
                                />
                            </label>
                            <label className="flex items-center justify-between text-xs text-white">
                                <span>Block Sidebar</span>
                                <input
                                    type="checkbox"
                                    checked={showSidebar}
                                    onChange={handleSidebarToggle}
                                    className="w-4 h-4 rounded bg-white/10 border-white/10 checked:bg-blue-500 checked:border-blue-500"
                                />
                            </label>
                            <label className="flex items-center justify-between text-xs text-white">
                                <span>Options Panel</span>
                                <input
                                    type="checkbox"
                                    checked={showOptions}
                                    onChange={handleOptionsToggle}
                                    className="w-4 h-4 rounded bg-white/10 border-white/10 checked:bg-blue-500 checked:border-blue-500"
                                />
                            </label>
                            <label className="flex items-center justify-between text-xs text-white">
                                <span>Toolbar</span>
                                <input
                                    type="checkbox"
                                    checked={showToolbar}
                                    onChange={handleToolbarToggle}
                                    className="w-4 h-4 rounded bg-white/10 border-white/10 checked:bg-blue-500 checked:border-blue-500"
                                />
                            </label>
                            <div className="flex items-center justify-between text-xs text-white">
                                <span>Reset Camera</span>
                                <button onClick={onResetCamera} className="flex items-center justify-center cursor-pointer hover:bg-white/15 border border-white/10 hover:border-white/20 rounded-md transition-all">
                                    <FaRedo />
                                </button>
                            </div>
                            <div className="flex items-center justify-between text-xs text-white">
                                <span>Toggle Sound</span>
                                <button onClick={toggleMute} className="flex items-center justify-center cursor-pointer hover:bg-white/15 border border-white/10 hover:border-white/20 rounded-md transition-all">
                                    {isMuted ? <FaVolumeMute /> : <FaVolumeUp />}
                                </button>
                            </div>
                            <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-x-2 w-full">
                                    <label className="text-xs text-white whitespace-nowrap">View Distance</label>
                                    <input
                                        type="number"
                                        value={viewDistance}
                                        onChange={(e) => handleViewDistanceChange(Number(e.target.value))}
                                        onBlur={(e) => handleViewDistanceChange(Math.max(32, Math.min(256, Number(e.target.value))))}
                                        min={32}
                                        max={256}
                                        step={16}
                                        className="w-16 px-1 py-1 bg-white/10 border border-white/10 focus:border-white/20 focus:bg-white/15 rounded text-white text-xs text-center outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                    />
                                    <input
                                        type="range"
                                        min="32"
                                        max="256"
                                        step="16"
                                        value={viewDistance}
                                        onChange={(e) => handleViewDistanceChange(Number(e.target.value))}
                                        className="flex w-auto h-1 bg-white/10 transition-all rounded-sm appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 animate-slider"
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
            )}
        </div>
    );
}

export function BlockToolOptions({
    debugInfo,
    totalBlocks,
    totalEnvironmentObjects,
    terrainBuilderRef,
    onResetCamera,
    onToggleSidebar,
    onToggleOptions,
    onToggleToolbar,
}: BlockToolOptionsProps) {
    return (
        <div className="block-tool-options-container" style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            width: "100%",
        }}>
            <div className="block-tools-options-sidebar" style={{
                padding: "12px 0px",
            }}>
                <DebugInfo
                    debugInfo={debugInfo}
                    totalBlocks={totalBlocks}
                    totalEnvironmentObjects={totalEnvironmentObjects}
                    terrainBuilderRef={terrainBuilderRef}
                />
                <SettingsMenu
                    terrainBuilderRef={terrainBuilderRef}
                    onResetCamera={onResetCamera}
                    onToggleSidebar={onToggleSidebar}
                    onToggleOptions={onToggleOptions}
                    onToggleToolbar={onToggleToolbar}
                />
            </div>
        </div>
    );
}