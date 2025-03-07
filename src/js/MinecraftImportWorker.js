import JSZip from "jszip";
import init, { McWorld, Vec2, Vec3 } from "mc_importer";

const REGION_FILE_NAME_PATTERN = /^r\.(-?[0-9]+)\.(-?[0-9]+)\.mca$/;

let wasmInitialized = false;

const onMessage = async (event) => {
    if(!event.data) return

    const {
       file,
       region,
       rules
    } = event.data;

    if(!wasmInitialized) {
        postMessage({type: "update", message: "Initializing Wasm"});
        await init();
        wasmInitialized = true;
    }
    
    postMessage({type: "update", message: "Unpacking Region Files"});

    if(file.type !== "application/x-zip-compressed") {
        postMessage({type: "failure", message: "Unsupported File Type"});
        return
    }

    const files = await unpackRegionFiles(file, region)

    postMessage({type: "update", message: "Loading Regions"});

    const mcWorld = new McWorld();

    let minChunk = null;
    let maxChunk = null;
    if(region) {
        minChunk = new Vec2(region.minX >> 4, region.minZ >> 4)
        maxChunk = new Vec2(region.maxX >> 4, region.maxZ >> 4)
    }

    try {
        for(const regionFile of files) {
            mcWorld.read_region(
                new Vec2(regionFile.x, regionFile.z),
                minChunk,
                maxChunk,
                regionFile.data
            )
        }
    } catch(error) {
        postMessage({type: "failure", message: error.message});
        return
    }
    
    postMessage({type: "update", message: `Converting ${region === null ? "World" : "Region"}`});

    let min = null;
    let max = null;
    if(region) {
        min = new Vec3(region.minX, region.minY, region.minZ);
        max = new Vec3(region.maxX, region.maxY, region.maxZ);
    }

    try {
        const terrain = mcWorld.convert(min, max, rules);
        postMessage({type: "success", terrain: terrain});
        return
    } catch(error) {
        postMessage({type: "failure", message: error.message});    
    }
}
addEventListener("message", onMessage);

const unpackRegionFiles = async (file, region) => {
    let fileName = file.name;

    const zip = new JSZip();
    await zip.loadAsync(file);
    
    if(fileName.toLowerCase().includes(".zip")) {
        fileName = fileName.substring(fileName.lastIndexOf('.'));
    }

    let minRegionX = Number.MIN_SAFE_INTEGER;
    let minRegionZ = Number.MIN_SAFE_INTEGER;
    let maxRegionX = Number.MAX_SAFE_INTEGER;
    let maxRegionZ = Number.MAX_SAFE_INTEGER;
    
    if(region) {
        minRegionX = region.minX >> 4 >> 5;
        minRegionZ = region.minX >> 4 >> 5;
        maxRegionX = region.maxX >> 4 >> 5;
        maxRegionZ = region.maxX >> 4 >> 5;
    }

    const files = [];

    for(const [path, file] of Object.entries(zip.files)) {
        if(!path.includes("region/") || file.dir) {
            continue;
        }

        let regionFileName = file.name;
        if(regionFileName.includes("/")) {
            regionFileName = file.name.substring(file.name.lastIndexOf('/') + 1);
        }

        if(!regionFileName.match(REGION_FILE_NAME_PATTERN)) {
            console.error(regionFileName + " is not a valid world region")
            continue;
        }

        const capturedGroups = REGION_FILE_NAME_PATTERN.exec(regionFileName);

        const x = parseInt(capturedGroups[1]);
        const z = parseInt(capturedGroups[2]);

        if(x < minRegionX || x > maxRegionX || z < minRegionZ || z > maxRegionZ) {
            continue;
        }

        const data = await file.async("blob");
        const arrayBuffer = await data.arrayBuffer();
        files.push({
            x: x,
            z: z,
            data: new Uint8Array(arrayBuffer)
        });
    }
    return files;
}
