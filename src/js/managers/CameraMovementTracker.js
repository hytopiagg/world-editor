import * as THREE from "three";

class CameraMovementTracker {
    constructor() {
        this.lastCameraPosition = new THREE.Vector3();
        this.lastCameraRotation = new THREE.Euler();
        this.cameraMoving = { current: false };
    }

    updateCameraMovement(threeCamera) {
        if (!threeCamera) {
            console.warn("[Animation] Three camera is null or undefined");
            return false;
        }

        const posX = threeCamera.position.x;
        const posY = threeCamera.position.y;
        const posZ = threeCamera.position.z;
        const rotX = threeCamera.rotation.x;
        const rotY = threeCamera.rotation.y;
        const rotZ = threeCamera.rotation.z;

        const positionChanged =
            Math.abs(posX - this.lastCameraPosition.x) > 0.01 ||
            Math.abs(posY - this.lastCameraPosition.y) > 0.01 ||
            Math.abs(posZ - this.lastCameraPosition.z) > 0.01;

        const rotationChanged =
            Math.abs(rotX - this.lastCameraRotation.x) > 0.01 ||
            Math.abs(rotY - this.lastCameraRotation.y) > 0.01 ||
            Math.abs(rotZ - this.lastCameraRotation.z) > 0.01;

        const isCameraMoving = positionChanged || rotationChanged;
        this.cameraMoving.current = isCameraMoving;

        this.lastCameraPosition.x = posX;
        this.lastCameraPosition.y = posY;
        this.lastCameraPosition.z = posZ;
        this.lastCameraRotation.x = rotX;
        this.lastCameraRotation.y = rotY;
        this.lastCameraRotation.z = rotZ;

        return isCameraMoving;
    }

    isMoving() {
        return this.cameraMoving.current;
    }
}

export const cameraMovementTracker = new CameraMovementTracker();
