import { useState, useEffect } from "react";
import "../../css/QuickTips.css";
import { FaTimes } from "react-icons/fa";
import QuickTipsManager from "./QuickTipsManager";

const QuickTips = () => {
    const [isVisible, setIsVisible] = useState(true);
    const [tipText, setTipText] = useState(QuickTipsManager.getToolTip());

    useEffect(() => {
        // Register a listener to update the tip text
        const handleTipChange = (newTip) => {
            setTipText(newTip);
        };

        // Add the listener
        QuickTipsManager.addListener(handleTipChange);

        // Clean up when component unmounts
        return () => {
            QuickTipsManager.removeListener(handleTipChange);
        };
    }, []);

    const toggleVisibility = () => {
        setIsVisible(!isVisible);
    };

    return (
        isVisible && (
            <div className="quick-tips-container">
                <div className="quick-tips">
                    <p className="tip-title">Quick Tips:</p>
                    <p className="tip-text">{tipText}</p>
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
