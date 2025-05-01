import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import {
    useEffect,
    useRef,
    useState,
    useImperativeHandle,
    forwardRef,
} from "react";
import { DatabaseManager, STORES } from "./managers/DatabaseManager";
import { MAX_ENVIRONMENT_OBJECTS } from "./Constants";
import { CustomModel } from "./types/DatabaseTypes";
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
        let idCounter = 1000;
        const models = new Map();
        const result = [];

        const modelList = fetchModelList();
        modelList.forEach((fileName) => {
            const name = fileName.replace(".gltf", "");
            const model = {
                id: idCounter++,
                name: name,
                modelUrl: `assets/models/environment/${fileName}`,
                isEnvironment: true,
                animations: ["idle"],
            };
            models.set(name, model);
            result.push(model);
        });
        return result;
    } catch (error) {
        console.error("Error loading environment models:", error);
        return [];
    }
})();
const EnvironmentBuilder = (
    {
        scene,
        previewPositionFromAppJS,
        currentBlockType,
        mode,
        onTotalObjectsChange,
        placementSize = "single",
        placementSettings,
        undoRedoManager,
    },
    ref
) => {
    const loader = useRef(new GLTFLoader());
    const placeholderMeshRef = useRef(null);
    const loadedModels = useRef(new Map());
    const instancedMeshes = useRef(new Map());
    const positionOffset = useRef(new THREE.Vector3(0, -0.5, 0));
    const placementSizeRef = useRef(placementSize);
    const lastPreviewTransform = useRef({
        scale: new THREE.Vector3(1, 1, 1),
        rotation: new THREE.Euler(0, 0, 0),
    });
    const placementSettingsRef = useRef(placementSettings);
    const isUndoRedoOperation = useRef(false);

    const [totalEnvironmentObjects, setTotalEnvironmentObjects] = useState(0);

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
                        animations: ["idle"],
                    };
                    environmentModels.push(newEnvironmentModel);
                }
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
        const boundingHeight = size.y;

        const modelIndex = environmentModels.findIndex(
            (model) => model.id === modelType.id
        );
        if (modelIndex !== -1) {
            environmentModels[modelIndex] = {
                ...environmentModels[modelIndex],
                boundingBoxHeight: boundingHeight,
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
                    const newMaterial = material.clone();
                    newMaterial.depthWrite = true;
                    newMaterial.depthTest = true;
                    newMaterial.transparent = true;
                    newMaterial.alphaTest = 0.5;
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
                instancedMesh.frustumCulled = false;
                instancedMesh.renderOrder = 1;
                instancedMesh.count = 0;
                scene.add(instancedMesh);
                instancedMeshArray.push(instancedMesh);
                mergedGeometry.computeBoundingBox();
                mergedGeometry.computeBoundingSphere();
            }
        }
        instancedMeshes.current.set(modelType.modelUrl, {
            meshes: instancedMeshArray,
            instances: new Map(),
            modelHeight: boundingHeight,
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
                    child.material = Array.isArray(child.material)
                        ? child.material.map((m) => m.clone())
                        : child.material.clone();
                    if (Array.isArray(child.material)) {
                        child.material.forEach((material) => {
                            material.transparent = true;
                            material.opacity = 0.5;
                            material.depthWrite = false;
                            material.depthTest = true;
                        });
                    } else {
                        child.material.transparent = true;
                        child.material.opacity = 0.5;
                        child.material.depthWrite = false;
                        child.material.depthTest = true;
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
                previewModel.position
                    .copy(position)
                    .add(positionOffset.current);
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

        if (
            !placeholderMeshRef.current ||
            placeholderMeshRef.current.userData.modelId !== currentBlockType.id
        ) {
            await setupPreview(position);
        } else if (position) {
            placeholderMeshRef.current.position.copy(
                position.clone().add(positionOffset.current)
            );
            placeholderMeshRef.current.scale.copy(
                lastPreviewTransform.current.scale
            );
            placeholderMeshRef.current.rotation.copy(
                lastPreviewTransform.current.rotation
            );
        }
    };

    const updateEnvironmentToMatch = (targetState) => {
        try {
            isUndoRedoOperation.current = true;

            const currentObjects = new Map(); // Map<instanceId, {modelUrl, position, rotation, scale}>
            const targetObjects = new Map(); // Map<instanceId, {modelUrl, position, rotation, scale}>

            for (const [modelUrl, instancedData] of instancedMeshes.current) {
                instancedData.instances.forEach((data, instanceId) => {
                    currentObjects.set(instanceId, {
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
                    // Create a proper THREE.Euler from the loaded data
                    const eulerRotation = new THREE.Euler(
                        obj.rotation?.x || 0,
                        obj.rotation?.y || 0,
                        obj.rotation?.z || 0
                    );

                    targetObjects.set(obj.instanceId, {
                        ...obj,
                        modelUrl: modelType.modelUrl, // Use the current modelUrl from environmentModels
                        position: new THREE.Vector3(
                            obj.position.x,
                            obj.position.y,
                            obj.position.z
                        ),
                        rotation: eulerRotation,
                        scale: new THREE.Vector3(
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

            for (const [instanceId, obj] of currentObjects) {
                if (!targetObjects.has(instanceId)) {
                    removeInstance(obj.modelUrl, instanceId);
                }
            }

            for (const [instanceId, obj] of targetObjects) {
                if (!currentObjects.has(instanceId)) {
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
                            instanceId
                        );
                    }
                }
            }

            updateLocalStorage();
            setTotalEnvironmentObjects(targetObjects.size);
        } catch (error) {
            console.error("Error updating environment:", error);
        } finally {
            isUndoRedoOperation.current = false;
        }
    };

    const placeEnvironmentModelWithoutSaving = (
        blockType,
        mesh,
        savedInstanceId = null
    ) => {
        console.log(
            "placeEnvironmentModelWithoutSaving",
            blockType,
            mesh,
            savedInstanceId
        );
        if (!blockType || !mesh) {
            console.warn(`blockType and mesh null`);
            return null;
        }
        const modelData = environmentModels.find(
            (model) => model.id === blockType.id
        );
        if (!modelData) {
            console.warn(`Could not find model with ID ${blockType.id}`);
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
        const position = mesh.position.clone();
        const rotation = mesh.rotation.clone();
        const scale = mesh.scale.clone();
        const matrix = new THREE.Matrix4();
        matrix.compose(
            position,
            new THREE.Quaternion().setFromEuler(rotation),
            scale
        );

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
        validMeshes.forEach((mesh) => {
            const currentCapacity = mesh.instanceMatrix.count;
            if (instanceId >= currentCapacity - 1) {
                alert(
                    "Maximum Environment Objects Exceeded! Please clear the environment and try again."
                );
                return;
            }
            mesh.count = Math.max(mesh.count, instanceId + 1);
            mesh.setMatrixAt(instanceId, matrix);
            mesh.instanceMatrix.needsUpdate = true;
        });
        instancedData.instances.set(instanceId, {
            position,
            rotation,
            scale,
            matrix,
        });
        return {
            modelUrl,
            instanceId,
            position,
            rotation,
            scale,
        };
    };

    const clearEnvironments = () => {
        for (const instancedData of instancedMeshes.current.values()) {
            instancedData.meshes.forEach((mesh) => {
                mesh.count = 0;
                mesh.instanceMatrix.needsUpdate = true;
            });

            instancedData.instances.clear();
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
                scale: new THREE.Vector3(1, 1, 1),
                rotation: new THREE.Euler(0, 0, 0),
            };
        }
        const scaleValue = settings.randomScale
            ? getRandomValue(settings.minScale, settings.maxScale)
            : settings.scale;
        const rotationDegrees = settings.randomRotation
            ? getRandomValue(settings.minRotation, settings.maxRotation)
            : settings.rotation;

        return {
            scale: new THREE.Vector3(scaleValue, scaleValue, scaleValue),
            rotation: new THREE.Euler(0, (rotationDegrees * Math.PI) / 180, 0),
        };
    };

    const placeEnvironmentModel = (mode = "add") => {
        if (!scene || !placeholderMeshRef.current) return;

        if (mode === "add" && !currentBlockType) return;

        if (mode === "remove") {
            const placementPositions = getPlacementPositions(
                placeholderMeshRef.current.position,
                placementSizeRef.current
            );
            const removedObjects = [];

            placementPositions.forEach((placementPosition) => {
                const POSITION_TOLERANCE = 0.5;

                for (const [
                    modelUrl,
                    instancedData,
                ] of instancedMeshes.current.entries()) {
                    const instances = Array.from(
                        instancedData.instances.entries()
                    ).map(([instanceId, data]) => ({
                        instanceId,
                        modelUrl,
                        position: data.position,
                        rotation: data.rotation,
                        scale: data.scale,
                    }));

                    const matchingInstances = instances.filter((instance) => {
                        return (
                            Math.abs(
                                instance.position.x - placementPosition.x
                            ) < POSITION_TOLERANCE &&
                            Math.abs(
                                instance.position.y - placementPosition.y
                            ) < POSITION_TOLERANCE &&
                            Math.abs(
                                instance.position.z - placementPosition.z
                            ) < POSITION_TOLERANCE
                        );
                    });

                    matchingInstances.forEach((instance) => {
                        const objectData = instancedData.instances.get(
                            instance.instanceId
                        );

                        const removedObject = {
                            modelUrl,
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

                        instancedData.meshes.forEach((mesh) => {
                            mesh.setMatrixAt(
                                instance.instanceId,
                                new THREE.Matrix4()
                            );

                            mesh.count =
                                Math.max(
                                    ...Array.from(
                                        instancedData.instances.keys()
                                    ) as number[],
                                    -1
                                ) + 1;
                            mesh.instanceMatrix.needsUpdate = true;
                        });
                        removedObjects.push(removedObject);
                    });
                }
            });

            if (removedObjects.length > 0) {
                console.log(
                    `Removed ${removedObjects.length} environment objects`
                );

                if (!isUndoRedoOperation.current) {
                    const changes = {
                        terrain: { added: {}, removed: {} }, // no terrain changes
                        environment: { added: [], removed: removedObjects },
                    };
                    if (undoRedoManager?.current?.saveUndo) {
                        undoRedoManager.current.saveUndo(changes);
                    }
                }

                updateLocalStorage();
                return removedObjects;
            }
            return []; // No objects were removed
        }

        const modelData = environmentModels.find(
            (model) => model.id === currentBlockType.id
        );
        if (!modelData) {
            console.warn(`Could not find model with ID ${currentBlockType.id}`);
            return;
        }
        const modelUrl = modelData.modelUrl;
        let instancedData = instancedMeshes.current.get(modelUrl);
        if (!instancedData) {
            console.warn(
                `Could not find instanced data for model ${modelData.modelUrl}`
            );
            return;
        }

        const placementPositions = getPlacementPositions(
            placeholderMeshRef.current.position,
            placementSizeRef.current
        );
        const addedObjects = [];

        let highestInstanceId = -1;
        for (const [_, data] of instancedMeshes.current) {
            if (data.instances.size > 0) {
                const maxId = Math.max(...Array.from(data.instances.keys()) as number[]);
                highestInstanceId = Math.max(highestInstanceId, maxId);
            }
        }

        let nextInstanceId = highestInstanceId + 1;

        const totalNeededInstances = nextInstanceId + placementPositions.length;

        if (totalNeededInstances > MAX_ENVIRONMENT_OBJECTS) {
            alert(
                `Maximum Environment Objects (${MAX_ENVIRONMENT_OBJECTS}) Exceeded! Please clear the environment and try again.`
            );
            return;
        }

        placementPositions.forEach((placementPosition) => {
            const instanceId = nextInstanceId++;

            const transform = getPlacementTransform();
            const position = new THREE.Vector3(
                placementPosition.x,
                placementPosition.y,
                placementPosition.z
            );
            const matrix = new THREE.Matrix4();
            matrix.compose(
                position,
                new THREE.Quaternion().setFromEuler(transform.rotation),
                transform.scale
            );

            instancedData.meshes.forEach((mesh) => {
                if (!mesh) {
                    console.error("Invalid mesh encountered");
                    return;
                }
                mesh.count = Math.max(mesh.count, instanceId + 1);
                mesh.setMatrixAt(instanceId, matrix);
                mesh.instanceMatrix.needsUpdate = true;
            });

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
            addedObjects.push(newObject);

            instancedData.instances.set(instanceId, {
                position: position.clone(),
                rotation: transform.rotation.clone(),
                scale: transform.scale.clone(),
                matrix: matrix.clone(),
            });
        });

        if (!isUndoRedoOperation.current) {
            const changes = {
                terrain: { added: {}, removed: {} }, // no terrain changes
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

        updateLocalStorage();
        setTotalEnvironmentObjects((prev) => prev + placementPositions.length);

        if (
            placementSettingsRef.current?.randomScale ||
            placementSettingsRef.current?.randomRotation
        ) {
            const nextTransform = getPlacementTransform();
            lastPreviewTransform.current = nextTransform;

            placeholderMeshRef.current.scale.copy(nextTransform.scale);
            placeholderMeshRef.current.rotation.copy(nextTransform.rotation);
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
                // Convert to plain objects since THREE.js objects aren't properly serialized
                const serializablePosition = {
                    x: data.position.x,
                    y: data.position.y,
                    z: data.position.z,
                };

                // Limit rotation values to 5 decimal places to reduce precision issues
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

    const removeInstance = (modelUrl, instanceId) => {
        const instancedData = instancedMeshes.current.get(modelUrl);
        if (!instancedData || !instancedData.instances.has(instanceId)) {
            console.warn(`Instance ${instanceId} not found for removal`);
            return;
        }

        const objectData = instancedData.instances.get(instanceId);

        instancedData.instances.delete(instanceId);

        instancedData.meshes.forEach((mesh) => {
            mesh.setMatrixAt(instanceId, new THREE.Matrix4());

            mesh.count =
                Math.max(...Array.from(instancedData.instances.keys()) as number[], -1) + 1;
            mesh.instanceMatrix.needsUpdate = true;
        });

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

        if (!isUndoRedoOperation.current) {
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

        updateLocalStorage();
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
            placeholderMeshRef.current.position.copy(
                position.clone().add(positionOffset.current)
            );
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

    const rotatePreview = (angle) => {
        if (placeholderMeshRef.current) {
            placeholderMeshRef.current.rotation.y += angle;
        }
    };

    const setScale = (scale) => {
        setScale(scale);
        if (placeholderMeshRef.current) {
            placeholderMeshRef.current.scale.set(scale, scale, scale);
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
        if (placeholderMeshRef.current && currentBlockType?.isEnvironment) {
            const transform = getPlacementTransform();

            placeholderMeshRef.current.scale.copy(transform.scale);
            placeholderMeshRef.current.rotation.copy(transform.rotation);
        }
    }, [placementSettings]); // Watch for changes in placement settings

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
        placementSettingsRef.current = placementSettings;
    }, [placementSettings]);

    const beginUndoRedoOperation = () => {
        isUndoRedoOperation.current = true;
    };
    const endUndoRedoOperation = () => {
        isUndoRedoOperation.current = false;
    };
    useImperativeHandle(
        ref,
        () => ({
            updateModelPreview,
            removePreview,
            rotatePreview,
            setScale,
            placeEnvironmentModel,
            preloadModels,
            clearEnvironments,
            removeInstance,
            updatePreviewPosition,
            updateEnvironmentToMatch,
            loadModel,
            refreshEnvironmentFromDB,
            beginUndoRedoOperation,
            endUndoRedoOperation,
            updateLocalStorage,
        }),
        [scene, currentBlockType, placeholderMeshRef.current]
    );

    return null;
};
export default forwardRef(EnvironmentBuilder);
