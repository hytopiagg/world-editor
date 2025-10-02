/**
 * SelectionDimensionsManager - Global pub/sub for live selection dimension tips
 */
export type SelectionDimensionsPayload = {
    kind: "ground" | "wall" | "selection" | "other";
    width?: number; // X dimension in blocks
    length?: number; // Z dimension in blocks
    height?: number; // Y dimension in blocks
    thickness?: number; // For walls or special cases
    meta?: string; // Extra info, e.g., "circle", "hollow:2"
};

type Listener = (payload: SelectionDimensionsPayload | null) => void;

class SelectionDimensionsManager {
    static listeners: Listener[] = [];
    static current: SelectionDimensionsPayload | null = null;

    static setDimensions(payload: SelectionDimensionsPayload) {
        SelectionDimensionsManager.current = payload;
        SelectionDimensionsManager.listeners.forEach((listener) => {
            try {
                listener(payload);
            } catch (error) {
                console.error("Error notifying selection dimensions listener:", error);
            }
        });
    }

    static clear() {
        SelectionDimensionsManager.current = null;
        SelectionDimensionsManager.listeners.forEach((listener) => {
            try {
                listener(null);
            } catch (error) {
                console.error("Error notifying selection dimensions listener:", error);
            }
        });
    }

    static getCurrent(): SelectionDimensionsPayload | null {
        return SelectionDimensionsManager.current;
    }

    static addListener(listener: Listener) {
        if (typeof listener === "function") {
            SelectionDimensionsManager.listeners.push(listener);
        }
    }

    static removeListener(listener: Listener) {
        SelectionDimensionsManager.listeners = SelectionDimensionsManager.listeners.filter(
            (l) => l !== listener
        );
    }
}

export default SelectionDimensionsManager;


