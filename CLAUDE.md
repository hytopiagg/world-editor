# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the HYTOPIA World Editor, a 3D voxel building tool similar to Minecraft's creative mode. The application is built with React 18, TypeScript, and Three.js (via React Three Fiber) to create an immersive 3D world-building experience.

## Common Development Commands

### Development and Testing
- `bun start` or `bun dev` - Start development server (runs prebuild script first)
- `bun test` - Run unit tests without watch mode (Jest/React Testing Library)
- `bun run test:e2e` - Run end-to-end tests with Playwright
- `bun run test:e2e:ui` - Run E2E tests with Playwright UI mode
- `bun run test:e2e:headed` - Run E2E tests in headed mode (visible browser)
- `bun run test:all` - Run both unit and E2E tests
- `bun run build` - Build for production (runs prebuild script first)
- `node scripts/generate-model-manifest.js` - Generate model manifest (runs automatically before start/build)

### Package Manager
The project uses **Bun** as the package manager (not npm/yarn). Always use `bun install`, `bun add`, etc.

## Code Architecture

### Core Application Structure
- **App.tsx** - Main application component managing global state, UI layout, and component orchestration
- **TerrainBuilder.js** - Core 3D terrain/voxel building engine using Three.js
- **EnvironmentBuilder.tsx** - Manages 3D environment objects and models

### Key Systems

#### Tool System (`src/js/tools/`)
- **ToolManager.tsx** - Coordinates all editor tools, handles activation/deactivation
- **BaseTool.tsx** - Abstract base class for all tools
- Individual tool implementations: `GroundTool`, `WallTool`, `ReplaceTool`, `SelectionTool`
- Tools handle mouse/keyboard input and provide specific building functionality

#### Block and Material Management (`src/js/blocks/`)
- **BlockType.js** - Core block type definitions
- **BlockTypesManager.js** - Manages block types including custom blocks
- **BlockTextureAtlas.js** - Handles texture atlasing for performance
- **BlockMaterial.tsx** - Three.js material management for blocks

#### Chunk System (`src/js/chunks/`)
- **ChunkManager.js** - Manages world chunks for performance
- **ChunkSystem.tsx** - Core chunk-based world rendering
- **SpatialHashGrid.js** - Spatial partitioning for efficient queries

#### Database and Persistence (`src/js/managers/`)
- **DatabaseManager.tsx** - IndexedDB wrapper for persistent storage
- **UndoRedoManager.tsx** - Handles undo/redo functionality
- Uses IndexedDB stores: TERRAIN, CUSTOM_BLOCKS, SETTINGS, UNDO, REDO

#### UI Components (`src/js/components/`)
- **BlockToolsSidebar.js** - Main sidebar with block/model selection
- **BlockToolOptions.tsx** - Options panel for selected tools
- **ToolBar.tsx** - Main toolbar with editor actions
- **AIAssistantPanel.tsx** - AI-powered building assistance

### Data Flow Patterns
1. **Tool Activation**: User selects tool → ToolManager activates → Tool handles input events
2. **Block Placement**: Input → Tool logic → TerrainBuilder updates → Database persistence
3. **State Management**: Uses React state + refs, with IndexedDB for persistence
4. **3D Rendering**: React Three Fiber manages Three.js scene graph

### Key Integrations
- **Minecraft Import**: Convert Minecraft worlds to HYTOPIA format (`src/js/utils/minecraft/`)
- **AI Features**: Texture generation and structure building assistance
- **Performance Optimization**: Object pooling, chunk-based rendering, GPU detection

### Testing Architecture
- **Unit Tests**: Located in `src/__tests__/` using Jest and React Testing Library
  - Core functionality tests: `CoreFunctionality.test.js`, `WorldEditorIntegration.test.js`
  - Component tests: `CollapsibleSection.test.tsx`, `UndoRedoManager.test.tsx`
  - Utility tests: `placementUtils.test.js`, `TerrainMouseUtils.test.js`, `blobUtils.test.ts`
  - Block placement and collision detection: `BlockPlacement.test.js`
- **E2E Tests**: Located in `e2e/` using Playwright
  - Tests run against real browser instances with full 3D rendering
  - Configured for Chrome, Firefox, and Safari testing
  - Includes tests for basic functionality, block placement, and selection
  - Extended timeouts (60s) for 3D app initialization

### File Organization
- **src/js/** - Main TypeScript/JavaScript logic
- **src/css/** - Component-specific CSS files
- **public/assets/** - Static assets (textures, models, sounds)
- **scripts/** - Build and utility scripts

## Development Notes

### Custom Block System
Custom blocks are stored in IndexedDB and include texture data as data URLs. The system supports both single-texture and multi-face texture blocks.

### Performance Considerations
- Uses object pooling for frequently created objects
- Chunk-based world rendering for large worlds
- GPU detection to optimize rendering settings
- Spatial hash grids for efficient collision detection

### Minecraft Integration
The system can import Minecraft worlds through NBT parsing and block mapping. Conversion maintains world structure while mapping to HYTOPIA's block system.

### AI Features
- Texture generation using AI models
- Structure building assistance
- Block and entity recommendations

## Development Guidelines

### Component Development
- Prefer editing existing components over creating new ones
- Follow existing patterns for Three.js integration via React Three Fiber
- Use existing UI components from the Adobe React Spectrum library when available

### Database Operations
- All database operations must use the DatabaseManager for consistency
- IndexedDB stores: TERRAIN, CUSTOM_BLOCKS, SETTINGS, UNDO, REDO
- Custom blocks include texture data as data URLs

### Testing Requirements
- Run unit tests (`bun test`) for logic and component changes
- Run E2E tests (`bun run test:e2e`) for UI and interaction changes
- E2E tests require the dev server to be running (handled automatically)
- Use extended timeouts for 3D rendering operations

### Performance Guidelines
- Leverage existing object pooling for frequently created objects
- Use chunk-based rendering patterns for world data
- Implement spatial hash grids for efficient collision detection
- Consider GPU detection for rendering optimizations