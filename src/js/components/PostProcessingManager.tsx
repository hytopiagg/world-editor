import { useEffect, useRef, useMemo } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { WhiteCoreBloomPass } from '../postprocessing/WhiteCoreBloomPass';

interface PostProcessingManagerProps {
  enabled: boolean;
  bloomStrength?: number;
  bloomRadius?: number;
  ambientLightIntensity?: number;
}

export default function PostProcessingManager({
  enabled,
  bloomStrength = 0.5,
  bloomRadius = 0.4,
  ambientLightIntensity = 0.6,
}: PostProcessingManagerProps) {
  const { gl, scene, camera, size } = useThree();
  const composerRef = useRef<EffectComposer | null>(null);
  const bloomPassRef = useRef<WhiteCoreBloomPass | null>(null);
  const renderPassRef = useRef<RenderPass | null>(null);

  // Ensure renderer settings match SDK regardless of bloom state
  // This prevents color shift when toggling bloom on/off
  useEffect(() => {
    gl.toneMapping = THREE.NoToneMapping;
    gl.outputColorSpace = THREE.SRGBColorSpace;
  }, [gl]);

  // Calculate dynamic bloom threshold based on ambient light (matching SDK)
  // Only values > threshold will bloom. Normal scene elements are 0-1, so threshold > 1
  // means only emissive materials with intensity > 1 will bloom
  const bloomThreshold = useMemo(() => {
    return Math.max(ambientLightIntensity + 0.01, 1.01);
  }, [ambientLightIntensity]);

  // Initialize EffectComposer
  useEffect(() => {
    if (!enabled || !camera || !scene || !gl) {
      // Clean up if disabled or not ready
      if (composerRef.current) {
        composerRef.current.dispose();
        composerRef.current = null;
        bloomPassRef.current = null;
        renderPassRef.current = null;
      }
      return;
    }

    // Create EffectComposer
    const composer = new EffectComposer(gl);
    composer.setPixelRatio(1); // Match SDK - use pixel ratio of 1
    composerRef.current = composer;

    // Add RenderPass (renders the scene)
    const renderPass = new RenderPass(scene, camera);
    renderPassRef.current = renderPass;
    composer.addPass(renderPass);

    // Add WhiteCoreBloomPass (bloom with white-core effect and ACES tone mapping, matching SDK)
    const resolution = new THREE.Vector2(size.width, size.height);
    const bloomPass = new WhiteCoreBloomPass(
      resolution,
      bloomStrength,
      bloomRadius,
      bloomThreshold
    );
    bloomPassRef.current = bloomPass;
    composer.addPass(bloomPass);

    // Add SMAA antialiasing
    const smaaPass = new SMAAPass();
    composer.addPass(smaaPass);

    // Add OutputPass for correct color space handling
    const outputPass = new OutputPass();
    composer.addPass(outputPass);

    // Set composer size
    composer.setSize(size.width, size.height);

    return () => {
      composer.dispose();
      composerRef.current = null;
      bloomPassRef.current = null;
      renderPassRef.current = null;
    };
  }, [enabled, gl, scene, camera, size.width, size.height, bloomStrength, bloomRadius, bloomThreshold]);

  // Update bloom parameters when they change
  useEffect(() => {
    if (bloomPassRef.current && enabled) {
      bloomPassRef.current.strength = bloomStrength;
      bloomPassRef.current.radius = bloomRadius;
      bloomPassRef.current.threshold = bloomThreshold;
    }
  }, [enabled, bloomStrength, bloomRadius, bloomThreshold]);

  // Handle resize
  useEffect(() => {
    if (composerRef.current && enabled) {
      composerRef.current.setSize(size.width, size.height);
    }
  }, [enabled, size.width, size.height]);

  // Take over rendering when enabled
  // Return 1 from useFrame to skip R3F's default render
  useFrame((state, delta) => {
    if (!enabled || !composerRef.current) {
      return; // Let R3F render normally (returns undefined = don't skip)
    }

    // Update render pass camera in case it changed
    if (renderPassRef.current) {
      renderPassRef.current.camera = state.camera;
    }

    // Render through composer
    composerRef.current.render(delta);

    // Return 1 to tell R3F to skip its default render
    // This prevents double-rendering which causes color issues
    return 1;
  }, 1);

  return null;
}
