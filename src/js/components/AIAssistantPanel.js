import React, { useState, useCallback, useRef } from "react";
import HCaptcha from "@hcaptcha/react-hcaptcha";

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

    // Basic styling - can be improved
    const panelStyle = {
        position: "absolute",
        top: "150px",
        right: "20px",
        width: "300px",
        padding: "15px",
        background: "rgba(40, 40, 40, 0.9)",
        border: "1px solid #555",
        borderRadius: "8px",
        color: "white",
        zIndex: 100, // Ensure it's above other UI elements
        display: "flex",
        flexDirection: "column",
        gap: "10px",
    };

    const textareaStyle = {
        width: "100%",
        minHeight: "80px",
        background: "#333",
        color: "white",
        border: "1px solid #666",
        borderRadius: "4px",
        padding: "5px",
        boxSizing: "border-box", // Include padding in width
    };

    const buttonStyle = {
        padding: "8px 15px",
        background: "#007bff",
        color: "white",
        border: "none",
        borderRadius: "4px",
        cursor: "pointer",
        opacity: isLoading ? 0.6 : 1,
    };

    const errorStyle = {
        color: "#ffcccc",
        fontSize: "0.9em",
        marginTop: "5px",
    };

    // Added styles for history
    const historyListStyle = {
        marginTop: "15px",
        maxHeight: "150px", // Limit height and make scrollable
        overflowY: "auto",
        borderTop: "1px solid #555",
        paddingTop: "10px",
    };

    const historyItemStyle = {
        background: "#444",
        padding: "5px 8px",
        marginBottom: "5px",
        borderRadius: "3px",
        cursor: "pointer",
        fontSize: "0.9em",
        whiteSpace: "nowrap", // Prevent wrapping
        overflow: "hidden", // Hide overflow
        textOverflow: "ellipsis", // Add ellipsis if text is too long
    };

    const historyItemHoverStyle = {
        // Style for hover effect
        background: "#555",
    };

    return (
        <div style={panelStyle}>
            <h4>AI Building Assistant</h4>
            <textarea
                style={textareaStyle}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe what you want to build (e.g., 'a small stone hut', 'a 5 block high brick tower')"
                disabled={isLoading}
            />
            <button
                style={buttonStyle}
                onClick={handleGenerate}
                disabled={isLoading || !prompt.trim()}
            >
                {isLoading ? "Generating..." : "Generate Structure"}
            </button>
            {error && <div style={errorStyle}>{error}</div>}

            {/* Added HCaptcha Component */}
            <div style={{ marginTop: "10px" }}>
                <HCaptcha
                    ref={hCaptchaRef}
                    sitekey={process.env.REACT_APP_HCAPTCHA_SITE_KEY}
                    onVerify={(token) => {
                        setHCaptchaToken(token);
                        setCaptchaError(null);
                    }}
                    onExpire={() => {
                        setHCaptchaToken(null);
                        setCaptchaError(
                            "CAPTCHA expired. Please verify again."
                        );
                    }}
                    onError={(err) => {
                        setHCaptchaToken(null);
                        setCaptchaError(`CAPTCHA error: ${err}`);
                    }}
                />
            </div>
            {captchaError && <div style={errorStyle}>{captchaError}</div>}

            {/* Added History Section */}
            {generationHistory.length > 0 && (
                <div style={historyListStyle}>
                    <h5>History:</h5>
                    {generationHistory.map((entry, index) => (
                        <div
                            key={index} // Using index as key is okay here since list order changes predictably
                            style={historyItemStyle}
                            // Add hover effect inline for simplicity
                            onMouseEnter={(e) =>
                                (e.currentTarget.style.background =
                                    historyItemHoverStyle.background)
                            }
                            onMouseLeave={(e) =>
                                (e.currentTarget.style.background =
                                    historyItemStyle.background)
                            }
                            onClick={() => loadAISchematic(entry.schematic)}
                            title={`Load: ${entry.prompt}`} // Tooltip shows full prompt
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
