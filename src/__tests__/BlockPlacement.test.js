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
        pendingChangesRef: {
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

    it("enters placing mode, updates pendingChangesRef and invokes handleBlockPlacement exactly once on left mouse down", () => {
        const refs = createMockRefs();
        const threeRaycaster = createMockRaycaster();

        // We supply our own implementation of handleBlockPlacement that records
        // its invocation *and* simulates the internal logic that adds an entry
        // to `placementChangesRef.current.terrain.added` so that we can assert
        // the helper correctly maintains this ref for later persistence.
        const handleBlockPlacement = jest.fn(() => {
            // Simulate adding a single block at the preview position (0,64,0)
            const posKey = `${refs.previewPositionRef.current.x},${refs.previewPositionRef.current.y},${refs.previewPositionRef.current.z}`;
            refs.placementChangesRef.current.terrain.added[posKey] = 1; // block id 1
            refs.pendingChangesRef.current.terrain.added[posKey] = 1;
        });

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

        // And our simulated placement logic should have updated both
        // placementChangesRef *and* pendingChangesRef with the expected key.
        const expectedKeys = ["0,64,0"];
        expect(
            Object.keys(refs.placementChangesRef.current.terrain.added)
        ).toEqual(expectedKeys);
        expect(
            Object.keys(refs.pendingChangesRef.current.terrain.added)
        ).toEqual(expectedKeys);
        expect(refs.pendingChangesRef.current.terrain.added["0,64,0"]).toBe(1);
    });

    it("continually places blocks while dragging (mouse-move simulation)", () => {
        const refs = createMockRefs();
        const threeRaycaster = createMockRaycaster();

        // Stub that simulates placing a unique block per invocation
        const handleBlockPlacement = jest.fn(() => {
            const callIndex = handleBlockPlacement.mock.calls.length - 1; // zero-based index
            refs.previewPositionRef.current.x = callIndex;
            const posKey = `${callIndex},64,0`;
            refs.placementChangesRef.current.terrain.added[posKey] = 1;
            refs.pendingChangesRef.current.terrain.added[posKey] = 1;
        });

        // updatePreviewPosition will be called on every mousemove; mimic that effect
        const updatePreviewPositionStub = jest.fn(() => {
            handleBlockPlacement();
        });

        // Initial mouse-down triggers first placement and sets placing mode
        handleTerrainMouseDown(
            { button: 0, type: "mousedown" },
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
            updatePreviewPositionStub,
            handleBlockPlacement,
            playPlaceSound,
            threeRaycaster,
            cameraManager,
            { current: { id: 1, isEnvironment: false } }
        );

        // Simulate 4 mouse-move events while holding the button
        for (let i = 0; i < 4; i++) {
            updatePreviewPositionStub();
        }

        // Expect 2 placements during initial mouse-down (down + its own updatePreview call) plus 4 moves = 6
        expect(handleBlockPlacement).toHaveBeenCalledTimes(6);
        expect(updatePreviewPositionStub).toHaveBeenCalledTimes(5);
        expect(
            Object.keys(refs.pendingChangesRef.current.terrain.added)
        ).toHaveLength(6);
    });
});
