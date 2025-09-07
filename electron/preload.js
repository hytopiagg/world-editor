// Minimal, secure preload exposing environment flags
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("WorldEditorEnv", {
    isElectron: true,
    hcaptchaSiteKey:
        process.env.WE_HCAPTCHA_SITE_KEY ||
        process.env.REACT_APP_HCAPTCHA_SITE_KEY ||
        "758ce446-3986-4ce0-9c66-a1aac07267b0",
});
