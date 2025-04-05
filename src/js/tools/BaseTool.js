/**
 * BaseTool.js - Base class for all editor tools
 *
 * This provides the foundation for creating custom tools in the world editor.
 * All specific tools (like WallTool, PaintTool, etc.) should extend this class.
 */

class BaseTool {
    constructor(terrainBuilder) {
        this.terrainBuilder = terrainBuilder;
        this.active = false;
        this.name = "BaseTool";
        this.tooltip = "Tool not implemented";
    }

    /**
     * Called when the tool is activated
     */
    onActivate() {
        this.active = true;
        console.log(`${this.name} activated`);
    }

    /**
     * Called when the tool is deactivated
     */
    onDeactivate() {
        this.active = false;
        console.log(`${this.name} deactivated`);
    }

    /**
     * Handle mouse down events
     * @param {Object} event - The mouse event
     * @param {THREE.Vector3} position - The world position
     * @param {number} button - Mouse button (0 = left, 2 = right)
     */
    handleMouseDown(event, position, button) {
        // To be implemented by child classes
    }

    /**
     * Handle mouse move events
     * @param {Object} event - The mouse event
     * @param {THREE.Vector3} position - The world position
     */
    handleMouseMove(event, position) {
        // To be implemented by child classes
    }

    /**
     * Handle mouse up events
     * @param {Object} event - The mouse event
     * @param {THREE.Vector3} position - The world position
     * @param {number} button - Mouse button (0 = left, 2 = right)
     */
    handleMouseUp(event, position, button) {
        // To be implemented by child classes
    }

    /**
     * Handle key down events
     * @param {Object} event - The key event
     */
    handleKeyDown(event) {
        // To be implemented by child classes
    }

    /**
     * Handle key up events
     * @param {Object} event - The key event
     */
    handleKeyUp(event) {
        // To be implemented by child classes
    }

    /**
     * Update function called on each frame
     */
    update() {
        // To be implemented by child classes
    }

    /**
     * Clean up any resources when the tool is no longer needed
     */
    dispose() {
        // To be implemented by child classes
    }
}

export default BaseTool;
