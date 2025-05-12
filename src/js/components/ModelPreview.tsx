import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import '../../css/ModelPreview.css'; // We'll create this CSS file later

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

  if (object.children) {
    object.children.forEach(disposeObject);
  }
};

const ModelPreview = ({ modelUrl, skybox }: { modelUrl: string, skybox: THREE.Texture | null }) => {
  const mountRef = useRef(null);

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



  const cleanupModel = useCallback(() => {
    if (modelRef.current && sceneRef.current) {
      console.log("Cleanup function called for model:", modelRef.current.uuid);
      sceneRef.current.remove(modelRef.current);
      disposeObject(modelRef.current); // Use recursive dispose
      modelRef.current = null;
    } else {

    }
  }, []);

  useEffect(() => {
    if (!mountRef.current) return;

    if (!sceneRef.current) {
      sceneRef.current = new THREE.Scene();
      console.log("--- Re-initializing THREE Scene due to StrictMode remount ---");
    }

    console.log("--- Initializing THREE Scene --- (ModelPreview)");
    const currentMount = mountRef.current;
    const scene = sceneRef.current;

    scene.background = skybox instanceof THREE.Texture ? skybox : new THREE.Color(0x444444);

    const width = currentMount.clientWidth;
    const height = currentMount.clientHeight;
    cameraRef.current = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    const camera = cameraRef.current;
    camera.position.set(1.5, 2, 2.5); // Restore initial camera position

    rendererRef.current = new THREE.WebGLRenderer({ antialias: true });
    const renderer = rendererRef.current;
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    currentMount.appendChild(renderer.domElement);

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

    const gridColorCenter = 0x777777;
    const gridColorLines = 0x555555;
    gridHelperRef.current = new THREE.GridHelper(10, 10, gridColorCenter, gridColorLines);
    const gridHelper = gridHelperRef.current;
    gridHelper.position.y = 0;
    gridHelper.receiveShadow = true;
    scene.add(gridHelper);

    controlsRef.current = new OrbitControls(camera, renderer.domElement);
    const controls = controlsRef.current;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.rotateSpeed = 0.5;
    controls.enablePan = false;
    controls.minDistance = 0.5;
    controls.maxDistance = 15;
    controls.target.set(0, 0.5, 0); // Restore initial controls target

    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);

      if (controlsRef.current && rendererRef.current && sceneRef.current && cameraRef.current) {
        controlsRef.current.update();
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    const handleResize = () => {
      if (!currentMount || !cameraRef.current || !rendererRef.current) return;
      const newWidth = currentMount.clientWidth;
      const newHeight = currentMount.clientHeight;
      cameraRef.current.aspect = newWidth / newHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(newWidth, newHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      console.log("--- Cleaning up THREE Scene --- (ModelPreview)");
      cancelAnimationFrame(frameIdRef.current);
      window.removeEventListener('resize', handleResize);
      if (controlsRef.current) {
        controlsRef.current.dispose();
        controlsRef.current = null;
      }

      if (sceneRef.current) {
        if (ambientLightRef.current) sceneRef.current.remove(ambientLightRef.current);
        if (directionalLightRef.current) sceneRef.current.remove(directionalLightRef.current);
        if (gridHelperRef.current) {
          sceneRef.current.remove(gridHelperRef.current);
          gridHelperRef.current.geometry?.dispose();
          gridHelperRef.current.material?.dispose();
        }
      }

      ambientLightRef.current = null;
      directionalLightRef.current = null;
      gridHelperRef.current = null;

      cleanupModel();

      if (rendererRef.current && rendererRef.current.domElement.parentNode === currentMount) {
        currentMount.removeChild(rendererRef.current.domElement);
      }
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
      sceneRef.current = null; // Allow scene to be garbage collected
    };

  }, []); // IMPORTANT: Empty dependency array ensures this runs only once

  useEffect(() => {

    if (!sceneRef.current || !loaderRef.current || !controlsRef.current) {
      return;
    }

    let modelLoadedInThisEffect = null;
    if (modelUrl) {
      console.log("Attempting to load model:", modelUrl);
      const loader = loaderRef.current;
      const scene = sceneRef.current;
      loader.load(
        modelUrl,
        (gltf) => {
          console.log("Model loaded successfully:", modelUrl);

          if (modelRef.current) {
            cleanupModel();
          }

          const loadedModel = gltf.scene;
          modelLoadedInThisEffect = loadedModel;
          modelRef.current = loadedModel;

          const box = new THREE.Box3().setFromObject(loadedModel);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());



          if (size.x === 0 || size.y === 0 || size.z === 0) {
            console.warn("Model has zero dimensions. Placing at origin.");
            scene.add(loadedModel);

          } else {

            loadedModel.position.x = -center.x;
            loadedModel.position.y = -box.min.y; // Position bottom at y=0 using original box
            loadedModel.position.z = -center.z;
            scene.add(loadedModel);

          }
        },
        undefined, // onProgress
        (error) => {
          console.error('Error loading model:', modelUrl, error);

          cleanupModel();
        }
      );
    } else {

      cleanupModel();
    }

    return () => {


      if (modelLoadedInThisEffect && sceneRef.current) {
        console.log("Effect cleanup: Removing model tracked by effect run:", modelLoadedInThisEffect.uuid);
        sceneRef.current.remove(modelLoadedInThisEffect);
        disposeObject(modelLoadedInThisEffect);

        if (modelRef.current === modelLoadedInThisEffect) {
          modelRef.current = null;
        }
      }
    };
  }, [modelUrl, cleanupModel]); // Depend on modelUrl and cleanupModel

  useEffect(() => {

    if (sceneRef.current) {
      sceneRef.current.background = skybox instanceof THREE.Texture ? skybox : new THREE.Color(0x444444);
    } else {
      console.warn("Skybox effect: sceneRef is null, skipping update.");
    }
  }, [skybox]);

  return <div ref={mountRef} className="model-preview-canvas"></div>;
};
export default ModelPreview; 