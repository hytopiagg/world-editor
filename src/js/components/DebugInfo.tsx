import { useEffect, useRef, useState } from "react";
import "../../css/DebugInfo.css";
const DebugInfo = ({
    debugInfo,
    totalBlocks,
    totalEnvironmentObjects,
    terrainBuilderRef,
}) => {
    const [fps, setFps] = useState(0);
    const frameTimesRef = useRef([]);
    const lastTimeRef = useRef(performance.now());
    const frameRef = useRef(null);
    useEffect(() => {
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

    return (
        <div className="w-full h-fit text-xs font-normal fade-up opacity-0 gap-y-1 flex flex-col"
            style={{
                animationDelay: "0.05s"
            }}
        >
            <div className="flex justify-between w-full text-right">
                <span className="text-left text-xs text-[#F1F1F1] whitespace-nowrap">FPS:</span>
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
            <div className="flex justify-between w-full text-right">
                <span className="text-left text-xs text-[#F1F1F1] whitespace-nowrap">{`Preview Position:`}</span>
                <span className="debug-value w-full">
                    <b className="w-auto" style={{
                        width: "auto"
                    }}>{`${debugInfo?.preview?.x}, ${debugInfo?.preview?.y}, ${debugInfo?.preview?.z}`}</b>
                </span>
            </div>
            <div className="flex justify-between w-full text-right">
                <span className="text-left text-xs text-[#F1F1F1] whitespace-nowrap">Total Blocks:</span>
                <span className="debug-value">
                    <b>{totalBlocks || 0}</b>
                </span>
            </div>
            <div className="flex justify-between w-full text-right">
                <span className="text-left text-xs text-[#F1F1F1] whitespace-nowrap">Total Env. Objects:</span>
                <span className="debug-value">
                    <b>{totalEnvironmentObjects}</b>
                </span>
            </div>
        </div>
    );
};
export default DebugInfo;
