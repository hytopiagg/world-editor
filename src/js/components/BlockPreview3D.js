import React, { useRef, useMemo } from "react";
import PropTypes from "prop-types";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Box } from "@react-three/drei";
import * as THREE from "three";

// Order expected by Box geometry: +X (right), -X (left), +Y (top), -Y (bottom), +Z (front), -Z (back)
const FACE_ORDER = ["right", "left", "top", "bottom", "front", "back"];

const PreviewCube = ({ textureObjects }) => {
    const meshRef = useRef();

    // Memoize the array of materials using the passed texture objects
    const materials = useMemo(() => {
        const fallbackTexture = textureObjects?.all; // Get the actual fallback texture object

        return FACE_ORDER.map((faceKey) => {
            const texture = textureObjects?.[faceKey] || fallbackTexture;

            return new THREE.MeshPhongMaterial({
                map: texture, // Use the texture object directly
                side: THREE.DoubleSide,
                transparent: true,
                depthWrite: true, // Prevent depth buffer issues with transparency
            });
        });
        // Depend on the textureObjects state itself
    }, [textureObjects]);

    return <Box ref={meshRef} args={[1, 1, 1]} material={materials} />;
};

PreviewCube.propTypes = {
    // Expects { all: THREE.Texture, top: THREE.Texture, ... }
    textureObjects: PropTypes.object.isRequired,
};

const BlockPreview3D = ({ textureObjects }) => {
    // Keying the canvas might not be strictly necessary now, but doesn't hurt
    const previewKey = useMemo(
        () =>
            Object.values(textureObjects)
                .map((t) => t?.uuid || "null")
                .join("-"),
        [textureObjects]
    );

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
                <ambientLight intensity={0.6} />
                <directionalLight
                    position={[5, 5, 5]}
                    intensity={1.0}
                    castShadow
                    shadow-mapSize-width={1024}
                    shadow-mapSize-height={1024}
                />
                <directionalLight position={[-5, -5, -5]} intensity={0.3} />

                <PreviewCube textureObjects={textureObjects} />

                <OrbitControls
                    enableZoom={true}
                    enablePan={false}
                    minDistance={1.5}
                    maxDistance={5}
                    minPolarAngle={Math.PI / 6}
                    maxPolarAngle={Math.PI / 1.6}
                    autoRotate={true}
                    autoRotateSpeed={1.5}
                />
            </Canvas>
        </div>
    );
};

BlockPreview3D.propTypes = {
    textureObjects: PropTypes.object.isRequired,
};

export default BlockPreview3D;
