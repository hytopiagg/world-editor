/**
 * ToastManager - A simple global state manager for toast notifications
 *
 * This manager allows showing toast notifications from anywhere in the application.
 * Supports multiple toasts that stack vertically.
 */

interface Toast {
    id: string;
    message: string;
    timestamp: number;
}

class ToastManager {
    static listeners: Array<(toasts: Toast[]) => void> = [];
    static toasts: Toast[] = [];
    static timeouts: Map<string, NodeJS.Timeout> = new Map();
    static maxToasts: number = 3;

    /**
     * Show a toast notification
     * @param {string} message - The message to display
     * @param {number} duration - Duration in milliseconds (default: 2000)
     */
    static showToast(message: string, duration: number = 2000) {
        const id = `toast-${Date.now()}-${Math.random()}`;
        const toast: Toast = {
            id,
            message,
            timestamp: Date.now(),
        };

        // Add toast to the beginning of the array (newest first)
        ToastManager.toasts.unshift(toast);

        // Limit the number of toasts
        if (ToastManager.toasts.length > ToastManager.maxToasts) {
            const removedToast = ToastManager.toasts.pop();
            if (removedToast && ToastManager.timeouts.has(removedToast.id)) {
                clearTimeout(ToastManager.timeouts.get(removedToast.id)!);
                ToastManager.timeouts.delete(removedToast.id);
            }
        }

        // Notify all listeners
        ToastManager.notifyListeners();

        // Auto-hide after duration
        const timeout = setTimeout(() => {
            ToastManager.removeToast(id);
        }, duration);
        ToastManager.timeouts.set(id, timeout);
    }

    /**
     * Remove a specific toast by ID
     */
    static removeToast(id: string) {
        ToastManager.toasts = ToastManager.toasts.filter((toast) => toast.id !== id);
        if (ToastManager.timeouts.has(id)) {
            clearTimeout(ToastManager.timeouts.get(id)!);
            ToastManager.timeouts.delete(id);
        }
        ToastManager.notifyListeners();
    }

    /**
     * Clear all toasts
     */
    static clearAll() {
        ToastManager.toasts.forEach((toast) => {
            if (ToastManager.timeouts.has(toast.id)) {
                clearTimeout(ToastManager.timeouts.get(toast.id)!);
            }
        });
        ToastManager.toasts = [];
        ToastManager.timeouts.clear();
        ToastManager.notifyListeners();
    }

    /**
     * Notify all listeners of current toast state
     */
    static notifyListeners() {
        ToastManager.listeners.forEach((listener) => {
            try {
                listener([...ToastManager.toasts]);
            } catch (error) {
                console.error("Error notifying toast listener:", error);
            }
        });
    }

    /**
     * Get all current toasts
     * @returns {Toast[]} Array of current toasts
     */
    static getToasts(): Toast[] {
        return [...ToastManager.toasts];
    }

    /**
     * Add a listener function to be called when toasts change
     * @param {Function} listener - Function to call with the array of toasts
     */
    static addListener(listener: (toasts: Toast[]) => void) {
        if (typeof listener === "function") {
            ToastManager.listeners.push(listener);
            // Immediately notify the new listener with current state
            try {
                listener([...ToastManager.toasts]);
            } catch (error) {
                console.error("Error notifying new toast listener:", error);
            }
        }
    }

    /**
     * Remove a previously added listener
     * @param {Function} listener - The listener to remove
     */
    static removeListener(listener: (toasts: Toast[]) => void) {
        ToastManager.listeners = ToastManager.listeners.filter(
            (l) => l !== listener
        );
    }
}

export default ToastManager;

