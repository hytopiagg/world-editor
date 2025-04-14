const fs = require("fs");
const path = require("path");

function generateManifest() {
    if (process.env.NODE_ENV === "production") {
        return;
    }
    const modelsDir = path.join(
        __dirname,
        "../public/assets/models/environment"
    );
    const manifestPath = path.join(modelsDir, "mattifest.json");

    // Get all GLTF files in the directory
    const modelFiles = fs
        .readdirSync(modelsDir)
        .filter((file) => file.endsWith(".gltf"));

    // Write the manifest file
    fs.writeFileSync(manifestPath, JSON.stringify(modelFiles, null, 2));

    console.log("Model manifest generated:", modelFiles);
}

generateManifest();
