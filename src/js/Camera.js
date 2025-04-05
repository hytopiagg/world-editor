import * as THREE from "three";

class CameraManager {
    constructor() {
        this.camera = null;
        this.controls = null;
        this.moveSpeed = 0.2;
        this.rotateSpeed = 0.02;
        this.keys = new Set();
        this.isSliderDragging = false;
        this.lastPosition = null;
        this.lastTarget = null;
        this.animationFrameId = null;
        this.onCameraAngleChange = null;
        this._eventsInitialized = false;
        this._isInputDisabled = false;
    }

    initialize(camera, controls) {
        if (this._eventsInitialized) return;
        this._eventsInitialized = true;
        this.camera = camera;
        this.controls = controls;
        this.moveSpeed = 0.2;
        this.rotateSpeed = 0.02;
        this.keys = new Set();
        this.isSliderDragging = false;
        this.lastPosition = null;
        this.lastTarget = null;
        this.animationFrameId = null;
        this.onCameraAngleChange = null;

        // Disable zoom on OrbitControls
        this.controls.enableZoom = false;
        this.controls.panSpeed = 10;

        // Add wheel event listener with UI check
        const handleWheel = (event) => {
            // Check if the event target or its parents are UI elements
            const isUIElement = event.target.closest(
                ".block-tools-sidebar, .controls-container, .debug-info, .modal-overlay"
            );
            if (isUIElement) return;

            const moveAmount = 3;
            const direction = event.deltaY > 0 ? 1 : -1;

            this.camera.translateZ(direction * moveAmount);

            // Update target to maintain camera direction
            const newTarget = this.camera.position
                .clone()
                .add(this.camera.getWorldDirection(new THREE.Vector3()));
            this.controls.target.copy(newTarget);
            this.controls.update();
            this.saveState();

            // Update angle on wheel movement
            if (this.onCameraAngleChange) {
                const direction = new THREE.Vector3();
                this.camera.getWorldDirection(direction);
                const verticalAngle = THREE.MathUtils.radToDeg(
                    Math.asin(direction.y)
                );
                this.onCameraAngleChange(verticalAngle);
            }
        };

        window.addEventListener("wheel", handleWheel, { passive: false });
        window.addEventListener("keydown", this.handleKeyDown);
        window.addEventListener("keyup", this.handleKeyUp);

        // Set up animation loop for camera movement
        const animate = () => {
            this.updateCameraMovement();
            this.animationFrameId = requestAnimationFrame(animate);
        };
        animate();

        // Load saved camera state
        this.loadSavedState();

        // Modify the change event listener for OrbitControls
        this.controls.addEventListener("change", () => {
            // Remove the isSliderDragging check to ensure angle updates in all cases
            const direction = new THREE.Vector3();
            this.camera.getWorldDirection(direction);
            const verticalAngle = THREE.MathUtils.radToDeg(
                Math.asin(direction.y)
            );
            if (this.onCameraAngleChange) {
                this.onCameraAngleChange(verticalAngle);
            }
        });

        return () => {
            window.removeEventListener("wheel", handleWheel);
            window.removeEventListener("keydown", this.handleKeyDown);
            window.removeEventListener("keyup", this.handleKeyUp);
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
            }
        };
    }

    loadSavedState() {
        const savedCamera = localStorage.getItem("cameraState");
        if (savedCamera) {
            try {
                const { position, controlsTarget } = JSON.parse(savedCamera);
                this.camera.position.set(position.x, position.y, position.z);
                const target = new THREE.Vector3(
                    controlsTarget.x,
                    controlsTarget.y,
                    controlsTarget.z
                );
                this.controls.target.copy(target);
                this.camera.lookAt(target);
                this.controls.update();
            } catch (error) {
                console.error("Error loading camera state:", error);
                this.resetCamera();
            }
        } else {
            this.resetCamera();
        }

        // Store initial position and target
        this.lastPosition = this.camera.position.clone();
        this.lastTarget = this.controls.target.clone();
    }

    resetCamera() {
        if (this.camera && this.controls) {
            this.camera.position.set(10, 10, 10);
            this.controls.target.set(0, 0, 0);
            this.camera.lookAt(0, 0, 0);
            this.controls.update();
            this.saveState();
        }
    }

    updateCameraMovement() {
        if (!this.controls || !this.camera || this._isInputDisabled) return;

        let moved = false;

        // Forward/Backward movement (X/Z plane only)
        if (
            this.keys.has("w") ||
            this.keys.has("arrowup") ||
            this.keys.has("s") ||
            this.keys.has("arrowdown")
        ) {
            const direction = new THREE.Vector3();
            this.camera.getWorldDirection(direction);

            // Zero out the Y component to keep movement in X/Z plane
            direction.y = 0;
            direction.normalize();

            // Move forward or backward
            const moveDirection =
                this.keys.has("w") || this.keys.has("arrowup") ? 1 : -1;
            this.camera.position.add(
                direction.multiplyScalar(this.moveSpeed * moveDirection)
            );
            moved = true;
        }

        // Rotation
        if (this.keys.has("a") || this.keys.has("arrowleft")) {
            this.camera.rotateY(this.rotateSpeed);
            moved = true;
        }
        if (this.keys.has("d") || this.keys.has("arrowright")) {
            this.camera.rotateY(-this.rotateSpeed);
            moved = true;
        }

        // Up/Down movement
        if (this.keys.has(" ")) {
            // Space key
            this.camera.position.y += this.moveSpeed;
            moved = true;
        }
        if (this.keys.has("shift")) {
            this.camera.position.y -= this.moveSpeed;
            moved = true;
        }

        // Only update controls and save state if the camera actually moved
        if (moved) {
            // Update target to maintain camera direction
            const newTarget = this.camera.position
                .clone()
                .add(this.camera.getWorldDirection(new THREE.Vector3()));
            this.controls.target.copy(newTarget);
            this.controls.update();
            this.saveState();

            // Remove isSliderDragging check here too
            const direction = new THREE.Vector3();
            this.camera.getWorldDirection(direction);
            const verticalAngle = THREE.MathUtils.radToDeg(
                Math.asin(direction.y)
            );
            if (this.onCameraAngleChange) {
                this.onCameraAngleChange(verticalAngle);
            }
        }
    }

    handleSliderChange(newAngle) {
        if (!this.controls || !this.camera) return;

        this.isSliderDragging = true;

        const direction = new THREE.Vector3();
        this.camera.getWorldDirection(direction);

        const horizontalAngle = Math.atan2(direction.z, direction.x);
        const verticalAngle = THREE.MathUtils.degToRad(newAngle);

        direction.x = Math.cos(horizontalAngle) * Math.cos(verticalAngle);
        direction.y = Math.sin(verticalAngle);
        direction.z = Math.sin(horizontalAngle) * Math.cos(verticalAngle);

        const targetPosition = this.camera.position.clone().add(direction);
        this.controls.target.copy(targetPosition);
        this.camera.lookAt(targetPosition);
        this.controls.update();
        this.saveState();

        setTimeout(() => {
            this.isSliderDragging = false;
        }, 10);
    }

    saveState() {
        if (this.camera && this.controls) {
            const cameraState = this.getCameraState();
            localStorage.setItem("cameraState", JSON.stringify(cameraState));
        }
    }

    getCameraState() {
        if (!this.camera || !this.controls) return null;

        return {
            position: {
                x: this.camera.position.x,
                y: this.camera.position.y,
                z: this.camera.position.z,
            },
            controlsTarget: {
                x: this.controls.target.x,
                y: this.controls.target.y,
                z: this.controls.target.z,
            },
        };
    }

    handleKeyDown = (event) => {
        if (this._isInputDisabled) return;

        // Check if the event target is an input field, textarea, or contenteditable element
        const target = event.target;
        const isInput =
            target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable;

        // If it's an input field, don't process camera movement keys (WASD, Space, Shift, Arrows)
        const movementKeys = [
            "w",
            "a",
            "s",
            "d",
            " ",
            "shift",
            "arrowup",
            "arrowdown",
            "arrowleft",
            "arrowright",
        ];
        if (isInput && movementKeys.includes(event.key.toLowerCase())) {
            return; // Stop processing if it's a movement key in an input field
        }

        // Otherwise, add the key to the set for camera movement
        this.keys.add(event.key.toLowerCase());
    };

    handleKeyUp = (event) => {
        this.keys.delete(event.key.toLowerCase());
    };

    cleanup() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        window.removeEventListener("keydown", this.handleKeyDown);
        window.removeEventListener("keyup", this.handleKeyUp);
    }

    setAngleChangeCallback(callback) {
        this.onCameraAngleChange = (angle) => {
            // Round to 2 decimal places for consistency
            const roundedAngle = Math.round(angle * 100) / 100;
            callback(roundedAngle);
            // Also save to localStorage
            localStorage.setItem("cameraAngle", roundedAngle.toString());
        };
    }

    setInputDisabled(disabled) {
        this._isInputDisabled = disabled;
        if (disabled) {
            // Clear any currently pressed keys when disabling
            this.keys.clear();
        }
    }
}

export const cameraManager = new CameraManager();
