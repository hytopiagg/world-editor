import { useState, useEffect, useRef } from "react";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";
import { generateSkyboxPreview } from "../utils/SkyboxPreviewRenderer";
import Tooltip from "./Tooltip";

interface SkyboxOptionsSectionProps {
    terrainBuilderRef: any;
}

export default function SkyboxOptionsSection({ terrainBuilderRef }: SkyboxOptionsSectionProps) {
    const [skyboxPreviews, setSkyboxPreviews] = useState<{ [key: string]: string | null }>({});
    const [selectedSkybox, setSelectedSkybox] = useState("partly-cloudy");
    const [generatingPreviews, setGeneratingPreviews] = useState(true);
    const [isChangingSkybox, setIsChangingSkybox] = useState(false);
    const [hasInitialized, setHasInitialized] = useState(false);

    // Track what skybox is currently applied to prevent unnecessary re-applications
    const lastAppliedSkyboxRef = useRef<string | null>(null);

    // Hardcoding for now, could be dynamic later
    const availableSkyboxes = ["partly-cloudy", "partly-cloudy-alt", "sunset", "night"];

    // Load saved skybox preference and set initial state
    useEffect(() => {
        const loadSavedSkybox = async () => {
            try {
                const savedSkybox = await DatabaseManager.getData(STORES.SETTINGS, `project:${DatabaseManager.getCurrentProjectId()}:selectedSkybox`);
                if (typeof savedSkybox === 'string' && availableSkyboxes.includes(savedSkybox)) {
                    setSelectedSkybox(savedSkybox);
                    // Track this as the "current" skybox without applying it (it should already be active)
                    lastAppliedSkyboxRef.current = savedSkybox;
                }
            } catch (error) {
                console.error("Error loading selected skybox:", error);
            } finally {
                // Mark as initialized regardless of success/failure
                setHasInitialized(true);
            }
        };

        loadSavedSkybox();
    }, []);

    // Listen for external skybox changes (e.g., from import)
    useEffect(() => {
        const handleExternalSkyboxChange = (event: CustomEvent) => {
            const { skyboxName } = event.detail;
            if (skyboxName && typeof skyboxName === 'string' && availableSkyboxes.includes(skyboxName)) {
                console.log("SkyboxOptionsSection: Received external skybox change:", skyboxName);
                setSelectedSkybox(skyboxName);
            }
        };

        window.addEventListener('skybox-changed', handleExternalSkyboxChange as EventListener);

        return () => {
            window.removeEventListener('skybox-changed', handleExternalSkyboxChange as EventListener);
        };
    }, [availableSkyboxes]); // Rerun if availableSkyboxes changes

    // Apply skybox to terrain builder when selectedSkybox changes (but not during initialization)
    useEffect(() => {
        // Only apply if we've finished initializing and this isn't the first load
        if (hasInitialized && terrainBuilderRef?.current?.changeSkybox && selectedSkybox) {
            // Check if this skybox is different from the last one we applied
            if (lastAppliedSkyboxRef.current !== selectedSkybox) {
                console.log("SkyboxOptionsSection: Applying new skybox:", selectedSkybox);
                terrainBuilderRef.current.changeSkybox(selectedSkybox);
                lastAppliedSkyboxRef.current = selectedSkybox;
            } else {
                console.log("SkyboxOptionsSection: Skybox", selectedSkybox, "already applied, skipping");
            }
        }
    }, [selectedSkybox, hasInitialized]);

    // Load cached previews and generate missing ones
    useEffect(() => {
        const loadAndGeneratePreviews = async () => {
            const previews: { [key: string]: string | null } = {};
            const previewsToGenerate: string[] = [];

            for (const skyboxName of availableSkyboxes) {
                try {
                    const cachedPreview = await DatabaseManager.getData(STORES.PREVIEWS, `skybox-${skyboxName}`);
                    if (cachedPreview && typeof cachedPreview === 'string') {
                        previews[skyboxName] = cachedPreview;
                    } else {
                        previews[skyboxName] = null; // Mark as needing generation
                        previewsToGenerate.push(skyboxName);
                    }
                } catch (error) {
                    console.warn(`Could not load cached preview for ${skyboxName}. Will regenerate.`, error);
                    previews[skyboxName] = null;
                    previewsToGenerate.push(skyboxName);
                }
            }
            setSkyboxPreviews(previews);
            setGeneratingPreviews(false); // Initial previews loaded/checked

            // Generate any missing previews in the background
            if (previewsToGenerate.length > 0) {
                for (const skyboxName of previewsToGenerate) {
                    try {
                        const preview = await generateSkyboxPreview(skyboxName, { width: 64, height: 64 });
                        setSkyboxPreviews(prev => ({ ...prev, [skyboxName]: preview }));
                        // Cache the newly generated preview
                        await DatabaseManager.saveData(STORES.PREVIEWS, `skybox-${skyboxName}`, preview);
                    } catch (error) {
                        console.error(`Failed to generate preview for ${skyboxName}`, error);
                        // No need to set to null again, it's already null
                    }
                }
            }
        };

        loadAndGeneratePreviews();
    }, []);

    const handleSkyboxChange = async (skyboxName: string) => {
        // Don't re-render if the same skybox is already selected or if a change is in progress
        if (selectedSkybox === skyboxName) {
            console.log(`Skybox "${skyboxName}" is already active, skipping change`);
            return;
        }

        if (isChangingSkybox) {
            console.log("Skybox change already in progress, skipping");
            return;
        }

        try {
            setIsChangingSkybox(true);
            // Update state first - the useEffect will handle applying the skybox
            setSelectedSkybox(skyboxName);
            await DatabaseManager.saveData(STORES.SETTINGS, `project:${DatabaseManager.getCurrentProjectId()}:selectedSkybox`, skyboxName);

            // Wait for transition to complete (300ms transition + small buffer)
            setTimeout(() => {
                setIsChangingSkybox(false);
            }, 400);
        } catch (error) {
            console.error("Error changing skybox:", error);
            setIsChangingSkybox(false);
        }
    };

    return (
        <div className="flex flex-wrap -mx-1">
            {availableSkyboxes.map((skybox) => (
                <div key={skybox} className="relative px-1 mb-2 w-1/2">
                    <Tooltip text={skybox.replace('-', ' ')}>
                        <button
                            aria-label={skybox.replace('-', ' ')}
                            onClick={() => handleSkyboxChange(skybox)}
                            className={`relative aspect-square border-2 rounded-lg overflow-hidden transition-all duration-200 hover:border-blue-400 ${selectedSkybox === skybox ? 'border-blue-500 ring-2 ring-blue-300' : 'border-gray-600'
                                } ${isChangingSkybox ? 'opacity-50 cursor-not-allowed' : ''}`}
                            disabled={isChangingSkybox}
                        >
                            {skyboxPreviews[skybox] ? (
                                <>
                                    <img
                                        src={skyboxPreviews[skybox]}
                                        alt={skybox}
                                        className="object-cover w-full h-full"
                                    />
                                    {isChangingSkybox && selectedSkybox === skybox && (
                                        <div className="flex absolute inset-0 justify-center items-center bg-black bg-opacity-50">
                                            <div className="w-6 h-6 rounded-full border-2 animate-spin border-white/30 border-t-white"></div>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="flex justify-center items-center w-full h-full bg-gray-700">
                                    <div className="w-8 h-8 rounded-full border-4 animate-spin border-white/30 border-t-white/80"></div>
                                </div>
                            )}
                        </button>
                    </Tooltip>
                </div>
            ))}
        </div>
    );
} 