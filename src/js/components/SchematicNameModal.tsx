import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

/**
 * SchematicNameModal - A modal for prompting schematic names
 * 
 * This can be triggered from anywhere in the application via SchematicNameModalManager.
 * Uses a Promise-based API for easy async/await usage.
 */

interface ModalState {
    isOpen: boolean;
    defaultValue: string;
    resolve: ((value: string | null) => void) | null;
}

class SchematicNameModalManager {
    private static listeners: Array<(state: ModalState) => void> = [];
    private static currentState: ModalState = {
        isOpen: false,
        defaultValue: "",
        resolve: null,
    };

    /**
     * Prompt for a schematic name
     * @param defaultValue - The default value for the input
     * @returns Promise that resolves with the entered name, or null if cancelled
     */
    static promptForName(defaultValue: string = "My Schematic"): Promise<string | null> {
        return new Promise((resolve) => {
            SchematicNameModalManager.currentState = {
                isOpen: true,
                defaultValue,
                resolve,
            };
            SchematicNameModalManager.notifyListeners();
        });
    }

    /**
     * Close the modal with a result
     */
    static close(value: string | null) {
        const { resolve } = SchematicNameModalManager.currentState;
        SchematicNameModalManager.currentState = {
            isOpen: false,
            defaultValue: "",
            resolve: null,
        };
        SchematicNameModalManager.notifyListeners();
        
        if (resolve) {
            resolve(value);
        }
    }

    static getState(): ModalState {
        return { ...SchematicNameModalManager.currentState };
    }

    static addListener(listener: (state: ModalState) => void) {
        SchematicNameModalManager.listeners.push(listener);
        // Immediately notify with current state
        listener(SchematicNameModalManager.getState());
    }

    static removeListener(listener: (state: ModalState) => void) {
        SchematicNameModalManager.listeners = SchematicNameModalManager.listeners.filter(
            (l) => l !== listener
        );
    }

    private static notifyListeners() {
        const state = SchematicNameModalManager.getState();
        SchematicNameModalManager.listeners.forEach((listener) => {
            try {
                listener(state);
            } catch (error) {
                console.error("Error notifying SchematicNameModal listener:", error);
            }
        });
    }
}

const SchematicNameModal: React.FC = () => {
    const [modalState, setModalState] = useState<ModalState>(
        SchematicNameModalManager.getState()
    );
    const [value, setValue] = useState("");
    const [entered, setEntered] = useState(false);

    useEffect(() => {
        const handleStateChange = (state: ModalState) => {
            setModalState(state);
            if (state.isOpen) {
                setValue(state.defaultValue);
            }
        };
        SchematicNameModalManager.addListener(handleStateChange);
        return () => {
            SchematicNameModalManager.removeListener(handleStateChange);
        };
    }, []);

    useEffect(() => {
        if (modalState.isOpen) {
            const t = requestAnimationFrame(() => setEntered(true));
            return () => {
                cancelAnimationFrame(t);
                setEntered(false);
            };
        } else {
            setEntered(false);
        }
    }, [modalState.isOpen]);

    const handleCancel = useCallback(() => {
        SchematicNameModalManager.close(null);
    }, []);

    const handleSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = (value || "").trim();
        if (trimmed) {
            SchematicNameModalManager.close(trimmed);
        }
    }, [value]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            handleCancel();
        }
    }, [handleCancel]);

    if (!modalState.isOpen || typeof document === "undefined") return null;

    const node = (
        <div 
            className="fixed inset-0 z-[1500]"
            onKeyDown={handleKeyDown}
        >
            {/* Backdrop */}
            <div
                className={`absolute inset-0 bg-black/60 backdrop-blur-md transition-opacity duration-200 ${
                    entered ? "opacity-100" : "opacity-0"
                }`}
                onClick={handleCancel}
            />
            
            {/* Modal */}
            <div className="flex absolute inset-0 justify-center items-center p-4">
                <div
                    className={`relative w-full max-w-[480px] rounded-2xl bg-[#0e131a] text-[#cfd6e4] shadow-2xl border border-[#1a1f29] transition-all duration-200 ease-out ${
                        entered
                            ? "opacity-100 translate-y-0"
                            : "opacity-0 translate-y-4"
                    }`}
                >
                    {/* Header */}
                    <div className="px-6 py-4 text-left text-[20px] font-bold leading-normal">
                        Save as Schematic
                    </div>
                    <hr className="w-full border-white/10" />
                    
                    {/* Content */}
                    <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
                        <div className="text-white/70 text-sm">
                            Enter a name for your schematic. This will be saved to your schematic library.
                        </div>
                        <input
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20"
                            placeholder="Schematic name..."
                            autoFocus
                        />
                        <div className="flex justify-end gap-3 mt-2">
                            <button
                                type="button"
                                onClick={handleCancel}
                                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={!value.trim()}
                                className="px-4 py-2 rounded-xl bg-[#2b6aff] hover:bg-[#2560e6] text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Save
                            </button>
                        </div>
                    </form>
                    
                    {/* Close button */}
                    <button
                        onClick={handleCancel}
                        className="absolute top-4 right-4 p-3 rounded-xl border transition border-white/10 hover:bg-white/10"
                        aria-label="Close"
                    >
                        <svg
                            width="14"
                            height="14"
                            fill="none"
                            viewBox="0 0 14 14"
                        >
                            <path
                                stroke="#fff"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M13 1 1 13M1 1l12 12"
                            />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );

    return createPortal(node, document.body);
};

export { SchematicNameModalManager };
export default SchematicNameModal;

