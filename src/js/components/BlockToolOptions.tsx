import { useState } from "react";
import { FaAngleUp } from "react-icons/fa";
import "../../css/BlockToolsOptions.css";
import "../../css/BlockToolsSidebar.css";
import BlockOptionsSection from "./BlockOptionsSection";
import DebugInfo from "./DebugInfo";
import ModelOptionsSection from "./ModelOptionsSection";
import SettingsMenu from "./SettingsMenu";
import ComponentOptionsSection from "./ComponentOptionsSection";
import AIAssistantPanel from "./AIAssistantPanel";

interface BlockToolOptionsProps {
    totalEnvironmentObjects: any;
    terrainBuilderRef: any;
    onResetCamera: () => void;
    onToggleSidebar: () => void;
    onToggleOptions: () => void;
    onToggleToolbar: () => void;
    activeTab: string;
    selectedBlock: any | null;
    onUpdateBlockName: (blockId: number, newName: string) => Promise<void>;
    onDownloadBlock: (block: any) => void;
    onDeleteBlock: (block: any) => void;
    placementSettings?: any;
    onPlacementSettingsChange?: (settings: any) => void;
    isCompactMode: boolean;
    onToggleCompactMode: () => void;
    showAIComponents: boolean;
    getAvailableBlocks: () => Promise<any> | any;
    loadAISchematic: (schematic: any) => void;
}

interface CollapsibleSectionProps {
    title: string;
    children: React.ReactNode;
    animationDelay?: string;
}

function CollapsibleSection({ title, children, animationDelay = "0s" }: CollapsibleSectionProps) {
    const [isOpen, setIsOpen] = useState(true);

    return (
        <div className="px-3">
            <button
                className="w-full flex items-center gap-2 rounded-md text-[#F1F1F1] text-xs transition-all cursor-pointer outline-none ring-0"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className="text-[#F1F1F1]/50 whitespace-nowrap">{title}</span>
                <div className="border-b border-white/10 w-full ml-auto"></div>
                <FaAngleUp className={`ml-auto transition-transform min-w-fit ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="mt-3" style={{ animationDelay }}>
                    {children}
                </div>
            )}
        </div>
    );
}

export function BlockToolOptions({
    totalEnvironmentObjects,
    terrainBuilderRef,
    onResetCamera,
    onToggleSidebar,
    onToggleOptions,
    onToggleToolbar,
    activeTab,
    selectedBlock,
    onUpdateBlockName,
    onDownloadBlock,
    onDeleteBlock,
    placementSettings = {
        randomScale: false,
        randomRotation: false,
        minScale: 0.5,
        maxScale: 1.5,
        minRotation: 0,
        maxRotation: 360,
        scale: 1.0,
        rotation: 0,
    },
    onPlacementSettingsChange = () => { },
    isCompactMode,
    onToggleCompactMode,
    showAIComponents,
    getAvailableBlocks,
    loadAISchematic,
}: BlockToolOptionsProps) {
    return (
        <div className="block-tool-options-container" style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            width: "100%",
        }}>
            <div className="block-tools-options-sidebar transition-all ease-in-out duration-500 bg-[#0d0d0d]/70 backdrop-filter backdrop-blur-lg" style={{
                padding: "12px 0px",
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                width: isCompactMode ? "205px" : "295px",
            }}>
                {activeTab === 'blocks' && selectedBlock && (
                    <CollapsibleSection title="Block Options">
                        <BlockOptionsSection
                            selectedBlock={selectedBlock}
                            onUpdateBlockName={onUpdateBlockName}
                            onDownloadBlock={onDownloadBlock}
                            onDeleteBlock={onDeleteBlock}
                            isCompactMode={isCompactMode}
                        />
                    </CollapsibleSection>
                )}
                {activeTab === 'models' && selectedBlock && (
                    <CollapsibleSection title="Model Options">
                        <ModelOptionsSection
                            selectedModel={selectedBlock}
                            placementSettings={placementSettings}
                            onPlacementSettingsChange={onPlacementSettingsChange}
                            onDeleteModel={onDeleteBlock}
                            onDownloadModel={onDownloadBlock}
                            /* onUpdateModelName intentionally omitted for models to avoid irrelevant block rename errors */
                            environmentBuilder={terrainBuilderRef?.current?.environmentBuilderRef}
                            isCompactMode={isCompactMode}
                        />
                    </CollapsibleSection>
                )}
                {activeTab === 'components' && (
                    <CollapsibleSection title="Component Options">
                        <ComponentOptionsSection
                            selectedComponent={selectedBlock}
                            isCompactMode={isCompactMode}
                        />
                    </CollapsibleSection>
                )}

                {showAIComponents && (
                    <CollapsibleSection title="AI Assistant">
                        <AIAssistantPanel
                            isVisible={true}
                            isEmbedded={true}
                            getAvailableBlocks={getAvailableBlocks}
                            loadAISchematic={loadAISchematic}
                        />
                    </CollapsibleSection>
                )}

                <CollapsibleSection title="Settings">
                    <SettingsMenu
                        terrainBuilderRef={terrainBuilderRef}
                        onResetCamera={onResetCamera}
                        onToggleSidebar={onToggleSidebar}
                        onToggleOptions={onToggleOptions}
                        onToggleToolbar={onToggleToolbar}
                        isCompactMode={isCompactMode}
                        onToggleCompactMode={onToggleCompactMode}
                    />
                </CollapsibleSection>
                <CollapsibleSection title="Debug">
                    <DebugInfo
                        totalEnvironmentObjects={totalEnvironmentObjects}
                        terrainBuilderRef={terrainBuilderRef}
                    />
                </CollapsibleSection>
            </div>
        </div>
    );
}