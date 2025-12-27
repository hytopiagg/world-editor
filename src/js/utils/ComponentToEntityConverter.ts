import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter";
import BlockTypeRegistryModule from "../blocks/BlockTypeRegistry";

interface BlockFaceTextures {
    right?: string;
    left?: string;
    top?: string;
    bottom?: string;
    front?: string;
    back?: string;
    all?: string;
    default?: string;
    [key: string]: string | undefined;
}

interface ComponentEntity {
    entityName: string;
    position: [number, number, number];
    rotation?: [number, number, number];
}

interface ComponentSchematic {
    blocks?: Record<string, number>;
    entities?: ComponentEntity[];
    min?: { x: number; y: number; z: number };
}

interface ConversionResult {
    success: boolean;
    data?: ArrayBuffer;
    error?: string;
}

const BlockTypeRegistry = BlockTypeRegistryModule || null;

const _textureLoader = new THREE.TextureLoader();
const _textureCache = new Map<string, Promise<THREE.Texture | null>>();

function _normalizePath(path: string): string {
    if (!path) return path as unknown as string;
    if (path.startsWith("data:")) return path;
    if (path.startsWith("/assets/")) return `.${path}`;
    if (path.startsWith("assets/")) return `./${path}`;
    return path;
}

function _loadTexture(path: string | undefined | null): Promise<THREE.Texture | null> {
    if (!path) return Promise.resolve(null);
    const normalized = _normalizePath(path);

    if (_textureCache.has(normalized)) return _textureCache.get(normalized)!;

    const p = new Promise<THREE.Texture | null>((resolve) => {
        _textureLoader.load(
            normalized,
            (texture: THREE.Texture) => {
                texture.minFilter = THREE.LinearMipMapLinearFilter;
                texture.magFilter = THREE.NearestFilter;
                // Ensure texture is flipped correctly for GLTF export
                texture.flipY = false;
                resolve(texture);
            },
            undefined,
            () => {
                console.warn(`ComponentToEntityConverter – failed to load texture ${normalized}`);
                resolve(null);
            }
        );
    });
    _textureCache.set(normalized, p);
    return p;
}

function colourFromBlockId(blockId: number): number {
    const hashed = (blockId * 2654435761) >>> 0;
    return hashed & 0xffffff;
}

interface FacePaths {
    right: string | null;
    left: string | null;
    top: string | null;
    bottom: string | null;
    front: string | null;
    back: string | null;
}

function _getFaceTexturePaths(blockId: number): FacePaths | null {
    if (!BlockTypeRegistry?.instance) return null;

    try {
        const blockType = BlockTypeRegistry.instance.getBlockType?.(blockId);
        if (!blockType) return null;

        const textureUris = blockType.textureUris || {};

        const _pick = (...candidates: (string | undefined | null)[]): string | null => {
            for (const c of candidates) {
                if (c) return c;
            }
            return null;
        };

        return {
            right: _pick(textureUris.right, textureUris.all, textureUris.default),
            left: _pick(textureUris.left, textureUris.all, textureUris.default),
            top: _pick(textureUris.top, textureUris.all, textureUris.default),
            bottom: _pick(textureUris.bottom, textureUris.all, textureUris.default),
            front: _pick(textureUris.front, textureUris.all, textureUris.default),
            back: _pick(textureUris.back, textureUris.all, textureUris.default),
        };
    } catch (err) {
        console.warn(`ComponentToEntityConverter – error resolving textures for block ${blockId}:`, err);
        return null;
    }
}

/**
 * Convert a component schematic (blocks + entities) into a GLTF model
 */
export async function convertComponentToGLTF(
    schematic: ComponentSchematic,
    componentName: string
): Promise<ConversionResult> {
    try {
        const blocks = schematic.blocks || {};
        const blockKeys = Object.keys(blocks);

        if (blockKeys.length === 0) {
            return { success: false, error: "Component has no blocks to convert" };
        }

        // Initialize BlockTypeRegistry if available
        if (BlockTypeRegistry?.instance?.initialize) {
            await BlockTypeRegistry.instance.initialize();
        }

        // Load all required textures
        const loadedTextures = new Map<string, THREE.Texture | null>();
        const texturePathsToLoad = new Set<string>();

        Object.values(blocks).forEach((blockId) => {
            const facePaths = _getFaceTexturePaths(blockId);
            if (facePaths) {
                Object.values(facePaths).forEach((p) => {
                    if (p) texturePathsToLoad.add(p);
                });
            }
        });

        const loadPromises = Array.from(texturePathsToLoad).map((path) =>
            _loadTexture(path).then((tex) => {
                if (path) loadedTextures.set(path, tex);
            })
        );
        await Promise.all(loadPromises);

        // Calculate bounds
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        blockKeys.forEach((coordStr) => {
            const [x, y, z] = coordStr.split(",").map(Number);
            minX = Math.min(x, minX);
            minY = Math.min(y, minY);
            minZ = Math.min(z, minZ);
            maxX = Math.max(x, maxX);
            maxY = Math.max(y, maxY);
            maxZ = Math.max(z, maxZ);
        });

        // Center offset - blocks will be centered around origin
        const centreX = (minX + maxX) / 2;
        const centreY = minY; // Keep bottom at y=0
        const centreZ = (minZ + maxZ) / 2;

        // Create the main group for export
        const mainGroup = new THREE.Group();
        mainGroup.name = componentName;

        // Group blocks by their material configuration for efficient meshing
        interface InstanceGroup {
            type: "textured" | "color";
            positions: THREE.Vector3[];
            blockId: number;
            facePaths?: FacePaths | null;
        }
        const instanceGroups = new Map<string, InstanceGroup>();

        blockKeys.forEach((coordStr) => {
            const blockId = blocks[coordStr];
            const [x, y, z] = coordStr.split(",").map(Number);

            let groupKey: string;
            let currentFacePaths: FacePaths | null = null;

            if (BlockTypeRegistry?.instance) {
                currentFacePaths = _getFaceTexturePaths(blockId);
                if (currentFacePaths) {
                    groupKey = "textured_" + JSON.stringify(Object.values(currentFacePaths).sort());
                    if (!instanceGroups.has(groupKey)) {
                        instanceGroups.set(groupKey, {
                            type: "textured",
                            facePaths: currentFacePaths,
                            blockId,
                            positions: [],
                        });
                    }
                } else {
                    groupKey = "color_" + blockId;
                    if (!instanceGroups.has(groupKey)) {
                        instanceGroups.set(groupKey, {
                            type: "color",
                            blockId,
                            positions: [],
                        });
                    }
                }
            } else {
                groupKey = "color_" + blockId;
                if (!instanceGroups.has(groupKey)) {
                    instanceGroups.set(groupKey, {
                        type: "color",
                        blockId,
                        positions: [],
                    });
                }
            }

            instanceGroups.get(groupKey)!.positions.push(
                new THREE.Vector3(x - centreX, y - centreY, z - centreZ)
            );
        });

        // Create merged geometry for each group
        const sharedBoxGeometry = new THREE.BoxGeometry(1, 1, 1);

        instanceGroups.forEach((group, groupKey) => {
            if (group.positions.length === 0) return;

            let materials: THREE.Material[];

            if (group.type === "textured" && group.facePaths) {
                const faceOrder = [
                    group.facePaths.right,
                    group.facePaths.left,
                    group.facePaths.top,
                    group.facePaths.bottom,
                    group.facePaths.front,
                    group.facePaths.back,
                ];
                materials = faceOrder.map((path) => {
                    const texture = path ? loadedTextures.get(path) : null;
                    if (texture) {
                        const mat = new THREE.MeshStandardMaterial({
                            map: texture.clone(),
                            transparent: true,
                            alphaTest: 0.1,
                        });
                        // Ensure texture is properly configured for GLTF
                        if (mat.map) {
                            mat.map.flipY = false;
                        }
                        return mat;
                    }
                    return new THREE.MeshStandardMaterial({
                        color: colourFromBlockId(group.blockId),
                    });
                });
            } else {
                const colorMaterial = new THREE.MeshStandardMaterial({
                    color: colourFromBlockId(group.blockId),
                });
                materials = [colorMaterial, colorMaterial, colorMaterial, colorMaterial, colorMaterial, colorMaterial];
            }

            // Create individual meshes for each position and merge them
            const geometries: THREE.BufferGeometry[] = [];

            group.positions.forEach((pos) => {
                const geom = sharedBoxGeometry.clone();
                geom.translate(pos.x, pos.y, pos.z);
                geometries.push(geom);
            });

            // Create a mesh for each face material with all positions
            // For simplicity, we'll create individual box meshes per position
            group.positions.forEach((pos, idx) => {
                const mesh = new THREE.Mesh(sharedBoxGeometry.clone(), materials);
                mesh.position.set(pos.x, pos.y, pos.z);
                mesh.name = `block_${groupKey}_${idx}`;
                mainGroup.add(mesh);
            });
        });

        // Clean up geometries
        sharedBoxGeometry.dispose();

        // Export to GLTF
        const exporter = new GLTFExporter();
        
        return new Promise((resolve) => {
            exporter.parse(
                mainGroup,
                (gltf) => {
                    let arrayBuffer: ArrayBuffer;
                    
                    if (gltf instanceof ArrayBuffer) {
                        arrayBuffer = gltf;
                    } else {
                        // It's a JSON object, convert to string then to ArrayBuffer
                        const jsonString = JSON.stringify(gltf);
                        const encoder = new TextEncoder();
                        arrayBuffer = encoder.encode(jsonString).buffer;
                    }

                    // Dispose of materials and textures
                    mainGroup.traverse((child) => {
                        if ((child as THREE.Mesh).isMesh) {
                            const mesh = child as THREE.Mesh;
                            if (Array.isArray(mesh.material)) {
                                mesh.material.forEach((m) => m.dispose());
                            } else {
                                mesh.material.dispose();
                            }
                            mesh.geometry.dispose();
                        }
                    });

                    _textureCache.clear();

                    resolve({ success: true, data: arrayBuffer });
                },
                (error) => {
                    console.error("GLTF export error:", error);
                    resolve({ success: false, error: error.message || "Failed to export GLTF" });
                },
                {
                    binary: false, // Use JSON GLTF for better compatibility
                    embedImages: true,
                }
            );
        });
    } catch (error) {
        console.error("ComponentToEntityConverter error:", error);
        return { success: false, error: (error as Error).message || "Unknown error during conversion" };
    }
}

export default convertComponentToGLTF;

