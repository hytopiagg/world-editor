import React from "react";
import { CHANGELOG } from "../data/changelog";

const TYPE_CONFIG: Record<string, { label: string; dot: string; text: string; bg: string }> = {
    added: { label: "New", dot: "bg-emerald-400", text: "text-emerald-400", bg: "bg-emerald-400/10" },
    fixed: { label: "Fix", dot: "bg-amber-400", text: "text-amber-400", bg: "bg-amber-400/10" },
    improved: { label: "Improved", dot: "bg-sky-400", text: "text-sky-400", bg: "bg-sky-400/10" },
};

const ChangelogPanel: React.FC = () => {
    return (
        <div className="flex flex-col h-full px-5 py-1">
            {/* Header */}
            <div className="flex items-center gap-2.5 mb-5">
                <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-white/[0.06] text-white/40">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none stroke-[1.8]">
                        <path d="M12 8v4l3 3" />
                        <circle cx="12" cy="12" r="10" />
                    </svg>
                </div>
                <h2 className="text-white/90 text-[14px] font-semibold tracking-wide uppercase">Changelog</h2>
            </div>

            {/* Timeline */}
            <div className="flex flex-col overflow-y-auto flex-1 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.06)_transparent] pr-1">
                {CHANGELOG.map((entry, i) => (
                    <div key={i} className="relative flex gap-3.5 pb-6 last:pb-0 group/entry">
                        {/* Timeline track */}
                        <div className="flex flex-col items-center shrink-0 pt-[3px]">
                            <div className={`w-2 h-2 rounded-full shrink-0 ${i === 0 ? 'bg-[#2b6aff] ring-[3px] ring-[#2b6aff]/20' : 'bg-white/20'}`} />
                            {i < CHANGELOG.length - 1 && (
                                <div className="w-px flex-1 bg-gradient-to-b from-white/10 to-white/[0.03] mt-1.5" />
                            )}
                        </div>

                        {/* Content */}
                        <div className="flex flex-col gap-2 min-w-0 flex-1 pb-1">
                            {/* Date row */}
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-[12px] font-medium ${i === 0 ? 'text-white/60' : 'text-white/35'}`}>
                                    {formatDate(entry.date)}
                                </span>
                                {entry.version && (
                                    <span className="text-[10px] px-1.5 py-[1px] rounded bg-[#2b6aff]/15 text-[#6b9fff] font-semibold tracking-wide">
                                        v{entry.version}
                                    </span>
                                )}
                            </div>

                            {/* Changes */}
                            <div className="flex flex-col gap-1.5">
                                {entry.changes.map((change, j) => {
                                    const cfg = TYPE_CONFIG[change.type] || TYPE_CONFIG.added;
                                    return (
                                        <div key={j} className="flex items-start gap-2">
                                            <span className={`text-[9px] uppercase tracking-wider px-1.5 py-[2px] rounded font-semibold mt-[2px] shrink-0 ${cfg.bg} ${cfg.text}`}>
                                                {cfg.label}
                                            </span>
                                            <span className="text-white/50 text-[12px] leading-relaxed">{change.text}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

function formatDate(dateStr: string): string {
    try {
        const d = new Date(dateStr + "T00:00:00");
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch {
        return dateStr;
    }
}

export default ChangelogPanel;
