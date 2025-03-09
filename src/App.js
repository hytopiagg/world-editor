import React, {useState, useRef, useEffect} from "react";
import { Canvas } from "@react-three/fiber";
import TerrainBuilder, {blockTypes} from "./js/TerrainBuilder";
import EnvironmentBuilder, {environmentModels} from "./js/EnvironmentBuilder";
import {
  FaCamera,
  FaVolumeMute,
  FaDatabase,
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

        <div className="camera-angle-slider">
          <input
            type="range"
            min="-80"
            max="10"
            value={cameraAngle}
            className="vertical-slider"
            onChange={(e) => setCameraAngle(parseFloat(e.target.value))}
          />
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
