import React, { useState, useRef, useCallback } from 'react';
import { FaCloudUploadAlt } from 'react-icons/fa';

// Create Web Worker
const createWorker = () => {
  return new Worker(new URL('../../workers/minecraftParserWorker.js', import.meta.url));
};

const UploadStep = ({ onWorldLoaded }) => {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const fileInputRef = useRef(null);
  const workerRef = useRef(null);
  
  // Clean up worker on unmount
  React.useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);
  
  const handleFileSelect = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    // Validate file type and size
    if (!file.name.endsWith('.zip')) {
      setError('Please upload a Minecraft world as a ZIP file. The file should have a .zip extension.');
      return;
    }
    
    if (file.size > 100 * 1024 * 1024) {
      setError('The world file is too large (>100MB). For better performance, consider selecting a smaller world or exporting a specific region.');
      return;
    }
    
    setUploading(true);
    setError(null);
    setProgress(0);
    setProgressMessage('Starting upload...');
    
    try {
      // Initialize web worker
      if (workerRef.current) {
        workerRef.current.terminate();
      }
      
      workerRef.current = createWorker();
      
      // Set up message handler
      workerRef.current.onmessage = (e) => {
        const { type, data, error } = e.data;
        
        if (type === 'progress') {
          setProgress(data.progress);
          setProgressMessage(data.message || '');
        } else if (type === 'worldParsed') {
          setUploading(false);
          setProgress(100);
          setProgressMessage('World loading complete!');
          onWorldLoaded(data);
        } else if (type === 'error') {
          setUploading(false);
          setProgress(0);
          setError(error || 'An unknown error occurred');
        }
      };
      
      // Start processing
      const arrayBuffer = await file.arrayBuffer();
      workerRef.current.postMessage({
        type: 'parseWorld',
        data: { zipFile: arrayBuffer }
      });
    } catch (e) {
      setUploading(false);
      setProgress(0);
      setError('Error processing file: ' + e.message);
    }
  }, [onWorldLoaded]);
  
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);
  
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = e.dataTransfer?.files;
    if (files?.length > 0) {
      // Create a synthetic event object with the files
      handleFileSelect({ target: { files } });
    }
  }, [handleFileSelect]);
  
  const handleBrowseClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);
  
  return (
    <div className="upload-step">
      <h3>Upload Your Minecraft World</h3>
      <p>Select a Minecraft Java Edition world ZIP file from version 1.21.x or newer.</p>
      
      <div 
        className="upload-area"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleBrowseClick}
      >
        <input 
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept=".zip"
          onChange={handleFileSelect}
        />
        
        <FaCloudUploadAlt className="upload-icon" />
        <h3>Drag & Drop or Click to Browse</h3>
        <p>Upload a Minecraft world as a ZIP file</p>
      </div>
      
      <div className="upload-instructions">
        <h4>How to export your Minecraft world:</h4>
        <ol>
          <li>Find your Minecraft saves folder: <code>%APPDATA%\.minecraft\saves\</code> on Windows</li>
          <li>Right-click on your world folder and select "Send to" → "Compressed (zipped) folder"</li>
          <li>Upload the resulting ZIP file here</li>
        </ol>
        <p className="note">Note: Your ZIP should contain the world's files, including a region folder with .mca files</p>
        
        <h4>Common Issues:</h4>
        <ul className="issue-list">
          <li>Make sure you're zipping the world folder itself, not just its contents</li>
          <li>Some world downloaders may create incompatible formats</li>
          <li>Very large worlds may take longer to process or cause memory issues</li>
          <li>For best results, use a freshly generated world in Minecraft 1.21+</li>
        </ul>
      </div>
      
      {uploading && (
        <div className="upload-progress">
          <p>{progressMessage || 'Processing your world...'}</p>
          <div className="progress-bar">
            <div className="progress-bar-inner" style={{ width: `${progress}%` }}></div>
          </div>
          <p>{progress}% complete</p>
        </div>
      )}
      
      {error && (
        <div className="error-message">
          <p>{error}</p>
          <p>Make sure your ZIP file contains a valid Minecraft world structure with a region folder and .mca files.</p>
        </div>
      )}
    </div>
  );
};

export default UploadStep; 