# Loading Process Breakdown

This document provides a comprehensive analysis of everything involved in loading the canvas, assets, and initializing the world editor application.

## Table of Contents

1. [Application Entry Point](#application-entry-point)
2. [Project Selection Phase](#project-selection-phase)
3. [Canvas Initialization](#canvas-initialization)
4. [Database Initialization](#database-initialization)
5. [Block System Initialization](#block-system-initialization)
6. [Texture Atlas System](#texture-atlas-system)
7. [Chunk System Initialization](#chunk-system-initialization)
8. [Terrain Loading](#terrain-loading)
9. [Environment Models Loading](#environment-models-loading)
10. [UI Components Loading](#ui-components-loading)
11. [Performance Bottlenecks](#performance-bottlenecks)

---

## Application Entry Point

### Files Involved

-   `src/index.tsx` - React root initialization
-   `src/App.tsx` - Main application component
-   `public/index.html` - HTML template

### Process Flow

1. **React DOM Mount** (`src/index.tsx`)

    - Creates React root
    - Renders `<App />` component in StrictMode
    - Minimal overhead, typically < 10ms

2. **App Component Initialization** (`src/App.tsx`)

    - Initializes state variables (projectId, mode, block types, etc.)
    - Sets up GPU detection and context attributes
    - Loads block types from `BlockTypesManager`
    - Initializes `LoadingManager` singleton
    - **Time Estimate**: 50-100ms

3. **BlockTypesManager Initial Load** (`src/js/managers/BlockTypesManager.js`)
    - Synchronously scans `public/assets/blocks` directory using `require.context`
    - Processes all `.png` and `.jpg` files
    - Builds block type array with IDs and texture paths
    - Loads `block-manifest.json` for stable ID assignments
    - **Time Estimate**: 100-300ms (depends on number of block textures)
    - **Block Count**: ~238 block texture files discovered

---

## Project Selection Phase

### Files Involved

-   `src/js/components/ProjectHome.tsx`
-   `src/js/managers/DatabaseManager.tsx`

### Process Flow

1. **ProjectHome Component**

    - Displays project selection UI
    - Loads project list from IndexedDB
    - User selects or creates a project
    - Sets `projectId` state in App component

2. **Database Connection** (`DatabaseManager.openDB()`)
    - Opens IndexedDB connection (`hytopia-world-editor-db-v{version}`)
    - Creates object stores if needed:
        - `terrain`
        - `environment`
        - `environment-icons`
        - `settings`
        - `custom-blocks`
        - `custom-models`
        - `undo-states`
        - `redo-states`
        - `ai-schematics`
        - `environment-model-settings`
        - `projects`
    - Runs migration checks for legacy data
    - **Time Estimate**: 50-200ms (first time slower due to schema creation)

---

## Canvas Initialization

### Files Involved

-   `src/App.tsx` (Canvas component)
-   `src/js/TerrainBuilder.js`
-   `src/js/EnvironmentBuilder.tsx`
-   `src/js/Camera.tsx`

### Process Flow

1. **React Three Fiber Canvas Setup** (`src/App.tsx:887-930`)

    - Creates Three.js WebGL context with optimized attributes
    - Initializes camera (fov: 75, near: 0.1, far: 1000)
    - Enables shadows
    - **Time Estimate**: 100-200ms

2. **TerrainBuilder Component Mount** (`src/js/TerrainBuilder.js`)

    - Sets up refs and state
    - Initializes camera manager
    - Creates scene reference
    - Sets up orbit controls
    - **Time Estimate**: 50-100ms

3. **EnvironmentBuilder Component Mount** (`src/js/EnvironmentBuilder.tsx`)

    - Initializes GLTFLoader
    - Sets up instanced mesh maps
    - Prepares distance culling system
    - **Time Estimate**: 50-100ms

4. **Camera Initialization** (`src/js/Camera.tsx`)

    - Binds camera to orbit controls
    - Restores saved camera state from localStorage (if exists)
    - Sets up pointer lock handlers
    - **Time Estimate**: 20-50ms

5. **Skybox Loading** (`src/js/TerrainBuilder.js:1795-1807`)
    - Loads default skybox: `./assets/skyboxes/partly-cloudy/`
    - Loads 6 cube map textures: `+x.png`, `-x.png`, `+y.png`, `-y.png`, `+z.png`, `-z.png`
    - Sets scene background
    - **Time Estimate**: 200-500ms (network dependent)
    - **Asset Size**: ~6 textures × ~500KB each = ~3MB

---

## Database Initialization

### Files Involved

-   `src/js/managers/DatabaseManager.tsx`

### Process Flow

1. **IndexedDB Connection**

    - Already opened during project selection
    - Connection reused throughout app lifecycle

2. **Project Data Loading** (triggered when `projectId` is set)
    - Loads custom blocks: `DatabaseManager.getData(STORES.CUSTOM_BLOCKS, "blocks")`
    - Loads terrain data: `DatabaseManager.getData(STORES.TERRAIN, "current")`
    - Loads environment data: `DatabaseManager.getData(STORES.ENVIRONMENT, "current")`
    - Loads settings: skybox, lighting, camera sensitivity, etc.
    - **Time Estimate**: 100-2000ms (depends on project size)
    - **Terrain Data**: Can be very large (millions of blocks)

---

## Block System Initialization

### Files Involved

-   `src/js/blocks/BlockTypeRegistry.js`
-   `src/js/blocks/BlockTextureAtlas.js`
-   `src/js/blocks/BlockMaterial.js`
-   `src/js/blocks/BlockType.js`

### Process Flow

1. **BlockTypeRegistry.initialize()** (`src/js/blocks/BlockTypeRegistry.js:72-113`)

    - Marks error texture as essential
    - Loads error texture: `./assets/blocks/error.png`
    - Iterates through all block types from `BlockTypesManager`
    - Creates `BlockType` instances for each block
    - Processes texture URIs (single or multi-texture)
    - **Time Estimate**: 50-150ms (synchronous processing)

2. **BlockTypeRegistry.preload()** (`src/js/blocks/BlockTypeRegistry.js:338-361`)

    - Marks all block types as essential
    - Filters block types that need texture preloading
    - Calls `preloadTextures()` on each block type
    - **Time Estimate**: 500-2000ms (depends on number of blocks)
    - **Blocks Processed**: All blocks in the registry

3. **BlockType.preloadTextures()** (`src/js/blocks/BlockType.js:260-307`)

    - For each face texture URI:
        - Handles data URIs (custom blocks)
        - Handles file paths (asset blocks)
        - Calls `BlockTextureAtlas.instance.loadTexture()`
    - **Time Estimate**: Varies per block (1-10ms per texture)

4. **BlockTextureAtlas Initialization** (`src/js/blocks/BlockTextureAtlas.js:25-54`)

    - Creates canvas element (512×512 initially)
    - Creates THREE.CanvasTexture from canvas
    - Sets up texture metadata map
    - Initializes texture load queue
    - **Time Estimate**: < 10ms

5. **Texture Loading** (`src/js/blocks/BlockTextureAtlas.js:240-284`)

    - Normalizes texture paths
    - Checks if texture already loaded
    - Handles single texture files vs multi-sided blocks
    - Loads image via `Image` object or fetch
    - Adds to texture atlas canvas
    - Updates UV coordinates
    - **Time Estimate**: 10-50ms per texture (network dependent)
    - **Total Textures**: ~238+ block textures + custom block textures

6. **Texture Atlas Rebuild** (`src/js/blocks/BlockTextureAtlas.js:rebuildTextureAtlas()`)
    - Calculates optimal canvas size based on loaded textures
    - Resizes canvas if needed
    - Redraws all textures onto canvas
    - Updates THREE.CanvasTexture
    - **Time Estimate**: 200-1000ms (depends on texture count)
    - **Canvas Size**: Grows dynamically (512×512 → 2048×2048 → 4096×4096)

---

## Chunk System Initialization

### Files Involved

-   `src/js/chunks/ChunkSystem.tsx`
-   `src/js/chunks/ChunkManager.tsx`
-   `src/js/chunks/TerrainBuilderIntegration.js`

### Process Flow

1. **initChunkSystem()** (`src/js/chunks/TerrainBuilderIntegration.js:15-47`)

    - Creates new `ChunkSystem` instance
    - Calls `chunkSystem.initialize()`

2. **ChunkSystem.initialize()** (`src/js/chunks/ChunkSystem.tsx:37-48`)

    - Calls `BlockTypeRegistry.instance.initialize()`
    - Calls `BlockTypeRegistry.instance.preload()`
    - Sets view distance (default: 128 blocks)
    - Enables view distance culling
    - **Time Estimate**: 500-2500ms (includes block registry preload)

3. **Texture Verification** (`src/js/chunks/TerrainBuilderIntegration.js:23-40`)

    - Verifies texture atlas is loaded (3 attempts with delays)
    - Rebuilds atlas if needed
    - Refreshes chunk materials
    - Processes render queue
    - **Time Estimate**: 1000-3000ms (with retries)

4. **ChunkManager Setup** (`src/js/chunks/ChunkManager.tsx`)
    - Initializes chunk storage map
    - Sets up render queue
    - Configures mesh manager
    - **Time Estimate**: 50-100ms

---

## Terrain Loading

### Files Involved

-   `src/js/TerrainBuilder.js`
-   `src/js/chunks/TerrainBuilderIntegration.js`
-   `src/js/managers/DatabaseManager.tsx`

### Process Flow

1. **Load Custom Blocks** (`src/js/TerrainBuilder.js:1840-1851`)

    - Fetches custom blocks from IndexedDB
    - Processes each custom block via `processCustomBlock()`
    - Dispatches `custom-blocks-loaded` event
    - **Time Estimate**: 50-200ms

2. **Load Terrain Data** (`src/js/TerrainBuilder.js:1853-1965`)

    - Fetches terrain data from IndexedDB
    - Data format: `{ "x,y,z": blockId }`
    - Can contain millions of entries
    - **Time Estimate**: 500-5000ms (depends on world size)
    - **Data Size**: Can be 10-100MB+ for large worlds

3. **Mark Essential Block Types** (`src/js/TerrainBuilder.js:1877-1892`)

    - Iterates through all block IDs in terrain
    - Marks each block type as essential
    - **Time Estimate**: 10-100ms (depends on unique block count)

4. **Preload Block Textures** (`src/js/TerrainBuilder.js:1897-1898`)

    - Calls `BlockTypeRegistry.instance.preload()`
    - Preloads textures for all blocks used in terrain
    - **Time Estimate**: 1000-5000ms (depends on unique block types)

5. **Rebuild Texture Atlas** (`src/js/TerrainBuilder.js:1899`)

    - Rebuilds atlas with all essential textures
    - **Time Estimate**: 500-2000ms

6. **Update Terrain Chunks** (`src/js/TerrainBuilder.js:1920-1928`)

    - Calls `updateTerrainChunks()` with terrain data
    - Converts terrain data to chunk format
    - Processes chunks in render queue
    - **Time Estimate**: 2000-10000ms (depends on chunk count)
    - **Chunk Processing**: Each chunk requires geometry generation

7. **Spatial Hash Update** (`src/js/chunks/TerrainBuilderIntegration.js:125-174`)

    - Updates spatial grid for raycasting
    - Runs in worker thread (if available)
    - **Time Estimate**: 500-2000ms

8. **Chunk Render Queue Processing** (`src/js/chunks/TerrainBuilderIntegration.js:176-188`)
    - Processes chunks in priority order (closest first)
    - Generates meshes for visible chunks
    - **Time Estimate**: Ongoing (spread over multiple frames)

---

## Environment Models Loading

### Files Involved

-   `src/js/EnvironmentBuilder.tsx`
-   `src/js/managers/DatabaseManager.tsx`

### Process Flow

1. **Model Manifest Loading** (`src/js/EnvironmentBuilder.tsx:17-57`)

    - Synchronously fetches `assets/models/environment/mattifest.json`
    - Parses JSON to get list of model files
    - Creates model metadata objects (ID, name, URL, category)
    - **Time Estimate**: 50-200ms (network dependent)
    - **Model Count**: ~915 GLTF files

2. **Preload Models** (`src/js/EnvironmentBuilder.tsx:486-575`)

    - Loads custom models from IndexedDB
    - Loads collider settings
    - Iterates through all environment models
    - Calls `loadModel()` for each model
    - Sets up instanced meshes
    - **Time Estimate**: 5000-30000ms (depends on model count)
    - **Model Loading**: Each GLTF file requires:
        - Network fetch (50-500ms per model)
        - GLTF parsing (10-100ms per model)
        - Geometry processing (10-50ms per model)
        - Texture loading (if embedded, 50-200ms per model)

3. **Load Model Function** (`src/js/EnvironmentBuilder.tsx`)

    - Uses GLTFLoader to load `.gltf` file
    - Processes scene graph
    - Extracts meshes and materials
    - Caches loaded model
    - **Time Estimate**: 50-500ms per model

4. **Setup Instanced Mesh** (`src/js/EnvironmentBuilder.tsx:576-680`)

    - Creates THREE.InstancedMesh for each model type
    - Sets up material and geometry
    - Configures instance count
    - **Time Estimate**: 10-50ms per model type

5. **Load Environment Data** (`src/js/EnvironmentBuilder.tsx:refreshEnvironmentFromDB()`)
    - Fetches environment objects from IndexedDB
    - Creates instances for each object
    - Applies transforms (position, rotation, scale)
    - **Time Estimate**: 500-5000ms (depends on object count)

---

## UI Components Loading

### Files Involved

-   `src/js/components/BlockToolsSidebar.tsx`
-   `src/js/components/BlockToolOptions.tsx`
-   `src/js/components/ToolBar.tsx`
-   `src/js/components/GlobalLoadingScreen.tsx`
-   Various other UI components

### Process Flow

1. **Component Mounting** (React lifecycle)

    - All UI components mount when `projectId` is set
    - Components initialize their state
    - **Time Estimate**: 50-200ms total

2. **Block Tools Sidebar** (`src/js/components/BlockToolsSidebar.tsx`)

    - Renders block type list
    - Loads block thumbnails/previews
    - Sets up search/filter functionality
    - **Time Estimate**: 100-500ms

3. **Global Loading Screen** (`src/js/components/GlobalLoadingScreen.tsx`)
    - Subscribes to LoadingManager
    - Displays loading messages
    - Shows progress indicators
    - **Time Estimate**: < 10ms

---

## Performance Bottlenecks

### Critical Path Items

1. **Block Texture Loading** ⚠️ HIGH IMPACT

    - **Issue**: All block textures loaded synchronously
    - **Impact**: 500-2000ms delay
    - **Optimization**: Lazy load non-essential textures

2. **Terrain Data Loading** ⚠️ HIGH IMPACT

    - **Issue**: Large IndexedDB reads (10-100MB+)
    - **Impact**: 500-5000ms delay
    - **Optimization**: Stream loading, compression

3. **Chunk System Initialization** ⚠️ HIGH IMPACT

    - **Issue**: Block registry preload happens during chunk init
    - **Impact**: 500-2500ms delay
    - **Optimization**: Parallelize initialization

4. **Environment Model Loading** ⚠️ VERY HIGH IMPACT

    - **Issue**: ~915 GLTF models loaded sequentially for thumbnails/previews
    - **Impact**: 5000-30000ms delay
    - **Current Behavior**: Models loaded during `preloadModels()` to generate instanced meshes
    - **Optimization**: Pre-generate thumbnails at build time, lazy load actual models
    - **Potential Savings**: 5000-30000ms (eliminate thumbnail generation from critical path)

5. **Texture Atlas Rebuild** ⚠️ MEDIUM IMPACT

    - **Issue**: Canvas redraws all textures
    - **Impact**: 200-1000ms delay
    - **Optimization**: Incremental updates, WebGL texture arrays

6. **Chunk Mesh Generation** ⚠️ HIGH IMPACT
    - **Issue**: Geometry generation for all chunks
    - **Impact**: 2000-10000ms delay
    - **Optimization**: Worker threads, progressive loading

### Sequential Operations

Many operations run sequentially when they could be parallelized:

1. Block registry init → Block preload → Atlas rebuild → Chunk init
2. Terrain load → Texture preload → Chunk update
3. Model manifest → Model loading → Instance setup

### Network Bottlenecks

-   Skybox textures: 6 × ~500KB = ~3MB
-   Block textures: ~238 × ~50KB = ~12MB
-   Environment models: ~915 × ~100KB = ~91MB (worst case)

### Database Bottlenecks

-   Terrain data: Can be 10-100MB+ for large worlds
-   Environment data: Can be 1-10MB+ for many objects
-   Custom blocks: Usually < 1MB

---

## Total Loading Time Estimate

### Best Case Scenario (Small World, Fast Network)

-   Application init: 200ms
-   Database init: 100ms
-   Canvas setup: 200ms
-   Block system: 1000ms
-   Chunk system: 1500ms
-   Terrain load: 1000ms
-   Environment load: 2000ms
-   **Total: ~6 seconds**

### Typical Scenario (Medium World, Average Network)

-   Application init: 300ms
-   Database init: 200ms
-   Canvas setup: 300ms
-   Block system: 2000ms
-   Chunk system: 3000ms
-   Terrain load: 3000ms
-   Environment load: 10000ms
-   **Total: ~18 seconds**

### Worst Case Scenario (Large World, Slow Network)

-   Application init: 500ms
-   Database init: 500ms
-   Canvas setup: 500ms
-   Block system: 5000ms
-   Chunk system: 5000ms
-   Terrain load: 10000ms
-   Environment load: 30000ms
-   **Total: ~55 seconds**

---

## Recommendations for Optimization

1. **Lazy Loading**

    - Load only visible chunks initially
    - Load environment models on-demand
    - Defer non-essential texture loading

2. **Parallelization**

    - Initialize systems in parallel where possible
    - Use Web Workers for chunk generation
    - Batch database operations

3. **Progressive Loading**

    - Show terrain in stages (near → far)
    - Load models as camera approaches
    - Stream large terrain data

4. **Caching**

    - Cache texture atlas in IndexedDB
    - Cache parsed GLTF models
    - Use service workers for asset caching

5. **Compression**

    - Compress terrain data (e.g., run-length encoding)
    - Use texture compression formats
    - Compress GLTF files

6. **Code Splitting**

    - Lazy load UI components
    - Split chunk system into separate bundle
    - Dynamic imports for tools

7. **Pre-Generate Thumbnails** ⭐ HIGH PRIORITY

    - **Current Issue**: Environment models are loaded during initialization to generate thumbnails/previews for the UI
    - **Solution**: Generate thumbnails at build time using Puppeteer (similar to asset-viewer project)
    - **Implementation**:
        - Create build script to generate thumbnails for all environment models
        - Store thumbnails in `public/assets/models/environment/thumbnails/`
        - Update `EnvironmentBuilder` to load pre-generated thumbnails instead of loading full models
        - Load actual GLTF models only when needed (on placement or preview)
    - **Benefits**:
        - Eliminates 5-30 seconds from initial load time
        - Reduces network traffic (thumbnails ~10-50KB vs models ~100KB+)
        - Faster UI rendering (no need to wait for model parsing)
        - Better user experience (instant thumbnail display)
    - **Scripts Reference**: See `asset-viewer/scripts/generate-thumbnails.ts` for implementation pattern

8. **Asset Optimization**

    - Reduce texture sizes where possible
    - Optimize GLTF models
    - Use texture atlases for models

9. **Database Optimization**
    - Index terrain data by chunk
    - Use cursors for large reads
    - Implement pagination for large datasets

---

## Pre-Generated Thumbnails Implementation Guide

### Overview

The world-editor currently loads all ~915 environment GLTF models during initialization to generate thumbnails for the UI. This is a major bottleneck (5-30 seconds). By pre-generating thumbnails at build time, we can eliminate this from the critical loading path.

### Current Flow

1. `EnvironmentBuilder.tsx` calls `preloadModels()` on mount
2. For each model in `environmentModels` array:
    - Loads full GLTF file via `GLTFLoader`
    - Parses geometry and materials
    - Creates instanced mesh
    - Generates thumbnail/preview (if needed)
3. All models loaded before UI can display thumbnails

### Proposed Flow

1. **Build Time**:

    - Run thumbnail generation script (similar to `asset-viewer/scripts/generate-thumbnails.ts`)
    - Generate 256×256 PNG thumbnails for all environment models
    - Store in `public/assets/models/environment/thumbnails/{category}/{model-name}.png`
    - Update model manifest to include thumbnail paths

2. **Runtime**:
    - Load thumbnail paths from manifest (instant)
    - Display thumbnails in UI immediately
    - Load actual GLTF models lazily:
        - When user selects a model for placement
        - When camera approaches existing instances
        - On-demand basis

### Implementation Steps

1. **Create Build Script** (`scripts/generate-model-thumbnails.ts`):

    ```typescript
    // Adapt from asset-viewer/scripts/generate-thumbnails.ts
    // - Read model manifest (mattifest.json)
    // - Use Puppeteer to render each model
    // - Generate 256×256 PNG thumbnails
    // - Save to public/assets/models/environment/thumbnails/
    ```

2. **Update Model Manifest**:

    - Add `thumbnail` field to each model entry
    - Path format: `thumbnails/{category}/{model-name}.png`

3. **Modify EnvironmentBuilder**:

    - Remove model loading from `preloadModels()`
    - Load thumbnails from manifest instead
    - Implement lazy loading for actual models:
        ```typescript
        const loadModelOnDemand = async (modelUrl: string) => {
            if (!loadedModels.current.has(modelUrl)) {
                const gltf = await loadModel(modelUrl);
                setupInstancedMesh(model, gltf);
            }
        };
        ```

4. **Update UI Components**:
    - Use thumbnail images instead of loading models for previews
    - Load full model only when user clicks/selects

### Expected Performance Impact

-   **Before**: 5-30 seconds loading all models
-   **After**: < 100ms loading thumbnail paths
-   **Savings**: 5-30 seconds eliminated from critical path
-   **Additional Benefit**: Models only loaded when actually needed (further reduces memory usage)

### File Structure

```
public/assets/models/environment/
├── mattifest.json (updated with thumbnail paths)
├── thumbnails/
│   ├── environment/
│   │   ├── tree-01.png
│   │   ├── tree-02.png
│   │   └── ...
│   ├── structures/
│   │   └── ...
│   └── ...
└── [actual GLTF files]
```

### Build Integration

Add to `package.json`:

```json
{
    "scripts": {
        "build:thumbnails": "bun run scripts/generate-model-thumbnails.ts",
        "build": "bun run build:thumbnails && [existing build steps]"
    }
}
```

### Notes

-   Thumbnails should be generated once at build time
-   Thumbnails can be cached/committed to repository
-   Regenerate thumbnails when models are updated
-   Consider using WebP format for smaller file sizes
-   Thumbnail generation can be parallelized (batch processing)
