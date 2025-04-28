import React, { useRef, useMemo } from "react";
import PropTypes from "prop-types";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Box } from "@react-three/drei";
import * as THREE from "three";

const FACE_ORDER = ["right", "left", "top", "bottom", "front", "back"];
const PreviewCube = ({ textureObjects }) => {
    const meshRef = useRef();

    const materials = useMemo(() => {
        const fallbackTexture = textureObjects?.all; // Get the actual fallback texture object
        return FACE_ORDER.map((faceKey) => {
            const texture = textureObjects?.[faceKey] || fallbackTexture;
            return new THREE.MeshStandardMaterial({
                map: texture, // Use the texture object directly
                side: THREE.FrontSide,
                transparent: true,
                alphaTest: 0.1,
                roughness: 1,
                metalness: 0,
                color: texture ? 0xffffff : 0xcccccc,
            });
        });

    }, [textureObjects]);
    return <Box ref={meshRef} args={[1, 1, 1]} material={materials} />;
};
PreviewCube.propTypes = {

    textureObjects: PropTypes.object.isRequired,
};
const BlockPreview3D = ({ textureObjects }) => {

    const previewKey = useMemo(
        () =>
            Object.values(textureObjects)
                .map((t) => t?.uuid || "null")
                .join("-"),
        [textureObjects]
    );
    return (
        <div className="block-preview-3d-container">
            <Canvas
                key={previewKey}
                shadows
                camera={{ position: [1.5, 1.5, 1.5], fov: 50 }}
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
