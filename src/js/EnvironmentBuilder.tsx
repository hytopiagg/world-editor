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
import { performanceLogger } from "./utils/PerformanceLogger";
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

        // Only log if there are recently placed instances
        if (recentlyPlacedVisible > 0) {
            console.log(`[FIX] Recently placed instances protected + hybrid culling active: ${recentlyPlacedVisible} (${modelUrl.split('/').pop()})`);
        }
    };

    const rebuildAllVisibleInstances = (cameraPos?: THREE.Vector3) => {
        for (const [modelUrl, instancedData] of instancedMeshes.current.entries()) {
            if (instancedData.instances && instancedData.instances.size > 0) {
                rebuildVisibleInstances(modelUrl, cameraPos);
            }
        }
    };

    const ensureInstancedMeshesAdded = (modelUrl: string) => {
        const data = instancedMeshes.current.get(modelUrl);
        if (!scene || !data) return;
        
        // Check if meshes are actually in the current scene
        // Scene can change (new UUID), so we need to re-add meshes even if addedToScene was true
        const meshesInScene = data.meshes.every(mesh => scene.children.includes(mesh));
        
        if (!meshesInScene) {
            console.log(`[MODEL_PERSISTENCE] Meshes not in scene for ${modelUrl}, re-adding to scene`);
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
        } else if (!data.addedToScene) {
            // First time adding
            data.meshes.forEach((mesh: THREE.InstancedMesh) => {
                mesh.frustumCulled = false;
                scene.add(mesh);
            });
            data.addedToScene = true;
        }
    };



    const getAllEnvironmentObjects = () => {
        const instances = [];
        for (const [modelUrl, instancedData] of (instancedMeshes.current as Map<string, any>).entries()) {
            const name = modelUrl.split("/").pop()?.split(".")[0];
            const instanceData = [...(instancedData.instances as Map<number, any>).entries()];
            instanceData.forEach((instance) => {
                console.log("instance", instance);

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
        console.log("getAllEnvironmentPositionsAsObject - instancedMeshes.current", instancedMeshes.current);
        console.log("getAllEnvironmentPositionsAsObject - instancedMeshes.current.entries()", instancedMeshes.current.size);
        for (const x of [...instancedMeshes.current]) {
            instanceData.push(...x[1].instances);
            console.log("instanceData", instanceData);
            instanceData.forEach((instance) => {
                console.log("instance", instance);
                positions[`${instance[1]?.position?.x}-${instance[1]?.position?.y}-${instance[1]?.position?.z}`] = 1000;
            });
        }
        console.log("getAllEnvironmentPositionsAsObject - positions", positions);
        return positions;
    }

    const forceRebuildSpatialHash = () => {
        console.log("forceRebuildSpatialHash - env builder");
        const instances = getAllEnvironmentObjects();
        console.log("instances", instances);
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
        console.log("updateEnvironmentForUndoRedo", added, removed, source);
        if (removed && Object.keys(removed).length > 0) {
            Object.values(removed).forEach((instance: {
                instanceId: number;
                modelUrl: string;
                position: { x: number; y: number; z: number };
            }) => {
                console.log("removing", instance);
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
                console.log("adding", instance);
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
                } else {
                    console.log("no instanced meshes found for", instance.modelUrl);
                }
            });
        }
    };

    const loadModel = async (modelToLoadUrl) => {
        if (!modelToLoadUrl) {
            console.warn("No model URL provided");
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
            console.error("Error loading model:", fullUrl, error);
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
            console.log(`[EnvironmentBuilder] Lazy loading model: ${model.name}`);
            const gltf = await loadModel(modelUrl);
            if (gltf) {
                gltf.scene.updateMatrixWorld(true);
                await new Promise((r) => setTimeout(r, 0));
                setupInstancedMesh(model, gltf);
                return true;
            }
        } catch (error) {
            console.error(`Error lazy loading model ${model.name}:`, error);
        }
        return false;
    };

    const preloadModels = async () => {
        performanceLogger.markStart("EnvironmentBuilder.preloadModels");
        try {
            performanceLogger.markStart("Load Custom Models from DB");
            const customModels = await DatabaseManager.getData(
                STORES.CUSTOM_MODELS,
                "models"
            ) as CustomModel[];
            performanceLogger.markEnd("Load Custom Models from DB", {
                customModelCount: customModels?.length || 0
            });
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
            
            console.log(`[EnvironmentBuilder] Skipping model preload - using lazy loading instead. ${environmentModels.length} models available.`);
            
            // Only refresh environment from DB (this will trigger lazy loading for existing instances)
            performanceLogger.markStart("Refresh Environment from DB");
            await refreshEnvironmentFromDB();
            performanceLogger.markEnd("Refresh Environment from DB");
            performanceLogger.markEnd("EnvironmentBuilder.preloadModels", {
                totalModels: environmentModels.length
            });
        } catch (error) {
            console.error("Error loading custom models from DB:", error);
            performanceLogger.markEnd("EnvironmentBuilder.preloadModels");
        }
    };
    const setupInstancedMesh = (modelType, gltf) => {
        if (!gltf || !gltf.scene) {
            console.error("Invalid GLTF data for model:", modelType.name);
            return;
        }

        const bbox = new THREE.Box3().setFromObject(gltf.scene);
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
                console.error("Failed to load model for preview");
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
            console.error("Error setting up preview:", error);
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
        console.log('[MODEL_PERSISTENCE] ========== updateEnvironmentToMatch START ==========');
        console.log('[MODEL_PERSISTENCE] targetState:', targetState);
        console.log('[MODEL_PERSISTENCE] targetState type:', typeof targetState);
        console.log('[MODEL_PERSISTENCE] targetState isArray:', Array.isArray(targetState));
        console.log('[MODEL_PERSISTENCE] targetState length:', targetState?.length);
        console.log('[MODEL_PERSISTENCE] instancedMeshes.current size:', instancedMeshes.current.size);
        console.log('[MODEL_PERSISTENCE] Scene UUID:', scene?.uuid);
        console.log('[MODEL_PERSISTENCE] ProjectId:', projectId);
        
        try {
            isUndoRedoOperation.current = true;

            const currentObjects = new Map();
            const targetObjects = new Map();
            const createCompositeKey = (modelUrl, instanceId) => `${modelUrl}:${instanceId}`;

            // Log all models in instancedMeshes before processing
            console.log('[MODEL_PERSISTENCE] Models in instancedMeshes:', Array.from(instancedMeshes.current.keys()));
            const totalInstancesBefore = Array.from(instancedMeshes.current.values()).reduce((sum, data) => sum + data.instances.size, 0);
            console.log('[MODEL_PERSISTENCE] Total instances in memory BEFORE updateEnvironmentToMatch:', totalInstancesBefore);
            for (const [modelUrl, instancedData] of instancedMeshes.current) {
                const instanceIds = Array.from(instancedData.instances.keys());
                console.log(`[MODEL_PERSISTENCE] Model ${modelUrl}: ${instancedData.instances.size} instances, IDs: [${instanceIds.join(', ')}]`);
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
                } else {
                    console.warn(
                        `Could not find model for ${obj.name || obj.modelUrl}`
                    );
                }
            });


            console.log('[MODEL_PERSISTENCE] Current objects count:', currentObjects.size);
            console.log('[MODEL_PERSISTENCE] Target objects count:', targetObjects.size);
            
            // Remove objects that are no longer in the target state
            let removedCount = 0;
            for (const [compositeKey, obj] of currentObjects) {
                if (!targetObjects.has(compositeKey)) {
                    console.log('[MODEL_PERSISTENCE] Removing object:', compositeKey);
                    removeInstance(obj.modelUrl, obj.instanceId);
                    removedCount++;
                }
            }
            console.log('[MODEL_PERSISTENCE] Removed', removedCount, 'objects');

            // Add new objects from the target state
            let addedCount = 0;
            let failedCount = 0;
            for (const [compositeKey, obj] of targetObjects) {
                if (!currentObjects.has(compositeKey)) {
                    console.log('[MODEL_PERSISTENCE] Adding object:', compositeKey, obj);
                    const modelType = environmentModels.find(
                        (model) =>
                            model.modelUrl === obj.modelUrl ||
                            model.name === obj.name
                    );
                    if (modelType) {
                        console.log('[MODEL_PERSISTENCE] Found model type:', modelType.name);
                        // Ensure model is loaded before placing
                        const loaded = await ensureModelLoaded(modelType);
                        console.log('[MODEL_PERSISTENCE] Model loaded:', modelType.name, '->', loaded);
                        if (loaded) {
                            const tempMesh = new THREE.Object3D();
                            tempMesh.position.copy(obj.position);
                            tempMesh.rotation.copy(obj.rotation);
                            tempMesh.scale.copy(obj.scale);
                            const result = placeEnvironmentModelWithoutSaving(
                                modelType,
                                tempMesh,
                                obj.instanceId
                            );
                            if (result) {
                                addedCount++;
                                console.log('[MODEL_PERSISTENCE] ✓ Successfully placed:', compositeKey, 'at position:', obj.position);
                            } else {
                                failedCount++;
                                console.warn('[MODEL_PERSISTENCE] ✗ Failed to place:', compositeKey, 'model:', modelType.name);
                            }
                        } else {
                            failedCount++;
                            console.warn('[MODEL_PERSISTENCE] ✗ Model failed to load:', modelType.name);
                        }
                    } else {
                        failedCount++;
                        console.warn('[MODEL_PERSISTENCE] ✗ Model type not found for:', obj.name || obj.modelUrl, 'compositeKey:', compositeKey);
                    }
                } else {
                    console.log('[MODEL_PERSISTENCE] Object already exists:', compositeKey, 'model:', obj.name || obj.modelUrl);
                    // Check if it's actually visible - might be a rendering issue
                    const existingModelUrl = compositeKey.split(':')[0];
                    const existingInstanceId = parseInt(compositeKey.split(':')[1]);
                    const instancedData = instancedMeshes.current.get(existingModelUrl);
                    if (instancedData && instancedData.instances.has(existingInstanceId)) {
                        const instanceData = instancedData.instances.get(existingInstanceId);
                        const position = instanceData.position;
                        const modelName = obj.name || existingModelUrl.split('/').pop()?.split('.')[0] || 'unknown';
                        console.log('[MODEL_PERSISTENCE] Existing object details:', {
                            compositeKey,
                            modelName,
                            position: { x: position.x, y: position.y, z: position.z },
                            isVisible: instanceData.isVisible,
                            modelUrl: existingModelUrl,
                            instanceId: existingInstanceId,
                            addedToScene: instancedData.addedToScene,
                            meshCount: instancedData.meshes?.length || 0,
                            hasMatrix: !!instanceData.matrix,
                            matrixNeedsUpdate: instancedData.meshes?.[0]?.instanceMatrix?.needsUpdate
                        });
                        // Also log the actual position values separately for clarity
                        console.log(`[MODEL_PERSISTENCE] ${modelName} position:`, position.x, position.y, position.z);
                    } else {
                        console.warn('[MODEL_PERSISTENCE] ⚠️ Object marked as existing but not found in instances! compositeKey:', compositeKey);
                    }
                }
            }
            console.log('[MODEL_PERSISTENCE] Added', addedCount, 'objects');
            console.log('[MODEL_PERSISTENCE] Failed', failedCount, 'objects');

            setTotalEnvironmentObjects(targetObjects.size);

            // Rebuild all visible instances after updating environment
            console.log('[MODEL_PERSISTENCE] Calling rebuildAllVisibleInstances with cameraPosition:', cameraPosition);
            rebuildAllVisibleInstances(cameraPosition);
            
            // Final verification - check each model type
            const finalCount = Array.from(instancedMeshes.current.values()).reduce((sum, data) => sum + data.instances.size, 0);
            console.log('[MODEL_PERSISTENCE] Final object count in memory:', finalCount);
            console.log('[MODEL_PERSISTENCE] Expected count:', targetObjects.size);
            console.log('[MODEL_PERSISTENCE] Instance count change:', totalInstancesBefore, '->', finalCount);
            
            // Log breakdown by model type with instance IDs
            for (const [modelUrl, instancedData] of instancedMeshes.current) {
                const modelData = environmentModels.find(m => m.modelUrl === modelUrl);
                const instanceCount = instancedData.instances.size;
                const instanceIds = Array.from(instancedData.instances.keys());
                const visibleCount = Array.from((instancedData.instances as Map<number, any>).values()).filter((i: any) => i.isVisible).length;
                console.log(`[MODEL_PERSISTENCE] Model ${modelData?.name || 'unknown'}: ${instanceCount} instances (IDs: [${instanceIds.join(', ')}]), ${visibleCount} visible`);
            }
        } catch (error) {
            console.error("[MODEL_PERSISTENCE] ✗ Error updating environment:", error);
            console.error("[MODEL_PERSISTENCE] Error stack:", error.stack);
        } finally {
            isUndoRedoOperation.current = false;
            console.log('[MODEL_PERSISTENCE] ========== updateEnvironmentToMatch END ==========');
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
            console.warn(`modelType and mesh null`);
            return null;
        }
        const modelData = environmentModels.find(
            (model) => model.id === modelType.id
        );
        if (!modelData) {
            console.warn(`Could not find model with ID ${modelType.id}`);
            return null;
        }
        const modelUrl = modelData.modelUrl;
        const instancedData = instancedMeshes.current.get(modelUrl);
        if (!instancedData) {
            console.warn(
                `Could not find instanced data for model ${modelData.modelUrl}`
            );
            return null;
        }

        if (!instancedData.meshes || instancedData.meshes.length === 0) {
            console.warn(
                `No instanced meshes available for model ${modelData.name}`
            );
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
        console.log(`[MODEL_PERSISTENCE] ✓ Instance added: ${modelUrl}:${instanceId}, count: ${instanceCountBefore} -> ${instanceCountAfter}`);

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

    const clearEnvironments = () => {
        console.log('[MODEL_PERSISTENCE] clearEnvironments called - clearing all instances');
        const totalBefore = Array.from(instancedMeshes.current.values()).reduce((sum, data) => sum + data.instances.size, 0);
        console.log('[MODEL_PERSISTENCE] Total instances before clear:', totalBefore);
        for (const [modelUrl, instancedData] of instancedMeshes.current) {
            const instanceCount = instancedData.instances.size;
            if (instanceCount > 0) {
                console.log(`[MODEL_PERSISTENCE] Clearing ${instanceCount} instances for ${modelUrl}`);
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
        updateLocalStorage();
        console.log('[MODEL_PERSISTENCE] clearEnvironments completed');
    };
    const getRandomValue = (min, max) => {
        return Math.random() * (max - min) + min;
    };

    const getPlacementTransform = () => {
        const settings = placementSettingsRef.current;
        if (!settings) {
            console.warn("No placement settings provided");
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

                    console.log(`[VerticalSnap] Found instance at Y:${closest.position.y.toFixed(1)} when looking for Y:${position.y.toFixed(1)} (offset: ${(closest.position.y - position.y).toFixed(1)})`);
                    collidingInstances.push(closest);
                }
            }
        }

        return collidingInstances;
    };

    const placeEnvironmentModel = async (mode = "add", saveUndo = true) => {
        console.log("placeEnvironmentModel", mode);
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

                console.log(
                    `[DELETION] Removed ${removedObjects.length} environment objects:`, removedObjects
                );

                if (!isUndoRedoOperation.current && saveUndo) {
                    const changes = {
                        terrain: { added: {}, removed: {} },
                        environment: { added: [], removed: removedObjects },
                    };
                    if (undoRedoManager?.current?.saveUndo) {
                        undoRedoManager.current.saveUndo(changes);
                    } else {
                        console.warn(
                            "EnvironmentBuilder: No undoRedoManager available, removal won't be tracked for undo/redo"
                        );
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
            console.warn(`Could not find model with ID ${currentBlockType.id}`);
            return [];
        }
        
        // Ensure model is loaded before placing
        const modelLoaded = await ensureModelLoaded(modelData);
        if (!modelLoaded) {
            console.warn(`Failed to load model ${modelData.name} for placement`);
            return [];
        }
        
        const modelUrl = modelData.modelUrl;
        let instancedData = instancedMeshes.current.get(modelUrl);
        if (!instancedData) {
            console.warn(
                `Could not find instanced data for model ${modelData.modelUrl}`
            );
            return [];
        }

        // Ensure instanced meshes are attached to the scene now that we'll place objects
        ensureInstancedMeshesAdded(modelUrl);

        const placementPositions = getPlacementPositions(
            placeholderMeshRef.current.position,
            placementSizeRef.current
        );
        console.log("placeholderMeshRef.current.position", placeholderMeshRef.current.position);
        console.log("placementPositions", placementPositions);
        const addedObjects = [];


        const validPlacementPositions = placementPositions.filter(placementPosition =>
            // For placement, disable vertical snap so stacking above/below is allowed
            findCollidingInstances(placementPosition, 0.5, { verticalSnap: false }).length === 0
        );

        if (validPlacementPositions.length === 0) {
            console.log("No valid positions to place models - all positions are occupied");
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
                console.error(`Cannot place object: Instance ID ${instanceId} exceeds mesh capacity ${capacity} for model ${modelUrl}.`);
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

                console.log(`[PlaceEnvironment] Created instance ${instanceId} at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`);

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
                console.warn(`Placement failed for instanceId ${instanceId} at position ${JSON.stringify(placementPosition)} (likely due to capacity limit)`);
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
                } else {
                    console.warn(
                        "EnvironmentBuilder: No undoRedoManager available, changes won't be tracked for undo/redo"
                    );
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
        console.log('[MODEL_PERSISTENCE] ========== updateLocalStorage START ==========');
        console.log('[MODEL_PERSISTENCE] Current projectId:', DatabaseManager.getCurrentProjectId());
        const allObjects = [];
        let totalInstancesCount = 0;

        for (const [modelUrl, instancedData] of instancedMeshes.current) {
            const modelData = environmentModels.find(
                (model) => model.modelUrl === modelUrl
            );
            const instanceCount = instancedData.instances.size;
            totalInstancesCount += instanceCount;
            console.log(`[MODEL_PERSISTENCE] Model ${modelData?.name || 'unknown'} (${modelUrl}): ${instanceCount} instances`);
            
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

        console.log('[MODEL_PERSISTENCE] Total instances in memory:', totalInstancesCount);
        console.log('[MODEL_PERSISTENCE] Total objects to save:', allObjects.length);
        console.log('[MODEL_PERSISTENCE] allObjects array:', allObjects);
        console.log('[MODEL_PERSISTENCE] getAllEnvironmentObjects() result:', getAllEnvironmentObjects());
        
        const savePromise = DatabaseManager.saveData(STORES.ENVIRONMENT, "current", allObjects);
        console.log('[MODEL_PERSISTENCE] Database save initiated, promise:', savePromise);
        
        savePromise.then(() => {
            console.log('[MODEL_PERSISTENCE] ✓ Database save completed successfully');
            // Verify what was saved
            DatabaseManager.getData(STORES.ENVIRONMENT, "current").then((saved) => {
                console.log('[MODEL_PERSISTENCE] Verification - saved data from DB:', saved);
                console.log('[MODEL_PERSISTENCE] Verification - saved data type:', typeof saved);
                console.log('[MODEL_PERSISTENCE] Verification - saved data isArray:', Array.isArray(saved));
                if (saved && typeof saved === 'object') {
                    console.log('[MODEL_PERSISTENCE] Verification - saved data keys:', Object.keys(saved));
                    if (Array.isArray(saved)) {
                        console.log('[MODEL_PERSISTENCE] Verification - saved array length:', saved.length);
                    }
                }
            }).catch((err) => {
                console.error('[MODEL_PERSISTENCE] ✗ Error verifying saved data:', err);
            });
        }).catch((err) => {
            console.error('[MODEL_PERSISTENCE] ✗ Database save failed:', err);
        });
        
        setTotalEnvironmentObjects(allObjects.length);
        console.log('[MODEL_PERSISTENCE] ========== updateLocalStorage END ==========');
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
            console.warn(`[MODEL_PERSISTENCE] removeInstance: Instance ${instanceId} not found for removal in model ${modelUrl}, count: ${instanceCountBefore}`);
            return;
        }
        console.log(`[MODEL_PERSISTENCE] removeInstance called: ${modelUrl}:${instanceId}, count before: ${instanceCountBefore}`);

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
        const instanceCountAfter = instancedData.instances.size;
        console.log(`[MODEL_PERSISTENCE] ✓ Instance removed: ${modelUrl}:${instanceId}, count: ${instanceCountBefore} -> ${instanceCountAfter}`);

        // Rebuild visible instances to exclude this removed instance
        rebuildVisibleInstances(modelUrl, cameraPosition);

        if (updateUndoRedo) {
            const changes = {
                terrain: { added: {}, removed: {} },
                environment: { added: [], removed: [removedObject] },
            };
            if (undoRedoManager?.current?.saveUndo) {
                undoRedoManager.current.saveUndo(changes);
            } else {
                console.warn(
                    "EnvironmentBuilder: No undoRedoManager available, removal won't be tracked for undo/redo"
                );
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
        console.log("savedEnv", savedEnv);
        await updateEnvironmentToMatch(savedEnv);
    };

    const refreshEnvironmentFromDB = async () => {
        console.log('[MODEL_PERSISTENCE] ========== refreshEnvironmentFromDB START ==========');
        console.log('[MODEL_PERSISTENCE] Current projectId:', DatabaseManager.getCurrentProjectId());
        const totalInstancesAtStart = Array.from(instancedMeshes.current.values()).reduce((sum, data) => sum + data.instances.size, 0);
        console.log('[MODEL_PERSISTENCE] Current scene state:', { 
            hasScene: !!scene, 
            sceneUUID: scene?.uuid,
            instancedMeshesCount: instancedMeshes.current.size,
            totalObjectsInMemory: totalInstancesAtStart
        });
        // Log instance counts per model at start
        for (const [modelUrl, instancedData] of instancedMeshes.current) {
            const instanceIds = Array.from(instancedData.instances.keys());
            console.log(`[MODEL_PERSISTENCE] At START - ${modelUrl}: ${instancedData.instances.size} instances (IDs: [${instanceIds.join(', ')}])`);
        }
        
        try {
            const savedEnv = await DatabaseManager.getData(
                STORES.ENVIRONMENT,
                "current"
            );
            
            console.log('[MODEL_PERSISTENCE] Raw savedEnv from DB:', savedEnv);
            console.log('[MODEL_PERSISTENCE] savedEnv type:', typeof savedEnv);
            console.log('[MODEL_PERSISTENCE] savedEnv isArray:', Array.isArray(savedEnv));
            console.log('[MODEL_PERSISTENCE] savedEnv is null:', savedEnv === null);
            console.log('[MODEL_PERSISTENCE] savedEnv is undefined:', savedEnv === undefined);
            
            if (savedEnv && typeof savedEnv === 'object') {
                const keys = Object.keys(savedEnv);
                console.log('[MODEL_PERSISTENCE] savedEnv keys count:', keys.length);
                console.log('[MODEL_PERSISTENCE] savedEnv keys:', keys);
            }
            
            if (savedEnv && Object.keys(savedEnv).length > 0) {
                const envArray = Array.isArray(savedEnv) ? savedEnv : Object.values(savedEnv);
                console.log(`[MODEL_PERSISTENCE] Loading ${envArray.length} environment objects from database`);
                console.log('[MODEL_PERSISTENCE] Environment objects to load:', envArray);

                // Lazy load models for all unique model URLs in saved environment
                const uniqueModelUrls = new Set<string>();
                envArray.forEach((obj: any) => {
                    console.log('[MODEL_PERSISTENCE] Processing object:', { 
                        modelUrl: obj.modelUrl, 
                        name: obj.name, 
                        instanceId: obj.instanceId 
                    });
                    if (obj.modelUrl) {
                        uniqueModelUrls.add(obj.modelUrl);
                    } else if (obj.name) {
                        // Find model by name
                        const model = environmentModels.find(m => m.name === obj.name);
                        if (model) {
                            console.log('[MODEL_PERSISTENCE] Found model by name:', model.name, '->', model.modelUrl);
                            uniqueModelUrls.add(model.modelUrl);
                        } else {
                            console.warn('[MODEL_PERSISTENCE] Could not find model by name:', obj.name);
                        }
                    }
                });

                console.log('[MODEL_PERSISTENCE] Unique model URLs to load:', Array.from(uniqueModelUrls));

                // Load all required models in parallel
                const loadPromises = Array.from(uniqueModelUrls).map(async (modelUrl) => {
                    const model = environmentModels.find(m => m.modelUrl === modelUrl);
                    if (model) {
                        console.log('[MODEL_PERSISTENCE] Loading model:', model.name);
                        const loaded = await ensureModelLoaded(model);
                        console.log('[MODEL_PERSISTENCE] Model loaded:', model.name, '->', loaded);
                        return loaded;
                    } else {
                        console.warn('[MODEL_PERSISTENCE] Model not found in environmentModels for URL:', modelUrl);
                    return false;
                    }
                });
                const loadResults = await Promise.all(loadPromises);
                console.log('[MODEL_PERSISTENCE] Model loading results:', loadResults);
                const failedLoads = loadResults.filter(r => !r).length;
                if (failedLoads > 0) {
                    console.warn(`[MODEL_PERSISTENCE] ${failedLoads} models failed to load`);
                }

                console.log('[MODEL_PERSISTENCE] Calling updateEnvironmentToMatch with', envArray.length, 'objects');
                await updateEnvironmentToMatch(envArray);
                
                // Verify what was loaded
                const currentObjects = Array.from(instancedMeshes.current.values()).reduce((sum, data) => sum + data.instances.size, 0);
                console.log('[MODEL_PERSISTENCE] After updateEnvironmentToMatch - objects in memory:', currentObjects);
                console.log('[MODEL_PERSISTENCE] Expected objects:', envArray.length);
                console.log('[MODEL_PERSISTENCE] Instance count change during refresh:', totalInstancesAtStart, '->', currentObjects);
                // Log instance counts per model at end
                for (const [modelUrl, instancedData] of instancedMeshes.current) {
                    const instanceIds = Array.from(instancedData.instances.keys());
                    console.log(`[MODEL_PERSISTENCE] At END - ${modelUrl}: ${instancedData.instances.size} instances (IDs: [${instanceIds.join(', ')}])`);
                }
                
                // Rebuild all visible instances after loading from database
                rebuildAllVisibleInstances(cameraPosition);
                console.log('[MODEL_PERSISTENCE] ✓ Environment refresh completed');
            } else {
                const instancesInMemory = Array.from(instancedMeshes.current.values()).reduce((sum, data) => sum + data.instances.size, 0);
                console.log("[MODEL_PERSISTENCE] No environment objects found in database");
                console.log("[MODEL_PERSISTENCE] Instances in memory:", instancesInMemory);
                if (instancesInMemory > 0) {
                    console.warn("[MODEL_PERSISTENCE] ⚠️ DB is empty but instances exist in memory - likely a race condition. NOT clearing instances.");
                    console.warn("[MODEL_PERSISTENCE] This can happen if refreshEnvironmentFromDB runs before updateLocalStorage completes.");
                } else {
                    console.log("[MODEL_PERSISTENCE] No instances in memory, clearing local env");
                    clearEnvironments();
                }
            }
        } catch (error) {
            console.error("[MODEL_PERSISTENCE] ✗ Error refreshing environment:", error);
            console.error("[MODEL_PERSISTENCE] Error stack:", error.stack);
        }
        console.log('[MODEL_PERSISTENCE] ========== refreshEnvironmentFromDB END ==========');
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
        console.log('[Env] mount/preload guard', { hasScene: !!scene, projectId });
        if (!scene) return;
        if (!projectId) return;
        console.log('[Env] calling preloadModels');
        preloadModels().catch((error) => {
            console.error("[Env] Error in preloadModels:", error);
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
            console.log('[MODEL_PERSISTENCE] ========== SCENE UUID CHANGED ==========');
            console.log('[MODEL_PERSISTENCE] Old scene UUID:', lastLoadedSceneUUIDRef.current);
            console.log('[MODEL_PERSISTENCE] New scene UUID:', scene.uuid);
            const totalInstances = Array.from(instancedMeshes.current.values()).reduce((sum, data) => sum + data.instances.size, 0);
            console.log('[MODEL_PERSISTENCE] Total instances before scene change:', totalInstances);
            // Log each model's instance count
            for (const [modelUrl, instancedData] of instancedMeshes.current) {
                const instanceCount = instancedData.instances.size;
                console.log(`[MODEL_PERSISTENCE] Model ${modelUrl}: ${instanceCount} instances before scene change`);
            }
            // Reset addedToScene flags so meshes get re-added to new scene
            // IMPORTANT: Do NOT clear instances - they should persist across scene changes
            for (const [modelUrl, instancedData] of instancedMeshes.current) {
                const instanceCount = instancedData.instances.size;
                instancedData.addedToScene = false;
                if (instanceCount > 0) {
                    console.log(`[MODEL_PERSISTENCE] Preserving ${instanceCount} instances for ${modelUrl} across scene change`);
                }
            }
            const totalAfter = Array.from(instancedMeshes.current.values()).reduce((sum, data) => sum + data.instances.size, 0);
            console.log('[MODEL_PERSISTENCE] Total instances after scene change:', totalAfter);
            // Log each model's instance count after
            for (const [modelUrl, instancedData] of instancedMeshes.current) {
                const instanceCount = instancedData.instances.size;
                console.log(`[MODEL_PERSISTENCE] Model ${modelUrl}: ${instanceCount} instances after scene change`);
            }
            console.log('[MODEL_PERSISTENCE] ========== SCENE UUID CHANGE END ==========');
        }
        if (scene) {
            lastLoadedSceneUUIDRef.current = scene.uuid;
        }
    }, [scene]);
    
    useEffect(() => {
        console.log('[Env] projectId/scene effect', { 
            hasScene: !!scene, 
            projectId, 
            lastLoadedProjectId: lastLoadedProjectIdRef.current,
            sceneChanged: lastLoadedSceneRef.current !== scene,
            sceneId: scene?.uuid,
            lastSceneUUID: lastLoadedSceneUUIDRef.current,
            refreshInProgress: refreshInProgressRef.current
        });
        if (!projectId) return;
        // If scene is ready and models likely loaded, refresh entities for this project
        if (scene && typeof refreshEnvironmentFromDB === 'function') {
            // Prevent multiple simultaneous calls FIRST (before checking projectId/scene)
            if (refreshInProgressRef.current) {
                console.log('[Env] ⚠️ Refresh already in progress, skipping duplicate call');
                console.log('[Env] Current projectId:', projectId, 'lastLoaded:', lastLoadedProjectIdRef.current);
                console.log('[Env] Current scene UUID:', scene.uuid, 'lastLoaded:', lastLoadedSceneUUIDRef.current);
                return;
            }
            // Prevent multiple calls for the same projectId AND scene UUID
            // Scene object reference can change even with same UUID, so check UUID instead
            if (lastLoadedProjectIdRef.current === projectId && lastLoadedSceneUUIDRef.current === scene.uuid) {
                console.log('[Env] Already loaded for this projectId and scene UUID, skipping duplicate call');
                return;
            }
            console.log('[Env] ✓ Starting refresh from DB for project', projectId, 'scene UUID:', scene.uuid);
            refreshInProgressRef.current = true;
            lastLoadedProjectIdRef.current = projectId;
            lastLoadedSceneRef.current = scene;
            lastLoadedSceneUUIDRef.current = scene.uuid;
            refreshEnvironmentFromDB().finally(() => {
                console.log('[Env] Refresh completed, resetting refreshInProgress flag');
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
                    return false;
                }

                const instanceData = instancedData.instances.get(instanceId);
                if (!instanceData) return false;

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
                    
                    // IMPORTANT: Don't call rebuildVisibleInstances here as it might overwrite
                    // the direct matrix update we just made. The direct update is sufficient
                    // for immediate visual feedback during manipulation.
                    // rebuildVisibleInstances will be called when manipulation ends to ensure
                    // proper culling state.
                } else {
                    console.warn(`[EnvironmentBuilder] No meshes found for model ${modelUrl}`);
                }

                return true;
            }
        }),
        [scene, currentBlockType, placeholderMeshRef.current]
    );

    return null;
};
export default forwardRef(EnvironmentBuilder);