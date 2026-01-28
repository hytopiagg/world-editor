import React, { useRef, useMemo, useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Box } from "@react-three/drei";
import { FaPlay } from "react-icons/fa";
import { FaPause } from "react-icons/fa";
import * as THREE from "three";
import {
    detectGPU,
    getOptimalContextAttributes,
    getRecommendedSettings,
} from "../utils/GPUDetection";
import { BLOCK_ROTATION_MATRICES } from "../blocks/BlockRotations";
import { BLOCK_SHAPES, buildTrimeshTriangleData } from "../blocks/BlockShapes";

const FACE_ORDER = ["right", "left", "top", "bottom", "front", "back"];

const PreviewCube = ({ textureObjects, rotationIndex = 0, shapeType = 'cube' }) => {
    const meshRef = useRef();
    const groupRef = useRef();

    // Create rotation matrix from rotation index
    const rotationMatrix = useMemo(() => {
        if (rotationIndex === 0) return new THREE.Matrix4();
        const m = BLOCK_ROTATION_MATRICES[rotationIndex];
        if (!m) return new THREE.Matrix4();
        const mat4 = new THREE.Matrix4();
        mat4.set(
            m[0], m[1], m[2], 0,
            m[3], m[4], m[5], 0,
            m[6], m[7], m[8], 0,
            0, 0, 0, 1
        );
        return mat4;
    }, [rotationIndex]);

    // Apply rotation to group
    useEffect(() => {
        if (groupRef.current) {
            if (rotationIndex === 0) {
                groupRef.current.rotation.set(0, 0, 0);
            } else {
                groupRef.current.rotation.setFromRotationMatrix(rotationMatrix);
            }
        }
    }, [rotationIndex, rotationMatrix]);

    // Create geometry for custom shapes with proper UVs for texture mapping
    const shapeGeometry = useMemo(() => {
        if (shapeType === 'cube' || !BLOCK_SHAPES[shapeType]) {
            return null; // Use default BoxGeometry
        }
        const shapeDef = BLOCK_SHAPES[shapeType];
        if (!shapeDef) return null;

        const triangles = buildTrimeshTriangleData(shapeDef.vertices, shapeDef.indices);
        const vertCount = triangles.length * 3;
        const positions = new Float32Array(vertCount * 3);
        const normals = new Float32Array(vertCount * 3);
        const uvs = new Float32Array(vertCount * 2);

        for (let i = 0; i < triangles.length; i++) {
            const t = triangles[i];
            const base3 = i * 9; // 3 verts × 3 components
            const base2 = i * 6; // 3 verts × 2 components

            // Positions
            positions[base3]     = t.v0[0]; positions[base3 + 1] = t.v0[1]; positions[base3 + 2] = t.v0[2];
            positions[base3 + 3] = t.v1[0]; positions[base3 + 4] = t.v1[1]; positions[base3 + 5] = t.v1[2];
            positions[base3 + 6] = t.v2[0]; positions[base3 + 7] = t.v2[1]; positions[base3 + 8] = t.v2[2];

            // Normals (flat per-face)
            normals[base3]     = t.normal[0]; normals[base3 + 1] = t.normal[1]; normals[base3 + 2] = t.normal[2];
            normals[base3 + 3] = t.normal[0]; normals[base3 + 4] = t.normal[1]; normals[base3 + 5] = t.normal[2];
            normals[base3 + 6] = t.normal[0]; normals[base3 + 7] = t.normal[1]; normals[base3 + 8] = t.normal[2];

            // UVs
            uvs[base2]     = t.uv0[0]; uvs[base2 + 1] = t.uv0[1];
            uvs[base2 + 2] = t.uv1[0]; uvs[base2 + 3] = t.uv1[1];
            uvs[base2 + 4] = t.uv2[0]; uvs[base2 + 5] = t.uv2[1];
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geom.translate(-0.5, -0.5, -0.5);
        return geom;
    }, [shapeType]);

    const materials = useMemo(() => {
        const fallbackTexture = textureObjects?.all;
        return FACE_ORDER.map((faceKey) => {
            const texture = textureObjects?.[faceKey] || fallbackTexture;
            if (texture) {
                texture.colorSpace = THREE.SRGBColorSpace;
            }

            return new THREE.MeshPhongMaterial({
                map: texture,
                side: THREE.DoubleSide,
                transparent: true,
                depthWrite: true,
            });
        });
    }, [textureObjects]);

    // Single material for custom shapes (use the 'all' or 'front' texture)
    const shapeMaterial = useMemo(() => {
        const texture = textureObjects?.all || textureObjects?.front;
        if (texture) {
            texture.colorSpace = THREE.SRGBColorSpace;
        }
        return new THREE.MeshPhongMaterial({
            map: texture,
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: true,
        });
    }, [textureObjects]);

    return (
        <group ref={groupRef}>
            {shapeGeometry ? (
                <mesh ref={meshRef} geometry={shapeGeometry} material={shapeMaterial} />
            ) : (
                <Box ref={meshRef} args={[1, 1, 1]} material={materials} />
            )}
        </group>
    );
};

PreviewCube.propTypes = {
    textureObjects: PropTypes.object.isRequired,
    rotationIndex: PropTypes.number,
    shapeType: PropTypes.string,
};

const BlockPreview3D = ({
    textureObjects,
    target = [0, 0, 0],
    showControls = true,
    rotationIndex = 0,
    shapeType = 'cube',
}) => {
    const [isRotating, setIsRotating] = useState(true);

    const previewKey = useMemo(
        () =>
            Object.values(textureObjects)
                .map((t) => t?.uuid || "null")
                .join("-") + `-r${rotationIndex}-s${shapeType}`,
        [textureObjects, rotationIndex, shapeType]
    );

    const toggleRotation = () => {
        setIsRotating(!isRotating);
    };

    // Get GPU-optimized settings for this preview
    const gpuInfo = detectGPU();
    const contextAttributes = getOptimalContextAttributes(gpuInfo);
    const settings = getRecommendedSettings(gpuInfo);

    return (
        <div className="block-preview-3d-container">
            <div className="block-preview-label-container">
                <p>Block Preview</p>
            </div>
            <Canvas
                key={previewKey}
                shadows
                camera={{ position: [1, 1, 1], fov: 80 }}
                gl={contextAttributes}
            >
                <ambientLight intensity={1} />
                <directionalLight
                    position={[5, 5, 5]}
                    intensity={2}
                    castShadow
                    shadow-mapSize-width={settings.shadowMapSize}
                    shadow-mapSize-height={settings.shadowMapSize}
                />
                <directionalLight
                    position={[0, 5, 0]}
                    intensity={1}
                    castShadow
                    shadow-mapSize-width={settings.shadowMapSize}
                    shadow-mapSize-height={settings.shadowMapSize}
                />
                <directionalLight
                    position={[5, 5, 0]}
                    intensity={1}
                    castShadow
                    shadow-mapSize-width={settings.shadowMapSize}
                    shadow-mapSize-height={settings.shadowMapSize}
                />
                <directionalLight
                    position={[-5, 5, 0]}
                    intensity={1}
                    castShadow
                    shadow-mapSize-width={settings.shadowMapSize}
                    shadow-mapSize-height={settings.shadowMapSize}
                />
                <PreviewCube textureObjects={textureObjects} rotationIndex={rotationIndex} shapeType={shapeType} />
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

            {showControls && (
                <div className="block-preview-controls">
                    <button
                        className="rotation-control-button"
                        onClick={toggleRotation}
                        title={isRotating ? "Pause rotation" : "Start rotation"}
                    >
                        {isRotating ? (
                            <FaPause size={16} />
                        ) : (
                            <FaPlay size={16} />
                        )}
                    </button>
                </div>
            )}
        </div>
    );
};
BlockPreview3D.propTypes = {
    textureObjects: PropTypes.object.isRequired,
    target: PropTypes.array,
    showControls: PropTypes.bool,
    rotationIndex: PropTypes.number,
    shapeType: PropTypes.string,
};
export default BlockPreview3D;
