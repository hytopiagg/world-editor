export function isElectronRuntime(): boolean {
    try {
        // Electron preload exposes a marker; fallback to UA sniffing
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        if (w && w.WorldEditorEnv && w.WorldEditorEnv.isElectron) return true;
        return (
            typeof navigator !== "undefined" &&
            /Electron/i.test(navigator.userAgent)
        );
    } catch {
        return false;
    }
}

export type Platform = "mac" | "win" | "linux" | "other";

export function detectPlatform(): Platform {
    const p =
        navigator.platform?.toLowerCase() ||
        navigator.userAgent?.toLowerCase() ||
        "";
    if (p.includes("mac") || p.includes("darwin")) return "mac";
    if (p.includes("win")) return "win";
    if (p.includes("linux")) return "linux";
    // Fallback for iPadOS on desktop mode etc.
    if (/mac os x/i.test(navigator.userAgent) && "ontouchstart" in window)
        return "mac";
    return "other";
}
