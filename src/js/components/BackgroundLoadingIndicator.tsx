import React, { useEffect, useState } from "react";
import "../../css/BackgroundLoadingIndicator.css";

/**
 * Persistent background loading indicator for post-load operations
 * Shows a single notification at the top-center that updates content
 */
const BackgroundLoadingIndicator = () => {
    const [loadingState, setLoadingState] = useState({
        isVisible: false,
        message: "",
        progress: null,
    });

    useEffect(() => {
        // Listen for background loading events
        const handleBackgroundLoadingStart = (event) => {
            const { message, progress } = event.detail;
            setLoadingState({
                isVisible: true,
                message: message || "Loading background content...",
                progress: progress,
            });
        };

        const handleBackgroundLoadingUpdate = (event) => {
            const { message, progress } = event.detail;
            setLoadingState(prevState => ({
                ...prevState,
                isVisible: true, // Ensure it stays visible during updates
                message: message || prevState.message,
                progress: progress !== undefined ? progress : prevState.progress,
            }));
        };

        const handleBackgroundLoadingComplete = () => {
            // Fade out after a brief delay for better UX
            setTimeout(() => {
                setLoadingState({
                    isVisible: false,
                    message: "",
                    progress: null,
                });
            }, 800);
        };

        // Listen for custom events
        window.addEventListener('backgroundLoadingStart', handleBackgroundLoadingStart);
        window.addEventListener('backgroundLoadingUpdate', handleBackgroundLoadingUpdate);
        window.addEventListener('backgroundLoadingComplete', handleBackgroundLoadingComplete);

        return () => {
            window.removeEventListener('backgroundLoadingStart', handleBackgroundLoadingStart);
            window.removeEventListener('backgroundLoadingUpdate', handleBackgroundLoadingUpdate);
            window.removeEventListener('backgroundLoadingComplete', handleBackgroundLoadingComplete);
        };
    }, []);

    if (!loadingState.isVisible) {
        return null;
    }

    return (
        <div className="background-loading-indicator">
            <div className="background-loading-content">
                <div className="background-loading-spinner"></div>
                <div className="background-loading-message">
                    {loadingState.message}
                </div>
                {loadingState.progress !== null && (
                    <div className="background-loading-progress">
                        <div 
                            className="background-progress-bar"
                            style={{ width: `${Math.round(loadingState.progress)}%` }}
                        ></div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default BackgroundLoadingIndicator;