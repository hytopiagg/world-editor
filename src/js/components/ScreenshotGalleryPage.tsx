import React, { useState, useEffect, useCallback } from "react";
import { Download, Trash2, X, SlidersHorizontal, Camera } from "lucide-react";
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
    const [activeNav] = useState("screenshots");
    const setActiveNav = (nav: string) => { window.location.hash = nav; };
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
                    <h1 className="text-[16px] font-semibold text-white/90">Screenshots</h1>

                    {/* Project Filter */}
                    <div className="flex items-center gap-2">
                        <SlidersHorizontal size={15} className="text-white/40" />
                        <select
                            value={selectedProject}
                            onChange={(e) => setSelectedProject(e.target.value)}
                            className="bg-white/[0.06] border border-white/10 focus:border-white/20 rounded-xl px-3 py-2 text-white text-[13px] focus:outline-none transition-colors duration-200"
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
                    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] flex flex-col items-center justify-center py-12 px-6">
                        <div className="w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center mb-3">
                            <Camera size={24} className="text-white/20" />
                        </div>
                        <span className="text-white/30 text-[13px]">No screenshots yet</span>
                        <span className="text-white/20 text-[11px] mt-1">Take screenshots in your projects to see them here</span>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {filteredScreenshots.map((screenshot) => (
                            <div
                                key={screenshot.id}
                                className="relative group rounded-xl overflow-hidden bg-[#141821] border border-white/10 hover:border-white/20 hover:translate-y-[-2px] transition-all duration-200 cursor-pointer"
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
                                        className="p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white transition-colors"
                                        title="Download"
                                    >
                                        <Download size={13} />
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDelete(screenshot);
                                        }}
                                        className="p-1.5 rounded-lg bg-black/60 hover:bg-red-600 text-white transition-colors"
                                        title="Delete"
                                    >
                                        <Trash2 size={13} />
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
                            className="relative max-w-[90vw] max-h-[90vh] rounded-xl overflow-hidden"
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
                                    className="p-2 rounded-lg bg-black/60 hover:bg-black/80 text-white transition-colors"
                                    title="Download"
                                >
                                    <Download size={16} />
                                </button>
                                <button
                                    onClick={() => handleDelete(selectedScreenshot)}
                                    className="p-2 rounded-lg bg-black/60 hover:bg-red-600 text-white transition-colors"
                                    title="Delete"
                                >
                                    <Trash2 size={16} />
                                </button>
                                <button
                                    onClick={() => setSelectedScreenshot(null)}
                                    className="p-2 rounded-lg bg-black/60 hover:bg-black/80 text-white transition-colors"
                                    title="Close"
                                >
                                    <X size={16} />
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
