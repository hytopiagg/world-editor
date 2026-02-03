import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { FaCamera, FaDownload, FaTrash, FaTimes, FaExpand, FaChevronLeft, FaChevronRight, FaTh } from "react-icons/fa";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";

interface Screenshot {
    id: string;
    projectId: string;
    dataUrl: string;
    timestamp: number;
    thumbnailUrl: string;
    name?: string;
}

interface ScreenshotGallerySectionProps {
    isCompactMode: boolean;
    onTakeScreenshot: () => Promise<void>;
}

export default function ScreenshotGallerySection({
    isCompactMode,
    onTakeScreenshot,
}: ScreenshotGallerySectionProps) {
    const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [isCapturing, setIsCapturing] = useState(false);
    const [galleryOpen, setGalleryOpen] = useState(false);

    const selectedScreenshot = selectedIndex !== null ? screenshots[selectedIndex] : null;

    const loadScreenshots = useCallback(async () => {
        try {
            const projectId = DatabaseManager.getCurrentProjectId();
            if (!projectId) return;

            const prefix = `${projectId}::screenshot::`;
            const results = await DatabaseManager.getAllDataWithPrefix(STORES.SCREENSHOTS, prefix);

            // Sort by timestamp descending (newest first)
            const sorted = results.sort((a, b) => b.timestamp - a.timestamp);
            setScreenshots(sorted);
        } catch (error) {
            console.error("Error loading screenshots:", error);
        }
    }, []);

    useEffect(() => {
        loadScreenshots();

        // Listen for new screenshots
        const handleScreenshotTaken = () => {
            loadScreenshots();
        };
        window.addEventListener("screenshot-taken", handleScreenshotTaken);

        return () => {
            window.removeEventListener("screenshot-taken", handleScreenshotTaken);
        };
    }, [loadScreenshots]);

    // Keyboard navigation for modals
    useEffect(() => {
        if (selectedIndex === null && !galleryOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (selectedIndex !== null) {
                    setSelectedIndex(null);
                } else if (galleryOpen) {
                    setGalleryOpen(false);
                }
                return;
            }
            if (selectedIndex !== null) {
                if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    goToPrev();
                } else if (e.key === "ArrowRight") {
                    e.preventDefault();
                    goToNext();
                }
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedIndex, galleryOpen, screenshots.length]);

    const goToPrev = () => setSelectedIndex((i) => (i !== null && i > 0 ? i - 1 : i));
    const goToNext = () => setSelectedIndex((i) => (i !== null && i < screenshots.length - 1 ? i + 1 : i));

    const handleTakeScreenshot = async () => {
        if (isCapturing) return;
        setIsCapturing(true);
        try {
            await onTakeScreenshot();
        } finally {
            setIsCapturing(false);
        }
    };

    const handleDownload = (screenshot: Screenshot) => {
        const link = document.createElement("a");
        link.href = screenshot.dataUrl;
        link.download = `screenshot-${new Date(screenshot.timestamp).toISOString().slice(0, 19).replace(/[T:]/g, "-")}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleDelete = async (screenshot: Screenshot) => {
        if (!window.confirm("Delete this screenshot?")) return;

        try {
            const key = `${screenshot.projectId}::screenshot::${screenshot.id}`;
            await DatabaseManager.deleteData(STORES.SCREENSHOTS, key);

            setScreenshots((prev) => {
                const newList = prev.filter((s) => s.id !== screenshot.id);

                // Adjust selectedIndex if deleting from modal
                if (selectedIndex !== null) {
                    if (newList.length === 0) {
                        setSelectedIndex(null);
                    } else if (selectedIndex >= newList.length) {
                        setSelectedIndex(newList.length - 1);
                    }
                }

                return newList;
            });
        } catch (error) {
            console.error("Error deleting screenshot:", error);
        }
    };

    const handleDownloadAll = async () => {
        for (let i = 0; i < screenshots.length; i++) {
            handleDownload(screenshots[i]);
            // Small delay to avoid browser blocking multiple downloads
            if (i < screenshots.length - 1) {
                await new Promise((res) => setTimeout(res, 300));
            }
        }
    };

    const handleDeleteAll = async () => {
        if (!window.confirm(`Delete all ${screenshots.length} screenshots?`)) return;

        try {
            for (const screenshot of screenshots) {
                const key = `${screenshot.projectId}::screenshot::${screenshot.id}`;
                await DatabaseManager.deleteData(STORES.SCREENSHOTS, key);
            }
            setScreenshots([]);
            setSelectedIndex(null);
        } catch (error) {
            console.error("Error deleting all screenshots:", error);
        }
    };

    const formatTimestamp = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    return (
        <div className="flex flex-col gap-3">
            {/* Take Screenshot Button */}
            <button
                onClick={handleTakeScreenshot}
                disabled={isCapturing}
                className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
            >
                <FaCamera className={isCapturing ? "animate-pulse" : ""} />
                {isCapturing ? "Capturing..." : "Take Screenshot"}
            </button>

            {/* Bulk Action Buttons */}
            {screenshots.length > 0 && (
                <div className="flex gap-2">
                    <button
                        onClick={() => setGalleryOpen(true)}
                        title="Gallery view"
                        className="flex items-center justify-center w-8 h-8 aspect-square rounded-md bg-white/10 hover:bg-white/20 text-white text-xs transition-colors"
                    >
                        <FaTh />
                    </button>
                    <button
                        onClick={handleDownloadAll}
                        title="Download all"
                        className="flex items-center justify-center w-8 h-8 aspect-square rounded-md bg-white/10 hover:bg-white/20 text-white text-xs transition-colors"
                    >
                        <FaDownload />
                    </button>
                    <button
                        onClick={handleDeleteAll}
                        title="Delete all"
                        className="flex items-center justify-center w-8 h-8 aspect-square rounded-md bg-white/10 hover:bg-red-600/80 text-white text-xs transition-colors"
                    >
                        <FaTrash />
                    </button>
                </div>
            )}

            {/* Screenshots Grid */}
            {screenshots.length > 0 ? (
                <div className={`grid ${isCompactMode ? "grid-cols-2" : "grid-cols-3"} gap-2`}>
                    {screenshots.map((screenshot, index) => (
                        <div
                            key={screenshot.id}
                            className="relative group aspect-video rounded-md overflow-hidden cursor-pointer bg-white/5 border border-white/10 hover:border-white/30 transition-all"
                            onClick={() => setSelectedIndex(index)}
                        >
                            <img
                                src={screenshot.thumbnailUrl}
                                alt={`Screenshot from ${formatTimestamp(screenshot.timestamp)}`}
                                className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                                <FaExpand className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <span className="text-[10px] text-white/80">
                                    {formatTimestamp(screenshot.timestamp)}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-xs text-white/50 text-center py-4">
                    No screenshots yet. Take one to get started!
                </div>
            )}

            {/* Gallery Grid Modal - portaled to body */}
            {galleryOpen && createPortal(
                <div
                    className="fixed inset-0 z-[9999] bg-black/90 flex flex-col"
                    onClick={() => setGalleryOpen(false)}
                >
                    <div className="flex justify-end p-4">
                        <button
                            onClick={() => setGalleryOpen(false)}
                            className="p-2 rounded-md bg-black/60 hover:bg-black/80 text-white transition-colors"
                            title="Close"
                        >
                            <FaTimes />
                        </button>
                    </div>
                    <div
                        className="flex-1 overflow-y-auto px-4 pb-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                            {screenshots.map((screenshot, index) => (
                                <div
                                    key={screenshot.id}
                                    className="relative aspect-video rounded-md overflow-hidden cursor-pointer bg-white/5 border border-white/10 hover:border-white/40 transition-all"
                                    onClick={() => {
                                        setGalleryOpen(false);
                                        setSelectedIndex(index);
                                    }}
                                >
                                    <img
                                        src={screenshot.thumbnailUrl}
                                        alt={`Screenshot from ${formatTimestamp(screenshot.timestamp)}`}
                                        className="w-full h-full object-cover"
                                    />
                                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-1">
                                        <span className="text-[10px] text-white/80">
                                            {formatTimestamp(screenshot.timestamp)}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Full-size Modal with Cycling - portaled to body to escape sidebar stacking context */}
            {selectedScreenshot && selectedIndex !== null && createPortal(
                <div
                    className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4"
                    onClick={() => setSelectedIndex(null)}
                >
                    <div
                        className="relative max-w-[90vw] max-h-[90vh] rounded-lg overflow-hidden flex items-center"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Previous arrow */}
                        {selectedIndex > 0 && (
                            <button
                                onClick={goToPrev}
                                className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors"
                                title="Previous"
                            >
                                <FaChevronLeft />
                            </button>
                        )}

                        <img
                            src={selectedScreenshot.dataUrl}
                            alt="Full size screenshot"
                            className="max-w-full max-h-[85vh] object-contain"
                        />

                        {/* Next arrow */}
                        {selectedIndex < screenshots.length - 1 && (
                            <button
                                onClick={goToNext}
                                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors"
                                title="Next"
                            >
                                <FaChevronRight />
                            </button>
                        )}

                        {/* Top-right action buttons */}
                        <div className="absolute top-2 right-2 flex gap-2">
                            <button
                                onClick={() => handleDownload(selectedScreenshot)}
                                className="p-2 rounded-md bg-black/60 hover:bg-black/80 text-white transition-colors"
                                title="Download"
                            >
                                <FaDownload />
                            </button>
                            <button
                                onClick={() => handleDelete(selectedScreenshot)}
                                className="p-2 rounded-md bg-black/60 hover:bg-red-600 text-white transition-colors"
                                title="Delete"
                            >
                                <FaTrash />
                            </button>
                            <button
                                onClick={() => setSelectedIndex(null)}
                                className="p-2 rounded-md bg-black/60 hover:bg-black/80 text-white transition-colors"
                                title="Close"
                            >
                                <FaTimes />
                            </button>
                        </div>

                        {/* Bottom info bar: timestamp + counter */}
                        <div className="absolute bottom-2 left-0 right-0 flex items-center justify-between px-2">
                            <div className="text-white/70 text-sm bg-black/60 px-2 py-1 rounded">
                                {formatTimestamp(selectedScreenshot.timestamp)}
                            </div>
                            <div className="text-white/70 text-sm bg-black/60 px-2 py-1 rounded">
                                {selectedIndex + 1} / {screenshots.length}
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
