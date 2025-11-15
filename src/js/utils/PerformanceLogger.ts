/**
 * Performance Logger
 * Provides timestamped logging for performance analysis and bottleneck identification
 */

class PerformanceLogger {
    private startTime: number;
    public markers: Map<string, number>; // Made public for checking in rebuildTextureAtlas
    private phases: Array<{ name: string; start: number; end?: number; duration?: number }>;
    private enabled: boolean;
    private loggedCheckpoints: Set<string>; // Track checkpoints to avoid duplicates

    constructor() {
        this.startTime = performance.now();
        this.markers = new Map();
        this.phases = [];
        this.enabled = true;
        this.loggedCheckpoints = new Set();
    }

    /**
     * Enable or disable logging
     */
    setEnabled(enabled: boolean) {
        this.enabled = enabled;
    }

    /**
     * Mark the start of a phase
     */
    markStart(phaseName: string, details?: Record<string, any>) {
        if (!this.enabled) return;
        
        const now = performance.now();
        const elapsed = now - this.startTime;
        this.markers.set(phaseName, now);
        
        const phase = {
            name: phaseName,
            start: now,
        };
        this.phases.push(phase);
        
        const detailsStr = details ? ` ${JSON.stringify(details)}` : '';
        console.log(
            `[PERF] ⏱️  START: ${phaseName}${detailsStr} | Time: ${elapsed.toFixed(2)}ms`
        );
    }

    /**
     * Mark the end of a phase
     */
    markEnd(phaseName: string, details?: Record<string, any>) {
        if (!this.enabled) return;
        
        const startTime = this.markers.get(phaseName);
        if (!startTime) {
            console.warn(`[PERF] ⚠️  No start marker found for: ${phaseName}`);
            return;
        }
        
        const now = performance.now();
        const duration = now - startTime;
        const elapsed = now - this.startTime;
        
        const phase = this.phases.find(p => p.name === phaseName && !p.end);
        if (phase) {
            phase.end = now;
            phase.duration = duration;
        }
        
        const detailsStr = details ? ` ${JSON.stringify(details)}` : '';
        console.log(
            `[PERF] ✅ END: ${phaseName}${detailsStr} | Duration: ${duration.toFixed(2)}ms | Total: ${elapsed.toFixed(2)}ms`
        );
        
        this.markers.delete(phaseName);
    }

    /**
     * Log a checkpoint (no start/end tracking)
     * Only logs once per unique message to avoid duplicates from React StrictMode
     */
    checkpoint(message: string, details?: Record<string, any>) {
        if (!this.enabled) return;
        
        // Skip if we've already logged this checkpoint
        if (this.loggedCheckpoints.has(message)) {
            return;
        }
        this.loggedCheckpoints.add(message);
        
        const now = performance.now();
        const elapsed = now - this.startTime;
        const detailsStr = details ? ` ${JSON.stringify(details)}` : '';
        
        console.log(
            `[PERF] 📍 CHECKPOINT: ${message}${detailsStr} | Time: ${elapsed.toFixed(2)}ms`
        );
    }

    /**
     * Get summary of all phases
     */
    getSummary(): Array<{ name: string; duration: number; start: number; end?: number }> {
        return this.phases
            .filter(p => p.duration !== undefined)
            .map(p => ({
                name: p.name,
                duration: p.duration!,
                start: p.start,
                end: p.end,
            }))
            .sort((a, b) => b.duration - a.duration);
    }

    /**
     * Print performance summary
     */
    printSummary() {
        if (!this.enabled) return;
        
        const summary = this.getSummary();
        const totalTime = performance.now() - this.startTime;
        
        console.group(`[PERF] 📊 Performance Summary (Total: ${totalTime.toFixed(2)}ms)`);
        
        if (summary.length === 0) {
            console.log('No completed phases to report');
        } else {
            console.table(
                summary.map(p => ({
                    Phase: p.name,
                    Duration: `${p.duration.toFixed(2)}ms`,
                    'Percentage': `${((p.duration / totalTime) * 100).toFixed(1)}%`,
                }))
            );
            
            console.log('\nTop bottlenecks:');
            summary.slice(0, 5).forEach((p, i) => {
                console.log(
                    `  ${i + 1}. ${p.name}: ${p.duration.toFixed(2)}ms (${((p.duration / totalTime) * 100).toFixed(1)}%)`
                );
            });
        }
        
        console.groupEnd();
    }

    /**
     * Reset the logger
     */
    reset() {
        this.startTime = performance.now();
        this.markers.clear();
        this.phases = [];
        this.loggedCheckpoints.clear();
    }
}

// Export singleton instance
export const performanceLogger = new PerformanceLogger();

// Also expose on window for debugging
if (typeof window !== 'undefined') {
    (window as any).performanceLogger = performanceLogger;
}

