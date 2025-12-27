import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import BlockTypeRegistryModule from "../blocks/BlockTypeRegistry";

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

function _loadTexture(
    path: string | undefined | null
): Promise<THREE.Texture | null> {
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
                console.warn(
                    `ComponentToEntityConverter – failed to load texture ${normalized}`
                );
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

// Face definitions for cube geometry - matching THREE.js BoxGeometry face order
// Face order: +X (right), -X (left), +Y (top), -Y (bottom), +Z (front), -Z (back)
type FaceName = "right" | "left" | "top" | "bottom" | "front" | "back";

interface FaceDefinition {
    name: FaceName;
    normal: [number, number, number];
    // Vertices in counter-clockwise order when viewed from outside
    vertices: [number, number, number][];
    uvs: [number, number][];
}

const FACE_DEFINITIONS: FaceDefinition[] = [
    {
        name: "right", // +X
        normal: [1, 0, 0],
        vertices: [
            [1, 0, 1],
            [1, 1, 1],
            [1, 1, 0],
            [1, 0, 0],
        ],
        uvs: [
            [0, 0],
            [0, 1],
            [1, 1],
            [1, 0],
        ],
    },
    {
        name: "left", // -X
        normal: [-1, 0, 0],
        vertices: [
            [0, 0, 0],
            [0, 1, 0],
            [0, 1, 1],
            [0, 0, 1],
        ],
        uvs: [
            [0, 0],
            [0, 1],
            [1, 1],
            [1, 0],
        ],
    },
    {
        name: "top", // +Y
        normal: [0, 1, 0],
        vertices: [
            [0, 1, 0],
            [1, 1, 0],
            [1, 1, 1],
            [0, 1, 1],
        ],
        uvs: [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
        ],
    },
    {
        name: "bottom", // -Y
        normal: [0, -1, 0],
        vertices: [
            [0, 0, 1],
            [1, 0, 1],
            [1, 0, 0],
            [0, 0, 0],
        ],
        uvs: [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
        ],
    },
    {
        name: "front", // +Z
        normal: [0, 0, 1],
        vertices: [
            [0, 0, 1],
            [0, 1, 1],
            [1, 1, 1],
            [1, 0, 1],
        ],
        uvs: [
            [0, 0],
            [0, 1],
            [1, 1],
            [1, 0],
        ],
    },
    {
        name: "back", // -Z
        normal: [0, 0, -1],
        vertices: [
            [1, 0, 0],
            [1, 1, 0],
            [0, 1, 0],
            [0, 0, 0],
        ],
        uvs: [
            [0, 0],
            [0, 1],
            [1, 1],
            [1, 0],
        ],
    },
];

function _getFaceTexturePaths(blockId: number): FacePaths | null {
    if (!BlockTypeRegistry?.instance) return null;

    try {
        const blockType = BlockTypeRegistry.instance.getBlockType?.(blockId);
        if (!blockType) return null;

        const textureUris = blockType.textureUris || {};

        const _pick = (
            ...candidates: (string | undefined | null)[]
        ): string | null => {
            for (const c of candidates) {
                if (c) return c;
            }
            return null;
        };

        return {
            right: _pick(
                textureUris.right,
                textureUris.all,
                textureUris.default
            ),
            left: _pick(textureUris.left, textureUris.all, textureUris.default),
            top: _pick(textureUris.top, textureUris.all, textureUris.default),
            bottom: _pick(
                textureUris.bottom,
                textureUris.all,
                textureUris.default
            ),
            front: _pick(
                textureUris.front,
                textureUris.all,
                textureUris.default
            ),
            back: _pick(textureUris.back, textureUris.all, textureUris.default),
        };
    } catch (err) {
        console.warn(
            `ComponentToEntityConverter – error resolving textures for block ${blockId}:`,
            err
        );
        return null;
    }
}

/**
 * Create a material key for grouping blocks with identical materials
 */
function getMaterialKey(facePaths: FacePaths | null, blockId: number): string {
    if (facePaths) {
        return `tex_${JSON.stringify(facePaths)}`;
    }
    return `color_${blockId}`;
}

/**
 * Build a single face geometry with proper UVs
 */
function buildFaceGeometry(
    face: FaceDefinition,
    offsetX: number,
    offsetY: number,
    offsetZ: number
): THREE.BufferGeometry {
    const positions = new Float32Array(12); // 4 vertices * 3 components
    const normals = new Float32Array(12);
    const uvs = new Float32Array(8); // 4 vertices * 2 components
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]); // Two triangles

    for (let i = 0; i < 4; i++) {
        const [vx, vy, vz] = face.vertices[i];
        positions[i * 3] = vx + offsetX - 0.5;
        positions[i * 3 + 1] = vy + offsetY - 0.5;
        positions[i * 3 + 2] = vz + offsetZ - 0.5;

        normals[i * 3] = face.normal[0];
        normals[i * 3 + 1] = face.normal[1];
        normals[i * 3 + 2] = face.normal[2];

        uvs[i * 2] = face.uvs[i][0];
        uvs[i * 2 + 1] = face.uvs[i][1];
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    return geometry;
}

/**
 * Convert a component schematic (blocks + entities) into a GLTF model
 *
 * Optimizations applied:
 * 1. Face culling - only renders exposed faces (not adjacent to other blocks)
 * 2. Material grouping - groups all faces with same texture/color
 * 3. Geometry merging - merges all faces per material into single draw call
 */
export async function convertComponentToGLTF(
    schematic: ComponentSchematic,
    componentName: string
): Promise<ConversionResult> {
    try {
        const blocks = schematic.blocks || {};
        const blockKeys = Object.keys(blocks);

        if (blockKeys.length === 0) {
            return {
                success: false,
                error: "Component has no blocks to convert",
            };
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

        // Calculate bounds for centering
        let minX = Infinity,
            minY = Infinity,
            minZ = Infinity;
        let maxX = -Infinity,
            maxY = -Infinity,
            maxZ = -Infinity;

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

        // Group geometries by material+face for merging
        // Key format: "materialKey_faceName" for textured, or just "materialKey" for single color
        interface GeometryGroup {
            geometries: THREE.BufferGeometry[];
            material: THREE.Material;
        }
        const geometryGroups = new Map<string, GeometryGroup>();

        // Track statistics for logging
        let totalFaces = 0;

        // Process each block
        blockKeys.forEach((coordStr) => {
            const blockId = blocks[coordStr];
            const [x, y, z] = coordStr.split(",").map(Number);
            const facePaths = _getFaceTexturePaths(blockId);
            const materialKey = getMaterialKey(facePaths, blockId);

            // Offset position for centering
            const offsetX = x - centreX;
            const offsetY = y - centreY;
            const offsetZ = z - centreZ;

            // Process each face - render ALL faces, no culling
            // Each block should be a complete cube for proper display from any angle
            FACE_DEFINITIONS.forEach((face) => {
                totalFaces++;

                // Build the face geometry
                const faceGeometry = buildFaceGeometry(
                    face,
                    offsetX,
                    offsetY,
                    offsetZ
                );

                // Get or create material for this face
                let groupKey: string;
                let material: THREE.Material;

                if (facePaths) {
                    // Textured block - each face may have different texture
                    const texturePath = facePaths[face.name];
                    groupKey = `${materialKey}_${face.name}`;

                    if (!geometryGroups.has(groupKey)) {
                        const texture = texturePath
                            ? loadedTextures.get(texturePath)
                            : null;
                        if (texture) {
                            material = new THREE.MeshStandardMaterial({
                                map: texture.clone(),
                                transparent: true,
                                alphaTest: 0.1,
                                side: THREE.DoubleSide, // Render both sides
                            });
                            if ((material as THREE.MeshStandardMaterial).map) {
                                (
                                    material as THREE.MeshStandardMaterial
                                ).map!.flipY = false;
                            }
                        } else {
                            material = new THREE.MeshStandardMaterial({
                                color: colourFromBlockId(blockId),
                                side: THREE.DoubleSide, // Render both sides
                            });
                        }
                        geometryGroups.set(groupKey, {
                            geometries: [],
                            material,
                        });
                    }
                } else {
                    // Color-only block - same material for all faces
                    groupKey = materialKey;

                    if (!geometryGroups.has(groupKey)) {
                        material = new THREE.MeshStandardMaterial({
                            color: colourFromBlockId(blockId),
                            side: THREE.DoubleSide, // Render both sides
                        });
                        geometryGroups.set(groupKey, {
                            geometries: [],
                            material,
                        });
                    }
                }

                geometryGroups.get(groupKey)!.geometries.push(faceGeometry);
            });
        });

        console.log(
            `[ComponentToEntityConverter] Stats: ${blockKeys.length} blocks, ` +
                `${totalFaces} faces, ${geometryGroups.size} draw calls (merged by material)`
        );

        // Create the main group for export
        const mainGroup = new THREE.Group();
        mainGroup.name = componentName;

        // Merge geometries per material group and create meshes
        let meshIndex = 0;
        for (const [groupKey, group] of geometryGroups.entries()) {
            if (group.geometries.length === 0) continue;

            // Merge all geometries in this group into one
            const mergedGeometry =
                group.geometries.length === 1
                    ? group.geometries[0]
                    : mergeGeometries(group.geometries, false);

            if (!mergedGeometry) {
                console.warn(
                    `[ComponentToEntityConverter] Failed to merge geometries for group ${groupKey}`
                );
                continue;
            }

            // Compute bounds for proper rendering
            mergedGeometry.computeBoundingBox();
            mergedGeometry.computeBoundingSphere();

            const mesh = new THREE.Mesh(mergedGeometry, group.material);
            mesh.name = `merged_${meshIndex++}`;
            mainGroup.add(mesh);

            // Dispose individual geometries if they were merged
            if (group.geometries.length > 1) {
                group.geometries.forEach((g) => g.dispose());
            }
        }

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
                    resolve({
                        success: false,
                        error: error.message || "Failed to export GLTF",
                    });
                },
                {
                    binary: false, // Use JSON GLTF for better compatibility
                    embedImages: true,
                }
            );
        });
    } catch (error) {
        console.error("ComponentToEntityConverter error:", error);
        return {
            success: false,
            error:
                (error as Error).message || "Unknown error during conversion",
        };
    }
}

export default convertComponentToGLTF;
