#!/usr/bin/env node
/**
 * Script to update the block manifest file with new blocks discovered in the assets directory.
 * This ensures that block IDs remain stable when new blocks are added.
 * 
 * Usage: node scripts/update-block-manifest.js
 */

const fs = require('fs');
const path = require('path');

const blocksDir = path.join(__dirname, '../public/assets/blocks');
const manifestPath = path.join(__dirname, '../src/js/blocks/block-manifest.json');

function discoverBlocks(dir, prefix = '') {
    const blockMap = new Map();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    entries.forEach(entry => {
        const fullPath = path.join(dir, entry.name);
        const relativePath = prefix ? path.join(prefix, entry.name) : entry.name;
        
        if (entry.isDirectory()) {
            // Check if this directory has side textures
            const files = fs.readdirSync(fullPath);
            const hasSideTextures = files.some(f => /^[+-][xyz]\.png$/.test(f));
            
            if (hasSideTextures) {
                const blockName = relativePath;
                blockMap.set(blockName, true);
            } else {
                // Recursively search subdirectories
                const subBlocks = discoverBlocks(fullPath, relativePath);
                subBlocks.forEach((_, name) => blockMap.set(name, true));
            }
        } else if (entry.name.endsWith('.png') && !entry.name.includes('error') && !fullPath.includes('environment')) {
            const blockName = prefix || entry.name.replace(/\.png$/, '');
            blockMap.set(blockName, true);
        }
    });
    
    return blockMap;
}

function loadManifest() {
    try {
        const content = fs.readFileSync(manifestPath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        console.warn('Manifest file not found or invalid. Creating new manifest.');
        return {};
    }
}

function saveManifest(manifest) {
    // Sort manifest by ID for readability
    const sortedEntries = Object.entries(manifest).sort((a, b) => a[1] - b[1]);
    const sortedManifest = {};
    sortedEntries.forEach(([name, id]) => {
        sortedManifest[name] = id;
    });
    
    fs.writeFileSync(
        manifestPath,
        JSON.stringify(sortedManifest, null, 2) + '\n',
        'utf8'
    );
}

function main() {
    console.log('Discovering blocks in', blocksDir);
    const discoveredBlocks = discoverBlocks(blocksDir);
    const blockNames = Array.from(discoveredBlocks.keys()).sort();
    
    console.log(`Found ${blockNames.length} blocks`);
    
    const manifest = loadManifest();
    const manifestIds = Object.values(manifest);
    const maxManifestId = manifestIds.length > 0 ? Math.max(...manifestIds) : 0;
    
    let nextNewId = maxManifestId + 1;
    const newBlocks = [];
    const updatedManifest = { ...manifest };
    
    // Add any new blocks that aren't in the manifest
    blockNames.forEach(blockName => {
        if (!manifest[blockName]) {
            updatedManifest[blockName] = nextNewId++;
            newBlocks.push(blockName);
        }
    });
    
    // Remove blocks from manifest that no longer exist
    const removedBlocks = [];
    Object.keys(manifest).forEach(blockName => {
        if (!discoveredBlocks.has(blockName)) {
            delete updatedManifest[blockName];
            removedBlocks.push(blockName);
        }
    });
    
    if (newBlocks.length > 0) {
        console.log(`\nAdded ${newBlocks.length} new block(s) to manifest:`);
        newBlocks.forEach(name => {
            console.log(`  - ${name}: ID ${updatedManifest[name]}`);
        });
    }
    
    if (removedBlocks.length > 0) {
        console.log(`\nRemoved ${removedBlocks.length} block(s) from manifest (no longer exist):`);
        removedBlocks.forEach(name => {
            console.log(`  - ${name}`);
        });
    }
    
    if (newBlocks.length === 0 && removedBlocks.length === 0) {
        console.log('\nNo changes needed. Manifest is up to date.');
        return;
    }
    
    saveManifest(updatedManifest);
    console.log(`\nManifest updated successfully! Saved to ${manifestPath}`);
    console.log(`Total blocks in manifest: ${Object.keys(updatedManifest).length}`);
}

if (require.main === module) {
    main();
}

module.exports = { discoverBlocks, loadManifest, saveManifest };

