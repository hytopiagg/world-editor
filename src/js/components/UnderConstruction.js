import React from "react";
import hytopiaLogo from "../../images/Hytopia_Tiny.png";

const UnderConstruction = () => {
    return (
        <div className="under-construction-overlay">
            <div className="under-construction-content">
                <img
                    src={hytopiaLogo}
                    alt="Hytopia Logo"
                    className="loading-logo"
                />
                <h2>Under Construction</h2>
                <p>
                    We're working on making the Hytopia World Editor even
                    better!
                </p>
                <p>Please check back soon.</p>
            </div>
        </div>
    );
};

export default UnderConstruction;
