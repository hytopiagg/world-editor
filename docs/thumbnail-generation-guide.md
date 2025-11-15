# Thumbnail Generation Guide

This guide explains how to generate thumbnails for environment models to improve loading performance.

## Overview

The world-editor loads ~915 environment GLTF models during initialization, which takes 5-30 seconds. By pre-generating thumbnails at build time, we can eliminate this bottleneck and reduce initial load time significantly.

## Quick Start

### 1. Install Dependencies

First, install Puppeteer (required for thumbnail generation):

```bash
npm install
```

Puppeteer is already added to `devDependencies` in `package.json`.

### 2. Generate Thumbnails

Run the thumbnail generation script:

```bash
npm run build:thumbnails
```

This will:
- Generate 256×256 PNG thumbnails for all environment models
- Store them in `public/assets/models/environment/thumbnails/`
- Update the manifest file with thumbnail paths

### 3. Verify Generation

Check that thumbnails were created:

```bash
ls -la public/assets/models/environment/thumbnails/
```

You should see thumbnails organized by category (City, Desert, etc.).

## How It Works

### Scripts

1. **`scripts/generate-model-thumbnails.js`**
   - Uses Puppeteer to render each GLTF model
   - Generates 256×256 PNG screenshots
   - Processes models in parallel batches (6 at a time)
   - Skips existing thumbnails automatically

2. **`scripts/generate-model-manifest.js`** (updated)
   - Generates model manifest with thumbnail paths
   - Falls back to simple array format if thumbnails don't exist
   - Automatically detects and includes thumbnail paths when available

### Manifest Format

**Before thumbnails** (simple array):
```json
[
  "City/barrel-wood-1.gltf",
  "City/barrel-wood-2.gltf",
  ...
]
```

**After thumbnails** (enhanced format):
```json
[
  {
    "path": "City/barrel-wood-1.gltf",
    "thumbnail": "thumbnails/City/barrel-wood-1.png"
  },
  {
    "path": "City/barrel-wood-2.gltf",
    "thumbnail": "thumbnails/City/barrel-wood-2.png"
  },
  ...
]
```

## Usage

### Generate All Thumbnails

```bash
npm run build:thumbnails
```

### Skip Existing Thumbnails

The script automatically skips thumbnails that already exist. To force regeneration, delete the thumbnails directory first:

```bash
rm -rf public/assets/models/environment/thumbnails
npm run build:thumbnails
```

### Environment Variable

Skip thumbnail generation entirely:

```bash
SKIP_THUMBNAILS=true npm run build:thumbnails
```

## Performance Impact

- **Before**: 5-30 seconds loading all models during initialization
- **After**: < 100ms loading thumbnail paths from manifest
- **Savings**: 5-30 seconds eliminated from critical loading path

## File Structure

```
public/assets/models/environment/
├── mattifest.json (updated with thumbnail paths)
├── thumbnails/
│   ├── City/
│   │   ├── barrel-wood-1.png
│   │   ├── barrel-wood-2.png
│   │   └── ...
│   ├── Desert/
│   │   └── ...
│   └── ...
└── [actual GLTF files]
```

## Next Steps

After generating thumbnails, you'll need to update `EnvironmentBuilder.tsx` to:

1. Load thumbnail paths from the manifest instead of loading full models
2. Display thumbnails in the UI immediately
3. Load actual GLTF models lazily (on-demand when needed)

See `docs/loading-process-breakdown.md` for detailed implementation guidance.

## Troubleshooting

### Puppeteer Installation Issues

If Puppeteer fails to install, try:

```bash
npm install puppeteer --save-dev
```

### Port Already in Use

If port 3001 is already in use, the script will automatically find the next available port.

### Model Loading Errors

If some models fail to generate thumbnails:
- Check console output for specific error messages
- Verify GLTF files are valid
- Ensure models are accessible from the local server

### Thumbnails Not Showing

- Verify thumbnails were generated successfully
- Check that manifest was updated with thumbnail paths
- Ensure thumbnail paths are correct relative to `public/assets/models/environment/`

## Notes

- Thumbnails are generated once at build time
- Thumbnails can be committed to the repository
- Regenerate thumbnails when models are updated
- Thumbnail generation can take 10-30 minutes for all ~915 models
- Consider running thumbnail generation in CI/CD pipeline

