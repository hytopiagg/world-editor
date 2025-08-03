/**
 * Simple performance profiler for identifying bottlenecks
 * Usage: 
 * - PerformanceProfiler.start('operation-name')
 * - PerformanceProfiler.end('operation-name') 
 * - PerformanceProfiler.report() // Shows all timing data
 */
class PerformanceProfiler {
    constructor() {
        this.timings = new Map();
        this.operations = new Map();
        this.enabled = true;
    }

    /**
     * Start timing an operation
     * @param {string} name - Operation name
     */
    start(name) {
        if (!this.enabled) return;
        
        this.operations.set(name, {
            startTime: performance.now(),
            startMemory: this._getMemoryUsage()
        });
    }

    /**
     * End timing an operation
     * @param {string} name - Operation name
     */
    end(name) {
        if (!this.enabled) return;
        
        const operation = this.operations.get(name);
        if (!operation) {
            console.warn(`No start timing found for operation: ${name}`);
            return;
        }

        const endTime = performance.now();
        const duration = endTime - operation.startTime;
        const endMemory = this._getMemoryUsage();
        const memoryDiff = endMemory - operation.startMemory;

        // Store timing data
        if (!this.timings.has(name)) {
            this.timings.set(name, []);
        }
        
        this.timings.get(name).push({
            duration,
            memoryDiff,
            timestamp: new Date().toISOString()
        });

        // Log immediately for visibility
        const emoji = this._getEmojiForDuration(duration);
        console.log(`${emoji} ${name}: ${Math.round(duration)}ms (memory: ${this._formatMemory(memoryDiff)})`);

        this.operations.delete(name);
    }

    /**
     * Get current memory usage (if available)
     * @returns {number} Memory usage in MB
     */
    _getMemoryUsage() {
        if (performance.memory) {
            return performance.memory.usedJSHeapSize / 1024 / 1024; // Convert to MB
        }
        return 0;
    }

    /**
     * Format memory usage for display
     * @param {number} memoryMB - Memory in MB
     * @returns {string} Formatted memory string
     */
    _formatMemory(memoryMB) {
        if (memoryMB === 0) return "n/a";
        return memoryMB > 0 ? `+${memoryMB.toFixed(2)}MB` : `${memoryMB.toFixed(2)}MB`;
    }

    /**
     * Get emoji based on operation duration
     * @param {number} duration - Duration in milliseconds
     * @returns {string} Appropriate emoji
     */
    _getEmojiForDuration(duration) {
        if (duration < 10) return "⚡"; // Very fast
        if (duration < 50) return "🚀"; // Fast
        if (duration < 200) return "⏱️"; // Moderate
        if (duration < 1000) return "🐌"; // Slow
        return "🔥"; // Very slow
    }

    /**
     * Generate a comprehensive performance report
     */
    report() {
        if (this.timings.size === 0) {
            console.log("📊 No performance data collected");
            return;
        }

        console.log("\n📊 PERFORMANCE REPORT");
        console.log("=" .repeat(50));

        const sortedOperations = Array.from(this.timings.entries())
            .map(([name, measurements]) => {
                const durations = measurements.map(m => m.duration);
                const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
                const maxDuration = Math.max(...durations);
                const minDuration = Math.min(...durations);
                const totalDuration = durations.reduce((a, b) => a + b, 0);
                
                return {
                    name,
                    count: measurements.length,
                    avgDuration: Math.round(avgDuration),
                    maxDuration: Math.round(maxDuration),
                    minDuration: Math.round(minDuration),
                    totalDuration: Math.round(totalDuration)
                };
            })
            .sort((a, b) => b.totalDuration - a.totalDuration); // Sort by total time

        sortedOperations.forEach((op, index) => {
            const emoji = this._getEmojiForDuration(op.avgDuration);
            console.log(`${index + 1}. ${emoji} ${op.name}`);
            console.log(`   • Calls: ${op.count}`);
            console.log(`   • Total: ${op.totalDuration}ms`);
            console.log(`   • Average: ${op.avgDuration}ms`);
            console.log(`   • Range: ${op.minDuration}ms - ${op.maxDuration}ms`);
            console.log("");
        });

        const totalTime = sortedOperations.reduce((sum, op) => sum + op.totalDuration, 0);
        console.log(`🕐 Total measured time: ${Math.round(totalTime)}ms`);
        console.log("=" .repeat(50));
    }

    /**
     * Clear all timing data
     */
    clear() {
        this.timings.clear();
        this.operations.clear();
        console.log("🧹 Performance data cleared");
    }

    /**
     * Enable or disable profiling
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        console.log(`📊 Performance profiling ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Time a function execution
     * @param {string} name - Operation name
     * @param {Function} fn - Function to time
     * @returns {any} Function result
     */
    async time(name, fn) {
        this.start(name);
        try {
            const result = await fn();
            this.end(name);
            return result;
        } catch (error) {
            this.end(name);
            throw error;
        }
    }
}

// Create singleton instance
const performanceProfiler = new PerformanceProfiler();

// Make available globally for debugging
if (typeof window !== 'undefined') {
    window.PerformanceProfiler = performanceProfiler;
    window.profileReport = () => performanceProfiler.report();
    window.profileClear = () => performanceProfiler.clear();
}

export default performanceProfiler;