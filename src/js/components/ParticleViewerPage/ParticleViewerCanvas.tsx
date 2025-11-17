// @ts-nocheck - React Three Fiber JSX elements are extended globally
import React, { useMemo, useRef, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import { detectGPU, getOptimalContextAttributes } from "../../utils/GPUDetection";
import type { TargetObjectType, ParticleEmitterConfig, EntityTarget } from "./index";
import TargetObjectRenderer from "./TargetObjectRenderer";
import ParticleEmitterRenderer from "./ParticleEmitterRenderer";
import * as THREE from "three";

interface ParticleViewerCanvasProps {
    targetObject: TargetObjectType;
    entityTarget: EntityTarget | null;
    emitters: ParticleEmitterConfig[];
    onBoneNamesChange: (boneNames: string[]) => void;
}

export default function ParticleViewerCanvas({
    targetObject,
    entityTarget,
    emitters,
    onBoneNamesChange,
}: ParticleViewerCanvasProps) {
    const gpuInfo = useMemo(() => detectGPU(), []);
    const contextAttributes = useMemo(() => getOptimalContextAttributes(gpuInfo), [gpuInfo]);
    const targetObjectRef = useRef<THREE.Object3D | null>(null);
    const boneMapRef = useRef<Map<string, THREE.Object3D>>(new Map());

    const handleObjectReady = useCallback((obj: THREE.Object3D | null, boneMap?: Map<string, THREE.Object3D>) => {
        targetObjectRef.current = obj;
        if (boneMap && boneMap.size > 0) {
            boneMapRef.current = boneMap;
            // Extract unique bone names (prefer original case-sensitive names, fallback to lowercase)
            const boneNames = new Set<string>();
            boneMap.forEach((bone, key) => {
                // Use the original name if available, otherwise use the key
                if (bone.name && bone.name.trim() !== '') {
                    boneNames.add(bone.name);
                } else {
                    boneNames.add(key);
                }
            });
            onBoneNamesChange(Array.from(boneNames).sort());
        } else {
            boneMapRef.current.clear();
            onBoneNamesChange([]);
        }
    }, [onBoneNamesChange]);

    return (
        <Canvas
            shadows
            gl={contextAttributes}
            camera={{ position: [3, 3, 3], fov: 75 }}
            className="w-full h-full"
        >
            {/* Lighting */}
            <ambientLight intensity={0.6} />
            <directionalLight
                position={[5, 10, 7.5]}
                intensity={1.5}
                castShadow
                shadow-mapSize-width={2048}
                shadow-mapSize-height={2048}
            />

            {/* Grid Helper */}
            <Grid args={[20, 20]} cellColor="#6f6f6f" sectionColor="#9d4b4b" fadeDistance={25} />

            {/* Target Object */}
            <TargetObjectRenderer 
                type={targetObject}
                entityTarget={entityTarget}
                onObjectReady={handleObjectReady}
            />

            {/* Particle Emitters */}
            {emitters.map((emitterConfig) => (
                <ParticleEmitterRenderer
                    key={emitterConfig.id}
                    config={emitterConfig}
                    targetObject={targetObject}
                    targetObjectRef={targetObjectRef}
                    boneMapRef={boneMapRef}
                />
            ))}

            {/* Camera Controls */}
            <OrbitControls
                enableZoom={true}
                enablePan={true}
                minDistance={2}
                maxDistance={20}
                target={[0, 0, 0]}
                autoRotate={false}
            />
        </Canvas>
    );
}

