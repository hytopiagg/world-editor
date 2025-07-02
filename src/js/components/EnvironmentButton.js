import React, { useCallback, useEffect } from "react";
import Tooltip from "./Tooltip";
import { playUIClick } from "../Sound";
import { Canvas } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { FaTrash } from "react-icons/fa";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";
import "../../css/BlockToolsSidebar.css";

const ModelPreview = ({ modelUrl, onRenderComplete }) => {
    const { scene } = useGLTF(modelUrl);
    React.useEffect(() => {
        // Clone the scene so that disposing does not affect cached original
        const clonedScene = scene.clone();

        // Trigger the callback once the model has had a frame to render
        const rafId = requestAnimationFrame(() => {
            if (onRenderComplete) onRenderComplete();
        });

        return () => {
            cancelAnimationFrame(rafId);

            // Clean-up GPU resources
            clonedScene.traverse((object) => {
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    if (object.material.map) object.material.map.dispose();
                    object.material.dispose();
                }
            });
        };
    }, [onRenderComplete, scene]);

    const bbox = new THREE.Box3().setFromObject(scene);
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    const fitScale = 2.1 / maxDim; // Adjust this value to change how much of the canvas the model fills
    return (
        <primitive
            object={scene.clone()}
            scale={fitScale}
            position={[
                -center.x * fitScale,
                -center.y * fitScale,
                -center.z * fitScale,
            ]}
            rotation={[-0.2, -0.5, 0]}
        />
    );
};

const MAX_SIMULTANEOUS_RENDERS = 2; // Allow a couple renders at the same time for faster overall loading
const MAX_RETRIES = 50;
const RETRY_DELAY_MS = 300; // 300-500 ms window per request
let activeRenders = 0;
let renderQueue = [];

// In-memory cache to avoid database lookups and prevent reloading
const imageCache = new Map();

// Clear cache if it gets too large (optional cleanup)
const clearCacheIfNeeded = () => {
    if (imageCache.size > 100) {
        console.log("Clearing image cache (size limit reached)");
        imageCache.clear();
    }
};

const startNextRender = () => {
    setTimeout(() => {
        if (
            renderQueue.length > 0 &&
            activeRenders < MAX_SIMULTANEOUS_RENDERS
        ) {
            const nextRender = renderQueue.shift();
            activeRenders++;
            nextRender();
        }
    }, 100); // 200ms delay between renders
};
const EnvironmentButton = ({ envType, isSelected, onSelect }) => {
    const [imageUrl, setImageUrl] = React.useState(null);
    const [showCanvas, setShowCanvas] = React.useState(false);
    const [isQueued, setIsQueued] = React.useState(false);
    const [isLoading, setIsLoading] = React.useState(true);
    const [hasError, setHasError] = React.useState(false);
    const [retryCount, setRetryCount] = React.useState(0);

    // Keep a persistent mounted flag for async safety
    const mountedRef = React.useRef(false);

    const getCacheKey = useCallback(() => {
        if (envType.modelUrl.startsWith("blob:")) {
            return envType.name;
        }

        return envType.modelUrl.replace(/^\//, "");
    }, [envType.modelUrl, envType.name]);

    useEffect(() => {
        if (!envType) return;

        mountedRef.current = true;

        const loadCachedImage = async () => {
            console.log(`[EnvButton] (${envType.name}) Checking cache…`);
            const cacheKey = getCacheKey();

            // First check in-memory cache
            if (imageCache.has(cacheKey)) {
                const cachedImage = imageCache.get(cacheKey);
                if (mountedRef.current) {
                    setImageUrl(cachedImage);
                    setIsLoading(false);
                    setRetryCount(0);
                    console.log(
                        `[EnvButton] (${envType.name}) Memory cache hit. activeRenders=${activeRenders}`
                    );
                    return true;
                }
            }

            // Then check database cache
            try {
                const cachedImage = await DatabaseManager.getData(
                    STORES.PREVIEWS,
                    cacheKey
                );
                if (
                    cachedImage &&
                    cachedImage.startsWith("data:image/") &&
                    mountedRef.current
                ) {
                    // Store in memory cache for future use
                    imageCache.set(cacheKey, cachedImage);
                    setImageUrl(cachedImage);
                    setIsLoading(false);
                    setRetryCount(0);
                    console.log(
                        `[EnvButton] (${envType.name}) Database cache hit. activeRenders=${activeRenders}`
                    );
                    return true;
                }
                console.log("No cached image found for:", cacheKey);
            } catch (error) {
                console.warn(
                    "Failed to load cached image for:",
                    cacheKey,
                    error
                );
            }
            return false;
        };

        const startRender = () => {
            if (mountedRef.current) {
                setShowCanvas(true);
                setIsQueued(false);
                console.log(
                    `[EnvButton] (${envType.name}) Rendering started. activeRenders=${activeRenders}`
                );
            }
        };

        // Only load/render if we don't have an image already
        if (!imageUrl && !showCanvas && !isQueued && !hasError) {
            setIsLoading(true);
            loadCachedImage().then((hasCache) => {
                if (!mountedRef.current) return; // Check if still mounted

                if (!hasCache) {
                    setIsQueued(true);
                    if (activeRenders < MAX_SIMULTANEOUS_RENDERS) {
                        activeRenders++;
                        startRender();
                    } else {
                        renderQueue.push(startRender);
                    }
                } else {
                    setIsLoading(false);
                }
            });
        }

        return () => {
            mountedRef.current = false; // cleanup flag
            if (isQueued) {
                renderQueue = renderQueue.filter(
                    (render) => render !== startRender
                );
            }
        };
    }, [
        envType,
        getCacheKey,
        // Removed imageUrl, showCanvas, isQueued, hasError, retryCount from dependencies
        // to prevent unnecessary re-runs when these change
    ]);

    if (!envType) {
        console.log("EnvironmentButton: envType is null");
        return null;
    }

    const handleRenderComplete = () => {
        const canvas = document.querySelector(
            `#preview-${envType.name} canvas`
        );
        if (canvas) {
            try {
                console.log(
                    `[EnvButton] (${envType.name}) Capture attempt ${
                        retryCount + 1
                    }`
                );
                const url = canvas.toDataURL("image/png");
                const cacheKey = getCacheKey();

                // Store in both memory and database cache
                clearCacheIfNeeded();
                imageCache.set(cacheKey, url);
                setImageUrl(url);
                setIsLoading(false);
                setRetryCount(0);

                console.log("Saving preview to cache with key:", cacheKey);
                DatabaseManager.saveData(STORES.PREVIEWS, cacheKey, url)
                    .then(() =>
                        console.log(
                            `[EnvButton] (${envType.name}) Cached preview under key: ${cacheKey}`
                        )
                    )
                    .catch((error) => {
                        // Failure to store the cached image should not trigger a visual retry.
                        // Log it but proceed – the preview itself rendered fine.
                        console.warn(
                            `[EnvButton] (${envType.name}) saveData (cache write) failed:`,
                            error
                        );
                    });
            } catch (error) {
                console.warn(
                    `[EnvButton] (${envType.name}) toDataURL threw on attempt ${
                        retryCount + 1
                    }:`,
                    error
                );

                setIsLoading(false);
                setShowCanvas(false);
                activeRenders = Math.max(0, activeRenders - 1);

                if (retryCount + 1 < MAX_RETRIES) {
                    console.log(
                        `[EnvButton] (${envType.name}) Scheduling retry #${
                            retryCount + 1
                        } in ${RETRY_DELAY_MS}ms`
                    );
                    setTimeout(() => {
                        if (!mountedRef.current) return;
                        setRetryCount((c) => c + 1);
                        setHasError(false);
                        setIsQueued(false);
                    }, RETRY_DELAY_MS);
                } else {
                    console.warn(
                        `[EnvButton] (${envType.name}) Max retries reached. Marking as error.`
                    );
                    setHasError(true);
                    startNextRender();
                }
                return;
            }
            setShowCanvas(false);
            activeRenders--;

            // Proactively release the GL context of the off-screen canvas to keep GPU memory low
            try {
                const gl =
                    canvas.getContext("webgl2") || canvas.getContext("webgl");
                if (gl && gl.getExtension("WEBGL_lose_context")) {
                    gl.getExtension("WEBGL_lose_context").loseContext();
                }
            } catch (glErr) {
                // noop – extension not available
            }

            console.log(
                `[EnvButton] (${envType.name}) Capture done. activeRenders=${activeRenders}`
            );
            startNextRender();
        }
    };

    // Handle image loading completion
    const handleImageLoad = () => {
        setIsLoading(false);
    };

    return (
        <Tooltip text={envType.name}>
            <button
                className={`environment-button border border-white/0 hover:border-white/20 transition-all duration-150 active:border-white`}
                style={{
                    border: isSelected ? "1px solid #ffffff" : "",
                }}
                onClick={() => {
                    onSelect(envType);
                    playUIClick();
                }}
            >
                <div className="object-preview" id={`preview-${envType.name}`}>
                    {showCanvas ? (
                        <Canvas
                            camera={{ fov: 20, position: [0, 0, 8] }}
                            gl={{ preserveDrawingBuffer: true }}
                        >
                            <ambientLight intensity={1} />
                            <directionalLight
                                position={[5, 5, 5]}
                                intensity={1}
                            />
                            <ModelPreview
                                modelUrl={envType.modelUrl}
                                onRenderComplete={handleRenderComplete}
                            />
                        </Canvas>
                    ) : imageUrl ? (
                        <>
                            <img
                                src={imageUrl}
                                alt={envType.name}
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "contain",
                                    display: isLoading ? "none" : "block",
                                }}
                                onLoad={handleImageLoad}
                            />
                            {isLoading && (
                                <div className="model-loading-spinner">
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white/80 rounded-full animate-spin"></div>
                                </div>
                            )}
                        </>
                    ) : isLoading ? (
                        <div className="model-loading-spinner">
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white/80 rounded-full animate-spin"></div>
                        </div>
                    ) : hasError ? (
                        <div className="model-loading-failed text-white/60 flex items-center justify-center">
                            <FaTrash title="Preview unavailable" />
                        </div>
                    ) : (
                        <div className="model-loading-spinner">
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white/80 rounded-full animate-spin"></div>
                        </div>
                    )}
                </div>
                <div className="environment-label-wrapper">
                    <div className="environment-button-label">
                        {envType.name}
                    </div>
                </div>
            </button>
        </Tooltip>
    );
};
export default React.memo(EnvironmentButton);
