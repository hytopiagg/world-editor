import { useState, useEffect, useRef } from "react";
import "../../css/QuickTips.css";
import { FaTimes } from "react-icons/fa";
import QuickTipsManager from "./QuickTipsManager";
const QuickTips = () => {
    const [isVisible, setIsVisible] = useState(true);
    const [tipText, setTipText] = useState(QuickTipsManager.getToolTip());
    const [isFading, setIsFading] = useState(false);
    const fadeTimeoutRef = useRef(null);
    const startFadeTimer = () => {
        if (fadeTimeoutRef.current) {
            clearTimeout(fadeTimeoutRef.current);
        }
        setIsFading(false);
        fadeTimeoutRef.current = setTimeout(() => {
            setIsFading(true);
        }, 10000);
    };
    useEffect(() => {
        startFadeTimer();
        const handleTipChange = (newTip) => {
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
    }, [tipText]);
    const toggleVisibility = () => {
        if (fadeTimeoutRef.current) {
            clearTimeout(fadeTimeoutRef.current);
            fadeTimeoutRef.current = null;
        }
        setIsVisible(!isVisible);
        setIsFading(false);
    };
    const containerClassName = `quick-tips-container ${isFading ? "fading" : ""
        }`;
    return (
        isVisible && (
            <div className={containerClassName}>
                <div className="quick-tips py-2 filter backdrop-blur-lg">
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
