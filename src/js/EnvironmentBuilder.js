import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils';
import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { DatabaseManager, STORES } from './DatabaseManager';
import { ENVIRONMENT_INSTANCED_MESH_CAPACITY } from './constants/performance';

export const environmentModels = (() => {
  try {
    // Function to fetch directory listing from the server synchronously
    const fetchModelList = () => {
      const manifestUrl = `${process.env.PUBLIC_URL}/assets/models/environment/mattifest.json`;
      const xhr = new XMLHttpRequest();
      xhr.open('GET', manifestUrl, false); // false makes it synchronous
      xhr.send();
      
      if (xhr.status !== 200) {
        throw new Error('Failed to load model mattifest');
      }
      
      return JSON.parse(xhr.responseText);
    };

    let idCounter = 1000;
    const models = new Map();
    const result = [];

    // Load models synchronously
    const modelList = fetchModelList();
    modelList.forEach(fileName => {
      const name = fileName.replace('.gltf', '');
      const model = {
        id: idCounter++,
        name: name,
        modelUrl: `assets/models/environment/${fileName}`,
        isEnvironment: true,
        animations: ['idle']
      };
      models.set(name, model);
      result.push(model);
    });

    return result;

  } catch (error) {
    console.error('Error loading environment models:', error);
    return [];
  }
})();

const EnvironmentBuilder = ({ scene, previewPositionFromAppJS, currentBlockType, mode, onTotalObjectsChange, placementSize = 'single', placementSettings, undoRedoManager}, ref) => {

    // Convert class properties to refs and state
    const loader = useRef(new GLTFLoader());
    const placeholderMeshRef = useRef(null);
    const loadedModels = useRef(new Map());
    const instancedMeshes = useRef(new Map());
    const positionOffset = useRef(new THREE.Vector3(0, -0.5, 0));
    const placementSizeRef = useRef(placementSize);
    const lastPreviewTransform = useRef({ 
        scale: new THREE.Vector3(1, 1, 1), 
        rotation: new THREE.Euler(0, 0, 0) 
    });
    const placementSettingsRef = useRef(placementSettings);
    const isUndoRedoOperation = useRef(false);

    /// state for total environment objects
    const [totalEnvironmentObjects, setTotalEnvironmentObjects] = useState(0);

    // Convert class methods to functions
    const loadModel = async (modelToLoadUrl) => {
        if (!modelToLoadUrl) {
            console.warn('No model URL provided');
            return null;
        }

        // Check if already loaded
        if (loadedModels.current.has(modelToLoadUrl)) {
            return loadedModels.current.get(modelToLoadUrl);
        }

        // Properly construct the URL
        let fullUrl;
        if (modelToLoadUrl.startsWith('blob:')) {
            fullUrl = modelToLoadUrl;
        } else if (modelToLoadUrl.startsWith('http')) {
            fullUrl = modelToLoadUrl;
        } else {
            const cleanPath = modelToLoadUrl.replace(/^\/+/, '');
            fullUrl = `${process.env.PUBLIC_URL}/${cleanPath}`;
        }

        try {
            const response = await fetch(fullUrl);
            if (!response.ok) {
                throw new Error(`Failed to load model: ${fullUrl}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            
            return new Promise((resolve, reject) => {
                loader.current.parse(arrayBuffer, '', 
                    (gltf) => {
                        loadedModels.current.set(modelToLoadUrl, gltf);
                        resolve(gltf);
                    },
                    (error) => reject(error)
                );
            });

        } catch (error) {
            console.error('Error loading model:', fullUrl, error);
            return null;
        }
    };

    const preloadModels = async () => {
        // Load custom models from DB first
        try {
            const customModels = await DatabaseManager.getData(STORES.CUSTOM_MODELS, 'models');
            if (customModels) {
                // Clear any existing custom models to prevent duplicates
                const customModelIndices = environmentModels
                    .filter(model => model.isCustom)
                    .map(model => environmentModels.indexOf(model));
                
                // Remove from highest index to lowest to avoid shifting issues
                customModelIndices.sort((a, b) => b - a).forEach(index => {
                    environmentModels.splice(index, 1);
                });
                
                for (const model of customModels) {
                    const blob = new Blob([model.data], { type: 'model/gltf+json' });
                    const fileUrl = URL.createObjectURL(blob);
                    
                    const newEnvironmentModel = {
                        id: Math.max(...environmentModels.map(model => model.id), 199) + 1,
                        name: model.name,
                        modelUrl: fileUrl,
                        isEnvironment: true,
                        isCustom: true,
                        animations: ['idle']
                    };
                    
                    environmentModels.push(newEnvironmentModel);
                }
            }

            // Load and setup all models
            await Promise.all(environmentModels.map(async (model) => {
                try {
                    const gltf = await loadModel(model.modelUrl);
                    if (gltf) {
                        // Ensure it's fully updated
                        gltf.scene.updateMatrixWorld(true);

                        // Optionally wait a small tick:
                        await new Promise(r => setTimeout(r, 0));

                        // Now safely merge geometry
                        setupInstancedMesh(model, gltf);
                    }
                } catch (error) {
                    console.error(`Error preloading model ${model.name}:`, error);
                }
            }));

            // Load saved environment after models are loaded
            await refreshEnvironmentFromDB();
        } catch (error) {
            console.error('Error loading custom models from DB:', error);
        }
    };
    
    const setupInstancedMesh = (modelType, gltf) => {
        if (!gltf || !gltf.scene) {
            console.error('Invalid GLTF data for model:', modelType.name);
            return;
        }

        // Calculate bounding box for the entire model
        const bbox = new THREE.Box3().setFromObject(gltf.scene);
        const size = bbox.getSize(new THREE.Vector3());
        const boundingHeight = size.y;

        // Add boundingBoxHeight to the model type in environmentModels
        const modelIndex = environmentModels.findIndex(model => model.id === modelType.id);
        if (modelIndex !== -1) {
            environmentModels[modelIndex] = {
                ...environmentModels[modelIndex],
                boundingBoxHeight: boundingHeight
            };
        }

        // Reset scene transforms to ensure clean state
        gltf.scene.position.set(0, 0, 0);
        gltf.scene.rotation.set(0, 0, 0);
        gltf.scene.scale.set(1, 1, 1);
        gltf.scene.updateMatrixWorld(true);

        // Group geometries by material
        const geometriesByMaterial = new Map();
        
        gltf.scene.traverse(object => {
            if (object.isMesh) {
                const worldMatrix = object.matrixWorld.clone();
                const materials = Array.isArray(object.material) ? object.material : [object.material];
                
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
                            geometries: []
                        });
                    }
                    
                    const geometry = object.geometry.clone();
                    geometry.applyMatrix4(worldMatrix);
                    
                    if (Array.isArray(object.material)) {
                        const filteredGeometry = filterGeometryByMaterialIndex(geometry, materialIndex);
                        if (filteredGeometry) {
                            geometriesByMaterial.get(key).geometries.push(filteredGeometry);
                        }
                    } else {
                        geometriesByMaterial.get(key).geometries.push(geometry);
                    }
                });
            }
        });

        // Set a large initial capacity
        const initialCapacity = ENVIRONMENT_INSTANCED_MESH_CAPACITY; // Adjust as needed based on your expected maximum

        const instancedMeshArray = [];
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
            modelHeight: boundingHeight
        });
    };

    // Helper function to filter geometry by material index
    const filterGeometryByMaterialIndex = (geometry, materialIndex) => {
        if (!geometry.groups || geometry.groups.length === 0) return geometry;

        const newGeometry = geometry.clone();
        const indices = [];
        
        for (let i = 0; i < geometry.index.count; i += 3) {
            const faceIndex = Math.floor(i / 3);
            const group = geometry.groups.find(g => 
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
                console.error('Failed to load model for preview');
                return;
            }

            if (!instancedMeshes.current.has(currentBlockType.modelUrl)) {
                setupInstancedMesh(currentBlockType, gltf);
            }

            // 2) CREATE a new preview model
            const previewModel = gltf.scene.clone(true);

            previewModel.traverse((child) => {
                if (child.isMesh) {
                    child.material = Array.isArray(child.material)
                        ? child.material.map(m => m.clone())
                        : child.material.clone();

                    if (Array.isArray(child.material)) {
                        child.material.forEach(material => {
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

            // 3) Generate random transform once, store in lastPreviewTransform
            const transform = getPlacementTransform();
            lastPreviewTransform.current.scale.copy(transform.scale);
            lastPreviewTransform.current.rotation.copy(transform.rotation);

            // 4) Apply that transform to the preview model
            previewModel.scale.copy(lastPreviewTransform.current.scale);
            previewModel.rotation.copy(lastPreviewTransform.current.rotation);

            // Position the preview (if you have a valid position)
            if (position) {
                previewModel.position.copy(position).add(positionOffset.current);
            }

            // Remove old preview, then add the new one
            if (placeholderMeshRef.current) {
                removePreview();
            }
            scene.add(previewModel);
            placeholderMeshRef.current = previewModel;
        } catch (error) {
            console.error('Error setting up preview:', error);
        }
    };

    const updateModelPreview = async (position) => {
        if (!currentBlockType || !scene) {
            return;
        }

        // If not an environment type and we have a preview, remove it
        if (!currentBlockType.isEnvironment) {
            removePreview();
            return;
        }

        // Only create new preview if needed
        if (!placeholderMeshRef.current || placeholderMeshRef.current.userData.modelId !== currentBlockType.id) {
            await setupPreview(position);
        } else if (position) {
            // Just update position if preview exists
            placeholderMeshRef.current.position.copy(position.clone().add(positionOffset.current));
            placeholderMeshRef.current.scale.copy(lastPreviewTransform.current.scale);
            placeholderMeshRef.current.rotation.copy(lastPreviewTransform.current.rotation);
        }
    };

    /// updates the environment to match the target state, ignoring any instances that are already in the environment
    /// only used when rebuilding the environment
    const updateEnvironmentToMatch = (targetState) => {
        try {
            isUndoRedoOperation.current = true;
            
            // Create maps for efficient lookups
            const currentObjects = new Map(); // Map<instanceId, {modelUrl, position, rotation, scale}>
            const targetObjects = new Map(); // Map<instanceId, {modelUrl, position, rotation, scale}>

            // Build current state map
            for (const [modelUrl, instancedData] of instancedMeshes.current) {
                instancedData.instances.forEach((data, instanceId) => {
                    currentObjects.set(instanceId, {
                        modelUrl,
                        instanceId,
                        position: data.position,
                        rotation: data.rotation,
                        scale: data.scale
                    });
                });
            }

            // Build target state map
            targetState.forEach(obj => {
                // Find the corresponding model in environmentModels
                const modelType = environmentModels.find(model => 
                    model.name === obj.name || model.modelUrl === obj.modelUrl
                );
                
                if (modelType) {
                    targetObjects.set(obj.instanceId, {
                        ...obj,
                        modelUrl: modelType.modelUrl, // Use the current modelUrl from environmentModels
                        position: new THREE.Vector3(obj.position.x, obj.position.y, obj.position.z),
                        rotation: new THREE.Euler(obj.rotation.x, obj.rotation.y, obj.rotation.z),
                        scale: new THREE.Vector3(obj.scale.x, obj.scale.y, obj.scale.z)
                    });
                } else {
                    console.warn(`Could not find model for ${obj.name || obj.modelUrl}`);
                }
            });

            // Remove objects not in target state
            for (const [instanceId, obj] of currentObjects) {
                if (!targetObjects.has(instanceId)) {
                    removeInstance(obj.modelUrl, instanceId);
                }
            }

            // Add/update objects in target state
            for (const [instanceId, obj] of targetObjects) {
                if (!currentObjects.has(instanceId)) {
                    // Add new object
                    const modelType = environmentModels.find(model => 
                        model.modelUrl === obj.modelUrl || model.name === obj.name
                    );
                    
                    if (modelType) {
                        const tempMesh = new THREE.Object3D();
                        tempMesh.position.copy(obj.position);
                        tempMesh.rotation.copy(obj.rotation);
                        tempMesh.scale.copy(obj.scale);
                        placeEnvironmentModelWithoutSaving(modelType, tempMesh, instanceId);
                    }
                }
            }

            // Update UI
            updateLocalStorage();
            setTotalEnvironmentObjects(targetObjects.size);

        } catch (error) {
            console.error('Error updating environment:', error);
        } finally {
            isUndoRedoOperation.current = false;
        }
    };

    /// places an object in the environment, without saving state
    /// only used when rebuilding the environment, so that the state is not saved to the database untill after the environment has been rebuilt
    const placeEnvironmentModelWithoutSaving = (blockType, mesh, savedInstanceId = null) => {
        if (!blockType || !mesh) {
            console.warn(`blockType and mesh null`);
            return null;
        }

        const modelData = environmentModels.find(model => model.id === blockType.id);
        if (!modelData) {
            console.warn(`Could not find model with ID ${blockType.id}`);
            return null;
        }

        const modelUrl = modelData.modelUrl;
        const instancedData = instancedMeshes.current.get(modelUrl);
        
        if (!instancedData) {
            console.warn(`Could not find instanced data for model ${modelData.modelUrl}`);
            return null;
        }

        // Check if meshes array exists and is not empty
        if (!instancedData.meshes || instancedData.meshes.length === 0) {
            console.warn(`No instanced meshes available for model ${modelData.name}`);
            return null;
        }

        // Update the world matrix to ensure all transforms are correct
        mesh.updateWorldMatrix(true, true);

        const position = mesh.position.clone();
        const rotation = mesh.rotation.clone();
        const scale = mesh.scale.clone();

        const matrix = new THREE.Matrix4();
        matrix.compose(position, new THREE.Quaternion().setFromEuler(rotation), scale);

        // Use provided instanceId if available, otherwise find next available ID
        let instanceId;
        if (savedInstanceId !== null) {
            instanceId = savedInstanceId;
        } else {
            instanceId = instancedData.instances.size;
            // Make sure we don't reuse an existing ID
            while (instancedData.instances.has(instanceId)) {
                instanceId++;
            }
        }
        
        // Filter out any undefined meshes before processing
        const validMeshes = instancedData.meshes.filter(mesh => mesh !== undefined && mesh !== null);
        
        validMeshes.forEach(mesh => {
            const currentCapacity = mesh.instanceMatrix.count;
            if (instanceId >= currentCapacity - 1) {
                // expandInstancedMeshCapacity(modelUrl);
                // // Re-get the valid meshes as they might have been replaced
                // const updatedValidMeshes = instancedData.meshes.filter(m => m !== undefined && m !== null);
                // validMeshes.length = 0;
                // updatedValidMeshes.forEach(m => validMeshes.push(m));
                alert("Maximum Environment Objects Exceeded! Please clear the environment and try again.");
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
            matrix
        });

        return {
            modelUrl,
            instanceId,
            position,
            rotation,
            scale
        };
    };

    /// clears the environment, used when the user clears the environment via the map clear button
    /// not used anywhere else
    const clearEnvironments = () => {
        ///console.log("Clearing environments");

        // Clear all instances but keep mesh setup
        for (const instancedData of instancedMeshes.current.values()) {
            // Reset count on all meshes to 0
            instancedData.meshes.forEach(mesh => {
                mesh.count = 0;
                mesh.instanceMatrix.needsUpdate = true;
            });
            
            // Clear all instances from the Map
            instancedData.instances.clear();
        }

        updateLocalStorage();
    };

    const getRandomValue = (min, max) => {
        return Math.random() * (max - min) + min;
    };

    /// gets the placement transform, used to set the transform of an object when adding an object to the environment
    /// only used when adding an object to the environment, not when rebuilding the environment
    const getPlacementTransform = () => {
        const settings = placementSettingsRef.current;
        if (!settings) {
            console.warn('No placement settings provided');
            return {
                scale: new THREE.Vector3(1, 1, 1),
                rotation: new THREE.Euler(0, 0, 0)
            };
        }

        const scaleValue = settings.randomScale
            ? getRandomValue(settings.minScale, settings.maxScale)
            : settings.scale;
        
        const rotationDegrees = settings.randomRotation
            ? getRandomValue(settings.minRotation, settings.maxRotation)
            : settings.rotation;
        
        // Apply uniform scale to all axes
        return {
            scale: new THREE.Vector3(scaleValue, scaleValue, scaleValue),
            rotation: new THREE.Euler(0, rotationDegrees * Math.PI / 180, 0)
        };
    };

    /// places an object in the environment, used when adding an object to the environment
    /// and also when rebuilding the environment
    const placeEnvironmentModel = () => {
        if (!currentBlockType || !scene || !placeholderMeshRef.current) return;

        const modelData = environmentModels.find(model => model.id === currentBlockType.id);
        if (!modelData) {
            console.warn(`Could not find model with ID ${currentBlockType.id}`);
            return;
        }

        const modelUrl = modelData.modelUrl;
        let instancedData = instancedMeshes.current.get(modelUrl);
        if (!instancedData) {
            console.warn(`Could not find instanced data for model ${modelData.modelUrl}`);
            return;
        }

        // Get all placement positions based on current placement size
        const placementPositions = getPlacementPositions(placeholderMeshRef.current.position, placementSizeRef.current);
        const addedObjects = [];

        // Find the highest instance ID across ALL models
        let highestInstanceId = -1;
        for (const [_, data] of instancedMeshes.current) {
            if (data.instances.size > 0) {
                const maxId = Math.max(...Array.from(data.instances.keys()));
                highestInstanceId = Math.max(highestInstanceId, maxId);
            }
        }

        // Start from the next available ID
        let nextInstanceId = highestInstanceId + 1;

        // Check and expand capacity for all objects we're about to place
        const totalNeededInstances = nextInstanceId + placementPositions.length;
        const currentCapacity = instancedData.meshes[0]?.instanceMatrix.count || 0;
        
        if (totalNeededInstances > currentCapacity) {
            // // Expand to double what we need to reduce future expansions
            // const newCapacity = Math.max(totalNeededInstances * 2, currentCapacity * 2);
            // expandInstancedMeshCapacity(modelUrl, newCapacity);
            // // Re-fetch instancedData after expansion
            // instancedData = instancedMeshes.current.get(modelUrl);
            // if (!instancedData || !instancedData.meshes.length) {
            //     console.error('Failed to get expanded instanced data');
            //     return;
            // }

            alert("Maximum Environment Objects Exceeded! Please clear the environment and try again.");
            return;
        }

        // Place an object at each position
        placementPositions.forEach(placementPosition => {
            const instanceId = nextInstanceId++;
            
            // Use the transform stored in lastPreviewTransform.current
            const transform = getPlacementTransform();
            const position = new THREE.Vector3(placementPosition.x, placementPosition.y, placementPosition.z);

            const matrix = new THREE.Matrix4();
            matrix.compose(
                position,
                new THREE.Quaternion().setFromEuler(transform.rotation),
                transform.scale
            );

            // Process all meshes
            instancedData.meshes.forEach(mesh => {
                if (!mesh) {
                    console.error('Invalid mesh encountered');
                    return;
                }
                mesh.count = Math.max(mesh.count, instanceId + 1);
                mesh.setMatrixAt(instanceId, matrix);
                mesh.instanceMatrix.needsUpdate = true;
            });

            // Record the added object
            const newObject = {
                modelUrl,
                instanceId,
                position: { x: position.x, y: position.y, z: position.z },
                rotation: { x: transform.rotation.x, y: transform.rotation.y, z: transform.rotation.z },
                scale: { x: transform.scale.x, y: transform.scale.y, z: transform.scale.z },
            };
            addedObjects.push(newObject);

            // Save instance data
            instancedData.instances.set(instanceId, {
                position: position.clone(),
                rotation: transform.rotation.clone(),
                scale: transform.scale.clone(),
                matrix: matrix.clone()
            });
        });

        // Save all changes to undo state at once
        const changes = {
            terrain: { added: {}, removed: {} }, // no terrain changes
            environment: { added: addedObjects, removed: [] },
        };
        undoRedoManager.saveUndo(changes);

        // Save to DB, update UI counts
        updateLocalStorage();
        setTotalEnvironmentObjects(prev => prev + placementPositions.length);

        // Re-randomize for the next placement if needed
        if (placementSettingsRef.current?.randomScale || placementSettingsRef.current?.randomRotation) {
            const nextTransform = getPlacementTransform();
            lastPreviewTransform.current = nextTransform;

            // Update the preview mesh so the user sees the new transform right away
            placeholderMeshRef.current.scale.copy(nextTransform.scale);
            placeholderMeshRef.current.rotation.copy(nextTransform.rotation);
        }
        
        return addedObjects;
    };

    /// updates the local storage with the current environment
    /// used when adding an object to the environment
    const updateLocalStorage = () => {
        const allObjects = [];
        
        // Collect all instances from all models
        for (const [modelUrl, instancedData] of instancedMeshes.current) {
            // Find the corresponding model data to get the name
            const modelData = environmentModels.find(model => model.modelUrl === modelUrl);
            
            instancedData.instances.forEach((data, instanceId) => {
                allObjects.push({
                    modelUrl,
                    name: modelData?.name, // Add model name to saved data
                    instanceId,
                    position: data.position,
                    rotation: data.rotation,
                    scale: data.scale
                });
            });
        }

        DatabaseManager.saveData(STORES.ENVIRONMENT, 'current', allObjects);
        setTotalEnvironmentObjects(allObjects.length);
    };

    // /// expands the capacity of an instanced mesh, used when rebuilding the environment
    // /// and also when adding an object to the environment
    // const expandInstancedMeshCapacity = (modelUrl, newCapacity) => {
    //     const instancedData = instancedMeshes.current.get(modelUrl);
    //     if (!instancedData || !instancedData.meshes.length) return;
    
    //     const newMeshes = instancedData.meshes.map(oldMesh => {
    //         const newMesh = new THREE.InstancedMesh(
    //             oldMesh.geometry.clone(),
    //             oldMesh.material.clone(),
    //             newCapacity
    //         );
    
    //         // Copy properties
    //         newMesh.frustumCulled = oldMesh.frustumCulled;
    //         newMesh.renderOrder = oldMesh.renderOrder;
    
    //         // Copy existing instances explicitly by instanceId
    //         instancedData.instances.forEach((instanceData, instanceId) => {
    //             newMesh.setMatrixAt(instanceId, instanceData.matrix);
    //         });
    
    //         // Set count to highest instanceId + 1
    //         const highestInstanceId = Math.max(...instancedData.instances.keys(), -1);
    //         newMesh.count = highestInstanceId + 1;
    //         newMesh.instanceMatrix.needsUpdate = true;
    
    //         // Replace in scene
    //         scene.remove(oldMesh);
    //         scene.add(newMesh);
    
    //         // Clean up old mesh
    //         oldMesh.geometry.dispose();
    //         oldMesh.material.dispose();
    //         oldMesh.dispose();
    
    //         return newMesh;
    //     });
    
    //     // Update the instancedData with new meshes
    //     instancedData.meshes = newMeshes;
    //     instancedMeshes.current.set(modelUrl, instancedData);
    // };

    /// gets the placement positions, used when adding an object to the environment
    const getPlacementPositions = (centerPos, placementSize) => {
		const positions = [];

		// Always include center position
		positions.push({ ...centerPos });

		switch (placementSize) {
			default:
			case "single":
				break;

			case "cross":
				positions.push({ x: centerPos.x + 1, y: centerPos.y, z: centerPos.z }, { x: centerPos.x - 1, y: centerPos.y, z: centerPos.z }, { x: centerPos.x, y: centerPos.y, z: centerPos.z + 1 }, { x: centerPos.x, y: centerPos.y, z: centerPos.z - 1 });
				break;

			case "diamond":
				// 13-block diamond pattern
				positions.push(
					// Inner cardinal positions (4 blocks)
					{ x: centerPos.x + 1, y: centerPos.y, z: centerPos.z },
					{ x: centerPos.x - 1, y: centerPos.y, z: centerPos.z },
					{ x: centerPos.x, y: centerPos.y, z: centerPos.z + 1 },
					{ x: centerPos.x, y: centerPos.y, z: centerPos.z - 1 },
					// Middle diagonal positions (4 blocks)
					{ x: centerPos.x + 1, y: centerPos.y, z: centerPos.z + 1 },
					{ x: centerPos.x + 1, y: centerPos.y, z: centerPos.z - 1 },
					{ x: centerPos.x - 1, y: centerPos.y, z: centerPos.z + 1 },
					{ x: centerPos.x - 1, y: centerPos.y, z: centerPos.z - 1 },
					// Outer cardinal positions (4 blocks)
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
							// Skip center as it's already added
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
							// Skip center as it's already added
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

    /// removes an instance from the instanced mesh, used in rebuilding the environment
    /// and also when removing an object from the environment
    const removeInstance = (modelUrl, instanceId) => {
        const instancedData = instancedMeshes.current.get(modelUrl);
        if (!instancedData || !instancedData.instances.has(instanceId)) {
            console.warn(`Instance ${instanceId} not found for removal`);
            return;
        }

        // Get the object data before any modifications
        const objectData = instancedData.instances.get(instanceId);
        
        // Simply remove this instance - no moving of other instances
        instancedData.instances.delete(instanceId);
        
        // Clear the matrix at this instance ID
        instancedData.meshes.forEach(mesh => {
            mesh.setMatrixAt(instanceId, new THREE.Matrix4());
            // Update count to be the highest remaining instance ID + 1
            mesh.count = Math.max(...Array.from(instancedData.instances.keys()), -1) + 1;
            mesh.instanceMatrix.needsUpdate = true;
        });

        // Convert to plain object for undo/redo
        const removedObject = {
            modelUrl,
            instanceId, // Include the instanceId in removed object
            position: { x: objectData.position.x, y: objectData.position.y, z: objectData.position.z },
            rotation: { x: objectData.rotation.x, y: objectData.rotation.y, z: objectData.rotation.z },
            scale: { x: objectData.scale.x, y: objectData.scale.y, z: objectData.scale.z },
        };

        // Only save undo state if we're not in an undo/redo operation
        if (!isUndoRedoOperation.current) {
            const changes = {
                terrain: { added: {}, removed: {} },
                environment: { added: [], removed: [removedObject] },
            };
            undoRedoManager.saveUndo(changes);
        }

        // Always update storage
        updateLocalStorage();
    };

    const refreshEnvironmentFromDB = async () => {
        try {
            const savedEnv = await DatabaseManager.getData(STORES.ENVIRONMENT, "current");
            if (Array.isArray(savedEnv) && savedEnv.length > 0) {
                console.log(`Loading ${savedEnv.length} environment objects from database`);
                updateEnvironmentToMatch(savedEnv); 
            } else {
                console.log("No environment objects found in database");
                clearEnvironments();
            }
        } catch (error) {
            console.error("Error refreshing environment:", error);
        }
    };

    const updatePreviewPosition = (position) => {
        // 5) NO LONGER re-randomize scale/rotation here.
        //    Just move the preview to the new position.
        if (placeholderMeshRef.current && position) {
            placeholderMeshRef.current.position.copy(position.clone().add(positionOffset.current));
        }
    };

    const removePreview = () => {

        if (placeholderMeshRef.current) {
            // Remove from scene
            scene.remove(placeholderMeshRef.current);
            
            // Clean up materials to prevent memory leaks
            placeholderMeshRef.current.traverse((child) => {
                if (child.isMesh) {
                    if (child.material) {
                        // Dispose of materials
                        if (Array.isArray(child.material)) {
                            child.material.forEach(material => material.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                    // Dispose of geometries
                    if (child.geometry) {
                        child.geometry.dispose();
                    }
                }
            });

            // Clear the reference
            placeholderMeshRef.current = null;
            ///console.log('Preview model removed and cleaned up');
        }
    };

    /// used by blocktools for setting a static rotation value
    const rotatePreview = (angle) => {
        if (placeholderMeshRef.current) {
            placeholderMeshRef.current.rotation.y += angle;
        }
    };

    /// used by blocktools for setting a static scale value
    const setScale = (scale) => {
        setScale(scale);
        if (placeholderMeshRef.current) {
            placeholderMeshRef.current.scale.set(scale, scale, scale);
        }
    };

    // Update the setTotalEnvironmentObjects usage
    useEffect(() => {
        onTotalObjectsChange?.(totalEnvironmentObjects);
    }, [totalEnvironmentObjects, onTotalObjectsChange]);

    // Add initialization in useEffect
    useEffect(() => {
        if (scene) {
            preloadModels().catch(error => {
                console.error("Error in preloadModels:", error);
            });
        }
    }, [scene]);

    // use effect for setting up and removing preview
    useEffect(() => {
        if (currentBlockType?.isEnvironment) {
            setupPreview(previewPositionFromAppJS);
        } else if (placeholderMeshRef.current) {
            removePreview();
        }
    }, [currentBlockType]);

    // use effect for updating preview position
    useEffect(() => {
        if (previewPositionFromAppJS && currentBlockType?.isEnvironment) {
            updateModelPreview(previewPositionFromAppJS);
        }
    }, [previewPositionFromAppJS, currentBlockType]);

    // Add effect to update preview when settings change
    useEffect(() => {
        if (placeholderMeshRef.current && currentBlockType?.isEnvironment) {
            const transform = getPlacementTransform();
            
            // Apply transform only to the root mesh
            placeholderMeshRef.current.scale.copy(transform.scale);
            placeholderMeshRef.current.rotation.copy(transform.rotation);
        }
    }, [placementSettings]); // Watch for changes in placement settings
    
    // Add effect to track placementSize changes
    useEffect(() => {
        placementSizeRef.current = placementSize;
        // Update preview if it exists
        if (placeholderMeshRef.current && currentBlockType?.isEnvironment) {
            updateModelPreview(placeholderMeshRef.current.position.clone().sub(positionOffset.current));
        }
    }, [placementSize]);

    // Make sure to keep the ref synced with the latest prop:
    // This runs whenever the prop changes, ensuring our ref has fresh data.
    useEffect(() => {
        placementSettingsRef.current = placementSettings;
    }, [placementSettings]);

    // Let UndoRedoManager explicitly set isUndoRedoOperation:
    const beginUndoRedoOperation = () => {
        isUndoRedoOperation.current = true;
    };
    const endUndoRedoOperation = () => {
        isUndoRedoOperation.current = false;
    };

    useImperativeHandle(ref, () => ({
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
    }), [scene, currentBlockType, placeholderMeshRef.current]);

    // Return null since this component doesn't need to render anything visible
    return null;
};

export default forwardRef(EnvironmentBuilder);
