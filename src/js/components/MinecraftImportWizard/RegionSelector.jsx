import React, { useState, useEffect, useRef } from 'react';
import { 
  MAX_IMPORT_SIZE_X, 
  MAX_IMPORT_SIZE_Y, 
  MAX_IMPORT_SIZE_Z,
  DEFAULT_IMPORT_SIZE 
} from '../../Constants';

// Minecraft 1.21 constants - bottom of the world is at Y=-69
const MINECRAFT_BOTTOM_Y = -69;

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
  const [dragStartCoords, setDragStartCoords] = useState({ x: 0, z: 0 });
  const [dragStartBounds, setDragStartBounds] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [justFinishedDrag, setJustFinishedDrag] = useState(false);
  
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
    depth: worldData?.bounds ? worldData.bounds.maxZ - worldData.bounds.minZ + 1 : 100
  };

  // Add padding around the world bounds
  const padding = Math.max(worldSize.width, worldSize.depth) * 0.1;

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

  // State for hover position
  const [hoverCoords, setHoverCoords] = useState({ x: null, z: null, show: false });
  
  // Handle mouse move on the map to show coordinates
  const handleMapMouseMove = (e) => {
    // Get point in SVG coordinates
    const point = svgCoordinatesFromEvent(e);
    if (!point) {
      setHoverCoords({ x: null, z: null, show: false });
      return;
    }
    
    // Round to integers since we're dealing with block coordinates
    const x = Math.round(point.x);
    const z = Math.round(point.y);
    
    // Update hover coordinates
    setHoverCoords({ x, z, show: true });
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
    setDragStartCoords({ x: Math.round(point.x), z: Math.round(point.y) });
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

  return (
    <div className="region-selector">
      <h3>Select Region to Import</h3>
      <p>Define the boundaries of the area you want to import. Maximum size: {MAX_IMPORT_SIZE_X}×{MAX_IMPORT_SIZE_Y}×{MAX_IMPORT_SIZE_Z} blocks.</p>
      
      {worldData?.bounds && (
        <div className="world-bounds-info">
          <h4>World Range</h4>
          <p>X: {worldData.bounds.minX} to {worldData.bounds.maxX} | Y: {worldData.bounds.minY} to {worldData.bounds.maxY} | Z: {worldData.bounds.minZ} to {worldData.bounds.maxZ}</p>
        </div>
      )}
      
      <div className="y-mapping-info compact">
        <p><strong>Y-Level Mapping:</strong> <span className="minecraft-y">Minecraft Y={bounds.minY}</span> → <span className="hytopia-y">Hytopia Y=0</span> | <span className="minecraft-y">Minecraft Y={bounds.maxY}</span> → <span className="hytopia-y">Hytopia Y={height-1}</span></p>
        <p className="y-mapping-note">Bottom level maps to Y=0 in Hytopia regardless of Minecraft Y-level</p>
      </div>

      <div className="region-selector-actions">
        <button className="secondary-button" onClick={selectEntireWorld}>
          Select Entire World
        </button>
      </div>
      
      {/* Add top-down visualization */}
      <div className="map-visualization">
        <h4>Top-Down Map View</h4>
        <p>Click anywhere on the map to set the center point of your selection. Drag the edges or corners to resize.</p>
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
            
            {/* Hover coordinates */}
            {hoverCoords.show && (
              <g className="hover-coords">
                <rect
                  x={hoverCoords.x - Math.max(worldSize.width, worldSize.depth) * 0.05}
                  y={hoverCoords.z - Math.max(worldSize.width, worldSize.depth) * 0.05}
                  width={Math.max(worldSize.width, worldSize.depth) * 0.1}
                  height={Math.max(worldSize.width, worldSize.depth) * 0.05}
                  fill="rgba(0, 0, 0, 0.7)"
                  rx={Math.max(worldSize.width, worldSize.depth) * 0.01}
                  ry={Math.max(worldSize.width, worldSize.depth) * 0.01}
                />
                <text
                  x={hoverCoords.x}
                  y={hoverCoords.z}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#fff"
                  fontSize={Math.max(worldSize.width, worldSize.depth) * 0.025}
                >
                  ({hoverCoords.x}, {hoverCoords.z})
                </text>
              </g>
            )}
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
          {hoverCoords.show && (
            <div className="current-coords">
              Hovering at: X: {hoverCoords.x}, Z: {hoverCoords.z}
            </div>
          )}
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
      
      <div className="center-controls">
        <h4>Center Point</h4>
        <p>Set the center point of the region to import in Minecraft coordinates.</p>
        <div className="center-inputs">
          <div className="input-control">
            <label>Center X:</label>
            <input
              type="number"
              value={center.x}
              onChange={(e) => handleCenterChange('x', e.target.value)}
            />
          </div>
          <div className="input-control">
            <label>Center Y:</label>
            <input
              type="number"
              value={center.y}
              onChange={(e) => handleCenterChange('y', e.target.value)}
            />
            <div className="y-info">
              Minecraft Y: {center.y}, Hytopia Y: {adjustYForHytopia(center.y)}
            </div>
          </div>
          <div className="input-control">
            <label>Center Z:</label>
            <input
              type="number"
              value={center.z}
              onChange={(e) => handleCenterChange('z', e.target.value)}
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
    </div>
  );
};

export default RegionSelector; 