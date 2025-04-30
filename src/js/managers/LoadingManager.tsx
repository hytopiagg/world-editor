
class LoadingManager {
    listeners: Set<Function>;
    isLoading: boolean;
    message: string;
    progress: number | null;
    loadingTimers: Set<NodeJS.Timeout>;

    constructor() {
        this.listeners = new Set();
        this.isLoading = false;
        this.message = "";
        this.progress = null;
        this.loadingTimers = new Set(); // Track any loading timers
    }

    showLoading(message = "Loading...", progress = null) {

        this.clearTimers();

        this.isLoading = true;
        this.message = message;
        this.progress = progress;

        this.notifyListeners();

        const timerId = setTimeout(() => {

            if (this.message === message) {
                this.isLoading = true;
                this.notifyListeners();
            }
        }, 100);

        this.loadingTimers.add(timerId);
    }

    updateLoading(message = null, progress = null) {

        if (!this.isLoading) {
            this.isLoading = true;
        }
        if (message !== null) {
            this.message = message;
        }
        if (progress !== null) {
            this.progress = progress;
        }
        this.notifyListeners();
    }

    hideLoading() {
        this.isLoading = false;
        this.message = "";
        this.progress = null;
        this.notifyListeners();
    }

    forceHideAll() {
        this.clearTimers();
        this.hideLoading();
    }

    clearTimers() {
        this.loadingTimers.forEach((timerId) => {
            clearTimeout(timerId);
        });
        this.loadingTimers.clear();
    }

    addListener(listener) {
        this.listeners.add(listener);

        listener({
            isLoading: this.isLoading,
            message: this.message,
            progress: this.progress,
        });

        return () => {
            this.listeners.delete(listener);
        };
    }

    notifyListeners() {
        const state = {
            isLoading: this.isLoading,
            message: this.message,
            progress: this.progress,
        };
        this.listeners.forEach((listener) => {
            listener(state);
        });
    }
}

export const loadingManager = new LoadingManager();
