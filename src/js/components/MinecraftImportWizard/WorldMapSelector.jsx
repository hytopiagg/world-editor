import React, { useState, useRef, useEffect } from 'react';
import { FaExpand, FaCompress, FaHome } from 'react-icons/fa';

/**
 * A simplified map-like component for selecting a rectangular region of a Minecraft world
 * 
 * @param {Object} props 
 * @param {Object} props.bounds - The overall bounds of the world { minX, maxX, minZ, maxZ }
 * @param {Object} props.selectedBounds - The currently selected bounds { minX, maxX, minZ, maxZ }
 * @param {Function} props.onBoundsChange - Callback when bounds are changed
 * @param {Array} props.regionCoords - Array of region coordinates [{ x, z }, ...]
 */
const WorldMapSelector = ({ bounds, selectedBounds, onBoundsChange, regionCoords = [] }) => {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const selectionRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState(null);
  const [viewCenter, setViewCenter] = useState({ x: 0, z: 0 });
  const [zoom, setZoom] = useState(1);
  
  // Calculate display bounds
  const getDisplayBounds = () => {
    if (!bounds || !bounds.minX || !bounds.maxX || 
        !bounds.minZ || !bounds.maxZ) {
      return { minX: -256, maxX: 256, minZ: -256, maxZ: 256 };
    }
    
    // Add some padding around the world bounds
    const padding = 0.1; // 10% padding
    const worldWidth = bounds.maxX - bounds.minX;
    const worldDepth = bounds.maxZ - bounds.minZ;
    
    return {
      minX: bounds.minX - worldWidth * padding,
      maxX: bounds.maxX + worldWidth * padding,
      minZ: bounds.minZ - worldDepth * padding,
      maxZ: bounds.maxZ + worldDepth * padding
    };
  };
  
  // Convert world coordinates to SVG coordinates
  const worldToSvg = (x, z) => {
    if (!mapRef.current) return { x: 0, y: 0 };
    
    const displayBounds = getDisplayBounds();
    const width = mapRef.current.clientWidth;
    const height = mapRef.current.clientHeight;
    
    const worldWidth = displayBounds.maxX - displayBounds.minX;
    const worldDepth = displayBounds.maxZ - displayBounds.minZ;
    
    // Apply zoom and pan
    const centerX = displayBounds.minX + worldWidth / 2;
    const centerZ = displayBounds.minZ + worldDepth / 2;
    
    const scaledX = ((x - centerX) * zoom + viewCenter.x) * width / worldWidth + width / 2;
    const scaledY = ((z - centerZ) * zoom + viewCenter.z) * height / worldDepth + height / 2;
    
    return { x: scaledX, y: scaledY };
  };
  
  // Convert SVG coordinates to world coordinates
  const svgToWorld = (svgX, svgY) => {
    if (!mapRef.current) return { x: 0, z: 0 };
    
    const displayBounds = getDisplayBounds();
    const width = mapRef.current.clientWidth;
    const height = mapRef.current.clientHeight;
    
    const worldWidth = displayBounds.maxX - displayBounds.minX;
    const worldDepth = displayBounds.maxZ - displayBounds.minZ;
    
    // Apply zoom and pan (reverse)
    const centerX = displayBounds.minX + worldWidth / 2;
    const centerZ = displayBounds.minZ + worldDepth / 2;
    
    const x = centerX + ((svgX - width / 2) * worldWidth / width - viewCenter.x) / zoom;
    const z = centerZ + ((svgY - height / 2) * worldDepth / height - viewCenter.z) / zoom;
    
    return { x, z };
  };
  
  // Update selection rectangle
  const updateSelectionRect = () => {
    if (!mapRef.current || !selectionRef.current || !selectedBounds) return;
    
    // Get values with null safety
    const minX = selectedBounds.minX ?? 0;
    const maxX = selectedBounds.maxX ?? 300;
    const minZ = selectedBounds.minZ ?? 0;
    const maxZ = selectedBounds.maxZ ?? 300;
    
    // Check if any values are invalid or out of typical range
    if (isNaN(minX) || isNaN(maxX) || isNaN(minZ) || isNaN(maxZ) ||
        minX > maxX || minZ > maxZ) {
      console.warn("Invalid selection bounds, skipping update:", selectedBounds);
      return;
    }
    
    try {
      const topLeft = worldToSvg(minX, minZ);
      const bottomRight = worldToSvg(maxX, maxZ);
      
      selectionRef.current.style.left = `${topLeft.x}px`;
      selectionRef.current.style.top = `${topLeft.y}px`;
      selectionRef.current.style.width = `${bottomRight.x - topLeft.x}px`;
      selectionRef.current.style.height = `${bottomRight.y - topLeft.y}px`;
      
      // Add selection dimensions as a data attribute for tooltip
      const width = maxX - minX + 1;
      const depth = maxZ - minZ + 1;
      selectionRef.current.setAttribute('data-dimensions', `${width} × ${depth}`);
    } catch (error) {
      console.error("Error updating selection rectangle:", error);
    }
  };
  
  // Handle map click
  const handleMapClick = (e) => {
    // Disabled - we don't want to move the selection on click
    return;
  };
  
  // Handle selection drag start
  const handleSelectionDragStart = (e) => {
    e.preventDefault();
    if (isResizing) return;
    
    setIsDragging(true);
    
    // Store initial cursor position
    const startX = e.clientX;
    const startY = e.clientY;
    
    // Store initial selection position
    const initialBounds = { ...selectedBounds };
    
    const handleMouseMove = (moveEvent) => {
      // Calculate movement in SVG coordinates
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      
      // Convert delta to world coordinates
      const scale = getDisplayBounds().maxX - getDisplayBounds().minX;
      const svgWidth = mapRef.current.clientWidth;
      const worldDeltaX = Math.round(deltaX * scale / svgWidth / zoom);
      const worldDeltaZ = Math.round(deltaY * scale / svgWidth / zoom);
      
      // Update bounds
      const newBounds = {
        minX: initialBounds.minX + worldDeltaX,
        maxX: initialBounds.maxX + worldDeltaX,
        minZ: initialBounds.minZ + worldDeltaZ,
        maxZ: initialBounds.maxZ + worldDeltaZ,
        minY: initialBounds.minY,
        maxY: initialBounds.maxY
      };
      
      onBoundsChange(newBounds);
    };
    
    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };
  
  // Handle selection resize start
  const handleResizeStart = (e, direction) => {
    e.preventDefault();
    e.stopPropagation();
    if (isDragging) return;
    
    setIsResizing(true);
    setResizeDirection(direction);
    
    // Store initial cursor position
    const startX = e.clientX;
    const startY = e.clientY;
    
    // Store initial selection position
    const initialBounds = { ...selectedBounds };
    
    const handleMouseMove = (moveEvent) => {
      // Calculate movement in SVG coordinates
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      
      // Convert delta to world coordinates
      const scale = getDisplayBounds().maxX - getDisplayBounds().minX;
      const svgWidth = mapRef.current.clientWidth;
      const worldDeltaX = Math.round(deltaX * scale / svgWidth / zoom);
      const worldDeltaZ = Math.round(deltaY * scale / svgWidth / zoom);
      
      // Update bounds based on resize direction
      const newBounds = { ...initialBounds };
      
      if (direction.includes('n')) {
        newBounds.minZ = initialBounds.minZ + worldDeltaZ;
      }
      if (direction.includes('s')) {
        newBounds.maxZ = initialBounds.maxZ + worldDeltaZ;
      }
      if (direction.includes('w')) {
        newBounds.minX = initialBounds.minX + worldDeltaX;
      }
      if (direction.includes('e')) {
        newBounds.maxX = initialBounds.maxX + worldDeltaX;
      }
      
      // Ensure min is less than max
      if (newBounds.minX > newBounds.maxX) {
        if (direction.includes('w')) {
          newBounds.minX = newBounds.maxX;
        } else {
          newBounds.maxX = newBounds.minX;
        }
      }
      
      if (newBounds.minZ > newBounds.maxZ) {
        if (direction.includes('n')) {
          newBounds.minZ = newBounds.maxZ;
        } else {
          newBounds.maxZ = newBounds.minZ;
        }
      }
      
      onBoundsChange(newBounds);
    };
    
    const handleMouseUp = () => {
      setIsResizing(false);
      setResizeDirection(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };
  
  // Handle zoom
  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev * 1.5, 10));
  };
  
  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev / 1.5, 0.1));
  };
  
  const handleResetView = () => {
    setZoom(1);
    setViewCenter({ x: 0, z: 0 });
  };
  
  // Update selection display when bounds change
  useEffect(() => {
    updateSelectionRect();
  }, [selectedBounds, zoom, viewCenter]);
  
  // Handle map panning
  const handleMapDragStart = (e) => {
    if (isDragging || isResizing) return;
    if (e.target !== mapRef.current) return;
    
    e.preventDefault();
    
    // Store initial cursor position
    const startX = e.clientX;
    const startY = e.clientY;
    
    // Store initial view center
    const initialViewCenter = { ...viewCenter };
    
    const handleMouseMove = (moveEvent) => {
      // Calculate movement in SVG coordinates
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      
      // Convert delta to view coordinates
      const scale = getDisplayBounds().maxX - getDisplayBounds().minX;
      const svgWidth = mapRef.current.clientWidth;
      const viewDeltaX = deltaX * scale / svgWidth;
      const viewDeltaZ = deltaY * scale / svgWidth;
      
      // Update view center
      setViewCenter({
        x: initialViewCenter.x + viewDeltaX,
        z: initialViewCenter.z + viewDeltaZ
      });
    };
    
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };
  
  // Render the selection area
  const renderSelection = () => {
    if (!selectedBounds) return null;
    
    return (
      <div 
        className="selection-rect"
        ref={selectionRef}
        onMouseDown={handleSelectionDragStart}
      >
        <div className="resize-handle nw" onMouseDown={(e) => handleResizeStart(e, 'nw')} />
        <div className="resize-handle n" onMouseDown={(e) => handleResizeStart(e, 'n')} />
        <div className="resize-handle ne" onMouseDown={(e) => handleResizeStart(e, 'ne')} />
        <div className="resize-handle w" onMouseDown={(e) => handleResizeStart(e, 'w')} />
        <div className="resize-handle e" onMouseDown={(e) => handleResizeStart(e, 'e')} />
        <div className="resize-handle sw" onMouseDown={(e) => handleResizeStart(e, 'sw')} />
        <div className="resize-handle s" onMouseDown={(e) => handleResizeStart(e, 's')} />
        <div className="resize-handle se" onMouseDown={(e) => handleResizeStart(e, 'se')} />
      </div>
    );
  };
  
  // Render the regions as a grid
  const renderRegions = () => {
    if (!regionCoords || regionCoords.length === 0) return null;
    
    return regionCoords.map((region, index) => {
      // Calculate region bounds in world coordinates (each region is 512x512 blocks)
      const regionMinX = region.x * 512;
      const regionMaxX = regionMinX + 511;
      const regionMinZ = region.z * 512;
      const regionMaxZ = regionMinZ + 511;
      
      // Convert to SVG coordinates
      const topLeft = worldToSvg(regionMinX, regionMinZ);
      const bottomRight = worldToSvg(regionMaxX, regionMaxZ);
      
      // Skip if offscreen
      if (topLeft.x > mapRef.current.clientWidth || bottomRight.x < 0 ||
          topLeft.y > mapRef.current.clientHeight || bottomRight.y < 0) {
        return null;
      }
      
      // Calculate width and height
      const width = bottomRight.x - topLeft.x;
      const height = bottomRight.y - topLeft.y;
      
      // Skip if too small to render
      if (width < 2 || height < 2) return null;
      
      return (
        <div 
          key={`region-${region.x}-${region.z}`}
          className="region-rect"
          style={{
            left: `${topLeft.x}px`,
            top: `${topLeft.y}px`,
            width: `${width}px`,
            height: `${height}px`
          }}
          title={`Region (${region.x}, ${region.z})`}
        />
      );
    });
  };
  
  // Render the world boundaries
  const renderWorldBoundaries = () => {
    if (!bounds) return null;
    
    const topLeft = worldToSvg(bounds.minX, bounds.minZ);
    const bottomRight = worldToSvg(bounds.maxX, bounds.maxZ);
    
    const width = bottomRight.x - topLeft.x;
    const height = bottomRight.y - topLeft.y;
    
    return (
      <div 
        className="world-boundary"
        style={{
          left: `${topLeft.x}px`,
          top: `${topLeft.y}px`,
          width: `${width}px`,
          height: `${height}px`
        }}
        title={`World Boundary: ${bounds.maxX - bounds.minX + 1} x ${bounds.maxZ - bounds.minZ + 1} blocks`}
      />
    );
  };
  
  return (
    <div className="world-map-selector" ref={containerRef}>
      <div className="map-toolbar">
        <button className="map-tool-button" onClick={handleZoomIn} title="Zoom In">
          <FaExpand />
        </button>
        <button className="map-tool-button" onClick={handleZoomOut} title="Zoom Out">
          <FaCompress />
        </button>
        <button className="map-tool-button" onClick={handleResetView} title="Reset View">
          <FaHome />
        </button>
        <div className="map-info">
          <span>Zoom: {zoom.toFixed(1)}x</span>
          {selectedBounds && (
            <span>Selection: {selectedBounds.maxX - selectedBounds.minX + 1} x {selectedBounds.maxZ - selectedBounds.minZ + 1} blocks</span>
          )}
        </div>
      </div>
      
      <div 
        className="map-container"
        ref={mapRef}
        onMouseDown={handleMapDragStart}
      >
        {/* World boundary */}
        {mapRef.current && renderWorldBoundaries()}
        
        {/* Origin marker */}
        <div className="origin-marker" style={{ 
          left: `${worldToSvg(0, 0).x}px`, 
          top: `${worldToSvg(0, 0).y}px`
        }}>
          <div className="origin-point"></div>
          <div className="origin-label">Origin (0,0)</div>
        </div>
        
        {/* Coordinate axes */}
        <div className="coordinate-axes">
          <div className="x-axis" style={{
            left: `${worldToSvg(-5000, 0).x}px`,
            top: `${worldToSvg(0, 0).y}px`,
            width: `${worldToSvg(5000, 0).x - worldToSvg(-5000, 0).x}px`
          }}></div>
          <div className="z-axis" style={{
            left: `${worldToSvg(0, -5000).x}px`,
            top: `${worldToSvg(0, -5000).y}px`,
            height: `${worldToSvg(0, 5000).y - worldToSvg(0, -5000).y}px`
          }}></div>
        </div>
        
        {/* Region grid cells */}
        {mapRef.current && renderRegions()}
        
        {/* Selection rectangle */}
        {renderSelection()}
      </div>
      
      <style jsx>{`
        .world-map-selector {
          width: 100%;
          border-radius: 8px;
          overflow: hidden;
          background-color: #222;
          display: flex;
          flex-direction: column;
          margin: 20px 0;
        }
        
        .map-toolbar {
          display: flex;
          padding: 8px;
          background-color: #333;
          border-bottom: 1px solid #444;
          align-items: center;
        }
        
        .map-tool-button {
          background: #444;
          color: white;
          border: none;
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          margin-right: 8px;
          cursor: pointer;
        }
        
        .map-tool-button:hover {
          background: #555;
        }
        
        .map-info {
          margin-left: auto;
          color: #ccc;
          display: flex;
          gap: 15px;
        }
        
        .map-container {
          width: 100%;
          position: relative;
          background-color: #1e1e1e;
          background-image: 
            linear-gradient(to right, #333 1px, transparent 1px),
            linear-gradient(to bottom, #333 1px, transparent 1px);
          background-size: 20px 20px;
          cursor: grab;
          overflow: hidden;
          /* Create a square aspect ratio */
          aspect-ratio: 1 / 1;
          max-height: 500px;
          max-width: 500px;
          margin: 0 auto;
        }
        
        /* Fallback for browsers that don't support aspect-ratio */
        @supports not (aspect-ratio: 1 / 1) {
          .map-container {
            height: 0;
            padding-bottom: 100%; /* Creates a 1:1 aspect ratio */
          }
        }
        
        .map-container:active {
          cursor: grabbing;
        }
        
        .origin-marker {
          position: absolute;
          z-index: 11;
          transform: translate(-50%, -50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          pointer-events: none;
        }
        
        .origin-point {
          width: 10px;
          height: 10px;
          background-color: red;
          border-radius: 50%;
          box-shadow: 0 0 5px rgba(255, 0, 0, 0.5);
        }
        
        .origin-label {
          color: red;
          font-size: 10px;
          margin-top: 3px;
          background-color: rgba(0, 0, 0, 0.5);
          padding: 2px 5px;
          border-radius: 3px;
          white-space: nowrap;
        }
        
        .coordinate-axes {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          pointer-events: none;
          z-index: 5;
        }
        
        .x-axis {
          position: absolute;
          height: 1px;
          background-color: rgba(255, 0, 0, 0.4);
        }
        
        .z-axis {
          position: absolute;
          width: 1px;
          background-color: rgba(0, 0, 255, 0.4);
        }
        
        .world-boundary {
          position: absolute;
          border: 2px dashed rgba(255, 255, 0, 0.5);
          pointer-events: none;
          z-index: 6;
        }
        
        .region-rect {
          position: absolute;
          background-color: rgba(100, 100, 100, 0.15);
          border: 1px solid rgba(150, 150, 150, 0.3);
          pointer-events: none;
        }
        
        .selection-rect {
          position: absolute;
          background-color: rgba(74, 144, 226, 0.2);
          border: 2px solid rgba(74, 144, 226, 0.8);
          cursor: move;
          z-index: 20;
        }
        
        .selection-rect::after {
          content: attr(data-dimensions);
          position: absolute;
          bottom: -20px;
          left: 50%;
          transform: translateX(-50%);
          background-color: rgba(0, 0, 0, 0.7);
          color: white;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 10px;
          white-space: nowrap;
        }
        
        .resize-handle {
          position: absolute;
          width: 10px;
          height: 10px;
          background-color: white;
          border: 1px solid rgba(74, 144, 226, 0.8);
          z-index: 21;
        }
        
        .resize-handle.nw {
          left: -5px;
          top: -5px;
          cursor: nwse-resize;
        }
        
        .resize-handle.n {
          left: 50%;
          top: -5px;
          transform: translateX(-50%);
          cursor: ns-resize;
        }
        
        .resize-handle.ne {
          right: -5px;
          top: -5px;
          cursor: nesw-resize;
        }
        
        .resize-handle.w {
          left: -5px;
          top: 50%;
          transform: translateY(-50%);
          cursor: ew-resize;
        }
        
        .resize-handle.e {
          right: -5px;
          top: 50%;
          transform: translateY(-50%);
          cursor: ew-resize;
        }
        
        .resize-handle.sw {
          left: -5px;
          bottom: -5px;
          cursor: nesw-resize;
        }
        
        .resize-handle.s {
          left: 50%;
          bottom: -5px;
          transform: translateX(-50%);
          cursor: ns-resize;
        }
        
        .resize-handle.se {
          right: -5px;
          bottom: -5px;
          cursor: nwse-resize;
        }
      `}</style>
    </div>
  );
};

export default WorldMapSelector; 