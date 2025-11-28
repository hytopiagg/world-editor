import React, { useState, useEffect, useRef } from "react";
import "../../css/QuickTips.css";
import { FaTimes } from "react-icons/fa";
import QuickTipsManager from "./QuickTipsManager";
import { detectPlatform } from "../utils/env";
const QuickTips = () => {
    const [isVisible, setIsVisible] = useState(true);
    const [tipText, setTipText] = useState<React.ReactNode>(QuickTipsManager.getToolTip());
    const [isFading, setIsFading] = useState(false);
    const [isDownloadCTA, setIsDownloadCTA] = useState(false);
    const fadeTimeoutRef = useRef(null);
    const isDownloadCTARef = useRef(false);

    // Keep ref in sync with state
    useEffect(() => {
        isDownloadCTARef.current = isDownloadCTA;
    }, [isDownloadCTA]);

    const startFadeTimer = (ms = 10000) => {
        if (fadeTimeoutRef.current) {
            clearTimeout(fadeTimeoutRef.current);
        }
        setIsFading(false);
        fadeTimeoutRef.current = setTimeout(() => {
            setIsFading(true);
        }, ms);
    };
    useEffect(() => {
        // Show a desktop app CTA on first load (web only) if not previously dismissed
        try {
            const dismissed = localStorage.getItem("downloadElectronDismissed") === "true";
            if (!dismissed) {
                const platform = detectPlatform();
                const owner = "hytopiagg";
                const repo = "builder-desktop-releases";  // Fixed: was "world-editor"
                const latestBase = `https://github.com/${owner}/${repo}/releases/latest/download`;
                const assetForPlatform = platform === "mac"
                    ? "Hytopia-World-Editor-mac-universal.dmg"  // Fixed: was mac-x64
                    : platform === "win"
                        ? "Hytopia-World-Editor-win.exe"  // Fixed: was win-x64.exe (use NSIS installer)
                        : platform === "linux"
                            ? "Hytopia-World-Editor-linux-x64.AppImage"
                            : "";
                const href = assetForPlatform
                    ? `${latestBase}/${assetForPlatform}`
                    : `https://github.com/${owner}/${repo}#desktop-app-electron`;  // Fixed: updated repo
                setTipText(
                    <span>
                        Prefer a smoother experience? <a href={href} target="_blank" rel="noreferrer">Download the Desktop App</a>.
                    </span>
                );
                setIsDownloadCTA(true);
                startFadeTimer(15000);
            } else {
                startFadeTimer();
            }
        } catch (_) {
            startFadeTimer();
        }

        const handleTipChange = (newTip) => {
            if (isDownloadCTARef.current) return; // ignore updates while CTA is showing
            setTipText(newTip);
            setIsVisible(true);
            startFadeTimer();
        };
        QuickTipsManager.addListener(handleTipChange);
        return () => {
            if (fadeTimeoutRef.current) {
                clearTimeout(fadeTimeoutRef.current);
            }
            QuickTipsManager.removeListener(handleTipChange);
        };
    }, []); // Empty dependency array - only run once on mount
    const toggleVisibility = () => {
        if (fadeTimeoutRef.current) {
            clearTimeout(fadeTimeoutRef.current);
            fadeTimeoutRef.current = null;
        }
        setIsVisible(!isVisible);
        setIsFading(false);
        if (isDownloadCTA) {
            try { localStorage.setItem("downloadElectronDismissed", "true"); } catch (_) { }
            setIsDownloadCTA(false);
        }
    };
    const containerClassName = `quick-tips-container ${isFading ? "fading" : ""
        }`;
    return (
        isVisible && (
            <div className={containerClassName}>
                <div className="py-2 filter backdrop-blur-lg quick-tips">
                    <p className="tip-title">Quick Tips:</p>
                    <p className="tip-text">
                        {tipText ? (
                            tipText
                        ) : (
                            <span>
                                <b>W</b>, <b>A</b>, <b>S</b>, <b>D</b> to move,{" "}
                                <b>SHIFT</b> to fly down, <b>SPACE</b> to fly
                                up. <b>Right-click</b> to rotate camera.{" "}
                                <b>0</b> to toggle camera mode.
                            </span>
                        )}
                    </p>
                    <div
                        className="tip-close-button"
                        onClick={toggleVisibility}
                    >
                        <FaTimes />
                    </div>
                </div>
            </div>
        )
    );
};
export default QuickTips;
