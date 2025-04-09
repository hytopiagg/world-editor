import React, { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import '../../css/ModelPreview.css'; // We'll create this CSS file later

// Helper function for disposing THREE.js objects (recursive)
const disposeObject = (object) => {
  if (!object) return;
  if (object.geometry) object.geometry.dispose();
  if (object.material) {
    if (Array.isArray(object.material)) {
      object.material.forEach(material => {
        if (material.map) material.map.dispose();
        material.dispose();
      });
    } else {
      if (object.material.map) object.material.map.dispose();
      object.material.dispose();
    }
  }
  // Recurse for children
  if (object.children) {
      object.children.forEach(disposeObject);
  }
};

// Accept skybox prop
const ModelPreview = ({ modelUrl, skybox }) => {
  const mountRef = useRef(null);
  // Initialize refs directly where appropriate
  const sceneRef = useRef(new THREE.Scene());
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const modelRef = useRef(null); // Ref to the currently loaded model
  const frameIdRef = useRef(null);
  const loaderRef = useRef(new GLTFLoader());
  const ambientLightRef = useRef(null);
  const directionalLightRef = useRef(null);
  const gridHelperRef = useRef(null);

  // --- Cleanup function for the model --- 
  // This might not be strictly needed if the effect cleanup is reliable,
  // but can be kept for explicit cleanup on unmount.
  const cleanupModel = useCallback(() => {
    if (modelRef.current && sceneRef.current) {
        console.log("Cleanup function called for model:", modelRef.current.uuid);
        sceneRef.current.remove(modelRef.current);
        disposeObject(modelRef.current); // Use recursive dispose
        modelRef.current = null;
    } else {
        // console.log("Cleanup function called but no modelRef or sceneRef.");
    }
  }, []);

  // --- Initial Setup Effect (runs once on mount) ---
  useEffect(() => {
    if (!mountRef.current) return;

    // --- StrictMode Fix: Re-initialize scene if it was nulled by cleanup ---
    if (!sceneRef.current) {
        sceneRef.current = new THREE.Scene();
        console.log("--- Re-initializing THREE Scene due to StrictMode remount ---");
    }
    // -----------------------------------------------------------------------

    console.log("--- Initializing THREE Scene --- (ModelPreview)");
    const currentMount = mountRef.current;
    const scene = sceneRef.current;

    // Apply initial background/skybox
    scene.background = skybox instanceof THREE.Texture ? skybox : new THREE.Color(0x444444);

    // Camera
    const width = currentMount.clientWidth;
    const height = currentMount.clientHeight;
    cameraRef.current = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    const camera = cameraRef.current;
    camera.position.set(1.5, 2, 2.5); // Restore initial camera position

    // Renderer
    rendererRef.current = new THREE.WebGLRenderer({ antialias: true });
    const renderer = rendererRef.current;
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    currentMount.appendChild(renderer.domElement);

    // Lighting
    ambientLightRef.current = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLightRef.current);
    directionalLightRef.current = new THREE.DirectionalLight(0xffffff, 1.5);
    const directionalLight = directionalLightRef.current;
    directionalLight.position.set(5, 10, 7.5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    scene.add(directionalLight);

    // Grid Helper
    const gridColorCenter = 0x777777;
    const gridColorLines = 0x555555;
    gridHelperRef.current = new THREE.GridHelper(10, 10, gridColorCenter, gridColorLines);
    const gridHelper = gridHelperRef.current;
    gridHelper.position.y = 0;
    gridHelper.receiveShadow = true;
    scene.add(gridHelper);

    // Controls
    controlsRef.current = new OrbitControls(camera, renderer.domElement);
    const controls = controlsRef.current;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.rotateSpeed = 0.5;
    controls.enablePan = false;
    controls.minDistance = 0.5;
    controls.maxDistance = 15;
    controls.target.set(0, 0.5, 0); // Restore initial controls target

    // Animation Loop
    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      // Ensure controls and renderer exist before updating/rendering
      if (controlsRef.current && rendererRef.current && sceneRef.current && cameraRef.current) {
          controlsRef.current.update();
          rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    // Resize Handler
    const handleResize = () => {
      if (!currentMount || !cameraRef.current || !rendererRef.current) return;
      const newWidth = currentMount.clientWidth;
      const newHeight = currentMount.clientHeight;
      cameraRef.current.aspect = newWidth / newHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(newWidth, newHeight);
    };
    window.addEventListener('resize', handleResize);

    // --- Cleanup for initial setup (on unmount) ---
    return () => {
        console.log("--- Cleaning up THREE Scene --- (ModelPreview)");
        cancelAnimationFrame(frameIdRef.current);
        window.removeEventListener('resize', handleResize);

        if (controlsRef.current) {
            controlsRef.current.dispose();
            controlsRef.current = null;
        }

        // Remove and dispose lights and grid from the scene
        if (sceneRef.current) {
             if (ambientLightRef.current) sceneRef.current.remove(ambientLightRef.current);
             if (directionalLightRef.current) sceneRef.current.remove(directionalLightRef.current);
             if (gridHelperRef.current) {
                sceneRef.current.remove(gridHelperRef.current);
                gridHelperRef.current.geometry?.dispose();
                gridHelperRef.current.material?.dispose();
             }
        }
        // Nullify refs for lights/grid
        ambientLightRef.current = null;
        directionalLightRef.current = null;
        gridHelperRef.current = null;

        // Perform model cleanup using the useCallback version
        cleanupModel();

        // Remove renderer canvas and dispose renderer
        if (rendererRef.current && rendererRef.current.domElement.parentNode === currentMount) {
           currentMount.removeChild(rendererRef.current.domElement);
        }
        if (rendererRef.current) {
            rendererRef.current.dispose();
            rendererRef.current = null;
        }

        sceneRef.current = null; // Allow scene to be garbage collected
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // IMPORTANT: Empty dependency array ensures this runs only once

  // --- Model Loading Effect ---
  useEffect(() => {
    // Ensure setup is complete before proceeding
    if (!sceneRef.current || !loaderRef.current || !controlsRef.current) {
      return;
    }

    // Track the model loaded specifically in this effect run
    let modelLoadedInThisEffect = null;

    if (modelUrl) {
      console.log("Attempting to load model:", modelUrl);
      const loader = loaderRef.current;
      const scene = sceneRef.current;
      const controls = controlsRef.current;

      loader.load(
        modelUrl,
        (gltf) => {
          console.log("Model loaded successfully:", modelUrl);

          // --- Cleanup previous model ---
          if (modelRef.current) {
              cleanupModel();
          }
          // ------------------------------

          const loadedModel = gltf.scene;
          modelLoadedInThisEffect = loadedModel;
          modelRef.current = loadedModel;

          loadedModel.traverse((node) => {
            if (node.isMesh) {
              node.castShadow = true;
              node.receiveShadow = true;
            }
          });

          // --- Centering (NO Scaling or Camera Adjustment) ---
          const box = new THREE.Box3().setFromObject(loadedModel);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          // const camera = cameraRef.current; // Not needed here anymore
          // const controls = controlsRef.current; // Not needed here anymore

          // Removed null check for camera/controls as they are not used here

          if (size.x === 0 || size.y === 0 || size.z === 0) {
            console.warn("Model has zero dimensions. Placing at origin.");
            scene.add(loadedModel);
            // Do not reset target or camera position here
          } else {
            // 1. REMOVED Scaling logic
            // const maxDim = Math.max(size.x, size.y, size.z); // Removed
            // const scale = 1.5 / maxDim; // Removed
            // loadedModel.scale.set(scale, scale, scale); // Removed

            // 2. REMOVED Recalculation of bounds after scaling
            // const scaledBox = new THREE.Box3().setFromObject(loadedModel); // Removed
            // const scaledCenter = scaledBox.getCenter(new THREE.Vector3()); // Removed
            // const scaledSize = scaledBox.getSize(new THREE.Vector3()); // Removed

            // 3. Position model using ORIGINAL center and box: Center H/D, bottom at y=0
            loadedModel.position.x = -center.x;
            loadedModel.position.y = -box.min.y; // Position bottom at y=0 using original box
            loadedModel.position.z = -center.z;

            scene.add(loadedModel);

            // 4. REMOVED Camera and Controls adjustment logic
            //    - No target setting
            //    - No distance calculation
            //    - No camera position setting
            //    - No controls.update() call here
          }
        },
        undefined, // onProgress
        (error) => {
          console.error('Error loading model:', modelUrl, error);
          // Ensure cleanup if loading fails
          cleanupModel();
        }
      );
    } else {
      // If modelUrl becomes null/undefined, cleanup any existing model
      cleanupModel();
    }

    // --- Return cleanup function for the effect ---
    return () => {
      // This runs *before* the next effect execution or on unmount
      // It cleans up the model loaded *specifically in this effect run*
      if (modelLoadedInThisEffect && sceneRef.current) {
        console.log("Effect cleanup: Removing model tracked by effect run:", modelLoadedInThisEffect.uuid);
        sceneRef.current.remove(modelLoadedInThisEffect);
        disposeObject(modelLoadedInThisEffect);
        // Check if the globally tracked model is the one we just cleaned up
        if(modelRef.current === modelLoadedInThisEffect) {
            modelRef.current = null;
        }
      }
    };
  }, [modelUrl, cleanupModel]); // Depend on modelUrl and cleanupModel

  // --- Restore separate Skybox update effect --- 
  useEffect(() => {
    // Add the null check back here too
    if (sceneRef.current) {
      sceneRef.current.background = skybox instanceof THREE.Texture ? skybox : new THREE.Color(0x444444);
    } else {
      console.warn("Skybox effect: sceneRef is null, skipping update.");
    }
  }, [skybox]);
  // --------------------------------------------

  return <div ref={mountRef} className="model-preview-canvas"></div>;
};

export default ModelPreview; 