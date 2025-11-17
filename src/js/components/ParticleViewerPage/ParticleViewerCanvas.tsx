// @ts-nocheck - React Three Fiber JSX elements are extended globally
import React, { useMemo, useRef, useCallback, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { detectGPU, getOptimalContextAttributes } from "../../utils/GPUDetection";
import type { TargetObjectType, ParticleEmitterConfig, EntityTarget } from "./index";
import TargetObjectRenderer from "./TargetObjectRenderer";
import ParticleEmitterRenderer from "./ParticleEmitterRenderer";
import CameraPositioner from "./CameraPositioner";
import PhysicsManager from "../../physics/PhysicsManager";
import * as THREE from "three";

interface ParticleViewerCanvasProps {
    targetObject: TargetObjectType;
    entityTarget: EntityTarget | null;
    emitters: ParticleEmitterConfig[];
    playModeEnabled: boolean;
    onBoneNamesChange: (boneNames: string[]) => void;
}

// Component to handle play mode movement
function PlayModeController({ 
    targetObject, 
    playModeEnabled, 
    targetObjectRef,
    initialPositionsRef,
    playerMeshRef,
    boneMapRef,
    onPlayerMeshReady,
    onPlayerMeshReadyStateChange
}: { 
    targetObject: TargetObjectType; 
    playModeEnabled: boolean;
    targetObjectRef: React.RefObject<THREE.Object3D | null>;
    initialPositionsRef: React.MutableRefObject<{
        object: THREE.Vector3 | null;
        camera: THREE.Vector3 | null;
        emitters: Map<string, THREE.Vector3>;
    }>;
    playerMeshRef: React.MutableRefObject<THREE.Object3D | null>;
    boneMapRef: React.MutableRefObject<Map<string, THREE.Object3D>>;
    onPlayerMeshReady?: (mesh: THREE.Object3D | null) => void;
    onPlayerMeshReadyStateChange?: (ready: boolean) => void;
}) {
    const { camera, scene } = useThree();
    const physicsRef = useRef<PhysicsManager | null>(null);
    const inputStateRef = useRef<{ state: Record<string, boolean> }>({ state: {} });
    const moveSpeed = 5; // units per second
    const runMultiplier = 2;
    const mouseSensitivity = 0.002;
    const cameraYawRef = useRef(0);
    const cameraPitchRef = useRef(0);
    const playerMixerRef = useRef<THREE.AnimationMixer | null>(null);
    const playerAnimationsRef = useRef<Record<string, THREE.AnimationAction>>({});
    const playerActiveTagRef = useRef<string | undefined>(undefined);
    const lastPosRef = useRef<THREE.Vector3 | null>(null);
    const faceYawRef = useRef<number | undefined>(undefined);
    const airborneRef = useRef(false);
    const lastPhysicsTimeRef = useRef<number>(0);

    // Store initial positions when entering play mode
    useEffect(() => {
        if (playModeEnabled) {
            console.log('[PlayMode] Storing initial positions');
            // Store object position
            if (targetObjectRef.current) {
                initialPositionsRef.current.object = targetObjectRef.current.position.clone();
                console.log('[PlayMode] Stored object position:', initialPositionsRef.current.object);
            }
            // Store camera position and rotation
            initialPositionsRef.current.camera = camera.position.clone();
            console.log('[PlayMode] Stored camera position:', initialPositionsRef.current.camera);
            // Initialize camera yaw from current rotation
            cameraYawRef.current = camera.rotation.y;
            cameraPitchRef.current = camera.rotation.x;
            
            // Ensure camera starts at a reasonable height above ground
            if (targetObject === "player" && targetObjectRef.current) {
                const playerPos = targetObjectRef.current.position;
                const offsetRadius = 8.0;
                const offsetHeight = 3.0;
                const pitch = Math.max(-0.3, Math.min(0.3, cameraPitchRef.current)); // Limit pitch
                const horizontalDistance = offsetRadius * Math.cos(pitch);
                const verticalOffset = offsetRadius * Math.sin(pitch) + offsetHeight;
                
                // Set initial camera position above player
                camera.position.set(
                    playerPos.x - Math.sin(cameraYawRef.current) * horizontalDistance,
                    Math.max(1.5, playerPos.y + verticalOffset), // Ensure minimum height above ground
                    playerPos.z - Math.cos(cameraYawRef.current) * horizontalDistance
                );
                camera.lookAt(playerPos);
            }
            lastPosRef.current = null;
            faceYawRef.current = undefined;
            airborneRef.current = false;
        } else {
            // Reset positions when exiting play mode
            console.log('[PlayMode] Resetting positions');
            if (initialPositionsRef.current.object && targetObjectRef.current) {
                targetObjectRef.current.position.copy(initialPositionsRef.current.object);
                console.log('[PlayMode] Reset object to:', initialPositionsRef.current.object);
            }
            if (initialPositionsRef.current.camera) {
                camera.position.copy(initialPositionsRef.current.camera);
                console.log('[PlayMode] Reset camera to:', initialPositionsRef.current.camera);
            }
            // Reset camera rotation (will be handled by OrbitControls)
            // Clean up player mesh
            if (playerMeshRef.current) {
                scene.remove(playerMeshRef.current);
                playerMeshRef.current = null;
                if (onPlayerMeshReadyStateChange) {
                    onPlayerMeshReadyStateChange(false);
                }
                if (onPlayerMeshReady) {
                    onPlayerMeshReady(null);
                }
            }
            if (playerMixerRef.current) {
                playerMixerRef.current.stopAllAction();
                playerMixerRef.current = null;
            }
            playerAnimationsRef.current = {};
            playerActiveTagRef.current = undefined;
            // Reset physics time tracking
            lastPhysicsTimeRef.current = 0;
        }
    }, [playModeEnabled, camera, scene]);

    // Initialize physics for player
    useEffect(() => {
        if (playModeEnabled && targetObject === "player" && !physicsRef.current) {
            console.log('[PlayMode] Initializing physics for player');
            const physics = new PhysicsManager({ gravity: { x: 0, y: -32, z: 0 }, tickRate: 60 });
            physicsRef.current = physics;
            
            physics.ready().then(() => {
                physics.addFlatGround(4000, -0.5);
                const pos = targetObjectRef.current?.position || new THREE.Vector3(0, 1.5, 0);
                console.log('[PlayMode] Creating player at:', pos);
                physics.createOrResetPlayer(pos);
                lastPosRef.current = pos.clone();
            });
        } else if (!playModeEnabled && physicsRef.current) {
            console.log('[PlayMode] Cleaning up physics');
            physicsRef.current = null;
        }
    }, [playModeEnabled, targetObject]);

    // Mouse movement for camera rotation (no pointer lock)
    useEffect(() => {
        if (!playModeEnabled) return;

        let isDragging = false;
        let lastMouseX = 0;
        let lastMouseY = 0;

        const handleMouseDown = (e: MouseEvent) => {
            // Only start dragging if clicking on the canvas (not UI elements)
            if ((e.target as HTMLElement)?.tagName === 'CANVAS') {
                isDragging = true;
                lastMouseX = e.clientX;
                lastMouseY = e.clientY;
            }
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            
            const deltaX = (e.clientX - lastMouseX) * mouseSensitivity * 10; // Scale up since we're not using movementX
            const deltaY = (e.clientY - lastMouseY) * mouseSensitivity * 10;

            cameraYawRef.current -= deltaX;
            cameraPitchRef.current -= deltaY;
            cameraPitchRef.current = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cameraPitchRef.current));

            // For first-person (entities/blocks), set camera rotation directly
            // For third-person (player), we'll use yaw/pitch to position camera around player
            if (targetObject !== "player") {
                camera.rotation.order = 'YXZ';
                camera.rotation.y = cameraYawRef.current;
                camera.rotation.x = cameraPitchRef.current;
            }

            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
        };

        const handleMouseUp = () => {
            isDragging = false;
        };

        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [playModeEnabled, camera, targetObject]);

    // Keyboard input handling
    useEffect(() => {
        if (!playModeEnabled) {
            inputStateRef.current.state = {};
            return;
        }

        const stateObj = inputStateRef.current;
        const allowed: Record<string, boolean> = { w: true, a: true, s: true, d: true, sp: true, sh: true };
        const mapKey = (e: KeyboardEvent): string | null => {
            const k = e.key.toLowerCase();
            if (k === ' ') return 'sp';
            if (k === 'shift') return 'sh';
            if (k === 'w' || k === 'a' || k === 's' || k === 'd') return k;
            return null;
        };
        const onKeyDown = (e: KeyboardEvent) => {
            const k = mapKey(e);
            if (!k || !allowed[k]) return;
            stateObj.state[k] = true;
        };
        const onKeyUp = (e: KeyboardEvent) => {
            const k = mapKey(e);
            if (!k || !allowed[k]) return;
            stateObj.state[k] = false;
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, [playModeEnabled]);

    // Movement update loop
    useFrame((state, delta) => {
        if (!playModeEnabled) return;

        const input = inputStateRef.current.state;
        const isRunning = input.sh || false;

        if (targetObject === "player" && physicsRef.current) {
            // Physics-based movement for player
            // Fix: Add Math.PI offset like TerrainBuilder does
            const yaw = cameraYawRef.current + Math.PI;
            const now = performance.now();
            const dt = lastPhysicsTimeRef.current ? (now - lastPhysicsTimeRef.current) / 1000 : delta;
            const dtClamped = Math.min(0.1, Math.max(0, dt));
            lastPhysicsTimeRef.current = now;

            physicsRef.current.step(dtClamped, {
                w: input.w || false,
                a: input.a || false,
                s: input.s || false,
                d: input.d || false,
                sp: input.sp || false,
                sh: input.sh || false,
            }, yaw);

            // Update player mesh position from physics
            const playerPos = physicsRef.current.getPlayerPosition();
            if (playerPos) {
                // Load player mesh if not loaded
                if (!playerMeshRef.current && !(window as any).__WE_PLAYER_MESH_LOADING__) {
                    (window as any).__WE_PLAYER_MESH_LOADING__ = true;
                    console.log('[PlayMode] Loading player mesh');
                    const loader = new GLTFLoader();
                    loader.load(
                        "./assets/models/players/player.gltf",
                        (gltf) => {
                            const obj = gltf.scene || gltf.scenes?.[0];
                            if (obj) {
                                obj.traverse((child: any) => {
                                    if (child.isMesh) {
                                        child.castShadow = true;
                                        child.receiveShadow = true;
                                    }
                                });
                                scene.add(obj);
                                playerMeshRef.current = obj;
                                
                                // Build and log bone map for play mode player mesh
                                console.log('[PlayMode] Building bone map for play mode player mesh...');
                                const playModeBoneMap = new Map<string, THREE.Object3D>();
                                obj.traverse((child) => {
                                    if (child.name && child.name.trim() !== '') {
                                        const nameLower = child.name.toLowerCase();
                                        playModeBoneMap.set(nameLower, child);
                                        playModeBoneMap.set(child.name, child); // Store original name too
                                        console.log(`[PlayMode] Found bone/node: "${child.name}" (type: ${child.type}, uuid: ${child.uuid})`);
                                    }
                                });
                                console.log(`[PlayMode] ✓ Built bone map with ${playModeBoneMap.size} entries`);
                                console.log('[PlayMode] Bone map keys:', Array.from(playModeBoneMap.keys()));
                                
                                // Update boneMapRef with play mode player mesh bones
                                // Note: This is a workaround - we need to update the ref that particle emitters use
                                if (boneMapRef) {
                                    // Clear old bones and add new ones
                                    boneMapRef.current.clear();
                                    playModeBoneMap.forEach((bone, key) => {
                                        boneMapRef.current.set(key, bone);
                                    });
                                    console.log(`[PlayMode] ✓ Updated boneMapRef with ${boneMapRef.current.size} bones`);
                                }
                                
                                console.log('[PlayMode] Player mesh added to scene:', {
                                    name: obj.name,
                                    type: obj.type,
                                    position: obj.position.toArray(),
                                    uuid: obj.uuid,
                                    children: obj.children.length,
                                });
                                
                                if (onPlayerMeshReady) {
                                    onPlayerMeshReady(obj);
                                }
                                
                                // Trigger state update to cause re-attachment of particle emitters
                                if (onPlayerMeshReadyStateChange) {
                                    onPlayerMeshReadyStateChange(true);
                                }
                                
                                // Force a small delay then log to ensure everything is set up
                                setTimeout(() => {
                                    console.log('[PlayMode] Player mesh ready callback completed. Verifying setup:', {
                                        playerMeshRefCurrent: playerMeshRef.current ? {
                                            name: playerMeshRef.current.name,
                                            uuid: playerMeshRef.current.uuid,
                                        } : null,
                                        boneMapSize: boneMapRef.current.size,
                                        boneMapHasHead: boneMapRef.current.has('head'),
                                    });
                                }, 100);

                                // Setup animations
                                if (gltf.animations && gltf.animations.length) {
                                    const mixer = new THREE.AnimationMixer(obj);
                                    playerMixerRef.current = mixer;
                                    const clips = gltf.animations;
                                    const findClip = (names: string[]) =>
                                        clips.find((c) =>
                                            names.some((n) =>
                                                c.name.toLowerCase().includes(n.toLowerCase())
                                            )
                                        );
                                    const actions: Record<string, THREE.AnimationAction> = {};
                                    
                                    // Idle animations
                                    const idleUpper = findClip(["idle-upper", "idle_upper"]);
                                    const idleLower = findClip(["idle-lower", "idle_lower"]);
                                    if (idleUpper) actions["idle-upper"] = mixer.clipAction(idleUpper);
                                    if (idleLower) actions["idle-lower"] = mixer.clipAction(idleLower);
                                    
                                    // Walk animations
                                    const walkUpper = findClip(["walk-upper", "walk_upper"]);
                                    const walkLower = findClip(["walk-lower", "walk_lower"]);
                                    if (walkUpper) actions["walk-upper"] = mixer.clipAction(walkUpper);
                                    if (walkLower) actions["walk-lower"] = mixer.clipAction(walkLower);
                                    
                                    // Run animations
                                    const runUpper = findClip(["run-upper", "run_upper", "sprint-upper", "sprint_upper"]);
                                    const runLower = findClip(["run-lower", "run_lower", "sprint-lower", "sprint_lower"]);
                                    if (runUpper) actions["run-upper"] = mixer.clipAction(runUpper);
                                    if (runLower) actions["run-lower"] = mixer.clipAction(runLower);
                                    
                                    // Jump animations
                                    const jumpUpper = findClip(["jump-upper", "jump_upper"]);
                                    const jumpLower = findClip(["jump-lower", "jump_lower"]);
                                    if (jumpUpper) actions["jump-upper"] = mixer.clipAction(jumpUpper);
                                    if (jumpLower) actions["jump-lower"] = mixer.clipAction(jumpLower);
                                    
                                    playerAnimationsRef.current = actions;
                                    
                                    // Start with idle
                                    if (idleUpper && idleLower) {
                                        idleUpper.reset().fadeIn(0.2).play();
                                        idleLower.reset().fadeIn(0.2).play();
                                        playerActiveTagRef.current = "idle";
                                    }
                                    console.log('[PlayMode] Loaded player animations:', Object.keys(actions));
                                }
                            }
                            (window as any).__WE_PLAYER_MESH_LOADING__ = false;
                        },
                        undefined,
                        () => {
                            (window as any).__WE_PLAYER_MESH_LOADING__ = false;
                        }
                    );
                }

                // Update player mesh position with smoothing
                if (playerMeshRef.current) {
                    const halfH = physicsRef.current.getPlayerHalfHeight();
                    const cur = new THREE.Vector3(
                        playerPos.x,
                        playerPos.y - halfH,
                        playerPos.z
                    );
                    const meshAlpha = 1 - Math.exp(-30 * dtClamped);
                    const oldPos = playerMeshRef.current.position.clone();
                    playerMeshRef.current.position.lerp(cur, meshAlpha);
                    
                    // Log position updates periodically (every ~1 second)
                    if (Math.random() < 0.016) { // ~1% chance per frame at 60fps = ~1 per second
                        console.log('[PlayMode] Player mesh position update:', {
                            oldPos: oldPos.toArray(),
                            newPos: playerMeshRef.current.position.toArray(),
                            physicsPos: playerPos.toArray(),
                            lerpAlpha: meshAlpha,
                        });
                    }
                    
                    // Update rotation based on movement
                    if (lastPosRef.current) {
                        const dx = playerPos.x - lastPosRef.current.x;
                        const dz = playerPos.z - lastPosRef.current.z;
                        const speed2 = dx * dx + dz * dz;
                        if (speed2 > 1e-6) {
                            const faceYaw = Math.atan2(dx, dz) + Math.PI;
                            faceYawRef.current = faceYaw;
                            playerMeshRef.current.rotation.y = faceYaw;
                        }
                    }
                    
                    // Log bone positions periodically to verify they're moving with the mesh
                    if (boneMapRef && boneMapRef.current && Math.random() < 0.016) {
                        console.log('[PlayMode] Sample bone positions (first 3):');
                        let count = 0;
                        boneMapRef.current.forEach((bone, key) => {
                            if (count < 3) {
                                const worldPos = bone.getWorldPosition(new THREE.Vector3());
                                console.log(`  - "${key}": local=${bone.position.toArray()}, world=${worldPos.toArray()}`);
                                count++;
                            }
                        });
                    }
                }

                // Update animations based on movement state
                if (playerMixerRef.current) {
                    playerMixerRef.current.update(dtClamped);
                    const moving = !!(input.w || input.a || input.s || input.d);
                    const running = moving && !!input.sh;
                    const grounded = true; // Simplified - could add proper ground detection
                    
                    let tag = "idle";
                    if (!grounded) {
                        tag = "jump";
                    } else if (moving) {
                        tag = running ? "run" : "walk";
                    }
                    
                    if (playerActiveTagRef.current !== tag) {
                        const actions = playerAnimationsRef.current;
                        // Fade out current
                        if (playerActiveTagRef.current) {
                            const upper = actions[`${playerActiveTagRef.current}-upper`];
                            const lower = actions[`${playerActiveTagRef.current}-lower`];
                            if (upper) upper.fadeOut(0.1);
                            if (lower) lower.fadeOut(0.1);
                        }
                        // Fade in new
                        const upper = actions[`${tag}-upper`];
                        const lower = actions[`${tag}-lower`];
                        if (upper && lower) {
                            upper.reset().fadeIn(0.1).play();
                            lower.reset().fadeIn(0.1).play();
                            playerActiveTagRef.current = tag;
                        }
                    }
                }

                lastPosRef.current = playerPos.clone();
                
                // Third-person camera follow
                const offsetRadius = 8.0;
                const offsetHeight = 3.0;
                const pitch = cameraPitchRef.current;
                const horizontalDistance = offsetRadius * Math.cos(pitch);
                const verticalOffset = offsetRadius * Math.sin(pitch) + offsetHeight;
                
                camera.position.set(
                    playerPos.x - Math.sin(cameraYawRef.current) * horizontalDistance,
                    playerPos.y + verticalOffset,
                    playerPos.z - Math.cos(cameraYawRef.current) * horizontalDistance
                );
                camera.lookAt(playerPos);
            }
        } else if (targetObject !== "none" && targetObject !== "block" && targetObjectRef.current) {
            // Simple camera-based movement for entities/blocks
            const speed = moveSpeed * (isRunning ? runMultiplier : 1) * delta;
            const direction = new THREE.Vector3();
            camera.getWorldDirection(direction);
            direction.y = 0; // Keep movement horizontal
            direction.normalize();

            const right = new THREE.Vector3();
            right.crossVectors(direction, new THREE.Vector3(0, 1, 0));
            right.normalize();

            const moveDelta = new THREE.Vector3(0, 0, 0);
            if (input.w) moveDelta.add(direction.multiplyScalar(speed));
            if (input.s) moveDelta.add(direction.multiplyScalar(-speed));
            if (input.a) moveDelta.add(right.multiplyScalar(-speed));
            if (input.d) moveDelta.add(right.multiplyScalar(speed));

            if (moveDelta.lengthSq() > 0) {
                targetObjectRef.current.position.add(moveDelta);
                camera.position.add(moveDelta);
            }
        }
    });

    return null;
}

export default function ParticleViewerCanvas({
    targetObject,
    entityTarget,
    emitters,
    playModeEnabled,
    onBoneNamesChange,
}: ParticleViewerCanvasProps) {
    const gpuInfo = useMemo(() => detectGPU(), []);
    const contextAttributes = useMemo(() => getOptimalContextAttributes(gpuInfo), [gpuInfo]);
    const targetObjectRef = useRef<THREE.Object3D | null>(null);
    const boneMapRef = useRef<Map<string, THREE.Object3D>>(new Map());
    const playerMeshRef = useRef<THREE.Object3D | null>(null);
    const [playerMeshReady, setPlayerMeshReady] = useState(false); // State to trigger re-attachment
    const initialPositionsRef = useRef<{
        object: THREE.Vector3 | null;
        camera: THREE.Vector3 | null;
        emitters: Map<string, THREE.Vector3>;
    }>({
        object: null,
        camera: null,
        emitters: new Map(),
    });

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
            camera={{ position: [3, 3, -5], fov: 50 }}
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
            <Grid args={[100, 100]} cellColor="#ffffff" sectionColor="#ffffff" fadeDistance={25} />

            {/* Target Object */}
            <TargetObjectRenderer 
                type={targetObject}
                entityTarget={entityTarget}
                playModeEnabled={playModeEnabled}
                onObjectReady={handleObjectReady}
            />

            {/* Camera Positioner - adjusts camera to face front of object */}
            <CameraPositioner 
                targetObjectRef={targetObjectRef}
                playModeEnabled={playModeEnabled}
            />

            {/* Particle Emitters */}
            {emitters.map((emitterConfig) => {
                const effectiveTargetRef = playModeEnabled && targetObject === "player" ? playerMeshRef : targetObjectRef;
                // Include playerMeshReady in key to force re-render when mesh becomes available
                const emitterKey = `${emitterConfig.id}-${playModeEnabled && targetObject === "player" ? `play-${playerMeshReady}` : 'static'}`;
                console.log(`[ParticleViewerCanvas] Rendering emitter ${emitterConfig.id}:`, {
                    playModeEnabled,
                    targetObject,
                    usingPlayerMeshRef: playModeEnabled && targetObject === "player",
                    playerMeshReady,
                    effectiveTargetRefValue: effectiveTargetRef?.current ? {
                        name: effectiveTargetRef.current.name,
                        type: effectiveTargetRef.current.type,
                        uuid: effectiveTargetRef.current.uuid,
                        position: effectiveTargetRef.current.position.toArray(),
                    } : null,
                    boneMapSize: boneMapRef?.current?.size || 0,
                });
                
                return (
                    <ParticleEmitterRenderer
                        key={emitterKey}
                        config={emitterConfig}
                        targetObject={targetObject}
                        targetObjectRef={effectiveTargetRef}
                        boneMapRef={boneMapRef}
                    />
                );
            })}

            {/* Camera Controls */}
            <OrbitControls
                enableZoom={!playModeEnabled}
                enablePan={!playModeEnabled}
                enableRotate={!playModeEnabled}
                minDistance={2}
                maxDistance={20}
                target={[0, 0, 0]}
                autoRotate={false}
            />

            {/* Play Mode Controller */}
            <PlayModeController 
                targetObject={targetObject}
                playModeEnabled={playModeEnabled}
                targetObjectRef={targetObjectRef}
                initialPositionsRef={initialPositionsRef}
                playerMeshRef={playerMeshRef}
                boneMapRef={boneMapRef}
                onPlayerMeshReady={(mesh) => {
                    playerMeshRef.current = mesh;
                }}
                onPlayerMeshReadyStateChange={(ready) => {
                    setPlayerMeshReady(ready);
                }}
            />
        </Canvas>
    );
}

