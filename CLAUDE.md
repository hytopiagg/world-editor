# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HYTOPIA World Editor is a 3D voxel building tool (similar to Minecraft's creative mode) built with React, TypeScript, and Three.js. It allows users to create immersive 3D worlds using voxel blocks, custom textures, and interactive elements. The application is deployed at https://build.hytopia.com.

## Development Commands

### Primary Commands
- `bun start` or `bun dev` - Start development server on http://localhost:3000
- `bun run build` - Build for production
- `bun test` - Run tests in watch mode
- `bun run eject` - Eject from Create React App (one-way operation)

### Electron Desktop App Commands
- `bun run electron:dev` - Start desktop app in development mode
- `bun run build:electron` - Build web bundle for Electron (with file:// safe paths)
- `bun run electron:dist` - Create desktop distributables (outputs to `dist/`)
- `bun run electron:dist:mac` / `:win` / `:linux` - Platform-specific builds

### Pre-build Scripts
- Model manifest generation runs automatically before build/start via `prebuild` and `prestart` scripts
- `node scripts/generate-model-manifest.js` - Manually generate model manifest
- `node scripts/update-block-manifest.js` - Update block manifest when adding new block textures
- `node scripts/generate-manifest-from-commit.js <commit-hash>` - Regenerate manifest from specific commit

### Package Manager
This project uses **Bun** as the package manager, not npm or yarn. Always use `bun` commands.

## Architecture Overview

### Core Components Structure

**Main App Flow (`src/App.tsx`)**
- Central state management for current block type, tools, and UI modes
- Integrates TerrainBuilder (voxel world) and EnvironmentBuilder (3D models)
- Handles save/load operations, custom texture generation, and AI features

**Terrain System (`src/js/chunks/`)**
- `ChunkManager.js` - Manages world chunks, visibility culling, and mesh rendering
- `Chunk.js` - Individual chunk data and mesh building
- `ChunkMeshManager.tsx` - Three.js mesh creation and optimization
- World is divided into 32x32x32 block chunks for performance

**Block System (`src/js/blocks/`)**
- `BlockTypeRegistry.js` - Central registry for all block types and custom textures
- `BlockType.js` - Individual block type definitions
- `BlockTextureAtlas.js` - Texture atlas management for efficient rendering
- Supports both built-in blocks and user-generated custom blocks

**Tools System (`src/js/tools/`)**
- `ToolManager.tsx` - Coordinates between different placement tools
- Individual tool files (`TerrainTool.tsx`, `SelectionTool.ts`, etc.)
- Each tool handles specific interaction patterns (single block, terrain gen, etc.)

**Persistence (`src/js/managers/DatabaseManager.tsx`)**
- IndexedDB-based storage for terrain data, custom blocks, and settings
- Multi-project support with project-scoped data isolation using key prefixes (`projectId::key`)
- Automatic database migration between versions with progress tracking
- Automatic save system with manual save option (Ctrl+S)
- Undo/redo system with 30+ state history (per-project stacks)
- Database stores: TERRAIN, ENVIRONMENT, SETTINGS, CUSTOM_BLOCKS, CUSTOM_MODELS, UNDO, REDO, SCHEMATICS, PROJECTS, ZONES, PROJECT_SETTINGS

### Key Architecture Patterns

**Component Communication:**
- Ref-based communication between major systems (TerrainBuilder, EnvironmentBuilder)
- Event-driven updates for block type changes and mesh rebuilding
- Central state in App.tsx with prop drilling to major components

**Performance Optimizations:**
- Chunk-based world rendering with view distance culling
- Texture atlas batching to reduce draw calls
- Object pooling for frequently created/destroyed objects
- Web Workers for heavy operations (Perlin noise, file parsing)

**Asset Management:**
- Static assets in `public/assets/` with organized structure
- Dynamic model manifest generation from filesystem
- Custom texture support with data URI encoding

### File Organization

- `src/components/` - React UI components
- `src/js/` - Core game logic (non-React)
- `src/css/` - Component-specific stylesheets
- `public/assets/` - Static game assets (models, textures, sounds)
- `scripts/` - Build and utility scripts

### Key Integration Points

**Three.js Integration:**
- React Three Fiber wrapper with custom terrain and environment builders
- Custom chunk-based mesh generation for performance
- Camera controls with pointer lock support

**External APIs:**
- Minecraft world conversion support (.mca file parsing)
- AI texture/structure generation capabilities
- File export/import for world sharing

## Important Development Notes

- This is a **Create React App** project with TypeScript
- Uses **Tailwind CSS** for styling
- **No existing linting/formatting** commands configured beyond CRA defaults
- The project has both `.js` and `.tsx` files - maintain existing patterns
- Custom blocks use IDs > 100 to avoid conflicts with built-in blocks (built-in blocks use stable IDs from manifest)
- Environment models use IDs starting at 200, custom models start at 5000+
- Camera controls are disabled while Cmd/Ctrl is pressed (for shortcuts)
- The app includes an under-construction mode toggle in [Constants.tsx](src/js/Constants.tsx)
- DB_VERSION in [Constants.tsx](src/js/Constants.tsx) controls database schema version

### Block Manifest System

The editor uses a block manifest system ([src/js/blocks/block-manifest.json](src/js/blocks/block-manifest.json)) to ensure stable block IDs across deployments:

- **Stable IDs**: Default blocks maintain their IDs even when new blocks are added
- **Adding new blocks**:
  1. Add block texture files to `public/assets/blocks/`
  2. Run `node scripts/update-block-manifest.js` to update the manifest
  3. Commit both the new block files and the updated manifest
- This prevents existing builds from breaking when new blocks are added

### Project System

- The app supports multiple projects with isolated data storage
- Project switching happens through [ProjectHome](src/js/components/ProjectHome.tsx) component
- Each project has its own terrain, environment, settings, and undo/redo stacks
- Project metadata is stored in the PROJECTS IndexedDB store

## Testing

- Basic CRA test setup (`bun test`)
- Some Playwright test configurations exist in `test-results/`
- No comprehensive test suite - add tests when making significant changes

## Deployment

The project is deployed to https://build.hytopia.com when changes are merged. All accepted pull requests are automatically deployed for community use.

### Desktop App (Electron)

The editor is also available as a desktop app powered by Electron:
- Entry point: `electron/main.js`
- Desktop build sets `PUBLIC_URL=./` for file:// compatibility
- Web Workers created via `new URL('...worker.js', import.meta.url)` work under Electron
- External links open in default browser from the Electron app
- macOS, Windows, and Linux builds available via electron-builder

### Bounty System

The project has a paid bounty system for bug fixes and feature additions:
- Browse available bounties: https://github.com/hytopiagg/world-editor/labels/BOUNTY
- Submit new issues/requests via GitHub Issues
- Accepted PRs receive bounty payments via PayPal
- Issue submitters receive 10% of bounty when their request becomes a bounty and is fulfilled