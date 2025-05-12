import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
const Tooltip = ({ children, text, hideTooltip = false }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [mousePosition, setMousePosition] = useState({
        x: 0,
        y: 0,
        isRightSide: false,
    });
    const [tooltipWidth, setTooltipWidth] = useState(0);
    const tooltipRef = useRef(null);
    useEffect(() => {
        if (isVisible && tooltipRef.current) {
            setTooltipWidth(tooltipRef.current.offsetWidth);
        }
    }, [isVisible]);

    const handleMouseEnter = (e) => {
        const screenWidth = window.innerWidth;
        const isRightSide = e.clientX > screenWidth / 2;
        setMousePosition({
            x: e.clientX,
            y: e.clientY,
            isRightSide,
        });
        setIsVisible(true);
    };
    const handleMouseLeave = (e) => {
        setIsVisible(false);
    };
    const handleMouseMove = (e) => {
        if (!isVisible) return;
        const screenWidth = window.innerWidth;
        const isRightSide = e.clientX > screenWidth / 2;
        setMousePosition({
            x: e.clientX,
            y: e.clientY,
            isRightSide,
        });
    };

    const renderTooltip = () => {
        if (!isVisible) return null;

        const screenHeight = window.innerHeight;
        const screenWidth = window.innerWidth;

        const isNearTop = mousePosition.y < 100;
        const isNearBottom = mousePosition.y > screenHeight - 100;
        const isNearLeft = mousePosition.x < 100;
        const isNearRight = mousePosition.x > screenWidth - 100;

        const isAboveCursor = isNearBottom;

        const verticalPosition = isAboveCursor
            ? { top: `${mousePosition.y - 60}px` } // Position above cursor if near bottom
            : { top: `${mousePosition.y + 30}px` }; // Position below cursor otherwise

        let horizontalPosition;
        if (isNearLeft) {
            horizontalPosition = { left: `${mousePosition.x + 10}px` };
        } else if (isNearRight) {
            horizontalPosition = {
                right: `${screenWidth - mousePosition.x + 10}px`,
            };
        } else {
            horizontalPosition = {
                left: `${mousePosition.x - tooltipWidth / 2}px`,
            };
        }

        let arrowPosition;
        if (isNearLeft) {

            arrowPosition = { left: "15px" };
        } else if (isNearRight) {

            arrowPosition = { right: "15px" };
        } else {

            arrowPosition = { left: "50%", transform: "translateX(-50%)" };
        }

        const bgColor = "rgba(13, 13, 13, 0.7)";
        return ReactDOM.createPortal(
            hideTooltip ? null : <div
                ref={tooltipRef}
                style={{
                    position: "fixed",
                    ...verticalPosition,
                    ...horizontalPosition,
                    backgroundColor: bgColor,
                    color: "white",
                    padding: "5px 10px",
                    borderRadius: "4px",
                    fontSize: "14px",
                    zIndex: 1000,
                    pointerEvents: "none",
                    opacity: tooltipWidth ? 1 : 0,
                    transition: "opacity 0.1s",
                    backdropFilter: "blur(5px)",
                    WebkitBackdropFilter: "blur(5px)", // For Safari support
                    boxShadow: "0 2px 10px rgba(0, 0, 0, 0.2)",
                }}
            >
                {/* Arrow pointing to cursor */}
                <div
                    style={{
                        position: "absolute",
                        width: 0,
                        height: 0,
                        borderLeft: "6px solid transparent",
                        borderRight: "6px solid transparent",
                        ...arrowPosition,
                        ...(isAboveCursor
                            ? {
                                bottom: "-6px",
                                borderTop: `6px solid ${bgColor}`,
                            }
                            : {
                                top: "-6px",
                                borderBottom: `6px solid ${bgColor}`,
                            }),
                    }}
                />
                {text}
            </div>,
            document.body
        );
    };
    return (
        <div
            className="relative"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onMouseMove={handleMouseMove}
        >
            {children}
            {renderTooltip()}
        </div>
    );
};
export default Tooltip;
