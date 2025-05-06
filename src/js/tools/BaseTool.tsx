/**
 * BaseTool.js - Base class for all editor tools
 *
 * This provides the foundation for creating custom tools in the world editor.
 * All specific tools (like WallTool, PaintTool, etc.) should extend this class.
 */
class BaseTool {
    active: boolean;
    name: string;
    tooltip: string;
    terrainBuilderProps: Object;
    constructor(terrainBuilderProps) {

        for (const key in terrainBuilderProps) {
            if (Object.hasOwnProperty.call(terrainBuilderProps, key)) {
                this[key] = terrainBuilderProps[key];
            }
        }

        this.terrainBuilderProps = terrainBuilderProps;
        this.active = false;
        this.name = this.name || "BaseTool"; // Allow subclasses to set name before super()
        this.tooltip = this.tooltip || "Tool not implemented";
    }
    /**
     * Activate the tool. This is now the primary method to call.
     * It handles setting the active flag and calls the specific onActivate logic.
     * @param {any} activationData - Optional data passed during activation (e.g., schematic data)
     */
    activate(activationData) {
        this.active = true;
        console.log(`${this.name} activated`);


        let activationSuccessful = false;
        try {

            const result = this.onActivate(activationData);

            activationSuccessful = result === true;
        } catch (error) {
            console.error(`Error during ${this.name} activation:`, error);
            activationSuccessful = false;
        }

        if (!activationSuccessful) {
            console.warn(
                `${this.name} activation failed, deactivating immediately.`
            );
            this.deactivate(); // Deactivate sets this.active = false
        } else {

            this.active = true;
        }

        return activationSuccessful;
    }
    /**
     * Deactivate the tool. This is now the primary method to call.
     * It handles setting the active flag and calls the specific onDeactivate logic.
     */
    deactivate() {
        this.active = false;
        console.log(`${this.name} deactivated`);
        this.onDeactivate(); // Call specific deactivation logic if needed
    }
    /**
     * Called when the tool is activated (for subclass-specific logic)
     * @param {any} activationData - Optional data received from activate()
     * @returns {boolean} - Return true if activation is successful, false otherwise.
     */
    onActivate(activationData = null) {

        return true; // Default implementation assumes success
    }
    /**
     * Called when the tool is deactivated (for subclass-specific logic)
     */
    onDeactivate() {

    }
    /**
     * Handle mouse down events
     * @param {Object} event - The mouse event
     * @param {THREE.Vector3} position - The world position
     * @param {number} button - Mouse button (0 = left, 2 = right)
     */
    handleMouseDown(event, position, button) {

    }
    /**
     * Handle mouse move events
     * @param {Object} event - The mouse event
     * @param {THREE.Vector3} position - The world position
     */
    handleMouseMove(event, position) {

    }
    /**
     * Handle mouse up events
     * @param {Object} event - The mouse event
     * @param {THREE.Vector3} position - The world position
     * @param {number} button - Mouse button (0 = left, 2 = right)
     */
    handleMouseUp(event, position, button) {

    }
    /**
     * Handle key down events
     * @param {Object} event - The key event
     */
    handleKeyDown(event) {

    }
    /**
     * Handle key up events
     * @param {Object} event - The key event
     */
    handleKeyUp(event) {

    }
    /**
     * Update function called on each frame
     */
    update() {

    }
    /**
     * Getter for isActive state
     */
    get isActive() {
        return this.active;
    }
    
    /**
     * Clean up any resources when the tool is no longer needed
     */
    dispose() {

    }
}
export default BaseTool;
