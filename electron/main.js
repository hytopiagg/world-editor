// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
const path = require("path");
const os = require("os");
const { app, BrowserWindow, shell, Menu } = require("electron");
let DiscordClient;
try {
    DiscordClient = require("@xhayper/discord-rpc").Client;
} catch (_) {
    DiscordClient = null;
}
let updateElectronApp;
try {
    updateElectronApp = require("update-electron-app").updateElectronApp;
} catch (_) {
    updateElectronApp = null;
}
const isDev = process.env.ELECTRON_IS_DEV === "1" || !app.isPackaged;
const REMOTE_URL = process.env.WE_REMOTE_URL || "https://build.hytopia.com";
const PREFER_REMOTE = process.env.WE_PREFER_REMOTE !== "0"; // default: prefer remote with fallback

// Dynamically calculate heap size based on available system memory
// Use 60% of total RAM, with min 4GB and max 16GB
const totalMemoryGB = os.totalmem() / (1024 * 1024 * 1024);
const calculatedHeapGB = Math.floor(totalMemoryGB * 0.6);
const heapSizeMB = Math.max(4096, Math.min(16384, calculatedHeapGB * 1024));

// Performance-oriented flags (safe defaults)
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("enable-accelerated-2d-canvas");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("enable-native-gpu-memory-buffers");
app.commandLine.appendSwitch("ignore-gpu-blacklist");
app.commandLine.appendSwitch("v8-cache-options", "code");
app.commandLine.appendSwitch("js-flags", `--max-old-space-size=${heapSizeMB}`);
app.commandLine.appendSwitch(
    "enable-features",
    [
        "CanvasOopRasterization",
        "Accelerated2dCanvas",
        "WebAssemblyLazyCompilation",
        "WebAssemblyTiering",
    ].join(",")
);

// Platform-specific hints
if (process.platform === "darwin") {
    app.commandLine.appendSwitch("use-angle", "metal");
}
if (process.platform === "win32") {
    app.commandLine.appendSwitch("force_high_performance_gpu");
}
if (process.platform === "linux") {
    app.commandLine.appendSwitch("ozone-platform-hint", "auto");
}

if (isDev) {
    process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
}

let mainWindow;
let discordClient = null;

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
            devTools: isDev,
        },
    });

    mainWindow.once("ready-to-show", () => {
        mainWindow.show();
    });

    // Disable zoom/scale gestures in app
    try {
        mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
    } catch {}

    // Hide menu in production on Windows
    if (!isDev && process.platform === "win32") {
        try {
            Menu.setApplicationMenu(null);
        } catch {}
    }

    // Open external links in the user's browser; keep only local in-app
    const isAllowedInApp = (url) => {
        if (url.startsWith("file://")) return true;
        if (isDev && url.startsWith("http://localhost")) return true;
        if (url.startsWith(REMOTE_URL)) return true;
        if (
            url.startsWith("https://hcaptcha.com") ||
            url.startsWith("https://*.hcaptcha.com") ||
            url.includes("hcaptcha.com")
        )
            return true;
        return false;
    };
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isAllowedInApp(url)) return { action: "allow" };
        shell.openExternal(url);
        return { action: "deny" };
    });
    mainWindow.webContents.on("will-navigate", (event, url) => {
        if (!isAllowedInApp(url)) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });

    const localFallback = `file://${path.resolve(
        __dirname,
        "..",
        "build",
        "index.html"
    )}`;

    if (isDev) {
        mainWindow.loadURL("http://localhost:3000");
    } else if (PREFER_REMOTE) {
        let finished = false;
        const timer = setTimeout(() => {
            if (!finished) {
                try {
                    mainWindow.loadURL(localFallback);
                } catch (_) {}
            }
        }, 8000);
        mainWindow.webContents.once("did-finish-load", () => {
            finished = true;
            clearTimeout(timer);
        });
        mainWindow.webContents.once("did-fail-load", () => {
            finished = true;
            clearTimeout(timer);
            try {
                mainWindow.loadURL(localFallback);
            } catch (_) {}
        });
        mainWindow.loadURL(REMOTE_URL);
    } else {
        mainWindow.loadURL(localFallback);
    }

    // Minimal Discord Rich Presence
    try {
        if (!discordClient && DiscordClient && app.isPackaged) {
            const clientId =
                process.env.DISCORD_APP_ID || "1178178779814834258";
            discordClient = new DiscordClient({ clientId });
            discordClient.on("ready", () => {
                try {
                    discordClient.user.setActivity({
                        applicationId: clientId,
                        name: "HYTOPIA World Editor",
                        details: "Building a world",
                        type: 0,
                        buttons: [
                            { label: "Open Editor", url: REMOTE_URL },
                            {
                                label: "Join Discord",
                                url: "https://discord.gg/hytopia",
                            },
                        ],
                    });
                } catch (_) {}
            });
            discordClient.login().catch(() => {});
        }
    } catch (_) {}

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    // Production auto-update
    try {
        if (updateElectronApp && app.isPackaged) {
            updateElectronApp({
                repo: "hytopiagg/desktop-releases",
                updateInterval: "1 hour",
                logger: undefined,
            });
        }
    } catch (_) {}
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
