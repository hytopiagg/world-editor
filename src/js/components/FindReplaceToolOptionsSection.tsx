import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { FaSearch, FaExchangeAlt, FaTrash, FaRobot, FaCrosshairs, FaGlobeAmericas, FaRandom, FaSyncAlt, FaStop, FaMagic, FaArrowsAlt, FaUndo, FaChevronLeft, FaChevronRight, FaChevronUp, FaChevronDown } from "react-icons/fa";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";
import { generateSchematicPreview } from "../utils/SchematicPreviewRenderer";
import { generateUniqueId } from "./AIAssistantPanel";
import type { PatternData } from "../tools/FindReplaceTool";

interface FindReplaceToolOptionsSectionProps {
    findReplaceTool: any;
    isCompactMode: boolean;
    onRequestAIGeneration?: () => void;
    getAvailableBlocks?: () => Promise<any> | any;
}

interface SchematicEntry {
    id: string;
    prompt: string;
    name?: string;
    schematic: any;
    timestamp?: number;
}

export default function FindReplaceToolOptionsSection({ 
    findReplaceTool, 
    isCompactMode,
    onRequestAIGeneration,
    getAvailableBlocks
}: FindReplaceToolOptionsSectionProps) {
    const [settings, setSettings] = useState({
        scope: "entire_map" as "selection" | "entire_map",
        matchRotations: true,
        randomReplacementRotation: false,
    });
    
    // Replacement offset state
    const [replacementOffset, setReplacementOffset] = useState({ x: 0, y: 0, z: 0 });
    
    // Adjustment mode state
    const [isAdjustingMode, setIsAdjustingMode] = useState(false);
    const [adjustmentReplacedCount, setAdjustmentReplacedCount] = useState(0);
    
    const [findPattern, setFindPattern] = useState<PatternData | null>(null);
    const [replacePatterns, setReplacePatterns] = useState<PatternData[]>([]);
    const [matchCount, setMatchCount] = useState(0);
    const [isExecuting, setIsExecuting] = useState(false);
    const [currentMode, setCurrentMode] = useState<string | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [searchProgress, setSearchProgress] = useState(0);
    
    // Component selection state
    const [showFindComponentPicker, setShowFindComponentPicker] = useState(false);
    const [showReplaceComponentPicker, setShowReplaceComponentPicker] = useState(false);
    const [availableComponents, setAvailableComponents] = useState<SchematicEntry[]>([]);
    const [componentSearchTerm, setComponentSearchTerm] = useState("");
    
    // Preview images
    const [findPreviewUrl, setFindPreviewUrl] = useState<string | null>(null);
    const [replacePreviewUrls, setReplacePreviewUrls] = useState<(string | null)[]>([]);
    
    // AI generation state
    const [showAIGenerator, setShowAIGenerator] = useState(false);
    const [aiPrompt, setAiPrompt] = useState("");
    const [isGeneratingAI, setIsGeneratingAI] = useState(false);
    const [aiError, setAiError] = useState<string | null>(null);
    const [hCaptchaToken, setHCaptchaToken] = useState<string | null>(null);
    const [captchaError, setCaptchaError] = useState<string | null>(null);
    const hCaptchaRef = useRef<HCaptcha>(null);
    
    // Load available components
    useEffect(() => {
        const loadComponents = async () => {
            try {
                const db = await DatabaseManager.getDBConnection();
                const tx = db.transaction(STORES.SCHEMATICS, "readonly");
                const store = tx.objectStore(STORES.SCHEMATICS);
                const request = store.getAll();
                const keys = store.getAllKeys();
                
                const [allValues, allKeys] = await Promise.all([
                    new Promise<any[]>((resolve, reject) => {
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                    }),
                    new Promise<IDBValidKey[]>((resolve, reject) => {
                        keys.onsuccess = () => resolve(keys.result);
                        keys.onerror = () => reject(keys.error);
                    }),
                ]);
                
                const components = allValues.map((value, index) => ({
                    id: String(allKeys[index]),
                    ...value,
                }));
                
                setAvailableComponents(components);
            } catch (err) {
                console.error("Failed to load components:", err);
            }
        };
        
        loadComponents();
        
        // Listen for schematic updates
        const handleSchematicUpdate = () => loadComponents();
        window.addEventListener("schematicsDbUpdated", handleSchematicUpdate);
        
        // Listen for new AI-generated components to auto-add as replacement
        const handleNewAIComponent = (e: CustomEvent) => {
            if (e.detail?.component && showReplaceComponentPicker) {
                handleSelectReplaceComponent(e.detail.component, true);
            }
        };
        window.addEventListener("ai-component-generated", handleNewAIComponent as EventListener);
        
        return () => {
            window.removeEventListener("schematicsDbUpdated", handleSchematicUpdate);
            window.removeEventListener("ai-component-generated", handleNewAIComponent as EventListener);
        };
    }, [showReplaceComponentPicker]);
    
    // Listen for tool events
    useEffect(() => {
        const handlePatternUpdated = (e: CustomEvent) => {
            if (e.detail.type === "find") {
                setFindPattern(e.detail.pattern);
            } else if (e.detail.type === "replace") {
                setReplacePatterns(e.detail.patterns || []);
            }
        };
        
        const handleMatchesUpdated = (e: CustomEvent) => {
            setMatchCount(e.detail.matches);
            setIsSearching(e.detail.searching ?? false);
            setSearchProgress(e.detail.progress ?? 0);
        };
        
        const handleModeChanged = (e: CustomEvent) => {
            setCurrentMode(e.detail.mode);
        };
        
        const handleScopeUpdated = (e: CustomEvent) => {
            setSettings(prev => ({
                ...prev,
                scope: e.detail.scope,
            }));
        };
        
        const handleExecuted = (e: CustomEvent) => {
            // Reset match count after successful replacement
            setMatchCount(0);
        };
        
        const handleOffsetUpdated = (e: CustomEvent) => {
            setReplacementOffset(e.detail.offset);
        };
        
        const handleAdjustmentMode = (e: CustomEvent) => {
            setIsAdjustingMode(e.detail.active);
            if (e.detail.active) {
                setAdjustmentReplacedCount(e.detail.replaced || 0);
                setReplacementOffset(e.detail.offset || { x: 0, y: 0, z: 0 });
            } else {
                setAdjustmentReplacedCount(0);
                if (e.detail.cancelled) {
                    setReplacementOffset({ x: 0, y: 0, z: 0 });
                }
            }
        };
        
        window.addEventListener("findreplace-pattern-updated", handlePatternUpdated as EventListener);
        window.addEventListener("findreplace-matches-updated", handleMatchesUpdated as EventListener);
        window.addEventListener("findreplace-mode-changed", handleModeChanged as EventListener);
        window.addEventListener("findreplace-scope-updated", handleScopeUpdated as EventListener);
        window.addEventListener("findreplace-executed", handleExecuted as EventListener);
        window.addEventListener("findreplace-offset-updated", handleOffsetUpdated as EventListener);
        window.addEventListener("findreplace-adjustment-mode", handleAdjustmentMode as EventListener);
        
        return () => {
            window.removeEventListener("findreplace-pattern-updated", handlePatternUpdated as EventListener);
            window.removeEventListener("findreplace-matches-updated", handleMatchesUpdated as EventListener);
            window.removeEventListener("findreplace-mode-changed", handleModeChanged as EventListener);
            window.removeEventListener("findreplace-scope-updated", handleScopeUpdated as EventListener);
            window.removeEventListener("findreplace-executed", handleExecuted as EventListener);
            window.removeEventListener("findreplace-offset-updated", handleOffsetUpdated as EventListener);
            window.removeEventListener("findreplace-adjustment-mode", handleAdjustmentMode as EventListener);
        };
    }, []);
    
    // Generate preview for find pattern
    useEffect(() => {
        let isMounted = true;
        async function generatePreview() {
            if (!findPattern?.blocks || Object.keys(findPattern.blocks).length === 0) {
                setFindPreviewUrl(null);
                return;
            }
            try {
                const url = await generateSchematicPreview(findPattern.blocks, {
                    width: 80,
                    height: 80,
                    background: "transparent",
                });
                if (isMounted) setFindPreviewUrl(url);
            } catch (err) {
                console.error("Failed to generate find preview:", err);
            }
        }
        generatePreview();
        return () => { isMounted = false; };
    }, [findPattern]);
    
    // Generate previews for replace patterns
    useEffect(() => {
        let isMounted = true;
        async function generatePreviews() {
            const urls: (string | null)[] = [];
            for (const pattern of replacePatterns) {
                if (!pattern?.blocks || Object.keys(pattern.blocks).length === 0) {
                    urls.push(null);
                    continue;
                }
                try {
                    const url = await generateSchematicPreview(pattern.blocks, {
                        width: 64,
                        height: 64,
                        background: "transparent",
                    });
                    urls.push(url);
                } catch (err) {
                    console.error("Failed to generate replace preview:", err);
                    urls.push(null);
                }
            }
            if (isMounted) setReplacePreviewUrls(urls);
        }
        generatePreviews();
        return () => { isMounted = false; };
    }, [replacePatterns]);
    
    const filteredComponents = useMemo(() => {
        if (!componentSearchTerm) return availableComponents;
        const term = componentSearchTerm.toLowerCase();
        return availableComponents.filter(c => 
            (c.name || c.prompt || "").toLowerCase().includes(term)
        );
    }, [availableComponents, componentSearchTerm]);
    
    const updateToolSettings = (key: string, value: any) => {
        const newSettings = { ...settings, [key]: value };
        setSettings(newSettings);
        findReplaceTool?.updateSettings?.({ [key]: value });
    };
    
    const handleStartDefineFind = () => {
        setShowFindComponentPicker(false);
        // Try direct method call first, then fallback to event
        if (findReplaceTool?.startDefiningFind) {
            findReplaceTool.startDefiningFind();
        } else {
            console.log("[FindReplaceUI] Using event fallback for find selection");
            window.dispatchEvent(new CustomEvent("findreplace-start-find-selection"));
        }
    };
    
    const handleStartDefineReplace = () => {
        setShowReplaceComponentPicker(false);
        // Try direct method call first, then fallback to event
        if (findReplaceTool?.startDefiningReplace) {
            findReplaceTool.startDefiningReplace();
        } else {
            console.log("[FindReplaceUI] Using event fallback for replace selection");
            window.dispatchEvent(new CustomEvent("findreplace-start-replace-selection"));
        }
    };
    
    const handleStartDefineScope = () => {
        // Try direct method call first, then fallback to event
        if (findReplaceTool?.startDefiningScope) {
            findReplaceTool.startDefiningScope();
        } else {
            console.log("[FindReplaceUI] Using event fallback for scope selection");
            window.dispatchEvent(new CustomEvent("findreplace-start-scope-selection"));
        }
    };
    
    const handleSelectFindComponent = (component: SchematicEntry) => {
        findReplaceTool?.setFindPatternFromComponent?.(component);
        setShowFindComponentPicker(false);
        setComponentSearchTerm("");
    };
    
    const handleSelectReplaceComponent = useCallback((component: SchematicEntry, addToList: boolean = false) => {
        findReplaceTool?.setReplacePatternFromComponent?.(component, addToList);
        if (!addToList) {
            setShowReplaceComponentPicker(false);
        }
        setComponentSearchTerm("");
    }, [findReplaceTool]);
    
    const handleRemoveReplacePattern = (index: number) => {
        findReplaceTool?.removeReplacePattern?.(index);
    };
    
    const handleClearReplacePatterns = () => {
        findReplaceTool?.clearReplacePatterns?.();
    };
    
    const handleExecuteReplace = async () => {
        if (!findReplaceTool) return;
        setIsExecuting(true);
        try {
            const result = await findReplaceTool.executeReplace();
            if (result.success) {
                // Show success feedback
                console.log(`Successfully replaced ${result.replaced} structures`);
            }
        } catch (err) {
            console.error("Failed to execute replace:", err);
        } finally {
            setIsExecuting(false);
        }
    };
    
    const handleRefreshMatches = () => {
        findReplaceTool?.findMatches?.();
    };
    
    const handleCancelSearch = () => {
        findReplaceTool?.cancelSearch?.();
    };
    
    const handleOffsetChange = (axis: "x" | "y" | "z", value: number) => {
        findReplaceTool?.setReplacementOffset?.(axis, value);
        setReplacementOffset(prev => ({ ...prev, [axis]: value }));
    };
    
    const handleResetOffset = () => {
        findReplaceTool?.resetReplacementOffset?.();
        setReplacementOffset({ x: 0, y: 0, z: 0 });
    };
    
    const handleNudgeOffset = (axis: "x" | "y" | "z", delta: number) => {
        const newValue = replacementOffset[axis] + delta;
        handleOffsetChange(axis, newValue);
    };
    
    const handleConfirmAdjustment = () => {
        findReplaceTool?.confirmAdjustment?.();
    };
    
    const handleCancelAdjustment = () => {
        findReplaceTool?.cancelAdjustment?.();
    };
    
    const handleToggleAIGenerator = () => {
        setShowAIGenerator(!showAIGenerator);
        setShowReplaceComponentPicker(false);
        setAiError(null);
        setCaptchaError(null);
    };
    
    // AI Generation logic
    const generateAIStructure = useCallback(async () => {
        if (!aiPrompt.trim() || isGeneratingAI) return;
        setIsGeneratingAI(true);
        setAiError(null);
        setCaptchaError(null);

        if (!hCaptchaToken) {
            setCaptchaError("Please complete the CAPTCHA verification.");
            setIsGeneratingAI(false);
            return;
        }

        try {
            let availableBlocks: any[] = [];
            if (getAvailableBlocks) {
                availableBlocks = await getAvailableBlocks();
            }
            if (!availableBlocks || availableBlocks.length === 0) {
                throw new Error("Could not retrieve available block types.");
            }

            const requestBody = {
                prompt: aiPrompt,
                availableBlocks,
                hCaptchaToken: hCaptchaToken,
            };

            const response = await fetch(
                `${process.env.REACT_APP_API_URL}/generate_building`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(requestBody),
                }
            );

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || "Failed to generate building");
            }

            const responseData = await response.json();
            const schematicData = {
                blocks: responseData.blocks || {},
                entities: responseData.entities || undefined,
            };

            const hasBlocks = schematicData.blocks && Object.keys(schematicData.blocks).length > 0;

            if (hasBlocks) {
                const newId = generateUniqueId();
                const newSchematicValue = {
                    prompt: aiPrompt,
                    schematic: schematicData,
                    timestamp: Date.now(),
                };

                // Save to database
                try {
                    await DatabaseManager.saveData(
                        STORES.SCHEMATICS,
                        newId,
                        newSchematicValue
                    );
                    window.dispatchEvent(new CustomEvent("schematicsDbUpdated"));
                } catch (dbError) {
                    console.error("[FindReplace AI] Error saving schematic to DB:", dbError);
                }

                // Add as replacement pattern
                const component: SchematicEntry = {
                    id: newId,
                    prompt: aiPrompt,
                    schematic: schematicData,
                    timestamp: Date.now(),
                };
                handleSelectReplaceComponent(component, replacePatterns.length > 0);
                
                // Clear prompt and close
                setAiPrompt("");
                setShowAIGenerator(false);
            } else {
                setAiError("AI could not generate a structure for this prompt.");
            }
        } catch (err: any) {
            console.error("Error generating AI structure:", err);
            setAiError(err.message || "An unexpected error occurred.");
        } finally {
            setIsGeneratingAI(false);
            setHCaptchaToken(null);
            if (hCaptchaRef.current) {
                hCaptchaRef.current.resetCaptcha();
            }
        }
    }, [aiPrompt, isGeneratingAI, getAvailableBlocks, hCaptchaToken, handleSelectReplaceComponent, replacePatterns.length]);

    const handleAIGenerateClick = () => {
        if (!aiPrompt.trim() || isGeneratingAI) return;

        if (hCaptchaToken) {
            generateAIStructure();
            return;
        }

        setCaptchaError(null);
        if (hCaptchaRef.current) {
            try {
                hCaptchaRef.current.execute();
            } catch (error) {
                console.error("Failed to execute hCaptcha:", error);
                setCaptchaError("Failed to initiate CAPTCHA. Please try again.");
            }
        } else {
            setCaptchaError("CAPTCHA component not ready. Please try again.");
        }
    };

    // Trigger generation when captcha is verified
    useEffect(() => {
        if (hCaptchaToken && showAIGenerator) {
            generateAIStructure();
        }
    }, [hCaptchaToken, showAIGenerator, generateAIStructure]);
    
    return (
        <div className="flex flex-col gap-3">
            {/* Hide configuration sections during adjustment mode */}
            {!isAdjustingMode && (
                <>
            {/* Scope Selection */}
            <div className="flex flex-col gap-2 opacity-0 duration-150 fade-down" style={{ animationDelay: "0.05s" }}>
                <label className="text-xs text-[#F1F1F1]/80 text-left font-medium">Search Scope</label>
                <div className="flex gap-2">
                    <button
                        className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-md cursor-pointer border transition-all ${
                            settings.scope === "entire_map" 
                                ? "bg-blue-500/80 border-blue-400 text-white" 
                                : "bg-white/5 border-white/10 text-[#F1F1F1] hover:bg-white/10"
                        }`}
                        onClick={() => updateToolSettings("scope", "entire_map")}
                    >
                        <FaGlobeAmericas className="w-3 h-3" />
                        Entire Map
                    </button>
                    <button
                        className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-md cursor-pointer border transition-all ${
                            settings.scope === "selection" 
                                ? "bg-orange-500/80 border-orange-400 text-white" 
                                : "bg-white/5 border-white/10 text-[#F1F1F1] hover:bg-white/10"
                        }`}
                        onClick={handleStartDefineScope}
                    >
                        <FaCrosshairs className="w-3 h-3" />
                        Selection
                    </button>
                </div>
                {currentMode === "defining-scope" && (
                    <p className="text-[10px] text-orange-400 mt-1">
                        Click to start, click again to confirm scope area. Use 1|2 for height.
                    </p>
                )}
            </div>
            
            {/* Find Pattern Section */}
            <div className="flex flex-col gap-2 opacity-0 duration-150 fade-down" style={{ animationDelay: "0.075s" }}>
                <div className="flex items-center justify-between">
                    <label className="text-xs text-[#F1F1F1]/80 text-left font-medium flex items-center gap-1.5">
                        <FaSearch className="w-3 h-3 text-yellow-400" />
                        Find Pattern
                    </label>
                    {findPattern && (
                        <span className="text-[10px] text-green-400">
                            {Object.keys(findPattern.blocks).length} blocks
                        </span>
                    )}
                </div>
                
                {/* Find pattern preview */}
                <div className="flex gap-2 items-start">
                    <div className="w-20 h-20 rounded-md bg-black/30 border border-white/10 flex items-center justify-center overflow-hidden">
                        {findPreviewUrl ? (
                            <img src={findPreviewUrl} alt="Find pattern" className="w-full h-full object-contain" />
                        ) : (
                            <span className="text-[10px] text-white/40">No pattern</span>
                        )}
                    </div>
                    <div className="flex-1 flex flex-col gap-1">
                        <button
                            className={`w-full px-2 py-1.5 text-xs rounded-md cursor-pointer border transition-all ${
                                currentMode === "defining-find"
                                    ? "bg-yellow-500/80 border-yellow-400 text-black"
                                    : "bg-white/5 border-white/10 text-[#F1F1F1] hover:bg-white/10"
                            }`}
                            onClick={handleStartDefineFind}
                        >
                            Select from World
                        </button>
                        <button
                            className={`w-full px-2 py-1.5 text-xs rounded-md cursor-pointer border transition-all ${
                                showFindComponentPicker
                                    ? "bg-white/20 border-white/30 text-white"
                                    : "bg-white/5 border-white/10 text-[#F1F1F1] hover:bg-white/10"
                            }`}
                            onClick={() => setShowFindComponentPicker(!showFindComponentPicker)}
                        >
                            Use Component
                        </button>
                    </div>
                </div>
                
                {currentMode === "defining-find" && (
                    <p className="text-[10px] text-yellow-400">
                        Click to start, click again to confirm selection. Use 1|2 for height.
                    </p>
                )}
                
                {/* Component picker for find */}
                {showFindComponentPicker && (
                    <div className="flex flex-col gap-1.5 p-2 bg-black/40 rounded-md border border-white/10 max-h-40 overflow-y-auto">
                        <input
                            type="text"
                            placeholder="Search components..."
                            value={componentSearchTerm}
                            onChange={(e) => setComponentSearchTerm(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                            className="w-full px-2 py-1 text-xs bg-white/10 border border-white/10 rounded text-[#F1F1F1] focus:outline-none focus:border-white/30"
                        />
                        <div className="flex flex-wrap gap-1">
                            {filteredComponents.map((component) => (
                                <button
                                    key={component.id}
                                    className="px-2 py-1 text-[10px] bg-white/10 border border-white/10 rounded hover:bg-white/20 text-[#F1F1F1] truncate max-w-[120px]"
                                    onClick={() => handleSelectFindComponent(component)}
                                    title={component.name || component.prompt}
                                >
                                    {component.name || component.prompt || component.id}
                                </button>
                            ))}
                            {filteredComponents.length === 0 && (
                                <span className="text-[10px] text-white/40">No components found</span>
                            )}
                        </div>
                    </div>
                )}
            </div>
            
            {/* Replace Pattern Section */}
            <div className="flex flex-col gap-2 opacity-0 duration-150 fade-down" style={{ animationDelay: "0.1s" }}>
                <div className="flex items-center justify-between">
                    <label className="text-xs text-[#F1F1F1]/80 text-left font-medium flex items-center gap-1.5">
                        <FaExchangeAlt className="w-3 h-3 text-cyan-400" />
                        Replace With
                    </label>
                    {replacePatterns.length > 1 && (
                        <span className="text-[10px] text-cyan-400">
                            {replacePatterns.length} patterns (random)
                        </span>
                    )}
                </div>
                
                {/* Replace patterns preview */}
                <div className="flex gap-2 flex-wrap">
                    {replacePatterns.map((pattern, index) => (
                        <div key={index} className="relative">
                            <div className="w-16 h-16 rounded-md bg-black/30 border border-white/10 flex items-center justify-center overflow-hidden">
                                {replacePreviewUrls[index] ? (
                                    <img src={replacePreviewUrls[index]!} alt={`Replace pattern ${index + 1}`} className="w-full h-full object-contain" />
                                ) : (
                                    <span className="text-[8px] text-white/40">...</span>
                                )}
                            </div>
                            <button
                                className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-400"
                                onClick={() => handleRemoveReplacePattern(index)}
                            >
                                <FaTrash className="w-2 h-2 text-white" />
                            </button>
                        </div>
                    ))}
                    
                    {replacePatterns.length === 0 && (
                        <div className="w-16 h-16 rounded-md bg-black/30 border border-white/10 border-dashed flex items-center justify-center">
                            <span className="text-[10px] text-white/40">Empty</span>
                        </div>
                    )}
                </div>
                
                {/* Replace pattern buttons */}
                <div className="flex gap-1 flex-wrap">
                    <button
                        className={`flex-1 min-w-[80px] px-2 py-1.5 text-xs rounded-md cursor-pointer border transition-all ${
                            currentMode === "defining-replace"
                                ? "bg-cyan-500/80 border-cyan-400 text-black"
                                : "bg-white/5 border-white/10 text-[#F1F1F1] hover:bg-white/10"
                        }`}
                        onClick={handleStartDefineReplace}
                    >
                        Select
                    </button>
                    <button
                        className={`flex-1 min-w-[80px] px-2 py-1.5 text-xs rounded-md cursor-pointer border transition-all ${
                            showReplaceComponentPicker
                                ? "bg-white/20 border-white/30 text-white"
                                : "bg-white/5 border-white/10 text-[#F1F1F1] hover:bg-white/10"
                        }`}
                        onClick={() => {
                            setShowReplaceComponentPicker(!showReplaceComponentPicker);
                            setShowAIGenerator(false);
                        }}
                    >
                        Component
                    </button>
                    <button
                        className={`flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-md cursor-pointer border transition-all ${
                            showAIGenerator
                                ? "bg-purple-500/50 border-purple-400 text-white"
                                : "bg-purple-500/20 border-purple-400/50 text-purple-300 hover:bg-purple-500/30"
                        }`}
                        onClick={handleToggleAIGenerator}
                        title="Generate with AI"
                    >
                        <FaRobot className="w-3 h-3" />
                        AI
                    </button>
                </div>
                
                {currentMode === "defining-replace" && (
                    <p className="text-[10px] text-cyan-400">
                        Click to start, click again to confirm selection. Use 1|2 for height.
                    </p>
                )}
                
                {/* AI Generator Panel */}
                {showAIGenerator && (
                    <div className="flex flex-col gap-2 p-2 bg-purple-500/10 rounded-md border border-purple-400/30">
                        <div className="flex items-center gap-1.5 text-xs text-purple-300">
                            <FaMagic className="w-3 h-3" />
                            <span className="font-medium">AI Structure Generator</span>
                        </div>
                        <textarea
                            className="w-full p-2 h-16 text-xs bg-black/40 rounded-md border border-white/10 text-[#F1F1F1] focus:outline-none focus:border-purple-400/50 resize-none"
                            placeholder="Describe the replacement structure (e.g., 'a bigger oak tree', 'a stone tower')"
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                            disabled={isGeneratingAI}
                        />
                        <button
                            className={`w-full py-2 text-xs font-medium rounded-md transition-all ${
                                aiPrompt.trim() && !isGeneratingAI
                                    ? "bg-purple-500 text-white hover:bg-purple-400 cursor-pointer"
                                    : "bg-white/10 text-white/40 cursor-not-allowed"
                            }`}
                            onClick={handleAIGenerateClick}
                            disabled={!aiPrompt.trim() || isGeneratingAI}
                        >
                            {isGeneratingAI ? (
                                <span className="flex items-center justify-center gap-2">
                                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Generating...
                                </span>
                            ) : (
                                "Generate & Add as Replacement"
                            )}
                        </button>
                        {aiError && (
                            <p className="text-[10px] text-red-400">{aiError}</p>
                        )}
                        {captchaError && (
                            <p className="text-[10px] text-red-400">{captchaError}</p>
                        )}
                        
                        {/* Hidden hCaptcha */}
                        <div style={{ position: "fixed", visibility: "hidden", bottom: 0, right: 0 }}>
                            <HCaptcha
                                ref={hCaptchaRef}
                                sitekey={
                                    (typeof window !== "undefined" && (window as any).WorldEditorEnv?.hcaptchaSiteKey) ||
                                    process.env.REACT_APP_HCAPTCHA_SITE_KEY ||
                                    "10000000-ffff-ffff-ffff-000000000001"
                                }
                                size="invisible"
                                theme="light"
                                onVerify={(token) => {
                                    setHCaptchaToken(token);
                                    setCaptchaError(null);
                                }}
                                onExpire={() => {
                                    setHCaptchaToken(null);
                                    setCaptchaError("CAPTCHA expired. Please try again.");
                                }}
                                onError={(err) => {
                                    setHCaptchaToken(null);
                                    setCaptchaError(`CAPTCHA error: ${err}`);
                                }}
                            />
                        </div>
                    </div>
                )}
                
                {/* Component picker for replace */}
                {showReplaceComponentPicker && (
                    <div className="flex flex-col gap-1.5 p-2 bg-black/40 rounded-md border border-white/10 max-h-40 overflow-y-auto">
                        <input
                            type="text"
                            placeholder="Search components..."
                            value={componentSearchTerm}
                            onChange={(e) => setComponentSearchTerm(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                            className="w-full px-2 py-1 text-xs bg-white/10 border border-white/10 rounded text-[#F1F1F1] focus:outline-none focus:border-white/30"
                        />
                        <div className="flex items-center gap-2 text-[10px] text-white/60 mb-1">
                            <span>Click to set, Shift+Click to add multiple</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                            {filteredComponents.map((component) => (
                                <button
                                    key={component.id}
                                    className="px-2 py-1 text-[10px] bg-white/10 border border-white/10 rounded hover:bg-white/20 text-[#F1F1F1] truncate max-w-[120px]"
                                    onClick={(e) => handleSelectReplaceComponent(component, e.shiftKey)}
                                    title={`${component.name || component.prompt}\n(Shift+Click to add multiple)`}
                                >
                                    {component.name || component.prompt || component.id}
                                </button>
                            ))}
                            {filteredComponents.length === 0 && (
                                <span className="text-[10px] text-white/40">No components found</span>
                            )}
                        </div>
                    </div>
                )}
                
                {replacePatterns.length > 0 && (
                    <button
                        className="w-full px-2 py-1 text-[10px] rounded bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"
                        onClick={handleClearReplacePatterns}
                    >
                        Clear All Replace Patterns
                    </button>
                )}
            </div>
            
            {/* Options */}
            <div className="flex flex-col gap-2 opacity-0 duration-150 fade-down" style={{ animationDelay: "0.125s" }}>
                <label className="text-xs text-[#F1F1F1]/80 text-left font-medium">Options</label>
                
                <div className="flex items-center justify-between">
                    <span className="text-xs text-[#F1F1F1] flex items-center gap-1.5">
                        <FaSyncAlt className="w-3 h-3" />
                        Match Rotations (0°, 90°, 180°, 270°)
                    </span>
                    <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={settings.matchRotations}
                        onChange={(e) => updateToolSettings("matchRotations", e.target.checked)}
                    />
                </div>
                
                <div className="flex items-center justify-between">
                    <span className="text-xs text-[#F1F1F1] flex items-center gap-1.5">
                        <FaRandom className="w-3 h-3" />
                        Random Replacement Rotation
                    </span>
                    <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={settings.randomReplacementRotation}
                        onChange={(e) => updateToolSettings("randomReplacementRotation", e.target.checked)}
                    />
                </div>
            </div>
                </>
            )}

            {/* Replacement Offset - Only show in adjustment mode */}
            {isAdjustingMode && (
                <div className={`flex flex-col gap-2 opacity-0 duration-150 fade-down p-2 rounded-md border ${
                    isAdjustingMode ? "bg-blue-900/20 border-blue-500/30" : ""
                }`} style={{ animationDelay: "0.14s" }}>
                    <div className="flex items-center justify-between">
                        <label className={`text-xs text-left font-medium flex items-center gap-1.5 ${
                            isAdjustingMode ? "text-blue-300" : "text-[#F1F1F1]/80"
                        }`}>
                            <FaArrowsAlt className="w-3 h-3" />
                            Shift Replacement
                        </label>
                        {(replacementOffset.x !== 0 || replacementOffset.y !== 0 || replacementOffset.z !== 0) && (
                            <button
                                className="text-[10px] text-white/60 hover:text-white flex items-center gap-1"
                                onClick={handleResetOffset}
                                title="Reset offset to 0,0,0"
                            >
                                <FaUndo className="w-2.5 h-2.5" />
                                Reset
                            </button>
                        )}
                    </div>
                    
                    {/* Offset controls - compact grid */}
                    <div className="grid grid-cols-3 gap-1.5">
                        {/* X Axis (Left/Right) */}
                        <div className="flex flex-col items-center gap-1">
                            <span className="text-[9px] text-red-400 font-medium">X (L/R)</span>
                            <div className="flex items-center gap-0.5">
                                <button
                                    className="w-6 h-6 flex items-center justify-center bg-red-500/20 hover:bg-red-500/40 rounded text-red-300 border border-red-500/30"
                                    onClick={() => handleNudgeOffset("x", -1)}
                                    title="Move left (-X)"
                                >
                                    <FaChevronLeft className="w-3 h-3" />
                                </button>
                                <input
                                    type="number"
                                    className="w-12 h-6 text-center text-xs bg-black/40 border border-white/20 rounded text-[#F1F1F1] focus:outline-none focus:border-red-400/50"
                                    value={replacementOffset.x}
                                    onChange={(e) => handleOffsetChange("x", parseInt(e.target.value) || 0)}
                                    onKeyDown={(e) => e.stopPropagation()}
                                />
                                <button
                                    className="w-6 h-6 flex items-center justify-center bg-red-500/20 hover:bg-red-500/40 rounded text-red-300 border border-red-500/30"
                                    onClick={() => handleNudgeOffset("x", 1)}
                                    title="Move right (+X)"
                                >
                                    <FaChevronRight className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                        
                        {/* Y Axis (Up/Down) */}
                        <div className="flex flex-col items-center gap-1">
                            <span className="text-[9px] text-green-400 font-medium">Y (U/D)</span>
                            <div className="flex items-center gap-0.5">
                                <button
                                    className="w-6 h-6 flex items-center justify-center bg-green-500/20 hover:bg-green-500/40 rounded text-green-300 border border-green-500/30"
                                    onClick={() => handleNudgeOffset("y", -1)}
                                    title="Move down (-Y)"
                                >
                                    <FaChevronDown className="w-3 h-3" />
                                </button>
                                <input
                                    type="number"
                                    className="w-12 h-6 text-center text-xs bg-black/40 border border-white/20 rounded text-[#F1F1F1] focus:outline-none focus:border-green-400/50"
                                    value={replacementOffset.y}
                                    onChange={(e) => handleOffsetChange("y", parseInt(e.target.value) || 0)}
                                    onKeyDown={(e) => e.stopPropagation()}
                                />
                                <button
                                    className="w-6 h-6 flex items-center justify-center bg-green-500/20 hover:bg-green-500/40 rounded text-green-300 border border-green-500/30"
                                    onClick={() => handleNudgeOffset("y", 1)}
                                    title="Move up (+Y)"
                                >
                                    <FaChevronUp className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                        
                        {/* Z Axis (Forward/Backward) */}
                        <div className="flex flex-col items-center gap-1">
                            <span className="text-[9px] text-blue-400 font-medium">Z (F/B)</span>
                            <div className="flex items-center gap-0.5">
                                <button
                                    className="w-6 h-6 flex items-center justify-center bg-blue-500/20 hover:bg-blue-500/40 rounded text-blue-300 border border-blue-500/30"
                                    onClick={() => handleNudgeOffset("z", -1)}
                                    title="Move backward (-Z)"
                                >
                                    <FaChevronLeft className="w-3 h-3" />
                                </button>
                                <input
                                    type="number"
                                    className="w-12 h-6 text-center text-xs bg-black/40 border border-white/20 rounded text-[#F1F1F1] focus:outline-none focus:border-blue-400/50"
                                    value={replacementOffset.z}
                                    onChange={(e) => handleOffsetChange("z", parseInt(e.target.value) || 0)}
                                    onKeyDown={(e) => e.stopPropagation()}
                                />
                                <button
                                    className="w-6 h-6 flex items-center justify-center bg-blue-500/20 hover:bg-blue-500/40 rounded text-blue-300 border border-blue-500/30"
                                    onClick={() => handleNudgeOffset("z", 1)}
                                    title="Move forward (+Z)"
                                >
                                    <FaChevronRight className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    {(replacementOffset.x !== 0 || replacementOffset.y !== 0 || replacementOffset.z !== 0) && (
                        <p className="text-[10px] text-blue-300/70 text-center mt-1">
                            Current shift: {replacementOffset.x > 0 ? `+${replacementOffset.x}` : replacementOffset.x} X, {replacementOffset.y > 0 ? `+${replacementOffset.y}` : replacementOffset.y} Y, {replacementOffset.z > 0 ? `+${replacementOffset.z}` : replacementOffset.z} Z
                        </p>
                    )}
                </div>
            )}
            
            {/* Match Count & Execute / Adjustment Mode */}
            <div className="flex flex-col gap-2 opacity-0 duration-150 fade-down" style={{ animationDelay: "0.15s" }}>
                {isAdjustingMode ? (
                    /* Adjustment Mode UI */
                    <div className="flex flex-col gap-2">
                        <div className="flex flex-col gap-1.5 bg-blue-900/30 rounded-md px-3 py-2 border border-blue-500/30">
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-blue-300 font-medium flex items-center gap-1.5">
                                    <FaArrowsAlt className="w-3 h-3" />
                                    Adjustment Mode
                                </span>
                                <span className="text-xs text-blue-400">
                                    {adjustmentReplacedCount} replaced
                                </span>
                            </div>
                            <p className="text-[10px] text-blue-200/70">
                                Use the offset controls above to shift the replaced blocks. Confirm when done or cancel to revert all changes.
                            </p>
                        </div>
                        
                        <div className="flex gap-2">
                            <button
                                className="flex-1 py-2 text-sm font-medium rounded-md bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:from-green-400 hover:to-emerald-500 cursor-pointer transition-all"
                                onClick={handleConfirmAdjustment}
                            >
                                ✓ Confirm
                            </button>
                            <button
                                className="flex-1 py-2 text-sm font-medium rounded-md bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 cursor-pointer transition-all"
                                onClick={handleCancelAdjustment}
                            >
                                ✕ Cancel
                            </button>
                        </div>
                    </div>
                ) : (
                    /* Normal Mode UI */
                    <>
                        <div className="flex flex-col gap-1.5 bg-black/20 rounded-md px-3 py-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-[#F1F1F1]">Matches Found:</span>
                                <div className="flex items-center gap-2">
                                    {isSearching ? (
                                        <span className="text-sm font-bold text-yellow-400 flex items-center gap-1.5">
                                            <div className="w-3 h-3 border-2 border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin" />
                                            {matchCount > 0 ? matchCount : "..."} 
                                        </span>
                                    ) : (
                                        <span className={`text-sm font-bold ${matchCount > 0 ? "text-green-400" : "text-white/40"}`}>
                                            {matchCount}
                                        </span>
                                    )}
                                    {isSearching ? (
                                        <button
                                            className="p-1 rounded bg-red-500/20 hover:bg-red-500/40 text-red-400 border border-red-500/30"
                                            onClick={handleCancelSearch}
                                            title="Cancel search"
                                        >
                                            <FaStop className="w-3 h-3" />
                                        </button>
                                    ) : (
                                        <button
                                            className="p-1 rounded bg-white/10 hover:bg-white/20 text-white/60"
                                            onClick={handleRefreshMatches}
                                            title="Refresh matches"
                                        >
                                            <FaSyncAlt className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                            </div>
                            
                            {/* Progress bar */}
                            {isSearching && (
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 h-1.5 bg-black/40 rounded-full overflow-hidden">
                                        <div 
                                            className="h-full bg-yellow-400 transition-all duration-200 ease-out"
                                            style={{ width: `${searchProgress}%` }}
                                        />
                                    </div>
                                    <span className="text-[10px] text-yellow-400 min-w-[32px] text-right">{searchProgress}%</span>
                                </div>
                            )}
                        </div>
                        
                        <button
                            className={`w-full py-2.5 text-sm font-medium rounded-md transition-all ${
                                findPattern && replacePatterns.length > 0 && matchCount > 0 && !isExecuting && !isSearching
                                    ? "bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:from-green-400 hover:to-emerald-500 cursor-pointer"
                                    : "bg-white/10 text-white/40 cursor-not-allowed"
                            }`}
                            disabled={!findPattern || replacePatterns.length === 0 || matchCount === 0 || isExecuting || isSearching}
                            onClick={handleExecuteReplace}
                        >
                            {isExecuting ? (
                                <span className="flex items-center justify-center gap-2">
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Replacing...
                                </span>
                            ) : isSearching ? (
                                <span className="flex items-center justify-center gap-2">
                                    Searching... ({searchProgress}%)
                                </span>
                            ) : (
                                `Replace All (${matchCount})`
                            )}
                        </button>
                    </>
                )}
            </div>
            
            {/* Keyboard Shortcuts Help */}
            <div className="flex flex-col gap-1 text-[10px] text-[#F1F1F1]/60 bg-black/10 -mx-3 px-3 py-2 mt-1 opacity-0 duration-150 fade-down" style={{ animationDelay: "0.175s" }}>
                <p className="text-xs text-[#F1F1F1]/80 font-bold mb-1">Keyboard Shortcuts</p>
                {isAdjustingMode ? (
                    <>
                        <div className="flex gap-1 items-center"><kbd className="px-1 rounded bg-white/20">Enter</kbd> – Confirm changes</div>
                        <div className="flex gap-1 items-center"><kbd className="px-1 rounded bg-white/20">Esc</kbd> – Cancel and revert</div>
                    </>
                ) : (
                    <>
                        <div className="flex gap-1 items-center"><kbd className="px-1 rounded bg-white/20">1</kbd>/<kbd className="px-1 rounded bg-white/20">2</kbd> – Adjust height</div>
                        <div className="flex gap-1 items-center"><kbd className="px-1 rounded bg-white/20">Esc</kbd> – Cancel selection</div>
                    </>
                )}
            </div>
        </div>
    );
}

