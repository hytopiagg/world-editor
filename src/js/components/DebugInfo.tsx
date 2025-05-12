import React, { useState, useEffect, useRef } from "react";
import "../../css/DebugInfo.css";
const DebugInfo = ({
    debugInfo,
    totalBlocks,
    totalEnvironmentObjects,
    terrainBuilderRef,
}) => {
    const [fps, setFps] = useState(0);
    const [showPerformanceDetails, setShowPerformanceDetails] = useState(false);
    const [selectionDistance, setSelectionDistance] = useState(128);
    const [viewDistance, setViewDistance] = useState(128);
    const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
    const frameTimesRef = useRef([]);
    const lastTimeRef = useRef(performance.now());
    const frameRef = useRef(null);
    useEffect(() => {

        if (terrainBuilderRef && terrainBuilderRef.current) {
            if (terrainBuilderRef.current.getViewDistance) {
                setViewDistance(terrainBuilderRef.current.getViewDistance());
            }
            if (terrainBuilderRef.current.getSelectionDistance) {
                setSelectionDistance(
                    terrainBuilderRef.current.getSelectionDistance()
                );
            }
            if (terrainBuilderRef.current.isAutoSaveEnabled) {
                setAutoSaveEnabled(
                    terrainBuilderRef.current.isAutoSaveEnabled()
                );
            }
        }

        frameRef.current = requestAnimationFrame(measureFps);
        return () => {
            if (frameRef.current) {
                cancelAnimationFrame(frameRef.current);
            }
        };
    }, [terrainBuilderRef]);
    const measureFps = () => {
        const now = performance.now();
        const delta = now - lastTimeRef.current;
        lastTimeRef.current = now;

        if (delta < 1000) {
            frameTimesRef.current.push(delta);

            if (frameTimesRef.current.length > 60) {
                frameTimesRef.current.shift();
            }

            const avg =
                frameTimesRef.current.reduce((sum, time) => sum + time, 0) /
                frameTimesRef.current.length;
            const currentFps = Math.round(1000 / avg);

            setFps(currentFps);
        }
        frameRef.current = requestAnimationFrame(measureFps);
    };
    const handleSelectionDistanceChange = (e) => {
        const newValue = parseInt(e.target.value);
        setSelectionDistance(newValue);
        if (
            terrainBuilderRef &&
            terrainBuilderRef.current &&
            terrainBuilderRef.current.setSelectionDistance
        ) {
            terrainBuilderRef.current.setSelectionDistance(newValue);
        }
    };
    const handleViewDistanceChange = (e) => {
        const newValue = parseInt(e.target.value);
        setViewDistance(newValue);

        if (handleViewDistanceChange.timeoutId) {
            clearTimeout(handleViewDistanceChange.timeoutId);
        }

        handleViewDistanceChange.timeoutId = setTimeout(() => {
            if (
                terrainBuilderRef &&
                terrainBuilderRef.current &&
                terrainBuilderRef.current.setViewDistance
            ) {
                terrainBuilderRef.current.setViewDistance(newValue);
            }
        }, 50); // Short delay for smoother slider movement
    };

    handleViewDistanceChange.timeoutId = null;
    const handleAutoSaveToggle = (e) => {
        const newValue = e.target.checked;
        setAutoSaveEnabled(newValue);
        if (
            terrainBuilderRef &&
            terrainBuilderRef.current &&
            terrainBuilderRef.current.toggleAutoSave
        ) {
            terrainBuilderRef.current.toggleAutoSave(newValue);
        }
    };
    const togglePerformanceDetails = () => {
        setShowPerformanceDetails(!showPerformanceDetails);
    };
    return (
        <div className="w-full h-fit mt-auto px-3 text-xs font-normal">
            <div className="debug-row">
                <span className="debug-label">FPS:</span>
                <span className="debug-value">
                    <b
                        className={
                            fps < 30
                                ? "fps-low"
                                : fps < 50
                                ? "fps-medium"
                                : "fps-high"
                        }
                    >
                        {fps}
                    </b>
                </span>
            </div>
            <div className="debug-row">
                <span className="debug-label whitespace-nowrap">{`Preview Position:`}</span>
                <span className="debug-value w-full">
                    <b className="w-auto" style={{
                        width: "auto"
                    }}>{`${debugInfo?.preview?.x}, ${debugInfo?.preview?.y}, ${debugInfo?.preview?.z}`}</b>
                </span>
            </div>
            <div className="debug-row">
                <span className="debug-label">Total Blocks:</span>
                <span className="debug-value">
                    <b>{totalBlocks || 0}</b>
                </span>
            </div>
            <div className="debug-row">
                <span className="debug-label">Total Env. Objects:</span>
                <span className="debug-value">
                    <b>{totalEnvironmentObjects}</b>
                </span>
            </div>
            <div className="debug-row performance-settings">
                <span
                    className="debug-label"
                    onClick={togglePerformanceDetails}
                    style={{ cursor: "pointer" }}
                >
                    Performance Settings {showPerformanceDetails ? "▼" : "►"}
                </span>
                {showPerformanceDetails && (
                    <div className="debug-value performance-toggles">
                        <label className="toggle-label">
                            <input
                                type="checkbox"
                                checked={autoSaveEnabled}
                                onChange={handleAutoSaveToggle}
                            />
                            Enable Auto-Save (5 min)
                        </label>
                        <div className="slider-container">
                            <span className="slider-label">
                                Selection Distance: {selectionDistance}
                            </span>
                            <input
                                type="range"
                                min="16"
                                max="256"
                                step="8"
                                value={selectionDistance}
                                onChange={handleSelectionDistanceChange}
                                className="range-slider"
                            />
                        </div>
                        <div className="slider-container">
                            <span className="slider-label">
                                View Distance: {viewDistance}
                            </span>
                            <input
                                type="range"
                                min="32"
                                max="256"
                                step="16"
                                value={viewDistance}
                                onChange={handleViewDistanceChange}
                                className="range-slider"
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
export default DebugInfo;
