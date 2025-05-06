/**
 * MouseButtonManager - Tracks mouse button states globally
 * Extracted from TerrainBuilder.js
 */


window.mouseButtons = 0;

/**
 * Updates the global mouse buttons state when a button is pressed
 * @param {MouseEvent} e - The mouse event
 */
const updateMouseButtonsDown = (e) => {
    window.mouseButtons |= 1 << e.button;
};

/**
 * Updates the global mouse buttons state when a button is released
 * @param {MouseEvent} e - The mouse event
 */
const updateMouseButtonsUp = (e) => {
    window.mouseButtons &= ~(1 << e.button);
};

/**
 * Initializes the mouse button tracking by adding event listeners
 */
const initializeMouseButtonTracking = () => {
    document.addEventListener("mousedown", updateMouseButtonsDown);
    document.addEventListener("mouseup", updateMouseButtonsUp);
    document.addEventListener("mouseleave", updateMouseButtonsUp); // Handle case when mouse leaves window
};

/**
 * Cleans up the mouse button tracking by removing event listeners
 */
const cleanupMouseButtonTracking = () => {
    document.removeEventListener("mousedown", updateMouseButtonsDown);
    document.removeEventListener("mouseup", updateMouseButtonsUp);
    document.removeEventListener("mouseleave", updateMouseButtonsUp);
};

export { initializeMouseButtonTracking, cleanupMouseButtonTracking };