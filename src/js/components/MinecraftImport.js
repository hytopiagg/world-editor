import { FaChevronDown, FaChevronUp, FaFileImport, FaPlus, FaTrash, FaUpload } from "react-icons/fa";
import Tooltip from "./Tooltip";
import Select from "react-select";
import { blockTypes, getBlockTypes } from "../TerrainBuilder";
import "../../css/MinecraftImport.css";
import { DatabaseManager, STORES } from "../DatabaseManager";

const worker = new Worker(new URL("../MinecraftImportWorker.js", import.meta.url));

export const MinecraftImportToolButton = ({setState, setShowModal}) => (
<Tooltip text="Import Minecraft map">
    <button
        onClick={() => document.getElementById("minecraftMapFileInput").click()}
        className="control-button">
        <FaFileImport />
    </button>
    <form>
        <input
            id="minecraftMapFileInput"
            type="file"
            accept=".zip"
            onChange={(e) => onMinecraftMapFileSelected(e, setState, setShowModal)}
            style={{ display: "none" }}
        />
    </form>
</Tooltip>
)

export const MinecraftImportModal = ({state, setState, setShowModal, setImportedMap}) => (
    <div className="modal-overlay" onClick={(e) => handleMinecraftImportModalOverlayClick(e, setState, setShowModal)}>
        <div className="modal-content">
            { !state.convertPhase 
                ? <ImportModal state={state} setState={setState} setShowModal={setShowModal} /> 
                : (!state.loadingPhase 
                    ? <ConvertModal state={state} setState={setState} setShowModal={setShowModal} setImportedMap={setImportedMap}/>
                    : <LoadingModal state={state} setState={setState} setShowModal={setShowModal} />
                )
            }
            
        </div>
    </div>
)

const ImportModal = ({state, setState, setShowModal}) => (
<>
    <h3 className="modal-title">Configure Region</h3>

    <div className="modal-input">
        <label>Selected File: </label>
        <input
            value={state.file?.name ?? ""}
            disabled={true}
        />
    </div>

    {!(state.importWholeMap ?? true) && (
        <>
            <div className="modal-input">
                <label>Min Position: </label>
                <input
                    className="small"
                    type="number"
                    value={state.minX ?? 0}
                    onChange={(e) => {
                        setState({
                            ...state,
                            minX: e.target.value
                        })
                    }}
                />
                <input
                    className="small"
                    type="number"
                    value={state.minY ?? 0}
                    onChange={(e) => {
                        setState({
                            ...state,
                            minY: e.target.value
                        })
                    }}
                />
                <input
                    className="small"
                    type="number"
                    value={state.minZ ?? 0}
                    onChange={(e) => {
                        setState({
                            ...state,
                            minZ: e.target.value
                        })
                    }}
                />
            </div>
            <div className="modal-input">
                <label>Max Position: </label>
                <input
                    className="small"
                    type="number"
                    value={state.maxX ?? 0}
                    onChange={(e) => {
                        setState({
                            ...state,
                            maxX: e.target.value
                        })
                    }}
                />
                <input
                    className="small"
                    type="number"
                    value={state.maxY ?? 0}
                    onChange={(e) => {
                        setState({
                            ...state,
                            maxY: e.target.value
                        })
                    }}
                />
                <input
                    className="small"
                    type="number"
                    value={state.maxZ ?? 0}
                    onChange={(e) => {
                        setState({
                            ...state,
                            maxZ: e.target.value
                        })
                    }}
                />
            </div>
        </>
    )}
    
    <div className="checkbox-input-wrapper">
        <label>Import entire map?</label>
        <input
            type="checkbox"
            checked={state.importWholeMap ?? true}
            onChange={(e) =>
                setState({
                    ...state,
                    importWholeMap: e.target.checked,
                })
            }
        />
    </div>

    <div className="modal-buttons">
        <button
            className="menu-button"
            onClick={() => {
                setState({
                    ...state,
                    convertPhase: true
                })
            }}>
            Next
        </button>
        <button
            className="menu-button"
            onClick={() => {
                cleanupMinecraftImportData(setState);
                setShowModal(false);
            }}>
            Cancel
        </button>
    </div>
</>
);

const ConvertModal = ({state, setState, setShowModal, setImportedMap}) => (
<>
    <h3 className="modal-title">Configure Block Rules</h3>
    <p className="modal-description">Block rules are executed from top to bottom. Glob patterns can be used to match multiple blocks.</p>
						
    <div className="rules">
        {(state.blockMap || []).map((obj, index) => (
            <div key={index} className="convert-input">
                <input
                    className="mc-name"
                    type="text"
                    value={obj.mcName}
                    onChange={(e) => {
                        let array = state.blockMap;
                        array[index].mcName = e.target.value
                        setState({
                            ...state,
                            blockMap: array
                        })
                    }}
                />
                <Select
                    // unstyled={true}
                    className="hytopia-block"
                    options={blockTypes.map((block) => ({ value: block.id, label: block.name }))}
                    value={{value: obj.hytopiaId, label: blockTypes.find(b => b.id === obj.hytopiaId).name}}
                    styles={{
                        container: (baseStyles, state) => ({
                            ...baseStyles,
                            width: "150px",
                            textAlign: "left",
                            color: "white",
                            ":hover": {
                                animation: "none",
                                borderColor: "none",
                                outlineColor: "red",
                            }
                        }),
                        placeholder: (baseStyles, state) => ({
                            ...baseStyles,
                            color: "white"
                        }),
                        singleValue: (baseStyles, state) => ({
                            ...baseStyles,
                            color: "white"
                        }),
                        valueContainer: (baseStyles, state) => ({
                            ...baseStyles,
                            color: "white"
                        }),
                        indicatorSeparator: (baseStyles, state) => ({
                            ...baseStyles,
                            backgroundColor: "rgba(241, 241, 241, 0.15)"
                        }),
                        indicatorSeparator: (baseStyles, state) => ({
                            ...baseStyles,
                            backgroundColor: "none"
                        }),
                        control: (baseStyles, state) => ({
                            ...baseStyles,
                            border: "1px solid rgba(241, 241, 241, 0.15)",
                            // padding: "6px 8px",
                            borderRadius: "4px",
                            backgroundColor: "rgba(30, 30, 30, 0.7)",
                            boxShadow: "none",
                            color: "white",

                            ":hover": {
                                animation: "none",
                                borderColor: "none",
                                outlineColor: "red",
                            }
                        }),
                        menu: (baseStyles, state) => ({
                            ...baseStyles,
                            border: "1px solid rgba(241, 241, 241, 0.15)",
                            borderRadius: "4px",
                            backgroundColor: "rgba(30, 30, 30, 0.7)",
                            border: "1px solid rgba(241, 241, 241, 0.15)",
                            color: "white",
                        }),

                        option: (baseStyles, state) => ({
                            ...baseStyles,
                            ":hover": {
                                backgroundColor: "gray",
                            },
                            ":focus": {
                                backgroundColor: "gray",
                            }
                
                        }), 
                    }}
                />
                <div className="buttons">
                    <button
                        disabled={index == 0}
                        onClick={(e) => {
                            let array = state.blockMap;
                            let tmp = array[index]
                            array[index] = array[index - 1]
                            array[index - 1] = tmp
                            setState({
                                ...state,
                                blockMap: array
                            })
                        }}
                    >
                        <FaChevronUp />
                    </button>
                    <button
                        disabled={index == state.blockMap?.length - 1 || 0}
                        onClick={(e) => {
                            if(e.target.disabled) return
                            let array = state.blockMap;
                            let tmp = array[index];
                            array[index] = array[index + 1];
                            array[index + 1] = tmp;
                            setState({
                                ...state,
                                blockMap: array
                            })
                        }}
                    >
                        <FaChevronDown />
                    </button>
                    <button
                        disabled={state.blockMap?.length < 2}
                        onClick={(e) => {
                            if(e.target.disabled) return
                            let array = state.blockMap;
                            array.splice(index, 1)
                            setState({
                                ...state,
                                blockMap: array
                            })
                        }}
                    >
                        <FaTrash />
                    </button>
                </div>
            </div>
        ))}
    </div>

    <div className="separator"></div>
    <div className="config-bottom">

        <Tooltip text="Add a new rule to the list">
            <button
                onClick={(e) => {
                    let array = state.blockMap;
                    array.push({
                        mcName: "changeme",
                        hytopiaId: 1
                    });
                    setState({
                        ...state,
                        blockMap: array
                    })
                }}
            >
                <FaPlus/>
            </button>
        </Tooltip>
        <Tooltip text="Json rule importing coming soon!">
            <button disabled={true}>
                <FaUpload/>
            </button>
        </Tooltip>
    </div>
    <div className="modal-buttons">
        <button
            className="menu-button"
            onClick={() => {
                setState({
                    ...state,
                    loadingPhase: true
                })

                const listener = (event) => {
                    const {
                        type,
                        message,
                        terrain
                    } = event.data;

                    if(type === "update") {
                        setState({
                            ...state,
                            loadingPhase: true,
                            loadingMessage: message
                        })

                    } else if(type === "failure") {
                        setState({
                            ...state,
                            loadingPhase: true,
                            loadingMessage: `Error: ${message}`
                        })
                        worker.removeEventListener("message", listener)
                    } else if(type === "success") {
                        setImportedMap(terrain);
                        // placeTerrain(terrain, terrainBuilderRef)
                        cleanupMinecraftImportData(setState)
                        setShowModal(false)
                        worker.removeEventListener("message", listener)
                    }

                }
                worker.addEventListener("message", listener)

                const message = {
                    file: state.file,
                    region: !state.importWholeMap ? {
                        minX: Math.min(Number.parseInt(state.minX ?? 0), Number.parseInt(state.maxX ?? 0)),
                        minY: Math.min(Number.parseInt(state.minY ?? 0), Number.parseInt(state.maxY ?? 0)),
                        minZ: Math.min(Number.parseInt(state.minZ ?? 0), Number.parseInt(state.maxZ ?? 0)),
                        maxX: Math.max(Number.parseInt(state.minX ?? 0), Number.parseInt(state.maxX ?? 0)),
                        maxY: Math.max(Number.parseInt(state.minY ?? 0), Number.parseInt(state.maxY ?? 0)),
                        maxZ: Math.max(Number.parseInt(state.minZ ?? 0), Number.parseInt(state.maxZ ?? 0)),
                    } : null,
                    rules: state.blockMap.reduce((obj, {mcName, hytopiaId}) => Object.assign(obj, {[mcName]: Math.floor(hytopiaId)}), {})
                };
                worker.postMessage(message)
            }}>
            Import
        </button>
        <button
            className="menu-button"
            onClick={() => {
                setState({
                    ...state,
                    convertPhase: false,
                })
            }}>
            Back
        </button>
    </div>
</>
)

const LoadingModal = ({state, setState, setShowModal}) => (
<>
    <h3 className="modal-title">Importing</h3>
    <p className="modal-description">Your world is being imported. This action can take a few minutes. You're free to switch tabs but don't close this one!</p>
    <div className="loading-center">
        <div className="loading-spinner"></div>
    </div>
    <p className="load-status">{ state.loadingMessage ?? "" }</p>
</>
);

const cleanupMinecraftImportData = (setState) => {
    setState({});
    document.getElementById("minecraftMapFileInput").parentNode.reset();
}

const handleMinecraftImportModalOverlayClick = (e, setState, setShowModal) => {
    // Only close if the click was directly on the overlay (not on the modal content)
    // if (e.target.className === 'modal-overlay') {
    //     cleanupMinecraftImportData(setState);
    //     setShowModal(false);
    // }
};

const onMinecraftMapFileSelected = (event, setState, setShowModal) => {
    if (event.target.files && event.target.files[0]) {
        setState({
            file: event.target.files[0]
        });
        setShowModal(true);
    }
};

export const generateDefaultBlockMap = (blockTypes) => {
    let map = [];

    map.push({
        mcName: "minecraft:dirt",
        hytopiaId: blockTypes.find((b) => b.name === "dirt").id
    });

    map.push({
        mcName: "minecraft:cobblestone",
        hytopiaId: blockTypes.find((b) => b.name === "cobblestone").id
    });
    
    map.push({
        mcName: "minecraft:grass_block",
        hytopiaId: blockTypes.find((b) => b.name === "grass").id
    });

    map.push({
        mcName: "minecraft:diamond_ore",
        hytopiaId: blockTypes.find((b) => b.name === "diamond-ore").id
    });
    
    map.push({
        mcName: "minecraft:iron_ore",
        hytopiaId: blockTypes.find((b) => b.name === "iron-ore").id
    });
    
    map.push({
        mcName: "minecraft:coal_ore",
        hytopiaId: blockTypes.find((b) => b.name === "coal-ore").id
    });
    
    map.push({
        mcName: "minecraft:gold_ore",
        hytopiaId: blockTypes.find((b) => b.name === "gold-ore").id
    });
    
    map.push({
        mcName: "minecraft:*_leaves",
        hytopiaId: blockTypes.find((b) => b.name === "oak-leaves").id
    });
    
    map.push({
        mcName: "minecraft:*_log",
        hytopiaId: blockTypes.find((b) => b.name === "log").id
    });
    
    map.push({
        mcName: "minecraft:*_planks",
        hytopiaId: blockTypes.find((b) => b.name === "oak-planks").id
    });

    map.push({
        mcName: "minecraft:{stone,andesite,granite,diorite}*",
        hytopiaId: blockTypes.find((b) => b.name === "stone").id
    });

    return map
}

const placeTerrain = (terrain, terrainBuilderRef) => new Promise(async (res, rej) => {
    await DatabaseManager.saveData(STORES.TERRAIN, "current", terrain);
    if(terrainBuilderRef) {
        await terrainBuilderRef.current.refreshTerrainFromDB();
    }
})