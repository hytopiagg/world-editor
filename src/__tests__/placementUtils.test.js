/*
  Tests for the coordinate-calculation helpers used during block and model
  placement. These helpers are private to TerrainBuilder.js and
  EnvironmentBuilder.tsx, so we access them via `rewire` which lets us peek at
  non-exported symbols without having to change production code.
*/

// ---------------------------------------------------------------------------
// Test setup & mocks
// ---------------------------------------------------------------------------

// Mock BlockTypesManager early to avoid webpack-specific require.context
jest.mock("../js/managers/BlockTypesManager", () => ({
    blockTypes: [],
    getCustomBlocks: () => [],
}));

// Mock three.js example modules that are pulled in when the full files are
// evaluated – we only need the placement utilities.
jest.mock("three/examples/jsm/loaders/GLTFLoader", () => ({
    GLTFLoader: jest.fn(),
}));
jest.mock("three/examples/jsm/utils/BufferGeometryUtils", () => ({
    mergeGeometries: jest.fn(),
}));
jest.mock("@hcaptcha/react-hcaptcha", () => () => null);
jest.mock("three/examples/jsm/controls/OrbitControls", () => ({
    OrbitControls: jest.fn(),
}));

// Mock anything else heavy that may be required transitively
jest.mock("../js/managers/DatabaseManager", () => ({
    DatabaseManager: {},
    STORES: {},
}));

// We no longer need rewire; modules expose helpers in test env

describe("Placement helpers", () => {
    // -------------------------------------------------------------------------
    // TerrainBuilder.getPlacementPositions
    // -------------------------------------------------------------------------
    // Additional mocks to stop heavy managers from executing inside TerrainBuilder
    jest.mock("../js/managers/SpatialGridManager", () => ({
        SpatialGridManager: class {},
    }));
    jest.mock("../js/managers/SpatialHashUpdateManager", () => ({
        spatialHashUpdateManager: {},
    }));
    jest.mock("../js/managers/MouseButtonManager", () => ({
        initializeMouseButtonTracking: () => {},
        mouseButtonDown: () => false,
    }));
    jest.mock("../js/Sound", () => ({ playPlaceSound: jest.fn() }));

    // Provide a no-op Worker to satisfy new Worker() calls if any slip through
    // eslint-disable-next-line no-undef
    // eslint-disable-next-line no-undef
    global.Worker = class {
        postMessage() {}
        terminate() {}
    };

    const TerrainBuilderModule = require("../js/TerrainBuilder.js");
    const tb_getPlacementPositions = TerrainBuilderModule.getPlacementPositions;

    describe("TerrainBuilder.getPlacementPositions", () => {
        const center = { x: 0, y: 64, z: 0 };

        it('returns the single center position for "single"', () => {
            expect(tb_getPlacementPositions(center, "single")).toEqual([
                { x: 0, y: 64, z: 0 },
            ]);
        });

        it("generates a 3×3 square (9 blocks)", () => {
            const positions = tb_getPlacementPositions(center, "3x3");
            expect(positions).toHaveLength(9);
            // Contain corners e.g. (+1,+1) and (-1,-1)
            expect(positions).toContainEqual({ x: 1, y: 64, z: 1 });
            expect(positions).toContainEqual({ x: -1, y: 64, z: -1 });
        });

        it("generates a 5×5 diamond (25 blocks minus corners, 13 positions)", () => {
            const positions = tb_getPlacementPositions(center, "5x5diamond");
            // Mathematical count: radius 2 diamond = 1 + 8 + 4 = 13
            expect(positions).toHaveLength(13);
            // Check farthest cardinal points (±2, 0)
            expect(positions).toContainEqual({ x: 2, y: 64, z: 0 });
            expect(positions).toContainEqual({ x: -2, y: 64, z: 0 });
        });

        it("generates a 3×3 diamond (5 positions)", () => {
            const positions = tb_getPlacementPositions(center, "3x3diamond");
            expect(positions).toHaveLength(5);
            expect(positions).toContainEqual({ x: 0, y: 64, z: 0 }); // center
            expect(positions).toContainEqual({ x: 1, y: 64, z: 0 }); // east
            expect(positions).toContainEqual({ x: -1, y: 64, z: 0 }); // west
            expect(positions).toContainEqual({ x: 0, y: 64, z: 1 }); // south
            expect(positions).toContainEqual({ x: 0, y: 64, z: -1 }); // north
        });

        it("generates a 5×5 square (25 positions)", () => {
            const positions = tb_getPlacementPositions(center, "5x5");
            expect(positions).toHaveLength(25);
            expect(positions).toContainEqual({ x: 2, y: 64, z: 2 }); // corner
            expect(positions).toContainEqual({ x: -2, y: 64, z: -2 }); // opposite corner
        });
    });
});
