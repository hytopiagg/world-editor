import "../../css/BlockToolsOptions.css";
import "../../css/BlockToolsSidebar.css";

export function BlockToolOptions() {
    return (
        <div className="block-tool-options-container" style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            width: "100%",
        }}>
            <div className="block-tools-options-sidebar">
                <h1>Block Tool Options</h1>
            </div>
        </div>
    );
}