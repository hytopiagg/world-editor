
export const PERFORMANCE_SETTINGS = {
    maxChunksPerFrame: 5,
    objectPooling: true,
    batchedGeometry: true,
    shadowDistance: 96,
};

export const TEXTURE_ATLAS_SETTINGS = {
    batchedChunkRebuilding: true,
    maxConcurrentChunkRebuilds: 64,
    prioritizeChunksByDistance: true,
    delayInitialRebuild: false,
    initialRebuildDelay: 0,
    useTextureAtlas: false,
};

let _meshesNeedRefresh = false;

export const meshesNeedsRefresh = function (value) {
    if (value !== undefined) {
        _meshesNeedRefresh = Boolean(value);
    }
    return _meshesNeedRefresh;
};

Object.defineProperty(meshesNeedsRefresh, "value", {
    get: function () {
        return _meshesNeedRefresh;
    },
    set: function (val) {
        _meshesNeedRefresh = Boolean(val);
    },
});

export const getTextureAtlasSettings = () => TEXTURE_ATLAS_SETTINGS;
export const setTextureAtlasSetting = (setting, value) => {
    if (setting in TEXTURE_ATLAS_SETTINGS) {
        TEXTURE_ATLAS_SETTINGS[setting] = value;
        console.log(`Updated texture atlas setting: ${setting} = ${value}`);
        return true;
    }
    return false;
};
