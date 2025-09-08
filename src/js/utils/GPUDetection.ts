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
    supportsWebGL2: boolean;
    contextType: "webgl" | "webgl2";
    maxTextureSize: number;
    maxAnisotropy: number;
    supportedExtensions: string[];
}

interface RendererSettings {
    shadowMapSize: number;
    shadowMapType: string;
    viewDistance: number;
    pixelRatio: number;
    antialias: boolean;
    enablePostProcessing: boolean;
    maxEnvironmentObjects: number;
    preferredContextType: "webgl" | "webgl2";
    maxTextureSize: number;
    enableAnisotropicFiltering: boolean;
    maxAnisotropy: number;
    logarithmicDepthBuffer: boolean;
    precision: "highp" | "mediump" | "lowp";
}

// Module-level cache for GPU detection results
let cachedGPUInfo: GPUInfo | null = null;
let detectionInProgress = false;

/**
 * Detects GPU information from WebGL context with WebGL2 support
 * Results are cached to avoid repeated context creation
 */
export function detectGPU(forceRefresh = false): GPUInfo {
    // Return cached result if available and not forcing refresh
    if (cachedGPUInfo && !forceRefresh) {
        return cachedGPUInfo;
    }

    // Prevent multiple simultaneous detections
    if (detectionInProgress && !forceRefresh) {
        return cachedGPUInfo || getDefaultGPUInfo();
    }

    detectionInProgress = true;

    let vendor = "unknown";
    let renderer = "unknown";
    let isIntegratedGPU = false;
    let isHighPerformance = false;
    let supportsWebGL2 = false;
    let contextType: "webgl" | "webgl2" = "webgl";
    let maxTextureSize = 1024;
    let maxAnisotropy = 1;
    let supportedExtensions: string[] = [];

    try {
        // Create a temporary canvas to get WebGL context
        const canvas = document.createElement("canvas");

        // Try WebGL2 first
        let gl: WebGL2RenderingContext | WebGLRenderingContext | null =
            canvas.getContext("webgl2", {
                powerPreference: "high-performance",
            }) as WebGL2RenderingContext | null;

        if (gl) {
            supportsWebGL2 = true;
            contextType = "webgl2";
            // Only log once when first detected
            if (!cachedGPUInfo) {
                console.log("✅ WebGL2 context successfully created");
            }
        } else {
            // Fallback to WebGL1
            gl = (canvas.getContext("webgl", {
                powerPreference: "high-performance",
            }) ||
                canvas.getContext("experimental-webgl", {
                    powerPreference: "high-performance",
                })) as WebGLRenderingContext | null;

            if (gl) {
                contextType = "webgl";
                // Only log once when first detected
                if (!cachedGPUInfo) {
                    console.log(
                        "⚠️ WebGL1 context created (WebGL2 not available)"
                    );
                }
            }
        }

        if (gl) {
            // Get GPU information
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

            // Get technical capabilities
            maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 1024;

            // Get anisotropic filtering support
            const anisotropicExt =
                gl.getExtension("EXT_texture_filter_anisotropic") ||
                gl.getExtension("MOZ_EXT_texture_filter_anisotropic") ||
                gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");

            if (anisotropicExt) {
                maxAnisotropy =
                    gl.getParameter(
                        anisotropicExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT
                    ) || 1;
            }

            // Get all supported extensions
            supportedExtensions = gl.getSupportedExtensions() || [];

            // Clean up temporary context
            if (gl.getExtension("WEBGL_lose_context")) {
                gl.getExtension("WEBGL_lose_context").loseContext();
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
        /videocore/i,
        /intel.*graphics/i,
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
        /nvidia.*quadro/i,
        /radeon.*rx/i,
        /radeon.*pro/i,
        /radeon.*r9/i,
        /radeon.*r7/i,
        /radeon.*vega.*(?:56|64)/i, // Discrete Vega cards
        /tesla/i,
        /geforce/i,
    ];

    isHighPerformance = highPerfPatterns.some((pattern) =>
        pattern.test(rendererLower)
    );

    // Estimate performance class with more sophisticated logic
    let estimatedPerformanceClass: "low" | "medium" | "high" = "medium";

    if (isIntegratedGPU) {
        // Even integrated GPUs can be decent if they support WebGL2
        estimatedPerformanceClass = supportsWebGL2 ? "medium" : "low";

        // Apple Silicon and recent Intel Iris are better than average integrated
        if (
            /apple.*gpu/i.test(rendererLower) ||
            /intel.*iris.*plus/i.test(rendererLower)
        ) {
            estimatedPerformanceClass = "medium";
        }
    } else if (isHighPerformance) {
        estimatedPerformanceClass = "high";
    }

    // Adjust based on max texture size (indicator of GPU memory/capability)
    if (maxTextureSize >= 8192) {
        estimatedPerformanceClass =
            estimatedPerformanceClass === "low" ? "medium" : "high";
    } else if (maxTextureSize < 2048) {
        estimatedPerformanceClass = "low";
    }

    // Only log comprehensive info once when first detected or when forced
    const isFirstDetection = !cachedGPUInfo;

    // Cache the result
    cachedGPUInfo = {
        vendor,
        renderer,
        isIntegratedGPU,
        isHighPerformance,
        estimatedPerformanceClass,
        supportsWebGL2,
        contextType,
        maxTextureSize,
        maxAnisotropy,
        supportedExtensions,
    };

    detectionInProgress = false;

    if (isFirstDetection || forceRefresh) {
        console.log("🖥️ GPU Detection Complete:", {
            gpu: `${cachedGPUInfo.vendor} ${cachedGPUInfo.renderer}`,
            performance: cachedGPUInfo.estimatedPerformanceClass,
            webgl2: cachedGPUInfo.supportsWebGL2,
            maxTextureSize: cachedGPUInfo.maxTextureSize,
            integrated: cachedGPUInfo.isIntegratedGPU,
        });
    }

    return cachedGPUInfo;
}

/**
 * Returns default GPU info for fallback scenarios
 */
function getDefaultGPUInfo(): GPUInfo {
    return {
        vendor: "unknown",
        renderer: "unknown",
        isIntegratedGPU: true,
        isHighPerformance: false,
        estimatedPerformanceClass: "medium",
        supportsWebGL2: false,
        contextType: "webgl",
        maxTextureSize: 2048,
        maxAnisotropy: 1,
        supportedExtensions: [],
    };
}

/**
 * Clears the GPU detection cache and resets logging flags
 * (useful for testing or context changes)
 */
export function clearGPUCache(): void {
    cachedGPUInfo = null;
    detectionInProgress = false;
    detailedInfoLogged = false;
    settingsAppliedLogged = false;
    contextCreationLogged = false;
}

/**
 * Gets recommended settings based on GPU performance class and capabilities
 */
export function getRecommendedSettings(gpuInfo: GPUInfo): RendererSettings {
    const baseSettings: RendererSettings = {
        shadowMapSize: 2048,
        shadowMapType: "PCFShadowMap",
        viewDistance: 8, // chunks
        pixelRatio: Math.min(window.devicePixelRatio, 2),
        antialias: true,
        enablePostProcessing: false,
        maxEnvironmentObjects: 1000,
        preferredContextType: gpuInfo.supportsWebGL2 ? "webgl2" : "webgl",
        maxTextureSize: Math.min(gpuInfo.maxTextureSize, 4096), // Cap for memory safety
        enableAnisotropicFiltering: gpuInfo.maxAnisotropy > 1,
        maxAnisotropy: Math.min(gpuInfo.maxAnisotropy, 4), // Cap for performance
        logarithmicDepthBuffer: false,
        precision: "highp",
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
                maxTextureSize: Math.min(gpuInfo.maxTextureSize, 2048),
                enableAnisotropicFiltering: false,
                maxAnisotropy: 1,
                precision: "mediump",
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
                maxTextureSize: Math.min(gpuInfo.maxTextureSize, 8192),
                enableAnisotropicFiltering: true,
                maxAnisotropy: Math.min(gpuInfo.maxAnisotropy, 8),
                logarithmicDepthBuffer: gpuInfo.supportsWebGL2, // Only enable for WebGL2
                precision: "highp",
            };

        default: // medium
            return baseSettings;
    }
}

/**
 * Gets optimal WebGL context attributes based on GPU capabilities
 */
export function getOptimalContextAttributes(
    gpuInfo: GPUInfo
): WebGLContextAttributes {
    const settings = getRecommendedSettings(gpuInfo);

    return {
        powerPreference: "high-performance" as WebGLPowerPreference,
        antialias: settings.antialias,
        alpha: false,
        depth: true,
        stencil: false,
        // Enable readback for thumbnail capture (Project Home previews)
        preserveDrawingBuffer: true,
        premultipliedAlpha: true,
        failIfMajorPerformanceCaveat: false,
        desynchronized: gpuInfo.supportsWebGL2, // Only for WebGL2
        xrCompatible: false, // Disable unless VR is needed
    };
}

// Track whether GPU settings have been applied and logged
let settingsAppliedLogged = false;

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

    // Configure shadow mapping
    if (renderer.shadowMap) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.autoUpdate = false; // Manual control for performance
        renderer.shadowMap.needsUpdate = true;

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

    // Configure additional renderer settings
    renderer.sortObjects = true; // Better transparency handling
    renderer.outputColorSpace = "srgb"; // Ensure proper color space

    // Memory management optimizations
    renderer.info.autoReset = false; // Manual control

    // Store settings for other components to use
    renderer.userData = renderer.userData || {};
    renderer.userData.gpuOptimizedSettings = settings;
    renderer.userData.gpuInfo = gpuInfo;

    // Only log settings application once to avoid spam
    if (!settingsAppliedLogged) {
        console.log(
            `✅ Applied GPU-optimized settings for ${gpuInfo.estimatedPerformanceClass} performance GPU:`,
            {
                gpu: `${gpuInfo.vendor} ${gpuInfo.renderer}`,
                contextType: gpuInfo.contextType,
                maxTextureSize: gpuInfo.maxTextureSize,
                maxAnisotropy: gpuInfo.maxAnisotropy,
                supportsWebGL2: gpuInfo.supportsWebGL2,
                settings,
            }
        );
        settingsAppliedLogged = true;
    }

    return settings;
}

// Track whether detailed GPU info has been logged
let detailedInfoLogged = false;

/**
 * Logs comprehensive GPU information for debugging
 * Only logs detailed info once to avoid spam
 */
export function logGPUInfo(force = false): GPUInfo {
    const gpuInfo = detectGPU();
    const settings = getRecommendedSettings(gpuInfo);

    // Only log detailed info once or when forced
    if (force || !detailedInfoLogged) {
        console.group("🖥️ GPU Detection Results");
        console.log("Hardware:", {
            vendor: gpuInfo.vendor,
            renderer: gpuInfo.renderer,
            isIntegratedGPU: gpuInfo.isIntegratedGPU,
            isHighPerformance: gpuInfo.isHighPerformance,
            performanceClass: gpuInfo.estimatedPerformanceClass,
        });

        console.log("WebGL Capabilities:", {
            supportsWebGL2: gpuInfo.supportsWebGL2,
            contextType: gpuInfo.contextType,
            maxTextureSize: gpuInfo.maxTextureSize,
            maxAnisotropy: gpuInfo.maxAnisotropy,
            supportedExtensions: gpuInfo.supportedExtensions.length,
        });

        console.log("Optimized Settings:", settings);
        console.groupEnd();

        detailedInfoLogged = true;
    }

    return gpuInfo;
}

// Track whether context creation has been logged
let contextCreationLogged = false;

/**
 * Creates an optimized WebGL context with fallback handling
 */
export function createOptimizedContext(
    canvas: HTMLCanvasElement,
    gpuInfo?: GPUInfo
): WebGL2RenderingContext | WebGLRenderingContext | null {
    if (!gpuInfo) {
        gpuInfo = detectGPU();
    }

    const contextAttribs = getOptimalContextAttributes(gpuInfo);

    // Try WebGL2 first if supported
    if (gpuInfo.supportsWebGL2) {
        const gl2 = canvas.getContext(
            "webgl2",
            contextAttribs
        ) as WebGL2RenderingContext | null;
        if (gl2) {
            // Only log context creation once to avoid spam
            if (!contextCreationLogged) {
                console.log("✅ Optimized WebGL2 context created successfully");
                contextCreationLogged = true;
            }
            return gl2;
        }
    }

    // Fallback to WebGL1
    const gl = (canvas.getContext("webgl", contextAttribs) ||
        canvas.getContext(
            "experimental-webgl",
            contextAttribs
        )) as WebGLRenderingContext | null;

    if (gl) {
        // Only log context creation once to avoid spam
        if (!contextCreationLogged) {
            console.log(
                "⚠️ Optimized WebGL1 context created (WebGL2 not available)"
            );
            contextCreationLogged = true;
        }
        return gl;
    }

    console.error("❌ Failed to create WebGL context");
    return null;
}
