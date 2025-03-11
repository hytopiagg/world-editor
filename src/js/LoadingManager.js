// Loading manager to control the global loading state
class LoadingManager {
  constructor() {
    this.listeners = new Set();
    this.isLoading = false;
    this.message = '';
    this.progress = null;
    this.loadingTimers = new Set(); // Track any loading timers
  }

  // Show the loading screen with a message and optional progress
  showLoading(message = 'Loading...', progress = null) {
    // Clear any pending timers first to avoid conflicts
    this.clearTimers();
    
    this.isLoading = true;
    this.message = message;
    this.progress = progress;
    this.notifyListeners();
  }

  // Update the loading screen with new message or progress
  updateLoading(message = null, progress = null) {
    if (message !== null) {
      this.message = message;
    }
    
    if (progress !== null) {
      this.progress = progress;
    }
    
    this.notifyListeners();
  }

  // Hide the loading screen
  hideLoading() {
    this.isLoading = false;
    this.message = '';
    this.progress = null;
    this.notifyListeners();
  }

  // Force hide all loading screens and clear any pending timers
  forceHideAll() {
    this.clearTimers();
    this.hideLoading();
  }
  
  // Clear any pending timers
  clearTimers() {
    this.loadingTimers.forEach(timerId => {
      clearTimeout(timerId);
    });
    this.loadingTimers.clear();
  }

  // Add a listener to be notified of loading state changes
  addListener(listener) {
    this.listeners.add(listener);
    // Immediately notify the new listener of the current state
    listener({
      isLoading: this.isLoading,
      message: this.message,
      progress: this.progress
    });
    
    // Return function to remove listener
    return () => {
      this.listeners.delete(listener);
    };
  }

  // Notify all listeners of the current loading state
  notifyListeners() {
    const state = {
      isLoading: this.isLoading,
      message: this.message,
      progress: this.progress
    };
    
    this.listeners.forEach(listener => {
      listener(state);
    });
  }
}

// Create and export a singleton instance
export const loadingManager = new LoadingManager(); 