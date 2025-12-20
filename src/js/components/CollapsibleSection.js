import React from "react";
import PropTypes from "prop-types";
import { FaChevronDown, FaChevronRight } from "react-icons/fa";

const CollapsibleSection = ({ 
    title, 
    icon: Icon, 
    children, 
    isOpen = false,
    onToggle,
    iconColor = "text-white/60"
}) => {
    return (
        <div className="border border-white/10 rounded-lg overflow-hidden">
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 transition-colors"
            >
                {isOpen ? (
                    <FaChevronDown size={10} className="text-white/40" />
                ) : (
                    <FaChevronRight size={10} className="text-white/40" />
                )}
                {Icon && <Icon size={12} className={iconColor} />}
                <span className="text-white/70 text-xs font-medium flex-1 text-left">
                    {title}
                </span>
            </button>
            {isOpen && (
                <div className="p-2.5 border-t border-white/10">
                    {children}
                </div>
            )}
        </div>
    );
};

CollapsibleSection.propTypes = {
    title: PropTypes.string.isRequired,
    icon: PropTypes.elementType,
    children: PropTypes.node.isRequired,
    isOpen: PropTypes.bool,
    onToggle: PropTypes.func.isRequired,
    iconColor: PropTypes.string,
};

export default CollapsibleSection;

