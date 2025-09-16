import React from "react";
import ModalContainer from "./ModalContainer";

interface FolderMeta { id: string; name: string; }

interface Props {
    isOpen: boolean;
    folders: FolderMeta[];
    onClose: () => void;
    onMove: (folderId: string | null) => void;
}

const MoveToModal: React.FC<Props> = ({ isOpen, folders, onClose, onMove }) => {
    return (
        <ModalContainer isOpen={isOpen} onClose={onClose} title="Move to…" className="min-w-[520px]">
            <div className="flex flex-wrap gap-2">
                <button
                    className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10"
                    onClick={() => onMove(null)}
                    title="Root"
                >
                    <svg viewBox="0 0 24 24" width="16" height="16" className="text-white/80"><path fill="currentColor" d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V10z" /></svg>
                    <span>Home</span>
                </button>
                {folders.map((f) => (
                    <button
                        key={f.id}
                        className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10"
                        onClick={() => onMove(f.id)}
                        title={f.name}
                    >
                        {f.name}
                    </button>
                ))}
            </div>
        </ModalContainer>
    );
};

export default MoveToModal;

