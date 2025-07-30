/**
 * Performance monitoring utility for tracking material usage and rendering performance
 */
export class PerformanceMonitor {
    private static _instance: PerformanceMonitor | null = null;
    private metrics: any = {};
    private startTime: number = 0;
    private frameCount: number = 0;
    private lastFrameTime: number = 0;
    private isMonitoring: boolean = false;
    private materialStats: Map<string, number> = new Map();
    private drawCallCount: number = 0;
    private textureMemoryUsage: number = 0;
    private geometryMemoryUsage: number = 0;

    private constructor() {
        this.reset();
    }

    static get instance(): PerformanceMonitor {
        if (!PerformanceMonitor._instance) {
            PerformanceMonitor._instance = new PerformanceMonitor();
        }
        return PerformanceMonitor._instance;
    }

    /**
     * Start monitoring performance
     */
    startMonitoring(): void {
        this.isMonitoring = true;
        this.startTime = performance.now();
        this.frameCount = 0;
        this.lastFrameTime = this.startTime;
        console.log("🚀 Performance monitoring started");
    }

    /**
     * Stop monitoring performance
     */
    stopMonitoring(): void {
        this.isMonitoring = false;
        const duration = performance.now() - this.startTime;
        const avgFPS = this.frameCount / (duration / 1000);

        console.log("📊 Performance monitoring stopped");
        console.log(`⏱️  Duration: ${duration.toFixed(2)}ms`);
        console.log(`🎯 Average FPS: ${avgFPS.toFixed(2)}`);
        console.log(`📐 Total frames: ${this.frameCount}`);
        console.log(
            `🎨 Material usage:`,
            Object.fromEntries(this.materialStats)
        );
        console.log(`📊 Draw calls: ${this.drawCallCount}`);
        console.log(
            `🖼️  Texture memory: ${(
                this.textureMemoryUsage /
                1024 /
                1024
            ).toFixed(2)}MB`
        );
        console.log(
            `📐 Geometry memory: ${(
                this.geometryMemoryUsage /
                1024 /
                1024
            ).toFixed(2)}MB`
        );
    }

    /**
     * Update frame statistics
     */
    updateFrame(): void {
        if (!this.isMonitoring) return;

        const currentTime = performance.now();
        const deltaTime = currentTime - this.lastFrameTime;

        this.frameCount++;
        this.lastFrameTime = currentTime;

        // Update metrics
        this.metrics.currentFPS = 1000 / deltaTime;
        this.metrics.averageFPS =
            this.frameCount / ((currentTime - this.startTime) / 1000);
        this.metrics.frameTime = deltaTime;
        this.metrics.totalFrames = this.frameCount;
    }

    /**
     * Track material usage
     */
    trackMaterialUsage(materialType: string, count: number = 1): void {
        if (!this.isMonitoring) return;

        const currentCount = this.materialStats.get(materialType) || 0;
        this.materialStats.set(materialType, currentCount + count);
    }

    /**
     * Track draw calls
     */
    trackDrawCall(): void {
        if (!this.isMonitoring) return;
        this.drawCallCount++;
    }

    /**
     * Track texture memory usage
     */
    trackTextureMemory(bytes: number): void {
        if (!this.isMonitoring) return;
        this.textureMemoryUsage += bytes;
    }

    /**
     * Track geometry memory usage
     */
    trackGeometryMemory(bytes: number): void {
        if (!this.isMonitoring) return;
        this.geometryMemoryUsage += bytes;
    }

    /**
     * Get current metrics
     */
    getMetrics(): any {
        return {
            ...this.metrics,
            materialStats: Object.fromEntries(this.materialStats),
            drawCallCount: this.drawCallCount,
            textureMemoryUsage: this.textureMemoryUsage,
            geometryMemoryUsage: this.geometryMemoryUsage,
        };
    }

    /**
     * Reset all metrics
     */
    reset(): void {
        this.metrics = {
            currentFPS: 0,
            averageFPS: 0,
            frameTime: 0,
            totalFrames: 0,
        };
        this.materialStats.clear();
        this.drawCallCount = 0;
        this.textureMemoryUsage = 0;
        this.geometryMemoryUsage = 0;
        this.frameCount = 0;
        this.startTime = 0;
        this.lastFrameTime = 0;
    }

    /**
     * Log current performance status
     */
    logStatus(): void {
        if (!this.isMonitoring) return;

        const metrics = this.getMetrics();
        console.log("📊 Performance Status:", {
            FPS: metrics.currentFPS.toFixed(2),
            avgFPS: metrics.averageFPS.toFixed(2),
            frameTime: metrics.frameTime.toFixed(2) + "ms",
            drawCalls: metrics.drawCallCount,
            textureMem:
                (metrics.textureMemoryUsage / 1024 / 1024).toFixed(2) + "MB",
            geometryMem:
                (metrics.geometryMemoryUsage / 1024 / 1024).toFixed(2) + "MB",
        });
    }

    /**
     * Create a performance comparison report
     */
    createComparisonReport(beforeMetrics: any, afterMetrics: any): string {
        const fpsImprovement = (
            ((afterMetrics.averageFPS - beforeMetrics.averageFPS) /
                beforeMetrics.averageFPS) *
            100
        ).toFixed(2);
        const frameTimeImprovement = (
            ((beforeMetrics.frameTime - afterMetrics.frameTime) /
                beforeMetrics.frameTime) *
            100
        ).toFixed(2);
        const drawCallReduction =
            beforeMetrics.drawCallCount - afterMetrics.drawCallCount;
        const memoryReduction =
            beforeMetrics.textureMemoryUsage +
            beforeMetrics.geometryMemoryUsage -
            (afterMetrics.textureMemoryUsage +
                afterMetrics.geometryMemoryUsage);

        return `
🚀 Performance Optimization Report
==================================

📈 FPS Improvement: ${fpsImprovement}% (${beforeMetrics.averageFPS.toFixed(
            2
        )} → ${afterMetrics.averageFPS.toFixed(2)})
⚡ Frame Time Improvement: ${frameTimeImprovement}% (${beforeMetrics.frameTime.toFixed(
            2
        )}ms → ${afterMetrics.frameTime.toFixed(2)}ms)
🎯 Draw Call Reduction: ${drawCallReduction} calls
💾 Memory Reduction: ${(memoryReduction / 1024 / 1024).toFixed(2)}MB

📊 Material Usage:
Before: ${JSON.stringify(beforeMetrics.materialStats, null, 2)}
After: ${JSON.stringify(afterMetrics.materialStats, null, 2)}
        `;
    }
}
