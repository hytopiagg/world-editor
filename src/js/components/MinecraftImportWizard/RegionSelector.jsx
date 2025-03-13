import React, { useState, useEffect, useRef } from 'react';
import { 
  MAX_IMPORT_SIZE_X, 
  MAX_IMPORT_SIZE_Y, 
  MAX_IMPORT_SIZE_Z,
  DEFAULT_IMPORT_SIZE,
  CENTER_IMPORTS_AT_ORIGIN
} from '../../constants/terrain';
import { version } from '../../Constants';

// Minecraft 1.21 constants - bottom of the world is at Y=-69
const MINECRAFT_BOTTOM_Y = -69;

// Add CSS for the vertical slider
const sliderStyles = `
  .region-selector .vertical-slider-container {
    display: flex;
    align-items: stretch;
    height: 300px;
    margin: 20px 0;
  }
  
  .region-selector .y-axis-labels {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding-right: 10px;
    font-weight: bold;
    color: white;
  }
  
  .region-selector .vertical-slider {
    position: relative;
    width: 80px;
    background-color: #222;
    border: 1px solid #444;
    border-radius: 4px;
    flex-grow: 1;
    overflow: visible;
  }
  
  .region-selector .y-info {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding-left: 15px;
    color: white;
  }
  
  .region-selector .vertical-slider .info-item {
    margin: 5px 0;
  }
  
  .region-selector .vertical-slider .slider-handle {
    z-index: 10;
    user-select: none;
    touch-action: none;
    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    transition: background-color 0.2s;
  }
  
  .region-selector .vertical-slider .slider-handle:hover {
    background-color: rgba(255, 255, 255, 0.5) !important;
  }
  
  .region-selector .vertical-slider .slider-handle.dragging {
    background-color: rgba(255, 255, 255, 0.6) !important;
    box-shadow: 0 4px 8px rgba(0,0,0,0.5);
  }
  
  .region-selector .vertical-slider .selected-height-bar {
    transition: top 0.1s, height 0.1s;
  }
`;

// Add CSS for the vertical range bars
const rangeStyles = `
  .region-selector .y-range-container {
    display: flex;
    align-items: stretch;
    margin: 20px 0;
    padding: 15px;
    background-color: #222;
    border-radius: 4px;
  }
  
  .region-selector .y-axis-labels {
    display: flex;
    flex-direction: column;
    justify-content: space-around;
    padding-right: 20px;
    color: white;
    font-weight: bold;
    min-width: 150px;
  }
  
  .region-selector .vertical-range-bars {
    display: flex;
    justify-content: space-around;
    flex-grow: 1;
    padding: 0 20px;
  }
  
  .region-selector .range-bar-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 0 15px;
  }
  
  .region-selector .range-bar-container label {
    margin-bottom: 10px;
    color: white;
    font-weight: bold;
    text-align: center;
  }
  
  .region-selector .vertical-range {
    -webkit-appearance: slider-vertical;
    width: 60px;
    height: 250px;
    margin: 0;
    padding: 0;
    writing-mode: bt-lr; /* IE */
    -webkit-appearance: slider-vertical; /* WebKit */
    appearance: slider-vertical;
  }
  
  /* Firefox-specific styles */
  @-moz-document url-prefix() {
    .region-selector .vertical-range {
      transform: rotate(270deg);
      width: 250px;
      height: 60px;
      margin: 95px -95px;
    }
    
    .region-selector .range-bar-container {
      height: 250px;
      position: relative;
    }
  }
  
  .region-selector .top-range::-webkit-slider-thumb {
    background-color: #4caf50;
  }
  
  .region-selector .bottom-range::-webkit-slider-thumb {
    background-color: #ff9800;
  }
  
  .region-selector .y-info {
    padding-left: 20px;
    border-left: 1px solid #444;
    color: white;
    min-width: 200px;
  }
  
  .region-selector .minecraft-info h5 {
    margin-top: 0;
    margin-bottom: 10px;
    color: #2196f3;
  }
  
  .region-selector .minecraft-info p {
    margin: 5px 0;
  }
  
  .region-selector .minecraft-info ul {
    margin: 5px 0;
    padding-left: 20px;
  }
  
  .region-selector .minecraft-info li {
    margin: 3px 0;
  }
`;

// Add CSS for the Y selection with numeric inputs
const ySelectionStyles = `
  .region-selector .y-selection-container {
    background-color: #222;
    border-radius: 4px;
    padding: 20px;
    margin: 20px 0;
  }
  
  .region-selector .y-info-panel {
    color: white;
  }
  
  .region-selector .y-info-panel h5 {
    margin-top: 0;
    margin-bottom: 10px;
    color: #2196f3;
    font-size: 16px;
  }
  
  .region-selector .y-info-panel p {
    margin: 5px 0;
  }
  
  .region-selector .y-info-panel ul {
    margin: 5px 0 15px 0;
    padding-left: 20px;
  }
  
  .region-selector .y-info-panel li {
    margin: 3px 0;
  }
  
  .region-selector .y-inputs {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    margin-bottom: 20px;
  }
  
  .region-selector .y-input-group {
    flex: 1;
    min-width: 200px;
  }
  
  .region-selector .y-input-group label {
    display: block;
    margin-bottom: 5px;
    font-weight: bold;
  }
  
  .region-selector .y-input {
    width: 100%;
    padding: 8px 12px;
    border: 2px solid #444;
    border-radius: 4px;
    background-color: #333;
    color: white;
    font-size: 16px;
  }
  
  .region-selector .top-y {
    border-color: #4caf50;
  }
  
  .region-selector .bottom-y {
    border-color: #ff9800;
  }
  
  .region-selector .y-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 15px;
    padding-top: 15px;
    border-top: 1px solid #444;
  }
  
  .region-selector .stat-item {
    background-color: #333;
    padding: 8px 12px;
    border-radius: 4px;
    flex: 1;
    min-width: 120px;
    text-align: center;
  }
  
  .region-selector .stat-label {
    font-weight: bold;
    margin-right: 5px;
  }
  
  .region-selector .stat-value {
    color: #2196f3;
  }
`;

// Add CSS for the vertical box
const verticalBoxStyles = `
  .region-selector .vertical-box-container {
    display: flex;
    align-items: stretch;
    margin: 20px 0;
  }
  
  .region-selector .y-axis-labels {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding-right: 10px;
    font-weight: bold;
    color: white;
    min-width: 40px;
  }
  
  .region-selector .vertical-box-wrapper {
    position: relative;
    width: 150px;
    height: 300px;
    margin-right: 20px;
  }
  
  .region-selector .world-height-box {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: #333;
    border: 1px dashed #666;
    border-radius: 4px;
  }
  
  .region-selector .selected-height-box {
    position: absolute;
    left: 0;
    width: 100%;
    background-color: rgba(33, 150, 243, 0.3);
    border: 2px solid #2196f3;
    box-sizing: border-box;
    transition: top 0.1s, height 0.1s;
  }
  
  .region-selector .y-handle {
    position: absolute;
    left: 0;
    width: 100%;
    height: 35px;
    background-color: rgba(255, 255, 255, 0.4);
    border: 3px solid #2196f3;
    cursor: ns-resize;
    box-sizing: border-box;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px;
    transition: background-color 0.2s;
  }
  
  .region-selector .y-handle:before {
    content: "≡";
    font-size: 20px;
    color: white;
    font-weight: bold;
  }
  
  .region-selector .y-handle:hover {
    background-color: rgba(255, 255, 255, 0.6) !important;
  }
  
  .region-selector .top-handle {
    top: 0;
    transform: translateY(-50%);
    border-color: #4caf50;
  }
  
  .region-selector .bottom-handle {
    bottom: 0;
    transform: translateY(50%);
    border-color: #ff9800;
  }
  
  .region-selector .handle-label {
    color: white;
    font-weight: bold;
    font-size: 12px;
    background-color: rgba(0, 0, 0, 0.7);
    padding: 2px 6px;
    border-radius: 4px;
  }
  
  .region-selector .y-info {
    display: flex;
    flex-direction: column;
    justify-content: center;
    color: white;
  }
  
  .region-selector .info-item {
    margin: 5px 0;
  }
  
  .region-selector .info-label {
    font-weight: bold;
    margin-right: 5px;
  }
  
  .region-selector .info-value {
    color: #2196f3;
  }
`;

// Add CSS for the world version information and warning
const versionInfoStyles = `
  .region-selector .world-version-info {
    background-color: #222;
    border-radius: 4px;
    padding: 15px;
    margin: 20px 0;
    color: white;
  }
  
  .region-selector .world-version-info h4 {
    margin-top: 0;
    margin-bottom: 10px;
    color: #2196f3;
  }
  
  .region-selector .world-version-info p {
    margin: 5px 0;
  }
  
  .region-selector .version-compatible {
    color: #4caf50;
    font-weight: bold;
  }
  
  .region-selector .version-newer {
    color: #ff9800;
    font-weight: bold;
  }
  
  .region-selector .version-older {
    color: #f44336;
    font-weight: bold;
  }
  
  .region-selector .world-version-info.version-warning {
    border: 2px solid #f44336;
    background-color: rgba(244, 67, 54, 0.1);
  }
  
  .region-selector .version-warning-message {
    margin-top: 10px;
    padding: 10px;
    background-color: rgba(244, 67, 54, 0.2);
    border-left: 4px solid #f44336;
  }
  
  .region-selector .version-warning-message p {
    margin: 5px 0;
  }
`;

const RegionSelector = ({ worldData, onRegionSelected, initialRegion }) => {
  // State for region bounds
  const [bounds, setBounds] = useState({
    minX: 0, minY: 0, minZ: 0,
    maxX: 0, maxY: 0, maxZ: 0
  });
  
  // State for region size
  const [size, setSize] = useState({
    x: DEFAULT_IMPORT_SIZE * 2,
    y: 64,
    z: DEFAULT_IMPORT_SIZE * 2
  });
  
  // State for center point
  const [center, setCenter] = useState({
    x: 0, y: 0, z: 0
  });
  
  // State for offsets
  const [offsets, setOffsets] = useState({
    x: 0,
    z: 0
  });
  
  // State for drag operation
  const [dragOperation, setDragOperation] = useState(null);
  const [dragStartCoords, setDragStartCoords] = useState({ x: 0, z: 0, y: 0 });
  const [dragStartBounds, setDragStartBounds] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [justFinishedDrag, setJustFinishedDrag] = useState(false);
  
  // State for Y-axis drag operation
  const [yDragOperation, setYDragOperation] = useState(null);
  
  const [isValid, setIsValid] = useState(false);
  // Add ref to track previous values to avoid infinite loops
  const prevBoundsRef = useRef(null);
  const prevOffsetsRef = useRef(null);
  const worldInitializedRef = useRef(false);

  // State for the visualization
  const [viewBox, setViewBox] = useState('-10 -10 20 20');
  const svgRef = useRef(null);
  const worldSize = {
    width: worldData?.bounds ? worldData.bounds.maxX - worldData.bounds.minX + 1 : 100,
    depth: worldData?.bounds ? worldData.bounds.maxZ - worldData.bounds.minZ + 1 : 100,
    height: worldData?.bounds ? worldData.bounds.maxY - worldData.bounds.minY + 1 : 100
  };

  // Add state for version compatibility
  const [isVersionCompatible, setIsVersionCompatible] = useState(true);
  
  // Check world version compatibility
  useEffect(() => {
    if (worldData && worldData.worldVersion) {
      // Minecraft 1.21 is Data Version 3953
      setIsVersionCompatible(worldData.worldVersion >= 3953);
    }
  }, [worldData]);

  // Add padding around the world bounds
  const padding = Math.max(worldSize.width, worldSize.depth) * 0.1;
  const heightPadding = worldSize.height * 0.1;
  
  // State for hover coordinates
  const [hoverCoords, setHoverCoords] = useState({ x: 0, z: 0, y: 0, show: false });

  // Initialize from worldData or initialRegion
  useEffect(() => {
    if (initialRegion && !worldInitializedRef.current) {
      setBounds(initialRegion);
      
      // Calculate size from bounds
      const sizeX = initialRegion.maxX - initialRegion.minX + 1;
      const sizeY = initialRegion.maxY - initialRegion.minY + 1;
      const sizeZ = initialRegion.maxZ - initialRegion.minZ + 1;
      
      setSize({
        x: sizeX,
        y: sizeY,
        z: sizeZ
      });
      
      // Calculate center
      const centerX = Math.floor((initialRegion.minX + initialRegion.maxX) / 2);
      const centerY = Math.floor((initialRegion.minY + initialRegion.maxY) / 2);
      const centerZ = Math.floor((initialRegion.minZ + initialRegion.maxZ) / 2);
      
      setCenter({
        x: centerX,
        y: centerY,
        z: centerZ
      });
      
      // Set offsets if they exist
      if (initialRegion.offsetX !== undefined || initialRegion.offsetZ !== undefined) {
        setOffsets({
          x: initialRegion.offsetX || 0,
          z: initialRegion.offsetZ || 0
        });
      }
      
      worldInitializedRef.current = true;
    } else if (worldData && worldData.bounds && !worldInitializedRef.current) {
      selectEntireWorld();
      worldInitializedRef.current = true;
    }
  }, [worldData, initialRegion]);

  // Force a recalculation of the height bars when the component is mounted
  useEffect(() => {
    if (worldData?.bounds && bounds) {
      // Force a layout recalculation by creating a small, temporary state update
      const currentHeight = size.y;
      const tempHeight = currentHeight + 1;
      
      // Apply a quick change and revert back to force the bars to update visually
      setTimeout(() => {
        setSize(prevSize => ({...prevSize, y: tempHeight}));
        
        // Revert back to the original height after a short delay
        setTimeout(() => {
          setSize(prevSize => ({...prevSize, y: currentHeight}));
        }, 50);
      }, 100);
    }
  }, [worldData?.bounds, bounds]);

  // Update bounds whenever size or center changes
  useEffect(() => {
    if (!center) return;
    
    // Calculate half-sizes (rounded down)
    const halfX = Math.floor(size.x / 2);
    const halfZ = Math.floor(size.z / 2);
    
    // Calculate new bounds based on center and size
    const newBounds = {
      minX: center.x - halfX,
      maxX: center.x + halfX + (size.x % 2 === 0 ? -1 : 0),
      minY: center.y - Math.floor(size.y / 2),
      maxY: Math.min(
        worldData?.bounds?.maxY || 255, 
        center.y + Math.floor(size.y / 2) + (size.y % 2 === 0 ? -1 : 0)
      ),
      minZ: center.z - halfZ,
      maxZ: center.z + halfZ + (size.z % 2 === 0 ? -1 : 0)
    };
    
    setBounds(newBounds);
  }, [size, center, worldData]);

  // Calculate dimensions based on bounds
  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  const depth = bounds.maxZ - bounds.minZ + 1;
  const blockCount = width * height * depth;

  // Update validity whenever dimensions change
  useEffect(() => {
    setIsValid(width > 0 && height > 0 && depth > 0);
  }, [width, height, depth]);

  // When bounds or offsets change and they're valid, apply size limits and notify parent
  useEffect(() => {
    if (!isValid) return;
    
    // Apply size limits
    const trimmedBounds = {
      minX: bounds.minX,
      minY: bounds.minY,
      minZ: bounds.minZ,
      maxX: Math.min(bounds.maxX, bounds.minX + MAX_IMPORT_SIZE_X - 1),
      maxY: Math.min(bounds.maxY, bounds.minY + MAX_IMPORT_SIZE_Y - 1),
      maxZ: Math.min(bounds.maxZ, bounds.minZ + MAX_IMPORT_SIZE_Z - 1)
    };
    
    // Check if bounds or offsets have actually changed to avoid infinite loop
    const prevBounds = prevBoundsRef.current;
    const prevOffsets = prevOffsetsRef.current || { x: 0, z: 0 };
    
    const boundsChanged = !prevBounds || 
      prevBounds.minX !== trimmedBounds.minX ||
      prevBounds.minY !== trimmedBounds.minY ||
      prevBounds.minZ !== trimmedBounds.minZ ||
      prevBounds.maxX !== trimmedBounds.maxX ||
      prevBounds.maxY !== trimmedBounds.maxY ||
      prevBounds.maxZ !== trimmedBounds.maxZ;
    
    const offsetsChanged = prevOffsets.x !== offsets.x || prevOffsets.z !== offsets.z;
    
    if (boundsChanged || offsetsChanged) {
      // Update the previous bounds and offsets reference
      prevBoundsRef.current = { ...trimmedBounds };
      prevOffsetsRef.current = { ...offsets };
      
      // Update the size if bounds were trimmed
      if (
        trimmedBounds.maxX - trimmedBounds.minX + 1 !== width ||
        trimmedBounds.maxY - trimmedBounds.minY + 1 !== height ||
        trimmedBounds.maxZ - trimmedBounds.minZ + 1 !== depth
      ) {
        setSize({
          x: trimmedBounds.maxX - trimmedBounds.minX + 1,
          y: trimmedBounds.maxY - trimmedBounds.minY + 1,
          z: trimmedBounds.maxZ - trimmedBounds.minZ + 1
        });
      }
      
      // Call the callback with the trimmed bounds and offsets
      onRegionSelected({
        ...trimmedBounds,
        offsetX: offsets.x,
        offsetZ: offsets.z
      });
    }
  }, [bounds.minX, bounds.minY, bounds.minZ, bounds.maxX, bounds.maxY, bounds.maxZ, offsets.x, offsets.z, isValid, width, height, depth]);

  const handleSizeChange = (axis, value) => {
    // Basic validation
    if (value === '' || value === '0') {
      return;
    }
    
    const numValue = parseInt(value, 10);
    if (isNaN(numValue) || numValue <= 0) {
      return; // Don't update if not a valid positive number
    }
    
    // Apply max size limits
    const maxSize = axis === 'x' ? MAX_IMPORT_SIZE_X : (axis === 'y' ? MAX_IMPORT_SIZE_Y : MAX_IMPORT_SIZE_Z);
    const limitedValue = Math.min(numValue, maxSize);
    
    setSize(prev => ({
      ...prev,
      [axis]: limitedValue
    }));
  };
  
  const handleCenterChange = (axis, value) => {
    // Allow empty field or minus sign for typing
    if (value === '' || value === '-') {
      return;
    }
    
    const numValue = parseInt(value, 10);
    if (isNaN(numValue)) {
      return; // Don't update if not a valid number
    }
    
    setCenter(prev => ({
      ...prev,
      [axis]: numValue
    }));
  };
  
  const handleOffsetChange = (axis, value) => {
    // Allow empty field or minus sign for typing
    if (value === '' || value === '-') {
      return;
    }
    
    const numValue = parseInt(value, 10);
    if (isNaN(numValue)) {
      return; // Don't update if not a valid number
    }
    
    setOffsets(prev => ({
      ...prev,
      [axis]: numValue
    }));
  };

  // Function to select the entire world
  const selectEntireWorld = () => {
    if (worldData && worldData.bounds) {
      const worldBounds = worldData.bounds;
      
      // Calculate size of the world
      const worldSizeX = Math.min(worldBounds.maxX - worldBounds.minX + 1, MAX_IMPORT_SIZE_X);
      const worldSizeY = Math.min(worldBounds.maxY - worldBounds.minY + 1, MAX_IMPORT_SIZE_Y);
      const worldSizeZ = Math.min(worldBounds.maxZ - worldBounds.minZ + 1, MAX_IMPORT_SIZE_Z);
      
      // Calculate center of the world
      // For X and Z, we center horizontally
      const worldCenterX = Math.floor((worldBounds.minX + worldBounds.maxX) / 2);
      const worldCenterZ = Math.floor((worldBounds.minZ + worldBounds.maxZ) / 2);
      
      // For Y, set the center so that the bottom of the map (worldBounds.minY) will be at Y=0 in Hytopia
      const halfHeight = Math.floor(worldSizeY / 2);
      const worldCenterY = worldBounds.minY + halfHeight;
      
      // Update size and center
      setSize({
        x: worldSizeX,
        y: worldSizeY,
        z: worldSizeZ
      });
      
      setCenter({
        x: worldCenterX,
        y: worldCenterY,
        z: worldCenterZ
      });
      
      // Reset offsets
      setOffsets({
        x: 0,
        z: 0
      });
    }
  };
  
  // Add a helper function to adjust Y level for Hytopia
  const adjustYForHytopia = (minecraftY) => {
    // Use the actual bottom of the map as the reference
    return minecraftY - (worldData?.bounds?.minY || MINECRAFT_BOTTOM_Y);
  };
  
  // Calculate final world bounds with offsets
  const finalWorldBounds = {
    minX: -Math.floor(width/2) + offsets.x, 
    maxX: width - Math.floor(width/2) - 1 + offsets.x,
    minY: 0, // Always start at Y=0 in Hytopia
    maxY: height - 1,
    minZ: -Math.floor(depth/2) + offsets.z,
    maxZ: depth - Math.floor(depth/2) - 1 + offsets.z
  };

  // Calculate visualization parameters when worldData or selection changes
  useEffect(() => {
    if (!worldData?.bounds) return;
    
    // Calculate the view box to encompass the entire world plus padding
    const worldMinX = worldData.bounds.minX - padding;
    const worldMaxX = worldData.bounds.maxX + padding;
    const worldMinZ = worldData.bounds.minZ - padding;
    const worldMaxZ = worldData.bounds.maxZ + padding;
    
    const worldWidth = worldMaxX - worldMinX;
    const worldDepth = worldMaxZ - worldMinZ;
    
    // Center the view on the world
    const centerX = (worldMinX + worldMaxX) / 2;
    const centerZ = (worldMinZ + worldMaxZ) / 2;
    
    // Set SVG viewBox to encompass the world
    const viewBoxSize = Math.max(worldWidth, worldDepth);
    setViewBox(`${centerX - viewBoxSize/2} ${centerZ - viewBoxSize/2} ${viewBoxSize} ${viewBoxSize}`);
  }, [worldData, padding]);

  // Helper to convert actual coordinates to visual coordinates (since Z is depth in visualization)
  const toVisualCoords = (x, z) => {
    return { x, z };
  };

  // Handle map click to set center point
  const handleMapClick = (e) => {
    if (!svgRef.current || dragOperation || justFinishedDrag) return;
    
    // Get point in SVG coordinates
    const point = svgCoordinatesFromEvent(e);
    if (!point) return;
    
    // Round to integers since we're dealing with block coordinates
    const newCenterX = Math.round(point.x);
    const newCenterZ = Math.round(point.y);
    
    // Update center
    setCenter(prev => ({
      ...prev,
      x: newCenterX,
      z: newCenterZ
    }));
  };
  
  // Helper function to convert client coordinates to SVG coordinates
  const svgCoordinatesFromEvent = (event) => {
    try {
      const svg = svgRef.current;
      if (!svg) return null;
      
      // Get the SVG element's position
      const svgRect = svg.getBoundingClientRect();
      
      // Calculate the scale between the SVG's current size and its viewBox
      const viewBoxValues = svg.getAttribute('viewBox').split(' ').map(parseFloat);
      const viewBoxWidth = viewBoxValues[2];
      const viewBoxHeight = viewBoxValues[3];
      const scaleX = viewBoxWidth / svgRect.width;
      const scaleY = viewBoxHeight / svgRect.height;
      
      // Calculate the offset of the viewBox
      const viewBoxOffsetX = viewBoxValues[0];
      const viewBoxOffsetY = viewBoxValues[1];
      
      // Calculate the point in SVG coordinates
      const x = viewBoxOffsetX + (event.clientX - svgRect.left) * scaleX;
      const y = viewBoxOffsetY + (event.clientY - svgRect.top) * scaleY;
      
      return { x, y };
    } catch (error) {
      console.error("Error converting coordinates:", error);
      return null;
    }
  };

  // Handle map mouse move
  const handleMapMouseMove = (e) => {
    // Get SVG coordinates
    const coords = svgCoordinatesFromEvent(e);
    
    // No need to update hover coordinates anymore
  };
  
  // Handle mouse leave
  const handleMapMouseLeave = () => {
    setHoverCoords({ x: null, z: null, show: false });
  };

  // Start drag operation for resizing
  const handleDragStart = (e, direction) => {
    e.stopPropagation(); // Prevent triggering map click
    
    // Get point in SVG coordinates
    const point = svgCoordinatesFromEvent(e);
    if (!point) return;
    
    // Set drag operation information
    setDragOperation(direction);
    setIsDragging(true);
    setDragStartCoords({ ...dragStartCoords, x: Math.round(point.x), z: Math.round(point.y) });
    setDragStartBounds({ ...bounds });
  };
  
  // Handle drag movement
  const handleDragMove = (e) => {
    if (!dragOperation || !dragStartBounds) return;
    
    // We are definitely in a drag operation now
    setIsDragging(true);
    
    // Get point in SVG coordinates
    const point = svgCoordinatesFromEvent(e);
    if (!point) return;
    
    const currentX = Math.round(point.x);
    const currentZ = Math.round(point.y);
    
    // Calculate the delta from drag start
    const deltaX = currentX - dragStartCoords.x;
    const deltaZ = currentZ - dragStartCoords.z;
    
    // Update bounds based on which edge/corner is being dragged
    let newBounds = { ...bounds };
    let newCenter = { ...center };
    let newSize = { ...size };
    
    switch(dragOperation) {
      case 'n': // North (top)
        newBounds.minZ = dragStartBounds.minZ + deltaZ;
        break;
      case 's': // South (bottom)
        newBounds.maxZ = dragStartBounds.maxZ + deltaZ;
        break;
      case 'e': // East (right)
        newBounds.maxX = dragStartBounds.maxX + deltaX;
        break;
      case 'w': // West (left)
        newBounds.minX = dragStartBounds.minX + deltaX;
        break;
      case 'ne': // Northeast (top-right)
        newBounds.minZ = dragStartBounds.minZ + deltaZ;
        newBounds.maxX = dragStartBounds.maxX + deltaX;
        break;
      case 'nw': // Northwest (top-left)
        newBounds.minZ = dragStartBounds.minZ + deltaZ;
        newBounds.minX = dragStartBounds.minX + deltaX;
        break;
      case 'se': // Southeast (bottom-right)
        newBounds.maxZ = dragStartBounds.maxZ + deltaZ;
        newBounds.maxX = dragStartBounds.maxX + deltaX;
        break;
      case 'sw': // Southwest (bottom-left)
        newBounds.maxZ = dragStartBounds.maxZ + deltaZ;
        newBounds.minX = dragStartBounds.minX + deltaX;
        break;
    }
    
    // Ensure bounds remain valid (minX < maxX and minZ < maxZ)
    if (newBounds.minX >= newBounds.maxX) {
      if (dragOperation.includes('w')) {
        newBounds.minX = newBounds.maxX - 1;
      } else {
        newBounds.maxX = newBounds.minX + 1;
      }
    }
    
    if (newBounds.minZ >= newBounds.maxZ) {
      if (dragOperation.includes('n')) {
        newBounds.minZ = newBounds.maxZ - 1;
      } else {
        newBounds.maxZ = newBounds.minZ + 1;
      }
    }
    
    // Calculate new size and center based on bounds
    newSize.x = newBounds.maxX - newBounds.minX + 1;
    newSize.z = newBounds.maxZ - newBounds.minZ + 1;
    
    // Check if size exceeds limits
    if (newSize.x > MAX_IMPORT_SIZE_X) {
      if (dragOperation.includes('w')) {
        newBounds.minX = newBounds.maxX - MAX_IMPORT_SIZE_X + 1;
      } else {
        newBounds.maxX = newBounds.minX + MAX_IMPORT_SIZE_X - 1;
      }
      newSize.x = MAX_IMPORT_SIZE_X;
    }
    
    if (newSize.z > MAX_IMPORT_SIZE_Z) {
      if (dragOperation.includes('n')) {
        newBounds.minZ = newBounds.maxZ - MAX_IMPORT_SIZE_Z + 1;
      } else {
        newBounds.maxZ = newBounds.minZ + MAX_IMPORT_SIZE_Z - 1;
      }
      newSize.z = MAX_IMPORT_SIZE_Z;
    }
    
    // Calculate new center
    newCenter.x = Math.floor((newBounds.minX + newBounds.maxX) / 2);
    newCenter.z = Math.floor((newBounds.minZ + newBounds.maxZ) / 2);
    
    // Update state
    setBounds(newBounds);
    setSize(newSize);
    setCenter(newCenter);
  };
  
  // End drag operation
  const handleDragEnd = (e) => {
    if (isDragging) {
      // If we were dragging, prevent the next click from changing the center
      setJustFinishedDrag(true);
      
      // Reset the flag after a short delay to allow for normal clicks again
      setTimeout(() => {
        setJustFinishedDrag(false);
      }, 100);
      
      // If there's an event, stop it from bubbling
      if (e) {
        e.stopPropagation();
      }
    }
    
    setDragOperation(null);
    setDragStartBounds(null);
    setIsDragging(false);
  };
  
  // Helper to determine cursor style based on position
  const getResizeCursor = (direction) => {
    switch(direction) {
      case 'n':
      case 's':
        return 'ns-resize';
      case 'e':
      case 'w':
        return 'ew-resize';
      case 'ne':
      case 'sw':
        return 'nesw-resize';
      case 'nw':
      case 'se':
        return 'nwse-resize';
      default:
        return 'default';
    }
  };

  // Handle Y-axis drag move
  const handleYDragMove = (e) => {
    if (!yDragOperation || !isDragging) return;
    
    // Get the vertical box element
    const boxElement = document.querySelector('.world-height-box');
    if (!boxElement) return;
    
    // Get box position and dimensions
    const boxRect = boxElement.getBoundingClientRect();
    
    // Calculate percentage based on mouse position
    const mouseY = e.clientY;
    const percentage = (mouseY - boxRect.top) / boxRect.height;
    const clampedPercentage = Math.max(0, Math.min(1, percentage));
    
    // Calculate Y value based on world bounds
    const worldMinY = worldData?.bounds?.minY || 0;
    const worldMaxY = worldData?.bounds?.maxY || 100;
    const worldHeight = worldMaxY - worldMinY;
    
    // Calculate new Y position (higher Y at top, lower Y at bottom)
    const newY = Math.round(worldMaxY - (clampedPercentage * worldHeight));
    
    // Create a copy of the current bounds
    const newBounds = { ...bounds };
    
    // Update only the bound being dragged
    if (yDragOperation === 'top') {
      // Update the top bound (maxY)
      newBounds.maxY = newY;
      
      // Ensure maxY is greater than minY
      if (newBounds.maxY <= newBounds.minY) {
        newBounds.maxY = newBounds.minY + 1;
      }
      
      // Ensure maxY is not greater than world maxY
      if (worldData?.bounds && newBounds.maxY > worldData.bounds.maxY) {
        newBounds.maxY = worldData.bounds.maxY;
      }
      
      // Ensure size doesn't exceed MAX_IMPORT_SIZE_Y
      if (newBounds.maxY - newBounds.minY + 1 > MAX_IMPORT_SIZE_Y) {
        newBounds.maxY = newBounds.minY + MAX_IMPORT_SIZE_Y - 1;
      }
      
      // Update only the necessary state
      setBounds(newBounds);
      
      // Update size
      setSize(prev => ({
        ...prev,
        y: newBounds.maxY - newBounds.minY + 1
      }));
      
      // Update center
      setCenter(prev => ({
        ...prev,
        y: Math.floor((newBounds.minY + newBounds.maxY) / 2)
      }));
      
      // Notify parent component
      onRegionSelected({
        ...newBounds,
        offsetX: offsets.x,
        offsetZ: offsets.z
      });
    } else if (yDragOperation === 'bottom') {
      // Update the bottom bound (minY)
      newBounds.minY = newY;
      
      // Ensure minY is less than maxY
      if (newBounds.minY >= newBounds.maxY) {
        newBounds.minY = newBounds.maxY - 1;
      }
      
      // Ensure minY is not less than world minY
      if (worldData?.bounds && newBounds.minY < worldData.bounds.minY) {
        newBounds.minY = worldData.bounds.minY;
      }
      
      // Ensure size doesn't exceed MAX_IMPORT_SIZE_Y
      if (newBounds.maxY - newBounds.minY + 1 > MAX_IMPORT_SIZE_Y) {
        newBounds.minY = newBounds.maxY - MAX_IMPORT_SIZE_Y + 1;
      }
      
      // Update only the necessary state
      setBounds(newBounds);
      
      // Update size
      setSize(prev => ({
        ...prev,
        y: newBounds.maxY - newBounds.minY + 1
      }));
      
      // Update center
      setCenter(prev => ({
        ...prev,
        y: Math.floor((newBounds.minY + newBounds.maxY) / 2)
      }));
      
      // Notify parent component
      onRegionSelected({
        ...newBounds,
        offsetX: offsets.x,
        offsetZ: offsets.z
      });
    }
  };
  
  // Handle Y-axis drag start
  const handleYDragStart = (e, direction) => {
    e.preventDefault();
    e.stopPropagation();
    
    setYDragOperation(direction);
    setIsDragging(true);
    
    // Add event listeners to document for drag move and end
    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleYDragEnd);
  };
  
  // Handle document mouse move for Y-axis dragging
  const handleDocumentMouseMove = (e) => {
    if (yDragOperation && isDragging) {
      handleYDragMove(e);
    }
  };
  
  // Handle Y-axis drag end
  const handleYDragEnd = (e) => {
    if (yDragOperation && isDragging) {
      // Clean up event listeners
      document.removeEventListener('mousemove', handleYDragMove);
      document.removeEventListener('mouseup', handleYDragEnd);
      
      // Reset drag state
      setYDragOperation(null);
      setIsDragging(false);
      setJustFinishedDrag(true);
      
      // Reset after a short delay to prevent immediate click events
      setTimeout(() => {
        setJustFinishedDrag(false);
      }, 100);
    }
  };

  return (
    <div className="region-selector">
      {/* Add style tag for vertical slider */}
      <style>{sliderStyles}</style>
      
      {/* Add style tag for vertical range bars */}
      <style>{rangeStyles}</style>
      
      {/* Add style tag for Y selection with numeric inputs */}
      <style>{ySelectionStyles}</style>
      
      {/* Add style tag for vertical box */}
      <style>{verticalBoxStyles}</style>
      
      {/* Add style tag for version information */}
      <style>{versionInfoStyles}</style>
      
      <div className="region-header">
        <h3>Select Region to Import</h3>
        <div className="region-info-compact">
          <div className="info-item">
            <span className="info-label">Map Version:</span>
            <span className="info-value">{version}</span>
          </div>
          {worldData?.worldVersion && (
            <div className="info-item">
              <span className="info-label">MC Version:</span>
              <span className="info-value">{worldData.worldVersion}</span>
            </div>
          )}
          <div className="info-item">
            <span className="info-label">Max Size:</span>
            <span className="info-value">{MAX_IMPORT_SIZE_X}×{MAX_IMPORT_SIZE_Y}×{MAX_IMPORT_SIZE_Z}</span>
          </div>
        </div>
      </div>
      
      {worldData?.bounds && (
        <div className="world-bounds-info compact">
          <span className="bounds-label">World Range:</span>
          <span className="bounds-value">X: {worldData.bounds.minX} to {worldData.bounds.maxX} | Y: {worldData.bounds.minY} to {worldData.bounds.maxY} | Z: {worldData.bounds.minZ} to {worldData.bounds.maxZ}</span>
        </div>
      )}
      
      <div className="region-info">
        <h4>Selected Region</h4>
        <p>Current selection: X: {bounds.minX} to {bounds.maxX}, Y: {bounds.minY} (bottom) to {bounds.maxY} (top), Z: {bounds.minZ} to {bounds.maxZ}</p>
      </div>

      <div className="region-selector-actions">
        <button className="secondary-button" onClick={selectEntireWorld}>
          Select Entire World
        </button>
      </div>

      <div className="map-visualizations">
        {/* Top-down visualization */}
        <div className="map-visualization">
          <h4>Top-Down Map View (X-Z)</h4>
          <p>Click to set center, drag edges to resize.</p>
          <div className="map-container">
            <svg 
              ref={svgRef}
              viewBox={viewBox} 
              preserveAspectRatio="xMidYMid meet" 
              className="map-svg"
              onClick={handleMapClick}
              onMouseMove={(e) => {
                handleMapMouseMove(e);
                if (dragOperation) {
                  handleDragMove(e);
                }
              }}
              onMouseLeave={(e) => {
                handleMapMouseLeave();
                if (dragOperation) {
                  handleDragEnd(e);
                }
              }}
              onMouseUp={(e) => {
                if (dragOperation) {
                  handleDragEnd(e);
                }
              }}
            >
              {/* World boundary */}
              {worldData?.bounds && (
                <rect
                  x={worldData.bounds.minX}
                  y={worldData.bounds.minZ}
                  width={worldData.bounds.maxX - worldData.bounds.minX}
                  height={worldData.bounds.maxZ - worldData.bounds.minZ}
                  fill="#333"
                  stroke="#666"
                  strokeWidth={Math.max(worldSize.width, worldSize.depth) * 0.005}
                  strokeDasharray="5,5"
                />
              )}
              
              {/* Selected region */}
              <rect
                x={bounds.minX}
                y={bounds.minZ}
                width={bounds.maxX - bounds.minX}
                height={bounds.maxZ - bounds.minZ}
                fill="rgba(33, 150, 243, 0.3)"
                stroke="#2196f3"
                strokeWidth={Math.max(worldSize.width, worldSize.depth) * 0.01}
                className={dragOperation ? "dragging" : ""}
              />
              
              {/* Drag handles */}
              {/* North (top) */}
              <rect
                x={bounds.minX}
                y={bounds.minZ - Math.max(worldSize.width, worldSize.depth) * 0.015}
                width={bounds.maxX - bounds.minX}
                height={Math.max(worldSize.width, worldSize.depth) * 0.03}
                fill="rgba(255, 255, 255, 0.3)"
                stroke="#2196f3"
                strokeWidth={1}
                style={{ cursor: 'ns-resize' }}
                className="drag-handle"
                onMouseDown={(e) => handleDragStart(e, 'n')}
              />
              
              {/* South (bottom) */}
              <rect
                x={bounds.minX}
                y={bounds.maxZ - Math.max(worldSize.width, worldSize.depth) * 0.015}
                width={bounds.maxX - bounds.minX}
                height={Math.max(worldSize.width, worldSize.depth) * 0.03}
                fill="rgba(255, 255, 255, 0.3)"
                stroke="#2196f3"
                strokeWidth={1}
                style={{ cursor: 'ns-resize' }}
                className="drag-handle"
                onMouseDown={(e) => handleDragStart(e, 's')}
              />
              
              {/* East (right) */}
              <rect
                x={bounds.maxX - Math.max(worldSize.width, worldSize.depth) * 0.015}
                y={bounds.minZ}
                width={Math.max(worldSize.width, worldSize.depth) * 0.03}
                height={bounds.maxZ - bounds.minZ}
                fill="rgba(255, 255, 255, 0.3)"
                stroke="#2196f3"
                strokeWidth={1}
                style={{ cursor: 'ew-resize' }}
                className="drag-handle"
                onMouseDown={(e) => handleDragStart(e, 'e')}
              />
              
              {/* West (left) */}
              <rect
                x={bounds.minX - Math.max(worldSize.width, worldSize.depth) * 0.015}
                y={bounds.minZ}
                width={Math.max(worldSize.width, worldSize.depth) * 0.03}
                height={bounds.maxZ - bounds.minZ}
                fill="rgba(255, 255, 255, 0.3)"
                stroke="#2196f3"
                strokeWidth={1}
                style={{ cursor: 'ew-resize' }}
                className="drag-handle"
                onMouseDown={(e) => handleDragStart(e, 'w')}
              />
              
              {/* Corner handles (NE, NW, SE, SW) */}
              {/* Northeast (top-right) */}
              <rect
                x={bounds.maxX - Math.max(worldSize.width, worldSize.depth) * 0.02}
                y={bounds.minZ - Math.max(worldSize.width, worldSize.depth) * 0.02}
                width={Math.max(worldSize.width, worldSize.depth) * 0.04}
                height={Math.max(worldSize.width, worldSize.depth) * 0.04}
                fill="rgba(255, 255, 255, 0.5)"
                stroke="#2196f3"
                strokeWidth={1}
                style={{ cursor: 'nesw-resize' }}
                className="drag-handle corner"
                onMouseDown={(e) => handleDragStart(e, 'ne')}
              />
              
              {/* Northwest (top-left) */}
              <rect
                x={bounds.minX - Math.max(worldSize.width, worldSize.depth) * 0.02}
                y={bounds.minZ - Math.max(worldSize.width, worldSize.depth) * 0.02}
                width={Math.max(worldSize.width, worldSize.depth) * 0.04}
                height={Math.max(worldSize.width, worldSize.depth) * 0.04}
                fill="rgba(255, 255, 255, 0.5)"
                stroke="#2196f3"
                strokeWidth={1}
                style={{ cursor: 'nwse-resize' }}
                className="drag-handle corner"
                onMouseDown={(e) => handleDragStart(e, 'nw')}
              />
              
              {/* Southeast (bottom-right) */}
              <rect
                x={bounds.maxX - Math.max(worldSize.width, worldSize.depth) * 0.02}
                y={bounds.maxZ - Math.max(worldSize.width, worldSize.depth) * 0.02}
                width={Math.max(worldSize.width, worldSize.depth) * 0.04}
                height={Math.max(worldSize.width, worldSize.depth) * 0.04}
                fill="rgba(255, 255, 255, 0.5)"
                stroke="#2196f3"
                strokeWidth={1}
                style={{ cursor: 'nwse-resize' }}
                className="drag-handle corner"
                onMouseDown={(e) => handleDragStart(e, 'se')}
              />
              
              {/* Southwest (bottom-left) */}
              <rect
                x={bounds.minX - Math.max(worldSize.width, worldSize.depth) * 0.02}
                y={bounds.maxZ - Math.max(worldSize.width, worldSize.depth) * 0.02}
                width={Math.max(worldSize.width, worldSize.depth) * 0.04}
                height={Math.max(worldSize.width, worldSize.depth) * 0.04}
                fill="rgba(255, 255, 255, 0.5)"
                stroke="#2196f3"
                strokeWidth={1}
                style={{ cursor: 'nesw-resize' }}
                className="drag-handle corner"
                onMouseDown={(e) => handleDragStart(e, 'sw')}
              />
              
              {/* Center point */}
              <circle
                cx={center.x}
                cy={center.z}
                r={Math.max(worldSize.width, worldSize.depth) * 0.015}
                fill="#ff4081"
                stroke="#fff"
                strokeWidth={Math.max(worldSize.width, worldSize.depth) * 0.005}
              />
              
              {/* North indicator */}
              <polygon
                points={`${center.x},${bounds.minZ - padding * 0.3} ${center.x - padding * 0.1},${bounds.minZ - padding * 0.1} ${center.x + padding * 0.1},${bounds.minZ - padding * 0.1}`}
                fill="#fff"
              />
              <text
                x={center.x}
                y={bounds.minZ - padding * 0.4}
                textAnchor="middle"
                fill="#fff"
                fontSize={Math.max(worldSize.width, worldSize.depth) * 0.05}
              >
                N
              </text>
              
              {/* Coordinate labels */}
              <text
                x={bounds.minX}
                y={bounds.minZ - padding * 0.1}
                textAnchor="middle"
                fill="#fff"
                fontSize={Math.max(worldSize.width, worldSize.depth) * 0.03}
              >
                {bounds.minX}
              </text>
              <text
                x={bounds.maxX}
                y={bounds.minZ - padding * 0.1}
                textAnchor="middle"
                fill="#fff"
                fontSize={Math.max(worldSize.width, worldSize.depth) * 0.03}
              >
                {bounds.maxX}
              </text>
              <text
                x={bounds.minX - padding * 0.1}
                y={bounds.minZ}
                textAnchor="end"
                dominantBaseline="middle"
                fill="#fff"
                fontSize={Math.max(worldSize.width, worldSize.depth) * 0.03}
              >
                {bounds.minZ}
              </text>
              <text
                x={bounds.minX - padding * 0.1}
                y={bounds.maxZ}
                textAnchor="end"
                dominantBaseline="middle"
                fill="#fff"
                fontSize={Math.max(worldSize.width, worldSize.depth) * 0.03}
              >
                {bounds.maxZ}
              </text>
            </svg>
            <div className="map-legend">
              <div className="legend-item">
                <div className="legend-color" style={{ backgroundColor: "#666", border: "1px dashed #999" }}></div>
                <span>World Boundary</span>
              </div>
              <div className="legend-item">
                <div className="legend-color" style={{ backgroundColor: "rgba(33, 150, 243, 0.3)", border: "2px solid #2196f3" }}></div>
                <span>Selected Region</span>
              </div>
              <div className="legend-item">
                <div className="legend-color" style={{ backgroundColor: "#ff4081", borderRadius: "50%", border: "2px solid #fff" }}></div>
                <span>Center Point</span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Y-axis visualization - Vertical box */}
        <div className="map-visualization">
          <h4>Height Selection (Y-Axis)</h4>
          <p>Drag top/bottom edges to adjust height.</p>
          <div className="vertical-box-container">
            <div className="y-axis-labels">
              {worldData?.bounds && (
                <>
                  <div className="y-label top">{worldData.bounds.maxY}</div>
                  <div className="y-label bottom">{worldData.bounds.minY}</div>
                </>
              )}
            </div>
            
            <div className="vertical-box-wrapper">
              {/* World height background */}
              <div className="world-height-box">
                {/* Selected height box */}
                <div 
                  className="selected-height-box"
                  style={{
                    top: `${worldData?.bounds ? 
                      ((worldData.bounds.maxY - bounds.maxY) / (worldData.bounds.maxY - worldData.bounds.minY)) * 100 : 0}%`,
                    height: `${worldData?.bounds ? 
                      ((bounds.maxY - bounds.minY) / (worldData.bounds.maxY - worldData.bounds.minY)) * 100 : 50}%`
                  }}
                >
                  {/* Top handle */}
                  <div 
                    className="y-handle top-handle"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      
                      // Start dragging the top handle
                      setYDragOperation('top');
                      setIsDragging(true);
                      
                      // Add document event listeners
                      document.addEventListener('mousemove', handleYDragMove);
                      document.addEventListener('mouseup', handleYDragEnd);
                    }}
                  >
                    <div className="handle-label">{bounds.maxY}</div>
                  </div>
                  
                  {/* Bottom handle */}
                  <div 
                    className="y-handle bottom-handle"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      
                      // Start dragging the bottom handle
                      setYDragOperation('bottom');
                      setIsDragging(true);
                      
                      // Add document event listeners
                      document.addEventListener('mousemove', handleYDragMove);
                      document.addEventListener('mouseup', handleYDragEnd);
                    }}
                  >
                    <div className="handle-label">{bounds.minY}</div>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="y-info">
              <div className="info-item">
                <span className="info-label">Height:</span>
                <span className="info-value">{size.y} blocks</span>
              </div>
              <div className="info-item">
                <span className="info-label">Center Y:</span>
                <span className="info-value">{center.y}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Range:</span>
                <span className="info-value">{bounds.minY} to {bounds.maxY}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="size-controls">
        <h4>Region Size</h4>
        <p>Set the dimensions of the area to import. The area will be centered on the point specified below.</p>
        <div className="size-inputs">
          <div className="input-control">
            <label>Width (X):</label>
            <input
              type="number"
              min="1"
              max={MAX_IMPORT_SIZE_X}
              value={size.x}
              onChange={(e) => handleSizeChange('x', e.target.value)}
            />
          </div>
          <div className="input-control">
            <label>Height (Y):</label>
            <input
              type="number"
              min="1"
              max={MAX_IMPORT_SIZE_Y}
              value={size.y}
              onChange={(e) => handleSizeChange('y', e.target.value)}
            />
          </div>
          <div className="input-control">
            <label>Depth (Z):</label>
            <input
              type="number"
              min="1"
              max={MAX_IMPORT_SIZE_Z}
              value={size.z}
              onChange={(e) => handleSizeChange('z', e.target.value)}
            />
          </div>
        </div>
      </div>
      
      <div className="offset-controls">
        <h4>Hytopia Map Offset</h4>
        <p>Offset the map in Hytopia. By default, the map will be centered at (0,0) with its lowest Y point at 0.</p>
        <div className="offset-inputs">
          <div className="input-control">
            <label>X Offset:</label>
            <input
              type="number"
              value={offsets.x}
              onChange={(e) => handleOffsetChange('x', e.target.value)}
            />
          </div>
          <div className="input-control">
            <label>Z Offset:</label>
            <input
              type="number"
              value={offsets.z}
              onChange={(e) => handleOffsetChange('z', e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="region-stats">
        <h4>Selection Summary</h4>
        <p>
          <strong>Minecraft Region:</strong> From ({bounds.minX}, {bounds.minY}, {bounds.minZ}) to ({bounds.maxX}, {bounds.maxY}, {bounds.maxZ})
        </p>
        <p>
          <strong>Dimensions:</strong> {width}×{height}×{depth} = {blockCount.toLocaleString()} blocks
        </p>
        <p>
          <strong>Hytopia Placement:</strong> Centered at ({offsets.x}, 0, {offsets.z})
        </p>
        <p>
          <strong>Hytopia Bounds:</strong> From ({finalWorldBounds.minX}, {finalWorldBounds.minY}, {finalWorldBounds.minZ}) to ({finalWorldBounds.maxX}, {finalWorldBounds.maxY}, {finalWorldBounds.maxZ})
        </p>
      </div>

      {/* World Version Information */}
      {worldData?.worldVersion && (
        <div className={`world-version-info ${!isVersionCompatible ? 'version-warning' : ''}`}>
          <h4>World Version Information</h4>
          <p>
            <strong>Minecraft Data Version:</strong> {worldData.worldVersion}
            {worldData.worldVersion === 3953 && (
              <span className="version-compatible"> (Minecraft 1.21 - Fully Compatible)</span>
            )}
            {worldData.worldVersion > 3953 && (
              <span className="version-newer"> (Newer than Minecraft 1.21 - May not be fully compatible)</span>
            )}
            {worldData.worldVersion < 3953 && (
              <span className="version-older"> (Older than Minecraft 1.21 - Needs updating)</span>
            )}
          </p>
          
          {!isVersionCompatible && (
            <div className="version-warning-message">
              <p><strong>Warning:</strong> This world is from an older version of Minecraft (Data Version {worldData.worldVersion}).</p>
              <p>For best results, please update your world to Minecraft 1.21 (Data Version 3953) before importing.</p>
              <p>Importing older worlds may result in missing blocks or other compatibility issues.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RegionSelector; 