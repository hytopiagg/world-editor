/**
 * QuickTipsManager - A simple global state manager for tooltips
 *
 * This manager allows setting and getting the current tool tip text
 * from anywhere in the application without complex React state management.
 */
class QuickTipsManager {
    static listeners = [];
    static defaultTip =
        "Move the camera with W, A, S, D. Right click to rotate. 0 to toggle camera mode. Middle click to drag-move.";
    static currentTip = QuickTipsManager.defaultTip;
    /**
     * Set the current tool tip text
     * @param {string} tipText - The tooltip text to display
     */
    static setToolTip(tipText) {
        QuickTipsManager.currentTip = tipText;

        QuickTipsManager.listeners.forEach((listener) => {
            try {
                listener(tipText);
            } catch (error) {
                console.error("Error notifying tooltip listener:", error);
            }
        });
    }
    static setToDefaultTip() {
        QuickTipsManager.currentTip = QuickTipsManager.defaultTip;

        QuickTipsManager.listeners.forEach((listener) => {
            try {
                listener(QuickTipsManager.defaultTip);
            } catch (error) {
                console.error("Error notifying tooltip listener:", error);
            }
        });
    }
    /**
     * Get the current tool tip text
     * @returns {string} The current tooltip text
     */
    static getToolTip() {
        return QuickTipsManager.currentTip;
    }
    /**
     * Add a listener function to be called when the tip changes
     * @param {Function} listener - Function to call with the new tip text
     */
    static addListener(listener) {
        if (typeof listener === "function") {
            QuickTipsManager.listeners.push(listener);
        }
    }
    /**
     * Remove a previously added listener
     * @param {Function} listener - The listener to remove
     */
    static removeListener(listener) {
        QuickTipsManager.listeners = QuickTipsManager.listeners.filter(
            (l) => l !== listener
        );
    }
}
export default QuickTipsManager;
