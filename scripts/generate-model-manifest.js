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

    // Recursively collect all GLTF files within the directory tree
    const getAllGltfFiles = (dir, base = modelsDir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        let files = [];
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                files = files.concat(getAllGltfFiles(fullPath, base));
            } else if (entry.isFile() && entry.name.endsWith(".gltf")) {
                // Store POSIX-style relative path so it works across OSes
                const relPath = path
                    .relative(base, fullPath)
                    .replace(/\\/g, "/");
                files.push(relPath);
            }
        }
        return files;
    };

    const modelFiles = getAllGltfFiles(modelsDir);

    // Write the manifest file
    fs.writeFileSync(manifestPath, JSON.stringify(modelFiles, null, 2));

    console.log("Model manifest generated:", modelFiles);
}

generateManifest();
