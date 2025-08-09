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

### Pre-build Scripts
- Model manifest generation runs automatically before build/start via `prebuild` and `prestart` scripts
- `node scripts/generate-model-manifest.js` - Manually generate model manifest

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
- Automatic save system with manual save option (Ctrl+S)
- Undo/redo system with 30+ state history

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
- Custom blocks use IDs > 100 to avoid conflicts with built-in blocks
- Camera controls are disabled while Cmd/Ctrl is pressed (for shortcuts)
- The app includes an under-construction mode toggle in Constants.tsx

## Testing

- Basic CRA test setup (`bun test`)
- Some Playwright test configurations exist in `test-results/`
- No comprehensive test suite - add tests when making significant changes

## Deployment

The project is deployed to https://build.hytopia.com when changes are merged. All accepted pull requests are automatically deployed for community use.