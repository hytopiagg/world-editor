import * as THREE from "three";

// A cache for loaded textures to avoid redundant loading
const _textureCache = new Map<string, THREE.CubeTexture>();

type FaceKey = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

async function loadSkyboxTexture(
    skyboxName: string
): Promise<THREE.CubeTexture> {
    const cacheKey = skyboxName;
    if (_textureCache.has(cacheKey)) {
        return _textureCache.get(cacheKey)!;
    }

    const loader = new THREE.CubeTextureLoader();
    loader.setPath(`./assets/skyboxes/${skyboxName}/`);

    return new Promise((resolve, reject) => {
        const texture = loader.load(
            ["+x.png", "-x.png", "+y.png", "-y.png", "+z.png", "-z.png"],
            () => {
                _textureCache.set(cacheKey, texture);
                resolve(texture);
            },
            undefined, // onProgress callback not needed
            (error) => {
                console.error(
                    `An error occurred loading the skybox: ${skyboxName}`,
                    error
                );
                reject(error);
            }
        );
    });
}

async function loadSkyboxTextureFromDataUris(
    faceTextures: Record<FaceKey, string>
): Promise<THREE.CubeTexture> {
    const loader = new THREE.CubeTextureLoader();

    // CubeTextureLoader expects URLs in the order: +x, -x, +y, -y, +z, -z
    const urls = [
        faceTextures['+x'],
        faceTextures['-x'],
        faceTextures['+y'],
        faceTextures['-y'],
        faceTextures['+z'],
        faceTextures['-z']
    ];

    return new Promise((resolve, reject) => {
        const texture = loader.load(
            urls,
            () => resolve(texture),
            undefined,
            (error) => {
                console.error('An error occurred loading skybox from data URIs:', error);
                reject(error);
            }
        );
    });
}

interface GeneratePreviewOptions {
    width?: number;
    height?: number;
}

export async function generateSkyboxPreview(
    skyboxName: string,
    { width = 64, height = 64 }: GeneratePreviewOptions = {}
): Promise<string> {
    try {
        const texture = await loadSkyboxTexture(skyboxName);
        const scene = new THREE.Scene();
        scene.background = texture;

        const camera = new THREE.PerspectiveCamera(
            75,
            width / height,
            0.1,
            1000
        );
        camera.position.z = 5;

        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            preserveDrawingBuffer: true, // Necessary for toDataURL
        });
        renderer.setSize(width, height);

        // Simple sphere to give a sense of reflection/shape
        const geometry = new THREE.SphereGeometry(1, 32, 32);
        const material = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 0.8,
            roughness: 0.1,
            envMap: texture,
        });
        const sphere = new THREE.Mesh(geometry, material);
        scene.add(sphere);

        // Basic lighting
        scene.add(new THREE.AmbientLight(0xffffff, 0.5));
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 5, 5);
        scene.add(directionalLight);

        // Look at the center of the sphere
        camera.lookAt(new THREE.Vector3(0, 0, 0));

        // Slightly rotate the sphere to show a more interesting reflection
        sphere.rotation.y = Math.PI / 6;
        sphere.rotation.x = Math.PI / 8;

        renderer.render(scene, camera);

        // Convert to JPEG with compression for smaller file size
        const canvas = renderer.domElement;
        const dataURL = canvas.toDataURL("image/jpeg", 0.5); // Reduced quality for better compression

        // Clean up
        renderer.dispose();
        geometry.dispose();
        material.dispose();
        if (material.map) material.map.dispose();

        return dataURL;
    } catch (error) {
        console.error(`Failed to generate preview for ${skyboxName}:`, error);
        // Return a placeholder or re-throw
        throw error;
    }
}

export async function generateSkyboxPreviewFromDataUris(
    faceTextures: Record<FaceKey, string>,
    { width = 64, height = 64 }: GeneratePreviewOptions = {}
): Promise<string> {
    try {
        const texture = await loadSkyboxTextureFromDataUris(faceTextures);
        const scene = new THREE.Scene();
        scene.background = texture;

        const camera = new THREE.PerspectiveCamera(
            75,
            width / height,
            0.1,
            1000
        );
        camera.position.z = 5;

        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            preserveDrawingBuffer: true,
        });
        renderer.setSize(width, height);

        // Simple sphere to give a sense of reflection/shape
        const geometry = new THREE.SphereGeometry(1, 32, 32);
        const material = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 0.8,
            roughness: 0.1,
            envMap: texture,
        });
        const sphere = new THREE.Mesh(geometry, material);
        scene.add(sphere);

        // Basic lighting
        scene.add(new THREE.AmbientLight(0xffffff, 0.5));
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 5, 5);
        scene.add(directionalLight);

        // Look at the center of the sphere
        camera.lookAt(new THREE.Vector3(0, 0, 0));

        // Slightly rotate the sphere to show a more interesting reflection
        sphere.rotation.y = Math.PI / 6;
        sphere.rotation.x = Math.PI / 8;

        renderer.render(scene, camera);

        // Convert to JPEG with compression for smaller file size
        const canvas = renderer.domElement;
        const dataURL = canvas.toDataURL("image/jpeg", 0.5);

        // Clean up
        renderer.dispose();
        geometry.dispose();
        material.dispose();
        texture.dispose();
        if (material.map) material.map.dispose();

        return dataURL;
    } catch (error) {
        console.error('Failed to generate preview from data URIs:', error);
        throw error;
    }
}
