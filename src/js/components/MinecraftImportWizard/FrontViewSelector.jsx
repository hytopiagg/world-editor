import React, { useState, useRef, useEffect } from 'react';

/**
 * A component for selecting the vertical (Y-axis) bounds of a Minecraft world
 * 
 * @param {Object} props 
 * @param {Object} props.bounds - The overall bounds of the world
 * @param {Object} props.selectedBounds - The currently selected bounds
 * @param {Function} props.onBoundsChange - Callback when bounds are changed
 */
const FrontViewSelector = ({ bounds, selectedBounds, onBoundsChange }) => {
  const svgRef = useRef(null);
  const [isDraggingMin, setIsDraggingMin] = useState(false);
  const [isDraggingMax, setIsDraggingMax] = useState(false);
  
  // Minecraft Y-level reference points
  const REFERENCE_POINTS = [
    { y: 320, label: 'Build Limit (Y=320)' },
    { y: 192, label: 'Cloud Level (Y=192)' },
    { y: 62, label: 'Sea Level (Y=62)' },
    { y: 0, label: 'Original Ground (Y=0)' },
    { y: -32, label: 'Deep Caves (Y=-32)' },
    { y: -64, label: 'Bedrock Floor (Y=-64)' }
  ];
  
  // Initialize the view when component mounts
  useEffect(() => {
    // Make sure we have a valid selection
    if (!selectedBounds || selectedBounds.minY === undefined || selectedBounds.maxY === undefined) {
      // Set default values if not provided
      onBoundsChange({
        ...selectedBounds,
        minY: 10,
        maxY: 100
      });
    }
  }, []);
  
  // Center the view when the component mounts or selectedBounds changes
  useEffect(() => {
    // If we have a valid selection and the SVG ref is available, center the view
    if (selectedBounds && svgRef.current) {
      // Force a re-render to ensure the selection is visible
      const forceUpdate = () => {
        const element = svgRef.current;
        if (element) {
          // Trigger a reflow
          element.style.display = 'none';
          // This line forces the browser to flush the style changes
          void element.offsetHeight;
          // Restore the display
          element.style.display = 'block';
        }
      };
      
      // Run immediately and then again after a delay to ensure DOM is ready
      forceUpdate();
      
      // Add multiple delayed updates to ensure the bars render correctly
      // This is necessary because sometimes the initial calculation happens 
      // before styles are fully applied
      setTimeout(forceUpdate, 100);
      setTimeout(forceUpdate, 300);
      setTimeout(forceUpdate, 500);
    }
  }, [selectedBounds, svgRef.current]);
  
  // Add a separate effect to force reflow after the component is fully mounted
  useEffect(() => {
    if (svgRef.current && selectedBounds) {
      // This will run once after initial mount
      const handleResize = () => {
        // Force recomputation of the selection area position
        const selectionArea = svgRef.current.querySelector('.y-selection-area');
        if (selectionArea) {
          selectionArea.style.top = `${yToSvgY(selectedBounds.maxY)}px`;
          selectionArea.style.height = `${yToSvgY(selectedBounds.minY) - yToSvgY(selectedBounds.maxY)}px`;
        }
        
        // Also update all reference lines
        const referenceLines = svgRef.current.querySelectorAll('.reference-line');
        referenceLines.forEach((line, index) => {
          if (index < REFERENCE_POINTS.length) {
            const y = REFERENCE_POINTS[index].y;
            line.style.top = `${yToSvgY(y)}px`;
          }
        });
      };

      // Force the calculation immediately and after a delay
      handleResize();
      window.addEventListener('resize', handleResize);
      
      // Run it a few more times with delays to ensure it's properly positioned
      // Using more frequent updates in the first second to ensure proper rendering
      setTimeout(handleResize, 50);
      setTimeout(handleResize, 100);
      setTimeout(handleResize, 200);
      setTimeout(handleResize, 500);
      setTimeout(handleResize, 1000);
      
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }
  }, []);
  
  // Convert Y coordinate to SVG Y position with additional checks for container size
  const yToSvgY = (y) => {
    if (!svgRef.current) return 0;
    
    // Get the actual height after the container has rendered
    const containerHeight = svgRef.current.clientHeight || 300; // Use 300px as fallback
    const height = containerHeight - 30; // Subtract padding (15px top + 15px bottom)
    
    // Make sure we have valid height before calculation
    if (height <= 0) return 15; // Return top padding if height is invalid
    
    // Map from Minecraft Y range (-64 to 320) to SVG height, with padding
    return 15 + height - ((y + 64) / (320 + 64)) * height;
  };
  
  // Convert SVG Y position to Minecraft Y coordinate
  const svgYToY = (svgY) => {
    if (!svgRef.current) return 0;
    
    const height = svgRef.current.clientHeight - 30; // Subtract padding
    // Map from SVG height to Minecraft Y range (-64 to 320), accounting for padding
    const y = -64 + (1 - (svgY - 15) / height) * (320 + 64);
    return Math.round(y);
  };
  
  // Handle direct click on the SVG to set selection
  const handleSvgClick = (e) => {
    if (!svgRef.current || !selectedBounds) return;
    
    const svgRect = svgRef.current.getBoundingClientRect();
    const svgY = e.clientY - svgRect.top;
    const clickedY = svgYToY(svgY);
    
    // Determine if we should move the min or max handle
    // (whichever is closer to the clicked point)
    const distToMin = Math.abs(clickedY - selectedBounds.minY);
    const distToMax = Math.abs(clickedY - selectedBounds.maxY);
    
    if (distToMin < distToMax) {
      // Move min handle
      onBoundsChange({
        ...selectedBounds,
        minY: Math.min(selectedBounds.maxY - 1, clickedY)
      });
    } else {
      // Move max handle
      onBoundsChange({
        ...selectedBounds,
        maxY: Math.max(selectedBounds.minY + 1, clickedY)
      });
    }
  };
  
  // Handle mouse down on min handle
  const handleMinHandleMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingMin(true);
    
    const handleMouseMove = (moveEvent) => {
      const svgRect = svgRef.current.getBoundingClientRect();
      const svgY = moveEvent.clientY - svgRect.top;
      const newMinY = Math.max(-64, Math.min(selectedBounds.maxY - 1, svgYToY(svgY)));
      
      onBoundsChange({
        ...selectedBounds,
        minY: newMinY
      });
    };
    
    const handleMouseUp = () => {
      setIsDraggingMin(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };
  
  // Handle mouse down on max handle
  const handleMaxHandleMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingMax(true);
    
    const handleMouseMove = (moveEvent) => {
      const svgRect = svgRef.current.getBoundingClientRect();
      const svgY = moveEvent.clientY - svgRect.top;
      const newMaxY = Math.min(320, Math.max(selectedBounds.minY + 1, svgYToY(svgY)));
      
      onBoundsChange({
        ...selectedBounds,
        maxY: newMaxY
      });
    };
    
    const handleMouseUp = () => {
      setIsDraggingMax(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };
  
  // Handle direct input changes
  const handleMinYChange = (e) => {
    const newMinY = Number(e.target.value);
    if (newMinY >= -64 && newMinY < selectedBounds.maxY) {
      onBoundsChange({
        ...selectedBounds,
        minY: newMinY
      });
    }
  };
  
  const handleMaxYChange = (e) => {
    const newMaxY = Number(e.target.value);
    if (newMaxY <= 320 && newMaxY > selectedBounds.minY) {
      onBoundsChange({
        ...selectedBounds,
        maxY: newMaxY
      });
    }
  };
  
  return (
    <div className="front-view-selector">
      <h4>Front View (Y-axis)</h4>
      <p className="selector-description">Click or drag to adjust vertical bounds</p>
      
      <div className="front-view-container">
        <div className="front-view-svg-container" 
          ref={svgRef} 
          onClick={handleSvgClick}
        >
          {/* Reference lines for important Y levels */}
          {REFERENCE_POINTS.map((point) => (
            <div 
              key={point.y}
              className="reference-line"
              style={{ top: `${yToSvgY(point.y)}px` }}
            >
              <div className="reference-label">{point.label}</div>
              <div className="reference-line-inner"></div>
            </div>
          ))}
          
          {/* Selection area */}
          {selectedBounds && (
            <div 
              className="y-selection-area"
              style={{
                top: `${yToSvgY(selectedBounds.maxY)}px`,
                height: `${yToSvgY(selectedBounds.minY) - yToSvgY(selectedBounds.maxY)}px`,
                transition: 'none' // Disable transitions initially to prevent animation artifacts
              }}
            >
              {/* Max Y handle */}
              <div 
                className="y-handle max-handle"
                onMouseDown={handleMaxHandleMouseDown}
              ></div>
              
              {/* Min Y handle */}
              <div 
                className="y-handle min-handle"
                onMouseDown={handleMinHandleMouseDown}
              ></div>
              
              {/* Selection label */}
              <div className="selection-label">
                {selectedBounds.minY} to {selectedBounds.maxY}
              </div>
            </div>
          )}
        </div>
      </div>
      
      <div className="y-level-info">
        <p>Selected height: {(selectedBounds?.maxY || 100) - (selectedBounds?.minY || 10) + 1} blocks</p>
      </div>
      
      <div className="y-inputs">
        <div className="y-input-row">
          <div className="y-input">
            <label>Min Y:</label>
            <input 
              type="number" 
              value={selectedBounds?.minY || 10} 
              min={-64} 
              max={selectedBounds?.maxY - 1 || 319} 
              onChange={handleMinYChange}
            />
          </div>
          
          <div className="y-input">
            <label>Max Y:</label>
            <input 
              type="number" 
              value={selectedBounds?.maxY || 100} 
              min={selectedBounds?.minY + 1 || -63} 
              max={320} 
              onChange={handleMaxYChange}
            />
          </div>
        </div>
      </div>
      
      <style jsx>{`
        .front-view-selector {
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        
        .selector-description {
          color: #aaa;
          font-size: 12px;
          margin-top: 0;
          margin-bottom: 10px;
        }
        
        .front-view-container {
          display: flex;
          flex: 1;
        }
        
        .front-view-svg-container {
          flex: 1;
          position: relative;
          background-color: #1a1a1a;
          border: 1px solid #333;
          border-radius: 4px;
          height: 300px;
          overflow: hidden;
          cursor: pointer;
        }
        
        .reference-line {
          position: absolute;
          left: 0;
          width: 100%;
          height: 1px;
          display: flex;
          align-items: center;
          pointer-events: none;
          z-index: 1;
        }
        
        .reference-line-inner {
          flex: 1;
          height: 1px;
          background-color: rgba(255, 255, 255, 0.2);
        }
        
        .reference-label {
          position: absolute;
          left: 5px;
          font-size: 10px;
          color: rgba(255, 255, 255, 0.6);
          background-color: rgba(0, 0, 0, 0.5);
          padding: 2px 4px;
          border-radius: 2px;
          white-space: nowrap;
        }
        
        .y-selection-area {
          position: absolute;
          left: 0;
          width: 100%;
          background-color: rgba(74, 144, 226, 0.2);
          border-top: 2px solid rgba(74, 144, 226, 0.8);
          border-bottom: 2px solid rgba(74, 144, 226, 0.8);
          z-index: 2;
        }
        
        .selection-label {
          position: absolute;
          right: 5px;
          top: 50%;
          transform: translateY(-50%);
          background-color: rgba(0, 0, 0, 0.7);
          color: white;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 12px;
          pointer-events: none;
        }
        
        .y-handle {
          position: absolute;
          left: 0;
          width: 100%;
          height: 14px;
          background-color: rgba(74, 144, 226, 0.5);
          cursor: ns-resize;
          z-index: 3;
        }
        
        .max-handle {
          top: -7px;
        }
        
        .min-handle {
          bottom: -7px;
        }
        
        .y-level-info {
          margin-top: 10px;
          font-size: 12px;
          color: #ccc;
          text-align: center;
        }
        
        .y-level-info p {
          margin: 5px 0;
        }
        
        .y-inputs {
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid #333;
        }
        
        .y-input-row {
          display: flex;
          justify-content: space-between;
          gap: 10px;
        }
        
        .y-input {
          flex: 1;
        }
        
        .y-input label {
          display: block;
          margin-bottom: 5px;
          font-size: 12px;
          color: #ccc;
        }
        
        .y-input input {
          width: 100%;
          padding: 5px;
          background-color: #333;
          border: 1px solid #444;
          color: white;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
};

export default FrontViewSelector; 