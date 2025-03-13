import React, { useState, useCallback, useEffect } from 'react';
import '../../../css/MinecraftImport.css';
import UploadStep from './UploadStep';
import BlockTypeMapper from './BlockTypeMapper';
import ImportStep from './ImportStep';
import { loadingManager } from '../../LoadingManager';

// Define all steps including sub-steps
const ALL_STEPS = [
  { id: 'selectWorld', title: 'Select World', mainStep: 'upload' },
  { id: 'selectRegion', title: 'Select Region', mainStep: 'upload' },
  { id: 'uploadWorld', title: 'Upload World', mainStep: 'upload' },
  { id: 'mapBlocks', title: 'Map Blocks', mainStep: 'blocks' },
  { id: 'importMap', title: 'Import Map', mainStep: 'import' }
];

// Original steps for the wizard
const STEPS = [
  { id: 'upload', title: 'Select World' },
  { id: 'blocks', title: 'Map Blocks' },
  { id: 'import', title: 'Import Map' }
];

// Component to display all steps including sub-steps
const ProgressSteps = ({ currentStep, worldData, showSizeSelector, uploading }) => {
  // Determine which sub-step of the upload step we're on
  let currentSubStep = 'selectWorld'; // Default to first sub-step
  
  if (currentStep === 0) { // We're in the upload step
    if (worldData) {
      // If we have world data, we've completed the upload process
      currentSubStep = 'uploadWorld';
    } else if (showSizeSelector) {
      // If we're showing the size selector, we're in the region selection step
      currentSubStep = 'selectRegion';
    } else if (uploading) {
      // If we're uploading, we're in the upload process
      currentSubStep = 'uploadWorld';
    } else {
      // Otherwise, we're in the initial world selection step
      currentSubStep = 'selectWorld';
    }
  } else if (currentStep === 1) {
    // We're in the blocks step
    currentSubStep = 'mapBlocks';
  } else if (currentStep === 2) {
    // We're in the import step
    currentSubStep = 'importMap';
  }
  
  // For debugging
  console.log('ProgressSteps state:', { currentStep, worldData: !!worldData, showSizeSelector, uploading, currentSubStep });
  
  return (
    <div className="minecraft-import-steps">
      {ALL_STEPS.map((step, index) => {
        // Determine if this step is active, completed, or neither
        const isActive = step.id === currentSubStep;
        
        // A step is completed if:
        // 1. We're past it in the ALL_STEPS sequence
        // 2. We're in a later main step (currentStep > the step's main step index)
        const currentStepIndex = ALL_STEPS.findIndex(s => s.id === currentSubStep);
        const stepMainStepIndex = STEPS.findIndex(s => s.id === step.mainStep);
        const currentMainStepIndex = STEPS.findIndex(s => s.id === ALL_STEPS.find(s => s.id === currentSubStep)?.mainStep);
        
        const isCompleted = 
          (currentStepIndex > index) || // Past in sequence
          (currentMainStepIndex > stepMainStepIndex); // In a later main step
        
        return (
          <div 
            key={step.id} 
            className={`step ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
          >
            <div className="step-number">{index + 1}</div>
            <div className="step-title">{step.title}</div>
          </div>
        );
      })}
    </div>
  );
};

const MinecraftImportWizard = ({ isOpen, onClose, onComplete, terrainBuilderRef }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [worldData, setWorldData] = useState(null);
  const [blockMappings, setBlockMappings] = useState({});
  const [importResult, setImportResult] = useState(null);
  
  // Add state to track UploadStep's internal state
  const [showSizeSelector, setShowSizeSelector] = useState(false);
  const [uploading, setUploading] = useState(false);
  
  // Handle state changes from UploadStep
  const handleUploadStepStateChange = useCallback(({ uploading: newUploading, showSizeSelector: newShowSizeSelector }) => {
    console.log('UploadStep state changed:', { uploading: newUploading, showSizeSelector: newShowSizeSelector });
    setUploading(newUploading);
    setShowSizeSelector(newShowSizeSelector);
  }, []);
  
  const handleNextStep = useCallback(() => {
    //console.log('[TIMING] Index: handleNextStep called, moving from step', currentStep);
    setCurrentStep(prev => Math.min(prev + 1, STEPS.length - 1));
    //console.log('[TIMING] Index: After setCurrentStep call');
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
        // Also check if the world version is compatible with Minecraft 1.21 (Data Version 3953)
        return !!worldData && !worldData.loading && (worldData.worldVersion >= 3953 || !worldData.worldVersion);
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
    //console.log('[TIMING] Index: renderStep called for step', currentStep, STEPS[currentStep].id);
    switch (STEPS[currentStep].id) {
      case 'upload':
        console.log('[TIMING] Index: Rendering UploadStep');
        return <UploadStep 
                 onWorldLoaded={(data) => {
                   console.log('[TIMING] Index: onWorldLoaded callback received data');
                   ////console.log('[TIMING] Index: Setting worldData, size:', JSON.stringify(data).length, 'bytes');
                   setWorldData(data);
                   //console.log('[TIMING] Index: After setWorldData call');
                 }}
                 onAdvanceStep={handleNextStep} // Pass the step advancement function
                 onStateChange={handleUploadStepStateChange} // Pass the state change handler
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
        
        <ProgressSteps 
          currentStep={currentStep}
          worldData={worldData}
          showSizeSelector={showSizeSelector}
          uploading={uploading}
        />
        
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
              style={{ display: currentStep === 0 ? 'none' : 'block' }}
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