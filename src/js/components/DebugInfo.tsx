import { useEffect, useRef, useState } from "react";
import "../../css/DebugInfo.css";
const DebugInfo = ({
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
        <div className="w-full h-fit text-xs font-normal gap-y-1 flex flex-col"
        >
            <div className="flex justify-between w-full text-right fade-down opacity-0 duration-150"
                style={{
                    animationDelay: "0.03s"
                }}
            >
                <span className="text-left text-xs text-[#F1F1F1] whitespace-nowrap">FPS:</span>
                <span className="text-right">
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
            <div className="flex justify-between w-full text-right fade-down opacity-0 duration-150"
                style={{
                    animationDelay: "0.06s"
                }}
            >
                <span className="text-left text-xs text-[#F1F1F1] whitespace-nowrap">Preview Position</span>
                <span className="text-right">
                    {`${Math.round(terrainBuilderRef?.current?.previewPositionRef?.x * 10) / 10}, ${Math.round(terrainBuilderRef?.current?.previewPositionRef?.y * 100) / 100}, ${Math.round(terrainBuilderRef?.current?.previewPositionRef?.z * 100) / 100}`}
                </span>
            </div>
            <div className="flex justify-between w-full text-right fade-down opacity-0 duration-150"
                style={{
                    animationDelay: "0.09s"
                }}
            >
                <span className="text-left text-xs text-[#F1F1F1] whitespace-nowrap">Total Blocks:</span>
                <span className="">
                    {terrainBuilderRef?.current?.totalBlocksRef || 0}
                </span>
            </div>
            <div className="flex justify-between w-full text-right fade-down opacity-0 duration-150"
                style={{
                    animationDelay: "0.12s"
                }}
            >
                <span className="text-left text-xs text-[#F1F1F1] whitespace-nowrap">Total Env. Objects:</span>
                <span className="text-right">{totalEnvironmentObjects}
                </span>
            </div>
        </div>
    );
};
export default DebugInfo;
