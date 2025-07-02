/* eslint-disable no-restricted-globals */
// Web Worker: perlinNoiseWorker.js
// Runs Perlin noise generation off the main thread
import { generatePerlinNoise } from "perlin-noise";

self.onmessage = (e) => {
    const { width, length, options } = e.data;
    try {
        const noiseData = generatePerlinNoise(width, length, options || {});
        // Transfer the underlying array buffer for performance
        const transferable =
            noiseData instanceof Float32Array ? [noiseData.buffer] : undefined;
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        self.postMessage(noiseData, transferable);
    } catch (err) {
        console.error("Perlin worker error", err);
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        self.postMessage(null);
    }
};
