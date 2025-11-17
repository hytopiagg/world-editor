// @ts-nocheck - React Three Fiber JSX elements are extended globally
import React, { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import ParticleEmitter from '../../particles/ParticleEmitter';
import ParticleEmitterCore, { ParticleEmitterCoreOptions } from '../../particles/ParticleEmitterCore';
import type { ParticleEmitterConfig, TargetObjectType } from './index';

interface ParticleEmitterRendererProps {
  config: ParticleEmitterConfig;
  targetObject: TargetObjectType;
  targetObjectRef?: React.RefObject<THREE.Object3D>;
  boneMapRef?: React.RefObject<Map<string, THREE.Object3D>>;
}

export default function ParticleEmitterRenderer({
  config,
  targetObject,
  targetObjectRef,
  boneMapRef,
}: ParticleEmitterRendererProps) {
  const emitterRef = useRef<ParticleEmitter | null>(null);
  const { scene } = useThree();
  const lastTimeRef = useRef<number>(0);
  const lastAttachedObjectRef = useRef<THREE.Object3D | null>(null); // Track what we're currently attached to
  const lastAttachmentNodeRef = useRef<string | undefined>(undefined); // Track attachment node

  // Convert config to ParticleEmitterCoreOptions
  const coreOptions = useMemo<ParticleEmitterCoreOptions>(() => {
    const options: ParticleEmitterCoreOptions = {};

    if (config.alphaTest !== undefined) options.alphaTest = config.alphaTest;
    if (config.colorStart) {
      options.colorStart = new THREE.Color(
        config.colorStart.r,
        config.colorStart.g,
        config.colorStart.b
      );
    }
    if (config.colorEnd) {
      options.colorEnd = new THREE.Color(
        config.colorEnd.r,
        config.colorEnd.g,
        config.colorEnd.b
      );
    }
    if (config.colorStartVariance) {
      options.colorStartVariance = new THREE.Color(
        config.colorStartVariance.r,
        config.colorStartVariance.g,
        config.colorStartVariance.b
      );
    }
    if (config.colorEndVariance) {
      options.colorEndVariance = new THREE.Color(
        config.colorEndVariance.r,
        config.colorEndVariance.g,
        config.colorEndVariance.b
      );
    }
    if (config.gravity) {
      options.gravity = new THREE.Vector3(
        config.gravity.x,
        config.gravity.y,
        config.gravity.z
      );
    }
    if (config.lifetime !== undefined) options.lifetime = config.lifetime;
    if (config.lifetimeVariance !== undefined) options.lifetimeVariance = config.lifetimeVariance;
    if (config.maxParticles !== undefined) options.maxParticles = config.maxParticles;
    if (config.opacityEnd !== undefined) options.opacityEnd = config.opacityEnd;
    if (config.opacityEndVariance !== undefined) options.opacityEndVariance = config.opacityEndVariance;
    if (config.opacityStart !== undefined) options.opacityStart = config.opacityStart;
    if (config.opacityStartVariance !== undefined) options.opacityStartVariance = config.opacityStartVariance;
    if (config.position) {
      options.position = new THREE.Vector3(
        config.position.x,
        config.position.y,
        config.position.z
      );
    }
    if (config.positionVariance) {
      options.positionVariance = new THREE.Vector3(
        config.positionVariance.x,
        config.positionVariance.y,
        config.positionVariance.z
      );
    }
    if (config.rate !== undefined) options.rate = config.rate;
    if (config.rateVariance !== undefined) options.rateVariance = config.rateVariance;
    if (config.sizeEnd !== undefined) options.sizeEnd = config.sizeEnd;
    if (config.sizeEndVariance !== undefined) options.sizeEndVariance = config.sizeEndVariance;
    if (config.sizeStart !== undefined) options.sizeStart = config.sizeStart;
    if (config.sizeStartVariance !== undefined) options.sizeStartVariance = config.sizeStartVariance;
    if (config.transparent !== undefined) options.transparent = config.transparent;
    if (config.velocity) {
      options.velocity = new THREE.Vector3(
        config.velocity.x,
        config.velocity.y,
        config.velocity.z
      );
    }
    if (config.velocityVariance) {
      options.velocityVariance = new THREE.Vector3(
        config.velocityVariance.x,
        config.velocityVariance.y,
        config.velocityVariance.z
      );
    }

    return options;
  }, [config]);

  // Create emitter instance (only when ID changes, not texture)
  useEffect(() => {
    const emitter = new ParticleEmitter({
      id: config.id,
      textureUri: config.textureUri,
      emitterCoreOptions: coreOptions,
      position: config.position ? new THREE.Vector3(config.position.x, config.position.y, config.position.z) : undefined,
      offset: config.offset ? new THREE.Vector3(config.offset.x, config.offset.y, config.offset.z) : undefined,
    });

    emitterRef.current = emitter;
    scene.add(emitter.mesh);

    // Handle pause state
    if (config.paused) {
      emitter.pause();
    }

    // Reset attachment tracking when emitter is recreated
    lastAttachedObjectRef.current = null;
    lastAttachmentNodeRef.current = undefined;

    return () => {
      emitter.dispose();
      scene.remove(emitter.mesh);
    };
  }, [config.id, scene]); // Only recreate on id change, NOT texture change

  // Update emitter parameters when config changes
  useEffect(() => {
    if (!emitterRef.current) return;

    const emitter = emitterRef.current;
    const updates: Partial<ParticleEmitterCoreOptions> = {};

    // Update texture URI if changed (without recreating emitter)
    if (config.textureUri && emitterRef.current) {
      emitterRef.current.setTextureUri(config.textureUri);
      console.log(`[ParticleEmitter:${config.id}] Texture URI updated to: ${config.textureUri}`);
    }

    // Update all parameters that might have changed
    if (config.alphaTest !== undefined) updates.alphaTest = config.alphaTest;
    if (config.colorStart) {
      updates.colorStart = new THREE.Color(config.colorStart.r, config.colorStart.g, config.colorStart.b);
    }
    if (config.colorEnd) {
      updates.colorEnd = new THREE.Color(config.colorEnd.r, config.colorEnd.g, config.colorEnd.b);
    }
    if (config.gravity) {
      updates.gravity = new THREE.Vector3(config.gravity.x, config.gravity.y, config.gravity.z);
    }
    if (config.lifetime !== undefined) updates.lifetime = config.lifetime;
    if (config.rate !== undefined) updates.rate = config.rate;
    if (config.sizeStart !== undefined) updates.sizeStart = config.sizeStart;
    if (config.sizeEnd !== undefined) updates.sizeEnd = config.sizeEnd;
    if (config.transparent !== undefined) updates.transparent = config.transparent;
    if (config.velocity) {
      updates.velocity = new THREE.Vector3(config.velocity.x, config.velocity.y, config.velocity.z);
    }

    emitter.setEmitterCoreOptions(updates);

    // Update pause state
    if (config.paused) {
      emitter.pause();
    } else {
      emitter.restart();
    }

    // Update position/offset (only if not attached - attachment handles position)
    // Don't update position if attached, as it will be handled by attachment
    if (!config.attachedToTarget) {
      if (config.position) {
        emitter.setPosition(new THREE.Vector3(config.position.x, config.position.y, config.position.z));
      }
    }
    if (config.offset) {
      emitter.setOffset(new THREE.Vector3(config.offset.x, config.offset.y, config.offset.z));
    }
  }, [config]);

  // Attach to target object if needed
  useEffect(() => {
    if (!emitterRef.current) {
      console.log(`[ParticleEmitter:${config.id}] No emitter ref, skipping attachment`);
      return;
    }

    // Get current values from refs
    const currentTargetObject = targetObjectRef?.current;
    const currentBoneMap = boneMapRef?.current;

    // Check if attachment state has actually changed
    const attachmentNodeChanged = lastAttachmentNodeRef.current !== config.attachmentNode;
    const attachedToTargetChanged = (lastAttachedObjectRef.current === null) !== (!config.attachedToTarget);
    
    // Check if target object changed by comparing UUIDs (more reliable than object reference)
    const currentTargetUuid = currentTargetObject?.uuid;
    const lastAttachedUuid = lastAttachedObjectRef.current?.uuid;
    const targetObjectChanged = currentTargetUuid !== lastAttachedUuid;
    
    // Also check if we're attached to a bone and need to verify it's still valid
    let boneStillValid = true;
    if (config.attachmentNode && lastAttachedObjectRef.current && currentBoneMap) {
      const expectedBone = currentBoneMap.get(config.attachmentNode) || currentBoneMap.get(config.attachmentNode.toLowerCase());
      if (expectedBone && lastAttachedObjectRef.current.uuid !== expectedBone.uuid) {
        boneStillValid = false;
        console.log(`[ParticleEmitter:${config.id}] Bone UUID mismatch - need to re-attach`);
      }
    }

    // If we're already attached to the right object and config hasn't changed, don't re-attach
    if (!attachmentNodeChanged && !attachedToTargetChanged && !targetObjectChanged && boneStillValid &&
        config.attachedToTarget && lastAttachedObjectRef.current !== null) {
      console.log(`[ParticleEmitter:${config.id}] Attachment state unchanged, skipping re-attachment`, {
        lastAttachedUuid,
        currentTargetUuid,
        attachmentNode: config.attachmentNode,
        boneStillValid,
      });
      return;
    }

    console.log(`[ParticleEmitter:${config.id}] Attachment check:`, {
      attachedToTarget: config.attachedToTarget,
      attachmentNode: config.attachmentNode,
      targetObject: targetObject,
      hasTargetObjectRef: !!currentTargetObject,
      targetObjectRefValue: currentTargetObject ? {
        name: currentTargetObject.name,
        type: currentTargetObject.type,
        position: currentTargetObject.position.toArray(),
        uuid: currentTargetObject.uuid,
      } : null,
      hasBoneMapRef: !!currentBoneMap,
      boneMapSize: currentBoneMap?.size || 0,
      boneMapKeys: currentBoneMap ? Array.from(currentBoneMap.keys()).slice(0, 10) : [], // Log first 10 keys
      attachmentStateChanged: attachmentNodeChanged || attachedToTargetChanged || targetObjectChanged || !boneStillValid,
    });

    if (config.attachedToTarget && currentTargetObject) {
      // If attachmentNode is specified and we have a bone map, try to find the bone
      if (config.attachmentNode && currentBoneMap) {
        console.log(`[ParticleEmitter:${config.id}] Looking for attachment node: "${config.attachmentNode}"`);
        console.log(`[ParticleEmitter:${config.id}] Available bone map keys (first 20):`, Array.from(currentBoneMap.keys()).slice(0, 20));
        
        // Try exact match first (case-sensitive), then lowercase match
        let bone = currentBoneMap.get(config.attachmentNode);
        if (!bone) {
          console.log(`[ParticleEmitter:${config.id}] Exact match failed, trying lowercase: "${config.attachmentNode.toLowerCase()}"`);
          bone = currentBoneMap.get(config.attachmentNode.toLowerCase());
        }
        
        if (bone) {
          console.log(`[ParticleEmitter:${config.id}] ✓ Found bone "${config.attachmentNode}" (name: "${bone.name}", type: ${bone.type}, uuid: ${bone.uuid})`);
          console.log(`[ParticleEmitter:${config.id}] Bone local position:`, bone.position.toArray());
          const worldPos = bone.getWorldPosition(new THREE.Vector3());
          console.log(`[ParticleEmitter:${config.id}] Bone world position:`, worldPos.toArray());
          console.log(`[ParticleEmitter:${config.id}] Bone parent:`, bone.parent ? { name: bone.parent.name, type: bone.parent.type } : 'none');
          emitterRef.current.attachToObject(bone);
          lastAttachedObjectRef.current = bone;
          lastAttachmentNodeRef.current = config.attachmentNode;
          console.log(`[ParticleEmitter:${config.id}] ✓ Attached to bone`);
        } else {
          console.warn(`[ParticleEmitter:${config.id}] ✗ Bone "${config.attachmentNode}" not found in bone map! Falling back to root object.`);
          console.log(`[ParticleEmitter:${config.id}] Root object:`, {
            name: currentTargetObject.name,
            type: currentTargetObject.type,
            position: currentTargetObject.position.toArray(),
          });
          emitterRef.current.attachToObject(currentTargetObject);
          lastAttachedObjectRef.current = currentTargetObject;
          lastAttachmentNodeRef.current = undefined;
          console.log(`[ParticleEmitter:${config.id}] ✓ Attached to root object (fallback)`);
        }
      } else {
        if (!config.attachmentNode) {
          console.log(`[ParticleEmitter:${config.id}] No attachment node specified, attaching to root object`);
        } else {
          console.warn(`[ParticleEmitter:${config.id}] Attachment node "${config.attachmentNode}" specified but no bone map available!`);
        }
        console.log(`[ParticleEmitter:${config.id}] Root object:`, {
          name: currentTargetObject.name,
          type: currentTargetObject.type,
          position: currentTargetObject.position.toArray(),
        });
        emitterRef.current.attachToObject(currentTargetObject);
        lastAttachedObjectRef.current = currentTargetObject;
        lastAttachmentNodeRef.current = config.attachmentNode;
        console.log(`[ParticleEmitter:${config.id}] ✓ Attached to root object`);
      }
    } else {
      if (!config.attachedToTarget) {
        console.log(`[ParticleEmitter:${config.id}] Not attached to target (attachedToTarget=false)`);
        emitterRef.current.attachToObject(null);
        lastAttachedObjectRef.current = null;
        lastAttachmentNodeRef.current = undefined;
        console.log(`[ParticleEmitter:${config.id}] ✓ Detached from object`);
      } else {
        console.warn(`[ParticleEmitter:${config.id}] Want to attach but no target object ref available! Will retry when object becomes available.`);
        // Don't detach immediately - wait for object to become available
        // This handles the case where play mode starts but player mesh hasn't loaded yet
        // Keep the last attached object reference so we don't lose track
        return;
      }
    }
  }, [config.attachedToTarget, config.attachmentNode, config.id, targetObject, targetObjectRef, boneMapRef]);

  // Animation loop
  useFrame((state, delta) => {
    if (!emitterRef.current) return;

    const emitter = emitterRef.current;
    emitter.update(delta);
  });

  return null; // This component doesn't render anything directly
}

