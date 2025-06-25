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
        width: inputWidth = 128,
        height: inputHeight = 128,
        background = "transparent",
        useTextures = true,
    }: GeneratePreviewOptions = {}
): Promise<string> {
    console.log(
        "generateSchematicPreview called with inputWidth:",
        inputWidth,
        "inputHeight:",
        inputHeight
    );

    // Ensure width and height are positive for stable rendering
    const renderWidth = Math.max(1, inputWidth);
    const renderHeight = Math.max(1, inputHeight);

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
                    if (path) loadedTextures.set(path, tex); // Ensure path is not null before setting
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

    let minX = Infinity,
        minY = Infinity,
        minZ = Infinity;
    let maxX = -Infinity,
        maxY = -Infinity,
        maxZ = -Infinity;

    // Interface for instance groups
    interface InstanceGroup {
        type: "textured" | "color";
        positions: THREE.Vector3[];
        blockId: number; // Needed for fallback colors in textured groups too
        facePaths?: FacePaths | null; // Only for textured type
    }
    const instanceGroups = new Map<string, InstanceGroup>();
    const materialsToDispose: THREE.Material[] = []; // To keep track of materials for disposal

    Object.entries(schematicData).forEach(([coordStr, blockId]) => {
        const [x, y, z] = coordStr.split(",").map((n) => parseInt(n, 10));

        minX = Math.min(x, minX);
        minY = Math.min(y, minY);
        minZ = Math.min(z, minZ);
        maxX = Math.max(x, maxX);
        maxY = Math.max(y, maxY);
        maxZ = Math.max(z, maxZ);

        let groupKey: string;
        let currentFacePaths: FacePaths | null = null;

        if (useTextures && BlockTypeRegistry?.instance) {
            currentFacePaths = _getFaceTexturePaths(blockId);
            if (currentFacePaths) {
                // Key based on actual texture paths to group identical blocks
                groupKey =
                    "textured_" +
                    JSON.stringify(Object.values(currentFacePaths).sort());
                if (!instanceGroups.has(groupKey)) {
                    instanceGroups.set(groupKey, {
                        type: "textured",
                        facePaths: currentFacePaths,
                        blockId, // Store blockId for potential color fallbacks per face
                        positions: [],
                    });
                }
            } else {
                // Fallback to color if texture paths can't be resolved
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
            // Color group if not using textures
            groupKey = "color_" + blockId;
            if (!instanceGroups.has(groupKey)) {
                instanceGroups.set(groupKey, {
                    type: "color",
                    blockId,
                    positions: [],
                });
            }
        }
        instanceGroups
            .get(groupKey)!
            .positions.push(new THREE.Vector3(x, y, z));
    });

    const centreX = Math.round((minX + maxX) / 2);
    const centreY = Math.round((minY + maxY) / 2);
    const centreZ = Math.round((minZ + maxZ) / 2);

    const sharedBoxGeometry = new THREE.BoxGeometry(1, 1, 1);

    instanceGroups.forEach((group) => {
        if (group.positions.length === 0) return;

        let material: THREE.Material | THREE.Material[];

        if (group.type === "textured" && group.facePaths) {
            const faceOrder = [
                group.facePaths.right,
                group.facePaths.left,
                group.facePaths.top,
                group.facePaths.bottom,
                group.facePaths.front,
                group.facePaths.back,
            ];
            const groupMaterials = faceOrder.map((path) => {
                const texture = path ? loadedTextures.get(path) : null;
                if (texture) {
                    return new THREE.MeshLambertMaterial({
                        map: texture,
                        transparent: true, // Assuming textures might have alpha
                    });
                }
                return new THREE.MeshLambertMaterial({
                    color: colourFromBlockId(group.blockId), // Fallback color for this face
                });
            });
            materialsToDispose.push(...groupMaterials);
            material = groupMaterials;
        } else {
            // Color group or fallback from textured if facePaths was null
            const colorMaterial = new THREE.MeshLambertMaterial({
                color: colourFromBlockId(group.blockId),
            });
            materialsToDispose.push(colorMaterial);
            material = colorMaterial;
        }

        const instancedMesh = new THREE.InstancedMesh(
            sharedBoxGeometry,
            material,
            group.positions.length
        );

        const matrix = new THREE.Matrix4();
        for (let i = 0; i < group.positions.length; i++) {
            const pos = group.positions[i];
            matrix.setPosition(
                pos.x - centreX,
                pos.y - centreY,
                pos.z - centreZ
            );
            instancedMesh.setMatrixAt(i, matrix);
        }
        instancedMesh.instanceMatrix.needsUpdate = true;
        scene.add(instancedMesh);
    });

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(5, 10, 7); // Position relative to the group of blocks
    scene.add(dirLight);

    const effectiveWidth =
        Object.keys(schematicData).length > 0 ? maxX - minX + 1 : 1;
    const effectiveHeight =
        Object.keys(schematicData).length > 0 ? maxY - minY + 1 : 1;
    const effectiveDepth =
        Object.keys(schematicData).length > 0 ? maxZ - minZ + 1 : 1;

    const maxDim = Math.max(effectiveWidth, effectiveHeight, effectiveDepth, 1);
    const aspect = renderWidth / renderHeight;
    const frustumSize = maxDim * 1.2 + 1; // Add 1 for single block case, ensure it's not too tight

    const camera = new THREE.OrthographicCamera(
        (frustumSize * aspect) / -2,
        (frustumSize * aspect) / 2,
        frustumSize / 2,
        frustumSize / -2,
        0.1, // Near plane
        maxDim * 5 // Far plane, needs to encompass the camera distance + scene depth
    );

    const distance = maxDim * 1.5; // Distance from origin for isometric view
    camera.position.set(distance, distance, distance);
    camera.lookAt(scene.position); // scene.position is (0,0,0) as blocks are centered
    camera.updateProjectionMatrix();

    const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true, // Necessary for toDataURL
    });
    renderer.setSize(renderWidth, renderHeight);
    const clearAlpha = background === "transparent" ? 0 : 1;
    const clearColor = background === "transparent" ? 0x000000 : background; // Ensure type consistency
    renderer.setClearColor(
        new THREE.Color(clearColor as THREE.ColorRepresentation),
        clearAlpha
    );

    renderer.render(scene, camera);

    const dataUrl = renderer.domElement.toDataURL("image/png");

    renderer.dispose();
    if (renderer.forceContextLoss) {
        renderer.forceContextLoss();
    }
    if (renderer.domElement && renderer.domElement.remove) {
        renderer.domElement.remove();
    }

    sharedBoxGeometry.dispose();
    materialsToDispose.forEach((mat) => {
        if (Array.isArray(mat)) {
            mat.forEach((m) => m.dispose());
        } else if (mat) {
            mat.dispose();
        }
    });

    _textureCache.clear();

    return dataUrl;
}
