import React, { useState, useCallback, useEffect } from 'react';
import '../../../css/MinecraftImport.css';
import UploadStep from './UploadStep';
import BlockTypeMapper from './BlockTypeMapper';
import ImportStep from './ImportStep';
import { loadingManager } from '../../LoadingManager';

const STEPS = [
  { id: 'upload', title: 'Upload World' },
  { id: 'blocks', title: 'Map Blocks' },
  { id: 'import', title: 'Import Map' }
];

const MinecraftImportWizard = ({ isOpen, onClose, onComplete, terrainBuilderRef }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [worldData, setWorldData] = useState(null);
  const [blockMappings, setBlockMappings] = useState({});
  const [importResult, setImportResult] = useState(null);
  
  const handleNextStep = useCallback(() => {
    console.log('[TIMING] Index: handleNextStep called, moving from step', currentStep);
    setCurrentStep(prev => Math.min(prev + 1, STEPS.length - 1));
    console.log('[TIMING] Index: After setCurrentStep call');
  }, [currentStep]);
  
  const handlePrevStep = useCallback(() => {
    // If going back from the blocks step (step 1) to the upload step (step 0),
    // reset the state to allow starting over
    if (currentStep === 1) {
      // Clear world data to free memory
      setWorldData(null);
      // Reset other state
      setBlockMappings({});
    }
    
    // Go back to the previous step
    setCurrentStep(prev => Math.max(prev - 1, 0));
  }, [currentStep]);
  
  const handleComplete = useCallback(() => {
    if (importResult && importResult.hytopiaMap) {
      // Show loading screen with initial message
      loadingManager.showLoading('Preparing to import Minecraft world...');
      
      // Close dialog right away to avoid UI freeze
      onComplete && onComplete(importResult);
      onClose();
      
      // Reduce delay to make loading more responsive
      setTimeout(() => {
        // Update the terrain with imported data - loading will be managed inside updateTerrainFromToolBar
        terrainBuilderRef.current?.updateTerrainFromToolBar(importResult.hytopiaMap.blocks);
      }, 50); // Reduced from 150ms for faster response
    } else {
      // If no import result, just close normally
      onComplete && onComplete(importResult);
      onClose();
    }
  }, [importResult, onComplete, onClose, terrainBuilderRef]);
  
  // Auto-advance to next step when worldData is set
  useEffect(() => {
    if (worldData && currentStep === 0) {
      // If we're on the upload step and worldData is set, advance to the next step
      handleNextStep();
    }
  }, [worldData, currentStep, handleNextStep]);
  
  const canProceed = () => {
    switch (STEPS[currentStep].id) {
      case 'upload':
        // Only allow proceeding from upload step when world data is fully loaded
        return !!worldData && !worldData.loading;
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
    console.log('[TIMING] Index: renderStep called for step', currentStep, STEPS[currentStep].id);
    switch (STEPS[currentStep].id) {
      case 'upload':
        console.log('[TIMING] Index: Rendering UploadStep');
        return <UploadStep 
                 onWorldLoaded={(data) => {
                   console.log('[TIMING] Index: onWorldLoaded callback received data');
                   console.log('[TIMING] Index: Setting worldData, size:', JSON.stringify(data).length, 'bytes');
                   setWorldData(data);
                   console.log('[TIMING] Index: After setWorldData call');
                 }}
                 onAdvanceStep={handleNextStep} // Pass the step advancement function
               />;
      case 'blocks':
        console.log('[TIMING] Index: About to render BlockTypeMapper');
        return <BlockTypeMapper 
                 worldData={worldData}
                 onMappingsUpdated={setBlockMappings}
                 initialMappings={blockMappings} />;
      case 'import':
        return <ImportStep 
                 worldData={worldData}
                 blockMappings={blockMappings}
                 onImportComplete={setImportResult} />;
      default:
        return null;
    }
  };
  
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