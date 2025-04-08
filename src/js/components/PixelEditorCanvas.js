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
import "../../css/PixelEditorCanvas.css";

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
        },
        ref // Receive ref from parent
    ) => {
        const canvasRef = useRef(null);
        // internalImageDataRef no longer needed, history is the source of truth
        const [isDrawing, setIsDrawing] = useState(false);
        const pixelSize = canvasSize / GRID_SIZE;

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

        // Function to draw the visual canvas based on currentImageData
        const drawVisualCanvas = useCallback(() => {
            const displayCanvas = canvasRef.current;
            const ctx = displayCanvas?.getContext("2d");
            const imgData = currentImageData; // Use current state from history
            if (!ctx) return;

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
                }
            }
        }, [canvasSize, pixelSize, currentImageData]);

        // Effect to initialize history from texture object
        useEffect(() => {
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
            }

            if (initialImageData) {
                setHistory([initialImageData]); // Start history with the initial state
                setHistoryIndex(0);
            } else {
                setHistory([]); // Reset history if initialization failed
                setHistoryIndex(-1);
            }
        }, [initialTextureObject]); // Depend only on the texture object itself for init

        // Effect to draw canvas whenever the current image data changes
        useEffect(() => {
            drawVisualCanvas();
        }, [currentImageData, drawVisualCanvas]);

        // Helper to add a new state to history
        const pushHistory = (newImageData) => {
            setHistory((prevHistory) => {
                const nextHistory = prevHistory.slice(0, historyIndex + 1); // Discard redo states
                nextHistory.push(newImageData);
                // Limit history size
                if (nextHistory.length > MAX_HISTORY) {
                    return nextHistory.slice(nextHistory.length - MAX_HISTORY);
                }
                return nextHistory;
            });
            // Calculate the new index based on the potentially sliced history
            const limitedHistoryLength = Math.min(
                history.slice(0, historyIndex + 1).length + 1,
                MAX_HISTORY
            );
            setHistoryIndex(limitedHistoryLength - 1);

            // Update the external texture via callback
            if (onPixelUpdate) {
                onPixelUpdate(selectedFace, newImageData);
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

        // Perform draw action: modify a *copy* and push to history
        const performDrawAction = (coords, isFinalAction = false) => {
            if (!coords || !currentImageData) return;
            const { x, y } = coords;

            // Create a mutable copy of the current state ONLY if needed
            let nextImageData = null;
            let changed = false;

            const ensureMutableCopy = () => {
                if (!nextImageData) {
                    // Create a new ImageData by copying the current one's data
                    nextImageData = new ImageData(
                        new Uint8ClampedArray(currentImageData.data),
                        GRID_SIZE,
                        GRID_SIZE
                    );
                }
            };

            if (selectedTool === TOOLS.PENCIL) {
                ensureMutableCopy();
                const colorRgba = { ...hexToRgb(selectedColor), a: 1 };
                updateImageDataPixel(nextImageData, x, y, colorRgba);
                changed = true;
            } else if (selectedTool === TOOLS.ERASER) {
                ensureMutableCopy();
                updateImageDataPixel(nextImageData, x, y, ERASER_COLOR_RGBA);
                changed = true;
            } else if (selectedTool === TOOLS.FILL && isFinalAction) {
                // Only fill on final action (e.g., mouse up)
                ensureMutableCopy();
                const colorRgba =
                    selectedColor === ERASER_STYLE
                        ? ERASER_COLOR_RGBA
                        : { ...hexToRgb(selectedColor), a: 1 };
                changed = floodFillInternal(nextImageData, x, y, colorRgba); // Flood fill modifies the copy
            }

            // If something changed, push the modified copy to history
            if (changed && nextImageData) {
                pushHistory(nextImageData);
            }
        };

        // Mouse Handlers
        const handleMouseDown = (e) => {
            const coords = getCoords(e);
            if (!coords) return;
            setIsDrawing(true);
            performDrawAction(coords, selectedTool === TOOLS.FILL); // Fill acts on down/up
        };

        const handleMouseMove = (e) => {
            if (!isDrawing) return;
            const coords = getCoords(e);
            // Only pencil/eraser draw continuously on drag
            if (
                coords &&
                (selectedTool === TOOLS.PENCIL || selectedTool === TOOLS.ERASER)
            ) {
                performDrawAction(coords);
            }
        };

        const handleMouseUp = () => {
            if (isDrawing) {
                setIsDrawing(false);
                // Potentially commit final state for tools that need it?
                // Currently handled by pushing history on each change.
            }
        };

        const handleMouseLeave = () => {
            if (isDrawing) {
                setIsDrawing(false);
            }
        };

        // --- Undo/Redo Logic ---
        const undo = () => {
            if (historyIndex > 0) {
                const newIndex = historyIndex - 1;
                setHistoryIndex(newIndex);
                // Update external texture
                if (onPixelUpdate && history[newIndex]) {
                    onPixelUpdate(selectedFace, history[newIndex]);
                }
            }
        };

        const redo = () => {
            if (historyIndex < history.length - 1) {
                const newIndex = historyIndex + 1;
                setHistoryIndex(newIndex);
                // Update external texture
                if (onPixelUpdate && history[newIndex]) {
                    onPixelUpdate(selectedFace, history[newIndex]);
                }
            }
        };

        // Expose undo/redo via ref
        useImperativeHandle(ref, () => ({
            undo,
            redo,
            canUndo: historyIndex > 0,
            canRedo: historyIndex < history.length - 1,
        }));

        return (
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
};

// Add display name for debugging
PixelEditorCanvas.displayName = "PixelEditorCanvas";

export default PixelEditorCanvas;
