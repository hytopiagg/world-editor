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

// Helper to convert hex (#RRGGBB) to {r, g, b}
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

// Helper to convert rgba to hex
const rgbaToHex = (r, g, b) => {
    return "#" + [r, g, b].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? "0" + hex : hex;
    }).join("");
};

// Flood fill needs to operate on the internal ImageData now
const floodFillInternal = (imgData, startX, startY, fillColorRgba) => {
    const { width, height, data } = imgData;
    const startIdx = (startY * width + startX) * 4;
    const targetColor = [
        data[startIdx],
        data[startIdx + 1],
        data[startIdx + 2],
        data[startIdx + 3],
    ];

    // Avoid filling if target is already the fill color
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

// Wrap component with forwardRef
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

        // Add ref to store the initial image state when drawing begins
        const startImageDataRef = useRef(null);
        // Add ref to track current drawing state without pushing to history
        const currentDrawingRef = useRef(null);

        // Alt key state tracking
        const [isAltPressed, setIsAltPressed] = useState(false);
        const previousToolRef = useRef(null);

        // History state
        const [history, setHistory] = useState([]);
        const [historyIndex, setHistoryIndex] = useState(-1);

        // Get current ImageData from history
        const currentImageData = useMemo(() => {
            if (historyIndex >= 0 && historyIndex < history.length) {
                return history[historyIndex];
            }
            return null;
        }, [history, historyIndex]);

        // Effect to handle Alt key events
        useEffect(() => {
            const handleKeyDown = (e) => {
                if (e.key === 'Alt' || e.keyCode === 18) {
                    e.preventDefault(); // Prevent browser's default behavior
                    if (!isAltPressed) {
                        setIsAltPressed(true);
                        // Store the current tool when Alt is first pressed
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

            // Add event listeners
            window.addEventListener('keydown', handleKeyDown);
            window.addEventListener('keyup', handleKeyUp);

            // Clean up
            return () => {
                window.removeEventListener('keydown', handleKeyDown);
                window.removeEventListener('keyup', handleKeyUp);
            };
        }, [isAltPressed, selectedTool]);

        // Effect to switch to eyedropper when Alt is pressed
        useEffect(() => {
            if (isAltPressed && onColorPicked) {
                // Only store the previous tool if not already the eyedropper
                if (selectedTool !== TOOLS.EYEDROPPER) {
                    previousToolRef.current = selectedTool;
                }
                // Switch to eyedropper tool
                if (onColorPicked && typeof onColorPicked.setTool === 'function') {
                    onColorPicked.setTool(TOOLS.EYEDROPPER);
                }
            } else if (!isAltPressed && previousToolRef.current !== null) {
                // Switch back to previous tool when Alt is released
                if (onColorPicked && typeof onColorPicked.setTool === 'function') {
                    onColorPicked.setTool(previousToolRef.current);
                }
                previousToolRef.current = null;
            }
        }, [isAltPressed, selectedTool, onColorPicked]);

        // Function to draw the visual canvas based on currentImageData
        const drawVisualCanvas = useCallback(() => {
            console.log(
                "PixelEditorCanvas: Drawing canvas with historyIndex:",
                historyIndex
            );
            const displayCanvas = canvasRef.current;
            const ctx = displayCanvas?.getContext("2d");
            // Use current drawing data if available (during active drawing), otherwise use history
            const imgData = currentDrawingRef.current || currentImageData;
            if (!ctx) return;

            console.log(
                "PixelEditorCanvas: Current image data present:",
                !!imgData
            );

            // Force clear the canvas first to ensure we're starting fresh
            ctx.clearRect(0, 0, canvasSize, canvasSize);

            // Draw checkerboard background
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

            // *** Draw the grid lines FIRST ***
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

            // *** Draw the pixel data LAST (on top of the grid) ***
            if (imgData) {
                // Check if we have non-transparent pixels in the image data
                let hasVisiblePixels = false;
                let pixelCount = 0;
                for (let i = 0; i < imgData.data.length; i += 4) {
                    if (imgData.data[i + 3] > 0) {
                        // If alpha channel > 0
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
                    // Check if context was obtained
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

        // Effect to initialize history from texture object
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

            // Check if we're already in history mode and have changes
            if (initialImageData && history.length > 0) {
                console.log(
                    "PixelEditorCanvas: Re-initialization while history exists",
                    {
                        historyLength: history.length,
                        currentIndex: historyIndex,
                    }
                );
                // Compare with current state
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
                // For fresh textures, set historyIndex to 0 to disable undo initially
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

        // Effect to draw canvas whenever the current image data changes
        useEffect(() => {
            drawVisualCanvas();
        }, [currentImageData, drawVisualCanvas]);

        // Helper to add a new state to history
        const pushHistory = (newImageData) => {
            // Check if the new state is different from the current state
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

            // Only push if there's an actual change
            if (isDifferent) {
                console.log(
                    "PixelEditorCanvas: Pushing new history state - states differ"
                );

                // Use functional update for history to prevent race conditions
                setHistory((prevHistory) => {
                    // Discard redo states
                    const nextHistory = prevHistory.slice(0, historyIndex + 1);
                    nextHistory.push(newImageData);

                    // Limit history size if needed
                    const resultHistory =
                        nextHistory.length > MAX_HISTORY
                            ? nextHistory.slice(
                                  nextHistory.length - MAX_HISTORY
                              )
                            : nextHistory;

                    return resultHistory;
                });

                // Update history index with functional update to avoid race conditions
                setHistoryIndex((prevIndex) => {
                    const newIndex = Math.min(prevIndex + 1, MAX_HISTORY - 1);

                    // Update external texture via callback
                    if (onPixelUpdate) {
                        onPixelUpdate(selectedFace, newImageData);
                    }

                    // IMPORTANT: Manually notify parent of undo/redo state change
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

        // Function to get canvas coordinates from mouse event
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

        // Get color at pixel position
        const getPixelColor = (x, y) => {
            if (!currentImageData || x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) {
                return null;
            }
            
            const index = (y * GRID_SIZE + x) * 4;
            const r = currentImageData.data[index];
            const g = currentImageData.data[index + 1];
            const b = currentImageData.data[index + 2];
            const a = currentImageData.data[index + 3];
            
            // If fully transparent, return null or a default
            if (a === 0) return null;
            
            // Convert to hex
            return rgbaToHex(r, g, b);
        };

        // Update pixel directly in a *copy* of the current ImageData
        const updateImageDataPixel = (imgData, x, y, colorRgba) => {
            if (!imgData || x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE)
                return;
            const index = (y * GRID_SIZE + x) * 4;
            imgData.data[index] = colorRgba.r;
            imgData.data[index + 1] = colorRgba.g;
            imgData.data[index + 2] = colorRgba.b;
            imgData.data[index + 3] = colorRgba.a * 255;
        };

        // Perform draw action without pushing to history (for active drawing)
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

            // If something changed, update canvas for immediate feedback
            if (changed) {
                const displayCanvas = canvasRef.current;
                if (displayCanvas) {
                    const ctx = displayCanvas.getContext("2d");
                    if (ctx && selectedTool === TOOLS.PENCIL) {
                        // For pencil, we can optimize by just updating the specific pixel
                        const colorStyle = selectedColor;
                        ctx.fillStyle = colorStyle;
                        ctx.fillRect(
                            x * pixelSize,
                            y * pixelSize,
                            pixelSize,
                            pixelSize
                        );
                    } else if (ctx && selectedTool === TOOLS.ERASER) {
                        // For eraser, clear the specific pixel
                        ctx.clearRect(
                            x * pixelSize,
                            y * pixelSize,
                            pixelSize,
                            pixelSize
                        );
                        // Redraw the checkerboard for this pixel
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
                        // For fill and other tools, redraw the entire canvas
                        drawVisualCanvas();
                    }
                }
            }
        };

        // Mouse Handlers - Rewritten to batch drawing operations
        const handleMouseDown = (e) => {
            const coords = getCoords(e);
            if (!coords || !currentImageData) return;

            // Handle eyedropper tool
            if (selectedTool === TOOLS.EYEDROPPER) {
                const color = getPixelColor(coords.x, coords.y);
                if (color && onColorPicked && typeof onColorPicked.pickColor === 'function') {
                    onColorPicked.pickColor(color);
                }
                return; // Don't proceed with drawing
            }

            // Save the starting snapshot before drawing
            startImageDataRef.current = new ImageData(
                new Uint8ClampedArray(currentImageData.data),
                GRID_SIZE,
                GRID_SIZE
            );

            // Create a working copy for the current drawing session
            currentDrawingRef.current = new ImageData(
                new Uint8ClampedArray(currentImageData.data),
                GRID_SIZE,
                GRID_SIZE
            );

            setIsDrawing(true);

            // Perform the initial draw action without pushing to history
            performDrawAction(coords);

            // Special handling for fill tool (commit immediately)
            if (selectedTool === TOOLS.FILL) {
                handleMouseUp();
            }
        };

        const handleMouseMove = (e) => {
            // If eyedropper active, don't prevent motion
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
            // If eyedropper active, don't process drawing end
            if (selectedTool === TOOLS.EYEDROPPER) {
                return;
            }
            
            if (!isDrawing) return;
            setIsDrawing(false);

            // If we don't have both refs, we can't complete the operation
            if (!startImageDataRef.current || !currentDrawingRef.current)
                return;

            // Compare start snapshot with final state to check if changes occurred
            let changed = false;
            const startData = startImageDataRef.current.data;
            const finalData = currentDrawingRef.current.data;

            for (let i = 0; i < startData.length; i++) {
                if (startData[i] !== finalData[i]) {
                    changed = true;
                    break;
                }
            }

            // If changes were made, push the final state to history
            if (changed) {
                const finalImageData = new ImageData(
                    new Uint8ClampedArray(currentDrawingRef.current.data),
                    GRID_SIZE,
                    GRID_SIZE
                );

                pushHistory(finalImageData);
            }

            // Clear the drawing refs
            startImageDataRef.current = null;
            currentDrawingRef.current = null;
        };

        const handleMouseLeave = () => {
            // Treat mouse leave as mouse up to commit any changes
            if (isDrawing) {
                handleMouseUp();
            }
        };

        // --- Undo/Redo Logic ---
        const undo = () => {
            console.log("PixelEditorCanvas: Undo");
            if (historyIndex > 0) {
                console.log(
                    "PixelEditorCanvas: Undo: historyIndex > 0",
                    historyIndex
                );
                const newIndex = historyIndex - 1;
                console.log("PixelEditorCanvas: Undo: newIndex", newIndex);

                // DEBUG: Check if the states actually differ
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

                // Update external texture
                if (onPixelUpdate && history[newIndex]) {
                    console.log(
                        "PixelEditorCanvas: Undo: onPixelUpdate",
                        selectedFace,
                        history[newIndex]
                    );
                    onPixelUpdate(selectedFace, history[newIndex]);
                }

                // Directly notify parent of change in undo/redo state
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

                // Update external texture
                if (onPixelUpdate && history[newIndex]) {
                    console.log(
                        "PixelEditorCanvas: Redo: onPixelUpdate",
                        selectedFace,
                        history[newIndex]
                    );
                    onPixelUpdate(selectedFace, history[newIndex]);
                }

                // Directly notify parent of change in undo/redo state
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

        // Expose undo/redo via ref
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

                // Create an object with history state that won't change between renders
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
                    // Direct mechanism for the parent to get the current history state
                    getHistoryState: () => historyState,
                    // Method to notify the parent of history changes
                    notifyHistoryChanged: (canUndoNow, canRedoNow) => {
                        console.log(
                            "PixelEditorCanvas: Notifying parent of history change:",
                            { canUndoNow, canRedoNow }
                        );
                        // This is a method the parent component can call to update
                    },
                };
            },
            [historyIndex, history.length]
        );

        return (
            <div className="pixel-editor-wrapper">
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

// Add display name for debugging
PixelEditorCanvas.displayName = "PixelEditorCanvas";

export default PixelEditorCanvas;
