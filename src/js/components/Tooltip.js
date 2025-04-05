import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom";

const Tooltip = ({ children, text }) => {
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

    /// sets initial position when mouse enters the component
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

    // Render tooltip content with portal
    const renderTooltip = () => {
        if (!isVisible) return null;

        // Get screen dimensions
        const screenHeight = window.innerHeight;
        const screenWidth = window.innerWidth;

        // Check proximity to edges
        const isNearTop = mousePosition.y < 100;
        const isNearBottom = mousePosition.y > screenHeight - 100;
        const isNearLeft = mousePosition.x < 100;
        const isNearRight = mousePosition.x > screenWidth - 100;

        // Determine if tooltip should be above or below cursor
        const isAboveCursor = isNearBottom;

        // Determine vertical position
        const verticalPosition = isAboveCursor
            ? { top: `${mousePosition.y - 60}px` } // Position above cursor if near bottom
            : { top: `${mousePosition.y + 30}px` }; // Position below cursor otherwise

        // Determine horizontal position
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

        // Calculate arrow position
        let arrowPosition;
        if (isNearLeft) {
            // Arrow should be at the left side
            arrowPosition = { left: "15px" };
        } else if (isNearRight) {
            // Arrow should be at the right side
            arrowPosition = { right: "15px" };
        } else {
            // Arrow should be centered
            arrowPosition = { left: "50%", transform: "translateX(-50%)" };
        }

        // Define background color for reuse
        const bgColor = "rgba(13, 13, 13, 0.7)";

        return ReactDOM.createPortal(
            <div
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
