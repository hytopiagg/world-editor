/**
 * PerlinNoiseGenerator.js - Utility for generating Perlin noise
 * 
 * This provides functionality for generating 2D and 3D Perlin noise used in
 * terrain generation. It supports octaves, persistence, and seeded randomness.
 */

/**
 * Generate a pseudo-random number based on a seed
 * @param {number} seed - The seed value
 * @returns {function} A seeded random function
 */
function createSeededRandom(seed) {
  return function() {
    // Simple LCG algorithm
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/**
 * Generate a permutation table for Perlin noise
 * @param {number} seed - The seed value
 * @returns {Uint8Array} A permutation table with 512 elements
 */
function generatePermutationTable(seed) {
  const random = createSeededRandom(seed);
  const p = new Uint8Array(256);
  
  // Fill with values from 0 to 255
  for (let i = 0; i < 256; i++) {
    p[i] = i;
  }
  
  // Shuffle
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]]; // Swap
  }
  
  // Duplicate to avoid overflow later
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
  }
  
  return perm;
}

/**
 * Fade function to create smooth transitions
 * @param {number} t - Value to apply fade function to
 * @returns {number} Result of fade function
 */
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Linear interpolation
 * @param {number} a - First value
 * @param {number} b - Second value
 * @param {number} t - Interpolation factor (0-1)
 * @returns {number} Interpolated value
 */
function lerp(a, b, t) {
  return a + t * (b - a);
}

/**
 * Calculate gradient for 2D Perlin noise
 * @param {number} hash - Hash value from permutation table
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @returns {number} Gradient value
 */
function grad2D(hash, x, y) {
  // Convert hash to an index (0-7)
  const h = hash & 7;
  
  // Calculate gradient based on direction
  let u, v;
  if (h < 4) {
    u = x;
    v = y;
  } else {
    u = y;
    v = x;
  }
  
  // Apply direction
  return (((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v));
}

/**
 * Calculate gradient for 3D Perlin noise
 * @param {number} hash - Hash value from permutation table
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} z - Z coordinate
 * @returns {number} Gradient value
 */
function grad3D(hash, x, y, z) {
  // Take the hash value modulo 16 to get an index (0-15)
  const h = hash & 15;
  
  // Select a direction based on the hash
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  
  // Apply direction
  return (((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v));
}

/**
 * Generates a single octave of 2D Perlin noise
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {Uint8Array} perm - Permutation table
 * @returns {number} Noise value (-1 to 1)
 */
function perlin2D(x, y, perm) {
  // Integer coordinates (grid cell)
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  
  // Relative coordinates within cell (0-1)
  x -= Math.floor(x);
  y -= Math.floor(y);
  
  // Compute fade curves
  const u = fade(x);
  const v = fade(y);
  
  // Hash coordinates of the 4 corners
  const A = perm[X] + Y;
  const B = perm[X + 1] + Y;
  const AA = perm[A];
  const BA = perm[B];
  const AB = perm[A + 1];
  const BB = perm[B + 1];
  
  // Interpolate between gradients
  const g1 = grad2D(perm[AA], x, y);
  const g2 = grad2D(perm[BA], x - 1, y);
  const g3 = grad2D(perm[AB], x, y - 1);
  const g4 = grad2D(perm[BB], x - 1, y - 1);
  
  const lerp1 = lerp(g1, g2, u);
  const lerp2 = lerp(g3, g4, u);
  
  // Result is in range [-1, 1]
  return lerp(lerp1, lerp2, v);
}

/**
 * Generates a single octave of 3D Perlin noise
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} z - Z coordinate
 * @param {Uint8Array} perm - Permutation table
 * @returns {number} Noise value (-1 to 1)
 */
function perlin3D(x, y, z, perm) {
  // Integer coordinates (grid cell)
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  
  // Relative coordinates within cell (0-1)
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  
  // Compute fade curves
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  
  // Hash coordinates of the 8 corners
  const A = perm[X] + Y;
  const B = perm[X + 1] + Y;
  const AA = perm[A] + Z;
  const AB = perm[A + 1] + Z;
  const BA = perm[B] + Z;
  const BB = perm[B + 1] + Z;
  
  // Interpolate between gradients
  const g1 = grad3D(perm[AA], x, y, z);
  const g2 = grad3D(perm[BA], x - 1, y, z);
  const g3 = grad3D(perm[AB], x, y - 1, z);
  const g4 = grad3D(perm[BB], x - 1, y - 1, z);
  const g5 = grad3D(perm[AA + 1], x, y, z - 1);
  const g6 = grad3D(perm[BA + 1], x - 1, y, z - 1);
  const g7 = grad3D(perm[AB + 1], x, y - 1, z - 1);
  const g8 = grad3D(perm[BB + 1], x - 1, y - 1, z - 1);
  
  const lerp1 = lerp(g1, g2, u);
  const lerp2 = lerp(g3, g4, u);
  const lerp3 = lerp(g5, g6, u);
  const lerp4 = lerp(g7, g8, u);
  
  const lerp5 = lerp(lerp1, lerp2, v);
  const lerp6 = lerp(lerp3, lerp4, v);
  
  // Result is in range [-1, 1]
  return lerp(lerp5, lerp6, w);
}

/**
 * Generate 2D Perlin noise with multiple octaves
 * @param {number} width - Width of the noise map
 * @param {number} height - Height of the noise map
 * @param {Object} options - Noise generation options
 * @param {number} options.octaveCount - Number of octaves (default: 1)
 * @param {number} options.scale - Scale factor for noise (default: 0.01)
 * @param {number} options.persistence - How much each octave contributes (default: 0.5)
 * @param {number} options.amplitude - Amplitude multiplier (default: 1.0)
 * @param {number} options.seed - Seed for random generation (default: 0)
 * @returns {Float32Array} Generated noise map (0 to 1)
 */
export function generatePerlinNoise(width, height, options = {}) {
  // Set default options
  const octaveCount = options.octaveCount || 1;
  const scale = options.scale || 0.01;
  const persistence = options.persistence || 0.5;
  const amplitude = options.amplitude || 1.0;
  const seed = options.seed || 0;
  
  // Create permutation table based on seed
  const perm = generatePermutationTable(seed);
  
  // Initialize noise array
  const noise = new Float32Array(width * height);
  
  // For each octave
  let maxValue = 0;
  let totalAmplitude = 0;
  
  for (let octave = 0; octave < octaveCount; octave++) {
    // Calculate frequency and amplitude for this octave
    const frequency = Math.pow(2, octave);
    const currentAmplitude = Math.pow(persistence, octave) * amplitude;
    totalAmplitude += currentAmplitude;
    
    // Generate noise for this octave
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = x * scale * frequency;
        const ny = y * scale * frequency;
        
        // Add scaled noise value to our array
        const index = y * width + x;
        noise[index] += perlin2D(nx, ny, perm) * currentAmplitude;
        
        // Track maximum value for normalization
        if (Math.abs(noise[index]) > maxValue) {
          maxValue = Math.abs(noise[index]);
        }
      }
    }
  }
  
  // Normalize to 0-1 range
  for (let i = 0; i < noise.length; i++) {
    // Convert from [-totalAmplitude, totalAmplitude] to [0, 1]
    noise[i] = (noise[i] / totalAmplitude + 1) * 0.5;
  }
  
  return noise;
}

/**
 * Generate 3D Perlin noise with multiple octaves
 * @param {number} width - Width of the noise map
 * @param {number} height - Height of the noise map
 * @param {number} depth - Depth of the noise map
 * @param {Object} options - Noise generation options
 * @param {number} options.octaveCount - Number of octaves (default: 1)
 * @param {number} options.scale - Scale factor for noise (default: 0.01)
 * @param {number} options.persistence - How much each octave contributes (default: 0.5)
 * @param {number} options.amplitude - Amplitude multiplier (default: 1.0)
 * @param {number} options.seed - Seed for random generation (default: 0)
 * @returns {Float32Array} Generated noise map (0 to 1)
 */
export function generatePerlinNoise3D(width, height, depth, options = {}) {
  // Set default options
  const octaveCount = options.octaveCount || 1;
  const scale = options.scale || 0.01;
  const persistence = options.persistence || 0.5;
  const amplitude = options.amplitude || 1.0;
  const seed = options.seed || 0;
  
  // Create permutation table based on seed
  const perm = generatePermutationTable(seed);
  
  // Initialize noise array
  const noise = new Float32Array(width * height * depth);
  
  // For each octave
  let totalAmplitude = 0;
  
  for (let octave = 0; octave < octaveCount; octave++) {
    // Calculate frequency and amplitude for this octave
    const frequency = Math.pow(2, octave);
    const currentAmplitude = Math.pow(persistence, octave) * amplitude;
    totalAmplitude += currentAmplitude;
    
    // Generate noise for this octave
    for (let z = 0; z < depth; z++) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const nx = x * scale * frequency;
          const ny = y * scale * frequency;
          const nz = z * scale * frequency;
          
          // Add scaled noise value to our array
          const index = (z * width * height) + (y * width) + x;
          noise[index] += perlin3D(nx, ny, nz, perm) * currentAmplitude;
        }
      }
    }
  }
  
  // Normalize to 0-1 range
  for (let i = 0; i < noise.length; i++) {
    // Convert from [-totalAmplitude, totalAmplitude] to [0, 1]
    noise[i] = (noise[i] / totalAmplitude + 1) * 0.5;
  }
  
  return noise;
}

export default {
  generatePerlinNoise,
  generatePerlinNoise3D
}; 