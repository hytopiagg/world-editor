// @ts-nocheck - React Three Fiber JSX elements are extended globally
import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

interface CameraPositionerProps {
    targetObjectRef: React.RefObject<THREE.Object3D | null>;
    playModeEnabled: boolean;
}

export default function CameraPositioner({ targetObjectRef, playModeEnabled }: CameraPositionerProps) {
    const { camera } = useThree();
    const hasPositionedRef = useRef(false);

    useEffect(() => {
        if (playModeEnabled) {
            hasPositionedRef.current = false;
            return;
        }

        // Check periodically if object is ready and position camera
        const checkAndPosition = () => {
            if (hasPositionedRef.current || playModeEnabled) return;
            
            const targetObject = targetObjectRef.current;
            if (targetObject) {
                // Position camera in front of the object (assuming forward is -Z)
                const objectPos = targetObject.position;
                const distance = 5;
                const height = 2;
                // Position camera in front (negative Z) looking at the object
                // This assumes the object faces -Z direction (common in 3D models)
                camera.position.set(objectPos.x, objectPos.y + height, objectPos.z - distance);
                camera.lookAt(objectPos);
                hasPositionedRef.current = true;
            }
        };

        // Check immediately
        checkAndPosition();
        
        // Also check periodically in case object loads later
        const interval = setInterval(checkAndPosition, 100);
        
        return () => clearInterval(interval);
    }, [targetObjectRef, playModeEnabled, camera]);

    // Reset positioning flag when target object changes
    useEffect(() => {
        hasPositionedRef.current = false;
    }, [targetObjectRef.current]);

    return null;
}

