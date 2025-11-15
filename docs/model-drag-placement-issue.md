# Model Drag Placement Issue - Implementation Plan

## Problem Statement
When clicking and dragging, models are being placed automatically during drag, which shouldn't happen. Models should be placed one at a time by default. Blocks can be placed during drag (which is desired), but models should not.

## Current Understanding

### Placement Flow
1. **Mouse Down**: `handleTerrainMouseDown()` sets `isPlacingRef.current = true` and `isFirstBlockRef.current = true`
2. **Initial Placement**: Calls `handleBlockPlacement()` immediately on mouse down
3. **Mouse Move**: `updatePreviewPosition()` is called during mouse move
4. **Drag Placement**: If `isPlacingRef.current && !isToolActive && shouldUpdatePreview`, calls `handleBlockPlacement()` again

### Model Placement Logic
In `handleBlockPlacement()`:
```javascript
if (
    currentBlockTypeRef.current?.isEnvironment &&
    placedEnvironmentCountRef.current < 1
) {
    if (isFirstBlockRef.current) {
        // Place model
        placeEnvironmentModel(...)
        placedEnvironmentCountRef.current += result.length;
    }
}
```

### Block Placement Logic
For blocks (non-environment), placement happens regardless of `isFirstBlockRef.current`:
```javascript
if (modeRef.current === "add" && !currentBlockTypeRef?.current?.isEnvironment) {
    // Place blocks during drag
    // ...
}
isFirstBlockRef.current = false; // Set to false after block placement
```

### The Problem
The condition `placedEnvironmentCountRef.current < 1` should prevent multiple model placements, but:
1. `isFirstBlockRef.current` is checked, but it might be getting reset incorrectly
2. `placedEnvironmentCountRef.current` might be getting reset during drag
3. The condition might not be evaluated correctly during drag

### Current Guard Logic
- `isFirstBlockRef.current`: Set to `true` on mouse down, set to `false` after block placement (line 1170)
- `placedEnvironmentCountRef.current`: Set to `0` on mouse down, incremented when model is placed
- Condition: `isEnvironment && placedEnvironmentCountRef.current < 1 && isFirstBlockRef.current`

## Logging Added

### In `handleBlockPlacement()`:
- Log when model placement is attempted
- Log all relevant state: `isEnvironment`, `placedEnvironmentCountRef`, `isFirstBlockRef`, `isPlacingRef`, `modeRef`
- Log whether placement proceeds or is blocked
- Log result of `placeEnvironmentModel()` call
- Log updates to `placedEnvironmentCountRef`

### In `updatePreviewPosition()`:
- Log when `handleBlockPlacement()` is called during drag
- Log context: `isPlacing`, `isToolActive`, `shouldUpdatePreview`, `isFirstBlock`, `placedEnvironmentCount`, `currentBlockType`, `isEnvironment`

### In `handleTerrainMouseDown()`:
- Log state reset: `isFirstBlock`, `placedEnvironmentCount`, `currentBlockType`, `isEnvironment`

## Investigation Steps

1. **Reproduce the issue** with logging enabled
2. **Check console logs** for:
   - When `handleBlockPlacement()` is called during drag
   - What `isFirstBlockRef.current` value is during drag
   - What `placedEnvironmentCountRef.current` value is during drag
   - Whether the condition is evaluated correctly

3. **Trace the flow**:
   - Mouse down -> initial placement
   - Mouse move -> drag placement attempts
   - When is `isFirstBlockRef.current` set to false?
   - When is `placedEnvironmentCountRef.current` incremented?

4. **Identify the bug**:
   - Is `isFirstBlockRef.current` being reset incorrectly?
   - Is `placedEnvironmentCountRef.current` being reset?
   - Is the condition logic wrong?
   - Is there a race condition?

## Potential Solutions

### Solution 1: Strengthen the Guard Condition
Add an explicit check to prevent model placement during drag:
```javascript
if (
    currentBlockTypeRef.current?.isEnvironment &&
    placedEnvironmentCountRef.current < 1 &&
    isFirstBlockRef.current // Already checked, but ensure it's working
) {
    // Only place on first click, not during drag
    if (isFirstBlockRef.current) {
        // Place model
    }
}
```

### Solution 2: Separate Model Placement Logic
Don't call `handleBlockPlacement()` for models during drag at all:
```javascript
if (isPlacingRef.current && !isToolActive && shouldUpdatePreview) {
    // Only call handleBlockPlacement for blocks, not models
    if (!currentBlockTypeRef.current?.isEnvironment) {
        handleBlockPlacement();
    }
}
```

### Solution 3: Add a Model-Specific Flag
Add a flag to track if a model was already placed in this drag session:
```javascript
const modelPlacedThisDragRef = useRef(false);

// On mouse down:
modelPlacedThisDragRef.current = false;

// In handleBlockPlacement:
if (currentBlockTypeRef.current?.isEnvironment) {
    if (!modelPlacedThisDragRef.current && isFirstBlockRef.current) {
        // Place model
        modelPlacedThisDragRef.current = true;
    }
}
```

### Solution 4: Check Placement Mode
Add a setting to control whether models can be placed during drag:
- Add `allowDragPlacement` to model placement settings
- Check this setting before placing during drag
- Default to `false` for models

### Solution 5: Fix the Root Cause
If `isFirstBlockRef.current` is being set to `false` incorrectly:
- Ensure it's only set to `false` after block placement, not model placement
- Or set it to `false` immediately after model placement

## Recommended Solution

**Solution 2 + Solution 4**: 
1. Don't call `handleBlockPlacement()` for models during drag (Solution 2)
2. Add a UI option to enable drag placement for models if desired (Solution 4)

This ensures:
- Models are placed one at a time by default
- Users can opt-in to drag placement if they want it
- Clear separation between block and model placement behavior

## Implementation Details

### Step 1: Prevent Model Placement During Drag
Modify `updatePreviewPosition()` to skip `handleBlockPlacement()` for models:
```javascript
if (isPlacingRef.current && !isToolActive && shouldUpdatePreview) {
    // Don't place models during drag - only blocks
    if (!currentBlockTypeRef.current?.isEnvironment) {
        handleBlockPlacement();
    }
}
```

### Step 2: Add UI Toggle (Optional)
Add a toggle in the model options sidebar:
- "Allow Drag Placement" checkbox
- Default: unchecked (false)
- When enabled, models can be placed during drag like blocks

### Step 3: Update Placement Logic
If drag placement is enabled for models:
```javascript
const allowDragPlacement = placementSettingsRef.current?.allowDragPlacement ?? false;

if (isPlacingRef.current && !isToolActive && shouldUpdatePreview) {
    if (!currentBlockTypeRef.current?.isEnvironment || allowDragPlacement) {
        handleBlockPlacement();
    }
}
```

## Testing Plan

1. **Test Case 1**: Click and drag with model selected
   - Expected: Only one model placed on initial click
   - Verify: No models placed during drag

2. **Test Case 2**: Click and drag with block selected
   - Expected: Blocks placed continuously during drag
   - Verify: Blocks still work as before

3. **Test Case 3**: Click model, release, click model again
   - Expected: Each click places one model
   - Verify: Multiple models can be placed individually

4. **Test Case 4**: (If drag placement option added) Enable drag placement, click and drag with model
   - Expected: Models placed continuously during drag
   - Verify: Drag placement works when enabled

## Findings Log

### [Date] Initial Investigation
- Added extensive logging to track placement flow
- Need to reproduce issue and analyze logs
- Suspect `isFirstBlockRef.current` might be getting reset incorrectly

### [Date] Root Cause Identified
**Issue Found**: `placeEnvironmentModel()` returns a Promise but was not being awaited in `handleBlockPlacement()`.

**Symptoms from logs**:
- `placeEnvironmentModel result: Promise {<pending>}`
- `Result length: undefined`
- `placedEnvironmentCountRef.current` stays at 0
- `isFirstBlockRef.current` stays true
- `handleBlockPlacement()` called repeatedly during drag, each time thinking it's the first placement

**Root Cause**:
1. `placeEnvironmentModel()` is async and returns a Promise
2. Code checks `result?.length` immediately without awaiting
3. `placedEnvironmentCountRef.current` never increments because promise hasn't resolved
4. `isFirstBlockRef.current` stays true, allowing repeated placement attempts during drag

**Fix Applied**:
1. Added `await` to `placeEnvironmentModel()` call
2. Set `isFirstBlockRef.current = false` immediately after successful model placement
3. Prevented `handleBlockPlacement()` from being called for models during drag in `updatePreviewPosition()`

**Result**: Models now placed one at a time on click, not during drag.

### [Date] [Add findings here as you investigate]

