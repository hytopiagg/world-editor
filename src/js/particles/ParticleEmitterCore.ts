import {
  Box3,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  ShaderMaterial,
  Sphere,
  Texture,
  TextureLoader,
  Vector3,
} from 'three';

// Attribute name constants
const ATTR_INITIAL_POSITION = 'initialPosition';
const ATTR_INITIAL_VELOCITY = 'initialVelocity';
const ATTR_SIZE_VAR = 'sizeVar'; // vec2: x=sizeStart, y=sizeEnd
const ATTR_TIME_VAR = 'timeVar'; // vec2: x=startTime, y=maxLife
const ATTR_OPACITY_VAR = 'opacityVar'; // vec2: x=opacityStart, y=opacityEnd
const ATTR_COLOR_START_VAR = 'colorStartVar';
const ATTR_COLOR_END_VAR = 'colorEndVar';

const UNIFORM_MAP = 'map';
const UNIFORM_TIME = 'time';
const UNIFORM_GRAVITY = 'gravity';
const UNIFORM_ALPHATEST = 'alphaTest';

const DEFINE_USE_ALPHATEST = 'USE_ALPHATEST';

// Working variables
const attributes: InstancedBufferAttribute[] = [];
const tempVector3 = new Vector3();

export interface ParticleEmitterCoreOptions {
  alphaTest?: number;

  colorStart?: Color;
  colorEnd?: Color;
  colorStartVariance?: Color;
  colorEndVariance?: Color;

  gravity?: Vector3;

  lifetime?: number;
  lifetimeVariance?: number;

  maxParticles?: number;

  opacityEnd?: number;
  opacityEndVariance?: number;
  opacityStart?: number;
  opacityStartVariance?: number;

  position?: Vector3;
  positionVariance?: Vector3;

  rate?: number;
  rateVariance?: number;

  sizeEnd?: number;
  sizeEndVariance?: number;
  sizeStart?: number;
  sizeStartVariance?: number;

  texture?: Texture | null;

  transparent?: boolean;

  velocity?: Vector3;
  velocityVariance?: Vector3;
}

class ParticlesMaterial extends ShaderMaterial {
  constructor() {
    super({
      uniforms: {
        [UNIFORM_MAP]: { value: null },
        [UNIFORM_TIME]: { value: 0.0 },
        [UNIFORM_GRAVITY]: { value: new Vector3() }
      },
      vertexShader: `
        uniform float ${UNIFORM_TIME};
        uniform vec3 ${UNIFORM_GRAVITY};

        attribute vec3 ${ATTR_INITIAL_POSITION};
        attribute vec3 ${ATTR_INITIAL_VELOCITY};
        attribute vec2 ${ATTR_SIZE_VAR};
        attribute vec2 ${ATTR_TIME_VAR};
        attribute vec2 ${ATTR_OPACITY_VAR};
        attribute vec3 ${ATTR_COLOR_START_VAR};
        attribute vec3 ${ATTR_COLOR_END_VAR};

        varying vec2 vUv;
        varying float vLife;
        varying vec2 vOpacityVar;
        varying vec3 vColorStart;
        varying vec3 vColorEnd;

        void main() {
          vUv = uv;

          float age = ${UNIFORM_TIME} - ${ATTR_TIME_VAR}.x;
          vLife = clamp(1.0 - age / ${ATTR_TIME_VAR}.y, 0.0, 1.0);

          // Pass variations to fragment shader
          vOpacityVar = ${ATTR_OPACITY_VAR};
          vColorStart = ${ATTR_COLOR_START_VAR};
          vColorEnd = ${ATTR_COLOR_END_VAR};

          if (vLife <= 0.0) {
            gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
            return;
          }

          // Note: initialPosition is already in world space
          vec3 worldPos = ${ATTR_INITIAL_POSITION} + ${ATTR_INITIAL_VELOCITY} * age + 0.5 * ${UNIFORM_GRAVITY} * age * age;

          // Billboard calculation
          vec3 cameraRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 cameraUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

          // Interpolate size based on life
          float interpolatedSize = mix(${ATTR_SIZE_VAR}.y, ${ATTR_SIZE_VAR}.x, vLife);

          // Use the vertex position from the plane geometry to create billboard
          vec3 billboardOffset = (position.x * cameraRight + position.y * cameraUp) * interpolatedSize;
          vec3 billboardPos = worldPos + billboardOffset;

          gl_Position = projectionMatrix * viewMatrix * vec4(billboardPos, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D ${UNIFORM_MAP};

        #ifdef ${DEFINE_USE_ALPHATEST}
          uniform float ${UNIFORM_ALPHATEST};
        #endif

        varying vec2 vUv;
        varying float vLife;
        varying vec2 vOpacityVar;
        varying vec3 vColorStart;
        varying vec3 vColorEnd;

        void main() {
          vec4 texColor = texture2D(${UNIFORM_MAP}, vUv);

          vec3 color = mix(vColorEnd, vColorStart, vLife);
          float alphaGradient = mix(vOpacityVar.y, vOpacityVar.x, vLife);
          float finalAlpha = texColor.a * alphaGradient;

          #ifdef ${DEFINE_USE_ALPHATEST}
            if (finalAlpha < ${UNIFORM_ALPHATEST}) discard;
          #endif

          gl_FragColor = vec4(texColor.rgb * color, finalAlpha);
        }
      `,
    });
  }

  public setAlphaTest(alphaTest: number): this {
    if (alphaTest > 0) {
      if (!(UNIFORM_ALPHATEST in this.uniforms)) {
        this.uniforms[UNIFORM_ALPHATEST] = { value: alphaTest };
        this.defines[DEFINE_USE_ALPHATEST] = '';
        this.needsUpdate = true;
      } else {
        this.uniforms[UNIFORM_ALPHATEST].value = alphaTest;
      }
    } else if (alphaTest === 0 && (UNIFORM_ALPHATEST in this.uniforms)) {
      delete this.uniforms[UNIFORM_ALPHATEST];
      delete this.defines[DEFINE_USE_ALPHATEST];
      this.needsUpdate = true;
    }
    return this;
  }

  public setGravity(gravity: Vector3): this {
    this.uniforms[UNIFORM_GRAVITY].value.copy(gravity);
    return this;
  }

  public setTexture(texture: Texture | null): this {
    this.uniforms[UNIFORM_MAP].value = texture;
    this.visible = !!texture;
    return this;
  }

  public setTransparent(transparent: boolean): this {
    if (this.transparent !== transparent) {
      this.needsUpdate = true;
    }
    this.transparent = transparent;
    this.depthWrite = !this.transparent;
    return this;
  }

  public updateTime(time: number): void {
    this.uniforms.time.value = time;
  }
}

const defaults: Required<ParticleEmitterCoreOptions> = {
  alphaTest: 0,
  colorEnd: new Color(1, 1, 1),
  colorEndVariance: new Color(0, 0, 0),
  colorStart: new Color(1, 1, 1),
  colorStartVariance: new Color(0, 0, 0),
  lifetime: 1.0,
  lifetimeVariance: 0,
  maxParticles: 0, // Will be calculated
  gravity: new Vector3(0, 0, 0),
  opacityEnd: 0,
  opacityEndVariance: 0,
  opacityStart: 1,
  opacityStartVariance: 0,
  position: new Vector3(0, 0, 0),
  positionVariance: new Vector3(0, 0, 0),
  rate: 10,
  rateVariance: 0,
  sizeEnd: 1.0,
  sizeEndVariance: 0,
  sizeStart: 1.0,
  sizeStartVariance: 0,
  texture: null,
  transparent: false,
  velocity: new Vector3(0, 0, 0),
  velocityVariance: new Vector3(0, 0, 0),
};

/**
 * Core particle emitter implementation ported from HYTOPIA SDK.
 * Adapted for standalone use without Game/EntityManager dependencies.
 */
export default class ParticleEmitterCore {
  private _options: Required<ParticleEmitterCoreOptions>;
  private _poolIndex: number;
  private _currentTime: number;
  private _emissionAccumulator: number;
  private _isMaxParticlesAutoCalculated: boolean = false;
  private _mesh: InstancedMesh;
  private _paused: boolean = false;

  constructor(options: ParticleEmitterCoreOptions) {
    this._options = { ...defaults };
    
    // Only override defaults with defined values
    for (const key in options) {
      if (options[key as keyof ParticleEmitterCoreOptions] !== undefined) {
        (this._options as any)[key] = options[key as keyof ParticleEmitterCoreOptions];
      }
    }

    // Auto-calculate maxParticles if needed
    if (!this._options.maxParticles) {
      this._options.maxParticles = this._calculateMaxParticles();
      this._isMaxParticlesAutoCalculated = true;
    }

    // Clone Vector3 and Color instances to avoid shared references
    for (const key in this._options) {
      const value = this._options[key as keyof typeof this._options];
      if (value instanceof Vector3 || value instanceof Color) {
        (this._options as any)[key] = value.clone();
      }
    }

    const geometry = this._createGeometry(this._options.maxParticles);

    this._mesh = new InstancedMesh(
      geometry,
      new ParticlesMaterial()
        .setTexture(this._options.texture)
        .setGravity(this._options.gravity)
        .setTransparent(this._options.transparent)
        .setAlphaTest(this._options.alphaTest),
      this._options.maxParticles,
    );
    this._mesh.position.copy(this._options.position);

    this._updateBoundingBox();

    this._poolIndex = 0;
    this._currentTime = 0;
    this._emissionAccumulator = 0;
  }

  public get mesh(): InstancedMesh {
    return this._mesh;
  }

  public get paused(): boolean {
    return this._paused;
  }

  public burst(count: number): void {
    if (count <= 0) {
      return;
    }

    if (!(this.mesh.material as ParticlesMaterial).visible) {
      return;
    }

    if (this.mesh.matrixWorldAutoUpdate) {
      this.mesh.updateMatrixWorld();
    }

    this._emit(count, this.mesh.matrixWorld);
  }

  public pause(): void {
    this._paused = true;
    this._emissionAccumulator = 0;
  }

  public restart(): void {
    this._paused = false;
  }

  private _calculateMaxParticles(): number {
    const maxLife = this._options.lifetime + this._options.lifetimeVariance;
    const theoreticalMax = Math.ceil(this._options.rate * maxLife);
    const safetyMargin = 1.2;
    const calculatedMax = Math.ceil(theoreticalMax * safetyMargin);
    const minimumParticles = 10;
    return Math.max(minimumParticles, calculatedMax);
  }

  private _calculateBoundingBox(): Box3 {
    const maxLife = this._options.lifetime + this._options.lifetimeVariance;
    const maxSizeStart = this._options.sizeStart + this._options.sizeStartVariance;
    const maxSizeEnd = this._options.sizeEnd + this._options.sizeEndVariance;
    const maxSize = Math.max(maxSizeStart, maxSizeEnd);

    const posVar = this._options.positionVariance;

    const maxVelX = Math.abs(this._options.velocity.x) + this._options.velocityVariance.x;
    const maxVelY = Math.abs(this._options.velocity.y) + this._options.velocityVariance.y;
    const maxVelZ = Math.abs(this._options.velocity.z) + this._options.velocityVariance.z;

    const gravityDisplacement = new Vector3(
      0.5 * Math.abs(this._options.gravity.x) * maxLife * maxLife,
      0.5 * Math.abs(this._options.gravity.y) * maxLife * maxLife,
      0.5 * Math.abs(this._options.gravity.z) * maxLife * maxLife,
    );

    const velocityDisplacement = new Vector3(
      maxVelX * maxLife,
      maxVelY * maxLife,
      maxVelZ * maxLife,
    );

    const maxRange = new Vector3(
      posVar.x + velocityDisplacement.x + gravityDisplacement.x + maxSize,
      posVar.y + velocityDisplacement.y + gravityDisplacement.y + maxSize,
      posVar.z + velocityDisplacement.z + gravityDisplacement.z + maxSize,
    );

    const min = new Vector3(-maxRange.x, -maxRange.y, -maxRange.z);
    const max = new Vector3(maxRange.x, maxRange.y, maxRange.z);

    ((this._options.velocity.x > 0) ? max : min).x += this._options.velocity.x * maxLife;
    ((this._options.velocity.y > 0) ? max : min).y += this._options.velocity.y * maxLife;
    ((this._options.velocity.z > 0) ? max : min).z += this._options.velocity.z * maxLife;

    return new Box3(min, max);
  }

  private _updateBoundingBox(): void {
    const boundingBox = this._calculateBoundingBox();
    this.mesh.geometry.boundingBox = boundingBox;

    const center = new Vector3();
    boundingBox.getCenter(center);
    const radius = boundingBox.getSize(new Vector3()).length() * 0.5;
    this.mesh.geometry.boundingSphere = new Sphere(center, radius);
  }

  private _emit(count: number, worldMatrix: Matrix4): void {
    const geometry = this.mesh.geometry;
    const initialPositionAttr = geometry.getAttribute(ATTR_INITIAL_POSITION) as InstancedBufferAttribute;
    const initialVelocityAttr = geometry.getAttribute(ATTR_INITIAL_VELOCITY) as InstancedBufferAttribute;
    const sizeVarAttr = geometry.getAttribute(ATTR_SIZE_VAR) as InstancedBufferAttribute;
    const timeVarAttr = geometry.getAttribute(ATTR_TIME_VAR) as InstancedBufferAttribute;
    const opacityVarAttr = geometry.getAttribute(ATTR_OPACITY_VAR) as InstancedBufferAttribute;
    const colorStartVarAttr = geometry.getAttribute(ATTR_COLOR_START_VAR) as InstancedBufferAttribute;
    const colorEndVarAttr = geometry.getAttribute(ATTR_COLOR_END_VAR) as InstancedBufferAttribute;

    const startIndex = this._poolIndex;
    let actualEmitCount = 0;

    for (let i = 0; i < count; i++) {
      const localPosX = (Math.random() - 0.5) * 2 * this._options.positionVariance.x;
      const localPosY = (Math.random() - 0.5) * 2 * this._options.positionVariance.y;
      const localPosZ = (Math.random() - 0.5) * 2 * this._options.positionVariance.z;

      tempVector3.set(localPosX, localPosY, localPosZ);
      tempVector3.applyMatrix4(worldMatrix);

      const velX = this._options.velocity.x + (Math.random() - 0.5) * 2 * this._options.velocityVariance.x;
      const velY = this._options.velocity.y + (Math.random() - 0.5) * 2 * this._options.velocityVariance.y;
      const velZ = this._options.velocity.z + (Math.random() - 0.5) * 2 * this._options.velocityVariance.z;

      const maxLife = this._options.lifetime + (Math.random() - 0.5) * 2 * this._options.lifetimeVariance;

      const sizeStart = Math.max(0, this._options.sizeStart + (Math.random() - 0.5) * 2 * this._options.sizeStartVariance);
      const sizeEnd = Math.max(0, this._options.sizeEnd + (Math.random() - 0.5) * 2 * this._options.sizeEndVariance);

      const opacityStart = Math.max(0, Math.min(1, this._options.opacityStart + (Math.random() - 0.5) * 2 * this._options.opacityStartVariance));
      const opacityEnd = Math.max(0, Math.min(1, this._options.opacityEnd + (Math.random() - 0.5) * 2 * this._options.opacityEndVariance));

      const colorStartR = Math.max(0, Math.min(1, this._options.colorStart.r + (Math.random() - 0.5) * 2 * this._options.colorStartVariance.r));
      const colorStartG = Math.max(0, Math.min(1, this._options.colorStart.g + (Math.random() - 0.5) * 2 * this._options.colorStartVariance.g));
      const colorStartB = Math.max(0, Math.min(1, this._options.colorStart.b + (Math.random() - 0.5) * 2 * this._options.colorStartVariance.b));

      const colorEndR = Math.max(0, Math.min(1, this._options.colorEnd.r + (Math.random() - 0.5) * 2 * this._options.colorEndVariance.r));
      const colorEndG = Math.max(0, Math.min(1, this._options.colorEnd.g + (Math.random() - 0.5) * 2 * this._options.colorEndVariance.g));
      const colorEndB = Math.max(0, Math.min(1, this._options.colorEnd.b + (Math.random() - 0.5) * 2 * this._options.colorEndVariance.b));

      initialPositionAttr.setXYZ(this._poolIndex, tempVector3.x, tempVector3.y, tempVector3.z);
      initialVelocityAttr.setXYZ(this._poolIndex, velX, velY, velZ);
      sizeVarAttr.setXY(this._poolIndex, sizeStart, sizeEnd);
      timeVarAttr.setXY(this._poolIndex, this._currentTime, maxLife);
      opacityVarAttr.setXY(this._poolIndex, opacityStart, opacityEnd);
      colorStartVarAttr.setXYZ(this._poolIndex, colorStartR, colorStartG, colorStartB);
      colorEndVarAttr.setXYZ(this._poolIndex, colorEndR, colorEndG, colorEndB);

      this._poolIndex = (this._poolIndex + 1) % this._options.maxParticles;
      actualEmitCount++;
    }

    attributes.push(initialPositionAttr);
    attributes.push(initialVelocityAttr);
    attributes.push(sizeVarAttr);
    attributes.push(timeVarAttr);
    attributes.push(opacityVarAttr);
    attributes.push(colorStartVarAttr);
    attributes.push(colorEndVarAttr);

    if (actualEmitCount > 0) {
      attributes.forEach(attribute => attribute.clearUpdateRanges());

      if (startIndex + actualEmitCount <= this._options.maxParticles) {
        attributes.forEach(attribute => attribute.addUpdateRange(startIndex * attribute.itemSize, actualEmitCount * attribute.itemSize));
      } else {
        const firstPartCount = this._options.maxParticles - startIndex;
        const secondPartCount = actualEmitCount - firstPartCount;

        attributes.forEach(attribute => {
          attribute.addUpdateRange(startIndex * attribute.itemSize, firstPartCount * attribute.itemSize);
          attribute.addUpdateRange(0, secondPartCount * attribute.itemSize);
        });
      }

      attributes.forEach(attribute => attribute.needsUpdate = true);
    }

    attributes.length = 0;
  }

  private _getCurrentRate(): number {
    if (this._options.rateVariance === 0) {
      return this._options.rate;
    }

    const variance = (Math.random() - 0.5) * 2 * this._options.rateVariance;
    return Math.max(0, this._options.rate + variance);
  }

  public update(deltaTimeS: number): void {
    const clampedDeltaTime = Math.min(deltaTimeS, 0.1);

    this._currentTime += deltaTimeS;
    (this.mesh.material as ParticlesMaterial).updateTime(this._currentTime);

    if (!(this.mesh.material as ParticlesMaterial).visible) {
      return;
    }

    if (this._paused) {
      return;
    }

    const currentRate = this._getCurrentRate();
    this._emissionAccumulator += currentRate * clampedDeltaTime;

    const particlesToEmit = Math.floor(this._emissionAccumulator);

    if (particlesToEmit > 0) {
      if (this.mesh.matrixWorldAutoUpdate) {
        this.mesh.updateMatrixWorld();
      }
      this._emit(particlesToEmit, this.mesh.matrixWorld);
      this._emissionAccumulator -= particlesToEmit;
    }
  }

  public updateParameters(updates: Partial<ParticleEmitterCoreOptions>): void {
    const material = this.mesh.material as ParticlesMaterial;

    let boundingBoxNeedsUpdate = false;
    let needsAutomaticResize = false;

    if (updates.alphaTest !== undefined) {
      this._options.alphaTest = updates.alphaTest;
      material.setAlphaTest(this._options.alphaTest);
    }

    if (updates.colorEnd !== undefined) {
      this._options.colorEnd.copy(updates.colorEnd);
    }

    if (updates.colorEndVariance !== undefined) {
      this._options.colorEndVariance.copy(updates.colorEndVariance);
    }

    if (updates.colorStart !== undefined) {
      this._options.colorStart.copy(updates.colorStart);
    }

    if (updates.colorStartVariance !== undefined) {
      this._options.colorStartVariance.copy(updates.colorStartVariance);
    }

    if (updates.gravity !== undefined) {
      this._options.gravity.copy(updates.gravity);
      material.setGravity(this._options.gravity);
    }

    if (updates.lifetime !== undefined && this._options.lifetime !== updates.lifetime) {
      this._options.lifetime = updates.lifetime;
      boundingBoxNeedsUpdate = true;
      needsAutomaticResize = true;
    }

    if (updates.lifetimeVariance !== undefined && this._options.lifetimeVariance !== updates.lifetimeVariance) {
      this._options.lifetimeVariance = updates.lifetimeVariance;
      boundingBoxNeedsUpdate = true;
      needsAutomaticResize = true;
    }

    if (updates.opacityEnd !== undefined) {
      this._options.opacityEnd = updates.opacityEnd;
    }

    if (updates.opacityEndVariance !== undefined) {
      this._options.opacityEndVariance = updates.opacityEndVariance;
    }

    if (updates.opacityStart !== undefined) {
      this._options.opacityStart = updates.opacityStart;
    }

    if (updates.opacityStartVariance !== undefined) {
      this._options.opacityStartVariance = updates.opacityStartVariance;
    }

    if (updates.position !== undefined) {
      this._options.position.copy(updates.position);
      this.mesh.position.copy(this._options.position);
    }

    if (updates.positionVariance !== undefined && !this._options.positionVariance.equals(updates.positionVariance)) {
      this._options.positionVariance.copy(updates.positionVariance);
      boundingBoxNeedsUpdate = true;
    }

    if (updates.rate !== undefined) {
      if (this._options.rate !== updates.rate) {
        needsAutomaticResize = true;
      }
      this._options.rate = updates.rate;
    }

    if (updates.rateVariance !== undefined) {
      this._options.rateVariance = updates.rateVariance;
    }

    if (updates.sizeEnd !== undefined && this._options.sizeEnd !== updates.sizeEnd) {
      this._options.sizeEnd = updates.sizeEnd;
      boundingBoxNeedsUpdate = true;
    }

    if (updates.sizeEndVariance !== undefined && this._options.sizeEndVariance !== updates.sizeEndVariance) {
      this._options.sizeEndVariance = updates.sizeEndVariance;
      boundingBoxNeedsUpdate = true;
    }

    if (updates.sizeStart !== undefined && this._options.sizeStart !== updates.sizeStart) {
      this._options.sizeStart = updates.sizeStart;
      boundingBoxNeedsUpdate = true;
    }

    if (updates.sizeStartVariance !== undefined && this._options.sizeStartVariance !== updates.sizeStartVariance) {
      this._options.sizeStartVariance = updates.sizeStartVariance;
      boundingBoxNeedsUpdate = true;
    }

    if (updates.texture !== undefined) {
      this._options.texture = updates.texture;
      material.setTexture(this._options.texture);
    }

    if (updates.transparent !== undefined) {
      this._options.transparent = updates.transparent;
      material.setTransparent(this._options.transparent);
    }

    if (updates.velocity !== undefined && !this._options.velocity.equals(updates.velocity)) {
      this._options.velocity.copy(updates.velocity);
      boundingBoxNeedsUpdate = true;
    }

    if (updates.velocityVariance !== undefined && !this._options.velocityVariance.equals(updates.velocityVariance)) {
      this._options.velocityVariance.copy(updates.velocityVariance);
      boundingBoxNeedsUpdate = true;
    }

    const oldMaxParticles = this._options.maxParticles;

    if (updates.maxParticles !== undefined && updates.maxParticles > 0) {
      this._options.maxParticles = updates.maxParticles;
      this._isMaxParticlesAutoCalculated = false;
    } else if (updates.maxParticles === 0 || (this._isMaxParticlesAutoCalculated && needsAutomaticResize)) {
      this._options.maxParticles = this._calculateMaxParticles();
      this._isMaxParticlesAutoCalculated = true;
    }

    if (this._options.maxParticles !== oldMaxParticles) {
      this._resize();
    }

    if (boundingBoxNeedsUpdate) {
      this._updateBoundingBox();
    }
  }

  private _resize(): void {
    const oldGeometry = this.mesh.geometry as PlaneGeometry;
    const newGeometry = this._createGeometry(this._options.maxParticles);

    if (this._poolIndex > 0) {
      const copyCount = Math.min(this._poolIndex, this._options.maxParticles);
      this._copyParticleData(oldGeometry, newGeometry, copyCount);
    }

    newGeometry.boundingBox = oldGeometry.boundingBox;
    newGeometry.boundingSphere = oldGeometry.boundingSphere;

    this.mesh.geometry = newGeometry;
    this.mesh.count = this._options.maxParticles;
    oldGeometry.dispose();

    if (this._poolIndex >= this._options.maxParticles) {
      this._poolIndex = 0;
    }
  }

  private _createGeometry(maxParticles: number): PlaneGeometry {
    return new PlaneGeometry(1, 1)
      .setAttribute(ATTR_INITIAL_POSITION, new InstancedBufferAttribute(new Float32Array(maxParticles * 3), 3).setUsage(DynamicDrawUsage))
      .setAttribute(ATTR_INITIAL_VELOCITY, new InstancedBufferAttribute(new Float32Array(maxParticles * 3), 3).setUsage(DynamicDrawUsage))
      .setAttribute(ATTR_SIZE_VAR, new InstancedBufferAttribute(new Float32Array(maxParticles * 2), 2).setUsage(DynamicDrawUsage))
      .setAttribute(ATTR_TIME_VAR, new InstancedBufferAttribute(new Float32Array(maxParticles * 2), 2).setUsage(DynamicDrawUsage))
      .setAttribute(ATTR_OPACITY_VAR, new InstancedBufferAttribute(new Float32Array(maxParticles * 2), 2).setUsage(DynamicDrawUsage))
      .setAttribute(ATTR_COLOR_START_VAR, new InstancedBufferAttribute(new Float32Array(maxParticles * 3), 3).setUsage(DynamicDrawUsage))
      .setAttribute(ATTR_COLOR_END_VAR, new InstancedBufferAttribute(new Float32Array(maxParticles * 3), 3).setUsage(DynamicDrawUsage))
      .deleteAttribute('normal');
  }

  private _copyParticleData(oldGeometry: PlaneGeometry, newGeometry: PlaneGeometry, count: number): void {
    this._copyAttribute(oldGeometry, newGeometry, ATTR_INITIAL_POSITION, count);
    this._copyAttribute(oldGeometry, newGeometry, ATTR_INITIAL_VELOCITY, count);
    this._copyAttribute(oldGeometry, newGeometry, ATTR_SIZE_VAR, count);
    this._copyAttribute(oldGeometry, newGeometry, ATTR_TIME_VAR, count);
    this._copyAttribute(oldGeometry, newGeometry, ATTR_OPACITY_VAR, count);
    this._copyAttribute(oldGeometry, newGeometry, ATTR_COLOR_START_VAR, count);
    this._copyAttribute(oldGeometry, newGeometry, ATTR_COLOR_END_VAR, count);
  }

  private _copyAttribute(oldGeometry: PlaneGeometry, newGeometry: PlaneGeometry, attrName: string, count: number): void {
    const oldAttr = oldGeometry.getAttribute(attrName) as InstancedBufferAttribute;
    const newAttr = newGeometry.getAttribute(attrName) as InstancedBufferAttribute;

    const copySize = count * oldAttr.itemSize;
    const oldArray = oldAttr.array as Float32Array;
    const newArray = newAttr.array as Float32Array;

    for (let i = 0; i < copySize; i++) {
      newArray[i] = oldArray[i];
    }

    newAttr.needsUpdate = true;
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as ParticlesMaterial).dispose();
  }
}

