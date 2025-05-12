
const uiClickSound = new Audio("sounds/uiclick.ogg");
uiClickSound.volume = 0.3;
const placeSound = new Audio("/sounds/place.wav");
placeSound.volume = 0.1;

export let isMuted = localStorage.getItem("isMuted") === "true";
let clickTimeout = null;
let lastPlayTime = 0;

uiClickSound.muted = isMuted;
placeSound.muted = isMuted;

function handleClick(event) {
    if (event.target.closest("button") && !isMuted) {

        if (clickTimeout) {
            clearTimeout(clickTimeout);
        }

        uiClickSound.currentTime = 0;
        uiClickSound
            .play()
            .catch((err) => console.log("UI sound playback error:", err));

        clickTimeout = setTimeout(() => {
            clickTimeout = null;
        }, 50);
    }
}

document.addEventListener("click", handleClick);

export function playPlaceSound() {
    const now = Date.now();
    const timeSinceLastPlay = now - lastPlayTime;

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
