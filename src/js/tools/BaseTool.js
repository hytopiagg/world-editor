/**
 * BaseTool.js - Base class for all editor tools
 *
 * This provides the foundation for creating custom tools in the world editor.
 * All specific tools (like WallTool, PaintTool, etc.) should extend this class.
 */

class BaseTool {
    constructor(terrainBuilderProps) {
        // Assign all properties from terrainBuilderProps directly to the instance
        for (const key in terrainBuilderProps) {
            if (Object.hasOwnProperty.call(terrainBuilderProps, key)) {
                this[key] = terrainBuilderProps[key];
            }
        }

        // Keep a reference to the original props if needed, but individual properties are now top-level
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
        // Call specific activation logic, passing the data along
        // Use a try-catch block to gracefully handle activation failures
        let activationSuccessful = false;
        try {
            // Pass activationData to onActivate
            const result = this.onActivate(activationData);
            // onActivate should return true on success, false or throw on failure
            activationSuccessful = result === true;
        } catch (error) {
            console.error(`Error during ${this.name} activation:`, error);
            activationSuccessful = false;
        }

        // If activation failed in onActivate, immediately deactivate
        if (!activationSuccessful) {
            console.warn(
                `${this.name} activation failed, deactivating immediately.`
            );
            this.deactivate(); // Deactivate sets this.active = false
        } else {
            // Ensure this.active is true only if activation succeeded
            this.active = true;
        }
        // Return the success status
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
    onActivate(activationData) {
        // To be implemented by child classes if needed
        return true; // Default implementation assumes success
    }

    /**
     * Called when the tool is deactivated (for subclass-specific logic)
     */
    onDeactivate() {
        // To be implemented by child classes if needed
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
     * Getter for isActive state
     */
    get isActive() {
        return this.active;
    }

    /**
     * Clean up any resources when the tool is no longer needed
     */
    dispose() {
        // To be implemented by child classes
    }
}

export default BaseTool;
