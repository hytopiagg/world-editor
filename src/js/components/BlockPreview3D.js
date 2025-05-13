import React, { useRef, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Box } from "@react-three/drei";
import { FaPlay } from "react-icons/fa";
import { FaPause } from "react-icons/fa";
import * as THREE from "three";

const FACE_ORDER = ["right", "left", "top", "bottom", "front", "back"];
const PreviewCube = ({ textureObjects }) => {
    const meshRef = useRef();

    const materials = useMemo(() => {
        const fallbackTexture = textureObjects?.all; // Get the actual fallback texture object
        return FACE_ORDER.map((faceKey) => {
            const texture = textureObjects?.[faceKey] || fallbackTexture;
            if (texture) {
                texture.colorSpace = THREE.SRGBColorSpace;
            }

            return new THREE.MeshPhongMaterial({
                map: texture, // Use the texture object directly
                side: THREE.DoubleSide,
                transparent: true,
                depthWrite: true, // Prevent depth buffer issues with transparency
            });
        });
    }, [textureObjects]);
    return <Box ref={meshRef} args={[1, 1, 1]} material={materials} />;
};
PreviewCube.propTypes = {
    textureObjects: PropTypes.object.isRequired,
};
const BlockPreview3D = ({ textureObjects, target = [0, 0, 0], showControls = true }) => {
    const [isRotating, setIsRotating] = useState(true);

    const previewKey = useMemo(
        () =>
            Object.values(textureObjects)
                .map((t) => t?.uuid || "null")
                .join("-"),
        [textureObjects]
    );

    const toggleRotation = () => {
        setIsRotating(!isRotating);
    };

    return (
        <div className="block-preview-3d-container">
            <div className="block-preview-label-container">
                <p>Block Preview</p>
            </div>
            <Canvas
                key={previewKey}
                shadows
                camera={{ position: [1, 1, 1], fov: 80 }}
            >
                <ambientLight intensity={1} />
                <directionalLight
                    position={[5, 5, 5]}
                    intensity={2}
                    castShadow
                    shadow-mapSize-width={1024}
                    shadow-mapSize-height={1024}
                />
                <directionalLight
                    position={[0, 5, 0]}
                    intensity={1}
                    castShadow
                    shadow-mapSize-width={1024}
                    shadow-mapSize-height={1024}
                />
                <directionalLight
                    position={[5, 5, 0]}
                    intensity={1}
                    castShadow
                    shadow-mapSize-width={1024}
                    shadow-mapSize-height={1024}
                />
                <directionalLight
                    position={[-5, 5, 0]}
                    intensity={1}
                    castShadow
                    shadow-mapSize-width={1024}
                    shadow-mapSize-height={1024}
                />
                <PreviewCube textureObjects={textureObjects} />
                <OrbitControls
                    enableZoom={true}
                    enablePan={false}
                    minDistance={1.5}
                    maxDistance={5}
                    minPolarAngle={Math.PI / 6}
                    maxPolarAngle={Math.PI / 1.6}
                    autoRotate={isRotating}
                    autoRotateSpeed={1.5}
                    position={[0, 0, 0]}
                    target={target}
                />
            </Canvas>

            {showControls && <div className="block-preview-controls">
                <button
                    className="rotation-control-button"
                    onClick={toggleRotation}
                    title={isRotating ? "Pause rotation" : "Start rotation"}
                >
                    {isRotating ? <FaPause size={16} /> : <FaPlay size={16} />}
                </button>
            </div>}
        </div>
    );
};
BlockPreview3D.propTypes = {
    textureObjects: PropTypes.object.isRequired,
};
export default BlockPreview3D;
