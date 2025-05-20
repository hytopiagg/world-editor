import React, {
    useRef,
    useEffect,
    useState,
    useCallback,
    forwardRef,
    useImperativeHandle,
    useMemo,
} from "react";
import PropTypes from "prop-types";
import { TOOLS } from "./EditorToolbar"; // Import TOOLS enum
import "../../css/TextureGenerationModal.css";

const GRID_SIZE = 24;
const DEFAULT_BG_COLOR = "#FFFFFF"; // White background for transparency representation
const ERASER_COLOR_RGBA = { r: 0, g: 0, b: 0, a: 0 }; // For direct ImageData manipulation
const ERASER_STYLE = "rgba(0,0,0,0)"; // For canvas fillStyle
const MAX_HISTORY = 30; // Limit undo steps

const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? {
              r: parseInt(result[1], 16),
              g: parseInt(result[2], 16),
              b: parseInt(result[3], 16),
          }
        : null;
};


const rgbaToHex = (r, g, b) => {
    return "#" + [r, g, b].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? "0" + hex : hex;
    }).join("");
};


const floodFillInternal = (imgData, startX, startY, fillColorRgba) => {
    const { width, height, data } = imgData;
    const startIdx = (startY * width + startX) * 4;
    const targetColor = [
        data[startIdx],
        data[startIdx + 1],
        data[startIdx + 2],
        data[startIdx + 3],
    ];

    if (
        targetColor[0] === fillColorRgba.r &&
        targetColor[1] === fillColorRgba.g &&
        targetColor[2] === fillColorRgba.b &&
        targetColor[3] === fillColorRgba.a * 255
    ) {
        return false; // No change needed
    }
    const queue = [[startX, startY]];
    const visited = new Set();
    const getColorAtPixel = (x, y) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return null;
        const index = (y * width + x) * 4;
        return [data[index], data[index + 1], data[index + 2], data[index + 3]];
    };
    const setColorAtPixel = (x, y) => {
        const index = (y * width + x) * 4;
        data[index] = fillColorRgba.r;
        data[index + 1] = fillColorRgba.g;
        data[index + 2] = fillColorRgba.b;
        data[index + 3] = fillColorRgba.a * 255; // Alpha needs to be 0-255
    };
    const isTargetColor = (color) => {
        if (!color) return false;
        return (
            color[0] === targetColor[0] &&
            color[1] === targetColor[1] &&
            color[2] === targetColor[2] &&
            color[3] === targetColor[3]
        );
    };
    let changed = false;
    while (queue.length > 0) {
        const [x, y] = queue.shift();
        const key = `${x},${y}`;
        if (x < 0 || x >= width || y < 0 || y >= height || visited.has(key)) {
            continue;
        }
        const currentColor = getColorAtPixel(x, y);
        if (isTargetColor(currentColor)) {
            setColorAtPixel(x, y);
            visited.add(key);
            changed = true;
            queue.push([x + 1, y]);
            queue.push([x - 1, y]);
            queue.push([x, y + 1]);
            queue.push([x, y - 1]);
        } else {
            visited.add(key); // Still mark visited
        }
    }
    return changed;
};

const PixelEditorCanvas = forwardRef(
    (
        {
            initialTextureObject,
            selectedTool,
            selectedColor,
            canvasSize = 480,
            selectedFace,
            onPixelUpdate,
            onColorPicked,
        },
        ref // Receive ref from parent
    ) => {
        const canvasRef = useRef(null);
        const [isDrawing, setIsDrawing] = useState(false);
        const pixelSize = canvasSize / GRID_SIZE;

        const startImageDataRef = useRef(null);

        const currentDrawingRef = useRef(null);


        const [isAltPressed, setIsAltPressed] = useState(false);
        const previousToolRef = useRef(null);


        const [history, setHistory] = useState([]);
        const [historyIndex, setHistoryIndex] = useState(-1);

        const currentImageData = useMemo(() => {
            if (historyIndex >= 0 && historyIndex < history.length) {
                return history[historyIndex];
            }
            return null;
        }, [history, historyIndex]);


        useEffect(() => {
            const handleKeyDown = (e) => {
                if (e.key === 'Alt' || e.keyCode === 18) {
                    e.preventDefault(); // Prevent browser's default behavior
                    if (!isAltPressed) {
                        setIsAltPressed(true);

                        previousToolRef.current = selectedTool;
                    }
                }
            };

            const handleKeyUp = (e) => {
                if (e.key === 'Alt' || e.keyCode === 18) {
                    e.preventDefault(); // Prevent browser's default behavior
                    setIsAltPressed(false);
                }
            };


            window.addEventListener('keydown', handleKeyDown);
            window.addEventListener('keyup', handleKeyUp);


            return () => {
                window.removeEventListener('keydown', handleKeyDown);
                window.removeEventListener('keyup', handleKeyUp);
            };
        }, [isAltPressed, selectedTool]);


        useEffect(() => {
            if (isAltPressed && onColorPicked) {

                if (selectedTool !== TOOLS.EYEDROPPER) {
                    previousToolRef.current = selectedTool;
                }

                if (onColorPicked && typeof onColorPicked.setTool === 'function') {
                    onColorPicked.setTool(TOOLS.EYEDROPPER);
                }
            } else if (!isAltPressed && previousToolRef.current !== null) {

                if (onColorPicked && typeof onColorPicked.setTool === 'function') {
                    onColorPicked.setTool(previousToolRef.current);
                }
                previousToolRef.current = null;
            }
        }, [isAltPressed, selectedTool, onColorPicked]);


        const drawVisualCanvas = useCallback(() => {
            console.log(
                "PixelEditorCanvas: Drawing canvas with historyIndex:",
                historyIndex
            );
            const displayCanvas = canvasRef.current;
            const ctx = displayCanvas?.getContext("2d");

            const imgData = currentDrawingRef.current || currentImageData;
            if (!ctx) return;
            console.log(
                "PixelEditorCanvas: Current image data present:",
                !!imgData
            );

            ctx.clearRect(0, 0, canvasSize, canvasSize);

            ctx.fillStyle = DEFAULT_BG_COLOR;
            ctx.fillRect(0, 0, canvasSize, canvasSize);
            const checkSize = pixelSize;
            ctx.fillStyle = "#e0e0e0";
            for (let y = 0; y < GRID_SIZE; y++) {
                for (let x = 0; x < GRID_SIZE; x++) {
                    if ((x + y) % 2 === 0) {
                        ctx.fillRect(
                            x * pixelSize,
                            y * pixelSize,
                            checkSize,
                            checkSize
                        );
                    }
                }
            }

            ctx.strokeStyle = "rgba(0, 0, 0, 0.1)";
            ctx.lineWidth = 1;
            for (let i = 0; i <= GRID_SIZE; i++) {
                ctx.beginPath();
                ctx.moveTo(i * pixelSize, 0);
                ctx.lineTo(i * pixelSize, canvasSize);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(0, i * pixelSize);
                ctx.lineTo(canvasSize, i * pixelSize);
                ctx.stroke();
            }

            if (imgData) {

                let hasVisiblePixels = false;
                let pixelCount = 0;
                for (let i = 0; i < imgData.data.length; i += 4) {
                    if (imgData.data[i + 3] > 0) {

                        pixelCount++;
                        hasVisiblePixels = true;
                    }
                }
                console.log(
                    `PixelEditorCanvas: Image has ${pixelCount} visible pixels`
                );
                const offscreenCanvas = document.createElement("canvas");
                offscreenCanvas.width = GRID_SIZE;
                offscreenCanvas.height = GRID_SIZE;
                const offCtx = offscreenCanvas.getContext("2d");
                if (offCtx) {

                    offCtx.putImageData(imgData, 0, 0);
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(
                        offscreenCanvas,
                        0,
                        0,
                        canvasSize,
                        canvasSize
                    );
                    console.log("PixelEditorCanvas: Drew image data to canvas");
                } else {
                    console.error(
                        "PixelEditorCanvas: Could not get offscreen context"
                    );
                }
            } else {
                console.warn("PixelEditorCanvas: No image data to draw");
            }
        }, [canvasSize, pixelSize, currentImageData, historyIndex]);

        useEffect(() => {
            console.log("PixelEditorCanvas: Initializing from texture object");
            const displayCanvas = canvasRef.current;
            const ctx = displayCanvas?.getContext("2d");
            let initialImageData = null;
            if (initialTextureObject?.image) {
                try {
                    const sourceCanvas = initialTextureObject.image;
                    if (sourceCanvas instanceof HTMLCanvasElement) {
                        const sourceCtx = sourceCanvas.getContext("2d", {
                            willReadFrequently: true,
                        });
                        if (sourceCtx) {
                            initialImageData = sourceCtx.getImageData(
                                0,
                                0,
                                GRID_SIZE,
                                GRID_SIZE
                            );
                            console.log(
                                "PixelEditorCanvas: Got ImageData from texture"
                            );
                        } else {
                            throw new Error(
                                "Failed to get context from source canvas."
                            );
                        }
                    } else {
                        throw new Error(
                            "Texture image source is not a Canvas element."
                        );
                    }
                } catch (error) {
                    console.error(
                        "Error getting ImageData from texture:",
                        error
                    );
                }
            }
            if (!initialImageData && ctx) {
                initialImageData = ctx.createImageData(GRID_SIZE, GRID_SIZE);
                console.log("PixelEditorCanvas: Created new empty ImageData");
            }

            if (initialImageData && history.length > 0) {
                console.log(
                    "PixelEditorCanvas: Re-initialization while history exists",
                    {
                        historyLength: history.length,
                        currentIndex: historyIndex,
                    }
                );

                if (historyIndex >= 0 && history[historyIndex]) {
                    let isDifferent = false;
                    for (
                        let i = 0;
                        i < history[historyIndex].data.length;
                        i++
                    ) {
                        if (
                            history[historyIndex].data[i] !==
                            initialImageData.data[i]
                        ) {
                            isDifferent = true;
                            console.log(
                                "PixelEditorCanvas: Texture changed externally!"
                            );
                            break;
                        }
                    }
                    console.log(
                        "PixelEditorCanvas: Texture differs from current state:",
                        isDifferent
                    );
                }
            }
            if (initialImageData) {

                const initialState = [initialImageData];
                setHistory(initialState);
                setHistoryIndex(0);
                console.log("PixelEditorCanvas: History initialized", {
                    historyLength: initialState.length,
                    initialIndex: 0,
                    canUndo: false,
                });
            } else {
                setHistory([]); // Reset history if initialization failed
                setHistoryIndex(-1);
                console.warn("PixelEditorCanvas: Failed to initialize history");
            }
        }, [initialTextureObject]); // Depend only on the texture object itself for init

        useEffect(() => {
            drawVisualCanvas();
        }, [currentImageData, drawVisualCanvas]);

        const pushHistory = (newImageData) => {

            let isDifferent = true;
            if (historyIndex >= 0 && history[historyIndex]) {
                isDifferent = false;
                for (let i = 0; i < history[historyIndex].data.length; i++) {
                    if (
                        history[historyIndex].data[i] !== newImageData.data[i]
                    ) {
                        isDifferent = true;
                        break;
                    }
                }
            }

            if (isDifferent) {
                console.log(
                    "PixelEditorCanvas: Pushing new history state - states differ"
                );

                setHistory((prevHistory) => {

                    const nextHistory = prevHistory.slice(0, historyIndex + 1);
                    nextHistory.push(newImageData);

                    const resultHistory =
                        nextHistory.length > MAX_HISTORY
                            ? nextHistory.slice(
                                  nextHistory.length - MAX_HISTORY
                              )
                            : nextHistory;
                    return resultHistory;
                });

                setHistoryIndex((prevIndex) => {
                    const newIndex = Math.min(prevIndex + 1, MAX_HISTORY - 1);

                    if (onPixelUpdate) {
                        onPixelUpdate(selectedFace, newImageData);
                    }

                    if (
                        ref.current &&
                        typeof ref.current.notifyHistoryChanged === "function"
                    ) {
                        const canUndo = newIndex > 0;
                        const canRedo = false; // Just pushed state, no redo available
                        ref.current.notifyHistoryChanged(canUndo, canRedo);
                    }
                    return newIndex;
                });
            } else {
                console.log(
                    "PixelEditorCanvas: Not pushing history - no difference detected"
                );
            }
        };

        const getCoords = (e) => {
            const canvas = canvasRef.current;
            if (!canvas) return null;
            const rect = canvas.getBoundingClientRect();
            const x = Math.floor((e.clientX - rect.left) / pixelSize);
            const y = Math.floor((e.clientY - rect.top) / pixelSize);
            if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
                return { x, y };
            }
            return null;
        };


        const getPixelColor = (x, y) => {
            if (!currentImageData || x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) {
                return null;
            }
            
            const index = (y * GRID_SIZE + x) * 4;
            const r = currentImageData.data[index];
            const g = currentImageData.data[index + 1];
            const b = currentImageData.data[index + 2];
            const a = currentImageData.data[index + 3];
            

            if (a === 0) return null;
            

            return rgbaToHex(r, g, b);
        };


        const updateImageDataPixel = (imgData, x, y, colorRgba) => {
            if (!imgData || x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE)
                return;
            const index = (y * GRID_SIZE + x) * 4;
            imgData.data[index] = colorRgba.r;
            imgData.data[index + 1] = colorRgba.g;
            imgData.data[index + 2] = colorRgba.b;
            imgData.data[index + 3] = colorRgba.a * 255;
        };

        const performDrawAction = (coords) => {
            if (!coords || !currentDrawingRef.current) return;
            const { x, y } = coords;
            let changed = false;
            if (selectedTool === TOOLS.PENCIL) {
                const colorRgba = { ...hexToRgb(selectedColor), a: 1 };
                updateImageDataPixel(
                    currentDrawingRef.current,
                    x,
                    y,
                    colorRgba
                );
                changed = true;
            } else if (selectedTool === TOOLS.ERASER) {
                updateImageDataPixel(
                    currentDrawingRef.current,
                    x,
                    y,
                    ERASER_COLOR_RGBA
                );
                changed = true;
            } else if (selectedTool === TOOLS.FILL) {
                const colorRgba =
                    selectedColor === ERASER_STYLE
                        ? ERASER_COLOR_RGBA
                        : { ...hexToRgb(selectedColor), a: 1 };
                changed = floodFillInternal(
                    currentDrawingRef.current,
                    x,
                    y,
                    colorRgba
                );
            }

            if (changed) {
                const displayCanvas = canvasRef.current;
                if (displayCanvas) {
                    const ctx = displayCanvas.getContext("2d");
                    if (ctx && selectedTool === TOOLS.PENCIL) {

                        const colorStyle = selectedColor;
                        ctx.fillStyle = colorStyle;
                        ctx.fillRect(
                            x * pixelSize,
                            y * pixelSize,
                            pixelSize,
                            pixelSize
                        );
                    } else if (ctx && selectedTool === TOOLS.ERASER) {

                        ctx.clearRect(
                            x * pixelSize,
                            y * pixelSize,
                            pixelSize,
                            pixelSize
                        );

                        if ((x + y) % 2 === 0) {
                            ctx.fillStyle = "#e0e0e0";
                        } else {
                            ctx.fillStyle = DEFAULT_BG_COLOR;
                        }
                        ctx.fillRect(
                            x * pixelSize,
                            y * pixelSize,
                            pixelSize,
                            pixelSize
                        );
                    } else {

                        drawVisualCanvas();
                    }
                }
            }
        };

        const handleMouseDown = (e) => {
            const coords = getCoords(e);
            if (!coords || !currentImageData) return;


            if (selectedTool === TOOLS.EYEDROPPER) {
                const color = getPixelColor(coords.x, coords.y);
                if (color && onColorPicked && typeof onColorPicked.pickColor === 'function') {
                    onColorPicked.pickColor(color);
                }
                return; // Don't proceed with drawing
            }


            startImageDataRef.current = new ImageData(
                new Uint8ClampedArray(currentImageData.data),
                GRID_SIZE,
                GRID_SIZE
            );

            currentDrawingRef.current = new ImageData(
                new Uint8ClampedArray(currentImageData.data),
                GRID_SIZE,
                GRID_SIZE
            );
            setIsDrawing(true);

            performDrawAction(coords);

            if (selectedTool === TOOLS.FILL) {
                handleMouseUp();
            }
        };
        const handleMouseMove = (e) => {

            if (selectedTool === TOOLS.EYEDROPPER) {
                return;
            }
            
            if (!isDrawing) return;
            const coords = getCoords(e);
            if (
                coords &&
                (selectedTool === TOOLS.PENCIL || selectedTool === TOOLS.ERASER)
            ) {
                performDrawAction(coords); // Draw for visual feedback only
            }
        };
        const handleMouseUp = () => {

            if (selectedTool === TOOLS.EYEDROPPER) {
                return;
            }
            
            if (!isDrawing) return;
            setIsDrawing(false);

            if (!startImageDataRef.current || !currentDrawingRef.current)
                return;

            let changed = false;
            const startData = startImageDataRef.current.data;
            const finalData = currentDrawingRef.current.data;
            for (let i = 0; i < startData.length; i++) {
                if (startData[i] !== finalData[i]) {
                    changed = true;
                    break;
                }
            }

            if (changed) {
                const finalImageData = new ImageData(
                    new Uint8ClampedArray(currentDrawingRef.current.data),
                    GRID_SIZE,
                    GRID_SIZE
                );
                pushHistory(finalImageData);
            }

            startImageDataRef.current = null;
            currentDrawingRef.current = null;
        };
        const handleMouseLeave = () => {

            if (isDrawing) {
                handleMouseUp();
            }
        };

        const undo = () => {
            console.log("PixelEditorCanvas: Undo");
            if (historyIndex > 0) {
                console.log(
                    "PixelEditorCanvas: Undo: historyIndex > 0",
                    historyIndex
                );
                const newIndex = historyIndex - 1;
                console.log("PixelEditorCanvas: Undo: newIndex", newIndex);

                if (history[historyIndex] && history[newIndex]) {
                    let diff = false;
                    for (
                        let i = 0;
                        i < history[historyIndex].data.length;
                        i++
                    ) {
                        if (
                            history[historyIndex].data[i] !==
                            history[newIndex].data[i]
                        ) {
                            diff = true;
                            console.log(
                                `PixelEditorCanvas: Undo: Found difference at index ${i}:`,
                                history[historyIndex].data[i],
                                "->",
                                history[newIndex].data[i]
                            );
                            break;
                        }
                    }
                    console.log("PixelEditorCanvas: States differ:", diff);
                }
                setHistoryIndex(newIndex);
                console.log(
                    "PixelEditorCanvas: After undo, canUndo should be:",
                    newIndex > 0
                );

                if (onPixelUpdate && history[newIndex]) {
                    console.log(
                        "PixelEditorCanvas: Undo: onPixelUpdate",
                        selectedFace,
                        history[newIndex]
                    );
                    onPixelUpdate(selectedFace, history[newIndex]);
                }

                if (
                    ref.current &&
                    typeof ref.current.notifyHistoryChanged === "function"
                ) {
                    const canUndo = newIndex > 0;
                    const canRedo = newIndex < history.length - 1;
                    ref.current.notifyHistoryChanged(canUndo, canRedo);
                }
            } else {
                console.log(
                    "PixelEditorCanvas: Cannot undo - at beginning of history"
                );
            }
        };
        const redo = () => {
            console.log("PixelEditorCanvas: Redo");
            if (historyIndex < history.length - 1) {
                const newIndex = historyIndex + 1;
                console.log("PixelEditorCanvas: Redo: newIndex", newIndex);
                setHistoryIndex(newIndex);
                console.log(
                    "PixelEditorCanvas: After redo, canRedo should be:",
                    newIndex < history.length - 1
                );

                if (onPixelUpdate && history[newIndex]) {
                    console.log(
                        "PixelEditorCanvas: Redo: onPixelUpdate",
                        selectedFace,
                        history[newIndex]
                    );
                    onPixelUpdate(selectedFace, history[newIndex]);
                }

                if (
                    ref.current &&
                    typeof ref.current.notifyHistoryChanged === "function"
                ) {
                    const canUndo = newIndex > 0;
                    const canRedo = newIndex < history.length - 1;
                    ref.current.notifyHistoryChanged(canUndo, canRedo);
                }
            } else {
                console.log(
                    "PixelEditorCanvas: Cannot redo - at end of history"
                );
            }
        };

        useImperativeHandle(
            ref,
            () => {
                const canUndo = historyIndex > 0;
                const canRedo = historyIndex < history.length - 1;
                console.log("PixelEditorCanvas: Updating imperative handle:", {
                    canUndo,
                    canRedo,
                    historyIndex,
                    historyLength: history.length,
                });

                const historyState = {
                    canUndo,
                    canRedo,
                    historyIndex,
                    historyLength: history.length,
                };
                return {
                    undo,
                    redo,
                    canUndo,
                    canRedo,

                    getHistoryState: () => historyState,

                    notifyHistoryChanged: (canUndoNow, canRedoNow) => {
                        console.log(
                            "PixelEditorCanvas: Notifying parent of history change:",
                            { canUndoNow, canRedoNow }
                        );

                    },
                };
            },
            [historyIndex, history.length]
        );
        return (
            <div className="flex p-3">
                <canvas
                    ref={canvasRef}
                    width={canvasSize}
                    height={canvasSize}
                    className="pixel-editor-canvas"
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseLeave}
                />
            </div>
        );
    }
);
PixelEditorCanvas.propTypes = {
    initialTextureObject: PropTypes.object, // Expect THREE.CanvasTexture
    selectedTool: PropTypes.string.isRequired,
    selectedColor: PropTypes.string.isRequired,
    canvasSize: PropTypes.number,
    selectedFace: PropTypes.string.isRequired,
    onPixelUpdate: PropTypes.func, // Expects (face, imageData) => void
    onColorPicked: PropTypes.object, // Object with pickColor and setTool functions
};

PixelEditorCanvas.displayName = "PixelEditorCanvas";
export default PixelEditorCanvas;
