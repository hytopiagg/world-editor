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
// State-based environment models management
let environmentModelsCache = [];
let isEnvironmentModelsLoading = false;
let environmentModelsPromise = null;

const fetchEnvironmentModels = async () => {
    if (isEnvironmentModelsLoading) {
        return environmentModelsPromise;
    }
    
    isEnvironmentModelsLoading = true;
    
    try {
        const manifestUrl = `${process.env.PUBLIC_URL}/assets/models/environment/mattifest.json`;
        const response = await fetch(manifestUrl);
        if (!response.ok) {
            throw new Error("Failed to load model manifest");
        }
        const modelList = await response.json();
        
        let idCounter = 200; // Default models occupy 200-299 range
        const models = new Map();
        const result = [];

        modelList.forEach((fileName) => {
            // Derive category (first folder) and base filename for display name
            const parts = fileName.split("/");
            const baseName = parts.pop().replace(".gltf", "");
            const category = parts.length > 0 ? parts[0] : "Misc";

            const model = {
                id: idCounter++,
                name: baseName,
                modelUrl: `assets/models/environment/${fileName}`,
                category,
                isEnvironment: true,
                animations: ["idle"],
                addCollider: true,
            };
            models.set(baseName, model);
            result.push(model);
        });
        
        environmentModelsCache = result;
        
        // Update the exported array directly
        environmentModels.length = 0;
        environmentModels.push(...result);
        
        // Notify components that models are now available
        console.log(`🎯 Environment models loaded: ${result.length} models available`);
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('environmentModelsLoaded', { detail: result }));
        }
        
        return result;
    } catch (error) {
        console.error("Error loading environment models:", error);
        return [];
    } finally {
        isEnvironmentModelsLoading = false;
    }
};

// Create a real array that will be mutated when models load
export const environmentModels = [];

// Start loading models immediately but don't block
environmentModelsPromise = fetchEnvironmentModels();

// Export promise for components that need to wait for models
export const getEnvironmentModels = () => environmentModelsPromise;

// Export function to check if models are loaded
export const areEnvironmentModelsLoaded = () => environmentModelsCache.length > 0;

// Helper: returns stored vertical y-shift (in units) for the given model URL, defaulting to 0
const getModelYShift = (modelUrl?: string) => {
    if (!modelUrl) return 0;
    const model = environmentModels.find((m) => m.modelUrl === modelUrl);
    return model && typeof model.yShift === "number" ? model.yShift : 0;
};

const EnvironmentBuilder = (
    {
        scene,
        previewPositionFromAppJS,
        currentBlockType,
        onTotalObjectsChange,
        placementSize = "single",
        placementSettings,
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
                const reason = hasChanges ? `${visibilityChangeCount} visibility changes` : 'recently placed instances';
                console.log(`[DistanceCulling] Rebuilding ${instances.length} instances for ${modelUrl.split('/').pop()} (${reason})`);
                rebuildVisibleInstances(modelUrl, cameraPos);
            }
        }

        // Only log summary if there were significant changes
        if (hasAnyChanges && (totalVisible + totalHidden) > 0) {
            console.log(`[DistanceCulling] Updated visibility: ${totalVisible} visible, ${totalHidden} hidden (view distance: ${viewDistance})`);
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
        if (!scene || !data || data.addedToScene) return;
        data.meshes.forEach((mesh: THREE.InstancedMesh) => {
            // Ensure frustum culling is disabled - we handle our own distance culling
            mesh.frustumCulled = false;
            scene.add(mesh);
        });
        data.addedToScene = true;
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
                                ...environmentModels.map((model) => model.id),
                                199
                            ) + 1,
                        name: model.name,
                        modelUrl: fileUrl,
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

            await Promise.all(
                environmentModels.map(async (model) => {
                    try {
                        const gltf = await loadModel(model.modelUrl);
                        if (gltf) {
                            gltf.scene.updateMatrixWorld(true);

                            await new Promise((r) => setTimeout(r, 0));

                            setupInstancedMesh(model, gltf);
                        }
                    } catch (error) {
                        console.error(
                            `Error preloading model ${model.name}:`,
                            error
                        );
                    }
                })
            );

            await refreshEnvironmentFromDB();
        } catch (error) {
            console.error("Error loading custom models from DB:", error);
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

    const updateEnvironmentToMatch = (targetState) => {
        console.log("updateEnvironmentToMatch", targetState);
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
                } else {
                    console.warn(
                        `Could not find model for ${obj.name || obj.modelUrl}`
                    );
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

            setTotalEnvironmentObjects(targetObjects.size);

            // Rebuild all visible instances after updating environment
            rebuildAllVisibleInstances(cameraPosition);
        } catch (error) {
            console.error("Error updating environment:", error);
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
        instancedData.instances.set(instanceId, {
            position,
            rotation,
            scale,
            matrix,
            isVisible: true,
        });

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
        for (const [modelUrl, instancedData] of instancedMeshes.current) {
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
        const rotationDegrees = settings.randomRotation
            ? getRandomValue(settings.minRotation, settings.maxRotation)
            : settings.rotation;

        return {
            scale: getVector3().set(scaleValue, scaleValue, scaleValue),
            rotation: getEuler().set(0, (rotationDegrees * Math.PI) / 180, 0),
        };
    };

    const findCollidingInstances = (position, tolerance = 0.5) => {
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
            } else {
                // If no exact matches, look for closest vertical match within 1 block
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

    const placeEnvironmentModel = (mode = "add", saveUndo = true) => {
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
            findCollidingInstances(placementPosition).length === 0
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
            quaternion.setFromEuler(transform.rotation);
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
                    rotation: getEuler().copy(transform.rotation),
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
                        x: transform.rotation.x,
                        y: transform.rotation.y,
                        z: transform.rotation.z,
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
            } else {
                console.warn(`Placement failed for instanceId ${instanceId} at position ${JSON.stringify(placementPosition)} (likely due to capacity limit)`);
                // Release temporary objects if placement failed
                releaseQuaternion(quaternion);
                releaseVector3(position);
                releaseMatrix4(matrix);
                releaseVector3(transform.scale);
                releaseEuler(transform.rotation);
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
        const allObjects = [];

        for (const [modelUrl, instancedData] of instancedMeshes.current) {
            const modelData = environmentModels.find(
                (model) => model.modelUrl === modelUrl
            );
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

        console.log("allObjects", allObjects);
        console.log("getAllEnvironmentObjects", getAllEnvironmentObjects());
        DatabaseManager.saveData(STORES.ENVIRONMENT, "current", allObjects);
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
        if (!instancedData || !instancedData.instances.has(instanceId)) {
            console.warn(`[REMOVE_INSTANCE] Instance ${instanceId} not found for removal in model ${modelUrl}`);
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
    const refreshEnvironment = () => {
        const savedEnv = getAllEnvironmentObjects();
        console.log("savedEnv", savedEnv);
        updateEnvironmentToMatch(savedEnv);
    };

    const refreshEnvironmentFromDB = async () => {
        console.log("refreshEnvironmentFromDB");
        try {
            const savedEnv = await DatabaseManager.getData(
                STORES.ENVIRONMENT,
                "current"
            );
            console.log("savedEnv", savedEnv);
            if (Object.keys(savedEnv).length > 0) {
                console.log(
                    `Loading ${Object.keys(savedEnv).length} environment objects from database`
                );

                updateEnvironmentToMatch(Object.values(savedEnv));
                // Rebuild all visible instances after loading from database
                rebuildAllVisibleInstances(cameraPosition);
            } else {
                console.log("No environment objects found in database");
                clearEnvironments();
            }
        } catch (error) {
            console.error("Error refreshing environment:", error);
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
        if (scene) {
            preloadModels().catch((error) => {
                console.error("Error in preloadModels:", error);
            });
        }
    }, [scene]);

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

    useEffect(() => {
        if (cameraPosition) {
            throttledUpdateDistanceCulling(cameraPosition);
        }
    }, [cameraPosition]);

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
            getObjectPoolStats: () => ObjectPoolManager.getInstance().getAllStats()
        }),
        [scene, currentBlockType, placeholderMeshRef.current]
    );

    return null;
};
export default forwardRef(EnvironmentBuilder);

// Expose internal helper for tests
if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test') {
    // eslint-disable-next-line no-undef
    module.exports.getPlacementPositions = getPlacementPositions;
}