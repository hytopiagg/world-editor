import React from "react";

interface PlayButtonProps {
    enabled: boolean;
    onToggle: () => void;
}

export default function PlayButton({ enabled, onToggle }: PlayButtonProps) {
    return (
        <button
            onClick={onToggle}
            className={`fixed bottom-6 right-6 z-50 px-6 py-3 rounded-lg font-medium text-sm transition-all ${
                enabled
                    ? "bg-red-600 hover:bg-red-700 text-white"
                    : "bg-green-600 hover:bg-green-700 text-white"
            } shadow-lg hover:shadow-xl flex items-center gap-2`}
            title={enabled ? "Exit Play Mode" : "Enter Play Mode (WASD to move)"}
        >
            {enabled ? (
                <>
                    <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
                        <path d="M6 6h12v12H6z" />
                    </svg>
                    Stop
                </>
            ) : (
                <>
                    <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
                        <path d="M8 5v14l11-7z" />
                    </svg>
                    Play
                </>
            )}
        </button>
    );
}

