import React, { useState, useEffect, useCallback } from "react";
import { FaDownload, FaTrash, FaTimes, FaFilter } from "react-icons/fa";
import { DatabaseManager, STORES } from "../managers/DatabaseManager";
import ProjectSidebar from "./ProjectSidebar";

interface Screenshot {
    id: string;
    projectId: string;
    dataUrl: string;
    timestamp: number;
    thumbnailUrl: string;
    name?: string;
}

interface Project {
    id: string;
    name: string;
}

export default function ScreenshotGalleryPage() {
    const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProject, setSelectedProject] = useState<string>("all");
    const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeNav, setActiveNav] = useState("screenshots");
    const [hoverNav, setHoverNav] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            // Load all projects
            const projectList = await DatabaseManager.listProjects();
            const projectsOnly = projectList.filter((p: any) => p.type !== 'folder');
            setProjects(projectsOnly);

            // Load all screenshots from all projects
            const allScreenshots: Screenshot[] = [];

            for (const project of projectsOnly) {
                const prefix = `${project.id}::screenshot::`;
                const projectScreenshots = await DatabaseManager.getAllDataWithPrefix(STORES.SCREENSHOTS, prefix);
                allScreenshots.push(...projectScreenshots);
            }

            // Sort by timestamp descending (newest first)
            allScreenshots.sort((a, b) => b.timestamp - a.timestamp);
            setScreenshots(allScreenshots);
        } catch (error) {
            console.error("Error loading screenshots:", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const filteredScreenshots = selectedProject === "all"
        ? screenshots
        : screenshots.filter(s => s.projectId === selectedProject);

    const getProjectName = (projectId: string) => {
        const project = projects.find(p => p.id === projectId);
        return project?.name || "Unknown Project";
    };

    const handleDownload = (screenshot: Screenshot) => {
        const link = document.createElement("a");
        link.href = screenshot.dataUrl;
        const projectName = getProjectName(screenshot.projectId).replace(/[^a-z0-9]/gi, '-');
        link.download = `${projectName}-${new Date(screenshot.timestamp).toISOString().slice(0, 19).replace(/[T:]/g, "-")}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleDelete = async (screenshot: Screenshot) => {
        if (!window.confirm("Delete this screenshot?")) return;

        try {
            const key = `${screenshot.projectId}::screenshot::${screenshot.id}`;
            await DatabaseManager.deleteData(STORES.SCREENSHOTS, key);
            setScreenshots((prev) => prev.filter((s) => s.id !== screenshot.id));
            if (selectedScreenshot?.id === screenshot.id) {
                setSelectedScreenshot(null);
            }
        } catch (error) {
            console.error("Error deleting screenshot:", error);
        }
    };

    const formatTimestamp = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    return (
        <div className="fixed inset-0 grid [grid-template-columns:280px_1fr] bg-[#0b0e12] text-[#eaeaea]">
            {/* Sidebar */}
            <ProjectSidebar
                activeNav={activeNav}
                setActiveNav={setActiveNav}
                hoverNav={hoverNav}
                setHoverNav={setHoverNav}
            />

            {/* Main area */}
            <main className="flex flex-col p-5 gap-4 overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <h1 className="text-2xl font-semibold text-white">Screenshots</h1>

                    {/* Project Filter */}
                    <div className="flex items-center gap-2">
                        <FaFilter className="text-white/50" />
                        <select
                            value={selectedProject}
                            onChange={(e) => setSelectedProject(e.target.value)}
                            className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-white/40"
                        >
                            <option value="all">All Projects</option>
                            {projects.map((project) => (
                                <option key={project.id} value={project.id}>
                                    {project.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Content */}
                {loading ? (
                    <div className="flex items-center justify-center py-20 text-white/50">
                        Loading screenshots...
                    </div>
                ) : filteredScreenshots.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-white/50">
                        <svg viewBox="0 0 24 24" className="w-16 h-16 stroke-white/30 fill-none stroke-[1.5] mb-4">
                            <rect x="3" y="5" width="18" height="14" rx="2" />
                            <circle cx="12" cy="12" r="3" />
                            <path d="M3 8h2M19 8h2" />
                        </svg>
                        <p className="text-lg">No screenshots yet</p>
                        <p className="text-sm mt-1">Take screenshots in your projects to see them here</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {filteredScreenshots.map((screenshot) => (
                            <div
                                key={screenshot.id}
                                className="relative group rounded-lg overflow-hidden bg-white/5 border border-white/10 hover:border-white/30 transition-all cursor-pointer"
                                onClick={() => setSelectedScreenshot(screenshot)}
                            >
                                <div className="aspect-video">
                                    <img
                                        src={screenshot.thumbnailUrl}
                                        alt={`Screenshot from ${getProjectName(screenshot.projectId)}`}
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                <div className="absolute bottom-0 left-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <p className="text-white text-sm font-medium truncate">
                                        {getProjectName(screenshot.projectId)}
                                    </p>
                                    <p className="text-white/60 text-xs">
                                        {formatTimestamp(screenshot.timestamp)}
                                    </p>
                                </div>
                                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDownload(screenshot);
                                        }}
                                        className="p-1.5 rounded bg-black/60 hover:bg-black/80 text-white transition-colors"
                                        title="Download"
                                    >
                                        <FaDownload size={12} />
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDelete(screenshot);
                                        }}
                                        className="p-1.5 rounded bg-black/60 hover:bg-red-600 text-white transition-colors"
                                        title="Delete"
                                    >
                                        <FaTrash size={12} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Full-size Modal */}
                {selectedScreenshot && (
                    <div
                        className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4"
                        onClick={() => setSelectedScreenshot(null)}
                    >
                        <div
                            className="relative max-w-[90vw] max-h-[90vh] rounded-lg overflow-hidden"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <img
                                src={selectedScreenshot.dataUrl}
                                alt="Full size screenshot"
                                className="max-w-full max-h-[85vh] object-contain"
                            />
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
                                    onClick={() => setSelectedScreenshot(null)}
                                    className="p-2 rounded-md bg-black/60 hover:bg-black/80 text-white transition-colors"
                                    title="Close"
                                >
                                    <FaTimes />
                                </button>
                            </div>
                            <div className="absolute bottom-2 left-2 bg-black/60 px-3 py-2 rounded">
                                <p className="text-white text-sm font-medium">
                                    {getProjectName(selectedScreenshot.projectId)}
                                </p>
                                <p className="text-white/70 text-xs">
                                    {formatTimestamp(selectedScreenshot.timestamp)}
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
