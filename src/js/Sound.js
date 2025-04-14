// Create Audio instances

const uiClickSound = new Audio("sounds/uiclick.ogg");
uiClickSound.volume = 0.3;

const placeSound = new Audio("/sounds/place.wav");
placeSound.volume = 0.1;

// State variables
export let isMuted = localStorage.getItem("isMuted") === "true";
let clickTimeout = null;
let lastPlayTime = 0;

// Initialize mute state
uiClickSound.muted = isMuted;
placeSound.muted = isMuted;

// Click handler function
function handleClick(event) {
    if (event.target.closest("button") && !isMuted) {
        // Clear any existing timeout
        if (clickTimeout) {
            clearTimeout(clickTimeout);
        }

        // Reset and play sound
        uiClickSound.currentTime = 0;
        uiClickSound
            .play()
            .catch((err) => console.log("UI sound playback error:", err));

        // Set a timeout to prevent rapid-fire sound playing
        clickTimeout = setTimeout(() => {
            clickTimeout = null;
        }, 50);
    }
}

// Add click handler
document.addEventListener("click", handleClick);

// Exported functions
export function playPlaceSound() {
    const now = Date.now();
    const timeSinceLastPlay = now - lastPlayTime;

    // Only play if enough time has passed (100ms debounce) and not muted
    if (timeSinceLastPlay > 100 && !isMuted && placeSound) {
        try {
            placeSound.currentTime = 0;
            placeSound.play().catch((error) => {
                console.error("Error playing sound:", error);
            });
            lastPlayTime = now;
        } catch (error) {
            console.error("Error playing sound:", error);
        }
    }
}

export function setMuted(muted) {
    isMuted = muted;
    uiClickSound.muted = muted;
    placeSound.muted = muted;
    localStorage.setItem("isMuted", muted);
}

export function toggleMute() {
    setMuted(!isMuted);
}

export function cleanup() {
    document.removeEventListener("click", handleClick);
    if (clickTimeout) {
        clearTimeout(clickTimeout);
    }
    if (placeSound) {
        placeSound.pause();
    }
}

export function playUIClick() {
    if (!isMuted) {
        uiClickSound.currentTime = 0;
        uiClickSound
            .play()
            .catch((err) => console.log("UI sound playback error:", err));
    }
}
