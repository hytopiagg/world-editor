import RAPIER from "@dimforge/rapier3d-simd-compat";
import * as THREE from "three";

export type PhysicsInitOptions = {
    gravity?: { x: number; y: number; z: number };
    tickRate?: number; // per second
};

export type PlayerControllerOptions = {
    radius?: number;
    height?: number;
    speedWalk?: number;
    speedRun?: number;
    jumpVelocity?: number;
};

export class PhysicsManager {
    private static _initPromise: Promise<void> | null = null;

    private _world: RAPIER.World | undefined;
    private _eventQueue: RAPIER.EventQueue | undefined;
    private _fixedTimeStep: number;
    private _accumulator = 0;

    // Simple player body & controller state
    private _playerBody: RAPIER.RigidBody | null = null;
    private _playerCollider: RAPIER.Collider | null = null;
    private _options: PlayerControllerOptions;
    private _onUpdatePlayerCamera?: (pos: THREE.Vector3) => void;

    private _readyPromise: Promise<void>;
    private _gravity: { x: number; y: number; z: number };
    private _isSolidFn: ((x: number, y: number, z: number) => boolean) | null =
        null;

    constructor(options: PhysicsInitOptions = {}) {
        this._gravity = options.gravity ?? { x: 0, y: -32, z: 0 };
        const tickRate = options.tickRate ?? 60;

        this._fixedTimeStep = 1 / tickRate;
        this._options = {
            radius: 0.35,
            height: 1.5,
            speedWalk: 4,
            speedRun: 8,
            jumpVelocity: 10,
        };

        if (!PhysicsManager._initPromise) {
            PhysicsManager._initPromise = RAPIER.init();
        }

        this._readyPromise = PhysicsManager._initPromise.then(() => {
            this._world = new RAPIER.World(this._gravity);
            this._eventQueue = new RAPIER.EventQueue(true);
        });
    }

    public ready(): Promise<void> {
        return this._readyPromise;
    }

    public setIsSolidQuery(fn: (x: number, y: number, z: number) => boolean) {
        this._isSolidFn = fn;
    }
    public getPlayerHalfHeight(): number {
        return Math.max(0.01, (this._options.height ?? 1.5) / 2);
    }

    public setPlayerUpdateCallback(cb: (pos: THREE.Vector3) => void) {
        this._onUpdatePlayerCamera = cb;
    }

    public createOrResetPlayer(
        initialPosition: THREE.Vector3,
        opts?: Partial<PlayerControllerOptions>
    ) {
        if (!this._world) return; // not ready yet
        this._options = { ...this._options, ...(opts ?? {}) };

        // Remove old
        if (this._playerCollider)
            this._world.removeCollider(this._playerCollider, true);
        if (this._playerBody) this._world.removeRigidBody(this._playerBody);

        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(
                initialPosition.x,
                initialPosition.y,
                initialPosition.z
            )
            .lockRotations();
        this._playerBody = this._world.createRigidBody(bodyDesc);

        const halfHeight = Math.max(0.01, (this._options.height ?? 1.5) / 2);
        const radius = Math.max(0.01, this._options.radius ?? 0.35);
        const colliderDesc = RAPIER.ColliderDesc.capsule(
            halfHeight - radius,
            radius
        )
            .setFriction(0)
            .setRestitution(0)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        this._playerCollider = this._world.createCollider(
            colliderDesc,
            this._playerBody
        );
    }

    public addStaticTrimesh(
        vertices: Float32Array,
        indices: Uint32Array,
        position?: THREE.Vector3
    ) {
        if (!this._world) return null;
        const rb = this._world.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(
                position?.x ?? 0,
                position?.y ?? 0,
                position?.z ?? 0
            )
        );
        const collider = RAPIER.ColliderDesc.trimesh(
            vertices,
            indices,
            undefined
        )
            .setFriction(0.8)
            .setRestitution(0);
        this._world.createCollider(collider, rb);
        return rb;
    }

    public addFlatGround(size: number = 2000, y: number = 0) {
        if (!this._world) return null;
        const rb = this._world.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(0, y, 0)
        );
        const half = size / 2;
        const collider = RAPIER.ColliderDesc.cuboid(half, 0.5, half)
            .setFriction(0.9)
            .setRestitution(0);
        this._world.createCollider(collider, rb);
        // Store top surface Y for simple ground-plane checks
        // Rapier cuboid half-height is 0.5, so top surface is y + 0.5
        (this as any)._flatGroundTopY = y + 0.5;
        return rb;
    }

    public removeRigidBody(rb: RAPIER.RigidBody) {
        if (!this._world) return;
        this._world.removeRigidBody(rb);
    }

    public getPlayerPosition(): THREE.Vector3 | null {
        if (!this._playerBody) return null;
        const t = this._playerBody.translation();
        return new THREE.Vector3(t.x, t.y, t.z);
    }

    public step(
        deltaSeconds: number,
        input: {
            w?: boolean;
            a?: boolean;
            s?: boolean;
            d?: boolean;
            sh?: boolean;
            sp?: boolean;
            c?: boolean;
        },
        cameraYaw: number
    ) {
        if (!this._world || !this._eventQueue) return;
        this._accumulator += deltaSeconds;
        while (this._accumulator >= this._fixedTimeStep) {
            this._simulateFixed(input, cameraYaw);
            this._accumulator -= this._fixedTimeStep;
        }

        if (this._playerBody && this._onUpdatePlayerCamera) {
            const t = this._playerBody.translation();
            this._onUpdatePlayerCamera(new THREE.Vector3(t.x, t.y + 1.2, t.z));
        }
    }

    private _simulateFixed(
        input: {
            w?: boolean;
            a?: boolean;
            s?: boolean;
            d?: boolean;
            sh?: boolean;
            sp?: boolean;
            c?: boolean;
        },
        cameraYaw: number
    ) {
        if (!this._world) return;
        if (this._playerBody) {
            const lv = this._playerBody.linvel();
            let targetX = 0,
                targetZ = 0;

            const speed = input.sh
                ? this._options.speedRun ?? 8
                : this._options.speedWalk ?? 4;
            const sinYaw = Math.sin(cameraYaw);
            const cosYaw = Math.cos(cameraYaw);

            if (input.w) {
                targetX -= speed * sinYaw;
                targetZ -= speed * cosYaw;
            }
            if (input.s) {
                targetX += speed * sinYaw;
                targetZ += speed * cosYaw;
            }
            if (input.a) {
                targetX -= speed * cosYaw;
                targetZ += speed * sinYaw;
            }
            if (input.d) {
                targetX += speed * cosYaw;
                targetZ -= speed * sinYaw;
            }

            // Normalize
            const mag = Math.hypot(targetX, targetZ);
            if (mag > speed) {
                const f = speed / mag;
                targetX *= f;
                targetZ *= f;
            }

            // Basic voxel collision using external spatial hash if available
            const pos = this._playerBody.translation();
            const dt = this._fixedTimeStep;
            const radius = Math.max(0.01, this._options.radius ?? 0.35);
            const halfHeight = Math.max(
                0.01,
                (this._options.height ?? 1.5) / 2
            );
            const next = {
                x: pos.x + targetX * dt,
                y: pos.y + lv.y * dt,
                z: pos.z + targetZ * dt,
            };
            const isSolid = (x: number, y: number, z: number) => {
                try {
                    if (this._isSolidFn) return this._isSolidFn(x, y, z);
                    // fallback to window hook if present
                    // @ts-ignore
                    if (typeof (window as any).__WE_IS_SOLID__ === "function") {
                        // @ts-ignore
                        return (window as any).__WE_IS_SOLID__(x, y, z);
                    }
                } catch {}
                return false;
            };

            // Helper to sample a few points around capsule feet/head at a given Y plane
            const sampleXZSolid = (
                cx: number,
                cy: number,
                cz: number
            ): boolean => {
                const offsets: Array<[number, number]> = [
                    [0, 0],
                    [radius * 0.8, 0],
                    [-radius * 0.8, 0],
                    [0, radius * 0.8],
                    [0, -radius * 0.8],
                ];
                const by = Math.floor(cy);
                for (const [ox, oz] of offsets) {
                    const bx = Math.floor(cx + ox);
                    const bz = Math.floor(cz + oz);
                    if (isSolid(bx, by, bz)) return true;
                }
                return false;
            };

            // Resolve horizontal X, Z independently to avoid getting stuck on corners
            // Test at mid section of capsule
            const midY = next.y;
            // Try move in X
            if (sampleXZSolid(next.x, midY, pos.z)) {
                targetX = 0;
                next.x = pos.x;
            }
            // Try move in Z
            if (sampleXZSolid(pos.x, midY, next.z)) {
                targetZ = 0;
                next.z = pos.z;
            }

            // Vertical collision: ground and ceiling
            let newVy = lv.y;
            const bottom = next.y - halfHeight;
            const top = next.y + halfHeight;
            const groundY = Math.floor(bottom - 0.01);
            const ceilingY = Math.floor(top + 0.01);

            let grounded = false;
            // Detect ground contact if a solid block is directly below within a small tolerance
            if (newVy <= 0) {
                const nearTopOfGround = bottom <= groundY + 1 + 0.08; // tolerance 8cm
                const hasVoxelSupport = sampleXZSolid(next.x, groundY, next.z);
                const planeTopY = (this as any)._flatGroundTopY;
                const nearFlatPlane =
                    typeof planeTopY === "number" &&
                    Math.abs(bottom - planeTopY) <= 0.08 &&
                    bottom <= planeTopY + 0.08;
                if (nearTopOfGround && hasVoxelSupport) {
                    grounded = true;
                    newVy = 0;
                    next.y = groundY + 1 + halfHeight + 0.001; // small epsilon
                } else if (nearFlatPlane) {
                    grounded = true;
                    newVy = 0;
                    next.y = planeTopY + halfHeight + 0.001; // snap to plane top
                }
            }
            // Ceiling check (moving up): stop upward motion if intersecting just below ceiling
            if (newVy > 0) {
                const nearBottomOfCeiling = top >= ceilingY - 0.08;
                if (
                    nearBottomOfCeiling &&
                    sampleXZSolid(next.x, ceilingY, next.z)
                ) {
                    newVy = 0;
                    next.y = ceilingY - halfHeight - 0.001;
                }
            }

            // Apply resolved velocity
            this._playerBody.setLinvel(
                { x: targetX, y: newVy, z: targetZ },
                true
            );
            // Apply positional snap if changed (prevents sinking)
            if (next.y !== pos.y || next.x !== pos.x || next.z !== pos.z) {
                // Only correct Y snap to avoid fighting integration for XZ
                if (next.y !== pos.y) {
                    this._playerBody.setTranslation(
                        { x: pos.x, y: next.y, z: pos.z },
                        true
                    );
                }
            }

            // Jump only when grounded (prevents stuck-on-ground no-jump)
            if (input.sp && grounded) {
                this._playerBody.setLinvel(
                    {
                        x: targetX,
                        y: this._options.jumpVelocity ?? 10,
                        z: targetZ,
                    },
                    true
                );
            }
        }

        this._world.step(this._eventQueue!);
    }
}

export default PhysicsManager;
