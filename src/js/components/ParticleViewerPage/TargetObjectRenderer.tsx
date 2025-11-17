// @ts-nocheck - React Three Fiber JSX elements are extended globally
import React, { useRef, useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { TargetObjectType, EntityTarget } from "./index";

interface TargetObjectRendererProps {
    type: TargetObjectType;
    entityTarget?: EntityTarget | null;
    onObjectReady?: (object: THREE.Object3D | null, boneMap?: Map<string, THREE.Object3D>) => void;
}

function PlayerModel({ onObjectReady }: { onObjectReady?: (object: THREE.Object3D | null, boneMap?: Map<string, THREE.Object3D>) => void }) {
    const { scene, animations } = useGLTF("./assets/models/players/player.gltf");
    const modelRef = useRef<THREE.Group>(null);
    const mixerRef = useRef<THREE.AnimationMixer | null>(null);
    const actionRefsRef = useRef<THREE.AnimationAction[]>([]);
    const positionedRef = useRef(false);
    const boneMapRef = useRef<Map<string, THREE.Object3D>>(new Map());

    // Clone the scene to avoid mutating the original
    const clonedScene = React.useMemo(() => {
        if (!scene) return null;
        const cloned = scene.clone();
        return cloned;
    }, [scene]);

    // Build bone map programmatically - discover all bones/nodes by their actual names
    useEffect(() => {
        if (modelRef.current) {
            boneMapRef.current.clear();
            modelRef.current.traverse((child) => {
                // Store all named objects (bones, nodes, meshes with names)
                // Use lowercase for case-insensitive lookup, but preserve original name
                if (child.name && child.name.trim() !== '') {
                    const nameLower = child.name.toLowerCase();
                    boneMapRef.current.set(nameLower, child);
                    // Also store with original name (case-sensitive) for exact matches
                    boneMapRef.current.set(child.name, child);
                }
            });
        }
    }, [clonedScene]);

    useEffect(() => {
        if (modelRef.current && clonedScene && !positionedRef.current) {
            // Calculate bounding box once
            const box = new THREE.Box3().setFromObject(modelRef.current);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = maxDim > 0 ? 1.0 / maxDim : 1;

            // Position model so its base is at y=0 and centered on x and z (like the block)
            // The block is at [0, 0.5, 0] with size 1x1x1, so its base is at y=0
            // We want the player model's base at y=0 as well
            const baseY = box.min.y;
            modelRef.current.position.set(
                -center.x * scale,
                -baseY * scale,
                -center.z * scale
            );
            modelRef.current.scale.set(scale, scale, scale);
            
            positionedRef.current = true;
        }
        
        // Call onObjectReady after positioning is complete (or if already positioned)
        if (modelRef.current && positionedRef.current && onObjectReady) {
            onObjectReady(modelRef.current, boneMapRef.current);
        }
    }, [clonedScene, onObjectReady]); // onObjectReady is memoized in parent, so this is safe

    // Setup animation mixer and play idle animations simultaneously
    useEffect(() => {
        if (!modelRef.current || !animations || animations.length === 0) return;

        const mixer = new THREE.AnimationMixer(modelRef.current);
        mixerRef.current = mixer;
        actionRefsRef.current = [];

        // Find and play idle-lower, idle-upper, and eyes-idle simultaneously
        const animationNames = ['idle-lower', 'idle-upper', 'eyes-idle'];
        
        animationNames.forEach((animName) => {
            const clip = animations.find((c) => 
                c.name.toLowerCase() === animName.toLowerCase()
            );
            
            if (clip) {
                const action = mixer.clipAction(clip);
                action.play();
                actionRefsRef.current.push(action);
            }
        });

        return () => {
            // Stop all actions
            actionRefsRef.current.forEach((action) => {
                if (action) {
                    action.stop();
                }
            });
            actionRefsRef.current = [];
            
            if (mixerRef.current) {
                mixerRef.current.stopAllAction();
                mixerRef.current = null;
            }
        };
    }, [animations, clonedScene]);

    // Update animation mixer each frame
    useFrame((state, delta) => {
        if (mixerRef.current) {
            mixerRef.current.update(delta);
        }
    });

    if (!clonedScene) return null;
    
    return <primitive object={clonedScene} ref={modelRef} />;
}

function SimpleBlock({ onObjectReady }: { onObjectReady?: (object: THREE.Object3D | null) => void }) {
    const blockRef = useRef<THREE.Mesh>(null);

    useEffect(() => {
        if (blockRef.current && onObjectReady) {
            onObjectReady(blockRef.current);
        }
    }, [onObjectReady]);

    return (
        <mesh ref={blockRef} position={[0, 0.5, 0]} castShadow receiveShadow>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#888888" />
        </mesh>
    );
}

function EntityModel({ entityTarget, onObjectReady }: { entityTarget: EntityTarget; onObjectReady?: (object: THREE.Object3D | null, boneMap?: Map<string, THREE.Object3D>) => void }) {
    const { scene } = useGLTF(`./${entityTarget.modelUrl}`);
    const modelRef = useRef<THREE.Group>(null);
    const positionedRef = useRef(false);
    const boneMapRef = useRef<Map<string, THREE.Object3D>>(new Map());

    const clonedScene = React.useMemo(() => {
        if (!scene) return null;
        return scene.clone();
    }, [scene]);

    // Build bone map programmatically - discover all bones/nodes by their actual names
    useEffect(() => {
        if (modelRef.current) {
            boneMapRef.current.clear();
            modelRef.current.traverse((child) => {
                // Store all named objects (bones, nodes, meshes with names)
                // Use lowercase for case-insensitive lookup, but preserve original name
                if (child.name && child.name.trim() !== '') {
                    const nameLower = child.name.toLowerCase();
                    boneMapRef.current.set(nameLower, child);
                    // Also store with original name (case-sensitive) for exact matches
                    boneMapRef.current.set(child.name, child);
                }
            });
        }
    }, [clonedScene]);

    useEffect(() => {
        if (modelRef.current && clonedScene && !positionedRef.current) {
            const box = new THREE.Box3().setFromObject(modelRef.current);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = maxDim > 0 ? 1.0 / maxDim : 1;

            const baseY = box.min.y;
            modelRef.current.position.set(
                -center.x * scale,
                -baseY * scale,
                -center.z * scale
            );
            modelRef.current.scale.set(scale, scale, scale);
            
            positionedRef.current = true;
        }
        
        if (modelRef.current && positionedRef.current && onObjectReady) {
            onObjectReady(modelRef.current, boneMapRef.current);
        }
    }, [clonedScene, onObjectReady]);

    if (!clonedScene) return null;
    
    return <primitive object={clonedScene} ref={modelRef} />;
}

export default function TargetObjectRenderer({ type, entityTarget, onObjectReady }: TargetObjectRendererProps) {
    useEffect(() => {
        if (type === "none" && onObjectReady) {
            onObjectReady(null);
        }
    }, [type, onObjectReady]);

    if (type === "none") {
        return null;
    }

    if (type === "player") {
        return <PlayerModel onObjectReady={onObjectReady} />;
    }

    if (type === "block") {
        return <SimpleBlock onObjectReady={onObjectReady} />;
    }

    if (type === "entity" && entityTarget) {
        return <EntityModel entityTarget={entityTarget} onObjectReady={onObjectReady} />;
    }

    return null;
}

