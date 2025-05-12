import "../../css/BlockToolsOptions.css";
import "../../css/BlockToolsSidebar.css";
import DebugInfo from "./DebugInfo";

export function BlockToolOptions({
    debugInfo,
    totalBlocks,
    totalEnvironmentObjects,
    terrainBuilderRef,
}) {
    return (
        <div className="block-tool-options-container" style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            width: "100%",
        }}>
            <div className="block-tools-options-sidebar">
                <h1 className="text-2xl font-medium text-white">Block Tool Options</h1>
                <DebugInfo
                    debugInfo={debugInfo}
                    totalBlocks={totalBlocks}
                    totalEnvironmentObjects={totalEnvironmentObjects}
                    terrainBuilderRef={terrainBuilderRef}
                />
            </div>
        </div>
    );
}