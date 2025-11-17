import React from "react";
import type { TargetObjectType } from "./index";

interface TargetObjectSelectorProps {
    value: TargetObjectType;
    onChange: (value: TargetObjectType) => void;
}

export default function TargetObjectSelector({
    value,
    onChange,
}: TargetObjectSelectorProps) {
    const options: { value: TargetObjectType; label: string; icon: React.ReactNode }[] = [
        {
            value: "none",
            label: "None",
            icon: (
                <svg viewBox="0 0 24 24" className="w-5 h-5 stroke-current fill-none stroke-[1.6]">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v8M8 12h8" />
                </svg>
            ),
        },
        {
            value: "block",
            label: "Block",
            icon: (
                <svg viewBox="0 0 24 24" className="w-5 h-5 stroke-current fill-none stroke-[1.6]">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                </svg>
            ),
        },
        {
            value: "player",
            label: "Player",
            icon: (
                <svg viewBox="0 0 24 24" className="w-5 h-5 stroke-current fill-none stroke-[1.6]">
                    <path d="M12 2a5 5 0 1 0 5 5 5 5 0 0 0-5-5z" />
                    <path d="M12 12a7 7 0 0 0-7 7h14a7 7 0 0 0-7-7z" />
                </svg>
            ),
        },
        {
            value: "entity",
            label: "Entity",
            icon: (
                <svg viewBox="0 0 24 24" className="w-5 h-5 stroke-current fill-none stroke-[1.6]">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                </svg>
            ),
        },
    ];

    return (
        <div className="flex flex-col gap-1.5">
            {options.map((option) => (
                <label
                    key={option.value}
                    className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                        value === option.value
                            ? "bg-white/10 text-white"
                            : "bg-transparent text-white/60 hover:bg-white/5"
                    }`}
                >
                    <input
                        type="radio"
                        name="targetObject"
                        value={option.value}
                        checked={value === option.value}
                        onChange={() => onChange(option.value)}
                        className="sr-only"
                    />
                    <div className="flex-shrink-0 text-white/60">{option.icon}</div>
                    <span className="text-sm text-white/60">{option.label}</span>
                </label>
            ))}
        </div>
    );
}

