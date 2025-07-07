import { useState, useEffect } from "react";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";
import { generateSkyboxPreview } from "../utils/SkyboxPreviewRenderer";

interface SkyboxOptionsSectionProps {
    terrainBuilderRef: any;
}

export default function SkyboxOptionsSection({ terrainBuilderRef }: SkyboxOptionsSectionProps) {
    const [skyboxPreviews, setSkyboxPreviews] = useState<{ [key: string]: string | null }>({});
    const [selectedSkybox, setSelectedSkybox] = useState("partly-cloudy");
    const [loadingSkybox, setLoadingSkybox] = useState<string | null>(null);
    const [generatingPreviews, setGeneratingPreviews] = useState(true);
    const [isChangingSkybox, setIsChangingSkybox] = useState(false);

    // Hardcoding for now, could be dynamic later
    const availableSkyboxes = ["partly-cloudy", "night"];

    // Load saved skybox and generate previews on mount
    useEffect(() => {
        const loadAndGeneratePreviews = async () => {
            // 1. Load saved skybox preference
            try {
                const savedSkybox = await DatabaseManager.getData(STORES.SETTINGS, "selectedSkybox");
                if (typeof savedSkybox === 'string' && availableSkyboxes.includes(savedSkybox)) {
                    setSelectedSkybox(savedSkybox);
                    if (terrainBuilderRef?.current?.changeSkybox) {
                        terrainBuilderRef.current.changeSkybox(savedSkybox);
                    }
                }
            } catch (error) {
                console.error("Error loading selected skybox:", error);
            }

            // 2. Load cached previews and generate missing ones
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

            // 3. Generate any missing previews in the background
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
    }, [terrainBuilderRef]);

    const handleSkyboxChange = async (skyboxName: string) => {
        if (terrainBuilderRef?.current?.changeSkybox) {
            setLoadingSkybox(skyboxName);
            setIsChangingSkybox(true);
            try {
                // The function in TerrainBuilder handles the actual texture loading
                terrainBuilderRef.current.changeSkybox(skyboxName);
                setSelectedSkybox(skyboxName);
                await DatabaseManager.saveData(STORES.SETTINGS, "selectedSkybox", skyboxName);
            } catch (error) {
                console.error("Error changing skybox:", error);
            }
        }
    };

    return (
        <div className="flex flex-wrap -mx-1">
            {availableSkyboxes.map((skybox) => (
                <div key={skybox} className="relative w-1/2 px-1 mb-2">
                    <button
                        onClick={() => handleSkyboxChange(skybox)}
                        className={`relative aspect-square border-2 rounded-lg overflow-hidden transition-all duration-200 hover:border-blue-400 ${selectedSkybox === skybox ? 'border-blue-500 ring-2 ring-blue-300' : 'border-gray-600'
                            }`}
                        disabled={loadingSkybox === skybox}
                    >
                        {skyboxPreviews[skybox] ? (
                            <>
                                <img
                                    src={skyboxPreviews[skybox]}
                                    alt={skybox}
                                    className="w-full h-full object-cover"
                                />
                                {/* Loading spinner for skybox changes - show for the skybox being loaded */}
                                {loadingSkybox === skybox && (
                                    <div style={{ inset: 0, position: 'absolute', backgroundColor: 'rgba(0, 0, 0, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
                                        <div style={{ width: '20px', height: '20px', border: '2px solid rgba(255, 255, 255, 0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="w-full h-full bg-gray-700 flex items-center justify-center">
                                <div className="w-8 h-8 border-4 border-white/30 border-t-white/80 rounded-full animate-spin"></div>
                            </div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-75 text-white text-xs p-1 text-center z-5">
                            {skybox.replace('-', ' ')}
                        </div>
                    </button>
                </div>
            ))}
        </div>
    );
} 