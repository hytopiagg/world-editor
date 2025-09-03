// Minimal, secure preload exposing environment flags
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("WorldEditorEnv", {
    isElectron: true,
});
