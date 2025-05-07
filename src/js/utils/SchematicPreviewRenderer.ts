/**
 * SchematicPreviewRenderer
 * -----------------------
 * A tiny helper that turns the raw schematic data structure used by the
 * SchematicPlacementTool into a small isometric preview image that can be
 * dropped straight into an <img> tag.
 *
 * Usage example (inside a React component):
 *
 *   import { generateSchematicPreview } from "../utils/SchematicPreviewRenderer";
 *   const dataUrl = await generateSchematicPreview(schematicData, { width: 96, height: 96 });
 *   <img src={dataUrl} />
 *
 * The function purposefully keeps all heavy lifting (THREE.Scene, geometry, etc.)
 * completely self-contained so that nothing is leaked into the rest of the
 * application.  Every call builds a throw-away scene, renders once to an
 * off-screen WebGL canvas and immediately disposes all THREE resources so that
 * we don't leave GPU memory lying around.
 */

import * as THREE from "three";
import BlockTypeRegistryModule from "../blocks/BlockTypeRegistry";

interface BlockFaceTextures {
    right?: string;
    left?: string;
    top?: string;
    bottom?: string;
    front?: string;
    back?: string;
    all?: string; // Catch-all for simple block types
    default?: string; // Fallback texture
    [key: string]: string | undefined;
}

interface BlockType {
    textureUris?: BlockFaceTextures;
}

interface BlockTypeRegistryInstance {
    getBlockType: (blockId: number) => BlockType | undefined | null;
    initialize: () => Promise<void>;
}

const BlockTypeRegistry: { instance?: BlockTypeRegistryInstance } | null =
    BlockTypeRegistryModule || null;

// A tiny, global texture cache so we don't reload the exact same PNG dozens of
// times when the preview contains many instances of the same block type.
const _textureLoader = new THREE.TextureLoader();
const _textureCache = new Map<string, Promise<THREE.Texture | null>>();

function _loadTexture(
    path: string | undefined | null
): Promise<THREE.Texture | null> {
    if (!path) return Promise.resolve(null);

    // Re-use in-flight / finished loads to avoid duplicate requests.
    if (_textureCache.has(path)) return _textureCache.get(path)!; // Non-null assertion as we check with .has()

    const p = new Promise<THREE.Texture | null>((resolve) => {
        _textureLoader.load(
            path,
            (texture: THREE.Texture) => {
                texture.minFilter = THREE.LinearMipMapLinearFilter;
                texture.magFilter = THREE.NearestFilter;
                resolve(texture);
            },
            undefined, // onProgress callback, not used
            () => {
                // onError callback
                console.warn(
                    `SchematicPreviewRenderer – failed to load texture ${path}. Falling back to colour.`
                );
                resolve(null);
            }
        );
    });
    _textureCache.set(path, p);
    return p;
}

/**
 * Derive a reasonably unique, pleasant colour for a given numeric block id.
 * The returned value is a hexadecimal number accepted by THREE.Color.
 */
function colourFromBlockId(blockId: number): number {
    // Knuth multiplicative hash – gives us a well-distributed pseudo-random
    // integer in the 0 ... 2^32 range that we can trim down to 24-bit rgb.
    const hashed = (blockId * 2654435761) >>> 0;
    return hashed & 0xffffff; // keep lower 24 bits
}

interface FacePaths {
    right: string | null;
    left: string | null;
    top: string | null;
    bottom: string | null;
    front: string | null;
    back: string | null;
}

/**
 * Attempt to resolve file paths for each box face texture for the given block
 * id using BlockTypeRegistry (if available).
 */
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
            `SchematicPreviewRenderer – error while resolving texture paths for block ${blockId}:`,
            err
        );
        return null;
    }
}

/**
 * Create a THREE.Mesh for a block that uses real textures if we managed to
 * look them up and load them.  Falls back to a flat coloured material when no
 * textures are available.
 */
function createBlockMeshWithTextures(
    blockId: number,
    loadedTextures: Map<string, THREE.Texture | null>
): THREE.Mesh {
    const facePaths = _getFaceTexturePaths(blockId);
    if (!facePaths) {
        return createBlockMesh(blockId); // Fallback to colored cube
    }

    const faceOrder: (string | null)[] = [
        facePaths.right,
        facePaths.left,
        facePaths.top,
        facePaths.bottom,
        facePaths.front,
        facePaths.back,
    ];

    const materials = faceOrder.map((path) => {
        const texture = path ? loadedTextures.get(path) : null;
        if (texture) {
            return new THREE.MeshLambertMaterial({
                map: texture,
                transparent: true, // Assuming textures might have alpha
            });
        }
        // Fallback material for this face if texture is missing or failed to load
        return new THREE.MeshLambertMaterial({
            color: colourFromBlockId(blockId),
        });
    });

    const geom = new THREE.BoxGeometry(1, 1, 1);
    return new THREE.Mesh(geom, materials);
}

/**
 * Build and return a THREE.Mesh for a single block using a flat colour.
 */
function createBlockMesh(blockId: number): THREE.Mesh {
    const geom = new THREE.BoxGeometry(1, 1, 1);
    return new THREE.Mesh(
        geom,
        new THREE.MeshLambertMaterial({ color: colourFromBlockId(blockId) })
    );
}

export interface SchematicData {
    [coordStr: string]: number;
}

export interface GeneratePreviewOptions {
    width?: number;
    height?: number;
    background?: string;
    useTextures?: boolean;
}

/**
 * Generate a small, isometric preview for the supplied schematic.
 *
 * @returns A base64 data-URL representing the rendered PNG, or an empty string on failure.
 */
export async function generateSchematicPreview(
    schematicData: SchematicData,
    {
        width = 128,
        height = 128,
        background = "transparent",
        useTextures = true,
    }: GeneratePreviewOptions = {}
): Promise<string> {
    if (!schematicData || Object.keys(schematicData).length === 0) {
        console.warn(
            "generateSchematicPreview called with empty or undefined schematic – returning empty string."
        );
        return "";
    }

    const scene = new THREE.Scene();
    const loadedTextures = new Map<string, THREE.Texture | null>();

    if (useTextures && BlockTypeRegistry?.instance) {
        try {
            if (BlockTypeRegistry.instance.initialize) {
                await BlockTypeRegistry.instance.initialize();
            }

            const texturePathsToLoad = new Set<string>();
            Object.values(schematicData).forEach((blockId) => {
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
        } catch (err) {
            console.warn(
                "SchematicPreviewRenderer – error while loading textures, falling back to coloured cubes.",
                err
            );
            // loadedTextures will remain empty or partially filled, leading to color fallbacks
        }
    }

    const tmpVec = new THREE.Vector3();
    let minX = Infinity,
        minY = Infinity,
        minZ = Infinity;
    let maxX = -Infinity,
        maxY = -Infinity,
        maxZ = -Infinity;

    Object.entries(schematicData).forEach(([coordStr, blockId]) => {
        const [x, y, z] = coordStr.split(",").map((n) => parseInt(n, 10));

        const mesh =
            useTextures && loadedTextures.size > 0
                ? createBlockMeshWithTextures(blockId, loadedTextures)
                : createBlockMesh(blockId);

        mesh.position.set(x, y, z);
        scene.add(mesh);

        minX = Math.min(x, minX);
        minY = Math.min(y, minY);
        minZ = Math.min(z, minZ);
        maxX = Math.max(x, maxX);
        maxY = Math.max(y, maxY);
        maxZ = Math.max(z, maxZ);
    });

    const centreX = (minX + maxX) / 2;
    const centreY = (minY + maxY) / 2;
    const centreZ = (minZ + maxZ) / 2;

    scene.children.forEach((obj) => {
        if (obj instanceof THREE.Mesh) {
            // Type guard for safety
            obj.position.sub(tmpVec.set(centreX, centreY, centreZ));
        }
    });

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);

    const effectiveWidth =
        schematicData && Object.keys(schematicData).length > 0
            ? maxX - minX + 1
            : 1;
    const effectiveHeight =
        schematicData && Object.keys(schematicData).length > 0
            ? maxY - minY + 1
            : 1;
    const effectiveDepth =
        schematicData && Object.keys(schematicData).length > 0
            ? maxZ - minZ + 1
            : 1;

    const maxDim = Math.max(effectiveWidth, effectiveHeight, effectiveDepth, 1); // Ensure maxDim is at least 1
    const aspect = width / height;
    const frustumSize = maxDim * 1.5; // Adjusted padding slightly, ensure it's not too small

    const camera = new THREE.OrthographicCamera(
        (frustumSize * aspect) / -2,
        (frustumSize * aspect) / 2,
        frustumSize / 2,
        frustumSize / -2,
        0.1,
        1000
    );

    const distance = maxDim * 2;
    camera.position.set(distance, distance, distance);
    camera.lookAt(scene.position); // Look at the center of the scene (which is 0,0,0 due to recentering)
    camera.updateProjectionMatrix();

    const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
    });
    renderer.setSize(width, height);
    const clearAlpha = background === "transparent" ? 0 : 1;
    const clearColor = background === "transparent" ? 0x000000 : background;
    renderer.setClearColor(clearColor, clearAlpha);

    renderer.render(scene, camera);

    const dataUrl = renderer.domElement.toDataURL("image/png");

    renderer.dispose();
    scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            if (Array.isArray(obj.material)) {
                obj.material.forEach((m) => m.dispose());
            } else if (obj.material) {
                obj.material.dispose();
            }
        }
    });
    _textureCache.forEach((promise) => {
        promise.then((texture) => {
            if (texture) {
                texture.dispose();
            }
        });
    });
    _textureCache.clear();

    return dataUrl;
}
