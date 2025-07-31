/*
  Focused unit test around the low-level mouse handler helper to ensure that a
  single left-click enters block-placing mode and triggers the placement logic
  (handleBlockPlacement).
*/

// ---------------------------------------------------------------------------
// Test setup & mocks – we mirror the lightweight mocks used in the existing
// TerrainMouseUtils test suite so that we do not pull in heavy real
// dependencies.
// ---------------------------------------------------------------------------

// Provide minimal THREE mocks (same as in TerrainMouseUtils.test.js)
jest.mock("three", () => {
    class Vector3 {
        constructor(x = 0, y = 0, z = 0) {
            this.x = x;
            this.y = y;
            this.z = z;
        }
        copy(v) {
            this.x = v.x;
            this.y = v.y;
            this.z = v.z;
            return this;
        }
    }
    return {
        Vector3,
        Vector2: Vector3,
        Plane: class {},
        MOUSE: { PAN: 0, ROTATE: 1 },
    };
});

// Mock the sound helper so no audio asset is loaded
jest.mock("../js/Sound", () => ({ playPlaceSound: jest.fn() }));

// Import after mocks
const { handleTerrainMouseDown } = require("../js/utils/TerrainMouseUtils");
const { playPlaceSound } = require("../js/Sound");

// Helper to build the various ref objects expected by the mouse helpers
function createMockRefs() {
    return {
        toolManagerRef: {
            current: { getActiveTool: jest.fn().mockReturnValue(null) },
        },
        isPlacingRef: { current: false },
        placedBlockCountRef: { current: 0 },
        placedEnvironmentCountRef: { current: 0 },
        recentlyPlacedBlocksRef: { current: new Set() },
        placementChangesRef: {
            current: {
                terrain: { added: {}, removed: {} },
                environment: { added: [], removed: [] },
            },
        },
        currentPlacingYRef: { current: 64 },
        previewPositionRef: { current: { x: 0, y: 64, z: 0, copy: jest.fn() } },
        rawPlacementAnchorRef: { current: { copy: jest.fn() } },
        isFirstBlockRef: { current: false },
    };
}

// Stub three.js raycaster minimal implementation
function createMockRaycaster() {
    return {
        ray: { intersectPlane: jest.fn() },
    };
}

// Basic camera manager stub (matching API used by the utility functions)
const cameraManager = {
    isPointerUnlockedMode: true,
    isPointerLocked: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Single-block placement", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("enters placing mode and invokes handleBlockPlacement exactly once on left mouse down", () => {
        const refs = createMockRefs();
        const threeRaycaster = createMockRaycaster();

        // We supply our own implementation of handleBlockPlacement that simply
        // records that it was invoked.
        const handleBlockPlacement = jest.fn();

        const mouseEvent = { button: 0, type: "mousedown" };

        handleTerrainMouseDown(
            mouseEvent,
            refs.toolManagerRef,
            refs.isPlacingRef,
            refs.placedBlockCountRef,
            refs.placedEnvironmentCountRef,
            refs.recentlyPlacedBlocksRef,
            refs.placementChangesRef,
            () => null, // getRaycastIntersection stub
            refs.currentPlacingYRef,
            refs.previewPositionRef,
            refs.rawPlacementAnchorRef,
            refs.isFirstBlockRef,
            jest.fn(), // updatePreviewPosition stub
            handleBlockPlacement,
            playPlaceSound,
            threeRaycaster,
            cameraManager,
            { current: { id: 1, isEnvironment: false } }
        );

        // We should now be in placing mode and our placement callback should
        // have been called exactly once.
        expect(refs.isPlacingRef.current).toBe(true);
        expect(handleBlockPlacement).toHaveBeenCalledTimes(1);
        // It should also have played the placement sound once.
        expect(playPlaceSound).toHaveBeenCalledTimes(1);
    });
});
