# Particle Viewer Implementation Plan

## Table of Contents

1. [Overview](#overview)
2. [Requirements](#requirements)
3. [Architecture Overview](#architecture-overview)
4. [Component Structure](#component-structure)
5. [Integration Points](#integration-points)
6. [Particle System Integration](#particle-system-integration)
7. [UI/UX Design](#uiux-design)
8. [Technical Implementation Details](#technical-implementation-details)
9. [File Structure](#file-structure)
10. [Implementation Phases](#implementation-phases)
11. [Open Questions & Considerations](#open-questions--considerations)

---

## Overview

This document outlines the implementation plan for a **Visual Particle Viewer** feature that will be accessible from the Project Home page. The particle viewer allows users to:

-   Visualize particle effects in a dedicated 3D canvas
-   Select different target objects (player model, simple block, or nothing)
-   Create and configure multiple particle emitters simultaneously
-   Preview particle effects in real-time with an intuitive UI

The particle system will be aligned with the HYTOPIA SDK's particle emitter system, ensuring consistency and compatibility.

---

## Requirements

### Functional Requirements

1. **Access from Project Home**

    - New navigation item or button in Project Home to open Particle Viewer
    - Standalone page/mode that doesn't require a project to be open

2. **Target Object Selection**

    - Option to select:
        - Player model (from `./assets/models/player/player.gltf`)
        - Simple block (3D cube primitive)
        - Nothing (empty scene)
    - Selected object appears centered in the canvas

3. **Particle Emitter Management**

    - Create multiple particle emitters simultaneously
    - Each emitter can be independently configured
    - Real-time preview of all active emitters
    - Ability to pause, restart, or remove individual emitters

4. **Particle Configuration UI**

    - Sidebar with controls for all particle emitter properties:
        - Texture URI selection/upload (from `public/assets/particles/` folder)
        - Position and offset
        - Velocity and velocity variance
        - Gravity
        - Lifetime and lifetime variance
        - Rate and rate variance
        - Size (start/end) and size variance
        - Opacity (start/end) and opacity variance
        - Color (start/end) and color variance
        - Alpha test
        - Transparency toggle
        - Max particles
        - Pause/restart controls
        - Burst functionality

5. **Visual Features**
    - 3D canvas with orbit controls for camera manipulation
    - Proper lighting setup
    - Grid helper for reference
    - Skybox support (optional)
    - Real-time particle rendering

### Technical Requirements

1. **Particle System Alignment**

    - Use the same particle emitter architecture as the SDK
    - Support all properties defined in `ParticleEmitterCoreOptions`
    - Compatible with the protocol schema (`ParticleEmitterSchema`)

2. **Performance**

    - Smooth 60 FPS rendering with multiple emitters
    - Efficient memory management
    - Proper cleanup on unmount

3. **Code Organization**
    - Reusable components
    - Separation of concerns (UI, particle logic, rendering)
    - TypeScript for type safety

---

## Architecture Overview

### High-Level Architecture

```
ProjectHome
  └── Particle Viewer Button/Link
       └── ParticleViewerPage (new route/page)
            ├── ParticleViewerSidebar
            │    ├── TargetObjectSelector
            │    ├── ParticleEmitterList
            │    │    └── ParticleEmitterCard (multiple)
            │    │         └── ParticleEmitterControls
            │    └── CreateEmitterButton
            └── ParticleViewerCanvas
                 ├── React Three Fiber Canvas
                 ├── TargetObjectRenderer
                 └── ParticleEmitterRenderer (multiple)
```

### State Management

-   **Component State**: Use React hooks (`useState`, `useRef`) for local state
-   **Particle Emitters**: Array of emitter configurations stored in component state
-   **Target Object**: Current selection stored in state
-   **No Global State**: Self-contained page, no need for Redux/Context

---

## Component Structure

### 1. ParticleViewerPage (Main Container)

**Location**: `src/js/components/ParticleViewerPage.tsx`

**Responsibilities**:

-   Main container component
-   Manages overall state (emitters, target object)
-   Coordinates between sidebar and canvas
-   Handles navigation back to Project Home

**Props**: None (standalone page)

**State**:

```typescript
interface ParticleViewerState {
    targetObject: "player" | "block" | "none";
    emitters: ParticleEmitterConfig[];
    selectedEmitterId: string | null;
}
```

### 2. ParticleViewerSidebar

**Location**: `src/js/components/ParticleViewerPage/ParticleViewerSidebar.tsx`

**Responsibilities**:

-   Render left sidebar UI
-   Host target object selector
-   Display list of particle emitters
-   Provide "Create Emitter" button

**Props**:

```typescript
interface ParticleViewerSidebarProps {
    targetObject: "player" | "block" | "none";
    onTargetObjectChange: (target: "player" | "block" | "none") => void;
    emitters: ParticleEmitterConfig[];
    selectedEmitterId: string | null;
    onEmitterSelect: (id: string | null) => void;
    onEmitterCreate: () => void;
    onEmitterDelete: (id: string) => void;
}
```

### 3. TargetObjectSelector

**Location**: `src/js/components/ParticleViewerPage/TargetObjectSelector.tsx`

**Responsibilities**:

-   Radio button group for selecting target object
-   Visual preview icons/thumbnails

**Props**:

```typescript
interface TargetObjectSelectorProps {
    value: "player" | "block" | "none";
    onChange: (value: "player" | "block" | "none") => void;
}
```

### 4. ParticleEmitterList

**Location**: `src/js/components/ParticleViewerPage/ParticleEmitterList.tsx`

**Responsibilities**:

-   Render scrollable list of emitter cards
-   Handle selection highlighting

**Props**:

```typescript
interface ParticleEmitterListProps {
    emitters: ParticleEmitterConfig[];
    selectedEmitterId: string | null;
    onEmitterSelect: (id: string) => void;
    onEmitterDelete: (id: string) => void;
}
```

### 5. ParticleEmitterCard

**Location**: `src/js/components/ParticleViewerPage/ParticleEmitterCard.tsx`

**Responsibilities**:

-   Display emitter name/ID
-   Show active/paused status
-   Collapsible controls panel
-   Delete button

**Props**:

```typescript
interface ParticleEmitterCardProps {
    emitter: ParticleEmitterConfig;
    isSelected: boolean;
    onSelect: () => void;
    onDelete: () => void;
    onUpdate: (updates: Partial<ParticleEmitterConfig>) => void;
}
```

### 6. ParticleEmitterControls

**Location**: `src/js/components/ParticleViewerPage/ParticleEmitterControls.tsx`

**Responsibilities**:

-   Form controls for all particle properties
-   Organized into collapsible sections:
    -   Basic (texture, position, offset)
    -   Emission (rate, lifetime, max particles)
    -   Motion (velocity, gravity)
    -   Appearance (size, opacity, color)
    -   Advanced (alpha test, transparency)

**Props**:

```typescript
interface ParticleEmitterControlsProps {
    emitter: ParticleEmitterConfig;
    onUpdate: (updates: Partial<ParticleEmitterConfig>) => void;
}
```

### 7. ParticleViewerCanvas

**Location**: `src/js/components/ParticleViewerPage/ParticleViewerCanvas.tsx`

**Responsibilities**:

-   React Three Fiber Canvas setup
-   Render target object
-   Render all particle emitters
-   Camera controls (OrbitControls)
-   Lighting setup
-   Animation loop

**Props**:

```typescript
interface ParticleViewerCanvasProps {
    targetObject: "player" | "block" | "none";
    emitters: ParticleEmitterConfig[];
}
```

### 8. TargetObjectRenderer

**Location**: `src/js/components/ParticleViewerPage/TargetObjectRenderer.tsx`

**Responsibilities**:

-   Load and render player model (GLTF)
-   Render simple block (BoxGeometry)
-   Position object at center (0, 0, 0)
-   Handle cleanup

**Props**:

```typescript
interface TargetObjectRendererProps {
    type: "player" | "block" | "none";
}
```

### 9. ParticleEmitterRenderer

**Location**: `src/js/components/ParticleViewerPage/ParticleEmitterRenderer.tsx`

**Responsibilities**:

-   Create and manage ParticleEmitterCore instance
-   Update emitter based on configuration changes
-   Handle attachment to target object (if applicable)
-   Cleanup on unmount

**Props**:

```typescript
interface ParticleEmitterRendererProps {
    config: ParticleEmitterConfig;
    targetObjectRef?: React.RefObject<THREE.Object3D>;
    targetObjectType: "player" | "block" | "none";
}
```

---

## Integration Points

### 1. Project Home Integration

**Option A: Navigation Item**

-   Add new item to `ProjectSidebar` NAV_ITEMS array
-   Key: `'particle-viewer'`
-   Icon: Particle/sparkle icon
-   When clicked, set a route/page state

**Option B: Button in Header**

-   Add button in `ProjectHeader` component
-   Opens Particle Viewer in a modal or new route

**Option C: Standalone Route**

-   Use React Router (if available) or hash-based routing
-   Route: `#particle-viewer`
-   Check hash in ProjectHome and render ParticleViewerPage

**Recommended**: Option C (hash-based routing) - simplest and consistent with existing navigation pattern

### 2. App.tsx Integration

**Modification needed**:

```typescript
// In App.tsx
const [currentPage, setCurrentPage] = useState<
    "home" | "particle-viewer" | "project"
>("home");

// Check hash on mount/change
useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash === "particle-viewer") {
        setCurrentPage("particle-viewer");
    } else if (projectId) {
        setCurrentPage("project");
    } else {
        setCurrentPage("home");
    }
}, [projectId, window.location.hash]);
```

### 3. Particle System Integration

The particle viewer will use a **simplified, client-side only** version of the SDK's particle system:

-   **Reuse**: `ParticleEmitterCore` logic (copy/adapt from SDK)
-   **Skip**: Network serialization, server-side management
-   **Adapt**: Direct Three.js integration without Game/EntityManager dependencies

---

## Particle System Integration

### SDK Particle System Analysis

From the attached SDK files, the particle system consists of:

1. **ParticleEmitterCore** (`ParticleEmitterCore.ts`)

    - Core particle rendering logic
    - InstancedMesh-based rendering
    - Shader-based particle animation
    - Properties: texture, gravity, lifetime, rate, size, opacity, color, etc.

2. **ParticleEmitter** (`ParticleEmitter.ts`)

    - Wrapper around ParticleEmitterCore
    - Handles entity attachment
    - Position/offset management
    - Texture loading via CustomTextureManager

3. **ParticleEmitterManager** (`ParticlesManager.ts`)
    - Manages multiple emitters
    - Updates emitters in animation loop
    - Handles network packets (not needed for viewer)

### Adaptation Strategy

**For the Particle Viewer**, we need to:

1. **Extract Core Logic**

    - Copy `ParticleEmitterCore.ts` to `src/js/particles/ParticleEmitterCore.ts`
    - Adapt to work standalone (no Game dependency)
    - Keep shader code and InstancedMesh logic

2. **Create Simplified Wrapper**

    - Create `src/js/particles/ParticleEmitter.ts`
    - Simplified version without entity attachment complexity
    - Direct Three.js scene integration

3. **Texture Loading**

    - Use Three.js `TextureLoader` directly
    - Support both file paths and data URIs
    - Cache loaded textures

4. **Animation Loop**
    - Use React Three Fiber's `useFrame` hook
    - Update all emitters each frame
    - Pass deltaTime to emitter.update()

### ParticleEmitterCore Adaptation

**Key Changes Needed**:

1. **Remove Game Dependency**

    ```typescript
    // Instead of: this._game.customTextureManager.load()
    // Use: new THREE.TextureLoader().load()
    ```

2. **Simplify Texture Management**

    ```typescript
    // Remove CustomTextureWrapper complexity
    // Use THREE.Texture directly
    ```

3. **Direct Scene Integration**

    ```typescript
    // Instead of: this._game.renderer.addToScene()
    // Use: scene.add(emitterCore.mesh)
    ```

4. **Remove Network Dependencies**
    - Remove all serialization code
    - Keep only rendering logic

### Configuration Interface

```typescript
interface ParticleEmitterConfig {
    id: string; // Unique ID for React key
    name?: string; // User-friendly name

    // Core options (matches ParticleEmitterCoreOptions)
    textureUri: string;
    alphaTest?: number;
    colorStart?: { r: number; g: number; b: number };
    colorEnd?: { r: number; g: number; b: number };
    colorStartVariance?: { r: number; g: number; b: number };
    colorEndVariance?: { r: number; number; b: number };
    gravity?: { x: number; y: number; z: number };
    lifetime?: number;
    lifetimeVariance?: number;
    maxParticles?: number;
    opacityEnd?: number;
    opacityEndVariance?: number;
    opacityStart?: number;
    opacityStartVariance?: number;
    position?: { x: number; y: number; z: number };
    positionVariance?: { x: number; y: number; z: number };
    rate?: number;
    rateVariance?: number;
    sizeEnd?: number;
    sizeEndVariance?: number;
    sizeStart?: number;
    sizeStartVariance?: number;
    transparent?: boolean;
    velocity?: { x: number; y: number; z: number };
    velocityVariance?: { x: number; y: number; z: number };

    // Emitter-level options
    offset?: { x: number; y: number; z: number };
    attachedToTarget?: boolean; // Attach to target object if true
    paused?: boolean;

    // UI state
    expanded?: boolean; // For collapsible controls
}
```

---

## UI/UX Design

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  [Back]  Particle Viewer                    [Settings]  │
├──────────┬──────────────────────────────────────────────┤
│          │                                              │
│ Sidebar  │            Canvas Area                       │
│ (280px)  │         (React Three Fiber)                  │
│          │                                              │
│ ┌──────┐ │  ┌──────────────────────────────────────┐  │
│ │Target│ │  │                                      │  │
│ │Object│ │  │      [3D Scene with Particles]      │  │
│ │      │ │  │                                      │  │
│ │○ None│ │  │                                      │  │
│ │○ Block│ │  │                                      │  │
│ │○ Player│ │  │                                      │  │
│ └──────┘ │  └──────────────────────────────────────┘  │
│          │                                              │
│ ┌──────┐ │                                              │
│ │Emitters│ │                                              │
│ │        │ │                                              │
│ │[+ New] │ │                                              │
│ │        │ │                                              │
│ │┌──────┐│ │                                              │
│ ││Emitter││ │                                              │
│ ││ 1    ││ │                                              │
│ ││[▼]   ││ │                                              │
│ │└──────┘│ │                                              │
│ │        │ │                                              │
│ │┌──────┐│ │                                              │
│ ││Emitter││ │                                              │
│ ││ 2    ││ │                                              │
│ ││[▶]   ││ │                                              │
│ │└──────┘│ │                                              │
│ └────────┘ │                                              │
└────────────┴──────────────────────────────────────────────┘
```

### Sidebar Sections

1. **Target Object Selector** (Top)

    - Radio buttons with icons
    - Visual preview thumbnails

2. **Particle Emitters List** (Scrollable)

    - "Create New Emitter" button at top
    - List of emitter cards
    - Each card shows:
        - Emitter name/ID
        - Active/Paused indicator
        - Expand/collapse button
        - Delete button
    - Selected emitter highlighted

3. **Emitter Controls** (When expanded)
    - Collapsible sections:
        - **Basic**: Texture, Position, Offset
        - **Emission**: Rate, Lifetime, Max Particles
        - **Motion**: Velocity, Gravity
        - **Size**: Start/End sizes and variances
        - **Opacity**: Start/End opacity and variances
        - **Color**: Start/End colors and variances
        - **Advanced**: Alpha test, Transparency
    - Action buttons: Pause, Restart, Burst

### Canvas Features

-   **Orbit Controls**: Click and drag to rotate, scroll to zoom
-   **Grid Helper**: Visual reference grid
-   **Lighting**: Ambient + directional lights
-   **Skybox**: Optional background (can reuse existing skybox system)
-   **Target Object**: Centered at origin, properly scaled
-   **Particles**: Rendered in real-time

### Styling

-   Match existing Project Home styling
-   Dark theme (`bg-[#0b0e12]`, `text-[#eaeaea]`)
-   Consistent with BlockToolsSidebar styling
-   Use Tailwind CSS classes
-   Smooth animations for expand/collapse

---

## Technical Implementation Details

### 1. ParticleEmitterCore Port

**File**: `src/js/particles/ParticleEmitterCore.ts`

**Key Adaptations**:

-   Remove `Game` dependency
-   Replace `CustomTextureManager` with `THREE.TextureLoader`
-   Simplify texture loading to return `THREE.Texture | null`
-   Keep all shader code unchanged
-   Keep InstancedMesh logic unchanged
-   Keep update loop logic unchanged

**Texture Loading**:

```typescript
private async _loadTexture(textureUri: string): Promise<THREE.Texture | null> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      textureUri,
      (texture) => resolve(texture),
      undefined,
      (error) => {
        console.error('Failed to load texture:', textureUri, error);
        resolve(null); // Return null instead of rejecting
      }
    );
  });
}
```

### 2. ParticleEmitter Wrapper

**File**: `src/js/particles/ParticleEmitter.ts`

**Simplified Version**:

```typescript
export default class ParticleEmitter {
    private _emitterCore: ParticleEmitterCore;
    private _position: Vector3 = new Vector3();
    private _offset: Vector3 = new Vector3();
    private _textureWrapper: THREE.Texture | null = null;
    private _attachedToObject: THREE.Object3D | null = null;

    constructor(options: ParticleEmitterOptions) {
        this._emitterCore = new ParticleEmitterCore(
            options.emitterCoreOptions || {}
        );
        // ... setup
    }

    public update(deltaTimeS: number): void {
        this._updatePosition();
        this._emitterCore.update(deltaTimeS);
    }

    public attachToObject(object: THREE.Object3D | null): void {
        this._attachedToObject = object;
    }

    // ... other methods
}
```

### 3. React Three Fiber Integration

**ParticleEmitterRenderer Component**:

```typescript
const ParticleEmitterRenderer = ({
    config,
    targetObjectRef,
    targetObjectType,
}) => {
    const emitterRef = useRef<ParticleEmitter | null>(null);
    const meshRef = useRef<THREE.InstancedMesh | null>(null);

    useEffect(() => {
        // Create emitter
        const emitter = new ParticleEmitter({
            id: config.id,
            textureUri: config.textureUri,
            emitterCoreOptions: {
                // ... map config to options
            },
        });

        emitterRef.current = emitter;
        meshRef.current = emitter.mesh;

        // Add to scene
        // (handled by React Three Fiber primitive)

        return () => {
            emitter.dispose();
        };
    }, [config.id]);

    useFrame((state, delta) => {
        if (emitterRef.current && !config.paused) {
            emitterRef.current.update(delta);
        }
    });

    useEffect(() => {
        // Update emitter when config changes
        if (emitterRef.current) {
            emitterRef.current.setEmitterCoreOptions({
                // ... updated options
            });
        }
    }, [config]);

    useEffect(() => {
        // Attach to target object
        if (
            emitterRef.current &&
            targetObjectRef?.current &&
            config.attachedToTarget
        ) {
            emitterRef.current.attachToObject(targetObjectRef.current);
        } else {
            emitterRef.current?.attachToObject(null);
        }
    }, [targetObjectRef, config.attachedToTarget]);

    if (!meshRef.current) return null;

    return <primitive object={meshRef.current} />;
};
```

### 4. Target Object Rendering

**Player Model**:

```typescript
const PlayerModel = () => {
    const { scene } = useGLTF("./assets/models/players/player.gltf");
    const modelRef = useRef<THREE.Group>(null);

    useEffect(() => {
        if (modelRef.current) {
            // Center and scale model
            const box = new THREE.Box3().setFromObject(modelRef.current);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = 1.0 / maxDim; // Normalize to unit size

            modelRef.current.position.set(
                -center.x * scale,
                -center.y * scale,
                -center.z * scale
            );
            modelRef.current.scale.set(scale, scale, scale);
        }
    }, [scene]);

    return <primitive object={scene.clone()} ref={modelRef} />;
};
```

**Simple Block**:

```typescript
const SimpleBlock = () => {
    return (
        <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#888888" />
        </mesh>
    );
};
```

### 5. Texture Upload/Selection

**Option 1: File Input**

-   Allow users to upload texture files
-   Convert to data URI for storage
-   Use data URI as textureUri

**Option 2: Path Input**

-   Text input for texture path
-   Support relative paths like `./assets/particles/particle.png`
-   Default to `public/assets/particles/` folder
-   Validate path exists

**Option 3: Both**

-   File upload for custom textures
-   Path input for existing assets in `public/assets/particles/`
-   Browse/select from available particle textures

**Implementation**:

```typescript
const TextureSelector = ({ value, onChange }) => {
    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                onChange(event.target?.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    return (
        <div>
            <input type="file" accept="image/*" onChange={handleFileUpload} />
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="./assets/particles/particle.png"
            />
            {/* Optional: Browse button to list available textures */}
        </div>
    );
};
```

**Note**: Particle textures are stored in `public/assets/particles/` folder. The texture selector should default to this location and allow users to browse available textures.

### 6. Animation Loop

**In ParticleViewerCanvas**:

```typescript
useFrame((state, delta) => {
    // Update all particle emitters
    // (handled by individual ParticleEmitterRenderer components)
});
```

**In ParticleEmitterRenderer**:

```typescript
useFrame((state, delta) => {
    if (emitterRef.current && !config.paused) {
        emitterRef.current.update(delta);
    }
});
```

### 7. Camera Controls

**OrbitControls Setup**:

```typescript
import { OrbitControls } from "@react-three/drei";

<OrbitControls
    enableZoom={true}
    enablePan={true}
    minDistance={2}
    maxDistance={20}
    target={[0, 0, 0]}
    autoRotate={false}
/>;
```

**Initial Camera Position**:

```typescript
<Canvas camera={{ position: [3, 3, 3], fov: 75 }}>
```

---

## File Structure

```
src/js/
├── components/
│   └── ParticleViewerPage/
│       ├── index.tsx                    # Main ParticleViewerPage component
│       ├── ParticleViewerSidebar.tsx    # Left sidebar
│       ├── ParticleViewerCanvas.tsx     # Canvas container
│       ├── TargetObjectSelector.tsx     # Target object radio buttons
│       ├── ParticleEmitterList.tsx      # List of emitter cards
│       ├── ParticleEmitterCard.tsx      # Individual emitter card
│       ├── ParticleEmitterControls.tsx  # Emitter configuration form
│       ├── TargetObjectRenderer.tsx     # Renders player/block/none
│       └── ParticleEmitterRenderer.tsx   # Renders particle emitter
│
├── particles/
│   ├── ParticleEmitterCore.ts           # Ported from SDK (adapted)
│   ├── ParticleEmitter.ts               # Simplified wrapper
│   ├── ParticleEmitterConstants.ts     # Types and constants
│   └── types.ts                         # TypeScript interfaces
│
└── utils/
    └── particleUtils.ts                 # Helper functions
```

**CSS**:

```
src/css/
└── ParticleViewerPage.css               # Styles for particle viewer
```

**Assets**:

```
public/assets/
└── particles/                            # Particle texture assets
    └── [texture files: .png, .jpg, etc.]
```

**Note**: Particle textures should be placed in `public/assets/particles/` folder. The texture selector will default to this location.

---

## Implementation Phases

### Phase 1: Foundation (Week 1)

**Goals**: Set up basic structure and navigation

1. **Create ParticleViewerPage component**

    - Basic layout (sidebar + canvas)
    - Navigation back to Project Home
    - Hash-based routing integration

2. **Integrate with Project Home**

    - Add navigation item/button
    - Handle hash routing
    - Test navigation flow

3. **Set up React Three Fiber canvas**
    - Basic Canvas component
    - Camera and lighting setup
    - Grid helper
    - OrbitControls

**Deliverables**:

-   ParticleViewerPage renders
-   Navigation works
-   Empty canvas displays

### Phase 2: Target Objects (Week 1-2)

**Goals**: Render target objects in canvas

1. **Implement TargetObjectSelector**

    - Radio button UI
    - State management

2. **Implement TargetObjectRenderer**

    - Player model loading (GLTF)
    - Simple block rendering
    - Centering and scaling logic

3. **Test target object switching**
    - Verify all three options work
    - Ensure proper cleanup

**Deliverables**:

-   Target objects render correctly
-   Switching between objects works
-   Objects are properly centered

### Phase 3: Particle System Core (Week 2)

**Goals**: Port and adapt particle system

1. **Port ParticleEmitterCore**

    - Copy from SDK
    - Remove Game dependencies
    - Adapt texture loading
    - Test standalone

2. **Create ParticleEmitter wrapper**

    - Simplified version
    - Direct Three.js integration
    - Test basic emission

3. **Create ParticleEmitterRenderer**
    - React Three Fiber integration
    - useFrame hook for updates
    - Test single emitter

**Deliverables**:

-   Particle system works standalone
-   Single emitter renders particles
-   Particles animate correctly

### Phase 4: UI Controls (Week 3)

**Goals**: Build configuration UI

1. **Create ParticleEmitterCard**

    - List item UI
    - Expand/collapse
    - Delete button

2. **Create ParticleEmitterControls**

    - Form inputs for all properties
    - Organized into sections
    - Real-time updates

3. **Implement emitter management**
    - Create new emitter
    - Delete emitter
    - Update emitter config
    - Pause/restart controls

**Deliverables**:

-   Full UI for configuring emitters
-   Multiple emitters can be created
-   Changes reflect in real-time

### Phase 5: Advanced Features (Week 3-4)

**Goals**: Polish and advanced functionality

1. **Texture upload/selection**

    - File upload
    - Path input
    - Texture preview

2. **Emitter attachment**

    - Attach to target object
    - Position offset
    - Test attachment logic

3. **Burst functionality**

    - Burst button
    - Burst count input
    - Test burst effect

4. **Performance optimization**
    - Memory cleanup
    - Efficient updates
    - Frame rate monitoring

**Deliverables**:

-   All features working
-   Performance is acceptable
-   No memory leaks

### Phase 6: Polish & Testing (Week 4)

**Goals**: Final polish and testing

1. **UI/UX improvements**

    - Styling consistency
    - Animations
    - Tooltips/help text

2. **Error handling**

    - Invalid texture paths
    - Missing models
    - Edge cases

3. **Documentation**

    - Code comments
    - User guide (optional)

4. **Testing**
    - Multiple emitters
    - Various configurations
    - Browser compatibility

**Deliverables**:

-   Polished UI
-   Robust error handling
-   Tested and working

---

## Open Questions & Considerations

### Questions for Clarification

1. **Texture Storage**

    - Should uploaded textures be saved to IndexedDB?
    - Or only stored in component state (lost on refresh)?
    - Should there be a texture library/preset system?

2. **Particle Presets**

    - Should there be preset particle configurations (smoke, fire, sparkles, etc.)?
    - Should users be able to save/load custom presets?

3. **Export Functionality** ⚠️ **DEFERRED**

    - **Current Status**: Export functionality is deferred for initial implementation
    - **Future Plans**:
        - Convert particle configurations to glTF format, OR
        - Export as SDK-compatible code for direct use in HYTOPIA SDK
    - Format: JSON matching SDK schema (`ParticleEmitterSchema`)
    - Implementation will be added in a future phase

4. **Player Model**

    - Is the player model path correct? (`./assets/models/player/player.gltf`)
    - Should we support other player models?
    - Should the player model be animated?

5. **Performance Limits**

    - Maximum number of emitters?
    - Maximum particles per emitter?
    - Should there be warnings/limits?

6. **Skybox**

    - Should skybox be configurable in the viewer?
    - Or use a default skybox?
    - Should it match the main editor's skybox system?

7. **Camera Presets**

    - Should there be camera preset positions (front, side, top)?
    - Or just free orbit controls?

8. **Undo/Redo**
    - Should particle configuration changes support undo/redo?
    - Or is it not necessary for a preview tool?

### Technical Considerations

1. **SDK Compatibility**

    - The particle viewer uses a simplified version of the SDK system
    - Ensure configurations can be easily transferred to actual SDK usage
    - **Future**: Export functionality will generate SDK-compatible code or glTF format
    - Configurations stored in component state match SDK's `ParticleEmitterCoreOptions` interface

2. **Memory Management**

    - Particle emitters create InstancedMesh objects
    - Ensure proper disposal on unmount
    - Monitor memory usage with multiple emitters

3. **Texture Loading**

    - Textures should be cached to avoid reloading
    - Handle loading errors gracefully
    - Support both relative paths and absolute URLs

4. **Performance Monitoring**

    - Consider adding FPS counter (optional)
    - Monitor particle count
    - Warn if performance degrades

5. **Browser Compatibility**
    - Ensure WebGL2 support (required for InstancedMesh)
    - Fallback for older browsers?
    - Test on different devices

### Future Enhancements (Out of Scope)

1. **Particle Library**

    - Pre-built particle effects
    - Community-shared presets

2. **Animation Timeline**

    - Keyframe-based animation
    - Timeline editor for particle properties

3. **Particle Preview Gallery**

    - Thumbnail gallery of effects
    - Quick preview mode

4. **Integration with Main Editor**

    - Export particle configs to projects (future)
    - Direct placement in world editor (future)
    - **Note**: Export functionality deferred - future plans include glTF conversion or SDK code generation

5. **Advanced Features**
    - Particle trails
    - Particle collisions
    - Custom shaders

---

## Conclusion

This implementation plan provides a comprehensive roadmap for building the Particle Viewer feature. The plan is structured in phases to allow for iterative development and testing.

**Key Notes**:

-   Particle textures are stored in `public/assets/particles/` folder
-   Export functionality is deferred for initial implementation
-   Future export plans: glTF conversion or SDK code generation
-   Key decisions about texture storage and presets should be clarified before implementation begins

The particle system will be closely aligned with the SDK's architecture, ensuring consistency and making it easy for users to transfer configurations between the viewer and actual game development.

---

## Appendix: Type Definitions

### Core Types

```typescript
// ParticleEmitterConfig (matches SDK options)
interface ParticleEmitterConfig {
    id: string;
    name?: string;
    textureUri: string;
    alphaTest?: number;
    colorStart?: RgbColor;
    colorEnd?: RgbColor;
    colorStartVariance?: RgbColor;
    colorEndVariance?: RgbColor;
    gravity?: Vector3Like;
    lifetime?: number;
    lifetimeVariance?: number;
    maxParticles?: number;
    opacityEnd?: number;
    opacityEndVariance?: number;
    opacityStart?: number;
    opacityStartVariance?: number;
    position?: Vector3Like;
    positionVariance?: Vector3Like;
    rate?: number;
    rateVariance?: number;
    sizeEnd?: number;
    sizeEndVariance?: number;
    sizeStart?: number;
    sizeStartVariance?: number;
    transparent?: boolean;
    velocity?: Vector3Like;
    velocityVariance?: Vector3Like;
    offset?: Vector3Like;
    attachedToTarget?: boolean;
    paused?: boolean;
    expanded?: boolean;
}

type RgbColor = { r: number; g: number; b: number };
type Vector3Like = { x: number; y: number; z: number };
type TargetObjectType = "player" | "block" | "none";
```

---

**Document Version**: 1.0  
**Last Updated**: [Current Date]  
**Author**: Implementation Plan
