/**
 * ToolManager.js - Manages and coordinates all editor tools
 *
 * This class is responsible for initializing tools, activating/deactivating them,
 * and directing input events to the currently active tool.
 */
import QuickTipsManager from "../components/QuickTipsManager";
import BaseTool from "./BaseTool";

class ToolManager {
    tools: Record<string, BaseTool>;
    activeTool: BaseTool | null;
    toolChangeListeners: ((toolName: string | null) => void)[];
    terrainBuilder: any;
    _handleGlobalDeactivate: (_e?: Event) => void;

    constructor(terrainBuilderProps: any) {

        if (!terrainBuilderProps.scene) {
            console.error("ToolManager initialized without scene property");
        }

        this.terrainBuilder = terrainBuilderProps;
        this.tools = {};
        this.activeTool = null;
        this.toolChangeListeners = []; // Add array for tool change listeners
        console.log(
            "ToolManager initialized with properties:",
            Object.keys(terrainBuilderProps).filter(
                (key) => terrainBuilderProps[key] !== undefined
            )
        );

        // Deactivate current tool when certain global editor events occur
        this._handleGlobalDeactivate = (_e?: Event) => {
            // Only deactivate if something is active to avoid unnecessary work
            if (this.activeTool) {
                this.activateTool(null, undefined);
            }
        };

        if (typeof window !== "undefined") {
            window.addEventListener("pointerLockModeChanged", this._handleGlobalDeactivate);
            window.addEventListener("blockToolsTabChanged", this._handleGlobalDeactivate);
        }
    }
    /**
     * Register a new tool with the manager
     * @param {string} toolName - Name to register the tool under
     * @param {BaseTool} tool - Tool instance to register
     */
    registerTool(toolName, tool) {
        if (!toolName || typeof toolName !== "string") {
            console.error(
                "Invalid tool name provided to registerTool:",
                toolName
            );
            return;
        }
        if (!tool || typeof tool.onActivate !== "function") {
            console.error(
                "Invalid tool object provided to registerTool:",
                tool
            );
            return;
        }
        this.tools[toolName] = tool;
        console.log(`Registered tool: ${toolName}`);
    }
    /**
     * Activate a specific tool by name
     * @param {string | null} toolName - Name of the tool to activate, or null to deactivate
     * @param {any} activationData - Optional data to pass to the tool's activate method
     */
    activateTool(toolName, activationData) {

        if (this.activeTool) {
            this.activeTool.deactivate();
            // Notify listeners of deactivation
            this.toolChangeListeners.forEach((cb) => {
                try {
                    cb(null);
                } catch (_) { }
            });

            // Broadcast a global event so UI components can react even if they don't have
            // a direct reference to the ToolManager instance.
            try {
                window.dispatchEvent(new CustomEvent("activeToolChanged", { detail: null }));
            } catch (_) { }
        }

        if (!toolName) {
            this.activeTool = null;
            console.log("All tools deactivated");

            QuickTipsManager.setToDefaultTip();
            // Listeners already notified above
            return true;
        }

        if (this.tools[toolName]) {
            this.activeTool = this.tools[toolName];
            const activationSuccessful =
                this.activeTool.activate(activationData);

            if (!activationSuccessful) {
                console.warn(`Activation failed for tool: ${toolName}`);
                this.activeTool = null;

                QuickTipsManager.setToDefaultTip();
                return false;
            }
            console.log(`Activated tool: ${toolName}`);

            if (this.activeTool.tooltip) {
                QuickTipsManager.setToolTip(this.activeTool.tooltip);
            }

            // Notify listeners
            this.toolChangeListeners.forEach((cb) => {
                try {
                    cb(toolName);
                } catch (_) { }
            });

            try {
                window.dispatchEvent(new CustomEvent("activeToolChanged", { detail: toolName }));
            } catch (_) { }

            return true;
        } else {
            console.warn(`Tool not found: ${toolName}`);
            this.activeTool = null;

            QuickTipsManager.setToDefaultTip();
            return false;
        }
    }
    /**
     * Get the currently active tool
     * @returns {BaseTool|null} The active tool or null if none is active
     */
    getActiveTool() {
        if (this.activeTool && !this.activeTool.active) {
            return null;
        }
        return this.activeTool;
    }
    /**
     * Handle mouse down events by forwarding to the active tool
     */
    handleMouseDown(event, position, button) {
        if (this.activeTool) {
            this.activeTool.handleMouseDown(event, position, button);
        }
    }
    /**
     * Handle mouse move events by forwarding to the active tool
     */
    handleMouseMove(event, position) {
        if (this.activeTool) {
            this.activeTool.handleMouseMove(event, position);
        }
    }
    /**
     * Handle mouse up events by forwarding to the active tool
     */
    handleMouseUp(event, position, button) {
        if (this.activeTool) {
            this.activeTool.handleMouseUp(event, position, button);
        }
    }
    /**
     * Handle key down events by forwarding to the active tool
     */
    handleKeyDown(event) {
        if (this.activeTool) {
            this.activeTool.handleKeyDown(event);
        }
    }
    /**
     * Handle key up events by forwarding to the active tool
     */
    handleKeyUp(event) {
        if (this.activeTool) {
            this.activeTool.handleKeyUp(event);
        }
    }
    /**
     * Update the active tool
     */
    update() {
        if (this.activeTool) {
            this.activeTool.update();
        }
    }
    /**
     * Clean up all tools when no longer needed
     */
    dispose() {
        Object.values(this.tools).forEach((tool) => {
            if (typeof tool.dispose === "function") {
                tool.dispose();
            }
        });
        this.tools = {};
        this.activeTool = null;

        if (typeof window !== "undefined" && this._handleGlobalDeactivate) {
            window.removeEventListener("pointerLockModeChanged", this._handleGlobalDeactivate);
            window.removeEventListener("blockToolsTabChanged", this._handleGlobalDeactivate);
        }
    }
    /** Add a listener that will be called whenever the active tool changes */
    addToolChangeListener(listener: (toolName: string | null) => void) {
        if (typeof listener === "function") {
            this.toolChangeListeners.push(listener);
        }
    }

    removeToolChangeListener(listener: (toolName: string | null) => void) {
        this.toolChangeListeners = this.toolChangeListeners.filter(
            (l) => l !== listener
        );
    }
}
export default ToolManager;
