import * as THREE from "three";
import QuickTipsManager from "./components/QuickTipsManager";

class CameraManager {
    camera: THREE.Camera | null;
    controls: any | null;
    moveSpeed: number;
    rotateSpeed: number;
    keys: Set<string>;
    isSliderDragging: boolean;
    lastPosition: THREE.Vector3 | null;
    lastTarget: THREE.Vector3 | null;
    animationFrameId: number | null;
    onCameraAngleChange: ((angle: number) => void) | null;
    _eventsInitialized: boolean;
    _isInputDisabled: boolean;
    isRotateMode: boolean;
    lastFrameTime: number;
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
        this.lastFrameTime = performance.now();
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
        this.isRotateMode = true;
        this.lastFrameTime = performance.now();
        this.controls.enableZoom = false;
        this.controls.panSpeed = 10;

        const handleWheel = (event) => {
            const isUIElement = event.target.closest(
                ".block-tools-sidebar, .controls-container, .debug-info, .modal-overlay"
            );
            if (isUIElement) return;
            const moveAmount = 3;
            const direction = event.deltaY > 0 ? 1 : -1;
            this.camera.translateZ(direction * moveAmount);

            const newTarget = this.camera.position
                .clone()
                .add(this.camera.getWorldDirection(new THREE.Vector3()));
            this.controls.target.copy(newTarget);
            this.controls.update();
            this.saveState();

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

        const animate = () => {
            const currentTime = performance.now();
            const deltaTime = (currentTime - this.lastFrameTime) / 16.67; // normalize to 60fps
            this.lastFrameTime = currentTime;

            this.updateCameraMovement(deltaTime);
            this.animationFrameId = requestAnimationFrame(animate);
        };
        animate();

        this.loadSavedState();

        this.controls.addEventListener("change", () => {
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
    updateCameraMovement(deltaTime = 1) {
        if (!this.controls || !this.camera || this._isInputDisabled) return;
        let moved = false;

        // Apply deltaTime to make movement frame-rate independent
        const frameAdjustedMoveSpeed = this.moveSpeed * deltaTime;
        const frameAdjustedRotateSpeed = this.rotateSpeed * deltaTime;

        if (
            this.keys.has("w") ||
            this.keys.has("arrowup") ||
            this.keys.has("s") ||
            this.keys.has("arrowdown")
        ) {
            const direction = new THREE.Vector3();
            this.camera.getWorldDirection(direction);

            direction.y = 0;
            direction.normalize();

            const moveDirection =
                this.keys.has("w") || this.keys.has("arrowup") ? 1 : -1;
            this.camera.position.add(
                direction.multiplyScalar(frameAdjustedMoveSpeed * moveDirection)
            );
            moved = true;
        }

        if (this.keys.has("a") || this.keys.has("arrowleft")) {
            if (this.isRotateMode) {
                this.camera.rotateY(frameAdjustedRotateSpeed);
            } else {
                const direction = new THREE.Vector3();
                this.camera.getWorldDirection(direction);
                direction.y = 0;
                direction.normalize();
                const leftVector = new THREE.Vector3(
                    direction.z,
                    0,
                    -direction.x
                );
                this.camera.position.add(
                    leftVector.multiplyScalar(frameAdjustedMoveSpeed)
                );
            }

            moved = true;
        }
        if (this.keys.has("d") || this.keys.has("arrowright")) {
            if (this.isRotateMode) {
                this.camera.rotateY(-frameAdjustedRotateSpeed);
            } else {
                const direction = new THREE.Vector3();
                this.camera.getWorldDirection(direction);
                direction.y = 0;
                direction.normalize();
                const rightVector = new THREE.Vector3(
                    -direction.z,
                    0,
                    direction.x
                );
                this.camera.position.add(
                    rightVector.multiplyScalar(frameAdjustedMoveSpeed)
                );
            }
            moved = true;
        }

        if (this.keys.has(" ")) {
            this.camera.position.y += frameAdjustedMoveSpeed;
            moved = true;
        }
        if (this.keys.has("shift")) {
            this.camera.position.y -= frameAdjustedMoveSpeed;
            moved = true;
        }

        if (moved) {
            const newTarget = this.camera.position
                .clone()
                .add(this.camera.getWorldDirection(new THREE.Vector3()));
            this.controls.target.copy(newTarget);
            this.controls.update();
            this.saveState();

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

        const target = event.target;
        const isInput =
            target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable;

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
        if (
            isInput &&
            event.key &&
            movementKeys.includes(event.key.toLowerCase())
        ) {
            return;
        }

        if (event.key === "0") {
            this.isRotateMode = !this.isRotateMode;
            console.log("Camera mode toggled. Rotate mode:", this.isRotateMode);
            const modeText = this.isRotateMode ? "Rotate" : "Glide";
            QuickTipsManager.setToolTip(`Camera Mode: ${modeText}`);
            return;
        }

        if (event.key) this.keys.add(event.key.toLowerCase());
    };
    handleKeyUp = (event) => {
        if (!event.key) return;
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
            const roundedAngle = Math.round(angle * 100) / 100;
            callback(roundedAngle);

            localStorage.setItem("cameraAngle", roundedAngle.toString());
        };
    }
    setInputDisabled(disabled) {
        this._isInputDisabled = disabled;
        if (disabled) {
            this.keys.clear();
        }
    }
}
export const cameraManager = new CameraManager();
