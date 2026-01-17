import { useState, useRef, useCallback } from "react";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";
import { generateSkyboxPreviewFromDataUris } from "../utils/SkyboxPreviewRenderer";
import JSZip from "jszip";
import ModalContainer from "./ModalContainer";

export interface CustomSkybox {
    name: string;
    faceTextures: {
        '+x': string;
        '-x': string;
        '+y': string;
        '-y': string;
        '+z': string;
        '-z': string;
    };
    previewDataUrl?: string;
}

interface SkyboxUploadModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSkyboxAdded: (skybox: CustomSkybox) => void;
    existingSkyboxNames: string[];
}

type FaceKey = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

const FACE_KEYS: FaceKey[] = ['+x', '-x', '+y', '-y', '+z', '-z'];

const FACE_LABELS: Record<FaceKey, string> = {
    '+x': 'Right (+X)',
    '-x': 'Left (-X)',
    '+y': 'Top (+Y)',
    '-y': 'Bottom (-Y)',
    '+z': 'Front (+Z)',
    '-z': 'Back (-Z)',
};

export default function SkyboxUploadModal({
    isOpen,
    onClose,
    onSkyboxAdded,
    existingSkyboxNames
}: SkyboxUploadModalProps) {
    const [name, setName] = useState('');
    const [uploadMethod, setUploadMethod] = useState<'zip' | 'individual'>('zip');
    const [faceFiles, setFaceFiles] = useState<Partial<Record<FaceKey, File>>>({});
    const [zipFile, setZipFile] = useState<File | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRefs = useRef<Record<FaceKey, HTMLInputElement | null>>({
        '+x': null, '-x': null, '+y': null, '-y': null, '+z': null, '-z': null
    });
    const zipInputRef = useRef<HTMLInputElement | null>(null);

    const resetForm = () => {
        setName('');
        setFaceFiles({});
        setZipFile(null);
        setError(null);
        setIsUploading(false);
    };

    const handleClose = () => {
        resetForm();
        onClose();
    };

    const loadImage = (file: File): Promise<HTMLImageElement> => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    };

    const fileToDataUri = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    const validateImages = async (files: Record<FaceKey, File>): Promise<{ valid: boolean; error?: string }> => {
        let expectedSize: number | null = null;

        for (const key of FACE_KEYS) {
            if (!files[key]) {
                return { valid: false, error: `Missing ${FACE_LABELS[key]} face` };
            }

            try {
                const img = await loadImage(files[key]);

                if (img.width !== img.height) {
                    return { valid: false, error: `${FACE_LABELS[key]} is not square (${img.width}x${img.height})` };
                }

                if (!expectedSize) {
                    expectedSize = img.width;
                } else if (img.width !== expectedSize) {
                    return { valid: false, error: `${FACE_LABELS[key]} has different size. Expected ${expectedSize}x${expectedSize}, got ${img.width}x${img.height}` };
                }

                URL.revokeObjectURL(img.src);
            } catch (e) {
                return { valid: false, error: `Failed to load ${FACE_LABELS[key]} image` };
            }
        }

        return { valid: true };
    };

    const processZipUpload = async (file: File): Promise<{ valid: boolean; files?: Record<FaceKey, File>; error?: string }> => {
        try {
            const zip = await JSZip.loadAsync(file);
            const files: Partial<Record<FaceKey, File>> = {};

            // Get all file entries in the ZIP (including nested)
            const allFiles: { path: string; entry: JSZip.JSZipObject }[] = [];
            zip.forEach((relativePath, zipEntry) => {
                if (!zipEntry.dir) {
                    allFiles.push({ path: relativePath.toLowerCase(), entry: zipEntry });
                }
            });

            // Common naming patterns for each face
            const facePatterns: Record<FaceKey, string[]> = {
                '+x': ['+x', 'px', 'posx', 'pos-x', 'right', 'rt'],
                '-x': ['-x', 'nx', 'negx', 'neg-x', 'left', 'lf'],
                '+y': ['+y', 'py', 'posy', 'pos-y', 'top', 'up'],
                '-y': ['-y', 'ny', 'negy', 'neg-y', 'bottom', 'dn', 'down'],
                '+z': ['+z', 'pz', 'posz', 'pos-z', 'front', 'ft'],
                '-z': ['-z', 'nz', 'negz', 'neg-z', 'back', 'bk'],
            };

            const imageExtensions = ['.png', '.jpg', '.jpeg'];

            for (const key of FACE_KEYS) {
                let foundEntry: JSZip.JSZipObject | null = null;

                // Try each pattern for this face
                for (const pattern of facePatterns[key]) {
                    if (foundEntry) break;

                    for (const ext of imageExtensions) {
                        // Look for the file anywhere in the ZIP
                        const match = allFiles.find(f => {
                            const fileName = f.path.split('/').pop() || '';
                            return fileName === `${pattern}${ext}`;
                        });

                        if (match) {
                            foundEntry = match.entry;
                            break;
                        }
                    }
                }

                if (!foundEntry) {
                    const patterns = facePatterns[key].slice(0, 3).join(', ');
                    return { valid: false, error: `ZIP is missing ${FACE_LABELS[key]} face. Expected file names like: ${patterns}.png` };
                }

                const blob = await foundEntry.async('blob');
                files[key] = new File([blob], `${key}.png`, { type: 'image/png' });
            }

            return { valid: true, files: files as Record<FaceKey, File> };
        } catch (e) {
            console.error('Error processing ZIP:', e);
            return { valid: false, error: 'Failed to read ZIP file' };
        }
    };

    const handleIndividualFileChange = useCallback((faceKey: FaceKey, file: File | null) => {
        if (file) {
            setFaceFiles(prev => ({ ...prev, [faceKey]: file }));
        } else {
            setFaceFiles(prev => {
                const newFiles = { ...prev };
                delete newFiles[faceKey];
                return newFiles;
            });
        }
        setError(null);
    }, []);

    const handleZipChange = (file: File | null) => {
        setZipFile(file);
        setError(null);
    };

    const handleSubmit = async () => {
        // Validate name
        const trimmedName = name.trim();
        if (!trimmedName) {
            setError('Please enter a name for the skybox');
            return;
        }

        // Check for duplicate names
        if (existingSkyboxNames.includes(trimmedName)) {
            setError('A skybox with this name already exists');
            return;
        }

        setIsUploading(true);
        setError(null);

        try {
            let filesToValidate: Record<FaceKey, File>;

            if (uploadMethod === 'zip') {
                if (!zipFile) {
                    setError('Please select a ZIP file');
                    setIsUploading(false);
                    return;
                }

                const zipResult = await processZipUpload(zipFile);
                if (!zipResult.valid || !zipResult.files) {
                    setError(zipResult.error || 'Failed to process ZIP file');
                    setIsUploading(false);
                    return;
                }
                filesToValidate = zipResult.files;
            } else {
                // Validate all individual files are present
                const missingFaces = FACE_KEYS.filter(key => !faceFiles[key]);
                if (missingFaces.length > 0) {
                    setError(`Missing faces: ${missingFaces.map(k => FACE_LABELS[k]).join(', ')}`);
                    setIsUploading(false);
                    return;
                }
                filesToValidate = faceFiles as Record<FaceKey, File>;
            }

            // Validate images
            const validation = await validateImages(filesToValidate);
            if (!validation.valid) {
                setError(validation.error || 'Image validation failed');
                setIsUploading(false);
                return;
            }

            // Convert files to data URIs
            const faceTextures: Record<FaceKey, string> = {} as Record<FaceKey, string>;
            for (const key of FACE_KEYS) {
                faceTextures[key] = await fileToDataUri(filesToValidate[key]);
            }

            // Generate preview
            const previewDataUrl = await generateSkyboxPreviewFromDataUris(faceTextures, { width: 64, height: 64 });

            // Create skybox object
            const newSkybox: CustomSkybox = {
                name: trimmedName,
                faceTextures,
                previewDataUrl
            };

            // Save to database
            const existingSkyboxes = (await DatabaseManager.getData(STORES.SETTINGS, 'customSkyboxes') || []) as CustomSkybox[];
            await DatabaseManager.saveData(STORES.SETTINGS, 'customSkyboxes', [...existingSkyboxes, newSkybox]);

            // Notify parent
            onSkyboxAdded(newSkybox);
            handleClose();
        } catch (e) {
            console.error('Error uploading skybox:', e);
            setError('Failed to upload skybox. Please try again.');
            setIsUploading(false);
        }
    };

    return (
        <ModalContainer
            title="Add Custom Skybox"
            isOpen={isOpen}
            onClose={handleClose}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Name Input */}
                <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '14px' }}>
                        Skybox Name
                    </label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="My Custom Skybox"
                        style={{
                            width: '100%',
                            padding: '10px 12px',
                            borderRadius: '8px',
                            border: '1px solid rgba(255,255,255,0.2)',
                            backgroundColor: 'rgba(255,255,255,0.05)',
                            color: '#fff',
                            fontSize: '14px'
                        }}
                    />
                </div>

                {/* Upload Method Toggle */}
                <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '14px' }}>
                        Upload Method
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            onClick={() => setUploadMethod('zip')}
                            style={{
                                flex: 1,
                                padding: '10px',
                                borderRadius: '8px',
                                border: uploadMethod === 'zip' ? '2px solid #6366f1' : '1px solid rgba(255,255,255,0.2)',
                                backgroundColor: uploadMethod === 'zip' ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255,255,255,0.05)',
                                color: '#fff',
                                cursor: 'pointer',
                                fontWeight: uploadMethod === 'zip' ? 600 : 400
                            }}
                        >
                            ZIP File
                        </button>
                        <button
                            onClick={() => setUploadMethod('individual')}
                            style={{
                                flex: 1,
                                padding: '10px',
                                borderRadius: '8px',
                                border: uploadMethod === 'individual' ? '2px solid #6366f1' : '1px solid rgba(255,255,255,0.2)',
                                backgroundColor: uploadMethod === 'individual' ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255,255,255,0.05)',
                                color: '#fff',
                                cursor: 'pointer',
                                fontWeight: uploadMethod === 'individual' ? 600 : 400
                            }}
                        >
                            Individual Files
                        </button>
                    </div>
                </div>

                {/* Upload Area */}
                {uploadMethod === 'zip' ? (
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '14px' }}>
                            ZIP File
                        </label>
                        <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '8px' }}>
                            ZIP must contain 6 face images. Supported names: +x/-x, px/nx, posx/negx, right/left, etc.
                        </div>
                        <div
                            onClick={() => zipInputRef.current?.click()}
                            style={{
                                padding: '24px',
                                borderRadius: '8px',
                                border: '2px dashed rgba(255,255,255,0.2)',
                                backgroundColor: 'rgba(255,255,255,0.02)',
                                textAlign: 'center',
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                        >
                            {zipFile ? (
                                <div>
                                    <span style={{ fontSize: '20px' }}>&#128230;</span>
                                    <div style={{ marginTop: '8px', fontWeight: 500 }}>{zipFile.name}</div>
                                    <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '4px' }}>Click to change</div>
                                </div>
                            ) : (
                                <div>
                                    <span style={{ fontSize: '20px' }}>&#128193;</span>
                                    <div style={{ marginTop: '8px' }}>Click to select ZIP file</div>
                                </div>
                            )}
                        </div>
                        <input
                            ref={zipInputRef}
                            type="file"
                            accept=".zip"
                            onChange={(e) => handleZipChange(e.target.files?.[0] || null)}
                            style={{ display: 'none' }}
                        />
                    </div>
                ) : (
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '14px' }}>
                            Face Images
                        </label>
                        <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '12px' }}>
                            Upload 6 square images of the same size for each cube face
                        </div>
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(3, 1fr)',
                            gap: '8px'
                        }}>
                            {FACE_KEYS.map((key) => (
                                <div
                                    key={key}
                                    onClick={() => fileInputRefs.current[key]?.click()}
                                    style={{
                                        aspectRatio: '1',
                                        borderRadius: '8px',
                                        border: faceFiles[key] ? '2px solid #22c55e' : '2px dashed rgba(255,255,255,0.2)',
                                        backgroundColor: 'rgba(255,255,255,0.02)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: 'pointer',
                                        overflow: 'hidden',
                                        position: 'relative'
                                    }}
                                >
                                    {faceFiles[key] ? (
                                        <>
                                            <img
                                                src={URL.createObjectURL(faceFiles[key]!)}
                                                alt={key}
                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                            />
                                            <div style={{
                                                position: 'absolute',
                                                bottom: 0,
                                                left: 0,
                                                right: 0,
                                                backgroundColor: 'rgba(0,0,0,0.7)',
                                                padding: '4px',
                                                fontSize: '10px',
                                                textAlign: 'center'
                                            }}>
                                                {key}
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <span style={{ fontSize: '14px', opacity: 0.5 }}>+</span>
                                            <div style={{ fontSize: '10px', opacity: 0.7 }}>{key}</div>
                                        </>
                                    )}
                                    <input
                                        ref={(el) => { fileInputRefs.current[key] = el; }}
                                        type="file"
                                        accept="image/png,image/jpeg,image/jpg"
                                        onChange={(e) => handleIndividualFileChange(key, e.target.files?.[0] || null)}
                                        style={{ display: 'none' }}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Cube Face Orientation Guide */}
                <div style={{
                    padding: '12px',
                    backgroundColor: 'rgba(99, 102, 241, 0.1)',
                    borderRadius: '8px',
                    border: '1px solid rgba(99, 102, 241, 0.2)',
                    fontSize: '12px'
                }}>
                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>Cube Face Orientation:</div>
                    <div style={{ opacity: 0.8, lineHeight: 1.6 }}>
                        +X = Right | -X = Left | +Y = Top | -Y = Bottom | +Z = Front | -Z = Back
                    </div>
                </div>

                {/* Error Message */}
                {error && (
                    <div style={{
                        padding: '12px',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        borderRadius: '8px',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        color: '#f87171',
                        fontSize: '13px'
                    }}>
                        {error}
                    </div>
                )}

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
                    <button
                        onClick={handleClose}
                        disabled={isUploading}
                        style={{
                            padding: '10px 20px',
                            borderRadius: '8px',
                            border: '1px solid rgba(255,255,255,0.2)',
                            backgroundColor: 'transparent',
                            color: '#cfd6e4',
                            cursor: isUploading ? 'not-allowed' : 'pointer',
                            fontWeight: 500,
                            opacity: isUploading ? 0.5 : 1
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isUploading}
                        style={{
                            padding: '10px 24px',
                            borderRadius: '8px',
                            border: 'none',
                            backgroundColor: '#6366f1',
                            color: '#fff',
                            cursor: isUploading ? 'not-allowed' : 'pointer',
                            fontWeight: 600,
                            opacity: isUploading ? 0.7 : 1
                        }}
                    >
                        {isUploading ? 'Uploading...' : 'Add Skybox'}
                    </button>
                </div>
            </div>
        </ModalContainer>
    );
}
