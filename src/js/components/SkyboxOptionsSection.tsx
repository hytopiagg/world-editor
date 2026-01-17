import { useState, useEffect, useRef } from "react";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";
import { generateSkyboxPreview } from "../utils/SkyboxPreviewRenderer";
import { DEFAULT_SKYBOXES } from "../ImportExport";
import Tooltip from "./Tooltip";
import SkyboxUploadModal, { CustomSkybox } from "./SkyboxUploadModal";

interface SkyboxOptionsSectionProps {
    terrainBuilderRef: any;
}

interface SkyboxItem {
    name: string;
    isCustom: boolean;
}

export default function SkyboxOptionsSection({ terrainBuilderRef }: SkyboxOptionsSectionProps) {
    const [skyboxPreviews, setSkyboxPreviews] = useState<{ [key: string]: string | null }>({});
    const [selectedSkybox, setSelectedSkybox] = useState("partly-cloudy");
    const [generatingPreviews, setGeneratingPreviews] = useState(true);
    const [isChangingSkybox, setIsChangingSkybox] = useState(false);
    const [hasInitialized, setHasInitialized] = useState(false);
    const [customSkyboxes, setCustomSkyboxes] = useState<CustomSkybox[]>([]);
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

    // Track what skybox is currently applied to prevent unnecessary re-applications
    const lastAppliedSkyboxRef = useRef<string | null>(null);

    // Hardcoding for now, could be dynamic later
    const availableSkyboxes = DEFAULT_SKYBOXES;

    // Combine default and custom skyboxes
    const allSkyboxes: SkyboxItem[] = [
        ...availableSkyboxes.map(name => ({ name, isCustom: false })),
        ...customSkyboxes.map(s => ({ name: s.name, isCustom: true }))
    ];

    const allSkyboxNames = allSkyboxes.map(s => s.name);

    // Load saved skybox preference and custom skyboxes on mount
    useEffect(() => {
        const loadSavedData = async () => {
            try {
                // Load custom skyboxes (global storage)
                const savedCustomSkyboxes = await DatabaseManager.getData(STORES.SETTINGS, 'customSkyboxes');
                if (Array.isArray(savedCustomSkyboxes)) {
                    setCustomSkyboxes(savedCustomSkyboxes);
                    // Set previews for custom skyboxes
                    const customPreviews: { [key: string]: string | null } = {};
                    savedCustomSkyboxes.forEach((s: CustomSkybox) => {
                        if (s.previewDataUrl) {
                            customPreviews[s.name] = s.previewDataUrl;
                        }
                    });
                    setSkyboxPreviews(prev => ({ ...prev, ...customPreviews }));
                }

                // Load selected skybox (project-scoped)
                const savedSkybox = await DatabaseManager.getData(STORES.SETTINGS, `project:${DatabaseManager.getCurrentProjectId()}:selectedSkybox`);

                // Check if saved skybox exists in available skyboxes (including custom ones)
                const customSkyboxList = (savedCustomSkyboxes || []) as CustomSkybox[];
                const validSkyboxes = [...availableSkyboxes, ...customSkyboxList.map((s: CustomSkybox) => s.name)];
                if (typeof savedSkybox === 'string' && validSkyboxes.includes(savedSkybox)) {
                    setSelectedSkybox(savedSkybox);
                    // Track this as the "current" skybox without applying it (it should already be active)
                    lastAppliedSkyboxRef.current = savedSkybox;
                }
            } catch (error) {
                console.error("Error loading saved skybox data:", error);
            } finally {
                // Mark as initialized regardless of success/failure
                setHasInitialized(true);
            }
        };

        loadSavedData();
    }, []);

    // Listen for external skybox changes (e.g., from import)
    useEffect(() => {
        const handleExternalSkyboxChange = (event: CustomEvent) => {
            const { skyboxName } = event.detail;
            if (skyboxName && typeof skyboxName === 'string') {
                // Check if it's a valid skybox (default or custom)
                const isValid = allSkyboxNames.includes(skyboxName);
                if (isValid) {
                    console.log("SkyboxOptionsSection: Received external skybox change:", skyboxName);
                    setSelectedSkybox(skyboxName);
                }
            }
        };

        window.addEventListener('skybox-changed', handleExternalSkyboxChange as EventListener);

        return () => {
            window.removeEventListener('skybox-changed', handleExternalSkyboxChange as EventListener);
        };
    }, [allSkyboxNames]);

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

    // Load cached previews and generate missing ones for default skyboxes
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
            setSkyboxPreviews(prev => ({ ...prev, ...previews }));
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

    const handleSkyboxAdded = (skybox: CustomSkybox) => {
        setCustomSkyboxes(prev => [...prev, skybox]);
        if (skybox.previewDataUrl) {
            setSkyboxPreviews(prev => ({ ...prev, [skybox.name]: skybox.previewDataUrl! }));
        }
        // Automatically select the new skybox
        handleSkyboxChange(skybox.name);
    };

    const handleDeleteSkybox = async (skyboxName: string) => {
        try {
            // Remove from database
            const existingSkyboxes = (await DatabaseManager.getData(STORES.SETTINGS, 'customSkyboxes') || []) as CustomSkybox[];
            const updatedSkyboxes = existingSkyboxes.filter((s: CustomSkybox) => s.name !== skyboxName);
            await DatabaseManager.saveData(STORES.SETTINGS, 'customSkyboxes', updatedSkyboxes);

            // Update state
            setCustomSkyboxes(prev => prev.filter(s => s.name !== skyboxName));
            setSkyboxPreviews(prev => {
                const newPreviews = { ...prev };
                delete newPreviews[skyboxName];
                return newPreviews;
            });

            // If the deleted skybox was selected, switch to default
            if (selectedSkybox === skyboxName) {
                handleSkyboxChange('partly-cloudy');
            }

            setShowDeleteConfirm(null);
        } catch (error) {
            console.error("Error deleting skybox:", error);
        }
    };

    return (
        <>
            <div className="flex flex-wrap -mx-1">
                {allSkyboxes.map((skybox) => (
                    <div key={skybox.name} className="relative px-1 mb-2 w-1/2">
                        <Tooltip text={skybox.name.replace(/-/g, ' ')}>
                            <div className="relative">
                                <button
                                    aria-label={skybox.name.replace(/-/g, ' ')}
                                    onClick={() => handleSkyboxChange(skybox.name)}
                                    className={`relative aspect-square border-2 rounded-lg overflow-hidden transition-all duration-200 hover:border-blue-400 w-full ${selectedSkybox === skybox.name ? 'border-blue-500 ring-2 ring-blue-300' : 'border-gray-600'
                                        } ${isChangingSkybox ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    disabled={isChangingSkybox}
                                >
                                    {skyboxPreviews[skybox.name] ? (
                                        <>
                                            <img
                                                src={skyboxPreviews[skybox.name]!}
                                                alt={skybox.name}
                                                className="object-cover w-full h-full"
                                            />
                                            {isChangingSkybox && selectedSkybox === skybox.name && (
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
                                {/* Delete button for custom skyboxes */}
                                {skybox.isCustom && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setShowDeleteConfirm(skybox.name);
                                        }}
                                        className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white text-xs font-bold shadow-lg transition-colors z-10"
                                        title="Delete skybox"
                                    >
                                        ×
                                    </button>
                                )}
                            </div>
                        </Tooltip>
                    </div>
                ))}

                {/* Add Custom Skybox Button */}
                <div className="relative px-1 mb-2 w-1/2">
                    <Tooltip text="Add Custom Skybox">
                        <button
                            onClick={() => setShowUploadModal(true)}
                            className="relative aspect-square border-2 border-dashed border-gray-600 rounded-lg overflow-hidden transition-all duration-200 hover:border-blue-400 hover:bg-gray-700/50 w-full flex flex-col items-center justify-center"
                        >
                            <span className="text-2xl text-gray-400">+</span>
                            <span className="text-xs text-gray-400 mt-1">Add</span>
                        </button>
                    </Tooltip>
                </div>
            </div>

            {/* Upload Modal */}
            <SkyboxUploadModal
                isOpen={showUploadModal}
                onClose={() => setShowUploadModal(false)}
                onSkyboxAdded={handleSkyboxAdded}
                existingSkyboxNames={allSkyboxNames}
            />

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDeleteConfirm(null)}>
                    <div
                        className="bg-gray-800 rounded-lg p-6 max-w-sm mx-4 shadow-xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-lg font-semibold mb-2">Delete Skybox</h3>
                        <p className="text-gray-300 mb-4">
                            Are you sure you want to delete "{showDeleteConfirm}"? This cannot be undone.
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setShowDeleteConfirm(null)}
                                className="px-4 py-2 rounded-lg border border-gray-600 hover:bg-gray-700 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleDeleteSkybox(showDeleteConfirm)}
                                className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
