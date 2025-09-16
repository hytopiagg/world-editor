import React, { useMemo, useState } from "react";
import ModalContainer from "./ModalContainer";

interface FolderMeta { id: string; name: string; }

interface Props {
    isOpen: boolean;
    folders: FolderMeta[];
    onClose: () => void;
    onMove: (folderId: string | null) => void;
}

const MoveToModal: React.FC<Props> = ({ isOpen, folders, onClose, onMove }) => {
    const [query, setQuery] = useState("");
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return folders;
        return folders.filter((f) => (f.name || "").toLowerCase().includes(q));
    }, [folders, query]);

    return (
        <ModalContainer isOpen={isOpen} onClose={onClose} title="Move to…" className="min-w-[480px]">
            <div className="flex flex-col gap-3">
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search folders"
                    className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-white placeholder:text-white/50 focus:border-white/50 focus:outline-none"
                />
                <div className="max-h-[320px] overflow-auto rounded-xl border border-white/10">
                    <button className="w-full text-left px-3 py-2 hover:bg-white/10" onClick={() => onMove(null)}>
                        Root
                    </button>
                    {filtered.map((f) => (
                        <button key={f.id} className="w-full text-left px-3 py-2 hover:bg-white/10" onClick={() => onMove(f.id)}>
                            {f.name}
                        </button>
                    ))}
                    {filtered.length === 0 && (
                        <div className="px-3 py-6 text-white/50 text-center">No matching folders</div>
                    )}
                </div>
                <div className="flex justify-end gap-2">
                    <button className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15" onClick={onClose}>Cancel</button>
                </div>
            </div>
        </ModalContainer>
    );
};

export default MoveToModal;

