import React from "react";
import PropTypes from "prop-types";
import { FaPencilAlt, FaCube, FaMagic, FaExchangeAlt } from "react-icons/fa";

const CreationModeSelector = ({ onSelectMode, onClose }) => {
    const modes = [
        {
            id: "blank",
            title: "Blank Canvas",
            description: "Start from scratch with an empty 24×24 canvas",
            icon: FaPencilAlt,
            gradient: "from-emerald-500/20 to-emerald-600/10",
            borderColor: "border-emerald-500/30 hover:border-emerald-400/60",
            iconColor: "text-emerald-400",
        },
        {
            id: "existing",
            title: "From Existing",
            description: "Use an existing texture as your starting point",
            icon: FaCube,
            gradient: "from-blue-500/20 to-blue-600/10",
            borderColor: "border-blue-500/30 hover:border-blue-400/60",
            iconColor: "text-blue-400",
        },
        {
            id: "blend",
            title: "Blend Textures",
            description:
                "Merge two textures with gradient or stepped transitions",
            icon: FaExchangeAlt,
            gradient: "from-orange-500/20 to-orange-600/10",
            borderColor: "border-orange-500/30 hover:border-orange-400/60",
            iconColor: "text-orange-400",
        },
        {
            id: "ai",
            title: "AI Generate",
            description: "Describe what you want and let AI create it",
            icon: FaMagic,
            gradient: "from-purple-500/20 to-purple-600/10",
            borderColor: "border-purple-500/30 hover:border-purple-400/60",
            iconColor: "text-purple-400",
        },
    ];

    return (
        <div className="flex flex-col items-center gap-6 p-6">
            <div className="text-center">
                <h2 className="text-2xl font-bold text-white mb-2">
                    Create New Texture
                </h2>
                <p className="text-white/50 text-sm">
                    Choose how you'd like to start
                </p>
            </div>

            <div className="grid grid-cols-2 gap-4 w-full max-w-lg">
                {modes.map((mode) => {
                    const Icon = mode.icon;
                    return (
                        <button
                            key={mode.id}
                            onClick={() => onSelectMode(mode.id)}
                            className={`
                                group relative flex flex-col items-center gap-4 p-6 
                                rounded-xl border-2 ${mode.borderColor}
                                bg-gradient-to-br ${mode.gradient}
                                backdrop-blur-sm transition-all duration-300
                                hover:scale-[1.02] hover:shadow-lg hover:shadow-black/20
                                active:scale-[0.98]
                            `}
                        >
                            <div
                                className={`
                                    w-16 h-16 rounded-full flex items-center justify-center
                                    bg-black/30 ${mode.iconColor}
                                    group-hover:scale-110 transition-transform duration-300
                                `}
                            >
                                <Icon size={28} />
                            </div>
                            <div className="text-center">
                                <h3 className="text-white font-semibold text-lg mb-1">
                                    {mode.title}
                                </h3>
                                <p className="text-white/50 text-xs leading-relaxed">
                                    {mode.description}
                                </p>
                            </div>
                        </button>
                    );
                })}
            </div>

            <button
                onClick={onClose}
                className="text-white/40 hover:text-white/70 text-sm transition-colors"
            >
                Cancel
            </button>
        </div>
    );
};

CreationModeSelector.propTypes = {
    onSelectMode: PropTypes.func.isRequired,
    onClose: PropTypes.func.isRequired,
};

export default CreationModeSelector;
