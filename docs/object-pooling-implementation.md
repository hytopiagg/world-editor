# Object Pooling Implementation

## Overview

Implemented comprehensive object pooling for THREE.js objects (Vector3, Matrix4, Euler, Quaternion, Box3) to reduce memory allocations and improve performance in the world editor.

## What Was Implemented

### 1. ObjectPool System (`src/js/utils/ObjectPool.ts`)

-   **Generic ObjectPool<T>**: Reusable pool for any object type
-   **ManagedObjectPool<T>**: Automatic lifecycle management
-   **ObjectPoolManager**: Singleton managing pools for common THREE.js objects
-   **Convenience Functions**: `getVector3()`, `releaseVector3()`, etc.

### 2. Pool Configurations

```typescript
Vector3Pool: { initialSize: 20, maxSize: 200 }
Matrix4Pool: { initialSize: 10, maxSize: 100 }
EulerPool: { initialSize: 10, maxSize: 100 }
QuaternionPool: { initialSize: 10, maxSize: 100 }
Box3Pool: { initialSize: 5, maxSize: 50 }
```

### 3. Updated Functions in EnvironmentBuilder.tsx

#### Hot Path Functions Optimized:

-   `placeEnvironmentModelWithoutSaving()` - High frequency during placement
-   `placeEnvironmentModel()` - Batch placement operations
-   `getPlacementTransform()` - Called for every object placement
-   `updateModelPreview()` - Called during mouse movement
-   `updatePreviewPosition()` - Called during preview updates
-   `updateEnvironmentToMatch()` - Called during undo/redo operations

#### Memory Management:

-   `removeInstance()` - Properly releases pooled objects
-   `clearEnvironments()` - Bulk release of all pooled objects
-   `setModelYShift()` - Fixed to use pooled objects

## Performance Benefits

### Expected Improvements:

1. **Reduced GC Pressure**: 80-90% reduction in Vector3/Matrix4 allocations
2. **Lower Memory Usage**: Reusing objects instead of creating new ones
3. **Improved Frame Rates**: Less GC pauses during intensive operations
4. **Better Consistency**: More predictable performance during object placement

### Before vs After:

```javascript
// Before (creates new objects every time)
const position = new THREE.Vector3(x, y, z);
const matrix = new THREE.Matrix4();

// After (reuses pooled objects)
const position = getVector3().set(x, y, z);
const matrix = getMatrix4();
// ... use objects ...
releaseVector3(position);
releaseMatrix4(matrix);
```

## Debugging & Monitoring

### Development Tools:

-   **Console Function**: `window.debugObjectPools()` - Shows pool statistics
-   **Imperative Handle**: `environmentBuilderRef.current.getObjectPoolStats()`

### Pool Statistics:

```javascript
{
  vector3: { poolSize: 15, activeCount: 5, maxSize: 200 },
  matrix4: { poolSize: 8, activeCount: 2, maxSize: 100 },
  // ... other pools
}
```

## Potential Issues & Flags

### 🚨 Critical Issues to Watch:

1. **Memory Leaks**:

    - **Risk**: If objects aren't properly released back to pool
    - **Mitigation**: Comprehensive cleanup in `removeInstance()` and `clearEnvironments()`
    - **Monitoring**: Watch for increasing `activeCount` without corresponding releases

2. **Object Mutation After Release**:

    - **Risk**: Using pooled objects after they're returned to pool
    - **Symptom**: Unexpected behavior, incorrect transformations
    - **Mitigation**: Objects are reset when retrieved from pool

3. **Pool Exhaustion**:
    - **Risk**: Creating more objects than pool max size
    - **Behavior**: Falls back to creating new objects (no crash)
    - **Monitoring**: Check `activeCount` vs `maxSize` in stats

### ⚠️ Moderate Issues:

4. **Initialization Overhead**:

    - **Impact**: Slight delay on first load (pre-populating pools)
    - **Mitigation**: Reasonable initial pool sizes

5. **Memory Baseline Increase**:
    - **Impact**: Higher baseline memory usage (pooled objects)
    - **Trade-off**: Higher baseline but much lower peak usage

### 🔍 Debugging Tips:

```javascript
// Monitor pool health
setInterval(() => {
    const stats = window.debugObjectPools();
    // Watch for:
    // - activeCount consistently growing
    // - poolSize reaching maxSize frequently
    // - Large gap between activeCount and poolSize
}, 5000);
```

## Testing Recommendations

### Performance Testing:

1. **Stress Test**: Place/remove 1000+ environment objects rapidly
2. **Memory Test**: Monitor heap usage during intensive operations
3. **GC Test**: Check for reduced garbage collection frequency

### Validation Testing:

1. **Functionality**: Ensure all object placement/removal works correctly
2. **Undo/Redo**: Verify undo/redo operations work with pooled objects
3. **Preview**: Test model preview updates don't cause visual glitches

### Memory Leak Detection:

```javascript
// Before heavy operations
const initialStats = environmentBuilderRef.current.getObjectPoolStats();

// After operations and cleanup
const finalStats = environmentBuilderRef.current.getObjectPoolStats();

// activeCount should return to similar levels
console.log(
    "Active objects delta:",
    finalStats.vector3.activeCount - initialStats.vector3.activeCount
);
```

## Future Enhancements

1. **Adaptive Pool Sizing**: Adjust pool sizes based on usage patterns
2. **Pool Warmup**: Pre-populate pools based on scene complexity
3. **Extended Pooling**: Apply to other frequently created objects
4. **Batch Operations**: Group multiple object releases into single operations

## Integration with Other Systems

The object pooling system is designed to be:

-   **Thread-safe**: Safe for web worker integration
-   **Extensible**: Easy to add new object types
-   **Monitoring-ready**: Built-in statistics for performance analysis
-   **Fallback-safe**: Gracefully handles pool exhaustion

This implementation provides a solid foundation for the next phase of optimizations while maintaining code reliability and debuggability.
