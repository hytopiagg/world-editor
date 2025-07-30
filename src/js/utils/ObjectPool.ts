import * as THREE from "three";

/**
 * Generic object pool for reusing objects to reduce garbage collection
 */
class ObjectPool<T> {
    private pool: T[] = [];
    private createFn: () => T;
    private resetFn: (obj: T) => void;
    private maxSize: number;
    private activeCount: number = 0;

    constructor(
        createFn: () => T,
        resetFn: (obj: T) => void,
        initialSize: number = 10,
        maxSize: number = 100
    ) {
        this.createFn = createFn;
        this.resetFn = resetFn;
        this.maxSize = maxSize;

        // Pre-populate the pool
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(this.createFn());
        }
    }

    /**
     * Get an object from the pool
     */
    get(): T {
        this.activeCount++;

        if (this.pool.length > 0) {
            const obj = this.pool.pop()!;
            this.resetFn(obj);
            return obj;
        }

        // Pool is empty, create new object
        return this.createFn();
    }

    /**
     * Return an object to the pool
     */
    release(obj: T): void {
        if (this.activeCount > 0) {
            this.activeCount--;
        }

        if (this.pool.length < this.maxSize) {
            this.resetFn(obj);
            this.pool.push(obj);
        }
        // If pool is full, let the object be garbage collected
    }

    /**
     * Get pool statistics
     */
    getStats() {
        return {
            poolSize: this.pool.length,
            activeCount: this.activeCount,
            maxSize: this.maxSize,
        };
    }

    /**
     * Clear the pool
     */
    clear(): void {
        this.pool.length = 0;
        this.activeCount = 0;
    }
}

/**
 * Managed object pool that automatically handles object lifecycle
 */
class ManagedObjectPool<T> {
    private pool: ObjectPool<T>;
    private activeObjects: Set<T> = new Set();

    constructor(
        createFn: () => T,
        resetFn: (obj: T) => void,
        initialSize: number = 10,
        maxSize: number = 100
    ) {
        this.pool = new ObjectPool(createFn, resetFn, initialSize, maxSize);
    }

    /**
     * Get an object from the pool
     */
    get(): T {
        const obj = this.pool.get();
        this.activeObjects.add(obj);
        return obj;
    }

    /**
     * Return an object to the pool
     */
    release(obj: T): void {
        if (this.activeObjects.has(obj)) {
            this.activeObjects.delete(obj);
            this.pool.release(obj);
        }
    }

    /**
     * Release all active objects back to the pool
     */
    releaseAll(): void {
        for (const obj of this.activeObjects) {
            this.pool.release(obj);
        }
        this.activeObjects.clear();
    }

    /**
     * Get pool statistics
     */
    getStats() {
        return {
            ...this.pool.getStats(),
            activeObjectsTracked: this.activeObjects.size,
        };
    }
}

/**
 * Global object pools for common THREE.js objects
 */
export class ObjectPoolManager {
    private static instance: ObjectPoolManager;

    private vector3Pool: ObjectPool<THREE.Vector3>;
    private matrix4Pool: ObjectPool<THREE.Matrix4>;
    private eulerPool: ObjectPool<THREE.Euler>;
    private quaternionPool: ObjectPool<THREE.Quaternion>;
    private box3Pool: ObjectPool<THREE.Box3>;

    private constructor() {
        // Vector3 pool
        this.vector3Pool = new ObjectPool(
            () => new THREE.Vector3(),
            (v) => v.set(0, 0, 0),
            20, // Initial size
            200 // Max size
        );

        // Matrix4 pool
        this.matrix4Pool = new ObjectPool(
            () => new THREE.Matrix4(),
            (m) => m.identity(),
            10,
            100
        );

        // Euler pool
        this.eulerPool = new ObjectPool(
            () => new THREE.Euler(),
            (e) => e.set(0, 0, 0),
            10,
            100
        );

        // Quaternion pool
        this.quaternionPool = new ObjectPool(
            () => new THREE.Quaternion(),
            (q) => q.set(0, 0, 0, 1),
            10,
            100
        );

        // Box3 pool
        this.box3Pool = new ObjectPool(
            () => new THREE.Box3(),
            (b) => b.makeEmpty(),
            5,
            50
        );
    }

    static getInstance(): ObjectPoolManager {
        if (!ObjectPoolManager.instance) {
            ObjectPoolManager.instance = new ObjectPoolManager();
        }
        return ObjectPoolManager.instance;
    }

    /**
     * Get a Vector3 from the pool
     */
    getVector3(): THREE.Vector3 {
        return this.vector3Pool.get();
    }

    /**
     * Return a Vector3 to the pool
     */
    releaseVector3(vector: THREE.Vector3): void {
        this.vector3Pool.release(vector);
    }

    /**
     * Get a Matrix4 from the pool
     */
    getMatrix4(): THREE.Matrix4 {
        return this.matrix4Pool.get();
    }

    /**
     * Return a Matrix4 to the pool
     */
    releaseMatrix4(matrix: THREE.Matrix4): void {
        this.matrix4Pool.release(matrix);
    }

    /**
     * Get an Euler from the pool
     */
    getEuler(): THREE.Euler {
        return this.eulerPool.get();
    }

    /**
     * Return an Euler to the pool
     */
    releaseEuler(euler: THREE.Euler): void {
        this.eulerPool.release(euler);
    }

    /**
     * Get a Quaternion from the pool
     */
    getQuaternion(): THREE.Quaternion {
        return this.quaternionPool.get();
    }

    /**
     * Return a Quaternion to the pool
     */
    releaseQuaternion(quaternion: THREE.Quaternion): void {
        this.quaternionPool.release(quaternion);
    }

    /**
     * Get a Box3 from the pool
     */
    getBox3(): THREE.Box3 {
        return this.box3Pool.get();
    }

    /**
     * Return a Box3 to the pool
     */
    releaseBox3(box: THREE.Box3): void {
        this.box3Pool.release(box);
    }

    /**
     * Get statistics for all pools
     */
    getAllStats() {
        return {
            vector3: this.vector3Pool.getStats(),
            matrix4: this.matrix4Pool.getStats(),
            euler: this.eulerPool.getStats(),
            quaternion: this.quaternionPool.getStats(),
            box3: this.box3Pool.getStats(),
        };
    }

    /**
     * Clear all pools
     */
    clearAllPools(): void {
        this.vector3Pool.clear();
        this.matrix4Pool.clear();
        this.eulerPool.clear();
        this.quaternionPool.clear();
        this.box3Pool.clear();
    }
}

// Export convenience functions
export const getVector3 = () => ObjectPoolManager.getInstance().getVector3();
export const releaseVector3 = (v: THREE.Vector3) =>
    ObjectPoolManager.getInstance().releaseVector3(v);
export const getMatrix4 = () => ObjectPoolManager.getInstance().getMatrix4();
export const releaseMatrix4 = (m: THREE.Matrix4) =>
    ObjectPoolManager.getInstance().releaseMatrix4(m);
export const getEuler = () => ObjectPoolManager.getInstance().getEuler();
export const releaseEuler = (e: THREE.Euler) =>
    ObjectPoolManager.getInstance().releaseEuler(e);
export const getQuaternion = () =>
    ObjectPoolManager.getInstance().getQuaternion();
export const releaseQuaternion = (q: THREE.Quaternion) =>
    ObjectPoolManager.getInstance().releaseQuaternion(q);
export const getBox3 = () => ObjectPoolManager.getInstance().getBox3();
export const releaseBox3 = (b: THREE.Box3) =>
    ObjectPoolManager.getInstance().releaseBox3(b);

// Export the main class
export { ObjectPool, ManagedObjectPool };
