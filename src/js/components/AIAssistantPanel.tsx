import React, { useState, useCallback, useRef, useEffect } from "react";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import "../../css/AIAssistantPanel.css";
const AIAssistantPanel = ({
    getAvailableBlocks,
    loadAISchematic,
    isVisible,
}) => {
    const [prompt, setPrompt] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [generationHistory, setGenerationHistory] = useState([]);
    const [hCaptchaToken, setHCaptchaToken] = useState(null);
    const [captchaError, setCaptchaError] = useState(null);
    const hCaptchaRef = useRef(null);

    useEffect(() => {
        const loadSavedSchematics = async () => {
            try {
                const { DatabaseManager, STORES } = await import(
                    "../managers/DatabaseManager"
                );

                const db = await DatabaseManager.getDBConnection();
                const tx = db.transaction(STORES.SCHEMATICS, "readonly");
                const store = tx.objectStore(STORES.SCHEMATICS);
                const cursorRequest = store.openCursor();
                const loadedHistory = [];
                cursorRequest.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        loadedHistory.push({
                            prompt: cursor.key,
                            schematic: cursor.value,
                        });
                        cursor.continue();
                    } else {
                        if (loadedHistory.length > 0) {
                            loadedHistory.sort(
                                (a, b) =>
                                    (b.schematic.timestamp || 0) -
                                    (a.schematic.timestamp || 0)
                            );
                            setGenerationHistory(loadedHistory);
                            console.log(
                                `[AI Panel] Loaded ${loadedHistory.length} saved schematics.`
                            );
                        }
                    }
                };
                cursorRequest.onerror = (event) => {
                    console.error(
                        "[AI Panel] Error reading schematics store with cursor:",
                        event.target.error
                    );
                };
            } catch (err) {
                console.error(
                    "[AI Panel] Error loading saved schematics:",
                    err
                );
            }
        };
        if (isVisible) {
            loadSavedSchematics();
        }
    }, [isVisible]); // Re-load if visibility changes

    const handleGenerate = useCallback(async () => {
        if (!prompt.trim() || isLoading) return;
        setIsLoading(true);
        setError(null);
        setCaptchaError(null);
        if (!hCaptchaToken) {
            setCaptchaError("Please complete the CAPTCHA verification.");
            setIsLoading(false);
            return;
        }
        try {
            const availableBlocks = await getAvailableBlocks();
            if (!availableBlocks || availableBlocks.length === 0) {
                throw new Error("Could not retrieve available block types.");
            }
            const response = await fetch(
                `${process.env.REACT_APP_API_URL}/generate_building`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        prompt,
                        availableBlocks,
                        hCaptchaToken: hCaptchaToken,
                    }),
                }
            );
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(
                    errorData.error || "Failed to generate building"
                );
            }
            const schematic = await response.json();
            if (schematic && Object.keys(schematic).length > 0) {
                const newHistoryEntry = { prompt, schematic };
                setGenerationHistory((prevHistory) => [
                    newHistoryEntry,
                    ...prevHistory,
                ]);
                loadAISchematic(schematic);

                try {
                    const { DatabaseManager, STORES } = await import(
                        "../managers/DatabaseManager"
                    );

                    await DatabaseManager.saveData(
                        STORES.SCHEMATICS,
                        prompt,
                        schematic
                    );
                    console.log(
                        `[AI Panel] Saved schematic for prompt: "${prompt}"`
                    );
                } catch (dbError) {
                    console.error(
                        "[AI Panel] Error saving schematic to DB:",
                        dbError
                    );
                }
            } else {
                setError("AI could not generate a structure for this prompt.");
            }
        } catch (err) {
            console.error("Error generating AI structure:", err);
            setError(err.message || "An unexpected error occurred.");
        } finally {
            setIsLoading(false);
            setHCaptchaToken(null);
            if (hCaptchaRef.current) {
                hCaptchaRef.current.resetCaptcha();
            }
        }
    }, [prompt, isLoading, getAvailableBlocks, loadAISchematic, hCaptchaToken]);
    if (!isVisible) {
        return null;
    }
    return (
        <div className="ai-assistant-panel">
            <h4>AI Building Assistant</h4>
            <textarea
                className="ai-assistant-textarea"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe what you want to build (e.g., 'a small stone hut', 'a 5 block high brick tower')"
                disabled={isLoading}
            />
            <button
                className="ai-assistant-button"
                onClick={handleGenerate}
                disabled={isLoading || !prompt.trim()}
            >
                {isLoading ? "Generating..." : "Generate Structure"}
            </button>
            {error && <div className="ai-assistant-error">{error}</div>}
            {/* Added HCaptcha Component - Wrapped for styling */}
            {/* <div className="ai-assistant-captcha-container"> */}
            <HCaptcha
                ref={hCaptchaRef}
                sitekey={process.env.REACT_APP_HCAPTCHA_SITE_KEY}
                size="compact"
                theme="dark"
                onVerify={(token) => {
                    setHCaptchaToken(token);
                    setCaptchaError(null);
                }}
                onExpire={() => {
                    setHCaptchaToken(null);
                    setCaptchaError("CAPTCHA expired. Please verify again.");
                }}
                onError={(err) => {
                    setHCaptchaToken(null);
                    setCaptchaError(`CAPTCHA error: ${err}`);
                }}
            />
            {/* </div> */}
            {captchaError && (
                <div className="ai-assistant-error">{captchaError}</div>
            )}
            {/* Added History Section */}
            {generationHistory.length > 0 && (
                <div
                    onWheel={(e) => {
                        e.stopPropagation();
                    }}
                    className="ai-assistant-history-list"
                >
                    <h5>History:</h5>
                    {generationHistory.map((entry, index) => (
                        <div
                            key={index}
                            className="ai-assistant-history-item"
                            onClick={() => loadAISchematic(entry.schematic)}
                            title={`Load: ${entry.prompt}`}
                        >
                            {entry.prompt}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
export default AIAssistantPanel;
