import React, { useState, useCallback, useEffect } from "react";
import "../../../css/MinecraftImport.css";
import UploadStep from "./UploadStep";
import BlockTypeMapper from "./BlockTypeMapper";
import ImportStep from "./ImportStep";
import { loadingManager } from "../../managers/LoadingManager";

const ALL_STEPS = [
    { id: "selectWorld", title: "Select World", mainStep: "upload" },
    { id: "selectRegion", title: "Select Region", mainStep: "upload" },
    { id: "uploadWorld", title: "Upload World", mainStep: "upload" },
    { id: "mapBlocks", title: "Map Blocks", mainStep: "blocks" },
    { id: "importMap", title: "Import Map", mainStep: "import" },
];

const STEPS = [
    { id: "upload", title: "Select World" },
    { id: "blocks", title: "Map Blocks" },
    { id: "import", title: "Import Map" },
];

const ProgressSteps = ({
    currentStep,
    worldData,
    showSizeSelector,
    uploading,
}) => {

    let currentSubStep = "selectWorld"; // Default to first sub-step
    if (currentStep === 0) {

        if (worldData) {

            currentSubStep = "uploadWorld";
        } else if (showSizeSelector) {

            currentSubStep = "selectRegion";
        } else if (uploading) {

            currentSubStep = "uploadWorld";
        } else {

            currentSubStep = "selectWorld";
        }
    } else if (currentStep === 1) {

        currentSubStep = "mapBlocks";
    } else if (currentStep === 2) {

        currentSubStep = "importMap";
    }

    console.log("ProgressSteps state:", {
        currentStep,
        worldData: !!worldData,
        showSizeSelector,
        uploading,
        currentSubStep,
    });
    return (
        <div className="minecraft-import-steps">
            {ALL_STEPS.map((step, index) => {

                const isActive = step.id === currentSubStep;



                const currentStepIndex = ALL_STEPS.findIndex(
                    (s) => s.id === currentSubStep
                );
                const stepMainStepIndex = STEPS.findIndex(
                    (s) => s.id === step.mainStep
                );
                const currentMainStepIndex = STEPS.findIndex(
                    (s) =>
                        s.id ===
                        ALL_STEPS.find((s) => s.id === currentSubStep)?.mainStep
                );
                const isCompleted =
                    currentStepIndex > index || // Past in sequence
                    currentMainStepIndex > stepMainStepIndex; // In a later main step
                return (
                    <div
                        key={step.id}
                        className={`step ${isActive ? "active" : ""} ${isCompleted ? "completed" : ""}`}
                    >
                        <div className="step-number">{index + 1}</div>
                        <div className="step-title">{step.title}</div>
                    </div>
                );
            })}
        </div>
    );
};
const MinecraftImportWizard = ({
    isOpen,
    onClose,
    onComplete,
    terrainBuilderRef,
}) => {
    const [currentStep, setCurrentStep] = useState(0);
    const [worldData, setWorldData] = useState(null);
    const [blockMappings, setBlockMappings] = useState({});
    const [importResult, setImportResult] = useState(null);

    const [showSizeSelector, setShowSizeSelector] = useState(false);
    const [uploading, setUploading] = useState(false);

    const handleUploadStepStateChange = useCallback(
        ({
            uploading: newUploading,
            showSizeSelector: newShowSizeSelector,
        }) => {
            console.log("UploadStep state changed:", {
                uploading: newUploading,
                showSizeSelector: newShowSizeSelector,
            });
            setUploading(newUploading);
            setShowSizeSelector(newShowSizeSelector);
        },
        []
    );
    const handleNextStep = useCallback(() => {

        setCurrentStep((prev) => Math.min(prev + 1, STEPS.length - 1));

    }, [currentStep]);
    const handlePrevStep = useCallback(() => {


        if (currentStep === 1) {

            setWorldData(null);

            setBlockMappings({});
        }

        setCurrentStep((prev) => Math.max(prev - 1, 0));
    }, [currentStep]);
    const handleComplete = useCallback(() => {
        if (importResult && importResult.success) {

            loadingManager.showLoading("Preparing imported map...", 0);

            console.log("Import completed successfully!", importResult);

            onClose();

            if (typeof window.refreshBlockTools === "function") {
                window.refreshBlockTools();
            } else {
                window.dispatchEvent(new CustomEvent("refreshBlockTools"));
            }

            window.dispatchEvent(new CustomEvent("custom-blocks-loaded"));

            setTimeout(() => {
                if (terrainBuilderRef.current?.updateTerrainFromToolBar) {
                    console.log(
                        "Updating terrain with imported Minecraft data"
                    );

                    terrainBuilderRef.current.updateTerrainFromToolBar(
                        importResult.hytopiaMap.blocks
                    );
                }

                onComplete && onComplete(importResult);
            }, 100); // Reduced delay for faster response
        } else {

            onComplete && onComplete(importResult);
            onClose();
        }
    }, [importResult, onComplete, onClose, terrainBuilderRef]);

    useEffect(() => {
        if (worldData && currentStep === 0) {

            handleNextStep();
        }
    }, [worldData, currentStep, handleNextStep]);
    const canProceed = () => {
        switch (STEPS[currentStep].id) {
            case "upload":


                return (
                    !!worldData &&
                    !worldData.loading &&
                    (worldData.worldVersion >= 3953 || !worldData.worldVersion)
                );
            case "blocks":

                return true;
            case "import":
                return !!importResult && importResult.success;
            default:
                return false;
        }
    };

    const renderStep = () => {

        switch (STEPS[currentStep].id) {
            case "upload":
                console.log("[TIMING] Index: Rendering UploadStep");
                return (
                    <UploadStep
                        onWorldLoaded={(data) => {
                            console.log(
                                "[TIMING] Index: onWorldLoaded callback received data"
                            );

                            setWorldData(data);

                        }}
                        onAdvanceStep={handleNextStep} // Pass the step advancement function
                        onStateChange={handleUploadStepStateChange} // Pass the state change handler
                    />
                );
            case "blocks":
                console.log("[TIMING] Index: About to render BlockTypeMapper");
                return (
                    <BlockTypeMapper
                        worldData={worldData}
                        onMappingsUpdated={setBlockMappings}
                        initialMappings={blockMappings}
                    />
                );
            case "import":
                return (
                    <ImportStep
                        worldData={worldData}
                        blockMappings={blockMappings}
                        onImportComplete={setImportResult}
                    />
                );
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
                    <button className="close-button" onClick={onClose}>
                        ×
                    </button>
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
                            style={{
                                display: currentStep === 0 ? "none" : "block",
                            }}
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
