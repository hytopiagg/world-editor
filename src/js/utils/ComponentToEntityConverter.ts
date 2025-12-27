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

/**
 * Convert a hex color number to RGB components
 */
function hexToRgb(hex: number): { r: number; g: number; b: number } {
    return {
        r: (hex >> 16) & 0xff,
        g: (hex >> 8) & 0xff,
        b: hex & 0xff,
    };
}

/**
 * Atlas entry containing UV mapping information for a texture/color in the atlas
 */
interface AtlasEntry {
    u: number; // UV offset X (0-1)
    v: number; // UV offset Y (0-1)
    sizeU: number; // UV width (0-1)
    sizeV: number; // UV height (0-1)
}

/**
 * Result of building a texture atlas
 */
interface AtlasResult {
    atlasTexture: THREE.CanvasTexture;
    uvMap: Map<string, AtlasEntry>; // Key is texture path or "color_<hex>"
}

/**
 * Build a texture atlas combining all textures and baked colors into a single image
 */
async function buildTextureAtlas(
    loadedTextures: Map<string, THREE.Texture | null>,
    colorsUsed: Set<number>
): Promise<AtlasResult> {
    const TILE_SIZE = 16; // Size of each tile in the atlas
    const uvMap = new Map<string, AtlasEntry>();

    // Collect all valid textures and colors
    const textureEntries: { key: string; texture: THREE.Texture }[] = [];
    const colorEntries: { key: string; color: number }[] = [];

    for (const [path, texture] of loadedTextures.entries()) {
        if (texture) {
            textureEntries.push({ key: path, texture });
        }
    }

    for (const color of colorsUsed) {
        colorEntries.push({ key: `color_${color}`, color });
    }

    const totalEntries = textureEntries.length + colorEntries.length;

    if (totalEntries === 0) {
        // Create a minimal white atlas
        const canvas = document.createElement("canvas");
        canvas.width = TILE_SIZE;
        canvas.height = TILE_SIZE;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
        const atlasTexture = new THREE.CanvasTexture(canvas);
        atlasTexture.flipY = false;
        atlasTexture.magFilter = THREE.NearestFilter;
        atlasTexture.minFilter = THREE.NearestFilter;
        return { atlasTexture, uvMap };
    }

    // Calculate grid dimensions (square-ish layout)
    const cols = Math.ceil(Math.sqrt(totalEntries));
    const rows = Math.ceil(totalEntries / cols);

    // Calculate atlas size (power of 2 for better GPU compatibility)
    const atlasWidth = Math.pow(2, Math.ceil(Math.log2(cols * TILE_SIZE)));
    const atlasHeight = Math.pow(2, Math.ceil(Math.log2(rows * TILE_SIZE)));

    // Create canvas for the atlas
    const canvas = document.createElement("canvas");
    canvas.width = atlasWidth;
    canvas.height = atlasHeight;
    const ctx = canvas.getContext("2d")!;

    // Fill with transparent background
    ctx.clearRect(0, 0, atlasWidth, atlasHeight);

    let currentIndex = 0;

    // Draw textures into the atlas
    for (const { key, texture } of textureEntries) {
        const col = currentIndex % cols;
        const row = Math.floor(currentIndex / cols);
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;

        // Get the texture's image data
        if (texture.image) {
            try {
                ctx.drawImage(texture.image, x, y, TILE_SIZE, TILE_SIZE);
            } catch (e) {
                // If drawing fails, fill with a placeholder color
                ctx.fillStyle = "#ff00ff";
                ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
            }
        } else {
            // Placeholder for missing texture
            ctx.fillStyle = "#ff00ff";
            ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        }

        // Store UV mapping
        uvMap.set(key, {
            u: x / atlasWidth,
            v: y / atlasHeight,
            sizeU: TILE_SIZE / atlasWidth,
            sizeV: TILE_SIZE / atlasHeight,
        });

        currentIndex++;
    }

    // Draw baked colors into the atlas
    for (const { key, color } of colorEntries) {
        const col = currentIndex % cols;
        const row = Math.floor(currentIndex / cols);
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;

        const rgb = hexToRgb(color);
        ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

        // Store UV mapping
        uvMap.set(key, {
            u: x / atlasWidth,
            v: y / atlasHeight,
            sizeU: TILE_SIZE / atlasWidth,
            sizeV: TILE_SIZE / atlasHeight,
        });

        currentIndex++;
    }

    // Create THREE.js texture from canvas
    const atlasTexture = new THREE.CanvasTexture(canvas);
    atlasTexture.flipY = false;
    atlasTexture.magFilter = THREE.NearestFilter;
    atlasTexture.minFilter = THREE.NearestFilter;
    atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
    atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
    atlasTexture.needsUpdate = true;

    console.log(
        `[ComponentToEntityConverter] Atlas created: ${atlasWidth}x${atlasHeight}, ` +
            `${textureEntries.length} textures + ${colorEntries.length} colors = ${totalEntries} tiles`
    );

    return { atlasTexture, uvMap };
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
 * Build a single face geometry with UVs remapped to atlas coordinates
 */
function buildFaceGeometry(
    face: FaceDefinition,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
    atlasEntry: AtlasEntry
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

        // Remap UVs from [0,1] to atlas sub-region
        uvs[i * 2] = atlasEntry.u + face.uvs[i][0] * atlasEntry.sizeU;
        uvs[i * 2 + 1] = atlasEntry.v + face.uvs[i][1] * atlasEntry.sizeV;
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
 * 1. Texture atlas - combines all textures and colors into single image
 * 2. Single material - one draw call for the entire component
 * 3. Geometry merging - all faces merged into single mesh
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

        // ========== PASS 1: Collect all unique textures and colors ==========
        const loadedTextures = new Map<string, THREE.Texture | null>();
        const texturePathsToLoad = new Set<string>();
        const colorsUsed = new Set<number>();

        // Track which texture/color each block face uses
        const blockFaceInfo = new Map<
            string,
            { facePaths: FacePaths | null; blockId: number }
        >();

        Object.entries(blocks).forEach(([coordStr, blockId]) => {
            const facePaths = _getFaceTexturePaths(blockId);
            blockFaceInfo.set(coordStr, { facePaths, blockId });

            if (facePaths) {
                // Collect texture paths
                Object.values(facePaths).forEach((p) => {
                    if (p) texturePathsToLoad.add(p);
                });
            } else {
                // Collect color for color-only blocks
                colorsUsed.add(colourFromBlockId(blockId));
            }
        });

        // Load all textures
        const loadPromises = Array.from(texturePathsToLoad).map((path) =>
            _loadTexture(path).then((tex) => {
                if (path) loadedTextures.set(path, tex);
            })
        );
        await Promise.all(loadPromises);

        // Also check for textures that failed to load - they need fallback colors
        for (const [, info] of blockFaceInfo.entries()) {
            if (info.facePaths) {
                for (const faceName of Object.keys(
                    info.facePaths
                ) as FaceName[]) {
                    const texPath = info.facePaths[faceName];
                    if (texPath && !loadedTextures.get(texPath)) {
                        // Texture failed to load, add fallback color
                        colorsUsed.add(colourFromBlockId(info.blockId));
                    }
                }
            }
        }

        // ========== Build texture atlas ==========
        const { atlasTexture, uvMap } = await buildTextureAtlas(
            loadedTextures,
            colorsUsed
        );

        // ========== Calculate bounds for centering ==========
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

        // ========== PASS 2: Build all face geometries with atlas UVs ==========
        const allGeometries: THREE.BufferGeometry[] = [];
        let totalFaces = 0;

        blockKeys.forEach((coordStr) => {
            const [x, y, z] = coordStr.split(",").map(Number);
            const info = blockFaceInfo.get(coordStr)!;
            const { facePaths, blockId } = info;

            // Offset position for centering
            const offsetX = x - centreX;
            const offsetY = y - centreY;
            const offsetZ = z - centreZ;

            // Process each face - render ALL faces
            FACE_DEFINITIONS.forEach((face) => {
                totalFaces++;

                // Determine which atlas entry to use for this face
                let atlasKey: string;

                if (facePaths) {
                    const texPath = facePaths[face.name];
                    if (texPath && loadedTextures.get(texPath)) {
                        // Use texture from atlas
                        atlasKey = texPath;
                    } else {
                        // Texture missing or failed to load, use fallback color
                        atlasKey = `color_${colourFromBlockId(blockId)}`;
                    }
                } else {
                    // Color-only block
                    atlasKey = `color_${colourFromBlockId(blockId)}`;
                }

                const atlasEntry = uvMap.get(atlasKey);
                if (!atlasEntry) {
                    console.warn(
                        `[ComponentToEntityConverter] Missing atlas entry for ${atlasKey}`
                    );
                    return;
                }

                // Build face geometry with atlas-remapped UVs
                const faceGeometry = buildFaceGeometry(
                    face,
                    offsetX,
                    offsetY,
                    offsetZ,
                    atlasEntry
                );

                allGeometries.push(faceGeometry);
            });
        });

        // ========== Merge ALL geometries into single mesh ==========
        if (allGeometries.length === 0) {
            return {
                success: false,
                error: "No valid geometries were created",
            };
        }

        const mergedGeometry =
            allGeometries.length === 1
                ? allGeometries[0]
                : mergeGeometries(allGeometries, false);

        if (!mergedGeometry) {
            return {
                success: false,
                error: "Failed to merge geometries",
            };
        }

        // Dispose individual geometries after merge
        if (allGeometries.length > 1) {
            allGeometries.forEach((g) => g.dispose());
        }

        // Compute bounds for proper rendering
        mergedGeometry.computeBoundingBox();
        mergedGeometry.computeBoundingSphere();

        // Create single material with atlas texture
        const atlasMaterial = new THREE.MeshStandardMaterial({
            map: atlasTexture,
            transparent: true,
            alphaTest: 0.1,
            side: THREE.DoubleSide,
        });

        // Create the mesh
        const mesh = new THREE.Mesh(mergedGeometry, atlasMaterial);
        mesh.name = componentName;

        // Create the main group for export
        const mainGroup = new THREE.Group();
        mainGroup.name = componentName;
        mainGroup.add(mesh);

        console.log(
            `[ComponentToEntityConverter] Stats: ${blockKeys.length} blocks, ` +
                `${totalFaces} faces, 1 draw call (atlas merged)`
        );

        // ========== Export to GLTF ==========
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
                    atlasMaterial.dispose();
                    atlasTexture.dispose();
                    mergedGeometry.dispose();

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
