import React from "react";

interface FolderMeta { id: string; name: string; }

interface Props {
    isOpen: boolean;
    folders: FolderMeta[];
    onClose: () => void;
    onMove: (folderId: string | null) => void;
}

const MoveToModal: React.FC<Props> = ({ isOpen, folders, onClose, onMove }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60" onClick={onClose} />
            <div className="relative bg-[#0e131a] border border-[#1a1f29] rounded-lg w-[340px] p-4 text-[#cfd6e4] shadow-xl">
                <div className="text-white font-semibold mb-3">Move to…</div>
                <div className="max-h-[240px] overflow-auto space-y-1">
                    <button className="w-full text-left px-3 py-2 rounded hover:bg-white/5" onClick={() => onMove(null)}>
                        Root
                    </button>
                    {folders.map((f) => (
                        <button key={f.id} className="w-full text-left px-3 py-2 rounded hover:bg-white/5" onClick={() => onMove(f.id)}>
                            {f.name}
                        </button>
                    ))}
                </div>
                <div className="mt-3 flex justify-end gap-2">
                    <button className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15" onClick={onClose}>Cancel</button>
                </div>
            </div>
        </div>
    );
};

export default MoveToModal;

