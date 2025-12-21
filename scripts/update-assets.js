#!/usr/bin/env node
/**
 * Master script to update all assets from the @hytopia.com/assets package.
 * This script:
 * 1. Updates the @hytopia.com/assets package to the latest version
 * 2. Copies blocks from node_modules to public/assets/blocks
 * 3. Copies models from node_modules to public/assets/models
 * 4. Regenerates the model manifest
 * 5. Updates the block manifest
 * 6. Generates thumbnails for any new models
 *
 * Usage: npm run update:assets
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const nodeModulesAssetsDir = path.join(
    projectRoot,
    "node_modules/@hytopia.com/assets"
);
const publicAssetsDir = path.join(projectRoot, "public/assets");

// Asset paths
const sourceBlocksDir = path.join(nodeModulesAssetsDir, "blocks");
const sourceModelsDir = path.join(nodeModulesAssetsDir, "models");
const destBlocksDir = path.join(publicAssetsDir, "blocks");
const destModelsDir = path.join(publicAssetsDir, "models");

/**
 * Recursively copy a directory, preserving structure
 */
function copyDirectory(src, dest, options = {}) {
    const { exclude = [], fileExtensions = null } = options;

    if (!fs.existsSync(src)) {
        console.warn(`   ⚠️  Source directory does not exist: ${src}`);
        return { copied: 0, skipped: 0 };
    }

    // Create destination directory if it doesn't exist
    fs.mkdirSync(dest, { recursive: true });

    const entries = fs.readdirSync(src, { withFileTypes: true });
    let copied = 0;
    let skipped = 0;

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        // Skip excluded patterns
        if (exclude.some((pattern) => entry.name.includes(pattern))) {
            skipped++;
            continue;
        }

        if (entry.isDirectory()) {
            const result = copyDirectory(srcPath, destPath, options);
            copied += result.copied;
            skipped += result.skipped;
        } else if (entry.isFile()) {
            // Check file extension filter if specified
            if (fileExtensions) {
                const ext = path.extname(entry.name).toLowerCase();
                if (!fileExtensions.includes(ext)) {
                    skipped++;
                    continue;
                }
            }

            // Copy file (overwrite if exists)
            fs.copyFileSync(srcPath, destPath);
            copied++;
        }
    }

    return { copied, skipped };
}

/**
 * Clean up destination directory before copying (optional)
 * Preserves thumbnails and other generated content
 */
function cleanDestination(destDir, preservePatterns = []) {
    if (!fs.existsSync(destDir)) {
        return;
    }

    const entries = fs.readdirSync(destDir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(destDir, entry.name);

        // Skip preserved patterns
        if (preservePatterns.some((pattern) => entry.name.includes(pattern))) {
            continue;
        }

        if (entry.isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
            fs.unlinkSync(fullPath);
        }
    }
}

async function main() {
    console.log("🚀 Updating assets from @hytopia.com/assets package...\n");

    try {
        // Step 1: Update the assets package
        console.log("📦 Step 1: Updating @hytopia.com/assets package...");
        try {
            execSync("npm update @hytopia.com/assets", {
                cwd: projectRoot,
                stdio: "inherit",
            });
            console.log("✅ Assets package updated\n");
        } catch (error) {
            // Package might not be installed yet, try installing it
            console.log(
                "   Package not found, installing @hytopia.com/assets..."
            );
            execSync("npm install @hytopia.com/assets --save", {
                cwd: projectRoot,
                stdio: "inherit",
            });
            console.log("✅ Assets package installed\n");
        }

        // Verify the package exists
        if (!fs.existsSync(nodeModulesAssetsDir)) {
            throw new Error(
                `Assets package not found at ${nodeModulesAssetsDir}. Please run 'npm install' first.`
            );
        }

        // Read package version
        const packageJsonPath = path.join(nodeModulesAssetsDir, "package.json");
        const packageJson = JSON.parse(
            fs.readFileSync(packageJsonPath, "utf-8")
        );
        console.log(`   📌 Using @hytopia.com/assets version ${packageJson.version}\n`);

        // Step 2: Copy blocks
        console.log("🧱 Step 2: Copying block textures...");
        if (fs.existsSync(sourceBlocksDir)) {
            // Clean destination but preserve any non-asset files
            cleanDestination(destBlocksDir, ["thumbnails", "manifest"]);

            const blockResult = copyDirectory(sourceBlocksDir, destBlocksDir, {
                fileExtensions: [".png", ".jpg", ".jpeg"],
            });
            console.log(
                `✅ Copied ${blockResult.copied} block textures (${blockResult.skipped} skipped)\n`
            );
        } else {
            console.log("   ⚠️  No blocks directory found in assets package\n");
        }

        // Step 3: Copy models
        console.log("🎨 Step 3: Copying 3D models...");
        if (fs.existsSync(sourceModelsDir)) {
            // Get all model subdirectories
            const modelCategories = fs
                .readdirSync(sourceModelsDir, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name);

            let totalCopied = 0;
            let totalSkipped = 0;

            for (const category of modelCategories) {
                const srcCategoryDir = path.join(sourceModelsDir, category);
                const destCategoryDir = path.join(destModelsDir, category);

                // Clean destination but preserve thumbnails and manifest
                cleanDestination(destCategoryDir, [
                    "thumbnails",
                    "mattifest.json",
                    "manifest",
                ]);

                const result = copyDirectory(srcCategoryDir, destCategoryDir, {
                    exclude: [".optimized", ".DS_Store"],
                    fileExtensions: [
                        ".gltf",
                        ".glb",
                        ".bin",
                        ".png",
                        ".jpg",
                        ".jpeg",
                        ".json",
                        ".bbmodel",
                        ".psd",
                    ],
                });

                console.log(
                    `   📁 ${category}: ${result.copied} files copied`
                );
                totalCopied += result.copied;
                totalSkipped += result.skipped;
            }

            console.log(
                `✅ Copied ${totalCopied} model files total (${totalSkipped} skipped)\n`
            );
        } else {
            console.log("   ⚠️  No models directory found in assets package\n");
        }

        // Step 4: Regenerate model manifest
        console.log("📋 Step 4: Regenerating model manifest...");
        execSync("node scripts/generate-model-manifest.js", {
            cwd: projectRoot,
            stdio: "inherit",
        });
        console.log("✅ Model manifest regenerated\n");

        // Step 5: Update block manifest
        console.log("📋 Step 5: Updating block manifest...");
        execSync("node scripts/update-block-manifest.js", {
            cwd: projectRoot,
            stdio: "inherit",
        });
        console.log("✅ Block manifest updated\n");

        // Step 6: Generate thumbnails for new models
        console.log("🖼️  Step 6: Generating thumbnails for new models...");
        execSync("node scripts/generate-model-thumbnails.js", {
            cwd: projectRoot,
            stdio: "inherit",
        });
        console.log("✅ Thumbnails generated\n");

        // Step 7: Regenerate manifest with thumbnails
        console.log(
            "📋 Step 7: Regenerating model manifest with thumbnail paths..."
        );
        execSync("node scripts/generate-model-manifest.js", {
            cwd: projectRoot,
            stdio: "inherit",
        });
        console.log("✅ Model manifest updated with thumbnails\n");

        console.log("✨ All done! Assets updated successfully.");
        console.log("   Run 'npm start' to see the changes in the editor.\n");
    } catch (error) {
        console.error("\n❌ Error:", error.message);
        process.exit(1);
    }
}

main();

