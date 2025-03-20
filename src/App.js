import React, {useState, useRef, useEffect} from "react";
import { Canvas } from "@react-three/fiber";
import TerrainBuilder, {blockTypes} from "./js/TerrainBuilder";
import EnvironmentBuilder, {environmentModels} from "./js/EnvironmentBuilder";
import {
  FaCamera,
  FaVolumeMute,
  FaDatabase,
  FaSave,
} from "react-icons/fa";
import Tooltip from "./js/components/Tooltip";
import hytopiaLogo from "./images/hytopia_logo_white.png";
import "./css/App.css";
import {toggleMute, isMuted} from "./js/Sound";
import DebugInfo from './js/components/DebugInfo';
import BlockToolsSidebar from './js/components/BlockToolsSidebar';
import { version, IS_UNDER_CONSTRUCTION } from './js/Constants';
import ToolBar from './js/components/ToolBar';
import {DatabaseManager} from './js/DatabaseManager';
import UnderConstruction from "./js/components/UnderConstruction";
import UndoRedoManager from "./js/UndoRedo";
import QuickTips from './js/components/QuickTips';
import {getCustomBlocks} from "./js/TerrainBuilder";
import GlobalLoadingScreen from './js/components/GlobalLoadingScreen';

function App() {
  const undoRedoManagerRef = useRef(null);
  const [currentBlockType, setCurrentBlockType] = useState(blockTypes[0]);
  const [mode, setMode] = useState("add");
  const [debugInfo, setDebugInfo] = useState({ mouse: {}, preview: {}, grid: {}});
  const [totalBlocks, setTotalBlocks] = useState(0);
  const [axisLockEnabled, setAxisLockEnabled] = useState(false);
  const [cameraReset, setCameraReset] = useState(false);
  const [cameraAngle, setCameraAngle] = useState(0);
  const [placementSize, setPlacementSize] = useState("single");
  const [activeTab, setActiveTab] = useState("blocks");
  const [pageIsLoaded, setPageIsLoaded] = useState(false);
  const handleDropRef = useRef(null);
  const [scene, setScene] = useState(null);
  const [totalEnvironmentObjects, setTotalEnvironmentObjects] = useState(0);
  const [gridSize, setGridSize] = useState(100);
  const [currentPreviewPosition, setCurrentPreviewPosition] = useState(null);
  const environmentBuilderRef = useRef(null);
  const blockToolsRef = useRef(null);
  const terrainBuilderRef = useRef(null);
  const [placementSettings, setPlacementSettings] = useState({
    randomScale: false,
    randomRotation: false,
    minScale: 0.5,
    maxScale: 1.5,
    minRotation: 0,
    maxRotation: 360,
    scale: 1.0,
    rotation: 0
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const loadSavedToolSelection = () => {
      const savedBlockId = localStorage.getItem("selectedBlock");
      if (savedBlockId) {
        const blockId = parseInt(savedBlockId);
        
        if (blockId < 200) {
          const block = [...blockTypes, ...getCustomBlocks()].find(b => b.id === blockId);
          if (block) {
            setCurrentBlockType(block);
            setActiveTab("blocks");
          }
        } else {
          if (environmentModels && environmentModels.length > 0) {
            const envModel = environmentModels.find(m => m.id === blockId);
            if (envModel) {
              setCurrentBlockType({...envModel, isEnvironment: true});
              setActiveTab("environment");
            }
          }
        }
      }
    };

    if (pageIsLoaded) {
      loadSavedToolSelection();
    }
  }, [pageIsLoaded]);

  // Check if terrain is saving
  useEffect(() => {
    const checkSavingStatus = () => {
      if (terrainBuilderRef.current) {
        const savingState = terrainBuilderRef.current.isSaving;
        if (savingState !== isSaving) {
          console.log("Saving state changed:", savingState);
          setIsSaving(savingState);
        }
      }
    };
    
    // Check every 100ms
    const interval = setInterval(checkSavingStatus, 100);
    return () => clearInterval(interval);
  }, [isSaving]);

  // Add Ctrl+S hotkey for saving
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Check for Ctrl+S (or Cmd+S on Mac)
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault(); // Prevent browser's save dialog
        
        // Set saving state directly for immediate feedback
        setIsSaving(true);
        
        // Call the save function
        if (terrainBuilderRef.current) {
          console.log("Saving via Ctrl+S hotkey");
          terrainBuilderRef.current.saveTerrainManually();
        }
        
        // Set a fallback timer to clear the saving state if something goes wrong
        setTimeout(() => setIsSaving(false), 5000);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const LoadingScreen = () => (
    <div className="loading-screen">
      <img src={hytopiaLogo} alt="Hytopia Logo" className="loading-logo" />
      <div className="loading-spinner"></div>
      <div className="loading-text">
        <i>Loading...</i>
      </div>
      <div className="version-text">HYTOPIA Map Builder v{version}</div>
    </div>
  );

  return (
    <div className="App">
      {IS_UNDER_CONSTRUCTION && <UnderConstruction />}
      
      {/* Loading Screen */}
      {!pageIsLoaded && <LoadingScreen />}

      {/* Global Loading Screen for heavy operations */}
      <GlobalLoadingScreen />

      {/* Hytopia Logo */}
      <div className="hytopia-logo-wrapper">
        <img src={hytopiaLogo}/>
        <p className="hytopia-version-text">World Editor Version {version}</p>
      </div>

      <QuickTips />

      <BlockToolsSidebar
        terrainBuilderRef={terrainBuilderRef}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        setCurrentBlockType={setCurrentBlockType}
        environmentBuilder={environmentBuilderRef.current}
        onPlacementSettingsChange={setPlacementSettings}
      />

      <div className="vignette-gradient"></div>

      {/* Saving indicator */}
      {isSaving && (
        <div
          style={{
            position: 'fixed',
            bottom: '80px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '8px 16px',
            borderRadius: '4px',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3)',
            fontFamily: 'Arial, sans-serif',
            fontSize: '14px',
            fontWeight: 'bold',
            pointerEvents: 'none' // Ensure it doesn't interfere with clicks
          }}
        >
          <div
            style={{
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              border: '3px solid rgba(255, 255, 255, 0.3)',
              borderTopColor: 'white',
              animation: 'spin 1s linear infinite'
            }}
          />
          Saving...
        </div>
      )}

      <Canvas shadows className="canvas-container">
        <TerrainBuilder
          ref={terrainBuilderRef}
          blockToolsRef={blockToolsRef}
          currentBlockType={currentBlockType}
          mode={mode}
          setDebugInfo={setDebugInfo}
          sendTotalBlocks={setTotalBlocks}
          axisLockEnabled={axisLockEnabled}
          placementSize={placementSize}
          cameraReset={cameraReset}
          cameraAngle={cameraAngle}
          onCameraAngleChange={setCameraAngle}
          setPageIsLoaded={setPageIsLoaded}
          onHandleDropRef={(fn) => (handleDropRef.current = fn)}
          onSceneReady={(sceneObject) => setScene(sceneObject)}
          totalEnvironmentObjects={totalEnvironmentObjects}
          gridSize={gridSize}
          environmentBuilderRef={environmentBuilderRef}
          previewPositionToAppJS={setCurrentPreviewPosition}
          undoRedoManager={undoRedoManagerRef.current}
        />
        <EnvironmentBuilder
          ref={environmentBuilderRef}
          scene={scene}
          currentBlockType={currentBlockType}
          mode={mode}
          onTotalObjectsChange={setTotalEnvironmentObjects}
          placementSize={placementSize}
          previewPositionFromAppJS={currentPreviewPosition}
          placementSettings={placementSettings}
          undoRedoManager={undoRedoManagerRef.current}
        />
      </Canvas>

      <DebugInfo 
        debugInfo={debugInfo}
        totalBlocks={totalBlocks}
        totalEnvironmentObjects={totalEnvironmentObjects} 
        terrainBuilderRef={terrainBuilderRef}
      />

      <ToolBar
        terrainBuilderRef={terrainBuilderRef}
        environmentBuilderRef={environmentBuilderRef}
        mode={mode}
        handleModeChange={setMode}
        axisLockEnabled={axisLockEnabled}
        setAxisLockEnabled={setAxisLockEnabled}
        placementSize={placementSize}
        setPlacementSize={setPlacementSize}
        setGridSize={setGridSize}
        undoRedoManager={undoRedoManagerRef.current}
        currentBlockType={currentBlockType}
      />

      <UndoRedoManager
        ref={undoRedoManagerRef}
        terrainBuilderRef={terrainBuilderRef}
        environmentBuilderRef={environmentBuilderRef}
      />

      <div className="camera-controls-wrapper">
        <Tooltip text="Save terrain (Ctrl+S)">
          <button
            onClick={() => {
              // Set saving state directly for immediate feedback
              setIsSaving(true);
              // Then call the actual save function
              if (terrainBuilderRef.current) {
                terrainBuilderRef.current.saveTerrainManually();
              }
              // Set a fallback timer to clear the saving state if something goes wrong
              setTimeout(() => setIsSaving(false), 5000);
            }}
            className="camera-control-button save-button"
          >
            <FaSave />
          </button>
        </Tooltip>
        
        <div className="camera-buttons">
          <Tooltip text="Reset camera position">
            <button onClick={() => setCameraReset((prev) => !prev)} className="camera-control-button">
              <FaCamera />
            </button>
          </Tooltip>
          <Tooltip text={isMuted ? "Unmute" : "Mute"}>
            <button
              onClick={toggleMute}
              className={`camera-control-button ${!isMuted ? "active" : ""}`}
            >
              <FaVolumeMute />
            </button>
          </Tooltip>
        </div>

       
      </div>

      <button
        className="toolbar-button"
        onClick={async () => await DatabaseManager.clearDatabase()}
        title="Clear Database"
        style={{ position: "absolute", bottom: "10px", left: "10px" }}
      >
        <FaDatabase />
      </button>
    </div>
  );
}

export default App;
