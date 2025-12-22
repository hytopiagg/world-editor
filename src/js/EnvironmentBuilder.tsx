import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import BlockMaterial from "./blocks/BlockMaterial";
import {
    useEffect,
    useRef,
    useState,
    useImperativeHandle,
    forwardRef,
} from "react";
import { DatabaseManager, STORES } from "./managers/DatabaseManager";
import { ENVIRONMENT_OBJECT_Y_OFFSET, MAX_ENVIRONMENT_OBJECTS } from "./Constants";
import { CustomModel } from "./types/DatabaseTypes";
import { getViewDistance } from "./constants/terrain";
import { getVector3, releaseVector3, getMatrix4, releaseMatrix4, getEuler, releaseEuler, getQuaternion, releaseQuaternion, ObjectPoolManager } from "./utils/ObjectPool";
export const environmentModels = (() => {
    try {
        const fetchModelList = () => {
            const manifestUrl = `${process.env.PUBLIC_URL}/assets/models/environment/mattifest.json`;
            const xhr = new XMLHttpRequest();
            xhr.open("GET", manifestUrl, false); // false makes it synchronous
            xhr.send();
            if (xhr.status !== 200) {
                throw new Error("Failed to load model mattifest");
            }
            return JSON.parse(xhr.responseText);
        };
        let idCounter = 2000; // Default models occupy 2000-4999 range
        const models = new Map();
        const result = [];

        const modelList = fetchModelList();

        // Handle both old format (array of strings) and new format (array of objects with path/thumbnail)
        const isEnhancedFormat = Array.isArray(modelList) && modelList.length > 0 && typeof modelList[0] === 'object' && 'path' in modelList[0];

        modelList.forEach((entry) => {
            // Extract path and thumbnail from entry (handles both formats)
            const fileName = isEnhancedFormat ? entry.path : entry;
            const thumbnailPath = isEnhancedFormat ? entry.thumbnail : null;

            // Derive category (first folder) and base filename for display name
            const parts = fileName.split("/");
            const baseName = parts.pop().replace(".gltf", "");
            const category = parts.length > 0 ? parts[0] : "Misc";

            const model = {
                id: idCounter++,
                name: baseName,
                modelUrl: `assets/models/environment/${fileName}`,
                thumbnailUrl: thumbnailPath ? `assets/models/environment/${thumbnailPath}` : null,
                category,
                isEnvironment: true,
                animations: ["idle"],
                addCollider: true,
            };
            models.set(baseName, model);
            result.push(model);
        });
        return result;
    } catch (error) {
        console.error("Error loading environment models:", error);
        return [];
    }
})();

// Helper: returns stored vertical y-shift (in units) for the given model URL, defaulting to 0
const getModelYShift = (modelUrl?: string) => {
    if (!modelUrl) return 0;
    const model = environmentModels.find((m) => m.modelUrl === modelUrl);
    return model && typeof model.yShift === "number" ? model.yShift : 0;
};

const EnvironmentBuilder = (
    {
        scene,
        projectId,
        previewPositionFromAppJS,
        currentBlockType,
        onTotalObjectsChange,
        placementSize = "single",
        placementSettings,
        onPlacementSettingsChange,
        undoRedoManager,
        terrainBuilderRef,
        cameraPosition,
    },
    ref
) => {
    const loader = useRef(new GLTFLoader());
    const placeholderMeshRef = useRef(null);
    const loadedModels = useRef(new Map());
    const instancedMeshes = useRef(new Map());
    const positionOffset = useRef(new THREE.Vector3(0, ENVIRONMENT_OBJECT_Y_OFFSET, 0));
    const placementSizeRef = useRef(placementSize);
    const lastPreviewTransform = useRef({
        scale: new THREE.Vector3(1, 1, 1),
        rotation: new THREE.Euler(0, 0, 0),
    });
    const placementSettingsRef = useRef(placementSettings);
    const isUndoRedoOperation = useRef(false);
    const recentlyPlacedInstances = useRef(new Set()); // Track recently placed instances to bypass throttling
    // Manual rotation steps applied via keyboard (R). Each step is 90 degrees (PI/2 radians)
    const manualRotationStepsRef = useRef(0);

    const [totalEnvironmentObjects, setTotalEnvironmentObjects] = useState(0);
    const lastCullingUpdate = useRef(0);
    const CULLING_UPDATE_INTERVAL = 100; // Restored to 100ms for better performance

    const updateDistanceCulling = (cameraPos: THREE.Vector3) => {
        if (!cameraPos) return;

        const viewDistance = getViewDistance();
        const viewDistanceSquared = viewDistance * viewDistance;

        let totalVisible = 0;
        let totalHidden = 0;
        let hasAnyChanges = false;

        // First pass: check for visibility changes
        for (const [modelUrl, instancedData] of instancedMeshes.current.entries()) {
            if (!instancedData.meshes || !instancedData.addedToScene) continue;

            const instances: [number, any][] = Array.from(instancedData.instances.entries());
            let hasChanges = false;
            let visibilityChangeCount = 0;

            instances.forEach(([instanceId, data]) => {
                const distance = cameraPos.distanceToSquared(data.position);
                const isVisible = distance <= viewDistanceSquared;

                // Check if visibility state has changed
                const wasVisible = data.isVisible !== false; // Default to true for backward compatibility

                if (isVisible !== wasVisible) {
                    hasChanges = true;
                    hasAnyChanges = true;
                    visibilityChangeCount++;
                    data.isVisible = isVisible;
                }

                if (isVisible) {
                    totalVisible++;
                } else {
                    totalHidden++;
                }
            });

            // Check if this model has recently placed instances
            const hasRecentlyPlacedInstances = Array.from(recentlyPlacedInstances.current).some((key: string) => key.startsWith(`${modelUrl}:`));

            // Rebuild visible instances if there were changes for this model OR if there are recently placed instances
            if (hasChanges || hasRecentlyPlacedInstances) {
                rebuildVisibleInstances(modelUrl, cameraPos);
            }
        }
    };

    const throttledUpdateDistanceCulling = (cameraPos: THREE.Vector3) => {
        const now = Date.now();
        if (now - lastCullingUpdate.current > CULLING_UPDATE_INTERVAL) {
            updateDistanceCulling(cameraPos);
            lastCullingUpdate.current = now;
        }
    };

    const forceUpdateDistanceCulling = (cameraPos: THREE.Vector3) => {
        updateDistanceCulling(cameraPos);
        lastCullingUpdate.current = Date.now();
    };

    const rebuildVisibleInstances = (modelUrl: string, cameraPos?: THREE.Vector3) => {
        const instancedData = instancedMeshes.current.get(modelUrl);
        if (!instancedData || !instancedData.meshes || !instancedData.addedToScene) return;

        const instances: [number, any][] = Array.from(instancedData.instances.entries());
        let recentlyPlacedVisible = 0;
        const visibleInstances = [];

        // If camera position is provided, use distance + frustum culling
        if (cameraPos) {
            const viewDistance = getViewDistance();
            const viewDistanceSquared = viewDistance * viewDistance;

            // Get camera frustum for view-based culling
            const camera = (scene as any)?.camera;
            let frustum = null;
            if (camera) {
                camera.updateMatrixWorld();
                camera.updateProjectionMatrix();
                const projScreenMatrix = new THREE.Matrix4();
                projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
                frustum = new THREE.Frustum();
                frustum.setFromProjectionMatrix(projScreenMatrix);
            }

            instances.forEach(([instanceId, data]) => {
                const distance = cameraPos.distanceToSquared(data.position);
                const instanceKey = `${modelUrl}:${instanceId}`;
                const isRecentlyPlaced = recentlyPlacedInstances.current.has(instanceKey);

                // Recently placed instances bypass all culling and are always visible
                let isVisible = isRecentlyPlaced;

                if (!isVisible) {
                    // Apply distance culling
                    const withinDistance = distance <= viewDistanceSquared;

                    // Apply frustum culling (per-instance)
                    let withinFrustum = true;
                    if (frustum && withinDistance) {
                        // Create a small sphere around the instance position for frustum testing
                        const sphere = new THREE.Sphere(data.position, 2); // 2-unit radius for model bounds
                        withinFrustum = frustum.intersectsSphere(sphere);
                    }

                    isVisible = withinDistance && withinFrustum;
                }

                data.isVisible = isVisible;

                if (isVisible) {
                    visibleInstances.push({ instanceId, data });
                }

                if (isRecentlyPlaced) recentlyPlacedVisible++;
            });
        } else {
            // If no camera position, show all instances
            instances.forEach(([instanceId, data]) => {
                data.isVisible = true;
                visibleInstances.push({ instanceId, data });
            });
        }

        // Instead of compacting matrices, we scale invisible instances to zero
        // This maintains the instanceId -> matrix index mapping and prevents newly placed
        // instances from being incorrectly culled when old instances go out of view
        instancedData.meshes.forEach((mesh, meshIndex) => {
            // Ensure mesh.count covers all instance IDs that exist
            const maxInstanceId = instances.length > 0 ? Math.max(...instances.map(([id]) => id)) : 0;
            const requiredCount = maxInstanceId + 1;

            // Only increase the count if needed, never decrease it during culling
            if (mesh.count < requiredCount) {
                mesh.count = requiredCount;
            }

            let visibleCount = 0;
            let hiddenCount = 0;

            // First, create a set of all active instance IDs for comparison
            const activeInstanceIds = new Set(instances.map(([id]) => id));

            // For any matrix indices that don't have active instances, we should hide them
            for (let i = 0; i < mesh.count; i++) {
                if (!activeInstanceIds.has(i)) {
                    const hiddenMatrix = getMatrix4().makeScale(0, 0, 0);
                    mesh.setMatrixAt(i, hiddenMatrix);
                    releaseMatrix4(hiddenMatrix);
                    hiddenCount++;
                }
            }

            instances.forEach(([instanceId, data]) => {
                if (data.isVisible) {
                    // Set the normal matrix for visible instances
                    mesh.setMatrixAt(instanceId, data.matrix);
                    visibleCount++;
                } else {
                    // Hide invisible instances by scaling them to zero
                    const hiddenMatrix = getMatrix4().makeScale(0, 0, 0);
                    mesh.setMatrixAt(instanceId, hiddenMatrix);
                    releaseMatrix4(hiddenMatrix);
                    hiddenCount++;
                }
            });

            mesh.instanceMatrix.needsUpdate = true;
        });

    };

    const rebuildAllVisibleInstances = (cameraPos?: THREE.Vector3) => {
        // First, ensure all meshes are added to the scene before rebuilding
        // This is critical for models loaded from DB - their meshes might not be in the scene yet
        // This fixes the issue where the last model type doesn't render until a new instance is placed
        for (const [modelUrl, instancedData] of instancedMeshes.current.entries()) {
            if (instancedData.instances && instancedData.instances.size > 0) {
                ensureInstancedMeshesAdded(modelUrl);
            }
        }
        // Now rebuild all visible instances
        for (const [modelUrl, instancedData] of instancedMeshes.current.entries()) {
            if (instancedData.instances && instancedData.instances.size > 0) {
                rebuildVisibleInstances(modelUrl, cameraPos);
            }
        }
    };

    const ensureInstancedMeshesAdded = (modelUrl: string): boolean => {
        const data = instancedMeshes.current.get(modelUrl);
        if (!scene || !data) return false;

        // Check if meshes are actually in the current scene
        // Scene can change (new UUID), so we need to re-add meshes even if addedToScene was true
        const meshesInScene = data.meshes.every(mesh => scene.children.includes(mesh));

        if (!meshesInScene) {
            data.meshes.forEach((mesh: THREE.InstancedMesh) => {
                // Remove from old scene if it exists
                if (mesh.parent) {
                    mesh.parent.remove(mesh);
                }
                // Ensure frustum culling is disabled - we handle our own distance culling
                mesh.frustumCulled = false;
                scene.add(mesh);
            });
            data.addedToScene = true;
            return true; // Meshes were added
        } else if (!data.addedToScene) {
            // First time adding
            data.meshes.forEach((mesh: THREE.InstancedMesh) => {
                mesh.frustumCulled = false;
                scene.add(mesh);
            });
            data.addedToScene = true;
            return true; // Meshes were added
        }
        return false; // Meshes were already in scene
    };



    const getAllEnvironmentObjects = () => {
        const instances = [];
        for (const [modelUrl, instancedData] of (instancedMeshes.current as Map<string, any>).entries()) {
            const name = modelUrl.split("/").pop()?.split(".")[0];
            const instanceData = [...(instancedData.instances as Map<number, any>).entries()];
            instanceData.forEach((instance) => {
                instances.push({
                    name,
                    modelUrl,
                    instanceId: instance[0],
                    position: {
                        x: instance[1]?.position?.x,
                        y: instance[1]?.position?.y,
                        z: instance[1]?.position?.z,
                    },
                    rotation: {
                        x: instance[1]?.rotation?.x,
                        y: instance[1]?.rotation?.y,
                        z: instance[1]?.rotation?.z,
                    },
                    scale: {
                        x: instance[1]?.scale?.x,
                        y: instance[1]?.scale?.y,
                        z: instance[1]?.scale?.z,
                    },
                });
            });
        }
        return instances;
    };

    const getAllEnvironmentPositionsAsObject = () => {
        const positions = {};
        let instanceData = [];
        for (const x of [...instancedMeshes.current]) {
            instanceData.push(...x[1].instances);
            instanceData.forEach((instance) => {
                positions[`${instance[1]?.position?.x}-${instance[1]?.position?.y}-${instance[1]?.position?.z}`] = 1000;
            });
        }
        return positions;
    }

    const forceRebuildSpatialHash = () => {
        const instances = getAllEnvironmentObjects();
        instances.forEach((instance) => {
            const yOffsetFR = getModelYShift(instance.modelUrl) + ENVIRONMENT_OBJECT_Y_OFFSET;
            terrainBuilderRef.current.updateSpatialHashForBlocks([{
                x: instance.position.x,
                y: instance.position.y - yOffsetFR,
                z: instance.position.z,
                blockId: 1000,
            }], [], {
                force: true,
            });
        });
    };

    // Check if any instance has this position, if so, return the true
    const hasInstanceAtPosition = (position) => {
        const instances = getAllEnvironmentObjects();
        return instances.some((instance) => instance.position.x === position.x && instance.position.y - ENVIRONMENT_OBJECT_Y_OFFSET === position.y && instance.position.z === position.z);
    };

    const updateEnvironmentForUndoRedo = (added, removed, source: "undo" | "redo") => {
        if (removed && Object.keys(removed).length > 0) {
            Object.values(removed).forEach((instance: {
                instanceId: number;
                modelUrl: string;
                position: { x: number; y: number; z: number };
            }) => {
                removeInstance(instance.modelUrl, instance.instanceId, false);
                const yOffsetRemove = getModelYShift(instance.modelUrl) + ENVIRONMENT_OBJECT_Y_OFFSET;
                terrainBuilderRef.current.updateSpatialHashForBlocks([], [{
                    x: instance.position.x,
                    y: instance.position.y - yOffsetRemove,
                    z: instance.position.z,
                    blockId: 1000,
                }], {
                    force: true,
                });
            });
        }
        if (added && Object.keys(added).length > 0) {
            Object.values(added).forEach((instance: {
                instanceId: number;
                modelUrl: string;
                position: { x: number; y: number; z: number };
                rotation: { x: number; y: number; z: number };
                scale: { x: number; y: number; z: number };
            }) => {
                if (instancedMeshes.current.has(instance.modelUrl)) {
                    ensureInstancedMeshesAdded(instance.modelUrl);
                    const instancedData = instancedMeshes.current.get(instance.modelUrl);
                    const position = new THREE.Vector3(instance.position.x, instance.position.y, instance.position.z);
                    const rotation = new THREE.Euler(instance.rotation.x, instance.rotation.y, instance.rotation.z);
                    const scale = new THREE.Vector3(instance.scale.x, instance.scale.y, instance.scale.z);

                    const matrix = new THREE.Matrix4();
                    matrix.compose(
                        position,
                        new THREE.Quaternion().setFromEuler(rotation),
                        scale
                    );

                    // Don't set matrices directly - rebuild visible instances instead
                    rebuildVisibleInstances(instance.modelUrl, cameraPosition);

                    instancedData.instances.set(instance.instanceId, {
                        position,
                        rotation,
                        scale,
                        matrix,
                        isVisible: true
                    });

                    const yOffsetAdd = getModelYShift(instance.modelUrl) + ENVIRONMENT_OBJECT_Y_OFFSET;
                    terrainBuilderRef.current.updateSpatialHashForBlocks([{
                        x: instance.position.x,
                        y: instance.position.y - yOffsetAdd,
                        z: instance.position.z,
                        blockId: 1000,
                    }], [], {
                        force: true,
                    });
                }
            });
        }
    };

    const loadModel = async (modelToLoadUrl) => {
        if (!modelToLoadUrl) {
            return null;
        }

        if (loadedModels.current.has(modelToLoadUrl)) {
            return loadedModels.current.get(modelToLoadUrl);
        }

        let fullUrl;
        if (modelToLoadUrl.startsWith("blob:")) {
            fullUrl = modelToLoadUrl;
        } else if (modelToLoadUrl.startsWith("http")) {
            fullUrl = modelToLoadUrl;
        } else {
            const cleanPath = modelToLoadUrl.replace(/^\/+/, "");
            fullUrl = `${process.env.PUBLIC_URL}/${cleanPath}`;
        }
        try {
            const response = await fetch(fullUrl);
            if (!response.ok) {
                throw new Error(`Failed to load model: ${fullUrl}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            return new Promise((resolve, reject) => {
                loader.current.parse(
                    arrayBuffer,
                    "",
                    (gltf) => {
                        loadedModels.current.set(modelToLoadUrl, gltf);
                        resolve(gltf);
                    },
                    (error) => reject(error)
                );
            });
        } catch (error) {
            return null;
        }
    };
    // Lazy load a model when it's actually needed (for placement or rendering)
    const ensureModelLoaded = async (model: typeof environmentModels[0]): Promise<boolean> => {
        const modelUrl = model.modelUrl;

        // Check if model is already loaded
        if (loadedModels.current.has(modelUrl)) {
            const instancedData = instancedMeshes.current.get(modelUrl);
            if (instancedData && instancedData.meshes && instancedData.meshes.length > 0) {
                return true; // Already loaded and ready
            }
        }

        // Load the model
        try {
            const gltf = await loadModel(modelUrl);
            if (gltf) {
                gltf.scene.updateMatrixWorld(true);
                await new Promise((r) => setTimeout(r, 0));
                setupInstancedMesh(model, gltf);
                return true;
            }
        } catch (error) {
            // Error lazy loading model
        }
        return false;
    };

    const preloadModels = async () => {
        try {
            const customModels = await DatabaseManager.getData(
                STORES.CUSTOM_MODELS,
                "models"
            ) as CustomModel[];
            if (customModels) {
                const customModelIndices = environmentModels
                    .filter((model) => model.isCustom)
                    .map((model) => environmentModels.indexOf(model));

                customModelIndices
                    .sort((a, b) => b - a)
                    .forEach((index) => {
                        environmentModels.splice(index, 1);
                    });
                for (const model of customModels) {
                    const blob = new Blob([model.data], {
                        type: "model/gltf+json",
                    });
                    const fileUrl = URL.createObjectURL(blob);
                    const newEnvironmentModel = {
                        id:
                            Math.max(
                                4999, // ensure custom models start at 5000+
                                ...environmentModels
                                    .filter((model) => model.isCustom)
                                    .map((model) => model.id)
                            ) + 1,
                        name: model.name,
                        modelUrl: fileUrl,
                        thumbnailUrl: null, // Custom models don't have pre-generated thumbnails
                        isEnvironment: true,
                        isCustom: true,
                        category: "Custom",
                        animations: ["idle"],
                        addCollider: true,
                    };
                    environmentModels.push(newEnvironmentModel);
                }
            }

            let savedColliderSettings: any = null;
            try {
                savedColliderSettings = await DatabaseManager.getData(
                    STORES.ENVIRONMENT_MODEL_SETTINGS,
                    "colliderSettings"
                );
            } catch (e) {
                // Fallback for older databases where the dedicated store does not exist yet
                try {
                    savedColliderSettings = await DatabaseManager.getData(
                        STORES.SETTINGS,
                        "colliderSettings"
                    );
                } catch {/* ignore */ }
            }
            if (savedColliderSettings && typeof savedColliderSettings === "object") {
                environmentModels.forEach((model) => {
                    const idKey = String(model.id);
                    if (Object.prototype.hasOwnProperty.call(savedColliderSettings, idKey)) {
                        model.addCollider = !!savedColliderSettings[idKey];
                    }
                });
            }

            // OPTIMIZATION: Don't preload all models - load them lazily when needed
            // This eliminates the 5-30 second loading bottleneck
            // Models will be loaded on-demand when:
            // 1. User selects a model for placement
            // 2. Camera approaches existing instances that need rendering
            // 3. Environment objects need to be refreshed from DB

            // Only refresh environment from DB (this will trigger lazy loading for existing instances)
            await refreshEnvironmentFromDB();
        } catch (error) {
            // Error loading custom models from DB
        }
    };
    const setupInstancedMesh = (modelType, gltf) => {
        if (!gltf || !gltf.scene) {
            return;
        }

        // Use precise = true to match SDK client's bounding box calculation
        // The SDK client uses Box3().setFromObject(model, true) for visual centering
        const bbox = new THREE.Box3().setFromObject(gltf.scene, true);
        const size = bbox.getSize(new THREE.Vector3());
        const center = bbox.getCenter(new THREE.Vector3());
        const boundingHeight = size.y;
        const boundingWidth = size.x;
        const boundingDepth = size.z;

        const modelIndex = environmentModels.findIndex(
            (model) => model.id === modelType.id
        );
        if (modelIndex !== -1) {
            environmentModels[modelIndex] = {
                ...environmentModels[modelIndex],
                boundingBoxHeight: boundingHeight,
                boundingBoxWidth: boundingWidth,
                boundingBoxDepth: boundingDepth,
                boundingBoxCenter: center,
            };
        }

        gltf.scene.position.set(0, 0, 0);
        gltf.scene.rotation.set(0, 0, 0);
        gltf.scene.scale.set(1, 1, 1);
        gltf.scene.updateMatrixWorld(true);

        const geometriesByMaterial = new Map();
        gltf.scene.traverse((object) => {
            if (object.isMesh) {
                const worldMatrix = object.matrixWorld.clone();
                const materials = Array.isArray(object.material)
                    ? object.material
                    : [object.material];
                materials.forEach((material, materialIndex) => {
                    // Use optimized material from BlockMaterial manager
                    const hasTexture = material.map !== null;
                    const newMaterial = BlockMaterial.instance.getEnvironmentMaterial({
                        map: hasTexture ? material.map : null,
                        transparent: true,
                        alphaTest: 0.5,
                        depthWrite: true,
                        depthTest: true,
                    });

                    // Copy important properties from original material
                    if (material.color) {
                        (newMaterial as any).color = material.color.clone();
                    }

                    // Copy emissive properties for PBR materials
                    if ((material as any).emissive) {
                        (newMaterial as any).emissive = (material as any).emissive.clone();
                    }
                    if ((material as any).emissiveMap) {
                        (newMaterial as any).emissiveMap = (material as any).emissiveMap;
                    }
                    if ((material as any).emissiveIntensity !== undefined) {
                        (newMaterial as any).emissiveIntensity = (material as any).emissiveIntensity;
                    }

                    const key = newMaterial.uuid;
                    if (!geometriesByMaterial.has(key)) {
                        geometriesByMaterial.set(key, {
                            material: newMaterial,
                            geometries: [],
                        });
                    }
                    const geometry = object.geometry.clone();
                    geometry.applyMatrix4(worldMatrix);
                    if (Array.isArray(object.material)) {
                        const filteredGeometry = filterGeometryByMaterialIndex(
                            geometry,
                            materialIndex
                        );
                        if (filteredGeometry) {
                            geometriesByMaterial
                                .get(key)
                                .geometries.push(filteredGeometry);
                        }
                    } else {
                        geometriesByMaterial.get(key).geometries.push(geometry);
                    }
                });
            }
        });

        const initialCapacity = MAX_ENVIRONMENT_OBJECTS;
        const instancedMeshArray: THREE.InstancedMesh[] = [];
        for (const { material, geometries } of geometriesByMaterial.values()) {
            if (geometries.length > 0) {
                const mergedGeometry = mergeGeometries(geometries);
                const instancedMesh = new THREE.InstancedMesh(
                    mergedGeometry,
                    material,
                    initialCapacity
                );
                instancedMesh.frustumCulled = false; // Disable Three.js frustum culling - we handle our own distance culling
                instancedMesh.renderOrder = 1;
                instancedMesh.count = 0;
                mergedGeometry.computeBoundingBox();
                mergedGeometry.computeBoundingSphere();
                instancedMeshArray.push(instancedMesh);
            }
        }
        instancedMeshes.current.set(modelType.modelUrl, {
            meshes: instancedMeshArray,
            instances: new Map(),
            modelHeight: boundingHeight,
            addedToScene: false,
        });
    };

    const filterGeometryByMaterialIndex = (geometry, materialIndex) => {
        if (!geometry.groups || geometry.groups.length === 0) return geometry;
        const newGeometry = geometry.clone();
        const indices = [];
        for (let i = 0; i < geometry.index.count; i += 3) {
            const faceIndex = Math.floor(i / 3);
            const group = geometry.groups.find(
                (g) =>
                    faceIndex >= g.start / 3 &&
                    faceIndex < (g.start + g.count) / 3
            );
            if (group && group.materialIndex === materialIndex) {
                indices.push(
                    geometry.index.array[i],
                    geometry.index.array[i + 1],
                    geometry.index.array[i + 2]
                );
            }
        }
        if (indices.length === 0) return null;
        newGeometry.setIndex(indices);
        return newGeometry;
    };
    const setupPreview = async (position) => {
        if (!currentBlockType) return;
        try {
            const gltf = await loadModel(currentBlockType.modelUrl);
            if (!gltf) {
                return;
            }
            if (!instancedMeshes.current.has(currentBlockType.modelUrl)) {
                setupInstancedMesh(currentBlockType, gltf);
            }

            const previewModel = gltf.scene.clone(true);
            previewModel.traverse((child) => {
                if (child.isMesh) {
                    // Use optimized preview materials
                    if (Array.isArray(child.material)) {
                        child.material = child.material.map((originalMaterial) => {
                            const previewMaterial = BlockMaterial.instance.getPreviewMaterial({
                                map: originalMaterial.map,
                                color: originalMaterial.color,
                                opacity: 0.5,
                                transparent: true,
                                depthWrite: false,
                                depthTest: true,
                            });
                            return previewMaterial;
                        });
                    } else {
                        const previewMaterial = BlockMaterial.instance.getPreviewMaterial({
                            map: child.material.map,
                            color: child.material.color,
                            opacity: 0.5,
                            transparent: true,
                            depthWrite: false,
                            depthTest: true,
                        });
                        child.material = previewMaterial;
                    }
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            previewModel.userData.modelId = currentBlockType.id;

            const transform = getPlacementTransform();
            lastPreviewTransform.current.scale.copy(transform.scale);
            lastPreviewTransform.current.rotation.copy(transform.rotation);

            previewModel.scale.copy(lastPreviewTransform.current.scale);
            // Respect randomized rotation from placement settings
            previewModel.rotation.copy(lastPreviewTransform.current.rotation);

            if (position) {
                const offsetPosition = getVector3().copy(position).add(positionOffset.current);
                previewModel.position.copy(offsetPosition);
                releaseVector3(offsetPosition);
            }

            if (placeholderMeshRef.current) {
                removePreview();
            }
            scene.add(previewModel);
            placeholderMeshRef.current = previewModel;
        } catch (error) {
            // Error setting up preview
        }
    };
    const updateModelPreview = async (position) => {
        if (!currentBlockType || !scene) {
            return;
        }

        if (!currentBlockType.isEnvironment) {
            removePreview();
            return;
        }

        // Hide preview if SelectionTool is active and has a selected entity
        const toolManager = terrainBuilderRef?.current?.toolManagerRef?.current;
        const activeTool = toolManager?.getActiveTool?.();
        const shouldHidePreview = activeTool?.name === "selection" &&
            (activeTool?.selectedEntity || activeTool?.hoveredEntity);

        if (shouldHidePreview) {
            removePreview();
            return;
        }

        if (!placeholderMeshRef.current || placeholderMeshRef.current.userData.modelId !== currentBlockType.id) {
            await setupPreview(position);
        } else if (position) {
            const currentRotation = getEuler().copy(placeholderMeshRef.current.rotation);
            const currentScale = getVector3().copy(placeholderMeshRef.current.scale);

            const offsetPosition = getVector3().copy(position).add(positionOffset.current);
            placeholderMeshRef.current.position.copy(offsetPosition);
            placeholderMeshRef.current.scale.copy(currentScale);
            placeholderMeshRef.current.rotation.copy(currentRotation);

            // Release temporary objects
            releaseVector3(offsetPosition);
            releaseVector3(currentScale);
            releaseEuler(currentRotation);
        }
    };

    const updateEnvironmentToMatch = async (targetState) => {
        try {
            isUndoRedoOperation.current = true;

            const currentObjects = new Map();
            const targetObjects = new Map();
            const createCompositeKey = (modelUrl, instanceId) => `${modelUrl}:${instanceId}`;

            for (const [modelUrl, instancedData] of instancedMeshes.current) {
                instancedData.instances.forEach((data, instanceId) => {
                    const compositeKey = createCompositeKey(modelUrl, instanceId);
                    currentObjects.set(compositeKey, {
                        modelUrl,
                        instanceId,
                        position: data.position,
                        rotation: data.rotation,
                        scale: data.scale,
                    });
                });
            }

            targetState.forEach((obj) => {
                const modelType = environmentModels.find(
                    (model) =>
                        model.name === obj.name ||
                        model.modelUrl === obj.modelUrl
                );
                if (modelType) {
                    const eulerRotation = getEuler().set(
                        obj.rotation?.x || 0,
                        obj.rotation?.y || 0,
                        obj.rotation?.z || 0
                    );

                    const compositeKey = createCompositeKey(modelType.modelUrl, obj.instanceId);
                    targetObjects.set(compositeKey, {
                        ...obj,
                        modelUrl: modelType.modelUrl, // Use the current modelUrl from environmentModels
                        position: getVector3().set(
                            obj.position.x,
                            obj.position.y,
                            obj.position.z
                        ),
                        rotation: eulerRotation,
                        scale: getVector3().set(
                            obj.scale.x,
                            obj.scale.y,
                            obj.scale.z
                        ),
                    });
                }
            });

            // Remove objects that are no longer in the target state
            for (const [compositeKey, obj] of currentObjects) {
                if (!targetObjects.has(compositeKey)) {
                    removeInstance(obj.modelUrl, obj.instanceId);
                }
            }

            // Add new objects from the target state
            for (const [compositeKey, obj] of targetObjects) {
                if (!currentObjects.has(compositeKey)) {
                    const modelType = environmentModels.find(
                        (model) =>
                            model.modelUrl === obj.modelUrl ||
                            model.name === obj.name
                    );
                    if (modelType) {
                        // Ensure model is loaded before placing
                        const loaded = await ensureModelLoaded(modelType);
                        if (loaded) {
                            const tempMesh = new THREE.Object3D();
                            tempMesh.position.copy(obj.position);
                            tempMesh.rotation.copy(obj.rotation);
                            tempMesh.scale.copy(obj.scale);
                            placeEnvironmentModelWithoutSaving(
                                modelType,
                                tempMesh,
                                obj.instanceId
                            );
                        }
                    }
                }
            }

            setTotalEnvironmentObjects(targetObjects.size);

            // Rebuild all visible instances after updating environment
            rebuildAllVisibleInstances(cameraPosition);
        } catch (error) {
            // Error updating environment
        } finally {
            isUndoRedoOperation.current = false;
        }
    };

    const getModelType = (modelName, modelUrl) => {
        return environmentModels.find(
            (model) =>
                model.name === modelName ||
                model.modelUrl === modelUrl
        );
    };

    const placeEnvironmentModelWithoutSaving = (
        modelType,
        mesh,
        savedInstanceId = null
    ) => {
        if (!modelType || !mesh) {
            return null;
        }
        const modelData = environmentModels.find(
            (model) => model.id === modelType.id
        );
        if (!modelData) {
            return null;
        }
        const modelUrl = modelData.modelUrl;
        const instancedData = instancedMeshes.current.get(modelUrl);
        if (!instancedData) {
            return null;
        }

        if (!instancedData.meshes || instancedData.meshes.length === 0) {
            return null;
        }

        mesh.updateWorldMatrix(true, true);
        const position = getVector3().copy(mesh.position);
        const rotation = getEuler().copy(mesh.rotation);
        const scale = getVector3().copy(mesh.scale);
        const matrix = getMatrix4();
        const quaternion = getQuaternion();
        quaternion.setFromEuler(rotation);
        matrix.compose(position, quaternion, scale);

        let instanceId;
        if (savedInstanceId !== null) {
            instanceId = savedInstanceId;
        } else {
            instanceId = instancedData.instances.size;

            while (instancedData.instances.has(instanceId)) {
                instanceId++;
            }
        }

        const validMeshes = instancedData.meshes.filter(
            (mesh) => mesh !== undefined && mesh !== null
        );
        // Check capacity but don't set matrices directly
        const currentCapacity = validMeshes[0]?.instanceMatrix.count || 0;
        if (instanceId >= currentCapacity - 1) {
            alert(
                "Maximum Environment Objects Exceeded! Please clear the environment and try again."
            );
            return null;
        }
        const instanceCountBefore = instancedData.instances.size;
        instancedData.instances.set(instanceId, {
            position,
            rotation,
            scale,
            matrix,
            isVisible: true,
        });
        const instanceCountAfter = instancedData.instances.size;

        // Track this as a recently placed instance
        const instanceKey = `${modelUrl}:${instanceId}`;
        recentlyPlacedInstances.current.add(instanceKey);

        // Release the temporary quaternion since it's not stored
        releaseQuaternion(quaternion);
        const yOffsetForAdd = getModelYShift(modelUrl) + ENVIRONMENT_OBJECT_Y_OFFSET;
        terrainBuilderRef.current.updateSpatialHashForBlocks([{
            x: position.x,
            y: position.y - yOffsetForAdd,
            z: position.z,
            blockId: 1000,
        }], [], {
            force: true,
        });

        // Lazily attach InstancedMesh group to scene on first use
        ensureInstancedMeshesAdded(modelUrl);

        // Rebuild visible instances to include this new instance
        rebuildVisibleInstances(modelUrl, cameraPosition);

        // Force immediate distance culling update to ensure the new instance is properly evaluated
        if (cameraPosition) {
            forceUpdateDistanceCulling(cameraPosition);
        }

        // Clean up recently placed instance tracking after a delay
        setTimeout(() => {
            const instanceKey = `${modelUrl}:${instanceId}`;
            recentlyPlacedInstances.current.delete(instanceKey);
        }, 1000); // Clean up after 1 second

        return {
            modelUrl,
            instanceId,
            position,
            rotation,
            scale,
        };
    };

    const clearEnvironments = (shouldSave = true) => {
        for (const [modelUrl, instancedData] of instancedMeshes.current) {
            const instanceCount = instancedData.instances.size;
            if (instanceCount > 0) {
            }
            // Release all pooled objects before clearing
            instancedData.instances.forEach((data) => {
                releaseVector3(data.position);
                releaseEuler(data.rotation);
                releaseVector3(data.scale);
                releaseMatrix4(data.matrix);
            });

            instancedData.instances.clear();
            instancedData.meshes.forEach((mesh) => {
                mesh.count = 0;
                mesh.instanceMatrix.needsUpdate = true;
            });
        }
        // Only save if explicitly requested (default true for backward compatibility)
        // Don't save when clearing due to empty DB during refresh - this prevents
        // overwriting a pending save that might be in progress
        if (shouldSave) {
            updateLocalStorage();
        }
    };
    const getRandomValue = (min, max) => {
        return Math.random() * (max - min) + min;
    };

    const getPlacementTransform = () => {
        const settings = placementSettingsRef.current;
        if (!settings) {
            return {
                scale: getVector3().set(1, 1, 1),
                rotation: getEuler().set(0, 0, 0),
            };
        }
        const scaleValue = settings.randomScale
            ? getRandomValue(settings.minScale, settings.maxScale)
            : settings.scale;
        // Base rotation in degrees from settings; R-key adds 90° steps on top elsewhere
        const rotationDegrees = settings.randomRotation
            ? getRandomValue(settings.minRotation, settings.maxRotation)
            : settings.rotation;

        return {
            scale: getVector3().set(scaleValue, scaleValue, scaleValue),
            rotation: getEuler().set(0, (rotationDegrees * Math.PI) / 180, 0),
        };
    };

    const findCollidingInstances = (position, tolerance = 0.5, options: { verticalSnap?: boolean } = {}) => {
        const { verticalSnap = true } = options;
        const collidingInstances = [];

        for (const [modelUrl, instancedData] of instancedMeshes.current.entries()) {
            const instances = Array.from(instancedData.instances.entries())
                .map(([instanceId, data]) => ({
                    instanceId,
                    modelUrl,
                    position: data.position,
                    rotation: data.rotation,
                    scale: data.scale,
                    matrix: data.matrix,
                }));

            // First, try exact position matching with original tolerance
            const exactMatches = instances.filter(instance => {
                return (
                    Math.abs(instance.position.x - position.x) < tolerance &&
                    Math.abs(instance.position.y - position.y) < tolerance &&
                    Math.abs(instance.position.z - position.z) < tolerance
                );
            });

            if (exactMatches.length > 0) {
                collidingInstances.push(...exactMatches);
            } else if (verticalSnap) {
                // If no exact matches and vertical snapping is enabled (used for removals),
                // look for closest vertical match within a small horizontal tolerance
                const verticalCandidates = instances.filter(instance => {
                    const horizontalDistance = Math.sqrt(
                        Math.pow(instance.position.x - position.x, 2) +
                        Math.pow(instance.position.z - position.z, 2)
                    );
                    const verticalDistance = Math.abs(instance.position.y - position.y);

                    return horizontalDistance < tolerance && verticalDistance <= 4.0;
                });

                if (verticalCandidates.length > 0) {
                    // Find the closest one vertically
                    const closest = verticalCandidates.reduce((closest, candidate) => {
                        const closestVerticalDist = Math.abs(closest.position.y - position.y);
                        const candidateVerticalDist = Math.abs(candidate.position.y - position.y);
                        return candidateVerticalDist < closestVerticalDist ? candidate : closest;
                    });

                    collidingInstances.push(closest);
                }
            }
        }

        return collidingInstances;
    };

    const placeEnvironmentModel = async (mode = "add", saveUndo = true) => {
        if (!scene || !placeholderMeshRef.current) return;

        if (mode === "add" && !currentBlockType) return;

        if (mode === "remove") {
            const placementPositions = getPlacementPositions(
                placeholderMeshRef.current.position,
                placementSizeRef.current
            );
            const removedObjects = [];

            placementPositions.forEach((placementPosition) => {
                const collidingInstances = findCollidingInstances(placementPosition);

                collidingInstances.forEach((instance) => {
                    const instancedData = instancedMeshes.current.get(instance.modelUrl);
                    if (!instancedData || !instancedData.instances.has(instance.instanceId)) {
                        return;
                    }
                    const objectData = instancedData.instances.get(instance.instanceId);

                    const removedObject = {
                        modelUrl: instance.modelUrl,
                        instanceId: instance.instanceId,
                        position: {
                            x: objectData.position.x,
                            y: objectData.position.y,
                            z: objectData.position.z,
                        },
                        rotation: {
                            x: objectData.rotation.x,
                            y: objectData.rotation.y,
                            z: objectData.rotation.z,
                        },
                        scale: {
                            x: objectData.scale.x,
                            y: objectData.scale.y,
                            z: objectData.scale.z,
                        },
                    };

                    instancedData.instances.delete(instance.instanceId);

                    // Don't set matrices directly - rebuild visible instances instead
                    rebuildVisibleInstances(instance.modelUrl, cameraPosition);

                    removedObjects.push(removedObject);
                    const yOffsetRemove = getModelYShift(removedObject.modelUrl) + ENVIRONMENT_OBJECT_Y_OFFSET;
                    terrainBuilderRef.current.updateSpatialHashForBlocks([], [{
                        x: removedObject.position.x,
                        y: removedObject.position.y - yOffsetRemove,
                        z: removedObject.position.z,
                        blockId: 1000,
                    }], {
                        force: true,
                    });
                });
            });

            if (removedObjects.length > 0) {
                setTotalEnvironmentObjects(prev => prev - removedObjects.length);


                if (!isUndoRedoOperation.current && saveUndo) {
                    const changes = {
                        terrain: { added: {}, removed: {} },
                        environment: { added: [], removed: removedObjects },
                    };
                    if (undoRedoManager?.current?.saveUndo) {
                        undoRedoManager.current.saveUndo(changes);
                    }
                }

                return removedObjects;
            }
            return [];
        }

        const modelData = environmentModels.find(
            (model) => model.id === currentBlockType.id
        );
        if (!modelData) {
            return [];
        }

        // Ensure model is loaded before placing
        const modelLoaded = await ensureModelLoaded(modelData);
        if (!modelLoaded) {
            return [];
        }

        const modelUrl = modelData.modelUrl;
        let instancedData = instancedMeshes.current.get(modelUrl);
        if (!instancedData) {
            return [];
        }

        // Ensure instanced meshes are attached to the scene now that we'll place objects
        ensureInstancedMeshesAdded(modelUrl);

        const placementPositions = getPlacementPositions(
            placeholderMeshRef.current.position,
            placementSizeRef.current
        );
        const addedObjects = [];


        const validPlacementPositions = placementPositions.filter(placementPosition =>
            // For placement, disable vertical snap so stacking above/below is allowed
            findCollidingInstances(placementPosition, 0.5, { verticalSnap: false }).length === 0
        );

        if (validPlacementPositions.length === 0) {
            return [];
        }

        const currentTotalObjects = Array.from(instancedMeshes.current.values()).reduce((sum, data) => sum + data.instances.size, 0);
        if (currentTotalObjects + validPlacementPositions.length > MAX_ENVIRONMENT_OBJECTS) {
            alert(
                `Placing these objects would exceed the maximum limit of ${MAX_ENVIRONMENT_OBJECTS}. Current: ${currentTotalObjects}, Trying to add: ${validPlacementPositions.length}`
            );
            return [];
        }

        validPlacementPositions.forEach((placementPosition) => {
            let instanceId = 0;
            const existingIds = new Set(Array.from(instancedData.instances.keys()) as number[]);
            while (existingIds.has(instanceId)) {
                instanceId++;
            }

            const transform = getPlacementTransform();
            const position = getVector3().set(
                placementPosition.x,
                placementPosition.y,
                placementPosition.z
            );
            const matrix = getMatrix4();
            const quaternion = getQuaternion();
            // Use rotation computed from placement settings (supports randomRotation)
            const rotationWithOffset = getEuler().copy(transform.rotation);
            quaternion.setFromEuler(rotationWithOffset);
            matrix.compose(position, quaternion, transform.scale);

            let placementSuccessful = true;
            // Check capacity
            const capacity = instancedData.meshes[0]?.instanceMatrix.count || 0;
            if (instanceId >= capacity) {
                alert(`Maximum instances reached for model type ${modelData.name}.`);
                placementSuccessful = false;
            }

            if (placementSuccessful) {
                instancedData.instances.set(instanceId, {
                    position: getVector3().copy(position),
                    rotation: getEuler().copy(rotationWithOffset),
                    scale: getVector3().copy(transform.scale),
                    matrix: getMatrix4().copy(matrix),
                    isVisible: true,
                });

                // Track this as a recently placed instance
                const instanceKey = `${modelUrl}:${instanceId}`;
                recentlyPlacedInstances.current.add(instanceKey);


                const newObject = {
                    modelUrl,
                    instanceId,
                    position: { x: position.x, y: position.y, z: position.z },
                    rotation: {
                        x: rotationWithOffset.x,
                        y: rotationWithOffset.y,
                        z: rotationWithOffset.z,
                    },
                    scale: {
                        x: transform.scale.x,
                        y: transform.scale.y,
                        z: transform.scale.z,
                    },
                };
                const yOffsetForAdd = getModelYShift(modelUrl) + ENVIRONMENT_OBJECT_Y_OFFSET;
                terrainBuilderRef.current.updateSpatialHashForBlocks([{
                    x: newObject.position.x,
                    y: newObject.position.y - yOffsetForAdd,
                    z: newObject.position.z,
                    blockId: 1000,
                }], [], {
                    force: true,
                });
                addedObjects.push(newObject);

                // Release temporary objects after they're copied
                releaseQuaternion(quaternion);
                releaseVector3(position);
                releaseMatrix4(matrix);
                releaseVector3(transform.scale);
                releaseEuler(transform.rotation);
                releaseEuler(rotationWithOffset);
            } else {
                // Release temporary objects if placement failed
                releaseQuaternion(quaternion);
                releaseVector3(position);
                releaseMatrix4(matrix);
                releaseVector3(transform.scale);
                releaseEuler(transform.rotation);
                releaseEuler(rotationWithOffset);
            }
        });

        // Rebuild visible instances if any objects were added
        if (addedObjects.length > 0) {
            rebuildVisibleInstances(modelUrl, cameraPosition);

            // Force immediate distance culling update for all models to ensure new instances are properly evaluated
            if (cameraPosition) {
                forceUpdateDistanceCulling(cameraPosition);
            }

            // Clean up recently placed instances tracking after a delay
            setTimeout(() => {
                addedObjects.forEach(obj => {
                    const instanceKey = `${obj.modelUrl}:${obj.instanceId}`;
                    recentlyPlacedInstances.current.delete(instanceKey);
                });
            }, 1000); // Clean up after 1 second
        }

        if (addedObjects.length > 0) {
            if (!isUndoRedoOperation.current && saveUndo) {
                const changes = {
                    terrain: { added: {}, removed: {} },
                    environment: { added: addedObjects, removed: [] },
                };
                if (undoRedoManager?.current?.saveUndo) {
                    undoRedoManager.current.saveUndo(changes);
                }
            }

            setTotalEnvironmentObjects((prev) => prev + addedObjects.length);

            if (
                placementSettingsRef.current?.randomScale ||
                placementSettingsRef.current?.randomRotation
            ) {
                const nextTransform = getPlacementTransform();
                lastPreviewTransform.current = nextTransform;

                if (placeholderMeshRef.current) {
                    placeholderMeshRef.current.scale.copy(nextTransform.scale);
                    placeholderMeshRef.current.rotation.copy(nextTransform.rotation);
                }
            }
        }

        return addedObjects;
    };

    const updateLocalStorage = () => {
        const allObjects = [];
        let totalInstancesCount = 0;

        for (const [modelUrl, instancedData] of instancedMeshes.current) {
            const modelData = environmentModels.find(
                (model) => model.modelUrl === modelUrl
            );
            const instanceCount = instancedData.instances.size;
            totalInstancesCount += instanceCount;

            instancedData.instances.forEach((data, instanceId) => {

                const serializablePosition = {
                    x: data.position.x,
                    y: data.position.y,
                    z: data.position.z,
                };


                const serializableRotation = {
                    x: Number(data.rotation.x.toFixed(5)),
                    y: Number(data.rotation.y.toFixed(5)),
                    z: Number(data.rotation.z.toFixed(5)),
                    _isEuler: true, // Add a flag to indicate this is an Euler angle
                };

                const serializableScale = {
                    x: data.scale.x,
                    y: data.scale.y,
                    z: data.scale.z,
                };

                allObjects.push({
                    modelUrl,
                    name: modelData?.name, // Add model name to saved data
                    instanceId,
                    position: serializablePosition,
                    rotation: serializableRotation,
                    scale: serializableScale,
                });
            });
        }

        const savePromise = DatabaseManager.saveData(STORES.ENVIRONMENT, "current", allObjects);

        savePromise.then(() => {
            // Database save completed
        }).catch((err) => {
            // Database save failed
        });

        setTotalEnvironmentObjects(allObjects.length);
    };

    const getPlacementPositions = (centerPos, placementSize) => {
        const positions = [];

        positions.push({ ...centerPos });
        switch (placementSize) {
            default:
            case "single":
                break;
            case "cross":
                positions.push(
                    { x: centerPos.x + 1, y: centerPos.y, z: centerPos.z },
                    { x: centerPos.x - 1, y: centerPos.y, z: centerPos.z },
                    { x: centerPos.x, y: centerPos.y, z: centerPos.z + 1 },
                    { x: centerPos.x, y: centerPos.y, z: centerPos.z - 1 }
                );
                break;
            case "diamond":
                positions.push(
                    { x: centerPos.x + 1, y: centerPos.y, z: centerPos.z },
                    { x: centerPos.x - 1, y: centerPos.y, z: centerPos.z },
                    { x: centerPos.x, y: centerPos.y, z: centerPos.z + 1 },
                    { x: centerPos.x, y: centerPos.y, z: centerPos.z - 1 },

                    { x: centerPos.x + 1, y: centerPos.y, z: centerPos.z + 1 },
                    { x: centerPos.x + 1, y: centerPos.y, z: centerPos.z - 1 },
                    { x: centerPos.x - 1, y: centerPos.y, z: centerPos.z + 1 },
                    { x: centerPos.x - 1, y: centerPos.y, z: centerPos.z - 1 },

                    { x: centerPos.x + 2, y: centerPos.y, z: centerPos.z },
                    { x: centerPos.x - 2, y: centerPos.y, z: centerPos.z },
                    { x: centerPos.x, y: centerPos.y, z: centerPos.z + 2 },
                    { x: centerPos.x, y: centerPos.y, z: centerPos.z - 2 }
                );
                break;
            case "square9":
                for (let x = -1; x <= 1; x++) {
                    for (let z = -1; z <= 1; z++) {
                        if (x !== 0 || z !== 0) {
                            positions.push({
                                x: centerPos.x + x,
                                y: centerPos.y,
                                z: centerPos.z + z,
                            });
                        }
                    }
                }
                break;
            case "square16":
                for (let x = -2; x <= 1; x++) {
                    for (let z = -2; z <= 1; z++) {
                        if (x !== 0 || z !== 0) {
                            positions.push({
                                x: centerPos.x + x,
                                y: centerPos.y,
                                z: centerPos.z + z,
                            });
                        }
                    }
                }
                break;
        }
        return positions;
    };

    const removeInstance = (modelUrl, instanceId, updateUndoRedo = true) => {
        const instancedData = instancedMeshes.current.get(modelUrl);
        const instanceCountBefore = instancedData?.instances.size || 0;
        if (!instancedData || !instancedData.instances.has(instanceId)) {
            return;
        }

        const objectData = instancedData.instances.get(instanceId);

        // Create removal object before deleting instance
        const removedObject = {
            modelUrl,
            instanceId, // Include the instanceId in removed object
            position: {
                x: objectData.position.x,
                y: objectData.position.y,
                z: objectData.position.z,
            },
            rotation: {
                x: objectData.rotation.x,
                y: objectData.rotation.y,
                z: objectData.rotation.z,
            },
            scale: {
                x: objectData.scale.x,
                y: objectData.scale.y,
                z: objectData.scale.z,
            },
        };

        // Release pooled objects back to the pool
        releaseVector3(objectData.position);
        releaseEuler(objectData.rotation);
        releaseVector3(objectData.scale);
        releaseMatrix4(objectData.matrix);

        instancedData.instances.delete(instanceId);

        // Rebuild visible instances to exclude this removed instance
        rebuildVisibleInstances(modelUrl, cameraPosition);

        if (updateUndoRedo) {
            const changes = {
                terrain: { added: {}, removed: {} },
                environment: { added: [], removed: [removedObject] },
            };
            if (undoRedoManager?.current?.saveUndo) {
                undoRedoManager.current.saveUndo(changes);
            }
        }
        const yOffsetRemove = getModelYShift(removedObject.modelUrl) + ENVIRONMENT_OBJECT_Y_OFFSET;
        terrainBuilderRef.current.updateSpatialHashForBlocks([], [{
            x: removedObject.position.x,
            y: removedObject.position.y - yOffsetRemove,
            z: removedObject.position.z,
            blockId: 1000,
        }], { force: true });
    };
    const refreshEnvironment = async () => {
        const savedEnv = getAllEnvironmentObjects();
        await updateEnvironmentToMatch(savedEnv);
    };

    const refreshEnvironmentFromDB = async () => {
        try {
            const savedEnv = await DatabaseManager.getData(
                STORES.ENVIRONMENT,
                "current"
            );

            if (savedEnv && Object.keys(savedEnv).length > 0) {
                const envArray = Array.isArray(savedEnv) ? savedEnv : Object.values(savedEnv);

                // Lazy load models for all unique model URLs in saved environment
                const uniqueModelUrls = new Set<string>();
                envArray.forEach((obj: any) => {
                    if (obj.modelUrl) {
                        uniqueModelUrls.add(obj.modelUrl);
                    } else if (obj.name) {
                        // Find model by name
                        const model = environmentModels.find(m => m.name === obj.name);
                        if (model) {
                            uniqueModelUrls.add(model.modelUrl);
                        }
                    }
                });

                // Load all required models in parallel
                const loadPromises = Array.from(uniqueModelUrls).map(async (modelUrl) => {
                    const model = environmentModels.find(m => m.modelUrl === modelUrl);
                    if (model) {
                        const loaded = await ensureModelLoaded(model);
                        return loaded;
                    }
                    return false;
                });
                await Promise.all(loadPromises);

                await updateEnvironmentToMatch(envArray);

                // Rebuild all visible instances after loading from database
                rebuildAllVisibleInstances(cameraPosition);
            } else {
                const instancesInMemory = Array.from(instancedMeshes.current.values()).reduce((sum, data) => sum + data.instances.size, 0);
                if (instancesInMemory === 0) {
                    // Don't save when clearing due to empty DB - the DB is already empty,
                    // and saving here could overwrite a pending save that's in progress
                    clearEnvironments(false);
                }
            }
        } catch (error) {
            // Error refreshing environment
        }
    };
    const updatePreviewPosition = (position) => {
        if (placeholderMeshRef.current && position) {
            const offsetPosition = getVector3().copy(position).add(positionOffset.current);
            placeholderMeshRef.current.position.copy(offsetPosition);
            releaseVector3(offsetPosition);
        }
    };
    const removePreview = () => {
        if (placeholderMeshRef.current) {
            scene.remove(placeholderMeshRef.current);

            placeholderMeshRef.current.traverse((child) => {
                if (child.isMesh) {
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach((material) =>
                                material.dispose()
                            );
                        } else {
                            child.material.dispose();
                        }
                    }

                    if (child.geometry) {
                        child.geometry.dispose();
                    }
                }
            });

            placeholderMeshRef.current = null;
        }
    };

    useEffect(() => {
        onTotalObjectsChange?.(totalEnvironmentObjects);
    }, [totalEnvironmentObjects, onTotalObjectsChange]);

    useEffect(() => {
        if (!scene) return;
        if (!projectId) return;
        preloadModels().catch((error) => {
            // Error loading models
        });
    }, [scene, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Reload environment whenever projectId changes (after models have been preloaded once)
    const refreshInProgressRef = useRef(false);
    const lastLoadedProjectIdRef = useRef<string | null>(null);
    const lastLoadedSceneRef = useRef<THREE.Scene | null>(null);
    const lastLoadedSceneUUIDRef = useRef<string | null>(null);

    // Reset addedToScene flags when scene UUID changes (scene recreated)
    useEffect(() => {
        if (scene && lastLoadedSceneUUIDRef.current && lastLoadedSceneUUIDRef.current !== scene.uuid) {
            // Reset addedToScene flags so meshes get re-added to new scene
            // IMPORTANT: Do NOT clear instances - they should persist across scene changes
            for (const [modelUrl, instancedData] of instancedMeshes.current) {
                instancedData.addedToScene = false;
            }
        }
        if (scene) {
            lastLoadedSceneUUIDRef.current = scene.uuid;
        }
    }, [scene]);

    useEffect(() => {
        if (!projectId) return;
        // If scene is ready and models likely loaded, refresh entities for this project
        if (scene && typeof refreshEnvironmentFromDB === 'function') {
            // Prevent multiple simultaneous calls FIRST (before checking projectId/scene)
            if (refreshInProgressRef.current) {
                return;
            }
            // Prevent multiple calls for the same projectId AND scene UUID
            // Scene object reference can change even with same UUID, so check UUID instead
            if (lastLoadedProjectIdRef.current === projectId && lastLoadedSceneUUIDRef.current === scene.uuid) {
                return;
            }
            refreshInProgressRef.current = true;
            lastLoadedProjectIdRef.current = projectId;
            lastLoadedSceneRef.current = scene;
            lastLoadedSceneUUIDRef.current = scene.uuid;
            refreshEnvironmentFromDB().finally(() => {
                refreshInProgressRef.current = false;
            });
        }
    }, [projectId, scene]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (currentBlockType?.isEnvironment) {
            setupPreview(previewPositionFromAppJS);
        } else if (placeholderMeshRef.current) {
            removePreview();
        }
    }, [currentBlockType]);

    useEffect(() => {
        if (previewPositionFromAppJS && currentBlockType?.isEnvironment) {
            updateModelPreview(previewPositionFromAppJS);
        }
    }, [previewPositionFromAppJS, currentBlockType]);

    // Listen for entity selection/hover changes to hide preview
    useEffect(() => {
        const handleEntityStateChange = () => {
            if (currentBlockType?.isEnvironment && previewPositionFromAppJS) {
                updateModelPreview(previewPositionFromAppJS);
            }
        };

        window.addEventListener("entity-selected", handleEntityStateChange);
        window.addEventListener("entity-deselected", handleEntityStateChange);
        window.addEventListener("entity-hover-changed", handleEntityStateChange);

        return () => {
            window.removeEventListener("entity-selected", handleEntityStateChange);
            window.removeEventListener("entity-deselected", handleEntityStateChange);
            window.removeEventListener("entity-hover-changed", handleEntityStateChange);
        };
    }, [currentBlockType, previewPositionFromAppJS]);

    useEffect(() => {
        placementSettingsRef.current = placementSettings;
        if (placeholderMeshRef.current && currentBlockType?.isEnvironment) {
            const transform = getPlacementTransform();

            placeholderMeshRef.current.scale.copy(transform.scale);
            // Apply rotation directly from transform to honor randomRotation
            placeholderMeshRef.current.rotation.copy(transform.rotation);
        }
    }, [placementSettings]);

    useEffect(() => {
        placementSizeRef.current = placementSize;

        if (placeholderMeshRef.current && currentBlockType?.isEnvironment) {
            updateModelPreview(
                placeholderMeshRef.current.position
                    .clone()
                    .sub(positionOffset.current)
            );
        }
    }, [placementSize]);

    useEffect(() => {
        if (currentBlockType?.isEnvironment) {
            const shift = currentBlockType?.yShift || 0;
            positionOffset.current.set(0, ENVIRONMENT_OBJECT_Y_OFFSET + shift, 0);
        }
    }, [currentBlockType?.id, currentBlockType?.yShift]);

    // Reset manual rotation when switching models
    useEffect(() => {
        manualRotationStepsRef.current = 0;
    }, [currentBlockType?.id]);

    useEffect(() => {
        if (cameraPosition) {
            throttledUpdateDistanceCulling(cameraPosition);
        }
    }, [cameraPosition]);

    // Keyboard handler for rotating environment preview (R key)
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // Ignore when typing in inputs or contenteditable
            const target = event.target as HTMLElement | null;
            if (target) {
                const tag = target.tagName?.toLowerCase();
                const isTyping = tag === 'input' || tag === 'textarea' || (target as any).isContentEditable;
                if (isTyping) return;
            }

            if (!currentBlockType?.isEnvironment) return;
            if (!placeholderMeshRef.current) return;

            if (event.key && event.key.toLowerCase() === 'r') {
                const baseSettings = placementSettingsRef.current || ({} as any);
                const baseRotation = baseSettings.rotation || 0;
                const newRotation = (baseRotation + 90) % 360;
                // Propagate to UI so ModelOptions reflects the change
                if (typeof onPlacementSettingsChange === 'function') {
                    onPlacementSettingsChange({ ...baseSettings, rotation: newRotation });
                }
                // Reset manual steps to avoid double counting
                manualRotationStepsRef.current = 0;
                // Update preview orientation immediately
                try {
                    // Only yaw changes
                    const radians = (newRotation * Math.PI) / 180;
                    placeholderMeshRef.current.rotation.y = radians;
                    placeholderMeshRef.current.updateMatrixWorld(true);
                } catch (_) { }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [currentBlockType?.isEnvironment, placeholderMeshRef.current, onPlacementSettingsChange]);

    // Debug function to monitor object pool statistics
    useEffect(() => {
        if (process.env.NODE_ENV === 'development') {
            const logPoolStats = () => {
                const stats = ObjectPoolManager.getInstance().getAllStats();
                console.log('Object Pool Statistics:', stats);
            };

            // Add global debug function
            (window as any).debugObjectPools = logPoolStats;

            return () => {
                delete (window as any).debugObjectPools;
            };
        }
    }, []);

    const beginUndoRedoOperation = () => {
        isUndoRedoOperation.current = true;
    };
    const endUndoRedoOperation = () => {
        isUndoRedoOperation.current = false;
    };

    const getAllAvailableModels = () => {
        // Return all models (default + custom) in a format suitable for AI
        return environmentModels.map((model) => ({
            name: model.name,
            displayName: model.name
                .split("-")
                .map(part => part.charAt(0).toUpperCase() + part.slice(1))
                .join(" "),
            modelUrl: model.modelUrl,
            isCustom: model.isCustom || false,
        }));
    };
    useImperativeHandle(
        ref,
        () => ({
            updateModelPreview,
            removePreview,
            placeEnvironmentModel,
            placeEnvironmentModelWithoutSaving,
            preloadModels,
            clearEnvironments,
            removeInstance,
            updatePreviewPosition,
            updateEnvironmentToMatch,
            loadModel,
            ensureModelLoaded,
            refreshEnvironmentFromDB,
            refreshEnvironment,
            beginUndoRedoOperation,
            endUndoRedoOperation,
            updateLocalStorage,
            getAllEnvironmentObjects,
            getAllEnvironmentPositionsAsObject,
            updateEnvironmentForUndoRedo,
            getModelType,
            hasInstanceAtPosition,
            forceRebuildSpatialHash,
            getAllAvailableModels,
            updateDistanceCulling,
            throttledUpdateDistanceCulling,
            forceUpdateDistanceCulling,
            rebuildVisibleInstances,
            rebuildAllVisibleInstances,
            setModelYShift: (modelId, newShift) => {
                const model = environmentModels.find((m) => m.id === modelId);
                if (model) {
                    model.yShift = newShift;
                }
                if (currentBlockType && currentBlockType.id === modelId) {
                    positionOffset.current.set(0, ENVIRONMENT_OBJECT_Y_OFFSET + newShift, 0);
                    if (placeholderMeshRef.current) {
                        const basePos = getVector3().copy(placeholderMeshRef.current.position).sub(positionOffset.current);
                        placeholderMeshRef.current.position.copy(basePos.add(positionOffset.current));
                        releaseVector3(basePos);
                    }
                }
            },
            getObjectPoolStats: () => ObjectPoolManager.getInstance().getAllStats(),
            updateEntityInstance: (
                modelUrl: string,
                instanceId: number,
                position: THREE.Vector3,
                rotation: THREE.Euler,
                scale: THREE.Vector3,
                cameraPos?: THREE.Vector3
            ) => {
                const instancedData = instancedMeshes.current.get(modelUrl);
                if (!instancedData || !instancedData.instances.has(instanceId)) {
                    console.warn(`[EnvironmentBuilder] Cannot update entity: ${modelUrl}:${instanceId} not found`);
                    return { success: false, oldPosition: null };
                }

                const instanceData = instancedData.instances.get(instanceId);
                if (!instanceData) return { success: false, oldPosition: null };

                // Store old position for spatial grid update
                const oldPosition = instanceData.position.clone();

                // Update position, rotation, scale
                instanceData.position.copy(position);
                instanceData.rotation.copy(rotation);
                instanceData.scale.copy(scale);

                // Recompute matrix
                const quaternion = getQuaternion().setFromEuler(rotation);
                instanceData.matrix.compose(position, quaternion, scale);
                releaseQuaternion(quaternion);

                // Force instance to be visible during manipulation
                instanceData.isVisible = true;

                // Directly update the matrix in all instanced meshes for this model
                // This ensures immediate visual update without waiting for rebuildVisibleInstances
                if (instancedData.meshes && instancedData.meshes.length > 0) {
                    console.log(`[EnvironmentBuilder] Updating instance ${instanceId} matrix directly`, {
                        position: position.toArray(),
                        instanceId,
                        meshCount: instancedData.meshes.length
                    });

                    instancedData.meshes.forEach((mesh, meshIndex) => {
                        if (mesh && instanceId < mesh.count) {
                            // Update the matrix directly - this should immediately update the visual position
                            mesh.setMatrixAt(instanceId, instanceData.matrix);
                            console.log(`[EnvironmentBuilder] Updated mesh ${meshIndex} instance ${instanceId} matrix`);
                        } else {
                            console.warn(`[EnvironmentBuilder] Cannot update mesh ${meshIndex}: instanceId ${instanceId} >= mesh.count ${mesh?.count}`);
                        }
                    });

                    // Mark instance matrix as needing update - this is critical for Three.js to upload changes
                    instancedData.meshes.forEach((mesh, meshIndex) => {
                        if (mesh) {
                            mesh.instanceMatrix.needsUpdate = true;
                            // Force bounding sphere recomputation to ensure proper rendering
                            mesh.computeBoundingSphere();
                            console.log(`[EnvironmentBuilder] Marked mesh ${meshIndex} instanceMatrix.needsUpdate = true`);
                        }
                    });

                    // Rebuild visible instances to ensure old render is cleared and new position is properly rendered
                    // This is necessary to prevent ghost renders at the old position
                    if (cameraPos) {
                        rebuildVisibleInstances(modelUrl, cameraPos);
                    }
                } else {
                    console.warn(`[EnvironmentBuilder] No meshes found for model ${modelUrl}`);
                }

                // Return old position so caller can update spatial grid
                return { success: true, oldPosition };
            },
            updateEntitySpatialGrid: (
                modelUrl: string,
                oldPosition: THREE.Vector3,
                newPosition: THREE.Vector3
            ) => {
                if (!terrainBuilderRef.current) {
                    console.warn(`[EnvironmentBuilder] Cannot update spatial grid: terrainBuilderRef not available`);
                    return;
                }

                const yOffset = getModelYShift(modelUrl) + ENVIRONMENT_OBJECT_Y_OFFSET;

                // Round coordinates to ensure exact matching with spatial grid
                // The spatial grid uses integer coordinates, so we need to match exactly
                const oldX = Math.round(oldPosition.x);
                const oldY = Math.round(oldPosition.y - yOffset);
                const oldZ = Math.round(oldPosition.z);

                const newX = Math.round(newPosition.x);
                const newY = Math.round(newPosition.y - yOffset);
                const newZ = Math.round(newPosition.z);

                console.log(`[EnvironmentBuilder] Updating spatial grid for moved entity`, {
                    modelUrl,
                    oldPosition: { x: oldX, y: oldY, z: oldZ, raw: oldPosition.toArray() },
                    newPosition: { x: newX, y: newY, z: newZ, raw: newPosition.toArray() },
                    yOffset,
                });

                // Remove old position from spatial grid
                terrainBuilderRef.current.updateSpatialHashForBlocks([], [{
                    x: oldX,
                    y: oldY,
                    z: oldZ,
                    blockId: 1000,
                }], { force: true });

                // Add new position to spatial grid
                terrainBuilderRef.current.updateSpatialHashForBlocks([{
                    x: newX,
                    y: newY,
                    z: newZ,
                    blockId: 1000,
                }], [], { force: true });

                console.log(`[EnvironmentBuilder] Spatial grid updated successfully`);
            }
        }),
        [scene, currentBlockType, placeholderMeshRef.current]
    );

    return null;
};
export default forwardRef(EnvironmentBuilder);