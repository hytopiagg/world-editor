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

  // Create emitter instance
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

    return () => {
      emitter.dispose();
      scene.remove(emitter.mesh);
    };
  }, [config.id, config.textureUri, scene]); // Only recreate on id/texture change

  // Update emitter parameters when config changes
  useEffect(() => {
    if (!emitterRef.current) return;

    const emitter = emitterRef.current;
    const updates: Partial<ParticleEmitterCoreOptions> = {};

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

    // Update position/offset
    if (config.position) {
      emitter.setPosition(new THREE.Vector3(config.position.x, config.position.y, config.position.z));
    }
    if (config.offset) {
      emitter.setOffset(new THREE.Vector3(config.offset.x, config.offset.y, config.offset.z));
    }
  }, [config]);

  // Attach to target object if needed
  useEffect(() => {
    if (!emitterRef.current) return;

    if (config.attachedToTarget && targetObjectRef?.current) {
      // If attachmentNode is specified and we have a bone map, try to find the bone
      if (config.attachmentNode && boneMapRef?.current) {
        // Try exact match first (case-sensitive), then lowercase match
        let bone = boneMapRef.current.get(config.attachmentNode);
        if (!bone) {
          bone = boneMapRef.current.get(config.attachmentNode.toLowerCase());
        }
        if (bone) {
          emitterRef.current.attachToObject(bone);
        } else {
          // Fallback to root object if bone not found
          emitterRef.current.attachToObject(targetObjectRef.current);
        }
      } else {
        emitterRef.current.attachToObject(targetObjectRef.current);
      }
    } else {
      emitterRef.current.attachToObject(null);
    }
  }, [config.attachedToTarget, config.attachmentNode, targetObjectRef, boneMapRef]);

  // Animation loop
  useFrame((state, delta) => {
    if (!emitterRef.current) return;

    const emitter = emitterRef.current;
    emitter.update(delta);
  });

  return null; // This component doesn't render anything directly
}

