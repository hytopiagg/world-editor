#!/usr/bin/env node
/**
 * Script to generate block manifest from a specific commit and extend with current blocks.
 * This ensures stable IDs for blocks that existed at a baseline commit.
 * 
 * Usage: node scripts/generate-manifest-from-commit.js <commit-hash>
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const blocksDir = path.join(__dirname, '../public/assets/blocks');
const manifestPath = path.join(__dirname, '../src/js/blocks/block-manifest.json');

function discoverBlocksFromGit(commitHash) {
    const blockMap = new Map();
    
    try {
        // Get all PNG files from the commit
        const output = execSync(
            `git ls-tree -r --name-only ${commitHash} public/assets/blocks/`,
            { cwd: path.join(__dirname, '..'), encoding: 'utf8' }
        );
        
        const files = output.split('\n').filter(line => {
            return line.endsWith('.png') && 
                   !line.includes('error') && 
                   !line.includes('environment') &&
                   line.startsWith('public/assets/blocks/');
        });
        
        files.forEach(filePath => {
            // Remove the prefix and extract block name
            const relativePath = filePath.replace('public/assets/blocks/', '');
            
            // Handle side textures: "block-name/+x.png" -> "block-name"
            const sideMatch = relativePath.match(/^(.+)\/[+-][xyz]\.png$/);
            if (sideMatch) {
                const blockName = sideMatch[1];
                blockMap.set(blockName, true);
            } else {
                // Regular texture: "block-name.png" -> "block-name"
                const blockName = relativePath.replace(/\.png$/, '');
                blockMap.set(blockName, true);
            }
        });
    } catch (error) {
        console.error(`Error discovering blocks from git commit ${commitHash}:`, error.message);
        throw error;
    }
    
    return blockMap;
}

function discoverBlocks(dir, prefix = '') {
    const blockMap = new Map();
    
    if (!fs.existsSync(dir)) {
        return blockMap;
    }
    
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

function generateManifestFromBlocks(blockNames) {
    const manifest = {};
    const sortedNames = Array.from(blockNames).sort();
    
    sortedNames.forEach((name, index) => {
        manifest[name] = index + 1; // Start IDs from 1
    });
    
    return manifest;
}

function main() {
    const commitHash = process.argv[2];
    
    if (!commitHash) {
        console.error('Usage: node scripts/generate-manifest-from-commit.js <commit-hash>');
        process.exit(1);
    }
    
    console.log(`Generating manifest from commit ${commitHash}...`);
    
    // Verify commit exists
    try {
        execSync(`git cat-file -e ${commitHash}`, { stdio: 'ignore' });
    } catch (error) {
        console.error(`Error: Commit ${commitHash} not found in git history`);
        process.exit(1);
    }
    
    // Create temporary directory for checkout
    const tempDir = path.join(__dirname, '../temp-blocks-checkout');
    const tempBlocksDir = path.join(tempDir, 'public/assets/blocks');
    
    try {
        // Discover blocks directly from git without modifying working directory
        console.log('Discovering blocks from commit...');
        const baselineBlocks = discoverBlocksFromGit(commitHash);
        const baselineBlockNames = Array.from(baselineBlocks.keys()).sort();
        
        console.log(`Found ${baselineBlockNames.length} blocks in commit ${commitHash}`);
        
        // Generate manifest from baseline blocks
        const baselineManifest = generateManifestFromBlocks(baselineBlockNames);
        
        // Discover current blocks
        console.log('Discovering current blocks...');
        const currentBlocks = discoverBlocks(blocksDir);
        const currentBlockNames = Array.from(currentBlocks.keys());
        
        console.log(`Found ${currentBlockNames.length} blocks in current state`);
        
        // Extend manifest with new blocks
        const manifest = { ...baselineManifest };
        const manifestIds = Object.values(manifest);
        const maxManifestId = manifestIds.length > 0 ? Math.max(...manifestIds) : 0;
        let nextNewId = maxManifestId + 1;
        
        const newBlocks = [];
        currentBlockNames.forEach(blockName => {
            if (!manifest[blockName]) {
                manifest[blockName] = nextNewId++;
                newBlocks.push(blockName);
            }
        });
        
        if (newBlocks.length > 0) {
            console.log(`\nAdded ${newBlocks.length} new block(s) to manifest:`);
            newBlocks.forEach(name => {
                console.log(`  - ${name}: ID ${manifest[name]}`);
            });
        } else {
            console.log('\nNo new blocks found. Manifest matches baseline.');
        }
        
        // Sort manifest by ID for readability
        const sortedEntries = Object.entries(manifest).sort((a, b) => a[1] - b[1]);
        const sortedManifest = {};
        sortedEntries.forEach(([name, id]) => {
            sortedManifest[name] = id;
        });
        
        // Save manifest
        fs.writeFileSync(
            manifestPath,
            JSON.stringify(sortedManifest, null, 2) + '\n',
            'utf8'
        );
        
        console.log(`\nManifest generated successfully!`);
        console.log(`Total blocks in manifest: ${Object.keys(sortedManifest).length}`);
        console.log(`Baseline blocks: ${baselineBlockNames.length}`);
        console.log(`New blocks: ${newBlocks.length}`);
        console.log(`Manifest saved to: ${manifestPath}`);
        
    } catch (error) {
        console.error('Error:', error.message);
        
        // Try to restore blocks on error
        try {
            execSync(
                `git checkout HEAD -- public/assets/blocks`,
                { cwd: path.join(__dirname, '..'), stdio: 'ignore' }
            );
        } catch (restoreError) {
            console.error('Warning: Failed to restore blocks directory');
        }
        
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { discoverBlocks, generateManifestFromBlocks };

