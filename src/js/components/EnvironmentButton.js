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
        const clonedScene = scene.clone();

        return () => {
            if (onRenderComplete) {
                requestAnimationFrame(() => {
                    onRenderComplete();
                });
            }

            clonedScene.traverse((object) => {
                if (object.geometry) {
                    object.geometry.dispose();
                }
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

const MAX_SIMULTANEOUS_RENDERS = 1; // Only render one at a time
let activeRenders = 0;
let renderQueue = [];
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
    }, 1); // 100ms delay between renders
};
const EnvironmentButton = ({ envType, isSelected, onSelect, onDelete }) => {
    const [imageUrl, setImageUrl] = React.useState(null);
    const [showCanvas, setShowCanvas] = React.useState(false);
    const [isQueued, setIsQueued] = React.useState(false);
    const getCacheKey = useCallback(() => {
        if (envType.modelUrl.startsWith("blob:")) {
            return envType.name;
        }

        return envType.modelUrl.replace(/^\//, "");
    }, [envType.modelUrl, envType.name]);
    useEffect(() => {
        if (!envType) return;
        const loadCachedImage = async () => {
            const cacheKey = getCacheKey();
            try {
                const cachedImage = await DatabaseManager.getData(
                    STORES.PREVIEWS,
                    cacheKey
                );
                if (cachedImage && cachedImage.startsWith("data:image/")) {
                    setImageUrl(cachedImage);
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
            setShowCanvas(true);
            setIsQueued(false);
        };

        if (!imageUrl && !showCanvas && !isQueued) {
            let mounted = true; // Add mounted flag
            loadCachedImage().then((hasCache) => {
                if (!mounted) return; // Check if still mounted
                if (!hasCache) {
                    setIsQueued(true);
                    if (activeRenders < MAX_SIMULTANEOUS_RENDERS) {
                        activeRenders++;
                        startRender();
                    } else {
                        renderQueue.push(startRender);
                    }
                }
            });

            return () => {
                mounted = false; // Set mounted to false on cleanup
                if (isQueued) {
                    renderQueue = renderQueue.filter(
                        (render) => render !== startRender
                    );
                }
            };
        }
    }, [imageUrl, showCanvas, isQueued, envType, getCacheKey]);
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
                const url = canvas.toDataURL("image/png");
                setImageUrl(url);
                const cacheKey = getCacheKey();
                console.log("Saving preview to cache with key:", cacheKey);
                DatabaseManager.saveData(STORES.PREVIEWS, cacheKey, url)
                    .then(() =>
                        console.log(
                            "Successfully cached preview for:",
                            cacheKey
                        )
                    )
                    .catch((error) => {
                        console.warn(
                            "Failed to cache image for:",
                            cacheKey,
                            error
                        );
                    });
            } catch (error) {
                console.warn("Failed to capture canvas content:", error);

                setTimeout(() => {
                    activeRenders--;
                    setShowCanvas(true);
                }, 500);
                return;
            }
            setShowCanvas(false);
            activeRenders--;

            try {
                const gl =
                    canvas.getContext("webgl2") || canvas.getContext("webgl");
                if (gl && gl.getExtension("WEBGL_lose_context")) {
                    gl.getExtension("WEBGL_lose_context").loseContext();
                }
            } catch (error) {}
            startNextRender();
        }
    };
    return (
        <Tooltip text={envType.name}>
            <button
                className={`environment-button ${isSelected ? "selected" : ""}`}
                onClick={() => {
                    onSelect(envType);
                    playUIClick();
                }}
            >
                <div className="object-preview" id={`preview-${envType.name}`}>
                    {showCanvas ? (
                        <Canvas camera={{ fov: 20, position: [0, 0, 8] }}>
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
                    ) : (
                        <img
                            src={imageUrl}
                            alt={envType.name}
                            style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "contain",
                            }}
                        />
                    )}
                </div>
                <div className="environment-label-wrapper">
                    <div className="environment-button-label">
                        {envType.name}
                    </div>
                </div>
                {envType.isCustom && (
                    <div
                        className="delete-button"
                        onClick={(e) => {
                            e.stopPropagation();
                            playUIClick();
                            onDelete(envType.id);
                        }}
                        style={{
                            marginLeft: "auto",
                            marginRight: "10px",
                        }}
                    >
                        <FaTrash />
                    </div>
                )}
            </button>
        </Tooltip>
    );
};
export default EnvironmentButton;
