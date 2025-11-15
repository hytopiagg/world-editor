# Model Persistence Issue - Implementation Plan

## Problem Statement
When entering a pre-existing build and adding models, after saving and leaving and returning, those models don't show unless you go out of that build and come back in again.

## Current Understanding

### Save Flow
1. **Manual Save (Ctrl+S)**: `App.tsx` calls `environmentBuilderRef.current.updateLocalStorage()`
2. **Auto-save**: May also trigger `updateLocalStorage()` through various mechanisms
3. **updateLocalStorage()**: 
   - Iterates through `instancedMeshes.current` to collect all model instances
   - Serializes position, rotation, scale, modelUrl, name, instanceId
   - Calls `DatabaseManager.saveData(STORES.ENVIRONMENT, "current", allObjects)`
   - Saves to IndexedDB with project-prefixed keys

### Load Flow
1. **Project Entry**: When `projectId` changes or `scene` is ready, `useEffect` in `EnvironmentBuilder.tsx` calls `refreshEnvironmentFromDB()`
2. **refreshEnvironmentFromDB()**:
   - Retrieves data from IndexedDB via `DatabaseManager.getData(STORES.ENVIRONMENT, "current")`
   - Processes saved objects to find unique model URLs
   - Loads models via `ensureModelLoaded()`
   - Calls `updateEnvironmentToMatch(Object.values(savedEnv))`
   - Rebuilds visible instances

### Potential Issues

#### Issue 1: Timing/Race Condition
- `refreshEnvironmentFromDB()` might be called before models are preloaded
- Models might not be in `environmentModels` array when trying to match by name
- `updateEnvironmentToMatch()` might fail silently if models aren't loaded

#### Issue 2: Data Format Mismatch
- Saved data might be stored as object instead of array
- `Object.values(savedEnv)` might not work correctly if data structure is unexpected
- Instance IDs might not match between save and load

#### Issue 3: Model Matching
- Models matched by `name` or `modelUrl` - if name changes or modelUrl changes, matching fails
- Custom models might not be in `environmentModels` array when loading

#### Issue 4: Scene State
- Scene might not be fully initialized when `refreshEnvironmentFromDB()` is called
- `instancedMeshes.current` might not be set up correctly
- Models might be placed but not visible due to rendering issues

## Logging Added

### In `updateLocalStorage()`:
- Log projectId, total instances per model, total objects to save
- Log full array being saved
- Verify saved data after save completes
- Check data type and structure

### In `refreshEnvironmentFromDB()`:
- Log projectId, scene state, current memory state
- Log raw data from DB (type, structure, keys)
- Log each object being processed
- Log model loading results
- Log before/after counts in `updateEnvironmentToMatch()`
- Verify final object count matches expected

### In `updateEnvironmentToMatch()`:
- Log target state structure and count
- Log current vs target object counts
- Log each object being added/removed
- Log model loading status
- Log placement success/failure
- Log final verification count

## Investigation Steps

1. **Reproduce the issue** with logging enabled
2. **Check console logs** for:
   - What is saved when leaving the build
   - What is retrieved when returning
   - Whether models are found in `environmentModels`
   - Whether `updateEnvironmentToMatch()` is called
   - Whether objects are actually placed but not visible

3. **Verify data flow**:
   - Is `updateLocalStorage()` called when leaving?
   - Is `refreshEnvironmentFromDB()` called when returning?
   - What does the saved data look like?
   - What does the loaded data look like?

4. **Check model loading**:
   - Are models in `environmentModels` array?
   - Do model names/URLs match between save and load?
   - Are custom models included?

5. **Check rendering**:
   - Are objects in `instancedMeshes.current` after load?
   - Is `rebuildAllVisibleInstances()` called?
   - Are objects visible but not rendered?

## Potential Solutions

### Solution 1: Ensure Models are Preloaded Before Refresh
- Wait for `preloadModels()` to complete before calling `refreshEnvironmentFromDB()`
- Add a flag to track when models are ready
- Only refresh after models are confirmed loaded

### Solution 2: Fix Data Format Handling
- Ensure consistent array format when saving
- Handle both array and object formats when loading
- Normalize data structure before processing

### Solution 3: Improve Model Matching
- Store more metadata (model ID, checksum) for better matching
- Fallback to multiple matching strategies
- Handle custom models separately

### Solution 4: Fix Scene Initialization
- Ensure scene is fully ready before loading
- Initialize `instancedMeshes` before placing objects
- Force render after loading

### Solution 5: Add Retry Logic
- If objects don't appear, retry loading after a delay
- Check if models need to be reloaded
- Force a scene refresh

## Testing Plan

1. **Test Case 1**: Add models, save, leave, return immediately
   - Expected: Models should appear
   - Check logs for save/load flow

2. **Test Case 2**: Add models, save, close app, reopen
   - Expected: Models should appear
   - Check if data persists across sessions

3. **Test Case 3**: Add models, don't save, leave, return
   - Expected: Models should NOT appear
   - Verify unsaved changes aren't persisted

4. **Test Case 4**: Add models, save, add more models, save, leave, return
   - Expected: All models should appear
   - Verify incremental saves work

5. **Test Case 5**: Add custom models, save, leave, return
   - Expected: Custom models should appear
   - Verify custom model handling

## Findings Log

### [Date] Initial Investigation
- Added extensive logging to track save/load flow
- Need to reproduce issue and analyze logs

### [Date] Multiple Refresh Calls Issue Identified
**Issue Found**: `refreshEnvironmentFromDB()` is being called multiple times (4+ times) when entering a project.

**Symptoms from logs**:
- `refreshEnvironmentFromDB` called multiple times in quick succession
- First call successfully places all 7 models
- Subsequent calls see "Object already exists" for construction-barrier
- Final count shows 7 objects in memory (correct)
- But user reports only 6 models visible

**Root Cause**:
1. `useEffect` with dependencies `[projectId, scene]` fires multiple times
2. React Strict Mode or re-renders trigger multiple calls
3. Race condition: models placed but rendering not complete before next call
4. "Object already exists" check prevents re-placement, but model might not be visible

**Fix Applied**:
1. Added `refreshInProgressRef` guard to prevent concurrent calls
2. Enhanced logging to show model breakdown and visibility status
3. Added detailed logging for "already exists" case to check if object is actually visible

**Next Steps**:
- Test if guard prevents multiple calls
- Check if construction-barrier is in memory but not visible
- Verify `rebuildAllVisibleInstances` is working correctly
- Check if there's a rendering/visibility issue specific to construction-barrier

### [Date] Further Investigation - All Models in Memory but Not All Visible
**Findings from logs**:
- All 7 models successfully placed and in memory
- All 7 models marked as "1 instances, 1 visible"
- `refreshEnvironmentFromDB` still called 3 times (sequentially, not concurrently)
- Construction-barrier placed first, then skipped as "already exists" in subsequent calls
- User reports only 6 models visible despite all being marked visible

**Possible Issues**:
1. Multiple refresh calls might be interfering with rendering
2. Construction-barrier might be rendered but hidden/occluded
3. Rendering order issue - construction-barrier placed first might get overwritten
4. Matrix update issue - construction-barrier matrix might not be properly set

**Fixes Applied**:
1. Added `lastLoadedProjectIdRef` to prevent duplicate calls for same projectId
2. Enhanced "Existing object details" logging to show position, visibility, mesh count, and addedToScene status
3. This will help identify if construction-barrier is actually rendered but not visible

**Next Steps**:
- Check the "Existing object details" log for construction-barrier to see its state
- Verify if meshes are properly added to scene
- Check if there's a distance culling issue specific to construction-barrier

### [Date] Root Cause Found - Scene UUID Changing
**Critical Discovery**: The Scene UUID is changing between calls!

**Evidence from logs**:
- First call: `Scene UUID: adac6bd0-041a-4e57-8d1a-32e0149d7a3d`
- Third call: `Scene UUID: 5ac53a41-ac60-4575-b7fd-b9a86645416e`
- Different UUIDs = different scene objects = scene is being recreated

**Impact**:
- When scene changes, meshes are removed from old scene
- `instancedMeshes.current` still has model data, but instances are lost
- `ensureInstancedMeshesAdded` checks `addedToScene` flag and returns early
- Meshes never get added to new scene
- Instances exist in memory but aren't rendered

**Also Found**:
- `updateLocalStorage` saves 3 objects, but verification shows `[]` (empty)
- This suggests a race condition or the save is being overwritten

**Fixes Applied**:
1. Updated `ensureInstancedMeshesAdded` to check if meshes are actually in scene (not just flag)
2. Reset `addedToScene` flags when scene UUID changes
3. Updated guard to use scene UUID instead of scene object reference
4. Re-add meshes to new scene when scene changes

**Expected Result**: Models should persist across scene changes and be properly rendered.

### [Date] [Add findings here as you investigate]

