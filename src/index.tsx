import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { performanceLogger } from "./js/utils/PerformanceLogger";

performanceLogger.checkpoint("Application entry point - React DOM mount starting");

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);

performanceLogger.checkpoint("React DOM mount complete");
