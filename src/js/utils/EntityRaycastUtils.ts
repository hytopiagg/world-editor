import * as THREE from "three";
import { environmentModels } from "../EnvironmentBuilder";

export interface EntityRaycastResult {
    entity: {
        modelUrl: string;
        instanceId: number;
        name: string;
        position: THREE.Vector3;
        rotation: THREE.Euler;
        scale: THREE.Vector3;
    };
    distance: number;
    point: THREE.Vector3;
    normal?: THREE.Vector3;
}

/**
 * Raycast against environment object instances
 * @param raycaster - Three.js raycaster
 * @param environmentBuilderRef - Reference to EnvironmentBuilder instance
 * @param maxDistance - Maximum raycast distance
 * @returns Closest entity intersection or null
 */
export function raycastEntities(
    raycaster: THREE.Raycaster,
    environmentBuilderRef: React.RefObject<any>,
    maxDistance: number = 100
): EntityRaycastResult | null {
    if (!raycaster || !environmentBuilderRef?.current) {
        return null;
    }

    const environmentBuilder = environmentBuilderRef.current;
    
    // Get all instanced meshes from EnvironmentBuilder
    // We need to access the internal instancedMeshes ref
    // This will require exposing a method or accessing via ref
    
    // For now, we'll use getAllEnvironmentObjects and create bounding boxes
    // A more efficient approach would be to raycast directly against instanced meshes
    const allObjects = environmentBuilder.getAllEnvironmentObjects();
    
    if (!allObjects || allObjects.length === 0) {
        return null;
    }

    let closestIntersection: EntityRaycastResult | null = null;
    let closestDistance = Infinity;

    // Iterate through all entities and test bounding box intersections
    for (const obj of allObjects) {
        const model = environmentModels.find(m => m.modelUrl === obj.modelUrl);
        if (!model) continue;

        // Get bounding box dimensions
        const bboxWidth = model.boundingBoxWidth || 1;
        const bboxHeight = model.boundingBoxHeight || 1;
        const bboxDepth = model.boundingBoxDepth || 1;
        const bboxCenter = model.boundingBoxCenter || new THREE.Vector3(0, 0, 0);

        // Create entity position vector
        const entityPos = new THREE.Vector3(
            obj.position.x,
            obj.position.y,
            obj.position.z
        );

        // Get entity rotation and scale
        const entityRotation = new THREE.Euler(
            obj.rotation.x,
            obj.rotation.y,
            obj.rotation.z
        );
        const entityScale = new THREE.Vector3(
            obj.scale.x,
            obj.scale.y,
            obj.scale.z
        );

        // Apply entity scale to bounding box dimensions
        const scaledWidth = bboxWidth * entityScale.x;
        const scaledHeight = bboxHeight * entityScale.y;
        const scaledDepth = bboxDepth * entityScale.z;

        // Apply entity rotation to bounding box center offset (matching visual bounding box)
        const scaledBboxCenter = bboxCenter.clone().multiply(entityScale);
        const rotatedOffset = scaledBboxCenter.clone().applyEuler(entityRotation);
        const worldCenter = entityPos.clone().add(rotatedOffset);

        // Transform ray into entity-local space (inverse rotation) for OBB intersection
        const quaternion = new THREE.Quaternion().setFromEuler(entityRotation);
        const inverseQuaternion = quaternion.clone().invert();

        const localRayOrigin = raycaster.ray.origin.clone().sub(worldCenter).applyQuaternion(inverseQuaternion);
        const localRayDirection = raycaster.ray.direction.clone().applyQuaternion(inverseQuaternion);
        const localRay = new THREE.Ray(localRayOrigin, localRayDirection);

        // Create local AABB centered at origin with scaled dimensions
        const halfExtents = new THREE.Vector3(scaledWidth / 2, scaledHeight / 2, scaledDepth / 2);
        const localBox = new THREE.Box3(
            halfExtents.clone().negate(),
            halfExtents
        );

        // Test ray intersection in local space
        const localIntersectionPoint = new THREE.Vector3();
        const intersection = localRay.intersectBox(localBox, localIntersectionPoint);

        if (intersection) {
            // Transform intersection point back to world space
            const worldIntersectionPoint = localIntersectionPoint.clone()
                .applyQuaternion(quaternion)
                .add(worldCenter);

            const distance = raycaster.ray.origin.distanceTo(worldIntersectionPoint);

            if (distance < maxDistance && distance < closestDistance) {
                closestDistance = distance;
                closestIntersection = {
                    entity: {
                        modelUrl: obj.modelUrl,
                        instanceId: obj.instanceId,
                        name: obj.name,
                        position: entityPos.clone(),
                        rotation: entityRotation,
                        scale: entityScale,
                    },
                    distance: distance,
                    point: worldIntersectionPoint.clone(),
                };
            }
        }
    }

    return closestIntersection;
}

/**
 * More accurate raycast using instanced mesh geometry
 * This requires access to the actual InstancedMesh objects
 */
export function raycastEntitiesAccurate(
    raycaster: THREE.Raycaster,
    instancedMeshes: Map<string, any>,
    maxDistance: number = 100
): EntityRaycastResult | null {
    if (!raycaster || !instancedMeshes) {
        return null;
    }

    let closestIntersection: EntityRaycastResult | null = null;
    let closestDistance = Infinity;

    // Iterate through all instanced mesh groups
    for (const [modelUrl, instancedData] of instancedMeshes.entries()) {
        if (!instancedData.meshes || !instancedData.instances) {
            continue;
        }

        const meshes = instancedData.meshes as THREE.InstancedMesh[];
        const instances = instancedData.instances as Map<number, any>;

        // Test each instanced mesh
        for (const mesh of meshes) {
            if (!mesh.geometry || mesh.count === 0) continue;

            // Create a temporary raycaster that tests against this instanced mesh
            const intersections: THREE.Intersection[] = [];
            
            // Three.js InstancedMesh raycasting requires checking each instance
            // We'll iterate through visible instances and test bounding boxes
            for (const [instanceId, instanceData] of instances.entries()) {
                if (instanceData.isVisible === false) continue;

                const position = instanceData.position as THREE.Vector3;
                const rotation = instanceData.rotation as THREE.Euler;
                const scale = instanceData.scale as THREE.Vector3;

                // Create bounding box for this instance
                const bbox = new THREE.Box3();
                mesh.geometry.computeBoundingBox();
                if (mesh.geometry.boundingBox) {
                    const localBox = mesh.geometry.boundingBox.clone();
                    
                    // Transform bounding box to instance space
                    const matrix = new THREE.Matrix4();
                    matrix.compose(position, new THREE.Quaternion().setFromEuler(rotation), scale);
                    
                    localBox.applyMatrix4(matrix);
                    
                    // Test intersection
                    const intersectionPoint = new THREE.Vector3();
                    const hit = raycaster.ray.intersectBox(localBox, intersectionPoint);
                    
                    if (hit) {
                        const distance = raycaster.ray.origin.distanceTo(intersectionPoint);
                        
                        if (distance < maxDistance && distance < closestDistance) {
                            const modelName = modelUrl.split("/").pop()?.split(".")[0] || "unknown";
                            
                            closestDistance = distance;
                            closestIntersection = {
                                entity: {
                                    modelUrl: modelUrl,
                                    instanceId: instanceId,
                                    name: modelName,
                                    position: position.clone(),
                                    rotation: rotation.clone(),
                                    scale: scale.clone(),
                                },
                                distance: distance,
                                point: intersectionPoint.clone(),
                            };
                        }
                    }
                }
            }
        }
    }

    return closestIntersection;
}

