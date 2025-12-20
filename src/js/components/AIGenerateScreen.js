import React, { useState, useRef, useEffect } from "react";
import PropTypes from "prop-types";
import { FaArrowLeft, FaMagic, FaSync, FaPencilAlt, FaSave } from "react-icons/fa";
import Button from "./buttons/Button";
import HCaptcha from "@hcaptcha/react-hcaptcha";

const GRID_SIZE = 24;

const AIGenerateScreen = ({ 
    onBack, 
    onEditTexture, 
    onSaveDirectly,
    onClose 
}) => {
    const [prompt, setPrompt] = useState("");
    const [textureName, setTextureName] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [generatedTexture, setGeneratedTexture] = useState(null);
    const [hCaptchaToken, setHCaptchaToken] = useState(null);
    const [captchaError, setCaptchaError] = useState(null);
    const hCaptchaRef = useRef(null);
    const canvasRef = useRef(null);

    const examples = [
        "mossy stone brick",
        "rusty metal panel",
        "wooden planks",
        "ice crystals",
        "sand with pebbles",
        "glowing crystal",
    ];

    useEffect(() => {
        if (generatedTexture && canvasRef.current) {
            const ctx = canvasRef.current.getContext("2d");
            const img = new Image();
            img.onload = () => {
                ctx.imageSmoothingEnabled = false;
                ctx.clearRect(0, 0, GRID_SIZE, GRID_SIZE);
                ctx.drawImage(img, 0, 0, GRID_SIZE, GRID_SIZE);
            };
            img.src = generatedTexture;
        }
    }, [generatedTexture]);

    const handleGenerate = async () => {
        if (!prompt.trim()) {
            setError("Please enter a prompt.");
            return;
        }

        // Check captcha
        if (!hCaptchaToken) {
            try {
                await hCaptchaRef.current?.execute({ async: true });
                return; // Will retry after captcha verification
            } catch (err) {
                setCaptchaError("Please complete the captcha.");
                return;
            }
        }

        setIsLoading(true);
        setError(null);
        setGeneratedTexture(null);

        try {
            const response = await fetch(
                `${process.env.REACT_APP_API_URL}/generate_texture`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        prompt: prompt.trim(),
                        hCaptchaToken,
                    }),
                }
            );

            if (!response.ok) {
                const text = await response.text();
                throw new Error(text || "Failed to generate texture");
            }

            const data = await response.json();

            if (data.base64_image) {
                const imageDataUrl = `data:image/png;base64,${data.base64_image}`;
                setGeneratedTexture(imageDataUrl);
                // Auto-fill texture name from prompt if empty
                if (!textureName.trim()) {
                    setTextureName(prompt.trim().slice(0, 30));
                }
            } else {
                throw new Error("No image data received from API");
            }
        } catch (err) {
            setError(err.message || "Failed to generate texture");
        } finally {
            setIsLoading(false);
            setHCaptchaToken(null);
            hCaptchaRef.current?.resetCaptcha();
        }
    };

    const handleEditTexture = () => {
        if (generatedTexture) {
            onEditTexture(generatedTexture, textureName.trim() || prompt.trim());
        }
    };

    const handleSaveDirectly = () => {
        if (generatedTexture && textureName.trim()) {
            onSaveDirectly(generatedTexture, textureName.trim());
        }
    };

    // Auto-trigger generate after captcha verification
    useEffect(() => {
        if (hCaptchaToken && prompt.trim() && !isLoading && !generatedTexture) {
            handleGenerate();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hCaptchaToken]);

    return (
        <div className="flex flex-col items-center gap-5 p-6 min-w-[400px]">
            {/* Header */}
            <div className="flex items-center w-full">
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 text-white/50 hover:text-white transition-colors"
                >
                    <FaArrowLeft size={14} />
                    <span className="text-sm">Back</span>
                </button>
                <h2 className="flex-1 text-center text-xl font-bold text-white flex items-center justify-center gap-2">
                    <FaMagic className="text-purple-400" />
                    AI Generate
                </h2>
                <button
                    onClick={onClose}
                    className="text-white/50 hover:text-white transition-colors w-10 h-10 flex items-center justify-center"
                >
                    ✕
                </button>
            </div>

            {/* Preview Area */}
            <div className="relative">
                <div 
                    className={`
                        w-40 h-40 rounded-xl border-2 border-white/10 
                        bg-black/30 flex items-center justify-center
                        overflow-hidden
                        ${isLoading ? 'animate-pulse' : ''}
                    `}
                    style={{
                        backgroundImage: !generatedTexture && !isLoading ? 
                            'linear-gradient(45deg, #1a1a1a 25%, transparent 25%), linear-gradient(-45deg, #1a1a1a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1a1a1a 75%), linear-gradient(-45deg, transparent 75%, #1a1a1a 75%)' : 
                            'none',
                        backgroundSize: '20px 20px',
                        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
                    }}
                >
                    {isLoading ? (
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-8 h-8 border-3 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                            <span className="text-white/50 text-xs">Generating...</span>
                        </div>
                    ) : generatedTexture ? (
                        <canvas
                            ref={canvasRef}
                            width={GRID_SIZE}
                            height={GRID_SIZE}
                            className="w-full h-full"
                            style={{ imageRendering: "pixelated" }}
                        />
                    ) : (
                        <span className="text-white/30 text-sm">Preview</span>
                    )}
                </div>
            </div>

            {/* Error Display */}
            {(error || captchaError) && (
                <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2">
                    {error || captchaError}
                </div>
            )}

            {/* Prompt Input */}
            <div className="w-full max-w-md space-y-2">
                <label className="text-white/60 text-xs">Describe your texture:</label>
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter" && !e.shiftKey && !isLoading) {
                            e.preventDefault();
                            handleGenerate();
                        }
                    }}
                    placeholder="e.g., mossy stone brick with cracks"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-white text-sm resize-none focus:border-purple-500/50 focus:outline-none transition-colors"
                    rows={2}
                    disabled={isLoading}
                    autoFocus
                />
                
                {/* Example chips */}
                <div className="flex flex-wrap gap-1.5">
                    <span className="text-white/40 text-xs">Try:</span>
                    {examples.slice(0, 4).map((example) => (
                        <button
                            key={example}
                            onClick={() => setPrompt(example)}
                            className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70 transition-colors"
                        >
                            {example}
                        </button>
                    ))}
                </div>
            </div>

            {/* Generate Button */}
            {!generatedTexture && (
                <Button
                    design="primary"
                    tier={3}
                    onClick={handleGenerate}
                    disabled={isLoading || !prompt.trim()}
                    style={{
                        fontSize: "14px",
                        padding: "10px 24px",
                        borderRadius: "10px",
                    }}
                >
                    {isLoading ? (
                        <span className="flex items-center gap-2">
                            <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                            Generating...
                        </span>
                    ) : (
                        <span className="flex items-center gap-2">
                            <FaMagic />
                            Generate
                        </span>
                    )}
                </Button>
            )}

            {/* Post-Generation Actions */}
            {generatedTexture && (
                <div className="w-full max-w-md space-y-3">
                    <div className="space-y-1.5">
                        <label className="text-white/60 text-xs">Texture name:</label>
                        <input
                            type="text"
                            value={textureName}
                            onChange={(e) => setTextureName(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                            placeholder="Enter a name..."
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-purple-500/50 focus:outline-none transition-colors"
                        />
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={() => {
                                setGeneratedTexture(null);
                                handleGenerate();
                            }}
                            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white text-sm rounded-lg transition-all"
                        >
                            <FaSync size={12} />
                            Regenerate
                        </button>
                        <button
                            onClick={handleEditTexture}
                            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 hover:border-blue-500/60 text-blue-300 text-sm rounded-lg transition-all"
                        >
                            <FaPencilAlt size={12} />
                            Edit This
                        </button>
                        <button
                            onClick={handleSaveDirectly}
                            disabled={!textureName.trim()}
                            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 hover:border-emerald-500/60 text-emerald-300 text-sm rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <FaSave size={12} />
                            Save & Use
                        </button>
                    </div>
                </div>
            )}

            {/* Invisible hCaptcha */}
            <div style={{ position: "fixed", visibility: "hidden", bottom: 0, right: 0 }}>
                <HCaptcha
                    ref={hCaptchaRef}
                    theme="dark"
                    size="invisible"
                    sitekey={process.env.REACT_APP_HCAPTCHA_SITE_KEY}
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
    );
};

AIGenerateScreen.propTypes = {
    onBack: PropTypes.func.isRequired,
    onEditTexture: PropTypes.func.isRequired,
    onSaveDirectly: PropTypes.func.isRequired,
    onClose: PropTypes.func.isRequired,
};

export default AIGenerateScreen;

