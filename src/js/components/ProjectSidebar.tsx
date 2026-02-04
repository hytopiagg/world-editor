import React from "react";
import { Home, FolderOpen, LayoutGrid, BookOpen, Camera, Sparkles } from "lucide-react";

interface Props {
    activeNav: string;
    setActiveNav: (v: string) => void;
    hoverNav: string | null;
    setHoverNav: (v: string | null) => void;
}

const NAV_ITEMS = [
    { key: 'home', label: 'Home', icon: <Home size={16} className="text-white/60" /> },
    { key: 'my-files', label: 'My files', icon: <FolderOpen size={16} className="text-white/60" /> },
    { key: 'templates', label: 'Templates', icon: <LayoutGrid size={16} className="text-white/60" /> },
    { key: 'tutorials', label: 'Tutorials', icon: <BookOpen size={16} className="text-white/60" /> },
    { key: 'screenshots', label: 'Screenshots', icon: <Camera size={16} className="text-white/60" /> },
    { key: 'particle-viewer', label: 'Particle Viewer', icon: <Sparkles size={16} className="text-white/60" /> },
];

const ProjectSidebar: React.FC<Props> = ({ activeNav, setActiveNav, hoverNav, setHoverNav }) => {
    return (
        <aside className="bg-[#0e1117]/80 backdrop-blur-md border-r border-white/[0.06] p-5 flex flex-col gap-4 w-[280px]">
            <div className="flex items-center justify-start py-[6px]">
                <img src={"./assets/img/Hytopia_Tiny.png"} className="w-auto h-6" />
            </div>
            <nav className="flex flex-col gap-2 mt-2">
                {NAV_ITEMS.map((item) => (
                    <div
                        key={item.key}
                        className={`px-2.5 py-2 rounded-lg cursor-pointer flex items-center gap-2 text-white/60 transition-colors duration-200 ${activeNav === item.key ? 'bg-white/[0.08]' : hoverNav === item.key ? 'bg-white/[0.05]' : 'bg-transparent'}`}
                        onMouseEnter={() => setHoverNav(item.key)}
                        onMouseLeave={() => setHoverNav(null)}
                        onClick={() => setActiveNav(item.key)}
                    >
                        {item.icon}
                        <span className="text-white/60">{item.label}</span>
                    </div>
                ))}
            </nav>
            <div className="mt-auto flex flex-col gap-1.5 opacity-85">
                <a href="https://discord.gg/hytopia" target="_blank" rel="noreferrer" className="flex items-center text-[#cb6cf6] no-underline text-[13px]">
                    <svg viewBox="0 0 24 24" width="16" height="16" className="inline-block mr-2">
                        <path fill="currentColor" d="M20.317 4.369a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.211.375-.444.864-.608 1.249-1.827-.274-3.65-.274-5.475 0-.164-.396-.405-.874-.617-1.249a.077.077 0 00-.079-.037 19.736 19.736 0 00-4.885 1.515.07.07 0 00-.032.027C.533 9.04-.32 13.579.099 18.061a.082.082 0 00.031.056c2.052 1.507 4.041 2.422 5.992 3.029a.077.077 0 00.084-.027c.461-.63.873-1.295 1.226-1.994a.076.076 0 00-.041-.105c-.652-.247-1.27-.549-1.862-.892a.077.077 0 01-.007-.127c.125-.094.25-.192.37-.291a.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.099.245.197.37.291a.077.077 0 01-.006.127 12.298 12.298 0 01-1.863.892.076.076 0 00-.04.106c.36.699.772 1.364 1.225 1.994a.077.077 0 00.084.027c1.961-.607 3.95-1.522 6.002-3.029a.077.077 0 00.031-.055c.5-5.177-.838-9.673-3.549-13.665a.061.061 0 00-.031-.028zM8.02 15.331c-1.183 0-2.155-1.085-2.155-2.419 0-1.333.955-2.419 2.155-2.419 1.21 0 2.173 1.095 2.155 2.419 0 1.334-.955 2.419-2.155 2.419zm7.963 0c-1.183 0-2.155-1.085-2.155-2.419 0-1.333.955-2.419 2.155-2.419 1.21 0 2.173 1.095 2.155 2.419 0 1.334-.945 2.419-2.155 2.419z" />
                    </svg>
                    <span>Join our Discord</span>
                </a>
                <a href="https://x.com/hytopia" target="_blank" rel="noreferrer" className="flex items-center text-[#1DA1F2] no-underline text-[13px]">
                    <svg viewBox="0 0 300 271" width="16" height="16" className="inline-block mr-2">
                        <path fill="currentColor" d="m236 0h46l-101 115 118 156h-92.6l-72.5-94.8-83 94.8h-46l107-123-113-148h94.9l65.5 86.6zm-16.1 244h25.5l-165-218h-27.4z" />
                    </svg>
                    <span>Follow us on X</span>
                </a>
            </div>
        </aside>
    );
};

export default ProjectSidebar;
