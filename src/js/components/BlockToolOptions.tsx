import { useEffect, useState, useRef } from "react";
import { FaAngleUp } from "react-icons/fa";
import "../../css/BlockToolsOptions.css";
import "../../css/BlockToolsSidebar.css";
import AIAssistantPanel from "./AIAssistantPanel";
import BlockOptionsSection from "./BlockOptionsSection";
import ComponentOptionsSection from "./ComponentOptionsSection";
import DebugInfo from "./DebugInfo";
import GroundToolOptionsSection from "./GroundToolOptionsSection";
import StaircaseToolOptionsSection from "./StaircaseToolOptionsSection";
import ModelOptionsSection from "./ModelOptionsSection";
import SettingsMenu from "./SettingsMenu";
import WallToolOptionsSection from "./WallToolOptionsSection";
import SelectionToolOptionsSection from "./SelectionToolOptionsSection";
import TerrainToolOptionsSection from "./TerrainToolOptionsSection";
import ReplaceToolOptionsSection from "./ReplaceToolOptionsSection";
import FindReplaceToolOptionsSection from "./FindReplaceToolOptionsSection";
import SkyboxOptionsSection from "./SkyboxOptionsSection";
import LightingOptionsSection from "./LightingOptionsSection";
import EntityOptionsSection from "./EntityOptionsSection";
import ZoneToolOptionsSection from "./ZoneToolOptionsSection";
import ScreenshotGallerySection from "./ScreenshotGallerySection";

interface BlockToolOptionsProps {
    totalEnvironmentObjects: any;
    terrainBuilderRef: any;
    onResetCamera: () => void;
    onTakeScreenshot: () => Promise<void>;
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
    getAvailableEntities?: () => Promise<any[]> | any[];
    loadAISchematic: (schematic: any) => void;
    onConvertComponentToEntity?: (component: any) => Promise<void>;
    currentRotationIndex?: number;
    currentShapeType?: string;
}

interface CollapsibleSectionProps {
    title: string;
    children: React.ReactNode;
    animationDelay?: string;
    isOpen: boolean;
    onToggle: () => void;
}

function CollapsibleSection({ title, children, animationDelay = "0s", isOpen, onToggle }: CollapsibleSectionProps) {
    return (
        <div className="px-3">
            <button
                className="w-full flex items-center gap-2 rounded-md text-[#F1F1F1] text-xs transition-all cursor-pointer outline-none ring-0"
                onClick={onToggle}
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
    onTakeScreenshot,
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
        snapToGrid: true,
    },
    onPlacementSettingsChange = () => { },
    isCompactMode,
    onToggleCompactMode,
    showAIComponents,
    getAvailableBlocks,
    getAvailableEntities,
    loadAISchematic,
    onConvertComponentToEntity,
    currentRotationIndex,
    currentShapeType,
}: BlockToolOptionsProps) {
    const [activeTool, setActiveTool] = useState<string | null>(null);

    // Listen via ToolManager directly when available
    useEffect(() => {
        const manager = terrainBuilderRef?.current?.toolManagerRef?.current;
        if (!manager || typeof manager.addToolChangeListener !== "function") return;

        const listener = (toolName) => setActiveTool(toolName || null);
        manager.addToolChangeListener(listener);
        // Initialize current tool state immediately
        try {
            const current = manager.getActiveTool?.();
            if (current?.name) setActiveTool(current.name.toLowerCase());
        } catch (_) { }

        return () => {
            if (typeof manager.removeToolChangeListener === "function") {
                manager.removeToolChangeListener(listener);
            }
        };
    }, [terrainBuilderRef?.current?.toolManagerRef?.current]);

    // Fallback: global event dispatched by ToolManager
    useEffect(() => {
        const handler = (e: any) => {
            setActiveTool((e as CustomEvent).detail || null);
        };
        window.addEventListener("activeToolChanged", handler);
        return () => window.removeEventListener("activeToolChanged", handler);
    }, []);

    // Ref for Selection Tool section to enable auto-scroll
    const selectionToolSectionRef = useRef<HTMLDivElement>(null);

    // Accordion state: only one section open at a time
    const [openSection, setOpenSection] = useState<string | null>(null);

    const handleSectionToggle = (section: string) => {
        setOpenSection(prev => prev === section ? null : section);
    };

    // Auto-open tool sections when tool changes
    useEffect(() => {
        const toolToSection: Record<string, string> = {
            ground: "Ground Tool",
            wall: "Wall Tool",
            staircase: "Staircase Tool",
            selection: "Selection Tool",
            terrain: "Terrain Tool",
            replace: "Replace Tool",
            findreplace: "Find & Replace",
            zone: "Zone Tool",
        };
        if (activeTool && toolToSection[activeTool]) {
            setOpenSection(toolToSection[activeTool]);
        }
    }, [activeTool]);

    // Auto-open tab sections when tab/selection changes
    useEffect(() => {
        if (activeTab === 'blocks' && selectedBlock) setOpenSection("Block Options");
        else if (activeTab === 'models' && selectedBlock) setOpenSection("Model Options");
        else if (activeTab === 'components') setOpenSection("Component Options");
    }, [activeTab, selectedBlock]);

    // Auto-scroll to Selection Tool section when entity is selected
    useEffect(() => {
        const handleEntitySelected = () => {
            // Auto-open Entity Options section
            setOpenSection("Entity Options");

            // Only scroll if Selection Tool is active and section exists
            if (activeTool === "selection" && selectionToolSectionRef.current) {
                // Small delay to ensure DOM has updated
                setTimeout(() => {
                    selectionToolSectionRef.current?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                    });
                }, 100);
            }
        };

        window.addEventListener("entity-selected", handleEntitySelected);
        return () => window.removeEventListener("entity-selected", handleEntitySelected);
    }, [activeTool]);

    return (
        <div className="block-tool-options-container" style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            width: "100%",
        }}>
            <div
                onWheel={(e) => e.stopPropagation()}
                className="block-tools-options-sidebar transition-all ease-in-out duration-500 bg-[#0d0d0d]/70 backdrop-filter backdrop-blur-lg" style={{
                    padding: "12px 0px",
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                    width: isCompactMode ? "205px" : "295px",
                }}>
                {activeTab === 'blocks' && selectedBlock && (
                    <CollapsibleSection title="Block Options" isOpen={openSection === "Block Options"} onToggle={() => handleSectionToggle("Block Options")}>
                        <BlockOptionsSection
                            selectedBlock={selectedBlock}
                            onUpdateBlockName={onUpdateBlockName}
                            onDownloadBlock={onDownloadBlock}
                            onDeleteBlock={onDeleteBlock}
                            isCompactMode={isCompactMode}
                            currentRotationIndex={currentRotationIndex}
                            currentShapeType={currentShapeType}
                        />
                    </CollapsibleSection>
                )}
                {activeTab === 'models' && selectedBlock && (
                    <CollapsibleSection title="Model Options" isOpen={openSection === "Model Options"} onToggle={() => handleSectionToggle("Model Options")}>
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
                    <CollapsibleSection title="Component Options" isOpen={openSection === "Component Options"} onToggle={() => handleSectionToggle("Component Options")}>
                        <ComponentOptionsSection
                            selectedComponent={selectedBlock}
                            isCompactMode={isCompactMode}
                            onConvertToEntity={onConvertComponentToEntity}
                        />
                    </CollapsibleSection>
                )}

                <CollapsibleSection title="Skybox" isOpen={openSection === "Skybox"} onToggle={() => handleSectionToggle("Skybox")}>
                    <SkyboxOptionsSection
                        terrainBuilderRef={terrainBuilderRef}
                    />
                </CollapsibleSection>

                <CollapsibleSection title="Lighting" isOpen={openSection === "Lighting"} onToggle={() => handleSectionToggle("Lighting")}>
                    <LightingOptionsSection
                        terrainBuilderRef={terrainBuilderRef}
                    />
                </CollapsibleSection>

                {showAIComponents && (
                    <CollapsibleSection title="AI Assistant" isOpen={openSection === "AI Assistant"} onToggle={() => handleSectionToggle("AI Assistant")}>
                        <AIAssistantPanel
                            isVisible={true}
                            isEmbedded={true}
                            getAvailableBlocks={getAvailableBlocks}
                            getAvailableEntities={getAvailableEntities}
                            loadAISchematic={loadAISchematic}
                        />
                    </CollapsibleSection>
                )}
                {activeTool === "ground" && (
                    <CollapsibleSection title="Ground Tool" animationDelay="0.09s" isOpen={openSection === "Ground Tool"} onToggle={() => handleSectionToggle("Ground Tool")}>
                        <GroundToolOptionsSection
                            groundTool={terrainBuilderRef?.current?.toolManagerRef?.current?.tools?.["ground"]}
                            isCompactMode={isCompactMode}
                        />
                    </CollapsibleSection>
                )}
                {activeTool === "wall" && (
                    <CollapsibleSection title="Wall Tool" animationDelay="0.09s" isOpen={openSection === "Wall Tool"} onToggle={() => handleSectionToggle("Wall Tool")}>
                        <WallToolOptionsSection
                            wallTool={terrainBuilderRef?.current?.toolManagerRef?.current?.tools?.["wall"]}
                            isCompactMode={isCompactMode}
                        />
                    </CollapsibleSection>
                )}
                {activeTool === "staircase" && (
                    <CollapsibleSection title="Staircase Tool" animationDelay="0.09s" isOpen={openSection === "Staircase Tool"} onToggle={() => handleSectionToggle("Staircase Tool")}>
                        <StaircaseToolOptionsSection
                            staircaseTool={terrainBuilderRef?.current?.toolManagerRef?.current?.tools?.["staircase"]}
                            isCompactMode={isCompactMode}
                        />
                    </CollapsibleSection>
                )}
                {activeTool === "selection" && (
                    <>
                        <div ref={selectionToolSectionRef}>
                            <CollapsibleSection title="Selection Tool" animationDelay="0.09s" isOpen={openSection === "Selection Tool"} onToggle={() => handleSectionToggle("Selection Tool")}>
                                <SelectionToolOptionsSection
                                    selectionTool={terrainBuilderRef?.current?.toolManagerRef?.current?.tools?.["selection"]}
                                    isCompactMode={isCompactMode}
                                />
                            </CollapsibleSection>
                        </div>
                        {/* Entity Options - Only show when entity is selected */}
                        {terrainBuilderRef?.current?.toolManagerRef?.current?.tools?.["selection"]?.selectedEntity && (
                            <CollapsibleSection title="Entity Options" animationDelay="0.12s" isOpen={openSection === "Entity Options"} onToggle={() => handleSectionToggle("Entity Options")}>
                                <EntityOptionsSection
                                    selectedEntity={terrainBuilderRef?.current?.toolManagerRef?.current?.tools?.["selection"]?.selectedEntity}
                                    isCompactMode={isCompactMode}
                                />
                            </CollapsibleSection>
                        )}
                    </>
                )}
                {activeTool === "terrain" && (
                    <CollapsibleSection title="Terrain Tool" animationDelay="0.09s" isOpen={openSection === "Terrain Tool"} onToggle={() => handleSectionToggle("Terrain Tool")}>
                        <TerrainToolOptionsSection
                            terrainTool={terrainBuilderRef?.current?.toolManagerRef?.current?.tools?.["terrain"]}
                            isCompactMode={isCompactMode}
                        />
                    </CollapsibleSection>
                )}
                {activeTool === "replace" && (
                    <CollapsibleSection title="Replace Tool" animationDelay="0.09s" isOpen={openSection === "Replace Tool"} onToggle={() => handleSectionToggle("Replace Tool")}>
                        <ReplaceToolOptionsSection
                            replacementTool={terrainBuilderRef?.current?.toolManagerRef?.current?.tools?.["replace"]}
                            isCompactMode={isCompactMode}
                        />
                    </CollapsibleSection>
                )}
                {activeTool === "findreplace" && (
                    <CollapsibleSection title="Find & Replace" animationDelay="0.09s" isOpen={openSection === "Find & Replace"} onToggle={() => handleSectionToggle("Find & Replace")}>
                        <FindReplaceToolOptionsSection
                            findReplaceTool={terrainBuilderRef?.current?.toolManagerRef?.current?.tools?.["findreplace"]}
                            isCompactMode={isCompactMode}
                            getAvailableBlocks={getAvailableBlocks}
                            onRequestAIGeneration={() => {
                                // Trigger AI components panel to open
                                window.dispatchEvent(new CustomEvent("request-ai-component-generation"));
                            }}
                        />
                    </CollapsibleSection>
                )}
                {activeTool === "zone" && (
                    <CollapsibleSection title="Zone Tool" animationDelay="0.09s" isOpen={openSection === "Zone Tool"} onToggle={() => handleSectionToggle("Zone Tool")}>
                        <ZoneToolOptionsSection
                            zoneTool={terrainBuilderRef?.current?.toolManagerRef?.current?.tools?.["zone"]}
                            isCompactMode={isCompactMode}
                        />
                    </CollapsibleSection>
                )}
                <CollapsibleSection title="Screenshots" isOpen={openSection === "Screenshots"} onToggle={() => handleSectionToggle("Screenshots")}>
                    <ScreenshotGallerySection
                        isCompactMode={isCompactMode}
                        onTakeScreenshot={onTakeScreenshot}
                    />
                </CollapsibleSection>
                <CollapsibleSection title="Settings" isOpen={openSection === "Settings"} onToggle={() => handleSectionToggle("Settings")}>
                    <SettingsMenu
                        terrainBuilderRef={terrainBuilderRef}
                        onResetCamera={onResetCamera}
                        isCompactMode={isCompactMode}
                        onToggleCompactMode={onToggleCompactMode}
                    />
                </CollapsibleSection>
                <CollapsibleSection title="Debug" isOpen={openSection === "Debug"} onToggle={() => handleSectionToggle("Debug")}>
                    <DebugInfo
                        totalEnvironmentObjects={totalEnvironmentObjects}
                        terrainBuilderRef={terrainBuilderRef}
                    />
                </CollapsibleSection>
            </div>
        </div>
    );
}