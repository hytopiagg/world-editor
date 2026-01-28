import React from 'react';
import { BlockShapeType, BLOCK_SHAPES } from '../blocks/BlockShapes';
import { getRotationLabel } from '../blocks/BlockRotations';

interface BlockShapeSelectorProps {
    currentShapeType: string;
    setCurrentShapeType: (shapeType: string) => void;
    currentRotationIndex: number;
    setCurrentRotationIndex: (rotationIndex: number) => void;
}

const SHAPE_DISPLAY: { type: BlockShapeType; label: string; icon: string }[] = [
    { type: BlockShapeType.CUBE, label: 'Cube', icon: '\u25A0' },           // ■
    { type: BlockShapeType.HALF_SLAB, label: 'Slab', icon: '\u2584' },      // ▄
    { type: BlockShapeType.WEDGE_45, label: 'Wedge', icon: '\u25E2' },      // ◢
    { type: BlockShapeType.STAIRS_2, label: 'Stairs 2', icon: '\u2587' },   // ▇
    { type: BlockShapeType.STAIRS_3, label: 'Stairs 3', icon: '\u2586' },   // ▆
    { type: BlockShapeType.QUARTER, label: 'Quarter', icon: '\u25A3' },     // ▣
    { type: BlockShapeType.FENCE_POST, label: 'Post', icon: '\u2502' },     // │
    { type: BlockShapeType.CROSS, label: 'Cross', icon: '\u2716' },         // ✖
    { type: BlockShapeType.FENCE_1H, label: 'Fence 1', icon: '\u251C' },   // ├
    { type: BlockShapeType.FENCE_2H, label: 'Fence 2', icon: '\u2560' },   // ╠
    { type: BlockShapeType.OUTER_CORNER_STAIRS_2, label: 'Corner 2', icon: '\u2514' }, // └
    { type: BlockShapeType.OUTER_CORNER_STAIRS_3, label: 'Corner 3', icon: '\u2517' }, // ┗
];

const BlockShapeSelector: React.FC<BlockShapeSelectorProps> = ({
    currentShapeType,
    setCurrentShapeType,
    currentRotationIndex,
    setCurrentRotationIndex,
}) => {
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            padding: '8px',
            borderTop: '1px solid rgba(255,255,255,0.1)',
        }}>
            {/* Rotation indicator */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '11px',
                color: 'rgba(255,255,255,0.7)',
            }}>
                <span>Rotation: <strong style={{ color: currentRotationIndex > 0 ? '#4FC3F7' : 'rgba(255,255,255,0.5)' }}>
                    {getRotationLabel(currentRotationIndex)}
                </strong></span>
                {currentRotationIndex > 0 && (
                    <button
                        onClick={() => setCurrentRotationIndex(0)}
                        style={{
                            background: 'rgba(255,255,255,0.1)',
                            border: 'none',
                            borderRadius: '3px',
                            color: 'rgba(255,255,255,0.6)',
                            cursor: 'pointer',
                            fontSize: '10px',
                            padding: '2px 6px',
                        }}
                        title="Reset rotation (back to Y 0)"
                    >
                        Reset
                    </button>
                )}
            </div>
            <div style={{
                fontSize: '10px',
                color: 'rgba(255,255,255,0.4)',
            }}>
                R = rotate Y | T = change face
            </div>

            {/* Shape selector label */}
            <div style={{
                fontSize: '11px',
                color: 'rgba(255,255,255,0.7)',
                marginTop: '4px',
            }}>
                Block Shape:
            </div>

            {/* Shape grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '3px',
            }}>
                {SHAPE_DISPLAY.map(({ type, label, icon }) => {
                    const isSelected = currentShapeType === type;
                    return (
                        <button
                            key={type}
                            onClick={() => setCurrentShapeType(type)}
                            title={label}
                            style={{
                                width: '100%',
                                aspectRatio: '1',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: isSelected ? 'rgba(79, 195, 247, 0.3)' : 'rgba(255,255,255,0.05)',
                                border: isSelected ? '1px solid #4FC3F7' : '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '4px',
                                color: isSelected ? '#4FC3F7' : 'rgba(255,255,255,0.6)',
                                cursor: 'pointer',
                                fontSize: '16px',
                                lineHeight: 1,
                                padding: '2px',
                                transition: 'all 0.15s',
                            }}
                        >
                            <span>{icon}</span>
                            <span style={{ fontSize: '8px', marginTop: '2px', opacity: 0.7 }}>{label}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default BlockShapeSelector;
