/**
 * GPU Detection and Performance Assessment Utilities
 *
 * This module helps detect GPU capabilities and automatically adjust
 * performance settings for optimal frame rates.
 */

interface GPUInfo {
    vendor: string;
    renderer: string;
    isIntegratedGPU: boolean;
    isHighPerformance: boolean;
    estimatedPerformanceClass: "low" | "medium" | "high";
}

/**
 * Detects GPU information from WebGL context
 */
export function detectGPU(): GPUInfo {
    let vendor = "unknown";
    let renderer = "unknown";
    let isIntegratedGPU = false;
    let isHighPerformance = false;

    try {
        // Create a temporary canvas to get WebGL context
        const canvas = document.createElement("canvas");
        const gl =
            canvas.getContext("webgl2", {
                powerPreference: "high-performance",
            }) ||
            canvas.getContext("webgl", { powerPreference: "high-performance" });

        if (gl) {
            const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
            if (debugInfo) {
                vendor =
                    gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) ||
                    "unknown";
                renderer =
                    gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ||
                    "unknown";
            } else {
                // Fallback to basic info
                vendor = gl.getParameter(gl.VENDOR) || "unknown";
                renderer = gl.getParameter(gl.RENDERER) || "unknown";
            }
        }
    } catch (error) {
        console.warn("GPU detection failed:", error);
    }

    // Detect integrated GPUs
    const integratedPatterns = [
        /intel.*hd/i,
        /intel.*iris/i,
        /intel.*uhd/i,
        /amd.*radeon.*vega/i,
        /amd.*ryzen/i,
        /apple.*gpu/i,
        /mali/i,
        /adreno/i,
        /powervr/i,
    ];

    const rendererLower = renderer.toLowerCase();
    isIntegratedGPU = integratedPatterns.some((pattern) =>
        pattern.test(rendererLower)
    );

    // Detect high-performance GPUs
    const highPerfPatterns = [
        /nvidia.*rtx/i,
        /nvidia.*gtx/i,
        /nvidia.*titan/i,
        /radeon.*rx/i,
        /radeon.*pro/i,
        /quadro/i,
        /tesla/i,
    ];

    isHighPerformance = highPerfPatterns.some((pattern) =>
        pattern.test(rendererLower)
    );

    // Estimate performance class
    let estimatedPerformanceClass: "low" | "medium" | "high" = "medium";

    if (isIntegratedGPU) {
        estimatedPerformanceClass = "low";
    } else if (isHighPerformance) {
        estimatedPerformanceClass = "high";
    }

    return {
        vendor,
        renderer,
        isIntegratedGPU,
        isHighPerformance,
        estimatedPerformanceClass,
    };
}

/**
 * Gets recommended settings based on GPU performance class
 */
export function getRecommendedSettings(gpuInfo: GPUInfo) {
    const baseSettings = {
        shadowMapSize: 2048,
        shadowMapType: "PCFShadowMap",
        viewDistance: 8, // chunks
        pixelRatio: Math.min(window.devicePixelRatio, 2),
        antialias: true,
        enablePostProcessing: false,
        maxEnvironmentObjects: 1000,
    };

    switch (gpuInfo.estimatedPerformanceClass) {
        case "low":
            return {
                ...baseSettings,
                shadowMapSize: 1024,
                shadowMapType: "BasicShadowMap",
                viewDistance: 4, // Reduce chunk view distance significantly
                pixelRatio: Math.min(window.devicePixelRatio, 1.5),
                antialias: false,
                maxEnvironmentObjects: 500,
            };

        case "high":
            return {
                ...baseSettings,
                shadowMapSize: 4096,
                shadowMapType: "PCFSoftShadowMap",
                viewDistance: 12,
                pixelRatio: Math.min(window.devicePixelRatio, 2),
                enablePostProcessing: true,
                maxEnvironmentObjects: 2000,
            };

        default: // medium
            return baseSettings;
    }
}

/**
 * Automatically applies recommended settings to a Three.js WebGL renderer
 */
export function applyGPUOptimizedSettings(renderer: any, gpuInfo?: GPUInfo) {
    if (!gpuInfo) {
        gpuInfo = detectGPU();
    }

    const settings = getRecommendedSettings(gpuInfo);

    // Apply renderer settings
    renderer.setPixelRatio(settings.pixelRatio);

    if (renderer.shadowMap) {
        renderer.shadowMap.enabled = true;
        // Map string types to Three.js constants
        switch (settings.shadowMapType) {
            case "BasicShadowMap":
                renderer.shadowMap.type = 0; // THREE.BasicShadowMap
                break;
            case "PCFSoftShadowMap":
                renderer.shadowMap.type = 2; // THREE.PCFSoftShadowMap
                break;
            default: // PCFShadowMap
                renderer.shadowMap.type = 1; // THREE.PCFShadowMap
                break;
        }
    }

    console.log(
        `Applied GPU-optimized settings for ${gpuInfo.estimatedPerformanceClass} performance GPU:`,
        {
            gpu: `${gpuInfo.vendor} ${gpuInfo.renderer}`,
            settings,
        }
    );

    return settings;
}

/**
 * Logs GPU information for debugging
 */
export function logGPUInfo(): GPUInfo {
    const gpuInfo = detectGPU();
    console.log("GPU Detection Results:", {
        vendor: gpuInfo.vendor,
        renderer: gpuInfo.renderer,
        isIntegratedGPU: gpuInfo.isIntegratedGPU,
        isHighPerformance: gpuInfo.isHighPerformance,
        performanceClass: gpuInfo.estimatedPerformanceClass,
    });
    return gpuInfo;
}
