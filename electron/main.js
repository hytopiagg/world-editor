// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
const path = require("path");
const { app, BrowserWindow, shell } = require("electron");
const isDev = process.env.ELECTRON_IS_DEV === "1" || !app.isPackaged;

// Performance-oriented flags (safe defaults)
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("enable-accelerated-2d-canvas");
app.commandLine.appendSwitch("ignore-gpu-blacklist");
app.commandLine.appendSwitch(
    "enable-features",
    [
        "CanvasOopRasterization",
        "Accelerated2dCanvas",
        "WebAssemblyLazyCompilation",
        "WebAssemblyTiering",
    ].join(",")
);

if (isDev) {
    process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
}

let mainWindow;

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 700,
        useContentSize: true,
        autoHideMenuBar: true,
        show: false,
        backgroundColor: "#0b0b0b",
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            sandbox: false,
            nodeIntegration: false,
            backgroundThrottling: false,
            webgl: true,
        },
    });

    mainWindow.once("ready-to-show", () => {
        mainWindow.show();
    });

    // Open external links in the user's browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: "deny" };
    });
    mainWindow.webContents.on("will-navigate", (event, url) => {
        const isLocal =
            url.startsWith("http://localhost") || url.startsWith("file://");
        if (!isLocal) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });

    const startURL = isDev
        ? "http://localhost:3000"
        : `file://${path.resolve(__dirname, "..", "build", "index.html")}`;
    mainWindow.loadURL(startURL);

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    createMainWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
