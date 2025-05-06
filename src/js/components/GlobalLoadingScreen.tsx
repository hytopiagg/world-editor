import React, { useEffect, useState } from "react";
import "../../css/GlobalLoadingScreen.css";
import { version } from "../Constants";
import { loadingManager } from "../managers/LoadingManager";
const GlobalLoadingScreen = () => {
    const [loadingState, setLoadingState] = useState({
        isLoading: false,
        message: "",
        progress: null,
    });
    useEffect(() => {

        const unsubscribe = loadingManager.addListener((state) => {

            if (state.progress !== loadingState.progress) {

            }
            setLoadingState(state);
        });

        return () => unsubscribe();
    }, [loadingState.progress]);
    if (!loadingState.isLoading) {
        return null;
    }
    return (
        <div className="global-loading-screen">
            <div className="loading-content">
                <img
                    src={'/assets/img/hytopia_logo_white.png'}
                    alt="Hytopia Logo"
                    className="loading-logo"
                />
                <div className="loading-spinner"></div>
                <div className="loading-text">
                    <i>{loadingState.message || "Loading..."}</i>
                </div>
                {loadingState.progress !== null && (
                    <div className="loading-progress">
                        <div className="progress-bar">
                            <div
                                className="progress-fill"
                                style={{
                                    width: `${Math.round(loadingState.progress)}%`,
                                    transition: "width 0.2s ease-out",
                                }}
                            ></div>
                        </div>
                        <div className="progress-text">
                            {Math.round(loadingState.progress)}%
                        </div>
                    </div>
                )}
                <div className="version-text">
                    HYTOPIA Map Builder v{version}
                </div>
            </div>
        </div>
    );
};
export default GlobalLoadingScreen;
