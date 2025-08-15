import React from 'react';

type Props = {
    enabled: boolean;
    onToggle: () => void;
};

export default function PlayerModeToggle({ enabled, onToggle }: Props) {
    return (
        <button
            className={`border border-white/10 items-center justify-center flex py-1.5 px-2 rounded-md transition-colors duration-200 cursor-pointer active:scale-95 hover:border-white ${enabled ? 'bg-white/10' : ''}`}
            title="Toggle Player Mode (run around)"
            onClick={onToggle}
        >
            {enabled ? 'Exit Player Mode' : 'Enter Player Mode'}
        </button>
    );
}


