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

            // Preserve Y from physics, set XZ to target
            this._playerBody.setLinvel(
                { x: targetX, y: lv.y, z: targetZ },
                true
            );

            // Jump (very simple: allow when roughly grounded)
            if (input.sp && Math.abs(lv.y) < 0.001) {
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
