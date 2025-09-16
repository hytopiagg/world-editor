import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface ModalContainerProps extends React.PropsWithChildren {
    title?: string;
    isOpen: boolean;
    onClose: () => void;
    className?: string;
}

const ModalContainer: React.FC<ModalContainerProps> = ({ title, isOpen, onClose, className = "", children }) => {
    const [entered, setEntered] = useState(false);
    useEffect(() => {
        if (isOpen) {
            const t = requestAnimationFrame(() => setEntered(true));
            return () => { cancelAnimationFrame(t); setEntered(false); };
        } else {
            setEntered(false);
        }
    }, [isOpen]);

    if (!isOpen || typeof document === 'undefined') return null;

    const node = (
        <div className="fixed inset-0 z-[1500] ph-modal-root">
            <div
                className={`absolute inset-0 bg-black/60 backdrop-blur-md transition-opacity duration-200 ${entered ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            />
            <div className="flex absolute inset-0 justify-center items-center p-4">
                <div className={`relative w-full max-w-[640px] rounded-2xl bg-[#0e131a] text-[#cfd6e4] shadow-2xl border border-[#1a1f29] transition-all duration-200 ease-out ph-modal-panel ${entered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'} ${className}`}>
                    {title && (
                        <div className="px-6 py-4 text-left text-[20px] font-bold leading-normal">
                            {title}
                        </div>
                    )}
                    {title && <hr className="w-full border-white/10" />}
                    <div className="p-6">
                        {children}
                    </div>
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 p-3 rounded-xl border transition border-white/10 hover:bg-white/10"
                        aria-label="Close"
                    >
                        <svg width="14" height="14" fill="none" viewBox="0 0 14 14">
                            <path stroke="#fff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 1 1 13M1 1l12 12" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );

    return createPortal(node, document.body);
};

export default ModalContainer;
