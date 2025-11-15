# Selection Mode Entity Improvements - Implementation Plan

## Overview
This document outlines the comprehensive plan to enhance Selection Mode to support entity-based selection with bounding box visualization, intuitive manipulation controls, and sidebar integration for direct coordinate/rotation editing.

### UI/UX Approach for Mode Switching
The implementation uses a **three-layer visual feedback system** to make mode switching clear and intuitive:

1. **Toolbar Buttons** (Primary - Like Roblox Studio): 
   - Three buttons in the sidebar: "Move", "Rotate", "Scale"
   - Active button highlighted in blue, inactive buttons grey
   - Placed below existing selection mode buttons (Move/Copy/Delete)
   - Click to switch modes

2. **Gizmo Visual Feedback** (Secondary):
   - The gizmo itself shows/hides handles based on active mode
   - Translate mode: Only arrow handles visible
   - Rotate mode: Only arc handles visible  
   - Scale mode: Only cube handles visible
   - Active handles are brighter, inactive are dimmed

3. **Keyboard Shortcuts** (Tertiary - Power Users):
   - `G`/`W`: Move, `R`: Rotate, `S`: Scale
   - Updates both toolbar buttons and gizmo automatically

This ensures users always know the active mode through multiple visual cues, similar to professional 3D modeling tools.

## Current State Analysis

### Existing Functionality
1. **Selection Tool (`SelectionTool.ts`)**:
   - Currently supports area-based selection (click-drag rectangular area)
   - Handles both terrain blocks and environment objects
   - Supports move, copy, and delete modes
   - Uses instanced mesh previews for visualization
   - Updates database through `placeSelection()` method

2. **Environment Builder (`EnvironmentBuilder.tsx`)**:
   - Manages all environment objects via instanced meshes
   - `getAllEnvironmentObjects()` returns all instances with position, rotation, scale
   - Stores bounding box information (`boundingBoxWidth`, `boundingBoxHeight`, `boundingBoxDepth`, `boundingBoxCenter`)
   - Updates database via `updateLocalStorage()`

3. **Model Options Sidebar (`ModelOptionsSection.tsx`)**:
   - Currently shows model properties (scale, rotation, collider settings)
   - Displays placement settings, not instance-specific data
   - No position/rotation display for selected instances

4. **Raycasting**:
   - `TerrainRaycastUtils.tsx` handles terrain/block raycasting
   - No current entity-specific raycasting for hover detection

## Requirements

### 1. Entity Hover Detection
- When hovering over an entity in Selection Mode, detect the entity via raycasting
- Calculate and display a bounding box around the hovered entity
- Bounding box should automatically adjust to entity size (using stored bounding box data)

### 2. Entity Selection
- Click on hovered entity to select it
- Selected entity should show a persistent bounding box
- Support for single entity selection (can be extended to multi-select later)

### 3. Entity Manipulation
- **Standard 3D Modeling Gizmos/Manipulators**:
  - **Move/Translate Manipulator**: Arrows for X, Y, Z axis movement
  - **Rotate Manipulator**: Arcs/circles for X, Y, Z axis rotation
  - **Scale Manipulator**: Cubes/squares for X, Y, Z axis scaling
- **Mode Switching**: Toggle between Translate, Rotate, and Scale modes
- **Axis Locking**: Click individual axis handles to constrain movement
- **Snap to Grid**: Respect existing snap-to-grid settings
- **Visual Feedback**: Highlight active axis, show preview during manipulation

### 4. Sidebar Integration
- When an entity is selected, show in Model Options sidebar:
  - **Position**: X, Y, Z coordinates (editable input fields)
  - **Rotation**: X, Y, Z rotation values in degrees (editable input fields)
  - Display model name and ID
  - Show current scale values (read-only or editable)
- Real-time updates: Changes in sidebar should update entity position/rotation immediately
- Visual feedback: Entity should update in real-time as values change

### 5. Database Updates
- When manipulation is complete (mouse release or input blur):
  - Update entity position/rotation in `EnvironmentBuilder` instance data
  - Call `updateLocalStorage()` to persist changes
  - Trigger undo/redo save point
  - Update any spatial hash or culling systems

## Implementation Plan

### Phase 1: Entity Raycasting & Hover Detection

#### 1.1 Create Entity Raycasting Utility
**File**: `src/js/utils/EntityRaycastUtils.ts` (new)

**Purpose**: Handle raycasting against environment object instances

**Key Functions**:
```typescript
interface EntityRaycastResult {
    entity: {
        modelUrl: string;
        instanceId: number;
        position: THREE.Vector3;
        rotation: THREE.Euler;
        scale: THREE.Vector3;
    };
    distance: number;
    point: THREE.Vector3;
}

function raycastEntities(
    raycaster: THREE.Raycaster,
    environmentBuilder: EnvironmentBuilderRef,
    camera: THREE.Camera
): EntityRaycastResult | null
```

**Implementation Details**:
- Iterate through all instanced meshes in `EnvironmentBuilder`
- For each mesh, perform raycast intersection test
- Use bounding box for more accurate detection (not just point-based)
- Return closest intersection with entity data

#### 1.2 Add Hover State to SelectionTool
**File**: `src/js/tools/SelectionTool.ts`

**Changes**:
- Add `hoveredEntity: EntityRaycastResult | null` property
- Add `hoveredEntityBoundingBox: THREE.Group | null` for visualization
- Modify `handleMouseMove()` to:
  1. Perform entity raycast
  2. Update `hoveredEntity` state
  3. Show/hide bounding box preview

#### 1.3 Bounding Box Visualization
**File**: `src/js/tools/SelectionTool.ts`

**New Method**: `createEntityBoundingBox(entity: EntityRaycastResult): THREE.Group`

**Implementation**:
- Get bounding box dimensions from `environmentModels` (or calculate from model)
- Create wireframe box using `THREE.BoxGeometry` and `THREE.EdgesGeometry`
- Position and rotate box to match entity transform
- Use distinct color (e.g., cyan/blue) for hover state
- Add padding/margin for better visibility

### Phase 2: Entity Selection & State Management

#### 2.1 Selection State
**File**: `src/js/tools/SelectionTool.ts`

**New Properties**:
```typescript
selectedEntity: {
    modelUrl: string;
    instanceId: number;
    originalPosition: THREE.Vector3;
    originalRotation: THREE.Euler;
    currentPosition: THREE.Vector3;
    currentRotation: THREE.Euler;
    scale: THREE.Vector3;
} | null;

isManipulating: boolean; // True when dragging/rotating
manipulationStartPosition: THREE.Vector3 | null;
manipulationStartRotation: THREE.Euler | null;
```

#### 2.2 Selection Logic
**File**: `src/js/tools/SelectionTool.ts`

**Modify `handleMouseDown()`**:
- If hovering over entity and no selection active:
  - Select entity
  - Store original position/rotation
  - Show persistent bounding box
  - Notify sidebar component (via callback or event)
- If entity selected and clicking empty space:
  - Deselect entity
  - Hide bounding box
- If entity selected and clicking on entity:
  - Begin manipulation (if in move mode)

### Phase 3: Gizmo System Implementation

#### 3.1 Gizmo Architecture
**Approach**: Use Three.js `TransformControls` or build custom gizmo system

**Option A: Use THREE.TransformControls** (Recommended for faster implementation)
- Three.js provides `examples/jsm/controls/TransformControls`
- Supports translate, rotate, and scale modes
- Built-in axis highlighting and visual feedback
- Handles mouse interaction automatically

**Option B: Custom Gizmo Implementation** (More control, more work)
- Build custom gizmo meshes for each mode
- Implement raycasting for handle selection
- Custom visual styling and behavior

**Decision**: Start with Option A (TransformControls), can migrate to custom if needed

#### 3.2 Gizmo Integration
**File**: `src/js/tools/SelectionTool.ts`

**New Properties**:
```typescript
transformControls: THREE.TransformControls | null;
gizmoMode: 'translate' | 'rotate' | 'scale';
gizmoObject: THREE.Object3D | null; // Helper object for gizmo attachment
```

**Important: Helper Object Approach**
Since entities use instanced meshes (not individual Object3D instances), we need a helper object approach:
- Create a temporary `THREE.Object3D` at the entity's world position
- Attach `TransformControls` to this helper object
- When gizmo changes, update the entity's instance data in `EnvironmentBuilder`
- Sync helper object transform with entity transform (bidirectional)
- This allows `TransformControls` to work with instanced meshes

**Implementation Steps**:
1. Import `TransformControls` from Three.js examples
2. Create helper `Object3D` at entity position (for gizmo attachment)
3. Set helper object's position/rotation/scale to match entity
4. Attach `TransformControls` to helper object
5. Add `TransformControls` to scene (it manages its own rendering)
6. Listen to `TransformControls` change events
7. On change: Update entity instance data in `EnvironmentBuilder`
8. On sidebar change: Update helper object transform (syncs gizmo)

**Key Methods**:
```typescript
setupGizmo(entity: SelectedEntity): void
updateGizmoPosition(): void  // Sync gizmo with entity
onGizmoChange(): void        // Update entity from gizmo
setGizmoMode(mode: 'translate' | 'rotate' | 'scale'): void
disposeGizmo(): void         // Clean up when deselected
```

#### 3.3 Gizmo Visual Customization
**File**: `src/js/tools/SelectionTool.ts` or `src/js/utils/GizmoUtils.ts` (new)

**Customization Options**:
- **Colors** (Standard Three.js defaults): 
  - X-axis: Red (0xff0000)
  - Y-axis: Green (0x00ff00)
  - Z-axis: Blue (0x0000ff)
- **Handle Sizes**: Adjustable based on camera distance
- **Mode-Based Visibility**: TransformControls automatically shows/hides handles:
  - `mode = 'translate'`: Only arrow handles visible
  - `mode = 'rotate'`: Only arc handles visible
  - `mode = 'scale'`: Only cube handles visible
- **Opacity**: Handles slightly transparent when not actively manipulating
- **Space**: Toggle between 'world' (default) and 'local' space

**Implementation**:
- Configure `TransformControls` appearance via properties:
  ```typescript
  transformControls.setMode('translate' | 'rotate' | 'scale');
  transformControls.setSpace('world' | 'local');
  transformControls.setSize(1.0); // Adjust handle size
  transformControls.showX = true;
  transformControls.showY = true;
  transformControls.showZ = true;
  ```
- Set `size` property for handle visibility (auto-scale with camera distance)
- Handle highlighting happens automatically when dragging

#### 3.4 Mode Switching
**File**: `src/js/tools/SelectionTool.ts` and `src/js/components/SelectionToolOptionsSection.tsx`

**Three-Layer Visual Feedback System**:

1. **Toolbar Buttons** (Primary UI - Like Roblox Studio):
   - Add mode buttons to toolbar or SelectionToolOptionsSection
   - Three distinct buttons: "Move", "Rotate", "Scale"
   - Active button highlighted (similar to existing selection mode buttons)
   - Icons:
     - Move: Arrow icon or "Move" text
     - Rotate: Circular arrow icon or "Rotate" text
     - Scale: Expand icon or "Scale" text
   - Click button to switch mode
   - Visual state: Active button has blue background, inactive buttons are grey

2. **Gizmo Visual Indication** (Secondary Feedback):
   - TransformControls automatically shows/hides handles based on mode:
     - **Translate mode**: Shows arrow handles, hides arcs and cubes
     - **Rotate mode**: Shows arc handles, hides arrows and cubes
     - **Scale mode**: Shows cube handles, hides arrows and arcs
   - Active handles are brighter/more opaque
   - Inactive handles (if visible) are dimmed/transparent
   - Center sphere always visible for reference

3. **Keyboard Shortcuts** (Tertiary - Power Users):
   - `G` or `W`: Translate/Move mode
   - `R`: Rotate mode
   - `S`: Scale mode
   - `X`: Toggle X-axis constraint
   - `Y`: Toggle Y-axis constraint
   - `Z`: Toggle Z-axis constraint
   - `Space`: Toggle between world/local space

**UI Component Integration**:
- Extend `SelectionToolOptionsSection.tsx` to include gizmo mode buttons
- Or create new `GizmoModeSelector.tsx` component
- Place buttons near existing selection mode buttons (Move/Copy/Delete)
- Sync button state with `SelectionTool.gizmoMode`
- Update buttons when mode changes via keyboard shortcut

**Visual Design**:
- Match existing button style from `SelectionToolOptionsSection`
- Use same color scheme (blue for active, grey for inactive)
- Group gizmo mode buttons together visually
- Show tooltips on hover with keyboard shortcuts

#### 3.5 Translation (Move) Manipulator
**Implementation**:
- Arrow handles for each axis (X, Y, Z)
- Click and drag arrow to move along that axis
- Click center (yellow) to move freely in plane
- Visual feedback: Highlight active axis
- Snap to grid: Apply when enabled

**Key Method**: `handleTranslateChange(event)`
- Extract translation delta from `TransformControls`
- Apply to entity position
- Update instance matrix
- Update sidebar values

#### 3.6 Rotation Manipulator
**Implementation**:
- Arc/circle handles for each axis
- Click and drag arc to rotate around that axis
- Visual feedback: Highlight active rotation axis
- Show rotation angle during manipulation
- Constrain to axis when dragging specific arc

**Key Method**: `handleRotateChange(event)`
- Extract rotation delta from `TransformControls`
- Convert to Euler angles
- Apply to entity rotation
- Update instance matrix
- Update sidebar values

#### 3.7 Scale Manipulator
**Implementation**:
- Cube/square handles for each axis
- Click and drag cube to scale along that axis
- Click center (yellow) to scale uniformly
- Visual feedback: Highlight active scale axis
- Prevent negative scale (or allow with modifier)

**Key Method**: `handleScaleChange(event)`
- Extract scale delta from `TransformControls`
- Apply to entity scale
- Update instance matrix
- Update sidebar values

#### 3.8 Gizmo Event Handling
**File**: `src/js/tools/SelectionTool.ts`

**Event Listeners**:
```typescript
transformControls.addEventListener('change', onGizmoChange);
transformControls.addEventListener('dragging-changed', onDraggingChanged);
transformControls.addEventListener('mouseDown', onGizmoMouseDown);
transformControls.addEventListener('mouseUp', onGizmoMouseUp);
```

**Implementation**:
- `onGizmoChange`: Update entity transform in real-time
- `onDraggingChanged`: Show/hide other UI elements during manipulation
- `onGizmoMouseDown`: Store original transform for undo
- `onGizmoMouseUp`: Commit changes to database

#### 3.9 Visual Feedback During Manipulation
- Update entity position/rotation/scale in real-time
- Update bounding box visualization
- Update gizmo position (for rotate/scale modes)
- Show helper lines/guides (optional)
- Update sidebar values live
- Preview changes without committing to database until mouse release

### Phase 4: UI Integration

#### 4.1 Gizmo Mode Selector Component
**File**: `src/js/components/SelectionToolOptionsSection.tsx` (extend existing) or `src/js/components/GizmoModeSelector.tsx` (new)

**Purpose**: Provide toolbar buttons for switching between Move/Rotate/Scale modes

**Implementation**:
- Add three buttons: "Move", "Rotate", "Scale"
- Place buttons in `SelectionToolOptionsSection` component
- Sync with `SelectionTool.gizmoMode` property
- Update `SelectionTool` when button clicked
- Highlight active button (blue background)
- Show keyboard shortcuts in tooltips

**Props** (if separate component):
```typescript
interface GizmoModeSelectorProps {
    currentMode: 'translate' | 'rotate' | 'scale';
    onModeChange: (mode: 'translate' | 'rotate' | 'scale') => void;
    isCompactMode: boolean;
}
```

**Visual Design**:
- Match existing button style from `SelectionToolOptionsSection`
- Place gizmo mode buttons below or next to existing selection mode buttons (Move/Copy/Delete)
- Use text labels: "Move", "Rotate", "Scale" (matching existing "Move", "Copy", "Delete" style)
- Show active state clearly (blue background when active, grey when inactive)
- Layout example:
  ```
  [Move] [Copy] [Delete]  ← Existing selection mode buttons
  [Move] [Rotate] [Scale] ← New gizmo mode buttons
  ```

**Component Structure**:
- Extend `SelectionToolOptionsSection.tsx` to add gizmo mode section
- Add new state for `gizmoMode` (similar to existing `mode` state)
- Sync with `SelectionTool.gizmoMode` property
- Update `SelectionTool.setGizmoMode()` when button clicked
- Listen for keyboard shortcuts and update button state

#### 4.2 New Component: EntityOptionsSection
**File**: `src/js/components/EntityOptionsSection.tsx` (new)

**Purpose**: Display and edit selected entity properties

**Props**:
```typescript
interface EntityOptionsSectionProps {
    selectedEntity: SelectedEntity | null;
    onPositionChange: (position: THREE.Vector3) => void;
    onRotationChange: (rotation: THREE.Euler) => void;
    onScaleChange?: (scale: THREE.Vector3) => void;
    isCompactMode: boolean;
}
```

**UI Elements**:
- Entity name and model URL (read-only)
- Position inputs (X, Y, Z) with labels
- Rotation inputs (X, Y, Z in degrees) with labels
- Scale display (read-only or editable)
- "Reset" button to restore original values
- "Delete" button to remove entity

#### 4.2 Integrate into BlockToolOptions
**File**: `src/js/components/BlockToolOptions.tsx`

**Changes**:
- Add conditional rendering: Show `EntityOptionsSection` when entity is selected
- Hide `ModelOptionsSection` when entity is selected (or show both?)
- Pass selection tool ref or callback to access selected entity

#### 4.3 Real-time Updates
**Implementation**:
- Use controlled inputs with `onChange` handlers
- Debounce rapid changes (e.g., 100ms) to avoid performance issues
- Update entity immediately on input change
- Visual feedback: Entity moves/rotates as user types

**Key Methods**:
```typescript
handlePositionInputChange(axis: 'x' | 'y' | 'z', value: number)
handleRotationInputChange(axis: 'x' | 'y' | 'z', value: number)
```

### Phase 5: Database Persistence

#### 5.1 Update Entity Instance
**File**: `src/js/EnvironmentBuilder.tsx`

**New Method**: `updateEntityInstance(
    modelUrl: string,
    instanceId: number,
    position: THREE.Vector3,
    rotation: THREE.Euler,
    scale?: THREE.Vector3
): void`

**Implementation**:
- Find instance in `instancedMeshes.current`
- Update instance data (position, rotation, scale)
- Recalculate instance matrix
- Update instanced mesh matrix
- Mark for database save

#### 5.2 Commit Changes
**File**: `src/js/tools/SelectionTool.ts`

**New Method**: `commitEntityChanges()`

**Implementation**:
- Call `EnvironmentBuilder.updateEntityInstance()`
- Call `EnvironmentBuilder.updateLocalStorage()`
- Create undo/redo entry via `undoRedoManager`
- Clear manipulation state
- Keep entity selected (for further edits)

**Trigger Points**:
- Mouse release after drag
- Input blur in sidebar
- Explicit "Apply" button (optional)

#### 5.3 Undo/Redo Support
- Store entity state before manipulation
- Create undo entry with entity ID and changes
- Support undo/redo through existing system

### Phase 6: Integration & Polish

#### 6.1 Mode Switching
- When Selection Tool is active, check for entity hover first
- Fall back to area selection if no entity hovered
- Toggle between entity selection and area selection modes (optional)

#### 6.2 Visual Polish
- Bounding box colors:
  - Hover: Cyan/light blue (0x00ffff)
  - Selected: Yellow/gold (0xffff00)
  - Manipulating: Green (0x00ff00)
- Line thickness: 2-3px for visibility
- Corner/edge highlights for better 3D perception
- Optional: Show entity name label above bounding box

#### 6.3 Performance Optimization
- Throttle hover raycasting (e.g., every 50-100ms)
- Only raycast when in Selection Mode
- Cache bounding box geometries
- Use object pooling for temporary vectors/matrices

#### 6.4 Error Handling
- Handle cases where entity is deleted while selected
- Handle cases where model fails to load
- Validate input ranges (position/rotation bounds)
- Show error messages for invalid operations

## Technical Considerations

### Coordinate Systems
- Ensure consistent coordinate system between:
  - Entity instance data (world coordinates)
  - Sidebar inputs (world coordinates)
  - Bounding box visualization (world coordinates)
- Handle Y-offset (`ENVIRONMENT_OBJECT_Y_OFFSET`) correctly

### Matrix Updates
- Entity instances use instanced meshes with matrices
- Must update matrix correctly when position/rotation/scale changes
- Gizmo helper object must be synced with entity transform
- TransformControls updates helper object, which triggers entity update
- Account for model's bounding box center offset
- Consider local vs world space transformations

### Raycasting Performance
- With many entities, raycasting can be expensive
- Consider spatial acceleration (spatial hash for entities)
- Limit raycast distance
- Early exit on first hit (if acceptable)

### State Synchronization
- Keep SelectionTool state in sync with EnvironmentBuilder
- Handle external changes (undo/redo, import, etc.)
- Refresh selection state when entities change
- Sync gizmo helper object with entity transform
- Update gizmo when entity changes via sidebar
- Handle gizmo mode changes (translate/rotate/scale)
- Ensure gizmo is properly disposed when entity is deselected

## Testing Checklist

### Functionality Tests
- [ ] Hover detection works for all entity types
- [ ] Bounding box displays correctly for different sized entities
- [ ] Entity selection works (click to select)
- [ ] Entity deselection works (click empty space)
- [ ] Gizmo appears when entity is selected
- [ ] Toolbar buttons for Move/Rotate/Scale are visible
- [ ] Active mode button is highlighted correctly
- [ ] Translate mode works (arrow handles visible)
- [ ] Rotate mode works (arc handles visible)
- [ ] Scale mode works (cube handles visible)
- [ ] Mode switching works via toolbar buttons
- [ ] Mode switching works via keyboard shortcuts (G/R/S keys)
- [ ] Gizmo visual updates when mode changes (handles show/hide)
- [ ] Axis constraints work (X/Y/Z keys)
- [ ] Snap-to-grid works for entity movement
- [ ] Gizmo updates position when entity moves via sidebar
- [ ] Sidebar displays correct position/rotation/scale
- [ ] Sidebar inputs update entity in real-time
- [ ] Database updates on commit (mouse release)
- [ ] Undo/redo works for entity manipulation
- [ ] Works with custom models
- [ ] Works with scaled/rotated entities
- [ ] Gizmo visibility adjusts with camera distance

### Edge Cases
- [ ] Entity deleted while selected
- [ ] Multiple rapid selections
- [ ] Very large entities (bounding box visibility)
- [ ] Entities at extreme positions
- [ ] Entities with unusual rotations
- [ ] Switching tools while entity selected
- [ ] Undo/redo during manipulation

### Performance Tests
- [ ] Hover detection performance with 100+ entities
- [ ] Real-time updates don't cause lag
- [ ] Bounding box rendering performance
- [ ] Database save performance

## File Changes Summary

### New Files
1. `src/js/utils/EntityRaycastUtils.ts` - Entity raycasting utilities
2. `src/js/components/EntityOptionsSection.tsx` - Sidebar component for entity editing
3. `src/js/utils/GizmoUtils.ts` - Gizmo configuration and utilities (optional, if custom styling needed)
4. `src/js/components/GizmoModeSelector.tsx` - Gizmo mode button component (optional, can be integrated into SelectionToolOptionsSection)

### Modified Files
1. `src/js/tools/SelectionTool.ts` - Add entity selection/manipulation logic
2. `src/js/EnvironmentBuilder.tsx` - Add `updateEntityInstance()` method
3. `src/js/components/BlockToolOptions.tsx` - Integrate EntityOptionsSection
4. `src/js/components/ModelOptionsSection.tsx` - Possibly extend for entity display
5. `src/js/components/SelectionToolOptionsSection.tsx` - Add gizmo mode buttons (Move/Rotate/Scale)

### Dependencies
- **Three.js TransformControls**: `three/examples/jsm/controls/TransformControls`
  - Already available in Three.js examples
  - No additional package installation needed
- Uses existing Three.js utilities
- Uses existing database management system

## Implementation Order

1. **Phase 1**: Entity raycasting and hover detection (foundation)
2. **Phase 2**: Selection state management (core functionality)
3. **Phase 3**: Gizmo system implementation
   - 3.1: Set up TransformControls infrastructure
   - 3.2: Implement helper object approach for instanced meshes
   - 3.3: Translate manipulator (arrow handles)
   - 3.4: Rotate manipulator (arc handles)
   - 3.5: Scale manipulator (cube handles)
   - 3.6: Mode switching and event handling
4. **Phase 4**: Sidebar integration (UI feedback)
5. **Phase 5**: Database persistence (data integrity)
6. **Phase 6**: Polish and optimization (user experience)

## Future Enhancements (Out of Scope)

- Multi-entity selection (shift-click, box selection)
- Custom gizmo styling (beyond TransformControls defaults)
- Constraint-based movement (plane locking, snap to surface)
- Entity grouping
- Copy/paste entities
- Entity properties panel (custom metadata)
- Animation preview for entities with animations
- Gizmo size auto-adjustment based on entity size
- Local vs World space toggle UI

## Notes

- This implementation maintains backward compatibility with existing area-based selection
- Entity selection can coexist with block selection (user chooses mode)
- Consider adding a toggle in UI to switch between entity mode and area mode
- Performance optimizations can be added incrementally based on testing
- Using Three.js TransformControls provides industry-standard gizmo behavior
- Gizmo helper object approach allows proper attachment to instanced mesh entities
- Consider adding visual mode indicators in the UI (toolbar buttons for Translate/Rotate/Scale)

