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
    const thumbnailsDir = path.join(modelsDir, "thumbnails");

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

    // If thumbnails exist, create enhanced manifest with thumbnail paths
    const enhancedManifest = modelFiles.map((modelPath) => {
        const modelDir = path.dirname(modelPath);
        const thumbnailSubDir = modelDir !== "." ? modelDir : "";
        const modelName = path.basename(modelPath, ".gltf");
        const thumbnailPath = path.join(
            thumbnailsDir,
            thumbnailSubDir,
            `${modelName}.png`
        );

        const entry = {
            path: modelPath,
            thumbnail: null,
        };

        // Check if thumbnail exists
        if (fs.existsSync(thumbnailPath)) {
            const thumbnailRelPath = thumbnailSubDir
                ? `thumbnails/${thumbnailSubDir}/${modelName}.png`
                : `thumbnails/${modelName}.png`;
            entry.thumbnail = thumbnailRelPath;
        }

        return entry;
    });

    // Check if all entries have thumbnails - if so, use enhanced format
    const allHaveThumbnails = enhancedManifest.every(
        (entry) => entry.thumbnail !== null
    );

    // Write the manifest file
    // If all have thumbnails, use enhanced format; otherwise, use simple array for backward compatibility
    if (allHaveThumbnails && enhancedManifest.length > 0) {
        fs.writeFileSync(
            manifestPath,
            JSON.stringify(enhancedManifest, null, 2)
        );
        console.log(
            `Model manifest generated with thumbnails: ${enhancedManifest.length} models`
        );
    } else {
        // Fallback to simple array format for backward compatibility
        fs.writeFileSync(manifestPath, JSON.stringify(modelFiles, null, 2));
        console.log(`Model manifest generated: ${modelFiles.length} models`);
        if (enhancedManifest.some((e) => e.thumbnail)) {
            console.log(
                `   Note: Some thumbnails exist but not all. Run 'npm run build:thumbnails' to generate missing thumbnails.`
            );
        }
    }
}

generateManifest();
