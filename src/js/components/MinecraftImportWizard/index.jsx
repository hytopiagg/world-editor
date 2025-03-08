import React, { useState, useCallback, useEffect } from 'react';
import '../../../css/MinecraftImport.css';
import UploadStep from './UploadStep';
import RegionSelector from './RegionSelector';
import BlockTypeMapper from './BlockTypeMapper';
import ImportStep from './ImportStep';

const STEPS = [
  { id: 'upload', title: 'Upload World' },
  { id: 'region', title: 'Select Region' },
  { id: 'blocks', title: 'Map Blocks' },
  { id: 'import', title: 'Import Map' }
];

const MinecraftImportWizard = ({ isOpen, onClose, onComplete, terrainBuilderRef }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [worldData, setWorldData] = useState(null);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [blockMappings, setBlockMappings] = useState({});
  const [importResult, setImportResult] = useState(null);
  
  const handleNextStep = useCallback(() => {
    setCurrentStep(prev => Math.min(prev + 1, STEPS.length - 1));
  }, []);
  
  const handlePrevStep = useCallback(() => {
    setCurrentStep(prev => Math.max(prev - 1, 0));
  }, []);
  
  const handleComplete = useCallback(() => {
    if (importResult && importResult.hytopiaMap) {
      // Update the terrain with imported data
      terrainBuilderRef.current?.updateTerrainFromToolBar(importResult.hytopiaMap.blocks);
    }
    
    onComplete && onComplete(importResult);
    onClose();
  }, [importResult, onComplete, onClose, terrainBuilderRef]);
  
  const canProceed = () => {
    switch (STEPS[currentStep].id) {
      case 'upload':
        return !!worldData;
      case 'region':
        return !!selectedRegion;
      case 'blocks':
        // Always allow proceeding from block mapping step since we auto-map
        return true;
      case 'import':
        return !!importResult && importResult.success;
      default:
        return false;
    }
  };
  
  // Render the current step
  const renderStep = () => {
    switch (STEPS[currentStep].id) {
      case 'upload':
        return <UploadStep onWorldLoaded={setWorldData} />;
      case 'region':
        return <RegionSelector 
                 worldData={worldData} 
                 onRegionSelected={setSelectedRegion} 
                 initialRegion={selectedRegion} />;
      case 'blocks':
        return <BlockTypeMapper 
                 worldData={worldData}
                 selectedRegion={selectedRegion}
                 onMappingsUpdated={setBlockMappings}
                 initialMappings={blockMappings} />;
      case 'import':
        return <ImportStep 
                 worldData={worldData}
                 selectedRegion={selectedRegion}
                 blockMappings={blockMappings}
                 onComplete={setImportResult} />;
      default:
        return <div>Unknown step</div>;
    }
  };
  
  // Initialize region when world data changes
  useEffect(() => {
    if (worldData && worldData.bounds && !selectedRegion) {
      // Set a default region when world data is loaded (whole world)
      setSelectedRegion({
        minX: worldData.bounds.minX,
        minY: worldData.bounds.minY,
        minZ: worldData.bounds.minZ,
        maxX: worldData.bounds.maxX,
        maxY: worldData.bounds.maxY,
        maxZ: worldData.bounds.maxZ
      });
    }
  }, [worldData, selectedRegion]);
  
  if (!isOpen) return null;
  
  return (
    <div className="minecraft-import-wizard">
      <div className="minecraft-import-backdrop" onClick={onClose}></div>
      <div className="minecraft-import-content">
        <div className="minecraft-import-header">
          <h2>Import Minecraft Map</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        <div className="minecraft-import-steps">
          {STEPS.map((step, index) => (
            <div 
              key={step.id} 
              className={`step ${index === currentStep ? 'active' : ''} ${index < currentStep ? 'completed' : ''}`}
            >
              <div className="step-number">{index + 1}</div>
              <div className="step-title">{step.title}</div>
            </div>
          ))}
        </div>
        
        <div className="minecraft-import-step-content">
          {renderStep()}
        </div>
        
        <div className="minecraft-import-footer">
          {currentStep > 0 && (
            <button 
              className="secondary-button" 
              onClick={handlePrevStep}
            >
              Previous
            </button>
          )}
          
          {currentStep < STEPS.length - 1 ? (
            <button 
              className="primary-button" 
              onClick={handleNextStep}
              disabled={!canProceed()}
            >
              Next
            </button>
          ) : (
            <button 
              className="primary-button" 
              onClick={handleComplete}
              disabled={!canProceed()}
            >
              Complete Import
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default MinecraftImportWizard; 