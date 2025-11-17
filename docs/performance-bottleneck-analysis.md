# Performance Bottleneck Analysis

Based on actual loading logs from an empty world, here are the identified bottlenecks:

## Implementation Status

**Last Updated:** Based on code verification (2024)

### ✅ Implemented Optimizations

1. **Lazy texture loading** - ✅ IMPLEMENTED

    - Textures only load for blocks actually present in terrain
    - Uses `onlyEssential: true` flag in `preload()` calls
    - Essential block types are marked based on terrain content

2. **Skip preload for empty worlds** - ✅ IMPLEMENTED

    - Empty worlds (`terrainBlockCount === 0`) skip texture preload entirely
    - Implemented in `TerrainBuilder.tsx` lines 1910-1924
    - Saves ~18 seconds for empty worlds

3. **On-demand texture loading** - ✅ IMPLEMENTED
    - Textures load when blocks are placed (`preloadBlockTypeTextures()`)
    - Used by ReplaceTool and block placement handlers

### ⚠️ Still Needs Verification/Optimization

1. **Parallel texture loading** - Textures still load sequentially via `Promise.all()`
2. **Database query optimization** - Empty DB queries still take 6+ seconds
3. **Chunk system optimization** - Empty terrain still triggers chunk updates

---

## Critical Bottlenecks (Ranked by Impact)

### 1. **BlockTypeRegistry.preload: 18,766ms (69.3%)** 🟢 OPTIMIZED (for empty worlds)

**Current Status:**

-   ✅ **Empty worlds:** Preload is skipped entirely (saves ~18 seconds)
-   ✅ **Non-empty worlds:** Only textures for blocks in terrain are loaded
-   ⚠️ **Parallel loading:** Still loads textures sequentially (could be improved)

**Previous behavior (from logs):**

-   Loading textures for 167 block types sequentially
-   Took ~18.7 seconds even for an empty world
-   All textures loaded regardless of usage

**Evidence from logs (historical):**

```
[PERF] ⏱️  START: BlockTypeRegistry.preload | Time: 7158.80ms
[PERF] 📍 CHECKPOINT: Starting texture preload {"blockTypesToPreload":167}
[PERF] ✅ END: BlockTypeRegistry.preload {"preloadedCount":167} | Duration: 18766.00ms
```

**Current implementation:**

-   Empty worlds: Preload skipped (`TerrainBuilder.tsx:1910-1924`)
-   Non-empty worlds: Only essential block types preloaded (`onlyEssential: true`)
-   Essential block types marked from terrain content (`TerrainBuilder.tsx:1899-1908`)

**Remaining optimization opportunities:**

1. **Parallel loading** - Load multiple textures concurrently instead of sequentially
2. **Progressive loading** - Load visible chunks first, defer others
3. **Texture caching** - Better cache invalidation and reuse

**Potential additional savings:** 2-5 seconds (for worlds with data, via parallel loading)

---

### 2. **EnvironmentBuilder.preloadModels: 18,823ms (69.5%)** 🔴 CRITICAL

**What's happening:**

-   Environment model preloading takes ~18.8 seconds
-   Most of this time is actually waiting for BlockTypeRegistry.preload (they run in parallel)
-   But there's also a significant delay in refreshing environment from DB

**Evidence from logs:**

```
[PERF] ⏱️  START: EnvironmentBuilder.preloadModels | Time: 7135.20ms
[PERF] ⏱️  START: Refresh Environment from DB | Time: 19305.60ms
[PERF] ✅ END: Refresh Environment from DB | Duration: 6653.00ms
[PERF] ✅ END: EnvironmentBuilder.preloadModels | Duration: 18823.50ms
```

**Root cause:**

-   Environment refresh waits ~12 seconds before starting (likely blocked by BlockTypeRegistry)
-   Then takes 6.6 seconds to read from DB (even for empty data!)

**Optimization opportunities:**

1. **Fix DB read performance** - 6.6 seconds for empty data is excessive
2. **Parallelize with block loading** - Don't wait for block textures to complete
3. **Early DB read** - Read environment data earlier in the process

**Potential savings:** 6-12 seconds (if DB read is optimized)

---

### 3. **DatabaseManager.getData(environment): 6,652ms (24.6%)** 🟠 HIGH

**What's happening:**

-   Reading environment data from IndexedDB takes 6.6 seconds
-   This is for an EMPTY world (0 items)
-   Should be nearly instantaneous

**Evidence from logs:**

```
[PERF] ⏱️  START: DatabaseManager.getData(environment) | Time: 19305.80ms
[PERF] ✅ END: DatabaseManager.getData(environment) {"itemCount":0} | Duration: 6652.40ms
```

**Root cause:**

-   IndexedDB cursor operations are slow even for empty queries
-   Likely waiting for transaction/connection overhead
-   May be scanning through project-prefixed keys inefficiently

**Optimization opportunities:**

1. **Optimize empty query path** - Fast-path for empty results
2. **Cache connection** - Reuse DB connection more efficiently
3. **Batch queries** - Combine multiple DB reads
4. **Index optimization** - Ensure proper indexes on project-prefixed keys

**Potential savings:** 5-6 seconds (90%+ reduction for empty data)

---

### 4. **updateTerrainChunks: 2,102ms** 🟡 MEDIUM

**What's happening:**

-   Chunk system update takes 2.1 seconds
-   This happens even for empty terrain

**Evidence from logs:**

```
[PERF] ⏱️  START: updateTerrainChunks {"blockCount":0,"onlyVisibleChunks":true}
[PERF] ✅ END: updateTerrainChunks {"totalBlocks":0} | Duration: 2102.50ms
```

**Root cause:**

-   Chunk system initialization overhead
-   Spatial hash updates even for empty data
-   Render queue processing overhead

**Optimization opportunities:**

1. **Skip for empty terrain** - Fast-path when blockCount is 0
2. **Defer spatial hash** - Don't update spatial hash for empty worlds
3. **Optimize chunk manager** - Reduce initialization overhead

**Potential savings:** 1-2 seconds

---

## Summary Statistics

### Historical Performance (Before Optimizations)

**Total loading time:** ~27 seconds for an empty world

**Breakdown:**

-   Block texture loading: 18.8s (69%)
-   Environment DB read: 6.7s (25%)
-   Chunk system update: 2.1s (8%)
-   Other operations: <1s (3%)

### Current Performance (After Texture Optimization)

**Estimated total loading time:** ~9 seconds for an empty world (66% reduction)

**Breakdown (estimated):**

-   Block texture loading: 0s (0%) ✅ **OPTIMIZED** - Skipped for empty worlds
-   Environment DB read: 6.7s (74%) ⚠️ **Still needs optimization**
-   Chunk system update: 2.1s (23%) ⚠️ **Still needs optimization**
-   Other operations: <1s (3%)

**Note:** Actual performance should be verified with new performance logs. The texture preload optimization should save ~18 seconds for empty worlds.

## Recommended Optimization Priority

### Phase 1: Quick Wins (High Impact, Low Effort) ✅ PARTIALLY COMPLETE

1. ✅ **Skip texture preload for empty worlds** - ✅ IMPLEMENTED - Save ~18 seconds
2. ⚠️ **Fast-path empty DB queries** - ⚠️ NEEDS VERIFICATION - Save ~6 seconds
3. ⚠️ **Skip chunk updates for empty terrain** - ⚠️ NEEDS VERIFICATION - Save ~2 seconds

**Status:** Empty world texture preload optimization is complete. DB and chunk optimizations need verification.

**Total potential savings:** ~26 seconds (96% reduction for empty worlds) - **~18 seconds achieved**

### Phase 2: Architecture Improvements (High Impact, Medium Effort) ✅ PARTIALLY COMPLETE

1. ✅ **Lazy texture loading** - ✅ IMPLEMENTED - Only load textures for blocks in use
2. ⚠️ **Parallel texture loading** - ⚠️ NOT IMPLEMENTED - Load multiple textures concurrently
3. ⚠️ **Optimize IndexedDB queries** - ⚠️ NEEDS INVESTIGATION - Better indexing and query patterns

**Status:** Lazy loading is implemented. Parallel loading and DB optimization still needed.

**Total potential savings:** Additional 5-10 seconds for worlds with data - **Partially achieved**

### Phase 3: Advanced Optimizations (Medium Impact, High Effort) ⏳ NOT STARTED

1. **Progressive chunk loading** - Load chunks as camera approaches
2. **Web Workers for texture processing** - Offload to background thread
3. **Texture compression** - Reduce texture sizes

---

## Notes

-   The "App Component Initialization" time (25.9s) is misleading - it includes all nested operations
-   Most bottlenecks are sequential when they could be parallel
-   Empty world performance is critical for first-time user experience
-   ~~Current implementation loads everything upfront, even when not needed~~ ✅ **FIXED:** Empty worlds now skip texture preload
-   **Current state:** Lazy loading is implemented - textures only load for blocks in terrain
-   **Verification needed:** Performance logs should be re-run to confirm current behavior matches expectations
-   **Code locations:**
-   Empty world skip: `src/js/TerrainBuilder.tsx:1910-1924`
-   Essential block marking: `src/js/TerrainBuilder.tsx:1899-1908`
-   Lazy preload: `src/js/blocks/BlockTypeRegistry.js:325-357`
-   On-demand loading: `src/js/blocks/BlockTypeRegistry.js:371-395`
