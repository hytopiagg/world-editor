/**
 * SeedGeneratorTool.js - Tool for generating Hytopia worlds from seeds
 *
 * This tool implements procedural terrain generation for the Hytopia world editor,
 * with support for customization parameters like seed value, cave density,
 * biome size, mountain height, etc.
 */
import "../../css/SeedGeneratorTool.css";
import { getBlockTypes } from "../managers/BlockTypesManager";
import { generateHytopiaWorld } from "../utils/TerrainGenerator";
import BaseTool from "./BaseTool";
class SeedGeneratorTool extends BaseTool {
    constructor(terrainBuilderProps) {
        super(terrainBuilderProps);
        this.name = "SeedGeneratorTool";
        this.tooltip =
            "Seed Generator: Create Hytopia worlds from a seed value";

        if (terrainBuilderProps) {
            this.terrainRef = terrainBuilderProps.terrainRef;
            this.currentBlockTypeRef = terrainBuilderProps.currentBlockTypeRef;
            this.scene = terrainBuilderProps.scene;
            this.toolManagerRef = terrainBuilderProps.toolManagerRef;
            this.terrainBuilderRef = terrainBuilderProps.terrainBuilderRef;
        } else {
            console.error(
                "SeedGeneratorTool: terrainBuilderProps is undefined in constructor"
            );
        }

        this.generationOptions = {
            seed: Math.floor(Math.random() * 1000000).toString(),
            width: 200,
            length: 200,
            caveDensity: 50,
            biomeSize: 100,
            mountainHeight: 50,
            waterLevel: 50, // This will map to seaLevel between 32-38
            terrainFlatness: 15,
            oreDensity: 50,
            temperature: 50, // New temperature slider (0-100)
            generateOreDeposits: true,
            clearMap: true,
            mountainRange: 0, // New option for snow-capped mountain range
        };

        this.uiElements = {
            seedInput: null,
            generateButton: null,
            progressBar: null,
            progressText: null,
        };

        this.isGenerating = false;
    }
    onActivate() {
        super.onActivate();
        console.log("SeedGeneratorTool activated");

        if (!document.getElementById("seed-generator-ui")) {
            this.createUI();
        }

        const ui = document.getElementById("seed-generator-ui");
        if (ui) {
            ui.style.display = "block";
        }
        return true; // Indicate successful activation
    }
    onDeactivate() {
        super.onDeactivate();

        const ui = document.getElementById("seed-generator-ui");
        if (ui) {
            ui.style.display = "none";
        }
    }
    /**
     * Initialize UI elements when the tool is activated
     */
    createUI() {
        console.log("Creating Seed Generator UI");

        if (document.getElementById("seed-generator-ui")) {
            return;
        }

        const uiContainer = document.createElement("div");
        uiContainer.id = "seed-generator-ui";
        uiContainer.className = "generator-ui";

        const header = document.createElement("div");
        header.className = "generator-header";

        const title = document.createElement("div");
        title.textContent = "Hytopia Seed Generator";

        const headerButtons = document.createElement("div");
        headerButtons.className = "header-buttons";

        const compactButton = document.createElement("button");
        compactButton.innerHTML = "🔍";
        compactButton.title = "Toggle Compact Mode";
        compactButton.className = "compact-button";

        this.isCompactMode = false;
        compactButton.onclick = () => {
            this.isCompactMode = !this.isCompactMode;
            if (this.isCompactMode) {
                caveSection.style.display = "none";

                const temperatureContainer = document.getElementById(
                    "temperature-slider-container"
                );
                if (temperatureContainer)
                    temperatureContainer.style.display = "none";

                const mountainRangeSlider = document.getElementById(
                    "mountain-range-slider"
                );
                if (mountainRangeSlider && mountainRangeSlider.parentElement) {
                    mountainRangeSlider.parentElement.style.display = "none";
                }

                compactButton.title = "Show All Options";
                compactButton.innerHTML = "🔎";
            } else {
                caveSection.style.display = "block";

                const temperatureContainer = document.getElementById(
                    "temperature-slider-container"
                );
                if (temperatureContainer)
                    temperatureContainer.style.display = "block";

                const mountainRangeSlider = document.getElementById(
                    "mountain-range-slider"
                );
                if (mountainRangeSlider && mountainRangeSlider.parentElement) {
                    mountainRangeSlider.parentElement.style.display = "block";
                }

                compactButton.title = "Compact Mode";
                compactButton.innerHTML = "🔍";
            }
        };

        const closeButton = document.createElement("button");
        closeButton.innerHTML = "×";
        closeButton.className = "close-button";
        closeButton.onclick = () => this.hideUI();

        headerButtons.appendChild(compactButton);
        headerButtons.appendChild(closeButton);
        header.appendChild(title);
        header.appendChild(headerButtons);
        uiContainer.appendChild(header);

        const contentContainer = document.createElement("div");
        contentContainer.className = "generator-content";

        const seedSection = this.createFormSection("Seed Value");

        const seedInputContainer = document.createElement("div");
        seedInputContainer.className = "input-container";
        const seedInput = document.createElement("input");
        seedInput.id = "seed-input";
        seedInput.type = "text";
        seedInput.value = this.generationOptions.seed;
        seedInput.placeholder = "Enter seed value";
        seedInput.className = "generator-input flex-grow";
        seedInput.addEventListener("change", (e) => {
            this.generationOptions.seed = e.target.value;
        });
        const randomButton = document.createElement("button");
        randomButton.innerHTML = "🎲";
        randomButton.title = "Generate random seed";
        randomButton.className = "generator-button random-button";
        randomButton.addEventListener("click", () => {
            const randomSeed = Math.floor(Math.random() * 1000000).toString();
            seedInput.value = randomSeed;
            this.generationOptions.seed = randomSeed;
        });
        seedInputContainer.appendChild(seedInput);
        seedInputContainer.appendChild(randomButton);
        seedSection.appendChild(seedInputContainer);
        contentContainer.appendChild(seedSection);

        const sizeSection = this.createFormSection("World Size");
        const sizeContainer = document.createElement("div");
        sizeContainer.className = "input-container";
        const widthInput = this.createNumberInput(
            "width-input",
            "Width",
            this.generationOptions.width,
            10,
            1000,
            10
        );
        widthInput.classList.add("flex-grow");
        widthInput.addEventListener("change", (e) => {
            this.generationOptions.width = parseInt(e.target.value);
        });
        const lengthInput = this.createNumberInput(
            "length-input",
            "Length",
            this.generationOptions.length,
            10,
            1000,
            10
        );
        lengthInput.classList.add("flex-grow");
        lengthInput.addEventListener("change", (e) => {
            this.generationOptions.length = parseInt(e.target.value);
        });
        sizeContainer.appendChild(widthInput);
        sizeContainer.appendChild(lengthInput);
        sizeSection.appendChild(sizeContainer);

        const quickSizeContainer = document.createElement("div");
        quickSizeContainer.className = "quick-size-container";
        const sizes = [
            { label: "Small", width: 100, length: 100 },
            { label: "Medium", width: 150, length: 150 },
            { label: "Large", width: 200, length: 200 },
        ];
        sizes.forEach((size) => {
            const button = document.createElement("button");
            button.innerHTML = size.label;
            button.className = "generator-button flex-grow";
            button.addEventListener("click", () => {
                widthInput.value = size.width;
                lengthInput.value = size.length;
                this.generationOptions.width = size.width;
                this.generationOptions.length = size.length;
            });
            quickSizeContainer.appendChild(button);
        });
        sizeSection.appendChild(quickSizeContainer);
        contentContainer.appendChild(sizeSection);

        const terrainSection = this.createFormSection("Terrain Features");

        const mountainSlider = this.createSlider(
            "mountain-slider",
            "Terrain Type (Oceans ↔ Plains ↔ Mountains)",
            this.generationOptions.mountainHeight,
            0,
            100,
            5,
            (val) => {
                this.generationOptions.mountainHeight = val;

                const sliderLabel = document.querySelector(
                    'label[for="mountain-slider"]'
                );
                if (sliderLabel) {
                    let terrainType = "";
                    if (val < 30) {
                        terrainType = "Deep Oceans";
                    } else if (val < 50) {
                        terrainType = "Lowlands";
                    } else if (val < 70) {
                        terrainType = "Hills";
                    } else if (val < 85) {
                        terrainType = "Mountains";
                    } else {
                        terrainType = "Extreme Mountains";
                    }
                    sliderLabel.textContent = `Terrain Type: ${terrainType}`;
                }
            }
        );
        terrainSection.appendChild(mountainSlider);

        const mountainRangeSlider = this.createSlider(
            "mountain-range-slider",
            "Snow-Capped Mountain Range: None",
            this.generationOptions.mountainRange,
            0,
            100,
            5,
            (val) => {
                this.generationOptions.mountainRange = val;

                const sliderLabel = document.querySelector(
                    'label[for="mountain-range-slider"]'
                );
                if (sliderLabel) {
                    let mountainDesc = "None";
                    if (val > 0) {
                        if (val <= 25) {
                            mountainDesc = "Massive"; // 0-25% slider = largest mountains
                        } else if (val <= 50) {
                            mountainDesc = "Large"; // 26-50% slider = large mountains
                        } else if (val <= 75) {
                            mountainDesc = "Medium"; // 51-75% slider = medium mountains
                        } else {
                            mountainDesc = "Small"; // 76-100% slider = small mountains
                        }
                    }
                    sliderLabel.textContent = `Snow-Capped Mountain Range: ${mountainDesc}`;
                }
            }
        );
        terrainSection.appendChild(mountainRangeSlider);

        const waterSlider = this.createSlider(
            "water-slider",
            `Water Level (Sea Height: ${
                32 + Math.round((this.generationOptions.waterLevel / 100) * 6)
            })`,
            this.generationOptions.waterLevel,
            0,
            100,
            5,
            (val) => {
                this.generationOptions.waterLevel = val;

                const seaLevel = 32 + Math.round((val / 100) * 6);
                const labelElem = document.querySelector(
                    'label[for="water-slider"]'
                );
                if (labelElem) {
                    labelElem.textContent = `Water Level (Sea Height: ${seaLevel})`;
                }
            }
        );
        terrainSection.appendChild(waterSlider);

        const flatnessSlider = this.createSlider(
            "flatness-slider",
            "Terrain Flatness",
            this.generationOptions.terrainFlatness,
            0,
            100,
            5,
            (val) => {
                this.generationOptions.terrainFlatness = val;
            }
        );
        terrainSection.appendChild(flatnessSlider);

        const biomeSlider = this.createSlider(
            "biome-slider",
            "Biome Size",
            this.generationOptions.biomeSize,
            0,
            100,
            5,
            (val) => {
                this.generationOptions.biomeSize = val;
            }
        );
        terrainSection.appendChild(biomeSlider);
        contentContainer.appendChild(terrainSection);

        const temperatureSlider = this.createTemperatureSlider();
        terrainSection.appendChild(temperatureSlider);

        const caveSection = this.createFormSection("Cave & Ore Features");

        const caveSlider = this.createSlider(
            "cave-slider",
            "Cave Density",
            this.generationOptions.caveDensity,
            0,
            100,
            5,
            (val) => {
                this.generationOptions.caveDensity = val;
            }
        );
        caveSection.appendChild(caveSlider);

        const oreSlider = this.createSlider(
            "ore-slider",
            "Ore Density",
            this.generationOptions.oreDensity,
            0,
            100,
            5,
            (val) => {
                this.generationOptions.oreDensity = val;
            }
        );
        caveSection.appendChild(oreSlider);

        const oreCheckbox = document.createElement("div");
        oreCheckbox.className = "checkbox-container";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = "ore-checkbox";
        checkbox.checked = this.generationOptions.generateOreDeposits;
        checkbox.addEventListener("change", (e) => {
            this.generationOptions.generateOreDeposits = e.target.checked;
        });
        const label = document.createElement("label");
        label.htmlFor = "ore-checkbox";
        label.textContent = "Generate Ore Deposits";
        label.className = "checkbox-label";
        oreCheckbox.appendChild(checkbox);
        oreCheckbox.appendChild(label);
        caveSection.appendChild(oreCheckbox);
        contentContainer.appendChild(caveSection);

        terrainSection
            .querySelector("#temperature-slider")
            .parentElement.classList.add("optional-section");

        const mountainRangeElement = terrainSection.querySelector(
            "#mountain-range-slider"
        );
        if (mountainRangeElement) {
            mountainRangeElement.parentElement.classList.add(
                "optional-section"
            );
        }

        const controlsSection = document.createElement("div");
        controlsSection.className = "controls-section";

        const clearMapContainer = document.createElement("div");
        clearMapContainer.className = "checkbox-container";
        const clearMapCheckbox = document.createElement("input");
        clearMapCheckbox.type = "checkbox";
        clearMapCheckbox.id = "clear-map-checkbox";
        clearMapCheckbox.checked = this.generationOptions.clearMap;
        clearMapCheckbox.addEventListener("change", (e) => {
            this.generationOptions.clearMap = e.target.checked;
        });
        const clearMapLabel = document.createElement("label");
        clearMapLabel.htmlFor = "clear-map-checkbox";
        clearMapLabel.textContent = "Clear existing map before generation";
        clearMapLabel.className = "checkbox-label";
        clearMapContainer.appendChild(clearMapCheckbox);
        clearMapContainer.appendChild(clearMapLabel);
        controlsSection.appendChild(clearMapContainer);

        const generateButton = document.createElement("button");
        generateButton.id = "generate-button";
        generateButton.textContent = "Generate World";
        generateButton.className = "generate-button";
        generateButton.addEventListener("click", () => {
            this.generateWorldFromSeed(this.generationOptions);
        });
        controlsSection.appendChild(generateButton);

        const progressContainer = document.createElement("div");
        progressContainer.id = "progress-container";
        progressContainer.className = "progress-container";
        const progressLabel = document.createElement("div");
        progressLabel.id = "progress-label";
        progressLabel.textContent = "Generating world...";
        progressLabel.className = "progress-label";
        const progressBarOuter = document.createElement("div");
        progressBarOuter.className = "progress-bar-outer";
        const progressBarInner = document.createElement("div");
        progressBarInner.id = "progress-bar";
        progressBarInner.className = "progress-bar-inner";
        progressBarOuter.appendChild(progressBarInner);
        progressContainer.appendChild(progressLabel);
        progressContainer.appendChild(progressBarOuter);
        controlsSection.appendChild(progressContainer);
        contentContainer.appendChild(controlsSection);

        uiContainer.appendChild(contentContainer);

        document.body.appendChild(uiContainer);

        this.uiElements = {
            container: uiContainer,
            seedInput: seedInput,
            generateButton: generateButton,
            progressContainer: progressContainer,
            progressLabel: progressLabel,
            progressBar: progressBarInner,
        };
    }
    /**
     * Create a form section with a title
     */
    createFormSection(title) {
        const section = document.createElement("div");
        section.className = "form-section";
        const sectionTitle = document.createElement("div");
        sectionTitle.textContent = title;
        if (title === "Seed Value") {
            sectionTitle.className = "section-title-top";
        } else {
            sectionTitle.className = "section-title";
        }
        section.appendChild(sectionTitle);
        return section;
    }
    /**
     * Create a number input with label
     */
    createNumberInput(id, placeholder, defaultValue, min, max, step) {
        const input = document.createElement("input");
        input.id = id;
        input.type = "number";
        input.value = defaultValue;
        input.placeholder = placeholder;
        input.min = min;
        input.max = max;
        input.step = step;
        input.className = "generator-input";
        return input;
    }
    /**
     * Create a slider with label and value display
     */
    createSlider(id, label, defaultValue, min, max, step, onChange) {
        const container = document.createElement("div");
        container.className = "slider-container";
        const labelContainer = document.createElement("div");
        labelContainer.className = "slider-label-container";
        const sliderLabel = document.createElement("label");
        sliderLabel.htmlFor = id;
        sliderLabel.textContent = label;
        sliderLabel.className = "slider-label";
        const valueDisplay = document.createElement("span");
        valueDisplay.textContent = defaultValue;
        valueDisplay.className = "slider-value";
        labelContainer.appendChild(sliderLabel);
        labelContainer.appendChild(valueDisplay);
        const slider = document.createElement("input");
        slider.id = id;
        slider.type = "range";
        slider.min = min;
        slider.max = max;
        slider.step = step;
        slider.value = defaultValue;
        slider.className = "generator-slider";
        slider.addEventListener("input", () => {
            valueDisplay.textContent = slider.value;
            onChange(parseInt(slider.value));
        });
        container.appendChild(labelContainer);
        container.appendChild(slider);
        return container;
    }
    /**
     * Show the progress UI and hide generation controls
     */
    showProgressUI() {
        if (!this.uiElements || !this.uiElements.progressContainer) return;
        this.uiElements.generateButton.disabled = true;
        this.uiElements.progressContainer.style.display = "block";
    }
    /**
     * Update the progress UI with current generation status
     */
    updateProgressUI(message, progress) {
        if (!this.uiElements || !this.uiElements.progressContainer) return;
        this.uiElements.progressLabel.textContent = message;
        this.uiElements.progressBar.style.width = `${progress}%`;
    }
    /**
     * Hide the progress UI and enable generation controls
     */
    hideProgressUI() {
        if (!this.uiElements || !this.uiElements.progressContainer) return;
        this.uiElements.generateButton.disabled = false;
        this.uiElements.progressContainer.style.display = "none";
    }
    /**
     * Reset the UI to its initial state
     */
    resetGenerationUI(error = false) {
        this.hideProgressUI();
        if (error && this.uiElements && this.uiElements.progressLabel) {
            this.uiElements.progressLabel.textContent =
                "Error generating world!";
            this.uiElements.progressLabel.classList.add("error-label");
            this.uiElements.progressContainer.style.display = "block";

            setTimeout(() => {
                this.uiElements.progressContainer.style.display = "none";
                this.uiElements.progressLabel.classList.remove("error-label");
            }, 3000);
        }
    }
    /**
     * Show/create the UI
     */
    showUI() {
        if (!document.getElementById("seed-generator-ui")) {
            this.createUI();
        } else {
            document.getElementById("seed-generator-ui").style.display =
                "block";
        }

        if (!this._inShowAllUI) {
            this.showAllOtherUI();
        }
    }
    /**
     * Show all UI elements except the seed generator UI (called by showUI)
     */
    showAllOtherUI() {
        const toolbar = document.querySelector(".tool-bar");
        if (toolbar) {
            toolbar.style.display = toolbar.dataset.originalDisplay || "flex";
        }

        const blockSelector = document.querySelector(".block-type-selector");
        if (blockSelector) {
            blockSelector.style.display =
                blockSelector.dataset.originalDisplay || "flex";
        }

        const buttons = document.querySelectorAll(
            "button:not(#restore-ui-button)"
        );
        buttons.forEach((el) => {
            if (el.dataset.originalDisplay) {
                el.style.display = el.dataset.originalDisplay;
            }
        });

        const uiDivs = document.querySelectorAll(
            ".ui-component, .modal, .modal-overlay, .panel, .sidebar, .tool-panel, .menu"
        );
        uiDivs.forEach((el) => {
            if (el.dataset.originalDisplay) {
                el.style.display = el.dataset.originalDisplay;
            }
        });

        const additionalElements = document.querySelectorAll(
            '[class*="ui"], [class*="menu"], [class*="toolbar"], [class*="panel"], [class*="modal"], [class*="sidebar"]'
        );
        additionalElements.forEach((el) => {
            if (el.dataset.originalDisplay) {
                el.style.display = el.dataset.originalDisplay;
            }
        });

        const restoreButton = document.getElementById("restore-ui-button");
        if (restoreButton) {
            restoreButton.remove();
        }

        this.screenshotModeActive = false;
        console.log("UI restored from screenshot mode");
    }
    /**
     * Show all UI elements that were hidden
     */
    showAllUI() {
        this._inShowAllUI = true;

        this.showUI();

        this.showAllOtherUI();

        this._inShowAllUI = false;
    }
    /**
     * Hide the UI
     */
    hideUI() {
        const ui = document.getElementById("seed-generator-ui");
        if (ui) {
            ui.style.display = "none";
        }
    }
    /**
     * Hide all UI elements for clean screenshots and create a restore button
     */
    enterScreenshotMode() {
        this.hideAllUI();

        this.createRestoreUIButton();
    }
    /**
     * Hide all UI elements in the application
     */
    hideAllUI() {
        this.hideUI();

        const toolbar = document.querySelector(".tool-bar");
        if (toolbar) {
            toolbar.dataset.originalDisplay = toolbar.style.display || "flex";
            toolbar.style.display = "none";
        }

        const blockSelector = document.querySelector(".block-type-selector");
        if (blockSelector) {
            blockSelector.dataset.originalDisplay =
                blockSelector.style.display || "flex";
            blockSelector.style.display = "none";
        }

        const buttons = document.querySelectorAll(
            "button:not(#restore-ui-button)"
        );
        buttons.forEach((el) => {
            el.dataset.originalDisplay = el.style.display || "inline-block";
            el.style.display = "none";
        });

        const uiDivs = document.querySelectorAll(
            ".ui-component, .modal, .modal-overlay, .panel, .sidebar, .tool-panel, .menu"
        );
        uiDivs.forEach((el) => {
            if (el.id !== "restore-ui-button-container") {
                el.dataset.originalDisplay = el.style.display || "block";
                el.style.display = "none";
            }
        });

        const additionalElements = document.querySelectorAll(
            '[class*="ui"], [class*="menu"], [class*="toolbar"], [class*="panel"], [class*="modal"], [class*="sidebar"]'
        );
        additionalElements.forEach((el) => {
            if (
                el.id !== "restore-ui-button" &&
                !el.id?.includes("restore-ui")
            ) {
                el.dataset.originalDisplay = el.style.display || "block";
                el.style.display = "none";
            }
        });

        this.screenshotModeActive = true;
        console.log("UI hidden for screenshot mode");
    }
    /**
     * Create a small floating button to restore UI
     */
    createRestoreUIButton() {
        if (document.getElementById("restore-ui-button")) {
            return;
        }

        const container = document.createElement("div");
        container.id = "restore-ui-button-container";

        const button = document.createElement("button");
        button.id = "restore-ui-button";
        button.innerHTML = "🔍 Show UI";
        button.title = "Exit Screenshot Mode";

        button.addEventListener("click", () => {
            this.showAllUI();
        });

        container.appendChild(button);

        document.body.appendChild(container);
        console.log("Restore UI button created");
    }
    /**
     * Activates the tool (called by ToolManager)
     */
    activate() {
        super.activate();
        this.showUI();
    }
    /**
     * Deactivates the tool (called by ToolManager)
     */
    deactivate() {
        super.deactivate();
        this.hideUI();
    }
    /**
     * Clean up when disposing of the tool
     */
    dispose() {
        const restoreButton = document.getElementById("restore-ui-button");
        if (restoreButton) {
            restoreButton.remove();
        }

        const ui = document.getElementById("seed-generator-ui");
        if (ui) {
            ui.remove();
        }
        super.dispose();
    }
    /**
     * Add temperature slider to the UI
     */
    createTemperatureSlider() {
        const container = document.createElement("div");
        container.className = "slider-container";
        container.id = "temperature-slider-container";
        const labelContainer = document.createElement("div");
        labelContainer.className = "slider-label-container";
        const label = document.createElement("label");
        label.htmlFor = "temperature-slider";
        label.textContent = "Temperature";
        label.className = "slider-label";
        const valueDisplay = document.createElement("span");
        valueDisplay.textContent = `${this.generationOptions.temperature}`;
        valueDisplay.className = "slider-value";
        labelContainer.appendChild(label);
        labelContainer.appendChild(valueDisplay);
        const slider = document.createElement("input");
        slider.id = "temperature-slider";
        slider.type = "range";
        slider.min = "0";
        slider.max = "100";
        slider.value = this.generationOptions.temperature;
        slider.className = "generator-slider";
        slider.addEventListener("input", (e) => {
            this.generationOptions.temperature = parseInt(e.target.value);
            valueDisplay.textContent = `${this.generationOptions.temperature}`;
        });
        container.appendChild(labelContainer);
        container.appendChild(slider);
        return container;
    }
    /**
     * Generate a world from a seed value and options
     */
    generateWorldFromSeed(options) {
        console.log("Generating world from seed:", options.seed);
        if (!this.terrainBuilderRef || !this.terrainBuilderRef.current) {
            console.error("TerrainBuilder reference not available");
            this.resetGenerationUI();
            return;
        }

        let seedNum;
        if (typeof options.seed === "string") {
            seedNum = options.seed
                .split("")
                .reduce(
                    (acc, char) => (acc * 31 + char.charCodeAt(0)) & 0xffffffff,
                    0
                );
        } else {
            seedNum = parseInt(options.seed);
        }

        const settings = {
            width: Math.max(10, Math.min(options.width || 200, 1000)),
            length: Math.max(10, Math.min(options.length || 200, 1000)),
            maxHeight: 64,
            clearMap: options.clearMap || true,
            caveDensity: (options.caveDensity || 50) / 100, // Range 0 to 1.0
            biomeDiversity: 0.02 / (1 + (options.biomeSize || 100) / 200), // Range 0.01 to 0.05
            temperature: (options.temperature || 50) / 100, // Convert 0-100 to 0-1

            roughness: (() => {
                const mountainValue = options.mountainHeight || 50;
                if (mountainValue < 30) {
                    return 0.3 + (mountainValue / 30) * 0.2;
                } else if (mountainValue < 70) {
                    return 0.5 + ((mountainValue - 30) / 40) * 1.0;
                } else {
                    return 1.5 + ((mountainValue - 70) / 30) * 2.5;
                }
            })(),
            seaLevel: 32 + Math.round(((options.waterLevel || 50) / 100) * 6), // Map to range 32-38
            flatnessFactor: (options.terrainFlatness || 15) / 100, // MODIFIED: Range 0 to 1.0 to allow perfectly flat terrain
            isCompletelyFlat: options.terrainFlatness >= 98, // Add special flag for completely flat terrain
            oreRarity: 0.83 - ((options.oreDensity || 50) / 100) * 0.18, // MODIFIED: Range 0.83 to 0.65 (limits max ore to ~30%)
            generateOres: options.generateOreDeposits !== false,
            scale:
                0.03 *
                (1000 / Math.max(options.width || 200, options.length || 200)),
            smoothing: 0.7, // Increased smoothing for more natural terrain
            terrainBlend: 0.5,
            riverFreq: 0.05,

            mountainRange: {
                enabled: options.mountainRange > 0,
                size: options.mountainRange / 100, // 0 to 1 scale
                height: Math.round(20 + (options.mountainRange / 100) * 30), // Range: 20-50 blocks high
                snowCap: true,
                snowHeight: Math.round(40 + (options.mountainRange / 100) * 15), // Height at which snow starts
            },
        };

        console.log(
            "Sea level set to:",
            settings.seaLevel,
            "from water level slider value:",
            options.waterLevel
        );

        if (settings.width < 100 || settings.length < 100) {
            console.log(
                "Small world detected, adjusting generation parameters..."
            );
            settings.scale *= 3; // Increase scale for small worlds
            settings.caveDensity *= 0.5; // Fewer caves in small worlds
        } else if (settings.width > 500 || settings.length > 500) {
            console.log(
                "Large world detected, enabling performance optimizations..."
            );

            settings.batchSize = 50000; // Process 50k blocks at a time
            settings.useBatchProcessing = true;

            settings.caveComplexity = 0.7;

            settings.leafSkipProbability = 0.3;

            settings.scale *= 1.2;
            settings.caveDensity *= 0.8;
        } else {
            settings.batchSize = 0; // No batching needed
            settings.useBatchProcessing = false;
            settings.caveComplexity = 1.0;
            settings.leafSkipProbability = 0.1;
        }

        console.log("Generation settings:", {
            seed: options.seed,
            seedNum,
            width: settings.width,
            length: settings.length,
            caveDensity: settings.caveDensity,
            roughness: settings.roughness,
            seaLevel: settings.seaLevel,
            scale: settings.scale,
            useBatchProcessing: settings.useBatchProcessing,
        });

        if (settings.clearMap) {
            this.terrainBuilderRef.current.clearMap();
        }

        const blockTypesList = getBlockTypes();
        const blockTypes = {
            stone: this.findBlockTypeId(blockTypesList, "stone"),
            dirt: this.findBlockTypeId(blockTypesList, "dirt"),
            grass: this.findBlockTypeId(blockTypesList, "grass"),
            sand: this.findBlockTypeId(blockTypesList, "sand"),
            "sand-light": this.findBlockTypeId(blockTypesList, "sand-light"),
            gravel: this.findBlockTypeId(blockTypesList, "gravel"),
            "water-still": this.findBlockTypeId(blockTypesList, "water"),
            "water-flow": this.findBlockTypeId(blockTypesList, "water"),
            lava: this.findBlockTypeId(blockTypesList, "lava"),
            clay: this.findBlockTypeId(blockTypesList, "clay"),
            "oak-leaves": this.findBlockTypeId(blockTypesList, "oak-leaves"),
            "cold-leaves": this.findBlockTypeId(blockTypesList, "cold-leaves"),
            log: this.findBlockTypeId(blockTypesList, "log"),
            "poplar log": this.findBlockTypeId(blockTypesList, "poplar log"),
            sandstone: this.findBlockTypeId(blockTypesList, "sandstone"),
            coal: this.findBlockTypeId(blockTypesList, "coal-ore"),
            iron: this.findBlockTypeId(blockTypesList, "iron-ore"),
            gold: this.findBlockTypeId(blockTypesList, "gold-ore"),
            diamond: this.findBlockTypeId(blockTypesList, "diamond-ore"),
            emerald: this.findBlockTypeId(blockTypesList, "emerald-ore"),
            snow:
                this.findBlockTypeId(blockTypesList, "snow") ||
                this.findBlockTypeId(blockTypesList, "snow-block") ||
                this.findBlockTypeId(blockTypesList, "white-wool"),
            cactus: this.findBlockTypeId(blockTypesList, "cactus"),
        };

        console.log("Block type IDs:", {
            stone: blockTypes.stone,
            cobblestone: blockTypes.cobblestone,
            water: blockTypes["water-still"],
            oakLeaves: blockTypes["oak-leaves"],
            diamond: blockTypes.diamond,
            emerald: blockTypes.emerald,
            clay: blockTypes.clay,
            poplarLog: blockTypes["poplar log"],
            log: blockTypes.log,
        });

        this.showProgressUI();

        try {
            const startTime = performance.now();

            const terrainData = generateHytopiaWorld(
                settings,
                seedNum,
                blockTypes,
                (message, progress) => {
                    this.updateProgressUI(message, progress);
                }
            );
            const endTime = performance.now();
            const generationTime = (endTime - startTime) / 1000;
            console.log(`World generation took ${generationTime} seconds`);

            console.log("terrainData", terrainData);
            if (terrainData) {
                let terrainDataToUse = terrainData?.current || terrainData;
                if (settings.useBatchProcessing) {
                    this.updateTerrainInBatches(
                        terrainDataToUse,
                        settings.batchSize
                    );
                } else {
                    this.terrainBuilderRef.current.updateTerrainFromToolBar(
                        terrainDataToUse
                    );
                    this.hideProgressUI();
                }

                setTimeout(() => this.forceSaveTerrain(terrainDataToUse), 1000);
                return terrainDataToUse;
            }
        } catch (error) {
            console.error("Error generating world:", error);
            this.resetGenerationUI(true);
        }
        return null;
    }
    /**
     * Update terrain data in batches to prevent UI freezing for large worlds
     * @param {Object} terrainData - The generated terrain data
     * @param {number} batchSize - Number of blocks to process in each batch
     */
    updateTerrainInBatches(terrainData, batchSize) {
        const keys = Object.keys(terrainData);
        const totalBlocks = keys.length;
        console.log(
            `Processing ${totalBlocks} blocks in batches of ${batchSize}`
        );
        this.updateProgressUI(
            `Processing terrain (0/${totalBlocks} blocks)...`,
            0
        );
        let currentBatch = 0;
        const totalBatches = Math.ceil(totalBlocks / batchSize);
        const processBatch = () => {
            const startIdx = currentBatch * batchSize;
            const endIdx = Math.min(startIdx + batchSize, totalBlocks);

            const batchData = {};
            for (let i = startIdx; i < endIdx; i++) {
                const key = keys[i];
                batchData[key] = terrainData[key];
            }

            this.terrainBuilderRef.current.updateTerrainFromToolBar(batchData);

            currentBatch++;
            const progress = Math.floor((currentBatch / totalBatches) * 100);
            this.updateProgressUI(
                `Processing terrain (${endIdx}/${totalBlocks} blocks)...`,
                progress
            );
            if (currentBatch < totalBatches) {
                setTimeout(processBatch, 50);
            } else {
                console.log("All batches processed!");
                this.updateProgressUI("World generation complete!", 100);
                if (currentBatch >= totalBatches) {
                    console.log(
                        `Completed processing ${totalBlocks} blocks in ${totalBatches} batches`
                    );
                    this.hideProgressUI();

                    this.forceSaveTerrain(terrainData);
                    return;
                }
            }
        };

        setTimeout(processBatch, 100);
    }
    /**
     * Helper method to find a block type ID by name
     */
    findBlockTypeId(blockTypesList, name) {
        const block = blockTypesList.find(
            (b) => b.name && b.name.toLowerCase().includes(name.toLowerCase())
        );
        if (!block) {
            console.warn(`Block type '${name}' not found, using fallback`);
            return blockTypesList[0]?.id || 1;
        }
        return block.id;
    }
    /**
     * Force save the terrain data to ensure it's in the database
     * @param {Object} terrainData - The terrain data to save
     */
    async forceSaveTerrain(terrainData) {
        if (!terrainData || Object.keys(terrainData).length === 0) {
            console.warn("No terrain data to save");
            return;
        }
        try {
            console.log(
                `Force saving ${
                    Object.keys(terrainData).length
                } blocks to database...`
            );

            const { DatabaseManager, STORES } = await import(
                "../managers/DatabaseManager"
            );

            await DatabaseManager.saveData(
                STORES.TERRAIN,
                "current",
                terrainData
            );
            console.log("Terrain data saved successfully to database");
        } catch (error) {
            console.error("Error force saving terrain:", error);
        }
    }
}
export default SeedGeneratorTool;
