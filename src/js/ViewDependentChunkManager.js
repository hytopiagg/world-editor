import * as THREE from 'three';

/**
 * ViewDependentChunkManager
 * 
 * Intelligently prioritizes chunk loading based on camera view direction
 * and distance, ensuring chunks in the player's field of view load first.
 */
export class ViewDependentChunkManager {
  constructor(chunkSize = 32, far = 256) {
    this.chunkSize = chunkSize;
    this.far = far; // Maximum view distance
    this.frustum = new THREE.Frustum();
    this.projScreenMatrix = new THREE.Matrix4();
    this.cameraDirection = new THREE.Vector3();
    this.tempVector = new THREE.Vector3();
    this.tempMatrix = new THREE.Matrix4();
    this.chunkCenter = new THREE.Vector3();
    this.priorities = new Map(); // Cache for chunk priorities
    
    // Configuration 
    this.directionWeight = 1.5;   // How much to prioritize chunks in view direction (higher = more viewDir influence)
    this.distanceWeight = 1000;   // Base weight for distance calculation
    this.distanceOffset = 10;     // Prevents division by zero and tweaks distance curve
    this.frustumBonus = 1.5;      // Bonus for chunks actually in the camera frustum
    this.behindPenalty = 0.5;     // Multiplier for chunks behind the camera
  }

  /**
   * Update the frustum and camera information
   */
  updateCamera(camera) {
    // Extract camera direction
    this.cameraDirection.set(0, 0, -1).applyQuaternion(camera.quaternion);
    
    // Update frustum for visibility checking
    this.projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix, 
      camera.matrixWorldInverse
    );
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);
    
    // Clear cached priorities
    this.priorities.clear();
  }

  /**
   * Calculate the priority for a chunk based on its position relative to the camera
   */
  getChunkPriority(chunkX, chunkY, chunkZ, cameraPosition) {
    const chunkKey = `${chunkX},${chunkY},${chunkZ}`;
    
    // Check if we've already calculated this priority
    if (this.priorities.has(chunkKey)) {
      return this.priorities.get(chunkKey);
    }
    
    // Calculate chunk center position
    this.chunkCenter.set(
      (chunkX + 0.5) * this.chunkSize,
      (chunkY + 0.5) * this.chunkSize,
      (chunkZ + 0.5) * this.chunkSize
    );
    
    // Vector from camera to chunk center
    this.tempVector.copy(this.chunkCenter).sub(cameraPosition);
    
    // Distance to chunk
    const distance = this.tempVector.length();
    
    // If chunk is too far, give it very low priority
    if (distance > this.far) {
      const priority = 0.1;
      this.priorities.set(chunkKey, priority);
      return priority;
    }
    
    // Normalize the direction vector
    this.tempVector.normalize();
    
    // Dot product between camera direction and chunk direction
    // 1 = directly in front, 0 = perpendicular, -1 = directly behind
    const dot = this.tempVector.dot(this.cameraDirection);
    
    // Check if chunk is in view frustum
    const inFrustum = this.frustum.containsPoint(this.chunkCenter);
    
    // Base priority calculation
    // Higher dot = more in front of camera, which gets higher priority
    // 1/distance gives higher priority to closer chunks
    let priority;
    
    if (dot < -0.2) {
      // Chunk is behind the camera (facing away), give it lower priority
      priority = (dot + 1) * this.behindPenalty * (this.distanceWeight / (distance + this.distanceOffset));
    } else {
      // Chunk is in front of camera, apply normal priority calculation
      // Map dot from -1,1 to 0,2 and apply direction weight
      priority = (dot + 1) * this.directionWeight * (this.distanceWeight / (distance + this.distanceOffset));
      
      // Bonus for chunks that are actually in the frustum
      if (inFrustum) {
        priority *= this.frustumBonus;
      }
    }
    
    // Cache the result
    this.priorities.set(chunkKey, priority);
    
    return priority;
  }

  /**
   * Sort chunks by priority
   */
  sortChunksByPriority(chunks, cameraPosition) {
    return chunks.sort((a, b) => {
      const [ax, ay, az] = a.split(',').map(Number);
      const [bx, by, bz] = b.split(',').map(Number);
      
      const priorityA = this.getChunkPriority(ax, ay, az, cameraPosition);
      const priorityB = this.getChunkPriority(bx, by, bz, cameraPosition);
      
      return priorityB - priorityA; // Higher priority first
    });
  }
  
  /**
   * Get chunks to load in priority order
   */
  getPrioritizedChunks(allChunkKeys, cameraPosition, maxToLoad = 20) {
    // Get all chunks with their priorities
    const chunksWithPriority = allChunkKeys.map(chunkKey => {
      const [x, y, z] = chunkKey.split(',').map(Number);
      const priority = this.getChunkPriority(x, y, z, cameraPosition);
      return { chunkKey, priority };
    });
    
    // Sort by priority (highest first)
    chunksWithPriority.sort((a, b) => b.priority - a.priority);
    
    // Return top N chunks to load
    return chunksWithPriority.slice(0, maxToLoad);
  }
  
  /**
   * Debug helper - get color based on chunk priority
   */
  getPriorityDebugColor(priority) {
    // Generate a color from red (low priority) to green (high priority)
    const normalizedPriority = Math.min(1, Math.max(0, priority / 10));
    return new THREE.Color(
      1 - normalizedPriority, 
      normalizedPriority,
      0
    );
  }
} 