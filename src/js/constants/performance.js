// Performance settings
export const PERFORMANCE_SETTINGS = {
  maxChunksPerFrame: 5,
  objectPooling: true,
  batchedGeometry: true,
  shadowDistance: 96,
};

// Texture Atlas settings
export const TEXTURE_ATLAS_SETTINGS = {
  batchedChunkRebuilding: true,
  maxConcurrentChunkRebuilds: 64,
  prioritizeChunksByDistance: true,
  delayInitialRebuild: false,
  initialRebuildDelay: 0,
  useTextureAtlas: false,
};

// Flag to indicate that meshes need to be refreshed
let _meshesNeedRefresh = false;

// Create a meshesNeedsRefresh object that works as both property and function
export const meshesNeedsRefresh = function(value) {
  if (value !== undefined) {
    _meshesNeedRefresh = Boolean(value);
  }
  return _meshesNeedRefresh;
};

// Define a value property that can be set directly
Object.defineProperty(meshesNeedsRefresh, 'value', {
  get: function() { return _meshesNeedRefresh; },
  set: function(val) { _meshesNeedRefresh = Boolean(val); }
});

// Texture atlas settings getters/setters
export const getTextureAtlasSettings = () => TEXTURE_ATLAS_SETTINGS;

export const setTextureAtlasSetting = (setting, value) => {
  if (setting in TEXTURE_ATLAS_SETTINGS) {
    TEXTURE_ATLAS_SETTINGS[setting] = value;
    console.log(`Updated texture atlas setting: ${setting} = ${value}`);
    return true;
  }
  return false;
}; 