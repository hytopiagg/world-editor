const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { parse: parseUrl } = require("url");
const net = require("net");

// __dirname is available in CommonJS modules
const publicDir = path.resolve(__dirname, "../public");
const modelsDir = path.join(publicDir, "assets/models/environment");
const manifestPath = path.join(modelsDir, "mattifest.json");
const thumbnailsDir = path.join(modelsDir, "thumbnails");
const nodeModulesDir = path.resolve(__dirname, "../node_modules");
const threePath = path.join(nodeModulesDir, "three");

// Ensure thumbnails directory exists
fs.mkdirSync(thumbnailsDir, { recursive: true });

if (!fs.existsSync(manifestPath)) {
    console.error(`❌ Model manifest not found at ${manifestPath}`);
    console.error(
        "   Please run 'npm run prebuild' first to generate the manifest"
    );
    process.exit(1);
}

const modelList = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

const getThumbnailHTML = (modelPath, baseUrl) => {
    const escapeJsString = (str) => {
        return str
            .replace(/\\/g, "\\\\")
            .replace(/'/g, "\\'")
            .replace(/"/g, '\\"')
            .replace(/\n/g, "\\n")
            .replace(/\r/g, "\\r");
    };

    const safeBaseUrl = escapeJsString(baseUrl);
    const safeModelPath = escapeJsString(modelPath);

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
    #canvas-container { width: 256px; height: 256px; margin: 0 auto; }
  </style>
</head>
<body>
  <div id="canvas-container"></div>
  <script type="importmap">
    {
      "imports": {
        "three": "${safeBaseUrl}/three/build/three.module.js"
      }
    }
  </script>
  <script>
    window.thumbnailReady = false;
    window.thumbnailError = false;
    window.__consoleMessages = [];
    
    const originalError = console.error;
    console.error = function(...args) {
      window.__consoleMessages.push(args.join(' '));
      originalError.apply(console, args);
    };
    
  </script>
  <script type="module">
    const baseUrl = '${safeBaseUrl}';
    const modelPath = baseUrl + '/assets/models/environment/' + encodeURI('${safeModelPath}');
    
    (async () => {
      try {
        const THREE = await import('three');
        const { GLTFLoader } = await import(baseUrl + '/three/examples/jsm/loaders/GLTFLoader.js');
        
        const container = document.getElementById('canvas-container');
        container.innerHTML = '';
        
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
        
        const canvas = document.createElement('canvas');
        
        const renderer = new THREE.WebGLRenderer({ 
          canvas: canvas,
          antialias: false,
          alpha: true,
          preserveDrawingBuffer: true,
          powerPreference: "high-performance"
        });
        renderer.setSize(256, 256);
        renderer.setPixelRatio(1);
        renderer.setClearColor(0x000000, 0);
        container.appendChild(renderer.domElement);
        
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 5, 5);
        scene.add(directionalLight);
        
        camera.position.set(0, 0, -3);
        camera.lookAt(0, 0, 0);
        
        const loader = new GLTFLoader();
        
        console.log('Loading model from:', modelPath);
        
        const loadTimeout = setTimeout(() => {
          console.error('Model load timeout after 15s for:', modelPath);
          window.thumbnailError = true;
          window.thumbnailReady = true;
        }, 15000);
        
        loader.load(
          modelPath,
          (gltf) => {
            clearTimeout(loadTimeout);
            try {
              const model = gltf.scene;
              scene.add(model);
              const box = new THREE.Box3().setFromObject(model);
              const center = box.getCenter(new THREE.Vector3());
              const size = box.getSize(new THREE.Vector3());
              const maxDim = Math.max(size.x, size.y, size.z);
              const scale = maxDim > 0 ? 1.5 / maxDim : 1;
              model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
              model.scale.set(scale, scale, scale);
              camera.lookAt(0, 0, 0);
              
              let frameCount = 0;
              const render = () => {
                try {
                  model.rotation.y += 0.02;
                  renderer.render(scene, camera);
                  frameCount++;
                  if (frameCount < 15) {
                    requestAnimationFrame(render);
                  } else {
                    try {
                      renderer.dispose();
                    } catch (disposeError) {
                      // Ignore dispose errors
                    }
                    window.thumbnailReady = true;
                  }
                } catch (e) {
                  console.error('Render error:', e);
                  try {
                    renderer.dispose();
                  } catch (disposeError) {
                    // Ignore dispose errors
                  }
                  window.thumbnailError = true;
                  window.thumbnailReady = true;
                }
              };
              render();
            } catch (e) {
              console.error('Model setup error:', e);
              window.thumbnailError = true;
              window.thumbnailReady = true;
            }
          },
          (progress) => {
            // Progress callback
          },
          (error) => {
            clearTimeout(loadTimeout);
            console.error('Error loading model:', error);
            window.thumbnailError = true;
            window.thumbnailReady = true;
          }
        );
      } catch (e) {
        console.error('Initialization error:', e);
        window.thumbnailError = true;
        window.thumbnailReady = true;
      }
    })();
  </script>
</body>
</html>`;
};

async function generateThumbnail(modelPath, browser, baseUrl) {
    // Create nested directory structure based on model path
    const modelDir = path.dirname(modelPath);
    const thumbnailSubDir = modelDir !== "." ? modelDir : "";
    const thumbnailDirPath = path.join(thumbnailsDir, thumbnailSubDir);
    fs.mkdirSync(thumbnailDirPath, { recursive: true });

    const modelName = path.basename(modelPath, ".gltf");
    const thumbnailPath = path.join(thumbnailDirPath, `${modelName}.png`);
    const relativeThumbnailPath = thumbnailSubDir
        ? `thumbnails/${thumbnailSubDir}/${modelName}.png`
        : `thumbnails/${modelName}.png`;

    if (fs.existsSync(thumbnailPath)) {
        // Skipping (thumbnail exists)
        return relativeThumbnailPath;
    }

    const page = await browser.newPage();
    await page.setViewport({ width: 256, height: 256 });

    try {
        const thumbnailUrl = `${baseUrl}/thumbnail.html?model=${encodeURIComponent(
            modelPath
        )}`;
        await page.goto(thumbnailUrl, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
        });

        await new Promise((resolve) => setTimeout(resolve, 1000));

        const scriptsLoaded = await page.evaluate(() => {
            return {
                thumbnailReady: window.thumbnailReady,
                thumbnailError: window.thumbnailError,
            };
        });

        if (scriptsLoaded.thumbnailError) {
            const errorMsg =
                (await page.evaluate(
                    () =>
                        window.__consoleMessages?.join("; ") || "Unknown error"
                )) || "Unknown error";
            throw new Error(`Thumbnail error: ${errorMsg}`);
        }

        await new Promise((resolve) => setTimeout(resolve, 500));

        await page.evaluate(() => {
            return new Promise((resolve, reject) => {
                let attempts = 0;
                const maxAttempts = 150; // 15 seconds
                const checkReady = () => {
                    attempts++;
                    if (window.thumbnailReady) {
                        if (window.thumbnailError) {
                            const errorMsg =
                                window.__consoleMessages?.join("; ") ||
                                "Failed to load model";
                            reject(new Error(errorMsg));
                        } else {
                            resolve();
                        }
                    } else if (attempts >= maxAttempts) {
                        const errorMsg =
                            window.__consoleMessages?.join("; ") ||
                            "Timeout waiting for thumbnail";
                        reject(new Error(errorMsg));
                    } else {
                        setTimeout(checkReady, 100);
                    }
                };
                checkReady();
            });
        });

        const canvas = await page.$("canvas");
        if (canvas) {
            await canvas.screenshot({
                path: thumbnailPath,
                omitBackground: true, // Preserve transparency
            });
            console.log(`✅ Generated thumbnail for ${modelPath}`);
            await page.close();
            return relativeThumbnailPath;
        } else {
            throw new Error("Canvas not found");
        }
    } catch (error) {
        const errorMsg = error?.message || String(error);
        console.error(
            `❌ Failed to generate thumbnail for ${modelPath}: ${errorMsg}`
        );
        if (page) {
            try {
                const pageMessages = await page.evaluate(
                    () => window.__consoleMessages || []
                );
                if (pageMessages.length > 0) {
                    console.error(`   Console messages (last 5):`);
                    pageMessages.slice(-5).forEach((msg, i) => {
                        console.error(`     ${i + 1}. ${msg}`);
                    });
                }
            } catch (e) {
                console.error(`   Could not get debug info: ${e}`);
            }
            await page.close().catch(() => {});
        }
        return null;
    }
}

// Helper function to check if a port is available
function isPortAvailable(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.listen(port, () => {
            server.once("close", () => resolve(true));
            server.close();
        });
        server.on("error", () => resolve(false));
    });
}

// Helper function to find an available port
async function findAvailablePort(startPort = 3001, maxAttempts = 10) {
    for (let i = 0; i < maxAttempts; i++) {
        const port = startPort + i;
        if (await isPortAvailable(port)) {
            return port;
        }
    }
    throw new Error(
        `Could not find an available port starting from ${startPort}`
    );
}

async function main() {
    // Check if we should skip thumbnail generation
    if (process.env.SKIP_THUMBNAILS === "true") {
        console.log("⏭️  Skipping thumbnail generation (SKIP_THUMBNAILS=true)");
        return;
    }

    // Early exit: check if all thumbnails already exist
    let missingThumbnails = 0;
    const modelsToProcess = [];

    for (const modelPath of modelList) {
        const modelDir = path.dirname(modelPath);
        const thumbnailSubDir = modelDir !== "." ? modelDir : "";
        const modelName = path.basename(modelPath, ".gltf");
        const thumbnailPath = path.join(
            thumbnailsDir,
            thumbnailSubDir,
            `${modelName}.png`
        );

        if (!fs.existsSync(thumbnailPath)) {
            missingThumbnails++;
            modelsToProcess.push(modelPath);
        }
    }

    if (missingThumbnails === 0) {
        console.log(
            `✅ All ${modelList.length} thumbnails already exist. Skipping generation.`
        );
        return;
    }

    console.log(
        `🚀 Starting thumbnail generation for ${modelList.length} models...`
    );
    console.log(`   ${missingThumbnails} thumbnails need to be generated`);

    const server = http.createServer((req, res) => {
        // Handle OPTIONS requests for CORS
        if (req.method === "OPTIONS") {
            res.writeHead(200, {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            });
            res.end();
            return;
        }

        const parsedUrl = parseUrl(req.url || "");
        const pathname = parsedUrl.pathname || "";

        // Serve thumbnail HTML page
        if (pathname === "/thumbnail.html") {
            const queryParams = new URLSearchParams(parsedUrl.query || "");
            const modelPath = queryParams.get("model");
            if (!modelPath) {
                res.writeHead(400);
                res.end("Missing model parameter");
                return;
            }
            const protocol = req.headers["x-forwarded-proto"] || "http";
            const host = req.headers.host || "localhost:3001";
            const requestBaseUrl = `${protocol}://${host}`;
            res.writeHead(200, {
                "Content-Type": "text/html",
                "Access-Control-Allow-Origin": "*",
            });
            res.end(
                getThumbnailHTML(decodeURIComponent(modelPath), requestBaseUrl)
            );
            return;
        }

        // Serve Three.js from node_modules
        if (pathname.startsWith("/three/")) {
            const threeFile = pathname.replace("/three/", "");
            const filePath = path.join(threePath, threeFile);

            // Security check
            if (!filePath.startsWith(threePath)) {
                res.writeHead(403);
                res.end("Forbidden");
                return;
            }

            fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(404);
                    res.end("Not found");
                    return;
                }
                const ext = path.extname(filePath);
                let contentType = "application/javascript";
                if (ext === ".js" || ext === ".mjs") {
                    contentType = "application/javascript";
                }
                res.writeHead(200, {
                    "Content-Type": contentType,
                    "Access-Control-Allow-Origin": "*",
                });
                res.end(data);
            });
            return;
        }

        // Serve assets from public directory
        const decodedPathname = decodeURIComponent(pathname);
        const filePath = path.join(publicDir, decodedPathname);
        if (!filePath.startsWith(publicDir)) {
            res.writeHead(403);
            res.end("Forbidden");
            return;
        }
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end("Not found");
                return;
            }
            const ext = path.extname(filePath);
            let contentType = "application/octet-stream";
            if (ext === ".gltf") {
                contentType = "model/gltf+json";
            } else if (ext === ".glb") {
                contentType = "model/gltf-binary";
            } else if (ext === ".png") {
                contentType = "image/png";
            } else if (ext === ".jpg" || ext === ".jpeg") {
                contentType = "image/jpeg";
            }
            res.writeHead(200, {
                "Content-Type": contentType,
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            });
            res.end(data);
        });
    });

    // Find an available port
    const port = await findAvailablePort(3001);
    await new Promise((resolve, reject) => {
        server.on("error", (err) => {
            if (err.code === "EADDRINUSE") {
                reject(new Error(`Port ${port} is already in use`));
            } else {
                reject(err);
            }
        });
        server.listen(port, () => {
            // Started local server
            resolve();
        });
    });

    const baseUrl = `http://localhost:${port}`;
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
        ],
    });

    // Process models in parallel batches
    const batchSize = 6; // Process 6 thumbnails in parallel
    let successCount = 0;
    let skipCount = modelList.length - modelsToProcess.length;
    let failCount = 0;

    // Process models in batches
    for (let i = 0; i < modelsToProcess.length; i += batchSize) {
        const batch = modelsToProcess.slice(i, i + batchSize);
        const results = await Promise.all(
            batch.map(async (modelPath) => {
                const thumbnail = await generateThumbnail(
                    modelPath,
                    browser,
                    baseUrl
                );
                if (thumbnail) {
                    successCount++;
                    return thumbnail;
                } else {
                    failCount++;
                    return null;
                }
            })
        );

        // Progress tracking
    }

    await browser.close();
    server.close();

    console.log(`\n✨ Thumbnail generation complete!`);
    console.log(`   ✅ Generated: ${successCount}`);
    console.log(`   ⏭️  Skipped: ${skipCount}`);
    console.log(`   ❌ Failed: ${failCount}`);
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
