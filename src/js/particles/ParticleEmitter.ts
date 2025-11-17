import { Mesh, Object3D, Vector3, type Vector3Like, TextureLoader, CanvasTexture, Texture, NearestFilter } from 'three';
import ParticleEmitterCore, { ParticleEmitterCoreOptions } from './ParticleEmitterCore';

export interface ParticleEmitterOptions {
  id: string;
  textureUri: string;
  emitterCoreOptions?: ParticleEmitterCoreOptions;
  position?: Vector3Like;
  offset?: Vector3Like;
  attachedToObject?: Object3D | null;
}

/**
 * Simplified ParticleEmitter wrapper for standalone use.
 * Adapted from SDK version without Game/EntityManager dependencies.
 */
export default class ParticleEmitter {
  private _id: string;
  private _emitterCore: ParticleEmitterCore;
  private _position: Vector3 = new Vector3();
  private _offset: Vector3 = new Vector3();
  private _attachedToObject: Object3D | null = null;
  private _textureUri: string = '';
  private _texture: Texture | null = null;
  private _textureLoader: TextureLoader;
  private _pendingTextureLoads: Set<Promise<Texture | null>> = new Set();

  constructor(options: ParticleEmitterOptions) {
    this._id = options.id;
    this._textureLoader = new TextureLoader();

    this._emitterCore = new ParticleEmitterCore(options.emitterCoreOptions || {});
    this._emitterCore.mesh.matrixAutoUpdate = false;
    this._emitterCore.mesh.matrixWorldAutoUpdate = false;

    if (options.position) {
      this.setPosition(options.position);
    }

    if (options.offset) {
      this.setOffset(options.offset);
    }

    if (options.attachedToObject !== undefined) {
      this.attachToObject(options.attachedToObject);
    }

    this.setTextureUri(options.textureUri);
  }

  public get id(): string {
    return this._id;
  }

  public get mesh(): Mesh {
    return this._emitterCore.mesh;
  }

  public burst(count: number): void {
    this._emitterCore.burst(count);
  }

  public pause(): void {
    this._emitterCore.pause();
  }

  public restart(): void {
    this._emitterCore.restart();
  }

  public setPosition(position: Vector3Like): void {
    this._position.copy(position);
  }

  public setOffset(offset: Vector3Like): void {
    this._offset.copy(offset);
  }

  public setVisible(visible: boolean): void {
    this._emitterCore.mesh.visible = visible;
  }

  public attachToObject(object: Object3D | null): void {
    this._attachedToObject = object;
  }

  public setEmitterCoreOptions(options: ParticleEmitterCoreOptions): void {
    this._emitterCore.updateParameters(options);
  }

  public setTextureUri(textureUri: string): void {
    // Normalize path - add ./ prefix if it starts with assets/
    let normalizedUri = textureUri;
    if (textureUri.startsWith('assets/')) {
      normalizedUri = `./${textureUri}`;
    } else if (!textureUri.startsWith('./') && !textureUri.startsWith('data:') && !textureUri.startsWith('http')) {
      normalizedUri = `./assets/${textureUri}`;
    }

    if (this._textureUri === normalizedUri) {
      return;
    }

    this._textureUri = normalizedUri;
    this._loadTexture();
  }

  private async _loadTexture(): Promise<void> {
    // Cancel pending loads
    this._pendingTextureLoads.forEach(pendingLoad => {
      // Note: TextureLoader doesn't have cancel, but we can ignore the result
    });
    this._pendingTextureLoads.clear();

    const loadingTextureUri = this._textureUri;

    const texturePromise = this._loadTextureInternal(loadingTextureUri);
    this._pendingTextureLoads.add(texturePromise);
    
    const texture = await texturePromise;

    if (!this._pendingTextureLoads.has(texturePromise)) {
      // Texture was replaced, dispose this one
      if (texture) {
        texture.dispose();
      }
      return;
    }

    this._pendingTextureLoads.delete(texturePromise);

    if (this._texture) {
      this._texture.dispose();
    }

    this._texture = texture;
    this._emitterCore.updateParameters({ texture });
  }

  private _loadTextureInternal(textureUri: string): Promise<Texture | null> {
    return new Promise((resolve) => {
      if (textureUri.startsWith('data:image')) {
        const img = new Image();
        img.onload = () => {
          const texture = new CanvasTexture(img);
          texture.magFilter = NearestFilter;
          texture.minFilter = NearestFilter;
          texture.needsUpdate = true;
          resolve(texture);
        };
        img.onerror = () => {
          console.warn(`Failed to load texture from data URI: ${textureUri.substring(0, 50)}...`);
          resolve(null);
        };
        img.src = textureUri;
      } else {
        this._textureLoader.load(
          textureUri,
          (texture) => {
            texture.magFilter = NearestFilter;
            texture.minFilter = NearestFilter;
            resolve(texture);
          },
          undefined,
          (error) => {
            console.warn(`Failed to load texture: ${textureUri}`, error);
            resolve(null);
          }
        );
      }
    });
  }

  public update(deltaTimeS: number): void {
    this._updatePosition();
    this._emitterCore.update(deltaTimeS);
  }

  private _updatePosition(): void {
    if (this._attachedToObject !== null) {
      this._attachedToObject.getWorldPosition(this._emitterCore.mesh.position);
    } else {
      this._emitterCore.mesh.position.copy(this._position);
    }

    this._emitterCore.mesh.position.add(this._offset);
    this._emitterCore.mesh.updateMatrix();
    this._emitterCore.mesh.matrixWorld.copy(this._emitterCore.mesh.matrix);
    this._emitterCore.mesh.matrixWorldNeedsUpdate = false;
  }

  public dispose(): void {
    this._pendingTextureLoads.clear();

    if (this._texture) {
      this._texture.dispose();
      this._texture = null;
    }

    this._emitterCore.dispose();
  }
}

